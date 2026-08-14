# Contract seed — #184 the law-list bug farm

[attempt: 1faf10bb-21ed-41d5-8bc7-540abddb4af6 row-seeds]

Origin: `gh issue view 184` is not reachable (`gh` unauthenticated; number absent from this repo's
history). Grounded per the row brief's fallback ("else the campaign's commit messages and the
evidence dirs") in: the flood scripts (`v19-flood-2026-08-14.sh`, `v16-flood-2026-08-14.sh`), the
persistent launcher (`persistent-launch-2026-08-14.sh`), the generic task-wave driver
(`run-task-wave.mjs`), the driver doc (`docs/37-wave-driver.md`), the frame registry
(`limits.mjs`), and the partition-law language in the wave/row briefs. This seed is the campaign's
"law farm": the operating laws that are TODAY agent-discipline, and for each, the machinery that
would make the trap IMPOSSIBLE — plus the priority order.

- **Date:** 2026-08-14 · **Status:** SEED (Ring-2 draft; red-first; specifies behavior, lands no code)
- **Verification HEAD:** `5ae2c7e5c93d99404d3a292e777dd30f7d2ead27`. Every `file:line` below was
  re-verified this session at this HEAD (grep/sed/Read; NUL discipline on `application.mjs` /
  `coordination-store.mjs`).
- **Scope of the seed, in one sentence:** four campaign operating laws are currently held by agent
  discipline — the 4096−60B brief cap, re-drive key+path bumps, watcher-per-launch, and the
  file-partition law. Each is a TRAP with a machinery fix; this seed names the trap, the machinery
  that removes the failure mode, and the order to land them.

---

## Ground truths (verified this session)

- **G1 — the 4096-byte objective cap is real and declared; the salt eats ~60B of it.** `run.objective`
  = 4096 bytes and `wave.member.objective` = 4096 bytes (`limits.mjs:56-57`), both graceful
  `'spill-digest-citation'`, enforced at run/wave admission. The attempt-echo law (#171) prefixes every
  member objective with `[attempt: <uuid> <role>]` (`contract-foundry-2026-08-13/foundry-brief.md:24-28`;
  `wave.mjs` `saltObjectives`, docs/37-wave-driver.md:77) — 57-58 bytes for this row. The driver
  prechecks at 3800 bytes ("nears the 4096B cap — shorten targets", `run-task-wave.mjs:65`) and the
  driver doc pins post-salt >4096 rejection WITH the byte count (`docs/37-wave-driver.md:90-94,119`).
- **G2 — the cap-naming refusal is NOT in the kernel.** The driver precheck is per-driver; each new
  launcher must remember to implement it. The kernel's oversize throw is the generic
  `application_intent_invalid` family, which does not name the cap (contract-146 fold's citation of
  `application.mjs:1094-1096` — re-verified ABSENT at this HEAD; the generic `application_intent_invalid`
  survives only as an MCP fallback note, `mcp-northbound.mjs:1038`). So the byte count that makes the
  failure actionable exists only where a driver author remembered to add it.
- **G3 — re-drive is real and key-burning is real.** The v19 flood launches "11 bumped (v18/v17-era
  keys burned) + 4 free" (`v19-flood-2026-08-14.sh:4`) and every re-drive carries a bumped spec path
  into a `redrive<N>/` directory (`v16-flood-2026-08-14.sh:22-30`, `v19-flood-2026-08-14.sh:32-58`).
  The persistent launcher has an explicit "already started? (same-key re-fire safety)" guard that
  no-ops a launch whose key fragment already shows a `wave.started`
  (`persistent-launch-2026-08-14.sh:10-15`). A re-drive MUST bump both the idempotency key AND the
  spec path, or it silently replays.
- **G4 — watcher-per-launch is the lived #209 lesson.** The flood's `launch()` does NOT trust the curl
  return; it polls the ledger for `web.command_admitted` (`v19-flood-2026-08-14.sh:21-26`, retries 3×).
  The persistent launcher exists precisely because "the edge still drops requests under drive load —
  #209's lived form" (commit `5939e6bd`), retrying until `wave.started` lands or a deadline
  (`persistent-launch-2026-08-14.sh:16-29`).
- **G5 — the file-partition law is stated per-row and enforced by the wave scope.** Every row brief
  says "Your file partition: `…/**` ONLY. Read-and-run only outside it." (`row-seeds-brief.md:18`;
  honesty/impl row briefs), and every wavefile declares the member `scope "…/**"`. The gate already
  derives `inScopeChangedPathsDigest`/`outOfScopeChangedPathsDigest` per change (`application.mjs`
  debugGateRefusal scope branch — the GT6 shape pinned in
  `worker-delivery-push-2026-08-07/contract-fold.md`). The enforcement exists; the NAMING of
  deliverables is hand-disciplined.

