---
name: broker-collector
description: Model-check the private broker collector (apps/pipeline/brokers.ts and the broker steps of .github/workflows/ingest.yml) with TLA+ against crashes, failed or ambiguous R2 writes, lost Stockbit responses, and overlapping runs. Use before merging any change to the run marker, Stockbit token rotation, raw archiving, the commit of rows and pair completion, checkpoint(), publication, the parquet restore, or the workflow queue.
---

# Broker collector model check

`apps/pipeline/formal/BrokerCollector.tla` models the broker collector step by step. Each R2 object call and each Stockbit call is one atomic step. Any call can succeed, fail without effect, or take effect and still report an error. Any run can crash between steps. TLC explores every interleaving of these steps within the bounds below and checks four properties.

| Property | Plain statement | Harm when broken |
| --- | --- | --- |
| `LedgerIntegrity` | Every pair in `parquet/broker-coverage.parquet` has an archived raw response, and `parquet/brokers/<year>.parquet` holds exactly that response's rows. Stored rows always match the archived raw. | Complete pairs are never fetched again, so that day's broker flow is permanently missing or wrong. |
| `RawImmutable` | `raw/broker/<date>/<ticker>.json` never changes once written. | Replays rebuild a different history from the same pair. |
| `MutualExclusion` | At most one live run holds `broker-run.json`. | Two collectors overwrite each other's ledger and rotated token. |
| `TokenRecoverable` | When no marker is present and no collector is alive, `auth/stockbit.json` holds the refresh token that Stockbit currently accepts. | Scheduled runs fail authentication with no marker to alert the operator, and the session must be re-seeded. |

## Does my change touch the verified code?

The model was last confirmed against the code at commit **`5e84726`** (the sync commit). It covers:

| Code | Model action |
| --- | --- |
| `.github/workflows/ingest.yml` `concurrency` block | `Queued` constant, `Start` |
| `ingest.yml` "Restore Parquet ledger" (`aws s3 sync .../parquet`) | `Restore` (rows and coverage read independently, in either order) |
| `ingest.yml` "Restore IDX raw responses" `--exclude "broker/*"`, "Upload Parquet ledger" excludes | No local broker raw at pair start; IDX steps never touch broker objects |
| `brokers.ts` `get`, `put`, `verifiedPut` | One action per call; readback is its own action |
| `brokers()` marker block (`get('broker-run.json')`, `verifiedPut(... '--if-none-match', '*')`) | `MarkerGet`, `MarkerPut`, `MarkerVerify` |
| `collect()` → `authenticate()` | `AuthGet`, `Refresh`, `AuthPut`, `AuthVerify` |
| `collect()` → `raw()` | `RawGet`, `Fetch`, `RawPut`, `RawVerify` |
| DB load (`INSERT INTO brokers ... read_parquet`, `UPDATE broker_pairs SET complete = true WHERE EXISTS`) | `MarkerVerify` (DB load folded in) |
| Pair loop, `BEGIN TRANSACTION` … `COMMIT`, `years.set`, `completed % 25` | `Pair`, `Commit`, `AfterCommit` |
| `checkpoint()` (year files, then coverage, `years.clear()`) | `Checkpoint` |
| Publication of `site/broker/*.json` and `site/market-accumulation.json`, `if (failure) throw`, `delete-object broker-run.json` | `Publish`, `DeleteMarker` |
| README "Run the batch" marker-recovery procedure | `Review`, `ReseedLogin`, `ReseedPut`, `ReseedVerify`, `ClearMarker` |

To see whether covered code changed since the sync commit, run:

```sh
git log --oneline 5e84726..HEAD -- apps/pipeline/brokers.ts .github/workflows/ingest.yml
git diff 5e84726 -- apps/pipeline/brokers.ts .github/workflows/ingest.yml
```

A change touches the model if it adds, removes, reorders, or changes the condition of any R2 call, Stockbit call, or the commit or checkpoint logic listed above. The model doesn't say what a parsing or validation check accepts (field checks, `Broker date mismatch` and similar). It does include the fact that such a check can throw before `COMMIT`, which is `Commit`'s failure branch. A new check is outside the model as long as it still throws there.

Each run's local state lives in `run[r]`. Its fields map to the code like this:

| Field | Code |
| --- | --- |
| `pc` | Position in `brokers()` / `collect()` |
| `rows`, `coverage` | DuckDB tables `brokers` and `broker_pairs` (complete pairs) |
| `file` | Local `$DATA/parquet/brokers/2026.parquet` as last restored or written |
| `year` | The year is a key in the `years` map |
| `changed` | That key's value is `true` (`years.set(year, true)`) |
| `failure` | The `failure` variable in `collect()` |
| `held` | This run acquired `broker-run.json` |
| `token`, `etag`, `access` | `authenticate()`'s saved token and ETag, and whether `access` is set |

For example, deleting `years.set(day.slice(0, 4), true)` means `Commit` must leave `year` and `changed` unchanged.

Errors that exit without running the final checkpoint and publish no modeled object are represented by `Crash`, which keeps the marker and changes nothing else. These include the `broker-rpm.json` calls, DuckDB setup, and a rethrow after `collect()`. If you make such an error write to a modeled object, give it its own action.

