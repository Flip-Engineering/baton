DEATH-CERTS-VERIFY v1
[attempt: 04e62c4a-56bd-4fe5-9b6f-ea7365e2ba95 coordinator]
Wave: death-certs-2026-08-15-wave-g
VERDICT: needs-fold with blockers
Scope: docs/reference/evidence/death-certs-2026-08-15/wave-g/**

## Summary

The row `row-death-certs` settled with **no on-disk deliverable**. There is no implementation of
the death-cert terminal-event enrichment (#225), no `notes-row-death-certs.md`, no
`impl/test/death-certs-red.test.mjs` pin suite, and no row HEAD commit. The wavefile's
`signalOnMembersDone` path (`"The row settled (you are the remaining member — pinned #175
semantics)"`) did not surface to this session, and the hub roster shows no row peer. Every
acceptance criterion in `row-death-certs-brief.md` is unmet. This report carries the required
marker line `DEATH-CERTS-VERIFY v1`; the verdict is negative.

Motivating measurements (cited verbatim from the coordination ledger, 2026-08-14, as given in the
coordinator brief — not re-measured here):
- 18:06:51-18:07:00Z: 11 lifecycle.crashed events, every one envelope-only
  {worker, workerSeq, digest, kind, ts} — zero cause payload.
- All-time: 453 lifecycle.process_closed ledger rows, none carrying a cause-class field
  at the LEDGER surface (the latch's closeFact may hold it — the mapping is the suspect).

## Verification evidence (all repo-grounded)

- **E1 — Working tree clean at the coordinator base.** `git status` is empty; HEAD is
  `fc9733ff fix(#236): omp turn_completed carries the VERDICT`. The scoped evidence dir
  `docs/reference/evidence/death-certs-2026-08-15/` in this worktree contains only `wave-c/`,
  `wave-d/`, `wave-e/`, `wave-f/` — no `wave-g/`. The wave-g briefs exist only on `master`
  (two commits past this base: `24f4a0b5 docs: wave-g — the definitive fleet run`, `5297ac50
  baton workflow base phantom-root-2026-08-15-wave-g`), never on this worktree's branch.
- **E2 — Row notes absent.** The required
  `docs/reference/evidence/death-certs-2026-08-15/wave-g/notes-row-death-certs.md` (harvest
  `mustContain "attempt:"`) does not exist on any branch, on `master`, or in any checkpoint.
  The only `notes-row-death-certs.md` in the object store is for **wave-d** (path
  `.../wave-d/notes-row-death-certs.md`, 113 lines), reachable solely from the orphan checkpoint
  `69e7af20` — never merged.
- **E3 — Pin suite absent; no row HEAD exists.** `impl/test/death-certs-red.test.mjs` is absent
  from `master`, from every `baton/ws-*` branch, and from this worktree. It exists only inside
  two **unmerged orphan checkpoint snapshots**: `69e7af20` (wave-d row, 377 lines) and
  `dc9d61ee` (wave-e row, 296 lines, plus `claude-session.mjs`/`coordinator.mjs` edits). No
  checkpoint or branch post-dates the wave-g worktree creation — there is no wave-g row HEAD to
  run anything at.
- **E4 — No wave-g row commit exists, committed or dangling.** All nine wave-g worktree branches
  (`ws-133f7cb2 … ws-f5370b83`, created 2026-08-19T04:49-04:51Z) were created from `fc9733ff`
  and only ever reset-to-HEAD; all nine working trees are clean. The most recent checkpoint
  commit is `fd6c0176` (2026-08-18 18:21:32 -0700 ≈ 01:21:32Z, pre-wave-g); `git fsck
  --no-reflogs --unreachable` shows no dangling commit newer than ~00:33Z. The wave-g row
  produced, committed, and left nothing.
- **E5 — Enrichment absent at HEAD.** `grep causeClass|cause_class|cause-class impl/src` returns
  no matches (the only matches repo-wide are the unrelated `suite-resource-governance` cause-class
  vocabulary in a pre-existing test). `processClosedPayload` remains
  `{schemaVersion, generation, pid, processGroupId, code, signal, ready}` — no route tuple, no
  provider cause class. No bounded 4KiB stderr/stdout tail capture exists in the
  `claude-session.mjs` emit paths (no stdout/stderr tail fields; the only `maxBuffer`/frame
  constants are the pre-existing 64KiB/1MiB capture limits). The close facts still die at the
  envelope; the mapping suspect identified in the brief is untouched.
- **E6 — Hub state.** `hub list` reports no other agents; the row's settle signal
  (`signalOnMembersDone`) was not delivered to this session. Whether the row task ever dispatched
  is unobservable from this worktree.
- **E7 — Issue source unavailable.** `gh` is unauthenticated in this worktree, so issue #225
  could not be read from GitHub. The contract was grounded in `row-death-certs-brief.md` (the
  closed four-point contract) and the wave-a docs commit `3297ce13`, which states the #225 pack
  intent verbatim (exit/signal/route/provider-cause + bounded 4KiB tails; red-first pin: three
  distinguishable kills nameable from the ledger).

## Acceptance check (per row-death-certs-brief.md)

| Criterion | Result | Evidence |
|---|---|---|
| process_closed/crashed ledger events carry exitCode, signal, route tuple, provider cause class when the fact exists | FAIL | E5: payload shape unchanged; no enrichment commit (E4) |
| Bounded 4KiB stderr/stdout TAIL on terminal event, SECRET_SHAPED_TEXT redaction, no new event kind | FAIL | E5: no tail fields or redaction path added |
| No clocks, no retries, no behavior change; terminal semantics byte-stable | vacuous-pass | nothing changed at HEAD (E1/E4) — nothing to regress |
| Red-first pin suite `impl/test/death-certs-red.test.mjs`: SIGKILL / exit-137-style / provider-429 kills each NAMED by the terminal event; RED at pre-change head, GREEN after | FAIL | E3: suite absent from every branch; RED/GREEN both un-runnable |
| Hard bounds: no new commands/registry/MCP surfaces; additive hunks only; never edit existing suites to pass | vacuous-pass | no hunks at all (E4) |
| Coordinator battery (58/58) green unchanged; adapter suites green | vacuous-pass | impl byte-identical to base (E1/E5); unchanged is trivially green-but-unexercised |
| Notes `[attempt: <salt> row-death-certs]` in first five lines | FAIL | E2: notes file absent |

## Spot-audit of two claims

The row brief's contract requires the row to surface claims with evidence. The row surfaced
**no claims** — no notes and no code — so the audit is vacuous on an empty deliverable. The only
implicit claim (that an enrichment implementation and a red-first suite exist at the row's HEAD)
is directly refuted by E3/E4/E5. The ledger measurements cited in the brief remain true at HEAD:
the crash cluster still lands envelope-only because no enrichment exists to change that.

## Unverified / why

- **Why the settle signal fired with no row work.** Per the gate-digest precedent (the same
  `signalOnMembersDone` + `#175` semantics), a row can "settle" while producing nothing. Whether
  the wave-g `row-death-certs` task ever dispatched — and why no checkpoint, notes, or commit
  exists despite the wavefile's claim flow — is not observable from this worktree (E6).
- **Row-side rationale.** With no `notes-row-death-certs.md`, the row recorded no judgment calls
  and no DECISION_REQUEST; any stall reason is unknowable from the repo.

## Judgment calls recorded

1. Marker line `DEATH-CERTS-VERIFY v1` carried verbatim (harvest requirement) despite a negative
   verdict — consistent with the `GATE_DIGEST-VERIFY v1` precedent, where the line names the
   verification run, not the outcome.
2. Verdict classification `needs-fold with blockers` follows the identical gate-digest precedent
   for "row settled with no on-disk deliverable."
3. The coordinator battery was not executed: with the impl tree byte-identical to base, a run
   would exercise nothing new; recorded as vacuous-pass rather than claiming a fresh green.
4. No source was edited; the report and evidence live entirely inside the assigned path scope.

## DECISION_REQUEST — authority-class ambiguity

Ambiguity: the wavefile's flow (`signalOnMembersDone` → "The row settled… pinned #175 semantics")
implies the row completed, yet there is zero work product — no notes, no pin suite, no commit,
no checkpoint, no peer session (E1–E6). Determining *why* (harness dispatch/routing failure vs
row abandonment vs the settle signal firing spuriously) and *whether/how to re-drive* is outside
the coordinator's verification authority, and the coordinator is barred from editing the row's
partition (`impl/src/process-lifecycle.mjs`, `impl/src/claude-session.mjs`,
`impl/src/coordinator.mjs`). Issue #225 remains entirely unimplemented at every reachable HEAD.

Options:
1. **Re-drive `row-death-certs`** (operator/dispatcher authority) — the enrichment is wholly
   absent; the wave cannot be admitted as sound without an implementation and a green pin suite.
2. **Fold this wave as blocked**, recording E1–E7 as the blockers, and require a re-drive before
   #225 can be accepted.
3. **Audit the dispatch path first** — determine why the row settle signal carried no row work
   before spending another seat, to avoid re-driving into the same silence.

Recommendation: **Option 2 now** (fold with blockers), then **Option 3** to audit the dispatch
before any Option 1 re-drive — the complete absence of any wave-g row artifact, commit, and peer
session is itself anomalous and should be understood first. This mirrors the gate-digest wave's
resolution path exactly.
