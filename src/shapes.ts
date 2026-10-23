// Basic shapes. Everything is a filled Fabric object, so the same Color, Style and handles work on all of them.
import { fabric } from 'fabric';

const poly = (n: number, r: number, inner = 1) => {
  const pts: { x: number; y: number }[] = [];
  const steps = inner === 1 ? n : n * 2;
  for (let i = 0; i < steps; i++) {
    const a = (-90 + (i * 360) / steps) * (Math.PI / 180), rr = i % 2 && inner !== 1 ? r * inner : r;
    pts.push({ x: r + rr * Math.cos(a), y: r + rr * Math.sin(a) });
  }
  return new fabric.Polygon(pts);
};

export interface ShapeDef { id: string; label: string; icon: string; make: (s: number) => fabric.Object }

export const SHAPES: ShapeDef[] = [
  { id: 'rect', label: 'Rectangle', icon: '<rect x="3" y="6" width="18" height="12" rx="1"/>', make: s => new fabric.Rect({ width: s, height: Math.round(s * 0.7) }) },
  { id: 'rounded', label: 'Rounded', icon: '<rect x="3" y="6" width="18" height="12" rx="5"/>', make: s => new fabric.Rect({ width: s, height: Math.round(s * 0.7), rx: s * 0.12, ry: s * 0.12 }) },
  { id: 'circle', label: 'Circle', icon: '<circle cx="12" cy="12" r="9"/>', make: s => new fabric.Circle({ radius: s / 2 }) },
  { id: 'triangle', label: 'Triangle', icon: '<path d="M12 4 21 20H3z"/>', make: s => new fabric.Triangle({ width: s, height: s }) },
  { id: 'diamond', label: 'Diamond', icon: '<path d="M12 3 21 12 12 21 3 12z"/>', make: s => poly(4, s / 2) },
  { id: 'pentagon', label: 'Pentagon', icon: '<path d="M12 3 21 9.5 17.5 20h-11L3 9.5z"/>', make: s => poly(5, s / 2) },
  { id: 'hexagon', label: 'Hexagon', icon: '<path d="M12 3 20 7.5v9L12 21 4 16.5v-9z"/>', make: s => poly(6, s / 2) },
  { id: 'star', label: 'Star', icon: '<path d="m12 3 2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8z"/>', make: s => poly(5, s / 2, 0.42) },
  { id: 'heart', label: 'Heart', icon: '<path d="M12 20C5 15 3 11 3 8a4.5 4.5 0 0 1 9-1 4.5 4.5 0 0 1 9 1c0 3-2 7-9 12z"/>',
    make: s => { const h = new fabric.Path('M12 21C5 15 2 11 2 7.5A5 5 0 0 1 12 6a5 5 0 0 1 10 1.5C22 11 19 15 12 21z'); h.scaleToWidth(s); return h; } },
  { id: 'arrow', label: 'Arrow', icon: '<path d="M3 9h11V5l7 7-7 7v-4H3z"/>',
    make: s => new fabric.Polygon([[0, 0.3], [0.6, 0.3], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.7], [0, 0.7]].map(([x, y]) => ({ x: x * s, y: y * s }))) },
  { id: 'plus', label: 'Plus', icon: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
    make: s => new fabric.Polygon([[1, 0], [2, 0], [2, 1], [3, 1], [3, 2], [2, 2], [2, 3], [1, 3], [1, 2], [0, 2], [0, 1], [1, 1]].map(([x, y]) => ({ x: (x * s) / 3, y: (y * s) / 3 }))) },
  { id: 'line', label: 'Line', icon: '<path d="M3 12h18"/>', make: s => new fabric.Rect({ width: Math.round(s * 1.4), height: Math.max(8, Math.round(s * 0.04)) }) },
];
