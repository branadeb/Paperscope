// Inlines CSS and JS into one self-contained HTML file: dist/index.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const r = p => readFileSync(join(root, p), 'utf8');
const guard = (s, name) => { if (/<\/script/i.test(s)) throw new Error(`${name} contains </script`); return s; };
let html = r('src/index.html');
html = html.replace('/*@@CSS@@*/', () => r('src/styles.css'))
  .replace('/*@@CORE@@*/', () => guard(r('src/core.js'), 'core.js'))
  .replace('/*@@APP@@*/', () => guard(r('src/app.js'), 'app.js'));
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/index.html'), html);
console.log(`dist/index.html: ${(html.length / 1024).toFixed(1)} KB`);
