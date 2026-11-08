// Lightroom presets in and out. Reads .xmp (Lightroom Classic / mobile / Camera Raw), old .lrtemplate files and
// .zip packs of either; writes .xmp that Lightroom can import. Parsing is plain text matching on purpose:
// the files are untrusted, nothing in them is ever run or inserted as HTML, and every value is clamped.
// shortcut: camera profiles (crs:Look, RGBTable), masks, lens and geometry settings are skipped and reported.
import { BANDS, Band, Curves, Grade, Look, Preset, Pt, RANGES, Range, Tone3, clamp, cleanLook, curveTable } from './photoModel';

type Settings = Record<string, string>;
export interface Parsed { preset: Preset; skipped: string[] }

const LR_BAND: Record<Band, string> = { red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green', aqua: 'Aqua', blue: 'Blue', purple: 'Purple', magenta: 'Magenta' };
const LR_RANGE: Record<Range, string> = { shadows: 'Shadow', midtones: 'Midtone', highlights: 'Highlight', global: 'Global' };
// Sliders that map one to one (Lightroom key, our key, scale).
const DIRECT: [string, keyof Look['adj'], number][] = [
  ['Contrast2012', 'contrast', 1], ['Highlights2012', 'highlights', 1], ['Shadows2012', 'shadows', 1],
  ['Whites2012', 'whites', 1], ['Blacks2012', 'blacks', 1], ['Texture', 'texture', 1], ['Clarity2012', 'definition', 1],
  ['Dehaze', 'dehaze', 1], ['Vibrance', 'vibrance', 1], ['Saturation', 'saturation', 1],
  ['IncrementalTemperature', 'warmth', 1], ['IncrementalTint', 'tint', 1], ['LuminanceSmoothing', 'noiseReduction', 1],
  ['PostCropVignetteAmount', 'vignette', -1], ['GrainAmount', 'grain', 1],
];
const EXPOSURE_EV = 1.5; // our Exposure at 100 is +1.5 stops (see adjust.ts)
const IGNORED = /^(Version|ProcessVersion|PresetType|UUID|Cluster|Supports\w*|CameraModelRestriction|Copyright|ContactInfo|HasSettings|HasCrop|AlreadyApplied|Name|ShortName|SortName|Group|Description|Look|CameraProfile\w*|ToneCurveName\w*|WhiteBalance|Parametric\w*|SplitToning\w*|ColorGrade\w*|ConvertToGrayscale|Sharpen\w*|Sharpness|HueAdjustment\w*|SaturationAdjustment\w*|LuminanceAdjustment\w*|Temperature|Tint|Exposure2012|Exposure|Contrast|Highlights|Shadows|Brightness|Clarity|Grain\w*|PostCrop\w*|ColorNoiseReduction\w*|LuminanceNoiseReduction\w*|OverrideLookVignette|AutoLateralCA|ToneMapStrength|CompatibleVersion|RequiresRGBTables)$/;

// Settings we do not model, named the way Lightroom's panels name them.
const FRIENDLY: [RegExp, string][] = [
  [/^(Lens|Perspective|Upright|Defringe|AutoLateral|VignetteAmount|VignetteMidpoint|ChromaticAberration)/, 'lens and geometry'],
  [/^(Crop|HasCrop)/, 'crop'], [/^(GrayMixer|AutoGray)/, 'B&W mix'],
  [/^(ShadowTint|RedHue|RedSaturation|GreenHue|GreenSaturation|BlueHue|BlueSaturation)$/, 'calibration'],
  [/^(ColorNoise|LuminanceNoise|LuminanceSmoothing|Sharpen)/, 'detail'], [/^RGBTable|^Table_/, 'profile'],
];
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
const encode = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: string | undefined) => { const x = v === undefined ? NaN : Number(v.trim()); return Number.isFinite(x) ? x : undefined; };
const newId = () => `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// Lightroom's parametric curve (Shadows, Darks, Lights, Highlights over three split points), folded into a point curve.
const parametric = (s: Settings): Pt[] | null => {
  const v = ['ParametricShadows', 'ParametricDarks', 'ParametricLights', 'ParametricHighlights'].map(k => n(s[k]) ?? 0);
  if (v.every(x => x === 0)) return null;
  const sp = [n(s.ParametricShadowSplit) ?? 25, n(s.ParametricMidtoneSplit) ?? 50, n(s.ParametricHighlightSplit) ?? 75].map(x => clamp(x, 5, 95) * 2.55);
  const centres = [sp[0] / 2, (sp[0] + sp[1]) / 2, (sp[1] + sp[2]) / 2, (sp[2] + 255) / 2];
  return [[0, 0], ...centres.map((x, i) => [x, clamp(x + v[i] * 0.45, 0, 255)] as Pt), [255, 255]];
};
const compose = (inner: Pt[], outer: Pt[] | undefined): Pt[] => {
  const a = curveTable(inner), b = outer ? curveTable(outer) : null;
  return Array.from({ length: 17 }, (_, i) => { const x = Math.min(255, i * 16); const y = a[x]; return [x, Math.round(b ? b[Math.round(y)] : y)] as Pt; });
};

// Turn Lightroom settings into a look.
const fromSettings = (s: Settings, curves: Record<string, Pt[]>): { look: Look; skipped: string[] } => {
  const adj: Look['adj'] = {};
  const set = (k: keyof Look['adj'], v: number | undefined) => { if (v !== undefined && Math.round(v) !== 0) adj[k] = Math.round(v); };
  const ev = n(s.Exposure2012) ?? n(s.Exposure);
  set('exposure', ev === undefined ? undefined : clamp(ev / EXPOSURE_EV * 100, -100, 100));
  for (const [lr, k, scale] of DIRECT) set(k, n(s[lr]) === undefined ? undefined : clamp(n(s[lr])! * scale, k === 'grain' || k === 'noiseReduction' ? 0 : -100, 100));
  if (s.IncrementalTemperature === undefined && n(s.Temperature) !== undefined) set('warmth', clamp((n(s.Temperature)! - 5500) / 45, -100, 100));
  if (s.IncrementalTint === undefined && n(s.Tint) !== undefined) set('tint', clamp(n(s.Tint)! / 1.5, -100, 100));
  if (n(s.Sharpness) !== undefined) set('sharpness', clamp((n(s.Sharpness)! - 40) * 1.2, 0, 100));

  const hsl: Look['hsl'] = {};
  for (const b of BANDS) {
    const v = ['HueAdjustment', 'SaturationAdjustment', 'LuminanceAdjustment'].map(p => clamp(n(s[p + LR_BAND[b]]) ?? 0, -100, 100)) as [number, number, number];
    if (v.some(x => x)) hsl[b] = v;
  }

  const curve: Curves = {};
  const master = curves.ToneCurvePV2012 ?? curves.ToneCurve;
  const para = parametric(s);
  if (para) curve.rgb = compose(para, master); else if (master) curve.rgb = master;
  if (curves.ToneCurvePV2012Red) curve.r = curves.ToneCurvePV2012Red;
  if (curves.ToneCurvePV2012Green) curve.g = curves.ToneCurvePV2012Green;
  if (curves.ToneCurvePV2012Blue) curve.b = curves.ToneCurvePV2012Blue;

  const grade: Grade = {};
  const tone = (h?: string, sat?: string, lum?: string): Tone3 => ({ h: clamp(n(h) ?? 0, 0, 360), s: clamp(n(sat) ?? 0, 0, 100), l: clamp(n(lum) ?? 0, -100, 100) });
  grade.shadows = tone(s.SplitToningShadowHue ?? s.ColorGradeShadowHue, s.SplitToningShadowSaturation ?? s.ColorGradeShadowSat, s.ColorGradeShadowLum);
  grade.highlights = tone(s.SplitToningHighlightHue ?? s.ColorGradeHighlightHue, s.SplitToningHighlightSaturation ?? s.ColorGradeHighlightSat, s.ColorGradeHighlightLum);
  grade.midtones = tone(s.ColorGradeMidtoneHue, s.ColorGradeMidtoneSat, s.ColorGradeMidtoneLum);
  grade.global = tone(s.ColorGradeGlobalHue, s.ColorGradeGlobalSat, s.ColorGradeGlobalLum);
  if (n(s.ColorGradeBlending) !== undefined) grade.blending = n(s.ColorGradeBlending);
  if (n(s.SplitToningBalance) !== undefined) grade.balance = n(s.SplitToningBalance);

  const look = cleanLook({ adj, hsl, curve, grade, mono: /^true$/i.test(s.ConvertToGrayscale ?? '') });
  const handled = new Set(DIRECT.map(d => d[0]));
  const skipped = [...new Set(Object.entries(s)
    .filter(([k, v]) => !IGNORED.test(k) && !handled.has(k) && !/^(0|\+?0(\.0+)?|False|)$/i.test(v.trim()))
    .map(([k]) => FRIENDLY.find(([re]) => re.test(k))?.[1] ?? 'other settings'))];
  return { look, skipped };
};

// --- .xmp ------------------------------------------------------------------
const altText = (xml: string, tag: string) => {
  const el = new RegExp(`<crs:${tag}>\\s*<rdf:Alt>\\s*<rdf:li[^>]*>([^<]*)</rdf:li>`).exec(xml);
  if (el) return decode(el[1]).trim();
  const at = new RegExp(`crs:${tag}="([^"]*)"`).exec(xml);
  return at ? decode(at[1]).trim() : '';
};

