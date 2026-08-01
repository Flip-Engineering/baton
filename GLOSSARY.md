# Glossary — the codewords, in plain English

*This project accumulated a lot of jargon over its exploration. Here's what it all means, plainly. If a doc uses a codeword, look it up here. Several of these terms are being phased out of the docs in favor of the plain version.*

## The important ones

| Codeword | Plain meaning |
|---|---|
| **Fleet driver** | The product: one orchestrator agent that directs Claude/Codex/GLM coding tools, sends them work, watches them, and interrupts/redirects them. Formerly also called the "Conductor." |
| **Conductor** | Same as fleet driver. (Being phased out.) |
| **Referee** | The feature that re-runs a worker's tests itself instead of trusting the worker's "it passed." It's how the driver knows "done" is real. **Not** a separate product — a trust feature of the driver. |
| **Worker / harness** | A full coding tool (Codex, Claude Code, or GLM) doing a task, running in its own copy of the repo. |
| **Orchestrator** | The boss that decides what to do — your CLI agent (Claude Code or Codex). |
| **The hub / coordinator** | The reliable program underneath the orchestrator that carries out its decisions and does bookkeeping. |
| **Adapter** | The piece of code that translates the driver's commands into a specific tool's real API (one adapter per Codex/Claude/GLM). |

## Control grammar (the unified surface)

The operator-facing vocabulary is one closed grammar (docs/36): a noun tree with the verb last —
`run.view`, `run.member.send`, … The **member** is the delegated seat; the old worker / workstream /
seat / assignee synonyms never surface. The run-level interaction verbs are `run.send` (guidance to
the current live recipient), `run.interrupt`, and `run.answer` (settling attention). Reads are
`run.view` (one bounded view; `--until settled|terminal` absorbs the old wait), `run.watch` (event
channels), `run.list`, and `run.help`.

### M5 alias sunset

The legacy synonym spellings were **deleted** at the M5 alias sunset — never rewritten into the
canonical verbs: `run.show`/`run.status`/`run.inspect`/`run.episode`/`run.result` → `run.view`;
`run.progress`/`run.events`/`run.output`/`run.follow` → `run.watch`; `run.notify` → `run.member.send`;
`run.workstreams` → `run.member.view`; `stop-member` → `run.member.stop`. The `run.steer` compatibility command was **deleted** at M5 — run-level guidance goes through `run.send`.

## Framing terms (mostly retired)

| Codeword | Plain meaning |
|---|---|
| **The moat** | The hard-to-copy advantage. |
| **Data flywheel** | The saved history of past runs that makes routing smarter over time. |
| **Neutral trust institution** | A framing that was **retired** (doc 19) — it wasn't the goal. Ignore it. |
| **Rental vs. moat** | Parts a better AI model will make pointless (rental) vs. parts that stay valuable (moat). |
| **Subtractive thesis** | "Cut features; give the agent less, not more." |
| **Bitter lesson** | The observation that general methods + bigger models tend to beat hand-built cleverness — so don't over-engineer scaffolding a better model will route around. |

## Architecture words

| Codeword | Plain meaning |
|---|---|
| **Northbound / southbound** | Toward the orchestrator (up) / toward the workers (down). |
| **Control plane / data plane / knowledge plane** | The interrupt-and-steer channel / the message channel / the shared memory. |
| **Capability plane** | The tools the driver hands its workers (search, debug, etc.). |
| **Stigmergy / stigmergic** | Workers coordinate by reading and writing shared files/notes, instead of messaging each other directly. |
| **Blackboard** | A shared scratchpad workers read and write. |
| **MCP** | A standard way for an AI agent to call tools; how the orchestrator talks to the driver. |
| **ACP** | A standard for one program to drive an AI coding tool; a fallback way to reach workers. |

## Reliability rules (the "I" numbers — engineering shorthand)

These live inside the supervisor spec and are fine there, but shouldn't appear in plain prose without their gloss:

| Codeword | Plain meaning |
|---|---|
| **Fencing / I1** | Version-stamp every command so a stale one (aimed at what the worker *was* doing) is rejected. |
| **At-least-once cursors / I3** | Track "what has the reader seen" so a crash never silently drops events. |
| **Two-phase stop / I6** | Don't call a worker "stopped" until it actually confirms it stopped. |
| **Hub-run verification / I7** | Re-run the worker's check yourself before believing "done." (= the "Referee.") |
| **Single-consumer approval** | A worker's question/approval is answered exactly once, even if two people could answer. |

## Tool / analysis words

| Codeword | Plain meaning |
|---|---|
| **Representation ladder / AST / CPG / IR / e-graph** | Ways to look at code as *structure* instead of raw text, so you can tell a real change from a reformat. |
| **Semantic diff** | A diff that shows what *behavior* changed, hiding renames and reformatting. |
| **Three-tempo memory** | Fast (live scratchpad) / medium (task list) / slow (long-term knowledge) memory. |
| **Validation / Evidence ladder** | Levels of checking, cheap to expensive: types → tests → property tests → fuzzing → math proof. Use the cheap rung unless the task needs more. |
| **Autoformalization** | Turning an English spec into a math-checkable statement — the hard, unsolved part of proving code correct. |

## Experiment names

| Codeword | Plain meaning |
|---|---|
| **E1** | The experiment "does a team of AIs beat one good AI?" (expensive to test). |
| **E2** | The cheaper experiment "does a different-vendor check catch bugs the same vendor misses?" — optional de-risking of the re-verification feature, **not** a decision on whether to build the driver. |
| **Pass@N** | The chance at least one of N tries succeeds. |
