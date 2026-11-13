// Inlines CSS and JS into one self-contained HTML file: dist/index.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const r = p => readFileSync(join(root, p), 'utf8');
const guard = (s, name) => { if (/<\/script/i.test(s)) throw new Error(`${name} contains </script`); return s; };
// Embed the Spectral typeface (SIL OFL 1.1) so the page makes no font requests.
const font = (file, weight, style) => `@font-face{font-family:"Spectral";font-style:${style};font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${readFileSync(join(root, 'src/fonts', file)).toString('base64')}) format("woff2");}`;
const fonts = [font('spectral-latin-500-normal.woff2', 500, 'normal'), font('spectral-latin-600-normal.woff2', 600, 'normal'), font('spectral-latin-400-italic.woff2', 400, 'italic')].join('\n');
let html = r('src/index.html');
html = html.replace('/*@@CSS@@*/', () => fonts + '\n' + r('src/styles.css'))
  .replace('/*@@CORE@@*/', () => guard(r('src/core.js'), 'core.js'))
  .replace('/*@@APP@@*/', () => guard(r('src/app.js'), 'app.js'));
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/index.html'), html);
console.log(`dist/index.html: ${(html.length / 1024).toFixed(1)} KB`);
