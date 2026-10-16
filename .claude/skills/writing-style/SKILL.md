---
name: writing-style
description: >-
  The house writing style for this project: plain technical English, no
  rhetorical devices. Load this before writing or editing README.md,
  CONTRIBUTING.md, a docs/*.md file, an issue or PR body, or any other prose
  meant for a person to read. Also load it when asked to audit or review
  existing project prose for tone. Full standing rule: AGENTS.md /
  CLAUDE.md at the repo root (always loaded); this skill is the same rule
  with worked examples.
---

# Writing style for baton

Plain, simplified, standard technical English. Nothing else. This applies to README.md,
CONTRIBUTING.md, docs/*.md, issue bodies, PR descriptions, commit messages, and code comments.

## The four rules, each with a real example from this project

### 1. No aphorism, metaphor, poetic description, or narrative flourish

A section heading names what the section covers. Prose states facts; it does not perform.

- Cut: "The name: a conductor's baton directs an orchestra; a relay baton gets passed between
  runners. Both are the point."
- Cut: a section heading like "the swarm era" — rename to what it actually is, e.g. "Design
  documents".

### 2. State facts directly. Never describe something by contrasting it with an absent alternative

Do not write "X instead of Y" or "not Z, but W" where Y or Z is a generic thing the project simply
doesn't do. This pattern describes the absence of something, not the presence of what actually
exists, and it reads as marketing rhetoric rather than a technical description.

- Wrong: "Wakes instead of polling." / "Typed refusals instead of free-text errors." /
  "Verification is re-run, not trusted."
- Right: "`baton swarm watch --follow` prints one JSON frame per coordination row as it is
  written." / "A malformed request is answered with the exact field and rule violated." / "The
  system re-runs verification in a fresh worktree at the seat's commit."

If a whole section is organized around this contrast (a "why choose this" framing built on a list
of things being avoided), restructure it or cut it. Its real content usually already exists
elsewhere once each fact is stated positively — this is exactly what happened to this project's
own README on 2026-09-18: the "Why baton" section was deleted because every one of its bullets was
this pattern, and the facts underneath were already covered by the "What baton is" and
"Architecture" sections once restated directly.

### 3. No gratuitous or generic commentary

Cut anything that is true of any comparable tool, not specific to this project. It gives the
reader no information.

- Cut: "directs other coding-harness sessions as subordinate workers, on your own repository" —
  the clause "on your own repository" is true of every CLI tool ever run in a git repo; it says
  nothing about baton.

### 4. No operational journaling in product-facing documentation

A document meant to describe the product to someone encountering it (README.md, the intro of
CONTRIBUTING.md) describes what the software is and does. It does not narrate the project's own
development process or history as if that were a feature.

- Cut from README.md's Status section: "Every change to this codebase since September 2026 has
  gone through baton's own swarm runtime: a worker is recruited on a live resident and its
  contribution is landed after review." This is a true fact, but it is about the team's internal
  process, not about the software. It belongs in CONTRIBUTING.md (where it already lives, in the
  "self-hosted development loop" section) or docs/PROGRESS.md, written for the audience actually
  doing that work.

## One exception: audience-appropriate density

`docs/*.md` design documents are written for contributors already working in this codebase. They
may cite issue numbers (`#441`) and internal mechanism names densely — that is the correct
register for that audience, and rule 4 does not mean stripping issue citations from those files.
README.md and the introduction of CONTRIBUTING.md are different: they are the entry point for
someone who has never seen the issue tracker, so a claim there needs enough context to stand on its
own, not a bare `#441`.
