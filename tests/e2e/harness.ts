// Launching, isolating, preflighting and diagnosing the real desktop app for the E2E suite.
// Each launch gets its own WebView2 profile and DevTools port, logs IPC to a file
// (VUECRAFT_LOG), and is torn down with its whole process tree. On failure,
// collectDiagnostics() records evidence that separates page, IPC, backend, DevTools,
// window and process problems.
import { chromium, type Browser, type Page, type TestInfo } from '@playwright/test';
import { execFile, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

export const EXE = process.env.VUECRAFT_EXE ?? resolve('target/debug/vuecraft.exe');
// The app window may sit behind other windows while tests run; without these flags
// WebView2 pauses animation frames and throttles timers for occluded windows.
// (Setting this variable replaces wry's own --disable-features list, so it is repeated.)
export const NO_THROTTLE = [
  '--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
].join(' ');
const execFileAsync = promisify(execFile);
const PORT_BASE = 9400 + Math.floor(Math.random() * 400);
const READY_MS = 15_000;
// Healthy sessions answered DevTools round trips with p99 < 50 ms and max 193 ms (R0 x10,
// 2026-11-09). Degraded ones answer after quantized ~0.31 / 0.9 / 2.1 / 4.5 s delays from the
// first command on. One round trip over 750 ms, or three over 250 ms, marks a degraded session.
const PREFLIGHT_LIMIT_MS = 750;
const PREFLIGHT_SLOW_MS = 250;
let launches = 0;

export interface Launched {
  proc: ChildProcess;
  browser: Browser;
  page: Page;
  port: number;
  profile: string;
  log: string;
  startedAt: number;
  exit: { code: number | null; signal: string | null; afterMs: number } | null;
  events: string[];
}

/** Path, size, time and SHA-256 of the binary under test. */
export function buildIdentity() {
  if (!existsSync(EXE)) return { exe: EXE, missing: true };
  const st = statSync(EXE);
  return { exe: EXE, bytes: st.size, modified: st.mtime.toISOString(), sha256: createHash('sha256').update(readFileSync(EXE)).digest('hex') };
}

/**
 * One desktop run at a time: two runs would fight over windows and Playwright's
 * shared output folder. Returns a release function.
 */
export function acquireDesktopLock(): () => void {
  mkdirSync(resolve('target'), { recursive: true });
  const lock = resolve('target/desktop-e2e.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lock, 'wx');
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return () => {
        try {
          unlinkSync(lock);
        } catch {
          // already gone
        }
      };
    } catch {
      const owner = Number(readFileSync(lock, 'utf8'));
      let alive: boolean;
      try {
        process.kill(owner, 0);
        alive = owner !== process.pid;
      } catch {
        alive = false;
      }
      if (alive) throw new Error(`another desktop E2E run (pid ${owner}) is active; run one at a time (lock: ${lock})`);
      unlinkSync(lock); // stale lock from a run that died
    }
  }
  throw new Error(`could not take ${lock}`);
}

