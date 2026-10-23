# Plan v4: Open-Source Canva Clone

Built against `canva-feature-reference.md`.

## Owner focuses (stated in chat, these override everything below)
1. **Ease of use first.** Simplify before adding.
2. **Mobile-first.** The owner currently has phone access only, so every feature must work by touch on a small screen (bottom tabs and sheets, large hit targets, no hover-only controls). Desktop is secondary for now.
3. **Functionality focus.** Prefer features that work end to end over polish or scaffolding.
4. **Open straight into the editor.** Never force picking a size or template on open; a blank 1080x1080 canvas is ready, and size is changeable later.
5. **iPhone-style photo editing:** sliders, temporary preview until Done, hold to compare, revert, plus crop, rotate, flip and straighten.
6. **Lightroom-style customizable presets:** save, name, apply with Amount, copy/paste settings across photos.
7. **Zoom and comfortable handles.** Pinch/button zoom and pan are required, and selection handles must stay small, corners only, and shrink with small objects; the outline must hug the object exactly.
8. **Objects can go beyond the page.** Outside the page they show faded, show in full with handles while selected, and are not in the exported image.
9. **Home screen is opt-in.** A Home button shows saved designs and new-design sizes; it never blocks opening the editor.
10. **Collaboration is deprioritized** (Later / optional).

Process rule: any new focus the owner states in chat is added to this list in the same session.

## Handoff notes (read this first when resuming)

**What exists.** "Canva Lite": a mobile-first browser design editor. Vite 5 + TypeScript (strict) + Fabric.js 5.3, tests with vitest, end-to-end smoke tests with Playwright (python). Repo root `canva-lite/`, branch `main`, small commits with `Co-Authored-By` and `Claude-Session` trailers.

**Repo:** https://github.com/pzhub-67/SimplyCanva (public, branch `main`). Rule from the owner: commit and `git push origin HEAD:main` after every step. Push from `canva-lite/` (remote `origin`); GitHub redirects the lower-case name.

**Commands**
- `npm run dev` dev server, `npm test` unit tests (12), `npm run build` typecheck + bundle.
- `npm run artifact` builds `dist/artifact.html`, a single self-contained page. Publish it with the Artifact tool using that same file path (keeps the same link). The owner opens that link on a phone.
- Smoke tests: `python3 scripts/smoke/make_test_png.py` once, then `python3 scripts/smoke/smokeN.py` after `npm run artifact`. They drive headless Chromium at phone size (`--use-gl=swiftshader` so WebGL works): smoke4 crop flow, smoke5 home screen + zoom buttons, smoke6 pinch, smoke7 objects beyond page + export, smoke8 export while zoomed, smoke9 snapping, smoke10 align/lock/group, smoke11 filters + auto, smoke12 style, smoke13 multi-page + JPG + export all, smoke14 one-finger pan + page reorder, smoke15 gradients, smoke16 SVG + PDF export, smoke17 templates + brand colors. They read saved designs straight from IndexedDB.

**How to work with the owner (Parker)**
- On a phone only for now, so verify with headless screenshots and say plainly that it was not tried on a real phone.
- Keep replies short. Use the `/ponytail` style: minimal code, finish the whole job, small test for non-trivial logic, mark deliberate shortcuts with `shortcut:` comments, end by saying what was skipped and the risks.
- Never force a choice on open. The editor opens straight into the last design (or a blank 1080x1080). Home is opt-in.
- Any focus stated in chat goes into "Owner focuses" above in the same session.
- The artifact viewer blocks downloads, so Export shows the image and says press-and-hold to save; the Download button is hidden when `'claude' in window`. A "download link" warning on publish is expected.

**File map (`src/`)**
- `main.ts` canvas, view (zoom/pan), page drawing, history, autosave, home screen, selection toolbar, style/align/group/lock, export. `editor.ts` photo edit session (Adjust/Filters/Mine/Crop tabs, Auto, thumbnails, copy/paste edits, presets). `crop.ts` + `cropMath.ts` crop overlay and pure geometry. `adjust.ts` the WebGL shader (`fabric.Image.filters.Adjust`). `photoModel.ts` `PhotoEdit`, 15 adjustments, built-in looks, `effective`, `autoAdjust`. `model.ts` `Design`/`Page` format. `store.ts` IndexedDB. `fonts.ts`, `sizes.ts`, `icons.ts`. `index.html` holds all CSS (theme tokens, light/dark) and markup.
- The data model block below is the long-term target. What is built: `Design { id, title, pages[] }`, `Page { id, width, height, background, objects }` where `objects` is raw Fabric JSON. Custom per-object fields (`edit`, `orig`, `locked`) are listed in `PROPS` in `main.ts` and must be passed to every `toJSON`.

