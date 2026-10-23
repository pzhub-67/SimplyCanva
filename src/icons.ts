// 24px stroke icons, inner SVG markup only.
export const ICONS: Record<string, string> = {
  undo: '<path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3"/>',
  home: '<path d="M3 11 12 4l9 7M5 10v10h14V10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  export: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  text: '<path d="M5 7V4h14v3M12 4v16M9 20h6"/>',
  shapes: '<rect x="3" y="12" width="9" height="9" rx="1"/><circle cx="16" cy="8" r="5"/>',
  photo: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  size: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  bg: '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  forward: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  back: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  left: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  center: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  right: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  minus: '<path d="M5 12h14"/>',
  sliders: '<path d="M4 6h8M18 6h2M4 12h2M12 12h8M4 18h10M20 18h0"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  paste: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9z"/>',
  rect: '<rect x="3" y="6" width="18" height="12" rx="1"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  triangle: '<path d="M12 4 21 20H3z"/>',
};

export const svg = (inner: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
