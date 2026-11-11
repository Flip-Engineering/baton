# Phase 31 Cairn Rung 0 handoff — 2026-07-12

## Outcome

Cairn Rung 0 now ships as the first run-level knowledge product on Baton's existing ACI and
coordination substrate. It adds no homelab or project-manager runtime integration. The useful
inspiration retained from the repository's PM analysis is the typed causal backbone and a health
row with evidence breakdowns; Baton remains self-contained, single-writer-through-the-hub, and
deployment-neutral.

The implementation started at `5223dee` and was hardened after recursive dogfood. Its public
surface is:

- orchestrator-selected `runId`, independent from harness, exact model, effort, task, and worker;
- direct/web/MCP spawn propagation plus durable replay, public handle/result, review, refinement,
  and every known-worker operational event;
- deterministic ACI operation `cairn/run.scorecard` with bounded result, content-addressed full
  artifact, and exact-bound reverify;
- one-way terminal closure and post-seal task/follow-up/recovery refusal before provider effects;
- one durable `run.sealed` event that materializes the sealed Run, scorecard Artifact,
  Run→Task `Contains`, and Artifact→Run `ProducedBy` projections together; and
- a scorecard row containing outcomes, verified/asserted completions, non-policy interventions,
  unresolved approvals, normalized token/USD use, exact route/task rows, and an honest
  `free_form_definition_of_done` unavailable marker.

## Verification

- Phase 31 focused: 8/8.
- Web/MCP/Phase 31 focused: 41/41 during development.
- Canonical zero-quota suite: 805/805.
- `git diff --check`: clean.

The adversarial reds include invalid and spoofed run attribution, direct/web/MCP propagation,
review inheritance, post-seal admission and follow-up pre-effect refusal, unknown/nonterminal
closure, two-worker sorting, verified versus unmapped asserted completion, delta plus cumulative
usage normalization, intervention actor preservation, unresolved approvals, deterministic retry,
artifact tamper, missing/mixed/gapped evidence refusal, replay identity, single-event atomic graph
projection, injected append failure, orphan-safe retry, and conflicting reseal.

## Recursive Baton evidence

All three attempts ran from a clean detached checkout while leaving the user's `.gitignore` edit
untouched. Credential values were never printed or written to evidence.

1. `docs/reference/evidence/phase31-cairn-grok-review-2026-07-12/`: Baton concurrently requested
   exact `grok-4.5` and `grok-composer-2.5-fast`, both at `low`, under the same `runId`. The current
   Grok CLI reported `Authentication required` before provider initialization. No provider model
   was claimed. Both tasks became durably failed and every worktree, metadata file, runtime scope,
   branch, and process was absent after idempotent kill/reap. A direct bounded `grok models` check
   independently reported `You are not authenticated`.
2. `docs/reference/evidence/phase31-cairn-codex-review-2026-07-12/`: two exact
   `gpt-5.6-sol`/`low` workers initialized on distinct overlapping native PIDs with correct run
   attribution. Both providers then reported account usage exhaustion until 03:24 local time.
   Baton accepted no report and fully reaped both workers and all owned state.
3. `docs/reference/evidence/phase31-cairn-glm-review-2026-07-12/`: exact `glm-4.7`/`low` initialized,
   produced a bounded review artifact, and reported 69,137 tokens / $0.679175. The task honestly
   remained failed: provider use exceeded the nominal $0.40 CLI cap, and the fresh disposable
   verification checkout lacked optional `@ast-grep/napi`. Baton therefore did not seal a Cairn
   scorecard from it, then confirmed kill and full reap. The captured model report is retained as
   untrusted review evidence; its overconfident no-findings verdict was not used as authority.

These failures produced two reusable product findings: a clean recursive clone needs materialized
optional dependencies before report verification, and provider-side `--max-budget-usd` is not a
hard pre-request ceiling. Baton's own normalized hard stop can only react when a provider emits
usage, which for this GLM turn arrived after the oversized request.

## Honest boundary and next rung

Rung 0 does not claim structured DoD-item coverage, semantic success, route advice, distributed
multi-coordinator serialization, causal recall, contradiction resolution, dashboarding, or export.
Cairn Rung 1 is the catalogued RouteStats/`bok_route` layer and must consume only sealed,
hub-verified scorecards. Cartographer/Quartermaster remains the next dependency-ordered capability
module before broader Vantage/Evidence/Skill work. The final two-Grok semantic closure is pending a
fresh `grok login`; the Codex retry is pending quota reset. Neither blocks deterministic Rung 0
completion or justifies fabricating provider evidence.
