// Brand colors: a small palette the owner keeps and can apply anywhere. Encrypted along with the profile when it has a passcode.
// shortcut: colors only, no logos or brand fonts yet.
import { scope } from './accounts';
import { readSecure, writeSecure } from './secure';

const KEY = () => scope('canva-lite:brand');
let colors: string[] = [];
export const initBrand = async () => { const v = await readSecure<unknown>(KEY(), []); colors = Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) : []; };
export const loadBrand = () => colors;
export const addBrand = (hex: string) => { if (/^#[0-9a-f]{6}$/i.test(hex) && !colors.includes(hex)) { colors = [...colors, hex]; void writeSecure(KEY(), colors); } return colors; };
export const removeBrand = (hex: string) => { colors = colors.filter(x => x !== hex); void writeSecure(KEY(), colors); return colors; };
