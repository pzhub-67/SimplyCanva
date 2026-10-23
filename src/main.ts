import { fabric } from 'fabric';
import { PhotoImage, initEditor } from './editor';
import { FONTS, loadFont } from './fonts';
import { ICONS, svg } from './icons';
import { Design, FabricJSON, fabricToPage, newDesign, pageToFabric } from './model';
import { SIZES } from './sizes';
import { deleteDesign, getDesign, lastId, listMeta, migrateOld, putDesign, renameDesign, setLastId } from './store';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const all = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];

const ACCENT = '#0e9488';
const INK = '#16211f';
const DEFAULT_FONT = FONTS[0];
const PROPS = ['edit', 'orig', 'locked']; // custom per-object data kept in saves and undo

// Bigger, rounder handles so objects are easy to grab with a finger.
fabric.Object.prototype.set({
  transparentCorners: false, cornerStyle: 'circle', cornerColor: ACCENT, cornerStrokeColor: '#ffffff',
  borderColor: ACCENT, cornerSize: 12, borderScaleFactor: 1.5, padding: 0, // padding 0: the outline hugs the object exactly
});
Object.assign(fabric.Object.prototype, { touchCornerSize: 30 }); // missing from the type defs
// Corners only (no edge handles), and the rotate knob sits closer, so handles get in the way less.
fabric.Object.prototype.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false });
fabric.Object.prototype.controls.mtr.offsetY = -22;

const c = new fabric.Canvas('c', { backgroundColor: '#ffffff', preserveObjectStacking: true });
const raw = c as unknown as {
  wrapperEl: HTMLElement; contextTop: CanvasRenderingContext2D; _currentTransform: unknown; _groupSelector: unknown;
  _renderBackground: (ctx: CanvasRenderingContext2D) => void; drawControls: (ctx: CanvasRenderingContext2D) => void;
}; // not in the type defs
let logical = { w: 1080, h: 1080 };
let design: Design = newDesign(logical.w, logical.h);
let live = false; // true once a design is open; autosave stays off until then so it can't overwrite the saved one

all('[data-icon]').forEach(el => { el.innerHTML = svg(ICONS[el.dataset.icon!]); });

// --- zoom, pan, fit -------------------------------------------------------
// The canvas keeps its real pixel size (`logical`). `vz` is the zoom on top of "fit to screen" (1 = fit), `vx/vy` the pan.
// Two fingers pinch and pan; ctrl/cmd + wheel zooms on desktop.
const stage = $('stage');
const MAXZ = 4, MINZ = 0.4;
let vz = 1, vx = 0, vy = 0;
const base = () => Math.min((stage.clientWidth - 24) / logical.w, (stage.clientHeight - 24) / logical.h);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clampPan = (z: number, x: number, y: number) => { // keep part of the page on screen
  const mx = Math.max(0, (logical.w * base() * z - stage.clientWidth) / 2) + 48;
  const my = Math.max(0, (logical.h * base() * z - stage.clientHeight) / 2) + 48;
  return { x: clamp(x, -mx, mx), y: clamp(y, -my, my) };
};
// The canvas fills the whole stage and the page is drawn inside it, so objects (and their handles) can leave the page.
const fit = () => {
  const b = base();
  if (!(b > 0)) return;
  ({ x: vx, y: vy } = clampPan(vz, vx, vy));
  const z = b * vz, W = stage.clientWidth, H = stage.clientHeight;
  c.setDimensions({ width: W, height: H });
  c.setViewportTransform([z, 0, 0, z, (W - logical.w * z) / 2 + vx, (H - logical.h * z) / 2 + vy]);
  raw.wrapperEl.style.cssText += ';position:absolute;left:0;top:0;transform:none';
  c.calcOffset();
  const home = Math.abs(vz - 1) < 0.001 && Math.abs(vx) < 1 && Math.abs(vy) < 1;
  $('zoom-fit').textContent = home ? 'Fit' : `${Math.round(z * 100)}%`;
  $('zoom-out').toggleAttribute('disabled', vz <= MINZ + 0.001);
  $('zoom-in').toggleAttribute('disabled', vz >= MAXZ - 0.001);
  c.requestRenderAll();
};
const resetView = () => { vz = 1; vx = 0; vy = 0; fit(); };
const zoomAt = (z: number, px: number, py: number) => { // keep the point under (px, py) in place
  z = clamp(z, MINZ, MAXZ);
  const k = z / vz, cx = stage.clientWidth / 2, cy = stage.clientHeight / 2;
  vx = px - (px - cx - vx) * k - cx; vy = py - (py - cy - vy) * k - cy; vz = z;
  fit();
};
new ResizeObserver(fit).observe(stage);
$('zoom-fit').onclick = resetView;
const zoomStep = (f: number) => zoomAt(vz * f, stage.clientWidth / 2, stage.clientHeight / 2);
$('zoom-in').onclick = () => zoomStep(1.5);
$('zoom-out').onclick = () => zoomStep(1 / 1.5);

