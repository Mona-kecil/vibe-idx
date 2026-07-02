# vibe-idx

Local IDX/KSEI ingestion.

```text
apps/ingest/   Python ingestion CLI and parsers
db/            SQLite schema
samples/       Small IDX fixture PDFs/JSON for tests
data/          Local runtime data, ignored by git
```

Run checks:

```bash
cd apps/ingest
uv run pytest
uv run ruff check .
```

Run latest-aware ingestion:

```bash
uv run idx-ingest ksei-5pct
uv run idx-ingest insider
uv run idx-ingest ksei-1pct
uv run idx-ingest laporan-efek
uv run idx-ingest market-summary
```

No-argument commands use source-specific latest behavior:

- `market-summary` walks backward to the latest populated EOD trading summary.
- `ksei-5pct` fetches the newest available KSEI ownership-list file.
- `insider` fetches all insider reports from the newest publication day in the lookback window.
- `ksei-1pct` and `laporan-efek` fetch the latest monthly disclosure from a lookback window.

Inspect source-aware ingestion policy:

```bash
uv run idx-ingest sources
uv run idx-ingest sources ksei-1pct
```

Backfill:

```bash
uv run idx-ingest ksei-5pct --from 2026-06-01 --to 2026-06-28
uv run idx-ingest insider --from 2026-06-01 --to 2026-06-28
uv run idx-ingest ksei-1pct --month 2026-06
uv run idx-ingest laporan-efek --period previous-month
```

Historical date basis:

- Daily sources use source-specific daily dates: `market-summary` uses trade date, `ksei-5pct` uses ownership-list listing date, and `insider` uses IDX disclosure publish date.
- Monthly sources use IDX disclosure publish month. Use `--month YYYY-MM` for a specific disclosure month or `--period previous-month` for the previous monthly disclosure cycle.
- `--period latest` is equivalent to the no-argument default and cannot be combined with `--from`, `--to`, or `--month`.

Default DB:

```text
data/vibe_idx.sqlite
```
