# Phase 85 — Context-Eval Adversarial Review (context-unit 1/2)

- **Unit:** `context-unit:08e1afbd520ba1459b631d75289ab8cf3f990cf84f9c1610fc677c9ac10fdc3c`
- **Call:** `context-call:fed7e44c3cb78148463c98a29f89a721dc9729e58d3cb61c28e3333462bbc74a`
- **Source reviewed (attached, immutable, sole input):** `docs/07-roadmap.md`, chunk 0 (only).
- **Review scope:** "unified Context expression compiler and `context_eval` semantics" — concrete correctness, AX (closure/axiom), authority, and replay gaps.
- **What was NOT done (per unit constraints):** no repository inspection, no reading of Run artifacts/receipts/ledgers, no `review.md` preexisting-content read, no Baton CLI/MCP/Run invocation, no `node` (no code-verification need — this unit produces a markdown audit, not an executable change).

---

## Verdict (up front)

The stated review target — **the Context expression compiler and `context_eval` semantics** — is **not present** in the attached source. The attachment is a roadmap narrative that *names* these components but exhibits **zero lines of compiler code, no grammar, no AST definition, and no eval rules**. An honest adversarial reviewer therefore **cannot** verify implementation-level correctness, closure, authority, or replay from this source; any such claim would be borrowed from prose — the exact failure mode the document itself forbids ("No provider-success claim is borrowed from readiness alone").

Everything below is therefore explicitly a **prose-claim audit**: it flags claims the roadmap *makes about* the compiler/eval that are unverifiable or underspecified **as stated**, not defects proven against code. Findings are ranked; each carries a resolution. Severity reflects how much the prose over-claims relative to what it substantiates.

---

## Findings

### F0 — [CRITICAL · availability] Review target is absent from the attached source
**Claim under review:** the compiler + `context_eval` semantics.
**Gap:** The attachment contains only references — "immutable expression builder over one `context_eval` action" (item 4), "closed canonical AST," "closed branches." No implementation, grammar, AST node set, evaluator, or settlement code is attached. The compiler/eval are *named*, not *exhibited*.
**Why it matters:** Every subsequent finding is bounded by this. I cannot confirm or refute any property of the actual evaluator; I can only audit the roadmap's claims about it. Borrowing a "compiler is correct" verdict from a roadmap paragraph would replicate the readiness-vs-success conflation the doc warns against.
**Resolution:** Attach the compiler/`context_eval` source (grammar, canonical AST, evaluator, settlement code), or re-scope this unit explicitly to a prose-claim audit. Until then, "concrete correctness of the compiler" is **unverifiable**, not "green."

### F1 — [HIGH · replay] Settlement is gated on resource-release replay, not result replay
**Claim:** Item 4 — a Context map call "settles only after replay-verifiable per-task resource release."
**Gap:** Replay-verifying a **release** (a slot/process returned to a pool) does **not** replay or verify the task's **result**. Release and correctness are orthogonal: a task can return its slot and still have produced a wrong or non-reproducible output. The phrasing reads as if settlement proves replayed correctness, but the mechanism named proves only cleanup.
**Resolution:** Separate the two gates explicitly — (a) a result-replay/correctness gate and (b) a resource-release gate — and do not let "replay-verifiable release" carry the correctness connotation.

### F2 — [HIGH · replay] "Content-addressed output" pins the product, not the recipe
**Claim:** Item 4 — "content-addressed output" is listed among the green deterministic guarantees.
**Gap:** Content-addressing an output binds the **bytes produced**, not the **computation that produced them** (AST version, source versions, partition inputs, environment). Distinct recipes can collide on one hash; a mutated source can produce a different hash with no way to detect the mutation from the output hash alone. Replay requires input+code+env to be pinned, not merely the output. The doc pairs this with "source-integrity refusal" (the right primitive) but leaves the integrity mechanism — digest over what, signed by whom, checked where — **unspecified**.
**Resolution:** Specify the source-integrity digest scope and pin it alongside output addressing; state that the replay digest covers recipe, not just product.

