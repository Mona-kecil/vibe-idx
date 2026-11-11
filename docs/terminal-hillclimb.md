# Terminal UI hillclimb plan

Status on 11 November 2026: planned only. Nothing is built or measured. The stop numbers and the question list are proposals awaiting confirmation.

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
| FOCUS | Study the company     | 4, 5, 11, 12 | GP with KEY folded in, HDS as rows, one feed of DISC, ticker news and action dates |
| FLOW  | See who is trading it | 6 to 10      | A short GP, BRK, BFL with FF, the merged trades pane, TB with OB                   |

The short GP stays in FLOW because shift-dragging it sets the date range for the broker panes. The target is at most two tabs per pane.

Open behavior to test: whether picking a ticker in GRID should jump to FOCUS. It saves a keypress, but it stops arrowing through the watchlist with the chart in view.

## Metric

Total steps to answer a fixed question list. Lower is better. A step is one tab switch, mode switch, command, click, or screen of scrolling. An answer visible on load costs zero.

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

A Playwright script drives the dev server against frozen fixtures for three contrasting tickers: SINI (many holders), BBCA (heavy tape, about half foreign), and one with few holders. Broker and trade endpoints need a signed-in session, so the script stubs `/api` and `/data` from the fixtures.

The script prints steps per question, the total, the count of questions answered, the error count, and the count of visible controls on each default screen. The question list, fixtures, viewport and counting rule are frozen. The path for each question is rescripted when the UI changes and is reviewed with that change.

The viewport is fixed. It was inferred as roughly 1200 by 730 from a screenshot and needs the real window size.

Before freezing, prove sensitivity: the script must report more scrolling for SINI holders than for the few-holder ticker.

## Guards

- `vp test` and `vp check` stay green.
- Font size and row height stay fixed, so shrinking text cannot count as a win.
- The visible-control count never rises.
- Each kept change gets a before and after screenshot. Steps cannot see legibility, so the owner can veto any change.

## Stop

Total steps at least 50% below baseline, after at least 10 logged attempts.

## Attempts

One change each, measured, then kept or reverted, with one commit per kept change. Each attempt is logged in an uncommitted `decision.tsv` with its hypothesis, before, after, test result and verdict. Removals come first, so later changes are measured on the simpler screen.

1. Give each mode one job, per the table above.
2. Take HEAT, CAL and RISK off the default slots.
3. Fold KEY into the GP legend row.
4. Rebuild HDS as rows. Scale every sparkline the same way and show the change in points, because per-holder scaling draws a 1.5 point move as steep as an 18 point move.
5. Merge RT and DD. Decide how to show non-regular boards, which DD drops, and auction matches, which appear under both orders.
6. Make a click on an FF or GP day set the trade session.
7. Share one broker filter across panes.
8. Give FF a price line and a common zero for bars and running total.
9. Test TB and OB as one ladder.
10. Test one dated feed per ticker from DISC, ticker CA and ticker NEWS.

## Open inputs

- The real window size.
- Edits to the question list.
- Confirmation of the stop numbers.
