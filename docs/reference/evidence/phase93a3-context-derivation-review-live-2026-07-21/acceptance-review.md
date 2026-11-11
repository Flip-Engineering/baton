# Phase 93a.3a context result-schema derivation — blue acceptance review

Scope: the shipped 93a.3a slice at HEAD (`50fad22`) — `spec/phase93-closed-program-ir.md` §93.9,
§93.10, §93.10A (lines 955-1058), §93.20, §93.23 suite 5; `impl/src/program-ir/context-derivation.mjs`
and its call sites in `impl/src/program-ir/normalize-program.mjs` (lines 99-102, 378-396);
`impl/test/phase93a-context-purity-red.test.mjs`; the `P93A2-CTX2` rewrite in
`impl/test/phase93a-control-grammar-red.test.mjs`; and the three sibling reports plus
`impl-decisions.md` in this directory.

Method: every claim below was executed against the shipped `normalizeProgramSource`, in memory, via
`node --input-type=module` reading from a heredoc. No scratch, log, or temporary file was written
anywhere (including `/tmp`); all output was read from stdout. This report is the only artifact.

Pinned verification (the enforced execution contract), run from the worktree root:

```
node --test impl/test/phase93a-canonical-identity-red.test.mjs \
  impl/test/phase93a-schema-values-red.test.mjs \
  impl/test/phase93a-source-schema-red.test.mjs \
  impl/test/phase93a-control-grammar-red.test.mjs \
  impl/test/phase93a-context-purity-red.test.mjs
```

→ `tests 81 / pass 81 / fail 0 / cancelled 0 / skipped 0 / todo 0`, exit 0.

## Verdict

**Accept the implementation; the spec needs four corrections before the slice is closed.**

The code is the strongest part of this slice. Every P0 in all three reports is genuinely closed in
both spec and code, and each closure was reproduced here against the shipped normalizer rather than
read off the diff. The three reports' P0s — `chunk` key type, heterogeneous `collect`/`finish`,
author-label leakage into `programDigest`, unspecified child-ref resolution, unsatisfiable
`text`/`language` — are dead, and the two closures that were "deferred rather than fixed"
(field-keyed `chunk`, positional `collect`) are deferred honestly, with a named rung stated in both
the spec table and the refusal message the code actually emits.

What survives is a different shape of problem than the reports were hunting: **the shipped code
implements normative behavior that no spec text states, and in one place the spec still records the
opposite.** Three of the four findings below are spec-vs-code divergences, not code defects. The
fourth is a real liveness defect that the redraft-verify report declared dead on a false premise and
that I reproduced: on a deployment where `ProgramPolicy.maxJoinMembers` exceeds the injected value
authority's `maxJoinMembers`, the `ContextCellValue` envelope is unregistrable and **every** context
node in **every** Program fails `program_invalid`. That is `spec-redteam.md` P1-6's unregistrability
attack, resurrected on a different axis.

Nothing found is a safety hole. Every residual failure mode fails closed. But two of them
(P1-A, P1-C) are total, silent liveness kills for context nodes on plausible deployments, and the
pinned-name rule — the mechanism the whole identity story rests on — is not yet pinned tightly
enough for a second implementation to agree (P1-D).

### (a) Row-by-row closure of the three reports

`spec-redteam.md` (5 P0, 7 P1, 4 minor):

