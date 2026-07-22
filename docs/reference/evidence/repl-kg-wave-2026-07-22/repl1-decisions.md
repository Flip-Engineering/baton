# REPL-1 decisions contract — ReplManifest + `repl.manifest_admitted` authority (G-A resolved)

Ground truth: docs/33 §3.1 (docs/33-shared-objects-repl-layer.md:45-70) and §4
(:116-125), issue #21, v2 red-team corrections R33-1/R33-2/R33-5/R33-10. Code that this
contract is grounded in and modifies:

- the manifest mold — `normalizeContextManifest` deletes and recomputes `digest`
  (context-program.mjs:191-192, :271-275), hard-requires the Workflow coordinate section
  (`goal`/`plan`/`node`/`task`, `planId` `^plan:[a-f0-9]{64}$`, ordered task events,
  :203-248), pins the field set `MANIFEST_FIELDS` (:21-23), the `kind` header
  `baton.context_manifest` (:194, :261), and the per-branch `manifestBranch` discipline
  (exact 6-field branch, `ctx:sha256:<digest>` ref via `SOURCE_REF`, item-count and media-type
  bounds, :159-180, :19), sorted-unique names+refs (:253-257), branch count in
  `[1, policy.maxManifestBranches]` (:249-252, :48), policy-binding (:266-270);
- the REFLEX-4 authority refusal this answers — `application.contextEval` states plainly
  "**Non-Workflow manifest-admission authority = NONE is created here**" and only re-opens an
  *existing* dispatch-bound session (application.mjs:8422-8434, :8451-8504,
  `_resolveContextEvalManifestTarget` :8524-8548); `_performContextAction`'s Workflow
  `openSession` (:8393-8402) is the coupled path;
- the runtime `openSession` that hard-couples to a live Plan-gated Attempt
  (`task.status === 'working'` + a `WORKFLOW_DEFINITION` `driver.recorded` record, else
  `context_session_stale`, context-runtime.mjs:1148-1210);
- `admitContextSession` — requires a Plan node under the manifest's `workflow` coordinate
  (`context_source_attestation_invalid`, coordination-store.mjs:8904-8913) and attests every
  branch (:8914-8943);
- `admitContextCell` caller-principal pinning — `canonicalDigest(authority) !==
  canonicalDigest(session.authority)` → `context_cell_unauthorized`
  (coordination-store.mjs:9017-9020); cell identity/idempotency/settlement (:8965-9042),
  attention-retryable settle (context-program.mjs:1259-1271), completed-cell `outputRef`
  (context-program.mjs:989-1001);
- the fold surface — `_apply` run-stop preamble (coordination-store.mjs:7195-7218), the
  context apply branches (:7317-7349), the unknown-kind throw
  (`unsupported_event_kind`, :8006-8008), `PROJECTION_CHECKPOINT_FIELDS` (:89-110) validated
  field-exact on checkpoint load (:743-751), `snapshot()` (:10341);
- the lease/wrapper precedents — orchestrator `sessionAuthority` threading
  (mcp-northbound.mjs:1012-1043), coordinator wrapper-forced owner identity
  (`requestBoardClaim` stamps `owner: workerId`, never a caller string,
  coordinator.mjs:9153-9160).

The v2 design is settled; this contract fixes shapes, payloads, ordering, error codes, bounds,
and replay/fold semantics so REPL-1 ships red-first and does not re-litigate the design.

## Part A — `ReplManifest`: a second manifest shape with its own digest basis (R33-1, R33-10)

**Decision: a distinct normalizer `normalizeReplManifest`, not a widened
`normalizeContextManifest`.** v1's "one session family, normalizer unchanged" is deleted: the
Workflow normalizer hard-requires goal/plan/node/task coordinates (context-program.mjs:203-248)
and no valid ReplManifest carries them. Widening those to optional would let a malformed
Workflow manifest normalize, and would fold two authority models into one digest basis —
exactly the collision R33-2 forbids.

