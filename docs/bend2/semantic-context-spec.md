# Native semantic context implementation specification

Status: consolidated draft, approaching commit readiness. The
[feature document](semantic-context-feature.md) (initial `6929bffe`, credential
paragraph clarified at `98fbfe03`) is the fixed requirement reference; this
specification defines the supported backends and qualifications the feature
document defers to. Source baseline:
`6929bffeeac32514968dd3d104dd7503eec1fba5`. Host and compiler remain Bend
2.0.25; the released Node floor is 22.15. Surface conventions are cited from
semantic-controls' Orchestra-control specification by section name, meaning
its approved successor commit (root reviewed `d00c9369` and requested
changes; the citation tracks the successor, not the frozen draft).

Consolidation state: the code-semantics lane has reported in full
(`semantic-code-lane-report-1`); the language lane
(`semantic-language-design-report-1`), backends lane
(`semantic-backends-report-1`, `semantic-backends-report-2`) and the
acceptance critic (`semantic-review-acceptance-critic-report-1`) reported
earlier and are incorporated; the runtime lane's probes and the SIGBUS
diagnosis (`semantic-runtime-sig10-result`) are incorporated, its final
consolidation is outstanding; the models and integration lanes' final
reports are outstanding and close the residuals named in Open decisions. The
composed committed draft goes to the independent critic Ensemble, which
ACCEPTs or REQUESTs CHANGES. No runtime implementation starts before
reviewed-spec consensus and the root's final feature review.

## Purpose

Baton2 gives agents structured context about the external code, software,
data and environment they work on, through ordinary Baton2 operations. This
specification defines the supported engines and languages, the facts each
computes, the native query contract with its result/evidence/limits/
freshness model, integration into the command, MCP and briefing surfaces,
sharing through reports and findings, effect and credential boundaries,
packaging, the operative Bend laws, the host acceptance gate, and the
implementation division after approval.

## Scope

In scope: programmatic facts about external target software, computed at
query time by real engines — language servers, compiler APIs, a debugger
protocol, database catalogs and toolchain inspection — returned through one
native query interface.

Out of scope: Baton2's own coordination state and telemetry (existing
readers retain that role); generic file storage or scratchpads;
investigation workflow automation; experiment orchestration; scheduling; a
general-purpose context platform. Baton2-owned indexing daemons and graph
databases are not introduced: each query runs synchronously inside the
invoking Baton2 command and computes from the target's current inputs. The
supported engines are a fixed enumerated set with per-engine evidence; this
specification defines no adapter extension framework.

## Architecture

Decision (evidence: semantic-language-design-report-1; finding
`semantic-integration-kernel-gaps`; semantic-backends-report-1 §4.4): the
coordinator drives **external adapter processes**. Bend-native LSP/DAP
clients were set aside: the host layer has no length-delimited read (probe:
two newline-free child writes merged into one read returned only at child
exit, 3.16 s wall) and Bend has no general JSON decoder; both are kernel
additions the adapter model does not need.

- **One-shot adapters** (all stateless engines) run through the existing
  `Process.run` host effect (`bend2/src/git/process.bend`, `git/process.c`):
  length-prefixed argv, no shell, stdout read to EOF, uncapped, stderr to a
  retained log file. The validated request document travels **in argv**
  (integration lane's transport closure: no scratch file, no
  validate-then-read race). The adapter writes one JSON result document on
  stdout and exits.
- **Retained adapters** (runtime/debug sessions only) reuse the existing
  retained-child subsystem (`ProcessChild.retain` / `attach` /
  `control_write` / `release` / `acknowledge`, `host/process-spawn.c`) keyed
  by a manifest directory named by the recorded runtime-session identity —
  the same machinery that carries harness sessions across coordinator
  restarts. The coordinator↔adapter protocol is newline-delimited JSON,
  which the existing spool reads frame correctly; the adapter owns the
  provider's framing (CDP WebSocket/stdio, DAP `Content-Length`)
  internally.
- **No new C host effects are required**, and the claim is scoped exactly:
  one-shot transport is `Process.run` with argv; retained transport is the
  keeper family; the adapter (a Node process) controls its own children's
  environment explicitly (`child_process.spawn` with an explicit `env`,
  probe-verified to pass exactly the declared keys plus the macOS-injected
  `__CF_USER_TEXT_ENCODING`). Anything an adapter cannot do with these
  functions is out of the design.

Coordinator modules (`bend2/src/coordinator/semantic-context.bend` +
`semantic-context-laws.bend`) implement a typed request/store/result loop on
the `native-requests.bend` precedent: json1 validation at the SQL boundary,
idempotent caller-supplied identities, typed refusals naming the violated
rule, store rows recording what was asked and answered. Request validation
and result projection use SQLite json1 inside Bend-built SQL; no Bend JSON
parser is introduced. Provider behavior is established by host evidence
(fixtures and probes), never asserted by SQL-string laws.

There is no background indexing, no filesystem watching, no scheduler:
adapters are children of the serving operation (or retained children owned
by a recorded runtime session), and nothing polls or wakes on its own.
Store rows are evidence of what was asked and answered, never a shadow
index of the target.

## Commands, issuance and result surfaces

New commands, following the probed CLI conventions
(`semantic-integration-cli-surface`): one JSON document on stdout at exit 0;
failures on stderr with exit 2 carrying a structured
`{"error","command","condition","next"}` object (controls §3.2) or one plain
sentence; exit 1 only for an absent single-record lookup; empty reads answer
`[]` at exit 0. Unknown-identity handling is defined uniformly for the new
family: an unknown query or result identity exits 1 with the absent record
named.

```text
baton2 DATABASE context-engines [--pretty]
baton2 DATABASE context-query SESSION QUERY_ID REQUEST_JSON
baton2 DATABASE context-query-file SESSION QUERY_ID PATH
baton2 DATABASE context-result QUERY_ID [--pretty]
```

**Issuance.** Any session issues queries: the CLI takes the requesting
`SESSION` explicitly (the trusted-local declared-actor convention of the
existing commands); the MCP tools take it from the conductor's attachment.
The requesting session resolves two things: the default `cwd` (its recorded
workspace from the `sessions` table — an operator invocation without a
session workspace supplies `cwd` explicitly) and the owner recorded on any
runtime session the query creates. `QUERY_ID` is caller-supplied and
unique: an identical retry (same id, same body) replays the stored answer;
conflicting reuse fails the transaction — the existing message/turn
identity discipline. Retry therefore means "the same request answered from
its stored row"; a fresh answer always comes from a new `QUERY_ID`, and
`context-result` re-reads a stored row with applicability recomputed
against current inputs.

`context-engines` answers the capability catalog: per engine, its
declaration, observed availability (`available` or `failed: <cause>`) and
any operator exclusion. The served set is `declared ∩ observed − excluded`
(operator law 12b: a hand-kept table cannot add, restrict or mask; a failed
probe is reported, never silently dropped).

MCP: `baton2_context_engines`, `baton2_context_query`,
`baton2_context_result` in `bend2/scripts/mcp-conductor.mjs`, thin
translations to the same commands; the MCP contract test pins tool output
equal to CLI output, so both surfaces return the same result model by
construction. Tool schemas follow `{type:'object',
additionalProperties:false}`; tool descriptions follow controls §3.4
(operation sentence, admission preconditions, defaults for omitted optional
arguments, next operation on failure).

Briefing and help: orientation text joins the four existing briefing
surfaces (`Receive.instructions` in `receive.bend`, `usage()` in
`main.bend`, the MCP initialize instructions, the Codex/OMP conductor
prompt cribs). Each new command gets a `help COMMAND` paragraph generated
from the same strings its refusal rows use (controls §3.1); refusals use
the §3.2 shape; context records stay their own command family and do not
join the Orchestra hierarchy views (§3.3); briefing lines go into the
command-list part of the §3.5 layout, riding the shared orientation
function the controls specification defines (generated from stored
records, applied by both the receive path and `dispatch-turn`, closing the
gap where `dispatch-turn` Players currently receive only conductor-authored
text). Registration follows the observed convention: a `commands.bend`
parse variant, one `usage()` line, one per-command help paragraph, an MCP
tool entry; there is no other registry. Delivery completion semantics for
the dispatch family follow the controls specification's revised public
completion contract (its §6 successor); context commands themselves are
synchronous reads and do not deliver messages.

