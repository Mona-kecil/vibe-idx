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

Run private Stockbit collection on one machine only. A token refresh revokes the previous pair, and Stockbit rate-limits each account, so a second collector breaks the first. `apps/pipeline/collector/run.sh` restores prices, corporate actions, and the broker activity ledger from R2 into a fresh directory, then runs `brokers` until its deadline. A systemd user unit runs it from a master worktree, with Node 24 and the credentials in `~/.config/vibe-idx/env`, and starts the next run a minute after each one ends. After a failed run, the script waits up to 30 minutes before collecting again. Put `SENTRY_DSN` and `VIBE_IDX_SENTRY_HOST` in `~/.config/vibe-idx/collector.env`, which only the unit loads, never in the shared env file.

```sh
git worktree add --detach ~/.local/share/vibe-idx-collector origin/master
pnpm --dir ~/.local/share/vibe-idx-collector install --frozen-lockfile
install -D -m 644 apps/pipeline/collector/vibe-idx-collector.service ~/.config/systemd/user/
systemctl --user enable --now vibe-idx-collector
```

To deploy a new master, run `git -C ~/.local/share/vibe-idx-collector checkout --detach origin/master` after fetching, then `systemctl --user restart vibe-idx-collector`. Follow a run with `journalctl --user -u vibe-idx-collector -f`.

Seed `auth/stockbit.json` in `vibe-idx-private` with `access` and `refresh` fields. Treat it as a secret. The collector reads the current cloud pair and writes its rotated replacement to R2 before collecting data. Its local token file is a checkpoint, not a seed that replaces cloud state. A refresh revokes the previous pair at once, so if saving the rotated pair fails, the collector writes it to `auth/stockbit-unsaved.json`. Copy that file over `auth/stockbit.json` once no collector is running.

A Cloudflare Worker dispatches IDX ingestion daily at 17:17 Jakarta. Broker activity is the only broker source. Runs process dates with positive-volume prices since January 1, 2026, newest first, through the latest session completed by 17:17 Jakarta. For each Regular, Negotiation, and Cash board, the collector lists active brokers and fetches their domestic and foreign client activity separately. Requests share a pace of 10 starts a second (`BROKER_ACTIVITY_RPS` overrides it), within the run deadline (`BROKER_DEADLINE_MINUTES`, 240 in the unit). All boards is the sum of the three boards.

The collector authenticates only when it needs Stockbit and conditionally saves the rotated token before requesting activity. It retries activity network failures, HTTP 429, and transient 5xx responses up to three times. A persistent request failure stops the activity phase. Invalid responses remain pending while collection continues. Rows and target completion commit together. Checkpoints upload changed activity years before coverage. Only complete day-boards enter ticker JSON and regular-board concentration. Concentration sums domestic and foreign rows per broker and retains the existing 1-, 3-, and 5-session output.

Handled failures remove `broker-run.json`; a killed process leaves the marker and blocks later broker runs for operator review. Before clearing a marker, confirm no collector is active and inspect its token. Configure the dispatch Worker's `GITHUB_TOKEN` secret before deployment. IDX ingestion restores only broker activity coverage for its freshness check and never uploads broker activity.

GitHub Actions uses `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` secrets with read and write access to both buckets, plus the `R2_ACCOUNT_ID` repository variable. Vercel needs its own server environment variables. GitHub secrets do not sync to Vercel. Broker activity since January 2026 remains in private Parquet storage and the private ticker exports. Archived per-stock broker objects remain stored but are unused.

See [the architecture and source contracts](docs/v2.md) for storage paths, source dates, and parsing limits.
