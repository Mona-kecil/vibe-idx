# Scheduled feeds

`pnpm --filter @vibe-idx/feeds collect` publishes `news.json` and `calendar.json` to the `vibe-idx-public` R2 bucket. The News and calendar feeds workflow runs every 15 minutes, at minutes 7, 22, 37, and 52, and accepts manual dispatches. GitHub may delay scheduled runs. ForexFactory and BPS refresh hourly. BI refreshes daily. Failed sources retry on the next run.

The news items match the terminal `newsArticleSchema`. `sum` contains the feed's own summary with HTML removed. The collector never requests article pages or stores article bodies.

The Indonesian sources are CNBC Indonesia, Antara, Kontan and IDX Channel. Bisnis is not read: every Bisnis feed URL answers a Cloudflare challenge page. The world sources are Bloomberg, CNBC and WSJ.

Tagging uses the company names in `tickers.json` in the public bucket, with `PT`, `Persero`, and `Tbk` normalized. Longer names match first. A single-word company name requires `PT` or `Tbk`. Group nicknames and bank abbreviations never tag.

A code of four or five capitals tags in three ways:

- A stock marker (`saham`, `emiten`, `ticker`, `kode saham`, `sandi`) immediately before it, or `Tbk` immediately after it. The marker also covers the codes that follow in a list (`Saham BBCA, BBRI dan BMRI`).
- A capitalized name before its parenthesised code (`Pan Brothers (PBRX)`).
- Bare, in a headline that is not all capitals, unless the code is in `wordCodes`. Those codes are also an ordinary word or an organisation's abbreviation (`DATA`, `AUTO`, `NASA`, `META`) and tag only the first two ways.

A new listing whose code reads as a word must be added to `wordCodes`. The `news-tags` check of `pnpm verify:data` finds the ones the archive already shows.

## News archive

Every run also merges its Indonesian articles into the public bucket, which is how ticker news survives the move off Vercel and Google News:

- `news/archive/YYYY-MM.json` holds `{ month, as_of, articles }` for one Jakarta month. An article is `{ ts, src, title, link, tags, source_id }`, newest first, one per canonical link. Titles and links only, never summaries or bodies.
- `news/ticker/CODE.json` holds `{ ticker, as_of, news }` with every archived article tagged with the code, newest first. A row is `{ title, url, published_at, source }`, the shape `/api/news` answers with, so the Worker only filters and cuts. A Worker read of 12 monthly files took 47 ms against 5 to 11 ms for one ticker file, so the index stays.

A repeat run writes nothing. The ticker files are written before the archive, so a run that dies between them is repeated by the next run. Only a feed's own window can be re-read, so an article that left every feed before the archive held it is lost. A link already archived takes the new tags, which carries tagger changes to articles a feed still lists. `pnpm --filter @vibe-idx/feeds backfill --local --retag` applies the current tagger to the rest of a local copy.

A Google News article whose headline a feed already carries is dropped, and a feed article replaces the Google one it duplicates.

## Backfill

`pnpm --filter @vibe-idx/feeds backfill --help` lists the options. The backfill asks Google News about each ticker over the last 12 months, one request per 30 days, and writes through the same merge, so a rerun adds nothing and a stopped run resumes from a state file. Google answers Cloudflare with 503, so run it from a normal machine. It spaces requests 3 seconds apart and backs off on 429 and 503. Do not run the Feeds workflow's collector against the archive at the same moment: both read and rewrite the same month files.

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