/** Ends the app and every WebView2 process it started. */
export function killTree(proc: ChildProcess | null | undefined) {
  if (!proc?.pid || proc.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  else proc.kill('SIGKILL');
}

export async function launchApp(runDir: string): Promise<Launched> {
  const n = launches++;
  const port = PORT_BASE + n;
  const profile = join(runDir, `profile-${n}`);
  const log = join(runDir, `app-${n}.log`);
  const logFd = openSync(log, 'w');
  const proc = spawn(EXE, [], {
    env: {
      ...process.env,
      VUECRAFT_TEST_SEAM: '1',
      // App IPC logging is opt-in until its effect on timing is understood.
      ...(process.env.VUECRAFT_E2E_LOG ? { VUECRAFT_LOG: '1' } : {}),
      WEBVIEW2_USER_DATA_FOLDER: profile,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `${NO_THROTTLE} --remote-debugging-port=${port}`,
    },
    // A file handle, not a pipe: with a pipe, the app's main thread blocks on each log
    // write until this process reads it, which measurably delayed DevTools commands.
    stdio: ['ignore', logFd, logFd],
  });
  closeSync(logFd);
  const startedAt = Date.now();
  const l = { proc, port, profile, log, startedAt, exit: null, events: [] } as unknown as Launched;
  proc.once('exit', (code, signal) => {
    l.exit = { code, signal, afterMs: Date.now() - startedAt };
    console.log(`[app exit] pid=${proc.pid} code=${code} signal=${signal} after ${l.exit.afterMs}ms`);
  });
  let browser: Browser | null = null;
  for (let i = 0; i < 150 && !browser && !l.exit; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (!browser) throw new Error(`could not connect to the app over DevTools on port ${port} (exit: ${JSON.stringify(l.exit)})`);
  const note = (e: string) => {
    l.events.push(`${Date.now() - startedAt}ms ${e}`);
    if (l.events.length > 200) l.events.shift();
  };
  browser.on('disconnected', () => note('devtools disconnected'));
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] ?? (await ctx.waitForEvent('page'));
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && note(`console.${m.type()}: ${m.text().slice(0, 300)}`));
  page.on('pageerror', (e) => note(`pageerror: ${e.message.slice(0, 300)}`));
  page.on('crash', () => note('page crashed'));
  page.on('close', () => note('page closed'));
  Object.assign(l, { browser, page });
  await page.waitForSelector('.react-flow__pane', { timeout: READY_MS });
  // Background windows get little rendering time while the desktop is in use.
  await page.bringToFront().catch(() => {});
  await page.waitForSelector('.app[data-ready]', { timeout: READY_MS }); // first document snapshot loaded
  await page.waitForFunction(() => 'open' in ((window as unknown as { __vuecraft?: object }).__vuecraft ?? {}), undefined, { timeout: READY_MS });
  // Right after startup WebView2 can drop injected input; wait until a mouse event lands.
  await page.evaluate(() => addEventListener('mousemove', () => (window.__inputReady = true), { once: true }));
  for (let i = 0; i < 50 && !(await page.evaluate(() => window.__inputReady)); i++) {
    await page.mouse.move(600 + i, 20);
    await page.waitForTimeout(100);
  }
  return l;
}

/**
 * Fails within seconds when the DevTools channel is degraded (see docs/FEATURE_MATRIX.md,
 * Known defects) instead of letting a test run into its timeout. Call after launchApp, once
 * the instance is recorded, so failure diagnostics describe this instance.
 */
export async function preflight(l: Launched) {
  const probes: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    await (i % 2 ? l.page.mouse.move(640 + i, 60) : l.page.evaluate(() => 1));
    probes.push(Math.round(performance.now() - t0));
    if (probes[i] > PREFLIGHT_LIMIT_MS || probes.filter((p) => p > PREFLIGHT_SLOW_MS).length >= 3)
      throw new Error(
        `E2E infrastructure: WebView2 DevTools degraded at launch; round trips so far: ${probes.join(', ')} ms (limits: one over ${PREFLIGHT_LIMIT_MS} ms or three over ${PREFLIGHT_SLOW_MS} ms). The app was not exercised.`,
      );
  }
}

/** Resolves to the value or a marker after ms; never throws. */
async function within<T>(ms: number, p: Promise<T>): Promise<T | { failed: string }> {
  return Promise.race([
    p.catch((e: Error) => ({ failed: e.message.split('\n')[0] })),
    new Promise<{ failed: string }>((r) => setTimeout(() => r({ failed: `no answer within ${ms} ms` }), ms)),
  ]);
}

const ps = async (script: string, ...args: string[]) => {
  const r = await within(20000, execFileAsync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('tests/e2e/diag', script), ...args], { encoding: 'utf8' }));
  if ('failed' in r) return r;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { failed: r.stdout.slice(0, 200) };
  }
};

