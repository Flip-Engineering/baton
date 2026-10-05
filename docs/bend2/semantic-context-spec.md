# Native semantic context implementation specification

Status: docs-only specification for independent review. Runtime implementation
requires the independent review and root feature comparison. The requirement is
[Native semantic context](semantic-context-feature.md), `6929bffe` with the
credential clarification `98fbfe03`. Source baseline is `98fbfe03`; Bend remains
2.0.25 and the adapter Node floor remains 22.15.0.

The control conventions are sections 3.1–3.5 and 6 of the Orchestra-control
specification. The current cross-reference is successor
`75eee9a76310c2586be544930e38125257a21ff3`, incorporating `85f20618` and the
continuation corrections. `semantic-controls-next` owns that document; its six
independent reviews are pending. The final approved pin must replace this review
status before root authorizes implementation.

## Supported scope

Baton2 queries external target software and returns programmatic facts with
source or runtime evidence. The initial implementation has the following fixed
providers. Each provider answers its own capabilities and observed readiness.

| Engine | Supported subjects and useful results | Provider |
| --- | --- | --- |
| `typescript` | TS/JS definitions, types, references, calls, dependencies, flow diagnostics, throw/catch structure, constant-SQL code accesses | TypeScript 5.9.3 language service and public compiler API |
| `clangd` | C/C++ definitions, references, types, calls and diagnostics | external LLVM clangd 20.1.8, LSP |
| `clang-analyzer` | C translation-unit CFG, resolved guard/input/effect paths and model-scoped predicate verdicts | external LLVM clang 20.1.8 AST JSON, analyzer plist and DumpCFG |
| `cdp` | owned Node program, generated/original frames, scopes, values, exceptions and worker state | Node inspector; adapter implements CDP framing and source-map decoding |
| `sqlite-schema` | entities, columns, keys, constraints and constant-SQL opened objects | `node:sqlite`, read-only connection |
| `postgres-schema` | PostgreSQL entities, relationships, constraints and admitted constant-SQL plans | external psql 14.18 and PostgreSQL 14.18; other versions require qualification |
| `data-model` | SQLite migration state/drift; JSON Schema validation; Zod validation/serialization linked to resolved model use | SQLite, Ajv 8.17.1, Zod 4.3.6, TypeScript resolver |
| `environment` | Node dependency declarations and disk resolution, effective TS configuration, C build configuration and declared service topology | data readers, TypeScript configuration API, fixed version probes |
| `json-dataset` | document structure, selected values and explicit key relationships | JSON parser and SQLite json1 with fixed queries |

The code profile covers TS/JS and C/C++; the security profile covers C. Swift,
Rust, Objective-C, Python model execution, arbitrary ORM/query builders and
native LLDB debugging are outside this initial supported set. Their research
remains retained. Missing capability answers name their scope and reason.
Successful unavailable answers do not satisfy feature acceptance.

The runtime report demonstrates CDP on Node 25.8.0. Node 22.15.0 runtime behavior
is an implementation acceptance requirement. Native LLDB target creation failed
with SIGBUS across the three installed builds before an inferior existed;
`--no-dependents` established static symbols only. No native C runtime support
is claimed. Static exception propagation across calls is unavailable; source
throw/catch structure and observed CDP exception frames have the separate
meanings specified below.

Baton2 coordination telemetry, task scheduling and generic storage remain in
their existing commands. Context uses query results and runtime-session records
in the existing database. Providers compute from admitted target inputs; no
shared graph service, provider plug-in registry or indexing daemon is added.

## Native surfaces

```text
baton2 DATABASE context-engines [--pretty]
baton2 DATABASE context-query SESSION QUERY_ID REQUEST_JSON
baton2 DATABASE context-query-file SESSION QUERY_ID PATH
baton2 DATABASE context-result QUERY_ID [--pretty]
```

`context-engines` returns `{engines, runtimes}`. An engine entry has `engine`,
`provider`, `version`, `executable`, `projections`, `effects`, `availability`
and `limits`; the availability is `available`, `unavailable` or `excluded`.
Failed probes remain visible. Runtime rows name owner, origin attempt if any,
state, pending query IDs and the next observe/release operation. This command
runs fixed provider version/capability probes and reads coordination state.
It never loads a target project or starts a debuggee.

