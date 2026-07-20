# Phase 93 — closed canonical Program IR and durable effect-boundary runtime

Status: **planned, specification only**. This document is the implementation contract for Phase
93A onward. It does not implement a Program runtime, does not advertise Program execution, and does
not claim that Phase 93 shipped. Current implemented authority remains the Phase 81/84/85 Context
cell and successor-call vertical, Phase 79/80 Workflow and revision vertical, Phase 87/88 semantic
action and exact route authority, Phase 90/91 durable controls, and Phase 92 Episode/workstream
facade.

This is the semantic successor to the draft at `fa9e07a`. It incorporates the canonical Program
requirements captured from GitHub issue 9 in `docs/29-slate-architecture-assessment.md` Stages C
through E and `docs/28-exhaustive-capability-audit.md`.

## 93.1 Scope and immutable decisions

Phase 93 will add one closed, content-addressed Program language above the existing Run,
Workflow, Context, Atlas, Cairn, referee, Episode/workstream, and process-lifecycle authorities.

The complete control vocabulary is:

```text
value context sequence branch parallel await collect select repeat child
```

The complete effect vocabulary is:

```text
call map reduce gate notify checkpoint finish
```

The following are permanent constraints for this version:

1. Program data is JSON. Python and TypeScript are builders only. There is no arbitrary language
   runtime, `eval`, `exec`, callback, import, module load, ambient filesystem access, shell, or
   provider launch in the Program evaluator.
2. A Program cannot carry credentials, route-selection code, process coordinates, raw commands,
   checkout paths, budgets, or caller-selected capacity ceilings.
3. Harness, model, and effort form one exact approved route tuple. Service tier is a separately
   requested and approved axis. Worker policy is a separately requested, resolved, and observed
   contract.
4. Shared immutable bases and private writable overlays are allowed. Concurrent direct writers to
   one physical checkout are not. Selection, integration, promotion, and correctness never follow
   automatically from consensus or completion.
5. A gate names a separately approved verification contract and an exact Candidate or artifact.
   Program JSON never contains command text, argv, cwd, environment, or a shell fragment.
6. Program output does not create a new Atlas rung or Cairn promotion path. Atlas AST/CST, symbols,
   SCIP, CPG, deltas, and representations are addressed Context inputs. Cairn accepts Program
   evidence only through its existing audited artifact, Decision, Scratch, Representation, and
   promotion authorities.
7. No homelab or external project-manager runtime is in scope.

All words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** in this document are normative.

## 93.2 Normative dependencies and current truth

The implementation MUST preserve:

- Phase 14 and Phase 88 exact harness/model/effort request and Plan allowlist semantics;
- Phase 57 model-policy service-tier authorization and nullable provider observation;
- Phase 79 Workflow strategy, typed feedback, private overlays, joins, and lifecycle semantics;
- Phase 80 append-only Candidate revision and deterministic loop stopping;
- Phase 81 pure Context computation and historical Context v1 identities;
- Phase 84/85 separately approved Context map/reduce successor Plans, per-output lineage, result
  capsules, role catalog, retry generations, replay, and reap;
- Phase 87 one semantic-action authority registry;
- Phase 90/91 admitted/effect-start/provider-ack/settle controls and interrupt preservation;
- Phase 92 Episode/workstream facade and progressive transport parity;
- `spec/RECONCILIATION.md` D4/D6 and `impl/src/referee.mjs` fresh-sandbox trust;
- Phase 51 and current `process-lifecycle.mjs` exact PID-start-fenced process-group ownership;
- the Atlas R0–R3 ceiling and Phase 61 graph-backed Representation authority; and
- Cairn causal integrity, bounded recall, selective promotion, contradiction, and correction rules.

Current `baton.context_program` schema v1 is not the Program IR. It is an expression tree whose
normalizer currently accepts pure operations and the effectful operations `map`, `reduce`,
`review`, and `verify`. Current Workflow role-catalog schema v1 binds harness/model/effort and a
node template, but not the service-tier and worker-policy attestations specified below. Those are
migration inputs, not proof that this contract exists.

The status boundary is exact:

| Capability | Current master | Planned Phase 93 owner |
| --- | --- | --- |
| Pure Context evaluation | implemented for Context v1 | embedded only through §93.10 purity proof |
| Context map/reduce successors and retries | implemented bounded vertical | compiled as Program effects in 93C |
| Context review/verify syntax | parsed but not executable as the claimed new center | replaced by typed independent call/gate composition in 93C |
| Workflow roles and exact route tuple | implemented catalog v1 and Plan route v2 | catalog v2 adds separate service-tier and worker-policy binding in 93C |
| Candidate feedback/revision | implemented bounded Workflow vertical | lowered into repeat/child without changing historical identity in 93C |
| Semantic controls and Episode/workstreams | implemented | reused by Program handles and one registry in 93E |
| Closed Program grammar/canonical builders | absent | 93A |
| Branch-local durable Program reducer | absent | 93B |
| Five-phase Program effects and result algebra | absent | 93C |
| Program workspace/integrator/ownership closure | absent | 93D |
| Five template lowerings and full transport parity | absent | 93E |
| Four-arm decision and live Program acceptance | absent | 93F |

## 93.3 Closed data model and validation notation

The schemas below use these exact primitives:

```text
Digest       := lowercase /[a-f0-9]{64}/
GitSha       := lowercase /[a-f0-9]{40}/
SafeId       := /[A-Za-z0-9._:@/-]{1,512}/
RouteTupleKey := opaque canonical route-tuple string, 1..4096 UTF-8 bytes
NodeKey      := /[A-Za-z][A-Za-z0-9._:-]{0,127}/
NodeId       := "pnode:" + Digest
ProgramId    := "program:" + Digest
CandidateId  := "candidate:" + Digest
ArtifactId   := "artifact:" + Digest
CapsuleId    := "capsule:" + Digest
EffectId     := "effect:" + Digest
MemberEffectId := "effect-member:" + Digest
ExecutionId  := "execution:" + Digest
BranchId     := "branch:" + Digest
ParallelId   := "parallel:" + Digest
BarrierId    := "barrier:" + Digest
ValueId      := "pvalue:" + Digest
SchemaId     := "schema:" + Digest
```

`exact{a,b}` means an ordinary JSON object with exactly fields `a` and `b`: no missing field, no
extra field, no inherited property, and no `undefined`. `union(kind)` means the discriminator is
required and selects exactly one shape below. Arrays are dense. JSON values reject cycles,
non-finite numbers, negative zero (normalized to zero), lone UTF-16 surrogates, decorated arrays,
custom prototypes, and `toJSON`. Strings are NFC-normalized; fields described as bounded text also
trim surrounding whitespace, reject NUL and credential-shaped text, and are measured in UTF-8
bytes. Integers are safe integers. Empty strings are rejected except inside a value whose schema
explicitly permits them.

Validation has three stages, all before durable effect admission:

1. parse JSON and reject duplicate object keys and invalid Unicode;
2. validate the source schema, every discriminator, field set, bound, reference, schema, role,
   approval template, and graph edge; and
3. normalize, hash, validate the canonical form again, then resolve current authority.

Any unknown field, kind, predicate, selector, join, schema form, effect, role, port, or action fails
`program_invalid` before `program.execution_admitted`, Plan proposal, capacity reservation,
worktree creation, process creation, verifier creation, or provider call. Partial acceptance and
"ignore unknown fields" are forbidden.

## 93.4 Canonical JSON and cross-language identity

Canonical bytes are UTF-8 JSON with no whitespace. Object keys sort by unsigned UTF-16 code units,
arrays retain semantic order, booleans/null use JSON literals, and numbers use RFC 8785/JCS
ECMAScript shortest round-trip serialization after the restrictions in §93.3. Digests are SHA-256
over those bytes. Python and TypeScript builders MUST use the same checked-in conformance vectors,
including non-ASCII keys, exponent boundaries, zero, escaped control characters, and nested
objects. Locale, insertion order, Python dictionary order, and ICU never participate.

The authoring form is:

```text
ProgramSource = exact{
  schemaVersion, kind, language, manifest, schemas, roleCatalog,
  approvalTemplate, policy, verificationContracts, nodes, root, resultSchema
}
schemaVersion = 1
kind = "baton.program_source"
language = "baton-program-ir-v1"
nodes = NodeSource[1..policy.maxProgramNodes]
root = SourceControlRef
manifest = ManifestRef
schemas = baton.value_schema definitions
roleCatalog = RoleCatalog
approvalTemplate = ApprovalTemplate
policy = ProgramPolicy
verificationContracts = VerificationContractRef[0..policy.maxSchemaDefinitions]
resultSchema = SchemaRef
```

A source node has `nodeKey`; source references use two non-interchangeable shapes:

```text
SourcePortRef = exact{nodeKey, port}
SourceControlRef = exact{nodeKey}
nodeKey = NodeKey
port = one of the producing node's declared ports
```

A canonical Program is:

```text
Program = exact{
  schemaVersion, kind, language, manifest, schemas, schemaRegistryDigest,
  roleCatalog, approvalTemplate, policy, verificationContracts,
  nodes, root, resultSchema, programDigest, programId
}
schemaVersion = 1
kind = "baton.program"
language = "baton-program-ir-v1"
root = ControlRef
programId = "program:" + programDigest
```

Canonical references are:

```text
PortRef = exact{nodeId, port, schema}
ControlRef = exact{nodeId}
schema = SchemaRef
```

`PortRef` is a pure data dependency and never schedules its producer. `ControlRef` is a control
edge and never carries a value. Substituting one for the other is `program_invalid`.

The normalizer performs exactly:

1. validate unique `nodeKey` values and every source data/control reference;
2. build separate data-dependency and control-edge graphs; reject self-edges and cycles in either
   graph and in their union;
3. process Kahn ready sets; for a node whose predecessors are canonical, replace source refs with
   canonical `PortRef`s and construct its canonical node body;
4. compute `nodeDigest = H(canonical(node body with both nodeKey and nodeId absent))` and
   `nodeId = "pnode:" + nodeDigest`;
5. coalesce byte-identical node bodies to one node ID and rewrite all references; a hash collision
   with unequal bytes fails `program_identity_collision`;
6. emit the unique nodes in canonical topological order: repeatedly choose the ready node with the
   lexicographically smallest `nodeId` by unsigned UTF-16 order;
7. remove every `nodeKey`, attach each `nodeId`, replace `root`, and validate port/schema equality;
8. compute `programDigest` over the complete canonical Program excluding only `programDigest` and
   `programId`, then attach both.

A node's own ID is therefore never an input to its hash. Author labels never affect identity.
Dependency and control-target IDs do affect identity, so rewiring changes identity.

Every normative array is classified; an array field absent from this table is invalid:

| Classification | Fields | Normalization |
| --- | --- | --- |
| semantic ordered | `sequence.steps`, selector/join `preference`, `reduce.inputs`, NodeTemplate `definitionOfDone`, verification-contract `arguments`, `ownerControlPath`, `BranchState.stack`, `BranchState.rounds`, `controlOccurrencePath`, `repeatRounds`, `childPath`, Context v1 expression arrays, typed-value arrays, fixed evaluation arms, evaluation rate limits, arm envelopes, corpus repetition-seed digests, Latin-square rows and route permutations | preserve input order; order changes identity |
| canonical ordered by integer | selector `criteria` by `order`, map `members` and map-handle `memberSettlements` by `index`, partial-map `members` by original index, effect phase history by phase rank, state revisions by semantic ordinal, operational revisions by arrival ordinal, evaluation routes by `order`, corpus tasks by `taskOrdinal`, and evaluation blocks by `(taskOrdinal,repetition)` | reject duplicate integers and sort ascending; gaps are invalid except in partial-map members; input typed arrays retain their semantic index |
| canonical topological | `Program.nodes` | use §93.4 Kahn order |
| set-like by name | `ProgramSource.nodes` by `nodeKey`, role catalog `roles`, parallel node/handle/fence `branches`, parallel-handle `memberSettlements`, join `branchTerminalRevisions`, collect `items`, select `candidates`, object-schema `properties`, union `variants`, NodeTemplate `capabilities/effects/requiredEffects`, verification environment allowlist | reject duplicate names, sort by unsigned UTF-16 name |
| set-like by path | NodeTemplate `pathScope/contextScope`, approval/template `repositoryScopes`, feedback/revision changed paths | reject duplicate normalized paths; sort by unsigned UTF-16 path |
| set-like by digest/ID | `schemas`, `verificationContracts`, verification required-predecessor evidence, static-effect ownership `entries`, approval contract digests, predicate `and/or` children, join contract digests, finish/result/review/map evidence refs, route/worker attestations, `branchHeads`, state pending/settled effects, values/children/fences, join terminal revisions/member settlements, semantic-barrier events, source-lineage constituents, ownership arrays, review findings/anchors/evidence, effect/result/terminal/feedback digests and forensic sidecar records, evaluation `requiredGreenContracts` | reject duplicates; sort by the documented name/ID/digest tuple; barrier events use §93.13 total key |
| set-like scalar | string-schema `enum`, approval role/effect lists, action lists, and imported worker-policy `supported/mechanisms/guarantees/configuredPreferences` | reject duplicates; sort by canonical scalar bytes |
| fixed positional | route tuple coordinates, disposition/eligibility records, process authority tuples | represented as objects, never arrays |

Schema `array` values are semantic ordered even when `unique=true`; uniqueness does not make them
sets. Map members are canonical ordered by integer member index. Parallel branches are set-like by
name, never completion order. Any prose use of "sorted unique" refers to the set-like row above.

The raw JSON source, Python builder, and TypeScript builder MUST emit the same `ProgramSource`
meaning and normalize to byte-identical `Program` bytes. Builders MUST NOT precompute IDs, accept
callbacks, preserve source-language objects, or add provenance fields to canonical nodes. Builder
source maps are separate non-authoritative artifacts keyed by `programDigest`.

## 93.5 Closed schemas and typed values

A schema registry contains only these definitions:

```text
SchemaRef = exact{kind, schemaId, name, version, digest}
kind = "schema_ref"
schemaId = "schema:" + digest
name = SafeId
version = positive integer
digest = Digest
```

Each definition has common exact fields
`{schemaVersion,kind,name,version,form,definition,digest,schemaId}` where `schemaVersion=1`,
`kind="baton.value_schema"`, and `schemaId="schema:"+digest`. `digest` hashes the object excluding
`digest` and `schemaId`. `form` MUST equal `definition.type`. `definition` is one of:

```text
null       = exact{type}                                      type="null"
boolean    = exact{type}                                      type="boolean"
integer    = exact{type, minimum, maximum}                    nullable safe bounds
number     = exact{type, minimum, maximum}                    nullable finite bounds
string     = exact{type, minBytes, maxBytes, format, enum}    format="text|safe_id|digest|git_sha";
                                                             enum=null or unique sorted strings
array      = exact{type, items, minItems, maxItems, unique}   items=SchemaRef
object     = exact{type, properties, additionalProperties}    additionalProperties=false
union      = exact{type, discriminator, variants}
```

An object property is `exact{name,schema,required}`. Properties sort uniquely by name. A union
variant is `exact{tag,schema}`; tags sort uniquely and the referenced object schema MUST require a
string property named by `discriminator` whose enum is exactly `[tag]`. Recursive reference cycles,
external `$ref`, regex, executable format validators, defaults, coercion, `additionalProperties:
true`, and unknown schema keywords are forbidden.

`schemas` is the canonical array of definitions sorted by `schemaId`.
It has at most `policy.maxSchemaDefinitions` members; object properties, union variants, and string
enums share that ceiling, and an array schema's `maxItems` cannot exceed
`policy.maxJoinMembers`.
`schemaRegistryDigest=H(schemas)`. Every `SchemaRef` MUST match one registry definition on all four
fields; same name/version with different digest, an unregistered ref, or an unused definition with
a colliding name/version fails normalization.

`TypedValue` is `exact{schema,value,valueDigest}`. Validation is structural and closed: required
object properties are present, optional properties are the only other allowed properties, strings
are checked after normalization, array uniqueness uses canonical value bytes, numeric bounds are
inclusive, and unions select exactly one variant. `valueDigest=H(canonical(value))`. No coercion
occurs (`"1"` is not `1`; an integer is valid as `number` only when the registered schema says so).

A durable value is never an inline mutable state cell:

```text
ValueRef = exact{
  kind, valueId, artifactId, artifactDigest, schema, valueDigest, lineageDigest
}
kind = "value_ref"
valueId = "pvalue:" + H({artifactDigest,schema,valueDigest,lineageDigest})
```

The artifact is immutable, private when necessary, schema-validated on write and every read, and
registered before a transition may cite the `ValueRef`. Missing or changed bytes settle
`artifact_unavailable`; they are never silently recomputed under the same ref.

## 93.6 Bound authority references

These closed references are used by nodes and results:

```text
ManifestRef = exact{kind, manifestId, manifestDigest, treeSha, environmentDigest}
kind = "context_manifest_ref"

CandidateRef = exact{
  kind,candidateId,candidateDigest,baseSha,resultSha,artifact,
  capsule,commit,planDigest,nodeKey,nodeTemplateDigest,approvalEvent,
  taskBriefVerificationDigest,verificationState,lineageDigest
}
kind = "candidate_ref"
verificationState = "unverified|verified|rejected|inconclusive"

ArtifactRef = exact{kind, artifactId, artifactDigest, mediaType, bytes}
kind = "artifact_ref"

CapsuleRef = exact{
  kind,capsuleId,capsuleDigest,artifact,mediaType,bytes,sourceLineageDigest
}
kind = "capsule_ref"

CommitRef = exact{
  kind,baseSha,resultSha,retainedRef,treeDigest,changedPathsDigest
}
kind = "commit_ref"

VerificationContractRef = exact{
  kind, contractId, contractVersion, contractDigest, approvalDigest
}
kind = "verification_contract_ref"

VerificationContract = exact{
  schemaVersion,kind,contractId,contractVersion,executable,arguments,cwd,
  expectedExit,timeoutMs,maxOutputBytes,environmentAllowlist,freshSandbox,
  requiredPredecessorEvidence,qualityGates,approvalDigest,contractDigest
}
kind="baton.verification_contract"
qualityGates=exact{
  requireRedBeforeGreen,requireGreen,minimumCoverageBasisPoints,
  minimumMutationBasisPoints
}

ApprovalEventRef = exact{repoId,runId,sequence,eventDigest}
```

