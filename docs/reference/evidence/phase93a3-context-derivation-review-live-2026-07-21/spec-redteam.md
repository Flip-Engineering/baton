# Phase 93a.3a — adversarial review of §93.10A context result-schema derivation

Scope: `spec/phase93-closed-program-ir.md` §93.10A (lines 952–1013) attacked against §93.3, §93.4,
§93.5, §93.9, §93.10, §93.23 suite 5, and the evaluator in `impl/src/context-program.mjs`,
`impl/src/program-ir/normalize-program.mjs`, `impl/src/program-ir/schema-values.mjs`,
`impl/src/program-ir/control-nodes.mjs`, `impl/src/context-program-policy.mjs`.

Derivation is not yet implemented: `normalize-program.mjs:56-67` (`contextNodeRefusal`) still fails
context nodes closed, as §93.23 line 2789 anticipates. Every claim below is therefore checked
against spec text plus the *evaluator semantics the draft claims to describe*.

## Verdict

**Reject the draft as written.** The derivation is not a description of the evaluator; it is a
description of a different, idealized evaluator. Five P0 defects make the draft either
self-contradicting or unimplementable under §93.5's own schema algebra:

- Two per-op transformers (`chunk`, and the `text`/`language` fields of the checked-in repository
  item shape) derive schemas that **real, legally-normalized programs can never satisfy**. The cell
  computes, fails validation, and never publishes — a silent liveness kill, not a safety win.
- `collect` and `finish` are specified as **heterogeneous positional arrays**, which §93.5 line 274
  cannot express (`array.items` is a single `SchemaRef`) and which §93.5 lines 280–281 cannot
  rescue via `union` (every `ContextCellValue` shares `kind="baton.context_value"`, so no
  discriminator enum can distinguish variants). §93.23 line 2793 obliges suite 5 to pin a row that
  cannot be built.
- Resolution "exactly like a `collect` derivation" makes the derived `outputSchema` digest depend on
  **author-chosen schema `name`/`version`**, which propagates into `nodeId` and `programDigest` and
  directly contradicts §93.4 line 224 ("Author labels never affect identity").
- The draft never says how the **child `SchemaRef`s inside** the derived definition are obtained.
  That is the weak-schema hole the brief asked for: an author can register a permissive inner
  `items` schema and still byte-match at the top level.

The no-manifest-reads rule is directionally right, but it is stated over a concept the manifest does
not have (`branch kind`), and it is silently doing double duty as an excuse for never validating
that a `repository` branch actually contains repository chunks.

The two ops the draft gets exactly right are `index` (line 998) and `coverage`'s field set
(line 1004); `search`/`slice`/`filter`/`sort`/`unique` identity (line 999) is also correct.

Counterexamples below were normalized in memory against the real normalizer. No scratch files were
written; the report file is the only artifact.

## P0-P1 findings

### P0-1 — `chunk` derives `key:string`; the evaluator emits the raw field value of any JSON type

Draft line 1000: `` `chunk` `` → `` exact{key:string, items:I[]}[] ``.

Evaluator `context-program.mjs:796-812`: the group key is
`expression.by === 'item' ? contextValueDigest(item) : requiredField(item, expression.by, 'chunk')`
(line 800), and the emitted item is `{ key: value.key, items: value.items }` (line 809) where
`value.key` is `keyValue ?? null` (line 803). Only the `by:"item"` branch yields a string. For every
other `by`, `key` is **the raw JSON field value** — number, boolean, null, object, or array.

The draft contradicts itself with its own checked-in shape: `RepositoryChunkItem` (line 979) declares
`chunk`, `blobBytes`, `byteStart`, `byteEnd` as non-negative safe integers. So:

```json
{"op":"chunk","by":"chunk","input":{"op":"source","branch":"repository"}}
```

normalizes cleanly (verified against `normalizeContextProgram`, which returns
`{"op":"chunk","input":{"op":"source","branch":"repository"},"by":"chunk"}`), derives
`exact{key:string, items:RepositoryChunkItem[]}`, and evaluates to `key: 0` — a number. Per draft
lines 1010-1012 the cell "never publishes". Same for `by:"blobBytes"`, `by:"byteStart"`,
`by:"byteEnd"`. Four of the ten checked-in fields are unusable as chunk keys.

