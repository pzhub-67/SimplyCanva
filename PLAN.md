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
8. **Home screen is opt-in.** A Home button shows saved designs and new-design sizes; it never blocks opening the editor.
9. **Collaboration is deprioritized** (Later / optional).

Process rule: any new focus the owner states in chat is added to this list in the same session.

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
- Next: pinch zoom and pan, snapping and alignment guides, group/ungroup, lock
- Next: multi-page (page strip), opacity, flip, corner radius, shadows, gradients
- Next: export JPG, SVG, PDF

## Phase 2: Photo editor and presets (M2)
Modeled on iPhone Photos for simplicity and Lightroom for presets.

**Status**
- Done: edit mode with all 15 sliders (one WebGL filter, params stored on the image), temporary preview with Done/Cancel, hold to compare, Revert, 10 built-in looks with Amount, saved presets (save, rename, delete, apply), copy/paste edits across selected photos, undo/redo and autosave of edits
- Done: Crop tab with ratio chips (Free, Original, Page, 1:1, 4:5, 3:4, 16:9, 9:16), draggable frame with corner resize, rotate 90, flip H/V, straighten -45 to +45 (frame stays inside the photo), Reset; crop is re-editable because the original is kept, and it works with Cancel, Revert and undo/redo
- Done (Phase 1 additions): Home screen with saved designs (thumbnails, rename, delete) on IndexedDB; two-finger pinch/pan, zoom buttons, Fit; corner-only handles that scale with the object from the user's own photo, auto-enhance, before/after split, per-photo edit history list, preset import/export (copy/paste text, since downloads are blocked in the viewer), CPU fallback when WebGL is missing

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
4. **Licensing:** app under MIT or AGPL (decide before first public release); bundle only permissively licensed fonts, icons, presets and templates.
5. **AI:** optional and off by default, so the core stays free of API costs.

## Next step
Phase 1 and most of Phase 2 are built. Next: snapping guides, group/lock, then filter thumbnails and auto-enhance.
