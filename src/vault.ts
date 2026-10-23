// Encryption at rest. A passcode is stretched with PBKDF2 (SHA-256, 600,000 rounds) into an AES-GCM key that lives only
// in memory. It is never written anywhere, so reloading or locking forgets it. Every record gets its own random IV.
export interface Enc { iv: Uint8Array; data: Uint8Array }

const ITER = 600_000;
let key: CryptoKey | null = null;
export const getKey = () => key;
export const setKey = (k: CryptoKey | null) => { key = k; };
export const hasKey = () => key !== null;
export const canCrypto = () => !!globalThis.crypto?.subtle;

export const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

export const deriveKey = async (pass: string, salt: string) => {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: ITER, salt: unb64(salt) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
};

export const seal = async (value: unknown, k: CryptoKey | null = key): Promise<Enc> => {
  if (!k) throw new Error('locked');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify(value))));
  return { iv, data };
};
export const open = async <T>(e: Enc, k: CryptoKey | null = key): Promise<T> => {
  if (!k) throw new Error('locked');
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: e.iv as BufferSource }, k, e.data as BufferSource))) as T;
};

// Text form for localStorage and the profile list.
export const sealText = async (value: unknown, k: CryptoKey | null = key) => { const e = await seal(value, k); return `enc1:${b64(e.iv)}:${b64(e.data)}`; };
export const openText = async <T>(s: string, k: CryptoKey | null = key): Promise<T> => { const [, iv, data] = s.split(':'); return open<T>({ iv: unb64(iv), data: unb64(data) }, k); };
export const isSealedText = (s: string | null): s is string => !!s && s.startsWith('enc1:');
export const isSealed = (r: unknown): r is { id: string; enc: Enc } => !!r && typeof r === 'object' && 'enc' in (r as object);
