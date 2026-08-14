# notes-row-seeds — row report (contract-seeds wave, redrive1)

[attempt: 1faf10bb-21ed-41d5-8bc7-540abddb4af6 row-seeds]

Status: DELIVERED. Four Ring-2 contract seeds written under
`docs/reference/evidence/contract-seeds-2026-08-14/redrive1/`:

- `seed-150.md` — #150 coaching-payload passthrough on both northbounds (web + MCP).
- `seed-151.md` — #151 spill query kind run-horizon authorization.
- `seed-152.md` — #152 workflow-surface docs disclosure + evidenceRef schema.
- `seed-184.md` — #184 the law-list bug farm (four laws → trap → machinery → priority).

Each seed carries the `[attempt: 1faf10bb-21ed-41d5-8bc7-540abddb4af6 row-seeds]` line verbatim in its
first five lines, follows the Ring-2 form (ground truths → decisions → closed refusal vocabulary →
red-first acceptance pins → open questions), cites its origin, and every `file:line` citation was
re-verified this session at HEAD `5ae2c7e5c93d99404d3a292e777dd30f7d2ead27` (grep/sed/Read; NUL
discipline on `application.mjs` / `coordination-store.mjs`).

## Grounding posture

`gh` is unauthenticated in this worktree (`gh issue view` for #150/#151/#152/#184 all fail with
"Please run: gh auth login"), and none of the four issue numbers appears anywhere in this repo's
history (git log + grep across docs/spec/impl/reviews). Per the row brief's explicit fallback
("Ground in `gh issue view 184` if available, else the campaign's commit messages and the evidence
dirs"), every seed is grounded in the campaign material the brief's scope statement names. Each seed's
`Origin` block states this and records the unreachable-issue-body gap as an open question (OQ4 per
seed).

## Judgment calls recorded (per seed)

- seed-150: "coaching payload" covers BOTH landed coaching families — the size-refusal triple
  `{cap, actual, unit, gracefulPath}` AND the authored feedback packet `{summary, findings}` — because
  the brief is plural and both cross the two northbounds. The web northbound's synthesized `field`
  (web-northbound.mjs:407-410) is pinned as the mutation the contract refuses.
- seed-151: the caller's derived run is the ONLY horizon (the wire is already closed against
  caller-named scopes); the cross-run hub-delivery case (a spill cited INTO a run by the D2 attention
  overflow) is left open (OQ1) rather than decided, because re-drive/re-attach semantics aren't
  settled this wave.
- seed-152: "docs disclosure" is read as the surface's disclosed view of workflow state + the
  evidenceRef schema taught as data — NOT a documentation-file deliverable.
- seed-184: priority order ranks silent whole-wave loss (watcher, re-drive) above loud single-turn
  waste (brief cap) and recoverable contamination (partition); the runner-up ordering is recorded.

## DECISION_REQUESTs

None issued. The row brief's scope statements + the landed campaign machinery bound every seed; the
only genuine authority gap (unreachable issue bodies) is recorded as an open question in each seed,
not blocking. No authority-class ambiguity required escalation.

## What was NOT verified and why

- The four issue bodies (#150/#151/#152/#184) — `gh` unauthenticated, numbers absent from history.
  Each seed's OQ4 names the re-scope risk if the issue body differs from the brief's scope statement.
- `application.mjs:1094-1096` / `validText` `application.mjs:225-226` (the contract-146-era
  `application_intent_invalid` anchors) are ABSENT at this HEAD — seed-184 G2 says so explicitly and
  does not cite them.
- Two seed-150 drafts' anchors were found ABSENT at this HEAD during the final verification pass and
  were re-grounded before delivery: (1) the feedback-packet family — `normalizeWorkflowFeedback`,
  `exactObject` at `application.mjs:1656`, the `SECRET_SHAPED_TEXT` guard at `application.mjs:327`, and
  the `derived`/`gateEventSeq` provenance fields are all absent; seed-150 G5/D1/D2/D4/A3 now cite the
  verifiable anchors (`feedbackBody` `workflow-revision.mjs:59-77`, the revision packet
  `workflow-revision.mjs:120`, the closed `run.feedback` inputSchema `application-semantics.mjs:586`,
  the `sendFeedback` client guard `application-client.mjs:1179-1185`, `SECRET_SHAPED_TEXT`
  `messages.mjs:509,538`). (2) `coachingApplicationError` at `application.mjs:247-252` is absent — the
  coaching triple is minted by `coachingError` (`coordinator.mjs:345-350`) and `coachingRefusal`
  (`coordination-store.mjs:706-711`) at this HEAD; seed-150 G1/D1/G4/A2 cite those.
- No live wave was launched or executed for this row; every claim is a static repo citation.

## Deployment verification command

Executable: `true` · argv: `[]` · cwd: `.` · expected exit: 0. Ran in this worktree; exit code 0.
