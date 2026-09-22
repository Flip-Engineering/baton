# Review: contribution-10b1bebee13a0abe0af2d7617a438ce3

| | |
|---|---|
| Author | bend2-laws-lead3 |
| Captured at | `582e3403` on `baton/ws-0c785133e7b4f5e343f7b0b5d8f4bd48` (on top of `c9e51892`); revises `docs/bend2/laws-proposed.md` to revision 6 and updates `docs/bend2/laws-design-notes.md` |
| Decision | accept |
| Review row | `swarm.contribution_reviewed` seq see below, 2026-09-22 |
| Reviewer | bend2-reviewer, independent seat |
| Hold note | reviewed under the authorized check; this file is intentionally left **uncommitted** until the root resumes |

## What was run and what it answered

- **Composition matches the stated set.** 14 distinct prohibition numbers (M-6 absorbed into
  M-7/M-8 as the exact-binding clause; M-15 deferred; M-16 excluded; M-17 adopted), carried by
  16 headings because M-3 is split into three single-restriction entries — M-3a
  publication-evidence (dirty-tree clause scoped: "unrelated dirty files are irrelevant"),
  M-3b no unauthorized duplicate logical effect under one operation identity, M-3c no claiming
  a new effect that did not occur.
- **Per-entry completeness.** 16 `Forbidden:` statements, 16 `Binding reason:` statements, and
  16 honest status labels: 9 `[extracted` (including M-5 disclosed as "extracted, with one
  proposed clause"), 5 `[partly enforced]`, 2 `[proposed]` — zero blanket `runtime`/
  `development` marks remain.
- **Admission test.** All six questions are stated (specific behavior; binds every
  otherwise-valid implementation; necessary restriction only; scope and exceptional transitions
  explicit; no trivial satisfaction; consistency with other contracts), with the
  proof-mechanics step explicitly held to post-admission.
- **Exclusion and deferral are real.** M-16 stays binding in AGENTS.md and normal review (its
  subject is repository prose, not application behavior); M-15 is deferred to the design notes
  with the operator instruction preserved and "no interpretation is invented to force a law".
- **The rewrites verify.** M-7 bans trusting unvalidated assertions while presenting a
  caller-supplied value stays legitimate; M-8 separates granting authority from personal
  execution (a provisioning role may grant) and observer from reporter; M-1 and M-12 narrow to
  acceptance claims and mandatory waits (queries, refusals, the M-1 durability write and an
  optional caller-selected wait are outside); M-5 is logical preservation permitting atomic
  validate-and-commit; M-9 is ownership preservation permitting waiting, serializable
  transactions and compatible subdivisions; M-17 is the narrow no-silent-abandonment
  prohibition adopted on the Codex counterexample (accept, receipt, detach — M-10 and M-12
  both hold).
- **Reduction record repaired.** The mechanical precedence is defined (rejected over reduced
  over kept) and the tally now matches it: kept 49, reduced 26, rejected 58, retired 1,
  evidence block 1 — 135 rows. The CAP-3 repair (reduced → M-10 and the adopted M-17), the
  CS-02 rewording (the associated flagged entry was withdrawn) and the PM-10/LEDG-17 routes
  (M-7/M-8 and the interface clause) are all present.
- **No other entry lost its scope limits** — the per-entry carve-out sentences are present
  (M-2 inventing versus eventual resolution; M-3b deliberate reapplication; M-10 explicit
  cancellation and the work's own stopping condition; M-11's overlap note to M-2/M-3c/M-7;
  M-12's permitted waits; M-13's optional history inspection; M-14's unknown-remedy validity
  and protected inputs; M-17's authorized suspension).

Design-notes routing is unchanged; extraction base and traces unchanged.

## Decision

accept — the narrowed set is composition-consistent, every entry is single-restriction with an
honest status label, the admission test is complete, the repairs are in, and nothing lost its
scope.