export const parseXmp = (text: string, fallbackName = 'Imported preset'): Parsed | null => {
  if (!/crs:|xmlns:crs/.test(text)) return null;
  const profile = /<crs:Look>[\s\S]*?crs:Name="([^"]*)"/.exec(text)?.[1];
  const xml = text.replace(/<crs:Look>[\s\S]*?<\/crs:Look>/g, '').replace(/<crs:MaskGroupBasedCorrections>[\s\S]*?<\/crs:MaskGroupBasedCorrections>/g, ' MASKS ');
  const ours = /sc:Look="([^"]*)"/.exec(xml);
  const name = altText(xml, 'Name') || fallbackName;
  const group = altText(xml, 'Group');
  const skipped: string[] = [];
  let look: Look;
  if (ours) { // written by SimplyCanva: the exact look rides along
    try { look = cleanLook(JSON.parse(decode(ours[1]))); } catch { look = { adj: {} }; }
  } else {
    const s: Settings = {};
    for (const m of xml.matchAll(/crs:(\w+)="([^"]*)"/g)) s[m[1]] = decode(m[2]);
    for (const m of xml.matchAll(/<crs:(\w+)>([^<]*)<\/crs:\1>/g)) s[m[1]] = decode(m[2]);
    const curves: Record<string, Pt[]> = {};
    for (const m of xml.matchAll(/<crs:(ToneCurve(?:PV2012)?(?:Red|Green|Blue)?)>\s*<rdf:Seq>([\s\S]*?)<\/rdf:Seq>/g)) {
      const pts = [...m[2].matchAll(/<rdf:li>\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*<\/rdf:li>/g)].map(p => [Number(p[1]), Number(p[2])] as Pt);
      if (pts.length >= 2) curves[m[1]] = pts;
    }
    const r = fromSettings(s, curves);
    look = r.look; skipped.push(...r.skipped);
  }
  if (profile) skipped.unshift(`profile "${profile}"`);
  if (/ MASKS /.test(xml)) skipped.unshift('masks');
  return { preset: { id: newId(), name: name.slice(0, 80), ...(group ? { group: group.slice(0, 60) } : {}), ...look }, skipped };
};

