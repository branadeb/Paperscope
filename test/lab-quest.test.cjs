// Tests the Lab's trail quests: trace an idea back (or forward), replay the path, share it as a link, keep it.
// Run: node tools/build.mjs lab/src dist/lab && node test/lab-quest.test.cjs
'use strict';
const path = require('path'); const fs = require('fs');
const VENDOR = '/home/claude/vendor/node_modules';
const puppeteer = require(path.join(VENDOR, 'puppeteer-core'));
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const server = require('./static-server.cjs')(8774);
const BASE = 'http://localhost:8774/lab/';
const log = []; const check = (n, ok, d = '') => { log.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const json = (req, obj, status = 200) => req.respond({ status, headers: { 'content-type': 'application/json', ...CORS }, body: JSON.stringify(obj) });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A small citation graph. Q1 (2022) cites Q2 (2010), Q3 and Q4; Q2 cites Q5 (1987) and Q6; Q5 has no references in the data.
const field = { id: 'https://openalex.org/fields/31', display_name: 'Physics and Astronomy' };
const W = (n, title, year, cites, authors) => ({ id: `https://openalex.org/W77${n}`, doi: `https://doi.org/10.5555/q.${n}`, display_name: title, publication_year: year, publication_date: `${year}-05-01`, type: 'article',
  cited_by_count: cites, authorships: authors.map(a => ({ author: { id: null, display_name: a }, raw_author_name: a, institutions: [] })),
  primary_location: { landing_page_url: `https://doi.org/10.5555/q.${n}`, raw_type: 'journal-article', source: { display_name: 'Journal of Test Physics' } }, best_oa_location: null,
  open_access: { is_oa: false }, primary_topic: { id: 'https://openalex.org/T1', display_name: 'Exciton physics', subfield: { display_name: 'x' }, field, domain: { display_name: 'Physical Sciences' } },
  keywords: [], abstract_inverted_index: null, is_retracted: false });
const Q = {
  1: W(1, 'Exciton diffusion in organic semiconductor crystals', 2022, 90, ['Ana Start', 'Ben Lab']),
  2: W(2, 'Exciton diffusion length in organic films', 2010, 800, ['Cara Middle']),
  3: W(3, 'An unrelated machine learning method for images', 2015, 2000, ['Dev Other']),
  4: W(4, 'Charge transport in organic semiconductors', 2005, 400, ['Eve Charge']),
  5: W(5, 'Exciton diffusion in molecular crystals', 1987, 1500, ['Fay Origin', 'Gus Old']),
  6: W(6, 'Optical absorption of thin films', 1999, 120, ['Hal Film']),
  7: W(7, 'Exciton diffusion imaging in organic crystals', 2024, 30, ['Ivy New']),
  8: W(8, 'Long-range exciton diffusion in organic semiconductor crystals', 2025, 12, ['Jo Newer']),
};
const REFS = { W771: [2, 3, 4], W772: [5, 6], W775: [] };
const CITES = { W771: [7, 8], W778: [] };
const calls = [];

function route(req) {
  const url = req.url(); if (url.startsWith('data:') || url.startsWith('blob:')) return req.continue();
  const u = new URL(url); if (u.hostname === 'localhost') return req.continue();
  if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS });
  const p = u.searchParams; const f = p.get('filter') || '';
  if (u.hostname === 'api.openalex.org') {
    calls.push(decodeURIComponent(u.search));
    let m;
    if ((m = f.match(/cited_by:(W\d+)/))) return json(req, { meta: { count: (REFS[m[1]] || []).length, cost_usd: 0.0001 }, results: (REFS[m[1]] || []).map(i => Q[i]) });
    if ((m = f.match(/cites:(W\d+)/))) return json(req, { meta: { count: (CITES[m[1]] || []).length, cost_usd: 0.0001 }, results: (CITES[m[1]] || []).map(i => Q[i]) });
    if ((m = f.match(/openalex:([W\d|]+)/))) { const ids = m[1].split('|'); return json(req, { meta: { count: ids.length, cost_usd: 0.0001 }, results: Object.values(Q).filter(w => ids.includes(w.id.split('/').pop())).reverse() }); }
    if (u.pathname.startsWith('/works/W')) return json(req, { id: 'x' });
    if (p.get('group_by')) return json(req, { meta: { count: 1, cost_usd: 0.001 }, group_by: [] });
    return json(req, { meta: { count: 2, cost_usd: 0.001 }, results: Number(p.get('page') || 1) === 1 ? [Q[1], Q[3]] : [] });
  }
  if (u.hostname === 'api.crossref.org') return json(req, { message: { items: [], 'total-results': 0 } });
  if (u.hostname === 'www.ebi.ac.uk') return json(req, { hitCount: 0, resultList: { result: [] } });
  return req.abort();
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.evaluateOnNewDocument(() => { navigator.share = async d => { window.__shared = d; }; });
  await page.setRequestInterception(true); page.on('request', route);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const axe = async () => { if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: path.join(VENDOR, 'axe-core/axe.min.js') }); return page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' ; ')}`)); };
  const waitTrail = () => page.waitForFunction(() => document.querySelector('#loading').hidden && window.Paperscope.S.search && window.Paperscope.S.search.kind === 'trail' && window.Paperscope.S.search.status.oa_trail, { timeout: 10000 });
  const head = () => page.$eval('#interp', e => e.innerText.replace(/\s+/g, ' '));
  const cards = () => page.$$eval('#results .paper', els => els.map(e => ({ t: e.querySelector('h3').textContent, sg: !!e.querySelector('.quest-act.sg'), btn: (e.querySelector('[data-quest-step]') || {}).textContent || '', when: (e.querySelector('.quest-act .tiny') || {}).textContent || '', why: (e.querySelector('.sg-why') || {}).textContent || '' })));

  await page.goto(BASE + '?nosw#search', { waitUntil: 'load' });
  await page.$eval('#q', e => { e.value = 'exciton diffusion'; }); await page.$eval('#search-form button', b => b.click());
  await page.waitForFunction(() => document.querySelectorAll('#results .paper').length > 0 && document.querySelector('#loading').hidden, { timeout: 15000 });
  // “Trace its origin” lives in each card's ⋯ sheet, with the other citation trails.
  await page.$eval('#results .paper [data-card-menu]', b => b.click()); await sleep(250);
  check('result cards offer “Trace its origin” (in the card’s ⋯ sheet)', (await page.$$('#sheet-root [data-quest-start="origin"][data-key]')).length === 1 && (await page.$$('#results [data-quest-start]')).length === 0);

  // ---------- start: the references of Q1
  calls.length = 0;
  await page.$eval(`#sheet-root [data-quest-start="origin"][data-key]`, b => b.click()); await waitTrail();
  check('picking it closes the sheet', !(await page.$eval('#sheet-root', e => e.innerHTML)));
  let h = await head();
  check('quest starts at the paper, looking at its references', /Quest: find where this idea started/.test(h) && /Start: 2022/.test(h) && calls.some(c => /cited_by:W771/.test(c)), h.slice(0, 160));
  let cs = await cards();
  check('closest match comes first and explains itself', cs[0].t === 'Exciton diffusion length in organic films' && cs[0].sg && /^Closest match\. 12 years earlier/.test(cs[0].why) && /exciton/.test(cs[0].why) && /Step back to this/.test(cs[0].btn), JSON.stringify(cs[0]));
  check('a big leap back to an older landmark is offered too', cs[1].t === 'Charge transport in organic semiconductors' && /^Big leap back\. 17 years earlier/.test(cs[1].why), JSON.stringify(cs[1]));
  check('an unrelated paper is not suggested, and each card says how much earlier it is', cs.filter(c => c.sg).length === 2 && cs.some(c => /An unrelated/.test(c.t) && !c.sg && /7 years earlier/.test(c.when)), cs.map(c => c.when).join(' | '));
  await page.$eval('#results .paper [data-card-menu]', b => b.click()); await sleep(250);
  const menuTrails = await page.$$('#sheet-root [data-trail], #sheet-root [data-quest-start]');
  await page.$eval('#sheet-root [data-close-sheet].btn', b => b.click()); await sleep(250);
  check('no swiping or other trails in the middle of a quest', !(await page.$('#swipe-open')) && !(await page.$('#results [data-trail]')) && !menuTrails.length);
  check('quest header: no WCAG A/AA violations', (await axe()).length === 0, (await axe()).join(' | '));
  await page.screenshot({ path: path.join(OUT, 'lab-quest-step.png') });

  // ---------- step back, undo, step again, reach the end of the data
  await page.$eval('#results .paper [data-quest-step]', b => b.click()); await waitTrail();
  h = await head();
  check('stepping back moves the quest to that paper', /Step 1: you’re in 2010, 12 years back/.test(h) && await page.$$eval('.qcrumbs li', l => l.map(x => x.textContent).join(',')) === '2022,2010', h.slice(0, 160));
  await page.$eval('#quest-undo', b => b.click()); await waitTrail();
  check('undo returns to the previous step', /Start: 2022/.test(await head()));
  await page.$eval('#results .paper [data-quest-step]', b => b.click()); await waitTrail();
  cs = await cards();
  check('at 2010 the 1987 paper is suggested', cs[0].t === 'Exciton diffusion in molecular crystals' && cs[0].sg, cs[0].t);
  await page.$eval('#results .paper [data-quest-step]', b => b.click()); await waitTrail();
  h = await head();
  check('when the data runs out, it says so', /Step 2: you’re in 1987, 35 years back/.test(h) && /no references for this paper/.test(h) && /This is where it started/.test(h), h.slice(0, 220));

  // ---------- finish: the trail
  await page.$eval('#quest-finish', b => b.click()); await sleep(200);
  const sum = await page.evaluate(() => ({ text: document.querySelector('.trail-summary').innerText.replace(/\s+/g, ' '), steps: [...document.querySelectorAll('.tpath .tstep')].map(li => li.querySelector('.ty').textContent), pending: document.querySelectorAll('.tpath .pending').length, results: document.querySelector('#results').innerHTML.trim() }));
  check('the finished trail sums up the journey', /Where this idea started/.test(sum.text) && /35 years back in 2 steps/.test(sum.text) && sum.steps.join(',') === '2022,2010,1987', sum.text.slice(0, 200));
  check('each link says how they connect', /cites, 12 years earlier/.test(sum.text) && /cites, 23 years earlier/.test(sum.text) && /Where it started/.test(sum.text));
  check('it replays itself, one step at a time', sum.pending >= 1 && sum.results === '');
  await sleep(2600);
  check('…and ends with every step shown', await page.$$eval('.tpath .pending', l => l.length) === 0 && await page.$$eval('.tpath .arrive', l => l.length) === 3);
  check('the trail is kept on this device', await page.evaluate(() => JSON.parse(localStorage.getItem('paperscope-lab.trails')).length === 1));
  check('trail view: no WCAG A/AA violations (light)', (await axe()).length === 0, (await axe()).join(' | '));
  await page.screenshot({ path: path.join(OUT, 'lab-trail-light.png') });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]); await sleep(500);
  check('trail view: no WCAG A/AA violations (dark)', (await axe()).length === 0, (await axe()).join(' | '));
  await page.screenshot({ path: path.join(OUT, 'lab-trail-dark.png') });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

  // ---------- share
  await page.$eval('#trail-share', b => b.click()); await sleep(200);
  const shared = await page.evaluate(() => window.__shared);
  check('share sends a link with only the papers’ OpenAlex ids', shared && /#trail=o:W771\.W772\.W775$/.test(shared.url) && /back 35 years/.test(shared.text) && !/@/.test(shared.url), JSON.stringify(shared));

  // ---------- forward from the first paper
  calls.length = 0;
  await page.$eval('#trail-forward', b => b.click()); await waitTrail();
  h = await head();
  check('“See where it led” follows the citing papers instead', /Quest: see where this idea led/.test(h) && calls.some(c => /cites:W771/.test(c)));
  cs = await cards();
  check('forward quest suggests a later paper', cs[0].sg && /Step forward to this/.test(cs[0].btn) && /years? later/.test(cs[0].why), JSON.stringify(cs[0]));
  await page.$eval('#quest-quit', b => b.click()).catch(async () => { await page.$eval('#quest-undo', b => b.click()); });
  await sleep(300);
  check('leaving the quest goes back to the search', await page.evaluate(() => window.Paperscope.S.search.kind === 'search' && !window.Paperscope.S.quest && document.querySelectorAll('#results .paper').length > 0));

  // ---------- saved trails
  await page.evaluate(() => { location.hash = '#saved'; }); await sleep(300);
  const list = await page.$eval('.trail-list', e => e.innerText.replace(/\s+/g, ' '));
  check('Saved lists your trails', /35 years back in 2 steps/.test(list) && /Exciton diffusion in organic semiconductor crystals \(2022\) to Exciton diffusion in molecular crystals \(1987\)/.test(list), list);
  await page.$eval('[data-trail-open]', b => b.click()); await sleep(300);
  check('a saved trail can be replayed', await page.evaluate(() => location.hash === '#search' && /35 years back/.test(document.querySelector('.trail-summary').innerText)));

  // ---------- open a shared link elsewhere
  const ctx2 = await browser.createBrowserContext(); const p2 = await ctx2.newPage();
  p2.on('pageerror', e => errors.push(e.message));
  await p2.setRequestInterception(true); p2.on('request', route);
  await p2.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  calls.length = 0;
  await p2.goto(BASE + '?nosw#trail=o:W771.W772.W775', { waitUntil: 'load' });
  await p2.waitForSelector('.trail-summary', { timeout: 10000 });
  const s2 = await p2.evaluate(() => ({ text: document.querySelector('.trail-summary').innerText.replace(/\s+/g, ' '), steps: [...document.querySelectorAll('.tpath .ty')].map(x => x.textContent), hash: location.hash }));
  check('a shared link opens the same trail, in order', /A trail someone shared with you/.test(s2.text) && s2.steps.join(',') === '2022,2010,1987' && calls.some(c => /openalex:W771\|W772\|W775/.test(c)), s2.text.slice(0, 120));
  check('opening it does not save it to the other person’s trails', await p2.evaluate(() => !localStorage.getItem('paperscope-lab.trails')));
  await p2.$eval('#trail-continue', b => b.click());
  await p2.waitForFunction(() => window.Paperscope.S.search.kind === 'trail' && document.querySelector('#loading').hidden, { timeout: 10000 });
  check('“Follow it further yourself” continues from the last paper', /Step 2: you’re in 1987/.test(await p2.$eval('#interp', e => e.innerText)));
  await p2.goto(BASE + '?nosw#trail=o:nonsense', { waitUntil: 'load' }); await sleep(300);
  check('a broken trail link is handled', /not complete/.test(await p2.$eval('#toast', t => t.textContent)));

  // ---------- reduced motion
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.$eval('#trail-replay', b => b.click()); await sleep(100);
  check('with reduced motion, replay shows the whole path at once', await page.$$eval('.tpath .pending', l => l.length) === 0);

  check('no page errors', errors.length === 0, errors.join(' | '));
  const failed = log.filter(x => !x).length;
  console.log(`\n${log.length - failed}/${log.length} trail-quest checks passed`);
  await browser.close(); server.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
