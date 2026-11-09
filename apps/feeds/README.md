# Scheduled feeds

`vibe-idx-feeds` publishes `news.json` and `calendar.json` to `PUBLIC`, the `vibe-idx-public` R2 bucket. The cron runs every ten minutes. ForexFactory and BPS refresh hourly. BI refreshes daily. Failed sources retry on the next cron.

The news items match the terminal `headlineSchema`. `sum` contains the feed's own summary with HTML removed. The collector never requests article pages or stores article bodies. The Google News and Vercel ticker-news paths remain separate.

Tagging uses the company names in `PUBLIC/tickers.json`, with `PT`, `Persero`, and `Tbk` normalized. Longer names match first. A single-word company name requires `PT` or `Tbk`. A four-letter ticker requires a stock marker such as `saham` or `emiten` immediately before it, or `Tbk` immediately after it. Bare codes, bank abbreviations, and group nicknames do not qualify by themselves.

`calendar.json` uses the terminal `calendarEventSchema`. ForexFactory supplies its weekly high-impact events and medium-impact events for USD, CNY, EUR, and JPY.

BPS combines its [advance release calendar](https://www.bps.go.id/id/arc) with current-month releases from the [BPS WebAPI](https://webapi.bps.go.id/documentation/). The documented WebAPI press-release endpoint contains published releases, not the upcoming schedule. The collector rediscovers the `getArcBrs` server action from the page's current JavaScript chunks each hour, then reads the annual BRS schedule. It also reads every page of current-month national WebAPI releases. It ignores abstracts. An action change, failed request, invalid response, or missing current-month schedule fails the BPS source and triggers Sentry.

BI comes from the annual RDG table on its [calendar page](https://www.bi.go.id/id/publikasi/Kalender/Default.aspx). The decision date is the second meeting day. BPS and BI dates have no published release time. Their `ts` uses midnight WIB as a sorting placeholder, and `est` states this uncertainty. No announcement time is inferred.

Both files contain:

- `as_of`: the last successful source refresh in the document.
- `sources`: metadata keyed by stable source ID. Each entry has `as_of`, `attempted_at`, `status`, and `count`.
- `news` or `cal`: the items. Each item includes `source_id` for retention and inspection.
- `errors`: unavailable or stale source IDs in readable messages.

A failed source retains its prior rows and `as_of`. Its status becomes `stale`, or `unavailable` if it has never succeeded. Other sources continue refreshing. A failed first run cannot publish an empty document. A failed R2 read or write triggers Sentry. The next run rebuilds each whole document from the last published copy.

## Verify locally

Run `pnpm --filter @vibe-idx/feeds check` and `pnpm --filter @vibe-idx/feeds test`.

For live checks, run `pnpm --filter @vibe-idx/feeds verify:live /path/to/private/bps-key-file /tmp/feeds-verification`. The script reads the key at runtime and writes only to the scratch directory. It uses an in-memory bucket, prints source counts and fifteen tag samples, and exits unsuccessfully if a source fails. Never commit those outputs because they contain publisher text. Offline RSS and ForexFactory fixtures contain invented titles and summaries. BPS and BI fixtures contain public schedule data.

For the local Workers runtime, seed `tickers.json` with `wrangler r2 object put vibe-idx-public/tickers.json --file /tmp/tickers.json --local`. Use an untracked environment file with `BPS_KEY` and `SENTRY_DSN`. Start `wrangler dev --local --test-scheduled --env-file /path/to/private/local.env`, then request `http://localhost:8787/__scheduled`. R2 writes remain local. Keep the same `--persist-to` directory for all commands if you set one.

## Production setup

Deployment and setting secrets are separate steps that require the user's approval. The required Worker secrets are `BPS_KEY` and `SENTRY_DSN`. Neither belongs in Wrangler variables, source code, or committed environment files. There is no HTTP collection route and `workers_dev` is disabled. Source errors go to Sentry as credential-free diagnostics.