stage.addEventListener('wheel', e => {
  if (document.body.dataset.editing) return;
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  if (e.ctrlKey || e.metaKey) zoomAt(vz * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
  else if (vz > 1.001) { vx -= e.deltaX; vy -= e.deltaY; fit(); }
}, { passive: false });

// Two-finger pinch. Touches are intercepted before Fabric sees them, and anything the first finger started is undone.
let pinch: { d0: number; x0: number; y0: number; z0: number; vx0: number; vy0: number; z: number; x: number; y: number } | null = null;
let swallow = false; // keep ignoring touches until every finger is up
let grab: { o: fabric.Object; left: number; top: number; sx: number; sy: number; angle: number } | null = null;
c.on('mouse:down', e => { const o = e.target; grab = o ? { o, left: o.left ?? 0, top: o.top ?? 0, sx: o.scaleX ?? 1, sy: o.scaleY ?? 1, angle: o.angle ?? 0 } : null; });
const two = (t: TouchList) => {
  const r = stage.getBoundingClientRect(), a = t[0], b = t[1];
  return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, x: (a.clientX + b.clientX) / 2 - r.left, y: (a.clientY + b.clientY) / 2 - r.top };
};
const stop = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
stage.addEventListener('touchstart', e => {
  if (document.body.dataset.editing) return;
  if (swallow || pinch) { stop(e); return; }
  if (e.touches.length !== 2) return;
  stop(e); swallow = true;
  if (grab) { grab.o.set({ left: grab.left, top: grab.top, scaleX: grab.sx, scaleY: grab.sy, angle: grab.angle }); grab.o.setCoords(); }
  raw._currentTransform = null; raw._groupSelector = null; c.clearContext(raw.contextTop); c.requestRenderAll();
  const p = two(e.touches);
  pinch = { d0: p.d, x0: p.x, y0: p.y, z0: vz, vx0: vx, vy0: vy, z: vz, x: vx, y: vy };
}, { capture: true, passive: false });
stage.addEventListener('touchmove', e => {
  if (!swallow) return;
  stop(e);
  if (!pinch || e.touches.length < 2) return;
  const p = two(e.touches), cx = stage.clientWidth / 2, cy = stage.clientHeight / 2;
  const z = clamp(pinch.z0 * (p.d / pinch.d0), MINZ, MAXZ), k = z / pinch.z0;
  const pan = clampPan(z, p.x - (pinch.x0 - cx - pinch.vx0) * k - cx, p.y - (pinch.y0 - cy - pinch.vy0) * k - cy);
  pinch.z = z; pinch.x = pan.x; pinch.y = pan.y;
  const s = z / vz;
  raw.wrapperEl.style.transform = `translate(${pan.x - vx * s}px, ${pan.y - vy * s}px) scale(${s})`; // cheap live preview; fit() redraws sharply on release
}, { capture: true, passive: false });
const endPinch = (e: TouchEvent) => {
  if (!swallow) return;
  stop(e);
  if (pinch) { vz = pinch.z; vx = pinch.x; vy = pinch.y; pinch = null; fit(); }
  if (e.touches.length === 0) swallow = false;
};
stage.addEventListener('touchend', endPinch, { capture: true, passive: false });
stage.addEventListener('touchcancel', endPinch, { capture: true, passive: false });

