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