In `CandidateRef`, `artifact`, `capsule`, and `commit` are respectively `ArtifactRef|null`,
`CapsuleRef|null`, and `CommitRef|null`; at least one is non-null and every non-null ref MUST bind
the same Candidate/result SHA and lineage. `approvalEvent=ApprovalEventRef`; its sequence is a
positive safe integer and the digest binds the exact immutable event bytes.
No mutable ref name or current branch is identity.

`artifactDigest` hashes the immutable artifact bytes and `bytes` is their non-negative safe byte
count. `capsuleDigest` hashes the capsule excluding itself and `capsuleId`; `candidateDigest`
hashes the Candidate excluding itself and `candidateId`. Artifact, capsule, and Candidate IDs use
their declared prefix plus the matching digest. `CommitRef` binds an immutable retained ref and tree; it never
accepts a symbolic current branch as identity.

A verification contract is deployment/Plan-owned. `executable` is one direct repository-safe
executable; `arguments` is semantic ordered bounded text; `cwd` is normalized repository-relative;
`expectedExit` is 0..255; timeout/output are positive bounded safe integers; the environment
allowlist is set-like by name; `freshSandbox` MUST be true. Quality booleans are exact and basis
points are null or 0..10000. `requiredPredecessorEvidence` is a set-like Digest array equal to the
approved Plan node predecessor evidence. `contractDigest` hashes every field except itself and MUST match its
ref; `approvalDigest` binds separate verification authority. It is
approved separately from Program authoring. Those fields never appear in Program JSON. Resolution
requires `freshSandbox=true`, exact tree/Candidate/artifact identity, the exact contract ref and
contract bytes already bound by the immutable approval event, and the existing referee as sole
verdict authority. Gate preparation never consults a current contract registry or Plan head.

Gate preparation freezes this runtime-only binding; it is never accepted from Program JSON:

```text
GateBinding = exact{
  schemaVersion,kind,effectId,candidate,verificationContract,
  approvedPlanDigest,nodeKey,nodeTemplateDigest,approvalEvent,frozenTaskBriefVerification,
  frozenTaskBriefVerificationDigest,frozenVerificationContract,
  frozenVerificationContractDigest,gateBindingDigest
}
kind="baton.gate_binding"
frozenTaskBriefVerification=ArtifactRef
frozenVerificationContract=ArtifactRef
candidate=CandidateRef|ArtifactRef
verificationContract=VerificationContractRef
```

The two frozen artifacts carry exact approval-event-bound bytes:

```text
TaskBriefVerification = exact{
  schemaVersion,kind,taskBriefDigest,verificationContractDigest,
  expectedExit,expectResult,taskBriefVerificationDigest
}
kind="baton.task_brief_verification"
expectResult = exact{resultSchemaRef,verdictDerivation}
resultSchemaRef = SchemaRef                  ; MUST resolve to baton.gate_result
verdictDerivation = exact{passWhen,candidateFailedWhen,inconclusiveWhen}
passWhen = exact{exitEquals,qualityGatesSatisfied}
candidateFailedWhen = "exit_not_equals|quality_gate_failed"
inconclusiveWhen = "provider_inconclusive"
```

The four digest domains used here are closed and non-interchangeable:

| Domain | Digest field | Exact preimage | Permitted equality checks |
| --- | --- | --- | --- |
| canonical artifact bytes | `ArtifactRef.artifactDigest` | the complete immutable artifact bytes | another `artifactDigest` for those same bytes |
| verification contract | `VerificationContract.contractDigest` | the canonical contract object excluding only `contractDigest` | `VerificationContractRef.contractDigest`, `TaskBriefVerification.verificationContractDigest`, `GateBinding.frozenVerificationContractDigest`, and the approval event's contract digest |
| Task Brief verification | `TaskBriefVerification.taskBriefVerificationDigest` | the canonical Task Brief verification object excluding only that field | `CandidateRef.taskBriefVerificationDigest`, `GateBinding.frozenTaskBriefVerificationDigest`, and the approval event's Task Brief verification digest |
| Candidate | `CandidateRef.candidateDigest` | the canonical Candidate excluding `candidateDigest` and `candidateId` | the same Candidate digest in its production receipt, gate subject, verifier receipt, or result |

No comparison across rows is valid, even if two SHA-256 strings happen to be byte-equal. In
particular, an artifact digest is never compared with a contract, Task Brief verification, or
Candidate digest. Embedding a canonical object in an artifact binds both domains: the artifact
digest authenticates the complete stored bytes, while parsing those bytes and recomputing the
object's own digest authenticates its typed semantic identity.

The gate authority uses those frozen bytes and never current state. `frozenTaskBriefVerification`
MUST be the immutable artifact whose complete bytes parse canonically as the exact
`TaskBriefVerification` object approved at `approvalEvent`; its `artifactDigest` is checked only
against those bytes. `frozenTaskBriefVerificationDigest` MUST equal the parsed object's
`taskBriefVerificationDigest` and the approval event's Task Brief verification digest. The
`expectResult` inside it pins the result schema and the complete exit/quality-gate → verdict mapping
the referee applies. `frozenVerificationContract` MUST likewise be the immutable artifact whose
complete bytes parse canonically as the exact `VerificationContract` object bound at that same
`approvalEvent`; its `artifactDigest` is checked only against those bytes.
`frozenVerificationContractDigest` MUST equal the parsed object's `contractDigest`,
`verificationContract.contractDigest`, `TaskBriefVerification.verificationContractDigest`, and the
approval event's contract digest. The gate executes the parsed frozen contract bytes; it MUST NOT
resolve the current Plan head, current node template, current deployment verification, current
task brief, or current contract registry entry.

The binding coordinates equal the CandidateRef and Plan commitments exactly. When `candidate` is a
`CandidateRef`, `approvedPlanDigest`, `nodeKey`, `nodeTemplateDigest`, `approvalEvent`, and
`frozenTaskBriefVerificationDigest` MUST respectively equal that Candidate's `planDigest`,
`nodeKey`, `nodeTemplateDigest`, `approvalEvent`, and `taskBriefVerificationDigest`, and the
Candidate's `candidateDigest`, `baseSha`, and `resultSha` MUST equal the same typed coordinates in
the immutable production and verifier receipts for the exact result tree;
when `candidate` is an `ArtifactRef`, the same Plan/node-template/approval-event/task-brief
commitments MUST equal the immutable production receipt and approval-event bytes for the Plan node
that produced that artifact. The gate node's `verificationContract` MUST byte-equal the binding's
ref. `gateBindingDigest` hashes the complete binding excluding itself, and admission refuses any
coordinate that diverges from those frozen Candidate/artifact/Plan commitments. No current-state
lookup participates in any of these comparisons.

The produced `baton.gate_result` maps completely to `expectResult`: its result schema MUST equal
`expectResult.resultSchemaRef`, and its `verdict` MUST equal the verdict that
`expectResult.verdictDerivation` prescribes for the observed verifier exit and frozen-contract
quality-gate state. A verdict the frozen mapping does not produce is `program_invalid` before
publication; substitution or resolving any current/historical head fails authority before verifier
effect and never yields a rejected verdict.

## 93.7 Versioned role catalog, service tier, and worker policy

The Program role catalog advances to schema version 2:

```text
RoleCatalog = exact{schemaVersion,kind,roles,catalogDigest}
schemaVersion = 2
kind = "baton.program_role_catalog"

Role = exact{
  role, routeRequest, serviceTierRequest, workerPolicyRequest,
  workerPolicyRequestDigest, templateBinding, nodeTemplateDigest, independenceFamily
}
routeRequest = exact{harness,model,effort}
serviceTierRequest = exact{mode,value,authorizationDigest}
mode = "exact|none"
exact => value is non-empty string and authorizationDigest is Digest
none => value is null and authorizationDigest is null
independenceFamily = exact{harnessFamily,modelFamily,familyDigest}

TemplateBinding union:
  inline = exact{kind,nodeTemplate,nodeTemplateDigest}      kind="inline"
  content_ref = exact{kind,artifact,nodeTemplateDigest,approvalDigest}
                                                          kind="content_ref"

NodeTemplate = exact{
  definitionOfDone,pathScope,contextScope,risk,verificationContract,
  capabilities,effects,requiredEffects,workerPolicyRequest
}
definitionOfDone=bounded non-empty text[1..policy.maxEvidenceRefs]
pathScope/contextScope=normalized repository-relative path[1..policy.maxEvidenceRefs]
risk=SafeId
verificationContract=VerificationContractRef
capabilities/effects/requiredEffects=SafeId[0..policy.maxEvidenceRefs]
workerPolicyRequest=exact Phase 92/default schema-v1 request
```

Roles are set-like by `role`, non-empty, and bounded by `policy.maxProgramNodes`. The three-axis
route remains indivisible and MUST match an approved Phase 88 tuple. The service-tier null rules
above are exhaustive.
`familyDigest=H({harnessFamily,modelFamily})`; family names are deployment-card identities, never
worker-supplied prose.
`serviceTierRequest.authorizationDigest` comes from a distinct model-policy approval when exact;
it cannot be inferred from harness/model/effort or adapter defaults. `workerPolicyRequest`
is the exact Phase 92/default schema-v1 request and its digest MUST equal
`workerPolicyRequestDigest`. An inline template binds its immutable canonical bytes. A content ref
MUST be an immutable approved artifact whose bytes revalidate to the exact `NodeTemplate` and
`nodeTemplateDigest`; replay reads that artifact, never current Plan/template defaults.
`requiredEffects` MUST be a subset of `effects`; every capability/effect is deployment-known.
The template worker-policy request MUST be byte-identical to the role request. A verification
contract ref carries identity only, so neither inline nor content-ref template bytes can contain
raw command, argv, cwd, environment, or provider-launch text.
`catalogDigest` hashes the full catalog excluding itself. A successor
definition copies this catalog byte-for-byte or uses a separately approved successor catalog; it
never reconstructs one from current defaults.

Every dispatched effect records:

```text
RouteAttestation = exact{
  role, requested, resolved, observed, routeAttestationDigest
}
requested = exact{harness,model,effort,serviceTier,serviceTierAuthorizationDigest}
resolved = exact{
  harness,model,effort,serviceTier,harnessCardVersion,adapterCardDigest,routeKey,
  resolutionDigest
}
routeKey=RouteTupleKey
observed = exact{
  harness,model,effort,serviceTier,harnessSource,modelSource,effortSource,
  serviceTierSource,observationDigest
}
each source = "provider_native|unavailable"
```

The service-tier state machine is closed. For role request `mode="none"`, requested
`serviceTier` and `serviceTierAuthorizationDigest`, resolved `serviceTier`, and observed
`serviceTier` are all null; `serviceTierSource="unavailable"`. For `mode="exact"`, requested
and resolved service tier are the same non-empty authorized string and the authorization digest is
non-null; observed service tier is either that exact string with `serviceTierSource="provider_native"` or null
with `serviceTierSource="unavailable"`. No empty string, implicit/default string, requested exact with null
authorization, resolved substitution, or observed different string is valid.

Each other observed coordinate independently requires a non-null value exactly when its matching
source is `provider_native`; `unavailable` requires null. Request or resolution never fabricates
observation. A mismatch on any natively observed axis is a route fault and triggers ordinary
stop/reap. Requested fields MUST equal the immutable role request; resolved fields come only from
the admitted adapter-card resolution. Nested resolution/observation digests exclude themselves,
and `routeAttestationDigest` hashes the complete attestation excluding itself.

Every dispatched effect also records:

```text
WorkerPolicyAttestation = exact{
  role, request, requestDigest, resolution, resolutionDigest,
  observation, observationDigest, attestationDigest
}
```

The nested request/resolution/observation shapes are exactly those normalized by
`worker-policy.mjs`. Their digests, the adapter-card digest, and mismatches survive transitions,
effect results, Program results, replay, Episode, and trace. `attestationDigest` hashes the complete
object excluding itself; every nested digest MUST revalidate.

## 93.8 Approval template and approved envelope

The authoring Program carries a non-authoritative approval template:

```text
ApprovalTemplate = exact{
  schemaVersion,kind,roles,effectKinds,repositoryScopes,routeConstraintDigest,
  serviceTierConstraintDigest,workerPolicyConstraintDigest,
  repeatBoundName,childBoundName,effectBoundName,templateDigest
}
schemaVersion = 1
kind = "baton.program_approval_template"
roles = set-like role names[1..policy.maxProgramNodes]
effectKinds = set-like subset of the seven effect kinds[1..7]
repositoryScopes = set-like normalized repository-relative scopes[1..policy.maxEvidenceRefs]
repeatBoundName = "program_repeat_rounds"
childBoundName = "program_child_depth"
effectBoundName = "program_effect_instances"
```

The template grants nothing. Start requires this exact envelope, appended by existing distinct
approval authority after preview:

```text
ApprovalEnvelope = exact{
  schemaVersion,kind,envelopeId,programDigest,templateDigest,roleCatalogDigest,
  policyDigest,verificationContractDigests,approvedRoles,approvedEffectKinds,
  repositoryScopes,maxRepeatRounds,maxChildDepth,maxEffectInstances,
  approver,approvedEvent,predecessorApprovalDigest,approvalDigest
}
schemaVersion = 1
kind = "baton.program_approval"
envelopeId = "program-approval:" + approvalDigest
approver = exact{actor,principalId}
approvedEvent = ApprovalEventRef
predecessorApprovalDigest = null or Digest
```

Lists are canonical and MUST equal or narrow the template and referenced authorities. Numeric
bounds equal deployment-resolved policy values and cannot be supplied by an ordinary caller.
`approvedRoles`, `approvedEffectKinds`, and `repositoryScopes` retain their template bounds;
`verificationContractDigests` is set-like with at most `policy.maxSchemaDefinitions` members.
`approvalDigest` hashes the envelope excluding `envelopeId` and `approvalDigest`. Expansion of a
role, exact route, service tier, worker policy, effect kind, repository scope, verification
contract, repeat depth, child depth, or effect count requires a successor envelope with the prior
digest. Approval does not launch a provider, select a Candidate, integrate, or promote knowledge.

`templateDigest` hashes the complete approval template excluding itself. The template's roles,
effect kinds, scopes, and constraint digests MUST equal the corresponding normalized Program and
catalog projections; it cannot omit Program authority merely to obtain a smaller approval.

## 93.9 Exhaustive control-node schemas

Every canonical node has common exact fields `{nodeId,kind,...kindFields}`. Except for the two
explicit derived-schema forms below, every source node has the same fields with `nodeKey` replacing
`nodeId`. A source `context` or `collect` node omits `outputSchema`; the normalizer derives and
inserts it. Supplying that field in either source form is an unknown-field error, so an author can
never assert a result schema independently of the exact normalized result. There are no optional
fields; use explicit null where a schema permits null.

```text
value = exact{nodeId,kind,value,schema}
  kind="value"; value=TypedValue; schema=value.schema
  ports: value:schema

context source = exact{nodeKey,kind,program}
context canonical = exact{nodeId,kind,program,outputSchema}
  kind="context"; program=normalized baton.context_program v1 proven pure under §93.10
  outputSchema=deriveContextResultSchema(program,manifest,schemas)
  ports: value:outputSchema

sequence = exact{nodeId,kind,steps,result,outputSchema}
  kind="sequence"; steps=ControlRef[1..policy.maxProgramNodes]; result=PortRef
  ports: value:outputSchema=result.schema

branch = exact{nodeId,kind,predicate,then,otherwise,outputSchema}
  kind="branch"; then/otherwise=BranchArm
  BranchArm=exact{control,result}; control=ControlRef; result=PortRef
  both result schemas MUST equal outputSchema
  ports: value:outputSchema

parallel = exact{nodeId,kind,branches,join,outputSchema}
  kind="parallel"
  branches=set-like exact{name,control,result,resultSchema}[1..policy.maxParallelBranches]
  control=ControlRef; result=PortRef; result.schema=resultSchema
  join=Join
  outputSchema MUST be registered "baton.parallel_handle"
  ports: handle:outputSchema

await = exact{nodeId,kind,target,join,outputSchema}
  kind="await"; target=PortRef to EffectHandle, ParallelHandle, or ChildHandle
  join=Join compatible with target
  outputSchema MUST be registered "baton.settlement_envelope"
  ports: settlement:outputSchema

collect source = exact{nodeKey,kind,items}
collect canonical = exact{nodeId,kind,items,outputSchema}
  kind="collect"; items=set-like exact{name,value}[1..policy.maxJoinMembers]; value=PortRef
  outputSchema=deriveCollectResultSchema(items,schemas)
  ports: value:outputSchema

select = exact{nodeId,kind,candidates,selector,outputSchema}
  kind="select"; candidates=set-like exact{name,value}[1..policy.maxJoinMembers]; value=PortRef
  selector=Selector
  ports: value:outputSchema

repeat = exact{nodeId,kind,initial,body,continueWhen,bound,resultSchema}
  kind="repeat"; initial=PortRef; body=ChildProgramRef
  continueWhen=Predicate evaluated against body result
  bound=exact{kind,name,policyDigest}; kind="policy_bound";
        name="program_repeat_rounds"
  ports: settlement:registered "baton.settlement_envelope"

child = exact{nodeId,kind,program,input,bound,resultSchema}
  kind="child"; program=ProgramRef; input=PortRef
  bound=exact{kind,name,policyDigest}; kind="policy_bound";
        name="program_child_depth"
  ports: handle:registered "baton.child_handle"
```

