# Baton Coherence Audit

*Read across all 21 docs, 4 specs, the README, and the two review files. Verdict up front, then the specifics.*

## 1. Is the corpus, as a whole, steered toward the fleet-driver goal?

**Only at the top. The body still points the other way.** Doc 19, doc 20, and the README have been turned right-side-up and now say clearly: baton is a fleet driver, and verification/routing/memory are its supporting parts. But that correction lives in exactly three files. The other eighteen docs plus both review files — the bulk of the words a reader will actually wade through — were written *during* the inversion and still speak its language fluently and confidently. "Fleet driver" appears in 3 files; "Referee" in 18 and "Conductor" in 25. The two most emphatic docs (16 and 18) end with the explicit instruction to *not build the driver* and to build a verification eval instead, crowning a "neutral trust institution" as the thing to build toward. So a reader who trusts the README is aimed correctly; a reader who reads the corpus in order is argued, at length and with more supporting detail than doc 19 offers, back into the exact inversion doc 19 retired. The ship's bridge is pointed right; the crew below deck is still rowing the old heading.

## 2. The single biggest remaining misalignment

**Doc 18 ("Max-Campaign Synthesis") is the sharpest pull away, and it is currently framed as the corpus's final word.** Its bottom line states: *"The honest next artifact is not doc 19 and not the supervisor — it is E2"* (a verification-decorrelation eval), and *"refuse to write another line of Conductor spec until its pre-committed decorrelation threshold survives its own review."* It names the "neutral trust institution + run-corpus flywheel" as "the shape to build toward, with the Conductor as an earned branch." That is a direct, load-bearing contradiction of doc 19 — not a framing nuance but an opposite build order. It even name-checks doc 19 to dismiss it.

**The fix:** doc 18 (and 16) need a prominent header banner — not a buried footnote — saying "SUPERSEDED ON FRAMING by doc 19; read the mechanisms, ignore the build-order and the 'don't build the driver' conclusion." Better still, rewrite doc 18's "Bottom line" and doc 16's §5 recommendation so the eval (E2) is correctly demoted to what doc 19 says it is: optional de-risking of *one* supporting feature, not a go/no-go gate on the whole product. Right now doc 19 asserts the correction but leaves the two loudest counter-arguments standing at full strength.

## 3. Is the fleet driver's core actually specified?

The four named features are, collectively, more specified than the framing chaos suggests — but they are scattered across a design doc and three specs, and there is **no single "here is the driver" spec** that ties them into one buildable program.

