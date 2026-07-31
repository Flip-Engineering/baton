# Diagnostics epic contract — run.debug/run.evidence as the diagnostic surface (v2)

(v2 folds the grok red-team (`redteam-v1.md`, verdict **UNSOUND**, R-DG-1..9). The two P0s:
DIAG-2's centerpiece `offendingPaths` does NOT exist in durable authority — the trust gate
deliberately mints digests-only `pathScopeEvidence` (`coordinator.mjs:10860-10872`, pinned
by `phase73-required-effects.test.mjs:316-321`), and rule 1's projection-only discipline
forbids inventing it; and DIAG-1's state machine pinned no predicates, windows, or
thresholds, so two implementers would ship incompatible classifiers. Also folded: the gate
enum is pinned to the live code set (R-DG-3); `run.debug`'s #53 closed shapes are extended
by whitelist amendment, not reopened (R-DG-4); DIAG-5 rides MCP/embedded `context_eval` only
(the CLI verb refuses at parse per CS v2 — the contradiction deleted, R-DG-5); the revision
channel is named exactly (`run.feedback` with the gate-cause payload, R-DG-6); DIAG-5's
authority is per-run, never cross-run "run sets" (R-DG-7); the red battery gains the
divergence pins (R-DG-8); the rungs reorder DIAG-1 after its predicates exist (R-DG-9).
v1 retained below as the fold trail.)

## Rules (v2 — amended; the rule-1 projection discipline and the five-question framing stand)

1. **(rule 1 stands — projection-only over existing authority; whitelist-only; sanitized
   through `verifier-diagnostics.mjs` only.)**
2. **DIAG-1 — member progress classification with PINNED predicates.** `run.debug`'s member
   leg and `wave.progress()` rows gain `{state, basis}` where state is computed by ONE named
   reducer over the per-member signals (checkpoint presence, durable claim-bit per
   bidirectional v2 rule 1, `changedPathsDigest` delta across the caller's own two most
   recent reads, terminal phase): `crashed` (terminal with failure cause) > `claimable`
   (checkpoint with durable claim AND unchanged digest across the two reads) > `parked_done`
   (checkpoint with durable claim, digest changed or no second read yet) > `parked`
   (checkpoint, no claim) > `stalled` (no checkpoint, unchanged digest across two reads
   spanning ≥ the driver's poll interval) > `progressing` (anything else). `basis` carries
   the concrete signals (digest-changed bool, checkpoint requestId, claim presence,
   phase) — never a bare label. The classifier is pure projection; the wave driver's OWN
   steering predicates stay its own (no shared-machinery coupling claimed).
3. **DIAG-2 — gate-cause from EXISTING authority, honestly shaped.** On a gate refusal,
   `run.debug`'s failure leg carries `{gate, detail}` where `gate` is pinned to the LIVE
   code set observed at the gate (`red_green`, `coverage`, `route_mismatch`,
   `forbidden_effect`, `worker_path_scope_violation` → serialized `scope`, plus `unknown`
   as the honest fallback) and `detail` carries what authority actually holds: for
   `scope`, the DIGESTS (`outOfScopeChangedPathsDigest` + counts) — the deliberate
   digests-only design (`coordinator.mjs:10860-10872`) is NOT reopened in this contract;
   naming offending path STRINGS requires a new durable mint, which is the named successor
   item (below), not a projection. For `red_green`/`coverage`, a sanitized bounded tail via
   `verifier-diagnostics.mjs`. The worker-facing revision channel is exactly
   `run.feedback` (the shipped channel) with the same `{gate, detail}` payload in its
   structured inputs — no new seam (R-DG-6).
4. **DIAG-3 — the #28 deferral, landed by whitelist amendment.** `wire.frame_degraded` and
   stream-death/crash causes join `run.debug`'s failure/writeReceipts legs as whitelisted
   receipt summaries (counts, last-code, bounded) — the #53 closed `failure` object is
   AMENDED by explicit whitelist addition in its own contract's amendment style (the #53
   ban-list discipline: named additions, never raw payloads, R-DG-4).
5. **DIAG-4 — failure-capture artifact (unchanged from v1 rule 5; capture-only, NOT
   Vantage; content-addressed; citable from `run.evidence` and `run.debug`).**
6. **DIAG-5 — diagnostic programs over PER-RUN authority.** Deployment-pinned `context_eval`
   programs compute diagnostic roll-ups over ONE run's authority (stalled-member roll-up,
   refusal-kind histogram, degradation count for that run) — cross-run fleet views are OUT
   (`contextEval` authority is per-run, R-DG-7). Invocation via the embedded facade's
   `run.context().evaluate` and MCP `baton_context_eval`; the CLI verb stays a parse-time
   refusal per the CS v2 contract (the v1 contradiction deleted, R-DG-5); results citable
   as `cell:` bindings.

## Rungs (reordered per R-DG-9)

