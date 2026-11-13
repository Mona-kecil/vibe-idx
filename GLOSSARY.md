# vibe-idx

A daily radar for the Indonesia Stock Exchange (IDX). It finds stocks with unusual price, volume, foreign or ownership activity, then shows who holds and who trades each one.

## Language

### Views

**Site**:
The pages for reading at a glance, on any screen: Today, Market, Ticker and Login. Not the Terminal.
_Avoid_: non-terminal, web, website, main app

**Terminal**:
The desktop workspace of panes for studying one ticker in depth. It is not available on phones.
_Avoid_: pro mode, dashboard, app

**Watchlist**:
The one list of tickers the user has pinned, shared by the Site and the Terminal. Not a section or a pane.
_Avoid_: favorites, portfolio, saved stocks

**Pin**:
To add a ticker to the watchlist.
_Avoid_: star, favorite, bookmark, follow

### Site

**Today**:
The Site's front page: market pulse, Today watchlist, Most traded, signal tiles, This week and news.
_Avoid_: Home, homepage, dashboard

**Market**:
The Site page that lists every stock in one sortable table, narrowed by a lens.
_Avoid_: screener, stock list, market page

**Ticker**:
The Site page for one company: price chart, ownership, timeline and broker summary.
_Avoid_: stock page, company page, detail page

**Pulse**:
The Today strip with IHSG, breadth, estimated foreign flow and source dates.
_Avoid_: market summary, header stats

**Today watchlist**:
The Today section with one row per pinned ticker. Not the watchlist itself.
_Avoid_: Watchlist (for the section), favorites

**Most traded**:
The Today heatmap of the stocks with the highest value traded, colored by daily change.
_Avoid_: heatmap (ambiguous with HEAT), treemap

**Signal tile**:
A Today card for one signal kind with its stock count and strongest stocks.
_Avoid_: signal card, alert tile

**This week**:
The Today section with high-impact economic events and corporate action dates in the next seven days.
_Avoid_: calendar, upcoming

**Lens**:
A Market tab that keeps only the stocks with one signal kind.
_Avoid_: filter tab, signal filter

**Selection**:
A day or date range picked on the Ticker price chart, which narrows the sections below it.
_Avoid_: range, brush, highlight

**Timeline**:
The Ticker list of IDX filings and ticker news, newest first. It has no corporate action dates.
_Avoid_: feed, news, disclosures

**Broker summary**:
Net or gross buyers and sellers by broker over a period. It is the BRK pane in the Terminal and a section on Ticker.
_Avoid_: broker flow (for this view), broker table

**Action chip**:
The Ticker header badge for the next corporate action within 30 days.
_Avoid_: event badge, action tag

**Risk badge**:
The SUSP, UMA and notation chips for one ticker, from IDX notices.
_Avoid_: warning, risk tag, flags

**Stale**:
The state of a source that missed its expected update.
_Avoid_: outdated, old data, delayed

**Void**:
The glitch that swallows the Site when you open the Terminal.
_Avoid_: glitch transition, corruption

**Boot**:
The void clearing once the Terminal has loaded.
_Avoid_: loading screen, splash

### Terminal

**Mode**:
One of GRID, FOCUS or FLOW, each a fixed arrangement of panes for one job.
_Avoid_: layout, view, tab, screen

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
One box in a mode that shows one function at a time.
_Avoid_: panel, widget, window, card

**Slot**:
A fixed position in a mode that holds one pane and its stacked function codes.
_Avoid_: cell, area, region

**Function code**:
The two- to four-letter name of a Terminal view, typed in the command bar.
_Avoid_: function, command, shortcut

**Command bar**:
The Terminal input that takes a ticker or a function code.
_Avoid_: search, omnibox, prompt

**Hillclimb**:
The measured count of steps a person needs to answer the Terminal's daily questions.
_Avoid_: benchmark, usability score

### Function codes

**WL**:
The pinned tickers as quote rows in the Terminal.
_Avoid_: Watchlist (for the pane)

**SIG**:
Every signal, grouped by date.
_Avoid_: signals feed, alerts

**HEAT**:
The Terminal heatmap of the stocks with the highest value traded.
_Avoid_: Most traded (for the pane), treemap