1. **`ReplManifest` field set and header.** `normalizeReplManifest(value, policy)` accepts the
   exact field set `['branches', 'kind', 'policyDigest', 'repl', 'repoId', 'schemaVersion',
   'tree']` — the `MANIFEST_FIELDS` list (context-program.mjs:21-23) with `workflow` replaced by
   `repl`. `schemaVersion === 1` and `kind === 'baton.repl_manifest'` are required (the
   `baton.context_manifest` check at context-program.mjs:194 becomes the disjoint literal). A
   manifest whose `kind` is `baton.context_manifest` is refused here (`repl_manifest_invalid`),
   and `normalizeContextManifest` refuses `baton.repl_manifest` symmetrically — neither
   normalizer is reachable with the other's object, so no Workflow manifest can be reinterpreted
   as a REPL one and no existing manifest digest changes basis.
2. **The `repl` coordinate.** `exact(raw.repl, ['replRole', 'runId'], ...)`. `runId` is a
   `safeId`; `replRole` is either the literal `'shared'` or matches
   `^worker:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` (a `SafeId` workerId after the `worker:` tag).
   Any other `replRole` is `repl_manifest_invalid`. This replaces the whole
   `workflow`-coordinate block (context-program.mjs:203-248, :227-242) — no goal, plan, node, or
   task ref, and specifically **no `^plan:[a-f0-9]{64}$` gate** (:224), which is the G-A wall.
3. **`tree` and branch discipline are shared verbatim.** `raw.tree` keeps the exact
   `['sha', 'source']` shape with `GIT_SHA` + `deployment_snapshot|revision_parent`
   (context-program.mjs:198-201); every branch routes through the **unchanged** `manifestBranch`
   (:159-180) — same 6-field exact shape, same `ctx:sha256:<digest>` `SOURCE_REF` ref
   (:164-165, :19), same item-count/media-type bounds; branches are sorted and must be
   unique by both `name` and `ref` (:253-257); branch count is `[1, policy.maxManifestBranches]`
   (:249-252). REPL-1 introduces **no** new branch ref form — the `cell:` ref kind is REPL-3
   and out of scope here (Part F).
4. **Digest basis and delete-and-recompute.** The normalized body is
   `{ schemaVersion:1, kind:'baton.repl_manifest', repoId, tree, repl, branches, policyDigest }`
   and `digest = contextValueDigest(body)` (mirroring context-program.mjs:259-271). The supplied
   `digest` is deleted before field validation and, if present, must equal the computed digest
   (`repl_manifest_invalid`, mirroring :191-192, :272-274); the hub never accepts a
   caller-supplied digest as authoritative. `policyDigest` must equal
   `policy.policyDigest` (mirroring :266-270). Because `kind` is inside the digested body, a
   `baton.repl_manifest` and a `baton.context_manifest` with byte-identical `tree`/`branches`
   have **different** digests — the disjoint-basis guarantee is structural, not conventional.
   Return value is `deepFreeze({ ...body, digest })`.

## Part B — `repl.manifest_admitted`: the authority record (R33-2, the F12 durability stance)

**Decision: admission is a single new evented authority record; the principal is
lease-authenticated for `shared` and wrapper-forced for `worker`.** No caller-supplied owner
string ever reaches the store as authority — the board-claim precedent
(coordinator.mjs:9153-9160) is the pattern, not the exception.

5. **The event.** One new kind `repl.manifest_admitted`. Payload (exact, digest-covered):
   ```
   { schemaVersion: 1,
     manifestDigest,                       // the Part A normalized digest
     runId,                                // === manifest.repl.runId
     replRole,                             // === manifest.repl.replRole
     principal: { actor, principalId },    // authenticated writer (rule 6/7)
     requestDigest }                       // canonicalDigest of the admission core
   ```
   `requestDigest = canonicalDigest({ manifestDigest, runId, replRole, principal })`. The hub
   re-normalizes the submitted manifest with `normalizeReplManifest` and refuses
   (`repl_manifest_digest_mismatch`) if its digest ≠ `manifestDigest` — the same
   delete-and-recompute integrity stance the Workflow session admission takes on its own request
   core (coordination-store.mjs:8882-8893). `manifest.repl.runId`/`replRole` must equal the
   payload's `runId`/`replRole` or `repl_manifest_invalid`.
6. **`shared` scope is orchestrator authority.** For `replRole === 'shared'` the admitting
   principal must be the run's orchestrator, authenticated through the **existing**
   `sessionAuthority`/orchestrator-lease path already threaded for `run.act`
   (`activeRunOrchestratorLeaseForSession` → `sessionAuthority.orchestratorLeaseId`,
   mcp-northbound.mjs:1012-1043). Absent a valid live lease for `(repoId, runId, principal)`
   at admission time, the write is refused `repl_manifest_authority_denied`. The store records
   `principal.actor`/`principalId` from the authenticated lease, never from a caller field.
