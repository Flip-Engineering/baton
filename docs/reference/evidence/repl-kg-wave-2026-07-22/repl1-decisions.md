# REPL-1 decisions contract — ReplManifest + `repl.manifest_admitted` authority (G-A resolved)

Ground truth: docs/33 §3.1 (docs/33-shared-objects-repl-layer.md:45-70) and §4
(:116-125), issue #21, v2 red-team corrections R33-1/R33-2/R33-5/R33-10, and the BINDING
repl1 red-team report (repl1-redteam.md, findings P0-1..3, P1-4..8, P2-9..12 — all resolved in
the "## v2 revisions" section at the end). Code that this contract is grounded in and modifies:

- the manifest mold — `normalizeContextManifest` deletes and recomputes `digest`
  (context-program.mjs:191-192, :271-275), hard-requires the Workflow coordinate section
  (`goal`/`plan`/`node`/`task`, `planId` `^plan:[a-f0-9]{64}$`, ordered task events,
  :203-248), pins the field set `MANIFEST_FIELDS` (:21-23), the `kind` header
  `baton.context_manifest` (:194, :261), and the per-branch `manifestBranch` discipline
  (exact 6-field branch, `ctx:sha256:<digest>` ref via `SOURCE_REF`, item-count and media-type
  bounds, :159-181, :19), sorted-unique names+refs (:253-257), branch count in
  `[1, policy.maxManifestBranches]` (:249-252, :48), policy-binding (:266-270);
- **the false "reuse verbatim" premise the red-team refutes (P0-1..3).** Every Workflow
  session/cell path is coupled to `manifest.workflow.*`, so a ReplManifest cannot flow through
  it untouched. The five coupled sites, and the ONE coherent authority-layer change that opens
  each, are enumerated in Part C (rules 10–13) and Part C-guard (rule 13a). The compute layer
  (`StatelessContextBench`, the 14 pure ops + 4 predicates) is genuinely unchanged; the edits
  are all authority/identity/fold surface, named individually — not "byte-for-byte unchanged";
- the REFLEX-4 authority refusal this answers — `application.contextEval` states plainly
  "**Non-Workflow manifest-admission authority = NONE is created here**" and only re-opens an
  *existing* dispatch-bound session (application.mjs:8422-8434, :8451-8504,
  `_resolveContextEvalManifestTarget` :8524-8550); `_performContextAction`'s Workflow
  `openSession` (:8393-8402) is the coupled path;
- the runtime `openSession` that hard-couples to a live Plan-gated Attempt
  (`task.status === 'working'` + a `WORKFLOW_DEFINITION` `driver.recorded` record, else
  `context_session_stale`, context-runtime.mjs:1148-1210), whose existing-session rescan
  dereferences `session.manifest.workflow.*` unguarded (:1198-1210);
- `admitContextSession` — requires a Plan node under the manifest's `workflow` coordinate
  (`context_source_attestation_invalid`, coordination-store.mjs:8904-8913), reads and byte-proves
  every branch (:8914-8930), and attests each branch through the **Plan-node-coupled**
  `_normalizeContextSourceAttestation` (:8940-8943 → :4648-4649, which reads
  `manifest.workflow.node.digest` and `node.contextScope`), minting a schemaVersion-2 record
  (:8946);
- `_validateContextSessionPayload` — the admit+fold re-validator that recomputes identity via
  `contextSessionIdentity` (:4844) and hard-requires goal/plan/`approval?.disposition ===
  'approved'` (:4887-4906) + working task + dispatch binding (:4908-4922);
- `_assertContextSessionCurrent` — the cell-admission gate reached from
  `_validateContextCellAdmissionPayload` (:5003 → :4765-4816), demanding the same Workflow
  goal/plan/approval + working task + dispatch binding (:4799-4813);
- `admitContextCell` caller-principal pinning — `canonicalDigest(authority) !==
  canonicalDigest(session.authority)` → `context_cell_unauthorized`
  (coordination-store.mjs:9017-9019); cell identity/idempotency/settlement (:8965-9043),
  attention-retryable settle (context-program.mjs:1259-1271), completed-cell `outputRef`
  (context-program.mjs:989-1001);
- the fold surface — `_apply` run-stop preamble (coordination-store.mjs:7195-7218), the
  context apply branches (:7317-7349), the unknown-kind throw
  (`unsupported_event_kind`, :8006-8007), `PROJECTION_CHECKPOINT_FIELDS` (:89-110) validated
  field-exact on checkpoint load (:743-744), `snapshot()` (:10341);
