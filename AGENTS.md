# Rules for this project

These rules apply to every agent and harness working on baton, not only Claude. The first section
applies to code and design. The rest apply to prose.

# Banned runtime patterns

## No pausing, idling or truncating agents

Baton never deliberately pauses, idles or truncates an agent's work. When an agent's turn ends,
Baton wakes the agent's orchestrator (its parent seat, or the root) with the turn's report, and the
orchestrator decides whether to nudge the agent on. The agent stops when it declares itself done or
its orchestrator stops it. No runtime rule may leave live work waiting on a party that Baton does not
wake. An existing instance is a `priority:high` bug to remove (#572). The first known instance is
the turn-end park recorded under the actor `policy`, which waits for a claim or nudge and wakes no
one.

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
