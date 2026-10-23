import { fabric } from 'fabric';
import { PhotoImage, initEditor } from './editor';
import { FONTS, loadFont } from './fonts';
import { ICONS, svg } from './icons';
import { Design, FabricJSON, fabricToPage, newDesign, pageToFabric } from './model';
import { SIZES } from './sizes';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const all = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];

const ACCENT = '#0e9488';
const INK = '#16211f';
const KEY = 'canva-lite:design';
const DEFAULT_FONT = FONTS[0];

// Bigger, rounder handles so objects are easy to grab with a finger.
fabric.Object.prototype.set({
  transparentCorners: false, cornerStyle: 'circle', cornerColor: ACCENT, cornerStrokeColor: '#ffffff',
  borderColor: ACCENT, cornerSize: 14, borderScaleFactor: 2, padding: 4,
});
Object.assign(fabric.Object.prototype, { touchCornerSize: 36 }); // missing from the type defs

const c = new fabric.Canvas('c', { backgroundColor: '#ffffff', preserveObjectStacking: true });
let logical = { w: 1080, h: 1080 };
let design: Design = newDesign(logical.w, logical.h);
let live = false; // true once a design is open; autosave stays off until then so it can't overwrite the saved one

all('[data-icon]').forEach(el => { el.innerHTML = svg(ICONS[el.dataset.icon!]); });

// --- zoom to fit ---------------------------------------------------------
// The canvas keeps its real pixel size (`logical`) and is zoomed to fit the screen.
const stage = $('stage');
const fit = () => {
  const z = Math.min((stage.clientWidth - 24) / logical.w, (stage.clientHeight - 24) / logical.h);
  if (z > 0) { c.setZoom(z); c.setDimensions({ width: logical.w * z, height: logical.h * z }); }
};
new ResizeObserver(fit).observe(stage);

// --- fonts ---------------------------------------------------------------
const fontSel = $<HTMLSelectElement>('font');
fontSel.innerHTML = FONTS.map(f => `<option style="font-family:'${f}'">${f}</option>`).join('');

// Fabric caches text metrics, so remeasure once a font has arrived.
const refit = () => {
  fabric.util.clearFabricFontCache();
  c.getObjects().forEach(o => { if (o instanceof fabric.Text) { o.initDimensions(); o.setCoords(); } });
  c.requestRenderAll();
};
const ensureFonts = (families: string[]) => Promise.all([...new Set(families)].map(loadFont)).then(refit);

// --- toast ---------------------------------------------------------------
let toastTimer = 0;
const toast = (msg: string, action?: { label: string; run: () => void }) => {
  const el = $('toast');
  el.replaceChildren(document.createTextNode(msg));
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { action.run(); el.hidden = true; };
    el.append(b);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.hidden = true; }, 4000);
};

// --- save / autosave -----------------------------------------------------
// shortcut: one autosave slot in localStorage (~5MB). Photos are downscaled on import to keep it small; move to IndexedDB or a backend when it bites.
const readSaved = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const save = () => {
  design.pages[0] = fabricToPage(design.pages[0], c.toJSON(['edit', 'orig']) as unknown as FabricJSON, logical.w, logical.h);
  try { localStorage.setItem(KEY, JSON.stringify(design)); } catch { toast('Could not save: browser storage is full or blocked.'); }
};
let saveTimer = 0;
const autosave = () => { if (live) { clearTimeout(saveTimer); saveTimer = window.setTimeout(save, 500); } };
addEventListener('pagehide', () => { if (live) save(); });

// --- history -------------------------------------------------------------
// shortcut: full-JSON snapshots, fine for small designs. Upgrade to diffs/patches when designs get heavy.
let hist: string[] = [], pos = -1, busy = false;
const syncHistory = () => {
  $('undo').toggleAttribute('disabled', pos <= 0);
  $('redo').toggleAttribute('disabled', pos >= hist.length - 1);
};
const snap = () => {
  if (busy) return;
  hist = hist.slice(0, pos + 1);
  hist.push(JSON.stringify(c.toJSON(['edit', 'orig'])));
  pos = hist.length - 1;
  syncHistory(); autosave();
};
// Run several canvas changes as one undo step.
const batch = (fn: () => void) => { busy = true; try { fn(); } finally { busy = false; } snap(); };
const restore = (i: number) => {
  if (i < 0 || i >= hist.length) return;
  busy = true; pos = i;
  c.loadFromJSON(hist[i], () => { busy = false; refit(); syncUI(); syncHistory(); autosave(); });
};
const undo = () => restore(pos - 1);
const redo = () => restore(pos + 1);
['object:added', 'object:modified', 'object:removed'].forEach(e => c.on(e, snap));