The requesting SESSION must exist and be active; the release exception for a
stopped owner is defined in Runtime contract. Its recorded workspace supplies
omitted `cwd`; a session without a workspace supplies `cwd`. The CLI uses the
trusted-local declared identity convention. MCP obtains SESSION from its
attachment; it does not infer an identity from a request body. Query identities
are unique across the coordination database.

MCP tools are `baton2_context_engines`, `baton2_context_query` and
`baton2_context_result`. Query arguments are `{query, request}` with `request`
a JSON object. MCP writes the serialized object to the native command's file
input (`PATH -`) through stdin; it does not put a large body in argv. Omission
is preserved. Both surfaces call the same native validator and return the same
result schema. Success is one JSON document, exit 0. New-family refusals,
including unknown identity, use exit 2 and `{error, command, condition, next}`.
MCP sets `isError` and places that JSON in text content. Refusals echo identifying
fields only; bodies, expressions, environments and connection credentials never
appear in refusal text.

The shared native orientation function places a context discovery/query example
in receive and direct-turn briefings. Conductor adapter orientation and MCP
initialize instructions use the same content. Help names selectors, effects,
ref expansion, result retrieval and failed-provider remedies. Context adds its
commands to existing command/help/MCP registration points.

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
  "engine": "typescript",
  "subject": {"kind":"position","path":"src/handler.ts","line":40,"column":17},
  "select": ["definition","type","calls","diagnostics"],
  "cwd": "/work/application",
  "options": {},
  "effects": []
}
```

`select` is a nonempty set of strings from the table below; unknown or duplicate
projections refuse. `engine` defaults to `auto`. Auto uses the subject kind,
source suffix and requested projections to select exactly one engine; ambiguity
returns candidates. It never executes several candidate backends speculatively.
`options` and `effects` default to empty. Explicit engine selection remains
available when an extension or provider is ambiguous.

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
| `ref` | `query`, `id` | projections admitted by the stored referenced selector |

`database` is `{engine:"sqlite-schema",path}` or
`{engine:"postgres-schema",connectionFile}`. The latter is an explicitly supplied libpq service file with one selected
section `[baton_context]`, stored outside returned facts. The adapter sets
`PGSERVICEFILE` to that absolute file, `PGSERVICE=baton_context`, and invokes the
selected absolute `psql -X -w -d service=baton_context`. Required certificate/key
paths are explicit target connection inputs; a default password-file lookup is
disabled by private HOME and an explicit empty private PGPASSFILE. No ambient PG*
variables, `.psqlrc`, password file or service file is inherited. Connection
identity in results has engine, server version, database and role, with endpoint
credential fields omitted. Password-bearing connection strings never enter argv.

`options` for source queries admits `project` (config path), `readRoots` (array
of admitted dependency/config roots), `database`, `client` (position selector for
the expected database-client declaration), `security` (defined below), and
`analysis` (`cfg` or `predicate`, with `predicate` requiring existing source query sites).
Entity `codeAccesses` requires `options.code` (source position/symbol) and
`options.client`. `databaseAccesses` requires `database` and `client`. The
compiler resolves actual call bindings to that declaration and returns the
joined relationship; a declared name alone cannot establish a client call.

The `code` field on a model is a source position/symbol selecting its importing
handler. The TypeScript resolver links calls/imports to the selected module
export. The caller supplies its role as a model; the resolved identity and
observed model behavior have their own evidence.

`effects` is a set drawn from `executeTarget`, `planTargetSql`,
`replayMigrations`, `evaluateRuntime`, `controlRuntime`. Every operation has a
fixed required subset. A missing grant refuses before its effect. Grants are
explicit trusted-local consent, not an OS sandbox. Read-only catalog/source
operations need none. Runtime launch/resume/pause/step/release require
`controlRuntime`; evaluation also requires `evaluateRuntime`. Zod module
loading requires `executeTarget`; PostgreSQL target SQL planning requires
`planTargetSql`; SQL migration replay requires `replayMigrations`.

Inline/file queries share parsed-object identity: the adapter canonicalizes JSON
with sorted object keys and preserved array order before admission. Duplicate
object keys and invalid UTF-8 refuse; integers requiring more precision than
JSON/JavaScript safely represents are strings under their field's schema. The
admitted canonical body, owner and resolved defaults are retained. Same ID and
same canonical input replay its row without rerunning an effect; conflicting
reuse refuses. A failed or interrupted query keeps its ID. A new query ID is
required for a fresh computation.

## Results, classifications and references

Every answer is `{version,query,owner,state,result,error}`. `state` is `accepted`,
`running`, `complete`, `failed` or `interrupted`; `result` is null until complete,
and `error` is null except for failure/interruption. An admitted failed query is
a retained outcome at exit 0; admission refusal is exit 2. `context-result`
returns that envelope with current applicability assessed where safe.

A completed result has `engine`, `provider`, `subject`, `snapshot`, `facts`,
`relations`, `refs`, `limits`, `coverage`, `applicability` and `changedInputs`.
`facts` and `relations` contain objects with unique local `id`, `kind`,
`classification`, `value`, `evidence` and `limits`. Relations additionally have
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
Limits include node/depth budgets and unvisited paths. No oracle outcome proves
universal program behavior outside that model.

`refs` is an array of `{id,engine,subject,snapshotId,projections}`. IDs are
canonical JSON arrays serialized as strings, for example
`["source","/work/a.ts","<sha256>",40,17,"definition"]` or
`["runtime","rt:q7",3,"worker:2","object","handle:9"]`. Encoding uses JSON
escaping; implementations do not split refs on punctuation. A ref query uses
`{kind:"ref",query:"q7",id:"..."}`. The coordinator loads the retained entry,
checks its original snapshot and required effects, then expands that selector.
Unknown IDs refuse. Stale source/schema refs return `staleReference` and a fresh
selector in the remedy; runtime refs require the same live epoch. Expansion
preserves the original evidence and limitations. Facts cannot gain a stronger
classification merely through expansion.

The request-handler use case returns resolved parameter/callee/diagnostic and
admitted code-to-schema or guard relationships in the same result. Referenced
entities, guards and scopes are individually expandable; agents do not construct
edges by matching snippets. The exception use case returns the exception, its
observed stack, mapping provenance and expandable scopes from one captured stop.

Primary documentation and package notices belong to engine declarations and
this specification. Routine queries do not fetch documentation or require
network citation hashes.

## Input identity and capture consistency

Source snapshots contain a query-local `snapshotId` (SHA-256 of canonical provider/input identities), provider identity, effective
options, worktree commit/branch/dirty metadata and actual read identities.
Worktree metadata alone establishes no source identity. The TypeScript host
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

Runtime identity is the owned runtime ID, adapter instance, owned child PID,
loaded-script digest, debugger/context/worker IDs and integration pause epoch.
PID alone is not identity. Disk bytes, loaded bytes and source-map bytes are
separate identities. A generated source map records its transform relationship.
A captured runtime value is a historical observation after resume; it never
becomes a fresh live value through `context-result`.

`applicability` is `current`, `stale`, `historical` or `unknown`. Read-time
revalidation runs only the original safe file/catalog probes. It never replays
migrations, loads model code, evaluates a debugger expression or recompiles a
project. Changed inputs are named; failed revalidation is `unknown` with its
cause. Same-ID retries return the stored computation with updated applicability.

## Code projections

TypeScript uses `LanguageService` definitions/references/call hierarchy and
`TypeChecker` symbol/alias/type resolution. Config parsing uses the public
5.9.3 declarations. Explicit `types`/`typeRoots` and recorded resolution roots
prevent ambient ancestor packages from silently supplying types. `dependencies`
returns resolved import declaration edges and resolution inputs. Reference and
highlight roles retain provider read/write distinctions.

`flow` exposes narrowed types, definite-assignment diagnostics, unreachable-code
diagnostics under the actual compiler options, and `never` results. `exceptions`
exposes resolved throw expressions and enclosing try/catch/finally structure.
Those syntax relationships do not establish cross-call propagation. Async,
callback, getter/proxy, dynamic dispatch, `any` and interface-to-implementation
limits survive expansion. No public TypeScript CFG API is assumed.

clangd supplies types, references, call hierarchy and diagnostics. The separate
`clang-analyzer` `flow` projection parses LLVM20.1.8 DumpCFG into function-local
blocks, branch expressions and predecessor/successor edges. Evidence links each
edge to emitted block identity and source range; unsupported mapping is marked.
Analyzer plist witnesses retain each path event and branch decision. Compiler
frontends parse target code with fixed options; the invocation executes the
pinned analysis tool and emits only into the query's private artifact directory.
It performs no subject build, link or executable launch.

## Data projections

SQLite captures table/view/column/index/FK/constraint declarations through
`sqlite_schema`, `table_list`, `table_xinfo`, `index_list`, `index_xinfo` and
`foreign_key_list`. PostgreSQL uses `pg_class`, `pg_attribute`, `pg_constraint`
and associated catalog functions. DDL expressions are attributed text;
CHECK-expression semantics and rename history are not inferred.

Constant-SQL code joins resolve the caller through TypeScript and compare its
resolved declaration with `options.client`. Literal/template SQL without
substitutions is passed to the selected database's parser. A parameter or
same-name shadowed function does not match. Unknown database receiver bindings
and dynamic SQL emit limitations at their exact call sites.

SQLite `EXPLAIN` rows map `OpenRead`/`OpenWrite` rootpage and database index to
catalog object identity within the same connection. Reads and writes have named
operation edges; aliased targets use catalog names. Views expose engine refusal
or measured rewrite behavior. Built-in SQL only is admitted for this profile:
loadable extensions are disabled, ATTACH is refused, and unsupported virtual
objects/functions report unavailable. PostgreSQL uses `PREPARE` plus
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

`migration.chain` is an ordered array of `{revision,path,sha256}`;
`applied` is `{table,revisionColumn,checksumColumn}`. Initial replay supports
SQLite SQL scripts only. It captures applied rows and the live catalog read-only,
then replays the captured chain into private databases with the same SQLite
provider. One catalog represents the recorded applied prefix; another the full
chain. Results name pending revisions, checksum divergence, catalog differences
from the recorded prefix, and proposed head constraints. An absent/inconsistent
applied record yields `migrationHistoryUnknown`; out-of-band change is not
inferred from the head comparison alone. Replay requires `replayMigrations`.
The runner prohibits ATTACH, extension loading, external writes and project SQL
functions through an authorizer-capable SQLite interface; if that interface is
missing, replay is unavailable. The Node22.15 binding lacks that interface, so
this projection uses the separately pinned SQLite replay helper specified in
Packaging. No migration runs against the target database.

## Security projections

The initial profile is C in one translation unit analyzed with pinned LLVM
20.1.8 front-end and Static Analyzer builds and the subject's known build
options. Supported relationships use direct calls, scalar principal/action/
resource operands, conditional rejection, and local non-escaping records
whose field stores, loads and aliases the provider can resolve. Every
relationship names its actual analyzed entrypoint and supported path.
Unresolved dispatch, cross-translation-unit effects, unsupported aliases,
loops or recursion that the selected analysis cuts, macros without an exact
source mapping, identity-provider validation, and C++ have explicit
unavailable/incomplete status. A partial result retains independent facts.

The subject supplies a reviewed authorization declaration. Its security
roles are `declared`; compiler analysis supplies the source relationships.
The declaration identifies the exact principal operand, action and resource,
guard condition, accepted branch, rejection terminal and sensitive call.
An action label such as `delete` names declared semantics of that selected
callsite. It does not authorize classification of every similarly named call.
A principal value's trusted origin is a separate declared assumption or
separately evidenced identity check.

**Selector and identity contract.** The closed request subject kind
`security` has `{declaration:{path,sha256}, requirementId}`. The declaration
names the translation unit, compile-command identity and entrypoint. The
engine is `clang-analyzer`; projections are `declaration`, `guardPaths`,
`inputPaths`, and `predicateQueries`. A position query requesting `authorization` supplies this selector in
`options.security`; it returns the resolved guard/input/effect relationships
and links to the security subject. The same source snapshot is required.

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

The declaration file is `{schemaVersion:1, requirements:[Requirement]}`;
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

Acceptance must return a complete source-linked principal/guard/deny/effect
relationship and a complete input-to-effect-argument path on that subject.
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
Languages outside this C profile expose unsupported security-flow projections;
references or declarations do not fill those projections. Credential capture
rules apply to all runtime values and expanded evidence. Raw source evidence
is returned only under the specification's source-inspection policy.


## Environment and general projections

Automatic environment context concerns the selected target's declared inputs.
It never reads the coordinator/harness environment. Node manifests and lockfiles
supply `declared` dependencies; disk package manifests and resolver decisions
supply separately attributed installed versions and origins. Ancestor packages
are included only through admitted read roots. Manifest/lock/tree disagreements
are named. Package-manager install/build/lifecycle commands do not run.

TypeScript effective config includes the full extends/reference chain and
resolution roots. C configuration includes parsed compilation commands and
admitted frontend options. Fixed tool probes run the selected executable with
`--version`, recording its real path/version/digest. Environment `options`
admits `tools` (map of provider name to executable path), `readRoots`,
`configFiles` (paths) and `servicesFile` (JSON Compose document).

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
foreign-key inference. SQLite json1 uses fixed parameterized traversals; callers
supply no SQL. JSON values are explicit target-document inspection. Byte hashes,
pointers and key qualifications accompany every relation. YAML/CSV/Markdown
adapters are outside this initial set.

## Runtime contract

CDP supports adapter-owned launches. A runtime ID is `rt:<launch QUERY_ID>`.
Arbitrary PID attachment is refused as `attachUnqualified`; `/json/list` is not
PID authentication or proof that no other inspector client exists. One Baton
adapter owns its connection; other local clients can affect the shared debugger
state. No exclusivity or hostile-local-user boundary is claimed.

Runtime subjects use the following closed intent forms. `select` remains at the
request top level. `session` below is the runtime ID, not the requesting Player.

| Intent | Fields | Completion |
| --- | --- | --- |
| `launch` | `program`, `args` (array), `env` (complete map), `onOwnerStop:"terminate"`; optional `stopAt` position, `stopOnException:"none"|"uncaught"|"all"` | owned child and inspector handshake established, initial state recorded |
| `observe` | `session`; optional `thread`, `frame`, `object` (returned refs) | selected observations captured at one epoch, or explicit running/pausePending state |
| `pause` | `session`; optional `thread` | protocol acknowledgment records `pausePending`; actual stopped event completes the stop query |
| `resume-step` | `session`, `action:"resume"|"next"|"stepIn"|"stepOut"`; optional `thread` | protocol acknowledgment; later stop/exit is a separate event |
| `evaluate` | `session`, `expression`; optional `frame` | actual result or in-band exception observed |
| `release` | `session`, `onRelease:"terminate"`, `signal:"SIGTERM"|"SIGKILL"` | owned child exit and reap observed; no automatic signal escalation |

Runtime intents acknowledge committed admission and initiation; they do not
join target execution. Each may initially return `accepted` with a null result.
`context-result` retrieves completion. An observed stopped event can precede its
protocol response; that later acknowledgment cannot regress a completed query. An evaluation that never responds remains
pending until explicit release/owner stop or observed provider failure; no
runtime timeout changes it to success. Pure static/catalog queries return their
completed result synchronously under M-12's query exception. Model execution,
SQL planning and migration replay with nonempty effect grants use the same
detached admission/completion envelope and owner-notice path; their internal
query worker terminates after the one-shot adapter is reaped.

A runtime belongs to the requesting recorded session for its entire explicit
lifetime. `originAttempt` is the exact recorded active attempt at launch, or null;
it is provenance, not an invented lifetime. Ordinary native turn/attempt end
does not release a session-owned runtime. An interactive Principal with no
attempt can launch and later observe/release it. Another requester is refused;
trusted operators can act using the recorded owner identity. Owner stop initiates
termination and leaves an explicit pending cleanup record until reap is observed.
That stop hook is required new integration work; the existing keeper alone does
not provide it.

The internal native runtime worker retains one adapter with
`ProcessChild.retain`, using a directory derived from database/query identity
under the existing log root, using SHA-256 of the canonical database path and
query ID as directory components. Raw IDs never become path components. Database
file replacement invalidates the recorded keeper binding. It alone attaches as observer, reads NDJSON events,
validates them and commits answers/state transitions. Public follow-up commands
commit a pending query then use `ProcessChild.control_write` to that directory.
The existing keeper retains stdout/stderr and process status across observer
loss. Recovery attaches with `ProcessChild.attach` and resumes the stored spool
cursor; unknown in-flight effect outcomes remain `interrupted`, never repeated
implicitly. Launch/recovery use the existing detached host control path through
the controls owner. No provider writes coordination SQL itself.

The adapter serializes state-changing CDP intents per runtime and rejects a
second incompatible intent as `runtimeBusy` before send. Observe is admitted
while idle/stopped; release is always available to the owner. Query IDs correlate requests and responses. Native-to-adapter frames are
`{version:1,query,request}`. Adapter frames are
`{version:1,query,runtime,sequence,type,payload}` with nullable `runtime`,
monotone sequence per adapter, and type `accepted`, `complete`, `failed` or
`state`. Only complete frames carry the validated result shape. State frames
carry runtime state/evidence; unsolicited state has query null. Malformed frames,
foreign runtime/query identities and repeated sequence with different bytes
fail the protocol. Replayed identical spool frames are idempotent. The worker
commits its consumed cursor and corresponding state/result in one transaction. A sent intent is never automatically reissued after
connection loss. The runtime worker publishes terminal command results and
stop/exit/failure state changes as internal retained notices to the owner,
using the existing self-input SQL pattern in `Receive.recovery_input` and
native delivery. Context notices reuse that insertion shape only; they do not
clear or replace a native conversation identity. Notice IDs derive from runtime/event identity. A stopped owner
routes cleanup failure to its existing stop/report destination. Notice delivery
uses the control completion/failure-owner contract; it cannot wait on an unwoken
agent. This notification integration is required host-tested implementation,
not evidence established by the runtime research.

Launch uses an ephemeral loopback inspector port and the owned child's actual
stderr endpoint. The initial wait uses `--inspect-brk=127.0.0.1:0`; endpoint discovery is
bound to the adapter's child handle and launch ID. Source breakpoints are set
against generated locations after local source-map decoding. Startup performs
`Runtime.enable`, `Debugger.enable` and `Runtime.runIfWaitingForDebugger`; the
startup wait and a later actual paused event are distinct states. Maps are local
files or embedded data URLs; remote map fetch is unavailable. Source mapping
records generated and mapped segment positions and the map digest; it does not
claim reconstruction of renamed runtime bindings. Direct TypeScript execution
is not required: the qualification target uses compiled JS plus source maps.

Runtime state is `starting`, `waitingForStart`, `running`, `pausePending`,
`paused`, `releasing`, `exited` or `failed`. Detach is refused as
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
input while evaluation is pending; release signals its still-owned child without
waiting for a CDP evaluation response. Closing a connection does not roll back
target effects. Worker refs use distinct
worker/debugger/context identities. Worker breakpoint/scope/exception support is
unavailable until qualified; basic thread discovery/state remains supported.
Async frames state whether capture was enabled before the chain formed.

On terminate, the adapter sends the explicitly selected signal to its still-owned
child while keeping the inspector connection alive until observed exit. It reaps
that child, closes the socket and exits. A signal acknowledgment establishes no
exit. SIGTERM that leaves a process alive leaves release pending; the owner may
explicitly submit SIGKILL with a new query ID. Owner stop selects SIGTERM, retains
cleanup ownership and reports a pending/failing cleanup to the stop destination;
no elapsed timer triggers escalation. A query naming a stopped owner is admitted
only for release of its recorded runtime. The worker observes adapter status
before keeper acknowledgment/release. Adapter crash is distinct from target exit;
last known child state becomes unknown until an owned-process path verifies it.
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
`release`/`acknowledge` apply only to retained handles. argv is the fixed native argument sequence:
`/usr/bin/env`, `-i`, explicitly constructed base assignments, an absolute Node
executable, an absolute packaged adapter path. The provider process starts after
`env` clears inherited variables. The base consists of a PATH made from the selected absolute provider directories plus
`/usr/bin:/bin`, private HOME/TMPDIR, and `LC_ALL=C`; explicit target runtime env is a separate
child-only input. Node preloads/options, harness credentials, agent HOME and
package-manager settings are absent. Raw request bytes travel on stdin as one
NDJSON frame. `ProcessChild.spawn` supplies private retained stderr and uncapped
stdout. Retained adapters use the same argv boundary via `retain`; request
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
  request_digest, cwd, origin_attempt NULL, state, result_json NULL,
  error_json NULL, runtime_id NULL, artifact_path)`;
