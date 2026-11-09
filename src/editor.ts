// Photo edit mode, laid out like Lightroom mobile: Presets, Crop, Light (with the tone curve), Color (with the
// colour mixer and colour grading), Effects and Detail. Everything previews live and only sticks when you press Done.
// Lightroom presets (.xmp, .lrtemplate, .zip packs) import into "Presets", and your own looks export as .xmp.
import { fabric } from 'fabric';
import { scope } from './accounts';
import { readSecure, writeSecure } from './secure';
import { loadPresetList, savePresetList } from './library';
import { makeAdjustFilter } from './adjust';
import { initCropper, renderCropped } from './crop';
import { saveFile } from './download';
import { importPresetFiles, NOT_IN_LIGHTROOM, presetsZip } from './xmp';
import {
  ADJ, AdjKey, BANDS, BUILTIN, Band, Channel, PhotoEdit, PhotoStats, Preset, Pt, RANGES, Range,
  autoAdjust, cleanPreset, curveTable, effective, hasLook, isEdited, isNeutral, minOf,
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

// --- your presets (imported and saved), encrypted with the profile ------------------
const PKEY = () => scope('canva-lite:presets');
let mine: Preset[] = [];
// Presets live in the photo library's database. Older copies in localStorage move over once.
export const loadPresets = async () => {
  let v: unknown = await loadPresetList().catch(() => null);
  if (v === null) {
    v = await readSecure<unknown>(PKEY(), []);
    if (Array.isArray(v) && v.length && await savePresetList(v).catch(() => false)) { try { localStorage.removeItem(PKEY()); } catch { /* ignore */ } }
  }
  mine = Array.isArray(v) ? v.map(cleanPreset).filter((p): p is Preset => !!p) : [];
};
export const getPresets = () => mine;
export const addPresets = (l: unknown[]) => { for (const p of l.map(cleanPreset)) if (p && !mine.some(x => x.id === p.id)) mine.push(p); saveMine(); };
let saveFail: ((m: string) => void) | null = null;
const saveMine = () => {
  void savePresetList(mine).then(ok => { if (!ok) return writeSecure(PKEY(), mine); }).catch(() => saveFail?.('Could not save presets: storage is full or blocked.'));
};
export const setPresets = (l: Preset[]) => { mine = l; saveMine(); };
export const presetGroupOf = (p: Preset) => groupOf(p);
export { allPresets };
const allPresets = () => BUILTIN.concat(mine);
const BUILT_IN = 'Built-in', YOURS = 'Your presets';
const groupOf = (p: Preset) => (BUILTIN.includes(p) ? BUILT_IN : p.group || YOURS);

export const applyEdit = (img: PhotoImage, e: PhotoEdit | undefined) => {
  const p = effective(e, allPresets());
  img.filters = isNeutral(p) ? [] : [makeAdjustFilter(p)];
  img.applyFilters();
};

// The photo as loaded, without slider filters, drawn small: used for preset previews, the histogram and auto-enhance.
const smallOf = (img: fabric.Image, side: number) => {
  const src = ((img as unknown as { _originalElement?: CanvasImageSource })._originalElement ?? img.getElement()) as HTMLImageElement | HTMLCanvasElement;
  const w = (src as HTMLImageElement).naturalWidth || src.width, h = (src as HTMLImageElement).naturalHeight || src.height;
  const cv = Object.assign(document.createElement('canvas'), { width: side, height: side });
  const k = Math.max(side / w, side / h); // cover-crop to a square
  cv.getContext('2d')!.drawImage(src, (side - w * k) / 2, (side - h * k) / 2, w * k, h * k);
  return cv;
};
const histOf = (img: fabric.Image) => {
  const d = smallOf(img, 96).getContext('2d')!.getImageData(0, 0, 96, 96).data;
  const h = { rgb: new Array<number>(64).fill(0), r: new Array<number>(64).fill(0), g: new Array<number>(64).fill(0), b: new Array<number>(64).fill(0) };
  for (let i = 0; i < d.length; i += 4) {
    h.r[d[i] >> 2]++; h.g[d[i + 1] >> 2]++; h.b[d[i + 2] >> 2]++;
    h.rgb[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) >> 2]++;
  }
  return h as Record<Channel, number[]>;
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
  return { mean: sum / n / 255, p5: pct(0.05), p95: pct(0.95), sat: sat / n };
};

