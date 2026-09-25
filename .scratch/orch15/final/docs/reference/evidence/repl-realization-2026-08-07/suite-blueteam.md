# #69 BLUE-TEAM VERDICT — `suite-blueteam.md`

Attacked the red-keeping power of `impl/test/repl-realization-red.test.mjs` (32 rows: 22 RED /
10 PIN) against the folded REPL-realization contract v1.1 (`repl-realization-contract.md` v1.1 +
`contract-fold.md`). Read-order executed: contract v1.1 → fold → the red suite → draft-notes.

**Verdict: NEEDS-FOLD.** The suite is honest at HEAD (both splits match the header; all 22 RED
rows fail at their NAMED stages; the 10 passes are exactly the PIN rows) and hermetic (mkdtemp,
no network, no clocks, NUL discipline holds). But it carries **four green-side blockers** — rows a
CORRECT v1.1 implementation cannot turn green (F1, F2, F3, F4) — plus shallow-greenability holes
(rows an INCORRECT implementation can game: F5–F13), missing-row gaps (F14–F16), and one
stage-honesty decay (F18). The R9 strip-`#` attack named in the brief is checked and CLEAN (B3's
oracle blocks it). The R10/R11 attacks named in the brief are OPEN (F6, F5).

## Verified split (two consecutive runs from the repo root, current HEAD)

```
$ node --test impl/test/repl-realization-red.test.mjs
run 1: tests 32 · pass 10 · fail 22 · cancelled 0 · skipped 0 · todo 0  (≈477 ms)
run 2: tests 32 · pass 10 · fail 22 · cancelled 0 · skipped 0 · todo 0  (≈459 ms)
```

Deterministic. The 10 passes are exactly the PIN rows (A4, B2, B4, C3, E3, F3, F4, G3, H3, I1).
The 22 failures are the RED rows (A1, A2, A3, B1, B3, C1, C2, C4, C5, D1, D2, D3, D4, E1, E2,
F1, F2, G1, G2, H1, H2, H4); each fails at its NAMED stage — the first-failing assertion of every
row carries the exact stage string (verified on the failure output).

---

## 1. Green-side blockers FIRST — rows a CORRECT v1.1 implementation cannot go green

### F1 — G2 (R10 own-run positive path) is un-greenable: phantom `taskId 'task-x'`

- **Row/gap.** G2 calls `coordinator._replCiteInOwnRun('task-x', 'repl:shared:result@1')` and
  asserts `own.cellId === cellA.cellId`. The fixture creates only `task-g2` (`taskId =
  \`task-${name}\`` in the fixture); `task-x` exists nowhere.
- **Attack.** The contract's R10/D3 server-derives `runId` from the caller's task (the
  `contextRead` pattern: `const runId = task.runId ?? null`). `store.task('task-x')` returns null
  (`store.task` = `_tasks.get(id) ?? null`, coordination-store.mjs:8880) → a correct
  task-derived implementation gets `runId = null` → the citation cannot resolve in the caller's
  own run → the positive-path assertion fails. Verified in a scratch replica of the fixture:
  `store.task("task-x") => null`, while the real task resolves `runId=run-repl23`. The row is
  greenable only by an implementation that does NOT derive the run from the task (a fallback to
  the fixture's single run) — the exact shallow behavior the row exists to kill.
- **Fix.** Bind the positive path to a real task in the fixture's run (`task-g2`, which resolves
  to `run-repl23`); and add a true foreign-run negative: a taskId belonging to a DIFFERENT run,
  with a citation that RESOLVES in that foreign run, must refuse `repl_citation_out_of_run`.

### F2 — H1 (D7 render order) depends on the #79 pending-attention block (cross-contract)

- **Row/gap.** H1 asserts `pendingAt >= 0` — the `## Pending attention` section renders — and
  `ambientAt < citedAt < pendingAt`. The #79 surface is RED at HEAD: neither renderer handles
  `attention` (grep `attention|Pending attention` over `adapter.mjs` and `cli-adapters.mjs`
  returns nothing), and fold blocker 8 pins the #79 surface as an independent, not-landed row
  ("the REPL rows are defined independently … a #79 fold-order change cannot renumber them").
