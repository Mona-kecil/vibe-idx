# Architecture

The [README](../README.md) covers running, checking and operating the system. This page covers how the parts fit and what each source guarantees.

## Runtime

GitHub Actions runs Ingest and the Collector as separate workflows with separate queues. DuckDB reads private Parquet history and writes the public JSON that the Site and the Terminal read. Vercel serves the React app and its functions. Dispatch starts Ingest daily at 17:17 Jakarta and starts a Collector run every ten minutes when none is active. A manual Ingest refuses to start before 17:17. Feeds publishes market news and the economic calendar on its own schedule; see [its README](../apps/feeds/README.md).

Ticker links get server-rendered metadata with the company name, latest close, daily change and reporting date. `/api/og` renders the Ticker card from public ticker data, and its dated URL refreshes chat previews each session. The preview Worker injects the same metadata from the public bucket and proxies the image to Vercel. Missing ticker data falls back to the default preview.

## Ingest

`apps/pipeline/ingest.ts` collects prices, indices, issuers, 1% holders, 5% holders and every page of filings. `reports.ts` reads supported Insider report and Registry PDFs. `sql.ts` defines the tables and the public JSON. Source parsers live in `apps/pipeline/lib`, and their fixtures in `apps/pipeline/fixtures`.

## Collector

`apps/pipeline/brokers.ts` runs the Collector: broker data first, then running trades and closing order books.

- **Dates.** Sessions with positive-volume prices from 1 January 2026 through the latest session completed by 17:17 Jakarta, newest first.
- **Broker data.** For each date, the Collector lists active brokers on the Regular, Negotiation and Cash boards, then fetches each broker's domestic and foreign client activity from `/order-trade/broker/activity`, following pagination. Share counts stay as Stockbit reports them.
- **Time limits.** A 330-minute collection deadline inside a 355-minute job timeout. Running trades and order books may use 320 minutes of it.
- **Run marker.** `broker-run.json` expires 15 minutes after the run's deadline. A marker without an expiry expires six hours after it started. A run takes over only an expired marker, with `If-Match`.
- **Token.** On its first Stockbit request, the Collector refreshes the token pair, saves it locally with mode 0600, and writes it to `auth/stockbit.json` with `If-Match`. If that write fails, it writes `auth/stockbit-unsaved.json`. On HTTP 401 or 403 it retries once with the local pair. A refresh revokes the previous pair, so a lost refresh response may need a new token seed. R2 reads request identity encoding to keep strong ETags.
- **Coverage.** Activity rows and their Coverage commit together, and activity years upload before Coverage. A Day-board is complete once its broker list is fetched and every listed broker's domestic and foreign activity is fetched. The latest complete session needs all three boards. A run starting or a partial checkpoint does not count.
- **Publishing.** The Collector publishes regular-board Accumulation for 1-, 3- and 5-session windows, summing domestic and foreign shares and buy frequency per broker. A missing or incomplete session makes its window null. It then publishes each ticker's broker data since January 2026, keeping the client split. The manifest skips unchanged files and commits only after every changed upload succeeds.
- **Failures.** A persistent request failure stops the phase. Invalid responses stay pending and are reported after publishing.

## Sign-in and private data

`apps/web/api/brokers.ts` verifies the WorkOS JWT against the client's signing keys before it reads the private bucket, and responds with private, no-store caching.

- `GET /api/brokers?ticker=BBCA` returns `{ticker, days}`. Each day has `date`, `board`, `buy` and `sell`. Each broker row has `broker`, `investor` (domestic or foreign clients), `broker_type`, `shares`, `value`, `avg_price` and `freq`.
- `view=ticks&date=…&kind=trades|book` returns one session's running trades or closing order book.
- `view=market` returns Accumulation.

The browser sums gross shares and values over the selection and computes average prices as value divided by shares. Broker data does not show beneficial ownership or current inventory.

The AuthKit SDK handles PKCE, token renewal and email-code sign-in. Without a custom authentication domain, it keeps the refresh token in local storage and the access token in memory. R2 and Stockbit secrets never enter browser configuration. Public pages need no sign-in.

## Storage

The private bucket, `vibe-idx-private`:

- `raw/`: fetched IDX responses. `raw/broker/` is unused.
- `parquet/<table>/<year>.parquet`: history tables. Issuers use one current file.
- `parquet/broker_activity/<year>.parquet` and `parquet/broker-activity-coverage.parquet`: broker data and its Coverage.
- `ticks/<dataset>/<date>.parquet`, `ticks/ledger.parquet` and `ticks/collection.json`: running trades, closing order books and their progress.
- `broker-run.json`: the Run marker.
- `auth/stockbit.json`: the current Stockbit token pair.
- `site/broker/<TICKER>.json.gz` and `site/broker-activity-publication.json`: published broker data and its manifest.
- `site/ticks/<TICKER>/<date>.<trades|book>.json.gz`: published running trades and order books.
- `site/market-accumulation.json`: Accumulation windows.
- `parquet/brokers/` and `parquet/broker-coverage.parquet`: unused.

The Collector restores only prices, broker data years and Coverage. Ingest restores only Coverage, for its freshness check, and never uploads broker data. Nothing deletes stored objects.

The public bucket, `vibe-idx-public`, holds `health.json`, `market.json`, `feed.json`, `tickers.json`, `ticker/<TICKER>.json`, and Feeds' `news.json` and `calendar.json`. Vercel maps `/data/*` to it. Broker data never enters it.

## Sources and dates

- **Prices and indices:** IDX trading-summary endpoints on `www.idx.id`. Issuers come from its company-profile endpoint.
- **1% and 5% holders:** the IDX shareholding-data list. Dates come from the XLSX contents, not the publish time. Duplicate monthly rows keep their sequence.
- **Filings:** every page of `ListedCompany/GetAnnouncement`. The first run covers 90 days. Later runs overlap the latest stored date by two days. Public output keeps publish times, source links and attachments.
- **Insider reports:** dated by report date. Only the supported KSEI layout is read. The net change is shares after minus shares before, not every trade.
- **Registry:** dated by month-end. Supported layouts give free float and shareholder counts. Total shares stay null until a verified parser exists.
- **Unsupported layouts:** they keep their filing links, and unknown values stay null. They are listed in Ingest's `report_gaps`.
- **Ticker news:** `api/news.ts` searches Google News for the ticker and `saham`, returning titles, sources, dates and links but no article bodies. Matching on the code can return unrelated articles.

## Deployment

Set the README's environment variables in Vercel. GitHub secrets do not sync there. The Vercel functions need only read access to the private bucket, and Ingest and the Collector have their own write credentials in GitHub Actions. In WorkOS, enable Magic Auth and register the deployment's origin, `/callback` redirect, root sign-out URI and `/login` initiate-login URI, with matching client IDs for staging and production.
