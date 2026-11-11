# Swarm partition report — replica-B

Partition: §93.8 approval-template projections vs `impl/src/program-ir/approval-template.mjs` +
`impl/src/program-ir/role-catalog.mjs` (effectKinds, repositoryScopes, constraint digests).

## Verdict

PASS. Every §93.8 projection claim checked is grounded in the spec text and correctly
implemented. Pinned verification run from the assigned worktree root:

`node --test impl/test/phase93a-control-grammar-red.test.mjs` → exit 0, 55/55 pass (including
P93A2-T1 projection-drift rejection, P93A2-T2 constraint-digest/bound-name/templateDigest
recomputation, P93A2-C1..C5 catalog rules).

Claim-by-claim grounding:

- Template shape (spec/phase93-closed-program-ir.md:582-595): the exact 12-field set,
  `schemaVersion = 1`, `kind = "baton.program_approval_template"`, and the three pinned bound
  names are enforced at approval-template.mjs:88-94 and 116-124.
- `roles = set-like role names[1..policy.maxProgramNodes]` and "MUST equal the sorted set of role
  names in the normalized role catalog" (spec:589, 599): bound, SafeId, and duplicate checks at
  approval-template.mjs:95-100; elementwise equality against `computed.roles`
  (approval-template.mjs:126-129), where `computed.roles` derives from a catalog whose roles are
  duplicate-free and sorted by unsigned UTF-16 code unit (role-catalog.mjs:219-221;
  `compareProgramIdentityKeys` uses relational string comparison, canonical-value.mjs:67-72).
- `effectKinds = set-like subset of the seven effect kinds[0..7]` (spec:590): the impl vocabulary
  `['call','checkpoint','finish','gate','map','notify','reduce']` (approval-template.mjs:26-28)
  is exactly the spec's effect vocabulary `call map reduce gate notify checkpoint finish`
  (spec:28), in sorted order; subset/duplicate/length checks at approval-template.mjs:101-107.
- "effectKinds MUST equal the sorted set of the seven effect kinds statically present in the
  Program's own nodes… repeat/child bodies… never restated" (spec:600-604): the template module
  takes `usedEffectKinds` from the caller and enforces exact equality after dedup+sort
  (approval-template.mjs:46-51, 130-134); the handoff is honored — normalize-program.mjs:114-119
  passes `[]` because the 93a.2 source grammar admits only control/data node kinds and
  repeat/child bodies are digest refs, matching the spec's empty-set rule for effect-free
  Programs.
- `repositoryScopes` (spec:591, 605-616): sorted union of **inline-only** `pathScope` ∪
  `contextScope` at approval-template.mjs:52-58 (`content_ref` bindings are skipped, so an
  all-`content_ref` catalog yields the empty projection, as the spec requires); the
  `[0..policy.maxEvidenceRefs]` bound and normalized repository-relative path validation via
  `normalizePathArray` at approval-template.mjs:108-109; exact equality against the computed
  union at approval-template.mjs:135-138.
- Constraint digests (spec:617-626): all three recompute as
  `H(Program-canonical bytes of exact{kind, entries})` with the exact kind strings
  `baton.route_constraint` / `baton.service_tier_constraint` / `baton.worker_policy_constraint`
  and entry field sets `exact{role,routeRequest}`, `exact{role,serviceTierRequest}`,
  `exact{role,workerPolicyRequest,workerPolicyRequestDigest}` (approval-template.mjs:59-69).
  Set-like-by-role is guaranteed structurally: entries are mapped from the normalized catalog,
  which rejects duplicate roles and sorts by unsigned UTF-16 role name
  (role-catalog.mjs:219-221). `canonicalProgramDigest` is sha256 over the sorted-key canonical
  serialization (canonical-value.mjs:178-186, 224-226). Exact-equality enforcement at
  approval-template.mjs:139-147.
- `templateDigest` hashes the complete template excluding itself (spec:627): recomputed over
  `sansDigest` at approval-template.mjs:148-158.
- "The template grants nothing" (spec:629) and projection exhaustiveness (spec:656-657):
  `normalizeApprovalTemplate` only validates/recomputes and returns a deep-frozen value
  (approval-template.mjs:159); the equality checks make omission or narrowing of any projection
  a rejection, so a smaller approval cannot be obtained by dropping authority.

Observations (not defects): `repositoryScopes` input is normalized to sorted order before
comparison (`normalizePathArray` sorts), while `roles`/`effectKinds` inputs must already be in
sorted order to pass the elementwise equality — a benign asymmetry consistent with the "MUST
equal the sorted set" wording and with set-like normalization elsewhere (test P93A2-PERM1).
The `usedEffectKinds` seam trusts the caller to compute static presence; in 93a.2 that caller is
`normalize-program.mjs` with a provably empty set, so no laundering channel exists within this
slice.

## P0-P1 findings

None.

## Required corrections

None.
