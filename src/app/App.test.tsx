// Integration test of the real canvas (React Flow in jsdom) against a fake IPC backend.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import type { DocNode, MapDocument, Op, Snapshot } from '../bridge/api';
import { queuedChoices } from '../bridge/files';
import { App } from './App';

interface Call {
  cmd: string;
  args: { tx?: { baseRevision: number; ops: Op[] }; path?: string; node?: string; index?: number };
}

function fakeBackend(initial: Partial<MapDocument> = {}) {
  const s = {
    doc: {
      format: 'vuecraft',
      schemaVersion: 2,
      title: '',
      nodes: [],
      edges: [],
      layers: [{ id: 'layer-1', name: 'Layer 1', visible: true, locked: false }],
      ...initial,
    } as MapDocument,
    revision: 0,
    dirty: false,
    images: [] as string[],
    rejectNext: false,
    calls: [] as Call[],
    launch: null as string | null,
    path: null as string | null,
  };
  const snap = (): Snapshot => ({
    document: structuredClone(s.doc),
    images: [...s.images],
    revision: s.revision,
    path: s.path,
    dirty: s.dirty,
    undoLabel: s.dirty ? 'Edit' : null,
    redoLabel: null,
  });
  const apply = (op: Op) => {
    const d = s.doc;
    if (op.op === 'addNode') d.nodes.push(op.node);
    else if (op.op === 'removeNode') {
      d.nodes = d.nodes.filter((n) => n.id !== op.id);
      d.edges = d.edges.filter((e) => e.source !== op.id && e.target !== op.id);
    } else if (op.op === 'setNodeLabel') d.nodes.find((n) => n.id === op.id)!.label = op.label;
    else if (op.op === 'setNodeResources') d.nodes.find((n) => n.id === op.id)!.resources = op.resources;
    else if (op.op === 'setNodeImage') d.nodes.find((n) => n.id === op.id)!.image = op.image ?? undefined;
    else if (op.op === 'resizeNode') Object.assign(d.nodes.find((n) => n.id === op.id)!, { width: op.width, height: op.height });
  };
  mockIPC((cmd, args) => {
    s.calls.push({ cmd, args: args as Call['args'] });
    switch (cmd) {
      case 'doc_get':
        return snap();
      case 'doc_new':
        s.doc = { ...s.doc, nodes: [], edges: [] };
        s.revision += 1;
        s.dirty = false;
        return snap();
      case 'doc_apply': {
        const tx = (args as Call['args']).tx!;
        if (s.rejectNext) {
          s.rejectNext = false;
          throw 'Edit rejected: simulated failure';
        }
        if (tx.baseRevision !== s.revision) throw 'stale';
        tx.ops.forEach(apply);
        s.revision += 1;
        s.dirty = true;
        return snap();
      }
      case 'doc_undo':
        return snap();
      case 'resource_status':
        return (s.doc.nodes.find((n) => n.id === (args as Call['args']).node)?.resources ?? []).map((r) => (r.kind === 'file' ? false : null));
      case 'resource_open':
        return null;
      case 'image_import':
        if (!(args as Call['args']).path!.endsWith('.png')) throw 'Could not insert: not a PNG, JPEG, GIF or WebP image';
        s.images.push('img1');
        return 'img1';
      case 'image_data':
        return 'data:image/png;base64,AAAA';
      case 'launch_path': {
        const p = s.launch;
        s.launch = null;
        return p;
      }
      case 'doc_open':
        s.path = (args as Call['args']).path!;
        s.revision += 1;
        return snap();
    }
    throw `unexpected command ${cmd}`;
  });
  const applied = () => s.calls.filter((c) => c.cmd === 'doc_apply').map((c) => c.args.tx!.ops);
  return { s, applied };
}

const node = (id: string, x: number): DocNode => ({ id, label: id.toUpperCase(), x, y: 0, width: 120, height: 40, layer: 'layer-1', style: { shape: 'rounded' } });

async function renderApp() {
  render(<App />);
  await waitFor(() => expect(document.querySelector('.react-flow__pane')).not.toBeNull());
  return document.querySelector('.react-flow__pane')!;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  clearMocks();
});

