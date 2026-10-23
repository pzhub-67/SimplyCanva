// Crop, rotate, flip and straighten. A canvas overlay shows the photo with a draggable crop frame;
// `renderCropped` produces the final pixels from the original.
import { CropParams, Op, Rect, applyOpToRect, fitRect, inside, isIdentity, maxRect, pushOp } from './cropMath';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const mk = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) });

export const loadImg = async (src: string) => {
  const im = new Image();
  im.src = src;
  await im.decode();
  return im;
};

// Apply flips and quarter turns to the original, in order.
const orient = (im: HTMLImageElement, ops: string) => {
  let cv = mk(im.naturalWidth, im.naturalHeight);
  cv.getContext('2d')!.drawImage(im, 0, 0);
  for (const op of ops as Iterable<Op>) {
    const { width: w, height: h } = cv;
    const out = op === 'r' ? mk(h, w) : mk(w, h);
    const x = out.getContext('2d')!;
    if (op === 'r') { x.translate(out.width / 2, out.height / 2); x.rotate(Math.PI / 2); x.drawImage(cv, -w / 2, -h / 2); }
    else if (op === 'h') { x.translate(w, 0); x.scale(-1, 1); x.drawImage(cv, 0, 0); }
    else { x.translate(0, h); x.scale(1, -1); x.drawImage(cv, 0, 0); }
    cv = out;
  }
  return cv;
};

// Final pixels: the crop rect cut from the straightened, oriented original.
export const renderCropped = async (originalSrc: string, p: CropParams) => {
  const im = await loadImg(originalSrc);
  const A = orient(im, p.ops);
  const out = mk(p.rect.w, p.rect.h);
  const x = out.getContext('2d')!;
  x.translate(-p.rect.x, -p.rect.y);
  x.translate(A.width / 2, A.height / 2);
  x.rotate((p.deg * Math.PI) / 180);
  x.drawImage(A, -A.width / 2, -A.height / 2);
  return out.toDataURL(originalSrc.startsWith('data:image/png') ? 'image/png' : 'image/jpeg', 0.9);
};

interface State { ops: string; deg: number; rect: Rect; ratio: number | null }
type Drag = { kind: 'move' | number; start: { x: number; y: number }; rect: Rect };

