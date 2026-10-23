# Canva Feature Reference (for Web Developer)

Purpose: a summary of Canva's features, organized by module, to use as a reference when scoping or building a similar design tool. Feature availability and plan limits change often, so verify against Canva's current site.

---

## 1. Design Creation (Core Editor)

| Feature | Description | Dev notes |
|---|---|---|
| Templates | Large library of ready-made layouts: social posts, presentations, posters, flyers, resumes, invitations, logos, video | Needs template schema (JSON), categories, search, tagging |
| Drag-and-drop editor | Place, resize, rotate text, shapes, images, icons; alignment guides; layers; grouping | HTML5 canvas or SVG/DOM-based editor; undo/redo stack; snapping |
| Magic Resize | Converts a design to other formats (e.g., post to story or banner) in one click | Layout re-flow logic per target size |
| Brand Kit | Saved logos, brand colors, fonts applied across designs | Per-user/team asset store; palette and font pickers |

## 2. Content Library

- **Stock assets:** photos, videos, illustrations, icons, audio, fonts
- **Uploads:** user images, video, audio; custom fonts on paid plans
- **Elements:** charts, frames, grids, stickers, lines, shapes
- Dev notes: asset CDN, licensing metadata, search indexing, upload validation, font loading

## 3. AI Tools (Magic Studio)

- **Magic Write:** generate and rewrite text
- **Magic Media:** create images or short videos from text prompts
- **Magic Edit / Eraser / Expand / Grab Text:** edit, remove, or extend parts of images; make text inside images editable
- **Background Remover:** one-click subject isolation (paid)
- **Magic Design:** generates full design options from a prompt or the user's media
- Dev notes: relies on third-party or in-house generative model APIs; needs queueing, usage limits, and moderation

## 4. Presentations and Video

- **Presentation tools:** present mode, presenter notes, live audience interaction
- **Video editor:** timeline editing, trimming, transitions, animations, audio sync; export to MP4 or GIF
- **Animations:** page transitions and element-level motion
- Dev notes: timeline UI, server-side or WASM video rendering, long-running export jobs

## 5. Collaboration

- **Real-time editing:** multiple users on one design, with comments and @mentions
- **Sharing:** view, comment, or edit links; team folders; permissions
- **Approvals:** review workflows (paid team plans)
- Dev notes: WebSockets with CRDT or operational transform for conflict handling; role-based access control; notification system

## 6. Output and Publishing

- **Export formats:** PNG, JPG, PDF, SVG (paid), MP4, GIF
- **Print (Canva Print):** business cards, posters, shirts, mugs; delivered by mail
- **Content Planner:** schedule posts directly to social platforms
- **Websites:** build and publish simple one-page sites
- Dev notes: render pipeline for exports; social platform OAuth and APIs; hosting for published sites; print vendor integration

## 7. Other Features

- **Docs and Whiteboards:** document writing and brainstorming canvases
- **Photo editing:** filters, adjustments, cropping, effects
- **Apps and integrations:** Google Drive, Dropbox, Slack, and others
- **Mobile and desktop apps:** designs sync across devices
- Dev notes: plugin or app marketplace API; cross-device sync; responsive UI

## 8. Plans

| Plan | Includes |
|---|---|
| Free | Core editor, many templates, basic AI |
| Pro | Brand Kit, Magic Resize, premium assets, background remover |
| Teams / Education / Nonprofits | Collaboration tools; education and eligible nonprofits get free access |

Dev notes: feature gating by plan, billing integration, usage quotas.

---

## Suggested Build Priorities (if building a lighter version)

1. Canvas editor with text, shapes, images, layers, undo/redo
2. Template system and asset library
3. Export to PNG, JPG, PDF
4. User accounts, saved designs, brand kit
5. Real-time collaboration and sharing
6. AI features, video editing, and publishing integrations
