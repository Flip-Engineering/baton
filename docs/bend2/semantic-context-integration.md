# Native semantic context: integration lane consolidation

Status: design and evidence research. No runtime change is authorized by this
document. Baseline `6929bffeeac32514968dd3d104dd7503eec1fba5`; canonical feature
text at `98fbfe03`. Installed release Baton2 1.1.0
(`fca7af876c8260c32d17f95f3e19bc68ee1bf561`; the installed binary and the
baseline tree differ only by the feature document).

This document is the `semantic-integration` lane's consolidation for the
combined specification (`docs/bend2/semantic-context-spec.md`, lead worktree).
It records the lane's evidence, the architecture decision grounds, and the
closure of the lane's three open decisions: command/store/law confirmation,
the request transport convention, and the final packaging/staging deltas.

Evidence base (all paths absolute unless noted; `PROBES` abbreviates
`/Users/wahargis/Development/Experiments/baton-bend2-root-delivery-20260928/.scratch/semantic-context-20261005/probes`):

- `.../reports/integration-laws-research.md` — admission, schema, host
  boundaries (compiled and built-probe evidence).
- `.../reports/integration-laws-critic.md` — independent verification
  (reconciliation status recorded in §6).
- `.../reports/integration-delivery-research.md` — CLI/MCP surface, packaging.
- `.../reports/integration-delivery-critic.md` — observed installed-binary
  behavior.
- `.../semantic-language-report.md` — Bend 2.0.25 constraints.
- `/tmp/semantic-backends-report.md` and the lead-retained
  `semantic-backends-report-2.md` — provider evidence, clangd correction,
  TypeScript 5.9.3, Node floor.

Demonstration labels below: **demonstrated** (run/compiled/measured by this
Ensemble), **source** (read in pinned source with file:line), **vendor**
(vendor documentation), **unverified** (not observed).

## 1. Architecture decision: external adapter processes

Adopted: external adapter processes. One-shot queries run through
`Process.run` (`bend2/src/git/process.bend:12-14`, `git/process.c:143-156`);
session-stateful engines run retained through
`ProcessChild.retain/attach/control_write`
(`bend2/src/host/process.bend:13-58`, `process-spawn.c`), keyed by the
requesting attempt. Adapters own provider framing (LSP Content-Length, DAP,
JSON-RPC); the coordinator↔adapter protocol is newline-delimited JSON parsed
by SQLite json1 at the admission boundary. Bend-native LSP/DAP clients are set
aside for this feature.

Grounds:

1. The coordinator cannot frame one LSP/DAP response today (**demonstrated**,
   `PROBES/laws-research/readprobe`: two newline-free child writes merged into
   one read that returned only at child exit, 3.16 s wall). clangd,
   sourcekit-lsp and lldb-dap write Content-Length bodies with no trailing
   newline (backend report §4.4, **demonstrated** there).
2. No Bend JSON parser exists, and the house convention parses inbound JSON
   with json1 at the SQL boundary plus `Tx` walkers (**source**:
   `json/canonical.bend` encode-only, `json/uint-decoder.bend` unsigned
   integers only; `native-requests.bend:16-20,103-104`).
3. One-shot queries need zero new C host effects (**source**: `Process.run`
   is uncapped, length-prefixed argv, no shell; the `git/status.bend` staged
   pipeline is the template).
4. Retained engines reuse the keeper machinery that already holds harness
   children across coordinator restarts (**source**: `process-spawn.c:413-520,
   869-899, 1042-1115`); attempt exit closes outstanding requests (the
   `NativeRequests.closed` pattern). Nothing polls or wakes on its own.
5. Law-ability is honest under this split: laws bind coordinator-side pure
   parts; adapter correctness is a named host assumption covered by host
   tests (carrier honesty, `docs/bend2/laws-design-notes.md`, **source**).
6. Packaging follows the shipped pattern: adapter `.mjs` files inherit the
   existing Node floor 22.15 (**source**: `git-series.mjs:173`);
   `node:sqlite` is flagless at that floor since 22.13.0 (**vendor**: Node
   v22.15.0 `doc/api/cli.md` change note; cross-checked: the shipped
   `mcp-conductor.mjs` imports it unflagged).
7. Per-query startup cost falls only on engines that need warm state; those
   run retained once per attempt.

