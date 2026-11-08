// Photo edits are parameters, never pixels. The source image is untouched, and a PhotoEdit is a few hundred bytes.
// The model follows Lightroom: Light, Color (with a colour mixer and colour grading), Effects, Detail, and a tone curve,
// so Lightroom presets (.xmp) can be read into it and written back out (see xmp.ts).
export const ADJ = [
  { key: 'exposure', label: 'Exposure', panel: 'light' },
  { key: 'contrast', label: 'Contrast', panel: 'light' },
  { key: 'highlights', label: 'Highlights', panel: 'light' },
  { key: 'shadows', label: 'Shadows', panel: 'light' },
  { key: 'whites', label: 'Whites', panel: 'light' },
  { key: 'blacks', label: 'Blacks', panel: 'light' },
  { key: 'brilliance', label: 'Brilliance', panel: 'light' },
  { key: 'brightness', label: 'Brightness', panel: 'light' },
  { key: 'blackPoint', label: 'Black Point', panel: 'light' },
  { key: 'warmth', label: 'Temp', panel: 'color' },
  { key: 'tint', label: 'Tint', panel: 'color' },
  { key: 'vibrance', label: 'Vibrance', panel: 'color' },
  { key: 'saturation', label: 'Saturation', panel: 'color' },
  { key: 'texture', label: 'Texture', panel: 'effects' },
  { key: 'definition', label: 'Clarity', panel: 'effects' },
  { key: 'dehaze', label: 'Dehaze', panel: 'effects' },
  { key: 'vignette', label: 'Vignette', panel: 'effects' },
  { key: 'grain', label: 'Grain', panel: 'effects' },
  { key: 'sharpness', label: 'Sharpening', panel: 'detail' },
  { key: 'noiseReduction', label: 'Noise Reduction', panel: 'detail' },
] as const;

export type AdjKey = (typeof ADJ)[number]['key'];
export const KEYS: AdjKey[] = ADJ.map(a => a.key);
export const POSITIVE: AdjKey[] = ['noiseReduction', 'grain']; // these run 0..100, the rest -100..100
export const minOf = (k: AdjKey) => (POSITIVE.includes(k) ? 0 : -100);
export type Adj = Record<AdjKey, number>;

import type { CropParams } from './cropMath';

// Tone curve points are [input, output] on 0..255, like Lightroom's point curve.
export type Pt = [number, number];
export type Channel = 'rgb' | 'r' | 'g' | 'b';
export type Curves = Partial<Record<Channel, Pt[]>>;
export const BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;
export type Band = (typeof BANDS)[number];
export const BAND_HUE: Record<Band, number> = { red: 0, orange: 30, yellow: 60, green: 120, aqua: 180, blue: 240, purple: 270, magenta: 300 };
// Colour mixer: per band [hue, saturation, luminance], each -100..100.
export type Hsl = Partial<Record<Band, [number, number, number]>>;
// Colour grading: hue 0..360, saturation 0..100, luminance -100..100. Blending 0..100 (default 50), balance -100..100.
export interface Tone3 { h: number; s: number; l: number }
export const RANGES = ['shadows', 'midtones', 'highlights', 'global'] as const;
export type Range = (typeof RANGES)[number];
export interface Grade extends Partial<Record<Range, Tone3>> { blending?: number; balance?: number }

// Everything a look can set. A preset is a named look; an edit is a look plus a chosen preset and a crop.
export interface Look { adj: Partial<Adj>; hsl?: Hsl; curve?: Curves; grade?: Grade; mono?: boolean }
export interface PhotoEdit extends Look { filter?: { id: string; amount: number }; crop?: CropParams }
export interface Preset extends Look { id: string; name: string; group?: string }

