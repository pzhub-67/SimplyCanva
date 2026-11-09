# SimplyCanva

An open-source, mobile-first design editor that runs in the browser (a "SimplyCanva").
Vite + TypeScript + Fabric.js. No backend: designs are saved in your browser (IndexedDB).

- Photo editing that follows Lightroom: the same settings, ranges and panels (Light with parametric and point curves, Color with Mix, B&W Mix, Grading wheels and Calibration, Effects, Detail, Optics, Geometry, Crop), presets that behave like Lightroom's (Amount 0-200), undo/redo, Previous, selective copy/paste and Create Preset.
- A local photo library (Photos): import photos, edit them, flag and filter, apply presets or paste settings to many at once, save full-size JPGs, or drop them into a design. Everything stays on the device.
- Lightroom presets: import `.xmp`, old `.lrtemplate` or a `.zip` pack; save your own looks and export them as `.xmp` (in a `.zip`) that Lightroom can import.
- Local profiles with an optional passcode and backup files (no sign-in, nothing leaves your device).
- Pinch zoom, snapping guides, group, lock, align, opacity, corners, shadows, multiple pages, PNG/JPG export.

```
npm install
npm run dev        # develop
npm test           # unit tests
npm run build      # typecheck + bundle
npm run artifact   # single-file page in dist/artifact.html
```

The plan, decisions, handoff notes and known shortcuts live in [PLAN.md](PLAN.md). Licensed under GPL-3.0 (see LICENSE).
