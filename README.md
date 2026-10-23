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
pnpm --filter @vibe-idx/pipeline brokers -- --data /tmp/idx-data --token /path/to/stockbit.json --out /tmp/idx-private
```

The Stockbit token file has `access` and `refresh` fields. Treat it as a secret. The broker command rotates both tokens and saves the pair before collecting data.

The daily GitHub Actions workflow restores private Parquet, fetches IDX data, publishes public JSON, then collects broker summaries for traded stocks. It runs daily at 17:17 Jakarta so token renewal continues over weekends. Completed empty summaries and pending failures remain in a private pair ledger. The first collection starts on the latest trading day. Later runs fill gaps from that start date.

GitHub Actions uses `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` secrets with read and write access to both buckets, plus the `R2_ACCOUNT_ID` repository variable. Seed `auth/stockbit.json` in the private bucket before the first broker run. Vercel needs its own server environment variables. GitHub secrets do not sync to Vercel.

See [the architecture and source contracts](docs/v2.md) for storage paths, source dates, and parsing limits.
