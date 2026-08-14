[attempt: e354aeda-f975-4520-83a6-7533eb6ff998 coordinator]
# PHASE-QA — campaign-as-DSL rung (phase-grammar-2026-08-14-wave-a-rd5)

Coordinator acceptance gate. Date: 2026-08-14. This is the campaign's shared deliverable; it is
written to `redrive5/phase-qa.md` per the authoritative `Work only within: …/redrive5/**`
constraint (the same judgment the contract row recorded — the wavefile's parent-path `report`/`harvest`
fields are the stale pre-redrive copies; every redrive writes into its own subdirectory).

## FINAL CAMPAIGN VERDICT — **HOLD**

The contract row landed a complete, verified contract; the other three rows are **stalled on a
coordination deadlock** (recorded prominently below) and have produced no implementation. The
acceptance suite cannot run, and the live two-phase demo **cannot run** (refusal verbatim recorded).
This is the campaign's structural blocker, not a row-quality failure in the one deliverable that did land.

---

## 1. PER-ROW VERDICTS

| Row | Deliverable | Verdict |
|---|---|---|
| row-contract | `redrive5/phase-grammar-contract.md` (38,729 B, landed 10:22:48) | **SOUND** |
| row-suite | `suite-notes.md` + `impl/test/workflow-phases-red.test.mjs` | **NEEDS-FOLD** — absent (stalled) |
| row-impl-compiler | `impl-compiler-notes.md` + `impl/src/workflow-dsl.mjs` changes | **NEEDS-FOLD** — absent (stalled) |
| row-impl-interpreter | `impl-interpreter-notes.md` + `impl/src/workflow-interpreter.mjs` changes | **NEEDS-FOLD** — placeholder only (stalled) |

### row-contract — SOUND
The contract (`redrive5/phase-grammar-contract.md`, attempt salt matches
`e354aeda-f975-4520-83a6-7533eb6ff998 row-contract`) is ring-2 complete: ground truths G1–G7 →
decisions D1–D7 (phase syntax, `outcome` extraction, closed `when:` vocabulary, checkpoint phases,
couplings, mid-flight amendment, v2 spec shape) → a closed nine-code refusal extension → red-first
pins P1–P9/R1–R6/S1–S4 → open questions OQ1–OQ6. Its citations were re-verified against HEAD this
session (see §3). One recorded judgment call — the **shared-publish refusal** — is the root of the
campaign deadlock (§5).

### row-suite / row-impl-compiler / row-impl-interpreter — NEEDS-FOLD (blocker: no deliverable)
None of the three produced its deliverable by 10:45 PDT (~35 min after wave start, ~23 min after the
contract landed). The interpreter row's notes are a 5,983-byte placeholder (`impl-interpreter-notes.md`,
updated 10:35:49) recording extensive pre-work reading and an anticipated design, but it is explicitly
`Status: AWAIT-INPUTS` — it is polling for `phase-grammar-contract.md` + `suite-notes.md` and states
verbatim: **"The contract row has not published."** The suite and compiler rows produced nothing at
all. These are blockers, not row-quality findings: the rows cannot proceed because the contract is
isolated in the contract row's own worktree (§5).

---

## 2. ACCEPTANCE EVIDENCE