- the lease/wrapper precedents — orchestrator `sessionAuthority` threading
  (mcp-northbound.mjs:1013-1040) resolving a **run-scoped** lease
  (`activeRunOrchestratorLeaseForSession` takes `{repoId, principalId, sessionId, expiresAt}`
  with **no runId**, :1488-1513; the lease itself carries `lease.parent.runId`, :1343);
  coordinator wrapper-forced owner identity (`requestBoardClaim` stamps `owner: workerId`, never
  a caller string, but threads only `{actor, key}` as auth, coordinator.mjs:9153-9160).

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
   `safeId` (context-program.mjs:148); `replRole` is either the literal `'shared'` or matches
   `^worker:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` (the workerId/principalId after the `worker:`
   tag). Any other `replRole` is `repl_manifest_invalid`. This replaces the whole
   `workflow`-coordinate block (context-program.mjs:203-248, :227-242) — no goal, plan, node, or
   task ref, and specifically **no `^plan:[a-f0-9]{64}$` gate** (:224), which is the G-A wall.
   **The `worker:` grammar is deliberately narrower than `SAFE_ID` (context-program.mjs:18,
   which permits `:`)** (P2-11): a `:` inside the suffix would make the `worker:` tag boundary
   ambiguous and break the store-side equality `replRole === 'worker:' + auth.principalId`
   (rule 7). The narrowing is intentional and pinned, not incidental.
3. **`tree` and branch discipline are shared verbatim.** `raw.tree` keeps the exact
   `['sha', 'source']` shape with `GIT_SHA` + `deployment_snapshot|revision_parent`
   (context-program.mjs:198-201); every branch routes through the **unchanged** `manifestBranch`
   (:159-181) — same 6-field exact shape, same `ctx:sha256:<digest>` `SOURCE_REF` ref
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

### Rule A-any — `normalizeManifestAny`, the one kind-dispatching entry (P0-1..3, R33-2)

4a. **A single kind-dispatching normalizer replaces the three hard-coded
    `normalizeContextManifest` call sites that a ReplManifest must survive.** New
    `normalizeManifestAny(value, policy)` reads `value?.kind` and dispatches:
    `baton.context_manifest` → `normalizeContextManifest`; `baton.repl_manifest` →
    `normalizeReplManifest`; any other → a typed refusal (`context_manifest_invalid`). It is
    used **symmetrically** at exactly the sites where identity/session construction must accept
    either kind: `contextProgramInputRefs` (context-authority.mjs:61), `contextSessionIdentity`
    (context-authority.mjs:82), and the `DurableContextSession` constructor
    (context-program.mjs:1187). It is **not** wired into `normalizeContextManifest`'s own body,
    into `manifestBranch`, or into any Workflow-only validator — those stay disjoint (Part F).
    This is the single normalization story the red-team requires: not two hacks, one dispatcher.
4b. **`contextSessionIdentity` dispatches `runId` by manifest kind.** After :4a swaps its
    `normalizeContextManifest` (context-authority.mjs:82) for `normalizeManifestAny`, the core
    field `runId` reads `normalizedManifest.workflow.runId` for a context manifest and
    `normalizedManifest.repl.runId` for a repl manifest (the only `workflow`-typed deref in the
    function, context-authority.mjs:90). Everything else in the identity core — `repoId`, `tree`,
    `manifestDigest`, `environmentDigest`, `policyDigest`, the `sessionId =
    context-session:<digest>` derivation — is kind-agnostic and unchanged. The session `kind`
    stays `baton.context_session` (one session family); the manifest kind travels on
    `session.manifest.kind` and is what every downstream validator branches on. Because
    `manifestDigest` differs across bases (rule 4), a REPL and a Workflow session never collide
    on `sessionId`.

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
6. **`shared` scope is orchestrator authority, pinned to the manifest's own run (P1-4).** For
   `replRole === 'shared'` the admitting principal must be the run's orchestrator, authenticated
   through the **existing** `sessionAuthority`/orchestrator-lease path already threaded for
   `run.act` (`activeRunOrchestratorLeaseForSession` → `sessionAuthority.orchestratorLeaseId`,
   mcp-northbound.mjs:1013-1040). Because that lookup takes **no runId**
   (coordination-store.mjs:1488-1513) while leases are run-scoped (`lease.parent.runId`,
   :1343, :1256), the store MUST additionally pin **`lease.parent.runId === payload.runId`**
   (=== `manifest.repl.runId`); a lease valid for run X may not authenticate a manifest for run
   Y. Absent a valid live lease for `(repoId, runId, principal)` at admission time — or on any
   `lease.parent.runId` mismatch — the write is refused `repl_manifest_authority_denied`. The
   store records `principal.actor`/`principalId` from the authenticated lease, never from a
   caller field.
