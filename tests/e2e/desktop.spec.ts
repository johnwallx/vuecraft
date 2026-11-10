// Required R0 end-to-end scenario (docs/PRODUCT_SPEC.md §13), run against the real
// desktop app: Tauri + WebView2 + Rust engine + real filesystem. Windows only.
// The main scenario passes file paths through window.__vuecraft (the same commands the
// toolbar uses after its dialog returns); a second test drives the real native dialogs.
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MapDocument, Snapshot } from '../../src/bridge/api';
import { EXE, acquireDesktopLock, buildIdentity, collectDiagnostics, killTree, launchApp, preflight, type Launched } from './harness';

const execFileAsync = promisify(execFile);
const dir = mkdtempSync(join(tmpdir(), 'vuecraft-e2e-'));
const shots = resolve('test-results/desktop');

test.skip(process.platform !== 'win32', 'WebView2 DevTools automation is Windows-only');
test.skip(!existsSync(EXE), `build the app first: pnpm tauri build --debug --no-bundle (${EXE})`);

let app: ChildProcess | null = null;
let browser: Browser | null = null;
let current: Launched | null = null;
let releaseLock: (() => void) | null = null;

test.beforeAll(() => {
  releaseLock = acquireDesktopLock();
  console.log(`[build] ${JSON.stringify(buildIdentity())}`);
});

// eslint-disable-next-line no-empty-pattern -- Playwright passes fixtures first; none are wanted here
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) await collectDiagnostics(current, testInfo);
});

async function launch(): Promise<Page> {
  // A failed test can leave its app behind; never reuse it.
  await browser?.close().catch(() => {});
  killTree(app);
  current = await launchApp(dir);
  ({ proc: app, browser } = current);
  await preflight(current);
  return current.page;
}

async function exitApp(page: Page) {
  const exited = new Promise<number | null>((r) => app!.once('exit', r));
  await requestClose(page);
  await exited;
  await browser?.close().catch(() => {});
  browser = null;
  app = null;
}

/** Same event as clicking the window's close button. */
const requestClose = (page: Page) =>
  page.evaluate(() => {
    void window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' });
  });

const backend = (page: Page) => page.evaluate(() => window.__TAURI_INTERNALS__.invoke('doc_get')) as Promise<Snapshot>;
const nodeEl = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const byLabel = (doc: MapDocument, label: string) => doc.nodes.find((n) => n.label === label)!;

