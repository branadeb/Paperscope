// Phone screenshots of every screen, light and dark, for design review (mocked APIs).
// Run: node tools/build.mjs && node test/mobile-shots.cjs [width] [height]
'use strict';
const path = require('path'); const fs = require('fs');
const puppeteer = require('/home/claude/vendor/node_modules/puppeteer-core');
const M = require('./mock-data.js'); const A = require('./mock-authors.cjs');
const OUT = path.join(__dirname, 'out', `mobile-${process.argv[2] || 375}`); fs.mkdirSync(OUT, { recursive: true });
const W = Number(process.argv[2] || 375), H = Number(process.argv[3] || 812);
const server = require('./static-server.cjs')(8770);
const CV = fs.readFileSync(path.join(__dirname, 'fixtures', 'cv_sample.txt'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const errors = [];
  async function open(dark, hash = '#search') {
    const ctx = await browser.createBrowserContext(); // fresh storage for every screen
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request', req => {
      const url = req.url();
      if (url.startsWith('data:')) return req.continue();
      const u = new URL(url);
      if (u.hostname === 'localhost') return req.continue();
      const p = u.searchParams; const f = p.get('filter') || '';
      if (u.hostname === 'api.openalex.org' && u.pathname === '/works' && !/author\.id|doi:|raw_author_name|related_to|cites|cited_by/.test(f)) {
        if (p.get('group_by')) return A.json(req, { meta: { count: 1, cost_usd: 0.001 }, group_by: M.groupByPhysical });
        if (p.get('search.semantic')) return A.json(req, { meta: { count: 7, cost_usd: 0.001 }, results: M.semWorks });
        return A.json(req, { meta: { count: 18, cost_usd: 0.001 }, results: Number(p.get('page') || 1) === 1 ? M.kwWorks : [] });
      }
      if (u.hostname === 'api.crossref.org' && !/orcid/.test(u.search) && !u.pathname.startsWith('/works/')) return A.json(req, { message: { items: M.crossref, 'total-results': 3 } });
      if (u.hostname === 'www.ebi.ac.uk') return A.json(req, { hitCount: 2, resultList: { result: M.epmc } });
      if (A.respond(req)) return;
      return req.abort();
    });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }]);
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(`http://localhost:8770/?nosw${hash}`, { waitUntil: 'load' });
    await sleep(300);
    return page;
  }
  const overflow = [];
  const shot = async (page, name, full = false) => {
    await sleep(350); await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
    const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (o > 0) overflow.push(`${name} +${o}px`);
  };
  const scrollTo = (page, sel, off = 8) => page.evaluate((s, o) => { const el = document.querySelector(s); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - o); }, sel, off);
  const search = async (page, q) => {
    await page.$eval('#q', (el, v) => { el.value = v; }, q);
    await page.$eval('#search-form button', b => b.click());
    await page.waitForFunction(() => document.querySelectorAll('#results .paper').length > 0 && document.querySelector('#loading').hidden, { timeout: 20000 });
  };
  const withProfile = async page => {
    await page.evaluate(() => { location.hash = '#profile'; });
    await page.$eval('#cv-text', (el, v) => { el.value = v; }, CV);
    await page.$eval('#read-text', b => b.click());
    await page.waitForSelector('#profile-editor *', { timeout: 10000 });
  };

  for (const dark of [false, true]) {
    const m = dark ? 'dark' : 'light';
    let page = await open(dark);
    await shot(page, `01-start-${m}`);
    await scrollTo(page, '#start'); await shot(page, `02-start-below-${m}`);
    await page.$eval('.pathways [data-pathway="author"]', b => b.click()); await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, `03-start-author-${m}`);
    await page.close();

    page = await open(dark);
    await withProfile(page);
    await page.evaluate(() => window.scrollTo(0, 0)); await shot(page, `04-profile-top-${m}`);
    await scrollTo(page, '#profile-editor'); await shot(page, `05-profile-editor-${m}`);
    await page.evaluate(() => { location.hash = '#search'; });
    await search(page, 'exciton migration in molecular crystals');
    await page.evaluate(() => window.scrollTo(0, 0)); await shot(page, `06-results-top-${m}`);
    await scrollTo(page, '#interp'); await shot(page, `07-interp-${m}`);
    await scrollTo(page, '#map-holder'); await shot(page, `08-map-${m}`);
    await scrollTo(page, '#filterbar'); await shot(page, `09-results-list-${m}`);
    await page.$eval('#results .paper [data-details]', b => b.click()); await scrollTo(page, '#results .paper'); await shot(page, `10-paper-details-${m}`);
    await page.$eval('#open-filters', b => b.click()); await shot(page, `11-filters-sheet-${m}`);
    await page.keyboard.press('Escape');
    await page.$$eval('#results .paper [data-save]', bs => bs.slice(0, 3).forEach(b => b.click()));
    await scrollTo(page, '#more'); await shot(page, `12-results-end-${m}`);
    await page.evaluate(() => { location.hash = '#saved'; }); await page.evaluate(() => window.scrollTo(0, 0)); await shot(page, `13-saved-${m}`);
    await page.evaluate(() => { location.hash = '#about'; }); await page.evaluate(() => window.scrollTo(0, 0)); await shot(page, `14-about-${m}`);
    await scrollTo(page, '#install-panel', 60); await shot(page, `15-about-install-${m}`);
    await scrollTo(page, '#feature-table', 60); await shot(page, `15b-about-features-${m}`);
    await page.close();

    page = await open(dark);
    await page.$eval('.pathways [data-pathway="author"]', b => b.click());
    await page.$eval('#q', el => { el.value = 'Ada Example'; }); await page.$eval('#search-form button', b => b.click());
    await page.waitForSelector('#author-open'); await scrollTo(page, '#clarify', 70); await shot(page, `16-author-picker-${m}`);
    await page.$eval('#q', el => { el.value = 'Monosij Mondal'; }); await page.$eval('#search-form button', b => b.click());
    await page.waitForFunction(() => { const v = window.Paperscope.S.search.verify; return v && v.state === 'done' && document.querySelector('#loading').hidden; }, { timeout: 20000 });
    await page.evaluate(() => window.scrollTo(0, 0)); await shot(page, `17-author-top-${m}`);
    await scrollTo(page, '.author-head'); await shot(page, `18-author-head-${m}`);
    await scrollTo(page, '.fields'); await shot(page, `19-author-fields-${m}`);
    await scrollTo(page, '#results .fgroup'); await shot(page, `20-author-groups-${m}`);
    await page.$eval('details[data-field-group="__aside"]', d => { d.open = true; }); await scrollTo(page, '#fg-aside'); await shot(page, `21-author-aside-${m}`);
    await page.close();
  }
  console.log(`${fs.readdirSync(OUT).length} screenshots in ${OUT} at ${W}x${H}; page errors: ${errors.length ? errors.join(' | ') : 'none'}; sideways scrolling: ${overflow.length ? overflow.join(', ') : 'none'}`);
  await browser.close(); server.close();
})().catch(e => { console.error(e); server.close(); process.exit(1); });