Also undocumented: `by:"item"` is a magic value (line 800) that never reads a field, even though
`fieldName` (line 278-282) admits `"item"` as an ordinary field name and `RepositoryChunkItem` has
no `item` field. The transformer table does not mention this case at all.

### P0-2 — `collect`/`finish` heterogeneous arrays are inexpressible in §93.5

Draft line 1003: `` `collect` `` → "one `ContextCellValue` per input, in input order:
`ContextCellValue(V_i)[]`". Line 1005: `` `finish` `` → `evidence:ContextCellValue(E_i)[1..]`.

§93.5 line 274: `array = exact{type, items, minItems, maxItems, unique}` with **`items=SchemaRef`** —
one schema for the whole array. There is no tuple/positional form. §93.4 line 238 confirms "fixed
positional" data is "represented as objects, never arrays".

The union escape hatch is closed too. §93.5 lines 280-281: a union variant is `exact{tag,schema}` and
"the referenced object schema MUST require a string property named by `discriminator` whose enum is
exactly `[tag]`". Every `ContextCellValue` has `kind = "baton.context_value"` (draft line 967;
evaluator `outputValue`, `context-program.mjs:539-549`). No property distinguishes the variants, so
no discriminator exists.

Counterexample (normalizes cleanly, verified):

```json
{"op":"collect","inputs":[
  {"op":"source","branch":"repository"},
  {"op":"outline","input":{"op":"source","branch":"repository"}}]}
```

`V₁ = RepositoryChunkItem`, `V₂ = exact{itemCount, fields}`. Two different envelope shapes must
inhabit one homogeneous array. The derivation has no expressible answer.

Even in the *homogeneous* case the draft overclaims: "in input order" is not enforceable, because a
§93.5 array cannot pin per-position schemas. Draft line 963's "`outputSchema` describes exactly it"
is false — reordering `collect` inputs yields a value that still validates.

§93.23 line 2793 requires suite 5 to pin "`collect`/`finish` envelope recursion". That obligation
cannot currently be discharged.

### P0-3 — the derived `outputSchema` digest depends on author-chosen labels, breaking §93.4 identity

Draft line 1009: `outputSchema` is the derived definition's "byte-matching `SchemaRef`, resolved
exactly like a `collect` derivation".

The `collect` derivation (`normalize-program.mjs:388-408`) matches on `definition` bytes only
(lines 397-399: `definition.form === 'object' && canonicalValueText(definition.definition) === …`).
It never constrains `name`/`version`. But §93.5 lines 262-265: the common fields are
`{schemaVersion,kind,name,version,form,definition,digest,schemaId}` and "`digest` hashes the object
excluding `digest` and `schemaId`" — so **`digest` covers `name` and `version`**.

Consequence: two authors writing byte-identical context programs against byte-identical manifests,
who register the same structural definition under names `ctx_env_a` vs `ctx_env_b`, obtain different
`SchemaRef.digest`, hence different canonical `context` node bodies (§93.9 line 674:
`outputSchema` is a node field), hence different `nodeDigest`/`nodeId` (§93.4 step 4, line 214), hence
different `programDigest`.

This is a direct contradiction of §93.4 line 224: "Author labels never affect identity." The draft
inherits the defect by reference and amplifies it, because context envelopes recur through
`collect`/`finish` and so appear at every nesting level.

### P0-4 — child `SchemaRef` resolution is unspecified, permitting a strictly weaker registered schema

Draft lines 1007-1009 require "the full derived definition (envelope with the op-derived `items`,
recursively through `collect`/`finish`)" to be present in `schemas`, resolved "exactly like a
`collect` derivation".

But a §93.5 object/array definition does not contain its children inline — it contains
`SchemaRef`s (§93.5 lines 274-275, 279). So "the full derived definition" is a **DAG of registered
definitions**, and the top-level byte match only pins the child *refs* the author already chose. The
draft never states that the child refs must themselves be the byte-match resolution of the derived
child schemas.

