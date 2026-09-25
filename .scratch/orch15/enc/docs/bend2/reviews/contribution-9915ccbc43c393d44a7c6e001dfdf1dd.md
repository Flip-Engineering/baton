# Review: contribution-9915ccbc43c393d44a7c6e001dfdf1dd

| | |
|---|---|
| Author | bend2-laws-lead3 |
| Captured at | `a35ed3f3` on top of `6638a471`; revises `docs/bend2/laws-proposed.md` to revision 8 and corrects `docs/bend2/laws-design-notes.md` |
| Scope | the r6-review findings |
| Decision | accept |
| Review row | `swarm.contribution_reviewed` seq see below, 2026-09-22 |
| Reviewer | bend2-reviewer, independent seat |
| Hold note | reviewed under the authorized check; this file is intentionally left **uncommitted** until the root resumes |

## What was run and what it answered

- **Composition.** 17 labeled entries, matching the stated "(17 prohibitions)": each of the 17
  M-headings carries one `Forbidden:` statement, one `Binding reason:` statement and one status
  label (7 extracted, 5 partly enforced, 3 proposed; zero blanket marks).
- **M-18 adopted as its own entry** — "No substitution of a publication destination"
  [proposed] — with the reviewer's wording and its assumptions named rather than an unproved
  guarantee claimed: adapter conformance, endpoint identity, configuration stability and
  delivery are explicit assumptions; the proof shape is Codex's destination-matching probe over
  a two-destination model; an unestablishable destination identity leaves the effect
  unauthorized, and an uncertain dispatched outcome stays unresolved under M-2. Evidence: the
  #556 incident and the operator direction.
- **M-4 scoped**: disposal in violation of custody or preservation; "releasing custody is not
  itself evidence of preservation"; genuinely disposable files need no preservation ceremony.
- **M-5 narrowed to logical preservation** ("physical layouts may change freely, the agreed
  facts may not"); the validation-mechanics clause moved into M-3a as the stale-evidence
  prohibition, citing LEDG-15's checked-equality carrier as the gate form.
- **M-8 carries the instance-and-time-of-effect binding** ("authority for an earlier instance
  cannot authorize an effect on its replacement — generation counters are one implementation,
  not a required design"); the observer-false-claim clause is routed to M-3c.
- **M-9** notes it is a specified part of valid authority (M-8), reopening only on a distinct
  counterexample.
- **M-14 requires the safe explanation** — omitting it is now forbidden, so a bare refusal no
  longer complies.
- **M-17 defines continuation owner** (actual retained responsibility or a recoverable handoff
  path; an orphaned identifier does not satisfy it) **and authorized suspension** (actual
  reason plus resumption authority or condition; intentional operator pause allowed), with
  deadlines, fairness and topology outside the entry.
- **Status labels corrected**: M-5 and M-10 are [partly enforced] with the surviving WAKE-5
  violation explicit; label totals 7 + 5 + 3 = 17.
- **Design-notes record corrected**: the mechanical count reads 47/29/57/1; PM-10 routes to the
  independence premise of the publication-evidence entry; superseded-row annotations mark
  DEV-6 deferred (not kept), DEV-7 excluded (not kept) and the old CX-6 rejection historical,
  with the operative set being the 17-entry list.

## Decision

accept — the r6-review findings are applied exactly, the composition count matches the body,
every entry remains complete, and M-18 states its assumptions instead of an unproved
guarantee.
