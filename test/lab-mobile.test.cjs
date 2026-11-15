// Tests the Lab's mobile layout: every screen at 320, 375, 390 and 430 px wide, in portrait and landscape.
// Checks: no sideways scrolling, every control at least 44 × 44 px, 16 px body text, the bottom navigation and the
// ⋯ menu, the paper card and its actions, sheets, the swipe deck's buttons, safe-area insets, contrast in light and
// dark (axe), reduced motion, and that the installed app opens offline. Screenshots go to test/out/mobile/.
// Run: node tools/build.mjs && node tools/build.mjs lab/src dist/lab && node test/lab-mobile.test.cjs
'use strict';
const path = require('path'); const fs = require('fs');
const VENDOR = '/home/claude/vendor/node_modules';
const puppeteer = require(path.join(VENDOR, 'puppeteer-core'));
const M = require('./mock-data.js');
const OUT = path.join(__dirname, 'out', 'mobile'); fs.mkdirSync(OUT, { recursive: true });
const server = require('./static-server.cjs')(8783);
const BASE = 'http://localhost:8783/lab/';
const log = []; const check = (n, ok, d = '') => { log.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const json = (req, obj, status = 200) => req.respond({ status, headers: { 'content-type': 'application/json', ...CORS }, body: JSON.stringify(obj) });
const sleep = ms => new Promise(r => setTimeout(r, ms));

function route(req) {
  const url = req.url(); if (url.startsWith('data:') || url.startsWith('blob:')) return req.continue();
  const u = new URL(url); if (u.hostname === 'localhost') return req.continue();
  if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS });
  const p = u.searchParams;
  if (u.hostname === 'api.openalex.org') {
    if (/^related_to:|^cites:|^cited_by:/.test(p.get('filter') || '')) return json(req, { meta: { count: 2, cost_usd: 0.0001 }, results: [M.kwWorks[2], M.kwWorks[3]] });
    if (u.pathname.startsWith('/works/W')) return json(req, { id: 'x' });
    if (p.get('group_by')) return json(req, { meta: { count: 1, cost_usd: 0.001 }, group_by: M.groupByPhysical });
    if (p.get('search.semantic')) return json(req, { meta: { count: 7, cost_usd: 0.001 }, results: M.semWorks });
    return json(req, { meta: { count: 18, cost_usd: 0.001 }, results: Number(p.get('page') || 1) === 1 ? M.kwWorks : [] });
  }
  if (u.hostname === 'api.crossref.org') return json(req, { message: { items: M.crossref, 'total-results': 3 } });
  if (u.hostname === 'www.ebi.ac.uk') return json(req, { hitCount: 2, resultList: { result: M.epmc } });
  if (u.hostname === 'api.semanticscholar.org') return json(req, { recommendedPapers: [] });
  return req.abort();
}