Candidate kernel gaps dispositioned under this architecture (each with the
condition that reopens it): the length-delimited read, a Bend JSON decoder, a
read-only `Sql.query` mode, and tree discovery beyond `Files.find_suffix` are
all adapter-side concerns in this design; **no coordinator kernel change is
required**. The length-delimited read returns only if Bend-native protocol
clients are revived, and then on both the direct (`process-spawn.c:1173-1185`)
and retained (`br_read_line`, `:531-570`) paths with a `host/laws.bend` law
over its framing arithmetic.

## 2. Lane decision 1: command/store/law design confirmed

The adopted command set is confirmed against the lane's evidence:

```text
baton2 DATABASE context-engines [--pretty]
baton2 DATABASE context-query QUERY_ID REQUEST_JSON
baton2 DATABASE context-query-file QUERY_ID PATH
baton2 DATABASE context-result QUERY_ID [--pretty]
```

- **Arity fit** (**source**: `commands.bend:348-424`): `context-engines` joins
  the 0-argument class (`:350-356`), its `--pretty` form the 1-argument class;
  `context-query` and `context-query-file` join the 2-argument class
  (`:364-365`); `context-result` the 1-argument class and its `--pretty` form
  the 2-argument class. No new arity class is needed.
- **Output conventions** (**demonstrated** on the installed binary by two
  independent lane players; findings `semantic-integration-cli-surface`):
  one JSON document on stdout at exit 0; usage/arity/unknown-verb failures
  and refusals on stderr at exit 2 (structured `{"error","condition","next"}`
  or one plain sentence); absent single-record lookup at exit 1; empty reads
  answer `[]` at exit 0. The new commands define unknown-identity handling
  uniformly (exit 1, absent record named), because existing commands were
  measured non-uniform (`inbox` on an unknown session answers `[]` at exit 0;
  `session` exits 1).
- **MCP parity** (**source**: `mcp-conductor.mjs:112-122,487-576`): the tools
  `baton2_context_engines`, `baton2_context_query`, `baton2_context_result`
  forward argv through `execFileSync` and return stdout verbatim;
  `test/mcp-contract.py` pins tool output equal to CLI output, so the same
  result model holds by construction. Schemas are `{type:'object',
  additionalProperties:false}`, all-string properties.
- **Briefing** (**source**: `receive.bend:27-44,205`; `main.bend:79-80`;
  `mcp-conductor.mjs:436-446`; `codex-conductor.mjs:73-105`;
  `omp-conductor.mjs:76-113`): one orientation block at each of the existing
  assembly points; `test/native-cli.py` gains the usage pins. The
  `dispatch-turn` path (`turn.bend:473`) delivers only the task file to Muse
  and Claude players, so on that path the Conductor's task file carries the
  same line; surface-format conventions arrive through semantic-controls'
  Orchestra-control specification.
- **Store design** (**demonstrated** by the laws researcher):
  `semantic_requests` follows the `native_requests` discipline — caller-
  supplied `QUERY_ID` identity with `ON CONFLICT(id) DO UPDATE SET id=CASE
  WHEN <coordinates match> THEN id ELSE NULL END`, so identical retry replays
  the stored row and conflicting reuse fails the transaction
  (`commands.bend:158-160`, `knowledge.bend:120-123` precedents). Table
  creation joins the transaction shell the way `knowledge.bend:34-36` adds its
  tables. Encoding constraints confirmed: one JSON text column per answer;
  SQLite packs columns with tab and rows with newline, and json1 escapes
  control characters inside JSON text, so a one-row one-column document is
  safe; SQL literals escape only the single quote; NUL is refused by
  `sqlite.c:74-76`, so adapter output containing NUL fails validation with
  the cause named; answers re-select the stored row. Affine consequence
  (**demonstrated**, `PROBES/laws-research/laws/dup*.bend.out`): result
  values are built by pure functions of `String`/`Bool`/`U32` arguments and
  replies are re-derived from the store, since `Type` values cannot be
  duplicated.
- **Admission publishes only on validated completion** (**source** +
  **demonstrated** gate behavior): the adapter run is a host effect outside
  the SQLite transaction; the result row is inserted by a transaction whose
  json1 admission predicates validate the adapter output. A failed adapter
  run, malformed JSON or NUL-containing output inserts no result row; the
  request row records `failed` with the observed cause. The laws pin this:
  `m19_failed_adapter_run_cannot_publish_a_result` and
  `m19_reply_is_the_row_the_transaction_stored` below.
