// One WebGL pass for every photo adjustment, registered as a Fabric image filter so it
// serializes with the design (the params travel as `p`).
// shortcut: no CPU fallback. Without WebGL the photo shows unedited; add a 2D path if that matters.
import { fabric } from 'fabric';
import { Adj, KEYS } from './photoModel';

const decls = KEYS.map(k => `uniform float u_${k};`).join('\n');

const fragmentSource = `
precision highp float;
uniform sampler2D uTexture;
uniform vec2 uTexel;
${decls}
varying vec2 vTexCoord;
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
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

  // detail
  c = mix(c, n, u_noiseReduction * 0.8);
  c += (c - w) * u_definition * 0.9;
  c += (c - n) * u_sharpness * 1.4;

  // tone
  c *= exp2(u_exposure * 1.5);
  float l = lum(c);
  c += u_brilliance * (0.22 * (1.0 - l) * (1.0 - l) - 0.10 * l * l);
  l = lum(c);
  c += u_highlights * 0.35 * smoothstep(0.45, 1.0, l);
  c += u_shadows * 0.30 * (1.0 - smoothstep(0.0, 0.55, l));
  c = (c - 0.5) * (1.0 + u_contrast * 0.6) + 0.5;
  c = pow(max(c, 0.0), vec3(exp2(-u_brightness * 0.6)));
  float bp = u_blackPoint * 0.12;
  c = (c - bp) / (1.0 - bp);

  // color
  float g = lum(c);
  float chroma = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  c = mix(vec3(g), c, max(0.0, 1.0 + u_saturation + u_vibrance * (1.0 - chroma)));
  c.r += u_warmth * 0.10 + u_tint * 0.04;
  c.b += -u_warmth * 0.10 + u_tint * 0.04;
  c.g -= u_tint * 0.08;

  // vignette
  float vm = smoothstep(0.25, 0.75, length(vTexCoord - 0.5) * 1.2);
  c = u_vignette >= 0.0 ? c * (1.0 - u_vignette * 0.75 * vm) : mix(c, vec3(1.0), -u_vignette * 0.5 * vm);

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), src.a);
}`;

/* eslint-disable @typescript-eslint/no-explicit-any */
const Base = (fabric.Image.filters as any).BaseFilter;
const Adjust = (fabric as any).util.createClass(Base, {
  type: 'Adjust',
  mainParameter: 'p',
  fragmentSource,
  initialize(options?: unknown) { this.p = {}; this.callSuper('initialize', options); },
  isNeutralState() { return KEYS.every(k => !(this.p[k])); },
  getUniformLocations(gl: WebGLRenderingContext, program: WebGLProgram) {
    const loc: Record<string, WebGLUniformLocation | null> = { uTexel: gl.getUniformLocation(program, 'uTexel') };
    KEYS.forEach(k => { loc[`u_${k}`] = gl.getUniformLocation(program, `u_${k}`); });
    return loc;
  },
  sendUniformData(gl: WebGLRenderingContext, loc: Record<string, WebGLUniformLocation | null>) {
    KEYS.forEach(k => gl.uniform1f(loc[`u_${k}`], (this.p[k] ?? 0) / 100));
    gl.uniform2f(loc.uTexel, 1 / (this._w || 1), 1 / (this._h || 1));
  },
  applyToWebGL(options: { sourceWidth: number; sourceHeight: number }) {
    this._w = options.sourceWidth; this._h = options.sourceHeight;
    Base.prototype.applyToWebGL.call(this, options);
  },
  applyTo2d() { /* see shortcut above */ },
});
Adjust.fromObject = Base.fromObject;
(fabric.Image.filters as any).Adjust = Adjust;

export const makeAdjustFilter = (p: Adj) => new Adjust({ p });
