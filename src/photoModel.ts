// Photo edits are Lightroom develop settings: the same crs: names, ranges and defaults as an .xmp file, so presets
// import and export without loss and every slider means what it means in Lightroom. Edits are parameters, never pixels.
import type { CropParams } from './cropMath';

export type Pt = [number, number];
export const BANDS = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'] as const;
export type Band = (typeof BANDS)[number];
export const BAND_HUE: Record<Band, number> = { Red: 0, Orange: 30, Yellow: 60, Green: 120, Aqua: 180, Blue: 240, Purple: 270, Magenta: 300 };
export const WHEELS = ['Shadow', 'Midtone', 'Highlight', 'Global'] as const;
export type Wheel = (typeof WHEELS)[number];
export const CURVES = ['ToneCurvePV2012', 'ToneCurvePV2012Red', 'ToneCurvePV2012Green', 'ToneCurvePV2012Blue'] as const;
export type CurveKey = (typeof CURVES)[number];

// The groups Lightroom uses for Copy Settings and Create Preset.
export type Group = 'light' | 'curve' | 'wb' | 'presence' | 'mix' | 'bw' | 'grading' | 'effects' | 'vignette' | 'grain'
  | 'sharpen' | 'noise' | 'colornoise' | 'optics' | 'geometry' | 'calibration';
export const GROUPS: { id: Group | 'crop' | 'profile'; label: string }[] = [
  { id: 'profile', label: 'Profile' }, { id: 'light', label: 'Light' }, { id: 'curve', label: 'Tone Curve' },
  { id: 'wb', label: 'White Balance' }, { id: 'presence', label: 'Vibrance & Saturation' }, { id: 'mix', label: 'Color Mix' },
  { id: 'bw', label: 'Black & White' }, { id: 'grading', label: 'Color Grading' }, { id: 'effects', label: 'Texture, Clarity, Dehaze' },
  { id: 'vignette', label: 'Vignette' }, { id: 'grain', label: 'Grain' }, { id: 'sharpen', label: 'Sharpening' },
  { id: 'noise', label: 'Noise Reduction' }, { id: 'colornoise', label: 'Color Noise Reduction' }, { id: 'optics', label: 'Optics' },
  { id: 'geometry', label: 'Geometry' }, { id: 'calibration', label: 'Calibration' }, { id: 'crop', label: 'Crop' },
];

