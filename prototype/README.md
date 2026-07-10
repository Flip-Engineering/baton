# baton prototype — the honest MVP

This is the ~few-hundred-line thing the whole corpus (docs 00–16) keeps concluding should be built *first*: a **deterministic orchestrator + Referee + eval**, reflecting doc 16's two frame-corrections —

1. **The orchestrator is a program, not an LLM** (doc 16 Pivot 1). The conductor is `orchestrator.ts` — deterministic dispatch, fencing, DAG ready-work pull, per-harness concurrency ceilings. LLMs live *only* inside adapters (the workers). This deletes the event-loop problem, orchestrator context-poisoning, orchestrator-death recovery, and the nested-approval loop — none of which exist for a program.
2. **The durable value is the Referee** (doc 13 T5, doc 16 §2). `referee.ts` re-runs a worker's *pinned* verification in a fresh sandbox and trusts only what the hub itself observes. Worker prose is non-authoritative (I7). This is the un-vendorable, ToS-clean, bitter-lesson-proof core.

## Run it

```bash
node demo.mjs      # DRY-RUN: zero model quota, no real repo touched
```

The demo submits a 3-task DAG (Codex implements → Claude cross-reviews + GLM adds tests, both depending on the impl). In dry-run the Referee can't re-verify, so the hub **refuses to mark the impl `completed`**, and the dependent review/test tasks correctly **stay locked**. That is the point: the trust gate and the DAG are real, and "worker said it passed" buys nothing.

To run live (spends quota, needs `claude`/`codex` on PATH and a git worktree): set `live: true` in the eval/orchestrator opts. Adapters shell to `claude -p` / `codex exec --json`; the Referee re-runs the brief's verification command.

## Files

| File | What it is | Maps to |
|---|---|---|
| `src/types.ts` | Core types: Task, Brief, WorkerResult (non-authoritative), Verdict, BatonEvent, HarnessCard | docs 02/05/08, spec/communication-channel |
| `src/ledger.ts` | Append-only JSONL ledger (one file/worker) + **at-least-once** cursor | doc 08 §4, spec I3 (doc 13 T1) |
| `src/adapter.ts` | Southbound worker adapter + subprocess Claude/Codex/GLM adapters + per-harness brief dialect | spec/adapter-contract, doc 12 §2 |
| `src/referee.ts` | **The durable core** — hub-run independent verification (I7) | doc 13 T5, doc 09 C1-C2 |
| `src/orchestrator.ts` | The deterministic conductor — fencing, DAG, ceilings, the trust gate | spec/supervisor-state-machine, doc 16 Pivot 1 |
| `src/eval.ts` | **The actual first deliverable** — solo-vs-fleet with a PRE-REGISTERED metric + pivot criterion | doc 07 M1, doc 14 #21, doc 16 Pivot 3 |
| `demo.mjs` | Runnable dry-run (pure Node, no build) proving the skeleton executes | — |

## What this deliberately is NOT

- **Not the Conductor's steering machinery.** `turn/steer`, two-phase interrupt, the app-server broker, the approval arbiter — all real (spec/supervisor-state-machine) but they're the *Conductor branch earned by the eval*, not the MVP. The MVP needs only spawn + result + re-runnable verification.
- **Not the capability/knowledge planes.** atlas/Vantage/Scratch/Cairn (doc 11) are earned-by-demand consumers, gated on the eval returning a favorable number.
- **Not production.** Adapters don't yet parse `--json` usage or read `git diff`; the sandbox isn't a real throwaway `$HOME`; cost/wall are stubbed. These are marked in-code. The *structure* is real; the integration is the next increment.

## The one thing this proves

That the honest architecture is **coherent and small**. The trust gate (Referee), the DAG, the concurrency ceilings, and the deterministic loop compose into a working whole in a few hundred lines — and the next unit of value is not another file here, it's running `eval.ts` on real tasks to get the number that decides whether anything above this should exist (doc 16 §5).
