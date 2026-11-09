// The photo engine: one WebGL pass that applies Lightroom develop settings in Lightroom's order.
// Geometry and lens warp → white balance and calibration (one matrix, linear light) → exposure with a soft
// highlight shoulder → local tone mapping (Highlights, Shadows, Clarity, Texture, Dehaze) against a blurred
// "base" luminance layer computed on the CPU → back to display gamma → Contrast, Whites, Blacks → parametric and point
// curves (lookup texture) → Vibrance, Saturation → Color Mix → B&W mix → Color Grading → Sharpening and Noise
// Reduction → post-crop Vignette → Grain. Registered as a Fabric image filter so it serializes with the design.
// shortcut: no CPU fallback; without WebGL photos show unedited.
import { fabric } from 'fabric';
import { BANDS, Dev, WHEELS, buildLut, isNeutralDev, mono, num } from './photoModel';

const fragmentSource = `
precision highp float;
uniform sampler2D uTexture;
uniform sampler2D u_lut;
uniform sampler2D u_base;
uniform vec2 uTexel;
uniform mat3 u_m;
uniform float u_ev, u_hasBase, u_useLut, u_useHsl, u_mono, u_useGrade, u_ar;
uniform vec4 u_tone;   // contrast, highlights, shadows, whites
uniform float u_blacks;
uniform vec3 u_fx;     // texture, clarity, dehaze
uniform vec3 u_pres;   // vibrance, saturation, shadow tint
uniform vec3 u_hsl[8];
uniform float u_gray[8];
uniform vec3 u_gsh, u_gmid, u_ghi, u_ggl;
uniform vec2 u_gopt;   // blending, balance
uniform vec4 u_sharp;  // amount, radius px, detail, masking
uniform vec4 u_nr;     // luminance, detail, contrast, color
uniform vec2 u_nr2;    // color detail, smoothness
uniform vec4 u_vig;    // amount, midpoint, feather, roundness
uniform vec2 u_vig2;   // style, highlights
uniform vec3 u_grain;  // amount, size px, roughness
uniform vec3 u_lens;   // distortion, vignetting, midpoint
uniform vec4 u_geo;    // vertical, horizontal, rotate (radians), aspect
uniform vec3 u_geo2;   // scale, x offset, y offset
varying vec2 vTexCoord;

float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 rgb2hsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), l = (mx + mn) * 0.5, d = mx - mn;
  if (d < 1e-5) return vec3(0.0, 0.0, l);
  float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
  float h = mx == c.r ? (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0) : mx == c.g ? (c.b - c.r) / d + 2.0 : (c.r - c.g) / d + 4.0;
  return vec3(h / 6.0, s, l);
}
float hue2(float p, float q, float t) {
  t = fract(t);
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}
vec3 hsl2rgb(vec3 h) {
  if (h.y <= 0.0) return vec3(h.z);
  float q = h.z < 0.5 ? h.z * (1.0 + h.y) : h.z + h.y - h.z * h.y, p = 2.0 * h.z - q;
  return vec3(hue2(p, q, h.x + 1.0 / 3.0), hue2(p, q, h.x), hue2(p, q, h.x - 1.0 / 3.0));
}
// Lightroom's bands sit where people see those colours: sky blue (~210°) answers mostly to Blue, not Aqua.
float centre(int i) { return i == 0 ? 0.0 : i == 1 ? 32.0 : i == 2 ? 60.0 : i == 3 ? 115.0 : i == 4 ? 175.0 : i == 5 ? 218.0 : i == 6 ? 265.0 : 310.0; }
float wrapd(float d) { return d > 180.0 ? d - 360.0 : d < -180.0 ? d + 360.0 : d; }
float bandW(int i, float deg) {
  float ce = centre(i), d = wrapd(deg - ce);
  float span = d >= 0.0 ? wrapd(centre(i == 7 ? 0 : i + 1) - ce) : wrapd(ce - centre(i == 0 ? 7 : i - 1));
  if (span <= 0.0) span += 360.0;
  float w = max(0.0, 1.0 - abs(d) / span);
  return 0.5 - 0.5 * cos(3.14159265 * w);
}
vec3 tintOf(float hdeg) { return hsl2rgb(vec3(hdeg / 360.0, 1.0, 0.5)) - 0.5; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Output position -> source position: Geometry (offset, scale, aspect, rotate, perspective) then lens distortion.
vec2 warp(vec2 uv) {
  vec2 q = (uv - 0.5) * vec2(u_ar, 1.0);
  q -= u_geo2.yz * vec2(u_ar, 1.0) * 0.5;
  q /= u_geo2.x;
  q *= vec2(exp(-u_geo.w * 0.25), exp(u_geo.w * 0.25));
  float cs = cos(u_geo.z), sn = sin(u_geo.z);
  q = vec2(cs * q.x + sn * q.y, -sn * q.x + cs * q.y);
  float w = 1.0 + u_geo.x * 0.6 * q.y + u_geo.y * 0.6 * q.x / u_ar;
  q /= max(w, 0.05);
  q *= 1.0 + u_lens.x * 0.25 * dot(q, q) / (0.25 * (u_ar * u_ar + 1.0));
  return q / vec2(u_ar, 1.0) + 0.5;
}
vec3 tap(vec2 p) { return texture2D(uTexture, p).rgb; }

void main() {
  vec2 uv = warp(vTexCoord);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0); return; }
  vec4 src = texture2D(uTexture, uv);
  vec3 c0 = src.rgb;

  // neighbourhoods: ring at the sharpening radius, ring at 4 px (texture, noise), base layer (clarity, local tone)
  vec2 r1 = uTexel * u_sharp.y;
  vec3 n1 = (tap(uv + vec2(r1.x, 0.0)) + tap(uv - vec2(r1.x, 0.0)) + tap(uv + vec2(0.0, r1.y)) + tap(uv - vec2(0.0, r1.y))) * 0.25;
  vec2 r4 = uTexel * 4.0;
  vec3 n4 = (tap(uv + vec2(r4.x, 0.0)) + tap(uv - vec2(r4.x, 0.0)) + tap(uv + vec2(0.0, r4.y)) + tap(uv - vec2(0.0, r4.y))
           + tap(uv + r4 * 0.7) + tap(uv - r4 * 0.7) + tap(uv + vec2(r4.x, -r4.y) * 0.7) + tap(uv + vec2(-r4.x, r4.y) * 0.7)) * 0.125;

  // noise reduction first, on the display-referred source (luminance keeps detail by 'detail', colour is smoothed)
  float lc = lum(c0), lnb = lum(n4);
  float edge = abs(lc - lnb);
  float keep = mix(0.0, 0.25, u_nr.y) + u_nr.z * 0.2;
  float ln = mix(lc, lnb, u_nr.x * (1.0 - smoothstep(keep * 0.2, keep * 0.2 + 0.08, edge)));
  vec3 chroma = mix(c0 - lc, n4 - lnb, u_nr.w * mix(1.0, 0.6, u_nr2.x) * mix(0.7, 1.0, u_nr2.y));
  vec3 c = clamp(ln + chroma, 0.0, 1.0);

  // sharpening: unsharp mask at the radius; Detail lets more of the fine signal through, Masking limits it to edges
  vec3 usm = c0 - n1;
  float grad = length(n1 - n4);
  float mask = u_sharp.w <= 0.0 ? 1.0 : smoothstep(u_sharp.w * 0.06, u_sharp.w * 0.06 + 0.05, grad);
  float lim = mix(0.04, 0.4, u_sharp.z);
  c += clamp(usm, -lim, lim) * u_sharp.x * 2.2 * mask;

  // linear light: white balance and calibration, exposure with a soft shoulder
  vec3 L = toLin(clamp(c, 0.0, 1.0));
  L = max(u_m * L, 0.0) * u_ev;
  L = mix(L, 0.82 + 0.18 * (1.0 - exp(-(L - 0.82) / 0.18)), step(0.82, L));

  // local base luminance (very blurred), in the same light
  float bl;
  if (u_hasBase > 0.5) bl = exp2(texture2D(u_base, uv).r * 14.5 - 14.0);
  else bl = lum(toLin(n4));
  bl = max(bl * u_ev * lum(u_m * vec3(1.0)), 1e-4);
  float y = max(lum(L), 1e-5);
  float lb = log2(bl / 0.18);

  // Highlights and Shadows act on regions (base), so detail inside them is kept
  float bp = toSrgb(vec3(min(bl, 1.0))).r; // base brightness as you see it
  float ws = 1.0 - smoothstep(0.04, 0.56, bp);
  float wh = smoothstep(0.44, 0.97, bp);
  float shift = u_tone.z * 1.4 * ws + u_tone.y * 0.6 * wh;
  // Clarity: local contrast at the base scale, strongest in the midtones; Texture: finer detail
  float detail = log2(y) - log2(bl);
  float mid = 1.0 - smoothstep(1.0, 4.0, abs(lb + 0.5));
  float tex = log2(y) - log2(max(lum(toLin(n4)) * u_ev, 1e-5));
  float ly = log2(y) + shift + detail * u_fx.y * 0.9 * mid + tex * u_fx.x * 0.9;
  L *= exp2(ly - log2(y));

  // Dehaze: remove (or add) a veil estimated from the base
  if (u_fx.z > 0.0) { float a = u_fx.z * 0.35 * smoothstep(0.02, 0.6, bl); L = max((L - a * bl * 0.5) / (1.0 - a * 0.5), 0.0); L = mix(vec3(lum(L)), L, 1.0 + u_fx.z * 0.2); }
  else L = mix(L, vec3(0.85 * bl + 0.25), -u_fx.z * 0.4);

  // lens vignetting correction
  vec2 pc = (uv - 0.5) * vec2(u_ar, 1.0) / (0.5 * sqrt(u_ar * u_ar + 1.0));
  L *= 1.0 + u_lens.y * 0.9 * smoothstep(mix(0.0, 0.8, u_lens.z), 1.0, length(pc));

  // display space
  vec3 d = toSrgb(L);
  // Contrast: an S curve that keeps black and white in place
  d += u_tone.x * 0.115 * sin(6.2831853 * (clamp(d, 0.0, 1.0) - 0.5));
  // Whites and Blacks move the ends of the range
  d += u_tone.w * 0.18 * pow(clamp(d, 0.0, 1.0), vec3(3.0));
  d += u_blacks * 0.16 * pow(clamp(1.0 - d, 0.0, 1.0), vec3(4.0));
  d = clamp(d, 0.0, 1.0);

  // tone curve (parametric then point, then the red, green and blue curves)
  if (u_useLut > 0.5) {
    float s = 255.0 / 256.0, o = 0.5 / 256.0;
    d = vec3(texture2D(u_lut, vec2(d.r * s + o, 0.5)).r, texture2D(u_lut, vec2(d.g * s + o, 0.5)).g, texture2D(u_lut, vec2(d.b * s + o, 0.5)).b);
  }

  // Vibrance (protects already-saturated colours and skin) and Saturation
  vec3 h0 = rgb2hsl(d);
  float skin = bandW(1, h0.x * 360.0) * 0.5;
  float g = lum(d);
  float vib = u_pres.x * (1.0 - h0.y) * (1.0 - skin);
  d = mix(vec3(g), d, max(0.0, 1.0 + u_pres.y + vib));
  d = clamp(d, 0.0, 1.0);

  // Color Mix: hue, saturation and luminance per colour band, blended between neighbouring bands
  vec3 hs = rgb2hsl(d);
  float deg = hs.x * 360.0;
  if (u_useHsl > 0.5) {
    vec3 a = vec3(0.0);
    for (int i = 0; i < 8; i++) a += u_hsl[i] * bandW(i, deg);
    float sat0 = hs.y;
    vec3 h = hs;
    h.x = fract(h.x + a.x * 25.0 / 360.0);
    h.y = clamp(a.y >= 0.0 ? h.y + (1.0 - h.y) * a.y * h.y : h.y * (1.0 + a.y), 0.0, 1.0);
    h.z = clamp(h.z * (1.0 + a.z * 0.75 * sat0), 0.0, 1.0);
    d = hsl2rgb(h);
  }

  // Black & White, with the B&W mix brightening or darkening each source colour
  if (u_mono > 0.0) {
    float m = 0.0;
    for (int i = 0; i < 8; i++) m += u_gray[i] * bandW(i, deg);
    float gy = clamp(lum(d) * (1.0 + m * 0.9 * hs.y), 0.0, 1.0);
    d = mix(d, vec3(gy), u_mono);
  }

  // Calibration: shadow tint (green to magenta)
  float sh = pow(1.0 - lum(d), 2.0);
  d += vec3(0.5, -1.0, 0.5) * u_pres.z * 0.06 * sh;

  // Color Grading: shadows, midtones and highlights split by luminance (Balance moves the split, Blending softens it)
  if (u_useGrade > 0.5) {
    float Y = lum(d), p = clamp(0.5 - u_gopt.y * 0.25, 0.1, 0.9), e = mix(2.5, 0.6, u_gopt.x);
    float wS = pow(clamp(1.0 - Y / p, 0.0, 1.0), e), wH = pow(clamp((Y - p) / (1.0 - p), 0.0, 1.0), e), wM = max(0.0, 1.0 - wS - wH);
    d += tintOf(u_gsh.x) * u_gsh.y * 0.45 * wS + u_gsh.z * 0.25 * wS;
    d += tintOf(u_gmid.x) * u_gmid.y * 0.35 * wM + u_gmid.z * 0.25 * wM;
    d += tintOf(u_ghi.x) * u_ghi.y * 0.45 * wH + u_ghi.z * 0.25 * wH;
    d += tintOf(u_ggl.x) * u_ggl.y * 0.3 + u_ggl.z * 0.2;
  }
  d = clamp(d, 0.0, 1.0);

  // post-crop vignette: Midpoint, Feather, Roundness, and the three styles
  if (u_vig.x != 0.0) {
    vec2 v = (vTexCoord - 0.5) * 2.0;
    v.x *= mix(1.0, u_ar, max(0.0, u_vig.w));
    float n = 2.0 + max(0.0, -u_vig.w) * 6.0;
    float dist = pow(pow(abs(v.x), n) + pow(abs(v.y), n), 1.0 / n);
    float start = mix(0.15, 1.25, u_vig.y), width = mix(0.04, 1.1, u_vig.z);
    float k = smoothstep(start - width * 0.5, start + width * 0.5, dist);
    if (u_vig.x < 0.0) {
      vec3 dark = u_vig2.x > 2.5 ? mix(d, vec3(0.0), -u_vig.x * k) : d * (1.0 + u_vig.x * k);
      if (u_vig2.x < 1.5) dark = mix(dark, d, u_vig2.y * smoothstep(0.6, 1.0, lum(d)));
      if (u_vig2.x > 1.5 && u_vig2.x < 2.5) dark = d * ((lum(d) * (1.0 + u_vig.x * k)) / max(lum(d), 1e-4));
      d = dark;
    } else d = mix(d, vec3(1.0), u_vig.x * k);
  }

  // grain: luminance noise sized relative to the photo, Roughness mixes in coarser, blockier noise
  if (u_grain.x > 0.0) {
    vec2 px = vTexCoord / uTexel / u_grain.y;
    float nz = mix(vnoise(px), hash(floor(px)), u_grain.z * 0.6) - 0.5;
    nz += (vnoise(px * 2.3 + 17.0) - 0.5) * 0.5 * u_grain.z;
    float Y = lum(d);
    d += nz * u_grain.x * 0.32 * (0.35 + 0.65 * (1.0 - abs(Y - 0.5) * 2.0));
  }

  gl_FragColor = vec4(clamp(d, 0.0, 1.0), src.a);
}`;