- **(a) Orchestrator directs workers** — **Specified, buildable.** `spec/supervisor-state-machine.md` (worker lifecycle, spawn/turn/interrupt states, fencing) plus `spec/adapter-contract.md` (the `spawn`/`prompt` verbs mapped to real Codex/Claude/GLM APIs) cover dispatch concretely. Gap: the orchestrator's *own* control loop — the "small reliable program underneath" from doc 19 — has no consolidated spec. The `fleet_spawn`/`fleet_wait`/`fleet_respond` tool surface is described in fragments across docs 05/09 but never assembled into one "this is the driver process and its API" document.
- **(b) Messaging both ways** — **Specified, buildable, the strongest artifact.** `spec/communication-channel.md` fully defines brief / nudge / ask / answer / result / digest with envelopes, delivery guarantees, ordering, and the worker's `ask` primitive. This one is genuinely ready to build against.
- **(c) Telemetry / monitoring** — **Specified as data, missing as a surface.** Doc 05 §1–3 nails the normalized event schema, derived signals (stall/loop/budget/scope-drift), digest levels, and JSONL+SQLite+OTel storage. Two gaps: the schema lives in a *design doc*, not a spec (so it reads as thinking, not contract), and there is **no spec for the live human-facing monitor** — the "watch them" dashboard/feed doc 19 step 2 calls for. The human seat is a section heading (doc 05 §7) and a supervisor open-question (#4), not a design.
- **(d) Interruption / steering** — **Specified, buildable, well-hardened.** Doc 05 §4 (verb semantics), supervisor I1 (fencing) and I6 (two-phase stop), and the adapter-contract steer/interrupt rows are precise and red-teamed. Native-vs-emulated steering is handled honestly per harness. This is solid.

**Named gap:** there is no `spec/driver.md` (or equivalent) that says "the fleet driver is *this* process; it exposes *these* tools; its main loop does *this*; it composes the supervisor + adapters + comms channel + telemetry into one runnable thing." The parts exist; the assembly instruction does not. That is the single most useful missing spec.

## 4. Continual-adaptive routing — does anything handle recency, or would it rot?

**Doc 20 handles it correctly and is the right answer — but the rest of the corpus still describes the rotting version, and nothing reconciles them.** Doc 20 is genuinely good: it keys on `(model-version, task-type)` not `(vendor, task-type)` so a new release is a fresh bucket; it uses exponential decay so old results fade; it seeds new models from a discounted predecessor prior plus an exploration bonus; it frames selection as a bandit; and it counts only *verified* wins. That directly answers the "new model makes old data stale overnight" requirement. It is a doc, not a spec, but it is buildable as written.

**The incoherence:** docs 16 and 18 describe routing as exactly the naive, rot-prone thing doc 20 exists to replace — "routing's learnable early signal is only coarse `(harness×class)`," "the moat is not the routing table (unlearnable)," "Codex reliably fails auth-refactors" as a static per-vendor verdict. Those are per-*vendor*, non-decaying, lifetime-tally framings — the win/loss counter that rots. So the corpus contains both the cure (20) and the disease (16/18) with no cross-reference tying them together. A builder reading 16/18 first would build the rotting version. **Fix:** add one line in docs 16/18's routing passages pointing to doc 20 as the superseding design, and promote doc 20's five rules into the (not-yet-existing) routing spec so the decay/versioning/prior mechanics are contract, not prose.

## 5. Jargon-to-plain translation (the ~10 worst offenders)

The user dislikes jargon and self-referential codewords; the corpus is dense with both. Worst offenders, with plain replacements:

| Codeword (in corpus) | Plain replacement |
|---|---|
| **Referee** | independent verification — re-running the worker's tests yourself |
| **Conductor** | the fleet driver (or just "the orchestrator") |
| **neutral trust institution** | *(delete — it's not the goal; doc 19 retired it)* |
| **the moat** | the hard-to-copy advantage |
| **flywheel** | the run history that makes routing smarter over time |
| **stigmergic / stigmergy** | workers coordinate through shared files and notes, not direct messages |
| **blackboard** | a shared scratchpad workers read and write |
| **capability plane** | the tools the driver hands its workers |
| **control plane / data plane / knowledge plane** | the interrupt channel / the message channel / the shared memory |
| **northbound / southbound** | toward the orchestrator / toward the workers |
| **AAI / ACI / AIAI topologies** | *(drop the acronyms entirely — describe who talks to whom)* |
| **hub** | the coordinator program |
| **fencing / two-phase stop** | a version-stamp that rejects stale commands / confirming the worker actually stopped |

(Bonus culprits worth killing on sight: "subtractive thesis" → *cut features*; "representation ladder / e-graph / CPG" → *code-analysis tools for semantic diff*; "three-tempo memory" → *fast/medium/slow memory*.) The internal reliability rules labeled I1–I7 are fine as engineering shorthand *inside* the supervisor spec, but should never surface in user-facing prose without their plain-English gloss.

## 6. The honest next build step

**Build the smallest driver that actually drives — one process, two workers, real interrupt, real re-check — and leave routing and memory off until there's traffic to learn from.** Concretely, and in plain language:

1. **One coordinator program** (the reliable layer under your CLI agent) that spawns two workers in separate git worktrees: a Codex worker and a Claude-or-GLM worker. Use the adapter interface that's already specced.
2. **A live feed** of what each worker is doing — turns, file edits, tool calls, token burn — using the event schema from doc 05. Plain text streaming is enough for v0; the fancy dashboard is later.
3. **Interrupt and nudge that actually land** — the version-stamp + confirm-it-stopped machinery from the supervisor spec (rules I1, I3, I4, I6). This is the part that makes "stop worker 2" dependable instead of hopeful, and it's the user's original red-team target.
4. **Trust by re-running** — when a worker says "done," the coordinator re-runs the brief's verification command itself in a fresh sandbox before believing it (rule I7). Round-robin the two workers for now; no learned routing yet.

That is precisely doc 19's plain next step and the supervisor spec's honest MVP (I1/I3/I4/I6/I7, one adapter, the comms channel's brief→ask→answer→result), and it proves the whole thesis in a few weeks. Adaptive routing (doc 20) and memory get switched on *after* there's enough verified history for them to matter — which is exactly what doc 20 itself says.

**Bottom line: the bridge is pointed the right way, but two of the loudest docs below deck (16 and 18) are still steering for the old destination and are currently framed as the final word. Slap a "superseded on framing" banner on them, write the one missing `driver` spec that assembles the four features into a single runnable program, fold doc 20's routing into a spec and cross-link it from 16/18, and purge the codewords. Then build step 1–4 above.**