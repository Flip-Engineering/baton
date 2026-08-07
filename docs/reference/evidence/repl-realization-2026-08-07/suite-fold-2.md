# #69 SUITE-FOLD 2 — `suite-blueteam.md` (F1–F8) → `repl-realization-red.test.mjs`

Fold of the blue-team verdict (`suite-blueteam.md`, **NEEDS-FOLD — F1–F8**) into the
REPL-realization red-first suite (`impl/test/repl-realization-red.test.mjs`, 32 rows → **34 rows
— 24 RED / 10 PIN**). Fold HEAD: `7a82fe1eac8d47a9c5ac5027e2dc5114dd35149b` (the Baton private
effective-tree snapshot; the blue-team report `39e22f5` is its parent). The fold touches ONLY the
suite file, `suite-draft-notes.md`, and this map — no contract movement (`repl-realization-contract.md`
stays v1.1; every folded row lands against the v1.1 seam the suite already pins).

Every finding is folded into the suite. F1–F4 are the green-side blockers (rows a CORRECT v1.1
implementation could not go green as written) and are re-wired, not just hardened; F5–F8 close the
shallow-greenability holes. The PIN set is unchanged (A4, B2, B4, C3, E3, F3, F4, G3, H3, I1 — 10).

## Findings → resolutions (all 8)

| # | Finding (blue-team) | Folded into the suite |
|---|---|---|
| F1 | **G2 phantom `taskId 'task-x'`** — the own-run positive path cited a task that does not exist (`store.task('task-x') => null`), so a correct task-derived implementation got `runId = null` and could not go green. | G2's positive path now binds `coordinator._replCiteInOwnRun(f.task.id, 'repl:shared:result@1')` — the fixture's REAL task (`task-g2` → `run-repl23`) — and asserts `own.cellId === cellA.cellId`. The negative is now a TRUE foreign-run case: `run-g2-foreign` with a citation that RESOLVES there (precondition-asserted via `store.resolveReplCitation(runForeign, 'repl:shared:foreign@1')`), which must refuse `repl_citation_out_of_run` from the caller's own run. |
| F2 | **H1 depends on the #79 pending-attention block** — the row asserted `## Pending attention` renders (`pendingAt >= 0`), which no correct REPL-only implementation ships; after the seam lands the row's failure would move off its named stage. | H1 split: it now pins ONLY the REPL-owned order — the `## Verification` contract stays AHEAD of the data sections, and `## Ambient knowledge` → `## Cited REPL objects` (D7). The `## Pending attention` tail is dropped from this suite entirely (F18's stage decay is gone with it); the #79 suite owns that row. |
| F3 | **E1 forces an un-pinned auto-inference mechanism** — the row called the bare shipped `store.admitReplBinding` and expected `promotedFrom` to appear, which the store cannot record without the contract's D5 facade or a spurious name+cell auto-detector. | E1 now drives the D5 facade: `coordinator._promoteReplObject({scope:'worker:w1', name:'result', bindingVersion:1, runId, cellId, manifestDigest}, {actor:'direct:orchestrator', principalId:'orchestrator', key:'e1:promote'})` and asserts the promoted shared binding carries `promotedFrom === {scope:'worker:w1', name:'result', bindingVersion:1}`. A correct facade-driven implementation records the coordinates; the pinned mechanism is D5, not store auto-inference. |
| F4 | **`Object.keys` insertion-order over-pins** — A3/F1/H2 required each object's keys in SORTED order, but `Object.keys` is insertion order; a correct implementation built in the contract's documented field order failed all three (false-red). | All three key comparisons are now order-independent: A3 asserts `Object.keys(composed.replObjects[0]).sort()` deepEqual `[...REPL_OBJECT_ENTRY_KEYS].sort()`, F1 asserts `Object.keys(entry).sort()` deepEqual `['branchCount','manifestDigest','principal','replRole'].sort()`, H2 asserts `Object.keys(REPL_OBJECT_REFUSAL_CODES).sort()` deepEqual the frozen family `.sort()`. |
| F5 | **The fan-out facade is never called** — D3 manually admitted the shared manifest + binding per run and asserted resolution, so a no-op or first-member-only `_admitSharedFanout` passed while R11 was violated. | D3 now CALLS the invented facade — `coordinator._admitSharedFanout({members:[runA, runB], name:'obj', cellId, manifestDigest})` — asserts the returned `runIds` covers every member, and then asserts `resolveReplCitation` resolves in EACH member's OWN run and refuses an unbound third run. No manual per-run `admitReplBinding` anywhere: the facade mints the per-member admits at spawn. |
| F6 | **No row exercises the real `baton_repl_cite` port or a resolvable foreign-run citation** — G1 was a static string scan, G2 tested the coordinator facade; the shipped port still honors a caller-supplied runId (mcp-northbound.mjs:2006-2008, the #143 escape). | New **G4** row builds a real `McpFleetServer` (the principal carries the fixture's real `taskId`) and dispatches `server._dispatch('baton_repl_cite', {repoId, runId: runForeign, citation}, null, callId, principal)` where `runForeign`'s citation RESOLVES there (precondition-asserted). The port must refuse `repl_citation_out_of_run` — a caller-supplied foreign runId is the #143 boundary violation. G2's positive path is also bound to the real task (F1). |
| F7 | **The no-arbitrary-code scan is a closed 4-file list** — I1 scanned only `adapter.mjs`, `cli-adapters.mjs`, `coordinator.mjs`, `messages.mjs`; transitive modules and the MCP port were unscanned, and the regexes missed `(0, eval)(`, bare `Function(`, `import(variable)`, `setTimeout('code')`, `vm.*`. | I1 rewritten as the F7 closure: walk the lane's TRANSITIVE module graph from 5 roots (adapter, cli-adapters, coordinator, messages, **mcp-northbound**) through static-relative AND string-literal-dynamic import edges (47 modules at HEAD), scanning every reachable module for the evaluator family — `eval(`, `(0, eval)(`, `new Function(`, bare `Function(`, `setTimeout("code")`, `vm.*(`. The dynamic-import closure check requires every `import(...)` argument to be a string literal OR a module-scope const string literal (`moduleConstString`); a variable/expression dynamic import is a violation. Closure is asserted by reachability of `application-client.mjs` / `workflow-interpreter.mjs` (reached ONLY via application.mjs's lazy `import()` edges) and by `seen.size > roots.length`. The `walkImportGraph` string scan tolerates the 3 NUL bytes in `application.mjs` / `coordination-store.mjs` (the established NUL discipline). |
| F8 | **An always-refuse promotion facade passes** — E2 required only that a non-orchestrator refuse; no row demanded a legitimate orchestrator promotion SUCCEED. | New **E4** row: an orchestrator caller + an existing `worker:w1` binding → `coordinator._promoteReplObject(fields, caller)` MUST succeed (`first.binding.scope === 'shared'`, `promotedFrom` records the promoted coordinates), and the replay returns `{result:'idempotent'}` with the SAME `event.seq` — replay-safe. A permanently-refusing facade now fails E4 even though it passes E2. |