// --- drawing the page ------------------------------------------------------
// Fabric would paint the background over the whole canvas, so draw the page ourselves. Anything outside the page is faded
// (except the selected object, shown in full) and never reaches the exported image.
let exporting = false;
const pageBg = () => String(c.backgroundColor || '#ffffff');
raw._renderBackground = ctx => {
  if (exporting) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = pageBg(); ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.restore(); return; }
  const v = c.viewportTransform!, z = v[0];
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 2;
  ctx.fillStyle = pageBg(); ctx.fillRect(v[4], v[5], logical.w * z, logical.h * z);
  ctx.restore();
};
const drawControlsOrig = raw.drawControls.bind(c);
raw.drawControls = ctx => {
  if (exporting) return;
  const v = c.viewportTransform!, z = v[0];
  const outside = () => { ctx.beginPath(); ctx.rect(0, 0, c.getWidth(), c.getHeight()); ctx.rect(v[4], v[5], logical.w * z, logical.h * z); };
  ctx.save();
  ctx.globalAlpha = 0.6; ctx.fillStyle = getComputedStyle(stage).backgroundColor;
  outside(); ctx.fill('evenodd');
  ctx.restore();
  const a = c.getActiveObject();
  if (a) { // selected object stays fully visible, even outside the page
    ctx.save(); outside(); ctx.clip('evenodd');
    ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
    a.render(ctx);
    ctx.restore();
  }
  if (guides.length) {
    ctx.save(); ctx.strokeStyle = '#ff3d81'; ctx.lineWidth = 1; ctx.beginPath();
    for (const g of guides) {
      if (g.x !== undefined) { const x = v[4] + g.x * z; ctx.moveTo(x, 0); ctx.lineTo(x, c.getHeight()); }
      if (g.y !== undefined) { const y = v[5] + g.y * z; ctx.moveTo(0, y); ctx.lineTo(c.getWidth(), y); }
    }
    ctx.stroke(); ctx.restore();
  }
  drawControlsOrig(ctx);
};
// --- snapping guides ---------------------------------------------------------
// While moving, edges and centers snap to the page and to other objects (8 screen px), with guide lines shown.
let guides: { x?: number; y?: number }[] = [];
c.on('object:moving', e => {
  const o = e.target;
  if (!o) return;
  const thr = 8 / c.getZoom(), skip = new Set<fabric.Object>(o.type === 'activeSelection' ? (o as fabric.ActiveSelection).getObjects() : [o]);
  const xs = [0, logical.w / 2, logical.w], ys = [0, logical.h / 2, logical.h];
  c.getObjects().forEach(q => {
    if (skip.has(q) || !q.visible) return;
    const r = q.getBoundingRect(true, true);
    xs.push(r.left, r.left + r.width / 2, r.left + r.width); ys.push(r.top, r.top + r.height / 2, r.top + r.height);
  });
  const r = o.getBoundingRect(true, true);
  const best = (mine: number[], targets: number[]) => {
    let pick: { d: number; at: number } | null = null;
    for (const m of mine) for (const g of targets) { const d = g - m; if (Math.abs(d) <= thr && (!pick || Math.abs(d) < Math.abs(pick.d))) pick = { d, at: g }; }
    return pick;
  };
  const bx = best([r.left, r.left + r.width / 2, r.left + r.width], xs);
  const by = best([r.top, r.top + r.height / 2, r.top + r.height], ys);
  if (bx) o.set('left', (o.left ?? 0) + bx.d);
  if (by) o.set('top', (o.top ?? 0) + by.d);
  guides = [...(bx ? [{ x: bx.at }] : []), ...(by ? [{ y: by.at }] : [])];
});
const clearGuides = () => { if (guides.length) { guides = []; c.requestRenderAll(); } };
c.on('mouse:up', clearGuides);

// The page alone as an image, at the given width.
const pageImage = (format: 'png' | 'jpeg', outW: number, quality = 0.8) => {
  const v = c.viewportTransform!, z = v[0];
  exporting = true;
  try { return c.toDataURL({ format, quality, left: v[4], top: v[5], width: logical.w * z, height: logical.h * z, multiplier: outW / (logical.w * z) }); }
  finally { exporting = false; }
};