Attack: an author registers the envelope object with the correct field names, but whose `items`
`SchemaRef` points at an array schema whose own `items` is a maximally permissive text or empty-object
schema. Under a single-level matcher (the only algorithm the draft names) the top-level definition
bytes are whatever the author registered, so there is nothing to compare against — the derivation
"succeeds" and the node publishes under a schema far weaker than §93.10A demands. This is exactly the
"weaker schema than the derivation demands" vector.

The fix requires an explicit bottom-up rule; see Required corrections.

### P0-5 — `text = bounded text` and `language = SafeId` are unsatisfiable for real repository content

Draft lines 986-987: `text = bounded text`, `language = SafeId`.

§93.3 line 125-128 defines bounded text as NFC-normalized, **whitespace-trimmed**, NUL-free,
credential-shape-free, with empty strings rejected. §93.3 line 103 defines
`SafeId := /[A-Za-z0-9._:@/-]{1,512}/`.

The evaluator applies **none** of this to source data. `normalizeContextSource`
(`context-program.mjs:551-581`) checks only byte size and secret-shaped patterns (lines 560-566);
`_branch` (lines 715-731) checks only digest and item count and then `canonical()`s the items.
`boundedText`/`safeId` (lines 140-152) are applied to *program* strings, never to branch content.

So, for a genuine repository chunk branch:

- any chunk whose `text` has leading or trailing whitespace — i.e. essentially every indented code
  chunk — violates "trims surrounding whitespace" and the cell never publishes;
- an empty-file chunk (`text: ""`) is rejected outright by §93.3 line 127;
- `language` values `C++`, `C#`, `F#`, `Objective-C++` contain `+`/`#`, which are outside the
  `SafeId` charset, so any repository containing C++ or C# makes the cell unpublishable.

The derived schema is not a description of repository chunks; it is a filter that rejects most of
them.

### P1-6 — `sourceBranches[0..policy.maxEvidenceRefs]` cites the wrong authority and may be unregistrable

Draft line 970: `sourceBranches = SafeId[0..policy.maxEvidenceRefs]`.