7. **`worker:<id>` scope is wrapper-bound by store-side equality, not payload rewrite (P1-5).**
   `replRole` is inside the digested manifest body (rule 4) and echoed in the digest-covered
   payload (rule 5), so a wrapper **cannot** "force the suffix" by overwriting a payload field
   without changing `manifestDigest` and tripping `repl_manifest_digest_mismatch`. The
   self-contradiction in v1 is deleted. Instead: the coordinator wrapper
   `admitReplManifest(workerId, fields, opts)` (a sibling of `requestBoardClaim`,
   coordinator.mjs:9153-9160) resolves the worker handle's task and **derives
   `principalId`/`repoId`/`runId` from it**, threading them into `auth` alongside `{actor, key}`
   — the board-claim precedent passes only `{actor, key}` (:9160), which `normalizeContextAuthority`
   (context-authority.mjs:26-41) could not satisfy, so this is a deliberate widening of the
   threaded auth, not a copy. `replRole` **passes through unaltered** (digest-covered). The
   STORE then verifies `manifest.repl.replRole === 'worker:' + auth.principalId`; a submitted
   `worker:<other>` that disagrees with the wrapper-derived `principalId` is refused
   `repl_manifest_authority_denied` — a worker can only admit into its own layer, never name
   another's. The red test pins the exact code `repl_manifest_authority_denied` (rule below),
   never a bare `assert.rejects`.
8. **Admission validation order (fail before append).** (a) manifest re-normalizes and its
   digest matches `manifestDigest`; (b) `runId`/`replRole` coherence (rule 5);
   (c) principal authority + `auth.repoId === this._repoId` (rule 6/7, the repoId pin mirroring
   the Workflow path `authority.repoId !== this._repoId`, coordination-store.mjs:4865);
   (d) `runId` is not stopping (the run-stop preamble, **rule 14** — a `repl.manifest_admitted`
   appended after `run.stop` throws `run_stopping` at fold, coordination-store.mjs:7216-7217);
   (e) bounds (rule 9); (f) **two-level idempotency/conflict (P1-6).** First the key level:
   `this._byKey.get(auth.key)` — a prior admission under the same key must have identical
   `kind`/`actor`/`requestDigest`/`manifestDigest` or `repl_manifest_conflict`; a matching prior
   returns `{ ok:true, result:'idempotent' }` with the projected record (the
   `admitContextSession` idempotency shape, coordination-store.mjs:8887-8902). Then the
   **digest level**, because `_replManifestAdmissions` is keyed by `manifestDigest` and would
   otherwise be last-wins across *different* keys: `this._replManifestAdmissions.get(manifestDigest)`
   — if a prior record exists with an identical core (`requestDigest` equal, hence same
   `runId`/`replRole`/`principal`), the admission is `idempotent` and returns that record; if it
   exists with a **divergent** `principal`/`runId`/`replRole`, the write is refused
   `repl_manifest_conflict` (never a silent overwrite that shifts the principal under an
   existing session). Only after (a)–(f) does the hub `_append('repl.manifest_admitted', payload,
   auth)`; a post-append projection-absent check throws `CoordinationIntegrityError`
   (`repl_manifest_integrity`), mirroring :8957-8961.
9. **Bounds — named home and repoId provenance (P2-12).** `_replManifestAdmissions` records
   per `(repoId, runId)` are capped by **`this._runLineagePolicy.maxReplManifestsPerRun`** — a
   named, configurable field on the existing per-run structural policy that already governs
   `maxChildrenPerRun`/`maxDescendantsPerRoot`/`maxDepth`
   (coordination-store.mjs:1372-1376). It is **deliberately not** a field on the
   context-program policy: that policy's field set feeds `policyDigest`
   (context-program-policy.mjs:4-8, :48, :77), which is embedded in every manifest and session
   digest, so adding a field there would perturb every existing Workflow manifest digest —
   forbidden. The run-lineage policy is digested separately
   (`canonicalDigest(this._runLineagePolicy)`, :1281) and touches no manifest basis, so it is
   the correct home. Its default rides the same construction as the sibling ceilings (no magic
   constant baked into the store body; the derivation — "one admitted manifest per REPL layer
   per run, times the per-run worker fan-out the run-lineage policy already bounds" — is
   documented at the policy definition, per the No-Arbitrary-Numeric-Limits rule). The stored
   `principal.principalId`/`actor` come from the authenticated lease/wrapper (rule 6/7), and
   `repoId` is `this._repoId`, never a caller field. `manifestDigest` is a 64-hex digest; the
   manifest itself is already bounded by the branch discipline (Part A rule 3) and the ≤64MB
   cell/source substrate — no new size limit is invented. Exceeding the per-run count is
   `repl_manifest_limit` (a typed refusal, never a silent drop).

## Part C — the openSession path and `admitContextCell` principal pinning (R33 rule 3)

