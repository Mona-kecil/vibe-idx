# vibe-idx

Local IDX/KSEI ingestion and web UI for market data, ownership disclosures, and
IDX announcements.

## Project Layout

```text
apps/ingest/   Python ingestion CLI, source clients, and parsers
apps/web/      React web app and tRPC HTTP server
db/            SQLite schema
samples/       Small IDX fixture PDFs/JSON for tests
data/          Local runtime data, ignored by git
```

## Prerequisites

Install these tools before running the project locally:

- Node.js 24 or newer
- pnpm 11.9.0 or newer
- Python 3.12
- uv
- Docker and Docker Compose, for containerized runs

If pnpm is not already available, enable it through Corepack:

```bash
corepack enable
```

## Install

Install the JavaScript workspace dependencies from the repo root:

```bash
pnpm install
```

Install the Python ingest dependencies:

```bash
cd apps/ingest
uv sync
cd ../..
```

## Run Locally in Development Mode

The web server reads from `data/vibe_idx.sqlite` by default. Create and populate
that database by running at least one ingest command:

```bash
cd apps/ingest
uv run idx-ingest market-summary
uv run idx-ingest ksei-5pct
uv run idx-ingest insider
uv run idx-ingest ksei-1pct
uv run idx-ingest laporan-efek
cd ../..
```

Start the API server in one terminal:

```bash
pnpm --filter @vibe-idx/web dev:server
```

Start the Vite web app in another terminal:

```bash
pnpm --filter @vibe-idx/web dev:web
```

Open the web app at `http://localhost:5173`. The API listens on
`http://localhost:20240/trpc`, and Vite proxies `/trpc` requests to it.

## Run in Docker for Development

Build the Compose images:

```bash
docker compose --profile tools build
```

Populate the shared Docker SQLite volume:

```bash
docker compose run --rm ingest market-summary
docker compose run --rm ingest ksei-5pct
docker compose run --rm ingest insider
docker compose run --rm ingest ksei-1pct
docker compose run --rm ingest laporan-efek
```

Start the dev web and API services:

```bash
docker compose up web api
```

Open `http://localhost:5173`. The API is exposed at
`http://localhost:20240/trpc`.

Docker Compose stores SQLite data and downloaded raw files in the named volume
`vibe-idx-data`.

## Run on a Server with Docker

For a compiled production-style container that serves both the React build and
the `/trpc` API from one service:

```bash
docker compose --profile prod up --build app
```

Open `http://localhost:8080`.

To run the compiled app with scheduled ingestion in the same Compose stack:

```bash
docker compose --profile prod up --build app scheduler
```

The scheduler uses `supercronic` and
[`apps/ingest/cron/ingest.cron`](apps/ingest/cron/ingest.cron). It writes to the
same `vibe-idx-data` volume as the app and stops when the Compose stack stops.
Scheduled ingestion runs in Jakarta time:

- Weekdays every 30 minutes from 19:00 through 22:00: daily sources.
- Calendar days 2 through 10 each month at 09:00: monthly sources.

## Ingestion Commands

No-argument commands use source-specific latest behavior:

```bash
cd apps/ingest
uv run idx-ingest market-summary
uv run idx-ingest ksei-5pct
uv run idx-ingest insider
uv run idx-ingest ksei-1pct
uv run idx-ingest laporan-efek
```

Inspect source-aware ingestion policy:

```bash
uv run idx-ingest sources
uv run idx-ingest sources ksei-1pct
```

Backfill historical data:

```bash
uv run idx-ingest ksei-5pct --from 2026-06-01 --to 2026-06-28
uv run idx-ingest insider --from 2026-06-01 --to 2026-06-28
uv run idx-ingest ksei-1pct --month 2026-06
uv run idx-ingest laporan-efek --period previous-month
```

Historical date basis:

- Daily sources use source-specific daily dates: `market-summary` uses trade
  date, `ksei-5pct` uses ownership-list listing date, and `insider` uses IDX
  disclosure publish date.
- Monthly sources use IDX disclosure publish month. Use `--month YYYY-MM` for a
  specific disclosure month or `--period previous-month` for the previous
  monthly disclosure cycle.
- `--period latest` is equivalent to the no-argument default and cannot be
  combined with `--from`, `--to`, or `--month`.

## Checks

Run Python checks:

```bash
cd apps/ingest
uv run pytest
uv run ruff check .
```

Run web checks:

```bash
pnpm --filter @vibe-idx/web test
pnpm --filter @vibe-idx/web check
pnpm --filter @vibe-idx/web build
```

The default local database path is:

```text
data/vibe_idx.sqlite
```
