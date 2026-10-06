# Native semantic context implementation specification

Status: implementation authorized under Root110. The requirements are
[Native semantic context](semantic-context-feature.md) and the Root81
[language scope amendment](semantic-context-language-scope.md), including
Root83/84's project detection and selective package-loading requirement. Bend2 is the
first target. The amendment withdraws whole-feature and language-boundary
acceptance of `8a26bc3e7f9d5355b72f1291d95620b218b5c8e2`. Prior reviews and
provider evidence retain their original scope. Root has compared this revised
scope with the feature requirement and authorized the useful Bend2-first native
implementation. Existing owners proceed with source changes and settle callable
interfaces directly in their tight Ensembles. Independent critics assess
substantive contracts, changed behavior and unresolved defects. Unchanged material
retains its review; partial edits require no further Root authorization or repeated
final-pin reconciliation. Real laws, safety and ownership rules, remote execution
and accurate external facts remain required.

The frontend source examined for this revision is Bend 2.0.25. Provider versions
and runtime dependencies belong to individual module declarations. Node 22.15.0
remains the floor of the retained Node adapter profile. All compiler, syntax,
build, fixture and test execution remains assigned to admitted remote runners.

The approved control references are structural proposal
`2543678035631371a6f024a1c58ac9ec16239c12` and direct-start proposal
`95bfccf0acefa151a667fa40a5f1fdfedafc5a80`. Root authorized their bounded
implementation; actual composed source, artifacts and host behavior retain their
qualification gates. Stable read composition
`e2e06950d1ccf6a61d66ac0eb2f623fbbb3eb2d7` supplies the separately reviewed
read/discovery scope on `98fbfe03`, excluding provisional receive runtime.
Its bounded composition acceptance leaves root full checks, landing and installed
cold discovery open. `semantic-controls-next` and the registered interfaces
owner retain their respective module and shared-surface ownership. These scoped
references support the common conventions and retain their bounded evidence.

## Supported scope

Baton2 queries external target software through trusted installed modules and
returns facts with source or runtime evidence. Code's primary implementation
Section owns the Bend2 frontend integration. It must provide useful definitions,
resolved references and imports, checker/type context and source-bound
diagnostics through ordinary native queries. Runtime/debug projections require
separate evidence from an actual Bend2 backend.

Elixir, Rust, Go, Python and TypeScript are preferred targets after Bend2. Each
extends the same declaration, request, effect, result and reference contracts.
Their readiness is independently qualified. Language names in this document are
module targets; shared admission and result consumers resolve installed
declarations without language-specific branches.

The following retained provider profiles describe optional module candidates.
Their detailed requirements below apply when that profile is selected. They
preserve existing source and research limits; they establish no Bend2 or
whole-feature qualification.

| Engine | Supported subjects and useful results | Provider |
| --- | --- | --- |
| `typescript` | TS/JS definitions, types, references, calls, dependencies, flow diagnostics, throw/catch structure, constant-SQL code accesses | TypeScript 5.9.3 language service and public compiler API |
| `clangd` | C/C++ definitions, references, types, calls and diagnostics | external LLVM clangd 20.1.8, LSP |
| `clang-analyzer` | C handler types, direct calls, diagnostics, discovered guard/deny/effect relationships, CFG and source-bound constant-SQL SQLite joins; explicit model-scoped predicate queries | LLVM Clang 20.1.8 AST/CFG extraction and analyzer plist, with the fixed Fossil literal-helper summary and SQLite catalog provider for the combined query |
| `cdp` | owned Node program, generated/original frames, scopes, values, exceptions and worker state | Node inspector; adapter implements CDP framing and source-map decoding |
| `sqlite-schema` | entities, columns, keys, constraints and constant-SQL opened objects | fixed Node read-only provider for entity/TS queries; native linked SQLite planner for the C handler composition |
| `postgres-schema` | PostgreSQL entities, relationships, constraints and admitted constant-SQL plans | external psql 14.18 and PostgreSQL 14.18; other versions require qualification |
| `data-model` | SQLite migration state/drift; JSON Schema validation; Zod validation/serialization linked to resolved model use | SQLite, Ajv 8.17.1, Zod 4.3.6, TypeScript resolver |
| `environment` | Node dependency declarations and disk resolution, effective TS configuration, C build configuration and declared service topology | data readers, TypeScript configuration API, fixed version probes |
| `json-dataset` | document structure, selected values and explicit key relationships | JSON parser and SQLite json1 with fixed queries |

Each module declares its supported code, framework, security, data and runtime
capabilities. Missing capability answers identify the selected module, requested
projection, actual cause and available native discovery/configuration action.
Useful Bend2 results are required for feature acceptance. Existing TS/C/C++
facts qualify their own optional profiles. Elixir/Phoenix/Ash qualification must
preserve applicable framework, model and policy relationships with their own
source evidence. Other modules can be declared through the same boundary.

The runtime report demonstrates CDP on Node 25.8.0. Node 22.15.0 runtime behavior
is an implementation acceptance requirement. Native LLDB target creation failed
with SIGBUS across the three installed builds before an inferior existed;
`--no-dependents` established static symbols only. No native C runtime support
is claimed. Static exception propagation across calls is unavailable; source
throw/catch structure and observed CDP exception frames have the separate
meanings specified below.

Baton2 coordination telemetry and task scheduling retain their existing commands.
Context uses query results and runtime-session records in the existing database.
Module declarations reside in the installed package manifest and its existing
configuration. Providers compute from admitted target inputs.

## Installed module contract

This section specifies a proposed typed boundary. Its logical records require
concrete Bend exports, operative laws and host qualification. Current hardcoded
engine readers do not implement it.

```text
ModuleDeclaration = {
  version, id, revision, protocolVersion,
  packageIdentity, entry: Native{artifact, exportIdentity} | Process{artifact, argv},
  dependencies: [Artifact],
  operations: [Operation], applicability: [SelectorRule]
}
Artifact = {packagePath, sha256, role}
Operation = {
  id, subjectSchema, optionsSchema, projections,
  effects, execution: pure | direct | managed | runtime,
  resultSchema, referenceSchema, eventSchema,
  lifetimeProfile: optional RuntimeLifetimeProfile,
  dependencies: [ModuleOperationRef]
}
ModuleOperationRef = {module, declarationDigest, operation}
ModuleBinding = {id, revision, declarationDigest, protocolVersion,
                 operation, artifactIdentities, schemaIdentities}
```

The baseline contains common native policy and lightweight trusted descriptions.
Provider implementation artifacts and their compiler/LSP/debugger/framework
dependencies are separately installable. A module's own artifact may use ordinary
static Bend imports, typed declarations, composition and operative laws. Shared
validation, selection, effect admission and result/ref algorithms consume the
descriptions without a language case. Adding a module adds its description and
selected package members; unused implementation code stays outside the baseline
executable and its loaded dependency closure.

The proposed physical invocation boundary uses the existing owned process
adapters. A Native entry is a separately compiled module executable whose
statically composed export handles the common invocation frame. A Process entry
names a packaged interpreter/backend entry vector. Neither requires dynamic
symbol loading in the coordinator. Direct operations use a one-shot child;
stateful operations use the existing managed role/custody path. An already owned,
compatible selected host may execute several pure operations without another
child per function. Pure common policy runs directly in the baseline. Concrete
entry exports and reuse operations remain Native/Code implementation handoffs;
no current package or host export is claimed by these logical signatures.

`version` identifies the declaration schema. The package inventory binds its
canonical bytes, entry, schemas and dependency closure. IDs are unique nonempty
literal strings in that installed set. Conflicting IDs or unsupported declaration
or protocol versions refuse admission. The selected declaration digest, operation
and resolved artifacts become immutable query input. A digest supplied by a
request does not install or authenticate a module. The existing package admission
and configured executable authority supplies that trust.

For a Process entry, `argv` is a package-authored vector over admitted artifact
paths. Inputs
travel in the existing request channel. Request fields cannot replace an entry,
interpreter, schema or effect declaration. External compiler/debugger dependencies
must be explicitly selected by existing installation configuration and qualified
by identity and capability; target files cannot promote an executable to trusted
provider status. A request-local executable remains target execution under its
required grant.

Subject, options, result, reference and event schemas are typed declaration data
consumed by shared native validation. The initial schema vocabulary is closed
records, tagged unions, arrays, literal enums, optional fields, dictionaries,
local named recursive definitions and the existing scalar types.
It reuses the strict raw JSON, duplicate-key and Unicode boundary below. Numeric
request fields retain the supported U32 profile; wider or noninteger provider
values use explicitly typed exact text fields until a separately reviewed codec
extension exists. Schema recursion, ambiguity and defaults need deterministic
validation; unsupported schema forms refuse before provider invocation. Schema
validation cannot execute provider code. Each record rejects undeclared fields.
Adding a language-specific subject or option shape consists of a declaration
using this vocabulary; it does not add a language case to the validator.

A dictionary explicitly declares its scalar-text key policy and value schema;
it admits arbitrary keys only at that declared data position. Common authority
records remain closed. Local schema references resolve within the authenticated
description, with no external fetch or executable validator. Recursive references
must consume an object member or array element on each cycle; unguarded schema
cycles refuse. Validation visits the finite supplied value without truncating it.
Allocation or validation failure retains its actual condition.

The reusable `json-value` profile is a structural sum of null, Boolean, scalar
text, exact JSON number token, array of values and object members with scalar
keys. Number and text remain distinct kinds: `1e400` is a number token, while
`"1e400"` is text. Duplicate decoded object keys refuse in this normalized
profile; raw source evidence remains separately available. The result schema
selects this profile for complete dataset/model values. It preserves number
tokens, sign and exponent without converting through U32 or JS Number. Env/tool
maps use declared dictionaries. Neither profile expands the public request's
numeric authority domain. These shared schema forms and their exact transport
are proposed Codec work, with actual end-to-end qualification still required.

Common lifecycle/control and reference envelopes remain native-owned. Modules
declare their source/data subject shapes and projections within that envelope.
The existing subject table below supplies reusable schemas and retained profile
examples. Runtime and query-control operations preserve their native ownership
checks. An explicit engine selector names a declared module; `auto` records the
selection inputs, applicable candidates, enabled configuration and final binding.

Applicability rules are declarative checks over admitted project paths, manifest
identities, subject shape and requested projections. Evaluating them loads no
project code. Project configuration can select or disable installed modules; it
cannot install declarations or expand their grants. Explicit selection must be
enabled and compatible. Auto selects only a unique compatible candidate after
configured preference is applied; ties return candidates through the ordinary
refusal. An availability failure does not silently select a different module.
Selection covers the primary subject and the related facts requested. Mixed
projects may select several module operations in one dependency plan. Every edge
retains its own producer and source binding. Recognition reads admitted manifests,
configuration and examined source; executable configuration requires a separately
admitted effect before its results can influence selection. The recorded selected
binding survives replay and package upgrades. An unavailable
old binding remains explicit; recovery cannot substitute a newly installed module.

An operation's declared effects conservatively cover its complete dependency
plan. The core resolves dependency declarations, validates their identities and
schemas, rejects cycles and computes the common operation's mandatory effect
minimum union the declared additions across every step. A module cannot erase
that minimum by declaring an empty effect set. Unknown fundamental operations or
effect meanings require common-contract review. The core checks this union before target effects
start. Conditional effectful suboperations require an independently admitted
query or an already granted declared plan. Module-provided facts cannot grant
another effect. New effect classes require shared effect-contract review; new
languages using existing classes do not. Existing source reads, target execution,
SQL planning/replay and runtime control/evaluation retain their precise meanings.

Activation verifies only the selected implementation and dependency closure under
the existing package authority, then uses the existing process/lifecycle
boundary and a versioned frame containing the query, owner, selected ModuleBinding,
canonical request,
admitted input identities and granted operation plan. Result and event frames
echo that binding and the original query/role/incarnation identity. The core
validates both the common envelope and the selected declared schema before
publication. Raw compiler/provider streams remain evidence with their actual
completion. Pure baseline results retain invocation and evidence binding without
fabricating a child outcome. A returned capability or claimed producer
cannot widen the admitted
binding. Protocol corruption retains failure and cleanup responsibility.

The common module transport uses one closed version-2 protocol. Invocation is
`{version:2,query,owner,moduleBinding,request,inputIdentities,operationPlan,role,incarnation}`.
Request is the validated canonical request value; input identities and operation
plan are the trusted admitted values. Role/incarnation are both null for a direct
invocation, or both identify its retained managed role. Native still records the
actual direct child/launch identity; null is not permission to lose that evidence.
Event/result is
`{version:2,query,owner,moduleBinding,runtime,role,incarnation,sequence,type,payload}`.
Sequence is canonical unsigned decimal text, monotone within the qualified
invocation or retained role. Runtime is nullable; unsolicited query-null events
are allowed only for a retained runtime under its authenticated original binding.
The native observer resolves that binding and producing operation from admitted
state, then compares the frame before committing any state, cursor, result or
notice. Query, owner, module/operation, role and incarnation must all agree with
that association, including query-null runtime events. The echoed text does not
authenticate itself.
Type is `accepted`, `complete`, `failed` or `state`; each payload uses its selected
declared schema within the common outcome rules.

Direct and managed bridges use this same envelope. Private compiler/CDP/backend
protocols sit behind the selected bridge and cannot bypass the envelope's identity
or effect checks. A binding mismatch fails publication and preserves actual
received bytes, possible effects and cleanup responsibility. The older version-1
adapter literals are historical candidate protocols. They require an explicit
bridge/version migration before new-module admission; recovery keeps the protocol
of its original accepted invocation. No existing provider is silently enabled by
these proposed version-2 shapes.

Normalized facts and relations retain producer binding, language semantics,
snapshot, evidence and classification. Module-specific detail is validated by
the selected result schema with an explicit module namespace and schema version.
Unknown extension meaning remains labelled; it cannot become a common semantic
claim merely because its shape validates. Common readers expose these fields without switching
on language names. Cross-module joins require recorded compatible source/runtime
identities and an admitted dependency operation with evidence for each edge.
Ref expansion loads the original stored selector, producer operation, policy
association and schema binding, then performs the common snapshot/effect checks.
A caller-supplied operation or module ID cannot replace that retained association.
Unavailable modules preserve readable historical results while new expansion
reports its exact unavailable dependency.

Result payload representation preserves the numeric and text domains admitted by
its versioned schema through validation, storage, replay and ref expansion. Raw
number tokens or a qualified exact-value representation may carry large, signed,
fractional or exponent values; authority-bearing fields still pass their native
domain checks. Unsupported conversion returns an explicit limitation or refusal.
It cannot round a value, silently apply the request U32 domain to every payload,
or publish an unvalidated authority field. Codec's current raw-token retention
does not establish a qualified end-to-end payload path.

Missing provider execution availability alone does not make a retained result's
source stale. Applicability follows its actual recorded inputs and revalidation
capability; historical readable facts and presently unavailable expansion remain
separate outcomes.

Ref admission takes the expected original query/ref key independently of the
authenticated lookup. Qualified absence, unreadable attribution, unestablished
legacy association and found association remain distinct outcomes. A found ref
binds its producing step to the original retained plan. Serving uses an exact
frozen selected binding; re-resolving a module name cannot replace that identity.
Original/current selector, operation and result compatibility requires admitted
evidence tied to both complete bindings. Equal effect sets alone establish no
semantic compatibility. Required grants preserve authenticated historical
effective requirements, union current common minima and declared additions.
Require requested projections to be a subset of both stored limits and effective
current support; losing an unused historical projection need not refuse a still
supported request. Negotiated capabilities can only narrow declared support.
The pure decision is submitted for atomic retention; invocation binds the verified
retained winner and qualified current authority. Classification of newly produced
facts occurs after their evidence exists.

### Detection, acquisition and resource ownership

Descriptions include recognition rules, schemas, capabilities, package identity
and dependency declarations as trusted data. Discovery does not import an entry,
invoke its discovery command, probe its tools or initialize its libraries.
Applicability, installed-byte presence, verified closure, observed readiness and
qualification are separate fields. A retained probe can be reported with its
identity and observation age; it cannot prove current readiness. A query performs
any required selected-module readiness check after admission.

Ordinary queries automatically activate available admitted modules. Missing
selected bytes return the exact package/dependency and an ordinary native
resolution request. Detection before preparation returns validationRefusal without
a query row; detection after accepted admission produces a retained failed
operation. Preparation or admission uncertainty keeps its original reconciliation
and cleanup duties. The missing bytes alone do not determine the outcome class.
The proposed request uses the existing context query surface:
subject `{kind:"module-resolution",module,intent:"inspect"}` or
`{kind:"module-resolution",module,intent:"install",expected:{query,id}}`, with
`select:["state"]`, engine omitted/`auto` and options empty. Module is the literal
trusted description ID. Native dispatches this common control branch before
language-provider selection. Inspect resolves description and installed inventory
without retrieval or provider activation. It returns a retained selection ref;
install requires that exact inspect query/ref in `expected`. Native authenticates
its association and compares its declaration, complete package/schema closure,
project/configuration inputs and intended installation policy with current trusted
authority before acquisition. Changed selection refuses with a fresh-inspect
remedy. An expected ref supplies comparison data, never trust or grants. Inspect
may additionally name `origin:{query,id}` to resolve the exact original binding of
a historical ref; it cannot substitute the current same-name package/schema.
Install requires the proposed common effect `installProvider` and qualified
installation authority for its pinned source, destination, installer and integrity
policy. Reviewed release-building permissions do not establish that installed
authority. Target configuration supplies no package URL,
installer command or trust root. The native result includes the literal query
needed to resolve the missing selected package; agents need no private scripts.

This operation and effect are implementation obligations owned jointly by Native's
package, Core/Codec/Lifecycle owners and sole Interfaces. Owners supply the actual
callable exports and identify any missing primitive to its consuming owner.
Their implementation must call the actual package acquisition/staging/verification
entry and retain its process/effect receipt through existing query custody. If
that entry or authority is unavailable, refusal identifies the missing owned
primitive. Metadata success cannot count as installed resolution. Acquisition is
separate from the original analysis query. After success, fresh analysis uses a
new query ID if the earlier analysis has a retained rejected, failed, interrupted
or completed result. Its old ID continues to replay the immutable outcome. A
validation refusal before preparation and without a row keeps its ordinary
re-entry rules. Missing a row alone does not establish that precondition.

Inspect uses common native admission/result retention without a language child.
Its completed result is the closed native variant
`{kind:"moduleResolution",producer,module,intent,selection,installation,readiness,refs,refFormat,remedies}`.
Producer is the admitted common native operation binding. Selection identifies
the exact retained inspect ref and its authenticated inputs; installation and
readiness retain their distinct observed state/evidence. Refs use the versioned
contract below. Install returns this same state variant with its actual retained
publication evidence; historical success is separate from a later observation
that destination bytes are absent or changed. Neither replay nor that later
observation repeats installation or rewrites its historical outcome.

Install is a retained managed one-shot operation with original starter/adapter,
prepared/admit/grant ordering, query-control, owner-stop and notice duties. The
installer's recorded keeper and observer retain uncertain response, publication
and cleanup responsibility after public caller loss. ValidationRefusal before
preparation has no row; committed admissionRejected retains its immutable row
and cleanup. HostPreparationFailed and admissionUncertain reconcile their original
preparation, binding and closure. An unknown outcome or a new query ID cannot
authorize another installer. Further effects require qualified reconciliation of
the original attempt and separate applicable authority. Inspecting uncertainty
supplies no evidence that an earlier effect did not happen.

Discovery and inspect expose `remedies`, an array of closed
`{request,queryIdentity,cli,mcp}` templates. Request is a complete schema-valid
context request, including the expected ref when required; queryIdentity is
`{kind:"fresh"}` or `{kind:"original",query}`.
CLI identifies `context-query-file` and its literal owner/selected query/stdin
mapping; MCP identifies `baton2_context_query` and the matching query/request
arguments. Fresh IDs are supplied by the caller under the common uniqueness rule.
Templates keep that parameter explicit and carry the request data separately
from argv and condition text. Missing-dependency/ambiguous-selection refusals
retain their closed error shape and navigate to passive scoped discovery/inspect,
where the schema-valid template is available. Original-preparation recovery
continues to use the caller's original request. An absent primitive reports its
actual limitation; a template is no claim that its callable is implemented.

The existing explicit engine selector resolves a one-query ambiguity. Persistent
selection uses the proposed native subject
`{kind:"module-resolution",module,intent:"configure",expected:{query,id},selection:{enabled,preference}}`,
where enabled is Boolean and preference is `preferred|ordinary`. Engine/options/
select follow the same native control branch. Expected names an inspect ref for
this exact project/configuration and module. Inspect supplies the current
selection in its state and configure remedy. Configuration changes only that
trusted project's module selection entry; it cannot choose a configuration file,
installer or executable from request data. Native compares the expected config
identity and current authenticated write authority before an atomic conditional
update; mismatch returns fresh inspect navigation. Multiple preferred compatible
modules still produce explicit ambiguity.

Configure requires the proposed common `configureModules` effect and actual
project-configuration write authority. It uses retained managed one-shot custody,
the same four admission outcomes and immutable historical replay. Its result uses
the native moduleResolution state variant. Expected-state comparison and effect
completion need the actual config owner's primitive: a SQLite transaction alone
cannot make an external-file compare/write atomic. The exact callable and both
new effect meanings require direct Package/Core/Codec/Lifecycle/Interfaces
agreement and substantive independent review of changed contracts. Target
execution and package installation grants do not implicitly grant configuration
changes. An unknown
apply outcome returns to its original retained operation for reconciliation;
active queries and old results retain their original admitted configuration.
Pre-preparation refusal creates no query row. A committed admission rejection
and an admitted failed resolution retain their existing distinct result semantics.

Package installation uses independently owned staging and publishes only a
verified immutable selected closure through conflict-checked publication. Partial
staging cannot be reported installed. Concurrent publication and cleanup preserve
another live owner's bytes and holds. Failure and unknown completion preserve
original artifacts, error and cleanup responsibility; recovery reconciles the
original operation without repeating an uncertain effect.
Package-manager scripts or target-controlled hooks retain their actual effects
and cannot execute under metadata inspection. No implicit network download occurs
while parsing a declaration, expanding a source ref or answering discovery.

Compatible resource reuse binds module/artifact/schema identity, project inputs,
configuration, policy and actual backend session isolation. Sharing a process
does not merge project state or reference identities. Each project/query retains
its owned references and release duties. Releasing one owner leaves other live
owners and their processes intact. A package present for another project may
remain on disk; an unrelated query neither loads nor probes it. Changed project
inputs update selection and applicability while old accepted duties retain their
original bindings. Actual table/holder and retained owner primitives remain
required for this behavior.