- **Law set confirmed** (clause M-19; candidate set **demonstrated** compiling
  green on pinned Bend 2.0.25 with a mutation control failing and naming its
  law — `PROBES/laws-research/semantic-law-style.bend`,
  `semantic-law-mutated.bend`, `mutation-check.txt`): parse laws per command;
  declared dispatch; undeclared-method refusal; evidence-nonempty admission;
  no-fabrication pair (failed run cannot publish; verbatim-output composition
  binding); refusal-names-the-rule; empty-answer-names-its-rule; credential
  exclusion by construction (the automatic-environment builder selects exactly
  the declared field set; the spawn environment builder is an allowlist with
  no harness credential names); applicability is a pure function of (recorded
  snapshot, current inputs); catalog follows observation (12b analog); no
  ceiling (12a analog); identity laws (replay/conflict); the argv law over the
  adapter spawn builder (`host/laws.bend:10-32` shape); entry laws binding
  each `main.bend` arm. Each law carries one `laws-check.mjs` mutation entry.
  The new law module must be imported by `coordinator/laws.bend`: a law
  outside the entry import graph is not checked (**demonstrated**,
  `PROBES/laws-research/scratch-tree` probe).
- **Admission gate facts** (**demonstrated**): 578 laws in 18 modules checked
  at every entry compile (baseline 12.1 s); proof removal fails the build
  (`Error: 1 TODO found.`); a false law blocks C emission; an unreachable
  foreign def gets no `CID_` macro; the full `laws-check.mjs` run is 751
  entry compiles (~2.6 h at 12.7 s) and was exercised through its three
  decisive properties rather than run in full by the researcher.

## 3. Lane decision 2: request transport convention

Closed: **the validated request text travels in argv**; no scratch-file
transport is introduced.

- `Process.run` has no stdin parameter (**source**: `git/process.bend:12-14`),
  so the request rides argv through the existing byte-safe length-prefixed
  encoder (`Tx.enc_argv`, `git/text.bend:262-271`), which is law-covered
  (`host/laws.bend:10-32` shape) and shell-free.
- `context-query-file QUERY_ID PATH` is the agent-facing form for large or
  structured requests: the coordinator reads `PATH` with `Text.read`,
  validates the content through the same json1 admission, and passes the
  validated text to the adapter in argv. The adapter never reads the request
  file itself, so the admitted bytes are exactly the bytes the adapter
  receives (no validate-then-read race).
- If a host rejects an oversized argv (a host limit, not a design cutoff),
  the refusal names the condition; the retained-mode protocol (stdin frames
  via `control_write`) is the path for requests a host cannot carry in argv.
- Adapter stderr goes to a retained log file (the existing spawn pattern,
  `process.bend:3-4`); error answers name the condition and the log path and
  do not inline raw adapter output.

## 4. Lane decision 3: packaging and staging deltas, per added file

**Adapters** (new sources `bend2/adapters/context-*.mjs`, staged to
`libexec/baton2/`):

1. `package-native.py` `stage_adapters()` (`:236-243`): one `shutil.copyfile`
   per adapter file. No `chmod`: adapters are spawned as `node <path>`
   (the `mcp-conductor.mjs` launch convention), so no executable bit is
   required; only `bin/baton2` is chmodded today (`:355`).
2. `manifest.json` `files` entries are automatic: the payload walk records
   `bytes` and `sha256` for every staged file (`:362-363`), and the verifier
   rejects unmanifested members.
3. `manifest.source.files`: extend the `git ls-files` argument list
   (`:364-367`) with `bend2/adapters` so adapter sources carry provenance.
4. `notices/`: no new notice for first-party adapter files (they are Baton2
   project code under the root LICENSE, the existing `baton2-LICENSE`
   entry).
5. Shebang: adapters carry no `#!/usr/bin/env node` line, since they are
   never executed directly; this keeps the Node prerequisite exactly where
   it already is (the coordinator resolves `node` from `PATH`, the
   `control.bend:32-35` precedent).

**Vendored TypeScript 5.9.3** (only if the supported set includes TS/JS):

1. `package-native.py`: a pinned source constant for the npm tarball (URL plus
   sha512 integrity, the Bend tarball pattern `:19-20,122-152`); extraction
   into `libexec/baton2/vendor/typescript-5.9.3/`; member inventory with
   per-file hashes recorded under `manifest.build`.
2. `notices/typescript-5.9.3-LICENSE` from `LICENSE.txt` (Apache-2.0) and
   `notices/typescript-5.9.3-THIRD-PARTY-NOTICES` from
   `ThirdPartyNoticeText.txt`, both staged explicitly with pinned digests and
   `terms` records in `stage_notices` (`:246-281`), following the
   `bend_compiler_runtime_license` pattern. The automatic archive-member
   basename rule (`:140-142`) is not extended; explicit staging covers both
   files, including `ThirdPartyNoticeText.txt`, which the basename rule would
   not capture.
