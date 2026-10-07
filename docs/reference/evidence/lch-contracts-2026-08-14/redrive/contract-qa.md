CONTRACT-QA v1
[attempt: 15c11102-ef3b-4c25-8161-8e283cb31eff coordinator]
# LIFECYCLE-CONTRACT QA — cross-check of the four wave-④ row contracts (redrive, wave-b-rd1)

Verification HEAD for this QA: `09200e97c1be113946459d901c8fab56034d8a1f` (this worktree's
baseSha; read-only code citations verified this session with `grep -an`/`sed -n` — NUL
discipline on `application.mjs`/`coordination-store.mjs`, plain grep elsewhere).

**STATUS: INCREMENTAL DRAFT.** Sections 0–1 are final (verified this session). Sections 2–5
(one per row contract) are filled as each contract lands on disk; a section marked PENDING
means the deliverable was not yet present at the time of the last write — the #174 law
(silence is not death; sibling worktrees at `../../wt/ws-*/`) is honored by polling, and no
verdict is fabricated for an unread contract.

---

## 0 — Frame resolution (the wavefile governs; a recorded discrepancy)

The coordinator brief's prose names four rows `row-lc-fs` / `row-lc-launch` / `row-lc-members`
/ `row-lc-ledger` (wave-③ lifecycle-honesty split). The wave's `lch-contracts.wavefile` — the
authoritative membership + harvest spec for `wave lch-contracts-2026-08-14-wave-b-rd1` — names
a DIFFERENT four: `row-wake`, `row-death`, `row-retry`, `row-quiescence-compat`, with reports
`contract-wake.md`, `contract-death.md`, `contract-retry.md`, `contract-quiescence-compat.md`,
and `harvest` lines pinning each to `mustContain "contract"`. The wavefile and the row briefs
present in this directory agree with each other; only the coordinator-brief prose is stale.
**Resolution:** the wavefile governs (its `signalOnMembersDone row-wake,row-death,row-retry,
row-quiescence-compat` is the settlement signal this QA waits on). This discrepancy is a
finding about brief hygiene, not a blocker: the audit dimensions named in the coordinator
brief (citation audit ≥3 anchors/contract, shallow-greenability of pins, closed refusal
vocabulary, cross-contract boundary coherence) apply unchanged to the actual four.

## 1 — Pre-audit ground truths (verified this session at HEAD `09200e9`)

