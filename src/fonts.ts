export const FONTS = [
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Oswald', 'Bebas Neue',
  'Playfair Display', 'Merriweather', 'Lobster', 'Pacifico', 'Caveat',
];

const loaded = new Map<string, Promise<unknown>>();

// shortcut: loads only the regular weight, bold/italic are browser-synthesized. Request real weights when it looks off.
export const loadFont = (family: string) => {
  if (!loaded.has(family)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}&display=swap`;
    document.head.append(link);
    loaded.set(family, new Promise(r => { link.onload = r; link.onerror = r; }).then(() => document.fonts.load(`16px "${family}"`)));
  }
  return loaded.get(family)!;
};
