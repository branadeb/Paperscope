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

## Author search and DOI lookup (13 November 2026)

New: a Topics / Authors switch on the search box; author search by name or ORCID iD with a profile picker that can combine split profiles; an author page with works, citations, h-index, active years, a bar chart of works by field and every work grouped by field; per-field loading and hiding; tappable author names on every result; and DOI lookup from the topic search box.

**Checked against live OpenAlex** (web fetch, 13 November 2026):

- `/authors?search=Frances Arnold` returns ranked profiles with ORCID, works count, institution and topics (cost $0.001).
- `/authors/orcid:0000-0002-4027-364X` returns the same profile (free).
- `/works?filter=author.id:…&group_by=primary_topic.field.id` returns 20 fields for her 848 works ($0.0001). The group counts summed to 847: works with no field are not listed, so Paperscope shows the difference as "Not classified".
- `/works?filter=author.id:…,primary_topic.field.id:13` returns only that field's works (452, $0.0001), and `sort=publication_year:asc&per_page=1` returns the first year ($0.0001).
- `/works/doi:10.7717/peerj.4375` returns the paper (free).

The same check showed why the field view matters: that profile lists 179 works in Earth and Planetary Sciences, which on inspection are atmospheric-chemistry papers by a different researcher with the same surname and initial. OpenAlex's author matching merged them. The author page now says this can happen and lets you hide a field.

Opening an author costs about $0.0003 in OpenAlex usage (field counts, first year, one page of up to 200 works); a name search adds $0.001. Each further page or field is $0.0001.

**Tested:** 68/68 new browser checks (plus 43/43, 32/32 and 41/41 unit tests) pass, with OpenAlex and Crossref mocked: the picker and combining profiles, exact requests, header figures, bar counts and order, grouping, "Show all" fetching the rest of a field, sorting, hiding a field, year filters, paging, co-author and byline navigation with Back, citation trail and Back, ORCID, single and no matches, DOI found, DOI only in Crossref, and unknown DOI. axe-core found no WCAG 2 A/AA violations in light or dark mode, and the page does not scroll sideways on a phone.