export interface Spec { key: string; label: string; min: number; max: number; def: number; dp: number; group: Group; plus: boolean }
const S = (key: string, label: string, min: number, max: number, group: Group, def = 0, dp = 0): Spec => ({ key, label, min, max, def, dp, group, plus: min < 0 });
export const SPECS: Spec[] = [
  S('Exposure2012', 'Exposure', -5, 5, 'light', 0, 2),
  S('Contrast2012', 'Contrast', -100, 100, 'light'), S('Highlights2012', 'Highlights', -100, 100, 'light'),
  S('Shadows2012', 'Shadows', -100, 100, 'light'), S('Whites2012', 'Whites', -100, 100, 'light'), S('Blacks2012', 'Blacks', -100, 100, 'light'),
  S('ParametricHighlights', 'Highlights', -100, 100, 'curve'), S('ParametricLights', 'Lights', -100, 100, 'curve'),
  S('ParametricDarks', 'Darks', -100, 100, 'curve'), S('ParametricShadows', 'Shadows', -100, 100, 'curve'),
  S('ParametricShadowSplit', 'Shadow split', 10, 70, 'curve', 25), S('ParametricMidtoneSplit', 'Midtone split', 20, 80, 'curve', 50),
  S('ParametricHighlightSplit', 'Highlight split', 30, 90, 'curve', 75),
  S('IncrementalTemperature', 'Temp', -100, 100, 'wb'), S('IncrementalTint', 'Tint', -100, 100, 'wb'),
  S('Vibrance', 'Vibrance', -100, 100, 'presence'), S('Saturation', 'Saturation', -100, 100, 'presence'),
  ...BANDS.flatMap(b => [S(`HueAdjustment${b}`, 'Hue', -100, 100, 'mix'), S(`SaturationAdjustment${b}`, 'Saturation', -100, 100, 'mix'), S(`LuminanceAdjustment${b}`, 'Luminance', -100, 100, 'mix')]),
  ...BANDS.map(b => S(`GrayMixer${b}`, b, -100, 100, 'bw')),
  ...WHEELS.flatMap(w => [S(`ColorGrade${w}Hue`, 'Hue', 0, 359, 'grading'), S(`ColorGrade${w}Sat`, 'Saturation', 0, 100, 'grading'), S(`ColorGrade${w}Lum`, 'Luminance', -100, 100, 'grading')]),
  S('ColorGradeBlending', 'Blending', 0, 100, 'grading', 50), S('SplitToningBalance', 'Balance', -100, 100, 'grading'),
  S('Texture', 'Texture', -100, 100, 'effects'), S('Clarity2012', 'Clarity', -100, 100, 'effects'), S('Dehaze', 'Dehaze', -100, 100, 'effects'),
  S('PostCropVignetteAmount', 'Vignette', -100, 100, 'vignette'), S('PostCropVignetteMidpoint', 'Midpoint', 0, 100, 'vignette', 50),
  S('PostCropVignetteFeather', 'Feather', 0, 100, 'vignette', 50), S('PostCropVignetteRoundness', 'Roundness', -100, 100, 'vignette'),
  S('PostCropVignetteHighlightContrast', 'Highlights', 0, 100, 'vignette'), S('PostCropVignetteStyle', 'Style', 1, 3, 'vignette', 1),
  S('GrainAmount', 'Grain', 0, 100, 'grain'), S('GrainSize', 'Size', 0, 100, 'grain', 25), S('GrainFrequency', 'Roughness', 0, 100, 'grain', 50),
  S('Sharpness', 'Sharpening', 0, 150, 'sharpen'), S('SharpenRadius', 'Radius', 0.5, 3, 'sharpen', 1, 1),
  S('SharpenDetail', 'Detail', 0, 100, 'sharpen', 25), S('SharpenEdgeMasking', 'Masking', 0, 100, 'sharpen'),
  S('LuminanceSmoothing', 'Noise Reduction', 0, 100, 'noise'), S('LuminanceNoiseReductionDetail', 'Detail', 0, 100, 'noise', 50),
  S('LuminanceNoiseReductionContrast', 'Contrast', 0, 100, 'noise'),
  S('ColorNoiseReduction', 'Color Noise Reduction', 0, 100, 'colornoise'), S('ColorNoiseReductionDetail', 'Detail', 0, 100, 'colornoise', 50),
  S('ColorNoiseReductionSmoothness', 'Smoothness', 0, 100, 'colornoise', 50),
  S('LensManualDistortionAmount', 'Distortion', -100, 100, 'optics'), S('VignetteAmount', 'Vignetting', -100, 100, 'optics'),
  S('VignetteMidpoint', 'Midpoint', 0, 100, 'optics', 50),
  S('PerspectiveVertical', 'Vertical', -100, 100, 'geometry'), S('PerspectiveHorizontal', 'Horizontal', -100, 100, 'geometry'),
  S('PerspectiveRotate', 'Rotate', -10, 10, 'geometry', 0, 1), S('PerspectiveAspect', 'Aspect', -100, 100, 'geometry'),
  S('PerspectiveScale', 'Scale', 50, 150, 'geometry', 100), S('PerspectiveX', 'X Offset', -100, 100, 'geometry'), S('PerspectiveY', 'Y Offset', -100, 100, 'geometry'),
  S('ShadowTint', 'Shadows Tint', -100, 100, 'calibration'),
  S('RedHue', 'Red Hue', -100, 100, 'calibration'), S('RedSaturation', 'Red Saturation', -100, 100, 'calibration'),
  S('GreenHue', 'Green Hue', -100, 100, 'calibration'), S('GreenSaturation', 'Green Saturation', -100, 100, 'calibration'),
  S('BlueHue', 'Blue Hue', -100, 100, 'calibration'), S('BlueSaturation', 'Blue Saturation', -100, 100, 'calibration'),
];
export const SPEC: Record<string, Spec> = Object.fromEntries(SPECS.map(s => [s.key, s]));

