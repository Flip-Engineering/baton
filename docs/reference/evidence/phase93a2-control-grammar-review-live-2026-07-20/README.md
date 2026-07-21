# Phase 93a.2 control-grammar review — live Baton-on-Baton evidence (2026-07-20/21)

Drivers: `run.mjs` (wave 1, v1→v2), `run-wave2.mjs` (wave 2, v3→v4). Target branch:
`phase-93a.2-program-ir`. All runs were ordinary Runs over the resident application
(`openBaton`), with exact routes, scoped paths, pinned re-verification, and stop/reap receipts.

## Review outcomes

| Seat | Route | Result | Artifact |
| --- | --- | --- | --- |
| spec-redteam | `glm/glm-5.2/xhigh` | completed; trust gate `verify.reverified` passed in fresh sandbox (exit 0) | `spec-redteam.md` (5 spec defects) |
| tests-redteam | `kimi-code/kimi-code/k3/high` | completed; trust gate passed | `tests-redteam.md` (systemic digest circularity + ~15 unpinned rows) |
| impl-review | `kimi-code/kimi-code/k3/high` | **scope-killed** mid-analysis (`health.scope_violation` — edited a fixture outside scope; correct guard, brief defect) | none (re-run in wave 3 with corrected brief) |
| implementer | `claude-code/claude-sonnet-5/high` | wave 2 | code corrections (this branch) |
| redraft-redteam | `glm/glm-5.2/xhigh` | wave 2 | `redraft-redteam.md` |

Wave-1 reports were recovered from preserved `refs/baton/results/*` commits after the v1/v2
drivers aborted the waves before materialization — the preservation refs survived full
stop/reap, as designed.

## Route truth at run time

