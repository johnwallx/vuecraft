# Brand asset pipeline

How brand artwork gets from its source files into the app and the docs. Every
asset file is listed in [`ASSETS.md`](ASSETS.md) **before** it is committed.

## Source files

| File | Role |
|---|---|
| `assets/brand/vuecraft-icon.svg` | Master app icon: ink elephant on an ivory rounded square, 1024x1024 viewBox |
| `assets/brand/vuecraft-mark-mono.svg` | The same mark in one color: black on transparent |
| `assets/brand/hero/` | The commissioned engraving, once delivered (see below) |

Icon SVGs stay plain: paths only, with no text, external references, embedded
raster or filters. To change the icon, edit the SVG and regenerate. Never
hand-edit the generated files.

## App icons: `src-tauri/icons/`

```bash
pnpm tauri icon assets/brand/vuecraft-icon.svg
```

- This regenerates everything in `src-tauri/icons/`:
  - `32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png` and `icon.png`;
  - the Appx `Square*Logo.png` and `StoreLogo.png`;
  - `icon.ico` (frames at 16, 24, 32, 48, 64 and 256 px) and `icon.icns`.
- It also writes `android/` and `ios/` folders. This Windows-only build does
  not use them, so delete them before committing.
- `bundle.icon` in `src-tauri/tauri.conf.json` references `32x32.png`,
  `128x128.png`, `128x128@2x.png`, `icon.icns` and `icon.ico`. The executable
  and the NSIS installer use `icon.ico`.
- Commit the SVG and the regenerated icons together. `vuecraft.exe` picks up
  the new icon only after a rebuild (`pnpm tauri build`).

To preview without touching the repo, render into a scratch folder outside
the repo (for example under `%TEMP%`). `-p` writes only the listed PNG sizes:

```bash
pnpm exec tauri icon assets/brand/vuecraft-icon.svg --output <scratch-folder>
pnpm exec tauri icon assets/brand/vuecraft-icon.svg --output <scratch-folder-2> -p 16,24,32,48,256
```

## How to check the icon

1. Pull the 16 and 32 px frames out of `icon.ico` itself. The frames are
   PNG-encoded:

   ```bash
   node -e "const fs=require('fs'),b=fs.readFileSync(process.argv[1]);for(let i=0;i<b.readUInt16LE(4);i++){const e=6+i*16,w=b[e]||256,d=b.subarray(b.readUInt32LE(e+12),b.readUInt32LE(e+12)+b.readUInt32LE(e+8));if(w===16||w===32)fs.writeFileSync(process.argv[2]+'/ico-'+w+'.png',d)}" <path>\icon.ico <out-folder>
   ```

2. View `ico-16.png` and `ico-32.png` at 100% and at 400%.
   - At 32 px, the raised trunk must be visibly separate from the head, and the
     ear line must show.
   - At 16 px, a dark head with a hooked trunk on the left is enough.
3. After a rebuild, look at the installed app in Explorer (small and large
   icons), the taskbar (light and dark), Alt+Tab, and the installer window.

## Docs images: `docs/assets/`

| Path | Content |
|---|---|
| `docs/assets/screenshots/` | App screenshots used by `README.md` |
| `docs/assets/brand/` | Brand exports: `readme-hero.png`, `social-preview-1280x640.png`, `release-banner.png` (once the engraving is delivered) |

- Until the engraving arrives, the README uses `assets/brand/vuecraft-icon.svg`
  directly.
- The GitHub social preview does not come from the repo. Someone uploads it by
  hand in the repository settings, which counts as publishing and is the
  owner's call. The copy in `docs/assets/brand/` is the record.
- Release notes reference images from `docs/assets/brand/`.

## When the commissioned engraving is delivered

1. **Layered masters** (PSD, `.kra` and so on) stay **out of the public repo**
   because of their size and editability. Keep them in the owner's archive and
   record the location and SHA-256 hash in `ASSETS.md`.
2. **Commit to `assets/brand/hero/`:**
   - `vuecraft-hero-master.svg` (or `vuecraft-hero-master-4096.png`);
   - `vuecraft-hero-transparent-4096.png`;
   - `vuecraft-hero-ivory-4096.png`.
3. **Export to `docs/assets/brand/`:**
   - the README hero (ivory, 1600x800, plus @2x);
   - the social preview (1280x640, under 1 MB);
   - the release banner (1600x480).
4. **About box:** once the dialog exists, import a 512 px export through Vite
   from under `src/`. Record it in `ASSETS.md`.
5. **Companion icon:** if the illustrator also redraws it, replace
   `assets/brand/vuecraft-icon.svg` at the same path, keep the plain-SVG rules,
   regenerate the icons and repeat the check above.
6. **Record:** fill in the "Commissioned illustration" section of `ASSETS.md`.
   If the art is licensed CC BY 4.0 rather than MIT OR Apache-2.0, also add its
   attribution line to `NOTICE`.
