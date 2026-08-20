# VERIFY NOTES — baton-builds-baton wave-a (2026-08-19)

BATON-BUILDS-BATON-VERIFY v1

Coordinator (verification-only role) report. Verified commit: d7eefe2b
("docs: baton-builds-baton wave-a — the self-hosting pack"), the wave-a head of
this worktree. No code was changed by this coordinator; exactly one file
(these notes) was written, per the coordinator brief.

## Per-row verdicts

- row-plan-effects (#240): FAIL — not landed; `requiredEffects: ['repository_edit']`
  still minted for every profile-derived plan (application-deployment.mjs:948,
  goal-plan.mjs:358-361 keeps the TG5 omission ban) and no
  coordinator-plan-effects-red.test.mjs pin exists.
- row-harvest-recovery (#241): FAIL — not landed; harvest_miss still returns
  `resultSha: null` with no copy of the member outcome's sha
  (workflow-interpreter.mjs:826) and no harvest-recovery-red.test.mjs pin exists.
- row-resume-wiring (#201): FAIL — not landed; no coordinator.resumeOrphans
  method and no orphan-resume-red.test.mjs pin exists anywhere in the repo.

## Evidence

Rows' landing targets (wavefile harvest paths) — all ABSENT:

- docs/reference/evidence/baton-builds-baton-2026-08-19/wave-a/notes-row-plan-effects.md
- docs/reference/evidence/baton-builds-baton-2026-08-19/wave-a/notes-row-harvest-recovery.md
- docs/reference/evidence/baton-builds-baton-2026-08-19/wave-a/notes-row-resume-wiring.md
- impl/test/coordinator-plan-effects-red.test.mjs
- impl/test/harvest-recovery-red.test.mjs
- impl/test/orphan-resume-red.test.mjs

Repo-wide search for `resumeOrphans`, `orphan-resume-red`, `harvest-recovery-red`,
`coordinator-plan-effects-red`, `recoverySha`, `notes-row-` matches ONLY the
briefs/wavefile text — zero implementation matches.

Row worktrees ws-2352baab, ws-3a2c88bb, ws-fa4a6f2b (the three row members):
all clean at d7eefe2b; reflogs show a bare reset to HEAD at 18:06 (minutes
after the wave-a pack commit at 18:01) with no commits ever made. Hub roster:
no live row agents. The rows produced no work in any worktree.

## Seams the rows were to land on — confirmed present (unfixed)

- #201 seams (3d9b5550): store.orphans({liveWorkers}) at coordination-store.mjs:15291;
  retry_pending park, sessionRef binding, --resume/--session-dir argv in
  coordinator.mjs/omp-rpc.mjs. The successor's resume-INTENT projection
  (coordinator.resumeOrphans) is the missing wiring.
- #240 failure mode live: profile-derived plans declare
  requiredEffects ['repository_edit'] (application-deployment.mjs:948); the
  trust gate required_effect refusal (coordinator.mjs:13618-13630) therefore
  still fires for a verification-only coordinator whose sole write is
  docs/**verify-notes.
- #241 failure mode live: harvestOne miss path hardcodes resultSha: null
  (workflow-interpreter.mjs:826) although outcomes carry per-member resultSha
  (workflow-interpreter.mjs:736).

## Outcome

WAVE-INCOMPLETE: the requested repository improvement is NOT implemented. The
three wavefile harvests on notes-row-*.md (mustContain "attempt:") and the
row deliverables are all unmet. Recommendation for the next wave: re-dispatch
the three rows (this coordinator's scope is verification-only and cannot
implement them).
