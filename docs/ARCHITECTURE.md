# Architecture

```
React + React Flow (src/)  ──invoke──▶  Tauri shell (src-tauri/)  ──▶  map-core (crates/map-core/)
  interactive state                        one Session per window         canonical document,
  (drag, select, zoom)       ◀─snapshot──  file dialogs (plugin)          ops, undo, files, SVG
```

## Ownership

- **`crates/map-core`** (pure Rust, no Tauri) owns the persistent model:
  - `model.rs`: Document, Node, Edge and styles. Integrity rules: unique ids
    across nodes and edges, existing and distinct edge endpoints, finite
    bounded geometry, `#rgb`/`#rrggbb` colors only.
  - `session.rs`: semantic `Op`s and atomic `Transaction`s, undo/redo and
    dirty tracking.
  - `io.rs`: versioned JSON with atomic writes.
  - `svg.rs`: whole-document export, and the canonical edge geometry.
- **`src-tauri`** keeps one `Session` plus the current path behind a mutex.
  - The document commands (`doc_get/new/apply/undo/redo/open/save`) each return
    a full `Snapshot`.
  - Further commands: `export_svg`; `image_import` and `image_data` for
    embedded images; `resource_status` and `resource_open` for attachments
    (opened from Rust after the user confirms; the webview has no opener
    permission).
  - `launch_path` hands out once the file the app was started with (a
    double-clicked `.vuecraft`), and the UI opens it through the normal Open path.
  - `test_seam_enabled` always answers false outside test builds.

  The capability grants only core defaults, window title/close/destroy, and
  the open/save dialogs.
- **`src/`** owns the transient interaction state: React Flow nodes and edges,
  selection, drag previews, viewport, the editing state, and the theme.

## Synchronization

1. React Flow applies pointer changes locally (drag, resize preview, selection).
2. When a gesture completes (drag stop, resize end, label commit, connect,
   style change, delete, paste), the UI sends one `Transaction`:
   `{ baseRevision, label, ops[] }`.
3. Rust applies every op or none. It rejects a stale `baseRevision`, records
   inverse ops as one undo entry, and skips history for no-op transactions.
4. The UI replaces its state with the returned snapshot. It keeps selection,
   and keeps the transient geometry of nodes still being dragged or resized.
5. Calls go through a single promise queue (`src/state/session.ts`), so
   each transaction uses the latest accepted revision and responses arrive
   in order. When a call is rejected, the UI shows the error and reloads the
   canonical state, so a rejected drag snaps back.

Dirty tracking uses state ids, so undoing back to the saved state clears
"Unsaved changes".

## File format (`.vuecraft`)

The R0 core of a file (schema 1). Schema 2 adds the optional fields described
in the sections below; the app writes schema 2.

Development-era files (working name Mapwright) use the `.mapw` extension and
the format marker `"mapwright"`. They open like native files (the Open dialog
accepts both extensions) and are written with the `"vuecraft"` marker on save.
Nothing else in them changes. The installer registers only `.vuecraft`; `.vue`
is left for a future legacy importer (R2).

```json
{ "format": "vuecraft", "schemaVersion": 1, "title": "",
  "nodes": [{ "id": "…", "label": "…", "x": 0, "y": 0, "width": 160, "height": 56,
              "style": { "shape": "rounded", "fill": "#fde68a", "stroke": "#7f1d1d" } }],
  "edges": [{ "id": "…", "source": "…", "target": "…", "label": "supports",
              "style": { "color": "#065f46", "arrow": "end", "curve": "straight" } }] }
```

- Omitted colors mean the theme default.
- Unknown fields at the document, node and edge levels are kept and written
  back unchanged.
- Loading checks the format marker and schema version first, then the full
  document.
- Files over 64 MB are refused.
- Saving writes a sibling temp file, `fsync`s it, then renames it over the
  target.

## Groups (schema 2)

A group is a node with `"kind": "group"`; members carry `"parent": "<group id>"`.
Positions are absolute in the file and engine; only the React Flow mapping
converts members to parent-relative positions (`parentId`). Rules enforced in
`map-core`: one level, members are concepts, links never attach to groups.
The engine re-fits a group around its members after any member change and
records the previous bounds in the inverse op, so undo is exact. Deleting a
group equals Ungroup (members stay).