| # | Finding | Spec | Code | Verified |
| --- | --- | --- | --- | --- |
| P0-1 | `chunk` key is not `string` | L1036 — `by="item"` only, Digest key; field-keyed refused with the rung named | `context-derivation.mjs:247-251` | Closed (deferral). All of `chunk`/`blobBytes`/`byteStart`/`gitMode`/`path` refuse `program_invalid`; `by="item"` accepts. The report's literal counterexample `{"op":"chunk","by":"chunk","input":{"op":"source","branch":"repository"}}` refuses. |
| P0-2 | heterogeneous `collect`/`finish` inexpressible | L1039, L1041 — homogeneous-only, exact arity | `assertHomogeneous`, `envelopeItemsBound` | Closed. The report's exact `collect(source, outline(source))` refuses with "byte-identical envelope schema"; `finish(value=src, evidence=[outline])` likewise. Homogeneous accepts. |
| P0-3 | author labels reach `programDigest` | L990-998 pinned `baton.derived.<16 hex>` | `pinnedName`, `createResolver` | Closed. Structural match under a foreign name refuses; pinned name at `version:2` refuses. `programDigest` stable across `nodeKey` rename and registry reversal. |
| P0-4 | child `SchemaRef` resolution unspecified (weak-schema hole) | L993-1001 bottom-up, author-supplied child ref is `program_invalid` | bottom-up `deriveItem`/`deriveEnvelope` | Closed. Registering a weakened `items` child under the correct pinned envelope name refuses with "non-matching structural bytes" — the parent's pinned name is a function of the child ref, so the attack cannot reach a match. |
| P0-5 | `text`/`language` unsatisfiable | L1022-1023 — `format:"text"`, whitespace/empty permitted; `language` 0..128 | `leafDefinitions()` | Closed. |
| P1-6 | `sourceBranches` bound / unregistrability | L972, L976-983 — `maxJoinMembers` | `deriveEnvelope` | **Partially closed — see P1-A.** The `maxEvidenceRefs` half is fixed. The unregistrability half is not. |
| P1-7 | "branch kind" does not exist | L1006-1011 — reserved branch NAME, conformance fail-closed at evaluation | `deriveItem` `case 'source'` | Closed. `workspace`/`notes`/`REPOSITORY` all refuse naming the 93a.3a deferral. |
| P1-8 | `project` `required` unsound | L1037 — all `required:false` | `case 'project'` | Closed. Verified `[false,false]`; every other derived object all-`true`. |
| P1-9 | envelope integers lack `maximum` | L973, L1040 — `minimum 0, maximum null`, `coverage` reconciled | `leafDefinitions().int` | Closed. |
| P1-10 | "sorted unique" inexpressible | L983-985 — uniqueness only, order never re-checked | `unique:true` on envelope `sourceBranches` | Closed. |
| P1-11 | byte-identical registrations fail `ambiguous` | L998 — duplicates under other names ignored | lookup by pinned name | Closed, and positively demonstrated: the fixture registry holds three byte-identical empty-object schemas (`baton.settlement_envelope`, `baton.parallel_handle`, `baton.child_handle`), and `project` with an empty field intersection derives a fourth with the same bytes. It normalizes. |
| P1-12 | `path`/`gitMode` unexpressible formats | L1016, L1018 | `leafDefinitions()` | Closed. |
| minor | NFKC vs NFC; Context `SAFE_ID` alphabet | L1054-1057 recorded as deferred | — | Honestly deferred. |
| minor | `contextNodeRefusal` ignores Program policy | L1057-1058 **still recorded as deferred** | **fixed in code** | **Divergent — see P1-B.** |
| minor | `manifest` is a dead parameter | L960-962 — takes no manifest parameter | signature has none | Closed. |

`evaluator-redteam.md` (1 P0, 3 P1, 7 corrections): finding 1 closed as P0-1 above. Finding 2
(`items` bound) closed by L976-980 plus the §93.20 `maxJoinMembers` ← Context `maxResultItems`
binding, with the fail-closed residue stated. Finding 3 (`sourceBranches`) closed as a **recorded**
fail-closed gap at L980-983 — honest deferral, not a fix. Finding 4 (`coverage` integers) closed at
L1040. Corrections 5 (outline `SafeId` construction-backed), 6 (non-injectivity — I reproduced the
collapse: bare `source`, `filter(source)`, and `sort(source)` all derive
`baton.derived.8aea3d471644d1f8`, while their `programDigest`s stay distinct), and 7 (evaluator
pre-failures) are all in the shipped text at L1033, L986-988, and L1036/1038/1043-1044.

`redraft-verify.md` (1 P0, 2 P1, 4 minor): P0-1 closed via its own correction option (c). P1-2
(preimage) closed at L991-993 and **independently confirmed**: for every derived definition I
checked, `baton.derived.` + `sha256(canonicalValueBytes(d.definition))[0:16]` reproduces the shipped
name exactly, and the competing reading (`{schemaVersion,kind,form,definition}`) does not. P1-3
(`required`) closed at L1002-1004. Minors: `collect` bounds now stated (L1039) and verified exact for
n∈{1,2,3,5}; the hardcoded 1..128 and `sourceBranches` ceiling are recorded at L1041 and L980-983;
`path` is now 1..4096, matching `coordination-store.mjs:4665`. **The "array bounds unstated" minor is
fixed for `collect` only — see P1-D.**

### (b) Report Programs re-run against the shipped `normalizeProgramSource`