- **Attack.** A correct REPL-only implementation has NO `## Pending attention` → H1 fails at the
  `pendingAt >= 0` assertion, which is about a different contract. The row cannot go green on the
  v1.1 realization alone. After the REPL seam lands, H1's failure also MOVES off its named stage
  (`renderBrief-repl-objects-missing`) onto the #79 assertion — contradicting the row map's
  "fails at its NAMED stage … goes green on the v1.1 implementation ONLY" claim (F18).
- **Fix.** Split the row: (a) a REPL-only order pin (Verification ahead, Ambient → Cited) that is
  greenable on v1.1 alone; (b) the `## Pending attention` tail gated on #79 landing (skip/pending
  until then), or dropped from this suite (the #79 suite owns it).

### F3 — E1 (D5 promotion provenance) forces an un-pinned auto-inference mechanism

- **Row/gap.** E1 calls the bare shipped `store.admitReplBinding({scope:'shared', name:'result',
  cellId: workerCell.cellId, manifestDigest}, replAuth('orchestrator', 'e1:promote'))` — NO
  `promotedFrom` input — and expects the returned binding to carry `promotedFrom: {scope:
  'worker:w1', name:'result', bindingVersion:1}`.
- **Attack.** The shipped `admitReplBinding` (coordination-store.mjs:15537) records no
  `promotedFrom` (verified in a scratch run of the exact E1 calls:
  `promoted.binding.promotedFrom => "UNDEFINED"`). The only green path forces the store to
  AUTO-INFER promotion by matching an existing worker binding on `(name, cellId)` in the same
  run — a mechanism the contract's D5 never pins (D5 says the promotion ACT records the
  coordinates; the fallback is cell-authority-derived provenance, not name+cell auto-detection,
  which has spurious-promotion false positives). A correct facade-driven implementation (D5's
  `_promoteReplObject` threading `promotedFrom` through) fails E1's bare-call oracle.
- **Fix.** Drive E1 through `coordinator._promoteReplObject({scope:'worker:w1', name:'result',
  bindingVersion:1}, orchestratorCaller)` and assert the promoted shared binding records
  `promotedFrom`; or pass `promotedFrom: {scope, name, bindingVersion}` explicitly in the
  `admitReplBinding` fields and assert it is recorded verbatim.

### F4 — A3 / F1 / H2 `Object.keys` insertion-order over-pins contradict the contract

- **Row/gap.** A3 asserts `Object.keys(composed.replObjects[0])` deepEqual
  `['bindingVersion','cellId','citation','digest','head','name','scope']` (sorted). F1 asserts the
  review entry keys deepEqual `['branchCount','manifestDigest','principal','replRole']` (sorted).
  H2 asserts `Object.keys(coordinatorNs.REPL_OBJECT_REFUSAL_CODES)` deepEqual the sorted family.
- **Attack.** `Object.keys` is INSERTION order. These require the implementation to construct each
  object with keys in SORTED order. The contract documents the entry shape as `{citation, scope,
  name, bindingVersion, cellId, digest, head}` (D2), the review entry as `{manifestDigest,
  replRole, principal, branchCount}` (D6), and lists the refusal codes in a NON-sorted order
  (refusal vocabulary). A correct implementation built in the contract's documented field order
  fails all three — a false-red on a correct v1.1 implementation.
- **Fix.** Assert the shape order-independently (`assert.deepEqual(Object.keys(record).sort(),
  SORTED_KEYS)`), or fold an explicit "constructed in canonical sorted-key order" pin into the
  contract.

---

## 2. Shallow-greenability — rows an INCORRECT implementation can game

### F5 — D3 (R11): the fan-out facade is never called; the row tests already-shipped store machinery

- **Row/gap.** D3 checks `typeof coordinator._admitSharedFanout === 'function'`, then manually
  admits the shared manifest + binding into `runA`/`runB` via `admitManifest` +
  `store.admitReplBinding`, and asserts per-run resolution and a third-run refusal.
