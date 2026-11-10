# Provenance record

One row per significant requirement or compatibility finding. Categories:
**PD** public documentation, **BB** black-box observation, **GF** generated
fixture, **ID** independent design.

| ID | Feature / finding | Evidence source | Cat. | Date | Fixture / screenshot | SHA-256 | Uncertainty | Reviewer | Review status |
|---|---|---|---|---|---|---|---|---|---|
| P-001 | R0 editor behavior (R0.1–R0.12) | Project directive v2.0 functional requirements (`docs/PRODUCT_SPEC.md`) | ID | 2026-11-09 | `test-results/desktop/*.png` (regenerated each E2E run) | — | None | Implementation agent (Claude Code) | Not independently reviewed |
| P-002 | Native format (JSON, `format`/`schemaVersion`, camelCase fields, unknown-field preservation). Developed as `.mapw` / `"mapwright"`; renamed 2026-11-09 to `.vuecraft` / `"vuecraft"`, with development-era files still read | Designed for this project | ID | 2026-11-09 | `crates/map-core/src/io.rs` tests; `tests/fixtures/native/r0-research.mapw`, `r1-full.mapw` | — | None | Implementation agent | Not independently reviewed |
| P-003 | Edge geometry (outline intersection, quadratic curve bending left, label at t=0.5) | Designed for this project; same formulas in Rust and TypeScript | ID | 2026-11-09 | `svg.rs` / `geometry.test.ts` parity tests | — | None | Implementation agent | Not independently reviewed |
| P-004 | Undo model (semantic ops with inverses, revision-checked transactions, state ids for dirty tracking) | Designed for this project | ID | 2026-11-09 | `session.rs` tests | — | None | Implementation agent | Not independently reviewed |
| P-005 | Library usage (React Flow custom nodes/edges, NodeResizer, Tauri commands, capabilities, dialog plugin, WebView2 DevTools automation) | Public third-party library APIs, from the agent's existing knowledge and installed type definitions; no web pages fetched | PD | 2026-11-09 | — | — | None | Implementation agent | Not independently reviewed |
| P-006 | Apache-2.0 license text | https://www.apache.org/licenses/LICENSE-2.0.txt | PD | 2026-11-09 | `LICENSE-APACHE` | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` | None | Implementation agent | — |
| P-007 | R1.1–R1.4 behavior and format additions (one-level groups with engine-fitted bounds, layers with engine-enforced locks, validated rich-text subset with plain-text projection, attachments and content-addressed embedded images) | Continuation directive (R1 requirements) plus designs made for this project | ID | 2026-11-09 | `model.rs`, `session.rs`, `rich.rs`, `assets.rs` tests | — | None | Implementation agent | Not independently reviewed |
| P-008 | Library usage (Tiptap StarterKit/Link, base64, sha2, tauri-plugin-opener Rust API) | Public third-party library APIs, from the agent's existing knowledge and installed type definitions; no web pages fetched for implementation. (Separately, at the user's request, the Trail of Bits rust-review plugin was downloaded from GitHub as agent tooling; it is not part of the product.) | PD | 2026-11-09 | — | — | None | Implementation agent | Not independently reviewed |

## VUE evidence used

None. In this session no VUE documentation, application, screenshot, or `.vue`
file was consulted. Nothing in the repository derives from VUE material.

## Independent review log

| Date | Reviewer (role) | Scope | Result |
|---|---|---|---|
| — | — | — | Pending |