// --- sheets (bottom panel) -----------------------------------------------
let openName = '';
const closeSheet = () => {
  openName = '';
  $('sheet').hidden = true;
  all('[data-tab]').forEach(t => t.setAttribute('aria-pressed', 'false'));
};
const openSheet = (name: string) => {
  const same = openName === name;
  closeSheet();
  if (same) return;
  openName = name;
  $('sheet').hidden = false;
  all('[data-sheet]').forEach(s => {
    s.hidden = s.dataset.sheet !== name;
    if (!s.hidden) $('sheet-title').textContent = s.dataset.title ?? '';
  });
  all('[data-tab]').forEach(t => t.setAttribute('aria-pressed', String(t.dataset.tab === name)));
};
c.on('mouse:down', closeSheet);

// --- adding things -------------------------------------------------------
// Centered before the history snapshot, so undo/redo of an add keeps the position.
const place = (o: fabric.Object) => {
  batch(() => { c.add(o); c.viewportCenterObject(o); o.setCoords(); });
  c.setActiveObject(o); c.requestRenderAll(); closeSheet();
};

const TEXT = {
  heading: { label: 'Add a heading', div: 9, family: 'Poppins', weight: 'bold' },
  sub: { label: 'Add a subheading', div: 16, family: 'Poppins', weight: 'normal' },
  body: { label: 'Add body text', div: 26, family: 'Inter', weight: 'normal' },
} as const;
const addText = async (kind: keyof typeof TEXT) => {
  const k = TEXT[kind];
  await loadFont(k.family).catch(() => undefined);
  place(new fabric.IText(k.label, { fontFamily: k.family, fontWeight: k.weight, fontSize: Math.round(logical.w / k.div), fill: INK }));
};

const addShape = (kind: string) => {
  const s = Math.round(logical.w * 0.3);
  const o: fabric.Object = kind === 'circle' ? new fabric.Circle({ radius: s / 2 })
    : kind === 'triangle' ? new fabric.Triangle({ width: s, height: s })
    : new fabric.Rect({ width: s, height: Math.round(s * 0.7) });
  o.set({ fill: ACCENT });
  place(o);
};

// Phone photos are huge. Downscale on import so designs stay small enough to autosave.
const MAX_PX = 1600;
const prepImage = async (file: File) => {
  const bmp = await createImageBitmap(file); // applies EXIF rotation
  const s = Math.min(1, MAX_PX / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
  cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height);
  return cv.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88);
};
const addImage = async (file: File) => {
  try {
    const url = await prepImage(file);
    fabric.Image.fromURL(url, img => {
      img.scale(Math.min((logical.w * 0.6) / (img.width ?? 1), (logical.h * 0.6) / (img.height ?? 1)));
      place(img);
    });
  } catch {
    toast("That image format isn't supported. Try a JPG or PNG.");
  }
};
const isImage = (f: File) => f.type.startsWith('image/');
$<HTMLInputElement>('img').onchange = e => {
  const input = e.target as HTMLInputElement;
  [...(input.files ?? [])].filter(isImage).forEach(addImage);
  input.value = '';
};
addEventListener('paste', e => {
  const f = [...(e.clipboardData?.files ?? [])].find(isImage);
  if (f) { e.preventDefault(); addImage(f); }
});
stage.addEventListener('dragover', e => e.preventDefault());
stage.addEventListener('drop', e => { e.preventDefault(); [...(e.dataTransfer?.files ?? [])].filter(isImage).forEach(addImage); });

// --- editing the selection ----------------------------------------------
const textObj = () => { const o = c.getActiveObject(); return o instanceof fabric.IText ? o : undefined; };

const del = () => {
  const objs = c.getActiveObjects();
  if (!objs.length) return;
  batch(() => { objs.forEach(o => c.remove(o)); c.discardActiveObject(); });
  c.requestRenderAll();
  toast(objs.length > 1 ? 'Items deleted' : 'Deleted', { label: 'Undo', run: undo });
};
const dup = () => {
  const o = c.getActiveObject();
  if (!o) return;
  o.clone((cl: fabric.Object) => {
    batch(() => {
      c.discardActiveObject();
      cl.set({ left: (o.left ?? 0) + 24, top: (o.top ?? 0) + 24, evented: true });
      if (cl instanceof fabric.ActiveSelection) { cl.canvas = c; cl.forEachObject(x => { c.add(x); }); cl.setCoords(); } else c.add(cl);
    });
    c.setActiveObject(cl);
    c.requestRenderAll();
  });
};
const order = (dir: 1 | -1) => {
  batch(() => c.getActiveObjects().forEach(o => { if (dir > 0) c.bringForward(o); else c.sendBackwards(o); }));
  c.requestRenderAll();
};