// --- uniforms from settings ----------------------------------------------------------------
type M3 = number[]; // column-major 3x3
const mul = (a: M3, b: M3): M3 => { const o = new Array(9).fill(0); for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) o[c * 3 + r] += a[k * 3 + r] * b[c * 3 + k]; return o; };
const inv = (m: M3): M3 => {
  const [a, b, c, d, e, f, g, h, i] = m; // columns: (a,b,c), (d,e,f), (g,h,i)
  const A = e * i - f * h, B = -(b * i - c * h), C = b * f - c * e, D = -(d * i - f * g), E = a * i - c * g, F = -(a * f - c * d), G = d * h - e * g, H = -(a * h - b * g), I = a * e - b * d;
  const det = a * A + d * B + g * C;
  return [A, B, C, D, E, F, G, H, I].map(x => x / det);
};
const apply = (m: M3, v: number[]) => [0, 1, 2].map(r => m[r] * v[0] + m[3 + r] * v[1] + m[6 + r] * v[2]);
// White balance gains for Lightroom's Temp/Tint on a rendered photo, from the blackbody colour of the implied light.
const kelvinRgb = (k: number) => { // sRGB-ish colour of a blackbody, linearised (Tanner Helland fit)
  const t = k / 100;
  let r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  let g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  let b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  [r, g, b] = [r, g, b].map(x => Math.min(255, Math.max(1, x)) / 255);
  return [r, g, b].map(x => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
};
const wbMatrix = (temp: number, tint: number): M3 => {
  const ref = kelvinRgb(6500), tk = 1e6 / (1e6 / 6500 + temp * 1.35); // +100 ≈ 135 mired warmer (lower kelvin, more red)
  const t = kelvinRgb(Math.min(40000, Math.max(1500, tk)));
  const gains = [t[0] / ref[0], t[1] / ref[1], t[2] / ref[2]];
  gains[1] *= Math.exp(-tint * 0.0028);
  const y = 0.2126 * gains[0] + 0.7152 * gains[1] + 0.0722 * gains[2];
  return [gains[0] / y, 0, 0, 0, gains[1] / y, 0, 0, 0, gains[2] / y];
};
// Calibration: rotate and saturate the red, green and blue primaries, keeping white white.
const calibration = (d: Dev | undefined): M3 => {
  const prim = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const hue = ['RedHue', 'GreenHue', 'BlueHue'].map(k => num(d, k) / 100), sat = ['RedSaturation', 'GreenSaturation', 'BlueSaturation'].map(k => num(d, k) / 100);
  if (hue.every(h => !h) && sat.every(s => !s)) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const toward = [[1, 2], [2, 0], [0, 1]]; // + hue moves red toward yellow (adds green), green toward cyan, blue toward magenta
  const cols = prim.map((p, i) => {
    const v = [...p];
    const [up, down] = toward[i];
    if (hue[i] > 0) v[up] += hue[i] * 0.35; else v[down] += -hue[i] * 0.35;
    const g = (v[0] + v[1] + v[2]) / 3;
    return v.map(x => g + (x - g) * (1 + sat[i] * 0.6));
  });
  const m: M3 = [...cols[0], ...cols[1], ...cols[2]];
  const s = apply(inv(m), [1, 1, 1]);
  return [...cols[0].map(x => x * s[0]), ...cols[1].map(x => x * s[1]), ...cols[2].map(x => x * s[2])];
};

// --- base layer: blurred log luminance of the photo, computed once per image ----------------------------
const BASE = 96;
const bases = new WeakMap<object, { data: Uint8Array; w: number; h: number; key: string }>();
let baseSeq = 0;
export const baseOf = (src: CanvasImageSource | undefined) => {
  if (!src) return undefined;
  const hit = bases.get(src as object);
  if (hit) return hit;
  try {
    const sw = (src as HTMLImageElement).naturalWidth || (src as HTMLCanvasElement).width, sh = (src as HTMLImageElement).naturalHeight || (src as HTMLCanvasElement).height;
    if (!sw || !sh) return undefined;
    const k = BASE / Math.max(sw, sh), w = Math.max(4, Math.round(sw * k)), h = Math.max(4, Math.round(sh * k));
    const cv = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const g = cv.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(src, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    cv.width = 0; cv.height = 0;
    const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    let f = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) f[i] = Math.log2(Math.max(1e-4, 0.2126 * lin(px[i * 4]) + 0.7152 * lin(px[i * 4 + 1]) + 0.0722 * lin(px[i * 4 + 2])));
    const blur = (a: Float32Array, r: number) => { // separable box blur, twice ≈ gaussian
      const o = new Float32Array(a.length), t = new Float32Array(a.length);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let i = -r; i <= r; i++) { const xx = Math.min(w - 1, Math.max(0, x + i)); s += a[y * w + xx]; n++; } t[y * w + x] = s / n; }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let i = -r; i <= r; i++) { const yy = Math.min(h - 1, Math.max(0, y + i)); s += t[yy * w + x]; n++; } o[y * w + x] = s / n; }
      return o;
    };
    f = blur(blur(f, 2), 2);
    const data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { const v = Math.round(Math.min(1, Math.max(0, (f[i] + 14) / 14.5)) * 255); data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
    const b = { data, w, h, key: `b${++baseSeq}` };
    bases.set(src as object, b);
    return b;
  } catch { return undefined; } // e.g. a tainted canvas: fall back to the in-shader neighbourhood
};

