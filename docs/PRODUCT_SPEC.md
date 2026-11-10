# Product specification

**Spec version 1.0**, 2026-11-09. Derived from implementation directive v2.0.
A change to any acceptance criterion bumps the spec version and is recorded in
the change log at the end.

VUECraft (working name during development: Mapwright) is a local-first desktop editor for concept mapping, research
organization and presentation. It needs no network, account or server. It is
**not** a vector graphics editor, cloud whiteboard, diagramming suite, ontology
manager, workflow engine, or SaaS product.

## R0: Functional editor (current target)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| R0.1 | Launch | Opens to a usable window with a blank document. Menu or toolbar for essential actions. Opening a document never discards unsaved edits. No server or account. |
| R0.2 | Node creation | Double-click on empty canvas creates a node at that position. A toolbar alternative exists. Unique stable ids. New node can immediately be labeled. Nodes can be selected, moved, deleted. |
| R0.3 | Label editing | Double-click edits the label. Replace text. Multiline. No drag or pan while editing. Predictable commit. Cancel restores the old label. Displayed text equals the stored value. |
| R0.4 | Geometry | Explicit position and size. Drag selected nodes at any zoom. Resize, with handles shown only when appropriate. Geometry survives save/reopen. Moving never changes labels or edges. |
| R0.5 | Connections | Connect through visible handles. Stable edge ids. Edges stay attached and redraw while dragging. Delete edges. Deleting a node leaves no dangling edges. Arrowheads. Straight and curved edges. Editable edge labels. |
| R0.6 | Selection | Click selects. Modifier-click adds. Rectangle selection. Clicking empty canvas clears. Delete removes the selection. Multi-drag keeps relative positions. Copy/paste and duplicate create new ids and keep internal connections. |
| R0.7 | Viewport | Cursor-centered wheel/trackpad zoom. Pan without moving nodes. Fit to content. Zoom to selection. Viewport changes never alter the document. Hit testing correct at any zoom. |
| R0.8 | Styling | Node fill, node border, node shapes, edge color, arrowhead style. Survives save/reopen. Legible in light and dark themes. |
| R0.9 | Undo/redo | Create, move, label edit, connect and disconnect are undoable and redoable. A multi-object drag is one step. Integrity preserved. One drag never makes many history entries. Tested in Rust and in the UI. |
| R0.10 | Native files | New, Open, Save, Save As. Explicit schema version. Preserves nodes, edges, labels, geometry, styles and ids. Useful errors for invalid references and unsupported versions. Unknown data is preserved. Atomic temp-file-and-replace writes. A failed save keeps the old file. Dirty indicator. Save/Discard/Cancel when closing or replacing a modified document. |
| R0.11 | Export | SVG of the whole map (not the viewport) with labels, nodes, edges and arrowheads, framed to content bounds, opening in independent viewers, without modifying the document. PNG only if reliable. |
| R0.12 | Reliability | Invalid documents never crash. Actionable file errors. Reference integrity enforced. No placeholder controls. Reopens its own files. No restarts needed. |

### Required end-to-end scenario (R0 gate)

1. Launch.
2. Create three nodes labeled "Research Question", "Evidence", "Conclusion".
3. Connect 1→2 and 2→3.
4. Drag the middle node; both edges stay attached.
5. Edit a link label.
6. Multi-select, move the selection together, then undo and redo the move.
7. Zoom and pan.
8. Save, close, and reopen, checking that ids, labels, relationships,
   positions and styles are preserved.
9. Export SVG and open it independently.
10. Opening an invalid document produces a controlled error.
11. Unsaved-change protection works.

Automated in the earlier Playwright suite, `tests/e2e/desktop.spec.ts` (kept
as reference and not part of the gates; see `docs/FEATURE_MATRIX.md`). The
WebdriverIO specs in `tests/wdio/`, which are part of the gates, re-cover its
core: create, label, drag, connect, save, then reopen in a new process. The
installer test covers saving and reopening through the real dialogs.

## R1: Productive concept mapping

- **R1.1 Groups.** Group and ungroup, keeping positions. Groups move with
  their members. Undoable. Edges stay valid.
- **R1.2 Layers.** Create, rename, reorder and delete layers. Assign
  objects to layers. Visibility and lock. Persisted.
- **R1.3 Rich text.** Open-source Tiptap: bold, italic, links, lists,
  paragraphs, alignment. Stored as structured content, not HTML. Links are
  never opened or fetched on load.
- **R1.4 Resources.** Nodes can reference files or URLs. Broken references
  warn. Images display in nodes. References are kept distinct from embedded
  files, and nothing is copied silently.
- **R1.5 Search and organization.** Text search, focus and highlight.
  Align and distribute. Automatic layout via a maintained library.

## R2: Legacy `.vue` import

Import only, from independently generated fixtures V01–V06. See
`docs/COMPATIBILITY.md`.

## R3: Pathways and presentation

- Named pathways with ordered node references.
- Add, remove and reorder steps.
- Presentation mode: arrow keys to navigate, Escape to exit, viewport focused
  on each step with surrounding context.
- Persisted, with documented handling when a referenced node is deleted.

## R4: Knowledge analysis

- **Map merging.** Normalized-label matching with visible criteria, conflict
  review, explicit merge rule, no dangling edges, deterministic results.
- **Structured metadata.** Tags and metadata, metadata search, CSV import,
  machine-readable graph export.

## Performance

- Deterministic 100, 500 and 1,000-node benchmark maps (2 edges per node).
- Record load, save, memory, viewport, drag and export with hardware details
  (`docs/BENCHMARKS.md`).
- The 100-node map is the R0 responsiveness smoke test.

## Change log

| Spec version | Date | Change |
|---|---|---|
| 1.0 | 2026-11-09 | Initial specification from directive v2.0. |
