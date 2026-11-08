import { describe, expect, test } from 'vitest';
import { importPresetFiles, makeZip, parseLrTemplate, parseXmp, readZip, toXmp } from './xmp';
import { buildLut, curveTable, effective, BUILTIN } from './photoModel';

// Trimmed from a real Lightroom Classic export (attribute form, element curves, colour grading, a profile).
const LR = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   crs:PresetType="Normal" crs:Version="15.0" crs:ProcessVersion="11.0"
   crs:Exposure2012="+0.75" crs:Contrast2012="+20" crs:Highlights2012="-45" crs:Shadows2012="+30"
   crs:Whites2012="+10" crs:Blacks2012="-15" crs:Texture="+8" crs:Clarity2012="+12" crs:Dehaze="+5"
   crs:Vibrance="+18" crs:Saturation="-6" crs:IncrementalTemperature="+12" crs:IncrementalTint="-4"
   crs:HueAdjustmentOrange="-8" crs:SaturationAdjustmentBlue="-30" crs:LuminanceAdjustmentGreen="+25"
   crs:SplitToningShadowHue="210" crs:SplitToningShadowSaturation="20" crs:SplitToningHighlightHue="40"
   crs:SplitToningHighlightSaturation="15" crs:SplitToningBalance="+10" crs:ColorGradeBlending="70"
   crs:ColorGradeMidtoneHue="30" crs:ColorGradeMidtoneSat="5" crs:ColorGradeMidtoneLum="-5"
   crs:PostCropVignetteAmount="-20" crs:GrainAmount="15" crs:LensProfileEnable="1" crs:HasSettings="True">
   <crs:Name><rdf:Alt><rdf:li xml:lang="x-default">Golden &amp; Moody</rdf:li></rdf:Alt></crs:Name>
   <crs:Group><rdf:Alt><rdf:li xml:lang="x-default">Sports Pack</rdf:li></rdf:Alt></crs:Group>
   <crs:Look><rdf:Description crs:Name="Adobe Color" crs:Amount="1"/></crs:Look>
   <crs:ToneCurvePV2012><rdf:Seq><rdf:li>0, 20</rdf:li><rdf:li>128, 128</rdf:li><rdf:li>255, 240</rdf:li></rdf:Seq></crs:ToneCurvePV2012>
   <crs:ToneCurvePV2012Blue><rdf:Seq><rdf:li>0, 10</rdf:li><rdf:li>255, 255</rdf:li></rdf:Seq></crs:ToneCurvePV2012Blue>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;

describe('xmp import', () => {
  const r = parseXmp(LR)!;
  test('name, group and sliders', () => {
    expect(r.preset.name).toBe('Golden & Moody');
    expect(r.preset.group).toBe('Sports Pack');
    expect(r.preset.adj).toMatchObject({ exposure: 50, contrast: 20, highlights: -45, shadows: 30, whites: 10, blacks: -15, texture: 8, definition: 12, dehaze: 5, vibrance: 18, saturation: -6, warmth: 12, tint: -4, vignette: 20, grain: 15 });
  });
  test('mixer, curves, grading', () => {
    expect(r.preset.hsl).toEqual({ orange: [-8, 0, 0], green: [0, 0, 25], blue: [0, -30, 0] });
    expect(r.preset.curve?.rgb).toEqual([[0, 20], [128, 128], [255, 240]]);
    expect(r.preset.curve?.b).toEqual([[0, 10], [255, 255]]);
    expect(r.preset.grade).toMatchObject({ shadows: { h: 210, s: 20, l: 0 }, highlights: { h: 40, s: 15, l: 0 }, midtones: { h: 30, s: 5, l: -5 }, blending: 70, balance: 10 });
  });
  test('reports what it skipped', () => {
    expect(r.skipped).toContain('profile "Adobe Color"');
    expect(r.skipped).toContain('lens and geometry');
  });
  test('element form, B&W, absolute white balance', () => {
    const x = parseXmp(`<rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"><crs:Exposure2012>-0.30</crs:Exposure2012><crs:Temperature>6400</crs:Temperature><crs:ConvertToGrayscale>True</crs:ConvertToGrayscale></rdf:Description>`, 'file-name')!;
    expect(x.preset.name).toBe('file-name');
    expect(x.preset.adj).toEqual({ exposure: -20, warmth: 20 });
    expect(x.preset.mono).toBe(true);
  });
  test('parametric curve is folded into the point curve', () => {
    const x = parseXmp(`<x xmlns:crs="c" crs:ParametricShadows="+40" crs:ParametricHighlights="-30"/>`)!;
    const t = curveTable(x.preset.curve!.rgb!);
    expect(t[32]).toBeGreaterThan(40);
    expect(t[224]).toBeLessThan(215);
  });
  test('not a preset', () => { expect(parseXmp('<html>hello</html>')).toBeNull(); });
});

