# Plan v2: Open-Source Canva Clone

Reworked against `canva-feature-reference.md`. Phases follow the reference's build priorities; modules (M1–M7) map to its sections.

## Principles
- **Open source means no plan gating.** Everything Canva paywalls (SVG export, background remover, brand kit, resize) is just a feature here.
- **One document format.** Every feature reads and writes the same design JSON. Get this right first.
- **Offline-first, then server.** The editor works with no backend; accounts, sync and sharing layer on top.
- **Self-hostable.** One Docker image plus Postgres and S3-compatible storage.

## Core data model (decide in Phase 1)
```
Design   { id, title, brandKitId?, pages: Page[] }
Page     { id, width, height, background, objects: Object[], durationMs? }
Object   { id, type, x, y, w, h, rotation, locked, opacity, ...typeProps }
Template { id, name, category, tags[], thumbnail, design: Design }
Asset    { id, kind, url, license, tags[] }
BrandKit { id, logos[], colors[], fonts[] }
```
Fabric `toJSON` maps onto `Object`. Multi-page, templates, resize and collaboration all fall out of this shape.

## Module map
| Module | Reference section | Phase |
|---|---|---|
| M1 Editor core | 1 Design Creation | 1 |
| M2 Templates, resize, brand kit | 1 Design Creation | 2 |
| M3 Asset library | 2 Content Library | 3 |
| M4 Export and publishing | 6 Output | 1 (basic), 4 (more) |
| M5 Accounts, sharing | 5 Collaboration | 4 |
| M6 Realtime collaboration | 5 Collaboration | 5 |
| M7 AI, presentations, video | 3, 4 | 6 |

## Phase 1: Editor core (M1, M4 basics) — ship a usable editor
- Done: add text/shapes/images, layers order, undo/redo, size presets, PNG export, local save
- Next: font picker (Google Fonts) and text styling, alignment, group/ungroup, lock, duplicate
- Next: snapping and alignment guides, rulers, zoom/pan
- Next: multi-page (page strip), per-object opacity, flip, corner radius, shadows, gradients
- Next: export JPG, SVG, PDF
- Move to Vite + TypeScript with the data model above; keep Fabric.js

## Phase 2: Templates and brand (M2)
- Template gallery: search, categories, tags, thumbnails (saved design JSON)
- Seed 20–30 original templates (social, slide, poster, flyer, resume, invite)
- Magic Resize: re-flow rules per target size (scale + anchor by object role: background, headline, logo)
- Brand Kit: logos, color palette, font set, one-click apply
- Photo editing: crop, filters, brightness/contrast/blur

## Phase 3: Asset library (M3)
- Uploads with validation and size limits, stored in S3/R2
- Stock search: Unsplash and Pexels APIs; icons from open sets (Lucide, Tabler)
- Elements: shapes, lines, frames, grids, stickers, simple charts
- Custom font upload (woff2) with loading
- Licensing metadata on every asset; background remover (`@imgly/background-removal`, client-side)

## Phase 4: Accounts, storage, publishing (M5, M4)
- Auth (Supabase or Lucia), Postgres for users/designs, folders, trash
- Share links: view / comment / edit, with role-based access
- Teams and shared brand kits
- Export pipeline: server render for large PDFs; GIF and MP4 of simple page sequences
- One-page website publish (static HTML from a design)

## Phase 5: Collaboration (M6)
- Yjs doc per design; sync object list over WebSocket
- Presence, cursors, comments with @mentions, notifications
- Approvals: request review, approve/reject

## Phase 6: AI, presentations, video (M7)
- Present mode, presenter notes
- Animations: page transitions and element-level motion
- Video timeline editor, WASM or server rendering via job queue
- AI (bring-your-own-key, provider-agnostic): text write/rewrite, image generation, background/object removal, prompt-to-design
- Needs queueing, rate limits, moderation hooks

## Later / out of scope for now
- Print ordering, social scheduling (platform OAuth and vendor deals)
- Docs and whiteboards
- Native mobile and desktop apps (responsive web first)
- App/plugin marketplace (design the editor API so plugins are possible; build later)

## Stack
- Frontend: Vite, TypeScript, Fabric.js, Zustand for state
- Backend (Phase 4+): Next.js or Hono, Postgres, S3/R2, Yjs server
- Hosting: static + API on Vercel or Cloudflare; Docker image for self-host

## Key decisions
1. **Engine:** stay on Fabric.js. Revisit only if performance fails past ~500 objects or video is needed.
2. **Template format:** plain design JSON, so users can share templates as files.
3. **Licensing:** app under MIT or AGPL (decide before first public release); bundle only permissively licensed fonts, icons and templates.
4. **AI:** optional and off by default, so the core stays free of API costs.

## Next step
Phase 1: move to Vite + TypeScript with the data model above, then fonts and text styling.
