// Turns dist/index.html into one self-contained dist/artifact.html (JS inlined, document tags stripped)
// for hosts that wrap the page in their own skeleton. Run after `vite build`.
import { readFileSync, writeFileSync } from 'node:fs';

let html = readFileSync('dist/index.html', 'utf8');
const tag = html.match(/<script type="module"[^>]*src="\.\/(assets\/[^"]+)"[^>]*><\/script>/);
if (!tag) throw new Error('module script tag not found in dist/index.html');
const js = readFileSync(`dist/${tag[1]}`, 'utf8').replaceAll('</script', '<\\/script');
html = html.replace(tag[0], '').replace(/<!doctype[^>]*>/i, '').replace(/<\/?(?:html|head|body)(?:\s[^>]*)?>/gi, '');
writeFileSync('dist/artifact.html', `${html.trim()}\n<script type="module">${js}</script>\n`);