- `semantic_runtimes(id PRIMARY KEY, owner REFERENCES sessions,
  origin_attempt NULL, launch_query UNIQUE, keeper_path UNIQUE, adapter_id,
  state, epoch, pending_query NULL, observer_cursor, outcome_json NULL)`.

JSON columns have `json_valid` checks; state/classification/subject/evidence
validators use SQLite json1. Each result is one JSON column, preserving tabs and
newlines through json1 escaping. Foreign provider output is validated before
publication. No hand-written completion census or expected-failure manifest is
introduced. Query records are functional replay, result and runtime recovery
state. Logs retain raw evidence under existing retention rules.

Admission commits once before provider effects. Synchronous read queries run after
admission and atomically change running to complete/failed. Runtime creation
commits its owned row before detached startup. Admission refusal commits no
query/runtime and starts nothing. Post-commit launch failure preserves the
failed row and failure owner. Duplicate IDs compare canonical request/owner;
concurrent insertions cannot start two providers. A worker claims the accepted
row transactionally before launch. Interrupted startup/effects remain explicit;
a retry reads the row and cannot silently duplicate execution.

Results become complete only after schema validation and consistency checks.
A killed adapter, malformed JSON, foreign query ID or missing required evidence
cannot publish facts. Provider facts retain exact evidence values while the
coordinator adds query/owner/applicability fields. Checked classification requires
its extra oracle fields; the validator establishes shape, not oracle truth.

