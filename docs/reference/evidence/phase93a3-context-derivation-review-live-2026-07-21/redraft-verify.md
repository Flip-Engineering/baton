# Phase 93a.3a re-draft (commit f5bea63) — verification red team

Scope: the re-drafted §93.10A (`spec/phase93-closed-program-ir.md:955-1052`) attacked decision by
decision, as answers to `spec-redteam.md` and `evaluator-redteam.md` in this directory. Checked
against §93.4 (lines 214-242), §93.5 (lines 249-302), §93.9 (lines 659-753), §93.20 (lines
2298-2348), §93.23 suite 5 (lines 2829-2838), and code: `impl/src/context-program.mjs`,
`impl/src/program-ir/schema-values.mjs`, `impl/src/program-ir/normalize-program.mjs`,
`impl/src/context-program-policy.mjs`, `impl/src/context-runtime.mjs`,
`impl/src/coordination-store.mjs`. Derivation is still unimplemented
(`normalize-program.mjs:56-67` fails context nodes closed), so all checks are spec-text vs
evaluator-semantics, as with the sibling reports. Pinned verification:
`node --test impl/test/phase93a-canonical-identity-red.test.mjs impl/test/phase93a-schema-values-red.test.mjs impl/test/phase93a-source-schema-red.test.mjs impl/test/phase93a-control-grammar-red.test.mjs`
→ 73/73 pass, exit 0. No scratch files written; this report is the only artifact.

## Verdict

**One P0 survives the re-draft; five of the eight attacked decisions hold.** The `chunk` row's
fix (`K` = by-field schema "unioned with `null`", spec line 1030) reintroduces exactly the
§93.5-inexpressibility defect the re-draft correctly fixed for `collect`/`finish`: §93.5 unions
require object variants with a discriminator, so a scalar-or-null `K` cannot be registered, and
every `chunk(by:<field>)` chain over repository items derives an unbuildable schema. Everything
else the re-draft claims checks out.

Decisions verified sound:

- **(1) Pinned derived names.** `digest` does cover `name`/`version` (§93.5 lines 262-265;
  `schema-values.mjs:171-178` hashes the body including both). No identity leak through child
  refs: bottom-up resolution (spec lines 989-997) pins each child's name/version before the
  parent's structural bytes are formed, so the child `SchemaRef` coordinates embedded in parent
  bytes are deterministic functions of child structure; authors cannot supply `outputSchema` at
  all (§93.9 lines 663-665) and a mismatched-but-byte-equal candidate fails `program_invalid`.
  The 16-hex (64-bit) pinned name cannot be gamed short of a SHA-256 prefix preimage, and a
  collision fails closed: same name/version with different bytes fails normalization registry-wide
  (§93.5 lines 294-296), byte-identical duplicates are rejected as duplicate `schemaId`s (§93.4
  line 236). The `collect` back-port is stated consistently in both places (spec lines 997-998;
  §93.9 lines 749-752). One under-specification remains — see P1-2.
- **(2) Homogeneous-only collect/finish.** The inexpressibility premise is correct: §93.5 line
  274 gives arrays a single `items` SchemaRef; unions need a discriminator whose enum is exactly
  `[tag]` per object variant (§93.5 lines 279-283; `schema-values.mjs:272-282`; union values must
  be objects, line 387); every envelope shares `kind="baton.context_value"`
  (`context-program.mjs:539-549`), so no discriminator exists. The homogeneous rule is
  implementable at normalization — two inputs derive byte-different envelopes iff their op-derived
  `items` schemas (recursively pinned) differ, a deterministic bottom-up comparison. It does
  reject valuable natural chains (`collect(source, outline(source))`;
  `finish(value=chunks, evidence=[coverage(…)])`), but that is correction option 2(a) from
  `spec-redteam.md`, explicitly acknowledged in spec line 1033 ("a positional/tuple form is a
  later schema-algebra rung") and pinned as the acceptance contract by §93.23 lines 2831-2833.
  Accepted trade-off, not a defect.
- **(3) Bottom-up resolution.** No residual weak-schema path found. The author supplies only the
  program AST and the registry; the derivation derives every child itself, and "a child
  `SchemaRef` the author supplied but the derivation did not produce is `program_invalid`" (spec
  lines 995-996) closes the P0-4 single-level-matcher attack, because a weaker registered child
  has different structural bytes and a different pinned name.
- **(5) project all-optional.** Matches the evaluator's silent omission exactly
  (`context-program.mjs:828-833`). Requested fields outside `I` that appear on non-conforming
  items are caught fail-closed by `additionalProperties:false`. Sound.
