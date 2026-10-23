// Pure geometry for crop + straighten. No DOM.
// Frame: "A" is the photo after flips/90° turns. Straightening rotates the photo by `deg` about A's center
// underneath a fixed crop rect, and the rect must stay fully inside both A and the rotated photo (no blank corners).
export interface Rect { x: number; y: number; w: number; h: number }
export type Op = 'r' | 'h' | 'v'; // quarter turn clockwise, flip horizontal, flip vertical
export interface CropParams { ops: string; deg: number; rect: Rect; ratio: number | null }

const rad = (d: number) => (d * Math.PI) / 180;

export const inside = (r: Rect, deg: number, aw: number, ah: number) => {
  const eps = 0.5;
  if (r.x < -eps || r.y < -eps || r.x + r.w > aw + eps || r.y + r.h > ah + eps) return false;
  const c = Math.cos(rad(-deg)), s = Math.sin(rad(-deg));
  return [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].every(([px, py]) => {
    const dx = px - aw / 2, dy = py - ah / 2;
    return Math.abs(dx * c - dy * s) <= aw / 2 + eps && Math.abs(dx * s + dy * c) <= ah / 2 + eps;
  });
};

// Largest centered rect of a given aspect ratio (w/h) that fits.
export const maxRect = (ratio: number, deg: number, aw: number, ah: number): Rect => {
  const make = (w: number): Rect => { const h = w / ratio; return { x: (aw - w) / 2, y: (ah - h) / 2, w, h }; };
  let lo = 0, hi = Math.min(aw, ah * ratio);
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (inside(make(mid), deg, aw, ah)) lo = mid; else hi = mid; }
  return make(lo);
};

// Shrink a rect about its center until it fits (used when the straighten angle grows).
export const fitRect = (r: Rect, deg: number, aw: number, ah: number): Rect => {
  if (inside(r, deg, aw, ah)) return r;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const at = (f: number): Rect => ({ x: cx - (r.w * f) / 2, y: cy - (r.h * f) / 2, w: r.w * f, h: r.h * f });
  if (!inside(at(0.001), deg, aw, ah)) return maxRect(r.w / r.h, deg, aw, ah);
  let lo = 0.001, hi = 1;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (inside(at(mid), deg, aw, ah)) lo = mid; else hi = mid; }
  return at(lo);
};

// Carry a rect (and the straighten angle) through one op applied to A. aw/ah are A's size before the op.
export const applyOpToRect = (r: Rect, deg: number, op: Op, aw: number, ah: number) => {
  if (op === 'r') return { rect: { x: ah - (r.y + r.h), y: r.x, w: r.h, h: r.w }, deg, aw: ah, ah: aw };
  if (op === 'h') return { rect: { ...r, x: aw - (r.x + r.w) }, deg: -deg, aw, ah };
  return { rect: { ...r, y: ah - (r.y + r.h) }, deg: -deg, aw, ah };
};

// Append an op, cancelling pairs and full turns so the list stays short.
export const pushOp = (ops: string, op: Op) => {
  if (op === 'r') return ops.endsWith('rrr') ? ops.slice(0, -3) : ops + 'r';
  return ops.endsWith(op) ? ops.slice(0, -1) : ops + op;
};

export const isIdentity = (p: CropParams, w: number, h: number) =>
  p.ops === '' && p.deg === 0 && Math.abs(p.rect.x) < 1 && Math.abs(p.rect.y) < 1 && Math.abs(p.rect.w - w) < 1 && Math.abs(p.rect.h - h) < 1;
