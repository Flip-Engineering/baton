# Blue-team: workflow-surface red suite (#87+#48) — adversarial verification

(Target: `impl/test/workflow-surface-red.test.mjs` — 37 rows: FP-01 ×5, FP-02…FP-05 ×4,
FP-06…FP-08 ×3, FP-09 ×3, FP-10 ×4 (incl. 1 guard), FP-11 ×4 + FP-12, FP-13 ×2,
FP-14 ×2 + FP-15 + FP-19 (guard), FP-16 ×3 (incl. 1 guard), FP-17, WS-01/WS-02, FP-18.
Verified against the v2.1 post-fold contract
`docs/reference/evidence/facade-projection-2026-08-03/facade-projection-contract.md` +
`contract-fold.md`, and `impl/src/` ground truth in the 2026-08-04 worktree
(NUL-containing files — coordinator.mjs, coordination-store.mjs, application.mjs —
inspected via `grep -an`/`sed -n` only). Suite run from repo root:
`node --test impl/test/workflow-surface-red.test.mjs`, node v25.8.0.)

Verdict scale: **SOUND** = red for the named stage today, green only on a contract-correct
implementation, and a wrong implementation cannot pass it. **WEAK** = correctly staged and
discriminating in composition, but a named wrong implementation can pass it (false-green
hole). **VACUOUS** = passes without exercising the named behavior. **STAGED-WRONG** = the
row's red/green state does not track the named contract behavior.

## 0. Run record (exact counts)

```
ℹ tests 37
ℹ pass 3
ℹ fail 34
ℹ duration_ms 18315
```

Passing (the 3 guards): FP-10-store-direct, FP-19, FP-16-conformance. Failing (the 34 red
rows): everything else. **The measured 34 red / 3 green split matches the declared split
exactly — no divergent test, reconciliation trivial.** Every red row fails AT its named
stage, none earlier (fixture bug) or later:

| Stage named by the row | Rows | Observed failure |
|---|---|---|
| Facade ports absent (`application_command_unavailable`) | FP-01 ×5, FP-02, FP-03, FP-04, FP-05, FP-06, FP-07, FP-08, FP-09 ×3, FP-10-happy, FP-10-retry, FP-10-constancy, FP-11 ×4, FP-12, FP-13 ×2 (23 rows) | `Error: unsupported application command <name>` / `code: 'application_command_unavailable'` at the row's first facade call or dispatch assertion (assertion text where reached: "stage: run.message.send must dispatch as a direct port" etc.) |
| MCP tools absent | FP-14-tools, FP-14-dispatch, FP-15 | `baton_run_message_send joins the ordinary application surface (27 → 33)` / `isError` true on the first wire call / the row's own stage assert (verified live: `mcpApplicationToolNames()` = 27, `mcpCombinedToolNames()` = 78, zero `baton_board_*` on the application surface) |
| CLI verbs + registry rows absent | FP-16-parse, FP-16-registry | `Error: unexpected argument send` (`cli_invalid`) at the first positive parse; `registry row run.message.send exists` |
| Validators absent | FP-17 | at-cap send reaches `application_command_unavailable`, not the policy seam (`application_unauthorized`) — the port's absence subsumes the validator's |
| Workflow needs kernel reaches | WS-01 | `application_command_unavailable` on `run.knowledge.seed` at script step 1 — AFTER the static assertion passes and after `run.start` succeeds, so the failure is exactly the missing surface |
| Steps unserved | WS-02 | `step 1-seed-knowledge resolves to a served CLI verb (run.knowledge.seed)` |
| Accessor absent (guards green first) | FP-18 | byte-stable-table and D5 guards pass, then `typeof messageRunId !== 'function'` |

No fixture bugs observed in the red half's staging: the 23 facade-absent rows fail on the
dispatch seam they name, and the guard rows' green is legitimate already-implemented
behavior (§2). **Two fixture bugs exist in WS-01's FUTURE-GREEN path** — they do not affect
today's red staging (WS-01 fails at its named stage) but make the row ungreenable by a
contract-correct implementation (BLOCKERS 1 and 2).

