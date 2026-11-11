# Blue Team — Issue #74 worker-orchestrated-swarm red-first suite (adversarial review)

*Adversarial review of `impl/test/worker-orchestrated-swarm-red.test.mjs` (15 rows: 8 PIN green / 7 RED at
named stages) against the folded #74 contract v1.1 — `contract-fold.md` (this directory), the draft notes
(`suite-draft-notes.md`), and the red-team report (`contract-redteam.md`). Compiled 2026-08-13 against the
current worktree HEAD `20f68fa`. Every citation below was re-derived this session with `grep -an` / `sed -n`
on the NUL-bearing files (`application.mjs`, `coordination-store.mjs`) and plain `grep`/`sed` on the rest,
matching the brief's discipline. The measured split was re-verified this session from the repo root:
`node --test impl/test/worker-orchestrated-swarm-red.test.mjs` — **15 rows · 8 pass · 7 fail**, each red row
failing at its named stage.*

**Verdict scale:** SOUND = the row/suite holds contact with the contract and the landed code; NEEDS-FOLD = a
named failure with a named fix (severity marked blocker / amendment / note in the finding's heading).

**Bottom line: NOT FOLD-READY.** Four fold-blocking gaps and two mechanism errors:

1. **A1/A2 cannot go green as written** — their fixtures install the permissive `authorize: async () => true`,
   which is the deployment seam in the hermetic test, so the D1.2 sibling-refusal leg is unreachable even
   after a correct v1.1 implementation.
2. **A3/A3b's permanence half is unpinned** — an impl can record `{outcome:'denied', refusal}` while still
   marking the key handled, and both rows pass; the contract's literal "do NOT mark the key handled" also
   creates a per-poll re-attempt loop the suite's `.find()` masks.
3. **A2's wave-scoped grant path is unasserted** — a refuse-everything restrictor passes A2.
4. **P-A8-dir / D4's file-not-directory law is not enforced** — `git show <sha>:<dir>` does not fail (the
   contract's stated mechanism is wrong); the directory case only refuses when `mustContain` mismatches, so
   a directory path without `mustContain` harvests `ok:true`.

SOUND across the board for: A4/P-A4 (fully pinned), A5's green-side boundary (owner GREEN leg closes the
refuse-everyone hole), A6's green-side (registry-view change, already documented), P-A7, P-A9, P-A10 (modulo
the static-window churn), and P-A3g.

---

## 1. Green-side blockers (axis 1) — can every red row go green under a CORRECT v1.1 implementation?

### 1.1 A1 / A2 — NEEDS-FOLD (blocker): the fixtures install the permissive authorize, so the D1.2 sibling-refusal legs can never go green.

The restricting authorize is the suite's own invented surface (draft-notes table: "the restricting authorize
at the deployment seam (D1.2) … `authorize(request) → boolean` installed at `application-deployment.mjs:1998`
(permissive `async () => true` at HEAD)"). But the deployment seam is **not** in the hermetic test path:

- The fixture constructs `BatonApplication` directly: `fixture()` defaults to `authorize = async () => true`
  (test `:230`), and `BatonApplication` **requires** an `authorize` function and consults only it —
  `this.authorize = options.authorize` (`application.mjs:2487`); `_authorize` throws `application_unauthorized`
  when the injected function does not return `true` (`application.mjs:3207-3215`); `scratchpadRead` passes
  `{scope}` straight to that authorize (`application.mjs:13040`).
- The production seam the contract names — `createDeployment` wiring `authorize: async () => true`
  (`application-deployment.mjs:2012` at this HEAD; the suite and contract cite `:1998`, a 14-line drift) — is
  bypassed entirely. A1 and A2 call `fixture(t, { adapter })` with **no authorize override** (A1 `:593-600`,
  A2 `:634-641`), so the fixture pins the permissive behavior.