| Program | Expected | Actual |
| --- | --- | --- |
| `collect([source(repository), outline(source(repository))])` | refuse | `program_invalid` — "collect requires every input to derive the byte-identical envelope schema" |
| `collect([source, source])` | accept | accept |
| `finish(value=source, evidence=[outline(source)])` | refuse | `program_invalid` — same, naming `finish` |
| `chunk(by=chunk\|blobBytes\|byteStart\|gitMode\|path)` | refuse | `program_invalid` — 'admits only by="item"', rung named |
| `chunk(by=item)` | accept | accept |
| pinned name absent from registry | refuse | "requires a schema registered as baton.derived.8aea3d471644d1f8" |
| wrong bytes at the pinned name (misnamed registry) | refuse | "registered with non-matching structural bytes" |
| correct bytes under a foreign name | refuse | "requires a schema registered as …" (duplicate ignored, not substituted) |
| correct bytes at pinned name, `version:2` | refuse | same |
| author child-ref substitution (weak `items` array under the pinned envelope name) | refuse | "non-matching structural bytes" |
| registry order reversed | identical `programDigest` | identical |
| context `nodeKey` renamed `c` → `zzz-other-label` (+ root rename) | identical `programDigest` | identical |

Additional corners I exercised, all behaving correctly: `collect` of `collect`, `finish` nested
inside `collect`, `project` of `project`, `project` with an empty field intersection, `project`
naming all ten fields, and the mixed-depth `collect([index(source), source])` (correctly refused as
heterogeneous).

### (c) Pinned name, order independence, required flags, arity, policy synthesis

- **Pinned-name preimage** — the `definition` member alone, confirmed against five derived
  definitions across four forms; the body-inclusive reading is falsified. `version = 1` throughout.
  Names match `/^baton\.derived\.[0-9a-f]{16}$/`.
- **Bottom-up order independence** — reversing the derived-schema insertion order leaves
  `programDigest` byte-identical.
- **All-required vs `project`-optional** — across `source`/`outline`/`index`/`coverage`/`join`/
  `chunk`, zero derived object properties carry `required:false`; `project` carries `[false,false]`.
- **Exact arity bounds** — `collect` n∈{1,2,3,5} → `minItems=maxItems=n`; `finish` evidence length 2
  → `minItems=maxItems=2`; `finish`/`outline`/`coverage` envelopes → `minItems=maxItems=1`.
- **Policy synthesis mapping** — all seven mapped fields copy exactly
  (`maxProgramBytes`, `maxProgramNodes`, `maxProgramDepth`, `maxValueBytes`→`maxArtifactBytes`,
  `maxJoinMembers`→`maxResultItems`, `maxJoinComparisons`, `maxChildDepth`→`recursionDepth`), and
  the remaining six (`language`, `stateMode`, `maxManifestBranches`, `maxCellsPerSession`,
  `maxTextBytes`, `maxEvidenceCoordinates`) take Context v1 defaults. Arithmetic-free, as
  `impl-decisions` rule 1 requires. The gap is that none of this appears in the spec (P1-B).

### (e) Independent recomputation of the regenerated digest literals

The implementer flagged `kitchenSinkProgramDigest` / `baseSourceProgramDigest` /
`baseSourceOwnershipDigest` in `impl/test/fixtures/phase93a-digest-vectors.json` as regenerated
in-session without an external clean-room cross-check. I recomputed two of the three. Method: build
the normalized Program, strip `programDigest`/`programId`, serialize the remaining object with a
canonicalizer I wrote from §93.4's stated rules (keys sorted by unsigned UTF-16 code unit via
relational compare, arrays in source order, `JSON.stringify` for primitives) that does **not** import
`canonical-value.mjs`, emit those bytes on stdout, and pipe them into the external `shasum -a 256`
binary — so neither the hash nor the serializer is the implementation's own.

| Literal | Preimage | External `shasum -a 256` | Result |
| --- | --- | --- | --- |
| `baseSourceProgramDigest` | 8 838 B | `1968d3a71e8b57fe8b5b4291fbacd8682f369d6238ada5c55ae4c59004640966` | **MATCH** |
| `kitchenSinkProgramDigest` | 15 508 B | `eda0689590818d20ba7a9977cd344cbdcf3c324eed04fdad2781fe8000327280` | **MATCH** |

Honest caveat on how much this buys: the hash tool is genuinely external, and the preimage
(which object, minus which fields) was reconstructed independently from `normalize-program.mjs:598-605`
— so the digest arithmetic and the preimage selection are now independently confirmed. The
serializer, however, is structurally equivalent to `serializeCanonical` because both are direct
transcriptions of the same three spec rules; it therefore does **not** independently validate the
canonicalization *rule* (e.g. a spec-level error in the key-order rule would reproduce in both). The
`_comment_93a3a` caveat in the vectors file can be narrowed to that residue rather than removed
outright.

