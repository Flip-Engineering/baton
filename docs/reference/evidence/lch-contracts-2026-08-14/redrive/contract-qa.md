CONTRACT-QA v1

[attempt: fcd0b7ea-f684-4c3c-a417-19cf736c8509 coordinator]

Coordinator QA — the lch-contracts four-row foundry (package ④ lifecycle-honesty, wave
`lch-contracts-2026-08-14-wave-b-rd1`). Every claim below is cited evidence (on-disk files, git
SHAs, `sed -n`/`grep -an`/`git ls-tree` reads, reservation records) or an explicitly named absence.
No clocks, no fabrication. Verdicts drive the landing.

---

## 0. Frame integrity — the briefs and the wavefile disagree about WHICH four contracts

This is the first finding and it is authority-class (escalated in §9).

- The **wavefile** (`redrive/lch-contracts.wavefile:2-36`) names the four watched rows as
  `row-wake`, `row-death`, `row-retry`, `row-quiescence-compat`, reporting `contract-wake.md`,
  `contract-death.md`, `contract-retry.md`, `contract-quiescence-compat.md`. The `signalOnMembersDone`
  line (`:42`) watches exactly those four.
- The four **row briefs** on disk (`row-wake.md`, `row-death.md`, `row-retry.md`,
  `row-quiescence-compat.md`) all self-describe as **package ④ lifecycle-honesty** and carry the
  issue set #71/#181 (wake), #182 (death), #201/#188/#50/#55 (retry), #163-composition (quiescence).
- The **coordinator brief** (`redrive/coordinator-brief.md:3-5`) names a DIFFERENT four —
  "filesystem (row-lc-fs) · launch/receipt honesty (row-lc-launch) · member-creation honesty
  (row-lc-members) · the ledger invariant (row-lc-ledger)" — the **package ③ wave-lifecycle** rows.
  `diff` against `lifecycle-contracts-2026-08-14/redrive/coordinator-brief.md` is byte-identical
  (verified). The brief was copied from the sibling wave and not re-pointed.
- The **foundry brief** (`redrive/foundry-brief.md`) is a franken-brief: line 3 says "package (④)"
  but its "Row assignments" section (`:27-36`) still lists `row-lc-fs → contract-filesystem.md`,
  `row-lc-launch → contract-launch.md`, `row-lc-members → contract-members.md`,
  `row-lc-ledger → contract-ledger.md`, and its campaign-evidence block (`:10-14`) cites the package ③
  issue set (#168/#172/#173/#185/#199/#200/#207/#202/#204/#194), none of which belong to the four
  row briefs in this directory.

**Ruling for this QA:** the wavefile is the dispatcher's ground truth (it is what was actually
spawned, per the reservations in §1), so this QA cross-checks the four contracts the wavefile
harvests — `contract-wake/death/retry/quiescence-compat.md`. The brief/foundry mismatch is recorded
as a blocker the fold must fix (§7) and escalated as a frame-authority question (§9).

---

## 1. Signal status

| Lane | Expected (wavefile) | Observed | State |
|---|---|---|---|
| `signalOnMembersDone` | `result` to the coordinator once `row-wake,row-death,row-retry,row-quiescence-compat` are **all** settled (`redrive/lch-contracts.wavefile:42`) | — | **NOT RECEIVED** — 1 of 4 rows is terminal; the other 3 produced no report on disk |

The signal condition ("All four rows settled") is unmet. One watched row (row-death) has settled;
the other three have not. This is the #175 corrected semantics — `signalOnMembersDone` names the
watched rows and the remaining member (this coordinator) is the recipient — verified against
`redrive/lch-contracts.wavefile:42`.

---

## 2. On-disk verification (the #174 law — silence is not death)

- **`contract-death.md` — PRESENT**, but only as a snapshot commit, not in any live worktree:
  `5fc5a21 "baton snapshot: ws-8b7ec42e4894475ce11c9b314569f791"` (1 file, 446 insertions). The
  row-death worktree `ws-8b7ec42e4894475ce11c9b314569f791` is no longer in `reservations.json` (it
  was released after snapshot). The file does not appear in the `3bb5791`, `bcca97b` (wave base), or
  `09200e9` (current master) trees (`git ls-tree` on all three returns only the pack: briefs +
  wavefile + the four `row-*.md` briefs).
