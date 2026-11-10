// JavaScript dependency license audit. Production dependencies are bundled into the
// app, so they must use an allowed license. Dev tooling is reported but not shipped.
import { execSync } from 'node:child_process';

const SHIPPED_OK = new Set(['MIT', 'Apache-2.0', 'Apache-2.0 OR MIT', 'MIT OR Apache-2.0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD']);
// Dev tooling only (never bundled). Added 2026-11-09 with the WebdriverIO test tooling:
// Unlicense, (MIT OR CC0-1.0), (MIT AND Zlib), (MIT OR GPL-3.0-or-later) used under MIT, and
// CC-BY-3.0 (spdx-exceptions: license-identifier data).
const TOOLING_OK = new Set([
  ...SHIPPED_OK,
  'MPL-2.0',
  'CC-BY-4.0',
  'BlueOak-1.0.0',
  'Python-2.0',
  'CC0-1.0',
  'Unlicense',
  '(MIT OR CC0-1.0)',
  '(MIT AND Zlib)',
  '(MIT OR GPL-3.0-or-later)',
  'CC-BY-3.0',
]);
// Packages whose metadata lacks a license field, reviewed by hand: name@version -> license.
const REVIEWED = { 'css-value@0.0.1': 'MIT' }; // MIT text in its Readme.md (dev tooling via webdriverio)

const list = (prod) => JSON.parse(execSync(`pnpm licenses list --json${prod ? ' --prod' : ''}`, { encoding: 'utf8' }));

let failed = false;
for (const [prod, allowed] of [[true, SHIPPED_OK], [false, TOOLING_OK]]) {
  console.log(prod ? 'Shipped (production) dependencies:' : 'All dependencies incl. dev tooling:');
  for (const [license, pkgs] of Object.entries(list(prod))) {
    const ok = allowed.has(license) || pkgs.every((p) => p.versions.every((v) => allowed.has(REVIEWED[`${p.name}@${v}`])));
    failed ||= !ok;
    const names = pkgs.map((p) => `${p.name}@${p.versions.join('/')}`);
    console.log(`  ${ok ? 'ok ' : 'BAD'} ${license.padEnd(22)} ${prod ? names.join(', ') : `${pkgs.length} package(s)`}`);
    if (!ok) console.log(`      ${names.join(', ')}`);
  }
}
if (failed) {
  console.error('License audit failed: review the packages marked BAD.');
  process.exit(1);
}
