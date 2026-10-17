# Issue #114 — blue-team report: attack the folded red-first suite (shallow-greenability hunt)

- **Target:** `impl/test/workflow-as-data-red.test.mjs` — 25 rows (4 green guards P1-P4, 21 red
  at named stages), the red-first acceptance for `workflow-as-data-contract.md` v1.1 (B1-B6 +
  OQ2 folded). Blocker → change map in `contract-fold.md`; row map in `suite-draft-notes.md`.
- **Verdict:** **NEEDS-FOLD** — 11 numbered findings (F1-F11), four of them row-breaking
  (F1 false-red, F2 contract-suite mismatch, F5 B1-oracle hole, F10 import-law under-pin) plus
  a wide shallow-greenability gap on the W3 policy rows (F3). Six minor findings (F12-F16).
  The suite is not safe to implement against as written: a faithful implementation cannot pass
  W3-message-bounds today (F1), and a dishonest implementation can pass most of the W3 policy
  rows without performing the named capability (F3).
- **Date:** 2026-08-06. HEAD `d106e4a` (Baton private effective-tree snapshot).

## 0. Verification performed (the brief's laws)

- **Suite run twice, from the repo root, both splits recorded** (stage-honesty law):
  `node --test impl/test/workflow-as-data-red.test.mjs`
  - Run 1: **tests 25 · pass 4 (P1-P4) · fail 21** (exit 1).
  - Run 2: **tests 25 · pass 4 (P1-P4) · fail 21** (exit 1).
  - Stable across both runs: the same 4 green (P1, P2, P3, P4) and the same 21 red rows.
- **Stage honesty (verified):** every red row's first failing assertion carries its NAMED stage.
  All 21 rows that go through `laneOf` fail with `stage[<named stage>]: baton.recipes.runWorkflow
  (spec|specPath) must exist …`; W5-01 fails at `stage[lane-missing]` (module absent,
  `ERR_MODULE_NOT_FOUND`); W6-02 fails at `stage[state-failure-allowlist-missing]`. The 14
  distinct stage labels in the failure output are exactly the suite's claimed vocabulary
  (`spec-validation-missing`, `member-validation-missing`, `objective-ref-invalid`,
  `steering-unknown`, `harvest-invalid`, `lane-missing`, `harvest-missing`,
  `policy-missing:{approve-on-advertised-plan|nudge-on-checkpoint+claim-on-stall|message-on-spawn|elevate-when-notes|answer-decisions|signal-on-members-done}`,
  `state-failure-allowlist-missing`). No row fails earlier or later than its named stage.
- **Citations verified with `grep -an`/`sed -n` (the two NUL files only):**
  - `coordination-store.mjs:507` — `SCRATCHPAD_KINDS = new Set(['note','plan','doubt','link'])` ✔
  - `application.mjs:11364-11370` — the `run.inspect { depth:'section', section:'result' }` sha read ✔
  - `coordinator.mjs:6795` — message kinds `inform|query|steer` ✔
  - `mcp-descriptor.mjs:46-72` — lexical + `realpathSync` containment precedent ✔
  - `recipes.mjs:81-116` (`deepFreeze`/`assertClosed`/`assertNoFunctions`), `:249`
    (`verification` REMOVED), `:573-581` (`createRecipes` frozen container) ✔
  - `mcp-northbound.mjs:198-260` — `stateFailureCode` allowlist (no `workflow_*` code today) ✔
  - `run-dynamic-workflow.mjs:218-230` — the messageId-marks-sent retry pattern ✔
  - `docs/PROGRESS.md:391` — the composition law ✔
- **NUL discipline (verified with `tr -cd '\000' | wc -c`):** the suite's own whole-file reads
  are NUL-free — `workflow-as-data-red.test.mjs` (0), `mcp-northbound.mjs` (0), and the invented
  `workflow-lane.mjs` (must be 0 by construction). Exactly the two NUL-carrying files carry NULs:
  `application.mjs` (3) and `coordination-store.mjs` (3). All other source files read or imported
  (coordinator/wave/wave-driver/recipes/application-cli/path-scope) are NUL-free (0).
- **No clocks introduced in this report.**

---

## 1. Row-breaking findings (why the suite is not safe to implement against as written)

### F1 — W3-message-bounds is a FALSE RED: the `MessageDeafAdapter` cannot produce an undelivered message, and `sendMessage` mints a `messageId` unconditionally

