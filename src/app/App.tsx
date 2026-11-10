import { useEffect, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { queuedChoices } from '../bridge/files';
import { FILE_EXTENSION, LEGACY_FILE_EXTENSION, api } from '../bridge/api';
import { MapCanvas } from '../canvas/MapCanvas';
import { useEditActions } from '../canvas/actions';
import { ChoiceDialog, type DialogRequest } from '../components/ChoiceDialog';
import { Sidebar } from '../components/Sidebar';
import { Toolbar } from '../components/Toolbar';
import { EditorContext } from '../state/editor';
import { useSession } from '../state/session';
import { useTheme } from './theme';

const MAP_FILTER = { name: 'VUECraft map', extensions: [FILE_EXTENSION] };
const OPEN_FILTER = { name: 'VUECraft map', extensions: [FILE_EXTENSION, LEGACY_FILE_EXTENSION] };

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const stem = (name: string) => name.replace(/\.[^.]+$/, '');

export function App() {
  return (
    <ReactFlowProvider>
      <Workspace />
    </ReactFlowProvider>
  );
}

function Workspace() {
  const session = useSession();
  const { snapshot } = session;
  const [editingId, setEditingId] = useState<string | null>(null);
  const pendingSelection = useRef<Set<string> | null>(null);
  const [dialog, setDialog] = useState<(DialogRequest & { resolve: (id: string) => void }) | null>(null);
  const [activeLayerId, setActiveLayer] = useState<string | null>(null);
  const theme = useTheme();
  const layers = snapshot?.document.layers ?? [];
  // New content goes to the chosen layer, else the topmost editable one.
  const activeLayer =
    layers.find((l) => l.id === activeLayerId) ?? [...layers].reverse().find((l) => l.visible && !l.locked) ?? layers.at(-1);
  const actions = useEditActions(session.commit, setEditingId, pendingSelection, session.report, activeLayer, session.snapshot?.images);

  const ask = (request: DialogRequest) =>
    new Promise<string>((resolve) =>
      setDialog({
        ...request,
        resolve: (id) => {
          setDialog(null);
          resolve(id);
        },
      }),
    );

  const fileName = snapshot?.path ? baseName(snapshot.path) : 'Untitled';
  const dirty = snapshot?.dirty ?? false;
  // Dialogs start next to the current file instead of wherever the OS last looked.
  const pathStem = snapshot?.path ? stem(snapshot.path) : 'Untitled';

  const saveAs = async (target?: string) => {
    const path = target ?? (await saveDialog({ defaultPath: `${pathStem}.${FILE_EXTENSION}`, filters: [MAP_FILTER] }));
    return path ? (await session.save(path)) !== null : false;
  };
  const save = async () => (snapshot?.path ? (await session.save(null)) !== null : saveAs());

  /** True when it is safe to replace the current document. */
  const confirmDiscard = async () => {
    if (!dirty) return true;
    const choice = await ask({
      title: `Save changes to “${fileName}”?`,
      body: 'Your changes will be lost if you don’t save them.',
      choices: [
        { id: 'discard', label: 'Don’t Save', left: true },
        { id: 'cancel', label: 'Cancel' },
        { id: 'save', label: 'Save', primary: true },
      ],
      cancel: 'cancel',
    });
    return choice === 'save' ? save() : choice === 'discard';
  };

  const commands = {
    ...actions,
    save,
    saveAs,
    confirmDiscard,
    newDocument: async () => {
      if (!(await confirmDiscard())) return;
      setEditingId(null);
      await session.newDocument();
    },
    open: async (target?: string) => {
      if (!(await confirmDiscard())) return;
      const path =
        target ?? (await openDialog({ multiple: false, directory: false, defaultPath: snapshot?.path ?? undefined, filters: [OPEN_FILTER] }));
      if (typeof path !== 'string') return;
      setEditingId(null);
      await session.open(path);
    },
    exportSvg: async (target?: string) => {
      const path = target ?? (await saveDialog({ defaultPath: `${pathStem}.svg`, filters: [{ name: 'SVG image', extensions: ['svg'] }] }));
      return path ? session.exportSvg(path) : false;
    },
    undo: () => {
      setEditingId(null);
      void session.undo();
    },
    redo: () => {
      setEditingId(null);
      void session.redo();
    },
  };

  // Long-lived listeners read the latest closures through this ref.
  const latest = useRef(commands);
  const modalOpen = useRef(false);
  useEffect(() => {
    latest.current = commands;
    modalOpen.current = dialog !== null;
  });

  useEffect(() => {
    // Run once: load the backend's current document, then open the file the app was started
    // with (double-clicking a .vuecraft file). Open errors show in the error banner.
    void session.load().then(async () => {
      const path = await api.launchPath().catch(() => null);
      if (path) await session.open(path);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isTauri()) void getCurrentWindow().setTitle(`${dirty ? '● ' : ''}${fileName} — VUECraft`);
  }, [fileName, dirty]);

  useEffect(() => {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    const unlisten = win.onCloseRequested(async (event) => {
      event.preventDefault();
      if (await latest.current.confirmDiscard()) await win.destroy();
    });
    return () => void unlisten.then((f) => f());
  }, []);

  // Test seam for the desktop end-to-end suite: the same commands with the native file dialog
  // step skipped. Compiled in only for test builds (VITE_E2E_WDIO=1; production bundles drop it)
  // and installed only when the backend reports VUECRAFT_TEST_SEAM in a test build.
  useEffect(() => {
    if (import.meta.env.VITE_E2E_WDIO !== '1') return;
    void api
      .testSeamEnabled()
      .then((enabled) => {
        if (!enabled) return;
        (window as unknown as { __vuecraft: object }).__vuecraft = {
          open: (p: string) => latest.current.open(p),
          saveAs: (p: string) => latest.current.saveAs(p),
          exportSvg: (p: string) => latest.current.exportSvg(p),
          /** Answers the next "choose a file" dialog (attachments, images). */
          queueFile: (p: string) => queuedChoices.push(p),
        };
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (modalOpen.current || target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const c = latest.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      let handled = true;
      if (mod && key === 'n') void c.newDocument();
      else if (mod && key === 'o') void c.open();
      else if (mod && key === 's') void (e.shiftKey ? c.saveAs() : c.save());
      else if (mod && key === 'e') void c.exportSvg();
      else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) c.redo();
      else if (mod && key === 'z') c.undo();
      else if (mod && key === 'c') c.copy();
      else if (mod && key === 'v') c.paste();
      else if (mod && key === 'd') c.duplicate();
      else if (mod && key === 'g') (e.shiftKey ? c.ungroupSelection : c.groupSelection)();
      else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) c.deleteSelection();
      else if (!mod && (e.key === 'F2' || e.key === 'Enter') && !target.closest('button')) c.editSelected();
      else if (e.shiftKey && e.code === 'Digit1') c.fit();
      else if (e.shiftKey && e.code === 'Digit2') c.zoomToSelection();
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <EditorContext.Provider
      value={{ editingId, setEditingId, commit: session.commit, pendingSelection, activeLayer, setActiveLayer, ask, notify: session.report }}
    >
      <div className="app" data-ready={snapshot ? true : undefined}>
        <Toolbar
          fileName={fileName}
          dirty={dirty}
          undoLabel={snapshot?.undoLabel ?? null}
          redoLabel={snapshot?.redoLabel ?? null}
          theme={theme.pref}
          on={{
            newDocument: () => void commands.newDocument(),
            open: () => void commands.open(),
            save: () => void commands.save(),
            saveAs: () => void commands.saveAs(),
            exportSvg: () => void commands.exportSvg(),
            addNode: commands.addNodeAtCenter,
            deleteSelection: commands.deleteSelection,
            group: commands.groupSelection,
            ungroup: commands.ungroupSelection,
            undo: commands.undo,
            redo: commands.redo,
            fit: commands.fit,
            zoomToSelection: commands.zoomToSelection,
            cycleTheme: theme.cycle,
          }}
        />
        {session.error && (
          <div className="error-banner" role="alert">
            <span>{session.error}</span>
            <button type="button" onClick={session.clearError} aria-label="Dismiss error">
              Dismiss
            </button>
          </div>
        )}
        <main className="workspace">
          <MapCanvas snapshot={snapshot} generation={session.generation} dark={theme.dark} onCreateAt={(p) => void actions.createNodeAt(p)} />
          <Sidebar layers={layers} onMoveSelectionToLayer={commands.moveSelectionToLayer} />
        </main>
        {dialog && <ChoiceDialog request={dialog} onChoose={dialog.resolve} />}
      </div>
    </EditorContext.Provider>
  );
}
