// Hand the viewer a file. Inside the Claude artifact viewer plain download links are blocked, so saves go through
// its `downloads` capability (the viewer confirms each one); everywhere else a normal download link is clicked.
type Downloads = { save: (r: { filename: string; data: Blob }) => Promise<unknown> };
type Host = { use?: (name: string) => Promise<unknown> };

export const inViewer = () => 'claude' in window;

let dl: Promise<Downloads | null> | null = null;
const downloads = () => (dl ??= Promise.resolve((window as unknown as { claude?: Host }).claude?.use?.('downloads') ?? null).then(d => (d as Downloads) ?? null).catch(() => null));

// Resolves 'saved', 'declined' (the viewer said no) or 'unavailable' (this view cannot save files).
export const saveFile = async (filename: string, data: Blob): Promise<'saved' | 'declined' | 'unavailable'> => {
  if (inViewer()) {
    const d = await downloads();
    if (!d) return 'unavailable';
    try { await d.save({ filename, data }); return 'saved'; } catch (e) { return (e as { code?: string })?.code === 'declined' ? 'declined' : 'unavailable'; }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(data), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return 'saved';
};