- Consequence: after a correct v1.1 implementation that installs the restrictor **at the deployment seam**
  (the contract's own framing, §D1.2: "requires any deployment running the coordinator-member recipe to
  install the restricting authorize at that seam"), the A1/A2 sibling reads (`:622`, `:668`) still succeed
  inside the fixture → both rows stay RED forever. The red-first contract is unenforceable for D1.2 as written.

**Concrete fix.** A1 and A2 must install the suite's invented restricting authorize in their fixtures —
mirroring A3's pattern (`authorize: async ({ command, principal }) => …`, `:686`). A fixture-level
`restrictingReadAuthorize` implementing the D1.2 read law: allow `shared` always; allow a
`worker:<scope>` read when the principal is the run's top orchestrator (fixture: `principalId === 's74-owner'`);
refuse any sibling `worker:<role>` read (authorize returns `false` → `application_unauthorized` at
`application.mjs:3215`). This is the least-change path and matches the contract's stated enforcement seam. If
the intended implementation instead enforces the read law inside `_authorize`/`scratchpadRead` (the
"unknown ≡ foreign" precedent already built into `scratchpadElevate`, `application.mjs:13068-13076`), then
the rows go green with the permissive fixture — but the contract's "under the default there is no scope
restriction at all" sentence would then be false post-impl and must be amended. Either way the suite must
choose one seam; today it commits to neither.

### 1.2 A3 / A3b — SOUND for the denied/raced RECORD; NEEDS-FOLD on three consequences.

**The fixture CAN drive both legs hermetically (verified).** The interpreter's `answerDecision` calls
`handle.answer` (`workflow-interpreter.mjs:794-809`); `BatonRun.answer` → `application.command('run.answer')`
(`application-client.mjs:1214-1221`) with the facade principal — `bindBaton(application, principalOf('s74-owner'))`
— and `application.answer` → `_authorize('run.answer', principal, runId, …)` (`application.mjs:12631`).
A3's injected authorize denies `run.answer` for `s74-owner` (`:686`) → `_authorize` throws
`application_unauthorized`. A3b's `RefusingAnswerAdapter.answer()` throw propagates: `coordinator.respond`
catches, resets the record to `pending`, and rethrows (`coordinator.mjs:10082-10090`) → `application.answer`
rejects → the interpreter swallows it and records `outcome:'answered'`. Both legs are reachable and both
produce the falsified record at HEAD (the measured REDs). **SOUND on the record leg.**

Three NEEDS-FOLD consequences follow from the contract side:

- **(a) A3 requires `denied.optionId === 'opt-a'` (`:703`), but §D1.3's denied-record shape is
  `{trigger, role, requestId, outcome:'denied', refusal}` — no `optionId`/`text`.** The refusal-vocabulary
  section repeats the shape without the attempted option. A faithful-to-contract implementation that drops
  the attempted option FAILS A3. The audit genuinely needs to know which option was attempted — fold
  `optionId?` (and `text?` for the free-text path) into §D1.3's record shape and the refusal-vocabulary row.
  (A3b, which asserts only `outcome`/`refusal`, is consistent with the current contract shape — the
  discrepancy is A3's sharpness, and the contract should be raised to meet it.)
- **(b) The permanence half is unpinned** — see §2.1.
- **(c) The re-attempt policy is undefined.** §D1.3 says "do NOT mark the decision key handled — neither
  `s.answeredKeys` nor `s.handledDecisionKeys`". But the drive loop's gate is
  `if (!s.answeredKeys.has(key)) { s.answeredKeys.add(key); await answerDecision(…) }`
  (`workflow-interpreter.mjs:697-701`). Remove the pre-answer add and the loop re-attempts a denied ask on
  EVERY poll until `hardCapMs` (LANE_DRIVER: 3000/15 ≈ 200 attempts), accumulating a `denied` record per
  poll; `roleStuckOnHandled` (fires only on `handledDecisionKeys`, `workflow-interpreter.mjs:741-746`) never
  breaks. The suite's `.find()` masks the spam. The contract must state the policy: **a denied decision is
  recorded once and never re-auto-answered** (the ask is left pending for the human; the interpreter skips
  `answerDecisions` for a requestId it has already denied). Pin the trail shape — exactly one `denied` record
  per requestId and no later `answered` for the same requestId.

### 1.3 A5 — SOUND green-side.

The owner GREEN leg (`started.waveId.startsWith('wave:')`, `:756-760`) runs **before** the worker-seat RED
and closes the refuse-everyone shallow green. The RED is reachable hermetically: the worker-seat principal
(`principalId: 'worker:w-1'`, `:762`) drives `waves.start` through the direct port (`application.mjs:12506`),
and a correct D2 impl fires `coordinator_authority_forbidden {attempted, gracefulPath}` at that seam. Note
(minor): a hardcoded allowlist of the four fixture principals would also pass — add a second top-orchestrator
principal (e.g. `s74-observer`) asserting it too can start a wave, pinning seat-CLASS not identity.

### 1.4 A6 — SOUND green-side (registry-view change, already documented).

The `waves.list` view renders string-array members as `route: null, scope: null` and DROPS route/scope for
object-array members (`application.mjs:11738-11760`); the D3 fix is the registry view, as draft-notes item 2
states. The test drives the exposure through `waves.list` (`:820-826`), which exists — the row goes green when
the view carries the route. SOUND.

### 1.5 A8 — green-side reachable; the DELIVERY is unpinned (NEEDS-FOLD).

The RED is real: the interpreter's closed `MESSAGE_KINDS = ['inform','query','steer']`
(`workflow-interpreter.mjs:44`) refuses the example's `kind:'brief'` at admission — the measured
`workflow_steering_unknown`. Widening the interpreter set makes the example drive, but the **underlying
message boundary** still refuses the example kinds: `if (!['inform','query','steer'].includes(kind)) throw
…` (`coordinator.mjs:6864`). Both delivery paths swallow the refusal — `pumpMessageOnSpawn`'s `catch { return; }`
(`workflow-interpreter.mjs:760`) and the `signalOnMembersDone` loop's `catch { /* best-effort */ }`
(`workflow-interpreter.mjs:730`). The suite asserts only the D6 receipt, so an impl that widens only the
interpreter's admission set passes A8 while the coordinator's `brief` and the swarm-settled `result` are
silently dropped — the composition's messages never land. **Concrete fix:** assert the DELIVERY — a
`messageOnSpawn` steering entry with a delivered `messageId`, and the `signalOnMembersDone` recipients — which
forces the coordinator boundary (`coordinator.mjs:6864`) to accept `brief`/`result` end-to-end, not just the
interpreter's closed set.

---

## 2. Shallow-greenability (axis 2)

### 2.1 A3/A3b permanence half — unpinned (NEEDS-FOLD, blocker).

An implementation can record `{outcome:'denied', refusal:<code>}` and STILL mark the key handled (either by
leaving the pre-answer `s.answeredKeys.add(key)` at `workflow-interpreter.mjs:698` or by adding to a handled
set inside the catch), and both rows pass — they assert only the record fields (`outcome`, `refusal`,
`optionId`). The D1.3 permanence consequences (key NOT handled; ask stays pending; a later human answer
settles) are not observable from the post-close receipt: the wave closes the member, so the outcome reads
`stopped`, and the settlement leg is already documented as non-hermetic (draft-notes item 3). **Concrete fix:**
(a) a structural pin on the interpreter — assert `s.answeredKeys.add(key)` does NOT precede the `handle.answer`
attempt (the pre-answer add at `workflow-interpreter.mjs:698` is the permanence mechanism; pin it gone); and
(b) the single-denied-record trail shape from §1.2(c).

### 2.2 A2 over-refusal — the wave-scoped grant path is unasserted (NEEDS-FOLD, blocker).

The D1.2 law point 3 makes the grant a required escape hatch: "a swarm row reads the coordinator's sub-specs
ONLY through an explicit wave-scoped grant, or via `shared`". There is no grant surface in the code (grep of
`impl/src/*.mjs` for scoped read grants returns only board-claim `grantId`s). A restrictor that refuses ALL
sibling `worker:<role>` reads — never implementing the grant — passes A2 as written (own-scope + shared GREEN,
sibling RED are both satisfied). **Concrete fix:** add a green row (or extend A2) with a grant-aware restrictor
whose fixture-level authorize mints an explicit wave-scoped grant, and assert a granted swarm-row read of the
coordinator's `worker:coordinator` partition succeeds. This pins the grant path's reachability and makes
over-refusal fail.

### 2.3 A5 refuse-everyone — closed (SOUND).

The owner GREEN leg (§1.3) prevents "refuse `waves.*` for everyone". The only residual is the hardcoded-
allowlist note, not a shallow green.

---

## 3. The static anchors (axis 3)

### 3.1 Measured drift (re-verified at both HEADs)

The fold's verification HEAD `7e68187` and the current `20f68fa` (the fold HEAD is a commit object but NOT an
ancestor of the current tree — the snapshot history is rewritten):

