# #80 SUITE-FOLD 2 — the blue-team F1–F7 finding → resolution map

**Date:** 2026-08-07 · dispatch `ba-2026-08-07T06:02:22.112Z` (blue-team verdict → **NEEDS-FOLD**)
**Source:** `suite-blueteam.md` (the verdict, read whole) · **Suite:** `impl/test/tg3-window-red.test.mjs`
**Contract:** `tg3-window-contract.md` — bumped **v1.1 → v1.2** by this fold (the F1/F7 one-line clarification, §2 below)
**Notes:** `suite-draft-notes.md` (updated in parallel — 17 rows, split 17 · pass 8 · fail 9)
**Verdict after fold:** all 7 findings folded. Suite split after finalization, measured twice from
the repo root (`node --test impl/test/tg3-window-red.test.mjs`): **run 1 → tests 17 · pass 8 ·
fail 9; run 2 → tests 17 · pass 8 · fail 9** — deterministic. The 9 red rows fail at their named
stages at HEAD; the 8 PIN rows are green today and stay green under a correct v1.2 implementation.

---

## 1. Fold summary

| # | Finding (blue-team) | Severity | Resolution in the suite | Contract movement |
|---|---------------------|----------|-------------------------|-------------------|
| F1 | provider-call answer rows stage against the checkpoint turn's **sealed** admission; the suite pins neither side of the `provider_call_after_terminal` gate | HIGH | `assertGovernanceClean` on TW-01 / TW-03 / TW-08b — zero `provider_governance_exceeded`/`provider_telemetry_invalid`, `providerPolicyHardExceeded === false`, `budgetStopTimer === null`, never killed | **v1.2**: the D2/B1 "validity gate" is the id/phase/transition validity of `_observeLogicalProviderCall` EXCLUDING the sealed gate for in-window receipts |
| F2 | TW-03's "minute 4" staging is real-wall-time dependent (#7 class) | MEDIUM | the `requested` receipt is emitted from the same synchronous turn that armed the window (`flush(40)` after `emitTurnCompleted`, then emit) — no sub-window real sleep | none |
| F3 | no row pins that qualifying in-window evidence is APPENDED to `record.steering.observedEvidence` | MEDIUM | new RED row **TW-disc-fold** (`observed-evidence-append-missing`) — a real in-window `provider_call` leaves the fold carrying its kind + phase identity on the pause record | none (invented surface #3 sharpened) |
| F4 | TW-08b claims "the first call answers" but pins no which-call | LOW | TW-08b asserts the recorded answer carries `callId === 'tw8b-1'` with `phase === 'requested'` | none |
| F5 | the TG6 content-free-write class is never staged | LOW | TW-disc-digest stages a store-refused content-less write AND a direct digest-less evidence — neither answers; the honest stall fires | none |
| F6 | TW-02's static regexes are shape-pinned, not semantic | LOW | TW-02 (a) wires a REAL `CodexAppServerCli` against the `fake-codex-appserver.mjs` fixture and asserts `resource.provider_call {phase:'requested'}` precedes the second `turn_started` on the wire; cli positive / claude negative use semantic kind+phase window regexes | none |
| F7 | TW-05's B1 re-check inherits the same sealed-gate ambiguity as F1 | MEDIUM | TW-05 adds `assertGovernanceClean` after the constructive settle — the re-check consumed the injected fold, receipted the defect, AND left the worker governance-clean (contract v1.2 reading) | **v1.2** B1 validity test excludes the sealed gate for in-window receipts |

---

## 2. The contract movement (v1.2 — the F1/F7 one-line clarification)

The blue-team's F1 attack exposes a self-contradiction in v1.1's text: D2 (`tg3-window-contract.md:139-145`)
and B1 (`:227-233`) name `_observeLogicalProviderCall` (`:9067-9097`) as the D2 validity gate, and D4
(`:260-263`) keeps the watchdog observation undisturbed — but the sealed gate at `:9069-9072`
(`provider_call_after_terminal`) fires on any `provider_call` receipt against a sealed
`providerTurn` BEFORE the id/phase checks. The real dispatch flow produces exactly that shape: the
steering-nudge path (`_armSteeringCycle:2179` → `send(... 'nudge')` → bare prompt) performs NO
`_admitProviderTurn`, so the real turn-start dispatch receipt also arrives while `handle.providerTurn`
is the sealed checkpoint object (`coordinator.mjs:3445`, seal at `:12331-12332`). A literal read
therefore rejects the very event D2 says must answer.

**v1.2 clarifies** (the only reading consistent with the real flow):

> The D2/B1 "validity gate" is the **id/phase/transition validity** of `_observeLogicalProviderCall`
> **EXCLUDING** the `provider_call_after_terminal` sealed gate for **in-window receipts**. The D2
> path answers AND stays governance-clean: a valid in-window `requested`/`completed` receipt settles
> the steering cycle without firing `provider_call_after_terminal`.

Folded into the contract at: the status/header note, the D2 Answer bullet, the B1 re-check text, and
the §5 acceptance-pin rows TW-01 / TW-02 / TW-03 / TW-05 / TW-08.

---

## 3. F1 — HIGH — the sealed-gate discrimination (TW-01 / TW-03 / TW-08b)

**The finding.** Each provider-call answer row emits `turn_completed` with `UNAVAILABLE_USAGE_SEAL`
first, so `handle.providerTurn.sealed = true` before the window arms; the in-window `provider_call`
receipt then rides `_observeWatchdogEvent` → `_observeLogicalProviderCall` and the sealed gate fires
`provider_call_after_terminal`. The suite asserted neither resolution: a false-red impl (D2 validity
routed literally through `_observeLogicalProviderCall` → sealed gate rejects → rows stay red) and a
false-green impl (steering answer added, watchdog observation untouched → rows PASS while every real
dispatch receipt becomes a governance violation) both slipped through.

**The resolution.** A shared `assertGovernanceClean(coordinator, handle, adapter, stage)` helper now
runs at the end of TW-01, TW-03 and TW-08b, sampling with **no clock**:

- zero `resource.provider_governance_exceeded` and zero `resource.provider_telemetry_invalid` events
  in `coordinator._log.read(handle.id)` (the fold is clean of `provider_call_after_terminal` /
  `provider_call_id_invalid` / `provider_call_phase_invalid`);
- `coordinator._workers.get(handle.id).providerPolicyHardExceeded === false`;
- `coordinator._workers.get(handle.id).budgetStopTimer === null` (the 250ms kill is not armed — the
  no-clock proof it never fires);
- `adapter.calls.kill.length === 0`.

**The discrimination is verified** (both directions, source restored after each):

- **False-green killed:** a temporary patch added a `provider_call` branch to
  `_steeringEvidenceQualifies` AND an `_observeSteeringCycle` call for `resource.provider_call` while
  leaving `_observeWatchdogEvent` untouched (exactly the D4-literal wiring). TW-01, TW-03 and TW-08b
  all failed at `stage[…]: the in-window provider_call receipt is governance-clean — zero
  provider_governance_exceeded / provider_telemetry_invalid events (the D2 path answers WITHOUT
  firing the sealed gate)`. The rows are no longer greenable by the false-green impl.
- **False-red killed:** the RED stage is unchanged (no `provider_call` answer at HEAD → empty-fold
  expiry → the rows fail at their named stages). A correct v1.2 impl greens them because the D2
  answer path bypasses the sealed gate for in-window receipts (contract §2).

---

## 4. F2 — MEDIUM — TW-03's staging rides event ordering, never real wall time

**The finding.** `flush()` is a pure microtask pump, so only the real `sleep(15)` positioned the
`requested` call inside the 25ms window — a 10ms margin under event-loop load (parallel `node --test`
files, CI). This is the #7 flake class the brief forbids.

**The resolution.** TW-03 now emits the receipt from the **same synchronous turn that armed the
window**: `await flush(40)` immediately after `emitTurnCompleted`, then `emitProviderCall(... 'requested')`
(the receipt is in-window by construction, t≈0), then `sleep(60)` to cross the window. "At minute 4"
was cosmetic; the semantic pinned is "a requested-phase receipt in-window, no `turn_started`, no
content, settles constructively at expiry". The row title now says "in-window settles constructively
at expiry" and the staging carries zero sub-window real sleeps. The suite is hermetic and
deterministic across consecutive runs (the only crossings are `flush(40)` + `sleep(60)`, comfortably
past the 25ms window).

---

## 5. F3 — MEDIUM — the append path is pinned by a new RED row (TW-disc-fold)

**The finding.** `observedEvidence` appeared only in comments and TW-05's direct injection
(`record.steering.observedEvidence = [...]`); no row staged a real in-window evidence evaluation and
asserted the fold was APPENDED with the correct kind/phase identity. A fold-less impl that answers
without recording the fold passed every row.

**The resolution.** New RED row **TW-disc-fold** (`observed-evidence-append-missing`), staged after
TW-disc-scope:

- a checkpoint pause arms the window; `emitProviderCall(adapter, handle, 'tw-fold', 'requested')`;
- after `flush(40)`, the record's `record.steering.observedEvidence` is asserted to be an array
  carrying an entry with `kind === 'provider_call'` and `phase === 'requested'` — the APPEND path,
  not an injection;
- the cycle settled: task → `working`, the pause record consumed.

RED at HEAD (`record.steering.observedEvidence` does not exist), green under v1.2 (the fold is
appended at each `_observeSteeringCycle` evidence evaluation, invented surface #3). This is also the
assertion surface F4 consumes (below): the fold keeps the provider_call **phase** identity.

---

## 6. F4 — LOW — TW-08b pins WHICH call answered

**The finding.** TW-08b's assertions pinned only the settle, the nudge count and the consumed
record; an impl answering on the second call (`tw8b-1 completed`) or the third (`tw8b-2 requested`)
passed every assertion.

**The resolution.** Before the settle-consumed record is gone, TW-08b captures the pause record and
asserts:

- `record.steering.answer` is present on the settled record;
- `answer.callId ?? answer.payload?.callId === 'tw8b-1'` (the FIRST call answered, not the second
  or third);
- `answer.phase ?? answer.payload?.phase === 'requested'` (the D2 requested-only answer class).

The row also asserts `provider-call-answers-once` (exactly one `turn.settled {basis:'steering_answered'}`,
one nudge, no re-arm) and the F1 governance-clean property.

---

## 7. F5 — LOW — the TG6 content-free-write class is staged

**The finding.** TW-disc-digest staged the replay half (distinct digest answers once, a replayed
digest never re-answers) but never staged a write that yields a null/empty `contentDigest` — an
exotic wrong impl answering only on digest-less writes passed every row.

**The resolution.** TW-disc-digest's second-record window now stages two digest-less probes:

1. a **store-refused** content-less write — `emitScratchWrite(adapter, handle, 'tw-digest-empty', '')`
   is refused by the store (`scratchpadString` throws on `normalized.length === 0`, `:570-576`), so
   the write returns `{ok:false}` and `_observeSteeringCycle` is never called — the record still pends;
2. a **direct digest-less evidence** — `coordinator._observeSteeringCycle(handle, { kind: 'scratchpad',
   digest: null })` is answered `false` by the distinct-digest guard — the record still pends (the
   honest stall is preserved).

**The discrimination is verified:** a temporary patch flipping the scratchpad guard's `return false`
to `return true` for null/empty digests made TW-disc-digest fail at "a digest-less scratchpad evidence
never answers the cycle — the content-free-write class is pinned". Source restored (git diff clean).

---

## 8. F6 — LOW — TW-02 asserts the dispatch receipt semantically

**The finding.** The static codex regex matched only one call shape (`_emit(session,
'resource.provider_call', { …, phase: 'requested', … })`); a semantically-identical emission through
a shared helper or a nested `payload:` false-reds.

**The resolution.** TW-02 now has three parts:

- **(a) behavioral codex test** — a REAL `CodexAppServerCli` (spawned with `cmd: process.execPath`,
  `args: [FIXTURE, '--serve']` against the `fake-codex-appserver.mjs` fixture, zero model quota) is
  prompted through a second task; the suite polls the wire and asserts a
  `resource.provider_call {phase:'requested'}` event precedes the second `turn_started`. No source
  shape is pinned — the real adapter's wire order is the semantic. This fails at HEAD (the real
  adapter emits `completed`-only today) and is exercised in the `finally` by an adapter kill.
- **(b) cli/claude semantic regexes** — cli positive `/resource\.provider_call[\s\S]{0,250}?phase\s*:\s*['"]requested['"]/u`
  (window 250) matches the cli dispatch-emission kind+phase identity; claude negative uses window 120
  so the tool_call's own `phase:'requested'` at `claude-session.mjs:1128` (~250-400 chars past the
  provider_call kind at `:1124`) does not false-match — a wrong impl that emits a dispatch-object
  within the window still trips it.