// Develop settings: numbers by crs name, the B&W switch, the point curves, and the profile.
export type Dev = { [key: string]: number | boolean | Pt[] | string | undefined } & {
  ConvertToGrayscale?: boolean; ToneCurvePV2012?: Pt[]; ToneCurvePV2012Red?: Pt[]; ToneCurvePV2012Green?: Pt[]; ToneCurvePV2012Blue?: Pt[];
  Profile?: string; // 'Color' (Adobe Color) or 'Monochrome' (Adobe Monochrome)
  Temperature?: number; Tint?: number; // absolute white balance from raw presets: kept for export, not used on rendered photos (as in Lightroom)
};
export const PROFILES = ['Color', 'Monochrome'] as const;
// An edit: the settings, an optional crop, and (right after applying a preset) what Amount blends between.
export interface PhotoEdit { dev: Dev; crop?: CropParams; preset?: { id: string; amount: number; base: Dev } }
export interface Preset { id: string; name: string; group?: string; dev: Dev }

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const num = (d: Dev | undefined, k: string): number => { const v = d?.[k]; return typeof v === 'number' ? v : SPEC[k]?.def ?? 0; };
const round = (k: string, v: number) => { const s = SPEC[k]; const f = 10 ** (s?.dp ?? 0); return Math.round(clamp(v, s?.min ?? -1e9, s?.max ?? 1e9) * f) / f; };
export const isIdentity = (p?: Pt[]) => !p || p.length < 2 || p.every(([x, y]) => Math.abs(x - y) < 0.5);
export const mono = (d: Dev | undefined) => !!d?.ConvertToGrayscale || d?.Profile === 'Monochrome';

// Value as Lightroom shows it: "+0.50" for Exposure, "+25", "0", "1.0".
export const fmt = (k: string, v: number) => { const s = SPEC[k]; const t = v.toFixed(s?.dp ?? 0); return s?.plus && v > 0 ? `+${t}` : t === '-0' ? '0' : t; };

// Settings that differ from Lightroom's defaults (what an .xmp would carry).
export const changed = (d: Dev | undefined): string[] => !d ? [] : Object.keys(d).filter(k => {
  const v = d[k];
  if (SPEC[k]) return typeof v === 'number' && Math.abs(v - SPEC[k].def) > 1e-9;
  if ((CURVES as readonly string[]).includes(k)) return !isIdentity(v as Pt[]);
  if (k === 'ConvertToGrayscale') return v === true;
  if (k === 'Profile') return typeof v === 'string' && v !== 'Color';
  return false;
});
export const isNeutralDev = (d: Dev | undefined) => !changed(d).filter(k => k !== 'Temperature' && k !== 'Tint').length;
export const isEdited = (e: PhotoEdit | undefined) => !!e && (!!e.crop || !isNeutralDev(e.dev));
export const groupOfKey = (k: string): Group | 'profile' | null => SPEC[k]?.group ?? ((CURVES as readonly string[]).includes(k) ? 'curve' : k === 'ConvertToGrayscale' ? 'bw' : k === 'Profile' ? 'profile' : k === 'Temperature' || k === 'Tint' ? 'wb' : null);
export const pick = (d: Dev, groups: Set<string>): Dev => Object.fromEntries(Object.entries(d).filter(([k]) => groups.has(groupOfKey(k) ?? ''))) as Dev;

// --- presets: Lightroom semantics ---------------------------------------------------------
// Applying a preset sets the settings it contains. Amount (0-200) blends from the settings you had before
// (0) to the preset (100) and beyond (200), like Lightroom's preset Amount slider.
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
const lerpCurve = (a: Pt[] | undefined, b: Pt[] | undefined, t: number): Pt[] => {
  const ta = curveTable(a ?? [[0, 0], [255, 255]]), tb = curveTable(b ?? [[0, 0], [255, 255]]);
  return Array.from({ length: 17 }, (_, i) => { const x = Math.min(255, i * 16); return [x, Math.round(clamp(ta[x] + (tb[x] - ta[x]) * t, 0, 255))] as Pt; });
};
export const blendDev = (base: Dev, target: Dev, t: number): Dev => {
  const out: Dev = { ...base };
  for (const k of Object.keys(target)) {
    const a = base[k], b = target[k];
    if (SPEC[k]) { const av = typeof a === 'number' ? a : SPEC[k].def, bv = typeof b === 'number' ? b : SPEC[k].def; out[k] = round(k, av + (bv - av) * t); }
    else if ((CURVES as readonly string[]).includes(k)) out[k] = t >= 1 && t <= 1 ? (b as Pt[]) : lerpCurve(a as Pt[] | undefined, b as Pt[] | undefined, Math.min(1, t));
    else out[k] = t >= 0.5 ? b : a;
    if (out[k] === undefined || (!(k in base) && SPEC[k] && out[k] === SPEC[k].def)) delete out[k]; // nothing set: keep the edit clean
  }
  return out;
};
export const applyPreset = (e: PhotoEdit, p: Preset | undefined, amount = 100): PhotoEdit => {
  const base = e.preset ? e.preset.base : e.dev;
  if (!p) return { ...e, dev: { ...base }, preset: undefined };
  return { ...e, dev: blendDev(base, { ...p.dev }, amount / 100), preset: { id: p.id, amount, base } };
};