| Anchor | fold `7e68187` | current `20f68fa` | Δ |
|---|---|---|---|
| `name === 'waves.start'` | `application.mjs:12502` | `:12506` | +4 |
| `name === 'waves.run'` | `application.mjs:12512` | `:12516` | +4 |
| gate throw (`recursive Run command is forbidden`) | `application.mjs:12531` | `:12535` | +4 |
| `authorize: async () => true` (deployment seam) | `application-deployment.mjs:1998` | `:2012` | +14 |
| `is unavailable` throw / `readConnectionJson` / label call site | `application-cli.mjs:126 / :149 / :257` | same | 0 |
| `application command is not authorized` / `message_depth_exceeded` / `'body,inReplyTo'` | `application.mjs:3215` / `coordinator.mjs:12813` / `claude-session.mjs:161` | same | 0 |

The P-A5-static windows (`:12500-12514`, `:12510-12524`, `:12531-12537`) absorbed the +4 silently; the
"re-based for #67" churn was the human-facing comment citations and assertion messages, which are now
internally inconsistent (the file header and P-A5-static comments still cite `:12502/:12508/:12512` while the
gate comment cites `:12535`).

### 3.2 Ruling: keep ORDER / EXISTENCE / byte-string; drop the tight absolute windows.

The load-bearing alarms in P-A5-static and P-A10 are: **(a) the ORDER assertions** — `start < run < gate`
catches the OQ1/A5 hazard (a future widening moving `waves.*` after the recursive gate) and
`notInDefinitions.line < start.line` anchors the ports as direct ports, not definitions entries; **(b) the
EXISTENCE markers** — `srcAnchor` throws if a port becomes a definitions entry or a marker string disappears;
**(c) the byte-string assertions** — `text.includes("'application_unauthorized'")`, `'body,inReplyTo'`, the
closed-five, and the D6 return-literal scan (P-A10). The tight **absolute windows add only a "the region has
not moved >±7" alarm — churn, not hazard**; every landing that touches `application.mjs` above the dispatch
region re-bases them (the +4/+14 drift above is one landing), and the comments then lie.

