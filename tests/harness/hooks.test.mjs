// Tests for .claude/hooks/harness.mjs: success, failure and malformed input for each
// mode, against throwaway git repositories (never the real working tree).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const HOOK = resolve(import.meta.dirname, '../../.claude/hooks/harness.mjs');

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'vuecraft-hook-'));
  const g = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  g('init', '-q');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'test');
  mkdirSync(join(dir, 'docs'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(
    join(dir, 'docs', 'FEATURE_MATRIX.md'),
    '## Later releases\n\n| Release | Status | Notes |\n|---|---|---|\n| R1.1 Groups | Verified | x |\n| R1.5 Search | Not started | |\n\n## Known defects\n\n| Defect | Evidence | Status |\n|---|---|---|\n| Stall in E2E | runs | Under investigation |\n',
  );
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, '.gitignore'), 'target/\n.claude/state/\n');
  g('add', '-A');
  g('commit', '-qm', 'init');
  return dir;
}

function run(mode, root, input) {
  const r = spawnSync(process.execPath, [HOOK, mode], {
    input: typeof input === 'string' ? input : JSON.stringify(input ?? {}),
    env: { ...process.env, VUECRAFT_HOOK_ROOT: root },
    encoding: 'utf8',
  });
  return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr };
}

const writeVerify = (root, ok, when = new Date()) => {
  mkdirSync(join(root, 'target', 'verify'), { recursive: true });
  writeFileSync(
    join(root, 'target', 'verify', 'last.json'),
    JSON.stringify({ mode: 'quick', finishedAt: when.toISOString(), head: 'abc1234', ok, results: [{ name: 'typecheck', status: ok ? 'pass' : 'fail', ms: 1 }] }),
  );
};

test('session-start reports branch, milestone, defects and verification state', () => {
  const root = repo();
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 2;\n');
  const { status, out } = run('session-start', root);
  assert.equal(status, 0);
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /1 uncommitted file\(s\) \[frontend\]/);
  assert.match(ctx, /Next milestone: R1\.5 Search \(Not started\)/);
  assert.match(ctx, /Stall in E2E \(Under investigation\)/);
  assert.match(ctx, /Last verification: none recorded/);
});

test('stop: no source changes or docs-only changes never block', () => {
  const root = repo();
  assert.equal(run('stop', root, {}).out, null);
  writeFileSync(join(root, 'docs', 'notes.md'), 'x');
  assert.equal(run('stop', root, {}).out, null);
});

test('stop: unverified source change blocks once, then lets the turn end', () => {
  const root = repo();
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 3;\n');
  const first = run('stop', root, { hook_event_name: 'Stop' });
  assert.equal(first.out.decision, 'block');
  assert.match(first.out.reason, /frontend files changed since the last verification/);
  assert.equal(run('stop', root, {}).out, null, 'same state is not asked about twice');
  assert.equal(run('stop', root, { stop_hook_active: true }).out, null, 'never loops');
});

test('stop: a passing verification newer than the edits allows; a failing one blocks', () => {
  const root = repo();
  const file = join(root, 'src', 'a.ts');
  writeFileSync(file, 'export const a = 4;\n');
  const past = new Date(Date.now() - 60_000);
  utimesSync(file, past, past);
  writeVerify(root, true);
  assert.equal(run('stop', root, {}).out, null);
  writeVerify(root, false);
  const r = run('stop', root, {});
  assert.equal(r.out.decision, 'block');
  assert.match(r.out.reason, /failed: quick FAILED \(typecheck\)/);
  // An edit after a passing verification needs verifying again.
  writeVerify(root, true, new Date(Date.now() - 120_000));
  assert.equal(run('stop', root, {}).out.decision, 'block');
});

test('post-edit: formats Rust, reports a syntax error, ignores files outside the project', () => {
  const root = repo();
  const rs = join(root, 'src', 'x.rs');
  writeFileSync(rs, 'fn  main( ){let x=1;}\n');
  assert.equal(run('post-edit', root, { tool_input: { file_path: rs } }).out, null);
  assert.equal(readFileSync(rs, 'utf8'), 'fn main() {\n    let x = 1;\n}\n');
  writeFileSync(rs, 'fn main( {\n');
  assert.match(run('post-edit', root, { tool_input: { file_path: rs } }).out.hookSpecificOutput.additionalContext, /rustfmt failed on src\/x\.rs/);
  const outside = join(tmpdir(), 'vuecraft-outside.rs');
  writeFileSync(outside, 'fn  a(){}\n');
  run('post-edit', root, { tool_input: { file_path: outside } });
  assert.equal(readFileSync(outside, 'utf8'), 'fn  a(){}\n', 'untouched');
});

test('continuity writes a note with the last real user request; session-start shows it', () => {
  const root = repo();
  const transcript = join(root, 't.jsonl');
  writeFileSync(
    transcript,
    [
      { type: 'user', message: { content: 'Implement search for R1.5' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } },
      { type: 'user', message: { content: '<system-reminder>ignore</system-reminder>' } },
    ]
      .map((e) => JSON.stringify(e))
      .join('\n'),
  );
  run('continuity', root, { hook_event_name: 'PreCompact', transcript_path: transcript });
  const note = readFileSync(join(root, '.claude', 'state', 'continuity.md'), 'utf8');
  assert.match(note, /Last user request: Implement search for R1\.5/);
  assert.match(note, /Milestone: R1\.5 Search/);
  assert.match(run('session-start', root).out.hookSpecificOutput.additionalContext, /Continuity note[\s\S]*Implement search/);
});

test('malformed input and unknown modes fail open without output', () => {
  const root = repo();
  for (const mode of ['stop', 'post-edit', 'continuity', 'bogus']) {
    const r = run(mode, root, '{not json');
    assert.equal(r.status, 0, mode);
    assert.equal(r.out, null, mode);
    assert.match(r.err, /harness hook \(.+\) skipped/, mode);
  }
  assert.equal(existsSync(join(root, '.claude', 'state', 'continuity.md')), false);
});