3. `notices/distribution.md`: one line per added notice file, in the existing
   sentence pattern — `typescript-5.9.3-LICENSE is the pinned TypeScript
   5.9.3 license from the verified npm tarball.` and
   `typescript-5.9.3-THIRD-PARTY-NOTICES retains the third-party notices from
   the verified TypeScript 5.9.3 npm tarball.`
4. `bend2/test/package-licenses.py`: validation of the two new terms records
   against source inventory and staged digests, since `check_project_terms`
   (`:284-296`) covers only root LICENSE/NOTICE.
5. `docs/bend2/native-artifacts.md`: the pin, license, scope and sizes
   (23.6 MB full / 12.9 MB API subset) recorded beside the Bend compiler
   entry.
6. Resolution rule: adapters construct their `require` from the bundled path
   relative to the coordinator executable; ancestor `node_modules` resolution
   is never used. Development checkouts use an explicit environment variable
   naming a TypeScript install; an unresolved dependency makes the engine
   absent and `context-engines` reports it.
7. Gate evidence: the vendored component's verification runs inside
   `check-native.sh` so its output lands in the existing parsed log
   (`:155-164`), or as a new `GATES` entry.

**External, declared engines** (clangd, lldb-dap, sourcekit-lsp, clang/
scan-build, sqlite3 CLI): no package change. `context-engines` probes at
query time and reports resolved path, version and missing prerequisites;
platform support is declared per engine.

**Node floor**: 22.15 or later, unchanged. `node:sqlite` is flagless since
22.13.0, so the schema adapter's `readOnly: true` open works at the floor
(**vendor**: Node v22.15.0 docs; **source** cross-check:
`mcp-conductor.mjs:67-68` imports it unflagged). TypeScript 5.9.3 declares
`node >= 14.17`, below the floor. CI note: `.github/workflows/bend2-native.yml`
pins `node-version: '22'`, which resolves to the newest 22.x and does not
exercise the floor.

## 5. Classification vocabulary and credential boundary alignment

The lane's drafts used `observed|static|checked` on facts and
`resolved|static-possibility|observed` on relations. The adopted vocabulary is
one four-value classification on both facts and relations: `observed`,
`static-possible`, `checked`, `declared` (converged with semantic-models).
The lane confirms this is expressible within the store encoding (one JSON
text column) and law-able as a codomain claim over a closed constructor set;
the `checked` verdict semantics (exactly one oracle verdict settles; two
contradictory verdicts emit nothing; zero verdicts is never agreement) are
carried as fact fields and enforced by admission predicates, not by laws,
because oracle behavior is a host assumption.

The credential boundary follows `98fbfe03` structurally: automatic
environment surfaces return only the enumerated value-safe kinds (dependency
names and versions, compiler options, tool versions and executable paths,
file presence, service availability booleans); dotenv-class files are
reported by path and key names only, with a fact constructor that has no
value field; explicit inspection admits single named variables and runtime
values through explicit subjects with the requesting session named; the
adapter spawn environment is an enumerated base plus declared additions,
visible in `context-engines`; adapter stderr goes to logs. No detector scans
values. This replaces the lane researcher's earlier `'[redacted]'` marker
draft, which predated `98fbfe03`.

## 6. Readiness

Demonstrated by this lane: admission gate mechanics (proof removal, mutation
naming, CID reachability, unimported-law invisibility); store encoding
constraints; affine behavior of the result model; the `read_line` framing
gap; CLI/MCP output, refusal and exit-code conventions on the installed
binary; briefing assembly points; packaging generator and installed archive
contents; a seven-law candidate set compiling green with a failing mutation
control.

Vendor-declared: Node 22.13.0 unflagging of `node:sqlite`; TypeScript
`node >= 14.17` engine declaration.

Unverified: compile verification of the full new Bend module set
(implementation phase; the researchers' worktrees carried no compiler — the
pinned 2.0.25 at the qualification toolchain path was used for lane probes);
the full `laws-check.mjs` run in one pass; end-to-end adapter runs against
real subjects; retained-mode semantic adapter behavior; packaged-install
readiness runs.

