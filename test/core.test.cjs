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

console.log(`\n${pass}/${pass + fail} unit tests passed`);
process.exit(fail ? 1 : 0);
