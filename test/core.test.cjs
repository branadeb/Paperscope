// Unit tests for core logic. Run: node test/core.test.cjs
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const C = require('../src/core.js');
const fx = f => path.join(__dirname, 'fixtures', f);
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('PASS ', name); } catch (e) { fail++; console.log('FAIL ', name, '\n   ', e.message); } };

const cv = fs.readFileSync(fx('cv_sample.txt'), 'utf8');
const profile = C.extractProfile(cv);
const texts = arr => arr.map(x => x.text);

// ---------------------------------------------------------------- text
t('stemming merges plurals and spelling variants', () => {
  assert.strictEqual(C.stem('crystals'), C.stem('crystal'));
  assert.strictEqual(C.stem('modelling'), C.stem('modeling'));
  assert.strictEqual(C.stem('polarisation'), C.stem('polarization'));
  assert.strictEqual(C.stem('Behaviour'), C.stem('behavior'));
});
t('abstract reconstruction from inverted index', () => {
  assert.strictEqual(C.reconstructAbstract({ Experiments: [0], and: [1], basic: [2], Physics: [3], are: [4], reviewed: [5] }), 'Experiments and basic Physics are reviewed');
  assert.strictEqual(C.reconstructAbstract({ Abstract: [0], We: [1], study: [2], X: [3] }), 'We study X');
});

// ---------------------------------------------------------------- profile
t('profile: research interests found', () => {
  const i = texts(profile.interests);
  ['exciton migration', 'vibronic coupling', 'ion transport', 'molecular aggregates', 'organic semiconductor crystals'].forEach(x => assert(i.includes(x), `missing ${x} in ${i}`));
});
t('profile: methods found', () => {
  const m = texts(profile.methods);
  ['two-dimensional electronic spectroscopy', 'electrochemical impedance spectroscopy', 'redfield theory', 'hierarchical equations of motion'].forEach(x => assert(m.includes(x), `missing ${x} in ${m}`));
});
t('profile: no names, institutions, months or awards', () => {
  const all = [...texts(profile.interests), ...texts(profile.methods), ...texts(profile.areas)].join(' | ').toLowerCase();
  ['whitfield', 'lakeshore', 'northbridge', 'evanston', 'ortega', 'poster', 'fellowship', 'riverside'].forEach(x => assert(!all.includes(x), `found ${x}`));
});
t('profile: acronym glossary', () => {
  assert.deepStrictEqual(profile.glossary, { TA: 'transient absorption', '2DES': 'two-dimensional electronic spectroscopy', '2DIR': 'two-dimensional infrared spectroscopy', TRIR: 'time-resolved infrared', HEOM: 'hierarchical equations of motion', DFT: 'density functional theory', EIS: 'electrochemical impedance spectroscopy' });
});
t('profile: same result when PDF-style line wrapping splits phrases', () => {
  const wrapped = cv.split('\n').map(l => { const out = []; while (l.length > 70) { const c = l.lastIndexOf(' ', 70); out.push(l.slice(0, c)); l = l.slice(c + 1); } out.push(l); return out.join('\n'); }).join('\n');
  const p2 = C.extractProfile(wrapped);
  assert.deepStrictEqual(texts(p2.methods).sort(), texts(profile.methods).sort());
});
t('profile: a short research statement works', () => {
  const p = C.extractProfile('My lab studies how tumour cells sense mechanical confinement. We combine microfluidic devices, live-cell imaging and patch-clamp electrophysiology to study ion channels in confined cell migration.');
  const all = [...texts(p.interests), ...texts(p.methods)].join(' | ');
  assert(/confined cell migration|ion channels/.test(all), all);
  assert(/live-cell imaging|patch-clamp electrophysiology|microfluidic devices/.test(all), all);
});

