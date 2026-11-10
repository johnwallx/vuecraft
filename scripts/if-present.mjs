// Usage: node scripts/if-present.mjs <path> -- <command...>
// .claude/ is gitignored, so a fresh clone or CI has no hooks or skills to test: skip instead of failing.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const [path, sep, cmd, ...args] = process.argv.slice(2);
if (!path || sep !== '--' || !cmd) {
  console.error('usage: node scripts/if-present.mjs <path> -- <command...>');
  process.exit(2);
}
if (!existsSync(path)) {
  console.log(`skipped: ${path} not present`);
  process.exit(0);
}
const r = spawnSync(cmd, args, { stdio: 'inherit' });
if (r.error) {
  console.error(`if-present: ${r.error.message}`);
  process.exit(1);
}
process.exit(r.status ?? 1);
