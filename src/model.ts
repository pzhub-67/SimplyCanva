// Canonical design format. Every feature (templates, resize, collab) reads and writes this.
// shortcut: objects hold raw Fabric JSON, swap for our own object schema if we ever leave Fabric.
export type Obj = Record<string, unknown>;
export interface Page { id: string; width: number; height: number; background: string; objects: Obj[]; thumb?: string }
export interface Design { id: string; title: string; pages: Page[] }
export interface FabricJSON { objects: Obj[]; background?: string }

export const newDesign = (width = 900, height = 560): Design => ({
  id: crypto.randomUUID(),
  title: 'Untitled',
  pages: [{ id: crypto.randomUUID(), width, height, background: '#ffffff', objects: [] }],
});

export const pageToFabric = (p: Page): FabricJSON => ({ objects: p.objects, background: p.background });

export const fabricToPage = (p: Page, json: FabricJSON, width: number, height: number): Page => ({
  ...p, width, height, background: json.background ?? p.background, objects: json.objects,
});
