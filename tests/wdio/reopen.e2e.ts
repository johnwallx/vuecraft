// Runs after poc.e2e.ts, in a new app process: the file it saved reopens through the real
// application with the same node ids, labels, positions, edges and layers.
import { $, $$, browser, expect } from '@wdio/globals';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Doc = {
  nodes: { id: string; label: string; x: number; y: number }[];
  edges: { id: string; source: string; target: string }[];
  layers: unknown[];
};
type Snapshot = { document: Doc; path: string | null; dirty: boolean; undoLabel: string | null };
const snapshot = () => browser.execute(() => (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string): Promise<unknown> } }).__TAURI_INTERNALS__.invoke('doc_get')) as Promise<Snapshot>;
// Not imported from poc.e2e.ts: importing a spec file would register its tests here too.
const appPids = () =>
  execFileSync('tasklist', ['/FI', 'IMAGENAME eq vuecraft.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
    .split('\n')
    .map((l) => /^"vuecraft\.exe","(\d+)"/i.exec(l.trim())?.[1])
    .filter((p): p is string => !!p)
    .map(Number);

describe('VUECraft desktop (WebdriverIO embedded driver PoC)', () => {
  it('reopens the saved document in a new app process', async () => {
    const t0 = Date.now();
    const dir = process.env.VUECRAFT_RUN_DIR!;
    await $('.app[data-ready]').waitForExist({ timeout: 15000 });
    await browser.waitUntil(async () => browser.execute(() => 'open' in ((window as unknown as { __vuecraft?: object }).__vuecraft ?? {})), { timeout: 10000 });

    // A genuinely new process with no inherited document state.
    const first: number[] = JSON.parse(readFileSync(join(dir, 'first-pids.json'), 'utf8'));
    const now = appPids();
    expect(now).toHaveLength(1);
    expect(first.filter((p) => now.includes(p))).toEqual([]);
    const fresh = await snapshot();
    expect([fresh.document.nodes.length, fresh.document.edges.length, fresh.path, fresh.dirty, fresh.undoLabel]).toEqual([0, 0, null, false, null]);
    console.log(`[step] new app pid ${now[0]} (first run: ${first.join(', ')}), empty document @ ${Date.now() - t0} ms`);

    // Reopen through the real application (Rust reads and validates the file).
    const file = join(dir, 'poc.vuecraft');
    await browser.execute((p) => (window as unknown as { __vuecraft: { open(p: string): Promise<void> } }).__vuecraft.open(p), file);
    await browser.waitUntil(async () => (await snapshot()).path !== null, { timeout: 5000, timeoutMsg: 'open did not complete' });
    const reopened = await snapshot();
    const saved: Doc = JSON.parse(readFileSync(join(dir, 'saved.json'), 'utf8'));
    expect(reopened.path?.toLowerCase()).toBe(file.toLowerCase());
    expect(reopened.dirty).toBe(false);
    expect(reopened.document.nodes.map((n) => [n.id, n.label, n.x, n.y])).toEqual(saved.nodes.map((n) => [n.id, n.label, n.x, n.y]));
    expect(reopened.document.edges).toEqual(saved.edges);
    expect(reopened.document.layers).toEqual(saved.layers);
    expect(reopened.document).toEqual(saved);
    const ids = new Set(reopened.document.nodes.map((n) => n.id));
    expect(reopened.document.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
    await $('.concept-label=Alpha').waitForExist({ timeout: 5000 });
    await $('.concept-label=Beta').waitForExist({ timeout: 5000 });
    await expect($$('.react-flow__edge')).toBeElementsArrayOfSize(1);
    console.log(`[step] reopened identically (ids, labels, positions, edges, layers) @ ${Date.now() - t0} ms`);
  });
});
