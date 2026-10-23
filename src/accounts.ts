// Local accounts: separate profiles on this device, each with its own designs, presets and brand colors.
// There is no server and no sign-in provider. A passcode only keeps casual snoopers out of the editor on a shared device:
// the data itself is not encrypted, and it does not follow you to another device (use Back up instead).
export interface Profile { id: string; name: string; salt?: string; hash?: string }

const LIST = 'canva-lite:accounts';
const CUR = 'canva-lite:account';
const unlockKey = (id: string) => `canva-lite:unlocked:${id}`;

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

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
export const canHash = () => !!globalThis.crypto?.subtle;
const hashOf = async (pass: string, salt: string) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 100_000, salt: new TextEncoder().encode(salt) }, key, 256));
};

export const needsUnlock = (p: Profile = current()) => {
  try { return !!p.hash && sessionStorage.getItem(unlockKey(p.id)) !== '1'; } catch { return !!p.hash; }
};
export const tryUnlock = async (pass: string, p: Profile = current()) => {
  if (!p.hash || !p.salt) return true;
  if ((await hashOf(pass, p.salt)) !== p.hash) return false;
  try { sessionStorage.setItem(unlockKey(p.id), '1'); } catch { /* unlocked for this page only */ }
  return true;
};
export const lockNow = () => { try { sessionStorage.removeItem(unlockKey(current().id)); } catch { /* ignore */ } location.reload(); };

export const setPasscode = async (id: string, pass: string | null) => {
  const l = profiles(), p = l.find(x => x.id === id);
  if (!p) return;
  if (!pass) { delete p.hash; delete p.salt; } else { p.salt = crypto.randomUUID(); p.hash = await hashOf(pass, p.salt); }
  saveProfiles(l);
  try { sessionStorage.setItem(unlockKey(id), '1'); } catch { /* ignore */ }
};

export const addProfile = async (name: string, pass?: string) => {
  const id = Math.random().toString(36).slice(2, 10);
  saveProfiles([...profiles(), { id, name: name.trim() || 'New profile' }]);
  if (pass) await setPasscode(id, pass);
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