/** Evidence about a failed test's app instance, saved next to the test's results. */
export async function collectDiagnostics(l: Launched | null, testInfo: TestInfo) {
  const d: Record<string, unknown> = {
    test: testInfo.titlePath.join(' > '),
    retry: testInfo.retry,
    status: testInfo.status,
    error: testInfo.error?.message?.split('\n')[0],
    at: new Date().toISOString(),
    build: buildIdentity(),
  };
  if (l) {
    d.launch = { pid: l.proc.pid, port: l.port, profile: l.profile, uptimeMs: Date.now() - l.startedAt, exit: l.exit };
    d.devtoolsConnected = l.browser.isConnected();
    d.page = await within(3000, l.page.evaluate(async () => {
      const frames = await new Promise<number>((done) => {
        let n = 0;
        const end = performance.now() + 500;
        const tick = () => (performance.now() < end ? (n++, requestAnimationFrame(tick)) : done(n));
        requestAnimationFrame(tick);
      });
      const a = document.activeElement as HTMLElement | null;
      return {
        ipc: (window as unknown as { __vuecraftDiag?: () => unknown }).__vuecraftDiag?.(),
        framesIn500ms: frames,
        visibility: document.visibilityState,
        hasFocus: document.hasFocus(),
        activeElement: a ? `${a.tagName.toLowerCase()}${a.getAttribute('aria-label') ? `[${a.getAttribute('aria-label')}]` : ''}` : null,
        editorOpen: !!document.querySelector('[aria-label="Node label"]'),
        modalOpen: !!document.querySelector('[role="dialog"]'),
        nodes: document.querySelectorAll('.react-flow__node').length,
      };
    }));
    d.window = l.exit ? null : await ps('window-state.ps1', '-ProcessId', String(l.proc.pid));
    d.processes = l.exit ? null : await ps('process-state.ps1', '-ProcessId', String(l.proc.pid));
    d.events = l.events.slice(-50);
    d.appLogTail = existsSync(l.log) ? readFileSync(l.log, 'utf8').trim().split('\n').slice(-40) : [];
    const shot = testInfo.outputPath('failure.png');
    const s = await within(5000, l.page.screenshot({ path: shot, timeout: 4000 }));
    d.screenshot = 'failed' in (s as object) ? s : shot;
  }
  d.verdict = verdict(d);
  const file = testInfo.outputPath('diagnostics.json');
  writeFileSync(file, JSON.stringify(d, null, 2));
  await testInfo.attach('diagnostics', { path: file, contentType: 'application/json' });
  console.log(`[diagnostics] ${d.verdict} -> ${file}`);
  return d;
}

/** A first classification from the evidence; the JSON holds the details. */
function verdict(d: Record<string, unknown>): string {
  const launch = d.launch as { exit: unknown } | undefined;
  if (!launch) return 'no app instance';
  if (launch.exit) return `app exited (${JSON.stringify(launch.exit)})`;
  if (!d.devtoolsConnected) return 'DevTools connection lost while the app was running';
  const page = d.page as { failed?: string; ipc?: { pending: { cmd: string; ms: number }[] }; framesIn500ms?: number } | undefined;
  if (page?.failed) return `page did not answer JS evaluation (${page.failed})`;
  const stuck = page?.ipc?.pending.filter((p) => p.ms > 5000) ?? [];
  if (stuck.length) return `IPC call(s) pending: ${stuck.map((p) => `${p.cmd} ${p.ms}ms`).join(', ')}`;
  const win = d.window as { hung?: boolean; iconic?: boolean } | undefined;
  if (win?.hung) return 'app window reported hung by Windows';
  if (page && page.framesIn500ms === 0) return `page responsive but producing no frames (window: ${JSON.stringify(win)})`;
  return 'page, IPC and window responsive: look at the test step, input delivery or expectations';
}
