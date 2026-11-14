# Paperscope

A free research discovery app. You type a few words or a question; Paperscope searches open scholarly databases (OpenAlex, Crossref, Europe PMC), merges the results, ranks them against your query and, if you add one, your research profile, and tells you for each paper why it may be relevant. It is built for phones first.

Paperscope is **not** Google Scholar. It searches different sources, ranks differently, and makes no claim to match Scholar's results. See `EVALUATION.md` for how it compares and where it falls short.

The whole app is one file, `index.html` (about 290 KB, including its typeface). There is no server, account or paid AI service.

## Install it as an app

Paperscope is free and anyone can install it: no store, no account, no download size to speak of. Share this link, which opens the install steps: **https://branadeb.github.io/Paperscope/#install**

It is a progressive web app: install it from the browser and it gets its own icon and window, opens offline, and updates itself.

- **iPhone or iPad:** open the site, tap Share, then **Add to Home Screen**. (The Home Screen app keeps its own storage, separate from Safari.)
- **Android:** in Chrome, tap **Install** on the start screen, or ⋮ › **Install app**.
- **Mac:** Safari › File › **Add to Dock**; or the install icon in Chrome's or Edge's address bar.
- **Windows, ChromeOS, Linux:** the install icon in Chrome's or Edge's address bar.

