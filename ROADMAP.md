# Roadmap

VUECraft grows one release at a time. Each release is finished, with its
acceptance criteria tested, before the next one starts. There are no dates.
Requirements are defined in [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md);
current status and evidence are in
[docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md).

## Releases

- **R1.5 Search and organization.** Text search with focus and highlight,
  align and distribute, and automatic layout. In progress.
- **R2 Legacy `.vue` import.** Import of existing `.vue` concept maps, built
  and tested against independently created reference files. Blocked until
  those files exist ([docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)).
- **R3 Pathways and presentation.** Named, ordered paths through a map, and a
  presentation mode that steps through them.
- **R4 Map merging and metadata.** Merging maps with visible matching rules
  and conflict review; tags, metadata search, CSV import and machine-readable
  graph export.

## Quality work

- Text sizing: nodes grow to fit text when an edit is committed, but text
  that doesn't fit after shrinking a node or opening a file is clipped
  without any sign.
- Paragraph alignment in rich text.
- Performance with 1000-node maps, which drag at about 12–15 fps today.
- Accessibility: review keyboard and screen-reader use, then fix what's found.
- Code signing for the installer and executable.
- macOS and Linux builds.

Suggest other ideas in
[Discussions](https://github.com/johnwallx/vuecraft/discussions).