// --- tone curve tables for the engine ------------------------------------------------------------
// Lightroom's parametric curve (four regions between three splits), as a smooth monotone curve on 0..255.
export const parametricPoints = (d: Dev | undefined): Pt[] | null => {
  const v = ['ParametricShadows', 'ParametricDarks', 'ParametricLights', 'ParametricHighlights'].map(k => num(d, k));
  if (v.every(x => x === 0)) return null;
  const s1 = num(d, 'ParametricShadowSplit') * 2.55, s2 = num(d, 'ParametricMidtoneSplit') * 2.55, s3 = num(d, 'ParametricHighlightSplit') * 2.55;
  const xs = [s1 / 2, (s1 + s2) / 2, (s2 + s3) / 2, (s3 + 255) / 2];
  return [[0, 0], ...xs.map((x, i) => [x, clamp(x + v[i] * 0.34 * Math.min(x, 255 - x, 64) / 64 * 1.2, 0, 255)] as Pt), [255, 255]];
};
// One RGBA table per edit: parametric curve, then the point curve, then each channel's point curve.
export const buildLut = (d: Dev | undefined): Uint8Array | null => {
  const para = parametricPoints(d);
  const ch = CURVES.map(k => (isIdentity(d?.[k] as Pt[]) ? null : curveTable(d![k] as Pt[])));
  if (!para && ch.every(c => !c)) return null;
  const pt = para ? curveTable(para) : null;
  const look = (t: Float32Array | null, v: number) => { if (!t) return v; const i = Math.floor(v), f = v - i; return i >= 255 ? t[255] : t[i] * (1 - f) + t[i + 1] * f; };
  const lut = new Uint8Array(256 * 4);
  for (let x = 0; x < 256; x++) {
    const m = look(ch[0], look(pt, x));
    lut[x * 4] = Math.round(look(ch[1], m)); lut[x * 4 + 1] = Math.round(look(ch[2], m)); lut[x * 4 + 2] = Math.round(look(ch[3], m)); lut[x * 4 + 3] = 255;
  }
  return lut;
};

// --- Auto (like Lightroom's Auto: Light, plus Vibrance and Saturation) ----------------------------------
export interface PhotoStats { mean: number; p1: number; p5: number; p95: number; p99: number; sat: number }
export const autoSettings = (s: PhotoStats): Dev => {
  const ev = clamp(Math.log2(0.42 / Math.max(0.02, s.mean)) * 0.8, -2, 2);
  const range = s.p95 - s.p5;
  return {
    Exposure2012: round('Exposure2012', ev),
    Contrast2012: round('Contrast2012', range < 0.6 ? (0.6 - range) * 60 : -(range - 0.8) * 40),
    Highlights2012: round('Highlights2012', s.p99 > 0.97 ? -clamp((s.p99 - 0.9) * 400, 0, 60) : -10),
    Shadows2012: round('Shadows2012', s.p5 < 0.1 ? clamp((0.1 - s.p5) * 400, 0, 50) : 5),
    Whites2012: round('Whites2012', clamp((0.97 - s.p99) * 150, -30, 40)),
    Blacks2012: round('Blacks2012', clamp((0.02 - s.p1) * 300, -40, 20)),
    Vibrance: round('Vibrance', s.sat < 0.35 ? 18 : 10),
    Saturation: round('Saturation', s.sat < 0.25 ? 5 : 0),
  };
};