7. **`worker:<id>` scope is wrapper-bound.** For `replRole === 'worker:<workerId>'` the
   coordinator wrapper (a `admitReplManifest(workerId, fields, opts)` sibling of
   `requestBoardClaim`, coordinator.mjs:9153-9160) **forces** the `worker:` suffix to the
   caller's own resolved `workerId` before the store call, exactly as `requestBoardClaim` stamps
   `owner: workerId`. A submitted `worker:<other>` that disagrees with the wrapper's identity is
   refused `repl_manifest_authority_denied` — a worker can only admit into its own layer,
   never name another's.
8. **Admission validation order (fail before append).** (a) manifest re-normalizes and its
   digest matches `manifestDigest`; (b) `runId`/`replRole` coherence (rule 5);
   (c) principal authority (rule 6/7); (d) `runId` is not stopping (Part D rule 12);
   (e) bounds (rule 9); (f) idempotency: `this._byKey.get(auth.key)` — a prior admission under
   the same key must have identical `kind`/`actor`/`requestDigest`/`manifestDigest` or
   `repl_manifest_conflict`; a matching prior returns `{ ok:true, result:'idempotent' }` with the
   projected record (the `admitContextSession` idempotency shape, coordination-store.mjs:8887-8902).
   Only after (a)–(f) does the hub `_append('repl.manifest_admitted', payload, auth)`; a
   post-append projection-absent check throws `CoordinationIntegrityError`
   (`repl_manifest_integrity`), mirroring :8957-8961.
9. **Bounds.** `MAX_REPL_MANIFESTS_PER_RUN` admitted records per `(repoId, runId)`;
   `manifestDigest` is a 64-hex digest; the manifest itself is already bounded by the branch
   discipline (Part A rule 3) and the ≤64MB cell/source substrate — no new size limit is
   invented. Exceeding the per-run count is `repl_manifest_limit` (a typed refusal, never a
   silent drop, per the No-Arbitrary-Numeric-Limits rule: the ceiling is configurable and
   documented, not a magic constant).

## Part C — the openSession path and `admitContextCell` principal pinning (R33 rule 3)

**Decision: a new session-admission path keyed to the `repl.manifest_admitted` record; cell
evaluation below the authority line is the REFLEX-4 path byte-for-byte.** The evaluator and the
`context.*` cell events are untouched — the authority layer grows, the compute layer does not.

10. **New session admission, not the Workflow one.** `admitReplSession(fields, auth)` mints a
    `context.session_admitted` record for a ReplManifest **without** the Plan-node requirement
    (`admitContextSession` refuses no-plan-node manifests at coordination-store.mjs:8904-8913).
    It reuses `contextSessionIdentity` (manifest+environment digest) and the per-branch source
    read/attest loop (:8914-8943) verbatim — a REPL session still proves every branch's bytes
    against its manifest — but its authority precondition is a settled
    `repl.manifest_admitted` record for `manifest.digest` whose `runId`/`replRole` match, not a
    Plan-gated dispatch. Absent that record, refusal is `repl_session_unadmitted`. The stored
    session's `authority` is the normalized context authority
    (`{ actor, principalId, repoId, runId }`) built from the admission record's principal, so
    the session carries the REPL authority forward.
11. **The runtime opens against the admission record, not a dispatch.** A new
    `openReplSession({ manifestDigest, principal, signal })` on the context runtime replaces the
    Plan-gated Attempt lookup (context-runtime.mjs:1148-1210, the `context_session_stale` wall)
    with: resolve the single active `repl.manifest_admitted` record for `(repoId, manifestDigest)`,
    verify `principal` matches the record (rule 12 below), and construct a
    `DurableContextSession` (context-program.mjs:1170-1194) whose `principal` is the record's
    `{ actor, principalId, repoId, runId }` — the exact 4-key shape the constructor validates
    (:1178-1179). `DurableContextSession.evaluate` is unchanged (:1238-1247): it still admits
    cells under the deterministic key `context.cell:${sessionId}:${program.programDigest}`
    (:1244) and returns the attention-retryable settle on transient input loss (:1259-1271).
