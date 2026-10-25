# Monthly registry

`registry`, `registry_investors`, and `registry_holders` use annual Parquet partitions under `parquet/<table>/<year>.parquet`. The snapshot key is `(date, ticker)`, with `date` at month end. A later disclosure publication wins; ID breaks a publication-time tie. Old report-per-file partitions load by column name and collapse to the latest revision per month. `disclosures.registry_parser_version` records completed parsing, including gaps.

The eight committed `*-2026-0[56]-main.pdf` fixtures come from the public IDX URLs in `docs/prototypes/workspace/research/registry-source.json`. Each contains the free float table, SID table, KSEI scripless classification table, and relationship columns. The lampiran PDFs contain other register presentations; none is needed to reproduce the answer keys. The parser reads the Indonesian tables, checks labels and cell positions, and stops before the English duplicate. Unsupported cells produce nulls and `report_gaps`. A printed dash in an investor category stays null. A blank controller or affiliate cell stays null. Names remain as printed; badges match exact names after case and punctuation normalization. No nominee or legal-entity aliases are inferred.

`SINI-2026-01-main.pdf` covers the older form's January 2026 report, [published on February 9](https://www.idx.id/StaticData/NewsAndAnnouncement/ANNOUNCEMENTSTOCK/From_EREP/202602/cdd6d3632b_f799d7ea51.pdf). Parser version 3 accepts its `yang berakhir pada` reporting date and stops holder rows before the public, treasury, and total rows. The existing table parser reads its free float and total shares. This January report labels its count `Jumlah Pemegang Saham`, without identifying SID, so `sid_count` stays null. Reports with the explicit `Nasabah Pemilik SID` label use the existing SID parser. The January report has no KSEI investor-category table; `investor_types` stays empty. Both absent fields remain in `report_gaps`.

The public ticker JSON publishes `registry_history`, ordered oldest first, in place of the old latest-only `registry` object. Each snapshot has `date`, `url`, nullable `sid_count`, `free_float_pct`, `free_float_shares`, `total_shares`, plus `investor_types` (`label`, nullable `shares`, source `page`) and `holders` (`investor`, `pct`, nullable `controller`, nullable `controller_affiliate`, source `page`). Holder rows include directors and commissioners as well as holders of at least 5%. Missing months have no storage row. The web charts insert null points for absent months and break the line there.

## Backfill from January 2026

Dates below select **publication dates**, not reporting months. Include January publications through the rollout date so January reports filed in February and later corrections are included. Run one calendar publication month at a time, starting with January 2026. Use a restored ledger and raw archive; never start a hosted batch with an empty data directory.

```sh
pnpm --filter @vibe-idx/pipeline ingest -- \
  --data /tmp/idx-data --out /tmp/idx-public \
  --registry-only --since 2026-01-01 --until 2026-01-31 --limit 100
```

Repeat the same command until the returned `remaining` is zero. Then use February 1–28, March 1–31, and subsequent calendar windows through the rollout date. Inspect `report_gaps` after each window; an unsupported issuer/month stays missing or null. This covers every ticker returned by IDX without a per-ticker query. It cannot manufacture reports that IDX has not published.

Registry mode spaces request starts at least 1,000 ms apart: **at most one IDX request per second**, serial, without retries. It skips market, issuer, daily ownership, and broker downloads. It filters announcement discovery by the registry title. With `A` announcement rows in a window and `P` main report PDFs absent from the archive, the cold cost is `max(1, ceil(A / 100)) + P` IDX requests, assuming full 100-row pages except the last. Resume uses cached pages and PDFs, so costs only the PDFs still absent. A completed unchanged window costs **zero**. The eight research snapshots cost nine requests from cold storage with a single discovery page; the integration test preloads the eight PDFs and measures **one** request across three bounded batches. No lampiran downloads are required for this supported layout.

Pages are frozen at `raw/registry-pages/<since>-<until>/<page>.json`. Use closed historical windows. To discover a late filing or correction, run the normal daily ingest (live discovery), or use a fresh overlapping date window. Do not reuse a frozen window to ask whether new reports arrived.

## Reparse the archive

After changing the parser, increment `registryParserVersion` in `registry.ts`. The next daily ingest reparses matching reports in its lookback. To reach older disclosures:

```sh
pnpm --filter @vibe-idx/pipeline ingest -- \
  --data /tmp/idx-data --out /tmp/idx-public \
  --registry-only --reparse-registry \
  --since 2026-01-01 --until 2026-10-24 --limit 100
```

Repeat until `remaining: 0`. This reads stored disclosure metadata without announcement discovery and reparses records with an older or absent parser version. With all `raw/reports/<url-sha256>.pdf` files present, it makes **zero IDX requests**. If a main PDF is absent, it fetches and archives that PDF at the same one-request-per-second rate. Replay does not discover reports absent from the disclosure ledger; run discovery backfill for those first. Completed disclosures checkpoint even if a later report download fails. Files save through `.tmp` and rename, as in normal ingestion.

## Hosted runs (operator rollout)

The existing `ingest.yml` has manual inputs `registry_since`, `registry_until`, `registry_limit` (default 100), and `registry_reparse`. A nonblank `registry_since` selects registry mode. Set a closed month, run, read `processed`, `remaining`, `requests`, and `report_gaps`, then repeat that month until done. Use `registry_reparse: true` only after a parser-version change. These runs restore and upload the existing ledger and raw archive and publish the ticker JSON. They skip broker ingestion and the R2 conditional-write probe. Scheduled broker runs keep their existing behavior.

The workflow retains concurrency group **`idx-batch-ingest`**, `queue: max`, and `cancel-in-progress: false`. Registry runs queue with the broker backfill; do not run another workflow that writes these ledgers in parallel. A 100-report batch needs about 100 seconds of rate spacing when all PDFs are cold, plus discovery, parsing, and R2 transfer time. The 90-minute workflow limit remains in place. Restore includes the cached registry pages and PDFs, so each hosted run resumes the prior run.

## Rollout order

1. Review and merge the branch when ready. This change retains the old `registry` object and adds fields, so the current live web schema accepts the new export.
2. Run archive reparse and historical discovery batches; inspect gaps and sample ticker JSON. The hosted command publishes data on success. Wait for each shared-concurrency run before the next.
3. Deploy the web app. Its schema accepts old exports with no `registry_history`, which show an empty monthly view until data arrives. Both orders remain compatible; publishing data first gives the new UI history on first load.

No hosted run, R2 publish, or deploy is required to test this branch. To generate local fixture exports for browser inspection:

```sh
REGISTRY_PREVIEW_OUT=/tmp/registry-monthly/data pnpm --filter @vibe-idx/pipeline test
```
