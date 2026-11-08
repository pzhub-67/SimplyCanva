// One WebGL pass for every photo adjustment, registered as a Fabric image filter so it
// serializes with the design (the params travel as `p`). The tone curve rides in a 256x1 lookup texture.
// shortcut: no CPU fallback. Without WebGL the photo shows unedited; add a 2D path if that matters.
import { fabric } from 'fabric';
import { Params, KEYS, buildLut } from './photoModel';

const decls = KEYS.map(k => `uniform float u_${k};`).join('\n');

const fragmentSource = `
precision highp float;
uniform sampler2D uTexture;
uniform sampler2D u_lut;
uniform vec2 uTexel;
uniform float u_useLut, u_useHsl, u_mono;
uniform vec3 u_hsl[8];
uniform vec3 u_gsh, u_gmid, u_ghi, u_ggl;
uniform vec2 u_gopt;
${decls}
varying vec2 vTexCoord;
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
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
// Colour mixer band centres in degrees: red, orange, yellow, green, aqua, blue, purple, magenta.
float centre(int i) { return i == 0 ? 0.0 : i == 1 ? 30.0 : i == 2 ? 60.0 : i == 3 ? 120.0 : i == 4 ? 180.0 : i == 5 ? 240.0 : i == 6 ? 270.0 : 300.0; }
float wrap(float d) { return d > 180.0 ? d - 360.0 : d < -180.0 ? d + 360.0 : d; }
vec3 tintOf(float hdeg) { return hsl2rgb(vec3(hdeg / 360.0, 1.0, 0.5)) - 0.5; }
float rand(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec4 src = texture2D(uTexture, vTexCoord);
  vec3 c = src.rgb;
  vec2 tx = vec2(uTexel.x, 0.0);
  vec2 ty = vec2(0.0, uTexel.y);
  vec3 n = (texture2D(uTexture, vTexCoord + tx).rgb + texture2D(uTexture, vTexCoord - tx).rgb
          + texture2D(uTexture, vTexCoord + ty).rgb + texture2D(uTexture, vTexCoord - ty).rgb) * 0.25;
  vec3 w = (texture2D(uTexture, vTexCoord + tx * 4.0).rgb + texture2D(uTexture, vTexCoord - tx * 4.0).rgb
          + texture2D(uTexture, vTexCoord + ty * 4.0).rgb + texture2D(uTexture, vTexCoord - ty * 4.0).rgb
          + texture2D(uTexture, vTexCoord + (tx + ty) * 3.0).rgb + texture2D(uTexture, vTexCoord - (tx + ty) * 3.0).rgb
          + texture2D(uTexture, vTexCoord + (tx - ty) * 3.0).rgb + texture2D(uTexture, vTexCoord - (tx - ty) * 3.0).rgb) * 0.125;

  // detail and effects that work on local contrast
  c = mix(c, n, u_noiseReduction * 0.8);
  c += (c - w) * u_definition * 0.9;
  c += (n - w) * u_texture * 0.8;
  c += (c - n) * max(u_sharpness, -0.5) * 1.4;

  // light
  c *= exp2(u_exposure * 1.5);
  float l = lum(c);
  c += u_brilliance * (0.22 * (1.0 - l) * (1.0 - l) - 0.10 * l * l);
  l = lum(c);
  c += u_highlights * 0.35 * smoothstep(0.45, 1.0, l);
  c += u_shadows * 0.30 * (1.0 - smoothstep(0.0, 0.55, l));
  c += u_whites * 0.25 * smoothstep(0.6, 1.05, l);
  c += u_blacks * 0.18 * (1.0 - smoothstep(0.0, 0.35, l));
  c = (c - 0.5) * (1.0 + u_contrast * 0.6) + 0.5;
  c = pow(max(c, 0.0), vec3(exp2(-u_brightness * 0.6)));
  float bp = u_blackPoint * 0.12;
  c = (c - bp) / (1.0 - bp);
  if (u_dehaze > 0.0) { float d = u_dehaze * 0.12; c = (c - d) / (1.0 - d); c = mix(vec3(lum(c)), c, 1.0 + u_dehaze * 0.25); }
  else c = mix(c, vec3(0.78), -u_dehaze * 0.35);

  // tone curve
  c = clamp(c, 0.0, 1.0);
  if (u_useLut > 0.5) {
    float s = 255.0 / 256.0, o = 0.5 / 256.0;
    c = vec3(texture2D(u_lut, vec2(c.r * s + o, 0.5)).r, texture2D(u_lut, vec2(c.g * s + o, 0.5)).g, texture2D(u_lut, vec2(c.b * s + o, 0.5)).b);
  }

  // color
  float g = lum(c);
  float chroma = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  c = mix(vec3(g), c, max(0.0, 1.0 + u_saturation + u_vibrance * (1.0 - chroma)));
  c.r += u_warmth * 0.10 + u_tint * 0.04;
  c.b += -u_warmth * 0.10 + u_tint * 0.04;
  c.g -= u_tint * 0.08;
  c = clamp(c, 0.0, 1.0);

  // colour mixer: each band pulls hue, saturation and luminance, blended linearly between neighbouring bands
  if (u_useHsl > 0.5) {
    vec3 h = rgb2hsl(c);
    float deg = h.x * 360.0;
    vec3 a = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float ce = centre(i), d = wrap(deg - ce);
      float span = d >= 0.0 ? wrap(centre(i == 7 ? 0 : i + 1) - ce) : wrap(ce - centre(i == 0 ? 7 : i - 1));
      if (span <= 0.0) span += 360.0;
      a += u_hsl[i] * max(0.0, 1.0 - abs(d) / span);
    }
    float sat0 = h.y;
    h.x = fract(h.x + a.x * 30.0 / 360.0);
    h.y = clamp(a.y >= 0.0 ? h.y + (1.0 - h.y) * a.y * h.y : h.y * (1.0 + a.y), 0.0, 1.0);
    h.z = clamp(h.z + a.z * 0.3 * sat0 * (1.0 - abs(h.z - 0.5)), 0.0, 1.0);
    c = hsl2rgb(h);
  }
  c = mix(c, vec3(lum(c)), u_mono);

  // colour grading: shadows, midtones, highlights and global tints, split by luminance (balance moves the split)
  if (u_gsh.y + u_gmid.y + u_ghi.y + u_ggl.y + abs(u_gsh.z) + abs(u_gmid.z) + abs(u_ghi.z) + abs(u_ggl.z) > 0.0) {
    float L = lum(c), p = clamp(0.5 - u_gopt.y * 0.25, 0.1, 0.9), e = mix(2.5, 0.6, u_gopt.x);
    float ws = pow(clamp(1.0 - L / p, 0.0, 1.0), e), wh = pow(clamp((L - p) / (1.0 - p), 0.0, 1.0), e), wm = max(0.0, 1.0 - ws - wh);
    c += tintOf(u_gsh.x) * u_gsh.y * 0.45 * ws + u_gsh.z * 0.25 * ws;
    c += tintOf(u_gmid.x) * u_gmid.y * 0.35 * wm + u_gmid.z * 0.25 * wm;
    c += tintOf(u_ghi.x) * u_ghi.y * 0.45 * wh + u_ghi.z * 0.25 * wh;
    c += tintOf(u_ggl.x) * u_ggl.y * 0.3 + u_ggl.z * 0.2;
  }

  // vignette and grain
  float vm = smoothstep(0.25, 0.75, length(vTexCoord - 0.5) * 1.2);
  c = u_vignette >= 0.0 ? c * (1.0 - u_vignette * 0.75 * vm) : mix(c, vec3(1.0), -u_vignette * 0.5 * vm);
  if (u_grain > 0.0) c += (rand(floor(vTexCoord / uTexel / 1.5)) - 0.5) * u_grain * 0.22;

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), src.a);
}`;

