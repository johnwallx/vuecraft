# VUECraft v0.1.0-beta.1 (Windows): release notes

*First public beta. Built on 2026-11-09 from the release source tree, which
matches the tagged release commit `v0.1.0-beta.1` in every build input; the tag
was created on that commit when the release was published. Tested on Windows 11
x64 on 2026-11-09.*

VUECraft is an independent, open-source concept-mapping editor inspired by the
user-facing functionality of Tufts University's Visual Understanding
Environment (VUE). It is not an official Tufts University or College of
Charleston project, and it is not part of ArtCraft or any "Crafting Apps"
family. See [docs/CLEAN_ROOM.md](CLEAN_ROOM.md).

## What's in it

- **R0, the editor:** concepts, labeled links, styling, selection, zoom and
  pan, undo and redo, New/Open/Save/Save As with crash-safe writes, and SVG
  export.
- **R1.1 Groups:** group and ungroup; dragging a group moves its contents.
- **R1.2 Layers:** add, rename, reorder, hide, lock and delete layers.
- **R1.3 Rich text:** bold, italic, lists, line breaks and links. Text is
  stored as structured content, not HTML, and links are inert in the view and
  never opened on load.
- **R1.4 Attachments:** web links, file references (missing files are
  flagged), and one embedded image per concept (PNG, JPEG, GIF or WebP, up to
  5 MB). Links open, and folders are shown, only after you confirm.
- **Files:** the `.vuecraft` format (versioned JSON). Double-clicking a
  `.vuecraft` file opens it. Files from development builds (`.mapw`) open
  through **Open…** (`Ctrl+O`) and are saved as VUECraft documents.

Per-requirement evidence is in [FEATURE_MATRIX.md](FEATURE_MATRIX.md).

## Installing

- Requires Windows 11 x64. Run `VUECraft_0.1.0-beta.1_x64-setup.exe`. It
  installs for the current user, without administrator rights, into
  `%LOCALAPPDATA%\VUECraft`, and registers `.vuecraft` files. It does not
  register `.vue`, which is reserved for a future importer.
- **The installer is not code-signed.** Windows SmartScreen will show
  *Windows protected your PC*. Choose *More info*, then *Run anyway*, only if
  you downloaded the file from the official releases page and its SHA-256
  matches the one published with the release.
- VUECraft needs the Microsoft Edge WebView2 Runtime, which Windows 11
  includes. On a system without it, the installer downloads Microsoft's
  WebView2 bootstrapper.
- Uninstall from *Settings → Apps*. Uninstalling removes the program and its
  `.vuecraft` registration and keeps your documents.

## Artifacts (SHA-256)

The installer's SHA-256 checksum is in `SHA256SUMS.txt`. The release
description gives the checksums of both the installer and the installed
`%LOCALAPPDATA%\VUECraft\vuecraft.exe`.

The installed executable differs from the build output
(`target\release\vuecraft.exe`) in exactly 3 bytes. When packaging, Tauri
stamps the package type into the copy it installs
(`__TAURI_BUNDLE_TYPE_VAR_UNK` becomes `…_NSS`). Compare against the
installed checksum.

The version is `0.1.0-beta.1` everywhere: the manifests, the installer file
name, the Windows uninstall entry (publisher John Wall), and the executable's
file and product version.

## Verification

Run on 2026-11-09 on Windows 11 x64. The pass counts for the published
installer are in its release description.

**Source identity.** The installer was built on 2026-11-09 from a clean
checkout of the release source tree, with no local changes. The tag
`v0.1.0-beta.1` was created on the published commit when the release was
published. Compared file by file by Git blob hash, that commit matches the
build tree in every file that goes into the build; the differences are limited
to CI configuration, documentation, test-only code and development tooling
(lint and ignore settings, test scripts, and the local `.claude/` folder).
Bit-for-bit binary reproducibility is not claimed.

- **`node scripts/verify.mjs release`**, all gates:
  - rustfmt, frontend build, clippy, cargo test
  - eslint, typecheck, Vitest
  - clean-room guard tests, hook tests
  - `cargo deny`, the JS license audit, the third-party notices check
  - WebdriverIO desktop E2E: three specs, each in its own app process, no
    retries
  - release build and installer, then installer and license-file checks
