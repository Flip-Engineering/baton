# baton prototype — the honest MVP

This is the skeleton of the **fleet driver's reliable coordination layer** (the "small program underneath" from [doc 19](../docs/19-north-star-corrected.md)) — a few hundred lines that dispatch workers, run them concurrently under per-vendor limits, and re-check their results. Two ideas it demonstrates:

1. **The coordination layer is plain code, not an AI.** `orchestrator.ts` does dispatch, version-stamped commands (so stale ones are rejected), ready-work ordering, and per-vendor concurrency limits. The AI lives *only* inside the workers. (Your CLI agent still drives on top — this is the plumbing that makes its commands land reliably; doc 19's reconciliation.) Being plain code is why there's no event-loop problem and no "the coordinator forgot/got confused" failure.
2. **Trust by re-running.** `referee.ts` re-runs a worker's verification in a *fresh* sandbox and believes only what it observes — never the worker's self-report. This is the driver's **trust feature** (it's how "done" becomes trustworthy), not a separate product. In the fleet driver, this is what lets the driver safely move on, merge, or reroute.

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
