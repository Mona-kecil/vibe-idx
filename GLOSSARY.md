# vibe-idx

A daily radar for the Indonesia Stock Exchange (IDX). It finds tickers with unusual price, volume, foreign or ownership activity, then shows who holds and who trades each one.

Site sections take their heading as their name. Terminal functions take their code. When a Site section and a Terminal function cover the same thing, each entry names its twin. The Site twin usually shows less.

## Language

### Views

**View**:
The Site or the Terminal.
_Avoid_: app, frontend, side

**Site**:
The pages for reading at a glance, on any screen: Today, Market, Ticker page and Login. Not the Terminal.
_Avoid_: non-terminal, web, website, main app

**Terminal**:
The desktop view of panes for studying one ticker in depth. It is not available on phones.
_Avoid_: workspace, pro mode, dashboard, app

**Ticker**:
A listed company, named by its four-letter IDX code.
_Avoid_: symbol, emiten, issuer code

**Watchlist**:
The one list of tickers the user has pinned, shared by the Site and the Terminal. Not a section or a function.
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
An IDX suspension, UMA notice or notation on a ticker. RISK lists them for all tickers.
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
The Site page for one ticker: price chart, stats, ownership, timeline and broker summary.
_Avoid_: stock page, company page, detail page

**Search**:
The Site header box that finds a ticker by code or company name. Not the command bar.
_Avoid_: lookup, finder

**Pulse**:
The Today strip with IHSG, breadth, estimated foreign flow and source dates. The Terminal's twin is the status bar.
_Avoid_: market summary, header stats

**Today watchlist**:
The Today section with one row per pinned ticker, shown only when something is pinned. Its heading reads "Watchlist". The Terminal's twin is WL.
_Avoid_: favorites

**Most traded**:
The Today heatmap of the 50 tickers with the highest value traded, 20 on phones, colored by daily change. The Terminal's twin is HEAT.
_Avoid_: treemap

**Signal tile**:
A Today card for one signal kind with its ticker count and three strongest tickers. Not a heatmap tile. The Terminal's twin is SIG.
_Avoid_: signal card, alert tile

**This week**:
The Today strip of the next five weekdays with high-impact economic events and corporate action dates.
_Avoid_: calendar, upcoming

**News**:
The Today section of the latest Indonesian market headlines, grouped by day. The Terminal's twin is NEWS, which also covers world and ticker news.
_Avoid_: headlines, feed

**Sort chip**:
A Market button that ranks the table: Gainers, Losers, Value, Foreign buy or Foreign sell.
_Avoid_: filter, lens

**Period**:
The 1d, 3d or 5d window that Market and MOV rank over. Not a selection.
_Avoid_: range, window, timeframe

**Accumulation**:
The signed-in Market column: the top net-buying broker's net shares as a share of volume over the period. It does not identify the investor behind the broker.
_Avoid_: bandar score, smart money

**Lens**:
A Market tab that keeps only the tickers with one signal kind. All shows every ticker. A kind with no tickers is hidden unless its lens is selected.
_Avoid_: filter tab, signal filter

**Price chart**:
The Ticker page chart of price and volume, with net foreign overlays and chart marks. The Terminal's twin is GP.
_Avoid_: graph, candles

**Chart mark**:
A lettered badge on a price chart for a filing, a 5% change or a corporate action date.
_Avoid_: event badge, pin, marker

**Stats**:
The Ticker page figures under the price chart, with the rest behind More. Price and change sit in the page header instead. The Terminal's twin is KEY.
_Avoid_: key figures, fundamentals

**Ownership**:
The Ticker page section with 5% holders, ownership changes and holdings over time. The Terminal's twin is HDS.
_Avoid_: holders section, shareholders

**Timeline**:
The Ticker page list of IDX filings and ticker news, newest first. It has no corporate action dates. The Terminal's twin is FEED.
_Avoid_: feed, disclosures

**Broker summary**:
The Ticker page section with buyers and sellers by broker over the selection. The Terminal's twin is BRK.
_Avoid_: broker table

**Action chip**:
The Ticker page header badge for the next corporate action within 30 days.
_Avoid_: event badge, action tag

**Void**:
The glitch that swallows the Site when you open the Terminal.
_Avoid_: glitch transition, corruption

**Boot**:
The void clearing once the Terminal has loaded.
_Avoid_: loading screen, splash

### Terminal

**Mode**:
One of GRID, FOCUS or FLOW, each a fixed arrangement of panes for one job.
_Avoid_: layout, view, screen

**GRID**:
The mode for finding a ticker.
_Avoid_: overview, home mode

**FOCUS**:
The mode for studying one company: price, holders and its company feed.
_Avoid_: detail mode, company mode

**FLOW**:
The mode for seeing who trades one ticker: foreign flow, brokers, orders and fills.
_Avoid_: live, trading mode

**Pane**:
One box in a mode, showing one function at a time. "The FF pane" means the pane showing FF.
_Avoid_: panel, widget, window, card

**Slot**:
A fixed position in a mode that holds one pane and its tabs.
_Avoid_: cell, area, region

