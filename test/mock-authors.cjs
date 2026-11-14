// Mock OpenAlex, ORCID and Crossref data for author-pathway tests and screenshots (synthetic, plus a case modelled on a real merged profile).
'use strict';
const path = require('path');
const fs = require('fs');
const M = require('./mock-data.js');
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

// Responds to any external request a page makes; returns false if the host is not mocked.
function respond(req) {
  const u = new URL(req.url());
  if (req.method() === 'OPTIONS') { req.respond({ status: 204, headers: CORS }); return true; }
  if (u.hostname === 'api.openalex.org') { mockOpenAlex(req, u); return true; }
  if (u.hostname === 'pub.orcid.org') {
    if (u.pathname === `/v3.0/${MORCID}/record`) json(req, MREC);
    else if (u.pathname === '/v3.0/0000-0002-1825-0097/record') json(req, { 'orcid-identifier': { path: '0000-0002-1825-0097' }, person: { name: { 'given-names': { value: 'Ada' }, 'family-name': { value: 'Example' } } }, 'activities-summary': { works: { group: [] } } });
    else json(req, { 'response-code': 404 }, 404);
    return true;
  }
  if (u.hostname === 'api.crossref.org' && /filter=orcid/.test(decodeURIComponent(u.search))) { json(req, { message: { 'total-results': 0, items: decodeURIComponent(u.search).includes(MORCID) ? CR_ORCID : [] } }); return true; }
  if (u.hostname === 'api.crossref.org') {
    if (u.pathname.startsWith('/works/')) {
      const doi = decodeURIComponent(u.pathname.slice(7)).toLowerCase();
      if (doi === '10.5555/cronly.1') json(req, { message: { DOI: '10.5555/cronly.1', title: ['A paper only Crossref knows about'], type: 'journal-article', author: [{ given: 'Di', family: 'Crossref' }], issued: { 'date-parts': [[2018]] }, 'container-title': ['Crossref Test Letters'], URL: 'https://doi.org/10.5555/cronly.1', 'is-referenced-by-count': 3 } });
      else json(req, { status: 'error', message: 'Resource not found.' }, 404);
      return true;
    }
    json(req, { message: { items: M.crossref || [], 'total-results': 0 } }); return true;
  }
  if (u.hostname === 'www.ebi.ac.uk') { json(req, { hitCount: 0, resultList: { result: [] } }); return true; }
  return false;
}
module.exports = { CORS, json, mockOpenAlex, respond, MREC, MORCID, CR_ORCID };