**Decision: a new session-admission path keyed to the `repl.manifest_admitted` record; cell
computation below the authority line is the REFLEX-4 Bench path unchanged.** The evaluator
(`StatelessContextBench.execute`, the 14 pure ops + 4 predicates) and the `context.*` cell
events are untouched. The edits named in rules 10–13 are all authority/identity/fold, listed
individually — NOT "byte-for-byte unchanged" (P0-1..3, the reword the red-team requires).

10. **New session admission, not the Workflow one (P0-1).** `admitReplSession(fields, auth)`
    mints a `context.session_admitted` record for a ReplManifest **without** the Plan-node
    requirement (`admitContextSession` refuses no-plan-node manifests at
    coordination-store.mjs:8904-8913). It reuses `contextSessionIdentity` (now kind-dispatching,
    rule 4b) and the per-branch source **read + byte-proof** loop
    (coordination-store.mjs:8914-8930: `_contextReferenceRead` then
    `contextValueDigest(source) === branch.digest && items.length === branch.itemCount`) — a
    REPL session still proves every branch's bytes against its manifest. It **does not** call the
    Plan-node-coupled `_normalizeContextSourceAttestation` (:8940-8943 → :4648-4649, which reads
    `manifest.workflow.node.digest` and `node.contextScope` — absent from any ReplManifest), so
    it mints at **schemaVersion 1** (the `sourceAttestations` array is required only at
    schemaVersion 2, :4924-4935); v1's claim that the attest loop is reused "verbatim" is
    corrected here. Its authority precondition is a settled `repl.manifest_admitted` record for
    `manifest.digest` whose `runId`/`replRole` match; absent that record, refusal is
    `repl_session_unadmitted`. The stored session's `authority` is the normalized context
    authority (`{ actor, principalId, repoId, runId }`) built from the admission record's
    principal, so the session carries the REPL authority forward.
10a. **The fold/admit re-validator gets a kind branch (P0-1).**
    `_validateContextSessionPayload` (coordination-store.mjs:4818), driven at fold by
    `_apply('context.session_admitted')` (:7318) and at admit by `admitReplSession`, keeps its
    shared prefix (authority shape + `normalizeContextAuthority`, identity recompute via the
    now-dispatching `contextSessionIdentity` :4844, `requestDigest`/`admissionDigest`/session
    digest/idempotency-key checks :4854-4876, and the deployment tree/env/policy currency check
    :4877-4885 — all kind-agnostic and unchanged). It then **branches on
    `session.manifest.kind`**: for `baton.repl_manifest` it **skips** the goal/plan/approval
    block (:4887-4906) and the node/task/dispatch block (:4908-4922) and instead requires the
    settled `this._replManifestAdmissions.get(session.manifestDigest)` record — present, with
    `record.runId === session.runId`, `record.replRole === manifest.repl.replRole`, and its
    principal matching `payload.authority` — then `_assertRunAdmissionOpen(session.runId,
    integrity)` (:4936) and returns `{ session: {...session, deployment, sourceAttestations: []},
    requestCore, admissionCore }`. This is replay-derivable: the manifest's
    `repl.manifest_admitted` event has a lower seq than its session, so its map has folded first.
    Mismatch at fold is `context_session_integrity`; at admit, `context_session_invalid`. For
    `baton.context_manifest` the existing Workflow path runs unchanged (the `else`).
11. **The runtime opens against the admission record, not a dispatch (P0-2).** A new
    `openReplSession({ manifestDigest, principal, signal })` on the context runtime replaces the
    Plan-gated Attempt lookup (context-runtime.mjs:1148-1210, the `context_session_stale` wall)
    with: resolve the single active `repl.manifest_admitted` record for `(repoId, manifestDigest)`,
    verify `principal` matches the record, and construct a `DurableContextSession`
    (context-program.mjs:1170-1194). The constructor is edited minimally and symmetrically:
    (i) `normalizeContextManifest` (:1187) becomes `normalizeManifestAny` (rule 4a), so a
    ReplManifest survives construction instead of throwing at the Workflow field check;
    (ii) it accepts a new optional **`admitSession` injected function** (defaulting to
    `(f, a) => coordination.admitContextSession(f, a)`, exactly how it already accepts an
    injected `execute`, :1171, :1182) which the admission at :1190-1192 calls instead of the
    hard-coded `coordination.admitContextSession`. `openReplSession` passes
    `admitSession: (f, a) => coordination.admitReplSession(f, a)`. **This contract chooses the
    injected-function form, not a pre-admitted-session handle**, because it preserves the
    constructor's existing "admit-on-construct, then hold `sessionId`" shape and its
    `context.session:<manifestDigest>` idempotency key (:1192) unchanged. The `principal` is the
    record's `{ actor, principalId, repoId, runId }` — the exact 4-key shape the constructor
    validates (:1177-1179). `DurableContextSession.evaluate` is unchanged (:1238-1247): it still
    admits cells under the deterministic key
    `context.cell:${sessionId}:${program.programDigest}` (:1244) and returns the
    attention-retryable settle on transient input loss (:1259-1271).
