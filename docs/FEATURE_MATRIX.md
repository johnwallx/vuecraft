# Feature matrix

Statuses: Not started · In progress · Implemented, unverified · Verified · Blocked.
**Verified** means the acceptance criteria in `docs/PRODUCT_SPEC.md` (spec 1.0)
were exercised by the tests named. Evidence date: 2026-11-09, Windows 11 x64.

VUECraft was developed under the working name Mapwright. Evidence recorded
before the rename (commit `0628d04` and earlier) refers to Mapwright builds,
`mapwright.exe` and `.mapw` files. Every automated suite and the installer test
were rerun after the rename (see "Desktop verification").

Test sources:

- **WDIO**: `tests/wdio/*.e2e.ts`, the desktop E2E in the default gates
  (`pnpm test:desktop`). It drives the real app (test build with the embedded
  WebDriver plugin) through WebdriverIO.
- **Installer**: `tests/installer/installer-test.ps1`. It installs the production
  NSIS package and drives the installed release build through Windows UI
  Automation and the real Open/Save dialogs, then uninstalls it.
- **E2E**: `tests/e2e/desktop.spec.ts`, the earlier Playwright suite. It drove
  the real app through WebView2 DevTools and is kept as reference only (see
  Known defects). Its 2026-11-09 results are cited below.
- **Rust**: `crates/map-core` unit tests.
- **UI**: Vitest (`src/**/*.test.ts(x)`).

## R0: Functional editor

| ID | Status | Evidence | Notes |
|---|---|---|---|
| R0.1 Launch | Verified | E2E step 1: blank document, toolbar, clean state. E2E step 19: New and window close prompt. UI: Ctrl+N prompt. | Open uses the same confirmation path as New. No network access: CSP allows only IPC. |
| R0.2 Node creation | Verified | E2E steps 2–3 (double-click at the clicked point, then immediate labeling), "more R0 editing" (toolbar Add Node). Rust: duplicate ids rejected. UI: create + label commit. | Ids are `crypto.randomUUID()`; Rust validates uniqueness. |
| R0.3 Label editing | Verified | E2E: replace text, Shift+Enter multiline, Escape cancel, dragging inside the editor leaves the node in place, label shown equals the stored value. UI: LabelEditor tests (Enter, Shift+Enter, Escape, single commit on blur, keys isolated). | Plain text. Rich text is R1.3. |
| R0.4 Geometry | Verified | E2E: drag at zoom 1 and at about 1.7× (stored move = screen move ÷ zoom), resize via corner handle, handles only on the selected node, geometry identical after save/reopen. Rust: moves never change labels or edges. | |
| R0.5 Connections | Verified | E2E: connect through handles (also when zoomed), endpoints on node outlines both mid-drag and after, edge selection, delete and undo, edge label edit, color, arrows on both ends, curve. Rust: endpoint validation, cascade delete. | Edges attach to outlines (floating), not to fixed handle points. |
| R0.6 Selection | Verified | E2E: click, Ctrl-click, rectangle select, click empty canvas clears, Delete, multi-node drag keeps relative offsets, copy/paste (new ids, internal edge kept, pasted items selected). UI: `cloneWithNewIds`. | Ctrl+D duplicate uses the same tested code as paste. Clipboard is in-app only. |
| R0.7 Viewport | Verified | E2E: wheel zoom keeps the point under the cursor fixed (< 1 flow unit drift), middle-drag pan, Zoom to Selection, Fit shows all nodes, document unchanged by viewport changes, connect and drag hit-testing correct when zoomed. | Space+drag and right-drag pan are also enabled. |
| R0.8 Styling | Verified | E2E: shape, fill, border, edge color, arrow, curve set through the inspector and identical after reopen. Light and dark screenshots reviewed (`test-results/desktop/12-*.png`). | Text color follows fill luminance. Theme defaults are stored as "no color". |
| R0.9 Undo/redo | Verified | Rust: create, move, label, style, resize, connect, delete (cascade restore), atomic failure, no-op without history, stale rejection, dirty tracking. E2E: multi-node move is one step, label undo and redo, node delete/undo/redo, edge delete/undo, paste undo, zoomed drag and connect undo. UI: Ctrl+Z ignored while typing. | History capped at 500 steps. |
| R0.10 Native files | Verified | Rust: round-trip, unknown fields kept, bad JSON / wrong format / missing or newer schema version / dangling edge / duplicate id / unknown shape errors, atomic overwrite, failed save keeps the old file, no temp leftovers. E2E: Save As, close, relaunch, reopen with an identical document, Ctrl+S, invalid files refused with messages, dirty indicator, Save/Don't Save/Cancel on New and on close. E2E: native Save As, Export and Open dialogs open, cancel cleanly, and accept the default path. | Typed paths in the real Open, Save As and Export dialogs are covered by the installer test (production build). The E2E suites choose files through the test seam (`window.__vuecraft`). Development-era `.mapw` files open and save as `.vuecraft` (Rust tests; installer test). |
| R0.11 Export | Verified | Rust: well-formed XML, includes far-off nodes, framed to bounds, escaping. E2E: export, then open in a separate Microsoft Edge instance (3 nodes, 2 edges, all labels; screenshot `17-exported-svg-in-edge.png`); document stays clean. | PNG export not implemented (optional). |
| R0.12 Reliability | Verified | E2E: invalid documents leave the open map untouched, one session runs all 19 steps without restart, reopens its own files. Rust: integrity enforced on every op and on load and save. UI: rejected edit shows an alert and resyncs. | Every toolbar control is functional. |
| R0 performance smoke (100 nodes) | Verified | `docs/BENCHMARKS.md`: opens in 66 ms, 60 fps while dragging. | 1000 nodes drags at about 12–15 fps (backlog). |

