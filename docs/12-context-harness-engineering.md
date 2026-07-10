# 12 — Context & Harness Engineering (the presentation layer)

*The layer above the three planes: how all their data actually reaches each agent's mind, in that agent's harness idiom, within a protected context budget — and how that presentation is engineered so capabilities interoperate and scaffold into emergent capability (the user's stated core intent). Grounded in the real 2025-26 frontier (Anthropic's context-engineering and tool-writing guidance, the Nov-2025 tool-search/code-execution work, the memory tool, Manus, Cognition, Chroma's context-rot study, SWE-agent's ACI, Voyager). Full angle designs + critic passes in `docs/reference/context-harness-*`.*

## 0. The frame

Everything up to here produced *data*: ledger events, capability ACI results, briefs, blackboard tuples, body-of-knowledge records. None of it helps an agent it reaches badly. Context engineering — which has superseded prompt engineering as the discipline (Anthropic, Sep 2025) — is the art of curating **the smallest set of high-signal tokens** that gets the job done, because every token depletes a finite **attention budget** and performance **rots monotonically** as the window grows (Chroma, Jul 2025 — 18 frontier models, non-uniform decline, accuracy cliffs, lost-in-the-middle). Baton's twist is the hard one: **it engineers context for windows it does not own.** Codex, Claude, and GLM each compact, re-order, and prompt differently; baton controls only what it *injects* and the *tools it exposes*. So this layer is a hub-side discipline for rendering plane data into each agent's window as minimally and as harness-appropriately as possible — and it is the same discipline that makes heterogeneous data interoperate and lets capability compound.

## 1. The Context Composition Layer

### 1a. One consumption grammar: `summary + handle + provenance`
The capability plane's ACI envelope (spec: `capability-plane.md` §3) already splits a tool's output into a ≤1-line `summary` (enters context), a bounded `payload`, and `refs` (handles fetched only on demand). **The composition layer applies the exact same split at the context level.** The brief is pushed; orientation maps, BoK recall, peer state, prior diffs are *pulled by handle* only when the agent reaches for them — Anthropic's **just-in-time** context (hold lightweight identifiers, load at runtime) and Manus's **file-system-as-unbounded-context** with *restorable* (never lossy) compression. A worker thus learns **one** way to consume both tool output and injected context. That single grammar is what lets ledger digests, capability results, briefs, and knowledge recall — five different sources — interoperate in one window without five formats.

### 1b. Context is provenance-typed into four classes
Extends doc 09 §D4's `facts`-vs-`prose` split into the full typing the composer (and the trust model) needs:

| Class | Source | Trust / handling |
|---|---|---|
| `system` | baton-authored brief, constraints, DoD | trusted, imperative, stable-prefix (KV-cache-pinned) |
| `trusted_fact` | hub-computed: ledger digests, diffstats, exit codes, capability `facts`, blackboard tuples, `reverify` verdicts | trusted, non-imperative |
| `untrusted_prose` | model-authored: worker summaries, notes, another agent's narrative | **data-fenced, opt-in, never obeyed** — the digest-bomb / cross-agent-injection defense (doc 09 §Q4/D4) |
| `reference_index` | handles: names/IDs, not payloads | pulled on demand; the just-in-time surface |

The composer never lets `untrusted_prose` cross into `system`'s imperative authority. This is the presentation-layer enforcement of "worker prose is non-authoritative" (doc 09 §C1) — the same rule the capability plane enforces with `reverify`, here enforced by *typing what enters the window*.

### 1c. The compaction firewall
Manus keeps goals alive by having the agent rewrite `todo.md` (recitation). **Baton cannot trust a worker it doesn't control to recite** — so it recites *from the outside*. On a `lifecycle.session_compacted` event, the composer re-injects the brief-identity + a resume digest from the knowledge plane (Codex `thread/inject_items` + `thread/goal/set`; Claude/GLM `PreCompact`/`SessionStart` hook), **idempotent by content-hash** so it doesn't double with the harness's own summary. Baton *complements, never duplicates*, a worker's native memory/compaction — it fills the one gap the worker can't: surviving its own context loss with the orchestrator's intent intact.