const setText = (props: Record<string, unknown>) => { textObj()?.set(props); c.requestRenderAll(); snap(); syncUI(); };
const toggle = (key: 'fontWeight' | 'fontStyle' | 'underline', on: unknown) => {
  const o = textObj();
  if (o) setText({ [key]: o.get(key) === on ? (key === 'underline' ? false : 'normal') : on });
};
const bumpSize = (d: number) => {
  const o = textObj();
  if (o) setText({ fontSize: Math.max(6, Math.round((o.fontSize ?? 40) + d)) });
};
fontSel.onchange = async () => {
  const o = textObj();
  if (!o) return;
  await loadFont(fontSel.value).catch(() => undefined);
  o.set('fontFamily', fontSel.value);
  refit(); snap();
};
$<HTMLInputElement>('fsize').onchange = e => setText({ fontSize: Number((e.target as HTMLInputElement).value) || 40 });

const colorEl = $<HTMLInputElement>('color');
const setSwatch = (hex: string) => { $('swatch').style.setProperty('--sw', hex); colorEl.value = hex; };
colorEl.oninput = () => {
  c.getActiveObjects().forEach(o => { if (o.type !== 'image') o.set('fill', colorEl.value); });
  setSwatch(colorEl.value);
  c.requestRenderAll();
};
colorEl.onchange = snap;
const hexOf = (fill: unknown) => (typeof fill === 'string' ? `#${new fabric.Color(fill).toHex()}` : '#000000');

function syncUI() {
  const o = c.getActiveObject() ?? undefined;
  const t = textObj();
  const sel = c.getActiveObjects();
  const onlyImage = !!o && sel.every(x => x.type === 'image');
  $('ctx-hint').hidden = !!o;
  all('[data-for]').forEach(el => {
    const f = el.dataset.for;
    el.hidden = !o || (f === 'text' && !t) || (f === 'fill' && onlyImage)
      || (f === 'image1' && !(onlyImage && sel.length === 1)) || (f === 'imageN' && !onlyImage);
  });
  if (t) {
    fontSel.value = t.fontFamily ?? DEFAULT_FONT;
    $<HTMLInputElement>('fsize').value = String(Math.round(t.fontSize ?? 40));
    const pressed: Record<string, boolean> = {
      'b-bold': t.fontWeight === 'bold', 'b-italic': t.fontStyle === 'italic', 'b-underline': !!t.underline,
      'b-left': (t.textAlign ?? 'left') === 'left', 'b-center': t.textAlign === 'center', 'b-right': t.textAlign === 'right',
    };
    Object.entries(pressed).forEach(([id, on]) => $(id).setAttribute('aria-pressed', String(on)));
  }
  const first = c.getActiveObjects().find(x => x.type !== 'image');
  if (first) setSwatch(hexOf(first.fill));
}
['selection:created', 'selection:updated', 'selection:cleared'].forEach(e => c.on(e, syncUI));
c.on('selection:created', closeSheet);

// --- background and page size -------------------------------------------
const bgEl = $<HTMLInputElement>('bg');
const setBg = (color: string, commit: boolean) => {
  bgEl.value = color;
  $('bg-swatch').style.setProperty('--sw', color);
  c.setBackgroundColor(color, () => { c.requestRenderAll(); if (commit) snap(); });
};
bgEl.oninput = () => setBg(bgEl.value, false);
bgEl.onchange = snap;
$('swatches').innerHTML = ['#ffffff', '#f1f5f9', '#fde68a', '#bfdbfe', '#fecaca', '#bbf7d0', '#fbcfe8', '#0f172a']
  .map(col => `<button style="background:${col}" data-bg="${col}" aria-label="Background ${col}"></button>`).join('');
all('[data-bg]').forEach(b => { b.onclick = () => setBg(b.dataset.bg!, true); });
$('bg-swatch').style.setProperty('--sw', '#ffffff');

const sizeRow = (s: (typeof SIZES)[number], attr: string, i: number) =>
  `<button class="opt" ${attr}="${i}"><span class="ar" style="aspect-ratio:${s.w}/${s.h}"></span><span><b>${s.name}</b><small>${s.w} × ${s.h} px</small></span></button>`;
$('size-list').innerHTML = SIZES.map((s, i) => sizeRow(s, 'data-resize', i)).join('');
$('start-list').innerHTML = SIZES.map((s, i) => sizeRow(s, 'data-new', i)).join('');
// shortcut: changing size keeps objects where they are and isn't undoable. Smart re-flow ("Magic Resize") is Phase 3.
all('[data-resize]').forEach(b => {
  b.onclick = () => { const s = SIZES[Number(b.dataset.resize)]; logical = { w: s.w, h: s.h }; fit(); autosave(); closeSheet(); };
});