export const BUILTIN: Preset[] = [
  { id: 'vivid', name: 'Vivid', adj: { saturation: 25, vibrance: 30, contrast: 15, definition: 20 } },
  { id: 'bright', name: 'Bright', adj: { exposure: 25, shadows: 30, brilliance: 20 } },
  { id: 'warm', name: 'Warm', adj: { warmth: 35, tint: 5, brightness: 5, saturation: 10 } },
  { id: 'cool', name: 'Cool', adj: { warmth: -35, tint: -5, contrast: 5 } },
  { id: 'sunset', name: 'Sunset', adj: { warmth: 55, tint: 15, saturation: 25, vignette: 15 } },
  { id: 'film', name: 'Film', adj: { warmth: 15, blackPoint: -25, saturation: -12, contrast: 10, grain: 25 } },
  { id: 'fade', name: 'Fade', adj: { blackPoint: -35, contrast: -15, saturation: -20, brightness: 8 } },
  { id: 'matte', name: 'Matte', adj: { contrast: 10, vibrance: 10 }, curve: { rgb: [[0, 32], [64, 68], [192, 196], [255, 240]] } },
  { id: 'tealorange', name: 'Teal & Orange', adj: { contrast: 15, vibrance: 10 }, grade: { shadows: { h: 190, s: 35, l: 0 }, highlights: { h: 35, s: 30, l: 0 }, blending: 60 }, hsl: { orange: [5, 15, 5], blue: [-10, 10, 0], aqua: [10, 0, 0] } },
  { id: 'dramatic', name: 'Dramatic', adj: { contrast: 35, shadows: -25, highlights: -20, definition: 40, saturation: -10, vignette: 25 } },
  { id: 'mono', name: 'Mono', adj: { contrast: 18, definition: 15 }, mono: true },
  { id: 'noir', name: 'Noir', adj: { contrast: 45, blackPoint: 25, shadows: -20, vignette: 35, grain: 30 }, mono: true },
];

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const zero = () => Object.fromEntries(KEYS.map(k => [k, 0])) as Adj;

// What the shader draws: every slider, plus the optional extras. Kept flat so it serializes as a Fabric filter param.
export type Params = Adj & { hsl?: number[]; curves?: { c: Curves; k: number }[]; grade?: number[]; mono?: number };

const hasCurve = (c?: Curves) => !!c && Object.values(c).some(p => p && p.length >= 2 && p.some(([x, y]) => Math.abs(x - y) > 0.5));
const toneOn = (t?: Tone3) => !!t && (t.s > 0 || t.l !== 0);

// Manual settings plus the chosen preset scaled by its amount (0-100).
export const effective = (e: Look & { filter?: PhotoEdit['filter'] } | undefined, presets: Preset[]): Params => {
  const out: Params = zero();
  if (!e) return out;
  const pre = e.filter ? presets.find(p => p.id === e.filter!.id) : undefined;
  const k = pre && e.filter ? e.filter.amount / 100 : 0;
  for (const key of KEYS) out[key] = clamp(Math.round((e.adj?.[key] ?? 0) + (pre?.adj[key] ?? 0) * k), minOf(key), 100);

  const hsl = BANDS.flatMap(b => [0, 1, 2].map(i => clamp((e.hsl?.[b]?.[i] ?? 0) + (pre?.hsl?.[b]?.[i] ?? 0) * k, -100, 100)));
  if (hsl.some(v => v !== 0)) out.hsl = hsl;

  const curves = [pre && hasCurve(pre.curve) && k > 0 ? { c: pre.curve!, k } : null, hasCurve(e.curve) ? { c: e.curve!, k: 1 } : null].filter(Boolean) as Params['curves'];
  if (curves!.length) out.curves = curves;

  // Grading: a range you set yourself wins; otherwise the preset's, scaled by the amount.
  const g: number[] = [];
  let any = false;
  for (const r of RANGES) {
    const t = toneOn(e.grade?.[r]) ? e.grade![r]! : pre?.grade?.[r] ? { ...pre.grade[r]!, s: pre.grade[r]!.s * k, l: pre.grade[r]!.l * k } : undefined;
    if (toneOn(t)) any = true;
    g.push(t?.h ?? 0, t?.s ?? 0, t?.l ?? 0);
  }
  const src = e.grade && RANGES.some(r => toneOn(e.grade![r])) ? e.grade : pre?.grade;
  if (any) out.grade = [...g, src?.blending ?? 50, src?.balance ?? 0];

  const mono = Math.max(e.mono ? 1 : 0, pre?.mono ? k : 0);
  if (mono > 0) out.mono = mono;
  return out;
};

