# Clean-room process

VUECraft (developed under the working name Mapwright) reproduces useful
*user-facing behavior* of Tufts VUE without using VUE's implementation. This file records the rules, how they are enforced, and
the limits of that enforcement. It is not a legal certification.

## Rules

Prohibited for every person, agent, subagent, tool, and service working on this repository:

- Cloning, browsing, downloading, or searching VUE's source code, its repository
  (the `VUE` organization on GitHub), any mirror or archive of it, or historical patches.
- Reading Java sources, class files, Castor mapping files, or the class hierarchy.
- Decompiling or disassembling VUE binaries.
- Translating VUE methods or reconstructing its algorithms or architecture.
- Copying VUE icons, fonts, logos, artwork, branding, or documentation prose.
- Asking another agent or service to do any of the above, or reusing notes derived from it.

Permitted evidence: public user-facing VUE documentation, observing the running
application, screenshots of it, `.vue` documents we create with it and the XML
visible inside them, public format specifications, this project's own
specification, and documentation of the third-party libraries we use. Every use
of such evidence is logged in `docs/PROVENANCE.md`.

## Enforcement status (verified 2026-11-09, row 7 on 2026-11-10)

| # | Safeguard | Status | Evidence |
|---|---|---|---|
| 1 | Fresh workspace without VUE source | **Yes** | The project folder was empty at session start (`ls -la`); no `.java`, `.class`, or VUE archives present. |
| 2 | No inherited project context | **Partly** | No project memory, CLAUDE.md, or prior files existed. See "Model knowledge" below for the limit. |
| 3 | Claude Code permission restrictions | **Yes, limited** | `.claude/settings.json` `permissions.deny` blocks known code-search hosts and Java file reads/edits, plus a few Bash/PowerShell repository patterns. Pattern-based, so easy to sidestep alone. |
| 4 | Tested `PreToolUse` guard | **Yes** | `.claude/hooks/cleanroom-guard.mjs` runs on every tool call (`matcher: "*"`): shell, web fetch/search, file tools, Agent/Workflow delegation, MCP connectors. `pnpm test:guard` covers 35 deny cases, 14 allow cases, and fail-closed handling of bad input (50/50 pass). Live probes in this session were denied for Bash, PowerShell, Read, ToolSearch and Agent; see `.claude/audit/cleanroom-guard.jsonl`. |
| 5 | Network restrictions | **No** | Nothing outside the model blocks the network. GitHub serves the prohibited repository from the same hosts as permitted dependencies, so blocking by host or IP would also break builds, and path-level blocking needs a TLS-inspecting proxy. |
| 6 | Session transcripts and audit records | **Yes** | `PreCompact`/`SessionEnd` hooks copy each transcript to `.claude/audit/transcripts/` (git-ignored: may contain local paths; archive it to write-once storage). `cleanupPeriodDays: 3650` keeps Claude Code's own copies. Guard decisions append to `.claude/audit/cleanroom-guard.jsonl` (kept locally, not committed). The guard went live about 10 minutes into the first session. Earlier calls (listing the workspace, installing the toolchain) are recorded only in that session's transcript. |
| 7 | Outward and credential guard | **Yes** | A second `PreToolUse` hook, `.claude/skills/clean-room/scripts/cleanroom-guard.mjs` (config `.claude/cleanroom.json`; its name rule is off because guard 4 checks names), denies push, remote add/set-url, `git credential`, GitHub writes, writing HTTP requests and publishing; `permissions.deny` repeats the main ones in case Node fails. `pnpm test:guard` runs its 29 tests and the audit's 9 (88/88 with guard 4's). A live probe was denied on 2026-11-10. Decisions go to `.claude/audit/outward-guard.jsonl` (git-ignored). |

Rows 3, 4, 6 and 7 are local safeguards. `.claude/` is gitignored, so the
permission settings, the `PreToolUse` guards, hooks, skills and agents, the
guard logs and the archived transcripts exist only in the maintainer's local
working copy and are not distributed in the public repository. The public
repository does include the guard tests (`tests/cleanroom/`) and the harness
tests (`tests/harness/`); both skip, through `scripts/if-present.mjs`, when
`.claude/` is absent.

### What the guard does

It normalizes every string in a tool call (URL decoding, removing shell quotes
and escapes, lowercasing), then checks it against rules for:

- the repository slug and organization on code hosts;
- string-concatenated forms of the slug;
- `gh` CLI access to that organization;
- the Java package path;
- `.java`/`.class` access;
- JAR extraction and decompilers;
- Castor mapping lookups;
- VUE-plus-source searches;
- source-code mirrors;
- encoded-command execution it cannot inspect.

Any internal error results in a deny.

### Known false positives

Shell commands that mention the original project together with words like
"source" or "repository" are denied, even when they only write documentation.
This happened once in this session, while writing `NOTICE` through a shell
heredoc. Write prose with the file tools instead: they scan only the path, plus
the content of executable files.

### Known gaps

The guard is a tripwire, not a sandbox:

- **Shell indirection.** A shell that builds a URL from variables at runtime, or
  a binary that fetches on its own, is not seen.
- **Script content.** Content written to non-script files is not scanned.
- **Network.** Item 5 above.
- **Search results.** Web search results and fetched pages are not filtered.
  Only the requests are.
- **Missing script.** If the hook script is deleted, Claude Code treats the
  failure as non-blocking.

For strict separation, run implementation sessions in a VM or container whose
egress goes through an allowlisting proxy: npm registry, crates.io and
static.crates.io, static.rust-lang.org, Tauri and React Flow documentation, and
the rustsec advisory database. Deny `github.com/VUE/*` and known mirrors.

## Model knowledge

The implementation agent is a large language model trained on public internet
data, which may have included VUE's public source code. This session:

- did not consult that knowledge;
- did not access any VUE material, documentation included;
- built every behavior from the functional requirements in
  `docs/PRODUCT_SPEC.md` and independent design.

Using a new AI session does **not** by itself establish independent development.

## Independent review

Not yet performed. Before any clean-room claim, a reviewer who has not accessed
VUE source should check `docs/PROVENANCE.md` against the code and compatibility
fixtures, then record the result there.