## P0-P1 findings

### P1-A — the envelope is unregistrable whenever `ProgramPolicy.maxJoinMembers` exceeds the value authority's; every context node in the Program then fails

`context-derivation.mjs:326/334/336` bound both envelope arrays by `ctx.policy.maxJoinMembers` (the
**ProgramPolicy** field). Registrability is checked at `schema-values.mjs:138` against
`deployed.maxJoinMembers` (the **injected value authority** field). These are two different objects
bound to two different authorities, and `program-policy.mjs` contains no cross-constraint relating
them — `normalizeProgramPolicy` validates only that each numeric is a positive safe integer.

`redraft-verify.md` declared `spec-redteam.md` P1-6 dead on the premise that the two coincide:
"which satisfies `schema-values.mjs:138` at equality — on the fixture policy (`maxJoinMembers: 64`)
and on any policy". That reads the authority's 64 (`phase93a-program-fixtures.mjs:20`) as the
policy's; the fixture policy's value is 8 (line 86). They are unequal in the shipped fixture itself,
and the relation holds there only by luck of direction.

Failure scenario, reproduced: with the fixture authority (`maxJoinMembers: 64`) and a ProgramPolicy
carrying `maxJoinMembers: 65` (or 128), `deriveContextSchemaDefinitions` over the *simplest possible*
program — `source("repository")` — fails `program_invalid` with the bare message
`array schema bounds are invalid`. Policy values of 8 and 64 succeed. Because the envelope is derived
for **every** context node, one policy field crossing the authority's value bricks every context node
in every Program on that deployment, with an error that names neither context, nor derivation, nor
the offending field.

This is not exotic. §93.20 binds `ProgramPolicy.maxJoinMembers` to Context Program policy v1
`maxResultItems`, whose v1 default is 10 000 (`context-program-policy.mjs:20`); the value authority's
`maxJoinMembers` is injected separately by the deployment and, on the only worked example in the
tree, is 64. A deployment that takes the Context default and injects any authority ceiling below it
is dead on arrival for context nodes.

Fails closed, so this is P1 and not P0 — but it is a total liveness kill with an undiagnosable
message, and the report that was supposed to have cleared it cleared it on a misreading.

### P1-B — the synthesized Context policy is shipped normative behavior with no spec text, and §93.10A still records the opposite as deferred

`normalizeContextNodeProgram` (`context-derivation.mjs:79-97`) normalizes the embedded
`baton.context_program` under a Context policy **synthesized** from the Program's own ProgramPolicy:
seven fields copied per the §93.20 table, six taking Context v1 defaults. This is `impl-decisions`
rule 1, and the module comment documents it carefully.

No spec text states it. §93.10A (lines 955-1058) never says which policy bounds the embedded program;
§93.9's `context` row (lines 672-675) says only "program = normalized baton.context_program v1 proven
pure under §93.10". An implementer working from the spec alone would use
`DEFAULT_CONTEXT_PROGRAM_POLICY`, get different grammar bounds, and — because those bounds feed
`policy.maxJoinMembers` into the derived array bytes and hence into every pinned name — derive
different `baton.derived.*` names and a different `programDigest`. The pinned-name rule's entire
purpose is cross-implementation byte agreement; leaving its principal input unstated defeats it.

Worse, §93.10A lines 1057-1058 still list, among "Known adjacent inconsistencies recorded for a later
Context-policy slice (**not 93a.3a**)", the item "Program-side context normalization must pass the
Program's bound context policy rather than the v1 default". 93a.3a shipped exactly that fix. The spec
now defers a thing the code does.

The deferral that *is* real and is nowhere recorded: the six unmapped fields
(`maxManifestBranches`, `maxCellsPerSession`, `maxTextBytes`, `maxEvidenceCoordinates`, `language`,
`stateMode`) take v1 defaults rather than the deployment's actual bound Context policy. The module
comment's appeal to the 93E binding proof covers only the seven mapped fields; for the other six the
deployment's real values are simply not consulted. That is a defensible 93a.3a scope line, but it is
an unrecorded one.

### P1-C — `maxChildDepth === 1` is a hard, undocumented, content-conditional refusal

`mapProgramPolicyToContextPolicy` (line 72) and `normalizeContextNodeProgram` (line 92) both fail
`program_invalid` unless `policy.maxChildDepth === 1`. Reproduced: `maxChildDepth` of 2 or 4 refuses;
1 accepts.

