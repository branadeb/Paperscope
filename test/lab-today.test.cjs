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
const crCalls = []; const oaCalls = []; const s2Calls = [];
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
  if (u.hostname === 'api.openalex.org') {
    if (u.pathname.startsWith('/works/W')) return json(req, { id: 'x' });
    const f = u.searchParams.get('filter') || '';
    if (/host_organization_lineage/.test(f)) { oaCalls.push({ f, q: u.searchParams.get('search') }); return json(req, { meta: { count: global.OA_WORKS ? global.OA_WORKS.length : 0, cost_usd: 0.001 }, results: global.OA_WORKS || [] }); }
    return json(req, { meta: { count: 0, cost_usd: 0 }, results: [] });
  }
  if (u.hostname === 'api.semanticscholar.org') { s2Calls.push(JSON.parse(req.postData() || '{}')); return json(req, { recommendedPapers: global.S2_PAPERS || [] }); }
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
  const nq = await page.evaluate(() => window.Core.todayQueries(window.Core.todayTerms(null, 'exciton diffusion, transient absorption, perylene diimide')).length);
  check('one Crossref request per publisher and word group, new journal articles only', nq === 2 && crCalls.length === 4 * nq && crCalls.every(c => /from-created-date:\d{4}-\d{2}-\d{2},type:journal-article$/.test(c.f) && c.rows === '40') && ['member:316', 'member:311', 'prefix:10.1038', 'member:221'].every(k => crCalls.some(c => c.f.startsWith(k + ','))), JSON.stringify(crCalls.map(c => c.f)));
  check('your topics are what is searched first, then related wording', crCalls[0].q.startsWith('exciton diffusion transient absorption perylene diimide') && crCalls.some(c => /pump-probe/.test(c.q)), crCalls.map(c => c.q).join(' | '));
  check('the related wording is shown', /Related wording that also counts: [^.]*pump-probe/.test(await page.$eval('#today-related', e => e.textContent)));
  let ts = await titles(); t = await today();
  check('papers matching your topics are listed, best first', ts[0] === 'Exciton diffusion in perylene diimide crystals' && ts.length === 3 && ts.includes('Long-range exciton diffusion in molecular crystals') && ts.includes('Transient absorption of singlet fission in organic semiconductors'), ts.join(' | '));
  check('corrections and unrelated papers are left out', !ts.some(x => /Correction|rivers|Battery|bird/.test(x)));
  check('it says what was searched and why each paper is there', /3 new papers from ACS, Wiley, Nature and Science in the last 5 days: 2 on your topics, 1 using your methods\./.test(t) && /Looked at \d+ new papers: \d+ from Crossref, 0 from OpenAlex/.test(t) && /Mentions [^.]*exciton diffusion/.test(t) && /Mentions [^.]*perylene diimide/.test(t), t.slice(0, 260));
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
  check('“Check again” searches again on request', crCalls.length === 4 * nq && (await titles()).length === 3);

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
  const expectSince = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
  check('the next day it looks again, over the last 5 days', crCalls.length === 4 * nq && sinceUsed === expectSince, `${sinceUsed} vs ${expectSince}`);
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

  // ---------- many topics: sent in short groups (Crossref finds nothing for one long query)
  await page.$eval('.today-set', d => { d.open = true; });
  await page.$eval('input[name="today-pub"][value="aip"]', i => { i.checked = false; });
  await page.$eval('#today-topics', e => { e.value = 'exciton diffusion, transient absorption, perylene diimide, organic semiconductor crystals, singlet fission, two-dimensional electronic spectroscopy, charge transfer, ion transport'; });
  crCalls.length = 0;
  await page.$eval('#today-save', b => b.click()); await waitToday();
  const groups = [...new Set(crCalls.map(c => c.q))];
  check('many topics are sent in short groups, to every publisher, one request at a time', groups.length > 1 && groups.every(q => q.split(' ').length <= 7) && crCalls.length === 4 * groups.length
    && groups.join(' ').includes('ion transport') && groups.join(' ').includes('exciton diffusion'), JSON.stringify(groups));
  check('a paper found by two groups is listed once', new Set(await titles()).size === (await titles()).length);

  // ---------- with a profile instead of typed topics
  await page.evaluate(() => { const S = window.Paperscope.S; S.settings.todayTopics = ''; S.profile = window.Core.extractProfile('Research interests: singlet fission; organic semiconductors. Methods: transient absorption spectroscopy.'); });
  crCalls.length = 0;
  await page.evaluate(() => { localStorage.removeItem('paperscope-lab.today'); });
  await page.$eval('#today-refresh', b => b.click()); await waitToday();
  check('a profile’s terms are used when no topics are typed', crCalls.length > 0 && /singlet fission/.test(crCalls[0].q || ''), crCalls[0] && crCalls[0].q);

  // ---------- the reported case: "ultrafast spectroscopy" alone, with a list saved by the previous version
  await page.evaluate(() => { const st = JSON.parse(localStorage.getItem('paperscope-lab.settings') || '{}'); st.todayTopics = 'ultrafast spectroscopy'; localStorage.setItem('paperscope-lab.settings', JSON.stringify(st));
    localStorage.removeItem('paperscope-lab.profile');
    const d = new Date(); const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    localStorage.setItem('paperscope-lab.today', JSON.stringify({ day, at: new Date().toISOString(), since: day, sig: 'acs,wiley,nature,science|ultrafast spectroscopy', pubs: [], considered: 24, items: [], errors: [], seenBefore: [], seen: [] })); });
  crCalls.length = 0;
  await page.reload({ waitUntil: 'load' }); await waitToday();
  t = await today();
  check('after this update, a list saved by the old version is fetched again', crCalls.length > 0 && crCalls[0].q.startsWith('ultrafast spectroscopy'), crCalls.map(c => c.q).join(' | '));
  check('“ultrafast spectroscopy” finds transient-absorption papers', (await titles()).includes('Exciton diffusion in perylene diimide crystals') && /Mentions [^.]*transient absorption/.test(t), t.slice(0, 300));

  // ---------- version 3: OpenAlex abstracts, older papers left out, labels, variety, Semantic Scholar opt-in
  const day = d => new Date(now - d * 864e5).toISOString().slice(0, 10);
  const oaw = (id, doi, title, abs, d = 1) => ({ id: 'https://openalex.org/' + id, doi: 'https://doi.org/' + doi, display_name: title, publication_year: now.getFullYear(), publication_date: day(d), type: 'article', cited_by_count: 0,
    authorships: [{ author: { id: 'A1', display_name: 'Cy Dee' }, institutions: [] }], primary_location: { source: { display_name: 'Nature Chemistry', host_organization_name: 'Nature Portfolio' }, landing_page_url: 'https://doi.org/' + doi },
    abstract_inverted_index: Object.fromEntries(abs.split(' ').map((w, i) => [w, [i]])) });
  global.OA_WORKS = [
    oaw('W1', '10.1038/s41557-oa1', 'Ultrafast charge separation at donor interfaces', 'We resolve exciton diffusion and charge separation with transient absorption in perylene diimide films.'),
    oaw('W2', '10.1038/s41557-oa2', 'Ultrafast charge separation at donor interfaces (Nature Chem.)', 'We resolve exciton diffusion and charge separation with transient absorption in perylene diimide films.'),
    oaw('W3', '10.9999/other-publisher', 'Exciton diffusion in a journal you did not choose', 'Exciton diffusion everywhere.'),
  ];
  DATA['member:221'] = [Object.assign(item('10.1126/science.old', 'Exciton diffusion in perylene diimide, a 2009 classic', 'Science', 'Old paper with a new DOI record.'), { 'published-online': { 'date-parts': [[2009, 3, 2]] } })];
  global.S2_PAPERS = [{ title: 'Hydrogen bonding networks in ionic liquids', externalIds: { DOI: '10.1021/acs.jpcb.s2x' }, publicationDate: day(2), venue: 'J. Phys. Chem. B', abstract: 'Ionic liquids form networks.', authors: [{ name: 'Ed Fox' }], citationCount: 0 },
    { title: 'A paper from last spring', externalIds: { DOI: '10.1021/acs.old' }, publicationDate: day(200), venue: 'JACS', authors: [] }];
  await page.evaluate(() => { const st = JSON.parse(localStorage.getItem('paperscope-lab.settings') || '{}'); st.todayTopics = 'exciton diffusion, transient absorption, perylene diimide'; st.todayPubs = ['acs', 'wiley', 'nature', 'science']; st.todayS2 = false; localStorage.setItem('paperscope-lab.settings', JSON.stringify(st)); localStorage.removeItem('paperscope-lab.today'); });
  crCalls.length = 0; oaCalls.length = 0; s2Calls.length = 0;
  await page.reload({ waitUntil: 'load' }); await waitToday();
  t = await today(); let tl = await titles();
  check('one OpenAlex keyword search covers all chosen publishers, published in the last 5 days', oaCalls.length === 1 && /host_organization_lineage:P4310320006\|P4310320595\|P4310319908\|P4310315823/.test(oaCalls[0].f) && oaCalls[0].f.includes(`from_publication_date:${day(5)}`) && /"exciton diffusion" OR "transient absorption" OR "perylene diimide"/.test(oaCalls[0].q), JSON.stringify(oaCalls[0]));
  check('papers found through their abstracts (OpenAlex) are listed', tl.includes('Ultrafast charge separation at donor interfaces'), tl.join(' | '));
  check('a paper from a publisher you did not choose is left out', !tl.some(x => /did not choose/.test(x)));
  check('an old paper with a new DOI record is left out, and the count says so', !tl.some(x => /2009 classic/.test(x)) && /older papers with new DOI records were left out/.test(t), t.slice(0, 400));
  check('near-identical titles appear once', tl.filter(x => /^Ultrafast charge separation/.test(x)).length === 1, tl.join(' | '));
  const labels = await page.$$eval('.today-list .tlabel', l => l.map(x => x.textContent));
  check('each paper is labelled as your topic, your method or nearby', labels.length > 0 && labels.every(x => ['Your topic', 'Your method', 'Nearby'].includes(x)) && labels.includes('Your topic'), labels.join(','));
  check('each paper says which source found it', await page.$$eval('.today-list .via', l => l.length > 0 && l.every(x => /^Found by (Crossref|OpenAlex|Semantic Scholar)/.test(x.textContent))));
  check('Semantic Scholar is not asked unless you turn it on', s2Calls.length === 0);
  // turn on "papers like my saved ones"
  await page.$eval('.today-set', d => { d.open = true; }); await page.$eval('#today-s2', i => { i.checked = true; });
  crCalls.length = 0; oaCalls.length = 0;
  await page.$eval('#today-save', b => b.click()); await waitToday();
  t = await today(); tl = await titles();
  const sent = s2Calls[0] && s2Calls[0].positivePaperIds || [];
  check('with it on, the DOIs of your saved papers go to Semantic Scholar', s2Calls.length === 1 && sent.length >= 1 && sent.every(x => /^DOI:10\./.test(x)), JSON.stringify(sent));
  await page.$eval('#today-more', b => b.click()).catch(() => {}); await sleep(100); tl = await titles(); t = await today();
  check('its recent suggestion appears as “Nearby”, with the reason; older ones do not', tl.includes('Hydrogen bonding networks in ionic liquids') && !tl.includes('A paper from last spring') && /Suggested by Semantic Scholar as similar to your saved papers/.test(t), tl.join(' | '));
  check('the privacy table lists Semantic Scholar', await page.evaluate(() => /Semantic Scholar, once a day/.test(document.querySelector('#view-about').textContent)));
  check('papers of the day v3: no WCAG A/AA violations', (await axe()).length === 0, (await axe()).join(' | '));
  await page.evaluate(() => document.querySelector('#today').scrollIntoView()); await sleep(150);
  await page.screenshot({ path: path.join(OUT, 'lab-today-v3.png') });
  global.OA_WORKS = null; global.S2_PAPERS = null; delete DATA['member:221'];

  await page.$eval('#lab-note-hide', b => b.click()); await page.reload({ waitUntil: 'load' }); await sleep(300);
  check('the Lab note can be dismissed for good', await page.$eval('.lab-note', n => n.hidden));
  check('no page errors', errors.length === 0, errors.join(' | '));
  const failed = log.filter(x => !x).length;
  console.log(`\n${log.length - failed}/${log.length} papers-of-the-day checks passed`);
  await browser.close(); server.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
