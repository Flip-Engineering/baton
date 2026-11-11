# Phase 56 — exact fleet drain and driver close handoff

## Outcome

Phase 56 is implemented at `7fa5856`, canonical-green, adversarially reviewed, and recursively
exercised through Baton itself. Baton now has one exact, auditable path from public drain admission
to process-generation close, owned-resource reconciliation, coordinator close, and writer-lease
release. The implementation adds no homelab or external project-manager integration.

## Contracts shipped

- `coordinator.drain` is available through direct ACI, authenticated HTTPS, and MCP with
  transport-derived actor authority, actor-pinned idempotency, and replay.
- `driver.drainAndClose` orders supervisor stop, admission fencing, target disposition, exact
  process close, residue cleanup, authority close, and writer release under one deadline.
- Every per-target disposition is a durable `fleet.drain_disposition_recorded` event. Replay
  validates the complete target set, receipt digest, and disposition/count agreement.
- Retrying the same or a new drain preserves already-proven kill truth, while a completed drain
  from an older controller cannot capture a fresh physical process epoch.
- Late worktree/native-process ownership is registered, and a process arriving after spawn
  acknowledgement is quarantined and killed instead of escaping the drain.
- Reconciliation covers historical worktree, branch-only, metadata-only, projection-only, and
  runtime residue. Timeout retry joins cleanup already in flight.
- The evidence wrapper owns its process group and temporary root, confines nested paths, checks
  inode/UID identity, escalates TERM to KILL, and attests both process and filesystem cleanup.

## Validation

- Focused Phase 56 suite: 37/37 pass.
- Coordinator, Phase 11, and Phase 56 adjacent suites: 113/113 pass.
- Canonical suite through the owned evidence wrapper: 1179/1179 pass.
- `git diff --check`: clean for the implementation commit.
- Independent adversarial review found no remaining Phase 56 blocker after disposition durability,
  replay, fresh-epoch, terminal cleanup, startup readiness, and direct/web/MCP checks.

The canonical validation command was:

```sh
cd impl
node scripts/run-evidence.mjs scripts/run-suite.mjs
```

## Reflexive Baton-on-Baton evidence

The primary five-route run selected and admitted these tuples concurrently:

| Harness | Model | Effort | Result relevant to Phase 56 |
| --- | --- | --- | --- |
| Codex | `gpt-5.6-sol` | low | exact route/process observed; app-server closed before a review response |
| Claude Code | `claude-opus-4-6` | low | exact route/process observed; no accepted report |
| GLM via Claude session | `glm-4.7` | low | exact route/process observed; focused retry later fresh-verified and accepted |
| Grok | `grok-4.5` | low | exact route admitted; ACP reported `Authentication required` |
| Grok | `grok-build` | low | exact route admitted; ACP reported `Authentication required` |

Both Grok process groups were sampled alive simultaneously. The run then used
`driver.drainAndClose` rather than manual worker kills or the legacy close path. Every started
generation closed exactly; all observed leaders and groups were gone; worktrees, runtimes,
branches, projection material, detached target, coordinator authority, writer lease, and wrapper
roots were clean. Its lifecycle gate is green even though the provider/report matrix is red.

The focused project-key GLM retry used the owner-only project credential path without recording its
contents. It observed exact `glm-4.7`, consumed 71,234 tokens and USD 0.607499 under declared
120,000-token/USD 3 limits, passed the fresh sparse Phase 56 verifier, captured the report, and
repeated the exact close/reap proof. Its lifecycle and matrix gates are both green.

Retained evidence:

- `docs/reference/evidence/phase56-live-harness-drain-2026-07-13/`
- `docs/reference/evidence/phase56-live-harness-drain-sparse-retry-2026-07-13/`
- `docs/reference/evidence/phase56-glm-key-route-2026-07-13/`
- `docs/reference/evidence/phase56-glm-key-route-budget-retry-2026-07-13/`

## Frictions and dogfood-directed next slices

1. Add explicit headless credential-readiness diagnostics per provider. Grok remains auth-red even
   with its owner-only login file projected into the isolated runtime; this is a reason to improve
   ACP readiness/error attribution, not to expose the user's broader home directory.
2. Add capacity-aware sparse worker checkouts. Sparse verifier checkout is now proven, but five
   full concurrent workers can consume roughly 450 MB because about 67 MB of historical evidence is
   tracked in every roughly 75 MB checkout.
3. Add route-specific terminal-burst preauthorization and mechanical provider-call governance so a
   provider cannot cross a budget in one terminal telemetry burst or loop on self-checks.
4. Continue provider-backed recovery/continuation and the authenticated web/operator surface beyond
   the shipped drain command.

These operational slices do not replace the retained feature system: Scratch Board/Bench,
Skill/Playbook promotion, trust/evaluation, the self-contained shared causal/temporal knowledge
graph inspired by project-manager prior art, deeper AST/CST/SCIP/CPG/IR and behavioral analysis,
semantic merge, and conditional expression/kernel e-graphs all remain in the goal. Homelab
integration remains explicitly excluded.
