// R1.1-R1.4 in the real desktop app (test build): rich text, a link, a file reference and an
// image on a node, grouping, layer hide/show, then save, new, reopen: everything persists.
import { $, $$, browser, expect } from '@wdio/globals';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

type RichNode = { type: string; text?: string; marks?: { type: string }[]; content?: RichNode[] };
type DocNode = { id: string; label: string; kind?: string; parent?: string; text?: RichNode; resources?: { kind: string; target: string }[]; image?: string };
type Snapshot = { document: { nodes: DocNode[]; layers: { visible: boolean }[] }; images: string[] };
const snapshot = () => browser.execute(() => (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string): Promise<unknown> } }).__TAURI_INTERNALS__.invoke('doc_get')) as Promise<Snapshot>;
const seam = (fn: 'open' | 'saveAs' | 'queueFile', arg: string) =>
  browser.execute((f, a) => (window as unknown as { __vuecraft: Record<string, (p: string) => unknown> }).__vuecraft[f](a), fn, arg);
const texts = (n: RichNode): RichNode[] => (n.type === 'text' ? [n] : (n.content ?? []).flatMap(texts));
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const t0 = Date.now();
const step = (name: string) => console.log(`[step] ${name} @ ${Date.now() - t0} ms`);

// The embedded driver sends one event per pointer move, so drags are several moves.
async function drag(from: { x: number; y: number }, to: { x: number; y: number }) {
  let a = browser.action('pointer').move({ x: Math.round(from.x), y: Math.round(from.y) }).down();
  for (let i = 1; i <= 8; i++) a = a.move({ x: Math.round(from.x + ((to.x - from.x) * i) / 8), y: Math.round(from.y + ((to.y - from.y) * i) / 8) });
  await a.up().perform();
}
async function box(el: WebdriverIO.Element) {
  const [p, s] = [await el.getLocation(), await el.getSize()];
  return { x: p.x, y: p.y, w: s.width, h: s.height };
}