## 0.1 Hermeticity

**Fully hermetic.** All fixtures are a real `createDriver` stack over `mkdtempSync` git
repos (`git init` + empty base commit, local) with `ScriptableAdapter`/`MockAdapter` fakes —
no network, no provider, no clock oracles (the one `until()` poll is a bounded reaching
mechanism on durable predicates, never the assertion). MCP rows run `McpFleetServer`
in-process over a mock or real facade. The conformance guard execs
`node impl/scripts/surface-conformance.mjs` locally. Artifacts clean up via `test.after`.
The only environmental dependency is a local `git` binary.

## 1. Coverage map (contract clause → enforcing test)

### Decision 1 — projection law (reach, never semantics) + v2.1 carve-out
- Verbatim outcomes + envelope-only addition (`schemaVersion: 1`) → **FP-02** (key-set equality modulo the marker), **FP-03** (outcome `deepEqual`), **FP-06** (page key-set closure + lane byte-identity), **FP-09-constancy** (no invented refusal — unknown run serves the lane's honest empty snapshot)
- Envelope completions, each enumerated: `messageId` echo (D4) → **FP-04**; `nextCursor`/`truncated` (D6) → **FP-09-read/-budget**; replay `boardRunBinding` (D8) → **FP-11-retry**; `result: 'added'` (D9) → **FP-13-happy**
- Recorded subtractions: deployment-scope non-projection (D5) → **FP-01-attention** (`{runId: null}` refused); `Decision` enum subtraction (D9) → **FP-01-knowledge**
- No smuggled semantics → **FP-18** (byte-stable table guard + pre-gate dispatch + single permitted kernel addition)

### Decision 2 — eight direct ports; `watch` not `follow`
- Dispatch as direct ports with closed normalizers → **FP-01 ×5** (REFUSE_ALL staging proves validation precedes the policy seam)
- Ahead of the recursive-session gate → **FP-18** (sessionAuthority context: the commands' own `application_*_invalid` codes, never `run_orchestrator_command_forbidden`; the lease holder pages)
- `follow` banned, no `run.attention.follow` row → **FP-16-registry** (+ `BANNED_SURFACE_VERBS` verified at `impl/scripts/surface-conformance.mjs:197`)

### Decision 3 — `run.message.send`
- Closed shape/XOR/enum/2,048-byte cap → **FP-01-message**, **FP-17** (cap+actual)
- Steer-idiom authorization, unknown ≡ foreign constant → **FP-03** (incl. the §8 null-scope stub amendment)
- Lane outcomes verbatim → **FP-02**, **FP-03**

### Decision 4 — `run.message.receipt` + the one kernel accessor
- Identity row at five transitions → **FP-04**
- Resolve-then-authorize constancy, lane `null` unreachable → **FP-05**
- `messageRunId` accessor (resolves run; unknown → null) → **FP-18**
- **Dead-handle resolve-to-null (Decision 4 note(b), §8 amendment) → NO ROW** — FP-05's comment claims it; nothing stages a dead worker handle (BLOCKER 4)

### Decision 5 — `run.attention.watch`
- Shape-only kind closure, `timeoutMs` not projected, bare scope not projected → **FP-01-attention**
- Scope-first constancy byte-identical to the lane → **FP-06**; candidacy disclosure gating → **FP-07**; coalescing/`terminal-at-mint`/cursor chains → **FP-08**
- Transport authority: default MCP principal refuses `attention_scope_forbidden` AS ITSELF; orchestrator-named descriptor row pages → **FP-15**; lease-holder review authority through the facade → **FP-18**

### Decision 6 — `run.scratchpad.read`
- Closed scope pattern/cursor → **FP-01-scratchpad**; ≤64 entries, `{entryId, kind, text}` closure, ≤4,096 leaves, `UNTRUSTED_SCRATCHPAD` frame, fences verbatim, offset paging, NON-EVENTED → **FP-09-read**
- 256 KiB serialized budget + digest-citation truncation + honest continuation → **FP-09-budget** (the suite's `digest()` verified byte-identical to the store's `canonicalDigest`, coordination-store.mjs:184,193)
- Policy-seam constancy → **FP-09-constancy**; CAS deliberately not projected (`scratchpad_cursor_stale` unmapped) → **FP-15** static
- **The `frame`/`digest` FIELD NAMES are suite inventions** — Decision 6's enumerated response shape (`{schemaVersion: 1, runId, scope, scratchpadFence, observedSeq, entries, nextCursor, truncated}`) names neither (BLOCKER 3)

### Decision 7 — `run.scratchpad.elevate`
- Closed entry shape (≤128 unique `scratchpad-entry:<64 hex>`) → **FP-01-scratchpad**, **FP-17**
- Steering-registered ceremony with `elevated ≥ 1` → **FP-10-happy** (the `spawnMember` fixture's `steering.registered` record verified faithful to application.mjs:4424-4433 + the store gate at coordination-store.mjs:13827-13833 — probe-verified end-to-end: `waves.start` → wrapper elevate → `settled`, `elevated: 1`)
- Fence-bound retry law: wrapper retry → `empty` (never `idempotent`); post-reap degrade → `empty` → **FP-10-retry**; store-direct `idempotent`/`conflict` pair → **FP-10-store-direct** (guard, mirrors `scratchpad-33-red.test.mjs:600-604`)
- Resolve-then-authorize (unknown ≡ cross-run ≡ foreign) + lane code byte-identity → **FP-10-constancy**
- `stale_scratchpad_fence` race and `scratchpad_partition_exhausted` → **no behavioral row** (static mapping only, FP-15; a true race and a 512-entry staging — acceptable notes)

### Decision 8 — `run.board.post` / `run.board.read`
- Closed shapes, `board` required → **FP-01-board**, **FP-17**
- Binding law verbatim (one constant before existence; unbound+empty; unbound-with-items serves; adopt vs bound; durable admission record, `leaseId: null`) → **FP-11-binding**, **FP-11-adopt**
- Idempotent retry with DERIVED replay `boardRunBinding`; `application_board_run_closed` → **FP-11-retry**
- appendGate race row (S-2 no-check-then-write-window) → **FP-11-race** (structural — §4 flag F3)
- Read view = `projectBoardView` exact output, NON-EVENTED, dual-fence freshness → **FP-12**

### Decision 9 — `run.knowledge.seed`
- Closed shape incl. Finding-scoped verified-requires-evidence mirrored EXACTLY (the verified-Constraint positive control) → **FP-01-knowledge**
- Content-addressed identity inside the horizon, idempotency law, key-derivation defense-in-depth → **FP-13-happy**
- TRUE evidence codes byte-identical (`temporal_incoherence`/`missing_evidence`, never `invalid_evidence`) → **FP-13-codes**, and to the wire → **FP-15**

### Decision 10 — MCP projections
- Six tools, closed schemas, `_meta` digest, annotations, no banned wire fields, no `baton_run_board_*` → **FP-14-tools**; dispatch with connection-derived principal, self-naming schema-refused, capability-class preconditions → **FP-14-dispatch**
- Refusal constancy to the wire + the complete `stateFailureCode` re-enumeration + `ORDINARY_EXPLICIT_TOOLS`/`STATEFUL`/`RECONCILABLE` placement → **FP-15** (the live mapping at mcp-northbound.mjs:187-240 verified to contain NONE of the 17 named codes today; `scratchpad_cursor_stale` correctly absent from the assertion)
- Settlement plane untouched → **FP-19** (guard)
- The per-tool `invalid_*` guard codes are asserted only as `isError: true`, never as their named codes (minor flag T7)

### Decision 11 — CLI verbs + registry rows + conformance regeneration
- Nine spellings → command dispatches; XOR at CLI; unknown sub-verbs are parse errors → **FP-16-parse** (see §4 flag F6 — the header's "falls through to parseStart" mechanism claim is stale)
- Eight registry rows (profile/surfaces/capabilities/idempotent/derived names) + `CLI_WEB_COMMANDS` + `servedCliOrdinaryKeys()` → **FP-16-registry**
- Regeneration enforcement → **FP-16-conformance** (guard)
- Legacy `baton run send` coexistence prose + the unwired `run.scratchpad` row acknowledgment → **no row** (docs-prose only; harmless — `checkSurfaceDocs` covers generated blocks, not prose) (note)

### Decision 12 — frame-economics honesty (#89)
- Cap table: message body / entryIds / board title / board detail / board evidence / seed body → **FP-17** (at-cap admitted to the policy seam; cap+1 names BOTH numbers)
- Render bounds (≤64/≤4,096/256 KiB page) → **FP-09-read/-budget**; board view bounds via the renderer `deepEqual` → **FP-12** (bounds themselves not oversized-tested — the renderer is landed and pinned elsewhere) (note)
- Char-vs-byte honesty at the wire (€×1,025 → names 2048 AND 3075) → **FP-15**

### Decision 13 — scripted-workflow property
- **WS-01** (static assertion + live eight-step sequence) and **WS-02** (mechanical step→command map, board steps facade-explicit). The static assertion carries the full v2.1 ban list — `createDriver`/`coordinator.mjs`/`coordination-store.mjs` imports, dynamic `import()`, AND `.driver`/`.coordinator`/`.coordination` field-reach — and passes today. **The live sequence's future-green path is broken at two points** (BLOCKERS 1 and 2).

### §8 amendments (contract-fold.md "Required amendments")
D1 carve-out ✓ (rows above); D8 appendGate ✓ (FP-11-race); FP-03 null-scope stub ✓
(verified at :542); D11 coexistence notes — prose-only, no row (note); D12 rewording ✓;
`missing_endpoint` de-listing ✓ (FP-15 static); **D4 note(b) dead-handle — NO ROW
(BLOCKER 4)**; OQ-8 reframe — n/a (open question).

### Refusal vocabulary (per the contract's table)
Every facade `application_*_invalid` code has a closure row (FP-01 ×5) + cap+actual rows
(FP-17); `application_unauthorized` constancy ×4 rows; attention family byte-identity
(FP-06; `attention_scope_invalid`/`attention_target_invalid` are unreachable through the
facade's own shape closure — static mapping only, FP-15; acceptable); board constants
(FP-11 ×3); lane codes (FP-10-constancy, FP-13-codes); lane outcomes (FP-02/03/10/11/13);
`scratchpad_settlement_conflict` store-direct-only (FP-10-store-direct + FP-10-retry's
`notEqual idempotent`); MCP wire `forbidden` (FP-14-dispatch), families AS THEMSELVES
(FP-15); CLI `cli_invalid` (FP-16-parse). **Untested:** the six per-tool `invalid_*` guard
codes by name (T7); `stale_scratchpad_fence` and `scratchpad_partition_exhausted`
behaviorally (notes above).

## 2. Per-guard verdicts (false-green hunt)

- **G1 · FP-10-store-direct — SOUND.** Green for the right reason: it drives the real
  store lane (fence-bound `reapKey` dedup at coordination-store.mjs:13786; same-fence
  replay → `idempotent` with the prior `reapEventSeq`; changed selection under the same
  fence-pinned key → `scratchpad_settlement_conflict`), mirroring
  `scratchpad-33-red.test.mjs:600-604`. A regression of the fence-bound dedup fails it; a
  wrapper-only change cannot touch it. Its contract role — the contrast to FP-10-retry's
  wrapper `empty`-retry law — is exactly what a guard pin is for.
- **G2 · FP-19 — WEAK (vacuous half today, by construction).** The settlement half is
  SOUND and live: `baton_knowledge_promote` without the envelope → `board_lease_required`;
  `baton_knowledge_settlement_lease` without the `settlement` class → `forbidden`; the
  `baton_board_*` family verified combined-only (`mcpCombinedToolNames()` includes them,
  `mcpApplicationToolNames()` does not). But the six-tool loop is **vacuous today**: the
  tools don't exist, every wire call returns an unknown-tool error — never `forbidden` —
  so the "never demands the settlement class" assertion passes without exercising anything.
  The loop gains teeth only post-implementation. The header declares green-by-construction,
  so this is not staged-wrong; but today the guard's real content is the settlement half
  alone. (§4 flag F5.)
- **G3 · FP-16-conformance — SOUND.** `checkSurfaceDocs() === []` and
  `surface-conformance: ok` verified green in this worktree. Landing tools without the
  Decision 11 regeneration flips both red by construction (the generated blocks and the
  CS-4 artifact are executable projections of the served surface); landing with
  regeneration keeps them green. In composition with FP-16-registry and FP-14 (which pin
  the surface itself), it cannot hide a drift.

No VACUOUS-as-staged and no STAGED-WRONG guards. (G2's caveat is about today's bite, not
about the green being wrong.)

## 3. Teeth check (red rows vs plausible wrong implementations)

The five named wrong implementations from the verification brief:

- **Facade command shelling to the kernel with loose error mapping** → caught: FP-03/FP-02
  (`deepEqual` of the verbatim outcome objects — re-coding or padding fails), FP-06 (lane
  refusal byte-identity: code AND message captured via `laneError` twin), FP-10-constancy
  (lane twin for `scratchpad_settlement_invalid`), FP-13-codes (lane twins for the
  evidence codes), FP-15 (wire-level `doesNotMatch command_outcome_unknown|invalid_command`).
- **Receipt projection reading a cache** → caught: FP-04 compares facade ≡ live lane at
  FIVE transitions (send, same-generation read, process death, respawn, reply) — any lag
  or stale frame fails the identity asserts; FP-12 adds the board analog (post-write
  freshness, the dual-fence law). Minor: `run.scratchpad.read` has no explicit
  post-write freshness leg (T5).
- **Elevation skipping the ceremony** → caught: FP-10-happy asserts `elevated ≥ 1` on a
  steering-registered run — an implementation that never records/needs the registration
  settles with `elevated: []` and fails; WS-01 asserts it live. The reverse error
  (inventing a refusal for the non-steering discard) is caught by the verbatim-outcome
  posture of FP-10-happy/retry.
- **A page without the budget** → caught: FP-09-budget stages 64 × ~4 KiB leaves (256 KiB
  before ids/envelope) and asserts serialized-total ≤ 256 KiB + `truncated: true` + the
  digest citation over the full sorted id set + continuing `nextCursor` — each omission
  fails a distinct assert.
- **WS-01 assertion missing the field-reach class** → not missing: the static assertion
  carries all seven patterns including `/\.driver\b/`, `/\.coordinator\b/`,
  `/\.coordination\b/`, and `/\bimport\s*\(/` (the blocker-#6 fold landed in the suite).
  (Theoretical evasion via computed member access `port['driver']` is out of scope — the
  assertion pins THE script's source, per the contract's pinned grep form.)

Row-level flags (rows a compliant-but-shallow implementation greens):

- **T1 · FP-05 — WEAK (BLOCKER 4).** The row's own comment claims the dead-handle case
  ("a dead-handle worker resolves identically — Decision 4's pinned behavior"), but no
  dead worker handle is ever staged. Decision 4 note(b) (an §8 amendment: a worker-targeted
  message whose handle is gone resolves to NO run ≡ `application_unauthorized`) has no
  oracle: an accessor resolving through durable task records (returning the run; the
  permissive-policy facade then serves the receipt) greens every staged leg.
- **T2 · FP-08 — WEAK (minor).** The coalescing asserts (`perPhase`, `windowMs`, no
  singular `{role, phase}`) fire only `if (reason.count > 1)`. The `until` guarantees a
  total ≥ 2 across reasons, but an implementation emitting two separate count-1 reasons
  (never coalescing) greens those legs. The landed lane coalesces within 500 ms and the
  projection is verbatim, so this bites only a re-implementation; strengthen by requiring
  a single coalesced reason (`some(reason => reason.count > 1)`).
- **T3 · FP-11-race — WEAK (minor).** Structural, not interleaved (§4 flag F3): the gate
  is re-invoked only after a run STOP, so the run-open revalidation is pinned but the
  BINDING revalidation is not — a gate re-checking run-open only greens. The
  check-then-write wrong implementation is caught (no gate → `typeof appendGate` fails).
- **T4 · FP-09-read — the `frame` field name is invented** (BLOCKER 3): a contract-correct
  implementation naming the marker field differently (or folding the marker into the
  envelope otherwise) goes red here.
- **T5 · FP-09-read (minor).** No post-write freshness leg for scratchpad pages (the
  board.read analog exists in FP-12). A cache-keyed page renderer with correct fences
  greens; the contract's "rebuilt per call, never a cached frame" is only implicitly
  covered by the paging rows.
- **T6 · FP-15 (minor).** The static mapping slice depends on `function stateFailureCode`
  and `function protocolResult` literals (verified present at mcp-northbound.mjs:187,241)
  and the Set-literal regexes (verified :116,129,699). Fine today; brittle to a refactor
  that renames the boundary function — acceptable.
- **T7 · FP-14-dispatch (minor).** The forged-field legs assert only `isError: true` — the
  named `invalid_message_send`-class guard codes are never matched. A generic
  `invalid_command` refusal greens. Strengthen: `match(resultText, /invalid_message_send/)` etc.
- **T8 · WS-02 (minor).** The facade legs assert only `notEqual application_command_unavailable`
  — dispatch, not behavior. Correct for a resolution-map row; the behavioral rows live in
  the FP sections. Not flagged further.

All other red rows are SOUND: each fails a named wrong implementation (verified against
the shipped seams cited in §0/§1) and each red stage was confirmed against the source.

## 4. Suite-header flag verdicts (the six the header itself names)

- **F1 · frame/digest field-name inventions — CONFIRMED, drift (BLOCKER 3).** Decision 6
  requires the page to carry the `UNTRUSTED_SCRATCHPAD` marker and a digest citation, but
  its enumerated response shape names neither field; Decision 1's carve-out forbids
  additions beyond its own list. The suite pins `page.frame` (FP-09-read) and `page.digest`
  (FP-09-budget) — reasonable names, but unilaterally invented. An implementer reading the
  contract literally invents different names and goes red on a compliant implementation.
- **F2 · `truncated: false` interpretation — SOUND.** `truncated` IS in Decision 6's
  enumerated shape; `false` on an untruncated offset-paged page is the only honest reading
  of the renderer doctrine (the alternative — omitting the field — would violate the
  enumeration). FP-09-read's "offset paging is not budget truncation" assert is correct.
- **F3 · FP-11-race is structural, not interleaved — CONFIRMED TRUE, acceptable with a
  soft spot.** The row pins the appendGate's existence, singularity (exactly one store
  append), and live run-open revalidation (passes live, throws/false after `stopRun`) —
  the honest way to test a gate without a deterministic race harness. Soft spot: the
  binding-change revalidation half is unobserved (T3).
- **F4 · dead-handle resolve-to-null equivalence — OVERCLAIMED (BLOCKER 4).** FP-05 stages
  unknown-id (both policies) and foreign-message constancy; it never stages the dead
  handle its comment says it pins. Decision 4 note(b) has no oracle (T1).
- **F5 · FP-19's today-vacuous loop — CONFIRMED, by construction (G2).** Vacuous today
  (unknown-tool errors are never `forbidden`), toothed post-implementation. Not a blocker —
  the guard's settlement half is live — but the loop currently provides no signal.
- **F6 · WS-01's `run.status` taskId discovery — VIABLE, shape-dependent (note).**
  Probe-verified on the real stack: for a completed single-member run, the status view
  carries exactly the member's taskId (and `run.debug` members[0].workerId works). The
  walk collects ANY nested `taskId` string and takes the first — unambiguous for WS-01's
  one-task member runs, but it pins nothing about WHICH projection field carries the id;
  a future view carrying multiple taskIds could reorder it. Acceptable for this suite.
  (Separate, REAL WS-01 defects are BLOCKERS 1/2.)
- **F7 (bonus) · FP-16-parse header comment — STALE mechanism claim.** The Section I
  comment says the spellings "fall through to parseStart and [are] silently parsed as a
  run-start objective" today. Verified false: today every new spelling THROWS
  `cli_invalid: unexpected argument <verb>` (loud, not silent), and the unknown-sub-verb
  `assert.throws` pins already pass today. The row is red via its positive legs — staging
  is correct — but the header's mechanism description is wrong, and the negative pins are
  already-green regression guards, not red rows.

## 5. Drift findings (suite header / contract vs shipped code)

Suite-side (verified accurate — implementers can trust the pinned surface):
- The eight facade command names, their closed arg shapes, the six MCP tool names, and the
  nine CLI spellings match the contract's adopted names EXACTLY (Decisions 2/3-9/10/11 —
  including `--worker`, `--task`/`--entries`, `--evidence` JSON, and the XOR target forms).
- Registry expectations match Decision 11 (surfaces `embedded+mcp+cli` vs boards
  `embedded+cli`; capabilities; `idempotent: false` only for `run.message.send`) and the
  annotations match Decision 10 — including the deliberate dual posture for elevate
  (registry `idempotent: true`, wire `idempotentHint: false`: "NOT idempotent on the
  wire"; annotations are hand-set per tool in the shipped table, mcp-northbound.mjs:456-561,
  so no mechanical derivation contradicts this).
- `mockAppServer`'s served-card list is byte-verbatim to `mcp-packaging-red.test.mjs:45`;
  the principal shape matches `normalizePrincipal` (:986-992); the suite's `digest()` is
  byte-identical to the store's `canonicalDigest`; the `_meta['baton/registryDigest']`
  stamp, the `schema()` closure idiom, the `CAPABILITY` registration idiom, the
  `_dispatch` connection-principal idiom, and the `ORDINARY_EXPLICIT_TOOLS`/`STATEFUL`/
  `RECONCILABLE` Set shapes all verified against mcp-northbound.mjs.
- Contract line-citation drift (within the fold's own frame note): coordinator sendMessage
  now :6628-6706 (contract :6592-6662), messageReceipt :6708; all other v2.1-amended
  anchors re-verified exact (attentionFollow :6733-6772, elevate wrapper :11083-11085,
  store elevate :13775-13920, addKnowledgeNode :15867, postBoardItem :14265, boardSnapshot
  runId :14495+).

Reconcile-before-the-wave (drift that trips implementers):
- **D1 · `frame`/`digest` field names** (BLOCKER 3) — suite invents what the contract
  leaves unnamed.
- **D2 · `coordinator.messageRunId` (minor).** Decision 4 says "e.g.
  `coordinator.messageRunId(messageId)`"; FP-18 pins the name hard. Drop the "e.g." in the
  contract (the suite is the pin) or accept any read-only accessor name and loosen FP-18.
- **D3 · `invalid_scratchpad_elevate` code sharing (minor).** The refusal vocabulary
  assigns `invalid_scratchpad_elevate` to the NEW `baton_run_scratchpad_elevate` guard —
  the same string the EXISTING settlement `baton_scratchpad_elevate` guard already returns
  (mcp-northbound.mjs:1004-1008). Reuse is lawful (same refusal class), but implementers
  should not invent a distinct code; worth one contract sentence.
- **D4 · Suite header "Thirty rows"** (cosmetic): the suite carries 37 test rows
  (34 red + 3 guards).
- **D5 · No explicit 27→33 count assert** (minor): FP-14-tools asserts inclusion of the
  six, never `names.length === 33`. A seventh stowaway tool would stay invisible.

## 6. Closing verdict

**NOT-READY** — the suite is honest where it counts (34/34 red rows fail AT their named
stages, zero fixture bugs in today's red half, the three guards are legitimate greens,
fully hermetic, and every contract decision has at least one enforcing row), but WS-01's
future-green path is broken at two confirmed points, one contract/suite naming drift makes
a compliant implementation go red, and one §8-amended acceptance behavior has no oracle.

Blockers:

1. **WS-01 never approves the member plans — the sequence stalls before step 3.**
   What: `waves.start` members sit at `awaiting_plan_approval` (probe-verified on the
   suite's exact fixture: `mandatory: true` GOAL_PLAN_POLICY, no auto-approval); no worker
   is ever dispatched, so step 3's run-target sends return `{ok: false, result:
   'run_not_active'}` with no `messageId`, and the `assert.match(query.messageId, …)`
   loop fails — against a contract-correct implementation. (bd3's own idiom approves
   explicitly, `bidirectional-v3-red.test.mjs:139`.) Why: the rung's live acceptance must
   be greenable by the contract's implementation; today-red staging is unaffected (the row
   fails at step 1, its named stage), but the row can never turn green. Fix: between
   steps 2 and 3, approve each member plan THROUGH THE FACADE — `run.status` → planDigest
   → `run.approve` (both existing commands, so the static assertion stays clean), then
   proceed to the message queries. Probe-verified this unblocks the full chain
   (dispatch → decision gate → `run.answer` → completion → taskId discovery → elevate
   `elevated: 1`).
2. **WS-01's `waves.attach` members carry truncated objectives.**
   What: `scriptPartC` attaches with `objective: 'survey slice <role>'`, but the member
   runs were started with the full `'survey slice <role> — cite board ws01-tasks and node
   <id>'`; `attachWave` matches members by EXACT objective equality
   (application.mjs:11214-11227). Probe-verified: short objectives throw
   `wave_attach_unknown_wave`; the full objective attaches successfully. Why: step 8 fails
   against a correct implementation. Fix: carry the full member objectives in `stateA`
   (e.g. `queries.push({…, objective})`) and pass them to `waves.attach`.
3. **FP-09 pins `frame`/`digest` field names the contract does not name.**
   What: FP-09-read asserts `page.frame` includes `UNTRUSTED_SCRATCHPAD`; FP-09-budget
   asserts `page.digest` is the id-set citation. Decision 6 requires the marker and the
   citation but its response enumeration names neither field, and Decision 1's carve-out
   makes any unlisted addition a semantics invention. Why: an implementer following the
   contract text chooses different names (or a different lawful carrier) and goes red on
   BOTH rows despite a contract-correct implementation — a false red at the exact seam the
   fold added (blocker #5's budget). Fix: amend Decision 6's response shape to name the
   two fields (recommended: `frame` and `digest`, matching the suite), or relax the suite
   to content assertions (`JSON.stringify(page).includes('UNTRUSTED_SCRATCHPAD')` and a
   digest-shaped field lookup).
4. **Decision 4 note(b)'s dead-handle resolve-to-null has no oracle (FP-05, T1).**
   What: the §8 amendment pins "a worker-targeted message whose worker handle is gone
   resolves to NO run — resolve-to-null ≡ unknown ≡ `application_unauthorized` … (FP-05
   pins the row)"; FP-05's comment repeats the claim, but no dead handle is staged. Why:
   an accessor resolving through durable task records (returning the run, serving the
   receipt under a permissive policy) — the opposite of the pinned behavior — greens every
   staged leg, and the accessor is this rung's ONLY permitted kernel addition: its one
   subtle semantic deserves the row the contract says it has. Fix: add the leg — send to a
   spawned worker, remove the handle (process close/kill), then facade `run.message.receipt`
   under the permissive stub must refuse `application_unauthorized`, identically to the
   unknown-id case.

Non-blocking strengthenings (fold into the wave if convenient): T2 (require a coalesced
`count > 1` reason in FP-08), T3 (flip the board binding between capture and invocation in
FP-11-race), T5 (post-write freshness leg for `run.scratchpad.read`), T7 (assert the
named `invalid_*` guard codes in FP-14-dispatch), F7 (fix the FP-16-parse header comment;
note the negative pins are already green), D2 (drop the "e.g." around `messageRunId`), D3
(one sentence on the shared `invalid_scratchpad_elevate` code), D4/D5 (row count in the
header; an explicit 33-count assert in FP-14-tools), plus behavioral rows for
`stale_scratchpad_fence` and `scratchpad_partition_exhausted` if a cheap staging emerges.
