import { expect, test } from 'vitest';
import { deriveKey, newSalt, open, openText, seal, sealText } from './vault';

test('seal/open round trips, wrong key fails, IVs differ', async () => {
  const salt = newSalt();
  const k = await deriveKey('correct horse', salt), bad = await deriveKey('wrong horse!', salt);
  const a = await seal({ x: 1 }, k), b = await seal({ x: 1 }, k);
  expect(await open(a, k)).toEqual({ x: 1 });
  expect(Array.from(a.iv)).not.toEqual(Array.from(b.iv));
  await expect(open(a, bad)).rejects.toThrow();
  const t = await sealText('simplycanva', k);
  expect(await openText(t, k)).toBe('simplycanva');
  await expect(openText(t, bad)).rejects.toThrow();
}, 20000);