## Query contract

### Request

```json
{
  "engine": "auto",
  "subject": {"kind": "position", "path": "src/server.ts", "line": 41, "column": 18},
  "select": ["definition", "type", "callers"],
  "cwd": "/path/to/target"
}
```

- `engine`: a supported engine name or `auto`; `auto` selects the engine
  whose declared subject kinds match, ambiguity refused with candidates
  named.
- `subject`: the selector. Kinds:
  - `position`: `{path, line, column}` — a source position.
  - `symbol`: `{name, container?, path?}` — a named symbol, optionally
    qualified.
  - `entity`: `{database, table?}` — a database or one object in it.
  - `dataset`: `{path}` — a structured document (see General context).
  - `runtime`: a debug subject (see Debug context for the intent shapes).
  - `program`: `{path}` — a project directory for environment context.
- `select`: projections from the fixed per-engine vocabulary. Unknown
  projections are refused with the valid set named.
- `cwd`: target directory; defaults per Issuance.
- The request admits no field outside the closed per-kind sets; extra
  fields are a structured refusal naming the field and rule.

### Response

One JSON document:

```json
{
  "query": "req-2026-10-05-01",
  "engine": "typescript",
  "engineVersion": "5.9.3",
  "subject": {"kind": "position", "path": "src/server.ts", "line": 41, "column": 18},
  "snapshot": {
    "capturedAt": "2026-10-05T12:00:00Z",
    "worktree": {"branch": "main", "commit": "abc123…", "dirty": true},
    "inputs": [{"path": "src/server.ts", "sha256": "…"}],
    "runtime": null
  },
  "facts": [
    {"kind": "type", "value": "express.RequestHandler",
     "classification": "checked",
     "oracle": {"name": "typescript", "version": "5.9.3", "detail": "TypeChecker.getTypeAtLocation"},
     "evidence": [{"path": "src/server.ts", "line": 41, "column": 18, "role": "write"}]}
  ],
  "relations": [
    {"kind": "calls", "from": {"ref": "…"}, "to": {"ref": "…"},
     "classification": "static-possible",
     "coverage": {"analysis": "index", "indexComplete": true},
     "evidence": [{"path": "src/server.ts", "line": 44, "column": 10}]}
  ],
  "refs": {"…": {"engine": "typescript", "subject": {"kind": "symbol", "name": "…"}}},
  "limits": ["valueIndirectCall: calls through values typed any are not resolved"],
  "references": [{"uri": "https://…", "retrievedAt": "2026-10-05T12:00:00Z", "sha256": "…", "note": "vendor API documentation"}],
  "applicability": "current"
}
```

Rules:

- Every fact and relation carries at least one evidence location
  (`path`/`line`/`column` with read/write role where the provider reports
  roles; stop and frame identifiers for runtime facts; database path and
  object name for schema facts; file path or probe identity for environment
  facts) and a per-fact classification:
  - `observed` — captured from a running subject by a debugging/runtime
    backend; the backend identity and runtime snapshot are named.
  - `static-possible` — derived from a provider's resolved static analysis
    (compiler-resolved references and call edges, analyzer path witnesses);
    the provider and analysis scope are named. Clang Static Analyzer bug
    reports (a witness that one bad path exists) are this class.
  - `checked` — a compiler-family oracle settled a precise proposition over
    a stated quantifier/domain; the fact carries the proposition, the
    domain, the oracle identity and version, and the raw verdict. Ordinary
    compiler-verified properties (resolved types, flow-narrowed types at a
    position, definite-assignment and unreachable-code diagnostics,
    `never`-return facts) are the strongest member. Explicitly modeled
    Clang Static Analyzer predicate queries qualify when the fact
    identifies the analysis model, the query, the supported paths (plist
    witnesses) and the compiler version. Verdict semantics (measured,
    models lane `clang_analyzer_eval` evidence): exactly one verdict
    settles; two contradictory verdicts mean unsettled and no `checked`
    fact is emitted; zero verdicts means exploration cut or query
    unreached — indistinguishable from the report alone, so absence of a
    verdict is never agreement. A `checked` fact states what the oracle's
    model established over its stated domain, not what holds of the
    program: a true proposition can still return both verdicts. The
    exploration budget is load-bearing (measured: restrictive max-nodes
    budgets settle nothing where the default settles), so budget and depth
    limits ride on the fact.
  - `declared` — operator-, author- or adapter-supplied text (a sink
    catalog entry, a JSDoc `@throws`, an ambient declaration, an access
    policy), carried as provenance, never as an engine result. Enumerated
    test outcomes are supporting evidence under this provenance, not an
    emitted classification.
- Every index-backed relation set discloses its coverage: the analysis
  kind, the scope examined, and index completeness
  (`coverage: {analysis, scope, indexComplete}` — code lane evidence: a
  fresh or partial index silently degrades cross-file references, so the
  disclosure is mandatory).
- `limits` is always present and uses measured limitation codes from the
  code lane's probe set: `dynamicPropertyAccess`, `valueIndirectCall`,
  `anyTypedSubject`, `interfaceDispatchToDeclaration`,
  `projectIndexIncomplete`, `capabilityUnavailable`,
  `compileDatabaseMissing`, `driverQueryDisabled`, plus free-text detail.
- `references` holds primary-source citations (vendor documentation,
  license texts, release APIs) as `{uri, retrievedAt, sha256, note}`.
  References support feasibility and packaging claims; they are never
  classified facts about the target. No query performs network retrieval to
  produce them: they appear only where the engine's declaration already
  carries the verified citation (for example `context-engines` packaging
  rows), never per routine query.
- `applicability` is computed at read time; see Freshness.

Refusals use the controls §3.2 shape — one JSON object `{error, command,
condition, next}` — with the violated field and rule named from the same
vocabulary table the validator uses.

## Freshness

Every result's snapshot names its actual consumed input closure:

- source facts: the worktree triple (`branch`, `commit`, `dirty` from
  `worktreeStatus`), SHA-256 digests of every file the provider read for
  the answer (the adapter reports the closure — a single-file hash cannot
  establish imported declaration identity), the provider's own project
  revision where one exists (TypeScript Program identity, effective
  compiler options, dependency/configuration identities), and relevant
  diagnostics;
- schema facts: the database main file digest **and** the `-wal`/`-shm`
  file digests when WAL mode is in use (hashing the main file alone misses
  WAL-backed changes), plus the read connection's consistency guarantee
  (below);
- environment facts: manifest/lockfile/config digests and resolved probe
  executable identities (path and version);
- runtime facts: the debuggee binary digest, the adapter-recorded process
  identity for a launched subject (the adapter spawned it and holds it —
  PID reuse cannot alias inside an owned session), and the pause sequence.
  No backend-supplied process-start timestamp is claimed: no such field is
  demonstrated on the probed backends. For an attached subject the snapshot
  records the target pid and the adapter's attach observation; staleness of
  a detached subject is not claimed.

Capture consistency: catalog reads run inside one read connection/one
statement batch so the schema snapshot is one consistent read. After
capture, the adapter re-digests the consumed inputs; a before/after
mismatch does not publish a claim of one current snapshot — the query fails
with a `changedDuringCapture` condition and no result row, and the caller
retries under a new `QUERY_ID`.

`applicability` is `current` when every named input still matches and
`stale` with `changedInputs` naming what differs — a pure function of
(recorded snapshot, current inputs) computed at `context-result` read time.
A stored result is never silently refreshed.