Live provider sharing is a proposed extension to the detailed single-owner role
protocol below. Until an actual holder/custodian mapping is qualified, invocations
retain independently owned processes; verified package files may still be shared.
A shareable host has one stable physical custodian and incarnation with its actual
keeper/observer, plus distinct authenticated logical holders for each query.
Borrower release or owner stop releases only that borrower's hold and settles its
pending response/notice duties. It supplies no direct signal authority over the
shared host. Final physical disposal is serialized with acquisition: a concurrent
borrower either obtains a live hold before disposal or observes closing/unavailable
and takes a separately admitted path. Stale release cannot affect a replacement
incarnation at the same path/PID. Target-process ownership remains independent of
host reuse; shared package bytes alone provide no live-session custody. Native
Lifecycle/Instance and Controls must supply this exact mapping before advertising
shared live resources, retaining all unresolved holders and notices after loss.

## Bend2 frontend integration

The pinned Root source artifacts are `bend-v2.0.25-main.ts` (SHA256
`92dcdb49e82fd59443e3aea10784f7dcf03a93f5a21920666543098b657b6b1e`)
and `bend-v2.0.25-kernel.ts` (SHA256
`93c2a43deeb82c15683e4e25bbc5dec5ac3edff9f54e09acc0975e290fcaeb85`).
These identities bind the source assessment, not a completed provider run.
The module must pin the complete frontend, ownership checker, Base and foreign
dependency closure before qualification.

`main.ts` imports `bend.ts` and `comp.ts`. Its `book_read` calls `book_load`,
`book_valid` and `Comp.book_owned(book, Comp.SYNTH)`, then rejects remaining
holes/open terms. It also enforces the PROOF/LAWS import rule when the sibling
LAWS file exists. These are validity-changing gates. The `--check-only` branch
calls that path and `cli_report`;
`--checkup` additionally runs imported programs and is outside read-only checking.
`cli_report` records definitions relying on unsafe or foreign code. A successful
check must retain that qualification with each derived law/type claim. The
retained kernel filename supplies the inspected frontend source; matching its
exports does not authenticate the full installed compiler distribution. Code's
source investigation has not supplied the pinned `comp.ts` or a qualified Base
closure. Main's private `book_read` is not an exported query API. Importing Main
also registers its JS loader; use a reviewed frontend bridge. A qualified check
invocation disables telemetry with `BEND_NO_TELEMETRY=1` and explicitly controls
import/cache behavior.

The inspected kernel exports `Book`, `Def`, `Span`, `Err`, `book_load`,
`parse_book`, `book_valid`, `term_infer`, `term_check`, `term_show` and `err_show`.
Definitions carry declared types, bodies, order and foreign/unsafe markers.
`book_valid` reveals declarations in order and throws the first error; a failed
check supplies no completed-check claim for the whole book. Law declaration and
fill are separate order events. Dependent terms and binder quantities retain
their compiler meaning. A reference edge or declared signature alone is not a
completed proof or a runtime call observation.

Quantity facts preserve `None`, `Lone` and `Many`, binder identity, kind and
demand. In the inspected source the unmarked allowance is at most once;
sequential and alternative uses compose differently. A law declaration and its
fill are distinct ordered events for one identity. Ordinary duplicate definitions
are parser errors; the final definition map is not a last-definition-wins model.
`term_infer` needs its actual checker context and supplies no context-free hover
API. Declared signature, inferred type and normalized display retain distinct
status. Missing proof/holes can produce Main's plain-text incomplete-proof error;
a malformed proof can produce structured `Err`. Preserve the original form and
completed phase, including useful independently established parse/import facts.

A failed mutated Book does not export a trustworthy checked-prefix length.
Presence in `tlds` or a nonempty `Def.e` does not establish that the current
event completed: insertion and stubs can precede failure, and reused Books can
retain prior annotations. Checked partial facts require fresh-run event
start/success/failure evidence; otherwise publish only the supported parse and
diagnostic observations. The checker also supplies no retained per-binder usage
table after scope deletion. Declared quantity remains useful; observed checked
usage requires actual instrumentation. A second fill of an already filled law
is a duplicate-declaration parse error. Error spans and structured Err fields
are optional; preserve absent locations and the original diagnostic.

`book_load` resolves Base, aliases, real file identity, package imports and
cycles. Missing package imports can fetch from `BEND_HUB` and write `BEND_LIB`.
The semantic read module must therefore use an admitted, captured import closure
and an integration that refuses uncaptured resolution before fetching or writing.
Direct reuse of the loader with an ambient cache cannot establish a read-only
snapshot. Preserve source bytes, namespace/alias decisions, dependency failures
and exact Base/frontend identities. Import-line removal before parsing also
requires an explicit original-source span mapping. `Span.src/beg/end` are
frontend positions in source strings; byte and public coordinate conversion
must be checked against the original bytes, including Unicode and CRLF.

The initial useful module operations resolve a declaration at a source selector,
expand resolved references/imports, expose its declared and actually checked type
context, and return original checker diagnostics with their source locations.
An internal extractor may consume the pinned frontend structures and record
normalization evidence. Public CLI text alone does not expose a qualified AST,
complete reference index or arbitrary expression-hover API. Exact extractor
exports and complete input capture are implementation deliverables owned by Code.

Internal parse/check events require reviewed hooks in this same pinned frontend
and an identified derived artifact with semantic-equivalence qualification.
Outer-call wrappers establish whole-call events only. A parse-produced Var may
represent a successful bound lookup or a deferred unbound spelling; its numeric
index alone is not a resolved declaration. Retain owning declaration, scope,
lookup/fallback branch, environment and checker phase. Printed HTerm types use
the frontend's term_lower conversion before term_show, retaining display context;
structured type facts need no forced string rendering. Def has no declaration
span, so declaration locations need qualified position instrumentation. Optional
Term/Err spans require original source provenance; identical source text in two
files cannot supply file identity by itself. Capture full file digests, resolver
attempt/state and package/store identities. A hub hash-prefix argument or a
populated cache alone supplies no consumed-byte or integrity proof.

Call-like term applications can be reported only with their resolved callee and
static scope; higher-order/dynamic targets retain uncertainty. CFG, exception
propagation, proof dependency completeness and debugger frames/values require
their own backend evidence. No Bend2 debugger or LSP/DAP endpoint is established
by the inspected files. Discovery must describe those gaps while returning the
useful frontend results above. Protocol adapters may use LSP/DAP where an actual
declared provider supports the requested capability.

The initial remote qualification uses real Baton2 Bend2 source and an independently
selected external Bend2 package with imports, definitions and operative laws.
It compares native query results with exact source and the admitted checker,
including an invalid binder/use, failed import, changed dependency, missing proof,
unsafe/foreign dependency and a valid checked law. Original diagnostics and
completed checker outcomes remain separate from extractor-derived relationships.
The actual source targets and extractor mapping require Code and independent
Quality review before those capabilities are advertised.

Code's concrete initial subjects at `8a26bc3e` are
`bend2/src/json/uint-decoder.bend::append_digit`,
`bend2/src/json/laws.bend::m5_canonical_null_is_itself` and
`bend2/src/host/files.bend::Files.find_suffix`. They exercise quantity-aware types, an actual
declaration/fill and canonical import reference, and an IO/foreign-body assumption.
These are proposed subject choices with source evidence, not observed successful
queries. Derivatives changing proof, declaration order, quantity and imported
bytes must retain the positive original and isolate their intended refusal.

## Native surfaces

```text
baton2 DATABASE context-engines [--session SESSION] [--pretty]
baton2 DATABASE context-query SESSION QUERY_ID REQUEST_JSON
baton2 DATABASE context-query-file SESSION QUERY_ID PATH
baton2 DATABASE context-result QUERY_ID [--pretty]
```

`context-engines` returns `{engines, runtimes}`. An engine entry has `engine`,
`provider`, `version`, `executable`, `projections`, `effects`, `availability`,
`limits` and its trusted description/schema identities. It exposes admitted
subject/option shapes and operation-specific readiness through the same native
surface. Availability is `available`, `unavailable` or `excluded`.
Applicability is separately `applicable`, `inapplicable`, `ambiguous` or
`unknown`, with its inspected inputs. Installation is `present`, `missing` or
`unverified`. Readiness is `unknown`, `ready` or `failed`, with the actual retained
observation and binding when one exists. An unprobed provider stays unknown;
the legacy aggregate availability field cannot imply a completed probe.
Failed probes remain visible. Runtime rows name owner, origin attempt if any,
state, pending query IDs and the next observe/release operation. Managed one-shot
query progress is retrieved through `context-result`; its returned state names
the ordinary query-control route. This command
reads descriptions, retained observations and coordination state. It invokes no
provider or tool probe. Declared capability, observed readiness and qualified support
are reported separately. Missing module dependencies retain their actual cause.
Unscoped discovery reads no target files. With `--session SESSION`, it uses that
session's recorded workspace and admitted configuration to report applicable
modules, selectors and a useful query example. This scoped mode reads only the
declared configuration/path inputs needed by applicability rules and records their
identities. It does not evaluate target configuration or start a debuggee. Missing
workspace or required configuration returns its exact unavailable condition.
The optional flag and matching MCP scope are proposed shared-surface changes for
Interfaces review. They require no separate discovery service.

For owner-bearing queries and scoped discovery, the requesting SESSION must exist
and be active. Unscoped discovery requires no SESSION. The release exception for a
stopped owner is defined in Runtime contract. Its recorded workspace supplies
omitted `cwd`; a session without a workspace supplies `cwd`. The CLI uses the
trusted-local declared identity convention. MCP obtains SESSION from its
attachment; it does not infer an identity from a request body. Query identities
are unique across the coordination database. `context-result` follows the
trusted-local database read convention: any caller with access to this
coordination database may read a retained query. It has no requester argument
and establishes no owner-only read boundary. MCP result lookup uses the same
rule. Control effects separately require the recorded owner identity.

MCP tools are `baton2_context_engines`, `baton2_context_query` and
`baton2_context_result`. Discovery accepts optional `scope:"session"`; omission
requests unscoped discovery. Session scope obtains the session from the MCP
attachment and maps to the native flag. Query arguments are `{query, request}` with `request`
a JSON object. The context codec extracts the request from the original frame
bytes and forwards its canonical text to the native command's file input
(`PATH -`) through stdin. Omission is preserved. Both surfaces call the same native validator and return the same
result schema. Success is one JSON document, exit 0. New-family refusals,
including unknown identity, use exit 2 and `{error, command, condition, next}`.
MCP sets `isError` and places that JSON in text content. Refusals echo identifying
fields only; bodies, expressions, environments and connection credentials never
appear in refusal text.

The shared native orientation function places an applicable context discovery/query example
in receive and direct-turn briefings. Conductor adapter orientation and MCP
initialize instructions use the same content. Help names selectors, effects,
ref expansion, result retrieval and failed-provider remedies. Context adds its
commands to existing command/help/MCP registration points. Its examples come from
the enabled declarations and recorded target context. A Bend2 task receives a
Bend2 example when that module is configured. The agent can discover supported
selectors, option schemas, effects and missing prerequisites without learning a
backend-specific command sequence. MCP's common request envelope admits module
IDs and declaration-validated options through the native validator; its schema
must not enumerate the historical provider list.

## Request contract

All objects are closed: unknown fields refuse before provider startup. The
schema version is exactly 1. Paths resolve relative to `cwd`, then become
absolute real paths with the requested spelling retained in evidence. Source
coordinates use zero-based lines and UTF-16 columns; adapters convert provider
coordinates, including byte columns, against the recorded source bytes. The
security declaration uses explicitly named byte offsets for exact AST ranges.

```json
{
  "version": 1,
  "engine": "bend2",
  "subject": {"kind":"position","path":"src/handler.bend","line":40,"column":17},
  "select": ["definition","type","dependencies","diagnostics"],
  "cwd": "/work/application",
  "options": {},
  "effects": []
}
```

`select` is a nonempty set of projections from the selected declaration;
undeclared or duplicate projections refuse. `engine` defaults to `auto`. Auto
uses the declaration-driven selection rule above; ambiguity returns candidates.
`options` and `effects` default to empty. Explicit engine selection remains
available when an extension or provider is ambiguous.

Selecting one engine binds its declared operation and dependency plan. The
following is the retained optional C profile: a C source query with `authorization` or
`databaseAccesses` selects `clang-analyzer`, whose database join uses
`sqlite-schema`. The same request returns types, resolved calls, diagnostics,
guard relations and schema access over shared source identities. It does not
require separate TS and C queries. C `flow` also selects `clang-analyzer`;
ordinary C/C++ language-service projections select `clangd`. Unsupported C++
analysis requests report their explicit scope. Conflicting subject/options
combinations refuse before provider effects. Each other module provides its own
declared subject/projection compatibility; this C routing rule belongs to its
profile and does not enter shared selection code.

| Subject | Exact additional fields | Projections |
| --- | --- | --- |
| `position` | `path`, `line`, `column` | `definition`, `type`, `references`, `calls`, `callers`, `dependencies`, `diagnostics`, `flow`, `exceptions`, `databaseAccesses`, `authorization` |
| `symbol` | `path`, `name`; optional `container` | same source projections; ambiguous symbol returns candidate position refs |
| `diagnostic` | `path`, `line`, `column`, `code` | `diagnostics`, `definition`, `flow`, `exceptions` |
| `entity` | `database`; optional `schema`, `name` | `entities`, `columns`, `relationships`, `constraints`, `codeAccesses`, `columnOrigins` |
| `model` | `module`, `export`, `sample`; optional `code` | `validation`, `serialization`, `codeAccesses` |
| `schema` | `path`, `sample`; optional `resources` (array of paths) | `validation`, `structure` |
| `security` | `declaration:{path,sha256}`, `requirementId` | `declaration`, `guardPaths`, `inputPaths`, `predicateQueries` |
| `migration` | `database`, `chain`, `applied` | `migrations`, `constraints` |
| `program` | `path` | `dependencies`, `toolchain`, `build`, `configuration`, `services` |
| `dataset` | `path`, `pointer`; optional `join` | `structure`, `value`, `relationships` |
| `runtime` | intent-specific fields below | `state`, `frames`, `scopes`, `values`, `exception`, `threads` |
| `query-control` | `query`, `intent:"recover"|"release"`; release also requires `signal:"SIGTERM"|"SIGKILL"` | `state` |
| `ref` | `query`, `id` | projections admitted by the stored referenced selector |
| `module-resolution` | `module`; `inspect` with optional `origin` ref, `install` with required `expected` ref, or `configure` with required `expected` and closed `selection` | `state`; native control admission and separate package/config authority described above |

The retained catalog profile's `database` is `{engine:"sqlite-schema",path}` or
`{engine:"postgres-schema",connectionFile}`. The latter is an explicitly supplied libpq service file with one selected
section `[baton_context]`, stored outside returned facts. The adapter sets
`PGSERVICEFILE` to that absolute file, `PGSERVICE=baton_context`, and invokes the
selected absolute `psql -X -w -d service=baton_context`. Required certificate/key
paths are explicit target connection inputs; a default password-file lookup is
disabled by private HOME and an explicit empty private PGPASSFILE. No ambient PG*
variables, `.psqlrc`, password file or service file is inherited. Connection
identity in results has engine, server version, database and role, with endpoint
credential fields omitted. Password-bearing connection strings never enter argv.

The retained TS/C source profile's `options` admits `project` (config path), `readRoots` (array
of admitted dependency/config roots), `database`, `client` (position selector for
the expected database-client declaration), `buildProvenance` (build receipt path
for the C helper join), `security` (defined below), and
`analysis` (`cfg` or `predicate`, with `predicate` requiring existing source query sites).
Entity `codeAccesses` requires `options.code` (source position/symbol) and
`options.client` for its TypeScript source join. TypeScript `databaseAccesses`
requires `database` and `client`. Its compiler resolves actual call bindings
to that declaration. C `databaseAccesses` requires `database` with
engine `sqlite-schema`; the producer discovers supported calls using the
packaged body-bound helper summary. It requires no caller-supplied client or
security declaration. `options.client` on this C profile refuses as an
incompatible option. C `options.project` names the existing compile-command
database; generated inputs must already exist and their read closure must be
admitted. `options.buildProvenance` supplies the existing build receipt for
original/generated inputs and declared build/link association. Its bytes
and resolved artifacts enter the snapshot. Actual resolved declarations and
parsed helper definitions must agree with the admitted compiler inputs and
reviewed helper summary. Missing source correspondence or an inconsistent
declared association leaves the helper join unavailable; historical executable
contribution may remain `implementationLinkUnverified` while the source-modeled
access is returned. A fresh installation has no
hidden target-capture registration. The schema is defined under Code projections.
A read query performs no build.

For C `authorization`, the ordinary source position/symbol selects the function
or containing function. The producer discovers evaluated guards, resolved
operands, denial returns and relationships to direct effect calls. Optional
`options.security` adds declared domain roles or a selected predicate query;
its absence does not suppress the discovered source facts. A single supported
request is:

```json
{"version":1,"engine":"clang-analyzer","subject":{"kind":"symbol","path":"src/report.c","name":"view_list"},"select":["type","calls","diagnostics","authorization","databaseAccesses"],"options":{"project":"compile_commands.json","readRoots":["src","bld","/admitted/sdk"],"buildProvenance":"build-receipt.json","database":{"engine":"sqlite-schema","path":"owned.fossil"}},"effects":["planTargetSql"]}
```

Paths in this example resolve within the supplied/recorded workspace except the
explicit SDK root. The compile database identifies the authentic generated
translation unit and frontend options. The producer resolves the selected
original function to the unique matching generated AST body under the capture
rules. Ambiguous or changed correspondence refuses that joined mapping. Returned
refs select the discovered calls, guard operands, branch relations, actual callee
parameter types and catalog entities for ordinary `ref` queries.

The `code` field on a model is a source position/symbol selecting its importing
handler. The TypeScript resolver links calls/imports to the selected module
export. The caller supplies its role as a model; the resolved identity and
observed model behavior have their own evidence.

`effects` is a set drawn from `executeTarget`, `planTargetSql`,
`replayMigrations`, `evaluateRuntime`, `controlRuntime`, and the proposed
package/configuration effects `installProvider` and `configureModules`. Each declared operation
has a required subset, composed with its dependency plan. A missing grant refuses before its effect. Grants are
explicit trusted-local consent, not an OS sandbox. Read-only catalog/source
operations need none. Query-control recovery needs none; query-control release
requires `controlRuntime` for its owned process effect. Runtime launch/resume/pause/step/release require
`controlRuntime`; evaluation also requires `evaluateRuntime`. Zod module
loading requires `executeTarget`; target SQL planning requires
`planTargetSql`; SQL migration replay requires `replayMigrations`.
Installing a selected provider requires `installProvider` plus qualified installed
acquisition authority; configure requires `configureModules` plus qualified
project-configuration write authority. These proposed grants do not authorize
unrelated target execution or substitute for the missing authority primitives.

Inline/file queries share canonical request identity. Validation precedes
admission and provider invocation. Installed declaration resolution supplies the
schemas used for validation and is itself effect-free. `Request.read_utf8(path)` reads raw file bytes,
with `-` selecting stdin, and checks RFC 3629 UTF-8 and NUL before
the compiler runtime's `io_str` conversion. That conversion replaces invalid
byte sequences, so a later String check cannot implement this boundary. Inline
argv uses the runtime's existing strict UTF-8 argument decoding and then the
same text validator. Invalid argv can fail in that runtime before the structured
context refusal exists. A leading BOM has its own refusal condition.

`Context.validate_json_text` uses linked SQLite's strict no-flag `json_valid(text)` and
`json_tree`. It refuses malformed/trailing JSON, duplicate decoded member names
grouped by parent and key, and NUL in decoded names. It inspects numeric spelling
with the JSON-text operator `raw -> row.fullkey`, where `raw` is the complete
document held in a CTE. The converted `value` and `atom` columns cannot preserve
that spelling. This SQL check applies the unsigned decimal U32 token domain to
every numeric request row without a path allowlist. It checks digits, digit
length and the upper-bound token before any numeric conversion. Native declaration-bound
subject/options validation separately admits numeric fields only in declared
shapes: root version, source-selector coordinates and explicitly U32 module-option
fields, including nested selectors. Version must equal 1. Decimal fractions,
exponent notation and signs refuse in this request profile. Wider provider-option
values use the declared exact-text representation; MCP must preserve that text
and the original raw request. Metadata retains its separate number profile.
Runtime thread/frame/object references and migration revisions are strings.
`Context.validate_declaration_text` applies the raw reader, duplicate/scalar
checks and a separate numeric/schema profile before provider use: byte offsets
admit unsigned safe-integer tokens through 2^53-1 or decimal strings for larger
offsets. Before native tree reconstruction, numeric offsets above U32 normalize
to their exact decimal-token strings. Argument indices use U32. This profile
has no U32 file-size restriction.

Canonical request identity uses the existing `json/canonical.bend` representation
and `json_text`. Its `Json` covers null, booleans, U32, strings, arrays and objects.
After strict SQL validation, a query against a private in-memory SQLite
connection returns `json_tree` node ID, parent, type, key and scalar value as
hex-encoded fields. Native SQL builders quote the source text with the existing
SQL literal encoder; no target content becomes executable SQL syntax. Hex
preserves tabs, newlines, NUL and invalid decoded surrogate bytes across the
current tab/newline row transport and its C `strlen` callback. Raw decoded JSON
strings are never passed through that lossy row boundary.

`Context.decode_scalar_utf8` consumes the byte-valued characters obtained from
`Tx.hex_decode`, rejecting invalid UTF-8, surrogate-range values, overlong forms,
values above U+10FFFF and decoded NUL in names or values. It constructs valid
native Unicode Strings. `Context.reconstruct_json` joins nodes through their
explicit parent identities, reconstructs objects and array elements in numeric
key order, and validates container shape. Node IDs need not be contiguous and
are not interpreted as array offsets. Internal row/index identities remain
decimal text, without imposing U32 node-count limits. Empty arrays use
`Jarr{Jnil{},Jnil{}}`; `[null]` uses `Jarr{Jnull{},Jnil{}}`. Missing/ambiguous
parents, repeated array indexes or malformed row transport refuse.

Native closed-schema validation and resolved defaults operate on this tree.
`json_text(tree)` performs its existing code-point member normalization and
preserves array order. The exact emitted canonical text and owner are the
request replay identity; the stored canonical body is compared directly.
No second request encoder or request digest is required. Snapshot artifact
hashes remain separate. The module's demo `utf8` helper is excluded from byte
lengths and hashes: its current implementation lacks a four-byte branch.
Actual String serialization uses the qualified runtime encoder. The raw reader,
SQLite parser/token traversal, row transport and runtime String encoding remain
foreign assumptions exercised by host tests. The new pure decoder/reconstructor
and actual native refusal/admission/spawn ordering have operative laws.