const setSrc = (img: fabric.Image, url: string) => new Promise<void>(res => { img.setSrc(url, () => res()); });
const BAND_COLOR: Record<Band, string> = { red: '#e5372f', orange: '#f08a24', yellow: '#f2cf1d', green: '#3fae49', aqua: '#2bb5b8', blue: '#2f6fe0', purple: '#7d46d6', magenta: '#d63aa8' };
const RANGE_LABEL: Record<Range, string> = { shadows: 'Shadows', midtones: 'Midtones', highlights: 'Highlights', global: 'Global' };
const CH_COLOR: Record<Channel, string> = { rgb: '', r: '#e5372f', g: '#3fae49', b: '#2f6fe0' };

export function initEditor({ c, commit, toast, pageRatio, onGeometry, onClose }: Deps) {
  saveFail = toast;
  const s = {
    img: null as PhotoImage | null, before: undefined as PhotoEdit | undefined, work: { adj: {} } as PhotoEdit,
    baked: undefined as PhotoEdit['crop'], // crop currently applied to the pixels on canvas
    src0: '', orig0: undefined as PhotoImage['orig'], center0: new fabric.Point(0, 0), // state at open, for Cancel
    band: 'red' as Band, range: 'shadows' as Range, ch: 'rgb' as Channel, group: BUILT_IN, curveOpen: false,
  };
  const cropper = initCropper(pageRatio);
  let clip: PhotoEdit | undefined;
  let raf = 0;
  let hist: Record<Channel, number[]> | null = null;

  // Make the pixels on canvas match work.crop. The original is kept so a crop can be redone or removed.
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
    hist = null; thumbs = {};
    render();
  };
  const leaveCrop = async () => {
    if (!cropper.isOpen()) return;
    s.work.crop = cropper.read();
    cropper.end();
    await syncGeometry();
  };

  const render = () => { if (s.img) { applyEdit(s.img, s.work); c.requestRenderAll(); } };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };
  const changed = () => { paint(); schedule(); };

  // --- sliders -----------------------------------------------------------------
  // Each slider reads and writes the working edit through get/set; paint() refreshes them all.
  const painters: (() => void)[] = [];
  const slider = (label: string, min: number, max: number, get: () => number, set: (v: number) => void, def = 0, cls = '') => {
    const row = el('div', { className: `slide ${cls}` });
    const name = el('span', { className: 'slide-name', textContent: label, title: 'Double-tap to reset' });
    const input = el('input', { type: 'range', min: String(min), max: String(max), step: '1' });
    input.setAttribute('aria-label', label);
    const out = el('output');
    input.oninput = () => { set(Number(input.value)); out.textContent = String(Math.round(get())); row.classList.toggle('changed', get() !== def); schedule(); paintMarks(); };
    const reset = () => { set(def); changed(); };
    name.ondblclick = reset; input.ondblclick = reset;
    row.append(name, input, out);
    painters.push(() => { const v = get(); input.value = String(v); out.textContent = String(Math.round(v)); row.classList.toggle('changed', v !== def); });
    return row;
  };
  const adjSlider = (k: AdjKey, label: string) => slider(label, minOf(k), 100, () => s.work.adj[k] ?? 0, v => { if (v) s.work.adj[k] = v; else delete s.work.adj[k]; });
  for (const panel of ['light', 'color', 'effects', 'detail']) {
    document.querySelector(`[data-sliders="${panel}"]`)!.replaceChildren(...ADJ.filter(a => a.panel === panel).map(a => adjSlider(a.key, a.label)));
  }

  // Colour mixer: pick a band, then hue, saturation and luminance for it.
  const hslGet = (i: number) => () => s.work.hsl?.[s.band]?.[i] ?? 0;
  const hslSet = (i: number) => (v: number) => {
    const h = (s.work.hsl ??= {});
    const t = (h[s.band] ??= [0, 0, 0]);
    t[i] = v;
    if (t.every(x => x === 0)) delete h[s.band];
    if (!Object.keys(h).length) delete s.work.hsl;
  };
  $('bands').replaceChildren(...BANDS.map(b => {
    const d = document.createElement('button');
    d.title = b[0].toUpperCase() + b.slice(1);
    d.style.background = BAND_COLOR[b]; d.dataset.band = b;
    d.setAttribute('aria-label', `${d.title} colors`);
    d.onclick = () => { s.band = b; paint(); };
    return d;
  }));
  $('mix-sliders').replaceChildren(slider('Hue', -100, 100, hslGet(0), hslSet(0)), slider('Saturation', -100, 100, hslGet(1), hslSet(1)), slider('Luminance', -100, 100, hslGet(2), hslSet(2)));

  // Colour grading: pick shadows, midtones, highlights or global; then hue, saturation, luminance.
  const tone = () => s.work.grade?.[s.range] ?? { h: 0, s: 0, l: 0 };
  const toneSet = (k: 'h' | 's' | 'l') => (v: number) => {
    const g = (s.work.grade ??= {});
    g[s.range] = { ...tone(), [k]: v };
    const t = g[s.range]!;
    if (!t.s && !t.l && !t.h) delete g[s.range];
    if (!RANGES.some(r => g[r])) delete s.work.grade;
  };
  const gopt = (k: 'blending' | 'balance', def: number) => slider(k === 'blending' ? 'Blending' : 'Balance', k === 'blending' ? 0 : -100, 100,
    () => s.work.grade?.[k] ?? def, v => { if (s.work.grade) s.work.grade[k] = v; }, def);
  $('ranges').replaceChildren(...RANGES.map(r => {
    const b = el('button', { className: 'chip', textContent: RANGE_LABEL[r] });
    b.dataset.range = r;
    b.onclick = () => { s.range = r; paint(); };
    return b;
  }));
  $('grade-sliders').replaceChildren(
    slider('Hue', 0, 360, () => tone().h, toneSet('h'), 0, 'hue'),
    slider('Saturation', 0, 100, () => tone().s, toneSet('s')),
    slider('Luminance', -100, 100, () => tone().l, toneSet('l')),
    gopt('blending', 50), gopt('balance', 0),
  );

  $('ed-mono').onclick = () => { if (s.work.mono) delete s.work.mono; else s.work.mono = true; changed(); };
  $('ed-auto').onclick = () => {
    if (!s.img) return;
    s.work.adj = { ...s.work.adj, ...autoAdjust(statsOf(s.img)) };
    changed();
    toast('Auto applied. Tweak any slider, or Revert.');
  };

  // --- tone curve ------------------------------------------------------------------
  const cv = $<HTMLCanvasElement>('curve');
  const pts = (): Pt[] => s.work.curve?.[s.ch] ?? [[0, 0], [255, 255]];
  const setPts = (p: Pt[]) => {
    const cu = (s.work.curve ??= {});
    if (p.length === 2 && p[0][0] === 0 && p[0][1] === 0 && p[1][0] === 255 && p[1][1] === 255) delete cu[s.ch]; else cu[s.ch] = p;
    if (!Object.keys(cu).length) delete s.work.curve;
  };
  const drawCurve = () => {
    if (!s.curveOpen) return;
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(r.width * dpr));
    if (cv.width !== W) { cv.width = W; cv.height = W; }
    const g = cv.getContext('2d')!, k = W / 255, css = getComputedStyle(document.body);
    const ink = css.getPropertyValue('--ink').trim() || '#000', muted = css.getPropertyValue('--muted').trim() || '#888';
    g.clearRect(0, 0, W, W);
    if (hist) { // histogram behind the curve
      const h = hist[s.ch], mx = Math.max(...h.slice(1, 63), 1);
      g.fillStyle = muted; g.globalAlpha = 0.22; g.beginPath(); g.moveTo(0, W);
      h.forEach((v, i) => g.lineTo((i + 0.5) * W / 64, W - Math.min(1, v / mx) * W * 0.9));
      g.lineTo(W, W); g.fill(); g.globalAlpha = 1;
    }
    g.strokeStyle = muted; g.globalAlpha = 0.35; g.lineWidth = dpr;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(i * W / 4, 0); g.lineTo(i * W / 4, W); g.moveTo(0, i * W / 4); g.lineTo(W, i * W / 4); g.stroke(); }
    g.beginPath(); g.moveTo(0, W); g.lineTo(W, 0); g.stroke(); g.globalAlpha = 1;
    const t = curveTable(pts());
    g.strokeStyle = CH_COLOR[s.ch] || ink; g.lineWidth = 2 * dpr; g.beginPath();
    for (let x = 0; x < 256; x++) { const X = x * k, Y = W - t[x] * k; if (x) g.lineTo(X, Y); else g.moveTo(X, Y); }
    g.stroke();
    for (const [x, y] of pts()) { g.beginPath(); g.arc(x * k, W - y * k, 6 * dpr, 0, Math.PI * 2); g.fillStyle = css.getPropertyValue('--surface').trim() || '#fff'; g.fill(); g.stroke(); }
  };
  const toCurve = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 255, (1 - (e.clientY - r.top) / r.height) * 255, r.width] as const; };
  let drag = -1, lastTap = 0;
  cv.onpointerdown = e => {
    const [x, y, w] = toCurve(e), p = pts().map(q => [...q] as Pt), hit = 22 * 255 / w;
    let i = p.findIndex(q => Math.hypot(q[0] - x, q[1] - y) < hit);
    if (i > 0 && i < p.length - 1 && Date.now() - lastTap < 300) { p.splice(i, 1); setPts(p); lastTap = 0; changed(); return; } // double-tap removes
    lastTap = Date.now();
    if (i < 0) {
      if (p.length >= 16) return;
      const nx = Math.round(Math.min(254, Math.max(1, x)));
      if (p.some(q => Math.abs(q[0] - nx) < 4)) return;
      p.push([nx, Math.round(curveTable(p)[nx])]); p.sort((a, b) => a[0] - b[0]);
      i = p.findIndex(q => q[0] === nx);
      setPts(p);
    }
    drag = i; cv.setPointerCapture(e.pointerId); changed();
  };
  cv.onpointermove = e => {
    if (drag < 0) return;
    const [x, y] = toCurve(e), p = pts().map(q => [...q] as Pt), last = p.length - 1;
    const off = x < -30 || x > 285 || y < -30 || y > 285;
    if (off && drag > 0 && drag < last) { p.splice(drag, 1); drag = -1; setPts(p); changed(); return; } // dragged off: remove
    const lo = drag === 0 ? 0 : p[drag - 1][0] + 3, hi = drag === last ? 255 : p[drag + 1][0] - 3;
    p[drag] = [Math.round(drag === 0 ? Math.min(x, p[1][0] - 3) : drag === last ? Math.max(x, p[last - 1][0] + 3) : Math.min(hi, Math.max(lo, x))), Math.round(Math.min(255, Math.max(0, y)))];
    p[drag][0] = Math.min(255, Math.max(0, p[drag][0]));
    setPts(p); changed();
  };
  cv.onpointerup = cv.onpointercancel = () => { drag = -1; };
  all<HTMLButtonElement>('#curve-ch [data-ch]').forEach(b => { b.onclick = () => { s.ch = b.dataset.ch as Channel; paint(); }; });
  $('curve-reset').onclick = () => { setPts([[0, 0], [255, 255]]); changed(); };
  $('curve-btn').onclick = () => { s.curveOpen = !s.curveOpen; if (s.curveOpen && s.img && !hist) hist = histOf(s.img); paint(); };

  // --- presets -----------------------------------------------------------------------
  let thumbs: Record<string, string> = {};
  const shotOf = (id: string) => {
    if (thumbs[id] !== undefined || !s.img) return thumbs[id];
    try {
      const f = new fabric.Image(smallOf(s.img, 88));
      const p = effective(id === 'none' ? undefined : { adj: {}, filter: { id, amount: 100 } }, allPresets());
      f.filters = isNeutral(p) ? [] : [makeAdjustFilter(p)];
      f.applyFilters();
      const out = Object.assign(document.createElement('canvas'), { width: 88, height: 88 });
      out.getContext('2d')!.drawImage(f.getElement() as CanvasImageSource, 0, 0, 88, 88);
      thumbs[id] = out.toDataURL('image/jpeg', 0.7);
    } catch { thumbs[id] = ''; } // previews are a nicety; fall back to plain chips
    return thumbs[id];
  };
  const thumbChip = (label: string, id: string, on: boolean, run: () => void) => {
    const b = el('button', { className: 'chip', onclick: run });
    b.setAttribute('aria-pressed', String(on));
    const src = shotOf(id);
    if (src) { b.classList.add('th'); b.append(el('img', { src, alt: '' })); }
    b.append(label);
    return b;
  };
  const pick = (id: string | undefined) => {
    if (id) s.work.filter = { id, amount: s.work.filter?.amount ?? 100 }; else delete s.work.filter;
    changed();
  };
  const amount = $<HTMLInputElement>('amt-range');
  amount.oninput = () => { if (s.work.filter) s.work.filter.amount = Number(amount.value); $('amt-val').textContent = amount.value; schedule(); };
  amount.ondblclick = () => { if (s.work.filter) s.work.filter.amount = 100; changed(); };
  const groups = () => [...new Set(allPresets().map(groupOf))];
  const gsel = $<HTMLSelectElement>('pgroup');
  gsel.onchange = () => { s.group = gsel.value; paint(); };

  const paintPresets = () => {
    const gs = groups();
    if (!gs.includes(s.group)) s.group = BUILT_IN;
    gsel.replaceChildren(...gs.map(g => el('option', { value: g, textContent: `${g} (${allPresets().filter(p => groupOf(p) === g).length})`, selected: g === s.group })));
    const fl = $('filters'), keep = fl.scrollLeft;
    if (tab === 'presets') fl.replaceChildren(
      thumbChip('None', 'none', !s.work.filter, () => pick(undefined)),
      ...allPresets().filter(p => groupOf(p) === s.group).map(p => thumbChip(p.name, p.id, s.work.filter?.id === p.id, () => pick(s.work.filter?.id === p.id ? undefined : p.id))),
    );
    fl.scrollLeft = keep;
    $('amount').hidden = !s.work.filter;
    amount.value = String(s.work.filter?.amount ?? 100);
    $('amt-val').textContent = String(s.work.filter?.amount ?? 100);
    if (!$('pmanage').hidden) paintMine();
  };
  const paintMine = () => {
    const rows = mine.map(p => {
      const row = el('div', { className: 'prow' });
      const name = el('input', { value: p.name });
      name.setAttribute('aria-label', 'Preset name');
      name.onchange = () => { p.name = name.value.trim().slice(0, 80) || p.name; delete thumbs[p.id]; saveMine(); paint(); };
      const exp = el('button', { className: 'tool', textContent: 'Export', onclick: () => void exportPresets([p], p.name) });
      const del = el('button', { className: 'tool', textContent: 'Delete' });
      del.setAttribute('aria-label', `Delete ${p.name}`);
      del.onclick = () => { mine = mine.filter(x => x.id !== p.id); if (s.work.filter?.id === p.id) delete s.work.filter; saveMine(); changed(); };
      row.append(name, exp, del);
      return row;
    });
    $('mine').replaceChildren(...(rows.length ? rows : [el('p', { className: 'muted', textContent: 'No presets of your own yet. Import Lightroom presets, or adjust a photo and save the look.' })]));
    $('pexport-all').hidden = !mine.length;
  };
  $('pmanage-btn').onclick = () => {
    const open = $('pmanage').hidden;
    $('pmanage').hidden = !open; $('pmanage-btn').setAttribute('aria-expanded', String(open));
    paint();
  };

  const exportPresets = async (list: Preset[], name: string) => {
    if (!list.length) return;
    const lossy = list.some(p => NOT_IN_LIGHTROOM.some(k => p.adj[k]));
    const r = await saveFile(`${name.replace(/[^\w\- ]+/g, '').trim() || 'presets'}.zip`, new Blob([presetsZip(list) as BlobPart], { type: 'application/zip' }));
    if (r === 'unavailable') toast('Saving files is not available here.');
    else if (r === 'saved') toast(lossy ? 'Saved. Brilliance, Brightness and Black Point have no Lightroom slider; Lightroom ignores them, SimplyCanva keeps them.' : 'Saved. In Lightroom: Presets, ⋯, Import presets, then pick the .zip.');
  };
  $('pexport-all').onclick = () => void exportPresets(mine, 'SimplyCanva presets');

  $<HTMLInputElement>('pimport').onchange = async e => {
    const input = e.target as HTMLInputElement, files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    const r = await importPresetFiles(files);
    if (!r.presets.length) { toast(r.failed.length ? 'No Lightroom presets found in that file.' : 'Nothing to import.'); return; }
    for (const p of r.presets) { // same name in the same group replaces the old copy
      const i = mine.findIndex(x => x.name === p.name && (x.group ?? '') === (p.group ?? ''));
      if (i >= 0) { if (s.work.filter?.id === mine[i].id) s.work.filter.id = p.id; mine[i] = p; } else mine.push(p);
    }
    saveMine();
    s.group = groupOf(r.presets[0]);
    if (s.img) s.work.filter = { id: r.presets[0].id, amount: 100 };
    changed();
    const extra = r.skipped.length ? ` Not supported, so left out: ${r.skipped.join(', ')}.` : '';
    toast(`Imported ${r.presets.length} preset${r.presets.length === 1 ? '' : 's'}${r.failed.length ? ` (${r.failed.length} file${r.failed.length === 1 ? '' : 's'} unreadable)` : ''}.${extra}`);
  };

  // Save the current look (sliders, curve, mixer, grading, plus any preset) as one preset of your own.
  $('save-preset').onclick = () => {
    const input = $<HTMLInputElement>('preset-name');
    if (!hasLook(s.work) && !s.work.filter) { toast('Adjust the photo first, then save the look.'); return; }
    const p = flatten(s.work);
    if (!hasLook(p)) { toast('Adjust the photo first, then save the look.'); return; }
    const name = input.value.trim() || `My look ${mine.length + 1}`;
    mine.push({ ...p, id: `u${Date.now().toString(36)}`, name: name.slice(0, 80) });
    input.value = ''; saveMine();
    s.group = YOURS; paint();
    toast('Look saved under "Your presets".');
  };
  // Bake the chosen preset (at its amount) into the edit, so a saved look stands alone.
  const flatten = (e: PhotoEdit) => {
    const pre = e.filter ? allPresets().find(p => p.id === e.filter!.id) : undefined;
    const k = e.filter ? e.filter.amount / 100 : 0;
    const p = effective(e, allPresets());
    const adj = Object.fromEntries(ADJ.map(a => [a.key, p[a.key]]).filter(([, v]) => v !== 0));
    const hsl = p.hsl ? Object.fromEntries(BANDS.map((b, i) => [b, p.hsl!.slice(i * 3, i * 3 + 3)]).filter(([, v]) => (v as number[]).some(x => x))) : undefined;
    const curve = e.curve ?? (pre?.curve && k === 1 ? pre.curve : undefined); // shortcut: a partly-faded preset curve is not baked in
    const grade = p.grade ? { ...Object.fromEntries(RANGES.map((r, i) => [r, { h: p.grade![i * 3], s: p.grade![i * 3 + 1], l: p.grade![i * 3 + 2] }]).filter(([, t]) => (t as { s: number; l: number }).s || (t as { s: number; l: number }).l)), blending: p.grade[12], balance: p.grade[13] } : undefined;
    return { adj, ...(hsl ? { hsl } : {}), ...(curve ? { curve } : {}), ...(grade ? { grade } : {}), ...((p.mono ?? 0) >= 0.5 ? { mono: true } : {}) } as PhotoEdit;
  };

  // --- painting ---------------------------------------------------------------------------
  // Changed markers only (cheap, runs while a slider moves).
  function paintMarks() {
    all('#bands [data-band]').forEach(d => {
      d.setAttribute('aria-pressed', String(d.dataset.band === s.band));
      d.classList.toggle('changed', !!s.work.hsl?.[d.dataset.band as Band]);
    });
    all('#ranges [data-range]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.range === s.range));
      b.classList.toggle('changed', !!s.work.grade?.[b.dataset.range as Range]);
    });
    $('ed-revert').toggleAttribute('disabled', !isEdited(s.work) && tab !== 'crop');
  }
  function paint() {
    painters.forEach(f => f());
    paintMarks();
    $('ed-mono').setAttribute('aria-pressed', String(!!s.work.mono));
    $('curve-btn').setAttribute('aria-pressed', String(s.curveOpen));
    $('curve-btn').classList.toggle('changed', !!s.work.curve);
    $('curve-box').hidden = !s.curveOpen;
    all('#curve-ch [data-ch]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.ch === s.ch)); b.classList.toggle('changed', !!s.work.curve?.[b.dataset.ch as Channel]); });
    const grip = $('grade-sliders').querySelector<HTMLElement>('.hue input');
    if (grip) grip.style.accentColor = `hsl(${tone().h} 80% 50%)`;
    paintPresets();
    drawCurve();
  }

  let tab = 'light';
  const showTab = async (name: string) => {
    if (tab === 'crop' && name !== 'crop') await leaveCrop();
    tab = name;
    all('[data-ed-tab]').forEach(t => t.setAttribute('aria-pressed', String(t.dataset.edTab === name)));
    all('[data-ed-panel]').forEach(p => { p.hidden = p.dataset.edPanel !== name; });
    paint();
    if (name === 'crop' && s.img) await cropper.begin(s.img.orig?.src ?? s.img.getSrc(), s.work.crop);
  };
  all('[data-ed-tab]').forEach(t => { t.onclick = () => { void showTab(t.dataset.edTab!); }; });

  // --- open / close ---
  const open = (img: PhotoImage) => {
    c.discardActiveObject();
    c.skipTargetFind = true; c.selection = false;
    s.img = img; s.before = clone(img.edit); s.work = clone(img.edit) ?? { adj: {} };
    s.baked = clone(img.edit?.crop); s.src0 = img.getSrc(); s.orig0 = clone(img.orig); s.center0 = img.getCenterPoint();
    thumbs = {}; hist = s.curveOpen ? histOf(img) : null;
    if (s.work.filter) { const p = allPresets().find(x => x.id === s.work.filter!.id); if (p) s.group = groupOf(p); }
    document.body.dataset.editing = '1';
    $('editor').hidden = false;
    tab = 'light';
    void showTab('light');
  };
  const close = () => {
    const img = s.img;
    s.img = null;
    delete document.body.dataset.editing;
    $('editor').hidden = true;
    c.skipTargetFind = false; c.selection = true;
    if (img) { c.setActiveObject(img); c.requestRenderAll(); }
  };
  const norm = (e?: PhotoEdit) => JSON.stringify(isEdited(e) ? e : null);

  $('ed-done').onclick = async () => {
    const img = s.img;
    if (!img) return;
    await leaveCrop();
    await syncGeometry();
    const dirty = norm(s.work) !== norm(s.before);
    img.edit = isEdited(s.work) ? clone(s.work) : undefined;
    render(); close();
    if (dirty) commit();
    onClose?.(img, true);
  };
  $('ed-cancel').onclick = async () => {
    const img = s.img;
    if (!img) return;
    cropper.end();
    if (JSON.stringify(s.baked ?? null) !== JSON.stringify(s.before?.crop ?? null)) { // undo a crop applied during this session
      await setSrc(img, s.src0);
      img.orig = s.orig0;
      img.setPositionByOrigin(s.center0, 'center', 'center'); img.setCoords();
    }
    applyEdit(img, s.before); close();
    onClose?.(img, false);
  };
  $('ed-revert').onclick = () => {
    s.work = { adj: {} };
    if (cropper.isOpen()) cropper.reset(); else void syncGeometry();
    changed();
    toast('Back to the original. Press Done to keep it, or Cancel.');
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
  window.addEventListener('resize', () => drawCurve());

  // --- copy / paste edits between photos ---
  // Everything but the crop travels between photos; a crop belongs to its own photo.
  const copyEdits = (img: PhotoImage) => {
    clip = { ...clone(img.edit), adj: clone(img.edit?.adj) ?? {}, crop: undefined };
    toast(isEdited(clip) ? 'Edits copied. Select photos and tap Paste edits.' : 'That photo has no adjustments to copy.');
  };
  const pasteEdits = (imgs: PhotoImage[]) => {
    if (!clip) { toast('Copy edits from a photo first.'); return; }
    imgs.forEach(img => {
      const next: PhotoEdit = { ...clone(clip!), crop: img.edit?.crop };
      img.edit = isEdited(next) ? next : undefined;
      applyEdit(img, img.edit);
    });
    c.requestRenderAll(); commit();
    toast(imgs.length > 1 ? `Pasted onto ${imgs.length} photos` : 'Edits pasted');
  };

  return { open, copyEdits, pasteEdits, isOpen: () => !!s.img, work: () => clone(s.work) };
}