`ProgramRef = exact{kind,programId,programDigest,resultSchema}` with `kind="program_ref"`, and
`ChildProgramRef = exact{kind,program,inputSchema,resultSchema}` with
`kind="child_program_ref"`. A child/repeat body is already normalized, independently approved or
within the parent envelope shape, acyclic by `programDigest`, and cannot widen authority.

The two schema derivations are closed normalization operations, not runtime inference. For
`context`, the normalizer performs the §93.10 complete pure-AST walk and derives the exact result
schema from the normalized terminal expression and the schema refs of every addressed immutable
manifest/artifact input. Each operation has one checked-in schema transformer; an operation or
input without an exact result schema is `program_invalid`. For `collect`, the normalizer constructs
the object definition `exact{type:"object",properties:[exact{name:<item name>,schema:<item
value.schema>,required:true}...],additionalProperties:false}` in canonical item-name order. In both cases the resulting definition
MUST already be present in `schemas`; `outputSchema` is its byte-matching `SchemaRef`. A missing,
ambiguous, unregistered, or caller-substituted result schema fails normalization. Evaluation then
validates the exact produced `TypedValue` against that derived ref before publishing the port.

The node table is inert data. Execution enters only `root:ControlRef`; a `PortRef` never schedules
its producer. When an entered control node needs a value, demand evaluation recursively evaluates
only `value`, pure `context`, and `collect` data nodes. A demanded port produced by `await`,
`select`, `sequence`, `branch`, `repeat`, or `finish` MUST already be settled on a dominating
control edge. Demand can never enter an effect, parallel branch, child, repeat body, approval, or
operator action.

`sequence` enters its control steps in array order and exposes only its explicit `result` ref after
all steps settle. `branch` evaluates its predicate by demand, enters exactly one arm control, and
exposes only that arm's explicit result. `parallel` creates all named branch-local chains behind a
single durable admission fence. `repeat`/`child` enter their referenced Program only through their
own counters and approval. Unselected branch nodes cause no effect.

The validator computes control dominance and static effect ownership. Pure data nodes MAY be
shared. Every effect node has exactly one static controlling owner path; every await is dominated
by the handle producer it awaits; every data ref to a control-produced port is dominated by that
producer's settlement. The only repeated effect invocation is its enclosing repeat/child path,
which has a distinct prebound effect ID. Multiple owners, undominated reads, control reached by
demand, and effect reachability outside the selected arm fail before execution admission.

The derived ownership artifact is exact:

```text
StaticEffectOwnership = exact{
  schemaVersion,kind,programDigest,entries,ownershipDigest
}
kind="baton.static_effect_ownership"

EffectOwnershipEntry = exact{
  effectNodeId,ownerControlPath,branchArm,repeatOwner,childOwner,entryDigest
}
ownerControlPath=ControlRef[1..policy.maxProgramDepth]
branchArm=null or exact{branchNodeId,arm}; arm="then|otherwise"
repeatOwner=NodeId|null
childOwner=NodeId|null
```

`entries` is set-like by `effectNodeId`; `ownerControlPath` is semantic ordered from root to the
immediate controller. Every effect node occurs exactly once. `ownershipDigest` and `entryDigest`
exclude only themselves. Admission revalidates this artifact against the Program rather than
trusting builder output.

Predicates are the exhaustive union:

```text
is_true   = exact{kind,value}              kind="is_true"
equals    = exact{kind,left,right}         kind="equals"
not_equal = exact{kind,left,right}         kind="not_equal"
exists    = exact{kind,value}              kind="exists"
contains  = exact{kind,container,item}     kind="contains"
and       = exact{kind,predicates}         kind="and"; 2..policy.maxJoinMembers predicates
or        = exact{kind,predicates}         kind="or"; 2..policy.maxJoinMembers predicates
not       = exact{kind,predicate}          kind="not"
```

Operands are `PortRef`s. `is_true` requires boolean schema. Equality requires identical schemas.
`exists` is true only for a present settled value, never for an unresolved handle. `contains`
accepts only registered string/string or array/item schema pairs. Predicate recursion is bounded by
Program depth. Predicates cannot inspect environment, time, scheduler order, worker prose, or
unknown object fields.

Joins are the exhaustive union:

```text
all_terminal      = exact{kind}                    kind="all_terminal"
all_verified      = exact{kind,contractDigests}    kind="all_verified"
first_verified    = exact{kind,preference}         kind="first_verified"
operator_selected = exact{kind}                    kind="operator_selected"
```

`contractDigests` is sorted unique and separately approved. `preference` is the exact ordered
branch/candidate-name list and is semantic. `all_terminal` waits for every member and preserves all
dispositions. `all_verified` succeeds only when every named member has a verified disposition.
`first_verified` chooses the earliest name in `preference`, never the earliest scheduler result.
`operator_selected` settles attention until an authenticated semantic action records one exact
choice. Non-selected members are preserved and stopped/reaped if active; they are never discarded.

Join compatibility is closed: an `EffectHandle` or `ChildHandle` await uses `all_terminal` only;
verification is inspected later from the settlement envelope. A `ParallelHandle` await MUST repeat
the byte-identical join embedded in that handle and may use any of the four joins. A repeat's
internal child settlement uses `all_terminal`. Any join substitution or scalar use of
`first_verified`, `all_verified`, or `operator_selected` is `program_invalid` before effect.

Selectors are the exhaustive union:

```text
operator_selected = exact{kind}                         kind="operator_selected"
first_verified    = exact{kind,preference}              kind="first_verified"
all_verified      = exact{kind,contractDigests}         kind="all_verified"
evidence_ranked   = exact{kind,criteria,tie}            kind="evidence_ranked"
settlement_value  = exact{kind,member,requiredExecution,requiredVerification}
                                                        kind="settlement_value"
criterion         = exact{contractDigest,required,order}
tie = "unresolved"

SettlementMemberSelector union(kind):
  self   = exact{kind}        kind="self"
  branch = exact{kind,name}   kind="branch"; name=SafeId
  map    = exact{kind,index}  kind="map"; index=non-negative safe integer
requiredExecution="succeeded"
requiredVerification="not_required|passed"
```

Criteria sort by integer `order`, which is unique and contiguous from zero. Evidence ranking
considers only typed gate/review artifacts for the exact Candidate. No vote, model confidence,
completion time, majority, or lexical ID establishes correctness. Any tie or missing required
evidence settles `unresolved` and requires operator selection.

`settlement_value` requires exactly one candidate whose schema is
`baton.settlement_envelope`. Its required `member` chooses the envelope itself, one exact parallel
branch name, or one exact map index. It is the only primitive that extracts the chosen settlement's
success `valueRef`; it succeeds only when the named execution and verification dispositions match
and the value validates against `select.outputSchema`. A missing/duplicate member, null value, or
disposition mismatch settles typed attention. There is no implicit post-await value/result port.

## 93.10 Context payload purity and legacy migration

A new `context` node accepts only a normalized `baton.context_program` v1 for which a complete AST
walk proves that every operation is in:

```text
source outline index search slice chunk filter project sort unique join collect coverage finish
```

It MUST reject `map`, `reduce`, `review`, and `verify`, even though the historical v1 normalizer
parses them. It also rejects any future unknown operation. Pure Context evaluation may read only
the exact Program `manifest`, addressed immutable artifacts, and deterministic Atlas/ACI operations
named inside that program and bound by the manifest and policy. It cannot append, dispatch, verify,
notify, checkpoint, or finish a Program.

A Program v1 `context` node has no per-node input bindings and no ambient variables. Context v1
defines no variable or binding operator, so the pure program reaches every value it inspects through
an addressed artifact/manifest reference written inside the program itself, never through an injected
binding, an enclosing-scope name, or a caller-supplied substitution. The earlier `context.bindings`
field is therefore removed for Program v1; a value the pure program must inspect is addressed inside
the program, and any effectful binding need is compiled to an explicit `map`/`reduce`/`gate` effect
under §93.10 migration rather than invented as an ambient input.

Historical Context v1 cells and `context.call_*` events remain replay-only under their original
bytes, identity, policy, and semantics. They are not silently relabeled pure and cannot be embedded
as a new Program `context` node when effectful.

An explicit migration tool MAY compile:

- Context `map` to Program `map`;
- Context `reduce` to Program `reduce`;
- Context `review` to an independent Program `call` plus typed ReviewArtifact; and
- Context `verify` to Program `gate`;

but only when the caller supplies the required approved role catalog, service-tier authority,
worker policy, verification contract, schemas, and approval envelope. The result receives a new
`programDigest`. A crosswalk artifact records the old Context digest and new Program digest; it
never claims identity equivalence.

## 93.11 Exhaustive effect-node schemas and asynchronous handles

Effect nodes are canonical nodes and use these exact fields:

```text
call = exact{
  nodeId,kind,role,input,instruction,resultSchema,effectClass
}
kind="call"; role=role-catalog name; input=PortRef
instruction=bounded text; effectClass="provider_call"
ports: handle:baton.effect_handle

map = exact{
  nodeId,kind,role,input,instruction,itemSchema,resultSchema,effectClass
}
kind="map"; input schema=array(itemSchema); effectClass="provider_call"
ports: handle:baton.effect_handle

reduce = exact{
  nodeId,kind,role,inputs,instruction,resultSchema,effectClass
}
kind="reduce"; inputs=semantic ordered PortRef[1..policy.maxJoinMembers]
every input MUST already be settled and schema-validated; effectClass="provider_call"
ports: handle:baton.effect_handle

gate = exact{
  nodeId,kind,candidate,verificationContract,resultSchema,effectClass
}
kind="gate"; candidate=PortRef whose value is CandidateRef or ArtifactRef
verificationContract=VerificationContractRef
resultSchema=registered baton.gate_result; effectClass="verification"
ports: handle:baton.effect_handle

notify = exact{
  nodeId,kind,target,message,delivery,resultSchema,effectClass
}
kind="notify"; target=PortRef whose value schema is `ControlTargetRef`
message=PortRef with bounded non-secret text schema
delivery="nudge|now|turn"; effectClass="provider_control"
ports: handle:baton.effect_handle

checkpoint = exact{
  nodeId,kind,value,label,resultSchema,effectClass
}
kind="checkpoint"; value=PortRef; label=bounded SafeId
effectClass="ledger_write"
ports: handle:baton.effect_handle

finish = exact{
  nodeId,kind,value,evidence,resultSchema,effectClass
}
kind="finish"; value=PortRef; evidence=set-like PortRef[1..policy.maxEvidenceRefs],
each yielding EvidenceRef
effectClass="terminal_ledger_write"
ports: result:resultSchema
```

Every `instruction` is non-empty, non-secret bounded text whose exact registered string schema has
`maxBytes` equal to the admitted Context Program policy v1 `maxTextBytes`; the whole canonical
Program independently remains bounded by `policy.maxProgramBytes`. Every other text/value bound
comes from its registered schema and cannot exceed `policy.maxValueBytes`; every array uses the
classification and bound in §93.4. These are lower-policy-bound validation limits, not caller knobs.

`EvidenceRef = exact{kind,id,digest}`; its kind is one of
`artifact|candidate|gate_receipt|review_artifact|feedback|representation|cairn_node|trace`.

The notify target value is this exhaustive union, never a process/session coordinate:

```text
ControlTargetRef union(kind):
  program    = exact{kind,programId,executionId,approvalDigest} kind="program"
  workstream = exact{kind,programId,executionId,workstreamId,generation} kind="workstream"
```

The three asynchronous handle schemas are exact and non-interchangeable:

```text
EffectHandle = exact{
  schemaVersion,kind,effectId,executionId,programDigest,nodeId,branchId,
  effectKind,resultSchema,approvalDigest,admittedTransitionDigest,handleDigest
}
kind="baton.effect_handle"

ParallelHandle = exact{
  schemaVersion,kind,parallelId,executionId,programDigest,nodeId,branches,
  join,settlementSchema,approvalDigest,admissionFenceDigest,handleDigest
}
kind="baton.parallel_handle"

ParallelBranchHandle = exact{
  name,branchId,controlNodeId,resultRef,resultSchema,branchAdmissionDigest
}

ChildHandle = exact{
  schemaVersion,kind,parentExecutionId,childExecutionId,programDigest,nodeId,
  branchId,childProgramDigest,resultSchema,approvalDigest,genesisRevisionDigest,
  ownershipSnapshotDigest,handleDigest
}
kind="baton.child_handle"
```

`parallelId="parallel:"+H({executionId,nodeId,branchSetDigest,approvalDigest})`. `branches` is
set-like by `name` and contains exact `ParallelBranchHandle`s. Every `handleDigest` hashes its
complete handle excluding only `handleDigest`; all referenced admissions MUST already be durable.
Each branch `resultRef` is the exact node-declared ref, is control-dominated inside that branch,
and matches `resultSchema`; the handle carries the ref identity, never its value.
An `EffectHandle` is available at `admitted`, a `ParallelHandle` only after the common branch
admission fence, and a `ChildHandle` only after the child genesis revision and ownership record.
Handles contain no result, success value, provider response, or completion-order field.

Every `await`, regardless of handle kind, produces exactly this registered value:

```text
SettlementEnvelope = exact{
  schemaVersion,kind,ownerKind,target,targetDigest,join,dispositions,workProductRefs,
  eligibility,valueRef,memberSettlements,effectResultDigests,cleanup,
  terminalRevisionDigests,settlementDigest
}
kind="baton.settlement_envelope"
target=EffectHandle|ParallelHandle|ChildHandle
ownerKind=target.effectKind when target=EffectHandle
ownerKind="parallel_aggregate" when target=ParallelHandle
ownerKind="program" when target=ChildHandle

ParallelAggregateValue = exact{
  schemaVersion,kind,parallelId,join,members,aggregateValueDigest
}
schemaVersion=1
kind="baton.parallel_aggregate_value"
members=branch variant of MemberSettlement[1..policy.maxParallelBranches]
```

The disposition, work-product-reference, eligibility, and member-settlement shapes are the exact
§93.15 schemas, and `cleanup` is its exact `CleanupRecord`. `ownerKind` is copied from an effect
handle's `effectKind`, is `program` for a child handle, and is exactly `parallel_aggregate` for a
parallel handle; no result shape implies an unnamed owner. `valueRef` is `ValueRef|null`, MUST
equal `workProductRefs.valueRef`, and is evidence inside the envelope rather than another node
port. `memberSettlements` is canonical by member name/index and is empty for a scalar handle.
`effectResultDigests` and `terminalRevisionDigests` are set-like by digest. `settlementDigest`
hashes the envelope excluding itself. `targetDigest` MUST equal the embedded handle's
`handleDigest`; a handle cannot be replaced by another handle with the same result schema.

For an effect handle, the envelope mirrors the exact `EffectResult`, including its owner and
cleanup. For a child handle, it mirrors the exact `ProgramResult`. For a parallel handle, every
branch has a named `MemberSettlement`; the aggregate is a result in its own right and is computed
from the declared join, not a worst-result or arrival-order heuristic.
`all_terminal` succeeds only when every member succeeds. `all_verified` succeeds only when every
member is verified. `first_verified` uses its preference list after the fenced terminal/stopped
member set exists. `operator_selected` uses only the separately admitted selection event.

Parallel aggregate execution is one closed function over that complete name-sorted set. For
`all_terminal|all_verified`, every member contributes. For `first_verified|operator_selected`, a
successfully chosen member is the sole aggregate contributor; if no choice satisfies the join, all
members contribute and the join choice remains unresolved. Multiple contributing execution outcomes
use this total precedence, highest first:
`ambiguous > failed > cancelled > stopped > not_dispatched > succeeded`. Equal outcomes are equal;
member names and arrival order never break a disposition tie. A non-chosen active branch stopped
with cause `selective_stop`, or a non-chosen branch never dispatched with cause
`superseded_by_selection`, is a selection-stopped branch. It remains an exact `parallel_member`
settlement but does not replace the chosen member's aggregate disposition. Every other chosen or
unchosen ambiguity, failure, cancellation, stop, and not-dispatched fact is handled only by the
contributor rule and total precedence above; no scheduler heuristic or prose exception exists.
The aggregate execution cause is null for `succeeded`; for every other winning execution value it
is the exact fixed `SafeId` formed by `"parallel_aggregate_" + executionDisposition`.
Verification is reduced over the same contributors by the total precedence
`inconclusive > candidate_failed > pending > not_dispatched > passed > not_required`. Its cause is
null for `passed|not_required` and otherwise the exact fixed `SafeId` formed by
`"parallel_aggregate_" + verificationDisposition`. Thus causes never depend on a member name,
scheduler order, or arbitrarily selected member cause; the complete member causes remain present.

A parallel aggregate always has `workProductDisposition="value"`. Its sole non-null
`WorkProductRefs` field and its envelope `valueRef` are the same `ValueRef` to the registered
`baton.parallel_aggregate_value`. That value repeats the exact handle `parallelId` and join and
contains every complete branch `MemberSettlement` in canonical name order; its digest excludes
only itself. The aggregate value is derived even when members have zero, one, or several different
product kinds, so no heterogeneous product is discarded or coerced into a Candidate, artifact,
notification, checkpoint, or partial map. Its members MUST byte-equal `memberSettlements`, and
every original product and ref remains only in those members.

