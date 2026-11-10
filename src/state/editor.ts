// UI-only editor state shared by canvas components (not persisted).
import { createContext, useContext, type MutableRefObject } from 'react';
import type { Layer, Op, Snapshot } from '../bridge/api';
import type { DialogRequest } from '../components/ChoiceDialog';

export interface Editor {
  /** Node or edge whose label is being edited. */
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  commit: (label: string, ops: Op[]) => Promise<Snapshot | null>;
  /** Ids to select once the next snapshot arrives (e.g. after paste). */
  pendingSelection: MutableRefObject<Set<string> | null>;
  /** Layer that receives new objects. */
  activeLayer: Layer | undefined;
  setActiveLayer: (id: string) => void;
  ask: (request: DialogRequest) => Promise<string>;
  notify: (message: string) => void;
}

/** Why new content cannot go to the active layer, or null when it can. */
export function cannotCreateOn(layer: Layer | undefined): string | null {
  if (!layer) return 'There is no layer to add content to.';
  if (!layer.visible) return `The active layer “${layer.name}” is hidden. Show it or pick another layer in the Layers panel.`;
  if (layer.locked) return `The active layer “${layer.name}” is locked. Unlock it or pick another layer in the Layers panel.`;
  return null;
}

export const EditorContext = createContext<Editor | null>(null);

export function useEditor(): Editor {
  const editor = useContext(EditorContext);
  if (!editor) throw new Error('useEditor outside EditorContext');
  return editor;
}
