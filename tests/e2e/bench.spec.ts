// Desktop benchmark (opt-in): VUECRAFT_BENCH_DIR=<dir with bench-*.vuecraft> pnpm test:e2e bench
// Generate the maps first: cargo run --release -p map-core --example bench -- <dir>
import { chromium, expect, test } from '@playwright/test';
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const EXE = process.env.VUECRAFT_EXE ?? resolve('target/debug/vuecraft.exe');
// The app window may sit behind other windows while tests run; without these flags
// WebView2 pauses animation frames and throttles timers for occluded windows.
// (Setting this variable replaces wry's own --disable-features list, so it is repeated.)
const NO_THROTTLE = [
  '--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
].join(' ');
const DIR = process.env.VUECRAFT_BENCH_DIR;

test.skip(!DIR || process.platform !== 'win32' || !existsSync(EXE), 'set VUECRAFT_BENCH_DIR and build the app');

test('desktop responsiveness on 100/500/1000-node maps', async () => {
  const results: Record<string, number | string>[] = [];
  for (const n of [100, 500, 1000]) {
    const app = spawn(EXE, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `${NO_THROTTLE} --remote-debugging-port=9335` }, stdio: 'ignore' });
    let browser;
    for (let i = 0; i < 150 && !browser; i++) {
      try {
        browser = await chromium.connectOverCDP('http://127.0.0.1:9335');
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    const page = browser!.contexts()[0].pages()[0];
    await page.waitForSelector('.react-flow__pane');
    await page.evaluate(() => addEventListener('mousemove', () => (window.__inputReady = true), { once: true }));
    for (let i = 0; i < 50 && !(await page.evaluate(() => window.__inputReady)); i++) {
      await page.mouse.move(600 + i, 20);
      await page.waitForTimeout(100);
    }

    // Open: IPC + Rust parse + React Flow render of all nodes.
    const file = join(DIR!, `bench-${n}.vuecraft`);
    const t0 = Date.now();
    await page.evaluate((p) => window.__vuecraft.open(p), file);
    await expect(page.locator('.react-flow__node')).toHaveCount(n, { timeout: 60_000 });
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__edge').length > 0);
    const openMs = Date.now() - t0;

    // Drag one node across 60 pointer moves while counting animation frames.
    const node = (await page.locator('.react-flow__node').first().boundingBox())!;
    await page.evaluate(() => {
      const w = window;
      w.__frames = [];
      const tick = (t: number) => {
        w.__frames.push(t);
        if (w.__frames.length < 100000) w.__raf = requestAnimationFrame(tick);
      };
      w.__raf = requestAnimationFrame(tick);
    });
    const d0 = Date.now();
    await page.mouse.move(node.x + 20, node.y + 20);
    await page.mouse.down();
    for (let i = 1; i <= 60; i++) await page.mouse.move(node.x + 20 + i * 4, node.y + 20 + i * 2);
    await page.mouse.up();
    const dragMs = Date.now() - d0;
    const frames = await page.evaluate(() => {
      const w = window;
      cancelAnimationFrame(w.__raf);
      const f: number[] = w.__frames;
      const gaps = f.slice(1).map((t, i) => t - f[i]);
      gaps.sort((a, b) => a - b);
      return { count: f.length, p95: gaps[Math.floor(gaps.length * 0.95)] ?? 0, max: gaps.at(-1) ?? 0 };
    });

    // Zoom out and back.
    const z0 = Date.now();
    await page.mouse.move(500, 400);
    for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 120);
    for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -120);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    const zoomMs = Date.now() - z0;

    const e0 = Date.now();
    const svgPath = join(DIR!, `bench-${n}.svg`);
    expect(await page.evaluate((p) => window.__vuecraft.exportSvg(p), svgPath)).toBe(true);
    const exportMs = Date.now() - e0;

    // Chromium-only, non-standard: used JS heap of the page.
    const heapMb = (await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0)) / 2 ** 20;
    const wsKb = Number(
      execSync(`powershell -NoProfile -Command "(Get-Process -Id ${app.pid}).WorkingSet64 / 1KB"`, { encoding: 'utf8' }).trim(),
    );

    results.push({
      nodes: n,
      openMs,
      dragMs,
      dragFrames: frames.count,
      frameGapP95Ms: Math.round(frames.p95 * 10) / 10,
      frameGapMaxMs: Math.round(frames.max * 10) / 10,
      zoom20WheelMs: zoomMs,
      exportSvgMs: exportMs,
      jsHeapMb: Math.round(heapMb * 10) / 10,
      shellWorkingSetMb: Math.round(wsKb / 102.4) / 10,
    });
    await browser!.close().catch(() => {});
    app.kill();
    await new Promise((r) => setTimeout(r, 500));
  }
  console.table(results);
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/bench.json', JSON.stringify(results, null, 2));
});
