import { expect, test } from 'vitest';
import { BUILTIN, autoAdjust, effective, isEdited, isNeutral } from './photoModel';

test('no edit is neutral', () => {
  expect(isNeutral(effective(undefined, BUILTIN))).toBe(true);
  expect(isEdited(undefined)).toBe(false);
  expect(isEdited({ adj: { exposure: 0 } })).toBe(false);
});

test('preset scales with amount and stacks on manual sliders', () => {
  const warm = BUILTIN.find(p => p.id === 'warm')!; // warmth 35
  expect(effective({ adj: {}, filter: { id: 'warm', amount: 50 } }, BUILTIN).warmth).toBe(18);
  expect(effective({ adj: { warmth: 20 }, filter: { id: 'warm', amount: 100 } }, BUILTIN).warmth).toBe(55);
  expect(warm.adj.warmth).toBe(35);
});

test('values clamp, noise reduction never goes negative, unknown preset is ignored', () => {
  expect(effective({ adj: { contrast: 90 }, filter: { id: 'dramatic', amount: 100 } }, BUILTIN).contrast).toBe(100);
  expect(effective({ adj: { noiseReduction: -40 } }, BUILTIN).noiseReduction).toBe(0);
  expect(isNeutral(effective({ adj: {}, filter: { id: 'gone', amount: 100 } }, BUILTIN))).toBe(true);
});

test('auto-enhance lifts dark flat photos, calms bright ones, and stays in range', () => {
  const dark = autoAdjust({ mean: 0.2, p5: 0.02, p95: 0.6, sat: 0.2 });
  expect(dark.exposure).toBeGreaterThan(0);
  expect(dark.shadows).toBeGreaterThan(0);
  expect(dark.contrast).toBeGreaterThan(0);
  const bright = autoAdjust({ mean: 0.8, p5: 0.2, p95: 1, sat: 0.5 });
  expect(bright.exposure).toBeLessThan(0);
  expect(bright.highlights).toBeLessThan(0);
  expect(bright.shadows).toBeUndefined();
  expect(Math.abs(autoAdjust({ mean: 0, p5: 0, p95: 0, sat: 0 }).exposure!)).toBeLessThanOrEqual(40);
});