12. **`admitContextCell` principal pinning is the enforcement point, unchanged.**
    `admitContextCell` already refuses any cell whose caller authority differs from the session's
    admission authority: `canonicalDigest(authority) !== canonicalDigest(session.authority)` →
    `context_cell_unauthorized` (coordination-store.mjs:9017-9020). Because rule 10 stores the
    REPL admission principal as `session.authority`, a cell may be computed against a REPL
    session **only** by the principal that admitted the manifest (`shared`: the orchestrator;
    `worker:<id>`: that worker). No code change is required at :9017-9020 — REPL-1 makes it the
    load-bearing gate for the new authority model. Cell identity, idempotency, settlement, and
    the completed-cell `outputRef` projection (context-program.mjs:989-1001,
    coordination-store.mjs:9021-9042) are the REFLEX-4 path genuinely unchanged.
13. **This supersedes reflex4's scope boundaries, narrowly.** reflex4-decisions.md's "no new
    event kinds beyond `context.*`" and "do not modify the evaluator" are explicitly relaxed:
    REPL-1 adds exactly one event kind (`repl.manifest_admitted`) and one admission path; the
    evaluator (`StatelessContextBench`/`DurableContextSession.evaluate`) and the `context.*` cell
    events stay pure and unmodified. Nothing about cell *computation* changes — only *who* may
    open a session and *against what admission record*.

## Part D — the fold surface (docs/33 §4, R33-5 — enumerated, with a kind-inventory test)

Every new event kind ships its full fold in the **same** commit or the checkpoint validator
rejects a mixed projection. For REPL-1 that kind is `repl.manifest_admitted`.

14. **`_apply` branch + run-stop preamble.** `_apply` gains
    `else if (event.kind === 'repl.manifest_admitted')` storing the validated record into a new
    `this._replManifestAdmissions` map keyed by `manifestDigest` (freeze + `admittedEvent`/`
    admittedAt`, the context-session apply shape, coordination-store.mjs:7317-7323). The run-stop
    preamble (:7195-7218) gains `else if (event.kind === 'repl.manifest_admitted') admittedRunId
    = p?.runId ?? null;` so a REPL admission appended after `run.stop` begins throws
    `run_stopping` (:7216-7217) — REPL writes refuse after stop, like every effect. The unknown
    context session/cell kinds already fold (:7317-7349); the new kind must appear before the
    terminal `unsupported_event_kind` throw (:8006-8008) or replay of a real log fails loudly —
    which is the intended tripwire.
15. **`PROJECTION_CHECKPOINT_FIELDS`.** `'_replManifestAdmissions'` is added to the frozen list
    (coordination-store.mjs:89-110). Checkpoint load validates the field set **exactly**
    (`Object.keys(projection).sort().join(',') !== [...PROJECTION_CHECKPOINT_FIELDS].sort()...`,
    :743-744), so the same commit that adds the map must add the field — a checkpoint written by
    old code fails to load against new code and vice-versa, never a silent field drift. No
    migration shim; the field-set change is explicit and versioned by that failure.