Laws-critic reconciliation (`.../reports/integration-laws-critic.md`, verified
by execution on pinned Bend 2.0.25): the critic independently confirmed the
admission path (a toy law module compiles clean through an unused import —
checking is transitive via the entry graph), both negative controls (false
law refused with computed expected/observed; proof removal refused with
`Error: 1 TODO found.`), and the affine double-use rule. Its qualifications
adopted into this consolidation:

- **A3, open:** "the store encoding preserves arbitrary JSON text" is not
  settled — the six `json/canonical.bend` laws are corpus-only (each pins one
  corpus value, not a quantified property). A design storing free-form result
  JSON owes a round-trip probe or a quantified law; the codec series below
  answers this by canonicalizing at the boundary instead.
- **A9, refuted as stated:** `check-native.sh` green depends on the `python3`
  resolution (3.9.6 login shell fails `smoke-native-artifact.py` and skips
  `git-series.mjs`; ≥ 3.11 all green). Any gate claim must name the
  interpreter.
- **A10, refuted:** not all 578 laws are operative coverage — six JSON laws
  are corpus-only and ten Git-reader laws are test-entry-only supplementary;
  M-10's application-wide cutoff clause is stated open. The operative map is
  the M-1..M-18 matrix in `coordinator/laws.bend`.
- **A11, refuted:** durability, crash windows, provider idempotency and
  process lifetime are host assumptions outside Bend terms; laws bound what
  coordinator code does with them. This matches the honesty note in §2.
- Additional probed host facts adopted: single stdout lines are uncapped
  (1,000,000 chars read whole; the child cannot block on stderr, an append
  0600 file); `wait` returns text (`exit 3`, `signal 9`, `unknown after
  keeper loss` — the third literal is load-bearing in `receive.bend`
  recovery logic); `Control.launch` captures nothing (output to append-only
  `<db>.dispatch-<hex(id)>.{stdout,stderr}`); spawn argv splits on every
  NUL, so NUL exclusion is an obligation of the argv builder upstream of
  `P.argv`.
- The critic's full `laws-check.mjs` run remains pending completeness
  evidence (`/tmp/laws-check-r2.log`, in progress at consolidation time; an
  earlier attempt is `/tmp/laws-check-critic.log`).

Codec-series supplements (laws researcher, peer reviews for semantic-synthesis
after this document's first draft; reports
`.../reports/integration-laws-research-codec-review.md`,
`.../reports/integration-laws-research-codec-composition-review.md`,
`.../reports/integration-laws-research-native-identity-review.md`,
`.../reports/integration-laws-research-migration-policy-review.md`). These
refine §3's transport decision and are recorded here as lane evidence:

- The pinned byte boundary is lossy (`io_str` decodes WHATWG UTF-8 with
  U+FFFD replacement; a bare `0xFF` and a literal U+FFFD become the same
  String), so request validation and canonicalization belong in a C boundary
  before `io_str`, with `json_tree` duplicate/NUL-key checks as secondary
  SQL-side checks. A raw NUL byte fails `json_valid`; an escaped `\u0000`
  decodes to NUL and is refused by a dedicated check in names and values.
- The canonical request identity reuses `json/canonical.bend`
  (`normalize`/`json_text`), measured round-tripping every supported request
  shape including astral strings; no Node canonical encoder. SQL-to-Bend
  transport is hex-encoded `json_tree` node fields plus two new pure
  functions (a WHATWG `utf8_decode` and a tree reconstruction). The module's
  separate `utf8` helper is defective for astral characters (measured
  `ff9880` against correct `f09f9880`) but is off the identity path
  (`json_text` never calls it).
- Request numerics use two profiles: U32 for `version`/`line`/`column`/
  `stopAt` (with a digit-length arm, since text comparison misorders), and a
  separate declaration profile admitting offsets to 2^53−1, because a U32
  rule there would be an arbitrary cutoff.
- The MCP gate is context-scoped: raw Buffer frames split on `0x0A`, a
  preliminary `JSON.parse` only to select context `tools/call`s, and the
  original raw frame to the native strict codec; a defective frame selecting
  a non-context tool is not validated, and no global raw gate is claimed.
- The migration authorizer's pragma deny-comparison is case-sensitive and
  bypassable (`PRAGMA JOURNAL_MODE=WAL` returns rc=0 where the lowercase form
  is denied); `temp_store_directory` is process-global. Smallest correction:
  `sqlite3_stricmp`; structurally stronger as an allowlist.
- `ProcessChild.prepare/start/state` do not exist at pin
  `08dd2053ee48b1608fdd54319e7e7dc6614125e6`; they are proposed in a
  document. No law may name them until they exist.