## Run the check

```sh
apps/pipeline/formal/check.sh            # real configuration; must pass
apps/pipeline/formal/check.sh mutants    # each known regression must be caught
apps/pipeline/formal/check.sh unqueued   # overlapping runs; currently fails (known finding)
```

The script downloads the pinned `tla2tools.jar` (v1.7.4, SHA-256 checked) into `apps/pipeline/formal/.cache/` and needs Java 11 or later. On macOS, run `brew install openjdk@21`; the script finds the keg-only install. The default mode finishes in about 2 seconds and the mutants in about 6 seconds. CI runs both. Full TLC output goes to `apps/pipeline/formal/.cache/<mode>.log`.

`check.sh unqueued` is expected to exit 1 with `Invariant LedgerIntegrity is violated` and the line `known finding`. Any other result in that mode is new information: either the finding was fixed or a different property broke.

## When the check fails

TLC prints `Error: Invariant <Name> is violated` and then a trace of states. Read the trace one state at a time. Each state names the action that produced it, and the `run` variable shows each collector's `pc` (its position in the code). Translate the trace into code steps using the table above, for example: "run 1 put the coverage object, then crashed before putting `brokers/2026.parquet`".

Then decide which kind of failure it is.

- **Real bug.** Every step in the trace is something the code can do. A crash, a failed call, or a call that took effect but reported an error can happen at any of these points in production. Report the trace in code terms. Do not weaken the property, shrink the model, or add a precondition to make it pass.
- **Modeling error.** A step in the trace is impossible in the code, for example, the model lets a run continue after an error that the code throws. Fix the action so that it matches the code. Cite the code line in the action's comment, and rerun.

When unsure, try to reproduce the trace in `apps/pipeline/brokers.test.ts`. That file mocks `execFile` for R2 calls and `fetcher` for Stockbit, so you can inject a failed or ambiguous call at the step the trace names.

## When you change covered code on purpose

1. Edit the matching action in `BrokerCollector.tla` so that it does exactly what the new code does: same calls, same order, same conditions, and the same error path. Keep one R2 or Stockbit call per action.
2. If the new code adds a behavior the model can't express (a new object, a new retry, a new kind of local state), add it to the model. Don't abstract it away.
3. Run `check.sh`, `check.sh mutants`, and `check.sh unqueued`.
4. If a mutant switch (`CoverageFirst`, `DeleteOnFailure`, `CommitBeforeRaw`, `MarkerConditional` at the top of the spec) no longer describes a possible regression, update it and its line in `check.sh`. Never delete a mutant only because it now passes. Find out why it passes.
5. Update the coverage table above. Move the sync commit forward only after you have read the covered code at the new commit and confirmed that the model describes it. Record the new commit hash in place of `5e84726`.

## Known finding: overlapping runs can corrupt the ledger

The workflow restores the ledger from cloud Parquet before the collector acquires `broker-run.json`. The marker therefore doesn't protect the restore. If a run executes outside the `idx-batch-ingest` queue (for example, a local `pnpm --filter @vibe-idx/pipeline brokers` with R2 write credentials), TLC finds this sequence:

1. Runs 1 and 2 both restore the same ledger. One pair, P, has archived raw but is not complete yet.
2. Run 1 takes the marker, replays P, checkpoints rows and then coverage, and deletes the marker.
3. Run 2 takes the marker with its stale snapshot. Its daily auth call fails, so it goes to the final `checkpoint()`. That checkpoint uploads its old `brokers/2026.parquet`, which drops P's rows.
4. At that moment, cloud coverage still marks P complete (from run 1) while its rows are gone. If run 2 crashes before uploading coverage, P is never fetched again.

The exact pair TLC reports may differ from P above. Read `apps/pipeline/formal/.cache/unqueued.log` for the trace it found.

A torn restore leads to the same result: rows are read before another run's checkpoint and coverage after it. Under the real queue (`check.sh`), no such run exists and all four properties hold. One possible fix is to read the broker Parquet inside `brokers()` after the marker is acquired. Changing product code needs the owner's approval.

## Scope and bounds

The model checks 2 runs, 2 pairs, a single year, Stockbit refresh tokens 0–3, one operator review, and responses `empty`, `a`, or `b`. The initial states include all 81 consistent ledgers. A pass covers these bounds. It is not a proof for any number of runs, pairs, or years.

The model assumes:

- R2 is strongly consistent per object and has no multi-object atomicity.
- Stockbit accepts only the latest refresh token.
- The operator follows the README recovery procedure: no live collector, re-seed an invalid token, then clear the marker.

An ambiguous final `delete-object broker-run.json` removes the marker even though the run reports failure. The model allows this, and it is safe because the checkpoint finished first.

It leaves out the `broker-rpm.json` rate logic (its failures count as a crash), the contents of the published JSON, response schema validation, access-token expiry, rate limits, clocks, attempt counts, and the IDX source ingestion in `ingest.ts`. `bounded()` and the every-25 checkpoint are over-approximated: a run may stop or checkpoint after any pair.