// ---------------------------------------------------------------- query
t('query: acronym resolved from profile glossary', () => {
  const a = C.analyzeQuery('TA spectroscopy of perylene diimide', profile);
  assert.strictEqual(a.question, null);
  assert(/\(TA OR "transient absorption"\)/.test(a.keywordQuery), a.keywordQuery);
  assert(/transient absorption \(TA\)/.test(a.semanticQuery));
});
t('query: ambiguous acronym asks when no profile', () => {
  const a = C.analyzeQuery('TA spectroscopy', null);
  assert.strictEqual(a.question.acr, 'TA');
  assert(a.question.options.includes('transient absorption'));
});
t('query: answered acronym used', () => {
  const a = C.analyzeQuery('MD simulations of polymer electrolytes', null, { MD: 'molecular dynamics' });
  assert(/\(MD OR "molecular dynamics"\)/.test(a.keywordQuery));
});
t('query: synonym expansion with physical-science guard', () => {
  assert(/exciton \(migration OR diffusion OR transport\)/.test(C.analyzeQuery('exciton migration', null).keywordQuery));
  assert(!/diffusion/.test(C.analyzeQuery('cancer cell migration', null).keywordQuery));
});
t('query: expansions can be switched off', () => {
  const a = C.analyzeQuery('exciton migration', null, { disabledExpansions: ['transport'] });
  assert(/\(migration OR diffusion\)/.test(a.keywordQuery), a.keywordQuery);
});
t('query: expert boolean syntax passed through untouched', () => {
  const q = '"singlet fission" AND (tetracene OR pentacene) NOT review';
  assert.strictEqual(C.analyzeQuery(q, null).keywordQuery, q);
});

// ---------------------------------------------------------------- ambiguity (real OpenAlex counts, 2026-11-12)
const gb = rows => rows.map(([id, name, count]) => ({ key: `https://openalex.org/fields/${id}`, key_display_name: name, count }));
const relaxation = gb([[27, 'Medicine', 411999], [22, 'Engineering', 337316], [25, 'Materials Science', 300280], [31, 'Physics and Astronomy', 280006], [13, 'Biochemistry, Genetics and Molecular Biology', 118580], [17, 'Computer Science', 112171], [16, 'Chemistry', 100983], [33, 'Social Sciences', 93471], [32, 'Psychology', 87525], [26, 'Mathematics', 58311]]);
const fission = gb([[16, 'Chemistry', 509], [22, 'Engineering', 491], [31, 'Physics and Astronomy', 291], [25, 'Materials Science', 197], [21, 'Energy', 20], [13, 'Biochemistry', 9]]);
t('ambiguity: "relaxation" spans domains; profile picks physical sciences', () => {
  const a = C.assessFieldAmbiguity(relaxation, null); assert(a.ambiguous); assert.strictEqual(a.autoPick, null);
  const b = C.assessFieldAmbiguity(relaxation, profile); assert.strictEqual(b.autoPick.id, 3);
});
t('ambiguity: "coherence" spans domains', () => {
  const a = C.assessFieldAmbiguity(require('./mock-data.js').groupByCoherence, null);
  assert(a.ambiguous); assert.deepStrictEqual(a.options.map(o => o.id), [2, 3, 4]);
});
t('ambiguity: "singlet fission tetracene" is not ambiguous', () => { assert(!C.assessFieldAmbiguity(fission, null).ambiguous); });

// ---------------------------------------------------------------- types (real examples)
t('type: OpenAlex "article" whose abstract says "are reviewed" -> Review? (inferred)', () => {
  const ti = C.classifyType({ title: 'Exciton diffusion in organic semiconductors', abstract: 'Experiments and basic Physics of exciton diffusion in organic semiconductors are reviewed.', oaType: 'article' });
  assert.deepStrictEqual([ti.cat, ti.conf, ti.label], ['review', 'inferred', 'Review?']);
});
t('type: OpenAlex review label', () => { assert.strictEqual(C.classifyType({ title: 'Role of Ion Channels and Transporters in Cell Migration', oaType: 'review' }).conf, 'labelled'); });
t('type: book review is not a literature review', () => { const ti = C.classifyType({ title: 'Organic molecular crystals: interaction, localization, and transport phenomena', oaType: 'book-review' }); assert.strictEqual(ti.cat, 'other'); assert.strictEqual(ti.label, 'Book review'); });
t('type: arXiv preprint', () => { assert.strictEqual(C.classifyType({ title: 'Universal Framework for Decomposing Ionic Transport into Interpretable Mechanisms', oaType: 'preprint' }).cat, 'preprint'); });
t('type: dataset and software are "other"', () => { ['dataset', 'software'].forEach(x => assert.strictEqual(C.classifyType({ title: 'X', oaType: x }).cat, 'other')); });
t('type: perspective inferred from title', () => { assert.strictEqual(C.classifyType({ title: 'Caveolae and cancer: A new mechanical perspective', oaType: 'review' }).cat, 'review'); assert.strictEqual(C.classifyType({ title: 'Perspective: ultrafast spectroscopy of organic semiconductors', oaType: 'article' }).cat, 'perspective'); });
t('type: plain article stays unverified', () => { const ti = C.classifyType({ title: 'Water Permeation Drives Tumor Cell Migration in Confined Microenvironments', oaType: 'article' }); assert.deepStrictEqual([ti.cat, ti.conf], ['research', 'unverified']); });