App-store versions are not needed and are not planned. For reference, they would need developer accounts (Google Play $25 once, Apple $99 a year; check the Microsoft Store's current terms). Google Play and the Microsoft Store accept a packaged web app (PWABuilder or Bubblewrap); Apple generally rejects apps that only wrap a website (guideline 4.2), so an iOS store version would need native features first.

## Paperscope Lab (experiments)

**https://branadeb.github.io/Paperscope/lab/** is a copy of the app for trying new ideas before they reach the main app. It keeps its own saved papers, profile, settings and offline copy: storage keys start `paperscope-lab.`, its cache is named `pslab-…`, and its service worker covers only `/lab/`. A button on its start screen copies saved papers, a remembered profile and an OpenAlex key from the main app; that copy only reads from the main app and never changes it.

Experiments in the Lab now:

- **Swipe to sort.** From any results list, sort papers one card at a time. Swipe right (or →) to keep, left (←) to skip, up (↑) for a read-later list; buttons do the same, and Undo takes back the last choice. Papers you keep or put aside nudge later searches a little (at most ±0.08 on the ranking score) towards papers with the same words. Profile shows the words it learned, and they can be forgotten in one tap. Respects reduced-motion settings.
- **Trail quests.** "Trace its origin" on any result starts a quest: Paperscope shows the papers it cites (most cited first) and suggests two next steps, each with its reason: a **closest match** (shares the most words with your trail) and a **big leap back** (at least 8 years older, well cited, still sharing a word). Each card says how many years earlier it is. Step back, undo, or stop when you think you have found the root; if OpenAlex lists no references, it says the data ends there. The finished trail is a timeline that replays step by step. It can be shared as a link that carries only OpenAlex ids (`#trail=o:W….W…`, opened with one $0.0001 lookup) and is kept under Saved › Your trails. From a trail you can also see where the first paper led, following citing papers forward. Each step costs about $0.0001.
- **Papers of the day.** At the top of the start screen. Each time you open the app (once a day; *Check again* refreshes), it finds new journal articles from the **last 5 days** in four steps, like a search:
  1. **Your topics**, plus a few curated related phrasings for umbrella terms and synonyms by level. For ultrafast spectroscopy these are transient absorption, pump-probe, 2DES, 2D IR, excited-state dynamics, time-domain spectroscopy and others. The panel lists them under *Choose journals and topics*. A profile's terms are added.
  2. **New papers from three sources** for the publishers you choose:
     - **Crossref** lists a paper the day its DOI is registered. It searches titles only, one request at a time; your words go in groups of at most 7 per request, because Crossref returns nothing for one long query.
     - **OpenAlex**: one keyword search over titles and abstracts, filtered by publisher (OpenAlex publisher ids) and publication date. It is a day or two behind Crossref but finds papers whose titles don't use your words; in a live check, 64 of 499 papers came only from it.
     - **Semantic Scholar** (off unless you turn it on): suggestions similar to your 10 most recently saved papers. This sends their DOIs to Semantic Scholar.
     - Older papers with new DOI records (back issues, re-registered records) are left out. A paper must have gone online within a week of the window, or have no older date than a month.
  3. **Score** each paper against your topics. Words must sit close together, topics many new papers share count less, and a lone topic is not discounted.
  4. **Combine** that score with the sources' own ranks, **label** each paper and **pick a varied list** of up to 15. The labels are *Your topic*; *Your method* (it matches only your technique topics, such as transient absorption, while you also listed subjects; at most 5); and *Nearby* (suggested from your saved papers without sharing a topic word; at most 3). The same topic doesn't fill the list, and near-identical titles (e.g. Angewandte's two editions) appear once.

  Each paper names the topics it mentions and the source that found it. Papers shown on an earlier day are not repeated. You can save papers from the list or swipe through them. OpenAlex's meaning-based search is not used here, because it can filter only by year, not by date or publisher: in a test only 2 of its top 50 were from the last 5 days. Nothing runs in the background, because a web app can't wake itself up: the check happens when you open it. A check with four publishers and eight topics makes about 17 requests and takes about 20 seconds. It uses $0.001 of the OpenAlex allowance; Crossref and Semantic Scholar are free.
- **New ranking (v2).** The Lab ranks with a revised score; the previous one stays available under About › Settings › Ranking method, so the two can be compared.
  - Each idea in the search is weighted by how rare it is among the fetched papers. An idea every candidate mentions separates them less. Single generic words such as "dynamics" or "state" count half.
  - A paper that misses a specific idea loses part of its match score and says so: "Does not mention “crystals” in its title or abstract." The loss is up to 65% in the default modes and 25% in *Adjacent & emerging*, so papers from neighbouring fields are not shut out.
  - Words of a phrase count more when they are close together (within three extra words), in the title or the abstract. Words that are merely present somewhere count less.
  - Synonyms count by level: *same* (spellings, 2DIR = 2D IR = two-dimensional infrared) in full, *related* (conductivity and conductance, ultrafast and femtosecond) at 70%, *broader* at 45%. "Migration" is the same as diffusion after exciton, energy, triplet or singlet, but only related after ion, since ion migration is driven by an electric field and diffusion by a concentration gradient.
  - Chemical notation is kept: SCN⁻, Fe²⁺ and MoS₂ become `scn-`, `fe2+`, `mos2` and are not stemmed. An ion written without its charge counts at 80%.
- **Grading and benchmark.** *Grade results* on a search shows its top papers to grade: No, Slightly, Yes or Exactly.
  - To be fair to each ranking, the list is the top 12 of the new ranking, the previous ranking and the databases' own order, mixed in a fixed shuffled order.
  - Grades are kept on the device with the search and its candidate papers (the top 60 plus every graded one), so later ranking versions are compared on exactly the same papers.
  - Profile › Graded searches shows, per search and on average, nDCG@10 (the top 10 against the best possible order of your grades, ungraded papers counted as not relevant) and the share of relevant papers in the top 5, for the databases' order, the previous ranking and the new one. It also shows how many of each top 10 were graded.
  - Grades can be exported and imported as JSON.
- **Models, measured on your grades.** Profile › Graded searches can also measure:
  - The **on-device model** (all-MiniLM-L6-v2, or bge-small-en-v1.5, which scores better on retrieval benchmarks; choose in Profile). The text runs on the device and nothing is sent.
  - **OpenAlex's reranker**: a model that reorders OpenAlex's top 100 keyword results using the title, journal, year and type. It is measured on its own and as the keyword order fed into the new ranking. It costs about $0.002 per graded search, once.
  - The **AI check**, if you ran it on a graded search.

  Untested papers count as not relevant, so each line reports how much of the ranking's top 10 you have graded. The reranker can be turned on for normal searches in Settings; it is off by default and doubles the cost of the keyword search.
- **Your orbit and "More like this".** Saved › Your orbit shows the phrases (one to three words, no stop words) that recur across your saved papers' titles and abstracts. Title phrases and recent saves count more; a save's weight halves after 90 days.
  - **Find more like my saved papers** (or **More like this** on any paper) starts from up to five papers. For each it runs an OpenAlex meaning-based search with that paper's own title and abstract, and fetches OpenAlex's related works, newer papers citing it and its references.
  - Results leave out papers you have saved. They are ranked by the phrases they share with the starting papers, by how strongly the sources found them and, if the on-device model is on, by meaning. Each says how it connects, e.g. "Cites “…”" or "Shares “exciton transport” with the papers you started from".
  - **Keep going** adds the papers you saved in that round as starting papers and shows only papers not shown before.
  - Normal searches lean a little towards your orbit, from 3 saved papers on: at most +0.06, stated on the paper ("Close to papers you saved: …"). This can be turned off in Saved.
  - Full texts are not read: most publisher PDFs cannot be fetched from a web page, and the title and abstract carry most of what matters for finding similar papers.
- **AI check (optional, your own key).** On a search, **Check the top 30 with AI** sends the search and the top 30 titles and abstracts to the provider set up under About › Settings (Anthropic, or any OpenAI-compatible service). It asks the model to grade each paper 0–3 on whether it studies what was searched for, not just whether it uses the words, with a reason of at most 12 words. The list can then be ordered by those grades, each paper shows the model's reason, and the token counts are shown. Your CV and profile are not sent. On a graded search, the check's order is kept so Graded searches can compare it with your own grades. Signing in with a ChatGPT plan instead of a key is not built yet: OpenAI allows it for approved partner apps and open-source tools, and whether it works from a site with no server is still to be checked.
- **Your sky.** The Saved view draws saved papers as stars, with fields as constellations. Brighter stars are more cited, read-later papers are faint, and new ones pulse. Tap a star for its paper. The sky can be saved as a PNG.

Build it with `node tools/build.mjs lab/src dist/lab`; the source is in `lab/src`. Tests: `test/lab.test.cjs`, `test/lab-quest.test.cjs`, `test/lab-today.test.cjs` and `test/lab-core.test.cjs`.

## Running it

Paperscope has to be served from an ordinary web address, because it calls the database APIs directly from your browser.

- **On a computer:** open `index.html` in Chrome, Edge, Firefox or Safari.
- **On a phone:** host the file somewhere free and open the link. Any static host works:
  - *GitHub Pages:* create a repository, add `index.html`, then Settings › Pages › deploy from the main branch.
  - *Netlify Drop:* drag the folder containing `index.html` onto app.netlify.com/drop.
  - *Cloudflare Pages* also works.
- **Not inside a Claude artifact.** Artifact pages run in a sandbox that blocks requests to other sites, so searches would fail there.

### Optional: a free OpenAlex key

Paperscope has no server, so every user gets their own free allowance. OpenAlex meters its free API: without a key you get about $0.10 of free use per day (apparently per network address, so a shared campus network may share it). A Paperscope search usually uses $0.002–0.003 (measured live, November 2026: $0.002 for a specific query, $0.003 when it asks which field you mean), so that is roughly 30–50 searches. A free key raises that to $1 a day (roughly 300–500 searches). **Getting one takes a minute inside the app:** About › Settings › *Free OpenAlex key*, or the link <https://branadeb.github.io/Paperscope/#key>. Type your email, tap *Email me a key*, and click the link OpenAlex emails you; Paperscope switches to the key by itself. (This uses OpenAlex's key endpoint, `POST https://api.openalex.org/api-keys`; your email goes to OpenAlex only.) You can also paste a key from <https://openalex.org/settings/api-key>. Paperscope shows how much of the day's allowance is left, read from OpenAlex's `X-RateLimit-*` response headers. Paste it under **About › Settings**. When the allowance runs out, OpenAlex refuses requests until midnight UTC; it does not charge you unless you have bought prepaid credit on openalex.org. Paperscope shows the cost of every search. When OpenAlex refuses, Paperscope still searches Crossref and Europe PMC and marks the results as incomplete.

## What it does

| Feature | Status | Notes |
|---|---|---|
| Which databases answered | Working | Every search shows a line above the results such as "Searched: ✓ OpenAlex 36 ✓ Crossref 20 ✓ Europe PMC 12" (papers fetched from each), "… trying again" while a source is retried, "✕ no answer" if it failed, or "off in Settings". About › Settings › *Check that all databases answer* sends one tiny request to each from your own device (the OpenAlex one is a free single-record lookup) and reports which answer and how fast, or what went wrong. Crossref and Europe PMC are retried once, quietly, 4 seconds after a failure. |
| Profile from a CV or research statement (PDF, .docx, text, or pasted) | Working | Rule-based extraction in the browser. Lists research interests, methods, areas and acronyms (e.g. "TA = transient absorption"). Fully editable. |
| Profile from ORCID | Working | Enter your ORCID iD; Paperscope reads your publications in OpenAlex (keywords, topics, titles, abstracts) and builds or extends your profile. |
| Short follow-up questions | Working | Asks when an acronym has several meanings ("MD") or when short query words are used across unrelated domains ("coherence", "relaxation"). Answers from your profile when it can. |
| Synonym and related-term expansion | Working | A small curated synonym list (shown and switchable per search) plus OpenAlex's meaning-based search. Not a full thesaurus. |
| Related terms from the results | Working | Works in any field: terms OpenAlex attaches to many of the top results, shown as chips. Tap one to search it too (one extra call). |
| Author search | Working | Switch the search box to **Authors** and type a name or ORCID iD. If several OpenAlex profiles match, pick one or tick several to combine them (OpenAlex sometimes splits one person). Shows works, citations, h-index and active years, a bar chart of works by field, and every work grouped by field (newest or most cited first). Any field can be loaded in full or hidden. Tap any author's name on a result to open their works. |
| ORCID check of an author's papers | Working | When the author has an ORCID iD, Paperscope reads their public ORCID record and the ORCID iDs publishers attach to papers (Crossref). A paper is **confirmed** if it is on the record or tagged with the iD; **likely theirs** if it shares two or more co-authors, the same study (e.g. preprint and published version) or their full name plus their field or affiliation with confirmed papers; otherwise **not confirmed** and set aside in its own section, with the reasons (e.g. "Name given only as 'M. Mondal'; affiliation not in their record; no co-authors in common"). Papers on the record that OpenAlex had not linked to the profile are added, and so are papers found by the person's full name when the same evidence supports them. Preprint versions are shown once. Header figures and field bars then count only checked papers. You can bring the set-aside papers back with one tap. |
| DOI lookup | Working | Paste a DOI (or a doi.org link) in the topic search box to open that paper; falls back to Crossref if OpenAlex lacks it. |
| Citation trail | Working | On any result: papers citing it, its references, or similar papers. "Back" returns to your search. |
| Sort: best match, newest, most cited | Working | "Newest first" also fetches papers from the last three years; weakly matching papers stay below relevant ones. |
| Follow a search | Working | Saved on this device. "Check for new papers" (Saved tab) shows what was published since your last check, marked New. No emails yet. |
| Multi-source search, merge and de-duplicate | Working | OpenAlex keyword + meaning-based search, Crossref, Europe PMC. Merged by DOI, then title and year. |
| Ranking with "why this may be relevant" | Working | Every explanation names only words found in the title or abstract and quotes the abstract verbatim. Papers without an abstract say so. |
| Close to my work / Everything / Adjacent & emerging | Working | Needs a profile. |
| Theme map | Working | Built from OpenAlex topics. Inner ring overlaps your profile; outer ring is adjacent; dashed ring marks themes with many recent papers. Tap to filter. |
| Filters: publication type, year, open access | Working | Applied to fetched results; can re-query the databases with year, open-access, review or preprint filters. |
| Paging | Working | 10 at a time, then fetches more from the databases. |
| Free OpenAlex key from inside the app | Working | Email field in About › Settings: OpenAlex creates a key and emails an activation link; Paperscope starts using the key once it is active (it checks when you come back to the app). Handles typos, existing accounts, pending keys and OpenAlex's daily limit on new keys. Shows how much of today's allowance is left, under results and in Settings. |
| Install as an app (home screen, dock, Start menu) | Working | Web app manifest, icons (including maskable and Apple touch icons) and a service worker that keeps only the app itself on the device, so it opens offline. Searches and anything sent to other services are never cached. Chrome reports it installable; an Install button appears where the browser allows it, and iPhone users get Add to Home Screen instructions. |
| Appearance: Light, Dark or Auto | Working | Like macOS: Auto follows the device setting. Header button or About › Settings; remembered on the device. |
| Save, export (BibTeX, RIS, CSV), open publisher or repository page | Working | Saved papers live in this browser only. |
| Incomplete-results warnings | Working | Each source's status is shown; failures and exhausted allowances are explained. |
| On-device relevance model | Prototype | Optional all-MiniLM-L6-v2 (Apache 2.0) running in the browser. Tested in desktop Chrome; not yet measured on a phone. |
| Short answers written from the top abstracts | Prototype | Optional and off by default. Uses your own key with Anthropic, or any OpenAI-compatible service, including a model on your own computer. Every sentence must cite a numbered abstract; uncited sentences and citations to papers that were not supplied are flagged. |
| Google Scholar comparison | Prototype | Manual: paste Scholar's titles; Paperscope reports which it found and checks OpenAlex for the rest. Scholar blocks automated access. |
| Answers without your own key | Planned | Needs a paid server-side model (a possible Pro tier). |
| Email alerts; jobs matched to your CV | Planned | Need a small server (step 2). |
| Accounts / sync across devices | Planned, not built | Would need a server. |

## Privacy: what leaves your device

| Information | Sent to |
|---|---|
| Your CV or statement, and the profile made from it | Nowhere. Read in the browser. Stored in local storage only if you turn on "Remember my profile". |
| Search words, an acronym meaning you choose, the domain you pick, filters | OpenAlex; also Crossref and Europe PMC if those sources are on (About › Settings). |
| Your OpenAlex API key | OpenAlex only. |
| Titles pasted into "Compare with Google Scholar" | Nowhere, unless you tap "Check OpenAlex", which sends the missing titles to OpenAlex. |
| Saved papers and followed searches | Nowhere. |
| Your ORCID iD (only if you import from ORCID) | OpenAlex, to find your publications. |
| An author name or ORCID iD you search for, or a DOI | OpenAlex (and Crossref for a DOI OpenAlex lacks). |
| The ORCID iD of an author you open | ORCID (their public record), Crossref (papers tagged with the iD) and OpenAlex (the papers listed). |
| For "Write a short answer" (only if you set it up): your search and the titles and abstracts of the top papers | The AI provider you choose, using your own key and billed to you. Never your CV or profile. |

Code is downloaded only when needed, and never with your data: pdf.js or mammoth.js (about 1 MB, from jsDelivr) when you open a PDF or Word file, and the optional model (below). As with any website, each service sees your IP address.

## How ranking works

For each search Paperscope makes up to four requests: an OpenAlex field check (short queries only), an OpenAlex keyword search using the expanded query, an OpenAlex meaning-based search (`search.semantic`), plus Crossref and Europe PMC. That is $0.002–0.003 of the OpenAlex allowance.

Results are merged and scored on:

- match to your search words and their synonyms (title counts more than abstract, which counts more than OpenAlex keywords);
- position in each source's own ranking (reciprocal-rank fusion; papers found by several searches rise);
- overlap with your profile terms (weighted by mode);
- OpenAlex's field- and year-normalised citation percentile, lightly;
- recency, lightly (more in "Adjacent & emerging").

Retracted papers are flagged and pushed down. Datasets, software records and book reviews are labelled and pushed down. Each card's **Details** shows the score breakdown.

## Publication types

Types come from the sources where possible: OpenAlex (`review`, `preprint`, `editorial`…), Crossref (`posted-content`) and Europe PMC/PubMed publication types. Sources often call reviews "article" (OpenAlex labels the widely cited 2015 *Energy & Environmental Science* review "Exciton diffusion in organic semiconductors" as an article), so Paperscope also looks for wording such as "this review", "are reviewed", "Perspective:" or "Outlook". Types found that way are shown with a "?" and a dashed badge, and can be hidden in Filters. Anything labelled only "article" is shown as "Article" with a dashed badge, because that label does not prove original research.

## On-device AI

The brief asked for a free, open-weight model running on the device. What was built and why:

- **Built (optional):** all-MiniLM-L6-v2, a 22-million-parameter sentence-embedding model, int8-quantised, run with Transformers.js 4.3.2 and ONNX Runtime Web (WebAssembly, CPU). It compares the meaning of your query and profile with each paper's title and opening abstract sentences, and blends that into the ranking. It produces numbers, not text, so it cannot invent findings.
  - Download: about 20 MB compressed (23 MB model, 14 MB runtime), once, from Hugging Face and jsDelivr; cached by the browser. Clear it by clearing the site's data.
  - Compatibility: any current browser with WebAssembly. Memory use was not measured.
  - Speed: in testing, the model started in about 4 s and embedded 24 papers in about 0.8 s on a desktop-class CPU in headless Chrome. Phones will be slower; this has not been measured.
- **Answers (optional, your own key):** under About › Settings you can connect Anthropic (default model `claude-haiku-5-5`) or any OpenAI-compatible service, including a model running on your own computer (free, but it must accept requests from web pages). Paperscope sends the search and the top abstracts, asks for an answer that cites them by number, then checks every sentence for a citation. The provider bills you directly and shows token counts after each answer.
- **Not built on the device:** a generative model running inside the browser. Models small enough to run in a phone browser (roughly 250 MB–1 GB downloads, e.g. 0.5B-parameter instruct models via WebLLM or Transformers.js) are slow without WebGPU, strain phone memory, and can state findings that are not in the abstract. Explanations instead quote the abstract and name the matching words, which can be checked.

## Known limitations

- Coverage is that of OpenAlex, Crossref and Europe PMC. Google Scholar also indexes web pages, many books, theses and grey literature, and ranks heavily by citations; results will differ.
- OpenAlex's keyword search includes full text for some papers, so some results match only in the body; Paperscope ranks title and abstract matches higher. For broad physical-science queries, OpenAlex's own ranking leans towards older literature (see `EVALUATION.md`); use the year filter or "Adjacent & emerging" for recent work.
- Many records have no abstract; their explanations rely on the title and metadata.
- Profile extraction is rule-based and English-only. It can miss terms or keep stray phrases. Check and edit it.
- Field and topic labels come from OpenAlex's classifier and can be wrong for interdisciplinary papers.
- Saved papers and settings are per browser. Clearing site data deletes them; export first.
- The synonym list is small and hand-made. Meaning-based search covers much of the rest.
- Author profiles are OpenAlex's automatic matching of papers to people. It sometimes splits one person into several profiles and sometimes merges people with similar names (for example, one well-known chemist's profile also holds an atmospheric scientist's papers). The field breakdown makes this easy to spot, and the author view lets you combine profiles or hide a field, but it cannot fix the underlying data.
- The ORCID check is only as good as the evidence. An ORCID record can be incomplete, so a real paper with only initials, new co-authors and a new affiliation can be set aside; one tap brings these back. Two people who share co-authors could still be mixed. Profiles without an ORCID iD can't be checked.
- ORCID's free public API is licensed for non-commercial use. If Paperscope starts earning money, the ORCID check would need ORCID membership (the Member API) or another source, such as the publisher tags in Crossref.
- An author's h-index and citation total are OpenAlex's figures unless the ORCID check ran, in which case they are computed from the checked papers; when profiles are combined, citations are summed and the largest single h-index is shown (a true combined h-index would need every work's citations).

## Design

**Navigation works like a phone app** (main app and Lab). The back button, Android's back gesture or the back arrow in the header (shown whenever there is somewhere to go back to, useful in an iPhone home-screen app, which has no back button) steps back inside the app:
- It first closes an open panel (filters, swipe cards).
- Then it returns from a paper's references, citing papers, "More like this" or an author page to the results you came from. From results it goes to the start screen, and from Profile, Saved or About to Search.
- Only from the start screen does it leave the app.

Refining a search (choosing what an acronym means, or a field) replaces the step instead of adding one. Each place keeps its scroll position, so switching tabs or going back returns you to the same spot in the results. Tapping the current tab scrolls it to the top, and the logo goes to the start screen. Taps no longer flash grey or zoom on a double tap.

A night-sky hero and theme map with a thin light-spectrum band as the signature; titles in Spectral (Production Type, SIL Open Font License), embedded in the page so no font is fetched from another site; a phone-style tab bar at the bottom on small screens. Each result shows a five-bar match meter: teal when it overlaps your profile, amber when it lies outside your listed areas. Checked with axe-core in light, dark and auto modes (no WCAG 2 A/AA violations).

## Development

```
src/core.js      ranking, profile extraction, query analysis, types, explanations (no DOM; testable in Node)
src/app.js       user interface
src/styles.css   styles (light and dark themes)
src/fonts/       Spectral web fonts and licence (OFL)
src/index.html   page template
tools/build.mjs  inlines everything into dist/index.html; writes dist/manifest.webmanifest, dist/sw.js (cache versioned per build) and dist/icons/
tools/icons.mjs  renders the app icons from one SVG
src/pwa/         manifest, service worker and icons
test/core.test.cjs   unit tests (node test/core.test.cjs)
test/ui.test.cjs     end-to-end test in headless Chrome with mocked APIs (needs puppeteer-core and axe-core)
test/ui-step1.test.cjs  browser tests for related terms, citation trail, sorting, follows, ORCID and answers
test/ui-author.test.cjs browser tests for author search, works by field, co-author navigation and DOI lookup
test/pwa.test.cjs       install and offline tests (manifest, icons, service worker, install prompts)
```

Build: `node tools/build.mjs`. Licence for the data: OpenAlex is CC0; check each publisher's terms for full texts.
