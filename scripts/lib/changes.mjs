// Working-tree changes and what kind of verification they need.
// Shared by scripts/verify.mjs and the Stop hook (.claude/hooks/harness.mjs).
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

// trimEnd only: porcelain lines start with a significant space (' M path').
export function git(root, args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout?.trimEnd() ?? '';
}

/** Files changed vs HEAD, including untracked ones (deleted files excluded). */
export function changedFiles(root) {
  return git(root, ['status', '--porcelain', '--untracked-files=all'])
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop())
    .filter((f) => existsSync(join(root, f)));
}

/** Kinds: rust, native, frontend, tooling, ci, docs, audit, other. */
export function classify(files) {
  const kinds = new Set();
  for (const f of files) {
    if (/^(crates\/|src-tauri\/src\/|Cargo\.(toml|lock)$|src-tauri\/Cargo\.toml|deny\.toml)/.test(f)) kinds.add('rust');
    else if (/^src-tauri\/(tauri\.conf\.json|capabilities\/)/.test(f)) kinds.add('native');
    else if (/^(src\/|tests\/e2e\/|index\.html|vite\.config|tsconfig|eslint\.config|package\.json|pnpm-lock\.yaml)/.test(f)) kinds.add('frontend');
    else if (/^(\.claude\/hooks\/|\.claude\/skills\/|\.claude\/settings\.json|tests\/cleanroom\/|tests\/harness\/|scripts\/)/.test(f)) kinds.add('tooling');
    else if (/^\.github\//.test(f)) kinds.add('ci');
    else if (/^\.claude\/(audit|state)\//.test(f)) kinds.add('audit');
    else if (/\.(md|txt)$/.test(f) || /^docs\//.test(f)) kinds.add('docs');
    else kinds.add('other');
  }
  return kinds;
}

/** Newest modification time (ms) among files that need verification. */
export function newestSourceChange(root, files) {
  let newest = 0;
  for (const f of files) {
    const k = classify([f]);
    if (k.has('docs') || k.has('audit')) continue;
    newest = Math.max(newest, statSync(join(root, f)).mtimeMs);
  }
  return newest;
}
