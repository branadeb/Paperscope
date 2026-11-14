// Browser tests for the author pathway (name or ORCID search, profile picker, works grouped by field,
// co-author and byline navigation) and DOI lookup. External services are mocked.
// Run: node test/ui-author.test.cjs
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

const log = []; const calls = []; const orcidAccept = [];
const check = (name, ok, detail = '') => { log.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(path.join(ROOT, 'dist', 'index.html'))); }).listen(8768);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const json = (req, obj, status = 200) => req.respond({ status, headers: { 'content-type': 'application/json', ...CORS }, body: JSON.stringify(obj) });

// ---------- synthetic data
const OA = 'https://openalex.org/';
const topic = (id, name, field, fieldId) => ({ id: `${OA}T${id}`, display_name: name, subfield: { display_name: name }, field: { id: `${OA}fields/${fieldId}`, display_name: field }, domain: { display_name: 'Physical Sciences' } });
const TOP = {
  chem: topic(901, 'Photochemistry and Electron Transfer Studies', 'Chemistry', 16),
  eng: topic(902, 'Organic Electronics and Photovoltaics', 'Engineering', 22),
  earth: topic(903, 'Atmospheric chemistry and aerosols', 'Earth and Planetary Sciences', 19),
};
const ADA = { id: `${OA}A1001`, display_name: 'Ada Example' };
const ADA2 = { id: `${OA}A1002`, display_name: 'A. Example' };
const BO = { id: `${OA}A2001`, display_name: 'Bo Coauthor' };
let wn = 0;
function aw(t, year, authors, cites) {
  wn++;
  return {
    id: `${OA}W7${String(wn).padStart(6, '0')}`, doi: `https://doi.org/10.5555/au.${wn}`, display_name: `Author pathway test paper ${wn} on ${t ? t.display_name.toLowerCase() : 'an unclassified subject'}`,
    publication_year: year, publication_date: `${year}-06-01`, type: 'article', cited_by_count: cites,
    authorships: authors.map(a => ({ author: a })),
    primary_location: { landing_page_url: `https://doi.org/10.5555/au.${wn}`, raw_type: 'journal-article', source: { display_name: 'Journal of Test Chemistry' } },
    best_oa_location: null, open_access: { is_oa: wn % 4 === 0, oa_status: 'closed', oa_url: null },
    primary_topic: t || null, keywords: [], abstract_inverted_index: null, citation_normalized_percentile: null, is_retracted: false,
  };
}
// 230 works by Ada (newest first): 15 Earth, 5 unclassified, 150 Chemistry, 60 Engineering; Bo co-authors some.
const earthIdx = new Set([10, 50, 90, 130, 170, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209]);
const ncIdx = new Set([20, 60, 100, 140, 180]);
const ALL = []; let k = 0;
for (let i = 0; i < 230; i++) {
  const year = 2024 - Math.floor(i / 12);
  let t;
  if (earthIdx.has(i)) t = TOP.earth; else if (ncIdx.has(i)) t = null; else { t = k % 7 < 5 ? TOP.chem : TOP.eng; k++; }
  const authors = [ADA, ...(i % 3 === 0 ? [BO] : []), { display_name: 'No Id Person' }];
  ALL.push(aw(t, year, authors, (i * 37) % 500));
}
for (let i = 0; i < 4; i++) ALL.push(aw(TOP.chem, 2004 - i, [ADA2], 5 + i)); // only on the split profile
const hasAuthor = (w, ids) => w.authorships.some(a => a.author.id && ids.includes(a.author.id.split('/').pop()));
const fieldIdOf = w => w.primary_topic ? w.primary_topic.field.id.split('/').pop() : null;

const AUTH = {
  A1001: { id: ADA.id, display_name: 'Ada Example', orcid: 'https://orcid.org/0000-0002-1825-0097', works_count: 230, cited_by_count: 9100, summary_stats: { h_index: 41 },
    last_known_institutions: [{ display_name: 'Example University', country_code: 'GB' }], topics: [{ display_name: 'Photochemistry and Electron Transfer Studies', count: 150, field: { display_name: 'Chemistry' } }] },
  A1002: { id: ADA2.id, display_name: 'A. Example', orcid: null, works_count: 4, cited_by_count: 26, summary_stats: { h_index: 3 },
    last_known_institutions: [{ display_name: 'Example University', country_code: 'GB' }], topics: [] },
  A1003: { id: `${OA}A1003`, display_name: 'Ada Exemplar', orcid: null, works_count: 40, cited_by_count: 300, summary_stats: { h_index: 9 },
    last_known_institutions: [{ display_name: 'Other Institute', country_code: 'US' }], topics: [{ display_name: 'Glaciology', count: 30, field: { display_name: 'Earth and Planetary Sciences' } }] },
  A2001: { id: BO.id, display_name: 'Bo Coauthor', orcid: null, works_count: 77, cited_by_count: 1200, summary_stats: { h_index: 15 },
    last_known_institutions: [{ display_name: 'Coauthor College', country_code: 'SE' }], topics: [] },
  A3001: { id: `${OA}A3001`, display_name: 'Solo Person', orcid: null, works_count: 1, cited_by_count: 0, summary_stats: { h_index: 0 }, last_known_institutions: [], topics: [] },
};
const DOI_FOUND = aw(TOP.chem, 2021, [ADA, BO], 12); DOI_FOUND.doi = 'https://doi.org/10.5555/found.1';
const TOPIC_RESULTS = [aw(TOP.chem, 2022, [ADA, BO], 80), aw(TOP.eng, 2020, [BO, ADA], 50), aw(TOP.chem, 2019, [{ display_name: 'Cy Other' }], 20)];
TOPIC_RESULTS.forEach((w, i) => { w.display_name = ['Electron transfer in organic photochemistry', 'Organic photochemistry for photovoltaics', 'Photochemistry of electron transfer'][i]; });