**Row:** W3-message-bounds (`stage[policy-missing:message-on-spawn]`) — asserts a non-delivering
member draws exactly 3 `messageOnSpawn` attempts then exactly one `steering_message_undelivered`
evidence line.

**Attack:** the row's discriminator is inverted — it demands the WRONG behavior and no correct
implementation can pass it:
1. `MessageDeafAdapter.prompt` (`workflow-as-data-red.test.mjs:281-288`) RETURNS (resolves with)
   `{ ok:false, notSent:true, reason:'deaf to messages' }` on a `[MESSAGE` frame. But the
   coordinator's delivery chain (`coordinator.mjs:6867-6869`) is
   `Promise.resolve(adapter.prompt(...)).then(() => ({ ok:true }), () => ({ ok:false }))` — any
   RESOLUTION, including `{ok:false}`, yields `ack.ok === true`. Verified by direct simulation of
   the chain: resolve-with-`{ok:false}` → `delivered`, reject (throw) → `undelivered`. So the deaf
   member is recorded as DELIVERED (`delivered: 1`).
2. Even if the adapter threw, `sendMessage` mints `message:<sha256>` at `coordinator.mjs:6838`
   (before the delivery loop) and returns it unconditionally at `:6895`
   (`{ ok:true, result:'sent', messageId, delivered: n }`). A lane following the contract's own
   GT6 pin ("the real receipt is the demo's messageId-marks-sent pattern",
   `run-dynamic-workflow.mjs:226`) marks the message sent on attempt 1 and stops. A lane keying on
   the `delivered` count also stops at attempt 1 (the count is 1, not 0). There is no input on which
   a correct lane draws 3 attempts.
3. Consequence: the row can only go green via an implementation that RETRIES a message that was
   already delivered — a violation of "keyed to a DELIVERED messageId" — or via a fake receipt
   emitter. This is the worst class: false-red for honest implementations, shallow-green for
   dishonest ones. The brief's W3-bounds axis ("could a retry bound be implemented in the wrong
   layer — driver-side instead of interpreter-side — and pass?") lands here too: a driver-side
   counter that emits 3 events + one evidence line passes, since the row never observes the
   adapter's `prompt` call ledger.

**Concrete suite fix:**
- Make the deaf adapter REJECT: `prompt` must `throw new Error('deaf to messages')` on a
  `[MESSAGE` frame (only a rejection yields `delivered: 0`), AND give `MessageDeafAdapter` a
  `calls.prompt`-style ledger counting `[MESSAGE`-frame deliveries so the row can assert the
  adapter was actually hit exactly 3 times.
- Pin the delivered-keying semantic in the contract D3 (and the row): a send is "delivered" only
  when the receipt carries `delivered > 0 && typeof messageId === 'string'` — the demo's
  messageId-presence pattern is insufficient for the undelivered case (sendMessage always mints).
  Have the row assert the three attempts each receipted `delivered: 0`.
- Alternatively, re-scope the row to the #97 spawn-window case the contract actually pins (GT6):
  a member whose `run.message.send` throws `worker_not_active`/`run_not_active` (no messageId) →
  ≤3 retries → `steering_message_undelivered` → member still settles. This is observable via the
  adapter ledger and matches the depending-on-#97 row the fold describes. (The current mock
  machinery cannot express a real spawn window, so the delivered-count fix is the practical one.)

### F2 — Contract–suite mismatch: every valid spec carries a `report` member field the v1.1 D1 schema never declares

**Row:** `validSpec`/`wadMember` (`workflow-as-data-red.test.mjs:347-367`) always include
`report: 'reports/<role>.md'`; W1-06 and W2-01 depend on it (the wave machinery uses
`member.report` as the `resolveResultPin` fallback so `resultSha` materializes exactly as the
bespoke waves did — `wave.mjs:401-406`).

**Attack:** D1's member JSON (`workflow-as-data-contract.md:55`) is
`{ role, exact, scope, objectiveRef }` — no `report`. A strict implementation of the D1 closed
schema (assertClosed at the member level, refusing unknown fields with `workflow_member_invalid`)
would refuse the suite's OWN valid specs by naming `report` — W1-06/W2-01 stay red forever (false
red) unless the interpreter silently adds `report` to the member allowed-fields. That inference is
a spec-extension the contract never states; an implementer cannot know `report` is declared.

**Concrete suite fix:** declare `report` (the wave-machinery report path, `wave.mjs:401-406`) in
D1's member shape and in the member-level allowed-fields list; the D1 JSON example must show it.
Then the closed schema and the suite agree.