// ---------------------------------------------------------------- checks that run inside the page
function inPage() {
  const shown = el => { if (el.closest('[hidden]')) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const name = el => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}${Object.keys(el.dataset).length ? `[${Object.keys(el.dataset)[0]}]` : ''} “${(el.textContent || el.getAttribute('aria-label') || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 24)}”`;
  // A link or button inside running text (an author's name in a byline, a link in a sentence) is exempt: WCAG 2.5.8.
  const inText = el => { if (getComputedStyle(el).display !== 'inline') return false; const p = el.parentElement; return p && p.textContent.trim().length > el.textContent.trim().length + 2; };
  const scrollsSideways = el => { for (let a = el.parentElement; a; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
  const rootEl = () => document.querySelector('#deck:not([hidden])') || document.body;
  window.__mobile = {
    overflow() {
      const W = document.documentElement.clientWidth; const out = [];
      if (document.documentElement.scrollWidth > W + 1) out.push(`page is ${document.documentElement.scrollWidth}px wide in a ${W}px screen`);
      rootEl().querySelectorAll('main *, .sheet *, .deck *, .appbar *, .tabbar *').forEach(el => {
        if (!shown(el) || el.closest('svg') || scrollsSideways(el) || el.closest('.searchpanel') === el) return;
        const r = el.getBoundingClientRect(); if (r.right > W + 1 || r.left < -1) out.push(`${name(el)} spans ${Math.round(r.left)}–${Math.round(r.right)}`);
      });
      return out.slice(0, 8);
    },
    targets() {
      const out = [];
      rootEl().querySelectorAll('button, a[href], select, input:not([type="hidden"]), textarea, summary, [role="radio"]').forEach(el => {
        if (!shown(el) && !(el.matches('input[type="checkbox"], input[type="radio"]') && el.closest('label') && shown(el.closest('label')))) return;
        if (el.closest('.sky-svg, .map-svg') || el.matches('.skip-link') || el.closest('.deck-stage')) return; // star maps also work from their lists; the deck card is the swipe surface
        if (el.matches('input[type="file"]')) return;
        if (inText(el)) return;
        const box = el.matches('input[type="checkbox"], input[type="radio"]') ? (el.closest('label') || el) : el;
        const r = box.getBoundingClientRect();
        if (r.width < 43.5 || r.height < 43.5) out.push(`${name(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      });
      return out.slice(0, 10);
    },
    fonts() {
      const out = []; const w = document.createTreeWalker(rootEl(), NodeFilter.SHOW_TEXT);
      while (w.nextNode()) {
        const n = w.currentNode; if (!n.textContent.trim()) continue; const el = n.parentElement;
        if (!el || el.closest('[hidden], svg, .sr-only, script, style, .why-h')) continue; if (!shown(el)) continue;
        const f = parseFloat(getComputedStyle(el).fontSize); if (f < 12) out.push(`${name(el)} ${f}px`);
      }
      return [...new Set(out)].slice(0, 8);
    },
  };
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setRequestInterception(true); page.on('request', route);
  await page.evaluateOnNewDocument(inPage);
  const axe = async () => { if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: path.join(VENDOR, 'axe-core/axe.min.js') }); return page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' ; ')}`)); };
  const shot = name => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const back = async () => { await page.evaluate(() => history.back()); await sleep(450); };
  const go = async h => { await page.evaluate(x => { location.hash = x; }, h); await sleep(350); await page.evaluate(() => window.scrollTo(0, 0)); };
  const search = async q => { await go('#search'); await page.$eval('#q', (e, v) => { e.value = v; }, q); await page.$eval('#search-form button[type="submit"]', b => b.click()); await page.waitForFunction(() => document.querySelectorAll('#results .paper').length > 5 && document.querySelector('#loading').hidden, { timeout: 12000 }); await sleep(300); };
  const audit = async (label, extra = {}) => {
    const r = await page.evaluate(() => ({ o: window.__mobile.overflow(), t: window.__mobile.targets(), f: window.__mobile.fonts() }));
    const bad = [...r.o.map(x => 'overflow: ' + x), ...r.t.map(x => 'small target: ' + x), ...r.f.map(x => 'tiny text: ' + x)];
    if (bad.length) check(label, false, bad.join(' | ')); else audit.ok++;
    return r;
  };
  audit.ok = 0;

  // ---------- one-off checks at 390 × 844
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(BASE + '?nosw#search', { waitUntil: 'load' }); await sleep(400);
  await page.evaluate(() => { localStorage.setItem('paperscope-lab.settings', JSON.stringify(Object.assign(JSON.parse(localStorage.getItem('paperscope-lab.settings') || '{}'), { todayTopics: 'exciton diffusion, singlet fission' }))); });
  await page.reload({ waitUntil: 'load' }); await sleep(600);
  const shell = await page.evaluate(() => {
    const tb = document.querySelector('.tabbar'); const r = tb.getBoundingClientRect();
    return { pos: getComputedStyle(tb).position, bottom: Math.round(innerHeight - r.bottom), tabs: [...document.querySelectorAll('.tabs a')].map(a => a.textContent.replace(/\d+/g, '').trim()),
      body: getComputedStyle(document.body).fontSize, hasBanner: !!document.querySelector('.hero-title, .hero-rings'), q: Math.round(document.querySelector('#q').getBoundingClientRect().top), menu: !!document.querySelector('#menu-btn') };
  });
  check('bottom navigation: Search, Today, Saved, Profile, fixed to the bottom', shell.pos === 'fixed' && shell.bottom === 0 && shell.tabs.join(',') === 'Search,Today,Saved,Profile', JSON.stringify(shell));
  check('body text is 16 px', shell.body === '16px');
  check('search comes first: no big banner, the search box is near the top', !shell.hasBanner && shell.q < 160, `search box at ${shell.q}px`);
  await page.$eval('#menu-btn', b => b.click()); await sleep(250);
  const menu = await page.$$eval('#sheet-root .menu-item', l => l.map(a => a.textContent.trim().split(/\s{2,}|\n/)[0]));
  check('the ⋯ menu holds Settings and About (and the main app)', menu.some(x => /^Settings/.test(x)) && menu.some(x => /^About/.test(x)) && menu.some(x => /main app/.test(x)), menu.join(' | '));
  await page.$eval('[data-menu-appearance="dark"]', b => b.click()); await sleep(150);
  const dark = await page.evaluate(() => ({ a: document.documentElement.dataset.appearance, theme: document.querySelector('meta[name="theme-color"]').content, pressed: document.querySelector('[data-menu-appearance="dark"]').getAttribute('aria-pressed') }));
  check('appearance can be set from the menu; the status bar follows', dark.a === 'dark' && dark.theme === '#0e1838' && dark.pressed === 'true', JSON.stringify(dark));
  await page.$eval('[data-menu-appearance="auto"]', b => b.click()); await sleep(100);
  await back();
  check('Today shows a pointer on the start screen and a count on its tab', await page.$eval('#today-teaser', e => /Papers of the day/.test(e.textContent)), await page.$eval('#today-teaser', e => e.textContent.trim().slice(0, 80)));

  // the card
  await search('exciton migration in molecular crystals');
  const card = await page.$eval('#results .paper', li => ({ title: !!li.querySelector('h3'), authors: (li.querySelector('.byline') || {}).textContent || '', pub: (li.querySelector('.publine') || {}).textContent || '', why: li.querySelectorAll('.why li').length,
    actions: [...li.querySelectorAll('.card-actions .act:not(.none)')].map(b => (b.textContent || b.getAttribute('aria-label')).trim()), whyFont: getComputedStyle(li.querySelector('.why li')).fontSize,
    doi: (li.querySelector('.card-actions a.act') || {}).href || '' }));
  check('a card shows title, authors, journal and year, and why it is here', card.title && card.authors.length > 3 && /\d{4}/.test(card.pub) && card.why >= 1, JSON.stringify(card).slice(0, 200));
  check('a card’s actions: Save, Abstract, DOI, More like this, and ⋯ for the rest', card.actions.join(',') === 'Save,Abstract,DOI,More like this,More actions' && /^https:\/\/doi\.org\//.test(card.doi), card.actions.join(','));
  check('the relevance explanation is 16 px', card.whyFont === '16px', card.whyFont);
  await page.$eval('#results .paper [data-abstract]', b => b.click()); await sleep(100);
  check('Abstract opens the abstract in the card', await page.$eval('#results .paper', li => !li.querySelector('.abstract').hidden && li.querySelector('[data-abstract]').getAttribute('aria-expanded') === 'true' && li.querySelector('.abstract').textContent.length > 80));
  await page.$eval('#results .paper [data-save]', b => b.click()); await sleep(150);
  check('Save keeps its icon and says Saved', await page.$eval('#results .paper [data-save]', b => b.getAttribute('aria-pressed') === 'true' && b.textContent.trim() === 'Saved' && !!b.querySelector('svg')));
  await page.$eval('#results .paper [data-save]', b => b.click()); await sleep(150);
  check('swipe sorting is still offered, as a visible button', await page.$eval('#swipe-open', b => b.getBoundingClientRect().height >= 44 && /Swipe/.test(b.textContent)));
  await page.$eval('#results .paper [data-card-menu]', b => b.click()); await sleep(250);
  const cm = await page.$$eval('#sheet-root .menu-item', l => l.map(a => a.textContent.trim()));
  check('⋯ on a card: citation trails, links and details', cm.some(x => /^References/.test(x)) && cm.some(x => /^Similar papers/.test(x)) && cm.some(x => /^Trace its origin/.test(x)) && cm.some(x => /^Details and score/.test(x)) && cm.some(x => /Publisher page/.test(x)), cm.join(' | ').slice(0, 200));
  await page.$eval('#sheet-root [data-details]', b => b.click()); await sleep(600);
  check('“Details and score” closes the sheet and opens the card’s details', await page.$eval('#results .paper .details', d => !d.hidden) && !(await page.$eval('#sheet-root', e => e.innerHTML)));
  await page.$eval('#results .paper [data-like]', b => b.click());
  await page.waitForFunction(() => window.Paperscope.S.search.kind === 'like' && document.querySelector('#loading').hidden, { timeout: 10000 });
  check('More like this opens papers like it', true);
  await back();

  // safe areas (headless Chrome has no notch, so read the rules)
  const safe = await page.evaluate(() => {
    const rules = []; for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) rules.push(r.cssText); } catch (e) { /* ignore */ } }
    const all = rules.join('\n'); const rule = sel => rules.filter(t => t.startsWith(sel + ' {') || t.includes('\n' + sel + ' {')).join(' ');
    return { appbar: rule('.appbar'), tabbar: rule('.tabbar'), sheet: rule('.sheet'), deck: rule('.deck'), main: rule('main'), any: /safe-area-inset-left/.test(all) && /safe-area-inset-right/.test(all) };
  });
  check('safe-area insets: app bar (top, sides), tab bar (bottom, sides), sheets, deck, page sides', /inset-top/.test(safe.appbar) && /inset-left/.test(safe.appbar) && /inset-bottom/.test(safe.tabbar) && /inset-right/.test(safe.tabbar) && /inset-bottom/.test(safe.sheet) && /inset-top/.test(safe.deck) && /inset-bottom/.test(safe.deck) && /inset-left/.test(safe.main) && safe.any, JSON.stringify(safe).slice(0, 240));

  // contrast and structure, light and dark
  for (const mode of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: mode }]); await sleep(150);
    const res = []; const at = async n => { const v = await axe(); if (v.length) res.push(`${n}: ${v.join(' ; ')}`); };
    await at('results');
    await page.$eval('#results .paper [data-card-menu]', b => b.click()); await sleep(250); await at('card sheet'); await back();
    await page.$eval('#open-filters', b => b.click()); await sleep(250); await at('filters'); await back();
    await page.$eval('#menu-btn', b => b.click()); await sleep(250); await at('menu'); await back();
    for (const v of ['#today', '#saved', '#profile', '#settings', '#about']) { await go(v); await page.evaluate(() => document.querySelectorAll('details.group').forEach(d => { d.open = true; })); await at(v); }
    await go('#search'); await page.$eval('#home-link', a => a.click()); await sleep(300); await at('start');
    check(`${mode} mode: no WCAG A/AA violations (contrast included) on any screen`, !res.length, res.join(' || ').slice(0, 600));
    await search('exciton migration in molecular crystals');
  }
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

  // reduced motion
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.$eval('#open-filters', b => b.click()); await sleep(200);
  const rm = await page.evaluate(() => ({ band: getComputedStyle(document.querySelector('.searchpanel'), '::after').animationName, sheet: getComputedStyle(document.querySelector('.sheet')).animationName }));
  await back();
  await page.$eval('#swipe-open', b => b.click()); await sleep(250);
  const t0 = Date.now(); await page.$eval('#deck [data-deck="skip"]', b => b.click()); await page.waitForFunction(() => /2 of/.test(document.querySelector('.deck-count').textContent), { timeout: 3000 });
  const flew = Date.now() - t0; await back();
  check('reduced motion: no sweeping band, sliding sheets or flying cards', rm.band === 'none' && rm.sheet === 'none' && flew < 200, `${JSON.stringify(rm)} card ${flew} ms`);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

  // ---------- every screen at every size, portrait and landscape
  const SIZES = [[320, 568], [375, 667], [390, 844], [430, 932]];
  for (const [w, h] of SIZES) {
    for (const orient of ['portrait', 'landscape']) {
      const [W, H] = orient === 'portrait' ? [w, h] : [h, w]; const tag = `${w}-${orient}`;
      await page.setViewport({ width: W, height: H, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: orient === 'landscape' });
      await sleep(200);
      await go('#search'); await page.$eval('#home-link', a => a.click()); await sleep(300);
      await audit(`${tag}: start screen`); await shot(`${tag}-1-start`);
      await search('exciton migration in molecular crystals');
      await audit(`${tag}: results`); await shot(`${tag}-2-results`);
      const nav = await page.evaluate(() => { const r = document.querySelector('.tabbar').getBoundingClientRect(); return { h: Math.round(r.height), bottom: Math.round(innerHeight - r.bottom), w: Math.round(r.width), vw: innerWidth }; });
      if (!(nav.bottom === 0 && nav.w === nav.vw && nav.h <= (orient === 'landscape' ? 52 : 64))) check(`${tag}: the tab bar sits at the bottom, full width${orient === 'landscape' ? ' and short' : ''}`, false, JSON.stringify(nav)); else audit.ok++;
      await page.$eval('#results .paper [data-abstract]', b => b.click()); await sleep(100); await audit(`${tag}: card with its abstract open`);
      await page.$eval('#results .paper [data-abstract]', b => b.click());
      await page.$eval('#results .paper [data-card-menu]', b => b.click()); await sleep(300);
      await audit(`${tag}: a paper’s ⋯ sheet`); await shot(`${tag}-3-card-sheet`); await back();
      await page.$eval('#open-filters', b => b.click()); await sleep(300); await audit(`${tag}: filters sheet`); await shot(`${tag}-4-filters`); await back();
      await page.$eval('#menu-btn', b => b.click()); await sleep(300); await audit(`${tag}: ⋯ menu`); await shot(`${tag}-5-menu`); await back();
      await page.$eval('#swipe-open', b => b.click()); await sleep(350);
      const deck = await page.evaluate(() => { const r = [...document.querySelectorAll('#deck .dbtn')].map(b => b.getBoundingClientRect()); const c = document.querySelector('#deck .dcard:not(.behind)').getBoundingClientRect();
        return { n: r.length, inside: r.every(x => x.top >= 0 && x.bottom <= innerHeight && x.left >= 0 && x.right <= innerWidth && x.width >= 44 && x.height >= 44), card: Math.round(c.height), cardIn: c.top >= 0 && c.bottom <= innerHeight + 1 }; });
      if (!(deck.n === 4 && deck.inside && deck.cardIn && deck.card >= 150)) check(`${tag}: swipe deck shows the card and all four buttons`, false, JSON.stringify(deck)); else audit.ok++;
      await audit(`${tag}: swipe deck`); await shot(`${tag}-6-deck`); await back();
      for (const v of ['#today', '#saved', '#profile', '#settings', '#about']) {
        await go(v); await page.evaluate(() => document.querySelectorAll('details.group, .today-set').forEach(d => { d.open = true; }));
        await audit(`${tag}: ${v.slice(1)}`); if (v === '#today' || v === '#settings' || v === '#profile') await shot(`${tag}-7-${v.slice(1)}`);
      }
    }
  }
  check(`every screen at 320, 375, 390 and 430 px, portrait and landscape: no sideways scrolling, 44 px targets, no tiny text (${audit.ok} screens)`, log.every(Boolean), '');

  // ---------- installed app: opens offline, can be installed
  const app = await browser.newPage(); await app.setRequestInterception(true); app.on('request', route);
  await app.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await app.goto(BASE + '#search', { waitUntil: 'load' });
  await app.evaluate(() => navigator.serviceWorker.ready); await app.reload({ waitUntil: 'load' }); await sleep(500);
  const sw = await app.evaluate(() => ({ ctl: !!navigator.serviceWorker.controller, scope: navigator.serviceWorker.controller && new URL(navigator.serviceWorker.controller.scriptURL).pathname }));
  const man = await app.evaluate(async () => { const r = await fetch(document.querySelector('link[rel="manifest"]').href); return r.json(); });
  check('installable: manifest with name, icons, standalone display, and a Today shortcut; service worker in /lab/', sw.ctl && sw.scope === '/lab/sw.js' && man.name === 'Paperscope Lab' && man.display === 'standalone' && man.icons.some(i => i.sizes === '512x512') && man.shortcuts.some(s => s.url === './#today'), JSON.stringify({ sw, s: man.shortcuts.map(s => s.url) }));
  await app.setOfflineMode(true); await app.reload({ waitUntil: 'load' }); await sleep(400);
  const off = await app.evaluate(() => ({ app: !!window.Paperscope, tabs: document.querySelectorAll('.tabs a').length, q: !!document.querySelector('#q') }));
  await app.$eval('.tabs a[data-view="saved"]', a => a.click()); await sleep(250);
  check('opens offline, with the tabs working', off.app && off.tabs === 4 && off.q && await app.evaluate(() => !document.querySelector('#view-saved').hidden), JSON.stringify(off));
  await app.setOfflineMode(false); await app.close();

  check('no page errors', errors.length === 0, errors.join(' | '));
  const failed = log.filter(x => !x).length;
  console.log(`\n${log.length - failed}/${log.length} mobile checks passed`);
  await browser.close(); server.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
