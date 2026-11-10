# Contributing to VUECraft

Thanks for your interest. VUECraft is a small volunteer project, so short,
focused changes are the easiest to review. Please be respectful and
constructive in issues, discussions and pull requests.

## Issues or Discussions?

- **Bug**: a released build doesn't behave as documented. Open an issue with
  the bug form.
- **Feature request**: a concrete proposal tied to a problem you have. Check
  [ROADMAP.md](ROADMAP.md) first, then use the feature form.
- **Questions, open-ended ideas, help**: use
  [Discussions](https://github.com/johnwallx/vuecraft/discussions).
- **Security problems**: never in public. See [SECURITY.md](SECURITY.md).

For anything bigger than a small fix, open an issue or a discussion before
you write code.

## Development setup

Prerequisites:

- Windows 11 x64. It is the only platform built and tested so far.
- Node 24 or later, with pnpm through Corepack (`corepack enable`). The pnpm
  version is pinned in `package.json`.
- Rust stable. If `cargo` is not on `PATH` afterwards, add `~/.cargo/bin`.
- The [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/). On
  Windows these are the Visual Studio C++ Build Tools and WebView2, which
  Windows 11 already includes.

```bash
pnpm install
pnpm build        # before any cargo command: the Tauri crate embeds dist/
pnpm tauri dev    # run the app with hot reload
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the parts fit
together. The layout table and the full command list are in
[AGENTS.md](AGENTS.md).

## Verifying a change

```bash
node scripts/verify.mjs quick   # after edits: checks the files you changed
node scripts/verify.mjs full    # before opening a pull request
```

`full` runs every gate: formatting, clippy, Rust and UI tests, lint,
typecheck, the clean-room guard tests (they run only where the maintainer's
local `.claude/` tooling is present and otherwise skip), the dependency license
audits and the desktop end-to-end suite. Paste its summary into your pull request.

The desktop end-to-end suite runs on Windows only, one run at a time. On
another system, run `node scripts/verify.mjs full --no-e2e` and say so in the
pull request. A failed desktop test leaves
`test-results/<test>/diagnostics.json`.

## Rules for changes

- **Document changes go through the engine.** Every change to a map is a
  `map-core` operation applied inside one transaction. UI-only state, such as
  selection and viewport, is never saved in the document. The UI sends one
  transaction when a gesture ends, never one per pointer move.
- **Edge geometry has two copies.** `crates/map-core/src/svg.rs` and
  `src/canvas/geometry.ts` must stay in sync. Change both, and update both
  parity tests together.
- **No dependency without a need.** Use React Flow, the Tauri plugins and
  existing code before writing new code. Don't add a dependency, crate or
  abstraction unless the change needs it, and explain why in the pull request.
  Open-source editions only: no React Flow Pro, no paid Tiptap. After a
  dependency change, run `node scripts/third-party-notices.mjs` and the
  license audits.
- **Status is earned.** Mark a requirement Verified in
  [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md) only after its acceptance
  criteria in [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) were exercised.
  Report test results only from commands you actually ran.
- **One release at a time.** The current release is finished before the next
  starts. Ideas for later go into the backlog in the feature matrix.
- **Brand assets.** For icons and artwork, see
  [docs/brand/ASSETS.md](docs/brand/ASSETS.md).

## Clean room

VUECraft reproduces user-facing behavior of Tufts University's Visual
Understanding Environment (VUE) without using its implementation. The rules in
[docs/CLEAN_ROOM.md](docs/CLEAN_ROOM.md) bind every contributor. In short:

- Never consult VUE's implementation: its source code, its repository or any
  mirror, Java or class files, Castor mappings, decompiled binaries, or notes
  derived from any of these. Don't ask a person, agent or tool to do it for
  you, and don't post or link such material in issues, discussions or pull
  requests.
- Don't copy VUE's icons, fonts, artwork, branding or documentation prose.
- Permitted evidence: VUE's public user documentation, the running
  application and screenshots of it, `.vue` files you created with it, public
  format specifications, and this project's own specification. Log every piece
  of compatibility evidence you use in
  [docs/PROVENANCE.md](docs/PROVENANCE.md).

If you work with an AI coding agent, [AGENTS.md](AGENTS.md) applies to it too.

## Licensing

VUECraft is licensed under either of the
[Apache License, Version 2.0](LICENSE-APACHE) or the
[MIT license](LICENSE-MIT), at your option.

Unless you explicitly state otherwise, any contribution intentionally
submitted for inclusion in the work by you, as defined in the Apache-2.0
license, shall be dual licensed as above, without any additional terms or
conditions.
