// Brand colors: a small palette the owner keeps and can apply anywhere. Stored in this browser.
// shortcut: colors only, no logos or brand fonts yet. Sync to the account when accounts exist.
const KEY = 'canva-lite:brand';
export const loadBrand = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };
const saveBrand = (c: string[]) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage blocked */ } };
export const addBrand = (hex: string) => { const c = loadBrand(); if (!c.includes(hex)) { c.push(hex); saveBrand(c); } return c; };
export const removeBrand = (hex: string) => { const c = loadBrand().filter(x => x !== hex); saveBrand(c); return c; };
