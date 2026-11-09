// Test page for the photo engine: window.probe(dev) renders a grey ramp and colour patches through develop.ts and
// returns sRGB values, so each Lightroom setting's response can be measured (scripts/probe.py). Not part of the app.
import { fabric } from 'fabric';
import { makeDevelopFilter } from '../src/develop';
import type { Dev } from '../src/photoModel';

const W = 256, H = 64;
const src = document.createElement('canvas');
src.width = W; src.height = H;
const g = src.getContext('2d')!;
for (let x = 0; x < W; x++) { g.fillStyle = `rgb(${x},${x},${x})`; g.fillRect(x, 0, 1, 32); }
const patches = ['#c8783c', '#3c78c8', '#d9a07f', '#4a8f3a', '#b03030', '#808080', '#f0f0f0', '#202020'];
patches.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * 32, 32, 32, 32); });
const url = src.toDataURL();

(window as unknown as { probe: (d: Dev) => Promise<unknown> }).probe = async (dev: Dev) => {
  const im = await new Promise<fabric.Image>(r => fabric.Image.fromURL(url, x => r(x)));
  im.filters = [makeDevelopFilter(dev, im.getElement())];
  im.applyFilters();
  const out = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const o = out.getContext('2d', { willReadFrequently: true })!;
  o.drawImage(im.getElement() as CanvasImageSource, 0, 0);
  const at = (x: number, y: number) => [...o.getImageData(x, y, 1, 1).data.slice(0, 3)];
  return { ramp: [10, 25, 50, 75, 90].map(p => at(Math.round(p * 2.55), 16)[0]), patches: patches.map((_, i) => at(i * 32 + 16, 48)) };
};
