import { fabric } from 'fabric';
import './style.css';
import { FONTS, loadFont } from './fonts';
import { Design, FabricJSON, fabricToPage, newDesign, pageToFabric } from './model';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const c = new fabric.Canvas('c', { backgroundColor: '#ffffff', preserveObjectStacking: true });
const DEFAULT_FONT = FONTS[0];
let design: Design = newDesign();

// --- fonts ---------------------------------------------------------------
const fontSel = $<HTMLSelectElement>('font');
fontSel.innerHTML = FONTS.map(f => `<option style="font-family:'${f}'">${f}</option>`).join('');

// Fabric caches text metrics, so remeasure once a font has arrived.
const refit = () => {
  fabric.util.clearFabricFontCache();
  c.getObjects().forEach(o => { if (o instanceof fabric.Text) { o.initDimensions(); o.setCoords(); } });
  c.requestRenderAll();
};
const ensureFonts = (families: string[]) => Promise.all([...new Set(families)].map(loadFont)).then(refit);
ensureFonts([DEFAULT_FONT]);

// --- history -------------------------------------------------------------
// shortcut: full-JSON snapshots, fine for small designs. Upgrade to diffs/patches when designs get heavy.
let hist: string[] = [], pos = -1, busy = false;
const snap = () => {
  if (busy) return;
  hist = hist.slice(0, pos + 1);
  hist.push(JSON.stringify(c.toJSON()));
  pos = hist.length - 1;
};
const restore = (i: number) => {
  if (i < 0 || i >= hist.length) return;
  busy = true; pos = i;
  c.loadFromJSON(hist[i], () => { busy = false; refit(); syncText(); });
};
['object:added', 'object:modified', 'object:removed'].forEach(e => c.on(e, snap));

// --- objects -------------------------------------------------------------
const fill = () => $<HTMLInputElement>('color').value;
const add = (o: fabric.Object) => { o.set({ left: 100, top: 100, fill: fill() }); c.add(o); c.setActiveObject(o); };
const del = () => { c.getActiveObjects().forEach(o => c.remove(o)); c.discardActiveObject().requestRenderAll(); };

// shortcut: canvas size is not part of history, so resizing isn't undoable.
const resize = (v: string) => { const [w, h] = v.split('x').map(Number); c.setDimensions({ width: w, height: h }); };
$<HTMLSelectElement>('size').onchange = e => resize((e.target as HTMLSelectElement).value);

$('color').oninput = e => {
  const o = c.getActiveObject();
  if (o) { o.set('fill', (e.target as HTMLInputElement).value); c.requestRenderAll(); }
};
$('color').onchange = snap;
$('bg').oninput = e => c.setBackgroundColor((e.target as HTMLInputElement).value, () => c.requestRenderAll());
$('bg').onchange = snap;

$<HTMLInputElement>('img').onchange = e => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    const r = new FileReader();
    r.onload = () => fabric.Image.fromURL(r.result as string, i => { i.scaleToWidth(300); c.add(i); c.setActiveObject(i); });
    r.readAsDataURL(file);
  }
  input.value = '';
};

// --- text ----------------------------------------------------------------
const textObj = () => { const o = c.getActiveObject(); return o instanceof fabric.IText ? o : undefined; };
const setText = (props: Record<string, unknown>) => { textObj()?.set(props); c.requestRenderAll(); snap(); };
const toggle = (key: 'fontWeight' | 'fontStyle' | 'underline', on: unknown) => {
  const o = textObj();
  if (o) setText({ [key]: o.get(key) === on ? (key === 'underline' ? false : 'normal') : on });
  syncText();
};

function syncText() {
  const o = textObj();
  $('textbar').hidden = !o;
  if (!o) return;
  fontSel.value = o.fontFamily ?? DEFAULT_FONT;
  $<HTMLInputElement>('fsize').value = String(Math.round(o.fontSize ?? 40));
}
['selection:created', 'selection:updated', 'selection:cleared'].forEach(e => c.on(e, syncText));

fontSel.onchange = async () => {
  const o = textObj();
  if (!o) return;
  await loadFont(fontSel.value);
  o.set('fontFamily', fontSel.value);
  refit(); snap();
};
$<HTMLInputElement>('fsize').onchange = e => setText({ fontSize: Number((e.target as HTMLInputElement).value) || 40 });

// --- save / load / export ------------------------------------------------
// shortcut: localStorage caps ~5MB so big images won't save. Move to file download or a backend when it bites.
const KEY = 'canva-lite:design';
const save = () => {
  design.pages[0] = fabricToPage(design.pages[0], c.toJSON() as unknown as FabricJSON, c.getWidth(), c.getHeight());
  localStorage.setItem(KEY, JSON.stringify(design));
};
const load = () => {
  const raw = localStorage.getItem(KEY);
  if (!raw) return;
  design = JSON.parse(raw) as Design;
  const page = design.pages[0];
  busy = true;
  c.setDimensions({ width: page.width, height: page.height });
  c.loadFromJSON(pageToFabric(page), async () => {
    busy = false;
    await ensureFonts(page.objects.map(o => o.fontFamily).filter((f): f is string => typeof f === 'string'));
    snap();
  });
  $<HTMLSelectElement>('size').value = `${page.width}x${page.height}`;
};
const exportPNG = () => {
  const a = document.createElement('a');
  a.href = c.toDataURL({ format: 'png', multiplier: 2 });
  a.download = 'design.png';
  a.click();
};

// --- toolbar -------------------------------------------------------------
const actions: Record<string, () => void> = {
  undo: () => restore(pos - 1),
  redo: () => restore(pos + 1),
  text: () => add(new fabric.IText('Double-click to edit', { fontSize: 40, fontFamily: DEFAULT_FONT })),
  rect: () => add(new fabric.Rect({ width: 150, height: 100 })),
  circle: () => add(new fabric.Circle({ radius: 60 })),
  image: () => $('img').click(),
  front: () => { c.getActiveObject()?.bringForward(); snap(); },
  back: () => { c.getActiveObject()?.sendBackwards(); snap(); },
  del, save, load, png: exportPNG,
  bold: () => toggle('fontWeight', 'bold'),
  italic: () => toggle('fontStyle', 'italic'),
  underline: () => toggle('underline', true),
  left: () => setText({ textAlign: 'left' }),
  center: () => setText({ textAlign: 'center' }),
  right: () => setText({ textAlign: 'right' }),
};
document.querySelectorAll<HTMLElement>('[data-act]').forEach(b => { b.onclick = actions[b.dataset.act!]; });

addEventListener('keydown', e => {
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement) return;
  if (textObj()?.isEditing) return;
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Delete' || e.key === 'Backspace') del();
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? actions.redo() : actions.undo(); }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); actions.redo(); }
});

snap();
