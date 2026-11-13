# Terminal hillclimb

Counts the steps the Terminal takes to answer a fixed list of daily questions. Lower is better. The total was 181 at the start and 86 on 11 November 2026.

## Run

```sh
pnpm --filter @vibe-idx/web hillclimb
```

It prints steps per question for each ticker and window, the total, the count of questions answered, the error count, and the visible controls on each mode's default screen.

- `--verbose` prints each step.
- `--repeat 3` checks that the total repeats.
- `--shots <dir>` saves each mode's default screen for SINI.
- `--record` fills missing responses from live public data and the private bucket copy in `~/.cache/vibe-idx/fixtures`. Re-recording sets a new baseline.

The harness starts the dev server with a stub sign-in and replays every request from `~/.cache/vibe-idx/hillclimb`, so no request leaves the machine. That store holds private broker data and running trades, so it stays out of the repository. Copy the directory to run on another machine.

## Metric

The total is the step count summed over three tickers and three windows. A step is one tab switch, mode switch, command, click or screen of scrolling. An answer already visible when its question starts costs nothing.

The questions run in order, one run per ticker and window, starting from GRID, and the screen carries over between questions. To bring a pane on screen, the harness takes the cheapest route: nothing if it is showing, otherwise one step for a tab in this mode, a mode where it already shows, or the command bar. Scrolling counts the screens needed to bring every target's text and drawings into view, per scroll container. A target no scrolling can reveal is an error.

- **Clock:** frozen at 11 November 2026 12:28 WIB, with broker data and running trades through 10 November.
- **Tickers:** SINI (13 holder blocks), BBCA (6) and UNVR (3). The Watchlist holds eight Pins.
- **Windows:** a maximized browser at 1728 by 1000 (16 inch laptop), 1920 by 960 (24 inch monitor) and 2560 by 1320 (27 inch monitor).

## Questions

A pane that answers none of these leaves the default slots. `questions.ts` scripts the path to each answer. The paths change with the UI, but the answers they must reach do not.

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

## Rules for a change

- Make one change per attempt, measure it, then keep or revert it.
- `vp test` and `vp check` stay green. Run the tests with `NODE_OPTIONS=--no-experimental-webstorage`. Node's built-in `localStorage` breaks happy-dom on Node 24.22 and 26.
- Font size and row height stay fixed, so shrinking text cannot count as a win.
- Visible controls per item never rise, and no new kind of control appears. A count that rises only because more items fit is allowed.
- Take a before and after screenshot of each kept change. Steps cannot measure legibility, so the owner can veto any change.

## Untried ideas

- A click on an FF or GP day sets the Session.
- One broker filter shared across panes.
- A price line on FF, with one zero for the bars and the running total.
- TB and OB as one ladder.
- Picking a ticker in GRID jumps to FOCUS. This saves a keypress, but you can no longer arrow through the Watchlist with the chart in view.
