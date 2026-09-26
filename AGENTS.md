# Rules for this project

These rules apply to every agent and harness working on baton. The first section applies to code,
design and review. The rest apply to prose.

# Banned runtime patterns

## No pausing, idling or truncating agents

Baton never deliberately pauses, idles or truncates an agent's work. When an agent's turn ends,
Baton wakes the agent's orchestrator (its parent seat, or the root) with the turn's report, and the
orchestrator decides whether to nudge the agent on. The agent stops when it declares itself done or
its orchestrator stops it. No runtime rule may leave live work waiting on a party that Baton does not
wake. An existing instance is a `priority:high` bug to remove (#572). The first known instance is
the turn-end park recorded under the actor `policy`, which waits for a claim or nudge and wakes no
one.

## No bookkeeping ledgers in place of function

Do not require hand-maintained records to accompany functional changes. That means no checked-in
list of expected test failures, no "converged" declarations, no census file, no test that pins
counts or line numbers of other code, and no author-written declaration of a fact the runtime or
tooling can derive directly (for example, a change declaration that must match a structural scan).
Tests assert independently specified behavior, and that includes protocol constants and functional
fixtures. An inventory that tooling uses is derived from its sources when it is used. A count in a
review record is a measurement at a commit and creates no requirement to keep it in step with later
changes. Known breakage lives in the issue tracker.

A landing gate answers one question: does this change break something that works on the target? It
runs the selected tests with the change and re-runs the failing files on the target. A failure
blocks when the target has no failure with the same identity (file, test, and failure type); a test
that is new with the change has no match on the target, so its failure blocks. A run that produced
no verdict cannot authorize a landing, and every selected file must be accounted for.

In the runtime, a decision about agent work (check selection, admission, refusal, permissions,
prerequisites, continuation) must not change when such records change, and no status, census or
completion declaration may be a prerequisite for continuing work. The Bend2 laws state this as G1
and G2 (docs/bend2/laws-proposed.md on bend2-rewrite, revisions 11 and 12). The expected-red
manifest is removed by #580, and the remaining instances are listed in #582.

## No mechanism without an observed failure

Add a check, gate, guard, durability layer, recovery path, validation rule or review step only when
a real run failed without it. Name that run (the landing, session, seat or resident run) in the
issue or commit that adds the mechanism. These do not justify a mechanism: a constructed probe, a
hypothetical crash window or race, an input that no real run produces, and a finding that a written
property "does not hold over the whole" of something. Do not file, prioritize, route or run lanes
for them, and do not use them to reject or hold a contribution.

State that can be derived again from a durable source is derived again after a crash. A duplicate
wake notice or a re-run is an acceptable result of a crash. A second store with its own crash
safety, built to prevent that result, is not added.

When an agent finds or proposes such a mechanism, remove it. A reviewer judges whether a change does
what it claims on real work. A removal is judged by whether real work still runs, and needs no proof
that the mechanism was never useful. Instances found on 2026-09-25 (#598): the landing-gate "holes"
in #597, built from synthetic verdict documents, and the #592 stage-2 delivery journal, a
checksummed and fsynced store that duplicated the coordination ledger.

# Writing rules

These rules apply to any prose written for or checked into this repository: README, CONTRIBUTING,
`docs/*.md`, issue and PR bodies, commit messages, code comments, and anything else meant to be
read by a person.

## Plain technical English only

Write in plain, simplified, standard technical English. No aphorism, no metaphor, no poetic
description, no narrative flourish. A section heading names what the section covers; it is not a
place for cleverness (write "Design documents", not "the swarm era"; cut lines like "the name: a
conductor's baton directs an orchestra").

## State facts directly, never by contrast to an absent alternative

Never describe a mechanism by contrasting it with something the project does not do or does not
have ("wakes instead of polling", "typed refusals instead of free-text errors", "verification is
re-run, not trusted"). This pattern says what the thing is not rather than what it is, and it reads
as marketing rhetoric, not a technical description. State directly what the thing does.

- Wrong: "Wakes instead of polling."
- Right: "`baton swarm watch --follow` prints one JSON frame per coordination row as it is written."

If an entire section is organized around this contrast (a "why choose this" framing built on a list
of things the project avoids), restructure or cut it — its real content usually already lives
elsewhere once each fact is stated positively.

## No gratuitous or generic commentary

Cut any aside that states something true of any tool in the category, not specific to this
project. ("directs workers, on your own repository" — of course a CLI run in a repository operates
on that repository; this told the reader nothing about baton.) Every sentence should carry
information a reader could not already assume.

## No operational journaling in product-facing documentation

A README, or any document meant to describe the product to someone encountering it, describes what
the software is and does. It does not narrate the project's own development process, internal
workflow, or history as a feature of the product ("every change since <date> has gone through our
own X process" does not belong in a README). Facts about how the project itself is developed
belong in CONTRIBUTING.md or a docs/ ledger such as docs/PROGRESS.md, written for the audience that
is actually doing that work, not folded into the pitch for the software.

## Audience-appropriate density

`docs/*.md` design documents are written for contributors already working in this codebase and may
cite issue numbers (`#441`) and internal mechanism names densely; that is the correct register for
that audience. README.md, CONTRIBUTING.md's introduction, and anything else meant to introduce the
project to someone new must not assume the reader has the issue tracker open, and should explain a
mechanism rather than pointing at a bare issue number with no context.

See the `writing-style` skill for the same rules with worked before/after examples.