12. **The cell-admission gate gets a kind branch too (P0-3), and `admitContextCell` principal
    pinning is the enforcement point, unchanged.** `_validateContextCellAdmissionPayload`
    (coordination-store.mjs:4943) calls `_assertContextSessionCurrent(session, integrity)`
    (:5003), which today dereferences `manifest.workflow.goal` (:4778) and demands the Workflow
    goal/plan/approval + working task + dispatch binding (:4799-4813) — a bare TypeError on a
    REPL session. `_assertContextSessionCurrent` keeps its shared deployment currency check
    (:4768-4776) and then **branches on `manifest.kind`**: for `baton.repl_manifest` it requires
    the settled `this._replManifestAdmissions.get(session.manifestDigest)` record (present,
    `runId`/`replRole` match), calls `_assertRunAdmissionOpen(session.runId, integrity)` (:4814),
    and returns — skipping the goal/plan/node/task/dispatch assertions entirely. The
    caller-principal pin is then genuinely unchanged: `admitContextCell` already refuses any cell
    whose caller authority differs from `session.authority`
    (`canonicalDigest(authority) !== canonicalDigest(session.authority)` →
    `context_cell_unauthorized`, :9017-9019). Because rule 10 stores the REPL admission principal
    as `session.authority`, a cell may be computed against a REPL session **only** by the
    principal that admitted the manifest (`shared`: the orchestrator; `worker:<id>`: that
    worker). No change at :9017-9019 — REPL-1 makes it the load-bearing gate for the new
    authority model. Cell identity, idempotency, settlement, and the completed-cell `outputRef`
    projection (context-program.mjs:989-1001, coordination-store.mjs:9021-9043) are the
    REFLEX-4 path unchanged; `_validateContextCellSettlementPayload` (:5007) checks authority
    against `cell.authority` and never calls `_assertContextSessionCurrent`, so settlement needs
    no branch.
13. **Named authority-layer edit inventory (supersedes reflex4 scope, narrowly).**
    reflex4-decisions.md's "no new event kinds beyond `context.*`" and "do not modify the
    evaluator" are relaxed **exactly** as follows, and no further:
    (i) one new event kind `repl.manifest_admitted`;
    (ii) `normalizeManifestAny` + its three call-site swaps (rule 4a: context-authority.mjs:61,
    :82; context-program.mjs:1187);
    (iii) the `runId` dispatch in `contextSessionIdentity` (rule 4b: context-authority.mjs:90);
    (iv) `DurableContextSession`'s `admitSession` injection (rule 11:
    context-program.mjs:1171/1182/1190-1192);
    (v) the `manifest.kind` branch in `_validateContextSessionPayload` (rule 10a) and in
    `_assertContextSessionCurrent` (rule 12);
    (vi) `admitReplSession` + `admitReplManifest` (new methods);
    (vii) the fold surface additions (Part D);
    (viii) the Workflow-deref guards (rule 13a).
    The evaluator (`StatelessContextBench`/`DurableContextSession.evaluate`) and the `context.*`
    cell *computation* are untouched — only *who* may open a session and *against what admission
    record*.
13a. **Guard every unguarded `manifest.workflow.*` scan against REPL sessions (P1-7).** A REPL
    `context.session_admitted` record lives in the same `_contextSessions` map and rides the same
    `snapshot().context.sessions` list, so every site that iterates sessions and dereferences
    `session.manifest.workflow.*` without a kind guard throws a bare `TypeError` the moment one
    REPL session exists — wedging unrelated Workflow paths. Each such site gains a
    `session.manifest.kind === 'baton.context_manifest'` guard (skip/ignore REPL sessions there;
    they are not Workflow eval targets): the runtime `openSession` existing-session rescan
    (context-runtime.mjs:1198-1210, the `.workflow.definitionDigest`/`.goal`/`.plan`/`.node`/
    `.task` derefs at :1204-1209); `_contextSectionItems` (application.mjs:7368); and the
    `manifestDigest`-scoped `_resolveContextEvalManifestTarget` (application.mjs:8534, :8545),
    which — reached with a REPL `manifestDigest` — refuses with its existing typed
    `application_context_eval_manifest_unavailable` instead of dereferencing `.workflow`. The red
    test proves Workflow `openSession` still succeeds with a REPL session present (rule below).

## Part D — the fold surface (docs/33 §4, R33-5 — enumerated, with a kind-inventory test)

Every new event kind ships its full fold in the **same** commit or the checkpoint validator
rejects a mixed projection. For REPL-1 that kind is `repl.manifest_admitted`.