**Tab**:
One function's button in a pane that holds several functions.
_Avoid_: tab for a mode or a lens

**Function**:
What a pane shows, named by a two- to four-letter code and opened from a tab or the command bar.
_Avoid_: widget, view, shortcut

**Command bar**:
The Terminal input that takes a ticker, a function, a mode, HELP or PIN.
_Avoid_: search, omnibox, prompt

**Status bar**:
The Terminal's bottom line with the trading phase, IHSG, breadth, estimated foreign flow and the next high-impact event. The Site's twin is Pulse.
_Avoid_: footer

**Trading phase**:
Where the exchange is in its day, in Jakarta time: PRE-OPEN, SESSION 1, BREAK, SESSION 2, PRE-CLOSE or CLOSED.
_Avoid_: session (for a phase), market hours

**Timeframe**:
The bar size on GP: W, D, 4H, 1H or 15M. Not a selection or a period.
_Avoid_: interval, resolution, range

**Hillclimb**:
The measured count of steps a person needs to answer the Terminal's daily questions.
_Avoid_: benchmark, usability score

### Functions

**WL** (Watchlist):
The pinned tickers as quote rows. The Site's twin is Today watchlist.
_Avoid_: watchlist pane

**SIG** (Signals feed):
Every signal, grouped by date. The Site's twin is the signal tiles.
_Avoid_: alerts

**HEAT** (Heatmap by value):
The heatmap of the 60 tickers with the highest value traded. The Site's twin is Most traded.
_Avoid_: treemap

**MOV** (Market movers):
The top movers by change and by value traded, side by side.
_Avoid_: gainers

**NEWS**:
Headlines for Indonesia, the world or the current ticker. The Site's twin is News.
_Avoid_: feed

**CA** (Corporate actions):
Corporate actions such as dividends, rights issues and shareholder meetings.
_Avoid_: actions, events

**CAL** (Economic calendar):
Economic events by date and impact.
_Avoid_: macro, events

**RISK** (Risk flags):
Risk flags across all tickers.
_Avoid_: risk badge

**GP** (Price history):
The Terminal price and volume chart, in any timeframe down to 15 minutes. Shift-drag sets the selection. The Site's twin is the price chart.
_Avoid_: chart, price pane

**KEY** (Key figures):
The latest price, trading and registry figures for one ticker. The Site's twin is stats.
_Avoid_: description, fundamentals

**HDS** (Holders and changes):
One ticker's holders at 1% and above over time, with each 5% holder's changes. The Site's twin is ownership.
_Avoid_: holders, ownership pane

**DISC** (IDX disclosures):
IDX filings for one ticker.
_Avoid_: filings pane

**FEED** (Company feed):
One dated list of a ticker's filings, news and corporate action dates, upcoming actions first. The Site's twin is Timeline, which has no actions.
_Avoid_: timeline

**BRK** (Broker summary):
Net or gross buyers and sellers by broker over a period. The Site's twin is Broker summary on the Ticker page.
_Avoid_: broker flow, broker table

**BFL** (Broker flow):
Each chosen broker's net buying, summed from zero across the selection or flow period. Not the broker's total holding. It has no Site twin.
_Avoid_: broker summary, accumulation chart

**FF** (Foreign flow):
Daily net buying by foreign clients and its running total, from broker data.
_Avoid_: foreign estimate (that is the IDX figure in Pulse and the status bar)

**DD** (Done detail):
One session's blocks, plus each off-board trade as its own row. A block drills into its fills in RT.
_Avoid_: big orders

**RT** (Running trade):
One session's individual fills.
_Avoid_: tape, trades

**TB** (Trade book):
Regular-board volume traded at each price over one session.
_Avoid_: volume profile

**OB** (Closing order book):
The orders resting on the book at one session's close.
_Avoid_: depth, closing book

**Block**:
One DD row for a regular-board order, with its fills. Not an off-board trade, which has a row of its own.
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
_Avoid_: VOL (except in SIG), unusual volume

**Foreign streak**:
A signal for at least seven sessions of net foreign buying, totaling at least 3% of value traded.
_Avoid_: FGN (except in SIG), foreign buying

**Green on red**:
A signal for a ticker that closed up in a session when IHSG fell 2% or more, with at least IDR 1B traded.
_Avoid_: RS (except in SIG), relative strength

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
A KSEI filing that names a reporter and their shares before and after a change. Its net change feeds ownership changes on the Ticker page. Not a 5% holder report.
_Avoid_: insider trade, insider buying

**Registry**:
A month-end report from the share registrar with free float, shareholder count and investor types. Not the 1% holder files.
_Avoid_: registrar report

**Broker data**:
Stockbit's per-broker trading activity, shown only after sign-in.
_Avoid_: broker flow, bandarmology

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
The job that publishes market news and the economic calendar every 15 minutes.
_Avoid_: feed (alone), news job, RSS

**Ticker card**:
The price image shown when a Ticker page link is shared.
_Avoid_: share card, OG image, preview, thumbnail
