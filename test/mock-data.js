// Synthetic, clearly fake test records shaped like OpenAlex / Crossref / Europe PMC responses.
// DOIs use the 10.5555 test prefix. Used only by the UI test harness, never shipped.
'use strict';
const inv = text => { const o = {}; text.split(/\s+/).forEach((w, i) => { (o[w] = o[w] || []).push(i); }); return o; };
const topic = (id, name, field, fieldId, subfield) => ({ id: `https://openalex.org/T${id}`, display_name: name, subfield: { display_name: subfield }, field: { id: `https://openalex.org/fields/${fieldId}`, display_name: field }, domain: { display_name: 'Physical Sciences' } });
const T = {
  oe: topic(10045, 'Organic Electronics and Photovoltaics', 'Engineering', 22, 'Electrical and Electronic Engineering'),
  ph: topic(11129, 'Photochemistry and Electron Transfer Studies', 'Chemistry', 16, 'Physical and Theoretical Chemistry'),
  ps: topic(10200, 'Photosynthetic Processes and Mechanisms', 'Biochemistry, Genetics and Molecular Biology', 13, 'Molecular Biology'),
  pv: topic(10067, 'Perovskite Materials and Applications', 'Materials Science', 25, 'Materials Chemistry'),
  qd: topic(10300, 'Quantum Dots Synthesis And Properties', 'Materials Science', 25, 'Materials Chemistry'),
  ml: topic(10400, 'Machine Learning in Materials Science', 'Computer Science', 17, 'Artificial Intelligence'),
  sp: topic(10500, 'Spectroscopy and Quantum Chemical Studies', 'Chemistry', 16, 'Spectroscopy'),
};
let n = 0;
function work({ title, abs, year, type = 'article', t, cites = 10, oa = false, kw = [], retracted = false, venue = 'Journal of Test Chemistry', pct }) {
  n++;
  return {
    id: `https://openalex.org/W9${String(n).padStart(6, '0')}`, doi: `https://doi.org/10.5555/ps.${n}`, display_name: title, publication_year: year,
    publication_date: `${year}-01-01`, type, cited_by_count: cites,
    authorships: [{ author: { display_name: `Test Author ${n}A` } }, { author: { display_name: `Test Author ${n}B` } }],
    primary_location: { landing_page_url: `https://doi.org/10.5555/ps.${n}`, raw_type: 'journal-article', source: { display_name: venue } },
    best_oa_location: oa ? { landing_page_url: `https://repository.example.org/ps${n}`, pdf_url: `https://repository.example.org/ps${n}.pdf`, source: { display_name: 'Example Repository' } } : null,
    open_access: { is_oa: oa, oa_status: oa ? 'green' : 'closed', oa_url: oa ? `https://repository.example.org/ps${n}` : null },
    primary_topic: t, keywords: kw.map(k => ({ display_name: k, score: 0.9 })),
    abstract_inverted_index: abs ? inv(abs) : null,
    citation_normalized_percentile: pct == null ? null : { value: pct, is_in_top_1_percent: pct > 0.99, is_in_top_10_percent: pct > 0.9 },
    is_retracted: retracted,
  };
}
const kwWorks = [
  work({ title: 'Exciton migration in molecular crystals of perylene diimide', abs: 'We measure exciton migration in molecular crystals of perylene diimide using transient absorption microscopy. Diffusion lengths reach 200 nm along the stacking axis. The results link crystal packing to exciton transport.', year: 2023, t: T.oe, cites: 40, kw: ['exciton diffusion', 'organic semiconductors'], pct: 0.95 }),
  work({ title: 'Exciton diffusion in organic semiconductors: a review', abs: 'Experiments and basic physics of exciton diffusion in organic semiconductors are reviewed. We summarize recent measurement methods.', year: 2015, t: T.oe, cites: 1000, kw: ['exciton diffusion'], pct: 0.997, venue: 'Energy Test Science' }),
  work({ title: 'Long-range exciton transport in ordered molecular crystals', abs: 'Ordered molecular crystals support long-range exciton transport. We image the spreading of excitons with femtosecond resolution and model the dynamics with a Redfield approach.', year: 2021, t: T.oe, cites: 120, oa: true, kw: ['exciton transport'], pct: 0.9 }),
  work({ title: 'Vibronic coupling controls energy transfer in molecular aggregates', abs: 'Vibronic coupling shapes energy transfer in molecular aggregates. Two-dimensional electronic spectroscopy reveals coherent oscillations. Hierarchical equations of motion reproduce the spectra.', year: 2024, t: T.sp, cites: 15, kw: ['vibronic coupling', 'energy transfer'] }),
  work({ title: 'Singlet fission in tetracene crystals', abs: 'Singlet fission produces two triplet excitons in tetracene crystals. Triplet migration limits device efficiency.', year: 2019, t: T.ph, cites: 300, kw: ['singlet fission'] }),
  work({ title: 'Perspective: the future of exciton transport in molecular crystals', abs: 'In this perspective we discuss open questions about exciton transport in molecular crystals and outline opportunities for new spectroscopies.', year: 2025, t: T.oe, cites: 3 }),
  work({ title: 'Light harvesting in photosynthetic complexes: excitation energy migration', abs: 'Photosynthetic antenna complexes channel excitation energy to reaction centres. Energy migration occurs within picoseconds across chlorophyll networks.', year: 2022, t: T.ps, cites: 80, oa: true, kw: ['photosynthesis'] }),
  work({ title: 'Ion migration in halide perovskite crystals', abs: 'Ion migration in halide perovskite crystals causes hysteresis. We quantify vacancy diffusion with impedance spectroscopy.', year: 2024, t: T.pv, cites: 25, kw: ['ion migration'] }),
  work({ title: 'Energy transfer between quantum dots in close-packed films', abs: 'Close-packed quantum dot films show fast energy transfer between dots. Transient absorption maps the migration of excitons.', year: 2025, t: T.qd, cites: 2 }),
  work({ title: 'Machine learning prediction of exciton diffusion lengths', abs: 'A graph neural network predicts exciton diffusion lengths of molecular crystals from structure, enabling high-throughput screening.', year: 2025, t: T.ml, cites: 4, type: 'preprint' }),
  work({ title: 'Charge transport in organic semiconductor crystals', abs: 'Charge transport in organic semiconductor crystals is limited by dynamic disorder. We combine theory and measurement.', year: 2020, t: T.oe, cites: 210, oa: true }),
  work({ title: 'Retracted: exciton migration measured by a flawed method', abs: 'Exciton migration in molecular crystals was measured with a method later found to be flawed.', year: 2018, t: T.oe, cites: 12, retracted: true }),
  work({ title: 'Triplet exciton diffusion in rubrene single crystals', abs: null, year: 2011, t: T.oe, cites: 400, pct: 0.98 }),
  work({ title: 'Recent advances in perovskite quantum dots', abs: 'Perovskite quantum dots have advanced rapidly. This review covers synthesis, stability and devices.', year: 2023, t: T.pv, cites: 90, type: 'review' }),
  work({ title: 'Delocalized exciton migration in self-assembled nanofibers', abs: 'Self-assembled nanofibers of perylene diimide show delocalized exciton migration over micrometres.', year: 2024, t: T.oe, cites: 18, oa: true }),
  work({ title: 'Ultrafast polaron formation in conjugated polymers', abs: 'Polarons form within 100 fs in conjugated polymers. Broadband transient absorption tracks the formation.', year: 2022, t: T.sp, cites: 33 }),
  work({ title: 'Exciton-phonon coupling in two-dimensional semiconductors', abs: 'Exciton-phonon coupling governs linewidths in two-dimensional semiconductors.', year: 2021, t: topic(10600, '2D Materials and Applications', 'Materials Science', 25, 'Materials Chemistry'), cites: 60 }),
  work({ title: 'Molecular crystal packing and polymorphism', abs: 'Polymorphism changes packing motifs in molecular crystals and alters optical properties.', year: 2017, t: T.ph, cites: 70 }),
];
const semWorks = [
  kwWorks[2], kwWorks[0],
  work({ title: 'Energy flow through disordered organic solids imaged at the nanoscale', abs: 'We image energy flow through disordered organic solids at the nanoscale. Excitation spreading is subdiffusive.', year: 2017, t: T.oe, cites: 150, oa: true }),
  work({ title: 'Coherent energy transport in molecular semiconductors', abs: 'Coherent transport of excitation energy persists in molecular semiconductors at room temperature.', year: 2023, t: T.sp, cites: 22 }),
  kwWorks[3], kwWorks[6],
  work({ title: 'Dynamic disorder and excitation spreading in organic crystals', abs: 'Dynamic disorder sets the regime of excitation spreading in organic crystals.', year: 2015, t: T.oe, cites: 95 }),
];
const crossref = [
  { DOI: '10.5555/ps.1', title: [kwWorks[0].display_name], type: 'journal-article', issued: { 'date-parts': [[2023]] }, 'container-title': ['Journal of Test Chemistry'], author: [{ given: 'Test', family: 'Author 1A' }], 'is-referenced-by-count': 41 },
  { DOI: '10.5555/xr.900', title: ['Exciton migration in crystalline organic films studied by photoluminescence quenching'], type: 'journal-article', issued: { 'date-parts': [[2016]] }, 'container-title': ['Crossref Test Journal'], author: [{ given: 'Cross', family: 'Ref' }], 'is-referenced-by-count': 30, abstract: '<jats:p>Photoluminescence quenching reveals exciton migration in crystalline organic films.</jats:p>' },
  { DOI: '10.5555/xr.901', title: ['Molecular crystals: an editorial'], type: 'journal-article', issued: { 'date-parts': [[2020]] }, 'container-title': ['Crossref Test Journal'], author: [], 'is-referenced-by-count': 0 },
];
const epmc = [
  { id: 'PMC1', source: 'PMC', doi: '10.5555/ps.3', title: kwWorks[2].display_name + '.', pubYear: '2021', authorString: 'Author A, Author B.', abstractText: 'x', pubTypeList: { pubType: ['review-article', 'Review', 'Journal Article'] }, isOpenAccess: 'Y', citedByCount: 5, journalInfo: { journal: { title: 'Test J' } } },
  { id: '999', source: 'MED', doi: '10.5555/ep.77', title: 'Exciton migration in chlorophyll aggregates.', pubYear: '2019', authorString: 'Bio A.', abstractText: 'Chlorophyll aggregates show exciton migration relevant to photosynthesis.', pubTypeList: { pubType: ['Journal Article'] }, isOpenAccess: 'N', citedByCount: 7, journalInfo: { journal: { title: 'Bio Test J' } } },
];
const groupByPhysical = [
  { key: 'https://openalex.org/fields/16', key_display_name: 'Chemistry', count: 5000 }, { key: 'https://openalex.org/fields/31', key_display_name: 'Physics and Astronomy', count: 4000 },
  { key: 'https://openalex.org/fields/25', key_display_name: 'Materials Science', count: 3000 }, { key: 'https://openalex.org/fields/13', key_display_name: 'Biochemistry, Genetics and Molecular Biology', count: 300 },
];
// Real OpenAlex group_by counts for search=coherence (fetched 2026-11-12).
const groupByCoherence = [
  { key: 'https://openalex.org/fields/33', key_display_name: 'Social Sciences', count: 363946 }, { key: 'https://openalex.org/fields/31', key_display_name: 'Physics and Astronomy', count: 294832 },
  { key: 'https://openalex.org/fields/27', key_display_name: 'Medicine', count: 272307 }, { key: 'https://openalex.org/fields/12', key_display_name: 'Arts and Humanities', count: 208463 },
  { key: 'https://openalex.org/fields/17', key_display_name: 'Computer Science', count: 190573 }, { key: 'https://openalex.org/fields/22', key_display_name: 'Engineering', count: 145513 },
  { key: 'https://openalex.org/fields/32', key_display_name: 'Psychology', count: 79898 }, { key: 'https://openalex.org/fields/14', key_display_name: 'Business, Management and Accounting', count: 68915 },
  { key: 'https://openalex.org/fields/28', key_display_name: 'Neuroscience', count: 58110 }, { key: 'https://openalex.org/fields/23', key_display_name: 'Environmental Science', count: 48642 },
];
module.exports = { kwWorks, semWorks, crossref, epmc, groupByPhysical, groupByCoherence };
