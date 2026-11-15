// Tests app-like navigation: the back button steps back inside the app (closing panels first, then results, then
// tabs), the header back arrow, the logo, and that each place keeps its scroll position. Databases are mocked.
// Run: node tools/build.mjs && node tools/build.mjs lab/src dist/lab && node test/nav.test.cjs [lab/ | ""]
'use strict';
const path = require('path'); const fs = require('fs');
const VENDOR = '/home/claude/vendor/node_modules';
const puppeteer = require(path.join(VENDOR, 'puppeteer-core'));
const M = require('./mock-data.js');
const server = require('./static-server.cjs')(8777);
const WHICH = process.argv[2] === undefined ? 'lab/' : process.argv[2];
const BASE = `http://localhost:8777/${WHICH}`;
const LAB = WHICH === 'lab/';
const log = []; const check = (n, ok, d = '') => { log.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const json = (req, obj) => req.respond({ status: 200, headers: { 'content-type': 'application/json', ...CORS }, body: JSON.stringify(obj) });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const many = []; for (let k = 0; k < 3; k++) M.kwWorks.forEach(w => many.push(Object.assign({}, w, { id: w.id + 'x' + k, doi: w.doi ? w.doi + 'x' + k : null, display_name: w.display_name + (k ? ` (part ${k})` : '') })));

function route(req) {
  const url = req.url(); if (url.startsWith('data:') || url.startsWith('blob:')) return req.continue();
  const u = new URL(url); if (u.hostname === 'localhost') return req.continue();
  if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS });
  const p = u.searchParams; const f = p.get('filter') || '';
  if (u.hostname === 'api.openalex.org') {
    if (u.pathname.startsWith('/works/W')) return json(req, { id: 'x' });
    if (p.get('group_by')) return json(req, { meta: { count: 1, cost_usd: 0.001 }, group_by: M.groupByPhysical });
    if (/^(cites|cited_by|related_to):/.test(f)) return json(req, { meta: { count: 5, cost_usd: 0.0001 }, results: M.kwWorks.slice(4, 9) });
    if (p.get('search.semantic')) return json(req, { meta: { count: 7, cost_usd: 0.001 }, results: M.semWorks });
    return json(req, { meta: { count: 54, cost_usd: 0.001 }, results: Number(p.get('page') || 1) === 1 ? many.slice(0, 40) : [] });
  }
  if (u.hostname === 'api.crossref.org') return json(req, { message: { items: M.crossref, 'total-results': 3 } });
  if (u.hostname === 'www.ebi.ac.uk') return json(req, { hitCount: 2, resultList: { result: M.epmc } });
  return req.abort();
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await (await browser.createBrowserContext()).newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setRequestInterception(true); page.on('request', route);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const back = async () => { await page.evaluate(() => history.back()); await sleep(450); };
  const state = () => page.evaluate(() => { const S = window.Paperscope.S; return { url: location.href.replace(/^.*?#/, '#'), search: S.search ? S.search.kind + ':' + S.search.q : null, start: !document.querySelector('#start').hidden,
    view: ['search', 'today', 'profile', 'saved', 'settings', 'about'].find(v => document.querySelector('#view-' + v) && !document.querySelector('#view-' + v).hidden), y: Math.round(scrollY), papers: document.querySelectorAll('#results .paper').length, backBtn: !document.querySelector('#nav-back').hidden,
    sheet: !!document.querySelector('#sheet-root').innerHTML, deck: !!(document.querySelector('#deck') && !document.querySelector('#deck').hidden) }; });
  const search = async q => { await page.$eval('#q', (e, v) => { e.value = v; }, q); await page.$eval('#search-form button[type="submit"]', b => b.click()); await page.waitForFunction(() => document.querySelectorAll('#results .paper').length > 5, { timeout: 10000 }); await sleep(300); };
  const tab = async v => { await page.$eval(`.tabs a[data-view="${v}"]`, a => a.click()); await sleep(250); };
  // In the Lab, Settings and About open from the ⋯ menu in the header; the main app has an About tab.
  const menuTo = async v => { await page.$eval('#menu-btn', b => b.click()); await sleep(250); await page.$eval(`#sheet-root [data-menu="${v}"]`, b => b.click()); await sleep(550); };
  const about = () => (LAB ? menuTo('about') : tab('about'));

  await page.goto('http://localhost:8777/', { waitUntil: 'load' }); // a page "before" the app, like a browser tab's history
  await page.goto(BASE + '?nosw#search', { waitUntil: 'load' }); await sleep(400);
  if (LAB) await page.$eval('#lab-note-hide', b => b.click()).catch(() => {});
  let s = await state();
  check('the start screen has no back arrow', s.start && !s.backBtn, JSON.stringify(s));

  // ---------- results ↔ start screen
  await search('exciton migration in molecular crystals');
  s = await state(); check('after a search, a back arrow appears in the header', s.backBtn && s.papers > 5);
  await back(); s = await state();
  check('back from results returns to the start screen, inside the app', s.start && !s.search && /localhost:8777/.test(await page.url()) && s.view === 'search', JSON.stringify(s));
  await page.evaluate(() => history.forward()); await sleep(450); s = await state();
  check('forward brings the results back', !s.start && s.papers > 5, JSON.stringify(s));

  // ---------- tabs keep your place
  await page.evaluate(() => window.scrollTo(0, 1500)); await sleep(150);
  await tab('saved'); s = await state(); check('a tab opens at its own scroll position', s.view === 'saved' && s.y === 0, JSON.stringify(s));
  await about(); await page.evaluate(() => window.scrollTo(0, 400)); await sleep(100);
  await back(); s = await state();
  check('back from another tab returns to the results where you left them', s.view === 'search' && s.papers > 5 && Math.abs(s.y - 1500) < 40, JSON.stringify(s));
  await about(); s = await state(); check('About remembers where you were in it', s.view === 'about' && Math.abs(s.y - 400) < 40, JSON.stringify(s));
  await tab('search'); s = await state();
  check('tapping Search returns to the results at the same place', s.view === 'search' && s.papers > 5 && Math.abs(s.y - 1500) < 40, JSON.stringify(s));
  await back(); s = await state();
  check('…and back from there goes to the start screen, not through every tab visited', s.start && s.view === 'search', JSON.stringify(s));
  await page.evaluate(() => history.forward()); await sleep(450);

  // ---------- panels close first
  await page.evaluate(() => window.scrollTo(0, 0)); await sleep(100);
  await page.$eval('#open-filters', b => b.click()); await sleep(200);
  s = await state(); check('Filters opens as a panel', s.sheet);
  await back(); s = await state(); check('back closes the Filters panel and keeps the results', !s.sheet && s.papers > 5, JSON.stringify(s));
  await page.$eval('#open-filters', b => b.click()); await sleep(150); await page.$eval('[data-close-sheet].btn', b => b.click()); await sleep(450);
  s = await state(); check('closing the panel with Cancel does not leave a stray back step', !s.sheet && s.papers > 5 && s.backBtn);
  await back(); s = await state(); check('…so the next back goes to the start screen', s.start, JSON.stringify(s));
  await page.evaluate(() => history.forward()); await sleep(450);
  if (LAB) {
    await page.$eval('#swipe-open', b => b.click()); await sleep(250);
    s = await state(); check('swipe cards open as a panel', s.deck);
    await back(); s = await state(); check('back closes the swipe cards and keeps the results', !s.deck && s.papers > 5, JSON.stringify(s));
  }

  // ---------- results → a paper's trail → back
  await page.evaluate(() => window.scrollTo(0, 900)); await sleep(150);
  if (LAB) { // a paper's citation trails are in its ⋯ sheet
    await page.evaluate(() => { const b = [...document.querySelectorAll('#results .paper[data-key] [data-card-menu]')].find(x => x.getBoundingClientRect().top > 60) || document.querySelector('#results [data-card-menu]'); b.click(); }); await sleep(250);
    s = await state(); check('a paper’s ⋯ opens its actions as a panel', s.sheet && !!(await page.$('#sheet-root [data-trail="refs"]')));
    await back(); s = await state(); check('back closes the paper’s actions and keeps your place', !s.sheet && Math.abs(s.y - 900) < 60, JSON.stringify(s));
    await page.evaluate(() => { const b = [...document.querySelectorAll('#results .paper[data-key] [data-card-menu]')].find(x => x.getBoundingClientRect().top > 60) || document.querySelector('#results [data-card-menu]'); b.click(); }); await sleep(250);
    await page.$eval('#sheet-root [data-trail="refs"]', b => b.click());
  } else await page.evaluate(() => { const b = [...document.querySelectorAll('#results [data-trail="refs"]')].find(x => x.getBoundingClientRect().top > 0) || document.querySelector('#results [data-trail="refs"]'); b.click(); });
  await page.waitForFunction(() => window.Paperscope.S.search.kind === 'trail' && document.querySelectorAll('#results .paper').length > 0, { timeout: 8000 }); await sleep(200);
  s = await state(); check('a paper’s references open as a new screen', s.search.startsWith('trail:'));
  await back(); s = await state();
  check('back returns to the search results at the same place', s.search === 'search:exciton migration in molecular crystals' && Math.abs(s.y - 900) < 60, JSON.stringify(s));

  if (LAB) { // ---------- the ⋯ menu, Settings and Today
    await page.$eval('#menu-btn', b => b.click()); await sleep(250);
    s = await state(); check('the ⋯ menu opens as a panel', s.sheet && !!(await page.$('#sheet-root [data-menu="settings"]')) && !!(await page.$('#sheet-root [data-menu="about"]')));
    await back(); s = await state(); check('back closes the menu and keeps the results', !s.sheet && s.search === 'search:exciton migration in molecular crystals', JSON.stringify(s));
    await menuTo('settings'); s = await state(); check('Settings opens from the menu, with a back arrow', s.view === 'settings' && s.backBtn && /#settings$/.test(s.url), JSON.stringify(s));
    await back(); s = await state(); check('back from Settings returns to the results', s.view === 'search' && s.search === 'search:exciton migration in molecular crystals', JSON.stringify(s));
    await tab('today'); s = await state(); check('the Today tab shows papers of the day', s.view === 'today' && /#today$/.test(s.url) && !!(await page.$('#view-today #today-h')), JSON.stringify(s));
    await back(); s = await state(); check('back from Today returns to the results', s.view === 'search' && s.papers > 5, JSON.stringify(s));
  }

  // ---------- header back arrow and logo
  await page.$eval('#nav-back', b => b.click()); await sleep(450); s = await state();
  check('the header back arrow goes back like the back button', s.start && !s.backBtn, JSON.stringify(s));
  await search('singlet fission');
  await page.$eval('#home-link', a => a.click()); await sleep(300); s = await state();
  check('the logo goes to the start screen', s.start);
  await back(); s = await state(); check('…and back returns to those results', !s.start && s.search === 'search:singlet fission', JSON.stringify(s));

  // ---------- a link inside a page to another section, then back
  await page.evaluate(() => { location.hash = '#about'; }); await sleep(300);
  await back(); s = await state(); check('a link to another section can be undone with back', s.view === 'search' && s.search === 'search:singlet fission', JSON.stringify(s));

  // ---------- reload keeps the app usable
  await page.reload({ waitUntil: 'load' }); await sleep(400); s = await state();
  check('after a reload the app opens normally', s.view === 'search' && s.start, JSON.stringify(s));
  check('no page errors', errors.length === 0, errors.join(' | '));
  const failed = log.filter(x => !x).length;
  console.log(`\n${log.length - failed}/${log.length} navigation checks passed (${LAB ? 'Lab' : 'main app'})`);
  await browser.close(); server.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