// --- start screen ---------------------------------------------------------
const startNew = (w: number, h: number) => {
  busy = true; c.clear(); busy = false;
  setBg('#ffffff', false);
  design = newDesign(w, h); logical = { w, h }; hist = []; pos = -1;
  fit(); snap(); live = true; autosave();
  $('start').hidden = true; syncUI();
};
const continueSaved = () => {
  if (live) { $('start').hidden = true; return; }
  const raw = readSaved();
  if (!raw) return;
  try {
    design = JSON.parse(raw) as Design;
    const page = design.pages[0];
    logical = { w: page.width, h: page.height };
    busy = true;
    c.loadFromJSON(pageToFabric(page), async () => {
      busy = false; hist = []; pos = -1;
      fit(); setBg(page.background, false);
      await ensureFonts(page.objects.map(o => o.fontFamily).filter((f): f is string => typeof f === 'string'));
      snap(); live = true; $('start').hidden = true; syncUI();
    });
  } catch { toast('Your saved design could not be opened.'); startNew(1080, 1080); }
};
const showStart = () => {
  const canContinue = live || !!readSaved();
  $('start-continue').hidden = !canContinue;
  $('start-continue').textContent = live ? 'Back to my design' : 'Continue my last design';
  $('start-warn').hidden = !live;
  $('start').hidden = false;
};
all('[data-new]').forEach(b => { b.onclick = () => { const s = SIZES[Number(b.dataset.new)]; startNew(s.w, s.h); }; });

// --- export ----------------------------------------------------------------
// Downloads can be blocked in embedded viewers, so show the image too: press and hold saves it on a phone.
const exportPNG = () => {
  c.discardActiveObject();
  c.setZoom(1); c.setDimensions({ width: logical.w, height: logical.h });
  const url = c.toDataURL({ format: 'png' });
  fit();
  $<HTMLImageElement>('export-img').src = url;
  const dl = $<HTMLAnchorElement>('export-dl');
  dl.href = url;
  dl.hidden = 'claude' in window; // embedded artifact viewers block downloads; press-and-hold on the image still works
  $('export').hidden = false;
};

// --- wiring ----------------------------------------------------------------
const editor = initEditor({ c, commit: snap, toast, pageRatio: () => logical.w / logical.h });
const images = () => c.getActiveObjects().filter((o): o is PhotoImage => o.type === 'image');
c.on('mouse:dblclick', e => { if (e.target?.type === 'image') editor.open(e.target as PhotoImage); });

const actions: Record<string, () => void> = {
  undo, redo, del, dup, export: exportPNG, new: showStart, closeSheet,
  edit: () => { const [img] = images(); if (img) editor.open(img); },
  copyEdits: () => { const [img] = images(); if (img) editor.copyEdits(img); },
  pasteEdits: () => editor.pasteEdits(images()),
  continue: continueSaved,
  closeExport: () => { $('export').hidden = true; },
  forward: () => order(1), backward: () => order(-1),
  bold: () => toggle('fontWeight', 'bold'),
  italic: () => toggle('fontStyle', 'italic'),
  underline: () => toggle('underline', true),
  left: () => setText({ textAlign: 'left' }),
  center: () => setText({ textAlign: 'center' }),
  right: () => setText({ textAlign: 'right' }),
  sizeDown: () => bumpSize(-4), sizeUp: () => bumpSize(4),
};
all('[data-act]').forEach(b => { b.onclick = actions[b.dataset.act!]; });
all('[data-text]').forEach(b => { b.onclick = () => addText(b.dataset.text as keyof typeof TEXT); });
all('[data-add]').forEach(b => { b.onclick = () => addShape(b.dataset.add!); });
all('[data-tab]').forEach(b => {
  b.onclick = () => { if (b.dataset.tab === 'photo') { closeSheet(); $('img').click(); } else openSheet(b.dataset.tab!); };
});

addEventListener('keydown', e => {
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
  if (textObj()?.isEditing || editor.isOpen()) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (k === 'delete' || k === 'backspace') del();
  else if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  else if (mod && k === 'y') { e.preventDefault(); redo(); }
  else if (mod && k === 'd') { e.preventDefault(); dup(); }
});

ensureFonts([DEFAULT_FONT]);
syncUI();
// Open straight into the last design, or a blank square page. The size picker is behind "New".
if (readSaved()) continueSaved(); else startNew(1080, 1080);