- Codex `gpt-5.6-sol`: **rate-limited** (usage credits 0, resets 2026-07-26). Not usable this session.
- Claude Code `claude-opus-4-8`, `claude-sonnet-5`, `claude-opus-4-6`: ready after owner-approved
  Keychain→file credential provisioning (issue #11).
- GLM `glm-5.2`, Kimi `kimi-code/k3`: ready. One transient Z.ai 529 overload observed; honest
  `provider_turn_failed`, retryable.
- Grok `grok-4.5`: static-ready only (not exercised this wave).

## Orchestrator/driver findings (dogfood AX, all receipted)

1. **Passive observation advances nothing.** `run.status()` polling leaves a Run parked at
   `awaiting_plan_approval` forever; plan approval is distinct recorded authority
   (`run.approve()` or the `drive()`/`complete()` pump). Wave-1.5 lost 90 minutes to this.
2. **`run.complete()` returns on RunView quiescence; it is not a terminal wait.** Treating pump
   settlement as terminal made the v3 driver kill a healthy implementer mid-read (w-88, SIGTERM,
   $1.35 turn). Pumps must re-arm and only push through client-action gates.
3. **`BatonRunGroup.complete()`/fail-fast cascade.** In wave-1 v1, one seat's provider crash
   resolved `group.complete()` early; the driver's materialize-then-stop order then killed two
   healthy reviewers. Per-member start/settle/outcome isolation is required for heterogeneous
   waves.
4. **Terminal-phase taxonomy traps.** `work_completed` is non-terminal (verification/acceptance
   follow); `cancelled` is terminal. Driver predicates must use `outline.terminal` or the closed
   terminal-phase set.
5. **Rate-limit truth exists in the event stream but not terminal classification.**
   `resource.tokens` carried credits:0 while the RunView reported `provider_crashed`
   (unclassified). Live instance of issue #10's `rate_limited` classification gap.
6. **Small schema frictions.** `run.start` `exact` rejects `provider` though the deployment
   route table carries it; `advanced.routes` rejects duplicate exact tuples.
7. **Scope guards work.** The impl-review worker was killed by `health.scope_violation` when it
   edited outside its declared scope — the failure was in my brief ("mutate a fixture"), not
   the guard. A second worker was killed for a `/tmp` log redirect under the same rule.
8. **`run.start` objectives are capped at 4 KiB** (`application-client.mjs` `nonempty`). Long
   contracts belong in checked-in files referenced by path (`wave35-fix-decisions.md`).
9. **Run-scope entries are globs, not paths.** A bare directory (`impl/src/program-ir`) matches
   only itself; children need `dir/**`. The trust gate correctly rejected the wave-3.5 capture
   (`inScopeChangedPathCount: 2` of 5) — the work survived via `refs/baton/checkpoints`.
10. **Context actions (`context_eval`/`context_map`/…) advertise only on Workflow runs.**
    Plain single-node Runs return `application_action_unavailable` — the REPL layer is
    workflow-scoped (wave-4 arm-1 first draft hit this).
11. **`stopMember` requires an active, addressable member** (`application_workflow_member_stop_unavailable`
    when the node is already `accepted`/cancelled or the task is gone). A 6-minute stop window
    missed replica-C, which had already completed — selective stops must fire early.
12. **Role-addressed `run.send` requires the member to be in a send-able state**
    (`application_action_scope_mismatch` when the recipient's task has settled).
13. **An `operator_selected` join blocks at `selection_required` until the operator selects** —
    truthful attention, and a driver that only polls `status()` must also act on it.
14. **Killing the driver kills the resident; the Run records `interruption_uncertain`**
    (`provider_timeout` narrative) rather than fabricating a state — crash honesty works.
15. **Preserved-ref fallback needs path-existence disambiguation.** When runs complete close
    together, the newest `refs/baton/results/*` pin may belong to a sibling run; probe
    `git cat-file -e <sha>:<path>` before attributing.
16. **Drain-close deadlines are load-sensitive** (issue #7 territory): one transient
    `coordinator_drain_incomplete` under a machine running several other agents; the rerun was
    clean.

## Reflexive steering proof (wave 2)

At 03:10:53Z the orchestrator sent a priority steer to the running implementer through the
`/tmp/baton-wave2-steer` lane (`run.send`, delivery `now`). Worker log w-90 records
`control.delivery_requested {mode:"steer"}` → `control.steer {midTurn:true}` (native mid-turn
injection, fenced). The implementer's next message re-sequenced its work exactly as directed:
"Starting with the P0 core: adding red rows for the three settlement-domain exploits before
touching implementation." Steering request → durable receipt → observable behavior change.

## Evidence files

- `spec-redteam.md`, `tests-redteam.md` — wave-1 adversarial reports (heading contract:
  `## Verdict`, `## P0-P1 findings`, `## Required corrections`).
- `redraft-redteam.md` — wave-2 re-draft attack (materialized by the wave-2 driver).
- `blue-review.md` — wave-3 acceptance review (Opus 4.8; "Not accepted": collect-laundering P0).
- `wave35-fix-decisions.md` — the orchestrator's 8-decision fix contract for wave-3.5.
- `evidence.json` (wave 1), `evidence-wave2.json` (wave 2) — outcomes, steering, stops, ownership
  receipts.

## Wave 4 — swarm demonstrations (2026-07-21)

**Arm 1 — homogeneous workflow swarm** (`run-wave4-arm1.mjs`): three identical `kimi-code/k3/high`
replicas under `parallel_attempts` with an `operator_selected` join, partitions A/B/C of the
amended spec. A pure Context cell (`cell:db2b0753…`) computed the shared partition manifest on the
Workflow run (REPL Bench). Reports: `swarm-replica-{A,B,C}.md` — replica-A PASS (zero findings),
replica-B PASS, replica-C PASS with one P1 (`evidence_ranked.criteria` charged to
`maxEvidenceRefs`, fixed in `7d0c258` with a BOUND1/SEL2 pin). Kimi's concurrency ceiling is 1
(`application-deployment.mjs:640`), so homogeneous kimi replicas serialize — recorded as routing
truth; claude/codex/grok ceilings are 4.

**Arm 2 — heterogeneous artifact chain** (`run-wave4-arm2.mjs`): `claude-sonnet-5` claims
(`chain-A-claims.md`, 10 claims + 2 UNCERTAIN) → `claude-opus-4-8` adversarial verification
(`chain-B-verification.md`, all claims confirmed; one mechanism sub-assertion refuted) →
`kimi-k3` synthesis (`chain-C-synthesis.md`, zero residue) → data-derived dynamic-topology
successor: the synthesis content selected `clean-verdict-refutation`, and `kimi-k3` attempted 16
adversarial Programs against the clean verdict (`chain-D-successor.md`; refutation failed, verdict
stands). Every hand-off addressed an immutable pinned result commit by digest. GLM was typed-red
(four Z.ai 529s); Codex rate-limited; Claude OAuth expired mid-wave (rotation — issue #11) and was
restored by the owner.

**Selective member stop** (`run-selective-stop.mjs`, `evidence-selective-stop.json`): two
`claude-sonnet-5` replicas; `stopMember beta` admitted mid-flight (retry-until-stoppable after the
dispatch timing race — `stoppableRoles` requires `taskId !== null`); sibling `alpha` continued to
`verify.reverified` passed completion, even self-correcting a `/tmp` redirect violation mid-turn.
Join honestly reached `selection_required`. `selstop-alpha.md` (122 lines) preserved.

## Wave 5 — dynamic responsive workflow (2026-07-21)

**Scripted pattern** (`baton.review` preset): `glm-5.2` reviewer + `kimi-k3` challenger, truly
concurrent (different harnesses, both ceilings respected). Round 1 completed with the challenger
producing a verified immutable Candidate (`candidate:38c7fd47…`, mechanism-verified) — the
pattern runs end-to-end.

**Nested task set** (`wave5-nested.md`, issue #12): a `claude-sonnet-5` worker attempted a bounded
child run through the resident CLI. Repository discovery succeeded (`connection: ready`) but
`run start` failed with `cli_config_invalid: user connection profile is unavailable` — the
owner's profile store is (correctly) not projected into the private runtime. The worker also
caught and corrected the brief's `--exact` grammar error before hitting the real blocker. Honest
negative result, filed as issue #12 with two fix options.

**Responsive revision round** (`run-wave5b.mjs`, `evidence-wave5b.json`): typed `sendFeedback` +
`revise_candidate` over the selected candidate; the wave-5 driver's one-shot candidate scan raced
verification (`state: verified` settles after `selection_required` appears), fixed in 5b by
polling. Outcome in `evidence-wave5b.json`.
