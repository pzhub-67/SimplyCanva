// Photo edit mode, laid out like Lightroom mobile: Presets (and Profiles), Crop, Light (tone curve with parametric and
// point modes), Color (white balance, presence, Color Mix or B&W Mix, Color Grading wheels, Calibration), Effects,
// Detail, Optics and Geometry. Every control is a Lightroom setting with Lightroom's range and number format.
// Undo/redo, hold to compare, Previous, selective copy/paste and Create Preset live in the header and its ⋯ menu.
import { fabric } from 'fabric';
import { scope } from './accounts';
import { readSecure, writeSecure } from './secure';
import { loadPresetList, savePresetList } from './library';
import { makeDevelopFilter } from './develop';
import { initCropper, renderCropped } from './crop';
import { saveFile } from './download';
import { importPresetFiles, presetsZip } from './xmp';
import {
  BANDS, BUILTIN, Band, CurveKey, Dev, GROUPS, PhotoEdit, PhotoStats, Preset, Pt, SPEC, SPECS, WHEELS, Wheel,
  applyPreset, autoSettings, changed, cleanPreset, clamp, curveTable, fmt, groupOfKey, isEdited, isNeutralDev, migrateEdit, mono, num,
  parametricPoints, pick,
} from './photoModel';

// `orig` holds the untouched photo once a crop has been applied, so the crop can be re-edited or undone.
export type PhotoImage = fabric.Image & { edit?: PhotoEdit; orig?: { src: string } };
interface Deps {
  c: fabric.Canvas; commit: () => void; toast: (msg: string) => void; pageRatio: () => number;
  onGeometry?: (img: PhotoImage) => void; // the photo's pixels changed size (crop applied or removed)
  onClose?: (img: PhotoImage, saved: boolean) => void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const all = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}) => Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];

// --- presets (built-in, imported, saved), stored in the photo library's database ------------------
const PKEY = () => scope('canva-lite:presets');
let mine: Preset[] = [];
let saveFail: ((m: string) => void) | null = null;
export const loadPresets = async () => {
  let v: unknown = await loadPresetList().catch(() => null);
  if (v === null) { // older copies lived in localStorage: move them once
    v = await readSecure<unknown>(PKEY(), []);
    if (Array.isArray(v) && v.length && await savePresetList(v).catch(() => false)) { try { localStorage.removeItem(PKEY()); } catch { /* ignore */ } }
  }
  mine = Array.isArray(v) ? v.map(cleanPreset).filter((p): p is Preset => !!p) : [];
};
const saveMine = () => {
  void savePresetList(mine).then(ok => { if (!ok) return writeSecure(PKEY(), mine); }).catch(() => saveFail?.('Could not save presets: storage is full or blocked.'));
};
export const getPresets = () => mine;
export const setPresets = (l: Preset[]) => { mine = l; saveMine(); };
export const addPresets = (l: unknown[]) => { for (const p of l.map(cleanPreset)) if (p && !mine.some(x => x.id === p.id)) mine.push(p); saveMine(); };
export const allPresets = () => BUILTIN.concat(mine);
const YOURS = 'Your presets';
export const presetGroupOf = (p: Preset) => p.group || YOURS;
// Merge imported presets: the same name in the same group replaces the older copy.
export const mergePresets = (list: Preset[]) => { for (const p of list) { const i = mine.findIndex(x => x.name === p.name && (x.group ?? '') === (p.group ?? '')); if (i >= 0) mine[i] = p; else mine.push(p); } saveMine(); };

// --- copied settings (shared with the library) and the last finished edit (for Previous) ---------------
export interface Clip { dev: Dev; groups: string[]; crop?: PhotoEdit['crop'] }
let clip: Clip | null = null;
let lastDone: Dev | null = null;
export const getClip = () => clip;
export const setClip = (c: Clip | null) => { clip = c; };
export const pasteInto = (e: PhotoEdit, c: Clip): PhotoEdit => {
  const g = new Set(c.groups);
  const dev = Object.fromEntries(Object.entries(e.dev).filter(([k]) => !g.has(groupOfKey(k) ?? ''))) as Dev;
  return { ...e, dev: { ...dev, ...clone(c.dev) }, preset: undefined, ...(g.has('crop') ? { crop: clone(c.crop) } : {}) };
};

export const applyEdit = (img: PhotoImage, e: PhotoEdit | undefined) => {
  const m = migrateEdit(e, allPresets());
  img.edit = m && isEdited(m) ? m : undefined;
  const src = (img as unknown as { _originalElement?: CanvasImageSource })._originalElement ?? (img.getElement() as unknown as CanvasImageSource);
  img.filters = !m || isNeutralDev(m.dev) ? [] : [makeDevelopFilter(m.dev, src)];
  img.applyFilters();
};

// The photo as loaded (no edits), cover-cropped to a square: preset previews and Auto.
const smallOf = (img: fabric.Image, side: number) => {
  const src = ((img as unknown as { _originalElement?: CanvasImageSource })._originalElement ?? img.getElement()) as HTMLImageElement | HTMLCanvasElement;
  const w = (src as HTMLImageElement).naturalWidth || src.width, h = (src as HTMLImageElement).naturalHeight || src.height;
  const cv = Object.assign(document.createElement('canvas'), { width: side, height: side });
  const k = Math.max(side / w, side / h);
  cv.getContext('2d')!.drawImage(src, (side - w * k) / 2, (side - h * k) / 2, w * k, h * k);
  return cv;
};
const statsOf = (img: fabric.Image): PhotoStats => {
  const d = smallOf(img, 64).getContext('2d')!.getImageData(0, 0, 64, 64).data;
  const hist = new Array<number>(256).fill(0);
  let sum = 0, sat = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    hist[Math.round(l)]++; sum += l; n++;
    const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
    sat += mx ? (mx - mn) / mx : 0;
  }
  const pct = (f: number) => { let a = 0; for (let i = 0; i < 256; i++) { a += hist[i]; if (a >= n * f) return i / 255; } return 1; };
  return { mean: sum / n / 255, p1: pct(0.01), p5: pct(0.05), p95: pct(0.95), p99: pct(0.99), sat: sat / n };
};
// RGB histogram of what is on screen (the edited photo).
const histOf = (src: CanvasImageSource) => {
  const cv = Object.assign(document.createElement('canvas'), { width: 96, height: 96 });
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(src, 0, 0, 96, 96);
  const d = g.getImageData(0, 0, 96, 96).data;
  const h = [new Array<number>(64).fill(0), new Array<number>(64).fill(0), new Array<number>(64).fill(0)];
  for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 8) continue; h[0][d[i] >> 2]++; h[1][d[i + 1] >> 2]++; h[2][d[i + 2] >> 2]++; }
  return h;
};

