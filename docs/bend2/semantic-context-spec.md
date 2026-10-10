# Native semantic context implementation specification

Status: docs-only specification for independent review. Runtime implementation
requires the independent review and root feature comparison. The requirement is
[Native semantic context](semantic-context-feature.md), `6929bffe` with the
credential clarification `98fbfe03`. Source baseline is `98fbfe03`; Bend remains
2.0.25 and the adapter Node floor remains 22.15.0.

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
references support the common conventions; root separately decides semantic
implementation after independent review and whole-feature comparison.

## Supported scope

Baton2 queries external target software and returns programmatic facts with
source or runtime evidence. The initial implementation has the following fixed
providers. Each provider answers its own capabilities and observed readiness.

| Engine | Supported subjects and useful results | Provider |
| --- | --- | --- |
| `typescript` | TS/JS definitions, types, references, calls, dependencies, flow diagnostics, throw/catch structure, constant-SQL code accesses | TypeScript 5.9.3 language service and public compiler API |
| `clangd` | C/C++ definitions, references, types, calls and diagnostics | configured `BATON2_CLANGD` executable or `clangd` on `PATH`, using LSP; Linux adapter invocation was exercised with clangd 20.1.2 |
| `clang-analyzer` | C handler types, direct calls, diagnostics, discovered guard/deny/effect relationships, CFG and source-bound constant-SQL SQLite joins; explicit model-scoped predicate queries | LLVM/Clang 20 AST/CFG extraction and analyzer plist; Linux extractor build and fixture invocation were exercised with LLVM/Clang 20.1.2 |
| `cdp` | owned Node program, generated/original frames, scopes, values, exceptions and worker state | Node inspector; adapter implements CDP framing and source-map decoding |
| `sqlite-schema` | entities, columns, keys, constraints and constant-SQL opened objects | fixed Node read-only provider for entity/TS queries; native linked SQLite planner for the C handler composition |
| `postgres-schema` | PostgreSQL entities, relationships, constraints and admitted constant-SQL plans | external psql 14.18 and PostgreSQL 14.18; other versions require qualification |
| `data-model` | SQLite migration state/drift; JSON Schema validation; Zod validation/serialization linked to resolved model use | SQLite, Ajv 8.17.1, Zod 4.3.6, TypeScript resolver |
| `environment` | Node dependency declarations and disk resolution, effective TS configuration, C build configuration and declared service topology | data readers, TypeScript configuration API, fixed version probes |
| `json-dataset` | document structure, selected values and explicit key relationships | JSON parser and SQLite json1 with fixed queries |

