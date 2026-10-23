# Plan: Open-Source Canva Clone

Each phase ships something usable.

## Phase 1: Solid single-user editor (extend `canva-lite.html`)
- Undo/redo (snapshot `toJSON` on each change)
- Font picker (Google Fonts), text styling, alignment
- Align/snap guides, group/ungroup, lock, duplicate
- Canvas size presets (Instagram, slide, A4)
- Export PNG, JPG, SVG, PDF

## Phase 2: Persistence and templates
- Move to a real app: Vite + TypeScript, Fabric.js still as the engine
- Save designs as JSON files, then to a backend
- Template gallery: saved JSON with a thumbnail
- Multi-page designs (array of canvas JSONs)

## Phase 3: Assets
- Image upload to storage (S3/R2)
- Free stock via Unsplash/Pexels APIs
- Shapes, icons (SVG libraries like Lucide), lines
- Background remover (client-side, e.g. `@imgly/background-removal`)

## Phase 4: Accounts and backend
- Auth (Supabase or Lucia), Postgres for designs/users
- Design list, folders, sharing links
- Stack suggestion: Next.js + Supabase, one deploy target

## Phase 5: Collaboration (most expensive, do last)
- Real-time editing with Yjs, syncing the canvas object list
- Comments and cursors

## Phase 6: Nice-to-haves
- Brand kits, resize-to-other-formats, animation/video export, AI features

## Key decisions
1. **Engine:** Fabric.js (fast to build) vs Konva or a custom renderer (more control, more work). Stay on Fabric.
2. **Scope:** web only, solo-first. Skip mobile and collaboration until Phases 1-4 work.
3. **Hosting:** static app plus small backend; Vercel or Cloudflare.

## Next step
Phase 1, starting with undo/redo and canvas size presets (they change the data model most).
