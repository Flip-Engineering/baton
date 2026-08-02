# Blue-team verification: mcp-packaging red suite (test-blueteam)

**Scope:** adversarial verification of `impl/test/mcp-packaging-red.test.mjs` (15 rows, MP1–MP17
with gaps) against the MCP+packaging contract v1.0
(`docs/reference/evidence/mcp-packaging-2026-08-02/mcp-packaging-decisions.md`) and its two
red-team reports (`redteam-authority.md`, `redteam-lifecycle.md`). Read-only: no `impl/` files
were edited; the only write target is this report.

**Verdict meanings:**

- **SOUND** — a wrong implementation cannot pass the row; the row greens only on the contract's
  real semantics.
- **WEAK** — the row pins real behavior but a wrong implementation can pass it (named bypass), or
  a material leg of the titled property is unenforced.
- **VACUOUS** — the row's assertion cannot distinguish the contract property from its absence;
  it greens (or would green) without the property existing anywhere.
- **STAGED-WRONG** — the row as written cannot go green on a correct implementation (fixture or
  staging defect), or its title/comment promises a property its body never tests.

## 0. Suite-run ground truth (item 5)

Command run from the repo root (node v25.8.0, npm 11.11.0):

```text
node --test impl/test/mcp-packaging-red.test.mjs
→ tests 15, pass 0, fail 15, cancelled 0, skipped 0  (~174 ms)
```

**All-red confirmed; no row passes today for any reason.** The failure *modes* matter as much as
the count, because the suite header promises "every row fails for the named stage and goes green
on the contract's implementation ONLY". Two rows fail for reasons that are NOT their named stage:

