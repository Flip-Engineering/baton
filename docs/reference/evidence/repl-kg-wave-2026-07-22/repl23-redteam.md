# Red-team report: repl23-decisions.md (v1) — verdict: NEEDS REVISION

Every finding MUST be resolved in v2 or explicitly rebutted with file:line code evidence.

## P0-1 — binding identity has no run/manifest dimension (rules 4, 25, Part I mutually unimplementable)

Rule 1's `exact{ scope, name, bindingVersion, state, cellId, bindingDigest }` carries no
runId/manifestDigest; rule 22 keys `_replBindings`/`_replBindingHistory` by `${scope}:${name}`;
rule 7 keys fences by bare scope; the citation grammar has no run component. Two runs binding
`shared:x` share one map key — version CAS spans runs (cross-run pollution, violating the
docs/33 §6 non-goal Part I cites). "The governing repl.manifest_admitted record" is undefined
(multiple manifests per run possible). Rule 25's run-stop preamble cannot derive a runId from
the payload (compare the `context.cell_admitted` case reading `p?.cell?.sessionId`,
coordination-store.mjs:7207-7208). FIX: add `manifestDigest` to the event payload and record;
key fences/bindings/history/citations by `(runId, scope, name)`; REPL-1 enforces a singleton
shared manifest per run so "the governing record" is well-defined; rule 25 derives runId via
the payload's manifestDigest.

## P0-2 — rule 19 records `art:sha256:` where only `ctx:sha256:` can live

Rule 19 records `result.outputRef` verbatim (handle `art:sha256:<digest>`,
context-authority.mjs:142-155) as the branch coordinate. But `manifestBranch` requires `ref` to
match SOURCE_REF `^ctx:sha256:([a-f0-9]{64})$` AND equal `branch.digest`
(context-program.mjs:164-165) — an `art:` handle fails normalization; replay dies. Rule 20
itself contradicts rule 19 by naming `ctx:sha256:`. Also unspecified: `itemCount`, `mediaType`,
`summary` (mandated at :160-179; settlement revalidation enforces
`items.length === branch.itemCount`, coordination-store.mjs:8510-8514); and the output value is
a `baton.context_value` envelope (context-program.mjs:539-549) that `normalizeContextSource`
treats as ONE item (:574). FIX: record `branch.digest = outputRef.digest`,
`branch.ref = ctx:sha256:<outputRef.digest>` (bytes resolve: `_writeArtifact` wrote them to the
same CAS root `_readSource` reads, context-program.mjs:652-686 vs :634-649); pin the source
bytes story (envelope vs items array), itemCount, mediaType, summary provenance.

## P1-3 — citation grammar non-injective; map key collides

`name` is a SafeId (`:` allowed) and the worker segment allows `:` — `repl:worker:w-7:b:c@1`
parses greedily wrong; two distinct (scope,name) pairs serialize to one citation; rule 22(a)'s
`${scope}:${name}` key clobbers. FIX: exclude `:` from the NAME charset (pin deliberately);
pin the worker segment to the real workerId grammar; key maps by JSON-encoded tuple; add a red
test for a `:`-containing name REJECTION.

## P1-4 — divergent-replay idempotency overstated

"Every other admission path refuses divergent replayed keys" is false: `_append` returns the
prior event blindly (coordination-store.mjs:1030-1031); divergence comparisons exist only on
the context.* paths (:8981-9000, :9073-9079); the board methods the contract mirrors do NOT
compare (:12062-63, :12143-44). FIX: specify the payload-comparison block in the
:8981-9000 shape and add a divergent-key red test.

## P2-5 — store-level caller identity channel unspecified

The store learns only `auth.{actor,principalId,repoId,runId}` (:9010-9013); which field
carries callerWorkerId for the `worker:${callerWorkerId}` check is unspecified. And "forces
the scope segment" silently retargets a `worker:other` write into `worker:self` instead of
refusing. FIX: name the auth field; refuse mismatched caller-supplied scopes.

## P2-6 — sanitization red test near-vacuous

Resolved cellId/digest "is never prose" — nothing resolved needs boundedAttentionText. The
attacker-influenced strings are `scope`/`name`. FIX: specify that rendered views wrap
`name`/`scope` (application.mjs:340-346 discipline); test that.

Verified sound (keep): fence re-count matches _apply fold; checkpoint exact-match refuses old
checkpoints; the cell: admission race holds (single-threaded admission: lookup :8071 + reverify
:8526-8534/:9088-9098 + append atomic); `_contextCells` never evicted; lost-artifact →
attention/retryable matches :1260-1271; worker wrapper-binding :9153-9171; unsupported_event_kind
throw :8007. Minor cite drift: "does NOT bump" comments live at :7741/:7744-7748, not :7743-7753.
