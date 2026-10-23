// Fonts are inlined as data URLs so the single-file build works offline and loads nothing from other servers.
export default { base: './', build: { assetsInlineLimit: (file: string) => (file.endsWith('.woff2') ? true : undefined) } };
