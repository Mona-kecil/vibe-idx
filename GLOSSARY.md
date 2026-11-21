# vibe-idx

A daily radar for the Indonesia Stock Exchange (IDX). It finds tickers with unusual price, volume, foreign or ownership activity, then shows who holds and who trades each one.

Site sections take their heading as their name. Terminal functions take the name on their tab, and each keeps a two- to four-letter code that the command bar also accepts. When a Site section and a Terminal function cover the same thing, each entry names its twin. The Site twin usually shows less.

## Language

### Views

**View**:
The Site or the Terminal.
_Avoid_: app, frontend, side

**Site**:
The pages for reading at a glance, on any screen: Today, Market, Ticker page and Login. Not the Terminal.
_Avoid_: non-terminal, web, website, main app

**Terminal**:
The one desktop screen of panes for finding a ticker and studying it in depth. It is not available on phones.
_Avoid_: workspace, pro mode, dashboard, app

**Ticker**:
A listed company, named by its IDX code, such as BBCA.
_Avoid_: symbol, emiten, issuer code

**Watchlist**:
The one list of tickers the user has pinned, shared by the Site and the Terminal. The Today watchlist and the Watchlist function show it.
_Avoid_: favorites, portfolio, saved stocks

**Pin**:
To add a ticker to the watchlist.
_Avoid_: star, favorite, bookmark, follow

**Selection**:
A day or date range picked on a price chart. On the Ticker page it narrows the sections below the chart, and in the Terminal it narrows the broker functions.
_Avoid_: range, brush, highlight

**Session**:
One trading date.
_Avoid_: day, trading day, SESSION 1 and SESSION 2 (those are trading phases)

**Risk flag**:
An IDX suspension, UMA notice or notation on a ticker. The ticker title shows the current ticker's, and Risk flags lists them for all tickers.
_Avoid_: risk badge, warning

**Stale**:
The state of the Site or Terminal when the daily run is late, or of one source that failed its update.
_Avoid_: outdated, old data, delayed

### Site

