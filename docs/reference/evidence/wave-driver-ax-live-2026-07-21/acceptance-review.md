# Wave driver surface (docs/31) — acceptance review, 2026-07-21 (post-remediation)

Scope: `docs/31-wave-driver-ax.md`, `impl/src/wave.mjs`, `impl/test/wave-driver-red.test.mjs`,
the `baton.waves` getter and the `runs.*` client contracts in `impl/src/application-client.mjs`.
This review re-audits the surface **after** commit `aefb275` ("close wave-surface acceptance
findings"). Deployment verification (the pinned execution contract) was run:

```
node --test impl/test/wave-driver-red.test.mjs   →   tests 9, pass 9, fail 0, EXIT 0
```

## Verdict

**Conditional accept.** The prior round's field-path defects are genuinely remediated and now
genuinely pinned:

- docs/31 #6 "result section first" is fixed — `materialize` reads `results?.section?.items?.[0]?.value`
  with no `.view.` wrapper (`wave.mjs:213-215`), and W1 now materializes a `resultSha` from the
  section **without** `repoRoot`/`report` (`test:140-153`), pinning the documented-surface path.
- docs/31 #8 residue truth is fixed — `close` reads the RunView `resources` block
  (`ownedCount`/`cleanupState`, `wave.mjs:289-298`), coalesces unknown to `+1` not `0`
  (`wave.mjs:304`), and flags `residueUnknown` (`wave.mjs:305`); W8 asserts the resources block is
  present and `ownedCount` is a real integer (`test:299-304`).
- Pump leak is fixed — `drainPumps` (`wave.mjs:166-174`) is awaited in both `settle` (`wave.mjs:276`)
  and `close` (`wave.mjs:282`), and W3 asserts `wave.pumpQuiescent === true` after a timed-out
  settle (`test:200`).
- Glob admission now consults the filesystem when `repoRoot` is present (`wave.mjs:43-47`), and W5
  pins the dotted-existing-directory and non-existent-dotless corners (`test:233-239`).
- The `baton.waves` getter is sound (`application-client.mjs:1484-1486`): the arrow captures the
  getter's `this` (the frozen `BatonClient`), so `const { start } = client.waves` cannot rebind it;
  the returned object is frozen. W9 exercises it (`test:311-323`).

Semantics #1 (explicit approval, with W1's `approve:false` parked control), #2 (`run.complete()`'s
return correctly discarded; `terminalFrom` = `outline.terminal===true` ∪ `{stopped,failed,cancelled,
completed}`, `wave.mjs:74-76`), #3 (per-member start isolation, `wave.mjs:117-129`), #4
(`work_completed`/`selection_required` taxonomy via `attentionFrom`/settle), and #8's
always-produce-an-outcome clause (`wave.mjs:257-275`, W3) are enforced and genuinely pinned.

The reason this is *conditional*, not a clean accept: **two W rows are now vacuous with respect to
the receipted failure mode they name.** In one case the vacuity is a direct side effect of the
P1-A remediation. Neither is a runtime defect — both shipped code paths exist and are plausibly
correct — but the suite no longer holds them, so a regression in either remediation keeps the suite
green. No P0 (nothing crashes, loses data, or fails the contract).

## P0-P1 findings

**P1 — W7 no longer exercises the pin-fallback it claims to pin (failure mode #6); the P1-A fix
un-covered it.** Before remediation, `materialize` read a non-existent `.view.section` wrapper, so
the section path always yielded `undefined` and every materialization fell through to the
`refs/baton/results/*` fallback — which is what W7 actually exercised. The P1-A fix
(`wave.mjs:213-215`) makes the section path return the run's own authoritative `resultSha`, so in
W7 both completed members return at `wave.mjs:215` and the fallback (`wave.mjs:217-235`:
`git for-each-ref`, start-time window, used-sha exclusion, `git cat-file -e <sha>:<report>` path
probing) is **never entered**. W7's assertions (`test:278-283`) now only prove the section-path sha's
tree binds the correct report — true by construction for a per-run authoritative sha. The receipted
scenario for #6 — "the newest `refs/baton/results/*` pin belonged to a sibling run; materialization
needed path-existence disambiguation" — is never constructed. Across the whole suite the fallback's
**positive** branch (`wave.mjs:231-232` returning `pin.sha`) is never reached: the only member that
enters the fallback at all is crashed `beta` in W2 (`test:168`), which has no matching pin and
returns `null` via used-sha exclusion. So fixing the primary path silently turned #6's remedy into
dead code with respect to the suite. **W7 is now vacuous for #6.**

**P1 — W6 does not exercise the stopMember dispatch-race remediation (failure mode #7).**
`stopMember` attempts `run.act('stop_member', …)` first and falls back to `run.stop` only on
`application_action_unavailable` (`wave.mjs:191-198`). Waves compose plain runs, which advertise no
`stop_member` action, so `BatonRun.act` throws `application_action_unavailable` at the client on the
first iteration (`application-client.mjs:1077`) and the fallback runs immediately. W6 honestly pins
that plain-run branch (`test:256-257`: `stopped === true`, `admitted !== true`) — a real improvement
over the prior `admitted || stopped` assertion. But the retry-until-stoppable loop that **is** the
receipted remedy for the dispatch race — `wave.mjs:201-203`, retrying on
`application_action_scope_mismatch` / `application_workflow_member_stop_unavailable` while the
attempt's `taskId` is unassigned — is never reached, because those codes only arise for a workflow
member and "waves compose plain runs today" (docs/31 #7). No W row builds a workflow member. So
failure mode #7's specific fix (the dispatch-window retry, and the `via:'stop_member'`/`admitted`
branch) remains inert and unpinned; W6 pins current plain-run behavior, not the race #7 names.

## Required corrections

1. **P1 (#6) — re-pin the fallback positively.** Add a W row that forces `materialize` into the
   `refs/baton/results/*` fallback and asserts it returns the *correct* sha by path existence, not
   the newest pin: give one member a preserved pin but an empty/absent result section, seed at least
   one **newer** sibling pin under `refs/baton/results/*` whose tree does not carry that member's
   `report`, and assert the returned `resultSha` is the older, path-carrying pin (the `git cat-file -e`
   success at `wave.mjs:231-232`). This makes the start-time window, used-sha exclusion, and
   path-existence disambiguation load-bearing again after the P1-A fix removed W7's incidental
   coverage.

2. **P1 (#7) — pin the dispatch-race retry or narrow the doc.** Either exercise a member whose
   `run.act('stop_member')` throws `application_action_scope_mismatch` /
   `application_workflow_member_stop_unavailable` for a bounded window before admitting, and assert
   `stopMember` returns `{ admitted: true }` only after the retry loop (`wave.mjs:190-204`) spins past
   the unassigned-`taskId` window — proving the `via:'stop_member'` branch and its `timeoutMs`
   deadline are real; or, if waves genuinely cannot host a workflow member yet (issue #12), narrow
   docs/31 #7 to "plain-run `run.stop` only; the workflow dispatch-race retry is unpinned pending
   nested orchestration" so the doc stops claiming coverage the surface cannot reach.

3. **Non-blocking — align the suite banner.** `test:1-4` advertises "pin-fallback ambiguity" and
   "stopMember dispatch races" as pinned failure modes. Until 1–2 land, that banner overstates
   coverage relative to what the rows actually hold; reword it so the green suite does not read as
   broader than it is. Re-run `node --test impl/test/wave-driver-red.test.mjs` (exit 0) after the
   corrections, and confirm the new assertions are non-vacuous (they must fail if the fallback or
   the retry path regresses).
