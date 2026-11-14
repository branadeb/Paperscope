// Unit checks for the Lab's taste learning and night-sky layout. Run: node test/lab-core.test.cjs
'use strict';
const assert = require('assert'); const C = require('../lab/src/core.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('PASS ', name); };
const items = [...Array(40)].map((_, i) => ({ key: 'k' + i, field: ['Chemistry', 'Physics and Astronomy', 'Engineering', 'Materials Science', 'Biochemistry, Genetics and Molecular Biology'][i % 5], cites: i * 7, date: '20' + (10 + i % 15) }));
t('sky: same papers give the same sky, whatever the order', () => {
  const a = C.skyLayout(items), b = C.skyLayout(items.slice().reverse());
  assert.deepStrictEqual(a.stars.map(s => [s.key, s.x, s.y]).sort(), b.stars.map(s => [s.key, s.x, s.y]).sort());
});
t('sky: every star inside the frame, one line fewer than stars per constellation', () => {
  for (const [W, H] of [[360, 440], [720, 400]]) {
    const a = C.skyLayout(items, { W, H });
    assert(a.stars.every(s => s.x > 0 && s.x < W && s.y > 0 && s.y < H));
    assert.strictEqual(a.lines.length, 40 - 5); assert.strictEqual(a.labels.length, 5);
  }
});
t('sky: read-later papers are faint and not joined into constellations', () => {
  const a = C.skyLayout([{ key: 'a', field: 'Chemistry' }, { key: 'b', field: 'Chemistry', faint: true }, { key: 'c', field: 'Chemistry' }]);
  assert.strictEqual(a.stars.filter(s => s.faint).length, 1); assert.strictEqual(a.lines.length, 1);
  assert.deepStrictEqual(a.labels.map(l => [l.count, l.later]), [[2, 1]]);
});
t('sky: brighter stars for more-cited papers', () => {
  const a = C.skyLayout([{ key: 'x', field: 'F', cites: 0 }, { key: 'y', field: 'F', cites: 5000 }]);
  assert(a.stars.find(s => s.key === 'y').r > a.stars.find(s => s.key === 'x').r);
});
t('taste: keeping a paper nudges similar ones up, skipping undoes it', () => {
  const k = C.learnTaste({}, { title: 'Exciton migration in molecular crystals' }, 1);
  assert(C.tasteBonus({ title: 'Exciton transport' }, k) > 0); assert.strictEqual(C.tasteBonus({ title: 'Unrelated words here' }, k), 0);
  assert.strictEqual(Object.keys(C.learnTaste(k, { title: 'Exciton migration in molecular crystals' }, -1)).length, 0);
  assert(Math.abs(C.tasteBonus({ title: 'exciton migration molecular crystals' }, C.learnTaste({}, { title: 'exciton migration molecular crystals' }, 6))) <= 0.08);
});
t('taste: stop words and numbers are ignored; words shown as written', () => {
  const terms = C.tasteTerms({ title: 'The role of 2D materials in the 2025 study of crystals' }).map(x => x.word);
  assert(!terms.includes('the') && !terms.includes('2025') && terms.includes('crystals'));
  const top = C.topTaste(C.learnTaste({}, { title: 'Perovskite solar cells' }, 1));
  assert.deepStrictEqual(top.liked.sort(), ['cells', 'perovskite', 'solar']);
});
t('papers of the day: topics go to Crossref in short groups, each word once, topics first', () => {
  const terms = C.todayTerms(null, 'exciton diffusion, transient absorption, perylene diimide, organic semiconductor crystals, singlet fission, two-dimensional electronic spectroscopy, charge transfer, ion transport');
  const qs = C.todayQueries(terms); const all = qs.join(' ').split(' ');
  assert(qs.length > 1 && qs.every(q => q.split(' ').length <= 7), qs.join(' | '));
  assert.strictEqual(new Set(all).size, all.length);
  assert(qs[0].startsWith('exciton diffusion transient absorption perylene diimide'));
  ['ion', 'transport', 'fission'].forEach(w => assert(all.includes(w), w));
  assert.deepStrictEqual(C.todayQueries([{ text: 'a very long topic made of many many different words', kind: 'interest' }, { text: 'b2', kind: 'interest' }]), ['long topic made many words b2']);
});
t('papers of the day: an umbrella topic also counts related wording; far-apart words do not', () => {
  const terms = C.todayTerms(null, 'ultrafast spectroscopy');
  assert(C.todayRelated(terms).includes('transient absorption') && C.todayRelated(terms).includes('femtosecond spectroscopy'));
  const ws = [['Ordered Atomic Channels Enable Ultrafast Hydrogen Spillover', 'Ultrafast spillover happens. In situ Raman spectroscopy confirms it.'],
    ['Photoexcited charge dynamics in plasmonic copper', 'Femtosecond transient absorption spectroscopy tracks hot carriers.'],
    ['Excited-state dynamics of a dye', 'We use pump–probe measurements.'], ['Ultrafast vibrational spectroscopy of water', null]].map(([title, abstract]) => ({ title, abstract, doi: title }));
  const r = C.rankToday(ws, terms).map(x => x.w.title);
  assert.deepStrictEqual(r.slice().sort(), ['Excited-state dynamics of a dye', 'Photoexcited charge dynamics in plasmonic copper', 'Ultrafast vibrational spectroscopy of water']);
});
t('papers of the day: one topic alone is not discounted for being common', () => {
  const terms = C.todayTerms(null, 'charge transfer');
  const ws = [...Array(10)].map((_, i) => ({ title: `Charge transfer in system ${i}`, doi: 'd' + i }));
  assert.strictEqual(C.rankToday(ws, terms).length, 10);
});
t('papers of the day: corrections and cover pages are not papers', () => {
  const terms = C.todayTerms(null, 'ion transport');
  const ws = ['Author Correction: Ion transport in pores', 'Publisher Correction: Ion transport', 'Directional Confinement Governed Ion Transport for Efficient Actuation (Adv. Mater. 63/2026)', 'Ion transport in nanoconfined membranes', 'Ion transport (in 2D) across graphene'].map(title => ({ title, doi: title }));
  assert.deepStrictEqual(C.rankToday(ws, terms).map(x => x.w.title), ['Ion transport in nanoconfined membranes', 'Ion transport (in 2D) across graphene']);
});
// ---------------- scoring v2
const W = (title, abstract, ranks) => Object.assign({ key: title, title, abstract: abstract || '', ranks: ranks || { oa_kw: 1 }, year: 2024, cites: 10 });
const rank = (q, works, opts = {}) => C.rankWorks(works, Object.assign({ analysis: C.analyzeQuery(q, null), profile: null, mode: 'all', nowYear: 2026 }, opts));
t('v2: chemical notation keeps charges and formulas', () => {
  assert.deepStrictEqual(C.tokens('SCN⁻ and Fe²⁺ in MoS₂; anion- and Li+ ions'), ['SCN-', 'and', 'Fe2+', 'in', 'MoS2', 'anion', 'and', 'Li+', 'ions']);
  assert.deepStrictEqual(C.stems('SCN⁻ Fe²⁺ MoS₂ CdS spectroscopies'), ['scn-', 'fe2+', 'mos2', 'cds', 'spectroscopy']);
  const r = rank('SCN⁻ exchange', [W('Thiocyanate SCN− exchange in membranes'), W('Exchange of SeCN− ions')]);
  assert.strictEqual(r[0].title, 'Thiocyanate SCN− exchange in membranes');
});
t('v2: synonyms by level; exciton migration = diffusion, ion migration is only related', () => {
  const ion = C.analyzeQuery('ion migration', null).groups[1].alts; const exc = C.analyzeQuery('exciton migration', null).groups[1].alts;
  assert.strictEqual(ion.find(a => a.text === 'diffusion').tier, 'related'); assert.strictEqual(exc.find(a => a.text === 'diffusion').tier, 'same');
  const r = rank('ion migration in membranes', [W('Ion diffusion in membranes'), W('Ion migration in membranes')]);
  assert.strictEqual(r[0].title, 'Ion migration in membranes'); assert(r[0].rank.q > r[1].rank.q);
});
t('v2: a paper missing a specific idea ranks below one that has them all, and says what is missing', () => {
  const works = [W('Anion transport in hydrated membranes', 'We study anion transport.'), W('Ion-pair exchange controls anion transport in ordered membranes', 'Ion-pair exchange kinetics.')];
  const r = rank('ion-pair exchange anion transport membranes', works);
  assert.strictEqual(r[0].title, works[1].title);
  assert(r[1].rank.missing.includes('ion-pair') || r[1].rank.missing.includes('exchange'), JSON.stringify(r[1].rank.missing));
  const ex = C.explain(r[1], { analysis: C.analyzeQuery('ion-pair exchange anion transport membranes', null) });
  assert(ex.reasons.some(x => x.kind === 'missing' && /Does not mention/.test(x.text)));
  const prof = C.extractProfile('Research interests: singlet fission; organic semiconductors. Methods: transient absorption spectroscopy.');
  const all = rank('ion-pair exchange anion transport membranes', works.map(w => Object.assign({}, w, { _prep: null })), { mode: 'all', profile: prof });
  const adj = rank('ion-pair exchange anion transport membranes', works.map(w => Object.assign({}, w, { _prep: null })), { mode: 'adjacent', profile: prof });
  assert(adj.find(w => w.title === works[0].title).rank.q > all.find(w => w.title === works[0].title).rank.q, 'adjacent mode is more forgiving');
});
t('v2: an idea every candidate mentions counts less than a rare one', () => {
  const works = [...Array(8)].map((_, i) => W(`Membranes study ${i}`)).concat([W('Thiocyanate probes in water')]);
  const gs = C.groupStats(works, C.analyzeQuery('membranes thiocyanate', null));
  assert(gs[1].w > gs[0].w, JSON.stringify(gs));
});
t('v2: words together count more than words far apart', () => {
  const r = rank('anion exchange membrane', [W('Membrane water uptake and anion conductivity under exchange of humidity'), W('Anion exchange membrane conductivity')]);
  assert.strictEqual(r[0].title, 'Anion exchange membrane conductivity');
});
t('v2 is the default; v1 is still available for comparison', () => {
  assert.strictEqual(rank('exciton', [W('Exciton')])[0].rank.scoring, 'v2');
  assert.strictEqual(rank('exciton', [W('Exciton')], { scoring: 'v1' })[0].rank.scoring, 'v1');
});
t('benchmark: nDCG, precision and judged share', () => {
  const g = { a: 3, b: 0, c: 2, d: 1 };
  assert.strictEqual(C.ndcgAt(['a', 'c', 'd', 'b'], g), 1);
  assert(C.ndcgAt(['b', 'd', 'c', 'a'], g) < 0.7);
  assert.strictEqual(C.precisionAt(['a', 'c', 'x', 'y', 'b'], g, 5), 0.4);
  assert.strictEqual(C.judgedAt(['a', 'x'], g, 10), 0.5);
});
t('orbit: shared phrases across saved papers; for one paper, its title and repeated phrases', () => {
  const now = Date.now();
  const a = { title: 'Exciton diffusion in perylene diimide crystals', abstract: 'We measure exciton diffusion in perylene diimide single crystals with transient absorption microscopy.', savedAt: new Date(now).toISOString() };
  const b = { title: 'Singlet fission and exciton diffusion in perylene diimide films', abstract: 'Transient absorption microscopy reveals exciton diffusion.', savedAt: new Date(now - 400 * 864e5).toISOString() };
  const both = C.orbitTerms([a, b]).map(t => t.text);
  assert.deepStrictEqual(both.slice(0, 2).sort(), ['exciton diffusion', 'perylene diimide']); assert(both.includes('transient absorption microscopy'));
  assert(!both.some(x => / in /.test(x)), 'no phrases across stop words');
  const one = C.orbitTerms([{ title: 'Exciton diffusion in organic semiconductors', abstract: 'The basic physics is reviewed.' }]).map(t => t.text);
  assert(one.includes('exciton diffusion') && one.includes('organic semiconductors') && !one.includes('reviewed'), one.join(','));
});
t('more like this: papers sharing phrases and found by several routes rank first', () => {
  const terms = C.orbitTerms([{ title: 'Exciton diffusion in organic semiconductors', abstract: '' }]);
  const r = C.rankLike([{ key: 'a', title: 'Unrelated polymer rheology', ranks: { like_sem: 1 } }, { key: 'b', title: 'Exciton diffusion lengths in organic semiconductors', ranks: { like_sem: 2, like_rel: 1 } }], { terms });
  assert.strictEqual(r[0].key, 'b'); assert.deepStrictEqual(r[0].rank.shared.sort(), ['exciton diffusion', 'organic semiconductors']);
});
t('AI check: prompt lists papers by number; replies are parsed strictly', () => {
  const { system, user } = C.buildCheckPrompt('exciton diffusion', [{ title: 'A', abstract: 'x' }, { title: 'B' }]);
  assert(/grade/.test(system) && /^Search: exciton diffusion/.test(user) && /\[2\] B/.test(user) && /none; judge from the title/.test(user));
  const m = C.parseCheck('1 | 3 | Direct\n[2] - 0 - unrelated\n9 | 2 | out of range\n1 | 0 | duplicate\nnoise', 2);
  assert.deepStrictEqual([...m.entries()], [[1, { grade: 3, reason: 'Direct' }], [2, { grade: 0, reason: 'unrelated' }]]);
});
console.log(`\n${n}/${n} Lab unit checks passed`);