14. **`_apply` branch + run-stop preamble.** `_apply` gains
    `else if (event.kind === 'repl.manifest_admitted')` storing the validated record into a new
    `this._replManifestAdmissions` map keyed by `manifestDigest` (freeze + `admittedEvent`/`
    admittedAt`, the context-session apply shape, coordination-store.mjs:7317-7323). The run-stop
    preamble (:7195-7218) gains `else if (event.kind === 'repl.manifest_admitted') admittedRunId
    = p?.runId ?? null;` so a REPL admission appended after `run.stop` begins throws
    `run_stopping` (:7216-7217) — REPL writes refuse after stop, like every effect. The new kind
    must appear before the terminal `unsupported_event_kind` throw (:8006-8007) or replay of a
    real log fails loudly — which is the intended tripwire.
15. **`PROJECTION_CHECKPOINT_FIELDS`.** `'_replManifestAdmissions'` is added to the frozen list
    (coordination-store.mjs:89-110). Checkpoint load validates the field set **exactly**
    (`Object.keys(projection).sort().join(',') !== [...PROJECTION_CHECKPOINT_FIELDS].sort()...`,
    :743-744), so the same commit that adds the map must add the field — a checkpoint written by
    old code fails to load against new code and vice-versa, never a silent field drift. No
    migration shim; the field-set change is explicit and versioned by that failure. (REPL
    sessions themselves ride the existing `_contextSessions` field, :105, so no session field is
    added.)
16. **`snapshot()` exposure.** `snapshot()` (coordination-store.mjs:10341) gains a conditional
    `repl` block — `...(this._replManifestAdmissions.size > 0 ? { repl: { manifests:
    [...this._replManifestAdmissions.values()].map(clone) } } : {})` — matching the existing
    conditional-when-nonempty pattern (e.g. `runStops`, `runResultAdoptions`, :10341). REPL
    sessions ride the existing `context.sessions` snapshot list (:10341, from rule 10's
    `context.session_admitted`), so no separate session snapshot is added.
17. **Event-kind inventory test — a static mechanism, not a live full-kind drive (P2-10).** A
    new `impl/test/repl1-kind-inventory-red.test.mjs` asserts the *closed* set of coordination
    event kinds the store folds, statically: it reads the `_apply` method source
    (`CoordinationStore.prototype._apply.toString()`) and extracts every kind literal from the
    `event.kind === '...'` comparisons and `[...].includes(...)` lists, then asserts (a)
    `repl.manifest_admitted` is among the extracted literals; (b) every extracted kind whose fold
    writes a projection map has that map's name present in `PROJECTION_CHECKPOINT_FIELDS` (the
    cross-check that catches "kind folds but no checkpoint field" — e.g. `_replManifestAdmissions`
    must be in both); and (c) driving the store with a synthetic **undeclared** `repl.*` event
    still throws `unsupported_event_kind` (:8006-8007). This needs no impractical enumeration of
    every kind's full payload — it is a source-derived set membership + a checkpoint-field
    cross-check + one negative drive. It is authored in REPL-1 and **grows** as REPL-2's
    `repl.binding_set`/`repl.binding_dropped` land — an incomplete fold fails at test time, not
    at a customer's replay.

## Part E — red tests first (`impl/test/repl1-manifest-red.test.mjs`)

- **Shape (Part A):** `normalizeReplManifest` accepts a `shared` and a `worker:<id>` manifest,
  deletes-and-recomputes `digest`, and refuses a supplied-digest mismatch
  (`repl_manifest_invalid`); refuses a `workflow` field, a missing `repl` field, a `replRole`
  outside `{shared, worker:<narrow-id>}` (including a suffix containing `:`, proving the
  deliberate narrowing vs `SAFE_ID`), and a `kind: baton.context_manifest`; a byte-identical
  `tree`+`branches` pair under the two kinds yields **different** digests (disjoint basis);
  branch discipline (unique names/refs, `ctx:sha256` ref, bounds) rejects the same malformations
  `manifestBranch` rejects today. `normalizeManifestAny` dispatches both kinds and refuses a
  third `kind` (`context_manifest_invalid`).
- **Authority (Part B):** a `shared` admission with a valid orchestrator lease **whose
  `lease.parent.runId` equals the manifest's `repl.runId`** succeeds and records the lease
  principal; the same manifest with no lease is `repl_manifest_authority_denied`; **a lease for
  run X against a manifest for run Y is `repl_manifest_authority_denied`** (the P1-4 cross-run
  bleed, pinned by code); a `worker:<a>` caller admitting a `worker:<b>` manifest is refused
  **`repl_manifest_authority_denied`** (the exact code, P1-5 — the store equality
  `replRole === 'worker:' + auth.principalId` fails, and the wrapper did not rewrite the
  digest-covered field); a manifest whose recomputed digest ≠ payload `manifestDigest` is
  `repl_manifest_digest_mismatch`; a caller `authority.repoId !== store repoId` is refused
  (P2-12 provenance pin); re-admitting under the same idempotency key with an identical core is
  `idempotent`, **a second admission of the same `manifestDigest` under a different key but a
  divergent principal/runId is `repl_manifest_conflict`** (the P1-6 last-wins fix, not a silent
  overwrite), and an identical-core re-admission under a new key is `idempotent`; the per-run
  ceiling (`_runLineagePolicy.maxReplManifestsPerRun`) refuses with `repl_manifest_limit`.