// Handles shrink with small objects so they never swallow what they belong to.
c.on('before:render', () => {
  const o = c.getActiveObject();
  if (!o) return;
  const s = Math.min(o.getScaledWidth(), o.getScaledHeight()) * c.getZoom();
  Object.assign(o, { cornerSize: clamp(s * 0.16, 7, 14), touchCornerSize: clamp(s * 0.7, 22, 32) });
});

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
// Designs are saved to IndexedDB (see store.ts). A blank design that was never touched is not saved, so Home stays tidy.
let stored = false; // true once this design exists in the store
const thumbOf = () => pageImage('jpeg', Math.round((logical.w * 240) / Math.max(logical.w, logical.h)), 0.7);
const save = async () => {
  design.pages[0] = fabricToPage(design.pages[0], c.toJSON(PROPS) as unknown as FabricJSON, logical.w, logical.h);
  if (!stored && !c.getObjects().length) return;
  try {
    await putDesign(design, { id: design.id, title: design.title, updated: Date.now(), thumb: thumbOf(), w: logical.w, h: logical.h });
    stored = true; setLastId(design.id);
  } catch { toast('Could not save: browser storage is full or blocked.'); }
};
let saveTimer = 0;
const autosave = () => { if (live) { clearTimeout(saveTimer); saveTimer = window.setTimeout(() => void save(), 500); } };
addEventListener('pagehide', () => { if (live) void save(); });

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
  hist.push(JSON.stringify(c.toJSON(PROPS)));
  pos = hist.length - 1;
  syncHistory(); autosave();
};
// Run several canvas changes as one undo step.
const batch = (fn: () => void) => { busy = true; try { fn(); } finally { busy = false; } snap(); };
const restore = (i: number) => {
  if (i < 0 || i >= hist.length) return;
  busy = true; pos = i;
  c.loadFromJSON(hist[i], () => { busy = false; relock(); refit(); syncUI(); syncHistory(); autosave(); });
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
  batch(() => { c.add(o); o.setPositionByOrigin(new fabric.Point(logical.w / 2, logical.h / 2), 'center', 'center'); o.setCoords(); });
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
      relock();
    });
    c.setActiveObject(cl);
    c.requestRenderAll();
  });
};
const order = (dir: 1 | -1) => {
  batch(() => c.getActiveObjects().forEach(o => { if (dir > 0) c.bringForward(o); else c.sendBackwards(o); }));
  c.requestRenderAll();
};