export const isNeutral = (p: Params) => KEYS.every(k => p[k] === 0) && !p.hsl && !p.curves && !p.grade && !p.mono;
export const hasLook = (l: Look | undefined) => !!l && (KEYS.some(k => (l.adj?.[k] ?? 0) !== 0) || !!l.mono || hasCurve(l.curve)
  || BANDS.some(b => l.hsl?.[b]?.some(v => v !== 0)) || RANGES.some(r => toneOn(l.grade?.[r])));
export const isEdited = (e: PhotoEdit | undefined) => !!e && (!!e.crop || (!!e.filter && e.filter.amount > 0) || hasLook(e));

// --- tone curve math -------------------------------------------------------
// Monotone cubic interpolation (Fritsch-Carlson) through the points: smooth like Lightroom, never overshoots.
export const curveTable = (pts: Pt[]): Float32Array => {
  const p = [...pts].filter(q => Number.isFinite(q[0]) && Number.isFinite(q[1])).sort((a, b) => a[0] - b[0])
    .filter((q, i, a) => i === 0 || q[0] > a[i - 1][0]);
  const out = new Float32Array(256);
  if (p.length < 2) { for (let i = 0; i < 256; i++) out[i] = i; return out; }
  const n = p.length, d: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0]));
  m.push(d[0]);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  for (let x = 0; x < 256; x++) {
    let y: number;
    if (x <= p[0][0]) y = p[0][1];
    else if (x >= p[n - 1][0]) y = p[n - 1][1];
    else {
      let i = 0;
      while (x > p[i + 1][0]) i++;
      const h = p[i + 1][0] - p[i][0], t = (x - p[i][0]) / h, t2 = t * t, t3 = t2 * t;
      y = (2 * t3 - 3 * t2 + 1) * p[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * p[i + 1][1] + (t3 - t2) * h * m[i + 1];
    }
    out[x] = clamp(y, 0, 255);
  }
  return out;
};

// One 256-entry RGBA table for the shader: each layer's master curve then its channel curves, faded by its amount.
export const buildLut = (layers: { c: Curves; k: number }[]): Uint8Array => {
  const lut = new Uint8Array(256 * 4);
  const tables = layers.map(l => ({ k: l.k, t: Object.fromEntries((['rgb', 'r', 'g', 'b'] as Channel[]).map(ch => [ch, l.c[ch] && l.c[ch]!.length >= 2 ? curveTable(l.c[ch]!) : null])) as Record<Channel, Float32Array | null> }));
  const look = (t: Float32Array | null, v: number, k: number) => {
    if (!t) return v;
    const i = Math.floor(v), f = v - i, y = i >= 255 ? t[255] : t[i] * (1 - f) + t[i + 1] * f;
    return v + (y - v) * k;
  };
  for (let x = 0; x < 256; x++) {
    const v = [x, x, x];
    for (const { k, t } of tables) {
      for (let c = 0; c < 3; c++) v[c] = look(t.rgb, v[c], k);
      v[0] = look(t.r, v[0], k); v[1] = look(t.g, v[1], k); v[2] = look(t.b, v[2], k);
    }
    lut[x * 4] = Math.round(v[0]); lut[x * 4 + 1] = Math.round(v[1]); lut[x * 4 + 2] = Math.round(v[2]); lut[x * 4 + 3] = 255;
  }
  return lut;
};

