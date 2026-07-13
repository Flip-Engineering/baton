# Phase 49 Cairn selective promotion batch — 2026-07-13

## Decision

CK6 is incomplete until Baton's durable coordination history can promote consequential control
decisions, closed failure observations, and cited observed Scratch facts into the local causal
graph. Promotion MUST NOT run synchronously inside stop, kill, publication, integration, or task
terminal paths: a knowledge-plane failure may never delay or reverse a safety/control effect.

Phase 49 adds the deployment-configured `cairn/causal.promote` operation. It deterministically scans
one pinned coordination prefix, reruns the Phase 47 critical audit at that boundary, derives only a
closed set of candidates from durable events, and appends one atomic `knowledge.promotion_batch`.
The caller cannot nominate a source event, candidate, node, edge, body, actor, or grounding. Baton
remains self-contained. Project-manager is design inspiration for typed causal structure only;
there is no homelab or external project-manager runtime dependency.

## Numbered contract

### SP1 — exact deployment authority

`knowledgePromotionPolicy` is immutable deployment configuration with exactly:

`repoId`, `minScratchReaders`, `maxScanEvents`, `maxCandidates`, `maxCandidateBytes`,
`maxEvidenceRefs`, `maxBatchBytes`, and `maxResultBytes`.

All numeric fields are positive safe integers with implementation maxima. Its `repoId` MUST equal
the audit and recall repository when those policies are present. The capability card advertises
`causal.promote` only when both audit and promotion policies are configured. Direct, authenticated
web, and authenticated MCP invocation all pass through the existing ACI repository and
idempotency authority. Only `orchestrator` or `operator:*` may invoke it.

### SP2 — pinned critical audit gate

The only caller argument is optional `observedSeq`; it defaults to the coordination tail observed
at invocation start. It MUST be a current valid boundary. Before candidate derivation, Cairn runs
the same deployment-pinned Phase 47 bounded audit at exactly `observedSeq`. Any critical violation,
audit overflow, cancellation, repository mismatch, or stale boundary refuses with no promotion
event or graph mutation.

### SP3 — closed source taxonomy

Candidate derivation scans at most `maxScanEvents` events in `[1, observedSeq]` and accepts only:

1. `task.created` by `orchestrator` or `operator:*` → observed `Decision`, trigger
   `coordination.spawn`, informed by its durable Task node;
2. `driver.recorded` with `kind` in `control.stop_requested`, `follow_up.requested`,
   `publication.authorized`, or `publication.denied`, where the event actor is `orchestrator` or
   `operator:*` → observed `Decision`, trigger `coordination.<kind>`, informed by a durable Task;
3. `driver.recorded` with `kind` in `integration.incomplete`, `integration.refused`,
   `publication.refused`, or `recovery.claimed_without_spawn` → observed `Counterexample`, trigger
   `coordination.<kind>`, linked to a durable Task; and
4. active `scratch.fact_posted` with `grounding:'observed'`, same `repoId`, and at least
   `minScratchReaders` distinct completed tasks in durable `scratch.read` events at or before the
   boundary, where every counted task has a live `verified_task_outcome` Finding → observed
   `Finding`, trigger `scratch.cited_observed`.

Policy-authored events cannot become positive Decisions. `derived` Scratch, uncited Scratch,
expired Scratch, cross-repository Scratch, reads without completed verified tasks, raw operational
events, worker messages, prompts, Bench output, arbitrary driver kinds, and already-promoted
sources are excluded.

### SP4 — safe, deterministic projection

Candidate IDs are content-addressed from `{repoId, sourceSeq, sourceKind}` and use a reserved
`promotion:` namespace. Each candidate retains only closed identifiers/digests, source kind and
sequence, grounding, evidence references, and a fixed implementation-authored body. It never copies
raw task briefs, Scratch values, read results, messages, reasons, commands, paths, URLs, tokens,
credentials, provider payloads, or arbitrary driver fields. Scratch candidates retain the Scratch
fact ID, namespace/key digests, immutable env-ref digest, and reader task IDs—not the value.

Candidates sort by `(sourceSeq, sourceKind, nodeId)`. Evidence references sort and deduplicate.
Candidate generation is byte-for-byte deterministic for the same prefix and policy.

### SP5 — causal edges

Every promoted row has at least one earlier durable evidence event and at least one graph edge:

- Decision → Task is `Informed`;
- Counterexample → Task is `ObservedIn`; and
- cited Scratch Finding → ScratchFact is `DerivedFrom`, while Finding → each counted verified
  outcome is `VerifiedBy`.

