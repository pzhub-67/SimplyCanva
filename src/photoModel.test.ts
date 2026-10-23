import { expect, test } from 'vitest';
import { BUILTIN, effective, isEdited, isNeutral } from './photoModel';

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