## Packaging

First-party adapters are staged under `libexec/baton2/`, with package-relative
imports. Bundled inputs are TypeScript5.9.3, Ajv8.17.1 and Zod4.3.6 plus Ajv's
resolved dependencies. `bend2/context/package.json` and its npm lockfile are the
single dependency pin input; exact versions and integrity hashes are mandatory.
`package-native.py` verifies the lockfile-resolved bytes, stages licenses and
third-party notices, records payload/source hashes and includes distribution
entries. No runtime install or ambient `node_modules` resolution is permitted.
Target Zod schemas load in the explicit target child using the target
module's resolved dependencies. Its resolved Zod package must be exactly 4.3.6;
version mismatch refuses before model execution. The captured module resolution
closure and sample enter the snapshot. Arbitrary reads made by project code
can prevent complete closure capture; such results carry applicability unknown
and execution limits. Bundled Zod supplies provider probes and API support; it
does not silently replace a project dependency.

The migration replay helper uses external Python3.14.3 with stdlib SQLite3.53.0
and `set_authorizer`, matching the retained migration probe. This helper reads
the live catalog and replays the chain in private in-memory databases using the
same library, then compares those projections. Its exact executable and library
versions enter the snapshot. Node's SQLite library need not match: a migration
query carries its own schema snapshot and never compares a Node-produced
catalog against a Python-produced catalog. This fixed helper supplies SQLite
migration semantics; Python source/model analysis remains outside scope.
Replay permits SQLite core schema operations and the engine's required internal
catalog writes. It denies ATTACH/DETACH, load_extension, external virtual-table
modules, filesystem-writing PRAGMAs and application-defined functions; temporary
state is memory/private-directory only. Data-dependent migrations report
`dataDependentMigrationUnsupported` because the replay contains no live rows.

