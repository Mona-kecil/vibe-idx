# vibe-idx

A daily IDX radar with price and volume signals, ownership changes, ticker research, and broker summaries behind WorkOS email-code login. The interface supports Indonesian and English.

## Run locally

Use Node 24 and pnpm 11.9.

```sh
pnpm install --frozen-lockfile
```

Add these variables to `apps/web/.env.local`. Use the same WorkOS environment for both client IDs.

```dotenv
VITE_WORKOS_CLIENT_ID=your_workos_client_id
WORKOS_CLIENT_ID=your_workos_client_id
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
```

The R2 credential needs object read access to `vibe-idx-private`. Keep secret values out of `VITE_` variables and source control.

Register `http://localhost:5173/callback` as a WorkOS redirect URI, `http://localhost:5173` as an allowed origin and sign-out URI, and `http://localhost:5173/login` as the initiate-login URI. Enable Magic Auth for email-code sign-in.

Start the website and its Vercel functions together.

```sh
pnpm dlx vercel dev --listen 5173 --cwd apps/web
```

Open `http://localhost:5173`. Public pages read the published R2 JSON. The broker endpoint reads private R2 after verifying the WorkOS session. `pnpm --filter @vibe-idx/web dev` runs only the frontend and its public-data proxy.

## Run checks

```sh
pnpm exec vp check apps/pipeline apps/web .github/workflows vite.config.ts
pnpm --filter @vibe-idx/pipeline test
pnpm --filter @vibe-idx/web test
pnpm --filter @vibe-idx/web build
```

CI runs package checks, tests, and the client build on pull requests and pushes to `master`. It uses fixture data and needs no source credentials.

## Run the batch

```sh
pnpm --filter @vibe-idx/pipeline ingest -- --data /tmp/idx-data --out /tmp/idx-public
```

Run private broker collection through GitHub Actions. The workflow restores the complete private ledger after entering its shared queue; a fresh local data directory lacks the history needed for safe cloud publication.

```sh
gh workflow run ingest.yml --repo Mona-kecil/vibe-idx --ref master
```

Seed `auth/stockbit.json` in `vibe-idx-private` with `access` and `refresh` fields. Treat it as a secret. The collector reads the current cloud pair and writes its rotated replacement to R2 before collecting data. Its local token file is a checkpoint, not a seed that replaces cloud state.

GitHub Actions fetches IDX data and publishes public JSON daily at 17:17 Jakarta, then collects broker summaries. Eleven broker-only slots fill the remaining two-hour intervals. All runs share one queue. Targets are positive-volume price pairs from June 1, 2026 through the latest completed trading day, newest first. Existing raw responses and completed empty summaries prevent repeat source requests.

Each broker run allows at most 500 Stockbit attempts and 50 minutes. All auth and summary requests start at least six seconds apart. Broker-only runs skip auth when no pair remains; daily runs maintain auth over weekends. Manual workflow launches require 17:17 Jakarta or later to avoid storing an intraday price snapshot. Ten requests per minute is a collection ceiling, not a verified provider quota.

The collector acquires `broker-run.json` in private R2 before auth. It removes the marker after a successful checkpoint and publication. Any error or interruption leaves it in place and blocks later broker runs while daily IDX publication continues. Before removing a marker, confirm no collector is active, inspect the failed run and cloud token/raw state, and resolve any ambiguous write or token rotation. Do not clear a marker based on age. Manual workflow launches verify R2 conditional writes before starting the collector.

GitHub Actions uses `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` secrets with read and write access to both buckets, plus the `R2_ACCOUNT_ID` repository variable. Vercel needs its own server environment variables. GitHub secrets do not sync to Vercel. June history remains in private raw and Parquet storage; the existing broker view shows only the last 90 calendar days.

See [the architecture and source contracts](docs/v2.md) for storage paths, source dates, and parsing limits.