Aggregate cleanup is reduced over every member, including non-contributors. The envelope cleanup
`remaining` counts are component-wise sums of the member cleanup records reached through their
result/terminal-revision digests. Cleanup precedence is
`attention > open > settled > not_required`. Its non-null `ownershipSnapshotDigest` resolves to
the exact §93.15 `OwnershipSnapshot` with scope
`{kind:"parallel_aggregate",id:parallelId}` and the canonical set unions of every member snapshot;
member ownership sets MUST be disjoint, so component-wise remaining sums cannot double-count one
authority. Its non-null `ownershipSettlementDigest` is the existing lifecycle authority's canonical
settlement of that exact aggregate snapshot. Each digest is null exactly when all corresponding
member digests are null. The aggregate cleanup disposition equals
`dispositions.cleanupDisposition`. Selection and integration are exactly `not_applicable`, because
the aggregate work product is the closed settlement collection rather than one member's Candidate;
member selection and integration truth remains in the members.

Downstream eligibility is also closed. If aggregate cleanup is `open|attention`, all six actions
are `blocked_cleanup` with their own `program.<action>` capability and reason
`parallel_aggregate_cleanup_open`. Otherwise `retry`, `revise`, `select`, `integrate`, and `export`
are `ineligible` with null capability/approval and reason `parallel_aggregate_member_scoped`; their
member-level eligibility remains actionable only at the named member. `reduce` addresses the
complete aggregate collection: it is `eligible` with `requiredCapability="program.reduce"` and
the exact separately admitted downstream approval digest when that approval exists, and otherwise
`requires_approval` with the same capability, null approval, and reason
`parallel_aggregate_reduce_approval_required`. No other aggregate eligibility tuple validates.

The aggregate `effectResultDigests` and `terminalRevisionDigests` are respectively the sorted
unique non-null member values of those fields. A parallel envelope cannot settle while an admitted
member lacks a terminal revision or durable `CleanupRecord`; an open/attention cleanup disposition
therefore remains visible and blocks eligible follow-on actions. These reductions consume the
complete name-sorted `MemberSettlement` array and the frozen join bytes only.

`call`, `map`, `reduce`, `gate`, `notify`, and `checkpoint` are asynchronous. Evaluation admits and
prepares the effect and yields its durable handle; it does not block the branch until provider or
local-authority completion. `finish` still crosses the same durable protocol but is terminal and
exposes its result only when settled. A consumer of an asynchronous result depends on an explicit
`await` node. Nonterminal effect nodes, `parallel`, and `child` expose only their respective handle;
`await` exposes only a `SettlementEnvelope`. `sequence` sequences handle production, not hidden
settlement. Templates MUST insert awaits.

Success value extraction is a separate `select` with `selector.kind="settlement_value"`. It reads
the chosen self/member settlement's `valueRef`, checks the required dispositions and destination schema, then emits the
sole typed `select.value` port. A failure, attention, cancellation, partial map, ambiguous effect,
or missing value remains data in the envelope and never becomes a thrown promise rejection or a
fabricated value. There is no direct post-await `result` or `value` port for any handle kind.

`parallel` creates one branch-local PC per named branch and returns a handle after all branch
admissions and one common `ParallelAdmissionFence` are durable. Each sibling then advances on its
own immutable semantic revision chain subject to deployment capacity. `await` registers a durable
dependency and suspends only its branch. It is event-driven; no polling loop holds a writer or
provider slot. The fenced join in §93.14 consumes the name-sorted terminal branch revisions, never
arrival order, so scheduler interleaving cannot change Program values, join selection, transition
identity, or canonical result identity.

## 93.12 Deterministic effect identity and five-phase protocol

For execution `X`, node `N`, canonical control-occurrence path `O`, repeat rounds `R`, child path
`C`, and retry generation `G`:

```text
effectId = "effect:" + H({
  schemaVersion:1, programDigest, executionId:X, nodeId:N,
  controlOccurrencePath:O, repeatRounds:R, childPath:C, retryGeneration:G,
  approvalDigest, roleCatalogDigest, policyDigest
})
```

The ID is prebound when the containing execution, repeat round, child, or explicit retry generation
is admitted and before input demand, preparation, provider traffic, or any external effect. It
contains no input, output, result, artifact, or post-effect `valueDigest`. `O`, `R`, and `C` are
semantic ordered path arrays derived only from canonical control structure. Exact replay returns
the same ID. A new retry/repair/revision MUST admit a new generation or successor path and therefore
receives a new ID. Random IDs, timestamps, arrival ordinals, scheduler counters, and provider
responses are forbidden.

For `map`, all bounded members are admitted before any member provider boundary. Member IDs are:

```text
memberEffectId = "effect-member:" + H({effectId,memberIndex,retryGeneration})
```

`memberIndex` is the semantic input-array index. A member retry increments its own separately
approved generation; successful members retain their original ID and are never repeated. Neither
the parent nor member ID includes the member value digest or a later result digest.

Every effect follows exactly:

```text
admitted -> prepared -> effect_started -> provider_acknowledged -> settled
```

For a purely local effect, the deployment authority is the provider and emits the acknowledgement.
Each record has common exact fields:

```text
EffectTransition = exact{
  schemaVersion,kind,effectId,executionId,programDigest,nodeId,branchId,
  phase,phaseData,parentTransitionDigest,roleCatalogDigest,policyDigest,
  approvalDigest,routeAttestationDigest,workerPolicyAttestationDigest,
  transitionDigest
}
kind="baton.program_effect_transition"
```

`routeAttestationDigest` and `workerPolicyAttestationDigest` are null until they exist. Phase data
is the exhaustive union:

```text
admitted = exact{kind,inputRefsDigest,authorityDigest,prebindingDigest}
           kind="admitted"
prepared = exact{
  kind,requestDigest,successorPlanDigest,ownershipSnapshotDigest,
  providerIdempotencyDigest,gateBinding
}          kind="prepared"
effect_started = exact{kind,boundaryOrdinal} kind="effect_started"
provider_acknowledged = exact{kind,providerReceiptDigest,observationDigest}
                        kind="provider_acknowledged"
settled = exact{kind,result,resultDigest,ownershipSettlementDigest} kind="settled"
```

`successorPlanDigest` is null for effects that need no successor Plan.
`providerIdempotencyDigest` is a digest, never the private token. `gateBinding` is the exact
§93.6 `GateBinding` for `gate` and null for every other effect. `inputRefsDigest` binds the
canonical demanded `ValueRef` identities after admission; it does not alter `effectId`.
`prebindingDigest` binds the canonical identity inputs shown above and MUST be durable before demand.
`boundaryOrdinal` is exactly 1 in schema v1, not a scheduler or retry counter.
`phase` MUST equal `phaseData.kind`. `parentTransitionDigest` is null only for `admitted` and is the
immediately prior phase digest otherwise. `transitionDigest` hashes the complete transition except
itself; a skipped, repeated, or reordered phase is invalid.

The append for `effect_started` commits immediately before the first call that can cause the
external effect. The adapter/provider correlation ID derives from `effectId` and is mapped into
operational evidence. `provider_acknowledged` commits before an acknowledgement is returned to the
runtime. `settled` atomically attaches the typed result and ownership settlement.

Recovery is exhaustive:

| Last durable phase | Only permitted recovery |
| --- | --- |
| none | validate and admit |
| admitted | prepare once |
| prepared | append `effect_started`, then cross the boundary once |
| effect_started | correlate native/operational facts; if not conclusive, settle ambiguous; never call again |
| provider_acknowledged | attach the acknowledged result and settle; never call again |
| settled | replay the settled result |
| any phase with open ownership | fence expansion, finish exact cleanup, then settle or require attention |

An effect may use a provider's true idempotency key to correlate facts, but Baton MUST NOT use it
to justify repeating an effect after `effect_started`. This closes response-loss windows without
turning ambiguity into at-least-once delivery. An ambiguous provider, Git, integration, notify, or
verifier effect becomes a preserved/inconclusive disposition and requires a newly approved
repair/retry with a new effect ID.

## 93.13 Program counter, branch state, stack, rounds, and immutable revisions

The execution identity is:

```text
executionId = "execution:" + H({
  programDigest,approvalDigest,repoId,runId,requesterAuthorityDigest,idempotencyKeyDigest
})
```

The program counter is an immutable branch state, not a mutable instruction integer. Coordinator
state points to immutable branch heads; a sibling can never rewrite another sibling's chain:

```text
ProgramState = exact{
  schemaVersion,kind,executionId,programDigest,status,rootBranchId,
  branchHeads,parallelFences,joinFences,pendingEffects,settledEffects,values,children,
  roleCatalogDigest,policyDigest,approvalDigest,stateDigest
}
kind="baton.program_state"
status="admitted|running|waiting|attention|stopping|settled"
```

Its component schemas are:

```text
BranchState = exact{
  branchId,parentBranchId,name,status,pc,stack,rounds,pending,settled,result,
  stateDigest
}
status="ready|running|waiting|attention|stopping|settled|failed|cancelled"

BranchHead = exact{branchId,name,currentRevisionDigest,status}

PC = exact{nodeId,phase}
phase="enter|admit|prepared|started|acknowledged|settled|exit"

StackFrame union:
  sequence = exact{kind,nodeId,index}
  branch   = exact{kind,nodeId,arm}
  parallel = exact{kind,nodeId,branchName}
  repeat   = exact{kind,nodeId,round}
  child    = exact{kind,nodeId,childExecutionId}

RoundState = exact{
  repeatNodeId,round,inputValueDigest,bodyExecutionId,status,resultValueDigest
}
status="admitted|running|settled|stopped"

ChildState = exact{
  childNodeId,childExecutionId,programDigest,status,resultDigest,ownershipDigest
}

ParallelAdmissionFence = exact{
  parallelId,executionId,parentBranchId,nodeId,branches,join,
  parentRevisionDigest,branchSetDigest,fenceDigest
}
ParallelFenceBranch = exact{
  name,branchId,controlNodeId,resultRef,genesisRevisionDigest,branchAdmissionDigest
}

JoinFence = exact{
  joinId,parallelId,parentBranchId,nodeId,join,branchTerminalRevisions,
  memberSettlementDigests,expectedParentRevisionDigest,joinInputDigest,fenceDigest
}
BranchTerminalRevision = exact{name,branchId,revisionDigest,stateValueDigest}
```

`pendingEffects` and each branch `pending` are unique effect IDs sorted by effect ID.
`settledEffects` and branch `settled` are unique `exact{effectId,resultDigest}` rows sorted by
effect ID. `values` are unique `ValueRef`s sorted by value ID. `children` sort by child execution
ID. `branchHeads` sort by branch ID. Parallel and join fences sort by their IDs. Branch IDs derive
from `{executionId,parentBranchId,parallelNodeId,branchName}`. Root uses `parentBranchId:null`. A
branch owns its PC, stack, rounds, pending/settled membership, and revision chain.

`ParallelAdmissionFence.fenceDigest` and `JoinFence.fenceDigest` hash their complete records
excluding only that digest. Each `branchAdmissionDigest` hashes its exact branch record excluding
itself. `branchSetDigest` hashes the name-sorted branch records. `joinInputDigest` hashes the
name-sorted terminal revisions and member settlement digests plus the join. `joinId="join:"+
H({parallelId,parentBranchId,nodeId,joinInputDigest})`.

The parallel admission operation is one CAS on the parent chain: it durably appends the
`ParallelAdmissionFence` and all named branch genesis revisions before publishing the
`ParallelHandle`. No branch may enter its first control node or admit an effect before that whole
fence commits. Thereafter each branch appends only to its own head. A join is one distinct CAS
on the parent chain. It consumes `BranchTerminalRevision`s sorted by branch name, records the
name-sorted settlement digests, and appends exactly one resulting parent revision keyed by
`fenceDigest`. The fence's
`joinInputDigest` is independent of completion and event-arrival order. A losing CAS recomputes
from the same fenced inputs; it cannot publish a different join.

Operational receipt order is retained for diagnosis but excluded from semantic state and result
identity:

```text
OperationalRevision = exact{
  schemaVersion,kind,executionId,arrivalOrdinal,parentOperationalDigest,
  event,eventDigest,operationalDigest
}
kind="baton.program_operational_revision"

OperationalEvent = exact{
  source,eventType,branchId,nodeId,effectId,phaseRank,payloadDigest
}
source="runtime|provider|lifecycle|operator|replay"
```

`arrivalOrdinal` is a strictly increasing execution-local safe integer. `operationalDigest` hashes
the record excluding itself; `eventDigest=H(event)`. `branchId`, `nodeId`, and `effectId` are their
exact IDs or null when the source event has no such coordinate; `phaseRank` is 0..4 for an effect
phase and null otherwise. This chain may differ across equivalent scheduler runs and is bound
only into trace/forensic evidence. It MUST NOT be an input to a Program, effect, value, semantic
revision, settlement, selection, or result digest.

Reducer inputs are cut into deterministic barriers:

```text
SemanticBarrier = exact{
  schemaVersion,kind,executionId,barrierId,scope,expectedRevisionDigest,
  events,eventSetDigest,sourceLineageDigest,barrierDigest
}
kind="baton.program_semantic_barrier"
scope=exact{kind,id}; kind="branch|parallel_admission|join|execution"

CanonicalReducerEvent = exact{
  eventType,branchId,nodeId,effectId,phaseRank,eventData,eventDigest
}
```

Barrier scope IDs are respectively `BranchId`, `ParallelId`, `ParallelId`, or `ExecutionId` for
the four discriminator values. A state-revision branch scope uses `BranchId`; execution uses
`ExecutionId`.

`events` is set-like under the total key
`(branchId|null,effectId|null,phaseRank,eventType,nodeId|null,eventDigest)` and duplicate semantic
keys with different bytes are invalid. A scalar branch transition closes a one-event barrier.
Parallel admission closes over the declared complete branch-name set. A join closes only over the
fenced terminal-or-stopped revision for every admitted member; the mathematical join then selects
only from that complete fenced set. No timeout or
currently-arrived subset can define a semantic barrier. `eventSetDigest` hashes the sorted events.
`sourceLineageDigest` hashes the sorted immutable source revision/value/effect-result digests read
by those events, not operational receipt records.
`barrierDigest` hashes the complete barrier excluding `barrierId` and itself;
`barrierId="barrier:"+barrierDigest`.

A semantic state revision is:

```text
StateRevision = exact{
  schemaVersion,kind,executionId,scope,semanticOrdinal,parentRevisionDigest,
  barrierDigest,revisionSchemaDigest,state,stateValueDigest,
  sourceLineageDigest,writerAuthority,revisionDigest
}
kind="baton.program_state_revision"
scope=exact{kind,id}; kind="branch|execution"
state=BranchState|ProgramState matching scope.kind
writerAuthority = exact{actor,principalId,repoId,runId,leaseGeneration}
```

`revisionSchemaDigest` is the checked-in digest of this exact schema/version.
`state.stateDigest=H(canonical(state excluding stateDigest))` and `stateValueDigest` MUST equal that
digest. `sourceLineageDigest` equals the barrier lineage
digest. `revisionDigest` hashes every field except itself and `writerAuthority`; writer authority
remains generation-fenced operational evidence and cannot change semantic revision/result identity.
Genesis has semantic ordinal zero and
null parent/barrier digests; its source lineage is
`H({programDigest,executionId,approvalDigest,scope})`. Thereafter the ordinal increments by one and the parent is the exact
prior revision in that scope. State artifacts and barriers use expected-revision CAS under one
generation-fenced coordination writer. Thus arrival order remains auditable while canonical
semantic state, value, lineage, and result identity are reproducible.

## 93.14 Pure transactional reducer

The core exports only:

```text
reduceProgramState(previousRevision, semanticBarrier) -> nextRevision | typed refusal
```

It has no clock, randomness, filesystem, network, provider, ledger, environment, mutable global,
or callback. Given byte-identical arguments it returns byte-identical bytes. It validates every
barrier event against the current Program, effect transition, approval, and expected revision before
creating a new immutable value.

`CanonicalReducerEvent.eventData` is exactly one payload from this exhaustive union:

```text
execution_started = exact{rootBranchId}
node_entered      = exact{branchId,nodeId}
pure_settled      = exact{branchId,nodeId,value}
parallel_admitted = exact{parentBranchId,parallelFence}
await_registered  = exact{branchId,nodeId,targetDigest,join}
effect_advanced   = exact{branchId,effectTransition}
join_settled      = exact{branchId,nodeId,joinFence,settlement}
repeat_advanced   = exact{branchId,nodeId,roundState}
child_advanced    = exact{branchId,nodeId,childState}
attention_set     = exact{branchId,reason,actions}
stop_admitted     = exact{scope,ownershipSnapshotDigest}
cleanup_settled   = exact{scope,ownershipSettlementDigest}
execution_settled = exact{result}
```

The field lists above are exhaustive. Action lists are set-like by action kind. `join_settled` is
legal only when the fenced join's mathematical condition is true over durable member settlements
and the terminal revision set matches the admission fence. `first_verified` uses declared
preference; `all_*` uses canonical member names; operator selection uses a separately admitted
action. A repeated barrier digest is an idempotent read of the existing next revision; changed
barrier bytes under the same expected revision are a CAS conflict. No partial mutation exists.

Each `eventDigest` hashes its canonical event excluding itself. The barrier and reducer validate
all `ValueRef`, `SettlementEnvelope`, and `ProgramResult` objects; provider values are never inline.
Parallel branch chains may physically complete in any order, but the fenced join's sorted terminal
revision inputs and pure reduction produce byte-identical semantic state and results.

## 93.15 Typed effect and Program results

Result state is orthogonal. Each axis carries an independent disposition; no axis is inferred from
another, and the single exhaustive disposition table below is checked as a closed union. Execution and
verification each carry an exact cause:

```text
DispositionSet = exact{
  executionDisposition,executionCause,
  verificationDisposition,verificationCause,
  workProductDisposition,
  cleanupDisposition,selectionDisposition,integrationDisposition
}

executionDisposition = "succeeded|failed|cancelled|stopped|not_dispatched|ambiguous"
executionCause = SafeId|null
verificationDisposition =
  "not_required|pending|passed|candidate_failed|inconclusive|not_dispatched"
verificationCause = SafeId|null
workProductDisposition =
  "value|candidate|artifact|notification|checkpoint|partial_collection|absent"
cleanupDisposition = "not_required|open|settled|attention"
selectionDisposition = "not_applicable|ineligible|eligible|selected|unresolved"
integrationDisposition =
  "not_applicable|ineligible|eligible|approved|integrated|refused|failed_preserved"
```

