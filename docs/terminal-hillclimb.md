# Terminal UI hillclimb plan

Status on 11 November 2026: the baseline is 181 steps and the total is now 113, after attempts 1 to 6, 11 and 12. The owner confirmed the question list and the stop.

## Goal

Every pane on screen earns its space. A pane answers its question in one viewport, and the default screens hold only panes that answer a daily question.

## Why the terminal feels full

The default grid runs two jobs on one screen: finding a ticker and studying one.

- Market-wide panes (WL, MOV, NEWS) take about 40% of the area, computed from the default split sizes in `apps/web/src/terminal/Layout.tsx`. They say nothing about the ticker under study.
- HDS gets about 15% of the area and shows two holders. SINI's public file has up to 13 distinct holders, so the pane needs about six screens.
- 13 of the 19 functions sit behind tabs. FOCUS puts 13 tabs in one pane.
- The three modes repeat the same panes in different arrangements. BRK, BFL, FF, RT and DD appear in all three.

## What makes a pane good

1. A pane answers its question in one viewport. Scrolling is for history.
2. Two views merge when one drills into the other, as RT rows are the fills of a DD order. Turning sibling tabs into modes of one pane saves no clicks.
3. Context carries across panes. Ticker, chart range and trade session already carry. The broker filter and a clicked date do not.

## Pane verdicts

The app has no usage tracking, so these are judgments against the question list below.

| Pane                   | Verdict                | Reason                                                                         |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------------ |
| GP, BRK, BFL, FF, DISC | Keep                   | Each answers a different ticker question.                                      |
| HDS                    | Keep, as rows          | One row per holder with a sparkline and the change over the range.             |
| RT, DD                 | Merge                  | Same trades. An order expands into its fills.                                  |
| TB, OB                 | Keep, test one ladder  | Both are per-price views of one session.                                       |
| KEY                    | Fold into GP           | It spends a pane on ten figures, and GP's legend row is empty until hover.     |
| WL, SIG, MOV, NEWS, CA | Keep in GRID           | They pick the ticker. NEWS and CA use their ticker filter in FOCUS.            |
| HEAT                   | Off the default slots  | It is MOV sorted by value, drawn as tiles.                                     |
| CAL                    | Off the default slots  | The status bar already names the next high-impact event.                       |
| RISK                   | Off the default slots  | Every ticker pane header already shows that ticker's flags.                    |

A pane off the default slots still opens when its code is typed in the command bar.

## One job per mode

| Mode  | Job                   | Questions    | Panes                                                                              |
| ----- | --------------------- | ------------ | ---------------------------------------------------------------------------------- |
| GRID  | Find a ticker         | 1 to 3       | WL, SIG, MOV, NEWS with CA                                                         |
| FOCUS | Study the company     | 4, 5, 11, 12 | GP over HDS, then one feed of disclosures, ticker news and action dates          |
| FLOW  | See who is trading it | 6 to 10      | GP above FF, BRK, BFL and TB, then DD in a full-height column, then OB with RT   |

GP stays in FLOW because shift-dragging it sets the date range for the broker panes. Views read together never share a pane: GP and FF, DD and RT, TB and OB. GP keeps enough height to read candles, and RT and DD get tall columns, because a tape needs height more than width.

Open behavior to test: whether picking a ticker in GRID should jump to FOCUS. It saves a keypress, but it stops arrowing through the watchlist with the chart in view.

## Metric

Total steps to answer the question list, summed over three tickers and three window sizes. Lower is better. A step is one tab switch, mode switch, command, click, or screen of scrolling. An answer visible when its question starts costs zero.

The questions run in order in one session per ticker and window, starting from GRID, and the screen carries from one question to the next. To bring a pane on screen, the harness takes the cheapest route: nothing if it is showing, otherwise one step for a tab in this mode, a mode where it already shows, or the command bar. Scrolling is counted per scroll container as the screens needed to bring every target into view, measured on the text and drawings of each target rather than its box, so a short table row in a wide table does not count as clipped. A target that no scrolling can reveal is an error.

## Question list

A pane that answers none of these leaves the default slots.

1. Which tickers fired a signal today?
2. What moved most, by change and by value?
3. How are my pinned tickers doing?
4. What did price and volume do over the period?
5. Who holds it, and who changed their holding?
6. Which brokers were net buyers and sellers?
7. Are the top brokers accumulating or distributing over time?
8. Are foreigners buying or selling, and does price agree?
9. What were a day's largest orders, and their fills?
10. At which prices did volume trade, and what rested on the book at close?
11. What has the company disclosed?
12. What is its news, and which corporate action dates are coming?

