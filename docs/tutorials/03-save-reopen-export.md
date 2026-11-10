# Saving, Reopening, and Exporting Maps

*VUECraft v0.1.0-beta.1 for Windows 11. Reading time: about 7 minutes.*

A VUECraft map is a single `.vuecraft` file. This tutorial shows how to save
it, open it again, share it, and export it as an SVG image for a paper, a
slide or a poster.

It continues the sleep-study map from
[Creating Your First Concept Map](02-first-concept-map.md), but any map
works. New to VUECraft? Start with [Getting Started](01-getting-started.md).

## Save a map

1. Click **Save** (`Ctrl+S`). A new map is called `Untitled` and has no file
   yet, so **Save** asks for a name and folder, just like **Save As…**.
2. The Save dialog suggests `Untitled.vuecraft`, with the file type
   "VUECraft map". Replace `Untitled` with a name such as `sleep-study`, keep
   the `.vuecraft` ending, and choose a folder.
3. Click **Save**.

The window title and the toolbar now show the file name. From now on,
**Save** writes to the same file without asking.

**Save As…** (`Ctrl+Shift+S`) saves the map under a new name or in another
folder, and VUECraft continues with the new file. Use it to keep dated
versions, such as `sleep-study-2026-11-10.vuecraft`.

Keyboard shortcuts don't work while you're typing in a concept or a text
field. Press `Enter` or click elsewhere before you press `Ctrl+S`.

### See whether you have unsaved changes

- The window title starts with a dot: `● sleep-study.vuecraft — VUECraft`.
- The toolbar shows **● Unsaved changes** next to the file name.

Both disappear when you save. They also disappear if you undo back to the
state you last saved.

### Saving is crash-safe, but not automatic

VUECraft writes each save to a temporary file and then replaces the old file
in one step. If saving fails, or the computer crashes during a save, your
previous version stays intact. A failed save shows a red banner that starts
with `Could not save "<file name>":` and gives the reason.

VUECraft has no autosave. Save often, and always before you shut down.

### The unsaved-changes dialog

If the map has unsaved changes when you click **New** or **Open…**, or close
the window, VUECraft asks *Save changes to “sleep-study.vuecraft”?* with the
note "Your changes will be lost if you don’t save them."

| Button | Effect |
|---|---|
| **Save** | Saves the map (asking for a name if it's untitled), then continues. |
| **Don’t Save** | Discards your changes and continues. |
| **Cancel** or `Esc` | Returns to your map without changes. |

If you choose **Save** for an untitled map and then cancel the Save dialog,
nothing is discarded and your map stays open.

<!-- screenshot-todo: the "Save changes to …?" dialog over a modified map, with Don’t Save on the left and Cancel and Save on the right -->

## Reopen a map

- Click **Open…** (`Ctrl+O`) and choose a `.vuecraft` file. It replaces the
  map in the current window; VUECraft asks first if you have unsaved changes.
- Or double-click a `.vuecraft` file in File Explorer. It opens in a new
  VUECraft window.

When a map opens, VUECraft fits it to the window. The file keeps the map's
content and each layer's hidden or locked state. It doesn't keep the zoom
level, the active layer or the undo history, so undo starts fresh after you
reopen a map.

VUECraft has no list of recent files. Keep your maps in a folder you can find
again, such as your project folder.

### If a map won't open

The map you had open stays open, and a red banner explains the problem. Click
**Dismiss** to close it. Each message starts with
`Could not open "<file name>":`, followed by one of these reasons:

| Reason | What to do |
|---|---|
| `this file is not a VUECraft document` | The file isn't a VUECraft map, even if its name ends in `.vuecraft`. |
| `the file is not valid JSON (…)` | The file is damaged or incomplete. Use a backup copy. |
| `this document uses schema version …, but this version of VUECraft reads versions 1 to 2; update VUECraft to open it` | A newer VUECraft saved the map. Install the latest version from the [releases page](https://github.com/johnwallx/vuecraft/releases). |
| `file is larger than 64 MB` | VUECraft opens files up to 64 MB. |

VUECraft can't import maps from other concept-mapping applications in this
beta.

<!-- screenshot-todo: the red error banner with its Dismiss button, after opening a file that is not a VUECraft document -->

## What travels with the file

| Part of the map | In the `.vuecraft` file? |
|---|---|
| Concepts, links, labels, text formatting, shapes and colors | Yes |
| Groups and layers | Yes |
| Embedded images | Yes, inside the file |
| Web links, in attachments and in text | Yes |
| Attached files | Only their location. The files themselves aren't included. |

On another computer, attached files show "File not found" unless the same
file exists at the same location. If others need those files, send them
separately.

## Share a map

A map is one file, so you can share it like any document: by email, on a
shared drive, or through a course platform.

Before you share a map, remember that everything in the file goes with it:
embedded images, web links, and the locations of attached files. Those
locations can include your Windows user name and folder names.

To post a map in a GitHub issue or discussion, zip it first, because GitHub
doesn't accept `.vuecraft` files. Anything you post there is public, so share
a small copy without private content.

## Export an SVG image

SVG is a vector image format. It stays sharp at any size, and you can use it
in documents, slides and web pages.

1. Click **Export SVG…** (`Ctrl+E`).
2. The dialog suggests your map's name with `.svg`, with the file type "SVG
   image". Choose a folder and click **Save**.
3. VUECraft writes the file without a confirmation message. Open it in a web
   browser to check it.

Exporting doesn't change your map.

### What the SVG contains

The export shows the whole map, not just the part on screen. It is framed to
the map's content on a white background.

Included:

- concepts, with their shapes, fill and border colors, and text;
- links, with their colors, arrowheads, curves and labels;
- groups and their titles;
- embedded images;
- everything on visible layers.

Left out:

- hidden layers, and links to concepts on hidden layers;
- text formatting: bold, italic and links become plain text, while list
  bullets and numbers are kept;
- attachments;
- the dark theme: exports always use the light look.

VUECraft estimates text widths for the SVG, so lines may wrap slightly
differently than on the canvas. Check the result, and widen a concept if a
line breaks badly.

<!-- screenshot-todo: the exported sleep-study SVG opened in a web browser, showing concepts, labeled links and the Measures group on a white background -->

### Export part of a map

To export only some content, hide the layers you want to leave out, export,
and then show them again. For example, hide the Sources layer to export just
the core argument.

Hiding and showing a layer are edits: the map shows **● Unsaved changes**,
and if you save while a layer is hidden, it is still hidden the next time you
open the map.

## Limitations in this beta

- No autosave. Save often with `Ctrl+S`.
- No list of recent files.
- SVG is the only export format. There is no PNG or PDF export.
- SVG text widths are estimated, so wrapping can differ slightly.
- Attached files aren't packed into the map; only their locations are saved.
- Each `.vuecraft` file you double-click opens in its own window.
- VUECraft can't import maps from other concept-mapping applications in this
  beta.

Questions or ideas? Join the
[Discussions](https://github.com/johnwallx/vuecraft/discussions). New
versions appear on the [releases page](https://github.com/johnwallx/vuecraft/releases).

**Previous:** [Creating Your First Concept Map](02-first-concept-map.md) ·
**Start over:** [Getting Started with VUECraft](01-getting-started.md)
