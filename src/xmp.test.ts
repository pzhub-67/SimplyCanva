import { describe, expect, test } from 'vitest';
import { importPresetFiles, makeZip, parseLrTemplate, parseXmp, readZip, toXmp } from './xmp';
import { BUILTIN, applyPreset, buildLut, curveTable, legacyToDev, migrateEdit } from './photoModel';

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
  const d = r.preset.dev;
  test('name, group and every setting by its Lightroom name', () => {
    expect(r.preset.name).toBe('Golden & Moody');
    expect(r.preset.group).toBe('Sports Pack');
    expect(d).toMatchObject({ Exposure2012: 0.75, Contrast2012: 20, Highlights2012: -45, Shadows2012: 30, Whites2012: 10, Blacks2012: -15, Texture: 8, Clarity2012: 12, Dehaze: 5, Vibrance: 18, Saturation: -6, IncrementalTemperature: 12, IncrementalTint: -4, PostCropVignetteAmount: -20, GrainAmount: 15 });
    expect(d).toMatchObject({ HueAdjustmentOrange: -8, SaturationAdjustmentBlue: -30, LuminanceAdjustmentGreen: 25 });
    expect(d).toMatchObject({ ColorGradeShadowHue: 210, ColorGradeShadowSat: 20, ColorGradeHighlightHue: 40, ColorGradeHighlightSat: 15, ColorGradeMidtoneHue: 30, ColorGradeMidtoneSat: 5, ColorGradeMidtoneLum: -5, ColorGradeBlending: 70, SplitToningBalance: 10 });
    expect(d.ToneCurvePV2012).toEqual([[0, 20], [128, 128], [255, 240]]);
    expect(d.ToneCurvePV2012Blue).toEqual([[0, 10], [255, 255]]);
  });
  test('reports what it skipped', () => {
    expect(r.skipped).toContain('lens profile and Upright');
    expect(r.skipped.join()).not.toContain('Adobe Color');
  });
  test('element form, B&W, absolute white balance kept but not applied', () => {
    const x = parseXmp(`<rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"><crs:Exposure2012>-0.30</crs:Exposure2012><crs:Temperature>6400</crs:Temperature><crs:ConvertToGrayscale>True</crs:ConvertToGrayscale><crs:GrayMixerRed>-12</crs:GrayMixerRed></rdf:Description>`, 'file-name')!;
    expect(x.preset.name).toBe('file-name');
    expect(x.preset.dev).toEqual({ Exposure2012: -0.3, Temperature: 6400, ConvertToGrayscale: true, GrayMixerRed: -12 });
  });
  test('calibration, detail, vignette and grain sub-settings, geometry', () => {
    const x = parseXmp(`<x xmlns:crs="c" crs:BlueSaturation="+40" crs:RedHue="-10" crs:ShadowTint="+5" crs:Sharpness="60" crs:SharpenRadius="+1.3" crs:SharpenDetail="40" crs:SharpenEdgeMasking="30" crs:PostCropVignetteFeather="70" crs:GrainSize="40" crs:GrainFrequency="60" crs:PerspectiveVertical="-12" crs:PerspectiveScale="95" crs:LensManualDistortionAmount="8"/>`)!;
    expect(x.preset.dev).toEqual({ BlueSaturation: 40, RedHue: -10, ShadowTint: 5, Sharpness: 60, SharpenRadius: 1.3, SharpenDetail: 40, SharpenEdgeMasking: 30, PostCropVignetteFeather: 70, GrainSize: 40, GrainFrequency: 60, PerspectiveVertical: -12, PerspectiveScale: 95, LensManualDistortionAmount: 8 });
    expect(x.skipped).toEqual([]);
  });
  test('parametric curve is kept as parametric', () => {
    const x = parseXmp(`<x xmlns:crs="c" crs:ParametricShadows="+40" crs:ParametricHighlights="-30" crs:ParametricShadowSplit="30"/>`)!;
    expect(x.preset.dev).toEqual({ ParametricShadows: 40, ParametricHighlights: -30, ParametricShadowSplit: 30 });
    const lut = buildLut(x.preset.dev)!;
    expect(lut[16 * 4]).toBeGreaterThan(20);
    expect(lut[232 * 4]).toBeLessThan(232);
  });
  test('split toning fills colour grading; masks reported', () => {
    const x = parseXmp(`<x xmlns:crs="c" crs:SplitToningShadowHue="220" crs:SplitToningShadowSaturation="25"><crs:MaskGroupBasedCorrections><rdf:Seq><rdf:li crs:What="Correction"/></rdf:Seq></crs:MaskGroupBasedCorrections></x>`)!;
    expect(x.preset.dev).toEqual({ ColorGradeShadowHue: 220, ColorGradeShadowSat: 25 });
    expect(x.skipped).toContain('masks and healing');
  });
  test('not a preset', () => { expect(parseXmp('<html>hello</html>')).toBeNull(); });
});