// --- validation -------------------------------------------------------------------------------------
const cleanPts = (v: unknown): Pt[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const pts = v.slice(0, 32).map(p => (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [clamp(+p[0], 0, 255), clamp(+p[1], 0, 255)] : null)).filter((p): p is Pt => !!p);
  return pts.length >= 2 ? pts : undefined;
};
export const cleanDev = (v: unknown): Dev => {
  const q = (v ?? {}) as Record<string, unknown>, d: Dev = {};
  for (const s of SPECS) { const x = q[s.key]; if (typeof x === 'number' && Number.isFinite(x)) d[s.key] = round(s.key, x); }
  for (const k of CURVES) { const p = cleanPts(q[k]); if (p) d[k] = p; }
  if (q.ConvertToGrayscale === true) d.ConvertToGrayscale = true;
  if (q.Profile === 'Monochrome') d.Profile = 'Monochrome';
  for (const k of ['Temperature', 'Tint'] as const) { const x = q[k]; if (typeof x === 'number' && Number.isFinite(x)) d[k] = clamp(x, k === 'Temperature' ? 2000 : -150, k === 'Temperature' ? 50000 : 150); }
  return d;
};

// --- older SimplyCanva edits (before Lightroom settings) -------------------------------------------------
// They stored iPhone-style sliders (-100..100) plus a preset added on top. Converted once, as closely as the two models allow.
type Legacy = { adj?: Record<string, number>; hsl?: Record<string, number[]>; curve?: Record<string, Pt[]>; grade?: Record<string, { h: number; s: number; l: number } | number>; mono?: boolean };
const LEGACY_BANDS: Record<string, Band> = { red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green', aqua: 'Aqua', blue: 'Blue', purple: 'Purple', magenta: 'Magenta' };
export const legacyToDev = (l: Legacy | undefined): Dev => {
  const a = l?.adj ?? {}, d: Record<string, number | boolean | Pt[]> = {};
  const add = (k: string, v: number) => { if (v) d[k] = ((d[k] as number) ?? 0) + v; };
  add('Exposure2012', (a.exposure ?? 0) / 100 * 1.5);
  add('Contrast2012', a.contrast ?? 0); add('Highlights2012', a.highlights ?? 0); add('Shadows2012', a.shadows ?? 0);
  add('Whites2012', a.whites ?? 0); add('Blacks2012', a.blacks ?? 0);
  add('Shadows2012', (a.brilliance ?? 0) * 0.4); add('Highlights2012', -(a.brilliance ?? 0) * 0.3);
  add('ParametricDarks', (a.brightness ?? 0) * 0.5); add('ParametricLights', (a.brightness ?? 0) * 0.5);
  add('Blacks2012', -(a.blackPoint ?? 0) * 0.8);
  add('IncrementalTemperature', a.warmth ?? 0); add('IncrementalTint', a.tint ?? 0);
  add('Vibrance', a.vibrance ?? 0); add('Saturation', a.saturation ?? 0);
  add('Texture', a.texture ?? 0); add('Clarity2012', a.definition ?? 0); add('Dehaze', a.dehaze ?? 0);
  add('PostCropVignetteAmount', -(a.vignette ?? 0)); add('GrainAmount', a.grain ?? 0);
  add('Sharpness', Math.max(0, a.sharpness ?? 0) * 1.2); add('LuminanceSmoothing', a.noiseReduction ?? 0);
  for (const [b, v] of Object.entries(l?.hsl ?? {})) {
    const B = LEGACY_BANDS[b];
    if (B && Array.isArray(v)) { add(`HueAdjustment${B}`, v[0] ?? 0); add(`SaturationAdjustment${B}`, v[1] ?? 0); add(`LuminanceAdjustment${B}`, v[2] ?? 0); }
  }
  const cmap: Record<string, CurveKey> = { rgb: 'ToneCurvePV2012', r: 'ToneCurvePV2012Red', g: 'ToneCurvePV2012Green', b: 'ToneCurvePV2012Blue' };
  for (const [c, p] of Object.entries(l?.curve ?? {})) if (cmap[c]) d[cmap[c]] = p;
  const g = l?.grade ?? {};
  const wmap: Record<string, Wheel> = { shadows: 'Shadow', midtones: 'Midtone', highlights: 'Highlight', global: 'Global' };
  for (const [r, w] of Object.entries(wmap)) { const t = g[r]; if (t && typeof t === 'object') { d[`ColorGrade${w}Hue`] = t.h; d[`ColorGrade${w}Sat`] = t.s; d[`ColorGrade${w}Lum`] = t.l; } }
  if (typeof g.blending === 'number') d.ColorGradeBlending = g.blending;
  if (typeof g.balance === 'number') d.SplitToningBalance = g.balance;
  if (l?.mono) d.ConvertToGrayscale = true;
  return cleanDev(d);
};
const addDev = (a: Dev, b: Dev, k: number): Dev => {
  const out: Dev = { ...a };
  for (const key of Object.keys(b)) {
    if (SPEC[key] && typeof b[key] === 'number') out[key] = round(key, num(a, key) + ((b[key] as number) - SPEC[key].def) * k);
    else if (!(key in a) && k >= 0.5) out[key] = b[key];
  }
  return out;
};
// Any edit or preset, old or new, as the current shape.
export const migrateEdit = (e: unknown, presets: Preset[]): PhotoEdit | undefined => {
  if (!e || typeof e !== 'object') return undefined;
  const o = e as PhotoEdit & Legacy & { filter?: { id: string; amount: number } };
  if (o.dev) return { dev: cleanDev(o.dev), ...(o.crop ? { crop: o.crop } : {}), ...(o.preset ? { preset: { id: String(o.preset.id), amount: clamp(+o.preset.amount || 0, 0, 200), base: cleanDev(o.preset.base) } } : {}) };
  let dev = legacyToDev(o);
  const pre = o.filter && presets.find(p => p.id === o.filter!.id);
  if (pre && o.filter) dev = addDev(dev, pre.dev, clamp(o.filter.amount, 0, 200) / 100);
  return { dev, ...(o.crop ? { crop: o.crop } : {}) };
};
export const cleanPreset = (v: unknown): Preset | null => {
  const q = v as Preset & Legacy;
  if (!q || typeof q.id !== 'string' || typeof q.name !== 'string') return null;
  const p: Preset = { id: q.id.slice(0, 40), name: q.name.slice(0, 80), dev: q.dev ? cleanDev(q.dev) : legacyToDev(q) };
  if (typeof q.group === 'string' && q.group.trim()) p.group = q.group.slice(0, 60);
  return p;
};

// --- built-in looks (group "SimplyCanva") ---------------------------------------------------------------
const P = (id: string, name: string, dev: Dev): Preset => ({ id, name, group: 'SimplyCanva', dev: cleanDev(dev) });
export const BUILTIN: Preset[] = [
  P('vivid', 'Vivid', { Contrast2012: 15, Vibrance: 30, Saturation: 20, Clarity2012: 15 }),
  P('bright', 'Bright', { Exposure2012: 0.35, Shadows2012: 30, Highlights2012: -15, Whites2012: 10 }),
  P('warm', 'Warm', { IncrementalTemperature: 18, IncrementalTint: 4, Vibrance: 10 }),
  P('cool', 'Cool', { IncrementalTemperature: -18, IncrementalTint: -3, Contrast2012: 5 }),
  P('sunset', 'Sunset', { IncrementalTemperature: 28, IncrementalTint: 10, Saturation: 18, PostCropVignetteAmount: -15 }),
  P('film', 'Film', { Contrast2012: 10, IncrementalTemperature: 8, Saturation: -12, GrainAmount: 25, ToneCurvePV2012: [[0, 22], [64, 66], [192, 196], [255, 245]] }),
  P('fade', 'Fade', { Contrast2012: -15, Saturation: -20, ToneCurvePV2012: [[0, 40], [128, 135], [255, 240]] }),
  P('matte', 'Matte', { Contrast2012: 10, Vibrance: 10, ToneCurvePV2012: [[0, 32], [64, 68], [192, 196], [255, 240]] }),
  P('tealorange', 'Teal & Orange', { Contrast2012: 15, Vibrance: 10, ColorGradeShadowHue: 190, ColorGradeShadowSat: 35, ColorGradeHighlightHue: 35, ColorGradeHighlightSat: 30, ColorGradeBlending: 60, HueAdjustmentOrange: 5, SaturationAdjustmentOrange: 15, HueAdjustmentBlue: -10, SaturationAdjustmentBlue: 10, HueAdjustmentAqua: 10 }),
  P('dramatic', 'Dramatic', { Contrast2012: 35, Shadows2012: -25, Highlights2012: -20, Clarity2012: 40, Saturation: -10, PostCropVignetteAmount: -25 }),
  P('mono', 'Mono', { ConvertToGrayscale: true, Contrast2012: 18, Clarity2012: 15 }),
  P('noir', 'Noir', { ConvertToGrayscale: true, Contrast2012: 45, Blacks2012: -30, Shadows2012: -20, PostCropVignetteAmount: -35, GrainAmount: 30 }),
];