The six execution values preserve the exact Phase 84/85 output truth: `succeeded` is accepted,
`failed` is failed, `cancelled` is cancelled, and `not_dispatched` is not-dispatched; `stopped` is a
Program selective stop and `ambiguous` is a crash-ambiguous effect. `not_dispatched` means the
effect was admitted but never reached a provider boundary (superseded by selection, capacity never
granted, or dispatch never approved); a `not_dispatched` effect has verification `not_dispatched`,
preserves no provider observation, and is retry-eligible on a new prebound generation.
`executionCause` is null only when `executionDisposition="succeeded"` and is otherwise a non-null
`SafeId` reason code (for example `provider_fault`, `capacity_exhausted`, `selective_stop`,
`operator_cancel`, `crash_ambiguous`). `verificationCause` is null only when
`verificationDisposition` is `not_required` or `passed` and is otherwise a non-null reason code (for
example `exit_mismatch`, `quality_gate_failed`, `provider_inconclusive`). The work-product axis is
product-only: it names the kind of product produced and never encodes execution or verification
outcome, which live on their own axes. `absent` means no work product was produced.

```text
WorkProductRefs = exact{
  artifactRef,capsuleRef,commitRef,candidateRef,valueRef,checkpointRef
}
artifactRef=ArtifactRef|null
capsuleRef=CapsuleRef|null
commitRef=CommitRef|null
candidateRef=CandidateRef|null
valueRef=ValueRef|null
checkpointRef=ValueRef|null

EligibilitySet = exact{retry,revise,reduce,select,integrate,export}
ActionEligibility = exact{state,reasonCode,requiredCapability,approvalDigest}
state="eligible|ineligible|requires_approval|requires_repair|blocked_cleanup|blocked_selection"

MemberSettlement union(memberKind):
  branch = exact{
    memberKind,ownerKind,name,index,dispositions,workProductRefs,eligibility,
    effectResultDigest,terminalRevisionDigest,memberDigest
  }  memberKind="branch"; ownerKind="parallel_member"; index=null; name=SafeId
  map = exact{
    memberKind,ownerKind,name,index,dispositions,workProductRefs,eligibility,
    effectResultDigest,terminalRevisionDigest,memberDigest
  }  memberKind="map"; ownerKind="map_member"; name=null; index=non-negative safe integer
```

`reasonCode` is `SafeId`. `requiredCapability` and `approvalDigest` are respectively `SafeId|null`
and `Digest|null`. `ineligible` requires both null. `eligible` requires both non-null and means the
exact current action approval exists. `requires_approval`, `requires_repair`, `blocked_cleanup`, and
`blocked_selection` require a non-null capability and a null approval digest. No eligibility state
performs the action. In particular, apply/integrate is a
new authenticated semantic action requiring current `program.integrate`, repository-write, and
generation-fenced integrator capability; neither `approved` nor `eligible` mutates a checkout.
`MemberSettlement.memberDigest` hashes the complete member excluding itself. `ownerKind` is the
exact owner used by the one disposition table below; it is not inferred from a result's shape.
Branch members sort by name; map members sort by contiguous index. A member's effect/result and
terminal-revision digests are null only when that member kind has no such record; null never means
pending.

Every effect settlement embeds an immutable, content-addressed result:

```text
EffectResult = exact{
  schemaVersion,kind,effectId,effectKind,generation,dispositions,workProductRefs,
  eligibility,evidenceRefs,routeAttestation,workerPolicyAttestation,
  roleCatalogDigest,policyDigest,approvalDigest,successor,mapSettlement,
  cleanup,resultDigest
}
schemaVersion=1
kind="baton.program_effect_result"
successor=null or exact{planDigest,programDigest,executionId}

CleanupRecord = exact{
  disposition,ownershipSnapshotDigest,ownershipSettlementDigest,remaining
}
remaining=exact{processes,sessions,worktrees,runtimes,branches,leases}
```

`CleanupRecord.disposition` equals `DispositionSet.cleanupDisposition`. Ownership digests are
Digest or null exactly as required by that disposition; every remaining count is a non-negative
safe integer. `routeAttestation` and `workerPolicyAttestation` are null for effects that launch no
worker; otherwise both are the exact §93.7 objects. `mapSettlement` is null except for `map`.
`generation` is the non-negative retry generation already committed by the effect prebinding.
`EffectResult` is immutable and content-addressed: `resultDigest` hashes every field except itself,
so once an effect is settled its result digest never changes. Late observations arriving after
settlement are append-only `ForensicLateResultRecord` sidecar records (§93.15); they reference this
immutable digest by anchor and never alter it.

```text
OwnershipSnapshot = exact{
  snapshotId,executionId,scope,processAuthorities,sessionDigests,
  worktreeDigests,runtimeDigests,branchDigests,leaseDigests,snapshotDigest
}

OwnershipScope = exact{kind,id}
kind="execution|branch|child|effect|parallel_aggregate"
ProcessAuthority = exact{
  pid,pgid,pidStartToken,launchNonceDigest,leaseGeneration,
  ownerExecutionId,ownerBranchId
}
```

Every array is sorted and unique. Each process authority is the exact generation/PID/PGID/PID-start
record from current lifecycle authority; PIDs/PGID/generation are positive safe integers,
`pidStartToken` is bounded non-empty text, and `ownerBranchId` is `BranchId|null`. All other arrays
contain `Digest`s. Process authorities sort uniquely by
`(ownerExecutionId,ownerBranchId|null,leaseGeneration,pgid,pid,pidStartToken,launchNonceDigest)`.
`scope=OwnershipScope`. `snapshotDigest` hashes the complete snapshot excluding
itself; `snapshotId="ownership:"+snapshotDigest`. The cleanup snapshot digest resolves to this
exact immutable record.

Map settlement preserves every member, including partial and late outcomes:

```text
MapSettlement = exact{
  schemaVersion,kind,parentEffectId,generation,members,summary,
  sourceLineageDigest,mapSettlementDigest
}
schemaVersion=1
kind="baton.map_settlement"

MapMemberResult = exact{
  schemaVersion,kind,parentEffectId,index,memberEffectId,generation,dispositions,workProductRefs,
  eligibility,evidenceRefs,sourceLineageDigest,memberResultDigest
}
schemaVersion=1
kind="baton.map_member_result"

MapSummary = exact{
  total,succeeded,failed,cancelled,stopped,notDispatched,ambiguous,
  preserved,retryEligible
}

PartialMapValue = exact{
  schemaVersion,kind,parentEffectId,generation,members,
  sourceLineageDigest,partialDigest
}
schemaVersion=1
kind="baton.partial_map_value"
PartialMapValueMember = exact{
  index,memberEffectId,valueRef,capsuleRef,memberResultDigest
}

ForensicLateResultRecord = exact{
  schemaVersion,kind,anchor,cursor,observedAfterTransitionDigest,
  providerReceiptDigest,artifactRef,capsuleRef,commitRef,routeAttestationDigest,
  workerPolicyAttestationDigest,reasonCode,forensicDigest
}
schemaVersion=1
kind="baton.forensic_late_result_record"

ForensicResultAnchor union(resultKind):
  effect = exact{
    resultKind,resultDigest,effectId,generation,fenceDigest
  } resultKind="effect"
  map_member = exact{
    resultKind,resultDigest,parentEffectId,memberEffectId,index,generation,fenceDigest
  } resultKind="map_member"
  program = exact{
    resultKind,resultDigest,programId,executionId,finalRevisionDigest
  } resultKind="program"

anchor=ForensicResultAnchor
fenceDigest=Digest|null
```

`members` is canonical ordered by integer `index`, which is contiguous from zero and matches the
semantic input array. The six execution counts preserve the exact Phase 84/85 output truth:
`succeeded` is accepted, `failed` is failed, `cancelled` is cancelled, `notDispatched` is
not-dispatched, with `stopped` (selective stop) and `ambiguous` (crash-ambiguous) added by the
Program effect protocol.
`total=succeeded+failed+cancelled+stopped+notDispatched+ambiguous`; `preserved` and `retryEligible`
are independently derived subset counts. Each member's refs and evidence survive
parent failure. `retryEligible` counts only members whose `eligibility.retry.state` is
`eligible|requires_approval`; a retry admits a new member generation/ID and consumes only those
member refs. A succeeded member is ineligible and is never repeated. A `notDispatched` member was
admitted but never reached a provider boundary (superseded by selection, capacity never granted, or
dispatch never approved); it preserves no provider observation and is retry-eligible on a new
prebound generation. A `stopped` member was selectively stopped while active and is preserved with
its durable cleanup. An ambiguous member is `requires_repair` until provider correlation settles or
a separately approved replacement is admitted with a new identity; it is never automatically
repeated.

`PartialMapValue.members` contains only successful schema-valid members, ordered by their original
unique index (gaps are permitted), and each digest/ref MUST equal its `MapMemberResult`. Its
`partialDigest` excludes itself. This is the only value schema permitted by the `partial_collection`
work-product row; it cannot make a failed member disappear from `MapSettlement`.

`MapMemberResult.parentEffectId` MUST equal the containing `MapSettlement.parentEffectId`, and its
`index`, `memberEffectId`, and `generation` MUST equal that member's prebinding. It is immutable and
content-addressed: `memberResultDigest` hashes every field except itself. `MapSettlement` is
immutable and content-addressed: `mapSettlementDigest` hashes the
complete members, summary, and all other fields except itself. Neither embeds late results, so late
arrival cannot rewrite parent or member identity.

A `ForensicLateResultRecord` is append-only trace evidence in a separate sidecar ledger, observed
after cancellation, ambiguity, selective stop, generation replacement, or terminal settlement. It
may preserve exact artifact, capsule, and commit refs, but it never changes a settlement, semantic
revision, work-product, eligibility, selector input, verification verdict, integration state,
learning, or result digest. The `resultKind` discriminator selects one non-overlapping anchor
shape. An `effect` anchor's typed coordinates and `resultDigest` MUST equal one exact
`EffectResult`; a `map_member` anchor's coordinates and `resultDigest` MUST equal one exact
`MapMemberResult.memberResultDigest`; and a `program` anchor's coordinates and `resultDigest` MUST
equal one exact `ProgramResult`. No null placeholder or effect ID is accepted for a Program result,
and no result digest can be reinterpreted under another `resultKind`. `fenceDigest`, when present,
MUST resolve to the admission/join fence containing the anchored effect/member. `resultDigest` is
the already-settled digest it observes and never the digest of a record that embeds it. `cursor` is
a per-anchor non-negative safe integer that strictly
increases as records append and is the only append order. Artifact/capsule/commit refs and
route/worker attestation digests are independently nullable; provider and observed-after-transition
digests are required. `forensicDigest` hashes the record excluding itself. Records within an anchor
sort by `(cursor,forensicDigest)`; across anchors they sort by `forensicDigest`. The sidecar is
trace-only and projects to no semantic field.

The axes remain independent facts, but their valid product is closed by the single exhaustive table
below. There is no second work-product table, disposition-row precedence rule, or prose exception.
The parallel aggregate precedence in §93.11 chooses an execution value before this same table
validates its cross-product; it does not define another valid row. In the table,
`F={failed,cancelled,stopped,ambiguous}`; `Z` means cleanup `not_required|settled` with every
remaining ownership count zero; `O` means cleanup `open|attention` with at least one remaining
ownership count; `C=Z|O`; `V={not_required,pending,passed,candidate_failed,inconclusive,
not_dispatched}`; `NA=not_applicable`; and `I=ineligible`. An owner is an
`EffectResult.effectKind`, a `MemberSettlement.ownerKind` (`parallel_member|map_member`), a
`SettlementEnvelope.ownerKind` (the exact underlying effect kind, `parallel_aggregate`, or
`program`), or `ProgramResult`'s `program`. A `parallel_member` row
validates the member's axes and refs plus the exact evidence, map-settlement, and cleanup facts
reached through its applicable non-null result/terminal-revision digests; required facts cannot be
omitted by projecting them out of `MemberSettlement`. A `parallel_aggregate` row validates the
complete envelope, its aggregate value, its cleanup record, and every embedded member under the
§93.11 reductions. All `WorkProductRefs` not explicitly named in a row MUST be null.

| Profile | Owner | Execution | Verification | Product and exact refs | Cleanup | Selection | Integration |
| --- | --- | --- | --- | --- | --- | --- | --- |
| parallel aggregate succeeded | `parallel_aggregate` | `succeeded` | `V` exactly derived by §93.11 | `value`; `valueRef` only, validating as the exact `baton.parallel_aggregate_value` over all members | `C` exactly derived by §93.11 | `NA` | `NA` |
| parallel aggregate interrupted | `parallel_aggregate` | `F` | `V` exactly derived by §93.11 | `value`; same aggregate-value shape | `C` exactly derived by §93.11 | `NA` | `NA` |
| parallel aggregate not dispatched | `parallel_aggregate` | `not_dispatched` | `V` exactly derived by §93.11 | `value`; same aggregate-value shape | `C` exactly derived by §93.11 | `NA` | `NA` |
| settled value | `call|map|reduce|finish|parallel_member|map_member|program` | `succeeded` | `not_required` | `value`; `valueRef` only, not a `baton.gate_result` | `Z` | `NA|eligible|selected|unresolved` | `NA` |
| gate verdict value | `gate|parallel_member|program` | `succeeded` | `passed|candidate_failed|inconclusive` exactly matching the embedded verdict | `value`; `valueRef` only, validating as the exact `baton.gate_result` | `Z` | `NA` | `NA` |
| unverified Candidate | `call|reduce|finish|parallel_member|map_member|program` | `succeeded` | `not_required|pending` | `candidate`; `candidateRef` plus exactly one matching backing ref | `Z` | `I` | `I` |
| verified Candidate, not selected | `call|reduce|finish|parallel_member|map_member|program` | `succeeded` | `passed` | `candidate`; verified `candidateRef` plus exactly one matching backing ref | `Z` | `I|eligible|unresolved` | `I` |
| verified Candidate, selected | `call|reduce|finish|parallel_member|map_member|program` | `succeeded` | `passed` | `candidate`; verified `candidateRef` plus exactly one matching backing ref | `Z` | `selected` | `I|eligible|approved|integrated|refused|failed_preserved` |
| rejected Candidate | `call|reduce|finish|parallel_member|map_member|program` | `succeeded` | `candidate_failed` | `candidate`; rejected `candidateRef` plus exactly one matching backing ref | `Z` | `I` | `I` |
| inconclusive Candidate | `call|reduce|finish|parallel_member|map_member|program` | `succeeded` | `inconclusive` | `candidate`; inconclusive `candidateRef` plus exactly one matching backing ref | `Z` | `I` | `I` |
| unverified standalone artifact | `call|reduce|finish|parallel_member|map_member|program` | `succeeded` | `not_required|pending` | `artifact`; nonempty mutually consistent standalone subset of `artifactRef|capsuleRef|commitRef`; `candidateRef` null | `Z` | `NA|I` | `NA|I` |
| verified standalone artifact | `call|reduce|finish|parallel_member|map_member|program` | `succeeded` | `passed` | `artifact`; same standalone shape | `Z` | `NA|I|eligible|selected|unresolved` | `NA|I` |
| rejected standalone artifact | `call|reduce|finish|parallel_member|map_member|program` | `succeeded` | `candidate_failed` | `artifact`; same standalone shape | `Z` | `I` | `I` |
| inconclusive standalone artifact | `call|reduce|finish|parallel_member|map_member|program` | `succeeded` | `inconclusive` | `artifact`; same standalone shape | `Z` | `I` | `I` |
| delivered notification | `notify|parallel_member|program` | `succeeded` | `not_required` | `notification`; all refs null and exactly one delivery-receipt evidence ref | `Z` | `NA` | `NA` |
| settled checkpoint | `checkpoint|parallel_member|program` | `succeeded` | `not_required` | `checkpoint`; `checkpointRef` only and its ledger-receipt evidence ref | `Z` | `NA` | `NA` |
| partial map | `map|parallel_member|program` | `F` | `not_required|inconclusive` | `partial_collection`; `valueRef` to the exact `PartialMapValue` and non-null `mapSettlement` | `C` | `I` | `I` |
| interrupted Candidate | `call|reduce|finish|parallel_member|map_member|program` | `F` | `not_required|pending|passed|candidate_failed|inconclusive` | `candidate`; `candidateRef` plus exactly one matching backing ref; state matches verification | `C` | `I` | `I` |
| interrupted standalone artifact | `call|reduce|finish|parallel_member|map_member|program` | `F` | `not_required|pending|passed|candidate_failed|inconclusive` | `artifact`; the standalone shape above | `C` | `I` | `I` |
| interrupted checkpoint | `checkpoint|parallel_member|program` | `F` | `not_required` | `checkpoint`; `checkpointRef` only and its ledger-receipt evidence ref | `C` | `I` | `I` |
| terminal without product | any | `F` | `not_required|pending|inconclusive` | `absent`; all refs null | `C` | `I` | `I` |
| not dispatched | any | `not_dispatched` | `not_dispatched` | `absent`; all refs null and no provider observation | `Z` | `I` | `I` |