test('lrtemplate', () => {
  const r = parseLrTemplate(`s = { id = "A", internalName = "Old Film", title = ZSTR "$$$/x=Old Film", type = "Develop",
    value = { settings = { Exposure2012 = 0.3, Contrast2012 = -10, ConvertToGrayscale = true, ToneCurvePV2012 = { 0, 15, 255, 255, }, }, uuid = "B", }, version = 0, }`)!;
  expect(r.preset.name).toBe('Old Film');
  expect(r.preset.dev).toEqual({ Exposure2012: 0.3, Contrast2012: -10, ConvertToGrayscale: true, ToneCurvePV2012: [[0, 15], [255, 255]] });
});

test('xmp round trip is lossless', () => {
  const p = parseXmp(LR)!.preset;
  const p2 = { ...p, dev: { ...p.dev, SharpenRadius: 1.4, PerspectiveRotate: -2.5, GrayMixerBlue: -20, ConvertToGrayscale: true } };
  const xml = toXmp(p2);
  expect(xml).toContain('crs:Exposure2012="+0.75"');
  expect(xml).toContain('crs:SharpenRadius="+1.4"');
  const back = parseXmp(xml)!.preset;
  expect(back.dev).toEqual(p2.dev);
  expect(back.name).toBe(p2.name);
});

test('zip: stored and deflated entries, junk skipped', async () => {
  const enc = new TextEncoder();
  const zip = makeZip([{ name: 'pack/A.xmp', data: enc.encode(LR) }, { name: '__MACOSX/._A.xmp', data: enc.encode('junk') }, { name: 'readme.txt', data: enc.encode('hi') }]);
  const got = await readZip(zip.buffer as ArrayBuffer);
  expect(got.map(g => g.name)).toEqual(['A.xmp']);
  const raw = new Uint8Array(await new Response(new Blob([enc.encode(LR)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const z2 = makeZip([{ name: 'B.xmp', data: raw }]);
  const dv = new DataView(z2.buffer);
  dv.setUint16(8, 8, true);
  const cd = z2.length - 22 - (46 + 5);
  dv.setUint16(cd + 10, 8, true); dv.setUint32(cd + 24, LR.length, true);
  const files = await importPresetFiles([new File([z2 as BlobPart], 'pack.zip')]);
  expect(files.presets[0].name).toBe('Golden & Moody');
});

test('curves: monotone; identity gives no table', () => {
  const t = curveTable([[0, 0], [64, 100], [192, 160], [255, 255]]);
  for (let i = 1; i < 256; i++) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1]);
  expect(buildLut({})).toBeNull();
  expect(buildLut({ ToneCurvePV2012: [[0, 32], [255, 255]] })![0]).toBe(32);
});

describe('presets behave like Lightroom', () => {
  const pre = { id: 'p', name: 'P', dev: { Exposure2012: 1, Contrast2012: 40, ConvertToGrayscale: true } };
  test('applying sets the settings it contains and keeps the rest', () => {
    const e = applyPreset({ dev: { Exposure2012: 0.5, Shadows2012: 20 } }, pre);
    expect(e.dev).toEqual({ Exposure2012: 1, Shadows2012: 20, Contrast2012: 40, ConvertToGrayscale: true });
  });
  test('Amount blends from the settings before to the preset, and past it', () => {
    const before = { dev: { Exposure2012: 0.5 } };
    expect(applyPreset(before, pre, 50).dev).toMatchObject({ Exposure2012: 0.75, Contrast2012: 20, ConvertToGrayscale: true });
    expect(applyPreset(before, pre, 200).dev).toMatchObject({ Exposure2012: 1.5, Contrast2012: 80 });
    const twice = applyPreset(applyPreset(before, pre, 100), pre, 0);
    expect(twice.dev).toEqual({ Exposure2012: 0.5 });
  });
  test('removing the preset restores the settings from before', () => {
    const e = applyPreset({ dev: { Shadows2012: 20 } }, pre);
    expect(applyPreset(e, undefined).dev).toEqual({ Shadows2012: 20 });
  });
});

test('older SimplyCanva edits convert', () => {
  expect(legacyToDev({ adj: { exposure: 100, warmth: 30, vignette: 20, definition: 10 }, mono: true })).toEqual({ Exposure2012: 1.5, IncrementalTemperature: 30, PostCropVignetteAmount: -20, Clarity2012: 10, ConvertToGrayscale: true });
  const e = migrateEdit({ adj: { contrast: 10 }, filter: { id: 'vivid', amount: 50 } }, BUILTIN)!;
  expect(e.dev).toMatchObject({ Contrast2012: 17.5 > 17 ? 18 : 17, Vibrance: 15 });
});
