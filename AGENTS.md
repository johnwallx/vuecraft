# Agent instructions

## Clean room (binding)

Never access VUE's implementation in any form, directly or through another agent
or tool. That covers source, its repository or mirrors, Java or class files,
Castor mappings, decompiled binaries, and notes derived from any of them.
Permitted evidence and the logging rules are in `docs/CLEAN_ROOM.md`. Log every
piece of compatibility evidence in `docs/PROVENANCE.md`. The `PreToolUse` guard
(`.claude/hooks/cleanroom-guard.mjs`) enforces part of this. Do not weaken it,
and run `pnpm test:guard` after any change to it. A second `PreToolUse` guard
(`.claude/skills/clean-room/scripts/cleanroom-guard.mjs`, configured by
`.claude/cleanroom.json`) denies outward actions and credential use; `pnpm test:guard`
runs its tests too. Run the `cleanroom-warden` agent after a guard denial, after a
fan-out of edits, at session end and before publishing. `.claude/` is gitignored,
so the guards, hooks, skills and agents named here exist only in the maintainer's
local checkout and are never committed. The warden's audit therefore always reports
the guards and `.claude/settings.json` as uncommitted (`guard-tampered`); that
finding is expected, and the warden must not restore or quarantine them. Review any
change to the guards or settings by hand before running it.

## Stack (fixed)

Tauri 2 · React + TypeScript · `@xyflow/react` (React Flow) · Rust engine with
Serde · Vite · pnpm · Cargo · Vitest + Testing Library · Playwright. Open-source
editions only: no React Flow Pro, no paid Tiptap. Do not add Electron, a
Python or Node backend, a database, a server, or cloud services.

## Layout

| Path | Purpose |
|---|---|
| `crates/map-core/` | Document model, integrity, ops/undo, file I/O, SVG export (no Tauri) |
| `src-tauri/` | Desktop shell: session state, IPC commands, capabilities, icons |
| `src/bridge/` | Typed IPC calls and types mirroring map-core |
| `src/state/` | Serialized session queue, editor context |
| `src/canvas/` | React Flow canvas, node/edge views, geometry, document↔flow mapping, edit actions |
| `src/components/`, `src/app/` | Toolbar, inspector, dialogs, app shell, shortcuts, theme |
| `tests/wdio/`, `scripts/desktop-e2e.mjs` | Desktop E2E: WebdriverIO + `@wdio/tauri-service`, embedded WebDriver plugin compiled in only with `--features e2e-webdriver` |
| `tests/e2e/` | Legacy Playwright/WebView2-DevTools suite and benchmark, kept as reference (`pnpm test:e2e:playwright-legacy`); not in the default gates |
| `tests/cleanroom/` | Guard tests |
| `tests/harness/`, `.claude/hooks/harness.mjs` | Dev-harness hooks (session context, format/lint after edits, verification check, continuity) and their tests |
| `scripts/` | `verify.mjs` (quick/full/release gates), `lsp-smoke.mjs`, `third-party-notices.mjs`, license audit |
| `.claude/skills/` | Project skills `vuecraft-verify`, `vuecraft-desktop-debug`, `vuecraft-feature`, `vuecraft-release`, `github-read`; master copies `clean-room`, `config-git`, `sub-agents`, `update-skills`, `session-start`, `session-end`, `rust-env`, `rust-patterns`, `rust-testing` (keep identical to master, refresh with `/update-skills`; not linted here) |
| `.claude/agents/` | `cleanroom-explorer` (read-only, Sonnet), `cleanroom-worker` (scoped edits, Opus), `cleanroom-warden` (clean-room audit, Opus) |

## Commands

Rust is installed per user. If `cargo` is not on `PATH`, prepend `~/.cargo/bin`.

```bash
pnpm verify quick | full | release           # the gates below, by level; see vuecraft-verify
pnpm install
pnpm build                                   # required before cargo: tauri embeds dist/
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm lint && pnpm typecheck && pnpm test
pnpm test:guard && pnpm test:hooks
cargo deny check && pnpm run audit:licenses   # exceptions: docs/RISK_REGISTER.md
node scripts/third-party-notices.mjs         # regenerate THIRD_PARTY_NOTICES.md after dependency changes
pnpm test:desktop                            # desktop E2E: WebdriverIO, test build (Windows)
pnpm tauri dev                               # run the app with hot reload
pnpm tauri build                             # release exe + NSIS installer
```

## Rules

- Finish the current release (see `docs/FEATURE_MATRIX.md`) before starting the
  next. Put out-of-scope ideas in the backlog there.
- Every document change goes through a `map-core` op inside one transaction.
  Never persist UI-only state. Never call Rust on every pointer move.
- Use the library before writing code: React Flow for interaction and
  rendering, Tauri plugins for OS integration.
- No custom renderer, plugin system, speculative abstraction, or extra crates
  without a demonstrated need.
- Keep `svg.rs` and `src/canvas/geometry.ts` in sync, and update both parity
  tests together.
- Mark a requirement Verified only after its acceptance criteria were exercised.
  Report test results only from commands actually run.
- Run `pnpm verify quick` after edits and `pnpm verify full` before a milestone
  commit. Only one desktop E2E run at a time: the legacy Playwright harness takes
  `target/desktop-e2e.lock`, but the WebdriverIO runner (`scripts/desktop-e2e.mjs`)
  doesn't, so never start a second run.
- A failed desktop test leaves `test-results/<test>/diagnostics.json`; diagnose
  with the `vuecraft-desktop-debug` skill before calling a failure environmental.

## Subagents

- Delegate by default. Searches, reads, greps, queries, reviews and read-only checks go to
  Sonnet subagents (`cleanroom-explorer`, or any agent called with `model: "sonnet"`). Code
  changes go to Opus subagents (`cleanroom-worker`, `model: "opus"`). Pass `model` on every
  Agent call.
- Launch independent agents in one message. For eight or more units, use `/sub-agents <task>`.
- Every brief calls the original app "upstream", never by name (the guard denies such a
  brief), and carries the clean-room rules the unit needs.
- Subagents never commit, push, open or comment on PRs, post, install, or use credentials.
  Outward-facing actions need the user's yes each time.
- After a fan-out of edits, run `cleanroom-warden` over the change before reporting done.

## Session start

- Repo: this is the published repo. Its commits use its local GitHub noreply identity.
- Session log: `.claude/state/sessions.md`. `.claude/` is gitignored and never committed,
  so the log never goes in a tracked file.
- Environment: `cargo --version` (prepend `~/.cargo/bin`) and `pnpm --version`.
- Baseline: `pnpm verify quick`, unless the SessionStart hook already reports a passing
  quick run on HEAD.

## Session end

- Identity and session log: as in Session start.
- Checks: `pnpm verify quick`, then `pnpm verify full` if the session changed code or
  before a milestone commit. Report only results from commands actually run.
- Run the `cleanroom-warden` agent once over the repo before writing the log entry.
- Before proposing a push, run `node .claude/skills/config-git/scripts/prepush_audit.mjs`
  on this repo. The push itself is the user's.
