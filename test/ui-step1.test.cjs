// Browser tests for step-1 features: related terms, citation trail, sorting, followed searches,
// ORCID import and answer mode. External services are mocked. Run: node test/ui-step1.test.cjs
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const VENDOR = '/home/claude/vendor/node_modules';
const puppeteer = require(path.join(VENDOR, 'puppeteer-core'));
const M = require('./mock-data.js');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'test', 'out');
fs.mkdirSync(OUT, { recursive: true });

const log = []; const calls = []; const posts = [];
const check = (name, ok, detail = '') => { log.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(path.join(ROOT, 'dist', 'index.html'))); }).listen(8766);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const json = (req, obj, status = 200) => req.respond({ status, headers: { 'content-type': 'application/json', ...CORS }, body: JSON.stringify(obj) });

function mockOpenAlex(req, u) {
  const p = u.searchParams; const f = p.get('filter') || '';
  const per = Number(p.get('per_page') || 25); const page = Number(p.get('page') || 1);
  const list = arr => json(req, { meta: { count: arr.length, cost_usd: p.get('search') || p.get('search.semantic') ? 0.001 : 0.0001 }, results: arr.slice((page - 1) * per, page * per) });
  if (u.pathname.startsWith('/authors/orcid:')) {
    if (u.pathname.endsWith('0000-0002-1825-0097')) return json(req, { id: 'https://openalex.org/A5000', display_name: 'Test Researcher', works_count: 3 });
    return json(req, { error: 'not found' }, 404);
  }
  if (/author\.id:A5000/.test(f)) return list(M.orcidWorks);
  if (/^cites:/.test(f)) return list(M.citingWorks);
  if (/^cited_by:/.test(f)) return list([M.kwWorks[1], M.kwWorks[4]]);
  if (/^related_to:/.test(f)) return list([M.kwWorks[2], M.kwWorks[14]]);
  if (p.get('group_by')) return json(req, { meta: { count: 1, cost_usd: 0.001 }, group_by: M.groupByPhysical });
  if (/from_publication_date:\d{4}-\d{2}-\d{2}/.test(f) && !/-01-01/.test(f)) return list([M.newWork]); // follow check (since a specific day)
  if (/from_publication_date:\d{4}-01-01/.test(f)) return list(M.recentWorks); // "newest first" recent fetch
  if (p.get('search.semantic')) return list(M.semWorks);
  if (p.get('search') && p.get('search').startsWith('"')) return list(M.relWorks);
  if (p.get('search')) return list(M.kwWorks);
  return json(req, { error: 'unknown' }, 400);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (req.url().startsWith('data:')) return req.continue();
    const u = new URL(req.url());
    if (u.hostname === 'localhost') return req.continue();
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS });
    calls.push(`${req.method()} ${u.hostname}${u.pathname}?${decodeURIComponent(u.search.slice(1).replace(/\+/g, ' '))}`);
    if (u.hostname === 'api.openalex.org') return mockOpenAlex(req, u);
    if (u.hostname === 'api.crossref.org') return json(req, { message: { items: [], 'total-results': 0 } });
    if (u.hostname === 'www.ebi.ac.uk') return json(req, { hitCount: 0, resultList: { result: [] } });
    if (u.hostname === 'api.anthropic.com') {
      posts.push({ url: req.url(), headers: req.headers(), body: req.postData() });
      return json(req, { content: [{ type: 'text', text: 'Exciton migration lengths reach about 200 nm along the stacking axis [1]. Ordered crystals support long-range transport [2]. Everything about this topic is completely settled forever. Packing also matters [1, 9].' }], usage: { input_tokens: 1200, output_tokens: 80 } });
    }
    if (u.hostname === 'llm.example.test') {
      posts.push({ url: req.url(), headers: req.headers(), body: req.postData() });
      return json(req, { choices: [{ message: { content: 'Long-range transport is reported in ordered crystals [2].' } }], usage: { prompt_tokens: 900, completion_tokens: 20 } });
    }
    calls.push('BLOCKED ' + req.url());
    return req.abort();
  });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto('http://localhost:8766/#search', { waitUntil: 'load' });
  const tap = sel => page.$eval(sel, b => b.click());
  const waitResults = () => page.waitForFunction(() => document.querySelectorAll('#results .paper').length > 0 && document.querySelector('#loading').hidden, { timeout: 20000 });
  const search = async q => { await page.$eval('#q', (el, v) => { el.value = v; }, q); await tap('#search-form button'); await waitResults(); };

  // ---------- related terms
  await search('exciton migration in molecular crystals');
  const chips = await page.$$eval('[data-related-add]', els => els.map(e => e.dataset.relatedAdd));
  check('related terms offered from the results', chips.includes('organic semiconductors') && chips.includes('triplet excitons'), chips.join(', '));
  calls.length = 0;
  await tap('[data-related-add="organic semiconductors"]');
  await page.waitForFunction(() => window.Paperscope.S.search.pool.has('doi:10.5555/ps.' + window.__relDoi) || [...window.Paperscope.S.search.pool.values()].some(w => /Charge and energy flow/.test(w.title)), { timeout: 10000 });
  check('adding a related term makes one extra OpenAlex call only', calls.length === 1 && /search="organic semiconductors"/.test(calls[0]), calls.join(' | '));
  check('active related term shown and removable', !!(await page.$('[data-related-rm="organic semiconductors"]')));
  const relReason = await page.evaluate(() => { const S = window.Paperscope.S; const w = [...S.search.pool.values()].find(x => /Charge and energy flow/.test(x.title)); return window.Core.explain(w, { analysis: S.search.analysis, profile: null, hasProfile: false }).reasons.map(r => r.text).join(' '); });
  check('explanation mentions the related term', /related term “organic semiconductors”/.test(relReason), relReason);
  await page.screenshot({ path: `${OUT}/s1-01-related.png` });

  // ---------- sorting
  calls.length = 0;
  await page.select('#sort', 'newest');
  await page.waitForFunction(() => [...window.Paperscope.S.search.pool.values()].some(w => /interferometric/.test(w.title)), { timeout: 10000 });
  check('newest first fetches recent papers', calls.some(c => /from_publication_date:\d{4}-01-01/.test(c)), calls.join(' | '));
  const years = await page.$$eval('#results .paper .byline', els => els.slice(0, 6).map(e => Number((e.textContent.match(/\((\d{4})\)/) || [])[1])));
  check('newest first orders the top results by date', years.every((y, i) => i === 0 || y <= years[i - 1]), years.join(','));
  await page.select('#sort', 'cited');
  const cites = await page.$$eval('#results .paper', els => els.slice(0, 5).map(e => { const b = [...e.querySelectorAll('.badge')].find(x => /Cited by/.test(x.textContent)); return b ? Number(b.textContent.replace(/\D/g, '')) : 0; }));
  check('most cited orders by citations', cites.every((c, i) => i === 0 || c <= cites[i - 1]), cites.join(','));
  await page.select('#sort', 'best');

  // ---------- citation trail
  const firstQ = await page.$eval('#results .paper h3', e => e.textContent);
  calls.length = 0;
  await tap('#results .paper [data-trail="cites"]');
  await page.waitForFunction(() => window.Paperscope.S.search.kind === 'trail' && document.querySelectorAll('#results .paper').length > 0, { timeout: 10000 });
  check('“Cited by” runs a citation lookup sorted by citations', calls.some(c => /filter=cites:W9\d+/.test(c) && /sort=cited_by_count:desc/.test(c)), calls.join(' | '));
  const trailTitles = await page.$$eval('#results .paper h3', els => els.map(e => e.textContent));
  check('citing papers shown', trailTitles.length === 2 && trailTitles.every(t => /Citing paper/.test(t)), trailTitles.join(' | '));
  check('trail explanation says it cites the starting paper', /Cites the paper you started from/.test(await page.$eval('#results .paper .why', e => e.textContent)));
  await page.screenshot({ path: `${OUT}/s1-02-trail.png` });
  await tap('[data-trail-switch="refs"]');
  await page.waitForFunction(() => window.Paperscope.S.search.trail && window.Paperscope.S.search.trail.kind === 'refs' && document.querySelectorAll('#results .paper').length > 0, { timeout: 10000 });
  check('switching to references works', calls.some(c => /filter=cited_by:W9/.test(c)));
  await tap('#trail-back');
  const backQ = await page.$eval('#results .paper h3', e => e.textContent);
  check('“Back” restores the earlier search', backQ === firstQ, backQ);

  // ---------- follow + check for new
  await tap('#follow-toggle');
  check('following stores the search on the device', await page.evaluate(() => JSON.parse(localStorage.getItem('paperscope.follows')).length === 1));
  await page.goto('http://localhost:8766/#saved');
  await page.waitForSelector('[data-check-follow="0"]');
  await page.screenshot({ path: `${OUT}/s1-03-follows.png` });
  calls.length = 0;
  await tap('[data-check-follow="0"]');
  await waitResults();
  check('checking for new papers filters by the last-checked date', calls.some(c => /from_publication_date:\d{4}-\d{2}-\d{2}/.test(c) && !/-01-01/.test(c)), calls.filter(c => /openalex/.test(c)).join(' | '));
  check('new papers are marked New', (await page.$$eval('.badge.new', e => e.length)) >= 1);
  check('since-banner shown', /Papers published since/.test(await page.$eval('#interp', e => e.textContent)));

  // ---------- ORCID import
  await page.goto('http://localhost:8766/#profile');
  await page.type('#orcid', '0000-0002-1825-0098');
  await tap('#orcid-form button');
  check('invalid ORCID rejected locally', /not a valid ORCID/.test(await page.$eval('#orcid-status', e => e.textContent)));
  await page.$eval('#orcid', e => { e.value = 'https://orcid.org/0000-0002-1825-0097'; });
  calls.length = 0;
  await tap('#orcid-form button');
  await page.waitForFunction(() => /Built your profile|Added terms/.test(document.querySelector('#orcid-status').textContent), { timeout: 10000 });
  const prof = await page.evaluate(() => window.Paperscope.S.profile);
  const allTerms = [...prof.interests, ...prof.methods, ...prof.areas].map(t => t.text);
  check('ORCID profile built from publications', allTerms.includes('ion transport') && allTerms.includes('spectral diffusion') && allTerms.some(t => /physical and theoretical chemistry/.test(t)), allTerms.join(' | '));
  check('ORCID lookup sent only the iD and author filter', calls.length === 2 && /authors\/orcid:0000-0002-1825-0097/.test(calls[0]) && /author\.id:A5000/.test(calls[1]), calls.join(' | '));
  check('acronyms learned from abstracts', prof.glossary && prof.glossary['2DIR'] === 'two-dimensional infrared spectroscopy', JSON.stringify(prof.glossary));
  await page.screenshot({ path: `${OUT}/s1-04-orcid.png`, fullPage: true });

  // ---------- answer mode (Anthropic, mocked)
  await page.goto('http://localhost:8766/#search');
  await search('exciton migration in molecular crystals');
  check('answer button disabled until set up', await page.$eval('#answer-run', b => b.disabled));
  await page.goto('http://localhost:8766/#about');
  await page.type('#llm-key', 'sk-test-key'); await page.$eval('#llm-key', e => e.dispatchEvent(new Event('change', { bubbles: true })));
  await tap('#llm-consent');
  await page.goto('http://localhost:8766/#search');
  await search('exciton migration in molecular crystals');
  check('answer button enabled after key and consent', !(await page.$eval('#answer-run', b => b.disabled)));
  await tap('#answer-run');
  await page.waitForSelector('.answer-text', { timeout: 10000 });
  const post = posts[posts.length - 1];
  const body = JSON.parse(post.body);
  check('request goes to Anthropic with the browser-access header and your key', post.headers['anthropic-dangerous-direct-browser-access'] === 'true' && post.headers['x-api-key'] === 'sk-test-key' && body.model === 'claude-haiku-5-5');
  check('request contains the question and numbered abstracts only', /Question: exciton migration in molecular crystals/.test(body.messages[0].content) && /\[1\] /.test(body.messages[0].content) && !/Research interests:|nanoconfined polymer membranes/.test(post.body));
  const ans = await page.$eval('.answer', e => ({ links: e.querySelectorAll('.answer-text a').length, uncited: e.querySelectorAll('.uncited').length, bad: e.querySelectorAll('.bad-ref').length, text: e.textContent }));
  check('citations link to the listed sources', ans.links === 3, String(ans.links));
  check('uncited sentence flagged', ans.uncited === 1);
  check('citation to a paper that was not supplied flagged', ans.bad === 1 && /not supplied/.test(ans.text));
  check('token usage shown', /1200 in, 80 out/.test(ans.text));
  await page.evaluate(() => document.querySelector('.answer').scrollIntoView());
  await page.screenshot({ path: `${OUT}/s1-05-answer.png` });

  // ---------- answer mode (OpenAI-compatible, mocked)
  await page.goto('http://localhost:8766/#about');
  await page.select('#llm-provider', 'openai');
  await page.$eval('#llm-base', e => { e.value = 'https://llm.example.test/v1'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.$eval('#llm-model', e => { e.value = 'test-model'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.goto('http://localhost:8766/#search');
  await search('exciton migration in molecular crystals');
  await tap('#answer-run');
  await page.waitForSelector('.answer-text', { timeout: 10000 });
  const p2 = posts[posts.length - 1];
  check('OpenAI-compatible service called with bearer key and model', /llm\.example\.test\/v1\/chat\/completions/.test(p2.url) && p2.headers.authorization === 'Bearer sk-test-key' && JSON.parse(p2.body).model === 'test-model');

  // ---------- accessibility + errors
  await page.addScriptTag({ path: path.join(VENDOR, 'axe-core/axe.min.js') });
  const axe = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map(v => `${v.id} (${v.nodes.length}) ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' ; ')}`));
  check('no WCAG A/AA violations (axe-core)', axe.length === 0, axe.join(' | '));
  check('no uncaught page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
  check('no unexpected external requests', !calls.some(c => c.startsWith('BLOCKED')), calls.filter(c => c.startsWith('BLOCKED')).join(' '));

  const failed = log.filter(l => !l.ok).length;
  console.log(`\n${log.length - failed}/${log.length} step-1 checks passed`);
  fs.writeFileSync(`${OUT}/ui-step1-results.json`, JSON.stringify(log, null, 1));
  await browser.close(); server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
