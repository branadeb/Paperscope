/* Paperscope core logic: text processing, profile extraction, query analysis,
 * source normalisation, de-duplication, ranking, explanations and themes.
 * No DOM and no network access here, so everything can be unit-tested in Node. */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- text utils
  const STOP = new Set(('a about above after again against all also am an and any are as at be because been before being below ' +
    'between both but by can could did do does doing down during each either et etc few for from further had has have having he ' +
    'her here hers him his how however i if in into is it its itself just may me might more most must my no nor not now of off on ' +
    'once only or other our ours out over own per same she should so some such than that the their theirs them then there these ' +
    'they this those through thus to too under until up upon us very via was we were what when where which while who whom why will ' +
    'with within without would you your yours vs versus toward towards among amongst whether i.e e.g ie eg').split(/\s+/));

  // Words that carry no research content in a CV (treated as phrase delimiters).
  const CV_NOISE = new Set(('university universities department dept institute institution college school faculty laboratory ' +
    'center centre email e-mail mail phone tel fax address street road avenue suite usa u.s.a india china germany japan korea uk ' +
    'england france canada italy spain january february march april june july august september october november december jan feb ' +
    'mar apr jun jul aug sep sept oct nov dec present current phd ph.d ph d bsc msc ms ma ba bs mphil postdoc postdoctoral fellow ' +
    'fellowship fellowships award awards awarded prize grant grants scholarship scholar honors honours advisor adviser advisors ' +
    'supervisor supervisors mentor mentors mentoring mentee teaching assistant instructor course courses curriculum vitae cv resume ' +
    'references reference publications publication manuscript manuscripts submitted preparation press accepted journal journals ' +
    'conference conferences symposium meeting meetings poster posters talk talks invited oral presentation presentations seminar ' +
    'seminars workshop workshops society american national international annual proceedings vol volume pp page pages issue doi ' +
    'http https www org edu com al editor editors reviewer reviewers service committee member membership skills languages english ' +
    'citizen citizenship gpa grade thesis dissertation title year years month months research experience education employment ' +
    'position positions summary objective profile contact interests interest selected peer-reviewed peer reviewed first author ' +
    'corresponding co-author coauthor authors author highlights cited citations h-index google orcid linkedin github website ' +
    'nature communications letters reports advances acs rsc wiley elsevier springer chem phys lett commun rev sci mater angew ' +
    'chemie jacs nat proc pnas usa physical review j. et inc ltd llc co project projects responsible responsibilities led lead ' +
    'developed develop developing work worked working various several including include includes currently recent recently ' +
    'student students undergraduate graduate visiting assistant associate professor lecturer dr prof mr ms mrs').split(/\s+/));

  // Generic verbs and framing words that end a research phrase ("we combine X", "my lab studies Y").
  const VERB_STOP = new Set(('study studies studying studied combine combines combining combined investigate investigates investigating ' +
    'explore explores exploring examine examines examining use uses using apply applies applying develop develops focus focuses ' +
    'focusing aim aims seek seeks understand understanding reveal reveals show shows sense senses lab group team interested ' +
    'employ employs employing measure measures leverage leverages enable enables address addresses probe probes elucidate ' +
    'elucidates characterize characterise determine determines design designs').split(/\s+/));

  // Single words that are too generic to stand alone as a research interest.
  const GENERIC_SINGLE = new Set(('physical chemical biological molecular material materials science sciences engineering ' +
    'applied advanced high low large small single multiple various different novel new state states dynamics properties property ' +
    'system systems structure structures study studies analysis method methods technique techniques approach approaches model ' +
    'models design data results result effect effects role function functions process processes control based using application ' +
    'applications development understanding mechanism mechanisms theory experimental experiments experiment level levels type types ' +
    'order energy time field fields phase rate rates use high-throughput insights insight towards first part').split(/\s+/));

  const NUMWORDS = { one: '1', two: '2', three: '3', four: '4', five: '5' };

  const WORD_RE = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;
  // Chemical notation: superscript and subscript digits become plain digits, and a charge sign right after a formula
  // stays on the token, so SCN⁻ is "scn-", Fe²⁺ is "fe2+" and MoS₂ is "mos2" (and they are not stemmed).
  const SUPSUB = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '⁺': '+', '⁻': '-', '₊': '+', '₋': '-' };
  const chemNorm = s => String(s || '').replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹₀-₉⁺⁻₊₋]/g, c => SUPSUB[c]).replace(/([A-Za-z0-9])\u2212/g, '$1-');
  const TOKEN_RE = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*(?:[+-](?=$|[\s,.;:)\]/]))?/gu;
  const FORMULA_RE = /^(?:[A-Z][a-z]?\d*)+$/;
  function tokens(text) {
    return (chemNorm(text).match(TOKEN_RE) || []).map(t => { const c = t.slice(-1); return (c === '+' || c === '-') && !FORMULA_RE.test(t.slice(0, -1)) ? t.slice(0, -1) : t; });
  }

  function normSpace(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  function stem(w) {
    let s = String(w).toLowerCase().replace(/[’']/g, '');
    if (/[+-]$/.test(s) || (/\d/.test(s) && /[a-z]/.test(s) && s.length <= 10 && !s.includes('-'))) return s; // formulas, ions: as written
    if (s.length > 4 && s.endsWith('ies')) s = s.slice(0, -3) + 'y';
    else if (s.endsWith('sses')) s = s.slice(0, -2);
    else if (s.length > 3 && s.endsWith('s') && !/(ss|us|is|ys)$/.test(s)) s = s.slice(0, -1);
    if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
    else if (s.length > 4 && s.endsWith('ed') && !s.endsWith('eed')) s = s.slice(0, -2);
    // British/American spelling variants that matter for matching
    s = s.replace(/isation$/, 'ization').replace(/ise$/, 'ize').replace(/our$/, 'or').replace(/lling$/, 'ling').replace(/lled$/, 'led');
    if (s === 'modell') s = 'model';
    return s;
  }

  function words(text) { return tokens(text); }
  function stems(text) { return words(text).map(stem); }
  function contentStems(text) { return words(text).filter(w => !STOP.has(w.toLowerCase())).map(stem); }
  // Stems of a phrase with leading/trailing stop words removed (inner ones kept, e.g. "equations of motion").
  function phraseStems(text) {
    const ws = words(text);
    while (ws.length && STOP.has(ws[0].toLowerCase())) ws.shift();
    while (ws.length && STOP.has(ws[ws.length - 1].toLowerCase())) ws.pop();
    return ws.map(stem);
  }

  // Find a stemmed phrase (array) inside a stemmed token array.
  function hasPhrase(hay, needle) {
    if (!needle.length || needle.length > hay.length) return false;
    outer: for (let i = 0; i <= hay.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
      return true;
    }
    return false;
  }
  function hasAll(haySet, needle) { return needle.every(t => haySet.has(t)); }

  function splitSentences(text) {
    const t = normSpace(text);
    if (!t) return [];
    // Split on sentence-final punctuation followed by space + capital/digit; keep abbreviations reasonably intact.
    const parts = t.split(/(?<=[.!?])\s+(?=[A-Z0-9(“"])/);
    return parts.map(s => s.trim()).filter(Boolean);
  }

  function cleanDoi(d) {
    if (!d) return '';
    return String(d).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:/i, '').toLowerCase();
  }

  function normTitle(t) {
    return String(t || '').toLowerCase().replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function stripTags(s) {
    if (!s) return '';
    return normSpace(String(s).replace(/<jats:title>[^<]*<\/jats:title>/gi, ' ').replace(/<[^>]+>/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  }

  function reconstructAbstract(inv) {
    if (!inv || typeof inv !== 'object') return '';
    const arr = [];
    for (const [w, pos] of Object.entries(inv)) for (const p of pos) arr[p] = w;
    let s = normSpace(arr.filter(x => x !== undefined).join(' '));
    s = s.replace(/^(abstract|summary)\s*[:.]?\s+/i, '');
    return s;
  }

  // ---------------------------------------------------------------- vocabularies
  const METHOD_STEMS = new Set(['spectroscopy', 'spectroscopie', 'spectrometry', 'microscopy', 'crystallography', 'diffraction',
    'scattering', 'imag', 'tomography', 'interferometry', 'calorimetry', 'chromatography', 'electrophoresi', 'sequenc', 'assay',
    'simulation', 'model', 'modeling', 'calculation', 'theory', 'theoretical', 'computational', 'computation', 'dft', 'tddft', 'nmr',
    'epr', 'esr', 'xrd', 'xp', 'xps', 'ftir', 'raman', 'pcr', 'qpcr', 'crispr', 'elisa', 'cytometry', 'regression', 'survey', 'interview',
    'ethnography', 'meta-analysi', 'statistic', 'statistical', 'bayesian', 'learn', 'algorithm', 'optimization', 'fabrication',
    'synthesi', 'lithography', 'deposition', 'voltammetry', 'impedance', 'pump-probe', 'time-resolv', 'ultrafast', 'femtosecond',
    'picosecond', '2dir', '2d-ir', '2de', '2dev', 'trir', 'heom', 'redfield', 'dynamics-simulation', 'photoluminescence', 'fluorescence',
    'microfluidic', 'electrochemical', 'patch-clamp', 'afm', 'stm', 'tem', 'sem', 'neural', 'network', 'monte', 'carlo', 'ab', 'initio',
    'ab-initio', 'spectroelectrochemistry', 'magnetometry', 'rheology', 'ellipsometry', 'metabolomic', 'proteomic', 'transcriptomic',
    'genomic', 'kinetic', 'quantum-chemical', 'measurement', 'characterization', 'transient', 'absorption-spectroscopy']);
  const METHOD_PHRASES = [['machine', 'learn'], ['deep', 'learn'], ['molecular', 'dynamic'], ['density', 'functional'],
    ['transient', 'absorption'], ['mass', 'spectrometry'], ['flow', 'cytometry'], ['open', 'quantum', 'system'],
    ['quantum', 'chemistry'], ['electronic', 'structure'], ['equation', 'of', 'motion'], ['single', 'molecule'], ['x-ray']];

  const AREAS = ['chemistry', 'physics', 'biology', 'biochemistry', 'biophysics', 'physical chemistry', 'chemical physics',
    'materials science', 'condensed matter physics', 'condensed matter', 'photochemistry', 'photophysics', 'nanoscience',
    'nanotechnology', 'neuroscience', 'immunology', 'genetics', 'genomics', 'ecology', 'epidemiology', 'economics', 'psychology',
    'sociology', 'linguistics', 'public health', 'medicine', 'oncology', 'cancer biology', 'cell biology', 'molecular biology',
    'structural biology', 'computational chemistry', 'theoretical chemistry', 'quantum information', 'quantum information science',
    'polymer science', 'soft matter', 'organic chemistry', 'inorganic chemistry', 'analytical chemistry', 'catalysis',
    'environmental science', 'climate science', 'computer science', 'data science', 'mathematics', 'chemical engineering',
    'electrical engineering', 'mechanical engineering', 'bioengineering', 'biomedical engineering', 'pharmacology',
    'microbiology', 'virology', 'cognitive science', 'political science', 'anthropology', 'philosophy', 'astrophysics', 'optics',
    'photonics', 'spin chemistry', 'electrochemistry', 'materials chemistry', 'surface science', 'statistical mechanics',
    'quantum optics', 'atomic physics', 'plasma physics', 'geochemistry', 'geophysics', 'oceanography', 'education research',
    'organic electronics', 'energy storage', 'energy science', 'chemical biology', 'bioinformatics', 'systems biology']
    .map(a => stems(a));

  // Curated synonyms, by level: "same" (spelling variants and true equivalents), "related" (close but not the same
  // thing, e.g. conductivity and conductance), "broader" (only for finding more). Deterministic, small, shown to the user.
  const SYN_DEF = [
    ['related', ['migration', 'diffusion', 'transport']], ['related', ['mechanism', 'pathway']], ['related', ['synthesis', 'fabrication', 'preparation']],
    ['related', ['degradation', 'decomposition']], ['same', ['modeling', 'modelling']], ['related', ['modeling', 'simulation']], ['same', ['behavior', 'behaviour']], ['same', ['color', 'colour']],
    ['same', ['tumor', 'tumour']], ['related', ['tumor', 'cancer']], ['same', ['metastasis', 'metastatic']], ['same', ['heart attack', 'myocardial infarction']],
    ['same', ['elderly', 'older adults']], ['same', ['children', 'pediatric', 'paediatric']], ['same', ['solar cell', 'photovoltaic']],
    ['related', ['ultrafast', 'femtosecond', 'time-resolved']], ['related', ['global warming', 'climate change']],
    ['same', ['covid-19', 'sars-cov-2']], ['same', ['nanoconfinement', 'nanoconfined']], ['related', ['nanoconfinement', 'nanochannel']], ['same', ['photocatalysis', 'photocatalytic']],
    ['same', ['well-being', 'wellbeing']], ['same', ['socioeconomic', 'socio-economic']], ['related', ['students', 'learners']], ['related', ['teacher', 'educator']],
    ['related', ['conductivity', 'conductance']], ['same', ['fiber', 'fibre']], ['same', ['center', 'centre']],
    ['same', ['anemia', 'anaemia']], ['same', ['estrogen', 'oestrogen']], ['same', ['optimization', 'optimisation']], ['same', ['ionization', 'ionisation']],
    ['same', ['crystallization', 'crystallisation']], ['same', ['polarization', 'polarisation']], ['same', ['aluminum', 'aluminium']], ['same', ['sulfur', 'sulphur']],
    ['related', ['charge separation', 'charge transfer']], ['broader', ['excitation energy transfer', 'energy transfer']], ['same', ['qubit', 'quantum bit']],
    ['related', ['decoherence', 'dephasing']], ['same', ['vibronic coupling', 'electron-vibration coupling']], ['related', ['drug delivery', 'drug carrier']],
    ['same', ['wastewater', 'waste water']], ['related', ['deep learning', 'neural network']], ['same', ['large language model', 'llm']],
    ['same', ['crystal', 'crystalline']], ['same', ['catalyst', 'catalysis', 'catalytic']],
    ['same', ['2dir', '2d ir', '2d-ir', 'two-dimensional infrared']], ['same', ['2des', '2d electronic spectroscopy', 'two-dimensional electronic spectroscopy']],
    ['same', ['perylene diimide', 'perylene bisimide']], ['same', ['anion-exchange membrane', 'anion exchange membrane']],
  ];
  const SYNONYMS = SYN_DEF.map(([tier, g]) => Object.assign(g.map(t => ({ text: t, stems: stems(t) })), { tier }));
  const TIER_W = { same: 1, related: 0.7, broader: 0.45 };
  // Exciton migration and exciton diffusion are used interchangeably; ion migration (field-driven) and ion diffusion are not.
  const SYN_SAME_AFTER = new Map([['migration', ['exciton', 'energy', 'triplet', 'singlet', 'polaron', 'excitation']]]);
  // Some synonym groups only make sense in a physical-science context ("cell migration" is not "cell diffusion").
  const SYN_GUARD = new Map([['migration', ['exciton', 'ion', 'charge', 'energy', 'electron', 'hole', 'proton', 'polaron', 'lithium', 'sodium', 'molecular', 'molecule', 'atom', 'defect', 'vacancy', 'triplet', 'singlet']]]);

  // Acronyms with their common senses. Ambiguous ones (more than one sense) trigger a short question.
  const ACRONYMS = {
    TA: ['transient absorption', 'teaching assistant', 'tannic acid', 'thermal analysis'],
    MD: ['molecular dynamics', 'muscular dystrophy'], ML: ['machine learning', 'monolayer'],
    PL: ['photoluminescence', 'programming language'], CT: ['charge transfer', 'computed tomography'],
    PD: ["Parkinson's disease", 'photodetector'], AD: ["Alzheimer's disease", 'atopic dermatitis'],
    SF: ['singlet fission', 'science fiction'], PDI: ['perylene diimide', 'polydispersity index', 'protein disulfide isomerase'],
    PBI: ['perylene bisimide', 'polybenzimidazole'], DFT: ['density functional theory', 'discrete Fourier transform'],
    MS: ['mass spectrometry', 'multiple sclerosis'], PET: ['positron emission tomography', 'polyethylene terephthalate'],
    SEM: ['scanning electron microscopy', 'structural equation modeling'], CI: ['conical intersection', 'confidence interval', 'configuration interaction'],
    PES: ['potential energy surface', 'photoelectron spectroscopy'], ICT: ['intramolecular charge transfer', 'information and communication technology'],
    RL: ['reinforcement learning'], EET: ['excitation energy transfer'], CNT: ['carbon nanotube'], QD: ['quantum dot'],
    NMR: ['nuclear magnetic resonance'], EIS: ['electrochemical impedance spectroscopy'], MOF: ['metal-organic framework'],
    COF: ['covalent organic framework'], LLM: ['large language model'], NLP: ['natural language processing'],
    CNN: ['convolutional neural network'], GNN: ['graph neural network'], PCR: ['polymerase chain reaction'],
    PEG: ['polyethylene glycol'], SEI: ['solid electrolyte interphase'], OPV: ['organic photovoltaic'],
    OLED: ['organic light-emitting diode'], AFM: ['atomic force microscopy'], TEM: ['transmission electron microscopy'],
    XRD: ['X-ray diffraction'], EPR: ['electron paramagnetic resonance'], TADF: ['thermally activated delayed fluorescence'],
    '2DES': ['two-dimensional electronic spectroscopy'], '2DIR': ['two-dimensional infrared spectroscopy'],
    '2D-IR': ['two-dimensional infrared spectroscopy'], HEOM: ['hierarchical equations of motion'],
    FRET: ['Förster resonance energy transfer'], TCSPC: ['time-correlated single photon counting'],
    STM: ['scanning tunneling microscopy'], XPS: ['X-ray photoelectron spectroscopy'], SNR: ['signal-to-noise ratio'],
    RNA: ['ribonucleic acid'], DNA: ['deoxyribonucleic acid'],
  };
  const NO_EXPAND = new Set(['RNA', 'DNA']); // so common that expansion only adds noise

  // OpenAlex fields (ASJC-based) and their domains.
  const FIELD_DOMAIN = { 11: 'Life', 13: 'Life', 24: 'Life', 28: 'Life', 30: 'Life', 12: 'Social', 14: 'Social', 18: 'Social',
    20: 'Social', 32: 'Social', 33: 'Social', 15: 'Physical', 16: 'Physical', 17: 'Physical', 19: 'Physical', 21: 'Physical',
    22: 'Physical', 23: 'Physical', 25: 'Physical', 26: 'Physical', 31: 'Physical', 27: 'Health', 29: 'Health', 34: 'Health',
    35: 'Health', 36: 'Health' };
  // Words that suggest a profile belongs to a field (used only to resolve ambiguous queries).
  const FIELD_HINTS = {
    16: 'chemistry chemical molecule molecular spectroscopy synthesis catalysis photochemistry electrochemistry crystal polymer organic inorganic redox solvent',
    31: 'physics quantum optical optics laser photon spectroscopy coherence spin condensed ultrafast exciton photonics semiconductor magnetic',
    25: 'materials semiconductor crystal polymer thin film nanomaterial device membrane electrolyte perovskite',
    22: 'engineering device fabrication sensor circuit mechanical electrical',
    13: 'protein gene genetic cell molecular biology biochemistry enzyme dna rna genome',
    11: 'plant ecology agriculture animal species biodiversity',
    24: 'immune immunology microbiology bacteria virus infection pathogen',
    28: 'neuroscience neuron brain neural synaptic cognitive',
    27: 'clinical patient medicine disease cancer tumor therapy hospital diagnosis',
    30: 'drug pharmacology toxicology pharmaceutical',
    17: 'computer algorithm software machine learning neural network data computing',
    26: 'mathematics theorem algebra topology equation proof',
    32: 'psychology cognitive behavior behaviour emotion mental',
    33: 'social sociology policy education society political communication',
    12: 'history philosophy literature art language linguistics',
    14: 'business management marketing accounting organization',
    20: 'economics finance market econometric',
    19: 'earth geology climate atmosphere ocean planetary',
    23: 'environmental pollution water ecosystem sustainability',
    21: 'energy battery fuel solar power storage',
    15: 'chemical engineering reactor process separation',
  };

  // ---------------------------------------------------------------- profile extraction
  const SECTION_RE = /^(research\s+)?(interests?|areas of (research|expertise)|expertise|research summary|summary|profile|research statement|statement|research focus|focus|research experience|experience|projects?|technical skills|skills|techniques|methods|expertise and skills|publications?|selected publications|papers|education|awards?|honou?rs?|teaching|service|presentations?|talks|grants?|funding|references|patents?|employment|appointments?|professional experience|mentoring|outreach|languages|contact|leadership|memberships?|affiliations?)\b/i;
  function sectionWeight(h) {
    const s = h.toLowerCase();
    if (/interest|expertise|summary|profile|statement|focus/.test(s)) return 3;
    if (/skill|technique|method/.test(s)) return 2.5;
    if (/experience|project/.test(s)) return 2;
    if (/publication|paper|patent|presentation|talk/.test(s)) return 1.2;
    if (/education/.test(s)) return 0.8;
    return 0.3; // awards, teaching, service, references, contact …
  }

  function initialsOf(word) {
    const w = word.toLowerCase();
    if (w === 'two-dimensional') return ['2d', 'td'];
    if (w === 'three-dimensional') return ['3d', 'td'];
    if (w === 'infrared') return ['i', 'ir'];
    if (w === 'ultraviolet') return ['u', 'uv'];
    const parts = w.split(/[-–]/).filter(Boolean);
    const opts = new Set();
    opts.add((NUMWORDS[parts[0]] || parts[0][0]));
    if (parts.length > 1) opts.add(parts.map(p => NUMWORDS[p] || p[0]).join(''));
    return [...opts];
  }

  // Finds "long form (ACR)" definitions in free text.
  function extractGlossary(text) {
    const out = {};
    const re = /\(([A-Z0-9][A-Za-z0-9-]{1,7})\)/g;
    let m;
    while ((m = re.exec(text))) {
      const acr = m[1];
      if (!/[A-Z]/.test(acr) || acr.replace(/[^A-Z0-9]/g, '').length < 2) continue;
      const t0 = acr.toLowerCase().replace(/-/g, '');
      const targets = new Set([t0, t0.replace(/s$/, '')]);
      const before = text.slice(Math.max(0, m.index - 120), m.index).replace(/\s+$/, '');
      const ws = before.match(WORD_RE) || [];
      for (let n = 1; n <= Math.min(8, ws.length); n++) {
        const span = ws.slice(ws.length - n);
        if (STOP.has(span[0].toLowerCase())) continue;
        // build all initial-combinations (small)
        let combos = [''];
        for (const w of span) {
          const ini = initialsOf(w);
          const next = [];
          if (STOP.has(w.toLowerCase()) && w.length <= 3) next.push(...combos); // e.g. "of" may or may not appear in the acronym
          for (const c of combos) for (const i of ini) next.push(c + i);
          combos = next.slice(0, 64);
        }
        // the acronym often leaves out a trailing head noun: "two-dimensional infrared spectroscopy (2DIR)"
        let alt = [];
        const lastLo = span[span.length - 1].toLowerCase();
        if (span.length > 1 && /^(spectroscopy|microscopy|spectrometry|method|technique|theory|model|analysis|measurements?|experiments?)$/.test(lastLo)) {
          alt = [''];
          for (const w of span.slice(0, -1)) {
            const ini = initialsOf(w); const next = [];
            if (STOP.has(w.toLowerCase()) && w.length <= 3) next.push(...alt);
            for (const c of alt) for (const i of ini) next.push(c + i);
            alt = next.slice(0, 64);
          }
        }
        if (combos.some(c => targets.has(c)) || alt.some(c => targets.has(c))) {
          const long = span.join(' ');
          if (!out[acr] && long.length > acr.length) out[acr] = long.replace(/^[A-Z][a-z]/, s => s.toLowerCase());
          break;
        }
      }
    }
    return out;
  }

  function classifyPhrase(st) {
    const joined = st.join(' ');
    for (const a of AREAS) if (a.length && (joined === a.join(' ') || (st.length > a.length && joined.endsWith(' ' + a.join(' '))))) return 'areas';
    if (st.some(t => METHOD_STEMS.has(t))) return 'methods';
    for (const p of METHOD_PHRASES) if (hasPhrase(st, p)) return 'methods';
    return 'interests';
  }

  function extractProfile(rawText, opts = {}) {
    const text = String(rawText || '')
      .replace(/\u00ad/g, '').replace(/[ﬁ]/g, 'fi').replace(/[ﬂ]/g, 'fl').replace(/(\w)-\n(\w)/g, '$1$2')
      .replace(/\r/g, '');
    const glossary = extractGlossary(text.replace(/\n(?=[a-z(])/g, ' '));
    // Re-join lines that were wrapped mid-phrase (common in PDF text): no closing punctuation, next line starts lower-case.
    const rawLines = text.split('\n');
    const lines = [];
    for (const l of rawLines) {
      const prev = lines[lines.length - 1];
      if (prev !== undefined && prev.trim() && !/[.;:!?]\s*$/.test(prev) && /^\s*[a-z(]/.test(l) && !SECTION_RE.test(prev.trim())) lines[lines.length - 1] = prev.replace(/-$/, '') + (prev.endsWith('-') ? '' : ' ') + l.trim();
      else lines.push(l);
    }
    // Name tokens: first non-empty short line is usually the person's name.
    const nameTokens = new Set();
    const firstLine = lines.find(l => l.trim());
    if (firstLine && words(firstLine).length <= 6) words(firstLine).forEach(w => nameTokens.add(w.toLowerCase()));
    (opts.excludeNames || []).forEach(n => words(n).forEach(w => nameTokens.add(w.toLowerCase())));

    const cand = new Map(); // key -> {stems, surfaces: Map, score, count}
    // A pasted research statement has no CV headings: treat all of it as describing research interests.
    const hasHeadings = lines.some(l => { const tr = l.trim(); return tr && words(tr).length <= 6 && SECTION_RE.test(tr.replace(/^[^\p{L}]+/u, '')); });
    let weight = opts.defaultWeight || (hasHeadings ? 2 : 3);
    const add = (seq, w) => {
      const st = seq.map(stem);
      const key = st.join(' ');
      let c = cand.get(key);
      if (!c) { c = { stems: st, surfaces: new Map(), score: 0, count: 0, maxW: 0 }; cand.set(key, c); }
      const surf = seq.map(x => (/^[A-Z0-9-]{2,}$/.test(x) && /[A-Z]/.test(x)) || /\d/.test(x) && /[A-Za-z]/.test(x) ? x : x.toLowerCase()).join(' ');
      c.surfaces.set(surf, (c.surfaces.get(surf) || 0) + 1);
      if (seq.length === 1) { if (/^\p{Lu}\p{Ll}/u.test(seq[0])) c.cap = (c.cap || 0) + 1; else c.lower = (c.lower || 0) + 1; }
      const bonus = seq.length === 1 ? 1 : seq.length === 2 ? 1.6 : seq.length === 3 ? 1.9 : 2;
      c.score += w * bonus; c.count += 1; c.maxW = Math.max(c.maxW, w);
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const lw = words(trimmed);
      if (lw.length <= 6 && SECTION_RE.test(trimmed.replace(/^[^\p{L}]+/u, ''))) { weight = sectionWeight(trimmed); continue; }
      // tokenise keeping punctuation as delimiters
      const toks = trimmed.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu) || [];
      let seq = [];
      const flush = () => {
        if (seq.length) {
          if (seq.length <= 4) add(seq, weight);
          else for (let n = 2; n <= 3; n++) for (let i = 0; i + n <= seq.length; i++) add(seq.slice(i, i + n), weight * 0.6);
        }
        seq = [];
      };
      for (let k = 0; k < toks.length; k++) {
        const t = toks[k];
        const lo = t.toLowerCase();
        const isWord = /[\p{L}\p{N}]/u.test(t);
        if (lo === 'of' && seq.length && seq.length < 3) {
          const nx = toks[k + 1] || '';
          const nlo = nx.toLowerCase();
          if (/[\p{L}]/u.test(nx) && !STOP.has(nlo) && !CV_NOISE.has(nlo) && !nameTokens.has(nlo) && nx[0] === nx[0].toLowerCase()) { seq.push(t); continue; }
        }
        const isYearOrNum = /^\d+([.,]\d+)?$/.test(t);
        const tooShort = t.length < 2 && !/\d/.test(t);
        if (!isWord || STOP.has(lo) || CV_NOISE.has(lo) || VERB_STOP.has(lo) || isYearOrNum || tooShort || nameTokens.has(lo) || /@|\.(com|edu|org)$/.test(lo)) { flush(); continue; }
        seq.push(t);
      }
      flush();
    }

    let list = [...cand.values()].filter(c => {
      if (c.stems.length === 1) {
        const s = c.stems[0];
        if (GENERIC_SINGLE.has(s) || GENERIC_SINGLE.has(s + 's')) return false;
        const surf = [...c.surfaces.keys()][0];
        const isAcr = /^[A-Z0-9-]{2,}$/.test(surf) && /[A-Z]/.test(surf);
        if (isAcr) return !!glossary[surf] || METHOD_STEMS.has(s) || !!ACRONYMS[surf];
        if (s.length < 4) return false;
        // Words only ever seen capitalised are usually names of people, places or institutions.
        if ((c.cap || 0) > 0 && !(c.lower || 0) && classifyPhrase(c.stems) === 'interests') return false;
        return c.count >= 3 || c.maxW >= 2.5;
      }
      if (c.stems.every(s => GENERIC_SINGLE.has(s))) return false;
      return c.count >= 2 || c.maxW >= 2.5;
    });
    list.sort((a, b) => b.score - a.score);
    // Drop sub-phrases mostly explained by a longer phrase.
    const kept = [];
    for (const c of list) {
      const dominated = kept.some(k => k.stems.length > c.stems.length && hasPhrase(k.stems, c.stems) && c.count <= 1.25 * k.count);
      if (!dominated) kept.push(c);
    }
    const groups = { interests: [], methods: [], areas: [] };
    const limits = { interests: 16, methods: 12, areas: 8 };
    const keptStems = kept.map(k => k.stems);
    for (const c of kept) {
      const surface = [...c.surfaces.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const isAcr = /^[A-Z0-9-]{2,8}$/.test(surface) && /[A-Z]/.test(surface);
      const expansion = isAcr ? (glossary[surface] || ((ACRONYMS[surface] || []).length === 1 ? ACRONYMS[surface][0] : '')) : '';
      if (isAcr && expansion) {
        const es = phraseStems(expansion);
        if (keptStems.some(k => k !== c.stems && hasPhrase(k, es))) continue; // spelled-out form already listed
      }
      const g = classifyPhrase(expansion ? phraseStems(expansion) : c.stems);
      if (groups[g].length >= limits[g]) continue;
      const term = { text: surface, score: Math.round(c.score * 10) / 10 };
      if (expansion) term.expansion = expansion;
      groups[g].push(term);
    }
    return { ...groups, glossary, createdAt: new Date().toISOString() };
  }

  // Profile -> weighted stemmed terms used for matching.
  function profileTerms(profile) {
    if (!profile) return [];
    const out = [];
    const push = (t, kind, w) => {
      const st = phraseStems(t);
      if (st.length) out.push({ text: t, stems: st, kind, weight: w });
    };
    (profile.interests || []).forEach(t => { push(t.text, 'interest', 1); if (t.expansion) push(t.expansion, 'interest', 1); });
    (profile.methods || []).forEach(t => { push(t.text, 'method', 0.8); if (t.expansion) push(t.expansion, 'method', 0.8); });
    (profile.areas || []).forEach(t => push(t.text, 'area', 0.5));
    return out;
  }

  function profileText(profile) {
    if (!profile) return '';
    const g = k => (profile[k] || []).map(t => t.expansion ? `${t.text} (${t.expansion})` : t.text).join(', ');
    return `Research interests: ${g('interests')}. Methods: ${g('methods')}. Areas: ${g('areas')}.`;
  }

  // ---------------------------------------------------------------- query analysis
  function analyzeQuery(q, profile, choices = {}) {
    const raw = normSpace(q);
    const expert = /["()]|\b(AND|OR|NOT)\b/.test(raw);
    const toks = tokens(raw);
    const content = toks.filter(t => !STOP.has(t.toLowerCase()));
    const glossary = (profile && profile.glossary) || {};
    const pTerms = profileTerms(profile);
    const acronyms = [];
    let question = null;
    for (const t of toks) {
      const isAcr = /^[A-Z0-9][A-Z0-9-]{1,6}$/.test(t) && /[A-Z]/.test(t) && t.length <= 7;
      if (!isAcr) continue;
      if (NO_EXPAND.has(t)) continue;
      if (choices[t] !== undefined) { if (choices[t]) acronyms.push({ acr: t, long: choices[t], how: 'you chose' }); continue; }
      if (glossary[t]) { acronyms.push({ acr: t, long: glossary[t], how: 'from your profile' }); continue; }
      const senses = ACRONYMS[t] || ACRONYMS[t.replace(/-/g, '')];
      if (!senses) continue;
      if (senses.length === 1) { acronyms.push({ acr: t, long: senses[0], how: 'common meaning' }); continue; }
      // Pick a sense that appears in the profile, if any.
      const hit = senses.find(s => { const st = phraseStems(s); return pTerms.some(p => hasPhrase(p.stems, st) || hasPhrase(st, p.stems) && p.stems.length > 1); });
      if (hit) { acronyms.push({ acr: t, long: hit, how: 'matches your profile' }); continue; }
      if (!question) question = { kind: 'acronym', acr: t, options: senses };
    }

    // Query term groups (for matching) and OpenAlex boolean expansion.
    const groups = [];
    const expansions = [];
    const usedSyn = new Set();
    const disabled = new Set(choices.disabledExpansions || []);
    let i = 0;
    const lowerToks = toks.map(t => t.toLowerCase());
    const stemToks = toks.map(stem);
    const pieces = []; // for boolean query
    while (i < toks.length) {
      const t = toks[i];
      const lo = lowerToks[i];
      const acr = acronyms.find(a => a.acr === t);
      if (acr) {
        groups.push({ label: t, alts: [{ text: t, stems: [stem(t)], weight: 1, tier: 'same' }, { text: acr.long, stems: phraseStems(acr.long), weight: 1, tier: 'same' }] });
        pieces.push(`(${t} OR "${acr.long.replace(/"/g, '')}")`);
        i++; continue;
      }
      if (STOP.has(lo)) { i++; continue; }
      // multiword synonym match (longest first)
      let matched = null;
      for (const g of SYNONYMS) {
        const guard = SYN_GUARD.get(g[0].text);
        if (guard && !guard.some(x => stemToks.slice(Math.max(0, i - 2), i).includes(stem(x)))) continue;
        for (const alt of g) {
          const n = alt.stems.length;
          if (n && hasPhrase(stemToks.slice(i, i + n), alt.stems) && stemToks.slice(i, i + n).length === n) {
            if (!matched || n > matched.n) matched = { g, alt, n };
          }
        }
      }
      if (matched && !expert) {
        const seenSt = new Set([matched.alt.stems.join(' ')]);
        const others = matched.g.filter(a => { const k = a.stems.join(' '); if (seenSt.has(k)) return false; seenSt.add(k); return true; });
        const active = others.filter(a => !disabled.has(a.text));
        const surf = toks.slice(i, i + matched.n).join(' ');
        const sameAfter = SYN_SAME_AFTER.get(matched.alt.text) || SYN_SAME_AFTER.get(matched.g[0].text);
        const tier = sameAfter && sameAfter.some(x => stemToks.slice(Math.max(0, i - 2), i).includes(stem(x))) ? 'same' : matched.g.tier;
        groups.push({ label: surf, alts: [{ text: surf, stems: stemToks.slice(i, i + matched.n), weight: 1, tier: 'same' }, ...active.map(a => ({ text: a.text, stems: a.stems, weight: 0.8, tier }))] });
        others.forEach(a => { if (!usedSyn.has(a.text)) { usedSyn.add(a.text); expansions.push({ for: surf, text: a.text, on: !disabled.has(a.text), tier }); } });
        const q1 = matched.n > 1 ? `"${surf}"` : surf;
        pieces.push(active.length ? `(${[q1, ...active.map(a => a.stems.length > 1 || /[-\s]/.test(a.text) ? `"${a.text}"` : a.text)].join(' OR ')})` : q1);
        i += matched.n; continue;
      }
      // An ion such as SCN⁻ also counts, a little less, when written without its charge.
      const charged = /[+-]$/.test(t) && t.length > 1;
      groups.push({ label: t, alts: [{ text: t, stems: [stemToks[i]], weight: 1, tier: 'same' }, ...(charged ? [{ text: t.slice(0, -1), stems: [stem(t.slice(0, -1))], weight: 0.8, tier: 'related' }] : [])] });
      pieces.push(charged ? t.slice(0, -1) : t);
      i++;
    }
    const keywordQuery = expert ? raw : pieces.join(' ');
    let semanticQuery = raw;
    for (const a of acronyms) semanticQuery = semanticQuery.replace(new RegExp(`\\b${a.acr.replace(/[-]/g, '\\-')}\\b`), `${a.long} (${a.acr})`);
    const phrase = expert ? [] : content.map(stem);
    const related = (choices.related || []).map(t => ({ text: t, stems: phraseStems(t) })).filter(r => r.stems.length);
    const relatedQuery = related.map(r => `"${r.text.replace(/"/g, '')}"`).join(' OR ');
    return { raw, expert, tokens: toks, content, groups, phrase, acronyms, expansions, keywordQuery, semanticQuery,
      shortQuery: content.length <= 3, question, related, relatedQuery };
  }

  // Decide whether a query spans unrelated domains, using OpenAlex group_by counts per field.
  // Options are offered at domain level (life / social / physical / health sciences), which is
  // where real ambiguity lies ("relaxation" in medicine vs physics); finer choices are left to ranking.
  const DOMAINS = { Life: { id: 1, name: 'Life sciences' }, Social: { id: 2, name: 'Social sciences and humanities' },
    Physical: { id: 3, name: 'Physical sciences and engineering' }, Health: { id: 4, name: 'Health sciences' } };
  function assessFieldAmbiguity(groupBy, profile) {
    const rows = (groupBy || []).filter(r => r && r.key && r.count > 0).map(r => {
      const id = Number(String(r.key).split('/').pop());
      return { id, name: r.key_display_name, count: r.count, domain: FIELD_DOMAIN[id] || 'Other' };
    });
    const total = rows.reduce((s, r) => s + r.count, 0);
    if (!total) return { ambiguous: false, fields: [], options: [] };
    rows.forEach(r => { r.share = r.count / total; });
    const dom = {};
    rows.forEach(r => {
      if (!DOMAINS[r.domain]) return;
      const d = dom[r.domain] || (dom[r.domain] = { key: r.domain, id: DOMAINS[r.domain].id, name: DOMAINS[r.domain].name, share: 0, fields: [], fieldIds: [] });
      d.share += r.share; d.fields.push(r.name); d.fieldIds.push(r.id);
    });
    const options = Object.values(dom).sort((a, b) => b.share - a.share).filter(d => d.share >= 0.08);
    const ambiguous = options.length > 1 && options[0].share < 0.65 && options[1].share >= 0.15;
    let autoPick = null;
    if (ambiguous && profile) {
      const pStems = new Set(profileTerms(profile).flatMap(t => t.stems));
      const scored = options.map(o => {
        const hints = new Set(o.fieldIds.flatMap(id => contentStems(FIELD_HINTS[id] || '')).concat(o.fields.flatMap(f => contentStems(f))));
        let hits = 0; hints.forEach(h => { if (pStems.has(h)) hits++; });
        return { o, hits };
      }).sort((a, b) => b.hits - a.hits);
      if (scored.length && scored[0].hits >= 2 && scored[0].hits >= 2 * ((scored[1] && scored[1].hits) || 0)) autoPick = scored[0].o;
    }
    return { ambiguous, fields: rows, options, autoPick };
  }

  // ---------------------------------------------------------------- source normalisers
  function normOpenAlex(w, channel, rank) {
    const pt = w.primary_topic;
    const fieldId = pt && pt.field ? Number(String(pt.field.id).split('/').pop()) : null;
    const best = w.best_oa_location || null;
    const prim = w.primary_location || {};
    const pct = w.citation_normalized_percentile || null;
    return {
      key: '', openalexId: w.id || '', doi: cleanDoi(w.doi), title: stripTags(w.display_name || w.title || ''),
      year: w.publication_year || null, date: w.publication_date || '',
      authors: (w.authorships || []).filter(a => a && a.author && a.author.display_name).map(a => a.author.display_name),
      authorIds: (w.authorships || []).filter(a => a && a.author && a.author.display_name).map(a => a.author.id || ''),
      ships: (w.authorships || []).filter(a => a && a.author).map(a => ({ id: a.author.id || '', name: a.author.display_name || '', raw: a.raw_author_name || '',
        orcid: orcidOf(a.author.orcid), inst: (a.institutions || []).map(i => i && i.display_name).filter(Boolean) })),
      venue: (prim.source && prim.source.display_name) || '',
      abstract: reconstructAbstract(w.abstract_inverted_index), abstractFrom: w.abstract_inverted_index ? 'OpenAlex' : '',
      oaType: w.type || '', crType: prim.raw_type || '', epmcTypes: [],
      isOA: !!(w.open_access && w.open_access.is_oa), oaStatus: (w.open_access && w.open_access.oa_status) || '',
      landing: prim.landing_page_url || (w.doi || ''), oaUrl: (best && (best.landing_page_url || best.pdf_url)) || (w.open_access && w.open_access.oa_url) || '',
      pdf: (best && best.pdf_url) || '', oaHost: best && best.source ? best.source.display_name : '',
      cites: w.cited_by_count || 0, pct: pct ? pct.value : null, top1: !!(pct && pct.is_in_top_1_percent), top10: !!(pct && pct.is_in_top_10_percent),
      topic: pt ? { id: pt.id, name: pt.display_name, subfield: pt.subfield && pt.subfield.display_name, field: pt.field && pt.field.display_name, fieldId, domain: pt.domain && pt.domain.display_name } : null,
      keywords: (w.keywords || []).map(k => k.display_name).filter(Boolean),
      retracted: !!w.is_retracted,
      sources: ['OpenAlex'], ranks: { [channel]: rank },
    };
  }

  function normCrossref(it, rank) {
    const dp = (it.issued && it.issued['date-parts'] && it.issued['date-parts'][0]) || (it.published && it.published['date-parts'] && it.published['date-parts'][0]) || [];
    const abs = stripTags(it.abstract || '').replace(/^(abstract|summary)\s*[:.]?\s+/i, '');
    return {
      key: '', openalexId: '', doi: cleanDoi(it.DOI), title: stripTags((it.title && it.title[0]) || ''), year: dp[0] || null, date: dp.join('-'),
      authors: (it.author || []).map(a => normSpace([a.given, a.family].filter(Boolean).join(' ')) || a.name).filter(Boolean),
      ships: (it.author || []).map(a => { const n = normSpace([a.given, a.family].filter(Boolean).join(' ')) || a.name || ''; return { id: '', name: n, raw: n, orcid: orcidOf(a.ORCID), inst: (a.affiliation || []).map(x => x && x.name).filter(Boolean) }; }),
      venue: stripTags((it['container-title'] && it['container-title'][0]) || ''), abstract: abs, abstractFrom: abs ? 'Crossref' : '',
      oaType: '', crType: it.type || '', epmcTypes: [], isOA: false, oaStatus: '',
      landing: it.URL || (it.DOI ? `https://doi.org/${it.DOI}` : ''), oaUrl: '', pdf: '', oaHost: '',
      cites: it['is-referenced-by-count'] || 0, pct: null, top1: false, top10: false, topic: null, keywords: (it.subject || []).slice(0, 5), retracted: false,
      sources: ['Crossref'], ranks: { crossref: rank },
    };
  }

  function normEPMC(r, rank) {
    const types = (r.pubTypeList && r.pubTypeList.pubType) || [];
    const ft = (r.fullTextUrlList && r.fullTextUrlList.fullTextUrl) || [];
    const free = ft.find(u => /free|open/i.test(u.availability || '') && /html|pdf/i.test(u.documentStyle || ''));
    const abs = stripTags(r.abstractText || '');
    return {
      key: '', openalexId: '', doi: cleanDoi(r.doi), title: stripTags(r.title || '').replace(/\.$/, ''), year: r.pubYear ? Number(r.pubYear) : null,
      date: r.firstPublicationDate || '', authors: r.authorString ? r.authorString.replace(/\.$/, '').split(/,\s*/) : [],
      venue: (r.journalInfo && r.journalInfo.journal && r.journalInfo.journal.title) || (r.bookOrReportDetails && r.bookOrReportDetails.publisher) || '',
      abstract: abs, abstractFrom: abs ? 'Europe PMC' : '', oaType: '', crType: r.source === 'PPR' ? 'posted-content' : '',
      epmcTypes: Array.isArray(types) ? types : [types], isOA: r.isOpenAccess === 'Y', oaStatus: r.isOpenAccess === 'Y' ? 'open' : '',
      landing: `https://europepmc.org/article/${r.source}/${r.id}`, oaUrl: free ? free.url : '', pdf: '', oaHost: free ? 'Europe PMC' : '',
      cites: r.citedByCount || 0, pct: null, top1: false, top10: false, topic: null, keywords: [], retracted: false,
      sources: ['Europe PMC'], ranks: { epmc: rank },
    };
  }

  function workKey(w) { return w.doi ? 'doi:' + w.doi : 't:' + normTitle(w.title) + ':' + (w.year || ''); }

  function mergeInto(a, b) {
    for (const s of b.sources) if (!a.sources.includes(s)) a.sources.push(s);
    Object.assign(a.ranks, Object.fromEntries(Object.entries(b.ranks).filter(([k]) => a.ranks[k] === undefined)));
    if (!a.abstract && b.abstract) { a.abstract = b.abstract; a.abstractFrom = b.abstractFrom; }
    if (!a.doi && b.doi) a.doi = b.doi;
    if (b.epmcTypes && b.epmcTypes.length) a.epmcTypes = [...new Set([...a.epmcTypes, ...b.epmcTypes])];
    if (!a.crType && b.crType) a.crType = b.crType;
    if (!a.isOA && b.isOA) { a.isOA = true; a.oaStatus = a.oaStatus || b.oaStatus; }
    if (!a.oaUrl && b.oaUrl) { a.oaUrl = b.oaUrl; a.oaHost = b.oaHost; }
    if (!a.venue && b.venue) a.venue = b.venue;
    if (!a.authors.length && b.authors.length) a.authors = b.authors;
    if ((!a.ships || !a.ships.length) && b.ships && b.ships.length) a.ships = b.ships;
    if (b.addedFrom && !a.addedFrom && !a.ranks.oa_author) a.addedFrom = b.addedFrom;
    if (!a.year && b.year) a.year = b.year;
    a.cites = Math.max(a.cites || 0, b.cites || 0);
    if (!a.topic && b.topic) a.topic = b.topic;
    if (!a.openalexId && b.openalexId) a.openalexId = b.openalexId;
    return a;
  }

  // Merge new records into an existing pool (Map key -> work). Returns number of new items.
  function dedupeInto(pool, items) {
    let added = 0;
    const titleIndex = new Map();
    for (const w of pool.values()) titleIndex.set(normTitle(w.title) + ':' + (w.year || ''), w);
    for (const it of items) {
      if (!it || !it.title) continue;
      it.key = workKey(it);
      const tkey = normTitle(it.title) + ':' + (it.year || '');
      // Same title and year but two different DOIs: treat as different papers (e.g. a comment and its reply).
      const byTitle = w => (w && it.doi && w.doi && w.doi !== it.doi ? null : w);
      let existing = pool.get(it.key) || byTitle(titleIndex.get(tkey));
      // also tolerate off-by-one years between sources when titles are long and identical
      if (!existing && normTitle(it.title).length > 40) {
        existing = byTitle(titleIndex.get(normTitle(it.title) + ':' + ((it.year || 0) - 1))) || byTitle(titleIndex.get(normTitle(it.title) + ':' + ((it.year || 0) + 1)));
      }
      if (existing) mergeInto(existing, it);
      else { pool.set(it.key, it); titleIndex.set(tkey, it); added++; }
    }
    return added;
  }

  // ---------------------------------------------------------------- publication type
  const REVIEW_TITLE = [/\breview\b(?!er)/i, /\badvances in\b/i, /\brecent (advances|progress|developments|trends)\b/i, /\bprogress in\b/i,
    /\boverview\b/i, /\bstate[- ]of[- ]the[- ]art\b/i, /\btutorial\b/i, /\bmeta-analysis\b/i, /\bsystematic review\b/i, /\ba decade of\b/i];
  const REVIEW_ABSTRACT = [/\b(this|the present|our|in this) (mini-?|critical |comprehensive |systematic |short |brief )?review\b/i,
    /\bwe review\b/i, /\b(are|is) reviewed\b/i, /\bthis article reviews\b/i, /\bwe summari[sz]e (the )?(recent|current)\b/i,
    /\bhere,? we (survey|summari[sz]e)\b/i];
  const PERSPECTIVE_TITLE = [/^(perspective|outlook|viewpoint|commentary|comment|opinion|essay|editorial)\b/i,
    /:\s*(a |an |the )?(perspective|outlook|viewpoint)s?\b/i, /\bperspectives? on\b/i, /\boutlook\b/i,
    /\bnews (and|&) views\b/i, /\b(opportunities and challenges|challenges and opportunities)\b/i, /\broadmap\b/i];
  const PERSPECTIVE_ABSTRACT = [/\b(in )?this (perspective|commentary|essay|viewpoint|outlook)\b/i, /\bwe offer (our|a) perspective\b/i, /\bwe provide (our|a) perspective\b/i];
  const REVIEW_VENUE = /\b(reviews?|annual review|accounts of|trends in|current opinion)\b/i;

  // Returns {cat: research|review|perspective|preprint|other, label, conf: labelled|inferred|unverified, why}
  function classifyType(w) {
    const t = w.title || '', a = w.abstract || '', oa = (w.oaType || '').toLowerCase(), cr = (w.crType || '').toLowerCase();
    const ep = (w.epmcTypes || []).map(x => String(x).toLowerCase());
    const OTHER = ['book-review', 'reference-entry', 'libguides', 'grant', 'software', 'dataset', 'paratext', 'erratum', 'retraction', 'peer-review', 'supplementary-materials', 'standard', 'report', 'dissertation', 'book', 'book-chapter', 'other'];
    const nice = x => x.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
    if (OTHER.includes(oa) && oa !== 'book-chapter' && oa !== 'book') return { cat: 'other', label: nice(oa), conf: 'labelled', why: `Labelled "${oa}" by OpenAlex.` };
    if (oa === 'preprint' || cr === 'posted-content' || ep.includes('preprint')) return { cat: 'preprint', label: 'Preprint', conf: 'labelled', why: 'Labelled as a preprint by the source.' };
    if (oa === 'review' || ep.some(x => /(^|[^-])review/.test(x) && !/peer/.test(x)) || /systematic-review/.test(ep.join(' '))) {
      return { cat: 'review', label: 'Review', conf: 'labelled', why: oa === 'review' ? 'OpenAlex labels this a review.' : 'PubMed/Europe PMC labels this a review.' };
    }
    if (['editorial', 'letter'].includes(oa) || ep.some(x => /editorial|comment|letter|news/.test(x))) {
      if (oa === 'editorial' || ep.some(x => /editorial|comment|news/.test(x))) return { cat: 'perspective', label: 'Editorial/commentary', conf: 'labelled', why: 'Labelled as an editorial or commentary by the source.' };
      if (oa === 'letter' || ep.some(x => /letter/.test(x))) return { cat: 'other', label: 'Letter', conf: 'labelled', why: 'Labelled "letter": this can mean correspondence or a short research report, depending on the journal.' };
      return { cat: 'other', label: oa.charAt(0).toUpperCase() + oa.slice(1), conf: 'labelled', why: `Labelled "${oa}" by OpenAlex.` };
    }
    if (REVIEW_TITLE.some(r => r.test(t)) || REVIEW_ABSTRACT.some(r => r.test(a))) {
      return { cat: 'review', label: 'Review?', conf: 'inferred', why: 'Inferred from wording in the title or abstract; the source does not label it a review.' };
    }
    if (PERSPECTIVE_TITLE.some(r => r.test(t)) || PERSPECTIVE_ABSTRACT.some(r => r.test(a))) {
      return { cat: 'perspective', label: 'Perspective?', conf: 'inferred', why: 'Inferred from wording in the title or abstract; the source does not label it a perspective.' };
    }
    if (REVIEW_VENUE.test(w.venue || '')) return { cat: 'review', label: 'Review?', conf: 'inferred', why: `Inferred from the venue (${w.venue}), which mainly publishes reviews.` };
    if (['book', 'book-chapter', 'dissertation', 'dataset', 'report', 'standard', 'other', 'supplementary-materials'].includes(oa) || /book|dissertation|dataset|report|monograph/.test(cr)) {
      return { cat: 'other', label: nice(oa || cr), conf: 'labelled', why: 'Labelled by the source.' };
    }
    if (oa === 'article' || /journal-article|proceedings-article|article/.test(cr) || !oa) {
      return { cat: 'research', label: 'Article', conf: 'unverified', why: 'The source says "article", a label that covers original research but also some reviews and commentaries. Not verified.' };
    }
    return { cat: 'other', label: nice(oa), conf: 'labelled', why: 'Labelled by the source.' };
  }

  // ---------------------------------------------------------------- matching & ranking
  function prepWork(w) {
    if (w._prep) return w._prep;
    const titleSt = stems(w.title);
    const absSt = stems(w.abstract);
    const kwText = [...(w.keywords || []), w.topic ? w.topic.name : '', w.topic ? w.topic.subfield : ''].join(' ; ');
    const kwSt = stems(kwText);
    w._prep = { titleSt, absSt, kwSt, titleSet: new Set(titleSt), absSet: new Set(absSt), kwSet: new Set(kwSt) };
    w.typeInfo = classifyType(w);
    return w._prep;
  }

  function matchTerm(p, st) {
    // phrase in title > phrase in abstract > phrase in keywords/topic > all words in title/abstract
    if (hasPhrase(p.titleSt, st)) return { s: 1, where: 'title' };
    if (hasPhrase(p.absSt, st)) return { s: 0.7, where: 'abstract' };
    if (hasPhrase(p.kwSt, st)) return { s: 0.45, where: 'keywords' };
    if (st.length > 1 && hasAll(p.titleSet, st)) return { s: 0.6, where: 'title' };
    if (st.length > 1 && hasAll(p.absSet, st)) return { s: 0.4, where: 'abstract' };
    return null;
  }

  function scoreQuery(w, analysis) {
    const p = prepWork(w);
    const hits = [];
    let sum = 0;
    const groups = analysis.groups.length ? analysis.groups : [];
    for (const g of groups) {
      let best = null;
      for (const alt of g.alts) {
        if (!alt.stems.length) continue;
        const m = matchTerm(p, alt.stems);
        if (m) { const s = m.s * alt.weight; if (!best || s > best.s) best = { s, where: m.where, text: alt.text, original: alt.weight === 1 && alt.text === g.label, label: g.label }; }
      }
      if (best) { sum += best.s; hits.push(best); }
    }
    let score = groups.length ? sum / groups.length : 0;
    if (analysis.phrase.length > 1 && hasPhrase(p.titleSt, analysis.phrase)) score = Math.min(1, score + 0.15);
    const relHits = (analysis.related || []).filter(r => matchTerm(p, r.stems)).map(r => r.text);
    return { score, hits, relHits };
  }

  // ---- Scoring v2. Each idea in the query is weighted by how rare it is among the fetched papers (an idea that every
  // candidate mentions tells them apart less), single generic words count half, words of a phrase count more when
  // they sit together, synonyms count by level, and a paper missing a specific idea loses part of its match score
  // (less so in "Adjacent & emerging"). Version 1 is kept so the two can be compared on graded searches.
  const splitSt = arr => arr.flatMap(x => /[+-]$/.test(x) || !x.includes('-') ? [x] : x.split('-').filter(Boolean));
  function prepV2(w) {
    const p = prepWork(w);
    if (!p.tS) { p.tS = splitSt(p.titleSt); p.aS = splitSt(p.absSt); p.kS = splitSt(p.kwSt); p.tSet2 = new Set(p.tS); p.aSet2 = new Set(p.aS); }
    return p;
  }
  function matchTermV2(p, st0) {
    const st = splitSt(st0); if (!st.length) return null;
    if (hasPhrase(p.tS, st)) return { s: 1, where: 'title' };
    if (hasPhrase(p.aS, st)) return { s: 0.7, where: 'abstract' };
    if (st.length > 1 && nearAll(p.tS, st)) return { s: 0.65, where: 'title' };
    if (st.length > 1 && nearAll(p.aS, st)) return { s: 0.5, where: 'abstract' };
    if (hasPhrase(p.kS, st)) return { s: 0.45, where: 'keywords' };
    if (st.length > 1 && hasAll(p.tSet2, st)) return { s: 0.4, where: 'title' };
    if (st.length > 1 && hasAll(p.aSet2, st)) return { s: 0.25, where: 'abstract' };
    return null;
  }
  function groupStats(works, analysis) {
    const groups = (analysis && analysis.groups) || []; const N = works.length;
    const df = groups.map(() => 0);
    works.forEach(w => { const p = prepV2(w); groups.forEach((g, i) => { if (g.alts.some(a => a.stems.length && matchTermV2(p, a.stems))) df[i]++; }); });
    const raw = groups.map((g, i) => {
      const generic = g.alts[0].stems.length === 1 && (GENERIC_SINGLE.has(String(g.label).toLowerCase()) || String(g.label).length < 3);
      const idf = N > 4 && df[i] > 0 ? Math.log(1 + N / df[i]) / Math.log(1 + N) : 1;
      return { w: Math.max(0.25, idf) * (generic ? 0.5 : 1), required: !generic, df: df[i], label: g.label };
    });
    const top = Math.max(0.0001, ...raw.map(x => x.w));
    raw.forEach(x => { x.w /= top; });
    if (raw.length && !raw.some(x => x.required)) raw.forEach(x => { x.required = true; });
    return raw;
  }
  function scoreQueryV2(w, analysis, gs, mode) {
    const p = prepV2(w); const hits = []; const missing = [];
    let sum = 0, tot = 0, reqTot = 0, reqHit = 0;
    (analysis.groups || []).forEach((g, i) => {
      const st = gs[i]; let best = null;
      for (const alt of g.alts) {
        if (!alt.stems.length) continue;
        const m = matchTermV2(p, alt.stems); if (!m) continue;
        const s = m.s * (TIER_W[alt.tier] != null ? TIER_W[alt.tier] : alt.weight);
        if (!best || s > best.s) best = { s, where: m.where, text: alt.text, original: alt.text === g.label, label: g.label };
      }
      tot += st.w; if (st.required) reqTot += st.w;
      if (best) { sum += st.w * best.s; hits.push(best); if (st.required) reqHit += st.w; } else if (st.required) missing.push(g.label);
    });
    const coverage = reqTot ? reqHit / reqTot : 1;
    let score = (tot ? sum / tot : 0) * (mode === 'adjacent' ? 0.75 + 0.25 * coverage : 0.35 + 0.65 * coverage);
    const ph = splitSt(analysis.phrase || []);
    if (ph.length > 1) { if (hasPhrase(p.tS, ph)) score += 0.15; else if (nearAll(p.tS, ph, 3)) score += 0.08; else if (nearAll(p.aS, ph, 4)) score += 0.05; }
    const relHits = (analysis.related || []).filter(r => matchTermV2(p, r.stems)).map(r => r.text);
    return { score: Math.min(1, score), hits, relHits, missing, coverage };
  }

  function scoreProfile(w, pTerms) {
    if (!pTerms.length) return { score: 0, hits: [] };
    const p = prepWork(w);
    const hits = [];
    let sum = 0;
    for (const t of pTerms) {
      const m = matchTerm(p, t.stems);
      if (m) {
        // single generic words count less
        const s = m.s * t.weight * (t.stems.length > 1 ? 1 : 0.6);
        sum += s;
        if (!hits.some(h => h.text === t.text)) hits.push({ text: t.text, where: m.where, kind: t.kind, s });
      }
    }
    hits.sort((a, b) => b.s - a.s);
    return { score: Math.min(1, sum / 2.5), hits };
  }

  const CHANNEL_WEIGHT = { oa_kw: 1, oa_sem: 1, oa_trail: 1, oa_recent: 0.8, oa_rel: 0.6, crossref: 0.6, epmc: 0.6 };
  // ctx: {analysis, profile, mode, nowYear, sem: Map(key -> {q, p}), trail}
  function rankWorks(works, ctx) {
    const pTerms = profileTerms(ctx.profile);
    const nowYear = ctx.nowYear || new Date().getFullYear();
    const hasProfile = pTerms.length > 0;
    const mode = hasProfile ? (ctx.mode || 'all') : 'all';
    // reciprocal-rank fusion across retrieval channels
    const K = 20;
    let maxRrf = 0;
    for (const w of works) {
      let r = 0;
      for (const [ch, rank] of Object.entries(w.ranks || {})) r += (CHANNEL_WEIGHT[ch] != null ? CHANNEL_WEIGHT[ch] : 0.6) / (K + rank);
      w._rrf = r; if (r > maxRrf) maxRrf = r;
    }
    const v2 = ctx.scoring !== 'v1';
    const gs = v2 ? groupStats(works, ctx.analysis) : null;
    for (const w of works) {
      const q = v2 ? scoreQueryV2(w, ctx.analysis, gs, mode) : scoreQuery(w, ctx.analysis);
      const pr = scoreProfile(w, pTerms);
      const rrf = maxRrf ? w._rrf / maxRrf : 0;
      const age = w.year ? Math.max(0, nowYear - w.year) : 10;
      const recency = Math.max(0, Math.min(1, 1 - (age - 2) / 13));
      const impact = w.pct != null ? w.pct : Math.min(1, Math.log1p(w.cites || 0) / Math.log1p(1000));
      const sem = ctx.sem && ctx.sem.get(w.key);
      let qrel = 0.55 * q.score + 0.45 * rrf + (q.relHits.length ? 0.08 : 0);
      let prof = pr.score;
      if (sem) {
        const sq = Math.max(0, Math.min(1, (sem.q - 0.15) / 0.55));
        qrel = 0.35 * q.score + 0.3 * rrf + 0.35 * sq + (q.relHits.length ? 0.05 : 0);
        if (sem.p != null) prof = 0.5 * prof + 0.5 * Math.max(0, Math.min(1, (sem.p - 0.1) / 0.5));
      }
      let score;
      if (mode === 'close') score = 0.62 * qrel + 0.28 * prof + 0.07 * impact + 0.03 * recency;
      else if (mode === 'adjacent') score = 0.6 * qrel + 0.2 * (1 - prof) + 0.14 * recency + 0.06 * impact;
      else score = 0.78 * qrel + 0.08 * prof + 0.1 * impact + 0.04 * recency;
      if (w.retracted) score -= 0.5;
      if (/^(dataset|software|book-review|paratext|erratum|grant|libguides|reference-entry|peer-review|supplementary-materials)$/.test(w.oaType || '')) score -= 0.12;
      if (!ctx.trail && !ctx.author && !q.hits.length && !(w.ranks && (w.ranks.oa_sem !== undefined))) score -= 0.15; // nothing matched and not a meaning-based hit
      w.rank = { score, qrel, q: q.score, rrf, prof, profRaw: pr.score, impact, recency, qHits: q.hits, relHits: q.relHits, pHits: pr.hits, sem: sem || null, missing: q.missing || [], coverage: q.coverage, scoring: v2 ? 'v2' : 'v1' };
    }
    return works.slice().sort((a, b) => b.rank.score - a.rank.score);
  }

  // ---------------------------------------------------------------- explanations (grounded)
  function explain(w, ctx) {
    const r = w.rank || {};
    const reasons = [];
    if (ctx && ctx.trail && w.ranks && w.ranks.oa_trail !== undefined) {
      const how = { cites: 'Cites the paper you started from.', refs: 'Cited by the paper you started from.', related: 'OpenAlex lists it as related to the paper you started from.' }[ctx.trail.kind];
      if (how) reasons.push({ kind: 'trail', text: how });
    }
    if (r.likeWhy) r.likeWhy.forEach(x => reasons.push({ kind: 'trail', text: x }));
    if (r.shared && r.shared.length) reasons.push({ kind: 'profile', text: `Shares ${listify(r.shared.map(t => `“${t}”`))} with the papers you started from.` });
    if (r.ai) reasons.unshift({ kind: r.ai.grade >= 2 ? 'profile' : 'adjacent', text: `AI check: ${['not relevant', 'only touches the topic', 'relevant', 'directly addresses the search'][r.ai.grade]}${r.ai.reason ? ` (${r.ai.reason.replace(/\.$/, '')})` : ''}.` });
    const qh = ctx && ctx.trail ? [] : (r.qHits || []);
    const inTitle = qh.filter(h => h.where === 'title').map(h => h.text);
    const inAbs = qh.filter(h => h.where === 'abstract').map(h => h.text);
    const inKw = qh.filter(h => h.where === 'keywords').map(h => h.text);
    const syn = qh.filter(h => h.text.toLowerCase() !== String(h.label).toLowerCase());
    if (inTitle.length) reasons.push({ kind: 'query', text: `Title mentions ${listify(inTitle)}.` });
    if (inAbs.length) reasons.push({ kind: 'query', text: `Abstract mentions ${listify(inAbs)}.` });
    if (inKw.length && !inTitle.length && !inAbs.length) reasons.push({ kind: 'query', text: `Tagged by OpenAlex with ${listify(inKw)}.` });
    if (syn.length) reasons.push({ kind: 'synonym', text: `Uses ${listify(syn.map(h => `“${h.text}”`))} for ${listify([...new Set(syn.map(h => `“${h.label}”`))])}.` });
    if (qh.length && r.missing && r.missing.length) reasons.push({ kind: 'missing', text: `Does not mention ${listify(r.missing.map(t => `“${t}”`))} in its title or abstract.` });
    if (r.relHits && r.relHits.length) reasons.push({ kind: 'query', text: `Mentions the related term${r.relHits.length > 1 ? 's' : ''} ${listify(r.relHits.map(t => `“${t}”`))}.` });
    else if (w.ranks && w.ranks.oa_rel !== undefined && Object.keys(w.ranks).length === 1) reasons.push({ kind: 'semantic', text: 'Found through a related term you added.' });
    if (ctx && ctx.trail) { /* trail results are explained by their link to the starting paper */ }
    else if (!qh.length && w.ranks && w.ranks.oa_sem !== undefined) reasons.push({ kind: 'semantic', text: 'Found by OpenAlex meaning-based search; it does not use your exact search words.' });
    else if (w.ranks && w.ranks.oa_sem !== undefined && w.ranks.oa_kw === undefined) reasons.push({ kind: 'semantic', text: 'Found only by meaning-based search, not by keyword search.' });
    const ph = (r.pHits || []).slice(0, 3);
    if (ctx && ctx.hasProfile) {
      if (ph.length) reasons.push({ kind: 'profile', text: `Overlaps your profile: ${listify(ph.map(h => h.text))}.` });
      else if (w.topic) reasons.push({ kind: 'adjacent', text: `Outside your listed areas (OpenAlex topic: ${w.topic.name}).` });
    }
    if (w.top1) reasons.push({ kind: 'impact', text: 'Among the top 1% most-cited papers for its field and year (OpenAlex).' });
    else if (w.top10) reasons.push({ kind: 'impact', text: 'Among the top 10% most-cited papers for its field and year (OpenAlex).' });
    if (w.retracted) reasons.unshift({ kind: 'warning', text: 'OpenAlex marks this paper as retracted.' });

    // Evidence: the abstract sentence that best covers the query (and profile) terms — quoted verbatim.
    let evidence = null;
    if (w.abstract) {
      const sents = splitSentences(w.abstract);
      const qAlts = (ctx && ctx.analysis ? ctx.analysis.groups : []).map(g => g.alts.map(a => a.stems));
      const pTerms = ctx && ctx.profile ? profileTerms(ctx.profile) : [];
      let best = null;
      sents.forEach((s, idx) => {
        const st = stems(s);
        let sc = 0;
        for (const alts of qAlts) if (alts.some(a => a.length && hasPhrase(st, a))) sc += 2;
        for (const t of pTerms) if (hasPhrase(st, t.stems)) sc += t.stems.length > 1 ? 1 : 0.4;
        if (sc > 0 && (!best || sc > best.sc)) best = { sc, s, idx };
      });
      if (best) {
        let text = best.s;
        const ws = text.split(' ');
        let truncated = false;
        if (ws.length > 45) { text = ws.slice(0, 45).join(' '); truncated = true; }
        evidence = { text, truncated, from: w.abstractFrom || 'abstract' };
      }
    }
    const note = w.abstract ? (evidence ? '' : 'The abstract does not use your search terms directly.') : 'No abstract was available from the sources searched, so this is judged from the title and metadata only.';
    return { reasons, evidence, note };
  }

  function listify(arr) {
    const a = [...new Set(arr)];
    if (a.length <= 1) return a.join('');
    if (a.length === 2) return `${a[0]} and ${a[1]}`;
    return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
  }

  // Terms (stems) to highlight in the evidence sentence.
  function highlightStems(ctx) {
    const set = new Set();
    if (ctx && ctx.analysis) ctx.analysis.groups.forEach(g => g.alts.forEach(a => a.stems.forEach(s => set.add(s))));
    if (ctx && ctx.profile) profileTerms(ctx.profile).forEach(t => { if (t.stems.length > 1) t.stems.forEach(s => set.add(s)); });
    STOP.forEach(s => set.delete(s));
    return set;
  }

  // ---------------------------------------------------------------- themes (for the map)
  function computeThemes(works, ctx) {
    const nowYear = ctx.nowYear || new Date().getFullYear();
    const hasProfile = profileTerms(ctx.profile).length > 0;
    const pTerms = profileTerms(ctx.profile);
    const by = new Map();
    for (const w of works) {
      const id = w.topic ? w.topic.id : 'none';
      let t = by.get(id);
      if (!t) { t = { id, name: w.topic ? w.topic.name : 'Not classified', field: w.topic ? w.topic.field : '', subfield: w.topic ? w.topic.subfield : '', works: [] }; by.set(id, t); }
      t.works.push(w);
    }
    const poolRecent = works.filter(w => w.year && w.year >= nowYear - 2).length / Math.max(1, works.length);
    const top10 = works.slice(0, 10).map(w => w.key);
    const themes = [...by.values()].map(t => {
      const n = t.works.length;
      const recentShare = t.works.filter(w => w.year && w.year >= nowYear - 2).length / n;
      const meanProf = t.works.reduce((s, w) => s + ((w.rank && w.rank.prof) || 0), 0) / n;
      const shareClose = t.works.filter(w => w.rank && w.rank.prof >= 0.25).length / n;
      // profile overlap with the topic name itself
      const nameSt = stems(t.name + ' ' + (t.subfield || ''));
      const nameHit = pTerms.some(p => hasPhrase(nameSt, p.stems) || (p.stems.length === 1 && nameSt.includes(p.stems[0])));
      const closeness = Math.min(1, Math.max(meanProf, shareClose) + (nameHit ? 0.3 : 0));
      const inTop = t.works.filter(w => top10.includes(w.key)).length;
      const core = inTop >= 2 || (inTop >= 1 && works[0] && t.works.includes(works[0]));
      return { id: t.id, name: t.name, field: t.field, subfield: t.subfield, count: n, keys: t.works.map(w => w.key),
        recentShare, emerging: n >= 2 && recentShare >= Math.max(0.4, poolRecent + 0.15), closeness,
        close: hasProfile ? closeness >= 0.3 : core, core };
    });
    themes.sort((a, b) => b.count - a.count);
    return { themes, hasProfile, poolRecent };
  }

  // ---------------------------------------------------------------- Google Scholar comparison helper
  function parseScholarLines(text) {
    return String(text || '').split(/\n+/).map(l => l.replace(/^\s*(\d+[.)]\s*)?(\[(pdf|html|book|citation|b|c)\]\s*)*/i, '').trim())
      .filter(l => l.length >= 12);
  }
  function titleSimilarity(a, b) {
    const na = normTitle(a), nb = normTitle(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    if (na.length > 25 && nb.length > 25 && (na.includes(nb) || nb.includes(na))) return 0.95;
    const A = new Set(na.split(' ')), B = new Set(nb.split(' '));
    let inter = 0; A.forEach(x => { if (B.has(x)) inter++; });
    return inter / (A.size + B.size - inter);
  }
  function compareWithList(lines, rankedWorks) {
    return lines.map(line => {
      let best = null;
      rankedWorks.forEach((w, i) => { const s = titleSimilarity(line, w.title); if (s >= 0.8 && (!best || s > best.s)) best = { s, i, w }; });
      return { line, found: !!best, position: best ? best.i + 1 : null, key: best ? best.w.key : null };
    });
  }

  // ---------------------------------------------------------------- export
  function bibKey(w) {
    const last = (w.authors[0] || 'anon').split(/\s+/).pop().replace(/[^A-Za-z]/g, '') || 'anon';
    const first = (normTitle(w.title).split(' ').find(x => x.length > 3 && !STOP.has(x)) || 'paper');
    return `${last}${w.year || ''}${first}`;
  }
  const bibEsc = s => String(s || '').replace(/[{}\\]/g, '').replace(/&/g, '\\&').replace(/%/g, '\\%');
  function toBibTeX(list) {
    return list.map(w => {
      const type = w.typeInfo && w.typeInfo.cat === 'preprint' ? 'misc' : (w.oaType === 'book-chapter' ? 'incollection' : 'article');
      const f = [`  title = {${bibEsc(w.title)}}`, `  author = {${bibEsc(w.authors.join(' and '))}}`];
      if (w.venue) f.push(`  ${type === 'article' ? 'journal' : 'howpublished'} = {${bibEsc(w.venue)}}`);
      if (w.year) f.push(`  year = {${w.year}}`);
      if (w.doi) f.push(`  doi = {${w.doi}}`);
      const url = w.oaUrl || w.landing; if (url) f.push(`  url = {${url}}`);
      return `@${type}{${bibKey(w)},\n${f.join(',\n')}\n}`;
    }).join('\n\n');
  }
  function toRIS(list) {
    return list.map(w => {
      const L = [`TY  - ${w.typeInfo && w.typeInfo.cat === 'preprint' ? 'UNPB' : 'JOUR'}`, `TI  - ${w.title}`];
      w.authors.forEach(a => L.push(`AU  - ${a}`));
      if (w.year) L.push(`PY  - ${w.year}`);
      if (w.venue) L.push(`JO  - ${w.venue}`);
      if (w.doi) L.push(`DO  - ${w.doi}`);
      const url = w.oaUrl || w.landing; if (url) L.push(`UR  - ${url}`);
      if (w.abstract) L.push(`AB  - ${w.abstract}`);
      L.push('ER  - ');
      return L.join('\n');
    }).join('\n\n');
  }
  function toCSV(list) {
    const esc = s => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
    const rows = [['title', 'authors', 'year', 'venue', 'type', 'type_confidence', 'doi', 'url', 'open_access', 'cited_by'].join(',')];
    list.forEach(w => rows.push([w.title, w.authors.join('; '), w.year, w.venue, w.typeInfo && w.typeInfo.label, w.typeInfo && w.typeInfo.conf,
      w.doi, w.oaUrl || w.landing, w.isOA ? 'yes' : 'no', w.cites].map(esc).join(',')));
    return rows.join('\n');
  }

  // Slim copy for saving (no derived fields).
  function slim(w) {
    const keep = ['key', 'openalexId', 'doi', 'title', 'year', 'date', 'authors', 'authorIds', 'venue', 'abstract', 'abstractFrom', 'oaType', 'crType', 'epmcTypes',
      'isOA', 'landing', 'oaUrl', 'pdf', 'oaHost', 'cites', 'topic', 'retracted', 'sources'];
    const o = {}; keep.forEach(k => { o[k] = w[k]; }); o.savedAt = new Date().toISOString(); return o;
  }

  // ---------------------------------------------------------------- related terms (field-agnostic expansion)
  // Terms that OpenAlex attaches to many of the top results but that the query does not already contain.
  function relatedTerms(ranked, analysis, limit = 8) {
    const qStems = new Set();
    (analysis.groups || []).forEach(g => g.alts.forEach(a => a.stems.forEach(x => qStems.add(x))));
    (analysis.related || []).forEach(r => r.stems.forEach(x => qStems.add(x)));
    const tally = new Map();
    ranked.slice(0, 30).forEach((w, i) => {
      const wt = 1 / (1 + i / 10);
      const seen = new Set();
      (w.keywords || []).forEach(k => {
        const st = phraseStems(k);
        if (!st.length) return;
        const key = st.join(' ');
        if (seen.has(key)) return; seen.add(key);
        if (st.every(x => qStems.has(x))) return;
        if (st.length === 1 && (GENERIC_SINGLE.has(st[0]) || st[0].length < 4)) return;
        const t = tally.get(key) || { text: normSpace(k).toLowerCase(), n: 0, score: 0 };
        t.n++; t.score += wt; tally.set(key, t);
      });
    });
    return [...tally.values()].filter(t => t.n >= 2).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // ---------------------------------------------------------------- ORCID and profile from publications
  function orcidChecksumOk(id) {
    const d = id.replace(/-/g, '');
    if (!/^\d{15}[\dX]$/.test(d)) return false;
    let total = 0;
    for (let i = 0; i < 15; i++) total = (total + Number(d[i])) * 2;
    const res = (12 - (total % 11)) % 11;
    return (res === 10 ? 'X' : String(res)) === d[15];
  }
  function normOrcid(s) {
    const m = String(s || '').trim().match(/(\d{4})-?(\d{4})-?(\d{4})-?(\d{3}[\dXx])/);
    if (!m) return null;
    const id = `${m[1]}-${m[2]}-${m[3]}-${m[4].toUpperCase()}`;
    return orcidChecksumOk(id) ? id : null;
  }
  // Build a profile from a researcher's own OpenAlex works (keywords, topics, titles and abstracts).
  function profileFromWorks(works, meta = {}) {
    const kw = new Map(); const sub = new Map();
    let text = '';
    for (const w of works || []) {
      const seen = new Set();
      for (const k of w.keywords || []) {
        const name = typeof k === 'string' ? k : k && k.display_name;
        const st = phraseStems(name || '');
        if (!st.length) continue;
        const key = st.join(' ');
        if (seen.has(key)) continue; seen.add(key);
        const t = kw.get(key) || { text: normSpace(name).toLowerCase(), n: 0, stems: st };
        t.n++; kw.set(key, t);
      }
      const sf = w.primary_topic && w.primary_topic.subfield && w.primary_topic.subfield.display_name;
      if (sf) sub.set(sf, (sub.get(sf) || 0) + 1);
      text += `${stripTags(w.display_name || w.title || '')}.\n${reconstructAbstract(w.abstract_inverted_index)}\n\n`;
    }
    const fromText = extractProfile(text, { defaultWeight: 2 });
    const out = { interests: [], methods: [], areas: [], glossary: fromText.glossary || {} };
    const limits = { interests: 16, methods: 12, areas: 6 };
    const has = (g, st) => out[g].some(t => { const ts = phraseStems(t.text); return hasPhrase(ts, st) || hasPhrase(st, ts); });
    const minN = (works || []).length >= 6 ? 2 : 1;
    [...kw.values()].filter(t => t.n >= minN && !(t.stems.length === 1 && GENERIC_SINGLE.has(t.stems[0]))).sort((a, b) => b.n - a.n).forEach(t => {
      const g = classifyPhrase(t.stems);
      if (out[g].length < limits[g] && !has(g, t.stems)) out[g].push({ text: t.text, score: t.n });
    });
    for (const g of ['interests', 'methods', 'areas']) {
      for (const t of fromText[g] || []) if (out[g].length < limits[g] && !has(g, phraseStems(t.text))) out[g].push(t);
    }
    [...sub.entries()].sort((a, b) => b[1] - a[1]).filter(([, n]) => n >= minN).slice(0, 4).forEach(([name, n]) => {
      if (out.areas.length < limits.areas && !has('areas', phraseStems(name))) out.areas.push({ text: name.toLowerCase(), score: n });
    });
    return { ...out, createdAt: new Date().toISOString(), source: meta.source || 'publications', orcid: meta.orcid || '' };
  }
  function mergeProfiles(a, b) {
    if (!a) return b; if (!b) return a;
    const out = { ...a, glossary: { ...(a.glossary || {}), ...(b.glossary || {}) } };
    for (const g of ['interests', 'methods', 'areas']) {
      const seen = new Set((a[g] || []).map(t => t.text.toLowerCase()));
      out[g] = [...(a[g] || []), ...(b[g] || []).filter(t => !seen.has(t.text.toLowerCase()))];
    }
    out.source = [a.source, b.source].filter(Boolean).join(' + ');
    if (b.orcid) out.orcid = b.orcid;
    return out;
  }

  // ---------------------------------------------------------------- answer mode helpers (the model is called by the app)
  function buildAnswerPrompt(question, papers) {
    const system = 'You help a researcher by answering their question using ONLY the numbered paper abstracts provided. ' +
      'Cite every factual claim with the number of the abstract it comes from, like [2] or [1, 3]. Do not use outside knowledge. ' +
      'If the abstracts do not answer the question, say so plainly and say what they do cover. Note disagreements between papers. ' +
      'Write at most 180 words of plain prose, no headings, no bullet points.';
    const list = papers.map((w, i) => `[${i + 1}] ${w.title} (${w.year || 'n.d.'}). Abstract: ${w.abstract}`).join('\n\n');
    return { system, user: `Question: ${question}\n\nAbstracts:\n\n${list}` };
  }
  function expandRefs(s) {
    const out = [];
    String(s).split(/\s*[,;]\s*/).forEach(part => {
      const m = part.match(/^(\d+)\s*[–-]\s*(\d+)$/);
      if (m) { const a = Number(m[1]), b = Number(m[2]); if (b >= a && b - a < 20) for (let i = a; i <= b; i++) out.push(i); }
      else if (/^\d+$/.test(part)) out.push(Number(part));
    });
    return out;
  }
  // Checks an AI answer: which sentences cite sources, and whether every citation points to a supplied paper.
  function checkAnswer(text, n) {
    const sentences = splitSentences(text).map(sent => {
      const cites = [...sent.matchAll(/\[(\d+(?:\s*[,;–-]\s*\d+)*)\]/g)].flatMap(m => expandRefs(m[1]));
      const hedge = /\b(do not|does not|don't|doesn't|cannot|no information|not (address|discuss|mention|cover))\b/i.test(sent);
      return { text: sent, cites, uncited: !cites.length && sent.split(/\s+/).length > 5 && !hedge, invalid: cites.filter(c => c < 1 || c > n) };
    });
    const cited = [...new Set(sentences.flatMap(x => x.cites))].filter(c => c >= 1 && c <= n).sort((a, b) => a - b);
    return { sentences, uncited: sentences.filter(x => x.uncited).length, invalid: [...new Set(sentences.flatMap(x => x.invalid))], cited };
  }

  // Sorting that keeps weakly relevant items from jumping to the top when sorting by date or citations.
  function sortWorks(ranked, how) {
    if (!how || how === 'best') return ranked;
    const max = Math.max(0.0001, ...ranked.map(w => (w.rank ? w.rank.qrel : 0)));
    const relevant = w => (w.rank && w.rank.qrel >= 0.45 * max) || (w.ranks && (w.ranks.oa_sem !== undefined || w.ranks.oa_trail !== undefined));
    const key = how === 'newest' ? (w => String(w.date || w.year || '')) : (w => String(w.cites || 0).padStart(9, '0'));
    const cmp = (a, b) => (key(b) > key(a) ? 1 : key(b) < key(a) ? -1 : 0);
    const top = ranked.filter(relevant).sort(cmp);
    const rest = ranked.filter(w => !relevant(w)).sort(cmp);
    return top.concat(rest);
  }

  // ---------------------------------------------------------------- authors and DOIs
  function normAuthor(a) {
    if (!a) return null;
    const inst = (a.last_known_institutions && a.last_known_institutions[0]) || a.last_known_institution || null;
    const st = a.summary_stats || {};
    return {
      id: a.id || '', name: a.display_name || '', orcid: a.orcid ? String(a.orcid).replace(/^https?:\/\/orcid\.org\//, '') : '',
      works: a.works_count || 0, cites: a.cited_by_count || 0, h: st.h_index != null ? st.h_index : null,
      inst: inst ? inst.display_name || '' : '', country: inst ? inst.country_code || '' : '',
      topics: (a.topics || []).slice(0, 4).map(t => ({ name: t.display_name, count: t.count, field: t.field && t.field.display_name })),
      full: !!(a.works_count != null),
    };
  }
  // Group works by the field of their main OpenAlex topic; unclassified works go last.
  function groupByField(works) {
    const m = new Map();
    for (const w of works) {
      const key = w.topic && w.topic.field ? w.topic.field : 'Not classified';
      let g = m.get(key);
      if (!g) { g = { field: key, works: [], tcount: new Map(), y0: Infinity, y1: -Infinity }; m.set(key, g); }
      g.works.push(w);
      if (w.topic && w.topic.name) g.tcount.set(w.topic.name, (g.tcount.get(w.topic.name) || 0) + 1);
      if (w.year) { g.y0 = Math.min(g.y0, w.year); g.y1 = Math.max(g.y1, w.year); }
    }
    return [...m.values()].map(g => ({ field: g.field, works: g.works, count: g.works.length,
      years: isFinite(g.y0) ? [g.y0, g.y1] : null,
      topTopics: [...g.tcount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => ({ name, count })) }))
      .sort((a, b) => (a.field === 'Not classified') - (b.field === 'Not classified') || b.count - a.count);
  }
  // Returns a bare DOI if the whole input is a DOI (with or without the doi.org prefix), else null.
  function isDOI(q) {
    const m = String(q || '').trim().match(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/[^\s"<>]+)$/i);
    return m ? m[1].replace(/[.,;]+$/, '').toLowerCase() : null;
  }
  function initials(name) {
    const parts = String(name || '').replace(/[^\p{L}\s.-]/gu, '').split(/[\s.-]+/).filter(Boolean);
    if (!parts.length) return '?';
    return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  // ---------------------------------------------------------------- ORCID cross-check for author profiles
  // OpenAlex links papers to people automatically and can merge two people with the same surname and initial.
  // These functions check a profile's papers against the person's own ORCID record and the ORCID iDs
  // that publishers attach to papers (Crossref), and weigh the remaining evidence.
  function orcidOf(x) { const m = String(x || '').match(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i); return m ? m[1].toUpperCase() : ''; }
  // Preprint versions (…-v2, …/v3) share one key.
  function versionKey(doi) { return cleanDoi(doi).replace(/([-/.])v\d+$/i, ''); }
  function versionNo(doi) { const m = cleanDoi(doi).match(/[-/.]v(\d+)$/i); return m ? Number(m[1]) : 1; }
  const ORCID_TYPES = { 'journal-article': 'journal-article', preprint: 'posted-content', 'book-chapter': 'book-chapter', book: 'book',
    'conference-paper': 'proceedings-article', 'conference-abstract': 'proceedings-article', 'dissertation-thesis': 'dissertation', dissertation: 'dissertation',
    'review': 'journal-article', 'data-set': 'dataset', report: 'report', 'working-paper': 'report' };
  function parseOrcidRecord(j) {
    j = j || {};
    const v = x => (x && typeof x === 'object' ? x.value : x) || '';
    const person = j.person || {}; const nm = person.name || {};
    const acts = j['activities-summary'] || {};
    const worksJ = acts.works || (Array.isArray(j.group) ? j : { group: [] });
    const orgs = new Set();
    ['employments', 'educations', 'qualifications', 'invited-positions', 'distinctions', 'memberships', 'services'].forEach(k => {
      const sec = acts[k]; if (!sec) return;
      (sec['affiliation-group'] || []).forEach(g => (g.summaries || []).forEach(sm => {
        const x = sm && Object.values(sm)[0]; const org = x && x.organization && x.organization.name; if (org) orgs.add(org);
      }));
    });
    const works = (worksJ.group || []).map(g => {
      const ws = (g['work-summary'] || [])[0] || {};
      const ids = ((g['external-ids'] || {})['external-id'] || []);
      const dois = [...new Set(ids.filter(e => String(e['external-id-type']).toLowerCase() === 'doi' && e['external-id-relationship'] !== 'part-of')
        .map(e => cleanDoi((e['external-id-normalized'] && e['external-id-normalized'].value) || e['external-id-value'])).filter(Boolean))];
      const pd = ws['publication-date'] || {};
      return { title: stripTags(v(ws.title && ws.title.title)), year: pd.year ? Number(v(pd.year)) || null : null, type: ws.type || '',
        journal: v(ws['journal-title']), dois, url: v(ws.url), source: v(ws.source && ws.source['source-name']) };
    }).filter(w => w.title || w.dois.length);
    return { orcid: orcidOf((j['orcid-identifier'] && j['orcid-identifier'].path) || j.path), given: v(nm['given-names']), family: v(nm['family-name']),
      credit: v(nm['credit-name']), others: (((person['other-names'] || {})['other-name']) || []).map(o => o && o.content).filter(Boolean),
      orgs: [...orgs], works };
  }
  function normOrcidWork(w, rank) {
    const doi = w.dois[0] || '';
    return { key: '', openalexId: '', doi, title: w.title, year: w.year, date: w.year ? String(w.year) : '', authors: [], authorIds: [], ships: [],
      venue: w.journal, abstract: '', abstractFrom: '', oaType: '', crType: ORCID_TYPES[w.type] || '', epmcTypes: [], isOA: false, oaStatus: '',
      landing: doi ? `https://doi.org/${doi}` : (/^https?:/i.test(w.url) ? w.url : ''), oaUrl: '', pdf: '', oaHost: '', cites: 0, pct: null,
      top1: false, top10: false, topic: null, keywords: [], retracted: false, sources: ['ORCID'], ranks: { orcid: rank } };
  }
  const deaccent = x => String(x || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const nameToks = x => deaccent(x).split(/[^a-z]+/).filter(Boolean);
  // How a byline name relates to the person: 'full' (given name spelled out), 'initial' (surname + initial only) or 'other'.
  function nameForm(raw, persons) {
    const t = nameToks(raw); if (!t.length) return 'other';
    let best = 'other';
    for (const p of persons || []) {
      const names = [[p.given, p.family], ...((p.others || []).map(o => { const k = nameToks(o); return [k.slice(0, -1).join(' '), k.slice(-1)[0] || '']; }))];
      for (const [g, f] of names) {
        const ft = nameToks(f), gt = nameToks(g);
        if (!ft.length || !ft.every(x => t.includes(x))) continue;
        const rest = t.filter(x => !ft.includes(x));
        if (gt.length && gt[0].length > 1 && rest.includes(gt[0])) return 'full';
        if (gt.length && rest.some(x => x.length === 1 && x === gt[0][0])) best = 'initial';
        else if (gt.length && rest.some(x => x[0] === gt[0][0])) best = best === 'other' ? 'variant' : best;
      }
    }
    return best;
  }
  // "Maicol A. Ochoa" and "M. Ochoa" share the key "ochoa m".
  function coKey(name) { const t = nameToks(name); return t.length ? `${t[t.length - 1]} ${t[0][0]}` : ''; }
  const normOrg = x => deaccent(x).replace(/\b(the|of|university|univ|college|institute|inst)\b/g, ' ').replace(/[^a-z]+/g, ' ').trim();
  function selfShip(w, ev) {
    const sh = w.ships || [];
    return sh.find(a => a.id && ev.ids.has(a.id)) || sh.find(a => a.orcid && ev.orcids.has(a.orcid))
      || sh.find(a => nameForm(a.raw || a.name, ev.persons) !== 'other') || null;
  }
  // ev: { persons:[{given,family,others}], ids:Set(OpenAlex author ids), orcids:Set, orcidDOIs:Set(version keys),
  //       orcidWorks:[{title,year}], crossrefDOIs:Set(version keys), orgs:[names] }
  // Returns Map key -> { status: 'orcid'|'publisher'|'likely'|'unconfirmed', why: [..] }
  function verifyAuthorWorks(works, ev) {
    const out = new Map();
    const confirmed = [];
    for (const w of works) {
      const vk = w.doi ? versionKey(w.doi) : '';
      if (vk && ev.orcidDOIs.has(vk)) out.set(w.key, { status: 'orcid', why: ['On their ORCID record'] });
      else if (ev.orcidWorks.some(o => o.title && titleSimilarity(o.title, w.title) >= 0.9 && (!o.year || !w.year || Math.abs(o.year - w.year) <= 1)))
        out.set(w.key, { status: 'orcid', why: ['On their ORCID record (matched by title)'] });
      else if (vk && ev.crossrefDOIs.has(vk)) out.set(w.key, { status: 'publisher', why: ['The publisher lists their ORCID iD on this paper'] });
      else continue;
      confirmed.push(w);
    }
    const coauthors = new Map(); const orgs = new Set((ev.orgs || []).map(normOrg).filter(Boolean)); const fields = new Set(); const titles = [];
    const selfKeys = new Set((ev.persons || []).map(p => coKey(`${p.given} ${p.family}`)).filter(Boolean));
    const learn = w => {
      const me = selfShip(w, ev);
      (w.ships && w.ships.length ? w.ships : (w.authors || []).map(n => ({ name: n }))).forEach(a => {
        if (a === me) return; const k = coKey(a.name || a.raw); if (!k || selfKeys.has(k)) return;
        if (!coauthors.has(k)) coauthors.set(k, a.name || a.raw);
      });
      if (me) (me.inst || []).forEach(i => { const n = normOrg(i); if (n) orgs.add(n); });
      if (w.topic && w.topic.field) fields.add(w.topic.field);
      titles.push(w.title);
    };
    confirmed.forEach(learn);
    const anyEvidence = confirmed.length > 0;
    for (let round = 0; round < 2; round++) {
      const promoted = [];
      for (const w of works) {
        if (out.has(w.key) && out.get(w.key).status !== 'unconfirmed') continue;
        const me = selfShip(w, ev);
        const form = me ? nameForm(me.raw || me.name, ev.persons) : 'other';
        const shared = [...new Set((w.ships && w.ships.length ? w.ships : (w.authors || []).map(n => ({ name: n })))
          .filter(a => a !== me).map(a => coKey(a.name || a.raw)).filter(k => coauthors.has(k)))].map(k => coauthors.get(k));
        const inst = me ? (me.inst || []).filter(i => orgs.has(normOrg(i))) : [];
        const sameStudy = titles.some(t => titleSimilarity(t, w.title) >= 0.6);
        const fieldOk = !!(w.topic && fields.has(w.topic.field));
        const shownName = me ? (me.raw || me.name) : '';
        let why = null;
        if (anyEvidence && shared.length >= 2) why = `Shares co-authors with their confirmed papers: ${shared.slice(0, 3).join(', ')}${shared.length > 3 ? ' and others' : ''}`;
        else if (anyEvidence && sameStudy) why = 'Same study as a confirmed paper (for example a preprint and its published version)';
        else if (form === 'full' && (inst.length || shared.length || fieldOk || !anyEvidence))
          why = `Their full name appears on it (“${shownName}”)${inst.length ? ` with ${inst[0]}` : shared.length ? `, with co-author ${shared[0]}` : fieldOk ? ', in the same field as their confirmed papers' : ''}`;
        else if (inst.length && shared.length) why = `Affiliation ${inst[0]} and co-author ${shared[0]} match their confirmed papers`;
        if (why) { out.set(w.key, { status: 'likely', why: [why] }); promoted.push(w); continue; }
        const reasons = [];
        if (form === 'initial' || form === 'variant') reasons.push(`Name given only as “${shownName}”`);
        else if (!me) reasons.push('Their name was not found in the author list');
        if (me && (me.inst || []).length) reasons.push(`Affiliation: ${me.inst.slice(0, 2).join('; ')}, not in their ORCID record or confirmed papers`);
        if (anyEvidence && !shared.length) reasons.push('No co-authors in common with their confirmed papers');
        if (anyEvidence && w.topic && w.topic.field && !fieldOk) reasons.push(`Field: ${w.topic.field}`);
        reasons.unshift('Not on their ORCID record');
        out.set(w.key, { status: 'unconfirmed', why: reasons });
      }
      if (!promoted.length) break;
      promoted.forEach(learn);
    }
    return out;
  }
  // Groups works that are versions of one preprint (same DOI apart from -v2, /v3 …); returns keys to hide and counts.
  function collapseVersions(works) {
    const groups = new Map();
    works.forEach(w => { if (!w.doi) return; const k = versionKey(w.doi); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(w); });
    const hide = new Set(); const count = new Map();
    groups.forEach(list => {
      if (list.length < 2) return;
      list.sort((a, b) => (b.ranks.oa_author !== undefined) - (a.ranks.oa_author !== undefined) || versionNo(b.doi) - versionNo(a.doi) || (b.year || 0) - (a.year || 0));
      list.slice(1).forEach(w => hide.add(w.key)); count.set(list[0].key, list.length);
    });
    return { hide, count };
  }
  function hIndex(cites) { const c = cites.slice().sort((a, b) => b - a); let h = 0; while (h < c.length && c[h] >= h + 1) h++; return h; }

  // ---------------------------------------------------------------- Lab: taste learned from swiping, and the night-sky layout
  // Words of a paper that swipes teach: title, keywords and topic, without stop words, keyed by stem.
  function tasteTerms(w) {
    const text = [w.title, ...(w.keywords || []), w.topic && w.topic.name].filter(Boolean).join(' ');
    const seen = new Map();
    words(text).forEach(x => {
      const lw = x.toLowerCase();
      if (STOP.has(lw) || lw.length < 3 || /^[\d.,-]+$/.test(lw)) return;
      const st = stem(lw); if (!seen.has(st)) seen.set(st, lw);
    });
    return [...seen].map(([st, word]) => ({ stem: st, word }));
  }
  // Returns a new taste map: stem -> { w: weight in [-3, 6], word }.
  function learnTaste(taste, w, delta) {
    const t = Object.assign({}, taste || {});
    tasteTerms(w).forEach(({ stem: st, word }) => {
      const cur = t[st] || { w: 0, word };
      const nw = Math.max(-3, Math.min(6, Math.round((cur.w + delta) * 100) / 100));
      if (Math.abs(nw) < 0.01) delete t[st]; else t[st] = { w: nw, word: cur.word || word };
    });
    return t;
  }
  // A small ranking nudge (at most ±0.08) for papers that share words with ones you swiped right or up on.
  function tasteBonus(w, taste) {
    if (!taste) return 0;
    let sum = 0; tasteTerms(w).forEach(({ stem: st }) => { if (taste[st]) sum += taste[st].w; });
    return Math.tanh(sum / 6) * 0.08;
  }
  function topTaste(taste, n = 8) {
    const arr = Object.values(taste || {});
    return { liked: arr.filter(x => x.w > 0).sort((a, b) => b.w - a.w).slice(0, n).map(x => x.word),
      disliked: arr.filter(x => x.w < 0).sort((a, b) => a.w - b.w).slice(0, n).map(x => x.word) };
  }
  function hash32(str) { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function seeded(seed) { let a = seed || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  // Night sky: each item is a star, each field a constellation. Positions depend only on the items, so the sky is stable.
  // items: [{ key, field, cites, date, faint }]
  function skyLayout(items, { W = 360, H = 440, margin = 30 } = {}) {
    const groups = new Map();
    items.forEach(it => { const f = it.field || 'Not classified'; if (!groups.has(f)) groups.set(f, []); groups.get(f).push(it); });
    const gs = [...groups].map(([field, list]) => ({ field, list })).sort((a, b) => b.list.length - a.list.length || a.field.localeCompare(b.field));
    const n = gs.length; const cx = W / 2, cy = H / 2;
    const rad = gs.map(g => Math.min(Math.min(W, H) / 3.4, 16 + 9 * Math.sqrt(g.list.length)));
    const cen = gs.map((g, i) => {
      if (n === 1) return [cx, cy + 8];
      const r = Math.sqrt((i + 0.5) / n), a = i * 2.39996 - 1.2;
      return [cx + Math.cos(a) * r * (W / 2 - margin - rad[i]), cy + 8 + Math.sin(a) * r * (H / 2 - margin - rad[i])];
    });
    for (let it = 0; it < 80; it++) { // push constellations apart, keep them inside
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const dx = cen[j][0] - cen[i][0], dy = cen[j][1] - cen[i][1], d = Math.hypot(dx, dy) || 0.01, min = rad[i] + rad[j] + 26;
        if (d < min) { const k = (min - d) / 2 / d; cen[i][0] -= dx * k; cen[i][1] -= dy * k; cen[j][0] += dx * k; cen[j][1] += dy * k; }
      }
      cen.forEach((c, i) => { c[0] = Math.max(margin + rad[i], Math.min(W - margin - rad[i], c[0])); c[1] = Math.max(margin + 18 + rad[i], Math.min(H - margin - rad[i], c[1])); });
    }
    const stars = [], lines = [];
    gs.forEach((g, gi) => {
      const [gx, gy] = cen[gi]; const R = rad[gi];
      const placed = [];
      g.list.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.key).localeCompare(String(b.key))).forEach(it => {
        const rnd = seeded(hash32(it.key));
        let best = null;
        for (let k = 0; k < 14; k++) {
          const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R;
          const x = gx + Math.cos(a) * r, y = gy + Math.sin(a) * r * 0.85;
          const d = placed.reduce((m, p) => Math.min(m, Math.hypot(p.x - x, p.y - y)), Infinity);
          if (!best || d > best.d) best = { x, y, d };
          if (d > 20) break;
        }
        const s = { key: it.key, x: Math.round(best.x * 10) / 10, y: Math.round(best.y * 10) / 10, r: Math.round((1.8 + Math.min(4.2, 1.3 * Math.log10(1 + (it.cites || 0)))) * 100) / 100, field: g.field, faint: !!it.faint };
        const bright = placed.filter(p => !p.faint);
        if (!s.faint && bright.length) {
          const near = bright.reduce((a, b) => (Math.hypot(a.x - s.x, a.y - s.y) <= Math.hypot(b.x - s.x, b.y - s.y) ? a : b));
          lines.push([near.x, near.y, s.x, s.y]);
        }
        placed.push(s); stars.push(s);
      });
    });
    const labels = gs.map((g, i) => ({ field: g.field, count: g.list.filter(x => !x.faint).length, later: g.list.filter(x => x.faint).length,
      x: Math.round(cen[i][0]), y: Math.round(Math.max(16, cen[i][1] - rad[i] - 10)) }));
    return { W, H, stars, lines, labels };
  }
  function skyBackground(W, H, count = 70) {
    const rnd = seeded(20261114); const out = [];
    for (let i = 0; i < count; i++) out.push({ x: Math.round(rnd() * W), y: Math.round(rnd() * H), r: Math.round((0.3 + rnd() * 0.8) * 10) / 10, o: Math.round((0.15 + rnd() * 0.45) * 100) / 100 });
    return out;
  }

  // ---------------------------------------------------------------- Lab: trail quests
  // A quest follows references back in time ("where did this start?") or citing papers forward ("where did it lead?").
  function questStep(w, via) {
    return { key: w.key, openalexId: w.openalexId || '', title: w.title || '', year: w.year || null, authors: (w.authors || []).slice(0, 3),
      more: (w.authors || []).length > 3, venue: w.venue || '', doi: w.doi || '', cites: w.cites || 0, via: via || 'start' };
  }
  // Two suggestions for the next step: the closest match in wording (a small step), and a big leap to an older
  // (or, going forward, newer) well-cited paper that still shares a word with the trail.
  function questSuggest(cands, steps, goal) {
    if (!steps.length) return { close: null, leap: null };
    const trailWords = new Map();
    steps.forEach((st, i) => words(st.title).forEach(x => { const lw = x.toLowerCase(); if (!STOP.has(lw) && lw.length > 2 && (i === 0 || i === steps.length - 1)) trailWords.set(stem(lw), lw); }));
    const here = steps[steps.length - 1].year; const seen = new Set(steps.map(x => x.key));
    let close = null, leap = null;
    cands.forEach(w => {
      if (seen.has(w.key) || !w.openalexId || !w.year || !here) return;
      const gap = goal === 'origin' ? here - w.year : w.year - here;
      if (gap < 0) return;
      const ws = new Set(contentStems(w.title));
      const shared = [...trailWords.keys()].filter(k => ws.has(k)).map(k => trailWords.get(k));
      const sim = shared.length / Math.sqrt(Math.max(1, trailWords.size) * Math.max(1, ws.size));
      const cite = Math.min(1, Math.log10(1 + (w.cites || 0)) / 4);
      const cScore = 0.55 * sim + 0.3 * cite + 0.15 * Math.min(1, gap / 30);
      if (shared.length && (!close || cScore > close.score)) close = { key: w.key, score: cScore, shared, gap, kind: 'close' };
      if (gap >= 8 && shared.length) {
        const lScore = 0.55 * cite + 0.45 * Math.min(1, gap / 40);
        if (!leap || lScore > leap.score) leap = { key: w.key, score: lScore, shared, gap, kind: 'leap' };
      }
    });
    if (close && leap && close.key === leap.key) leap = null;
    return { close, leap };
  }
  // Share code: "o:W1.W2.W3" (origin) or "f:…" (forward). Only OpenAlex ids, so a link carries no personal data.
  function trailCode(goal, steps) { return `${goal === 'origin' ? 'o' : 'f'}:${steps.map(x => String(x.openalexId).split('/').pop()).join('.')}`; }
  function parseTrailCode(code) {
    const m = String(code || '').match(/^([of]):(W\d+(?:\.W\d+){0,39})$/);
    return m ? { goal: m[1] === 'o' ? 'origin' : 'forward', ids: m[2].split('.') } : null;
  }
  function trailStats(steps) {
    const ys = steps.map(x => x.year).filter(Boolean);
    return { hops: Math.max(0, steps.length - 1), from: steps[0] && steps[0].year, to: steps.length ? steps[steps.length - 1].year : null, span: ys.length ? Math.max(...ys) - Math.min(...ys) : 0 };
  }

  // ---------------------------------------------------------------- Lab: papers of the day
  // New papers from chosen publishers, found through Crossref (which lists papers the day their DOI is registered).
  const PUBLISHERS = [
    { id: 'acs', name: 'ACS', full: 'American Chemical Society journals', filter: 'member:316', oa: 'P4310320006', prefixes: ['10.1021'], on: true },
    { id: 'wiley', name: 'Wiley', full: 'Wiley journals', filter: 'member:311', oa: 'P4310320595', prefixes: ['10.1002', '10.1111'], on: true },
    { id: 'nature', name: 'Nature', full: 'Nature Portfolio journals', filter: 'prefix:10.1038', oa: 'P4310319908', prefixes: ['10.1038'], on: true },
    { id: 'science', name: 'Science', full: 'Science family (AAAS)', filter: 'member:221', oa: 'P4310315823', prefixes: ['10.1126'], on: true },
    { id: 'rsc', name: 'RSC', full: 'Royal Society of Chemistry', filter: 'member:292', oa: 'P4310320556', prefixes: ['10.1039'], on: false },
    { id: 'aip', name: 'AIP', full: 'AIP Publishing (J. Chem. Phys. and more)', filter: 'member:317', oa: 'P4310320061', prefixes: ['10.1063', '10.1116'], on: false },
    { id: 'aps', name: 'APS', full: 'American Physical Society (Phys. Rev.)', filter: 'member:16', oa: 'P4310320261', prefixes: ['10.1103'], on: false },
    { id: 'elsevier', name: 'Elsevier', full: 'Elsevier journals', filter: 'member:78', oa: 'P4310320990', prefixes: ['10.1016'], on: false },
    { id: 'springer', name: 'Springer', full: 'Other Springer journals', filter: 'member:297', oa: 'P4310319965', prefixes: ['10.1007', '10.1186'], on: false },
  ];
  // Which chosen publisher a DOI belongs to (by DOI prefix), or null.
  function pubOfDoi(doi, pubs) { const pre = String(doi || '').toLowerCase().split('/')[0]; const p = pubs.find(x => x.prefixes.includes(pre)); return p ? p.id : null; }
  // The window papers of the day look at: the last `days` days, as a UTC date.
  function todayWindow(now = Date.now(), days = 5) { return new Date(now - days * 864e5).toISOString().slice(0, 10); }
  // Crossref registers DOIs for old papers too (back issues, corrections to old records). A paper counts as new when it
  // went online within a week of the window (or, with no online date, its earliest date is no older than a month).
  function crossrefRecent(it, since) {
    const dp = k => (it[k] && it[k]['date-parts'] && it[k]['date-parts'][0]) || null;
    const iso = a => a.map((x, i) => (i ? String(x).padStart(2, '0') : String(x))).join('-');
    const start = Date.parse(since + 'T00:00:00Z');
    const on = dp('published-online');
    if (on && on.length === 3) return Date.parse(iso(on) + 'T00:00:00Z') >= start - 7 * 864e5;
    const pub = dp('published') || dp('issued');
    if (!pub) return true;
    if (pub.length === 3) return Date.parse(iso(pub) + 'T00:00:00Z') >= start - 31 * 864e5;
    if (pub.length === 2) return Date.UTC(pub[0], pub[1], 1) >= start - 31 * 864e5; // end of that month
    return pub[0] >= new Date(start).getUTCFullYear();
  }
  function normS2(p, rank) {
    const doi = cleanDoi(p.externalIds && p.externalIds.DOI);
    return {
      key: '', openalexId: '', doi, title: normSpace(p.title || ''), year: p.year || (p.publicationDate ? Number(p.publicationDate.slice(0, 4)) : null), date: p.publicationDate || '',
      authors: (p.authors || []).map(a => a.name).filter(Boolean), venue: (p.journal && p.journal.name) || p.venue || '',
      abstract: normSpace(p.abstract || ''), abstractFrom: p.abstract ? 'Semantic Scholar' : '', oaType: '', crType: '', epmcTypes: [], isOA: false, oaStatus: '',
      landing: doi ? `https://doi.org/${doi}` : (p.url || ''), oaUrl: '', pdf: '', oaHost: '', cites: p.citationCount || 0, pct: null, top1: false, top10: false,
      topic: null, keywords: [], retracted: false, sources: ['Semantic Scholar'], ranks: { s2: rank },
    };
  }
  // Topics you type (comma or line separated) come first, then your profile's terms.
  // Papers of the day. Crossref searches titles only, and titles rarely carry an umbrella term such as "ultrafast
  // spectroscopy", so each topic also counts a few related phrasings (shown to the user). Kept small and curated.
  const TODAY_RELATED = [
    [['ultrafast spectroscopy', 'ultrafast dynamics', 'femtosecond spectroscopy', 'time-resolved spectroscopy', 'ultrafast'],
      ['transient absorption', 'pump-probe', 'femtosecond dynamics', 'ultrafast dynamics', 'two-dimensional electronic spectroscopy', '2D electronic spectroscopy', 'two-dimensional infrared', '2D IR',
        'excited-state dynamics', 'transient infrared', 'time-resolved infrared', 'coherent dynamics', 'vibrational coherence', 'time-domain spectroscopy', 'terahertz spectroscopy']],
    [['transient absorption', 'transient absorption spectroscopy'], ['pump-probe', 'femtosecond absorption', 'excited-state absorption']],
    [['two-dimensional electronic spectroscopy', '2d electronic spectroscopy', '2des'], ['2DES', '2D electronic spectroscopy', 'two-dimensional spectroscopy', 'electronic coherence']],
    [['two-dimensional infrared', 'two-dimensional infrared spectroscopy', '2d ir', '2d-ir', '2dir'], ['2D IR', '2D-IR', 'two-dimensional infrared', 'vibrational dynamics']],
    [['nonlinear spectroscopy', 'coherent spectroscopy', 'multidimensional spectroscopy'], ['two-dimensional spectroscopy', 'pump-probe', 'four-wave mixing', 'sum-frequency generation', 'coherent dynamics']],
    [['vibrational spectroscopy'], ['infrared spectroscopy', 'Raman spectroscopy', 'vibrational dynamics']],
    [['singlet fission'], ['triplet pair', 'multiexciton']],
    [['exciton diffusion', 'exciton transport', 'exciton migration'], ['exciton diffusion', 'exciton transport', 'exciton migration']],
    [['perylene diimide', 'perylene bisimide', 'pdi', 'pbi'], ['perylene diimide', 'perylene bisimide', 'perylene']],
    [['ion transport', 'ion conduction'], ['ion transport', 'ionic conductivity', 'ion conduction']],
  ];
  const TODAY_SPLIT = s => stems(String(s || '').replace(/[-‐-―]/g, ' '));
  function todayVariants(text) {
    const low = normSpace(text).toLowerCase(); const key = TODAY_SPLIT(low).join(' ');
    const out = [];
    for (const [keys, alts] of TODAY_RELATED) if (keys.some(k => TODAY_SPLIT(k).join(' ') === key)) out.push(...alts.map(a => ({ text: a, weight: 0.85 })));
    for (const g of SYNONYMS) for (const m of g) {
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${m.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'u');
      if (!re.test(low)) continue;
      const guard = SYN_GUARD.get(g[0].text); if (guard && !guard.some(x => low.includes(x))) continue;
      g.filter(o => o !== m).forEach(o => out.push({ text: low.replace(re, `$1${o.text}`), weight: 0.95 }));
    }
    const seen = new Set([key]);
    return out.filter(v => { const k = TODAY_SPLIT(v.text).join(' '); if (!k || seen.has(k)) return false; seen.add(k); return true; });
  }
  function todayTerms(profile, topicsText) {
    const own = String(topicsText || '').split(/[,;\n]+/).map(normSpace).filter(t => t.length > 1)
      .map(t => ({ text: t, stems: phraseStems(t), kind: 'interest', weight: 1.2 })).filter(t => t.stems.length);
    const seen = new Set();
    const base = [...own, ...profileTerms(profile)].filter(t => { const k = t.stems.join(' '); if (seen.has(k)) return false; seen.add(k); return true; });
    const out = [];
    base.forEach((t, g) => {
      out.push(Object.assign({}, t, { group: g, of: t.text }));
      if (t.kind === 'interest') todayVariants(t.text).forEach(v => out.push({ text: v.text, stems: phraseStems(v.text), kind: 'related', weight: t.weight * v.weight, group: g, of: t.text }));
    });
    return out;
  }
  // The related phrasings, for showing the user what else counts.
  function todayRelated(terms) { return terms.filter(t => t.kind === 'related').map(t => t.text); }
  function todayQuery(terms, max = 14) { return terms.filter(t => t.kind !== 'related').slice(0, max).map(t => t.text).join(' '); }
  // Crossref matches any of a query's words in titles, but finds nothing when a query has many words, so the words
  // (each once; topics first, then related phrasings) are sent in short groups of at most `maxWords`.
  function todayQueries(terms, maxTotal = 28, maxWords = 7) {
    const ws = []; const seen = new Set();
    const add = t => words(t.text).forEach(w => { const k = w.toLowerCase(); if (STOP.has(k) || GENERIC_SINGLE.has(k) || seen.has(k)) return; seen.add(k); ws.push(w.toLowerCase()); });
    terms.filter(t => t.kind !== 'related').forEach(add); terms.filter(t => t.kind === 'related').forEach(add);
    const groups = [];
    for (let i = 0; i < Math.min(ws.length, maxTotal); i += maxWords) groups.push(ws.slice(i, Math.min(i + maxWords, maxTotal)).join(' '));
    return groups;
  }
  const NOT_PAPER = /^((author|publisher)(['’]s)? correction|correction|corrigendum|erratum|retraction|retracted article|expression of concern|issue information|masthead|(front|back|inside) cover|cover (picture|image|feature|story|art)|table of contents|graphical abstract|editorial board|in this issue|this week in|news in brief|research highlights?)\b/i;
  function todayPrep(w) {
    if (!w._tp) w._tp = { t: TODAY_SPLIT(w.title), a: TODAY_SPLIT(w.abstract), k: TODAY_SPLIT([...(w.keywords || []), w.topic ? w.topic.name : ''].join(' ; ')) };
    return w._tp;
  }
  // All words of a phrase within a few words of each other ("ultrafast transient absorption spectroscopy" counts for
  // "ultrafast spectroscopy"; "ultrafast hydrogen spillover … Raman spectroscopy" does not).
  function nearAll(hay, st, slack = 3) {
    const want = new Set(st); if (!want.size || hay.length < want.size) return false;
    const span = st.length + slack;
    for (let i = 0; i < hay.length; i++) {
      if (!want.has(hay[i])) continue;
      const got = new Set(); for (let j = i; j < Math.min(hay.length, i + span); j++) if (want.has(hay[j])) got.add(hay[j]);
      if (got.size === want.size) return true;
    }
    return false;
  }
  function matchToday(p, st) {
    if (hasPhrase(p.t, st)) return { s: 1, where: 'title' };
    if (hasPhrase(p.a, st)) return { s: 0.7, where: 'abstract' };
    if (st.length > 1 && nearAll(p.t, st)) return { s: 0.6, where: 'title' };
    if (hasPhrase(p.k, st)) return { s: 0.45, where: 'keywords' };
    if (st.length > 1 && nearAll(p.a, st)) return { s: 0.45, where: 'abstract' };
    return null;
  }
  // Each topic counts once (its best phrasing). Topics that match many of today's papers (e.g. "charge transfer")
  // count for less than the most specific one, so a paper needs a specific match to make the list; with one topic
  // nothing is discounted. The same title under two DOIs (e.g. Angewandte's two editions) appears once.
  function rankToday(works, terms, minScore = 0.15) {
    // Wiley lists cover and frontispiece pages as articles, titled "… (Adv. Mater. 46/2026)".
    const list = works.filter(w => w.title && !NOT_PAPER.test(w.title) && !/\(\s*[A-Z][^()]*\b\d+\/(19|20)\d\d\s*\)\s*$/.test(w.title));
    const N = Math.max(1, list.length);
    const ts = terms.map(t => Object.assign({}, t, { sp: TODAY_SPLIT(t.text), group: t.group == null ? t.text : t.group }));
    const groupOf = new Map(); ts.forEach(t => { if (!groupOf.has(t.group)) groupOf.set(t.group, []); groupOf.get(t.group).push(t); });
    const best = (w, g) => {
      const p = todayPrep(w); let b = null;
      for (const t of groupOf.get(g)) { if (!t.sp.length) continue; const m = matchToday(p, t.sp); if (!m) continue;
        const s = m.s * t.weight * (t.sp.length > 1 ? 1 : 0.6); if (!b || s > b.s) b = { s, text: t.text, where: m.where, of: t.of, g, related: t.kind === 'related' }; }
      return b;
    };
    const per = new Map(list.map(w => [w, [...groupOf.keys()].map(g => [g, best(w, g)])]));
    const idf = new Map([...groupOf.keys()].map(g => { const df = list.filter(w => per.get(w).some(([k, b]) => k === g && b)).length;
      return [g, df ? (N > 4 && df > 1 ? Math.log(1 + N / df) / Math.log(1 + N) : 1) : 0]; }));
    const top = Math.max(0, ...idf.values()) || 1;
    const seenTitles = new Set();
    return list.map(w => {
      const hits = per.get(w).filter(([, b]) => b).map(([g, b]) => Object.assign({}, b, { s: b.s * idf.get(g) / top })).sort((a, b) => b.s - a.s);
      return { w, score: Math.min(1, hits.reduce((a, h) => a + h.s, 0) / 2.5), hits };
    })
      .filter(x => x.score >= minScore)
      .sort((a, b) => b.score - a.score || String(b.w.created || b.w.date).localeCompare(String(a.w.created || a.w.date)))
      .filter(x => { const k = normTitle(x.w.title); if (seenTitles.has(k)) return false; seenTitles.add(k); return true; });
  }
  // Papers of the day, step 4: combine the topic score with the sources' own ranks (rank fusion), label each paper,
  // and pick a varied list: no more than a few papers on the same topic in a row, no near-duplicate titles, at most
  // 5 that only share your methods and 3 that are only nearby (suggested from your saved papers without sharing a topic).
  const METHOD_RE = /(spectroscop|microscop|scattering|diffraction|tomograph|imaging|simulation|molecular dynamics|density functional|\bdft\b|calculation|computation|\bnmr\b|\bepr\b|transient absorption|pump-probe|\b2d ?-?ir\b|\b2des\b|two-dimensional (electronic|infrared)|femtosecond|time-resolved|ultrafast|mass spectrometry|chromatograph|voltammetry|impedance|machine learning|crystallograph|interferometr|photoemission|calorimetr)/i;
  const TODAY_LABELS = { direct: 'Your topic', method: 'Your method', adjacent: 'Nearby' };
  function rankTodayV2(works, terms, { max = 15, minScore = 0.15 } = {}) {
    const lex = rankToday(works, terms, 0);
    const rrf = w => Object.entries(w.ranks || {}).reduce((a, [, r]) => a + 1 / (20 + r), 0);
    const maxR = Math.max(1e-9, ...lex.map(x => rrf(x.w)));
    const isMethod = new Map(); terms.forEach(t => { const g = t.group == null ? t.text : t.group; if (!isMethod.has(g)) isMethod.set(g, METHOD_RE.test(t.of || t.text)); });
    const anySubject = [...isMethod.values()].some(m => !m);
    const cands = lex.map(x => {
      const r = rrf(x.w) / maxR;
      let label = 'direct';
      if (!x.hits.length) label = 'adjacent';
      else if (anySubject && x.hits.every(h => isMethod.get(h.g))) label = 'method';
      const pass = x.score >= minScore || (!x.hits.length && x.w.ranks && x.w.ranks.s2 != null);
      return Object.assign({}, x, { rrf: r, label, final: x.score + 0.15 * r + (x.hits.length ? 0 : 0.1), pass });
    }).filter(x => x.pass);
    const caps = { direct: max, method: 5, adjacent: 3 }; const perLabel = {}; const perGroup = new Map(); const picked = [];
    const left = cands.slice();
    while (picked.length < max && left.length) {
      let bi = -1, bv = -Infinity;
      left.forEach((x, i) => {
        if ((perLabel[x.label] || 0) >= caps[x.label]) return;
        const g = x.hits[0] ? x.hits[0].g : '_';
        const sim = picked.reduce((m, y) => Math.max(m, titleSimilarity(x.w.title, y.w.title)), 0);
        if (sim >= 0.85) return; // the same paper under another title or DOI
        const v = x.final - 0.06 * (perGroup.get(g) || 0) - (sim > 0.6 ? 0.3 : 0);
        if (v > bv) { bv = v; bi = i; }
      });
      if (bi < 0) break;
      const x = left.splice(bi, 1)[0]; picked.push(x);
      perLabel[x.label] = (perLabel[x.label] || 0) + 1; const g = x.hits[0] ? x.hits[0].g : '_'; perGroup.set(g, (perGroup.get(g) || 0) + 1);
    }
    return picked;
  }

  // ---------------------------------------------------------------- orbit: what your saved papers have in common
  // The phrases (1–3 words) that recur across saved papers' titles and abstracts, or, for one paper, that recur in it.
  // Recent saves count more (half weight after 90 days); title phrases and longer phrases count more.
  function orbitTerms(works, { now = Date.now(), max = 20 } = {}) {
    const docs = (works || []).filter(w => w && w.title).map(w => {
      const fade = w.savedAt ? Math.pow(0.5, Math.max(0, now - Date.parse(w.savedAt)) / (90 * 864e5)) : 1;
      const grams = new Map();
      const addGrams = (ws, inTitle) => {
        for (let n = 1; n <= 3; n++) for (let i = 0; i + n <= ws.length; i++) {
          const g = ws.slice(i, i + n); const lo = g.map(x => x.toLowerCase());
          if (lo.some(x => STOP.has(x) || /^\d+$/.test(x) || x.length < 2)) continue;
          if (n === 1 && (lo[0].length < 6 || GENERIC_SINGLE.has(lo[0]))) continue;
          if (n > 1 && lo.every(x => GENERIC_SINGLE.has(x) || STOP.has(x))) continue;
          const st = g.map(stem); const key = st.join(' ');
          const e = grams.get(key) || { text: lo.join(' '), stems: st, inTitle: false, n: 0 }; e.inTitle = e.inTitle || inTitle; e.n++; grams.set(key, e);
        }
      };
      addGrams(words(w.title), true);
      splitSentences(w.abstract || '').slice(0, 12).forEach(x => addGrams(words(x), false));
      return { fade, grams };
    });
    const tally = new Map();
    docs.forEach(d => d.grams.forEach((g, k) => {
      const t = tally.get(k) || { text: g.text, stems: g.stems, df: 0, w: 0 };
      t.df++; t.w += d.fade * (g.inTitle ? 1.5 : 1) * (g.stems.length > 1 ? 1.25 : 1) * Math.min(3, g.n); tally.set(k, t);
    }));
    let list = [...tally.values()];
    if (docs.length > 1) list = list.filter(t => t.df >= 2);
    else if (docs.length === 1) { // one paper: its title phrases and phrases its abstract repeats (else a few of its longer phrases)
      const g = docs[0].grams; const key = t => t.stems.join(' ');
      const strong = list.filter(t => g.get(key(t)).inTitle || g.get(key(t)).n >= 2);
      list = strong.length >= 4 ? strong : strong.concat(list.filter(t => !strong.includes(t) && t.stems.length > 1).slice(0, 4 - strong.length));
    }
    list.sort((a, b) => b.w - a.w || b.stems.length - a.stems.length);
    const kept = [];
    for (const t of list) {
      if (kept.some(k => k.stems.length > t.stems.length && hasPhrase(k.stems, t.stems) && k.df >= t.df)) continue;
      kept.push(t); if (kept.length >= max) break;
    }
    const top = kept[0] ? kept[0].w : 1;
    return kept.map(t => ({ text: t.text, stems: t.stems, kind: 'orbit', weight: 0.5 + 0.7 * t.w / top, df: t.df }));
  }
  // "More like these": papers found from the seed papers (similar abstracts, citation links, OpenAlex's related works),
  // ranked by the phrases they share with the seeds, how strongly the sources found them and, if the on-device model
  // is on, how close their meaning is to the seeds.
  const LIKE_W = { like_sem: 1, like_rel: 0.8, like_cite: 0.7, like_ref: 0.7 };
  function rankLike(works, { terms = [], sem = null, nowYear = new Date().getFullYear() } = {}) {
    const rr = w => Object.entries(w.ranks || {}).reduce((a, [ch, r]) => a + (LIKE_W[ch] || 0.6) / (20 + r), 0);
    const maxR = Math.max(1e-9, ...works.map(rr));
    works.forEach(w => {
      const pr = scoreProfile(w, terms); const rrf = rr(w) / maxR;
      const sm = sem && sem.get(w.key); const sq = sm ? Math.max(0, Math.min(1, (sm.q - 0.2) / 0.5)) : null;
      const age = w.year ? Math.max(0, nowYear - w.year) : 10; const recency = Math.max(0, Math.min(1, 1 - (age - 2) / 13));
      const impact = w.pct != null ? w.pct : Math.min(1, Math.log1p(w.cites || 0) / Math.log1p(1000));
      const score = sq == null ? 0.55 * pr.score + 0.37 * rrf + 0.05 * impact + 0.03 * recency : 0.4 * pr.score + 0.3 * rrf + 0.22 * sq + 0.05 * impact + 0.03 * recency;
      w.rank = { score, qrel: score, q: pr.score, rrf, prof: 0, profRaw: 0, impact, recency, qHits: [], relHits: [], pHits: [], sem: sm || null, missing: [], scoring: 'like', shared: pr.hits.slice(0, 3).map(h => h.text) };
    });
    return works.slice().sort((a, b) => b.rank.score - a.rank.score);
  }
  // The AI check (optional, your own key): the model grades each of the top papers 0–3 with a short reason.
  function buildCheckPrompt(q, papers) {
    const system = 'You judge whether research papers address a literature search. Use only the title and abstract given. For each numbered paper give a grade: 3 = directly addresses the search (same system, mechanism or question), 2 = relevant, 1 = only touches the topic, 0 = not relevant. A paper that mentions the words but studies something else is 0 or 1. Reply with exactly one line per paper, in the form: number | grade | reason of at most 12 words. No other text.';
    const user = `Search: ${q}\n\n` + papers.map((w, i) => `[${i + 1}] ${w.title}${w.year ? ` (${w.year})` : ''}\nAbstract: ${w.abstract ? String(w.abstract).slice(0, 700) : '(none; judge from the title)'}`).join('\n\n');
    return { system, user };
  }
  function parseCheck(text, n) {
    const out = new Map();
    String(text || '').split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*\[?(\d{1,3})\]?\s*[|:.)-]\s*([0-3])\s*(?:[|:–—-]\s*(.*))?$/);
      if (!m) return; const i = Number(m[1]); if (i < 1 || i > n || out.has(i)) return;
      out.set(i, { grade: Number(m[2]), reason: normSpace(m[3] || '').replace(/^["“]|["”]$/g, '').slice(0, 140) });
    });
    return out;
  }

  // ---------------------------------------------------------------- benchmark (researcher-graded searches)
  // Grades: 0 not relevant, 1 slightly, 2 relevant, 3 exactly what was asked. Ungraded papers count as 0 in nDCG
  // (the ideal ordering uses all grades given), and the share of graded papers in the top k is reported beside it.
  function ndcgAt(keys, grades, k = 10) {
    const g = x => (grades[x] != null ? grades[x] : 0);
    const dcg = keys.slice(0, k).reduce((s, x, i) => s + (Math.pow(2, g(x)) - 1) / Math.log2(i + 2), 0);
    const ideal = Object.values(grades).sort((a, b) => b - a).slice(0, k).reduce((s, v, i) => s + (Math.pow(2, v) - 1) / Math.log2(i + 2), 0);
    return ideal ? dcg / ideal : 0;
  }
  function precisionAt(keys, grades, k = 5, min = 2) { const top = keys.slice(0, k); return top.length ? top.filter(x => (grades[x] || 0) >= min).length / k : 0; }
  function judgedAt(keys, grades, k = 10) { const top = keys.slice(0, k); return top.length ? top.filter(x => grades[x] != null).length / top.length : 0; }
  function benchMetrics(keys, grades) { return { ndcg10: ndcgAt(keys, grades, 10), p5: precisionAt(keys, grades, 5), judged10: judgedAt(keys, grades, 10) }; }
  function meanMetrics(list) {
    const n = list.length || 1; const o = { ndcg10: 0, p5: 0, judged10: 0 };
    list.forEach(m => { o.ndcg10 += m.ndcg10 / n; o.p5 += m.p5 / n; o.judged10 += m.judged10 / n; });
    return o;
  }

  // Start of the window to check: the last check (at most 7 days back), or 2 days back the first time. UTC dates, as Crossref uses.
  function todaySince(lastRunAt, now = Date.now(), maxDays = 7) {
    const day = 864e5;
    const from = lastRunAt ? Math.max(Date.parse(lastRunAt) - day / 2, now - maxDays * day) : now - 2 * day;
    return new Date(from).toISOString().slice(0, 10);
  }

  const Core = {
    stem, stems, words, contentStems, phraseStems, hasPhrase, splitSentences, cleanDoi, normTitle, stripTags, reconstructAbstract,
    extractGlossary, extractProfile, profileTerms, profileText, analyzeQuery, assessFieldAmbiguity,
    normOpenAlex, normCrossref, normEPMC, workKey, dedupeInto, classifyType, prepWork, scoreQuery, scoreProfile, rankWorks,
    explain, highlightStems, computeThemes, parseScholarLines, titleSimilarity, compareWithList, toBibTeX, toRIS, toCSV, slim,
    normAuthor, groupByField, isDOI, initials,
    orcidOf, versionKey, versionNo, parseOrcidRecord, normOrcidWork, nameForm, coKey, verifyAuthorWorks, collapseVersions, hIndex,
    tasteTerms, learnTaste, tasteBonus, topTaste, skyLayout, skyBackground, hash32,
    questStep, questSuggest, trailCode, parseTrailCode, trailStats,
    PUBLISHERS, todayTerms, todayQuery, todayQueries, todayRelated, rankToday, todaySince,
    orbitTerms, rankLike, buildCheckPrompt, parseCheck,
    rankTodayV2, TODAY_LABELS, METHOD_RE, pubOfDoi, todayWindow, crossrefRecent, normS2,
    tokens, chemNorm, matchTermV2, groupStats, scoreQueryV2, nearAll, TIER_W, ndcgAt, precisionAt, judgedAt, benchMetrics, meanMetrics,
    relatedTerms, normOrcid, orcidChecksumOk, profileFromWorks, mergeProfiles, buildAnswerPrompt, checkAnswer, expandRefs, sortWorks,
    ACRONYMS, SYNONYMS, FIELD_DOMAIN, DOMAINS, STOP,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);
