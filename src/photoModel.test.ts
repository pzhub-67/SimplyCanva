import { expect, test } from 'vitest';
import { autoSettings, changed, cleanDev, fmt, isEdited, pick } from './photoModel';

test('values display like Lightroom', () => {
  expect(fmt('Exposure2012', 0.5)).toBe('+0.50');
  expect(fmt('Exposure2012', -1.25)).toBe('-1.25');
  expect(fmt('Contrast2012', 25)).toBe('+25');
  expect(fmt('Contrast2012', 0)).toBe('0');
  expect(fmt('SharpenRadius', 1)).toBe('1.0');
  expect(fmt('PerspectiveScale', 100)).toBe('100');
});
test('clean clamps and drops unknown or default-free junk', () => {
  expect(cleanDev({ Exposure2012: 9, Contrast2012: 33.6, Bogus: 5, ToneCurvePV2012: [[0, 0]], ConvertToGrayscale: 'yes' })).toEqual({ Exposure2012: 5, Contrast2012: 34 });
});
test('changed ignores defaults', () => {
  expect(changed({ ColorGradeBlending: 50, SharpenRadius: 1, Contrast2012: 0, Clarity2012: 4 })).toEqual(['Clarity2012']);
  expect(isEdited({ dev: { ColorGradeBlending: 50 } })).toBe(false);
});
test('pick by Lightroom group', () => {
  expect(pick({ Exposure2012: 1, Vibrance: 5, ToneCurvePV2012: [[0, 9], [255, 255]], GrainAmount: 3 }, new Set(['light', 'curve']))).toEqual({ Exposure2012: 1, ToneCurvePV2012: [[0, 9], [255, 255]] });
});
test('auto brightens a dark flat photo and leaves a good one mostly alone', () => {
  const dark = autoSettings({ mean: 0.15, p1: 0.02, p5: 0.04, p95: 0.4, p99: 0.5, sat: 0.3 });
  expect(dark.Exposure2012 as number).toBeGreaterThan(0.8);
  expect(dark.Whites2012 as number).toBeGreaterThan(0);
  const ok = autoSettings({ mean: 0.42, p1: 0.01, p5: 0.05, p95: 0.9, p99: 0.97, sat: 0.4 });
  expect(Math.abs(ok.Exposure2012 as number)).toBeLessThan(0.1);
});
