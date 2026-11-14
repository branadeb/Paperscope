// Tests the in-app free OpenAlex key flow (request by email, activation, allowance display). OpenAlex is mocked.
// Run: node tools/build.mjs && node test/key.test.cjs
'use strict';
const path = require('path'); const fs = require('fs');
const VENDOR = '/home/claude/vendor/node_modules';
const puppeteer = require(path.join(VENDOR, 'puppeteer-core'));
const M = require('./mock-data.js');
const server = require('./static-server.cjs')(8771);
const log = []; const check = (n, ok, d = '') => { log.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-expose-headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Credits-Used' };
let activated = false; const posts = []; const urls = [];
const budget = key => key === 'PENDINGKEY' || key === 'OWNKEY' ? { 'x-ratelimit-limit': '10000', 'x-ratelimit-remaining': '9700', 'x-ratelimit-reset': '3600' } : { 'x-ratelimit-limit': '1000', 'x-ratelimit-remaining': '800', 'x-ratelimit-reset': '3600' };
const json = (req, obj, status = 200, extra = {}) => req.respond({ status, headers: { 'content-type': 'application/json', ...CORS, ...extra }, body: JSON.stringify(obj) });

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = req.url();
    if (url.startsWith('data:')) return req.continue();
    const u = new URL(url);
    if (u.hostname === 'localhost') return req.continue();
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS });
    const p = u.searchParams; const key = p.get('api_key') || '';
    if (u.hostname === 'api.openalex.org') {
      urls.push(decodeURIComponent(url));
      if (u.pathname === '/api-keys' && req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}'); posts.push({ body, idem: req.headers()['idempotency-key'] || '' });
        if (body.email === 'new@uni.edu') return json(req, { api_key: 'PENDINGKEY', status: 'pending_activation', email: body.email, daily_budget_usd_after_activation: 1.0, activation_link_expires: '2026-11-21T00:00:00Z', message: 'We emailed a link' }, 201);
        if (body.email === 'exists@uni.edu') return json(req, { code: 'account_exists', error: 'Conflict', message: 'This address already has an account.' }, 409);
        if (body.email === 'waiting@uni.edu') return json(req, { code: 'activation_pending', error: 'Conflict' }, 409);
        if (body.email === 'busy@uni.edu') return json(req, { error: 'Too many keys today' }, 429);
        return json(req, { code: 'placeholder', error: 'Bad Request', message: 'That looks like a placeholder address. Please use your real email.' }, 400);
      }
      if (key === 'PENDINGKEY' && !activated) return json(req, { error: 'key_not_activated', message: 'Click the link we emailed.' }, 403);
      if (key && key !== 'PENDINGKEY' && key !== 'OWNKEY') return json(req, { error: 'Invalid or missing API key' }, 401);
      if (/^\/works\/W/.test(u.pathname)) return json(req, { id: 'https://openalex.org/W2741809807' }, 200, budget(key));
      if (/FAIL429/.test(p.get('search') || '')) return json(req, { error: 'Rate limit' }, 429, { 'x-ratelimit-limit': '1000', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '3600' });
      if (p.get('group_by')) return json(req, { meta: { count: 1, cost_usd: 0.001 }, group_by: M.groupByPhysical }, 200, budget(key));
      if (p.get('search.semantic')) return json(req, { meta: { count: 7, cost_usd: 0.001 }, results: M.semWorks }, 200, budget(key));
      return json(req, { meta: { count: 18, cost_usd: 0.001 }, results: Number(p.get('page') || 1) === 1 ? M.kwWorks : [] }, 200, budget(key));
    }
    if (u.hostname === 'api.crossref.org') return json(req, { message: { items: M.crossref, 'total-results': 3 } });
    if (u.hostname === 'www.ebi.ac.uk') return json(req, { hitCount: 2, resultList: { result: M.epmc } });
    return req.abort();
  });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto('http://localhost:8771/?nosw#search', { waitUntil: 'load' });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const search = async q => { await page.$eval('#q', (e, v) => { e.value = v; }, q); await page.$eval('#search-form button', b => b.click()); await page.waitForFunction(() => document.querySelectorAll('#results .paper').length > 0 && document.querySelector('#loading').hidden, { timeout: 15000 }); };
  const axe = async () => { if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: path.join(VENDOR, 'axe-core/axe.min.js') }); return page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' ; ')}`)); };
  const status = () => page.$eval('#key-status', e => e.innerText.replace(/\s+/g, ' '));

  // ---------- without a key: what's left today, and a way to get a key
  await search('exciton migration in molecular crystals');
  const line = await page.$eval('#more', e => e.innerText.replace(/\s+/g, ' '));
  check('each search says how many are left today', /About 32 searches left today without a key/.test(line), line);
  check('and links to a free key', !!(await page.$('#more a[href="#key"]')));
  await page.$eval('#more a[href="#key"]', a => a.click()); await sleep(400);
  const atKey = await page.evaluate(() => ({ about: !document.querySelector('#view-about').hidden, top: Math.round(document.querySelector('#key-box').getBoundingClientRect().top) }));
  check('the link opens the key box', atKey.about && atKey.top >= 0 && atKey.top < 250, JSON.stringify(atKey));
  await page.waitForFunction(() => /Today: \$0\.080 of \$0\.10 left/.test(document.querySelector('#key-status').innerText), { timeout: 5000 }).catch(() => {});
  check('key box shows today’s no-key allowance', /Today: \$0\.080 of \$0\.10 left, about 32 searches/.test(await status()), await status());
  check('key box: no WCAG A/AA violations', (await axe()).length === 0, (await axe()).join(' | '));

  // ---------- errors
  const ask = async email => { await page.$eval('#key-email', (e, v) => { e.value = v; }, email); await page.$eval('#key-form button', b => b.click()); await sleep(400); return status(); };
  check('typo caught before anything is sent', /doesn’t look like an email/.test(await ask('ranadeb@')) && posts.length === 0);
  check('placeholder address: OpenAlex’s reason shown', /placeholder address/.test(await ask('you@example.com')));
  const ex = await ask('exists@uni.edu');
  check('existing account: told where to copy the key, paste box opened', /already has an OpenAlex account/.test(ex) && await page.$eval('.key-own', d => d.open), ex);
  await page.$eval('.key-own', d => { d.open = false; });
  check('already waiting: told to click the emailed link', /already waiting/.test(await ask('waiting@uni.edu')));
  check('too many keys today: says what to do', /as many keys/.test(await ask('busy@uni.edu')));

  // ---------- request, pending, activation
  const before = posts.length;
  const pending = await ask('new@uni.edu');
  const sent = posts[before];
  check('request sends only the email and the app name, with an idempotency key', sent && Object.keys(sent.body).sort().join(',') === 'agent,email' && /Paperscope/.test(sent.body.agent) && sent.idem.length > 8, JSON.stringify(sent));
  check('pending: tells you to check your email', /Check your email/.test(pending) && /new@uni\.edu/.test(pending) && await page.$eval('#key-form', f => f.hidden), pending);
  check('pending key is not used yet', await page.evaluate(() => window.Paperscope.S.settings.apiKey === '' && window.Paperscope.S.settings.pendingKey.key === 'PENDINGKEY'));
  check('pending state: no WCAG A/AA violations', (await axe()).length === 0);
  await page.$eval('#key-check', b => b.click()); await sleep(400);
  check('checking too early says not active yet', /Not active yet/.test(await status()));
  activated = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(600);
  await page.$eval('#key-check', b => b.click()).catch(() => {}); await sleep(500);
  const active = await status();
  check('after clicking the link, the key becomes active by itself', /Your free key is active/.test(active) && await page.evaluate(() => window.Paperscope.S.settings.apiKey === 'PENDINGKEY' && !window.Paperscope.S.settings.pendingKey), active);
  check('active key shows today’s $1 allowance', /Today: \$0\.97 of \$1\.00 left, about 388 searches/.test(active), active);
  check('active state: no WCAG A/AA violations', (await axe()).length === 0);
  await page.screenshot({ path: path.join(__dirname, 'out', 'key-active.png') });
  check('the email is no longer kept once the key is active', await page.evaluate(() => !JSON.stringify(localStorage).includes('new@uni.edu')));

  // ---------- searches now use the key
  urls.length = 0;
  await page.evaluate(() => { location.hash = '#search'; });
  await search('exciton migration in molecular crystals');
  const oaCalls = urls.filter(u => /api\.openalex\.org\/works\?/.test(u));
  check('searches now send the key', oaCalls.length > 0 && oaCalls.every(u => /api_key=PENDINGKEY/.test(u)), oaCalls[0]);
  check('with a key, the allowance line stays out of the way until it runs low', !(await page.$('#more .allowance')) && await page.evaluate(() => /About 388 searches left today\./.test(document.querySelector('#interp').textContent)));

  // ---------- remove, paste your own
  await page.evaluate(() => { location.hash = '#key'; }); await sleep(300);
  await page.$eval('#key-remove', b => b.click()); await sleep(500);
  check('key can be removed', /Without a key/.test(await status()) && !(await page.$eval('#key-form', f => f.hidden)));
  await page.$eval('.key-own', d => { d.open = true; });
  await page.$eval('#api-key', e => { e.value = 'OWNKEY'; e.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(600);
  check('a key you already have can be pasted', /Your free key is active/.test(await status()) && /about 388 searches/.test(await status()));

  // ---------- out of allowance
  await page.$eval('#key-remove', b => b.click()); await sleep(300);
  await page.evaluate(() => { location.hash = '#search'; });
  await page.$eval('#q', e => { e.value = 'FAIL429 exciton crystals'; }); await page.$eval('#search-form button', b => b.click());
  await page.waitForFunction(() => /incomplete/i.test(document.querySelector('#interp').innerText), { timeout: 15000 });
  const warn = await page.$eval('#interp .warn', e => e.innerText);
  check('allowance used up: says when it resets, in local time, and offers a key', /resets at \d{1,2}:\d{2}/i.test(warn) && !!(await page.$('#interp .warn a[href="#key"]')) && warn.split('OpenAlex refused').length === 2, warn);

  // ---------- a key request survives closing the app
  await page.evaluate(() => { location.hash = '#key'; });
  activated = false;
  await page.$eval('#key-email', e => { e.value = 'new@uni.edu'; }); await page.$eval('#key-form button', b => b.click()); await sleep(400);
  activated = true;
  await page.reload({ waitUntil: 'load' }); await sleep(800);
  check('reopening the app activates a pending key', await page.evaluate(() => window.Paperscope.S.settings.apiKey === 'PENDINGKEY'));
  check('no page errors', errors.length === 0, errors.join(' | '));
  const failed = log.filter(x => !x).length;
  console.log(`\n${log.length - failed}/${log.length} free-key checks passed`);
  await browser.close(); server.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