16. **`snapshot()` exposure.** `snapshot()` (coordination-store.mjs:10341) gains a conditional
    `repl` block — `...(this._replManifestAdmissions.size > 0 ? { repl: { manifests:
    [...this._replManifestAdmissions.values()].map(clone) } } : {})` — matching the existing
    conditional-when-nonempty pattern (e.g. `runStops`, `runResultAdoptions`). REPL sessions ride
    the existing `context.sessions` snapshot list (:10341, from rule 10's `context.session_admitted`),
    so no separate session snapshot is added.
17. **Event-kind inventory test.** A new `impl/test/repl1-kind-inventory-red.test.mjs` asserts the
    *closed* set of coordination event kinds the store folds. It drives `_apply` (or a kind
    registry derived from it) with every declared kind and asserts (a) `repl.manifest_admitted`
    is present and folds without `unsupported_event_kind`, and (b) an undeclared
    `repl.*` kind still throws `unsupported_event_kind` (:8006-8008). The test is authored in
    REPL-1 and **grows** as REPL-2's `repl.binding_set`/`repl.binding_dropped` land — an
    incomplete fold (kind emitted but no `_apply` branch, or missing checkpoint field) fails at
    test time, not at a customer's replay.

## Part E — red tests first (`impl/test/repl1-manifest-red.test.mjs`)

- **Shape (Part A):** `normalizeReplManifest` accepts a `shared` and a `worker:<id>` manifest,
  deletes-and-recomputes `digest`, and refuses a supplied-digest mismatch
  (`repl_manifest_invalid`); refuses a `workflow` field, a missing `repl` field, a `replRole`
  outside `{shared, worker:<SafeId>}`, and a `kind: baton.context_manifest`; a byte-identical
  `tree`+`branches` pair under the two kinds yields **different** digests (disjoint basis);
  branch discipline (unique names/refs, `ctx:sha256` ref, bounds) rejects the same malformations
  `manifestBranch` rejects today.
- **Authority (Part B):** a `shared` admission with a valid orchestrator lease succeeds and
  records the lease principal; the same manifest with no lease is `repl_manifest_authority_denied`;
  a `worker:<a>` caller admitting a `worker:<b>` manifest is refused (wrapper forces its own id);
  a manifest whose recomputed digest ≠ payload `manifestDigest` is `repl_manifest_digest_mismatch`;
  re-admitting under the same idempotency key is `idempotent` (identical `requestDigest`) and a
  divergent key is `repl_manifest_conflict`; the per-run ceiling refuses with `repl_manifest_limit`.
- **Session + cell (Part C):** `openReplSession` opens a `DurableContextSession` against a
  ReplManifest with **no** Plan-gated dispatch (a run that would fail
  `context_session_stale`/`context_source_attestation_invalid` in the Workflow path); a pure
  Program evaluates to a durably-admitted, digest-citable cell; a cell computed by a principal
  other than the admission principal is `context_cell_unauthorized` (the :9017-9020 gate); an
  unadmitted manifest digest is `repl_session_unadmitted`; the same `(session, program)` is
  idempotent by the `context.cell:` key.
- **Fold (Part D):** `_apply('repl.manifest_admitted')` folds into `_replManifestAdmissions` and
  a `repl.manifest_admitted` appended after `run.stop` throws `run_stopping`; a checkpoint round-
  trip preserves the map and a projection missing `_replManifestAdmissions` fails the field-exact
  load (:743-744); `snapshot().repl.manifests` reflects admitted records; the kind-inventory test
  (Part E-adjacent, rule 17) asserts the closed kind set.

Then the full suite `node impl/scripts/run-suite.mjs` green from the worktree root, and the
wave-driver reviewer contract (`node --test impl/test/wave-driver-red.test.mjs`, exit 0) stays
green.

## Part F — boundaries

- **One manifest family per object.** `normalizeReplManifest` and `normalizeContextManifest` are
  disjoint by `kind`; neither accepts the other's object. No shared "widened" normalizer.
- **The evaluator is not touched.** `StatelessContextBench`, `DurableContextSession.evaluate`,
  and the `context.*` cell events are unchanged; REPL-1 adds authority, not compute. The 14 pure
  ops + 4 predicates whitelist is untouched; provider effects stay Workflow-gated
  (`context_cell_effect_requires_workflow`, coordination-store.mjs:8977-8980).
- **No new branch ref form.** `cell:` refs are REPL-3; REPL-1 manifests carry only
  `ctx:sha256:<digest>` source branches. **No named bindings** — `repl.binding_set`/`_dropped`
  and the per-scope binding fence are REPL-2 (docs/33 §3.2). This contract emits exactly one new
  event kind.
- **No caller-supplied authority.** `shared` writes are lease-authenticated; `worker` writes are
  wrapper-forced to the caller's identity. The store never trusts a `principal`/`owner`/`replRole`
  string as authority.
- **No cross-run, no mutation.** Admissions are per-`(repoId, runId)`; no cross-run REPL
  manifests (project-persistent objects ride the KG, docs/34). Records are immutable and
  replay-derived; no in-place edit, no `repl.read` event kind, no ledger write on read.
- **No credentials, no git, no scratch/temp writes.** Nothing in this contract writes outside
  the coordination ledger; no `/tmp`, no git commits, no harness/global-config mutation.

## Part G — validation

Focused red suite (`impl/test/repl1-manifest-red.test.mjs`,
`impl/test/repl1-kind-inventory-red.test.mjs`) green; then the full suite
`node impl/scripts/run-suite.mjs` green from the worktree root; the wave-driver reviewer
contract `node --test impl/test/wave-driver-red.test.mjs` (exit 0) stays green — verified green
against the current tree before this contract landed.
