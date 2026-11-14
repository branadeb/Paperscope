// Tests the Lab's grading mode, graded-search benchmark and ranking switch (dist/lab), with mocked databases.
// Run: node tools/build.mjs lab/src dist/lab && node test/lab-bench.test.cjs
'use strict';
const path = require('path'); const fs = require('fs');
const VENDOR = '/home/claude/vendor/node_modules';
const puppeteer = require(path.join(VENDOR, 'puppeteer-core'));
const M = require('./mock-data.js');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const server = require('./static-server.cjs')(8775);
const BASE = 'http://localhost:8775/lab/';
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
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setRequestInterception(true); page.on('request', route);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const axe = async () => { if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: path.join(VENDOR, 'axe-core/axe.min.js') }); return page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' ; ')}`)); };
  const search = async q => { await page.$eval('#q', (e, v) => { e.value = v; }, q); await page.$eval('#search-form button[type="submit"]', b => b.click()); await page.waitForFunction(() => document.querySelectorAll('#results .paper').length > 3, { timeout: 10000 }); await sleep(300); };

  await page.goto(BASE + '?nosw#search', { waitUntil: 'load' }); await sleep(300);
  await page.$eval('#lab-note-hide', b => b.click());
  await search('exciton migration in molecular crystals');
  check('the new ranking is on by default', await page.evaluate(() => window.Paperscope.S.search.ranked[0].rank.scoring === 'v2'));
  check('a “Grade results” button is offered', !!(await page.$('#grade-toggle')));

  // ---------- grading mode
  await page.$eval('#grade-toggle', b => b.click()); await sleep(200);
  const g = await page.evaluate(() => {
    const S = window.Paperscope.S; const cards = [...document.querySelectorAll('#results .paper')];
    return { n: cards.length, withButtons: cards.filter(c => c.querySelectorAll('.grade button').length === 4).length, note: document.querySelector('#grade-note').innerText, count: document.querySelector('.filterbar .count').textContent,
      pool: S.search.ranked.length, order: cards.map(c => c.dataset.key), top: S.search.ranked.slice(0, cards.length).map(w => w.key) };
  });
  check('grading shows the mixed top papers, each with four grades', g.n > 5 && g.withButtons === g.n && /Grading: 0 of \d+ done/.test(g.note) && /to grade/.test(g.count), JSON.stringify({ n: g.n, w: g.withButtons, c: g.count }));
  check('the grading list is not simply the current ranking order', JSON.stringify(g.order) !== JSON.stringify(g.top));
  check('grading: no WCAG A/AA violations', (await axe()).length === 0, (await axe()).join(' | '));
  await page.screenshot({ path: path.join(OUT, 'lab-grading.png') });

  // grade: the first two "Exactly", the next two "No", one "Slightly"
  const keys = g.order.slice(0, 5);
  for (const [k, v] of [[keys[0], 3], [keys[1], 3], [keys[2], 0], [keys[3], 0], [keys[4], 1]]) {
    await page.evaluate((k, v) => document.querySelector(`.grade button[data-key="${CSS.escape(k)}"][data-grade="${v}"]`).click(), k, v); await sleep(60);
  }
  const st = await page.evaluate(() => { const b = JSON.parse(localStorage.getItem('paperscope-lab.bench')); return { n: b.length, grades: b[0].grades, pool: b[0].pool.length, q: b[0].q, note: document.querySelector('#grade-note').innerText, pressed: document.querySelectorAll('.grade button[aria-pressed="true"]').length }; });
  check('grades are stored on the device with the search and its candidates', st.n === 1 && Object.keys(st.grades).length === 5 && st.pool >= 10 && st.q === 'exciton migration in molecular crystals' && st.pressed === 5, JSON.stringify({ n: st.n, g: Object.keys(st.grades).length, pool: st.pool }));
  check('the note counts what is graded', /Grading: 5 of/.test(st.note));
  await page.evaluate(k => document.querySelector(`.grade button[data-key="${CSS.escape(k)}"][data-grade="1"]`).click(), keys[4]); await sleep(60);
  check('tapping a chosen grade again clears it', await page.evaluate(k => !(k in JSON.parse(localStorage.getItem('paperscope-lab.bench'))[0].grades), keys[4]));
  await page.$eval('#grade-done', b => b.click()); await sleep(200);
  check('“Done grading” returns to the normal list', !(await page.$('.grade')) && (await page.$eval('#grade-note', e => e.innerHTML)) === '');

  // ---------- the benchmark panel
  await page.evaluate(() => { location.hash = '#profile'; }); await sleep(300);
  const b = await page.$eval('#bench-box', e => e.innerText.replace(/\s+/g, ' '));
  check('Profile shows graded searches with both rankings compared', /Graded searches/.test(b) && /Across 1 search/.test(b) && /previous ranking \d\.\d\d, new ranking \d\.\d\d/.test(b) && /exciton migration in molecular crystals/.test(b), b.slice(0, 300));
  const m = await page.evaluate(() => { const r = window.Paperscope.benchResults(); return r.rows[0].m; });
  check('metrics are computed for databases’ order, previous and new ranking', ['source', 'v1', 'v2'].every(k => m[k].ndcg10 >= 0 && m[k].ndcg10 <= 1 && m[k].p5 >= 0), JSON.stringify(m));
  check('graded searches: no WCAG A/AA violations', (await axe()).length === 0, (await axe()).join(' | '));
  await page.evaluate(() => document.querySelector('#bench-box').scrollIntoView()); await page.screenshot({ path: path.join(OUT, 'lab-bench.png') });

  // export / import round trip
  const exported = await page.evaluate(() => JSON.stringify({ searches: window.Paperscope.S.bench }));
  await page.evaluate(() => { window.Paperscope.S.bench = []; localStorage.removeItem('paperscope-lab.bench'); });
  const fileInput = await page.$('#bench-import');
  const tmp = path.join(OUT, 'grades-roundtrip.json'); fs.writeFileSync(tmp, exported);
  await fileInput.uploadFile(tmp); await sleep(400);
  check('grades can be exported and imported again', await page.evaluate(() => window.Paperscope.S.bench.length === 1 && Object.keys(window.Paperscope.S.bench[0].grades).length === 4 && /Across 1 search/.test(document.querySelector('#bench-box').innerText)));

  // delete needs two taps
  await page.$eval('[data-bench-del="0"]', x => x.click()); await sleep(100);
  const first = await page.evaluate(() => ({ n: window.Paperscope.S.bench.length, label: document.querySelector('[data-bench-del="0"]').textContent }));
  check('deleting asks for a second tap first', first.n === 1 && /Tap again/.test(first.label));
  await page.$eval('[data-bench-del="0"]', x => x.click()); await sleep(100);
  check('…and then deletes', await page.evaluate(() => window.Paperscope.S.bench.length === 0 && /No graded searches yet/.test(document.querySelector('#bench-box').innerText)));

  // ---------- ranking switch in Settings
  await page.evaluate(() => { location.hash = '#about'; }); await sleep(300);
  check('Settings offers new and previous ranking, new selected', await page.$eval('input[name="scoring"][value="v2"]', i => i.checked));
  await page.$eval('input[name="scoring"][value="v1"]', i => i.click()); await sleep(100);
  check('choosing the previous ranking is remembered', await page.evaluate(() => JSON.parse(localStorage.getItem('paperscope-lab.settings')).scoring === 'v1'));
  await page.evaluate(() => { location.hash = '#search'; }); await sleep(200);
  await search('exciton migration in molecular crystals');
  check('searches then use the previous ranking', await page.evaluate(() => window.Paperscope.S.search.ranked[0].rank.scoring === 'v1'));
  await page.evaluate(() => { location.hash = '#about'; }); await sleep(200);
  await page.$eval('input[name="scoring"][value="v2"]', i => i.click()); await sleep(100);

  // ---------- a paper missing an idea says so
  await page.evaluate(() => { location.hash = '#search'; }); await sleep(200);
  await search('exciton migration in molecular crystals');
  const miss = await page.$$eval('#results .why li.missing', l => l.map(x => x.textContent));
  check('papers missing a specific idea say which', miss.length > 0 && miss.every(x => /^Does not mention “/.test(x)), miss.slice(0, 2).join(' | '));
  check('no page errors', errors.length === 0, errors.join(' | '));
  const failed = log.filter(x => !x).length;
  console.log(`\n${log.length - failed}/${log.length} grading and benchmark checks passed`);
  await browser.close(); server.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
