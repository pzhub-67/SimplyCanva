// Photo edit mode: iPhone-style sliders with a live preview that only sticks when you press Done,
// plus built-in looks and your own saved presets (Lightroom-style, with an Amount slider).
import { fabric } from 'fabric';
import { makeAdjustFilter } from './adjust';
import { initCropper, renderCropped } from './crop';
import { ADJ, AdjKey, BUILTIN, PhotoEdit, Preset, effective, isEdited, isNeutral } from './photoModel';

// `orig` holds the untouched photo once a crop has been applied, so the crop can be re-edited or undone.
export type PhotoImage = fabric.Image & { edit?: PhotoEdit; orig?: { src: string } };
interface Deps { c: fabric.Canvas; commit: () => void; toast: (msg: string) => void; pageRatio: () => number }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const all = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

// --- user presets ----------------------------------------------------------
// shortcut: presets live in this browser's localStorage. Sync them to the account when accounts exist.
const PKEY = 'canva-lite:presets';
let mine: Preset[] = (() => { try { return JSON.parse(localStorage.getItem(PKEY) ?? '[]'); } catch { return []; } })();
const saveMine = () => { try { localStorage.setItem(PKEY, JSON.stringify(mine)); } catch { /* storage blocked */ } };
const allPresets = () => BUILTIN.concat(mine);

export const applyEdit = (img: PhotoImage, e: PhotoEdit | undefined) => {
  const p = effective(e, allPresets());
  img.filters = isNeutral(p) ? [] : [makeAdjustFilter(p)];
  img.applyFilters();
};

const setSrc = (img: fabric.Image, url: string) => new Promise<void>(res => { img.setSrc(url, () => res()); });