- **(6) Bounds on maxJoinMembers.** Registrable: both envelope arrays use
  `maxItems = policy.maxJoinMembers`, which satisfies `schema-values.mjs:138` at equality — on the
  fixture policy (`maxJoinMembers: 64`) and on any policy, with no remaining dependence on
  `maxEvidenceRefs` (§93.20 line 2340's Goal/Plan binding is now irrelevant to the envelope).
  The old P1-6 unregistrability is dead. Residual fail-closed liveness gaps noted below.
- **(7) Repository item formats.** Real chunks now validate. `gitMode` enum `["100644","100755"]`
  matches construction (`context-runtime.mjs:424`) and attestation (`coordination-store.mjs:4674`);
  `text` 0..`maxValueBytes` permitting whitespace/empty matches the store (only byte-length
  consistency is checked, `coordination-store.mjs:4670`; whitespace-only chunks occur naturally);
  `language` as plain text 0..128 matches construction (`context-runtime.mjs:462`, lowercased
  extension or `"text"`) and the store's `boundedText(...,128)` (`coordination-store.mjs:4678`);
  digest/git_sha formats match lines 4671-4672; the exact 10-field set matches the v2 attestation
  field list (`coordination-store.mjs:4658-4662`). `blobBytes` minimum 0 is weaker than the
  store's `>= 1` — the sound direction.
- **(8) Reserved-name `"repository"`.** Behaves only as documented: a non-chunk branch named
  `"repository"` is accepted by the derivation and fails closed at evaluation (spec lines
  1003-1005 say exactly this); a repository branch under any other name is refused — a stated
  93a.3a scope limit (spec lines 1001-1003), not a surprise. No acceptance/refusal beyond the
  documented behavior found.
- The three housekeeping items from `spec-redteam.md` (NFKC vs NFC, SAFE_ID alphabet, Program
  policy not passed at `normalize-program.mjs:59`) are now recorded as known adjacent
  inconsistencies (spec lines 1048-1052). Confirmed still present in code; correctly scoped out of
  93a.3a.

## P0-P1 findings

### P0-1 — `chunk` key "unioned with `null`" is inexpressible in §93.5; every chunk-by-field chain over repository items is unbuildable

Spec line 1030: ``K`` is "the `by` field's property schema in `I` unioned with `null`".

§93.5's only union form (line 276) requires every variant to reference an **object** schema that
requires a string discriminator property whose enum is exactly `[tag]` (lines 279-283), enforced
at `schema-values.mjs:272-282`; TypedValue union validation begins with "TypedValue union must be
an object" (line 387). Neither an `integer`/`string` schema nor `null` can be a union variant,
and §93.5 has no nullable modifier — `integer = exact{type, minimum, maximum}` (line 270) has no
way to admit `null`, and "nullable safe bounds" (line 270) refers to the *bounds*, not the value.

Every field of `RepositoryChunkItem` (spec lines 1009-1017) is scalar: five integers, four
strings, one digest, one git_sha. So for `chunk(by:"chunk")`, `by:"gitMode"`, `by:"path"`, etc.
over the one checked-in source shape, `K` is scalar∪null — unregistrable, hence the derivation
fails `program_invalid` for **every** `chunk(by:<field>)` chain. Only the magic `by:"item"`
(Digest, spec line 1030; evaluator `contextValueDigest` at `context-program.mjs:800`) is
expressible. This is the same algebra gap the re-draft cites to justify homogeneous-only
`collect` (spec line 1033), applied one row earlier in the same table.

The rest of the chunk row is accurate against the evaluator and should survive the fix: the
evaluator emits the raw field value or `null`, never canonical text (`context-program.mjs:803`
`keyValue ?? null`, emitted at line 809; `stable()` is used only for grouping/ordering at lines
802, 807-808); the required-field hard-fail is real (`requiredField` at line 801, defined lines
484-490); `by:"item"` reads no field (line 800).

### P1-2 — the pinned-name preimage is not pinned: "canonical bytes of the structural definition alone" admits two readings

Spec lines 987-988: `name = "baton.derived." + H(canonical bytes of the structural definition
alone)[0:16]`. §93.5 lines 262-265 define a definition's common fields as
`{schemaVersion,kind,name,version,form,definition,digest,schemaId}`. "Structural definition
alone" most plausibly means the `definition` member, but nothing says so — an implementer hashing
`{schemaVersion,kind,form,definition}` (body minus labels/digests) gets different pinned names for
every derived schema. The truncation's encoding (lowercase hex of the SHA-256, §93.3 line 146)
and the `[0:16]` character window are likewise unstated here. Since the entire point of the
pinned name is cross-implementation byte agreement (§93.23 line 2833 pins "the pinned derived
name/version rule"), the preimage must be stated exactly.

### P1-3 — `required` flags are never pinned for any derived object schema

§93.5 line 279 makes `required` an explicit per-property boolean, so structural bytes (and hence
pinned names and byte-matches) depend on it. The re-draft states `required:false` only for
`project` (spec line 1031). For `ContextCellValue` (lines 968-974), `RepositoryChunkItem` (lines
1009-1017), and the `outline`/`coverage`/`finish` singletons (lines 1027, 1034-1035), the
`exact{...}` notation leaves the required set implicit. Two sound readings diverge: all-required
matches construction (every repository chunk carries all 10 fields, `context-runtime.mjs:459-463`;
every envelope carries all 7, `context-program.mjs:539-549`), but nothing in the text forces it —
and the `chunk` row's own "by MUST be a required property of `I`" rule (spec line 1030) is only
usable if `RepositoryChunkItem` is pinned all-required. Under-specification produces
byte-divergent derivations and silently disables chunk-by-field under the optional reading.

### Minor (below P1, recorded for completeness)

- **`collect` output array bounds unstated.** Spec line 1033 gives `[ContextCellValue(V)]`
  without `minItems`/`maxItems`; the evaluator emits exactly one envelope per input
  (`context-program.mjs:887-893`). Byte-exact derivation needs the bound pinned (input-count…
  input-count, or 0..`policy.maxJoinMembers`). Same class of gap as P1-3.
- **Hardcoded 128 vs `policy.maxJoinMembers`.** `collect` inputs and `finish` evidence are bounded
  at normalization by a hardcoded 1..128 (`context-program.mjs:408, 415`), while the derived
  `finish` evidence array is `[1..policy.maxJoinMembers]` (spec line 1035) and
  `maxJoinMembers = maxResultItems` (§93.20 line 2345). On a deployment with `maxResultItems <
  128`, a finish with more evidence than `maxResultItems` normalizes and evaluates, then fails
  port validation and never publishes. Fail-closed; the converse direction (schema weaker than
  evaluator) is sound.
- **`sourceBranches` ceiling overclaimed.** Spec line 981 calls `maxJoinMembers` "the ceiling the
  evaluator actually enforces" — true for `items` (`context-program.mjs:953`), but the only
  evaluator bound on distinct branch names is `maxManifestBranches`
  (`context-program-policy.mjs:16, 63`), and no policy cross-constraint forces
  `maxManifestBranches <= maxResultItems` (`context-program-policy.mjs:57-73`). A deployment with
  `maxManifestBranches > maxResultItems` (plus `maxProgramNodes` large enough to name that many
  sources) yields a validly evaluated cell that fails the derived bound and never publishes.
  Fail-closed; registrability is unaffected.
- **`path` byte ceiling mismatch.** Derived `path` is 1..1024 bytes (spec line 1010); the store
  admits `boundedText(item.path, 4_096)` (`coordination-store.mjs:4665`). Real chunks with
  1025-4096-byte paths fail the derived schema and never publish. Fail-closed, rare in practice.

## Required corrections

1. **`chunk` row (spec line 1030) — close the scalar∪null gap; the row currently builds nothing
   for scalar by-fields.** Three acceptable closures: (a) change the evaluator to emit
   `key: stable(keyValue)` (the canonical-text string it already computes for grouping at
   `context-program.mjs:802`) and derive `K` as bounded text, dropping the "never canonical text"
   clause; (b) add a nullable modifier or untagged union form to §93.5 (note `valueRef =
   ValueRef|null` in the registered `baton.settlement_envelope`, §93.11 line 1190, already needs
   this — the gap is not chunk-specific); or (c) scope 93a.3a `chunk` to `by:"item"` only and fail
   every other `by` at derivation, deferring field-keyed chunking to the rung that lands (a) or
   (b). Keep the required-field rule and the `by:"item"` Digest row regardless — both verified
   accurate.
2. **Pin the pinned-name preimage (spec lines 987-988).** State the exact bytes hashed — e.g.
   `name = "baton.derived." + lowercaseHex(SHA-256(canonical(definition)))[0:16]`, where
   `definition` is the §93.5 `definition` member alone — so independent implementations derive
   identical names.
3. **Pin `required` for every derived object (spec lines 968-974, 1009-1017, 1027, 1034-1035).**
   State that `ContextCellValue`, `RepositoryChunkItem`, and the `outline`/`coverage`/`finish`
   singleton schemas require every property (construction already guarantees presence), and that
   `project` alone derives all-optional. This also makes the `chunk` required-property rule
   operative.
4. **State array bounds for the `collect` output (spec line 1033)** and reconcile the `finish`
   evidence bound with the evaluator's hardcoded 1..128 (`context-program.mjs:415`; `collect`
   inputs 1..128 at line 408) — either derive the evidence array as `[1..min(128,
   policy.maxJoinMembers)]` or record the fail-closed gap as known.
5. **`sourceBranches` honesty (spec line 981).** Either add the cross-constraint
   `maxManifestBranches <= maxResultItems` to the Context policy authority, or weaken the sentence
   to claim the enforced ceiling for `items` only and record the `sourceBranches` fail-closed gap
   alongside lines 1048-1052.