- **DG-1 = DIAG-3 + DIAG-2** (the deferral + the honestly-shaped gate-cause).
- **DG-2 = DIAG-1** (after the pinned predicates; no dependency on the bidirectional
  claim-bit for the `parked`/`stalled`/`progressing`/`crashed` subset — the claim states
  activate when the durable origin lands).
- **DG-3 = DIAG-4** · **DG-4 = DIAG-5.**

## Named successor (out of scope)

**Offending-path minting:** a new durable trust-gate record carrying bounded offending path
strings (vs the deliberate digests-only posture) — its own contract with a privacy/size
analysis, red-teamed like #33.

## Red-first tests (v2 amendments)

- **DG-1a:** degraded-frame/stream-death whitelisted summaries (counts + last code), never
  raw frames; the #53 closed-shape amendment is pinned by source-scan of the whitelist.
- **DG-1b:** a scope refusal carries `{gate:'scope', detail:{digests, counts}}` exactly —
  NO path strings (the deliberate posture pinned); a red_green refusal carries the sanitized
  tail; an unrecognized gate code serializes `unknown`; a planted secret-shaped line never
  appears; `run.feedback` carries the same payload to the worker.
- **DG-2:** the pinned reducer's boundaries: each state transition asserted on scripted
  fixtures (checkpoint+claim+unchanged → claimable; checkpoint+claim+changed → parked_done;
  checkpoint no-claim → parked; no-checkpoint unchanged-digest two-reads → stalled; terminal
  failure → crashed; else progressing); `basis` carries the concrete signals.
- **DG-3:** capture artifact pinned + cited (as v1).
- **DG-4:** per-run roll-up programs over `context_eval` (embedded + MCP paths), `cell:`
  citation; a cross-run attempt refuses honestly.

---

# Diagnostics epic contract — run.debug/run.evidence as the diagnostic surface (v1)

(Seed: operator directive 2026-07-31 — "advanced diagnostic approaches to improved coding
feedback for the workers and orchestrator." Parent receipts: issue #51 (done-vs-stuck
undiagnosable), issue #30 (trust-gate rejections lack cause localization), issue #28's own
deferral (`wire.frame_degraded` reaches no projection, `issue28-decisions.md:50-52`), the
Vantage doc's "the hub already re-runs verification… it should record it for free"
(`docs/capabilities/debug-interp.md:25`). Grounding: full ATLAS/DIAG inventory 2026-07-31
(explore subagent, file:line-cited). Sibling contracts: bidirectional v1 (the #51 claim-bit
this epic's DIAG-1 rides), control-surface v2 (registers `run.debug`; this epic extends its
PAYLOAD, never its registration). Discipline inherited from #53: projection-side,
whitelist-only, O(stream) bounded per member per call (`issue53-decisions.md:44-46`).)

## Ground truth

