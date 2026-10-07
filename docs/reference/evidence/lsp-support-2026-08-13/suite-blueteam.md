# #144 BLUE-TEAM SUITE REVIEW — attack the LSP-pool red-first suite

**Verdict:** **NEEDS-FOLD**
**Date:** 2026-08-13
**Target:** `impl/test/issue144-lsp-pool-red.test.mjs` (23 rows: 10 PIN green, 13 RED at named
stages — GP-A..GP-L ×10, R1..R13 ×13)
**Contract:** `contract-fold.md` v1.1 (folded) · **Brief:** `blueteam-144-brief.md` (this campaign)
**Suite notes:** `suite-draft-notes.md` (the GP-B/GP-C re-anchor record)
**Review HEAD:** `5bc67de` (Baton private effective-tree snapshot; worktree HEAD)
**Draft-notes verification HEAD:** `74da30639c02374313918b4376a3d86cae3342f3` — **not an ancestor of
the review HEAD**; the #153 follow-on (`PRODUCTION_WORKFLOW_DRIVER`) drifted `impl/src/application.mjs`
+7 lines between the two, which is the root cause of F4/F5/F6 below.

**Read-order executed (in full):** (1) `blueteam-144-brief.md` — the campaign laws (no clocks,
NUL-safe citation, write ONLY this deliverable), the five attack axes, and the verdict law; (2)
`contract-fold.md` v1.1 — the folded laws D1 pool, D2 diagnostic scoping, D3 environmental tier, D4
honesty/containment, the B1–B5 fixes, and the §6 citation ledger; (3)
`impl/test/issue144-lsp-pool-red.test.mjs` — all 23 rows, the invented LSP-pool surface (header
comment), the stub fixtures, and the split record; (4) `suite-draft-notes.md` — the row inventory and
the GP-B/GP-C line-anchor re-anchor record.

---

## 1. Verification performed (before claiming stage honesty)

### 1.1 The suite was run twice from the repo root (`node --test impl/test/issue144-lsp-pool-red.test.mjs`)

| Run | tests | pass | fail | cancelled/skipped/todo |
|-----|-------|------|------|------------------------|
| 1 | 23 | 8 | 15 | 0 / 0 / 0 |
| 2 | 23 | 8 | 15 | 0 / 0 / 0 |

The split is **deterministic across two consecutive runs** — the pass/fail **row set is byte-identical
by name** across the two runs. The 8 passes are GP-B, GP-C, GP-D, GP-E, GP-G, GP-H, GP-I, GP-L. The 15
failures are **GP-A, GP-F** (both declared PIN rows) plus **R1..R13**.

**The claimed split does not reproduce.** `suite-draft-notes.md:126-127` and the suite header
(`issue144-lsp-pool-red.test.mjs:74-79`) both record "Run 1: 23 tests — 10 pass / 13 fail; Run 2: 23
tests — 10 pass / 13 fail. STABLE." At the review HEAD the observed split is **8 pass / 15 fail** —
two of the ten guard pins (GP-A, GP-F) are red. See F4.

### 1.2 Named-stage honesty (verified from the failure log)

| Row(s) | Failing assertion |
|--------|-------------------|
| R1..R13 | `stage #144: <named stage>` — `AssertionError` thrown by `stageGuard` at `:348`, reached through `resolveLspPoolHome() → {surface:null}` (`:331-340`). Every RED row fails at its named stage with zero fixture errors/crashes. |
| GP-A | `assert.deepEqual(order, [...order].sort(...))` at `:391` — the six gate strings are **not** in the asserted order inside `sedSrc('application.mjs', 949, 956)`. |
| GP-F | `assert.ok(bounded.includes('credential-shaped'))` at `:474` — the window `sedSrc('application.mjs', 334, 341)` no longer contains the credential-shaped string. |

The GP-A/GP-F failures are **content failures, not stage-guard failures** — they fail inside the row
bodies. They are PIN rows that the draft-notes declare GREEN; at the review HEAD they are red. The
two other grep-shaped green pins whose windows also shifted (+7) survived only by the window still
overlapping their pinned content (GP-B `coordinator.mjs:11189-11194`, GP-C `coordinator.mjs:11108-11112`
were re-anchored by suite-fix-144 and sit below the drift point; GP-D/GP-G/GP-H/GP-I are grep or
import pins with no line window). See F4–F6.