| Row | Fails at | Failure mode | Named stage honest? |
|---|---|---|---|
| MP1 | `:116` `response.result.isError` | TypeError — unknown tool → protocolError -32602 (`mcp-northbound.mjs:1005`), `result` undefined | yes (tool missing) |
| MP2 | `:132` same TypeError | same | yes (tool missing) |
| MP3 | `:152` same TypeError | same | yes (tool missing) |
| MP5 | `:174` same TypeError | **baton_decision_answer EXISTS but is a reflex tool, absent from the `application` surface** (`mcp-northbound.mjs:512,901`) | **no — fails on surface placement, not "tools missing"** |
| MP6 | `:200` attach assertion | **`invalid_run_command` — the fixture's `waveId: 'wave:abc'` violates the real `waves.attach` grammar `/^wave:[a-f0-9]{32}$/`** (`application.mjs` cmd-def table ~`:181`, validator ~`:1806-1816`, invoked at `mcp-northbound.mjs:692`) — the row dies BEFORE reaching the missing `waves.send` | **no — fixture grammar bug, unpassable as written (§MP6)** |
| MP7 | `:221` advertisement | four settlement tools not in `tools/list` | yes (tools missing) |
| MP8 | `:255` TypeError | unknown tool (as MP1) | yes (tool missing) — but see §MP8: the row is vacuous even once green |
| MP9 | `:266` TypeError | unknown tool | yes (tools missing) |
| MP10 | `:286` TypeError | unknown tool | yes (tool missing) |
| MP11 | `:311` | `../src/mcp-descriptor.mjs` does not exist; import catch yields `{}` → `typeof loadMcpDescriptor !== 'function'` | yes (parser missing) |
| MP12 | `:326` | same missing module → `assert.fail` | yes (parser missing) — but see §MP12: vacuous once green |
| MP14 | `:341` | `impl/package.json` has no `files` field | yes (manifest work missing) |
| MP15 | `:357` | doctor not advertised | yes as far as its BODY goes — but the body is not the titled pack smoke (§MP15) |
| MP16 | `:365` | `index.mjs:24-27` carries 4 eager `import … atlas-…` lines (`4 !== 0`) | yes (lazy natives missing) |
| MP17 | `:375` | `impl/MCP.md` contains zero ` ```json ` fenced blocks | yes (example missing) |

Two further staging notes:

- **The suite ships 15 rows; the header says "Eighteen rows".** MP4, MP13, MP18 never landed.
  The gaps are not random: MP4 is plausibly `waves.stop` (no row anywhere), MP13 plausibly the
  codex-#4 env-secret redaction row (no row anywhere), MP18 the E2E acceptance driver (§4). All
  three are contract-mandatory properties with zero coverage.
- **The row numbering is not the only count problem:** `waves.stop` appears in no test title,
  body, or assertion in the suite (grep-confirmed). The contract lists `waves.send`/`waves.stop`
  as a pair; half the pair is unpinned.

## 1. Per-row verdicts

### MP1 — waves.start registers, debits quota PER MEMBER, detached shape — **WEAK**

What the row proves once green: the tool exists on the surface, dispatches exactly once to
`application.command('waves.start')`, the server calls `takeToolQuota` exactly twice for a
2-member call with `debit.tool === 'baton_waves_start'`, and the application's payload
(`waveId`, member `runId`s) is relayed verbatim.

False-green channels, in the order the task asked about them:

- **Per-member vs double-debit is indistinguishable.** The row uses exactly 2 members and
  expects exactly 2 debits. A wrapper that debits twice for ANY `waves.start` call — or a
  per-call wrapper that just invokes `takeToolQuota` twice — passes. Only a second call shape
  (1 member → 1 debit; 3 members → 3 debits) distinguishes per-member from constant-two. That
  case is absent.
- **Debit↔dispatch ordering unpinned:** `debits` and `commandCalls` are separate arrays; a
  post-hoc debit (after the fan-out, the exact amplification codex #1 attacks) passes.
- **The wave-quota class is unpinned.** The contract names `{wavesPerWindow, membersPerWindow}`
  on the host's `takeToolQuota`; the debit shape the server emits today is
  `{userId, sessionId, tool, repoId}` (`mcp-northbound.mjs:1090`) and the row asserts only
  `.tool` and the count. An implementation that never adds the class greens the row.
- **Profile admission is not exercised here** (mock grants everything) — that leg lives in MP2,
  which is STAGED-WRONG (below), so effectively the "profile + quota" compound claim of
  MCP-W1's first bullet has no working row.
- The detached-shape legs (runIds, no live handles) are honest pass-through assertions, but
  they prove relay, not semantics: the mock hands the server a detached shape and the row
  confirms it comes back. `idempotencyKey` retry-dedup (glm amendment 1-C) and atomic
  reservation (codex amendment 3) have no assertions anywhere.

### MP2 — off-profile route refused at admission — **STAGED-WRONG**

The row cannot go green on ANY implementation with this fixture, and can only be forced green by
a wrong one:

- The fixture injects **no deployment profile into the server**. `McpFleetServer`'s constructor
  takes no profile/routes option (`mcp-northbound.mjs:846-928`); advertised schemas are
  deliberately deployment-independent (`mcp-northbound.mjs:903-907` comment), so
  `validateArguments` cannot refuse `harness: 'not-a-harness'`; and the mock application's
  `command()` returns success for every command, so dispatch cannot refuse either. There is no
  code path from fixture to refusal.
- The contract's enforcement point — `BatonApplication._resolveIntent()` /
  `start()` (`application.mjs:2969-3008`, `:4300-4314`) — lives INSIDE the application the mock
  replaces. Even a perfect real implementation is invisible to this row.
- The only implementations that green MP2 with this fixture are wrong ones: a hardcoded
  server-side allowlist (`{mock/model-a/low}` happens to be MP1's route) passes MP1 AND MP2
  without any deployment profile existing. That is precisely the false green the row exists to
  prevent.
- **Minimal repair:** `setup()` must inject the profile (a `deploymentProfile`/`routes` server
  option, or a descriptor-derived profile), with one on-profile member admitted (MP1) and one
  off-profile member refused (MP2) against the SAME object; plus an E2E leg that exercises the
  real `_resolveIntent` path (§4).

### MP3 — waves.progress paginates with cursors, never exceeds frame — **WEAK**

- **Cursor freshness is unproven.** The mock returns `{cursor: 7, nextCursor: 8}` and the row
  asserts the shape (`≤16` members, safe-integer-or-null `nextCursor`). It never issues a second
  read with `cursor: 8`, never checks that a repeated read is freshness-provable against the
  `run.follow` cursor chain, and never checks that a stale cursor is distinguishable from a
  fresh one. A static `nextCursor: 8` passes. The contract's "never hallucinated-as-fresh"
  (glm #1) has no assertion.
- **"Never exceeds the frame" is untested.** All 16 fixture members are tiny; nothing approaches
  `maxMessageBytes` (256 KiB in the fixture), no member carries an oversized projection, and no
  assertion references the response byte size. The lifecycle report's actual hole — 7 MiB
  internal progress ceiling vs transport frame (`wave.mjs:21` vs `mcp-northbound.mjs:1469-1471`)
  — cannot be reached by this row.
- **No second page:** a 17-member wave producing 16+1 with a working cursor chain is the
  minimal honest case; it is absent.
- Latent staging hazard: the call passes `waveId: 'wave:abc'`; the real waveId grammar is
  `/^wave:[a-f0-9]{32}$/` (proven at `waves.attach`'s validator). If the implementer validates
  `waves.progress`'s waveId consistently, the row goes red at admission — the suite currently
  steers toward NOT validating, the opposite of its job.

### MP5 — decision.answer repo coordinate + already_resolved — **WEAK**

- **The repo-coordinate check is fixture theater.** The mock application itself throws
  `application_interaction_not_found` for `requestId: 'foreign-request'`; the row greens on ANY
  server that advertises `baton_decision_answer` on the `application` surface and relays the
  mapped error (`mcp-northbound.mjs:165` maps the code → `not_found` text). The CONFIRMED-HOLE
  the contract amends (codex #2: `application.mjs:11907-11922`'s `answer()` checks no repo
  coordinate) is never exercised — the suite can go fully green with the hole open in the real
  application.
- **No existence-leak control.** The contract demands a cross-repo requestId refuse
  IDENTICALLY to an unknown one. The row never sends an unknown requestId, so a server/app
  pair that leaks existence (different codes for foreign vs unknown) passes.
- **already_resolved leg is loose but real:** `/already_resolved/` on the result text does pin
  the distinct typed outcome reaching the wire; `resolvedBy` is matched only as part of the
  free-text body (no field assertion), and glm #3's actual hazard — a late answerer re-spawning
  work — is unobservable here.
- **Staging note (from §0):** the row is red today on surface placement
  (`baton_decision_answer` is a reflex tool excluded from the `application` surface), which puts
  it in direct conflict with the standing reflex-suite invariant — see §5.

### MP6 — attach returns runIds that accept waves.send (resume-steer) + harvestReplayed — **STAGED-WRONG**

Two independent defects, either sufficient for the verdict:

- **Unpassable as written (proven).** The fixture's `waveId: 'wave:abc'` fails the REAL
  `waves.attach` command grammar `/^wave:[a-f0-9]{32}$/u` (validator at `application.mjs`
  ~`:1806-1816`, invoked pre-dispatch at `mcp-northbound.mjs:688-694`). The row fails at the
  attach step with `invalid_run_command` TODAY, and will still fail there after the full v1.0
  implementation lands — the grammar predates the epic and consistency demands the new tools
  keep it. Fix is one line (`'wave:' + 'a'.repeat(32)`), but as written the row can never green.
- **Title/body mismatch on the core claim.** "Returns runIds that accept waves.send": the
  attach mock returns `{outcomes, waveDriverDetached, harvestReplayed}` — NO runIds — and the
  `waves.send` call targets a hardcoded `'run-a'` supplied by the test author, not derived from
  the attach payload. The attach→steer linkage that IS the resume path (glm #2) is never
  exercised.

Additional weaknesses even after the waveId fix:

- The send assertion accepts `waves.send` OR `run.send` OR `run.steer` and never asserts
  `args.runId === 'run-a'` — the task's question ("does the row prove waves.send reaches the
  MEMBER, or just that SOME send command was called?") answers itself: SOME send-ish command,
  to any run or none, greens the row.
- **harvestReplayed is tested only in the false case**, as pure pass-through. The contract's
  amendment (glm #4) is the TRUE case — re-attach after the detached record settled — which is
  never exercised; the flag's computation (in the wave/store layer) is entirely mocked.
- No wave-membership binding check: a `waves.send` to a runId that is NOT a member of the
  attached wave is never refused (the wave-vs-run steering degradation the lifecycle report
  names at §1b).
- resultSha-keyed harvest accounting (the contract's caller-side double-count rule) is unpinned.

### MP7 — four settlement tools register; promote requires the envelope — **WEAK**

- **No positive case.** The row asserts (a) advertisement and (b) refusal without
  `sessionAuthority`. An implementation that ALWAYS refuses `knowledge.promote` — with or
  without an envelope — greens both halves. The contract's positive property (a valid envelope
  bound to a real settlement lease admits, exactly as admitBoardCommand does) has no row
  anywhere in the suite.
- **Advertisement check is substring-based** (`JSON.stringify(list.result).includes(tool)`) —
  a tool NAME appearing in another tool's description would satisfy it; and advertisement says
  nothing about dispatch to the four store ops.
- **Surface trap (blocking-adjacent).** The row runs on `surface: 'application'`, whose
  `tools/list` is `ORDINARY_APPLICATION_TOOL_DEFINITIONS` only (`mcp-northbound.mjs:901`). The
  contract's KS9 amendment as written — "the four rows gain `mcp` in `surfaces` … reflex table
  re-derived" — lands the tools in `MATRIX_REFLEX_TOOL_DEFINITIONS`, which ship only on the
  COMBINED surface (`mcp-northbound.mjs:543-571`). A contract-conformant minimal KS9 edit keeps
  MP7 red; greening it requires an ordinary-surface composition change the contract text does
  not state, and that change breaks a standing green assertion in the reflex suite (§5).
- **Schema-derivation tension the suite resolves silently:** the reflex table HIDES
  `sessionAuthority` from wire schemas (`mcp-northbound.mjs:544`), while v1.0 (codex #2a) has
  MCP callers PRESENT the envelope. MP7/MP8 pass `sessionAuthority` in call args, so greening
  them forces an amendment to the S-3 hiding rule for these rows — a real design decision
  (board tools get the envelope host-injected instead, `_boardAuthorityContext`
  `mcp-northbound.mjs:1503-1507`) that the contract phrases ambiguously ("callers present" vs
  "validated exactly as admitBoardCommand does", whose MCP path never takes caller envelopes).
  The suite picks a side without saying so.

### MP8 — replayed admission with foreign session refuses session code — **VACUOUS**

The task's question — "does the mock-based assertion prove anything about the real gate order?"
— has a clean answer: no, twice over.

- **The replay path is never reached.** The row performs ONE `knowledge.promote` call with a
  forged envelope. There is no prior admitted call under idempotency key `mp8-forged`, so no
  `_byKey` replay record exists; session-first and replay-first orderings are observationally
  identical. The row cannot distinguish the contract's amended check order (codex #2b) from the
  unamended one it attacks.
- **The session check is never reached either.** The forged envelope rides lease
  `{id: 'x', digest: '0'.repeat(64)}` — no such lease exists in the fresh store, so the refusal
  is `run_orchestrator_lease_not_found` at lease lookup, BEFORE any session-coordinate
  comparison. The row's own regex (`/session_mismatch|lease_not_found|lease_invalid/`) accepts
  that refusal via the `lease_not_found` alternative. Green proves: "promote with an unknown
  lease is refused" — a property that needs neither the session gate nor the reordering.
- **The comment's appeal to sibling coverage is false.** The row states "the store-level order
  property is pinned by the suite's KS2 sibling rows." It is not. The KS2 rows
  (`impl/test/kg-settlement-red.test.mjs:204-257`) pin every `_activeRunOrchestratorLease`
  refusal code ON FRESH KEYS (each case uses a distinct `knowledge.workflow_admitted:*`
  idempotency key); the only replay assertions in that suite (`:191`, `:263`, `:334`) are
  same-session. No row anywhere in the repo replays an admitted settlement key with a foreign
  session and asserts the session code instead of the replayed outcome (grep-confirmed across
  `impl/test/`).
- The orphaned real `CoordinationStore` at `:235-238` (constructed, `void`ed, then a SECOND
  store is built on the same directory inside `setup()`) is dead code that gestures at a
  store-level property the row never touches.
- **Minimal repair (store level, where the property lives):** mint a real lease; admit key K
  with the acquiring session; replay K with a foreign/expired session; assert
  `run_orchestrator_session_mismatch` (not the replayed outcome) and unchanged event count;
  then a same-session replay control returning the prior outcome. Plus an MCP-level row with a
  really minted lease so the refusal has to traverse the session comparison, not the
  lease-lookup miss.

### MP9 — settlement_lease requires the settlement capability — **WEAK**

- **One-sided.** Refusal without the capability is pinned; the positive case (principal WITH
  `settlement` → lease minted, derived from the host's fixed principal — codex #3) has no row.
  An always-refuse implementation passes.
- **`/forbidden/` cannot identify its gate.** `_authority` returns `forbidden` for capability
  failure AND for repoId mismatch AND missing-capability-array alike (`mcp-northbound.mjs:961-964`);
  the row cannot distinguish the capability gate from any other admission refusal.
- Same surface trap as MP7 (the tool must exist on the `application` surface).

### MP10 — doctor quota-free, fresh per call, zero secret material — **WEAK**

- **Freshness leg: half-real.** `Object.defineProperty(server, 'doctorReadiness', …)` replaces
  the freshness source on the instance. That DOES catch the failure mode the contract names at
  the SERVER layer — an open-time-cached tool response fails the `blocked` mutation probe — but
  the REAL `doctorReadiness` path (per-call workspace/credential probes at
  `application-deployment.mjs:1254-1263`, construction-pinned routes per glm 6-A) is replaced
  by the override. An implementation whose real `doctorReadiness` returns an open-time snapshot
  greens the row. The override also pins one implementation tactic (a server-own method named
  exactly `doctorReadiness`): a contract-conformant dispatch that calls
  `application.doctorReadiness()` directly goes red — a false-red channel.
- **Quota-free leg: sound within the suite.** The debit filter is on
  `debit.tool === 'baton_deployment_doctor'`; the debit object is server-minted with
  `tool: params.name` (`mcp-northbound.mjs:1090`), so the label is stable. A debit-nothing
  implementation greens MP10 but reds MP1 — the suite is internally consistent here. (A debit
  emitted under a renamed label would evade the filter, but that requires deliberate
  mislabeling.)
- **Zero-secret leg: VACUOUS.** No canary secret is injected anywhere; the readiness fixture
  contains no secret-shaped values, so any pass-through — including one that would leak real
  credential material in production — satisfies the assertion. And the regex
  `/sk-[a-z0-9]|token|secret/i` is blunt in the other direction: honest credential METADATA the
  contract REQUIRES ("source kind, expiry class") fails the row if it happens to contain the
  substring `token` (e.g. an expiry class named `token_expiry`) — a false-red on the contract's
  own mandated output. Minimal repair: seed a canary value (`CANARY-SECRET-…`) into the
  fixture's credential posture, assert its absence, and drop the word-level regex.

### MP11 — descriptor closed shape + containment-checked credential refs — **WEAK**

The skeleton is the right shape (parse a good descriptor, refuse an unknown field NAMING the
field, refuse a `../` escape), but the task's specific question — is the symlink case covered?
— answers no, and it is not alone:

- **Symlink-out is NOT covered.** Only the lexical `../outside.json` escape is tested. The
  contract says "must resolve inside the repo root, no symlinks out", and codex's amendment
  names the full pattern (symlink ancestors, symlink files, no-follow opens —
  `credential-projection.mjs:106-140`). A `resolve(repo, ref)`-only implementation — exactly
  the naive one codex warns does not inherit those defenses — greens the row while remaining
  symlink-vulnerable. Minimal repair: create `outside.json` beside the repo dir, symlink
  `link.json → ../outside.json` inside it, assert refusal.
- **Error-text honesty is half-pinned.** "Name the field" is asserted (`/surprise/`); "never
  the value" is not — a parser echoing offending values into the error greens the row.
- **The containment regex is loose:** `/containment|outside|repo/` matches `repo` in almost any
  descriptor error text, so a refusal for the WRONG reason (e.g. "repo unreadable") passes.
- **Unpinned contract legs:** absolute-path refs, nested unknown keys (recursive closedness),
  `deploymentRoot` outside the repo, env-ref and keychain-ref validation, and the
  credential-content path (the good descriptor's `glm_key.json` is written but its CONTENT is
  never asserted to flow anywhere or be redacted).
- The row pins a SYNCHRONOUS `loadMcpDescriptor(path)` — a reasonable design pin, but it is a
  pin: an async loader fails `assert.throws` vacuously (a rejected promise is not a throw).

### MP12 — descriptor pinned at open — **VACUOUS**

The row parses `d.json`, rewrites the file, and asserts the previously returned object is
unchanged. That is a property of EVERY pure function — no server is started, no re-read path
exists to catch, and the contract's actual property ("read once at STARTUP and immutable for
the SERVER'S LIFE; edits require a restart, stated in the parse error text and MCP.md") is
untouched. A server that re-reads the descriptor on every tool call greens this row as long as
its parse function is pure. The `Object.isFrozen` disjunct pins an implementation tactic that
is neither necessary nor sufficient for pin-at-open (a frozen parse result on a re-reading
server passes; an unfrozen result on a correctly pinned server fails). Minimal repair: boot a
real `McpFleetServer` (or the stdio bin) from a descriptor, rewrite the file, assert the
server's advertised surface/routes are unchanged — and assert the restart requirement appears
in MCP.md (which also feeds MP17).

### MP14 — files/exports/pack-list pin — **WEAK**

- **The parse is correct for the installed npm.** Verified by execution: npm 11.11.0's
  `pack --dry-run --json` emits `[{ id, name, …, files: [{path, size, mode}, …] }]` — the row's
  `JSON.parse(packed)[0]?.files?.map(e => e.path)` reads it correctly. (Shape is stable since
  npm 7; no issue on the gate's node ≥ 20 floor.)
- **The exclusion assertions are vacuous-by-geography.** The credential files the contract
  worries about (`glm_key.json`, `deepseek_key.json`) live at the REPO ROOT, outside the `impl/`
  package root — no pack from `impl/` can ever contain them. Measured today: 400 packed files,
  275 under `test/`, `demo.mjs` present, and ZERO hits for any of the row's four banned regexes.
  The bans can never bite; codex's amendment demanded canary files SEEDED at the package root
  (and the repo parent) so a package-root move turns the test red — the suite seeds nothing.
- **No positive-shape pin.** Nothing asserts the pack contains ONLY the allowlist classes
  (src, scripts, MCP.md/CLI.md): a manifest with `"files": ["src","scripts","MCP.md","CLI.md",
  "test","demo.mjs"]` greens the row while shipping the 275-file test tree the contract's
  allowlist exists to exclude.
- The `exports` assertion is existence-only (`assert.ok(manifest.exports)`) — the
  `baton/impl` package-identity mapping the contract names is unpinned; so is the node engines
  floor (no row).

### MP15 — packed-install descriptor smoke — **STAGED-WRONG**

The title and comment promise the contract's PKG-2 gate row ("npm pack → install into tmpdir →
run the packed baton-mcp with a fixture descriptor → the MCP handshake + a tools/list answer.
Marked slow; the canonical gate runs it."). The body does none of it: it builds the in-process
fixture server, initializes, and asserts `tools/list` contains `baton_deployment_doctor` — an
in-process advertisement check that greens the moment the doctor tool registers, with zero
packaging work done. There is no skip/slow tagging mechanism in the suite (it runs in 0.5 ms);
"the canonical gate runs it" is a comment, not a mechanism. This is the suite's most dangerous
row: it will silently retire the contract's only clean-host proof (pack → install → descriptor
smoke + tarball byte pin) while looking like coverage. Either the row does the real pack dance
(genuinely slow, genuinely gated) or it must be renamed to what it is — a duplicate
advertisement assertion.

### MP16 — lazy natives pin — **WEAK**

- **Shallow source-scan, transitive eagerness unpinned.** The row greps `mcp-stdio.mjs` for the
  literals `atlas|ast-grep` and filters `index.mjs` lines matching `/^import .*atlas/`. The real
  property — "a clean host without the native toolchain can import the bin and degrade to
  `atlas: unavailable`" — is TRANSITIVE: `index.mjs` importing `./atlas-loader.mjs` which
  imports `@ast-grep/napi` defeats the scan while breaking the install exactly as before.
  Case-sensitivity (`Atlas` vs `atlas`), `export … from` re-exports, and top-level
  `await import()` are all unscoped.
- **The honest pin is an execution, not a scan:** spawn `node -e "await import('./scripts/mcp-stdio.mjs')"`
  (or the descriptor bin) with the native package hidden, and assert clean startup plus the
  registry's typed `atlas: unavailable` posture. The degrade-honestly half of the contract
  (codex #6's second sentence) has no row at all.
- The other bins (`mcp-web.mjs`, `baton.mjs`) are unscanned — both reach `index.mjs` today, so
  the risk is drift, not current breakage.
- False-red note: the `/atlas|ast-grep/.test(stdio)` check matches COMMENTS — an explanatory
  comment naming the lazy-loaded package fails the row.

### MP17 — MCP.md quickstart descriptor parses and validates — **WEAK**

- **The regex matches any routes-bearing JSON block, not the descriptor.** The pattern
  `` /```json\s*(\{[\s\S]*?"routes"[\s\S]*?)\s*```/u `` accepts the FIRST fenced json block
  containing the string `"routes"` anywhere in MCP.md — a routing table, an error example, a
  non-descriptor snippet all satisfy it. The task's question ("does it match the intended
  block or any routes block?") answers: any block.
- **It never validates against the closed schema** (the title's claim). `loadMcpDescriptor` is
  never imported, never called on the example; the row checks three keys exist and `routes` is
  a non-empty array. A schema-invalid quickstart (unknown fields, bogus `credential.kind`,
  secret material inline) greens the row — the exact failure the contract's "executable truth"
  acceptance forbids.
- **Executable truth is untestable at this tier anyway:** the acceptance bullet requires the
  E2E driver to follow the quickstart VERBATIM — that is the §4 row consuming this exact fenced
  block, not a shape check.

## 2. Coverage ledger against the v1.0 decision points

Every normative decision point of the v1.0 fold, mapped to its row(s). **NONE** = no row;
**PARTIAL** = a row exists but a named leg is unenforced (see §1); **ECHO** = the row's
enforcement is supplied by the fixture, not the implementation.

### MCP-W1 — wave ergonomics

| Decision point | Row | Status |
|---|---|---|
| `waves.start` detached shape `{waveId, members:[{role,runId}]}`, no live handles | MP1 | PARTIAL (pass-through relay only) |
| Admission enforces profile routes AND scopes (`application.mjs:2969-3008` path) | MP2 | **NONE-effective** — STAGED-WRONG, unpassable as written |
| Quota debits PER MEMBER (codex #1) | MP1 | PARTIAL (constant-two indistinguishable; ordering unpinned) |
| Wave-quota class `{wavesPerWindow, membersPerWindow}` on `takeToolQuota` | — | **NONE** |
| Atomic reserve wave+members before first start; reconcile on retry/crash (codex amend. 3) | — | **NONE** |
| `waves.start` idempotencyKey grammar + retry dedup over MCP (glm 1-C) | — | **NONE** |
| `waves.progress` paginated ≤16 + `nextCursor` | MP3 | PARTIAL (shape only) |
| Cursor rides `run.follow` chain, freshness-provable (glm #1) | MP3 | **NONE-effective** — no second read |
| No `application_run_view_oversize` by construction (bounded per-member projections) | — | **NONE** (MP3's title claims it; nothing asserts bytes) |
| `waves.send` one member by runId | MP6 | PARTIAL (runId never asserted; membership unbound) |
| `waves.stop` one member / the wave | — | **NONE** (the missing MP4) |
| `decision.answer` repo coordinate before any state read (codex #2) | MP5 | **ECHO** — mock supplies the refusal; real `answer()` unexercised |
| Cross-repo refuses IDENTICALLY to unknown (no existence leak) | — | **NONE** (no unknown-requestId control) |
| `already_resolved` typed result with `resolvedBy`, documented | MP5 | PARTIAL (regex on free text; doc leg none) |
| Late answerer must NOT re-spawn work (glm #3) | — | **NONE** |
| `waves.attach` returns member runIds; send/stop/progress LIVE on them (glm #2) | MP6 | **NONE-effective** — runIds never derived from attach (and STAGED-WRONG on waveId grammar) |
| `harvestReplayed: true` on settled re-attach (glm #4) | MP6 | **NONE-effective** — only the false case, pass-through |
| Outcome accounting keyed on `resultSha`, never `outcomes.length` | — | **NONE** |
| New tools ride registry rows; reflex table derives (S-3's law); inventory re-rendered | — | **NONE** |
| Host-death residue documented in MCP.md (re-attach posture) | — | **NONE** |

### MCP-W2 — settlement via the S-2 envelope

| Decision point | Row | Status |
|---|---|---|
| Four settlement tools on MCP | MP7 | PARTIAL (advertisement only; no dispatch proof) |
| Session gate precedes replay at the store (codex #2b) | MP8 | **NONE-effective** — VACUOUS; pinned nowhere in the repo |
| Caller presents envelope; validated as admitBoardCommand does (codex #2a) | MP7/MP8 | PARTIAL (refusal-only; no positive admit; S-3 hiding-rule tension unspoken) |
| `settlement_lease` derives session from host's fixed principal (codex #3) | — | **NONE** |
| Tool enabled ONLY with explicit `settlement` capability (never default) | MP9 | PARTIAL (one-sided; `/forbidden/` can't identify its gate) |
| Multi-principal hosts must not enable it; MCP.md trust posture verbatim | — | **NONE** |
| KS9 amendment exact: surfaces + reflex re-derive + inventory re-render | MP7 | PARTIAL (tools/list on `application` surface — but see §5 conflict) |

### MCP-W3 — readiness

| Decision point | Row | Status |
|---|---|---|
| `deployment.doctor` ordinary tool | MP10/MP15 | PARTIAL (advertisement) |
| Per-call FRESH, never open-time cached | MP10 | PARTIAL (server-layer caching caught; real probes replaced by override) |
| Credential posture metadata only (source kind, expiry class, NEVER material) | MP10 | **NONE-effective** — no canary; word-regex risks false-red on mandated metadata |
| Workspace capacity | — | **NONE** |
| Quota-free (glm #6) | MP10 | covered (suite-consistent with MP1) |

### PKG-1 — descriptor

| Decision point | Row | Status |
|---|---|---|
| Closed shape, unknown field named | MP11 | covered (top-level only; recursive closedness NONE) |
| File refs repo-relative + containment-checked, **no symlinks out** | MP11 | PARTIAL — `../` covered, **symlink-out NONE** |
| Env-sourced secret VALUES join the redaction class (codex #4) | — | **NONE** (the missing MP13) |
| Pinned at open; edits require restart; stated in error text + MCP.md (glm #5) | MP12 | **NONE-effective** — VACUOUS (no server started) |
| Parse failures name field+constraint, never the value | MP11 | PARTIAL (field named; value-leak unpinned) |
| env/keychain ref validation; deploymentRoot containment; absolute refs | — | **NONE** |
| `baton-mcp-web` honors the descriptor | — | **NONE** |
| Distribution honesty: `private: true` stays, npx-from-git documented | — | **NONE** |

### PKG-2 — npm hygiene

| Decision point | Row | Status |
|---|---|---|
| `files` allowlist exists | MP14 | covered |
| `exports` map for `baton/impl` | MP14 | PARTIAL (existence only) |
| Pack list excludes credentials/evidence/.baton | MP14 | **VACUOUS-today** — no canaries; bans can't bite from `impl/` |
| Positive allowlist shape (no test/, demo, evidence dirs) | — | **NONE** |
| Lazy natives (stdio/bin never eager) | MP16 | PARTIAL (shallow scan; transitive unpinned) |
| Native-less install degrades to `atlas: unavailable` honestly | — | **NONE** |
| Pack → clean install → descriptor stdio smoke in the gate | MP15 | **NONE-effective** — STAGED-WRONG (body is in-process) |
| Tarball asserted credential-free/evidence-free (file-list pin on real tar) | — | **NONE** (dry-run list only; no tar byte/member scan) |
| Node engines floor honesty | — | **NONE** |

### PKG-3 — the guide

| Decision point | Row | Status |
|---|---|---|
| MCP.md carries a descriptor-first quickstart | MP17 | PARTIAL (any routes-block matches) |
| Quickstart validates against the closed schema | MP17 | **NONE-effective** (never schema-validated) |
| Quickstart is executable truth (driver follows verbatim) | — | **NONE** (needs §4) |
| README external-session quickstart points to MCP.md; CLI.md thin-client note | — | **NONE** |

### Acceptance bullets (v1.0 §"v1.0 acceptance")

| Bullet | Status |
|---|---|
| External driver over stdio + descriptor: readiness → 2-member wave → paged progress → decision + already_resolved → re-attach after restart → resume-steer → resultSha harvest, no embedded API | **NONE** — zero rows run a real application (§4) |
| Settlement ops through MCP with envelope; foreign-session envelope fails EVEN ON REPLAY; KS9 exact | **NONE-effective** — MP8 vacuous; no positive envelope row; no real-lease row |
| Doctor quota-free, fresh, zero secret material | PARTIAL (MP10; secret leg vacuous) |
| npm pack → clean install → descriptor smoke; tarball pinned | **NONE-effective** — MP15 staged-wrong; MP14 vacuous-today |
| MCP.md quickstart executable truth | **NONE** |

**Summary:** of ~45 distinct v1.0 decision points, 4 are covered soundly (advertisement-level),
15 are PARTIAL (row exists, material legs open), 8 are ECHO/NONE-effective (row exists but the
property is fixture-supplied or staged away), and 18 have NO row at all — including three of
the five acceptance bullets.

## 3. Fixture authority: McpFleetServer + mockApplication

**What the fixture proves for real.** The server under test is the genuine `McpFleetServer` with
a real `CoordinationStore` on disk: protocol lifecycle, `validateArguments` (including the REAL
application command-args validators, `mcp-northbound.mjs:688-694` — as MP6 painfully
demonstrates), `_authority` capability/repoId gates, the `takeToolQuota` call site, the
`admitMcpCall` durable-idempotency path vs the observe path (`STATEFUL`, `mcp-northbound.mjs:101-111,
1099-1136`), error-code mapping, and surface composition are all exercised as production code.
Rows green/red through real dispatch, not through a re-mocked transport. That is genuinely good
authority for the TRANSPORT SHELL of the contract.

**What the fixture cannot prove.** `mockApplication` replaces everything below
`application.command` with an echo chamber. Every v1.0 property whose enforcement lives in the
application/wave/store layer is supplied BY THE FIXTURE:

| Contract property | Real owner | Fixture behavior |
|---|---|---|
| Profile route/scope admission (MP2) | `application.mjs:2969-3008`, `:4300-4314` | never refuses → row unpassable honestly |
| Repo coordinate on `answer()` (MP5) | `application.mjs:11907-11922` | mock throws the exact code the row wants |
| Per-member fan-out + wave-quota class (MP1) | wave driver + host quota policy | mock starts nothing |
| Progress projection bounds + cursor chain (MP3) | wave driver + `run.follow` | mock returns a canned page |
| `harvestReplayed` computation (MP6) | wave/store settle layer | mock returns the flag |
| `doctorReadiness` probes (MP10) | `application-deployment.mjs:1254-1263` | instance override replaces it |
| Envelope/XB admission with real leases (MP7/MP8) | `coordination-store.mjs:14672-14708`, `:1682-1697` | store is real but no lease is ever minted |

So yes — rows can pass through fixture artifacts; §1 names the channel per row. The suite as a
whole verifies that the MCP SERVER relays, validates, advertises, debits, and error-maps
correctly. It does not verify that anything it relays is TRUE.

**The fixture also steers architecture, in two sharp ways:**

- **The closed command card.** The constructor rejects an application whose `card().commands`
  lacks any `ORDINARY_APPLICATION_ENTRIES` command (`mcp-northbound.mjs:877-887`), and the
  suite's frozen mock card lists no `waves.start/progress/send/stop`. Registering the new tools
  by extending `ORDINARY_APPLICATION_ENTRIES` therefore reds EVERY row at construction — the
  implementer is pushed toward registry-row/matrix registration (which the contract's S-3
  phrasing does prefer) or toward editing the fixture (suite churn that red-first discipline is
  meant to forbid). Worse, since no row runs the REAL `BatonApplication`, the suite can go fully
  green while the real application's card lacks the new commands — making every production
  server construction throw. Only the §4 E2E catches that.
- **The `doctorReadiness` instance override** (MP10) pins a server-own method of exactly that
  name; a contract-conformant dispatch through `application.doctorReadiness()` goes red. A seam
  is fine; an unnamed one is a trap.

**admitMcpCall vs observe is real but unpinned per-tool.** The fixture exercises whichever path
`STATEFUL` assigns, but no row ASSERTS the assignment: `waves.start` must be stateful
(idempotent across transport retry — glm 1-C), `waves.progress`/`deployment.doctor` must ride
observe. A misregistered `waves.start` (observe path, no durable idempotency, double-start on
retry) greens every row in the suite.

## 4. Missing tiers: the external-driver E2E

**What it costs the gate's honesty: most of it.** The v1.0 acceptance's first bullet — an
external driver connected ONLY via stdio MCP with a declarative descriptor, no embedded API —
is the epic's definition of done, and the suite's every application interaction is mocked.
Concretely, with the E2E absent the suite can go fully green while:

- the profile check (codex authority #1) does not exist in the real application — MP2 can't see it;
- the repo-coordinate hole (codex #2, CONFIRMED-HOLE) stays open in `answer()` — MP5 can't see it;
- the session-gate/replay order (codex #2b) stays unamended in `admitWorkflowFinding` — MP8 can't see it;
- the real application's card lacks the new commands, so the real server won't even construct (§3);
- the descriptor parser is never wired to a real server boot (MP11/MP12 test a function, not a deployment);
- `harvestReplayed`, resultSha accounting, and resume-steer semantics are whatever the mock said they were.

The suite verifies the transport shell; the contract's bar is authority equivalence ("every
authority guarantee the embedded path has"). Those are different claims, and only the E2E binds
them.

**The minimal closing row (one test, slow-tagged, ~120–150 lines with existing helpers):**

1. Write a fixture descriptor (+ a canary credential file) into a tmpdir repo; boot
   `impl/scripts/mcp-stdio.mjs` as a real child process; speak newline-delimited JSON-RPC over
   its stdio (the suite already knows the frame shape; `serveMcpStdio` is at
   `mcp-northbound.mjs:1523`).
2. Behind the descriptor, a REAL `BatonApplication` over a real `CoordinationStore` with the
   mock-harness driver pattern the embedded suites already use (e.g. `appHarness` in
   `impl/test/kg-settlement-red.test.mjs:273` and the phase64 harness), two profile routes.
3. Walk the acceptance transcript verbatim: `deployment.doctor` → `waves.start` 2 members
   (plus a 3rd off-profile member refused with zero starts) → `waves.progress` through 2 pages
   (cursor from page 1 must read page 2 fresh) → `decision.answer` then a second answer
   observing `already_resolved` → kill the child, reboot on the same store → `waves.attach`
   asserting `harvestReplayed` → `waves.send` to an attach-returned runId → harvest keyed on
   `resultSha` (no double-count on re-attach) → `knowledge.settlement_lease` + `knowledge.promote`
   with the envelope, then a foreign-session replay of the same key refused with the session
   code.
4. The quickstart leg: the descriptor the driver uses is parsed out of MCP.md's fenced block,
   closing MP17's "executable truth" by construction.

This one row converts MP2/MP5/MP6/MP8/MP10's fixture-echo claims into real ones and is the
only row that can. Without it the gate certifies a shell.

## 5. Cross-suite conflicts

Greening this suite as written breaks or rewrites existing green invariants; the contract text
does not announce either change. These are blocking because an implementer hits them on day one:

- **Ordinary-surface composition.** `mcp-reflex-surface-red.test.mjs:189` asserts TODAY (green):
  "the ordinary (Web-bridge) surface is unchanged — no reflex tool is listed" on the
  `application` surface. MP5 requires `baton_decision_answer` (a reflex tool,
  `mcp-northbound.mjs:512`) to dispatch on that same surface; MP7/MP8/MP9 require the four
  settlement tools — which the contract's KS9 amendment lands in the matrix reflex table,
  combined-surface only (`mcp-northbound.mjs:543-571`, `:901`) — to be advertised and callable
  there. Both cannot hold. The contract must state explicitly that MCP-W1/W2 tools join the
  ORDINARY surface (amending the reflex suite's inventory row), or this suite must move its
  settlement/decision rows to `surface: 'combined'`. Silence means the implementer chooses
  which suite to break.
- **The S-3 hiding rule vs caller-presented envelopes.** Matrix-derived wire schemas strip
  `sessionAuthority` (`mcp-northbound.mjs:544`, S-3 rule 5: authority is "intentionally absent
  on the wire"). MP7/MP8 pass `sessionAuthority` as a call argument per codex #2a. Greening
  them amends the hiding rule for these rows — a real security-design decision (the board tools
  inject host-side instead) that the v1.0 text phrases ambiguously ("callers present the
  envelope" + "validated exactly as admitBoardCommand does", and admitBoardCommand's MCP path
  never accepts caller envelopes, `_boardAuthorityContext` `:1503-1507`). The suite silently
  picks the caller-presents reading; the contract should say so and amend the S-3 note.
- **The mock card vs `ORDINARY_APPLICATION_ENTRIES`** (§3): ordinary-table registration of the
  wave tools reds the whole suite at constructor time; the fixture forces either matrix
  registration (→ the surface conflict above) or fixture edits.

## 6. Gate verdict

**GATE-NOT-READY.**

The suite is genuinely all-red today (15/15, no accidental green — item 5 confirmed), and its
transport-shell pins (registration, validation, quota call-site, error mapping, durable
admission) are real. But as the red-first enforcement of the v1.0 contract it fails in three
independent ways: rows a correct implementation cannot pass (STAGED-WRONG ×3), rows that prove
nothing about their titled property (VACUOUS ×2, plus vacuous legs in MP10/MP14), and entire
contract properties with no row at all (18 decision points, 3 acceptance bullets, including the
epic's E2E definition of done).

### Blocking items (must be resolved before the suite can gate)

1. **MP6 fixture waveId** — `'wave:abc'` violates the real `/^wave:[a-f0-9]{32}$/` grammar; the
   row is unpassable as written (proven: dies at attach with `invalid_run_command`). Same fake
   waveId in MP3 and MP9 will go red the moment those tools validate consistently.
2. **MP2 profile injection** — the fixture has no profile source and the mock never refuses;
   the row greens only for a hardcoded-allowlist (wrong) implementation. Inject the deployment
   profile into `setup()` and assert on/off-profile against the same object.
3. **Surface conflict** (§5) — contract + both suites must agree where `decision.answer` and
   the four settlement tools live; today MP5/MP7/MP8/MP9 green only by breaking the standing
   reflex-suite invariant, and the contract's KS9 text lands them on the wrong surface for
   these rows.
4. **MP8 replaced with a real ordering row** — the codex #2b property (session gate before
   replay) is pinned nowhere in the repo. Store-level: mint lease → admit key K as session S →
   replay K as foreign session → assert `run_orchestrator_session_mismatch`, unchanged event
   count, and a same-session replay control. (The row's claim that KS2 covers this is false.)
5. **MP15 must do the pack dance or be renamed** — as written it retires the PKG-2 gate while
   impersonating it. The real row: `npm pack` → install into tmpdir → descriptor-driven stdio
   handshake through the packed install + tar member-list pin (canary-seeded).
6. **The three missing rows the header already promises** — MP4 (`waves.stop`), MP13 (codex #4
   env-secret redaction into `runtime-isolation.mjs:104-155`'s redactor), MP18 (the §4 E2E).
   The header says eighteen rows; the contract's acceptance requires them.
7. **The E2E tier** (§4) — without it every application-layer authority claim (profile, repo
   coordinate, session-before-replay, per-member quota class, harvestReplayed, real freshness)
   is fixture echo, and the constructor/card integration failure mode is invisible.

### Non-blocking repairs (strengthen before implementation lands)

- MP1: add 1-member/3-member debit counts; assert debit-before-dispatch ordering; pin the
  `{wavesPerWindow, membersPerWindow}` class; pin `waves.start` durable idempotency
  (same-key replay, changed-roster conflict).
- MP3: drive a 17-member wave across two pages; assert page 2 reads fresh via the page-1
  cursor; assert serialized size < `maxMessageBytes` with fat member projections.
- MP5: add the unknown-requestId control (existence-leak identity); assert `resolvedBy` as a
  field; move the repo-coordinate proof to the E2E.
- MP6 (after fix 1): derive the send target from the attach payload's runIds; assert
  `args.runId`; add the `harvestReplayed: true` re-attach case and a non-member send refusal.
- MP7/MP9: add positive cases (valid envelope admits; settlement-capability lease mints).
- MP10: seed a canary secret into the fixture posture and assert absence; drop the word-regex;
  keep the freshness probe but add a real-`doctorReadiness` leg in the E2E.
- MP11: add the symlink-out case, absolute-path ref, nested unknown key, and a
  value-not-echoed assertion on the error text.
- MP12: boot a server from the descriptor, rewrite the file, assert the advertised surface is
  unchanged (drop or keep the freeze check as a tactic, not the property).
- MP14: seed canary credential/evidence/.baton files at the package root; assert the pack
  contains ONLY allowlisted classes; pin the `baton/impl` exports identity.
- MP16: replace/augment the scan with a spawned import of the bin with natives hidden, plus
  the `atlas: unavailable` posture assertion.
- MP17: validate the fenced block through `loadMcpDescriptor` itself; let the E2E consume the
  same block verbatim.

### Verification of this report

- Suite run from repo root: `node --test impl/test/mcp-packaging-red.test.mjs` → 15 fail /
  0 pass (per-row failure modes tabulated in §0).
- npm pack shape: `npm pack --dry-run --json` executed in `impl/` (npm 11.11.0) — output shape
  and file inventory (400 files; 275 under `test/`; zero banned-regex hits) measured directly.
- All file:line citations verified by reading the cited regions of `mcp-northbound.mjs`,
  `application.mjs` (NUL-containing; read via `grep -an`/`sed -n` windows),
  `kg-settlement-red.test.mjs`, `mcp-reflex-surface-red.test.mjs`, `impl/package.json`,
  `impl/MCP.md`, and `impl/scripts/mcp-stdio.mjs`.
- No `impl/` files were modified; the only write is this report.
