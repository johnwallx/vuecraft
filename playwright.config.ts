import { defineConfig } from '@playwright/test';

// Drives the real desktop app (Windows/WebView2) over the DevTools protocol.
// Build it first: pnpm tauri build --debug --no-bundle
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  // The desktop suite drives real windows on a shared desktop; a retry absorbs focus or
  // scheduling hiccups. Playwright still reports such passes as "flaky".
  retries: 1,
  // Healthy desktop tests finish in 3-10 s; a bound of 45 s stops infrastructure stalls early.
  timeout: 45_000,
  reporter: [['list']],
  outputDir: 'test-results',
});
