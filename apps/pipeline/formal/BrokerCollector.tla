-------------------------- MODULE BrokerCollector --------------------------
EXTENDS Naturals, FiniteSets, TLC

(***************************************************************************
Coverage at 5e84726:
  ingest.yml:30-33,65,68,94: queue, per-object restore, broker exclusions.
  brokers.ts:123-126: marker; 171-191: rotating auth; 199-228: immutable raw;
  258-283: DB load; 387-404: commit/checkpoint; 406-437: publish/delete.
  README "Run the batch" and docs/v2.md: reviewed operator recovery.
One action performs at most one R2 object call or one Stockbit call. Local DB
work is collapsed into adjacent calls except explicit commit/control steps.
Read errors include ambiguous reads (no cloud mutation, unusable response).
Errors that exit without checkpoint or publication and touch no modeled object
(broker-rpm.json calls :128-148, DuckDB setup :193-283, any later rethrow) are
covered by Crash, which retains the marker and changes nothing else.
The rate object, IDX objects, JSON contents/publication consistency, schema
validation and access-token expiry are outside these safety properties.
Publication is one representative put: any number of such puts has the same
success/error/crash effects here. Raw is never restored (ingest.yml:68).
Runs and pairs are ordered integers; one year (2026), two eligible pairs.
Marker absence is 0 (not a run id); raw/row absence is the string "none".
One operator review is allowed; a lost seed PUT ends that review with marker
retained. Review is trusted to reseed any invalid cloud token before clearing.
Initial states enumerate all consistent raw/row/coverage ledgers over Pairs,
including pending archives and rows awaiting coverage, with a valid token.
Finite bounds are not a proof for unbounded runs, years, or pair counts.
***************************************************************************)
CONSTANTS Runs, Pairs, Content, MaxTok, Queued
None == "none"
Outcomes == {"ok", "fail", "ambiguous"}
CoverageFirst == FALSE
DeleteOnFailure == FALSE
CommitBeforeRaw == FALSE
MarkerConditional == TRUE

VARIABLES marker, cloudToken, cloudEtag, cloudRaw, cloudRows, cloudCoverage,
          validRefresh, rawHistory, run, operator, reviews
vars == <<marker, cloudToken, cloudEtag, cloudRaw, cloudRows, cloudCoverage,
          validRefresh, rawHistory, run, operator, reviews>>
cloud == <<marker, cloudToken, cloudEtag, cloudRaw, cloudRows, cloudCoverage,
           validRefresh, rawHistory>>
EmptyRows == [p \in Pairs |-> None]
Rows(bytes) == IF bytes = "empty" THEN None ELSE bytes
\* Complete pairs are never fetched again: corruption permanently hides broker flow.
LedgerIntegrity == /\ \A p \in cloudCoverage:
                         cloudRaw[p] # None /\ cloudRows[p] = Rows(cloudRaw[p])
                   /\ \A p \in Pairs: cloudRows[p] # None => cloudRows[p] = cloudRaw[p]
Fresh == [pc |-> "idle", restored |-> {}, rows |-> EmptyRows, coverage |-> {},
          entries |-> {}, pair |-> CHOOSE p \in Pairs: TRUE, bytes |-> None,
          token |-> 0, etag |-> 0, access |-> FALSE, held |-> FALSE,
          failure |-> FALSE, year |-> FALSE, changed |-> FALSE, file |-> EmptyRows,
          final |-> FALSE,
          resume |-> "pair", pendingRaw |-> FALSE]
Done == [Fresh EXCEPT !.pc = "done"]
Alive == {r \in Runs: run[r].pc \notin {"idle", "done"}}
\* brokers.ts:98-119: update one process, leaving operator state unchanged.
Move(r, s) == /\ run' = [run EXCEPT ![r] = s]
              /\ UNCHANGED <<operator, reviews>>
\* brokers.ts:387-404: in-memory/control work leaves R2 and provider unchanged.
Local(r, s) == /\ Move(r, s) /\ UNCHANGED cloud
Fail(s) == [s EXCEPT !.failure = TRUE, !.final = TRUE, !.pc = "cpFirst"]
BeginCheckpoint(s, last, back) ==
    [s EXCEPT !.pc = "cpFirst", !.final = last, !.resume = back]