These rows partition the valid space by owner, execution, verification, product, and, for the two
verified-Candidate rows, selection. The three `parallel_aggregate` rows additionally partition all
six aggregate execution outcomes and the complete verification/cleanup product; §93.11 supplies
one exact value for every other axis and field. Consequently every all-terminal, selected, and
heterogeneous-member-product settlement matches exactly one row. A value-shaped gate result is
therefore never smuggled into an artifact row; cancelled-before-product and stopped-before-product
truth use the explicit `terminal without product` row; and `not_dispatched` is not a spelling of
cancellation. The validator requires exactly one matching row; zero matches or multiple matches
are `program_result_invalid`. The
`executionCause` rule and `verificationCause` rule above apply to every row without exception. A
row with `O` is preservation-failed custody: all six action eligibilities are `blocked_cleanup`,
and only cleanup/preservation repair is permitted. A row with `Z` has no retained ownership. A
`stopped` result is never automatically retried; a `not_dispatched` result may become retry-
eligible only through a newly approved, prebound generation.

Candidate `verificationState` is exactly `unverified`, `verified`, `rejected`, or `inconclusive`
when verification is respectively `not_required|pending`, `passed`, `candidate_failed`, or
`inconclusive`. When `candidateRef` is non-null, its one top-level backing ref MUST byte-equal the
corresponding embedded Candidate ref; no unrelated ref is permitted. Standalone artifact refs are
mutually consistent and never imply a Candidate. A `PartialMapValue` contains only successful
members but its required `mapSettlement` preserves every member disposition. A commit ref never
grants checkout-write authority.

A `selected` Candidate is necessarily in the verified-selected row. Integration may advance only
for that exact Candidate; `approved` requires a separate integration approval, and `integrated`
requires a settled capability-gated application-registry apply/integrate receipt plus fresh
verification of its exact result. That action is outside the seven-node Program effect grammar.
Selection, integration, and export never repair failed verification.

Eligibility is constrained by axis: `revise` requires a preserved Candidate plus typed feedback;
`reduce` requires a closed typed member collection; `select` requires all selector evidence;
`integrate` requires a selected verified Candidate and fenced integrator; `export` requires settled
cleanup and an exportable artifact/capsule/commit; `retry` requires remaining authority and a new
prebound generation. `not_dispatched` effects are retry-eligible on a new prebound generation. Any
open ownership makes retry/revise/reduce/select/integrate/export `blocked_cleanup`.

Selection/integration cross-fields are exact. `not_applicable|ineligible` makes the corresponding
action eligibility `ineligible` (except an ownership block is `blocked_cleanup`). Selection
`eligible` makes `eligibility.select` `eligible` with the Program approval for a deterministic
approved selector, or `requires_approval` for `operator_selected`; `unresolved` always requires an
operator approval. `selected` makes it `ineligible` with reason `already_selected`. Integration
`eligible` makes `eligibility.integrate` `requires_approval`; `approved` makes it `eligible` with
the exact approval digest; `integrated|refused|failed_preserved` makes it `ineligible` unless
cleanup blocks all actions. No other pairing validates.

A Program result is:

```text
ProgramResult = exact{
  schemaVersion,kind,programId,programDigest,executionId,dispositions,
  workProductRefs,eligibility,resultSchema,evidenceRefs,effectResultDigests,
  finalRevisionDigest,revisionSchemaDigest,stateValueDigest,sourceLineageDigest,
  roleCatalogDigest,policyDigest,approvalDigest,verificationContractDigests,
  routeAttestationDigests,workerPolicyAttestationDigests,cleanup,
  semanticTraceDigest,resultDigest
}
schemaVersion=1
kind="baton.program_result"

ProgramResultProjection = exact{
  schemaVersion,kind,programResultDigest,episodeDigest,
  operationalTraceDigest,projectionDigest
}
schemaVersion=1
kind="baton.program_result_projection"
```

It applies the same orthogonal axes and exhaustive table, validates any `valueRef` against
`resultSchema`, binds every exact effect result and semantic revision, and preserves all
route/service-tier/worker-policy attestations. Its revision-schema, state-value, and source-lineage
digests MUST equal the exact
final semantic revision. A succeeded Program requires zero remaining ownership. A verified Candidate may
still await selection/integration. Completion never means integration, publication, push,
promotion, or semantic correctness. `ProgramResult` is immutable and content-addressed:
`resultDigest` hashes every field except itself. `semanticTraceDigest` is the canonical
barrier/effect/revision projection and is included. Arrival-ordered operational trace and Episode
presentation are not Program-result fields; an immutable `ProgramResultProjection` sidecar binds
them to `programResultDigest`, and `projectionDigest` hashes that projection excluding itself.
Late observations after terminal settlement are append-only `ForensicLateResultRecord` sidecar
records with `resultKind="program"` anchored to `resultDigest`; neither sidecar alters it.

The registered `baton.gate_result` used by `gate` is
`exact{schemaVersion,kind,binding,candidate,contract,frozenVerificationContractDigest,
approvedPlanDigest,nodeKey,nodeTemplateDigest,approvalEvent,
frozenTaskBriefVerificationDigest,verdict,verificationReceipt,resultDigest}` with
`kind="baton.gate_result"`, `binding=GateBinding`, `candidate=CandidateRef|ArtifactRef`,
`contract=VerificationContractRef`, and `verdict="passed|candidate_failed|inconclusive"`.
`contract` MUST byte-equal `binding.verificationContract`, and its `contractDigest` MUST equal
`frozenVerificationContractDigest` and the parsed frozen contract's `contractDigest`. Separately,
`binding.frozenVerificationContract.artifactDigest` MUST authenticate only the complete frozen
artifact bytes; it is never compared to any of those contract digests. Every duplicated coordinate
MUST equal the binding. Its result digest excludes only itself. The `verdict` MUST equal the verdict that the frozen
`expectResult.verdictDerivation` prescribes for the observed verifier exit and frozen-contract
quality-gate state; any other verdict is invalid. The referee's durable receipt MUST bind the same
Candidate by Candidate digest or artifact by artifact digest, approved Plan digest, node key,
node-template digest, approval event, frozen Task Brief verification digest, frozen
verification-contract digest, and verdict. Substitution or
resolving any current/historical head fails authority before verifier effect; it does not yield a
rejected verdict.

## 93.16 Typed feedback, revision, and independent review

A feedback packet remains the Phase 79/80 immutable source-bound packet and MUST bind Program,
execution, exact source/target Candidate, tree, changed paths, anchors, evidence, author route
attestation, role catalog, and packet digest. Revision consumes selected packet IDs and digests,
creates an append-only successor Plan and repeat/child generation, and never edits its predecessor.

```text
FeedbackPacket = exact{
  schemaVersion,kind,feedbackId,programDigest,executionId,sourceCandidate,
  targetCandidate,treeSha,changedPaths,anchors,evidenceRefs,
  authorRouteAttestationDigest,roleCatalogDigest,packetDigest
}
kind="baton.program_feedback"
```

`changedPaths` is set-like by normalized path, `anchors` uses the exact `SourceAnchor` below, and
evidence is set-like by digest. `packetDigest` excludes itself and `feedbackId`;
`feedbackId="feedback:"+packetDigest`. Source and target substitutions fail identity validation.

The revision artifact is exact:

```text
CandidateRevision = exact{
  schemaVersion,kind,revisionId,revisionSchemaDigest,programDigest,executionId,
  predecessorCandidate,predecessorRevisionDigest,selectedFeedbackRefs,
  successorPlanDigest,successorApprovalDigest,repeatRound,childPath,
  resultCandidate,valueDigest,sourceLineageDigest,routeAttestationDigest,
  workerPolicyAttestationDigest,revisionDigest
}
kind="baton.candidate_revision"
FeedbackRef = exact{feedbackId,packetDigest}
```

`revisionSchemaDigest` is the checked-in digest of this exact schema/version. `valueDigest` hashes
the canonical exact `resultCandidate` value. `sourceLineageDigest` hashes the predecessor Candidate,
predecessor revision, selected feedback, source tree, and immutable input refs in canonical digest
order. `selectedFeedbackRefs` is set-like by `packetDigest`; `childPath` is semantic ordered.
`repeatRound` is a non-negative safe integer; `predecessorRevisionDigest` is null only for the
first Candidate revision and a Digest thereafter.
`revisionDigest` hashes every field except itself and `revisionId`;
`revisionId="revision:"+revisionDigest`. A changed feedback set, predecessor, source lineage,
Plan, approval, round, or route creates a new revision identity. Arrival order and operational
trace never participate.

Independent review is incomplete until both conditions are durable:

1. the reviewer route has a different `harnessFamily` and different `modelFamily` from the producer
   route, verified from role-catalog family digests and resolved adapter cards; and
2. the reviewer produces this typed artifact:

```text
ReviewArtifact = exact{
  schemaVersion,kind,reviewId,programDigest,executionId,producerCandidate,
  reviewerRole,producerFamilyDigest,reviewerFamilyDigest,criteriaDigest,
  findings,verdict,evidenceRefs,routeAttestationDigest,
  workerPolicyAttestationDigest,artifactDigest
}
kind="baton.review_artifact"
verdict="approve|request_revision|reject|inconclusive"

Finding = exact{
  findingId,severity,category,messageDigest,anchors,evidenceRefs,disposition
}
severity="blocker|major|minor|note"
disposition="open|resolved|rejected_with_reason"

SourceAnchor = exact{
  artifactDigest,path,startLine,startColumn,endLine,endColumn,symbolDigest
}
```

Line/column coordinates are positive safe integers with the end not before the start; `path` is
normalized repository-relative and `symbolDigest` is `Digest|null`. Findings sort by finding ID;
anchors sort by `(artifactDigest,path,startLine,startColumn,endLine,endColumn,symbolDigest|null)`
and evidence by digest. `artifactDigest` hashes the review excluding itself and `reviewId`;
`reviewId="review:"+artifactDigest`; finding IDs are bounded `SafeId`s. Review prose alone, worker
claims about its route, and same-family review do not satisfy independence. If no independent route
is ready, the Program settles attention before reviewer provider effect. A review artifact informs
revision/selection but cannot replace the deterministic gate or automatically integrate.

## 93.17 Exact lowering of named route families

Templates are pure closed functions from `{objective, roles, manifest}` plus deployment policy to
one `ProgramSource`, role catalog, schemas, approval template, and preview. They add no runtime.

### 93.17.1 `parallel_attempts`

For canonical role order `r[0..n-1]`:

1. create one `call(r[i])`, then one `await(all_terminal)` in each named parallel branch; the
   branch result is the settlement envelope, not a provider value;
2. `parallel(branches, all_terminal)` and `await(all_terminal)`;
3. `collect` by canonical role, preserving every disposition;
4. for each success-eligible envelope, explicitly `select(settlement_value)` to obtain the exact
   Candidate, then run `gate -> await -> select(settlement_value)` using that role's approved
   verification contract;
5. `select` the verified Candidates with the approved selector; and
6. `finish` the selected Candidate and all compared envelopes/evidence.

Non-selected Candidates remain preserved. Active losers are stopped/reaped only after the selector
settles. There is no completion-time winner.

### 93.17.2 `review_revise`

1. producer `call -> await -> select(settlement_value) -> gate -> await ->
   select(settlement_value)`;
2. independent reviewer `call -> await` over exact Candidate, contract criteria, and evidence;
3. validate one `ReviewArtifact`;
4. branch on typed verdict: `approve` proceeds; `request_revision` enters `repeat`;
5. each repeat body proposes a separately approved successor revision Plan from exact Candidate and
   feedback, then `call -> await -> select(settlement_value) -> gate -> await ->
   select(settlement_value)`;
6. deterministic stop conditions are identical Candidate, identical feedback, no verified
   progress, contradiction, verification rejection, stop, or policy exhaustion; and
7. `finish` only a verified Candidate with review evidence; otherwise preserve the typed
   disposition and safe action.

### 93.17.3 `debate_synthesize`

1. parallel debater `call -> await -> select(settlement_value)` branches over the same immutable
   question/context;
2. for each debater output, assign a distinct route-family-independent cross-reviewer and require a
   typed `ReviewArtifact`;
3. `collect` all positions, contradictions, and reviews in role order;
4. synthesizer `reduce -> await -> select(settlement_value)` receives exact immutable refs, not
   summaries alone;
5. `gate -> await -> select(settlement_value)` the synthesized Candidate and gate result;
6. `select` operator/evidence-ranked with ties unresolved; and
7. `finish` without treating agreement as verification.

The template is not advertised unless all producer-review route-family pairs can be resolved
independently before effect.

### 93.17.4 `context_recursive`

1. pure `context` selects and chunks addressed immutable inputs;
2. `map -> await(all_terminal)` creates separately approved map successors and preserves the exact
   per-member settlement envelope;
3. failed units may enter bounded `repeat` with only the failed unit refs and new effect IDs;
4. explicit `select(settlement_value)` extracts each eligible successful member; `reduce -> await
   -> select(settlement_value)` consumes actual validated provider-result capsules in canonical
   unit order;
5. reduce may use the same bounded retry rule for inconclusive/no-work-product outcomes;
6. `gate -> await -> select(settlement_value)` verifies and extracts the exact typed gate result for
   the synthesis Candidate/artifact; and
7. `finish` retains per-output lineage, coverage, retries, and cleanup.

No effectful Context v1 node is embedded.

### 93.17.5 `partition_review_integrate`

1. pure `context` derives collision-checked partitions;
2. writer `map -> await(all_terminal)` uses one immutable base and a private overlay per unit, then
   explicit settlement-value selectors extract only eligible Candidate refs;
3. fresh `gate -> await -> select(settlement_value)` chains verify every produced Candidate;
4. independent route-family reviewers produce typed artifacts for every selected partition;
5. an operator/evidence selector explicitly chooses eligible deltas;
6. one hub-owned generation-fenced integrator `reduce -> await -> select(settlement_value)`
   serially applies selected deltas into a fresh integration Candidate using exact preimages and
   structured conflict results;
7. a fresh `gate -> await -> select(settlement_value)` verifies that exact integration Candidate;
   actual apply/integrate remains a separate capability-gated semantic action; and
8. `finish` proposes it without modifying the caller checkout or promoting it automatically.

Any path collision, ambiguous Git effect, stale preimage, review gap, or integration conflict
preserves inputs and settles attention.

## 93.18 Workspace, ownership, delegation, stop, and recovery

The workspace contract is immutable base plus private overlay plus at most one fenced integrator.
Every writer's tree, base SHA, path scope, branch/worktree authority, process generation, runtime,
and cleanup are distinct and durable. Shared Program state is immutable by `ValueRef`; CAS and the
pure reducer serialize revision updates. Direct concurrent multi-writer checkout access fails
before the second Plan/task/process admission.

All locally launched harness descendants are transitive Baton ownership. This includes process
groups, subprocesses, locally spawned subagents, tool children, verifier children, runtime helpers,
worktrees, branches, sessions, interactions, leases, and integration resources. Baton MUST discover
or conservatively retain their process-group/launch authority and MUST kill/reap the complete local
descendant union. A leader close is insufficient while the group or any separately registered
descendant remains. Program or selective stop settles only after exact zero counts.

Only opaque provider-side delegation outside the local process boundary may be unattested
metadata. It can be recorded solely from native provider protocol observation as:

```text
ProviderDelegationObservation = exact{
  source,observed,providerReceiptDigest,summaryDigest
}
source="provider_native|unavailable"
observed=true|null
```

`provider_native` requires `observed=true` and a non-null provider receipt digest. `unavailable`
requires both null. `summaryDigest` is always a Digest of the normalized native observation or
unavailability record; it never hashes worker prose.

Worker prose, summaries, or self-report can never establish delegation observation. Opaque remote
delegation cannot satisfy route independence, review, gate, process ownership, or grounding. Local
descendants are never downgraded to metadata merely because a harness calls them "agents."

Stop first appends a fence and a snapshot of all descendant ownership, then prevents new branch,
repeat, child, and effect admission. Selective stop snapshots one exact branch/child union; siblings
continue. Late results remain forensic evidence and cannot attach across effect/round/generation.
Restart reconstructs Program state from revisions and effect transitions, applies the §93.12 table,
and finishes cleanup. It never repeats an ambiguous provider, notify, verifier, Git, or integration
effect.

**Issue 5 is a hard live-parallel prerequisite.** No Phase 93 live parallel provider test, rollout,
or "parallel supported" claim is allowed until the repository's issue-5 cross-controller lifecycle
and physical branch/worktree ownership suites are green at the candidate commit and a live
cross-controller proof shows exact active process/worktree/branch authority, controller restart,
one selective stop with sibling survival, whole-Run stop, and zero residue. A failure blocks live
parallel admission; it is not waived by Program fixtures or worker prose.

## 93.19 Atlas and Cairn integration

A `context` payload may address exact manifest branches for repository data, Atlas lexical/AST/CST,
symbol/SCIP, CPG/dataflow/taint, semantic delta, behavior, and graph-backed Representation
artifacts. It preserves tree/environment/overlay identity, producer card, source artifact, reverify
digest, coverage, and R0–R3 grounding. Program IR itself is control data and is not an Atlas R4
representation.

Program transitions and results may project read-only Episode edges such as `produced`,
`derived_from`, `grounded_in`, `contradicted_by`, `verified_by`, `covers`, and `releases`, using
only currently registered Phase 92 edge semantics. They create no new Cairn node/edge type.
Unverified Program values, Context outputs, model prose, consensus, provider delegation, cached
results, checkpoints, and operational events never auto-promote. Existing `causal.promote`,
Scratch observed/derived gates, Representation producer/reverify, correction, and contradiction
authorities remain the only routes.

Knowledge failures cannot delay or reverse stop, kill, terminal settlement, verification,
integration, or publication effects. Program completion does not invoke promotion.

## 93.20 Deployment policy and exact lower-policy bindings

One `baton.program_policy` schema v1 binds the admitted canonical-order, Context, Workflow,
Goal/Plan, capacity, route-card, artifact, and lifecycle authorities by digest. Ordinary callers
and model workers provide none of its numeric fields. This version defines no Program-local
numeric default, ratio, floor, offset, empirically asserted constant, or caller-selectable narrower
value. Every admitted number is either copied from the one exact pre-existing approved lower-policy
field named below or, only for `maxParallelBranches`, is the exact minimum of all named approved
positive operands. Every operand's field name, value, immutable bytes, version, owning-policy/card
digest, and admission provenance is bound by `ProgramPolicy` and its enclosing approval. The route
cards' `card().concurrencyCeiling` fields are the only concurrency-authority operands in that
minimum; Goal/Plan `limits.maxNodes` is a separate structural bound and is never described as
capacity. No other Program-policy arithmetic is permitted.

