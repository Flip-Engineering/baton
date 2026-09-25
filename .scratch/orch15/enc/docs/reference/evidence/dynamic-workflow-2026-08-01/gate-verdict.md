# Gate Verdict — Finding #2 (settle records non-terminal members' partial resultSha on timeout)

> Orchestrator decision: **more-evidence**. This is the one follow-up verification pass
> (re-read `impl/src/wave.mjs` via `grep -an` + targeted ranges), with the extra evidence folded in.

## Verdict (one line)

**REAL defect — confirmed by code structure, but remediation is not yet decided: do NOT mark not-a-bug; do NOT ship a blind fix; the decisive next step is the regression test the finding proposed, which also chooses between the two candidate fixes.**

## What was verified against `impl/src/wave.mjs` (493 lines)

### Mechanism — CONFIRMED (5/5 structural claims)

1. **The outcomes loop runs unconditionally after the deadline.** The deadline-driven `while` is 403–417 (`while (settled.size < state.members.size && Date.now() < deadline)`). The outcomes `for…of` at **418–436** follows it with *no* gate on "deadline was hit" and *no* terminality gate on entering the loop body. So a member still running when `timeoutMs` elapses is harvested. ✅
2. **Non-terminal member ⇒ `outcome.terminal === false`.** Line 428 `outcome.terminal = terminalFrom(outline)`, where `outline` is the fresh `run.status()` snapshot from line 425; `terminalFrom` (107–108) is `outline?.terminal === true || applicationTerminal(outline?.phase)`, so a running member yields `false`. ✅
3. **`materialize` runs with NO terminality gate.** Line 430 `outcome.resultSha = await materialize(entry)` executes for every member with a `run`, terminal or not. The finding's own "Suggested check: require `terminalFrom(outline)` before reading the result section" is precisely the missing gate. ✅
4. **Permanence guard.** Line 419 `if (state.outcomes.some((outcome) => outcome.role === role)) continue;` — once a role has an outcome, it is never re-harvested. ✅
5. **A later `settle()` reaching terminal still skips that role.** On re-settle the `while` loop (403–417) *does* add the now-terminal role to `settled` (line 408–409), but the outcomes `for…of` still hits the guard at 419 and `continue`s — so the terminal outcome and the true `resultSha` are never recorded. ✅

### The "is a sha actually harvested?" question — REALISTIC, not theoretical

`materialize` (381–397) has two paths, both reachable for a non-terminal member:

- **Path A — result section (386–388).** `run.inspect({ depth:'section', section:'result' })` is a *separate* read from the `run.status()` used for the terminal flag. The two reads are non-atomic, so an in-flight result written a poll before the terminal flag flips can be harvested with `terminal:false` (RESULT_SHA = `/^[a-f0-9]{40,64}$/u`, line 18). Narrow race, but real.
- **Path B — `resolveResultPin` fallback (390–396 → 134–155).** This is the documented fallback for the **empty** result section — i.e. *exactly* the non-terminal case. It enumerates **all** `refs/baton/results/*` pins whose committerdate ≥ `startedAt − 60 s` (line 140–144), newest first, and returns the first whose tree carries `member.report` (line 150). It is **not scoped to this run**. So a sibling member's pin — or an unrelated run's pin written since `startedAt` — can be attributed to a non-terminal member. The only mitigation, `excludeShas` (line 395), dedups *within the current outcome set*; it does not scope to the run. This is the strongest realistic corruption vector and it is built to fire precisely when the section is empty.

### Permanence defect is independent of the sha question

Even in the most benign case — `materialize` returns `null`, so the outcome is `{ terminal:false, resultSha:null }` — the guard at 419 still prevents a later `settle()` from ever recording that the member finished. The wave evidence permanently mislabels a *completed* member as non-terminal. That alone is a result-truth / cleanup-truth defect; the partial-sha is an aggravation on top.

### Test gap — CONFIRMED

`grep -rn 'settle' impl/test` surfaces only scratchpad settlement, spawn settlement, and CLI-signal settlement. **No test** exercises wave `settle` with a short `timeoutMs` that leaves a member running, then re-settles after terminality. The regression test the finding proposes does not exist, so the defect is unverified-by-test.

### Live witness path — CONFIRMED (with citation correction)

The finding cites the demo as `run-demo.mjs:118`. Actual location: **`docs/reference/evidence/dynamic-workflow-2026-08-01/run-demo.mjs:118`** (`impl/src/run-demo.mjs` does not exist). Line 118 is `const outcomes = await attached.settle({ timeoutMs: 20_000 });`, and the phase-3 receipt (≈122) maps `outcome.resultSha ?? null` per member. So if the partial-harvest fires, the demo's own receipt carries a `terminal:false` member with a sha — a reproducible witness.

## Why "more-evidence" was the correct gate, and what decides it

The mechanism is fully confirmed, so this is **not not-a-bug**. But shipping a fix *now* risks the wrong remediation: the finding offers two non-equivalent fixes —

- **(F2-a)** gate `materialize` on terminality (skip line 430 when `!outcome.terminal`); and/or
- **(F2-b)** let a later `settle()` replace a prior non-terminal outcome (relax the line-419 skip when the recorded `terminal` is false).

**(F2-a) alone does NOT fix the permanence defect** — a member that finishes after a timeout would still be skipped by guard 419 and never recorded terminal. Only **(F2-b)** (or both) closes that. The regression test the finding proposes — *settle short → leave a member running → settle again after finish → assert the second settle records the terminal outcome* — is exactly what disambiguates which fix is required, and whether Path B pin-attribution actually occurs in practice.

**Recommended next action:** author the F2 regression test (F2-a + F2-b variants) against `impl/src/wave.mjs` settle, run it, and let the failure mode pick the remediation. Do not mark not-a-bug; do not ship a blind fix before that test runs.

---

*Verification method: `grep -an` over `impl/src/wave.mjs` (493 lines) + targeted reads of `terminalFrom` (104–115), `materialize`/`settle` (381–440), `resolveResultPin` (134–155); test grep over `impl/test/**`; demo read at `docs/reference/evidence/dynamic-workflow-2026-08-01/run-demo.mjs:110–122`.*
