# Phase 93a.3a derivation draft — evaluator-conformance red team

Scope: `spec/phase93-closed-program-ir.md` §93.10A (lines 952–1013) checked row by row against
`impl/src/context-program.mjs` (`normalizeExpression`, `StatelessContextBench._evaluate`,
`outputValue`, meta helpers), `impl/src/context-runtime.mjs` (repository item construction), and
`impl/src/coordination-store.mjs` (source item attestation validation). Pinned verification run:
`node --test impl/test/phase93a-canonical-identity-red.test.mjs impl/test/phase93a-schema-values-red.test.mjs impl/test/phase93a-source-schema-red.test.mjs impl/test/phase93a-control-grammar-red.test.mjs`
→ 73/73 pass, exit 0.

## Verdict

Not conformant as drafted. Two rows of the §93.10A transformer table derive schemas that real
evaluator outputs cannot validate against (chunk `key`, envelope `items` bound), and one envelope
bound names a policy axis the evaluator never enforces (`sourceBranches`). The remaining rows check
out, with caveats noted below. The identity-collapse attack succeeds trivially; the unsatisfiable-
derivation attack succeeds through the chunk-key and items-bound mismatches.

Verified-conformant rows (draft line → code line):

- Envelope field set/types: `ContextCellValue` exact 7-field shape (draft L966–968) matches
  `outputValue`, context-program.mjs:539–549. `sourceItems`/`selectedSourceItems`/`chunks` are
  non-negative safe integers; `sourceBranches` is unique, sorted, SafeId-shaped branch names
  (mergeMeta, context-program.mjs:498–506; branch names are `safeId`-validated at
  context-program.mjs:162/344).
- `outline` singleton `{itemCount, fields}` (draft L997) matches context-program.mjs:752–758 —
  with a caveat: `fields` is raw `Object.keys` output with no SafeId validation
  (context-program.mjs:754–755). The draft's `SafeId[]` claim holds today only because the closed
  93a.3a world (repository-only sources, closed op set, `fieldName`-validated project keys) makes
  every producible key SafeId-shaped. It holds by accident, not by construction.
- `index` wrapping `exact{index, value:I}` (draft L998) matches context-program.mjs:759–765;
  indices are non-negative safe integers (`after` validated at context-program.mjs:353–355).
- `slice` identity (draft L999): selector shapes are closed — `indices` = 1..10_000 unique sorted
  non-negative safe integers, out-of-range indices silently dropped (context-program.mjs:311–318,
  783–787); `field_equals` = SafeId field + JSON primitive, `hasField` + canonical-byte equality
  (context-program.mjs:320–326, 789–794). Identity shape holds.
- `project` (draft L1001): evaluator omits absent fields per item via `getField(...) !== undefined`
  (context-program.mjs:828–833), which matches `properties: fields∩I.properties` only because
  closed-world items are homogeneous. The draft's "required iff in I.required and named" is safe
  under the same homogeneity assumption; the evaluator itself guarantees nothing.
- `sort` identity (draft L999): shape holds; the evaluator additionally hard-fails unless every
  key is present on every item (`requiredField` loop, context-program.mjs:836–838) — a failure
  mode the draft never mentions.
- `unique` first-occurrence (draft L999): confirmed, seen-set with order-preserving filterResult
  (context-program.mjs:850–861). Quirk: a missing key contributes `undefined` to the identity key,
  which `stable` serializes as `null` — absent field and explicit `null` are conflated.
- `join` wrapping `exact{left:L, right:R}` (draft L1002) matches context-program.mjs:879. The
  evaluator requires the join key on **every** item of **both** sides before any matching
  (context-program.mjs:869–870), failing the whole cell even when zero pairs would match; the
  draft is silent on this.
- `collect` envelope-of-envelopes (draft L1003) matches: one full `outputValue` envelope per input,
  in input order (context-program.mjs:888–893).
- `finish` singleton `{value, evidence[1..], grounding:"asserted"}` (draft L1005) matches
  context-program.mjs:907–915; evidence arity 1..128 is enforced at normalization
  (context-program.mjs:415).
- `RepositoryChunkItem` (draft L979–988) matches construction at context-runtime.mjs:271–276 and
  459–463, and attestation validation at coordination-store.mjs:4658–4680: exact 10 fields;
  `gitMode` restricted to `'100644'|'100755'` (context-runtime.mjs:424;
  coordination-store.mjs:4674); `gitBlobOid` 40-hex, `contentDigest` 64-hex; `blobBytes ≥ 1` and
  `byteEnd ≤ blobBytes` (coordination-store.mjs:4675–4676); `chunk`/`byteStart`/`byteEnd`
  non-negative safe integers with `byteEnd > byteStart`; `language` derives from the closed
  TEXT_EXTENSIONS set (context-runtime.mjs:28–32) so it is always SafeId-compatible — though the
  store validates it only as `boundedText(..., 128)` (coordination-store.mjs:4678), looser than
  the draft's SafeId claim. The per-chunk secret skip at context-runtime.mjs:458 cannot create
  ordinal gaps in practice because the whole file is rejected by the same patterns first
  (context-runtime.mjs:442), so the store's continuity check (coordination-store.mjs:4697) is
  not violated.

Attack results:

- **Identity collapse: succeeds, pervasively.** `search`/`slice`/`filter`/`sort`/`unique` are all
  `I[]` identity (draft L999), so e.g. bare `source`, `filter(source, …)`, and
  `sort(source, keys)` derive byte-identical schemas; `slice(indices=[0])` vs `[1]` collapse;
  `collect([a,b])` vs `collect([b,a])` collapse when `V_a = V_b`; `project` naming all of I's
  fields collapses to `I`. If any consumer treats `outputSchema` as identifying the derivation or
  the program, the collapse breaks it. The draft calls the ref "the one exact SchemaRef" but never
  states that schema identity is non-injective.
- **Unsatisfiable derivation: succeeds** via findings 1 and 2 below — both are concrete op chains
  whose derived schema no evaluator-produced cell can validate against.

## P0-P1 findings

1. **P0 — `chunk` key is not `string`; the derived schema rejects real output.**
   Draft L1000 claims `exact{key:string, items:I[]}[]`. The evaluator's group key is the raw field
   value: `keyValue = expression.by === 'item' ? contextValueDigest(item) : requiredField(item,
   expression.by, 'chunk')`, emitted as `{ key: keyValue ?? null, items }`
   (context-program.mjs:800–803, 809). `keyValue` is arbitrary JSON — chunking repository items
   `by:"chunk"` yields integer keys, `by:"blobBytes"` integer keys, `by:"gitMode"` string keys,
   and a present-but-null field yields `null` keys. A derived `key:string` schema fails validation
   on every cell produced by `chunk by <non-string field>` — an unsatisfiable derivation for those
   chains. The draft also omits that `chunk` hard-fails unless the `by` field is present on every
   item (`requiredField`, context-program.mjs:801).

2. **P1 — envelope `items` bound names the wrong policy axis.**
   Draft L969 caps `items` at `[0..policy.maxJoinMembers]`. The evaluator's only items ceiling is
   the Context Program policy `maxResultItems`, enforced at execute
   (context-program.mjs:953–956; default 10_000, max 100_000 —
   context-program-policy.mjs:20,67). The pinned Program IR authorities set `maxJoinMembers: 64`
   (e.g. impl/test/phase93a-schema-values-red.test.mjs:12). With the draft as written, any cell
   legitimately producing 65–10_000 items (a plain `source` over a mid-size repository branch)
   evaluates successfully but cannot validate against its derived schema — the cell never
   publishes. The draft never states a binding between ProgramPolicy `maxJoinMembers` and the
   Context policy `maxResultItems`.

3. **P1 — `sourceBranches` bound names a policy axis the evaluator does not enforce.**
   Draft L970 caps `sourceBranches` at `SafeId[0..policy.maxEvidenceRefs]`. The evaluator merges
   branch names across `collect`/`finish` inputs (mergeMeta, context-program.mjs:498–506) with no
   per-envelope cap; the only bound is `maxManifestBranches` (default 1_024, max 4_096 —
   context-program-policy.mjs:16,63, enforced at context-program.mjs:249–252). A `collect` over
   more than `maxEvidenceRefs` distinct branches yields a valid completed cell whose envelope
   violates the derived bound. Same missing policy-binding defect as finding 2.

4. **P1 — `coverage` integer fields are under-specified relative to evaluator guarantees.**
   Draft L1004 types every `coverage` singleton integer field as bare `integer`. The evaluator
   always emits non-negative safe integers (context-program.mjs:897–905; `unreadBranches =
   manifest.branches.length - sourceBranches.length ≥ 0`). A permissive derived `integer` schema
   still validates, so this is imprecision rather than breakage — but the derivation contract is
   supposed to be exact, and an unbounded `integer` type admits values (negatives, unsafe
   integers) no cell can produce, weakening the "byte-matching" claim of L1007–1011.

## Required corrections

1. Draft L1000: change the `chunk` row so `key`'s schema is derived from the `by` field's value
   type in `I` (unioned with `null` for the `?? null` path), with the special case `by:"item"`
   deriving a Digest string; and state the universal required-field failure
   (context-program.mjs:801) as part of the op's contract.
2. Draft L969: bind envelope `items` `maxItems` to the Context Program policy `maxResultItems`
   (the ceiling the evaluator actually enforces, context-program.mjs:953–956), or add an explicit,
   checked policy binding proving `maxJoinMembers ≥ maxResultItems` at derivation time.
3. Draft L970: bind `sourceBranches` `maxItems` to `maxManifestBranches` (the only enforced bound)
   or add the equivalent explicit policy binding.
4. Draft L1004: retype the `coverage` singleton's integer fields as non-negative safe integers,
   matching context-program.mjs:897–905.
5. Draft L997: either add SafeId enforcement to `outline`'s `fields` in the evaluator
   (context-program.mjs:754–755) or explicitly scope the `SafeId[]` claim to the closed
   repository-only op set so the claim is construction-backed, not accidental.
6. §93.10A prose (L1007–1013): state explicitly that schema derivation is non-injective — the
   identity ops (L999) make semantically distinct chains derive byte-identical schemas — so
   `outputSchema` must never be consumed as a program or derivation identifier.
7. Document the evaluator's universal pre-failures that the transformer table hides: `join`
   requires the key on every item of both sides before matching (context-program.mjs:869–870),
   `sort` requires every key on every item (context-program.mjs:836–838), `chunk` requires the
   `by` field on every item (context-program.mjs:801) — or explicitly declare failure modes out of
   scope for the derivation.