### 1d. The orchestrator's context is protected structurally
The scarcest resource in the system (doc 09 §Q3). Protection is architectural, not disciplinary: **fan-out to workers, each with its own window returning a 1–2k-token distilled result, IS the lead-context-preservation mechanism** (Anthropic's multi-agent Research pattern, +90% over single-agent). Baton's `fleet_wait` return is the composed digest — attention-first, `trusted_fact`-default, `untrusted_prose` opt-in, count-coalesced; and ACI-for-orchestrator returns digests only (doc 10 §6 Q4). The budget is derived from the harness card's *physical* `max_context` with headroom (context-rot), never an arbitrary number.

## 2. Agentic-first tool & prompt design: semantics invariant, syntax projected

The interoperability mechanism, stated precisely: **baton declares each capability op, each brief, and the result envelope once, in a harness-neutral form (the capability card + `AciResult`), and *projects* the concrete syntax/register per harness.** Semantics are invariant; presentation is a projection.

- **The tool surface stays small and KV-cache-stable regardless of catalog size.** Dozens of capability ops across discovery/debug/validate/orient/compute/skills would poison context if loaded flat (production data: selection accuracy collapses past a few dozen tools). So **capability cards are deferred** (Anthropic's Nov-2025 Tool Search / `defer_loading`, and code-execution-over-MCP: 150k→2k tokens, ~98%): a worker's tool surface is *composed per task*, discoverable on demand, not dumped. (This very session's ToolSearch/deferred-MCP pattern is the live proof of the mechanism.) The orchestrator sees capability *digests*, never raw ACI.
- **The brief is dialect-translated, not one-size.** A Codex brief and a Claude brief for the *same* task differ in structure, voice, and placement — AGENTS.md + `thread/goal/set` vs `--append-system-prompt` + PreCompact re-injection (the `gpt-5-4-prompting` skill exists for exactly this translation). The `brief_template` card field (spec: `communication-channel.md` §3) selects the projection; the *task* is identical, the *rendering* is per-harness.
- **Errors and results teach, in-dialect.** Every `AciResult{status:error}` carries an actionable `remedy` (Anthropic: error messages are guardrails that steer the agent to correct usage — SWE-agent's ACI law), kept in-context, not swallowed. A worker that misuses a capability is taught the right shape by the response.

## 3. Interoperability — heterogeneity as an asset, not a tax

The core-intent layer. Three artifacts recur across all three planes and *are* the unification contract: **the card** (harness card / capability card / knowledge card — schema + capability negotiation), **the envelope** (`AciResult` — one result shape), **the event** (`BatonEvent` — one observability stream). Unification lives at the *abstraction + observability* layer, **never at the capability layer** — resolving the tension the ask names via doc 04's law, *capability negotiation over lowest-common-denominator*: baton unifies the *verb vocabulary* and *result grammar*, while each adapter/card declares what it does natively vs emulated vs not-at-all. So a `steer` means the same *thing* everywhere but is *realized* differently, and the difference is declared, not hidden.

Two things make this real rather than aspirational:
- **The northbound socket must be deferred / code-mode**, or the hub poisons its own orchestrator — aggregating the whole control+capability+knowledge surface as flat MCP tools is the exact pathology the tool-search work fixes. Baton's northbound is a small, deferred, composable surface.
- **Skill/tool portability is now a real standard.** Agent Skills / `SKILL.md` became an open standard (Dec 2025, agentskills.io; adopted across Codex CLI, Gemini CLI, Copilot, Cursor, ~40 clients). One skill file works across vendor harnesses — so baton's skill forge (doc 11 module 5) ships portable artifacts, not vendor-locked ones.

The payoff: because the envelope + `reverify` make results **comparable and re-checkable across vendors**, "different harnesses fail differently" stops being a liability and becomes an **ensemble** — best-of-N across Codex/Claude/GLM with the hub as the judge (the error-decorrelation value from doc 06 Q1, now mechanized). Heterogeneity is the asset.

## 4. Scaffolding for emergent capability — the honest version

The deepest intent, kept rigorous. **Emergence in baton is compositional, not mystical**, and it comes from exactly one mechanism: because every capability, skill, and tool returns the *same* token-bounded ACI envelope and pipes intermediate data by *handle* (never through context), any primitive composes with any other — `find → orient → debug → prove → remember` is a pipeline nobody explicitly programmed, and a worker can chain primitives into procedures the designers didn't foresee. Composition of uniform, re-checkable primitives is the emergence engine; there is no magic step.

The reflexive loop is **Voyager's three-part engine re-grounded on baton's trust model**: automatic curriculum (orchestrator briefs + the cross-run scorecard, doc 08 §5) → skill authoring (a worker distills a reusable procedure) → self-verification replaced by **hub-run verification** (I7 — the worker doesn't grade its own skill). Crucially: **a skill IS a capability module** — no new subsystem. A forged skill conforms to the capability card, emits the envelope, is `reverify`-able, and lives in the knowledge-plane skill registry (doc 10 T3, cross-run stigmergy). Capability that spreads through the shared medium, verified before adoption.

Two disciplines keep this from being hype:
- **Scaffold WHAT and VERIFICATION, never HOW.** The bitter-lesson / scaffolding-trap critique (Manus re-architected five times; "every line of scaffolding is a bet you know better than the model") is aimed at *how*-scaffolding — hard-coded workflow paths a stronger model would route around. Baton scaffolds *what to achieve* (briefs, DoD) and *how to check it* (the validation ladder, `reverify`), and leaves *how to do it* to the worker model. WHAT-and-VERIFICATION scaffolding gets *more* valuable as models improve (a smarter worker uses a sharper verifier better); HOW-scaffolding gets obsoleted by them. This is the answer to "does a bigger base model obviate the scaffolding" — the *how* parts, yes, deliberately; the *what/verify* parts, no, they compound.
- **Emergence must be measured as a net win or it's just complexity.** A skill earns registry residence only if a reuse-vs-rederive counter (doc 08 §7 Q2) shows reuse beats re-derivation on cost *or* reliability; a skill a stronger base model makes redundant is *evicted*, not cherished. The BoK's honest "most fleets should stop at the scorecard" (doc 11 module 7) is the same discipline. Scaffolding that doesn't pay its measured way is deleted.

## 5. Design laws (this layer)

1. **Push the minimum, pull the rest by handle.** The only tokens that enter a window by default are `system` + attention-first `trusted_fact` + reference handles. Everything bulky is fetched on demand. (Anthropic just-in-time; Manus restorable compression.)
2. **Type every token by provenance; never let untrusted prose gain imperative authority.** The four classes are the trust boundary at the context level.
3. **Recite from outside.** Baton re-injects intent on compaction because the worker can't be trusted to; idempotent by content-hash.
4. **Semantics once, syntax per harness.** Declare capabilities/briefs/results harness-neutrally; project the dialect. This is what interoperability *is*.
5. **Defer the tool surface.** Compose a worker's tools per task; never dump the catalog. KV-cache-stable, context-rot-safe.
6. **Scaffold what-and-verify, not how.** The only scaffolding that survives better models is the goal and the check.
7. **Measure emergence or delete it.** A skill/scaffold justifies itself with a reuse-beats-rederive counter, or it's evicted.

## 6. Open questions

1. Idempotent re-injection vs the harness's own compaction: can baton always detect `session_compacted` on every harness (Codex emits it; does Claude expose a reliable signal, or must baton infer from a token-count heuristic)? Where inference is required, the firewall is best-effort — flag it.
2. Deferred tool loading depends on each harness's client supporting it (Anthropic does; Codex `mcp`/Gemini?). Where unsupported, the worker gets a *statically scoped* small surface per task-class instead — a coarser projection of the same principle.
3. The KV-cache-stable-prefix discipline (Manus) assumes baton controls prefix ordering; on harnesses where baton only appends (hooks), prefix stability is partial. Quantify the cache-hit cost.
4. Measuring the attention budget empirically per harness/model (context-rot curves differ) so the `max_context`-derived budget has the right headroom — an M1/M2 experiment, not a constant.
5. The ensemble/best-of-N (doc §3) multiplies cost by N and hits per-vendor concurrency ceilings (doc 01 §7) — when is decorrelation worth the N×, and does the scorecard learn that threshold?