The MCP bridge retains raw Buffer frames split at byte 0x0A. A preliminary
`JSON.parse` selects only whether a frame names one of the three context tools;
it performs no semantic dispatch. Interfaces forwards selected context frames as
original bytes, with the authenticated attachment, to the ordinary native context
operation. That operation consumes Codec directly, validates the complete frame
and calls the actual Core/Lifecycle query, result or discovery effect. Root111
supersedes the separate public decoder entry and per-request decoder subprocess.
The native operation checks the entire frame for invalid UTF-8 and duplicates.
Its frame shape is
`{jsonrpc:"2.0",id,method:"tools/call",params:{name,arguments,_meta?}}`; `id` is a
string or a signed safe-integer token. It admits exactly the three named context
tools. Query arguments are `{query,request}`, result arguments are `{query}`,
and engines arguments are `{}` or `{scope:"session"}`. Scope has no other
admitted value or type; the arguments cannot contain a session identity.
Query IDs are nonempty strings; request is an
object. The root, params and arguments objects reject unknown fields except for
the declared metadata extension. After these checks the operation extracts the request
container with SQLite `json_extract`, which preserves its numeric tokens. That
container follows the shared request profile above. Hex-encoded frame string
fields pass through the same pure scalar decoder, including all metadata names
and values. The signed safe-integer frame ID is validated as its exact JSON token
and retained as envelope transport. SQLite's JSON validity alone does not
establish scalar-string validity.

