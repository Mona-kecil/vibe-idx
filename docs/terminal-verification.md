# Terminal verification

Verified on 9 November 2026 against the local `terminal-prototype` branch. The prototype ran from its existing worktree on port 5178. The React implementation ran on port 5177. Both used published public data. The prototype's tracked files and branch were left unchanged.

The browser comparison used matching 1440×900 desktop and 390×844 phone viewports. The desktop frame preserves the prototype's pane proportions, colors, typography, and tab codes. The phone layout preserves the chart-first stacking order.

The following checks ran in the real browser:

| Behavior | Result |
| --- | --- |
| `/terminal?t=BREN&l=focus` | Opens BREN in the two-pane focus layout. |
| Grid, focus, and live layout buttons | Show six, two, and four panes. The URL records the layout. |
| Layout keys 2 and 3 | Switch layouts while the command input is empty. |
| Slash shortcut, ticker suggestion, Tab, and Enter | Focus the command input, complete BBCA, and select the ticker. |
| `BBCA DES` and `FOCUS BREN DES` | Select the ticker, open its description, and combine a layout command with a function. |
| Pane tabs | Open price history, description, ownership, disclosures, movers, signals, heatmap, news, calendar, actions, and risk. |
| Pane resize | Pointer drag changes widths. Keyboard arrows change widths. Double-click restores the defaults. Sizes persist in local storage. |
| Desktop maximize | Fills the workspace. Restore and Escape return to the layout. |
| Phone maximize | Fills the 390×844 viewport. Restore returns to the stacked layout. |
| Phone grid, focus, and live | Stack panes without horizontal page overflow. Grid order is chart, watchlist, news, movers, brokers, and ownership. |
| Movers | Gain and loss filters change the rows. Changing the filter resets a scrolled pane to the top. |
| Signals | The volume filter restricts the feed to volume signals. |
| Heatmap | Tiles reflect published trading value. Selecting a tile changes the linked ticker. |
| Disclosures | Published records and external document links appear. |
| Price period | 1M changes the chart window. Incomplete historical OHLC uses the close-price area series. |
| Price date selection | Pointer events in the browser select dates and draw the selection band. The shared range records 7 October through 19 October for the checked BBCA window. |
| Chart attribution | The TradingView link sits below the chart canvas and foreign-flow bars. |
| Ticker news | Uses the existing `/api/news` endpoint and returns headlines. |
| News reader | Opens and closes with Escape. Shows an unavailable summary when the API item has no summary. Provides the original link and makes no article request. |
| Missing publications | News, calendar, corporate actions, and risk show plain unavailable states for the current 404 responses. Switching filters does not poll the files. React Strict Mode aborts its initial development-only requests. |
| Signed-out broker panes | Offer sign-in and do not fetch private broker data. |
| Status bar | Displays the WIB clock, IHSG close and change, sparkline, breadth, estimated foreign flow, and the EOD date. |
| Keyboard reference | Opens and closes. Links the TradingView notice and Apache-2.0 license. |

Automated verification uses these commands:

```sh
pnpm exec vp check --fix apps/web
pnpm --filter @vibe-idx/web exec tsc --noEmit
pnpm --filter @vibe-idx/web test
pnpm --filter @vibe-idx/web build
```

All 64 web tests pass. The original 47 remain passing. The tests cover raw producer output and dated envelopes, dividend amounts, invalid data, unavailable files, authenticated broker reads, layout changes, ticker links, scroll reset, sign-in return URLs, and summary-only news. Broker component tests cover board, broker type, net and gross modes, lot units, paired gross rows, and muted edge prices. Calculation tests cover cumulative value and lot flows.

The prototype differences are deliberate:

- Intraday, order book, running trade, and simulated updates are removed. Live uses the daily chart, calendar, broker panes, and news.
- An empty watchlist stays empty and links to the site's pins. The prototype fills it with top-value stocks.
- The reader uses the item's own summary and original link. It does not scrape articles.
- News, calendar, actions, and risk use published JSON. The prototype's on-demand `/proto` feeds are removed.
- Chart controls sit immediately below the pane header and can wrap on phones. Repeated company names and secondary labels are removed.
- TradingView attribution sits below each chart. The prototype places a cloned logo over the plot.
- Maximize remains available on phones and fills the viewport.
- The status bar identifies its session label as the weekday schedule. Holidays are not inferred from the clock.

Live authenticated broker rendering and the WorkOS callback were not verified in the browser because the local session was signed out. Component and API tests cover broker access and return URLs. Published calendar, actions, and risk contents could not be compared in the browser while their files returned 404. Their adapters use the shared action and risk schemas from the merged producer PR. No deployment, R2 write, or article download ran.
