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

Run latest-day ingestion:

```bash
uv run idx-ingest ksei-5pct
uv run idx-ingest insider
uv run idx-ingest ksei-1pct
uv run idx-ingest laporan-efek
uv run idx-ingest market-summary
```

Backfill:

```bash
uv run idx-ingest ksei-5pct --from 2026-06-01 --to 2026-06-28
```

Default DB:

```text
data/vibe_idx.sqlite
```