// --- .lrtemplate (Lightroom Classic before 7.3) ----------------------------------
export const parseLrTemplate = (text: string, fallbackName = 'Imported preset'): Parsed | null => {
  const settingsAt = text.indexOf('settings');
  if (settingsAt < 0) return null;
  const body = text.slice(settingsAt);
  const s: Settings = {};
  const curves: Record<string, Pt[]> = {};
  for (const m of body.matchAll(/(\w+)\s*=\s*\{([^{}]*)\}/g)) {
    if (!/^ToneCurve/.test(m[1])) continue;
    const v = m[2].split(',').map(x => Number(x.trim())).filter(Number.isFinite);
    const pts: Pt[] = [];
    for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i], v[i + 1]]);
    if (pts.length >= 2) curves[m[1]] = pts;
  }
  for (const m of body.matchAll(/(\w+)\s*=\s*(-?[\d.]+|true|false)\s*,/g)) s[m[1]] = m[2];
  const name = /internalName\s*=\s*"([^"]*)"/.exec(text)?.[1] || /title\s*=\s*ZSTR\s*"[^=]*=([^"]*)"/.exec(text)?.[1] || fallbackName;
  const r = fromSettings(s, curves);
  return { preset: { id: newId(), name: name.slice(0, 80), ...r.look }, skipped: r.skipped };
};

// --- writing .xmp ------------------------------------------------------------
const f2 = (v: number) => (v > 0 ? '+' : '') + v.toFixed(2);
const i0 = (v: number) => (v > 0 ? '+' : '') + Math.round(v);
const uuid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
export const NOT_IN_LIGHTROOM: (keyof Look['adj'])[] = ['brilliance', 'brightness', 'blackPoint'];

export const toXmp = (p: Preset): string => {
  const a = p.adj, attrs: Record<string, string> = {};
  if (a.exposure) attrs.Exposure2012 = f2(a.exposure / 100 * EXPOSURE_EV);
  for (const [lr, k, scale] of DIRECT) if (a[k]) attrs[lr] = i0(a[k]! * scale);
  if (a.grain) { attrs.GrainSize = '25'; attrs.GrainFrequency = '50'; }
  if (a.sharpness) attrs.Sharpness = String(Math.round(40 + a.sharpness / 1.2));
  for (const b of BANDS) {
    const v = p.hsl?.[b];
    if (v) ['HueAdjustment', 'SaturationAdjustment', 'LuminanceAdjustment'].forEach((k, i) => { if (v[i]) attrs[k + LR_BAND[b]] = i0(v[i]); });
  }
  for (const r of RANGES) {
    const t = p.grade?.[r];
    if (!t) continue;
    attrs[`ColorGrade${LR_RANGE[r]}Hue`] = String(Math.round(t.h));
    attrs[`ColorGrade${LR_RANGE[r]}Sat`] = String(Math.round(t.s));
    attrs[`ColorGrade${LR_RANGE[r]}Lum`] = i0(t.l);
  }
  if (p.grade?.shadows) { attrs.SplitToningShadowHue = String(Math.round(p.grade.shadows.h)); attrs.SplitToningShadowSaturation = String(Math.round(p.grade.shadows.s)); }
  if (p.grade?.highlights) { attrs.SplitToningHighlightHue = String(Math.round(p.grade.highlights.h)); attrs.SplitToningHighlightSaturation = String(Math.round(p.grade.highlights.s)); }
  if (p.grade) { attrs.ColorGradeBlending = String(Math.round(p.grade.blending ?? 50)); attrs.SplitToningBalance = i0(p.grade.balance ?? 0); }
  if (p.mono) attrs.ConvertToGrayscale = 'True';

  const seq = (tag: string, pts?: Pt[]) => (pts ? `\n   <crs:${tag}>\n    <rdf:Seq>\n${pts.map(([x, y]) => `     <rdf:li>${Math.round(x)}, ${Math.round(y)}</rdf:li>`).join('\n')}\n    </rdf:Seq>\n   </crs:${tag}>` : '');
  const alt = (tag: string, v: string) => `\n   <crs:${tag}>\n    <rdf:Alt>\n     <rdf:li xml:lang="x-default">${encode(v)}</rdf:li>\n    </rdf:Alt>\n   </crs:${tag}>`;
  const { id: _id, name, group, ...look } = p;
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="SimplyCanva">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    xmlns:sc="https://github.com/pzhub-67/SimplyCanva/ns/look/1.0/"
   crs:PresetType="Normal"
   crs:Cluster=""
   crs:UUID="${uuid()}"
   crs:SupportsAmount2="True"
   crs:SupportsColor="True"
   crs:SupportsMonochrome="True"
   crs:SupportsHighDynamicRange="True"
   crs:SupportsNormalDynamicRange="True"
   crs:SupportsSceneReferred="True"
   crs:SupportsOutputReferred="True"
   crs:CameraModelRestriction=""
   crs:Copyright=""
   crs:ContactInfo=""
   crs:Version="15.0"
   crs:ProcessVersion="11.0"
${Object.entries(attrs).map(([k, v]) => `   crs:${k}="${v}"`).join('\n')}
   crs:HasSettings="True"
   sc:Look="${encode(JSON.stringify(look))}">${alt('Name', name)}${alt('ShortName', '')}${alt('SortName', '')}${alt('Group', group ?? 'SimplyCanva')}${alt('Description', '')}${seq('ToneCurvePV2012', p.curve?.rgb)}${seq('ToneCurvePV2012Red', p.curve?.r)}${seq('ToneCurvePV2012Green', p.curve?.g)}${seq('ToneCurvePV2012Blue', p.curve?.b)}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`;
};

// --- zip ---------------------------------------------------------------------
const crcTable = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } return t; })();
const crc32 = (d: Uint8Array) => { let c = 0xffffffff; for (const b of d) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

// A stored (uncompressed) zip: what Lightroom mobile's "Import presets" accepts.
export const makeZip = (files: { name: string; data: Uint8Array }[]): Uint8Array => {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, f.data.length, true); lh.setUint32(22, f.data.length, true); lh.setUint16(26, name.length, true);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, f.data.length, true); ch.setUint32(24, f.data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    parts.push(new Uint8Array(lh.buffer), name, f.data);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + f.data.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, size, true); end.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
};

const inflate = async (data: Uint8Array) => new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());

// Read the preset files out of a zip. Limits keep a hostile archive from eating memory.
export const readZip = async (buf: ArrayBuffer, wanted = /\.(xmp|lrtemplate)$/i): Promise<{ name: string; text: string }[]> => {
  const d = new DataView(buf), u8 = new Uint8Array(buf), out: { name: string; text: string }[] = [];
  let e = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (d.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('Not a zip file');
  const count = Math.min(d.getUint16(e + 10, true), 1000);
  let p = d.getUint32(e + 16, true), total = 0;
  const dec = new TextDecoder();
  for (let i = 0; i < count && p + 46 <= buf.byteLength && d.getUint32(p, true) === 0x02014b50; i++) {
    const method = d.getUint16(p + 10, true), csize = d.getUint32(p + 20, true), usize = d.getUint32(p + 24, true);
    const nlen = d.getUint16(p + 28, true), xlen = d.getUint16(p + 30, true), clen = d.getUint16(p + 32, true), lo = d.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    const base = name.split('/').pop() ?? '';
    if (!wanted.test(base) || base.startsWith('._') || name.includes('__MACOSX') || usize > 2_000_000 || (total += usize) > 30_000_000) continue;
    if (d.getUint32(lo, true) !== 0x04034b50) continue;
    const start = lo + 30 + d.getUint16(lo + 26, true) + d.getUint16(lo + 28, true);
    const raw = u8.subarray(start, start + csize);
    const bytes = method === 0 ? raw : method === 8 ? await inflate(raw) : null;
    if (bytes && bytes.length <= 2_000_000) out.push({ name: base, text: dec.decode(bytes) });
  }
  return out;
};

// Any mix of .xmp, .lrtemplate and .zip files -> presets, plus what could not be used.
export const importPresetFiles = async (files: File[]): Promise<{ presets: Preset[]; skipped: string[]; failed: string[] }> => {
  const presets: Preset[] = [], skipped = new Set<string>(), failed: string[] = [];
  const one = (name: string, text: string) => {
    const stem = name.replace(/\.[^.]+$/, '');
    const r = /\.lrtemplate$/i.test(name) ? parseLrTemplate(text, stem) : parseXmp(text, stem);
    if (r) { presets.push(r.preset); r.skipped.forEach(s => skipped.add(s)); } else failed.push(name);
  };
  for (const f of files.slice(0, 200)) {
    try {
      if (f.size > 40_000_000) { failed.push(f.name); continue; }
      if (/\.zip$/i.test(f.name)) (await readZip(await f.arrayBuffer())).forEach(x => one(x.name, x.text));
      else if (f.size <= 2_000_000) one(f.name, await f.text());
      else failed.push(f.name);
    } catch { failed.push(f.name); }
  }
  return { presets, skipped: [...skipped].slice(0, 12), failed };
};

export const presetsZip = (presets: Preset[]) => {
  const enc = new TextEncoder(), used = new Set<string>();
  return makeZip(presets.map(p => {
    let name = (p.name.replace(/&/g, 'and').replace(/[^\w\- ]+/g, '').replace(/\s+/g, ' ').trim() || 'Preset').slice(0, 60), i = 2;
    while (used.has(name)) name = `${name} ${i++}`;
    used.add(name);
    return { name: `${name}.xmp`, data: enc.encode(toXmp(p)) };
  }));
};
