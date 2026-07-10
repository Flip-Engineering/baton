# The Fleet Driver (assembly spec)

*The one place that says "here is the driver, as a single runnable program." The other specs each define a part; this ties them into one buildable thing. Plain language. This is the spec to build against.*

## What the driver is

One coordinator program. Your CLI agent (Claude Code or Codex) is the boss on top — it *decides* what to do. The driver is the reliable layer underneath that *carries out* those decisions and does the bookkeeping. It runs as a small long-lived process (or, later, an Elixir/OTP app — see doc 17) that owns:

- the pool of workers (each a Codex / Claude / GLM coding tool running in its own copy of the repo),
- the log of everything that happened,
- the machinery that makes commands land reliably (version-stamps so stale commands are rejected; confirming a worker actually stopped before moving on),
- re-running a worker's tests before believing "done."

## The commands the boss (your CLI agent) can give it

This is the driver's whole API — eight commands. (In the current design these are exposed as MCP tools so your CLI agent can call them, but the driver is a normal program and could expose them any way.)

| Command | What it does | Built from |
|---|---|---|
| `spawn(harness, task-brief)` | Start a worker on a task, in its own repo copy | adapter contract (spawn), supervisor (worker lifecycle) |
| `send(worker, message, mode)` | Send a worker a message. `mode` = `nudge` (a note it reads at the next natural pause), `steer` (redirect what it's doing now), or `turn` (a new instruction) | communication channel (§2), doc 05 §4 |
| `wait(timeout)` | Park until a worker needs attention (finished, stuck, asking a question, over budget), then return a short digest of what changed | supervisor (bounded poll), doc 05 §3 (digests) |
| `respond(request, answer)` | Answer a worker's question, or approve/deny a risky action it asked about | communication channel (ask/answer), supervisor (single-consumer) |
| `interrupt(worker, then?)` | Stop what a worker is doing now (optionally with a follow-up instruction). Confirms it actually stopped | supervisor I6 (two-phase stop), adapter contract (interrupt) |
| `result(worker)` | Get a finished worker's result — **after the driver has re-run its verification itself** | referee / supervisor I7 |
| `list()` | See all workers, their status, budget, and any pending questions/approvals | supervisor (state) |
| `kill(worker)` | End a worker, confirming the process is really gone | supervisor (kill sequence) |

Your CLI agent uses these to drive: "spawn a Codex worker on this," "wait," "worker 2 is asking whether to use library X — respond with Y," "interrupt worker 3, its approach is wrong," "is worker 1 really done?"

## What the driver's main loop does

Plain pseudocode. This is the whole thing:

```
loop forever:
  # 1. dispatch: start any ready task on a free worker, respecting per-vendor limits
  for task in tasks that are ready (all their dependencies done):
      pick a worker/vendor for it   # round-robin for v0; adaptive routing (doc 20) later
      if that vendor is at its concurrency limit: skip for now   # e.g. GLM Pro = 1 at a time
      start the worker; write "started" to the log

  # 2. carry the boss's commands to workers, reliably
  for each command from the CLI agent (send / interrupt / respond / kill):
      stamp it with the worker's current version number
      if the stamp is stale (the worker moved on): reject it, tell the boss why
      else: deliver it; for interrupt, wait for the worker to confirm it stopped

  # 3. stream each worker's activity to the log AND the live feed
  for each event a worker emits (turn started, file edited, tool run, tokens used, question asked):
      write it to the append-only log
      push a short version to the live feed the human is watching
      update derived signals (is it stalled? looping? over budget? editing outside its scope?)

  # 4. the trust gate: when a worker says "done", don't believe it — re-run
  for each worker that reports finished:
      re-run its task's verification command in a FRESH copy of the repo (not the worker's)
      mark the task done ONLY if the driver's own run passes
      record the outcome (this is what routing later learns from)
```

The prototype (`prototype/`) is this loop, minus the live feed and steering, already runnable.

## The four features you named, and where each lives here

1. **An orchestrator directs workers** → the API above + the dispatch step. Your CLI agent decides; the driver executes.
2. **Messaging both ways** → `send` (down) and `wait`/`respond` (up, including a worker asking questions). Full message shapes in `spec/communication-channel.md`.
3. **Telemetry / monitoring** → step 3: every worker action becomes a log entry and a live-feed line, with derived signals (stall/loop/budget/scope). Event shapes in doc 05. *(Gap the audit flagged: the live human-facing feed itself needs its own small design — a text stream is enough for v0.)*
4. **Interruption / steering** → `interrupt` and `send(mode=steer)`, made dependable by step 2's version-stamps and the confirm-it-stopped rule. This was your original red-team target and it's the most hardened part.

## The smallest version to build first (the MVP)

Do not build routing, memory, or the tool suite yet. Build this:

1. **One coordinator process** that can `spawn` two workers (one Codex, one Claude-or-GLM) in separate repo copies, using the adapter interface.
2. **A live text feed** of what each worker is doing (step 3), plain streaming.
3. **`interrupt` and `send(steer)` that reliably land** (step 2's version-stamp + confirm-stopped).
4. **The trust gate** (step 4): re-run verification before `result` says done. Round-robin the two workers; no learned routing.

That is the whole fleet driver in miniature, proves the hard parts (dependable interrupt/steer + trustworthy "done"), and is a few weeks of work. Then grow: adaptive routing (doc 20), more workers, the worker tools, the fancy monitor — each turned on when it earns its place.

## What this spec deliberately leaves out

- The worker *tools* (search, debug, semantic diff) — a later addition; the driver works without them.
- Learned routing — doc 20; off until there's history to learn from.
- The multi-machine / remote setup — later; build one box first.
- Any "neutral institution" or verification-as-the-product framing — retired (doc 19). This is a fleet driver; re-verification is one of its features.
