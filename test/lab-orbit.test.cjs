// Tests the Lab's orbit ("More like these" from saved papers, Keep going, the lean towards saved papers) and the
// optional AI check with your own key. OpenAlex and the AI provider are mocked.
// Run: node tools/build.mjs lab/src dist/lab && node test/lab-orbit.test.cjs
'use strict';
const path = require('path'); const fs = require('fs');
const VENDOR = '/home/claude/vendor/node_modules';
const puppeteer = require(path.join(VENDOR, 'puppeteer-core'));
const M = require('./mock-data.js');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const server = require('./static-server.cjs')(8776);
const BASE = 'http://localhost:8776/lab/';
const log = []; const check = (n, ok, d = '') => { log.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const json = (req, obj, status = 200) => req.respond({ status, headers: { 'content-type': 'application/json', ...CORS }, body: JSON.stringify(obj) });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const oaCalls = []; const llmCalls = [];

function route(req) {
  const url = req.url(); if (url.startsWith('data:') || url.startsWith('blob:')) return req.continue();
  const u = new URL(url); if (u.hostname === 'localhost') return req.continue();
  if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS });
  const p = u.searchParams;
  if (u.hostname === 'api.openalex.org') {
    const f = p.get('filter') || '';
    oaCalls.push({ f, sem: p.get('search.semantic'), search: p.get('search'), sort: p.get('sort') });
    if (u.pathname.startsWith('/works/W')) return json(req, { id: 'x' });
    if (p.get('group_by')) return json(req, { meta: { count: 1, cost_usd: 0.001 }, group_by: M.groupByPhysical });
    if (/^related_to:/.test(f)) return json(req, { meta: { count: 4, cost_usd: 0.0001 }, results: M.kwWorks.slice(6, 10) });
    if (/^cites:/.test(f)) return json(req, { meta: { count: 3, cost_usd: 0.0001 }, results: M.kwWorks.slice(10, 13) });
    if (/^cited_by:/.test(f)) return json(req, { meta: { count: 3, cost_usd: 0.0001 }, results: M.kwWorks.slice(13, 16) });
    if (p.get('search.semantic')) return json(req, { meta: { count: 7, cost_usd: 0.001 }, results: M.semWorks.concat(M.kwWorks.slice(0, 3)) });
    return json(req, { meta: { count: 18, cost_usd: 0.001 }, results: Number(p.get('page') || 1) === 1 ? M.kwWorks : [] });
  }
  if (u.hostname === 'api.crossref.org') return json(req, { message: { items: [], 'total-results': 0 } });
  if (u.hostname === 'www.ebi.ac.uk') return json(req, { hitCount: 0, resultList: { result: [] } });
  if (u.hostname === 'llm.example') {
    const body = JSON.parse(req.postData() || '{}'); llmCalls.push(body);
    const n = (body.messages[1].content.match(/^\[\d+\]/gm) || []).length;
    const lines = [...Array(n)].map((_, i) => `${i + 1} | ${i === 2 ? 3 : i < 6 ? 1 : 0} | ${i === 2 ? 'Studies exciton transport in molecular crystals directly' : 'Touches the topic only'}`).join('\n');
    return json(req, { choices: [{ message: { content: lines } }], usage: { prompt_tokens: 4000, completion_tokens: 300 } });
  }
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
  const waitLike = () => page.waitForFunction(() => window.Paperscope.S.search && window.Paperscope.S.search.kind === 'like' && document.querySelectorAll('#results .paper').length > 0 && document.querySelector('#loading').hidden, { timeout: 15000 });

  await page.goto(BASE + '?nosw#search', { waitUntil: 'load' }); await sleep(300);
  await page.$eval('#lab-note-hide', b => b.click());
  await search('exciton migration in molecular crystals');
  // save three papers that share phrases
  const keys = await page.evaluate(() => window.Paperscope.S.search.ranked.filter(w => /exciton/i.test(w.title)).slice(0, 3).map(w => w.key));
  for (const k of keys) { await page.evaluate(k => document.querySelector(`[data-save="${CSS.escape(k)}"]`).click(), k); await sleep(80); }
  check('three papers saved', await page.evaluate(() => window.Paperscope.S.saved.size === 3));

  // ---------- the lean towards saved papers
  await search('exciton migration in molecular crystals');
  const lean = await page.$$eval('#results .why li', l => l.map(x => x.textContent).filter(t => /^Close to papers you saved/.test(t)));
  check('with 3 saved papers, close papers say they lean towards them', lean.length > 0 && /Close to papers you saved: [a-z]/.test(lean[0]), lean[0]);
  check('the lean is small (at most 0.06)', await page.evaluate(() => window.Paperscope.S.search.ranked.every(w => !w.rank.orbit || w.rank.orbit.b <= 0.06)));

  // ---------- Saved › Your orbit
  await page.evaluate(() => { location.hash = '#saved'; }); await sleep(300);
  const orbitTxt = await page.$eval('.orbit', e => e.innerText.replace(/\s+/g, ' '));
  check('Saved shows what the saved papers have in common', /Your orbit/.test(orbitTxt) && /What your saved papers have in common: [a-z]/.test(orbitTxt), orbitTxt.slice(0, 200));
  check('Saved and orbit: no WCAG A/AA violations', (await axe()).length === 0, (await axe()).join(' | '));
  oaCalls.length = 0;
  await page.$eval('#like-saved', b => b.click()); await waitLike();
  const like = await page.evaluate(() => { const S = window.Paperscope.S; const s = S.search; return { q: s.q, n: s.ranked.length, savedIn: s.ranked.filter(w => S.saved.has(w.key)).length, head: document.querySelector('#interp').innerText.replace(/\s+/g, ' '),
    why: [...document.querySelectorAll('#results .why li')].map(x => x.textContent), more: document.querySelector('#like-more').disabled }; });
  const sems = oaCalls.filter(c => c.sem); const rel = oaCalls.filter(c => /^related_to:/.test(c.f)); const cit = oaCalls.filter(c => /^cites:/.test(c.f)); const refs = oaCalls.filter(c => /^cited_by:/.test(c.f));
  check('“Find more like my saved papers” searches by each paper’s abstract and its citation links', sems.length === 3 && rel.length === 3 && cit.length === 3 && refs.length === 3 && sems.every(c => c.sem.length > 30) && cit.every(c => c.sort === 'publication_date:desc'), JSON.stringify({ s: sems.length, r: rel.length, c: cit.length, f: refs.length }));
  check('the results leave out papers already saved', like.n > 3 && like.savedIn === 0, JSON.stringify({ n: like.n, savedIn: like.savedIn }));
  check('the header says what they have in common and how papers were found', /Papers like 3 saved papers/.test(like.head) && /What they have in common: /.test(like.head) && /similar abstracts, OpenAlex’s related works, newer papers citing them and their references/.test(like.head), like.head.slice(0, 260));
  check('each paper says how it connects to the starting papers', like.why.some(x => /^(Similar abstract to|OpenAlex lists it as related to|Cites|Cited by) “/.test(x)) && like.why.some(x => /^Shares “/.test(x)), like.why.slice(0, 4).join(' | '));
  check('“Keep going” waits until you save something here', like.more === true);
  check('more-like results: no WCAG A/AA violations', (await axe()).length === 0, (await axe()).join(' | '));
  await page.screenshot({ path: path.join(OUT, 'lab-orbit.png') });

  // keep going: save one, then another round from it, without repeats
  const first = await page.evaluate(() => window.Paperscope.S.search.ranked[0].key);
  const shown1 = await page.evaluate(() => window.Paperscope.S.search.ranked.slice(0, window.Paperscope.S.search.shown).map(w => w.key));
  await page.evaluate(k => document.querySelector(`[data-save="${CSS.escape(k)}"]`).click(), first); await sleep(150);
  check('after saving one, “Keep going” offers to use it', await page.$eval('#like-more', b => !b.disabled && /Keep going with the 1 you saved here/.test(b.textContent)));
  await page.$eval('#like-more', b => b.click()); await waitLike();
  const r2 = await page.evaluate(() => { const s = window.Paperscope.S.search; return { round: s.round, seeds: s.seeds.length, keys: s.ranked.map(w => w.key), head: document.querySelector('#interp').innerText }; });
  check('round 2 starts from the saved papers plus the new one', r2.round === 2 && r2.seeds === 4 && /round 2/.test(r2.head));
  check('round 2 shows only papers not shown before', r2.keys.every(k => !shown1.includes(k)), `${r2.keys.filter(k => shown1.includes(k)).length} repeated`);
  await page.$eval('#trail-back', b => b.click()); await sleep(300);
  check('Back returns to the earlier list', await page.evaluate(() => window.Paperscope.S.search.kind !== 'like' || window.Paperscope.S.search.round === 1));

  // “More like this” on a result card
  await search('exciton migration in molecular crystals');
  oaCalls.length = 0;
  await page.$eval('#results .paper [data-like]', b => b.click()); await waitLike();
  check('“More like this” on a paper searches from that one paper', await page.evaluate(() => window.Paperscope.S.search.seeds.length === 1 && /^Papers like “/.test(window.Paperscope.S.search.q)) && oaCalls.filter(c => c.sem).length === 1);

  // the lean can be turned off
  await page.evaluate(() => { location.hash = '#saved'; }); await sleep(300);
  await page.$eval('#orbit-lean', i => i.click()); await sleep(100);
  await page.evaluate(() => { location.hash = '#search'; }); await sleep(200);
  await search('exciton migration in molecular crystals');
  check('with the lean off, no paper is moved towards saved papers', await page.evaluate(() => window.Paperscope.S.search.ranked.every(w => !w.rank.orbit)));

  // ---------- AI check with your own key (mocked OpenAI-compatible service)
  check('without a key, the AI check is offered but disabled', await page.$eval('#ai-check', b => b.disabled));
  await page.evaluate(() => { const S = window.Paperscope.S; Object.assign(S.settings, { llmProvider: 'openai', llmBase: 'https://llm.example/v1', llmModel: 'test-model', llmKey: 'k', llmConsent: true }); localStorage.setItem('paperscope-lab.settings', JSON.stringify(S.settings)); });
  // grade this search first, so the check is kept for the benchmark
  await page.$eval('#grade-toggle', b => b.click()); await sleep(150);
  const gk = await page.$$eval('#results .grade button[data-grade="3"]', l => l.slice(0, 2).map(b => b.dataset.key));
  for (const k of gk) await page.evaluate(k => document.querySelector(`.grade button[data-key="${CSS.escape(k)}"][data-grade="3"]`).click(), k);
  await page.$eval('#grade-done', b => b.click()); await sleep(150);
  await page.evaluate(() => window.Paperscope.S.search && (window.Paperscope.S.search.aiCheck = null));
  await page.evaluate(() => { const b = document.querySelector('#ai-check'); b.disabled = false; b.click(); });
  await page.waitForFunction(() => { const s = window.Paperscope.S.search; return s.aiCheck && !s.aiCheck.loading; }, { timeout: 8000 });
  await sleep(200);
  const ai = await page.evaluate(() => { const s = window.Paperscope.S.search; return { line: document.querySelector('#answer-holder').innerText.replace(/\s+/g, ' '), first: s.ranked[0].rank.ai, why: [...document.querySelectorAll('#results .paper:first-child .why li')].map(x => x.textContent), bench: (JSON.parse(localStorage.getItem('paperscope-lab.bench')) || []).some(e => e.ai && e.ai.order.length) }; });
  const sentUser = llmCalls[0] && llmCalls[0].messages[1].content || '';
  check('the AI check sends the search and the top papers’ titles and abstracts only', llmCalls.length === 1 && /^Search: exciton migration in molecular crystals/.test(sentUser) && (sentUser.match(/^\[\d+\]/gm) || []).length >= 10 && !/Research interests/.test(sentUser), sentUser.slice(0, 120));
  check('it summarises the grades and names the model', /AI checked the top \d+ papers \(test-model, 4000 in, 300 out tokens, billed to your account\): 1 directly address your search/.test(ai.line), ai.line.slice(0, 260));
  check('ordered by the AI check, the paper it rates highest comes first, with its reason', ai.first && ai.first.grade === 3 && ai.why.some(x => /^AI check: directly addresses the search \(Studies exciton transport/.test(x)), JSON.stringify(ai.why.slice(0, 2)));
  await page.$eval('#ai-order', b => b.click()); await sleep(150);
  check('the usual order can be restored', await page.evaluate(() => !window.Paperscope.S.search.aiCheck.order && /Order by the AI check/.test(document.querySelector('#ai-order').textContent)));
  check('on a graded search, the AI check is kept for Graded searches', ai.bench);
  await page.evaluate(() => { location.hash = '#profile'; }); await sleep(300);
  check('Graded searches compares the AI check with the new ranking', /AI check \(your own key\), over 1 search where you ran it: top 10 \d\.\d\d \(new ranking on the same searches: \d\.\d\d\)/.test(await page.$eval('#bench-box', e => e.innerText.replace(/\s+/g, ' '))));
  check('no page errors', errors.length === 0, errors.join(' | '));
  const failed = log.filter(x => !x).length;
  console.log(`\n${log.length - failed}/${log.length} orbit and AI-check checks passed`);
  await browser.close(); server.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
