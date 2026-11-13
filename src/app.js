/* Paperscope UI. Depends on window.Core (core.js). */
(function () {
  'use strict';
  const C = window.Core;
  const VERSION = '0.9.0';
  const PAGE = 10;
  const OA = 'https://api.openalex.org';
  const CR = 'https://api.crossref.org';
  const EP = 'https://www.ebi.ac.uk/europepmc/webservices/rest';
  const OA_SELECT = 'id,doi,display_name,publication_year,publication_date,type,cited_by_count,authorships,primary_location,best_oa_location,open_access,primary_topic,keywords,abstract_inverted_index,citation_normalized_percentile,is_retracted';
  const LIBS = {
    pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.min.mjs',
    pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.worker.min.mjs',
    mammoth: 'https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js',
    tjs: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js',
  };
  const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
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
    settings: Object.assign({ apiKey: '', crossref: true, epmc: true, semantic: true, rememberProfile: false, ai: false }, store.get('settings', {})),
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
  function saveSettings() { store.set('settings', S.settings); }
  function persistProfile() { if (S.settings.rememberProfile && S.profile) store.set('profile', S.profile); else store.del('profile'); }
  function persistSaved() { store.set('saved', [...S.saved.values()].map(C.slim)); }

  // ---------------------------------------------------------------- network
  async function getJSON(url, { timeout = 20000, retries = 1 } = {}) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeout);
      try {
        const res = await fetch(url, { signal: ctl.signal });
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
  function addCost(r) { if (r && r.ok && r.data && r.data.meta && typeof r.data.meta.cost_usd === 'number') { S.sessionCost += r.data.meta.cost_usd; if (S.search) S.search.cost += r.data.meta.cost_usd; } }
  function failText(src, r) {
    if (r.status === 429) return src.startsWith('OpenAlex') ? 'OpenAlex refused the request: the free daily allowance is used up or requests came too fast. It resets at midnight UTC; a free API key (About › Settings) gives 10× more.' : `${src} is limiting requests. Try again in a minute.`;
    if (r.status === 401 || r.status === 403) return `${src} refused the request (${r.status}). If you added an API key, check it in About › Settings.`;
    if (r.status === 400) return `${src} could not read this query (400). Try simpler wording.`;
    if (r.status === 0) return `${src} could not be reached (${r.error}).`;
    return `${src} returned an error (${r.status}).`;
  }

  // ---------------------------------------------------------------- routing
  const VIEWS = ['search', 'profile', 'saved', 'about'];
  function route() {
    const v = (location.hash || '#search').slice(1);
    const view = VIEWS.includes(v) ? v : 'search';
    VIEWS.forEach(x => { $('#view-' + x).hidden = x !== view; });
    document.querySelectorAll('.tabs a').forEach(a => a.setAttribute('aria-current', a.dataset.view === view ? 'page' : 'false'));
    if (view === 'saved') renderSaved();
    if (view === 'profile') { renderProfileEditor(); renderAI(); }
    if (view === 'about') renderAbout();
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- search flow
  let searchToken = 0;
  function ctx() {
    const s = S.search;
    return { analysis: s.analysis, profile: S.profile, mode: S.mode, nowYear: new Date().getFullYear(), sem: S.ai.status === 'ready' ? s.sem : null, hasProfile: hasProfile() };
  }
  function hasProfile() { return !!(S.profile && ((S.profile.interests || []).length + (S.profile.methods || []).length + (S.profile.areas || []).length)); }

  async function runSearch(q, opts = {}) {
    q = String(q || '').trim();
    if (!q) return;
    $('#q').value = q;
    const token = ++searchToken;
    const choices = Object.assign({}, opts.choices || {});
    const analysis = C.analyzeQuery(q, S.profile, choices);
    S.search = { q, analysis, choices, sense: opts.sense || null, senseAuto: false, fieldInfo: null, allFields: !!opts.allFields,
      pool: new Map(), ranked: [], themes: null, status: {}, pages: { oa_kw: 1, oa_sem: 1, crossref: 0, epmc: '*' }, exhausted: {},
      shown: PAGE, cost: 0, serverFilters: opts.serverFilters || null, sem: new Map(), dupes: 0, fetched: 0, compare: null };
    S.filters.theme = null;
    $('#start').hidden = true;
    $('#clarify').innerHTML = ''; $('#interp').innerHTML = ''; $('#map-holder').innerHTML = ''; $('#filterbar').innerHTML = '';
    $('#results').innerHTML = ''; $('#more').innerHTML = ''; $('#compare-holder').innerHTML = '';
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

  function oaFilter() {
    const s = S.search; const parts = [];
    if (s.sense) parts.push(`primary_topic.domain.id:${s.sense.id}`);
    const f = s.serverFilters;
    if (f) {
      if (f.yearFrom || f.yearTo) parts.push(`publication_year:${f.yearFrom || 1500}-${f.yearTo || new Date().getFullYear() + 1}`);
      if (f.oaOnly) parts.push('is_oa:true');
      if (f.type) parts.push(`type:${f.type}`);
    }
    return parts.join(',');
  }

  async function fetchBatch(token) {
    const s = S.search; const a = s.analysis;
    setLoading(s.fetched ? 'Getting more results…' : 'Searching OpenAlex' + (S.settings.crossref ? ', Crossref' : '') + (S.settings.epmc ? ' and Europe PMC' : '') + '…');
    const filter = oaFilter();
    const jobs = [];
    if (!s.exhausted.oa_kw) jobs.push(['oa_kw', 'OpenAlex keyword search', getJSON(oaURL({ search: a.keywordQuery, filter, per_page: 40, page: s.pages.oa_kw, select: OA_SELECT }))]);
    if (S.settings.semantic && !s.exhausted.oa_sem) jobs.push(['oa_sem', 'OpenAlex meaning-based search', getJSON(oaURL({ 'search.semantic': a.semanticQuery, filter, per_page: 25, page: s.pages.oa_sem, select: OA_SELECT }))]);
    else if (!S.settings.semantic) s.status.oa_sem = { skip: true, label: 'OpenAlex meaning-based search', msg: 'off in Settings' };
    const sf = s.serverFilters || {};
    if (S.settings.crossref && !s.exhausted.crossref) {
      const p = new URLSearchParams({ 'query.bibliographic': a.semanticQuery, rows: 20, offset: s.pages.crossref, select: 'DOI,title,abstract,type,issued,published,container-title,author,is-referenced-by-count,URL' });
      const cf = []; if (sf.yearFrom) cf.push(`from-pub-date:${sf.yearFrom}`); if (sf.yearTo) cf.push(`until-pub-date:${sf.yearTo}`); if (cf.length) p.set('filter', cf.join(','));
      jobs.push(['crossref', 'Crossref', getJSON(`${CR}/works?${p}`, { timeout: 15000 })]);
    } else if (!S.settings.crossref) s.status.crossref = { skip: true, label: 'Crossref', msg: 'off in Settings' };
    if (S.settings.epmc && !s.exhausted.epmc) {
      let query = a.keywordQuery;
      if (sf.yearFrom || sf.yearTo) query += ` AND PUB_YEAR:[${sf.yearFrom || 1800} TO ${sf.yearTo || new Date().getFullYear() + 1}]`;
      if (sf.oaOnly) query += ' AND OPEN_ACCESS:y';
      if (sf.type === 'review') query += ' AND PUB_TYPE:"review"';
      const p = new URLSearchParams({ query, format: 'json', resultType: 'core', pageSize: 20, cursorMark: s.pages.epmc });
      jobs.push(['epmc', 'Europe PMC', getJSON(`${EP}/search?${p}`, { timeout: 15000 })]);
    } else if (!S.settings.epmc) s.status.epmc = { skip: true, label: 'Europe PMC', msg: 'off in Settings' };

    const results = await Promise.all(jobs.map(j => j[2]));
    if (token !== searchToken) return;
    const before = s.pool.size; let incoming = 0;
    results.forEach((r, i) => {
      const [ch, label] = jobs[i];
      if (!r.ok) { s.status[ch] = { ok: false, label, msg: failText(label, r) }; s.exhausted[ch] = true; return; }
      let items = [];
      if (ch === 'oa_kw' || ch === 'oa_sem') {
        addCost(r);
        const per = ch === 'oa_kw' ? 40 : 25;
        const off = (s.pages[ch] - 1) * per;
        const res = r.data.results || [];
        items = res.map((w, k) => C.normOpenAlex(w, ch, off + k + 1));
        const total = r.data.meta ? r.data.meta.count : res.length;
        const prev = s.status[ch] && s.status[ch].n || 0;
        s.status[ch] = { ok: true, label, n: prev + res.length, total };
        s.pages[ch]++;
        if (res.length < per || off + res.length >= total || (ch === 'oa_sem' && s.pages[ch] > 2)) s.exhausted[ch] = true;
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
        items = res.map((it, k) => C.normEPMC(it, prevN + k + 1));
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
    if (S.ai.status === 'ready') embedPool();
    else if (S.settings.ai && S.ai.status === 'off') loadAI(true);
  }

  function rerank() {
    const s = S.search; if (!s) return;
    s.ranked = C.rankWorks([...s.pool.values()], ctx());
    s.themes = C.computeThemes(s.ranked, ctx());
  }

  function visibleWorks() {
    const s = S.search; if (!s) return [];
    const f = S.filters;
    const theme = f.theme && s.themes ? s.themes.themes.find(t => t.id === f.theme) : null;
    const tkeys = theme ? new Set(theme.keys) : null;
    return s.ranked.filter(w => {
      const ti = w.typeInfo;
      if (!f.cats.has(ti.cat)) return false;
      if (f.hideInferred && ti.conf === 'inferred') return false;
      if (f.yearFrom && (!w.year || w.year < Number(f.yearFrom))) return false;
      if (f.yearTo && (!w.year || w.year > Number(f.yearTo))) return false;
      if (f.oaOnly && !w.isOA) return false;
      if (tkeys && !tkeys.has(w.key)) return false;
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

  function renderModes() {
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

  function renderInterp() {
    const s = S.search; const a = s.analysis;
    const bits = [];
    bits.push(`<p>Keyword search: <code>${esc(a.keywordQuery)}</code></p>`);
    const chips = [];
    a.acronyms.forEach(x => chips.push(`<li class="chip">${esc(x.acr)} = ${esc(x.long)} <span class="tiny">(${esc(x.how)})</span> <button type="button" title="Search ${esc(x.acr)} as typed" aria-label="Remove meaning for ${esc(x.acr)}" data-unacr="${esc(x.acr)}">×</button></li>`));
    a.expansions.forEach(x => chips.push(`<li class="chip toggle ${x.on ? '' : 'off'}" role="button" tabindex="0" aria-pressed="${x.on}" data-exp="${esc(x.text)}" title="${x.on ? 'Tap to stop searching this related term' : 'Tap to include this related term'}">${x.on ? '+' : ''} ${esc(x.text)} <span class="tiny">for ${esc(x.for)}</span></li>`));
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
    $('#interp').innerHTML = `${warn}<details class="panel interp" ${s.fetched && s.fetched < 30 ? 'open' : ''}><summary class="small"><strong>How this was searched</strong></summary>${bits.join('')}</details>`;
  }

  function renderMap() {
    const s = S.search;
    if (!s.themes || !s.ranked.length) { $('#map-holder').innerHTML = ''; return; }
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
      <ul class="chips" style="margin:0">${chips.join('')}</ul><span class="count">${Math.min(s.shown, vis.length)} of ${vis.length} shown</span></div>`;
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
    const authors = w.authors.length > 3 ? `${w.authors.slice(0, 3).join(', ')} et al.` : w.authors.join(', ');
    const saved = S.saved.has(w.key);
    const link = primaryLink(w);
    const free = safeUrl(w.oaUrl) && w.isOA ? safeUrl(w.oaUrl) : '';
    const pdf = safeUrl(w.pdf);
    const open = S.ui.openDetails.has(w.key);
    const reasons = ex.reasons.map(r => `<li class="${esc(r.kind)}">${esc(r.text)}</li>`).join('');
    const ev = ex.evidence ? `<blockquote>“${highlight(ex.evidence.text, hset)}${ex.evidence.truncated ? '…' : ''}”<cite>From the abstract (${esc(ex.evidence.from)})</cite></blockquote>` : '';
    const sem = w.rank.sem ? `; model similarity to query ${w.rank.sem.q.toFixed(2)}${w.rank.sem.p != null ? `, to profile ${w.rank.sem.p.toFixed(2)}` : ''}` : '';
    return `<li class="paper ${closeCls}" data-key="${esc(w.key)}">
      <div class="badges"><span class="badge ${esc(ti.conf)}" title="${esc(ti.why)}">${esc(ti.label)}</span>${w.isOA ? '<span class="badge oa">Open access</span>' : ''}${w.retracted ? '<span class="badge warn">Retracted</span>' : ''}${w.cites ? `<span class="badge">Cited by ${fmt(w.cites)}</span>` : ''}</div>
      <h3>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(w.title)}</a>` : esc(w.title)}</h3>
      <p class="byline">${esc(authors)}${authors ? '. ' : ''}${w.venue ? `<span class="venue">${esc(w.venue)}</span>` : ''}${w.year ? ` (${w.year})` : ''}</p>
      <div class="why"><ul>${reasons}</ul>${ev}${ex.note ? `<p class="note">${esc(ex.note)}</p>` : ''}</div>
      <div class="actions">
        <button type="button" class="save" data-save="${esc(w.key)}" aria-pressed="${saved}">${saved ? 'Saved' : 'Save'}</button>
        ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${w.doi ? 'Publisher page' : 'Source page'}</a>` : ''}
        ${free && free !== link ? `<a href="${esc(free)}" target="_blank" rel="noopener">Free full text${w.oaHost ? ` (${esc(w.oaHost)})` : ''}</a>` : ''}
        ${pdf && pdf !== free ? `<a href="${esc(pdf)}" target="_blank" rel="noopener">PDF</a>` : ''}
        <button type="button" class="btn link" data-details="${esc(w.key)}" aria-expanded="${open}">Details</button>
      </div>
      <div class="details" ${open ? '' : 'hidden'}><dl>
        <dt>Type</dt><dd>${esc(ti.label)}: ${esc(ti.why)}</dd>
        ${w.topic ? `<dt>Topic</dt><dd>${esc(w.topic.name)} (${esc(w.topic.field || '')})</dd>` : ''}
        ${w.doi ? `<dt>DOI</dt><dd><a href="https://doi.org/${esc(w.doi)}" target="_blank" rel="noopener">${esc(w.doi)}</a></dd>` : ''}
        <dt>Found by</dt><dd>${esc(Object.keys(w.ranks).map(k => ({ oa_kw: 'OpenAlex keyword', oa_sem: 'OpenAlex meaning-based', crossref: 'Crossref', epmc: 'Europe PMC' }[k] + ` #${w.ranks[k]}`)).join(', '))}</dd>
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
      const canFetch = ['oa_kw', 'oa_sem', 'crossref', 'epmc'].some(k => !s.exhausted[k] && (k !== 'oa_sem' || S.settings.semantic) && (k !== 'crossref' || S.settings.crossref) && (k !== 'epmc' || S.settings.epmc));
      if (canFetch) more.push(`<button type="button" class="btn" id="fetch-more">Get more results from the databases</button><span class="tiny">Uses about $0.002 of the OpenAlex free allowance.</span>`);
      else more.push(`<span class="small muted">That is everything these sources returned for this search.</span>`);
    }
    if (filtersActive() && vis.length < 8 && s.ranked.length && !s.serverFilters) more.push(serverFilterButton());
    $('#more').innerHTML = more.join('');
  }
  function serverFilterButton() {
    const f = S.filters;
    const canServer = f.yearFrom || f.yearTo || f.oaOnly || (f.cats.size === 1 && (f.cats.has('review') || f.cats.has('preprint')));
    return canServer ? `<button type="button" class="btn small" id="server-filter">Search the databases again with these filters</button>` : '';
  }

  function renderCompare() {
    const s = S.search;
    if (!s.ranked.length) { $('#compare-holder').innerHTML = ''; return; }
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
    if (!S.search) return;
    renderModes(); renderInterp(); renderMap(); renderResults(); renderCompare();
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
    closeSheet(); renderResults();
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

  // ---------------------------------------------------------------- About
  const FEATURES = [
    ['Profile from CV or statement', 'ok', 'Rule-based extraction in the browser (PDF, .docx, text). Editable. Works best on English CVs with section headings.'],
    ['Acronym and field questions', 'ok', 'Asks when an acronym has several meanings or a short query spans unrelated fields; uses your profile to answer when it can.'],
    ['Synonym and related-term expansion', 'ok', 'A small curated synonym list plus OpenAlex meaning-based search. Not a full thesaurus.'],
    ['Search OpenAlex, Crossref, Europe PMC; merge duplicates', 'ok', 'By DOI, then by title and year.'],
    ['Ranking with explanations', 'ok', 'Explanations only cite words found in the title or abstract, and quote the abstract verbatim.'],
    ['Publication type filter', 'ok', 'Reviews and perspectives are partly inferred from wording and marked with ?.'],
    ['Theme map', 'ok', 'Based on OpenAlex topics; “close” means overlap with your profile terms.'],
    ['Save and export (BibTeX, RIS, CSV)', 'ok', 'Stored in this browser only; no sync between devices.'],
    ['On-device relevance model', 'proto', 'Optional. Tested in desktop Chrome (about 0.8 s for 24 papers); not yet measured on a phone.'],
    ['Google Scholar comparison', 'proto', 'Manual: paste titles from Scholar. Automated comparison is not possible (Scholar blocks automated access).'],
    ['AI-written summaries of papers', 'plan', 'Not built. Small generative models that run on a phone (hundreds of MB) are slow and can invent claims; quoting the abstract is safer.'],
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
    if (t.closest('#examples')) { runSearch(t.textContent); return; }
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
    if (t.id === 'open-filters') { openFilters(); return; }
    if (d.closeSheet !== undefined) { closeSheet(); return; }
    if (t.id === 'apply-filters') { applyFilters(); return; }
    if (t.id === 'reset-filters') { S.filters = { cats: new Set(CATS.map(c => c[0])), hideInferred: false, yearFrom: '', yearTo: '', oaOnly: false, theme: S.filters.theme }; closeSheet(); renderResults(); return; }
    if (d.clear) {
      const f = S.filters;
      if (d.clear === 'cats') f.cats = new Set(CATS.map(c => c[0]));
      else if (d.clear === 'years') { f.yearFrom = ''; f.yearTo = ''; }
      else if (d.clear === 'theme') { f.theme = null; renderMap(); }
      else f[d.clear] = false;
      renderResults(); return;
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
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('#sheet-root').innerHTML) closeSheet();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-theme], [data-exp]')) { e.preventDefault(); e.target.click(); }
  });
  document.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    if (f.id === 'search-form') { runSearch($('#q').value); $('#q').blur(); return; }
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
    if (t.id === 'remember') { S.settings.rememberProfile = t.checked; saveSettings(); persistProfile(); toast(t.checked ? 'Profile will be remembered on this device' : 'Profile removed from this device’s storage'); }
    if (t.id === 'api-key') { S.settings.apiKey = t.value.trim(); saveSettings(); toast(S.settings.apiKey ? 'API key saved in this browser' : 'API key removed'); }
    if (t.id === 'set-semantic') { S.settings.semantic = t.checked; saveSettings(); }
    if (t.id === 'set-crossref') { S.settings.crossref = t.checked; saveSettings(); }
    if (t.id === 'set-epmc') { S.settings.epmc = t.checked; saveSettings(); }
  });
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
  window.addEventListener('hashchange', route);

  // ---------------------------------------------------------------- init
  updateSavedCount(); renderModes(); route();
  if (S.settings.ai) loadAI(true);
  window.Paperscope = { S, runSearch, version: VERSION }; // for debugging and tests
})();
