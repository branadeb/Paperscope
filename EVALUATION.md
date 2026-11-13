# Paperscope evaluation (12 November 2026)

## Summary

- **Retrieval works well for specific and interdisciplinary questions.** For "How do ion channels drive confined cancer cell migration?" and "singlet fission tetracene", the first 15–20 results from both OpenAlex channels were on topic, and the landmark papers a specialist would expect were near the top.
- **Broad physical-science phrases skew old.** For "exciton migration in molecular crystals", OpenAlex's own ranking favoured papers from 1957–1980. One widely cited 2015 review was missing from the top 20 of both channels.
- **Ambiguity handling works on real data.** "coherence" and "relaxation" were correctly flagged as spanning unrelated domains, and a physical-science profile resolved both. "singlet fission tetracene" was correctly left alone.
- **Explanations are grounded by construction and by test.** Every quoted sentence is a verbatim substring of the abstract (500-case property test, plus 9/9 in the browser test). Every "Title/Abstract mentions …" term appears in that field.
- **Links point to real papers.** Sampled DOIs resolve through doi.org to the publisher, and OpenAlex records exist for every sampled DOI.
- **No automated Google Scholar comparison was possible.** Scholar's robots rules refused our fetch, so the app includes a manual comparison tool and this report gives a protocol for it.
- **Automated tests:** 33/33 unit tests and 43/43 browser checks pass, including an axe-core scan with no WCAG A/AA violations.

## How it was tested, and the constraints

| What | How | Limitation |
|---|---|---|
| Live retrieval quality | Ran the exact OpenAlex URLs the app builds (keyword, meaning-based, field check) for 8 queries, through a web-fetch tool, and reviewed the top 15–20 results | The build machine could not call the APIs directly; result lists were read through the fetch tool. Abstracts were not fetched in bulk. |
| Local re-ranking | Ran the app's ranking code on the real titles, years, types and citation counts returned for one query (`test/fixtures/live-exciton.json`) | Title-only: no abstracts or topics in that fixture. |
| User interface | Headless Chrome at iPhone size (390×844) running the built page; APIs mocked with clearly synthetic records (DOI prefix 10.5555); pdf.js, mammoth and the model served from local copies of the same files | Real CORS behaviour of the three APIs was not exercised. |
| Links | Resolved sample DOIs via doi.org; looked up DOIs in OpenAlex | Some publishers (ACS) refuse automated fetches, so their pages could not be opened, though the DOIs redirect. |
| Google Scholar | Attempted fetch was refused (robots disallowed) | Comparison must be done by hand: see protocol below. |
| Europe PMC | Response handling implemented against its documented API; two live checks were rate-limited | Not verified live. Crossref's live response was verified. |

## Live queries

### 1. Synonyms: "exciton migration in molecular crystals"