Schema 2 adds only optional fields; schema-1 (R0) files open unchanged and are
written back as schema 2 on save (`io::migrate`). An R0 build refuses schema-2
files with a clear version message instead of misreading them.

## Layers

`layers` (bottom to top) hold `visible`/`locked`; every node and link names its
layer (files without layers get one "Layer 1"). The engine enforces locks: each op
lists the layers it touches (including cascades) and is refused if any is locked.
Visibility is a view concern: hidden objects are not rendered, selectable or
hit-testable, links are hidden when either end is, and SVG export skips them. Group
members always share their group's layer.

## Rich text

`text` holds a small ProseMirror-JSON subset (paragraphs, hard breaks, bullet and
numbered lists, bold, italic, links), validated by `rich.rs`. Link targets must be
http, https or mailto, nesting is capped at 16 and size at 5,000 items, and any
other node or mark type is refused. `label` is always the plain-text projection,
so search, SVG export and older readers keep working. An unformatted edit stores
a plain label and drops `text`. The editor is open-source Tiptap with the
matching extensions only. Pasted HTML goes through the same schema, so scripts,
images and unknown markup never reach the document. Links in the view are inert
text, not anchors.

## Attachments and images

`resources` on a node lists links (http/https/mailto) and absolute file paths
(at most 20). The engine stores them and never resolves them. The shell opens a
link in the default browser or shows a file in its folder (never runs it), only
for an attachment stored in the document and only after the UI asks the user.
The webview has no opener permissions. File-existence checks skip network (UNC)
paths so that opening a document never contacts a remote server.

`image` names an embedded image in `assets` (keyed by SHA-256). Insert Image
reads at most 5 MB from a file the user chose and accepts only PNG, JPEG, GIF or
WebP by content. Loading re-verifies type, size and checksum. Adding image bytes
is not an undoable edit; showing one on a node is (`SetNodeImage`). Images no
node shows are dropped on save. Snapshots omit image data; the UI fetches each
image once by id. SVG export embeds images as data URLs.

## Edge geometry

Edges attach to node outlines along the line between centers. Curved edges are
quadratic curves bending left of the travel direction. `svg.rs` defines this,
and `src/canvas/geometry.ts` mirrors it so the screen and the export match.
Parity tests use the same numbers on both sides. React Flow still provides the
connection handles, edge hit testing and markers.

## Testing layers

| Layer | Tool | Location |
|---|---|---|
| Engine | `cargo test` | `crates/map-core/src/*` |
| UI units and integration | Vitest + Testing Library; React Flow in jsdom with a mocked Tauri IPC | `src/**/*.test.ts(x)` |
| Desktop end-to-end | WebdriverIO + `@wdio/tauri-service` with the embedded WebDriver server, in a test build (Windows) | `tests/wdio/`, run by `scripts/desktop-e2e.mjs` |
| Installer | PowerShell + Windows UI Automation against the installed production build | `tests/installer/installer-test.ps1` |
| Clean-room guard | `node --test` | `tests/cleanroom/` |

The test build adds the embedded WebDriver plugins (`--features e2e-webdriver`)
and a file-path seam (`VITE_E2E_WDIO=1`, then only when `VUECRAFT_TEST_SEAM` is
set). The seam is `window.__vuecraft`, which runs the same commands the toolbar
runs after its dialog returns. Release builds contain neither.

The installer test covers the native dialogs. It types a path into the real
Save As, Open and Export dialogs under `Documents\VUECraft install test <time>`
and cancels the dialog if the typed path doesn't read back exactly, so it never
saves anywhere else. It opens files through the `.vuecraft` association, opens
a development-era `.mapw` document (`tests/fixtures/native/r1-full.mapw`) and
checks it saves as `.vuecraft` losslessly, and checks that `.vue` and `.mapw`
registrations are left alone.

The earlier Playwright suite (`tests/e2e/`, over the WebView2 DevTools port) is
kept as reference only and is not part of the gates.
