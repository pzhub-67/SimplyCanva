// The Photos screen, like Lightroom mobile's library: albums, a grid with flags and star ratings, search, sort and filters,
// a full-screen viewer you swipe through (rate, flag, info, Edit, Export), multi-select batch actions (flag, rate, add to
// album, apply a preset, copy/paste settings, export, put into a design, delete) and preset management.
import { saveFile } from './download';
import { allPresets, getClip, getPresets, mergePresets, pasteInto, presetGroupOf, setClip, setPresets } from './editor';
import { Album, ExportOpts, PhotoRec, addPhoto, deletePhotos, exportImage, listPhotos, loadAlbums, persistent, putPhoto, refreshThumb, saveAlbums, viewUrl } from './library';
import { BUILTIN, GROUPS, Preset, applyPreset as presetOnto, isEdited, isNeutralDev, migrateEdit } from './photoModel';
import { importPresetFiles, makeZip, presetsZip } from './xmp';

interface Deps { open: (rec: PhotoRec) => void; addToDesign: (recs: PhotoRec[]) => void; toast: (msg: string) => void; back: () => void }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}) => Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];
const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const safe = (s: string) => s.replace(/&/g, 'and').replace(/[^\w\- ]+/g, '').replace(/\s+/g, ' ').trim() || 'photo';
const plural = (n: number, w = 'photo') => `${n} ${w}${n === 1 ? '' : 's'}`;
const stars = (n = 0) => '★'.repeat(n);