## Decisions

For each law: the trap, the machinery that makes it impossible, and the priority. The priority order
(D5) is a decision, not a list.

### D1 — law: briefs ≤4096−60B (the trap: admission-time discovery after a wasted turn)

- **Trap.** An oversize objective passes the author's turn, then dies at admission with a generic
  error that does not name the cap (G2) — or, worse, is silently accepted because the driver the wave
  used had no precheck. The 60B salt reserve is agent knowledge, not enforced.
- **Machinery that makes it IMPOSSIBLE:** admission-time validation in the kernel that (a) rejects a
  salted objective over 4096 bytes with a typed refusal carrying the ACTUAL byte count and the cap,
  and (b) reserves the salt's byte cost so the author's content budget is `4096 − saltBytes` — the
  salt is metered, never free. The `composeFrameLimitRefusal` coach (limits.mjs:40-42) already gives
  the `{cap, actual, unit}` shape to attach the count to.
- **The admission-time refusal makes the trap impossible because there is no post-hoc state:** the
  wave cannot start, the attempt is spent, and the refusal names the number. The single remaining
  discipline is "the author stays under the budget" — and the refusal tells them the actual.

### D2 — law: re-drive key+path bumps (the trap: silent whole-wave no-op)

- **Trap.** Re-driving a wave with a burned key + the old path is idempotently replayed: the launcher
  sees the prior `wave.started` and no-ops (G3). The operator believes a re-drive ran; nothing did.
- **Machinery that makes it IMPOSSIBLE:** automatic namespacing of the re-drive. The launcher mints the
  `redrive<N>/` directory and the fresh key FROM the ledger (next suffix + next key), never from a
  hand-edited script; AND admission-time validation refuses a `waves.run` whose
  `(idempotencyKey, specPath)` pair collides with an already-admitted pair, with a typed refusal
  naming the collision. When the pair is machine-minted, the "bump" cannot be forgotten.
- **The machinery makes the trap impossible because the identity is derived, not authored:** a re-drive
  that does not bump is unrepresentable.

### D3 — law: watcher-per-launch (the trap: un-watched launch, silent non-admission)