External providers: Node22.15.0+, LLVM clang/clangd20.1.8, psql14.18 with a
user-operated PostgreSQL14.18 server, and Python3.14.3/SQLite3.53.0 for migration queries. The initial
qualified platform is darwin-arm64. `context-engines` reports executable/version,
prerequisites and per-projection readiness. Upgrades require scoped requalification.
No Swift/LLDB/OPA binary is bundled. The native binary's existing Node-free
operation stays distinct from the adapter/helper Node requirement.

A package gate runs with Node22.15.0 and the qualification host's Node, with
ancestor modules and development paths unavailable. It proves package-relative
resolution, license/integrity checks and useful provider results. CI selecting
merely Node22 latest is insufficient floor evidence.

## Laws and acceptance

Every implementation compile imports operative laws through `coordinator/laws.bend`.
Laws bind actual parse, admission, effect construction, classification and result
functions. Host/provider truth remains a named assumption exercised by native
fixtures. The full `laws-check.mjs` includes proof-removal and implementation
mutation controls; unimported scratch laws establish no delivery gate.

Required real-function laws cover command/closed-schema parsing; exact declared
engine selection; missing-effect refusal before spawn; canonical retry/conflict;
result ID/owner/evidence validation; failed-provider no-publication; structural
environment value exclusion; explicit adapter environment construction; ref
snapshot/epoch validation; applicability from recorded/current identities; query
claim before launch; runtime owner and transition rules; and each main dispatch
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