- **Attack.** The manual admits and per-run resolution are the SHIPPED per-`runId` store machinery
  (G3's territory). Verified in a scratch replica of the D3 fixture: the store ops resolve
  `repl:shared:obj@1` in both `runA` and `runB` and refuse a third run — with NO facade involved.
  So a no-op `_admitSharedFanout`, or one that admits into only the FIRST member's run, makes D3
  green while R11 is violated. This is exactly the brief's R11 attack.
- **Fix.** CALL `_admitSharedFanout` with the member runs + binding fields (e.g.
  `_admitSharedFanout({ members: [runA, runB], name:'obj', cellId, manifestDigest })`) and then
  assert `resolveReplCitation` resolves in EVERY member's own run AND refuses an unbound run —
  without the manual per-run admits.

### F6 — R10: no row exercises the real `baton_repl_cite` port or a resolvable foreign-run citation

- **Row/gap.** G1 is a static string scan of `mcp-northbound.mjs` (asserts the source contains
  `repl_citation_out_of_run` and `_replCiteInOwnRun`); G2 tests the coordinator facade, not the
  MCP port. The shipped port still does `value = this.coordinator.resolveReplCitation(args.runId,
  args.citation)` (mcp-northbound.mjs:2006-2008) — the caller-supplied-runId #143 escape.
- **Attack.** G1 is gamed by a comment or a dead `_replCiteInOwnRun`; G2's negative case only
  tests a citation that does NOT resolve in the caller's own run. Neither passes a taskId
  belonging to another run with a citation that DOES resolve in that foreign run — the actual
  cross-run read. An implementation that leaves the port trusting a caller-supplied runId passes
  the suite. (See F1: G2's positive path is currently un-greenable as written.)
- **Fix.** Add a behavioral row dispatching `baton_repl_cite` with a foreign runId whose citation
  resolves in that foreign run → must refuse `repl_citation_out_of_run`; and make G2's positive
  path resolve in the caller's REAL task run (F1).

### F7 — I1: the no-arbitrary-code scan is a closed 4-file list, not the module graph

- **Row/gap.** I1 scans only `adapter.mjs`, `cli-adapters.mjs`, `coordinator.mjs`, `messages.mjs`.
  `coordinator.mjs` alone imports 11+ local modules (log, limits, route-tuple,
  northbound-capability-authority, provider-governance, worktree, goal-plan, browser-use, usd,
  result-export, task-topology, run-lineage, verifier-diagnostics); `mcp-northbound.mjs` (the
  `repl.cite` port, part of the seam's module graph) is not scanned at all.
- **Attack.** The brief's "walkImportGraph transitive discipline" gap is real: an implementation
  that adds the REPL-object serving in a NEW module, or places an evaluator in any transitive
  module of the lane, passes I1. The regexes also miss `Function(...)` without `new`,
  `import(variable)`, `(0,eval)(...)`, `setTimeout('code')`, and `vm.*` entrypoints.
- **Fix.** Walk the transitive static-import graph from the seam entrypoints (coordinator, adapter,
  cli-adapters, messages, mcp-northbound) and scan every reachable module for the evaluator
  family; and assert the graph is closed (no dynamic import).

### F8 — E2: an always-refuse promotion facade passes

- **Row/gap.** E2 requires only that `_promoteReplObject` THROW `repl_object_unauthorized` for a
  non-orchestrator caller. No row requires a legitimate orchestrator promotion to SUCCEED through
  the facade (E1 bypasses it via the bare store call).
- **Attack.** An implementation whose facade permanently refuses every call passes E2 and the
  suite — the D5 promotion positive path is untested.
- **Fix.** Add the positive promotion row: an orchestrator caller + an existing worker binding →
  the facade performs the shared rebind, records `promotedFrom`, and is replay-safe (idempotent).

### F9 — F2: a reject-everything review guard passes

- **Row/gap.** F2 requires only that `_assertReplReviewProjection` refuse a record carrying a
  shadow field. No row asserts a clean 4-field record PASSES.
- **Attack.** An implementation whose guard rejects ALL records passes F2 — D6's review-by-
  projection admits nothing and the row cannot tell.
- **Fix.** Add a positive assertion: the closed 4-field review record passes the guard clean.

### F10 — C4/C5: the spill round trip is never closed

- **Row/gap.** C4 asserts `typeof coordinator._resolveReplSpill === 'function'` but never calls it;
  the `spill:sha256:<digest>` entry is checked only for the HEX64 shape. C5 checks the
  `(truncated)` marker and the boundary item's citation but never resolves the spilled full text.
- **Attack.** A fake `spill:sha256:<64 hex>` entry (not a real digest of anything) and a
  `_resolveReplSpill` that returns nothing useful pass. The "the worker resolves the spill" half
  of both round trips is untested.
- **Fix.** Call `_resolveReplSpill(runId, served.spill)` and assert it returns the spilled object
  (C4: the 9th object; C5: the dropped items' full text), and assert the digest equals the real
  sha256 of that content.

### F11 — C1/C2: the registry rows are decorative; C5/H4 hardcode the bounds

- **Row/gap.** C1/C2 assert the rows EXIST in `FRAME_LIMITS`; C5 passes `maxBytes: 4096`
  explicitly and H4 passes `{spillLane: false}`. No row verifies the seam consults
  `FRAME_LIMITS['view.repl_object.items' / 'bytes']`.
- **Attack.** An implementation that hardcodes 8/4096 in the seam (rows unused) passes C1, C2,
  C5, H4. The D7 "the row is the bound" discipline is untested.
- **Fix.** Drive the shed/oversized bounds from the registry rows (drop the explicit `maxBytes`),
  or mutate a row value in the test and assert the seam follows it.

### F12 — C5: an always-truncate / always-shed implementation passes

- **Row/gap.** C5 exercises only the over-budget case (8×600 > 4096). No row asserts an
  under-budget set renders UN-truncated (A1/A2 use short heads but never assert absence of
  `(truncated)`).
- **Attack.** An implementation that sheds/truncates the boundary on EVERY serve passes C5 while
  violating "sheds at the byte bound" (D7).
- **Fix.** Add the under-budget positive: 8 short heads → all serve, no `(truncated)` marker.

### F13 — D4: the run-close reap auto-wiring is untested

- **Row/gap.** The row calls `store.reapRunReplBindings(runId)` manually. The contract's "when a
  run closes, the active-binding map … dropped" auto-invocation is never verified.
- **Attack.** An implementation that adds the method but never wires it into the real run-close
  path passes D4 — task-ephemeral bindings survive close in practice.
- **Fix.** Drive the real run-close path (or assert the store invokes the reap on `admitRunStop` /
  close) and then check the active snapshot is empty and history is retained.

---

## 3. Missing-row gaps

### F14 — `repl_object_manifest_unadmitted` is never fired

H2 includes the code in the frozen family; no row triggers D6's integrity guard (a review
projection referencing a manifestDigest with no admission record). Add a row where
`_replManifestReview`/`_assertReplReviewProjection` references an unadmitted `manifestDigest` →
refuses `repl_object_manifest_unadmitted`.

### F15 — renderPrompt's D7 order and R9 sanitize are untested

B3 (sanitize) and H1 (order) exercise only `renderBrief`. `renderPrompt`'s single-line-leaf seam
(R9), its Ambient → Cited → Pending order, and the Verification-contract position (D7) are
untested — an implementation that forgets the prompt side passes. Mirror B3 and H1 for
`renderPrompt`.

### F16 — `_citedReplObjects` has contradictory return shapes across rows

C4 expects `{inBlock, spill}`; D1/D2 expect an ARRAY (`.length`, `.some`, index `[0]`). The
contract says `inner.replObjects` is an ordered array (D2). A single method cannot naturally
return both — the implementer must guess an overflow-conditional shape or an
array-with-attached-properties hybrid, neither documented by the suite. Pin ONE return shape
(e.g., always `{records, spill}` with `records` the ordered array) and update D1/D2/C4 to it.

---

## 4. Stage honesty + hermeticity

### F17 — HEAD stage honesty and hermeticity HOLD (verified)

- Every one of the 22 RED rows fails at its NAMED stage at HEAD: the first-failing assertion of
  each carries the exact stage string (checked on the run output).
- The 10 passes are exactly the PIN rows; two consecutive runs are identical (no order-dependence;
  fixtures use unique per-test names; no shared mutable globals).
- Hermetic: `mkdtempSync` logs only, global `test.after` cleanup, `ScriptableAdapter`, mock
  worktrees, no network, no `Date.now`, no `localeCompare`.
- NUL discipline: the five suite-read sources (`adapter.mjs`, `cli-adapters.mjs`,
  `coordinator.mjs`, `messages.mjs`, `mcp-northbound.mjs`) and the suite file are 0-NUL; the two
  forbidden files (`application.mjs`, `coordination-store.mjs`) carry 3 NUL bytes each and are
  only imported (`projectReplBindingView`, `CoordinationStore`/`coordinationForLog`/
  `CoordinationRefusal`) — never whole-file-read.

### F18 — H1's stage honesty decays post-implementation

After a correct REPL seam lands, H1's failure moves from its named stage
(`renderBrief-repl-objects-missing`) to the #79 `pendingAt` assertion (F2). The row map's "fails
at its NAMED stage" and "goes green on the v1.1 implementation ONLY" claims both break for this
row.

### F19 — Citation drift (documentation-only; the suite asserts no line numbers)

The suite header and `suite-draft-notes.md` cite fold-HEAD anchors that have drifted at the
current HEAD (`5c7231b` is far ahead of the fold HEAD `ba44260c`; `coordination-store.mjs` is now
17206 lines). Re-verified at the current HEAD (NUL-safe `grep -an`/`sed -n`):

| Suite/draft-notes anchor | Current HEAD |
|---|---|
| `admitReplBinding` :15320-15418 | :15537 |
| `resolveReplCitation` :15512-15522 (`repl_binding_citation_not_found` :15514,:15519) | :15729 (:15731,:15736) |
| `admitReplManifest` :9936-10048 | :9971 (function start) |
| `dropReplBinding` :15422-15496 | :15639 |
| `projectReplBindingView` application.mjs:681-712 | :690 |
| CONTEXT_READ spill block coordinator.mjs:10774-10788 | :10780-10808 |
| `spill.body` limits.mjs:85 | :86 |
| `composeFrameLimitRefusal` limits.mjs:40-42 | :40 |
| `baton_repl_cite` mcp-northbound.mjs:1999 | :2006-2008 (still `resolveReplCitation(args.runId, args.citation)`) |

---

## The R9 / R10 / R11 attacks named in the brief — disposition

- **R9 (strip-`#` sanitizer)** — **BLOCKED, clean.** B3 asserts `leaf.includes('## Pending
  attention')`; a sanitizer that strips `#` fails the preservation assertion. B3 also pins the
  single-line leaf and the no-new-prompt-section outcome.
- **R10 (membership check trusting the caller's CLAIMED task)** — **OPEN (F1, F6).** G2's
  positive path is un-greenable as written (phantom `task-x`), and neither G1 nor G2 drives the
  real port or a resolvable foreign-run citation.
- **R11 (fan-out admitting only the first member's run)** — **OPEN (F5).** D3 never calls the
  facade; a first-member-only or no-op `_admitSharedFanout` passes.
- **No-arbitrary-code static row (indirect import / walkImportGraph gap)** — **OPEN (F7).** The
  lane is a closed 4-file list; transitive modules and new files are unscanned.

## Bottom line

The suite's HEAD behavior and hygiene are exemplary, but its red-keeping power does not yet pin
the folded contract: four rows cannot go green on a correct v1.1 implementation (F1, F2, F3, F4),
and the suite's two highest-value pins — R10 and R11 — are currently gameable (F5, F6). Fold the
F1–F16 fixes into the suite before it is trusted as the acceptance harness.