### F3 — The W3 policy rows are shallow-green: only W3-answer/-bounds observe a wire call; the rest accept self-authored `receipt.steering[]` events

**Rows:** W3-approve, W3-checkpoint, W3-message, W3-message-bounds, W3-elevate, W3-elevate-bounds,
W3-signal.

**Attack:** each row's observable is the `receipt.steering[]` array the lane ITSELF writes. A
dishonest implementation that emits the correct-looking events — without performing the underlying
policy — passes every one of these rows:
- **W3-approve** — `planDigest` is a `/^[a-f0-9]{64}$/u` regex never bound to an actual advertised
  plan (`'0'.repeat(64)` passes); spawn is observed, but a direct `adapter.spawn` (bypassing the
  plan-approval lane) also passes. The "approved ONCE with the ADVERTISED digest" claim is not
  discriminated.
- **W3-message** — `message:<sha256>` regex only; the adapter's `prompt` (calls ledger exists on
  `TrackingMarkerAdapter`) is never asserted to have received the `[MESSAGE` frame.
- **W3-checkpoint** — asserts the two trigger names appear; nothing proves a real nudge was
  delivered or a genuine stall claimed (the pausable machinery exists precisely to make this
  observable, but the row doesn't use it).
- **W3-elevate / W3-elevate-bounds** — assert event counts only; no assertion that a
  `run.scratchpad.elevate` actually fired (the coordinator's elevation result is never observed).
- **W3-signal** — asserts an event naming the done role; never asserts the remaining member
  received the signal (adapter `prompt` again unobserved).
The strong discriminators in the suite are W3-answer (`calls.answer` receives `optionId:'opt-a'`)
and W3-answer-bounds (`calls.answer.length === 0` on non-match, no `opt-zzz` commit on invalid).
Every other W3 row can be gamed by a receipt forger — precisely the "keep a dishonest or shallow
implementation red" failure the blue team exists to find.

**Concrete suite fix:** for each W3 row, add one wire observable that only the real capability
can produce: (a) W3-approve — capture the actual advertised plan digest from the run's
plan state / `run.inspect` and assert `event.planDigest === thatDigest`; (b) W3-message / W3-signal
— assert `fx.adapter.calls.prompt` contains the `[MESSAGE` frame carrying the receipted messageId
(W3-signal: assert the remaining member received the signal frame); (c) W3-elevate / W3-elevate-bounds
— assert the elevation result surfaced (the coordinator's `run.scratchpad.elevate` receipt /
`receipt.steering` entry carrying the elevated entryIds) or at minimum that a `run.scratchpad.read`
of the task tier preceded the event; (d) W3-checkpoint — assert the nudged member actually
resumed (a second turn with the post-nudge content) rather than just trigger-name presence. If the
receipt surface is the intended contract, say so and accept the shallow-green trade — but then the
rows do not meet the suite's stated "keep a dishonest implementation red" purpose.

### F4 — No row pins the D4 attempt-marker verification (`[attempt: <salt>]`)

**Row:** none. D4 (`workflow-as-data-contract.md:139-146`) requires "the wave's attempt marker
(`[attempt: <salt>]`) is verified in harvested content before accepting — a wrong or parallel wave's
byte-similar pin cannot be attributed".

**Attack:** W4-01/W4-02 assert `entry.waveId === receipt.waveId` and
`entry.resultSha === outcome.resultSha`, but never that the harvested CONTENT carries the wave's
attempt marker. A byte-similar pin from another wave that shares the waveId-independent sha
(parallel wave, killed mid-wave checkpoint — B2's exact attack) passes both rows.

**Concrete suite fix:** add a W4 row where the target path's content is byte-identical to a
previous/parallel wave's artifact WITHOUT the current wave's `[attempt: <salt>]` marker, and assert
the harvest either refuses attribution or receipts a named `harvest_miss`; and assert the accepted
harvests (W4-01/W4-02) carry the marker in the recovered content.

### F5 — W4's authoritative-sha attribution is not discriminated from a plain working-tree read (B1)

**Row:** W4-01 / W4-02.

**Attack:** B1's whole point is that recovery must come from the run's authoritative result sha
(the #99 accessor, `application.mjs:11364-11370`), not a content probe of the working tree. But
the mock's edits WRITE the file into the working tree before the row asserts, and the rows only
assert `found.resultSha === receipt.outcomes[0].resultSha` + ok/matched flags. An implementation
that harvests by `readFileSync(join(repo, entry.path))` from the working tree returns identical
bytes and identical sha — and passes both rows without ever touching the accessor. The B1 hole
the fold claims to close is not closed by the row.

**Concrete suite fix:** after the run settles, DELETE (or mutate) the working-tree file before
asserting harvest, and require the harvest to still recover the sha's bytes (via
`run.inspect { section:'result' }` / `git cat-file <resultSha>`) — or assert `entry.bytes` equals
the git blob at `entry.resultSha`. A working-tree read then misses; only the accessor recovers.

---

## 2. Missing-row gaps (v1.1 promises with NO row)

### F6 — The plural verb is pinned only positively; the singular exclusion is not (OQ2 half-pin)

**Gap:** W6-01 asserts `parseBatonCli(['waves','run',specPath]).command === 'waves.run'` and
`mcpApplicationToolNames().includes('baton_waves_run')`. It never asserts the singular `wave run`
is refused (the existing family already corrects singular→plural — `application-cli.mjs:1309-1314`)
nor that `baton_wave_run` (singular) is ABSENT from the MCP surface. An implementation exposing
BOTH spellings passes W6-01 despite breaking the "family plural" fold (OQ2).

**Concrete suite fix:** add assertions that `parseBatonCli(['wave','run',specPath])` refuses (or
maps to the plural corrective with the `cli_command_unavailable`/corrective path) and that
`mcpApplicationToolNames()` does not include `baton_wave_run`.

### F7 — D3 bound rows the fold claims but no row exercises: elevate typed-refusal ≤2; answerDecisions first-match-wins, `(runId,requestId)` dedup, `allowFreeResponse` → `text`

**Gap:** `contract-fold.md` Phase-2 lists "elevate exactly once per `(runId, role)` with refires
deduped, ≤2 retries" and "answerDecisions … first-match-wins insertion order, optionId validation,
`(runId, requestId)` dedup, non-match defers". W3-elevate-bounds only tests note-REFIRE dedup;
it never produces a `scratchpad_write_conflict`/`scratchpad_partition_exhausted` refusal
(coordinator.mjs:10521-10522) to exercise the ≤2-retry-then-evidence line. W3-answer-bounds tests
non-match→defer and invalid optionId→refuse, but no row fires two matching patterns (first-match-wins
is unpinned), no row fires the same requestId twice (dedup unpinned), and no row uses a decision with
`allowFreeResponse: true` (the `text` answer path is untested).

**Concrete suite fix:** add (a) a refuse-twice-then-succeed elevate scenario asserting exactly 2
retries then the named evidence line on final failure; (b) a two-pattern policy where both match
one question — assert the insertion-order first match wins; (c) a repeated decision with the same
`(runId, requestId)` — assert one answer call; (d) a free-response decision — assert the adapter's
`answer` receives `{ text }`.

### F8 — D4/D5 promises with no row: the <200-byte recovery, the exact 64 KiB bound, the realpath-symlink half of containment, and a `mustContain` PASS

**Gap:** (a) the fold drops the 200-byte floor — a SHORT-but-present path must be recovered, never
silently dropped — but W4-02's absent path is missing entirely, so a short present path is untested;
(b) W1-03's oversize case writes 512 KiB, but D5 pins 64 KiB — an implementation with a 256 KiB
bound passes W1-03 yet violates the contract (the bound is not pinned at its exact value);
(c) D4/D5 mandate the `mcp-descriptor.mjs:46-72` lexical + `realpathSync` DOUBLE check, but
W1-03/W1-05 only test lexical `..` and absolute escapes — a `repo/ok/../secret` traversal or a
symlink escape (`repo/notes` → `/etc`) is untested; (d) no row exercises a `mustContain` that
MATCHES (the post-check passing case), so the row cannot tell a selection-mechanism implementation
from a post-check implementation on the success path.

**Concrete suite fix:** add a present path under 200 bytes (assert recovered `ok`, never `miss`),
a 64 KiB + 1 byte objectiveRef (assert `workflow_objective_ref_invalid`), a symlink-escape
objectiveRef and harvest path (assert the realpath refusal), and a matching-`mustContain` harvest
case (assert `ok`, with `expected`/`actual` receipted).

### F9 — D6 `verdict` (and the incomplete-`basis` branch) is unpinned

**Gap:** D6 defines `verdict` = `'WAVE-OK'` (all members settled + all harvest paths recovered) or
`'WAVE-INCOMPLETE'` naming the miss; `basis` = `'completed'` when all members settle, else the spec
manifest digest. W1-06/W2-01 assert the receipt carries `verdict` but never its VALUE; W4-02 is the
natural incomplete case but asserts nothing about verdict; no row pins the digest branch of `basis`.
An implementation returning a constant or absent verdict passes every row.

**Concrete suite fix:** assert `verdict === 'WAVE-OK'` in W1-06 and W2-01; assert
`verdict === 'WAVE-INCOMPLETE'` naming `reports/w4-b-extra.md` (and `basis` = the spec manifest
digest) in W4-02.

### F10 — W5-01's import law is under-pinned: the zero-touch oracle is vacuous and the transitive module-graph rule is untested

**Gap:** (a) the "recording facade" (`workflow-as-data-red.test.mjs:1048-1053`) is constructed
AFTER the dynamic import — import-time side effects cannot be observed, and `touched` can never be
non-empty; the behavioral "importing starts nothing" assertion is vacuous. (b) D2 requires "the
module graph must not transitively import a module with a top-level `await openBaton(...)`" — W5-01
only scans the lane module's OWN source for network constructors and top-level await. A lane that
imports a bespoke driver (each of which runs `openBaton` + `waves.start` at top level, GT4) passes
the static scan and re-import idempotence while violating the law.

**Concrete suite fix:** (a) instrument BEFORE the import — proxy `waves.start`/`runs.start` (or the
module loader) and assert zero touches across the import; or delete the vacuous facade and rely on
the static scan alone. (b) walk the lane module's static `import` specifiers recursively and assert
no transitively-imported module contains a top-level `await openBaton(`/`waves.start`.

---

## 3. Green-state determinism (hermeticity + determinism axis)

### F11 — The suite never configures the lane's driver policy: a faithful implementation runs the 20 s default poll and the suite becomes slow/flaky

**Attack:** `wave-driver.mjs:35-41` DEFAULT_POLICY ships `pollIntervalMs: 20_000`,
`stallTimeoutMs: 20*60_000`, `hardCapMs: 3*3_600_000`, `settleTimeoutMs: 5_000` — and its own
comment says "the red suite overrides these with short relative timeouts". The suite calls
`runWorkflow(spec)` with NO options (every `laneOf` site) and the fixture (`wadFixture`) never
threads a driver policy into the lane. The lane signature is `runWorkflow(spec|specPath, options?)`
but no row passes driver options. A faithful implementation therefore waits up to 20 s per poll to
notice each member's terminality: W2-01 (4 members), W3-signal (700 ms worker, lead noticed at next
poll), W3-message (`delayMs:500`), W3-checkpoint (pausable), W4-01/02 — roughly a dozen rows at
≥20 s each ≈ 4-6 minutes, and the scenario `delayMs`/`stopDeadlineMs: 2000` budgets (500-700 ms
delays under a 2 s stop deadline) are recomputed against a 20 s poll cadence. Under any per-test
CI timeout this is the campaign's #7 flake cluster.

**Concrete suite fix:** thread a fast driver policy through the lane options in the fixture —
`runWorkflow(spec, { driver: { pollIntervalMs: 15, stallTimeoutMs: 400, hardCapMs: 3000 } })`
(P3 proves `createWaveDriver` accepts exactly this vocabulary) — and pin that options-shape in the
suite header and row map. Then the W3/W4 timing budgets are bounded and load-insensitive.

---

## 4. Minor findings (over-pins, loose oracles, fragility)

**F12 — W1-02 over-pins scope admission beyond the contract's "mirrors path-scope.mjs" text.**
The `'scope'` bare-directory case (`scope: ['reports']`) and the reserved-`work` case are wave.mjs
`validateMember` laws (`wave.mjs:57-88`); `path-scope.mjs` alone ACCEPTS `['reports']` (it rejects
only NUL / absolute / backslash / `..`-segment). The contract D1 says member scope admission
"mirrors path-scope.mjs instead", which a strict reader implements as path-scope-only. The suite
requires the UNION (wave.mjs member laws + path-scope's class). Passable only because a correct
lane must translate `createWave`'s `wave_scope_invalid`/`wave_member_role_reserved` into
`workflow_member_invalid`, but the contract text is misleading. **Fix:** state that member admission
= wave.mjs's member laws (role/reserved/scope-array/exact/objective) PLUS path-scope's
`..`/absolute/backslash/NUL class, all refusing `workflow_member_invalid`.

**F13 — W6-02 over-pins the allowlist MECHANISM.** The row requires each of the five codes as a
quoted literal inside `stateFailureCode`. A `startsWith('workflow_')` prefix-preservation branch
(the same idiom the allowlist already uses for `application_*`/`worker_policy_*`/`run_orchestrator_*`)
preserves all five codes and satisfies B3's outcome ("a `workflow_*` refusal surfaces typed") but
fails the quoted-literal check. **Fix:** accept either the five quoted literals or a `workflow_`
prefix-preservation branch in the region.

**F14 — W1-06's receipt-shape oracle is loose.** It asserts `Object.hasOwn` for the seven D6 keys
but not the exact key-set (extra keys pass) nor the sorted-key order its own comment claims
("keys in ACTUAL sorted order (contract law)" — no assertion enforces order), and never checks
`verdict`/`basis` values (F9). **Fix:** assert `Object.keys(receipt)` deep-equals the seven sorted
keys and assert `verdict`/`basis`.

**F15 — W2-01's zero-driver-script static self-check is a self-check on the TEST file, not the
implementation.** The banned-verb scan reads the suite's own source; it can only catch the test
author hand-driving a wave handle, never an implementation shipping a bespoke per-wave driver (which
does not appear in the suite source). It is also fragile: any future edit to the file containing
`setInterval`, `while (`, `.status()`, etc. (even in a comment) flips W2-01 red for the wrong
reason. (Today the scan passes: all seven banned substrings are absent — verified.) **Fix:** either
drop the self-check (the single-lane API already pins the surface) or move the "no bespoke driver"
assertion onto the implementation's module graph.

**F16 — Hermeticity nits: real clocks and timer budgets.** `mockPrincipal` uses
`expiresAt: new Date(Date.now() + 60000)` — a 60 s wall-clock TTL on W6-01's principal (latent flake
if the green-state MCP leg slows, cf. F11); `realServer` passes `now: () => Date.now()`. The
scenario `delayMs` values (W3-message 500, W3-signal 700) are real timers with 2-4x headroom under
`stopDeadlineMs: 2000` — acceptable today but the budget is meaningless once F11's 20 s poll cadence
is in play. **Fix:** replace the principal TTL with a fixed far-future ISO (or a `now` injection) and
re-derive the delayMs budgets against the driver policy F11 pins.

---

## 5. What is SOUND (keep as-is in the fold)

- **P1-P4** — the four green guards are stable across both runs and pin the real substrate
  (exports, frozen recipes container, driver vocabulary, 7 MiB envelope + 64-member ceiling).
- **W1-01/W1-04** — the top-level and steering closure rows are well-shaped (code + field-named
  message per case); the `verification`-carried refusal (B4), the `schemaVersion` enum cases, the
  function-at-`messageOnSpawn.body` case (B6), and the nested-unknown/enum cases are discriminating.
- **W1-03** — the missing/escape/oversize refusal shape is right (bound imprecision in F8b).
- **W1-05** — harvest type/unknown-key/escape refusals are right (symlink half in F8c).
- **W1-06** — structurally sound once the `report` field is declared (F2) and the shape oracle is
  tightened (F14).
- **W2-01** — the 4-outcome/resultSha/file-on-disk/`basis:'completed'` structure is a genuine
  re-drive pin (self-check caveat in F15).
- **W3-answer / W3-answer-bounds** — the only policy rows with a real wire observable; keep.
- **W4-01/W4-02** — the `waveId` binding (B2) and `resultSha` attribution shapes are right; they
  need the attempt-marker row (F4) and the working-tree-delete discriminator (F5) to actually close
  B1/B2.
- **W5-01** — the static no-network/no-top-level-await scan of the lane module itself is
  discriminating; add the transitive-graph walk (F10b) and fix the vacuous facade (F10a).
- **W6-01** — the three-surface `{code,message}` payload comparison is the right B3 pin; add the
  singular-exclusion (F6).
- **W6-02** — an appropriate static B3 proxy; loosen the mechanism (F13).

## 6. Fold action summary

The suite needs a fold before it is safe as the rung's red-first acceptance: F1 (fix the deaf
adapter + delivered-keying semantic), F2 (declare `report` in D1), F5 (working-tree-delete
discriminator), F10 (transitive import-graph + real zero-touch oracle), F4/F7/F8/F9 (add the four
missing-row families), F3 (add wire observables to the W3 rows), F11 (thread the fast driver policy),
and the minor tightening F6/F12-F16. The four green guards and the W1 closure rows, W3-answer/
-answer-bounds, W6-01, and W6-02 survive substantially unchanged.