// Auto-enhance: look at brightness (0-1) and colour of the photo and pick slider values a person could then tweak.
export interface PhotoStats { mean: number; p5: number; p95: number; sat: number }
export const autoAdjust = (s: PhotoStats): Partial<Adj> => {
  const out: Partial<Adj> = {};
  const set = (k: AdjKey, v: number) => { if (v) out[k] = clamp(Math.round(v), -100, 100); };
  set('exposure', clamp((0.46 - s.mean) * 120, -40, 40));
  set('shadows', s.p5 < 0.08 ? clamp((0.08 - s.p5) * 300, 0, 40) : 0);
  set('highlights', s.p95 > 0.92 ? -clamp((s.p95 - 0.92) * 400, 0, 40) : 0);
  set('whites', s.p95 < 0.85 ? clamp((0.85 - s.p95) * 120, 0, 30) : 0);
  set('blacks', s.p5 > 0.06 ? -clamp((s.p5 - 0.06) * 150, 0, 25) : 0);
  set('contrast', s.p95 - s.p5 < 0.65 ? clamp((0.65 - (s.p95 - s.p5)) * 80, 0, 25) : 0);
  set('vibrance', 15);
  set('saturation', s.sat < 0.3 ? 8 : 0);
  set('definition', 10);
  return out;
};

// Presets arrive from backups, imported files and storage: keep only well-formed numbers in range.
const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : undefined);
const cleanPts = (v: unknown): Pt[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const pts = v.slice(0, 32).map(p => (Array.isArray(p) ? [num(p[0], 0, 255), num(p[1], 0, 255)] : [])).filter((p): p is Pt => p.length === 2 && p[0] !== undefined && p[1] !== undefined);
  return pts.length >= 2 ? pts : undefined;
};
const cleanTone = (v: unknown): Tone3 | undefined => {
  const t = v as Tone3;
  if (!t || typeof t !== 'object') return undefined;
  return { h: num(t.h, 0, 360) ?? 0, s: num(t.s, 0, 100) ?? 0, l: num(t.l, -100, 100) ?? 0 };
};
export const cleanLook = (v: unknown): Look => {
  const q = (v ?? {}) as Look;
  const look: Look = { adj: {} };
  for (const k of KEYS) { const x = num((q.adj as Record<string, unknown> | undefined)?.[k], minOf(k), 100); if (x) look.adj[k] = Math.round(x); }
  if (q.hsl && typeof q.hsl === 'object') {
    const hsl: Hsl = {};
    for (const b of BANDS) { const t = (q.hsl as Record<string, unknown>)[b]; if (Array.isArray(t)) { const v3 = [0, 1, 2].map(i => num(t[i], -100, 100) ?? 0) as [number, number, number]; if (v3.some(x => x)) hsl[b] = v3; } }
    if (Object.keys(hsl).length) look.hsl = hsl;
  }
  if (q.curve && typeof q.curve === 'object') {
    const curve: Curves = {};
    for (const ch of ['rgb', 'r', 'g', 'b'] as Channel[]) { const p = cleanPts((q.curve as Record<string, unknown>)[ch]); if (p) curve[ch] = p; }
    if (hasCurve(curve)) look.curve = curve;
  }
  if (q.grade && typeof q.grade === 'object') {
    const grade: Grade = {};
    for (const r of RANGES) { const t = cleanTone(q.grade[r]); if (toneOn(t)) grade[r] = t; }
    const bl = num(q.grade.blending, 0, 100), ba = num(q.grade.balance, -100, 100);
    if (bl !== undefined) grade.blending = bl;
    if (ba !== undefined) grade.balance = ba;
    if (RANGES.some(r => grade[r])) look.grade = grade;
  }
  if (q.mono === true) look.mono = true;
  return look;
};
export const cleanPreset = (v: unknown): Preset | null => {
  const q = v as Preset;
  if (!q || typeof q.id !== 'string' || typeof q.name !== 'string') return null;
  const p: Preset = { id: q.id.slice(0, 40), name: q.name.slice(0, 80), ...cleanLook(q) };
  if (typeof q.group === 'string' && q.group.trim()) p.group = q.group.slice(0, 60);
  return p;
};