**Design decisions and gotchas worth remembering**
- **Canvas fills the stage, the page is drawn inside it.** View = Fabric viewport transform (`fit()` sets it from `vz`, `vx`, `vy`). `raw._renderBackground` draws the page and its shadow; `raw.drawControls` first fades everything outside the page, re-draws the selected object at full strength (clipped to outside the page), draws snapping guides, then the real handles. These two overrides use Fabric internals that are not in the type defs (`raw` cast at the top of `main.ts`).
- **Export and thumbnails** go through `pageImage()`, which crops `toDataURL` to the page rectangle and sets `exporting` so the fade, shadow, guides and handles are skipped. Anything outside the page is therefore never exported.
- **History** is full-JSON snapshots with a `busy` flag and `batch()` to make several changes one undo step. History is not saved, only the current design is.
- **Saving:** IndexedDB with two stores, `designs` (full) and `meta` (title, thumbnail, size, updated). Autosave is debounced 500 ms and only runs once `live` is true. A blank, never-edited design is not saved. The old localStorage slot (`canva-lite:design`) is migrated once. Last-open id is in localStorage `canva-lite:last`. User presets are in localStorage `canva-lite:presets`.
- **Photo edits are parameters** (`PhotoEdit`), rendered by one WebGL filter. Crop is the exception: it is baked into pixels from the retained original (`orig.src`) so Fabric clipping and rotation stay simple, and the crop params are stored so it can be re-edited.
- **Touch:** two-finger pinch/pan is intercepted in the capture phase on `#stage` before Fabric sees it, and anything the first finger started is rolled back (`grab`). Handles are corner-only and shrink with small objects (`before:render` hook).
- **Mobile layout:** bottom tabs and sheets, a contextual toolbar, `body[data-editing]` hides the top bar and tabs while the photo editor is open, safe-area padding.

**Known shortcuts and risks (fix when they bite)**
- SVG export of a photo uses Fabric's own image export; photo slider edits may not appear in the SVG (PNG, JPG and PDF always include them). Text in SVG/PDF is not selectable (PDF is images).
- No WebGL fallback: without WebGL photos show unedited.
- Resizing the page does not re-flow objects and is not undoable. Only the regular font weight is loaded.
- Cropped photos store both the cropped and the original pixels, so large photos make saves big (IndexedDB handles it, but there is no quota warning yet).
- Page thumbnails are cached on each page (`Page.thumb`) and only refreshed when you leave a page, so they can be slightly stale.
- Snapping works while moving only (not resizing or rotating). When zoomed out to fit, a one-finger drag on empty space draws a selection box (that is how you select several items).
- Locked items can still be deleted. Text and photos inside a group cannot be edited until ungrouped. Corner radius is rectangles only.
- Undo does not cross designs or pages.
- Templates are built in code (`src/templates.ts`); there is no template search, categories or user-saved templates yet. Brand kit is colors only (no logos or brand fonts). No Magic Resize.
- Never tried on a real phone; everything was checked in headless Chromium.

## Principles
- **Ease of use beats feature count.** If a feature needs explaining, simplify it before shipping it.
- **Open source means no plan gating.** SVG export, background remover, brand kit and resize are plain features.
- **One document format.** Every feature reads and writes the same design JSON.
- **Offline-first.** The editor works with no backend; accounts and sharing layer on top.
- **Non-destructive.** Originals are never altered; every edit can be reverted.
- **Self-hostable.** One Docker image plus Postgres and S3-compatible storage.

## Ease-of-use requirements (apply to every phase)
- **Start screen, not a blank canvas:** pick a size or template, recent designs, drag a photo in to start.
- **Contextual toolbar:** controls for the selected object appear next to it (text, image, shape), nothing else.
- **Left sidebar tabs:** Templates, Elements, Text, Uploads, Photos. One click each, search at the top.
- **Direct manipulation:** drag-drop files, paste images, double-click to edit, snap and guides on by default.
- **Never lose work:** autosave, unlimited undo/redo, "revert" on photo edits.
- **Keyboard and command palette:** shortcuts for everything common, Ctrl/Cmd+K to search any action.
- **Zoom to fit, pinch/trackpad zoom, touch support** so it is usable on a tablet.
- **Sensible defaults and plain words:** no jargon in labels, tooltips on every icon, undo toast after destructive actions.
- **Accessible:** keyboard navigable, contrast checked, alt text field on images.