- Expanded to `exciton (migration OR diffusion OR transport) molecular (crystals OR crystalline)`; meaning-based search used the plain phrase.
- Keyword search: 51,125 matches. The top 20 included strong items ("Exciton Migration in Molecular Crystals", 1971; "Relationship between Crystalline Order and Exciton Diffusion Length…", 2009; a 2022 *Chem. Rev.* review; "Visualization of exciton transport in ordered and disordered molecular solids", 2014, at #20). It also included noise: a 1995 *Choice* book review, a 1993 book, a dissertation duplicate, and a halide-perovskite paper.
- Meaning-based search: all 20 on topic, but 16 of 20 were published before 2005. It found "Resolving ultrafast exciton migration in organic solids at the nanoscale" (2017, #9), which keyword search missed.
- Known item not in the top 20 of either channel: Mikhnenko, Blom & Nguyen, "Exciton diffusion in organic semiconductors" (*Energy Environ. Sci.* 2015, ~1,000 citations). A specialist would expect it.
- On these real titles, local re-ranking kept the book review, book and dissertation out of the top 10, and put papers found by both channels in the top 12 (unit tests).

Finding: for broad phrases in older fields, the sources' ranking favours classic literature. Mitigations in the app: year filter, "Adjacent & emerging" mode (weights recency), and "Get more results". A "newest first" sort would be a sensible next feature.

### 2. Acronym from profile: "TA spectroscopy of perylene diimide"

- With the test profile, TA was read as transient absorption (learned from the CV), giving `(TA OR "transient absorption") spectroscopy perylene diimide`. 1,529 matches.
- 15 of the top 20 titles mention perylene (triplet formation, symmetry-breaking charge separation, charge photogeneration in blends); the others are transient-absorption studies of related systems. Two dissertations without DOIs appeared.
- Without a profile, "TA" triggers a question (transient absorption, teaching assistant, tannic acid, thermal analysis). OpenAlex counts for "TA" alone span medicine, social sciences and humanities, which confirms the question is needed.

### 3. Interdisciplinary question: "How do ion channels drive confined cancer cell migration?"

- Keyword search (8,632 matches): #1 Stroka et al., "Water Permeation Drives Tumor Cell Migration in Confined Microenvironments" (*Cell* 2014). The rest of the top 20 were on topic: ion channels in cancer, mechanosensitive channels, confined migration, aquaporins. 13 of 20 are labelled reviews by OpenAlex.
- Meaning-based search: #1 "Cancer as a channelopathy…" (2015), #2 Schwab et al., "Role of Ion Channels and Transporters in Cell Migration" (*Physiol. Rev.* 2012), #3 Stroka et al. 2014. All 20 on topic.
- The synonym guard worked: "cell migration" was not expanded to "cell diffusion/transport" (it is for "exciton/ion migration").

### 4. Interdisciplinary: "machine learning ionic conductivity polymer electrolytes"

- Both channels returned the core papers ("Chemistry-Informed Machine Learning for Polymer Electrolyte Discovery", 2023; "Machine learning-guided discovery of ionic polymer electrolytes for lithium metal batteries", 2023).
- Keyword results also included a Zenodo dataset, a software record and an off-topic wearable-biosensor review. The app labels datasets and software as "Other" and demotes them.
- Meaning-based results were on topic, but 5 of 15 were about ionic liquids rather than polymer electrolytes.

### 5–8. Ambiguity checks (OpenAlex counts by field, grouped into domains)

| Query | Domain shares | App behaviour, no profile | With physical-science profile |
|---|---|---|---|
| coherence | Social sciences & humanities 42%, Physical sciences 39%, Health 16% | Asks | Limits to physical sciences |
| relaxation | Physical sciences 63%, Health 22%, Social 10% | Asks | Limits to physical sciences |
| singlet fission tetracene | Physical sciences 99% | No question | No question |
| TA | Social 40%, Health 28%, Physical 16%, Life 16% | Asks what TA means first | Uses TA = transient absorption |

For "singlet fission tetracene", all 15 top keyword results were on topic (e.g. *Nature* 2019 silicon sensitisation; *JACS* 2013 temperature-independent fission; *Acc. Chem. Res.* 2013). Two 1969 records share a title and year but have different DOIs; the app keeps them separate (unit-tested), since identical titles with different DOIs are usually different papers.

## Publication types against the sources

| Paper | OpenAlex type | Paperscope shows |
|---|---|---|
| Exciton diffusion in organic semiconductors (2015) | article | Review? (inferred: abstract says "are reviewed") |
| Role of Ion Channels and Transporters in Cell Migration (2012) | review | Review |
| Organic molecular crystals… (1995, *Choice*) | book-review | Book review (not counted as a literature review) |
| Universal Framework for Decomposing Ionic Transport… (2026, arXiv) | preprint | Preprint |
| CEMP Research Databases… (Zenodo) | dataset | Dataset |

OpenAlex missed the review label on a well-known review; the wording rule caught it but marked it uncertain. Wording rules will also produce some false positives. They are always marked "?" and can be hidden.

## Links

- `10.1038/ncomms4646` and `10.1016/j.cell.2014.02.052` resolve via doi.org to Nature and Elsevier.
- `10.1021/acscentsci.2c01123` redirects, but ACS refuses automated fetches. OpenAlex lists it as diamond open access, with a PDF link at pubs.acs.org.
- OpenAlex records exist for all sampled DOIs. The app links titles to `doi.org`, so links go to the publisher's current page.

## Explanations are supported by the abstract

- Explanations are generated by rules, not a language model. Each names only query or profile terms found in the title, abstract or OpenAlex keywords, and quotes one abstract sentence verbatim (cut at 45 words, marked with an ellipsis).
- Tests: a 500-abstract property test (quote is always a verbatim substring); 9/9 quotes verbatim in the browser test; every "mentions" term found in the named field; title-only explanations on real data checked against titles.
- Papers without an abstract show: "No abstract was available from the sources searched, so this is judged from the title and metadata only." All top-10 results in the real-data ranking test carried this note, because that fixture had no abstracts.

## User-interface test (headless Chrome, phone size)

43/43 checks passed. They cover: results, synonym expansion and source calls; merging across all four sources; type labels including a Europe PMC review label overriding an OpenAlex "article"; retracted papers flagged and demoted; theme map and theme filter; type, year and open-access filters and the server-side re-query; paging; saving, reloading and BibTeX export; PDF and Word CV parsing in the browser; profile editing; the profile not being stored unless asked; close and adjacent modes changing the order; the domain question with and without a profile; the acronym question; the incomplete-results warning when OpenAlex refuses (429); the Scholar comparison tool; the on-device model (started in 3.8 s; 24 papers embedded in 0.8 s; topical papers scored 0.81–0.88 versus 0.18–0.41 for off-topic ones); no uncaught errors; no unexpected network requests; and axe-core with no WCAG 2 A/AA violations.

The model test used local copies of the int8 ONNX export of all-MiniLM-L6-v2 (sha256 `afdb6f1a…48bdb1`, redistributed on npm under Apache 2.0), not a live download from Hugging Face.

## Google Scholar comparison protocol (to run by hand)

Automated access to Google Scholar is not permitted, so this has to be done in a browser:

1. Pick 10 queries from your own work: 3 specific, 3 broad, 2 ambiguous, 2 interdisciplinary.
2. For each, open Scholar (the app links to the same query) and copy the first 10 titles.
3. Paste them into **Compare with Google Scholar** under the results. Record how many Paperscope found and at what positions.
4. Tap **Check OpenAlex for the missing titles**. Each miss becomes either "In OpenAlex but not retrieved" (a ranking or recall gap) or "Not found in OpenAlex" (a coverage gap).
5. Separately, rate Paperscope's top 10 as relevant, partly relevant or not relevant to judge precision, which Scholar overlap alone does not measure.

| Query | Scholar top 10 found in Paperscope | Median position | Missed but in OpenAlex | Not in OpenAlex | Paperscope top-10 relevant |
|---|---|---|---|---|---|
| | | | | | |

Expect lower overlap for broad queries, books, theses and non-English work. Scholar's ranking weights citations heavily, and it indexes sources these databases do not.

## Step 1 additions (13 November 2026)

New: profile from ORCID, related terms from the results, citation trail (citing papers, references, similar), sorting by date or citations, followed searches with "new since last check", and optional answers written from the top abstracts with the user's own AI key.

**Tested:** 41/41 unit tests and 32/32 new browser checks (plus the original 43/43) pass. They cover the exact OpenAlex requests each feature makes, ORCID checksum validation, building a profile from publications, related-term suggestions and their effect on ranking, date and citation sorting, the citation-trail requests and "Back", followed searches and New badges, both AI providers' request formats, what the answer request contains (the question and numbered abstracts, never the profile), and flagging of uncited sentences and citations to papers that were not supplied. axe-core found no WCAG 2 A/AA violations.

**Not yet verified against the live services** (my web-fetch tool needed your approval while you were away). These follow OpenAlex's and Anthropic's documented APIs as I know them, and each shows a clear message if the service refuses:

- OpenAlex filters `cites:`, `cited_by:`, `related_to:`, `author.id:` and `from_publication_date:`, and author lookup by ORCID (`/authors/orcid:…`).
- Anthropic's browser access (the `anthropic-dangerous-direct-browser-access` header) and the model name `claude-haiku-5-5`.
- OpenAI-compatible services and local model servers, which must allow requests from web pages (CORS); many local servers need a setting for this.
- "Check for new papers" uses publication dates, so papers indexed late with an older date can be missed.