**Concrete recommendation:** for P-A5-static, keep `start < run < gate` and `notInDefinitions < start` and
drop the numeric windows (the order is the alarm). For P-A10, keep the byte-string assertions and drop the
numeric windows (or widen each to a drift-immune relative bound — e.g. "the authz throw is in
`_authorize`'s tail, the depth boundary is the `message_depth_exceeded` refusal site" — rather than a line
range). This ends the per-landing re-base churn the campaign's pin-drift law currently owns **without losing
the drift alarm**, because the alarm's signal is the order and the byte strings, not the line numbers. If the
campaign prefers keeping numeric windows as a coarse belt, widen them to the enclosing function/region so a
normal landing (≤15 lines) never trips them.

---

## 4. Missing rows (axis 4)

### 4.1 P-D1.4 comment-row — partially honest; the scan is too narrow (NEEDS-FOLD, cheap).

The row self-identifies as a "pin/comment-row + structural pin", which is honest. The loop-shape grep
(`while (pending.size > 0 && Date.now() - startedAt < driver.hardCapMs)`, `workflow-interpreter.mjs:714`)
verifies the loop is pending-set-bounded and driver-hardCap-bounded, and the `doesNotMatch` regex
(`attempts\s*<\s*[0-9]+|counter|iteration`) runs **on the matched loop line only**. A counter inside the loop
body — `processMember`/`answerDecision`/a per-key retry cap — escapes the scan, and the "sequentially uncapped
after human answers" half of D1.4 is unguarded. **Concrete fix:** scan the `driveLane` function body (the
region between `async function driveLane` at `:661` and the next top-level `async function`) with the counter
regex, not just the matched line.

