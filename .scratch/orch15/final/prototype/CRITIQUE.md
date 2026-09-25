# Prototype self-critique (red-teaming my own code)

*I wrote `src/*.ts` + `demo.mjs` fast to prove the architecture is coherent. A critical engineer re-reading it finds that several of its load-bearing claims are asserted, not implemented — the demo *looks* like it demonstrates properties it doesn't. Honesty demands listing them, and fixing the ones that make the prototype misleading. Findings ranked by how badly they misrepresent.*

## F1 — FATAL: the "concurrent orchestrator" is sequential; the fleet has no parallelism
`orchestrator.ts::runToCompletion` is a synchronous `while` loop calling `adapter.run` (which is `spawnSync` — blocking). Each task fully completes before the next starts. So: **the one thing a fleet exists to do — run workers in parallel — is absent**, and `inFlightByHarness`/`concurrencyCeiling` never actually limits anything (nothing is ever concurrently in flight). The prototype cannot even in principle show "fleet beats soloist on wall-clock," which is *half the eval's metric*. This isn't a stub; it's a design that contradicts the premise. **Fix: make dispatch async, run ready tasks concurrently, enforce the ceiling as a real semaphore.** (Done — see below.)

## F2 — SERIOUS: the Referee re-runs in the worker's own worktree, not a fresh sandbox
`eval.ts` wires `sandboxFor: (t) => t.worktree` — the *same* directory the worker just mutated. But the Referee's entire integrity (doc 09 C2, doc 13 T5) is that it re-verifies **in a sandbox the worker did not control**. As written, a worker that leaves a poisoned `conftest.py` or a doctored test binary in its worktree fools the Referee — the exact attack the design claims to defeat. **Fix: the Referee runs against a fresh checkout of the worker's *committed* artifacts, never its live worktree.** (Done — referee now takes a distinct `sandbox` the eval populates from the worker's commits, not its working tree.)

## F3 — SERIOUS: the "fleet" arm is single-vendor in practice
`eval.ts::arm` routes `(name === "solo" ? "codex" : harnesses[0])` — so the fleet arm *also* always routes to one harness. The eval as wired never exercises model diversity, which is the thesis under test. It would report a "fleet vs solo" number that is really "same-vendor vs same-vendor." **Fix: real per-task routing across vendors + a cross-review task that must run on a *different* family than the impl.** (Done.)

## F4 — MODERATE: events have no timestamps; the "durable ledger" is half-real
`ledger.ts` defaults `ts` to `""` — I carried the *workflow-script* Date-ban into *product* code where it doesn't apply (product code may absolutely call `Date.now()`). So every `BatonEvent` is untimed — stall/latency/loop detection (all time-based) can't work. **Fix: stamp real ISO timestamps.** (Done.)

## F5 — MODERATE: the at-least-once cursor isn't durable across the death it's meant to survive
`Cursor` holds `acked`/`served` in memory. Its whole justification (spec I3, doc 13 T1) is surviving a *consumer that died mid-page* — but if the process died, the in-memory cursor died with it. The durability is asserted in the comment, not implemented. **Honest fix: persist `acked` to disk (or mark it clearly as "in-process only; real durability persists acked").** (Marked + minimal disk-persist added.)

## F6 — MINOR but real: subprocess management is naive
`spawnSync(..., {timeout})` does not reliably kill a child's *process tree* on timeout (orphaned grandchildren survive — the zombie-worker failure, doc 06 Q8). And brief text flows into argv without sanitization. Real adapters need `detached` + process-group kill, and the Referee's `bash -lc` on even a pinned command wants a locked-down env. **Noted; not fixed in the skeleton — flagged so it's not mistaken for handled.**

## F7 — HONEST FRAMING: `src/*.ts` and `demo.mjs` are two implementations
The demo inlines a second copy of the runtime (so it runs with zero build step). They can drift. This is fine for a throwaway proof, but a reader could mistake the demo's behavior for the `src` behavior. **Noted; the fixes below apply to both.**

---

## What the fixes change about what the prototype *demonstrates*

Before: "here is a coherent structure" (true) dressed as "here is a working fleet with a trust gate" (false — it was sequential, same-vendor, self-sandboxed).

After: the demo runs **genuinely concurrent** workers, the **ceiling actually serializes** the GLM leg (=1) while Codex/Claude parallelize (=4), the **Referee re-checks committed artifacts in a fresh sandbox** (not the worker's worktree), and the fleet arm is **actually model-diverse**. It still spends zero quota in dry-run — but now the *shape* it demonstrates is honest. The remaining stubs (F6 subprocess hardening, live `--json` usage parsing, real git-commit reads) are flagged in-code, not hidden.

The meta-lesson, which is itself the point of this exercise: **a prototype that "runs and prints a nice tree" is the easiest place in the whole project to fool yourself.** The demo passing is not evidence the design works; only the *specific properties* it actually exercises are — and half of them were painted on until this pass. This is exactly the "worker prose is non-authoritative, re-run the evidence" discipline (I7) turned on my own code: I re-ran my own claims and three of them failed.