The reasoning is sound as far as it goes — §93.20 line 2349 binds `maxChildDepth` to Context Program
policy v1 `recursionDepth`, and `context-program-policy.mjs:61` pins `recursionDepth` to exactly 1 —
but the conclusion is applied in the wrong place, and the consequence is stated nowhere:

1. **No spec text.** Neither §93.10A nor §93.9 mentions it. The author-visible consequence — a
   Program may never combine a `context` node with a child-recursion depth above 1 — is discoverable
   only by hitting the refusal.
2. **Applied by node content, not by policy admission.** §93.20's binding is unconditional: if it
   forces `maxChildDepth = 1`, it forces it for *every* Program. The code enforces it only when a
   context node is present. Reproduced: the fixture's default policy (`maxChildDepth: 4`) normalizes
   a non-context Program fine, and the *same* policy refuses the moment a context node is added. One
   ProgramPolicy is thus simultaneously admissible and inadmissible on the same deployment, which is
   not a property §93.20 permits a policy to have.

Either §93.20's binding genuinely forces `maxChildDepth = 1` program-wide — in which case the check
belongs in `normalizeProgramPolicy`, and the fixture's `maxChildDepth: 4` policies are invalid — or
the binding is looser than the code assumes and the derivation should not gate on it at all. It
cannot be both.

### P1-D — `outline.fields` and `coverage.sourceBranches` array bounds are unpinned in the spec, so the pinned name is not reproducible

The pinned name hashes the structural definition, so **every** field of **every** derived array
participates in Program identity. The spec pins the envelope's arrays precisely (L971-972:
`[0..policy.maxJoinMembers]`, `unique`) and, after `redraft-verify.md` required correction 4, pins
`collect`'s output array precisely (L1039). It does not pin the other two:

- L1033, `outline`: `fields:SafeId[]` — no `minItems`, no `maxItems`, no `unique`.
- L1040, `coverage`: `sourceBranches:SafeId[]` — same.

The code chooses `{minItems: 0, maxItems: policy.maxJoinMembers, unique: false}` for both
(`context-derivation.mjs:226-227, 286-287`), yielding `baton.derived.57fef3f7cfdf54e0` on the fixture
policy. A conforming implementation reading only the spec could pick `unique: true`, or a different
ceiling, and derive a different name and a different `programDigest` — the exact cross-implementation
divergence P1-2 of `redraft-verify.md` was raised to prevent. The required correction was applied to
one of the three unpinned arrays.

There is a second, smaller inconsistency inside this: the spec writes `SafeId[]` for both the
envelope's `sourceBranches` and `coverage`'s `sourceBranches`, but the code derives them as *different
schemas* — `unique:true` (`baton.derived.e27da7b201151b3d`) versus `unique:false`
(`baton.derived.57fef3f7cfdf54e0`) — for what the evaluator produces by the same deduplicating
`mergeMeta` path. The weaker direction is sound, but the divergence is unexplained and unpinned.

### Minor (below P1, recorded for completeness)

- **§93.23 suite 5 rows not shipped and not deferred.** Item 5 requires "historical replay stable;
  explicit migration receives a new identity" alongside the derivation rows. The shipped suite pins
  purity acceptance/refusal and the full §93.10A table but has no replay-stability or migration-identity
  row. `impl-decisions` rule 10 does not list them either, so they were dropped silently rather than
  deferred with a named rung. Arguably correct scoping (no migration tool ships in 93a.3a), but it
  should be recorded.
- **The underlying context-grammar refusal reason is swallowed.** `normalizeContextNodeProgram:83-87`
  rethrows only when `error.code === 'program_invalid'` and otherwise replaces the error with a fixed
  sentence. Reproduced: a context program exceeding the mapped `maxProgramNodes` reports only "context
  node program is not a valid normalized baton.context_program v1 under the Context policy mapped from
  ProgramPolicy per §93.20", with the actual bound and offending value discarded. For a normalizer
  whose contract is exact refusal, this is a diagnosability regression.
- **§93.9 retains the ambiguous preimage shorthand.** Line 750 still reads
  `"baton.derived." + H(structural definition)[0:16]` — verbatim the wording `redraft-verify.md` P1-2
  showed admits two readings — while §93.10A now pins it exactly. §93.9 does cross-reference §93.10A,
  so this is presentational, but the two sentences should not disagree. §93.9 line 748 also omits
  "misnamed" from its failure list where §93.10A line 1049 includes it.