- **`contract-wake.md`, `contract-retry.md`, `contract-quiescence-compat.md` — ABSENT everywhere.**
  `find` across `.baton/wt/ws-*` and `docs/` returns nothing; no `baton/ws-*` branch tip carries
  them (all tips are `09200e9` or `3bb5791`); no commit in `git log --all` touches them (only
  `contract-death.md` ever appears).
- The live reservations (`/Users/wahargis/Development/Experiments/baton/.baton/capacity/reservations.json`)
  show three worker worktrees materialized at `baseSha 3bb5791` (the row-side effective-tree
  snapshot: `ws-2d68d7304edb05756324003095efaaae`, `ws-7b4e6de3c56bfa60cfb2441e115f0070`,
  `ws-9d2f107948471e94f18d9e68c6751e3a`) and a later batch at `baseSha 09200e9`. The reservation
  records carry no `role` tag, so the exact role→worktree mapping is not observable; by count and
  order the three `3bb5791` worktrees are the three not-yet-settled rows.

`not-landed` is not `dead` (the #174 law): the three absent rows are not marked dead, and I verified
against disk rather than assuming from silence. What is true at verification time is that three of
four rows have produced no contract, so there is no contract text to cite-audit, pin-test, or fold
for them — recorded, not fabricated.

---

## 3. Per-contract verdicts

| Row | Report (this dir) | Issue set | State on disk | Verdict |
|---|---|---|---|---|
| row-death | `contract-death.md` | #182 | PRESENT (snapshot `5fc5a21`) | **sound** — minor citation nits; 3 authority-class DRs pending |
| row-wake | `contract-wake.md` | #71 · #181 | ABSENT | **needs-fold** — blocker: row not landed |
| row-retry | `contract-retry.md` | #201 · #188 · #50 · #55 | ABSENT | **needs-fold** — blocker: row not landed |
| row-quiescence-compat | `contract-quiescence-compat.md` | #163-composition | ABSENT | **needs-fold** — blocker: row not landed |

Only row-death has a contract to grade; it grades **sound**. The other three are ungradable — the
blocker is the same authority-class fact (rows not landed), escalated in §9.

---

## 4. Spot-check record (citation audit)

### 4a. `contract-death.md` — full audit against its cited HEAD `3bb5791`

The contract self-declares verification at "HEAD `3bb5791`" ("Baton private effective-tree
snapshot"). `3bb5791` is neither ancestor nor descendant of current master `09200e9` (merge-base
`cf298c2`); the cited `impl/src` files drift between them (`coordinator.mjs` ~24 lines,
`application.mjs` ~25 lines, `workflow-interpreter.mjs` ~31 lines). Every anchor below was checked
against `3bb5791` (the row's own HEAD) unless noted.

| Anchor cited | Verified | Result |
|---|---|---|
| `coordinator.mjs:71-76` — `REARM_KINDS` closed set | `approval.resolved, decision.settled, lifecycle.turn_started, question.answered` | ✓ exact |
| `coordinator.mjs:80-85` — `PUSH_REFUSAL_CODES` | the four `attention_push_*` codes | ✓ exact |
| `coordinator.mjs:13460` — `terminalCause kind:'provider_failure'` | `handle.terminalCause ??= deepFreeze({ kind: 'provider_failure', code })` | ✓ exact |
| `coordinator.mjs:13850` — trust-gate `policy_failure` | `handle.terminalCause ??= deepFreeze({ kind: 'policy_failure', code })` | ✓ exact |
| `coordinator.mjs:12953` / `:4191` — provider-crash/refusal blocks | assignment starts on the cited line; `kind`/`code` on the next | ✓ exact |
| `coordinator.mjs:9468` — `budget_exceeded` / `budget_hard_limit_exceeded` | assignment starts `:9468`; the `kind: 'budget_exceeded', code: 'budget_hard_limit_exceeded'` literal is on `:9469` | ✗ off-by-one (trivial) |
| `coordinator.mjs:4` — quoted "the hub re-runs it — the trust gate" | line 4 is `// trust gate. See spec/IMPLEMENTATION.md (CLUSTER 1 — CORE) and spec/RECONCILIATION.md`; "trust gate" present, **"the hub re-runs it" absent** | ✗ misquote (minor) |
| `coordinator.mjs:3920` — `_gateVerdictItemForWorker` | method header on the cited line | ✓ exact |
| `wave.mjs:472` — `terminalCause:'start'` | `Object.assign(outcome, { phase:'failed', terminalCause:'start', terminal:true, … })` | ✓ exact |
| `wave.mjs:353` — member-never-started `terminalCause:'start'` | same literal on the member push | ✓ exact |
| `application.mjs:6510` — stop-receipt closed key set | `Object.keys(outcome).sort().join(',') !== 'checks,counts,remainingCount,targetCount'` | ✓ exact (the closed set is enforced) |
| `coordination-store.mjs:6395` / `:6510` — `terminalCause(task)` + surfacing | `const terminalCause = (task) => {` … `termination: terminalCause(task)` | ✓ exact |
| `web-stream.mjs:39-42` — `TERMINAL_CAUSE_FIELDS` | the 10-field set (`kind,code,category,summary,remediation,retryable,dimension,used,limit,ratio`) | ✓ set matches |
| `web-operator.mjs:187` — `validCause` | `wireObject(value, new Set([…same 10…]))` | ✓ exact |
| `referee.mjs:258` — "refusing to trust-gate a worker's own worktree (R1)" | exact string | ✓ exact |
| `application-deployment.mjs:405` — `credentialState:'expired'` | `Object.freeze({ state:'blocked', code, credentialState:'expired', … })` | ✓ exact |
| `cli-adapters.mjs:422` — wire `terminalCause` strings | `timeoutFailure ? 'timeout' : wireFailure ? 'wire_frame_oversize' : null` | ✓ exact |
| `route-liveness.mjs:182` — `route_unavailable` | `this._fail(route, credentialKey, 'route_unavailable', …)` | ✓ exact |
| `kernel-honesty-audit.md:53` — bare-`empty`-over-existing-pin | the fleet AX-wave report verbatim | ✓ exact |
| `kernel-honesty-audit.md:43` — #148 credential ~24 h death | `ttlMs = sessionTtlMs` default `24*60*60*1000`, no `expiresAt` published | ✓ exact |
| `kernel-honesty-audit.md:76` — NUL discipline | audit says NUL bytes **at specific lines** (`coordination-store.mjs:16604`, `application.mjs:626`) as cache-key separators; the contract's paraphrase "carries one NUL byte per line" overstates it | ✗ paraphrase drift (minor) |
| `kernel-honesty-audit.md:5-8` — the #41/#169 posture | the two-defect scope + "refusals name holder/cause/next" | ✓ accurate |

**Citation verdict: sound.** 17 of 20 anchors are exact; the 3 non-exact are minor (one off-by-one,
one misquote of a header comment, one paraphrase drift) — none moves a ground truth or a pin.

**RED robustness across the commit drift:** the contract's G8 RED is "`suspicionClass` absent".
`grep -rn suspicionClass impl` is empty in **both** `3bb5791` and `09200e9` (verified). So every pin
is RED at the row's HEAD *and* at current master — the contract's red-first claim survives the
`3bb5791`→`09200e9` drift because the RED is an absence, not a line number.

### 4b. The three absent rows — seed-anchor audit (the anchors each contract inherits)

| Anchor (row brief) | Verified on disk | Result |
|---|---|---|
| row-retry / row-quiescence cross-ref — `contract-foundry-2026-08-13/contract-163.md` (#163 folded) | file present (64,335 B) | ✓ present |
| row-quiescence — quiescence candidate predicate `progressClass`/liveness gating | `application-semantics.mjs:38-121` closed `progressClass` vocabulary; `coordinator.mjs:6261` `worker_not_quiescent` | ✓ machinery exists |
| row-wake — park/re-arm + wake-with-message | `coordinator.mjs:2098/2163/2278-2279/2454/2500/2609` park/unpark/wake machinery | ✓ machinery exists |
| row-retry — "the roster shows 'retrying' honestly" (#201) | `grep -rn "'retrying'" impl/src` returns nothing | ✓ absent — the honest-retrying state is genuinely RED (matches the brief's requirement that it be added) |
| row-wake — evidence dir `channel-audit-2026-08-13/` + lane-proof landing note | dir present with `landing-note.md`, `audit-qa.md`, row briefs | ✓ present |

---

## 5. Acceptance pins + refusal vocabulary — assessed on the one landed contract

**Acceptance pins (`contract-death.md` §4).** Eleven behavior pins (P1–P11, plus P7-neg) and one
static conformance pin (S1). Shallow-greenability is **low**:

- Every pin names a `stage:` — the HEAD failure seam (the `suspicionClass` absence, G8) — and asserts
  **both** the derived class **and** its closed D3 evidence object. A wrong impl that stamps a class
  string without deriving evidence fails the evidence-shape half of the assertion.
- Three negative pins close the obvious shallow-green holes: P7-neg (bare-`empty` over an existing
  pin must NOT classify `clean_terminal`), P9 (a self-reported "clean" over a `health.scope_violation`
  must classify `watchdog_stall`), P10 (a null `ownedCount` must NOT be coalesced to 0/clean).
- S1 is a surface-conformance check that fails on an unmapped death (an input no class consumes), so
  "classify everything as clean and pass" is structurally impossible.

The two pins that are **not** independently greenable — P8 (trust-gate kill) and P11 (`budget_exceeded`)
— are correctly gated on the row's own authority-class DR1/DR2 ("GREEN only under the chosen option"),
not silently resolved. This is the correct posture: the row names the gap and escalates rather than
folding a contested taxonomy decision into the pin.

**Refusal vocabulary (§3).** Four refusals — `death_evidence_absent`, `death_class_open`,
`death_self_reported`, `death_coalesced_unknown` — each a typed code carrying holder/cause/next (the
#160 actionability triple), and each surface-constant (the D3 shapes are one-shape-per-class across
web/MCP/CLI/wire). It is explicitly **closed**: "there is no fifth `death_unknown` escape hatch". A
terminal run that triggers none of the four and none of the seven classes is `clean_terminal`, and
that classification is itself pinned (P7) and conformance-gated (S1). **Sound.**

---

## 6. Boundary map (the four share the wave lifecycle — package ④)

Declared seams (from the four row briefs; three of four are unlanded, so this is the *intended*
map, not the verified one):

- **wake** — park/re-arm + wake-with-message (#71 orchestrator wake, #181 member wake-on-signal).
  Non-terminal.
- **death** — terminal runs carry a derived `suspicionClass` + durable evidence (#182). Terminal.
- **retry** — classify-then-resume (#201): the #182 classifier is the **precondition**;
  content-addressed re-drive with declared inheritance (#59); #188 failure-stall review; #50/#55
  stream-death/stall-marker folds; #163 quiescence must read `retrying` correctly.
- **quiescence-compat** — the composition contract: how parked-for-signal (#181), retrying (#201),
  and silent-but-working members interact with the quiescence candidate predicate (progressClass /
  liveness gating per the folded #163).

**Overlaps (one owner per seam — the fold must reconcile):**

1. **death ↔ retry** — the `suspicionClass` is the handoff. Death classifies the terminal run;
   retry's "classify-then-resume" consumes exactly that classification. Both own the class taxonomy
   edge: death defines the seven, retry defines which classes are resumable. The resumability map is
   the shared seam.
2. **retry ↔ quiescence** — "quiescence must read retrying correctly" (row-retry brief cites the
   folded #163). A retrying member must not satisfy the quiescence candidate predicate. Both contract
   the `retrying` state's visibility into `progressClass`.
3. **wake ↔ quiescence** — parked-for-signal members (#181) must not be quiesced. Both contract the
   parked member's `progressClass`.

**Gaps (uncontracted seams of the shared lifecycle — named):**

1. **silent-but-working vs stalled** — quiescence-compat says a silent-but-working member must not be
   quiesced; death's `watchdog_stall` (#67/#50/#55) says a silent member past the liveness window IS
   dead. The discriminating predicate (progress/`health.*` liveness) is shared by two contracts and
   owned by neither.
2. **wake-failure vs death** — #181's six instances are "signal recipients' turns ended before
   delivery". Whether a failed wake re-parks the member (wake) or terminates it into a class (death)
   is uncontracted.

---

## 7. Fold instruction set (concrete)

1. **Fix the frame.** Re-point `redrive/coordinator-brief.md` and the `foundry-brief.md`
   "Row assignments" block to wake/death/retry/quiescence-compat (package ④), or record the wavefile
   as authoritative and mark the two briefs stale. This QA ruled the wavefile authoritative (§0) — the
   fold must make the briefs agree.
2. **contract-death.md — fix the three citation nits**: `coordinator.mjs:4` drop the "the hub
   re-runs it" parenthetical (keep "the trust gate"); `:9468`→`:9469` for the `budget_exceeded` kind
   literal; reword the NUL note to "NUL bytes at `coordination-store.mjs:16604`/`application.mjs:626`
   as cache-key separators" (matching `kernel-honesty-audit.md:76`).
3. **contract-death.md — re-verify RED at master HEAD `09200e9`** (it currently declares `3bb5791`;
   RED holds at both, but the fold pins the landing to master, and the `coordinator.mjs`/`application.mjs`
   line drift means re-anchoring before a pin is quoted into the suite).
4. **Resolve DR1/DR2/DR3** (authority-class, `contract-death.md` §5) before P8/P11 can green: the
   trust-gate/policy-failure home, the `budget_exceeded` home, and the cascade tie-break ordering.
5. **Land the three absent rows.** `contract-wake/retry/quiescence-compat.md` must exist before a
   full four-way cross-check is possible; until then their verdict is needs-fold (row-not-landed),
   not sound.
6. **Reconcile the three overlaps** (§6): assign one owner each to (a) the death→retry resumability
   map, (b) the retrying-state `progressClass` projection, (c) the parked-member exclusion.
7. **Decide the two gaps** (§6): assign the silent-vs-stall predicate to one owner (quiescence or
   death) and the wake-failure-vs-death boundary to one owner, or record both out-of-scope in the fold.

---

## 8. Publish-to-shared — the refusal, recorded

Instructed to "Publish to `shared` — or record the refusal." The exact outcome is a silent scope
hardcode, not a typed refusal, and it is still live at this base:

- `coordination-store.mjs:14169` — `const scope = \`worker:${fields.workerId}\`;` inside
  `writeScratchpad` hardcodes the worker-facing write scope to the worker partition; there is no
  worker-visible path to a `shared` scope.
- `coordination-store.mjs:12559` — `if (auth?.actor !== 'orchestrator') invalid('settlement task
  requires the orchestrator actor');` — the `shared`-scope settlement path is orchestrator-only.

A coordinator publish-to-`shared` is therefore silently admitted into `worker:<id>`, never `shared`.
This is the #158 root cause, live because no member of this wave contracts the write lane. No exact
refusal string exists to record — the refusal is the admission. (This QA's own deliverable is written
to its report path, which the wavefile harvest picks up; there is no separate `shared` surface to
write.)

---

## 9. Escalation (authority-class — via DECISION_REQUEST, options + recommendation)

**E-1 — Frame authority: which four contracts is this wave contracting?** The briefs name
`fs/launch/members/ledger` (package ③); the wavefile and row briefs name `wake/death/retry/quiescence`
(package ④). This QA ruled the wavefile authoritative. Options: **(a)** accept the wavefile rows
(wake/death/retry/quiescence) — *recommended, matches what was actually spawned*; **(b)** accept the
brief rows (fs/launch/members/ledger) and re-drive those rows; **(c)** treat the wave as a two-package
contract and re-scope. *Escalated because a wrong ruling sends the fold at the wrong four contracts.*

**E-2 — Disposition of the three unlanded rows.** `contract-wake/retry/quiescence-compat.md` are
absent on disk; `signalOnMembersDone` is unmet. Options: **(a) release-gapped** — conclude now with
the three marked needs-fold; **(b) hold-recheck** — hold the coordinator open and re-verify on disk
after a re-check window (the rows are reserved, not dead — #174); **(c) redrive-rows** — re-drive
the three rows and re-signal. *Recommended: hold-recheck, with redrive-rows as the fallback if the
three `3bb5791` reservations do not materialize a contract.*

**E-3 — HEAD pinning for "RED at HEAD".** contract-death.md declares RED at `3bb5791`; current
master is `09200e9` and the two have diverged in `impl/src`. Options: **(a)** pin all acceptance pins
to master HEAD at fold time — *recommended*; **(b)** accept per-worktree HEAD. *Escalated because the
fold's red-first guarantee is only as strong as the HEAD it pins.*

---

## 10. Residual register

1. **Signal absent.** `signalOnMembersDone` did not fire; 1 of 4 watched rows is terminal. Recorded,
   not fabricated.
2. **Three rows unlanded.** `contract-wake/retry/quiescence-compat.md` absent from every worktree,
   branch tip, and relevant commit. Verdict needs-fold (row-not-landed).
3. **Frame mismatch.** `coordinator-brief.md` (byte-identical to the package ③ wave's brief) and the
   foundry-brief's row-assignments disagree with the wavefile's rows. Ruled wavefile-authoritative (§0).
4. **Base drift.** contract-death.md verified at `3bb5791`; master is `09200e9`; `impl/src`
   `coordinator.mjs`/`application.mjs`/`workflow-interpreter.mjs` drifted. RED (absence of
   `suspicionClass`) holds at both.
5. **Shared publish gapped** (§8) — a live #158 confirmation, not a lifecycle-contract regression.
