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

Run with Docker Compose:

```bash
docker compose --profile tools build
docker compose run --rm ingest market-summary
docker compose up web api
```

The web app is available at `http://localhost:5173`, and the API is exposed at
`http://localhost:20240/trpc`. Ingest more data into the shared Compose volume with:

```bash
docker compose run --rm ingest market-summary
docker compose run --rm ingest ksei-5pct
docker compose run --rm ingest insider
docker compose run --rm ingest ksei-1pct
docker compose run --rm ingest laporan-efek
```

Compose stores SQLite and raw files in the named volume `vibe-idx-data`.

Run the compiled production app:

```bash
docker compose --profile prod up --build app
```

The compiled app serves both the React build and `/trpc` API from
`http://localhost:8080`.

Run the compiled production app with scheduled ingestion:

```bash
docker compose --profile prod up --build app scheduler
```

The scheduler uses `supercronic` to run
[apps/ingest/cron/ingest.cron](apps/ingest/cron/ingest.cron) inside the Compose
stack. It writes to the same `vibe-idx-data` volume as the app and stops when
the Compose stack stops. Scheduled ingestion runs in Jakarta time:

- Weekdays every 30 minutes from 19:00 through 22:00: daily sources.
- Calendar days 2 through 10 each month at 09:00: monthly sources.

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
