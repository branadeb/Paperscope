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
console.log(`\n${n}/${n} Lab unit checks passed`);
