// Local accounts: separate profiles on this device, each with its own designs, presets and brand colors.
// There is no server and no sign-in provider. A passcode only keeps casual snoopers out of the editor on a shared device:
// the data itself is encrypted with a key derived from the passcode (vault.ts). It does not follow you to another device (use Back up instead).
export interface Profile { id: string; name: string; salt?: string; canary?: string }
export const MIN_PASS = 8;
const CANARY = 'simplycanva';

const LIST = 'canva-lite:accounts';
const CUR = 'canva-lite:account';
import { deriveKey, hasKey, newSalt, openText, sealText, setKey } from './vault';

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

export const profiles = (): Profile[] => {
  try { const l = JSON.parse(get(LIST) ?? '[]') as Profile[]; if (l.length) return l; } catch { /* fall through */ }
  const first: Profile[] = [{ id: 'local', name: 'Me' }]; // 'local' keeps the data saved before accounts existed
  set(LIST, JSON.stringify(first));
  return first;
};
const saveProfiles = (l: Profile[]) => set(LIST, JSON.stringify(l));
export const current = (): Profile => profiles().find(p => p.id === get(CUR)) ?? profiles()[0];

// Per-profile storage names. The first profile keeps the original names so nothing saved earlier is lost.
export const scope = (base: string) => (current().id === 'local' ? base : `${base}:${current().id}`);
const dbNameOf = (id: string) => (id === 'local' ? 'canva-lite' : `canva-lite-${id}`);
export const dbName = () => dbNameOf(current().id);

export const switchTo = (id: string) => { set(CUR, id); location.reload(); };

export const needsUnlock = (p: Profile = current()) => !!p.salt && !hasKey();
// Derives the key from the passcode and checks it against the stored canary. The key stays in memory only.
export const tryUnlock = async (pass: string, p: Profile = current()) => {
  if (!p.salt || !p.canary) return true;
  try {
    const k = await deriveKey(pass, p.salt);
    if ((await openText<string>(p.canary, k)) !== CANARY) return false;
    setKey(k);
    return true;
  } catch { return false; }
};
// Brute-force delay: each wrong guess doubles the wait (2s, 4s ... max 60s). Kept in localStorage so a reload does not reset it.
const FAIL = 'canva-lite:fails';
export const waitMs = () => { try { const [n, t] = JSON.parse(get(FAIL) ?? '[0,0]') as number[]; return n ? Math.max(0, t + Math.min(60, 2 ** n) * 1000 - Date.now()) : 0; } catch { return 0; } };
export const noteFail = (ok: boolean) => { try { const [n] = JSON.parse(get(FAIL) ?? '[0,0]') as number[]; set(FAIL, JSON.stringify(ok ? [0, 0] : [n + 1, Date.now()])); } catch { /* ignore */ } };
export const lockNow = () => { setKey(null); location.reload(); };

export const updateProfile = (id: string, patch: Partial<Profile>) => {
  const l = profiles(), p = l.find(x => x.id === id);
  if (!p) return;
  Object.assign(p, patch);
  (Object.keys(patch) as (keyof Profile)[]).forEach(k => { if (patch[k] === undefined) delete p[k]; });
  saveProfiles(l);
};

export const addProfile = async (name: string, pass?: string) => {
  const id = Math.random().toString(36).slice(2, 10);
  const prof: Profile = { id, name: name.trim() || 'New profile' };
  if (pass) { prof.salt = newSalt(); prof.canary = await sealText(CANARY, await deriveKey(pass, prof.salt)); }
  saveProfiles([...profiles(), prof]);
  return id;
};
export const renameProfile = (id: string, name: string) => { const l = profiles(); const p = l.find(x => x.id === id); if (p) { p.name = name.trim() || p.name; saveProfiles(l); } };

// Removes a profile and everything saved under it.
export const deleteProfile = async (id: string) => {
  const l = profiles();
  if (l.length < 2) return false;
  await new Promise<void>(res => { try { const r = indexedDB.deleteDatabase(dbNameOf(id)); r.onsuccess = r.onerror = r.onblocked = () => res(); } catch { res(); } });
  const sfx = id === 'local' ? '' : `:${id}`;
  ['canva-lite:presets', 'canva-lite:brand', 'canva-lite:last'].forEach(k => { try { localStorage.removeItem(k + sfx); } catch { /* ignore */ } });
  saveProfiles(l.filter(p => p.id !== id));
  if (current().id === id) set(CUR, profiles()[0].id);
  return true;
};
