// Renders the app icons (PNG) from one SVG design. Run: node tools/icons.mjs (needs puppeteer-core + Chrome).
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const puppeteer = require('/home/claude/vendor/node_modules/puppeteer-core');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(ROOT, process.argv[2] || 'src/pwa/icons'); // node tools/icons.mjs lab/src/pwa/icons lab
const LAB = process.argv[3] === 'lab';
const SKY = LAB ? ['#3a2163', '#24143f', '#140b26'] : ['#1c2b5e', '#111c42', '#0a1129'];

// The Paperscope mark (teal and amber rings, a bright core) on the night sky used in the app's header.
const art = ({ rounded, scale = 1 }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="sky" cx="50%" cy="42%" r="70%"><stop offset="0" stop-color="${SKY[0]}"/><stop offset=".55" stop-color="${SKY[1]}"/><stop offset="1" stop-color="${SKY[2]}"/></radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#f0ac4b" stop-opacity=".14"/><stop offset="1" stop-color="#f0ac4b" stop-opacity="0"/></radialGradient>
    <clipPath id="tile"><rect width="512" height="512" rx="${rounded ? 112 : 0}"/></clipPath>
  </defs>
  <g clip-path="url(#tile)">
    <rect width="512" height="512" fill="url(#sky)"/>
    <circle cx="96" cy="92" r="3.5" fill="#eef2ff" opacity=".75"/><circle cx="418" cy="128" r="2.5" fill="#eef2ff" opacity=".6"/>
    <circle cx="402" cy="414" r="3" fill="#eef2ff" opacity=".55"/><circle cx="128" cy="400" r="2" fill="#eef2ff" opacity=".5"/>
    <g transform="translate(256 256) scale(${scale})">
      <circle r="120" fill="url(#glow)"/>
      <circle r="150" fill="none" stroke="#4fc8d2" stroke-width="26"/>
      <circle r="82" fill="none" stroke="#f0ac4b" stroke-width="26"/>
      <circle r="34" fill="#eef2ff"/>
    </g>
  </g>
</svg>`;
const jobs = [
  ['icon-192.png', 192, art({ rounded: true, scale: 1.08 })],
  ['icon-512.png', 512, art({ rounded: true, scale: 1.08 })],
  ['icon-maskable-512.png', 512, art({ rounded: false, scale: 1 })], // mark stays inside the 80% safe zone
  ['apple-touch-icon.png', 180, art({ rounded: false, scale: 1.05 })],
];
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
for (const [file, size, svg] of jobs) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body></html>`);
  await page.screenshot({ path: join(out, file), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(file, size);
}
await browser.close();
