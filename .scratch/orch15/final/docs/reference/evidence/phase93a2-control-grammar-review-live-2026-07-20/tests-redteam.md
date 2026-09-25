# Phase 93a.2 control-grammar red suite — adversarial review

Scope: `impl/test/phase93a-control-grammar-red.test.mjs`,
`impl/test/fixtures/phase93a-program-fixtures.mjs`, the `impl/src/program-ir/` modules
(`control-nodes.mjs`, `normalize-program.mjs`, `program-policy.mjs`, `role-catalog.mjs`,
`approval-template.mjs`), and spec §93.4 / §93.9 / §93.23 suite 4. Every "verified" claim below
was reproduced by running the cited input against `normalizeProgramSource` in this worktree.

## Verdict

Not sufficient as a red suite. The grammar coverage is broad and many refusal rows are
genuinely pinned (exact error codes plus message regexes), but the suite has one systemic
defect and several concrete holes:

- **Systemic:** every "digest recomputes byte-exactly" assertion is circular. The fixture
  computes `workerPolicyRequestDigest`, `nodeTemplateDigest`, `catalogDigest`,
  `independenceFamily.familyDigest`, the policy digests, and the entire `approvalTemplate`
  with the implementation's own `canonicalProgramDigest` / `createApprovalTemplate`
  (`phase93a-program-fixtures.mjs:87,100,111-118,122-124`). Tests C3, C4, T1, T2, P1, P2, O1
  therefore compare the implementation against itself. No externally computed digest literal
  and no non-ASCII object key appears anywhere in the suite, so a systematic canonicalization
  bug — e.g. sorting keys by Unicode code point instead of unsigned UTF-16 code unit
  (indistinguishable until a non-BMP key appears, §93.4), or a wrong JCS number
  serialization — ships green through all four red suites.
- **Concrete:** several §93.23-suite-4 named rows are not pinned at all (deterministic join
  permutations, duplicate-name refusals, the `all_verified` selector, await dominance,
  policy `maxProgramBytes`, non-empty `verificationContracts`), two headline tests assert
  digests/schemas only by shape or by `name`, one dominance test is shallower than its name
  claims, and one field-set probe conflates two violations.

The suite catches naive regressions but would not catch a canonicalization drift, a dropped
duplicate-name check, a dropped dominance check for `await`/`repeat`/`child` demand roots,
or a wrong `collect` output-schema ref carrying the right name.

## P0-P1 findings

### P0-1. Circular digest fixtures: C3, C4, T1, T2, P1, P2, O1 prove nothing about canonical bytes

The fixture header admits the approval template is "computed from the implementation's own
projection helpers". Concretely:

- `workerPolicyRequestDigest = canonicalProgramDigest(workerPolicyRequest, authority)` (fixture:87),
  then P93A2-C3 (`...red.test.mjs:151-189`) "recomputes byte-exactly" against that value.
- `nodeTemplateDigest` (fixture:100) and the role `familyDigest` (fixture:111-113) feed
  P93A2-C4 (:191-242).
- `catalogDigest` (fixture:117-119) feeds P93A2-C1 (:110-128).
- `createApprovalTemplate(...)` (fixture:122-124) feeds P93A2-T1 (:285-308) and P93A2-T2
  (:310-325), whose "recompute exactly" tamper rows only prove that a *different* random
  digest is rejected — the accepted digest is whatever the implementation happened to compute.
- P93A2-O1 (:1161-1162) verifies `ownershipDigest` by recomputing it with the same
  `canonicalProgramDigest` under test.

Violating change that slips through: alter `canonicalProgramBytes` to sort object keys by
code point, or to emit JCS-noncompliant numbers. Both sides of every comparison above shift
together; C3/C4/T1/T2/P1/P2/O1/K2/K3/R1 all stay green while cross-language identity
(§93.4) is silently broken. No test in this suite contains a digest literal produced by an
independent tool (e.g. `printf ... | shasum -a 256`) or a non-ASCII key.

### P0-2. P93A2-R1 and P93A2-K1 pin digests by regex, not by value

`assert.match(program.programDigest, /^[a-f0-9]{64}$/u)` (:1101) and
`assert.match(node.nodeId, /^pnode:[a-f0-9]{64}$/u)` (:1108, :521) assert existence and
shape only. The "exact canonical shape" kitchen-sink test never pins `programDigest` to a
literal or to an independently computed digest; `program.schemaRegistryDigest` is compared
to `f.registry.schemaRegistryDigest` (:1102), again implementation-vs-implementation.
Violating change that slips through: any uniform change to canonical bytes (whitespace,
key order, number format) — R1 still passes with a different, well-formed 64-hex digest.
K2/K3 (:527-563) only assert self-consistency across permutations/renames, so an
implementation that emits ready nodes by *largest* nodeId, or by any other deterministic
tie-break than §93.4 step 6, also passes; nothing in this suite pins the actual Kahn order
against known bytes.