- **(c)** the staged slow-start adapter half is preserved.

---

## 9. F7 — MEDIUM — TW-05 asserts the re-check consumed the fold AND left the worker governance-clean

**The finding.** TW-05's B1 re-check text ("callId valid per `_observeLogicalProviderCall` :9067-9097")
literally includes the sealed gate, so a literal re-check would reject the injected `tw5-call` as
`provider_call_after_terminal`, empty the fold of start-class identity, and run the full final →
TW-05 stays red under the contract's own literal reading.

**The resolution.** TW-05 ends with `assertGovernanceClean(coordinator, handle, adapter,
'evidence-gate-defect-missing')` — after the constructive settle the worker has zero governance
violations, `providerPolicyHardExceeded === false`, `budgetStopTimer === null`, and was never
killed. This pins the v1.2 reading (the re-check's validity test excludes the sealed gate for
in-window receipts) and keeps the row greenable only through that reading.

---

## 10. Verification

- **Suite split, twice from the repo root** (`node --test impl/test/tg3-window-red.test.mjs`):
  run 1 → tests 17 · pass 8 · fail 9; run 2 → tests 17 · pass 8 · fail 9. The 8 passes are exactly
  the PIN rows (TW-04, TW-06, TW-07, TW-08a, TW-09a, TW-disc-invalid, TW-disc-digest, TW-disc-scope);
  the 9 failures are the red rows, each confirmed to fail at its NAMED stage:
  TW-01 `provider-call-answer-missing` · TW-02 `dispatch-receipt-emission-missing` ·
  TW-03 `queued-start-expires` · TW-04b `steered-fold-missing` · TW-05 `evidence-gate-defect-missing` ·
  TW-08b `provider-call-answers-once` · TW-09b `depending-on-#67: rearm-kinds-missing` ·
  TW-10 `answer-not-evidence` · TW-disc-fold `observed-evidence-append-missing`.
- **Discrimination probes (each patched the source, ran the targeted rows, then restored):**
  - *F1 false-green* — steering-answer + sealed-gate-left-firing wiring → TW-01/TW-03/TW-08b all
    fail at the `assertGovernanceClean` violations pin.
  - *F5 digest-less* — scratchpad guard flipped to credit null/empty digests → TW-disc-digest fails
    at the content-free-write pin.
  - Restored: `git diff` clean on `coordinator.mjs` after both.
- **Contract:** `tg3-window-contract.md` bumped to **v1.2** (the F1/F7 one-line clarification at the
  header, D2, B1, and the §5 acceptance pins). **No other file outside the four deliverables changed**
  (`git status` verified at close).
- **Deployment verification command** (Baton): executable `true`, arguments `[]`, working directory
  `.`, expected exit 0.
