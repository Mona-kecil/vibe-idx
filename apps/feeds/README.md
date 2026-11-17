# Scheduled feeds

`pnpm --filter @vibe-idx/feeds collect` publishes `news.json` and `calendar.json` to the `vibe-idx-public` R2 bucket. The News and calendar feeds workflow runs every 15 minutes, at minutes 7, 22, 37, and 52, and accepts manual dispatches. GitHub may delay scheduled runs. ForexFactory and BPS refresh hourly. BI refreshes daily. Failed sources retry on the next run.

The news items match the terminal `newsArticleSchema`. `sum` contains the feed's own summary with HTML removed. The collector never requests article pages or stores article bodies.

The scheduled Indonesian sources are CNBC Indonesia, Antara and IDX Channel. Kontan answers locally but rejects GitHub runners with HTTP 403, so it is excluded from scheduled collection; existing archived articles remain available, and Google backfills can still include its stories. Bisnis is not read: every Bisnis feed URL answers a Cloudflare challenge page. The world sources are Bloomberg, CNBC and WSJ.

Tagging uses the company names in `tickers.json` in the public bucket, with `PT`, `Persero`, and `Tbk` normalized. Longer names match first. A single-word company name requires `PT` or `Tbk`. Group nicknames and bank abbreviations never tag.

Codes of four or five capitals tag after a stock marker, in a stock list, after `$` for an unambiguous code, with `Tbk`, or with a capitalized name before their parenthesised code. A bare code also needs company-name or business context. Codes that read as English or Indonesian words need explicit stock context or a distinctive word from the company's name. This favors precision and misses some headlines that name only a code.

`src/common-words.ts` bundles four- and five-letter dictionary words rather than a hand-maintained list of ticker codes. Rebuild it with `pnpm --filter @vibe-idx/feeds words ENGLISH_WORDS.txt INDONESIAN_WORDS_DIR`. The source versions and licenses are in `WORD-LISTS-LICENSE`.

## News archive

Every run also merges its Indonesian articles into the public bucket:

- `news/archive/YYYY-MM.json` is the source of truth for one Jakarta month. It holds `{ month, as_of, articles, tickers, dirty }`. Articles contain titles, dates, links, publishers and tags, never article bodies.
- `news/ticker/CODE/YYYY.json` holds `{ ticker, as_of, news }` for one Jakarta year, newest first. `/api/news` reads at most two annual files for its date range.

Archive writes require the ETag read, or a missing object. A conflict retries from a fresh read. A changed month is marked dirty in the same write; its ticker files are then derived with conditional writes, and the mark is cleared only if the archive has not changed. A later run repairs dirty months without needing their articles again. Feeds checks the current and previous months even when no current source returns those articles. An interrupted historical backfill retries its uncompleted batch.

A repeat run writes nothing. AMP forms and tracking parameters identify the same link. A Google redirect and a publisher link are one story only when publisher, normalized headline and publication time agree. Distinct publishers and later repeats survive.

Retag a local copy with `pnpm --filter @vibe-idx/feeds backfill --local --retag`.

## Backfill

`pnpm --filter @vibe-idx/feeds backfill --help` lists the options. The backfill asks Google News about each ticker over the last 12 months, one request per 30 days, and writes through the same merge, so a rerun adds nothing and a stopped run resumes from a state file. Google answers Cloudflare with 503, so run it from a normal machine. It spaces requests 3 seconds apart and backs off on 429 and 503. Conditional writes allow the backfill and Feeds to update the archive together. Progress is saved atomically per destination, ticker and completed date range; increasing the lookback only requests the missing dates. A damaged progress file fails with an actionable error; `--restart` starts over.

- `--local` writes to a copy of the public bucket in the fixtures folder instead of R2, for trying it.
- `--r2` writes to the real bucket with the `R2_*` variables of the Feeds job.
- `--top N` takes the N tickers with the highest value traded first, 13 requests each.

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

## Production configuration

The workflow reads `R2_ACCOUNT_ID` from the repository variables and `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `BPS_KEY`, and `SENTRY_DSN` from repository secrets. The same environment variables configure local collection, except `SENTRY_DSN`: only GitHub Actions reports to Sentry, and local runs print failures to stderr. Running `collect` writes directly to the public bucket. Use `verify:live` for checks that must stay local.

GitHub Actions serializes runs with the `news-calendar-feeds` concurrency group. The collector reads the last publication from R2, retains failed sources, and signs requests with the existing R2 credentials. Only a missing object (HTTP 404) starts a new publication. Other read errors prevent that document from being overwritten. Source or publication failures report credential-free diagnostics to Sentry and fail the workflow after the remaining sources finish. No Cloudflare Worker deployment is required.

The CLI publishes and checkpoints each ticker before starting the next one.
