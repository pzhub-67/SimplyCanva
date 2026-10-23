// Photo edits are parameters, never pixels. The source image is untouched, and a PhotoEdit is a few hundred bytes.
export const ADJ = [
  { key: 'exposure', label: 'Exposure' },
  { key: 'brilliance', label: 'Brilliance' },
  { key: 'highlights', label: 'Highlights' },
  { key: 'shadows', label: 'Shadows' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'brightness', label: 'Brightness' },
  { key: 'blackPoint', label: 'Black Point' },
  { key: 'saturation', label: 'Saturation' },
  { key: 'vibrance', label: 'Vibrance' },
  { key: 'warmth', label: 'Warmth' },
  { key: 'tint', label: 'Tint' },
  { key: 'sharpness', label: 'Sharpness' },
  { key: 'definition', label: 'Definition' },
  { key: 'noiseReduction', label: 'Noise Reduction' },
  { key: 'vignette', label: 'Vignette' },
] as const;

export type AdjKey = (typeof ADJ)[number]['key'];
export const KEYS: AdjKey[] = ADJ.map(a => a.key);
export type Adj = Record<AdjKey, number>; // each -100..100, noiseReduction 0..100

import type { CropParams } from './cropMath';

// `crop` is applied to the pixels (the untouched original is kept on the image as `orig`), sliders and looks stay live params.
export interface PhotoEdit { adj: Partial<Adj>; filter?: { id: string; amount: number }; crop?: CropParams }
export interface Preset { id: string; name: string; adj: Partial<Adj> }

export const BUILTIN: Preset[] = [
  { id: 'vivid', name: 'Vivid', adj: { saturation: 25, vibrance: 30, contrast: 15, definition: 20 } },
  { id: 'bright', name: 'Bright', adj: { exposure: 25, shadows: 30, brilliance: 20 } },
  { id: 'warm', name: 'Warm', adj: { warmth: 35, tint: 5, brightness: 5, saturation: 10 } },
  { id: 'cool', name: 'Cool', adj: { warmth: -35, tint: -5, contrast: 5 } },
  { id: 'sunset', name: 'Sunset', adj: { warmth: 55, tint: 15, saturation: 25, vignette: 15 } },
  { id: 'film', name: 'Film', adj: { warmth: 15, blackPoint: -25, saturation: -12, contrast: 10 } },
  { id: 'fade', name: 'Fade', adj: { blackPoint: -35, contrast: -15, saturation: -20, brightness: 8 } },
  { id: 'dramatic', name: 'Dramatic', adj: { contrast: 35, shadows: -25, highlights: -20, definition: 40, saturation: -10, vignette: 25 } },
  { id: 'mono', name: 'Mono', adj: { saturation: -100, contrast: 18, definition: 15 } },
  { id: 'noir', name: 'Noir', adj: { saturation: -100, contrast: 45, blackPoint: 25, shadows: -20, vignette: 35 } },
];

const zero = () => Object.fromEntries(KEYS.map(k => [k, 0])) as Adj;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Manual sliders plus the chosen preset scaled by its amount (0-100), clamped to each slider's range.
export const effective = (e: PhotoEdit | undefined, presets: Preset[]): Adj => {
  const out = zero();
  if (!e) return out;
  const pre = e.filter ? presets.find(p => p.id === e.filter!.id) : undefined;
  const amount = e.filter ? e.filter.amount / 100 : 0;
  for (const k of KEYS) {
    out[k] = clamp(Math.round((e.adj[k] ?? 0) + (pre ? (pre.adj[k] ?? 0) * amount : 0)), k === 'noiseReduction' ? 0 : -100, 100);
  }
  return out;
};

export const isNeutral = (a: Adj) => KEYS.every(k => a[k] === 0);
export const isEdited = (e: PhotoEdit | undefined) =>
  !!e && (!!e.crop || (!!e.filter && e.filter.amount > 0) || KEYS.some(k => (e.adj[k] ?? 0) !== 0));

// Auto-enhance: look at brightness (0-1) and colour of the photo and pick slider values a person could then tweak.
export interface PhotoStats { mean: number; p5: number; p95: number; sat: number }
export const autoAdjust = (s: PhotoStats): Partial<Adj> => {
  const out: Partial<Adj> = {};
  const set = (k: AdjKey, v: number) => { if (v) out[k] = clamp(Math.round(v), -100, 100); };
  set('exposure', clamp((0.46 - s.mean) * 120, -40, 40));
  set('shadows', s.p5 < 0.08 ? clamp((0.08 - s.p5) * 300, 0, 40) : 0);
  set('highlights', s.p95 > 0.92 ? -clamp((s.p95 - 0.92) * 400, 0, 40) : 0);
  set('contrast', s.p95 - s.p5 < 0.65 ? clamp((0.65 - (s.p95 - s.p5)) * 80, 0, 25) : 0);
  set('vibrance', 15);
  set('saturation', s.sat < 0.3 ? 8 : 0);
  set('definition', 10);
  return out;
};
