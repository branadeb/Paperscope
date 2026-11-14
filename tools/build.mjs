// Inlines CSS and JS into one self-contained HTML file.
// node tools/build.mjs            -> src/      to dist/      (the main app)
// node tools/build.mjs lab/src dist/lab   (Paperscope Lab, the experimental copy)
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] || 'src'; const OUT = process.argv[3] || 'dist';
const r = p => readFileSync(join(root, p.replace(/^src\//, SRC + '/')), 'utf8');
const guard = (s, name) => { if (/<\/script/i.test(s)) throw new Error(`${name} contains </script`); return s; };
// Embed the Spectral typeface (SIL OFL 1.1) so the page makes no font requests.
const font = (file, weight, style) => `@font-face{font-family:"Spectral";font-style:${style};font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${readFileSync(join(root, SRC, 'fonts', file)).toString('base64')}) format("woff2");}`;
const fonts = [font('spectral-latin-500-normal.woff2', 500, 'normal'), font('spectral-latin-600-normal.woff2', 600, 'normal'), font('spectral-latin-400-italic.woff2', 400, 'italic')].join('\n');
let html = r('src/index.html');
html = html.replace('/*@@CSS@@*/', () => fonts + '\n' + r('src/styles.css'))
  .replace('/*@@CORE@@*/', () => guard(r('src/core.js'), 'core.js'))
  .replace('/*@@APP@@*/', () => guard(r('src/app.js'), 'app.js'));
mkdirSync(join(root, OUT), { recursive: true });
writeFileSync(join(root, OUT, 'index.html'), html);
console.log(`${OUT}/index.html: ${(html.length / 1024).toFixed(1)} KB`);
// Installable-app files: manifest, icons and a service worker whose cache name changes with every build.
const version = createHash('sha256').update(html).update(r('src/pwa/manifest.webmanifest')).update(r('src/pwa/sw.js')).digest('hex').slice(0, 10);
JSON.parse(r('src/pwa/manifest.webmanifest')); // fail the build on a broken manifest
writeFileSync(join(root, OUT, 'manifest.webmanifest'), r('src/pwa/manifest.webmanifest'));
writeFileSync(join(root, OUT, 'sw.js'), r('src/pwa/sw.js').replace('@@VERSION@@', version));
mkdirSync(join(root, OUT, 'icons'), { recursive: true });
for (const f of readdirSync(join(root, SRC, 'pwa/icons'))) copyFileSync(join(root, SRC, 'pwa/icons', f), join(root, OUT, 'icons', f));
console.log(`${OUT}/sw.js: version ${version}`);
