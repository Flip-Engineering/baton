# #170 implementation contract — the workflow-spec DSL (wavefile), a line-oriented authoring surface over the closed #114 spec

Date: 2026-08-13. Status: contract for implementation, **v1** — ring-2 form (ground truths →
decisions → refusal vocabulary → red-first acceptance → open questions). Primary input: the brief
in this directory (`contract-170-brief.md`) and the operator ask it carries — *"a scripted-dynamic
workflow through the baton surface — a DSL or literally anything better than this one-off ad-hoc."*
Every citation below was re-verified this session against the working tree with `grep -an`/`sed -n`
(HEAD `7661b1f`). NUL discipline applied to `application.mjs` and `coordination-store.mjs` (both
carry NUL bytes; `grep -a` only). No wall-clock claims; no redesign of the interpreter's closed
spec — the DSL lowers TO it (`workflow-interpreter.mjs` `admitSpec`), it does not extend it.

**The contract in one sentence.** A new line-oriented authoring format — **wavefile** — whose
closed directive vocabulary mirrors the interpreter's closed field set exactly, whose compiler is a
pure function of the text, whose every refusal carries the `{line, field, expected}` triple (the
#160 law), and whose emitted JSON is byte-for-byte the object `admitSpec` accepts — so the DSL
text rides every existing surface (CLI/bus/MCP/facade) through ONE seam, `waves.compile`, while the
interpreter stays untouched.

---

## 1. GROUND TRUTHS (re-verified this session)

**G1 — The closed spec the DSL must cover TOTALLY is `admitSpec` + its helpers.** The interpreter's
closed shape is the union of `SPEC_FIELDS` (`workflow-interpreter.mjs:48`), `MEMBER_FIELDS` (`:49`),
`EXACT_FIELDS` (`:50`), and `STEERING_FIELDS` (`:51-54`), with the exact value shapes validated at
`admitSpec` (`:131-163`), `admitMember` (`:165-216`), `admitSteering` (`:218-289`), and
`admitHarvest` (`:291-327`):

- `schemaVersion` is a closed enum, exactly `1` (`:139`) — never authored.
- `idempotencyKey` matches `IDEMPOTENCY_PATTERN` `/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u` (`:46`, `:140-142`).
- `members` is a non-empty array ≤ `MAX_MEMBERS` 64 (`:40`, `:143-144`), roles unique (`:150-151`),
  role non-empty and never the reserved `work` (`:167-171`).
- member `exact` is the closed `{harness, model, effort}`, all three non-empty strings (`:177-184`);
  member `scope` is a non-empty array ≤ 64, unique entries, each a non-empty relative path in the
  path-scope class — no NUL, no absolute, no backslash, no `..` segment (`:186-195`) — and a bare
  directory (no glob magic, no dot in the basename) refuses with the `"<dir>/**"` corrective
  (`:196-203`, `GLOB_MAGIC` `:42`); member `objectiveRef` is required (presence/shape here;
  existence/containment/byte-bound at render, `:333-348`); member `report` is an optional non-empty
  path (`:209-212`).
- steering is the closed seven: `approveOnAdvertisedPlan` boolean, `claimOnStall` boolean,
  `nudgeOnCheckpoint {message}`, `messageOnSpawn {kind, body}` with `kind` ∈
  `{inform, query, steer, brief, result}` (`MESSAGE_KINDS` `:44`), `elevateWhenNotes {kinds, maxEntries}`
  with `kinds` ⊆ `{doubt, link, note, plan}` (`SCRATCHPAD_KINDS` `:45`) and `maxEntries` a positive
  integer, `answerDecisions {policy}` (question→`optionId|text|"defer"` map, `:260-271`), and
  `signalOnMembersDone {roles, message{kind, body}}` (`:272-287`).
- harvest is `{paths: []}`, each entry a string or `{path, mustContain?}` (`:291-316`), every path
  containment-checked at admission — lexical plus realpath symlink escape (`:318-327`).
- The idempotency-keyed wave-commit + driver policy are lane facts the surfaces already own: the
  application's `waves.run` port defaults the driver to the production cadence
  `PRODUCTION_WORKFLOW_DRIVER` (`application.mjs:113-119`, consumed at `:11645`) — the #153
  follow-on that fixed the dogfood wave the fast suite driver tore down.

**G2 — The four surfaces all terminate in ONE `waves.run` command port; the DSL needs one seam, not
four.** The CLI parses `baton waves run <specPath>` → `{command: 'waves.run', args: {specPath}}`
(`application-cli.mjs:1327-1332`). The web bus admits the direct-port transport `waves_run` →
`waves.run` with `ARG_FIELDS = {idempotencyKey, spec, specPath}` (`web-northbound.mjs:46`, `:60`).
MCP advertises `baton_waves_run` taking `{repoId, spec: {type:'object'}}` (`mcp-northbound.mjs:552-558`)
and dispatches `application.command('waves.run', {spec})` (`:1794-1802`). The application's
`command()` dispatches `waves.run` to `this.runWorkflow` (`application.mjs:12573`), whose load rule
is `const specOrPath = request.spec ?? request.specPath` (`:11636`) — an object passes straight to
the interpreter, a string is read+`JSON.parse`d INSIDE the interpreter (`workflow-interpreter.mjs:493-500`).
The embedded facade exposes `baton.waves` (`application-client.mjs:1553-1565`) and
`baton.recipes.runWorkflow(spec, invocation)` (`recipes.mjs:584`) → the interpreter's `runWorkflow`.
**Consequence:** today NO surface accepts non-JSON text; a DSL file handed to `waves run` reaches
the interpreter's `JSON.parse` and refuses `workflow_spec_invalid` "not valid JSON" — that refusal
is the red the DSL turns green.

**G3 — The interpreter refuses the exact JSON-pain classes the DSL exists to kill.** A `scope`
value passed as a STRING (the #153 comment — the refusal that cost three resident restarts) hits
`admitMember`'s `!Array.isArray(scope)` branch and throws `workflow_member_invalid` "scope must be a
non-empty bounded array" (`workflow-interpreter.mjs:186-187`); the same member must repeat
`exact`/`scope`/`objectiveRef`/`report` for every row; and the foundry spec repeats the identical
`scope: ["docs/reference/evidence/contract-foundry-2026-08-13/**"]` on all five members
(`contract-foundry-2026-08-13/workflow.json:12,25,38,51,64`). A line-oriented grammar makes the
array shape structural (a `scope` directive IS an array entry — there is no way to pass a scalar)
and collapses the five repeated scopes to one wave-level default.

**G4 — The route admission is the model/harness/effort authority; aliases exist but are closed and
named by the deployment adapter, never by the DSL.** The interpreter's `exact` fields are opaque
non-empty strings; the concrete route is resolved at `selectExactRouteCard`
(`application.mjs:1827-1842`) against each adapter card's `modelSelection`: `mode === 'exact'` with
`model` in `available`, `=== configuredDefault`, in `acceptedAliases`, or matching
`acceptedPrefixes`. Verified live: the deepseek deployment card admits the `deepseek-` prefix
(`application-deployment.mjs:788`), the claude adapter admits the `claude-` prefix PLUS the closed
aliases `['sonnet', 'opus', 'haiku']` (`claude-session.mjs:576-577`), and the mock card admits no
prefix/alias (`adapter.mjs:239`). So a model string like `flash` passes the DSL verbatim and either
matches a deployment card (via `available`/`acceptedAliases`/`acceptedPrefixes`) or refuses at the
route admission — the DSL must NOT own an alias table.

**G5 — The refusal-triple law the DSL must satisfy is #160, and the `workflow_*` code family is
already the closed, allowlisted family the surfaces preserve.** #160's contract
(`error-actionability-2026-08-13/error-actionability-contract.md` §3) names the closed
`workflow_*` family exactly as `workflow_spec_invalid`, `workflow_member_invalid`,
`workflow_steering_unknown`, `workflow_harvest_invalid`, `workflow_objective_ref_invalid`
(`workflow-interpreter.mjs:29-33`). MCP preserves them typed on the wire via the pre-TypeError
`workflow_*` prefix arm (`mcp-northbound.mjs:209-213`) and attaches the lane detail via `LANE_CRAFTED`
(`:1651-1652`). The web/bus side still destroys bare `workflow_*` TypeErrors at the TypeError-name
arm (`web-northbound.mjs:228-230`) — #160's R3 orders the pre-TypeError `workflow_*` arm as the
repair. The DSL contract inherits that dependency: its refusals reuse the same closed codes, so no
new allowlist entry is needed anywhere.

**G6 — The grammar-lane idiom is established.** `wave-grammar-red.test.mjs` is the suite shape for a
grammar lane: registry-row + derivation pins, CLI-parser pins (plural spelling, closed verb sets),
transport attach/harvest rows, authority rows, and `surface-conformance` green
(`impl/test/wave-grammar-red.test.mjs:184-245,551-571`). The doc-truth doctrine (#159) makes the
grammar's DOCUMENTED ⇄ PARSED ⇄ ADMITTED invariant the gate: the directive table, the compiler's
accepted set, and `admitSpec`'s closed fields must derive from one source
(`doc-truth-conformance-2026-08-13/doc-truth-conformance-contract.md` §D1). `waves.run`'s registry
row currently claims surfaces `['embedded','mcp','cli']` — no `web` (`application-semantics.mjs:1637-1647`)
— while the web admits `waves_run` (G2); the DSL's new rows must not repeat that ghost-row shape.

---

## 2. DECISIONS

### D1 — The grammar, closed and total (the `wavefile` format)

**One wavefile = one workflow spec.** The file is a sequence of directive lines. Blank lines are
skipped. The grammar is keyword-first and block-by-transition: each directive names exactly one
closed field or block opener, and a directive's placement resolves the two context-sensitive cases.

**Lexical rules.**

- **Line separator** — `\n`; a trailing `\r` is stripped (CRLF tolerated). A logical line is the
  result of the continuation rule below.
- **Comment** — a line whose first non-whitespace character is `#` is a comment and is skipped.
  Comments are full-line only. A `#` inside a double-quoted string is literal. There are no
  trailing comments: a `#` after a directive's arguments is a grammar refusal (`expected` = end of
  line), never a silent comment — the parse discipline (D2) refuses rather than guess.
- **Continuation** — a line whose last non-whitespace character is a backslash `\` NOT inside a
  double-quoted string joins with the next line: the `\` and the following newline become a single
  space. Continuation repeats until a line without a trailing `\`. A `\` inside a double-quoted
  string is the escape character, never a continuation. Continuation exists so long message bodies
  (`nudgeOnCheckpoint`, `messageOnSpawn`, `signalOnMembersDone`) can be written across lines; a
  continued string is joined before tokenization, so a refusal reports the LOGICAL line (the joined
  line) and the `line` leg is that logical line's number.
- **Token** — a maximal run of non-whitespace characters, OR a double-quoted string `"…"` with the
  escapes `\"`, `\\`, `\n`, `\t`, `\uXXXX`. An unterminated quote at end of logical line is a
  grammar refusal (`workflow_spec_invalid`, `field` = the directive, `expected` = `'"closing
  quote"'`). Tokens are passed to the directives verbatim (UTF-8 preserved; no case folding).

**Directive vocabulary (closed, 16 directives).** Every directive except the three block/transport
openers (`wave`, `member`, `harvest`) is spelled EXACTLY as the interpreter's field name it lowers
to — the "closed field vocabulary mirroring the interpreter's" is the mirror, not a paraphrase.

| Directive | Arity | Token shapes | Lowers to (closed semantics) |
|---|---|---|---|
| `wave <key>` | 1 | `<key>` — one token (may be quoted) | `idempotencyKey` (`IDEMPOTENCY_PATTERN`) |
| `member <role>` | 1 | `<role>` — one token (may be quoted) | open a member block; `role` must be non-empty, ≠ `work`, unique |
| `harness <value>` | 1 | one token (may be quoted) | current member `exact.harness` (non-empty string) |
| `model <value>` | 1 | one token (may be quoted) | current member `exact.model` (non-empty string) |
| `effort <value>` | 1 | one token (may be quoted) | current member `exact.effort` (non-empty string) |
| `scope <path>` | 1 | one token (may be quoted) | current member `scope` entry if a member is open, else the wave-level scope default |
| `objectiveRef <path>` | 1 | one token (may be quoted) | current member `objectiveRef` |
| `report <path>` | 1 | one token (may be quoted) | current member `report` (optional) |
| `approveOnAdvertisedPlan` | 0–1 | bare, or one of `true`/`false` | `steering.approveOnAdvertisedPlan` (bare = `true`) |
| `claimOnStall` | 0–1 | bare, or one of `true`/`false` | `steering.claimOnStall` (bare = `true`) |
| `nudgeOnCheckpoint "<message>"` | 1 | one string token | `steering.nudgeOnCheckpoint.message` |
| `messageOnSpawn <kind> "<body>"` | 2 | `<kind>` one token; `"<body>"` one string | `steering.messageOnSpawn {kind, body}`, `kind` ∈ `MESSAGE_KINDS` |
| `elevateWhenNotes <kinds> <maxEntries>` | 2 | `<kinds>` one comma-joined token; `<maxEntries>` one token | `steering.elevateWhenNotes {kinds[], maxEntries}` |
| `answerDecisions "<pattern>" "<value>"` | 2 | two string tokens | adds `steering.answerDecisions.policy[pattern] = value`; repeatable |
| `signalOnMembersDone <roles> <kind> "<message>"` | 3 | `<roles>` one comma-joined token; `<kind>` one token; `"<message>"` one string | `steering.signalOnMembersDone {roles[], message{kind, body}}` |
| `harvest <path> [mustContain "<text>"]` | 1–2 | `<path>` one token; optional `mustContain` keyword + one string | adds a `harvest.paths[]` entry; repeatable |

**Placement rules (the two context-sensitive cases, resolved positionally and honestly).**

- `scope` resolves to the **wave-level scope default** when no member block is open, and to the
  **current member's scope override** inside an open member block. Because the parser tracks the
  open member, the SAME directive means the same thing the operator sees: before the first `member`
  it sets the shared default; inside a member it overrides that member only. Wave-level `scope`
  directives MUST precede the first `member` directive; a `scope` after the first `member` applies
  to the open member (this is the documented rule, refused with the triple if a member is not open
  at end of file and a stray `scope` would otherwise be ambiguous — a `scope` after the LAST member
  with no open member is a wave-level default ONLY if it appears before the first `member`; anywhere
  else it is a grammar refusal `expected: 'member'`).
- `harness`/`model`/`effort`/`objectiveRef`/`report`/member-`scope` are member sub-fields: a line
  starting with any of them while NO member is open is a grammar refusal
  (`workflow_member_invalid`, `field` = the directive, `expected: 'member <role>'`).

**Block transition.** A directive line whose first token is `member`, `harvest`, any steering
directive, or `scope`-at-top-level closes the currently open member block. Member sub-fields are
exactly `harness`, `model`, `effort`, `scope`, `objectiveRef`, `report` — disjoint from the
top-level directive set except `scope`, which is the position-resolved case above. End of file
closes the open member.

**The lowering (exact).** `compileWavefile(text)` emits, for a valid file, exactly:

```json
{
  "schemaVersion": 1,
  "idempotencyKey": "<wave key>",
  "members": [
    {
      "role": "<role>",
      "exact": { "harness": "<harness>", "model": "<model>", "effort": "<effort>" },
      "scope": ["<member scope entries, in directive order>"],
      "objectiveRef": "<path>"
    }
  ],
  "steering": { /* present keys only, in the interpreter's closed shapes */ },
  "harvest": { "paths": [ { "path": "<path>" } ] }
}
```

- `schemaVersion` is always `1` — fixed, never authored.
- Every member emits `exact` with all three fields, `scope` (see D3), and `objectiveRef`; `report`
  is emitted only when the directive appears.
- Steering emits ONLY the keys whose directives appear (the interpreter's `admitSteering` keeps
  absent keys absent); no steering directives → `"steering": {}`.
- Harvest paths emit `{path}` for a bare `harvest` directive and `{path, mustContain}` for a
  `mustContain` form; no harvest directives → `"harvest": { "paths": [] }` — the interpreter's own
  default (`workflow-interpreter.mjs:146`).
- Object key order in the emitted IR is fixed (the listing above); the interpreter's canonical form
  sorts keys, so key order is presentation, never identity.

**Compile-side validation (the round-trip law).** `compileWavefile` performs admission-time
validation of everything the DSL can express, MIRRORING `admitSpec`'s rules so a compile-clean
wavefile never triggers a late interpreter refusal: `idempotencyKey` pattern, member ceiling 64,
role non-empty/≠`work`/unique, all three exact fields non-empty, scope array ≤ 64 with unique
entries in the path class plus the bare-directory `"<dir>/**"` corrective, `objectiveRef` present,
report non-empty when present, steering enums/shapes (kinds ∈ `MESSAGE_KINDS`, elevate kinds ⊆
`SCRATCHPAD_KINDS`, `maxEntries` positive safe integer, boolean args, policy values non-empty),
and harvest path class. The render-time checks (`objectiveRef` existence/containment/byte-bound,
the realpath harvest containment) stay at the interpreter — the compiler checks what is a pure
function of the text, and the interpreter stays the final authority (defense in depth).

**The round-trip pin.** `waves.compile` emits the precise object `admitSpec` accepts:
`assert.doesNotThrow(() => admitSpec(compileWavefile(text), repoRoot))` AND
`canonicalJson(admitSpec(compileWavefile(text), repoRoot)) === canonicalJson(compileWavefile(text))`.
The pin is green for every green pin in §4 and is a conformance leg (D4).

### D2 — The parse discipline

**The compiler is a pure function of the text.** `compileWavefile(text, options = {})` — where
`options.repoRoot` is optional and used ONLY for the path-class checks that need a realpath (the
harvest containment; a lexical-only pass runs without it) — performs no `eval`, no `Function`, no
dynamic `import`, and no file reads. The only file read in the DSL pipeline is the explicit
`specPath` load at the surface (G2). Importing the compiler module runs NOTHING (the interpreter's
W5 law made structural — no top-level await, no top-level wave start). The compiler module is
self-contained: no imports from the interpreter or any other lane module, so it cannot drag a
top-level side effect into the surface graph.

**Every refusal carries the #160 triple.** A refusal is thrown as
`Object.assign(new TypeError(message), { code, line, field, expected })`, where:

- `code` ∈ the closed refusal vocabulary (§3) — the interpreter's own `workflow_*` codes, so the
  existing MCP `workflow_*` prefix arm (`mcp-northbound.mjs:209-213`) and `LANE_CRAFTED` detail
  (`:1651-1652`) preserve it with no allowlist change, and #160 R3's web pre-TypeError arm is the
  single web-side dependency.
- `line` — the 1-based logical line number of the offending directive (post-continuation-join; the
  message also carries the original line's text when it does not leak a value — the #41
  sanitization law: NEVER the value, NEVER a secret; a quoted argument that IS the offender is
  replaced by its field name in the message).
- `field` — the directive name for grammar refusals; the field name (`scope`, `exact.harness`, …)
  or `member <role>` for member refusals.
- `expected` — the closed shape the parser wanted (e.g. `'member <role>'`, `'inform|query|steer|brief|result'`,
  `'"<pattern>" "<value>"'`, `'non-empty scope'`, `'"<dir>/**"'`).

No refusal ships without all three legs; a compile that reaches an internal invariant violation
throws `workflow_spec_invalid` with `expected: 'internal'` and `field` naming the directive — the
honest-absence case, never a bare untyped error.

**The sniffing rule (first-token, honest, never guessy).** When a surface receives a spec in text
form (a `specPath` file's content, or a `specDsl` string), the single discriminator is: strip
leading whitespace and blank lines; if the first non-whitespace character is `{`, the text is JSON
(the existing `JSON.parse` path); otherwise it is a wavefile (compile). The rule is total over both
grammars — a valid spec object must start with `{`, and a valid wavefile must start with `wave`,
`#` (comment), or blank lines — and it never guesses by file extension, by content heuristics, or by
the presence of any other token. A text starting with `[` is NOT `{`, so it compiles as a wavefile
and refuses at line 1 with `field: '<first token>'`, `expected: 'wave <key>'` — truthful, because
the workflow spec is an object, never an array.

### D3 — Defaults without magic

**Exactly ONE default, one level deep.** The wave-level `scope` default (directives before the
first `member`) is expanded by the compiler into every member that does not declare its own
`scope`. A member `scope` overrides the default for that member only. **No deeper inheritance:**
there is no per-member steering, no member-of-member nesting, no route default, no harvest default.
A member's scope is exactly its own array or a copy of the wave default array — never a merge.
Consequence: a wavefile with neither a wave default NOR a per-member `scope` on every member refuses
(`workflow_member_invalid`, `field: 'member <role>'`, `expected: 'non-empty scope'`), because the
closed spec requires a non-empty scope on every member (`workflow-interpreter.mjs:186-187`).

**Aliases are not a DSL feature.** `harness`/`model`/`effort` are opaque non-empty strings passed
verbatim to the emitted `exact` object. The route admission (`selectExactRouteCard`,
`application.mjs:1827-1842`) is the ONLY authority on whether a model/harness/effort triple is
realizable; aliases that exist there (`acceptedAliases`/`acceptedPrefixes` per adapter card, G4) are
closed and named by the deployment — the DSL has no alias table and expands nothing. A model value
like `flash` therefore either matches a deployment card's closed sets or refuses at the route
admission, exactly as it does for JSON-authored specs today. The DSL's job is to make the route
triple EASY to author, not to invent route vocabulary.

### D4 — The surfaces

**One seam, four surfaces.** The identical wavefile text is accepted on every surface because every
surface funnels text-form specs through ONE compile seam:

| Surface | DSL text entrance | Mechanism (all unchanged-admission after the seam) |
|---|---|---|
| **CLI** | `baton waves run <wavefile.dsl>` — the text lives in the file | `waves.run {specPath}` (existing parse, `application-cli.mjs:1327-1332`); the application's `runWorkflow` reads, sniffs, compiles, passes the IR object to the interpreter. New: `baton waves compile <specPath>` → prints the emitted IR JSON (the inspectable seam; new `compile` branch in the `waves` verb family, `application-cli.mjs:1323-1384`). |
| **Bus (web)** | `waves_run {specDsl: "<text>"}` or `waves_run {specPath: "wavefile.dsl"}` | `ARG_FIELDS` gains `specDsl` (`web-northbound.mjs:60`); `waves_run {specPath}` already admitted (`:46`); the application `runWorkflow` sniffs/compiles. New read-only transport `waves_compile {specDsl|specPath}` → `{spec}`. |
| **MCP** | `baton_waves_run {repoId, specDsl: "<text>"}` | inputSchema gains `specDsl: {type: 'string', minLength: 1}` alongside `spec` (`mcp-northbound.mjs:552-558`); dispatch passes `spec: args.spec ?? compileWavefile(args.specDsl)` (`:1794-1802`). New read-only tool `baton_waves_compile {specDsl}` → `{spec}`. The `workflow_*` MCP allowlist and `LANE_CRAFTED` detail already preserve the compiler's typed refusals (G5). |
| **Facade (embedded)** | `baton.waves.compile(text) → spec` then `baton.recipes.runWorkflow(spec)`; or `baton.recipes.runWorkflow("wavefile.dsl")` | `baton.waves.compile` is a new method on the `waves` accessor (`application-client.mjs:1553-1565`); `runWorkflow`'s recipes wrapper (`recipes.mjs:584`) sniffs string inputs (path → read → sniff; text → sniff) and compiles before calling the interpreter. |

In every row the interpreter receives ONLY the IR object — its `admitSpec` input stays the IR, its
string path stays JSON-only, and its module is byte-unchanged. The compile seam lives at the
surfaces (application `runWorkflow`, the recipes wrapper, `waves.compile`), never inside the
interpreter.

**Driver default.** The surfaces keep the shipped production cadence: `waves.run`'s application port
already defaults an omitted driver to `PRODUCTION_WORKFLOW_DRIVER` (`application.mjs:11645`) — the
DSL path must not override it, and a `waves.compile`-produced IR carries no driver field (the driver
is an invocation option, not a spec field).

**`waves.compile` as the inspectable seam.** `waves.compile` (CLI `baton waves compile`, MCP
`baton_waves_compile`, bus `waves_compile`, facade `baton.waves.compile`) is the single place the
operator reads the emitted IR. It is idempotent, read-only, and admission-free (it never starts a
wave). Its output is exactly what `waves run`/`runWorkflow` accepts — the round-trip pin in D1 is
the proof, and a suite row drives the seam end-to-end: compile the DSL → run the emitted IR → the
run is identical to running the DSL text directly.

**The generated-docs row (#159 doctrine).** The directive table in D1 becomes a generated block,
derived mechanically from ONE source: a `WAVEFILE_DIRECTIVES` registry inside the compiler module
(directive → arity → token shapes → IR field → closed enum). A `renderWavefileGrammar()` in
`render-surface-docs.mjs` renders that table into the reference docs; `checkSurfaceDocs()` gains the
wavefile block as a byte-stable committed block; and `runSurfaceConformanceMain`
(`surface-conformance.mjs:682-747`) gains a wavefile leg proving **documented ⇄ parsed ⇄ admitted**:
the rendered directive set ⊇ the compiler's accepted set ⊇ `admitSpec`'s closed fields, plus the
round-trip pin. The new `waves.compile` command row is registered in the semantic registry with the
correct surface set (`['embedded','mcp','cli','web']`) — it must not repeat the `waves.run`
ghost-row shape (G6).

---

## 3. REFUSAL VOCABULARY (closed)

The compiler emits EXACTLY the interpreter's closed admission-time `workflow_*` codes
(`workflow-interpreter.mjs:29-33`), each with the `{line, field, expected}` triple. The render-time
code `workflow_objective_ref_invalid` is NOT emitted by the compiler (objectiveRef existence/
containment/byte-bound stay at the interpreter's render). The vocabulary is therefore closed by the
interpreter's own constructors — no new code, no allowlist churn.

| Code | Fires on | `field` leg (examples) | `expected` leg (examples) |
|---|---|---|---|
| `workflow_spec_invalid` | grammar/structure: unknown directive, wrong arity, unterminated string, `wave` not first, bad `idempotencyKey`, stray member sub-field with no open member | the offending directive (`memberr`, `nudgOnCheckpoint`); `idempotencyKey` | `'wave <key>'`, `'<directive> <arity>'`, `'end of line'`, the `IDEMPOTENCY_PATTERN` |
| `workflow_member_invalid` | member shape: missing/empty `harness`/`model`/`effort`/`objectiveRef`, duplicate role, role `work`, empty role, bad scope path class, bare-directory scope, member scope missing with no wave default, scope after the last member | `member <role>`; `exact.harness`; `scope` | `'harness|model|effort'`, `'non-empty scope'`, `'"<dir>/**"'`, `'member <role>'` |
| `workflow_steering_unknown` | steering shape: kind ∉ `MESSAGE_KINDS`, elevate kinds ⊄ `SCRATCHPAD_KINDS`, non-boolean, non-positive `maxEntries`, policy value empty, bad `signalOnMembersDone` roles | the steering field (`messageOnSpawn.kind`, `elevateWhenNotes.kinds`, `answerDecisions.policy`) | `'inform|query|steer|brief|result'`, `'doubt|link|note|plan'`, `'true|false'`, `'positive integer'` |
| `workflow_harvest_invalid` | harvest shape: path-class escape (NUL/absolute/backslash/`..`), empty path, `mustContain` not a string | `harvest.paths[<n>]` | `'non-empty path in the repo path class'` |

Every code is preserved on the wire per #160: MCP typed via the `workflow_*` prefix arm
(`mcp-northbound.mjs:209-213`) with the triple in the `LANE_CRAFTED` detail (`:1651-1652`); web/bus
via the #160 R3 pre-TypeError `workflow_*` arm (today destroyed at `web-northbound.mjs:228-230`);
CLI via the existing code-forwarding (`application-cli.mjs:1947-1953`). Sanitization: the message
never quotes a refused argument value (the #41 law) — it names the field, the line, and the expected
shape.

---

## 4. RED-FIRST ACCEPTANCE PINS

The suite idiom is `wave-grammar-red.test.mjs` (G6): in-process fixtures, no live providers, red
rows that fail at a NAMED stage at HEAD and flip green on the implementation. Every DSL row is red at
HEAD at the stage `workflow_dsl_compile_missing` — the compiler module does not exist and a DSL text
handed to `waves run` reaches the interpreter's `JSON.parse` refusal. The acceptance gate is the
full matrix green, plus the two static pins.

**Green pins (behavioral — each asserts the emitted IR and its `admitSpec` acceptance).**

| Row | Assertion |
|---|---|
| P1 round-trip pin | `admitSpec(compileWavefile(text), repoRoot)` does not throw and `canonicalJson(admitSpec(...)) === canonicalJson(compileWavefile(text))` for the Appendix A wavefile AND for every green-pin wavefile below |
| P2 scope default | a wave-level `scope` is emitted into every member lacking an override; a member `scope` overrides ONLY that member (no cross-member bleed); the foundry wavefile (Appendix A) compiles to the exact `contract-foundry-2026-08-13/workflow.json` object |
| P3 no deeper inheritance | a member's emitted `scope` is exactly its own or a copy of the wave default — never a merge; no route/steering/harvest defaults exist |
| P4 total coverage | a generated totality row iterates `WAVEFILE_DIRECTIVES` × `admitSpec`'s closed fields and asserts every field is expressible (SPEC_FIELDS/MEMBER_FIELDS/EXACT_FIELDS/STEERING_FIELDS/harvest) |
| P5 sniffing | `waves run <dsl-file>` compiles and runs; `waves run <json-file>` JSON-parses and runs; both reach the same interpreter with the same IR |
| P6 surfaces parity | the identical Appendix A text is accepted on CLI (`baton waves run`), bus (`waves_run {specDsl}`), MCP (`baton_waves_run {specDsl}`), and facade (`baton.waves.compile` → `runWorkflow`) |
| P7 compile seam | `waves.compile(dslText)` output, re-fed to `runWorkflow`, produces the identical run receipt as running the DSL text directly |
| P8 generated-docs row | `renderWavefileGrammar()` renders the directive table; `node impl/scripts/surface-conformance.mjs` prints `surface-conformance: ok` (exit 0) |
| P9 #160 triple on MCP | a malformed wavefile driven through `baton_waves_run {specDsl}` surfaces the typed `workflow_*` code + `{line, field, expected}` detail (LANE_CRAFTED) |
| P10 #160 triple on web/bus | the same refusal surfaces typed on the web (the #160 R3 pre-TypeError `workflow_*` arm), not `invalid_command` |

**Red pins (refusal-shape — each asserts the triple).**

| Row | Refusal |
|---|---|
| R1 | unknown directive `memberr foo` → `workflow_spec_invalid {line, field: 'memberr', expected: '<closed directive list>'}` |
| R2 | a member missing `harness`/`model`/`effort`/`objectiveRef` → `workflow_member_invalid {line, field: 'member <role>', expected: 'harness|model|effort'}` |
| R3 | a member with no scope and no wave default → `workflow_member_invalid {line, field: 'member <role>', expected: 'non-empty scope'}` |
| R4 | duplicate role → `workflow_member_invalid {line, field: 'member <role>', expected: 'unique role'}` |
| R5 | `messageOnSpawn async "body"` (kind ∉ enum) → `workflow_steering_unknown {line, field: 'messageOnSpawn.kind', expected: 'inform|query|steer|brief|result'}` |
| R6 | `elevateWhenNotes doubt,secret 20` (kind ∉ scratchpad) → `workflow_steering_unknown {line, field: 'elevateWhenNotes.kinds', expected: 'doubt|link|note|plan'}` |
| R7 | `scope docs/reference/evidence/contract-foundry-2026-08-13` (bare directory) → `workflow_member_invalid {line, field: 'scope', expected: '"<dir>/**"'}` |
| R8 | `harvest /abs/path` (absolute path) → `workflow_harvest_invalid {line, field: 'harvest.paths[0]', expected: 'non-empty path in the repo path class'}` |
| R9 | `wave "bad key!"` (pattern violation) → `workflow_spec_invalid {line, field: 'idempotencyKey', expected: '<IDEMPOTENCY_PATTERN>'}` |
| R10 | HEAD red: `baton waves run <wavefile>` refuses `workflow_spec_invalid` "not valid JSON" today (the seam absent) — the row flips green on the seam |

**Static pins.**

- **S1** — `compileWavefile` performs no `eval`/`Function`/`import()` and no file reads: a source
  pin (grep -a) asserts the module body contains none of `eval(`, `new Function`, `import(`, and no
  `readFileSync`; the only file read in the DSL pipeline lives at the surface load.
- **S2** — the emitted IR carries no `driver` field and no `schemaVersion` other than `1`: a
  round-trip over every green-pin wavefile asserts `schemaVersion === 1` and `driver` absent.
- **S3** — the generated `WAVEFILE_DIRECTIVES` set equals the compiler's accepted-directive set and
  is a subset of the documented set (the #159 three-way invariant, in the conformance main).

---

## 5. OPEN QUESTIONS

**OQ1 — The compile seam home.** Should `waves.compile` land as a new direct-port command at
`application.mjs` (recommended: CLI/bus/MCP all already funnel through `command()`; one seam, one
authorization story) or as a CLI-only verb with the bus/MCP gaining their own tools? This contract
specifies the former — a `waves.compile` command port beside `waves.run` at `application.mjs:12560-12573`
with the same pre-gate dispatch — but the MCP tool name/schema (a `specDsl` field on the existing
tool vs. a new read-only tool) needs the MCP-packaging decision before implementation.

**OQ2 — Compile-side vs interpreter-side validation depth.** The compiler mirrors `admitSpec`'s
admission-time rules (so a compile-clean wavefile never draws a late interpreter refusal, and the
round-trip pin is strong), which duplicates validation logic between `workflow-dsl.mjs` and
`workflow-interpreter.mjs`. The alternative — compile emits structurally and lets `admitSpec` be the
only validator — weakens the `{line, field, expected}` promise (a member missing `harness` would
surface as a line-less `workflow_member_invalid` from the interpreter). This contract recommends the
mirror; the duplication is the price of the #160 triple, and the round-trip pin proves they never
diverge.

**OQ3 — Inline text on the CLI.** Today the CLI takes a spec PATH only (`baton waves run <path>`);
bus/MCP gain `specDsl` inline text. Should the CLI also accept inline text (e.g. `baton waves run
--dsl 'wave ...'`)? Recommend NO for v1 — the path form keeps the CLI consistent with every other
path-taking verb, and the `--dsl` flag adds a second CLI surface shape for marginal gain. The
operator's "scripted-dynamic workflow" ask is served by the file path + `waves.compile` (write the
wavefile, compile it, run it).

**OQ4 — The `mustContain` spelling.** The DSL uses the interpreter's exact field name `mustContain`
(`harvest <path> mustContain "<text>"`). A friendlier `contains` keyword is tempting but would break
the "closed field vocabulary mirroring the interpreter's" rule (D1) and the generated-docs
invariant. Confirm the mirror spelling is acceptable; a DSL-side alias is a named future extension.

**OQ5 — String token quoting.** Message bodies in real specs contain backticks, em-dashes, and
Unicode arrows (the foundry `messageOnSpawn` body). The grammar treats every non-whitespace run as a
token and double-quoted strings as single tokens with `\` escapes — so unquoted punctuation
(`→`, `` ` ``) inside a quoted string is literal. Confirm the escape set (`\" \\ \n \t \uXXXX`) is
sufficient for v1; arbitrary escape sequences are refused (`expected: 'valid escape'`) rather than
silently emitted.

**OQ6 — The `waves.run` registry surface set.** #159's G11 flagged that `waves.run` claims surfaces
`['embedded','mcp','cli']` while the web admits `waves_run` (`application-semantics.mjs:1637-1647`
vs `web-northbound.mjs:46`). The DSL contract's new `waves.compile` row must carry the CORRECT
surface set; whether fixing the `waves.run` row (adding `web`) rides this contract or the #159
doc-truth rung is a sequencing decision for the implementation.

---

## Appendix A — the foundry round-trip wavefile

The exact `contract-foundry-2026-08-13/workflow.json` expressed as a wavefile. This is the P2/P5/P6
fixture: it compiles to the precise `admitSpec`-accepted object, collapses the five repeated scopes
(G3) to one wave-level default, and is the operator-facing example the generated docs render.

```wavefile
# The contract-foundry wave (workflow.json -> wavefile)
wave contract-foundry-2026-08-13-wave-b

# Wave-level scope default: applies to every member without its own scope.
scope docs/reference/evidence/contract-foundry-2026-08-13/**

approveOnAdvertisedPlan
claimOnStall
nudgeOnCheckpoint "Continue your draft drive - read evidence, write your contract incrementally, publish to the shared scratchpad when complete."
messageOnSpawn brief "Read your objectiveRef brief IN FULL first, then foundry-brief.md in the same directory (the shared frame binds you). Publish your final draft to the shared scratchpad partition as well as your file. Authority-class ambiguity -> DECISION_REQUEST with options; judgment calls are yours - record them in open questions."
elevateWhenNotes doubt,plan 20
signalOnMembersDone coordinator result "All rows settled - read their drafts from the shared scratchpad partition and write foundry-qa.md per your brief."

member coordinator
  harness deepseek
  model deepseek-v4-pro[1m]
  effort high
  objectiveRef docs/reference/evidence/contract-foundry-2026-08-13/coordinator-brief.md
  report docs/reference/evidence/contract-foundry-2026-08-13/foundry-qa.md

member row-quiescence
  harness deepseek
  model deepseek-v4-flash
  effort high
  objectiveRef docs/reference/evidence/contract-foundry-2026-08-13/row-quiescence.md
  report docs/reference/evidence/contract-foundry-2026-08-13/contract-163.md

member row-launchval
  harness deepseek
  model deepseek-v4-flash
  effort high
  objectiveRef docs/reference/evidence/contract-foundry-2026-08-13/row-launchval.md
  report docs/reference/evidence/contract-foundry-2026-08-13/contract-165.md

member row-readiness
  harness deepseek
  model deepseek-v4-flash
  effort high
  objectiveRef docs/reference/evidence/contract-foundry-2026-08-13/row-readiness.md
  report docs/reference/evidence/contract-foundry-2026-08-13/contract-167.md

member row-telemetry
  harness deepseek
  model deepseek-v4-flash
  effort high
  objectiveRef docs/reference/evidence/contract-foundry-2026-08-13/row-telemetry.md
  report docs/reference/evidence/contract-foundry-2026-08-13/contract-146.md

harvest docs/reference/evidence/contract-foundry-2026-08-13/foundry-qa.md mustContain "FOUNDRY-QA v1"
harvest docs/reference/evidence/contract-foundry-2026-08-13/contract-163.md mustContain "#163"
harvest docs/reference/evidence/contract-foundry-2026-08-13/contract-165.md mustContain "#165"
harvest docs/reference/evidence/contract-foundry-2026-08-13/contract-167.md mustContain "#167"
harvest docs/reference/evidence/contract-foundry-2026-08-13/contract-146.md mustContain "#146"
```

The emitted IR for this wavefile is the `workflow.json` object verbatim: five members, each with
`exact: {harness, model, effort}` (the foundry's `deepseek` harness / `deepseek-v4-pro[1m]` or
`deepseek-v4-flash` model / `high` effort), each with `scope: ["docs/reference/evidence/
contract-foundry-2026-08-13/**"]` from the wave default, the six steering keys
(`approveOnAdvertisedPlan: true`, `claimOnStall: true`, `nudgeOnCheckpoint`, `messageOnSpawn` with
`kind: 'brief'`, `elevateWhenNotes {kinds: ['doubt','plan'], maxEntries: 20}`,
`signalOnMembersDone {roles: ['coordinator'], message: {kind: 'result', body}}`), and the five
`{path, mustContain}` harvest entries.