const setSrc = (img: fabric.Image, url: string) => new Promise<void>(res => { img.setSrc(url, () => res()); });
const BAND_COLOR: Record<Band, string> = { Red: '#e5372f', Orange: '#f08a24', Yellow: '#f2cf1d', Green: '#3fae49', Aqua: '#2bb5b8', Blue: '#2f6fe0', Purple: '#7d46d6', Magenta: '#d63aa8' };
const WHEEL_LABEL: Record<Wheel, string> = { Shadow: 'Shadows', Midtone: 'Midtones', Highlight: 'Highlights', Global: 'Global' };
const CH_COLOR: Record<string, string> = { ToneCurvePV2012Red: '#e5372f', ToneCurvePV2012Green: '#3fae49', ToneCurvePV2012Blue: '#2f6fe0' };
const LIGHT = ['Exposure2012', 'Contrast2012', 'Highlights2012', 'Shadows2012', 'Whites2012', 'Blacks2012'];

export function initEditor({ c, commit, toast, pageRatio, onGeometry, onClose }: Deps) {
  saveFail = toast;
  const s = {
    img: null as PhotoImage | null, before: undefined as PhotoEdit | undefined, work: { dev: {} } as PhotoEdit,
    baked: undefined as PhotoEdit['crop'], src0: '', orig0: undefined as PhotoImage['orig'], center0: new fabric.Point(0, 0),
    band: 'Red' as Band, wheel: 'Shadow' as Wheel, curve: 'para' as 'para' | CurveKey, curveOpen: false,
    csub: '' as '' | 'mix' | 'grading' | 'calibration', pmode: 'presets' as 'presets' | 'profiles', group: 'SimplyCanva',
  };
  const cropper = initCropper(pageRatio);
  let raf = 0;
  // undo history for this session: snapshots of { dev, preset }
  let past: PhotoEdit[] = [], future: PhotoEdit[] = [], settled: PhotoEdit = { dev: {} };

  const syncGeometry = async () => {
    const img = s.img;
    if (!img || JSON.stringify(s.work.crop ?? null) === JSON.stringify(s.baked ?? null)) return;
    const center = img.getCenterPoint();
    if (s.work.crop) {
      const original = img.orig?.src ?? img.getSrc();
      const url = await renderCropped(original, s.work.crop);
      img.orig = img.orig ?? { src: original };
      await setSrc(img, url);
    } else if (img.orig) {
      await setSrc(img, img.orig.src);
      img.orig = undefined;
    }
    img.setPositionByOrigin(center, 'center', 'center'); img.setCoords();
    onGeometry?.(img);
    s.baked = clone(s.work.crop);
    thumbs = {}; small = null;
    render();
  };
  const leaveCrop = async () => {
    if (!cropper.isOpen()) return;
    s.work.crop = cropper.read();
    cropper.end();
    await syncGeometry();
    settle();
  };

  const render = () => { if (s.img) { applyEdit(s.img, s.work); c.requestRenderAll(); } };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };
  const changedAll = () => { paint(); schedule(); };
  // A change finished (slider released, button tapped): record it for undo and refresh the histogram.
  const settle = () => {
    const now = { dev: clone(s.work.dev), preset: clone(s.work.preset) };
    if (JSON.stringify(now) !== JSON.stringify(settled)) { past.push(settled); if (past.length > 100) past.shift(); future = []; settled = now; }
    paintUndo(); setTimeout(drawHist, 30);
  };
  const restore = (e: PhotoEdit) => { s.work = { ...s.work, dev: clone(e.dev), preset: clone(e.preset) }; settled = clone(e); changedAll(); paintUndo(); setTimeout(drawHist, 30); };
  $('ed-undo').onclick = () => { const p = past.pop(); if (!p) return; future.push(settled); restore(p); };
  $('ed-redo').onclick = () => { const f = future.pop(); if (!f) return; past.push(settled); restore(f); };
  const paintUndo = () => { $<HTMLButtonElement>('ed-undo').disabled = !past.length; $<HTMLButtonElement>('ed-redo').disabled = !future.length; };

  // --- one setting -------------------------------------------------------------------------
  const setVal = (k: string, v: number) => {
    const sp = SPEC[k], f = 10 ** sp.dp;
    v = Math.round(clamp(v, sp.min, sp.max) * f) / f;
    if (v === sp.def) delete s.work.dev[k]; else s.work.dev[k] = v;
    if (s.work.preset) { s.work.preset = undefined; paintPresets(); } // touching a slider bakes the preset in, as in Lightroom
  };

  // A slider row. keyOf can change (the Color Mix band, the grading wheel), so the row reads it every time.
  const painters: (() => void)[] = [];
  const slider = (keyOf: () => string, label?: string, cls = '') => {
    const row = el('div', { className: `slide ${cls}` });
    const name = el('span', { className: 'slide-name', title: 'Double-tap to reset' });
    const input = el('input', { type: 'range' });
    const out = el('output');
    out.title = 'Tap to type a value';
    row.append(name, input, out);
    const k = () => keyOf(), sp = () => SPEC[k()];
    const show = () => {
      const p = sp(), v = num(s.work.dev, k());
      name.textContent = label ?? p.label;
      input.min = String(p.min); input.max = String(p.max); input.step = String(10 ** -p.dp);
      input.setAttribute('aria-label', label ? `${label} ${p.label}` : p.label);
      input.value = String(v); out.textContent = fmt(k(), v);
      row.classList.toggle('changed', v !== p.def);
    };
    input.oninput = () => { setVal(k(), Number(input.value)); out.textContent = fmt(k(), num(s.work.dev, k())); row.classList.toggle('changed', num(s.work.dev, k()) !== sp().def); schedule(); paintMarks(); };
    input.onchange = () => settle();
    const reset = () => { setVal(k(), sp().def); changedAll(); settle(); };
    name.ondblclick = reset; input.ondblclick = reset;
    out.onclick = () => { // type an exact value, like Lightroom's number field
      const box = el('input', { type: 'text', inputMode: 'decimal', className: 'num', value: out.textContent ?? '' });
      out.replaceWith(box); box.focus(); box.select();
      const done = () => { const v = Number(box.value.replace('+', '')); if (Number.isFinite(v)) { setVal(k(), v); changedAll(); settle(); } box.replaceWith(out); show(); };
      box.onblur = done; box.onkeydown = e => { if (e.key === 'Enter') box.blur(); if (e.key === 'Escape') { box.value = 'x'; box.blur(); } };
    };
    painters.push(show);
    return row;
  };
  const key = (k: string) => () => k;
  const trackOf = (k: string) => (k === 'IncrementalTemperature' ? 'track-temp' : k === 'IncrementalTint' ? 'track-tint' : '');
  for (const box of all('[data-sliders]')) {
    const g = box.dataset.sliders!;
    const keys = g === 'light' ? LIGHT : SPECS.filter(sp => sp.group === g && sp.key !== 'PostCropVignetteStyle').map(sp => sp.key);
    box.replaceChildren(...keys.map(k => slider(key(k), undefined, trackOf(k))));
  }
  $('para-sliders').replaceChildren(...['ParametricHighlights', 'ParametricLights', 'ParametricDarks', 'ParametricShadows', 'ParametricShadowSplit', 'ParametricMidtoneSplit', 'ParametricHighlightSplit'].map(k => slider(key(k))));
  $<HTMLSelectElement>('vig-style').onchange = e => { setVal('PostCropVignetteStyle', Number((e.target as HTMLSelectElement).value)); changedAll(); settle(); };

  // Color Mix (or B&W Mix when the photo is black and white)
  $('bands').replaceChildren(...BANDS.map(b => {
    const d = document.createElement('button');
    d.title = b; d.style.background = BAND_COLOR[b]; d.dataset.band = b;
    d.setAttribute('aria-label', `${b} colors`);
    d.onclick = () => { s.band = b; paint(); };
    return d;
  }));
  $('mix-sliders').replaceChildren(slider(() => `HueAdjustment${s.band}`), slider(() => `SaturationAdjustment${s.band}`), slider(() => `LuminanceAdjustment${s.band}`));
  $('gray-sliders').replaceChildren(...BANDS.map(b => slider(key(`GrayMixer${b}`))));

  // Color Grading: one wheel at a time (Shadows, Midtones, Highlights, Global), then Luminance, Blending, Balance.
  $('ranges').replaceChildren(...WHEELS.map(w => {
    const b = el('button', { className: 'chip', textContent: WHEEL_LABEL[w] });
    b.dataset.wheel = w;
    b.onclick = () => { s.wheel = w; paint(); };
    return b;
  }));
  $('grade-sliders').replaceChildren(slider(() => `ColorGrade${s.wheel}Hue`, undefined, 'track-hue'), slider(() => `ColorGrade${s.wheel}Sat`), slider(() => `ColorGrade${s.wheel}Lum`), slider(key('ColorGradeBlending')), slider(key('SplitToningBalance')));
  const wheel = $<HTMLCanvasElement>('wheel');
  let wheelImg: ImageData | null = null;
  const drawWheel = () => {
    if (s.csub !== 'grading') return;
    const r = wheel.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, W = Math.max(40, Math.round(r.width * dpr));
    if (wheel.width !== W) { wheel.width = W; wheel.height = W; wheelImg = null; }
    const g = wheel.getContext('2d')!, R = W / 2;
    if (!wheelImg) {
      wheelImg = g.createImageData(W, W);
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
        const dx = x - R, dy = R - y, rr = Math.hypot(dx, dy) / R, i = (y * W + x) * 4;
        if (rr > 1) continue;
        const hh = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360, ss = rr;
        const f = (n: number) => { const k = (n + hh / 30) % 12; return 0.5 - 0.5 * ss * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
        wheelImg.data[i] = f(0) * 255; wheelImg.data[i + 1] = f(8) * 255; wheelImg.data[i + 2] = f(4) * 255; wheelImg.data[i + 3] = 255;
      }
    }
    g.putImageData(wheelImg, 0, 0);
    const hh = num(s.work.dev, `ColorGrade${s.wheel}Hue`) * Math.PI / 180, ss = num(s.work.dev, `ColorGrade${s.wheel}Sat`) / 100;
    g.beginPath(); g.arc(R + Math.cos(hh) * ss * R, R - Math.sin(hh) * ss * R, 8 * dpr, 0, Math.PI * 2);
    g.lineWidth = 3 * dpr; g.strokeStyle = '#fff'; g.stroke(); g.lineWidth = 1 * dpr; g.strokeStyle = '#000'; g.stroke();
  };
  const wheelAt = (e: PointerEvent) => {
    const r = wheel.getBoundingClientRect(), dx = (e.clientX - r.left) / r.width * 2 - 1, dy = 1 - (e.clientY - r.top) / r.height * 2;
    setVal(`ColorGrade${s.wheel}Hue`, ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360);
    setVal(`ColorGrade${s.wheel}Sat`, Math.min(1, Math.hypot(dx, dy)) * 100);
    painters.forEach(f => f()); paintMarks(); drawWheel(); schedule();
  };
  let wheelDrag = false;
  wheel.onpointerdown = e => { wheelDrag = true; wheel.setPointerCapture(e.pointerId); wheelAt(e); };
  wheel.onpointermove = e => { if (wheelDrag) wheelAt(e); };
  wheel.onpointerup = wheel.onpointercancel = () => { if (wheelDrag) { wheelDrag = false; settle(); } };
  wheel.ondblclick = () => { setVal(`ColorGrade${s.wheel}Hue`, 0); setVal(`ColorGrade${s.wheel}Sat`, 0); changedAll(); settle(); };

  all('[data-csub]').forEach(b => { b.onclick = () => { s.csub = s.csub === b.dataset.csub ? '' : b.dataset.csub as typeof s.csub; paint(); }; });
  const setMono = (on: boolean) => {
    if (on) { s.work.dev.ConvertToGrayscale = true; s.work.dev.Profile = 'Monochrome'; } else { delete s.work.dev.ConvertToGrayscale; delete s.work.dev.Profile; }
    if (s.work.preset) s.work.preset = undefined;
  };
  $('ed-mono').onclick = () => { setMono(!mono(s.work.dev)); changedAll(); settle(); };
  $('ed-auto').onclick = () => {
    if (!s.img) return;
    const a = autoSettings(statsOf(s.img));
    for (const [k, v] of Object.entries(a)) setVal(k, v as number);
    changedAll(); settle();
    toast('Auto applied. Tweak any slider, or Undo.');
  };

  // --- tone curve ------------------------------------------------------------------------------------
  const cv = $<HTMLCanvasElement>('curve');
  const pts = (): Pt[] => (s.curve === 'para' ? parametricPoints(s.work.dev) ?? [[0, 0], [255, 255]] : (s.work.dev[s.curve] as Pt[] | undefined) ?? [[0, 0], [255, 255]]);
  const setPts = (p: Pt[]) => {
    if (s.curve === 'para') return;
    if (p.length === 2 && p[0][0] === 0 && p[0][1] === 0 && p[1][0] === 255 && p[1][1] === 255) delete s.work.dev[s.curve]; else s.work.dev[s.curve] = p;
    if (s.work.preset) s.work.preset = undefined;
  };
  let hist: number[][] | null = null;
  const drawCurve = () => {
    if (!s.curveOpen) return;
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(r.width * dpr));
    if (cv.width !== W) { cv.width = W; cv.height = W; }
    const g = cv.getContext('2d')!, k = W / 255, css = getComputedStyle(document.body);
    const ink = css.getPropertyValue('--ink').trim() || '#000', muted = css.getPropertyValue('--muted').trim() || '#888';
    g.clearRect(0, 0, W, W);
    if (hist) {
      const ch = s.curve === 'ToneCurvePV2012Red' ? [0] : s.curve === 'ToneCurvePV2012Green' ? [1] : s.curve === 'ToneCurvePV2012Blue' ? [2] : [0, 1, 2];
      const sum = hist[0].map((_, i) => ch.reduce((a, j) => a + hist![j][i], 0)), mx = Math.max(...sum.slice(1, 63), 1);
      g.fillStyle = muted; g.globalAlpha = 0.22; g.beginPath(); g.moveTo(0, W);
      sum.forEach((v, i) => g.lineTo((i + 0.5) * W / 64, W - Math.min(1, v / mx) * W * 0.9));
      g.lineTo(W, W); g.fill(); g.globalAlpha = 1;
    }
    g.strokeStyle = muted; g.globalAlpha = 0.35; g.lineWidth = dpr;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(i * W / 4, 0); g.lineTo(i * W / 4, W); g.moveTo(0, i * W / 4); g.lineTo(W, i * W / 4); g.stroke(); }
    g.beginPath(); g.moveTo(0, W); g.lineTo(W, 0); g.stroke();
    if (s.curve === 'para') for (const sk of ['ParametricShadowSplit', 'ParametricMidtoneSplit', 'ParametricHighlightSplit']) { const x = num(s.work.dev, sk) * 2.55 * k; g.setLineDash([4 * dpr, 4 * dpr]); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, W); g.stroke(); g.setLineDash([]); }
    g.globalAlpha = 1;
    const t = curveTable(pts());
    g.strokeStyle = s.curve === 'para' ? ink : CH_COLOR[s.curve] || ink; g.lineWidth = 2 * dpr; g.beginPath();
    for (let x = 0; x < 256; x++) { const X = x * k, Y = W - t[x] * k; if (x) g.lineTo(X, Y); else g.moveTo(X, Y); }
    g.stroke();
    if (s.curve !== 'para') for (const [x, y] of pts()) { g.beginPath(); g.arc(x * k, W - y * k, 6 * dpr, 0, Math.PI * 2); g.fillStyle = css.getPropertyValue('--surface').trim() || '#fff'; g.fill(); g.stroke(); }
  };
  const toCurve = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 255, (1 - (e.clientY - r.top) / r.height) * 255, r.width] as const; };
  let drag = -1, lastTap = 0;
  cv.onpointerdown = e => {
    if (s.curve === 'para') return;
    const [x, y, w] = toCurve(e), p = pts().map(q => [...q] as Pt), hit = 22 * 255 / w;
    let i = p.findIndex(q => Math.hypot(q[0] - x, q[1] - y) < hit);
    if (i > 0 && i < p.length - 1 && Date.now() - lastTap < 300) { p.splice(i, 1); setPts(p); lastTap = 0; changedAll(); settle(); return; }
    lastTap = Date.now();
    if (i < 0) {
      if (p.length >= 16) return;
      const nx = Math.round(Math.min(254, Math.max(1, x)));
      if (p.some(q => Math.abs(q[0] - nx) < 4)) return;
      p.push([nx, Math.round(curveTable(p)[nx])]); p.sort((a, b) => a[0] - b[0]);
      i = p.findIndex(q => q[0] === nx);
      setPts(p);
    }
    drag = i; cv.setPointerCapture(e.pointerId); changedAll();
  };
  cv.onpointermove = e => {
    if (drag < 0) return;
    const [x, y] = toCurve(e), p = pts().map(q => [...q] as Pt), last = p.length - 1;
    if ((x < -30 || x > 285 || y < -30 || y > 285) && drag > 0 && drag < last) { p.splice(drag, 1); drag = -1; setPts(p); changedAll(); return; }
    const lo = drag === 0 ? 0 : p[drag - 1][0] + 3, hi = drag === last ? 255 : p[drag + 1][0] - 3;
    const nx = drag === 0 ? Math.min(x, p[1][0] - 3) : drag === last ? Math.max(x, p[last - 1][0] + 3) : Math.min(hi, Math.max(lo, x));
    p[drag] = [Math.round(clamp(nx, 0, 255)), Math.round(clamp(y, 0, 255))];
    setPts(p); changedAll();
  };
  cv.onpointerup = cv.onpointercancel = () => { if (drag >= 0) settle(); drag = -1; };
  all<HTMLButtonElement>('#curve-ch [data-ch]').forEach(b => { b.onclick = () => { s.curve = b.dataset.ch as typeof s.curve; paint(); }; });
  $('curve-reset').onclick = () => {
    if (s.curve === 'para') for (const k of Object.keys(s.work.dev)) { if (k.startsWith('Parametric')) delete s.work.dev[k]; }
    else delete s.work.dev[s.curve];
    changedAll(); settle();
  };
  $('curve-btn').onclick = () => { s.curveOpen = !s.curveOpen; paint(); };

  // histogram of the edited photo
  const hc = $<HTMLCanvasElement>('hist');
  function drawHist() {
    if (!s.img || tab !== 'light') return;
    try { hist = histOf(s.img.getElement() as unknown as CanvasImageSource); } catch { return; }
    const r = hc.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (hc.width !== W || hc.height !== H) { hc.width = W; hc.height = H; }
    const g = hc.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    const mx = Math.max(...hist.flatMap(h => h.slice(1, 63)), 1);
    g.globalCompositeOperation = 'lighter';
    ['#e5372f', '#3fae49', '#2f6fe0'].forEach((col, j) => {
      g.fillStyle = col; g.globalAlpha = 0.7; g.beginPath(); g.moveTo(0, H);
      hist![j].forEach((v, i) => g.lineTo((i + 0.5) * W / 64, H - Math.min(1, v / mx) * H * 0.95));
      g.lineTo(W, H); g.fill();
    });
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    drawCurve();
  }

  // --- presets and profiles -------------------------------------------------------------------------
  let thumbs: Record<string, string> = {}, thumbBase = '';
  let small: HTMLCanvasElement | null = null;
  const baseDev = () => (s.work.preset ? s.work.preset.base : s.work.dev);
  const shotOf = (id: string, dev: Dev) => {
    if (!s.img) return '';
    const b = JSON.stringify(baseDev());
    if (b !== thumbBase) { thumbs = {}; thumbBase = b; }
    if (thumbs[id] !== undefined) return thumbs[id];
    try {
      small ??= smallOf(s.img, 88);
      const f = new fabric.Image(small);
      f.filters = isNeutralDev(dev) ? [] : [makeDevelopFilter(dev, small)];
      f.applyFilters();
      const out = Object.assign(document.createElement('canvas'), { width: 88, height: 88 });
      out.getContext('2d')!.drawImage(f.getElement() as CanvasImageSource, 0, 0, 88, 88);
      thumbs[id] = out.toDataURL('image/jpeg', 0.7);
    } catch { thumbs[id] = ''; }
    return thumbs[id];
  };
  const thumbChip = (label: string, id: string, dev: Dev, on: boolean, run: () => void) => {
    const b = el('button', { className: 'chip', onclick: run });
    b.setAttribute('aria-pressed', String(on));
    const src = shotOf(id, dev);
    if (src) { b.classList.add('th'); b.append(el('img', { src, alt: '' })); }
    b.append(label);
    return b;
  };
  const choose = (p: Preset) => {
    if (s.work.preset?.id === p.id) s.work = applyPreset(s.work, undefined); // tap again: remove it
    else s.work = applyPreset({ ...s.work, preset: undefined }, p, 100); // presets stack, like Lightroom
    changedAll(); settle();
  };
  const amount = $<HTMLInputElement>('amt-range');
  amount.oninput = () => {
    const p = s.work.preset && allPresets().find(x => x.id === s.work.preset!.id);
    if (!p) return;
    s.work = applyPreset(s.work, p, Number(amount.value));
    $('amt-val').textContent = amount.value;
    painters.forEach(f => f()); schedule();
  };
  amount.onchange = () => settle();
  amount.ondblclick = () => { const p = s.work.preset && allPresets().find(x => x.id === s.work.preset!.id); if (p) { s.work = applyPreset(s.work, p, 100); changedAll(); settle(); } };
  const groups = () => [...new Set(allPresets().map(presetGroupOf))];
  const gsel = $<HTMLSelectElement>('pgroup');
  gsel.onchange = () => { s.group = gsel.value; paint(); };
  all('[data-pmode]').forEach(b => { b.onclick = () => { s.pmode = b.dataset.pmode as typeof s.pmode; paint(); }; });

  function paintPresets() {
    all('[data-pmode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pmode === s.pmode)));
    $('preset-area').hidden = s.pmode !== 'presets';
    $('profile-area').hidden = s.pmode !== 'profiles';
    const gs = groups();
    if (!gs.includes(s.group)) s.group = gs[0];
    gsel.replaceChildren(...gs.map(g => el('option', { value: g, textContent: `${g} (${allPresets().filter(p => presetGroupOf(p) === g).length})`, selected: g === s.group })));
    if (tab === 'presets' && s.pmode === 'presets') {
      const fl = $('filters'), keep = fl.scrollLeft;
      fl.replaceChildren(...allPresets().filter(p => presetGroupOf(p) === s.group).map(p => thumbChip(p.name, p.id, applyPreset({ dev: baseDev() }, p).dev, s.work.preset?.id === p.id, () => choose(p))));
      fl.scrollLeft = keep;
    }
    if (tab === 'presets' && s.pmode === 'profiles') {
      const colour = { ...s.work.dev }; delete colour.ConvertToGrayscale; delete colour.Profile;
      $('profile-area').replaceChildren(
        thumbChip('Color', 'prof-color', colour, !mono(s.work.dev), () => { setMono(false); changedAll(); settle(); }),
        thumbChip('Monochrome', 'prof-mono', { ...colour, ConvertToGrayscale: true, Profile: 'Monochrome' }, mono(s.work.dev), () => { setMono(true); changedAll(); settle(); }),
      );
    }
    $('amount').hidden = !s.work.preset;
    amount.value = String(s.work.preset?.amount ?? 100);
    $('amt-val').textContent = String(s.work.preset?.amount ?? 100);
    if (!$('pmanage').hidden) paintMine();
  }
  const paintMine = () => {
    const rows = mine.map(p => {
      const row = el('div', { className: 'prow' });
      const name = el('input', { value: p.name });
      name.setAttribute('aria-label', 'Preset name');
      name.onchange = () => { p.name = name.value.trim().slice(0, 80) || p.name; saveMine(); paint(); };
      const exp = el('button', { className: 'tool', textContent: 'Export', onclick: () => void exportPresets([p], p.name) });
      const del = el('button', { className: 'tool', textContent: 'Delete' });
      del.setAttribute('aria-label', `Delete ${p.name}`);
      del.onclick = () => { mine = mine.filter(x => x.id !== p.id); if (s.work.preset?.id === p.id) s.work.preset = undefined; saveMine(); changedAll(); };
      row.append(name, exp, del);
      return row;
    });
    $('mine').replaceChildren(...(rows.length ? rows : [el('p', { className: 'muted', textContent: 'No presets of your own yet. Import Lightroom presets, or use ⋯ › Create preset.' })]));
    $('pexport-all').hidden = !mine.length;
  };
  $('pmanage-btn').onclick = () => { const open = $('pmanage').hidden; $('pmanage').hidden = !open; $('pmanage-btn').setAttribute('aria-expanded', String(open)); paint(); };
  const exportPresets = async (list: Preset[], name: string) => {
    if (!list.length) return;
    const r = await saveFile(`${name.replace(/&/g, 'and').replace(/[^\w\- ]+/g, '').trim() || 'presets'}.zip`, new Blob([presetsZip(list) as BlobPart], { type: 'application/zip' }));
    if (r === 'unavailable') toast('Saving files is not available here.');
    else if (r === 'saved') toast('Saved. In Lightroom: Presets, ⋯, Import presets, then pick the .zip.');
  };
  $('pexport-all').onclick = () => void exportPresets(mine, 'SimplyCanva presets');
  $<HTMLInputElement>('pimport').onchange = async e => {
    const input = e.target as HTMLInputElement, files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    const r = await importPresetFiles(files);
    if (!r.presets.length) { toast(r.failed.length ? 'No Lightroom presets found in that file.' : 'Nothing to import.'); return; }
    mergePresets(r.presets);
    s.group = presetGroupOf(r.presets[0]);
    if (s.img) { s.work = applyPreset({ ...s.work, preset: undefined }, r.presets[0], 100); settle(); }
    changedAll();
    toast(`Imported ${r.presets.length} preset${r.presets.length === 1 ? '' : 's'}${r.failed.length ? ` (${r.failed.length} file${r.failed.length === 1 ? '' : 's'} unreadable)` : ''}.${r.skipped.length ? ` Not supported, so left out: ${r.skipped.join(', ')}.` : ''}`);
  };

  // --- ⋯ menu: copy, paste, previous, create preset, reset, save -------------------------------------
  const menu = $('ed-menu'), dialog = $('ed-dialog');
  const closeMenus = () => { menu.hidden = true; dialog.hidden = true; $('ed-more').setAttribute('aria-expanded', 'false'); };
  $('ed-more').onclick = () => { const open = menu.hidden; closeMenus(); menu.hidden = !open; $('ed-more').setAttribute('aria-expanded', String(open)); paintMenu(); };
  const paintMenu = () => {
    (document.querySelector('[data-ed-menu="paste"]') as HTMLButtonElement).disabled = !clip;
    (document.querySelector('[data-ed-menu="previous"]') as HTMLButtonElement).disabled = !lastDone;
  };
  // A dialog with optional text fields and Lightroom's setting groups as checkboxes.
  const ask = (title: string, fields: { id: string; label: string; value: string; list?: string[] }[], defaults: Set<string>, ok: (vals: Record<string, string>, groups: string[]) => void) => {
    menu.hidden = true; dialog.hidden = false;
    $('ed-dialog-h').textContent = title;
    $('ed-dialog-fields').replaceChildren(...fields.map(f => {
      const i = el('input', { value: f.value, placeholder: f.label });
      i.dataset.field = f.id; i.setAttribute('aria-label', f.label);
      if (f.list) { const dl = el('datalist', { id: `dl-${f.id}` }); dl.append(...f.list.map(v => el('option', { value: v }))); i.setAttribute('list', dl.id); const box = el('div'); box.append(i, dl); return box; }
      return i;
    }));
    const present = new Set(changed(s.work.dev).map(k => groupOfKey(k)).filter(Boolean) as string[]);
    if (s.work.crop) present.add('crop');
    $('ed-groups').replaceChildren(...GROUPS.map(g => {
      const lab = el('label');
      const cb = el('input', { type: 'checkbox', checked: defaults.has(g.id) });
      cb.dataset.group = g.id;
      lab.append(cb, `${g.label}${present.has(g.id) ? '' : ' (unchanged)'}`);
      return lab;
    }));
    $('ed-dialog-ok').onclick = () => {
      const vals = Object.fromEntries(all<HTMLInputElement>('#ed-dialog-fields input').map(i => [i.dataset.field!, i.value]));
      const gs = all<HTMLInputElement>('#ed-groups input').filter(i => i.checked).map(i => i.dataset.group!);
      closeMenus(); ok(vals, gs);
    };
  };
  $('ed-dialog-cancel').onclick = closeMenus;
  const ALL_BUT = (...x: string[]) => new Set(GROUPS.map(g => g.id).filter(id => !x.includes(id)));
  const actions: Record<string, () => void> = {
    copy: () => ask('Copy settings', [], ALL_BUT('crop'), (_v, gs) => {
      clip = { dev: pick(clone(s.work.dev), new Set(gs)), groups: gs, crop: gs.includes('crop') ? clone(s.work.crop) : undefined };
      toast('Settings copied. Paste them here, on another photo, or on many in Photos.');
    }),
    paste: () => {
      if (!clip) return;
      const hadCrop = JSON.stringify(s.work.crop ?? null);
      s.work = pasteInto(s.work, clip);
      closeMenus(); changedAll(); settle();
      if (JSON.stringify(s.work.crop ?? null) !== hadCrop) void syncGeometry();
      toast('Settings pasted.');
    },
    previous: () => { if (!lastDone) return; s.work = { ...s.work, dev: clone(lastDone), preset: undefined }; closeMenus(); changedAll(); settle(); toast('Applied the settings from the last photo you finished.'); },
    preset: () => ask('Create preset', [{ id: 'name', label: 'Preset name', value: '' }, { id: 'group', label: 'Group', value: YOURS, list: [...new Set(mine.map(presetGroupOf))] }], ALL_BUT('crop', 'geometry', 'optics'), (v, gs) => {
      const dev = pick(clone(s.work.dev), new Set(gs));
      if (isNeutralDev(dev)) { toast('Nothing to save: the chosen settings are all at their defaults.'); return; }
      const group = v.group.trim() && v.group.trim() !== YOURS ? v.group.trim().slice(0, 60) : undefined;
      mine.push({ id: `u${Date.now().toString(36)}`, name: (v.name.trim() || `My preset ${mine.length + 1}`).slice(0, 80), ...(group ? { group } : {}), dev });
      saveMine(); s.group = group ?? YOURS; paint();
      toast(`Preset saved in "${group ?? YOURS}".`);
    }),
    reset: () => {
      s.work = { dev: {} }; closeMenus();
      if (cropper.isOpen()) cropper.reset(); else void syncGeometry();
      changedAll(); settle();
      toast('Reset to the original. Undo brings your edits back.');
    },
  };
  all<HTMLButtonElement>('[data-ed-menu]').forEach(b => { if (b.dataset.edMenu !== 'save') b.onclick = () => actions[b.dataset.edMenu!](); });

  // --- painting -----------------------------------------------------------------------------------------
  function paintMarks() {
    const mon = mono(s.work.dev);
    all('#bands [data-band]').forEach(d => {
      const b = d.dataset.band as Band;
      d.setAttribute('aria-pressed', String(b === s.band));
      d.classList.toggle('changed', (mon ? [`GrayMixer${b}`] : [`HueAdjustment${b}`, `SaturationAdjustment${b}`, `LuminanceAdjustment${b}`]).some(k => num(s.work.dev, k) !== SPEC[k].def));
    });
    all('#ranges [data-wheel]').forEach(b => {
      const w = b.dataset.wheel as Wheel;
      b.setAttribute('aria-pressed', String(w === s.wheel));
      b.classList.toggle('changed', num(s.work.dev, `ColorGrade${w}Sat`) > 0 || num(s.work.dev, `ColorGrade${w}Lum`) !== 0);
    });
    const any = (g: string) => changed(s.work.dev).some(k => groupOfKey(k) === g);
    all('[data-csub]').forEach(b => { b.setAttribute('aria-pressed', String(s.csub === b.dataset.csub)); b.classList.toggle('changed', any(b.dataset.csub === 'mix' ? (mon ? 'bw' : 'mix') : b.dataset.csub!)); });
    $('curve-btn').classList.toggle('changed', any('curve'));
  }
  function paint() {
    painters.forEach(f => f());
    paintMarks();
    const mon = mono(s.work.dev);
    $('ed-mono').setAttribute('aria-pressed', String(mon));
    all('[data-csub-panel]').forEach(p => { p.hidden = p.dataset.csubPanel !== s.csub; });
    $('mix-h').textContent = mon ? 'B&W Mix' : 'Color Mix';
    $('mix-sliders').hidden = mon; $('bands').hidden = mon; $('gray-sliders').hidden = !mon;
    $<HTMLSelectElement>('vig-style').value = String(num(s.work.dev, 'PostCropVignetteStyle'));
    $('curve-btn').setAttribute('aria-pressed', String(s.curveOpen));
    $('curve-box').hidden = !s.curveOpen;
    $('para-sliders').hidden = s.curve !== 'para';
    all('#curve-ch [data-ch]').forEach(b => { const k = b.dataset.ch!; b.setAttribute('aria-pressed', String(k === s.curve)); b.classList.toggle('changed', k === 'para' ? changed(s.work.dev).some(x => x.startsWith('Parametric')) : changed(s.work.dev).includes(k)); });
    const hueRow = $('grade-sliders').querySelector<HTMLElement>('.track-hue input');
    if (hueRow) hueRow.style.accentColor = `hsl(${num(s.work.dev, `ColorGrade${s.wheel}Hue`)} 80% 50%)`;
    paintPresets();
    paintUndo();
    drawCurve(); drawWheel();
  }

  let tab = 'light';
  const showTab = async (name: string) => {
    if (tab === 'crop' && name !== 'crop') await leaveCrop();
    tab = name;
    closeMenus();
    all('[data-ed-tab]').forEach(t => t.setAttribute('aria-pressed', String(t.dataset.edTab === name)));
    all('[data-ed-panel]').forEach(p => { p.hidden = p.dataset.edPanel !== name; });
    paint();
    if (name === 'light') setTimeout(drawHist, 30);
    if (name === 'crop' && s.img) await cropper.begin(s.img.orig?.src ?? s.img.getSrc(), s.work.crop);
  };
  all('[data-ed-tab]').forEach(t => { t.onclick = () => { void showTab(t.dataset.edTab!); }; });

  // --- open / close ---
  const open = (img: PhotoImage) => {
    c.discardActiveObject();
    c.skipTargetFind = true; c.selection = false;
    s.img = img;
    const m = migrateEdit(img.edit, allPresets());
    s.before = clone(m); s.work = clone(m) ?? { dev: {} };
    s.baked = clone(m?.crop); s.src0 = img.getSrc(); s.orig0 = clone(img.orig); s.center0 = img.getCenterPoint();
    past = []; future = []; settled = { dev: clone(s.work.dev), preset: clone(s.work.preset) };
    thumbs = {}; small = null; hist = null;
    if (s.work.preset) { const p = allPresets().find(x => x.id === s.work.preset!.id); if (p) s.group = presetGroupOf(p); }
    document.body.dataset.editing = '1';
    $('editor').hidden = false;
    tab = 'light';
    void showTab('light');
  };
  const close = () => {
    const img = s.img;
    s.img = null;
    closeMenus();
    delete document.body.dataset.editing;
    $('editor').hidden = true;
    c.skipTargetFind = false; c.selection = true;
    if (img) { c.setActiveObject(img); c.requestRenderAll(); }
  };
  const norm = (e?: PhotoEdit) => JSON.stringify(isEdited(e) ? { dev: e!.dev, crop: e!.crop ?? null } : null);

  $('ed-done').onclick = async () => {
    const img = s.img;
    if (!img) return;
    await leaveCrop();
    await syncGeometry();
    const dirty = norm(s.work) !== norm(s.before);
    const keep: PhotoEdit = { dev: clone(s.work.dev), ...(s.work.crop ? { crop: clone(s.work.crop) } : {}) };
    s.work = keep;
    if (isEdited(keep)) lastDone = clone(keep.dev);
    render(); close(); // render() stores the finished edit on the photo
    if (dirty) commit();
    onClose?.(img, true);
  };
  $('ed-cancel').onclick = async () => {
    const img = s.img;
    if (!img) return;
    cropper.end();
    if (JSON.stringify(s.baked ?? null) !== JSON.stringify(s.before?.crop ?? null)) {
      await setSrc(img, s.src0);
      img.orig = s.orig0;
      img.setPositionByOrigin(s.center0, 'center', 'center'); img.setCoords();
    }
    applyEdit(img, s.before); close();
    onClose?.(img, false);
  };

  // Hold to compare with the original.
  const cmp = $('ed-compare');
  const hold = (on: boolean) => {
    if (!s.img) return;
    if (on) { s.img.filters = []; s.img.applyFilters(); c.requestRenderAll(); } else render();
  };
  cmp.onpointerdown = e => { e.preventDefault(); hold(true); };
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => cmp.addEventListener(ev, () => hold(false)));
  cmp.oncontextmenu = e => e.preventDefault();
  window.addEventListener('resize', () => { drawCurve(); wheelImg = null; drawWheel(); });

  // --- copy / paste edits between photos in a design (all settings except the crop) ---
  const copyEdits = (img: PhotoImage) => {
    const m = migrateEdit(img.edit, allPresets());
    clip = m && !isNeutralDev(m.dev) ? { dev: clone(m.dev), groups: GROUPS.map(g => g.id).filter(g => g !== 'crop') } : null;
    toast(clip ? 'Edits copied. Select photos and tap Paste edits.' : 'That photo has no adjustments to copy.');
  };
  const pasteEdits = (imgs: PhotoImage[]) => {
    if (!clip) { toast('Copy edits from a photo first.'); return; }
    imgs.forEach(img => applyEdit(img, pasteInto(migrateEdit(img.edit, allPresets()) ?? { dev: {} }, clip!)));
    c.requestRenderAll(); commit();
    toast(imgs.length > 1 ? `Pasted onto ${imgs.length} photos` : 'Edits pasted');
  };

  return { open, copyEdits, pasteEdits, isOpen: () => !!s.img, work: () => clone(s.work) };
}