**Not verified live:** the Crossref fallback for a DOI that OpenAlex lacks (Crossref's documented `/works/{doi}`).

## ORCID check of author profiles (14 November 2026)

**The problem, found by a user:** OpenAlex's profile "M. Mondal" (A5084327602), which carries Monosij Mondal's ORCID iD 0000-0003-4764-0737 and a Columbia University affiliation, merges two people. Of its 13 works, 10 are atomic-collision physics by an M. Mondal at Ramakrishna Mission Residential College (raw byline "M. Mondal" or "M Mondal", co-authors Purkait, Mandal, Mistry and others). His own 2022 papers in The Journal of Chemical Physics and The Journal of Physical Chemistry Letters are in OpenAlex, but their authorship carries his ORCID with no author id, so they belonged to no profile. OpenAlex's own `author.orcid` filter returns 17 works, the wrong ones included, because the profile's iD is copied onto every work in it, so it can't be used to check the profile.

**Independent evidence, checked live:**

- His public ORCID record (`pub.orcid.org/v3.0/0000-0003-4764-0737/works`, read from the live Paperscope page in a browser, which also confirmed that ORCID allows these requests from web pages) lists 7 works: four ChemRxiv versions of the lithium-cluster preprint, the JPCL and JCP papers, and the 2016 Molecular Physics paper. None of the collision papers are on it.
- Crossref's `filter=orcid:0000-0003-4764-0737` returns 6 records with his iD attached by the publisher: the four preprint versions and the JCP and JPCL papers.
- The 2026 Nature paper (the published version of the preprint) and his 2023 thesis are in the OpenAlex profile but on neither list. The Nature byline reads "Monosij Mondal" with 18 co-authors from the preprint; the thesis byline is "Mondal, Monosij". Paperscope counts both as "likely theirs".
- OpenAlex's full-name filter `raw_author_name.search:Monosij Mondal` returned 12 works, including a 2025 ECS meeting abstract under his full name and several other Mondals (Arup, Ayan, Debabrata). Only works whose byline has his full name are considered, and only those with supporting evidence are added.

**Tested:** 9 new unit checks (49/49 in total) on a fixture with the real record's structure, and 25 new browser checks (93/93 for the author pathway) with a mocked version of this exact case. The checks confirm that the four collision papers are set aside with their reasons; the two unlinked papers, the preprint (shown once, "2 versions") and a no-DOI ORCID entry are added; the Nature paper and thesis are counted as likely; a full-name hit by another Mondal is rejected; the figures and field bars count only checked papers; and the set-aside papers can be shown again. Requests are checked too: the ORCID record is read as JSON, publisher iDs come from Crossref, and missing papers are fetched by DOI. A profile with an empty ORCID record shows no badges and sets nothing aside. axe-core found no WCAG 2 A/AA violations in light or dark mode.

**Cost:** about $0.0012 more in OpenAlex usage per author with an ORCID iD (one DOI lookup, one full-name search). ORCID and Crossref are free; ORCID's anonymous API allows 25,000 reads a day per IP address.

## Installable app (14 November 2026)

Paperscope is now a progressive web app: a manifest, icons (192 and 512 px, a maskable icon and a 180 px Apple touch icon) and a service worker. The service worker stores only the app itself (one page, its manifest and icons) in a cache named after the build, so each release replaces the last. Page loads try the network first, so updates arrive on the next launch. Requests to OpenAlex, Crossref, Europe PMC, ORCID, jsDelivr or AI services pass straight through and are never stored.

**Tested** (`test/pwa.test.cjs`, 26/26, headless Chrome, served like GitHub Pages):

- Chrome parses the manifest with no errors and reports the app installable (no installability errors).
- The icons load at their declared sizes, and the iOS home-screen tags are present.
- The service worker takes control and caches only the app's own files.
- The app opens with the network off, and an offline search explains what still works.
- The Install button calls the browser's own install dialog, and "Not now" is remembered.
- iPhone users get Add to Home Screen instructions plus a note that the Home Screen app's storage is separate from Safari's.
- An installed app says so, and the "Search by author" shortcut opens the Authors pathway.
- axe-core found no WCAG 2 A/AA violations.
- The other suites (43, 32 and 93 checks) still pass with the service worker active.

**Not tested on real devices** in this session: installation on an actual iPhone, Android phone or Mac. The behaviour above follows each platform's documented install flow.

## Phone layout review (14 November 2026)

Every screen was screenshotted at 320×640, 375×812 and 430×932 in light and dark mode, 44 shots per size, with `test/mobile-shots.cjs`. No screen scrolls sideways at any size and no page errors occurred. Fixes made after the review:

- Text fields are 16 px on touch screens, so iPhone Safari no longer zooms in when a field is tapped (the sort menu, the term and ORCID fields and the comparison box were smaller).
- The theme map uses a tighter layout on phones, with numbered bubbles that match a numbered list; the text labels became unreadable when scaled down.
- The About tables stack into readable cards on narrow screens.
- Saved papers look like results, with a quiet Remove button.
- ORCID iDs no longer break across lines, and shorter placeholders fit small screens.
- Link-style actions have taller tap targets.
- The smallest phones get a narrower Search button and less hero decoration behind the headline.
- An author search with no match offers to search topics instead.
- A shareable link, `#install`, opens the install steps.

All suites pass after the changes: 43, 32, 93 and 27 browser checks and 49 unit tests.

## Free OpenAlex key from inside the app (14 November 2026)

OpenAlex offers an endpoint for requesting a free key on a user's behalf: `POST https://api.openalex.org/api-keys` with `{"email": ...}`. It returns the key, emails an activation link, and the key works once the link is clicked (`403 key_not_activated` until then). These were checked live from the Paperscope page in a browser:

- The endpoint accepts requests from the page (a malformed address got a readable `400` with OpenAlex's message).
- `GET /api-keys` returns the instructions.
- `X-RateLimit-Limit`, `-Remaining` and `-Reset` are readable from JavaScript. The keyless limit read `1000` credits, which is $0.10 at $0.0001 a credit.

Paperscope now has an email field under About › Settings (link: `#key`). It also shows how much of the day's allowance is left, under the results and in Settings. When OpenAlex refuses, a "Get a free key now" link appears in the warning.

**Tested** (`test/key.test.cjs`, 26/26, OpenAlex mocked):

- Allowance shown with and without a key.
- A typo is caught before anything is sent.
- The placeholder address, existing account, pending activation and too-many-keys cases each get the right message.
- The request carries only the email and the app's name, with an idempotency key.
- A pending key is not used. It activates when the user returns to the app, or on reopening it.
- The email is not kept after activation.
- Searches then send the key.
- Keys can be removed or pasted.
- The out-of-allowance warning gives the local reset time and a link to a key.
- No WCAG 2 A/AA violations.

**Not tested live:** an actual key request with a real address and its activation. That needs a real person's email and inbox.

## Paperscope Lab: swipe to sort and your sky (14 November 2026)

The Lab at `/lab/` is a copy of the main app with its own storage, cache and service worker. The main app's service worker now ignores pages other than its own, so visiting the Lab can never replace the main app's offline copy (tested).

**Tested** (`test/lab.test.cjs`, 41/41, and `test/lab-core.test.cjs`, 6/6, APIs mocked, phone viewport):

- *Isolation:* the Lab starts empty. "Bring over" copies the main app's saved papers without changing them. After using the Lab, the main app still has its own papers, no Lab features, and its own offline copy.
- *Swipe to sort:*
  - The deck skips papers already saved, and focus starts on Keep.
  - The keys → ↑ ← and z (undo) work, and so do drags right, left and up; a short drag snaps back and does nothing.
  - The buttons work, the end screen gives totals, and Escape closes the deck.
  - It works with reduced motion. The list just sorted keeps its order, and the next search leans towards kept papers, marked "Like papers you kept while swiping".
- *Your sky:*
  - One star per saved paper and a faint one per read-later paper, with new stars marked.
  - Constellations are labelled by field. Layouts are identical whatever order the papers come in, and stars always stay inside the frame.
  - Tapping or pressing Enter on a star shows its paper, "Keep it" turns a faint star bright, and the PNG export works.
- *Taste:* Profile lists the learned words, and they can be forgotten.
- axe-core found no WCAG 2 A/AA violations on the deck or the sky, in light or dark.
- All main-app suites still pass: 43, 32, 93, 26 and 27 browser checks, and 49 unit tests.

## Lab: trail quests (14 November 2026)

**Tested** with a small mocked citation graph (`test/lab-quest.test.cjs`, 29/29, phone viewport). The quest starts from a result card and requests that paper's references. The suggestion goes to the older, well-cited paper with shared words, never to the unrelated one, and gives its reason; each card shows how many years earlier it is.

The checks also cover:
- Stepping back, undo, and the message when OpenAlex has no references.
- The finished trail: totals, how each step connects, and the replay one step at a time.
- Saving the trail on the device, and the share link, which carries OpenAlex ids only and no personal data.
- The forward quest from the first paper, leaving the quest back to the search, and replaying saved trails.
- Opening a shared link in a fresh browser: same order, not saved to that person's trails, and "follow it further" continues from the last paper.
- A broken link, reduced motion, and no WCAG 2 A/AA violations in light or dark.

**Not yet judged with real users:** whether the suggested step usually matches what a researcher would pick. Each step offers two suggestions. The closest match is scored 55% on title words shared with the trail, 30% on citations and 15% on years travelled. The big leap must be at least 8 years away and share a word with the trail; it is scored 55% on citations and 45% on years travelled. A first live check, starting from Mikhnenko et al. (2015) with only the closest-match score, moved back just one year per step (2010, 2009, 2008) through near-identical titles. That is why the big leap was added (30/30 checks after the change).

## Lab: papers of the day (14 November 2026)

**Checked live from the app in a browser:**
- Crossref member ids: 316 ACS, 311 Wiley, 297 Springer Nature, 221 AAAS, 292 RSC, 317 AIP Publishing, 16 APS, 78 Elsevier; Nature Portfolio journals use DOI prefix 10.1038.
- A request filtered by publisher and `from-created-date` (two days back) with topic words returned papers registered that day or the day before (Nano Letters, J. Phys. Chem. C, Small, ACS Nano and others), and ACS records included abstracts.
- Crossref journal names can contain HTML entities ("Environmental Science &amp; Technology"). Both apps now clean them.
- One query made of all eight topics (exciton diffusion, transient absorption, perylene diimide, organic semiconductor crystals, singlet fission, two-dimensional electronic spectroscopy, charge transfer, ion transport; 20 words) returned 0 results for Nature and Science, even though Nature Portfolio had 987 new articles in those two days. Short queries did return results (e.g. 12 for "charge transfer"). Long queries seem to require most of their words in one paper. The topics now go in groups of at most 8 words. Live, with the same topics: 3 requests per publisher, 12 in all, 11 seconds, no errors; 253 new papers considered (ACS 97, Wiley 100, Nature 62, Science 4) and 28 shown. The top paper was a singlet-fission paper in J. Phys. Chem. C; the best Nature match was a Nature Communications paper on Li⁺ transport.
- Parallel requests failed ("Failed to fetch"), because Crossref's public service allows one request at a time. Requests now go one after another, retried twice.
- Wiley lists cover and frontispiece pages as articles (titles ending "(Adv. Mater. 63/2026)"), and Springer Nature has "Author Correction" entries. Both are now left out.
- Topics that many papers share ("charge transfer") now count for less than rare ones. A paper has to score at least 0.15 to be listed, and the same title under two DOIs appears once.
- **Reported by the user: "ultrafast spectroscopy" found nothing.** Live, that topic alone gave 24 candidates and 0 papers shown. There were two causes. First, the discount for common topics also hit a lone topic, which pushed every paper below the 0.15 cut-off. Second, Crossref searches titles only, and titles rarely say "ultrafast spectroscopy". It also counted papers whose abstract merely contained both words anywhere, such as "ultrafast hydrogen spillover … Raman spectroscopy".
  - A topic is now discounted only relative to the most specific one, so a lone topic is not discounted.
  - Each topic also counts a few related phrasings from a small curated list, plus synonyms, and the panel lists them. For ultrafast spectroscopy these are transient absorption, pump-probe, 2DES, 2D IR, excited-state dynamics, time-domain spectroscopy and others.
  - Words of a phrase must sit within a few words of each other.
  - Crossref gets each word once, in groups of at most 7.
  - A first version also counted single words ("time-resolved", "femtosecond"). That brought in time-resolved FRET sensing and femtosecond laser machining, so only spectroscopy phrases are kept.
  - Live after the fix: 3 requests per publisher, 12 seconds, no errors, 266 candidates and 14 shown. The top papers were the transient-absorption papers on plasmonic Cu (J. Phys. Chem. C) and on MoS₂ dark excitons (Nano Letters), THz time-domain carrier dynamics (Laser Photonics Rev.), and coherent-oscillation conical intersections (ChemPhysChem).
  - Borderline papers remained: time-resolved SERS of blood, and time-domain NIR spectroscopy of muscle. Nature and Science had nothing for this topic in those two days.
  - A list saved by the previous version is fetched again when the app is next opened.

**Tested** (`test/lab-today.test.cjs`, 29/29, Crossref mocked; plus 5 unit checks in `test/lab-core.test.cjs`):
- Setup asks for topics; the default publishers are the four requested.
- Requests per publisher (one per group of topics), journal articles only, from the last check.
- Matching papers come best first; corrections and unrelated papers are left out. Each paper names the topics it mentions, and says when there is no abstract.
- Same-day reopening uses the saved list, and *Check again* searches again. The next day it searches from the last check and does not repeat papers.
- Saving works, and swiping works with saved papers skipped. Adding AIP searches AIP too; a failing publisher is reported while the rest still show.
- Many topics are sent in short groups to every publisher, and a paper found by two groups is listed once. Corrections and cover pages are left out.
- Profile terms are used when no topics are typed, and the Lab note can be dismissed.
- No WCAG 2 A/AA violations in light or dark. All other suites still pass.

## Lab: ranking v2 and graded searches (14 November 2026)

A review of the search algorithm, which the user shared, pointed out that every idea in a query counted the same, that a strong title match on a common word could make up for a missing material or mechanism, and that "migration" was treated as a synonym of "diffusion" even for ions. Ranking v2 (described in README) addresses these points. It is not yet shown to be better: that needs the user's grades, and the grading screen was built for this.

**Tested** (`test/lab-core.test.cjs`, 17/17; `test/lab-bench.test.cjs`, 20/20 in the browser with mocked databases):
- Chemical notation tokens: SCN⁻, Fe²⁺, MoS₂, Li+.
- Synonym levels: exciton migration = diffusion; ion migration is only related.
- A paper missing a specific idea ranks below one with all of them, with a stated reason, and is penalised less in *Adjacent & emerging*.
- Rare ideas weigh more than ones every candidate shares, and words together beat words far apart.
- v1 stays available.
- nDCG, precision and judged share are computed correctly.
- The grading list mixes three rankings, and grades are stored with the candidates. A second tap clears a grade.
- The Profile panel compares rankings, and export/import round-trips.
- Deleting needs two taps, and the ranking setting is remembered.
- No WCAG 2 A/AA violations.

**On saved live data** for "exciton migration in molecular crystals" (36 papers), v2 kept "Exciton Migration in Molecular Crystals" first. It moved down papers that lack an idea, such as "Exciton migration dynamics in a dendritic molecular aggregate" (no crystals). It also moved down "Excitonic processes in molecular crystalline materials", from 9th to 12th, because the light stemmer does not equate "excitonic" with "exciton". The main app's unit test that expects every paper found by both OpenAlex searches in the top 12 fails for v2 on that one paper; that test applies to the main app, which still uses v1.

## Lab: papers of the day, version 3 (14 November 2026)

**Checked live from a browser:**
- OpenAlex publisher ids: ACS P4310320006, Wiley P4310320595, Nature Portfolio P4310319908, AAAS P4310315823, RSC P4310320556, AIP P4310320061, APS P4310320261, Elsevier P4310320990, Springer Nature P4310319965.
- `primary_location.source.host_organization_lineage` with `from_publication_date` works for keyword search. One OR query over the topic phrases for the four default publishers cost $0.001 and matched 169 articles from the last 5 days.
- OpenAlex meaning-based search rejects publisher and date filters; it supports publication year and type only. With `publication_year:2026`, only 2 of its top 50 were from the last 5 days, so it is not used for papers of the day.
- Semantic Scholar's recommendations API answers requests from web pages (CORS). Its pool of recent papers spanned about two months; 4 of 100 suggestions were from the last 5 days.
- The topic "ultrafast spectroscopy" alone gave 392 candidates in 13 requests and 14 seconds. 12 papers were shown, including transient-absorption papers in J. Phys. Chem. C, Nano Letters and J. Phys. Chem. A, and a coherent-oscillation paper in ChemPhysChem.
- The user's eight topics gave 499 candidates in 17 requests and 23 seconds: 435 from Crossref, 100 from OpenAlex, 64 of which only OpenAlex found. 15 were shown, all labelled *Your topic*, from ACS 11, Nature 2, Science 1 and Wiley 1.
  - The top papers were multiexciton dynamics in porphyrin nanorings (JPCL), excited-state charge transfer in a perylene derivative (JPCC), and intermolecular singlet fission in a peropyrene (JPCC).
  - A weak pick remained: a graphene anode paper matched through "ion diffusion", a related synonym of "ion transport".
- A first version labelled papers matched only through related wording as *Nearby*. For an umbrella topic that was wrong: a transient-absorption paper is on topic for "ultrafast spectroscopy". *Nearby* is now reserved for suggestions that share no topic word.

**Tested** (`test/lab-today.test.cjs`, 41/41, all sources mocked):
- The OpenAlex request uses the chosen publishers' ids, the 5-day window and the quoted topic phrases.
- Papers found through abstracts are listed.
- Papers from other publishers, and old papers with new DOI records, are left out, and the count says so.
- Near-identical titles appear once, and the labels and sources are shown.
- Semantic Scholar is called only when turned on and receives only DOIs. Its suggestions older than the window are dropped, and recent ones show as *Nearby* with the reason.
- The privacy table lists Semantic Scholar.
- No WCAG 2 A/AA violations. The earlier checks (caching, no repeats, failing publisher, profile terms) still pass.

## Lab: models, orbit and AI check (14 November 2026)

**Tested with mocked services:**
- `test/lab-bench.test.cjs`, 28/28:
  - The on-device model can be measured on graded searches. The test uses a stand-in model, because the real one cannot be downloaded in the test sandbox.
  - OpenAlex's reranker is measured with one reranked request per graded search, kept and not asked again.
  - The reranker setting adds `rerank=true` to the keyword search.
  - The model choice offers MiniLM and bge-small.
- `test/lab-orbit.test.cjs`, 25/25 (and 3 unit checks in `test/lab-core.test.cjs`, 20/20):
  - The orbit phrases appear in Saved.
  - "Find more like my saved papers" makes, for each of 3 starting papers, one meaning-based search with its abstract, one related-works request, one newer-citing request and one references request.
  - Saved papers are left out of the results. The header names what the starting papers have in common, and each paper names its connection.
  - Keep going is enabled only after saving, and round 2 starts from 4 papers with no repeats. Back and More like this on a single paper work.
  - The lean is at most 0.06, stated, and can be turned off.
  - The AI check sends only the search, titles and abstracts. Its summary names the model and tokens, and ordering by the check puts the top-rated paper first with its reason. The usual order can be restored, and on a graded search the check's order is kept and compared in Graded searches.
  - No WCAG 2 A/AA violations.

**Checked live:** "More like this" on Mikhnenko et al., "Exciton diffusion in organic semiconductors" (W1930734459), made 4 OpenAlex requests in 2 seconds for $0.0013. They returned 50 similar abstracts, 10 related works, 1,029 citing papers (newest 25 fetched) and 281 references (most cited 25), 75 candidates in all.
- The top 12 were all exciton-diffusion papers in organic semiconductors, from 2006–2024. The first was "Exciton Diffusion Measurements in Poly(3-hexylthiophene)" (2008), found by three routes.
- The orbit of that one paper first included "basic physics" and "reviewed" from its 90-character abstract. For one paper, only its title phrases and phrases its abstract repeats now count (unit-tested).

**Not yet checked live:**
- That bge-small-en-v1.5 downloads and runs in the browser. MiniLM has run before in this app.
- How the AI check grades real searches, which needs the user's key.
- Whether the orbit and the models improve rankings. That needs the user's grades.

## Navigation and smoothness on phones (14 November 2026)

The user reported that the app "is not smooth" on his phone and that the back button should work like a normal app.

**Measured** on an emulated phone (390×844, touch, processor slowed 4× with Chrome's CPU throttling, mocked databases):
- First paint: 0.4 s. A search took 0.5 s to show results, with one 167 ms rendering task.
- Scrolling: 122 frames in 2 s, none slower than 34 ms. Saving a paper gave feedback in 24 ms.
- So rendering was not the problem. Navigation was:
  - Switching to Saved and back reset the results from 2,808 px to the top.
  - The back button was not handled inside the app.
  - Papers of the day shrank to a one-line message while checking and then grew back, moving the page.

**Fixed:**
- App-like history: panels, results, trails, "More like this", author and DOI pages, tabs and links into sections.
- Scroll memory per place, and a header back arrow.
- No tap flash or double-tap zoom on controls.
- While papers of the day checks, the last list stays with a progress line; the first time, placeholders hold the space.

**Tested** (`test/nav.test.cjs`: 23/23 in the Lab, 21/21 in the main app):
- Back from results goes to the start screen and stays in the app; forward brings the results back.
- Tabs open at their own scroll position. Back from a tab returns to the results at the same place (within 40 px of 1,500 px). Tapping Search does the same, and back from there goes to the start screen without walking through every tab visited.
- Back closes Filters and the swipe cards. Cancel leaves no stray step.
- Back from a paper's references returns to the results at the same place.
- The header arrow and the logo work.
- A link to a section can be undone with back. A reload opens normally.
- All other suites still pass: Lab 41, 41, 30, 28, 25 and 20 checks; main app 49, 43, 32, 93, 26 and 27.
