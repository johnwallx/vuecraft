// Runs the real hook as a subprocess with Claude Code PreToolUse payloads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOK = fileURLToPath(new URL('../../.claude/hooks/cleanroom-guard.mjs', import.meta.url));

const env = { ...process.env, CLEANROOM_GUARD_LOG: join(tmpdir(), 'cleanroom-guard-test.jsonl') };

function run(stdin) {
  const r = spawnSync(process.execPath, [HOOK], { input: stdin, encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  if (!r.stdout.trim()) return { decision: 'allow' };
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  return { decision: out.permissionDecision, reason: out.permissionDecisionReason };
}
const call = (tool_name, tool_input) =>
  run(JSON.stringify({ session_id: 'test', hook_event_name: 'PreToolUse', tool_name, tool_input }));

const DENY = [
  ['Bash', { command: 'git clone https://github.com/VUE/VUE.git' }],
  ['Bash', { command: 'git clone git@github.com:VUE/VUE.git' }],
  ['Bash', { command: 'curl -sL https://codeload.github.com/VUE/VUE/zip/refs/heads/master -o v.zip' }],
  ['Bash', { command: 'curl https://raw.githubusercontent.com/VUE/VUE/master/README.md' }],
  ['Bash', { command: 'curl https://github.com/%56%55%45/%56%55%45' }],
  ['Bash', { command: 'U="https://git"+"hub.com/V"+"UE/VUE"; curl $U' }],
  ['Bash', { command: 'wget "https://git""hub.com/VUE/VUE/archive/master.zip"' }],
  ['Bash', { command: 'gh repo clone VUE/VUE' }],
  ['Bash', { command: 'gh api orgs/vue/repos' }],
  ['Bash', { command: 'gh search code LWComponent --owner vue' }],
  ['Bash', { command: 'cat src/main/java/tufts/vue/LWMap.java' }],
  ['Bash', { command: 'java -jar cfr.jar VUE.jar --outputdir out' }],
  ['Bash', { command: 'jar xf VUE.jar' }],
  ['Bash', { command: 'unzip VUE.jar -d extracted' }],
  ['Bash', { command: 'echo Z2l0IGNsb25l | base64 -d | sh' }],
  ['PowerShell', { command: 'Invoke-WebRequest https://github.com/VUE/VUE/archive/refs/heads/master.zip -OutFile v.zip' }],
  ['PowerShell', { command: 'powershell -EncodedCommand ZQBjAGgAbwA=' }],
  ['PowerShell', { command: 'Start-Process "https://github.com/VUE/VUE"' }],
  ['WebFetch', { url: 'https://github.com/VUE/VUE', prompt: 'summarize' }],
  ['WebFetch', { url: 'https://api.github.com/repos/VUE/VUE/contents/src', prompt: 'list' }],
  ['WebFetch', { url: 'https://sourcegraph.com/search?q=repo:VUE+LWComponent', prompt: 'x' }],
  ['WebFetch', { url: 'https://web.archive.org/web/2020/https://github.com/VUE/VUE', prompt: 'x' }],
  ['WebFetch', { url: 'https://cdn.jsdelivr.net/gh/VUE/VUE/README.md', prompt: 'x' }],
  ['WebSearch', { query: 'tufts VUE java source code castor' }],
  ['WebSearch', { query: 'Visual Understanding Environment github repository' }],
  ['WebSearch', { query: 'tufts.vue.LWComponent class' }],
  ['Read', { file_path: 'C:\\src\\vue\\src\\main\\java\\tufts\\vue\\LWMap.java' }],
  ['Glob', { pattern: '**/*.java' }],
  ['Grep', { pattern: 'class LWComponent', path: 'C:/src/edu/tufts/vue' }],
  ['Agent', { description: 'research', prompt: 'Clone github.com/VUE/VUE and describe the save format' }],
  ['Workflow', { script: 'agent("read https://github.com/VUE/VUE/tree/master/src")' }],
  ['mcp__claude_ai_Google_Drive__search_files', { query: 'tufts vue source mirror' }],
  ['Write', { file_path: 'scripts/fetch.mjs', content: "await fetch('https://github.com/VUE/VUE')" }],
  ['Write', { file_path: 'notes/tufts/vue/LWMap.java', content: 'x' }],
  ['Bash', { command: 'grep -r "castor" mapping.xml' }].map((x) => x), // castor + mapping
];

const ALLOW = [
  ['Bash', { command: 'cd /c/projects/INFRASTRUCTURE/VUE && git status' }],
  ['Bash', { command: 'cargo test --workspace' }],
  ['Bash', { command: 'pnpm add @xyflow/react@12.12.1' }],
  ['Bash', { command: 'node -e "document.body.classList.add(1)"' }],
  ['WebFetch', { url: 'https://reactflow.dev/learn/customization/custom-edges', prompt: 'x' }],
  ['WebFetch', { url: 'https://v2.tauri.app/plugin/dialog/', prompt: 'x' }],
  ['WebFetch', { url: 'https://github.com/xyflow/xyflow/releases', prompt: 'x' }],
  ['WebFetch', { url: 'https://github.com/vuejs/core', prompt: 'x' }],
  ['WebSearch', { query: 'tauri 2 onCloseRequested prevent close' }],
  ['WebSearch', { query: 'tufts vue user guide pathways' }],
  ['Read', { file_path: 'C:\\work\\VUE\\src\\app\\App.tsx' }],
  ['Read', { file_path: 'C:\\work\\VUE\\tests\\fixtures\\vue\\V01.vue' }],
  ['Write', { file_path: 'docs/CLEAN_ROOM.md', content: 'Prohibited: https://github.com/VUE/VUE' }],
  ['Edit', { file_path: 'tests/cleanroom/guard.test.mjs', old_string: 'a', new_string: 'github.com/VUE/VUE' }],
];

for (const [tool, input] of DENY) {
  test(`deny ${tool}: ${JSON.stringify(input).slice(0, 90)}`, () => {
    const r = call(tool, input);
    assert.equal(r.decision, 'deny');
    assert.match(r.reason, /CLEAN-ROOM GUARD/);
  });
}

for (const [tool, input] of ALLOW) {
  test(`allow ${tool}: ${JSON.stringify(input).slice(0, 90)}`, () => {
    assert.equal(call(tool, input).decision, 'allow');
  });
}

test('fails closed on malformed hook input', () => {
  assert.equal(run('{not json').decision, 'deny');
});