Meaningful acceptance runs through the installed CLI, MCP and generated briefing
on real external targets, with independent inspection of exact source and values:

1. A TypeScript handler resolves parameter/callee/diagnostic context, an aliased
   constant-SQL database access, real schema constraints and a model export/use.
   A sample rejected by its validator names the rule and source; serialization
   shows a concrete transformation. A shadowed client and dynamic SQL do not
   manufacture links. Migration prefix/head comparison distinguishes pending
   changes, changed checksums and actual live-schema drift.
2. A C authorization handler returns resolved principal/action/resource
   predicates, deny branch, effect call and a supported input/path witness.
   Changing the guard changes the relationship. Name-only or unrelated policy
   output fails. An analyzer verdict states its exact model and unsettled cases.
   CFG and diagnostics must come from the actual pinned tools.
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
Each supported provider's useful projection must pass; one backend's pass cannot
stand in for another. Exact Node22.15 API behavior, dependency packaging, migration
provider compatibility and runtime cleanup/notification remain acceptance gates.
This document does not claim those installed native gates have run.

Root gates the composed candidate with `build-native`, full `laws-check.mjs` and
`check-native`, followed by independent review, native fast-forward publication
and remote readback. The landing gate compares selected tests on target and change
and blocks regressions; known target breakage belongs in the issue tracker.