If a required endpoint is absent, non-live, mismatched, or outside the prefix, the entire batch
refuses. Phase 49 may materialize a `ScratchFact` source node from the safe metadata projection; it
does not expose the Scratch value.

### SP6 — all-or-nothing ceilings

Derivation tracks scanned events, candidates, canonical candidate bytes, evidence references,
projected nodes/edges, batch bytes, and result bytes. Every limit uses a max+1 refusal test. Baton
never truncates a promotion set: exceeding any ceiling refuses the entire operation with
`causal_promotion_oversize` and no append. Zero candidates return a bounded read-only no-op result
and append nothing.

### SP7 — atomic durable receipt and replay

A non-empty success appends exactly one `knowledge.promotion_batch` event containing schema
version, repository, pinned boundary/time, policy digest and exact policy, compact candidate source
commitments, complete safe node/edge projections, request digest, projection digest, and receipt
digest. Replay recomputes candidate derivation against the earlier prefix and rejects any changed
candidate, digest, edge, endpoint, authority, or boundary. Projection materializes every node and
edge from that single event; partial visibility is impossible after a failed append.

The ACI idempotency key is part of request authority. Reusing it with another actor, repository,
boundary, or policy refuses. Replaying a valid request returns the historical result without a new
event. A later request uses a new key and excludes source commitments already promoted by an earlier
valid batch.

### SP8 — bounded publication and cancellation

The result exposes only repository, boundary, policy/projection/receipt digests, event sequence,
candidate count, and ordered `{nodeId,type,trigger,sourceSeq}` summaries. It contains no promoted
body, Scratch value, task brief, driver payload, or path. `causal.promote` opts into ACI preflight
output: Cairn sizes the exact result against deployment envelope and admitted token-derived payload
ceilings before append. Cancellation is checked before audit, after audit, after derivation, and
immediately before append. Any refusal leaves no effect.

### SP9 — exact reverify

`reverify(claim,'causal.promote',args,ctx)` is read-only. It finds the claimed receipt, recomputes
request/policy/projection/receipt commitments and the historical candidate set at the pinned
boundary, and compares the exact compact claim. Tampering, missing event, wrong actor/repository,
changed args, or malformed historical data returns `{ok:false}` or a typed refusal without mutation.

### SP10 — proof and retained scope

Red-to-green proof covers every accepted and excluded source class, policy actor exclusion,
Scratch reader distinctness and verified-task requirement, derived/cross-repo/expired quarantine,
safe projection non-disclosure, deterministic ordering, duplicate suppression, max+1 ceilings,
append failure, cancellation, restart integrity, idempotent replay/conflict, ACI preflight, and
direct/web/MCP invoke plus reverify. Canonical `npm test` MUST pass.

Recursive proof uses Baton against a clean commit with exact harness/model/effort attribution,
current project-key GLM where useful, and explicit PID/worktree/runtime/branch/writer kill/reap
checks. Current Grok authentication refusal is recorded honestly; it is not converted into a
provider-observed success.

Phase 49 does not claim Playbook/Skill promotion, correction/supersession of promoted Scratch,
recall feedback/utility learning, operator contradiction UX, retention/compaction/export, Bench,
or the remaining representation/control/session capability plan. Those remain catalogued in the
active full-system goal, with deployment-neutral interchange allowed but no homelab integration.

## Red tests

1. A clean mixed prefix yields exactly the expected ordered nodes and edges in one append.
2. Each excluded source class yields no candidate; a mixed invalid endpoint refuses atomically.
3. The durable payload and public result contain none of seeded secret/prompt/path/Scratch strings.
4. A second key yields no-op; same-key mutation refuses; restart reproduces exact nodes/edges.
5. One-over scan/candidate/bytes/evidence/batch/result limits refuses with unchanged tail.
6. Audit failure, cancellation at every checkpoint, append failure, and ACI output refusal leave no
   batch or graph residue.
7. Direct, authenticated web, and MCP claims match and exact read-only reverify succeeds; claim,
   actor, repo, boundary, policy, and event tampering fails.

## Acceptance gate

Phase 49 closes only when SP1–SP10 are implemented and wired, focused tests and the canonical suite
are green, adversarial findings are dispositioned, recursive Baton evidence is retained, every
owned worker/resource is reaped, secrets are absent from Git/evidence, and the capability/status
catalogues retain every later feature named above.