1. **Done-vs-stuck is undiagnosable.** `run.debug` answers what a worker SAID, not whether it
   is PROGRESSING; the wave driver's liveness is a nudge-budget heuristic
   (`wave-driver.mjs:15-19`); #51 was filed from the demo loop. The raw derivation signals
   already exist (checkpoint cadence, `changedPathsDigest`, write receipts, the bidirectional
   contract's claim-bit).
2. **Trust-gate rejections lack cause localization.** The worker gets a refusal; neither
   worker nor operator gets a structured "which gate, which evidence" — the repl1 scope
   violation was discovered only AT the gate (`reviews/baton-24h-report.html:182`); issue #30
   killed gated workers with no diagnosis. Sanitized failure tails exist
   (`verifier-diagnostics.mjs:26`, 8KiB, secret patterns, sandbox-root stripping).
3. **Wire/transport degradations are invisible post-hoc.** `wire.frame_degraded` is emitted
   but reaches no projection (the #28 contract names `run.debug` as the deferred home);
   #49/#50 (glm concurrency, stream death) are the same class.
4. **Failure evidence evaporates.** The hub re-runs verification on every rejection (I7) but
   pins no replayable diagnostic artifact; the orchestrator sees "a symptom with no cause
   attached" (`docs/capabilities/debug-interp.md:17`).
5. **Fleet-level roll-ups don't exist.** Stalled-member counts, refusal-kind histograms, and
   degradation counts are computable over run authority today but need per-orchestrator
   bespoke scripts; `contextEval` (`application.mjs:8821`, deliberately not command-registered)
   is exactly the evaluation surface, with `cell:` citation (REPL-3) for sharing.

## The question

Do the shipped diagnostic surfaces (`run.debug`, `run.evidence`) learn to answer the five
questions the campaign keeps hitting — is this member progressing, why did the gate reject,
did the transport degrade, what did the failing verification actually output, and how is the
fleet doing — as projections over authority the hub ALREADY produces? Or does every
orchestrator keep doing JSONL archaeology? This contract picks the projections, on evidence
that every signal is already emitted and only the projections are missing.

## Rules

1. **Projection-only over existing authority.** Every diagnostic field derives from records
   the hub already mints (pause records, trust-gate verdicts, wire receipts, verification
   re-runs, coordination events). No new event kinds except DIAG-4's capture artifact
   (content-addressed, matching the scorecard pattern); no worker-visible new channel;
   whitelist-only fields, bounded, sanitized through `verifier-diagnostics.mjs` (sandbox-root
   stripping `:33-39`, secret patterns `:5-12`) — never new text paths.
2. **DIAG-1 — member progress classification.** `run.debug`'s member leg and
   `wave.progress()` member rows gain `{state, basis}` with state ∈
   `progressing|parked|parked_done|stalled|claimable|crashed` derived from: checkpoint
   cadence, `changedPathsDigest` change across polls, scratchpad/write receipts, and the
   bidirectional claim-bit (`parked_done`/`claimable` REQUIRE the claim-bit — they land only
   after/with the bidirectional contract's rule 1; before that they honestly read
   `parked`). The derivation basis is always carried (never a bare label).
3. **DIAG-2 — trust-gate rejection diagnosis.** On a verification/gate refusal, a structured
   cause rides `run.debug`'s failure leg AND the revision channel to the worker: `{gate:
   red-green|coverage|scope|route_mismatch|forbidden_effect, offendingPaths?, tail?}` —
   scope-refusals first (the repl1 receipt class), naming offending paths against Brief
   scope; the tail reuses `verifier-diagnostics.mjs` sanitization verbatim.
4. **DIAG-3 — degradation/transport visibility (the #28 deferral, landed).**
   `wire.frame_degraded` and stream-death/crash causes appear in `run.debug`'s
   failure/writeReceipts legs as whitelisted receipt summaries (counts, last-code, bounded).
5. **DIAG-4 — failure-capture artifact (capture-only, NOT Vantage).** On trust-gate
   rejection, the hub's own I7 verification re-run output is pinned bounded+sanitized as a
   content-addressed artifact citable from `run.evidence` and `run.debug`. Verification-
   failure captures only; no DAP, no rr, no live debugging, no observation plans (the full
   Vantage program stays pending, `docs/capabilities/debug-interp.md:53-108`).
6. **DIAG-5 — diagnostic programs, not command families.** A small closed set of
   deployment-pinned `context_eval` programs computes fleet-level diagnostic views (stalled-
   member roll-up, refusal-kind histogram, degradation count); invocable through the existing
   `context.eval` CLI verb and MCP tool; results citable as `cell:` bindings. No new command
   family, no new timeline kind.

## Rungs

- **DG-1 = DIAG-3 + DIAG-2** (the deferral + the receipt class; independent of the
  bidirectional contract).
- **DG-2 = DIAG-1** (after the bidirectional claim-bit lands; `parked`/`stalled`/
  `progressing`/`crashed` may land earlier with the honest absence of claim states).
- **DG-3 = DIAG-4** (rides DG-1's gate-cause model).
- **DG-4 = DIAG-5** (rides all three as the roll-up).

## Red-first tests — `impl/test/diagnostics-red.test.mjs`

1. **DG-1a:** a degraded wire frame and a stream death surface in `run.debug`'s legs as
   whitelisted summaries (counts + last code), never raw frames.
2. **DG-1b:** a scope-refusal gate rejection carries `{gate:'scope', offendingPaths}` naming
   exactly the out-of-scope paths against the Brief scope, with a sanitized bounded tail; a
   red-green refusal carries `{gate:'red-green', tail}`; no refusal leaks sandbox roots or
   secrets (fixture with a planted secret-shaped line).
3. **DG-2:** member legs classify progressing/parked/stalled/crashed from scripted fixtures
   with the derivation basis carried; with a completed-claim fixture (bidirectional rule 1
   landed) the states read `parked_done`/`claimable`; without it they read `parked`.
4. **DG-3:** a gate rejection pins a content-addressed capture artifact; `run.evidence` and
   `run.debug` cite its digest; the artifact content is the sanitized I7 output, byte-bounded.
5. **DG-4:** the wave-health program computes the stalled-member roll-up and refusal
   histogram over a scripted run set, invocable via `context.eval`, result citable as a
   `cell:` binding.

Deterministic; MockAdapter/PausableAdapter fixtures; no live providers.

## Verification

```text
node --test impl/test/diagnostics-red.test.mjs impl/test/issue53-run-debug-red.test.mjs
node impl/scripts/run-suite.mjs
```

## Explicit non-goals (v1)

Vantage (DAP/rr/observation plans); new worker channels or grammar lines; ATLAS worker-facing
orientation (sibling contract); live LSP/SCIP; any change to the trust gate's verdicts
themselves (diagnosis, never adjudication); `run.debug` registration changes (control-surface
v2 owns that).