describe('R1.1-R1.4 in the desktop app (WebdriverIO)', () => {
  it('formats, attaches, groups, hides layers, and persists all of it', async () => {
    const dir = process.env.VUECRAFT_RUN_DIR!;
    const png = join(dir, 'photo.png');
    const notes = join(dir, 'notes.txt');
    writeFileSync(png, Buffer.from(PNG, 'base64'));
    writeFileSync(notes, 'notes');
    await $('.app[data-ready]').waitForExist({ timeout: 15000 });

    // R1.3: bold text typed through the format bar.
    await $('button=Add Node').click();
    await $('[aria-label="Node label"]').waitForExist({ timeout: 5000 });
    await browser.keys('Plain '.split(''));
    // Ctrl+B, the editor's own shortcut: the driver's synthetic click moves focus to the
    // format-bar button (a real click keeps it in the editor), so typing would go astray.
    await browser.keys(['Control', 'b']);
    await browser.keys('strong'.split(''));
    await browser.keys('Enter');
    await browser
      .waitUntil(async () => (await snapshot()).document.nodes.some((n) => n.label === 'Plain strong'), { timeout: 5000 })
      .catch(async (e) => {
        console.log(`[labels] ${JSON.stringify((await snapshot()).document.nodes.map((n) => n.label))}`);
        throw e;
      });
    let a = (await snapshot()).document.nodes.find((n) => n.label === 'Plain strong')!;
    console.log(`[text] ${JSON.stringify(a.text ?? null)}`);
    expect(texts(a.text!).find((t) => t.text === 'strong')?.marks).toEqual([{ type: 'bold' }]);
    expect(await $(`.react-flow__node[data-id="${a.id}"] .concept-label.rich strong`).getText()).toBe('strong');
    step('R1.3 bold text stored as rich text');

    // Make room, then a second node.
    const aEl = await $(`.react-flow__node[data-id="${a.id}"]`);
    const ab = await box(aEl);
    await drag({ x: ab.x + ab.w / 2, y: ab.y + ab.h / 2 }, { x: ab.x + ab.w / 2 - 260, y: ab.y + ab.h / 2 });
    await browser.waitUntil(async () => (await box(aEl)).x < ab.x - 150, { timeout: 5000, timeoutMsg: 'drag did not move the node' });
    await $('button=Add Node').click();
    await $('[aria-label="Node label"]').waitForExist({ timeout: 5000 });
    await browser.keys('Beta'.split(''));
    await browser.keys('Enter');
    await $('.concept-label=Beta').waitForExist({ timeout: 5000 });

    // R1.4: link, file reference and image on the first node.
    await aEl.click();
    const address = await $('[aria-label="Attachment address"]');
    await address.setValue('https://example.org/paper');
    await $('button=Add Link').click();
    await seam('queueFile', notes);
    await $('button=Attach File…').click();
    await seam('queueFile', png);
    await $('button=Insert Image…').click();
    await aEl.$('img.concept-image').waitForExist({ timeout: 5000 });
    a = (await snapshot()).document.nodes.find((n) => n.id === a.id)!;
    expect(a.resources).toEqual([
      { kind: 'url', target: 'https://example.org/paper' },
      { kind: 'file', target: notes },
    ]);
    expect(a.image).toMatch(/^[0-9a-f]{64}$/);
    step('R1.4 link, file reference and embedded image');

    // R1.1: rectangle-select both nodes, then Group.
    const both = [await box(aEl), await box(await $('.react-flow__node*=Beta'))];
    const left = Math.min(...both.map((b) => b.x)) - 40;
    const top = Math.min(...both.map((b) => b.y)) - 40;
    const right = Math.max(...both.map((b) => b.x + b.w)) + 40;
    const bottom = Math.max(...both.map((b) => b.y + b.h)) + 40;
    await drag({ x: left, y: top }, { x: right, y: bottom });
    await $('button=Group').click();
    await $('.react-flow__node-mapgroup').waitForExist({ timeout: 5000 });
    const nodes = (await snapshot()).document.nodes;
    const group = nodes.find((n) => n.kind === 'group')!;
    expect(nodes.filter((n) => n.parent === group.id).map((n) => n.label).sort()).toEqual(['Beta', 'Plain strong']);
    step('R1.1 grouped both nodes');

    // R1.2: hiding the layer hides its content; showing brings it back.
    await $('[role="tab"]=Layers').click();
    await $('[aria-label="Hide Layer 1"]').click();
    await browser.waitUntil(async () => (await $$('.react-flow__node')).length === 0, { timeout: 5000, timeoutMsg: 'hidden layer still rendered' });
    expect((await snapshot()).document.layers[0].visible).toBe(false);
    await $('[aria-label="Show Layer 1"]').click();
    await browser.waitUntil(async () => (await $$('.react-flow__node')).length === 3, { timeout: 5000 });
    step('R1.2 layer hidden and shown');

    // Persistence through the Rust engine: save, new, reopen, identical.
    const file = join(dir, 'r1.vuecraft');
    expect(await seam('saveAs', file)).toBe(true);
    const saved = await snapshot();
    await $('button=New').click();
    await browser.waitUntil(async () => (await snapshot()).document.nodes.length === 0, { timeout: 5000 });
    await seam('open', file);
    await browser.waitUntil(async () => (await snapshot()).document.nodes.length === 3, { timeout: 5000 });
    const reopened = await snapshot();
    expect(reopened.document).toEqual(saved.document);
    expect(reopened.images).toEqual([a.image]);
    expect(await $(`.react-flow__node[data-id="${a.id}"] .concept-label.rich strong`).getText()).toBe('strong');
    await $('img.concept-image').waitForExist({ timeout: 5000 });
    step('saved and reopened: text, attachments, image, group and layers identical');
  });
});
