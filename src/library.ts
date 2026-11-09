// The photo library: photos you import live on this device in their own IndexedDB database, next to the designs.
// Each photo keeps three sizes (full ≤4096px for export, a ≤1600px working copy for editing, a small grid thumbnail)
// plus its edit as parameters. Everything is encrypted with the profile's passcode when it has one.
// Presets live here too, so a preset pack survives reloads (localStorage can be cleared or blocked in some viewers).
import { fabric } from 'fabric';
import { dbName } from './accounts';
import { makeAdjustFilter } from './adjust';
import { renderCropped } from './crop';
import type { CropParams } from './cropMath';
import { PhotoEdit, Preset, effective, isNeutral } from './photoModel';
import { Enc, getKey, isSealed, open as openEnc, openBytes, seal, sealBytes } from './vault';

export interface PhotoRec {
  id: string; name: string; added: number; updated: number;
  w: number; h: number; pw: number; ph: number; // full and working-copy pixel sizes
  thumb: string; edit?: PhotoEdit; pick?: boolean; taken?: number;
}
type Kind = 'full' | 'preview';
export const FULL_PX = 4096, PREVIEW_PX = 1600, THUMB_PX = 360;

let dbp: Promise<IDBDatabase | null> | null = null;
const db = () => (dbp ??= new Promise<IDBDatabase | null>(res => {
  try {
    const rq = indexedDB.open(`${dbName()}-photos`, 1);
    rq.onupgradeneeded = () => { for (const s of ['photos', 'files', 'kv']) rq.result.createObjectStore(s, { keyPath: 'id' }); };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = rq.onblocked = () => res(null);
  } catch { res(null); }
}));
const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx: IDBTransaction) => new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });
const need = async () => { const d = await db(); if (!d) throw new Error('Photo storage is not available in this browser.'); return d; };

// Records: plain, or { id, enc } when the profile has a passcode.
const wrap = async <T extends { id: string }>(v: T, k = getKey()) => (k ? { id: v.id, enc: await seal(v, k) } : v);
const unwrap = async <T,>(r: unknown, k = getKey()): Promise<T | undefined> => (r === undefined ? undefined : isSealed(r) ? openEnc<T>(r.enc, k) : (r as T));
// Files: { id, bytes, type } plain, or { id, enc, type } encrypted. Raw bytes, not Blobs: WebKit (Safari) can refuse
// to store Blobs in IndexedDB, but every browser stores an ArrayBuffer. Older { id, blob } rows still read.
const wrapFile = async (id: string, blob: Blob, k = getKey()) => {
  const bytes = await blob.arrayBuffer();
  return k ? { id, enc: await sealBytes(bytes, k), type: blob.type } : { id, bytes, type: blob.type };
};
const unwrapFile = async (r: { id: string; blob?: Blob; bytes?: ArrayBuffer; enc?: Enc; type?: string } | undefined, k = getKey()) => {
  if (!r) return undefined;
  if (r.enc) return new Blob([await openBytes(r.enc, k)], { type: r.type || 'image/jpeg' });
  return r.bytes ? new Blob([r.bytes], { type: r.type || 'image/jpeg' }) : r.blob;
};

export const listPhotos = async (): Promise<PhotoRec[]> => {
  const d = await db();
  if (!d) return [];
  const raw = await req<unknown[]>(d.transaction('photos').objectStore('photos').getAll());
  const rows = (await Promise.all(raw.map(r => unwrap<PhotoRec>(r).catch(() => undefined)))).filter((r): r is PhotoRec => !!r);
  return rows.sort((a, b) => b.added - a.added);
};
export const putPhoto = async (rec: PhotoRec) => {
  const d = await need();
  const w = await wrap(rec);
  const tx = d.transaction('photos', 'readwrite'); tx.objectStore('photos').put(w); await done(tx);
};
export const getFile = async (id: string, kind: Kind) => {
  const d = await need();
  const b = await unwrapFile(await req(d.transaction('files').objectStore('files').get(`${id}:${kind}`)));
  if (!b) throw new Error('missing photo');
  return b;
};
export const deletePhotos = async (ids: string[]) => {
  const d = await need();
  const tx = d.transaction(['photos', 'files'], 'readwrite');
  for (const id of ids) { tx.objectStore('photos').delete(id); tx.objectStore('files').delete(`${id}:full`); tx.objectStore('files').delete(`${id}:preview`); }
  await done(tx);
};

