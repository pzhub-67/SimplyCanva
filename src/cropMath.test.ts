import { expect, test } from 'vitest';
import { applyOpToRect, fitRect, inside, isIdentity, maxRect, pushOp } from './cropMath';

const W = 800, H = 600;

test('full frame fits only when not tilted', () => {
  expect(inside({ x: 0, y: 0, w: W, h: H }, 0, W, H)).toBe(true);
  expect(inside({ x: 0, y: 0, w: W, h: H }, 5, W, H)).toBe(false);
});

test('maxRect keeps the ratio and shrinks as the tilt grows', () => {
  const flat = maxRect(1, 0, W, H);
  const tilted = maxRect(1, 20, W, H);
  expect(flat.w).toBeCloseTo(600, 0);
  expect(tilted.w).toBeLessThan(flat.w);
  expect(tilted.w / tilted.h).toBeCloseTo(1, 5);
  expect(inside(tilted, 20, W, H)).toBe(true);
});

test('fitRect shrinks about the center until it fits', () => {
  const r = fitRect({ x: 0, y: 0, w: W, h: H }, 10, W, H);
  expect(inside(r, 10, W, H)).toBe(true);
  expect(r.x + r.w / 2).toBeCloseTo(W / 2, 3);
  expect(r.w / r.h).toBeCloseTo(W / H, 3);
});

test('quarter turn then three more returns the same rect', () => {
  let s = { rect: { x: 100, y: 50, w: 300, h: 200 }, deg: 7, aw: W, ah: H };
  for (let i = 0; i < 4; i++) s = applyOpToRect(s.rect, s.deg, 'r', s.aw, s.ah);
  expect(s.rect).toEqual({ x: 100, y: 50, w: 300, h: 200 });
  expect(s).toMatchObject({ aw: W, ah: H, deg: 7 });
});

test('flips mirror the rect and negate the tilt', () => {
  const h = applyOpToRect({ x: 100, y: 50, w: 300, h: 200 }, 7, 'h', W, H);
  expect(h.rect).toEqual({ x: 400, y: 50, w: 300, h: 200 });
  expect(h.deg).toBe(-7);
  const v = applyOpToRect({ x: 100, y: 50, w: 300, h: 200 }, 7, 'v', W, H);
  expect(v.rect).toEqual({ x: 100, y: 350, w: 300, h: 200 });
});

test('ops cancel in pairs and full turns', () => {
  expect(pushOp(pushOp('', 'h'), 'h')).toBe('');
  expect(pushOp('rrr', 'r')).toBe('');
  expect(pushOp('r', 'v')).toBe('rv');
});

test('identity check', () => {
  expect(isIdentity({ ops: '', deg: 0, rect: { x: 0, y: 0, w: W, h: H }, ratio: null }, W, H)).toBe(true);
  expect(isIdentity({ ops: 'r', deg: 0, rect: { x: 0, y: 0, w: W, h: H }, ratio: null }, W, H)).toBe(false);
  expect(isIdentity({ ops: '', deg: 0, rect: { x: 10, y: 0, w: W - 10, h: H }, ratio: null }, W, H)).toBe(false);
});