// Lookup textures, one per distinct curve set, kept per WebGL context.
let lutGl: WebGLRenderingContext | null = null;
const luts = new Map<string, WebGLTexture>();
const lutTexture = (gl: WebGLRenderingContext, curves: NonNullable<Params['curves']>) => {
  if (gl !== lutGl) { luts.clear(); lutGl = gl; }
  const key = JSON.stringify(curves);
  let t = luts.get(key);
  if (!t) {
    if (luts.size > 24) { luts.forEach(x => gl.deleteTexture(x)); luts.clear(); }
    t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, buildLut(curves));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    luts.set(key, t);
  }
  return t;
};

const UNIFORMS = ['uTexel', 'u_lut', 'u_useLut', 'u_useHsl', 'u_mono', 'u_hsl', 'u_gsh', 'u_gmid', 'u_ghi', 'u_ggl', 'u_gopt'];

/* eslint-disable @typescript-eslint/no-explicit-any */
const Base = (fabric.Image.filters as any).BaseFilter;
const Adjust = (fabric as any).util.createClass(Base, {
  type: 'Adjust',
  mainParameter: 'p',
  fragmentSource,
  initialize(options?: unknown) { this.p = {}; this.callSuper('initialize', options); },
  isNeutralState() { const p = this.p; return KEYS.every(k => !p[k]) && !p.hsl && !p.curves?.length && !p.grade && !p.mono; },
  getUniformLocations(gl: WebGLRenderingContext, program: WebGLProgram) {
    const loc: Record<string, WebGLUniformLocation | null> = {};
    UNIFORMS.forEach(u => { loc[u] = gl.getUniformLocation(program, u); });
    KEYS.forEach(k => { loc[`u_${k}`] = gl.getUniformLocation(program, `u_${k}`); });
    return loc;
  },
  sendUniformData(gl: WebGLRenderingContext, loc: Record<string, WebGLUniformLocation | null>) {
    const p = this.p as Partial<Params>;
    KEYS.forEach(k => gl.uniform1f(loc[`u_${k}`], (p[k] ?? 0) / 100));
    gl.uniform2f(loc.uTexel, 1 / (this._w || 1), 1 / (this._h || 1));
    const hsl = p.hsl?.length === 24 ? p.hsl : new Array(24).fill(0);
    gl.uniform3fv(loc.u_hsl, hsl.map(v => v / 100));
    gl.uniform1f(loc.u_useHsl, p.hsl ? 1 : 0);
    gl.uniform1f(loc.u_mono, p.mono ?? 0);
    const g = p.grade?.length === 14 ? p.grade : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50, 0];
    (['u_gsh', 'u_gmid', 'u_ghi', 'u_ggl'] as const).forEach((u, i) => gl.uniform3f(loc[u], g[i * 3], g[i * 3 + 1] / 100, g[i * 3 + 2] / 100));
    gl.uniform2f(loc.u_gopt, g[12] / 100, g[13] / 100);
    const useLut = !!p.curves?.length;
    gl.uniform1f(loc.u_useLut, useLut ? 1 : 0);
    if (useLut) {
      const t = lutTexture(gl, p.curves!);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(loc.u_lut, 1);
      gl.activeTexture(gl.TEXTURE0);
    }
  },
  applyToWebGL(options: { sourceWidth: number; sourceHeight: number }) {
    this._w = options.sourceWidth; this._h = options.sourceHeight;
    Base.prototype.applyToWebGL.call(this, options);
  },
  applyTo2d() { /* see shortcut above */ },
});
Adjust.fromObject = Base.fromObject;
(fabric.Image.filters as any).Adjust = Adjust;

export const makeAdjustFilter = (p: Params) => new Adjust({ p });
