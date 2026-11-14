// Tests the Lab's papers of the day: setup, the Crossref requests per publisher, ranking against your topics,
// once-a-day caching, not repeating yesterday's papers, saving and swiping. Crossref is mocked.
// Run: node tools/build.mjs lab/src dist/lab && node test/lab-today.test.cjs
'use strict';
const path = require('path'); const fs = require('fs');
const VENDOR = '/home/claude/vendor/node_modules';
const puppeteer = require(path.join(VENDOR, 'puppeteer-core'));
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const server = require('./static-server.cjs')(8775);
const BASE = 'http://localhost:8775/lab/';
const log = []; const check = (n, ok, d = '') => { log.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const json = (req, obj, status = 200) => req.respond({ status, headers: { 'content-type': 'application/json', ...CORS }, body: JSON.stringify(obj) });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const now = new Date();
const iso = d => new Date(now - d * 864e5).toISOString();
const item = (doi, title, journal, abs, daysAgo = 0.3) => ({ DOI: doi, title: [title], 'container-title': [journal], type: 'journal-article', abstract: abs ? `<jats:p>${abs}</jats:p>` : undefined,
  author: [{ given: 'Ada', family: 'Lovelace' }, { given: 'Bo', family: 'Chen' }], issued: { 'date-parts': [[now.getFullYear(), now.getMonth() + 1, now.getDate()]] }, created: { 'date-time': iso(daysAgo) }, URL: `https://doi.org/${doi}`, 'is-referenced-by-count': 0 });
const DATA = {
  'member:316': [item('10.1021/acs.jpclett.6c1', 'Exciton diffusion in perylene diimide crystals', 'The Journal of Physical Chemistry Letters', 'We use transient absorption microscopy to image exciton diffusion.'),
    item('10.1021/acs.jpcc.6c2', 'Correction to: Exciton diffusion in crystals', 'J. Phys. Chem. C', null),
    item('10.1021/acs.est.6c3', 'Dissolved organic matter in rivers', 'Environmental Science &amp; Technology', 'A study of rivers.')],
  'member:311': [item('10.1002/anie.6c4', 'Transient absorption of singlet fission in organic semiconductors', 'Angewandte Chemie International Edition', null),
    item('10.1002/adma.6c5', 'Battery cathodes at scale', 'Advanced Materials', 'Cathodes.')],
  'prefix:10.1038': [item('10.1038/s41557-6c6', 'Long-range exciton diffusion in molecular crystals', 'Nature Chemistry', 'Excitons travel microns.')],
  'member:221': [item('10.1126/science.6c7', 'A new bird species in the Andes', 'Science', 'Birds.')],
  'member:317': [item('10.1063/5.06c8', 'Exciton diffusion simulated with Redfield theory', 'The Journal of Chemical Physics', 'Open quantum systems.')],
};
const crCalls = [];
function route(req) {
  const url = req.url(); if (url.startsWith('data:') || url.startsWith('blob:')) return req.continue();
  const u = new URL(url); if (u.hostname === 'localhost') return req.continue();
  if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS });
  if (u.hostname === 'api.crossref.org') {
    const f = u.searchParams.get('filter') || ''; crCalls.push({ f, q: u.searchParams.get('query.bibliographic'), rows: u.searchParams.get('rows') });
    const key = Object.keys(DATA).find(k => f.startsWith(k + ','));
    if (/member:221/.test(f) && global.FAIL_SCIENCE) return json(req, { message: 'Too many requests' }, 429);
    return json(req, { status: 'ok', message: { 'total-results': key ? DATA[key].length : 0, items: key ? DATA[key] : [] } });
  }
  if (u.hostname === 'api.openalex.org') return json(req, u.pathname.startsWith('/works/W') ? { id: 'x' } : { meta: { count: 0, cost_usd: 0 }, results: [] });
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
  const today = () => page.$eval('#today', e => e.innerText.replace(/\s+/g, ' '));
  const titles = () => page.$$eval('.today-list h3', l => l.map(x => x.textContent));
  const waitToday = () => page.waitForFunction(() => document.querySelector('#today .today-list, #today .today > p.small') && !document.querySelector('#today [aria-busy="true"]'), { timeout: 10000 });

  await page.goto(BASE + '?nosw#search', { waitUntil: 'load' }); await sleep(300);
  let t = await today();
  check('without topics or a profile, it asks what you work on', /Tell Paperscope what you work on/.test(t) && /ACS, Wiley, Nature and Science/.test(t) && crCalls.length === 0, t.slice(0, 140));
  check('setup: no WCAG A/AA violations', (await axe()).length === 0, (await axe()).join(' | '));
  const defaults = await page.$$eval('input[name="today-pub"]:checked', l => l.map(i => i.value).join(','));
  check('ACS, Wiley, Nature and Science are chosen by default', defaults === 'acs,wiley,nature,science', defaults);

  await page.$eval('#today-topics', e => { e.value = 'exciton diffusion, transient absorption, perylene diimide'; });
  await page.$eval('#today-save', b => b.click()); await waitToday();
  check('one Crossref request per publisher, new journal articles only', crCalls.length === 4 && crCalls.every(c => /from-created-date:\d{4}-\d{2}-\d{2},type:journal-article$/.test(c.f) && c.rows === '40') && ['member:316', 'member:311', 'prefix:10.1038', 'member:221'].every(k => crCalls.some(c => c.f.startsWith(k + ','))), JSON.stringify(crCalls.map(c => c.f)));
  check('your topics are what is searched', crCalls.every(c => c.q === 'exciton diffusion transient absorption perylene diimide'));
  let ts = await titles(); t = await today();
  check('papers matching your topics are listed, best first', ts[0] === 'Exciton diffusion in perylene diimide crystals' && ts.length === 3 && ts.includes('Long-range exciton diffusion in molecular crystals') && ts.includes('Transient absorption of singlet fission in organic semiconductors'), ts.join(' | '));
  check('corrections and unrelated papers are left out', !ts.some(x => /Correction|rivers|Battery|bird/.test(x)));
  check('it says what was searched and why each paper is there', /3 new papers matching your work, from \d+ new in ACS, Wiley, Nature and Science since/.test(t) && /Mentions exciton diffusion, perylene diimide, transient absorption\./.test(t), t.slice(0, 260));
  check('a paper without an abstract says so', /No abstract yet, so this is from the title/.test(t));
  check('journal names are clean', !/&amp;/.test(t));
  check('papers of the day: no WCAG A/AA violations (light)', (await axe()).length === 0, (await axe()).join(' | '));
  await page.evaluate(() => document.querySelector('#today').scrollIntoView()); await sleep(200);
  await page.screenshot({ path: path.join(OUT, 'lab-today-light.png') });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]); await sleep(500);
  await page.evaluate(() => document.querySelector('#today').scrollIntoView());
  check('papers of the day: no WCAG A/AA violations (dark)', (await axe()).length === 0, (await axe()).join(' | '));
  await page.screenshot({ path: path.join(OUT, 'lab-today-dark.png') });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

  // ---------- once a day
  crCalls.length = 0;
  await page.reload({ waitUntil: 'load' }); await sleep(500);
  check('opening the app again the same day shows the same list without searching again', crCalls.length === 0 && (await titles()).length === 3);
  await page.$eval('#today-refresh', b => b.click()); await waitToday();
  check('“Check again” searches again on request', crCalls.length === 4 && (await titles()).length === 3);

  // ---------- save, swipe
  await page.$eval('[data-today-save]', b => b.click()); await sleep(150);
  check('a paper of the day can be saved', await page.evaluate(() => window.Paperscope.S.saved.size === 1) && await page.$eval('[data-today-save]', b => b.getAttribute('aria-pressed')) === 'true');
  await page.$eval('#today-swipe', b => b.click()); await sleep(200);
  const deck = await page.evaluate(() => ({ title: document.querySelector('#deck-h').textContent, n: window.Paperscope.S.deck.list.length, reason: document.querySelector('.dcard:not(.behind) .why').innerText }));
  check('“Swipe through them” sorts today’s papers, skipping saved ones', deck.title === 'Papers of the day' && deck.n === 2 && /Mentions/.test(deck.reason), JSON.stringify(deck));
  await page.keyboard.press('ArrowRight'); await sleep(400); await page.keyboard.press('ArrowLeft'); await sleep(400);
  await page.$eval('#deck-close2', b => b.click()); await sleep(200);
  check('after swiping, the list shows what was kept', await page.evaluate(() => window.Paperscope.S.saved.size === 2 && document.querySelector('#deck').hidden && document.querySelectorAll('[data-today-save][aria-pressed="true"]').length === 2));

  // ---------- the next day: since the last check, and no repeats
  await page.evaluate(() => { const t = JSON.parse(localStorage.getItem('paperscope-lab.today')); t.day = '2000-01-01'; t.at = new Date(Date.now() - 864e5).toISOString(); localStorage.setItem('paperscope-lab.today', JSON.stringify(t)); });
  crCalls.length = 0;
  await page.reload({ waitUntil: 'load' }); await waitToday();
  const sinceUsed = (crCalls[0] && crCalls[0].f.match(/from-created-date:([\d-]+)/) || [])[1];
  const expectSince = new Date(Date.now() - 864e5 - 864e5 / 2).toISOString().slice(0, 10);
  check('the next day it looks again, from the last check', crCalls.length === 4 && sinceUsed === expectSince, `${sinceUsed} vs ${expectSince}`);
  t = await today();
  check('papers already shown are not repeated', (await titles()).length === 0 && /Nothing new matching your topics/.test(t), t.slice(0, 160));

  // ---------- more publishers, and a failing one
  await page.$eval('.today-set', d => { d.open = true; });
  await page.$eval('input[name="today-pub"][value="aip"]', i => { i.checked = true; });
  global.FAIL_SCIENCE = true; crCalls.length = 0;
  await page.$eval('#today-save', b => b.click()); await waitToday();
  check('adding AIP searches it too', new Set(crCalls.map(c => c.f)).size === 5 && crCalls.some(c => c.f.startsWith('member:317,')));
  t = await today();
  check('a publisher that fails is reported, the rest still shown', /Science: Crossref is limiting requests/.test(t) && (await titles()).includes('Exciton diffusion simulated with Redfield theory'), t.slice(0, 300));
  global.FAIL_SCIENCE = false;

  // ---------- with a profile instead of typed topics
  await page.evaluate(() => { const S = window.Paperscope.S; S.settings.todayTopics = ''; S.profile = window.Core.extractProfile('Research interests: singlet fission; organic semiconductors. Methods: transient absorption spectroscopy.'); });
  crCalls.length = 0;
  await page.evaluate(() => { localStorage.removeItem('paperscope-lab.today'); });
  await page.$eval('#today-refresh', b => b.click()); await waitToday();
  check('a profile’s terms are used when no topics are typed', crCalls.length > 0 && /singlet fission/.test(crCalls[0].q || ''), crCalls[0] && crCalls[0].q);

  await page.$eval('#lab-note-hide', b => b.click()); await page.reload({ waitUntil: 'load' }); await sleep(300);
  check('the Lab note can be dismissed for good', await page.$eval('.lab-note', n => n.hidden));
  check('no page errors', errors.length === 0, errors.join(' | '));
  const failed = log.filter(x => !x).length;
  console.log(`\n${log.length - failed}/${log.length} papers-of-the-day checks passed`);
  await browser.close(); server.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