export function initLibrary({ open, addToDesign, toast, back }: Deps) {
  let photos: PhotoRec[] = [];
  let albums: Album[] = [];
  let album = ''; // '' = All Photos
  let sel: Set<string> | null = null;
  let sheet: 'apply' | 'manage' | 'rate' | 'album' | null = null;
  let loupeId: string | null = null;
  let exportList: PhotoRec[] = [];

  // --- what the grid shows --------------------------------------------------------------
  const shown = () => {
    const q = $<HTMLInputElement>('lib-search').value.trim().toLowerCase();
    const flag = $<HTMLSelectElement>('lf-flag').value, minR = Number($<HTMLSelectElement>('lf-rating').value), ed = $<HTMLSelectElement>('lf-edit').value;
    const sort = $<HTMLSelectElement>('lib-sort').value;
    const l = photos.filter(p => (!album || p.albums?.includes(album)) && (!q || p.name.toLowerCase().includes(q))
      && (!flag || (flag === 'none' ? !p.flag : p.flag === flag)) && (p.rating ?? 0) >= minR
      && (!ed || (ed === 'edited') === isEdited(p.edit)));
    const by: Record<string, (a: PhotoRec, b: PhotoRec) => number> = {
      added: (a, b) => b.added - a.added, taken: (a, b) => (b.taken ?? b.added) - (a.taken ?? a.added), name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
      rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.added - a.added, updated: (a, b) => b.updated - a.updated,
    };
    return l.sort(by[sort] ?? by.added);
  };
  const chosen = () => photos.filter(p => sel?.has(p.id));
  const filtering = () => !!($<HTMLSelectElement>('lf-flag').value || $<HTMLSelectElement>('lf-rating').value !== '0' || $<HTMLSelectElement>('lf-edit').value);

  const render = () => {
    const list = shown();
    $('lib-grid').replaceChildren(...list.map(p => {
      const b = el('button', { className: `lcell${p.flag === 'reject' ? ' rejected' : ''}` });
      b.setAttribute('aria-label', `${p.name}${p.flag === 'pick' ? ', picked' : p.flag === 'reject' ? ', rejected' : ''}${p.rating ? `, ${p.rating} stars` : ''}${isEdited(p.edit) ? ', edited' : ''}`);
      if (sel) b.setAttribute('aria-pressed', String(sel.has(p.id)));
      b.append(el('img', { src: p.thumb, alt: '' }));
      if (p.flag === 'pick') b.append(el('span', { className: 'flag', textContent: '⚑' }));
      if (p.flag === 'reject') b.append(el('span', { className: 'rej', textContent: '✕' }));
      if (p.rating && !sel) b.append(el('span', { className: 'stars', textContent: stars(p.rating) }));
      if (isEdited(p.edit)) b.append(el('span', { className: 'dot' }));
      if (p.look && isEdited(p.edit)) b.append(el('span', { className: 'ptag', textContent: p.look }));
      b.onclick = () => {
        if (!sel) { showLoupe(p.id); return; }
        if (sel.has(p.id)) sel.delete(p.id); else sel.add(p.id);
        render();
      };
      // Press and hold (a long, still press) starts selecting; a firm tap still opens the photo.
      let t = 0, x0 = 0, y0 = 0;
      b.onpointerdown = e => { x0 = e.clientX; y0 = e.clientY; t = window.setTimeout(() => { if (!sel) { sel = new Set([p.id]); render(); b.dataset.held = '1'; navigator.vibrate?.(15); } }, 700); };
      b.onpointermove = e => { if (Math.hypot(e.clientX - x0, e.clientY - y0) > 10) clearTimeout(t); };
      b.onpointerup = b.onpointerleave = b.onpointercancel = () => clearTimeout(t);
      b.addEventListener('click', e => { if (b.dataset.held) { e.stopImmediatePropagation(); delete b.dataset.held; } }, true);
      return b;
    }));
    const n = photos.length;
    $('lib-title').textContent = album ? albums.find(a => a.id === album)?.name ?? 'Album' : 'All Photos';
    $('lib-count').textContent = sel ? `${sel.size} selected` : plural(list.length);
    $('lib-empty').hidden = n > 0;
    $('lib-empty-filter').hidden = !(n > 0 && !list.length);
    $('lib-select').textContent = sel ? 'Done' : 'Select';
    $('lib-select').hidden = !n;
    $('lib-filter-btn').classList.toggle('changed', filtering());
    $('lib-albums').replaceChildren(
      ...[{ id: '', name: `All Photos (${n})` }, ...albums.map(a => ({ id: a.id, name: `${a.name} (${photos.filter(p => p.albums?.includes(a.id)).length})` }))].map(a => {
        const c = el('button', { className: 'chip', textContent: a.name, onclick: () => { album = a.id; sel = null; render(); } });
        c.setAttribute('aria-pressed', String(album === a.id));
        return c;
      }),
      el('button', { className: 'chip', textContent: '+ Album', onclick: () => void newAlbum() }),
    );
    $('lib-actions').hidden = !sel;
    const k = sel?.size ?? 0;
    document.querySelectorAll<HTMLButtonElement>('#lib-actions [data-lib-act]').forEach(b => {
      const a = b.dataset.libAct!;
      b.disabled = a === 'all' ? false : a === 'copy' ? k !== 1 : a === 'paste' ? !k || !getClip() : !k;
    });
    paintSheet();
  };

  const refresh = async () => {
    [photos, albums] = await Promise.all([listPhotos(), loadAlbums().catch(() => [])]);
    for (const p of photos) {
      p.edit = migrateEdit(p.edit, allPresets()); // older edits become Lightroom settings
      if (p.pick && !p.flag) { p.flag = 'pick'; delete p.pick; }
    }
    render();
    if (loupeId) void paintLoupe();
  };
  // Show the library; with an id, open that photo in the viewer (coming back from editing it).
  const show = async (id?: string) => {
    $('library').hidden = false;
    try { localStorage.setItem('canva-lite:view', 'photos'); } catch { /* ignore */ }
    loupeId = id ?? loupeId;
    $('loupe').hidden = !loupeId;
    await refresh();
  };
  const hide = () => { $('library').hidden = true; sel = null; sheet = null; loupeId = null; $('loupe').hidden = true; };

  const save = async (recs: PhotoRec[], fn: (r: PhotoRec) => void, msg?: string) => {
    for (const r of recs) { fn(r); await putPhoto(r); }
    render(); if (loupeId) void paintLoupe(false);
    if (msg) toast(msg);
  };
  // Write edits to several photos and refresh their thumbnails.
  const applyEdits = async (recs: PhotoRec[], fn: (r: PhotoRec) => void, msg: string) => {
    let failed = 0;
    for (const r of recs) {
      fn(r); r.updated = Date.now();
      try { await refreshThumb(r); } catch (e) { failed++; console.error('thumb', e); }
      await putPhoto(r);
    }
    sel = null; render();
    toast(failed ? `${msg} ${failed} preview${failed === 1 ? '' : 's'} could not be redrawn; open the photo to see it.` : `${msg} Tap a photo to see it.`);
  };

  // --- adding photos ----------------------------------------------------------------------------------
  $<HTMLInputElement>('lib-add').onchange = async e => {
    const input = e.target as HTMLInputElement, files = [...(input.files ?? [])].filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|avif|gif)$/i.test(f.name));
    input.value = '';
    if (!files.length) { toast(input.files?.length ? 'Those files are not photos.' : 'No photos were chosen.'); return; }
    let ok = 0, bad = 0, why = '';
    $<HTMLInputElement>('lib-search').value = '';
    for (const f of files) {
      $('lib-count').textContent = `Importing ${ok + bad + 1} of ${files.length}…`;
      try { const r = await addPhoto(f); if (album) { r.albums = [album]; await putPhoto(r); } photos.unshift(r); ok++; } catch (err) { bad++; why = (err as Error)?.message || String(err); console.error('import', f.name, f.type, f.size, err); }
      render();
    }
    const kept = await persistent();
    toast(bad ? `Added ${ok} of ${files.length}. ${bad} failed: ${why}.` : `Added ${plural(ok)}.${kept ? '' : ' This view cannot store photos, so they last until you close it.'}${filtering() ? ' Some may be hidden by the filter.' : ''}`);
  };
  $('lib-search').oninput = () => render();
  $('lib-sort').onchange = () => render();
  ['lf-flag', 'lf-rating', 'lf-edit'].forEach(id => { $(id).onchange = () => render(); });
  $('lib-filter-btn').onclick = () => { const o = $('lib-filters').hidden; $('lib-filters').hidden = !o; $('lib-filter-btn').setAttribute('aria-expanded', String(o)); };
  $('lib-select').onclick = () => { sel = sel ? null : new Set(); render(); };
  $('lib-back').onclick = () => { try { localStorage.setItem('canva-lite:view', 'design'); } catch { /* ignore */ } hide(); back(); };
  $('lib-presets').onclick = () => { sheet = sheet === 'manage' ? null : 'manage'; render(); };

  const newAlbum = async (thenAdd?: PhotoRec[]) => {
    const name = window.prompt('Album name')?.trim().slice(0, 60);
    if (!name) return;
    const a = { id: `a${Date.now().toString(36)}`, name };
    albums.push(a); await saveAlbums(albums);
    if (thenAdd?.length) await save(thenAdd, r => { r.albums = [...new Set([...(r.albums ?? []), a.id])]; }, `Added ${plural(thenAdd.length)} to ${name}.`);
    else { album = a.id; render(); }
  };

  // --- batch actions -----------------------------------------------------------------------------------
  const acts: Record<string, () => void | Promise<void>> = {
    all: () => { const ids = shown().map(p => p.id); sel = sel && sel.size === ids.length ? new Set() : new Set(ids); render(); },
    pick: () => { const on = !chosen().every(p => p.flag === 'pick'); return save(chosen(), r => { r.flag = on ? 'pick' : undefined; }); },
    reject: () => { const on = !chosen().every(p => p.flag === 'reject'); return save(chosen(), r => { r.flag = on ? 'reject' : undefined; }); },
    rate: () => { sheet = sheet === 'rate' ? null : 'rate'; render(); },
    album: () => { sheet = sheet === 'album' ? null : 'album'; render(); },
    preset: () => { sheet = sheet === 'apply' ? null : 'apply'; render(); },
    copy: () => {
      const r = chosen()[0];
      const ok = !!r?.edit && !isNeutralDev(r.edit.dev);
      setClip(ok ? { dev: clone(r.edit!.dev), groups: GROUPS.map(g => g.id).filter(g => g !== 'crop') } : null);
      toast(ok ? 'Settings copied (everything but the crop). Select photos and Paste.' : 'That photo has no edits to copy.'); render();
    },
    paste: () => applyEdits(chosen(), r => { const next = pasteInto(r.edit ?? { dev: {} }, getClip()!); r.edit = isEdited(next) ? { dev: next.dev, ...(next.crop ? { crop: next.crop } : {}) } : undefined; r.look = undefined; }, `Pasted onto ${plural(chosen().length)}.`),
    save: () => openExport(chosen()),
    design: () => { const l = chosen(); sel = null; hide(); addToDesign(l); },
    del: async () => {
      const b = $('lib-del');
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = `Delete ${sel?.size}?`; setTimeout(() => { delete b.dataset.sure; b.textContent = 'Delete'; }, 4000); return; }
      delete b.dataset.sure; b.textContent = 'Delete';
      const ids = [...(sel ?? [])];
      await deletePhotos(ids); photos = photos.filter(p => !ids.includes(p.id)); sel = new Set(); render();
      toast(`Deleted ${plural(ids.length)} from this device.`);
    },
  };
  const report = (r: string) => { toast(r === 'saved' ? 'Saved.' : r === 'declined' ? 'Not saved.' : 'Saving files is not available here.'); };
  document.querySelectorAll<HTMLButtonElement>('#lib-actions [data-lib-act]').forEach(b => { b.onclick = () => void acts[b.dataset.libAct!](); });

  // --- sheet: presets (apply or manage), rating, album -------------------------------------------------------
  const grouped = () => {
    const m = new Map<string, Preset[]>();
    for (const p of allPresets()) { const g = presetGroupOf(p); m.set(g, [...(m.get(g) ?? []), p]); }
    return m;
  };
  function paintSheet() {
    const box = $('lib-sheet');
    box.hidden = !sheet;
    if (!sheet) return;
    const k = sel?.size ?? 0;
    $('lib-sheet-h').textContent = sheet === 'apply' ? `Apply a preset to ${plural(k)}` : sheet === 'rate' ? `Rate ${plural(k)}` : sheet === 'album' ? `Add ${plural(k)} to an album` : 'Presets';
    $('lib-sheet-tools').hidden = sheet !== 'manage';
    const rows: HTMLElement[] = [];
    if (sheet === 'rate') {
      for (let n = 0; n <= 5; n++) rows.push(el('button', { className: 'opt', textContent: n ? stars(n) : 'No rating', onclick: () => { sheet = null; void save(chosen(), r => { r.rating = n || undefined; }, n ? `Rated ${stars(n)}.` : 'Rating cleared.'); } }));
    } else if (sheet === 'album') {
      for (const a of albums) rows.push(el('button', { className: 'opt', textContent: a.name, onclick: () => { sheet = null; void save(chosen(), r => { r.albums = [...new Set([...(r.albums ?? []), a.id])]; }, `Added to ${a.name}.`); } }));
      rows.push(el('button', { className: 'opt', textContent: '+ New album…', onclick: () => { sheet = null; void newAlbum(chosen()); } }));
      if (album) rows.push(el('button', { className: 'opt', textContent: `Remove from ${albums.find(a => a.id === album)?.name ?? 'this album'}`, onclick: () => { sheet = null; void save(chosen(), r => { r.albums = r.albums?.filter(x => x !== album); }, 'Removed from the album.'); } }));
    } else {
      if (sheet === 'apply') rows.push(el('button', { className: 'opt', textContent: 'Clear all edits (keeps the crop)', onclick: () => void applyPreset(undefined) }));
      for (const [g, list] of grouped()) {
        if (sheet === 'manage' && list.every(p => BUILTIN.includes(p))) continue;
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
      if (sheet === 'manage' && !getPresets().length) rows.push(el('p', { className: 'muted', textContent: 'No presets of your own yet. Import Lightroom presets (.xmp, .lrtemplate or a .zip pack), or use ⋯ › Create preset while editing.' }));
    }
    $('lib-sheet-list').replaceChildren(...rows);
  }
  const applyPreset = (p: Preset | undefined) => {
    const list = chosen();
    sheet = null;
    return applyEdits(list, r => {
      const next = p ? presetOnto({ dev: r.edit?.dev ?? {} }, p, 100).dev : {}; // sets the settings it contains, keeps the rest
      r.edit = isNeutralDev(next) && !r.edit?.crop ? undefined : { dev: next, ...(r.edit?.crop ? { crop: r.edit.crop } : {}) };
      r.look = p?.name;
    }, p ? `Applied ${p.name} to ${plural(list.length)}.` : 'Edits cleared (crop kept).');
  };
  const exportPresets = async (list: Preset[], name: string) => {
    if (!list.length) { toast('No presets of your own to export yet.'); return; }
    report(await saveFile(`${safe(name)}.zip`, new Blob([presetsZip(list) as BlobPart], { type: 'application/zip' })));
  };
  $('lib-pexport').onclick = () => void exportPresets(getPresets(), 'SimplyCanva presets');
  $('lib-sheet-close').onclick = () => { sheet = null; render(); };
  $<HTMLInputElement>('lib-pimport').onchange = async e => {
    const input = e.target as HTMLInputElement, files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    const r = await importPresetFiles(files);
    if (!r.presets.length) { toast('No Lightroom presets found in that file.'); return; }
    mergePresets(r.presets); paintSheet();
    toast(`Imported ${plural(r.presets.length, 'preset')}.${r.skipped.length ? ` Left out (not supported): ${r.skipped.join(', ')}.` : ''}`);
  };

  // --- export dialog ----------------------------------------------------------------------------------------
  const openExport = (list: PhotoRec[]) => {
    exportList = list;
    $('lx-h').textContent = list.length === 1 ? `Export ${list[0].name}` : `Export ${plural(list.length)}`;
    $('lib-export').hidden = false;
    $('lx-q-row').hidden = $<HTMLSelectElement>('lx-format').value !== 'jpeg';
  };
  $('lx-format').onchange = () => { $('lx-q-row').hidden = $<HTMLSelectElement>('lx-format').value !== 'jpeg'; };
  $('lx-q').oninput = () => { $('lx-qv').textContent = $<HTMLInputElement>('lx-q').value; };
  $('lx-close').onclick = () => { $('lib-export').hidden = true; };
  $('lx-go').onclick = async () => {
    const o: ExportOpts = { format: $<HTMLSelectElement>('lx-format').value as ExportOpts['format'], longEdge: Number($<HTMLSelectElement>('lx-size').value), quality: Number($<HTMLInputElement>('lx-q').value) };
    const ext = o.format === 'png' ? 'png' : 'jpg', list = exportList;
    $('lib-export').hidden = true;
    toast(`Rendering ${plural(list.length)}…`);
    try {
      if (list.length === 1) { report(await saveFile(`${safe(list[0].name)}.${ext}`, await exportImage(list[0], o))); return; }
      const used = new Set<string>(), files: { name: string; data: Uint8Array }[] = [];
      for (const r of list) { let n = safe(r.name), i = 2; while (used.has(n)) n = `${safe(r.name)} ${i++}`; used.add(n); files.push({ name: `${n}.${ext}`, data: new Uint8Array(await (await exportImage(r, o)).arrayBuffer()) }); }
      report(await saveFile('SimplyCanva photos.zip', new Blob([makeZip(files) as BlobPart], { type: 'application/zip' })));
    } catch (e) { console.error('export', e); toast('Could not render that photo.'); }
  };

  // --- viewer (loupe): swipe through, rate, flag, info, edit, export -----------------------------------------
  const lpStars = $('lp-stars');
  lpStars.replaceChildren(...[1, 2, 3, 4, 5].map(n => {
    const b = el('button', { textContent: '★' });
    b.setAttribute('aria-label', `${n} star${n === 1 ? '' : 's'}`);
    b.onclick = () => { const r = cur(); if (r) void save([r], x => { x.rating = x.rating === n ? undefined : n; }); };
    return b;
  }));
  const cur = () => photos.find(p => p.id === loupeId);
  let viewSeq = 0;
  async function paintLoupe(reload = true) {
    const r = cur();
    if (!r) { closeLoupe(); return; }
    const list = shown(), i = list.findIndex(p => p.id === r.id);
    [...lpStars.children].forEach((b, k) => b.classList.toggle('on', (r.rating ?? 0) > k));
    $('lp-pick').setAttribute('aria-pressed', String(r.flag === 'pick'));
    $('lp-reject').setAttribute('aria-pressed', String(r.flag === 'reject'));
    $('lp-pos').textContent = i >= 0 ? `${i + 1} of ${list.length}` : '';
    $<HTMLButtonElement>('lp-prev').hidden = i <= 0; $<HTMLButtonElement>('lp-next').hidden = i < 0 || i >= list.length - 1;
    const date = (t?: number) => (t ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
    $('lp-meta').textContent = `${r.name} · ${r.w}×${r.h}${r.taken ? ` · taken ${date(r.taken)}` : ''} · added ${date(r.added)}${isEdited(r.edit) ? ` · edited${r.look ? ` (${r.look})` : ''}` : ''}`;
    if (!reload) return;
    const img = $<HTMLImageElement>('lp-img'), seq = ++viewSeq;
    img.src = r.thumb; img.alt = r.name; // the thumbnail at once, then the full view
    try { const u = await viewUrl(r); if (seq === viewSeq) img.src = u; } catch { /* keep the thumbnail */ }
  }
  const showLoupe = (id: string) => { loupeId = id; $('loupe').hidden = false; void paintLoupe(); };
  const closeLoupe = () => { loupeId = null; $('loupe').hidden = true; render(); };
  const step = (d: number) => { const list = shown(), i = list.findIndex(p => p.id === loupeId); const n = list[i + d]; if (n) { loupeId = n.id; void paintLoupe(); } };
  $('lp-back').onclick = closeLoupe;
  $('lp-prev').onclick = () => step(-1);
  $('lp-next').onclick = () => step(1);
  $('lp-pick').onclick = () => { const r = cur(); if (r) void save([r], x => { x.flag = x.flag === 'pick' ? undefined : 'pick'; }); };
  $('lp-reject').onclick = () => { const r = cur(); if (r) void save([r], x => { x.flag = x.flag === 'reject' ? undefined : 'reject'; }); };
  $('lp-info').onclick = () => { const o = $('lp-meta').hidden; $('lp-meta').hidden = !o; $('lp-info').setAttribute('aria-pressed', String(o)); };
  $('lp-edit').onclick = () => { const r = cur(); if (r) open(r); };
  $('lp-save').onclick = () => { const r = cur(); if (r) openExport([r]); };
  // swipe left/right between photos
  const stage = $('lp-stage');
  let sx = 0, sy = 0, swiping = false;
  stage.onpointerdown = e => { if ((e.target as HTMLElement).closest('button')) return; sx = e.clientX; sy = e.clientY; swiping = true; };
  stage.onpointerup = e => {
    if (!swiping) return; swiping = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  };
  stage.onpointercancel = () => { swiping = false; };
  document.addEventListener('keydown', e => {
    if ($('loupe').hidden || (e.target as HTMLElement).closest('input, select, textarea')) return;
    if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1);
    else if (/^[0-5]$/.test(e.key)) { const r = cur(); if (r) void save([r], x => { x.rating = Number(e.key) || undefined; }); }
    else if (e.key.toLowerCase() === 'p') $('lp-pick').click(); else if (e.key.toLowerCase() === 'x') $('lp-reject').click();
    else if (e.key === 'Escape') closeLoupe();
  });

  return { show, hide, refresh, isOpen: () => !$('library').hidden };
}