### F3 — [HIGH · AX/authority] Capability boundary is defined only by negation
**Claim:** Item 4 — "No ambient shells, host `exec`, arbitrary-code REPL, hidden provider callback, caller route/budget knob, or shared mutable checkout is added."
**Gap:** A negative list states what the eval **won't** do, not what it **can** do. Asserted closures ("closed canonical AST," "closed branches") **cannot be verified against a negation** — the next un-listed affordance is undefined. A closure proof needs a positive enumeration of the AST node set and the `context_eval` action's exact inputs/effects.
**Resolution:** Provide the positive capability enumeration (canonical AST nodes + the action's exact inputs/effects); then the negative list becomes a checkable invariant rather than an assertion.

### F4 — [MEDIUM · authority] Undefined escalation / approval / acceptance predicates
Several authority decisions are named without decision rules:
- glm-5.2 effort "including `xhigh` when warranted" — the **"warranted" escalation predicate is undefined** (effectively unbounded orchestrator authority).
- "Grok 4.5/literal Grok Build when provider-observed" — **"provider-observed"** by what observer, on what signal?
- "prebinds an ordinary successor Plan [and] waits for distinct approval" — approval **authority** and **criteria** unstated.
- "attaches only mechanically accepted children" — the **"mechanically accepted" rule** unstated.
- "one fenced writer at a time" (optional shared lineage) — fencing mechanism referenced via supervisor I1, which is **not attached**.
**Gap:** Each is an authority grant with no stated decision rule; none is verifiable from this source.
**Resolution:** State each predicate concretely or cite the spec that defines it.

### F5 — [MEDIUM · authority-layering] Budget authority inconsistent across layers
**Claim:** M1 specifies a "Hub-side watchdog (budget hard-stop + loop-auto-interrupt) that needs no model turn" (fleet layer, caller/authority-owned budget). Item 4 asserts the Context Program adds "No ... caller route/budget knob."
**Gap:** These can coexist at different layers, but the doc never reconciles them. A reader cannot determine whether an in-flight `context_eval` Wave is subject to the fleet budget hard-stop, exempt from it, or who owns budget authority mid-Wave.
**Resolution:** State which layer owns which authority knob, and whether `context_eval` is exempt from, or subordinated to, the fleet budget stop.

### F6 — [MEDIUM · replay] Replay coverage is success-only today; failed-call replay is future
**Claim:** Item 4 lists "failed-call settlement" and "selective retry generations" as Phase 85 **next** work (not yet green). The only stated green settlement mechanism (F1) describes the success path.
**Gap:** A failed or partially-failed Context call has **no specified replay/idempotency story yet**. Settlement-under-failure is undefined, so general "replay-verifiability" is over-stated until failed-call settlement lands.
**Resolution:** Mark the current replay guarantee as **success-path-only** explicitly; do not claim general replay-verifiability until failed-call settlement is specified and green.

### F7 — [MEDIUM · replay] Run-stop v3 "includes calls" — stop semantics for in-flight `context_eval` unstated
**Claim:** Item 4 — "Run-stop v3 includes calls."
**Gap:** Underspecified. When a stop fires while a Context/`context_eval` call is in-flight: is the call interruptible? does it leave partial state? is the partial result discarded? is the call re-runnable on resume? The doc's own M1 makes "exact stop/reap" and "drain-first two-phase stop" load-bearing, but the **call-level stop contract is not given**, undermining "exact stop/reap" precisely at the call layer the Phase 85 work adds.
**Resolution:** Specify the stop/reap contract for in-flight Context calls (interruptibility, partial-state handling, resume re-runnability).

### F8 — [LOW · concrete-correctness · artifact property] Truncated source
The attached chunk ends mid-sentence at "does the supervisor ho" — the M1 "Falsifies:" list is cut off. Conclusions about M1's falsification completeness are bounded by the truncation. This is a property of the attached unit, not necessarily a defect in the underlying document.
**Resolution:** None required for this unit; noted for completeness.

### F9 — [LOW · concrete-correctness · low-confidence] Possibly stale model route target
**Claim:** "Current route targets" lists "Claude Code `claude-opus-4-6`."
**Gap:** As of the doc's own latest date (2026-07-18), the Claude Opus line has advanced past 4-6, so citing 4-6 as a **current** target may be stale.
**Confidence:** Low. The reviewer's own environment model list may not be authoritative for Baton's routing, and roadmap route targets may intentionally lag.
**Resolution:** Confirm the intended route model, or mark 4-6 as a compatibility floor rather than the current target.

### F10 — [LOW · authority] Ambiguous provider identity in routing
**Claim:** "isolated Kimi-through-Claude K3 at `max`."
**Gap:** The phrase conflates provider identity (a Kimi model reached via Claude's harness?). For authority and replay, the **executing provider** and the **attesting authority** (whose receipt proves the result) must be unambiguous; "Kimi-through-Claude" names neither clearly.
**Resolution:** Name the executing provider and the attesting authority per route.

---

## Cross-cutting observations (not findings, no defect claimed)

- **Internal inconsistency in concreteness.** M0/M1 are written as falsifiable, evidence-first milestones ("each a recorded number"; explicit pivot criteria; "Falsifies: ..."). The Phase 81/85 status prose ("green", "freshly verified", "deterministic-green") is **not** falsifiable from this document. The doc holds itself to a falsification standard in one section and asserts unverifiable status in another.
- **Self-imposed honesty invariant is upheld in letter for providers** ("No provider-success claim is borrowed from readiness alone"; "Grok remains separately auth-red"), but the same rigor is **not** applied to the compiler/eval status claims — those are stated as green without receipts in this source.
- **Scope discipline is good where explicit:** homelab is correctly demoted to "exploration history"; the 2026-07-17 header disclaims that a worktree/private HOME is an OS sandbox.

## What would close the highest-value gaps (priority order)

1. **F0:** attach the compiler/`context_eval` source so implementation claims become checkable — the single highest-leverage unblock.
2. **F1 / F2:** separate result-replay from release-replay; pin the recipe, not just the product.
3. **F3:** convert the negative capability list into a positive AST/action enumeration so closure is provable.
4. **F4:** state the escalation/approval/acceptance predicates (or cite their specs).
5. **F6 / F7:** mark replay as success-path-only today; specify failed-call settlement and in-flight-call stop/reap before claiming general replay-verifiability and exact stop/reap at the call layer.

---

*This review is source-bounded to the attached immutable unit. It does not certify the compiler or `context_eval` implementation — that is unverifiable from this attachment — and makes no claim of Baton-level completion, route preservation, or cleanup truth, which are owned by the supervising deployment, not by this review unit.*
