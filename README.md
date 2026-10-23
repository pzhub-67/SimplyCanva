# SimplyCanva

An open-source, mobile-first design editor that runs in the browser (a "Canva Lite").
Vite + TypeScript + Fabric.js. No backend: designs are saved in your browser (IndexedDB).

- Photo editing close to iPhone Photos (sliders, preview until Done, hold to compare, crop and straighten) with Lightroom-style presets.
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
