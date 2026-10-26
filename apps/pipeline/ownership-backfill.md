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

The 1% XLSX parser works for either listing route, including a primary XLSX attachment. **Legacy 1% PDFs are not supported without source evidence and a regression fixture.** January 1% source availability remains unresolved. An empty result must not be converted into invented holdings or called complete.

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

Local validation: 44 pipeline tests and 30 web tests passed; the web build, `vp check`, and manual-workflow YAML checks passed. No data workflow was dispatched.