export function initCropper(pageRatio: () => number) {
  const overlay = $('crop');
  const cv = $<HTMLCanvasElement>('crop-cv');
  const slider = $<HTMLInputElement>('crop-deg');
  let im: HTMLImageElement | null = null;
  let A = mk(1, 1);
  let st: State = { ops: '', deg: 0, rect: { x: 0, y: 0, w: 1, h: 1 }, ratio: null };
  let view = { k: 1, ox: 0, oy: 0, w: 0, h: 0 };
  let drag: Drag | null = null;
  let raf = 0;

  const RATIOS: { label: string; value: () => number | null }[] = [
    { label: 'Free', value: () => null },
    { label: 'Original', value: () => A.width / A.height },
    { label: 'Page', value: pageRatio },
    { label: '1:1', value: () => 1 },
    { label: '4:5', value: () => 4 / 5 },
    { label: '3:4', value: () => 3 / 4 },
    { label: '16:9', value: () => 16 / 9 },
    { label: '9:16', value: () => 9 / 16 },
  ];

  const full = (): Rect => ({ x: 0, y: 0, w: A.width, h: A.height });
  const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };

  // --- controls ---
  const chipRow = $('ratios');
  const paintControls = () => {
    chipRow.replaceChildren(...RATIOS.map(r => {
      const v = r.value();
      const b = document.createElement('button');
      b.className = 'chip'; b.textContent = r.label;
      const on = st.ratio === null ? v === null : v !== null && Math.abs(v - st.ratio) < 1e-3;
      b.setAttribute('aria-pressed', String(on));
      b.onclick = () => {
        st.ratio = v;
        if (v !== null) st.rect = maxRect(v, st.deg, A.width, A.height);
        paintControls(); redraw();
      };
      return b;
    }));
    slider.value = String(st.deg);
    $('crop-deg-val').textContent = `${st.deg.toFixed(1).replace(/\.0$/, '')}°`;
  };
  const op = (o: Op) => {
    const next = applyOpToRect(st.rect, st.deg, o, A.width, A.height);
    st.ops = pushOp(st.ops, o); st.rect = next.rect; st.deg = next.deg;
    if (o === 'r' && st.ratio) st.ratio = 1 / st.ratio;
    A = orient(im!, st.ops);
    st.rect = fitRect(st.rect, st.deg, A.width, A.height);
    paintControls(); redraw();
  };
  const reset = () => {
    if (!im) return;
    st = { ops: '', deg: 0, rect: { x: 0, y: 0, w: im.naturalWidth, h: im.naturalHeight }, ratio: null };
    A = orient(im, '');
    paintControls(); redraw();
  };
  $('crop-rot').onclick = () => op('r');
  $('crop-fh').onclick = () => op('h');
  $('crop-fv').onclick = () => op('v');
  $('crop-reset').onclick = reset;
  slider.oninput = () => {
    st.deg = Number(slider.value);
    st.rect = fitRect(st.rect, st.deg, A.width, A.height);
    $('crop-deg-val').textContent = `${st.deg.toFixed(1).replace(/\.0$/, '')}°`;
    redraw();
  };
  slider.ondblclick = () => { slider.value = '0'; slider.oninput!(new Event('input')); };

  // --- drawing ---
  const layout = () => {
    const dpr = window.devicePixelRatio || 1;
    view.w = overlay.clientWidth; view.h = overlay.clientHeight;
    cv.width = Math.round(view.w * dpr); cv.height = Math.round(view.h * dpr);
    const pad = 20;
    view.k = Math.min((view.w - pad * 2) / A.width, (view.h - pad * 2) / A.height);
    view.ox = (view.w - A.width * view.k) / 2; view.oy = (view.h - A.height * view.k) / 2;
  };
  const draw = () => {
    if (!im || overlay.hidden) return;
    const dpr = window.devicePixelRatio || 1;
    const x = cv.getContext('2d')!;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, view.w, view.h);
    const { k, ox, oy } = view;
    // photo, rotated about the frame center and clipped to the frame
    x.save();
    x.translate(ox, oy); x.scale(k, k);
    x.beginPath(); x.rect(0, 0, A.width, A.height); x.clip();
    x.translate(A.width / 2, A.height / 2); x.rotate((st.deg * Math.PI) / 180);
    x.drawImage(A, -A.width / 2, -A.height / 2);
    x.restore();
    // dim everything outside the crop rect
    const r = { x: ox + st.rect.x * k, y: oy + st.rect.y * k, w: st.rect.w * k, h: st.rect.h * k };
    x.fillStyle = 'rgba(0,0,0,0.55)';
    x.beginPath(); x.rect(ox, oy, A.width * k, A.height * k); x.rect(r.x, r.y, r.w, r.h); x.fill('evenodd');
    // frame and thirds
    x.strokeStyle = '#fff'; x.lineWidth = 2; x.strokeRect(r.x, r.y, r.w, r.h);
    x.lineWidth = 1; x.strokeStyle = 'rgba(255,255,255,0.45)';
    x.beginPath();
    for (let i = 1; i < 3; i++) {
      x.moveTo(r.x + (r.w * i) / 3, r.y); x.lineTo(r.x + (r.w * i) / 3, r.y + r.h);
      x.moveTo(r.x, r.y + (r.h * i) / 3); x.lineTo(r.x + r.w, r.y + (r.h * i) / 3);
    }
    x.stroke();
    // corner handles
    x.fillStyle = '#fff'; x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 1;
    for (const [hx, hy] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) {
      x.beginPath(); x.arc(hx, hy, 9, 0, Math.PI * 2); x.fill(); x.stroke();
    }
  };

  // --- pointer: move the frame or drag a corner ---
  const toA = (e: PointerEvent) => {
    const b = cv.getBoundingClientRect();
    return { x: (e.clientX - b.left - view.ox) / view.k, y: (e.clientY - b.top - view.oy) / view.k };
  };
  const corners = (r: Rect) => [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]];
  const valid = (r: Rect) => r.w >= 24 && r.h >= 24 && inside(r, st.deg, A.width, A.height);

  cv.onpointerdown = e => {
    if (!im) return;
    const p = toA(e);
    const hit = corners(st.rect).findIndex(([cx, cy]) => Math.hypot(cx - p.x, cy - p.y) * view.k < 30);
    const r = st.rect;
    const inRect = p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    if (hit >= 0) drag = { kind: hit, start: p, rect: { ...r } };
    else if (inRect) drag = { kind: 'move', start: p, rect: { ...r } };
    if (drag) cv.setPointerCapture(e.pointerId);
  };
  cv.onpointermove = e => {
    if (!drag) return;
    const p = toA(e);
    const d0 = drag.rect;
    if (drag.kind === 'move') {
      const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
      const tries: Rect[] = [{ ...d0, x: d0.x + dx, y: d0.y + dy }, { ...d0, x: d0.x + dx }, { ...d0, y: d0.y + dy }];
      const ok = tries.find(valid);
      if (ok) st.rect = ok;
    } else {
      const i = drag.kind;
      const sx = i % 2 === 0 ? -1 : 1, sy = i < 2 ? -1 : 1; // which way the dragged corner points from its anchor
      const ax = sx > 0 ? d0.x : d0.x + d0.w, ay = sy > 0 ? d0.y : d0.y + d0.h;
      let w = Math.max(24, (p.x - ax) * sx), h = Math.max(24, (p.y - ay) * sy);
      if (st.ratio) { w = Math.max(w, h * st.ratio); h = w / st.ratio; }
      const make = (f: number): Rect => ({ x: sx > 0 ? ax : ax - w * f, y: sy > 0 ? ay : ay - h * f, w: w * f, h: h * f });
      if (valid(make(1))) st.rect = make(1);
      else { // slide back along the drag until it fits
        let lo = 0, hi = 1;
        for (let n = 0; n < 24; n++) { const mid = (lo + hi) / 2; if (valid(make(mid))) lo = mid; else hi = mid; }
        if (valid(make(lo))) st.rect = make(lo);
      }
    }
    redraw();
  };
  cv.onpointerup = cv.onpointercancel = () => { drag = null; };

  new ResizeObserver(() => { if (!overlay.hidden) { layout(); redraw(); } }).observe(overlay);

  return {
    async begin(src: string, params?: CropParams) {
      im = await loadImg(src);
      st = params
        ? { ops: params.ops, deg: params.deg, rect: { ...params.rect }, ratio: params.ratio }
        : { ops: '', deg: 0, rect: { x: 0, y: 0, w: im.naturalWidth, h: im.naturalHeight }, ratio: null };
      A = orient(im, st.ops);
      overlay.hidden = false;
      layout(); paintControls(); redraw();
    },
    // Current frame as saved params, or undefined when nothing was changed.
    read(): CropParams | undefined {
      if (!im) return undefined;
      const p: CropParams = { ops: st.ops, deg: st.deg, rect: { ...st.rect }, ratio: st.ratio };
      return isIdentity(p, im.naturalWidth, im.naturalHeight) ? undefined : p;
    },
    reset,
    end() { overlay.hidden = true; drag = null; },
    isOpen: () => !overlay.hidden,
    full,
  };
}