**Today**:
The Site's front page: Pulse, Today watchlist, Most traded, signal tiles, This week and News.
_Avoid_: Home (except the Terminal's HOME link, which returns to the Site), homepage, dashboard

**Market**:
The Site page that lists every ticker that traded in the latest session, ranked by a sort chip and narrowed by a lens. It is the screener.
_Avoid_: stock list, market page

**Ticker page**:
The Site page for one ticker: price chart, stats, ownership, timeline, broker summary and broker distribution.
_Avoid_: stock page, company page, detail page

**Search**:
The Site header box that finds a ticker by code or company name. Not the command bar.
_Avoid_: lookup, finder

**Pulse**:
The Today strip with IHSG, breadth, estimated foreign flow and source dates. The Terminal's twin is the status bar.
_Avoid_: market summary, header stats

**Today watchlist**:
The Today section headed "Watchlist", with one row per pinned ticker and shown only when something is pinned. The Terminal's twin is the Watchlist function.
_Avoid_: favorites

**Most traded**:
The Today heatmap of the 50 tickers with the highest value traded, 20 on phones, colored by daily change. The Terminal's twin is Heatmap.
_Avoid_: treemap

**Signal tile**:
A Today card for one signal kind with its ticker count and three strongest tickers, not a heatmap tile. The Terminal's twin is Signals.
_Avoid_: signal card, alert tile

**This week**:
The Today strip of the next five weekdays with high-impact economic releases and corporate action dates.
_Avoid_: calendar, upcoming

**News**:
The Today section of the latest Indonesian market news, grouped by day. The Terminal's twin, also News, covers world and ticker news too.
_Avoid_: headlines, feed

**Sort chip**:
A Market button that ranks the table: Gainers, Losers, Value, Foreign buy or Foreign sell.
_Avoid_: filter, lens

**Period**:
The 1d, 3d or 5d window that Market and Movers rank over. Not a selection.
_Avoid_: range, window, timeframe

**Accumulation**:
The signed-in Market column: the top net-buying broker's net shares as a share of volume over the period. It does not identify the investor behind the broker.
_Avoid_: bandar score, smart money

**Lens**:
A Market tab that keeps only the tickers with one signal kind, or every ticker for All. A kind with no tickers is hidden unless its lens is selected.
_Avoid_: filter tab, signal filter

**Price chart**:
The Ticker page chart of price and volume, with net foreign overlays and chart marks. The Terminal's twin is Chart.
_Avoid_: graph, candles

**Chart mark**:
A lettered badge on a price chart for a filing, a 5% change or a corporate action date.
_Avoid_: event badge, pin, marker

**Stats**:
The Ticker page figures under the price chart, except price and change, which sit in the page header. Less-used figures sit behind More, and the Terminal's twin is Key figures.
_Avoid_: key figures, fundamentals

**Ownership**:
The Ticker page section with 5% holders, ownership changes and holdings over time. The Terminal's twin is Holders.
_Avoid_: holders section, shareholders

**Timeline**:
The Ticker page list of IDX filings and ticker news, newest first, narrowed to the selection, without corporate action dates. The Terminal's twin, also Timeline, adds action dates and ignores the selection.
_Avoid_: feed, disclosures

**Broker summary**:
The Ticker page section with buyers and sellers by broker over the selection. The Terminal's twin has the same name.
_Avoid_: broker table

**Broker distribution**:
The Ticker page section that links each buyer to the brokers it bought from, on the regular board, for one session or the selection. The Terminal's twin has the same name.
_Avoid_: sankey, broker flow (that is a function of its own)

**Action chip**:
The Ticker page header badge for the next corporate action within 30 days.
_Avoid_: event badge, action tag

**Skeleton**:
The Terminal's layout with its tab names and empty rows, shown until its data arrives, so nothing moves when it does.
_Avoid_: boot, loading screen, splash, void

### Terminal

**Layout**:
The Terminal's one fixed arrangement of panes: the market list on the left, Heatmap, Chart and Broker distribution above the ticker's holders and brokers in the middle, and News and Done detail above Key figures and the trade functions on the right.
_Avoid_: mode, view, desk, workspace

**Pane**:
One box in the layout, showing one function, or two side by side after a shift-click on a tab. "The Chart pane" means the pane showing Chart.
_Avoid_: panel, widget, window, card

**Slot**:
A fixed position in the layout that holds one pane and its tabs.
_Avoid_: cell, area, region

**Tab**:
One function's button in a pane. A pane opens on its first tab until you pick another.
_Avoid_: tab for a lens

**Function**:
What a pane shows, named on its tab and opened from the tab or from the command bar.
_Avoid_: widget, view, shortcut

**Locked**:
A function or option that only a signed-in user can see, shown dimmed with a padlock. Picking it opens the sign-in prompt.
_Avoid_: disabled, greyed out, premium

**Ticker title**:
The current ticker, its company name and its risk flags, shown once beside the command bar. Every ticker pane follows it.
_Avoid_: header, ticker label

**Command bar**:
The Terminal input that takes a ticker, a function's name or code, HELP or PIN.
_Avoid_: search, omnibox, prompt

**Status bar**:
The Terminal's bottom line with the trading phase, IHSG, breadth, estimated foreign flow and the next high-impact economic release. The Site's twin is Pulse.
_Avoid_: footer

**Trading phase**:
Where the exchange is in its day, in Jakarta time: PRE-OPEN, SESSION 1, BREAK, SESSION 2, PRE-CLOSE or CLOSED.
_Avoid_: session (for a phase), market hours

**Timeframe**:
The bar size on Chart: W, D, 4H, 1H or 15M. The intraday ones are locked when signed out. Not a selection or a period.
_Avoid_: interval, resolution, range

**Hillclimb**:
The measured count of steps a person needs to answer the Terminal's daily questions.
_Avoid_: benchmark, usability score

**Trade filter**:
The Done detail and Running trade filter by action, board, investor side, price, time and brokers. Buyer and seller brokers join by OR or AND, and a buyer code fills the seller field until the seller is edited.
_Avoid_: search, query

### Functions

**Watchlist** (WL):
The pinned tickers as quote rows. The Site's twin is Today watchlist.
_Avoid_: watchlist pane

**Signals** (SIG):
Every signal, grouped by date. The Site's twin is the signal tiles.
_Avoid_: alerts, signals feed

**Heatmap** (HEAT):
The heatmap of the 60 tickers with the highest value traded, in the pane it shares with Chart and Broker distribution. Picking a ticker while it shows brings Chart back. The Site's twin is Most traded.
_Avoid_: treemap

**Movers** (MOV):
The top movers by change and by value traded, stacked when the pane is narrow.
_Avoid_: gainers, market movers

**News** (NEWS):
News for Indonesia, the world or the current ticker. The Site's twin is News.
_Avoid_: feed

**Corp actions** (CA):
Corporate actions such as dividends, rights issues and shareholder meetings.
_Avoid_: actions (that is the trade column in Done detail and Running trade), events

**Economic calendar** (CAL):
Scheduled economic releases by date and impact.
_Avoid_: macro, events

**Risk flags** (RISK):
Risk flags across all tickers.
_Avoid_: risk badge

**Chart** (GP):
The Terminal price and volume chart, in any timeframe down to 15 minutes, where shift-drag sets the selection. The Site's twin is the price chart.
_Avoid_: price history, graph, price pane

**Key figures** (KEY):
The latest price, trading and registry figures for one ticker. The Site's twin is stats.
_Avoid_: description, fundamentals

**Holders** (HDS):
One ticker's holders at 1% and above over time, with each 5% holder's changes. The Site's twin is ownership.
_Avoid_: holders and changes, ownership pane

**Disclosures** (DISC):
IDX filings for one ticker.
_Avoid_: filings pane

**Timeline** (FEED):
One dated list of a ticker's filings, news and corporate action dates, upcoming actions first. Its news includes market news tagged with the ticker. The Site's twin, also Timeline, has no action dates and narrows to the selection.
_Avoid_: feed, company feed

**Broker summary** (BRK):
Net or gross buyers and sellers by broker over a period. The Site's twin is Broker summary on the Ticker page.
_Avoid_: broker flow (that is a function of its own), broker table

**Broker flow** (BFL):
Each chosen broker's net buying, summed from zero across the selection or flow period, not the broker's total holding. For one session, from a one-day selection or the 1D flow period, it sums that session's running trade minute by minute. It has no Site twin.
_Avoid_: broker summary, accumulation chart

**Broker distribution** (BD):
Gross buying between brokers from running trade, drawn as bands from each buyer to the sellers it bought from, for one session or the latest 20 sessions of the selection. It shares a pane with Heatmap and Chart. The Site's twin has the same name.
_Avoid_: sankey, broker flow (that is a function of its own)

**Foreign flow** (FF):
Daily net buying by foreign clients and its running total, from broker data.
_Avoid_: foreign estimate (that is the IDX figure in Pulse and the status bar)

**Done detail** (DD):
One session's blocks, plus each off-board trade as its own row. A block drills into its fills in Running trade.
_Avoid_: big orders

**Running trade** (RT):
One session's individual fills.
_Avoid_: tape, trades

**Trade book** (TB):
Regular-board volume traded at each price over one session.
_Avoid_: volume profile

**Closing order book** (OB):
The orders resting on the book at one session's close, not a live book.
_Avoid_: depth, order book, closing book

**Block**:
One Done detail row for a regular-board order, with its fills. Not an off-board trade, which has a row of its own.
_Avoid_: big order, trade

### Signals

**Signal**:
A ticker that crossed one of five unusual-activity rules on the latest session or report date.
_Avoid_: alert, event, trigger

**ARA**:
A signal for a close at or above the ticker's auto-rejection upper band.
_Avoid_: limit up

**Volume spike**:
A signal for volume at least five times the ticker's average over the previous 20 sessions, with at least IDR 5B traded.
_Avoid_: VOL (except as a Signals filter), unusual volume

**Foreign streak**:
A signal for at least seven sessions of net foreign buying, totaling at least 3% of value traded.
_Avoid_: FGN (except as a Signals filter), foreign buying

**Green on red**:
A signal for a ticker that closed up in a session when IHSG fell 2% or more, with at least IDR 1B traded.
_Avoid_: RS (except as a Signals filter), relative strength

**5% change**:
A signal for a 5% holder that changed their percentage or exited. The Ticker page lists them as ownership changes.
_Avoid_: insider move

### Market

**IHSG**:
The IDX Composite Index.
_Avoid_: JCI, composite, index

**Board**:
One of the IDX Regular, Negotiation or Cash markets. All boards is their sum.
_Avoid_: market (for a board), segment

**Domestic client** / **Foreign client**:
Where the client behind a broker's trade is based. Not where the broker is owned.
_Avoid_: local broker, foreign broker

**Broker ownership**:
Whether a broker firm is domestic-owned, foreign-owned or state-owned, which colours its code in broker functions. Not where its clients are based.
_Avoid_: local broker, broker type

**UMA**:
An IDX notice of unusual market activity in a ticker. A risk flag, not a signal.
_Avoid_: unusual activity alert

**FCA**:
The IDX notation for a ticker on the full call auction board.
_Avoid_: X notation

**5% holder**:
A shareholder at or above 5%, from IDX daily reports.
_Avoid_: major holder, insider, whale

**1% holder**:
A shareholder at or above 1%, from IDX monthly files.
_Avoid_: minor holder

**Insider report**:
A KSEI filing, not a 5% holder report, that names a reporter and their shares before and after a change. Its net change feeds ownership changes on the Ticker page.
_Avoid_: insider trade, insider buying

**Registry**:
A month-end report from the share registrar with free float, shareholder count and investor types. Not the 1% holder files.
_Avoid_: registrar report

**Broker data**:
Stockbit's per-broker trading activity, shown only after sign-in.
_Avoid_: broker flow (that is a Terminal function), bandarmology

### Data

**Ingest**:
The daily job that fetches IDX prices, indices, issuers, holders and filings.
_Avoid_: pipeline, scrape, sync

**Collector**:
The run that fetches broker data, running trades and closing order books from Stockbit. Only one may run at a time.
_Avoid_: scraper, broker job, crawler

**Collector host**:
A machine that runs the collector in place of GitHub Actions.
_Avoid_: server, local collector

**Run marker**:
The record that a collector run holds until it ends or expires, which keeps a second run out.
_Avoid_: lock, mutex

**Day-board**:
One session on one board. It is complete once every listed broker's domestic and foreign activity is fetched.
_Avoid_: day

**Coverage**:
The record of which day-boards the collector has completed.
_Avoid_: progress, checkpoint

**Dispatch**:
The Cloudflare Worker that starts ingest daily and a collector run whenever none is active.
_Avoid_: cron, scheduler

**Feeds**:
The job that publishes market news and the economic calendar and keeps the news archive, on a 15-minute schedule.
_Avoid_: feed (alone), news job, RSS

**News archive**:
Every Indonesian market article Feeds has read, kept by month with the tickers each names. Ticker news comes from it, so a date range reaches back only to the day the archive began or its backfill reached.
_Avoid_: news history, news database

**Ticker card**:
The price image shown when a Ticker page link is shared.
_Avoid_: share card, OG image, preview, thumbnail