// --- importing -------------------------------------------------------------------
const toBlob = (cv: HTMLCanvasElement, q: number) => new Promise<Blob>((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', q));
const scaled = (src: CanvasImageSource, w: number, h: number, max: number) => {
  const k = Math.min(1, max / Math.max(w, h));
  const cv = Object.assign(document.createElement('canvas'), { width: Math.round(w * k), height: Math.round(h * k) });
  cv.getContext('2d')!.drawImage(src, 0, 0, cv.width, cv.height);
  return cv;
};
const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const addPhoto = async (file: File): Promise<PhotoRec> => {
  const bmp = await createImageBitmap(file); // applies EXIF rotation
  const full = scaled(bmp, bmp.width, bmp.height, FULL_PX), prev = scaled(full, full.width, full.height, PREVIEW_PX), th = scaled(prev, prev.width, prev.height, THUMB_PX);
  bmp.close?.();
  const id = newId(), now = Date.now();
  const rec: PhotoRec = { id, name: file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Photo', added: now, updated: now, taken: file.lastModified || undefined,
    w: full.width, h: full.height, pw: prev.width, ph: prev.height, thumb: th.toDataURL('image/jpeg', 0.78) };
  const [fb, pb] = await Promise.all([toBlob(full, 0.92), toBlob(prev, 0.9)]);
  const d = await need();
  const [fr, pr, rr] = await Promise.all([wrapFile(`${id}:full`, fb), wrapFile(`${id}:preview`, pb), wrap(rec)]);
  const tx = d.transaction(['photos', 'files'], 'readwrite');
  tx.objectStore('files').put(fr); tx.objectStore('files').put(pr); tx.objectStore('photos').put(rr);
  await done(tx);
  return rec;
};

// --- rendering an edited photo -------------------------------------------------------
export const blobUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
export const scaleCrop = (c: CropParams, k: number): CropParams => ({ ...c, rect: { x: c.rect.x * k, y: c.rect.y * k, w: c.rect.w * k, h: c.rect.h * k } });
const loadFabric = (url: string) => new Promise<fabric.Image>((res, rej) => fabric.Image.fromURL(url, im => (im?.width ? res(im) : rej(new Error('load failed')))));

// Fabric's WebGL filter backend is 2048px. Full-size exports borrow a larger one for the render, then drop it,
// so everyday editing keeps a small GPU footprint.
/* eslint-disable @typescript-eslint/no-explicit-any */
const F = fabric as any;
const exportCap = () => Math.min(FULL_PX, F.maxTextureSize || 2048);
const withBigBackend = async <T,>(fn: () => Promise<T>): Promise<T> => {
  const old = F.filterBackend ?? (F.filterBackend = F.initFilterBackend());
  const size = exportCap();
  if (!(old instanceof F.WebglFilterBackend) || size <= old.tileSize) return fn();
  const big = new F.WebglFilterBackend({ tileSize: size });
  F.filterBackend = big;
  try { return await fn(); } finally {
    F.filterBackend = old;
    try { big.dispose(); big.gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ }
  }
};
/* eslint-enable @typescript-eslint/no-explicit-any */

// The photo with its edit applied: the full size for export, or a small grid thumbnail.
export const renderEdited = async (rec: PhotoRec, edit: PhotoEdit | undefined, presets: Preset[], size: 'full' | 'thumb'): Promise<HTMLCanvasElement> => {
  const kind: Kind = size === 'full' ? 'full' : 'preview';
  let url = await blobUrl(await getFile(rec.id, kind));
  if (edit?.crop) url = await renderCropped(url, kind === 'full' ? scaleCrop(edit.crop, rec.w / rec.pw) : edit.crop);
  if (size === 'full') { // never hand the GPU more than it can take
    const probe = await loadFabric(url), cap = exportCap();
    if (Math.max(probe.width!, probe.height!) > cap) url = scaled(probe.getElement(), probe.width!, probe.height!, cap).toDataURL('image/jpeg', 0.95);
  }
  const run = async () => {
    const im = await loadFabric(url);
    const p = effective(edit, presets);
    im.filters = isNeutral(p) ? [] : [makeAdjustFilter(p)];
    im.applyFilters();
    const el = im.getElement() as unknown as HTMLCanvasElement;
    return scaled(el, el.width, el.height, size === 'thumb' ? THUMB_PX : FULL_PX);
  };
  return size === 'full' ? withBigBackend(run) : run();
};
export const exportJpeg = async (rec: PhotoRec, presets: Preset[], edit = rec.edit) => toBlob(await renderEdited(rec, edit, presets, 'full'), 0.92);
export const refreshThumb = async (rec: PhotoRec, presets: Preset[]) => { rec.thumb = (await renderEdited(rec, rec.edit, presets, 'thumb')).toDataURL('image/jpeg', 0.78); };

// --- presets (one record) ------------------------------------------------------------
export const loadPresetList = async (): Promise<unknown[] | null> => {
  const d = await db();
  if (!d) return null;
  const v = await unwrap<{ id: string; list: unknown[] }>(await req(d.transaction('kv').objectStore('kv').get('presets'))).catch(() => undefined);
  return v ? v.list : null;
};
export const savePresetList = async (list: unknown[]) => {
  const d = await db();
  if (!d) return false;
  const tx = d.transaction('kv', 'readwrite'); tx.objectStore('kv').put(await wrap({ id: 'presets', list })); await done(tx);
  return true;
};

// Passcode added, changed or removed: everything in the library is rewritten under the new key.
export const reencryptLibrary = async (oldKey: CryptoKey | null, newKey: CryptoKey | null) => {
  const d = await db();
  if (!d) return;
  const out: Record<'photos' | 'files' | 'kv', unknown[]> = { photos: [], files: [], kv: [] };
  for (const s of ['photos', 'kv'] as const) {
    for (const r of await req<unknown[]>(d.transaction(s).objectStore(s).getAll())) { const v = await unwrap<{ id: string }>(r, oldKey); if (v) out[s].push(await wrap(v, newKey)); }
  }
  for (const r of await req<{ id: string }[]>(d.transaction('files').objectStore('files').getAll())) {
    const b = await unwrapFile(r, oldKey);
    if (b) out.files.push(await wrapFile(r.id, b, newKey));
  }
  const tx = d.transaction(['photos', 'files', 'kv'], 'readwrite');
  (['photos', 'files', 'kv'] as const).forEach(s => out[s].forEach(r => tx.objectStore(s).put(r)));
  await done(tx);
};
