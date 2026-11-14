// Tests that Paperscope installs and runs as an app: manifest, icons, service worker, offline start, install prompts.
// Run: node tools/build.mjs && node test/pwa.test.cjs
'use strict';
const path = require('path');
const fs = require('fs');
const VENDOR = '/home/claude/vendor/node_modules';
const puppeteer = require(path.join(VENDOR, 'puppeteer-core'));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'test', 'out');
fs.mkdirSync(OUT, { recursive: true });
const server = require('./static-server.cjs')(8769);
const URL0 = 'http://localhost:8769/';
const log = [];
const check = (name, ok, detail = '') => { log.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1';

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = browser.defaultBrowserContext(); // installability is not reported in incognito contexts
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(m.text()); });
  const external = [];
  page.on('request', r => { const u = new URL(r.url()); if (u.protocol.startsWith('http') && u.hostname !== 'localhost') external.push(u.hostname); });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(URL0, { waitUntil: 'load' });

  // ---------- manifest and icons
  const manifestHref = await page.$eval('link[rel="manifest"]', l => l.href);
  check('page links a manifest', manifestHref === `${URL0}manifest.webmanifest`, manifestHref);
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'manifest.webmanifest'), 'utf8'));
  check('manifest: name, standalone display, start URL inside its scope', m.name === 'Paperscope' && m.short_name === 'Paperscope' && m.display === 'standalone' && m.start_url.startsWith(m.scope) && m.id);
  check('manifest: theme and background match the app header', m.theme_color === '#0c1430' && m.background_color === '#0c1430');
  const sizes = await page.evaluate(async icons => Promise.all(icons.map(i => new Promise(res => { const im = new Image(); im.onload = () => res(`${i.src} ${im.naturalWidth}x${im.naturalHeight} ${i.purpose}`); im.onerror = () => res(`${i.src} missing`); im.src = i.src; }))), m.icons);
  check('icons load at their declared sizes (192 and 512, plus maskable)', sizes.join('|') === 'icons/icon-192.png 192x192 any|icons/icon-512.png 512x512 any|icons/icon-maskable-512.png 512x512 maskable', sizes.join(' | '));
  const apple = await page.evaluate(() => new Promise(res => { const im = new Image(); im.onload = () => res(`${im.naturalWidth}x${im.naturalHeight}`); im.onerror = () => res('missing'); im.src = document.querySelector('link[rel="apple-touch-icon"]').href; }));
  check('Apple touch icon is 180×180', apple === '180x180', apple);
  const appleMeta = await page.evaluate(() => ['apple-mobile-web-app-title', 'apple-mobile-web-app-status-bar-style', 'mobile-web-app-capable'].map(n => (document.querySelector(`meta[name="${n}"]`) || {}).content).join(','));
  check('iOS home-screen tags present', appleMeta === 'Paperscope,black-translucent,yes', appleMeta);
  const cdp = await page.createCDPSession();
  const am = await cdp.send('Page.getAppManifest');
  check('Chrome parses the manifest without errors', am.errors.length === 0 && am.url.endsWith('manifest.webmanifest'), JSON.stringify(am.errors));
  let inst = null;
  try { inst = await cdp.send('Page.getInstallabilityErrors'); } catch (e) { inst = { unsupported: e.message }; }

  // ---------- service worker and offline start
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'load' });
  const ctl = await page.evaluate(() => !!navigator.serviceWorker.controller);
  check('service worker installs and controls the page', ctl);
  if (inst && !inst.unsupported) check('Chrome reports the app as installable', inst.installabilityErrors.length === 0, JSON.stringify(inst.installabilityErrors));
  else console.log('note  Page.getInstallabilityErrors unavailable:', inst && inst.unsupported);
  const cached = await page.evaluate(async () => { const keys = await caches.keys(); const c = await caches.open(keys[0]); return { keys, urls: (await c.keys()).map(r => r.url) }; });
  check('one versioned cache holds the app shell', cached.keys.length === 1 && /^paperscope-[0-9a-f]{10}$/.test(cached.keys[0]) && cached.urls.includes(URL0) && cached.urls.some(u => u.endsWith('icon-512.png')), JSON.stringify(cached));
  check('nothing from other sites is cached', cached.urls.every(u => u.startsWith(URL0)));
  const swSrc = fs.readFileSync(path.join(ROOT, 'dist', 'sw.js'), 'utf8');
  check('service worker leaves other sites alone', /url\.origin !== self\.location\.origin\) return/.test(swSrc) && !/@@VERSION@@/.test(swSrc));

  const externalAtStart = [...external];
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'load' });
  const off = await page.evaluate(() => ({ title: document.title, hero: !!document.querySelector('#hero'), app: !!window.Paperscope }));
  check('opens offline', off.app && off.hero && /Paperscope/.test(off.title), JSON.stringify(off));
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }); }); // headless Chrome keeps reporting online
  await page.$eval('#q', q => { q.value = 'exciton migration'; });
  await page.$eval('#search-form button', b => b.click());
  await page.waitForFunction(() => /offline/i.test(document.body.innerText), { timeout: 15000 }).catch(() => {});
  const offMsg = await page.evaluate(() => (document.body.innerText.match(/You’re offline[^\n]*/) || [''])[0] || `[onLine=${navigator.onLine}] ` + document.querySelector('main').innerText.slice(0, 400));
  check('searching offline explains what still works', /Saved papers and your profile still work/.test(offMsg), offMsg);
  await page.setOfflineMode(false);

  // ---------- install prompt (Chrome, Edge, Android)
  await page.goto(URL0 + '#search', { waitUntil: 'load' });
  await page.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = () => { window.__prompted = true; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
  const hint = await page.$eval('#install-hint', h => h.innerText);
  check('start screen offers Install when the browser allows it', /Use Paperscope as an app/.test(hint) && !!(await page.$('#install-btn2')), hint);
  await page.screenshot({ path: path.join(OUT, 'pwa-hint.png') });
  await page.$eval('#install-btn2', b => b.click());
  check('Install opens the browser’s install dialog', await page.evaluate(() => window.__prompted === true));
  await page.evaluate(() => { window.dispatchEvent(new Event('appinstalled')); });
  check('after installing, the hint goes away', (await page.$eval('#install-hint', h => h.innerHTML.trim())) === '');

  // ---------- iPhone: instructions instead of a button
  const ctx2 = await browser.createBrowserContext(); // incognito: Chrome itself never offers installation here, like Safari
  const ios = await ctx2.newPage();
  await ios.setUserAgent(IPHONE);
  await ios.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ios.goto(URL0 + '?nosw#search', { waitUntil: 'load' });
  await ios.evaluate(() => { localStorage.removeItem('paperscope.installHintDismissed'); });
  await ios.reload({ waitUntil: 'load' });
  const iosHint = await ios.$eval('#install-hint', h => h.innerText);
  check('iPhone: start screen explains Add to Home Screen', /tap Share, then “Add to Home Screen”/.test(iosHint), iosHint);
  await ios.goto(URL0 + '?nosw#about', { waitUntil: 'load' });
  const iosPanel = await ios.$eval('#install-panel', p => p.innerText);
  check('iPhone: About explains how, and that storage is separate', /Add to Home Screen/.test(iosPanel) && /own storage, separate from Safari/.test(iosPanel), iosPanel.slice(0, 200));
  if (!(await ios.evaluate(() => !!window.axe))) await ios.addScriptTag({ path: path.join(VENDOR, 'axe-core/axe.min.js') });
  const ax1 = await ios.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' ; ')}`));
  check('About with install panel: no WCAG A/AA violations', ax1.length === 0, ax1.join(' | '));
  await ios.goto(URL0 + '?nosw#search', { waitUntil: 'load' });
  if (!(await ios.evaluate(() => !!window.axe))) await ios.addScriptTag({ path: path.join(VENDOR, 'axe-core/axe.min.js') });
  const ax2 = await ios.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' ; ')}`));
  check('start screen with install hint: no WCAG A/AA violations', ax2.length === 0, ax2.join(' | '));
  await ios.screenshot({ path: path.join(OUT, 'pwa-ios-hint.png') });
  await ios.$eval('#install-dismiss', b => b.click());
  await ios.reload({ waitUntil: 'load' });
  check('“Not now” is remembered', (await ios.$eval('#install-hint', h => h.innerHTML.trim())) === '');

  await ios.goto(URL0 + '?nosw#install', { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 300));
  const inst2 = await ios.evaluate(() => ({ about: !document.querySelector('#view-about').hidden, top: Math.round(document.querySelector('#install-h').getBoundingClientRect().top) }));
  check('the #install link opens the install instructions', inst2.about && inst2.top >= 0 && inst2.top < 200, JSON.stringify(inst2));

  // ---------- running as an installed app
  const app = await ctx2.newPage();
  await app.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'standalone', { get: () => true }); });
  await app.goto(URL0 + '?nosw&by=author#about', { waitUntil: 'load' });
  const appPanel = await app.$eval('#install-panel', p => p.innerText);
  check('installed: About says so and shows no install steps', /using Paperscope as an installed app/.test(appPanel) && !/How:/.test(appPanel), appPanel);
  check('app shortcut “Search by author” opens the Authors pathway', await app.$eval('.pathways [data-pathway="author"]', b => b.getAttribute('aria-checked')) === 'true');

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('the app itself contacts no other site on start', externalAtStart.length === 0, [...new Set(externalAtStart)].join(', '));
  const failed = log.filter(l => !l.ok).length;
  console.log(`\n${log.length - failed}/${log.length} app-install checks passed`);
  await browser.close(); server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
