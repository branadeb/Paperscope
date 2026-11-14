// Screenshots of the redesign in light and dark, phone and desktop (mocked APIs).
'use strict';
const path = require('path'); const fs = require('fs'); const http = require('http');
const puppeteer = require('/home/claude/vendor/node_modules/puppeteer-core');
const M = require('./mock-data.js'); const ROOT = path.join(__dirname, '..'); const OUT = path.join(ROOT, 'test', 'out');
const server = require('./static-server.cjs')(8767);
const json = (req, o) => req.respond({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const shoot = async (name, { dark, width = 390, height = 844, search, scroll, profile }) => {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (req.url().startsWith('data:')) return req.continue();
      const u = new URL(req.url());
      if (u.hostname === 'localhost') return req.continue();
      const p = u.searchParams;
      if (u.hostname === 'api.openalex.org') return json(req, p.get('search.semantic') ? { meta: { count: 7, cost_usd: 0.001 }, results: M.semWorks } : { meta: { count: 18, cost_usd: 0.001 }, results: M.kwWorks });
      if (u.hostname === 'api.crossref.org') return json(req, { message: { items: M.crossref, 'total-results': 3 } });
      if (u.hostname === 'www.ebi.ac.uk') return json(req, { hitCount: 2, resultList: { result: M.epmc } });
      return req.abort();
    });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }]);
    await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: width < 700, hasTouch: width < 700 });
    await page.goto('http://localhost:8767/#search', { waitUntil: 'load' });
    if (profile) await page.evaluate(t => { window.Core && (window.Paperscope.S.profile = window.Core.extractProfile(t)); }, fs.readFileSync(path.join(__dirname, 'fixtures/cv_sample.txt'), 'utf8'));
    await new Promise(r => setTimeout(r, 1500));
    if (search) {
      await page.$eval('#q', (el, v) => { el.value = v; }, search);
      await page.$eval('#search-form button', b => b.click());
      await page.waitForFunction(() => document.querySelectorAll('#results .paper').length > 0, { timeout: 15000 });
      await new Promise(r => setTimeout(r, 400));
    }
    if (scroll) await page.evaluate(sel => { const el = document.querySelector(sel); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 10); }, scroll);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    await page.close();
  };
  await shoot('d-01-start-light', {});
  await shoot('d-02-start-dark', { dark: true });
  await shoot('d-03-results-light', { search: 'exciton migration in molecular crystals', scroll: '#results', profile: true });
  await shoot('d-04-results-dark', { dark: true, search: 'exciton migration in molecular crystals', scroll: '#results', profile: true });
  await shoot('d-05-map-dark', { dark: true, search: 'exciton migration in molecular crystals', scroll: '.map', profile: true });
  await shoot('d-06-desktop-light', { width: 1280, height: 860, search: 'exciton migration in molecular crystals', profile: true });
  await browser.close(); server.close();
})().catch(e => { console.error(e); server.close(); process.exit(1); });