§93.20 line 2301 binds `ProgramPolicy.maxEvidenceRefs` to **Goal/Plan policy v1 `limits.maxItems`** —
an authority with no relation to context branches. The evaluator's actual bound is the number of
distinct manifest branch names (`context-program.mjs:499` via `mergeMeta`, sourced from
`_evaluate`'s `source` case, line 747), which is bounded by the *Context* policy's
`maxManifestBranches` (`context-program-policy.mjs:16`, default 1 024, ceiling 4 096 at line 63).
`maxEvidenceRefs` and `maxManifestBranches` are independent; nothing forces the former to dominate.
When it does not, a legitimate cell exceeds `maxItems` and never publishes.

Worse, the envelope schema may be **unregistrable**: `schema-values.mjs:138` fails when an array
schema's `maxItems > deployed.maxJoinMembers`, and `program-policy.mjs` (checked lines 1-140)
contains no cross-constraint forcing `maxEvidenceRefs <= maxJoinMembers` — they bind to Goal/Plan
`limits.maxItems` and Context `maxResultItems` respectively (§93.20 lines 2301, 2306). On any
deployment where Goal/Plan `limits.maxItems` exceeds Context `maxResultItems`, the ContextCellValue
envelope cannot be registered at all, so **every** context node fails `program_invalid`.

By contrast the `items` bound (draft line 969, `policy.maxJoinMembers`) *is* coherent: §93.20
line 2306 binds `maxJoinMembers` to Context `maxResultItems`, which is the evaluator's real item
ceiling (`context-program.mjs:953`). Keep that one; fix only `sourceBranches`.

### P1-7 — "branch kind" does not exist; `repository` conformance is never validated

Draft lines 974-976: "the only branch **kind** with a checked-in item shape is `repository`; a
`source` op naming any other branch fails `program_invalid`".

A manifest branch is `exact{digest,itemCount,mediaType,name,ref,summary}`
(`context-program.mjs:160`). **There is no `kind` field.** `name` is an arbitrary `safeId`
(line 162). So the derivation can only key on the literal string `"repository"`, which means:

- a manifest that names its repository branch `repo`, `src`, `code`, or `repository.main` is
  rejected even though it is exactly the supported kind; and
- a manifest that names an arbitrary JSON branch `"repository"` is *accepted* by the derivation and
  assigned `RepositoryChunkItem[]`, which its items will not satisfy.

The second case is the deeper problem: `_branch` (lines 715-731) validates digest, item count, and
ceiling — never item shape. Combined with the no-manifest-reads rule (line 957-960), nothing anywhere
in the pipeline ever establishes that a `repository` branch contains repository chunks. The draft
treats `RepositoryChunkItem` as "checked-in" when it is an unverified assumption about caller data.
`mediaType` is the only shape-adjacent signal in the manifest and line 1012 explicitly forbids using
it.

### P1-8 — `project`'s "required iff in `I.required`" contradicts the evaluator's silent omission

Draft line 1001: `project(fields)` → properties are `fields∩I.properties`, "required iff in
`I.required` and named".

Evaluator `context-program.mjs:828-833`:

```js
input.items.map((item) => Object.fromEntries(expression.fields
  .filter((field) => getField(item, field) !== undefined)
  .map((field) => [field, getField(item, field)])))
```

A field that is **absent from the item is silently dropped**. Marking it `required` in the derived
schema is therefore only sound if the evaluator guarantees presence — and it does not, because
nothing validates that items conform to `I` (P1-7).

Note the inconsistency this exposes inside the evaluator itself: `sort` (line 836-838), `join`
(lines 869-870) and `chunk` (line 800) all route through `requiredField` (lines 484-490) and **fail
closed** on a missing field; `project` alone degrades silently. The draft's transformer table
flattens that distinction away.

### P1-9 — the envelope's integer fields have no `maximum`, which §93.5 requires, and `join`/`collect` can exceed any finite one

Draft line 971: `sourceItems/selectedSourceItems/chunks = non-negative safe integer`.

§93.5 line 270: `integer = exact{type, minimum, maximum}`. `maximum` is a required field (nullable).
The draft never states its value, so the derivation is under-specified — two implementations will
register different definitions and byte-match will diverge.

Any *finite* choice is also wrong. `mergeMeta` (`context-program.mjs:498-506`) **sums** `sourceItems`,
`selectedSourceItems` and `chunks` across inputs while de-duplicating `sourceBranches`. So
`join(source("repository"), source("repository"))` reports `sourceItems = 2N` for a branch of `N`
items (lines 884-885), and nested `collect`/`finish` compound this. The envelope counters are
therefore not bounded by `maxResultItems` and can exceed the manifest's own item count.

The same under-specification applies to `coverage` (draft line 1004), where the draft weakens to bare
`integer` for `selectedItems`/`manifestBranches`/`unreadBranches`/`chunks`/`sourceItems`/
`selectedSourceItems` while the envelope row demands "non-negative safe integer" — two different
rigor levels for the same quantities.

### P1-10 — "sorted unique" is not expressible; the envelope is not identity-pinned

Draft line 970 requires `sourceBranches` to be "sorted unique".

§93.5 line 274 gives arrays only `unique`; there is no ordering keyword. §93.4 line 240 is explicit:
"Schema `array` values are semantic ordered even when `unique=true`; uniqueness does not make them
sets", and §93.4 line 231 classifies "typed-value arrays" as **semantic ordered**. §93.4 line 242
adds that "any prose use of 'sorted unique' refers to the set-like row above" — a classification for
normative *Program* arrays, not for typed values.

So the derived schema can enforce uniqueness but not order. The evaluator does sort
(`context-program.mjs:499`, `.sort()`; and `outline`'s `fields`, line 755), but a hand-authored or
replayed `TypedValue` with unsorted-yet-unique `sourceBranches` validates identically. The draft's
line 963 claim that `outputSchema` "describes exactly" the published value fails again.

(Checked and *not* a finding: `mergeMeta`'s bare `.sort()` and `normalizeContextManifest`'s
`compareCanonicalStrings` (line 254) agree, because `compareCanonicalStrings`
(`canonical-order.mjs:19-24`) is plain `<`/`>` on strings, matching JS default string sort and §93.4's
unsigned UTF-16 rule.)

### P1-11 — byte-identical registry definitions make every derivation fail `ambiguous`

Draft line 1009-1010: "A missing, ambiguous, unregistered, or caller-substituted result schema fails
normalization."

The `collect` matcher fails when `matches.length > 1` (`normalize-program.mjs:403`). §93.5 lines
294-296 enforce only name/version uniqueness — two definitions with **different** names and
**identical** `definition` bytes are perfectly legal in a registry.

Because context envelopes are structurally repetitive (every `collect`/`finish` nests another
`ContextCellValue`, and many distinct programs derive the same envelope), this is far more likely
here than for `collect` nodes. A Program that legitimately registers the same object shape twice —
e.g. once as its own `resultSchema` and once for the context port — bricks every context node in the
Program with `program_invalid`. Failing closed on ambiguity is defensible; failing closed on an
author's harmless duplicate label is not.

### P1-12 — `path` and `gitMode` have no expressible §93.5 format

Draft lines 980 and 982: `path = normalized repository-relative path`, `gitMode = git mode string`.

§93.5 line 272: `string = exact{type, minBytes, maxBytes, format, enum}` with
`format="text|safe_id|digest|git_sha"`. There is no path format and no git-mode format. Both fields
can only be registered as `format:"text"` (or a `text` + `enum` for `gitMode`), so neither stated
constraint is enforced. The registered schema is weaker than the prose claims, and the prose is what
suite 5 (§93.23 line 2794) is meant to pin.

`contentDigest = Digest` and `gitBlobOid = GitSha` *are* expressible (`format:"digest"`/`"git_sha"`),
but as with P1-7 nothing validates that branch data actually conforms — they merely have to happen to
match, or the cell never publishes.

### Minor (below P1, recorded for completeness)

- **NFKC vs NFC.** §93.3 line 125 mandates NFC. `boundedText` (`context-program.mjs:142`) applies
  `normalize('NFKC')`, and `safeId` (line 149) inherits it. Compatibility folding is strictly more
  aggressive, so a branch name published in `sourceBranches` can differ from the manifest author's
  bytes. Fails closed today (NFKC output is a subset of what NFC-`SafeId` accepts), but the two
  normalizers should not disagree in a spec that hashes strings.
- **Context `SAFE_ID` is stricter than §93.3's.** `context-program.mjs:18` is
  `/^[A-Za-z0-9._:-]+$/u` — no `@`, no `/` — versus §93.3 line 103's `[A-Za-z0-9._:@/-]`. A
  `format:"safe_id"` schema therefore accepts `sourceBranches` values the evaluator can never emit:
  another (benign) instance of the derived schema being weaker than the derivation.
- **`contextNodeRefusal` ignores the Program's policy.** `normalize-program.mjs:59` calls
  `normalizeContextProgram(node.program)` with no policy argument, so the context grammar is bounded
  by `DEFAULT_CONTEXT_PROGRAM_POLICY` (nodes 256, depth 32, 64 KiB) rather than the Program's
  `policy.contextPolicyDigest` authority that §93.20 lines 2295-2297 binds. Must be fixed before
  derivation lands, since §93.10A's bounds are written in terms of `policy.*`.
- **`manifest` is a dead parameter.** §93.9 line 676 and §93.10A line 954 both pass `manifest` to
  `deriveContextResultSchema`, while lines 957-960 forbid reading it. The signature advertises an
  authority it must not use.

## Required corrections

1. **`chunk` (line 1000).** Replace `key:string` with the actual type. Two acceptable closures:
   either derive `key` as the schema of field `by` within `I` (and `string` only for the `by:"item"`
   digest case), or change the evaluator to emit `key: stable(keyValue)` so the string claim becomes
   true. Document the `by:"item"` special case in the table either way, and state what `key` is when
   the field value is `null`.
2. **`collect`/`finish` (lines 1003, 1005).** Resolve the heterogeneity gap explicitly. Options:
   (a) require all `collect` inputs / `finish` evidence to derive the *same* envelope schema and fail
   `program_invalid` otherwise; (b) add a positional/tuple array form to §93.5; or (c) re-shape the
   evaluator's `collect`/`finish` output to an object keyed by input ordinal (§93.4 line 238's
   "fixed positional … represented as objects"). Do not leave the row as written — and do not let
   §93.23 line 2793 ship an obligation the algebra cannot satisfy. Drop the "in input order" claim
   unless (b) or (c) is adopted.
3. **Identity (line 1009).** State that the derived `SchemaRef` is byte-matched on `definition` bytes
   **and** that `name`/`version` must not participate in `nodeDigest`, or else pin a canonical derived
   `name`/`version` (e.g. `baton.context_value` + a version fixed by the derivation). Until then
   §93.4 line 224 is violated. Add a suite-5 row asserting that renaming a registered schema leaves
   `programDigest` unchanged.
4. **Child refs (lines 1007-1009).** Specify bottom-up resolution explicitly: derive each child
   schema, byte-match it to obtain its `SchemaRef`, substitute, then match the parent. State that a
   child ref the author supplied but the derivation did not produce is `program_invalid`. Without
   this clause the draft permits a weaker registered schema (P0-4).
5. **Repository item shape (lines 979-988).** Either (a) drop `text`'s "bounded text" claim in favour
   of a plain bounded string that permits leading/trailing whitespace and the empty string, and widen
   `language` beyond `SafeId` (a `text` string, or an explicit enum), or (b) make `_branch` normalize
   and validate branch items against `RepositoryChunkItem` at admission and fail
   `context_source_integrity` when they do not conform. (a) is required regardless; (b) is what makes
   "checked-in shape" honest.
6. **`sourceBranches` bound (line 970).** Replace `policy.maxEvidenceRefs` with the Context policy's
   `maxManifestBranches` (or a new §93.20 binding row for it), and add the cross-constraint
   `maxItems <= maxJoinMembers` required by `schema-values.mjs:138` so the envelope is always
   registrable. Keep `items[0..policy.maxJoinMembers]` — that one is correct per §93.20 line 2306.
7. **Branch selection (lines 974-976).** Stop saying "branch kind". Either add a `kind` field to the
   manifest branch shape (`context-program.mjs:160`, a manifest-schema change) and key the derivation
   on it, or state plainly that the derivation keys on the reserved branch **name** `"repository"` and
   that the name is a normalization-time constant. Also state what happens when a manifest legitimately
   holds repository chunks under a different name — currently an outright refusal.
8. **`project` (line 1001).** Make the rule sound. Either mark every projected property
   `required:false` (matching the evaluator's silent omission), or change `project` to route through
   `requiredField` like `sort`/`join` so absence fails closed and `required` becomes true. State which,
   and add the suite-5 case §93.23 line 2794 already promises.
9. **Envelope integers (line 971).** Give `sourceItems`, `selectedSourceItems`, `chunks` an explicit
   `minimum`/`maximum` pair (§93.5 line 270 requires both). Use `maximum: null` unless the draft is
   prepared to bound `mergeMeta`'s summing behaviour, and reconcile `coverage`'s bare `integer`
   (line 1004) with the envelope's "non-negative safe integer".
10. **Ordering (line 970).** Delete "sorted" or make it enforceable. The honest statement is
    `unique=true`, plus a normative sentence that the evaluator emits ascending UTF-16 order which
    validation does not re-check. If envelope identity must be pinned, that belongs in the
    §93.4 array-classification table, not in a schema the algebra cannot express.
11. **Ambiguity (lines 1009-1010).** Narrow the failure. Byte-identical definitions under distinct
    names should resolve deterministically (e.g. lowest `schemaId` by unsigned UTF-16) rather than
    fail the Program, or §93.5 must forbid duplicate `definition` bytes registry-wide. As written,
    a harmless duplicate label bricks every context node.
12. **`path`/`gitMode` (lines 980, 982).** Restate in terms of an expressible §93.5 form —
    `format:"text"` with `minBytes`/`maxBytes`, plus an `enum` for `gitMode` — and either add the
    missing formats to §93.5 line 272 or drop the "normalized repository-relative" and "git mode"
    prose that nothing enforces.
13. **Housekeeping.** Fix `normalize-program.mjs:59` to pass the Program's context policy before
    derivation lands; and either use or remove the `manifest` parameter in the
    `deriveContextResultSchema` signature (§93.9 line 676, §93.10A line 954).
