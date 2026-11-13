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

  function normSpace(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  function stem(w) {
    let s = String(w).toLowerCase().replace(/[’']/g, '');
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

  function words(text) { return String(text || '').match(WORD_RE) || []; }
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

  // Curated near-synonyms and spelling variants (deterministic, small, transparent to the user).
  const SYNONYMS = [
    ['migration', 'diffusion', 'transport'], ['mechanism', 'pathway'], ['synthesis', 'fabrication', 'preparation'],
    ['degradation', 'decomposition'], ['modeling', 'modelling', 'simulation'], ['behavior', 'behaviour'], ['color', 'colour'],
    ['tumor', 'tumour', 'cancer'], ['metastasis', 'metastatic'], ['heart attack', 'myocardial infarction'],
    ['elderly', 'older adults'], ['children', 'pediatric', 'paediatric'], ['solar cell', 'photovoltaic'],
    ['ultrafast', 'femtosecond', 'time-resolved'], ['global warming', 'climate change'],
    ['covid-19', 'sars-cov-2'], ['nanoconfinement', 'nanoconfined', 'nanochannel'], ['photocatalysis', 'photocatalytic'],
    ['well-being', 'wellbeing'], ['socioeconomic', 'socio-economic'], ['students', 'learners'], ['teacher', 'educator'],
    ['conductivity', 'conductance'], ['fiber', 'fibre'], ['center', 'centre'],
    ['anemia', 'anaemia'], ['estrogen', 'oestrogen'], ['optimization', 'optimisation'], ['ionization', 'ionisation'],
    ['crystallization', 'crystallisation'], ['polarization', 'polarisation'], ['aluminum', 'aluminium'], ['sulfur', 'sulphur'],
    ['charge separation', 'charge transfer'], ['excitation energy transfer', 'energy transfer'], ['qubit', 'quantum bit'],
    ['decoherence', 'dephasing'], ['vibronic coupling', 'electron-vibration coupling'], ['drug delivery', 'drug carrier'],
    ['wastewater', 'waste water'], ['deep learning', 'neural network'], ['large language model', 'llm'],
    ['crystal', 'crystalline'], ['catalyst', 'catalysis', 'catalytic'],
  ].map(g => g.map(t => ({ text: t, stems: stems(t) })));
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
    const toks = raw.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || [];
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
        groups.push({ label: t, alts: [{ text: t, stems: [stem(t)], weight: 1 }, { text: acr.long, stems: phraseStems(acr.long), weight: 1 }] });
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
        groups.push({ label: surf, alts: [{ text: surf, stems: stemToks.slice(i, i + matched.n), weight: 1 }, ...active.map(a => ({ text: a.text, stems: a.stems, weight: 0.8 }))] });
        others.forEach(a => { if (!usedSyn.has(a.text)) { usedSyn.add(a.text); expansions.push({ for: surf, text: a.text, on: !disabled.has(a.text) }); } });
        const q1 = matched.n > 1 ? `"${surf}"` : surf;
        pieces.push(active.length ? `(${[q1, ...active.map(a => a.stems.length > 1 || /[-\s]/.test(a.text) ? `"${a.text}"` : a.text)].join(' OR ')})` : q1);
        i += matched.n; continue;
      }
      groups.push({ label: t, alts: [{ text: t, stems: [stemToks[i]], weight: 1 }] });
      pieces.push(t);
      i++;
    }
    const keywordQuery = expert ? raw : pieces.join(' ');
    let semanticQuery = raw;
    for (const a of acronyms) semanticQuery = semanticQuery.replace(new RegExp(`\\b${a.acr.replace(/[-]/g, '\\-')}\\b`), `${a.long} (${a.acr})`);
    const phrase = expert ? [] : content.map(stem);
    return { raw, expert, tokens: toks, content, groups, phrase, acronyms, expansions, keywordQuery, semanticQuery,
      shortQuery: content.length <= 3, question };
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
      authors: (w.authorships || []).map(a => a && a.author && a.author.display_name).filter(Boolean),
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
      venue: (it['container-title'] && it['container-title'][0]) || '', abstract: abs, abstractFrom: abs ? 'Crossref' : '',
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
    return { score, hits };
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

  // ctx: {analysis, profile, mode, nowYear, sem: Map(key -> {q, p})}
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
      for (const [ch, rank] of Object.entries(w.ranks || {})) r += (ch === 'oa_kw' || ch === 'oa_sem' ? 1 : 0.6) / (K + rank);
      w._rrf = r; if (r > maxRrf) maxRrf = r;
    }
    for (const w of works) {
      const q = scoreQuery(w, ctx.analysis);
      const pr = scoreProfile(w, pTerms);
      const rrf = maxRrf ? w._rrf / maxRrf : 0;
      const age = w.year ? Math.max(0, nowYear - w.year) : 10;
      const recency = Math.max(0, Math.min(1, 1 - (age - 2) / 13));
      const impact = w.pct != null ? w.pct : Math.min(1, Math.log1p(w.cites || 0) / Math.log1p(1000));
      const sem = ctx.sem && ctx.sem.get(w.key);
      let qrel = 0.55 * q.score + 0.45 * rrf;
      let prof = pr.score;
      if (sem) {
        const sq = Math.max(0, Math.min(1, (sem.q - 0.15) / 0.55));
        qrel = 0.35 * q.score + 0.3 * rrf + 0.35 * sq;
        if (sem.p != null) prof = 0.5 * prof + 0.5 * Math.max(0, Math.min(1, (sem.p - 0.1) / 0.5));
      }
      let score;
      if (mode === 'close') score = 0.62 * qrel + 0.28 * prof + 0.07 * impact + 0.03 * recency;
      else if (mode === 'adjacent') score = 0.6 * qrel + 0.2 * (1 - prof) + 0.14 * recency + 0.06 * impact;
      else score = 0.78 * qrel + 0.08 * prof + 0.1 * impact + 0.04 * recency;
      if (w.retracted) score -= 0.5;
      if (/^(dataset|software|book-review|paratext|erratum|grant|libguides|reference-entry|peer-review|supplementary-materials)$/.test(w.oaType || '')) score -= 0.12;
      if (!q.hits.length && !(w.ranks && (w.ranks.oa_sem !== undefined))) score -= 0.15; // nothing matched and not a meaning-based hit
      w.rank = { score, qrel, q: q.score, rrf, prof, profRaw: pr.score, impact, recency, qHits: q.hits, pHits: pr.hits, sem: sem || null };
    }
    return works.slice().sort((a, b) => b.rank.score - a.rank.score);
  }

  // ---------------------------------------------------------------- explanations (grounded)
  function explain(w, ctx) {
    const r = w.rank || {};
    const reasons = [];
    const qh = (r.qHits || []);
    const inTitle = qh.filter(h => h.where === 'title').map(h => h.text);
    const inAbs = qh.filter(h => h.where === 'abstract').map(h => h.text);
    const inKw = qh.filter(h => h.where === 'keywords').map(h => h.text);
    const syn = qh.filter(h => h.text.toLowerCase() !== String(h.label).toLowerCase());
    if (inTitle.length) reasons.push({ kind: 'query', text: `Title mentions ${listify(inTitle)}.` });
    if (inAbs.length) reasons.push({ kind: 'query', text: `Abstract mentions ${listify(inAbs)}.` });
    if (inKw.length && !inTitle.length && !inAbs.length) reasons.push({ kind: 'query', text: `Tagged by OpenAlex with ${listify(inKw)}.` });
    if (syn.length) reasons.push({ kind: 'synonym', text: `Uses ${listify(syn.map(h => `“${h.text}”`))} for ${listify([...new Set(syn.map(h => `“${h.label}”`))])}.` });
    if (!qh.length && w.ranks && w.ranks.oa_sem !== undefined) reasons.push({ kind: 'semantic', text: 'Found by OpenAlex meaning-based search; it does not use your exact search words.' });
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
    const keep = ['key', 'openalexId', 'doi', 'title', 'year', 'authors', 'venue', 'abstract', 'abstractFrom', 'oaType', 'crType', 'epmcTypes',
      'isOA', 'landing', 'oaUrl', 'pdf', 'oaHost', 'cites', 'topic', 'retracted', 'sources'];
    const o = {}; keep.forEach(k => { o[k] = w[k]; }); o.savedAt = new Date().toISOString(); return o;
  }

  const Core = {
    stem, stems, words, contentStems, phraseStems, hasPhrase, splitSentences, cleanDoi, normTitle, stripTags, reconstructAbstract,
    extractGlossary, extractProfile, profileTerms, profileText, analyzeQuery, assessFieldAmbiguity,
    normOpenAlex, normCrossref, normEPMC, workKey, dedupeInto, classifyType, prepWork, scoreQuery, scoreProfile, rankWorks,
    explain, highlightStems, computeThemes, parseScholarLines, titleSimilarity, compareWithList, toBibTeX, toRIS, toCSV, slim,
    ACRONYMS, SYNONYMS, FIELD_DOMAIN, DOMAINS, STOP,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);