## Core data model (decide in Phase 1)
```
Design   { id, title, brandKitId?, pages: Page[] }
Page     { id, width, height, background, objects: Object[], durationMs? }
Object   { id, type, x, y, w, h, rotation, locked, opacity, ...typeProps }
ImageObj extends Object { src, crop, edit: PhotoEdit }      // src is never modified
PhotoEdit { adjustments: {exposure, brilliance, highlights, shadows, contrast, brightness,
            blackPoint, saturation, vibrance, warmth, tint, sharpness, definition,
            noiseReduction, vignette}, filter?: {presetId, amount}, crop, rotation, straighten }
Preset   { id, name, group, adjustments: Partial<adjustments>, builtIn }
Template { id, name, category, tags[], thumbnail, design: Design }
Asset    { id, kind, url, license, tags[] }
BrandKit { id, logos[], colors[], fonts[] }
```

## Module map
| Module | Reference section | Phase |
|---|---|---|
| M1 Editor core and usability | 1 Design Creation | 1 |
| M2 Photo editor and presets | 7 Photo editing | 2 |
| M3 Templates, resize, brand kit | 1 Design Creation | 3 |
| M4 Asset library | 2 Content Library | 4 |
| M5 Export, accounts, sharing | 5, 6 | 5 |
| M6 AI, presentations, video | 3, 4 | 6 |
| M7 Collaboration (optional) | 5 | later |

## Phase 1: Editor core and usability (M1)
- Done: add text/shapes/images, layer order, undo/redo, size presets, PNG export, local save
- Done: Vite + TypeScript, `Design`/`Page` model (`src/model.ts`), font picker, size, bold/italic/underline, alignment
- Done: mobile-first shell (top bar, bottom tabs and sheets, contextual toolbar, start screen), autosave, zoom to fit, drag-drop and paste images, photo downscale on import, duplicate, keyboard shortcuts, light/dark theme
- Done: Home screen with saved designs (thumbnails, rename, delete) on IndexedDB; two-finger pinch/pan, zoom buttons, Fit; corner-only handles that scale with the object
- Done: objects can sit outside the page (faded, full when selected, cropped from export); snapping guides to the page and other objects
- Done: group/ungroup, lock/unlock, Align menu (page for one item, each other for several); Style menu with opacity, corner radius (rectangles), shadow (None/Soft/Hard) and flip
- Done: multi-page (Page N of M chip opens a strip: switch, add, duplicate, delete; all pages share one size), JPG export, Export all pages, Style/Align sheets slide the page up so the selected item stays visible
- Done: one-finger pan on empty space when zoomed in (not zoomed: draws a selection box), page reorder (Move earlier / Move later)
- Done: gradient fills (Sunset, Ocean, Mint, Night) in the Style menu; smoke15
- Done: SVG export (with Copy code, since downloads are blocked in the viewer) and PDF export (all pages, one JPEG per page, tiny writer in `src/pdf.ts`, no library); smoke16
- Done: Phase 3 starter (five built-in templates on Home: Quote, Sale, Story title, Title slide, Thumbnail; brand colors managed on Home and applied from Background/Style menus); smoke17
- Next: snapping while resizing

## Phase 2: Photo editor and presets (M2)
Modeled on iPhone Photos for simplicity and Lightroom for presets.

**Status**
- Done: edit mode with all 15 sliders (one WebGL filter, params stored on the image), temporary preview with Done/Cancel, hold to compare, Revert, 10 built-in looks with Amount, saved presets (save, rename, delete, apply), copy/paste edits across selected photos, undo/redo and autosave of edits
- Done: Crop tab with ratio chips (Free, Original, Page, 1:1, 4:5, 3:4, 16:9, 9:16), draggable frame with corner resize, rotate 90, flip H/V, straighten -45 to +45 (frame stays inside the photo), Reset; crop is re-editable because the original is kept, and it works with Cancel, Revert and undo/redo
- Done: Filters tab shows thumbnails rendered from the user's own photo; one-tap Auto enhance (reads brightness and colour, sets sliders you can still tweak)
- Next: before/after split, per-photo edit history list, preset import/export (copy/paste text, since downloads are blocked in the viewer), CPU fallback when WebGL is missing

**Editing (iPhone-style)**
- Double-click an image, or tap **Edit** in its toolbar, to enter edit mode. One panel, three tabs: **Adjust**, **Filters**, **Crop**.
- **Adjust:** one slider at a time, selected from a horizontal dial of tools, same list as iPhone: Exposure, Brilliance, Highlights, Shadows, Contrast, Brightness, Black Point, Saturation, Vibrance, Warmth, Tint, Sharpness, Definition, Noise Reduction, Vignette. Every slider is -100 to +100, double-click resets it. A dot shows which tools are changed.
- **Temporary settings:** edits are a live preview until you press **Done**. **Cancel** discards, **hold to compare** shows the original, and **Revert to original** is always available after Done. Nothing touches the source image.
- **Filters:** a row of preset thumbnails rendered from the user's own photo, with an **intensity slider** (0-100). Filter and manual adjustments stack.
- **Crop and straighten:** aspect ratio chips (free, 1:1, 4:5, 16:9, match page), rotate 90, flip, straighten dial, auto-straighten later.
- **Auto:** one-tap auto-enhance that sets the sliders so users can tweak them.