// ---------------------------------------------------------------- dedupe
t('dedupe by DOI and by title+year across sources', () => {
  const pool = new Map();
  C.dedupeInto(pool, [C.normOpenAlex({ id: 'W1', doi: 'https://doi.org/10.1/ABC', display_name: 'A study of things', publication_year: 2020, type: 'article' }, 'oa_kw', 1)]);
  C.dedupeInto(pool, [C.normCrossref({ DOI: '10.1/abc', title: ['A study of things'], issued: { 'date-parts': [[2020]] }, abstract: '<jats:p>Hello world abstract.</jats:p>' }, 1)]);
  C.dedupeInto(pool, [C.normEPMC({ id: '1', source: 'MED', title: 'A Study of Things.', pubYear: '2020', pubTypeList: { pubType: ['Review'] } }, 1)]);
  assert.strictEqual(pool.size, 1);
  const w = [...pool.values()][0];
  assert.deepStrictEqual(w.sources, ['OpenAlex', 'Crossref', 'Europe PMC']);
  assert.strictEqual(w.abstract, 'Hello world abstract.');
  assert.strictEqual(C.classifyType(w).cat, 'review');
});

t('dedupe keeps same-title papers with different DOIs apart (real 1969 example)', () => {
  const pool = new Map();
  const T = 'Fission of singlet excitons into pairs of triplet excitons in tetracene crystals';
  C.dedupeInto(pool, [C.normOpenAlex({ id: 'a', doi: 'https://doi.org/10.1016/0009-2614(69)80144-2', display_name: T, publication_year: 1969 }, 'oa_kw', 5),
    C.normOpenAlex({ id: 'b', doi: 'https://doi.org/10.1016/0009-2614(69)80122-3', display_name: T, publication_year: 1969 }, 'oa_kw', 7)]);
  assert.strictEqual(pool.size, 2);
});

// ---------------------------------------------------------------- ranking on real titles
function liveRanking(mode) {
  const L = JSON.parse(fs.readFileSync(fx('live-exciton.json'), 'utf8'));
  const mk = (r, ch, i) => C.normOpenAlex({ id: 'x' + r[0], doi: r[4] ? 'https://doi.org/' + r[4] : null, display_name: r[0], publication_year: r[1], type: r[2], cited_by_count: r[3] }, ch, i + 1);
  const pool = new Map();
  C.dedupeInto(pool, L.keyword.map((r, i) => mk(r, 'oa_kw', i)));
  C.dedupeInto(pool, L.semantic.map((r, i) => mk(r, 'oa_sem', i)));
  const analysis = C.analyzeQuery('exciton migration in molecular crystals', profile);
  return { pool, ranked: C.rankWorks([...pool.values()], { analysis, profile, mode, nowYear: 2026 }) };
}
t('live data: keyword+semantic results merge (shared papers counted once)', () => { assert.strictEqual(liveRanking('all').pool.size, 36); });
t('live data: book review, book and dissertation stay out of the top 10', () => {
  const top = liveRanking('all').ranked.slice(0, 10).map(w => w.oaType);
  assert(!top.includes('book-review') && !top.includes('dissertation'), top.join());
});
t('live data: papers found by both searches rank near the top', () => {
  const r = liveRanking('all').ranked; const both = r.filter(w => w.ranks.oa_kw && w.ranks.oa_sem).map(w => r.indexOf(w));
  assert(Math.max(...both) < 12, JSON.stringify(both));
});
t('live data: every top-10 explanation is grounded in the title', () => {
  const { ranked } = liveRanking('close');
  const analysis = C.analyzeQuery('exciton migration in molecular crystals', profile);
  ranked.slice(0, 10).forEach(w => {
    const ex = C.explain(w, { analysis, profile, hasProfile: true });
    ex.reasons.filter(r => r.kind === 'query' && /^Title mentions/.test(r.text)).forEach(r => {
      r.text.replace(/^Title mentions /, '').replace(/\.$/, '').split(/, | and /).forEach(term => {
        assert(C.hasPhrase(C.stems(w.title), C.stems(term)), `"${term}" not in "${w.title}"`);
      });
    });
    assert(ex.note.startsWith('No abstract'), 'missing no-abstract note');
  });
});

