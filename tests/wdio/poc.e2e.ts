// Proof of concept against the real VUECraft app: create, edit, drag, connect, a real
// Tauri command, save. reopen.e2e.ts then reopens the file in a new app process.
import { $, $$, browser, expect } from '@wdio/globals';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Doc = { nodes: { id: string; label: string; x: number; y: number }[]; edges: { id: string; source: string; target: string }[] };

/** PIDs of running vuecraft.exe processes (Windows). */
export const appPids = () =>
  execFileSync('tasklist', ['/FI', 'IMAGENAME eq vuecraft.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
    .split('\n')
    .map((l) => /^"vuecraft\.exe","(\d+)"/i.exec(l.trim())?.[1])
    .filter((p): p is string => !!p)
    .map(Number);
const snapshot = () => browser.execute(() => (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string): Promise<unknown> } }).__TAURI_INTERNALS__.invoke('doc_get')) as Promise<{ document: Doc }>;
const t0 = Date.now();
const step = (name: string) => console.log(`[step] ${name} @ ${Date.now() - t0} ms`);

/** Add Node (toolbar) opens the new node's editor; the embedded driver sends no dblclick. */
async function addNode(label: string) {
  await $('button=Add Node').click();
  const editor = await $('[aria-label="Node label"]');
  await editor.waitForExist({ timeout: 5000 });
  await browser.keys(label.split(''));
  await browser.keys('Enter');
  await $(`.concept-label=${label}`).waitForExist({ timeout: 5000 });
}

// The embedded driver sends one pointer event per move action, so a drag is several moves
// (React Flow starts dragging on the first move and moves the node on the following ones).
const STEPS = 8;
async function dragBy(el: WebdriverIO.Element, x: number, y: number) {
  let a = browser.action('pointer').move({ origin: el }).down();
  for (let i = 0; i < STEPS; i++) a = a.move({ origin: 'pointer', x: Math.round(x / STEPS), y: Math.round(y / STEPS) });
  await a.up().perform();
}

async function dragTo(from: WebdriverIO.Element, to: WebdriverIO.Element) {
  const [a, b] = [await from.getLocation(), await to.getLocation()];
  const [sa, sb] = [await from.getSize(), await to.getSize()];
  await dragBy(from, b.x + sb.width / 2 - (a.x + sa.width / 2), b.y + sb.height / 2 - (a.y + sa.height / 2));
}

describe('VUECraft desktop (WebdriverIO embedded driver PoC)', () => {
  it('creates, edits, drags, connects, calls the backend and saves', async () => {
    await $('.app[data-ready]').waitForExist({ timeout: 15000 });
    step('ready');

    await addNode('Alpha');
    let doc = (await snapshot()).document;
    const alpha = doc.nodes.find((n) => n.label === 'Alpha')!;
    const alphaEl = await $(`.react-flow__node[data-id="${alpha.id}"]`);
    step('created and edited Alpha');

    await dragBy(alphaEl, -260, 0);
    await browser.waitUntil(async () => {
      const a = (await snapshot()).document.nodes.find((n) => n.id === alpha.id)!;
      return a.x < alpha.x - 150;
    }, { timeout: 5000, timeoutMsg: 'drag did not move the node' });
    step('dragged Alpha by pointer');

    await addNode('Beta');
    doc = (await snapshot()).document;
    expect(doc.nodes.map((n) => n.label).sort()).toEqual(['Alpha', 'Beta']);
    step('created and edited Beta (real IPC: doc_get)');

    const beta = doc.nodes.find((n) => n.label === 'Beta')!;
    await alphaEl.moveTo();
    const from = await $(`.react-flow__node[data-id="${alpha.id}"] .react-flow__handle-right`);
    const to = await $(`.react-flow__node[data-id="${beta.id}"] .react-flow__handle-left`);
    await dragTo(from, to);
    await browser.waitUntil(async () => (await snapshot()).document.edges.length === 1, { timeout: 5000, timeoutMsg: 'no connection created' });
    doc = (await snapshot()).document;
    expect(doc.edges[0]).toMatchObject({ source: alpha.id, target: beta.id });
    await expect($$('.react-flow__edge')).toBeElementsArrayOfSize(1);
    step('connected Alpha -> Beta');

    const dir = process.env.VUECRAFT_RUN_DIR!;
    const file = join(dir, 'poc.vuecraft');
    expect(await browser.execute((p) => (window as unknown as { __vuecraft: { saveAs(p: string): Promise<boolean> } }).__vuecraft.saveAs(p), file)).toBe(true);
    const saved = (await snapshot()).document;
    // The file on disk is a valid map holding exactly what the app shows.
    const disk = JSON.parse(readFileSync(file, 'utf8'));
    expect([disk.format, disk.schemaVersion]).toEqual(['vuecraft', 2]);
    expect(disk.nodes.map((n: { id: string; label: string; x: number; y: number }) => [n.id, n.label, n.x, n.y])).toEqual(saved.nodes.map((n) => [n.id, n.label, n.x, n.y]));
    expect(disk.edges).toEqual(saved.edges);
    // Hand-off to reopen.e2e.ts, which runs in a new app process.
    writeFileSync(join(dir, 'saved.json'), JSON.stringify(saved));
    writeFileSync(join(dir, 'first-pids.json'), JSON.stringify(appPids()));
    step(`saved ${file} (${statSync(file).size} bytes) from app pid(s) ${appPids().join(', ')}`);
  });
});