export function initEditor({ c, commit, toast, pageRatio }: Deps) {
  const s = {
    img: null as PhotoImage | null, before: undefined as PhotoEdit | undefined, work: { adj: {} } as PhotoEdit, key: 'exposure' as AdjKey,
    baked: undefined as PhotoEdit['crop'], // crop currently applied to the pixels on canvas
    src0: '', orig0: undefined as PhotoImage['orig'], center0: new fabric.Point(0, 0), // state at open, for Cancel
  };
  const cropper = initCropper(pageRatio);
  let clip: PhotoEdit | undefined;
  let raf = 0;

  // Make the pixels on canvas match work.crop. The original is kept so a crop can be redone or removed.
  const syncGeometry = async () => {
    const img = s.img;
    if (!img || JSON.stringify(s.work.crop ?? null) === JSON.stringify(s.baked ?? null)) return;
    const center = img.getCenterPoint();
    if (s.work.crop) {
      const original = img.orig?.src ?? img.getSrc();
      const url = await renderCropped(original, s.work.crop);
      img.orig = img.orig ?? { src: original };
      await setSrc(img, url);
    } else if (img.orig) {
      await setSrc(img, img.orig.src);
      img.orig = undefined;
    }
    img.setPositionByOrigin(center, 'center', 'center'); img.setCoords();
    s.baked = clone(s.work.crop);
    render();
  };
  const leaveCrop = async () => {
    if (!cropper.isOpen()) return;
    s.work.crop = cropper.read();
    cropper.end();
    await syncGeometry();
  };

  const render = () => { if (s.img) { applyEdit(s.img, s.work); c.requestRenderAll(); } };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };

  // --- adjust tab ---
  const range = $<HTMLInputElement>('adj-range');
  $('dial').replaceChildren(...ADJ.map(a => {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = a.label; b.dataset.adj = a.key;
    b.onclick = () => { s.key = a.key; paint(); };
    return b;
  }));
  range.oninput = () => {
    const v = Number(range.value);
    if (v) s.work.adj[s.key] = v; else delete s.work.adj[s.key];
    paint(); schedule();
  };
  range.ondblclick = () => resetKey();
  const resetKey = () => { delete s.work.adj[s.key]; paint(); schedule(); };

  // --- filters / presets tabs ---
  const chip = (label: string, on: boolean, run: () => void) => {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = label; b.setAttribute('aria-pressed', String(on)); b.onclick = run;
    return b;
  };
  const pick = (id: string | undefined) => {
    if (id) s.work.filter = { id, amount: s.work.filter?.amount ?? 100 }; else delete s.work.filter;
    paint(); schedule();
  };
  const amount = $<HTMLInputElement>('amt-range');
  amount.oninput = () => { if (s.work.filter) s.work.filter.amount = Number(amount.value); paint(); schedule(); };

  const paintMine = () => {
    const rows = mine.map(p => {
      const row = document.createElement('div');
      row.className = 'prow';
      const name = document.createElement('input');
      name.value = p.name; name.setAttribute('aria-label', 'Preset name');
      name.onchange = () => { p.name = name.value.trim() || p.name; saveMine(); paint(); };
      const apply = document.createElement('button');
      apply.className = 'btn quiet'; apply.textContent = s.work.filter?.id === p.id ? 'On' : 'Apply';
      apply.onclick = () => pick(s.work.filter?.id === p.id ? undefined : p.id);
      const del = document.createElement('button');
      del.className = 'tool'; del.textContent = 'Delete'; del.setAttribute('aria-label', `Delete ${p.name}`);
      del.onclick = () => { mine = mine.filter(x => x.id !== p.id); if (s.work.filter?.id === p.id) delete s.work.filter; saveMine(); paint(); schedule(); };
      row.append(name, apply, del);
      return row;
    });
    $('mine').replaceChildren(...(rows.length ? rows : [Object.assign(document.createElement('p'), { className: 'muted', textContent: 'No saved looks yet. Adjust a photo, then save the look to reuse it.' })]));
  };

  // Redraw every control from the working edit.
  function paint() {
    const p = effective(s.work, allPresets());
    all('[data-adj]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.adj === s.key));
      b.classList.toggle('changed', (s.work.adj[b.dataset.adj as AdjKey] ?? 0) !== 0);
    });
    const meta = ADJ.find(a => a.key === s.key)!;
    $('adj-name').textContent = meta.label;
    range.min = s.key === 'noiseReduction' ? '0' : '-100';
    range.value = String(s.work.adj[s.key] ?? 0);
    $('adj-val').textContent = String(s.work.adj[s.key] ?? 0);
    $('filters').replaceChildren(
      chip('None', !s.work.filter, () => pick(undefined)),
      ...BUILTIN.map(f => chip(f.name, s.work.filter?.id === f.id, () => pick(f.id))),
    );
    $('amount').hidden = tab === 'adjust' || !s.work.filter;
    amount.value = String(s.work.filter?.amount ?? 100);
    $('amt-val').textContent = String(s.work.filter?.amount ?? 100);
    paintMine();
    $('ed-revert').toggleAttribute('disabled', !isEdited(s.work) && tab !== 'crop');
  }

  let tab = 'adjust';
  const showTab = async (name: string) => {
    if (tab === 'crop' && name !== 'crop') await leaveCrop();
    tab = name;
    all('[data-ed-tab]').forEach(t => t.setAttribute('aria-pressed', String(t.dataset.edTab === name)));
    all('[data-ed-panel]').forEach(p => { p.hidden = p.dataset.edPanel !== name; });
    paint();
    if (name === 'crop' && s.img) await cropper.begin(s.img.orig?.src ?? s.img.getSrc(), s.work.crop);
  };
  all('[data-ed-tab]').forEach(t => { t.onclick = () => { void showTab(t.dataset.edTab!); }; });

  // --- open / close ---
  const open = (img: PhotoImage) => {
    c.discardActiveObject();
    c.skipTargetFind = true; c.selection = false;
    s.img = img; s.before = clone(img.edit); s.work = clone(img.edit) ?? { adj: {} };
    s.baked = clone(img.edit?.crop); s.src0 = img.getSrc(); s.orig0 = clone(img.orig); s.center0 = img.getCenterPoint();
    document.body.dataset.editing = '1';
    $('editor').hidden = false;
    tab = 'adjust';
    void showTab('adjust');
  };
  const close = () => {
    const img = s.img;
    s.img = null;
    delete document.body.dataset.editing;
    $('editor').hidden = true;
    c.skipTargetFind = false; c.selection = true;
    if (img) { c.setActiveObject(img); c.requestRenderAll(); }
  };
  const norm = (e?: PhotoEdit) => JSON.stringify(isEdited(e) ? e : null);

  $('ed-done').onclick = async () => {
    const img = s.img;
    if (!img) return;
    await leaveCrop();
    await syncGeometry();
    const changed = norm(s.work) !== norm(s.before);
    img.edit = isEdited(s.work) ? clone(s.work) : undefined;
    render(); close();
    if (changed) commit();
  };
  $('ed-cancel').onclick = async () => {
    const img = s.img;
    if (!img) return;
    cropper.end();
    if (JSON.stringify(s.baked ?? null) !== JSON.stringify(s.before?.crop ?? null)) { // undo a crop applied during this session
      await setSrc(img, s.src0);
      img.orig = s.orig0;
      img.setPositionByOrigin(s.center0, 'center', 'center'); img.setCoords();
    }
    applyEdit(img, s.before); close();
  };
  $('ed-revert').onclick = () => {
    s.work = { adj: {} };
    if (cropper.isOpen()) cropper.reset(); else void syncGeometry();
    paint(); schedule();
    toast('Back to the original. Press Done to keep it, or Cancel.');
  };

  // Hold to compare with the original.
  const cmp = $('ed-compare');
  const hold = (on: boolean) => {
    if (!s.img) return;
    if (on) { s.img.filters = []; s.img.applyFilters(); c.requestRenderAll(); } else render();
  };
  cmp.onpointerdown = e => { e.preventDefault(); hold(true); };
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => cmp.addEventListener(ev, () => hold(false)));
  cmp.oncontextmenu = e => e.preventDefault();

  // Save the current look (sliders plus any preset) as a reusable preset.
  $('save-preset').onclick = () => {
    const input = $<HTMLInputElement>('preset-name');
    const p = effective(s.work, allPresets());
    if (isNeutral(p)) { toast('Adjust the photo first, then save the look.'); return; }
    const adj = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== 0));
    mine.push({ id: `u${Date.now().toString(36)}`, name: input.value.trim() || `My look ${mine.length + 1}`, adj });
    input.value = ''; saveMine(); paint(); toast('Look saved. Find it under Mine.');
  };
  $('adj-reset').onclick = resetKey;

  // --- copy / paste edits between photos ---
  // Sliders and looks travel between photos; a crop belongs to its own photo.
  const copyEdits = (img: PhotoImage) => {
    clip = { ...clone(img.edit), adj: clone(img.edit?.adj) ?? {}, crop: undefined };
    toast(isEdited(clip) ? 'Edits copied. Select photos and tap Paste edits.' : 'That photo has no adjustments to copy.');
  };
  const pasteEdits = (imgs: PhotoImage[]) => {
    if (!clip) { toast('Copy edits from a photo first.'); return; }
    imgs.forEach(img => {
      const next: PhotoEdit = { ...clone(clip!), crop: img.edit?.crop };
      img.edit = isEdited(next) ? next : undefined;
      applyEdit(img, img.edit);
    });
    c.requestRenderAll(); commit();
    toast(imgs.length > 1 ? `Pasted onto ${imgs.length} photos` : 'Edits pasted');
  };

  return { open, copyEdits, pasteEdits, isOpen: () => !!s.img };
}
