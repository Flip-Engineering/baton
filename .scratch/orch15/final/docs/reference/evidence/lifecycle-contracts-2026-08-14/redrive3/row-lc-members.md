# ROW BRIEF — row-lc-members: the members contract

Read `foundry-brief.md` first (the frame + laws bind you — Ring-2 form, citation discipline, attempt-echo in the first five lines). Your issue set + the campaign evidence behind each:

- #199: member-creation failures produce NO store events (no task.created, no reservation, no refusal) — the receipt reads 'failed' for members that never existed
- #200: member task ids derive from the objectiveRef PATH without the wave namespace — same-path re-drives bind the prior task (live or dead)
- #204: the resident has no drain-restart; impl landings force a manual restart that kills in-flight waves (the v12→v13 dance today)

**Read also:** the named issues via the local evidence dirs (gh may be unauthenticated in your worktree — the campaign's incident record lives in `docs/PROGRESS.md` + the per-issue evidence dirs under `docs/reference/evidence/` + the issue comments are summarized in the foundry frames' commit history). Ground EVERY ground-truth in the real code before pinning it.

**Deliverable:** `docs/reference/evidence/lifecycle-contracts-2026-08-14/redrive3/contract-members.md` ONLY (plus the shared publish). The contract carries: ground truths (cited) → decisions (D-numbered) → the refusal vocabulary (closed, typed, surface-constant) → red-first acceptance pins (each RED at HEAD at a named stage; each green only for a correct impl) → open questions. This is the package-③ contract — it gates its suite + impl.

## Addendum (orchestrator, 2026-08-14 — ground #218 in this contract)

The spawn-wedge's mechanism is now KNOWN: adapter seat ceilings gate spawns INSIDE the
adapter call, so the member lifecycle never enters a typed state — no event, no roster
truth, no queue position (v16: 24 reservations / 5 materialized / 19 silent; v17's healthy
window = exactly the seat budget). Your member-creation contract MUST specify:
1. **seat_queued as a first-class ledgered member state** (adapter key, queue position, the
   holding member ids) — emitted the moment a spawn waits on a ceiling, never a silent pend.
2. **Spawn-stage transition events at every hop** (reservation → worktree → native spawn →
   ready): a stall is a named state with a seq, per the contract's existing anti-phantom aim.
3. **Admission-time serialization honesty**: waves.run's receipt names per-adapter row counts
   vs ceilings ("4 deepseek rows on 4 seats: serialized, est. order …") — the launcher learns
   the truth at admission, not after 44 silent minutes.
4. The phantom-class refusals (#199/#200/#204) compose WITH this: a member may be
   seat_queued AND later fail typed — the states must distinguish, never collapse.