- **Session + cell (Part C):** `openReplSession` opens a `DurableContextSession` against a
  ReplManifest with **no** Plan-gated dispatch (a run that would fail
  `context_session_stale`/`context_source_attestation_invalid` in the Workflow path); a pure
  Program evaluates to a durably-admitted, digest-citable cell; a cell computed by a principal
  other than the admission principal is `context_cell_unauthorized` (the :9017-9019 gate); an
  unadmitted manifest digest is `repl_session_unadmitted`; the same `(session, program)` is
  idempotent by the `context.cell:` key. **A REPL session present in `_contextSessions` does not
  wedge the Workflow path: a Workflow `openSession` (and `_contextSectionItems`) still succeeds
  with a live REPL session in the map** (P1-7, proving the rule 13a guards).
- **Fold + replay (Part D):** `_apply('repl.manifest_admitted')` folds into
  `_replManifestAdmissions` and a `repl.manifest_admitted` appended after `run.stop` throws
  `run_stopping`; a checkpoint round-trip preserves the map and a projection missing
  `_replManifestAdmissions` fails the field-exact load (:743-744);
  `snapshot().repl.manifests` reflects admitted records; **replay symmetry — admit a REPL
  manifest + session + cell, reload the store from the ledger (or a checkpoint), and the
  projection rebuilds with the session foldable and the cell settleable, no
  `context_session_integrity`/`unsupported_event_kind` throw** (P1-8, the missing symmetry test);
  the kind-inventory test (rule 17) asserts the closed kind set statically.

Then the full suite `node impl/scripts/run-suite.mjs` green from the worktree root, and the
wave-driver reviewer contract (`node --test impl/test/wave-driver-red.test.mjs`, exit 0) stays
green.

## Part F — boundaries

- **One manifest family per object.** `normalizeReplManifest` and `normalizeContextManifest` are
  disjoint by `kind`; neither accepts the other's object. `normalizeManifestAny` only dispatches
  — it never widens either normalizer, and it is wired at exactly the three identity/session
  construction sites (rule 4a), nowhere else.
- **The evaluator is not touched; the authority layer is, and its edits are named.**
  `StatelessContextBench`, `DurableContextSession.evaluate`, the `context.*` cell events, the 14
  pure ops + 4 predicates whitelist, and the provider-effect gate
  (`context_cell_effect_requires_workflow`, coordination-store.mjs:8977-8980) are unchanged. The
  authority-layer edits are the enumerated set in rule 13 — this contract does **not** claim
  context-authority.mjs / context-program.mjs are byte-for-byte unchanged.
- **No new branch ref form.** `cell:` refs are REPL-3; REPL-1 manifests carry only
  `ctx:sha256:<digest>` source branches. **No named bindings** — `repl.binding_set`/`_dropped`
  and the per-scope binding fence are REPL-2 (docs/33 §3.2). This contract emits exactly one new
  event kind.
- **No caller-supplied authority.** `shared` writes are lease-authenticated **and run-pinned**;
  `worker` writes are wrapper-derived and store-verified by equality. The store never trusts a
  `principal`/`owner`/`replRole` string as authority, and never rewrites the digest-covered
  `replRole`.
- **No cross-run, no mutation.** Admissions are per-`(repoId, runId)` and lease-run-pinned; no
  cross-run REPL manifests (project-persistent objects ride the KG, docs/34). Records are
  immutable and replay-derived; no in-place edit, no `repl.read` event kind, no ledger write on
  read.
- **No credentials, no git, no scratch/temp writes.** Nothing in this contract writes outside
  the coordination ledger; no `/tmp`, no git commits, no harness/global-config mutation.

## Part G — validation

Focused red suite (`impl/test/repl1-manifest-red.test.mjs`,
`impl/test/repl1-kind-inventory-red.test.mjs`) green; then the full suite
`node impl/scripts/run-suite.mjs` green from the worktree root; the wave-driver reviewer
contract `node --test impl/test/wave-driver-red.test.mjs` (exit 0) stays green — verified green
against the current tree before this contract landed.

## v2 revisions

Each red-team finding (repl1-redteam.md) and its resolution. The report was right on every
finding; no rebuttals.