describe('editor workflow', () => {
  it('double-clicking empty canvas creates a node, opens its editor, and commits the label', async () => {
    const { applied } = fakeBackend();
    const pane = await renderApp();
    fireEvent.doubleClick(pane, { clientX: 300, clientY: 200 });

    const editor = await screen.findByLabelText('Node label');
    expect(applied()[0][0]).toMatchObject({ op: 'addNode', node: { label: 'New concept', width: 160, height: 56 } });
    await waitFor(() => expect(document.activeElement).toBe(editor));
    await userEvent.keyboard('Research Question{Enter}');

    await waitFor(() => expect(screen.getByText('Research Question')).toBeTruthy());
    const id = (applied()[0][0] as { node: DocNode }).node.id;
    expect(applied()[1][0]).toEqual({ op: 'setNodeLabel', id, label: 'Research Question' });
    expect(screen.queryByLabelText('Node label')).toBeNull();
  });

  it('transactions are submitted against the latest revision', async () => {
    const { applied, s } = fakeBackend();
    const pane = await renderApp();
    fireEvent.doubleClick(pane, { clientX: 10, clientY: 10 });
    await screen.findByLabelText('Node label');
    await userEvent.keyboard('{Escape}');
    fireEvent.doubleClick(pane, { clientX: 400, clientY: 10 });
    await screen.findByLabelText('Node label');
    expect(applied()).toHaveLength(2);
    expect(s.calls.filter((c) => c.cmd === 'doc_apply').map((c) => c.args.tx!.baseRevision)).toEqual([0, 1]);
  });

  it('click selects a node and Delete removes it through one transaction', async () => {
    const { applied } = fakeBackend({
      nodes: [node('a', 0), node('b', 300)],
      edges: [{ id: 'ab', source: 'a', target: 'b', label: '', layer: 'layer-1', style: { arrow: 'end', curve: 'straight' } }],
    });
    await renderApp();
    const a = await waitFor(() => {
      const el = document.querySelector('.react-flow__node[data-id="a"]');
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.click(a);
    await waitFor(() => expect(a.classList.contains('selected')).toBe(true));
    fireEvent.keyDown(document.body, { key: 'Delete' });
    await waitFor(() => expect(applied()).toEqual([[{ op: 'removeNode', id: 'a' }]]));
    await waitFor(() => expect(document.querySelector('.react-flow__node[data-id="a"]')).toBeNull());
    expect(document.querySelector('.react-flow__node[data-id="b"]')).not.toBeNull();
  });

  it('arrow keys on a selected node do not move it on screen without a document change', async () => {
    const { applied } = fakeBackend({ nodes: [node('a', 0)] });
    await renderApp();
    const a = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('.react-flow__node[data-id="a"]');
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.click(a);
    await waitFor(() => expect(a.classList.contains('selected')).toBe(true));
    const before = a.style.transform;
    fireEvent.keyDown(a, { key: 'ArrowRight' });
    fireEvent.keyDown(a, { key: 'ArrowDown' });
    await new Promise((r) => setTimeout(r, 50));
    expect(a.style.transform).toBe(before);
    expect(applied()).toEqual([]);
  });

  it('opens the file the app was started with (double-clicked .vuecraft) once', async () => {
    const { s } = fakeBackend();
    s.launch = 'C:\\maps\\launched.vuecraft';
    await renderApp();
    await waitFor(() => expect(s.calls.filter((c) => c.cmd === 'doc_open').map((c) => c.args.path)).toEqual(['C:\\maps\\launched.vuecraft']));
    expect(await screen.findByText(/launched\.vuecraft/)).toBeTruthy();
  });

  it('a rejected edit is reported and the canvas resyncs to the canonical document', async () => {
    const { s } = fakeBackend();
    const pane = await renderApp();
    s.rejectNext = true;
    fireEvent.doubleClick(pane, { clientX: 10, clientY: 10 });
    expect((await screen.findByRole('alert')).textContent).toContain('simulated failure');
    expect(s.calls.at(-1)!.cmd).toBe('doc_get');
    expect(document.querySelectorAll('.react-flow__node')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('replacing a modified document asks to save; Cancel keeps it, Don’t Save discards', async () => {
    const { s } = fakeBackend();
    const pane = await renderApp();
    fireEvent.doubleClick(pane, { clientX: 10, clientY: 10 });
    const keep = await screen.findByLabelText('Node label');
    await waitFor(() => expect(document.activeElement).toBe(keep));
    await userEvent.keyboard('Keep me{Enter}');
    await screen.findByText('Unsaved changes');

    fireEvent.keyDown(document.body, { key: 'n', ctrlKey: true });
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(s.calls.some((c) => c.cmd === 'doc_new')).toBe(false);
    expect(screen.getByText('Keep me')).toBeTruthy();

    fireEvent.keyDown(document.body, { key: 'n', ctrlKey: true });
    await screen.findByRole('dialog');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Don’t Save' })));
    await waitFor(() => expect(s.calls.some((c) => c.cmd === 'doc_new')).toBe(true));
    await waitFor(() => expect(screen.queryByText('Keep me')).toBeNull());
  });

  it('Ctrl+Z undoes through the backend and is ignored while typing', async () => {
    const { s } = fakeBackend();
    const pane = await renderApp();
    fireEvent.doubleClick(pane, { clientX: 10, clientY: 10 });
    const editor = await screen.findByLabelText('Node label');
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    expect(s.calls.some((c) => c.cmd === 'doc_undo')).toBe(false);
    await userEvent.keyboard('{Escape}');
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(s.calls.some((c) => c.cmd === 'doc_undo')).toBe(true));
  });

  it('attachments: links are validated, open only after confirmation, files and images come from the chooser', async () => {
    const { s, applied } = fakeBackend({ nodes: [node('a', 0)] });
    await renderApp();
    const a = await waitFor(() => {
      const el = document.querySelector('.react-flow__node[data-id="a"]');
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.click(a);
    const address = await screen.findByLabelText('Attachment address');

    await userEvent.type(address, 'javascript:alert(1){Enter}');
    expect(address.getAttribute('aria-invalid')).toBe('true');
    expect(applied()).toHaveLength(0);
    await userEvent.clear(address);
    await userEvent.type(address, 'https://example.org/paper{Enter}');
    await waitFor(() =>
      expect(applied().at(-1)).toEqual([{ op: 'setNodeResources', id: 'a', resources: [{ kind: 'url', target: 'https://example.org/paper' }] }]),
    );

    queuedChoices.push('C:/data/missing.pdf');
    await userEvent.click(screen.getByRole('button', { name: 'Attach File…' }));
    await screen.findByText('File not found');
    expect(s.doc.nodes[0].resources!.map((r) => r.kind)).toEqual(['url', 'file']);

    // Opening asks first; Cancel opens nothing.
    await userEvent.click(screen.getByRole('button', { name: 'Open https://example.org/paper' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(s.calls.some((c) => c.cmd === 'resource_open')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Show C:/data/missing.pdf' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Show in Folder' }));
    await waitFor(() => expect(s.calls.find((c) => c.cmd === 'resource_open')?.args).toEqual({ node: 'a', index: 1 }));

    queuedChoices.push('C:/pics/notes.txt');
    await userEvent.click(screen.getByRole('button', { name: 'Insert Image…' }));
    await screen.findByText(/not a PNG, JPEG, GIF or WebP image/);
    queuedChoices.push('C:/pics/photo.png');
    await userEvent.click(screen.getByRole('button', { name: 'Insert Image…' }));
    await waitFor(() =>
      expect(applied().at(-1)).toEqual([
        { op: 'setNodeImage', id: 'a', image: 'img1' },
        { op: 'resizeNode', id: 'a', x: 0, y: 0, width: 160, height: 140 },
      ]),
    );
    await waitFor(() => expect(a.querySelector('img.concept-image')?.getAttribute('src')).toBe('data:image/png;base64,AAAA'));
    await userEvent.click(screen.getByRole('button', { name: 'Remove Image' }));
    await waitFor(() => expect(applied().at(-1)).toEqual([{ op: 'setNodeImage', id: 'a', image: null }]));
  });

  it('pasting a node whose image this document does not hold keeps the node without it', async () => {
    const { applied } = fakeBackend({ nodes: [{ ...node('a', 0), image: 'elsewhere' }] });
    await renderApp();
    const a = await waitFor(() => {
      const el = document.querySelector('.react-flow__node[data-id="a"]');
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.click(a);
    await waitFor(() => expect(a.classList.contains('selected')).toBe(true));
    fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(applied()).toHaveLength(1));
    const pasted = (applied()[0][0] as { node: DocNode }).node;
    expect(pasted.label).toBe('A');
    expect(pasted.image).toBeUndefined();
  });
});
