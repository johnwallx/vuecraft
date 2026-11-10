# VUECraft brand brief: hero elephant illustration

Commissioning brief for one original natural-history illustration of an
elephant. Prepared 2026-11-09. Status: draft for the owner; not yet sent to an
illustrator.

VUECraft ("The visual knowledge workbench.") is an open-source desktop
concept-mapping app for Windows, licensed MIT OR Apache-2.0. The project
already has an interim companion icon (`assets/brand/vuecraft-icon.svg`). It
shows the intended pose and orientation. The engraving should not copy its
simplifications.

## 1. Placements

| Placement | Export size | Background | Notes |
|---|---|---|---|
| README hero | 1600x800 px, plus 3200x1600 @2x | Ivory plate | GitHub shows it about 800 px wide. Black ink on a transparent background disappears in GitHub's dark theme, so the README uses the ivory variant. |
| GitHub social preview | 1280x640 px, under 1 MB | Ivory | The elephant sits in the right half. Leave the left half as clear ivory: the project sets the wordmark and tagline there. Keep the subject at least 64 px from every edge. |
| Release page banner | 1600x480 px | Ivory | The same crop as the social preview, made wider. |
| About box (in-app, not built yet) | 512x512 and 256x256 px | Transparent and ivory | Must read on the app's light and dark themes; the ivory variant is the safe default. |

## 2. Subject, composition, anatomy

- **Subject:** one elephant, rearing, shown as a portrait cropped from the
  shoulders upward. Show no legs below the shoulder, no ground, no landscape and
  no other animals.
- **Pose:** three-quarter view with the head turned toward the viewer's left (as
  in the interim icon). The trunk is raised and curves upward, its tip curling
  back toward the forehead. The mouth is slightly open.
- **Species:** Asian elephant (*Elephas maximus*) is recommended. It has a
  twin-domed forehead, a smaller ear whose upper rim folds forward, and one
  "finger" at the trunk tip. This matches the icon and puts more distance
  between our elephant and existing elephant mascots. The owner must confirm
  this choice (see section 9).
- **Anatomy:**
  - Trunk: transverse ring wrinkles, tapering steadily toward the tip.
  - Tusks: short to medium, emerging below the trunk base and curving forward
    and up.
  - Eye: small, with a heavy lid and wrinkled surround, set roughly level with
    the top of the trunk root.
  - Ear: fanned forward (alert).
  - Neck and shoulder: folds under the jaw, and the mass of the shoulder below
    the ear.
- **Expression:** alert and dignified. Not angry, charging, cute or cartoonish.
- **Silhouette:** at thumbnail size, background must separate the raised trunk
  from the forehead. That gap is what makes the image read as "elephant, trunk
  up".

## 3. Technique

- Nineteenth-century zoological engraving idiom: fine black ink line, contour
  hatching that follows the form, and cross-hatching for shadow. Use stipple
  sparingly.
- Ink only: no color, gray wash, gradients or halftone screens.
- Restrained ivory ground. Do not imitate aged paper: no texture, stains,
  foxing or vignettes. A thin plate rule is optional.
- Hatching must survive reduction. Check the art at 25% and at 1280x640: no
  moiré, and no areas that fill in to solid grey.
- Medium: pen and ink scanned at 1200 dpi or more and then cleaned or
  vectorized, or drawn digitally in the same idiom. Either is fine if section 6
  is met.

## 4. Palette

| Token | Hex | Use |
|---|---|---|
| Ink | `#1D1B18` | All line work; the icon's shapes |
| Ivory | `#F3ECDA` | Background, plate, negative lines |
| Mark black | `#000000` | Single-color mark only (`vuecraft-mark-mono.svg`) |

Ink on ivory has a contrast ratio of 14.6:1 (WCAG formula). The artwork uses no
third color.

## 5. Typography

The project sets all type; the illustration contains no lettering. Use
open-licensed fonts only. This brief adds no font files.

| Role | Candidates | License |
|---|---|---|
| Wordmark and headings | Libre Caslon Display or Text; Fraunces | SIL OFL 1.1 |
| Body text | Source Serif 4 | SIL OFL 1.1 |
| UI and small sizes | Inter; IBM Plex Sans | SIL OFL 1.1 |

- Keep away from Garamond-family italics and stacked "book title" layouts,
  which read as technical-book covers.
- Check each license file at the font's source before use.
- If a font is ever bundled with the app, add its OFL text to
  `THIRD_PARTY_NOTICES.md`.
- Always write the name as **VUECraft**.

## 6. Deliverables and formats

1. **Layered master files** in the native editable format (PSD, Krita `.kra`,
   Affinity or layered TIFF; also `.svg` or `.ai` if drawn as vectors). Keep
   line work, hatching and background on separate layers.
2. **Master:** SVG (preferred if the art is vector) or a 4096x4096 px PNG of the
   full composition, sRGB.
