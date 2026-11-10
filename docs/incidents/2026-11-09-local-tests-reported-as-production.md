# Local test runs reported as production errors in Sentry

**Dates:** 2026-11-09 17:32 UTC to 2026-11-10 18:23 UTC (2026-11-10 00:32 to 2026-11-11 01:23 WIB)
**Impact:** 270 false error events in the `vibe-idx-pipeline` Sentry project, tagged `environment: production`. No users or production systems were affected.
**Status:** Fixed. Only Vercel and GitHub Actions report to Sentry, and the shared local env file no longer holds a DSN.

## Summary

Running the web test suite on the local machine sent errors to Sentry. The tests in `apps/web/src/news-api.test.ts` make the news API fail on purpose. Each of those failures was reported as a real production error in the pipeline project.

| Issue                                                                           | Title               | Events | Test case that produces it                           |
| ------------------------------------------------------------------------------- | ------------------- | ------ | ---------------------------------------------------- |
| [VIBE-IDX-PIPELINE-7](https://monosodiums.sentry.io/issues/VIBE-IDX-PIPELINE-7) | `ZodError` at `rss` | 126    | RSS response `<not-rss/>`, unsafe link, invalid date |
| [VIBE-IDX-PIPELINE-8](https://monosodiums.sentry.io/issues/VIBE-IDX-PIPELINE-8) | `News unavailable`  | 84     | RSS response with status 503                         |
| [VIBE-IDX-PIPELINE-9](https://monosodiums.sentry.io/issues/VIBE-IDX-PIPELINE-9) | `Network failure`   | 42     | Rejected fetch                                       |

The counts are from before the last two test runs at 18:22 and 18:23 UTC.

## How it happens

Two independent changes combined. Neither one caused events by itself.

1. **The code.** PR #65 (2026-11-09 06:03 UTC) added `apps/web/api/_sentry.ts`:

   ```ts
   Sentry.init({
     dsn: process.env.VERCEL_ENV ? SENTRY_DSN : undefined,
     environment: process.env.VERCEL_ENV,
     ...
   });
   ```

   The intent was to keep Sentry off outside Vercel by passing `dsn: undefined`. However, `@sentry/node` treats a missing option as "not given" and falls back to the environment:

   ```js
   // @sentry/node-core/build/cjs/sdk/index.js:127
   dsn: options.dsn ?? process.env.SENTRY_DSN,
   environment: options.environment ?? process.env.SENTRY_ENVIRONMENT,
   ```

   When neither environment value is set, the SDK uses `"production"` as the environment.

2. **The machine setup.** On 2026-11-09 an agent set up local credentials:
   - It wrote the API keys to `~/.config/vibe-idx/env`.
   - It created `~/.t3/worktrees/vibe-idx/mise.toml`, which loads that file through `_.file`.
   - It made agent shells run under `bash -ic`, so mise loads the file.

   The `mise.toml` sits in the parent directory of every T3 worktree, so every agent shell in every worktree now exports the variables. One of them is `SENTRY_DSN`, the pipeline project's DSN. The feeds collector needs it to start.

After step 2, any `vitest` run that reached `reportFailure` started a real Sentry client and sent the error. `news.ts` reports its failures through `reportFailure`. The pipeline DSN was the one in the shell, so the events went to `vibe-idx-pipeline`, not the web project.

## Which thread caused it

The thread **Stockbit Broker and Trade Collection** (`5a2c8004`) set up the environment and ran the first test that leaked. All times are UTC on 2026-11-09:

| Time     | Event                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------ |
| 17:17    | The user asks whether the machine is fully set up with all API keys. Later: "Set this machine up for success."           |
| 17:24:05 | The agent writes `~/.config/vibe-idx/env` and `~/.t3/worktrees/vibe-idx/mise.toml`, then runs `mise trust` on both.      |
| 17:29    | The agent asks for a "Sentry DSN for pipeline and feeds". It mentions that the web DSN would keep local errors separate. |
| 17:30:52 | The agent writes the pipeline DSN to the env file.                                                                       |
| 17:32:09 | First leaked event, from worktree `t3-d57ccc6f`. The same thread runs `pnpm --filter @vibe-idx/web test` there.          |

No agent and no line of code was wrong on its own. The setup thread did not check which code reads `SENTRY_DSN` implicitly. The author of `_sentry.ts` expected `dsn: undefined` to disable Sentry.

After that point, every thread that ran the web tests added events. The table lists the worktrees whose test runs leaked:

| Worktree          | Thread                                                             | Events | Time (UTC)                  |
| ----------------- | ------------------------------------------------------------------ | ------ | --------------------------- |
| `t3-d57ccc6f`     | Stockbit Broker and Trade Collection                               | 12     | Nov 9 17:32 to Nov 10 13:14 |
| `t3-1131fb42`     | Broker filter by client domicile                                   | 36     | 10:48 to 10:53              |
| `t3-15dba647`     | Retire per-stock broker collector                                  | 36     | 13:07 to 13:15              |
| `t3-foreign-flow` | Stockbit parent (inferred)                                         | 6      | 14:49                       |
| `t3-bfd86ab1`     | Stockbit parent (inferred)                                         | 18     | 15:00 to 15:07              |
| `t3-ui-fixtures`  | Stockbit parent, then Review the New Terminal UI                   | 84     | 16:36 to 18:23              |
| `t3-7677eacc`     | Terminal UI fixes: broker and tick panes                           | 6      | 17:12                       |
| `t3-ce9712e9`     | Terminal UI fixes: shell and command bar                           | 24     | 17:13 to 17:18              |
| `t3-dd9149c4`     | Terminal UI fixes: market, ticker and chart panes                  | 18     | 17:14 to 17:21              |
| `t3-250b2b86`     | Terminal UI fixes: publication panes                               | 6      | 17:15                       |
| `t3-03ee05b8`     | Terminal HDS: 1% holders and controller marks                      | 6      | 18:07                       |
| `t3-b0336389`     | Terminal CA past dates and CAL alignment                           | 6      | 18:10                       |
| `t3-3293869a`     | Inspect Latest Sentry Pipeline Log (baseline check during the fix) | 6      | 18:22                       |

Times are on 2026-11-10 unless a row says otherwise. Every event's stack trace runs through `news-api.test.ts` under one of these worktree paths.

## How it was found

The Sentry issues had no CI `run_url` tag and no `release`. Their stack frames pointed to `/home/monosodiums/.t3/worktrees/...` and to the vitest runner, not to a GitHub runner or Vercel. The shell had `SENTRY_DSN` set but not `VERCEL_ENV`. Reading the SDK source confirmed the fallback.

## Fix

The fix has two layers. Either one alone stops local events.

**Code: each reporter reports only from its deploy target.**

| App                           | Reports only when          | Local behavior                                                                                                      |
| ----------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `apps/web/api/_sentry.ts`     | `VERCEL_ENV` is set        | `Sentry.init` is skipped, so `captureException` and `flush` do nothing                                              |
| `apps/pipeline/lib/sentry.ts` | `GITHUB_ACTIONS` is `true` | `startSentry` returns before `Sentry.init`. This also covers the rescale alert in PR #90, which calls `startSentry` |
| `apps/feeds/src/run.ts`       | `GITHUB_ACTIONS` is `true` | Failures print to stderr only. `SENTRY_DSN` is optional locally and still required in Actions                       |

Each app has a test that exports a DSN in a local environment and checks that nothing reports, and a second check that the deploy target still reports. These are `apps/web/src/sentry-api.test.ts`, `apps/pipeline/lib/sentry.test.ts` and the GitHub Actions case in `apps/feeds/src/storage.test.ts`. Each local-environment check fails on the old code.

**Machine: `SENTRY_DSN` is removed from `~/.config/vibe-idx/env`.** New agent shells in every worktree no longer receive it. This also stops branches that predate the code fix.

**Verification.** All three suites ran at 18:50 UTC with the real DSN exported. Sentry recorded no events from this worktree afterwards. The 21 failing web UI tests also fail without this change.

## Prevention

1. **Never pass `undefined` to turn a Sentry SDK off.** For `@sentry/node`, a missing `dsn` means "read it from the environment". Skip `Sentry.init` instead. The tests above fail if any of the three reporters starts locally.
2. **Keep deploy-only secrets out of `~/.config/vibe-idx/env`.** The parent `mise.toml` loads that file into every agent shell in every worktree. Put a value there only if any process may safely read it. Before you add one, search the code and the SDKs for implicit readers of that name, such as `SENTRY_DSN`, `SENTRY_ENVIRONMENT` and `AWS_*`.
3. **Use a separate Sentry project for deliberate local reporting.** If you need local reporting, create a `vibe-idx-local` project, so local events never mix with production issues.

The alert rules were left unchanged. A `run_url` filter on "Email on every pipeline error" would also mute real feeds alerts, because feeds events don't carry that tag.

## Cleanup

- Resolve VIBE-IDX-PIPELINE-7, -8 and -9 when the fix merges. The commit message carries `Fixes` for each one.
- One more worktree, `t3-2fa52312`, sent 6 more events at 18:45 UTC, before the DSN was removed from the env file.