- **Installer test** (`tests/installer/installer-test.ps1`) on the published
  installer. It covered:
  - Silent per-user install. The program, license files and third-party
    notices are installed, and the notices include Microsoft's WebView2
    loader license and notice. The uninstall entry reads VUECraft, 0.1.0-beta.1,
    John Wall, and the executable has the GUI subsystem, version and
    copyright.
  - `.vuecraft` is registered to the installed program. The existing `.vue`
    registration on the test machine was identical before and after install
    and uninstall, and `.mapw` was never registered.
  - Launch, then add a concept and save through the real Save As dialog.
    Relaunch as a new process and reopen through the real Open dialog. Open
    the file again by double-click (shell association).
  - A development-era `.mapw` document with a group, two layers, a
    connection, rich text, a web link, a file reference and an embedded
    image. It opens through the Open dialog and is saved as `.vuecraft`;
    only the format marker changes. It exports to well-formed SVG with its
    labels and image. The upgraded file opens by double-click, and the
    original `.mapw` is unchanged.
  - Silent uninstall removes the program, its uninstall entry and the
    association. All four user documents are unchanged.
- **Manual checks** on the installed release build, using real mouse clicks
  and keystrokes: **19/19 passed.** They ran on the first build of this
  version, before the installer was rebuilt to add Microsoft's WebView2
  notice. The application source did not change.
  - Rich text (bold, list, link) survives save and reopen; links are inert in
    the view.
  - Formatted paste keeps bold, italic, safe links and lists, and drops
    `javascript:` links, scripts and images.
  - After confirmation, Open Link opened the exact address in the default
    browser; the address bar showed a per-run token. Show in Folder opened
    Explorer with the file selected and ran nothing.
- **No test interfaces in the production build.** A string scan of the
  release executable finds no WebDriver server, `wdio` plugin or permission,
  and no test-seam variable. The production frontend bundle contains no
  `wdio` code and no `window.__vuecraft` seam.
- **README screenshots** were taken from the installed release build with the
  demo map `docs/assets/screenshots/demo-coral-reef.vuecraft`.

Silent uninstall leaves the WebView2 profile folder
`%LOCALAPPDATA%\io.github.johnwallx.vuecraft`, which holds only interface
state such as the theme. Delete it by hand if you want it gone.

## Beta limitations

None of these blocks the beta.

- Windows only. macOS and Linux builds are not built or tested.
- Rich text has no paragraph alignment, which spec R1.3 lists.
- A concept grows taller to fit its text when you finish editing. Text can
  still be clipped after you shrink a concept, or in an opened file whose text
  doesn't fit. Resize the concept to show it.
- Concepts can't be moved with the keyboard. Arrow keys don't move concepts.
- No search, align/distribute or auto-layout (R1.5).
- No legacy `.vue` import (R2). There are no reference fixtures yet.
- No pathways or presentation mode (R3), and no map merging (R4).
- No PNG export. Copy and paste work only inside the app.
- Attachment titles can't be edited, and a concept holds one image.
- SVG export estimates text width, so wrapping can differ slightly from the
  canvas.
- Each double-clicked file opens in its own window and process.
- About 1,000 concepts drag at 12–15 fps (100 concepts: 60 fps).

Defects found and fixed during release testing:

- Uninstall left the file-type registry key behind.
- Double-clicking a map didn't open it.
- The arrow keys moved a selected concept on screen without changing the
  document, so the move couldn't be undone and was lost on save.
- The third-party notices lacked Microsoft's notice for the WebView2 loader
  linked into the executable. The first installer build was replaced.

Details are in [FEATURE_MATRIX.md](FEATURE_MATRIX.md), "Known defects".

Test coverage notes (they don't affect the product):

- The desktop driver can't send a native double-click, so the E2E tests create
  concepts with *Add Node*. Double-click creation is covered by the UI tests.
- The E2E tests choose files through a seam that only test builds contain.
  The installer test and the manual checks cover the real Open, Save As and
  Export dialogs.

## Known gaps (not functionality)

1. **Code signing.** The installer and executable are unsigned.
2. **External reviews.** No independent provenance, IP, trademark or security
   review has been done. The clean-room record is the project's own account,
   not a legal certification.
3. **Branding.** The elephant icon is interim original artwork
   (`docs/brand/ASSETS.md`).
4. **CI.** This release was verified locally. The GitHub Actions workflow
   first runs when the repository is published.
5. **Accepted dependency risks.** Four `cargo deny` advisories are documented
   exceptions ([RISK_REGISTER.md](RISK_REGISTER.md)). All are unmaintained
   crates with no known vulnerability, used only on Linux.