**Desktop verification (v0.1.0-beta.1):**

- WebdriverIO, test build (`node scripts/desktop-e2e.mjs`, no retries). Each spec
  runs in its own app process:
  - `poc`: create and label nodes, drag, connect, save (the file is validated on
    disk).
  - `reopen`: a new process with a different PID and an empty document reopens
    the file. Ids, labels, positions, edges and layers are identical.
  - `r1`: R1.1–R1.4 (see below).
- Installer test on the production VUECraft package. It covers:
  - the installed license files and third-party notices, including
    Microsoft's WebView2 loader notice;
  - the real Save As, Open and Export dialogs;
  - double-click opening of `.vuecraft` (shell association);
  - a development-era `.mapw` document (group, layers, connection, rich text,
    attachments, image) opened through Open and saved as `.vuecraft`
    losslessly;
  - `.vue` and `.mapw` registrations left untouched;
  - uninstall keeping all user documents.
- Manual checks on the installed VUECraft release build: 19/19 (see below).
- The release build contains neither the WebDriver plugin nor the test seam
  (string scan of the binary and the frontend bundle).
- Results and checksums for the published installer are in its GitHub release
  description and `SHA256SUMS.txt`.

The R0 rows above cite the earlier Playwright suite. The WebdriverIO `poc` and
`reopen` specs re-cover the core of R0.2, R0.4, R0.5 and R0.10 in the real app.

## Later releases