// ---------- a merged profile, modelled on a real one: two people with the same surname and initial
const MM = 'https://openalex.org/A5084327602'; const MORCID = '0000-0003-4764-0737';
const MREC = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'orcid-record-mondal.json'), 'utf8'));
let mn = 0;
function mw({ title, year, doi, field, ships, cites = 0 }) {
  mn++;
  const t = field ? { id: `${OA}T95${mn}`, display_name: field === 'Engineering' ? 'Advancements in Battery Materials' : field === 'Chemistry' ? 'Machine Learning in Materials Science' : 'Atomic and Molecular Physics', subfield: { display_name: 'x' }, field: { id: `${OA}fields/${{ Engineering: 22, Chemistry: 16 }[field] || 31}`, display_name: field }, domain: { display_name: 'Physical Sciences' } } : null;
  return { id: `${OA}W8${String(mn).padStart(6, '0')}`, doi: doi ? `https://doi.org/${doi}` : null, display_name: title, publication_year: year, publication_date: `${year}-03-01`, type: 'article', cited_by_count: cites,
    authorships: ships.map(([id, name, raw, inst, orcid]) => ({ author: { id: id || null, display_name: name, orcid: orcid ? `https://orcid.org/${orcid}` : null }, raw_author_name: raw || name, institutions: (inst || []).map(d => ({ display_name: d })) })),
    primary_location: { landing_page_url: doi ? `https://doi.org/${doi}` : null, raw_type: 'journal-article', source: { display_name: 'Some Journal' } }, best_oa_location: null, open_access: { is_oa: false }, primary_topic: t, keywords: [], abstract_inverted_index: null, is_retracted: false };
}
const LAB = [['L1', 'James Stevenson'], ['L2', 'Garvit Agarwal'], ['L3', 'Leif D. Jacobson'], ['L4', 'Richard A. Friesner']];
const COLL = [['P1', 'B. Mandal'], ['P2', 'T.K. Mistry'], ['P3', 'Malay Purkait']];
const RKM = ['Ramakrishna Mission Residential College'];
const MPROFILE = [
  mw({ title: 'Evidence for multi-Li+ clustering in lithium-ion battery electrolytes', year: 2026, doi: '10.1038/s41586-026-11138-7', field: 'Engineering', cites: 4, ships: [LAB[0], LAB[1], [MM, 'M. Mondal', 'Monosij Mondal', ['Columbia University'], MORCID], LAB[2], LAB[3]] }),
  mw({ title: 'Electron capture and excitation in He+ + He collisions at intermediate and high energies', year: 2025, doi: '10.1103/wktq-w1zb', field: 'Physics and Astronomy', cites: 1, ships: [COLL[0], COLL[1], [MM, 'M. Mondal', 'M. Mondal', RKM, MORCID], COLL[2]] }),
  mw({ title: 'Positronium formation in collisions of positron with water and methane molecules', year: 2025, doi: '10.1088/1402-4896/adefa1', field: 'Physics and Astronomy', cites: 2, ships: [[MM, 'M. Mondal', 'M Mondal', RKM, MORCID], COLL[1], COLL[2]] }),
  mw({ title: 'Theoretical triple differential cross sections for ionization of N2 and CH4 molecules by electron impact', year: 2024, doi: '10.1088/1402-4896/ad3e42', field: 'Physics and Astronomy', cites: 3, ships: [[MM, 'M. Mondal', 'M Mondal', RKM, MORCID], COLL[0], COLL[2]] }),
  mw({ title: 'Single-electron-capture from helium by projectile ions in intermediate-to-high energies', year: 2023, doi: '10.1007/s12648-023-02787-9', field: 'Physics and Astronomy', cites: 5, ships: [COLL[2], [MM, 'M. Mondal', 'M. Mondal', RKM, MORCID]] }),
  mw({ title: 'Semiclassical Modeling of Optical Properties of Molecules in Cavity Environments', year: 2023, doi: null, field: 'Physics and Astronomy', ships: [[MM, 'M. Mondal', 'Mondal, Monosij', [], MORCID]] }),
  mw({ title: 'A state-specific multi-reference coupled-cluster approach with a cost-effective treatment of connected triples: implementation to geometry optimisation', year: 2016, doi: '10.1080/00268976.2016.1142126', field: 'Physics and Astronomy', cites: 9, ships: [['Q1', 'Debi Banerjee'], [MM, 'M. Mondal', 'Monosij Mondal', ['Indian Institute of Engineering Science and Technology, Shibpur'], MORCID]] }),
];
const UNLINKED = [ // in OpenAlex, but the authorship has no author id
  mw({ title: 'Strong Coupling in Infrared Plasmonic Cavities', year: 2022, doi: '10.1021/acs.jpclett.2c02304', field: 'Physics and Astronomy', cites: 30, ships: [[null, 'Monosij Mondal', 'Monosij Mondal', [], MORCID], ['N2', 'Maicol A. Ochoa'], ['N1', 'Abraham Nitzan']] }),
  mw({ title: 'Coupling, lifetimes, and “strong coupling” maps for single molecules at plasmonic interfaces', year: 2022, doi: '10.1063/5.0077739', field: 'Physics and Astronomy', cites: 20, ships: [[null, 'Monosij Mondal', 'Monosij Mondal', [], MORCID], ['N2', 'Maicol A. Ochoa'], ['N3', 'Maxim Sukharev'], ['N1', 'Abraham Nitzan']] }),
  mw({ title: 'Evidence for significant multi-Li+ clustering in common lithium-ion battery electrolytes', year: 2025, doi: '10.26434/chemrxiv-2025-ndqzk-v2', field: 'Engineering', ships: [LAB[0], LAB[1], [null, 'Monosij Mondal', 'Monosij Mondal', [], MORCID], LAB[2], LAB[3]] }),
  mw({ title: 'Evidence for significant multi-Li+ clustering in common lithium-ion battery electrolytes', year: 2026, doi: '10.26434/chemrxiv-2025-ndqzk/v4', field: 'Engineering', ships: [LAB[0], LAB[1], [null, 'Monosij Mondal', 'Monosij Mondal', [], MORCID], LAB[2], LAB[3]] }),
];
const BY_NAME = [ // raw-name search: one of his, one by a different Mondal
  mw({ title: 'Scalable and Generalizable Machine Learning Force Fields for Modeling Complex Battery Materials', year: 2025, doi: '10.1149/ma2025-02291586mtgabs', field: 'Chemistry', ships: [LAB[1], [null, 'Monosij Mondal', 'Monosij Mondal'], LAB[2]] }),
  mw({ title: 'Silent Threshold Traitor Tracing', year: 2025, doi: '10.1145/3719027.3765099', field: 'Chemistry', ships: [['Z1', 'Arup Mondal', 'Arup Mondal']] }),
];
const MAUTH = { id: MM, display_name: 'M. Mondal', orcid: `https://orcid.org/${MORCID}`, works_count: 7, cited_by_count: 24, summary_stats: { h_index: 3 }, last_known_institutions: [{ display_name: 'Columbia University', country_code: 'US' }], topics: [] };
const CR_ORCID = [ // what Crossref has with this ORCID attached by publishers
  { DOI: '10.1021/acs.jpclett.2c02304', title: ['Strong Coupling in Infrared Plasmonic Cavities'], issued: { 'date-parts': [[2022]] }, type: 'journal-article', author: [{ given: 'Monosij', family: 'Mondal', ORCID: `https://orcid.org/${MORCID}` }] },
  { DOI: '10.26434/chemrxiv-2025-ndqzk/v3', title: ['Evidence for significant multi-Li+ clustering in common lithium-ion battery electrolytes'], issued: { 'date-parts': [[2026]] }, type: 'posted-content', author: [{ given: 'Monosij', family: 'Mondal', ORCID: `https://orcid.org/${MORCID}` }] },
];