Its field set is exhaustive:

```text
ProgramPolicy = exact{
  schemaVersion,kind,canonicalOrderPolicyDigest,contextPolicyDigest,
  workflowPolicyDigest,goalPolicyDigest,capacityPolicyDigest,routeCardSetDigest,
  artifactPolicyDigest,lifecyclePolicyDigest,maxProgramBytes,maxProgramNodes,
  maxProgramDepth,maxSchemaDefinitions,maxValueBytes,maxResultBytes,
  maxEvidenceRefs,maxParallelBranches,maxRepeatRounds,maxChildDepth,
  maxEffectInstances,maxJoinMembers,maxJoinComparisons,maxStateRevisions,
  maxTraceBytes,policyDigest
}
schemaVersion=1
kind="baton.program_policy"
```

Every dependency is the exact immutable policy/card version admitted by the enclosing approved
Plan and approval envelope. Preview and admission recompute the following like-for-like bindings;
replay uses the recorded bytes and never re-resolves a newer policy:

| Program field | Exact lower-authority binding |
| --- | --- |
| `maxProgramBytes` | Context Program policy v1 `maxProgramBytes` |
| `maxProgramNodes` | Context Program policy v1 `maxProgramNodes` |
| `maxProgramDepth` | Context Program policy v1 `maxProgramDepth` |
| `maxSchemaDefinitions` | Goal/Plan policy v1 `limits.maxItems` |
| `maxValueBytes` | Context Program policy v1 `maxArtifactBytes` |
| `maxResultBytes` | canonical-order policy v1 `maxReceiptBytes` |
| `maxEvidenceRefs` | Goal/Plan policy v1 `limits.maxItems` |
| `maxParallelBranches` | after every `parallel` proves a nonempty reachable role set, `min(Goal/Plan policy v1 limits.maxNodes, min_role card(role).concurrencyCeiling)` over their union; for a Program with no `parallel`, null; an empty role set is refused rather than valued |
| `maxRepeatRounds` | Workflow policy v1 `maxRounds` |
| `maxChildDepth` | Context Program policy v1 `recursionDepth` |
| `maxEffectInstances` | Goal/Plan policy v1 `limits.maxProviderTurns` |
| `maxJoinMembers` | Context Program policy v1 `maxResultItems` |
| `maxJoinComparisons` | Context Program policy v1 `maxJoinComparisons` |
| `maxStateRevisions` | canonical-order policy v1 `maxEvents` |
| `maxTraceBytes` | Context Program policy v1 `maxArtifactBytes` |

`card(role)` is the exact immutable admitted route card selected after harness/model/effort,
separately authorized service-tier, and worker-policy resolution. Its existing camel-case
`concurrencyCeiling` field is the sole lower-policy concurrency authority. Roles that resolve to
the same card share that card's ceiling; normalization additionally rejects a parallel frontier
whose count for that card exceeds the field. A Program with no `parallel` node carries
`maxParallelBranches=null`, because it consumes no parallel authority. For each `parallel`, the
normalizer computes the set of `call|map|reduce` roles reachable through every branch's static
control and data-dependency closure, including reachable repeat/child bodies. If that set is empty,
normalization and preview refuse `program_parallel_authority_unavailable` before constructing the
parallel node, admitting Program state, or producing any effect; route-free parallelism has no
Program v1 authority. If any role in the set lacks one exact approved positive
`card().concurrencyCeiling`, or its card bytes, version, or digest do not match the frozen route
authority, preview refuses
`program_parallel_authority_unavailable` and the normalizer refuses to construct the parallel
node. The table's `min_role` ranges over the union of all of those proven-nonempty sets. It never
substitutes a capacity-ledger worker count, a private-worktree slot count, Goal/Plan
node count, `max(1,...)`, queued work, worker prose, or a missing-value default as concurrency
authority. Worktree byte/inode admission and worker dispatch still run under their existing lower
authorities, but neither manufactures a Program concurrency number. A later lower-authority
decrease may delay or stop admitted work but cannot rewrite the frozen policy; an increase cannot
widen it.

`artifactPolicyDigest` and `lifecyclePolicyDigest` still bind storage and cleanup enforcement, but
they do not manufacture additional numbers. If any exact lower field is absent, unapproved,
version-mismatched, non-positive where positivity is required, or inconsistent with the referenced
policy digest, preview refuses before Program admission. A different number requires approval of
the lower authority that owns that named field and a successor Program policy/approval; it cannot
be patched into `ProgramPolicy`. Verification `timeoutMs` and `maxOutputBytes` are likewise the
exact fields of the approval-event-frozen `VerificationContract`, bounded by its already approved
Goal/Plan node rather than by a Program constant. Evaluation-only limits belong solely to the
versioned §93.21 evaluation contract and grant no Program runtime authority.

`policyDigest` hashes every Program-policy field except itself. Unknown fields, a value unequal to
its table binding, a non-null parallel value in a serial Program, or a parallel value unequal to
the complete provenance-bound route-card/structural minimum fails before effect. This
removes the former unsupported branch/depth/byte/ref/effect/revision/trace constants while
preserving exact historical replay and the zero-capacity refusal.

## 93.21 Executable four-arm evaluation gate

The evaluation is a checked-in, executable corpus, not a prose aspiration.

### Evaluation plan

The evaluation runs under one closed deployment-owned `EvaluationPlan`, approved once and bound by
a single digest. `phase93-evaluation-v1` is an actual versioned test contract: exactly 24 items,
exactly four arms in the fixed order below, and exactly five paired repetitions create 120 paired
blocks and 480 scheduled arm runs. These are contract constants, not Program defaults. The plan
also freezes ordered route tuples, separate service tier and worker policy, per-arm envelopes, the
toolchain, cache states, the Latin-square assignment, and every crash point. It owns no Program
effect grammar and grants no Program runtime authority.

```text
EvaluationPlan = exact{
  schemaVersion,kind,contractVersion,planId,corpus,arms,repetitionsPerArm,
  pairedBlockCount,runCount,routes,envelopes,toolchain,cache,latinSquare,
  blocks,preflight,authority,pilot,rateLimits,earlyStop,resumeRule,
  cancellation,approvalDigest,planDigest
}
schemaVersion=1
kind="baton.evaluation_plan"
contractVersion="phase93-evaluation-v1"
planId="eval-plan:"+planDigest
arms=["direct","naive_parallel","lossy_episode","program"]
repetitionsPerArm=5
pairedBlockCount=120
runCount=480

EvaluationCorpusRef = exact{kind,contractVersion,artifact,corpusDigest}
kind="baton.evaluation_corpus_ref"
contractVersion="phase93-evaluation-corpus-v1"
artifact=ArtifactRef
corpus=EvaluationCorpusRef

EvaluationRoute = exact{
  order,routeTupleKey,routeRequest,serviceTierRequest,workerPolicyRequest,
  workerPolicyRequestDigest,harnessCardVersion,adapterCardDigest,routeDigest
}
routes=EvaluationRoute[1..approved Goal/Plan policy v1 limits.maxRouteValues]
N=routes.length
order=contiguous non-negative safe integer
routeTupleKey=RouteTupleKey
routeRequest=exact{harness,model,effort}
serviceTierRequest=the exact §93.7 exact|none request
workerPolicyRequest=the exact Phase 92/default schema-v1 request

EvaluationEnvelope = exact{
  arm,inputTokenCeiling,outputTokenCeiling,usdCeiling,
  providerCallCeiling,wallMsCeiling,envelopeDigest
}
envelopes=EvaluationEnvelope[4]
token/provider-call/wall ceilings=positive safe integers
usdCeiling=positive finite deployment currency units

EvaluationToolchain = exact{
  schemaVersion,kind,contractVersion,runnerArtifact,lockfileArtifact,
  runtimeArtifact,harnessCardSetDigest,modelCardSetDigest,toolchainDigest
}
schemaVersion=1
kind="baton.evaluation_toolchain"
contractVersion="phase93-evaluation-toolchain-v1"
runnerArtifact/lockfileArtifact/runtimeArtifact=ArtifactRef
toolchain=EvaluationToolchain

EvaluationCache = exact{
  schemaVersion,kind,contractVersion,namespaceDigest,
  coldStateArtifact,warmStateArtifact,cacheDigest
}
schemaVersion=1
kind="baton.evaluation_cache"
contractVersion="phase93-evaluation-cache-v1"
coldStateArtifact/warmStateArtifact=ArtifactRef
cache=EvaluationCache

LatinSquareSchedule = exact{
  schemaVersion,kind,contractVersion,routeTupleKeys,rows,scheduleDigest
}
schemaVersion=1
kind="baton.evaluation_latin_square"
contractVersion="phase93-evaluation-latin-square-v1"
LatinSquareRow=exact{index,routeTupleKeys,rowDigest}
latinSquare=LatinSquareSchedule
routeTupleKeys=RouteTupleKey[N]
rows=LatinSquareRow[N]

EvaluationBlock = exact{
  taskOrdinal,taskId,repetition,seedDigest,latinRow,cacheMode,cacheArtifactDigest,
  crashPoint,parallelCrashPoints,blockDigest
}
blocks=EvaluationBlock[120]
repetition=1..5
seedDigest/cacheArtifactDigest=Digest
latinRow=non-negative safe integer < N
cacheMode="cold|warm"
crashPoint="none|after_prepared_before_effect_started|after_effect_started_before_ack|after_ack_before_settlement|after_settlement_before_response"
ParallelCrashAssignment=exact{arm,parallelCrashPoint}
parallelCrashPoints=ParallelCrashAssignment[4] in the byte-identical order of arms
arm="direct|naive_parallel|lossy_episode|program"; each arm occurs exactly once
parallelCrashPoint="none|after_sibling_admission|before_join_settlement"

preflight = exact{
  minRouteFamilies,requiredGreenContracts,rangeChecks
}
rangeChecks = exact{
  tokenHeadroomBasisPoints,wallHeadroomBasisPoints,
  usdHeadroomBasisPoints,providerCallHeadroomBasisPoints
}

authority = exact{
  totalInputTokens,totalOutputTokens,totalUsd,totalProviderCalls,totalWallMs
}

pilot = exact{pairedBlocks,pilotGate}; pairedBlocks=positive safe integer <=120
pilotGate = exact{minUtilityLiftBasisPoints,maxDuplicateAmbiguousBasisPoints}

rateLimits = semantic ordered exact{routeTupleKey,perMinute,concurrencyCeiling}[routes.length]

earlyStop = exact{kind,futility}
kind="futility_on_paired_utility|none"
futility = exact{minPairedBlocks,utilityFloorBasisPoints}; minPairedBlocks=positive safe integer <=120

resumeRule = exact{strategy}
strategy="from_complete_paired_blocks_only"

cancellation = exact{reap,crashAmbiguous}
reap = exact{selectiveStop,wholeRunStop,zeroResidueRequired}
crashAmbiguous = exact{neverRepeat,preserveDisposition}
```

`corpus.artifact` bytes MUST parse canonically as the exact versioned corpus below; its
`ArtifactRef.artifactDigest` authenticates artifact bytes and is never compared to
`corpusDigest`, which authenticates the corpus object excluding only its own digest. `routes` are
ordered by contiguous `order`; their `routeTupleKey` values are byte-unique, and `routeDigest`
hashes its complete route excluding itself. Each `routeTupleKey` is the opaque canonical lower-
authority route-tuple string and MUST byte-equal `RouteAttestation.resolved.routeKey` for every run
using that EvaluationRoute. It is neither a `SafeId` nor an alias derived by the evaluation. Every
requested harness/model/effort tuple, exact-or-none service tier, worker-policy request/digest,
harness-card version, and adapter-card digest is therefore fixed before any run. Resolution or
observation may only attest that exact route; a missing route invalidates the block and cannot be
substituted.

`envelopes` are in the byte-identical order of `arms`, name each arm exactly once, and each digest
excludes itself. Their input-token, output-token, USD, and wall ceilings MUST be equal across all
four arms. Provider-call ceilings are fixed per arm, with `naive_parallel` exactly equal to
`program`; no arm may borrow unused authority from another. `authority` is the hard aggregate of
those already approved envelope ceilings: each total is the exact sum of its four matching
envelope fields and cannot be an independent widening value.

Each toolchain artifact is immutable and revalidated in its artifact digest domain; the semantic
`toolchainDigest` hashes the complete toolchain contract excluding itself. The cache contract
likewise binds exact immutable empty/cold and prewarmed states under one namespace, and
`cacheDigest` hashes the complete cache contract excluding itself. Every block's
`cacheArtifactDigest` MUST equal the artifact digest selected by its `cacheMode`; ambient provider,
harness, repository, or OS caches are disabled or make preflight fail.

`latinSquare.routeTupleKeys` MUST byte-equal `routes[*].routeTupleKey` projected in order. It
contains exactly `N` rows for `N` routes; every row's `routeTupleKeys` is a permutation of those
same unique opaque strings, and every column contains each string exactly once. No Latin field may
contain a `SafeId` alias or a reserialized tuple. `blocks` contains exactly one row for every
`(taskOrdinal 0..23,repetition 1..5)`,
and `latinRow` selects the precommitted row used by all four arms in that paired block. Every
`blockDigest` and every Latin-row `rowDigest` excludes its own field; `scheduleDigest` hashes the
complete Latin-square contract excluding itself. Repetition crash points are exact: 1 is `none`, 2 is
`after_prepared_before_effect_started`, 3 is `after_effect_started_before_ack`, 4 is
`after_ack_before_settlement`, and 5 is `after_settlement_before_response`. Each block's four
`parallelCrashPoints` name every arm exactly once in fixed arm order, so an injection can never
leak from one arm to another. For each `(taskOrdinal,arm)` with no parallel boundary, all five
repetitions require `parallelCrashPoint="none"`. Where that task/arm has a parallel boundary, the
five precommitted assignments MUST cover each non-`none` point supported by
`phase93-evaluation-crash-v1` (`after_sibling_admission` and `before_join_settlement`) at least
once; the remaining assignments are precommitted `none` or a supported point. Adding, removing, or
weakening that applicable-point coverage requires successor crash-schedule and evaluation contract
versions. There is no
runtime rotation or scheduler-selected injection. The
schedule digest, block digests, cache state, routes, envelopes, and toolchain all participate in
`planDigest`.

`preflight.rangeChecks` are headroom basis points (0..10000) verified against the corpus and route
inventory before any arm runs; the run refuses `evaluation_preflight_failed` if any measured range
falls below its headroom, if fewer than `minRouteFamilies` route families are ready, if an exact
route card lacks positive headroom under its approved `concurrencyCeiling`, if existing worktree
byte/inode admission refuses the complete next paired block, or if any `requiredGreenContracts`
entry is not green at the candidate commit. The plan defines no worker-slot or private-worktree-
slot count and cannot replace either lower authority. `authority` is the hard total
token/USD/provider-call/wall ceiling for the whole evaluation; the runner stops the evaluation when
any ceiling is reached and records which ceiling bound it. `pilot` runs `pairedBlocks` paired
blocks first and gates the full run on `pilotGate`; the pilot itself resumes only from complete
paired blocks. `rateLimits` has the same length and `routeTupleKey` order as `routes`; each positive
`perMinute` value is the exact approved provider rate contract for that route, and
`concurrencyCeiling` MUST equal the exact positive integer in its admitted route
card. Neither is a plan-authored widening. The runner paces and queues within both and never
exceeds the route's native limit. `earlyStop` declares one named
futility rule (or `none`) computed only from complete paired blocks. `cancellation.reap` requires
that a selective stop, a whole-run stop, and zero-residue cleanup all be demonstrated within the
run. `cancellation.crashAmbiguous` requires that an ambiguous provider/Git/verifier effect is never
repeated and is preserved as the exact §93.15 `ambiguous` disposition. `resumeRule.strategy` is the
only resume strategy: the evaluation resumes exclusively from complete paired blocks, replaying
settled effects under their exact durable transition digests and never re-running an ambiguous or
already-settled effect. `approvalDigest` binds the one concise approval; `planDigest` hashes the
plan excluding itself and `planId`. Pilot and early stop may halt execution but never redefine the
120-block/480-run schedule or produce a qualifying default-routing decision; such a run publishes
an explicit incomplete result. A wider authority, changed route/order/envelope/toolchain/cache/
schedule, different corpus, or relaxed resume/rate/crash rule requires a successor plan. A new arm,
different repetition count, or different item count requires a successor evaluation contract
version, not merely a successor plan.

### Corpus

`impl/fixtures/phase93-eval/corpus.json` will contain this exact object:

```text
EvaluationCorpus = exact{
  schemaVersion,kind,contractVersion,items,corpusDigest
}
schemaVersion=1
kind="baton.evaluation_corpus"
contractVersion="phase93-evaluation-corpus-v1"
items=EvaluationTask[24]

EvaluationTask = exact{
  taskOrdinal,taskId,category,repoTree,objective,contextManifest,resultSchema,
  verificationContract,groundTruth,repetitionSeedDigests,crashSchedule
}
repetitionSeedDigests=Digest[5]
crashSchedule=exact{contractVersion,scheduleDigest}
contractVersion="phase93-evaluation-crash-v1"
```

The 24 immutable task manifests comprise:

- six repository localization tasks requiring Atlas AST/CPG evidence;
- six multi-file change tasks with deterministic fresh-sandbox verification;
- six defect-review tasks with seeded authority/replay/lifecycle faults; and
- six context synthesis tasks with at least one seeded contradiction.