| Release | Status | Notes |
|---|---|---|
| R1.1 Groups | Verified | Rust: fit without moving members, group drag moves members (one undo step), member move/add/remove re-fits with exact undo, ungroup and delete keep members, nesting/regrouping/links-to-groups/bad parents rejected (ops and file load). E2E "R1.1 groups": Ctrl+G on a rectangle selection, members unmoved, group drag + undo/redo with links (incl. to an outside node) attached, member move re-fits, rename, nesting rejected with message, save/relaunch/reopen identical, ungroup + undo, Delete keeps contents, SVG export draws the group. WDIO `r1`: rectangle selection, then Group in the real app (members checked), unchanged after save and reopen. | One level only. Bounds are always fitted by the engine (no manual group resize). Links attach to concepts, not groups. Selected connections are ignored by Group. Stacking follows the document (selection no longer raises nodes). |
| R1.2 Layers | Verified | Rust: add/rename/hide/lock/reorder/delete with exact undo; every edit kind rejected on a locked layer, including cascades (deleting a node whose link sits on a locked layer); links may target locked nodes; delete-with-reassignment and undo; groups carry members, members cannot leave alone, grouping requires a shared layer; file validation (missing/duplicate layers, member/group mismatch); export skips hidden layers and links touching hidden nodes and orders by layer. UI: mapping of hidden/locked/zIndex. E2E "R1.2 layers": add layer becomes active, hide hides nodes + attached link and excludes them from rectangle selection, lock blocks drag/delete/relabel/inspector edits and new content, move selection, rename, reorder, 3-step undo, cross-layer grouping, delete with confirmation + undo, persistence across relaunch, SVG skips hidden content. WDIO `r1`: hiding Layer 1 unrenders all its nodes and stores `visible: false`; showing it brings them back. | Links always draw beneath nodes; layer order stacks nodes. New content (create, connect, paste, duplicate) goes to the active layer and is refused with a message when that layer is hidden or locked. Grouping across layers moves members to the first selected node's layer in the same transaction. Deleting a layer moves its items to the layer below (or above for the bottom layer) after confirmation. Undoing an edit is refused while its layer is locked; undo the lock first. |
| R1.3 Rich text (Tiptap) | Verified, except paragraph alignment (not implemented) | WDIO `r1`: text typed in the real app with Ctrl+B bold is stored as structured rich text (`bold` mark on "strong"), rendered as `<strong>`, and identical after save and reopen. Rust: plain-text projection (lists, continuation lines), rejection of unknown nodes/marks, script and unsafe link targets, depth/size limits, formatted↔plain undo, file round trip with label following text. Vitest: helpers, inert link rendering, editor keeps links and bold when content becomes a list. Desktop E2E "R1.3 rich text" (2026-11-09, debug build): steps 1–4 (bold/line break/link, lists, unsafe link refused, sanitized paste) passed in the real app in 3 runs; step 5 (persist, relaunch, export, links inert) has not completed inside the 45 s bound because those sessions degraded mid-test (known defect). The stored document at step 5 was checked and is correct. Persistence is now covered by WDIO `r1`. The manual checks on the installed release build (bold, list, link, click away, save, reopen; formatted paste; link inert in the view) passed. | Paragraph alignment (spec R1.3) is not implemented; it is deferred past the beta. Bold, italic, bulleted/numbered lists, hard breaks, http/https/mailto links. Links are inert in the view. Unformatted edits are stored as a plain label. |
| R1.4 Resource attachments | Verified | Rust: resource rules (URL schemes, absolute paths, limits, network-path detection), image sniffing/size/checksum, tampered or dangling images rejected on load, SetNodeResources/SetNodeImage undo, unused images not saved, SVG embeds the image above the label. Vitest: link validation, open only after confirmation (Cancel opens nothing), attach via chooser, missing-file flag, insert/reject/remove image, paste drops images the document lacks. Desktop E2E "R1.4 attachments and images" passed end to end (2026-11-09, debug build, 3.0 s, on retry after an infrastructure-degraded first attempt): link validation, file reference + missing-file flag, Open asks first, image rejected by content, embed, undo/redo, copy, save + relaunch + reopen, SVG export, image no node shows is not saved. WDIO `r1`: a link, a file reference (via Attach File…) and an embedded image added in the real app. The document and its images are identical after save and reopen. Actually opening a link and showing a file launch other apps, so the automated suites don't do them. They passed in the manual checks on the installed release build. | Links (http/https/mailto) and absolute file paths, max 20 per node; one embedded PNG/JPEG/GIF/WebP image per concept, max 5 MB. Files are never opened, only shown in their folder. Network paths are never checked automatically. Attachment titles are not editable yet. |
| R1.5 Search, align, distribute, auto-layout | Not in v0.1.0-beta.1 | Planned next. An unfinished development prototype exists outside the public repository; the public work is described in the R1.5 issues. |
| R2 Legacy `.vue` import | Blocked | No reference fixtures V01–V06 (`docs/COMPATIBILITY.md`). |
| R3 Pathways and presentation | Not started | |
| R4 Map merging, metadata | Not started | |

## Known defects