// ---------------------------------------------------------------- grounding property test
t('evidence quotes are always verbatim substrings of the abstract (500 random abstracts)', () => {
  const vocab = 'exciton migration diffusion transport molecular crystal crystals energy we measure show that the of in and spectroscopy ultrafast charge ion channels cells model theory results reveal coupling'.split(' ');
  let seed = 7; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const analysis = C.analyzeQuery('exciton migration in molecular crystals', profile);
  for (let k = 0; k < 500; k++) {
    const sents = []; const ns = 1 + Math.floor(rnd() * 5);
    for (let s = 0; s < ns; s++) { const n = 4 + Math.floor(rnd() * 60); const ws = []; for (let i = 0; i < n; i++) ws.push(vocab[Math.floor(rnd() * vocab.length)]); ws[0] = ws[0][0].toUpperCase() + ws[0].slice(1); sents.push(ws.join(' ') + '.'); }
    const abstract = sents.join(' ');
    const w = { key: 'k' + k, title: 'T', abstract, abstractFrom: 'test', authors: [], ranks: { oa_kw: 1 }, keywords: [] };
    C.rankWorks([w], { analysis, profile, mode: 'all' });
    const ex = C.explain(w, { analysis, profile, hasProfile: true });
    if (ex.evidence) assert(abstract.includes(ex.evidence.text), ex.evidence.text);
  }
});