**MOV**:
The top movers by change and by value traded, side by side.
_Avoid_: movers, gainers

**NEWS**:
Headlines for Indonesia, the world or the current ticker.
_Avoid_: feed

**CA**:
Corporate actions such as dividends, rights issues and shareholder meetings.
_Avoid_: actions, events

**CAL**:
The economic calendar.
_Avoid_: calendar events, macro

**RISK**:
Suspensions, UMA notices and notations across all tickers.
_Avoid_: risk flags (for the pane)

**GP**:
The Terminal price and volume chart.
_Avoid_: chart, price pane

**KEY**:
The latest price, trading and registry figures for one ticker.
_Avoid_: description, fundamentals, stats

**HDS**:
The 5% holders of one ticker and how their holdings changed.
_Avoid_: holders, ownership

**DISC**:
IDX filings for one ticker.
_Avoid_: disclosures, filings pane

**FEED**:
One dated list of a company's filings, ticker news and corporate action dates.
_Avoid_: company feed, timeline

**BRK**:
See broker summary.
_Avoid_: broker flow (for this view)

**BFL**:
Each chosen broker's running net position over time.
_Avoid_: broker summary, accumulation chart

**FF**:
Daily net buying by foreign clients and its running total, from broker data.
_Avoid_: foreign estimate (that is the IDX figure in Pulse)

**DD**:
One session's largest orders, each of which drills into its fills.
_Avoid_: done detail, big orders

**RT**:
One session's individual fills.
_Avoid_: running trade, tape, trades

**TB**:
Volume traded at each price over one session.
_Avoid_: trade book, volume profile

**OB**:
The orders resting on the book at one session's close.
_Avoid_: order book, depth, closing book

### Signals

**Signal**:
A stock that crossed one of five unusual-activity rules on the latest session or report date.
_Avoid_: alert, event, trigger

**ARA**:
A signal for a close at or above the stock's auto-rejection upper band.
_Avoid_: limit up

**Volume spike**:
A signal for volume at least five times the stock's average, with at least IDR 5B traded.
_Avoid_: VOL (except in SIG), unusual volume

**Foreign streak**:
A signal for at least seven days of net foreign buying, totaling at least 3% of value traded.
_Avoid_: FGN (except in SIG), foreign buying

**Green on red**:
A signal for a stock that closed up on a day IHSG fell 2% or more, with at least IDR 1B traded.
_Avoid_: RS, relative strength

**5% change**:
A signal for a 5% holder that changed their percentage or exited.
_Avoid_: ownership change, insider move

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
An IDX notice of unusual market activity in a stock. Not a signal.
_Avoid_: unusual activity alert

**FCA**:
The IDX notation for a stock on the full call auction board.
_Avoid_: X notation

**5% holder**:
A shareholder at or above 5%, from IDX daily reports.
_Avoid_: major holder, insider, whale

**1% holder**:
A shareholder at or above 1%, from IDX monthly files.
_Avoid_: Registry (UI label), minor holder

**Broker data**:
Stockbit's per-broker trading activity, shown only after sign-in.
_Avoid_: broker summary (for the data), bandarmology

### Data

**Ingest**:
The daily batch that fetches IDX prices, indices, issuers, holders and filings.
_Avoid_: pipeline, scrape, sync

**Collector**:
The run that fetches broker data and ticks from Stockbit. Only one may run at a time.
_Avoid_: scraper, broker job, crawler

**Collector host**:
A machine that runs the collector in place of GitHub Actions.
_Avoid_: server, local collector

**Run marker**:
The record that a collector run holds until it ends or expires, which keeps a second run out.
_Avoid_: lock, mutex

**Day-board**:
One trading date on one board. It is complete once every listed broker's domestic and foreign activity is fetched.
_Avoid_: session, day

**Coverage**:
The record of which day-boards the collector has completed.
_Avoid_: progress, checkpoint

**Dispatch**:
The scheduler that starts ingest daily and a collector run whenever none is active.
_Avoid_: cron, scheduler

**Feeds**:
The job that publishes market news and the economic calendar every 15 minutes.
_Avoid_: news job, RSS

**Share card**:
The price image shown when a Ticker link is shared.
_Avoid_: OG image, preview, thumbnail
