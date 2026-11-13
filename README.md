# Paperscope

A free research discovery app. You type a few words or a question; Paperscope searches open scholarly databases (OpenAlex, Crossref, Europe PMC), merges the results, ranks them against your query and, if you add one, your research profile, and tells you for each paper why it may be relevant. It is built for phones first.

Paperscope is **not** Google Scholar. It searches different sources, ranks differently, and makes no claim to match Scholar's results. See `EVALUATION.md` for how it compares and where it falls short.

The whole app is one file, `index.html` (about 150 KB). There is no server, account or paid AI service.

**Live version:** <https://branadeb.github.io/paperscope/> (once GitHub Pages is enabled for this repository).

## Running it

Paperscope has to be served from an ordinary web address, because it calls the database APIs directly from your browser.

- **On a computer:** open `index.html` in Chrome, Edge, Firefox or Safari.
- **On a phone:** host the file somewhere free and open the link. Any static host works:
  - *GitHub Pages:* create a repository, add `index.html`, then Settings › Pages › deploy from the main branch.
  - *Netlify Drop:* drag the folder containing `index.html` onto app.netlify.com/drop.
  - *Cloudflare Pages* also works.
- **Not inside a Claude artifact.** Artifact pages run in a sandbox that blocks requests to other sites, so searches would fail there.

### Optional: a free OpenAlex key

OpenAlex meters its free API. Without a key you get about $0.10 of free use per day per network, which is roughly 30 Paperscope searches. A free key from <https://openalex.org/settings/api> raises that to $1 a day (roughly 300 searches). Paste it under **About › Settings**. When the allowance runs out, OpenAlex refuses requests until midnight UTC; it does not charge you unless you have bought prepaid credit on openalex.org. Paperscope shows the cost of every search.

## What it does

| Feature | Status | Notes |
|---|---|---|
| Profile from a CV or research statement (PDF, .docx, text, or pasted) | Working | Rule-based extraction in the browser. Lists research interests, methods, areas and acronyms (e.g. "TA = transient absorption"). Fully editable. |
| Short follow-up questions | Working | Asks when an acronym has several meanings ("MD") or when short query words are used across unrelated domains ("coherence", "relaxation"). Answers from your profile when it can. |
| Synonym and related-term expansion | Working | A small curated synonym list (shown and switchable per search) plus OpenAlex's meaning-based search. Not a full thesaurus. |
| Multi-source search, merge and de-duplicate | Working | OpenAlex keyword + meaning-based search, Crossref, Europe PMC. Merged by DOI, then title and year. |
| Ranking with "why this may be relevant" | Working | Every explanation names only words found in the title or abstract and quotes the abstract verbatim. Papers without an abstract say so. |
| Close to my work / Everything / Adjacent & emerging | Working | Needs a profile. |
| Theme map | Working | Built from OpenAlex topics. Inner ring overlaps your profile; outer ring is adjacent; dashed ring marks themes with many recent papers. Tap to filter. |
| Filters: publication type, year, open access | Working | Applied to fetched results; can re-query the databases with year, open-access, review or preprint filters. |
| Paging | Working | 10 at a time, then fetches more from the databases. |
| Save, export (BibTeX, RIS, CSV), open publisher or repository page | Working | Saved papers live in this browser only. |
| Incomplete-results warnings | Working | Each source's status is shown; failures and exhausted allowances are explained. |
| On-device relevance model | Prototype | Optional all-MiniLM-L6-v2 (Apache 2.0) running in the browser. Tested in desktop Chrome; not yet measured on a phone. |
| Google Scholar comparison | Prototype | Manual: paste Scholar's titles; Paperscope reports which it found and checks OpenAlex for the rest. Scholar blocks automated access. |
| AI-written paper summaries | Planned, not built | See "On-device AI" below. |
| Accounts / sync across devices | Planned, not built | Would need a server. |

## Privacy: what leaves your device

| Information | Sent to |
|---|---|
| Your CV or statement, and the profile made from it | Nowhere. Read in the browser. Stored in local storage only if you turn on "Remember my profile". |
| Search words, an acronym meaning you choose, the domain you pick, filters | OpenAlex; also Crossref and Europe PMC if those sources are on (About › Settings). |
| Your OpenAlex API key | OpenAlex only. |
| Titles pasted into "Compare with Google Scholar" | Nowhere, unless you tap "Check OpenAlex", which sends the missing titles to OpenAlex. |
| Saved papers | Nowhere. |

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
- **Not built:** a generative model to write summaries or explanations. Models small enough to run in a phone browser (roughly 250 MB–1 GB downloads, e.g. 0.5B-parameter instruct models via WebLLM or Transformers.js) are slow without WebGPU, strain phone memory, and can state findings that are not in the abstract. Explanations instead quote the abstract and name the matching words, which can be checked.

## Known limitations

- Coverage is that of OpenAlex, Crossref and Europe PMC. Google Scholar also indexes web pages, many books, theses and grey literature, and ranks heavily by citations; results will differ.
- OpenAlex's keyword search includes full text for some papers, so some results match only in the body; Paperscope ranks title and abstract matches higher. For broad physical-science queries, OpenAlex's own ranking leans towards older literature (see `EVALUATION.md`); use the year filter or "Adjacent & emerging" for recent work.
- Many records have no abstract; their explanations rely on the title and metadata.
- Profile extraction is rule-based and English-only. It can miss terms or keep stray phrases. Check and edit it.
- Field and topic labels come from OpenAlex's classifier and can be wrong for interdisciplinary papers.
- Saved papers and settings are per browser. Clearing site data deletes them; export first.
- The synonym list is small and hand-made. Meaning-based search covers much of the rest.

## Development

```
src/core.js      ranking, profile extraction, query analysis, types, explanations (no DOM; testable in Node)
src/app.js       user interface
src/styles.css   styles
src/index.html   page template
tools/build.mjs  inlines everything into dist/index.html (copy it to the repository root as index.html to publish)
test/core.test.cjs   unit tests (node test/core.test.cjs)
test/ui.test.cjs     end-to-end test in headless Chrome with mocked APIs (needs puppeteer-core and axe-core)
```

Build: `node tools/build.mjs`. Licence for the data: OpenAlex is CC0; check each publisher's terms for full texts.
