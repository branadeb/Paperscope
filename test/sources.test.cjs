// Tests how searches handle a source that does not answer: Crossref and Europe PMC are retried once, quietly; if they
// still fail, a calm note with "Try again" appears; only a failure of the main search (OpenAlex) is a red warning.
// Run: node tools/build.mjs && node tools/build.mjs lab/src dist/lab && node test/sources.test.cjs [lab/ | ""]
'use strict';
const path = require('path');
const VENDOR = '/home/claude/vendor/node_modules';
const puppeteer = require(path.join(VENDOR, 'puppeteer-core'));
const M = require('./mock-data.js');
const server = require('./static-server.cjs')(8781);
const WHICH = process.argv[2] === undefined ? '' : process.argv[2];
const BASE = `http://localhost:8781/${WHICH}`;
const log = []; const check = (n, ok, d = '') => { log.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const json = (req, obj, status = 200) => req.respond({ status, headers: { 'content-type': 'application/json', ...CORS }, body: JSON.stringify(obj) });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let epmcFailures = 0; let epmcCalls = 0; let kwFails = false;

function route(req) {
  const url = req.url(); if (url.startsWith('data:') || url.startsWith('blob:')) return req.continue();
  const u = new URL(url); if (u.hostname === 'localhost') return req.continue();
  if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS });
  const p = u.searchParams;
  if (u.hostname === 'api.openalex.org') {
    if (u.pathname.startsWith('/works/W')) return json(req, { id: 'x' });
    if (p.get('group_by')) return json(req, { meta: { count: 1, cost_usd: 0.001 }, group_by: M.groupByPhysical });
    if (p.get('search.semantic')) return json(req, { meta: { count: 7, cost_usd: 0.001 }, results: M.semWorks });
    if (kwFails) return req.abort('failed');
    return json(req, { meta: { count: 18, cost_usd: 0.001 }, results: Number(p.get('page') || 1) === 1 ? M.kwWorks : [] });
  }
  if (u.hostname === 'api.crossref.org') return json(req, { message: { items: M.crossref, 'total-results': 3 } });
  if (u.hostname === 'www.ebi.ac.uk') { epmcCalls++; if (epmcFailures > 0) { epmcFailures--; return req.respond({ status: 200, headers: { 'content-type': 'application/json' }, body: '{}' }); } return json(req, { hitCount: 2, resultList: { result: M.epmc } }); } // no CORS header = the browser refuses it, as on 14 Nov 2026
  return req.abort();
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await (await browser.createBrowserContext()).newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setRequestInterception(true); page.on('request', route);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const search = async q => { await page.$eval('#q', (e, v) => { e.value = v; }, q); await page.$eval('#search-form button[type="submit"]', b => b.click()); await page.waitForFunction(() => document.querySelectorAll('#results .paper, #results .panel').length > 0, { timeout: 10000 }); await sleep(300); };
  const interp = () => page.$eval('#interp', e => e.textContent.replace(/\s+/g, ' '));
  const epmcPapers = () => page.evaluate(() => [...window.Paperscope.S.search.pool.values()].filter(w => (w.sources || []).includes('Europe PMC')).length);
  await page.goto(BASE + '?nosw#search', { waitUntil: 'load' }); await sleep(300);

  // Europe PMC fails once, then answers
  epmcFailures = 2; epmcCalls = 0; // the app's own quick retry also fails; the later quiet retry works
  await search('exciton migration in molecular crystals');
  let t = await interp();
  check('while Europe PMC is retried, the sources list says so, without a warning', /Europe PMC: no answer yet, trying again/.test(t) && !/incomplete/i.test(t) && !/Load failed|Failed to fetch/.test(t), t.slice(0, 300));
  await page.waitForFunction(() => { const s = window.Paperscope.S.search.status.epmc; return s && s.ok; }, { timeout: 12000 }).catch(() => {});
  await sleep(300); t = await interp();
  check('a few seconds later the retry works and its papers are added, with no message left', /Europe PMC: \d+ fetched/.test(t) && !/did not answer/.test(t) && (await epmcPapers()) > 0, `${epmcCalls} calls; ${t.slice(0, 200)}`);

  // Europe PMC keeps failing
  epmcFailures = 10;
  await search('singlet fission in molecular crystals');
  await page.waitForFunction(() => /did not answer this time/.test(document.querySelector('#interp').innerText), { timeout: 15000 }).catch(() => {});
  t = await interp();
  check('if it still fails, a calm note says the main search worked and offers to try again', /Europe PMC did not answer this time, so a few papers found only there may be missing\. The main search \(OpenAlex\) worked\./.test(t) && !!(await page.$('[data-retry="epmc"]')) && !(await page.$('#interp .panel.warn')), t.slice(0, 400));
  check('no raw browser error words are shown', !/Load failed|Failed to fetch|TypeError/.test(t));
  epmcFailures = 0;
  await page.$eval('[data-retry="epmc"]', b => b.click());
  await page.waitForFunction(() => { const s = window.Paperscope.S.search.status.epmc; return s && s.ok; }, { timeout: 8000 }).catch(() => {});
  await sleep(200); t = await interp();
  check('“Try Europe PMC again” fetches it and the note goes', /Europe PMC: \d+ fetched/.test(t) && !/did not answer/.test(t), t.slice(0, 200));

  // the main search fails: that is a real warning
  kwFails = true;
  await search('ion transport in membranes');
  t = await interp();
  check('when OpenAlex’s main search fails, the red warning says the results are incomplete', /These results are incomplete\./.test(t) && /OpenAlex keyword search did not answer/.test(t) && !!(await page.$('#interp .panel.warn')), t.slice(0, 300));
  kwFails = false;
  check('no page errors', errors.length === 0, errors.join(' | '));
  const failed = log.filter(x => !x).length;
  console.log(`\n${log.length - failed}/${log.length} source-failure checks passed (${WHICH ? 'Lab' : 'main app'})`);
  await browser.close(); server.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
