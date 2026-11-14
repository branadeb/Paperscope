// Tests Paperscope Lab (dist/lab): isolation from the main app, swipe to sort, read later, taste learning and the night sky.
// Run: node tools/build.mjs && node tools/build.mjs lab/src dist/lab && node test/lab.test.cjs
'use strict';
const path = require('path'); const fs = require('fs');
const VENDOR = '/home/claude/vendor/node_modules';
const puppeteer = require(path.join(VENDOR, 'puppeteer-core'));
const M = require('./mock-data.js');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const server = require('./static-server.cjs')(8772); // serves dist/, so /lab/ is the Lab and / the main app
const BASE = 'http://localhost:8772/';
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
    if (/^related_to:/.test(p.get('filter') || '')) return json(req, { meta: { count: 2, cost_usd: 0.0001 }, results: [M.kwWorks[2], M.kwWorks[3]] });
    if (u.pathname.startsWith('/works/W')) return json(req, { id: 'x' });
    if (p.get('group_by')) return json(req, { meta: { count: 1, cost_usd: 0.001 }, group_by: M.groupByPhysical });
    if (p.get('search.semantic')) return json(req, { meta: { count: 7, cost_usd: 0.001 }, results: M.semWorks });
    return json(req, { meta: { count: 18, cost_usd: 0.001 }, results: Number(p.get('page') || 1) === 1 ? M.kwWorks : [] });
  }
  if (u.hostname === 'api.crossref.org') return json(req, { message: { items: M.crossref, 'total-results': 3 } });
  if (u.hostname === 'www.ebi.ac.uk') return json(req, { hitCount: 2, resultList: { result: M.epmc } });
  return req.abort();
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setRequestInterception(true); page.on('request', route);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const axe = async () => { if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: path.join(VENDOR, 'axe-core/axe.min.js') }); return page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' ; ')}`)); };
  const P = () => page.evaluate(() => { const S = window.Paperscope.S; return { saved: [...S.saved.keys()], later: [...S.later.keys()], taste: Object.keys(S.taste).length, deck: S.deck && { i: S.deck.i, n: S.deck.list.length, counts: S.deck.counts } }; });

  // ---------- main app: two saved papers, so we can check the Lab never changes them
  await page.goto(BASE + '#search', { waitUntil: 'load' });
  await page.evaluate(raw => {
    const C = window.Core; const items = raw.map((r, i) => { const w = C.normOpenAlex(r, 'oa_kw', i + 1); w.key = C.workKey(w); return C.slim(w); });
    localStorage.setItem('paperscope.saved', JSON.stringify(items));
  }, [M.kwWorks[5], M.kwWorks[6]]);
  const mainSavedBefore = await page.evaluate(() => localStorage.getItem('paperscope.saved'));
  await page.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.ready);

  // ---------- the Lab
  await page.goto(BASE + 'lab/#search', { waitUntil: 'load' });
  const lab = await page.evaluate(() => ({ title: document.title, chip: !!document.querySelector('.lab-chip'), note: (document.querySelector('.lab-note') || {}).innerText || '', saved: window.Paperscope.S.saved.size, version: window.Paperscope.version }));
  check('Lab opens as its own copy, clearly labelled', /Paperscope Lab/.test(lab.title) && lab.chip && /copy for trying new ideas/.test(lab.note) && /lab/.test(lab.version), JSON.stringify(lab).slice(0, 160));
  check('Lab starts with its own empty storage', lab.saved === 0);
  check('Lab links back to the main app', await page.$eval('.lab-note a', a => a.getAttribute('href')) === '../');
  await page.$eval('#lab-import', b => b.click()); await sleep(200);
  check('“Bring over” copies the main app’s saved papers into the Lab', (await P()).saved.length === 2);
  check('…without changing the main app’s data', await page.evaluate(() => localStorage.getItem('paperscope.saved')) === mainSavedBefore && await page.evaluate(() => !!localStorage.getItem('paperscope-lab.saved')));

  // ---------- swipe to sort
  await page.$eval('#q', e => { e.value = 'exciton migration in molecular crystals'; }); await page.$eval('#search-form button', b => b.click());
  await page.waitForFunction(() => document.querySelectorAll('#results .paper').length > 0 && document.querySelector('#loading').hidden, { timeout: 15000 });
  check('results offer “Swipe to sort”', !!(await page.$('#swipe-open')));
  await page.$eval('#swipe-open', b => b.click()); await sleep(150);
  let st = await P();
  const deckInfo = await page.evaluate(() => ({ shown: !document.querySelector('#deck').hidden, modal: document.querySelector('#deck').getAttribute('aria-modal'), count: document.querySelector('.deck-count').textContent, focus: document.activeElement && document.activeElement.dataset.deck, title: document.querySelector('#dcard-t').textContent, behind: !!document.querySelector('.dcard.behind'), locked: document.body.classList.contains('deck-open') }));
  check('deck opens full screen with the first paper and the next one behind it', deckInfo.shown && deckInfo.modal === 'true' && deckInfo.behind && deckInfo.locked && /^1 of \d+$/.test(deckInfo.count), JSON.stringify(deckInfo));
  check('deck leaves out papers already saved', st.deck.n > 0 && !(await page.evaluate(() => window.Paperscope.S.deck.list.some(k => window.Paperscope.S.saved.has(k)))));
  check('focus starts on Keep', deckInfo.focus === 'save');
  await page.screenshot({ path: path.join(OUT, 'lab-deck-light.png') });
  check('deck: no WCAG A/AA violations (light)', (await axe()).length === 0, (await axe()).join(' | '));

  const first = await page.evaluate(() => window.Paperscope.S.deck.list[0]);
  await page.keyboard.press('ArrowRight'); await sleep(450);
  st = await P();
  check('→ keeps the paper (saved) and moves on', st.saved.includes(first) && st.deck.i === 1 && st.deck.counts.save === 1);
  check('keeping teaches the ranking some words', st.taste > 0);
  await page.keyboard.press('ArrowUp'); await sleep(450);
  const second = await page.evaluate(() => window.Paperscope.S.deck.list[1]);
  st = await P();
  check('↑ puts it on the read-later list', st.later.includes(second) && st.deck.counts.later === 1);
  await page.keyboard.press('z'); await sleep(150);
  st = await P();
  check('undo takes back the last choice', !st.later.includes(second) && st.deck.i === 1 && st.deck.counts.later === 0);

  // drag gestures
  const box = async () => { const b = await page.$eval('.dcard:not(.behind)', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }); return b; };
  const drag = async (dx, dy, steps = 8) => { const b = await box(); await page.mouse.move(b.x, b.y); await page.mouse.down(); for (let i = 1; i <= steps; i++) await page.mouse.move(b.x + dx * i / steps, b.y + dy * i / steps); await page.mouse.up(); await sleep(450); };
  const k1 = await page.evaluate(() => window.Paperscope.S.deck.list[window.Paperscope.S.deck.i]);
  await drag(40, 0, 10); st = await P();
  check('a short drag snaps back and does nothing', st.deck.i === 1 && !st.saved.includes(k1));
  await drag(220, 10); st = await P();
  check('dragging right keeps the paper', st.saved.includes(k1) && st.deck.i === 2);
  const k2 = await page.evaluate(() => window.Paperscope.S.deck.list[window.Paperscope.S.deck.i]);
  await drag(-220, 0); st = await P();
  check('dragging left skips it', !st.saved.includes(k2) && !st.later.includes(k2) && st.deck.counts.skip === 1);
  const k3 = await page.evaluate(() => window.Paperscope.S.deck.list[window.Paperscope.S.deck.i]);
  await drag(10, -200); st = await P();
  check('dragging up saves it for later', st.later.includes(k3));
  await page.$eval('.dbtn.skip', b => b.click()); await sleep(450); st = await P();
  check('the Skip button works too', st.deck.counts.skip === 2);

  // finish the deck
  for (let i = 0; i < 40 && (await P()).deck && (await P()).deck.i < (await P()).deck.n; i++) { await page.keyboard.press('ArrowLeft'); await sleep(320); }
  const done = await page.evaluate(() => ({ text: document.querySelector('.deck-done').innerText.replace(/\s+/g, ' '), focus: document.activeElement.id }));
  check('end screen sums up and offers the sky', /All sorted/.test(done.text) && /2 kept/.test(done.text) && /1 for later/.test(done.text) && done.focus === 'deck-sky', done.text);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]); await sleep(600);
  check('deck end screen: no WCAG A/AA violations (dark)', (await axe()).length === 0, (await axe()).join(' | '));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]); await sleep(400);
  await page.$eval('#deck-close2', b => b.click()); await sleep(200);
  check('closing returns to the results with the page scrollable again', await page.evaluate(() => document.querySelector('#deck').hidden && !document.body.classList.contains('deck-open') && !window.Paperscope.S.deck));
  check('the list you just sorted keeps its order', await page.evaluate(() => window.Paperscope.S.search.ranked.every(w => !w.rank.taste)));
  await page.evaluate(() => window.Paperscope.runSearch('exciton migration in molecular crystals'));
  await page.waitForFunction(() => document.querySelectorAll('#results .paper').length > 0 && document.querySelector('#loading').hidden, { timeout: 15000 });
  const nudged = await page.evaluate(() => window.Paperscope.S.search.ranked.filter(w => w.rank.taste > 0.025).length);
  check('the next search leans towards what you kept', nudged > 0 && await page.evaluate(() => /kept while swiping/.test(document.querySelector('#results').innerText)));

  // ---------- the sky
  await page.evaluate(() => { location.hash = '#saved'; }); await sleep(300);
  const sky = await page.evaluate(() => ({ stars: document.querySelectorAll('#sky-svg .star').length, faint: document.querySelectorAll('#sky-svg .star.faint').length, fresh: document.querySelectorAll('#sky-svg .star.fresh').length, labels: [...document.querySelectorAll('#sky-svg text')].map(t => t.textContent), stats: document.querySelector('.sky-stats').textContent }));
  st = await P();
  check('every saved paper is a star, read-later ones faint', sky.stars === st.saved.length + st.later.filter(k => !st.saved.includes(k)).length && sky.faint === 1, JSON.stringify({ sky: sky.stars, saved: st.saved.length, later: st.later.length }));
  check('papers saved just now glow as new stars', sky.fresh >= 2);
  check('constellations are labelled by field', sky.labels.length >= 1 && sky.labels.every(l => /\d/.test(l)), sky.labels.join(' | '));
  check('sky sums itself up', /4 papers in \d constellation/.test(sky.stats), sky.stats);
  await page.screenshot({ path: path.join(OUT, 'lab-sky-light.png') });
  const firstStar = await page.$eval('#sky-svg .star:not(.faint)', g => g.dataset.star);
  await page.$eval(`#sky-svg .star[data-star="${firstStar}"]`, g => g.dispatchEvent(new MouseEvent('click', { bubbles: true }))); await sleep(150);
  const det = await page.evaluate(() => document.querySelector('#sky-detail').innerText);
  const title = await page.evaluate(k => window.Paperscope.S.saved.get(k).title, firstStar);
  check('tapping a star shows its paper', det.includes(title.slice(0, 30)), det.slice(0, 120));
  await page.evaluate(() => document.querySelector('#sky-svg .star.faint').focus()); await page.keyboard.press('Enter'); await sleep(150);
  check('stars work from the keyboard too', /Read later/.test(await page.$eval('#sky-detail', e => e.innerText)));
  await page.$eval('#sky-detail [data-later-save]', b => b.click()); await sleep(150);
  check('“Keep it” turns a faint star bright', await page.evaluate(() => document.querySelectorAll('#sky-svg .star.faint').length === 0) && (await P()).saved.length === 5);
  check('saved view with the sky: no WCAG A/AA violations (light)', (await axe()).length === 0, (await axe()).join(' | '));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]); await sleep(600);
  check('saved view with the sky: no WCAG A/AA violations (dark)', (await axe()).length === 0, (await axe()).join(' | '));
  await page.screenshot({ path: path.join(OUT, 'lab-sky-dark.png') });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.$eval('#sky-png', b => b.click());
  await page.waitForFunction(() => /Sky saved as an image/.test(document.querySelector('#toast').textContent), { timeout: 5000 }).catch(() => {});
  check('the sky can be saved as an image', /Sky saved as an image/.test(await page.$eval('#toast', t => t.textContent)));

  // ---------- what the swipes taught
  await page.evaluate(() => { location.hash = '#profile'; }); await sleep(200);
  const taste = await page.$eval('#taste-box', e => e.innerText);
  check('Profile shows what the swipes taught', /Learned from your swipes/.test(taste) && /exciton|crystal|migration|transport/i.test(taste), taste.slice(0, 160));
  await page.$eval('#taste-reset', b => b.click()); await sleep(150);
  check('and it can be forgotten', (await P()).taste === 0 && (await page.$eval('#taste-box', e => e.innerHTML.trim())) === '');

  // ---------- reduced motion
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluate(() => { location.hash = '#search'; }); await sleep(200);
  await page.$eval('#q', e => { e.value = 'organic semiconductors'; }); await page.$eval('#search-form button', b => b.click());
  await page.waitForFunction(() => document.querySelectorAll('#results .paper').length > 0 && document.querySelector('#loading').hidden, { timeout: 15000 });
  if (await page.$('#swipe-open')) { await page.$eval('#swipe-open', b => b.click()); await sleep(100); await page.keyboard.press('ArrowLeft'); await sleep(60); }
  check('with reduced motion, swiping still works without animation', ((await P()).deck || {}).i === 1);
  await page.keyboard.press('Escape'); await sleep(100);
  check('Escape closes the deck', await page.evaluate(() => document.querySelector('#deck').hidden));

  // ---------- the main app is unaffected
  const labSaved = await page.evaluate(() => JSON.parse(localStorage.getItem('paperscope-lab.saved')).length);
  await page.goto(BASE + '#search', { waitUntil: 'load' });
  const main = await page.evaluate(async () => {
    const keys = await caches.keys(); const mainCache = keys.find(k => /^paperscope-/.test(k));
    const cached = mainCache ? await (await (await caches.open(mainCache)).match(new URL('./', location.href).href)).text() : '';
    return { chip: !!document.querySelector('.lab-chip'), saved: window.Paperscope.S.saved.size, title: document.title, keys, cachedIsMain: !!cached && !cached.includes('lab-chip') };
  });
  check('main app still has no Lab features and its own 2 saved papers', !main.chip && main.saved === 2 && !/Lab/.test(main.title) && labSaved === 5, JSON.stringify(main).slice(0, 200));
  check('the main app’s offline copy was not replaced by the Lab', main.cachedIsMain, JSON.stringify(main.keys));

  check('no page errors', errors.length === 0, errors.join(' | '));
  const failed = log.filter(x => !x).length;
  console.log(`\n${log.length - failed}/${log.length} Lab checks passed`);
  await browser.close(); server.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