## Ownership and evidence

Runtime implementation remains gated. `semantic-synthesis` owns this document
and shared commands/main/store, MCP, package, law aggregation, check wiring and
conductor-adapter handoffs. `semantic-controls-next` owns control/delivery/host
control plus receive/turn orientation; semantic changes to those files arrive as
reviewed handoffs. `native-receive-conductor` first owns #669/#670 repair to
commands/turn/receive and associated laws/tests. Feature branches rebase onto its
reviewed landed result before overlapping edits. No shared file is edited by
both feature owners concurrently.

After authorization, implementation splits into context core/laws, TypeScript
and data joins, clang/code-security, CDP runtime, schema/model/replay,
environment/dataset, and shared integration. Each new module/test set has one
owner. A separate core-runtime table is functional state; research inventories
or test-count ledgers are not implementation artifacts.

The retained research used for this specification is retrievable with native
`delivery MESSAGE_ID` and the files named by those messages:

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
- control `75eee9a7` (successor to `85f20618`) and continuation ownership
  exchanges: common conventions;
- `semantic-observations-synthesis-verdict-1`,
  `semantic-security-synthesis-contract-1`,
  `semantic-models-data-critic-corrections-1` and
  `quality-synthesis-transport-response-1`: bounded correction evidence.

Research demonstrations establish component feasibility under their stated pins.
This specification chooses the narrower qualified profiles above. Its new joins,
transport composition, runtime worker and owner cleanup are implementation work,
with host acceptance required before support can be advertised. Independent
review and the final approved control citation remain prerequisites to root's
implementation authorization.
