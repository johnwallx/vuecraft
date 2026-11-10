# Legacy `.vue` compatibility

**Status: not started (Release R2). VUECraft cannot open `.vue` files yet, and
its installer does not register the `.vue` extension.**

Planned scope is import only. Legacy export is out of scope until explicitly
authorized. Lossless round-tripping will not be promised.

## Reference fixtures

Fixtures must be created by running the original VUE application through its
user interface, never from its source code or mapping files. Each needs: the
creation steps, expected objects, labels, relationships, positions and styling,
screenshots, a SHA-256 checksum, and known unsupported properties. Store them
in `tests/fixtures/vue/` and log each in `docs/PROVENANCE.md` (category GF).

| ID | Fixture | Status |
|---|---|---|
| V01 | Three basic nodes and two links | **Blocked:** not yet obtained |
| V02 | Multiline and styled nodes | **Blocked:** not yet obtained |
| V03 | Groups or nested content | **Blocked:** not yet obtained |
| V04 | Images and resource links | **Blocked:** not yet obtained |
| V05 | Multiple layers | **Blocked:** not yet obtained |
| V06 | Presentation pathway | **Blocked:** not yet obtained |

Until fixtures exist, no XML structure is assumed and no import code is written.

## Importer requirements (for R2)

- Use a maintained Rust XML parser that does not resolve external entities or
  expand DTD entities, which prevents XXE and entity-expansion attacks.
- Never fetch or open referenced resources while importing.
- Never write to the source `.vue` file.
- Report unsupported properties to the user. Treat them as distinct from
  importer defects.
- Record visual comparisons per fixture, assessing functional and visual
  fidelity separately.