## What changed in the suite file

- **Rows added (2, both RED):** E4 (D5/F8 promotion positive, stage `repl-promotion-positive-missing`)
  and G4 (R10/F6 real port, stage `repl-cite-run-boundary-missing`).
- **Rows re-wired (5):** D3 calls `_admitSharedFanout` (F5); E1 drives `_promoteReplObject` (F3);
  G2 binds the real task + foreign-run negative (F1); H1 split off the #79 tail (F2); I1 walks the
  transitive graph (F7).
- **Rows hardened (3):** A3/F1/H2 key comparisons now order-independent `.sort()` (F4).
- **Invented surfaces:** `_admitSharedFanout` signature pinned to `{members, name, cellId,
  manifestDigest}` (F5); the MCP principal `taskId` field added as a first-class invented surface
  (F6); `_replCiteInOwnRun` and `_promoteReplObject` documented with their folded call shapes.
- **Header / hygiene:** row inventory now 34 rows (24 RED / 10 PIN); the NUL-discipline note names
  the I1 graph-walker string scan as the one whole-file-read of the NUL-bearing sources.

## Deliverable status

- `impl/test/repl-realization-red.test.mjs` — **34 rows (24 RED / 10 PIN)**; verified split below.
- `docs/reference/evidence/repl-realization-2026-08-07/suite-draft-notes.md` — updated (row map,
  invented surfaces, PIN list, implementer's checklist, suite-law hygiene).
- `docs/reference/evidence/repl-realization-2026-08-07/suite-fold-2.md` — this map (all 8).
- `repl-realization-contract.md` — **unchanged (stays v1.1)** — no finding required contract
  movement; the R10/R11/D5 pins the findings reference are already in the v1.1 contract.

### Verified split (two consecutive runs from the repo root, fold HEAD)

```
$ node --test impl/test/repl-realization-red.test.mjs   # run from repo root
run 1: tests 34 · pass 10 · fail 24 · cancelled 0 · skipped 0 · todo 0  (≈2760 ms)
run 2: tests 34 · pass 10 · fail 24 · cancelled 0 · skipped 0 · todo 0  (≈2390 ms)
```

Deterministic. The 10 passes are exactly the PIN rows (A4, B2, B4, C3, E3, F3, F4, G3, H3, I1);
the 24 failures are the RED rows, each confirmed to fail at its NAMED stage — the first-failing
assertion of every row carries the exact stage string (verified on the run output). The deployment
verification stub is the brief's `true` command (argv `[]`, cwd `.`, expected exit 0).