- **Trap.** A launch script that trusts the curl return exits 0 while the edge dropped the request
  (#209); the wave never starts and harvest finds nothing. Every launch is currently only safe if a
  watcher polls the ledger (G4) — that polling is the discipline.
- **Machinery that makes it IMPOSSIBLE:** the persistent launcher (retry-until-admitted) as the ONLY
  launch path — `persistent-launch-2026-08-14.sh` is the prototype — plus a typed admission receipt:
  the bus's `web.command_admitted` is the launcher's success signal, and "declared launched" is
  defined as "the ledger shows the admission event," never "curl returned."
- **The machinery makes the trap impossible because success is redefined to be the observable event**
  (the #174 law's spirit: silence is not death — a launch without a ledger admission is not launched).

### D4 — law: file-partition discipline (the trap: cross-row contamination)

- **Trap.** A row writes outside its partition → cross-row overwrite/conflict and contaminated
  evidence; the gate flags it AFTER the write (the out-of-scope digest, G5) but nothing prevents it.
- **Machinery that makes it IMPOSSIBLE:** automatic namespacing of deliverables into the wave's own
  evidence directory — `docs/reference/evidence/<name>-<date>/redrive<N>/` is already the pattern and
  becomes derived, not hand-named — PLUS admission-time scope validation: the wavefile's `scope` glob
  is checked at checkpoint/result admission so an out-of-partition path is refused at write, not merely
  reported after. The `inScopeChangedPathsDigest` mechanism (G5) becomes the enforcement seam, not an
  audit report.

### D5 — priority order (the decision)

The traps rank by cost-of-failure and by whether machinery already exists:

1. **Watcher-per-launch (D3).** Silent whole-wave loss under the lived #209 load failure. The
   persistent launcher already exists — the land is "make it the ONLY launch path."
2. **Re-drive key+path bumps (D2).** Silent whole-wave no-op on the most common corrective action
   (re-drive). Machine-minted identity removes the failure mode entirely.
3. **File-partition discipline (D4).** Contamination is loud (the gate reports it) and recoverable
   (git), but it corrupts the wave's evidence — the campaign's core record. Scope enforcement at
   admission closes it.
4. **Briefs ≤4096−60B (D1).** Single-turn waste, loud at admission, and partial machinery already
   exists (driver prechecks). The land is kernel-side, cap-naming admission.

## Closed refusal vocabulary

The machinery the seed names would mint typed refusals (all RED today):

| code | machinery | meaning |
|---|---|---|
| `objective_over_cap` (new) | D1 | a salted objective exceeds `4096`; carries `{cap, actual, unit:'bytes'}` via the coaching composer |
| `re_drive_collision` (new) | D2 | a `waves.run` whose `(idempotencyKey, specPath)` pair was already admitted |
| `launch_not_admitted` (new) | D3 | a launch declared by curl success but with no ledger admission event — the persistent launcher's failure code |
| `out_of_scope_write` (new) | D4 | a checkpoint/result whose changed paths escape the wavefile `scope` glob |
| `context_scope_forbidden` / `application_unauthorized` | D4 | the existing seams the scope check rides (`application.mjs` authorize; seed-151) |

## Red-first acceptance pins

Every pin is RED at the verification HEAD.

- **A1 (RED, D1) — an oversize salted objective refuses WITH the byte count at admission.** At HEAD
  the byte-count precheck lives in the driver (`run-task-wave.mjs:65`, `docs/37-wave-driver.md:90-94`);
  a wave admitted through a precheck-less launcher gets the generic intent error (G2), not a counted
  refusal. Pinned: the kernel refuses with `{cap: 4096, actual, unit: 'bytes'}`.
- **A2 (RED, D2) — a re-drive with a burned key+path refuses as a collision.** At HEAD the only guard
  is the launcher's own "already started" no-op (`persistent-launch-2026-08-14.sh:10-15`) — silent.
  Pinned: a typed `re_drive_collision` refusal at admission.
- **A3 (RED, D3) — "launched" means a ledger admission, never a curl return.** At HEAD the flood
  scripts hand-roll the admission poll (`v19-flood-2026-08-14.sh:21-26`) and nothing stops a script
  that skips it. Pinned: the persistent launcher is the only launch path and success is the
  `web.command_admitted`/`wave.started` event.
- **A4 (RED, D4) — an out-of-partition write refuses at admission.** At HEAD the out-of-scope digest is
  computed and REPORTED by the gate (G5); it does not refuse the checkpoint. Pinned: the wavefile
  `scope` is enforced at result admission.

## Open questions

- **OQ1 — is a burnt-key re-drive ever legitimate?** If a prior wave FAILED before starting, reusing
  the key+path might be a correct retry, not a collision. The fold must define the collision predicate
  (started-before? any admission? settled?) — this is the seed's main authority question.
- **OQ2 — who owns the re-drive namespace?** The launcher derives `redrive<N>/` from the ledger; the
  fold must pin the derivation (max suffix + 1) and the wavefile path convention.
- **OQ3 — the kernel objective-cap refusal code.** The seed proposes `objective_over_cap`; the fold
  should check whether an existing `spill_body_exceeded`-family code should be reused (the lane row
  `run.objective` already carries `refusalCode: 'spill_body_exceeded'`, `limits.mjs:56`) rather than a
  new code.
- **OQ4 — the issue body for #184 was unreachable.** If the issue names additional laws (the brief's
  "…" is non-exhaustive), this farm extends in the fold.

## Cross-references

- `docs/37-wave-driver.md:90-94,119` — the driver-side 4096 precheck this seed moves into the kernel.
- `limits.mjs:40-47,56-58` — the coaching composer (both helpers) and the 4096 lane rows.
- `contract-foundry-2026-08-13/foundry-brief.md:24-28` — the attempt-echo law (#171) that mints the ~60B salt.
- `persistent-launch-2026-08-14.sh` + commit `5939e6bd` — the watcher-per-launch prototype and its #209 origin.
- `v19-flood-2026-08-14.sh:4` — the re-drive key-burning evidence.
- `worker-delivery-push-2026-08-07/contract-fold.md` GT6 — the in/out-of-scope digest mechanism D4 reuses.
- seed-150 / seed-151 (this wave) — the coaching composer and the scope-authorization seams.

## Judgment calls

- Priority order (D5) ranks silent whole-wave loss (D3, D2) above loud single-turn waste (D1) and
  recoverable contamination (D4). A different ordering (contamination first, because evidence is the
  record) is defensible and is recorded as the runner-up.
- The "60B" is the measured `[attempt: <uuid> <role>]` line (57-58 bytes here); the seed treats the
  salt's byte cost as metered (D1(b)) rather than a hardcoded literal.
- The seed proposes new refusal codes (the table) rather than reusing existing ones because the traps
  are campaign-launcher-class failures no existing code names; OQ3 flags the one case (the lane row
  already carries `spill_body_exceeded`) where reuse may be the fold's choice.
- No DECISION_REQUEST issued: the four laws are named by the brief, and each trap is grounded in the
  repo; the issue-body gap is OQ4.