Optional `params._meta` is an object. Its optional `progressToken` accepts a
string or JSON number, as specified by the
[MCP 2024-11-05 Request and ProgressToken schema](https://raw.githubusercontent.com/modelcontextprotocol/specification/main/schema/2024-11-05/schema.ts).
Additional metadata members are opaque transport data subject to the same raw
JSON, duplicate-name and scalar-string validation. The
[JSON schema](https://raw.githubusercontent.com/modelcontextprotocol/specification/main/schema/2024-11-05/schema.json)
defines ProgressToken as string or integer, while the TypeScript declaration
uses string or number. Neither definition specifies a numeric maximum. This
receiver explicitly selects the broader strict JSON-number compatibility profile
requested by root, including fractions. For example, `0.5` is admitted by this
profile and excluded by the published JSON Schema integer branch. The linked
URLs use `main`; these statements describe the reviewed source snapshots.
The metadata numeric profile admits strict JSON number tokens, including
negative, fractional, exponent and above-U32 forms, independently of the request
U32 and frame-ID
safe-integer profiles. Validation uses the raw token and JSON node kind without
conversion through Bend U32 or a JS Number; a valid large token is not rejected
because a host numeric conversion would round or overflow. Null, booleans,
arrays and objects are invalid progress tokens. Raw `NaN` and `Infinity` are
invalid JSON. The metadata object is validated and then discarded before native
dispatch; it enters neither the canonical request tree nor the decoded operation,
query identity, grants or provider dispatch. No full canonical frame tree is
needed. This adapter emits no MCP progress notifications; the protocol permits
a receiver to omit them. Managed query progress and owner notices retain their
existing lifecycle contracts.

Codec supplies the native caller a typed decoded operation carrying
`{version:1,tool,id,query,requestCanonical,scope}`. This is an internal callable
contract. `tool` is `context-query`,
`context-engines` or `context-result`; `query` is null for engines and the
validated query ID otherwise; `requestCanonical` is canonical text for query
and null otherwise. `scope` is `"session"` only for validated scoped engines
arguments, and null otherwise. `id` retains the validated frame ID's exact JSON
token for response correlation. The native caller dispatches from this typed
operation and passes canonical request text directly to the common query effect.
CLI `context-query-file` consumes the same Codec and effect functions. MCP performs
transport framing and response wrapping; schema interpretation remains native.
For successful results, the MCP bridge wraps the native-validated JSON document
as text, preserving the contained JSON text through outer JSON-RPC string
escaping. It does not parse/re-serialize payload numbers through JS Number.
A rounded structured convenience copy cannot become authoritative. This covers
negative zero, nested values, signed/exponent tokens and number-versus-text
identity on query, result retrieval and ref expansion alike.
Response correlation uses the native-validated ID token without conversion through
JS Number. For scoped discovery, the native operation uses SESSION solely from
the bridge's authenticated attachment and Codec's validated scope. Missing
attachment refuses before target inspection. Absent scope retains target-free
discovery. Preliminary JSON parsing and opaque metadata supply no scope authority.
The admitted package binds the native operation's transport contract to its
executable and bridge artifacts. Package admission rejects an incompatible pair
before context dispatch. Native validation requires the complete closed frame
and operation shapes; version 1 alone establishes no artifact compatibility.
Qualification must pair each revised artifact with an old counterpart and observe
refusal before dispatch, alongside the valid revised pair.
Context notifications without an ID do not dispatch. A preliminary parse error
keeps the existing no-dispatch error path. Ordinary non-context frames retain
their existing parsing semantics; this raw validation guarantee is context-scoped.
Duplicate method/name fields use JS last-wins behavior only for selection. If
the selected name is a context tool, the raw duplicate check refuses the frame;
if it selects another tool, the existing non-context path applies.

Native context validation refusals use exit 2 and the structured refusal JSON
on stderr, with empty stdout. The bridge decodes that document into `isError`
content. Conditions use fixed text; only the raw byte reader can supply a byte
offset. Input member names, tokens and paths are not echoed. Allocation failure
reports the host error; buffers grow as needed without a configured size cutoff.
The admitted canonical body, owner and resolved defaults are retained. Same ID and
same canonical input replay its row without rerunning an effect; conflicting
reuse refuses. A failed or interrupted query keeps its ID. A new query ID is
required for a fresh computation.

## Results, classifications and references

Every query answer is `{version,query,owner,state,result,error,progress}`.
`state` is `accepted`, `running`, `complete`, `failed`, `interrupted` or
`refused`. The last value is reserved for a retained admission rejection.
`result` is null until complete; `error` is nonnull for failed, interrupted and
refused outcomes. The envelope's progress always describes its own query.
It is null for queries without managed roles, including unmanaged query-control
and inspect queries. Managed install and configure queries retain their own
progress, control and cleanup.

Module causes are versioned schema-admitted data identifying module and code,
with their actual target/provider/protocol provenance. Common outcome categories
and fixed native validation conditions retain their meanings. Unknown semantic
meaning is labelled; undeclared or malformed cause data fails the selected schema.
Effect/policy descriptions can be non-authoritative facts. All authority decisions
use the native admitted association, and required binding echoes are checked
against it; payload descriptions grant no effect or replacement identity.

Progress is the closed object `{phase,waitingFor,control,cleanup}`. Phase is
`preparing|running|waiting|cleaning|settled`, control is
`available|unavailable|unobserved`, and cleanup is
`notRequested|pending|complete|unavailable`. `waitingFor` contains distinct
objects from this closed union. An empty set of outstanding events is `[]`:

- `{kind:"providerResponse"}`;
- `{kind:"providerEvent",producer,operation,event,subject}` with declaration-validated event/subject data;
- `{kind:"childExit",role,incarnation}`;
- `{kind:"keeperControl",role,incarnation}`;
- `{kind:"noticeDelivery",message}`.

Stored `progress_json` and returned progress use this same closed schema and
validator. Queries without managed roles store SQL null. A query-control request
has no progress fragment or progress notice of its own; changed progress and
cleanup notices belong to the controlled query and its existing role events.
`control:available` requires a successful identity-bound keeper control
observation, `unavailable` records an absent/unreachable channel or a failed
qualified control attempt, and `unobserved` records that no control observation
has been made. A never-attached role starts unobserved. Retained observations
carry their provenance; available is no promise of continued liveness.

For the clangd module, providerEvent identifies a diagnostics publication and its
captured URI/document version; the event payload uses its admitted schema.
Other modules declare their actual completion event. Role and incarnation name the exact recorded role. `message` names an
owed ordinary message. These are required events, never elapsed-time thresholds.

Cleanup becomes `pending` when intent commits, including cancellation of a
prepared role. Signal acknowledgment adds evidence and does not advance that
value. Query cleanup aggregates its startup plan and recorded role cleanup:
`unavailable` if any required role lacks the evidence needed to reconcile its
cleanup; otherwise `pending` while any required role remains unsettled;
`complete` only after every required role has qualified completion; and
`notRequested` before any query cleanup intent. Unknown cleanup is represented
by `unavailable`; it preserves responsibility. A role omitted because of verified
cancellation before its preparation counts as settled only when the starter's
ended/cancelled state excludes a later preparation. Missing role rows alone
establish no such fact. The immutable request determines the expected role plan;
release intent applies to roles recorded later as well as existing roles.
A terminal computation can coexist with pending cleanup or owed notices.
`settled` requires those duties to be settled too. Completion of one role cannot
hide an unresolved role.

An admitted failed/interrupted query is a retained outcome at exit 0. Initial
validation/admission refusals use the exit-2 surface below. `context-result`
returns the retained envelope at exit 0, including a refused query's cleanup
state; an unknown query ID remains an exit-2 lookup refusal.

A completed `query-control` result is the closed object
`{kind:"queryControl",controlledQuery,admissionDecision,state,progress,engine,observations}`.
Its state/progress/admission fields describe the controlled query at the
committed observation; its engine is that query's resolved engine or null if
admission refused before resolution. `admissionDecision` is `accepted|rejected`.
The control envelope itself is complete with progress null. Each observation is
`{role,incarnation,observerEvidence,cursor,capture,exitEvidence}`. The three
Evidence fields are nullable `{path,sha256,pointer}` references to retained
JSON artifacts; cursor is exact decimal text. These references come from
`semantic_roles.observer_identity_json`, `observer_cursor`, `capture_json` and
`exit_evidence_json` for that role/incarnation. They identify historical
observations and make no claim that their author remains alive. Public recovery
reads these records without acquiring custody. A retained rejection stays
refused while its progress can advance through cleanup.

Module-resolution uses the native result variant specified above. Every other
completed result has `engine`, `provider`, `moduleBinding`, `subject`, `snapshot`, `facts`,
`relations`, `refs`, `refFormat`, `limits`, `coverage`, `applicability` and `changedInputs`.
`facts` and `relations` contain objects with unique local `id`, `kind`,
`classification`, `producer`, `value`, `evidence` and `limits`. The producer is
the admitted module/operation binding for that fact, including a declared
dependency when applicable. Relations additionally have
`from` and `to`, both local ref IDs. Each evidence item is one of:

- `{kind:"source",path,sha256,range:{start:{line,column},end:{line,column}},role}`;
- `{kind:"schema",databaseIdentity,schemaDigest,object,column}`;
- `{kind:"runtime",runtime,epoch,thread,script,generated,original}`;
- `{kind:"document",path,sha256,pointer}`;
- `{kind:"probe",executable,sha256,version,operation}`.

Nullable fields are explicit nulls. Every fact/relation has nonempty evidence.
Coverage names examined and excluded files/entry points, provider completion,
index completeness and unsupported constructs. A projection with unavailable
coverage emits `{projection,code,detail}` in `limits`; empty facts alone never
encode unavailable analysis. A completed partial result retains every qualified
fact and states the incomplete projection.

| Classification | Required meaning |
| --- | --- |
| `observed` | actual runtime/catalog/validation observation under named process, connection or input snapshot |
| `static-possible` | resolved static relationship or analyzer witness within a named analysis model and coverage |
| `checked` | compiler-family oracle verdict on a stated proposition/domain, including raw verdict and provider version |
| `declared` | authored/configured intent, policy role, schema declaration or external assumption with its source |

A database observation establishes its catalog contents. The catalog's constraint
meaning remains a declaration; enforcement needs an executed witness and
connection settings. TypeScript resolved types may use `checked` for the
specific checker proposition; imported ambient declarations remain named inputs.
Compiler proofs, test examples and foreign adapter success are distinct evidence.
An analyzer predicate is `checked` only when its recorded explored model emits a
single consistent verdict; contradictory or missing verdicts are unsettled.
Coverage retains the selected provider's actual exploration limits and unvisited
paths. Baton adds no node/depth budget or timed truncation. A provider verdict
remains scoped to its reported explored domain. No oracle outcome proves
universal program behavior outside that model.

`refs` is an array of `{id,engine,producer,operation,subject,snapshotId,projections}`.
The proposed new result format records `refFormat:"context-refs-v2"` beside that
array. Producer is the complete closed ModuleBinding for the admitted producing
step, and operation equals its operation member. Engine equals its module ID.
Native compares both claims with the authenticated original step and association;
provider echoes and trusted normalization may not choose a different step. This
format name is a review proposal for coordinated producer, Codec, Lifecycle, Core
and Receive migration, independent of the outer envelope or module transport version.
It does not change internal Ref7 or RQ10. Decoder output may retain typed claims
beside those internal records; it must compare them before expansion.

Each admitted format has its own complete closed required/allowed field set.
Legacy unversioned five-member records retain raw historical readability under an
explicit legacy policy, without invented producer/schema authority. Missing
historical association refuses expansion. Unknown versions, malformed/foreign
claims and structural corruption are unreadable/unverified, not qualified absence.
An outer envelope version or a guessed key shape cannot authenticate ref format.
Migration preserves retained winner bytes and original version; any metadata
backfill requires independently authenticated origin. Lifecycle's five-column
hex-framed ref lookup and ten-column admission transport remain distinct protocols.
Actual strict readers, publication, migration laws and producer/Receive consumers
must be reviewed together before this new result format is admitted.
Stored entries also retain their authenticated original policy and schema
association for expansion. The core compares those associations before dispatch;
ref text supplied by a caller establishes none of them. IDs are
canonical JSON arrays serialized as strings, for example
`["source","/work/a.ts","<sha256>",40,17,"definition"]`.
Runtime reference shapes use the selected reviewed lifetime profile and common
Codec/Core encoding. The CDP profile retains its eight-member identity with
adapter, epoch and mutation generation, using canonical decimal-text counters;
this document supplies no shortened interchangeable runtime encoding. Encoding uses JSON
escaping; implementations do not split refs on punctuation. A ref query uses
`{kind:"ref",query:"q7",id:"..."}`. The coordinator loads the retained entry,
checks its original snapshot and required effects, then expands that selector.
Unknown IDs refuse. Stale source/schema refs return `staleReference` and a fresh
selector in the remedy; runtime refs require valid acquisition and current
lifetime evidence under their admitted profile. Expansion
preserves the original evidence, proposition, classification and scope.
Observed and checked evidence have different meanings; they form no general
strength ranking. A new relation requires its own evidenced derivation and
assumptions. Taking a scalar minimum of input classifications cannot establish
a checked relationship. Useful component facts remain available when a join is
unqualified.

The request-handler use case returns actual parameter/callee types, diagnostics,
code-to-schema access and the source-bound authorization relationship together
for the same selected handler. Referenced
entities, guards and scopes are individually expandable; agents do not construct
edges by matching snippets. The exception use case returns the exception, its
observed stack, mapping provenance and expandable scopes from one captured stop.

The retained optional C combined-handler qualification target is Fossil manifest
`32ad9a1584a16f09fff78563d789b2dbc6b4bae5`, `src/report.c::view_list`. Its true
signature is `void(void)`; the result has an empty formal list and typed global
permission inputs. The resolved `db_prepare` callee supplies real nonempty
parameter types (`Stmt *`, `const char *`, variadic tail). The same handler
contains the earlier `!g.okRdTkt && !g.okNewTkt` denial/return and the selected
constant statement `SELECT rn, title, owner FROM reportfmt ORDER BY title`.
Clang declaration identities join preparation and stepping through local `q`.
The result links the earlier guard to that call within ordinary modeled C
control flow, with intervening opaque calls and script execution explicit.
Permission/action/resource roles remain declared; this relation does not assert
a named authenticated user, stable permission fields after those calls, or
authorization for every effect of the handler.

A separate ordinary source query selects the authentic `db_prepare` definition
and returns its own nonempty formal list and variadic status. This qualifies
selected-function parameters independently of callee expansion. The `view_list`
result retains its genuine empty formal list in the five-fact combined case.

Retained research report `semantic-security-fossil-qualification-verdict-6`
qualifies an authentic LLVM20.1.8 GNU89/O0 HTTP-only build, its generated inputs
and exact original/generated body correspondence. It returns actual type/call
facts and compiler diagnostics, adapter-derived CFG reachability, a reviewed
source-pinned literal helper assumption and compatible catalog-modeled access.
The helper domain is a single constant statement with no percent/NUL and no
extra variadic arguments, under normal allocation and successful preparation.
Changed helper bodies or identities invalidate that assumption. Arbitrary
formatting and wrapper behavior remain unavailable.

The qualified planner is external SQLite3.54.0 reading the actual owned data
file in one transaction. The target links bundled SQLite3.7.7; the result names
both versions and never labels the external plan as the target VM's plan.
Controlled loopback denied/permitted requests supply source-coverage and built-in
SQL-trace corroboration. Their connection evidence is a scoped logical open/trace
event, with target pointer and target attachment dump unavailable after debugger
failure. This coverage/trace tooling establishes research evidence only; it is
not an additional advertised C runtime observation adapter. The installed native
combined result and its expansions still require qualification. The implementation
must qualify the programmatic AST-to-CFG mapping, composed request grammar and
native planner specified below; the research join's reviewed block constants
are insufficient for that producer.

Primary documentation and package notices belong to engine declarations and
this specification. Routine queries do not fetch documentation or require
network citation hashes.

## Input identity and capture consistency

Input fingerprints retain their semantic kind as well as role, path and marker.
File bytes, directory membership, absence and runtime/catalog observations cannot
compare equal merely because those text fields coincide. Snapshot verification
must bind the actual bytes consumed, through immutable capture or a separately
qualified read protocol. Matching pre/post hashes alone cannot exclude an
intermediate replacement. Unknown consistency remains explicit. A relation/cache
scope binds every input producer and snapshot it uses; enclosing immutable result
identity may provide that binding without duplicating all digests in each local ID.

Source snapshots contain a query-local `snapshotId` (SHA-256 of canonical provider/input identities), module/dependency bindings, provider identity, effective
options, worktree commit/branch/dirty metadata and actual read identities.
Worktree metadata alone establishes no source identity. Each module captures its
actual resolution/checker inputs and their absence/directory observations.
Bend2 import, namespace, declaration-order and Base identities are required as
specified above. The retained TypeScript host
captures exact file bytes, failed resolution lookups and directory membership
used by resolution; the Program consumes that immutable map. Config/SDK/type
inputs and their origin paths are included. An added formerly absent module can
change resolution and must invalidate the result.

clangd receives admitted compilation commands, resource roots and source inputs.
A one-shot server uses an isolated index/cache and configuration with remote
index, automatic config loading and query-driver execution disabled. Compiler
commands are reduced to supported frontend options; response files are resolved
and recorded, plug-in/loading flags refuse. Target-dependent executable drivers
are not run. The adapter materializes admitted source/header/config bytes into a private
capture directory and passes a compiler VFS overlay with `fallthrough:false`;
only listed captured paths resolve in the frontend. Source roots, explicitly
admitted SDK/resource roots and their directory membership define that input
view; symlinks resolve before capture and require an admitted destination.
The same captured view and frontend options supply AST/CFG and clangd analysis.
The original input manifest is compared after analysis. LLVM20.1.8 documents
this overlay field; the composed clangd/driver boundary requires acceptance
against an absolute include and an escaping symlink before advertisement.
[LLVM20.1.8 VFS schema](https://raw.githubusercontent.com/llvm/llvm-project/llvmorg-20.1.8/llvm/include/llvm/Support/VirtualFileSystem.h) If closure completeness
cannot be established, applicability is `unknown`; it cannot answer `current`.
clangd index-backed queries also state `indexComplete:false` unless completion
is demonstrated by the selected protocol/session. Partial-index callers remain
partial results.

A clangd query selecting diagnostics uses the managed query lifecycle below.
The client declares `textDocument.publishDiagnostics.versionSupport:true`,
opens the captured document at a recorded integer version, and retains the
server identity, URI, version and exact captured bytes. Diagnostic coverage
requires `textDocument/publishDiagnostics` for that URI and exact version.
An explicit empty diagnostics array completes that projection with no reported
diagnostics for the captured document. A versionless publication or another
version remains retained protocol evidence and cannot complete this projection.
The adapter obtains requested language-service response facts independently;
completion requires their responses and the matching diagnostic publication.

Without that publication, the query remains running with
the declaration-bound event
`{kind:"providerEvent",producer,operation,event:{kind:"diagnosticsPublication",reason:"diagnosticsUnobserved"},subject:{uri,version}}`
in `progress.waitingFor`. The event and subject objects follow the clangd
declaration's schemas; reason is not an extra top-level common member. Admission and this initial
waiting state are delivered to the owner through the managed notice path;
the provider observer retains its work and consumes future events. The owner
can inspect the query, continue other work, recover observation or explicitly
release it through `query-control`. No inactivity interval changes diagnostic
coverage or ends the provider. Versionless `clangd.fileStatus` strings,
including `idle`, supply no completion evidence. The pinned provider does not
advertise pull diagnostics; a `textDocument/diagnostic` method-not-found response
is not a replacement publication. Provider exit, transport failure or a
structured protocol error supplies its own failure evidence. Arbitrary stderr
text and protocol silence supply no inferred failure. On failure or explicit
release, preserve independently completed response artifacts and the missing
publication reason in `error.limits` as
`{projection:"diagnostics",code:"diagnosticsUnobserved",detail}`; the terminal
envelope does not assert completed diagnostic coverage. A successful ordinary
result uses the same limit shape in `result.limits` when a projection is
explicitly unsupported. Recovery attaches to the original retained adapter and consumes its
spool; it does not open another provider session to repeat an uncertain query.

The retained fidelity completion report qualifies versioned publications for
clangd20.1.8 and rejects the idle barrier. Managed progress, recovery, cancellation
and owner delivery are proposed integration behavior requiring the host gates.

Source capture records inputs before provider consumption and verifies after it.
Changed identities fail `changedDuringCapture`; no single-snapshot result is
published. The guarantee is equality of the captured/consumed input manifest and
its verification, scoped to the reader protocol; it does not infer filesystem
atomicity from mtime. Providers unable to consume stable bytes report that
limitation. Multi-engine joins require identical shared source identities and
named database snapshot identity.

SQLite catalog capture uses one read-only connection, explicit `BEGIN`, an initial
catalog read to acquire the snapshot, and all catalog/plan reads within that
transaction. The identity comprises real path and file identity, SQLite version,
`schema_version`, normalized `sqlite_schema` and relevant PRAGMA row digest,
connection flags and `foreign_keys` state. WAL/shm file hashes are not used as
schema identity. SQLite reads its committed WAL snapshot through the connection.
Data-only writes do not invalidate schema facts. `context-result` opens a new
read transaction and compares the same canonical catalog digest/identity; WAL
DDL and database replacement must become stale. Applied migration rows belong
to the same transaction and have their own digest. Catalog-only reads claim no
row-data snapshot. SQLite may maintain WAL reader coordination files; read-only
means no target SQL/data/schema mutation, not zero filesystem coordination.

PostgreSQL catalogs use one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`
transaction with fixed `search_path`, server/database/role identity and normalized
catalog rows. Freshness re-reads those rows in a new transaction. Catalog and
plan facts include RLS/role/search-path assumptions; unsupported FDW/extension
or remote-relation paths are explicit limits.

Common runtime identity binds the owned runtime, actual serving module/adapter
and native child incarnation. Its declared lifetime profile supplies the
additional qualified thread/context/handle acquisition and invalidation evidence.
The CDP profile adds loaded-script digest, debugger/context/worker IDs and pause
and mutation epochs. Other profiles retain their actual semantics. PID alone is
not identity. Disk bytes, loaded bytes and source-map bytes are
separate identities. A generated source map records its transform relationship.
A captured runtime value is a historical observation after resume; it never
becomes a fresh live value through `context-result`.

`applicability` is `current`, `stale`, `historical` or `unknown`. Read-time
revalidation runs only the original safe file/catalog probes. It never replays
migrations, loads model code, evaluates a debugger expression or recompiles a
project. Changed inputs are named; failed revalidation is `unknown` with its
cause. Same-ID retries return the stored computation with updated applicability.

## Code projections

The Bend2 frontend section defines the first required code module. Every code
module reports declaration resolution, types, references and relationships using
its language semantics and actual provider evidence. LSP capabilities and compiler
APIs are mechanisms selected per declaration. Type, call, flow and diagnostic
claims retain their individual coverage. The following TS/C sections preserve
the detailed optional profiles and their qualification obligations.

TypeScript uses `LanguageService` definitions/references/call hierarchy and
`TypeChecker` symbol/alias/type resolution. Config parsing uses the public
5.9.3 declarations. Explicit `types`/`typeRoots` and recorded resolution roots
prevent ambient ancestor packages from silently supplying types. `dependencies`
returns resolved import declaration edges and resolution inputs. Reference and
highlight roles retain provider read/write distinctions.

`flow` exposes narrowed types, definite-assignment diagnostics, unreachable-code
diagnostics under the actual compiler options, and `never` results. The adapter
collects both `LanguageService.getSemanticDiagnostics` and
`LanguageService.getSuggestionDiagnostics`, retaining the diagnostic family,
code, category and effective options. For example, unreachable-code diagnostic
7027 can be a suggestion under the default options and a semantic diagnostic
with `allowUnreachableCode:false`; definite-assignment diagnostic 2454 belongs
to the semantic family. A missing family cannot establish absence of a diagnostic.
`exceptions`
exposes resolved throw expressions and enclosing try/catch/finally structure.
Those syntax relationships do not establish cross-call propagation. Async,
callback, getter/proxy, dynamic dispatch, `any` and interface-to-implementation
limits survive expansion. No public TypeScript CFG API is assumed.

clangd supplies types, references, call hierarchy and diagnostics. The separate
`clang-analyzer` producer uses a first-party LLVM20.1.8 LibTooling executable.
It constructs the selected function's CFG with `CFG::buildCFG` in the same
`ASTContext` that resolves its declarations and expressions. It maps
`CFGStmt::getStmt` elements and terminator statements to those AST nodes by
in-process identity, then emits snapshot-bound source refs. `DumpCFG` text
remains diagnostic evidence; it cannot supply the required node identity.
The extractor records all `BuildOptions`, preserves default pruning semantics,
and enables `setAlwaysAdd` for call and return statements. Null CFGs and missing
or ambiguous mappings return explicit unavailable relationships.

The graph records block entry, ordered statement elements, decisions and
successor edges. `getLastCondition` identifies the operand evaluated by an
individual short-circuit decision. `getTerminatorCondition` can identify a
larger compound condition and must not imply that every operand was evaluated.
True/false successor order for admitted IfStmt and logical-operator decisions
is bound to the LLVM20.1.8 implementation and qualified against actual emitted
edges. Unreachable, alternate and null successor metadata is preserved. Graph
IDs are local to the extraction and carry no persistent source identity.
SourceManager spelling/expansion locations and Lexer token/file ranges supply
byte spans; ambiguous macro or cross-file ranges remain unavailable.
The ordinary extractor traverses all IfStmt, ReturnStmt, CallExpr, DeclRefExpr
and MemberExpr nodes within the selected FunctionDecl, without entering nested
function bodies. It resolves direct callees and their parameter types through
canonical declarations. Indirect calls retain their unavailable callee identity.
A supported guard expression contains nonvolatile integer/enum reads, scalar
record-field reads through a resolved record lvalue, parentheses, transparent
scalar conversions, `!`, `&&` and `||`. Calls, mutation, pointer dereferences and
volatile operands make that guard relation unavailable. Every qualifying call
and condition is considered; source order does not select a preferred guard.

For original Fossil source, the fixed build-profile translation rule identifies
the generated file through the compilation command and build receipt. The
extractor obtains each generated FunctionDecl's full token-inclusive file
interval, requires unique identical bytes in its paired original file and
requires the selected position to lie in that interval. Symbol subjects resolve
the selected name within that mapped file. Child offsets translate through
that verified interval while retaining both source identities. Missing pairs,
multiple matches, macro-expanded boundaries and translated `@` bodies refuse
original correspondence; direct generated-source facts remain separately
available. A query executes neither Make nor the translator.

The build receipt is a closed data input:

```text
BuildReceipt = {version:1, sourceRevision, artifacts:[Artifact],
                pairs:[FilePair], links:[BuildLink]}
Artifact = {path, sha256, role:original|generated|generator|header|object|
                             binary|buildCommand|linkEvidence}
FilePair = {original:ArtifactRef, generated:ArtifactRef,
            generator:ArtifactRef, buildCommand:ArtifactRef}
BuildLink = {object:ArtifactRef, binary:ArtifactRef,
             buildCommand:ArtifactRef, linkEvidence:ArtifactRef}
```

`ArtifactRef` is an index in that receipt's artifact array. The native reader
checks the referenced roles, reads/hashes every consumed artifact under admitted
roots and rejects mismatches. Link evidence retains attributed object/link
commands and symbol observations for the fixed profile. The extractor resolves
current declarations and parses the exact helper definitions under the admitted
compiler inputs. It checks their source identities and the declared build/link
association. Unsupported receipt formats or inconsistent source/build records
refuse the helper join. A missing authenticated executable-contribution witness
leaves that separate claim unverified. Helper-body semantics remain the declared
package assumption. The receipt
contains no guard, principal, denial or effect relationship supplied by the
requester. The exact fixed-profile link-evidence decoder still requires its
qualification. Its retained-data formats are:

```text
BuildCommand = {version:1, kind:compile|link, directory, arguments:[String],
                transcript:{artifact:ArtifactRef,line:PositiveInteger},
                completion:{artifact:ArtifactRef,scope:parentBuild,exitCode}}
LinkEvidence = {version:1,format:defined-symbol-lines-v1,binary:ArtifactRef,
                symbols:ArtifactRef,
                capture:null|{command:ArtifactRef,exitCode}}
```

The fixed transcript decoder accepts the captured unquoted clang command form:
ASCII-space-separated tokens, with quotes, tabs, escapes, shell operators,
response files and unsupported driver syntax refused. It verifies the hashed
log's indicated one-based line against the argument vector. It parses the
admitted `-c`/`-o` and direct-object arguments under the recorded directory;
retained copies keep their original logical output path separately. Parent
Make completion remains a parent-build observation, with no invented child
process receipt. The defined-symbol decoder retains all complete rows of
sixteen hexadecimal address digits, one space, a symbol type from
`S|T|b|d|s|t`, one space and a nonempty linkage-name token. Addresses remain
exact. Malformed or incompatible duplicate rows refuse. A matching external
text symbol supplies no object-contribution identity.

These records establish supplied-artifact integrity and declared command/source
consistency. A digest supplied beside bytes is not an independent trust anchor.
The existing experiment's symbol inventory lacks an object-attribution map and
has no complete capture envelope. Its normal form retains `capture:null`.
The historical source-to-object-to-executable implementation edge is
`implementationLinkUnverified` on that evidence. Initial source-model admission
requires actual resolved C declarations/callees, exact parsed helper definitions
and admitted compiler inputs, with the reviewed literal-helper assumptions and
declared build/link association retained. This supports a `static-possible`
source-to-modeled-access relation. Source correspondence, modeled database
access, observed runtime behavior and authenticated executable contribution
remain distinct claims. A receipt or matching symbol name cannot authenticate
historical compiler/linker execution or executable-body contribution. The initial
guarantee requires no build-capture subsystem.

The authentic Fossil report6 build and runtime observations retain their actual
observer, artifact identities and qualification limits. They qualify that
reviewed experiment; they do not authenticate arbitrary caller-supplied build
receipts or establish installed extractor behavior.

Analyzer plist witnesses retain each path event and branch decision. Compiler
frontends parse target code with fixed options; the invocation executes the
pinned analysis tool and emits only into the query's private artifact directory.
It performs no subject build, link or executable launch.

## Data projections

Data and framework modules use declaration-bound operations and source identities.
A language module supplies resolved program/model relationships; a catalog or
validation module supplies its own observations. A joined edge names both
producers and the evidence that connects the source operand to the observed
entity or model. Matching names alone leaves the edge unavailable. Elixir,
Phoenix and Ash qualification must cover their actual module/function, resource,
validation, serialization and policy semantics with explicit macro/generated
source attribution. Executing compilation hooks, macros, validators or migrations
requires the corresponding target effects; read-only discovery cannot acquire
those effects implicitly. The profiles below retain their stated domains.

SQLite captures table/view/column/index/FK/constraint declarations through
`sqlite_schema`, `table_list`, `table_xinfo`, `index_list`, `index_xinfo` and
`foreign_key_list`. PostgreSQL uses `pg_class`, `pg_attribute`, `pg_constraint`
and associated catalog functions. DDL expressions are attributed text;
CHECK-expression semantics and rename history are not inferred.

TypeScript constant-SQL code joins resolve the caller and compare its
resolved declaration with `options.client`. Literal/template SQL without
substitutions is passed to the selected database's parser. A parameter or
same-name shadowed function does not match. Unknown database receiver bindings
and dynamic SQL emit limitations at their exact call sites.

The C constant-SQL join is part of the same `clang-analyzer` handler result.
It discovers direct calls whose resolved definitions match the fixed Fossil
`32ad9a1584a16f09fff78563d789b2dbc6b4bae5` helper summary. The summary binds the
actual `db_prepare`/`db_vprepare`, Blob/vxprintf literal path, `db_step` and
SQLite-call definitions through source digests, generated correspondence,
compiler declaration identity and recorded build inputs. A matching spelling
is insufficient. The supported call passes one local `Stmt` address and one
constant SQL literal, with no extra variadic arguments, percent or NUL.
Preparation and the first step must resolve the same local declaration. The
producer checks intervening uses on the acyclic first-entry path before a loop
backedge; an unreviewed escape, reassignment or uncertain reaching definition
refuses the step lineage. Later loop uses keep their source identity, but the
initial helper summary does not establish unchanged handle identity on later
iterations. Ordinary CFG loops do not establish termination. Unsupported
aliases, changed helpers and formatting retain specific limitations and cannot
produce the joined access edge.

The literal-copy behavior is a reviewed `declared` helper assumption with normal
allocation and successful-prepare conditions. The source-call-to-modeled-access
edge is `static-possible`. Its value includes `sourceBinding`,
`helperAssumption`, `buildAssociation` and `implementationLink`.
The first three are local refs to, respectively, the resolved call and parsed
definition binding, reviewed literal-helper assumption, and declared build/link
association. Each referenced fact retains its source/document evidence.
`implementationLink` is `{status:"implementationLinkUnverified",evidence:[]}`
for the initial receipt-based profile. This status preserves the useful source
join and makes no executable-contribution claim. Runtime observations use their
own observed facts and cannot upgrade this field through ref expansion.
`sqlite-schema` observes its own catalog/plan in one
read transaction on the explicitly supplied file; the result includes its
engine/version and snapshot. The source connection operand and supplied file
association are separately identified assumptions unless directly observed.
The qualified Fossil example uses SQLite3.54.0 as external planner and 3.7.7 in
the target. It does not infer target attachment state or target-plan equality.

For C `databaseAccesses`, a retained native child invokes a narrow operation
using the package's linked SQLite library. Its private input is
`{version:1,databasePath,sqlBytes,sourceBindingId}`; package code fixes the open
mode, authorizer and internal queries. `planTargetSql` is required before
preparation. The ordinary coordinator SQL effect is unchanged. Runtime library,
header, compile options and operation revision enter the provider identity.
The native replay probe establishes linked API availability, not qualification
of this separate planner operation.

Open the admitted ordinary pathname with `SQLITE_OPEN_READONLY`, without URI
interpretation. Capture resolved file identity, `sqlite3_db_filename` and
`database_list`. Register no target functions, collations or extensions.
`sqlite3_drop_modules(db,NULL)` must succeed before target preparation; its
actual symbol and behavior require package qualification. Configure private
scratch/temporary storage in the dedicated child as specified for native
SQLite operations. Fixed internal queries begin a transaction, establish the
schema read snapshot and capture supported ordinary main-database catalog
objects. Those statements are package bytes; target SQL cannot select internal
query mode. Read-only open preserves ordinary SQLite locking/side-file limits.

Install and check a separate target authorizer before any target-derived
prepare. It permits only `SQLITE_SELECT` and `SQLITE_READ` of pre-captured,
supported ordinary main-database objects. All other actions refuse, including
functions, pragmas, DDL/DML, transactions, recursive queries, attachment and
unknown action codes. Callback arguments may be null. Copy observations without
executing SQL in the callback. Unsupported views, virtual tables and schema
features return explicit unavailable relationships. The replay policy does not
apply to this planner mode.

Require valid UTF-8, no NUL, one nonempty statement and no bind parameters.
Call `sqlite3_prepare_v2` with explicit byte length and a tail pointer. Require
`sqlite3_stmt_readonly` and `sqlite3_stmt_isexplain == 0`; never step this
original statement. Continue parsing its remaining bytes under the same policy,
checking pointer progress. Empty/comment/semicolon remainder is allowed; any
second statement or parse/authorization error refuses the plan. Finalize every
statement. This supports different SELECT literals, including quoted semicolons,
without a fixed SQL-digest restriction. The helper's no-percent rule remains
separate. Rejecting multiple statements describes this producer's admitted
range; it does not claim the target helper rejects them.

Prepare fixed `EXPLAIN ` bytes plus the admitted original SQL under the same
policy. Require `sqlite3_stmt_isexplain == 1` before stepping and retain the
authorizer through any automatic repreparation. Only this EXPLAIN statement is
stepped. Collect its full plan and callback facts in the open snapshot. Native
engine/API representability limits and allocation errors retain exact causes;
there is no additional SQL-length, output-row or time cap. Explicit authorized
cancellation follows the retained child contract. Errors invalidate the joined
plan and trigger finalization, rollback and checked close.

Join OpenRead database/rootpage operands to that same connection's captured
catalog. OpenWrite is unsupported in this initial SELECT profile. Unknown
access opcodes or ambiguous object/rootpage bindings preserve independent plan
facts with `modeledAccessUnavailable`. Authorizer READ events identify planning
observations, not target execution. The call-to-modeled-access edge remains
`static-possible`, scoped to the external engine and captured file. Native
qualification must reproduce the retained CLI reportfmt access case and prove
EXPLAIN-only stepping, tail refusal, authorizer state and snapshot consistency.

The existing Node entity/TypeScript SQLite path retains its own read-only
provider contract and qualifications. PostgreSQL uses `PREPARE` plus
`EXPLAIN (FORMAT JSON) EXECUTE` without `ANALYZE` on one read-only transaction.
`plan_cache_mode=force_generic_plan` is fixed; parameter types and NULL-bound
values enter plan provenance, including the value-dependence limitation.
Planning target SQL requires `planTargetSql` because planning can evaluate
functions. The target statement is never executed. Schema-only access needs no
such grant. Unqualified relation names use that transaction's `search_path` and
catalog identity. PostgreSQL write RETURNING origins remain unavailable.

Node 22.15.0 has `DatabaseSync` and read-only open but lacks
`StatementSync.columns()` in its documented API. Therefore `columnOrigins` is
an explicit unavailable projection at that floor. A newer Node provider can
expose it only after capability probing and its own acceptance. The initial
required join is call → parsed operation → catalog object; it does not depend
on `columns()`. [Node 22.15 SQLite API](https://nodejs.org/download/release/v22.15.0/docs/api/sqlite.html)

`schema` subjects use JSON Schema draft 2020-12 with bundled Ajv8.17.1's 2020
entry point. `sample` is a JSON file. All `$ref` resources must resolve inside
the explicit local `resources` set; remote loading, custom keywords, mutation,
coercion and default insertion are disabled. `strict:true`, `allErrors:true`,
`validateFormats:true` are fixed; no custom formats are registered and an unknown
format rejects schema admission. Validation returns actual verdict,
instance/schema pointers and rule parameters. Schema declarations and sample
observations stay separate. Regex execution limits of the provider are reported;
Baton adds no arbitrary cutoff.

`model` subjects load the explicit JS module export with `executeTarget`. The
selected export must be a Zod4.3.6 schema; provider identity and loaded module
closure are recorded. `safeParse` exposes success/errors and the output value;
`z.toJSONSchema` exposes supported input/output schema, with unrepresentable
transforms marked. Serialization is the observed transformed output and its JSON
encoding plus supported schema, all linked to the module/export and sample.
User validators/transforms are target execution and may perform effects with the
local user's access. Runtime stdout/stderr are captured privately, separate from
the protocol. The adapter's own protocol process loads no project module; a
controlled child does. The TS resolver supplies model import/use edges for
`codeAccesses`. Merely listing model names fails this projection's acceptance.

A negative validation verdict is a completed validation observation. A project
import, validator, conversion or serialization throw is an admitted execution
failure with its actual target/provider cause and completion evidence. Invalid
prelaunch input or a missing grant is refusal. Successful retrieval of a retained
failed query preserves that failure; it does not turn the analysis into success.

Every operation driving project execution identifies its admitted invocation and
capture boundary. Capture covers all project-controlled phases it drives,
including deferred conversion and serialization, and keeps target output separate
from protocol frames. Failure retains observed bytes, completion and exact capture
or retention limitations. Dedicated channels or a separate target child may
implement this boundary; no particular stream-hook mechanism is required. Direct
descriptor writes and inherited writers need their own qualification. A later
effect/capture mismatch fails publication and preserves possible effects; it cannot
claim that admission prevented an action already observed.

`migration.chain` is an ordered array of `{revision,path,sha256}` with string
revision identities; numeric revision values refuse before replay.
`applied` is `{table,revisionColumn,checksumColumn}`. Initial replay supports
SQLite SQL scripts only. It captures applied rows and the live catalog read-only,
then replays the captured chain into private databases with the same SQLite
provider. One catalog represents the recorded applied prefix; another the full
chain. Results name pending revisions, checksum divergence, catalog differences
from the recorded prefix, and proposed head constraints. An absent/inconsistent
applied record yields `migrationHistoryUnknown`; out-of-band change is not
inferred from the head comparison alone. Replay requires `replayMigrations`.
The runner prohibits ATTACH, extension loading, writes outside its admitted
private replay/scratch state and project SQL
functions through an authorizer-capable SQLite interface; if that interface is
missing, replay is unavailable. The Node22.15 binding lacks that interface, so
this projection uses the narrow linked-library replay operation specified in
Packaging. No migration runs against the target database.

## Security projections

Security context has the same module boundary as code and data. Each producer
declares which predicates, operands, paths and sensitive-operation relationships
it can resolve. A framework declaration describes intended roles; an observed
decision and a compiler-checked proposition carry their own evidence. Bend2
quantity/type/law facts do not by themselves establish application authorization.
An Elixir/Phoenix/Ash module must bind policies, plugs or generated actions to
actual resolved source and configuration before joining them to a request path.
Unresolved expansion, dispatch, authentication and enforcement remain explicit.

The retained optional C profile analyzes one translation unit with pinned LLVM
20.1.8 front-end and Static Analyzer builds and the subject's known build
options. Supported relationships use direct calls, scalar principal/action/
resource operands, conditional rejection, and local non-escaping records
whose field stores, loads and aliases the provider can resolve. Every
relationship names its actual analyzed entrypoint and supported path.
Unresolved dispatch, cross-translation-unit effects, unsupported aliases,
loops or recursion that the selected analysis cuts, macros without an exact
source mapping, identity-provider validation, and C++ have explicit
unavailable/incomplete status. A partial result retains independent facts.

Basic authorization context comes from an ordinary position/symbol source query
with `select:["authorization"]`, combined with any other admitted projections.
The selected function is the discovery boundary. Native analysis enumerates its
direct calls and evaluated conditional expressions, resolves operand variables
and fields, and maps conditional CFG edges to explicit denial returns and later
selected calls. A call selected by the admitted SQL helper profile is an effect
candidate with a resolved database relationship. Other direct calls retain their
source identity without an invented external-effect classification. Conditional
reachability uses the actual mapped CFG; hardcoded block IDs and first-IfStmt
selection are not producer algorithms.

The result returns discovered condition/operand/call/return refs and
`guarded_call(conditionRef,operandRefs,acceptedRoutes,deniedRoutes,returnRefs,
callRef,graphRef,cutEdgeSet,limits)` as `static-possible`. For each condition/call
pair, native analysis derives complete true/false exit-edge sets from the
logical AST and mapped CFG. A qualifying denial continuation must reach an
explicit mapped return before the call or accepted continuation. A reachable
cycle, unsupported transfer or unaccounted alternative on that denial side
makes the relation unavailable. Opaque calls retain the ordinary call/return
assumption. Reachability must connect entry through an accepted outcome to the
call, and removal of the entire accepted exit-edge set must disconnect entry
from that call. A bypass or earlier occurrence prevents that claimed relation.

Each route records only the operands actually evaluated, their outcomes and
graph edges. Its witness references the whole cut set: a single short-circuit
edge need not dominate the call. The implementation visits finite graph states
and retains the complete supported route relation without a fixed route cap.
Actual allocation/provider failures return their errors; they cannot turn
incomplete enumeration into a complete claim. Intervening opaque calls remain
recorded. Absence of a matching guard is a scoped discovery result and grants
no permission. Ordinary `ref` queries expand each discovered selector under the
original snapshot. Agents do not supply compiler-resolvable edges.

Semantic roles and trust assumptions are `declared`. Optional role/policy input
interprets discovered facts; it is not required to obtain them. The Fossil
qualification interprets resolved global request fields as permission inputs
and the modeled `reportfmt` access as listing report definitions, with those
interpretations explicit. A principal's trusted origin or authenticated identity
requires separate evidence. Basic discovery reports the actual guard expression
even when no such identity claim is available.

**Selector and identity contract.** The closed request subject kind
`security` has `{declaration:{path,sha256}, requirementId}`. The declaration
names the translation unit, compile-command identity and entrypoint. The
engine is `clang-analyzer`; projections are `declaration`, `guardPaths`,
`inputPaths`, and `predicateQueries`. This is an optional explicit requirement
evaluation route. A source query may supply its selector in `options.security`
to link a declared requirement or predicate proposition to discovered refs;
ordinary `authorization` discovery requires none. The same source snapshot is required.

A declaration source selector is:

```text
SourceSelector = {path, sourceSha256, byteStart, byteEnd, expectedAstKind}
ValueSelector  = {base: SourceSelector, fields: [SourceSelector]}
```

Ranges are half-open byte offsets into the pinned source bytes. Each field
selector must resolve to a FieldDecl. The adapter parses the actual build
input closure and requires exactly one AST match of the expected kind.
Ambiguous, stale, macro-collapsed or unresolved selections fail explicitly.
User-supplied selector text never substitutes for compiler resolution.

Resolved refs carry:

```text
SourceRef = {snapshotId, translationUnitId, compileCommandDigest,
             path, sourceSha256, byteStart, byteEnd, astKind,
             declarationRef?}
WitnessRef = {artifactSha256, diagnosticIndex, pathStepIndices,
              compilerVersion, analysisConfigDigest}
```

`snapshotId` binds the compiler build and every consumed source/header/config
input. AST pointers/JSON node IDs are internal to one extraction. The adapter
maps them to these snapshot-bound refs. `declarationRef` follows front-end
DeclRefExpr/referencedDecl, member/field declarations and direct-call binding;
it is never selected by a unique spelling. Existing code-context refs are
reused only when they bind the same snapshot and declaration. An analyzer
file-index/line/column is mapped through that run's file table to exact source
bytes and AST nodes. Failed or ambiguous mappings produce no joined edge.
Generated analysis instrumentation retains its own digest and explicit
original-to-instrumented source map.

For that optional route, the declaration file is `{schemaVersion:1, requirements:[Requirement]}`;
requirement IDs are unique. Each requirement has this closed shape (source selectors become
resolved refs in the response):

```text
{id, authority:{author, revision},
 translationUnit:{path, compileCommandDigest}, entry: SourceSelector,
 principal: ValueSelector,
 action:{label, callsite: SourceSelector},
 resource:{origin: ValueSelector,
           atEffect:{callsite: SourceSelector, argumentIndex, fields: [SourceSelector]}},
 guard:{condition: SourceSelector, acceptedValue: true|false,
        principalUses:[SourceSelector], resourceUses:[SourceSelector]},
 deny:{terminal: SourceSelector},
 effect:{callsite: SourceSelector, calleeDeclaration: SourceSelector},
 inputs:[{origin: ValueSelector,
          atEffect:{callsite: SourceSelector, argumentIndex, fields:[SourceSelector]}}]}
```

`condition` selects the evaluated expression in an IfStmt; `terminal` selects
the opposite branch's ReturnStmt in the initial profile. The action,
resource and input effect selectors must identify the same sensitive callsite.
The callee declaration must equal the compiler's resolved target. Principal
and resource uses must be expression nodes within the guard. Their identities
must trace to the declared operands through compiler-resolved local bindings
and explicit actual-to-formal steps in the selected call path. The field list
names the selected local record member chain; arbitrary pointer arithmetic
and an unknown pointee are unavailable in this profile.

A requirement with no matching code relationship remains a declared
requirement and reports `declarationUnbound`. Supplying a requirement does not
establish that it is enforced.

**Computed relationships.** The adapter returns the following independently
classified facts and relations, with source refs and witness refs:

- `call_argument_binding(callsite, argument, parameter)` and
  `resolved_call(callsite, declaration)`: front-end bindings, `static-possible`.
  These connect the same principal/resource across entry, wrapper and callee.
- `input_path(origin, effectArgument, steps, witness)`: `static-possible` only
  when every step is justified. Step kinds are definition, direct copy,
  identified local-field store/load, resolved alias, and direct-call argument
  binding. Each has endpoint refs and its AST/CFG or analyzer evidence. The
  analyzer witness restricts the path and branch assumptions. A plist that
  lacks a required value-flow step cannot supply that step by inference from
  labels, proximity or value equality. Unambiguous direct copies and local
  object flows may be extracted from the compiler AST/CFG by the new bounded
  adapter; ambiguous reaching definitions/regions remain explicit gaps until
  provider evidence resolves them.
- `authorization_path(requirementId, principalRef, actionRef, resourceRef,
  guardRef, acceptedEdge, denyEdge, effectCallRef, inputPathRefs, witness)`:
  a `static-possible` path connecting the resolved guard and its operands to
  the selected sensitive call. `acceptedEdge` records the condition value on
  the analyzer path; `denyEdge` records the opposite CFG edge to the selected
  return. The authorization meaning of the guard/action remains linked to
  the declaration. The relation states that this path has the condition; it
  does not claim that every invocation is guarded, that the principal is
  authentic, or that a call's external effect completed.
- `predicate_query(proposition, evaluationSite, exploredDomain, verdict)`:
  `checked` only under the compiler-family query contract. It carries the
  exact resolved expression/proposition, instrumentation/source-map identity
  when used, model and analyzed entrypoint, explored-path domain and witness
  IDs, analyzer/compiler version, raw verdict, and exploration/path-cutting
  limits. Contradictory, UNKNOWN, missing or unmapped verdicts leave the query
  unsettled. A reachability warning alone remains `static-possible`.

For example, a query at a selected effect can ask whether the resolved
principal attribute equals the allowed value on the explored paths that
reach that effect. It establishes the modeled proposition at that site.
Queries initially admit existing `clang_analyzer_eval` sites with side-effect-free
scalar expressions whose operands resolve at that site. Adapter-generated source
instrumentation and expression relocation are unavailable in the initial set. An `input == argument` query establishes modeled equality at that site;
`input_path` still requires the definition/flow steps above. No absence of
reports establishes universal enforcement or absence of bypasses.

**Optional executed correspondence.** An `observed` decision must record an
evaluation of this exact source-bound guard on the running subject. Its
witness identifies the subject build/snapshot and runtime backend, requirement
and guard refs, captured principal/resource bindings allowed by the capture
policy, condition outcome, selected branch and invocation/frame identity.
A later sensitive-call event joins only through that same invocation and
resolved operand mapping. An actual effect-completion claim requires an
additional completion event. Instrumentation, if used, preserves the original
single evaluation and discloses its source mapping and effect on execution;
re-evaluating an arbitrary expression is not an observation of the original
decision. This executed projection remains unavailable until demonstrated on
the selected runtime target. Process sandbox decisions have their own subject
and are not evidence of the selected C predicate's outcome.

**Implementation and acceptance.** Source selection validation, AST/CFG to
plist mapping, the bounded value-step extractor, and authorization-path
assembly are new adapter work. The retained probes demonstrate constituent
compiler mechanisms and falsification cases. They do not demonstrate the
integrated extractor, LLVM-version portability, automated discovery of
arbitrary policy, or a solver proof of all-path enforcement. The critic report-2
probes use Apple Clang 17; LLVM 20.1.8 release acceptance must cite the
separate LLVM 20 evidence for each promised capability and run the joined
adapter on a real external C subject.

Acceptance first uses ordinary source discovery to return actual typed guard
operands, deny/effect relationships and supported input-to-effect bindings,
without supplying a declaration file or source-edge selectors. A separate
optional declared-requirement query qualifies its interpretation and predicate
route. Its principal/resource assumptions remain labeled.
It must exercise the no-op guard, wrapper, local-field alias, disconnected
declaration and shadowed-callee negatives. A shadowed function parameter
cannot bind to a global same-name function; a declared filter cannot erase
an implementation path and establish sanitization. Sink catalogs and taint
configuration provide declared role assumptions only. Sanitizer correctness
and all-path authorization are unavailable unless a separately identified
compiler query establishes the exact proposition over its stated domain.

Every result reports input/build digests, compiler and model versions,
entrypoints, authority and trust assumptions, examined/excluded paths,
coverage, generated instrumentation, verdicts and unavailable reasons.
Status-ok empty reports retain the backend's actual scope and limitations.
Each language module independently qualifies its security-flow projections;
unavailable projections retain their actual scope. Credential capture
rules apply to all runtime values and expanded evidence. Raw source evidence
is returned only under the specification's source-inspection policy.


## Environment and general projections

A module may return source-bound declared/static configuration facts without
evaluating target code when its backend supports them. Expanded/effective values
and runtime observations identify the operation and captured inputs that establish
them. A literal lockfile parser must qualify its supported grammar; general target
evaluation is not passive reading. Lock-recorded versions and installed/runtime
dependency identities remain distinct facts.

Automatic field policy binds source role, extraction rule and value schema.
Declaring a string/path field cannot authorize a credential value placed there.
Exclusions also apply to diagnostics and derived automatic fields. Missing optional
facts retain a limitation; malformed required evidence refuses the affected fact.
Explicit source/runtime inspection retains its separate policy.

Environment operations declare which package managers, toolchain/configuration
formats and service inputs they can read. Bend2 Base, import closure and compiler
configuration are the first code-environment subject. Elixir/Mix, Cargo, Go,
Python and Node inputs belong to their respective declarations and qualification.
Every automatic field follows the structural output policy below. Executable
configuration and package-manager hooks retain target-execution admission.

Automatic environment context concerns the selected target's declared inputs.
It never reads the coordinator/harness environment. Node manifests and lockfiles
supply `declared` dependencies; disk package manifests and resolver decisions
supply separately attributed installed versions and origins. Ancestor packages
are included only through admitted read roots. Manifest/lock/tree disagreements
are named. Package-manager install/build/lifecycle commands do not run.

TypeScript effective config includes the full extends/reference chain and
resolution roots. C configuration includes parsed compilation commands and
admitted frontend options. Fixed tool probes use the deployment's explicitly
admitted provider executables, recording their absolute real path/version/digest.
Environment `options`
admits `tools` (map of provider name to executable path), `readRoots`,
`configFiles` (paths) and `servicesFile` (JSON Compose document).
Every request-local `tools` override requires `executeTarget`, including an
override that names the same path as a deployment provider. Admission checks
that grant before invoking the override with `--version`. Target configuration
cannot introduce an executable into the trusted provider selection. These probes
are ordinary local execution: an override may act before printing its version.
A returned version and post-execution digest do not establish prior consent.
`context-engines` uses only the deployment provider selection and accepts no
request-local executable override.

Automatic value fields are structurally restricted: validated package version
strings; recognized compiler option enums/booleans/numbers and explicit path fields;
resolved executable paths and validated version tokens; file presence and key
names. Free-form compiler definitions, options, URLs, commands and arbitrary
config values have no automatic value field. Their explicit source inspection
uses the source policy. Dotenv files contribute path/key presence only. A
process-dependent override is `unknown` unless a target runtime observation
establishes it; an ambient harness variable never becomes effective target config.

`services` parses a caller-selected JSON Compose document as data and returns
service IDs, dependency edges/conditions, port declarations, named networks,
volume targets and declared secret/config key names. Free-form command strings,
credential-bearing image/endpoint strings and env-file values are excluded from
automatic values. Dependencies and configuration paths outside the root require
admitted read roots and enter the snapshot. Running container health, occupied
ports and image identity are unavailable; no daemon command executes.

`dataset.pointer` is an RFC6901 JSON Pointer, with empty string selecting the
root. `structure` returns types and child pointers; `value` returns the complete
selected value. `join` is `{left,right,leftKey,rightKey}`, each an RFC6901 pointer
relative to the root or record as applicable; left/right select arrays, key
pointers select scalar keys. `relationships` returns exact-equality pairs with
both record pointers, duplicate and missing-key facts. There is no implicit
foreign-key inference. This initial join profile compares scalar kind and exact
decoded value; numeric keys compare their validated original token text. Thus
`1e3` and `1000`, or `-0` and `0`, are different keys, and JSON null never equals
the text `"null"`. This relation policy is distinct from canonical request identity
and lossless value retention. Numeric-value equality requires a separately stated
and qualified comparator while preserving the original tokens. Existing producer
or critic-oracle code alone establishes neither policy nor exact arithmetic.
SQLite json1 uses fixed parameterized traversals; callers
supply no SQL. JSON values are explicit target-document inspection. Byte hashes,
pointers and key qualifications accompany every relation. YAML/CSV/Markdown
adapters are outside this initial set.

## Runtime contract

Runtime modules declare supported intents, subjects, normalized observations,
protocol capabilities and dependency identities. The native layer owns runtime
identity, grants, role custody, event correlation, ref validity and settlement
for every module. Discovery and admission expose each module's declared runtime
operations and capabilities before sending backend requests.
Backend-specific state must retain its original observation and declared meaning.
LSP/DAP availability does not establish every protocol capability.

An observation is grant-free only for a qualified non-evaluating operation.
Pretty-printers, watches, getters, conditional breakpoints and target-loading
setup retain their actual effects. Runtime value display text, exact typed payload,
preview completeness and expansion authority are separate fields. Non-stop
debuggers bind the affected thread and handle lifetime; an all-stop assumption
cannot be inherited from another module. Language-level frames and values require
actual compiler/runtime mappings, including erased or affine Bend values.

Each runtime operation declares a reviewed lifetime profile consumed by common
reference admission: acquisition evidence, thread/context scope, valid states,
invalidation on mutation/replacement/loss/exit, and required publication checks.
Common Codec/Core owns identity validation and encoding; a provider cannot supply
an arbitrary authority codec. Runtime supplies authenticated observations mapped
through the admitted profile. Missing events do not imply perpetual validity.
Without demonstrated acquisition and lifetime, a module issues no live-value ref;
historical observed values remain readable with their evidence and limitations.

Bend2 debug support requires a separately investigated and qualified backend.
The pinned frontend assessment supplies no runtime frame/value/stepping API.
Runtime's Section owns that investigation and truthful discovery limits. The
CDP behavior below remains a concrete optional module profile. The owned
launch/role and cleanup rules apply to every effectful provider that uses them.

A runtime ID is `rt:<launch QUERY_ID>`.
Arbitrary PID attachment is refused as `attachUnqualified`. In the CDP profile,
`/json/list` is not
PID authentication or proof that no other inspector client exists. One Baton
adapter owns its connection; other local clients can affect the shared debugger
state. No exclusivity or hostile-local-user boundary is claimed.

The following closed intent forms specify the retained optional CDP profile.
Other runtime modules declare their supported subject schemas, serialization
classes, valid states and completion observations through the common boundary.
They retain common native ownership, grants, runtime naming and release duties;
they need no inspector handshake or all-stop epoch unless their profile requires
one. Non-evaluating observations while running are admissible when supported by
the qualified profile. `select` remains at the
request top level. `session` below is the runtime ID, not the requesting Player.

| Intent | Fields | Completion |
| --- | --- | --- |
| `launch` | `program`, `args` (array), `env` (complete map), `onOwnerStop:"terminate"`; optional `stopAt` position, `stopOnException:"none"|"uncaught"|"all"` | owned child and inspector handshake established, initial state recorded |
| `observe` | `session`; optional `thread`, `frame`, `object` (returned refs) | selected observations captured at one epoch, or explicit running/pausePending state |
| `pause` | `session`; optional `thread` | protocol acknowledgment records `pausePending`; actual stopped event completes the stop query |
| `resume-step` | `session`, `action:"resume"|"next"|"stepIn"|"stepOut"`; optional `thread` | protocol acknowledgment; later stop/exit is a separate event |
| `evaluate` | `session`, `expression`; optional `frame` | actual result or in-band exception observed |
| `release` | `session`, `onRelease:"terminate"`, `signal:"SIGTERM"|"SIGKILL"` | owned child exit and reap observed; no automatic signal escalation |

Runtime intents return the actual committed state. `accepted` with a null result
establishes admission and retained starter responsibility; target initiation
requires its separately recorded launch observation. They do not join target execution.
`context-result` retrieves completion. An observed stopped event can precede its
protocol response; that later acknowledgment cannot regress a completed query. An evaluation that never responds remains
pending until explicit release/owner stop or observed provider failure; no
runtime timeout changes it to success. Static/catalog queries whose selected
provider has an explicit response boundary return their completed result
synchronously under M-12's query exception. clangd diagnostic queries use managed
admission because completion depends on a later versioned publication. Model execution,
SQL planning, migration replay, module installation and module configuration
with nonempty effect grants use the same
detached admission/completion envelope and owner-notice path; their internal
query worker uses a retained one-shot adapter. Its keeper preserves output and
status across worker loss. Recovery attaches to that keeper and records only
what its retained evidence establishes. Unread output remains unresolved until
consumed; it supplies no inferred completion or interruption. Observed loss can
produce interruption with an unknown-effect reason and retained cleanup duty.
Recovery delivers owed notices without repeating the target operation. Killing the provider does not undo target effects or establish
server-side cancellation of an already submitted SQL operation.

A `query-control` request uses the ordinary `context-query` or file/MCP route
with its own control QUERY_ID. Its subject names an existing managed query,
`select` is exactly `["state"]`, `engine` is omitted or `auto`, and `options`
is empty. The native coordinator selects this branch directly. It does not run
provider discovery, take a new source snapshot or resend target work. The
controlled query's resolved engine identity is retained in the state result;
its provider evidence identifies the native lifecycle operation and the recorded
role identities. A control query cannot itself be controlled through this
subject. A query attached to a long-lived runtime uses the existing runtime
observe/release contract; this subject addresses managed queries with
`runtime_id` null, including one-shot effect and clangd diagnostic workers.
Unknown IDs, owner mismatch and incompatible query kinds refuse before effects.
Retained rejected preparation is also a supported control subject: recovery or
release can advance its cleanup and notice duty while its rejected decision and
refused state remain immutable.

`recover` validates the original database binding and recorded query/role/
incarnation identities, then resumes only owed observation, publication and
cleanup. A live keeper provides its existing control channel. With a missing
keeper and a qualified historical observer, the public call reports unavailable
control and that observer's retained duty. It cannot communicate through a
missing socket. Guard contention alone supplies no historical observer identity.
Public recovery with an absent or unreachable keeper reports unavailable
control and retains the last attempt-bound observation with its provenance.
It supplies no public orphan takeover. An existing historical observer
continues its own qualified orphan/spool observation and owed notices, including
notices still owed after guard release and newer work. A failed connection alone
cannot prove keeper death or a surviving observer. Recovery
cannot prepare or grant a second provider launch. A new control ID supplies no
new target-effect authority. Repeating the same canonical control request
returns its retained result. A completed control-query replay neither resends a
signal nor reruns provider reconciliation. The original managed observer's
separate duty to reconcile committed cleanup intent continues independently.

`Context.control_admit` is a new native admission function. Validate the closed
request and required grants before its `BEGIN IMMEDIATE` transaction. That
transaction checks canonical control-ID replay/conflict, the original database
binding, recorded owner and controlled query kind. For release it commits
query-wide cleanup intent and existing role intents with the control admission.
In that same transaction it reads the controlled query's resulting progress and
recorded observations, constructs the closed queryControl result and inserts
the control row directly as complete with that result. For recover it also records
`recovery_intent_json:{controlQuery}` on the controlled query. That intent asks
its original keeper/observer to resume the existing observation/notice duty; it
grants no new provider work. Release stores `{controlQuery,signal}` as the
controlled query's cleanup_intent_json; SIGKILL cannot be overwritten by SIGTERM. The control row has progress_json, cleanup_intent_json and recovery_intent_json
null and owes no independent progress or completion notice. Intent belongs to
the controlled query. No refused control request can leave cleanup intent. The role intent's initial
delivery is pending with null evidence; its controlQuery binds it to this exact
request. Later signal admission cannot overwrite an attempted signal without
retaining its outcome evidence and owed notice.

No keeper preparation, socket round trip or signal occurs in this transaction.
The complete result establishes the committed intent and an observation of
recorded state. It does not establish that a signal or recovery attachment has
occurred. Unobserved control remains unobserved; a missing round trip does not
manufacture controlUnavailable. After commit the ordinary controlled-query
observer reconciles its intent, performs only qualified original-keeper
operations and publishes progress/notices under that query's identity. The
public control handler returns the committed observation; its caller is not a
signal sender or continuation owner.

Caller loss before commit leaves no accepted control row or new intent. Caller
loss after commit leaves the complete observation and the controlled query's
durable duty. An uncertain commit reply is reconciled on the original binding
using the same control ID; no read recomputes or changes that committed result.
An identical canonical replay returns it without a signal, attachment or provider
reconciliation. context-result on the controlled ID supplies later progress.
The host gate must separately prove that a committed intent reaches the original
observer when the public caller dies before any keeper operation; atomic control
completion alone proves no wake or cleanup. No new control keeper or custody
store is introduced.

Each persistent native role observer starts one in-process
`Context.reconcile_intents` companion with existing `IO.fork`. The main
computation owns that role's attachment and spool reader. The companion first
reads committed query/role intents through the required bound SQL operation,
then uses `IO.sleep(1000)` between reads while that role has live or unsettled
duties. One second is the default reconciliation cadence to notice caller-less
intent without continuous database reads; it is neither a completion deadline
nor a retry-count limit. The companion continues while the provider is silent
and no release has been requested. It exits only when the role's child/capture,
cleanup and owed notices are settled, or when its observer process ends.

For a release intent the companion resolves the recorded keeper identity and
qualified prepared/started state. A confirmed prepared-without-start role uses
the shared proposed prepared-cancellation branch; no signal is sent to a
nonexistent child. Unavailable state retains unknown cleanup. For a qualified
started role it claims that role/control-query signal attempt in a transaction, then invokes
existing `ProcessChild.control_signal(directory,signal)`. It records syscall
acknowledgment or uncertainty and the owed progress/uncertainty notice in one
transaction. The main observer supplies actual child-exit and reap evidence;
a signal acknowledgment never supplies it. The existing operation signals the
retained child's process group. Direct-child exit/reap remains the cleanup
claim; group signaling establishes no reaping of descendants.

`release_intent_json` records `{controlQuery,signal,delivery,evidence}`, with
`delivery:pending|attempted|acknowledged|unknown` and nullable retained artifact
evidence. The claim moves pending to attempted before the syscall. A lost
observer or unavailable syscall outcome leaves an attempted delivery unknown
on recovery and owes an actual owner notice. It cannot be silently retried as a
fresh signal. A completed canonical replay supplies no additional attempt.
An owner may submit another explicit release under a new control ID; ordinary
SIGKILL ordering still prevents downgrade by SIGTERM. This signal-attempt state
uses the existing role intent field. It introduces no additional custody record.

For recovery intent the already attached observer resumes its own pending
observation/notice work and records the intent as observed; the companion does
not attach or consume the spool. If that observer dies, its keeper's existing
qualified disconnect/recovery path restores observation and checks intents at
attachment. With a missing keeper, the surviving historical observer retains
its existing qualified duty and publishes unavailable control. The public
handler acquires no orphan custody. Startup/grant boundaries also check intent,
covering a request committed before provider launch.

The pinned Base provides `IO.sleep`, `IO.fork` and channels. Its emitted runtime
parks blocking host work on helper threads, and sleep is an `IO_TIME` event.
A persistent observer process owns one role handle and one companion; distinct
role observers run in distinct native processes. This avoids assigning an
unbounded set of blocked role reads to one process's fixed helper pool.
Qualification must still exercise a silent provider, a blocked complete-line
read, simultaneous SQL/result events, multiple concurrent roles, observer loss
around signal claim/syscall/acknowledgment, and actual owner notice. The
companion uses the bound database path and the existing keeper control client;
it owns no listener, keeper, spool cursor or second attachment. These are new
native composition requirements grounded in existing effects, not measured
runtime behavior of the proposed feature.

`release` records the requested signal as cleanup intent for this query's
starter and one-shot adapter roles, including their unprepared plan entries,
in the same transaction as control admission.
Preparation/start/recovery reconciles that intent, so release before a start
grant prevents the provider launch. A role whose grant may already have occurred
requires retained state reconciliation and owned signaling. Concurrent pending
SIGTERM intent cannot overwrite an explicit SIGKILL intent. Cleanup is already pending at intent commit. Sending a signal
and receiving its acknowledgment record delivery evidence while cleanup stays pending. Actual exit/reap or
qualified prepared-without-start cancellation establishes completion for each
role. Provider effects already submitted remain possible; interruption never
asserts their rollback. If the original computation committed a complete result
first, preserve it and complete only remaining cleanup. Otherwise qualified
release ends it as interrupted with its captured partial evidence. Unavailable
control retains cleanup responsibility and the owner notice. No raw PID or
replacement database supplies signaling authority.

Control requests return a committed observation of the operation and cleanup
state; they do not block until process exit. The recorded observer continues
cleanup and delivers later state changes to the owner. A completed control
request is an observation of progress, not a claim that pending cleanup ended.
The controlled query remains inspectable with `context-result`. The new `Context.owner_admission` predicate admits a recorded active owner;
for a stopped owner it admits only owned query-control recover/release and owned
runtime release. Every ordinary computation subject refuses. This is a new
context predicate, distinct from the existing message-kind input gate.
Both control operations remain available for their recorded stopped owner. These are explicit owner operations even
when the owner's model harness does not support ordinary Stop.

A runtime belongs to the requesting recorded session for its entire explicit
lifetime. `originAttempt` is the exact recorded active attempt at launch, or null;
it is provenance, not an invented lifetime. Ordinary native turn/attempt end
does not release a session-owned runtime. An interactive Principal with no
attempt can launch and later observe/release it. Another requester is refused;
trusted operators can act using the recorded owner identity. The existing
`Stop.supported_sql` admission remains unchanged: it supports Codex/OMP owners
and refuses an active direct execution. Only an accepted stop invokes semantic
cleanup. It visits the owner's runtime target/adapter roles and retained
one-shot query roles, including a rejected query's prepared or cancelling keeper,
records SIGTERM cleanup intent, and leaves cleanup pending
until actual exit/reap or a qualified failure is observed. A starting role
reconciles that intent before provider launch, immediately after keeper startup,
and on observer recovery. A missing control socket does not complete cleanup.
The stop transaction and semantic admission share the `session_stops` ordering.
Semantic roles have their own records and never replace the owner's current
`executions` row. An owner without an active attempt can still own semantic roles.
An unsupported stop remains refused; runtime release remains an explicit owner
operation. This hook is required new integration, not existing keeper behavior.

The startup composition uses the proposed ordinary retained-process primitive
in `95bfccf0acefa151a667fa40a5f1fdfedafc5a80:docs/bend2/direct-start-672-proposal.md`,
the docs-only successor to `d47d5c11` with six independent design ACCEPTs.
These reviews establish the proposal assessment. Root has authorized bounded
direct95 and semantic implementation; shared host qualification remains required.
The `08dd2053` and `d47d5c11` reports
remain attached to their original pins.
`ProcessChild.prepare`, `start` and
`state` are proposed extensions of the existing keeper. Semantic composition
uses these shared host operations with its query/role identity and guard;
`Direct.begin` retains its model-turn-specific admission and session guard.
Semantic queries use their own admission rows and role guards, so an ordinary
owner turn can continue. Independent structural construction and read repair
proceed under their own gates.
The original direct08 assessments and their disagreements remain retained.
The successor specifies immutable rejection, Unknown continuation, legacy
inspection and parentless foreground completion. The semantic composition
retains the applicable obligations below; the proposed shared primitive remains
an unaccepted implementation dependency.

The private immutable bootstrap contains the canonical request, owner/query
identity, expected database binding, role guard and recovery argv. The request
prepares a keeper whose child launch configuration names the native semantic
starter handler. Preparation establishes the keeper, inherited guard, control
socket, spool and original/recovery observer attachment. It does not spawn the
starter or any target. `BR_READY` establishes observer attachment only.

The attached native observer validates the original database binding and owner,
then atomically commits semantic admission with the prepared keeper identity.
This is the earliest admitted managed-context state. It sends the shared
identity-bound start grant only after that commit. Public admission success
requires the committed result; started status requires an actual keeper state
observation. The native starter then records each target/adapter launch intent,
prepares that role's keeper, commits its authorized role start, and sends that
keeper's idempotent grant. Each role's direct custodian exists before the role
is admitted to perform an effect. Child-keeper observation and notice obligations
must be transferred before the starter role is released.

Recovery uses the same role guard and `--recover-context-role` entry with role
`starter`. It reads the original private bootstrap before any database access.
After request-observer loss it attaches the same prepared keeper, revalidates
and finishes admission if no decision exists, or observes the retained decision.
The admission transaction must preserve a refusal against a delayed competing
observer. A committed admission permits repeating only the same start grant.
The query's first accepted-or-rejected admission decision is immutable and
includes the original prepared keeper identity. Competing observers atomically
select or reuse that decision. An admission rejection records its reason and
canonical request in the existing coordination database before cancellation;
it grants no target effect and cannot later become an acceptance when owner
facts change. A failed or uncertain transaction response must be reconciled
against that same decision under the original database binding. It cannot be
treated as a committed rejection or justify a new keeper.
The shared keeper latches the grant before its one spawn; a lost grant reply or
ambiguous spawn cannot authorize another keeper or target launch. A refused
admission cancels the prepared keeper and returns the refusal without starting
the semantic child. Failure before preparation leaves no admitted query.

After the starter begins, its observer reconciles each recorded child role
through that role's own keeper. The starter keeper reaps only the native starter;
target and adapter keepers reap their direct children. A starter exit during
handoff must publish the observed failure or uncertainty, retain surviving
child custody, and perform native owner delivery under the verified original
database. Final starter acknowledgment requires committed responsibility
transfer. Prepared-keeper, post-spawn setup, repeated-grant and recovery-launch
behavior require the shared ordinary-path qualification; none is implemented
by the current eager `retain` handshake alone.

The actual process relationships and admitted failure responsibilities are:

| Live process or event | Direct custodian and observer | Required disposition |
| --- | --- | --- |
| Native starter handler | starter keeper is its process parent; request observer or attached recovery observer reads its retained output/status | attached observer commits admission before the shared start grant; its observer retains responsibility until child-role handoff or terminal result/notice responsibility is committed |
| Target bootstrap, then exec-in-place target | target keeper is its process parent; target observer owns the retained handle | target observer publishes output/exit evidence; adapter failure cannot reap or establish target exit |
| Adapter or one-shot effect provider | adapter keeper is its process parent; adapter observer owns the retained handle | adapter observer publishes protocol result/failure; existing target keeper remains responsible for any surviving target |
| Request observer disconnect after keeper preparation | starter keeper detects disconnect and attempts the persisted recovery argv | recovered observer must actually attach, reconcile the same admission/query and start grant and deliver owed native notices; BR_READY alone establishes none of those later events |
| Starter exits during child launch/handoff | starter keeper retains its exit; attached observer inspects each recorded child role | attach surviving child keepers and preserve captures/uncertain launches before publishing failure; never infer absence from a missing birth record |
| Target/adapter observer disconnect | that role's keeper attempts its persisted recovery argv | the new observer attaches the same keeper, reconstructs committed event identity and delivers owed notices without replaying the effect |
| Adapter exits while target survives | adapter keeper reaps only adapter; target keeper remains live | publish adapter failure, retain target capture, and permit owner release through the target keeper's validated control identity |
| Owner stop accepted during start or execution | native stop transaction records intent; starter and each surviving role observer reconcile it | refuse a new target launch after accepted stop, or send recorded cleanup to an already started role and observe its exit; queued/accepted signaling alone does not complete cleanup |
| Role keeper fails while its original observer survives | that historical observer retains its original role handle and qualified orphan/spool observation | continue lifetime observation and actual historical owner notice; new public or internal callers report unavailable control and acquire no orphan custody |
| Recovery spawn or pre-attachment setup fails while the keeper survives | the original keeper retains child custody and recovery responsibility | apply the shared direct95 retry and qualified recovery-child lifetime rules; retain first/latest failure evidence and permit at most one recovery child in flight |
| Keeper and every historical observer are lost | surviving custody and notification continuation are unproved | retain available evidence and report the limit; inspection or a free guard supplies no replacement owner or repeated-effect authority |

Observers are native coordinator processes using retained handles. Each
persistent observer owns one role handle and its in-process intent companion;
the role keeper remains the process parent of its child. Startup transfers each
child role to that role's own observer before relinquishing starter custody. Each keep-alive responsibility must be backed by the actual keeper
and recovery invocation. Persisted role rows and handoff labels alone do not
establish a surviving observer or a successful native delivery.

This is required new coordinator composition. Baseline98fbfe03 supports the
retained handshake and disconnect recovery path, but post-spawn setup failure
and recovery-launch failure can leave keeper-error or observer-error evidence
without completed cleanup or another wake. The root-authorized direct95 repair
requires the surviving keeper to retain and reap its child after post-spawn
setup failure, and to retry failed recovery launch or verified pre-attach exit
on its monotonic retry cadence. A successful recovery spawn followed by waiter
setup failure retains that child's qualified identity; another recovery spawn
requires evidence that its lifetime ended. Semantic roles use those common
requirements. Their implementation and selective-loss/actual-notice qualification
remain open. Total loss of keeper and all historical observers remains an explicit
unproved continuation boundary; an unavailable result establishes no survivor.

Each runtime has separate `target` and `adapter` roles. Each role owns one
shared prepared keeper and, after its admitted start grant, one direct child.
The target remains a direct
keeper child across the exec-in-place launch described below. The adapter never
owns or reaps that target. A retained one-shot effect query has an `adapter`
role with the same custody and notification rules. Each role records its owner,
query/runtime identity, incarnation, keeper directory, guard key, recovery argv,
capture cursor and cleanup state. Target exit evidence is written only by the
target observer; adapter failure cannot overwrite it.

The full guard identity is canonical JSON
`["context-role",databaseBinding,subjectKind,subjectId,role,incarnation]`.
The fixed leading `context-role` tag separates this digest domain from other
artifact and request identities.
`Context.role_guard_key` returns the 64 lowercase ASCII hexadecimal characters
of SHA-256 over that identity's canonical UTF-8 bytes. No identity member is
truncated or omitted. The bootstrap and role record retain the full identity;
admission and recovery compare it with the expected binding and manifest.
A digest/identity disagreement refuses without replacing existing custody or
records. The digest identifies a lock filename; acquisition establishes current
exclusion, and the full identity checks separately bind the operation.

`SessionLock.try_acquire` receives this digest string and the existing private
directory `<canonical-context-log-directory>/g` as its path anchor. Create that
fixed-name directory with mode 0700 before acquisition; require its canonical
parent to be the recorded log directory and its canonical basename to remain
`g`. The host appends `.lock-` and two hexadecimal characters per key byte, so
the resulting basename is `g.lock-` plus 128 characters, totaling 135 ASCII bytes.
Its representation is independent of query ID and database-path lengths.
Actual filesystem path/allocation errors retain their host failure; no additional
ID/path-length cutoff is introduced. Ordinary Player turn guards keep their
existing database-file anchor. Actual role guard handles go to the shared
prepared keeper; ordinary owner turns remain available. Keeper directories use
the same full-identity digest under the log directory and validate their retained
identity before reuse. Raw IDs do not become path components.

The persisted recovery argv is the absolute installed Baton executable followed
by `--recover-context-role`, canonical database path, expected database binding,
subject kind/ID, role, incarnation and exact keeper directory. This is an internal
entry, not an agent-facing remedy. It validates the recorded role and manifest.
With a live keeper it calls `ProcessChild.attach`, receiving the existing guard;
it does not first try to acquire the guard that the keeper still holds. A
competing attach returns busy. If that newly arriving internal recovery process
finds the keeper absent or unreachable, it returns unavailable control with the
original role/directory and retained evidence. It cannot use `attach_owned`,
start a companion, finish the result or adopt historical notice duty by acquiring
a free matching guard. The already owning historical observer continues its
qualified orphan/spool observation through its retained handle and original
identity, including owed notices after guard release. Unknown status after
keeper loss is not a reap receipt. This follows the same keeper-absent rule as
the common direct95 primitive.

An attached handle starts reading its spool at offset zero. The observer uses
persisted role/incarnation/event identity to skip identical committed events;
`attach` has no seek argument. Public follow-ups record a pending query, then
use `ProcessChild.control_write` for adapter requests or `control_signal` for
target termination. A sent target effect is never reissued merely to recover
observation. Launch/recovery uses the existing detached host-control entry path.
No provider writes coordination SQL itself.

The supported managed lifetime requires the coordination database file and path
to remain stable. Admission records a qualified physical-instance binding;
subsequent database operations check it to detect stable replacement or removal
between operations. A copied database token does not distinguish physical
instances. Concurrent replacement during an operation is excluded from the
supported guarantee. Neither a stat-before-open sequence nor a path digest
establishes concurrent file binding.

New host operations `Sql.binding(path)` and
`Sql.query_bound(path,expectedBinding,sql)` share one acquisition/check helper.
They open an existing regular coordination database with READWRITE and without
CREATE, reject a read-only connection, URI-selected VFS, in-memory and temporary
databases, and select a qualified local VFS. Before connection setup or caller
SQL, the helper obtains the main connection filename and checks HAS_MOVED,
including its return code. It obtains physical pathname identity after that
open and checks HAS_MOVED again. Under the stable-operation assumption these
observations bind the pathname to the connection; they do not expose SQLite's
internal file descriptor or prove concurrent identity.

The binding records canonical path, identity scheme/version, physical tuple and
VFS, plus a logical database token if supplied by the schema. Physical identity
uses device/file ID and a qualified incarnation discriminator. Size, mtime and
ctime change during ordinary writes and cannot serve as the discriminator.
The platform discriminator and its reuse limits still require qualification;
an unavailable scheme returns binding unavailable before caller SQL. A logical
token supplements the tuple and cannot distinguish a copied file. In-place
restoration preserving both tuple and token is outside the detection guarantee.
Bound calls compare physical identity first and then any token through that same
connection before executing SQL. They never initialize a missing token during
recovery. A late mismatch or SQL error retains possible prior effects as
uncertain and cannot trigger automatic replay.

The expected binding is also retained independently in immutable starter/role
recovery input. Recovery never obtains its expected value from the path being
checked. Every managed-context database access threads this value, including
admission, stop reconciliation, role/result publication and native notification
selection/handoff. Existing `Delivery.deliver`, `normal_delivery` and `handoff`
open the unbound SQL interface today; their managed-context path requires bound
execution of the same SQL/routing decisions. A checked entry followed by an
unbound helper does not satisfy the contract. Ordinary command semantics and
the root-approved control routing remain unchanged.

On database storage or binding failure, the original keepers retain custody,
captures and uncertain-effect evidence. New database-dependent effects and
publication through an unverified replacement are refused. The current response
channel reports binding failure where available; background publication and
owner continuation are unavailable while their required coordination interface
is unavailable. This condition does not claim a wake. Existing admitted cleanup
responsibility remains with its original keeper and observer. Under the healthy,
verified original database, observer-loss and adapter-loss recovery still require
retained responsibility and actual native owner notification.

The adapter serializes incompatible state-changing intents according to the
admitted runtime profile and rejects a second incompatible intent as `runtimeBusy`
before send. CDP observation uses its idle/stopped rule; other profiles use their
qualified observation states. Release remains available to the owner independent
of those observation states. The version-2 invocation/event envelopes in Installed
module contract are the sole common wire shapes, including the original module
binding and trusted plan. Only complete frames carry the validated result shape. State frames
carry runtime state/evidence; unsolicited state has query null. Malformed frames,
foreign runtime/query identities and repeated sequence with different bytes
fail the protocol. Replayed identical spool frames are idempotent. In one
transaction the observer validates role/incarnation/event identity, commits
state/result and the owed ordinary message, then advances the consumed cursor.
For a managed one-shot query, a state frame names that query and carries its
validated progress plus provider-event evidence. The same transaction stores
`semantic_queries.progress_json` and the owed progress notice. Initial waiting
state and later changed progress use role/incarnation/event identity; replay
preserves the original notice. Runtime-unsolicited null-query state remains
restricted to a recorded runtime. The public progress envelope reads committed
progress, including after observer recovery. A frame cannot invent cleanup
completion or replace separately required native lifetime evidence.
A completed event cannot become invisible to notice recovery merely because
its cursor advanced. Query-terminal notices use query identity even when
runtime ID is null; unsolicited runtime events additionally use role,
incarnation and event sequence. Replaying the same event preserves message body
and receipt. Native notice delivery retries do not repeat a target effect.
The runtime worker publishes terminal command results and
stop/exit/failure state changes as internal retained notices to the owner,
using the existing self-input SQL pattern in `Receive.recovery_input` and
native delivery. Context notices reuse that insertion shape only; they do not
clear or replace a native conversation identity. A stopped owner
routes cleanup failure to its existing stop/report destination. Notice delivery
uses the control completion/failure-owner contract; it cannot wait on an unwoken
agent. This notification integration is required host-tested implementation,
not evidence established by the runtime research. Recovery examines owed notices
independently of the spool cursor. Before final keeper acknowledgment, capture,
result and notice responsibility must be durable and the approved control
delivery/failure-handoff disposition must have completed. Worker death between
the atomic commit and delivery resumes that notice by identity. No receipt is
fabricated to clear custody. Keeper release and acknowledgment remain distinct
states; `recovery_argv` returning None after low-level release does not establish
that acknowledgment and notification finished.

### Optional CDP transport and observations

This subsection specifies the CDP module's backend behavior. Each additional
runtime module must supply an equivalent evidence-backed mapping to the common
intent, state, ownership and ref contract, with its actual unsupported operations.

CDP launch uses an ephemeral loopback inspector port and the owned child's actual
stderr endpoint. The initial wait uses `--inspect-brk=127.0.0.1:0`; endpoint discovery is
bound to the target keeper's direct child, birth identity and launch ID.
The target keeper launches the packaged Node bootstrap under `/usr/bin/env -i`.
That bootstrap reads the complete explicit target launch document from initial
stdin through EOF, validates it, then calls `process.execve` with the selected
absolute target Node, argv and complete target environment. Initial target
stdin is EOF; interactive target stdin is outside this profile. The bootstrap
and final executable identities are recorded separately. A surviving spawning
wrapper is not admitted. Actual same-child continuity and target environment
require host qualification.

The target observer starts capture and exit observation immediately. The adapter
keeper starts independently. Inspector discovery watches the private target
`native.stderr` with a filesystem-event subscription registered before a catch-up
read. It records byte offsets, handles partial/coalesced appends and refuses file
replacement/truncation or watch failure. This is required transport integration;
the existing ProcessChild change event watches stdout only. No timer establishes
inspector readiness. Adapter launch failure preserves target custody and release.
Source breakpoints are set
against generated locations after local source-map decoding. Startup performs
`Runtime.enable`, `Debugger.enable` and `Runtime.runIfWaitingForDebugger`; the
startup wait and a later actual paused event are distinct states. Maps are local
files or embedded data URLs; remote map fetch is unavailable. Source mapping
records generated and mapped segment positions and the map digest; it does not
claim reconstruction of renamed runtime bindings. Direct TypeScript execution
is not required: the qualification target uses compiled JS plus source maps.

Runtime state is `starting`, `waitingForStart`, `running`, `pausePending`,
`paused`, `releasing`, `exited` or `failed`. Results additionally expose each
role's child/observer/capture/cleanup state. An adapter failure may coexist with
a still-running target; `failed` alone is never a target-exit assertion. Detach is refused as
`detachUnqualified` until a retained reaping handoff is specified and qualified. A monotonically
increasing adapter-owned epoch advances at every observed pause and invalidating
resume/context destruction. A separate mutation generation advances before
explicit evaluation; previously issued live-value refs are retired. Every frame/object ref includes runtime, adapter,
thread, epoch and mutation generation. A stale ref refuses before a backend request. The backend may
reuse identical IDs at a later pause; adapter validation is mandatory. Observed external-client state changes during capture produce
`changedDuringCapture`. Every multirequest capture has its start/end event
identity, `consistency:"per-response"` and `controlExclusivity:"unverified"`.
A stable pause epoch does not prove immutable heap contents: undetected
external-client evaluation remains a limitation.

Non-evaluating values use property descriptors and script-source reads. Accessor
properties remain descriptors. Previews are explicitly incomplete and offer
expansion refs; `overflow:false` does not prove complete strings. Evaluation
checks both transport errors and `exceptionDetails`. Evaluation does not await
returned Promises; the Promise object is the result. Promise-await and automatic
execution cancellation are unavailable. The adapter continues reading control
input while evaluation is pending; release signals the target keeper's child without
waiting for a CDP evaluation response. Closing a connection does not roll back
target effects. Worker refs use distinct
worker/debugger/context identities. Worker breakpoint/scope/exception support is
unavailable until qualified; basic thread discovery/state remains supported.
Async frames state whether capture was enabled before the chain formed.

On terminate, native control sends the selected signal through
`ProcessChild.control_signal(targetKeeper,signal)`. It requires no adapter reply.
A live adapter keeps its inspector connection until target exit, then closes it
and exits. The target observer independently waits for keeper status and actual
direct-child reap. It preserves raw stdout bytes and the selected stderr capture
before low-level release/acknowledgment; reconstructing bytes from `read_line`
would lose delimiter information. Exit waiting is independent of an unfinished
stdout line. Target-created descendants and inherited output descriptors remain
outside the direct-child reap claim; captures name the observed byte range.
A signal acknowledgment establishes no
exit. SIGTERM that leaves a process alive leaves release pending; the owner may
explicitly submit SIGKILL with a new query ID. Owner stop selects SIGTERM, retains
cleanup ownership and reports a pending/failing cleanup to the stop destination;
no elapsed timer triggers escalation. A query naming a stopped owner is admitted
only for release of its recorded runtime or query-control recovery/release of
its recorded managed query. Release includes the observer repair
needed to attach to the recorded keeper and finish cleanup. It cannot relaunch
the target or resend uncertain CDP effects. Adapter cleanup has its own retained
exit/capture/release/acknowledgment state. Adapter crash is distinct from target
exit; its connection state becomes unavailable while the target keeper continues
ownership and observation. Connection loss can resume a paused debuggee, so
retained custody does not establish continued pause. Keeper loss is separate:
`control_signal` has no orphan fallback. It returns a truthful pending/unavailable
release with retained evidence and notice responsibility; it cannot claim reaping.
Raw PID alone never authorizes signaling after ownership is lost. Inspector
endpoint URLs/UUIDs stay internal and never enter returned context or errors.

## Host effects and credentials

The provisional `Process.run` design is replaced. Its implementation inherits
both `environ` and stderr (`bend2/src/git/process.c`), and cannot accept stdin.
It therefore cannot enforce the specified adapter boundary by itself.

Read adapters use `ProcessChild.spawn`, `write`, `close_stdin`, `read_line` and
`wait` from `host/process.bend`. A direct adapter consumes the complete input
frame before emitting stdout; premature output is a protocol defect tested for
pipe deadlock. Direct-child cleanup consumes output, closes stdin and waits;
`release`/`acknowledge` apply only to retained handles. argv starts with the fixed
environment boundary `/usr/bin/env`, `-i`, explicitly constructed base assignments,
then the admitted module entry vector. The Node profile uses an absolute Node
executable and absolute packaged adapter path. Other modules bind their actual
interpreter/native executable and dependencies in the same package authority.
The provider process starts after
`env` clears inherited variables. The base consists of a PATH made from the selected absolute provider directories plus
`/usr/bin:/bin`, private HOME/TMPDIR, and `LC_ALL=C`; explicit target runtime env is a separate
child-only input. Node preloads/options, harness credentials, agent HOME and
package-manager settings are absent. Raw request bytes travel on stdin as one
NDJSON frame. `ProcessChild.spawn` supplies private retained stderr and uncapped
stdout. Managed adapters use the same argv boundary through the shared proposed
prepare/start path; request
frames use `control_write`. Host tests must verify actual child environments,
not only the constructed argv string. The macOS-injected
`__CF_USER_TEXT_ENCODING` is accounted for as platform state.

No shell parses target bytes. Private directories/files use the existing
artifact mechanism with directory mode 0700 and file mode 0600; stdout is protocol-only.
Stderr/protocol diagnostics remain local retained artifacts. A refusal returns
a safe condition and artifact path, never raw provider stderr. Inline bodies,
SQL, expressions and target env values do not become argv. No body/output byte
ceiling or wall-time cutoff is added. Host resource errors are failures with
retained evidence.

Read admission includes the subject root, explicitly admitted dependency/config
roots, fixed provider resource files and explicit model/database/sample paths.
Real paths and symlink targets enter the manifest. Source adapters enforce their
read interface/argument closure; executing target modules is ordinary local
execution under an explicit effect grant, with broader filesystem effects
stated. This is not a malicious-project sandbox. The coordination database is
refused as a target database. No automatic environment subject accesses process
environment values. Explicit source/document/runtime inspection may return
credential-shaped target bytes; the trusted-local output policy states this.

Automatic environment and discovery projections use their structural field
allowlist. They do not scan for secrets or include arbitrary free-form strings.
Raw source/runtime evidence is returned only by explicit inspection projections;
provider stderr is never reused as such evidence. Harness material is excluded
before adapter startup and is never deliberately supplied to any target child.

## Persistence and transitions

New tables join the existing Store transaction initialization:

- `semantic_queries(id PRIMARY KEY, owner REFERENCES sessions, request_json,
  admission_decision, prepared_keeper_path NULL,
  cwd, origin_attempt NULL, state, result_json NULL,
  error_json NULL, progress_json NULL, cleanup_intent_json NULL,
  recovery_intent_json NULL, runtime_id NULL, artifact_path)`;
- `semantic_runtimes(id PRIMARY KEY, owner REFERENCES sessions,
  origin_attempt NULL, launch_query UNIQUE, adapter_id,
  state, epoch, pending_query NULL, outcome_json NULL)`;
- `semantic_roles(query_id REFERENCES semantic_queries, role, incarnation,
  keeper_path UNIQUE, guard_anchor, guard_key, guard_identity_json, recovery_argv_json,
  database_binding_json, phase, observer_identity_json NULL,
  observer_cursor, exit_evidence_json NULL,
  capture_json NULL, release_intent_json NULL, cleanup_phase,
  PRIMARY KEY(query_id,role,incarnation))`. Runtime roles reference its launch
  query; one-shot roles reference their own query. The role is `starter`, `target`
  or `adapter`. It records actual child custody and recovery responsibilities.
  Owed notice IDs are derived from the retained query or role/event identity
  and stored as ordinary `messages`; a second notice outcome store is unnecessary.

JSON columns have `json_valid` checks; state/classification/subject/evidence
validators use SQLite json1 plus the selected declaration schema. Each result is one JSON column, preserving tabs and
newlines through json1 escaping. Foreign provider output is validated before
publication. No hand-written completion census or expected-failure manifest is
introduced. Query records are functional replay, result and runtime recovery
state. Logs retain raw evidence under existing retention rules.

The query's retained admission input also contains ModuleBinding, normalized
operation and dependency/effect plan. These belong to the existing admission
record and immutable bootstrap; their final column/encoding placement is owned
by Lifecycle with Core. Retained refs carry their original module/schema/policy
association. Recovery and result lookup do not consult a new module registry or
reselect a provider from the current project. Physical database binding and
current held owner authority remain separately qualified prerequisites.

Admission commits once before provider effects. Synchronous read queries run after
admission and atomically change running to complete/failed. Managed queries and
runtime creation commit admission through the observer of the already prepared
starter keeper, before its shared start grant.
`validationRefusal` is the exit-2 refusal class for an invalid request, missing
grant or failed pre-preparation prerequisite. It creates no query/runtime and
starts no provider. `admissionRejected` is the exit-2 refusal class for a
committed rejected decision after preparation; it retains the query, canonical
request, reason, prepared identity and progress/cleanup duty. Both use the public
`{error,command,condition,next}` refusal shape: error names the class, condition
names the fixed failed predicate, and next is literal navigation argv. A retained
rejection's next is `["context-result",QUERY_ID]`. Its row has state refused,
result null and error `{kind:"admissionRejected",condition,limits:[]}`.

Before a verified admission decision, two further exit-2 outcomes use the same
outer `{error,command,condition,next}` object. They are error-discriminated closed
forms; the codec's own fixed-text refusal conditions remain unchanged.

- `error:"hostPreparationFailed"` has condition
  `{stage,query,owner,plannedDirectory,preparedEvidence,code}`. Stage is
  `guard|manifest|prepare|socket|spool|observerAttach`, code is the actual numeric
  host error or null, and plannedDirectory is the selected private directory or
  null if selection failed. preparedEvidence is null or a retained
  `{path,sha256,pointer}` artifact reference. A planned pathname supplies no
  evidence that preparation succeeded. This outcome reports the failed stage
  and available evidence; it asserts no absence of a keeper or child.
- `error:"admissionUncertain"` has condition
  `{query,owner,plannedDirectory,preparedEvidence,decision:"unverified"}`.
  It reports that original-binding reconciliation has not established an
  accepted or rejected decision. It authorizes neither a new keeper nor a fresh
  effect. The original prepared keeper/observer retains its duty where available.

For either outcome, next is `["context-result",query]` when a verified retained
row exists; otherwise it is `["context-query-file",owner,query,"-"]`.
The latter requires the caller's original request on stdin. Error output never
includes that request's body. Reentry compares its canonical request and owner
with the same original preparation and reuses only the shared serialized
observation/admission path. It cannot interpret an absent query row, absent PID
file or failed connection as permission to prepare another keeper.

The initial starter uses incarnation `"0"`; its binding/query/role/incarnation
derive the same private directory and role guard before preparation or any retry.
Query IDs remain globally unique. That guard and immutable bootstrap distinguish
a fresh preparation from an existing or uncertain one even before a query row
exists. An unavailable or contradictory bootstrap keeps reconciliation uncertain.
No public caller takes orphan custody. If the original keeper survives, its
serialized observer admission may finish the original accepted/rejected
transaction; keeper-absent public recovery remains unavailable. Qualification
must prove the bootstrap/guard ordering across partial preparation failure.

These four outcome classes preserve different evidence: validationRefusal has
performed no keeper preparation; admissionRejected has a verified immutable
rejection; hostPreparationFailed reports a host-stage failure; admissionUncertain
reports an unverified decision. No undecided semantic query row is fabricated.
If a decision row already exists, preserve its accepted/rejected value and expose
its retained outcome and cleanup. Failure of a child-role preparation after
acceptance belongs to that query's failure/interruption and progress path.
A pure `Context.admission_error` builder pins each closed surface and its stage
mapping in operative laws. Host truth and same-preparation reconciliation are
separate fixture obligations. No error or new caller request supplies an
unobserved no-start fact.

Keeper preparation precedes final owner/binding admission. Admission rejection
retains a refused query decision and its prepared keeper identity, then cancels
that keeper before its child starts. That functional refusal record is not an
admitted managed context for provider effects. It remains readable through
context-result and control-addressable for observation and cleanup. Cancellation
failure retains cleanup responsibility.
If a prepared keeper dies after committed rejection and before cancellation
acknowledgment, the historical observer may settle cleanup only from the exact
rejected request/directory, immutable prepared-mode manifest/protocol version,
qualified ended keeper lifetime, and the qualified shared protocol assumption that every
possible grant sender must read an accepted decision for that identity. The
immutable rejection excludes such a grant. Missing child PID/birth records
supply no no-start proof. Contradictory start evidence or unavailable binding,
manifest or lifetime keeps rejection immutable with cleanup unknown and actual
owner-notification duty. A new public caller has only the unavailable-control
inspection branch; it cannot acquire historical cleanup custody. This branch
inherits the proposed shared protocol and needs separate semantic-composition
qualification; no current host guarantee is claimed.
`Context.rejected_cleanup_ready` composes four evidence predicates:
`sameRejectedBinding`, `preparedProtocolBound`, `keeperLifetimeEnded` and
`acceptedDecisionRequiredForGrant`. A semantic law pins their conjunction and
its placement before cleanup completion/guard release. The final predicate is
a cross-process protocol assumption owned and host-qualified by controls-next's
shared-process implementation; a Bend law proves neither that protocol's foreign
execution nor keeper lifetime. Live cancellation remains a separate branch.

The rejection transaction stores cleanup pending and an owed ordinary message
with the closed body `{version:1,kind:"context-admission-rejected",query,owner,
condition,progress,observations,next}`. Observations use the control-result shape;
next is `["context-result",query]`. Its stable message identity is the canonical
JSON array `["context-admission-rejected",query]`. Later cleanup changes have
separate role/incarnation/event identities and preserve the original notice.
Unknown cleanup reports progress.cleanup unavailable, never accepted admission.
Delivery follows the ordinary owner/failure-destination contract, including for a
stopped owner. A rejected prepared query retains progress_json and per-role
cleanup until qualified settlement; an exit-2 response alone settles no custody.
An unavailable original database cannot record a winner; its uncertain decision
and keeper custody remain governed by the storage-failure boundary. Post-commit launch
failure preserves the failed row and failure owner. Duplicate IDs compare canonical request/owner;
concurrent insertions cannot start two providers. A worker claims the accepted
row transactionally before launch. Interrupted startup/effects remain explicit;
a retry reads the row and cannot silently duplicate execution.

Results become complete only after schema validation and consistency checks.
The first committed terminal computation state (`complete`, `failed`,
`interrupted` or `refused`) is immutable. Later provider events may advance
cleanup and owed notice delivery, with their evidence retained; they cannot
replace that terminal state/result/error or publish a second set of facts.
Completion and release contend in the same query transaction: completed results
remain complete; a committed interrupted result cannot become complete on a
late diagnostic publication. Control results are immutable observations of their
own operation, while context-result on the controlled ID reads later progress.
A killed adapter, malformed JSON, foreign query ID or missing required evidence
cannot publish facts. Provider facts retain exact evidence values while the
coordinator adds query/owner/applicability fields. Checked classification requires
its extra oracle fields; the validator establishes shape, not oracle truth.

## Packaging

The baseline package manifest carries the common native runtime and lightweight
trusted module descriptions. Each separately selected module package manifest
carries its entry/schema/dependency members, integrity hashes, licenses and exact
runtime requirements. The existing package/configuration authority verifies each
selected closure and its correspondence with the trusted description.
Selection cannot load a declaration from target source, an ambient package search
or a runtime download. Adding a module updates those installed members and
configuration through the ordinary package path. Merely listing a supported
module does not stage its implementation. Core, Codec and result/ref
algorithms remain unchanged for an extension within the supported declaration
schema; normal imports, composition entries, laws and payload additions are
permitted as specified above.

Bend2 qualification must include the actual pinned frontend and ownership checker,
Base and imported library bytes, extraction adapter, original-source mapping and
the qualified check-only execution path. Complete frontend API/dependency capture
is still a Code/package deliverable. A compiler executable hash or version alone
does not qualify its libraries or the extracted semantics. The import-fetch path
described above must refuse unavailable captured dependencies before network or
cache writes. Existing compiler checks stay on the selected remote toolchain.

Module readiness reports declared, present, verified and actually qualified
capabilities distinctly. Package relocation/readback must validate the original
manifest graph against the extracted bytes, including schemas and transitive
dependencies. Removing a dependency makes its module unavailable with an exact
cause; it does not weaken admitted refs or substitute another producer. Upgrades
retain bindings needed by live queries or explicitly refuse new work while their
original duties remain owned.

Staging follows the selected manifest graph. It does not recursively copy every
context implementation or resolve every language's lockfile dependencies.
Common schema/recognition data has its own reviewed minimal closure. A provider's
discovery entry that imports its compiler cannot serve baseline discovery.
Selected activation may probe only that closure under its admitted operation;
unused provider libraries and tools are absent from the query's loaded resources.
Module-specific gates run for the selected artifacts. An explicit full-profile
qualification job may select several modules, retaining that broader effect scope.

Root84's source assessment identifies the current c795 combined Node dependency
set, unconditional `compose_context`, recursive source staging and all-library
gate as pending package corrections. TypeScript's provider `--engines` currently
loads its compiler. Those paths do not implement this selective boundary. Native,
CI and Code must return concrete per-module staging/activation exports and their
exact source composition before installed acceptance.

### Retained optional provider packages

First-party adapters are staged under `libexec/baton2/`, with package-relative
imports. The optional Node profiles retain pins for TypeScript5.9.3, Ajv8.17.1
and Zod4.3.6 plus Ajv's resolved dependencies. Each module stages only its actual
consumer dependency closure. The historical combined `bend2/context/package.json`
and npm lockfile are source pin evidence; their partition into separately
installable closures requires package-owner review. Exact versions and integrity
hashes remain mandatory.
`package-native.py` verifies the lockfile-resolved bytes, stages licenses and
third-party notices, records payload/source hashes and includes distribution
entries. Provider invocation performs no installation or ambient `node_modules`
resolution. The explicit native package-resolution operation above retains its
separate authority and effect receipt.
The C combined-query payload includes `libexec/baton2/context-clang-20`, a
first-party C++ LibTooling extractor built against LLVM/Clang20.1.8, and the
fixed Fossil helper summary, with source/build and summary hashes in package
metadata. Its closure comprises the actual helper definitions and the supported
literal-copy rule; there is no runtime helper-summary registry or target-supplied
executable plug-in. The summary matcher checks parsed declaration/body inputs
before adding a modeled SQL edge. Generated frontend inputs are supplied by the
target's existing authentic build and consumed read-only. Packaging neither runs
that build nor substitutes preauthored result rows. The extractor links the
`clang-cpp` target and LLVM dependency selected by the pinned ClangConfig.cmake.
The initial package uses the explicit external LLVM20.1.8 dependency. Its gate
checks actual dylib resolution, architecture, resource headers, SDK access and
provider identities on the installed artifact; an absolute Homebrew link does
not establish relocation. The source-backed C++ API has not yet been compiled
as the proposed extractor. The fixed-profile build-association decoder requires
implementation and qualification against the closed receipt formats above.
C SQL joins use the native linked-library planner described under
Data projections; no Node or CLI fallback is selected. The separate Node
entity/TypeScript profile retains its stated readiness and limitations.
Target Zod schemas load in the explicit target child using the target
module's resolved dependencies. Its resolved Zod package must be exactly 4.3.6;
version mismatch refuses before model execution. The captured module resolution
closure and sample enter the snapshot. Arbitrary reads made by project code
can prevent complete closure capture; such results carry applicability unknown
and execution limits. Bundled Zod supplies provider probes and API support; it
does not silently replace a project dependency.

Migration replay uses a proposed narrow native operation over the SQLite
library already linked by the packaged coordinator. A retained native replay
child invokes that operation; its keeper captures completion and failure under
the one-shot effect rules. The child uses the packaged coordinator's own code
and library. The ordinary coordinator database SQL interface remains unchanged.
The operation accepts captured revision/script inputs and fixed catalog
projections; it exposes no request-selected authorizer callback or open mode.
Native Bend logic validates chain/checksum/applied-prefix consistency and compares
returned catalogs. Live applied rows and catalog facts are read in one read-only
transaction; prefix and head replay each use a separate private connection.

The measured darwin-arm64 build links `/usr/lib/libsqlite3.dylib`, reporting
SQLite3.54.0 at runtime, against the Xcode SDK SQLite3.43.2 header. The
`sqlite3_set_authorizer` API is present in that header and library. Qualification
records header identity, linked library, `sqlite3_libversion`, `sqlite3_sourceid`
and compile options. An engine change requires requalification; a missing
required capability makes replay unavailable before script execution. The
retained Python3.14.3/SQLite3.53.0 experiment remains a differential research
comparison. Python is not a packaged migration dependency.

The authorizer is installed successfully before the first target statement.
The replay action allowlist is `SQLITE_SELECT`, `READ`, `TRANSACTION`,
`SAVEPOINT`, `RECURSIVE`, `INSERT`, `UPDATE`, `DELETE`, `ALTER_TABLE`,
`REINDEX`, `ANALYZE`, `FUNCTION`, `PRAGMA`, and each CREATE/DROP action for
TABLE, INDEX, VIEW and TRIGGER in main or temp. The latter names mean the
corresponding explicit SQLite action constants. Every other action refuses,
including ATTACH, DETACH and CREATE/DROP_VTABLE. Internal catalog writes and
functions needed by ordinary DDL remain allowed on the private replay database.

For `SQLITE_PRAGMA`, compare names with `sqlite3_stricmp` and admit only
`foreign_keys`, `legacy_alter_table`, `defer_foreign_keys`, `user_version`,
`table_info`, `table_xinfo`, `table_list`, `index_list`, `index_info`,
`index_xinfo`, `foreign_key_list`, `database_list`, `schema_version`,
`application_id`, `encoding`, `page_size` and `secure_delete`. SQLite supplies
any argument separately; these admitted names retain their engine-defined
forms within the private database. All other names refuse regardless of case
or presence of an argument. In particular, both read and write forms of
`journal_mode`, `temp_store`, `synchronous` and `mmap_size` refuse. Internal
initialization/readiness reads occur before installing the script authorizer.
The measured `pragma_allowlist` probe is the evidence for this selected rule;
results from its separate deny-list modes do not widen it.

For `SQLITE_FUNCTION`, reject `load_extension` case-insensitively and permit
the qualified library's other built-in functions. A fresh child/connection
registers no application functions or extensions. An unknown function name is
left to SQLite resolution and does not trigger registration or provider lookup.
The selected library has no `readfile` or `writefile` SQL function; that is a
qualified library fact. Engine or extension-function changes require a new
qualification. The policy constrains SQLite operations and does not prove
foreign library correctness.

Before opening any connection, the dedicated replay child configures its
process-global `sqlite3_temp_directory` to its recorded private scratch
directory. The coordinator process is unaffected. Each replay connection opens
`:memory:` and sets and verifies `PRAGMA temp_store=MEMORY` before installing
the authorizer. Scripts cannot change that setting or directory. Readiness
checks require supported initialization and the expected value. Temporary
artifacts are admitted only within that owned scratch boundary; the result
records this possible effect. The retained spill experiments produced no
observed spill, including their positive controls, so they do not qualify
absence of temporary writes or the actual spill destination. Installed host
qualification must establish the private-directory behavior for the selected
library/VFS before advertising that boundary.

No arbitrary page, statement or time cutoff is introduced. Allocation and
engine failures retain their actual codes. Explicit cancellation can set the
replay child's cancellation flag checked by a SQLite progress callback. The
native child's SIGTERM handler sets that flag for an owner-authorized keeper
release or supported stop; the callback returns nonzero only when it is set.
Callback cadence is
not a deadline or work limit. A native process release still follows the
keeper's observed exit and evidence-preservation rules.

Statements execute with their explicit transaction semantics. Preparation,
stepping and finalization failures identify the revision and statement, preserve
the original SQLite error, and invalidate that replay's catalog. NUL in captured script text refuses before preparation; otherwise the host uses
explicit byte lengths and consumes every returned tail through the script. A
malformed trailing statement fails the replay; a final statement needs no
semicolon. After the complete chain, an open transaction reported by
`sqlite3_get_autocommit` is an error, not successful catalog completion. The operation
must finalize every prepared statement and check `sqlite3_close` on every
return path. `sqlite3_close_v2` deferral alone does not establish cleanup. Scratch
removal follows final capture/result persistence and keeper acknowledgment. A
child crash leaves scratch cleanup with its original role custodian. A killed or failed native replay child leaves an unknown or failed
one-shot result with keeper-owned capture; observation recovery cannot replay
the script. Data-dependent migrations expose the empty-replay-data limitation
and cannot establish equivalence to the live data state. This policy constrains
admitted SQLite operations; foreign engine correctness remains a qualified
assumption.

External dependencies of these optional profiles: Node22.15.0+, LLVM clang/clangd20.1.8, psql14.18 with a
user-operated PostgreSQL14.18 server. Native SQLite operations qualify the
actual linked library described above. Their retained research platform is
darwin-arm64; installed module qualification remains separate. `context-engines` reports executable/version,
prerequisites and per-projection readiness. Upgrades require scoped requalification.
No Swift/LLDB/OPA binary is bundled. The native binary's existing Node-free
operation stays distinct from the adapter/helper Node requirement.

The optional Node package gate runs with Node22.15.0 and the qualification host's Node, with
ancestor modules and development paths unavailable. It proves package-relative
resolution, license/integrity checks and useful provider results. CI selecting
merely Node22 latest is insufficient floor evidence.

## Laws and acceptance

Whole-feature review uses the corrected Bend2-first language scope. Earlier
backend approvals retain their measured/source scope. They do not qualify this
module contract by inference. Independent criticism covers language/module
extension, semantic correctness, agent ease-of-use and minimality. Root's feature
comparison is complete for this scope. Review of changed behavior and unresolved
defects proceeds with implementation. Historical missing final-spec reports and
unchanged final-pin reconciliation do not block this authorized work.

The first useful installed qualification is Bend2. Through actual CLI and MCP,
select real definitions and imports from the admitted source closure, expand refs,
inspect declared and checked type context, and return exact checker diagnostics.
Use independently expected source locations/relations and a completed pinned
checker observation. Include invalid quantity use, declaration-order failure,
missing import, dependency edits, a real proved law, a missing proof and an
unsafe/foreign dependency. A wrapper-only response, source-name inventory or
unavailable-only result cannot satisfy these cases. Runtime/debug gaps must be
visible through discovery without suppressing useful code context.
The uncaptured-import negative observes no BEND_HUB retrieval or BEND_LIB write,
paired with a qualified captured-closure positive. Actual resolver observations
and filesystem/network effects establish this boundary.

Module extension qualification installs a second description and selected package with a distinct ID,
subject/options schema and entry through the existing package path. Preserve the
shared validation, selection, admission, normalization and result/ref algorithm
sources; permit the module's normal imports, composition declaration, operative
laws, payload and configuration additions within the relevant artifact. Rebuild
and qualify each changed executable remotely, retaining source diffs and
binary/package identities. The common baseline must not link the new provider
implementation merely to describe or select it.
Exercise useful query, result and expansion through both public surfaces. Verify the actual
selected entry and schema, recorded effects, dependency bindings and normalized
facts. This test must fail if shared code selects the historical engine list,
uses a language suffix switch, ignores the declaration schema or consumes a
foreign producer result. Installing a real preferred-language module then
qualifies its facts on its own target; a synthetic extension establishes only
the generic boundary.

Selective-loading qualification uses Bend2-only, individual preferred-language
and mixed projects through installed CLI and MCP. Inspect actual archive and
installed dependency members, loaded libraries, probes, processes and attributable
memory cost. Include a known unused module with absent payload and observable
initialization: discovery and unrelated queries must leave it untouched. Separately
install that module with fixture instrumentation and repeat the unrelated calls;
its initialization/probe/library markers remain untouched. A selected positive
control must demonstrate that the instrumentation detects real initialization.
Its expected starts/probes follow the controlled fresh invocation and resource
state; compatible retained reuse may correctly avoid another initialization.
Instrumentation belongs to the fixture, not the product declaration. Exercise
missing selected dependencies through the proposed native resolution operation,
failed/uncertain installation, changed project configuration and two projects
sharing a compatible selected resource. Releasing one project must preserve the
other's live work. Measure actual package/process cost with recorded scope;
an enabled flag or unavailable-only answer does not establish isolation or useful
language support. These are remote qualification requirements, not measured savings.

Installation controls replace the inspected declaration/configuration between
inspect and install, omit the selected payload, deny the grant, lose the caller
before/after admission and publication, and reconcile the original uncertain
attempt. Inspect must still report native state while the language payload is
absent. Pair successful install with old analysis-ID replay and fresh analysis,
and with later destination loss plus historical install replay. Concurrent
staging/publication/cleanup preserves other owners. Navigation must supply a
schema-valid expected-bound request through actual CLI and MCP. Shared-host cases
include final release concurrent with acquire and stale-incarnation release;
observe logical holders, physical custodian, outstanding responses and notices.
Package-file reuse and process sharing have separate evidence. Memory measurement
distinguishes shared mappings, existing holders and transient initialization;
unchanged aggregate RSS proves no absence of loading.

Reference migration controls exercise each complete closed version, missing and
duplicate claims, foreign producing steps, unsupported versions, legacy raw
readability without expansion authority, and qualified absence only after intact
version-admitted lookup. New snapshot identity algorithms bind kind in both
construction and comparison under a reviewed version. They do not rewrite
retained historical snapshotId bytes or prove consumed-byte consistency from
provider tags or pre/post equality alone.

Surface/protocol controls exercise unscoped and attachment-scoped MCP discovery,
duplicate decoded scope names, including escaped duplicates, invalid scope values/types, missing attachment
and attempted body session injection. They discriminate scope loss in the codec
success frame and prove target-free unscoped behavior. Module transport controls
mutate one binding/owner/plan/role field, substitute a version-1 frame or replay
a foreign event; no result may publish through a private backend bypass. Generic
runtime controls use a supported running-state observation and a non-CDP lifetime
profile. Data controls preserve nested dictionaries, number-versus-text identity,
large signed/exponent tokens and recursive values through publication and refs.
Validator verdict, target throw and prelaunch refusal retain distinct outcomes.
An escaped spelling of one valid scope key remains valid; escape syntax alone
is not a duplicate. Configuration controls include stale expected identity,
denied write authority, lost completion and historical replay while live queries
retain their original configuration. Actual filesystem and DB owners must qualify
their respective atomic update boundaries.

Single-defect negative controls cover unknown/duplicate module identities,
disabled or ambiguous selection, schema/entry/dependency replacement, unsupported
protocol, undeclared options, omitted transitive effects, wrong result producer,
forged ref operation/policy, package upgrade during live work and missing retained
module on expansion. Positive and negative source must compile through the
admitted path. Structural failure does not count as the intended semantic refusal.

Then qualify Elixir, Rust, Go, Python and TypeScript independently with the same
native operations, beginning with the dependencies actually available. Include
an Elixir/Phoenix/Ash subject whose framework/model/policy links can be checked
against actual source and generated metadata. Cross-language projects retain
producer and snapshot identity at each edge; unsupported joins remain explicit.
Additional languages use this same acceptance boundary. Effectful framework and
debug operations retain all grant, cleanup and recovery gates below.

The common runtime compile imports operative laws through `coordinator/laws.bend`.
Each separate module build imports its own operative laws, and every artifact
composition that links it retains those laws.
Laws bind actual parse, admission, effect construction, classification and result
functions. Host/provider truth remains a named assumption exercised by native
fixtures. The full `laws-check.mjs` includes proof-removal and implementation
mutation controls; unimported scratch laws establish no delivery gate.

Required real-function laws cover command/declaration-schema parsing; exact declared
module/operation selection; ambiguity/refusal and dependency-effect union;
schema/version/producer binding on results and ref expansion;
missing-effect refusal before spawn; strict scalar UTF-8
decoding of hex-framed SQLite values; parent-linked JSON reconstruction and
array ordering; MCP metadata validation and exclusion from canonical identity
and effect admission; canonical retry/conflict;
result ID/owner/evidence validation; failed-provider no-publication; structural
environment value exclusion; explicit adapter environment construction; ref
snapshot/epoch validation; applicability from recorded/current identities; query
claim before target launch; prepared keeper and observer before managed admission; committed admission before start grant;
runtime owner and transition rules; complete role-identity construction and
fixed-length guard-key encoding; query-control owner/kind validation,
atomic intent/result publication, replay without control effects,
no-relaunch recovery and release-intent ordering; version/URI-bound clangd
diagnostic completion including empty publication; and each main dispatch
arm. SQL equality laws prove assembled statements; native tests prove their
transactional behavior. No count/line-number/output-size pins qualify semantics.

Host checks cover stdin bodies beyond argv capacity, Unicode/NUL/error handling,
actual sanitized environments, private stderr, symlink/dependency roots, disabled
project driver/plugin effects, concurrent same-ID launch, malformed/forged output,
recovery with uncertain effects, owner-stop cleanup, pending pause/evaluation,
resume/stale-handle refusal and late provider death. Child-held-open fixtures
prove that runtime admission returns before target completion. Completed result
notices must reach the owner through native delivery. Copied DB fixtures clear
endpoints before writes; fresh fixtures are preferred.
Controlled adapter death must leave the target keeper reachable, preserve target
output and deliver the failure notice; public release must then observe actual
target exit/reap. Independent observer-loss cases cover each runtime role and
each one-shot effect class without effect replay. Exercise public query-control
through native and MCP for stopped owners, release before grant, release after
provider submission, concurrent completion/release, repeated control IDs and
keeper loss with a surviving historical observer. Invoke delayed internal
recovery both before and after that observer releases its guard while its
historical owner notice remains owed. A failed connection proves neither keeper
death nor observer transfer. Require unavailable control, no second observer/companion
or effect, and actual notice delivery by the original holder. Separately exercise
the fixed guard representation with long admissible database paths and Unicode
query IDs: identical full identities contend, distinct query/role/database
identities acquire independent guards, and full-identity mismatch refuses reuse.
Verify ordinary owner-turn progress while those guards are held. The pure
guard law binds complete canonical identity and key construction; actual
filesystem acquisition and SHA-256/UTF-8 behavior require host qualification.
Kill a public control caller
before its transaction, after commit and before any keeper operation, and after
an operation before response. Reusing the exact control ID must return the
original committed observation; the controlled query must independently reconcile
its intent and deliver the actual owner notice. A clangd fixture sends idle
without diagnostics and proves running/unobserved state and actual owner notice,
then either sends a matching empty publication or exercises explicit release.
Also test wrong URI/version, versionless publication, late matching publication
after release, and actual provider failure independently of silence. A controlled crash after the
result/cursor/message transaction but before notice delivery must recover native
wake from the owed notice. Another crash before final acknowledgment must retain
output and cleanup responsibility. Qualify ordinary owner turns while role
keepers are live and stop both before and after keeper creation. Keeper death,
observer death and adapter death have separate expected evidence.
Starter qualification kills the request before/after preparation, admission
commit and start grant, then kills starter/observer before child-keeper creation
and during handoff. Under the healthy original database, every admitted query
must retain a concrete outcome and actual native owner delivery. Bootstrap
failure must not manufacture an admitted query or launch a target. Partial
keeper setup and recovery-launch failure receive their own disposition tests;
an observer-error artifact alone does not qualify owner notification.
The shared startup qualification must distinguish changed-request replay from
duplicate live execution. A completed identity with conflicting normalized
request bytes refuses without launching a replacement. After selective observer
loss, a socket-responsive original child retains its own role, output and
completion responsibility; later accepted work cannot overwrite that role with
an owner's newer execution. Semantic queries retain their independent identities
when an owner legitimately starts another query. Busy-lock refusal while the
first observer lives is a separate negative control and does not establish
custody after its death.
Stable database replacement/removal between operations must refuse new effects
through that path and retain the original custody and capture evidence. The
test includes a copied database carrying the original logical token. It records
publication/continuation as unavailable when their required database interface
is lost. Concurrent path replacement is outside this qualification. Healthy
original-database recovery tests separately require actual native owner wake.
The request corpus exercises invalid raw UTF-8 versus literal U+FFFD, escaped
duplicate keys at nested object/array locations, lone surrogate escapes,
numeric spellings before conversion, nested selector coordinates, declaration
offsets above U32, decoded NUL in both names and values, astral characters,
empty arrays versus arrays containing null, noncontiguous json_tree IDs,
multidigit array indices, and code-point key ordering. CLI file/stdin and selected MCP
frames must share the admitted canonical request and effect refusal. Rejected
requests must leave query state and target launch markers unchanged. These
tests qualify the foreign parsers; native ordering mutations qualify the laws.
Native codec and MCP integration cases exercise all three context tools with
metadata absent, `{}`, string progress tokens (including astral characters), and
numeric tokens `-1`, `0.5`, `1e3`, `4294967296`, `9007199254740993` and `1e400`.
The `0.5` case distinguishes the selected receiver profile from the published
JSON Schema integer branch. The mathematically integral `1e400` case exercises
host-conversion overflow handling; the integer branch supplies no magnitude limit.
Direct CLI and MCP submissions of the same owner/query/request must store identical
canonical bytes and replay the same admitted query when only metadata changes.
Observe actual query rows and provider launch markers: metadata must neither
create another effect nor supply a missing grant. Codec output and forwarded
request bytes must exclude metadata. An opaque metadata member containing nested
JSON exercises whole-frame validation without entering the request tree.
Malformed metadata containers, invalid progress-token types, duplicate escaped
`_meta` or `progressToken` names, malformed UTF-8, lone surrogates and decoded NUL
must refuse before dispatch with unchanged state and launch markers. A paired
negative case places a fractional, signed, exponent or above-U32 token in a
context request numeric field and still refuses, even with valid metadata.
An ID-less frame with valid metadata still performs no dispatch. These are
candidate acceptance requirements; this specification supplies no execution result.
An environment tool-override fixture writes a harmless marker before emitting
a valid version. Without `executeTarget`, admission refuses and no marker or
child launch occurs. With the grant, the execution and its effects are recorded
as target-controlled execution. Merely comparing a constructed argv is insufficient.

The following retained optional-module cases also run through installed CLI,
MCP and generated briefing on real external targets, with independent inspection
of exact source and values. Their passes qualify those profiles individually:

1. One ordinary native query for the authentic Fossil `view_list` source subject
   returns its real empty handler formal list, typed global permission operands,
   nonempty resolved `db_prepare` parameter types, direct calls, diagnostics,
   discovered guard/denial/effect relations and the same-local-`Stmt` SQL join to
   actual `reportfmt` catalog constraints/access. No authorization declaration,
   manually supplied CFG edge or helper-call selector is an input. Native refs
   expand the call, predicate operands and catalog entity with shared identities.
   Changing the actual guard changes the derived relation; changing helper bodies,
   callee identity, statement alias or SQL formatting prevents unjustified joins.
   Ambiguous generated/original mappings refuse that edge. The installed result
   preserves ordinary-allocation/helper assumptions, declared build/link
   association, `implementationLinkUnverified`, opaque script limits and distinct
   target/external SQLite versions. Actual parsed definitions and resolved call
   identities must support the source model. An unauthenticated receipt or symbol
   inventory cannot qualify executable contribution. All five fact families
   must be useful in this same-handler result. Separate TS and C results cannot
   satisfy this combined-handler case.
   A separate ordinary query selecting the authentic `db_prepare` definition
   must return its actual nonempty formal list and variadic status; successful
   callee expansion alone does not replace this selected-function qualification.
2. A TypeScript handler independently qualifies its aliased constant-SQL join,
   model export/use, validation and serialization. A rejected sample names the
   actual rule and source; serialization shows a concrete transformation. A
   shadowed client and dynamic SQL do not manufacture links. Migration
   prefix/head comparison distinguishes pending changes, changed checksums and
   actual live-schema drift. Optional C predicate-query acceptance states its
   compiler model and unsettled cases; ordinary guard discovery does not inherit
   that checked classification.
3. A compiled TS Node program returns correctly mapped exception/stack frames,
   scopes/values and worker state. Resume/change/pause refuses old handles;
   incomplete previews expand completely. A disk edit and loaded-source identity
   remain distinguishable. Getter descriptors do not execute during observation.
4. Environment facts change after a transitive config or resolved-package change,
   preserve origin and refuse ambient credential inheritance. JSON dataset joins
   return correct record pointers and duplicate/missing-key qualifications.
5. WAL DDL invalidates schema applicability; data-only writes do not. A change
   during source capture cannot publish `current`. Missing providers, malformed
   maps, absent symbols and unavailable projections retain their actual causes.

A canned adapter result or an unavailable-only run qualifies plumbing only.
Each advertised module's useful projection must pass. Exact Node22.15 API behavior
for the optional Node profile, dependency packaging, migration
provider compatibility and runtime cleanup/notification remain acceptance gates.
This document does not claim those installed native gates have run.

The composed candidate runs `build-native`, full `laws-check.mjs` and
`check-native` on admitted remote runners. Independent substantive review covers
changed contracts and behavior; completed reviews remain attached to their scope.
Native fast-forward publication and remote readback retain their actual authority
and evidence requirements. The landing gate compares selected tests on target and
change and blocks regressions; known target breakage belongs in the issue tracker.

## Ownership and evidence

`semantic-synthesis` owns this document and semantic integration review. The
existing Code Associate Conductor and primary Section own the substantive Bend2
frontend module. Native owns the common module declaration/admission/invocation,
Codec/Core/ref and Lifecycle composition, coordinating installed dependency and
archive closure with CI and the original package owner. Models owns framework,
data/security/environment relationships through this boundary. Runtime owns
debug capability mapping and the existing CDP/Values work. Controls and sole
Interfaces own the shared command/MCP/discovery/orientation composition. Existing
domain critics and the Quality Ensemble independently assess substantive changed
contracts and behavior. Synthesis integrates their source-scoped contributions and
resolves cross-owner dependencies. Existing owners exchange concrete callable
arguments, results and source changes directly through registered tight peer routes.

Compatible pure/result/provenance/grant/lifecycle repairs, CI, Instance and Receive
continue under their current assignments. Affected fixed-provider paths cannot
land as satisfying the corrected feature. Source implementation proceeds in parallel
where dependencies permit, using the reviewed contract. Runtime and Models work
continues independently of unrelated module gates. Optional modules carry their
own dependencies and operative laws.
For the independently authorized #671 repair,
the registered `semantic-controls-interfaces-research` Player exclusively owns
shared commands/main/MCP/help/briefing and the final read candidate. Structural
proposal `2543678035631371a6f024a1c58ac9ec16239c12` has six design ACCEPT verdicts;
controls-next owns its structural module, laws and Recruit factoring, with a
separately owned structural fixture. That approval performs no semantic or
optional-startup effect. Controls-next owns the #672 direct-start proposal and
shared keeper design, with bounded direct95 implementation authorized and host
qualification still open. Semantic package/store/law and entry owners coordinate
concrete producer/consumer changes directly within this implementation authority.
`native-receive-conductor` first owns #669/#670 repair to
commands/turn/receive and associated laws/tests. Feature branches rebase onto its
reviewed landed result before overlapping edits. No shared file is edited by
both feature owners concurrently.

Existing Sections implement the Bend2 module,
common module boundary and the independently supported module profiles in parallel
according to their real dependencies. Each source/test region keeps one owner.
Qualification proceeds Bend2 first, then the preferred modules with their own
effect/dependency evidence. Existing query/runtime records retain functional
state; installed module declarations use the existing package manifest.

The retained research used for this specification is retrievable with native
`delivery MESSAGE_ID` and the files named by those messages:

- Root81 `root-semantic-language-correction-81` and Root82
  `root-semantic-source-boundary-82`: Bend2-first scope and static module
  composition. Their canonical feature/amendment documents are Root-owned;
  source composition must retain both documents with this specification.
- Root83 `root-semantic-project-loading-83` and Root84
  `root-semantic-package-boundary-84`: project detection, separately installed
  payloads and selective activation; canonical documents at
  `b3cd9fbba6c0c8629add60e2d86af95ed52245a3` supersede the universal static
  composition interpretation in intermediate candidate `fee9f193`.
- `code-bend2-contribution-38`: pinned loader, parser, checker, declaration-order,
  source mapping and useful Bend2 query requirements; complete frontend closure
  and actual provider qualification remain open.
- `code-bend2-corrections-reviewed-41`, `code-bend2-semantics-review-43` and
  `code-bend2-source-review-complete-45`: conditional PROOF rule, event-completion
  and quantity-instrumentation limits, corrected duplicate-fill and optional
  diagnostic evidence. Independent source review is complete at that scope;
  the actual frontend module and qualification remain due.
- `native112-module-contract-candidate`, `models-module-review-synthesis-36`,
  `models-env-review-37-synthesis`, `runtime-module-contract133-synthesis` and
  `controls-next-interfaces-review-101-synthesis`: owner contributions to the
  declaration, schema, effect, framework, runtime and public surface boundaries.
- `native113-module-contract-reconciliation`,
  `native114-reviewed-successors-supplement` and `models-module-final-38-synthesis`:
  common effect minima, authenticated original/current ref associations, actual
  storage migration requirements and payload numeric-domain limits. Their concrete
  proposals retain their original scope; changed contracts and unresolved defects
  receive substantive review during implementation.
- `quality-language-fidelity-contributions-83-semantic-synthesis` and
  `quality-language-critic-contributions-84-semantic-synthesis`: independent
  candidate requirements, including their retained corrections to earlier
  frontend claims. These contributions are not verdicts on this successor.
- `models-spec-source-39-synthesis`, `models-spec-security-40-synthesis`,
  `code-spec-review-48`, `runtime-spec140-corrections-synthesis` and
  `controls-next-spec-review-105-synthesis`: intermediate-candidate corrections
  to scoped MCP codec, common transport, runtime profiles, schema expressiveness
  and target-execution outcome/capture semantics.
- `native115-consolidated-boundary`,
  `controls-next-loading-reconciliation-106-synthesis` and
  `quality-loading-contributions-89-semantic-synthesis`: authenticated ref inputs,
  physical primitive gaps and controlled unused-module qualification. Actual
  package installation/configuration exports remain owner handoff work.
- `quality-d27-review-reconciliation-91-semantic-synthesis`,
  `controls-next-successor-review-107-synthesis`,
  `controls-next-quality-reconciliation-108-synthesis`,
  `code-spec-successor-review-51`, `code-author-corrections-closed-56`,
  `code-package-reviewed-d27-57`, `models-final-review-42-synthesis`,
  `models44-security-closure`, `runtime-spec142-final-pin-synthesis` and
  `native117-wire-reconciliation`: retained installation navigation/custody,
  shared-host holder, frontend precision and versioned-ref corrections. Their
  predecessor findings retain their exact source scope.

- `semantic-code-lane-report-1`: public API/binding/flow producer qualifications;
- `semantic-models-lane-report-1`: data joins, model/migration probes, security
  model limits, environment origin and effect evidence;
- `semantic-runtime-final-report` and `semantic-runtime-sig10-result`: CDP
  observations, source maps, handle reuse, launch/reap and native target failures;
- `semantic-language-design-report-1`: Bend/JSON/host boundaries;
- `semantic-integration-laws-research-report-1`,
  `semantic-integration-delivery-critic-turn-1`, `delivery-research-report-1`,
  and the integration workspace's `semantic-context-integration.md`: law,
  packaging, CLI and host source evidence;
- root task `root-continuation-semantic-synthesis-1`, contract review 3 and the
  root M-12 delivery decision: scope, final review gate and ownership;
- `root-semantic-build-trust-boundary-20`: initial source-model guarantee and
  separation of historical executable contribution from modeled access;
- approved structural `2543678035631371a6f024a1c58ac9ec16239c12`, direct-start
  `95bfccf0acefa151a667fa40a5f1fdfedafc5a80` and scoped stable read
  `e2e06950d1ccf6a61d66ac0eb2f623fbbb3eb2d7`: common control/read conventions,
  with their separate implementation, host and installed qualification gates;
- `root-semantic-mcp-metadata-30`: transport metadata compatibility and replacement
  of the stale control cross-reference;
- `semantic-observations-synthesis-verdict-1`,
  `semantic-security-synthesis-contract-1`,
  `semantic-models-data-critic-corrections-1` and
  `quality-synthesis-transport-response-1`: bounded correction evidence.

Research demonstrations establish component feasibility under their stated pins.
This specification preserves those optional profiles within the common module
boundary. Its Bend2 integration, module extension, new joins,
transport composition, runtime worker and owner cleanup are implementation work,
with host acceptance required before support can be advertised. Root110 authorizes
this implementation. Independent criticism, operative laws and remote acceptance
establish the behavior delivered by the resulting source and installed artifacts.