// ---------------------------------------------------------------- scholar comparison and export
t('Scholar paste parsing strips [PDF]/[HTML] markers and matches titles', () => {
  const lines = C.parseScholarLines('[PDF] Exciton diffusion in organic semiconductors\n[HTML][HTML] Visualization of exciton transport in ordered and disordered molecular solids\nshort');
  assert.strictEqual(lines.length, 2);
  const r = C.compareWithList(lines, [{ title: 'Visualization of exciton transport in ordered and disordered molecular solids', key: 'a' }]);
  assert.deepStrictEqual(r.map(x => x.found), [false, true]);
});
t('exports are well-formed', () => {
  const w = { title: 'A & B {test}', authors: ['Ann Lee', 'Bo Chen'], year: 2020, venue: 'J. Test', doi: '10.1/x', landing: 'https://doi.org/10.1/x', typeInfo: { cat: 'research', label: 'Article', conf: 'unverified' }, isOA: false, cites: 3 };
  const bib = C.toBibTeX([w]);
  assert(/^@article\{Lee2020test,/.test(bib) && /title = \{A \\& B test\}/.test(bib), bib);
  assert(/TY  - JOUR[\s\S]*ER  - $/.test(C.toRIS([w])));
  assert.strictEqual(C.toCSV([w]).split('\n').length, 2);
});

// ---------------------------------------------------------------- step 1
t('related terms: frequent result keywords not already in the query', () => {
  const analysis = C.analyzeQuery('exciton migration', null);
  const mk = (kw, i) => ({ key: 'k' + i, keywords: kw });
  const r = C.relatedTerms([mk(['exciton diffusion', 'singlet fission'], 1), mk(['singlet fission', 'organic semiconductors'], 2), mk(['organic semiconductors', 'excitons'], 3), mk(['quantum dots'], 4)], analysis);
  assert.deepStrictEqual(r.map(x => x.text).sort(), ['organic semiconductors', 'singlet fission']);
});
t('ORCID iD: format and checksum', () => {
  assert.strictEqual(C.normOrcid('https://orcid.org/0000-0002-1825-0097'), '0000-0002-1825-0097');
  assert.strictEqual(C.normOrcid('0000000218250097'), '0000-0002-1825-0097');
  assert.strictEqual(C.normOrcid('0000-0002-1825-0098'), null);
  assert.strictEqual(C.normOrcid('0000-0001-5109-018x'), '0000-0001-5109-018X'); // checksum digit X
});
t('profile from publications: keywords, subfields, acronyms', () => {
  const M = require('./mock-data.js');
  const p = C.profileFromWorks(M.orcidWorks, { source: 'test' });
  const all = [...p.interests, ...p.methods, ...p.areas].map(x => x.text);
  ['ion transport', 'spectral diffusion', 'physical and theoretical chemistry'].forEach(x => assert(all.includes(x), `${x} missing: ${all}`));
  assert.strictEqual(p.glossary['2DIR'], 'two-dimensional infrared spectroscopy');
});
t('merging profiles keeps both sets without duplicates', () => {
  const m = C.mergeProfiles({ interests: [{ text: 'ion transport' }], methods: [], areas: [], glossary: { A: 'a' }, source: 'cv' }, { interests: [{ text: 'Ion transport' }, { text: 'excitons' }], methods: [{ text: 'raman' }], areas: [], glossary: { B: 'b' }, source: 'orcid' });
  assert.deepStrictEqual(m.interests.map(x => x.text), ['ion transport', 'excitons']);
  assert.deepStrictEqual(Object.keys(m.glossary), ['A', 'B']);
});
t('answer prompt numbers every abstract and forbids outside knowledge', () => {
  const pr = C.buildAnswerPrompt('Why?', [{ title: 'T1', year: 2020, abstract: 'A1.' }, { title: 'T2', year: 2021, abstract: 'A2.' }]);
  assert(/\[1\] T1 \(2020\)\. Abstract: A1\./.test(pr.user) && /\[2\] T2/.test(pr.user) && /ONLY/.test(pr.system) && /outside knowledge/.test(pr.system));
});
t('answer check flags uncited sentences and unknown citations', () => {
  const c = C.checkAnswer('A is true [1]. B is true [2-3]. C holds in every system ever studied. The abstracts do not cover D. E [7].', 3);
  assert.deepStrictEqual([c.uncited, c.invalid, c.cited], [1, [7], [1, 2, 3]]);
});
t('sorting by date keeps weakly relevant papers below relevant ones', () => {
  const w = (y, q) => ({ year: y, date: `${y}-01-01`, cites: y, rank: { qrel: q }, ranks: {} });
  const sorted = C.sortWorks([w(2010, 0.9), w(2026, 0.1), w(2020, 0.8)], 'newest');
  assert.deepStrictEqual(sorted.map(x => x.year), [2020, 2010, 2026]);
});
t('related-term matches raise a paper and are explained', () => {
  const analysis = C.analyzeQuery('exciton migration', null, { related: ['singlet fission'] });
  const a = { key: 'a', title: 'Exciton migration and singlet fission', abstract: '', authors: [], ranks: { oa_kw: 2 }, keywords: [] };
  const b = { key: 'b', title: 'Exciton migration in crystals', abstract: '', authors: [], ranks: { oa_kw: 1 }, keywords: [] };
  const r = C.rankWorks([a, b], { analysis, profile: null, mode: 'all' });
  assert(a.rank.relHits.length === 1 && a.rank.qrel > b.rank.qrel - 0.05);
  assert(C.explain(a, { analysis }).reasons.some(x => /related term “singlet fission”/.test(x.text)));
});


// ---------------------------------------------------------------- ORCID cross-check (modelled on a real merged OpenAlex profile)
const rec = C.parseOrcidRecord(JSON.parse(fs.readFileSync(fx('orcid-record-mondal.json'), 'utf8')));
t('ORCID record: name, organisations and works with DOIs', () => {
  assert.strictEqual(rec.orcid, '0000-0003-4764-0737');
  assert.strictEqual(rec.given, 'Monosij'); assert.strictEqual(rec.family, 'Mondal');
  assert.deepStrictEqual(rec.orgs.sort(), ['Columbia University', 'University of Pennsylvania']);
  assert.strictEqual(rec.works.length, 6);
  assert.deepStrictEqual(rec.works[4].dois, ['10.1080/00268976.2016.1142126']);
  assert.strictEqual(rec.works[5].dois.length, 0);
  const item = C.normOrcidWork(rec.works[5], 1);
  assert.strictEqual(item.crType, 'proceedings-article'); assert.strictEqual(item.year, 2021);
});
t('preprint versions share a version key', () => {
  assert.strictEqual(C.versionKey('10.26434/chemrxiv-2025-ndqzk/v4'), '10.26434/chemrxiv-2025-ndqzk');
  assert.strictEqual(C.versionKey('10.26434/chemrxiv-2025-ndqzk-v2'), '10.26434/chemrxiv-2025-ndqzk');
  assert.strictEqual(C.versionKey('https://doi.org/10.1063/5.0077739'), '10.1063/5.0077739');
});
t('name forms: full, initial only, other person', () => {
  const P = [{ given: 'Monosij', family: 'Mondal', others: [] }];
  assert.strictEqual(C.nameForm('Monosij Mondal', P), 'full');
  assert.strictEqual(C.nameForm('Mondal, Monosij', P), 'full');
  assert.strictEqual(C.nameForm('M. Mondal', P), 'initial');
  assert.strictEqual(C.nameForm('M Mondal', P), 'initial');
  assert.strictEqual(C.nameForm('Mintu Mondal', P), 'variant');
  assert.strictEqual(C.nameForm('Arup Mondal', P), 'other');
  assert.strictEqual(C.nameForm('José Pérez', [{ given: 'Jose', family: 'Perez' }]), 'full');
});
t('verification separates two people merged into one profile', () => {
  const ME = 'https://openalex.org/A5084327602';
  const sh = (id, name, raw, inst = [], orcid = '') => ({ id, name, raw, orcid, inst });
  const w = (key, title, year, doi, field, ships) => ({ key, title, year, doi, topic: field ? { field } : null, ships, authors: ships.map(x => x.name), ranks: { oa_author: 1 } });
  const nitzan = sh('A1', 'Abraham Nitzan', 'Abraham Nitzan'), ochoa = sh('A2', 'Maicol A. Ochoa', 'Maicol A. Ochoa');
  const lab = ['James Stevenson', 'Garvit Agarwal', 'Leif D. Jacobson', 'Richard A. Friesner'].map((n, i) => sh('B' + i, n, n));
  const works = [
    // in OpenAlex's profile
    w('nature', 'Evidence for multi-Li+ clustering in lithium-ion battery electrolytes', 2026, '10.1038/s41586-026-11138-7', 'Engineering', [lab[0], lab[1], sh(ME, 'M. Mondal', 'Monosij Mondal', ['Columbia University']), lab[2], lab[3]]),
    w('molphys', 'A state-specific multi-reference coupled-cluster approach with a cost-effective treatment of connected triples: implementation to geometry optimisation', 2016, '10.1080/00268976.2016.1142126', 'Physics and Astronomy', [sh('C1', 'Debi Banerjee', 'Debi Banerjee'), sh(ME, 'M. Mondal', 'Monosij Mondal', ['Indian Institute of Engineering Science and Technology, Shibpur'])]),
    w('thesis', 'Semiclassical Modeling of Optical Properties of Molecules in Cavity Environments', 2023, '', 'Physics and Astronomy', [sh(ME, 'M. Mondal', 'Mondal, Monosij')]),
    w('coll1', 'Electron capture and excitation in He+ + He collisions at intermediate and high energies', 2025, '10.1103/wktq-w1zb', 'Physics and Astronomy', [sh('D1', 'B. Mandal', 'B. Mandal'), sh('D2', 'T.K. Mistry', 'T.K. Mistry'), sh(ME, 'M. Mondal', 'M. Mondal', ['Ramakrishna Mission Residential College']), sh('D3', 'Malay Purkait', 'Malay Purkait')]),
    w('coll2', 'Positronium formation in collisions of positron with water and methane molecules', 2025, '10.1088/1402-4896/adefa1', 'Physics and Astronomy', [sh(ME, 'M. Mondal', 'M Mondal', ['Ramakrishna Mission Residential College']), sh('D2', 'T.K. Mistry', 'T.K. Mistry'), sh('D3', 'Malay Purkait', 'Malay Purkait')]),
    // added from ORCID (OpenAlex had not linked them: author id is empty, ORCID on the authorship)
    w('jpcl', 'Strong Coupling in Infrared Plasmonic Cavities', 2022, '10.1021/acs.jpclett.2c02304', 'Physics and Astronomy', [sh('', 'Monosij Mondal', 'Monosij Mondal', [], '0000-0003-4764-0737'), ochoa, nitzan]),
    w('chemrxiv', 'Evidence for significant multi-Li+ clustering in common lithium-ion battery electrolytes', 2025, '10.26434/chemrxiv-2025-ndqzk-v2', 'Engineering', [lab[0], lab[1], sh('', 'Monosij Mondal', 'Monosij Mondal', [], '0000-0003-4764-0737'), lab[2], lab[3]]),
  ];
  const ev = { persons: [{ given: rec.given, family: rec.family, others: [] }], ids: new Set([ME]), orcids: new Set([rec.orcid]),
    orcidDOIs: new Set(rec.works.flatMap(x => x.dois.map(C.versionKey))), orcidWorks: rec.works, crossrefDOIs: new Set(), orgs: rec.orgs };
  const r = C.verifyAuthorWorks(works, ev);
  const st = k => r.get(k).status;
  assert.strictEqual(st('molphys'), 'orcid'); assert.strictEqual(st('jpcl'), 'orcid'); assert.strictEqual(st('chemrxiv'), 'orcid');
  assert.strictEqual(st('nature'), 'likely', JSON.stringify(r.get('nature')));
  assert(/co-authors/.test(r.get('nature').why[0]));
  assert.strictEqual(st('thesis'), 'likely', JSON.stringify(r.get('thesis')));
  assert(/full name/.test(r.get('thesis').why[0]));
  assert.strictEqual(st('coll1'), 'unconfirmed'); assert.strictEqual(st('coll2'), 'unconfirmed');
  const why = r.get('coll1').why.join(' | ');
  assert(/Not on their ORCID record/.test(why) && /“M\. Mondal”/.test(why) && /Ramakrishna Mission/.test(why) && /No co-authors in common/.test(why), why);
  // publisher-tagged ORCID iDs count as confirmation too
  const r2 = C.verifyAuthorWorks(works, { ...ev, orcidDOIs: new Set(), orcidWorks: [], crossrefDOIs: new Set(['10.1021/acs.jpclett.2c02304']) });
  assert.strictEqual(r2.get('jpcl').status, 'publisher');
});
t('with nothing to compare against, full names count and nothing is set aside', () => {
  const ev = { persons: [{ given: 'Monosij', family: 'Mondal', others: [] }], ids: new Set(['X']), orcids: new Set(), orcidDOIs: new Set(), orcidWorks: [], crossrefDOIs: new Set(), orgs: [] };
  const r = C.verifyAuthorWorks([{ key: 'a', title: 'T', ships: [{ id: 'X', name: 'M. Mondal', raw: 'Monosij Mondal', inst: [] }], authors: [] },
    { key: 'b', title: 'U', ships: [{ id: 'X', name: 'M. Mondal', raw: 'M. Mondal', inst: [] }], authors: [] }], ev);
  assert.strictEqual(r.get('a').status, 'likely'); assert.strictEqual(r.get('b').status, 'unconfirmed');
});
t('preprint versions collapse to one entry', () => {
  const mk = (key, doi, year, inProfile) => ({ key, doi, year, ranks: inProfile ? { oa_author: 1 } : { oa_orcid: 1 } });
  const v = C.collapseVersions([mk('a', '10.26434/chemrxiv-2025-ndqzk-v2', 2025), mk('b', '10.26434/chemrxiv-2025-ndqzk/v4', 2026), mk('c', '10.1063/5.0077739', 2022)]);
  assert.deepStrictEqual([...v.hide], ['a']); assert.strictEqual(v.count.get('b'), 2);
});
t('h-index from citation counts', () => {
  assert.strictEqual(C.hIndex([10, 8, 5, 4, 3]), 4); assert.strictEqual(C.hIndex([]), 0); assert.strictEqual(C.hIndex([0, 0]), 0);
});
t('OpenAlex works keep authorship detail for the check', () => {
  const x = C.normOpenAlex({ id: 'W1', display_name: 'T', authorships: [{ author: { id: 'https://openalex.org/A1', display_name: 'M. Mondal', orcid: 'https://orcid.org/0000-0003-4764-0737' }, raw_author_name: 'Monosij Mondal', institutions: [{ display_name: 'Columbia University' }] }] }, 'oa_author', 1);
  assert.deepStrictEqual(x.ships[0], { id: 'https://openalex.org/A1', name: 'M. Mondal', raw: 'Monosij Mondal', orcid: '0000-0003-4764-0737', inst: ['Columbia University'] });
});

console.log(`\n${pass}/${pass + fail} unit tests passed`);
process.exit(fail ? 1 : 0);