## Query semantics and context expansion

A source, schema, dataset or environment query is a pure read over the
target's current inputs. A runtime query executes or attaches under
explicit intent (see Debug context and Effect boundary).

Expansion: every `refs` entry is a self-describing selector — data, not
server state — valid as the `subject` of a follow-up query. The feature's
request-handler example (parameter types, resolved callees, database
accesses, authorization predicates, applicable diagnostics for one handler)
is one initial query plus expansion queries on returned refs, where each
named relationship is a programmatic result of a named provider. The
exception example is a runtime query whose stop captures the throw, plus
expansion into frame variables and environment facts. The coordinator
performs no automatic expansion: the agent drives each step through the
same interface, and each step's evidence, classification and limits are its
own.

## Supported set

The initial supported set (code lane recommendation, adopted; models and
runtime lanes' residuals named where open):

| Capability family | Engine and provider | Subjects | Status |
| --- | --- | --- | --- |
| Code context | `typescript`: vendored pinned TypeScript 5.9.3 compiler API, in-process | TypeScript, JavaScript source | initial |
| Code context | `clangd`: clangd over LSP, LLVM ≥ 20 floor for outgoing call edges | C, C++, Objective-C source | initial |
| Debug context | `cdp`: Node/V8 inspector protocol | Node JavaScript/TypeScript runtime subjects | initial (Node 22.15 CDP verification in acceptance) |
| Data-model context | `sqlite-schema`: `node:sqlite` read-only catalog | SQLite databases | initial |
| Data-model context | `postgres-schema`: `psql` catalog introspection | PostgreSQL databases | initial (models data critic confirmed) |
| Security context | `clang-analyzer`: `clang --analyze` / plist witnesses over the clangd-resolved call structure | the C target profile below | initial |
| Environment context | `environment`: manifest/lockfile parsing, toolchain probes, compiler-config resolution, config presence | project directories | initial |
| General context | `json-dataset`: SQLite json1 projections over JSON documents | JSON datasets/documents | initial (models environment lane confirming) |
| Code context | `sourcekit-lsp`: compilation-database workspace mode only | Swift source | candidate — cross-module references demonstrated with a populated index store; held from initial set pending swift.org toolchain packaging (the Xcode toolchain is not redistributable) |
| Code context | `rust-analyzer` | Rust source | hold — method shape fits the result model without redesign; excluded now: unmeasured cargo-discovery effect boundary, and a third process/project-model family before the result schema is reviewed |
| Debug context | `lldb-dap` | native binaries | unavailable — see below |

**`lldb-dap` is unavailable on this host, finally diagnosed**
(`semantic-runtime-sig10-result`, corroborated by finding
`lldb-dap-cannot-create-target`): core LLDB — all three installed builds
(Xcode 1700.0.9.502, CommandLineTools 1700.0.9.502, Homebrew LLVM 20.1.8) —
SIGBUSes at `target create` before any launch, reproducing with a one-line
no-`-g` binary across all seven DAP variants (debug map, dSYM,
line-tables, DWARF4/5, no-g); the fault is in dependent-image symbol
loading (`libSystem.B.dylib`, `dyld` in the module log; dyld shared-cache
causation marked as inference). The only working configuration is
`target create --no-dependents`, which yields static symbol and
source-breakpoint resolution with a UUID-matched dSYM but no run; a full
launch then stalls on OS authorization (Developer mode disabled; marked as
inference). Separately measured: `terminate` and eight other requests
behind false/absent capability flags SIGABRT the adapter — any DAP client
must gate every outgoing request against the `initialize` capability set.
Position: lldb-dap is not a supported backend; `observed` facts for
C-family targets are reported unavailable; the capability advertisement
(verified earlier: data breakpoints, setVariable, readMemory,
exceptionInfo, no stepBack, no terminateRequest) is recorded for the day a
working build exists, and the 5-condition acceptance gate the runtime lane
proposed (working `target create`, launch authorization, source-mapped
frames, known values at known stops, thread state) stands as the
re-qualification bar.

## Computable facts

### Code context

Per supported language, from the provider's own analysis (code lane tables;
every row there carries a DEMONSTRATED / VENDOR-DECLARED / UNVERIFIED label
and a probe path):

- symbol definition and declaration locations (alias chains resolved to the
  original declaration; multi-declaration merged symbols named; generated
  `.d.ts` positions identified as generated);
- resolved type at a position: declared, flow-narrowed and apparent types
  (TypeScript checker, `checked`); clangd hover/type-resolved facts with
  the server named;
- project-wide references with read/write roles, grouped per alias-chain
  segment (TypeScript `findReferences`; clangd index-backed `references`),
  coverage disclosed;
- outgoing and incoming call relations (TypeScript 5.9.3 call hierarchy;
  clangd `callHierarchy`, `outgoingCalls` at LLVM ≥ 20 — older servers
  report `capabilityUnavailable` with the server version);
- compiler diagnostics with codes, severity and locations;
- control-flow and exception-path facts **only from named demonstrated
  producers** (code lane producer table):
  - TypeScript: flow-narrowed types at positions, definite-assignment
    (TS2454) and unreachable-code (TS7027, under `allowUnreachableCode:
    false`) diagnostics, `never`-return facts — `checked` facts, not a
    CFG; the published d.ts declares zero public flow declarations
    (demonstrated absence). Parser AST selectors locate throw sites and
    try/catch nesting — structure, not propagation edges; async, callback,
    emitter and timer boundaries are runtime-dynamic and named as limits.
  - C/C++: clangd `textDocument/ast` (syntax structure: no blocks or
    edges); `textDocument/documentHighlight` (one-file occurrence ranges
    with Text/Read/Write roles). The clang driver route `--analyze
    -Xanalyzer -analyzer-checker=debug.DumpCFG` produces real
    intra-procedural CFG blocks with predecessors/successors (demonstrated)
    but runs the project compiler per translation unit — it sits behind an
    explicit capability, never in the default path. No LSP CFG request
    exists (clangd 17.0.0 rejects it, LSP 3.17 and clangd's extension list
    contain none; per-tested-version claims only).
  - Exception-path relations: no demonstrated producer for any candidate
    language. The capability reports unavailable (the code lane's A13
    feature-fidelity gate: a future claim names a demonstrated producer,
    its exact output meaning, snapshot mapping and external-fixture
    acceptance, or stays unavailable).
- value relationships: same-symbol occurrence sets with read/write roles
  (TypeScript `getDocumentHighlights`, clangd `documentHighlight`). These
  are not def-use, provenance or heap-mutation data; `valueOrigin` queries
  report unavailable (demonstrated counterexamples: alias mutation,
  getters, Proxy, prototype mutation, assertion functions, `any`).

TypeScript integration pins: an exact vendored `typescript` version
(7.1 is an announced breaking API generation; probes re-run at every
upgrade), `types`/`typeRoots` pinned or ancestor `node_modules` refused
(measured: ambient `@types` acquisition silently changes diagnostics and
call-hierarchy groups with directory layout), and compilation against the
pinned published d.ts only (the publicity audit: `@internal` entries are
stripped; runtime-only internals are not supported entry points).

### Debug context

Backend: Node/V8 inspector (CDP) — the only backend with demonstrated
runtime observation on this host (full matrix probed on Node 25.8.0;
discovery via `/json/list`, per-target WebSocket sessions, the
`--inspect-brk` handshake `Runtime.enable` + `Debugger.enable` +
`Runtime.runIfWaitingForDebugger`). Floor verification at Node 22.15 is an
acceptance item. Runtime subjects are JavaScript/TypeScript programs
launched under the inspector, and workers through the per-worker session
model (`NodeWorker.attachedToWorker` / `sendMessageToWorker`, distinct
debuggerIds; a parent under `--inspect-brk` pauses every worker at start
unless `execArgv: []` is set — the adapter declares worker handling).