## Measurement

`pnpm --filter @vibe-idx/web hillclimb` prints steps per question for each ticker and window, the total, the count of questions answered, the error count, and the visible controls on each mode's default screen. `--verbose` prints each step, `--repeat 3` checks the total repeats, and `--shots <dir>` saves each mode's default screen for SINI.

The harness lives in `apps/web/hillclimb`. It starts the dev server with a stub sign-in and replays every request from a store in `~/.cache/vibe-idx/hillclimb`, so no request leaves the machine. The store holds private broker and tick data, so it stays out of this public repository. To run on another machine, copy that directory. `--record` fills misses from live public data and from the private bucket copy in `~/.cache/vibe-idx/fixtures`, and re-recording means a new baseline.

The clock is frozen at the recording time, 11 November 2026 12:28 WIB, with broker and tick data through 10 November. The tickers are SINI (13 holder blocks), BBCA (6) and UNVR (3), and the watchlist holds eight pins. The windows are a maximized browser on a 16 inch laptop at 1728 by 1000, a 24 inch monitor at 1920 by 960, and a 27 inch monitor at 2560 by 1320.

Sensitivity holds: HDS costs SINI 5, 5 and 3 screens of scrolling, BBCA 2, 2 and 1, and UNVR 1, 1 and 0.

## Baseline

181 steps, the same in three runs, with all 108 answers reached and no errors. Tab switches account for 81 steps, scrolling for 64, and clicks for 36.

| Question | Steps | Where they go |
| --- | --- | --- |
| 12 News and action dates | 40 | NEWS and CA each need a tab and a ticker filter. |
| 1 Signals today | 36 | SIG lists 3 rows from 10 November, 55 from 9 November, then 22 more from 10 November. |
| 10 Volume at price and book | 23 | TB and OB are tabs in one slot, and SINI's 40 price levels scroll. |
| 5 Holders | 20 | HDS scrolls, most for SINI on the smaller screens. |
| 9 Largest orders and fills | 18 | A DD tab and a click to expand the order. |
| 11 Disclosures | 17 | A DISC tab, and ten rows scroll in most windows. |
| 2, 7, 8 | 9 each | One click or tab each. |
| 3, 4, 6 | 0 | WL, GP and BRK show on load. |

Visible controls on the default screens: GRID 109 to 125, FOCUS 51 to 56, FLOW 67 to 74, depending on the window.

## Guards

- `vp test` and `vp check` stay green. Run the tests on Node 24, because Node 26's built-in `localStorage` breaks 55 tests under happy-dom even on a clean master.
- Font size and row height stay fixed, so shrinking text cannot count as a win.
- Visible controls per item never rise, and no new kind of control appears. A count that rises only because more items now fit on screen is allowed.
- Each kept change gets a before and after screenshot. Steps cannot see legibility, so the owner can veto any change.

## Stop

Total steps at most 90, which is at least 50% below the baseline of 181, after at least 10 logged attempts.

## Attempts

One change each, measured, then kept or reverted, with one commit per kept change. Each attempt is logged in `apps/web/hillclimb/decision.tsv`, which git ignores, with its hypothesis, before, after, test result and verdict. Removals come first, so later changes are measured on the simpler screen.

1. Kept, 181 to 172. Give each mode one job, per the table above.
2. Kept, 172. Take HEAT, CAL and RISK off the default slots.
3. Kept, 172. Fold KEY into the panes that already show its facts. The registry facts head HDS, and the company name sits in GP's header, because GP's legend row already shows the latest bar.
4. Kept, 172 to 165. Rebuild HDS. The owner compared rows with sparklines, one chart for all holders, and 100% ownership bars, and chose one chart on a log scale with a holder list below it.
5. Kept, 165 to 168. The owner rejected the first FLOW and designed the one in the table above.
6. Kept, 168 to 177. Link DD to RT instead of merging them. DD and RT share columns, a DD row drills into its highlighted fills in RT, and RT heads them with a counterparty summary. The owner chose to keep RT in front after a drill-down, which costs question 10 a tab.
7. Make a click on an FF or GP day set the trade session.
8. Share one broker filter across panes.
9. Give FF a price line and a common zero for bars and running total.
10. Test TB and OB as one ladder.
11. Kept, 159 to 113. One dated feed per ticker replaces DISC, ticker NEWS and ticker CA in FOCUS, with upcoming actions first. FOCUS puts a wide GP over HDS, with the feed in its own column.
12. Kept, 177 to 159. Order SIG by date, so one day's signals sit together. The baseline added this one.