### 2.1 — `impl/test/workflow-phases-red.test.mjs` green at named stages — **CANNOT RUN**
The file does not exist anywhere in the wave's worktrees (`find .baton/wt -name
'workflow-phases-red.test.mjs'` → empty). No suite ⇒ no named stages to observe ⇒ no two-phase
end-to-end pin to confirm. Zero pins weakened (nothing to weaken) — but also nothing to verify.

### 2.2 — Adjacent DSL/interpreter suite set (baseline at HEAD `5ae2c7e5`, clean tree)
Run from the repo root (`node --test impl/test/workflow-*.test.mjs`, split for load):

| Suite | Result |
|---|---|
| `workflow-dsl-red.test.mjs` | **35/35 pass** |
| `workflow-as-data-red.test.mjs` | **30/30 pass** |
| `workflow-dsl-package-red.test.mjs` | **12/12 pass** |
| `workflow-policy.test.mjs` | **2/2 pass** |
| `workflow-surface-red.test.mjs` | **35 pass / 2 fail** |

Aggregate: 116 tests, 114 pass, 2 fail. The **two pre-existing reds at HEAD** are named and quoted
(not silently absorbed):

1. **`FP-14-tools`** (`workflow-surface-red.test.mjs:1424`) — `AssertionError: the ordinary surface is
   exactly the landed 27 + the six + baton_waves_run (#114) + baton_waves_list (#132) +
   baton_waves_compile (#170) — a stowaway tool greens nothing (blue-team D5) · 37 !== 36`.
2. **`FP-15`** (`workflow-surface-red.test.mjs:1533`) — `AssertionError: The input did not match the
   regular expression /2048/u · actual '{"ok":false,"error":{"code":"application_message_send_invalid"}}'`.

These two are pre-existing at HEAD (git tree clean, verified independently by the interpreter row's
notes: "35 pass / 2 pre-existing red: FP-14-tools, FP-15 — verified PRE-EXISTING at HEAD"). They are
unrelated to the phase rung and are not introduced by any row's work.

### 2.3 — Contract conformance spot-audit (three decisions vs. the code)
Full impl-vs-contract conformance is blocked (no impl). The contract's **ground truths** were
spot-audited against HEAD and hold:

- **D1/G1 — the 16-directive closed registry**: `workflow-dsl.mjs:39-56` `WAVEFILE_DIRECTIVES` matches
  the contract's enumeration exactly; the compiler is a pure function (S1 verified: `grep -nE
  'eval\(|new Function|Function\(|import\(' impl/src/workflow-dsl.mjs` → empty).
- **D3/G5 — closed predicate + no-clock law**: the drive-time `hardCapMs` refusal the contract cites at
  `workflow-interpreter.mjs:426-428` is present verbatim ("retired under the #163 law"); the closed
  refusal family holds (S2 verified: `grep -rn 'workflow_compile_invalid' impl/src/` → empty — no 6th code).
- **D5/G4 — coupling preconditions**: the `shared` precondition #158 is landed
  (`run.scratchpad.append` at `application-semantics.mjs:1710`); the `tight` precondition #102 is not
  (`impl/test/tight-cell-red.test.mjs` present, red by design) — matching the contract's honest
  asymmetry. The `when:` lowering's closed vocabulary (D3) cannot be audited against a compiler that
  does not yet implement `phase`/`when`/`outcome`/`couple`.

### 2.4 — The live two-phase demo — **CANNOT RUN (refusal verbatim recorded)**
The demo wave was authored in the NEW grammar (`redrive5/demo-two-phase.wavefile`: phase `demo-a`
writes `demo-a-outcome.md` with `outcome: pass`; phase `demo-b` `when demo-a.verdict == "pass"`
writes `demo-b-ran.md`). Compiling it against the HEAD compiler (`compileWavefile`, the only phase
entry that exists at HEAD) refuses exactly as the contract's R6 pin predicts:

```
REFUSED code=workflow_spec_invalid
line=5 field="phase" expected="<closed directive list>"
message=wavefile line 5: unknown directive — expected one of wave, member, harness, model, effort,
scope, objectiveRef, report, approveOnAdvertisedPlan, claimOnStall, nudgeOnCheckpoint, messageOnSpawn,
elevateWhenNotes, answerDecisions, signalOnMembersDone, harvest
```

There is no phase compiler/interpreter to drive, so the wave cannot be launched and no store events
(`wave.started` / member admissions / `wave.closed`) exist to cite proving that phase B's member
started only after phase A's outcome. The demo is the grammar's first live dogfood and it **cannot
run** — that is recorded here as a finding, not silently skipped.

---

## 3. ESCALATION — THE COORDINATION DEADLOCK (prominent)

**The campaign is deadlocked because the contract row's deliverable is not visible to the other three
rows.** Evidence:

1. The contract exists only at
   `ws-062867f01c43147a7ac75265a01f362c/docs/reference/evidence/phase-grammar-2026-08-14/redrive5/phase-grammar-contract.md`.
   It is in **no shared location**: not the main repo's evidence dir (checked
   `/Users/wahargis/Development/Experiments/baton/docs/reference/evidence/phase-grammar-2026-08-14/` —
   only briefs + redrive2/3/4/5 brief copies), not the parent dir of any other worktree.
2. The contract row recorded a **shared-publish refusal** (contract header §"Shared-publish refusal")
   and wrote to `redrive5/` only, citing the scope constraint — leaving the campaign-level publish to
   the coordinator.
3. The downstream rows' await-inputs discipline polls *their own* view. The interpreter row's notes
   state verbatim: "polling … for `phase-grammar-contract.md` + `suite-notes.md` (main evidence dir and
   redrive5) … **The contract row has not published**." The suite and compiler rows produced nothing.

**Root cause (coordinator's read):** the redrive constraint `Work only within: …/redrive5/**` conflicts
with the wavefile's shared-parent `report`/`harvest` paths. Every row honors the constraint, so each
writes into its *own* `redrive5/` and the shared parent never receives the contract — the await-inputs
chain (contract → suite → compiler+interpreter) starts only if a downstream row happens to cross-search
sibling worktrees. This is a **deployment-routing defect**, not a row defect. This coordinator cannot
repair it within the same constraint (publishing the contract to the shared parent would itself be an
out-of-scope write), so it is escalated here rather than masked.

**Late update (10:58, post first-draft):** the block is *latency/visibility*, not absolute — the
interpreter row self-recovered the contract into its own `redrive5/` at 10:57:34 (35 min after it
landed) by cross-worktree search, and is now reading it. The suite row (the chain's bottleneck) and the
compiler row had still produced **nothing** as of 10:59 (no `suite-notes.md`, no
`workflow-phases-red.test.mjs`, no `impl-compiler-notes.md`, no impl-file modification). The verdict
below is unchanged: no suite, no impl, acceptance + demo cannot run — hold, with completion possible
only on a much longer horizon than this acceptance window.

**Recommended fix (for the next redrive):** either (a) the contract row's deliverable path is
re-pointed to the shared parent and the shared publish is made mandatory, or (b) the downstream rows'
await-inputs polling is widened to scan sibling worktrees/`master`, or (c) the coordinator is given a
shared-publish carve-out in its scope.

---

## 4. ACCEPTANCE SUMMARY

| # | Item | Status |
|---|---|---|
| 1 | `workflow-phases-red.test.mjs` green at named stages | ❌ cannot run (no suite) |
| 2 | Adjacent DSL/interpreter suite set green | ⚠️ baseline only — 114/116 pass; 2 pre-existing reds named+quoted |
| 3 | Contract conformance spot-audit (3 decisions) | ⚠️ ground-truths verified; impl audit blocked (no impl) |
| 4 | Live two-phase demo | ❌ cannot run — refusal verbatim recorded (§2.4) |

**Final verdict: HOLD** — the one landed deliverable (contract) is sound, but the campaign cannot
land while three rows are deadlocked and no phase implementation exists to accept or dogfood.