Intent vocabulary (runtime lane's consolidated shapes):

- `{"kind":"runtime","intent":"launch","program","args"?,"stopAt"?,"stopOnException"?,"env":{…}}`
  — launches the debuggee with an explicitly declared, complete environment
  (default spawn inherits every launcher variable including
  credential-shaped ones — finding `net-debuggee-env-inherited`; an
  explicit env passes exactly the declared keys plus the platform-injected
  `__CF_USER_TEXT_ENCODING`). The inspector port is never static:
  `--inspect=0` with the actual port parsed from the child's stderr banner,
  then subject identity (pid, script path) verified in `/json/list` before
  attaching — a port collision silently disables debugging (banner only,
  program runs to completion, exit 0; finding
  `net-inspector-port-collision-silent`). Answers the runtime-session
  identity and initial state.
- `{"kind":"runtime","intent":"attach","pid"}` — attaches after verifying
  subject identity against the backend's listings. Denial, silence and
  adapter crash are three distinct first-class results. (lldb-DAP attach is
  refuted on this host for all target classes; CDP attach semantics are
  per the inspector's own rules.)
- `{"kind":"runtime","session":"rt:…","intent":"observe","select":[…]}` —
  valid against a stopped subject; the result names its pause identity
  (`Debugger.paused` carries no pause id — the adapter owns the pause
  sequence). Returns source-mapped stack frames (function, file, line,
  column: protocol frames carry generated positions only — the adapter
  decodes the map named by `scriptParsed.sourceMapURL` with its own VLQ
  decoder, verified against independent decoding; mapped positions are
  segment lookups, and renamed CommonJS bindings are not recoverable as
  runtime variables), scopes and variable values with types (one level per
  request; module bindings appear in the CJS wrapper frame's local scope —
  the top frame alone is insufficient; distinct handles can alias one
  object), thread/worker list with stop reasons, and exception descriptions
  (`uncaught` pauses only on uncaught; an uncaught throw inside async main
  reports reason `promiseRejection`; during a pause the exception value is
  `Debugger.paused.data`; async stacks exist only when
  `setAsyncCallStackDepth` was set before the chain formed). Classified
  `observed` with the runtime snapshot.
- `{"kind":"runtime","session":"rt:…","intent":"resume-step","action":"resume"|"next"|"stepIn"|"stepOut"}`
  — continues execution. Resume invalidates all pause-scoped handles; the
  next observe binds to a new pause sequence. A distinct `pausePending`
  state represents "pause requested, not yet effective" (measured:
  `Debugger.pause` on an idle target returns success but the pause arrives
  only at the next execution opportunity — 3498 ms later in the probe; a
  target with no pending JavaScript produces no stop; finding
  `net-pause-idle-target-deferred`; no timeout cutoff is invented).
- `{"kind":"runtime","session":"rt:…","intent":"evaluate","expression","frame"?}`
  — explicit evaluation, disclosed as a mutating effect
  (`evaluateOnCallFrame`, `callFunctionOn` and `Runtime.evaluate` execute
  target code; `throwOnSideEffect` rejects with an EvalError delivered
  in-band — the transport response still contains a result object, so
  protocol-level error checks alone miss the rejection; `Runtime.evaluate`
  reads subject environment values in-band, which is target runtime
  inspection under the stated output policy). Non-evaluating reads
  (`getProperties`, `getScriptSource`) are the default path.
- `{"kind":"runtime","session":"rt:…","intent":"release","onRelease":"terminate"|"detach"}`
  — ends the session; the shutdown claim reflects the inferior's verified
  state after the disconnect response, and adapter death mid-request is
  surfaced with its exit signal.

Ownership and lifetime (root contract correction, resolved against existing
host paths): a `launch` creates a recorded runtime-session row
(`rt:<QUERY_ID>`) owned by the requesting session, and spawns the debug
adapter as a retained child via `ProcessChild.retain`, keyed by a manifest
directory named by the runtime-session identity — the same mechanism that
carries harness sessions. When the requesting invocation runs inside a
recorded native attempt, the session keys to that attempt and attempt exit
triggers release (terminate or detach as declared). When it does not — an
interactive Principal issuing plain CLI invocations, with no active native
receive attempt — the runtime-session row persists across invocations under
its recorded owner, follow-up intents attach per invocation, and `release`
is the explicit end; open runtime sessions are listed by `context-engines`
so none is forgotten, and a stopped owner follows the existing
stopped-session handoff. Follow-up intents attach with
`ProcessChild.attach(directory)` and write request frames with
`ProcessChild.control_write`; the adapter answers on the newline-framed
spool. The adapter owns the debuggee's lifecycle: a finished debuggee waits
for the client to disconnect (`net-debuggee-held-open-by-client`), an
unreaped launcher orphans the debuggee to PID 1 still serving its
inspector, and client death resumes a paused subject to exit
(`net-detach-while-stopped-resumes`) — so the adapter reaps and disconnects
before exiting, and the coordinator's `ProcessChild.release`/`acknowledge`
close the keeper. A session whose adapter died is marked failed with its
cause and exit signal. A paused debuggee is not an agent and the owner
always acts on it; Baton2 parks no live work on debuggee state. This is
the smallest demonstrated mechanism — no debugger service, no new
scheduler.

Handles: every handle in a result is scoped to its pause sequence, and a
foreign-pause handle is refused by name **by the adapter** — the backend
cannot be relied on (reconciled from both players' transcripts: stale ids
error `-32000` while the debuggee runs but silently rebind to the next
pause's objects once a new pause occurs, a byte-identical `callFrameId`
returning the new value). One adapter client owns one debuggee session:
two concurrent inspector clients share one pause state, so another client's
stops would alias — the adapter holds the only client and reports any
pre-existing one.

Value fidelity: preview truncation is never silent (nested strings shorten
at 101 characters with `overflow=false`; objects preview a prefix with
`overflow=true`; `overflow=false` does not establish fidelity) — truncated
values carry a marker and an expansion ref that retrieves the full value
(`getProperties` expansion returned all 1000 properties and a full
10000-character string in the probe). Direct primitive strings arrive
complete.

Source drift: detected by content hash, not backend script identifiers (a
disk edit changed SHA-256 with zero inspector notification). For
directly-run `.ts` (Node type stripping), loaded bytes legitimately differ
from disk, so drift classification compares against the transformed
representation: the snapshot carries loaded-source identity, disk identity
at observation time, and the transformation relationship.

Debug endpoint secrecy: the inspector WebSocket's only credential is its
UUID path segment, and `/json/list` publishes it to any local HTTP client
(an unauthenticated client executed `Runtime.evaluate` in the probe).
Debug endpoint URLs and UUIDs are privileged session-scoped data and never
appear in results; the default bind is loopback and the adapter keeps it
so.

### Data-model context

Catalog facts, from a database opened read-only and failing on a missing
file (`node:sqlite` `DatabaseSync(path, {readOnly: true})` — the models
lane proved the read-write default is a defect class: the coordinator's own
`Sql.query` opens read-write at `bend2/src/host/sqlite.c:38`, creates a
missing file so a misspelled subject yields an empty catalog instead of an
error, and sets `PRAGMA foreign_keys=ON` at `sqlite.c:44-45`; it is never
used on subjects): tables, views, columns (declared types, nullability,
defaults, primary-key membership — rowid rendered as the primary-key column
with `rowid` carried in provenance), foreign keys, indexes and uniqueness,
constraints including deferrable/NOT VALID/actions (PostgreSQL
`pg_constraint` with `pg_get_constraintdef` expression text attributed to
the server version), recorded DDL verbatim as evidence, applied-migration
state tables read as catalog facts when present, and the connection
configuration (`connectionConfig`: dialect, foreign-key state, role) on
every enforcement-dependent result. ATTACHed databases and foreign-data
wrappers are a named limit. Dialects: SQLite first, PostgreSQL 14+ second
(catalog introspection against a live server; `information_schema` +
`pg_catalog`, read-only transactions).

**Enforcement is never a catalog fact.** Whether a constraint is enforced
is `observed` (an executed witness with its `connectionConfig` — measured:
SQLite's default CLI connection accepts an orphan insert that
`foreign_keys=ON` and the node:sqlite defaults reject; PostgreSQL enforces
on every connection) or supporting evidence. A catalog listing alone is
`static-possible`.

Schema-to-code links, the seven-rule join (demonstrated on both engines,
read and write paths; models data lane):

1. Callee resolution through the compiler checker (TypeScript
   `checker.getSymbolAtLocation`/`getAliasedSymbol`; Python
   `jedi.Script.goto(follow_imports=True)` over `ast.parse`), recording the
   resolved declaration's file:line. Same-name matching is disqualified
   (V1 `atlas-cpg.mjs:304-308` mis-resolves a shadowed callee to an
   unrelated same-name global — independently reproduced by two critics).
2. Constant SQL only, from string literals or substitution-free template
   literals. Interpolated SQL returns `availability:unavailable,
   reason:dynamic_sql_interpolation` (measured incidence: 3 of 15 TS call
   sites, 5 of 14 Python call sites).
3. Statement parse by the target database engine itself
   (`prepare`/`EXPLAIN`), never keyword or regex extraction. Relations join
   through engine-internal identity: SQLite OpenRead/OpenWrite rootpage →
   `sqlite_master`; PostgreSQL ModifyTable Relation Name/relid →
   `pg_class`. Write statements plan identically to reads on both engines.
4. Dialect identifier rules: unquoted identifiers fold per dialect
   (PostgreSQL lowercases; SQLite ASCII case-insensitive), quoted match
   exactly.
5. Result-name → storage-column mapping from engine origin metadata where
   the engine provides it (node:sqlite `StatementSync.columns()` maps
   `contact → users.email` through SQL aliases and maps RETURNING columns
   at prepare time). Per-engine availability: origin mapping for write
   results is available on SQLite, unavailable on PG14 EXPLAIN (named
   reason, or observed capture via execution). Expression results
   (`COUNT(*) AS n`) return null origins — the engine's own unavailable
   signal, preserved.
6. Read-only inspection connections only; parameterized statements bind
   values as data (value-dependent plan variation a named limit).
7. Write-path facts follow the same rules: aliased UPDATE/DELETE targets
   resolve to the storage table; view-mediated writes have a two-branch
   representation (engine refusal with the engine error on SQLite, or
   engine rewrite to the base relation on PostgreSQL auto-updatable views);
   write plans embed engine-attributed constraint columns; the UPDATE
   written-vs-read column split is register-level (limit
   `columnsReferencedSemantics`).

Measured: TypeScript 5.9.3 resolution plus `node:sqlite` joined 10
constant-SQL statements to catalog objects, 3 dynamic disclosed, 4
name-matching false links falsified; the Python path joined 7 with
`set_authorizer` resolving through aliases. Validation facts: pydantic
(`ValidationError.errors()`), zod (`safeParse().error.issues`), jsonschema
and ajv providers — one fact per layer; layer disagreements are findings,
never merged (fixture: value accepted by storage CHECK, rejected by the
application layer). Serialization: `model_dump`/`model_json_schema`,
`z.toJSONSchema`, and engine origin metadata (rule 5). Migrations: replay
the declared chain into a fresh database with the same engine, compare
against the live catalog, split drift into pending migrations versus
out-of-band change; per-tool applied-state readers are net-new adapters.
Resolver dependencies: pinned TypeScript 5.9.3 (shipped — the host copy
resolves through ancestor `node_modules`, which is host state, not release
packaging) and pinned/vendored jedi 0.19.2 + parso 0.8.4 (jedi
nondeterminism across identical runs is measured, so resolved paths carry
no per-symbol determinism claim). Recovered constant SQL is source content
— a statement literal can hold a credential, so the provider states whether
literals are present, and literals return under the explicit-inspection
output policy. Exclusions (unavailable with named reasons, never silently
absent): CHECK/DEFERRABLE/partial-index/expression-index/generated-column
expressions as structure (they arrive as DDL text), constraint declaration
position, rename history, dynamic SQL and query builders, call sites with
undetermined target database, ORM-runtime models, MySQL and other engines,
document stores, cross-database subjects beyond the named ATTACH/FDW
limit.

### Security context

Initial target profile (models lane, demonstrated on owned fixtures): one
C/C++ translation unit with scalar principal/action/resource bindings,
direct function calls and one wrapper layer, local struct fields with
supported aliases, known compiler build options. The subject (or its
adapter declaration) supplies declared identities for external input,
principal attributes and sensitive operations. Computed relationships on
this profile (all demonstrated on LLVM clang 20.1.8 unless noted):

| Relationship | Producer | Classification |
| --- | --- | --- |
| `resolved_direct_call(callsite, declaration)` | clang front-end scope/type binding (`clang -Xclang -ast-dump=json -fsyntax-only` + extractor) | `static-possible` |
| `resolved_local_binding(callsite, local_object)` | same — a parameter/variable callee binds to the local object; the unresolved target says so (shadowed-callee fixture) | `static-possible` |
| `static_possible_reaches(source_site, sink_site)` | reachability over resolved call edges between declared source/sink roles | `static-possible` |
| `inferred_flow_path(origin, sink, [branch_decisions])` | `clang --analyze -Xclang -analyzer-checker=optin.taint.GenericTaint` plist/text witnesses; every branch decision named | `static-possible`; role basis `declared` |
| `guard_on_path(condition_expression, path)` | the branch condition the path depends on, source range included; the condition is resolved, its authorization meaning is `declared` | `static-possible` + `declared` |
| `boundary_crossing(kind, site, [captured values])` | process/network/parse/privilege boundary sites | per-fact class (`observed` when debugger/runtime-captured, else `static-possible`) |
| `policy_decision(predicate, input_document, decision)` | one evaluation of a declared predicate against one concrete input (`sandbox-exec` is the only installed policy engine; OPA is absent — embedding forms are vendor-declared and carried as `references`) | decision per input; predicate `declared` |
| Settled predicate queries | `clang_analyzer_eval` under `debug.ExprInspection` | `checked`, carrying proposition+site, model+exploration domain, plist witness identity, compiler version, raw verdict (2 of 5 propositions settled in the probe) |
| Compiler-verified properties | `clang -fsyntax-only -Wall -Wformat-security`, static assertions | `checked` (the compiler's own proof obligation) |

**The core relationship is the R5+R7 join**: declared policy predicate +
resolved guard condition on an inferred flow path + recorded decision. All
three parts exist in the probes; the join itself is the security adapter's
central implementation work, named explicitly so this specification does
not present a sink-catalog walk as the capability.

Sanitizer/filter declarations (`optin.taint.TaintPropagation:Config`) are
`declared` semantics: the configuration suppresses the path whether or not
the function sanitizes — both directions are the operator's declaration.
Release pinning rule (demonstrated): pin the analyzer build and verify at
startup that the taint checker AND the taint configuration key are both
registered — Apple Clang 17 has the checker (`alpha.security.taint…`) but
not the configuration key, so a declared sanitizer silently does nothing
there.

Scope/limits rendering (critic, adopted): every result exposes subject
digest, analyzer/model versions, files examined and excluded, entry points
and assumed principals, source/sink/sanitizer definitions with declaration
authority, alias/heap/interprocedural/dynamic-dispatch/exception coverage,
and completion status. "No paths returned" renders as
backend-result-under-limits, never "no vulnerable paths"; an
`artifact_integrity` failure is a failed analysis with retained
diagnostics. Unavailable/incomplete status with reason codes survives every
expansion and summary.

Explicitly excluded from the initial profile: unresolved callbacks and
indirect dispatch (the call-graph backend omits the function-pointer
target), cross-translation-unit assumptions (CTU options registered on
LLVM 20, untested), heap aliasing beyond local objects, identity-provider
semantics, arbitrary frameworks, C++ object code (all fixtures are C). For
languages without a flow engine (Python: `ast` and `pdb` only, no
value-flow engine — demonstrated absence), input-flow relationships are
built from compiler-resolved facts with a declared policy, classified
`static-possible` with the policy named. **Banned patterns** (finding
`semantic-security-v1-evidence`, retained falsification fixtures):
caller-declared source/sink/sanitizer name lists over a bounded graph,
sanitizer suppression by callee-name cuts, unique-name call resolution
(mis-resolves under parameter shadowing), and any keyword/regex search
presented as semantics. Security facts consume code-context call graphs;
the security adapter never recomputes them, and the code-to-data join map
is the same fact shape as its input paths — one resolver-join
implementation serves both.

### Environment context

For a program directory: declared dependencies and locked versions parsed
as data (package-manager scripts never execute); toolchain facts (versions
and resolved executable paths); build configuration (TypeScript compiler
options via `parseJsonConfigFileContent`; `compile_commands.json` /
`compile_flags.txt` presence and content); applicable configuration
presence (files by path; dotenv-class files by path and key names only);
available service facts that affect the examined program, each with its
probe identity. Version-sensitive claims are evaluated at the Node 22.15
floor. The models environment lane's final fact-kind list and service-probe
scope close as a residual.

### General context

Structured document subjects: `json-dataset` loads a JSON document and
answers json1 projections over it (the coordinator's existing SQLite json1
machinery is the provider — no new dependency): agents query structure,
paths and values of large JSON datasets without pasting excerpts. The
document is a read-only subject with the same snapshot and evidence rules.
Other document formats (YAML, Markdown structure, CSV) are unverified
candidates, named as gaps until a real provider is demonstrated.

## Capability gaps

- **Observed facts for C-family targets**: lldb-dap is unavailable (final
  diagnosis above); no C-family runtime claim is made.
- **Reverse execution**: unsupported by every probed debug backend.
- **Static exception-path relations**: no demonstrated producer for any
  candidate language; the A13 gate governs any future claim.
- **CFG as a default-path artifact**: only the effect-bearing DumpCFG
  driver route produces real CFGs, behind an explicit capability.
- **Rust, plain-JS (`checkJs`), TSX, Objective-C fixtures**: unexercised;
  Rust is on hold (Supported set), the others name their missing fixtures.
- **Swift**: candidate, held for toolchain packaging; index-coverage
  disclosure and subject-position normalization are its shipping limits.
- **Dataflow/taint beyond the C family**: no packaged flow engine;
  declared-policy relationships say so.
- **Dynamic dispatch**: function-pointer/vtable and `any`-typed call
  targets end static walks at that edge (`valueIndirectCall`,
  `interfaceDispatchToDeclaration` limitation codes).
- **ATTACH/FDW data federation, non-JSON document formats**: named limits.
- An engine reported unavailable is honesty, not coverage: **no
  unavailable-only result counts toward feature acceptance** — acceptance
  exercises available engines on real subjects (below).

## Sharing through reports and findings

Context results are ordinary JSON text, and stored results are re-readable
through `context-result`. Durable sharing uses the existing knowledge
workflow with no new tables: an agent includes the result (or selected
facts) in a `report` or `message`; a reviewer records a finding citing
`message:<ID>`; promotion shares it through `promote`; readers retrieve it
with `knowledge`. A finding citing a context result stays verifiable: the
snapshot lets a reviewer re-run the same query under a fresh identity (or
read the stored row) and check applicability against current inputs.

## Effect boundary

Each rule names its enforcing mechanism (root contract correction; existing
functions unless marked):

- **One-shot adapter runs**: `Process.run` (`git/process.c`) with
  coordinator-built length-prefixed argv (no shell), the validated request
  document in argv, stdout read to EOF uncapped, stderr redirected to the
  retained per-invocation log file named in the refusal. Adapter processes
  run with the local user's ordinary access under the existing
  trusted-local boundary; the adapter process itself inherits the serving
  process's environment (same boundary as the coordinator), and harness
  credential material is never part of any adapter's inputs (feature
  `98fbfe03`).
- **Retained runtime adapters**: `ProcessChild.retain` / `attach` /
  `control_write` / `release` / `acknowledge` (`host/process-spawn.c`),
  keyed by the runtime-session manifest directory; attempt/owner lifecycle
  per Debug context.
- **Debuggee and adapter-child environments**: the adapter constructs an
  explicit environment for every process it launches
  (`child_process.spawn` `env` option; probe-verified to pass exactly the
  declared keys plus the platform-injected `__CF_USER_TEXT_ENCODING`,
  which the declared-environment accounting expects). A default-inherit
  launch is a defect the acceptance gate checks (the 104-key inheritance
  probe).
- **Read scope**: admitted reads are (a) the subject root, (b) the
  provider-resolved dependency and configuration closure — resolved imports,
  `node_modules` type packages, compiler resource directories, SDK paths —
  each recorded in `snapshot.inputs`, and (c) explicitly declared tool and
  data paths. Symlinks are followed for provider-resolved paths (ordinary
  resolved imports must not break), and every resolved path is recorded;
  reads outside the closure are refused with the path named. The
  coordination database is never a subject.
- **Language-parser evaluation**: clangd virtual compile commands,
  TypeScript project parsing, sourcekit-lsp compilation-database mode read
  target bytes and never compile, link or run subject code. Compiler
  execution happens only where explicitly enabled — `--query-driver` (off
  unless the deployment declares it; surfaced as project-tool execution),
  the DumpCFG driver route (behind an explicit capability), SwiftPM mode
  (unused) — and each such route is named. The adapter pins provider
  options explicitly because workspace configuration can inject them
  (sourcekit-lsp forwards `clangdOptions`).
- **Project code execution**: package-manager lifecycle scripts, SwiftPM
  manifest evaluation, Cargo build scripts and procedural macros, and
  rust-analyzer's check execution are never triggered by source or
  environment queries; dependency and build facts come from parsing
  manifests, lockfiles and compiler configuration as data.
- **Runtime execution/attach**: only under an explicit `launch`/`attach`
  intent, with the local user's ordinary access; lifetime ownership per
  Debug context. Expression evaluation is an explicit disclosed intent.
- **Database access**: `node:sqlite` `readOnly: true`; no migrations or
  write PRAGMAs.
- **Partial effects**: the admission transaction publishes a result row
  only after validated completion; a killed adapter leaves no published
  result; refusal paths are host-tested to show no forbidden effect
  occurred (exact argv/cwd assertions, the `test/process.py` pattern).
- **Service destinations**: environment service probes are read-only, named
  in the request, with the destination identity recorded in the snapshot;
  no engine performs other network egress (`Index.External.Server`-style
  provider features are not enabled).

## Credential boundary

Feature text (`98fbfe03`): automatic environment context excludes credential
values; explicit source and runtime inspection has a stated access and
output policy; adapters receive no harness credential material.

- **Channels.** The boundary applies to: briefing orientation text,
  `context-engines` output, environment projections, source excerpts,
  backend diagnostics and error text, expansion results, CLI and MCP
  returns, and any later reuse of stored results or transcripts in context.
- **Automatic surfaces** return no credential values. Dotenv-class files
  are reported by path and key names only; the fact constructor for these
  files has no value field (structural exclusion, stated as a law — not a
  `[redacted]` marker). Environment values are returned only for the fixed
  enumerated value-safe kinds: dependency names and versions, compiler
  options, tool versions and executable paths, file presence, and service
  availability booleans. Everything else carries no values by construction.
- **Explicit inspection** concerns the examined target: source excerpts
  (including recovered constant SQL, which can embed credential-shaped
  text) are target bytes returned through the query result under the
  trusted-local boundary — the same access the agent already has to its
  workspace — and runtime debug values are admitted through explicit
  `runtime` intents and classified `observed` with their snapshot. **No
  subject kind reads the invoking coordinator or harness process
  environment**: the feature concerns the examined external target, and
  process-environment access would add irrelevant credential reach
  (root contract correction; the earlier `variable` subject is removed).
- **Error returns**: adapter stderr goes to a retained log file; refusal
  and error answers name the condition and the log path, and do not inline
  raw adapter output.
- **Raw output and logs**: raw adapter transcripts live in the log area
  under the same trusted-local access as existing native logs; stored
  result rows hold provider facts through the serving projection; raw
  transcripts are not imported into result rows.
- **No detector**: nothing scans values or names to guess what is
  sensitive; no component claims universal secret detection. The boundary
  is structural: value-carrying kinds are the fixed set above, and every
  other channel carries no values.

## Packaging, dependencies and licenses

Classification per component (acceptance critic packaging criteria;
`semantic-integration-packaging`):

- **Bundled**: the TypeScript compiler package, pinned at 5.9.3
  (Apache-2.0, self-contained, no runtime dependencies; `lib/typescript.js`
  9,112,572 bytes in the pinned release), staged under
  `libexec/baton2/vendor/` with `notices/typescript-LICENSE` (staged
  explicitly — the notice-basename rule does not match every license
  filename), a `distribution.md` entry, per-file manifest hashes and
  license-test coverage — the pattern that vendors the Bend compiler with
  license digests. Consumers resolve it by explicit path relative to the
  coordinator executable; ancestor `node_modules` resolution is never used
  (probe-proved ambient resolution at the installed location; the adapter
  constructs its require from the bundled path so ambient resolution cannot
  supply the evidence). Development checkouts use an explicit environment
  variable; an unresolved dependency makes the engine absent and
  `context-engines` reports it. The code lane's unresolved item — the
  dependency manifest location naming this pin — closes in packaging
  implementation.
- **External, declared**: Node at the existing declared floor 22.15
  (`installation.md` and `harness-setup.md` already declare Node 22.15+ for
  the Git identity helper; `node:sqlite` is flagless since 22.13.0). Three
  postures stay distinct: the bare `bin/baton2` Mach-O has no Node
  prerequisite; the existing `libexec/*.mjs` helpers carry the declared
  22.15+ requirement; the semantic adapters inherit the same 22.15 floor —
  this host's Node 25.8.0 establishes no floor, and no adapter may require
  an API absent at 22.15 (the CDP surface is verified at 22.15 in
  acceptance). Other declared externals: clangd (LLVM ≥ 20 for outgoing
  call edges — vendored per-platform standalone binaries are an option the
  code lane priced: mac 95.4 MiB, linux 112.5 MiB, windows 28.3 MiB,
  vendor-declared sizes; external-with-capability-reporting is the default),
  clang/scan-build for the security target, `psql` for the PostgreSQL
  dialect. Each is probed at query time; `context-engines` reports the
  resolved path, version and missing prerequisites. Platform/architecture
  support is declared per engine (darwin-arm64 at launch).
- **Package shape today**: Mach-O `bin/baton2` with no Node prerequisite;
  exactly seven `libexec/*.mjs` helpers carrying the host Node prerequisite
  (`semantic-review-libexec-count`). New adapter files join `libexec/` as
  `node`-spawned files (no chmod/shebang needed) under the existing
  `stage_adapters` mechanism, with notices, `distribution.md` entries and
  manifest hashes per added file, and the source-inventory extension the
  integration lane specified.
- **Build inputs vs payload** are separate manifest facts; the packaging
  gates record qualification toolchain versions. (CI observation:
  `bend2-native.yml` pins `node-version: '22'`, resolving to the newest
  22.x rather than exercising the 22.15 floor — a CI-provenance note for
  the implementation phase.)
- Installation/relocation evidence: acceptance includes a packaged-install
  run from the staged prefix with ambient `node_modules` unavailable,
  proving each bundled component resolves from the payload and each
  external dependency reports truthful readiness.

## Laws and host acceptance

Laws join the per-module `*-laws.bend` style, aggregated through
`coordinator/laws.bend`, checked by `laws-check.mjs` (proof-removal plus
pinned implementation mutations; 578 laws/172 mutations at baseline) and
gated in packaging. Carrier honesty (language lane): provenance claims are
host assumptions stated at the law site; honest Bend carriers are codomain
claims over closed result types and verbatim-equality equations binding the
exact SQL/composition functions; provider behavior itself is host evidence
covered by fixtures, not laws. Planned law families (language lane §8,
integration lane's merged M-19 set):

1. Parse laws: each new command parses its native arguments.
2. Declared dispatch: a query runs exactly the engine its method selects;
   an unselected method refuses with the named condition.
3. No fabrication: a failed or absent adapter run cannot publish a result;
   result composition is bound by verbatim-output equality so caller input
   cannot inject fact rows; the admission transaction publishes only on
   validated completion.
4. Refusals come from the vocabulary table: field/rule/remedy of a context
   refusal match the validator's row.
5. Credential exclusion by construction: the dotenv-class fact constructor
   carries no value field; no subject kind reads process environment; the
   serving projection emits only the enumerated value-safe kinds.
6. Applicability is pure: a function of (recorded snapshot, current
   snapshot) only; the short-circuit-to-`current` mutation fails. The
   capture-consistency rule (re-digest after capture, `changedDuringCapture`
   publishes nothing) binds the assembly function.
7. Catalog follows observation (12b): the capabilities answer equals
   `expected(declarations, observations, exclusions)`; hand-table and
   hand-allowlist mutations fail.
8. No ceiling (12a): output magnitude never alters status or truncates the
   stored result; size-ceiling and timeout mutations fail to compile.
9. Identity laws: identical retry replays the stored row; conflicting
   same-id reuse fails the transaction.
10. Runtime-session laws: a runtime row is created only by a `launch`
    intent with its owner recorded; a foreign-pause handle refusal is
    adapter-enforced and stated as a host assumption with fixture coverage;
    `close` marks exactly its row.
11. Entry laws binding each `main.bend` arm to its module function.

Host checks (automatic under `check-native.sh`; acceptance driver
`accept-semantic-context.py` for the real-subject gate): forged result
insertion refused with the rule named; adapter nonzero exit or malformed
JSON yields `failed`/refusal with the observed cause and no facts;
large-magnitude output stored and served complete, byte-identical;
declared-but-failed probe listed as `failed: <cause>`; exclusion removes
exactly the excluded entry; staleness flips applicability after a fixture
edit and restores after revert; WAL-mode schema fixture changes are
detected (main+WAL digests); `changedDuringCapture` publishes nothing;
credential-channel fixtures (dotenv file, debuggee explicit-environment
accounting including `__CF_USER_TEXT_ENCODING`, adapter stderr containing
credential-shaped text) show the boundary holds at each channel; denied
effects show no forbidden effect occurred; idempotent retry and
conflicting-identity behavior; MCP contract equality with CLI output;
foreign-pause handle refusal on a two-pause fixture; `pausePending`
represented on an idle-target fixture without any timeout.

**Meaningful acceptance** (acceptance critic §Meaningful): the gate pins a
real external application per supported combination and, through the
installed query interface, establishes a handler's parameter type and
resolved callee, the actual database operation/entity and migration
constraint, the validation and authorization predicates with branch
conditions, and an applicable diagnostic — every returned location
independently inspected in the pinned source. Runtime claims attach the
CDP backend to a controlled Node instance and compare
frame/value/exception observations with that run, at the Node 22.15 floor
and on the qualification host. A source expression or runtime value is
then changed and re-queried: the result tracks the change or reports
stale. The fixture corpus under `bend2/test/context/`: TypeScript fixture
(known symbols, alias chains, references with roles, call hierarchy,
diagnostics, one analyzer-joinable database client, ambient-types pinning),
C fixture (known AST facts, diagnostics, guard/operation topology for the
security target profile, macro-collapse and virtual-dispatch limits),
SQLite fixture (known keys and constraints, WAL mode), PostgreSQL fixture,
Node debug fixture (known values at known stops, two-pause handle fixture,
idle-target pausePending fixture), environment fixture (manifest, lockfile,
tsconfig chain, dotenv), JSON dataset fixture. Vacuous scenarios are
rejected by construction: a staged backend returning prewritten JSON, and
hand-populated store rows, prove decoding only and are not acceptance; an
engine that reports unavailable demonstrates honesty reporting only, never
feature coverage. Cross-surface comparisons permit differences in
timestamps, fresh execution identities and independently observed runtime
values; stable facts must agree for the same examined inputs.
Packaged-install runs through the staged prefix prove native use through
the installed package.

## Implementation division

Applies after root approval. The parallel-work contract is this
specification: request/response shapes, the coordinator↔adapter protocol,
projection vocabularies, limitation codes and classification rules are
fixed here. File sets are disjoint; the integration owner writes shared
files. Final worker assignments follow the remaining residuals; the working
shape:

| Worker | Files (exclusive) | Content |
| --- | --- | --- |
| Context core | `bend2/src/coordinator/semantic-context.bend`, `semantic-context-laws.bend` | Request validation, engine selection, adapter runs, result assembly, applicability, runtime-session rows, laws 1–10 |
| TypeScript adapter | `bend2/adapters/context-typescript.mjs` + vendoring inputs | Language-service driver, config resolution, schema-link extraction, pinned types/typeRoots |
| clangd adapter | `bend2/adapters/context-clangd.mjs` | LSP client, diagnostics, call hierarchy, coverage disclosure, analyzer invocation for the security target |
| Debug adapter | `bend2/adapters/context-debug.mjs` | Retained CDP runtime-session driver: intent handling, pause-namespaced handles with foreign-pause refusal, explicit debuggee environments, VLQ source-map decoding, observation projections |
| Schema adapters | `bend2/adapters/context-sqlite.mjs`, `context-postgres.mjs` | Read-only catalog readers and the schema-to-code join support |
| Environment adapter | `bend2/adapters/context-environment.mjs` | Manifest/lockfile parsing, toolchain probes, config resolution and presence, dataset projections |
| Integration owner (semantic-lead) | `commands.bend`, `main.bend`, `mcp-conductor.mjs`, `package-native.py`, `accept-semantic-context.py`, `bend2/test/context/`, this document; `receive.bend` and `turn.bend` through the shared-ownership handoff below | Command grammar/dispatch, entry laws, MCP tools, briefing content, staging/notices, acceptance |

Shared runtime files cross both active feature specifications (this one and
orchestra-control). Per root's direction, each shared file has exactly one
owning conductor; the other feature's changes to that file land through the
owner as reviewed handoffs (the non-owner supplies exact edits and tests,
the owner applies, verifies and lands). The assignment, proposed to
semantic-controls in the `semantic-task-conductors` Ensemble and aligned
with root's control-draft review item 3:

| Shared file | Owner | Handoff boundary |
| --- | --- | --- |
| `bend2/src/coordinator/commands.bend` | semantic-lead | Controls' new command variants land through semantic-lead |
| `bend2/src/coordinator/main.bend` | semantic-lead | Dispatch arms, `usage()` lines and help wiring for both features |
| `bend2/src/coordinator/receive.bend` | semantic-controls | The shared orientation function and briefing layout are controls'; the context orientation block is supplied by semantic-lead |
| `bend2/src/coordinator/turn.bend` | semantic-controls | `dispatch-turn` orientation (prompt-file prepend) is controls' |
| `bend2/scripts/mcp-conductor.mjs` | semantic-lead | Tool entries and description strings for both features land through semantic-lead |
| `bend2/scripts/package-native.py` | semantic-lead | Staging, notices, manifest and distribution entries for both features |
| `bend2/src/coordinator/laws.bend` | semantic-lead | Per-feature law modules are disjoint new files; aggregation edits land through semantic-lead |
| `bend2/test/` and check-script wiring | per-feature new test files are disjoint; shared check-script wiring lands through semantic-lead | Each feature's tests run under the existing automatic `check-native.sh` discovery |

Document ownership: `semantic-context-spec.md` is semantic-lead's,
`orchestra-control-spec.md` is semantic-controls', feature documents are
root's.

## Review questions answered

The acceptance critic's seven pre-review questions:

1. **Targets and versions per feature**: the Supported set matrix names
   each engine, provider, subjects and status; qualifications (LLVM ≥ 20,
   compilation-database-only Swift, analyzer model, Node 22.15 floor) are
   stated per engine; residuals are in Open decisions.
2. **Credential channels and rules**: Credential boundary names every
   channel, the structural rule at each, the explicit-inspection policy
   (target source and runtime values only — no process-environment
   subject), error-return policy, raw-output handling and detector limits.
3. **Trusted callers and authority**: the trusted-local boundary holds
   (declared actors, no hostile-caller authentication); Effect boundary
   names each effect class, its enforcing functions, its admission and its
   refusal-no-effect requirement.
4. **Freshness identities**: Freshness names the consumed input closure
   (digests including WAL files, provider project revisions, effective
   options, probe identities, binary digest, adapter-owned process
   identity, pause sequence), capture consistency and
   `changedDuringCapture`, staleness and replaced subjects; historical
   runtime values are recorded observations — later live access is not
   promised.
5. **Actual relationships**: every relationship names its provider and
   meaning with a DEMONSTRATED/VENDOR-DECLARED/UNVERIFIED status in the
   lane tables; predicate/control conditions and schema/code/validation
   links are classified facts with evidence, independently inspectable
   through expansion; what each security method establishes is stated with
   its model and domain.
6. **Shipping and missing backends**: Packaging classifies every component
   bundled vs external with versions, licenses and readiness behavior,
   including the Node 22.15 floor and the ambient-resolution prohibition.
7. **Acceptance evidence**: Laws and host acceptance names the laws,
   mutation controls, host checks, the meaningful-acceptance scenario,
   permitted cross-surface differences, and what remains unobserved until
   the gate runs (CDP captures at 22.15, packaged-install run).

## Open decisions

1. **Models lane final consolidation**: security target expansion beyond
   the initial C profile; the environment lane's final value-safe fact-kind
   list and service-probe scope; `json-dataset` confirmation as the general
   family's initial member.
2. **Runtime lane final consolidation**: confirmation of the CDP intent
   vocabulary as specified here, the 5-condition re-qualification gate text
   for lldb-dap, and any protocol-critic residuals.
3. **Integration lane final consolidation**: law-set reconciliation with
   the laws-critic's verdicts; final packaging deltas; the vendored-
   `typescript` dependency-manifest location.
4. **Swift release posture**: swift.org toolchain packaging answer (the
   Xcode toolchain is not redistributable); until then Swift stays a
   documented candidate with its two shipping limits.
5. **Shared-file ownership**: semantic-controls' confirmation or revision
   of the assignment above (proposed; tracks the controls successor).
6. **Ref encoding**: exact handle encoding within the json1/Tx parsing
   constraints (integration lane input).

Resolved during consolidation: the adapter architecture (external
processes, one-shot argv transport, retained keeper for runtime sessions);
query issuance and runtime-session ownership (recorded rows + keeper, no
harness attempt required); the classification vocabulary with measured
verdict semantics; the `references` citation field (no per-query network
retrieval); command naming and CLI/refusal shapes; the supported-set core
(TS/JS + C/C++/ObjC code, CDP debug, SQLite+PostgreSQL data, C-profile
security, environment, JSON datasets); Rust on hold; lldb-dap unavailable
with the re-qualification gate; the capture-consistency and WAL freshness
rules; the process-environment subject removal; surface conventions (cited
from the controls successor).
