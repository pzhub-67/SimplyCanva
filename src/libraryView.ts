// The Photos screen: a Lightroom-style grid of your imported photos. Tap a photo to edit it; Select to pick several and
// flag, apply a preset, copy/paste settings, save JPGs or put them into a design. Presets can be managed from here too.
import { saveFile } from './download';
import { allPresets, getPresets, presetGroupOf, setPresets } from './editor';
import { PhotoRec, addPhoto, deletePhotos, exportJpeg, listPhotos, persistent, putPhoto, refreshThumb } from './library';
import { PhotoEdit, Preset, isEdited } from './photoModel';
import { importPresetFiles, makeZip, presetsZip } from './xmp';

interface Deps { open: (rec: PhotoRec) => void; addToDesign: (recs: PhotoRec[]) => void; toast: (msg: string) => void; back: () => void }
type Filter = 'all' | 'picks' | 'edited';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}) => Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];
const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const safe = (s: string) => s.replace(/&/g, 'and').replace(/[^\w\- ]+/g, '').replace(/\s+/g, ' ').trim() || 'photo';

export function initLibrary({ open, addToDesign, toast, back }: Deps) {
  let photos: PhotoRec[] = [];
  let filter: Filter = 'all';
  let sel: Set<string> | null = null; // null = not selecting
  let clip: PhotoEdit | null = null;
  let sheet: 'apply' | 'manage' | null = null;

  const shown = () => photos.filter(p => filter === 'all' || (filter === 'picks' ? p.pick : isEdited(p.edit)));
  const chosen = () => photos.filter(p => sel?.has(p.id));

  const render = () => {
    const list = shown();
    $('lib-grid').replaceChildren(...list.map(p => {
      const b = el('button', { className: 'lcell' });
      b.setAttribute('aria-label', `${p.name}${p.pick ? ', picked' : ''}${isEdited(p.edit) ? ', edited' : ''}`);
      if (sel) b.setAttribute('aria-pressed', String(sel.has(p.id)));
      b.append(el('img', { src: p.thumb, alt: '' }));
      if (p.pick) b.append(el('span', { className: 'flag', textContent: '⚑' }));
      if (isEdited(p.edit)) b.append(el('span', { className: 'dot' }));
      const pre = p.edit?.filter && allPresets().find(x => x.id === p.edit!.filter!.id);
      if (pre) b.append(el('span', { className: 'ptag', textContent: pre.name }));
      b.onclick = () => {
        if (!sel) { open(p); return; }
        if (sel.has(p.id)) sel.delete(p.id); else sel.add(p.id);
        render();
      };
      // Press and hold (a long, still press) starts selecting. A firm tap must still open the photo.
      let t = 0, x0 = 0, y0 = 0;
      b.onpointerdown = e => { x0 = e.clientX; y0 = e.clientY; t = window.setTimeout(() => { if (!sel) { sel = new Set([p.id]); render(); b.dataset.held = '1'; navigator.vibrate?.(15); } }, 700); };
      b.onpointermove = e => { if (Math.hypot(e.clientX - x0, e.clientY - y0) > 10) clearTimeout(t); };
      b.onpointerup = b.onpointerleave = b.onpointercancel = () => clearTimeout(t);
      b.addEventListener('click', e => { if (b.dataset.held) { e.stopImmediatePropagation(); delete b.dataset.held; } }, true);
      return b;
    }));
    const n = photos.length;
    $('lib-count').textContent = sel ? `${sel.size} selected` : `${list.length} photo${list.length === 1 ? '' : 's'}`;
    $('lib-empty').hidden = n > 0;
    $('lib-empty-filter').hidden = !(n > 0 && !list.length);
    document.querySelectorAll<HTMLElement>('[data-lib-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.libFilter === filter)));
    $('lib-select').textContent = sel ? 'Done' : 'Select';
    $('lib-select').hidden = !n;
    $('lib-actions').hidden = !sel;
    const k = sel?.size ?? 0;
    document.querySelectorAll<HTMLButtonElement>('#lib-actions [data-lib-act]').forEach(b => {
      const a = b.dataset.libAct!;
      b.disabled = a === 'all' ? false : a === 'copy' ? k !== 1 : a === 'paste' ? !k || !clip : !k;
    });
    $('lib-pick').textContent = k && chosen().every(p => p.pick) ? 'Unflag' : 'Flag';
    paintSheet();
  };

  const refresh = async () => { photos = await listPhotos(); render(); };
  const show = async () => {
    $('library').hidden = false;
    try { localStorage.setItem('canva-lite:view', 'photos'); } catch { /* ignore */ }
    await refresh();
  };
  const hide = () => { $('library').hidden = true; sel = null; sheet = null; };

  // Write edits to several photos and refresh their thumbnails.
  const apply = async (recs: PhotoRec[], fn: (r: PhotoRec) => void, msg: string) => {
    const ps = allPresets();
    let failed = 0;
    for (const r of recs) {
      fn(r); r.updated = Date.now();
      try { await refreshThumb(r, ps); } catch (e) { failed++; console.error('thumb', e); }
      await putPhoto(r);
    }
    sel = null; // done: back to the grid, so a tap opens a photo again
    render();
    toast(failed ? `${msg} ${failed} preview${failed === 1 ? '' : 's'} could not be redrawn; open the photo to see it.` : `${msg} Tap a photo to see it.`);
  };

  $<HTMLInputElement>('lib-add').onchange = async e => {
    const input = e.target as HTMLInputElement, files = [...(input.files ?? [])].filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|avif|gif)$/i.test(f.name));
    input.value = '';
    if (!files.length) { toast(input.files?.length ? 'Those files are not photos.' : 'No photos were chosen.'); return; }
    let ok = 0, bad = 0, why = '';
    filter = 'all'; // new photos must be visible
    for (const f of files) {
      $('lib-count').textContent = `Importing ${ok + bad + 1} of ${files.length}…`;
      try { photos.unshift(await addPhoto(f)); ok++; } catch (err) { bad++; why = (err as Error)?.message || String(err); console.error('import', f.name, f.type, f.size, err); }
      render();
    }
    const kept = await persistent();
    toast(bad ? `Added ${ok} of ${files.length}. ${bad} failed: ${why}.` : `Added ${ok} photo${ok === 1 ? '' : 's'}.${kept ? '' : ' This view cannot store photos, so they last until you close it.'}`);
  };
  document.querySelectorAll<HTMLElement>('[data-lib-filter]').forEach(b => { b.onclick = () => { filter = b.dataset.libFilter as Filter; render(); }; });
  $('lib-select').onclick = () => { sel = sel ? null : new Set(); render(); };
  $('lib-back').onclick = () => { try { localStorage.setItem('canva-lite:view', 'design'); } catch { /* ignore */ } hide(); back(); };
  $('lib-presets').onclick = () => { sheet = sheet === 'manage' ? null : 'manage'; render(); };

  const acts: Record<string, () => void | Promise<void>> = {
    all: () => { const ids = shown().map(p => p.id); sel = sel && sel.size === ids.length ? new Set() : new Set(ids); render(); },
    pick: async () => { const on = !chosen().every(p => p.pick); for (const r of chosen()) { r.pick = on || undefined; await putPhoto(r); } render(); },
    preset: () => { sheet = sheet === 'apply' ? null : 'apply'; render(); },
    copy: () => { const r = chosen()[0]; clip = r?.edit ? { ...clone(r.edit), crop: undefined } : null; toast(clip && isEdited(clip) ? 'Settings copied. Select photos and Paste.' : 'That photo has no edits to copy.'); render(); },
    paste: () => apply(chosen(), r => { const next: PhotoEdit = { ...clone(clip!), crop: r.edit?.crop }; r.edit = isEdited(next) ? next : undefined; }, `Pasted onto ${chosen().length} photo${chosen().length === 1 ? '' : 's'}.`),
    save: async () => {
      const list = chosen(), ps = allPresets();
      toast(`Rendering ${list.length} photo${list.length === 1 ? '' : 's'}…`);
      try {
        if (list.length === 1) { await report(await saveFile(`${safe(list[0].name)}.jpg`, await exportJpeg(list[0], ps))); return; }
        const used = new Set<string>(), files: { name: string; data: Uint8Array }[] = [];
        for (const r of list) { let n = safe(r.name), i = 2; while (used.has(n)) n = `${safe(r.name)} ${i++}`; used.add(n); files.push({ name: `${n}.jpg`, data: new Uint8Array(await (await exportJpeg(r, ps)).arrayBuffer()) }); }
        await report(await saveFile('SimplyCanva photos.zip', new Blob([makeZip(files) as BlobPart], { type: 'application/zip' })));
      } catch { toast('Could not render that photo.'); }
    },
    design: () => { const l = chosen(); sel = null; hide(); addToDesign(l); },
    del: async () => {
      const b = $('lib-del');
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = `Delete ${sel?.size}?`; setTimeout(() => { delete b.dataset.sure; b.textContent = 'Delete'; }, 4000); return; }
      delete b.dataset.sure; b.textContent = 'Delete';
      const ids = [...(sel ?? [])];
      await deletePhotos(ids); photos = photos.filter(p => !ids.includes(p.id)); sel = new Set(); render();
      toast(`Deleted ${ids.length} photo${ids.length === 1 ? '' : 's'} from this device.`);
    },
  };
  const report = async (r: string) => { toast(r === 'saved' ? 'Saved.' : r === 'declined' ? 'Not saved.' : 'Saving files is not available here.'); };
  document.querySelectorAll<HTMLButtonElement>('#lib-actions [data-lib-act]').forEach(b => { b.onclick = () => void acts[b.dataset.libAct!](); });

  // --- presets sheet: apply to the selection, or manage (import, rename, export, delete) ---
  const grouped = () => {
    const m = new Map<string, Preset[]>();
    for (const p of allPresets()) { const g = presetGroupOf(p); m.set(g, [...(m.get(g) ?? []), p]); }
    return m;
  };
  function paintSheet() {
    const box = $('lib-sheet');
    box.hidden = !sheet;
    if (!sheet) return;
    $('lib-sheet-h').textContent = sheet === 'apply' ? `Apply a preset to ${sel?.size ?? 0} photo${sel?.size === 1 ? '' : 's'}` : 'Presets';
    $('lib-sheet-tools').hidden = sheet !== 'manage';
    const rows: HTMLElement[] = [];
    if (sheet === 'apply') rows.push(el('button', { className: 'opt', textContent: 'None (remove preset)', onclick: () => void applyPreset(undefined) }));
    for (const [g, list] of grouped()) {
      if (sheet === 'manage' && g === 'Built-in') continue;
      rows.push(el('h3', { className: 'ed-sub', textContent: `${g} (${list.length})` }));
      for (const p of list) {
        if (sheet === 'apply') { rows.push(el('button', { className: 'opt', textContent: p.name, onclick: () => void applyPreset(p) })); continue; }
        const row = el('div', { className: 'prow' });
        const name = el('input', { value: p.name });
        name.setAttribute('aria-label', 'Preset name');
        name.onchange = () => { p.name = name.value.trim().slice(0, 80) || p.name; setPresets(getPresets()); };
        row.append(name,
          el('button', { className: 'tool', textContent: 'Export', onclick: () => void exportPresets([p], p.name) }),
          el('button', { className: 'tool', textContent: 'Delete', onclick: () => { setPresets(getPresets().filter(x => x.id !== p.id)); paintSheet(); } }));
        rows.push(row);
      }
    }
    if (sheet === 'manage' && !getPresets().length) rows.push(el('p', { className: 'muted', textContent: 'No presets of your own yet. Import Lightroom presets (.xmp, .lrtemplate or a .zip pack), or save a look while editing.' }));
    $('lib-sheet-list').replaceChildren(...rows);
  }
  const applyPreset = (p: Preset | undefined) => {
    const list = chosen();
    sheet = null;
    return apply(list, r => {
      const next: PhotoEdit = { ...(r.edit ?? { adj: {} }) };
      if (p) next.filter = { id: p.id, amount: 100 }; else delete next.filter;
      r.edit = isEdited(next) ? next : undefined;
    }, p ? `Applied ${p.name} to ${list.length} photo${list.length === 1 ? '' : 's'}.` : 'Preset removed.');
  };
  const exportPresets = async (list: Preset[], name: string) => {
    if (!list.length) { toast('No presets of your own to export yet.'); return; }
    await report(await saveFile(`${safe(name)}.zip`, new Blob([presetsZip(list) as BlobPart], { type: 'application/zip' })));
  };
  $('lib-pexport').onclick = () => void exportPresets(getPresets(), 'SimplyCanva presets');
  $('lib-sheet-close').onclick = () => { sheet = null; render(); };
  $<HTMLInputElement>('lib-pimport').onchange = async e => {
    const input = e.target as HTMLInputElement, files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    const r = await importPresetFiles(files);
    if (!r.presets.length) { toast('No Lightroom presets found in that file.'); return; }
    const mine = getPresets();
    for (const p of r.presets) { const i = mine.findIndex(x => x.name === p.name && (x.group ?? '') === (p.group ?? '')); if (i >= 0) mine[i] = p; else mine.push(p); }
    setPresets(mine); paintSheet();
    toast(`Imported ${r.presets.length} preset${r.presets.length === 1 ? '' : 's'}.${r.skipped.length ? ` Left out (not supported): ${r.skipped.join(', ')}.` : ''}`);
  };

  return { show, hide, refresh, isOpen: () => !$('library').hidden };
}
