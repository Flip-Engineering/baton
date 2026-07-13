# Phase 53 Cairn authenticated contradiction workspace — 2026-07-13

## Outcome

Phase 53 is implementation-complete. Baton now exposes unresolved causal conflicts as a bounded,
audited operator workspace and lets an authenticated orchestrator or human resolve exactly one
pair through an explicit prefix-CAS decision. The implementation preserves historical truth and
uses the existing coordination authority, authenticated HTTPS northbound, and authenticated MCP
northbound rather than creating another graph or web state machine.

The project remains self-contained. The repository's project-manager material is architectural
inspiration for the local typed causal/temporal graph; no project-manager or homelab runtime,
adapter, export target, or integration was added.

## Delivered contracts

- `causal.contradictions` accepts exactly `{observedSeq, afterEdgeId, limit}`, reruns the Phase 47
  critical audit, and returns canonical stable pages of complete unresolved pairs.
- Public rows contain only edge/endpoint IDs, types, grounding, observation/event-time identity,
  validity versions, bounded Unicode-safe snippets, counts, and content/evidence digests under an
  explicit untrusted-evidence frame. Arbitrary bodies, prompts, commands, credentials, artifact
  paths, provider payloads, and reader identities are not published.
- `causal.resolve_contradiction` accepts exactly the pinned prefix, edge ID, explicit winner and
  loser, all three exposed validity versions, and a non-empty bounded valid-Unicode reason.
- One schema-versioned `knowledge.contradiction_resolved` event binds repository, actor,
  idempotency identity, prefix, policy, request, versions, reason, affected reads, projection, and
  receipt. Applying that event closes the edge, invalidates only the loser, and records exact
  bounded ordinary-read and recall-receipt contamination atomically.
- Current queries omit the closed edge and invalid loser. Pinned historical queries and old list
  claims remain exact. The winner stays live.
- Same actor/key/request replays exactly; changed requests conflict; distinct-key races have one
  winner; stale, reversed, mismatched, dead, and double resolutions refuse. Restart and reverify
  rebuild the prefix-derived receipt and fail durable or public-claim substitution.
- Direct calls accept only orchestrator or non-forged operator actors. HTTPS and MCP derive their
  operator actor only from trusted transport admission. Direct callers cannot assert a northbound
  transport token.
- Audit failure, cancellation through the append gate, append failure, output/result/batch bounds,
  and a state-mutating preflight produce no resolution. Once the durable append succeeds, commit
  wins and Baton returns its receipt rather than reporting ambiguous cancellation.
- Phase 52 backward compatibility is restored: `recallUtility.reads` and `distinctNodesRead` keep
  their historical all-read meaning, while `totalRecalls` remains the new recall-only metric.

## Validation

- Phase 53 focused gate: **9/9 grouped tests passing**.
- Phase 47–50 plus Phase 52–53 adjacent Cairn gate: **65/65 passing**.
- Canonical zero-quota suite: **1121/1121 passing** via `npm test` in `impl/`.
- `git diff --check` and JavaScript syntax checks passed.

## Recursive Baton evidence

The first full matrix is retained in
`docs/reference/evidence/phase53-contradiction-review-2026-07-13/`. It proved every exact route,
concurrent Grok process groups, exact close, explicit GLM kill, and full ownership restoration, but
accepted no report: Codex exceeded its token cap and GLM crossed its $1.25 cap after writing a
syntactically valid report. Baton correctly rejected both.

The strengthened retry is retained in
`docs/reference/evidence/phase53-contradiction-review-budget-retry-2026-07-13/`, pinned to
`0e807f18ee311dccdc52635153e6b2b900d4af56`:

- Codex CLI 0.144.1, exact `gpt-5.6-sol`/low: PID/group `43634`, exact provider readiness and
  observed identity, then an honest hard-budget cancellation after burst accounting reached
  221,589 tokens. Its exact close is `SIGKILL`; no Codex report is claimed.
- Claude Code 2.1.206 driving the ignored owner-only project credential, exact `glm-4.7`/low:
  PID/group `43635`, provider-ready and observed exact, 86,184 tokens/$0.600321, completed report,
  fresh verification accepted, explicit `kill.requested` sequence 23, exact close, and
  `kill.confirmed` sequence 26. Its report says PASS with no confirmed P0/P1 defect.
- Grok 0.1.216 exact `grok-4.5`/low: PID/group `43636`, authentication refusal before provider
  readiness, exact close and full reap.
- Grok 0.1.216 exact `grok-build`/low: PID/group `43637`, authentication refusal before provider
  readiness, exact close and full reap.

Both Grok groups were simultaneously live. Every task was admitted with the exact requested and
resolved harness/model/low-effort tuple, and provider-observed identity stayed null for routes that
never became ready. All leaders/groups are gone; task worktrees, runtime scopes, task branches,
and writer lease are gone; the before/after ownership snapshot matches.

`implementationReviewPass` is true. `harnessMatrixPass` remains false only because both installed
Grok routes report `Authentication required` before provider readiness. Credential evidence is
limited to present/owner-only booleans; no secret value entered the ledger or Git.

## Dogfood frictions retained

- A detached review host could not import `@ast-grep/napi` until Baton source loading was separated
  from the clean reviewed repository with `BATON_REPO`. A dependency symlink was correctly rejected
  by the clean-host guard. Recursive runners need a first-class immutable dependency projection or
  an explicit source-host/review-target contract.
- The initial verifier checked two headings but not `## Verdict`; the retry now requires all three
  exact headings plus `PASS|REVISE`. This still does not replace semantic review of the report.
- Codex app-server usage arrives in accounting bursts large enough to overshoot nominal task caps.
  Baton cancelled and reaped exactly, but routing/evaluation policy should use measured burst
  headroom or a smaller review packet rather than repeatedly raising budgets.
- The installed Grok auth file is present and owner-only, but the live CLI is authoritative and
  reports unauthenticated. Baton must keep this route red until provider readiness is observed.

## Commits

- `32569ce` — specify the authenticated contradiction workspace.
- `fc2d5f4` — add the red Phase 53 contract suite.
- `94cc22f` — implement and harden list/resolution/replay/transport authority.
- `b4d409e` — add the Phase 53 recursive review harness.
- `0e807f1` — strengthen recursive report verification and bounded budgets.
