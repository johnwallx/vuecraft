// Proof of concept: WebdriverIO + @wdio/tauri-service with the embedded WebDriver server
// (tauri-plugin-wdio-webdriver, compiled in only with `--features e2e-webdriver`).
// Build: pnpm tauri build --debug --no-bundle --features e2e-webdriver
// Run:   pnpm exec wdio run tests/wdio/wdio.conf.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Inherited by the app the service spawns: enables the E2E file-path seam (window.__vuecraft).
process.env.VUECRAFT_TEST_SEAM = '1';
// One isolated folder per complete run: created by the launcher, inherited by each spec's worker
// (workers load this file too, and keep the launcher's value).
process.env.VUECRAFT_RUN_DIR ??= mkdtempSync(join(tmpdir(), 'vuecraft-wdio-'));

export const config: WebdriverIO.Config = {
  runner: 'local',
  // In this order; each spec file gets its own session and so its own app process.
  specs: ['./poc.e2e.ts', './reopen.e2e.ts'],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': { application: process.env.VUECRAFT_EXE ?? resolve('target/debug/vuecraft.exe') },
    },
  ],
  services: [['@wdio/tauri-service', { driverProvider: 'embedded', startTimeout: 30_000 }]],
  framework: 'mocha',
  mochaOpts: { timeout: 60_000 },
  reporters: ['spec'],
  // 'error': the service warns on every window-title change ("● Untitled — VUECraft"), which
  // buried failure output; test failures are still reported by the spec reporter.
  logLevel: 'error',
  bail: 0,
};
