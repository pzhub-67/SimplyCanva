// Starter designs. Built from real Fabric objects so they save and load exactly like anything the user makes.
import { fabric } from 'fabric';
import type { Page } from './model';

interface Spec { id: string; name: string; w: number; h: number; bg: string; build: (w: number, h: number) => fabric.Object[] }

const text = (s: string, o: Partial<fabric.ITextOptions> & { family?: string }) =>
  new fabric.IText(s, { fontFamily: o.family ?? 'Poppins', originX: 'center', originY: 'center', textAlign: 'center', ...o });
const grad = (w: number, h: number, a: string, b: string) =>
  new fabric.Gradient({ type: 'linear', gradientUnits: 'pixels', coords: { x1: 0, y1: 0, x2: w, y2: h }, colorStops: [{ offset: 0, color: a }, { offset: 1, color: b }] });

export const TEMPLATES: Spec[] = [
  { id: 'quote', name: 'Quote', w: 1080, h: 1080, bg: '#16211f', build: (w, h) => [
    new fabric.Rect({ left: w / 2 - 60, top: h * 0.2, width: 120, height: 10, fill: '#3cc3b9' }),
    text('Make it simple,\nmake it yours.', { left: w / 2, top: h / 2, fontSize: 96, fontWeight: 'bold', fill: '#ffffff', family: 'Playfair Display' }),
    text('— Your name', { left: w / 2, top: h * 0.78, fontSize: 40, fill: '#9db1ad' }),
  ] },
  { id: 'sale', name: 'Sale', w: 1080, h: 1080, bg: '#ffffff', build: (w, h) => [
    new fabric.Rect({ left: 0, top: 0, width: w, height: h, fill: grad(w, h, '#ff7a18', '#af002d') }),
    text('SALE', { left: w / 2, top: h * 0.4, fontSize: 280, fill: '#ffffff', family: 'Bebas Neue' }),
    text('Up to 50% off', { left: w / 2, top: h * 0.62, fontSize: 80, fontWeight: 'bold', fill: '#ffffff' }),
    new fabric.Rect({ left: w / 2 - 220, top: h * 0.76, width: 440, height: 110, rx: 55, ry: 55, fill: '#ffffff' }),
    text('Shop now', { left: w / 2, top: h * 0.76 + 55, fontSize: 48, fontWeight: 'bold', fill: '#af002d' }),
  ] },
  { id: 'story', name: 'Story title', w: 1080, h: 1920, bg: '#fde68a', build: (w, h) => [
    text('Big news', { left: w / 2, top: h * 0.4, fontSize: 200, fill: '#16211f', family: 'Lobster' }),
    text('Add your words here', { left: w / 2, top: h * 0.52, fontSize: 64, fill: '#16211f' }),
    new fabric.Rect({ left: w / 2 - 80, top: h * 0.6, width: 160, height: 12, fill: '#16211f' }),
  ] },
  { id: 'slide', name: 'Title slide', w: 1920, h: 1080, bg: '#ffffff', build: (w, h) => [
    new fabric.Rect({ left: 0, top: 0, width: 40, height: h, fill: '#0b7f78' }),
    text('Your title here', { left: 160, top: h * 0.42, originX: 'left', textAlign: 'left', fontSize: 150, fontWeight: 'bold', fill: '#16211f', family: 'Montserrat' }),
    text('A short subtitle that explains it', { left: 160, top: h * 0.6, originX: 'left', textAlign: 'left', fontSize: 56, fill: '#5a6a67' }),
  ] },
  { id: 'thumb', name: 'Thumbnail', w: 1280, h: 720, bg: '#0f172a', build: (w, h) => [
    new fabric.Rect({ left: 0, top: h - 40, width: w, height: 40, fill: grad(w, 40, '#2193b0', '#6dd5ed') }),
    text('WATCH THIS', { left: w / 2, top: h * 0.42, fontSize: 190, fill: '#ffffff', family: 'Oswald' }),
    text('before you start', { left: w / 2, top: h * 0.68, fontSize: 70, fill: '#6dd5ed' }),
  ] },
];

export const templatePage = (t: Spec): Page => ({
  id: crypto.randomUUID(), width: t.w, height: t.h, background: t.bg,
  objects: t.build(t.w, t.h).map(o => o.toObject(['edit', 'orig', 'locked']) as Record<string, unknown>),
});
