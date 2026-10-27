# Backfill missing IDX ownership months

Prepared for review and later execution. No ingestion job, R2 upload, deployment, or monitor was started while preparing this change.

## Why the fetcher changed

IDX ownership history spans two sections:

- [Keterbukaan Informasi](https://idx.co.id/id/perusahaan-tercatat/keterbukaan-informasi) exposes market-wide ownership announcements and their attachments through `ListedCompany/GetAnnouncement`.
- [Data Kepemilikan Saham](https://idx.co.id/id/perusahaan-tercatat/data-kepemilikan-saham/) exposes the newer XLSX ownership list.

The previous fetcher consumed only the XLSX list. Its archived 2026 response starts daily 5% files on 29 May. An explicit earlier `--since` could not recover the old PDFs. Normal daily ingestion also resumes from the latest stored date, so it does not repair earlier gaps.

This is also a format change. The legacy title `Pemegang Saham di atas 5% (KSEI)` leads to a cover PDF and a table PDF. The table has merged investor cells and can carry an investor across pages. Plain extracted text mixes table columns and includes text hidden by PDF clipping regions. The reader reconstructs the table from its borders and visible glyphs, then uses the existing 5% row parser.

Publication dates differ from snapshot dates. The announcement published on 30 January contains the **29 January** snapshot; the one published on 8 June contains the **5 June** snapshot. Backfill inputs therefore select snapshot dates. Discovery includes the following publication month, capped at today. A later publication outside that lookahead remains a source gap to investigate.

## What the manual workflow does

`.github/workflows/ownership-backfill.yml` accepts `since` and `until` within one calendar month. It calls `ingest --ownership-only`, restores the existing IDX ledger and ownership raw archive, and reads both ownership sections. It does not collect broker data, prices, registry reports, or general announcements.

XLSX files are considered before legacy PDFs. A snapshot already in the restored ledger is preserved; this is a missing-date backfill, not an automatic rewrite of existing snapshots. Duplicate source URLs and snapshot dates do not append duplicate holdings. Covers and ticker-specific filings are excluded. Unsupported or ambiguous attachments fail the run.

The 1% XLSX parser works for either listing route, including a primary XLSX attachment. **Legacy 1% PDFs are not parsed.** The XLSX list republishes the same month-end snapshots, so the run skips each legacy 1% PDF and lists it in `skipped_one_pct_pdfs`. January 1% source availability remains unresolved. An empty result must not be converted into invented holdings or called complete.

The workflow archives only ownership raw prefixes and uploads only `five_pct`, `one_pct`, and `ownership_files` Parquet partitions. It regenerates public JSON from the restored IDX ledger. The workflow has no schedule and uses the existing `idx-batch-ingest` concurrency group.

## Missing ownership windows

Evidence below was read from production Parquet on 27 October 2026. Refresh it before execution. Day counts use the stored price calendar, not an independent audit of the exchange calendar.

| Snapshot window | 5% coverage before this change              | 1% coverage                           | Later action                                                      |
| --------------- | ------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------- |
| 1–31 January    | 0 of 20 price dates                         | No stored snapshot; source unresolved | Pilot the old PDF path and investigate January 1% availability    |
| 1–28 February   | 0 of 18 price dates                         | 27 February stored                    | Fill 5%; preserve the existing 1% snapshot                        |
| 1–31 March      | 0 of 17 price dates                         | 31 March stored                       | Fill 5%                                                           |
| 1–30 April      | 0 of 21 price dates                         | 30 April stored                       | Fill 5%                                                           |
| 1–31 May        | 29 May only, 1 of 16 price dates            | 29 May stored                         | Fill earlier 5% dates and check the section overlap               |
| 26 October only | Missing; last stored 5% date was 23 October | October has not closed                | Recheck source publication first; this may be a publication delay |

June through September 5% dates already matched the stored price dates. Do not replay those months as missing-data jobs without new evidence.

## Execution handoff for Opus

Review the branch and CI, then merge only when ready to execute. A new Actions workflow must exist on the default branch before GitHub accepts its manual dispatch. The commands below are instructions for later use; they were not executed during preparation.

Start with January:

```sh
gh workflow run ownership-backfill.yml --ref master \
  -f since=2026-01-01 -f until=2026-01-31
```

Record the returned run ID, requested snapshot window, head SHA, final JSON summary, and all archive/upload/publish step results. Validate the pilot before dispatching February, March, April, and May. Use the same command with each row's dates.

The final JSON and Actions step summary expose `five_pct_dates`, `one_pct_dates`, `price_dates_checked`, and `missing_five_pct_price_dates`. The top-level `remaining=0` means enumeration finished; it is **not** evidence that all expected dates or source files exist. An empty price baseline also cannot establish completeness.

Require successful ingestion, archive, Parquet upload, and public JSON publication. Compare the actual 5% dates with the restored price dates and inspect every remaining gap against both IDX sections. Inspect representative holders, account rows, combined totals, previous snapshot dates, and source URLs. Source totals and account sums are separate fields; do not replace one with the other to force agreement. Replay a validated window to check that row counts stay unchanged and cached attachments are reused.

For January 1%, inspect both sections and record the source response. If no supported file is found, report an unresolved source gap. Do not infer that a file never existed from one empty keyword search.

## Parallel work and publishing

Opus may research source URLs and inspect fixtures for separate months in parallel. Use separate worktrees and local data/output directories for those tasks. They must not upload to shared R2 keys. Keep the existing IDX request pacing; do not turn those tasks into unbounded fetch loops.

All restored-ledger IDX writers must run through `idx-batch-ingest`. Two month jobs restore and rewrite the same annual Parquet files, source ledger, and public ticker JSON. Parallel uploads can erase the other month's changes even when the date windows differ. Jobs may be submitted to the shared queue; they must not write concurrently. Do not add a parallel publishing matrix or bypass the concurrency group.

## Other IDX gaps remain separate

| Dataset               | Observed gap                                                                  | Required path                                                                                  |
| --------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Registry              | January partial; February 4 issuers; March 60 issuers                         | Discover publication windows February, March, and April with the existing registry workflow    |
| General announcements | March–April absent; early January–June archives include registry-only subsets | Prepare a bounded general-announcement backfill; the ownership job does not fill it            |
| Insider reports       | Parsed history starts in late July                                            | Assess the general-announcement source coverage before claiming older insider history complete |

Registry publication-February run `40192567241` failed after a partial checkpoint. Inspect that failure and the current parser before retrying it. Do not treat this ownership fix as a repair for that failure. Parser version 3 global registry replay already finished; do not repeat the global replay to discover absent publications.

For registry discovery after that review, the existing command shape is:

```sh
gh workflow run ingest.yml --ref master \
  -f registry_since=2026-02-01 -f registry_until=2026-02-28 \
  -f registry_limit=1500
```

Use publication March and April next, with the same queue and validation gates. Registry snapshot dates are the preceding reporting month. Keep absent investor categories and unlabeled SID counts absent.

The paused monitoring task stays disabled. Do not change broker collection, its rate state, or its markers as part of this IDX work.

## Fixture provenance

- January announcement metadata: `ownership-legacy-2026-01.json`, from the IDX announcement API, 30 January 2026.
- January table: [official PDF attachment](https://www.idx.id/StaticData/NewsAndAnnouncement/ANNOUNCEMENTSTOCK/From_EREP/202601/886b0c0f99_48b702090a.pdf), stored as `fixtures/ownership-5pct-2026-01-29.pdf`.
- June table: existing `samples/idx-5pct/20260608_Semua Emiten Saham_Pengumuman Bursa_32098373_lamp1.pdf`, linked by the existing announcement response fixture.
- Overlapping June XLSX: [official 5 June file](https://www.idx.id/Media/dqvnijtx/peng-2026-06-05-00005-lima-persen.xlsx), stored as `fixtures/ownership-5pct-2026-06-05.xlsx`.
- The 1% legacy-route test uses the existing real February XLSX with constructed announcement metadata. It tests routing and date handling, not the existence of an old January file.

The failing-before ingestion regression reported `expected 0 to be greater than 0`: the legacy announcement produced no ownership rows. Local checks cover both real PDF layouts, merged cells across pages, clipping, publication lag, XLSX precedence, primary 1% attachments, ticker-filing exclusion, bounds, and replay behavior.

## Legacy PDF corpus audit, 27 October 2026

All 78 attachments published from January through June parsed: **78 OK / 0 FAIL**. No attachment required OCR. Rows come from both share columns, including rows with zero holdings; missing or unsupported tickers throw. Headerless continuation pages retain the established snapshot dates. A table without established dates throws.

The regressions use lossless page extracts. Their decompressed content streams match the original pages. Dates below are publication dates; fixture names use `ownership-5pct-legacy-<date>.pdf`.

| Publication | Original pages |   Bytes | Regression                                                 |
| ----------- | -------------- | ------: | ---------------------------------------------------------- |
| 2026-01-09  | 2–3            | 117,387 | Headerless continuation left the table incomplete          |
| 2026-01-12  | 33–34          | 225,114 | Investor name split across pages conflicted in field 4     |
| 2026-03-09  | 9–12           | 198,595 | Watermark text conflicted in unused sequence field 0       |
| 2026-04-23  | 39             | 219,676 | Short final page had no borders over 50 points tall        |
| 2026-05-20  | 6–8            | 255,697 | Baseline on the page boundary lost investor fields         |
| 2026-05-29  | 2–4            | 317,005 | Status/reason columns; issuer and custodian columns absent |

Added PDF bytes: **1,333,474**. The 29 May layout retains empty issuer/custodian fields; it does not infer them from another snapshot. Its account rows remain present.

The 5 June overlap has the same **829 tickers**. The PDF has **1,876 investor groups / 3,072 accounts**; the XLSX has **1,875 / 3,070**. Exact-key comparison finds 73 differing holding keys and 163 differing account keys. These comprise 36 investor-label substitutions, four account-label formatting differences, 19 account keys with numeric discrepancies, and one extra PDF investor alias with two accounts. All 36 renamed holdings retain the same combined shares. The 71 changed account-name keys pair with the same ticker, custodian, and share values.

Source examples:

- PDF page 2 names AISA's investor `PT. PANGAN SEJAHTERA INVESTAMA`; the XLSX names it `PT PANGAN SEJAHTERA INVESTAMA`.
- PDF page 4 prints BEEF / DIMAS WIBOWO / PT. STOCKBIT SEKURITAS DIGITAL as `134,322` in both share columns. XLSX cells **L366 and O366 contain the numeric value `134.322`**. The 19 numeric differences follow this thousandfold pattern. Decimal-comma PDF values such as ABMM's `441,4` parse as `441.4` and match the XLSX.
- PDF page 14 repeats NOBU's 728,000,000-share holding under `MATAHARI DEPARTMENT STORE TBK, PT` and `PT MATAHARI DEPATMENT STORE TBK`. The XLSX retains only the latter. The extra PDF alias has 655,500,000 shares at PT CIPTADANA SEKURITAS ASIA and 72,500,000 at PT OCBC SEKURITAS INDONESIA.

Continuity compared **165,975 common account keys across 59 date-linked snapshot pairs** from all 78 PDFs. It sums shares per exact ticker, investor, custodian, and account key, using decimal arithmetic to avoid floating-point sum differences. Six source discrepancies remain. In every row below, B's previous-share cell prints `-` (zero), despite A's current-share cell printing the stated holding. Page numbers refer to the original PDFs; dates are publication dates.

| Ticker | Custodian                    | Investor/account                                    | A publication, page, current shares | B publication, page, previous shares |
| ------ | ---------------------------- | --------------------------------------------------- | ----------------------------------- | ------------------------------------ |
| BINA   | BANK CENTRAL ASIA Tbk, PT    | PT INDOLIFE PENSIONTAMA                             | 2026-01-21 p6: 1,339,483,685        | 2026-01-22 p5: `-`                   |
| JECC   | BANK CENTRAL ASIA Tbk, PT    | PT INDOLIFE PENSIONTAMA                             | 2026-01-21 p19: 132,891,500         | 2026-01-22 p16: `-`                  |
| NIPS   | BANK CENTRAL ASIA Tbk, PT    | PT INDOLIFE PENSIONTAMA                             | 2026-01-21 p26: 124,057,589         | 2026-01-22 p22: `-`                  |
| GDWU   | PT INA SEKURITAS INDONESIA   | PT. INDOLIFE PENSIONTAMA / PT. Indolife Pensiontama | 2026-01-22 p13: 14,263,940          | 2026-01-23 p13: `-`                  |
| TNCA   | PT Yakin Bertumbuh Sekuritas | PT. Asuransi Intra Asia                             | 2026-04-15 p18: 21,082,000          | 2026-04-16 p34: `-`                  |
| NELY   | PT LOTUS ANDALAN SEKURITAS   | HASKOJAYA ABADI,PT                                  | 2026-05-21 p13: 1,970,091,600       | 2026-05-22 p13: `-`                  |

Local validation: 52 pipeline tests passed; `pnpm exec vp check apps/pipeline apps/web .github/workflows` passed. No data workflow was dispatched.