3. **Variants:** transparent (ink only) and ivory background, for the master
   and for every export.
4. **Exports:** every size in section 1, as PNG-24 with alpha, sRGB.
5. **Optional add-on:** a redrawn companion icon matching the engraving, as plain
   SVG: paths only, with no text, external references, embedded raster or
   filters. Include proofs at 16, 24, 32, 48 and 256 px. At 32 px it must still
   read as an elephant with a raised trunk.
6. **Delivery note:** the references used (section 7) and the
   originality statement (section 8).

File names: `vuecraft-hero-master.(svg|png)`,
`vuecraft-hero-<placement>-<transparent|ivory>.png`.

## 7. Do's and don'ts

**Do**
- Draw from your own knowledge, life studies or your own photographs. Other
  references are allowed for anatomy study only, if licensed or in the public
  domain. List them in the delivery note.
- Keep the raised trunk readable in silhouette at small sizes.
- Share rough sketches before inking, so the owner can run the distance check
  below.

**Don't**
- Trace, copy or closely paraphrase any existing illustration, photograph or
  logo. Use no stock, downloaded or generative-AI imagery in any part of the
  work.
- Resemble **Tufts University** marks, the "Jumbo" mascot artwork or Tufts
  athletics logos. Avoid:
  - a brown-and-blue palette;
  - a full-body elephant walking or charging in side view;
  - collegiate or sports-logo styling (shields, arched lettering, aggressive
    expressions).
- Resemble **O'Reilly's animal-engraving book covers**. Avoid:
  - a full-body animal standing in profile on a white field;
  - a colored title band;
  - a cover-like layout.
  This brief's cropped, rearing bust on ivory is meant to keep that distance.
- Resemble **ArtCraft** logos.
- Resemble other well-known elephant marks, especially in software: the
  PostgreSQL elephant, the Evernote and Hadoop elephants, PHP's elePHPant, and
  political-party elephants.
- Add lettering, signatures inside the image, trademark symbols or fake aging.

Distance check: before inking and again at final delivery, the owner (not the
illustrator alone) compares the sketches with the current marks named above.
Record the date and the result in `docs/brand/ASSETS.md`. The author of this
brief did not look up those marks.

## 8. Legal requirements

- **Rights.** Either:
  - (a) a written work-for-hire agreement **with a fallback assignment of
    copyright**. Commissioned illustration by an independent contractor often
    does not qualify as work for hire, so the assignment is needed. Or:
  - (b) a written, irrevocable, worldwide, royalty-free license that lets the
    project and anyone redistributing it reproduce, modify and distribute the
    art under MIT/Apache-2.0 terms, or under CC BY 4.0 with the artist's
    attribution line.
- **Originality statement**, written and signed. It confirms that the artist
  created the work; that nothing was traced or copied from any existing artwork
  or photograph; that no stock, downloaded or AI-generated material was used;
  and it lists the references consulted.
- **Moral rights:** a waiver of, or consent to, cropping, recoloring and
  modification, to the extent the law allows.
- **Editable master files** (section 6, item 1) are a contract deliverable,
  not an extra.
- **Trademark:** the artist claims no trademark rights. The project may use
  the art as its brand.
- **Credit:** the artist's credit line (name and optional link) is recorded in
  `docs/brand/ASSETS.md`.
- **Signatory:** the owner signs as `[PUBLISHER NAME]`. Have the contract
  reviewed; this brief is not legal advice.

## 9. Decisions for the owner

- Species: Asian elephant (recommended), or leave it to the illustrator.
- Whether brand assets stay under MIT OR Apache-2.0 (forks may reuse the logo),
  or get a separate trademark/brand-use policy.
- Whether to require "no generative AI" for the commissioned work (this brief
  assumes yes).

## 10. Acceptance checklist

- [ ] Rearing elephant, cropped from the shoulders up, three-quarter view, trunk
      curving upward and clearly separated from the forehead.
- [ ] Ink line and hatching on ivory only: no color, wash, text or aging effects.
- [ ] Hatching holds up at 25% and at 1280x640; the subject reads in a 320 px-wide
      social-card thumbnail and at 256 px.
- [ ] The owner's distance check against Tufts, O'Reilly, ArtCraft and the other
      elephant marks is done and recorded.
- [ ] Layered masters open in their native application, with layers named and
      separated.
- [ ] SVG or 4096 px PNG master delivered, in transparent and ivory variants.
- [ ] Every export in section 1 delivered at its exact pixel size; social preview
      under 1 MB.
- [ ] README hero checked in both GitHub light and dark themes.
- [ ] Signed agreement (work-for-hire plus assignment, or license) and signed
      originality statement on file.
- [ ] The "Commissioned illustration" section of `docs/brand/ASSETS.md` filled in.
- [ ] Files placed as described in `docs/brand/ASSET_PIPELINE.md`.
