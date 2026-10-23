// Small values in localStorage (looks, brand colors): plain JSON for an unprotected profile, encrypted text once a passcode is set.
import { getKey, isSealedText, openText, sealText } from './vault';

export const readSecure = async <T>(k: string, fallback: T, key = getKey()): Promise<T> => {
  try {
    const raw = localStorage.getItem(k);
    if (raw === null) return fallback;
    return isSealedText(raw) ? await openText<T>(raw, key) : (JSON.parse(raw) as T);
  } catch { return fallback; }
};
export const writeSecure = async (k: string, value: unknown) => {
  try { localStorage.setItem(k, getKey() ? await sealText(value) : JSON.stringify(value)); } catch { /* storage blocked */ }
};
export const rewriteSecure = async (k: string, oldKey: CryptoKey | null, newKey: CryptoKey | null) => {
  const raw = localStorage.getItem(k);
  if (raw === null) return;
  const v = await readSecure<unknown>(k, null, oldKey);
  if (v === null) return;
  localStorage.setItem(k, newKey ? await sealText(v, newKey) : JSON.stringify(v));
};
