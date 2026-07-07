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
- Docker and Docker Compose, for production container runs

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

Development runs directly from the local CLI, not Docker. The web server reads
from `data/vibe_idx.sqlite` by default. Create and populate that database by
running at least one ingest command:

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
same `vibe-idx-data` volume as the app. Docker Compose mounts host-visible
SQLite backups at `./backups`, separate from the data volume. The scheduler
stops when the Compose stack stops.
Scheduled jobs run in Jakarta time:

- Weekdays every 30 minutes from 19:00 through 22:00: daily sources.
- Calendar days 2 through 10 each month at 09:00: monthly sources.
- Every day at 23:15: SQLite backup to `/backups`.

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

## SQLite Backups

Create a consistent SQLite backup with SQLite's backup API:

```bash
cd apps/ingest
uv run idx-ingest db backup
uv run idx-ingest db backup --output ../../backups
```

Inspect the active database:

```bash
uv run idx-ingest db inspect
```

Restore from a backup:

```bash
uv run idx-ingest db restore ../../backups/vibe_idx-YYYYMMDDTHHMMSSZ.sqlite --yes
```

In Docker, backups are written to `/backups` inside containers and `./backups`
on the host:

```bash
docker compose --profile prod run --rm ingest db backup --output /backups
docker compose --profile prod run --rm ingest db inspect
docker compose --profile prod run --rm ingest db restore /backups/vibe_idx-YYYYMMDDTHHMMSSZ.sqlite --yes
```

The production scheduler also runs this backup automatically every day at 23:15
Jakarta time. The manual command is still useful before migrations, restores,
or risky maintenance.

To move servers, run `db backup` on the old server, copy the `.sqlite` file from
`./backups` to the new server's `./backups`, run `db restore` on the new server,
then restart the app and scheduler containers.

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