| Defect | Evidence | Status |
|---|---|---|
| Desktop E2E sessions are intermittently degraded: WebView2 DevTools commands (input, DOM queries, script calls, even `Page.enable`) answer after quantized 0.9 / 2.1 / 4.5 s delays from the first command after connecting, so tests stall | Controlled runs, R0 only, sequential, no retries (2026-11-09): isolated profile + protocol log 4/10 passed; fresh isolated profile, no logging 2/10; original launcher (earlier sequential suite runs) 3/10 attempts. Healthy sessions: every command within 193 ms, R0 in ~8 s. Degraded sessions: slow from the first command, before the app is exercised; failure diagnostics show page, IPC and window responsive and the app main thread idle. Profile isolation, launcher version, logging and build type did not change the pattern (writing app logs to a pipe made it worse and was removed). A standalone launch with steady traffic did not degrade in 6 runs. Failures cluster in time. | **Resolved by replacing the automation channel (2026-11-09).** Desktop E2E now uses WebdriverIO + `@wdio/tauri-service` 1.5.1 with the embedded WebDriver server (`tauri-plugin-wdio-webdriver` 1.5.1 + `tauri-plugin-wdio` 1.5.1, compiled in only with `--features e2e-webdriver`), which drives WebView2 through its in-process host API instead of the DevTools port. Proof of concept, 3/3 consecutive runs without retries, ~17 s each: create + edit two nodes through the UI, pointer drag, connect, real IPC, save (file on disk validated), then a new app process (different PID, empty document) reopens the file with identical ids, labels, positions, edges and layers. Not root-caused for the legacy suite: an independent review matched the delays to Windows TCP retransmission timing (min RTO 300 ms), but a loopback echo monitor stayed clean (13,341 round trips, max 3 ms) during the WebdriverIO runs. The Playwright/CDP suite is kept as reference only (`pnpm test:e2e:playwright-legacy`), outside the gates. Known driver limits: no synthetic `dblclick` (tests use Add Node), one event per pointer-move action (drags use several moves). |
| Uninstalling left `HKCU\Software\Classes\.mapw` behind, holding a `Mapwright Map_backup` value | Installer test (2026-11-09). Tauri's NSIS uninstaller restores the previous default but keeps the backup value and the key. | **Fixed (b530357):** the `NSIS_HOOK_POSTUNINSTALL` hook (`src-tauri/windows/hooks.nsh`) removes the value, then removes the key only if no other program owns the extension. The installer test checks it. |
| Double-clicking a `.mapw` file started Mapwright with an empty map. The installer registers the association, but the app ignored the file it was started with. | Found during the release review (2026-11-09). No code read a launch argument. | **Fixed (cf317c4):** `launch_path` hands out the path once, and the UI opens it through the normal Open path, with errors shown in the banner. Covered by a Vitest test and by the installer test, which opens the saved file through the association. |
| Arrow keys moved a selected concept on screen without changing the document: React Flow's keyboard move doesn't fire `onNodeDragStop`, where moves are committed, so the move could not be undone and was lost on save | Found while drafting the accessibility issue (2026-11-09). Reproduced in Vitest: the node's transform changed from `translate(0px)` to `translate(5px, 5px)` and no transaction was sent. | **Fixed (03b1421):** arrow keys outside text editors no longer reach React Flow's node handlers, and the Vitest test covers it. Concepts can't be moved with the keyboard until keyboard moves are committed as transactions (accessibility backlog). |
| The third-party notices lacked Microsoft's notice for the WebView2 loader, which `webview2-com-sys` links statically into the executable (`WebView2LoaderStatic.lib`). Crate metadata shows only the crate's own MIT license. | Found in the license review (2026-11-09). The loader is byte-identical to the one in Microsoft Edge WebView2 SDK 1.0.3800.47, whose BSD-3-Clause-style license requires the notice in binary distributions. | **Fixed (1f855be):** the notices generator adds the SDK's `LICENSE.txt` and `NOTICE.txt` verbatim and fails if the loader changes. The installer test checks the installed notices. The first VUECraft installer lacked the notice and was replaced before publication. |

### Manual desktop checks (installed release build; not covered by WebdriverIO)

Run twice on 2026-11-09, 19/19 both times:

- On the pre-rename Mapwright release candidate (`0628d04`).
- On the final VUECraft `0.1.0-beta.1` application code, installed from the
  first VUECraft installer (installed `vuecraft.exe` SHA-256
  `9A883E26…01528E1`). That installer was replaced only to add Microsoft's
  WebView2 notice; the application source is unchanged. In this run, Open
  Link was checked against a per-run token in the browser's address bar.