### 4.2 A4 two-level byte-identical refusal — SOUND, fully pinned.

P-A4 is both behavioral (a coordinator-seat discovery draws the byte-identical
`cli_config_invalid: user connection profile is unavailable`) and statically anchored (the throw `:126`, the
`readConnectionJson` def `:149`, the label call site `:257`). All anchors hold at this HEAD. The two-level
absence-is-the-refusal law is pinned as deeply as it can be hermetically.

### 4.3 P-A8-dir / D4 file-not-directory law — NEEDS-FOLD: mechanism error + enforcement gap.

- **The stated mechanism is wrong.** The contract (§D4) and the P-A8-dir comment assert "`git show` on a tree
  (directory) fails". Empirically false — `git show <sha>:<dir>` returns the tree listing and exits 0
  (verified in a scratch repo: `tree <sha>:reports\n\nx.md`).
- **The pin passes for the wrong reason.** `harvestOne` (`workflow-interpreter.mjs:615-651`) recovers the
  listing bytes, and the directory case in P-A8-dir only refuses because the recovered listing fails
  `mustContain: 'coordinator report'`. A directory harvest path **without** `mustContain` would recover the
  listing → `ok:true` → the wave can go `WAVE-OK`. The "file, never a directory" law is therefore not
  structurally enforced; the pin masks the gap.
- **Concrete fix:** (a) correct the mechanism text in §D4 and the suite comment (`git show` on a tree returns
  the listing; a directory only refuses via a `mustContain` mismatch today); (b) enforce the law structurally —
  an admission/refusal-time check that each harvest path is a regular file, refusing `harvest_miss` for
  directories regardless of `mustContain` — and add a directory-path-without-`mustContain` row that turns the
  gap into a RED; (c) the P-A8-dir basis assertion (`basis === manifestDigest`) pins the internal relation but
  not the digest value — acceptable once (b) lands, since the manifestDigest is computed by the interpreter
  from the canonical spec and the internal-consistency relation is the audit's observable.

---

## 5. Verdict roll-up

| Row / surface | Verdict | Fix (if any) |
|---|---|---|
| A1, A2 (D1.2) | **NEEDS-FOLD (blocker)** | fixtures must install the restricting authorize (§1.1); A2 additionally needs the grant path (§2.2) |
| A3, A3b (D1.3) | **NEEDS-FOLD (blocker)** | fold `optionId?`/`text?` into the denied shape (§1.2a); pin permanence (§2.1); state + pin the no-re-attempt policy (§1.2c) |
| A5 (D2) | SOUND | (minor) add a second orchestrator principal to pin seat-class, not identity (§1.3) |
| A6 (D3) | SOUND | none — registry-view change already documented (§1.4) |
| A8 (D4) | **NEEDS-FOLD** | assert message DELIVERY to force the coordinator boundary `:6864` (§1.5) |
| P-A4 (A4) | SOUND | none (§4.2) |
| P-A5-static | SOUND alarm, **NEEDS-FOLD churn** | drop the absolute windows; keep order/existence (§3.2) |
| P-A7, P-A9, P-A3g | SOUND | none |
| P-A8-dir (D4) | **NEEDS-FOLD** | correct the `git show` mechanism; enforce file-not-directory structurally; add the no-mustContain directory RED (§4.3) |
| P-A10 | SOUND alarm, **NEEDS-FOLD churn** | drop the tight windows; keep byte-string (§3.2) |
| P-D1.4 | **NEEDS-FOLD (cheap)** | widen the counter scan to the driveLane body (§4.1) |

**Bottom line:** the suite's seven red rows are correctly red at their named stages and the eight pins are
correctly green (re-verified). But the D1.2 rows cannot demonstrate the law post-implementation without a
fixture seam, the D1.3 rows under-pin the permanence and re-attempt halves, the D4 example's message delivery
and file-not-directory law are both looser than the contract claims, and the static windows are pure re-base
churn. The six seam closures the implementation must land (draft-notes §Deployment verification) stand; the
suite must be folded to make each closure actually assertable.
