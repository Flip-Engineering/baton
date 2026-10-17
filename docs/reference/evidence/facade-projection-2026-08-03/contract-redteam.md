# Red-team: facade-projection contract v2.0 (#87+#48, the workflow-surface rung) — pre-implementation adversarial review

(Target: `facade-projection-contract.md`, 951 lines, 13 decisions, 8 open questions.
Verified against `impl/src/` ground truth 2026-08-04 — NUL-containing files
(`coordinator.mjs`, `application.mjs`, `coordination-store.mjs`) read via `grep -an` +
`sed -n` only, per the contract's own discipline. Tool counts executed live
(`mcpApplicationToolNames()` = 27, `mcpCombinedToolNames()` = 78 — confirmed). BD3 v2.0
fold, issue #93, issue #89, and the sibling blue-team shape
(`bidirectional-v3-2026-08-02/test-blueteam.md`) read in full.)

Verdict scale: **SOUND** = the decision survives contact with the landed code; an
implementer following it literally produces the intended behavior. **HOLE** = a named
failure with a named fix; severity marked blocker / amendment / note. **Citation audit:**
34 file:line anchors spot-checked; 29 exact against the current worktree, 5 wrong or
materially imprecise at authoring time (§1.2). **Line-reference frame:** this report
cites the CURRENT worktree (post-`0eae749`, 2026-08-04), which inserted +47 net lines
into `coordination-store.mjs` and +32 into `coordinator.mjs` (all below the cited
coordinator regions — every coordinator citation re-verified exact). The contract's
drifted ground-truth-9/12 store citations were spot-checked against the `9ec8e97` blob
they were authored against and are CORRECT THERE (steering gate pre-shift
`:13586-13596`, evidence law pre-shift `:15144-15151`) — the drift is worktree movement
after authoring, not a verification failure; re-anchor at fold time. What the drift
does NOT exonerate: the `selected = steering ? … : []` line sat INSIDE the contract's
own cited window pre-shift (`:13596` within its `:13587-13597`) and its semantics were
still misread (blocker #1), and the knowledge evidence CODES were misread inside the
contract's own correctly-cited window (blocker #3).

---

## 1. Citation audit (attack surface 1)

### 1.1 Verified exact (29)

- Message lane: `coordinator.mjs:6592-6662` sendMessage — kind ∈ {inform, query, steer}
  (:6594-6596), `Buffer.byteLength(body) > 2_048` bare TypeError (:6597-6599), XOR target
  (:6600-6604), `worker_not_active` (:6608), `run_not_active` (:6613),
  `message:<64 hex>` mint (:6615), `void auth` (:6657), return shape (:6658-6662). All ✓.
- Receipt: `messageReceipt` (:6669-6690) — null for unknown (:6670-6671), exactly
  `{delivered, read, actedOn, reply}` (:6682-6690). ✓
- Attention: `attentionFollow` (:6694-6732) — scope validation (:6696-6702),
  `_attentionScopeAuthorized` (:6735-6741), `_isReviewAuthority` (:6743-6755,
  `activeRunOrchestratorLeaseForSession` consulted ✓), `_attentionPage` (:6757-6788),
  `_mintMemberTerminal` (:6795-6822), `ATTENTION_COALESCE_WINDOW_MS = 500` (:44),
  `timeoutMs` destructured and never referenced in the body ✓, return
  `{reasons, throughCursor, afterCursor, runId}` ✓. String targets ARE admitted as wake
  kinds (`targetKinds.add(target)`, :6731) — Decision 5's `targets: [kind]` mapping
  type-checks against the lane ✓.
- Facade idiom: `command()` (:12055), run.debug port (:12071-12073), run.steer
  (:12077-12079), settlement ports (:12081-12089), wave ports (:12092-12100),
  `validateApplicationCommandArgs` + recursive-session gate (:12101-12110),
  `APPLICATION_COMMAND_DEFINITIONS` (:149) with the byte-stable pin comment (:192; the
  pin itself is `grammar-m3-red.test.mjs:264`), `applicationError` (:222-224),
  `exactObject` (:281-285), `validId` (:288), `validText` (:289-291),
  `normalizePrincipal` exactly `{actor, principalId, sessionId}` (:986-992),
  `normalizeSteer` (:912-919), `steer()` with `_authorize` + digest-bound subject +
  `coordinator.list()` resolution (:12267-12292), `_authorize` →
  `application_unauthorized` (:3048-3057), `options.authorize` required (:2318-2320) and
  assigned (:2328), `_settlementCommand` with no `_authorize` (:12244-12264 — the
  Decision 5 precedent, accurate), `projectBoardView` exported (:488),
  `boundedAttentionText` (:300, NFKC + secret-redaction + byte cap),
  `MAX_ATTENTION_TEXT_BYTES = 4_096` (:53), `MAX_BOARD_VIEW_BYTES` (:60) /
  `MAX_BOARD_ITEMS = 512` (:61), wave-port normalizers (:11494, :11536), allowed-set
  idiom (:1837-1840), run.follow cursor discipline (:1872-1876). All ✓.
- Store scratchpad: `SCRATCHPAD_SCOPE` (:482), `MAX_SCRATCHPAD_WORKER_ENTRIES = 128` /
  `MAX_SCRATCHPAD_SHARED_ENTRIES = 512` (:473-474), `SCRATCHPAD_ENTRY_ID` (:480),
  `scratchpadSnapshotBatch` with `scratchpad_read_invalid` + `scratchpad_cursor_stale`
  CAS (:13395-13410), `scratchpadSnapshot` shape (:13413-13420). Unknown-run reads return
  an empty snapshot (shape-only `validRunId` check) ✓ — Decision 6's posture holds.
- Store board: `SAFE_BOARD_ID` (:393), title 160 / detail 4,096 / evidence ≤8
  (:396-399), `postBoardItem(fields, auth, appendGate = null, boardAdmission = null)`
  (:14028) with key replay (:14029-14030), hub-minted ids ✓, `boardSnapshot` carrying
  public `runId` + dual fence (:14258-14270), S-2 `board_session_mismatch`
  (:13933-13936), `board_run_closed` (:13937-13940), replay binding derivation from
  `boardAdmission` with no lease field (:8330-8334, :8343-8346) ✓,
  `boardRunBinding: {runId, result: adopting ? 'adopted' : 'bound'}` (:14022-14024) ✓.
- MCP machinery: `schema()` closed (:246-248), `_meta` registry-digest stamp
  (:558-561), `CAPABILITY` (:96-99) with unregistered→`forbidden` (:86-89 comment +
  :1141-1152 `_authority`), hand-rolled guards (:976-1020), `_dispatch` with
  connection-derived principal (:1536-1573), `ORDINARY_EXPLICIT_TOOLS` (:699-705),
  `STATEFUL`/`RECONCILABLE` posture (:120-127), `stateFailureCode` (:187-240) —
  `application_unauthorized`→`forbidden` (:189), `application_*` pass-through (:193),
  bare TypeError→`invalid_command` (:238), default `command_outcome_unknown` (:239),
  board family mapped (:223-231) ✓. `baton_knowledge_promote` → `board_lease_required`
  (:1600-1615) ✓, `baton_knowledge_settlement_lease: ['settlement']` (:104) ✓,
  `baton_scratchpad_elevate`/`settle` tool defs (:524-543) ✓, board tools ride
  `_boardAuthorityContext(principal).sessionAuthority` (:1676-1730, :1808-1810) ✓,
  MCP board read = `projectBoardView(snapshot, {role:'orchestrator', workerId:null})`
  (:1721-1728) ✓, quota comment (:1534-1535) ✓, `baton_decision_answer` (:507-518,
  capabilities `['approve','observe']` :89) ✓, `baton_waves_start` (:456-472) ✓.
  Descriptor: card = table keys + `waves.attach` (:146-150), default principal
  `{userId: 'descriptor-host', capabilities: ['observe']}` when unconfigured
  (:186-189), `maxWaitMs: 25_000` / `maxMessageBytes: 256 KiB` (:197-198) ✓.
- CLI: `lifecycleActions` (:1357-1360), `start` early branch (:1354-1356), `follow`
  already refuses `cli_command_unavailable` (:1351-1353), positional sub-args
  (:1364-1370), `CLI_WEB_COMMANDS` (:15-25) + gate (:1792), `cliError`/`cli_invalid`
  (:42), run-table command idiom (:1500-1514), `canonicalCliRenderModel` (:835-850) ✓.
- Semantics: surface derivations `cli: baton ${parts.join(' ')}` /
  `mcp: baton_${parts.join('_')}` (:1135-1140) ✓, `run.watch` canonical (:1253-1258)
  with legacy aliases `['run.watch','application.commands','run.follow']` (:1775) ✓,
  wave rows (:1565-1613) ✓, `buildCanonicalOperation` (:1834-1876) ✓, board registry
  rows with `sessionAuthority` in-schema and `surfaces: ['embedded','mcp']`
  (:1351-1409), worker-profile `board.claim` (:1410-1428) ✓.
- Conformance: `BANNED_SURFACE_VERBS` = exactly 13 verbs — show, status, inspect, act,
  notify, follow, wait, progress, events, output, episode, stop-member, steer
  (`surface-conformance.mjs:196-199`) — "follow, steer, progress, wait, and nine
  others" ✓; the lint scans operation.key + names.cli/web/mcp/embedded with the single
  `waves.progress` regex exception (:710-718) ✓ — **surface ALIASES are not scanned**,
  which is how legacy `run.follow` survives (relevant to Open Question 1, §6.1). CS-4
  artifact keys `canonicalOperations` / `cliWebCommands` / `mcpApplicationTools`
  (:624-627, inside the cited :652-678 region) ✓. `servedCliOrdinaryKeys` (:34-75),
  `renderMcpToolInventory` (:95-119), `checkSurfaceDocs` + `--check` (:145-165) ✓.
  Generated blocks `CLI.md:18-46`, `MCP.md:110-142` ✓; settlement prose `MCP.md:97-108`
  ✓; pinning suites `control-surface-truth-red.test.mjs:163`, `:65-73`, `:148-159`,
  `grammar-m4b-red.test.mjs:193`, `run-debug-surface-red.test.mjs:230` ✓ (all read).
- BD3 pins: every `bidirectional-v3-red.test.mjs` anchor — C0 414, C0b 434, C1 457,
  C1b 487, C2 502, C3 526, A5 557, C4 590, C5 603, C3b 618, C6 632, D1 646, D2 668,
  D3 692, D4 724, D5 747, the 20,480 shape-only window (448-455) — all exact ✓.
  `mcp-packaging-red.test.mjs:556` (`authorize: async () => true`) ✓,
  `phase77-…:416` facade-command driving ✓. BD3-decisions citations: the finding-by-id
  law (:19-21) and the campaign control law (:134-144) verified verbatim ✓.
  `docs/PROGRESS.md:391` operator law ✓ (text present at the cited anchor).

### 1.2 Wrong or materially imprecise at authoring time (5) — plus one exonerated drift cluster

1. **`KNOWLEDGE_NODE_TYPES` is 19 types, not "20 types"** (`coordination-store.mjs:140`,
   and 19 in the `9ec8e97` blob too — wrong when written).
   Count: Run, Task, Artifact, Phase, Experiment, Finding, Decision, Question,
   Hypothesis, Principle, Constraint, Literature, Research, RouteStat, Skill,
   Counterexample, Representation, ScratchFact, Source = 19. (Ground truth 12; note.)
2. **The demo anti-pattern import is at `impl/demo.mjs:14`, not ":1-13"**
   (`import { createDriver, MockAdapter } from './src/index.mjs'`). Lines 1-13 are the
   header comment; `demo.mjs` is untouched since `38cdee6`, so this was wrong when
   written. This is the rung's most-repeated anchor (Seed, Decision 13, WS-01).
3. **`impl/src/mcp-descriptor.mjs:47-48` does not contain settlement-capability
   anything** — it is `resolveCredentialRef`; the string "settlement" does not occur in
   that file (untouched since `5bda319` — wrong when written). The enforcement is
   `CAPABILITY` (`mcp-northbound.mjs:104`) + `_authority`; the "never defaulted" prose
   is `MCP.md:103-105` (that citation is fine).
4. **Decision 8's replay-envelope citation points at the fresh-post branch.**
   `:14022-14024` is the non-replay return. The seam's replay envelope is
   `:13985-13990` (`result` derived from `prior.payload.boardAdmission?.adopted`) and
   `postBoardItem`'s own replay return is `:14029-14030` — which carries **no
   `boardRunBinding` at all** (see §2, Decision 8). Positional imprecision; the
   substantive gap is real in any revision.
5. **`impl/MCP.md:83-89` for the `waves.attach` resume path is approximate** — the
   resume/harvest prose sits at :74-82; :83-89 is the tail of it. Harmless.

**Exonerated:** the ~30-line drift across ground truth 9's settle-lane citations and
~15-35 across ground truth 12's knowledge citations (e.g. the steering gate cited
":13587-13597", actual :13624-13626; the evidence law cited ":15144-15152", actual
:15181-15188) is worktree movement — `0eae749` (2026-08-04, +47/-7 lines in
`coordination-store.mjs`) landed AFTER the contract's 2026-08-03 verification pass.
Spot-checked against the `9ec8e97` blob: the gate was at :13593-13595 and
`const selected = steering ? … : []` at **:13596 — inside the contract's own cited
window** — and the evidence codes at :15144-15151, exactly as cited. The contract's
post-9ec8e97 re-verification claim HOLDS for these stretches; the lines simply need
re-anchoring at fold time. What stands regardless of revision (and is the substance of
blockers #1/#3): the semantics of the `selected = steering ? … : []` line and the
`temporal_incoherence`/`missing_evidence` code names were misread inside windows the
contract itself correctly cited.

Per the red-team charter (a wrong citation = automatic blocker), items 1-5 feed the
blocker list as one citation-hygiene blocker (#7), scoped to the five authoring-time
errors; the drift cluster is explicitly NOT counted against the contract.

---

## 2. Per-decision verdicts

### Decision 1 — the projection law — **HOLE (amendment; load-bearing phrasing)**

The law's mechanics check out where the lanes were actually read correctly (verbatim
outcomes, coded-refusal propagation, no `_assertRunMutable` — contrast `steer()`
:12278 ✓, direct-port placement ✓). But its two absolute clauses are contradicted by
the contract's own later decisions:

- **"never narrower"** is violated three times by design: Decision 5 requires a
  run-scoped `runId` while the lane admits a bare deployment scope (`scope.runId == null`
  is VALID at :6696-6704 and admits any authenticated principal at :6737-6738 — vacuously,
  since `_attentionPage` filters `reason.runId !== null`); Decision 9 subtracts
  `Decision` from a lane-closed enum; Decision 9 generalizes a Finding-specific store
  rule to all types (see Decision 9 below). Each is defensible; none is "exactly as
  permissive as the lane."
- **"no response-field invention… only the envelope marker added"** is violated four
  times by design: Decision 4 adds `messageId` to the receipt; Decision 6 adds
  `nextCursor`/`truncated` and drops `fenceTuple`; Decision 8's replay branch must
  derive `boardRunBinding` the lane's replay return lacks; Decision 9 invents
  `result: 'added'` (the lane's fresh-add return is `{ok: true, event, node}` — no
  `result` field at all, `coordination-store.mjs:15631-15632`).

**Fix:** amend Decision 1 with an explicit projected-domain + envelope-completion
carve-out: "within the projected request shape, refusal semantics are the lane's; the
only response additions are `schemaVersion: 1` and the per-decision completions listed
here: `messageId` echo (D4), offset paging `nextCursor`/`truncated` (D6), replay
`boardRunBinding` derived from the returned prior event (D8), `result: 'added'`
synthesized on a fresh add (D9)." Without it, every "VERBATIM" claim is
review-time-negotiable and FP-04/FP-11's oracles pin different things than the law says.

### Decision 2 — eight direct ports; `watch` not `follow` — **SOUND**

Verified end to end: the insertion neighborhood (:12092-12100) dispatches before both
`validateApplicationCommandArgs` and the recursive-session gate (:12101-12110); the
byte-stable table (:149) is untouched; all seven new verbs (send, receipt, watch, read,
elevate, post, seed) and all five nouns are absent from `BANNED_SURFACE_VERBS`
(:196-199); the `run.watch`-canonical-of-`run.follow` precedent is real
(`application-semantics.mjs:1253-1258`, alias rows :1775-1780); derived names are
mechanically C4-clean (:1135-1140). The gate rationale is accurate: the gate fires on
`context?.sessionAuthority` for non-allowlisted command-table commands and would indeed
pre-empt the lane's run-orchestrator-lease review authority (:6743-6755). Note (not a
hole): pre-gate placement also admits recursive-session principals to the four
effectful lanes — but each carries its own seam (`_authorize` or the lane's), matching
the wave-ports precedent. The registry rows `run.scratchpad` (:1330, unwired — no
facade dispatch today ✓ ground truth 13) and `run.attention.list` (:1325) pre-exist;
the new keys do not collide and derived names stay disjoint.

### Decision 3 — `run.message.send` — **SOUND** (one test-authoring note)

Lane shape, XOR, outcomes, and the `void auth` posture verified. The steer-idiom
authorization with digest-bound subject matches `:12267-12292`. Resolve-then-authorize
via `coordinator.list()` for worker targets matches `:11427-11443`. Note for FP-03:
"unknown-workerId ≡ foreign-target ≡ `application_unauthorized`" holds only if the
refusing-policy stub ALSO refuses the null run scope (an unresolvable worker authorizes
against null); the row text says "a policy refusing the run" — pin the stub to refuse
`runId === R` **and** `runId === null`, else the row is staged-wrong against a
contract-correct implementation (unknown worker under that stub returns
`worker_not_active`, not `application_unauthorized`).

### Decision 4 — `run.message.receipt` — **SOUND** (two notes)

The resolve-then-authorize law citation is exact (`bidirectional-v3-decisions.md:19-21`).
The `null`-for-unknown being unreachable is coherent. Notes: (a) the `messageId` echo
needs the Decision 1 carve-out (above); (b) the permitted kernel addition
(`coordinator.messageRunId`) is feasible — `_messages` records carry `target` (:6617)
and run resolution via `_workers`/`_tasks` survives death/respawn for task persistence —
but its behavior for worker-targeted messages whose worker handle is gone must be pinned
(resolve to null → forbidden, never leak), and FP-04/FP-05 should carry that row.

### Decision 5 — `run.attention.watch` — **HOLE (blocker #4 — transport-authority impedance)**

Lane mechanics all verified (scope-first, string-targets-as-kinds, `timeoutMs` ignored,
verbatim page shape, candidacy derived live for the review authority only). The hole is
not in the facade logic — it is that **the contract never states who can ever satisfy
the lane's authority model through each transport**:

- The lane admits exactly `principalId === 'wave-owner'` or a live run-orchestrator
  lease holder whose session's principalId matches (:6735-6755). `wave-owner` appears
  NOWHERE in the tree except `coordinator.mjs` itself — no production caller exists
  (the D5 pin keeps `wave-driver.mjs` free of `attentionFollow`); it is a test-fixture
  principal.
- Embedded facade path: the WS-01 driver self-names `principalId: 'wave-owner'` —
  works, and that is the established embedded model (the embedder is trusted code).
- **MCP path: the connection principal is `principalId: principal.userId`
  (:1539-1541 idiom), i.e. the descriptor's `principal.userId` — default
  `'descriptor-host'` (:186-189).** A stock `baton_run_attention_watch` call on a run
  scope refuses `attention_scope_forbidden` for every real MCP deployment unless the
  operator literally sets `principal.userId: 'wave-owner'` in the descriptor (a magic
  string the contract never names) or the connection holds a run-orchestrator lease
  (settlement-plane material an ordinary client never has).

The same class hits the rest of Decision 13's MCP column: `baton_decision_answer`
requires the `approve` capability (:89), the control tools require `control`, and the
default descriptor principal is observe-only. None of this is a code change — the
projection is faithful — but as written FP-15/WS-01's "or talks MCP" half is
unsatisfiable for a default deployment and the contract says nothing about it.
**Fix:** Decision 5 and the MCP.md prose (Decision 10) must state the precondition
("run-scoped watch requires the deployment's orchestrator principal — descriptor
deployments set `principal.userId` to the orchestrator id the lane recognizes, or hold
a run-orchestrator lease"), and FP-14/FP-15 must pin a descriptor row with the
orchestrator-named principal. Also record the deployment-scope narrowing
(`{runId: null}`) as a deliberate non-projection under the Decision 1 carve-out —
it is vacuous at the lane, so the narrowing is safe.

### Decision 6 — `run.scratchpad.read` — **HOLE (blocker #5 — the page has no byte budget)**

Store read machinery verified (scope closure :482, non-evented snapshot :13413-13420,
unknown-run empty ✓). The renderer law projection is faithful to :10394-10426 (64-item
non-knowledge page :10402, `UNTRUSTED_SCRATCHPAD` frame :10399, per-leaf
`boundedAttentionText` ≤4,096 :300/:53). **The hole: the page carries per-leaf and
per-page-item bounds but no serialized-total budget.** 64 entries × 4,096 bytes =
256 KiB of leaves alone — plus entry ids, kinds, fences, and the envelope — at or over
the MCP surface's own `maxMessageBytes: 256 KiB` (`mcp-descriptor.mjs:197-198`). The
board read this decision mirrors has exactly such a ceiling (`MAX_BOARD_VIEW_BYTES`
with explicit truncation, :60); the scratchpad page needs the same discipline, and
Decision 12's cap table has no row for it, so FP-09/FP-17 cannot catch it. **Fix:** add
a page-serialized budget (e.g. 256 KiB with an explicit `truncated` marker, reusing the
renderer idiom) to Decision 6 + a Decision 12 row + an FP-09 pin. Pagination itself
(offset over a live snapshot, fence+observedSeq carried, no CAS in v1) is coherent —
the store's ids are insertion-ordered and a reap bumps the fence (:8311-8316), so the
drift story is honest.

### Decision 7 — `run.scratchpad.elevate` — **HOLE (blockers #1 and #2 — the contract misreads the lane)**

This is the fold's center of gravity and it is wrong twice, in the exact citation-drift
gap of §1.5:

**Blocker #1 — for non-steering-registered runs the selection is silently discarded.**
`coordination-store.mjs:13627`: `const selected = steering ? [...fields.entryIds].sort(...)
: [];`. The store admits mid-flight elevation for steering-registered runs (gate
:13624-13626) — but for every OTHER run, the terminal path the coordinator wrapper
drives **elevates zero entries regardless of `entryIds`**: `elevations` stays empty,
every partition entry is dispositioned `not_elevated`/`no_driver` (:13660-13664), the
partition is reaped (entries deleted, fence bumped, :8311-8316), and the caller
receives `{ok: true, result: 'settled', elevated: [], dispositionDigest, …}` (:13708) —
a SUCCESS receipt for an act that did nothing the caller asked and destroyed the
selection's basis. The contract read the gate (its ":13587-13597" citation — correct
against the `9ec8e97` blob, where the gate sat at :13593-13595) as
"terminal-task discipline vs mid-flight relaxation" and missed the selection discard
sitting INSIDE that same cited window (pre-shift :13596). As specified,
`run.scratchpad.elevate` is **inert outside
wave (steering-registered) runs, and the facade would project that inertness as
`ok: true`** — precisely the dishonest-success class the rung exists to eliminate, and
a direct contradiction of the contract question ("every refusal the kernel lanes define
arriving byte-identically" — here a non-refusal arrives as success). The demo survives
(wave runs register steering), but #48's "two implementers" non-wave case silently
no-ops.

**Blocker #2 — the retry law the contract pins is unreachable through the projected
path.** The store's idempotency is **fence-bound**: `reapKey =
scratchpad.partition_reaped:<runId>:<taskId>:<expectedScratchpadFence>` (:13549), and
the prior-hit replay/conflict branch (:13551-13598) fires only when a second call
arrives with the SAME pinned fence. The coordinator wrapper re-derives
`expectedScratchpadFence` LIVE on every call (:10236-10240), and the deterministic key
it passes — `scratchpad.task_settlement:<taskId>` (:10240), the key Decision 7 says
"makes this reachable and it MUST reach the caller" — **is never consulted by the
store**: `elevateTaskScratchpad(fields, auth)` validates `auth.actor` and never reads
`auth.key`; no event is appended under it (:13538-13715). Since every reap bumps the
fence (:8316), a wrapper-driven retry derives a fresh fence → prior miss → fence
check passes → partition now empty → **`{ok: true, result: 'empty', reapEventSeq: null,
elevated: []}`** (:13606-13611) — not `idempotent`, and a changed selection never
reaches `scratchpad_settlement_conflict`. The `idempotent`/conflict pair is reachable
only for direct store callers pinning a fence (exactly how the landed test drives it —
`scratchpad-33-red.test.mjs:600-604` calls the store twice with the same request
object). **FP-10's "an exact retry replays `idempotent`; a changed selection on retry
refuses `scratchpad_settlement_conflict`" is staged-wrong: a contract-correct
implementation FAILS both clauses.** Secondary effect: any reap that precedes the
facade call — e.g. `releaseTerminalTaskResources` auto-settling with `entryIds: []`
(:1885, reached from the context-call settlement cleanup at `application.mjs:8685`) —
silently degrades the command to the same `empty` receipt, and neither FP-10 nor WS-01
pins `elevated ≥ 1`, so the degradation greens the suite.

**Fix (both):** rewrite Decision 7's outcome table and FP-10 to the live-fence truth —
(a) happy path: `result: 'settled'` with `elevated ≥ 1` pinned; (b) exact retry through
the wrapper: `result: 'empty'`, receipted as the honest never-double-elevate posture
(the `idempotent`/`conflict` vocabulary is a store-direct posture, documented as such);
(c) name the steering-registered restriction explicitly: either the facade refuses
non-steering runs with a documented `application_*` outcome (a semantics addition —
spend it deliberately and record it against Decision 1), or the command projects the
`no_driver`/`elevated: []` outcome VERBATIM with a contract-level honesty note that the
ordinary end-of-task elevation currently elevates only for steering-registered runs;
(d) pin the ordering hazard in WS-01 (elevate before any settlement/cleanup reap, and
assert `elevated ≥ 1`). If the operator wants the wrapper key to mean something, that
is a kernel rung (Non-goals correctly forbid it here).

### Decision 8 — `run.board.post` / `run.board.read` — **HOLE (blocker #6-adjacent → amendment: missing append-gate; plus two notes)**

The binding law is verified verbatim at the seam (mismatch :13933-13936, run-closed
:13937-13940, adoption :13987 region, replay derivation :8330-8346 with no lease field,
public `boardSnapshot().runId` :14258-14270, the orchestrator-direct-post precedent
:10847-10850). Three problems:

1. **The S-2 law's atomicity half is not projected.** `admitBoardCommand`'s contract is
   "the final fence/parent compare is repeated by the append's before-write gate, so no
   adapter-side check-then-write window exists" (:13876-13879); `postBoardItem` accepts
   an `appendGate` (:14028) for exactly this. Decision 8 implements the binding and
   run-closed checks as facade PRE-checks against a snapshot and then calls
   `postBoardItem` with no gate — reintroducing the check-then-write window the seam
   forbids. Single-process sync execution makes the window small but
   implementation-dependent (one `await` between check and post opens it). **Fix:** the
   facade passes an `appendGate` re-validating binding + run-open at append time;
   FP-11 gains a race row.
2. The replay envelope is under-specified (citation §1.2.4): `postBoardItem`'s
   `idempotent` return has no `boardRunBinding`; the facade must derive it from the
   returned prior event's `payload.boardAdmission` (which the return does carry) —
   write that derivation into the decision, mirroring :13985-13990.
3. The run-closed derivation needs a named accessor: the seam reads private run state
   (:13937-13940); the facade needs the public equivalent (the store's `snapshot()` is
   the delegated read, coordinator :754) — name it, or the implementer will invent one.

The adoption idempotency-key design (`run.board.post:<runId>:<board>:<digest>`) is
sound — cross-principal same-content posts dedup to the same item, which is the
content-addressed intent.

### Decision 9 — `run.knowledge.seed` — **HOLE (blocker #3 — the refusal vocabulary is wrong)**

Lane mechanics verified (content-addressed default id :15634-15638, key replay with
`knowledge_node_conflict` on digest mismatch :15625-15628, reserved fields :15166,
horizon membership by `runId` :10436-10437 ✓, times optional ✓). Four errors:

1. **Wrong codes for the two reachable state-dependent refusals.** Decision 9, the
   refusal vocabulary, FP-13, and Decision 10's `stateFailureCode` amendment all claim
   a stale `coordinationSeq` or unknown `artifactId` surfaces `invalid_evidence`. The
   lane throws **`temporal_incoherence`** for a future/missing `coordinationSeq` and
   **`missing_evidence`** for an unknown `artifactId`
   (`coordination-store.mjs:15185` and `:15187`
   respectively); `invalid_evidence` covers only malformed refs (neither key, or a
   non-array, :15182/:15188). `_knowledgeFailure` passes codes through unchanged
   (:15161-15163). Consequence: FP-13's oracle pins codes the lane
   never throws for those inputs, and Decision 10's amendment omits both real codes —
   a stale-evidence seed through MCP surfaces as `command_outcome_unknown`, the exact
   failure Decision 10 exists to prevent. **Fix:** correct the vocabulary everywhere
   (Decision 9, refusal section, FP-13) and add `temporal_incoherence` +
   `missing_evidence` to the `stateFailureCode` amendment list.
2. **The verified-requires-evidence rule is Finding-specific** (:15208 —
   `type === 'Finding' && grounding === 'verified'`). Decision 9's "a verified seed
   REQUIRES a non-empty evidence" generalizes it to all 18 remaining types — narrower
   than the lane (a verified Constraint seed without evidence is lane-legal), a
   Decision 1 violation. **Fix:** mirror the Finding-scoped rule identically; FP-13
   pins a verified Finding.
3. `result: 'added'` is facade-invented (the fresh-add return has no `result` field,
   :15631-15632) — fold into the Decision 1 carve-out.
4. `missing_endpoint` is listed as propagating but is **unreachable** through the
   closed shape (it fires only for `Decision.informedBy` non-liveness or a promotion
   trigger; the facade refuses `Decision` at validation and `promotion` is null,
   :15204-15208). Dead listing — harmless, but delete it or mark it defense-in-depth.

The content-key design is otherwise verified sound: identical content → same key →
`idempotent`; distinct content → distinct node; `duplicate_node`/
`knowledge_node_conflict` genuinely unreachable through the content-derived key, as the
contract says.

### Decision 10 — MCP projections — **HOLE (blockers #3 and #4 land here)**

The six-tool mechanics are all verified SOUND (closed schemas, `_meta`, CAPABILITY,
guards, connection-principal dispatch, EXPLICIT membership, STATEFUL/RECONCILABLE
posture, quota, no lease/sessionAuthority fields — FP-14's self-naming refusal rides
`additionalProperties: false` ✓). Two holes:

1. The `stateFailureCode` amendment list is built on Decision 9's wrong vocabulary —
   add `temporal_incoherence` and `missing_evidence` (blocker #3).
2. **The board carve-out bakes in the #93 discovery contradiction and overclaims the
   MCP story (blocker #4).** Verified live: the default surface serves 27 of 78 tools;
   the `baton_board_*` family is combined-only. Worse, the family requires the S-2
   `sessionAuthority` lease proof — `admitBoardCommand` fails `board_lease_required`
   when `envelope.sessionAuthority == null` (`coordination-store.mjs:13937-13938`), and
   descriptor-driven MCP principals carry no `sessionAuthority`
   (`mcp-northbound.mjs:1808-1810` maps it from `principal.sessionAuthority ?? null`;
   the descriptor principal shape is `{userId, sessionId, capabilities, repoIds}`).
   So a stock MCP client cannot post OR read a board through either the default
   surface (invisible — #93) or the combined surface (no lease). Decision 10's
   rationale "MCP-driven workflows use `baton_board_post`/`baton_board_read`" is true
   only for lease-holding combined-surface hosts — and Decision 13 steps 1/7 annotate
   "MCP equivalent: `baton_board_post`/`baton_board_read`" with none of that. The six
   new ordinary tools are a genuine partial ANSWER to #93 (default surface 27→33, and
   the newly-projected lanes land exactly where #93's sibling note said they gate);
   the board posture is a defensible deferral to the packaging epic — but the
   acceptance text must stop claiming an MCP equivalent for board steps or annotate
   the combined-surface + lease precondition. As written, WS-01's "or talks MCP" and
   WS-02's facade-or-MCP disjunction cannot fail on the gap, which is exactly the
   class of false-green this rung's acceptance exists to exclude.

### Decision 11 — CLI verbs + registry rows + regeneration — **SOUND** (three notes)

Mechanism verified: the new nouns (`message`, `attention`, `scratchpad`, `board`,
`knowledge`) are absent from `lifecycleActions` (:1357-1360), so today
`baton run message …` falls through to `parseStart` and is silently parsed as a
run-start objective — the per-noun early branches (the `start` precedent :1354-1356)
are mandatory, and FP-16's "unknown sub-verb → parse error, not a run-start objective"
is the load-bearing pin ✓. Regeneration order and counts (+8/+8/+6) check against
:624-627. Notes: (a) legacy `baton run send` survives as a `semantic-action`
(`application-cli.mjs:1514-1530`, registry :809/:871/:1274) — two send spellings with
different arg shapes and different parse-result kinds will coexist; not a conformance
break, worth one sentence in CLI.md prose; (b) `baton run follow` already refuses
`cli_command_unavailable` (:1351-1353), so no legacy-follow user meets the new noun;
(c) acknowledge the pre-existing unwired `run.scratchpad` registry row
(`application-semantics.mjs:1330-1338`) in the row additions to forestall a
duplicate-accessor review fight.

### Decision 12 — frame-economics honesty (#89) — **SOUND** (one gap, already counted)

Every table row verified against its cited authority (message 2,048 :6597-6599;
entryIds ≤128/:480/:473; page ≤64 :10402; leaf ≤4,096 :300/:53; board 160/4,096/≤8
:396-399; view 512/256 KiB :60-61; seed 4,096 `validText` :289-291; the 20,480 window
stays substrate :448-455 ✓). The example refusal text names cap+actual per #89's
admitted-refusal law; the missing graceful-path leg is honestly deferred to #89's
limits-registry rung (Non-goals) — acceptable, since #89's own text makes spillover
that rung's work. Nothing contradicts the shape-only-scanner law: all caps are enforced
at facade admission, never at the wire scanner (C0b pin untouched). Two honest
blemishes: the missing scratchpad-page serialized-total row (blocker #5), and the
seed-body 4,096 being a genuinely NEW surface cap on an uncapped lane — the contract
discloses it (Decision 9 + OQ-7) but the "no new caps are invented" sentence is then
not literally true; reword to "no new LANE caps; one disclosed surface cap (OQ-7)."
FP-17's "validators contain ONLY the cited constants" static assertion is gameable in
the small (a validator can alias any constant), but the at-cap/cap+1 rows carry the
real weight — acceptable.

### Decision 13 — the scripted-workflow property — **HOLE (blockers #1/#2/#4/#6 land here)**

Walked as an implementer; the sequence IS closed for the facade/CLI path:

1. Seed board + knowledge — `run.knowledge.seed` ✓, `run.board.post` ✓ (facade/CLI).
2. `waves.start` ✓ existing (:12095; tool :456-472).
3. `run.message.send` query ✓ (Decision 3 sound).
4. Replies via the landed #86 grammar; `run.message.receipt` ✓ (Decision 4 sound).
5. `run.attention.watch` ✓ + `run.answer` (exists: CLI parse :1500-1514,
   `CLI_WEB_COMMANDS` :21, `baton_decision_answer` :507-518). Embedded driver
   self-names `wave-owner` — authority established ✓. The "answered, not awaited"
   framing is honest (no `decision_pending` wake kind — verified no mint sites).
6. `run.scratchpad.elevate` — **closed only for steering-registered (wave) runs, and
   only before any reap** (blockers #1/#2). The fence question the brief poses — "who
   holds the elevation fence at step 6?" — is answered well by the lane: the wrapper
   derives `expectedScratchpadFence` live (:10236-10238), no caller-held fence; a race
   surfaces as `stale_scratchpad_fence`, honest. The entryIds source is closed: a
   `worker:<id>`-scoped `run.scratchpad.read` (Decision 6's shape admits it) lists the
   partition before terminal + elevate.
7. `run.scratchpad.read` shared + `run.board.read` ✓ (facade/CLI).
8. `waves.attach` ✓ existing (`MCP.md:74-82`).

But the acceptance as written is not satisfiable end-to-end through MCP (blocker #4:
boards invisible + lease-gated; attention needs an orchestrator-named principal;
answer/send/elevate/seed need `approve`/`control` the default principal lacks), the
step-6 elevation can silently no-op (blockers #1/#2), and **WS-01's static assertion
is gameable (blocker #6)**: the assertion bans `createDriver`/`coordinator.mjs`/
`coordination-store.mjs` IMPORTS, but `BatonApplication.driver` is a PUBLIC field
(`application.mjs:2326`), so a script importing only the facade can reach
`application.driver.coordination.addKnowledgeNode(...)` / `.coordinator.sendMessage(...)`
with zero imports and pass. (The deployment wrapper hides them —
`BatonDeployment`'s `#application`/`#driver` are private,
`application-deployment.mjs:1176-1196` — but the red-first section drives
`f.application.command(...)`, the raw facade.) Dynamic `await import()` of the kernel
paths is caught only if the assertion greps path strings (make that explicit); the
recipes path (`baton.recipes`, RC-A) is data-driven through the facade and is not a
backdoor. **Fix:** extend the static ban to `.driver` / `.coordinator` /
`.coordination` member access in the demo script (or mandate driving through
`BatonDeployment`/MCP only), pin the grep form, and adopt the Decision 7 oracle fixes
(`elevated ≥ 1`, retry → `empty`).

---

## 3. Acceptance-pin audit (attack surface 7)

Strong rows: FP-01 (dispatch + shape closure), FP-02 (fixture-identical outcome),
FP-04 (the identity row — deep-equal at every transition; tolerate the `messageId`
echo via the D1 carve-out), FP-05 (null unreachability), FP-06…FP-08 (D1/D2/D3/D4
through the facade — FP-07 correctly improves on the blue-team's VACUOUS D2 by
requiring a candidacy to exist, "even when one exists… count ≥ 1"), FP-14 (closed
schemas refuse self-named principal — real), FP-16 (parse-error pin — load-bearing),
FP-18/FP-19 (kernel-diff and settlement-plane pins — well-formed).

Weak/staged-wrong rows:

- **FP-03** — stub must refuse null scope too (§Decision 3 note); as written,
  staged-wrong risk against a correct implementation.
- **FP-09** — no page-total-bytes pin (blocker #5).
- **FP-10** — staged-wrong middle clauses (blocker #2): `idempotent` replay and
  `scratchpad_settlement_conflict` are unreachable through the wrapper; and no
  `elevated ≥ 1` pin (blocker #1), so the silent no-op greens it.
- **FP-11** — sound, but add the append-gate race row (Decision 8 fix 1) and pin the
  replay `boardRunBinding` derivation (fix 2).
- **FP-13** — pins the wrong refusal codes (blocker #3): stale seq →
  `temporal_incoherence`, unknown artifact → `missing_evidence`; "a verified seed" must
  name a Finding.
- **FP-15** — add the orchestrator-principal descriptor row (blocker #4) or the
  attention codes never appear at the wire for a stock deployment.
- **WS-01** — gameable static assertion (blocker #6); no `elevated ≥ 1` effect pin
  (blockers #1/#2); "or talks MCP" unsatisfiable as written (blocker #4).
- **WS-02** — the facade-or-MCP disjunction mechanically cannot catch the MCP board
  gap (blocker #4); make the board steps facade/CLI-pinned explicitly.

## 4. The follow→watch rename (attack surface 3) — LAWFUL

Verified the full machinery: `follow` is banned (`surface-conformance.mjs:196-199`);
the lint scans keys + derived surface names only (:710-718) — legacy ALIAS rows are out
of scope, which is why `['run.watch','application.commands','run.follow']`
(`application-semantics.mjs:1775`) coexists with a green C4 today; the `run.watch`
canonical precedent is real (:1253-1258); all new verbs/nouns are C4-clean; the CLI
already refuses `baton run follow` (:1351-1353); the S-1 grammar's semantic-action
`run.send` (:809) is a different layer and does not collide. The coordinator method
keeping the name `attentionFollow` is internal, not a surface verb — no collision. Open
Question 1's "spend no lint exception" is the right call; the `waves.progress`
carve-out pattern (:710-718) exists if a later rung wants the literal spelling.

## 5. The board MCP decision vs #93 (attack surface 6) — verdict

The six new ordinary tools ANSWER #93 for their lanes (default surface 27→33; #93's
own sibling note says #87's projections gate on exactly this question). The board
carve-out BAKES IN the contradiction for boards: invisible on the default surface
(#93, verified live) AND lease-gated on the combined surface
(`board_lease_required`, :13937-13938) — so "MCP board coverage already exists"
(ground truth 11) is true only for lease-holding hosts, and Decision 13's
"MCP equivalent: `baton_board_post`" is not true for the MCP-first operator the
operator's law targets. **Verdict: the deferral itself is not fold-blocking (an
ordinary-plane duplicate of the S-2 seam IS a red-team magnet; the packaging epic owns
the ordinary-surface board question), but the contract's acceptance text is
fold-blocking as written** — it claims an MCP equivalent the surface cannot serve
(blocker #4). Fix the text, not the posture.

## 6. The 8 open questions (attack surface 8)

1. **follow→watch lint exception** — SAFELY DEFERRED (§4; no exception spent).
2. **Long-poll `timeoutMs`** — SAFELY DEFERRED (verified destructured-unused, :6694;
   lane-first is the right order; the MCP frame budget is the named cap).
3. **Sealed-run sends** — SAFELY DEFERRED (the lane answers via liveness; the facade
   adds nothing; #75/#89 own the lane question).
4. **Reply-lane admission bound** — SAFELY DEFERRED (inherited honestly; #89's rung;
   the asymmetry is real and correctly not papered over).
5. **Optional `board` default** — SAFELY DEFERRED (verified: no public run→boards
   projection exists; the only convention is `wave-settlement:<waveId>`,
   `coordinator.mjs:10775`; the required-`board` deviation is evidenced).
6. **REPL binding orchestration** — SAFELY DEFERRED (owner named: the REPL epic per
   the #69 evidence; #48 honestly stays open).
7. **Knowledge seed body bound** — DEFERRED BUT MISLABELED: it is a new SURFACE cap on
   an uncapped lane; the contract's own "no new caps are invented" sentence needs the
   rewording in Decision 12 (above). Not fold-blocking once relabeled.
8. **Fence-pinned cursors + mid-flight elevation** — DEFERRED, BUT THE FRAMING IS
   WRONG and must be corrected with blocker #1: the landed distinction is not
   "terminal-task vs mid-flight" — it is "steering-registered runs honor the selection
   (any time); all other runs discard it (always)" (:13621-13627). The open question
   should ask whether the ORDINARY (non-wave) elevation path should ever honor a
   selection, not only whether mid-flight should surface.

## 7. #89 interaction (attack surface 9)

The cap+actual refusal shape matches #89's admitted-refusal law (Decision 12's example
text names both numbers); the graceful-path leg is explicitly and honestly deferred to
#89's limits-registry rung, consistent with #89's own rung split. No cap contradicts
the shape-only-scanner law — all enforcement is at facade admission; the C0b wire pin
(:434) and the 20,480 substrate window (:448-455) are untouched. The two blemishes:
the scratchpad-page serialized-total gap (blocker #5) and the seed-body cap being a
new surface cap wearing an "idiom" label (§6.7). The #89-named sin (bare TypeError
over 2,048 bytes) is correctly NOT fixed here and correctly never reaches a caller
through facade validation.

---

## 8. Final verdict: **NOT FOLD-READY** — 7 blockers

1. **Decision 7 / FP-10 — the elevation lane misread (semantics).**
   `coordination-store.mjs:13627` discards `entryIds` for non-steering-registered runs;
   the projected command returns `ok: true, result: 'settled', elevated: []` while
   doing nothing, outside wave runs. Fix per §2 Decision 7 (c/d): name the restriction
   or project the `no_driver` outcome with an honesty note; pin `elevated ≥ 1`.
2. **Decision 7 / FP-10 — the elevation retry law is staged-wrong.** Store dedup is
   fence-bound (:13549); the wrapper re-derives the fence live and its
   `scratchpad.task_settlement:<taskId>` key (:10240) is never consulted by the store;
   through the projected path an exact retry returns `result: 'empty'`, and
   `idempotent`/`scratchpad_settlement_conflict` are unreachable. Rewrite the outcome
   table + FP-10 to the live-fence truth.
3. **Decision 9 / Decision 10 / FP-13 — wrong refusal codes + incomplete wire
   mapping.** Stale `coordinationSeq` → `temporal_incoherence`, unknown `artifactId` →
   `missing_evidence` (:15185/:15187), not `invalid_evidence`; the `stateFailureCode`
   amendment omits both, so the rung's headline property (refusal constancy to the
   wire) fails exactly where pinned. Also scope the verified-requires-evidence rule to
   Finding (:15208).
4. **Decision 10 / Decision 13 / WS-01 / WS-02 — the MCP path of the acceptance is
   unsatisfiable as written.** Boards: combined-surface-only (#93, verified 27/78) AND
   S-2-lease-gated (:13937-13938). Attention: lane authority admits only
   `principalId === 'wave-owner'` or a lease (:6735-6755); MCP principals are
   descriptor `userId`s (default `'descriptor-host'`). Answer/send/elevate/seed need
   `approve`/`control`; the default principal is observe-only
   (`mcp-descriptor.mjs:186-189`). Scope the "or talks MCP" disjunction and the
   "MCP equivalent" annotations, and pin the principal/capability preconditions in
   FP-14/FP-15 + MCP.md prose.
5. **Decision 6 / Decision 12 / FP-09 — the scratchpad read page has no serialized
   budget.** 64 × 4,096-byte leaves ≈ the 256 KiB MCP frame plus envelope, with no
   explicit truncation story (contrast `MAX_BOARD_VIEW_BYTES` :60). Add the cap row +
   truncation marker + pin.
6. **WS-01 — the no-kernel-import assertion is gameable.** `BatonApplication.driver`
   is a public field (:2326); a facade-only script reaches
   `application.driver.coordination`/`.coordinator` with zero imports. Extend the
   static ban to `.driver`/`.coordinator`/`.coordination` member access (or mandate
   `BatonDeployment`, whose fields are private, `application-deployment.mjs:1176-1196`)
   and pin the grep form (path strings, catching dynamic `import()`).
7. **Citation hygiene (the charter's automatic blocker).** Five anchors wrong or
   imprecise AT AUTHORING TIME (§1.2): `KNOWLEDGE_NODE_TYPES` is 19 types, not 20
   (:140, both revisions); the `createDriver` import is `demo.mjs:14`, not ":1-13";
   `mcp-descriptor.mjs:47-48` carries no settlement-capability logic (enforcement is
   `mcp-northbound.mjs:104` + `_authority`); the Decision 8 replay-envelope citation
   points at the fresh-post branch (replay is `:13985-13990`/`:14029-14030`);
   `MCP.md:83-89` should be :74-82. The ground-truth-9/12 line drift is `0eae749`
   worktree movement AFTER authoring — verified correct in the `9ec8e97` blob — and is
   explicitly exonerated (re-anchor at fold time); it hid nothing the contract had
   right, and blocker #1's line sat inside the contract's own cited window pre-shift.

Required amendments (non-blocking but expected in the fold): Decision 1's
projected-domain + envelope-completion carve-out (§2 D1); Decision 8's `appendGate`
and replay-derivation specification (§2 D8); FP-03's null-scope stub pin (§2 D3);
Decision 11's legacy-`run.send` coexistence sentence + `run.scratchpad` row
acknowledgment (§2 D11); Decision 12's "no new LANE caps" rewording (§6.7);
`missing_endpoint` de-listing (§2 D9.4).

What is NOT a hole (explicitly cleared): the follow→watch rename (§4); the direct-port
placement and recursive-gate rationale; the message send/receipt projections (D3/D4
sound); the CLI/conformance regeneration mechanics (D11 sound); the #89 cap table
(verified row by row); the board binding-law semantics themselves (verified verbatim
at the seam); the six tools' MCP mechanics (verified); the embedded facade/CLI
closure of the eight-step sequence (blocked only by the elevation misread at step 6
and the WS-01 pin quality, not by a missing command).
