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

Run private broker collection through GitHub Actions. The workflow restores the complete private ledger after entering its own queue; a fresh local data directory lacks the history needed for safe cloud publication.

```sh
gh workflow run brokers.yml --repo Mona-kecil/vibe-idx --ref master
```

Seed `auth/stockbit.json` in `vibe-idx-private` with `access` and `refresh` fields. Treat it as a secret. The collector reads the current cloud pair and writes its rotated replacement to R2 before collecting data. Its local token file is a checkpoint, not a seed that replaces cloud state.

A Cloudflare Worker dispatches IDX ingestion daily at 17:17 Jakarta and checks every ten minutes to start a broker run when none is active. Broker runs fetch the Regular, Negotiation and Cash boards separately, at 8 requests a second per ticker across at most 47 tickers, for up to 330 minutes. Stockbit allows 10 requests per ticker, refilled at 10 a second. All is the sum of the three boards.

The collector authenticates only when it needs Stockbit, and retries network failures and 5xx responses three times. Any other Stockbit error stops every ticker. Handled failures remove `broker-run.json`; a killed process leaves the marker and blocks later broker runs for operator review. Before clearing a marker, confirm no collector is active and inspect its token. Configure the dispatch Worker's `GITHUB_TOKEN` secret before deployment.

GitHub Actions uses `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` secrets with read and write access to both buckets, plus the `R2_ACCOUNT_ID` repository variable. Vercel needs its own server environment variables. GitHub secrets do not sync to Vercel. History since January 2026 remains in private raw and Parquet storage; the existing broker view shows only the last 90 calendar days.

See [the architecture and source contracts](docs/v2.md) for storage paths, source dates, and parsing limits.
