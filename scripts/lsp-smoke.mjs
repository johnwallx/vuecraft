// Checks that the Rust and TypeScript language servers resolve VUECraft symbols:
// sends a real textDocument/definition request over LSP (JSON-RPC on stdio) and
// expects it to land on the known definition. Usage: node scripts/lsp-smoke.mjs
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const bin = (name) => (process.platform === 'win32' ? `${name}.cmd` : name);
const CASES = [
  {
    name: 'rust-analyzer',
    command: [join(homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'rust-analyzer.exe' : 'rust-analyzer')],
    languageId: 'rust',
    // A shell call into the engine crate: src-tauri -> crates/map-core.
    file: 'src-tauri/src/main.rs',
    symbol: 'is_network_path(&r.target)',
    expect: /crates[\\/]map-core[\\/]src[\\/]assets\.rs$/,
  },
  {
    name: 'typescript-language-server',
    command: [bin('typescript-language-server'), '--stdio'],
    languageId: 'typescriptreact',
    file: 'src/canvas/ConceptNodeView.tsx',
    symbol: 'useImageData(node.image)',
    expect: /src[\\/]canvas[\\/]useImageData\.ts$/,
  },
];

function client(command) {
  // .cmd shims need a shell on Windows; pass one command string (no separate args).
  const proc = command[0].endsWith('.cmd') ? spawn(command.join(' '), { cwd: root, shell: true }) : spawn(command[0], command.slice(1), { cwd: root });
  let buf = Buffer.alloc(0);
  let id = 0;
  const pending = new Map();
  proc.stdout.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const head = buf.indexOf('\r\n\r\n');
      if (head < 0) return;
      const len = Number(/Content-Length: (\d+)/i.exec(buf.subarray(0, head).toString())[1]);
      if (buf.length < head + 4 + len) return;
      const msg = JSON.parse(buf.subarray(head + 4, head + 4 + len).toString());
      buf = buf.subarray(head + 4 + len);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      } else if (msg.id !== undefined && msg.method) {
        send({ jsonrpc: '2.0', id: msg.id, result: null }); // e.g. workDoneProgress/create
      }
    }
  });
  const send = (m) => {
    const body = JSON.stringify(m);
    proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  return {
    proc,
    request: (method, params) =>
      new Promise((res) => {
        pending.set(++id, res);
        send({ jsonrpc: '2.0', id, method, params });
      }),
    notify: (method, params) => send({ jsonrpc: '2.0', method, params }),
  };
}

async function check(c) {
  const lsp = client(c.command);
  const failed = new Promise((res) => lsp.proc.once('error', (e) => res({ ok: false, detail: e.message })));
  const run = (async () => {
    const rootUri = pathToFileURL(root).href;
    await lsp.request('initialize', { processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name: 'vuecraft' }], capabilities: {} });
    lsp.notify('initialized', {});
    const path = join(root, c.file);
    const text = readFileSync(path, 'utf8');
    const uri = pathToFileURL(path).href;
    lsp.notify('textDocument/didOpen', { textDocument: { uri, languageId: c.languageId, version: 1, text } });
    const offset = text.indexOf(c.symbol);
    const before = text.slice(0, offset).split('\n');
    const position = { line: before.length - 1, character: before.at(-1).length + 1 };
    // Until indexing/project load finishes, servers answer null or stop at the import; retry for up to two minutes.
    let last = 'no definition returned';
    for (let i = 0; i < 60; i++) {
      const r = await lsp.request('textDocument/definition', { textDocument: { uri }, position });
      const loc = [r.result ?? []].flat()[0];
      const target = loc && decodeURIComponent(new URL(loc.uri ?? loc.targetUri).pathname).replace(/^\/([A-Za-z]:)/, '$1');
      if (target) last = `${c.file} "${c.symbol}" -> ${target}:${(loc.range ?? loc.targetSelectionRange).start.line + 1}`;
      if (target && c.expect.test(target)) return { ok: true, detail: last };
      await new Promise((r) => setTimeout(r, 2000));
    }
    return { ok: false, detail: `${last} (after 2 minutes)` };
  })();
  const result = await Promise.race([run, failed]);
  lsp.proc.kill();
  return result;
}

let ok = true;
for (const c of CASES) {
  const r = await check(c);
  ok &&= r.ok;
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${c.name}: ${r.detail}`);
}
process.exit(ok ? 0 : 1);