test('lrtemplate', () => {
  const r = parseLrTemplate(`s = { id = "A", internalName = "Old Film", title = ZSTR "$$$/x=Old Film", type = "Develop",
    value = { settings = { Exposure2012 = 0.3, Contrast2012 = -10, ConvertToGrayscale = true, ToneCurvePV2012 = { 0, 15, 255, 255, }, }, uuid = "B", }, version = 0, }`)!;
  expect(r.preset.name).toBe('Old Film');
  expect(r.preset.adj).toEqual({ exposure: 20, contrast: -10 });
  expect(r.preset.mono).toBe(true);
  expect(r.preset.curve?.rgb).toEqual([[0, 15], [255, 255]]);
});

test('our own xmp round trips exactly, and Lightroom can read the crs: values', () => {
  const p = { ...parseXmp(LR)!.preset, adj: { ...parseXmp(LR)!.preset.adj, brilliance: 30 } };
  const xml = toXmp(p);
  expect(xml).toContain('crs:Exposure2012="+0.75"');
  expect(xml).toContain('crs:HueAdjustmentOrange="-8"');
  const back = parseXmp(xml)!.preset;
  expect({ ...back, id: '' }).toEqual({ ...p, id: '' });
  // Lightroom ignores sc:Look; without it the crs: values still give the same look (minus iPhone-only sliders).
  const lr = parseXmp(xml.replace(/sc:Look="[^"]*"/, ''))!.preset;
  const { brilliance: _b, ...lrAdj } = p.adj;
  expect(lr.adj).toEqual(lrAdj);
  expect(lr.hsl).toEqual(p.hsl);
  expect(lr.grade?.shadows).toEqual(p.grade?.shadows);
});

test('zip: stored and deflated entries, junk skipped', async () => {
  const enc = new TextEncoder();
  const zip = makeZip([{ name: 'pack/A.xmp', data: enc.encode(LR) }, { name: '__MACOSX/._A.xmp', data: enc.encode('junk') }, { name: 'readme.txt', data: enc.encode('hi') }]);
  const got = await readZip(zip.buffer as ArrayBuffer);
  expect(got.map(g => g.name)).toEqual(['A.xmp']);
  // deflated entry, built by hand
  const raw = new Uint8Array(await new Response(new Blob([enc.encode(LR)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const z2 = makeZip([{ name: 'B.xmp', data: raw }]);
  const dv = new DataView(z2.buffer);
  dv.setUint16(8, 8, true); // local header: method deflate
  const cd = z2.length - 22 - (46 + 5);
  dv.setUint16(cd + 10, 8, true); dv.setUint32(cd + 24, LR.length, true);
  const files = await importPresetFiles([new File([z2 as BlobPart], 'pack.zip')]);
  expect(files.presets[0].name).toBe('Golden & Moody');
});

test('curves: monotone, identity default, preset fades with amount', () => {
  const t = curveTable([[0, 0], [64, 100], [192, 160], [255, 255]]);
  for (let i = 1; i < 256; i++) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1]);
  const id = buildLut([]);
  expect([id[0], id[128 * 4], id[255 * 4]]).toEqual([0, 128, 255]);
  const matte = BUILTIN.find(b => b.id === 'matte')!;
  const half = effective({ adj: {}, filter: { id: 'matte', amount: 50 } }, BUILTIN);
  expect(half.curves).toEqual([{ c: matte.curve, k: 0.5 }]);
  expect(buildLut(half.curves!)[0]).toBe(16);
});

test('grading: own range wins, preset scaled otherwise', () => {
  const p = effective({ adj: {}, filter: { id: 'tealorange', amount: 50 }, grade: { highlights: { h: 60, s: 40, l: 0 } } }, BUILTIN);
  expect(p.grade!.slice(0, 3)).toEqual([190, 17.5, 0]);
  expect(p.grade!.slice(6, 9)).toEqual([60, 40, 0]);
});
