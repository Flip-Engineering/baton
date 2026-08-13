# SUITE FOUNDRY wave-b — shared frame (multi-member red-first suite workflow, 2026-08-13)

Every member reads this first. This wave writes RED-FIRST SUITES for four FOLDED contracts in
parallel — one per row — with a heavyweight coordinator verifying the splits. Same doctrine as
suite foundry wave-a (whose four suites landed and are now gate citizens), with three lessons
folded in from wave-a's landing.

## The suite law (binds every member)

1. **Red-first:** every capability row fails at a NAMED stage in the assertion message at HEAD;
   every PIN row is green at HEAD and under a correct impl but fails a plausible wrong one.
2. **Hermetic:** mkdtemp fixtures, `test.after` cleanup, no network, no real provider spawns,
   no host state.
3. **No clocks as controls** (fake timers are test doubles, never workflow controls).
4. **Namespace imports** for invented surfaces (`import * as ns from '../src/x.mjs'`).
5. **Sorted-key literals in ACTUAL sorted order; `localeCompare` banned.**
6. **`watchdog.stallMs`** a valid positive integer in every fixture (`60_000` + the one-line
   comment); `stallAction` only from the contract vocabulary.
7. **Static source anchors:** ORDER/EXISTENCE/byte-string assertions only — never absolute
   line-window anchors (#166).
8. **Split-twice:** run your suite twice from the repo root; record both splits in your notes.
9. **THE ATTEMPT-ECHO LAW (#171):** your `[attempt: <salt> <role>]` line goes VERBATIM (a) in
   the suite file's header comment AND (b) in your notes file — **within the first five lines**
   of each. The harvest refuses attribution without it.

## Lessons folded in from wave-a (they cost real work)

- **For the coordinator — the #174 law:** row deliverables live in ROW WORKTREES until the
  wave settles; your own worktree and master will NOT show them mid-flight. From your worktree,
  sibling worktrees are reachable at `../../wt/ws-*/<path>` — CHECK THERE before any
  dead-row verdict. `signalOnMembersDone` may not have fired when you expect; on-disk content
  is the ground truth, silence is not death (#163's filed evidence). A deliverable missing its
  attempt marker is still work (the harvest miss is recoverable) — never verdict a row dead
  while its files exist anywhere reachable.
- **For rows:** publish your notes to the `shared` scratchpad partition as you go (kind `note`,
  title = your issue number). If the publish fails, record the exact refusal in your notes file
  — that failure is itself campaign evidence (#158).

## Row assignments

- `row-suite-155` → `docs/reference/evidence/cli-silent-start-2026-08-13/cli-silent-start-contract.md` (v1.1 FOLDED) → writes `impl/test/cli-silent-start-red.test.mjs`
- `row-suite-156` → `docs/reference/evidence/mcp-profile-parity-2026-08-13/mcp-profile-parity-contract.md` (v1.1) → writes `impl/test/mcp-profile-parity-red.test.mjs`
- `row-suite-161` → `docs/reference/evidence/orchestrator-plan-object-2026-08-13/orchestrator-plan-object-contract.md` (v2.0 FOLDED) → writes `impl/test/orchestrator-plan-object-red.test.mjs`
- `row-suite-164` → `docs/reference/evidence/blind-waits-2026-08-13/blind-waits-contract.md` (v2 FOLDED) → writes `impl/test/blind-waits-red.test.mjs`

Each row ALSO writes `suite-draft-notes.md` in the contract's evidence dir (the row inventory +
stage table + both measured splits + your judgment calls).
