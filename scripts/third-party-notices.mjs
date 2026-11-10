// Generates THIRD_PARTY_NOTICES.md for what ships in the Windows app:
// Rust crates reachable through normal (non-dev, non-build) dependencies of the desktop
// binary on x86_64-pc-windows-msvc, and the production JS dependencies bundled into the UI.
// Each distinct license/NOTICE text is printed once with the packages that use it.
// Usage: node scripts/third-party-notices.mjs [--check]   (--check: fail if the file is stale)
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'THIRD_PARTY_NOTICES.md');
const env = { ...process.env, PATH: [join(homedir(), '.cargo', 'bin'), process.env.PATH].join(delimiter) };
const run = (cmd) => {
  const r = spawnSync(cmd, { cwd: root, env, shell: true, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} failed:\n${r.stderr}`);
  return r.stdout;
};

const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)([-._].*)?$/i;
function licenseTexts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f))
    .sort()
    .map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim() }));
}

// Rust: resolve graph of the desktop binary, normal dependencies only, Windows target.
const meta = JSON.parse(run('cargo metadata --format-version 1 --locked --filter-platform x86_64-pc-windows-msvc'));
const pkgs = new Map(meta.packages.map((p) => [p.id, p]));
const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
const start = meta.packages.find((p) => p.name === 'vuecraft').id;
const seen = new Set([start]);
const queue = [start];
while (queue.length) {
  for (const d of nodes.get(queue.shift()).deps) {
    if (!d.dep_kinds.some((k) => k.kind === null) || seen.has(d.pkg)) continue;
    seen.add(d.pkg);
    queue.push(d.pkg);
  }
}
const rust = [...seen]
  .map((id) => pkgs.get(id))
  .filter((p) => p.source) // workspace members are this project
  .map((p) => ({ name: p.name, version: p.version, license: p.license ?? p.license_file ?? 'UNKNOWN', texts: licenseTexts(dirname(p.manifest_path)) }));

// JS: production dependencies (what Vite bundles into the UI).
const js = [];
for (const [license, list] of Object.entries(JSON.parse(run('pnpm licenses list --prod --json')))) {
  for (const p of list) for (const [i, version] of p.versions.entries()) js.push({ name: p.name, version, license, texts: licenseTexts(p.paths[i]) });
}

const all = [...rust.map((p) => ({ ...p, eco: 'Rust crate' })), ...js.map((p) => ({ ...p, eco: 'npm package' }))].sort(
  (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
);
const byText = new Map();
for (const p of all) {
  for (const t of p.texts) {
    const key = createHash('sha256').update(t.text).digest('hex');
    if (!byText.has(key)) byText.set(key, { text: t.text, users: [] });
    byText.get(key).users.push(`${p.name} ${p.version} (${t.file})`);
  }
}
const missing = all.filter((p) => !p.texts.length);

// Prebuilt binaries that a dependency links into the executable under their own license, which
// crate metadata doesn't show. webview2-com-sys statically links Microsoft's WebView2 loader
// (WebView2LoaderStatic.lib). Identified as WebView2 SDK 1.0.3800.47 because its x64 library is
// byte-identical to that NuGet package's build/native/x64 file. The SDK's LICENSE.txt
// (BSD-3-Clause-style, requires the notice) and NOTICE.txt are copied verbatim from that package.
// The hash pin makes a changed loader fail here until the texts and version are re-checked.
// shortcut: one known case, checked by hand; review this list when a dependency adds prebuilt binaries.
const PREBUILT = [
  {
    crate: 'webview2-com-sys',
    file: 'x64/WebView2LoaderStatic.lib',
    sha256: '89c6b872783b8f6c3cedbff618adb42082d455c615453ae10cfc753f1e8f25d8',
    name: 'Microsoft Edge WebView2 Loader (WebView2LoaderStatic.lib, Microsoft Edge WebView2 SDK 1.0.3800.47)',
    notices: [
      ['License (LICENSE.txt in the SDK package)', 'scripts/notices/microsoft-webview2-sdk-LICENSE.txt'],
      ['Third-party notices (NOTICE.txt in the SDK package)', 'scripts/notices/microsoft-webview2-sdk-NOTICE.txt'],
    ],
  },
];
const prebuilt = PREBUILT.flatMap((b) => {
  const p = [...seen].map((id) => pkgs.get(id)).find((q) => q.name === b.crate);
  if (!p) return [];
  const lib = join(dirname(p.manifest_path), b.file);
  if (!existsSync(lib)) throw new Error(`${b.crate} ${p.version} no longer ships ${b.file}: review PREBUILT`);
  if (createHash('sha256').update(readFileSync(lib)).digest('hex') !== b.sha256) throw new Error(`${b.crate} ${p.version} ships a different ${b.file}: identify its SDK version and review PREBUILT`);
  const texts = b.notices.map(([title, file]) => ({ title, text: readFileSync(join(root, file), 'utf8').replace(/\r\n/g, '\n').trim() }));
  return [{ ...b, via: `${p.name} ${p.version}`, texts }];
});

const lines = [
  '# Third-party notices',
  '',
  'VUECraft includes the following third-party software. Each component remains under its own',
  'license, shown below. Generated by `scripts/third-party-notices.mjs` from the dependency',
  'lockfiles; do not edit by hand.',
  '',
  ...(prebuilt.length
    ? [
        '## Prebuilt components linked into the program',
        '',
        ...prebuilt.flatMap((b) => [`### ${b.name}`, '', `Included through ${b.via}.`, '', ...b.texts.flatMap((t) => [`#### ${t.title}`, '', '```text', t.text.replaceAll('```', "'''"), '```', ''])]),
      ]
    : []),
  '## Components',
  '',
  '| Component | Version | Kind | License |',
  '|---|---|---|---|',
  ...all.map((p) => `| ${p.name} | ${p.version} | ${p.eco} | ${p.license} |`),
  '',
  '## License and notice texts',
  '',
];
for (const { text, users } of byText.values()) {
  lines.push(`### Used by: ${users.join(', ')}`, '', '```text', text.replaceAll('```', "'''"), '```', '');
}
if (missing.length) {
  lines.push('## Components without a bundled license file', '', 'These are distributed under the license named in their package metadata (see the table above); the standard text of each such license appears in this file.', '');
  for (const p of missing) lines.push(`- ${p.name} ${p.version} (${p.license})`);
  lines.push('');
}
const doc = lines.join('\n');

if (process.argv.includes('--check')) {
  const current = existsSync(out) ? readFileSync(out, 'utf8') : '';
  if (current !== doc) {
    console.error('THIRD_PARTY_NOTICES.md is out of date: run node scripts/third-party-notices.mjs');
    process.exit(1);
  }
  console.log(`THIRD_PARTY_NOTICES.md is current (${all.length} components)`);
} else {
  writeFileSync(out, doc);
  console.log(`wrote THIRD_PARTY_NOTICES.md: ${rust.length} Rust crates, ${js.length} npm packages, ${byText.size} distinct texts, ${missing.length} without a license file`);
}