// --- lock, group, align ---------------------------------------------------------
type Lockable = fabric.Object & { locked?: boolean };
const applyLock = (o: Lockable) => {
  const on = !!o.locked;
  o.set({ lockMovementX: on, lockMovementY: on, lockRotation: on, lockScalingX: on, lockScalingY: on, hasControls: !on });
};
const relock = () => c.getObjects().forEach(o => applyLock(o as Lockable));
const toggleLock = () => {
  const objs = c.getActiveObjects() as Lockable[];
  if (!objs.length) return;
  const on = !objs.every(o => o.locked);
  batch(() => objs.forEach(o => { o.locked = on || undefined; applyLock(o); }));
  c.requestRenderAll(); syncUI();
  toast(on ? 'Locked. Tap Unlock to move it again.' : 'Unlocked');
};
const groupSel = () => {
  const a = c.getActiveObject();
  if (!a) return;
  batch(() => {
    if (a.type === 'activeSelection') (a as fabric.ActiveSelection).toGroup();
    else if (a.type === 'group') (a as fabric.Group).toActiveSelection();
  });
  c.requestRenderAll(); syncUI();
};
// --- style: opacity, corners, shadow, flip -------------------------------------
const SHADOWS: Record<string, fabric.IShadowOptions | null> = {
  None: null,
  Soft: { color: 'rgba(0,0,0,0.35)', blur: 24, offsetX: 0, offsetY: 8 },
  Hard: { color: 'rgba(0,0,0,0.5)', blur: 0, offsetX: 10, offsetY: 10 },
};
const shadowName = (o: fabric.Object) => { const s = o.shadow as fabric.Shadow | null; return !s ? 'None' : s.blur === 0 ? 'Hard' : 'Soft'; };
const styled = (fn: (o: fabric.Object) => void, commit: boolean) => {
  const objs = c.getActiveObjects();
  if (!objs.length) return;
  objs.forEach(fn); c.requestRenderAll();
  if (commit) snap();
};
const opEl = $<HTMLInputElement>('st-op'), radEl = $<HTMLInputElement>('st-rad');
opEl.oninput = () => { $('st-op-v').textContent = opEl.value; styled(o => o.set('opacity', Number(opEl.value) / 100), false); };
opEl.onchange = () => styled(() => {}, true);
const radOf = (o: fabric.Object) => { const r = o as fabric.Rect; return Math.min(r.width ?? 1, r.height ?? 1) / 2; };
radEl.oninput = () => { $('st-rad-v').textContent = radEl.value; styled(o => { if (o.type === 'rect') { const r = Number(radEl.value) / 100 * radOf(o); (o as fabric.Rect).set({ rx: r, ry: r }); } }, false); };
radEl.onchange = () => styled(() => {}, true);
$('st-shadow').replaceChildren(...Object.keys(SHADOWS).map(name => {
  const b = document.createElement('button');
  b.className = 'chip'; b.textContent = name; b.dataset.shadow = name;
  b.onclick = () => { const s = SHADOWS[name]; styled(o => { o.set('shadow', s ? new fabric.Shadow(s) : (null as unknown as string)); }, true); syncStyle(); };
  return b;
}));
all('[data-flip]').forEach(b => { b.onclick = () => styled(o => { if (b.dataset.flip === 'x') o.set('flipX', !o.flipX); else o.set('flipY', !o.flipY); }, true); });
const syncStyle = () => {
  const objs = c.getActiveObjects(), o = objs[0];
  if (!o) return;
  opEl.value = String(Math.round((o.opacity ?? 1) * 100)); $('st-op-v').textContent = opEl.value;
  const rects = objs.every(x => x.type === 'rect');
  $('st-rad-row').hidden = !rects;
  if (rects) { radEl.value = String(Math.round(((o as fabric.Rect).rx ?? 0) / radOf(o) * 100)); $('st-rad-v').textContent = radEl.value; }
  all('[data-shadow]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.shadow === shadowName(o))));
};

type Edge = 'l' | 'c' | 'r' | 't' | 'm' | 'b';
// One object aligns to the page; several align to each other.
const align = (edge: Edge) => {
  const objs = c.getActiveObjects();
  if (!objs.length) return;
  batch(() => {
    c.discardActiveObject();
    const rs = objs.map(o => o.getBoundingRect(true, true));
    const box = objs.length === 1
      ? { l: 0, t: 0, r: logical.w, b: logical.h }
      : { l: Math.min(...rs.map(r => r.left)), t: Math.min(...rs.map(r => r.top)), r: Math.max(...rs.map(r => r.left + r.width)), b: Math.max(...rs.map(r => r.top + r.height)) };
    objs.forEach((o, i) => {
      const r = rs[i];
      const dx = edge === 'l' ? box.l - r.left : edge === 'c' ? (box.l + box.r) / 2 - (r.left + r.width / 2) : edge === 'r' ? box.r - (r.left + r.width) : 0;
      const dy = edge === 't' ? box.t - r.top : edge === 'm' ? (box.t + box.b) / 2 - (r.top + r.height / 2) : edge === 'b' ? box.b - (r.top + r.height) : 0;
      o.set({ left: (o.left ?? 0) + dx, top: (o.top ?? 0) + dy }); o.setCoords();
    });
    c.setActiveObject(objs.length > 1 ? new fabric.ActiveSelection(objs, { canvas: c }) : objs[0]);
  });
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
  const isGroup = o?.type === 'group', canGroup = o?.type === 'activeSelection';
  $('b-group').hidden = !isGroup && !canGroup;
  $('b-group').lastChild!.textContent = isGroup ? 'Ungroup' : 'Group';
  const allLocked = sel.length > 0 && sel.every(x => (x as Lockable).locked);
  $('b-lock').lastChild!.textContent = allLocked ? 'Unlock' : 'Lock';
  $('b-lock').setAttribute('aria-pressed', String(allLocked));
  all('[data-for]').forEach(el => {
    const f = el.dataset.for;
    el.hidden = !o || (f === 'text' && !t) || (f === 'fill' && (onlyImage || isGroup))
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

// --- home screen and opening designs ----------------------------------------
const startNew = (w: number, h: number) => {
  clearTimeout(saveTimer);
  busy = true; c.clear(); busy = false;
  setBg('#ffffff', false);
  design = newDesign(w, h); logical = { w, h }; hist = []; pos = -1; stored = false;
  vz = 1; vx = 0; vy = 0; fit(); snap(); live = true;
  $('home').hidden = true; syncUI();
};
const loadDesign = (d: Design) => {
  clearTimeout(saveTimer);
  try {
    design = d;
    const page = d.pages[0];
    logical = { w: page.width, h: page.height };
    vz = 1; vx = 0; vy = 0;
    busy = true;
    c.loadFromJSON(pageToFabric(page), async () => {
      busy = false; relock(); hist = []; pos = -1; stored = true;
      fit(); setBg(page.background, false);
      await ensureFonts(page.objects.map(o => o.fontFamily).filter((f): f is string => typeof f === 'string'));
      snap(); live = true; setLastId(d.id); $('home').hidden = true; syncUI();
    });
  } catch { toast('That design could not be opened.'); startNew(1080, 1080); }
};
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'Just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const showHome = async () => {
  $('home-back').hidden = !live;
  $('home').hidden = false;
  if (live) { clearTimeout(saveTimer); await save(); } // so the current design is listed with a fresh preview
  const rows = await listMeta();
  $('home-empty').hidden = rows.length > 0;
  $('home-grid').replaceChildren(...rows.map(m => {
    const card = document.createElement('div');
    card.className = 'dcard';
    const thumb = document.createElement('button');
    thumb.className = 'thumb'; thumb.setAttribute('aria-label', `Open ${m.title}`);
    if (m.thumb) { const im = document.createElement('img'); im.src = m.thumb; im.alt = ''; thumb.append(im); }
    thumb.onclick = async () => {
      if (live && m.id === design.id) { $('home').hidden = true; return; }
      const d = await getDesign(m.id);
      if (d) loadDesign(d); else toast('That design is missing.');
    };
    const name = document.createElement('input');
    name.value = m.title; name.setAttribute('aria-label', 'Design name');
    name.onchange = async () => {
      const title = name.value.trim() || 'Untitled';
      name.value = title;
      if (m.id === design.id) design.title = title;
      await renameDesign(m.id, title);
    };
    const row = document.createElement('div');
    row.className = 'meta';
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.onclick = async () => {
      if (del.textContent === 'Delete') { del.textContent = 'Sure?'; setTimeout(() => { del.textContent = 'Delete'; }, 3000); return; }
      await deleteDesign(m.id);
      if (live && m.id === design.id) startNew(1080, 1080); // the open design was deleted: leave a fresh blank one behind
      void showHome();
    };
    row.append(`${ago(m.updated)} · ${m.w}×${m.h}`, del);
    card.append(thumb, name, row);
    return card;
  }));
};
all('[data-new]').forEach(b => { b.onclick = () => { const s = SIZES[Number(b.dataset.new)]; startNew(s.w, s.h); }; });

// --- export ----------------------------------------------------------------
// Downloads can be blocked in embedded viewers, so show the image too: press and hold saves it on a phone.
const exportPNG = () => {
  const url = pageImage('png', logical.w);
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
  undo, redo, del, dup, export: exportPNG, home: () => void showHome(), closeSheet,
  style: () => { syncStyle(); openSheet('style'); }, lock: toggleLock, group: groupSel, align: () => openSheet('align'),
  edit: () => { const [img] = images(); if (img) editor.open(img); },
  copyEdits: () => { const [img] = images(); if (img) editor.copyEdits(img); },
  pasteEdits: () => editor.pasteEdits(images()),
  continue: () => { $('home').hidden = true; },
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
all('[data-align]').forEach(b => { b.onclick = () => align(b.dataset.align as Edge); });
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
// Open straight into the last design, or a blank square page. Home (and the size picker) is one tap away.
void (async () => {
  await migrateOld('');
  const id = lastId();
  let d = id ? await getDesign(id) : undefined;
  if (!d) { const m = (await listMeta())[0]; if (m) d = await getDesign(m.id); }
  if (d) loadDesign(d); else startNew(1080, 1080);
})();