- **`deriveCollectSchemaDefinition` signature drift.** `impl-decisions` rule 6 specifies
  `(items, { authority, policy })`; the shipped export takes `(items, { authority })`. Harmless —
  `policy` is genuinely unused on that path — but the contract and the code should agree.
- **`assertHomogeneous` on an empty input list returns `undefined`.** `context-derivation.mjs:203-208`
  destructures `const [first] = envelopes` without an emptiness guard; an empty `collect.inputs` would
  propagate `undefined` into `deriveEnvelope` and surface as a `TypeError`, not a `ProgramIrError`.
  Unreachable today (`context-program.mjs:408` bounds `collect` inputs to 1..128), so this is a
  latent-robustness note, not a live defect.

## Required corrections

1. **Add the missing cross-constraint for P1-A, and improve the diagnostic.** Either add an explicit
   check in `normalizeProgramPolicy` that `policy.maxJoinMembers <= authority.maxJoinMembers` (failing
   `program_policy_invalid` at policy admission, where the operator can act on it, rather than
   `program_invalid` at every context node), or add a §93.20 binding row that forces the relation and
   state it in §93.10A next to the existing L976-980 registrability claim. Whichever is chosen, make
   the derivation's own failure name the field: `array schema bounds are invalid` must not be the
   whole message a deployment gets when every context node dies. Add a suite-5 row pinning the
   refusal.
2. **State the Context-policy synthesis in the spec, and fix the stale deferral (P1-B).** Add the
   `impl-decisions` rule 1 mapping table to §93.10A (or §93.9's `context` row) as normative text —
   including explicitly that the six unmapped Context v1 fields take v1 defaults and that the
   deployment's bound values for them are out of 93a.3a scope. Delete the now-false third clause of
   the "Known adjacent inconsistencies" paragraph at L1057-1058, which records as deferred a fix this
   slice shipped. Without this, the pinned name's principal input is unspecified and cross-implementation
   agreement — the rule's entire purpose — is not achievable from the spec.
3. **Resolve the `maxChildDepth` binding at one altitude and document it (P1-C).** Decide whether
   §93.20's `maxChildDepth` ← Context `recursionDepth` binding forces `maxChildDepth = 1` for every
   Program or not. If it does, move the check into `normalizeProgramPolicy`, state it in §93.20, and
   fix the fixtures that carry `maxChildDepth: 4`. If it does not, remove the gate from
   `mapProgramPolicyToContextPolicy` and `normalizeContextNodeProgram` and pass the Program's actual
   value through. Do not ship a constraint whose applicability depends on whether the Program happens
   to contain a context node; and state the author-visible consequence in §93.10A either way.
4. **Pin the remaining derived array bounds (P1-D).** Give `outline.fields` (L1033) and
   `coverage.sourceBranches` (L1040) explicit `minItems`/`maxItems`/`unique`, exactly as L1039 now
   does for `collect` — completing `redraft-verify.md`'s required correction 4, which was applied to
   only one of the three unpinned arrays. Also state why `coverage.sourceBranches` derives
   `unique:false` while the envelope's identically-named, identically-sourced field derives
   `unique:true`, or make them agree. Add a suite-5 assertion over the full structural bytes of at
   least one derived array so a future bounds change cannot pass silently.
5. **Housekeeping.** Record the §93.23 suite 5 replay/migration rows as explicitly deferred with a
   named rung (or ship them). Preserve the underlying cause in `normalizeContextNodeProgram`'s
   re-throw rather than replacing it with a fixed sentence. Align §93.9 line 750 with §93.10A's exact
   preimage wording and add "misnamed" to line 748. Align `deriveCollectSchemaDefinition`'s signature
   with `impl-decisions` rule 6, or amend the rule. Guard `assertHomogeneous` against an empty list so
   the failure stays a `ProgramIrError`.
6. **Narrow, do not delete, the digest-vectors caveat.** `kitchenSinkProgramDigest` and
   `baseSourceProgramDigest` are now confirmed by an external `shasum -a 256` over independently
   serialized bytes with an independently reconstructed preimage; `baseSourceOwnershipDigest` was not
   re-checked here (it is a pure function of `baseSourceProgramDigest`, so it inherits most of the
   confirmation). Update `_comment_93a3a` to record what was independently verified and to state the
   one residue that remains — that the cross-check serializer is a transcription of the same §93.4
   rules and so cannot catch a spec-level canonicalization error.
