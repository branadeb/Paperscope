/* Paperscope UI. Depends on window.Core (core.js). */
(function () {
  'use strict';
  const C = window.Core;
  const VERSION = '0.9.0';
  const PAGE = 10;
  const OA = 'https://api.openalex.org';
  const CR = 'https://api.crossref.org';
  const ORCID_API = 'https://pub.orcid.org/v3.0';
  const EP = 'https://www.ebi.ac.uk/europepmc/webservices/rest';
  const OA_SELECT = 'id,doi,display_name,publication_year,publication_date,type,cited_by_count,authorships,primary_location,best_oa_location,open_access,primary_topic,keywords,abstract_inverted_index,citation_normalized_percentile,is_retracted';
  const LIBS = {
    pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.min.mjs',
    pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.worker.min.mjs',
    mammoth: 'https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js',
    tjs: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js',
  };
  const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
  const CHANNEL_NAMES = { oa_kw: 'OpenAlex keyword', oa_sem: 'OpenAlex meaning-based', oa_rel: 'OpenAlex related terms', oa_recent: 'OpenAlex recent', oa_trail: 'OpenAlex citation trail', crossref: 'Crossref', epmc: 'Europe PMC' };
  const CATS = [
    ['research', 'Original articles', 'Labelled "article" by the source and not flagged as a review or commentary'],
    ['review', 'Reviews', 'Includes ones inferred from wording (marked ?)'],
    ['perspective', 'Perspectives, editorials and commentary', 'Mostly inferred from wording (marked ?)'],
    ['preprint', 'Preprints', ''],
    ['other', 'Other (books, chapters, letters, datasets…)', ''],
  ];

  // ---------------------------------------------------------------- helpers
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = u => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fmt = n => (n == null ? '' : Number(n).toLocaleString());
  const store = {
    get(k, d) { try { const v = localStorage.getItem('paperscope.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('paperscope.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem('paperscope.' + k); } catch (e) { /* ignore */ } },
  };
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });
  }

  // ---------------------------------------------------------------- state
  const S = {
    settings: Object.assign({ apiKey: '', crossref: true, epmc: true, semantic: true, rememberProfile: false, ai: false,
      llmProvider: 'anthropic', llmKey: '', llmModel: 'claude-haiku-5-5', llmBase: 'https://api.openai.com/v1', llmConsent: false }, store.get('settings', {})),
    sort: 'best',
    pathway: 'topic',
    follows: store.get('follows', []) || [],
    prevSearch: null,
    profile: null,
    saved: new Map(),
    mode: 'all',
    filters: { cats: new Set(CATS.map(c => c[0])), hideInferred: false, yearFrom: '', yearTo: '', oaOnly: false, theme: null },
    search: null,
    sessionCost: 0,
    ai: { status: 'off', pipe: null, cache: new Map(), qcache: new Map(), progress: 0, lastRun: null, error: '' },
    ui: { openDetails: new Set() },
  };
  if (S.settings.rememberProfile) S.profile = store.get('profile', null);
  (store.get('saved', []) || []).forEach(w => { if (w && w.key) { C.prepWork(w); S.saved.set(w.key, w); } });
  S.mode = store.get('mode', 'all');
  S.sort = store.get('sort', 'best');
  S.pathway = store.get('pathway', 'topic') === 'author' ? 'author' : 'topic';
  function saveSettings() { store.set('settings', S.settings); }
  function persistProfile() { if (S.settings.rememberProfile && S.profile) store.set('profile', S.profile); else store.del('profile'); }
  function persistSaved() { return store.set('saved', [...S.saved.values()].map(C.slim)); }
  function persistFollows() { store.set('follows', S.follows); }
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const shortId = id => String(id || '').split('/').pop();

  // ---------------------------------------------------------------- network
  async function getJSON(url, { timeout = 20000, retries = 1, headers } = {}) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeout);
      try {
        const res = await fetch(url, headers ? { signal: ctl.signal, headers } : { signal: ctl.signal });
        clearTimeout(timer);
        if (res.status === 429 && attempt < retries) { await sleep(1300 * (attempt + 1)); continue; }
        if (!res.ok) { let body = ''; try { body = (await res.text()).slice(0, 300); } catch (e) { /* ignore */ } return { ok: false, status: res.status, error: body }; }
        return { ok: true, status: res.status, data: await res.json() };
      } catch (e) {
        clearTimeout(timer);
        if (attempt < retries) { await sleep(900); continue; }
        return { ok: false, status: 0, error: e.name === 'AbortError' ? 'timed out' : (e.message || String(e)) };
      }
    }
    return { ok: false, status: 0, error: 'unknown' };
  }
  function oaURL(params) {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
    if (S.settings.apiKey) p.set('api_key', S.settings.apiKey.trim());
    return `${OA}/works?${p.toString()}`;
  }
  function oaPath(path, params = {}) {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
    if (S.settings.apiKey) p.set('api_key', S.settings.apiKey.trim());
    const qs = p.toString();
    return `${OA}${path}${qs ? '?' + qs : ''}`;
  }
  function addCost(r) { if (r && r.ok && r.data && r.data.meta && typeof r.data.meta.cost_usd === 'number') { S.sessionCost += r.data.meta.cost_usd; if (S.search) S.search.cost += r.data.meta.cost_usd; } }
  function failText(src, r) {
    if (r.status === 429) return src.startsWith('OpenAlex') ? 'OpenAlex refused the request: the free daily allowance is used up or requests came too fast. It resets at midnight UTC; a free API key (About › Settings) gives 10× more.' : `${src} is limiting requests. Try again in a minute.`;
    if (r.status === 401 || r.status === 403) return `${src} refused the request (${r.status}). If you added an API key, check it in About › Settings.`;
    if (r.status === 400) return `${src} could not read this query (400). Try simpler wording.`;
    if (r.status === 0) return `${src} could not be reached (${r.error}).`;
    return `${src} returned an error (${r.status}).`;
  }

  // ---------------------------------------------------------------- appearance (Light / Dark / Auto, like macOS)
  const APPEARANCE_ICONS = {
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5l1.5 1.5M17 17l1.5 1.5M5.5 18.5 7 17M17 7l1.5-1.5"/></svg>',
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z"/></svg>',
    auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
  };
  const APPEARANCE_NAMES = { light: 'Light', dark: 'Dark', auto: 'Auto (follows your device)' };
  function currentAppearance() { const a = store.get('appearance', 'auto'); return ['light', 'dark', 'auto'].includes(a) ? a : 'auto'; }
  function applyAppearance(a) {
    const root = document.documentElement;
    if (a === 'light' || a === 'dark') root.setAttribute('data-appearance', a); else root.removeAttribute('data-appearance');
    store.set('appearance', a);
    renderAppearance();
  }
  function renderAppearance() {
    const a = currentAppearance();
    const b = $('#appearance-btn');
    if (b) { b.innerHTML = APPEARANCE_ICONS[a]; b.setAttribute('aria-label', `Appearance: ${APPEARANCE_NAMES[a]}. Tap to change.`); b.title = `Appearance: ${APPEARANCE_NAMES[a]}`; }
    document.querySelectorAll('input[name="appearance"]').forEach(r => { r.checked = r.value === a; });
  }
  function goHome() {
    searchToken++;
    S.search = null; S.prevSearch = null; S.filters.theme = null;
    ['#clarify', '#interp', '#map-holder', '#answer-holder', '#filterbar', '#results', '#more', '#compare-holder'].forEach(id => { $(id).innerHTML = ''; });
    setLoading(null);
    $('#start').hidden = false; $('#hero').classList.remove('compact'); $('#q').value = '';
    renderModes(); renderFollows();
  }

  // ---------------------------------------------------------------- routing
  const VIEWS = ['search', 'profile', 'saved', 'about'];
  function route() {
    const v = (location.hash || '#search').slice(1);
    const view = VIEWS.includes(v) ? v : 'search';
    VIEWS.forEach(x => { $('#view-' + x).hidden = x !== view; });
    document.querySelectorAll('.tabs a').forEach(a => a.setAttribute('aria-current', a.dataset.view === view ? 'page' : 'false'));
    if (view === 'saved') { renderSaved(); renderFollows(); }
    if (view === 'search') renderFollows();
    if (view === 'profile') { renderProfileEditor(); renderAI(); }
    if (view === 'about') renderAbout();
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- search flow
  let searchToken = 0;
  function ctx() {
    const s = S.search;
    return { analysis: s.analysis, profile: S.profile, mode: S.mode, nowYear: new Date().getFullYear(), sem: S.ai.status === 'ready' ? s.sem : null, hasProfile: hasProfile(), trail: s.kind === 'trail' ? s.trail : null, author: s.kind === 'author' || s.kind === 'doi' ? (s.author || true) : null };
  }
  function hasProfile() { return !!(S.profile && ((S.profile.interests || []).length + (S.profile.methods || []).length + (S.profile.areas || []).length)); }

  async function runSearch(q, opts = {}) {
    q = String(q || '').trim();
    if (!q) return;
    $('#q').value = q;
    const token = ++searchToken;
    const choices = Object.assign({}, opts.choices || {});
    const analysis = C.analyzeQuery(q, S.profile, choices);
    S.search = { kind: 'search', q, analysis, choices, sense: opts.sense || null, senseAuto: false, fieldInfo: null, allFields: !!opts.allFields,
      pool: new Map(), ranked: [], themes: null, status: {}, pages: { oa_kw: 1, oa_sem: 1, crossref: 0, epmc: '*' }, exhausted: {},
      shown: PAGE, cost: 0, serverFilters: opts.serverFilters || null, sem: new Map(), dupes: 0, fetched: 0, compare: null,
      since: opts.since || null, wantRecent: S.sort === 'newest', answer: null, followIndex: opts.followIndex != null ? opts.followIndex : null };
    S.filters.theme = null; S.prevSearch = null;
    if (S.pathway !== 'topic') { S.pathway = 'topic'; renderPathway(); }
    clearSearchUI();
    if (location.hash && location.hash !== '#search') location.hash = '#search';

    if (analysis.question && !opts.skipQuestion) { renderClarify({ kind: 'acronym', ...analysis.question }); return; }

    if (!S.search.sense && !S.search.allFields && !analysis.expert && analysis.shortQuery) {
      setLoading('Checking which research fields use these words…');
      const r = await getJSON(oaURL({ search: analysis.keywordQuery, group_by: 'primary_topic.field.id', per_page: 30 }));
      if (token !== searchToken) return;
      addCost(r);
      if (r.ok) {
        const amb = C.assessFieldAmbiguity(r.data.group_by, S.profile);
        S.search.fieldInfo = amb;
        if (amb.ambiguous) {
          if (amb.autoPick) { S.search.sense = { id: amb.autoPick.id, name: amb.autoPick.name }; S.search.senseAuto = true; }
          else { setLoading(null); renderClarify({ kind: 'field', amb }); return; }
        }
      } else {
        S.search.status.groupby = { ok: false, label: 'OpenAlex field check', msg: failText('OpenAlex', r) };
      }
    }
    await fetchBatch(token);
  }

  function clearSearchUI() {
    $('#start').hidden = true;
    $('#hero').classList.add('compact');
    ['#clarify', '#interp', '#map-holder', '#answer-holder', '#filterbar', '#results', '#more', '#compare-holder'].forEach(id => { $(id).innerHTML = ''; });
  }

  // Follow the citation trail from one paper: papers citing it, its references, or OpenAlex's related works.
  async function runTrail(seed, kind) {
    if (!seed || !seed.openalexId) return;
    const token = ++searchToken;
    const prev = S.search && (S.search.kind === 'search' || S.search.kind === 'author') ? S.search : (S.prevSearch || null);
    const analysis = C.analyzeQuery(seed.title, S.profile, {});
    S.search = { kind: 'trail', trail: { kind, seed: { key: seed.key, title: seed.title, openalexId: seed.openalexId, cites: seed.cites } },
      q: seed.title, analysis, choices: {}, sense: null, pool: new Map(), ranked: [], themes: null, status: {}, pages: { oa_trail: 1 }, exhausted: {},
      shown: PAGE, cost: 0, sem: new Map(), dupes: 0, fetched: 0, compare: null, answer: null };
    S.prevSearch = prev; S.filters.theme = null;
    clearSearchUI();
    window.scrollTo(0, 0);
    await fetchBatch(token);
  }

  function oaFilter() {
    const s = S.search; const parts = [];
    if (s.kind === 'trail') {
      const id = shortId(s.trail.seed.openalexId);
      parts.push({ cites: `cites:${id}`, refs: `cited_by:${id}`, related: `related_to:${id}` }[s.trail.kind]);
    }
    if (s.sense) parts.push(`primary_topic.domain.id:${s.sense.id}`);
    if (s.since) parts.push(`from_publication_date:${s.since}`);
    const f = s.serverFilters;
    if (f) {
      if (f.yearFrom || f.yearTo) parts.push(`publication_year:${f.yearFrom || 1500}-${f.yearTo || new Date().getFullYear() + 1}`);
      if (f.oaOnly) parts.push('is_oa:true');
      if (f.type) parts.push(`type:${f.type}`);
    }
    return parts.join(',');
  }

  async function fetchBatch(token, opts = {}) {
    const s = S.search; const a = s.analysis;
    setLoading(s.fetched ? 'Getting more results…' : 'Searching OpenAlex' + (S.settings.crossref ? ', Crossref' : '') + (S.settings.epmc ? ' and Europe PMC' : '') + '…');
    const filter = oaFilter();
    const jobs = [];
    if (s.kind === 'trail') {
      const label = { cites: 'Papers citing it', refs: 'Its references', related: 'Related papers' }[s.trail.kind];
      if (!s.exhausted.oa_trail) jobs.push(['oa_trail', `OpenAlex: ${label.toLowerCase()}`, () => getJSON(oaURL({ filter, per_page: 50, page: s.pages.oa_trail, select: OA_SELECT, sort: s.trail.kind === 'related' ? '' : 'cited_by_count:desc' })), 50]);
    } else {
    if (!s.exhausted.oa_kw) jobs.push(['oa_kw', 'OpenAlex keyword search', () => getJSON(oaURL({ search: a.keywordQuery, filter, per_page: 40, page: s.pages.oa_kw, select: OA_SELECT })), 40]);
    if (S.settings.semantic && !s.exhausted.oa_sem) jobs.push(['oa_sem', 'OpenAlex meaning-based search', () => getJSON(oaURL({ 'search.semantic': a.semanticQuery, filter, per_page: 25, page: s.pages.oa_sem, select: OA_SELECT })), 25]);
    else if (!S.settings.semantic) s.status.oa_sem = { skip: true, label: 'OpenAlex meaning-based search', msg: 'off in Settings' };
    if (a.related.length && !s.exhausted.oa_rel) jobs.push(['oa_rel', 'OpenAlex related terms', () => getJSON(oaURL({ search: a.relatedQuery, filter, per_page: 25, page: 1, select: OA_SELECT })), 25]);
    if (s.wantRecent && !s.since && !s.exhausted.oa_recent) {
      const from = `${new Date().getFullYear() - 3}-01-01`;
      jobs.push(['oa_recent', 'OpenAlex recent papers', () => getJSON(oaURL({ search: a.keywordQuery, filter: [filter, `from_publication_date:${from}`].filter(Boolean).join(','), per_page: 25, page: 1, select: OA_SELECT })), 25]);
    }
    const sf = Object.assign({}, s.serverFilters || {});
    if (s.since) sf.sinceDate = s.since;
    if (S.settings.crossref && !s.exhausted.crossref) {
      const p = new URLSearchParams({ 'query.bibliographic': a.semanticQuery, rows: 20, offset: s.pages.crossref, select: 'DOI,title,abstract,type,issued,published,container-title,author,is-referenced-by-count,URL' });
      const cf = []; if (sf.sinceDate) cf.push(`from-pub-date:${sf.sinceDate}`); else if (sf.yearFrom) cf.push(`from-pub-date:${sf.yearFrom}`); if (sf.yearTo) cf.push(`until-pub-date:${sf.yearTo}`); if (cf.length) p.set('filter', cf.join(','));
      jobs.push(['crossref', 'Crossref', () => getJSON(`${CR}/works?${p}`, { timeout: 15000 })]);
    } else if (!S.settings.crossref) s.status.crossref = { skip: true, label: 'Crossref', msg: 'off in Settings' };
    if (S.settings.epmc && !s.exhausted.epmc) {
      let query = a.keywordQuery;
      if (sf.sinceDate) query += ` AND PUB_YEAR:[${sf.sinceDate.slice(0, 4)} TO ${new Date().getFullYear() + 1}]`;
      else if (sf.yearFrom || sf.yearTo) query += ` AND PUB_YEAR:[${sf.yearFrom || 1800} TO ${sf.yearTo || new Date().getFullYear() + 1}]`;
      if (sf.oaOnly) query += ' AND OPEN_ACCESS:y';
      if (sf.type === 'review') query += ' AND PUB_TYPE:"review"';
      const p = new URLSearchParams({ query, format: 'json', resultType: 'core', pageSize: 20, cursorMark: s.pages.epmc });
      jobs.push(['epmc', 'Europe PMC', () => getJSON(`${EP}/search?${p}`, { timeout: 15000 })]);
    } else if (!S.settings.epmc) s.status.epmc = { skip: true, label: 'Europe PMC', msg: 'off in Settings' };
    }

    if (opts.only) { for (let k = jobs.length - 1; k >= 0; k--) if (!opts.only.includes(jobs[k][0])) jobs.splice(k, 1); }
    const results = await Promise.all(jobs.map(j => j[2]()));
    if (token !== searchToken) return;
    const before = s.pool.size; let incoming = 0;
    results.forEach((r, i) => {
      const [ch, label] = jobs[i];
      if (!r.ok) { s.status[ch] = { ok: false, label, msg: failText(label, r) }; s.exhausted[ch] = true; return; }
      let items = [];
      if (ch.startsWith('oa_')) {
        addCost(r);
        const per = jobs[i][3];
        s.pages[ch] = s.pages[ch] || 1;
        const off = (s.pages[ch] - 1) * per;
        const res = r.data.results || [];
        items = res.map((w, k) => C.normOpenAlex(w, ch, off + k + 1));
        const total = r.data.meta ? r.data.meta.count : res.length;
        const prev = s.status[ch] && s.status[ch].n || 0;
        s.status[ch] = { ok: true, label, n: prev + res.length, total };
        s.pages[ch]++;
        if (res.length < per || off + res.length >= total || (ch === 'oa_sem' && s.pages[ch] > 2) || ch === 'oa_rel' || ch === 'oa_recent') s.exhausted[ch] = true;
      } else if (ch === 'crossref') {
        const res = (r.data.message && r.data.message.items) || [];
        const off = s.pages.crossref;
        items = res.filter(it => !/^(component|journal-issue|journal-volume|journal|peer-review|grant|database)$/.test(it.type)).map((it, k) => C.normCrossref(it, off + k + 1));
        const prev = s.status[ch] && s.status[ch].n || 0;
        s.status[ch] = { ok: true, label, n: prev + res.length, total: r.data.message && r.data.message['total-results'] };
        s.pages.crossref += 20;
        if (res.length < 20 || s.pages.crossref >= 100) s.exhausted.crossref = true;
      } else if (ch === 'epmc') {
        const res = (r.data.resultList && r.data.resultList.result) || [];
        const prevN = s.status[ch] && s.status[ch].n || 0;
        items = res.map((it, k) => C.normEPMC(it, prevN + k + 1)).filter(w => !s.since || !w.date || w.date >= s.since);
        s.status[ch] = { ok: true, label, n: prevN + res.length, total: r.data.hitCount };
        if (!res.length || !r.data.nextCursorMark || r.data.nextCursorMark === s.pages.epmc) s.exhausted.epmc = true;
        s.pages.epmc = r.data.nextCursorMark;
      }
      incoming += items.length;
      C.dedupeInto(s.pool, items);
    });
    s.fetched += incoming;
    s.dupes = s.fetched - s.pool.size;
    s.lastAdded = s.pool.size - before;
    setLoading(null);
    rerank();
    renderAll();
    if (s.since && s.followIndex != null && S.follows[s.followIndex]) { S.follows[s.followIndex].lastChecked = todayISO(); S.follows[s.followIndex].lastNew = s.pool.size; persistFollows(); }
    if (S.ai.status === 'ready') embedPool();
    else if (S.settings.ai && S.ai.status === 'off') loadAI(true);
  }

  function rerank() {
    const s = S.search; if (!s || !s.pool) return;
    s.ranked = C.rankWorks([...s.pool.values()], ctx());
    s.themes = C.computeThemes(s.ranked, ctx());
  }

  function visibleWorks() {
    const s = S.search; if (!s) return [];
    const f = S.filters;
    const theme = f.theme && s.themes ? s.themes.themes.find(t => t.id === f.theme) : null;
    const tkeys = theme ? new Set(theme.keys) : null;
    return C.sortWorks(s.ranked, S.sort).filter(w => {
      const ti = w.typeInfo;
      if (!f.cats.has(ti.cat)) return false;
      if (f.hideInferred && ti.conf === 'inferred') return false;
      if (f.yearFrom && (!w.year || w.year < Number(f.yearFrom))) return false;
      if (f.yearTo && (!w.year || w.year > Number(f.yearTo))) return false;
      if (f.oaOnly && !w.isOA) return false;
      if (tkeys && !tkeys.has(w.key)) return false;
      if (s.kind === 'author' && (isAside(s, w) || isVersionDup(s, w))) return false;
      return true;
    });
  }
  function filtersActive() {
    const f = S.filters;
    return f.cats.size < CATS.length || f.hideInferred || f.yearFrom || f.yearTo || f.oaOnly || f.theme;
  }

  // ---------------------------------------------------------------- rendering: search
  function setLoading(text) {
    const el = $('#loading');
    if (!text) { el.hidden = true; return; }
    $('#loading-text').textContent = text; el.hidden = false;
  }

  function renderPathway() {
    document.querySelectorAll('.pathways [data-pathway]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.pathway === S.pathway)));
    $('#hero').dataset.searchBy = S.pathway;
    $('#q').placeholder = S.pathway === 'author' ? 'Author name or ORCID iD' : 'Keywords, a phrase, a question or a DOI';
    $('#hero-lede').textContent = S.pathway === 'author' ? 'Look up a researcher by name or ORCID iD and see all their work, grouped by field.' : 'Search open scholarly databases and see, for each paper, why it may matter to you.';
    const lab = document.querySelector('label[for="q"]'); if (lab) lab.textContent = S.pathway === 'author' ? 'Author name or ORCID iD' : 'Search terms, research question or DOI';
  }
  function renderModes() {
    renderPathway();
    const hp = hasProfile();
    document.querySelectorAll('#modes button').forEach(b => {
      const m = b.dataset.mode;
      b.setAttribute('aria-checked', String((hp ? S.mode : 'all') === m));
      b.disabled = !hp && m !== 'all';
    });
    const hints = {
      close: 'Favouring papers that overlap your profile.',
      all: hp ? 'Ranked by match to your search, with a light nudge towards your profile.' : 'Add a profile to separate papers close to your work from adjacent ones.',
      adjacent: 'Favouring relevant papers outside your listed areas, and recent ones.',
    };
    $('#mode-hint').textContent = hints[hp ? S.mode : 'all'];
    const pl = $('#profile-line');
    if (hp) {
      const n = (S.profile.interests || []).length + (S.profile.methods || []).length + (S.profile.areas || []).length;
      pl.innerHTML = `Ranking with your profile: ${n} terms. <a href="#profile">Edit</a>`;
    } else pl.innerHTML = `No profile yet. <a href="#profile">Add your CV or a research statement</a> for personalised ranking.`;
  }

  function renderClarify(c) {
    const el = $('#clarify');
    const q = S.search.q;
    if (c.kind === 'acronym') {
      el.innerHTML = `<div class="panel ask" role="group" aria-labelledby="ask-h">
        <h3 id="ask-h">What does “${esc(c.acr)}” mean in your search?</h3>
        <p class="small muted">It has more than one common meaning. Your answer is used for this search only.</p>
        <div class="choices">${c.options.map(o => `<button type="button" class="btn" data-acr="${esc(c.acr)}" data-long="${esc(o)}">${esc(o)}</button>`).join('')}
          <button type="button" class="btn" data-acr="${esc(c.acr)}" data-long="">Search “${esc(c.acr)}” as typed</button></div>
        <form class="add-term" data-acr-form="${esc(c.acr)}" style="margin-top:10px"><label class="sr-only" for="acr-other">Other meaning</label><input id="acr-other" placeholder="Something else: type the full term"><button class="btn small" type="submit">Use</button></form>
      </div>`;
    } else {
      const amb = c.amb;
      el.innerHTML = `<div class="panel ask" role="group" aria-labelledby="ask-h">
        <h3 id="ask-h">“${esc(q)}” is used in quite different fields. Which do you mean?</h3>
        <p class="small muted">Share of OpenAlex papers using these words. With a profile, Paperscope can usually pick for you.</p>
        <div class="choices">${amb.options.map(o => `<button type="button" class="btn" data-field="${o.id}" data-fname="${esc(o.name)}">${esc(o.name)} <span class="share">${Math.round(o.share * 100)}%</span><br><span class="tiny">${esc(o.fields.slice(0, 3).join(', '))}</span></button>`).join('')}
          <button type="button" class="btn" data-field="all">All fields</button></div>
      </div>`;
    }
  }

  function renderTrailHeader() {
    const s = S.search; const t = s.trail;
    const what = { cites: 'Papers that cite', refs: 'Papers cited by', related: 'Papers related to' }[t.kind];
    const st = s.status.oa_trail;
    const failed = st && st.ok === false;
    $('#interp').innerHTML = `${failed ? `<div class="panel warn" role="alert"><strong>Could not follow this trail.</strong> ${esc(st.msg)}</div>` : ''}
      <div class="panel trail-head"><p class="small muted" style="margin:0">Following the citation trail</p>
      <h3 style="margin:.2em 0 .4em">${esc(what)} “${esc(t.seed.title)}”</h3>
      <p class="tiny" style="margin:0">${st && st.ok ? `${fmt(st.n)} fetched${st.total != null ? ` of ${fmt(st.total)}` : ''}. ` : ''}Ranked by overlap with that paper’s title and your profile; sort by date or citations below. OpenAlex cost: $${s.cost.toFixed(4)}.</p>
      <div class="row" style="margin-top:8px">${S.prevSearch ? `<button type="button" class="btn small" id="trail-back">Back to “${esc(S.prevSearch.q.length > 40 ? S.prevSearch.q.slice(0, 38) + '…' : S.prevSearch.q)}”</button>` : ''}
      ${['cites', 'refs', 'related'].filter(k => k !== t.kind).map(k => `<button type="button" class="btn small" data-trail-switch="${k}">${{ cites: 'Citing papers', refs: 'References', related: 'Similar papers' }[k]}</button>`).join('')}</div></div>`;
  }

  function renderRelated() {
    const s = S.search; const a = s.analysis;
    if (s.kind !== 'search' || !s.ranked.length) return '';
    const sugg = C.relatedTerms(s.ranked, a, 8);
    const active = a.related.map(r => `<li class="chip on">+ ${esc(r.text)} <button type="button" data-related-rm="${esc(r.text)}" aria-label="Stop searching ${esc(r.text)}">×</button></li>`).join('');
    if (!sugg.length && !active) return '';
    return `<div class="related"><p class="small" style="margin:0"><strong>Related terms in these results</strong> <span class="tiny">Tap one to search it as well</span></p>
      <ul class="chips">${active}${sugg.map(t => `<li><button type="button" class="chip add" data-related-add="${esc(t.text)}">${esc(t.text)} <span class="tiny">${t.n}</span></button></li>`).join('')}</ul></div>`;
  }

  function followIndex(s) { return S.follows.findIndex(f => f.q === s.q && JSON.stringify(f.choices || {}) === JSON.stringify(s.choices || {}) && ((f.sense && f.sense.id) || null) === ((s.sense && s.sense.id) || null)); }

  function renderInterp() {
    const s = S.search;
    if (s.kind === 'trail') { renderTrailHeader(); return; }
    if (s.kind === 'doi') {
      const st = s.status.doi || {};
      $('#interp').innerHTML = `<div class="panel ${st.ok === false ? 'warn' : ''}"><strong>${st.ok === false ? 'No paper found for this DOI.' : 'Paper found from its DOI.'}</strong> <code>${esc(s.q)}</code>
        <p class="tiny" style="margin:4px 0 0">${esc(st.msg || 'Use Explore on the card to see papers citing it, its references or similar papers.')}</p></div>`;
      return;
    }
    const a = s.analysis;
    const bits = [];
    bits.push(`<p>Keyword search: <code>${esc(a.keywordQuery)}</code></p>`);
    const chips = [];
    a.acronyms.forEach(x => chips.push(`<li class="chip">${esc(x.acr)} = ${esc(x.long)} <span class="tiny">(${esc(x.how)})</span> <button type="button" title="Search ${esc(x.acr)} as typed" aria-label="Remove meaning for ${esc(x.acr)}" data-unacr="${esc(x.acr)}">×</button></li>`));
    a.expansions.forEach(x => chips.push(`<li><button type="button" class="chip toggle ${x.on ? '' : 'off'}" aria-pressed="${x.on}" data-exp="${esc(x.text)}" title="${x.on ? 'Tap to stop searching this synonym' : 'Tap to include this synonym'}">${x.on ? '+' : ''} ${esc(x.text)} <span class="tiny">for ${esc(x.for)}</span></button></li>`));
    if (s.sense) chips.push(`<li class="chip">Limited to ${esc(s.sense.name)} ${s.senseAuto ? '<span class="tiny">(picked from your profile)</span>' : ''} <button type="button" data-unfield="1" aria-label="Search all fields instead">×</button></li>`);
    if (chips.length) bits.push(`<ul class="chips" aria-label="How your search was interpreted">${chips.join('')}</ul>`);
    if (S.settings.semantic) bits.push(`<p class="small">Also searched by meaning: <code>${esc(a.semanticQuery)}</code></p>`);
    const st = s.status;
    const rows = ['groupby', 'oa_kw', 'oa_sem', 'crossref', 'epmc'].filter(k => st[k]).map(k => {
      const x = st[k];
      if (x.skip) return `<li class="skip">${esc(x.label)}: ${esc(x.msg)}</li>`;
      if (!x.ok) return `<li class="fail">${esc(x.label)}: ${esc(x.msg)}</li>`;
      return `<li>${esc(x.label)}: ${fmt(x.n)} fetched${x.total != null ? ` of ${fmt(x.total)} matches` : ''}</li>`;
    });
    bits.push(`<ul class="sources">${rows.join('')}</ul>`);
    bits.push(`<p class="tiny">${fmt(s.pool.size)} unique papers after merging ${fmt(s.dupes)} duplicates. OpenAlex cost for this search: $${s.cost.toFixed(3)} (session $${S.sessionCost.toFixed(3)}; free allowance $${S.settings.apiKey ? '1.00' : '0.10'} a day${S.settings.apiKey ? ' with your key' : ' without a key'}).${S.ai.status === 'ready' ? ' Re-ranked with the on-device model.' : ''}</p>`);
    const failed = Object.values(st).filter(x => x && x.ok === false);
    const warn = failed.length ? `<div class="panel warn" role="alert"><strong>These results are incomplete.</strong> ${failed.map(x => esc(x.msg)).join(' ')}</div>` : '';
    const fi = followIndex(s);
    const since = s.since ? `<div class="panel since"><strong>Papers published since ${esc(s.since)}</strong> for “${esc(s.q)}”. ${s.pool.size ? '' : 'Nothing new yet.'} <span class="tiny">Uses publication dates, so papers indexed late with older dates can be missed.</span></div>` : '';
    const follow = `<div class="row follow-row"><button type="button" class="btn small" id="follow-toggle" aria-pressed="${fi >= 0}">${fi >= 0 ? 'Following this search' : 'Follow this search'}</button><span class="tiny">${fi >= 0 ? 'Check it for new papers from the Saved tab.' : 'Keep it on this device and check later for new papers.'}</span></div>`;
    $('#interp').innerHTML = `${warn}${since}${renderRelated()}<details class="panel interp"><summary class="small"><strong>How this was searched</strong></summary>${bits.join('')}</details>${follow}`;
  }

  // A fixed, faint starfield behind the theme map (seeded, so it does not jump between renders).
  function stars(W, H) {
    let seed = 42; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    let out = '';
    for (let i = 0; i < 46; i++) out += `<circle cx="${(rnd() * W).toFixed(1)}" cy="${(rnd() * H).toFixed(1)}" r="${(0.4 + rnd() * 0.9).toFixed(2)}" opacity="${(0.12 + rnd() * 0.35).toFixed(2)}"/>`;
    return out;
  }
  function renderMap() {
    const s = S.search;
    if (!s.themes || !s.ranked.length || (s.kind !== 'search' && s.kind !== 'trail')) { $('#map-holder').innerHTML = ''; return; }
    const { themes, hasProfile: hp } = s.themes;
    const top = themes.filter(t => t.id !== 'none').slice(0, 12);
    if (top.length < 2) { $('#map-holder').innerHTML = ''; return; }
    const W = 470, H = 330, cx = W / 2, cy = H / 2, R1 = 74, R2 = 132, SQ = 0.82;
    let inner = top.filter(t => t.close), outer = top.filter(t => !t.close);
    if (inner.length > 6) { outer = inner.slice(6).concat(outer); inner = inner.slice(0, 6); } // keep the inner ring legible
    const maxC = Math.max(...top.map(t => t.count));
    const place = (arr, R, offset) => arr.map((t, i) => {
      const ang = offset + (2 * Math.PI * i) / Math.max(arr.length, 1);
      const rr = arr.length === 1 && R === R1 ? R * 0.75 : R;
      return { t, ang, x: cx + rr * Math.cos(ang), y: cy + rr * Math.sin(ang) * SQ, r: 7 + 14 * Math.sqrt(t.count / maxC) };
    });
    const nodes = [...place(inner, R1, -Math.PI / 2 + 0.3), ...place(outer, R2, -Math.PI / 2 + 0.05)];
    const sel = S.filters.theme;
    const dimFor = t => (hp && S.mode === 'close' && !t.close) || (hp && S.mode === 'adjacent' && t.close);
    const short = t => (t.name.length > 20 ? t.name.slice(0, 19).replace(/\s+\S*$/, '') + '…' : t.name);
    // Label the larger themes only; place each label on the outward side of its bubble.
    const labelled = new Set(nodes.slice().sort((a, b) => b.t.count - a.t.count).slice(0, 8).map(n => n.t.id));
    const label = n => {
      const c = Math.cos(n.ang), sn = Math.sin(n.ang);
      const lx = n.x + c * (n.r + 5), ly = n.y + sn * (n.r + 5) * SQ + 4;
      const anchor = Math.abs(c) < 0.35 ? 'middle' : (c > 0 ? 'start' : 'end');
      const dy = Math.abs(c) < 0.35 ? (sn < 0 ? -4 : 8) : 0;
      return `<text x="${lx.toFixed(1)}" y="${(ly + dy).toFixed(1)}" style="text-anchor:${anchor}">${esc(short(n.t))}</text>`;
    };
    const svg = `<svg class="map-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="Map of research themes in these results: ${inner.length} ${hp ? 'close to your profile' : 'at the core of your search'}, ${outer.length} ${hp ? 'adjacent' : 'further out'}. The same themes are listed below.">
      <g class="sky" aria-hidden="true">${stars(W, H)}</g>
      <ellipse class="ring" cx="${cx}" cy="${cy}" rx="${R1}" ry="${R1 * SQ}"/><ellipse class="ring" cx="${cx}" cy="${cy}" rx="${R2}" ry="${R2 * SQ}"/>
      <circle class="hub" cx="${cx}" cy="${cy}" r="18"/><text class="hub-label" x="${cx}" y="${cy + 3.5}">${hp ? 'you' : 'query'}</text>
      ${nodes.map(n => {
        const cls = ['node', n.t.close ? 'close' : 'adj', dimFor(n.t) ? 'dim' : '', sel === n.t.id ? 'sel' : ''].join(' ');
        return `<g class="${cls}" data-theme="${esc(n.t.id)}" tabindex="0" role="button" aria-label="${esc(n.t.name)}: ${n.t.count} papers${n.t.emerging ? ', emerging' : ''}">
          <title>${esc(n.t.name)} (${n.t.count} papers${n.t.emerging ? ', many recent' : ''})</title>
          ${n.t.emerging ? `<circle class="emerge" cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${(n.r + 4).toFixed(1)}"/>` : ''}
          <circle class="b" cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r.toFixed(1)}"/>
          ${n.r >= 12 ? `<text class="n" x="${n.x.toFixed(1)}" y="${(n.y + 3.5).toFixed(1)}">${n.t.count}</text>` : ''}
          ${labelled.has(n.t.id) ? label(n) : ''}
        </g>`;
      }).join('')}
    </svg>`;
    const legend = `<div class="legend"><span><i style="background:var(--close)"></i>${hp ? 'Close to your profile' : 'Most of the top results'}</span><span><i style="background:var(--adj)"></i>${hp ? 'Adjacent to your profile' : 'Further from the top results'}</span><span><i class="e"></i>Emerging: many papers from the last 3 years</span></div>`;
    const list = `<ul class="theme-list">${top.map(t => `<li><button type="button" data-theme="${esc(t.id)}" aria-pressed="${sel === t.id}"><span class="dot ${t.close ? 'close' : 'adj'}"></span><span class="tl"><span>${esc(t.name)}</span><span class="meta">${t.count} paper${t.count === 1 ? '' : 's'}${t.field ? `, ${esc(t.field)}` : ''}${t.emerging ? ', emerging' : ''}</span></span></button></li>`).join('')}</ul>`;
    const wasOpen = $('#map-holder details') ? $('#map-holder details').open : true;
    $('#map-holder').innerHTML = `<details class="map" ${wasOpen ? 'open' : ''}><summary>Theme map</summary>
      <p class="small muted">Themes are the OpenAlex topics of the papers found. ${hp ? 'Inner ring: themes that overlap your profile. Outer ring: adjacent themes.' : 'Inner ring: themes holding most of the top results.'} Bigger bubbles hold more papers. Tap a theme to see only its papers.</p>
      ${svg}${legend}${list}</details>`;
  }

  function renderFilterbar(vis) {
    const f = S.filters; const s = S.search;
    const chips = [];
    if (f.cats.size < CATS.length) chips.push(`<li class="chip">${[...f.cats].map(c => CATS.find(x => x[0] === c)[1].split(' ')[0]).join(', ')} <button data-clear="cats" aria-label="Clear type filter">×</button></li>`);
    if (f.hideInferred) chips.push(`<li class="chip">No inferred types <button data-clear="hideInferred" aria-label="Clear">×</button></li>`);
    if (f.yearFrom || f.yearTo) chips.push(`<li class="chip">${esc(f.yearFrom || '…')}–${esc(f.yearTo || '…')} <button data-clear="years" aria-label="Clear year filter">×</button></li>`);
    if (f.oaOnly) chips.push(`<li class="chip">Open access <button data-clear="oaOnly" aria-label="Clear">×</button></li>`);
    if (f.theme && s.themes) { const t = s.themes.themes.find(x => x.id === f.theme); if (t) chips.push(`<li class="chip">Theme: ${esc(t.name)} <button data-clear="theme" aria-label="Clear theme">×</button></li>`); }
    $('#filterbar').innerHTML = `<div class="filterbar"><button type="button" class="btn small" id="open-filters">Filters${filtersActive() ? ' (on)' : ''}</button>
      <label class="sortsel"><span class="sr-only">Sort results</span><select id="sort">${sortOptions(s)}</select></label>
      <ul class="chips" style="margin:0">${chips.join('')}</ul><span class="count">${s.kind === 'author' ? `${fmt(vis.length)} works` : `${Math.min(s.shown, vis.length)} of ${vis.length} shown`}</span></div>`;
  }

  function sortOptions(s) {
    const opt = (v, label, on) => `<option value="${v}" ${on ? 'selected' : ''}>${label}</option>`;
    if (s.kind === 'author' && !hasProfile()) return opt('best', 'Newest first', S.sort !== 'cited') + opt('cited', 'Most cited', S.sort === 'cited');
    return opt('best', s.kind === 'author' ? 'Closest to my work' : 'Best match', S.sort === 'best') + opt('newest', 'Newest first', S.sort === 'newest') + opt('cited', 'Most cited', S.sort === 'cited');
  }
  // Author names as buttons that open that author's works (when OpenAlex gives an author id).
  function authorLinks(w, n) {
    const names = w.authors || []; const ids = w.authorIds || [];
    const shown = names.slice(0, n).map((name, i) => ids[i] ? `<button type="button" class="auth" data-author-id="${esc(shortId(ids[i]))}" data-author-name="${esc(name)}">${esc(name)}</button>` : esc(name));
    return shown.join(', ') + (names.length > n ? ' et al.' : '');
  }
  function primaryLink(w) { return safeUrl(w.doi ? `https://doi.org/${w.doi}` : w.landing) || safeUrl(w.oaUrl) || safeUrl(w.openalexId); }

  function highlight(text, hset) {
    return text.split(/([\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*)/u).map((part, i) => {
      if (i % 2 === 1 && hset.has(C.stem(part)) && part.length > 2) return `<mark>${esc(part)}</mark>`;
      return esc(part);
    }).join('');
  }

  function paperHTML(w, i, c, hset) {
    const ex = C.explain(w, c);
    const ti = w.typeInfo;
    const hp = c.hasProfile;
    const closeCls = hp ? (w.rank.prof >= 0.25 ? 'close' : (w.rank.prof < 0.08 ? 'adj' : '')) : '';
    const lvl = Math.max(1, Math.min(5, Math.ceil(5 * Math.max(0, w.rank.score) / (c.topScore || 1))));
    const lvlName = ['', 'weak', 'weak', 'fair', 'good', 'strong'][lvl];
    const meter = `<span class="meter m${lvl}" role="img" aria-label="Match ${lvlName}${closeCls === 'close' ? ', close to your work' : closeCls === 'adj' ? ', outside your listed areas' : ''}" title="Match: ${lvlName}"><i></i><i></i><i></i><i></i><i></i></span>`;
    const authors = authorLinks(w, 3);
    const saved = S.saved.has(w.key);
    const link = primaryLink(w);
    const free = safeUrl(w.oaUrl) && w.isOA ? safeUrl(w.oaUrl) : '';
    const pdf = safeUrl(w.pdf);
    const open = S.ui.openDetails.has(w.key);
    const reasons = ex.reasons.map(r => `<li class="${esc(r.kind)}">${esc(r.text)}</li>`).join('');
    const ev = ex.evidence ? `<blockquote>“${highlight(ex.evidence.text, hset)}${ex.evidence.truncated ? '…' : ''}”<cite>From the abstract (${esc(ex.evidence.from)})</cite></blockquote>` : '';
    const sem = w.rank.sem ? `; model similarity to query ${w.rank.sem.q.toFixed(2)}${w.rank.sem.p != null ? `, to profile ${w.rank.sem.p.toFixed(2)}` : ''}` : '';
    return `<li class="paper ${closeCls}" data-key="${esc(w.key)}">
      <div class="badges">${S.search && S.search.since && w.date && w.date >= S.search.since ? '<span class="badge new">New</span>' : ''}<span class="badge ${esc(ti.conf)}" title="${esc(ti.why)}">${esc(ti.label)}</span>${w.isOA ? '<span class="badge oa">Open access</span>' : ''}${w.retracted ? '<span class="badge warn">Retracted</span>' : ''}${w.cites ? `<span class="badge">Cited by ${fmt(w.cites)}</span>` : ''}${meter}</div>
      <h3>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(w.title)}</a>` : esc(w.title)}</h3>
      <p class="byline">${authors}${authors ? '. ' : ''}${w.venue ? `<span class="venue">${esc(w.venue)}</span>` : ''}${w.year ? ` (${w.year})` : ''}</p>
      <div class="why"><ul>${reasons}</ul>${ev}${ex.note ? `<p class="note">${esc(ex.note)}</p>` : ''}</div>
      <div class="actions">
        <button type="button" class="save" data-save="${esc(w.key)}" aria-pressed="${saved}">${saved ? 'Saved' : 'Save'}</button>
        ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${w.doi ? 'Publisher page' : 'Source page'}</a>` : ''}
        ${free && free !== link ? `<a href="${esc(free)}" target="_blank" rel="noopener">Free full text${w.oaHost ? ` (${esc(w.oaHost)})` : ''}</a>` : ''}
        ${pdf && pdf !== free ? `<a href="${esc(pdf)}" target="_blank" rel="noopener">PDF</a>` : ''}
        <button type="button" class="btn link" data-details="${esc(w.key)}" aria-expanded="${open}">Details</button>
      </div>
      ${w.openalexId ? `<div class="trail"><span class="tiny">Explore:</span>${w.cites ? `<button type="button" class="btn link" data-trail="cites" data-key="${esc(w.key)}">Cited by ${fmt(w.cites)}</button>` : ''}<button type="button" class="btn link" data-trail="refs" data-key="${esc(w.key)}">References</button><button type="button" class="btn link" data-trail="related" data-key="${esc(w.key)}">Similar</button></div>` : ''}
      <div class="details" ${open ? '' : 'hidden'}><dl>
        <dt>Type</dt><dd>${esc(ti.label)}: ${esc(ti.why)}</dd>
        ${w.topic ? `<dt>Topic</dt><dd>${esc(w.topic.name)} (${esc(w.topic.field || '')})</dd>` : ''}
        ${w.doi ? `<dt>DOI</dt><dd><a href="https://doi.org/${esc(w.doi)}" target="_blank" rel="noopener">${esc(w.doi)}</a></dd>` : ''}
        <dt>Found by</dt><dd>${esc(Object.keys(w.ranks).map(k => ((CHANNEL_NAMES[k] || k) + ` #${w.ranks[k]}`)).join(', '))}</dd>
        ${w.openalexId ? `<dt>Record</dt><dd><a href="${esc(safeUrl(w.openalexId))}" target="_blank" rel="noopener">OpenAlex</a></dd>` : ''}
        <dt>Score</dt><dd>${w.rank.score.toFixed(2)} (search match ${w.rank.q.toFixed(2)}, source rank ${w.rank.rrf.toFixed(2)}${hp ? `, profile ${w.rank.prof.toFixed(2)}` : ''}${sem})</dd>
      </dl></div>
    </li>`;
  }

  function renderResults() {
    const s = S.search;
    const vis = visibleWorks();
    renderFilterbar(vis);
    const c = ctx(); const hset = C.highlightStems(c);
    const list = vis.slice(0, s.shown);
    c.topScore = vis.reduce((m, w) => Math.max(m, w.rank ? w.rank.score : 0), 0.0001);
    if (!s.ranked.length) {
      const anyFail = Object.values(s.status).some(x => x && x.ok === false);
      $('#results').innerHTML = `<li class="panel">${anyFail ? 'No results could be fetched. See the messages above.' : 'No papers matched. Try fewer or broader words, or turn off a field restriction.'}</li>`;
    } else if (!vis.length) {
      $('#results').innerHTML = `<li class="panel">None of the ${s.ranked.length} papers fetched so far pass your filters. ${serverFilterButton()}</li>`;
    } else {
      $('#results').innerHTML = list.map((w, i) => paperHTML(w, i, c, hset)).join('');
    }
    const more = [];
    if (vis.length > s.shown) more.push(`<button type="button" class="btn" id="show-more">Show ${Math.min(PAGE, vis.length - s.shown)} more</button>`);
    else if (s.ranked.length) {
      const chans = s.kind === 'trail' ? ['oa_trail'] : ['oa_kw', 'oa_sem', 'crossref', 'epmc'];
      const canFetch = chans.some(k => !s.exhausted[k] && (k !== 'oa_sem' || S.settings.semantic) && (k !== 'crossref' || S.settings.crossref) && (k !== 'epmc' || S.settings.epmc));
      if (canFetch) more.push(`<button type="button" class="btn" id="fetch-more">Get more results from the databases</button><span class="tiny">${s.kind === 'trail' ? 'A citation lookup costs very little (about $0.0001).' : 'Uses about $0.002 of the OpenAlex free allowance.'}</span>`);
      else more.push(`<span class="small muted">That is everything these sources returned for this search.</span>`);
    }
    if (s.kind === 'search' && filtersActive() && vis.length < 8 && s.ranked.length && !s.serverFilters) more.push(serverFilterButton());
    $('#more').innerHTML = more.join('');
  }
  function serverFilterButton() {
    const f = S.filters;
    const canServer = f.yearFrom || f.yearTo || f.oaOnly || (f.cats.size === 1 && (f.cats.has('review') || f.cats.has('preprint')));
    return canServer ? `<button type="button" class="btn small" id="server-filter">Search the databases again with these filters</button>` : '';
  }

  function renderCompare() {
    const s = S.search;
    if (!s.ranked.length || s.kind !== 'search') { $('#compare-holder').innerHTML = ''; return; }
    const gs = `https://scholar.google.com/scholar?q=${encodeURIComponent(s.q)}`;
    const cmp = s.compare;
    let out = '';
    if (cmp) {
      const found = cmp.rows.filter(r => r.found);
      out = `<p class="small"><strong>${found.length} of ${cmp.rows.length}</strong> pasted titles are in Paperscope’s ${fmt(s.ranked.length)} fetched results${found.length ? ` (positions ${found.map(r => r.position).join(', ')} in the current ranking)` : ''}.</p>
        <ul>${cmp.rows.map(r => `<li class="${r.found ? 'found' : 'missing'}">${r.found ? `#${r.position}` : (r.oa ? esc(r.oa) : 'Not retrieved')}: ${esc(r.line)}</li>`).join('')}</ul>
        ${cmp.rows.some(r => !r.found && !r.oa) ? `<button type="button" class="btn small" id="cmp-check">Check OpenAlex for the missing titles</button> <span class="tiny">Sends those titles to OpenAlex; about $0.001 each.</span>` : ''}`;
    }
    $('#compare-holder').innerHTML = `<details class="compare panel" ${cmp ? 'open' : ''}><summary>Compare with Google Scholar</summary>
      <p class="small">Paperscope cannot query Google Scholar. To compare coverage, <a href="${esc(gs)}" target="_blank" rel="noopener">open the same search in Google Scholar</a>, copy the result titles, and paste them here, one per line.</p>
      <label class="sr-only" for="cmp-text">Titles from Google Scholar</label><textarea id="cmp-text" placeholder="One title per line">${cmp ? esc(cmp.text) : ''}</textarea>
      <div class="row" style="margin-top:8px"><button type="button" class="btn small" id="cmp-run">Compare</button></div>${out}</details>`;
  }

  function renderAll() {
    if (!S.search || S.search.kind === 'authorpick') return;
    if (S.search.kind === 'author') { renderModes(); renderAuthorView(); return; }
    renderModes(); renderInterp(); renderMap(); renderAnswer(); renderResults(); renderCompare();
  }

  // ---------------------------------------------------------------- filters sheet
  function openFilters() {
    const f = S.filters;
    const root = $('#sheet-root');
    root.innerHTML = `<div class="sheet-backdrop" data-close-sheet></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-h">
        <h3 id="sheet-h">Filter results</h3>
        <fieldset><legend>Publication type</legend>
          ${CATS.map(([k, label, sub]) => `<label class="check"><input type="checkbox" name="cat" value="${k}" ${f.cats.has(k) ? 'checked' : ''}><span>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span></label>`).join('')}
          <label class="check"><input type="checkbox" id="f-inferred" ${f.hideInferred ? 'checked' : ''}><span>Hide types that are only inferred<small>Types marked with ? come from title or abstract wording, not from the database.</small></span></label>
        </fieldset>
        <fieldset><legend>Year published</legend>
          <div class="years"><label class="sr-only" for="f-y1">From year</label><input id="f-y1" inputmode="numeric" placeholder="From" value="${esc(f.yearFrom)}"> to <label class="sr-only" for="f-y2">To year</label><input id="f-y2" inputmode="numeric" placeholder="To" value="${esc(f.yearTo)}"></div>
        </fieldset>
        <fieldset><legend>Access</legend><label class="check"><input type="checkbox" id="f-oa" ${f.oaOnly ? 'checked' : ''}><span>Open access only</span></label></fieldset>
        <div class="row"><button type="button" class="btn primary" id="apply-filters">Apply</button><button type="button" class="btn" id="reset-filters">Reset</button><button type="button" class="btn link" data-close-sheet>Cancel</button></div>
        <p class="tiny" style="margin-top:12px">Filters apply to the papers already fetched. If few remain, you can search the databases again with them.</p>
      </div>`;
    $('.sheet input', root).focus();
  }
  function closeSheet() { $('#sheet-root').innerHTML = ''; const b = $('#open-filters'); if (b) b.focus(); }
  function applyFilters() {
    const f = S.filters;
    f.cats = new Set([...document.querySelectorAll('.sheet input[name="cat"]:checked')].map(i => i.value));
    if (!f.cats.size) f.cats = new Set(CATS.map(c => c[0]));
    f.hideInferred = $('#f-inferred').checked;
    const y = v => (/^\d{4}$/.test(v.trim()) ? v.trim() : '');
    f.yearFrom = y($('#f-y1').value); f.yearTo = y($('#f-y2').value);
    f.oaOnly = $('#f-oa').checked;
    S.search.shown = PAGE;
    closeSheet(); S.search.kind === 'author' ? renderAuthorView() : renderResults();
  }

  // ---------------------------------------------------------------- saving
  function toggleSave(key) {
    if (S.saved.has(key)) { S.saved.delete(key); toast('Removed from saved'); }
    else {
      const w = S.search && S.search.pool.get(key);
      if (!w) return;
      const copy = C.slim(w); C.prepWork(copy); S.saved.set(key, copy);
      toast(store.set('__probe', 1) ? 'Saved on this device' : 'Saved for this session only (browser storage is unavailable)');
    }
    persistSaved(); updateSavedCount();
    document.querySelectorAll(`[data-save="${CSS.escape(key)}"]`).forEach(b => { const on = S.saved.has(key); b.setAttribute('aria-pressed', on); b.textContent = on ? 'Saved' : 'Save'; });
  }
  function updateSavedCount() { $('#saved-count').textContent = S.saved.size ? `(${S.saved.size})` : ''; }
  function renderSaved() {
    const list = [...S.saved.values()].sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
    if (!list.length) { $('#saved-body').innerHTML = `<p class="muted">Papers you save appear here. They are kept in this browser, not in an account.</p>`; return; }
    $('#saved-body').innerHTML = `<div class="row" style="margin-bottom:10px">
        <button class="btn small" data-export="bib">Copy BibTeX</button><button class="btn small" data-export="ris">Copy RIS</button>
        <button class="btn small" data-download="bib">Download .bib</button><button class="btn small" data-download="ris">Download .ris</button><button class="btn small" data-download="csv">Download .csv</button>
      </div>
      <ul class="saved-list">${list.map(w => `<li><div class="badges"><span class="badge ${esc(w.typeInfo.conf)}">${esc(w.typeInfo.label)}</span>${w.isOA ? '<span class="badge oa">Open access</span>' : ''}</div>
        <h3><a href="${esc(primaryLink(w))}" target="_blank" rel="noopener">${esc(w.title)}</a></h3>
        <p class="byline">${esc(w.authors.slice(0, 3).join(', '))}${w.authors.length > 3 ? ' et al.' : ''}${w.venue ? `. <span class="venue">${esc(w.venue)}</span>` : ''}${w.year ? ` (${w.year})` : ''}</p>
        <div class="actions"><button class="save" aria-pressed="true" data-unsave="${esc(w.key)}">Remove</button>${safeUrl(w.oaUrl) && w.isOA ? `<a href="${esc(w.oaUrl)}" target="_blank" rel="noopener">Free full text</a>` : ''}</div></li>`).join('')}</ul>
      <p style="margin-top:16px"><button class="btn small" id="clear-saved">Remove all saved papers</button></p>`;
  }
  function exportText(kind) {
    const list = [...S.saved.values()];
    return kind === 'bib' ? C.toBibTeX(list) : kind === 'ris' ? C.toRIS(list) : C.toCSV(list);
  }
  async function copyText(t, what) {
    try { await navigator.clipboard.writeText(t); toast(`${what} copied`); }
    catch (e) { toast('Copying is blocked here. Use Download instead.'); }
  }
  function download(kind) {
    const t = exportText(kind);
    const type = kind === 'csv' ? 'text/csv' : 'text/plain';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([t], { type })); a.download = `paperscope-saved.${kind}`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------------------------------------------------------------- profile
  async function readFile(file) {
    const status = $('#parse-status');
    status.textContent = `Reading ${file.name}…`;
    try {
      let text = '';
      const name = file.name.toLowerCase();
      if (name.endsWith('.pdf') || file.type === 'application/pdf') {
        status.textContent = 'Loading the PDF reader…';
        const pdfjs = await import(LIBS.pdfjs);
        pdfjs.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        const pages = [];
        for (let p = 1; p <= Math.min(doc.numPages, 40); p++) {
          status.textContent = `Reading page ${p} of ${doc.numPages}…`;
          const page = await doc.getPage(p);
          const tc = await page.getTextContent();
          pages.push(tc.items.map(it => (it.str || '') + (it.hasEOL ? '\n' : ' ')).join(''));
        }
        text = pages.join('\n');
      } else if (name.endsWith('.docx')) {
        status.textContent = 'Loading the Word reader…';
        if (!window.mammoth) await loadScript(LIBS.mammoth);
        const r = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
        text = r.value;
      } else if (name.endsWith('.doc')) {
        throw new Error('Old .doc files cannot be read here. Save it as .docx or PDF, or paste the text.');
      } else {
        text = await file.text();
      }
      if (text.replace(/\s/g, '').length < 80) throw new Error('Very little text was found. If this is a scanned PDF, paste the text instead.');
      buildProfile(text, file.name);
    } catch (e) {
      status.textContent = e.message && /Could not load|Failed to fetch|import/i.test(e.message) ? 'The file reader could not be downloaded. Check your connection, or paste the text instead.' : (e.message || 'Could not read that file.');
    }
  }
  function buildProfile(text, sourceName) {
    const p = C.extractProfile(text);
    p.source = sourceName || 'pasted text';
    S.profile = p; persistProfile();
    const n = p.interests.length + p.methods.length + p.areas.length;
    $('#parse-status').textContent = n ? `Found ${n} terms. Check them below and remove anything that is not research.` : 'No research terms were found. Try pasting a research statement.';
    renderProfileEditor(); renderModes();
    if (S.search) { S.search.sem = new Map(); rerank(); renderAll(); if (S.ai.status === 'ready') embedPool(); }
  }
  function renderProfileEditor() {
    const el = $('#profile-editor');
    if (!S.profile) { el.innerHTML = ''; return; }
    const p = S.profile;
    const group = (k, title, hint) => `<div class="term-group"><h3>${title} <small>${hint}</small></h3>
      <ul class="chips">${(p[k] || []).map((t, i) => `<li class="chip">${esc(t.text)}${t.expansion ? ` <span class="tiny">(${esc(t.expansion)})</span>` : ''}<button type="button" data-rmterm="${k}:${i}" aria-label="Remove ${esc(t.text)}">×</button></li>`).join('') || '<li class="tiny">None found</li>'}</ul>
      <form class="add-term" data-addterm="${k}"><label class="sr-only" for="add-${k}">Add to ${title}</label><input id="add-${k}" placeholder="Add a term"><button class="btn small" type="submit">Add</button></form></div>`;
    const gl = Object.entries(p.glossary || {});
    el.innerHTML = `<h2>What Paperscope found</h2>
      <p class="small muted">From ${esc(p.source || 'your text')}. These terms are used to rank results and to resolve acronyms. They are never sent anywhere.</p>
      ${group('interests', 'Research interests', 'topics you work on')}
      ${group('methods', 'Methods and techniques', 'how you work')}
      ${group('areas', 'Areas of expertise', 'broad fields')}
      ${gl.length ? `<div class="term-group"><h3>Acronyms <small>used to read your searches</small></h3><ul class="chips">${gl.map(([a, l]) => `<li class="chip">${esc(a)} = ${esc(l)}<button type="button" data-rmacr="${esc(a)}" aria-label="Remove ${esc(a)}">×</button></li>`).join('')}</ul></div>` : ''}
      <label class="switch"><input type="checkbox" id="remember" ${S.settings.rememberProfile ? 'checked' : ''}><span>Remember my profile on this device<br><span class="tiny">Stored in this browser’s local storage. Off: the profile is forgotten when you close the page.</span></span></label>
      <button class="btn small" type="button" id="clear-profile">Delete profile</button>`;
  }
  function profileChanged() {
    persistProfile(); renderProfileEditor(); renderModes();
    S.ai.qcache.delete('__profile');
    if (S.search) { rerank(); renderAll(); if (S.ai.status === 'ready') embedPool(); }
  }

  // ---------------------------------------------------------------- on-device model
  function deviceInfo() {
    const wasm = typeof WebAssembly === 'object';
    const mem = navigator.deviceMemory ? `${navigator.deviceMemory} GB` : 'not reported';
    return { wasm, mem, webgpu: !!navigator.gpu };
  }
  function renderAI() {
    const d = deviceInfo();
    const a = S.ai;
    let body = `<p class="small">A small open-weight language model (all-MiniLM-L6-v2, Apache 2.0) can run in this browser to judge meaning, not just shared words: it re-ranks results and compares them with your profile. It does not write text, so it cannot invent findings.</p>
      <ul class="small"><li>Download: about 20 MB once (model 23 MB and runtime 14 MB before compression), from Hugging Face and jsDelivr. Stored in the browser cache; clear it by clearing this site’s data.</li>
      <li>Speed: roughly a few seconds per search on a recent phone, faster on a laptop. Runs on the processor (WebAssembly).</li>
      <li>This device: WebAssembly ${d.wasm ? 'available' : '<strong>not available (the model cannot run here)</strong>'}; memory ${esc(d.mem)}.</li></ul>`;
    if (a.status === 'off') body += `<button class="btn primary" id="ai-on" ${d.wasm ? '' : 'disabled'}>Download and turn on</button>`;
    if (a.status === 'loading') body += `<p class="small" role="status">Downloading and starting the model… ${Math.round(a.progress)}%</p><div class="progress"><i style="width:${Math.round(a.progress)}%"></i></div>`;
    if (a.status === 'ready') body += `<p class="small"><strong>On.</strong> ${a.lastRun ? `Last search: ${a.lastRun.n} papers embedded in ${(a.lastRun.ms / 1000).toFixed(1)} s on this device.` : 'Results will be re-ranked on the next search.'}</p><button class="btn" id="ai-off">Turn off</button>`;
    if (a.status === 'error') body += `<p class="small" style="color:var(--warn)">The model could not start: ${esc(a.error)}</p><button class="btn" id="ai-on">Try again</button>`;
    $('#ai-panel').innerHTML = body;
  }
  async function loadAI(silent) {
    if (S.ai.status === 'loading' || S.ai.status === 'ready') return;
    S.ai.status = 'loading'; S.ai.progress = 0; renderAI();
    const files = new Map();
    try {
      const t = await import(LIBS.tjs);
      t.env.allowLocalModels = false;
      try {
        const onnx = t.env.backends.onnx;
        const v = onnx && onnx.versions && onnx.versions.web;
        if (v && onnx.wasm) onnx.wasm.wasmPaths = { mjs: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${v}/dist/ort-wasm-simd-threaded.mjs`, wasm: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${v}/dist/ort-wasm-simd-threaded.wasm` };
      } catch (e) { /* keep library default */ }
      S.ai.pipe = await t.pipeline('feature-extraction', MODEL_ID, {
        dtype: 'q8', device: 'wasm',
        progress_callback: p => {
          if (p.status === 'progress' && p.file) { files.set(p.file, { loaded: p.loaded || 0, total: p.total || 0 }); }
          const tot = [...files.values()].reduce((s, f) => s + f.total, 0); const ld = [...files.values()].reduce((s, f) => s + f.loaded, 0);
          S.ai.progress = tot ? (100 * ld) / tot : S.ai.progress;
          if (!$('#view-profile').hidden) renderAI();
        },
      });
      S.ai.status = 'ready'; S.settings.ai = true; saveSettings();
      if (!silent) toast('On-device model ready');
      renderAI();
      if (S.search && S.search.ranked.length) embedPool();
    } catch (e) {
      S.ai.status = 'error'; S.ai.error = e.message || String(e); S.ai.pipe = null; renderAI();
      if (!silent) toast('The model could not start');
    }
  }
  async function embedTexts(texts) {
    const out = await S.ai.pipe(texts, { pooling: 'mean', normalize: true });
    return out.tolist();
  }
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  let embedRun = 0;
  async function embedPool() {
    const s = S.search; if (!s || S.ai.status !== 'ready') return;
    const run = ++embedRun; const token = searchToken;
    const t0 = performance.now();
    const qtext = s.analysis.semanticQuery;
    if (!S.ai.qcache.has('q:' + qtext)) S.ai.qcache.set('q:' + qtext, (await embedTexts([qtext]))[0]);
    const ptext = hasProfile() ? C.profileText(S.profile) : '';
    if (ptext && !S.ai.qcache.has('p:' + ptext)) S.ai.qcache.set('p:' + ptext, (await embedTexts([ptext]))[0]);
    const todo = [...s.pool.values()].filter(w => !S.ai.cache.has(w.key));
    for (let i = 0; i < todo.length; i += 8) {
      const batch = todo.slice(i, i + 8);
      const vecs = await embedTexts(batch.map(w => `${w.title}. ${C.splitSentences(w.abstract).slice(0, 2).join(' ')}`.slice(0, 700)));
      batch.forEach((w, k) => S.ai.cache.set(w.key, vecs[k]));
      if (run !== embedRun || token !== searchToken) return;
      await sleep(0);
    }
    const qv = S.ai.qcache.get('q:' + qtext); const pv = ptext ? S.ai.qcache.get('p:' + ptext) : null;
    s.sem = new Map();
    for (const w of s.pool.values()) { const v = S.ai.cache.get(w.key); if (v) s.sem.set(w.key, { q: dot(qv, v), p: pv ? dot(pv, v) : null }); }
    if (todo.length) S.ai.lastRun = { n: todo.length, ms: performance.now() - t0 };
    rerank(); renderAll();
  }

  // ---------------------------------------------------------------- author pathway
  function newAuthorState(kind, q) {
    return { kind, q, analysis: C.analyzeQuery('', S.profile, {}), choices: {}, sense: null, pool: new Map(), ranked: [], themes: null,
      status: {}, pages: { oa_author: 1 }, exhausted: {}, shown: PAGE, cost: 0, sem: new Map(), dupes: 0, fetched: 0, answer: null };
  }
  async function runAuthorSearch(raw) {
    raw = String(raw || '').trim(); if (!raw) return;
    $('#q').value = raw;
    const token = ++searchToken;
    if (location.hash && location.hash !== '#search') location.hash = '#search';
    S.prevSearch = null; S.filters.theme = null;
    S.search = newAuthorState('authorpick', raw);
    clearSearchUI(); setLoading('Looking up authors…');
    const orcid = /\d{4}/.test(raw) ? C.normOrcid(raw) : null;
    const r = orcid ? await getJSON(oaPath(`/authors/orcid:${orcid}`)) : await getJSON(oaPath('/authors', { search: raw, per_page: 8 }));
    if (token !== searchToken) return;
    addCost(r); setLoading(null);
    if (!r.ok) {
      $('#clarify').innerHTML = `<div class="panel warn" role="alert">${r.status === 404 && orcid ? `OpenAlex has no author linked to ORCID ${esc(orcid)}.` : esc(failText('OpenAlex', r))}</div>`;
      return;
    }
    const cands = (orcid ? [r.data] : (r.data.results || [])).map(C.normAuthor).filter(Boolean);
    S.search.candidates = cands;
    if (!cands.length) { $('#clarify').innerHTML = `<div class="panel">No authors named “${esc(raw)}” in OpenAlex. Check the spelling, try initials (e.g. “P. Blom”), or search by topic instead.</div>`; return; }
    if (cands.length === 1) { openAuthor(cands); return; }
    renderAuthorPicker(cands);
  }
  function renderAuthorPicker(cands) {
    const q = S.search.q;
    $('#clarify').innerHTML = `<div class="panel ask" role="group" aria-labelledby="ap-h">
      <h3 id="ap-h">Which “${esc(q)}”?</h3>
      <p class="small muted">OpenAlex sometimes splits one person into several profiles. Tick every profile that is the same person, then show their works.</p>
      <ul class="authors">${cands.map((c, i) => `<li><label class="acand"><input type="checkbox" name="acand" value="${i}" ${i === 0 ? 'checked' : ''}>
        <span class="avatar" aria-hidden="true">${esc(C.initials(c.name))}</span>
        <span class="ainfo"><span class="aname"><strong>${esc(c.name)}</strong>${c.orcid ? ' <span class="badge oa">ORCID</span>' : ''}</span>
          <span class="small muted">${esc(c.inst || 'Institution not listed')}${c.country ? `, ${esc(c.country)}` : ''}</span>
          <span class="tiny">${fmt(c.works)} works, cited ${fmt(c.cites)} times${c.h != null ? `, h‑index ${c.h}` : ''}</span>
          ${c.topics.length ? `<span class="tiny">${esc(c.topics.slice(0, 2).map(t => t.name).join('; '))}</span>` : ''}</span></label></li>`).join('')}</ul>
      <div class="row" style="margin-top:10px"><button type="button" class="btn primary" id="author-open">Show works</button><span class="tiny">Profiles are listed by how well the name matches.</span></div></div>`;
  }
  // Open one or more author profiles (combined) and load their works grouped by field.
  async function openAuthor(cands, opts = {}) {
    const token = ++searchToken;
    const prev = S.search && (S.search.kind === 'search' || S.search.kind === 'trail' || S.search.kind === 'author') && !opts.noBack ? S.search : S.prevSearch;
    const ids = cands.map(c => shortId(c.id));
    const s = newAuthorState('author', cands[0].name);
    s.author = { cands, ids, name: cands[0].name };
    s.openFields = new Set(); s.fieldShown = {}; s.fieldCounts = null; s.fieldDone = {}; s.hiddenFields = new Set();
    S.search = s; S.prevSearch = prev && prev !== s ? prev : null; S.filters.theme = null;
    S.pathway = 'author'; renderPathway();
    $('#q').value = cands[0].name;
    if (location.hash && location.hash !== '#search') location.hash = '#search';
    clearSearchUI(); window.scrollTo(0, 0);
    setLoading(`Loading works by ${cands[0].name}…`);
    const jobs = [getJSON(oaURL({ filter: `author.id:${ids.join('|')}`, group_by: 'primary_topic.field.id' })),
      getJSON(oaURL({ filter: `author.id:${ids.join('|')}`, sort: 'publication_year:asc', per_page: 1, select: 'publication_year' }))];
    const needDetails = cands.filter(c => !c.full);
    needDetails.forEach(c => jobs.push(getJSON(oaPath(`/authors/${shortId(c.id)}`))));
    const [gb, first, ...details] = await Promise.all(jobs);
    if (token !== searchToken) return;
    addCost(gb); addCost(first);
    if (first.ok && first.data.results && first.data.results[0]) s.firstYear = first.data.results[0].publication_year || null;
    if (gb.ok) {
      s.fieldCounts = (gb.data.group_by || []).map(g => {
        const known = g.key_display_name && g.key_display_name !== 'unknown' && g.key !== 'unknown';
        return { name: known ? g.key_display_name : 'Not classified', count: g.count, id: known ? shortId(g.key) : null };
      });
      s.totalWorks = gb.data.meta ? gb.data.meta.count : null;
      const summed = s.fieldCounts.reduce((t, f) => t + f.count, 0);
      if (s.totalWorks && s.totalWorks > summed && !s.fieldCounts.some(f => f.name === 'Not classified')) s.fieldCounts.push({ name: 'Not classified', count: s.totalWorks - summed, id: null });
    } else s.status.groupby = { ok: false, label: 'OpenAlex field counts', msg: failText('OpenAlex', gb) };
    details.forEach((d, i) => { if (d.ok) { const full = C.normAuthor(d.data); const idx = cands.indexOf(needDetails[i]); if (full && idx >= 0) cands[idx] = full; } });
    await fetchAuthorBatch(token);
    if (token === searchToken) await verifyAuthor(token);
  }
  async function fetchAuthorBatch(token) {
    const s = S.search; if (!s || s.kind !== 'author' || s.exhausted.oa_author) return;
    setLoading(s.fetched ? 'Loading more works…' : `Loading works by ${s.author.name}…`);
    const page = s.pages.oa_author;
    const r = await getJSON(oaURL({ filter: `author.id:${s.author.ids.join('|')}`, per_page: 200, page, sort: 'publication_date:desc', select: OA_SELECT }), { timeout: 30000 });
    if (token !== searchToken) return;
    setLoading(null);
    if (!r.ok) { s.status.oa_author = { ok: false, label: 'OpenAlex works', msg: failText('OpenAlex', r) }; s.exhausted.oa_author = true; rerank(); renderAll(); return; }
    addCost(r);
    const res = r.data.results || [];
    const items = res.map((w, k) => C.normOpenAlex(w, 'oa_author', (page - 1) * 200 + k + 1));
    C.dedupeInto(s.pool, items);
    s.fetched = s.pool.size;
    const total = r.data.meta ? r.data.meta.count : res.length;
    s.status.oa_author = { ok: true, label: 'OpenAlex works', n: s.fetched, total };
    if (!s.totalWorks) s.totalWorks = total;
    s.pages.oa_author++;
    if (res.length < 200 || s.fetched >= total) s.exhausted.oa_author = true;
    recheck(); rerank(); renderAll();
  }
  // Fetch all of the author's works in one field (used when the first pages did not include them all).
  async function loadField(name) {
    const s = S.search; if (!s || s.kind !== 'author' || s.exhausted.oa_author) return false;
    const fc = (s.fieldCounts || []).find(f => f.name === name);
    if (!fc || !fc.id || s.fieldDone[name]) return false;
    const have = [...s.pool.values()].filter(w => (w.topic && w.topic.field) === name).length;
    if (have >= fc.count) { s.fieldDone[name] = true; return false; }
    const token = searchToken;
    setLoading(`Loading all ${fmt(fc.count)} works in ${name}…`);
    for (let page = 1; page <= 5; page++) {
      const r = await getJSON(oaURL({ filter: `author.id:${s.author.ids.join('|')},primary_topic.field.id:${fc.id}`, per_page: 200, page, sort: 'publication_date:desc', select: OA_SELECT }), { timeout: 30000 });
      if (token !== searchToken) return false;
      if (!r.ok) { s.status.field = { ok: false, label: 'OpenAlex field works', msg: failText('OpenAlex', r) }; break; }
      addCost(r);
      const res = r.data.results || [];
      C.dedupeInto(s.pool, res.map((w, k) => C.normOpenAlex(w, 'oa_author', 100000 + (page - 1) * 200 + k)));
      if (res.length < 200) break;
    }
    s.fieldDone[name] = true; s.fetched = s.pool.size;
    setLoading(null); recheck(); rerank();
    return true;
  }
  // ---- ORCID cross-check: the person's ORCID record and publisher ORCID tags (Crossref) decide which papers are theirs.
  async function verifyAuthor(token) {
    const s = S.search; if (!s || s.kind !== 'author') return;
    const orcids = [...new Set(s.author.cands.map(c => C.orcidOf(c.orcid)).filter(Boolean))];
    if (!orcids.length) { s.verify = { state: 'none' }; renderAuthorView(); return; }
    s.verify = { state: 'loading', orcids, showAside: false }; renderAuthorView();
    const jobs = [];
    orcids.forEach(o => {
      jobs.push(getJSON(`${ORCID_API}/${o}/record`, { headers: { Accept: 'application/json' }, timeout: 20000 }));
      jobs.push(getJSON(`${CR}/works?filter=orcid:${o}&rows=1000&select=DOI,title,issued,published,container-title,author,type,URL,is-referenced-by-count`, { timeout: 20000 }));
    });
    const res = await Promise.all(jobs);
    if (token !== searchToken) return;
    const v = s.verify; v.records = []; v.crossref = []; v.errors = [];
    res.forEach((r, i) => {
      const isOrcid = i % 2 === 0;
      if (!r.ok) { v.errors.push(isOrcid ? `ORCID could not be read (${r.status === 0 ? r.error : r.status}).` : failText('Crossref', r)); return; }
      if (isOrcid) v.records.push(C.parseOrcidRecord(r.data));
      else v.crossref.push(...((r.data.message && r.data.message.items) || []));
    });
    if (!v.records.length && !v.crossref.length) { v.state = 'failed'; renderAuthorView(); return; }
    // what the ORCID record and Crossref say this person wrote
    const orcidWorks = v.records.flatMap(rec => rec.works);
    const listed = new Map(); // version key -> {from, doi}
    orcidWorks.forEach(w => w.dois.forEach(d => listed.set(C.versionKey(d), { from: 'ORCID', doi: d })));
    v.crossref.forEach(it => { const d = C.cleanDoi(it.DOI); const k = C.versionKey(d); if (d && !listed.has(k)) listed.set(k, { from: 'Crossref', doi: d }); });
    const have = new Set([...s.pool.values()].map(w => w.doi ? C.versionKey(w.doi) : '').filter(Boolean));
    // fetch papers OpenAlex did not link to this profile, every listed version, by DOI
    const wanted = [...new Set([...orcidWorks.flatMap(w => w.dois), ...v.crossref.map(it => C.cleanDoi(it.DOI)).filter(Boolean)])]
      .filter(d => !have.has(C.versionKey(d)));
    const missingKeys = new Set(wanted.map(C.versionKey).filter(k => !have.has(k)));
    const found = [];
    for (let i = 0; i < wanted.length; i += 50) {
      const chunk = wanted.slice(i, i + 50);
      const r = await getJSON(oaURL({ filter: `doi:${chunk.join('|')}`, per_page: 100, select: OA_SELECT }), { timeout: 30000 });
      if (token !== searchToken) return;
      if (!r.ok) { v.errors.push(failText('OpenAlex', r)); continue; }
      addCost(r);
      found.push(...(r.data.results || []).map((w, k) => C.normOpenAlex(w, 'oa_orcid', i + k + 1)));
    }
    const foundKeys = new Set(found.map(w => C.versionKey(w.doi)));
    const extra = [];
    v.crossref.forEach((it, k) => { const d = C.cleanDoi(it.DOI); if (d && missingKeys.has(C.versionKey(d)) && !foundKeys.has(C.versionKey(d))) { extra.push(C.normCrossref(it, k + 1)); foundKeys.add(C.versionKey(d)); } });
    orcidWorks.forEach((w, k) => {
      const key = w.dois[0] ? C.versionKey(w.dois[0]) : '';
      if (key ? !missingKeys.has(key) || foundKeys.has(key) : [...s.pool.values(), ...found, ...extra].some(x => C.titleSimilarity(x.title, w.title) >= 0.9)) return;
      extra.push(C.normOrcidWork(w, k + 1)); if (key) foundKeys.add(key);
    });
    [...found, ...extra].forEach(w => { w.addedFrom = listed.get(C.versionKey(w.doi)) ? listed.get(C.versionKey(w.doi)).from : 'ORCID'; });
    const before = new Set(s.pool.keys());
    C.dedupeInto(s.pool, [...found, ...extra]);
    v.added = new Set([...s.pool.keys()].filter(k => !before.has(k)));
    // papers with the person's full name that neither OpenAlex's profile nor ORCID has (kept only with other evidence)
    const rec0 = v.records.find(r => r.given && r.family);
    v.nameFound = new Set();
    if (rec0 && C.nameForm(`${rec0.given} ${rec0.family}`, [rec0]) === 'full' && rec0.given.replace(/[^\p{L}]/gu, '').length > 2) {
      const r = await getJSON(oaURL({ filter: `raw_author_name.search:${rec0.given} ${rec0.family}`, per_page: 50, select: OA_SELECT }), { timeout: 30000 });
      if (token !== searchToken) return;
      if (r.ok) {
        addCost(r);
        const cand = (r.data.results || []).map((w, k) => C.normOpenAlex(w, 'oa_name', k + 1))
          .filter(w => (w.ships || []).some(a => C.nameForm(a.raw || a.name, v.records) === 'full'))
          .filter(w => !s.pool.has(C.workKey(w)) && ![...s.pool.values()].some(x => x.doi && w.doi && C.versionKey(x.doi) === C.versionKey(w.doi)));
        cand.forEach(w => { w.key = C.workKey(w); });
        v.nameCandidates = cand;
      }
    }
    v.state = 'done';
    recheck(); rerank(); renderAuthorView();
  }
  // Re-run the evidence check over everything loaded (after more works arrive).
  function recheck() {
    const s = S.search; const v = s && s.verify; if (!v || v.state !== 'done') return;
    const ev = {
      persons: v.records.filter(r => r.family).map(r => ({ given: r.given, family: r.family, others: [r.credit, ...r.others].filter(Boolean) })),
      ids: new Set(s.author.ids.map(id => `https://openalex.org/${id}`)), orcids: new Set(v.orcids),
      orcidDOIs: new Set(v.records.flatMap(r => r.works.flatMap(w => w.dois.map(C.versionKey)))),
      orcidWorks: v.records.flatMap(r => r.works), crossrefDOIs: new Set(v.crossref.map(it => C.versionKey(it.DOI)).filter(Boolean)),
      orgs: v.records.flatMap(r => r.orgs),
    };
    if (!ev.persons.length) ev.persons = s.author.cands.map(c => { const t = String(c.name).split(/\s+/); return { given: t.slice(0, -1).join(' '), family: t.slice(-1)[0] || '', others: [] }; });
    // name-search finds join only if the evidence says they are likely theirs
    if (v.nameCandidates && v.nameCandidates.length) {
      const trial = C.verifyAuthorWorks([...s.pool.values(), ...v.nameCandidates], ev);
      const keep = v.nameCandidates.filter(w => { const r = trial.get(w.key); return r && r.status === 'likely'; });
      keep.forEach(w => { w.addedFrom = 'name'; });
      const before = new Set(s.pool.keys());
      C.dedupeInto(s.pool, keep);
      [...s.pool.keys()].filter(k => !before.has(k)).forEach(k => { v.added.add(k); v.nameFound.add(k); });
      v.nameCandidates = null;
    }
    v.status = C.verifyAuthorWorks([...s.pool.values()], ev);
    v.versions = C.collapseVersions([...s.pool.values()]);
    const n = { orcid: 0, publisher: 0, likely: 0, unconfirmed: 0 };
    s.pool.forEach((w, k) => { if (v.versions.hide.has(k)) return; const st = v.status.get(k); if (st) n[st.status]++; });
    v.counts = n;
    v.onRecord = ev.orcidWorks.length;
    // Only set papers aside when the ORCID record or publishers confirmed at least one paper; otherwise there is nothing to compare with.
    v.active = n.orcid + n.publisher > 0;
  }
  const isAside = (s, w) => !!(s.verify && s.verify.active && !s.verify.showAside && s.verify.status && (s.verify.status.get(w.key) || {}).status === 'unconfirmed');
  const isVersionDup = (s, w) => !!(s.verify && s.verify.versions && s.verify.versions.hide.has(w.key));
  function authorSorted(list) {
    const by = S.sort === 'cited' ? (a, b) => (b.cites || 0) - (a.cites || 0)
      : S.sort === 'best' && hasProfile() ? (a, b) => (b.rank.prof - a.rank.prof) || String(b.date || b.year).localeCompare(String(a.date || a.year))
      : (a, b) => String(b.date || b.year || '').localeCompare(String(a.date || a.year || ''));
    return list.slice().sort(by);
  }
  const fieldSlug = f => 'fg-' + f.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const VBADGE = { orcid: ['ok', 'On ORCID'], publisher: ['ok', 'ORCID on paper'], likely: ['likely', 'Likely theirs'], unconfirmed: ['warn', 'Not confirmed'] };
  function verifyBits(w) {
    const s = S.search; const v = s && s.verify;
    if (!v || v.state !== 'done' || !v.status || !v.active) return { badge: '', note: '' };
    const st = v.status.get(w.key); if (!st) return { badge: '', note: '' };
    const [cls, label] = VBADGE[st.status];
    const added = v.added && v.added.has(w.key) ? `<span class="badge added">${w.addedFrom === 'name' ? 'Found by full name' : 'Added from ' + esc(w.addedFrom === 'Crossref' ? 'publisher record' : 'ORCID')}</span>` : '';
    const vers = v.versions && v.versions.count.get(w.key) ? `<span class="badge">${v.versions.count.get(w.key)} versions</span>` : '';
    const showWhy = st.status === 'likely' || st.status === 'unconfirmed';
    return { badge: `<span class="badge v-${cls}">${label}</span>${added}${vers}`, note: showWhy ? `<p class="vwhy">${st.why.map(esc).join('. ')}.</p>` : '' };
  }
  function verifyPanel(s) {
    const v = s.verify; if (!v) return '';
    if (v.state === 'none') return `<p class="tiny ah-note">OpenAlex links papers to people automatically and sometimes merges people with similar names. This profile has no ORCID iD, so its papers can’t be cross-checked; a field that looks out of place may hold someone else’s papers, and you can hide it below.</p>`;
    if (v.state === 'loading') return `<p class="vpanel tiny" role="status">Checking these papers against ORCID ${esc(v.orcids.join(', '))}…</p>`;
    if (v.state === 'failed') return `<p class="vpanel warn tiny" role="alert">Could not check against ORCID: ${esc(v.errors.join(' '))} Papers by people with similar names may be mixed in.</p>`;
    if (!v.active) return `<p class="vpanel tiny" role="status">Checked ORCID <a href="https://orcid.org/${esc(v.orcids[0])}" target="_blank" rel="noopener">${esc(v.orcids[0])}</a>: ${v.onRecord ? `none of the ${fmt(v.onRecord)} papers on the ORCID record match this profile` : 'the ORCID record lists no papers'}, and no publisher has tagged these papers with the iD, so they can’t be cross-checked. Papers by people with similar names may be mixed in; a field that looks out of place can be hidden below.${v.errors.length ? ` ${esc(v.errors.join(' '))}` : ''}</p>`;
    const n = v.counts; const addedN = v.added ? [...v.added].filter(k => s.pool.has(k) && !isVersionDup(s, s.pool.get(k))).length : 0;
    const confirmed = n.orcid + n.publisher;
    const parts = [`<strong>${fmt(confirmed)}</strong> confirmed`, n.likely ? `<strong>${fmt(n.likely)}</strong> likely theirs` : '', n.unconfirmed ? `<strong>${fmt(n.unconfirmed)}</strong> not confirmed` : ''].filter(Boolean);
    return `<div class="vpanel" role="status"><p><strong>Checked against ORCID</strong> <a href="https://orcid.org/${esc(v.orcids[0])}" target="_blank" rel="noopener">${esc(v.orcids[0])}</a>: ${parts.join(', ')}${addedN ? `; <strong>${fmt(addedN)}</strong> added that OpenAlex had not linked to this profile` : ''}.</p>
      <p class="tiny">Confirmed means the paper is on their ORCID record (${fmt(v.onRecord)} entries) or the publisher lists their ORCID iD on it. Likely means it shares co-authors, the study or their full name with confirmed papers.${v.errors.length ? ` ${esc(v.errors.join(' '))}` : ''}</p>
      ${v.active && n.unconfirmed ? `<button type="button" class="btn small" id="verify-toggle" aria-pressed="${v.showAside}">${v.showAside ? 'Hide the papers that were not confirmed' : `Show the ${fmt(n.unconfirmed)} papers that were not confirmed`}</button>` : ''}</div>`;
  }
  function wrowHTML(w) {
    const ti = w.typeInfo; const link = primaryLink(w); const saved = S.saved.has(w.key);
    const co = (w.authors || []).length ? `<div class="wco">${authorLinks(w, 4)}</div>` : '';
    const vb = verifyBits(w);
    return `<li class="wrow${vb.note && /Not confirmed/.test(vb.badge) ? ' unconf' : ''}" data-key="${esc(w.key)}">
      <div class="badges">${vb.badge}<span class="badge ${esc(ti.conf)}" title="${esc(ti.why)}">${esc(ti.label)}</span>${w.isOA ? '<span class="badge oa">Open access</span>' : ''}${w.retracted ? '<span class="badge warn">Retracted</span>' : ''}</div>
      ${link ? `<a class="wt" href="${esc(link)}" target="_blank" rel="noopener">${esc(w.title)}</a>` : `<span class="wt">${esc(w.title)}</span>`}
      <div class="wmeta">${w.venue ? `<span class="venue">${esc(w.venue)}</span>, ` : ''}${w.year || 'n.d.'}${w.cites ? `, cited by ${fmt(w.cites)}` : ''}${w.topic ? `. ${esc(w.topic.name)}` : ''}</div>
      ${co}${vb.note}
      <div class="actions"><button type="button" class="save" data-save="${esc(w.key)}" aria-pressed="${saved}">${saved ? 'Saved' : 'Save'}</button>
        ${w.cites ? `<button type="button" class="btn link" data-trail="cites" data-key="${esc(w.key)}">Cited by ${fmt(w.cites)}</button>` : ''}
        ${w.openalexId ? `<button type="button" class="btn link" data-trail="refs" data-key="${esc(w.key)}">References</button>` : ''}
        ${w.openalexId ? `<button type="button" class="btn link" data-trail="related" data-key="${esc(w.key)}">Similar</button>` : ''}</div></li>`;
  }
  function renderAuthorView() {
    const s = S.search; const a = s.author; const c0 = a.cands[0];
    const vis = visibleWorks();
    const years = [...s.pool.values()].map(w => w.year).filter(Boolean);
    const y0 = s.exhausted.oa_author || !s.firstYear ? (years.length ? Math.min(...years) : null) : s.firstYear;
    const y1 = years.length ? Math.max(...years) : null;
    const v = s.verify || null;
    const rec0 = v && v.state === 'done' && v.records && v.records.find(r => r.given && r.family);
    const orcidName = rec0 ? (rec0.credit || `${rec0.given} ${rec0.family}`) : '';
    const checked = v && v.state === 'done' && v.active && s.exhausted.oa_author;
    const kept = checked ? [...s.pool.values()].filter(w => !isVersionDup(s, w) && (v.status.get(w.key) || {}).status !== 'unconfirmed') : null;
    const cites = checked ? kept.reduce((t, w) => t + (w.cites || 0), 0) : a.cands.reduce((t, c) => t + (c.cites || 0), 0);
    const hs = checked ? [C.hIndex(kept.map(w => w.cites || 0))] : a.cands.map(c => c.h).filter(h => h != null);
    const fails = Object.values(s.status).filter(x => x && x.ok === false);
    $('#interp').innerHTML = `${fails.length ? `<div class="panel warn" role="alert"><strong>Incomplete.</strong> ${fails.map(f => esc(f.msg)).join(' ')}</div>` : ''}
      <div class="panel author-head">
        <div class="ah-top"><span class="avatar big" aria-hidden="true">${esc(C.initials(orcidName || a.name))}</span>
          <div><h2 class="ah-name">${esc(orcidName || a.name)}</h2>${orcidName && orcidName !== a.name ? `<p class="tiny" style="margin:0">Name from ORCID; OpenAlex lists “${esc(a.name)}”</p>` : ''}<p class="small muted" style="margin:0">${esc(c0.inst || '')}${c0.country ? `, ${esc(c0.country)}` : ''}</p>
          ${c0.orcid ? `<p class="tiny" style="margin:2px 0 0">ORCID <a href="https://orcid.org/${esc(c0.orcid)}" target="_blank" rel="noopener">${esc(c0.orcid)}</a></p>` : ''}</div></div>
        <dl class="ah-stats">
          <div><dt>Works</dt><dd>${checked ? fmt(kept.length) : s.totalWorks != null ? fmt(s.totalWorks) : '–'}</dd></div>
          <div><dt>Citations</dt><dd>${fmt(cites)}</dd></div>
          <div><dt>h-index</dt><dd>${hs.length ? Math.max(...hs) : '–'}</dd></div>
          <div><dt>Active</dt><dd>${y0 && y1 ? (y0 === y1 ? y0 : `${y0}–${y1}`) : '–'}</dd></div></dl>
        ${checked ? `<p class="tiny ah-note">Figures count only papers that passed the ORCID check. OpenAlex’s own profile lists ${fmt(s.totalWorks || 0)} works and ${fmt(a.cands.reduce((t, c) => t + (c.cites || 0), 0))} citations.</p>` : ''}
        ${verifyPanel(s)}
        ${a.cands.length > 1 && !checked ? `<p class="tiny">Combining ${a.cands.length} OpenAlex profiles: ${esc(a.cands.map(c => c.name).join('; '))}. Citations are summed; the h-index shown is the largest single profile’s.</p>` : ''}
        <div class="row">${S.prevSearch ? `<button type="button" class="btn small" id="trail-back">Back to “${esc(S.prevSearch.q.length > 32 ? S.prevSearch.q.slice(0, 30) + '…' : S.prevSearch.q)}”</button>` : ''}
          <a class="small" href="${esc(safeUrl(c0.id))}" target="_blank" rel="noopener">OpenAlex profile</a></div>
        <p class="tiny" style="margin:6px 0 0">${s.status.oa_author && s.status.oa_author.ok ? `${fmt(s.fetched)} of ${fmt(s.status.oa_author.total)} works loaded. ` : ''}OpenAlex cost: $${s.cost.toFixed(4)}.</p></div>`;
    // field bars: counts over all works (group_by), else over loaded works
    const fromChecked = !!(v && v.state === 'done' && v.active);
    const rows = s.fieldCounts && s.fieldCounts.length && !fromChecked ? s.fieldCounts.slice() : C.groupByField(vis).map(g => ({ name: g.field, count: g.count }));
    rows.sort((x, y) => (x.name === 'Not classified') - (y.name === 'Not classified') || y.count - x.count);
    const total = rows.reduce((t, r) => t + r.count, 0) || 1; const max = Math.max(1, ...rows.map(r => r.count));
    $('#map-holder').innerHTML = rows.length ? `<section class="panel fields" aria-labelledby="fields-h"><h3 id="fields-h">Works by field</h3>
      <p class="tiny" style="margin-top:0">${fromChecked ? `The ${fmt(total)} papers that passed the ORCID check${s.exhausted.oa_author ? '' : ' among those loaded so far'}, by the field of each paper’s main topic.` : s.fieldCounts ? `All ${fmt(total)} works, by the field of each work’s main topic in OpenAlex.` : 'Works loaded so far, by the field of each work’s main topic.'} Tap a field to open it.</p>
      <ul class="fbars">${rows.map(r => `<li><button type="button" data-field-jump="${esc(r.name)}"><span class="fb-label"><span>${esc(r.name)}</span><span class="fb-n">${fmt(r.count)} <span class="tiny">${Math.round(100 * r.count / total)}%</span></span></span><span class="fb-track" aria-hidden="true"><span class="fb-bar" style="width:${(100 * r.count / max).toFixed(1)}%"></span></span></button></li>`).join('')}</ul></section>` : '';
    $('#answer-holder').innerHTML = ''; $('#compare-holder').innerHTML = '';
    renderFilterbar(vis);
    const allGroups = C.groupByField(vis);
    const groups = allGroups.filter(g => !s.hiddenFields.has(g.field));
    const hidden = allGroups.filter(g => s.hiddenFields.has(g.field));
    const serverField = name => (s.fieldCounts || []).find(x => x.name === name) || null;
    if (!s.openFields.size && groups.length) s.openFields.add(groups[0].field);
    $('#results').innerHTML = groups.length ? groups.map(g => {
      const n = s.fieldShown[g.field] || 8; const list = authorSorted(g.works);
      const sf = serverField(g.field); const all = sf ? sf.count : null;
      const missing = !s.exhausted.oa_author && !s.fieldDone[g.field] && sf && sf.id && all > g.count && !filtersActive();
      const more = g.count > n ? `Show all ${fmt(missing ? all : g.count)} in ${esc(g.field)}` : missing ? `Load the other ${fmt(all - g.count)} in ${esc(g.field)}` : '';
      return `<li class="fgroup" id="${fieldSlug(g.field)}"><details ${s.openFields.has(g.field) ? 'open' : ''} data-field-group="${esc(g.field)}">
        <summary><span class="fg-name">${esc(g.field)}</span> <span class="fg-n">${fmt(g.count)}${missing ? ` <span class="tiny">of ${fmt(all)}</span>` : ''}</span><span class="fg-sub tiny">${g.years ? (g.years[0] === g.years[1] ? g.years[0] : `${g.years[0]}–${g.years[1]}`) : ''}${g.topTopics.length ? `${g.years ? '. ' : ''}${esc(g.topTopics.map(t => t.name).join('; '))}` : ''}</span></summary>
        <ol class="wlist">${list.slice(0, n).map(wrowHTML).join('')}</ol>
        <div class="row fg-foot">${more ? `<button type="button" class="btn small fg-more" data-fg-more="${esc(g.field)}">${more}</button>` : ''}
          <button type="button" class="btn link" data-fg-hide="${esc(g.field)}">Hide this field</button></div></details></li>`;
    }).join('') + (hidden.length ? `<li class="fg-hidden small muted">Hidden: ${hidden.map(g => `${esc(g.field)} (${fmt(g.count)}) <button type="button" class="btn link" data-fg-show="${esc(g.field)}">Show</button>`).join('; ')}</li>` : '')
      : `<li class="panel">${s.status.oa_author && s.status.oa_author.ok ? 'No works match your filters.' : 'No works loaded.'}</li>`;
    const aside = v && v.state === 'done' && v.active && !v.showAside ? authorSorted([...s.pool.values()].filter(w => !isVersionDup(s, w) && (v.status.get(w.key) || {}).status === 'unconfirmed')) : [];
    if (aside.length) {
      $('#results').insertAdjacentHTML('beforeend', `<li class="fgroup aside" id="fg-aside"><details data-field-group="__aside" ${s.openFields.has('__aside') ? 'open' : ''}>
        <summary><span class="fg-name">Not confirmed</span> <span class="fg-n">${fmt(aside.length)}</span><span class="fg-sub tiny">Linked to this profile by OpenAlex, but not on the ORCID record and with no other evidence. They may be someone else’s.</span></summary>
        <ol class="wlist">${aside.map(wrowHTML).join('')}</ol>
        <div class="row fg-foot"><button type="button" class="btn small" data-verify-show="1">Count them as theirs after all</button></div></details></li>`);
    }
    $('#more').innerHTML = !s.exhausted.oa_author ? `<button type="button" class="btn" id="author-more">Load more works</button><span class="tiny">${fmt(s.fetched)} of ${fmt(s.status.oa_author ? s.status.oa_author.total : 0)} loaded.${fromChecked ? ' Papers are checked against ORCID as they load.' : ' Field counts above already cover all works.'}</span>` : '';
  }
  const doiPath = doi => encodeURI(doi).replace(/[#?]/g, c => encodeURIComponent(c));
  async function runDOI(doi) {
    const token = ++searchToken;
    $('#q').value = doi;
    S.prevSearch = null; S.filters.theme = null;
    const s = newAuthorState('doi', doi); S.search = s;
    clearSearchUI(); setLoading('Looking up the DOI…');
    let r = await getJSON(oaPath(`/works/doi:${doiPath(doi)}`));
    if (token !== searchToken) return;
    let w = null;
    if (r.ok) w = C.normOpenAlex(r.data, 'oa_doi', 1);
    else {
      const c = await getJSON(`${CR}/works/${doiPath(doi)}`, { timeout: 15000 });
      if (token !== searchToken) return;
      if (c.ok && c.data && c.data.message) { w = C.normCrossref(c.data.message, 1); s.status.doi = { ok: true, msg: 'Not in OpenAlex; found in Crossref, so citation links are not available.' }; }
    }
    setLoading(null);
    if (!w) { s.status.doi = { ok: false, msg: r.status === 404 ? 'Neither OpenAlex nor Crossref has a record of it. Check the DOI.' : failText('OpenAlex', r) }; renderInterp(); return; }
    s.analysis = C.analyzeQuery(w.title, S.profile, {});
    C.dedupeInto(s.pool, [w]); s.fetched = 1;
    rerank(); renderAll();
  }

  // ---------------------------------------------------------------- answer mode (user's own AI key)
  function llmReady() {
    const st = S.settings;
    if (!st.llmConsent) return false;
    return st.llmProvider === 'anthropic' ? !!st.llmKey : !!(st.llmBase && st.llmModel);
  }
  function answerPapers() { return visibleWorks().filter(w => w.abstract && w.abstract.length > 80).slice(0, 8); }
  function renderAnswer() {
    const s = S.search; const el = $('#answer-holder');
    if (!s || !s.ranked.length || s.kind !== 'search') { el.innerHTML = ''; return; }
    const a = s.answer;
    if (!a) {
      const n = answerPapers().length;
      el.innerHTML = `<div class="panel answer"><div class="row"><button type="button" class="btn" id="answer-run" ${llmReady() && n >= 2 ? '' : 'disabled'}>Write a short answer from the top papers</button></div>
        <p class="tiny" style="margin:6px 0 0">${llmReady() ? `Sends your search and the abstracts of the top ${n} papers to ${S.settings.llmProvider === 'anthropic' ? 'Anthropic' : esc(S.settings.llmBase)}, billed to your account. Your CV and profile are not sent.` : 'Optional. Uses an AI model with your own key; set it up in <a href="#about">About › Settings</a>. Off by default.'}</p></div>`;
      return;
    }
    if (a.loading) { el.innerHTML = `<div class="panel answer loading"><span class="spinner" aria-hidden="true"></span> Writing an answer from ${a.papers.length} abstracts…</div>`; return; }
    if (a.error) { el.innerHTML = `<div class="panel warn answer" role="alert"><strong>No answer.</strong> ${esc(a.error)} <button type="button" class="btn small" id="answer-run">Try again</button></div>`; return; }
    const chk = a.check;
    const body = chk.sentences.map(x => {
      const t = esc(x.text).replace(/\[(\d+(?:\s*[,;–-]\s*\d+)*)\]/g, (m, refs) => '[' + C.expandRefs(refs).map(r => r >= 1 && r <= a.papers.length ? `<a href="#ans-src-${r}">${r}</a>` : `<span class="bad-ref">${r}?</span>`).join(', ') + ']');
      return x.uncited ? `<span class="uncited" title="No source cited for this sentence">${t}</span>` : t;
    }).join(' ');
    const warns = [];
    if (chk.uncited) warns.push(`${chk.uncited} sentence${chk.uncited > 1 ? 's cite' : ' cites'} no source (underlined); treat ${chk.uncited > 1 ? 'them' : 'it'} with care.`);
    if (chk.invalid.length) warns.push(`It cited paper number${chk.invalid.length > 1 ? 's' : ''} ${chk.invalid.join(', ')}, which ${chk.invalid.length > 1 ? 'were' : 'was'} not supplied.`);
    el.innerHTML = `<div class="panel answer"><p class="small muted" style="margin:0 0 6px">AI-written from the abstracts listed below. Check each claim against its source.</p>
      <p class="answer-text">${body}</p>
      ${warns.length ? `<p class="small" style="color:var(--warn)">${esc(warns.join(' '))}</p>` : ''}
      <ol class="ans-src">${a.papers.map((w, i) => `<li id="ans-src-${i + 1}"><a href="${esc(primaryLink(w))}" target="_blank" rel="noopener">${esc(w.title)}</a> <span class="tiny">(${w.year || 'n.d.'}${chk.cited.includes(i + 1) ? '' : ', not cited'})</span></li>`).join('')}</ol>
      <p class="tiny">Model: ${esc(a.model)}. ${a.usage ? `Tokens: ${esc(a.usage)}, billed to your account.` : ''} <button type="button" class="btn link" id="answer-clear">Hide</button></p></div>`;
  }
  async function callLLM(system, user) {
    const st = S.settings;
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 60000);
    try {
      if (st.llmProvider === 'anthropic') {
        const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctl.signal,
          headers: { 'content-type': 'application/json', 'x-api-key': st.llmKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: st.llmModel || 'claude-haiku-5-5', max_tokens: 700, system, messages: [{ role: 'user', content: user }] }) });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error((data && data.error && data.error.message) || `The provider returned HTTP ${res.status}.`);
        return { text: (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n'), usage: data.usage ? `${data.usage.input_tokens} in, ${data.usage.output_tokens} out` : '' };
      }
      const base = String(st.llmBase || '').replace(/\/+$/, '');
      const headers = { 'content-type': 'application/json' };
      if (st.llmKey) headers.authorization = `Bearer ${st.llmKey}`;
      const send = async lenKey => {
        const body = { model: st.llmModel, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
        body[lenKey] = 700;
        const res = await fetch(`${base}/chat/completions`, { method: 'POST', signal: ctl.signal, headers, body: JSON.stringify(body) });
        const data = await res.json().catch(() => null);
        return { res, data };
      };
      let { res, data } = await send('max_tokens');
      if (!res.ok && data && JSON.stringify(data).includes('max_completion_tokens')) ({ res, data } = await send('max_completion_tokens'));
      if (!res.ok) throw new Error((data && data.error && (data.error.message || data.error)) || `The provider returned HTTP ${res.status}.`);
      const u = data.usage;
      return { text: (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '', usage: u ? `${u.prompt_tokens} in, ${u.completion_tokens} out` : '' };
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('The provider took too long (over 60 s).');
      if (e instanceof TypeError) throw new Error('Could not reach the provider. Check the address, your connection, and that it allows requests from web pages (CORS).');
      throw e;
    } finally { clearTimeout(timer); }
  }
  async function runAnswer() {
    const s = S.search; if (!s || !llmReady()) return;
    const papers = answerPapers();
    if (papers.length < 2) { toast('Need at least two papers with abstracts'); return; }
    const token = searchToken;
    s.answer = { loading: true, papers }; renderAnswer();
    const { system, user } = C.buildAnswerPrompt(s.q, papers);
    try {
      const out = await callLLM(system, user);
      if (token !== searchToken) return;
      if (!out.text.trim()) throw new Error('The model returned an empty answer.');
      s.answer = { papers, text: out.text, usage: out.usage, model: S.settings.llmModel || 'claude-haiku-5-5', check: C.checkAnswer(out.text, papers.length) };
    } catch (e) {
      if (token !== searchToken) return;
      s.answer = { papers, error: e.message || String(e) };
    }
    renderAnswer();
  }

  // ---------------------------------------------------------------- followed searches
  function followsHTML() {
    if (!S.follows.length) return '';
    return `<div class="follows"><h3>Searches you follow</h3><ul class="saved-list">${S.follows.map((f, i) => `<li><strong>${esc(f.q)}</strong>${f.sense ? ` <span class="tiny">(${esc(f.sense.name)})</span>` : ''}<br>
      <span class="tiny">Last checked ${esc(f.lastChecked)}</span>
      <div class="actions"><button type="button" class="save" data-check-follow="${i}">Check for new papers</button><button type="button" class="btn link" data-open-follow="${i}">Run full search</button><button type="button" class="btn link" data-unfollow="${i}">Unfollow</button></div></li>`).join('')}</ul></div>`;
  }
  function renderFollows() {
    const html = followsHTML();
    const a = $('#follows-start'); if (a) a.innerHTML = html;
    const b = $('#follows-saved'); if (b) b.innerHTML = html;
  }
  function toggleFollow() {
    const s = S.search; const i = followIndex(s);
    if (i >= 0) { S.follows.splice(i, 1); toast('Stopped following'); }
    else { S.follows.push({ q: s.q, choices: s.choices || {}, sense: s.sense || null, created: todayISO(), lastChecked: todayISO() }); toast('Following. Check it later from the Saved tab'); }
    persistFollows(); renderFollows(); renderInterp();
  }

  // ---------------------------------------------------------------- ORCID import
  async function importOrcid(raw) {
    const status = $('#orcid-status');
    const id = C.normOrcid(raw);
    if (!id) { status.textContent = 'That is not a valid ORCID iD. It has 16 digits in four groups, and the last can be X.'; return; }
    status.textContent = 'Finding you in OpenAlex…';
    const keyQ = S.settings.apiKey ? `?api_key=${encodeURIComponent(S.settings.apiKey.trim())}` : '';
    const a = await getJSON(`${OA}/authors/orcid:${id}${keyQ}`);
    if (!a.ok) { status.textContent = a.status === 404 ? `OpenAlex has no author linked to ORCID ${id} yet. Try uploading your CV instead.` : failText('OpenAlex', a); return; }
    const author = a.data;
    status.textContent = `Found ${author.display_name || 'you'} (${fmt(author.works_count)} works). Reading your publications…`;
    const w = await getJSON(oaURL({ filter: `author.id:${shortId(author.id)}`, per_page: 100, sort: 'publication_date:desc', select: 'id,display_name,publication_year,keywords,primary_topic,abstract_inverted_index' }));
    addCost(w);
    if (!w.ok) { status.textContent = failText('OpenAlex', w); return; }
    const works = w.data.results || [];
    if (!works.length) { status.textContent = 'No publications are linked to this ORCID iD in OpenAlex.'; return; }
    const p = C.profileFromWorks(works, { source: `ORCID ${id} (${works.length} works in OpenAlex)`, orcid: id });
    const had = !!S.profile;
    S.profile = C.mergeProfiles(S.profile, p);
    persistProfile();
    const n = p.interests.length + p.methods.length + p.areas.length;
    status.textContent = `${had ? 'Added terms from' : 'Built your profile from'} ${works.length} of your publications (${n} terms). Check the list below.`;
    renderProfileEditor(); renderModes();
    if (S.search) { rerank(); renderAll(); }
  }

  // ---------------------------------------------------------------- About
  const FEATURES = [
    ['Profile from CV or statement', 'ok', 'Rule-based extraction in the browser (PDF, .docx, text). Editable. Works best on English CVs with section headings.'],
    ['Profile from ORCID', 'ok', 'Reads your publications in OpenAlex: their keywords, topics, titles and abstracts.'],
    ['Author search', 'ok', 'Search by name or ORCID iD; pick or combine profiles; all works grouped by field with counts. Tap any author name on a result to open their works.'],
    ['ORCID check of an author’s papers', 'ok', 'When an author has an ORCID iD, their papers are checked against their ORCID record and publisher ORCID tags. Papers that don’t match and have no other evidence are set aside with the reasons; papers OpenAlex missed are added.'],
    ['DOI lookup', 'ok', 'Paste a DOI in the search box to open that paper (OpenAlex, then Crossref).'],
    ['Related terms from the results', 'ok', 'Works in any field: terms OpenAlex attaches to many top results. Tap to search them too.'],
    ['Citation trail', 'ok', 'Citing papers, references and similar papers for any result.'],
    ['Sort by best match, newest or most cited', 'ok', 'Newest first also fetches recent papers (last 3 years).'],
    ['Follow a search', 'ok', 'Saved on this device; “Check for new papers” shows what was published since your last check. No emails yet.'],
    ['Answers written from top abstracts', 'proto', 'Optional and off by default. Uses your own Anthropic key, or an OpenAI-compatible service or local model. Sentences without a citation are flagged.'],
    ['Acronym and field questions', 'ok', 'Asks when an acronym has several meanings or a short query spans unrelated fields; uses your profile to answer when it can.'],
    ['Synonym and related-term expansion', 'ok', 'A small curated synonym list plus OpenAlex meaning-based search. Not a full thesaurus.'],
    ['Search OpenAlex, Crossref, Europe PMC; merge duplicates', 'ok', 'By DOI, then by title and year.'],
    ['Ranking with explanations', 'ok', 'Explanations only cite words found in the title or abstract, and quote the abstract verbatim.'],
    ['Publication type filter', 'ok', 'Reviews and perspectives are partly inferred from wording and marked with ?.'],
    ['Theme map', 'ok', 'Based on OpenAlex topics; “close” means overlap with your profile terms.'],
    ['Appearance: Light, Dark or Auto', 'ok', 'Auto follows your device setting. Switch from the header button or here in Settings.'],
    ['Save and export (BibTeX, RIS, CSV)', 'ok', 'Stored in this browser only; no sync between devices.'],
    ['On-device relevance model', 'proto', 'Optional. Tested in desktop Chrome (about 0.8 s for 24 papers); not yet measured on a phone.'],
    ['Google Scholar comparison', 'proto', 'Manual: paste titles from Scholar. Automated comparison is not possible (Scholar blocks automated access).'],
    ['Answers without your own key', 'plan', 'Would need a paid server-side model; planned for a Pro tier.'],
    ['Email alerts and jobs matched to your CV', 'plan', 'Need a small server; next step.'],
    ['Accounts and sync', 'plan', 'Not built; would need a server.'],
  ];
  const LIMITS = [
    'Coverage is that of OpenAlex, Crossref and Europe PMC. Google Scholar also indexes many web pages, theses, books and grey literature these sources miss, and its ranking leans heavily on citations.',
    'OpenAlex’s keyword search covers full text for some papers, so a few results match only in the body text; Paperscope ranks title and abstract matches higher.',
    'About a third of papers have no abstract in these sources; their explanations rely on the title and metadata.',
    'Publication types are only as good as the sources: OpenAlex labels many reviews as “article”. Paperscope adds wording-based guesses, marked with ?.',
    'Profile extraction is rule-based. It can miss terms or pick up names of places and institutions. Check and edit the list.',
    'OpenAlex’s free allowance without a key is small (about 30 searches a day here). Add a free key for more.',
    'Field labels come from OpenAlex’s topic classifier and can be wrong for interdisciplinary papers.',
  ];
  function renderAbout() {
    $('#version').textContent = VERSION;
    $('#api-key').value = S.settings.apiKey || '';
    $('#set-semantic').checked = S.settings.semantic; $('#set-crossref').checked = S.settings.crossref; $('#set-epmc').checked = S.settings.epmc;
    $('#llm-provider').value = S.settings.llmProvider; $('#llm-key').value = S.settings.llmKey || ''; $('#llm-model').value = S.settings.llmModel || '';
    $('#llm-base').value = S.settings.llmBase || ''; $('#llm-consent').checked = !!S.settings.llmConsent;
    $('#llm-base-field').hidden = S.settings.llmProvider === 'anthropic';
    const lab = { ok: ['Working', 'status-ok'], proto: ['Prototype', 'status-proto'], plan: ['Planned', 'status-plan'] };
    $('#feature-table tbody').innerHTML = FEATURES.map(([f, s, n]) => `<tr><td>${esc(f)}</td><td class="${lab[s][1]}">${lab[s][0]}</td><td>${esc(n)}</td></tr>`).join('');
    $('#limits').innerHTML = LIMITS.map(l => `<li>${esc(l)}</li>`).join('');
  }

  // ---------------------------------------------------------------- compare with Scholar
  function runCompare() {
    const s = S.search;
    const text = $('#cmp-text').value;
    const lines = C.parseScholarLines(text).slice(0, 30);
    if (!lines.length) { toast('Paste at least one title'); return; }
    s.compare = { text, rows: C.compareWithList(lines, s.ranked) };
    renderCompare();
  }
  async function checkMissing() {
    const s = S.search; const rows = s.compare.rows.filter(r => !r.found && !r.oa).slice(0, 10);
    const btn = $('#cmp-check'); if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
    for (const r of rows) {
      const res = await getJSON(oaURL({ 'search.title': r.line.slice(0, 250), per_page: 3, select: 'id,display_name,publication_year' }), { retries: 0 });
      addCost(res);
      if (!res.ok) { r.oa = 'OpenAlex check failed'; continue; }
      const hit = (res.data.results || []).find(x => C.titleSimilarity(x.display_name, r.line) >= 0.8);
      r.oa = hit ? 'In OpenAlex but not retrieved by this search' : 'Not found in OpenAlex';
      await sleep(150);
    }
    renderCompare();
  }

  // ---------------------------------------------------------------- events
  document.addEventListener('click', e => {
    const t = e.target.closest('button, [data-theme], [data-exp], a[href^="#"]');
    if (!t) return;
    const d = t.dataset;
    if (d.mode && t.closest('#modes')) {
      if (t.disabled) return;
      S.mode = d.mode; store.set('mode', S.mode); renderModes();
      if (S.search) { S.search.shown = PAGE; rerank(); renderAll(); }
      return;
    }
    if (t.closest('#examples') && !d.authorExample) { S.pathway = 'topic'; store.set('pathway', 'topic'); renderPathway(); runSearch(t.textContent); return; }
    if (d.acr !== undefined && d.long !== undefined) { runSearch(S.search.q, { choices: { ...S.search.choices, [d.acr]: d.long } }); return; }
    if (d.field) {
      if (d.field === 'all') runSearch(S.search.q, { choices: S.search.choices, allFields: true });
      else runSearch(S.search.q, { choices: S.search.choices, sense: { id: Number(d.field), name: d.fname } });
      return;
    }
    if (d.unacr) { runSearch(S.search.q, { choices: { ...S.search.choices, [d.unacr]: '' }, sense: S.search.sense, allFields: S.search.allFields }); return; }
    if (d.unfield) { runSearch(S.search.q, { choices: S.search.choices, allFields: true }); return; }
    if (d.exp !== undefined) {
      const dis = new Set(S.search.choices.disabledExpansions || []);
      dis.has(d.exp) ? dis.delete(d.exp) : dis.add(d.exp);
      runSearch(S.search.q, { choices: { ...S.search.choices, disabledExpansions: [...dis] }, sense: S.search.sense, allFields: S.search.allFields });
      return;
    }
    if (d.theme) {
      S.filters.theme = S.filters.theme === d.theme ? null : d.theme; S.search.shown = PAGE;
      renderMap(); renderResults();
      if (S.filters.theme) $('#filterbar').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (t.id === 'appearance-btn') {
      const order = ['auto', 'light', 'dark']; const next = order[(order.indexOf(currentAppearance()) + 1) % 3];
      applyAppearance(next); toast(`Appearance: ${APPEARANCE_NAMES[next]}`); return;
    }
    if (t.id === 'home-link') { goHome(); return; }
    if (d.pathway && t.closest('.pathways')) {
      S.pathway = d.pathway; store.set('pathway', S.pathway); renderPathway(); $('#q').focus(); return;
    }
    if (d.authorExample) { S.pathway = 'author'; store.set('pathway', 'author'); renderPathway(); runAuthorSearch(d.authorExample); return; }
    if (t.id === 'author-open') {
      const picked = [...document.querySelectorAll('input[name="acand"]:checked')].map(i => S.search.candidates[Number(i.value)]).filter(Boolean);
      if (!picked.length) { toast('Tick at least one profile'); return; }
      openAuthor(picked, { noBack: true }); return;
    }
    if (d.authorId) { openAuthor([{ id: `https://openalex.org/${d.authorId}`, name: d.authorName || 'Author', topics: [], full: false }]); return; }
    if (d.fieldJump !== undefined) {
      const s = S.search; const name = d.fieldJump; s.openFields.add(name);
      const go = () => { renderAuthorView(); const el = document.getElementById(fieldSlug(name)); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); const sm = el.querySelector('summary'); if (sm) sm.focus({ preventScroll: true }); } };
      const has = [...s.pool.values()].some(w => (w.topic && w.topic.field || 'Not classified') === name);
      if (!has) loadField(name).then(go); else go();
      return;
    }
    if (d.fgMore !== undefined) {
      const s = S.search; const name = d.fgMore; s.fieldShown[name] = 100000; s.openFields.add(name);
      loadField(name).then(() => renderAuthorView()); return;
    }
    if (d.fgHide !== undefined) { S.search.hiddenFields.add(d.fgHide); renderAuthorView(); toast(`Hid ${d.fgHide}`); return; }
    if (d.fgShow !== undefined) { S.search.hiddenFields.delete(d.fgShow); S.search.openFields.add(d.fgShow); renderAuthorView(); return; }
    if (t.id === 'author-more') { fetchAuthorBatch(searchToken); return; }
    if (t.id === 'verify-toggle' || d.verifyShow) { const v = S.search.verify; v.showAside = !v.showAside; renderAuthorView(); toast(v.showAside ? 'Showing papers that were not confirmed' : 'Not-confirmed papers set aside'); return; }
    if (d.trail && d.key) { const w = S.search && S.search.pool.get(d.key); if (w) runTrail(w, d.trail); return; }
    if (d.trailSwitch) { runTrail(S.search.trail.seed, d.trailSwitch); return; }
    if (t.id === 'trail-back' && S.prevSearch) {
      searchToken++; S.search = S.prevSearch; S.prevSearch = null; $('#q').value = S.search.q;
      S.pathway = S.search.kind === 'author' ? 'author' : 'topic'; renderPathway();
      clearSearchUI(); rerank(); renderAll(); window.scrollTo(0, 0); return;
    }
    if (d.relatedAdd !== undefined || d.relatedRm !== undefined) {
      const s = S.search; const cur = (s.choices.related || []).slice();
      if (d.relatedAdd !== undefined) { if (!cur.includes(d.relatedAdd)) cur.push(d.relatedAdd); while (cur.length > 3) cur.shift(); }
      else cur.splice(cur.indexOf(d.relatedRm), 1);
      s.choices = { ...s.choices, related: cur };
      s.analysis = C.analyzeQuery(s.q, S.profile, s.choices);
      s.exhausted.oa_rel = false; s.answer = null;
      if (d.relatedAdd !== undefined) fetchBatch(searchToken, { only: ['oa_rel'] });
      else { rerank(); renderAll(); }
      return;
    }
    if (t.id === 'follow-toggle') { toggleFollow(); return; }
    if (d.checkFollow !== undefined) {
      const i = Number(d.checkFollow); const f = S.follows[i]; if (!f) return;
      location.hash = '#search';
      runSearch(f.q, { choices: f.choices, sense: f.sense, allFields: !f.sense, skipQuestion: true, since: f.lastChecked, followIndex: i });
      return;
    }
    if (d.openFollow !== undefined) { const f = S.follows[Number(d.openFollow)]; if (f) { location.hash = '#search'; runSearch(f.q, { choices: f.choices, sense: f.sense, allFields: !f.sense, skipQuestion: true }); } return; }
    if (d.unfollow !== undefined) { S.follows.splice(Number(d.unfollow), 1); persistFollows(); renderFollows(); if (S.search && S.search.kind === 'search') renderInterp(); return; }
    if (t.id === 'answer-run') { runAnswer(); return; }
    if (t.id === 'answer-clear') { S.search.answer = null; renderAnswer(); return; }
    if (t.id === 'open-filters') { openFilters(); return; }
    if (d.closeSheet !== undefined) { closeSheet(); return; }
    if (t.id === 'apply-filters') { applyFilters(); return; }
    if (t.id === 'reset-filters') { S.filters = { cats: new Set(CATS.map(c => c[0])), hideInferred: false, yearFrom: '', yearTo: '', oaOnly: false, theme: S.filters.theme }; closeSheet(); S.search.kind === 'author' ? renderAuthorView() : renderResults(); return; }
    if (d.clear) {
      const f = S.filters;
      if (d.clear === 'cats') f.cats = new Set(CATS.map(c => c[0]));
      else if (d.clear === 'years') { f.yearFrom = ''; f.yearTo = ''; }
      else if (d.clear === 'theme') { f.theme = null; renderMap(); }
      else f[d.clear] = false;
      S.search.kind === 'author' ? renderAuthorView() : renderResults(); return;
    }
    if (t.id === 'show-more') { S.search.shown += PAGE; renderResults(); return; }
    if (t.id === 'fetch-more') { S.search.shown += PAGE; fetchBatch(searchToken); return; }
    if (t.id === 'server-filter') {
      const f = S.filters;
      const sf = { yearFrom: f.yearFrom, yearTo: f.yearTo, oaOnly: f.oaOnly, type: f.cats.size === 1 && f.cats.has('review') ? 'review' : (f.cats.size === 1 && f.cats.has('preprint') ? 'preprint' : '') };
      runSearch(S.search.q, { choices: S.search.choices, sense: S.search.sense, allFields: true, skipQuestion: true, serverFilters: sf });
      return;
    }
    if (d.save) { toggleSave(d.save); return; }
    if (d.unsave) { S.saved.delete(d.unsave); persistSaved(); updateSavedCount(); renderSaved(); return; }
    if (d.details) {
      const k = d.details; const li = t.closest('.paper'); const box = $('.details', li);
      box.hidden = !box.hidden; t.setAttribute('aria-expanded', String(!box.hidden));
      box.hidden ? S.ui.openDetails.delete(k) : S.ui.openDetails.add(k);
      return;
    }
    if (d.export) { copyText(exportText(d.export), d.export === 'bib' ? 'BibTeX' : 'RIS'); return; }
    if (d.download) { download(d.download); return; }
    if (t.id === 'clear-saved') { S.saved.clear(); persistSaved(); updateSavedCount(); renderSaved(); return; }
    if (t.id === 'cmp-run') { runCompare(); return; }
    if (t.id === 'cmp-check') { checkMissing(); return; }
    if (t.id === 'read-text') { const v = $('#cv-text').value; if (v.trim().length < 40) { $('#parse-status').textContent = 'Paste a bit more text: a paragraph at least.'; return; } buildProfile(v, 'pasted text'); return; }
    if (d.rmterm) { const [k, i] = d.rmterm.split(':'); S.profile[k].splice(Number(i), 1); profileChanged(); return; }
    if (d.rmacr) { delete S.profile.glossary[d.rmacr]; profileChanged(); return; }
    if (t.id === 'clear-profile') { S.profile = null; store.del('profile'); $('#parse-status').textContent = 'Profile deleted.'; profileChanged(); return; }
    if (t.id === 'ai-on') { loadAI(false); return; }
    if (t.id === 'ai-off') { S.ai.status = 'off'; S.ai.pipe = null; S.settings.ai = false; saveSettings(); renderAI(); if (S.search) { S.search.sem = new Map(); rerank(); renderAll(); } return; }
  });
  document.addEventListener('toggle', e => {
    const dg = e.target && e.target.dataset && e.target.dataset.fieldGroup;
    if (dg !== undefined && S.search && S.search.openFields) { e.target.open ? S.search.openFields.add(dg) : S.search.openFields.delete(dg); }
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('#sheet-root').innerHTML) closeSheet();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-theme], [data-exp]')) { e.preventDefault(); e.target.click(); }
  });
  document.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    if (f.id === 'search-form') {
      const q = $('#q').value.trim(); $('#q').blur();
      if (!q) return;
      if (S.pathway === 'author') { runAuthorSearch(q); return; }
      const doi = C.isDOI(q);
      if (doi) runDOI(doi); else runSearch(q);
      return;
    }
    if (f.id === 'orcid-form') { importOrcid($('#orcid').value); return; }
    if (f.dataset.acrForm) { const v = $('input', f).value.trim(); if (v) runSearch(S.search.q, { choices: { ...S.search.choices, [f.dataset.acrForm]: v } }); return; }
    if (f.dataset.addterm) {
      const v = $('input', f).value.trim(); if (!v) return;
      if (!S.profile) S.profile = { interests: [], methods: [], areas: [], glossary: {}, source: 'typed terms' };
      S.profile[f.dataset.addterm].push({ text: v, score: 0, added: true }); profileChanged();
      const inp = $(`#add-${f.dataset.addterm}`); if (inp) inp.focus();
    }
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'cv-file' && t.files[0]) readFile(t.files[0]);
    if (t.name === 'appearance') { applyAppearance(t.value); return; }
    if (t.id === 'remember') { S.settings.rememberProfile = t.checked; saveSettings(); persistProfile(); toast(t.checked ? 'Profile will be remembered on this device' : 'Profile removed from this device’s storage'); }
    if (t.id === 'api-key') { S.settings.apiKey = t.value.trim(); saveSettings(); toast(S.settings.apiKey ? 'API key saved in this browser' : 'API key removed'); }
    if (t.id === 'set-semantic') { S.settings.semantic = t.checked; saveSettings(); }
    if (t.id === 'set-crossref') { S.settings.crossref = t.checked; saveSettings(); }
    if (t.id === 'set-epmc') { S.settings.epmc = t.checked; saveSettings(); }
    if (t.id === 'sort') {
      S.sort = t.value; store.set('sort', S.sort);
      const s = S.search; if (!s) return;
      s.shown = PAGE;
      if (S.sort === 'newest' && s.kind === 'search' && !s.wantRecent && !s.since) { s.wantRecent = true; fetchBatch(searchToken, { only: ['oa_recent'] }); }
      else if (s.kind === 'author') renderAuthorView();
      else renderResults();
    }
    if (t.id === 'llm-provider') {
      const was = S.settings.llmProvider; S.settings.llmProvider = t.value;
      if (t.value === 'anthropic' && (!S.settings.llmModel || was !== 'anthropic')) S.settings.llmModel = 'claude-haiku-5-5';
      if (t.value !== 'anthropic' && was === 'anthropic') S.settings.llmModel = '';
      saveSettings(); renderAbout(); if (S.search) renderAnswer();
    }
    if (['llm-key', 'llm-model', 'llm-base'].includes(t.id)) { S.settings[{ 'llm-key': 'llmKey', 'llm-model': 'llmModel', 'llm-base': 'llmBase' }[t.id]] = t.value.trim(); saveSettings(); if (S.search) renderAnswer(); }
    if (t.id === 'llm-consent') { S.settings.llmConsent = t.checked; saveSettings(); if (S.search) renderAnswer(); }
  });
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
  window.addEventListener('hashchange', route);

  // ---------------------------------------------------------------- init
  updateSavedCount(); renderModes(); route(); renderFollows(); renderAppearance();
  if (S.settings.ai) loadAI(true);
  window.Paperscope = { S, runSearch, version: VERSION }; // for debugging and tests
})();
