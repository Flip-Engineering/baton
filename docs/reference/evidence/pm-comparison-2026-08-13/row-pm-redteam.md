# ROW BRIEF — row-pm-redteam: the scope-creep red-team (the rejection rubric)

Read `foundry-brief.md` first (the shared laws bind you). You are the wave's conscience. The
three comparison rows will produce adoption proposals; your job is to make rejection CHEAP and
CONFIDENT by writing the rubric they get judged by — and by pre-computing the trap list.

## Your work

1. **The rejection rubric** — the standing vetoes, operationalized as QUESTIONS a proposal must
   survive: Does it need a wall clock? (veto) Does it add a per-worker process/resource cost
   instead of hub-shared? (veto) Can its surface lie to the orchestrator? (veto unless
   honesty-pinned) Does it mutate a closed vocabulary? (veto unless additive) Does it duplicate
   machinery baton already has? (ALREADY-HAVE, name it) Does it serve the orchestrator's actual
   recurring costs (observed in THIS campaign's evidence dirs) or an imagined one? (imagined =
   reject) Is it a methodology bypass (code-before-contract)? (veto) Is it pm-shaped because
   pm did it that way, with no baton-native reason? (the "imported ornament" test — veto)
2. **The trap list, pre-computed** — go through the digest YOURSELF and name the specific pm
   mechanisms that are traps for baton, with the one-line reason each: every time-based gate
   (review-after-T-hours, time-boxed budgets, idle detection on wall-clock), per-session
   heaviness, SQLite-local thinking vs baton's content-addressed/git-anchored store
   (a real architectural divergence — evaluate honestly where each is right), hook-injection
   ambient noise risk (an ambient briefing that cries wolf trains the agent to ignore it —
   evaluate the delta-nudge answer), the 37-tool surface breadth (tool-count vs
   discoverability — baton's own #147 audit found surface-area costs).
3. **The pre-registered rejections** — write the list of proposals you EXPECT the other rows
   to make that you would reject, with the rejection pre-written. (Their reports land as
   `pm-kg.md`/`pm-dag.md`/`pm-agent.md` in this dir — if any exist on disk by the time you
   finish, apply your rubric to them directly, per the #174 on-disk law; otherwise your
   pre-registered list stands as the rubric's demonstration.)

Deliverable: `docs/reference/evidence/pm-comparison-2026-08-13/pm-redteam.md` — the rubric, the
trap list (cited to digest files), the pre-registered rejections. Attempt line verbatim in the
first five lines.
