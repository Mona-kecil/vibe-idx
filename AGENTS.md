# Glossary

`GLOSSARY.md` holds this project's language. Read it before acting on a request that names a part of the product.

- If the user uses a term that conflicts with the glossary, or a word listed under `_Avoid_`, stop and name the conflict before you write code: "The glossary defines X as A, but you seem to mean B. Which is it?" Do not reinterpret silently.
- If the code contradicts the glossary, say so before changing either.
- When a term is settled, update `GLOSSARY.md` in the same change.
- Format: `**Term**:`, then one or two sentences on what it is, then `_Avoid_:` with the rejected synonyms. When multiple words exist for one concept, pick one and list the rest under `_Avoid_`.
- Add only terms specific to this project. Leave out general programming concepts and implementation details such as file paths, function names and storage keys.

# Design principles

## UI/UX

- Avoid unnecessary secondary labels and descriptions. Avoid UI separators such as the dot or slash or any other separator. Let the layout do the explaining.
- Every element must serve a clear user purpose; no slogans, decoration, nested cards, or repeated info.
- Show explanations only for abnormal states or required actions; put secondary details behind progressive disclosure.

Keep units, reporting dates, and material uncertainty where they affect interpretation. Put supporting source details in tooltips or source views instead of repeating them throughout the page.

Use charts for values that change over time. Keep exact values and source records available for inspection.

# Local data

Use these commands before writing one-off scripts over data files. They run the pipeline's and the API's own code, so what they show is what the app shows. Every command takes `--help`. They are safe to run at once, by several agents, on the same fixtures: none changes the fixture data except `pnpm fixtures`, which the others wait for or refuse to run alongside, so there is no need to copy the fixtures.

- `pnpm fixtures` copies the latest 10 sessions of running trade and the year's broker data from the private bucket, read-only, into `~/.cache/vibe-idx/local`. It then builds the files the app reads with the pipeline's publication code, including the market accumulation file the collector writes. Reruns skip finished work, publication code changes rebuild what they affect, and app files no current build writes are removed. `--latest` moves the window forward, `--sessions N` changes its length, and `VIBE_IDX_FIXTURES` moves the folder for every command below.
- `pnpm inspect` prints the fixture dates. `pnpm inspect brk <TICKER> [dates]` prints net buyers and sellers through the broker API, and `pnpm inspect rt <TICKER> [date]` summarises one session of running trade.

- `pnpm preview:local` runs the app on the fixtures, signed in, with broker data and running trade read only from them. It copies the public data once per fixture date, so prices and broker data describe the same session, records other API responses from production the first time they're asked for, and pins the browser clock to that session. `--offline` never reaches production: a response not recorded yet answers 503, and ui:check lists it. The panel at the bottom left sets the clock and signs in or out. A time during the session shows what production shows then: broker data, daily prices and the tick panes end the session before, and the session's running trade and order book answer 404 until the close, since the collector publishes them after it. Market-wide pages keep the as-of close.
- `pnpm ui:check [path]` opens a page in the same preview and prints console errors, failed requests, 404s and the page's accessibility outline. `--click`, `--fill`, `--clock`, `--signed-out`, `--within` and `--depth` reach a state and narrow the outline, `--shot` saves a screenshot cropped as `shots` crops, `--strict` also fails on 404s, and `--offline` works as in the preview. Check a UI change with it before taking screenshots.

- `pnpm shots <scenarios.ts> [--base <ref>]` shoots each scenario on this checkout and, with `--base`, on a temporary checkout of that ref, then writes before, after and side-by-side images with numbered red boxes placed by each note's selector, a diff image, the clean shots, and the numbered notes. The clock is frozen while shooting, so the side-by-side outlines in blue each region that actually changed, and a note whose selector matches nothing, or only something outside the scenario's panel, fails the run. A scenarios file can live anywhere; its types are in `apps/web/dev/scenario.ts`, and `apps/web/dev/shots/preview-panel.ts` is an example. With `--base` on a local branch behind its upstream, it warns that the comparison includes unmerged code. Use it for every UI change, with `--base origin/master` or the PR's base.

- `pnpm verify:data [TICKER]...` checks that views built from different sources agree on the fixtures, such as BRK and FF against running trade and the daily prices against running trade. It covers the as-of session and every ticker by default, and `--dates all` covers every session. A mismatch fails with its first examples; a difference with a known cause, such as lots that broker data restates after bonus shares, passes as a note; and a skip says why a check didn't apply, such as a session without an order book. When a change adds a view that another view can confirm, add a check to the list in `apps/web/dev/verify-data.ts`.
- `pnpm bench:publish [--base <ref>]` times broker and tick publication on the fixtures, one process per run with sides alternating, and prints median time, range, peak memory and a digest of the published files per side. Only one runs at a time on the machine, whatever its fixture folder, and a second waits for the first, and it says when other work on the machine, before or during the runs, made the timings noisy. Use it for changes to publication code, and report the run count and range with the number. `--step` picks `broker`, `ticks`, `running_trade` or `closing_book`, and `--runs` the runs per side; a broker run takes about a minute.
- The dev tools keep what they decide in modules with tests beside them: the `verify:data` checks in `apps/web/dev/checks.ts`, the screenshot diff, badges and outline diff in `apps/web/dev/annotate.ts`, and the benchmark verdicts in `apps/pipeline/dev/bench-verdict.ts`. Change a tool's behaviour there, with a test.
- In web tests, build running trade with `tradeSession` and broker rows with `brokerRow` from `apps/web/src/test-builders.ts`, giving only the fields the test is about.

Broker data is private. Never paste its figures into commits, PRs, issues or anything public.
