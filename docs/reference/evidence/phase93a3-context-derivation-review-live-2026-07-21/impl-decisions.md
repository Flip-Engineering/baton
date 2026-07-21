# Phase 93a.3a implementation decisions — orchestrator-approved (2026-07-21)

Contract for the implementer seat. Ground truth: `spec/phase93-closed-program-ir.md` §93.9
(context node + collect derivation), §93.10, §93.10A (as re-drafted at `f5bea63`), §93.23 suite
5, §93.24 93a.3a. Sibling review reports in this directory (`spec-redteam.md`,
`evaluator-redteam.md`, `redraft-verify.md` when it lands) are evidence, not authority; this
document rules.

## Deliverables

1. **`impl/src/program-ir/context-derivation.mjs`** (new): the closed derivation engine.
2. **`impl/src/program-ir/normalize-program.mjs`**: replace `contextNodeRefusal` with real
   context-node normalization (purity + derivation + canonical node assembly).
3. **`impl/src/program-ir/index.mjs`**: export the derivation module (program-ir internal only;
   never re-export from `impl/src/index.mjs`).
4. **`impl/test/phase93a-context-purity-red.test.mjs`** (new): suite 5 per §93.23.
5. **`impl/test/phase93a-control-grammar-red.test.mjs`**: rewrite the `P93A2-CTX2` temporary
   closed-refusal rows into 93a.3a acceptance rows; keep `P93A2-CTX1` grammar refusals.
6. **`impl/test/fixtures/phase93a-program-fixtures.mjs`**: add repository-chunk + context
   fixtures using the author-aid helper (never hand-computed digests).

## Rules

1. **Grammar/policy mapping.** Normalize the embedded `baton.context_program` with a context
   policy mapped from the Program's `ProgramPolicy` per §93.20's table:
   `maxProgramBytes→maxProgramBytes`, `maxProgramNodes→maxProgramNodes`,
   `maxProgramDepth→maxProgramDepth`, `maxValueBytes→maxArtifactBytes`,
   `maxJoinMembers→maxResultItems`, `maxJoinComparisons→maxJoinComparisons`,
   `maxChildDepth→recursionDepth`; all other Context policy v1 fields take their v1 defaults.
   Never read a deployment Context policy directly; note in a comment that the 93E binding proof
   is what makes this mapping exact.
2. **Purity gate.** The complete AST walk MUST reject `map`/`reduce`/`review`/`verify` and any
   unknown op before any derivation work (reuse `contextProgramPure` from
   `impl/src/context-program.mjs`).
3. **Transformers.** One per op, exactly the §93.10A table. Identity ops pass `I` through.
   `chunk(by)`: `by="item"` → Digest key; otherwise `by` MUST be a required property of `I`
   (else `program_invalid`) and the key is that property's schema unioned with `null`... if the
   schema algebra cannot express the union (e.g. property is not an object form), refuse:
   union construction uses an object with a string discriminator per §93.5 union contracts, or
   fails `program_invalid` when inexpressible. `project`: properties = named ∩ `I.properties`,
   ALL `required:false`. `collect`/`finish`: ALL inputs MUST derive the byte-identical envelope
   definition, else `program_invalid`. `join`: `exact{left:L,right:R}`.
4. **Pinned derived names.** Every derived definition (envelope and every derived child) carries
   `name = "baton.derived." + sha256(canonical bytes of the structural definition alone)[0:16]`,
   `version = 1`. The preimage is the `definition` field's canonical bytes ONLY (never
   name/version/digest/schemaId).
5. **Bottom-up resolution.** Derive child schemas first, resolve each against the registry
   (structural `definition`-byte equality AND pinned name/version equality), substitute the
   resolved `SchemaRef`, then resolve the parent. A structural match with a non-pinned
   name/version fails `program_invalid`. Byte-identical definitions under other names are
   ignored. A child ref the author supplied but the derivation did not produce is
   `program_invalid`. The derived definitions MUST already be registered — no auto-registration
   in the normalizer.
6. **Author aid.** Export `deriveContextSchemaDefinitions(program, { authority, policy })`
   returning the complete frozen definition list an author must register (the SAME code path the
   normalizer uses), plus `deriveCollectSchemaDefinition(items, { authority, policy })` for the
   §93.9 collect derivation (pinned-name back-port). Tests and fixtures use ONLY these helpers.
7. **Collect back-port.** The §93.9 `collect` derivation gains the same pinned-name rule for new
   Programs. The matcher becomes: structural-byte match AND pinned name/version match; anything
   else is `program_invalid`. Existing collect behavior otherwise unchanged; historical
   collect-derived nodes are ledger history, not normalization input.
8. **Envelope.** `ContextCellValue` per §93.10A: `items` bound `policy.maxJoinMembers`,
   `sourceBranches` SafeId `unique` bound `policy.maxJoinMembers`, integer counters
   `minimum 0, maximum null`. `RepositoryChunkItem` exactly as §93.10A lists (text `format:"text"`
   `0..policy.maxValueBytes`, `language` `format:"text"` `0..128`, `gitMode` enum
   `["100644","100755"]`).
9. **Branch selection.** Only `source("repository")` is admitted; any other branch name fails
   `program_invalid` with a message naming the 93a.3a deferral.
10. **Red suite rows (suite 5).** Per §93.23: every per-op transformer (acceptance with real
    registry definitions built via the author aid); purity refusals (each effect op, nested and
    top-level, unknown op); non-`repository` branch refusal; chunk key rows (integer field,
    string field, null union, `by="item"` digest, non-required `by` refusal, inexpressible key
    union refusal); heterogeneous `collect`/`finish` refusal + homogeneous acceptance; pinned
    name rules (misnamed registered definition refuses; renamed-but-structural-match refuses;
    author-supplied child ref refuses); bottom-up order independence; caller `outputSchema`
    substitution refusal; unsatisfiable-chain rows (a chain whose derived definition is absent
    from the registry fails `program_invalid`, never publishes); `programDigest` identity across
    author `nodeKey` renames AND across registry insertion order.
11. **Boundaries.** No effect nodes, no preview, no builders, no manifest reads, no auto-
    registration, no changes to `canonical-value.mjs`/`schema-values.mjs`/`context-program.mjs`
    beyond what is listed, no git commits by the worker, no scratch/log writes anywhere
    (including `/tmp`) — output to stdout only.
12. **Validation.** Red rows first and watch them fail; then implement to green; pinned four
    suites green; full suite `node impl/scripts/run-suite.mjs` green from the worktree root.
    `phase93a-digest-vectors.json` literals must remain valid (if any shifts, that is a finding:
    regenerate ONLY via external `shasum -a 256` over inspected bytes and report it).
