## Verdict

**PASS** — At `7780266`, Phase 59 worktree capacity authority matches WC1–WC5 for concurrent admission, generation-correlated lock reaping, and exact drain/reap. Confirmed defects: none at P0–P1. Residual risk is intentional WC5 preflight-not-quota scope, not a spec miss.

## P0-P1 findings

No P0 or P1 defects confirmed in committed source for the review focus.

**Concurrent admission (grounded)**  
`WorktreeCapacityAuthority.reserve` estimates outside the lock, then under `_lock` reads the sealed ledger, observes free space, checks aggregate max/floor, rejects duplicates, and appends in one critical section (`impl/src/worktree-capacity.mjs` ~333–368). Exclusive lock publish uses `linkSync` O_EXCL publication with `generation` + `ownerId` + `pid` (~191–199, ~282–330). Worker/verify create reserves before Git effects (`impl/src/index.mjs` ~131–168, ~185–195). Test WC4 races two spawns under a one-slot budget: one fulfills, one `worktree_capacity_exceeded`, one spawn effect, drain to zero owned (`phase59-worktree-capacity-authority.test.mjs` WC4).

**Process generation correlation (grounded)**  
Each lock acquire mints a 32-hex `generation`; reaper path re-reads and requires `generation`/`ownerId` match and dead `pid` before tombstone rename; unlock unlinks only when observed generation still matches the acquirer (~286–329). Test WC15 reaps a well-formed dead generation lock before admission.

**Exact drain/reap (grounded)**  
`release` filters only `id`+`ownerId`+`nonce` (~371–378). Failed create releases its token (~166–168). `drainAndClose` snapshots the sealed ledger after fleet drain, refuses with `coordinator_drain_incomplete` if any reservation still owned by this driver, then closes coordinator and writer; receipt records `ownedReservations: 0` and `stateDigest` (`index.mjs` ~709–736). Legacy `close`/`closeAsync` call `assertCapacityQuiescent` → `driver_capacity_active` (~635–668). WC5/WC17/WC21 cover kill-reap reuse, legacy refuse, and drain-before-irreversible-close retry.

**Retained later scope (not defects)**  
WC5: estimate is concurrency budget, not FS quota; HMAC is not a same-UID hostile boundary; hard-ceiling quota/isolated volume is follow-up. WC6 multi-provider Baton-on-Baton Grok observation is acceptance theater beyond unit suite. PID liveness without stronger process identity can misclassify under PID reuse—called out by WC5 honesty, not a Phase 59 incompleteness against the written authority.

## Required corrections

None. Ship as-is for concurrent Grok capacity admission, generation-gated lock reaping, and exact drain/reap at `7780266`.