**Presets (Lightroom-style)**
- **Save as preset:** captures the current sliders, with name and group (e.g. Portrait, Moody, Film).
- Presets are fully customizable: rename, edit, reorder, duplicate, delete, favorite. Built-ins are locked but can be duplicated.
- **Apply with Amount:** presets scale by an intensity slider and combine with manual changes.
- **Copy/paste settings** between images, and **apply to all selected images** in one go.
- **Import/export** presets as a small JSON file, so they can be shared. Stored locally first, synced to the account later.
- **Before/after** split view, and **edit history** list for the current photo (click to step back).

**Rendering**
- One WebGL shader pipeline takes the `PhotoEdit` params and renders a downscaled live preview; export renders full resolution. Canvas 2D fallback if WebGL is missing.
- Fabric's built-in filters lack Exposure, Highlights, Shadows, Warmth and Tint, so use a custom pipeline, not Fabric filters.
- Edits are stored as params on the object, so they are tiny, undoable, and re-editable later.
- Presets and edits must round-trip through the design JSON and the undo stack.

## Phase 3: Templates and brand (M3)
- Template gallery with search, categories, tags, thumbnails (saved design JSON)
- Seed 20–30 original templates (social, slide, poster, flyer, resume, invite)
- Magic Resize: re-flow rules per target size (scale + anchor by object role: background, headline, logo)
- Brand Kit: logos, colors, fonts, one-click apply; photo presets can be part of a brand kit

## Phase 4: Asset library (M4)
- Uploads with validation and size limits, stored in S3/R2
- Stock search: Unsplash and Pexels APIs; icons from open sets (Lucide, Tabler)
- Elements: shapes, lines, frames, grids, stickers, simple charts
- Custom font upload (woff2)
- Licensing metadata on every asset; background remover (`@imgly/background-removal`, client-side)

## Phase 5: Export, accounts, sharing (M5)
- Auth (Supabase or Lucia), Postgres for users/designs, folders, trash
- Share by link: view-only and "make a copy" (no live co-editing)
- Export pipeline: server render for large PDFs; GIF and MP4 of simple page sequences
- One-page website publish (static HTML from a design)

## Phase 6: AI, presentations, video (M6)
- Present mode, presenter notes, page transitions, element motion
- Video timeline editor, WASM or server rendering via job queue
- AI (bring-your-own-key, optional): text write/rewrite, image generation, object removal, prompt-to-design

## Later / optional
- **Collaboration (M7):** comments first (cheap), live co-editing with Yjs only if people ask
- Print ordering, social scheduling (platform OAuth and vendor deals)
- Docs and whiteboards
- Native mobile and desktop apps (responsive, touch-friendly web first)
- Plugin marketplace (keep the editor API clean so plugins are possible)

## Stack
- Frontend: Vite, TypeScript, Fabric.js for the canvas, a custom WebGL pipeline for photo edits, Zustand for state
- Backend (Phase 5+): Hono or Next.js, Postgres, S3/R2
- Hosting: static + API on Vercel or Cloudflare; Docker image for self-host

## Key decisions
1. **Engine:** stay on Fabric.js for layout; photo edits use our own shader pipeline. Revisit if performance fails past ~500 objects.
2. **Photo edits are parameters, not pixels.** Keeps files small, edits reversible, presets shareable.
3. **Template and preset format:** plain JSON files users can share.
4. **Licensing:** the GitHub repo `pzhub-67/SimplyCanva` is GPL-3.0 (its LICENSE file); keep that unless the owner changes it; bundle only permissively licensed fonts, icons, presets and templates.
5. **AI:** optional and off by default, so the core stays free of API costs.

## Next step
Phases 1 and 2 and a starter of Phase 3 are built and live; everything runs in the browser with no backend. Not started because they need outside services or content: Phase 4 asset library (stock photos, icons, licensing), Phase 5 accounts, cloud sync and sharing (needs a backend), Phase 6 AI, presentations mode and video. Good next code-only steps: snapping while resizing, user-saved templates, brand fonts and logos, template categories and search, Magic Resize, preset import/export as text, before/after split, CPU fallback for photo edits, and a real-phone pass over touch behavior.