function mockOpenAlex(req, u) {
  const p = u.searchParams; const f = p.get('filter') || '';
  const per = Number(p.get('per_page') || 25); const page = Number(p.get('page') || 1);
  const meta = (count, cost) => ({ count, cost_usd: cost });
  const authorMatch = u.pathname.match(/^\/authors\/(A\d+)$/);
  if (authorMatch) return AUTH[authorMatch[1]] ? json(req, AUTH[authorMatch[1]]) : json(req, { error: 'not found' }, 404);
  if (u.pathname.startsWith('/authors/orcid:')) return u.pathname.endsWith('0000-0002-1825-0097') ? json(req, AUTH.A1001) : json(req, { error: 'not found' }, 404);
  if (u.pathname === '/authors/A5084327602') return json(req, MAUTH);
  if (/raw_author_name\.search:/.test(f)) return json(req, { meta: meta(/Monosij/.test(f) ? 2 : 0, 0.001), results: /Monosij Mondal/.test(f) ? BY_NAME : [] });
  if (/^doi:/.test(f)) {
    const want = f.slice(4).split('|');
    return json(req, { meta: meta(0, 0.0001), results: UNLINKED.filter(w => want.includes(w.doi.replace('https://doi.org/', ''))) });
  }
  if (u.pathname === '/works' && /author\.id:A5084327602/.test(f)) {
    if (p.get('group_by')) return json(req, { meta: meta(7, 0.0001), group_by: [{ key: `${OA}fields/31`, key_display_name: 'Physics and Astronomy', count: 6 }, { key: `${OA}fields/22`, key_display_name: 'Engineering', count: 1 }] });
    if (p.get('sort') === 'publication_year:asc') return json(req, { meta: meta(7, 0.0001), results: [{ publication_year: 2016 }] });
    return json(req, { meta: meta(7, 0.0001), results: MPROFILE });
  }
  if (u.pathname === '/authors') {
    const q = (p.get('search') || '').toLowerCase();
    const res = q === 'ada example' ? [AUTH.A1001, AUTH.A1002, AUTH.A1003] : q === 'solo person' ? [AUTH.A3001] : q === 'monosij mondal' ? [MAUTH] : [];
    return json(req, { meta: meta(res.length, 0.001), results: res });
  }
  if (u.pathname.startsWith('/works/doi:')) {
    const doi = decodeURIComponent(u.pathname.slice('/works/doi:'.length));
    return doi === '10.5555/found.1' ? json(req, DOI_FOUND) : json(req, { error: 'not found' }, 404);
  }
  const am = f.match(/author\.id:([A\d|]+)/);
  if (u.pathname === '/works' && am) {
    const ids = am[1].split('|');
    let list = ALL.filter(w => hasAuthor(w, ids));
    const fm = f.match(/primary_topic\.field\.id:(\d+)/);
    if (fm) list = list.filter(w => fieldIdOf(w) === fm[1]);
    if (p.get('group_by')) {
      const g = new Map();
      list.forEach(w => { if (!w.primary_topic) return; const key = w.primary_topic.field.id; const e = g.get(key) || { key, key_display_name: w.primary_topic.field.display_name, count: 0 }; e.count++; g.set(key, e); });
      return json(req, { meta: meta(list.length, 0.0001), group_by: [...g.values()].sort((a, b) => b.count - a.count) });
    }
    if (p.get('sort') === 'publication_year:asc') list = list.slice().sort((a, b) => a.publication_year - b.publication_year);
    else list = list.slice().sort((a, b) => b.publication_date.localeCompare(a.publication_date));
    return json(req, { meta: meta(list.length, 0.0001), results: list.slice((page - 1) * per, page * per) });
  }
  if (/^related_to:/.test(f)) return json(req, { meta: meta(2, 0.0001), results: [M.kwWorks[2], M.kwWorks[14]] });
  if (p.get('group_by')) return json(req, { meta: meta(1, 0.001), group_by: M.groupByPhysical });
  if (p.get('search') || p.get('search.semantic')) return json(req, { meta: meta(TOPIC_RESULTS.length, 0.001), results: page === 1 ? TOPIC_RESULTS : [] });
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
    calls.push(`${u.hostname}${decodeURIComponent(u.pathname)}?${decodeURIComponent(u.search.slice(1).replace(/\+/g, ' '))}`);
    if (u.hostname === 'api.openalex.org') return mockOpenAlex(req, u);
    if (u.hostname === 'pub.orcid.org') {
      orcidAccept.push(req.headers().accept || '');
      if (u.pathname === `/v3.0/${MORCID}/record`) return json(req, MREC);
      if (u.pathname === '/v3.0/0000-0002-1825-0097/record') return json(req, { 'orcid-identifier': { path: '0000-0002-1825-0097' }, person: { name: { 'given-names': { value: 'Ada' }, 'family-name': { value: 'Example' } } }, 'activities-summary': { works: { group: [] } } });
      return json(req, { 'response-code': 404 }, 404);
    }
    if (u.hostname === 'api.crossref.org' && /filter=orcid/.test(decodeURIComponent(u.search))) {
      return json(req, { message: { 'total-results': 0, items: decodeURIComponent(u.search).includes(MORCID) ? CR_ORCID : [] } });
    }
    if (u.hostname === 'api.crossref.org') {
      if (u.pathname.startsWith('/works/')) {
        const doi = decodeURIComponent(u.pathname.slice(7)).toLowerCase();
        if (doi === '10.5555/cronly.1') return json(req, { message: { DOI: '10.5555/cronly.1', title: ['A paper only Crossref knows about'], type: 'journal-article', author: [{ given: 'Di', family: 'Crossref' }], issued: { 'date-parts': [[2018]] }, 'container-title': ['Crossref Test Letters'], URL: 'https://doi.org/10.5555/cronly.1', 'is-referenced-by-count': 3 } });
        return json(req, { status: 'error', message: 'Resource not found.' }, 404);
      }
      return json(req, { message: { items: [], 'total-results': 0 } });
    }
    if (u.hostname === 'www.ebi.ac.uk') return json(req, { hitCount: 0, resultList: { result: [] } });
    calls.push('BLOCKED ' + req.url());
    return req.abort();
  });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto('http://localhost:8768/#search', { waitUntil: 'load' });
  const tap = sel => page.$eval(sel, b => b.click());
  const idle = () => page.waitForFunction(() => document.querySelector('#loading').hidden, { timeout: 15000 });
  const type = (v) => page.$eval('#q', (el, x) => { el.value = x; }, v);
  const submit = async v => { await type(v); await tap('#search-form button'); };
  const waitAuthor = name => page.waitForFunction(n => { const h = document.querySelector('.ah-name'); const v = window.Paperscope.S.search.verify; return h && h.textContent === n && document.querySelector('#loading').hidden && document.querySelectorAll('.wrow').length > 0 && v && v.state !== 'loading'; }, { timeout: 15000 }, name);
  const axeRun = async () => {
    if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: path.join(VENDOR, 'axe-core/axe.min.js') });
    return page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map(v => `${v.id} (${v.nodes.length}) ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' ; ')}`));
  };

  // ---------- pathway switch
  const authorEx = await page.$$eval('[data-author-example]', els => els.length);
  check('start screen offers author examples', authorEx === 2);
  await tap('.pathways [data-pathway="author"]');
  const pw = await page.evaluate(() => ({
    checked: document.querySelector('.pathways [data-pathway="author"]').getAttribute('aria-checked'),
    ph: document.querySelector('#q').placeholder, label: document.querySelector('label[for="q"]').textContent,
    modes: getComputedStyle(document.querySelector('#modes')).display, lede: document.querySelector('#hero-lede').textContent,
    stored: localStorage.getItem('paperscope.pathway'),
  }));
  check('Authors pathway selected', pw.checked === 'true' && pw.ph === 'Author name or ORCID iD' && pw.label === 'Author name or ORCID iD', `${pw.ph} / ${pw.label}`);
  check('ranking modes hidden for author search', pw.modes === 'none');
  check('hero text describes author search', /researcher/.test(pw.lede));
  check('pathway choice remembered', /author/.test(pw.stored || ''), pw.stored);

  // ---------- name search with a picker
  calls.length = 0;
  await submit('Ada Example');
  await page.waitForSelector('#author-open', { timeout: 10000 });
  const pick = await page.evaluate(() => ({ n: document.querySelectorAll('input[name="acand"]').length, first: document.querySelector('input[name="acand"]').checked,
    text: document.querySelector('.authors').innerText, heading: document.querySelector('#ap-h').textContent }));
  check('picker lists every matching profile', pick.n === 3 && /Which “Ada Example”/.test(pick.heading));
  check('first profile preselected', pick.first);
  check('profiles show institution, counts and h-index', /Example University, GB/.test(pick.text) && /h‑index 41/.test(pick.text) && /Other Institute/.test(pick.text) && /ORCID/.test(pick.text));
  check('name search uses the authors endpoint', calls.some(c => /api\.openalex\.org\/authors\?.*search=Ada Example/.test(c)), calls[0]);
  await page.screenshot({ path: path.join(OUT, 'author-picker.png') });
  const axePick = await axeRun();
  check('picker: no WCAG A/AA violations', axePick.length === 0, axePick.join(' | '));

  // combine two profiles
  await page.$$eval('input[name="acand"]', els => { els[1].click(); });
  calls.length = 0;
  await tap('#author-open');
  await waitAuthor('Ada Example');
  const worksCall = calls.find(c => /author\.id:A1001\|A1002/.test(c) && /per_page=200/.test(c));
  check('combined profiles requested together', !!worksCall, worksCall);
  check('works requested newest first, 200 per page', /sort=publication_date:desc/.test(worksCall || ''));
  check('field counts requested with group_by', calls.some(c => /author\.id:A1001\|A1002/.test(c) && /group_by=primary_topic\.field\.id/.test(c)));
  const head = await page.evaluate(() => ({ stats: [...document.querySelectorAll('.ah-stats div')].map(d => d.innerText.replace(/\s+/g, ' ')), text: document.querySelector('.author-head').innerText }));
  check('header shows total works across profiles', head.stats.some(s => /Works 234/.test(s)), head.stats.join(' | '));
  check('header sums citations and shows largest h-index', head.stats.some(s => /Citations 9,126/.test(s)) && head.stats.some(s => /h-index 41/.test(s)), head.stats.join(' | '));
  check('header shows the full active span (oldest work fetched separately)', head.stats.some(s => /Active 2001–2024/.test(s)), head.stats.join(' | '));
  check('header explains combined profiles', /Combining 2 OpenAlex profiles/.test(head.text));
  check('header explains why papers cannot be cross-checked (empty ORCID record)', /ORCID record lists no papers/.test(head.text) && /similar names may be mixed in/.test(head.text), head.text.slice(0, 400));
  check('no ORCID badges when nothing could be confirmed', !(await page.$('.badge.v-ok, .badge.v-warn, .badge.v-likely')));
  check('header shows ORCID and cost', /0000-0002-1825-0097/.test(head.text) && /OpenAlex cost: \$0\.0/.test(head.text));

  // ---------- field bars
  const bars = await page.$$eval('.fbars button', els => els.map(b => ({ f: b.dataset.fieldJump, txt: b.querySelector('.fb-n').textContent.trim(), w: parseFloat(b.querySelector('.fb-bar').style.width) })));
  check('field bars cover all works, largest first, unclassified last',
    bars.map(b => b.f).join(',') === 'Chemistry,Engineering,Earth and Planetary Sciences,Not classified', bars.map(b => `${b.f} ${b.txt}`).join(' | '));
  check('field bar counts come from group_by (all works)', /^154\b/.test(bars[0].txt) && /^60\b/.test(bars[1].txt) && /^15\b/.test(bars[2].txt) && /^5\b/.test(bars[3].txt), bars.map(b => b.txt).join(' | '));
  check('bars scale to the largest field', bars[0].w === 100 && Math.abs(bars[1].w - 100 * 60 / 154) < 0.2);

  // ---------- groups
  const g1 = await page.evaluate(() => [...document.querySelectorAll('details[data-field-group]')].map(d => ({ f: d.dataset.fieldGroup, open: d.open, rows: d.querySelectorAll('.wrow').length, sum: d.querySelector('summary').innerText.replace(/\s+/g, ' '), more: (d.querySelector('[data-fg-more]') || {}).textContent || '' })));
  check('works grouped by field, biggest group open', g1[0].f === 'Chemistry' && g1[0].open && g1.slice(1).every(g => !g.open), g1.map(g => `${g.f}:${g.open}`).join(' '));
  check('a group shows 8 works until expanded', g1[0].rows === 8 && /Show all/.test(g1[0].more), `${g1[0].rows} ${g1[0].more}`);
  const earth = g1.find(g => g.f === 'Earth and Planetary Sciences');
  check('partly loaded field says how many are missing', earth && /5 of 15/.test(earth.sum) && /Load the other 10/.test(earth.more), earth && `${earth.sum} / ${earth.more}`);
  check('group summary shows years and topics', /2024/.test(g1[0].sum) && /Photochemistry/.test(g1[0].sum), g1[0].sum);
  const rowLinks = await page.$$eval('details[data-field-group="Chemistry"] .wrow', rows => rows.filter(r => r.querySelector('button.auth[data-author-name="Bo Coauthor"]')).slice(0, 1).map(r => ({ href: r.querySelector('a.wt').href, auth: [...r.querySelectorAll('button.auth')].map(b => b.textContent), plain: r.querySelector('.wco').textContent })));
  check('rows link to the DOI', /^https:\/\/doi\.org\/10\.5555\/au\./.test(rowLinks[0].href), rowLinks[0].href);
  check('co-authors with an OpenAlex id are tappable, others plain text', rowLinks[0].auth.includes('Bo Coauthor') && /No Id Person/.test(rowLinks[0].plain) && !rowLinks[0].auth.includes('No Id Person'), rowLinks[0].auth.join(','));

  calls.length = 0;
  await tap('details[data-field-group="Chemistry"] [data-fg-more]');
  await page.waitForFunction(() => document.querySelectorAll('details[data-field-group="Chemistry"] .wrow').length > 8 && document.querySelector('#loading').hidden, { timeout: 10000 });
  check('Show all on a partly loaded field fetches the rest of it', calls.some(c => /primary_topic\.field\.id:16/.test(c)), calls.join(' | '));
  const chemRows = await page.$$eval('details[data-field-group="Chemistry"] .wrow', r => r.length);
  const chemLoaded = await page.evaluate(() => [...window.Paperscope.S.search.pool.values()].filter(w => w.topic && w.topic.field === 'Chemistry').length);
  check('Show all lists every work in the field', chemRows === chemLoaded && chemRows === 154, `${chemRows}/${chemLoaded}`);

  // load the rest of one field
  calls.length = 0;
  await page.$eval('details[data-field-group="Earth and Planetary Sciences"]', d => { d.open = true; });
  await tap('details[data-field-group="Earth and Planetary Sciences"] [data-fg-more]');
  await page.waitForFunction(() => document.querySelectorAll('details[data-field-group="Earth and Planetary Sciences"] .wrow').length === 15, { timeout: 10000 });
  check('loading one field fetches only that field', calls.some(c => /primary_topic\.field\.id:19/.test(c)), calls.join(' | '));
  const earthAfter = await page.$eval('details[data-field-group="Earth and Planetary Sciences"] summary', s => s.innerText);
  check('field shows all 15 works after loading', !/of 15/.test(earthAfter), earthAfter);

  // jump from a bar
  await page.$eval('.fbars [data-field-jump="Engineering"]', b => b.click());
  await page.waitForFunction(() => { const r = document.querySelector('#fg-engineering').getBoundingClientRect(); return r.top >= 0 && r.top < 300; }, { timeout: 4000 }).catch(() => {});
  const eng = await page.evaluate(() => ({ open: document.querySelector('details[data-field-group="Engineering"]').open, top: document.querySelector('#fg-engineering').getBoundingClientRect().top }));
  check('tapping a field bar opens and scrolls to that group', eng.open && eng.top < 300, JSON.stringify(eng));

  // sort
  await page.select('#sort', 'cited');
  const cited = await page.$$eval('details[data-field-group="Chemistry"] .wrow .wmeta', els => els.map(e => Number((e.textContent.match(/cited by ([\d,]+)/) || [0, '0'])[1].replace(/,/g, ''))));
  check('Most cited sort orders rows within a field', cited.length > 3 && cited.every((v, i) => !i || cited[i - 1] >= v), cited.slice(0, 6).join(','));
  await page.select('#sort', 'best');
  const newest = await page.$$eval('details[data-field-group="Chemistry"] .wrow .wmeta', els => els.map(e => Number((e.textContent.match(/(\d{4})/) || [0, 0])[1])));
  check('default sort is newest first without a profile', newest.every((v, i) => !i || newest[i - 1] >= v), newest.slice(0, 6).join(','));
  const sortLabel = await page.$eval('#sort option[value="best"]', o => o.textContent);
  check('sort label fits author view', sortLabel === 'Newest first', sortLabel);

  // hide / show a field
  await tap('[data-fg-hide="Earth and Planetary Sciences"]');
  const hid = await page.evaluate(() => ({ g: !!document.querySelector('details[data-field-group="Earth and Planetary Sciences"]'), line: (document.querySelector('.fg-hidden') || {}).textContent || '' }));
  check('a field can be hidden', !hid.g && /Earth and Planetary Sciences \(15\)/.test(hid.line), hid.line);
  await tap('[data-fg-show="Earth and Planetary Sciences"]');
  check('a hidden field can be shown again', await page.evaluate(() => !!document.querySelector('details[data-field-group="Earth and Planetary Sciences"]') && !document.querySelector('.fg-hidden')));

  // filters still work
  await page.evaluate(() => { const S = window.Paperscope.S; S.filters.yearFrom = '2020'; });
  await page.$eval('#sort', s => s.dispatchEvent(new Event('change', { bubbles: true })));
  const yrs = await page.$$eval('.wrow .wmeta', els => els.map(e => Number((e.textContent.match(/(\d{4})/) || [0, 0])[1])));
  check('year filter applies to the author view', yrs.length > 0 && yrs.every(y => y >= 2020), `${yrs.length} rows, min ${Math.min(...yrs)}`);
  await page.evaluate(() => { window.Paperscope.S.filters.yearFrom = ''; });
  await page.$eval('#sort', s => s.dispatchEvent(new Event('change', { bubbles: true })));

  // load more
  calls.length = 0;
  await tap('#author-more');
  await page.waitForFunction(() => !document.querySelector('#author-more') && document.querySelector('#loading').hidden, { timeout: 10000 });
  check('Load more fetches page 2', calls.some(c => /author\.id:A1001\|A1002/.test(c) && /page=2/.test(c)), calls.join(' | '));
  const loaded = await page.$eval('.author-head', h => h.innerText);
  check('all works loaded after the last page', /234 of 234 works loaded/.test(loaded), (loaded.match(/\d+ of \d+ works loaded/) || [''])[0]);

  // axe on the author view (light and dark)
  for (const mode of ['light', 'dark']) {
    await page.evaluate(m => { document.documentElement.dataset.appearance = m; window.scrollTo(0, 0); }, mode);
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: path.join(OUT, `author-${mode}.png`), fullPage: false });
    await page.evaluate(() => document.querySelector('.fields').scrollIntoView());
    await new Promise(r => setTimeout(r, 100));
    await page.screenshot({ path: path.join(OUT, `author-fields-${mode}.png`), fullPage: false });
    const v = await axeRun();
    check(`author view (${mode}): no WCAG A/AA violations`, v.length === 0, v.join(' | '));
  }
  await page.evaluate(() => { document.documentElement.dataset.appearance = 'light'; });
  await new Promise(r => setTimeout(r, 400));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('author view fits a phone screen', overflow <= 0, `overflow ${overflow}px`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, 'author-top.png') });

  // ---------- co-author navigation and back
  calls.length = 0;
  await page.$eval('details[data-field-group="Chemistry"] button.auth[data-author-name="Bo Coauthor"]', b => b.click());
  await waitAuthor('Bo Coauthor');
  check('tapping a co-author opens their works', calls.some(c => /\/authors\/A2001/.test(c)) && calls.some(c => /author\.id:A2001/.test(c)), calls.slice(0, 3).join(' | '));
  const bo = await page.evaluate(() => ({ inst: document.querySelector('.author-head').innerText, back: (document.querySelector('#trail-back') || {}).textContent || '', q: document.querySelector('#q').value }));
  check('co-author header filled from their profile', /Coauthor College, SE/.test(bo.inst), bo.inst.slice(0, 80));
  check('Back returns to the previous author', /Back to “Ada Example”/.test(bo.back) && bo.q === 'Bo Coauthor', bo.back);
  await tap('#trail-back');
  await waitAuthor('Ada Example');
  check('Back restores the previous author view', await page.evaluate(() => window.Paperscope.S.search.kind === 'author' && window.Paperscope.S.search.pool.size === 234));

  // trail from an author's work, and back
  await page.$eval('details[data-field-group="Chemistry"] .wrow [data-trail="related"]', b => b.click());
  await page.waitForFunction(() => window.Paperscope.S.search.kind === 'trail' && document.querySelector('#loading').hidden && document.querySelectorAll('#results .paper').length > 0, { timeout: 10000 });
  const tb = await page.$eval('#trail-back', b => b.textContent);
  check('citation trail from an author view can return to it', /Back to “Ada Example”/.test(tb), tb);
  await tap('#trail-back');
  await waitAuthor('Ada Example');
  check('returned to author view from the trail', true);

  // ---------- ORCID, single match, no match
  calls.length = 0;
  await submit('https://orcid.org/0000-0002-1825-0097');
  await waitAuthor('Ada Example');
  check('ORCID iD opens the author directly', calls.some(c => /\/authors\/orcid:0000-0002-1825-0097/.test(c)) && !(await page.$('#author-open')));
  await submit('Solo Person');
  await page.waitForFunction(() => { const h = document.querySelector('.ah-name'); return h && h.textContent === 'Solo Person' && document.querySelector('#loading').hidden; }, { timeout: 10000 });
  check('a single match opens without a picker', !(await page.$('#author-open')));
  const soloText = await page.$eval('#results', r => r.innerText);
  check('author with no works says so', /No works/.test(soloText), soloText.slice(0, 60));
  await submit('Nobody Here');
  await page.waitForFunction(() => /No authors named/.test(document.querySelector('#clarify').innerText), { timeout: 10000 });
  check('no match explains what to try', /initials/.test(await page.$eval('#clarify', c => c.innerText)));

  // ---------- ORCID cross-check on a profile that merges two people
  calls.length = 0; orcidAccept.length = 0;
  await submit('Monosij Mondal');
  await waitAuthor('Monosij Mondal');
  check('heading uses the name on the ORCID record', /OpenAlex lists “M\. Mondal”/.test(await page.$eval('.author-head', h => h.innerText)));
  check('ORCID record read from the ORCID public API as JSON', calls.some(c => c.startsWith(`pub.orcid.org/v3.0/${MORCID}/record`)) && orcidAccept.every(a => /application\/json/.test(a)), calls.filter(c => /orcid/.test(c)).join(' | '));
  check('publisher ORCID tags read from Crossref', calls.some(c => /api\.crossref\.org\/works\?filter=orcid:0000-0003-4764-0737/.test(c)));
  const doiCall = calls.find(c => /filter=doi:/.test(c)) || '';
  check('papers OpenAlex had not linked are fetched by DOI', /10\.1021\/acs\.jpclett\.2c02304/.test(doiCall) && /10\.1063\/5\.0077739/.test(doiCall) && !/10\.1080\/00268976/.test(doiCall), doiCall);
  check('full-name search runs for missing papers', calls.some(c => /raw_author_name\.search:Monosij Mondal/.test(c)));
  const vp = await page.$eval('.vpanel', p => p.innerText.replace(/\s+/g, ' '));
  check('panel sums up the check', /Checked against ORCID 0000-0003-4764-0737: 5 confirmed, 3 likely theirs, 4 not confirmed; 5 added/.test(vp), vp);
  const shown = await page.$$eval('details[data-field-group]:not([data-field-group="__aside"]) .wrow .wt', els => els.map(e => e.textContent));
  const aside = await page.$$eval('details[data-field-group="__aside"] .wrow', els => els.map(e => ({ t: e.querySelector('.wt').textContent, why: e.querySelector('.vwhy').textContent })));
  check('the other person’s papers are set aside', aside.length === 4 && aside.every(a => /collision|Positronium|cross sections|capture/i.test(a.t)) && !shown.some(t => /collision|Positronium|cross sections|capture/i.test(t)), aside.map(a => a.t).join(' | '));
  check('set-aside papers say why', aside.every(a => /Not on their ORCID record/.test(a.why) && /Ramakrishna Mission/.test(a.why) && /No co-authors in common/.test(a.why)) && aside.some(a => /“M\. Mondal”/.test(a.why)), aside[0] && aside[0].why);
  check('his unlinked papers are added', shown.includes('Strong Coupling in Infrared Plasmonic Cavities') && shown.some(t => /strong coupling” maps/.test(t)), shown.join(' | '));
  check('preprint versions shown once', shown.filter(t => /significant multi-Li\+ clustering/.test(t)).length === 1);
  check('an ORCID entry with no DOI is listed', shown.includes('A conference talk listed without a DOI'));
  check('a paper found by his full name joins only with evidence', shown.some(t => /Machine Learning Force Fields/.test(t)) && !shown.some(t => /Traitor Tracing/.test(t)));
  const rowList = await page.$$eval('.wrow', els => els.map(e => ({ t: e.querySelector('.wt').textContent, b: [...e.querySelectorAll('.badge')].map(b => b.textContent).join(','), why: (e.querySelector('.vwhy') || {}).textContent || '' })));
  const row = start => rowList.find(r => r.t.startsWith(start));
  const natureRow = row('Evidence for multi-Li+');
  check('published paper counted as likely, via shared co-authors', natureRow && /Likely theirs/.test(natureRow.b) && /Shares co-authors/.test(natureRow.why), JSON.stringify(natureRow));
  const thesis = row('Semiclassical Modeling');
  check('thesis counted as likely from his full name', thesis && /Likely theirs/.test(thesis.b) && /full name/.test(thesis.why), JSON.stringify(thesis));
  const jpcl = row('Strong Coupling in Infrared');
  check('confirmed and added papers are labelled', jpcl && /On ORCID/.test(jpcl.b) && /Added from ORCID/.test(jpcl.b), JSON.stringify(jpcl));
  const crRow = row('Evidence for significant');
  check('preprint row shows its versions', crRow && /\d versions/.test(crRow.b), JSON.stringify(crRow));
  const mstats = await page.$$eval('.ah-stats div', els => els.map(d => d.innerText.replace(/\s+/g, ' ')));
  check('header figures count only checked papers', mstats.some(x => /Works 8/.test(x)) && mstats.some(x => /Citations 63/.test(x)) && mstats.some(x => /h-index 4/.test(x)), mstats.join(' | '));
  check('header notes OpenAlex’s own totals', /OpenAlex’s own profile lists 7 works and 24 citations/.test(await page.$eval('.author-head', h => h.innerText)));
  const mbars = await page.$$eval('.fbars button', els => els.map(b => `${b.dataset.fieldJump}=${b.querySelector('.fb-n').firstChild.textContent.trim()}`));
  check('field bars count only checked papers', mbars.join(',') === 'Physics and Astronomy=4,Engineering=2,Chemistry=1,Not classified=1', mbars.join(','));
  for (const mode of ['light', 'dark']) {
    await page.evaluate(m => { document.documentElement.dataset.appearance = m; window.scrollTo(0, 0); }, mode);
    await new Promise(r => setTimeout(r, 450));
    await page.screenshot({ path: path.join(OUT, `orcid-${mode}.png`) });
    const vax = await axeRun();
    check(`ORCID check (${mode}): no WCAG A/AA violations`, vax.length === 0, vax.join(' | '));
  }
  await page.evaluate(() => { document.documentElement.dataset.appearance = 'light'; });
  await page.$eval('details[data-field-group="__aside"]', d => { d.open = true; d.scrollIntoView(); });
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: path.join(OUT, 'orcid-aside.png') });
  await tap('#verify-toggle');
  const after = await page.evaluate(() => ({ aside: !!document.querySelector('details[data-field-group="__aside"]'), warn: document.querySelectorAll('.badge.v-warn').length, label: document.querySelector('#verify-toggle').textContent }));
  check('set-aside papers can be shown again, still flagged', !after.aside && after.warn === 4 && /Hide/.test(after.label), JSON.stringify(after));
  await tap('#verify-toggle');
  check('and set aside again', await page.$$eval('details[data-field-group="__aside"] .wrow', e => e.length) === 4);
  const noOrcid = await page.evaluate(() => { const S = window.Paperscope.S; return S.search.verify.state; });
  check('verification finished', noOrcid === 'done');

  // ---------- topic pathway: byline names open authors
  await tap('.pathways [data-pathway="topic"]');
  check('Topics pathway restores the topic placeholder', /DOI/.test(await page.$eval('#q', q => q.placeholder)));
  await submit('photochemistry electron transfer');
  await page.waitForFunction(() => document.querySelectorAll('#results .paper').length > 0 && document.querySelector('#loading').hidden, { timeout: 15000 });
  const byl = await page.$$eval('#results .paper .byline', els => els.map(e => [...e.querySelectorAll('button.auth')].map(b => b.textContent)));
  check('author names on result cards are buttons', byl.some(b => b.includes('Ada Example')) && byl.some(b => b.length === 0), JSON.stringify(byl));
  await page.$eval('#results .paper .byline button.auth[data-author-name="Ada Example"]', b => b.click());
  await waitAuthor('Ada Example');
  const sw = await page.evaluate(() => ({ pw: document.querySelector('.pathways [data-pathway="author"]').getAttribute('aria-checked'), back: (document.querySelector('#trail-back') || {}).textContent || '' }));
  check('opening an author from a result switches to the Authors pathway', sw.pw === 'true');
  check('Back returns to the topic search', /Back to “photochemistry electron transfer”/.test(sw.back), sw.back);
  await tap('#trail-back');
  await page.waitForFunction(() => window.Paperscope.S.search.kind === 'search' && document.querySelectorAll('#results .paper').length > 0, { timeout: 10000 });
  check('back on the topic search with the Topics pathway', await page.$eval('.pathways [data-pathway="topic"]', b => b.getAttribute('aria-checked')) === 'true');
  check('theme map shown again for topic search', !!(await page.$('#map-holder details, #map-holder .map')));

  // ---------- DOI lookup
  calls.length = 0;
  await submit('10.5555/FOUND.1');
  await page.waitForFunction(() => document.querySelectorAll('#results .paper').length === 1 && document.querySelector('#loading').hidden, { timeout: 10000 });
  const doiView = await page.evaluate(() => ({ interp: document.querySelector('#interp').innerText, map: document.querySelector('#map-holder').innerHTML.trim(), title: document.querySelector('#results .paper h3').innerText }));
  check('a DOI in the search box opens that paper', /Paper found from its DOI/.test(doiView.interp) && calls.some(c => /\/works\/doi:10\.5555\/found\.1/.test(c)), calls.join(' | '));
  check('DOI view has no theme map', doiView.map === '');
  check('DOI search skips keyword search', !calls.some(c => /search=/.test(c)));
  calls.length = 0;
  await submit('https://doi.org/10.5555/CRONLY.1');
  await page.waitForFunction(() => document.querySelectorAll('#results .paper').length === 1 && document.querySelector('#loading').hidden, { timeout: 10000 });
  const cr = await page.evaluate(() => ({ interp: document.querySelector('#interp').innerText, title: document.querySelector('#results .paper h3').innerText }));
  check('DOI not in OpenAlex falls back to Crossref', /Crossref/.test(cr.interp) && /only Crossref knows/.test(cr.title), cr.interp);
  await submit('10.5555/missing.1');
  await page.waitForFunction(() => /No paper found/.test(document.querySelector('#interp').innerText), { timeout: 10000 });
  check('unknown DOI explains the miss', /Check the DOI/.test(await page.$eval('#interp', i => i.innerText)));

  // author example from the start screen
  await page.evaluate(() => document.querySelector('#home-link').click());
  check('home keeps the chosen pathway', await page.$eval('.pathways [data-pathway="topic"]', b => b.getAttribute('aria-checked')) === 'true');
  check('no uncaught page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
  check('no unmocked requests', !calls.some(c => c.startsWith('BLOCKED')), calls.filter(c => c.startsWith('BLOCKED')).join(' | '));

  const failed = log.filter(l => !l.ok).length;
  console.log(`\n${log.length - failed}/${log.length} author-pathway checks passed`);
  await browser.close(); server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