`taskOrdinal` is contiguous 0..23, items are canonical in that order, and `category` has exactly six
members in each named category above. `repoTree`, contract, schemas, and ground truth are
content-addressed. `corpusDigest` hashes the complete corpus excluding itself. Tasks are selected
before approval and cannot be reordered or replaced after seeing results. Each task's
`crashSchedule.scheduleDigest` MUST equal the digest of its five exact projected block crash rows;
each block's `seedDigest` MUST equal that task's digest at `repetition-1`. The corpus and plan
therefore bind seeds and crash schedule independently, and mismatch fails preflight.

### Arms and repetitions

Each task runs five paired repetitions per arm, 480 runs total:

1. **direct** — one agent, full addressed context, one result, one gate;
2. **naive_parallel** — the same number of provider calls as arm 4, independent responses
   concatenated in canonical role order, one gate;
3. **lossy_episode** — bounded workers receive lossy summaries without exact item lineage, then one
   synthesis and gate;
4. **program** — the specified `context -> map -> await -> select(settlement_value) -> reduce ->
   await -> select(settlement_value) -> gate -> await -> select(settlement_value)` Program with
   exact lineage, typed review where applicable, and deterministic joins.

Repetition seeds are fixed in the corpus. Each arm consumes the same block row and therefore the
same ordered exact route inventory, model versions, effort, separately authorized service tier,
worker policy, immutable tree, verification contract, toolchain, cache artifact, and Latin-square
row. Its authority is exactly its ordered plan envelope. A missing route, changed ordering,
unattested toolchain, ambient cache, or envelope mismatch makes the paired block invalid; none is
substituted. The `program` arm cannot spend more provider calls than the byte-matched
`naive_parallel` allowance.

### Crash injection

The precommitted block rows assign repetitions 2–5 one crash at respectively:

- after `prepared` before `effect_started`;
- after `effect_started` before provider acknowledgement;
- after provider acknowledgement before settlement; and
- after settlement before caller response.

For each task and arm, its `parallelCrashPoints` entry precommits either no additional injection,
after sibling admission, or before join settlement. Arms without a parallel boundary always carry
`none`; applicable arms satisfy the versioned five-repetition coverage rule above. The runner
performs exactly the entry addressed to that arm; it does not rotate, copy an injection to a sibling
arm, or choose at runtime. Every injection restarts from the same durable ledger and records
duplicate effects and residue. Ambiguous effects are never repeated.

### Metrics and utility

Per task/repetition the runner records:

```text
gatePass, groundTruthRecall, unsupportedClaimRate, contradictionRetention,
routeAdherence, serviceTierAdherence, workerPolicyAdherence,
duplicateAmbiguousEffects, recoveryConverged, zeroOwnership,
wallMs, providerCalls, inputTokens, outputTokens, usd
```

All rates are in `[0,1]`. Let `costRatio` and `wallRatio` be capped at 2 and normalized against the
direct paired run. Exact utility is:

```text
U =
  0.30*gatePass
+ 0.15*groundTruthRecall
+ 0.10*(1-unsupportedClaimRate)
+ 0.10*contradictionRetention
+ 0.10*routeAdherence
+ 0.05*serviceTierAdherence
+ 0.05*workerPolicyAdherence
+ 0.05*recoveryConverged
+ 0.05*zeroOwnership
- 0.025*costRatio
- 0.025*wallRatio
- 0.20*min(1,duplicateAmbiguousEffects)
```

Artifacts include the corpus/runner digests, Program bytes, normalized policies, role catalogs,
approval envelopes, route/service-tier/worker-policy attestations, transitions, revisions, effect
results, verifier receipts, review artifacts, Atlas refs, metrics JSONL, paired analysis, process
ownership snapshots, and cleanup receipts. Raw secrets and provider reasoning are excluded.

The Program arm is eligible for default routing for a category only when all of these hold:

1. 100% exact route/service-tier/worker-policy adherence;
2. zero repeated ambiguous effects;
3. 100% zero-ownership settlement and issue-5 prerequisite satisfaction;
4. gate pass rate is not below the best other arm by more than 0.02;
5. the paired mean utility improvement over the best other arm is at least 0.05; and
6. the two-sided 95% paired bootstrap confidence interval (10,000 resamples, fixed seed
   `phase93-eval-v1`) has lower bound greater than zero.

Otherwise the category remains direct/non-Program by default. Results are published even when the
Program loses. No arm outcome weakens correctness, approval, or lifecycle rules.

## 93.22 Agent experience and transport parity

The planned direct surface is:

```js
const draft = baton.program(objective, { strategy, roles });
const preview = await draft.preview();
const program = await draft.start();
await program.approve();

program.outline();
program.steps();
program.workstreams();
await program.result();
program.episode();
program.trace();
await program.stop();
program.help();
```

`start()` appends the immutable Program and Run shell but causes no provider effect.
`approve()` invokes distinct approval authority and then allows the runtime to recommend eligible
actions. The progressive handle exposes only logical identities by default. `outline` summarizes
objective/state/attention/cleanup/next action; `steps` expands nodes and branch states;
`workstreams` exposes role/generation handles; `result`, `episode`, and `trace` progressively
expand exact refs; `episode` and arrival-ordered trace resolve the immutable
`ProgramResultProjection` sidecar and never rewrite `ProgramResult`; `stop` fences and reaps;
`help` is state-relative.

One frozen application registry owns these semantic operations:

```text
program.preview          observe
program.start            control + observe
program.inspect          observe
program.act              action-derived capability + observe
program.stop             emergency_stop + observe
application.help         observe
```

`program.act` has the closed action kinds:

```text
approve_program select_result retry_effect repair_runtime revise_result reduce_result
apply_result integrate_result export_result notify_workstream stop_workstream resume_child
```

Actions accept semantic inputs only: reason/message/delivery or an advertised candidate/action
choice. Program/node/effect/task/worker/process/worktree/fence/receipt/route/budget/ceiling
coordinates are server-derived. Each action descriptor binds registry digest, Program state
revision, required capabilities, input schema, authority digest, and idempotency scope, and is
re-resolved immediately before effect.

`revise_result`, `reduce_result`, `select_result`, `integrate_result`, and `export_result` are
advertised only when the exact §93.15 eligibility says so. `apply_result` and `integrate_result`
both consume `eligibility.integrate` and require the explicit `program.integrate` capability,
current repository-write authority, the
selected verified Candidate digest, a separately approved integration Plan/action, and the sole
generation-fenced integrator. They append a separately registered semantic-action event and invoke
the existing integration authority; they do not add an eighth Program effect node. They never
follow automatically from selection, approval, consensus, completion, or a worker request.
`export_result` cannot imply apply, push, publish, promote, or integrate.

Direct API, CLI (`baton program preview|start|approve|act|show|steps|workstreams|result|episode|trace|stop|help`),
authenticated Web JSON, browser controls, and MCP tools are generated from that one registry.
Equivalent requests normalize to identical command, Program, action, and result digests. Web and
MCP reauthorize current principal/repository/session before admission, before effect, and on
replay. The browser calls authenticated Web; it has no private authority. Disconnect never stops a
Program. Pagination/cursors are digest-bound, bounded, and resume without changing meaning.

No surface is advertised until its registry entry, authorization, recovery, help closure, and
direct/CLI/Web/browser/MCP parity tests are green.

## 93.23 Red suites

Implementation starts with these exact red suites:

1. `phase93a-source-schema-red.test.mjs`: every allowed/unknown/missing field and discriminator;
   duplicate-key/Unicode/number/array rejection; zero effects on invalid input.
2. `phase93a-canonical-identity-red.test.mjs`: ID-excluded hashes, dependency-sensitive IDs,
   duplicate-node coalescing, cycle/collision refusal, canonical Kahn order, JCS vectors, and
   byte-identical raw/Python/TypeScript fixtures.
3. `phase93a-schema-values-red.test.mjs`: every schema form, closed object/union validation,
   recursive/external-ref refusal, no coercion, durable ValueRef tamper/missing bytes.
4. `phase93a-control-grammar-red.test.mjs`: every control node, PortRef type mismatch, every
   predicate/join/selector, split control/data cycles and dominance, demand-evaluation effect
   refusal, static effect ownership, branch/sequence/repeat/child bounds, all three exact handle
   schemas, settlement-only await, explicit success extraction, derived-only Context/collect
   output schemas, caller-schema substitution refusal, and deterministic join permutations.
5. `phase93a-context-purity-red.test.mjs`: pure operations accepted; legacy
   map/reduce/review/verify and unknown operations rejected before effect; historical replay stable;
   explicit migration receives a new identity.
6. `phase93b-state-reducer-red.test.mjs`: branch-local PCs/stacks/rounds, pending/settled sets,
   immutable per-branch revision/CAS, schema/value/source-lineage digests, arrival-order operational
   revisions excluded from identity, canonical barrier permutations, admission/join fences,
   reducer purity, repeat/child ancestry, and tamper.
7. `phase93b-effect-protocol-red.test.mjs`: deterministic effect IDs; every five-phase crash point;
   prebinding without input/result value digests; parent/member map identity and partial retry;
   response loss; no repeat after effect start; acknowledgement
   attachment; `resultKind`-discriminated EffectResult/MapMemberResult/ProgramResult forensic
   sidecar anchors; cleanup convergence.
8. `phase93c-effect-schema-red.test.mjs`: exhaustive call/map/reduce/gate/notify/checkpoint/finish
   fields and ports; gate raw-command/argv/cwd/env rejection; approval-event-bound frozen
   verification-contract bytes and frozen Task Brief verification (including `expectResult`),
   separate artifact/contract/Task-Brief-verification/Candidate digest domains with only like-to-like
   comparisons, binding equality to Candidate/Plan commitments, complete verdict-to-`expectResult`
   mapping, no current-state resolution, and historical/current-head substitution refusal.
9. `phase93c-route-policy-red.test.mjs`: exact harness/model/effort; separate service-tier
   exact/none null rules; immutable template bytes/approved content refs; nullable provider
   observation; worker-policy request/resolution/observation digests through transitions/results/
   replay; mismatch reap.
10. `phase93c-result-disposition-red.test.mjs`: every orthogonal execution (incl. `stopped`/
    `not_dispatched`)/verification/work-product/cleanup/selection/integration value through every
    row of the one exhaustive table, plus every invalid cross-product and row-overlap assertion;
    execution and verification causes; `parallel_member`/`map_member`/`parallel_aggregate` owner
    binding; deterministic parallel ambiguity/failure/cancellation/stopped/not-dispatched
    precedence and selection-stopped handling; aggregate verification/cause, canonical all-member
    value/refs, cleanup, selection/integration, eligibility, every all-terminal and heterogeneous
    member-product cross-product; product-only work-product states; gate-result-as-value and
    artifact/capsule/commit consistency;
    retry/revise/reduce/select/integrate/export eligibility; partial map members; preservation-failed
    custody and open ownership; forensic late-result sidecar records; explicit capability-gated
    apply/integrate; completion requires zero.
11. `phase93c-review-revision-red.test.mjs`: typed packets/revisions, revision schema/value/source-
    lineage digests, both-family independence, typed ReviewArtifact, same-family/prose substitution
    refusal, recursive successor bounds.
12. `phase93d-workspace-ownership-red.test.mjs`: immutable base/private overlays, one fenced
    integrator, direct second-writer pre-effect refusal, transitive local descendants, leader-close
    insufficiency, selective kill, restart, zero residue.
13. `phase93d-issue5-prerequisite-red.test.mjs`: live-parallel admission blocked unless exact
    cross-controller process/worktree/branch ownership evidence is current and green.
14. `phase93e-strategy-lowering-red.test.mjs`: byte-pinned graphs for all five route families,
    explicit awaits/joins, loser preservation, retry identities, conflict behavior, no consensus.
15. `phase93e-atlas-cairn-red.test.mjs`: exact AST/CPG/Representation refs and reverify; no new rung,
    graph type, auto-promotion, or knowledge effect in stop/terminal paths.
16. `phase93e-surface-parity-red.test.mjs`: start/preview/approval/handle/outline/steps/workstreams/
    result/episode/trace/stop/help and the closed revise/reduce/select/apply/integrate/export action
    set from one registry across every transport.
17. `phase93e-policy-red.test.mjs`: every exact lower-policy field binding, exact route-card
    `concurrencyCeiling`, shared-card frontier counting, serial null, missing/mismatched parallel-
    authority refusal, empty reachable `call|map|reduce` role-set refusal before state/effect, exact
    provenance-bound structural/route-card minimum, removal of invented worker/worktree slot
    operands and unsupported constants, historical policy stability, and no caller numeric knobs.
18. `phase93f-evaluation-red.test.mjs`: closed deployment-owned `EvaluationPlan` (preflight ranges
    and refusal, total token/USD/provider-call/wall authority, one approval, pilot paired blocks,
    per-route rate-limit scheduling, early stop, cancellation/reap, crash-ambiguous never-repeat, and
    resume only from complete paired blocks); fixed four-arm order × five repetitions × 24-task
    corpus, 120 blocks/480 runs, unique opaque canonical route-tuple keys byte-equal to resolved
    route attestations, ordered route/service-tier/worker-policy tuples, exact arm envelopes, pinned
    toolchain/cache artifacts, valid precommitted Latin square, arm-addressed exact crash rows with
    applicable versioned parallel-point coverage, metric formula, artifacts, incomplete/losing-
    result publication, and confidence rule.
19. Retain cross-phase CK8/CK9, RC2/RC3, RR recovery races, D4/D6 verifier freshness, Phase 88 route
    substitution, Phase 91 response loss, Phase 92 facade/reap, writer-lease release, issue-5
    cross-controller lifecycle, and full process-group descendant reap suites.

## 93.24 Ordered build sequence

Each slice requires source audit, the named reds, implementation, adversarial review, focused
validation, full validation, and a status update that distinguishes fixture from live proof.

1. **93A — canonical pure core:** schemas, source/canonical Program, raw/Python/TypeScript builders,
   normalization, hashing, topo order, pure Context gate, and preview. No effect dispatch.
2. **93B — durable state machine:** Program admission, immutable revisions, branch PCs/stacks,
   parallel/await/join, repeat/child counters, pure reducer, and replay.
3. **93C — effect authority:** five-phase protocol; call/map/reduce; separately approved gate;
   notify/checkpoint/finish; route/service-tier/worker-policy attestations; typed results, feedback,
   review, and revision.
4. **93D — workspace and lifecycle:** immutable bases, private overlays, fenced integrator,
   transitive descendant ownership, selective stop/reap, restart convergence, and issue-5 gate.
5. **93E — templates and product surface:** five exact lowerings, Atlas/Cairn projection,
   deployment formulas, one registry, progressive handle, and all transport parity.
6. **93F — evaluation and live acceptance:** execute the four-arm corpus; publish the decision;
   then run Baton-on-Baton only for eligible categories.

No later slice may claim an earlier contract from design alone.

## 93.25 Migration

1. Historical `baton.context_program` v1, cells, Context effects/calls/units, Workflow definitions,
   role catalogs, Plans, events, and IDs replay byte-for-byte under their original schemas.
2. Pure Context v1 may be embedded only after the §93.10 proof and receives a containing Program
   identity; its historical cell identity remains merely an input/ref.
3. Effectful Context v1 is replay-only. Explicit compilation creates a new Program identity and
   crosswalk artifact.
4. Workflow role-catalog v1 can seed a v2 proposal only by retaining its exact catalog/template
   bytes as migration evidence, copying the exact route tuple, compiling raw verification into a
   separately approved contract ref, and adding separately approved service-tier and worker-policy
   authority. The v2 template receives a new digest; v1 is never rewritten or claimed identical.
5. Historical tasks lacking service-tier or worker-policy observation retain null/unavailable
   legacy truth. Migration never fabricates provider observation.
6. Existing Context map/reduce successor Plans remain historical effects. Program recovery may
   attach them only through an explicit, integrity-checked migration receipt; it cannot dispatch
   them as though their effect IDs had existed.
7. Approval expansion always creates a successor envelope. Program/schema/policy meaning changes
   create a new digest. No bulk ledger rewrite is required.
8. Until 93E transport parity is green, Program surfaces are unadvertised. Until 93F and issue 5
   are green, live parallel Program support and default routing are unclaimed.

## 93.26 Live Baton-on-Baton acceptance

The final acceptance is not a fixture. From one clean committed candidate, Baton runs a real
multi-harness Program that:

1. uses at least two exact route families concurrently with provider-native requested/resolved/
   observed harness/model/effort truth, separately authorized service tier, and worker-policy
   attestations;
2. exercises `context -> map -> await -> select(settlement_value) -> reduce -> await ->
   select(settlement_value) -> gate -> await -> select(settlement_value)`, actual AST/CPG Context
   refs, typed per-output lineage, a typed independent review artifact, and one bounded
   revision/retry;
3. proves overlapping native process lifetimes only after the issue-5 prerequisite;
4. kills one active branch and proves sibling survival;
5. crashes/restarts once after effect start and once after provider acknowledgement, with no
   ambiguous repeat and exact settled attachment;
6. preserves every Candidate disposition and requires explicit selection/integration;
7. stops the complete Program and proves all local descendant PIDs/process groups, provider
   sessions, worktrees, branches, runtimes, interactions, and leases absent; and
8. records opaque provider-side delegation only when natively observed and never counts it as
   verification.

The committed evidence includes Program/corpus/policy/catalog/approval digests, transitions,
revisions, route and worker-policy attestations, gate/review artifacts, process authorities,
selective-stop receipt, restart reconciliation, final zero-ownership receipt, exact verification
command result, and the candidate commit. Readiness, fixture adapters, worker prose, or one harness
cannot substitute.

Phase 93 is shipped only after 93A–93F, independent review, the live acceptance above, and the
repository's required verification are green. Authoring this specification alone leaves Phase 93
planned.