\* brokers.ts:123; ingest.yml:30-33,65: job starts only after prior queue job exits.
Start(r) == /\ run[r].pc = "idle"
            /\ (~Queued \/ \A prior \in Runs: prior < r => run[prior].pc = "done")
            /\ Local(r, [Fresh EXCEPT !.pc = "restore"])

\* ingest.yml:65: independent sync GETs in either order; errors stop the job.
Restore(r) ==
    /\ run[r].pc = "restore"
    /\ \E obj \in {"rows", "coverage"} \ run[r].restored, ok \in BOOLEAN:
       IF ~ok THEN Local(r, Done)
       ELSE LET s == [run[r] EXCEPT !.restored = @ \cup {obj},
                    !.rows = IF obj = "rows" THEN cloudRows ELSE @,
                    !.file = IF obj = "rows" THEN cloudRows ELSE @,
                    !.coverage = IF obj = "coverage" THEN cloudCoverage ELSE @,
                    !.year = IF obj = "rows" THEN
                               (\E p \in Pairs: cloudRows[p] # None) ELSE @]
            IN Local(r, [s EXCEPT !.pc = IF s.restored = {"rows", "coverage"}
                                           THEN "markerGet" ELSE "restore"])

\* brokers.ts:123: a present marker throws without deleting it.
MarkerGet(r) == /\ run[r].pc = "markerGet"
                /\ \E ok \in BOOLEAN:
                   Local(r, IF ok /\ marker = 0
                            THEN [run[r] EXCEPT !.pc = "markerPut"] ELSE Done)

\* brokers.ts:126,112-119: one conditional PUT; ambiguous success keeps marker.
MarkerPut(r) ==
    /\ run[r].pc = "markerPut"
    /\ \E result \in Outcomes:
       /\ marker' = IF result # "fail" /\ (~MarkerConditional \/ marker = 0)
                     THEN r ELSE marker
       /\ Move(r, IF result = "ok" /\ (~MarkerConditional \/ marker = 0)
                  THEN [run[r] EXCEPT !.pc = "markerVerify"] ELSE Done)
       /\ UNCHANGED <<cloudToken, cloudEtag, cloudRaw, cloudRows, cloudCoverage,
                      validRefresh, rawHistory>>

\* brokers.ts:118-119,258-283,318: readback then DB load and daily/lazy auth.
MarkerVerify(r) ==
    /\ run[r].pc = "markerVerify"
    /\ \E ok \in BOOLEAN, kind \in {"daily", "backfill"}:
       LET s == run[r]
           complete == s.coverage \cup {p \in Pairs: s.rows[p] # None}
       IN Local(r, IF ok /\ marker = r THEN
          [s EXCEPT !.held = TRUE, !.coverage = complete,
           !.entries = Pairs \ complete,
           !.pc = IF kind = "daily" THEN "authGet" ELSE "pair"] ELSE Done)

\* brokers.ts:172: token GET saves bytes and ETag; error goes to final checkpoint.
AuthGet(r) == /\ run[r].pc = "authGet"
              /\ \E ok \in BOOLEAN:
                 Local(r, IF ok THEN [run[r] EXCEPT !.token = cloudToken,
                              !.etag = cloudEtag, !.pc = "refresh"] ELSE Fail(run[r]))

\* brokers.ts:177-184: refresh may rotate then lose its response, or hit bounded().
Refresh(r) ==
    /\ run[r].pc = "refresh"
    /\ \/ \E result \in Outcomes:
          /\ validRefresh' = IF result # "fail" /\ run[r].token = validRefresh
                                /\ validRefresh < MaxTok THEN validRefresh + 1
                              ELSE validRefresh
          /\ Move(r, IF result = "ok" /\ run[r].token = validRefresh
                          /\ validRefresh < MaxTok
                     THEN [run[r] EXCEPT !.token = validRefresh + 1, !.pc = "authPut"]
                     ELSE Fail(run[r]))
          /\ UNCHANGED <<marker, cloudToken, cloudEtag, cloudRaw, cloudRows,
                         cloudCoverage, rawHistory>>
       \/ Local(r, IF run[r].resume = "pair"
                   THEN [run[r] EXCEPT !.pc = "pair"]
                   ELSE BeginCheckpoint(run[r], TRUE, "pair"))

\* brokers.ts:189,112-119: conditional token PUT; error is not retried.
AuthPut(r) ==
    /\ run[r].pc = "authPut"
    /\ \E result \in Outcomes:
       LET effect == result # "fail" /\ run[r].etag = cloudEtag
       IN /\ cloudToken' = IF effect THEN run[r].token ELSE cloudToken
          /\ cloudEtag' = IF effect THEN cloudEtag + 1 ELSE cloudEtag
          /\ Move(r, IF result = "ok" /\ effect
                     THEN [run[r] EXCEPT !.pc = "authVerify"] ELSE Fail(run[r]))
          /\ UNCHANGED <<marker, cloudRaw, cloudRows, cloudCoverage,
                         validRefresh, rawHistory>>

\* brokers.ts:118-119,190: readback must match before access is used.
AuthVerify(r) ==
    /\ run[r].pc = "authVerify"
    /\ \E ok \in BOOLEAN:
       Local(r, IF ok /\ cloudToken = run[r].token
                THEN [run[r] EXCEPT !.access = TRUE, !.pc = run[r].resume]
                ELSE Fail(run[r]))

\* brokers.ts:322-336: ordered entries; bounded() can stop before any next pair.
Pair(r) ==
    /\ run[r].pc = "pair"
    /\ \/ Local(r, BeginCheckpoint(run[r], TRUE, "pair"))
       \/ /\ run[r].entries # {}
          /\ Local(r, [run[r] EXCEPT !.pair = CHOOSE p \in run[r].entries:
                                  \A q \in run[r].entries: p <= q,
                       !.pc = "rawGet"])

\* brokers.ts:202-215: cloud replay; no local raw branch at pair start.
RawGet(r) ==
    /\ run[r].pc = "rawGet"
    /\ \E ok \in BOOLEAN:
       LET s == run[r] IN Local(r,
          IF ~ok THEN Fail(s)
          ELSE IF cloudRaw[s.pair] # None
               THEN [s EXCEPT !.bytes = cloudRaw[s.pair], !.pc = "commit"]
          ELSE [s EXCEPT !.pc = IF s.access THEN "fetch" ELSE "authGet",
                         !.resume = "fetch"])

\* brokers.ts:216-222: one provider GET; bounded/error or any successful content.
Fetch(r) ==
    /\ run[r].pc = "fetch"
    /\ \/ Local(r, Fail(run[r]))
       \/ Local(r, BeginCheckpoint(run[r], TRUE, "pair"))
       \/ \E bytes \in Content:
          Local(r, [run[r] EXCEPT !.bytes = bytes, !.pendingRaw = CommitBeforeRaw,
                    !.pc = IF CommitBeforeRaw THEN "commit" ELSE "rawPut"])

\* brokers.ts:227: create-once PUT; a 412 is an error, never an overwrite.
RawPut(r) ==
    /\ run[r].pc = "rawPut"
    /\ \E result \in Outcomes:
       LET s == run[r]
           effect == result # "fail" /\ cloudRaw[s.pair] = None
       IN /\ cloudRaw' = IF effect THEN [cloudRaw EXCEPT ![s.pair] = s.bytes] ELSE cloudRaw
          /\ rawHistory' = IF effect /\ rawHistory[s.pair] = None
                              THEN [rawHistory EXCEPT ![s.pair] = s.bytes] ELSE rawHistory
          /\ Move(r, IF result = "ok" /\ effect THEN [s EXCEPT !.pc = "rawVerify"] ELSE Fail(s))
          /\ UNCHANGED <<marker, cloudToken, cloudEtag, cloudRows, cloudCoverage, validRefresh>>

\* brokers.ts:118-119,228: raw readback must match before local commit.
RawVerify(r) ==
    /\ run[r].pc = "rawVerify"
    /\ \E ok \in BOOLEAN:
       Local(r, IF ok /\ cloudRaw[run[r].pair] = run[r].bytes
                THEN [run[r] EXCEPT !.pc = IF run[r].pendingRaw THEN "pair" ELSE "commit",
                                   !.pendingRaw = FALSE]
                ELSE Fail(run[r]))

\* brokers.ts:338-402: parse/validation errors set failure (:400-402); valid bytes
\* commit rows+completion in one transaction.
Commit(r) ==
    /\ run[r].pc = "commit"
    /\ \/ Local(r, Fail(run[r]))
       \/ Local(r, [run[r] EXCEPT !.rows[run[r].pair] = Rows(run[r].bytes),
                 !.coverage = @ \cup {run[r].pair}, !.entries = @ \ {run[r].pair},
                 !.year = @ \/ Rows(run[r].bytes) # None,
                 !.changed = @ \/ Rows(run[r].bytes) # None, !.pc = "afterCommit"])

\* brokers.ts:404: checkpoint after any completion over-approximates every 25.
AfterCommit(r) ==
    /\ run[r].pc = "afterCommit"
    /\ LET back == IF run[r].pendingRaw THEN "rawPut" ELSE "pair"
       IN \/ Local(r, [run[r] EXCEPT !.pc = back])
          \/ Local(r, BeginCheckpoint(run[r], FALSE, back))

\* brokers.ts:298-314,406: each checkpoint PUT touches one object, no readback.
Checkpoint(r) ==
    /\ run[r].pc \in {"cpFirst", "cpSecond"}
    /\ \E result \in Outcomes:
       LET s == run[r]
           first == s.pc = "cpFirst"
           coverage == IF CoverageFirst THEN first ELSE ~first
           write == coverage \/ s.year
           \* brokers.ts:301-307: changed years are rewritten from the DB; others
           \* upload the existing local file.
           bytes == IF s.changed THEN s.rows ELSE s.file
           effect == write /\ result # "fail"
           t == IF write /\ ~coverage THEN [s EXCEPT !.file = bytes] ELSE s
           next == IF write /\ result # "ok" THEN Done
                   ELSE IF first THEN [t EXCEPT !.pc = "cpSecond"]
                   ELSE [t EXCEPT !.year = FALSE, !.changed = FALSE,
                         !.pc = IF t.final THEN "publish" ELSE t.resume]
       IN /\ cloudRows' = IF effect /\ ~coverage THEN bytes ELSE cloudRows
          /\ cloudCoverage' = IF effect /\ coverage THEN s.coverage ELSE cloudCoverage
          /\ Move(r, next)
          /\ UNCHANGED <<marker, cloudToken, cloudEtag, cloudRaw, validRefresh, rawHistory>>

\* brokers.ts:410-434: representative publication PUT; failure retains marker.
Publish(r) ==
    /\ run[r].pc = "publish"
    /\ \E result \in Outcomes:
       Local(r, IF result # "ok" THEN Done
                ELSE IF run[r].failure /\ ~DeleteOnFailure THEN Done
                ELSE [run[r] EXCEPT !.pc = "deleteMarker"])

\* brokers.ts:435-437: failure throws first; successful run deletes unconditionally.
DeleteMarker(r) ==
    /\ run[r].pc = "deleteMarker"
    /\ \E result \in Outcomes:
       /\ marker' = IF result # "fail" THEN 0 ELSE marker
       /\ Move(r, Done)
       /\ UNCHANGED <<cloudToken, cloudEtag, cloudRaw, cloudRows, cloudCoverage,
                      validRefresh, rawHistory>>

\* brokers.ts:98-119,168; ingest.yml:41: kill at any step loses only process state.
Crash(r) == /\ r \in Alive /\ Local(r, Done)

\* brokers.ts:123 / README Run the batch: review only when no collector is alive.
Review == /\ Alive = {} /\ marker # 0 /\ operator = "idle" /\ reviews < 1
          /\ operator' = IF cloudToken = validRefresh THEN "clear" ELSE "login"
          /\ reviews' = reviews + 1 /\ UNCHANGED <<cloud, run>>

\* brokers.ts:177 / docs/v2.md recovery: fresh login obtains a new valid seed.
ReseedLogin == /\ operator = "login" /\ validRefresh < MaxTok
               /\ validRefresh' = validRefresh + 1 /\ operator' = "seedPut"
               /\ UNCHANGED <<marker, cloudToken, cloudEtag, cloudRaw, cloudRows,
                              cloudCoverage, rawHistory, run, reviews>>

\* brokers.ts:112 / README Run the batch: seed one cloud object before clearing.
ReseedPut ==
    /\ operator = "seedPut"
    /\ \E result \in Outcomes:
       /\ cloudToken' = IF result # "fail" THEN validRefresh ELSE cloudToken
       /\ cloudEtag' = IF result # "fail" THEN cloudEtag + 1 ELSE cloudEtag
       /\ operator' = IF result = "ok" THEN "seedVerify" ELSE "idle"
       /\ UNCHANGED <<marker, cloudRaw, cloudRows, cloudCoverage, validRefresh,
                      rawHistory, run, reviews>>

\* brokers.ts:118 / README Run the batch: confirm the saved seed with readback before clearing.
ReseedVerify == /\ operator = "seedVerify"
                /\ \E ok \in BOOLEAN:
                   /\ operator' = IF ok /\ cloudToken = validRefresh THEN "clear" ELSE "idle"
                   /\ UNCHANGED <<cloud, run, reviews>>

\* brokers.ts:437 / README Run the batch: reviewed marker DELETE is one object call.
ClearMarker == /\ operator = "clear" /\ Alive = {} /\ cloudToken = validRefresh
               /\ \E result \in Outcomes:
                  /\ marker' = IF result # "fail" THEN 0 ELSE marker
                  /\ operator' = "idle"
                  /\ UNCHANGED <<cloudToken, cloudEtag, cloudRaw, cloudRows,
                                 cloudCoverage, validRefresh, rawHistory, run, reviews>>

\* brokers.ts:258-278; ingest.yml:65: consistent cloud ledger and valid token seed.
Init == /\ marker = 0 /\ cloudToken = 0 /\ cloudEtag = 0 /\ validRefresh = 0
        /\ cloudRaw \in [Pairs -> Content \cup {None}]
        /\ cloudRows \in [Pairs -> {None, "a", "b"}]
        /\ cloudCoverage \in SUBSET Pairs /\ LedgerIntegrity
        /\ rawHistory = cloudRaw /\ run = [r \in Runs |-> Fresh]
        /\ operator = "idle" /\ reviews = 0

\* brokers.ts:protocol above; ingest.yml:30-33: all allowed run interleavings.
Next == (\E r \in Runs: Start(r) \/ Restore(r) \/ MarkerGet(r) \/ MarkerPut(r)
         \/ MarkerVerify(r) \/ AuthGet(r) \/ Refresh(r) \/ AuthPut(r) \/ AuthVerify(r)
         \/ Pair(r) \/ RawGet(r) \/ Fetch(r) \/ RawPut(r) \/ RawVerify(r) \/ Commit(r)
         \/ AfterCommit(r) \/ Checkpoint(r) \/ Publish(r) \/ DeleteMarker(r) \/ Crash(r))
        \/ Review \/ ReseedLogin \/ ReseedPut \/ ReseedVerify \/ ClearMarker
Spec == Init /\ [][Next]_vars

\* Replacing archived bytes makes replay change the historical broker ledger.
RawImmutable == cloudRaw = rawHistory
\* Two marker owners can overwrite each other's private ledger and rotated token.
MutualExclusion == Cardinality({r \in Alive: run[r].held}) <= 1
\* A lost session without a marker makes scheduled auth fail without operator signal.
TokenRecoverable == marker = 0 /\ Alive = {} => cloudToken = validRefresh
=============================================================================
