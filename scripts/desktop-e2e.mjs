// Runs the WebdriverIO desktop suite against the test build of the app.
// @wdio/tauri-service starts one app per launcher run (with maxInstances 1), so each spec file
// gets its own `wdio run`, and with it its own app process; one temp folder is shared by the
// specs of this run (save in poc.e2e.ts, reopen in reopen.e2e.ts).
// Usage: node scripts/desktop-e2e.mjs [--build]
//   --build first builds the test executable (debug, embedded WebDriver plugin, test seam):
//   VITE_E2E_WDIO=1 pnpm tauri build --debug --no-bundle --features e2e-webdriver --config src-tauri/tauri.e2e.conf.json
// Release builds never contain the plugin or the seam.
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

if (process.argv.includes('--build')) {
  const env = { ...process.env, VITE_E2E_WDIO: '1', PATH: [join(homedir(), '.cargo', 'bin'), process.env.PATH].join(delimiter) };
  const b = spawnSync('pnpm tauri build --debug --no-bundle --features e2e-webdriver --config src-tauri/tauri.e2e.conf.json', { stdio: 'inherit', shell: true, env });
  if (b.status !== 0) process.exit(b.status ?? 1);
}

const dir = mkdtempSync(join(tmpdir(), 'vuecraft-wdio-'));
console.log(`run folder: ${dir}`);
for (const spec of ['poc.e2e.ts', 'reopen.e2e.ts', 'r1.e2e.ts']) {
  const r = spawnSync(`pnpm exec wdio run tests/wdio/wdio.conf.ts --spec tests/wdio/${spec}`, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, VUECRAFT_RUN_DIR: dir },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
