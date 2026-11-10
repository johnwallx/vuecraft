// One entry point for verification. Usage:
//   node scripts/verify.mjs quick      changed-file checks (seconds to a minute)
//   node scripts/verify.mjs full       every gate + debug desktop E2E   [--no-e2e]
//   node scripts/verify.mjs release    full gates + release build, installer, release E2E
// Prints one line per step, the tail of any failing output, and a summary; exits 1 on
// failure. Writes target/verify/last.json, which the Stop hook reads.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { changedFiles as changedIn, classify, git as gitIn } from './lib/changes.mjs';

const root = resolve(import.meta.dirname, '..');
const mode = process.argv[2] ?? 'quick';
const noE2e = process.argv.includes('--no-e2e');
if (!['quick', 'full', 'release'].includes(mode)) {
  console.error('usage: node scripts/verify.mjs quick|full|release [--no-e2e]');
  process.exit(2);
}
// Rust is installed per user; make cargo reachable even when this shell predates it.
const env = { ...process.env, PATH: [join(homedir(), '.cargo', 'bin'), process.env.PATH].join(delimiter) };

const git = (args) => gitIn(root, args);
const changedFiles = () => changedIn(root);

const steps = [];
const add = (name, cmd, opts = {}) => steps.push({ name, cmd, ...opts });

if (mode === 'quick') {
  const files = changedFiles();
  const kinds = classify(files);
  console.log(`quick: ${files.length} changed file(s): ${[...kinds].join(', ') || 'none'}`);
  if (kinds.has('rust')) {
    add('rustfmt', 'cargo fmt --all -- --check');
    add('clippy (map-core)', 'cargo clippy -p map-core --all-targets -- -D warnings');
    if (files.some((f) => f.startsWith('src-tauri/')))
      add('clippy (shell)', 'cargo clippy -p vuecraft --all-targets -- -D warnings', { needs: 'dist/index.html' });
    add('cargo test (map-core)', 'cargo test -p map-core');
  }
  const ts = files.filter((f) => /\.(ts|tsx|js|mjs)$/.test(f) && !f.startsWith('.claude/'));
  if (kinds.has('frontend') || ts.length) {
    if (ts.length) add('eslint (changed)', `pnpm exec eslint ${ts.map((f) => JSON.stringify(f)).join(' ')}`);
    add('typecheck', 'pnpm typecheck');
    const units = ts.filter((f) => f.startsWith('src/'));
    if (units.length) add('vitest (related)', `pnpm exec vitest related --run --passWithNoTests ${units.map((f) => JSON.stringify(f)).join(' ')}`);
  }
  if (files.some((f) => f.startsWith('.claude/hooks/') || f.startsWith('tests/cleanroom/'))) add('clean-room guard tests', 'pnpm test:guard');
  if (files.some((f) => f.startsWith('.claude/hooks/') || f.startsWith('tests/harness/'))) add('harness hook tests', 'pnpm test:hooks');
} else {
  add('rustfmt', 'cargo fmt --all -- --check');
  add('frontend build (dist/ for tauri)', 'pnpm build');
  add('clippy', 'cargo clippy --workspace --all-targets -- -D warnings');
  add('cargo test', 'cargo test --workspace');
  add('eslint', 'pnpm lint');
  add('typecheck', 'pnpm typecheck');
  add('vitest', 'pnpm test');
  add('clean-room guard tests', 'pnpm test:guard');
  add('harness hook tests', 'pnpm test:hooks');
  add('cargo deny', 'cargo deny check');
  add('JS license audit', 'pnpm run audit:licenses');
  add('third-party notices current', 'node scripts/third-party-notices.mjs --check');
  if (mode !== 'quick' && !noE2e) {
    // WebdriverIO against the test build (embedded WebDriver plugin, built here).
    add('desktop E2E (WebdriverIO, test build)', 'node scripts/desktop-e2e.mjs --build');
  }
  if (mode === 'release') {
    add('release build + installer', 'pnpm tauri build');
    add('installer present', null, {
      check: () => {
        const dir = join(root, 'target/release/bundle/nsis');
        const exe = existsSync(dir) && readdirSync(dir).find((f) => f.endsWith('-setup.exe'));
        return exe ? { ok: true, out: `${exe} (${(statSync(join(dir, exe)).size / 1e6).toFixed(1)} MB)` } : { ok: false, out: `no *-setup.exe in ${dir}` };
      },
    });
    add('license files present', null, {
      check: () => {
        const missing = ['LICENSE-MIT', 'LICENSE-APACHE', 'THIRD_PARTY_NOTICES.md'].filter((f) => !existsSync(join(root, f)));
        return { ok: !missing.length, out: missing.length ? `missing: ${missing.join(', ')}` : 'LICENSE-MIT, LICENSE-APACHE, THIRD_PARTY_NOTICES.md' };
      },
    });
    // The release binary has no test interfaces: its desktop checks are the installer test and the
    // manual acceptance checklist (see the vuecraft-release skill).
  }
}

const results = [];
let failed = false;
for (const s of steps) {
  const t0 = Date.now();
  let ok;
  let out;
  if (s.needs && !existsSync(join(root, s.needs))) {
    results.push({ name: s.name, status: 'skipped', ms: 0, note: `needs ${s.needs} (run pnpm build)` });
    console.log(`SKIP ${s.name}: needs ${s.needs}`);
    continue;
  }
  if (s.check) ({ ok, out } = s.check());
  else {
    const r = spawnSync(s.cmd, { cwd: root, env: { ...env, ...s.env }, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    ok = r.status === 0;
    out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  }
  const ms = Date.now() - t0;
  results.push({ name: s.name, status: ok ? 'pass' : 'fail', ms });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${s.name} (${(ms / 1000).toFixed(1)}s)`);
  if (!ok) {
    failed = true;
    console.log(out.trimEnd().split('\n').slice(-30).map((l) => `  | ${l}`).join('\n'));
  }
}
if (!steps.length) console.log('nothing to verify for these changes');

mkdirSync(join(root, 'target/verify'), { recursive: true });
writeFileSync(
  join(root, 'target/verify/last.json'),
  JSON.stringify({ mode, finishedAt: new Date().toISOString(), head: git(['rev-parse', '--short', 'HEAD']), ok: !failed, results }, null, 2),
);
console.log(`\n${mode}: ${failed ? 'FAILED' : 'passed'} (${results.filter((r) => r.status === 'pass').length}/${results.length} steps)`);
process.exit(failed ? 1 : 0);