The folded #163 quiescence contract (`docs/reference/evidence/contract-foundry-2026-08-13/
contract-163.md`, verified at `e371f704`) is the shared upstream for row-retry and
row-quiescence-compat. Three impl commits (`a3e96e8`..`09200e9`) landed between its
verification HEAD and this one; the drift was re-measured so the row contracts' citations can
be audited against CURRENT lines, not inherited ones:

| Construct | #163 cite (e371f704) | This QA's measure (09200e9) | Verdict |
|---|---|---|---|
| `PRODUCTION_WORKFLOW_DRIVER` (3h cap — #163 still unlanded) | application.mjs:117-119 | 117-119 (unchanged; `hardCapMs: 3 * 3_600_000`) | SOUND |
| `DEFAULT_DRIVER` / `normalizeDriver` | workflow-interpreter.mjs:414 / 416-422 | 414 / 416-422 | SOUND |
| `readView` outline extraction (`const io = …`) | :437 | **:451** (region drifted ~+14) | DRIFT |
| `TERMINAL_PHASES` set | :464 | **:478** | DRIFT |
| drive-loop condition (`Date.now() - startedAt < driver.hardCapMs`) | :736 | **:783** | DRIFT |
| terminal-member sweep (`pending.delete(role)`) | :733 | **:780** | DRIFT |
| stuck-decision early-break | :753-757 | **:800-802** | DRIFT |
| `steering_message_undelivered` push | :798 | **:845** | DRIFT |
| verdict enum `WAVE-OK`/`WAVE-INCOMPLETE` | :604 | **:628** | DRIFT |
| `_observeWatchdogEvent` "EVERYTHING ELSE IS SILENCE" | coordinator.mjs:9382 | **:9681** (method head :9614) | DRIFT |
| `wave.close()` stop sweep | wave.mjs:451-486 | **:492-503**; a new `settle({timeoutMs})` clock loop sits at :447-463 | DRIFT + new seam |
| `REARM_KINDS` | coordinator.mjs:71-76 | 71-76 | SOUND |
| `PROGRESS_SILENCE_THRESHOLD_MS = 120_000` | application-semantics.mjs:54 | :54 | SOUND |
| F14 receipt key-set pin | workflow-as-data-red.test.mjs:705 | :705 | SOUND |

Additional session facts the row audits will lean on:

- **G-a (`suspicionClass` is RED).** No occurrence of `suspicionClass`/`deathCertificate`
  anywhere in `impl/src/` (grepped this session) — the death contract's premise (the
  classifier does not exist at HEAD) holds.
- **G-b (the signal latch).** `signalOnMembersDone` fires at workflow-interpreter.mjs:787-797
  under a `signaled` latch (state seeded :566), pushing `steering[]` `{ trigger:
  'signalOnMembersDone', role, doneRoles, recipients }` (:797) — note this is a `trigger`
  line, unlike #163's G7 evidence-only lines. Admission validation of the policy is
  :272-286 (closed key-set, `MESSAGE_KINDS` membership, non-empty roles).
- **G-c (parked-turn projection).** `paused` is projected honestly at application.mjs:5852
  (node path) and :7266 (attempt path, checked before the `anyDispatched` fallback,
  subordinate to runStop precedence); the parked-state outbound law lives at
  coordination-store.mjs:141-143 (`paused` → `working`/`failed`/`cancelled` only).
- **G-d (the publish channel).** `run.scratchpad.append` exists only on the web-northbound
  surface (web-northbound.mjs:53,100,144,168); the application facade dispatch carries
  `run.scratchpad.read`/`run.scratchpad.elevate` ONLY (application.mjs:12654-12655). This
  session holds no worker run handle, so the `shared` publish is not executable here — the
  durable file (this one) is the channel, and the gap is recorded per the #158 evidence law
  (same posture as #163's OQ1). `shared` is therefore NOT treated as authoritative.

---

## 2 — contract-wake.md (row-wake: #71 orchestrator wake + #181 member wake-on-signal)

**PENDING — deliverable not yet on disk at last write.** No verdict recorded.

## 3 — contract-death.md (row-death: #182 death certificates)

**PENDING — deliverable not yet on disk at last write.** No verdict recorded.

## 4 — contract-retry.md (row-retry: #201 durable member retry)

**PENDING — deliverable not yet on disk at last write.** No verdict recorded.

## 5 — contract-quiescence-compat.md (row-quiescence-compat: wake/retry/quiescence coherence)

**PENDING — deliverable not yet on disk at last write.** No verdict recorded.

## 6 — Cross-contract boundary map

**PENDING** — written after sections 2–5: overlaps, gaps, and seam agreements between the
four (the expected pressure points: death's suspicionClass is retry's classifier
precondition; quiescence-compat must read both `retrying` and `parked-for-signal` states; the
wake contract's park/re-arm machinery must agree with #163's liveness re-arm vocabulary).

## 7 — Fold instruction set

**PENDING** — only where a section 2–5 verdict is `needs-fold`: named blockers, each with the
concrete instruction (what to change, which pin/citation it repairs, re-verify command).

## 8 — Judgment calls & escalations

1. **Wavefile-over-brief** (section 0): recorded as a judgment call, not escalated — the two
   artifacts disagree only in row naming; the audit dimensions are identical and the wavefile
   is the spec's own authority on membership (its `signalOnMembersDone` and `harvest` lines
   are mutually consistent). If the operator prefers the brief's wave-③ rows as the actual
   wave membership, that is a wave-spec change, not a QA finding.
2. **`shared` publish inexecutable** (G-d): recorded refusal-with-evidence, not escalated —
   the durable-file fallback matches the #163 OQ1 precedent and the harvest target is this
   file's `mustContain "CONTRACT-QA v1"`.