async function center(page: Page, selector: string) {
  const b = (await page.locator(selector).first().boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, button: 'left' | 'middle' = 'left') {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up({ button });
}

async function createNode(page: Page, x: number, y: number, label: string) {
  const pane = (await page.locator('.react-flow__pane').boundingBox())!;
  await page.mouse.dblclick(pane.x + x, pane.y + y);
  const editor = page.getByLabel('Node label');
  await expect(editor).toBeFocused();
  await page.keyboard.type(label);
  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.concept-label', { hasText: label })).toBeVisible();
}

async function connect(page: Page, fromId: string, toId: string) {
  await nodeEl(page, fromId).hover();
  const from = await center(page, `.react-flow__node[data-id="${fromId}"] .react-flow__handle-right`);
  const to = await center(page, `.react-flow__node[data-id="${toId}"] .react-flow__handle-left`);
  await drag(page, from, to);
}

/** Edge endpoints and node boxes in screen space, sampled from one rendered frame. */
async function edgesAttached(page: Page) {
  return page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {};
    for (const n of document.querySelectorAll<HTMLElement>('.react-flow__node')) {
      const r = n.getBoundingClientRect();
      boxes[n.dataset.id!] = { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    const edges: { id: string; ends: [number, number][] }[] = [];
    for (const g of document.querySelectorAll<SVGGElement>('.react-flow__edge')) {
      const path = g.querySelector<SVGPathElement>('path.react-flow__edge-path')!;
      const m = path.getScreenCTM()!;
      const ends = [path.getPointAtLength(0), path.getPointAtLength(path.getTotalLength())].map((p) => new DOMPoint(p.x, p.y).matrixTransform(m));
      const id = g.getAttribute('data-id') ?? g.dataset.testid;
      edges.push({ id: id ?? '', ends: ends.map((p) => [p.x, p.y] as [number, number]) });
    }
    return { boxes, edges };
  });
}

function onOutline(p: [number, number], box: { x: number; y: number; width: number; height: number }) {
  const [x, y] = p;
  const inside = x >= box.x - 3 && x <= box.x + box.width + 3 && y >= box.y - 3 && y <= box.y + box.height + 3;
  const nearEdge = Math.min(Math.abs(x - box.x), Math.abs(x - box.x - box.width), Math.abs(y - box.y), Math.abs(y - box.y - box.height)) <= 3;
  return inside && nearEdge;
}

test.afterAll(async () => {
  await browser?.close().catch(() => {});
  killTree(app);
  releaseLock?.();
});

test('R0 desktop workflow', async () => {
  const mapPath = join(dir, 'research.vuecraft');
  const svgPath = join(dir, 'research.svg');
  let page = await launch();

  await test.step('1. launches into a blank, clean document', async () => {
    await expect(page.locator('.file-name')).toHaveText('Untitled');
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
    await expect(page.getByText('Unsaved changes')).toHaveCount(0);
  });

  await test.step('2-3. creates and labels three nodes', async () => {
    await createNode(page, 200, 200, 'Research Question');
    await createNode(page, 520, 200, 'Evidence');
    await createNode(page, 840, 200, 'Conclusion');
    const doc = (await backend(page)).document;
    expect(doc.nodes.map((n) => n.label)).toEqual(['Research Question', 'Evidence', 'Conclusion']);
    expect(new Set(doc.nodes.map((n) => n.id)).size).toBe(3);
    await expect(page.getByText('Unsaved changes')).toBeVisible();
  });

  let ids: { rq: string; ev: string; co: string };
  await test.step('4-5. connects first→second and second→third', async () => {
    let doc = (await backend(page)).document;
    ids = { rq: byLabel(doc, 'Research Question').id, ev: byLabel(doc, 'Evidence').id, co: byLabel(doc, 'Conclusion').id };
    await connect(page, ids.rq, ids.ev);
    await connect(page, ids.ev, ids.co);
    doc = (await backend(page)).document;
    expect(doc.edges.map((e) => [e.source, e.target])).toEqual([
      [ids.rq, ids.ev],
      [ids.ev, ids.co],
    ]);
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  });

  await test.step('6-7. dragging the middle node keeps both connections attached', async () => {
    const before = byLabel((await backend(page)).document, 'Evidence');
    const checkAttached = async (when: string) => {
      const doc = (await backend(page)).document;
      const { boxes, edges } = await edgesAttached(page);
      for (const e of edges) {
        const edge = doc.edges.find((d) => e.id.endsWith(d.id))!;
        const detail = `${when}: edge ${edge.id} ends ${JSON.stringify(e.ends)} boxes ${JSON.stringify([boxes[edge.source], boxes[edge.target]])}`;
        expect(onOutline(e.ends[0], boxes[edge.source]), detail).toBe(true);
        expect(onOutline(e.ends[1], boxes[edge.target]), detail).toBe(true);
      }
    };
    const c = await center(page, `.react-flow__node[data-id="${ids.ev}"]`);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 10, c.y + 70, { steps: 5 });
    await checkAttached('mid-drag');
    await page.mouse.move(c.x + 20, c.y + 140, { steps: 5 });
    await page.mouse.up();
    const after = byLabel((await backend(page)).document, 'Evidence');
    expect(after.y).toBeGreaterThan(before.y + 100);
    await checkAttached('after drag');
    await page.screenshot({ path: join(shots, '07-after-drag.png') });
  });

  await test.step('8. edits a connection label', async () => {
    const edgeId = (await backend(page)).document.edges[0].id;
    const mid = await page.evaluate((id) => {
      const path = document.querySelector<SVGPathElement>(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path, [data-testid="rf__edge-${id}"] path.react-flow__edge-path`)!;
      const p = path.getPointAtLength(path.getTotalLength() / 2);
      const s = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()!);
      return { x: s.x, y: s.y };
    }, edgeId);
    await page.mouse.dblclick(mid.x, mid.y);
    await expect(page.getByLabel('Connection label')).toBeFocused();
    await page.keyboard.type('supports');
    await page.keyboard.press('Enter');
    await expect(page.locator('.edge-label', { hasText: 'supports' })).toBeVisible();
    expect((await backend(page)).document.edges[0].label).toBe('supports');
    await page.keyboard.press('Control+z');
    await expect(page.locator('.edge-label', { hasText: 'supports' })).toHaveCount(0);
    expect((await backend(page)).document.edges[0].label).toBe('');
    await page.keyboard.press('Control+y');
    await expect(page.locator('.edge-label', { hasText: 'supports' })).toBeVisible();
  });

  await test.step('styles a node and a connection (persisted later)', async () => {
    await nodeEl(page, ids.rq).click();
    await page.getByRole('button', { name: 'ellipse' }).click();
    await page.getByRole('button', { name: 'Fill: #fde68a' }).click();
    await page.getByRole('button', { name: 'Border: #7f1d1d' }).click();
    const rq = byLabel((await backend(page)).document, 'Research Question');
    expect(rq.style).toEqual({ shape: 'ellipse', fill: '#fde68a', stroke: '#7f1d1d' });
  });

  await test.step('more R0 editing: toolbar add, multiline, cancel, resize, delete, edge style, copy/paste', async () => {
    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    const clear = () => page.mouse.click(pane.x + pane.width / 2, pane.y + 20);
    const edgeMid = (id: string) =>
      page.evaluate((id) => {
        const path = document.querySelector<SVGPathElement>(`[data-testid="rf__edge-${id}"] path.react-flow__edge-path`)!;
        const p = path.getPointAtLength(path.getTotalLength() * 0.4);
        const s = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()!);
        return { x: s.x, y: s.y };
      }, id);

    // Toolbar alternative to double-click, with a multiline label.
    await clear();
    await page.getByRole('button', { name: 'Add Node' }).click();
    await expect(page.getByLabel('Node label')).toBeFocused();
    await page.keyboard.type('Line one');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('Line two');
    await page.keyboard.press('Enter');
    const added = byLabel((await backend(page)).document, 'Line one\nLine two');
    expect(added).toBeTruthy();
    await expect(nodeEl(page, added.id).locator('.concept-label')).toHaveText('Line one\nLine two');

    // Escape abandons an edit; dragging inside the editor selects text, never moves the node.
    await nodeEl(page, added.id).dblclick();
    const box = (await page.getByLabel('Node label').boundingBox())!;
    await drag(page, { x: box.x + 8, y: box.y + box.height / 2 }, { x: box.x + box.width - 8, y: box.y + box.height / 2 + 40 });
    await page.keyboard.type('discard me');
    await page.keyboard.press('Escape');
    const unchanged = byLabel((await backend(page)).document, 'Line one\nLine two');
    expect([unchanged.x, unchanged.y]).toEqual([added.x, added.y]);

    // Resize handles appear only on the selected node.
    await clear();
    await expect(page.locator('.react-flow__resize-control')).toHaveCount(0);
    await nodeEl(page, added.id).click();
    const corner = nodeEl(page, added.id).locator('.react-flow__resize-control.handle.bottom.right');
    const c = await center(page, `.react-flow__node[data-id="${added.id}"] .react-flow__resize-control.handle.bottom.right`);
    await expect(corner).toBeVisible();
    await drag(page, c, { x: c.x + 70, y: c.y + 30 });
    const resized = (await backend(page)).document.nodes.find((n) => n.id === added.id)!;
    expect(resized.width).toBeGreaterThan(added.width + 40);
    expect(resized.height).toBeGreaterThan(added.height + 15);

    // Delete, undo restores, redo deletes again.
    await page.keyboard.press('Delete');
    await expect(nodeEl(page, added.id)).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(nodeEl(page, added.id)).toHaveCount(1);
    await page.keyboard.press('Control+y');
    await expect(nodeEl(page, added.id)).toHaveCount(0);

    // Edge selection, deletion and restore.
    const [e1, e2] = (await backend(page)).document.edges;
    await clear();
    const m1 = await edgeMid(e1.id);
    await page.mouse.click(m1.x, m1.y);
    await expect(page.locator(`[data-testid="rf__edge-${e1.id}"].selected`)).toHaveCount(1);
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await backend(page)).document.edges.length).toBe(1);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await backend(page)).document.edges[0]).toEqual(e1);

    // Edge color, arrowheads and curve.
    await clear();
    const m2 = await edgeMid(e2.id);
    await page.mouse.click(m2.x, m2.y);
    await page.getByRole('button', { name: 'Color: #065f46' }).click();
    await page.getByRole('button', { name: 'both' }).click();
    await page.getByRole('button', { name: 'curved' }).click();
    await expect.poll(async () => (await backend(page)).document.edges[1].style).toEqual({ color: '#065f46', arrow: 'both', curve: 'curved' });

    // Copy/paste: new ids, internal connection preserved, then undo the paste.
    await clear();
    await nodeEl(page, ids.rq).click();
    await nodeEl(page, ids.ev).click({ modifiers: ['Control'] });
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect.poll(async () => (await backend(page)).document.nodes.length).toBe(5);
    const doc = (await backend(page)).document;
    const copies = doc.nodes.slice(3);
    expect(copies.map((n) => n.label)).toEqual(['Research Question', 'Evidence']);
    expect(copies.every((n) => !Object.values(ids).includes(n.id))).toBe(true);
    const copyEdge = doc.edges.at(-1)!;
    expect([copyEdge.source, copyEdge.target]).toEqual(copies.map((n) => n.id));
    expect(copyEdge.label).toBe('supports');
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await backend(page)).document.nodes.length).toBe(3);
    expect((await backend(page)).document.edges).toHaveLength(2);
    await clear();
  });

  await test.step('9-11. multi-selects, moves together, undo and redo as one step', async () => {
    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    await page.mouse.click(pane.x + pane.width / 2, pane.y + 20); // clear selection
    await nodeEl(page, ids.rq).click();
    await nodeEl(page, ids.co).click({ modifiers: ['Control'] });
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);

    const before = (await backend(page)).document;
    const c = await center(page, `.react-flow__node[data-id="${ids.co}"]`);
    await drag(page, c, { x: c.x - 60, y: c.y + 90 });
    const moved = (await backend(page)).document;
    const delta = (d: MapDocument, id: string) => {
      const n = d.nodes.find((x) => x.id === id)!;
      return [n.x, n.y];
    };
    const [rx0, ry0] = delta(before, ids.rq);
    const [rx1, ry1] = delta(moved, ids.rq);
    const [cx0, cy0] = delta(before, ids.co);
    const [cx1, cy1] = delta(moved, ids.co);
    expect(Math.abs(cx1 - cx0)).toBeGreaterThan(30);
    expect(rx1 - rx0).toBeCloseTo(cx1 - cx0, 6);
    expect(ry1 - ry0).toBeCloseTo(cy1 - cy0, 6);
    expect(delta(moved, ids.ev)).toEqual(delta(before, ids.ev));

    await page.mouse.click(pane.x + pane.width / 2, pane.y + 20);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => delta((await backend(page)).document, ids.co)).toEqual([cx0, cy0]);
    expect(delta((await backend(page)).document, ids.rq)).toEqual([rx0, ry0]);
    await page.keyboard.press('Control+y');
    await expect.poll(async () => delta((await backend(page)).document, ids.rq)).toEqual([rx1, ry1]);
    expect(delta((await backend(page)).document, ids.co)).toEqual([cx1, cy1]);
  });

  await test.step('rectangle selection selects multiple nodes', async () => {
    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    const boxes = await Promise.all(Object.values(ids).map(async (id) => (await nodeEl(page, id).boundingBox())!));
    const x0 = Math.min(...boxes.map((b) => b.x)) - 30;
    const y0 = Math.min(...boxes.map((b) => b.y)) - 30;
    const x1 = Math.max(...boxes.map((b) => b.x + b.width)) + 30;
    const y1 = Math.max(...boxes.map((b) => b.y + b.height)) + 30;
    await drag(page, { x: x0, y: y0 }, { x: x1, y: y1 });
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(3);
    await page.mouse.click(pane.x + pane.width / 2, pane.y + 20);
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(0);
  });

  await test.step('12. zoom and pan change only the viewport', async () => {
    const doc = (await backend(page)).document;
    const transform = () => page.locator('.react-flow__viewport').getAttribute('style');
    const t0 = await transform();
    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    const parse = (t: string | null) => {
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/.exec(t ?? '')!;
      return { x: Number(m[1]), y: Number(m[2]), k: Number(m[3]) };
    };
    const cursor = { x: pane.x + pane.width * 0.3, y: pane.y + pane.height * 0.4 };
    const flowAt = (v: { x: number; y: number; k: number }) => [(cursor.x - pane.x - v.x) / v.k, (cursor.y - pane.y - v.y) / v.k];
    await page.mouse.move(cursor.x, cursor.y);
    await page.mouse.wheel(0, -400);
    await expect.poll(transform).not.toBe(t0);
    await page.waitForTimeout(300);
    const t1 = await transform();
    const [v0, v1] = [parse(t0), parse(t1)];
    expect(v1.k).toBeGreaterThan(v0.k);
    const [fx0, fy0] = flowAt(v0);
    const [fx1, fy1] = flowAt(v1);
    expect(Math.abs(fx1 - fx0)).toBeLessThan(1); // the point under the cursor stays put
    expect(Math.abs(fy1 - fy0)).toBeLessThan(1);

    // Dragging and connecting still map correctly when zoomed.
    const ev0 = byLabel(doc, 'Evidence');
    const evc = await center(page, `.react-flow__node[data-id="${ids.ev}"]`);
    const sb0 = (await nodeEl(page, ids.ev).boundingBox())!;
    await drag(page, evc, { x: evc.x + 100, y: evc.y });
    const sb1 = (await nodeEl(page, ids.ev).boundingBox())!;
    const ev1 = byLabel((await backend(page)).document, 'Evidence');
    // The stored move equals the on-screen move divided by zoom. (React Flow ignores
    // pointer travel before its drag threshold, so the screen move is a bit under 100px.)
    expect(sb1.x - sb0.x).toBeGreaterThan(80);
    expect(ev1.x - ev0.x).toBeCloseTo((sb1.x - sb0.x) / v1.k, 0);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => byLabel((await backend(page)).document, 'Evidence').x).toBe(ev0.x);
    for (const sel of [`[data-id="${ids.rq}"] .react-flow__handle-right`, `[data-id="${ids.ev}"] .react-flow__handle-left`]) {
      const h = await center(page, `.react-flow__node${sel}`);
      expect(h.x > pane.x && h.x < pane.x + pane.width, `${sel} on screen`).toBe(true);
    }
    await connect(page, ids.rq, ids.ev);
    await expect.poll(async () => (await backend(page)).document.edges.length).toBe(3);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await backend(page)).document.edges.length).toBe(2);
    expect((await backend(page)).document).toEqual(doc);
    await drag(page, { x: pane.x + 40, y: pane.y + 40 }, { x: pane.x + 160, y: pane.y + 100 }, 'middle');
    await expect.poll(transform).not.toBe(t1);
    expect((await backend(page)).document).toEqual(doc);
    const t2 = await transform();
    await nodeEl(page, ids.co).click();
    await page.getByRole('button', { name: 'Zoom to Selection' }).click();
    await expect.poll(transform).not.toBe(t2);
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await page.waitForTimeout(400); // fit animation
    for (const id of Object.values(ids)) {
      const b = (await nodeEl(page, id).boundingBox())!;
      const inside = b.x >= pane.x && b.y >= pane.y && b.x + b.width <= pane.x + pane.width && b.y + b.height <= pane.y + pane.height;
      expect(inside, `${id} visible after Fit`).toBe(true);
    }
    await page.getByRole('button', { name: /^Theme:/ }).click(); // system -> light
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ path: join(shots, '12-fit-light.png') });
    await page.getByRole('button', { name: /^Theme:/ }).click(); // light -> dark
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await nodeEl(page, ids.ev).click();
    await page.screenshot({ path: join(shots, '12-fit-dark-selected.png') });
    await page.mouse.click(pane.x + pane.width / 2, pane.y + 20);
    await page.getByRole('button', { name: /^Theme:/ }).click(); // dark -> system
    expect((await backend(page)).document).toEqual(doc); // theme and selection are not document state
  });

  let saved: MapDocument;
  await test.step('13. saves the document', async () => {
    expect(await page.evaluate((p) => window.__vuecraft.saveAs(p), mapPath)).toBe(true);
    await expect(page.getByText('Unsaved changes')).toHaveCount(0);
    await expect(page.locator('.file-name')).toHaveText('research.vuecraft');
    saved = (await backend(page)).document;
    const onDisk = JSON.parse(readFileSync(mapPath, 'utf8'));
    expect(onDisk.format).toBe('vuecraft');
    expect(onDisk.schemaVersion).toBe(2); // current schema; R0 files (v1) still open
  });

  await test.step('14-15. closes, relaunches, reopens with everything preserved', async () => {
    await exitApp(page); // clean document: closes without a prompt
    page = await launch();
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
    await page.evaluate((p) => window.__vuecraft.open(p), mapPath);
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    const reopened = (await backend(page)).document;
    expect(reopened).toEqual(saved);
    await expect(page.locator('.edge-label', { hasText: 'supports' })).toBeVisible();
    await expect(page.getByText('Unsaved changes')).toHaveCount(0);
  });

  await test.step('16-17. exports SVG and it renders in an independent viewer', async () => {
    expect(await page.evaluate((p) => window.__vuecraft.exportSvg(p), svgPath)).toBe(true);
    expect((await backend(page)).dirty).toBe(false);
    const viewer = await chromium.launch({ channel: 'msedge' });
    const vpage = await viewer.newPage();
    await vpage.goto(pathToFileURL(svgPath).href);
    const info = await vpage.evaluate(() => {
      const svg = document.querySelector('svg')!;
      const r = svg.getBoundingClientRect();
      return { w: r.width, h: r.height, text: svg.textContent ?? '', nodes: svg.querySelectorAll('.node').length, edges: svg.querySelectorAll('.edge').length };
    });
    await vpage.screenshot({ path: join(shots, '17-exported-svg-in-edge.png') });
    await viewer.close();
    expect(info.nodes).toBe(3);
    expect(info.edges).toBe(2);
    expect(info.w).toBeGreaterThan(400);
    for (const word of ['Research', 'Evidence', 'Conclusion', 'supports']) expect(info.text).toContain(word);
  });

  await test.step('18. invalid documents are refused with a clear error', async () => {
    const garbage = join(dir, 'garbage.vuecraft');
    const dangling = join(dir, 'dangling.vuecraft');
    writeFileSync(garbage, '{ this is not json');
    writeFileSync(
      dangling,
      JSON.stringify({ format: 'vuecraft', schemaVersion: 1, nodes: [{ id: 'a', x: 0, y: 0, width: 50, height: 20 }], edges: [{ id: 'e', source: 'a', target: 'ghost' }] }),
    );
    for (const [file, msg] of [
      [garbage, 'not valid JSON'],
      [dangling, 'missing node ghost'],
    ]) {
      await page.evaluate((p) => window.__vuecraft.open(p), file);
      await expect(page.getByRole('alert')).toContainText(msg);
      await page.getByRole('button', { name: 'Dismiss error' }).click();
    }
    expect((await backend(page)).document).toEqual(saved);
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
  });

  await test.step('19. unsaved changes are protected on New and on window close', async () => {
    await createNode(page, 300, 450, 'Unsaved idea');
    await expect(page.getByText('Unsaved changes')).toBeVisible();

    await page.keyboard.press('Control+n');
    await expect(page.getByRole('dialog')).toContainText('Save changes to “research.vuecraft”?');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.concept-label', { hasText: 'Unsaved idea' })).toBeVisible();

    await requestClose(page);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.screenshot({ path: join(shots, '19-close-prompt.png') });
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(app!.exitCode).toBeNull();
    expect((await backend(page)).dirty).toBe(true);

    const exited = new Promise<number | null>((r) => app!.once('exit', r));
    await requestClose(page);
    await page.getByRole('button', { name: 'Don’t Save' }).click();
    await exited;
    app = null;
    await browser?.close().catch(() => {});
    browser = null;
    expect(JSON.parse(readFileSync(mapPath, 'utf8')).nodes).toHaveLength(3); // file untouched
  });
});

test('native file dialogs from the toolbar (Windows)', async () => {
  test.setTimeout(90_000); // waits on real native dialogs
  const page = await launch();
  // Never types a path: Cancel, or accept the app's default path (inside the temp dir).
  // Async with a hard timeout, so Playwright's own timeouts keep working.
  const dialog = async (accept = false) =>
    (
      await execFileAsync(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('tests/e2e/file-dialog.ps1'), '-ProcessId', String(app!.pid), ...(accept ? ['-Accept'] : [])],
        { encoding: 'utf8', timeout: 30_000 },
      )
    ).stdout.trim();
  const mapPath = join(dir, 'dialog.vuecraft');
  const svgPath = join(dir, 'dialog.svg');
  await createNode(page, 300, 200, 'Saved through dialog');

  // Cancelling Save As and Export leaves everything as it was.
  await page.getByRole('button', { name: 'Save As…' }).click();
  expect(await dialog()).toBe('Save As');
  await page.getByRole('button', { name: 'Export SVG…' }).click();
  expect(await dialog()).toBe('Save As');
  await expect(page.locator('.file-name')).toHaveText('Untitled');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  // With a current file, Export SVG defaults to the same folder; accepting writes there.
  await page.evaluate((p) => window.__vuecraft.saveAs(p), mapPath);
  await page.getByRole('button', { name: 'Export SVG…' }).click();
  expect(await dialog(true)).toBe('Save As');
  await expect.poll(() => existsSync(svgPath)).toBe(true);
  expect(readFileSync(svgPath, 'utf8')).toContain('Saved through');

  // Open: cancel keeps the document; accepting the default reloads the current file from disk.
  await page.getByRole('button', { name: 'Open…' }).click();
  expect(await dialog()).toBe('Open');
  const changed = JSON.parse(readFileSync(mapPath, 'utf8'));
  changed.nodes[0].label = 'Changed on disk';
  writeFileSync(mapPath, JSON.stringify(changed));
  await page.getByRole('button', { name: 'Open…' }).click();
  expect(await dialog(true)).toBe('Open');
  await expect(page.locator('.concept-label', { hasText: 'Changed on disk' })).toBeVisible();

  // Plain Save writes to the current file without a dialog.
  await page.locator('.react-flow__node').first().dblclick();
  await page.keyboard.type('Saved with Ctrl+S');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Unsaved changes')).toHaveCount(0);
  expect(JSON.parse(readFileSync(mapPath, 'utf8')).nodes[0].label).toBe('Saved with Ctrl+S');
  await exitApp(page);
});

test('R1.1 groups', async () => {
  let page = await launch();
  const mapPath = join(dir, 'groups.vuecraft');
  const svgPath = join(dir, 'groups.svg');
  const pane = (await page.locator('.react-flow__pane').boundingBox())!;
  const clear = () => page.mouse.click(pane.x + pane.width / 2, pane.y + 20);
  const doc = async () => (await backend(page)).document;
  const at = (d: MapDocument, label: string) => {
    const n = byLabel(d, label);
    return [n.x, n.y];
  };
  const group = (d: MapDocument) => d.nodes.find((n) => n.kind === 'group');

  await createNode(page, 220, 260, 'Alpha');
  await createNode(page, 470, 260, 'Beta');
  await createNode(page, 820, 260, 'Gamma');
  let d = await doc();
  const ids = { a: byLabel(d, 'Alpha').id, b: byLabel(d, 'Beta').id, c: byLabel(d, 'Gamma').id };
  await connect(page, ids.a, ids.b);
  await connect(page, ids.b, ids.c);
  await expect.poll(async () => (await doc()).edges.length).toBe(2);

  await test.step('grouping keeps members where they are', async () => {
    const before = await doc();
    const boxes = [(await nodeEl(page, ids.a).boundingBox())!, (await nodeEl(page, ids.b).boundingBox())!];
    await clear();
    await drag(page, { x: boxes[0].x - 30, y: boxes[0].y - 30 }, { x: boxes[1].x + boxes[1].width + 30, y: boxes[1].y + boxes[1].height + 30 });
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
    await page.keyboard.press('Control+g');
    await expect(page.locator('.react-flow__node-mapgroup')).toHaveCount(1);
    d = await doc();
    const g = group(d)!;
    expect(d.nodes.filter((n) => n.parent === g.id).map((n) => n.label).sort()).toEqual(['Alpha', 'Beta']);
    expect(byLabel(d, 'Gamma').parent).toBeUndefined();
    for (const l of ['Alpha', 'Beta', 'Gamma']) expect(at(d, l)).toEqual(at(before, l));
    // The visible group encloses its members.
    const gb = (await nodeEl(page, g.id).boundingBox())!;
    for (const id of [ids.a, ids.b]) {
      const b = (await nodeEl(page, id).boundingBox())!;
      expect(b.x > gb.x && b.y > gb.y && b.x + b.width < gb.x + gb.width && b.y + b.height < gb.y + gb.height).toBe(true);
    }
  });

  await test.step('dragging the group moves members; links follow; one undo step', async () => {
    const before = await doc();
    const g = group(before)!;
    const gb = (await nodeEl(page, g.id).boundingBox())!;
    await clear();
    await drag(page, { x: gb.x + gb.width / 2, y: gb.y + 10 }, { x: gb.x + gb.width / 2 + 60, y: gb.y + 90 });
    d = await doc();
    const [dx, dy] = [byLabel(d, 'Alpha').x - byLabel(before, 'Alpha').x, byLabel(d, 'Alpha').y - byLabel(before, 'Alpha').y];
    expect(dx).toBeGreaterThan(30);
    expect(dy).toBeGreaterThan(30);
    expect(at(d, 'Beta')).toEqual([byLabel(before, 'Beta').x + dx, byLabel(before, 'Beta').y + dy]);
    expect(at(d, 'Gamma')).toEqual(at(before, 'Gamma'));
    const { boxes, edges } = await edgesAttached(page);
    for (const e of edges) {
      const edge = d.edges.find((x) => e.id.endsWith(x.id))!;
      expect(onOutline(e.ends[0], boxes[edge.source]) && onOutline(e.ends[1], boxes[edge.target]), `edge ${edge.id}`).toBe(true);
    }
    await page.keyboard.press('Control+z');
    await expect.poll(async () => at(await doc(), 'Alpha')).toEqual(at(before, 'Alpha'));
    expect(await doc()).toEqual(before);
    await page.keyboard.press('Control+y');
    await expect.poll(async () => at(await doc(), 'Beta')).toEqual(at(d, 'Beta'));
  });

  await test.step('moving a member refits the group around it', async () => {
    const before = await doc();
    const c = await center(page, `.react-flow__node[data-id="${ids.b}"]`);
    await clear();
    await drag(page, c, { x: c.x + 160, y: c.y + 60 });
    d = await doc();
    expect(byLabel(d, 'Beta').x).toBeGreaterThan(byLabel(before, 'Beta').x + 100);
    expect(at(d, 'Alpha')).toEqual(at(before, 'Alpha'));
    expect(group(d)!.width).toBeGreaterThan(group(before)!.width + 100);
    const g = group(d)!;
    const beta = byLabel(d, 'Beta');
    expect(beta.x + beta.width).toBeLessThanOrEqual(g.x + g.width);
    expect(beta.y + beta.height).toBeLessThanOrEqual(g.y + g.height);
  });

  await test.step('renames the group', async () => {
    const g = group(await doc())!;
    const gb = (await nodeEl(page, g.id).boundingBox())!;
    await page.mouse.dblclick(gb.x + 30, gb.y + 16);
    await expect(page.getByLabel('Group label')).toBeFocused();
    await page.keyboard.type('Cluster');
    await page.keyboard.press('Enter');
    await expect(page.locator('.map-group-title', { hasText: 'Cluster' })).toBeVisible();
    expect(group(await doc())!.label).toBe('Cluster');
  });

  await test.step('nesting is rejected with an explanation', async () => {
    const before = await doc();
    const g = group(before)!;
    await clear();
    const gb = (await nodeEl(page, g.id).boundingBox())!;
    await page.mouse.click(gb.x + 10, gb.y + 6);
    await nodeEl(page, ids.c).click({ modifiers: ['Control'] });
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
    await page.keyboard.press('Control+g');
    await expect(page.getByRole('alert')).toContainText('cannot be nested');
    await page.getByRole('button', { name: 'Dismiss error' }).click();
    expect(await doc()).toEqual(before);
  });

  await test.step('membership and geometry survive save and reopen', async () => {
    expect(await page.evaluate((p) => window.__vuecraft.saveAs(p), mapPath)).toBe(true);
    const saved = await doc();
    await exitApp(page);
    page = await launch();
    await page.evaluate((p) => window.__vuecraft.open(p), mapPath);
    await expect(page.locator('.react-flow__node-mapgroup')).toHaveCount(1);
    expect(await doc()).toEqual(saved);
    expect(JSON.parse(readFileSync(mapPath, 'utf8')).schemaVersion).toBe(2);
  });

  await test.step('ungroup keeps positions, ids and links; undo restores the group', async () => {
    const before = await doc();
    const g = group(before)!;
    const gb = (await nodeEl(page, g.id).boundingBox())!;
    await page.mouse.click(gb.x + 10, gb.y + 6);
    await page.keyboard.press('Control+Shift+g');
    await expect(page.locator('.react-flow__node-mapgroup')).toHaveCount(0);
    d = await doc();
    expect(d.nodes.map((n) => n.id).sort()).toEqual(Object.values(ids).sort());
    for (const l of ['Alpha', 'Beta', 'Gamma']) expect(at(d, l)).toEqual(at(before, l));
    expect(d.edges).toEqual(before.edges);
    await page.keyboard.press('Control+z');
    await expect(page.locator('.react-flow__node-mapgroup')).toHaveCount(1);
    expect(await doc()).toEqual(before);
  });

  await test.step('deleting a group keeps its contents; export draws it', async () => {
    const before = await doc();
    const g = group(before)!;
    expect(await page.evaluate((p) => window.__vuecraft.exportSvg(p), svgPath)).toBe(true);
    const svg = readFileSync(svgPath, 'utf8');
    expect(svg).toContain('class="group"');
    expect(svg).toContain('Cluster');
    await clear();
    const gb = (await nodeEl(page, g.id).boundingBox())!;
    await page.mouse.click(gb.x + 10, gb.y + 6);
    await page.keyboard.press('Delete');
    await expect(page.locator('.react-flow__node-mapgroup')).toHaveCount(0);
    d = await doc();
    expect(d.nodes).toHaveLength(3);
    expect(d.edges).toHaveLength(2);
    await page.keyboard.press('Control+z');
    await expect(page.locator('.react-flow__node-mapgroup')).toHaveCount(1);
  });

  await page.evaluate((p) => window.__vuecraft.saveAs(p), mapPath);
  await exitApp(page);
});

test('R1.2 layers', async () => {
  let page = await launch();
  const mapPath = join(dir, 'layers.vuecraft');
  const svgPath = join(dir, 'layers.svg');
  const pane = (await page.locator('.react-flow__pane').boundingBox())!;
  const clear = () => page.mouse.click(pane.x + pane.width / 2, pane.y + 20);
  const doc = async () => (await backend(page)).document;
  const tab = (name: 'Layers' | 'Inspect') => page.getByRole('tab', { name }).click();
  const btn = (name: string) => page.getByRole('button', { name, exact: true });

  await createNode(page, 220, 260, 'Base A');
  await createNode(page, 470, 260, 'Base B');
  await tab('Layers');
  await btn('Add Layer').click();
  await expect(page.locator('.layers li')).toHaveCount(2);
  await expect(page.locator('.layers li.active .layer-name')).toHaveText('Layer 2');
  await createNode(page, 720, 260, 'Top C');
  let d = await doc();
  const [l1, l2] = d.layers.map((l) => l.id);
  const ids = { a: byLabel(d, 'Base A').id, b: byLabel(d, 'Base B').id, c: byLabel(d, 'Top C').id };
  await connect(page, ids.b, ids.c);
  await expect.poll(async () => (await doc()).edges.length).toBe(1);
  d = await doc();
  expect([byLabel(d, 'Base A').layer, byLabel(d, 'Top C').layer, d.edges[0].layer]).toEqual([l1, l2, l2]);

  await test.step('hiding a layer hides its content and links that touch it', async () => {
    await btn('Hide Layer 2').click();
    await expect(page.locator('.react-flow__node')).toHaveCount(2);
    await expect(page.locator('.react-flow__edge')).toHaveCount(0);
    await clear();
    await drag(page, { x: pane.x + 10, y: pane.y + 40 }, { x: pane.x + pane.width - 230, y: pane.y + pane.height - 180 });
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
    await clear();
    await btn('Show Layer 2').click();
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  });

  await test.step('locking blocks moves, edits, deletion and new content', async () => {
    await btn('Lock Layer 1').click();
    const before = await doc();
    const c = await center(page, `.react-flow__node[data-id="${ids.a}"]`);
    await drag(page, c, { x: c.x + 80, y: c.y + 80 });
    await nodeEl(page, ids.a).click();
    await page.keyboard.press('Delete');
    await expect(page.getByRole('alert')).toContainText('locked');
    await btn('Dismiss error').click();
    await nodeEl(page, ids.a).dblclick();
    await expect(page.getByLabel('Node label')).toHaveCount(0);
    await tab('Inspect');
    await expect(page.locator('.notice')).toContainText('locked layer');
    await expect(btn('ellipse')).toBeDisabled();
    expect(await doc()).toEqual(before);
    await tab('Layers');
    await page.locator('.layer-name', { hasText: 'Layer 1' }).click();
    await page.mouse.dblclick(pane.x + 300, pane.y + 500);
    await expect(page.getByRole('alert')).toContainText('is locked');
    await btn('Dismiss error').click();
    expect((await doc()).nodes).toHaveLength(3);
    await btn('Unlock Layer 1').click();
    await page.locator('.layer-name', { hasText: 'Layer 2' }).click();
  });

  await test.step('move selection, rename and reorder layers, all undoable', async () => {
    const before = await doc();
    await clear();
    await nodeEl(page, ids.c).click();
    await btn('Move selection to Layer 1').click();
    await expect.poll(async () => byLabel(await doc(), 'Top C').layer).toBe(l1);
    await page.locator('.layer-name', { hasText: 'Layer 2' }).dblclick();
    await expect(page.getByLabel('Layer name')).toBeFocused();
    await page.keyboard.type('Notes');
    await page.keyboard.press('Enter');
    await expect(page.locator('.layer-name', { hasText: 'Notes' })).toBeVisible();
    await btn('Lower Notes').click();
    await expect.poll(async () => (await doc()).layers.map((l) => l.name)).toEqual(['Notes', 'Layer 1']);
    await clear();
    for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
    await expect.poll(doc).toEqual(before);
  });

  await test.step('grouping across layers moves members onto one layer', async () => {
    const before = await doc();
    await clear();
    await nodeEl(page, ids.a).click();
    await nodeEl(page, ids.c).click({ modifiers: ['Control'] });
    await page.keyboard.press('Control+g');
    await expect(page.locator('.react-flow__node-mapgroup')).toHaveCount(1);
    d = await doc();
    const g = d.nodes.find((n) => n.kind === 'group')!;
    expect([g.layer, byLabel(d, 'Base A').layer, byLabel(d, 'Top C').layer]).toEqual([l1, l1, l1]);
    await page.keyboard.press('Control+z');
    await expect.poll(doc).toEqual(before);
  });

  await test.step('deleting a layer moves its contents after confirmation', async () => {
    const before = await doc();
    await btn('Delete Layer 2').click();
    await expect(page.getByRole('dialog')).toContainText('Its 2 items will move to “Layer 1”');
    await btn('Delete Layer').click();
    await expect(page.locator('.layers li')).toHaveCount(1);
    d = await doc();
    expect([byLabel(d, 'Top C').layer, d.edges[0].layer]).toEqual([l1, l1]);
    await clear();
    await page.keyboard.press('Control+z');
    await expect.poll(doc).toEqual(before);
  });

  await test.step('layer state persists; export skips hidden layers', async () => {
    await btn('Hide Layer 2').click();
    await btn('Lock Layer 1').click();
    expect(await page.evaluate((p) => window.__vuecraft.saveAs(p), mapPath)).toBe(true);
    const saved = await doc();
    await exitApp(page);
    page = await launch();
    await page.evaluate((p) => window.__vuecraft.open(p), mapPath);
    await expect.poll(doc).toEqual(saved);
    await expect(page.locator('.react-flow__node')).toHaveCount(2);
    await tab('Layers');
    await expect(btn('Show Layer 2')).toBeVisible();
    await expect(btn('Unlock Layer 1')).toBeVisible();
    await page.screenshot({ path: join(shots, 'r12-layers.png') });
    expect(await page.evaluate((p) => window.__vuecraft.exportSvg(p), svgPath)).toBe(true);
    const svg = readFileSync(svgPath, 'utf8');
    expect(svg).toContain('Base A');
    expect(svg).not.toContain('Top C');
    expect(svg).not.toContain('class="edge"');
  });

  await exitApp(page);
});

test('R1.3 rich text', async () => {
  let page = await launch();
  const mapPath = join(dir, 'rich.vuecraft');
  const svgPath = join(dir, 'rich.svg');
  const pane = (await page.locator('.react-flow__pane').boundingBox())!;
  const clear = () => page.mouse.click(pane.x + pane.width / 2, pane.y + 20);
  const doc = async () => (await backend(page)).document;
  const btn = (name: string) => page.getByRole('button', { name, exact: true });
  await createNode(page, 360, 300, 'Plain start');
  const id = byLabel(await doc(), 'Plain start').id;
  const node = () => nodeEl(page, id);
  const text = async () => (await doc()).nodes.find((n) => n.id === id)!;
  const edit = async () => {
    await node().dblclick();
    await expect(page.getByLabel('Node label')).toBeFocused();
  };

  await test.step('bold, line break and a link via shortcuts and the format bar', async () => {
    await edit();
    await page.keyboard.type('Claim ');
    await page.keyboard.press('Control+b');
    await page.keyboard.type('strong');
    await page.keyboard.press('Control+b');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('see source');
    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowLeft');
    await btn('Link').click();
    const address = page.getByLabel('Link address');
    await expect(address).toBeFocused();
    await address.fill('https://example.org/paper');
    await address.press('Enter');
    await expect(page.getByLabel('Node label')).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Node label')).toHaveCount(0);
    const n = await text();
    expect(n.label).toBe('Claim strong\nsee source');
    const inline = n.text!.content![0].content!;
    expect(inline.find((t) => t.text === 'strong')!.marks).toEqual([{ type: 'bold' }]);
    expect(inline.find((t) => t.text === 'source')!.marks).toEqual([{ type: 'link', attrs: { href: 'https://example.org/paper' } }]);
    await expect(node().locator('.concept-label.rich strong')).toHaveText('strong');
    await expect(node().locator('.rich-link')).toHaveAttribute('title', 'https://example.org/paper');
    await expect(node().locator('a')).toHaveCount(0);
  });

  await test.step('lists: Enter adds an item; clicking away commits; one undo step', async () => {
    const before = await doc();
    await edit();
    await btn('Bulleted list').click();
    // The editor opens with everything selected; click into the last item to place the caret.
    await page.locator('[aria-label="Node label"] li').last().click();
    await page.keyboard.press('End');
    // ProseMirror syncs browser caret moves on the async selectionchange event; pause like a person would.
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.keyboard.type('second point');
    await expect(page.getByLabel('Node label')).toBeFocused();
    await clear();
    await expect(page.getByLabel('Node label')).toHaveCount(0);
    const n = await text();
    expect(n.text!.content![0].type).toBe('bulletList');
    expect(n.label.split('\n')).toEqual(['• Claim strong', '  see source', '• second point']);
    await expect(node().locator('.concept-label li')).toHaveCount(2);
    await page.keyboard.press('Control+z');
    await expect.poll(doc).toEqual(before);
    await page.keyboard.press('Control+y');
    await expect.poll(async () => (await text()).label).toContain('• second point');
  });

  await test.step('unsafe links are refused; Escape cancels the edit', async () => {
    const before = await doc();
    await edit();
    await btn('Link').click();
    await page.getByLabel('Link address').fill('javascript:alert(1)');
    await page.getByLabel('Link address').press('Enter');
    await expect(page.getByLabel('Link address')).toHaveAttribute('aria-invalid', 'true');
    await page.getByLabel('Link address').press('Escape');
    await expect(page.getByLabel('Node label')).toBeFocused(); // focus returns on the next frame
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Node label')).toHaveCount(0);
    expect(await doc()).toEqual(before);
  });

  await test.step('pasted markup keeps formatting and drops scripts and images', async () => {
    await edit();
    await page.evaluate(() => {
      const target = document.querySelector('[aria-label="Node label"]')!;
      const data = new DataTransfer();
      data.setData('text/html', '<b>Pasted</b> text<script>window.__pwned = 1</script><img src="x" onerror="window.__pwned = 2">');
      data.setData('text/plain', 'Pasted text');
      target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    // The content is a list here, where Enter adds an item; clicking away commits.
    await clear();
    await expect(page.getByLabel('Node label')).toHaveCount(0);
    const n = await text();
    expect(n.label).toContain('Pasted text');
    const json = JSON.stringify(n.text);
    expect(json).not.toMatch(/script|img|onerror|tracker/);
    expect(json).toContain('{"type":"text","text":"Pasted","marks":[{"type":"bold"}]}');
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  await test.step('formatted text persists; export shows its text; links never navigate', async () => {
    await page.keyboard.press('Control+z'); // back to the list version
    await expect.poll(async () => (await text()).label).toContain('• second point');
    const url = page.url();
    await node().locator('.rich-link').click();
    expect(page.url()).toBe(url);
    expect(await page.evaluate((p) => window.__vuecraft.saveAs(p), mapPath)).toBe(true);
    const saved = await doc();
    await exitApp(page);
    page = await launch();
    await page.evaluate((p) => window.__vuecraft.open(p), mapPath);
    await expect.poll(doc).toEqual(saved);
    await expect(nodeEl(page, id).locator('.concept-label li')).toHaveCount(2);
    expect(await page.evaluate((p) => window.__vuecraft.exportSvg(p), svgPath)).toBe(true);
    const svg = readFileSync(svgPath, 'utf8');
    expect(svg).toContain('second point');
    expect(svg).toContain('• Claim');
    expect(svg).not.toMatch(/<a |<script|javascript:/);
  });

  await exitApp(page);
});

test('R1.4 attachments and images', async () => {
  let page = await launch();
  const mapPath = join(dir, 'attach.vuecraft');
  const svgPath = join(dir, 'attach.svg');
  const photo = join(dir, 'photo.png');
  const notes = join(dir, 'notes.txt');
  // 1x1 PNG, a text file posing as one, and a plain document to reference.
  writeFileSync(photo, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'));
  writeFileSync(join(dir, 'fake.png'), '<svg onload="alert(1)"/>');
  writeFileSync(notes, 'notes');
  const doc = async () => (await backend(page)).document;
  const btn = (name: string) => page.getByRole('button', { name, exact: true });
  const queue = (p: string) => page.evaluate((path) => window.__vuecraft.queueFile(path), p);
  await createNode(page, 360, 300, 'Evidence');
  const id = byLabel(await doc(), 'Evidence').id;
  const node = () => nodeEl(page, id);
  const data = async () => (await doc()).nodes.find((n) => n.id === id)!;
  await node().click();

  await test.step('links are validated; files are referenced, and missing ones flagged', async () => {
    const address = page.getByLabel('Attachment address');
    await address.fill('javascript:alert(1)');
    await address.press('Enter');
    await expect(address).toHaveAttribute('aria-invalid', 'true');
    await address.fill('https://example.org/paper');
    await address.press('Enter');
    await queue(notes);
    await btn('Attach File…').click();
    await queue(join(dir, 'gone.pdf'));
    await btn('Attach File…').click();
    await expect.poll(async () => (await data()).resources).toEqual([
      { kind: 'url', target: 'https://example.org/paper' },
      { kind: 'file', target: notes },
      { kind: 'file', target: join(dir, 'gone.pdf') },
    ]);
    await expect(page.locator('.attachments li').nth(2).getByText('File not found')).toBeVisible();
    await expect(page.locator('.attachments li').nth(1).getByText('File not found')).toHaveCount(0);
    // Opening asks first. (Cancelled here: confirming would launch the browser on this desktop.)
    await btn('Open https://example.org/paper').click();
    await expect(page.getByRole('dialog')).toContainText('Open https://example.org/paper in your web browser?');
    await btn('Cancel').click();
    await btn(`Remove ${join(dir, 'gone.pdf')}`).click();
    await expect.poll(async () => (await data()).resources?.length).toBe(2);
  });

  await test.step('images are checked by content, embedded, shown, and undoable', async () => {
    await queue(join(dir, 'fake.png'));
    await btn('Insert Image…').click();
    await expect(page.getByRole('alert')).toContainText('not a PNG, JPEG, GIF or WebP image');
    await queue(photo);
    await btn('Insert Image…').click();
    await expect(node().locator('img.concept-image')).toHaveAttribute('src', /^data:image\/png;base64,iVBOR/);
    const n = await data();
    expect([n.image?.length, n.height]).toEqual([64, 140]);
    expect((await backend(page)).images).toEqual([n.image]);
    await page.keyboard.press('Control+z');
    await expect(node().locator('img')).toHaveCount(0);
    await page.keyboard.press('Control+y');
    await expect(node().locator('img.concept-image')).toBeVisible();
  });

  await test.step('copies share the image; it is saved once and survives reopening', async () => {
    await node().click();
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect(page.locator('img.concept-image')).toHaveCount(2);
    expect(await page.evaluate((p) => window.__vuecraft.saveAs(p), mapPath)).toBe(true);
    const file = JSON.parse(readFileSync(mapPath, 'utf8')) as MapDocument & { assets: Record<string, { mime: string }> };
    const image = (await data()).image!;
    expect(Object.keys(file.assets)).toEqual([image]);
    expect(file.assets[image].mime).toBe('image/png');
    const saved = await doc();
    await exitApp(page);
    page = await launch();
    await page.evaluate((p) => window.__vuecraft.open(p), mapPath);
    await expect.poll(doc).toEqual(saved);
    await expect(page.locator('img.concept-image')).toHaveCount(2);
    expect(await page.evaluate((p) => window.__vuecraft.exportSvg(p), svgPath)).toBe(true);
    const svg = readFileSync(svgPath, 'utf8');
    expect(svg.match(/<image [^>]*href="data:image\/png;base64,/g)).toHaveLength(2);
    expect(svg).not.toMatch(/<script|javascript:|file:/);
  });

  await test.step('an image no node shows any more is not saved', async () => {
    const copy = (await doc()).nodes.find((n) => n.id !== id)!.id;
    await nodeEl(page, copy).click();
    await page.keyboard.press('Delete');
    await expect(page.locator('img.concept-image')).toHaveCount(1);
    await node().click();
    await btn('Remove Image').click();
    await expect(page.locator('img.concept-image')).toHaveCount(0);
    expect(await page.evaluate((p) => window.__vuecraft.saveAs(p), mapPath)).toBe(true);
    const file = JSON.parse(readFileSync(mapPath, 'utf8'));
    expect(file.assets).toBeUndefined();
    expect(file.nodes.map((n: { label: string }) => n.label)).toEqual(['Evidence']);
  });

  await exitApp(page);
});