The extractor's CMake configuration accepts LLVM major version 20. The native
module declarations do not select a Clang minor version. The current Linux results
cover the adapter and extractor with version 20.1.2. Darwin packaging remains
unqualified: the extractor is staged only from a supplied, already-built
runtime package, and the Linux executable and its libraries cannot serve as a
Darwin runtime. The clangd module resolves the executable at invocation time;
its Darwin executable and shared-library closure have not been qualified.

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
baton2 DATABASE context-engines [SESSION]
baton2 DATABASE context-install MODULE SOURCE
baton2 DATABASE context-query-file SESSION QUERY_ID PATH
baton2 DATABASE context-result QUERY_ID
```

`context-engines` returns `{status, modules, refusals}` for the installed context
modules. Each module includes its ID, declaration digest and capability
declaration. Failed inventory reads remain visible. Optional SESSION reads that
session's recorded workspace and `.baton/context.json`. The response adds the
session and workspace under `scope`, the policy path and read state under
`projectPolicy`, and `enabled` and `preferred` fields on each module. An absent
policy supplies the default settings. A malformed or unreadable policy includes
its cause and leaves these module settings unknown. Managed query progress is
retrieved through `context-result`; its returned state names the ordinary
query-control route.

`context-install` copies a locally supplied, already-built module directory or
the named module from an extracted native distribution into the executing
coordinator's installation. Its result names the module, source and installed
path. `installed` records a completed copy; `present` records an existing module
directory. The existing module and project settings remain in place. Missing
source, malformed declaration and filesystem errors retain their causes.

For `context-query-file`, SESSION must exist and be active; the release exception
for a stopped owner is defined in Runtime contract. Its recorded workspace supplies
omitted `cwd`; a session without a workspace supplies `cwd`. The CLI uses the
trusted-local declared identity convention. MCP obtains SESSION from its
attachment; it does not infer an identity from a request body. Query identities
are unique across the coordination database. `context-result` follows the
trusted-local database read convention: any caller with access to this
coordination database may read a retained query. It has no requester argument
and establishes no owner-only read boundary. MCP result lookup uses the same
rule. Control effects separately require the recorded owner identity.

The Conductor MCP tools are `baton2_context_engines`, `baton2_context_install`,
`baton2_context_query_file` and `baton2_context_result`. Discovery arguments are
`{}` for installed modules or `{scope: "session"}` for the attachment's recorded
project settings. Query
arguments are `{query, path}`. The attachment
supplies SESSION and invokes `context-query-file SESSION QUERY_ID PATH` through
the coordinator CLI. Result arguments are `{query}` and invoke `context-result`.
The request file must be accessible to the coordinator. The CLI also accepts
`PATH -` to read its stdin.

Module acquisition arguments are `{module, path}` and invoke
`context-install MODULE SOURCE`. The path supplies an existing built payload;
a remote module artifact catalog remains unimplemented.

The MCP adapter parses newline-delimited JSON-RPC messages, dispatches the named
tool and returns the coordinator output as text content. Command failures set
`isError` and include the process exit code and captured stdout/stderr. Native
request decoding and absent-result lookup currently report diagnostics on stderr
with exit 3; host-operation failures can retain their own error code. Retained
query envelopes carry their computation state and error fields.

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

Selecting one engine names the result producer. That producer can invoke its
specified fixed subprovider: a C source query with `authorization` or
`databaseAccesses` selects `clang-analyzer`, whose database join uses
`sqlite-schema`. The same request returns types, resolved calls, diagnostics,
guard relations and schema access over shared source identities. It does not
require separate TS and C queries. C `flow` also selects `clang-analyzer`;
ordinary C/C++ language-service projections select `clangd`. Unsupported C++
analysis requests report their explicit scope. Conflicting subject/options
combinations refuse before provider effects.

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
`replayMigrations`, `evaluateRuntime`, `controlRuntime`. Every operation has a
fixed required subset. A missing grant refuses before its effect. Grants are
explicit trusted-local consent, not an OS sandbox. Read-only catalog/source
operations need none. Query-control recovery needs none; query-control release
requires `controlRuntime` for its owned process effect. Runtime launch/resume/pause/step/release require
`controlRuntime`; evaluation also requires `evaluateRuntime`. Zod module
loading requires `executeTarget`; target SQL planning requires
`planTargetSql`; SQL migration replay requires `replayMigrations`.

File queries use canonical request identity. Validation precedes
admission and provider resolution. `Raw.read_utf8(path)` reads raw file bytes,
with `-` selecting stdin, and checks RFC 3629 UTF-8 and NUL before
the compiler runtime's `io_str` conversion. That conversion replaces invalid
byte sequences, so a later String check cannot implement this boundary.
A leading BOM has its own refusal condition.

`NativeRequest.read_file` runs `Request.validity_sql` against the bound database
before traversing the JSON. A valid document then reaches
`Request.validate_json_text_sql`, which checks duplicate decoded member names
within each object. `Request.json_tree_sql` returns node IDs, parent IDs, kinds,
member names and scalar values as hex fields. Numeric rows retain their original
JSON tokens through the text operator `raw -> row.fullkey`.

`CoreCodec.frame_read` reconstructs the raw tree from those rows and decodes
scalar UTF-8. `Schema.schema_admit_value` checks the request shape.
`CoreCodec.raw_to_json` converts the admitted tree to the native canonical JSON
representation, and `Request.request_validate` checks the request fields.
`Request.request_identity` produces the canonical text used for replay.
The accepted `RequestDecoded` value carries that text, engine-selection operands,
the requested operation chain, `cwd` and the source path. Read, validation and
decode failures return `RequestDecodeRefused` with the condition for the ordinary
query caller.

`Native.query_file` obtains the database binding and calls this decoder.
`query_request_result` reads the owner's workspace and resolves the target
working directory. The existing provider inventory and project selection calls
select the installed engine plan. `capture_plan_inputs` acquires the plan's input
records, and `launch_captured_plan` passes that plan and those records to the
selected provider through the installed `context-provider.mjs`. Managed query
state and results use the existing context service and query rows.
`Native.result` reads the retained result through `ContextService.retained`.

The Conductor MCP adapter passes the file path and attached session to these
ordinary commands. Its JSON-RPC request ID correlates the MCP reply. The file
reader and native decoder operate on the query request file; the request's
canonical text, operation chain and selection operands are internal values used
by the native callers. MCP result text contains the coordinator output.

## Results, classifications and references

Every query answer is `{version,query,owner,state,result,error,progress}`.
`state` is `accepted`, `running`, `complete`, `failed`, `interrupted` or
`refused`. The last value is reserved for a retained admission rejection.
`result` is null until complete; `error` is nonnull for failed, interrupted and
refused outcomes. The envelope's progress always describes its own query.
It is null for queries without managed roles, including unmanaged query-control
and inspect queries. Managed install and configure queries retain their own
progress, control and cleanup.

Progress is the closed object `{phase,waitingFor,control,cleanup}`. Phase is
`preparing|running|waiting|cleaning|settled`, control is
`available|unavailable|unobserved`, and cleanup is
`notRequested|pending|complete|unavailable`. `waitingFor` contains distinct
objects from this closed union. An empty set of outstanding events is `[]`:

- `{kind:"providerResponse"}`;
- `{kind:"clangdDiagnostics",uri,version,reason:"diagnosticsUnobserved"}`;
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

URI and version identify the captured document; version is the admitted document
integer. Role and incarnation name the exact recorded role. `message` names an
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

Every other completed result has `engine`, `provider`, `subject`, `snapshot`, `facts`,
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
Coverage retains the selected provider's actual exploration limits and unvisited
paths. Baton adds no node/depth budget or timed truncation. A provider verdict
remains scoped to its reported explored domain. No oracle outcome proves
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

The request-handler use case returns actual parameter/callee types, diagnostics,
code-to-schema access and the source-bound authorization relationship together
for the same selected handler. Referenced
entities, guards and scopes are individually expandable; agents do not construct
edges by matching snippets. The exception use case returns the exception, its
observed stack, mapping provenance and expandable scopes from one captured stop.

The concrete combined-handler qualification target is Fossil manifest
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

Retained historical research report `semantic-security-fossil-qualification-verdict-6`
qualifies an authentic LLVM 20.1.8 GNU89/O0 HTTP-only build, its generated inputs
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
The original input manifest is compared after analysis. LLVM 20.1.8 documents
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
the exact `{kind:"clangdDiagnostics",uri,version,
reason:"diagnosticsUnobserved"}` entry in `progress.waitingFor`. Admission and this initial
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

The retained historical fidelity completion report qualifies versioned publications for
clangd 20.1.8 and rejects the idle barrier. Managed progress, recovery, cancellation
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
`clang-analyzer` producer uses a first-party LLVM 20 LibTooling executable.
Its current Linux build and fixture invocation use LLVM/Clang 20.1.2.
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
is bound to the LLVM 20 implementation and was exercised against emitted
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

The initial profile is C in one translation unit analyzed with LLVM 20
front-end and Static Analyzer builds and the subject's known build
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
compiler mechanisms and falsification cases. Current Linux qualification
demonstrates the integrated extractor on the `guard-helper.c` fixture. It does
not establish LLVM-version portability, automated discovery of arbitrary
policy, or a solver proof of all-path enforcement. The critic report-2 probes
use Apple Clang 17. Darwin packaging and execution, the Fossil and SQLite
composition, and broader C/C++ subjects remain unqualified.

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
foreign-key inference. SQLite json1 uses fixed parameterized traversals; callers
supply no SQL. JSON values are explicit target-document inspection. Byte hashes,
pointers and key qualifications accompany every relation. YAML/CSV/Markdown
adapters are outside this initial set.

## Runtime contract

CDP supports launches owned by a native target keeper. A runtime ID is `rt:<launch QUERY_ID>`.
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
SQL planning and migration replay with nonempty effect grants use the same
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
direct95 implementation; shared host qualification and semantic implementation
authorization remain separate. The `08dd2053` and `d47d5c11` reports
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

`SessionLock.try_acquire` receives the canonical database path and the
physical-role digest. The host identifies the database by its device and inode,
then hex-encodes the digest once in the lock filename under its IPC directory.
Database aliases share this lock. The prepared keeper receives the acquired
handle. Keeper directories use the full-identity digest under the context log
directory. Filesystem and allocation failures retain their host causes.

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

The adapter serializes state-changing CDP intents per runtime and rejects a
second incompatible intent as `runtimeBusy` before send. Observe is admitted
while idle/stopped; release is always available to the owner. Query IDs correlate requests and responses. Native-to-adapter frames are
`{version:1,query,request}`. Adapter frames are
`{version:1,query,runtime,role,incarnation,sequence,type,payload}` with nullable `runtime`,
monotone sequence per adapter, and type `accepted`, `complete`, `failed` or
`state`. Only complete frames carry the validated result shape. State frames
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

Launch uses an ephemeral loopback inspector port and the owned child's actual
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
`release`/`acknowledge` apply only to retained handles. argv is the fixed native argument sequence:
`/usr/bin/env`, `-i`, explicitly constructed base assignments, an absolute Node
executable, an absolute packaged adapter path. The provider process starts after
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
validators use SQLite json1. Each result is one JSON column, preserving tabs and
newlines through json1 escaping. Foreign provider output is validated before
publication. No hand-written completion census or expected-failure manifest is
introduced. Query records are functional replay, result and runtime recovery
state. Logs retain raw evidence under existing retention rules.

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

First-party adapters are staged under `libexec/baton2/`, with package-relative
imports. Bundled inputs are TypeScript5.9.3, Ajv8.17.1 and Zod4.3.6 plus Ajv's
resolved dependencies. `bend2/context/package.json` and its npm lockfile are the
single dependency pin input; exact versions and integrity hashes are mandatory.
`package-native.py` verifies the lockfile-resolved bytes, stages licenses and
third-party notices, records payload/source hashes and includes distribution
entries. No runtime install or ambient `node_modules` resolution is permitted.
The C combined-query payload includes `libexec/baton2/context-clang-20`, a
first-party C++ LibTooling extractor built against LLVM/Clang 20, and the
fixed Fossil helper summary, with source/build and summary hashes in package
metadata. Its closure comprises the actual helper definitions and the supported
literal-copy rule; there is no runtime helper-summary registry or target-supplied
executable plug-in. The summary matcher checks parsed declaration/body inputs
before adding a modeled SQL edge. Generated frontend inputs are supplied by the
target's existing authentic build and consumed read-only. Packaging neither runs
that build nor substitutes preauthored result rows. The extractor links the
`clang-cpp` library found through the LLVM package's library directories.
The package stages the extractor only when given an already-built runtime
package through `--context-clang-package`. Linux build and fixture execution
used LLVM/Clang 20.1.2. Darwin binary packaging, dynamic-library closure,
resource headers, SDK access and installed-provider execution remain
unqualified. The fixed-profile build-association decoder requires
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

External providers: Node22.15.0+, LLVM/Clang 20 for the C/C++ modules, and
psql14.18 with a user-operated PostgreSQL14.18 server. Linux module execution
was exercised with LLVM/Clang 20.1.2; Darwin closure qualification remains
open. Native SQLite operations qualify the
actual linked library described above. The initial qualified platform for the
other package behavior is darwin-arm64; that does not qualify the Clang runtime
closure. `context-engines` reports executable/version,
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
engine selection; missing-effect refusal before spawn; strict scalar UTF-8
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

Meaningful acceptance runs through the installed CLI, MCP and generated briefing
on real external targets, with independent inspection of exact source and values:

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
and semantic integration review. For the independently authorized #671 repair,
the registered `semantic-controls-interfaces-research` Player exclusively owns
shared commands/main/MCP/help/briefing and the final read candidate. Structural
proposal `2543678035631371a6f024a1c58ac9ec16239c12` has six design ACCEPT verdicts;
controls-next owns its structural module, laws and Recruit factoring, with a
separately owned structural fixture. That approval performs no semantic or
optional-startup effect. Controls-next owns the #672 direct-start proposal and
shared keeper design, with bounded direct95 implementation authorized and host
qualification still open. Semantic package/store/law
and entry changes require explicit reviewed handoffs after authorization.
`native-receive-conductor` first owns #669/#670 repair to
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
This specification chooses the narrower qualified profiles above. Its new joins,
transport composition, runtime worker and owner cleanup are implementation work,
with host acceptance required before support can be advertised. Independent
review and root whole-feature comparison remain prerequisites to root's
implementation authorization.