// --- textures, per WebGL context -----------------------------------------------------------------
let texGl: WebGLRenderingContext | null = null;
const textures = new Map<string, WebGLTexture>();
const texture = (gl: WebGLRenderingContext, key: string, w: number, h: number, data: Uint8Array) => {
  if (gl !== texGl) { textures.clear(); texGl = gl; }
  let t = textures.get(key);
  if (!t) {
    if (textures.size > 48) { textures.forEach(x => gl.deleteTexture(x)); textures.clear(); }
    t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    textures.set(key, t);
  }
  return t;
};

const UNIFORMS = ['uTexel', 'u_lut', 'u_base', 'u_m', 'u_ev', 'u_hasBase', 'u_useLut', 'u_useHsl', 'u_mono', 'u_useGrade', 'u_ar', 'u_tone', 'u_blacks',
  'u_fx', 'u_pres', 'u_hsl', 'u_gray', 'u_gsh', 'u_gmid', 'u_ghi', 'u_ggl', 'u_gopt', 'u_sharp', 'u_nr', 'u_nr2', 'u_vig', 'u_vig2', 'u_grain', 'u_lens', 'u_geo', 'u_geo2'];

/* eslint-disable @typescript-eslint/no-explicit-any */
const Base = (fabric.Image.filters as any).BaseFilter;
const Develop = (fabric as any).util.createClass(Base, {
  type: 'Develop',
  mainParameter: 'p',
  fragmentSource,
  initialize(options?: unknown) { this.p = {}; this.callSuper('initialize', options); },
  isNeutralState() { return isNeutralDev(this.p); },
  getUniformLocations(gl: WebGLRenderingContext, program: WebGLProgram) {
    const loc: Record<string, WebGLUniformLocation | null> = {};
    UNIFORMS.forEach(u => { loc[u] = gl.getUniformLocation(program, u); });
    return loc;
  },
  sendUniformData(gl: WebGLRenderingContext, loc: Record<string, WebGLUniformLocation | null>) {
    const d = this.p as Dev, w = this._w || 1, h = this._h || 1, f = (k: string) => num(d, k);
    gl.uniform2f(loc.uTexel, 1 / w, 1 / h);
    gl.uniform1f(loc.u_ar, w / h);
    gl.uniformMatrix3fv(loc.u_m, false, mul(wbMatrix(f('IncrementalTemperature'), f('IncrementalTint')), calibration(d)));
    gl.uniform1f(loc.u_ev, 2 ** f('Exposure2012'));
    gl.uniform4f(loc.u_tone, f('Contrast2012') / 100, f('Highlights2012') / 100, f('Shadows2012') / 100, f('Whites2012') / 100);
    gl.uniform1f(loc.u_blacks, f('Blacks2012') / 100);
    gl.uniform3f(loc.u_fx, f('Texture') / 100, f('Clarity2012') / 100, f('Dehaze') / 100);
    gl.uniform3f(loc.u_pres, f('Vibrance') / 100, f('Saturation') / 100, f('ShadowTint') / 100);
    const hsl = BANDS.flatMap(b => [f(`HueAdjustment${b}`), f(`SaturationAdjustment${b}`), f(`LuminanceAdjustment${b}`)].map(v => v / 100));
    gl.uniform3fv(loc.u_hsl, hsl);
    gl.uniform1f(loc.u_useHsl, hsl.some(v => v) ? 1 : 0);
    gl.uniform1fv(loc.u_gray, BANDS.map(b => f(`GrayMixer${b}`) / 100));
    gl.uniform1f(loc.u_mono, mono(d) ? 1 : 0);
    const wh = WHEELS.map(wl => [f(`ColorGrade${wl}Hue`), f(`ColorGrade${wl}Sat`) / 100, f(`ColorGrade${wl}Lum`) / 100]);
    (['u_gsh', 'u_gmid', 'u_ghi', 'u_ggl'] as const).forEach((u, i) => gl.uniform3f(loc[u], wh[i][0], wh[i][1], wh[i][2]));
    gl.uniform1f(loc.u_useGrade, wh.some(x => x[1] || x[2]) ? 1 : 0);
    gl.uniform2f(loc.u_gopt, f('ColorGradeBlending') / 100, f('SplitToningBalance') / 100);
    const scale = Math.max(w, h) / 1600; // detail radii are tuned for a 1600 px working copy and scale with the photo
    gl.uniform4f(loc.u_sharp, f('Sharpness') / 150, f('SharpenRadius') * Math.max(0.6, scale), f('SharpenDetail') / 100, f('SharpenEdgeMasking') / 100);
    gl.uniform4f(loc.u_nr, f('LuminanceSmoothing') / 100, f('LuminanceNoiseReductionDetail') / 100, f('LuminanceNoiseReductionContrast') / 100, f('ColorNoiseReduction') / 100);
    gl.uniform2f(loc.u_nr2, f('ColorNoiseReductionDetail') / 100, f('ColorNoiseReductionSmoothness') / 100);
    gl.uniform4f(loc.u_vig, f('PostCropVignetteAmount') / 100, f('PostCropVignetteMidpoint') / 100, f('PostCropVignetteFeather') / 100, f('PostCropVignetteRoundness') / 100);
    gl.uniform2f(loc.u_vig2, f('PostCropVignetteStyle'), f('PostCropVignetteHighlightContrast') / 100);
    gl.uniform3f(loc.u_grain, f('GrainAmount') / 100, (0.7 + f('GrainSize') / 25) * Math.max(0.5, scale), f('GrainFrequency') / 100);
    gl.uniform3f(loc.u_lens, f('LensManualDistortionAmount') / 100, f('VignetteAmount') / 100, f('VignetteMidpoint') / 100);
    gl.uniform4f(loc.u_geo, f('PerspectiveVertical') / 100, f('PerspectiveHorizontal') / 100, f('PerspectiveRotate') * Math.PI / 180, f('PerspectiveAspect') / 100);
    gl.uniform3f(loc.u_geo2, f('PerspectiveScale') / 100, f('PerspectiveX') / 100, f('PerspectiveY') / 100);
    // lookup textures: the tone curves on unit 1, the base layer on unit 2
    const lut = buildLut(d);
    gl.uniform1f(loc.u_useLut, lut ? 1 : 0);
    if (lut) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texture(gl, `lut${JSON.stringify(CURVE_KEYS.map(k => d[k] ?? null))}`, 256, 1, lut)); gl.uniform1i(loc.u_lut, 1); }
    const b = this.base as ReturnType<typeof baseOf>;
    gl.uniform1f(loc.u_hasBase, b ? 1 : 0);
    if (b) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texture(gl, b.key, b.w, b.h, b.data)); gl.uniform1i(loc.u_base, 2); }
    gl.activeTexture(gl.TEXTURE0);
  },
  applyToWebGL(options: { sourceWidth: number; sourceHeight: number }) {
    this._w = options.sourceWidth; this._h = options.sourceHeight;
    Base.prototype.applyToWebGL.call(this, options);
  },
  applyTo2d() { /* see shortcut above */ },
  toObject() { return { type: this.type, p: this.p }; }, // the base layer is rebuilt on load
});
Develop.fromObject = Base.fromObject;
(fabric.Image.filters as any).Develop = Develop;
// Designs saved before the Lightroom engine carry an 'Adjust' filter; it loads as a no-op and the edit is re-applied.
const Legacy = (fabric as any).util.createClass(Base, { type: 'Adjust', isNeutralState: () => true, applyTo2d() { /* no-op */ } });
Legacy.fromObject = (o: unknown, cb?: (f: unknown) => void) => { const f = new Legacy(); cb?.(f); return f; };
(fabric.Image.filters as any).Adjust = Legacy;
/* eslint-enable @typescript-eslint/no-explicit-any */

const CURVE_KEYS = ['ParametricShadows', 'ParametricDarks', 'ParametricLights', 'ParametricHighlights', 'ParametricShadowSplit', 'ParametricMidtoneSplit', 'ParametricHighlightSplit', 'ToneCurvePV2012', 'ToneCurvePV2012Red', 'ToneCurvePV2012Green', 'ToneCurvePV2012Blue'];

// A filter for these settings. Pass the photo's source element so local tone mapping uses its base layer.
export const makeDevelopFilter = (dev: Dev, source?: CanvasImageSource) => {
  const f = new Develop({ p: dev });
  f.base = baseOf(source);
  return f;
};