Real mouse clicks and keystrokes were driven by a one-off script that is not
part of the repository. It refuses to click or type unless the app owns the
foreground window. Evidence (screenshots and the saved maps) is in
`Documents\VUECraft manual check 20261109-173257` on the test machine.

| Check | Covers | Result |
|---|---|---|
| Format a label (bold, list, link), click away, save, reopen | R1.3 | **Passed.** Ctrl+B bold, then the format bar's Bulleted list and Link (`https://example.org/manual`) buttons. Click away, Save As via the real dialog, close, relaunch, Open via the real dialog. Stored as a `bulletList` with a `bold` mark and a `link` mark; the reopened node shows the bullet, bold and link. Clicking the link in the view opened nothing. |
| Paste formatted text; scripts and images dropped | R1.3 | **Passed.** The clipboard held HTML in the CF_HTML format browsers write (set with `Set-Clipboard -AsHtml`, not copied from a real browser). It contained bold, italic, a safe and a `javascript:` link, a `<script>`, a remote `<img>` and a list. Kept: bold, italic, the safe link and the list. Dropped: the unsafe link (its text kept), the script and the image. |
| Open Link opens the browser; Show in Folder opens Explorer with the file selected; nothing executed | R1.4 | **Passed.** After confirmation, Open Link opened the attachment's address in the default browser (Chrome, "Example Domain"; the final run's address bar showed its unique token). Show in Folder opened Explorer at the folder with `notes.txt` selected, and no editor or other program opened the file. |

## Platforms

| Platform | Status |
|---|---|
| Windows 11 x64 | Verified (build, Rust, UI, desktop E2E, installer install/uninstall) |
| macOS | Not started (no runner) |
| Ubuntu 24.04 | Not started (no runner). Desktop E2E is Windows-only; Linux would need WebDriver. |

## Release readiness

| Item | Status |
|---|---|
| Rust dependency licenses (`cargo deny check`) | Verified. Four documented advisory exceptions, all for unmaintained crates with no known vulnerability, all Linux-only and none in the Windows build (`docs/RISK_REGISTER.md`): RUSTSEC-2024-0370 (Tauri's GTK stack, compile-time) and RUSTSEC-2026-0370/0371/0372 (zbus via the opener plugin). They are accepted risks, not resolved issues. |
| JS dependency licenses (`pnpm run audit:licenses`) | Verified |
| Third-party license file shipped in installers | Verified. The installer test checks that `LICENSE-MIT`, `LICENSE-APACHE` and `THIRD_PARTY_NOTICES.md` are installed, and that the notices include Microsoft's WebView2 loader license and notice. `node scripts/third-party-notices.mjs --check` keeps the notices current. |
| Installer install/uninstall test | Verified (`tests/installer/installer-test.ps1` on the published installer; results in its GitHub release description) |
| Production build free of test interfaces | Verified. The WebDriver plugins and the test seam are compiled in only with `--features e2e-webdriver` and `VITE_E2E_WDIO=1`. A string scan of the release binary and `dist/` finds neither. |
| Code signing | Not started. The beta is unsigned, so SmartScreen will warn. |
| Provenance independent review | Not started |
| IP/trademark review, final product name | Name VUECraft and the interim elephant icon kept (2026-11-09). A focused name search (web, GitHub, npm, crates.io) was done; there has been no formal trademark clearance or IP review. |
| Security review | Not started |
| CI build matrix | Configured (`.github/workflows/ci.yml`). Not part of the local release verification; it first runs when the repository is pushed. |
| Repository audit before a public push | Prepared. The public repository is a fresh snapshot without the development history, the clean-room audit log or the private preparation notes. It uses the GitHub no-reply identity, and the audit of its exact history is recorded with the release. The development repository stays private. |

## Backlog

- Profile 1000-node dragging (MiniMap, inspector `useNodes`, edge subscriptions).
- PNG export (only if full-document capture is reliable).
- System clipboard integration for copy/paste.
- Native application menu (the toolbar covers R0).
- Measure text in SVG export instead of estimating it.
- Paragraph alignment in rich text (spec R1.3).
- Keyboard moves of concepts, committed as transactions (accessibility).