- **P0-1 (session identity/fold re-validation throws on a REPL manifest).** Resolved: rule 4a
  (`normalizeManifestAny` at context-authority.mjs:82) + rule 4b (`contextSessionIdentity` reads
  `repl.runId` for a repl manifest) + rule 10a (the `manifest.kind` branch in
  `_validateContextSessionPayload` that skips goal/plan/approval :4887-4906 and instead requires
  the settled `repl.manifest_admitted` record, replay-derivable because its map folds first).
- **P0-2 (`DurableContextSession` constructor hard-codes the Workflow normalizer + admission).**
  Resolved: rule 11 — `normalizeContextManifest`→`normalizeManifestAny` at
  context-program.mjs:1187, and a new injected `admitSession` function (default
  `admitContextSession`, `openReplSession` passes `admitReplSession`); the contract explicitly
  chooses the injected-function form over a pre-admitted-session handle.
- **P0-3 (cell path refuses REPL at `admitContextCell`→`_assertContextSessionCurrent` and at
  `contextCellIdentity`→`contextProgramInputRefs`→`normalizeContextManifest`).** Resolved:
  rule 4a (`normalizeManifestAny` at context-authority.mjs:61) + rule 12 (the `manifest.kind`
  branch in `_assertContextSessionCurrent` keyed to the admission record, not a working
  dispatch). One coherent normalization story (rule 4a), one kind-branch story
  (rules 10a/12) — not two hacks.
- **P1-4 (cross-run shared-authority bleed: lease lookup has no runId).** Resolved: rule 6 pins
  `lease.parent.runId === payload.runId` (coordination-store.mjs:1343), else
  `repl_manifest_authority_denied`; red test admits a lease for run X against a manifest for
  run Y and asserts the refusal.
- **P1-5 (rule 7 self-contradiction: `replRole` is digest-covered so the wrapper cannot force
  the suffix; auth under-threaded).** Resolved: rule 7 rewritten — the wrapper threads
  `principalId`/`repoId`/`runId` derived from the worker handle's task (widening the board-claim
  `{actor,key}` precedent, coordinator.mjs:9160), `replRole` passes through unaltered, and the
  STORE verifies `manifest.repl.replRole === 'worker:' + auth.principalId`; the red test pins the
  exact code `repl_manifest_authority_denied`.
- **P1-6 (re-admission of the same `manifestDigest` is last-wins).** Resolved: rule 8(f) adds a
  digest-level conflict gate on `_replManifestAdmissions.get(manifestDigest)` — identical core →
  `idempotent`, divergent principal/runId/replRole → `repl_manifest_conflict`; red test covers
  both.
- **P1-7 (one REPL session wedges Workflow `openSession` via unguarded `.workflow` derefs).**
  Resolved: rule 13a adds `manifest.kind === 'baton.context_manifest'` guards at
  context-runtime.mjs:1198-1210 (:1204-1209), application.mjs:7368, and :8534/:8545; red test
  proves Workflow `openSession` succeeds with a REPL session present.
- **P1-8 (no replay-symmetry red test).** Resolved: Part E fold+replay bullet adds
  "admit REPL manifest+session+cell → reload from ledger/checkpoint → projection rebuilds →
  session foldable, cell settleable, no integrity throw".
- **P2-9 (rule 8(d) cross-ref broken).** Resolved: rule 8(d) now cites **rule 14** (the run-stop
  preamble, coordination-store.mjs:7216-7217), not the nonexistent "Part D rule 12".
- **P2-10 (kind-inventory "drive every declared kind" is impractical).** Resolved: rule 17 now
  specifies a static mechanism — extract `event.kind ===` / `.includes(...)` literals from
  `_apply.toString()`, cross-check map-writing kinds against `PROJECTION_CHECKPOINT_FIELDS`, and
  one negative drive of an undeclared `repl.*` kind.
- **P2-11 (`worker` regex stricter than `SAFE_ID`).** Resolved: rule 2 pins the narrower
  `^worker:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` deliberately (no `:`, unlike `SAFE_ID` at
  context-program.mjs:18) so the `worker:` boundary and the store equality stay unambiguous; the
  red test exercises a rejected `:`-bearing suffix.
- **P2-12 (`principal` repoId provenance unpinned; `MAX_REPL_MANIFESTS_PER_RUN` homeless).**
  Resolved: rule 8(c)/rule 9 pin `auth.repoId === this._repoId` (mirroring
  coordination-store.mjs:4865) and store `repoId = this._repoId`; the ceiling gets a named home
  `this._runLineagePolicy.maxReplManifestsPerRun` (coordination-store.mjs:1372-1376) —
  deliberately NOT on the context-program policy, whose field set feeds `policyDigest`
  (context-program-policy.mjs:4-8, :48) and would perturb every manifest digest — with a
  documented derivation and default.
