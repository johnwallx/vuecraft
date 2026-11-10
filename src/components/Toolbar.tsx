import type { ThemePref } from '../app/theme';

export interface ToolbarProps {
  fileName: string;
  dirty: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  theme: ThemePref;
  on: {
    newDocument: () => void;
    open: () => void;
    save: () => void;
    saveAs: () => void;
    exportSvg: () => void;
    addNode: () => void;
    deleteSelection: () => void;
    group: () => void;
    ungroup: () => void;
    undo: () => void;
    redo: () => void;
    fit: () => void;
    zoomToSelection: () => void;
    cycleTheme: () => void;
  };
}

const THEME_LABEL: Record<ThemePref, string> = { system: 'Theme: System', light: 'Theme: Light', dark: 'Theme: Dark' };

function Btn({ label, title, onClick, disabled }: { label: string; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}

export function Toolbar({ fileName, dirty, undoLabel, redoLabel, theme, on }: ToolbarProps) {
  return (
    <header className="toolbar" role="toolbar" aria-label="Map actions">
      <div className="group">
        <Btn label="New" title="New map (Ctrl+N)" onClick={on.newDocument} />
        <Btn label="Open…" title="Open map (Ctrl+O)" onClick={on.open} />
        <Btn label="Save" title="Save (Ctrl+S)" onClick={on.save} />
        <Btn label="Save As…" title="Save as (Ctrl+Shift+S)" onClick={on.saveAs} />
        <Btn label="Export SVG…" title="Export the whole map as SVG (Ctrl+E)" onClick={on.exportSvg} />
      </div>
      <div className="group">
        <Btn label="Add Node" title="Add a node at the center of the view (or double-click the canvas)" onClick={on.addNode} />
        <Btn label="Delete" title="Delete selection (Delete). Deleting a group keeps its contents." onClick={on.deleteSelection} />
        <Btn label="Group" title="Group selected nodes (Ctrl+G)" onClick={on.group} />
        <Btn label="Ungroup" title="Ungroup (Ctrl+Shift+G)" onClick={on.ungroup} />
      </div>
      <div className="group">
        <Btn label="Undo" title={undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : 'Nothing to undo'} onClick={on.undo} disabled={!undoLabel} />
        <Btn label="Redo" title={redoLabel ? `Redo ${redoLabel} (Ctrl+Y)` : 'Nothing to redo'} onClick={on.redo} disabled={!redoLabel} />
      </div>
      <div className="group">
        <Btn label="Fit" title="Fit all content (Shift+1)" onClick={on.fit} />
        <Btn label="Zoom to Selection" title="Zoom to selection (Shift+2)" onClick={on.zoomToSelection} />
      </div>
      <div className="status">
        <span className="file-name" title={fileName}>
          {fileName}
        </span>
        {dirty && (
          <span className="dirty" role="status">
            Unsaved changes
          </span>
        )}
        <Btn label={THEME_LABEL[theme]} title="Switch color theme" onClick={on.cycleTheme} />
      </div>
    </header>
  );
}
