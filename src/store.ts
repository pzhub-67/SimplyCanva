// Saved designs live in IndexedDB (far bigger than localStorage's ~5MB). `meta` is small so the home screen lists fast.
// shortcut: if IndexedDB is unavailable (private mode), designs live in memory for this visit only.
import type { Design } from './model';

export interface Meta { id: string; title: string; updated: number; thumb: string; w: number; h: number }

const mem = new Map<string, { meta: Meta; design: Design }>();
let dbp: Promise<IDBDatabase | null> | null = null;

const open = () => (dbp ??= new Promise<IDBDatabase | null>(res => {
  try {
    const rq = indexedDB.open('canva-lite', 1);
    rq.onupgradeneeded = () => { rq.result.createObjectStore('designs', { keyPath: 'id' }); rq.result.createObjectStore('meta', { keyPath: 'id' }); };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = rq.onblocked = () => res(null);
  } catch { res(null); }
}));

const done = (tx: IDBTransaction) => new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });
const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const putDesign = async (design: Design, meta: Meta) => {
  const db = await open();
  if (!db) { mem.set(meta.id, { meta, design }); return; }
  const tx = db.transaction(['designs', 'meta'], 'readwrite');
  tx.objectStore('designs').put(design); tx.objectStore('meta').put(meta);
  await done(tx);
};

export const getDesign = async (id: string): Promise<Design | undefined> => {
  const db = await open();
  if (!db) return mem.get(id)?.design;
  return req<Design | undefined>(db.transaction('designs').objectStore('designs').get(id));
};

export const listMeta = async (): Promise<Meta[]> => {
  const db = await open();
  const rows = db ? await req<Meta[]>(db.transaction('meta').objectStore('meta').getAll()) : [...mem.values()].map(v => v.meta);
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
export const migrateOld = async (thumb: string) => {
  try {
    const raw = localStorage.getItem(OLD);
    if (!raw) return;
    const d = JSON.parse(raw) as Design;
    const p = d.pages[0];
    await putDesign(d, { id: d.id, title: d.title, updated: Date.now(), thumb, w: p.width, h: p.height });
    localStorage.removeItem(OLD);
  } catch { /* leave it in place; nothing is lost */ }
};

const LAST = 'canva-lite:last';
export const lastId = () => { try { return localStorage.getItem(LAST); } catch { return null; } };
export const setLastId = (id: string) => { try { localStorage.setItem(LAST, id); } catch { /* storage blocked */ } };
