// The interface face (IBM Plex Sans), bundled into the build: no request to any font server.
import w400 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2';
import w500 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2';
import w600 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2';

export const loadUiFont = () => {
  for (const [weight, src] of [['400', w400], ['500', w500], ['600', w600]]) {
    try { const f = new FontFace('IBM Plex Sans', `url(${src})`, { weight }); document.fonts.add(f); void f.load(); } catch { /* system font fallback */ }
  }
};
