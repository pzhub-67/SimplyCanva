// Saved designs live in IndexedDB (far bigger than localStorage's ~5MB). `meta` is small so the home screen lists fast.
// shortcut: if IndexedDB is unavailable (private mode), designs live in memory for this visit only.
import { dbName, current, scope } from './accounts';
import type { Design } from './model';
import { Enc, getKey, isSealed, open as openEnc, seal } from './vault';

export interface Meta { id: string; title: string; updated: number; thumb: string; w: number; h: number }

const mem = new Map<string, { meta: Meta; design: Design }>();
let dbp: Promise<IDBDatabase | null> | null = null;

const open = () => (dbp ??= new Promise<IDBDatabase | null>(res => {
  try {
    const rq = indexedDB.open(dbName(), 1);
    rq.onupgradeneeded = () => { rq.result.createObjectStore('designs', { keyPath: 'id' }); rq.result.createObjectStore('meta', { keyPath: 'id' }); };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = rq.onblocked = () => res(null);
  } catch { res(null); }
}));

const done = (tx: IDBTransaction) => new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });
const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

// Records are plain for an unprotected profile and `{ id, enc }` once a passcode is set (see vault.ts).
const wrap = async <T extends { id: string }>(v: T, k: CryptoKey | null = getKey()): Promise<T | { id: string; enc: Enc }> => (k ? { id: v.id, enc: await seal(v, k) } : v);
const unwrap = async <T,>(r: unknown, k: CryptoKey | null = getKey()): Promise<T | undefined> => {
  if (r === undefined) return undefined;
  return isSealed(r) ? openEnc<T>(r.enc, k) : (r as T);
};

export const putDesign = async (design: Design, meta: Meta) => {
  const db = await open();
  if (!db) { mem.set(meta.id, { meta, design }); return; }
  const [d, m] = await Promise.all([wrap(design), wrap(meta)]);
  const tx = db.transaction(['designs', 'meta'], 'readwrite');
  tx.objectStore('designs').put(d); tx.objectStore('meta').put(m);
  await done(tx);
};

export const getDesign = async (id: string): Promise<Design | undefined> => {
  const db = await open();
  if (!db) return mem.get(id)?.design;
  return unwrap<Design>(await req<unknown>(db.transaction('designs').objectStore('designs').get(id)));
};

export const listMeta = async (): Promise<Meta[]> => {
  const db = await open();
  const raw = db ? await req<unknown[]>(db.transaction('meta').objectStore('meta').getAll()) : [...mem.values()].map(v => v.meta);
  const rows = (await Promise.all(raw.map(r => unwrap<Meta>(r).catch(() => undefined)))).filter((m): m is Meta => !!m);
  return rows.sort((a, b) => b.updated - a.updated);
};

export const deleteDesign = async (id: string) => {
  const db = await open();
  if (!db) { mem.delete(id); return; }
  const tx = db.transaction(['designs', 'meta'], 'readwrite');
  tx.objectStore('designs').delete(id); tx.objectStore('meta').delete(id);
  await done(tx);
};

export const renameDesign = async (id: string, title: string) => {
  const d = await getDesign(id);
  const m = (await listMeta()).find(x => x.id === id);
  if (d && m) await putDesign({ ...d, title }, { ...m, title });
};

// One-time move of the old single-slot save into the new store.
const OLD = 'canva-lite:design';
// (only the first profile ever had the old single-slot save)
export const migrateOld = async (thumb: string) => {
  try {
    if (current().id !== 'local') return;
    const raw = localStorage.getItem(OLD);
    if (!raw) return;
    const d = JSON.parse(raw) as Design;
    const p = d.pages[0];
    await putDesign(d, { id: d.id, title: d.title, updated: Date.now(), thumb, w: p.width, h: p.height });
    localStorage.removeItem(OLD);
  } catch { /* leave it in place; nothing is lost */ }
};

const LAST = () => scope('canva-lite:last');
export const lastId = () => { try { return localStorage.getItem(LAST()); } catch { return null; } };
export const setLastId = (id: string) => { try { localStorage.setItem(LAST(), id); } catch { /* storage blocked */ } };

// Everything in this profile's database, for backups.
export const allDesigns = async (): Promise<Design[]> => {
  const db = await open();
  if (!db) return [...mem.values()].map(v => v.design);
  const raw = await req<unknown[]>(db.transaction('designs').objectStore('designs').getAll());
  return (await Promise.all(raw.map(r => unwrap<Design>(r)))).filter((d): d is Design => !!d);
};
export const restoreDesigns = async (designs: Design[]) => {
  for (const d of designs) {
    const p = d.pages[0];
    await putDesign(d, { id: d.id, title: d.title, updated: Date.now(), thumb: p.thumb ?? '', w: p.width, h: p.height });
  }
};

// Passcode added, changed or removed: read every record with the old key and write it back with the new one, in one transaction.
export const reencryptAll = async (oldKey: CryptoKey | null, newKey: CryptoKey | null) => {
  const db = await open();
  if (!db) return;
  const out: Record<'designs' | 'meta', unknown[]> = { designs: [], meta: [] };
  for (const store of ['designs', 'meta'] as const) {
    const raw = await req<{ id: string }[]>(db.transaction(store).objectStore(store).getAll());
    for (const r of raw) { const v = await unwrap<{ id: string }>(r, oldKey); if (v) out[store].push(await wrap(v, newKey)); }
  }
  const tx = db.transaction(['designs', 'meta'], 'readwrite');
  out.designs.forEach(r => tx.objectStore('designs').put(r)); out.meta.forEach(r => tx.objectStore('meta').put(r));
  await done(tx);
};