### P0-3. P93A2-S1 asserts the derived collect outputSchema by `name` only

:588-590:

```js
assert.equal(collect.outputSchema.name, 'fixture.collect_result');
assert.deepEqual(collect.items.map((item) => item.name), ['alpha', 'beta']);
```

The `outputSchema` ref's `kind`, `schemaId`, `version`, and `digest` are never asserted, and
the items' canonical `PortRef` bytes (`nodeId`, `port`, `schema`) are never asserted — only
their names. Violating output that slips through: an implementation attaching
`{ kind: 'schema_ref', schemaId: 'schema:' + '0'.repeat(64), name: 'fixture.collect_result',
version: 1, digest: '0'.repeat(64) }` (a ref that resolves to nothing) passes S1 while
violating §93.9 ("`outputSchema` is its byte-matching `SchemaRef`"). The fix is one line:
`assert.deepEqual(collect.outputSchema, f.refs.collectResult)`.

### P1-1. "Deterministic join permutations" (suite-4 name) is unpinned: preference-order semantics and set-like input order

- §93.4 classifies selector/join `preference` as **semantic ordered** ("order changes
  identity"). No test permutes preference order. Verified: the same program with
  `first_verified` preference `['a','b']` vs `['b','a']` yields two different
  `programDigest`s — a row could pin this, none does. A regression that sorts `preference`
  inside `validateJoin` (`control-nodes.mjs:284-291`) ships green.
- The set-like sorts (§93.4) of `collect.items`, `select.candidates`, and
  `parallel.branches` are never exercised with unsorted input: S1 supplies items already as
  `['alpha','beta']` (:585), and every candidates/branches list in the suite is already in
  canonical name order. An implementation that preserves input order instead of sorting
  passes every test. Violating input that should exist and does not:
  `f.nodes.collect('col', [['beta', 'vb'], ['alpha', 'vs']])` must normalize with items
  ordered `alpha, beta` (and must still derive the registered schema); equivalently reversed
  select candidates and parallel branches.
- K2 (:527-547) permutes only the source *node* list, not any intra-node name list.

### P1-2. Duplicate-name refusals for collect items, select candidates, and parallel branches have no red rows

§93.4 set-like rows require duplicate-name rejection. The implementation rejects all three
(`control-nodes.mjs:423`, `:488`), verified:

- `f.nodes.collect('col', [['alpha','vs'], ['alpha','vs']])` → throws "contains a duplicate
  name" — untested.
- `f.nodes.select('main', [['a','vs'], ['a','vs']])` → throws "contains a duplicate name" —
  untested.
- `f.nodes.parallel('par', [['a','selA','vs'], ['a','selA','vs']], ...)` → same — untested.

N2 pins duplicate `nodeKey` (:383-387) and A2 pins duplicate `preference` names (:695-698),
but deleting the `names.has(name)` checks in `namedPortArray` / the parallel branch loop
regresses §93.4 with the whole suite green.

### P1-3. The `all_verified` selector and the positive byte-identical-join await are entirely unpinned

- `validateSelector`'s `all_verified` branch (`control-nodes.mjs:331-338`) is never
  exercised: SEL2 (:760-820) covers `ranked` (unknown), `evidence_ranked`,
  `settlement_value`; A2 covers `first_verified`; the default covers `operator_selected`.
  No positive row (`{ kind: 'all_verified', contractDigests: [d1] }` accepted, digests
  sorted) and no negative row (duplicate/empty digests) exists for the selector form, while
  J1 (:822-841) pins exactly those rows for the join form. Deleting the selector branch or
  its digest-set normalization ships green.
- A1 (:631-665) tests await/parallel join *mismatches* but never a positive await repeating
  a byte-identical non-`all_terminal` join; the only positive await-on-parallel join in the
  suite is `all_terminal`/`all_terminal`. The "may use any of the four joins" half of §93.9
  join compatibility is unpinned (the `operator_selected` join on a parallel node is also
  never positively tested).

### P1-4. Dominance coverage stops at select readers; await/repeat/child demand roots and predicate operands unpinned

§93.9: "every await is dominated by the handle producer it awaits". D1 (:967-984) and D2
(:986-1002) exercise only `select` candidate readers after a `branch`. Verified unpinned
refusals:

- Await dominated-check gap: branch `br` enters `par` only in its `then` arm, then
  `sequence('seq', ['br', 'aw'], ...)` with `aw` awaiting `par` — throws "demands a port
  produced by par, which does not dominate it". No test builds an undominated await; the
  check (`normalize-program.mjs:215-250`, `demandRoots` for `await`/`repeat`/`child`) could
  be deleted for those kinds and the suite stays green.
- Predicate-operand dominance: a `branch` whose `predicate` reads a control-produced port
  not dominating it (e.g. `br2` predicate reading `selT` produced only in `br1`'s then-arm)
  is likewise unpinned; same for `repeat.initial`/`continueWhen` and `child.input`.
- Self-edge through a predicate: `branch('br', { kind: 'is_true', value: { nodeKey: 'br',
  port: 'value' } }, ...)` — G3 (:469-481) pins self-edges only for select candidates and
  sequence steps, not for predicate operands.

### P1-5. P93A2-D2 is shallower than its name: "transitive collect chains" tests exactly one hop

D2 (:986-1002) packs the undominated port through a single `collect`. Verified: a two-hop
chain — `colOuter ← colInner ← selT` (undominated) — throws "does not dominate it", but no
row pins it. A regression that walks only one collect level (`normalize-program.mjs:245-248`
with the `walked` set broken) passes D2.

### P1-6. Policy `maxProgramBytes` overflow of the canonical Program is untested

`normalize-program.mjs:537-539` rejects a normalized Program whose canonical bytes exceed
`policy.maxProgramBytes`. Verified: `f.baseSource({ policy: f.makePolicy({ maxProgramBytes:
100 }) })` throws "Program exceeds the ProgramPolicy maxProgramBytes bound". No test covers
it — RAW1 (:37-52) exercises only the *authority* raw-text bound. Shrinking a fixture policy
byte bound or deleting the final size check ships green.

### P1-7. E1 never supplies a non-empty `verificationContracts` array

P93A2-E1 (:15-35) pins the envelope field set but the fixture source always uses
`verificationContracts: []`, leaving `normalize-program.mjs:88-100` unpinned. Verified
unpinned refusals:

- duplicate contract: `verificationContracts: [vc, vc]` → throws "contains a duplicate
  contractDigest";
- malformed contract: `{ ...vc, approvalDigest: 'nope' }` → throws "is not a Digest";
- additionally, the digest-sort normalization of the array (§93.4 set-like by digest) has no
  positive row.

### P1-8. P93A2-P2 fuzzes 6 of 14 numeric policy fields; P1 formats 1 of 8 digest fields

P2 (:79-84) covers `maxProgramNodes`, `maxProgramBytes`, `maxJoinMembers`,
`maxParallelBranches`, `maxTraceBytes`, `maxEvidenceRefs`. The remaining NUMERIC_FIELDS
(`program-policy.mjs:19-23`) — `maxProgramDepth`, `maxSchemaDefinitions`, `maxValueBytes`,
`maxResultBytes`, `maxRepeatRounds`, `maxChildDepth`, `maxEffectInstances`,
`maxJoinComparisons`, `maxStateRevisions` — have no `0` / `-1` / `1.5` / `'8'` row.
Violating input that slips through: `make({ maxRepeatRounds: 0 })` must throw
`program_policy_invalid`; if the numeric loop dropped any one field, no test fails.
Similarly P1 (:54-70) rejects a malformed digest only for `contextPolicyDigest`; the other
seven digest fields are format-unpinned.

### P1-9. P93A2-N1 probes one missing field per kind; the `value` probe conflates two violations

- N1 (:327-364) tests a single missing field per node kind (10 of roughly 40 exact-field
  rows). Unpinned examples: `value` missing `value` or `schema`; `branch` missing `then`,
  `otherwise`, or `outputSchema`; `repeat` missing `initial`, `body`, `continueWhen`, or
  `resultSchema`; `child` missing `input` or `resultSchema`; `await` missing `join` or
  `outputSchema`. Each is a distinct §93.9 exact-field row; an off-by-one in
  `SOURCE_FIELDS[kind]` for an unprobed field ships green.
- The `value` unknown-field probe (:329, :350-352) wraps the candidate alongside an existing
  `f.nodes.value('v', ...)` with the *same* nodeKey, so the probe `{ ...v, bogus: 1 }`
  carries two violations (unknown field **and** duplicate nodeKey). It passes today only
  because `validateSourceNode` runs before the duplicate check
  (`normalize-program.mjs:108-110`); the probe does not isolate the violation it names.

### P1-10. P93A2-K1 pins coalescing only for identical value leaves

K1 (:510-525) coalesces two byte-identical `value` nodes and checks candidate refs. §93.4
step 5 ("rewrite **all** references") is unpinned for control nodes: two byte-identical
`select` nodes referenced from a `sequence.steps` list must coalesce to one `nodeId` with
both steps rewritten (producing a duplicated `nodeId` in `steps`); no test builds this.
An implementation that coalesces only data nodes passes K1.

### P1-11. Remaining unpinned spec rows (each verified against the implementation or read directly from the test file)

- **SEL1/SEL2 (:705-820):** `requiredVerification: 'not_required'` (legal per §93.9) is never
  positively accepted — only `'passed'`; a regression narrowing the allowed set to
  `['passed']` ships green.
- **B1 (:934-965):** every bound row is over-by-one; no at-boundary positive rows
  (`branches` exactly `maxParallelBranches`, items exactly `maxJoinMembers`, nodes exactly
  `maxProgramNodes`, steps exactly `maxProgramNodes`) — an off-by-one tightening
  (`>=` for `>`) ships green. RAW1 likewise never tests a raw text of exactly
  `maxProgramBytes` bytes being accepted.
- **CTX1 (:400-410):** impure ops are tested only at the top expression level; a legacy op
  nested under a pure wrapper (e.g. `{ op: 'filter', input: { op: 'map', role: ..., ... } }`)
  is not pinned against the §93.10 "complete AST walk".
- **T1 (:285-308):** `repositoryScopes` is only ever rejected, never accepted in unsorted
  input order (`['src','docs']` → canonical `['docs','src']`); and no test anywhere
  successfully normalizes a two-role catalog, so approval-template `roles` projection and
  ordering for >1 role is unpinned.
- **C5 (:244-283):** the `content_ref` binding never tests `role.nodeTemplateDigest !==
  binding.nodeTemplateDigest` (the mismatch row in C4 covers only the `inline` form).
- **A1:** await-target refusal is tested against a `value` node only; await targeting a
  `select`/`sequence`/`branch`/`collect` port (all non-handle producers) is unpinned, as is
  the wrong-port row for reading `handle` from a control-leaf kind in PORT (:1004-1036),
  which pins bad ports only for `par`/`ch`/`aw`/`rep`.

## Required corrections

1. **Break the digest circularity (P0-1, P0-2).** Add checked-in, independently computed
   digest literals — e.g. `sha256` of the exact canonical byte string of
   `workerPolicyRequest`, `nodeTemplate`, the catalog, the approval template, the
   kitchen-sink `programDigest`, and one `nodeId` — produced by an external tool
   (`shasum -a 256` over a fixture `.json` file), and assert equality against them in
   C3/C4/T2/P1/O1/R1. Include at least one non-ASCII (non-BMP) object key vector so the
   UTF-16 code-unit ordering of §93.4 is load-bearing in this suite, not just in suite 2.
2. **Strengthen S1 (P0-3):** replace the `name` equality with
   `assert.deepEqual(collect.outputSchema, f.refs.collectResult)` and assert the full
   canonical `PortRef` shape of `collect.items[*].value` (`nodeId` pattern, `port`,
   `schema` deep-equal to the producing port's ref).
3. **Add the missing suite-4 rows (P1-1 … P1-7, P1-10, P1-11):**
   - preference-order permutation changes `programDigest`; reversed collect items / select
     candidates / parallel branches normalize to sorted order with unchanged identity;
   - duplicate-name refusal rows for collect items, select candidates, parallel branches;
   - positive and negative `all_verified` *selector* rows mirroring J1's join rows, and a
     positive await repeating a byte-identical non-`all_terminal` parallel join;
   - undominated-await refusal (parallel reachable only through one branch arm), predicate-
     operand and `repeat.initial`/`child.input` dominance refusals, predicate self-edge,
     and a two-hop collect-chain dominance row (true transitivity for D2);
   - `makePolicy({ maxProgramBytes: <below canonical size> })` refusal;
   - non-empty `verificationContracts` rows: duplicate `contractDigest`, malformed ref,
     and digest-sort normalization;
   - byte-identical *control*-node coalescing with `sequence.steps` ref rewrite;
   - `requiredVerification: 'not_required'` positive row; at-boundary positive rows for
     `maxParallelBranches`/`maxJoinMembers`/`maxProgramNodes`/raw `maxProgramBytes`;
     a nested impure context op row; unsorted `repositoryScopes` acceptance; a valid
     two-role catalog with approval-template projection; `content_ref`
     `nodeTemplateDigest` mismatch; await-target refusal against a non-handle control
     producer.
4. **Exhaust the policy field matrix (P1-8):** drive P2's bad-value loop over all 14
   `NUMERIC_FIELDS` plus `maxParallelBranches` (e.g. iterate the field list with
   `{ [field]: 0 }`, `{ [field]: 1.5 }`, `{ [field]: '8' }`), and P1's format check over all
   8 digest fields.
5. **Fix N1 (P1-9):** probe every missing field of every kind (derive the required list from
   the spec's exact-field tables, one `delete` per field), and give the `value` candidate a
   distinct nodeKey so the unknown-field probe isolates a single violation.
