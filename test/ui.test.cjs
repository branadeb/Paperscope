// End-to-end UI test: real page in headless Chrome, external APIs mocked with synthetic data,
// CDN and model files served from local copies. Run: node test/ui.test.cjs
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
const MODEL_DIR = '/home/claude/testmodel';

const log = []; const calls = [];
const check = (name, ok, detail = '') => { log.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };

const server = require('./static-server.cjs')(8765);

const ctype = p => p.endsWith('.wasm') ? 'application/wasm' : /\.m?js$/.test(p) ? 'application/javascript' : p.endsWith('.json') ? 'application/json' : 'application/octet-stream';
function serveFile(req, file) {
  if (!fs.existsSync(file)) return req.respond({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'not found' });
  req.respond({ status: 200, headers: { 'content-type': ctype(file), 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
}
const json = (req, obj, status = 200) => req.respond({ status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify(obj) });

function mockOpenAlex(req, u) {
  const p = u.searchParams;
  const per = Number(p.get('per_page') || 25); const page = Number(p.get('page') || 1);
  if (p.get('group_by')) return json(req, { meta: { count: 1, cost_usd: 0.001 }, group_by: /coherence/i.test(p.get('search')) ? M.groupByCoherence : M.groupByPhysical });
  if (p.get('search.semantic')) { const r = M.semWorks.slice((page - 1) * per, page * per); return json(req, { meta: { count: M.semWorks.length, cost_usd: 0.001 }, results: r }); }
  if (p.get('search.title')) { const t = p.get('search.title').toLowerCase(); return json(req, { meta: { count: 0, cost_usd: 0.001 }, results: M.kwWorks.filter(w => w.display_name.toLowerCase() === t) }); }
  if (p.get('search')) {
    if (/FAIL429/.test(p.get('search'))) return json(req, { error: 'Rate limit' }, 429);
    let list = M.kwWorks;
    if (/type:review/.test(p.get('filter') || '')) list = list.filter(w => w.type === 'review');
    return json(req, { meta: { count: list.length, cost_usd: 0.001 }, results: list.slice((page - 1) * per, page * per) });
  }
  return json(req, { error: 'unknown' }, 400);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (req.url().startsWith('data:')) return req.continue();
    const u = new URL(req.url());
    if (u.hostname === 'localhost') return req.continue();
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    calls.push(`${u.hostname}${u.pathname}?${u.search.slice(1, 220)}`);
    if (u.hostname === 'api.openalex.org') return mockOpenAlex(req, u);
    if (u.hostname === 'api.crossref.org') return json(req, { message: { items: Number(u.searchParams.get('offset')) ? [] : M.crossref, 'total-results': M.crossref.length } });
    if (u.hostname === 'www.ebi.ac.uk') return json(req, u.searchParams.get('cursorMark') === '*' ? { hitCount: 2, nextCursorMark: 'NEXT', resultList: { result: M.epmc } } : { hitCount: 2, nextCursorMark: 'NEXT', resultList: { result: [] } });
    if (u.hostname === 'cdn.jsdelivr.net') {
      const m = u.pathname.match(/^\/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.*)$/);
      if (m) return serveFile(req, path.join(VENDOR, m[1], m[2]));
    }
    if (u.hostname === 'huggingface.co') {
      const m = u.pathname.match(/^\/(.+?)\/resolve\/[^/]+\/(.*)$/);
      if (m) return serveFile(req, path.join(MODEL_DIR, m[1], m[2]));
    }
    calls.push('BLOCKED ' + req.url());
    return req.abort();
  });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto('http://localhost:8765/#search', { waitUntil: 'load' });
  await page.screenshot({ path: `${OUT}/01-start-mobile.png` });

  const tap = sel => page.$eval(sel, b => b.click());
  const waitResults = async () => { await page.waitForFunction(() => document.querySelectorAll('#results .paper').length > 0 && document.querySelector('#loading').hidden, { timeout: 20000 }); };
  const search = async q => { await page.$eval('#q', (el, v) => { el.value = v; }, q); await tap('#search-form button'); };

  // 1. search without profile
  calls.length = 0;
  await search('exciton migration in molecular crystals');
  await waitResults();
  const n1 = await page.$$eval('#results .paper', els => els.length);
  check('first page shows 10 results', n1 === 10, `got ${n1}`);
  check('no field check for a 5-word query', !calls.some(c => c.includes('group_by')));
  check('keyword + semantic + Crossref + Europe PMC called', ['search=', 'search.semantic=', 'api.crossref.org', 'www.ebi.ac.uk'].every(s => calls.some(c => c.includes(s))));
  const kwq = await page.$eval('#interp code', el => el.textContent);
  check('synonym expansion applied', /migration OR diffusion OR transport/.test(kwq), kwq);
  // grounding: every quoted evidence must be a verbatim substring of that paper's abstract
  const quotes = await page.$$eval('#results .paper', els => els.map(li => ({ key: li.dataset.key, q: (li.querySelector('blockquote') || {}).innerText || '', reasons: [...li.querySelectorAll('.why li')].map(x => x.textContent) })));
  const abstracts = await page.evaluate(() => Object.fromEntries([...window.Paperscope.S.search.pool.values()].map(w => [w.key, { abstract: w.abstract, title: w.title }])));
  let grounded = 0, quoted = 0, termOk = true;
  for (const r of quotes) {
    if (r.q) {
      quoted++;
      const body = r.q.replace(/^“/, '').replace(/From the abstract.*$/s, '').trim().replace(/”$/, '').replace(/…$/, '');
      if ((abstracts[r.key].abstract || '').includes(body)) grounded++; else console.log('  ungrounded:', body.slice(0, 80));
    }
    for (const reason of r.reasons) {
      const m = reason.match(/^(Title|Abstract) mentions (.*)\.$/);
      if (m) {
        const hay = (m[1] === 'Title' ? abstracts[r.key].title : abstracts[r.key].abstract || '').toLowerCase();
        const terms = m[2].split(/, | and /).map(s => s.trim());
        for (const t of terms) { const root = t.toLowerCase().replace(/(s|es|ing|ed)$/, ''); if (!hay.includes(root)) { termOk = false; console.log('  term not found:', t, 'in', m[1]); } }
      }
    }
  }
  check('every evidence quote is verbatim from the abstract', quoted > 0 && grounded === quoted, `${grounded}/${quoted}`);
  check('every "mentions" term appears in the cited field', termOk);
  check('retracted paper is flagged and not in top 5', await page.evaluate(() => {
    const r = window.Paperscope.S.search.ranked; const i = r.findIndex(w => w.retracted); return i >= 5;
  }));
  const dedup = await page.evaluate(() => { const s = window.Paperscope.S.search; const w = s.pool.get('doi:10.5555/ps.1'); return { size: s.pool.size, sources: w.sources }; });
  check('duplicates merged across sources', dedup.sources.length === 2 && dedup.size === 18 + 3 + 2 + 1, JSON.stringify(dedup));
  const types = await page.evaluate(() => { const p = window.Paperscope.S.search.pool; return { ps3: p.get('doi:10.5555/ps.3').typeInfo, ps2: p.get('doi:10.5555/ps.2').typeInfo, ps6: p.get('doi:10.5555/ps.6').typeInfo, ps14: p.get('doi:10.5555/ps.14').typeInfo, ps10: p.get('doi:10.5555/ps.10').typeInfo }; });
  check('Europe PMC review label upgrades an OpenAlex "article"', types.ps3.cat === 'review' && types.ps3.conf === 'labelled');
  check('review inferred from wording is marked uncertain', types.ps2.cat === 'review' && types.ps2.conf === 'inferred' && types.ps2.label === 'Review?');
  check('perspective inferred from title', types.ps6.cat === 'perspective' && types.ps6.conf === 'inferred');
  check('OpenAlex review label used', types.ps14.cat === 'review' && types.ps14.conf === 'labelled');
  check('preprint label used', types.ps10.cat === 'preprint');
  await page.screenshot({ path: `${OUT}/02-results-no-profile.png`, fullPage: false });
  await page.evaluate(() => document.querySelector('#results').scrollIntoView());
  await page.screenshot({ path: `${OUT}/03-results-cards.png` });

  // map + theme filter
  const nodes = await page.$$eval('.map-svg .node', els => els.length);
  check('theme map drawn', nodes >= 3, `${nodes} themes`);
  await page.evaluate(() => document.querySelector('.map').scrollIntoView());
  await page.screenshot({ path: `${OUT}/04-map-no-profile.png` });
  await tap('.theme-list button');
  const themeOk = await page.evaluate(() => { const S = window.Paperscope.S; const t = S.search.themes.themes.find(x => x.id === S.filters.theme); const shown = [...document.querySelectorAll('#results .paper')].map(li => li.dataset.key); return shown.length > 0 && shown.every(k => t.keys.includes(k)); });
  check('tapping a theme filters results to it', themeOk);
  await page.$eval('[data-clear="theme"]', b => b.click());

  // filters sheet
  await page.$eval('#open-filters', b => b.click());
  await page.waitForSelector('.sheet');
  await page.screenshot({ path: `${OUT}/05-filters.png` });
  await page.$$eval('.sheet input[name="cat"]', els => els.forEach(e => { e.checked = e.value === 'review'; }));
  await tap('#apply-filters');
  const revOnly = await page.$$eval('#results .paper .badge:first-child', els => els.map(e => e.textContent));
  check('review filter shows only reviews', revOnly.length > 0 && revOnly.every(t => /^Review/.test(t)), revOnly.join(', '));
  check('server-side filter offered when few match', !!(await page.$('#server-filter')));
  await page.$eval('#server-filter', b => b.click());
  await waitResults();
  check('server-side review filter sent to OpenAlex', calls.some(c => /filter=[^&]*type%3Areview/.test(c)));
  await page.$eval('#open-filters', b => b.click()); await page.waitForSelector('.sheet'); await tap('#reset-filters');

  // back to the unfiltered search, load more
  await search('exciton migration in molecular crystals'); await waitResults();
  await page.$eval('#show-more', b => b.click());
  check('show more adds 10', (await page.$$eval('#results .paper', els => els.length)) === 20);
  // save
  const firstKey = await page.$eval('#results .paper', li => li.dataset.key);
  await tap(`#results .paper [data-save]`);
  check('save marks paper', (await page.$eval('#results .paper [data-save]', b => b.getAttribute('aria-pressed'))) === 'true');
  check('saved count updates', (await page.$eval('#saved-count', e => e.textContent)) === '(1)');
  await page.goto('http://localhost:8765/#saved'); // reload: saved items must persist
  await page.waitForSelector('.saved-list li');
  check('saved paper persists across reload', (await page.$$eval('.saved-list li', els => els.length)) === 1);
  const bib = await page.evaluate(() => window.Core.toBibTeX([...window.Paperscope.S.saved.values()]));
  check('BibTeX export has DOI', /doi = \{10\.5555\//.test(bib));
  await page.screenshot({ path: `${OUT}/06-saved.png` });

  // 2. profile from PDF
  await page.goto('http://localhost:8765/#profile');
  const input = await page.$('#cv-file');
  await input.uploadFile(path.join(ROOT, 'test/fixtures/cv_sample.pdf'));
  await page.waitForFunction(() => /Found \d+ terms/.test(document.querySelector('#parse-status').textContent), { timeout: 20000 });
  const prof = await page.evaluate(() => window.Paperscope.S.profile);
  check('PDF CV parsed in browser', prof.interests.some(t => t.text === 'exciton migration') && prof.methods.length >= 5, `${prof.interests.length} interests, ${prof.methods.length} methods`);
  check('acronyms learned from CV', prof.glossary.TA === 'transient absorption' && !!prof.glossary.HEOM, JSON.stringify(prof.glossary));
  await page.screenshot({ path: `${OUT}/07-profile.png`, fullPage: true });
  await input.uploadFile(path.join(ROOT, 'test/fixtures/cv_sample.docx'));
  await page.waitForFunction(() => /Found \d+ terms/.test(document.querySelector('#parse-status').textContent) && window.Paperscope.S.profile.source.endsWith('.docx'), { timeout: 20000 });
  check('Word CV parsed in browser', (await page.evaluate(() => window.Paperscope.S.profile.interests.length)) >= 5);
  // edit profile: remove a term, add a term
  const before = await page.evaluate(() => window.Paperscope.S.profile.interests.length);
  await tap('[data-rmterm="interests:0"]');
  await page.type('#add-interests', 'singlet fission'); await tap('[data-addterm="interests"] button');
  const after = await page.evaluate(() => window.Paperscope.S.profile.interests.map(t => t.text));
  check('profile terms can be removed and added', after.length === before && after.includes('singlet fission'));
  check('profile is not stored unless asked', await page.evaluate(() => localStorage.getItem('paperscope.profile') === null));

  // 3. modes with profile
  await page.goto('http://localhost:8765/#search');
  await search('exciton migration in molecular crystals'); await waitResults();
  const topAll = await page.$$eval('#results .paper h3', els => els.slice(0, 5).map(e => e.textContent));
  await tap('[data-mode="close"]');
  const topClose = await page.$$eval('#results .paper', els => els.slice(0, 5).map(e => ({ t: e.querySelector('h3').textContent, c: e.className })));
  await page.screenshot({ path: `${OUT}/08-close-mode.png` });
  await tap('[data-mode="adjacent"]');
  const topAdj = await page.$$eval('#results .paper', els => els.slice(0, 5).map(e => ({ t: e.querySelector('h3').textContent, c: e.className })));
  await page.screenshot({ path: `${OUT}/09-adjacent-mode.png` });
  check('close mode puts profile-overlapping papers first', topClose.filter(x => / close/.test(x.c)).length >= 3, topClose.map(x => x.t.slice(0, 40)).join(' | '));
  check('adjacent mode changes the top results', topAdj.map(x => x.t).join() !== topClose.map(x => x.t).join(), topAdj.map(x => x.t.slice(0, 40)).join(' | '));
  await page.evaluate(() => document.querySelector('.map').scrollIntoView());
  await page.screenshot({ path: `${OUT}/10-map-profile.png` });
  await tap('[data-mode="all"]');

  // 4. ambiguous field: picked from profile
  calls.length = 0;
  await search('coherence'); await waitResults();
  const chip = await page.$eval('#interp', e => e.textContent);
  check('ambiguous term resolved from profile', /Limited to Physical sciences and engineering/.test(chip) && /picked from your profile/.test(chip));
  check('field filter sent to OpenAlex', calls.some(c => /filter=primary_topic\.domain\.id%3A3/.test(c)));
  // 5. same without profile -> question
  await page.evaluate(() => { window.Paperscope.S.profile = null; });
  await search('coherence');
  await page.waitForSelector('.panel.ask', { timeout: 10000 });
  const opts = await page.$$eval('.panel.ask [data-field]', els => els.map(e => e.textContent.trim()));
  check('asks which field when no profile', opts.length >= 3, opts.join(' / '));
  await page.screenshot({ path: `${OUT}/11-ask-field.png` });
  await tap('.panel.ask [data-field="3"]'); await waitResults();
  check('answering the field question runs the search', (await page.$$eval('#results .paper', e => e.length)) > 0);

  // 6. acronym question
  await search('MD simulations of polymer electrolytes');
  await page.waitForSelector('.panel.ask', { timeout: 10000 });
  await page.screenshot({ path: `${OUT}/12-ask-acronym.png` });
  await tap('.panel.ask [data-long="molecular dynamics"]'); await waitResults();
  check('acronym meaning used in query', /MD OR "molecular dynamics"/.test(await page.$eval('#interp code', e => e.textContent)));

  // 7. failure handling
  await search('FAIL429 exciton crystals'); await waitResults();
  const warnTxt = await page.$eval('#interp', e => e.textContent);
  check('incomplete-results warning when OpenAlex refuses', /results are incomplete/i.test(warnTxt) && /free daily allowance/.test(warnTxt));
  await page.screenshot({ path: `${OUT}/13-incomplete.png` });

  // 8. compare with Scholar
  await search('exciton migration in molecular crystals'); await waitResults();
  await page.evaluate(() => { document.querySelector('.compare').open = true; });
  await page.$eval('#cmp-text', e => { e.value = '[PDF] Exciton diffusion in organic semiconductors: a review\nA paper that this app never retrieved about something'; });
  await tap('#cmp-run');
  const cmp = await page.$eval('.compare', e => e.textContent);
  check('Scholar comparison matches pasted titles', /1 of 2/.test(cmp));
  await tap('#cmp-check');
  await page.waitForFunction(() => /Not found in OpenAlex/.test(document.querySelector('.compare').textContent), { timeout: 10000 });
  check('missing titles checked in OpenAlex', true);

  // 9. on-device model
  await page.goto('http://localhost:8765/#profile');
  await tap('#ai-on');
  const t0 = Date.now();
  try {
    await page.waitForFunction(() => window.Paperscope.S.ai.status === 'ready' || window.Paperscope.S.ai.status === 'error', { timeout: 180000 });
  } catch (e) { /* reported below */ }
  const ai = await page.evaluate(() => ({ status: window.Paperscope.S.ai.status, error: window.Paperscope.S.ai.error }));
  check('on-device model loads', ai.status === 'ready', `${ai.status} ${ai.error || ''} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (ai.status === 'ready') {
    await page.goto('http://localhost:8765/#search');
    await search('exciton migration in molecular crystals'); await waitResults();
    await page.waitForFunction(() => window.Paperscope.S.search.sem && window.Paperscope.S.search.sem.size > 10, { timeout: 120000 });
    const sem = await page.evaluate(() => {
      const s = window.Paperscope.S.search; const out = [];
      for (const w of s.pool.values()) out.push([w.title, s.sem.get(w.key).q]);
      out.sort((a, b) => b[1] - a[1]);
      return { top: out.slice(0, 3), bottom: out.slice(-3), lastRun: window.Paperscope.S.ai.lastRun };
    });
    check('model similarities are sensible (topical > off-topic)', sem.top[0][1] > sem.bottom[2][1] + 0.1, JSON.stringify(sem.top.map(x => [x[0].slice(0, 40), x[1].toFixed(2)])) + ' … ' + JSON.stringify(sem.bottom.map(x => [x[0].slice(0, 40), x[1].toFixed(2)])));
    console.log('  embed run:', JSON.stringify(sem.lastRun));
    fs.writeFileSync(`${OUT}/ai-run.json`, JSON.stringify(sem, null, 1));
  }

  // 10. accessibility scan (axe-core) on search results
  await page.addScriptTag({ path: path.join(VENDOR, 'axe-core/axe.min.js') });
  const axe = await page.evaluate(async () => { const r = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] }); return r.violations.map(v => `${v.id} (${v.nodes.length}): ${v.help} :: ` + v.nodes.slice(0, 6).map(n => n.target.join(' ') + ' ' + (n.any[0] && n.any[0].data ? JSON.stringify({ fg: n.any[0].data.fgColor, bg: n.any[0].data.bgColor, r: n.any[0].data.contrastRatio }) : '')).join(' ; ')); });
  check('no WCAG A/AA violations found by axe-core', axe.length === 0, axe.join(' | '));

  // desktop screenshot
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.screenshot({ path: `${OUT}/14-desktop.png` });

  check('no uncaught page errors', consoleErrors.filter(e => !/favicon|ERR_FAILED|net::|429/.test(e)).length === 0, consoleErrors.slice(0, 5).join(' | '));
  check('no unexpected external requests', !calls.some(c => c.startsWith('BLOCKED')), calls.filter(c => c.startsWith('BLOCKED')).join(' '));
  fs.writeFileSync(`${OUT}/ui-results.json`, JSON.stringify({ log, calls: calls.slice(-30) }, null, 1));
  const failed = log.filter(l => !l.ok).length;
  console.log(`\n${log.length - failed}/${log.length} checks passed`);
  await browser.close(); server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