### 1.3 Citations verified (`grep -an` / `sed -n`; the NUL files never opened whole)

Every anchor the contract, the draft notes, and this review cite was re-verified at the review HEAD.
`impl/src/application.mjs`, `impl/src/coordination-store.mjs`, and `impl/src/coordinator.mjs` are
NUL-bearing; all reads used `grep -an` / `sed -n` only.

| Citation | Verified at | Matches |
|---|---|---|
| `DEBUG_GATE_CODES` set literal (actual declaration order) | `application.mjs:952-954` | `'scope', 'red_green', 'coverage', 'route_mismatch', 'forbidden_effect', 'unknown'` — **`forbidden_effect` is FIFTH** |
| `debugGateFromLiveCode` if-chain order (the GP-A asserted order) | `application.mjs:956-963` | `scope → forbidden_effect → red_green → coverage → route_mismatch → unknown` |
| `boundedAttentionText` signature | `application.mjs:341` | `function boundedAttentionText(value) {` |
| `'[credential-shaped content redacted]'` | `application.mjs:344` | **outside** the GP-F window `334-341` |
| `FRAME_LIMITS['view.attention_text.bytes']` row | `application.mjs:59` | `const MAX_ATTENTION_TEXT_BYTES = FRAME_LIMITS['view.attention_text.bytes'].value;` (GP-F's `grepCount` ≥ 1 still holds) |
| Contract §6 gate-enum claim | `contract-fold.md:679` | "`application.mjs:949-956` — gate enum declaration order \| ✅ exact (`scope`→`forbidden_effect`→`red_green`→`coverage`→`route_mismatch`→`unknown`)" — **factually wrong about the set literal** (see F5) |
| #153 follow-on drift (root cause of F4–F6) | `git diff 74da3063…HEAD -- impl/src/application.mjs` | `+7` at `:110` (`PRODUCTION_WORKFLOW_DRIVER`), `+2` at `:7430`, `+2` at `:7888`, `+4` at `:11594`; 13 326 → 13 341 lines |
| 74da3063 not an ancestor of HEAD | `git merge-base --is-ancestor` | exit 1 — the verification tree and the review tree diverged |
| Draft-notes split claim | `suite-draft-notes.md:126-127`; suite header `:74-79` | 10 pass / 13 fail — does not reproduce at HEAD (8 / 15) |

### 1.4 Hermeticity scan (real timers / load reads)

The suite's only real wall-clock surface is the **stub handshake**: `handshakeStub` (`:276-327`)
uses `setTimeout(…, 4000)` (`:303`, a bounded kill-wait), `setTimeout(…, 150)` (`:311`, pacing), and
`setTimeout(…, 600)` (`:318`, a **hard resolve deadline** that races response arrival — see F11). No
`Date.now()` / `performance.now()` / `setInterval` appears anywhere in the suite. No host-load read:
the fixtures use `git`, `mkdtempSync`, and a spawned local `node` stub only (`process.execPath`), with
no network and no `os.loadavg`/`os.availableParallelism`. The `gitRepo` helper shells out to real git
on a mkdtemp root — hermetic and local. The suite header's claim "Fixed injected epochs/digests only;
never the real clock" (`:63`) is **contradicted** by the `handshakeStub` timers (F11).

---

## 2. Verdict summary

The suite is a well-typed, well-invented-surface red-first instrument: the closed refusal family and
the sanitizer mapping are pinned to source truth (R11), the base-hygiene rows are genuinely greenable
under a correct implementation (R9, R10 SOUND), and the single-flight identity pin discriminates a
serializing-restart lock from a join (R2 SOUND). It is **not fold-blocking-safe**:

- **The claimed split is stale at the review HEAD (F4)** — 8 pass / 15 fail, not 10 / 13. Two PIN
  rows (GP-A, GP-F) are red because the #153 follow-on drifted `application.mjs` +7 lines. This is the
  same line-anchor fragility the suite-fix-144 wave already fixed in GP-B/GP-C; it recurs on the very
  next production change.
- **GP-A is content-wrong, not just drifted (F5)** — the asserted gate order matches the
  `debugGateFromLiveCode` if-chain, **never** the `DEBUG_GATE_CODES` set literal it claims to pin; the
  contract's own "✅ exact" gate-enum citation is factually wrong about the set.
- **R3, the row the brief named first, is ungreenable as written (F1–F3)** — its three legs each
  require a fixture or surface semantics a correct implementation cannot satisfy: the lifecycle leg
  needs a synchronous `process_ready` observation that a real async handshake cannot provide; the
  wedged leg's `'hung'` stub never becomes ready, so a correct pool refuses `starting` before any
  outstanding request accumulates; the crash leg's always-crash stub makes the retry-reachability
  assertion fail on a correct implementation too.
- **Three shallow-greenability holes (F8–F10)**: the blast-radius projection is pinned as a pure
  function but never asserted to be consulted by a verdict path (R6/R12); R5's `typeof name ===
  'string'` passes an empty string (digests-only impl drops names); R13 never asserts the opted path
  is reachable (refusing-every-language passes R13).
- **One pin breaks on the correct landing (F7)**: GP-E greps `referee.mjs` for the byte-level
  absence of the exact blast-radius projection a correct #144 adds to the referee path.
- **One hermeticity defect (F11)**: GP-L's handshake resolves on a fixed 600 ms deadline racing the
  child's real response — a #7-class flake surface.

### Verdict per attack axis

| Axis | Verdict | Grounds |
|---|---|---|
| Green-side blockers | **NEEDS-FOLD** | R3 un-greenable on all three legs (F1–F3); R1's negative substring is over-broad (F12). R9 dirty-base-root and R10 effective-view key are greenable under a correct implementation (What holds). |
| Shallow-greenability | **NEEDS-FOLD** | Blast-radius projection can pass unconsulted (F8); symbol NAMES droppable to empty strings (F9); opt-in gate can pass while refusing every language (F10). R2's identity pin does discriminate a serializing lock from a join (note under §3). |
| Stub-fixture discrimination | **NEEDS-FOLD** | GP-L's stub is a real hermetic LSP responder (non-vacuous — a no-server impl cannot satisfy it), but the handshake carries a wall-clock hard deadline (F11). |
| Missing rows | **SOUND** | B1 trust-posture card is pinned at the data level, not comment-only (note under §3); the slot-clear retry-reachability is pinned *in intent* but unsatisfiable as-fixtured (F3). |
| Hermeticity / #7-class | **NEEDS-FOLD** | Only wall-clock surface is `handshakeStub`'s fixed-600 ms resolve racing the child's real response (F11); no real servers, no host-load reads. |

Per the brief's output law the verdict is **NEEDS-FOLD**, with the numbered findings below as the
fold work-list.

---

## 3. Numbered findings

### F1 — GREEN-SIDE BLOCKER (R3): the lifecycle leg demands a synchronous `process_ready` a real async handshake cannot provide — R3's first and second legs require mutually incompatible `acquire` semantics

- **Row/gap:** R3's lifecycle leg (`issue144-lsp-pool-red.test.mjs:601-609`) calls
  `pool.acquire({ language: 'typescript' })` (synchronously, per the invented surface
  `:46` — `pool.acquire({ language }) → serverHandle`) and then reads
  `pool.lastLifecycleEvents()` **in the same tick** (`:605`), asserting `readyAt > startedAt` — i.e.
  `lifecycle.process_ready` must already be in the events array. But the stub is a spawned child
  (`poolConfig` `:367`: `command: process.execPath, args: [stub]`); the
  initialize handshake is child-process **I/O**, which cannot complete within the synchronous call.
  A correct implementation that records `process_ready` only after the real handshake (D4 honesty)
  cannot have it in the array at this read; a correct implementation that *blocks* `acquire` until
  ready (so the read works) hangs the wedged leg forever against the never-ready `'hung'` stub (F2),
  and still fails the crash leg's retry assertion (F3). The two legs of R3 are jointly unsatisfiable
  under a single correct surface.
- **Attack (the brief's exact question):** can the fixture drive a server over the ceiling
  hermetically? Not as written — the wedged leg only runs if `acquire` returns immediately on a
  never-ready server, which is the same property that makes the lifecycle leg's synchronous
  `process_ready` read impossible. A correct v1.1 implementation cannot satisfy both legs, so R3 is
  un-greenable without a fold.
- **Concrete fix:** make the lifecycle leg async over an explicit readiness seam — e.g.
  `await pool.ready(language)` (a bounded, count/event-derived wait, lawful under M2 as a kill-wait)
  **before** reading `lastLifecycleEvents()`, and assert the order against the events collected up to
  readiness. Keep `acquire` non-blocking (returns a starting handle) so the wedged leg can fire
  ceiling requests; the readiness seam is what the lifecycle leg awaits instead of assuming a
  synchronous handshake.

### F2 — GREEN-SIDE BLOCKER (R3): the `'hung'` stub never becomes ready, so the contract's wedged trigger (B2: "ready, then never answering a textDocument/* request") can never fire — the outstanding ceiling is never driven past readiness

- **Row/gap:** B2 defines the wedged server as **ready, then silent on textDocument/***. The
  `'hung'` fixture (`:219-221`) is `stdin.on('data', () => {});` — it never answers **initialize
  either**, so it never becomes ready. The wedged leg (`:611-634`) fires `ceiling` concurrent
  `answer({ op: 'code.hover' })` calls against that never-ready server and expects the next `acquire`
  to refuse `lsp_server_unavailable (reason wedged)`. A correct pool (D1.3, the closed reason set
  `starting|wedged|base_root_dirty|start_refused`) refuses `answer()` on a **not-ready** server with
  reason `starting` (or blocks in `acquire`) — the requests reject immediately, outstanding never
  accumulates, the ceiling is never crossed, and the `wedged` refusal never fires. The fixture's
  "hung-from-birth" mode drives a `starting` state, not the `wedged` state the row pins.
- **Attack (the brief's exact question):** can the fixture drive a server over the outstanding-request
  ceiling hermetically? No — a never-ready server is not a wedged-but-alive server; a contract-correct
  pool treats it as `starting`, so the leg is un-greenable as-fixtured.
- **Concrete fix:** add a **`'ready-then-hung'`** stub mode — answer `initialize` + `initialized`
  (become ready), then drain stdin silently on `textDocument/*`. The wedged leg awaits readiness
  (F1's seam), fires `ceiling` hover requests, and the outstanding count genuinely climbs. Assert the
  next demand refuses `wedged`, then that the regeneration `acquire` returns a new generation handle.

### F3 — GREEN-SIDE BLOCKER (R3): the retry-reachability (slot-clear) leg is un-greenable — the always-crash stub makes a correct implementation's retry also fail `lsp_startup_failed`

- **Row/gap:** the `'crash'` fixture (`:223-225`) is `process.exit(72);` — it crashes on **every**
  spawn. The slot-clear leg (`:636-649`) asserts the first `acquire` throws `lsp_startup_failed`, then
  wraps a second `acquire` in `assert.doesNotThrow` that **re-throws `lsp_startup_failed`**
  (`:646-649`). On a correct implementation the second spawn hits the same always-crash stub and also
  throws `lsp_startup_failed` — the wrapper re-throws and `doesNotThrow` fails. The row's intent (B2:
  "the start single-flight slot clears BEFORE `lsp_startup_failed`, so a subsequent demand starts a
  fresh attempt") is pinned, but the fixture makes it unsatisfiable: with an always-crash server there
  is no observable difference between "slot cleared and a fresh attempt also failed" and "slot parked
  on the failed start" — both surface as a second `lsp_startup_failed`.
- **Concrete fix:** add a **`'crash-once-then-answer'`** stub mode — the first spawned process exits
  `72`, the second (the retry's fresh generation) answers the envelope. Then the second `acquire`
  succeeding (or reaching a ready state) is real evidence the slot cleared and a fresh attempt began.
  Alternatively, drop the `doesNotThrow` and assert the retry produced a **new `process_started`
  event** in `lastLifecycleEvents()` (a fresh attempt, regardless of outcome).

### F4 — STAGE HONESTY / REPRODUCIBILITY: the documented "verified-stable-twice 10/13" split does not reproduce at the review HEAD — observed 8 pass / 15 fail, with two PIN rows red

- **Row/gap:** `suite-draft-notes.md:126-127` and the suite header `:74-79` both record 10 pass / 13
  fail, STABLE, on the "final homed file". At the review HEAD the suite is 8 pass / 15 fail, and the
  two extra failures are **GP-A and GP-F — declared GREEN PIN rows**. The draft-notes verification ran
  on `74da3063`; the review HEAD (`5bc67de`) carries the #153 follow-on (`PRODUCTION_WORKFLOW_DRIVER`,
  `+7` lines at `application.mjs:110`, plus 3 further hunks) which shifted `boundedAttentionText`
  `334→341` and `DEBUG_GATE_CODES` `945→952`. `git merge-base --is-ancestor 74da3063 HEAD` exits 1 —
  the trees diverged.
- **Why it matters:** PIN rows exist to guard "unchanged surfaces" and "must stay green". Two of the
  ten are red at HEAD, so the suite's own split record is false today, the row inventory is stale, and
  the suite no longer runs in the state the draft notes and the brief both describe ("10 PIN green").
  This is the **same line-anchor fragility the suite-fix-144 wave fixed in GP-B/GP-C** — the fix
  re-anchored two pins below the #81 shift, but left the other line-window pins un-hardened, and the
  very next production change (unrelated to #144) broke them.
- **Concrete fix:** re-run and re-record the split at the review HEAD as 8 pass / 15 fail, then apply
  F5/F6 (which restore GP-A/GP-F to green at HEAD), then re-verify **10 pass / 13 fail** and re-home
  the record. Long-term: replace the remaining `sedSrc(…, a, b)` line-window pins with **grep-based
  anchors** (or `sedSrc` windows re-anchored by `grepFirstLineNum`), so a +N line drift between
  verification and review cannot silently turn a PIN red. The suite-fix-144 wave treated the symptom
  (re-anchor two pins); the class (line-number fragility across unrelated production edits) is still
  open for GP-A/GP-F and any future window pin.

### F5 — CONTENT-WRONG PIN (GP-A): the asserted gate-enum order matches `debugGateFromLiveCode`'s if-chain, **never** the `DEBUG_GATE_CODES` set literal it claims to pin — re-anchoring alone cannot fix it

- **Row/gap:** GP-A (`:386-403`) asserts the six gate codes appear in the window
  `sedSrc('application.mjs', 949, 956)` in the order
  `scope → forbidden_effect → red_green → coverage → route_mismatch → unknown` (`:389-392`). The
  **actual set literal** (`application.mjs:952-954`) is
  `'scope', 'red_green', 'coverage', 'route_mismatch', 'forbidden_effect', 'unknown'` —
  **`forbidden_effect` is fifth, not second**. The asserted order is the `debugGateFromLiveCode`
  if-chain order (`application.mjs:956-963`). At the draft-notes verification HEAD, `sedSrc(949,956)`
  caught the **function** (order matches) so GP-A passed; at the review HEAD the +7 shift moved the
  set literal into the window (order differs) so GP-A fails. The suite header's own comment "Gate
  mapping in declaration order" (`:387`) conflates the mapping function with the enum set.
- **Contract correlation:** `contract-fold.md:679` claims "`application.mjs:949-956` — gate enum
  declaration order | ✅ exact (`scope`→`forbidden_effect`→`red_green`→`coverage`→`route_mismatch`
  →`unknown`)". This is **factually wrong about the set literal**, which has been
  `scope, red_green, coverage, route_mismatch, forbidden_effect, unknown` since its introduction
  (commit `6d0ca11`) and never changed. The contract verified the *function region*, not the *set*,
  and labelled it "gate enum declaration order".
- **Concrete fix:** re-anchor GP-A to the set literal and pin the **actual** declaration order:
  `sedSrc('application.mjs', 952, 954)` with the order
  `scope, red_green, coverage, route_mismatch, forbidden_effect, unknown`, and keep the closed-set and
  no-LSP-code loops (`:393-402`). The meaningful pin (R12/D4.1: the enum stays the closed live set, no
  gate gains an LSP-derived code) is preserved; the order assertion must match the code it pins. If
  the *mapping function's* order is what matters, pin `debugGateFromLiveCode` (`:956-963`) explicitly
  and label it the mapping, not the enum. A v1.2 contract note should correct the §6 "✅ exact" claim
  to the true set-literal order.

### F6 — ANCHOR DRIFT (GP-F): the credential-shaped string moved out of the pinned window

- **Row/gap:** GP-F (`:463-482`) asserts `bounded.includes('credential-shaped')` where `bounded` is
  `sedSrc('application.mjs', 334, 341)` (`:471-474`). At the verification HEAD the credential string
  sat inside the window (line 337); at the review HEAD the +7 shift moved it to `application.mjs:344`,
  outside `334-341`. The function-signature assertion (`:477`) still passes only because the signature
  lands on the window's last line (341) — a borderline coincidence, not a stable anchor.
- **Concrete fix:** re-anchor to `sedSrc('application.mjs', 341, 348)` (or `grepFirstLineNum` +
  window, or grep the literal directly) so the credential-shaped redaction line stays in view. Per F4,
  prefer a grep-based anchor over a hard line window.

### F7 — PIN BREAKS ON CORRECT LANDING (GP-E): the "no blast-radius in referee.mjs" grep asserts the byte-level absence of the exact projection a correct #144 must add to the referee path

- **Row/gap:** GP-E (`:448-461`) ends with
  `assert.equal(grepCount('referee.mjs', 'blastRadius|symbolEvidence|projectSymbolEvidence'), 0)`.
  D2.2/B5b (the contract's own R6 decision) requires a blast-radius projection that **annotates the
  verdict**. The verdict is produced in the referee path; a correct landing that routes the annotation
  through `referee.mjs` — an import, a call-site, or the verdict envelope field — puts one of those
  three strings in the file and turns this **PIN row red**. GP-E (a must-stay-green pin) and the
  suite's own R6 (a must-go-red-then-green row) cannot both hold post-landing: R6 demands the
  projection exist, GP-E demands it not appear in the referee.
- **Concrete fix:** re-scope the pin to the **derivation it guards** — assert `coverageOfChange`
  stays textually derived (`cov.includes('coverageOfChange = uncovered.length === 0')`, `:451`) and
  that no blast-radius *feeds the coverage gate* (assert no `coverageOfChange`/`blastRadius` coupling,
  e.g. `grepCount('referee.mjs', 'coverageOfChange.*blastRadius|blastRadius.*coverageOfChange') === 0`),
  rather than banning the projection's name from the file. That preserves GP-E's real law (B5b:
  evidence, not a gate input) without forbidding the annotation machinery B5b also requires.

### F8 — SHALLOW-GREENABILITY (R6/R12): the blast-radius projection is pinned only as a pure function — never asserted to be consulted by a verdict-producing path

- **Row/gap:** R6 (`:717-734`) and R12 (`:897-917`) both call `surface.computeBlastRadius({ … })`
  directly (`:723`, `:909`) and assert properties of the **returned object only**. Neither drives the
  projection through `pool.answer`/the verdict path, and neither asserts the annotation actually rides
  a verdict. An implementation that exports a correct `computeBlastRadius` (additive, advisory,
  never returns `coverageOfChange`) but **never wires it into verdict production** passes R6 and R12
  — the projection "exists but is unconsulted", the exact attack the brief named.
- **Concrete fix:** add an R6 leg that drives the projection through the verdict path — e.g.
  `pool.answer({ op: 'code.symbol', … })` on a changed-lines project and assert the returned
  orientationAnswer carries the blast advisory/annotation (under the UNTRUSTED frame), so the
  annotation is proven to **annotate**, not just to exist. R12's never-a-gate-input half stays as is;
  the consultation half belongs in R6.

### F9 — SHALLOW-GREENABILITY (R5): `typeof symbol.name === 'string'` passes an empty string — a digests-only implementation can drop the symbol NAMES and still go green

- **Row/gap:** R5 (`:696-714`) asserts `assert.equal(typeof symbol.name, 'string')` (`:709`) and
  `assert.equal(typeof symbol.fileDigest, 'string')` (`:710`), plus the no-raw-path serialized check
  (`:712-714`). An implementation whose projection emits `{ name: '', fileDigest: '…' }` — digests
  with **empty names** — satisfies every R5 assertion: `typeof '' === 'string'` is true, and the
  absence of `src/caller.ts` in the serialized output holds. The row's stated law is "B5a CHOICE b:
  symbol **NAMES** + file digests on the worker-facing surface" (`:707`), but it never asserts the
  name is present or meaningful.
- **Concrete fix:** assert the name is the resolved symbol: `assert.equal(symbol.name, 'missingFn')`
  (the fixture's resolver returns exactly that, `:703`) or at minimum `assert.ok(symbol.name.length >
  0)`. R7's receipt already checks `receipt.symbols[0].name` truthy (`:748`); R5 (the projection row
  itself) must be equally strict.

### F10 — SHALLOW-GREENABILITY (R13): the opted path is never asserted reachable — an implementation that refuses every language passes R13

- **Row/gap:** R13 (`:919-950`) asserts `pool.isOptedIn('typescript') === true` (`:926`), refuses a
  `rust` demand with `lsp_language_not_opted_in` (`:928-931`), serves `rust` `code.symbol` from the
  static index (`:934-939`), and checks the typescript card posture (`:941-950`). It **never calls
  `pool.acquire({ language: 'typescript' })`**. An implementation whose `acquire` refuses **every**
  language (including typescript) with `lsp_language_not_opted_in` — while `isOptedIn` truthfully
  reports typescript opted-in and the card carries the honest posture — passes R13. The brief's exact
  attack ("the opted path must also be asserted reachable") is open.
- **Concrete fix:** add `assert.ok(pool.acquire({ language: 'typescript' }), 'the opted path is
  reachable')` (or `assert.doesNotThrow`) to R13, so the opt-in gate is proven to *admit* the opted
  language, not only to refuse the un-opted one. (Mitigation note: R2/R3/R4/R8/R9 all acquire
  typescript, so the suite as a whole catches an all-refusing implementation — but R13, the row that
  *pins the opt-in gate*, must pin the admission itself.)

### F11 — HERMETICITY / #7-CLASS (GP-L): the stub handshake resolves on a fixed 600 ms deadline that races the child's real response — a flake factory on a loaded host

- **Row/gap:** `handshakeStub` (`:276-327`) spawns the stub and resolves at
  `setTimeout(…, 600)` (`:318-325`) with `resolve({ initialize: responses.get(1) ?? null, hover:
  responses.get(2) ?? null })` — the 600 ms timer is a **hard resolve deadline**, not a wait for
  arrival. GP-L (`:525-538`) then asserts `initialize`/`hover` are non-null with the required
  capabilities. On a loaded host, `node` startup + two JSON-RPC round-trips can exceed 600 ms; the
  responses arrive after the resolve, `initialize`/`hover` are `null`, and **a PIN row flake-fails a
  correct, hermetic stub**. This is exactly the #7 class ("a wall-clock race between a test stream
  and a real timer") and directly contradicts the suite header's "never the real clock" (`:63`). The
  4000 ms timer (`:303`) is a bounded kill-wait and lawful; the 150 ms pacing write (`:311`) is
  buffered by the stdin pipe and benign; the **600 ms hard resolve** is the defect.
- **Concrete fix:** resolve the promise when **both** responses (id 1 `initialize`, id 2 `hover`)
  have arrived (an arrival-driven settle), keeping the 4000 ms timer as the outer bound that rejects.
  Then GP-L's timing is bounded by response arrival, not by a fixed deadline that races it.

### F12 — MINOR (R1): the `serialized.includes('definition') === false` negative substring is over-broad — a correct, honest empty answer may legitimately say "no definition provider"

- **Row/gap:** R1 (`:547-561`) asserts `serialized.includes('definition') === false` (`:559`) as a
  proxy for "no fabricated definition". A correct typed-empty answer is `{ availability: { status:
  'empty' }, language_ceiling: 'honest_empty' }` (D1.5), but a correct implementation that *explains*
  the honest ceiling — e.g. `availability.reason: 'no definition provider for language'` or a
  limitation note naming "definition lookup unavailable" — trips the substring and fails R1. The
  assertion constrains the impl's honest vocabulary, not its honesty.
- **Concrete fix:** assert the typed-empty **shape** — `availability.status === 'empty'`,
  `language_ceiling === 'honest_empty'`, and no `symbols`/`diagnostics` **keys** in the serialized
  object — rather than banning the English substring `definition`.

*(Note, not a numbered finding:* the B1 trust-posture card (R13 `:941-950`) is pinned at the **data
level** — the serialized card must contain the posture phrases — which is behaviorally stronger than
comment-only. It is not a *behavioral* pin of the containment consequence (the pool actually running
outside worker sandboxes with bounded egress is a deployment property no unit row can prove); for a
trust-posture *naming* row that is the right level. The `lsp_reap_unconfirmed` family membership is
pinned by R3's tail (`:652-653`) riding GP-G's closed reap set. R2's single-flight identity assertion
(`h2 === h1`, `:575-580`) does discriminate a serializing-restart lock from a join: with two
synchronous acquires, the only way to return the identical handle is to hand back the single in-flight
start — a serialize-and-restart-later impl must return a different (or pending) value at the second
call, failing the identity check. *)*

---

## 4. What holds (the suite-law and control-law surfaces)

- **Green-side, base-hygiene rows:** R9 is genuinely greenable — the fixture mints a dirty worktree
  (`writeFileSync` of an untracked `uncommitted.ts` over a committed base, `:803-805`) that a
  content-derived dirty-drift check (`base_root_dirty`, B3) reads hermetically, and a committed move
  (`:813-817`) drives the reused atlas `orientation_base_stale` gate. R10 is greenable — the
  effective-view key is a pure function over `{base_epoch, overlayDigest, normalized_query}` (`:826-846`)
  with a real conflict signal the impl must honor (`lsp_proven_zero_conflict`, `:861-865`). R4, R7, R8,
  R11 are greenable under a correct implementation (closed bound set, digests+counts receipt, framed
  base-only answers, closed sanitizer mapping).
- **Closed literals / vocabularies:** R11's `.sort()`-self test over the closed `LSP_SANITIZER_MAPPING`
  (`:874-877`) and R4's exact-keys `pool.bounds` check (`:665-671`) pin ACTUAL closed sets with no
  `localeCompare`; GP-I enforces the locale-free compare across the cited machinery.
- **Stage honesty + hermeticity:** at HEAD every red row fails at its named stage with zero fixture
  errors; mkdtemp-only fixture worlds with a global `test.after` reap (`:189`); no real servers
  (the stub is a local `node` script, no network); no host-load reads; fixed injected epochs/digests
  only.
- **Control law:** the suite adds no clock to any workflow control surface; the product kernel is
  untouched; the only real timers are inside the `handshakeStub` test fixture (F11), not the
  product surface.

---

## 5. Bottom line

The suite's closed-vocabulary, base-hygiene, and receipt-shape rows (R4/R7/R8/R9/R10/R11) are
genuinely load-bearing and greenable under a contract-correct implementation, and R2's identity pin
does discriminate a serializing lock from a join. It is **not fold-blocking-safe**: the documented
10/13 split is false at the review HEAD (8/15, F4), GP-A pins an order the live set never had (F5),
R3 is un-greenable as written on all three legs (F1–F3), the blast-radius projection can pass
unconsulted (F8), the name projection can pass with empty names (F9), the opt-in gate can pass while
refusing every language (F10), GP-E breaks on the correct landing (F7), and GP-L carries a real
wall-clock race (F11). Per the brief's output law the verdict is **NEEDS-FOLD** with the numbered
findings above as the fold work-list — F4 first, because the suite must first tell the truth about
its own split before its red rows can be trusted to hold.

**Deployment verification command** (Baton): executable `true`, arguments `[]`, working directory `.`,
expected exit 0 — the authored change is this document; no code was touched, so no product behavior is
deployed.
