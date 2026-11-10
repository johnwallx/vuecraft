# Changelog

All notable changes to VUECraft are recorded here. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-beta.1] - 2026-11-09

First public beta, for Windows 11 x64.

### Added

- Concept-map editor: create concepts and labeled links, edit labels in
  place, select several items, copy, paste and duplicate, resize, and undo or
  redo any edit.
- Styling: four node shapes, fill and border colors, link colors,
  arrowheads, straight or curved links, and light, dark and system themes.
- Zoom, pan, Fit and Zoom to Selection.
- Groups (R1.1): group and ungroup; dragging a group moves its contents.
- Layers (R1.2): add, rename, reorder, hide, lock and delete layers, and move
  the selection to another layer.
- Rich text (R1.3): bold, italic, bulleted and numbered lists, line breaks
  and links. Pasted formatting is filtered, and links are inert in the view.
- Attachments (R1.4): web links, local file references (missing files are
  flagged) and one embedded image per concept (PNG, JPEG, GIF or WebP, up to
  5 MB). Links and folders open only after you confirm.
- Files: New, Open, Save and Save As with crash-safe writes and a prompt for
  unsaved changes; the native `.vuecraft` format (versioned JSON); export to
  SVG.
- Per-user Windows installer that needs no administrator rights and registers
  `.vuecraft` files, so double-clicking one opens it.
- Files from development builds (`.mapw`) open through the Open dialog and
  are saved as VUECraft documents.

### Known limitations

Windows 11 only, and the installer is unsigned. Not included yet: search,
align and auto-layout (R1.5), paragraph alignment, legacy `.vue` import (R2),
pathways and presentation (R3), map merging (R4), PNG export, and copying
concepts through the system clipboard. Text that doesn't fit a node (after
shrinking it, or in an opened file) is clipped until you resize the node, and
maps of about 1000 nodes drag at
12–15 fps. The full list is in the
[release notes](docs/RELEASE_NOTES_v0.1.0-beta.1.md) and
[docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md).
