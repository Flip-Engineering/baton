# Red/Blue/Explore — stigmergy-scale

## RED
## Red-team: stigmergy-scale

Target: doc 10 §2 **T3** (the AIAI bet), `docs/capabilities/coordination-repl.md` (Scratch/the Board), `docs/capabilities/discovery-search.md` (atlas/the shared index). I read all three plus doc 08 (the tempo/concurrency frame), the capability-plane spec, and the supervisor invariants the scaling claims lean on. The attack is one-sided by design.

The load-bearing claim under attack (doc 10 §2 T3):

> "**Why AIAI is the bet:** direct AAI is O(N²) chatter that poisons context and doesn't scale; stigmergic AIAI is O(N) reads/writes against shared structure, is naturally durable and auditable (the medium *is* the record), and degrades gracefully (a crashed agent leaves its marks; a new agent reads them)."

---

### FATAL 1 — The O(N)-vs-O(N²) accounting is rigged: reads are the hidden N² term, and for an LLM a read is not free

**Claim attacked:** "stigmergic AIAI is **O(N) reads/writes** against shared structure" vs "direct AAI is **O(N²)** chatter" (doc 10 §2 T3). The mechanism cited: ants — "no ant messages another ant; each modifies the shared environment (pheromone trails) and others read it."

**Why it fails:** The comparison counts *writes* on the stigmergy side and *messages* on the AAI side — different units. A write only *coordinates* if it is *read*. For a mark to have the same coordinative reach as an N-way broadcast, it must be read by the other N−1 agents. So the honest accounting is **N writes + up to N·(N−1) reads = still O(N²)**, in the read dimension. Stigmergy does not remove the N²; it *relocates* it from the send side to the receive side. And the receive side is the expensive side for LLMs: the ant analogy works only because insect perception is **ambient and free** (O(1) continuous sensing), whereas every agent "observation" here is a tokenized tool round-trip that pulls a ~200-token digest into the scarcest resource in the system — the same "token in the orchestrator's scarce context" cost T3 uses two paragraphs earlier to indict AAI (doc 10 §2 T2). Worse: because a worker "is inside a synchronous LLM turn, not running an event loop — it cannot park on a 25s notify" (the module's own critic, coordination-repl.md §1), it has no push channel and must **poll**. To stay fresh, poll frequency must scale with the write rate, and the write rate scales with N. Reads therefore grow as O(N · poll-freq) ≈ O(N²). The design team's own critic already found the hole and never propagated it up to the headline: *"The polling tax is uncosted, and it's the whole ballgame… A worker that dutifully `scratch_read`s before each of 30 edits in a turn burns ~6k tokens on board-reading — plausibly more than the coordination saves."* (coordination-repl.md §2). Doc 10's O(N) bet was never corrected for this.

**Concrete scenario:** Fleet of N=8 refactoring a shared `payments/` subsystem, ~30 edits/worker/turn. To coordinate correctly, each worker must `scratch_read` the board before touching a contended path. Steady state per turn: 8 × 30 × ~200 tokens ≈ **48k tokens of pure observation**, against ~8 claim-writes. The "O(N) writes" is 8; the coordinating reads are 8×30 and consume scarce context every time. Targeted point-to-point messaging (w-i pings only the specific holder of a conflicting claim, on demand) is *sparser* than blanket pre-edit polling. In the contended regime the "O(N²) chatter" you fled is **cheaper** than the stigmergic polling that replaces it.

**Severity: fatal** — the central quantitative justification for the entire T3 bet is an accounting error.

---

### FATAL 2 — O(N) holds only for disjoint work that needs no coordination; in the contended regime (the only regime where coordination matters) the substrate is a serialized hub bottleneck *and* advisory claims don't even exclude

**Claim attacked:** "the surface area that needs serialization is deliberately tiny" and "Claims + CAS-cells — the *only* serialized paths… nobody blocks" (coordination-repl.md §"Shared vs per-worker"); capability-plane.md §4: "who's touching payments/ … is a tuple-space `take` — atomic, so two workers can't both hold the lease."

**Why it fails:** The O(N)-not-O(N²) win is real *only when writes hit disjoint cells* — i.e., when workers aren't actually competing for anything. But the motivating use case *is* competition: everyone wants `payments/`. Claims and CAS route through one hub transaction (`scratch_cas` on a hub transaction; the `take` is atomic on one authority). Under a fleet all working the same subsystem, claim contention is not the rare case the doc assumes — it is the **common** case, and it serializes on a single hub. That is textbook Amdahl: the parallel speedup is bounded by the serialized fraction, and coordination *is* the serialized fraction. Precisely when coordination is needed, you're back to a serialized queue — you rebuilt the bottleneck you were fleeing. And it's worse than a normal lock, because the doc insists claims are **advisory**: *"A soft lock is a courtesy, not a fence — a worker can ignore 'someone's in payments/' and the Board won't stop it… it is not a mutual-exclusion mechanism"* (coordination-repl.md §Limitations). So you pay the serialization cost of a lock and get none of the exclusion — the hub CAS orders the claims, then every loser can proceed anyway. Worst of both. The doc's own prior-art row concedes the pattern: Redis agent-memory — *"'Any agent writes anything, instantly global' — contention under high write loads is acknowledged even by proponents"* (coordination-repl.md Prior-art).

**Concrete scenario:** N=8 all target `payments/**`. Eight `scratch_claim`s serialize through the hub. Seven receive `conflict:` as data and — per "advisory: caller decides" — each burns an **LLM reasoning turn** to decide wait/negotiate/proceed (N−1 turns to resolve one resource). Because it's advisory, several proceed regardless, and two workers edit `payments/stripe_adapter.py` concurrently in overlapping regions → the exact merge collision the Board was built to prevent. Serialization cost incurred; coordination benefit zero.

**Severity: fatal** — the scaling win evaporates in exactly the regime that motivates the mechanism, and the fallback semantics don't provide the guarantee that would justify the cost.

---

### FATAL 3 — The headline "shared code index" stigmergy example contradicts atlas's own isolation model: there is no live shared substrate to be stigmergic about

**Claim attacked:** doc 10 §2 T3 lists as a primary stigmergic medium: "**The shared code index** — one fleet-wide index every worker reads instead of each re-walking the tree; **a worker's edit invalidates a cell others observe.**"

**Why it fails:** atlas is explicitly built so that a worker's edit does **not** invalidate a cell others observe. Its defining constraint is per-worker isolation: *"A naive shared index would show worker w2 the uncommitted edits of w5 (wrong: breaks isolation)"* and the fix is that each worker's overlay indexes "just that worker's dirty files… A worker sees *its own* uncommitted edits and *nobody else's* (isolation preserved)" (discovery-search.md §Shared-vs-per-worker, §Problem #3). The shared *base* is **immutable**. So the only truly shared, mutable, stigmergic channel for code is *committed* state — which changes at commit tempo (minutes→hours, doc 08's *coordinative* tempo), not the operational "read/write and react" tempo T3 advertises. The pheromone is **invisible until commit-and-rebase**. Doc 10's sentence "a worker's edit invalidates a cell others observe" is simply false for the very mechanism it cites as the exemplar. Stigmergy presumes one shared environment all agents perceive; baton's architecture *fragments* the environment per worktree by design. You cannot have both worktree isolation (required, doc 06/08) and live cross-worker code stigmergy — they are contradictory. The module critic drives the same nail: cross-worker fact reads are "trusting a result about **code it isn't running**… the Board is a staleness generator dressed as shared knowledge" (coordination-repl.md §4).

**Concrete scenario:** w2 edits `payments/stripe.py` in its worktree. Doc 10 promises w5 "observes" the invalidated cell. Reality: w2's change lives in w2's private overlay; w5's `code_grep` returns the shared *base*, which still shows the old code. w5 proceeds against stale reality with zero signal that w2 is mid-rewrite — the isolation guarantee *forbids* the stigmergic signal. The coordination doc 10 claims is happening cannot happen.

**Severity: fatal** — the flagship stigmergic-substrate example is architecturally impossible under the fleet's own isolation invariant; the code plane is stigmergic at commit tempo at best.

---

### SERIOUS 4 — "Degrades gracefully — a crashed agent leaves its marks" is backwards; the fix re-imports the entire control-plane liveness apparatus stigmergy was supposed to avoid

**Claim attacked:** "degrades gracefully (**a crashed agent leaves its marks; a new agent reads them**)" (doc 10 §2 T3).

**Why it fails:** For *coordination* state (claims, presence, "I'm refactoring payments/"), a crashed agent's residue is not a helpful mark — it's a **false signal**: "w1 holds `payments/`" when w1 is dead. This is the classic pheromone-trap / ant death-spiral: stale trail, followers march to a dead source. The doc knows this and patches it with leases + heartbeats + TTL + `scratch.claim_expired` events + supervisor I1 fencing. But that patch *is the point*: graceful degradation is **not a property of stigmergy** — it's bought by bolting the full messaging-era control-plane machinery (leases, fences, heartbeats, expiry events) onto every coordination cell. And one leg of that machinery doesn't even work: `scratch_heartbeat` requires a worker to "wake itself every 20s to renew a lease from inside a turn that may run five minutes" — the module critic's verdict is *"should be deleted, not shipped"* (coordination-repl.md §1). So the graceful-degradation claim rests on a heartbeat primitive its own critic says is unworkable, patched by slaving the lease to the supervisor's worker-lease — i.e., by putting the control plane back in the loop. Raw stigmergy degrades *disgracefully*; the doc's own examples (ants averaging over millions) hide this.

**Concrete scenario:** w1 crashes mid-turn holding an exclusive claim on `payments/`. Without a live expiry event, w2..w8 read "w1 holds payments/, +41s" and defer — coordinating around a ghost. With the fix, the substrate now needs a per-cell lease, a fence, and a supervisor-emitted expiry event at a specific `seq` — the exact control-plane apparatus T3 positioned stigmergy as the lightweight alternative to.

**Severity: serious** — a claimed intrinsic property is actually engineered-around at the cost of the O(N) simplicity the bet advertises.

---

### SERIOUS 5 — You didn't eliminate the chatter, you relabeled it as ledger events aimed at the same scarce context

**Claim attacked:** T3's whole indictment of AAI: "direct AAI is O(N²) chatter that **poisons context**"; "Every token a worker sends the orchestrator is a token in the orchestrator's scarce context" (doc 10 §2 T2/T3). Stigmergy is sold as the fix.

**Why it fails:** Scratch emits a `scratch.*` event for **every** fact, signal, claim, heartbeat, cell-update, and retract, plus `bench.*` (coordination-repl.md §Integration). Presence signals carry ~20s TTL and heartbeats; for N workers that's a steady **O(N / TTL)** event stream. Crucially, the doc routes coordination-relevant writes onto the **priority lane**: "claim/fact/retract events ride the priority lane" (coordination-repl.md §Integration), and the orchestrator subscribes to it (`fleet_wait(classes=['scratch'])`). So the stigmergic writes land in the orchestrator's *priority* context — the scarcest resource in the system. You relabeled inter-agent messages as ledger events and pointed them at the same context window the anti-AAI argument said must be protected. "The medium is the record" (design law 5) cuts the other way: the record *is* the chatter, now durably accumulating.

**Concrete scenario:** N=8, 20s presence TTL, heartbeats: ~24 presence/heartbeat events/minute + claim churn as workers enter/leave `payments/`, `auth/`, `api/`. The orchestrator's `fleet_wait` on the priority lane wakes on each, must filter signal from noise. This is precisely the O(N²)-ish context poison T3 attributed to AAI, now wearing a `scratch.*` `kind`.

**Severity: serious** — the primary cost T3 used to condemn messaging reappears, unbudgeted, in the substrate.

---

### SERIOUS 6 — "No fleet_chat" is unenforceable; agents encode directed messages into typed facts, rebuilding O(N²) chatter minus the addressing guarantees

**Claim attacked:** design law 3 "**Prefer stigmergy to messaging**… A `worker↔worker` message is a decomposition smell"; doc 10 §6 Q1 leans "the medium's structure is the safeguard; a message has no structure." Baton has "**no `fleet_chat`**" (doc 10 §1b).

**Why it fails:** The interface is `scratch_post(kind:'fact', body: Json)` (coordination-repl.md §Interface) — an arbitrary JSON body an LLM can trivially fill with `{note: "@w3 I'm taking auth, you take payments"}`. Now you have directed messages (O(N²), the thing banned) laundered through a typed store, and worse: *without* the addressing/delivery guarantees a real message channel would provide (no `to:`, no single-consumer, no receipt). The module's own top-listed failure mode admits it can't be stopped: *"The strongest failure mode is social: agents posting prose 'facts' as messages until the Board is a chatroom… a discipline the design can only **bias, not enforce**"* (coordination-repl.md §Limitations). "Structure is the safeguard" is refuted by the fact that a JSON blob is structured and still a message. The critic's actual fix — "there is **no free-text 'post to the board' verb** a worker calls" — is a *recommendation not in the design*; as written, the free-text post verb exists.

**Concrete scenario:** Two workers colliding on `payments/` do what LLMs do — negotiate in prose. Lacking a message verb, they post `fact: {re: "w3", msg: "you take the retry logic, I'll take the adapter"}`. Others must now read and parse these pseudo-messages out of the fact stream. O(N²) chatter is back, un-addressed, polluting the fact namespace that promotion scans for the KG (re-poisoning the epistemic plane).

**Severity: serious** — the anti-messaging design law is unenforceable against the actual interface, and the doc concedes it can only "bias."

---

### ANNOYING 7 — The 200-token digest bounds output, not coordination correctness; at scale the relevant mark gets `suppressed` and conflicts silently false-negative

**Claim attacked:** "Roughly 200 tokens; `suppressed` + `more` bound the size **regardless of Board volume**" (coordination-repl.md §Agent-ergonomic output).

**Why it fails:** A fixed output budget over a board that grows with N means the digest *drops* items (`"suppressed": 6` in the example, more as N grows). Stigmergy only coordinates if the *relevant* pheromone is perceived; a token-capped digest cannot guarantee the one conflicting claim is in-band. Which items survive truncation is unspecified, and claim-conflict detection by glob intersection is *also* unspecified — the critic flags it: *"Claim conflict = glob intersection, not string equality… Specify it or claims will false-negative on the overlaps that matter most"* (coordination-repl.md §4). Combine an unspecified relevance filter with a hard cap and you get systematic false-negatives at scale: either the digest grows (breaking the "regardless of Board volume" claim) or coordination silently fails as N rises.

**Concrete scenario:** N=15, board holds 40 active claims. w9 about to edit `payments/stripe_adapter.py` calls `scratch_read`, gets a 200-token digest showing the 3 most-recent claims + `"suppressed": 37`. The one claim that conflicts — w4's `path:payments/**`, posted 4 minutes ago — is in the suppressed tail. w9 sees "clear," proceeds, collides. The bounded digest *guaranteed* the miss.

**Severity: annoying** (borderline serious) — bounded perception + unbounded board is a correctness leak that worsens monotonically with N, the scaling axis in question.

---

### ANNOYING 8 — The biological analogy imports none of the properties that make natural stigmergy robust

**Claim attacked:** "This is *stigmergy* — the mechanism ants use… Termites build cathedrals this way" (doc 10 §2 T3).

**Why it fails:** Natural stigmergy is robust *because* it is a **statistical aggregate over millions** of agents — trail strength is a population average, and one ant's wrong deposit is washed out. A baton fleet is N=3–10, where each mark is **individual and load-bearing**. One wrong fact ("the API is idempotent") is authoritative until someone retracts it — no averaging, no redundancy, no error-tolerance. The doc concedes the consequence: *"Two contradictory append-only facts… can coexist live… semantic incoherence is a real residual"* (coordination-repl.md §Limitations). So the analogy does rhetorical work it cannot cash: small-N stigmergy has none of the robustness of large-N stigmergy, and the cited exemplars (ant colonies, termite cathedrals) are precisely the million-agent regime baton will never occupy.

**Concrete scenario:** w2 posts `fact: {api_idempotent: true}` from a misread. In an ant colony, one bad deposit among millions is noise. Here, w5, w6, w7 read it as fleet knowledge and skip their own dedup guards; the promotion pass later graduates it to the KG (cited ≥N). One agent's error propagates unattenuated — the opposite of the robustness the analogy promises.

**Severity: annoying** — the framing oversells; the mechanism inherits none of the properties that make its namesake work.

---

**Bottom line.** The T3 bet survives only in the regime where it isn't needed (disjoint work, no contention). Its O(N) headline miscounts by ignoring that every write must be *read* by up to N−1 agents through paid, context-consuming, poll-driven tool calls (FATAL 1); in the contended regime it collapses to a serialized advisory hub that provides neither scaling nor exclusion (FATAL 2); its flagship "shared code index" substrate is architecturally impossible under the fleet's own worktree isolation (FATAL 3); and its "graceful degradation" and "no chatter" properties are re-purchased by importing exactly the control-plane liveness machinery and priority-lane context cost it claimed to escape (SERIOUS 4–5). The design team's own module critic already found the read-cost hole ("the polling tax… is the whole ballgame") and the diverging-worktree contradiction — but **doc 10's headline O(N)-vs-O(N²) claim was never corrected to reflect them.** Recommend: (a) re-derive the scaling claim counting reads and poll-frequency, not writes; (b) restrict the O(N) claim to disjoint-work regimes and state the contended-regime bottleneck explicitly; (c) delete or heavily qualify "a worker's edit invalidates a cell others observe" — it contradicts atlas isolation; (d) adopt the critic's side-channel-on-tool-results model so observation is genuinely free (the only thing that would make the ant analogy honest), and remove the free-text `scratch_post` fact verb.

## BLUE
I have read doc 10 (§2 T1/T2/T3, §5 laws, §6 open questions), coordination-repl.md (interface, integration, limitations, and its own critic appendix §§1–6), discovery-search.md (base⊕overlay isolation model + critic), doc 08 (three tempos, §4 concurrency), capability-plane.md (envelope, five laws, §4 shared-state consistency), and the supervisor invariants (I1/I3/I4/I6/I7, §4 lane discipline). Here is the blue-team ruling.

## Blue-team: stigmergy-scale

Framing that governs every finding below: the red team attacks **doc 10's headline prose**, but the load-bearing mechanisms live in `coordination-repl.md` (including its own ratified critic appendix, which doc 11 §"Honest cross-cutting risks" explicitly "carrie[s] to the red/blue team"), `capability-plane.md`, and the supervisor spec. Several "fatals" are prose-precision debts where doc 10 was never reconciled with its own module critic — not architectural refutations. Where that's true I say so and give the exact edit; where the attack lands, I concede.

---

### FATAL 1 — "O(N) reads is really O(N²)" — **DEFEND (core) + CONCEDE-AND-FIX (the headline's metric)**

**Defend the complexity core.** The red team's own concrete scenario refutes its N² claim. It computes "8 × 30 × ~200 tokens ≈ 48k" — that is **N·E** (workers × edits-per-worker), and E=30 is a property of a worker's own turn, **not a function of N**. Total reads = O(N·E), i.e. *linear* in N with a per-worker constant. To reach N² the red team needs the premise "poll frequency must scale with the write rate ∝ N" — i.e., every worker must re-poll on *every other worker's* write. That premise is false: a worker reads before its own *contended actions* (E of them), not on the board's global write clock. Higher N raises the *fraction* of those E reads that return a conflict; it does not raise the *count* of reads a worker issues. The N² term is manufactured by conflating "the board's write rate scales with N" (true) with "each worker reads at the board's write rate" (false).

**The unit-mismatch cuts the other way.** T2 fixes the metric explicitly: *"Every token a worker sends the orchestrator is a token in the orchestrator's scarce context"* (doc 10 §41). The O(N²) indictment of AAI is about **the one scarce shared context** — in hub-and-spoke AAI, all N workers' coordination traffic concentrates there. A `scratch_read` lands its ~200-token digest in the **reader's own worker context** — one of N *independent, separately-budgeted, disposable* contexts, and it never touches the orchestrator's. So even granting O(N·E) total read-ops, they distribute as O(E) per disposable worker context and O(0) on the scarce one. That is the architectural distinction the red team collapses by counting raw ops instead of the metric T2 actually defined.

**The red team's cheaper alternative secretly *is* stigmergy.** "w-i pings only the specific holder of a conflicting claim, on demand" presupposes w-i already *knows there's a conflict and who holds it*. Discovering that is exactly `scratch_read`/`scratch_claim`. The targeted ping is *additional* to that read, not a replacement for it. There is no messaging scheme that coordinates on a contended resource without either broadcasting intent (O(N²) into contexts) or **reading shared state** — and reading shared state *is* stigmergy. So stigmergy is a strict subset of the messaging cost, not a superset.

**Concede-and-fix the headline.** The critic already conceded the absolute polling tax is uncosted (*"The polling tax is uncosted, and it's the whole ballgame"* — coordination-repl §2), and doc 10's bare "O(N) reads/writes" invites exactly the red team's misread. Fix: amend doc 10 §53 to state the metric — **"O(N) reads into N disposable per-worker contexts vs O(N²) messages into the one scarce orchestrator context"** — and adopt the critic's §6 ambient-observation model so per-edit reads cost zero extra round-trips: *"When a worker calls Edit(payments/foo.py), the hub injects into the tool result… '⚠ w1 holds soft claim path:payments/**'… Zero extra round-trip… smell the pheromone in the results of work you were doing anyway."* That is the one change that makes the ant analogy's "ambient, free perception" literally true.

**Residual.** In an *irreducibly contended, high-edit-rate* turn the absolute per-worker read cost is real even at O(N·E), and the ambient side-channel is a critic recommendation not yet promoted into the shipped interface. Until it is, correctness-conscious workers pay E digest reads per turn.

---

### FATAL 2 — "Contended regime = serialized advisory hub, worst of both worlds" — **DEFEND**

**The serialized fraction is a CAS, not the work.** doc 08 §4: *"Task claims are the only place that needs serialization… Everything else is either single-writer… or immutable-once-written."* coordination-repl §Shared-vs-per-worker: *"Claims + CAS-cells — the only serialized paths: CAS on a hub transaction, typed failure… Losers re-read; nobody blocks."* Amdahl bounds speedup by the serialized fraction — and that fraction is a microsecond compare-and-swap on one cell, with **non-blocking losers**, not the editing. The actual work (editing files) happens fully in parallel in isolated worktrees. The red team conflates "the claim registry serializes writes *to itself*" (true, cheap, non-blocking) with "coordination serializes *the work*" (false).

**The "no exclusion" critique misattributes the exclusion boundary.** The design never claims the Board excludes. coordination-repl Limitations: *"A soft lock is a courtesy, not a fence… enforcement lives in the OS sandbox + worktree isolation… it is not a mutual-exclusion mechanism."* The real mutual-exclusion boundary is **worktree isolation**: two workers editing `stripe_adapter.py` do so in *separate worktrees* — they physically cannot clobber each other. The red team's "two workers edit concurrently → the exact merge collision the Board was built to prevent" is doubly wrong: (a) the Board was never built to prevent merge collisions — worktree isolation + hub-serialized, I7-re-verified merge is; (b) concurrent edits in isolated trees are *safe until merge*, and a merge conflict is *detected by the hub and routed back as a refinement task*, never a silent corruption. So "coordination benefit zero" ignores the safety net that actually holds. The advisory claim's job is narrower and real: let cooperative workers *avoid duplicate effort by choice* — a work-saving optimizer layered above the isolation/merge safety floor.

**Genuine single-resource contention is correctly re-serialized at the task layer.** doc 10 §3: work "decomposes by task… its boundaries are drawn for parallelizability." If 8 workers genuinely need the same file, that's a decomposition failure, and the design detects and repairs it: coordination-repl §Integration — *"a soft claim that keeps getting renewed and blocks real progress is a signal to the orchestrator to mint a hard task"* — sharpened by the critic §3 into a named `claim.contended` derived signal. Irreducibly serial work *should* be one task on one worker; the advisory conflict signal is exactly the feedback that surfaces "this shouldn't be 8 workers." No coordination scheme — message or mark — can safely parallelize a serial single-file edit.

**Residual.** doc 10 states the O(N) win only for the disjoint case implicitly. Fix: add one sentence — "under irreducible single-resource contention the work is serial and re-decomposes to one task (surfaced by `claim.contended`); stigmergy provides no parallelism there because none exists." That is honesty, not a bottleneck the design failed to see.

---

### FATAL 3 — "Shared code index stigmergy contradicts atlas isolation" — **CONCEDE-AND-FIX** (the sentence is false; the capability survives, redistributed)

**The attack lands on the literal sentence.** doc 10 §49 — *"a worker's edit invalidates a cell others observe"* — is **false for uncommitted edits**. discovery-search is explicit: *"A worker sees its own uncommitted edits and nobody else's (isolation preserved)"*; capability-plane §4: *"a worker's edit invalidates only the cells it touched, for that worker's overlay, not the shared base."* So the invalidation is real but scoped to *the editing worker's own view* — doc 10 mis-wrote "others observe."

**But the capability the sentence gropes at exists — in a different module.** The red team's own concession names the seam: *"the only truly shared, mutable, stigmergic channel for code is committed state."* Correct — and that is a genuine stigmergic medium at **coordinative tempo**: discovery-search — *"Commit folds overlay into a new base node via Merkle structural sharing… the new base is shared by any worker that rebases onto it."* The design's error is a **tempo/substrate conflation, not an impossibility**. Split the medium:
- **Code *content* stigmergy** (the actual bytes) is commit-tempo and isolation-bounded — correctly so. atlas is the substrate; a commit is the pheromone deposit; rebase is perception.
- **Code *metadata* stigmergy** (the *fact* that w2 is mid-rewrite of `payments/`) is **live and isolation-preserving**, and it already has a home: a **Scratch claim** `path:payments/**` + the `scratch.claim_acquired` ledger event. w5 reading that claim learns "w2 is rewriting payments/" *without* seeing w2's uncommitted bytes — exactly the operational cross-worker signal the red team says is missing, delivered by the module built for it.

So "you cannot have both worktree isolation and live cross-worker code stigmergy" is true only for *content*; the design never needed content to be the live medium — the live medium is the ledger + Scratch, which broadcast the fact-of-edit while isolation protects the bytes.

**Fix.** Rewrite doc 10 §49: *"The shared code index — one fleet-wide base index every worker reads instead of re-walking the tree; stigmergic at commit tempo (a commit folds into a new shared base node others rebase onto). Live coordination on in-flight contended paths rides Scratch claims and the ledger, not the index — worktree isolation forbids cross-worker visibility of uncommitted edits, by design."*

**Residual (honest).** Baton has **no live cross-worker visibility of uncommitted code *content*** — and that is intended (isolation). Any coordination that would require seeing another worker's actual in-flight bytes is impossible; the fleet coordinates on the *fact* of the edit, never the bytes. Workers must treat cross-worker code as commit-tempo truth. This is a real capacity limit, correctly chosen, that doc 10's prose oversold.

---

### SERIOUS 4 — "Graceful degradation re-imports the control plane; heartbeat is unworkable" — **DEFEND** (with an internal-consistency concession)

**The heartbeat objection is already resolved by the doc's own critic — and the fix adds zero new machinery.** The red team is right that a worker cannot `scratch_heartbeat` itself every 20s from inside a 5-minute turn. The critic §1 already ruled: *"scratch_heartbeat should be deleted, not shipped… The claim lease must be slaved to the worker's existing supervisor lease (I1)… renewed by the adapter observing worker liveness (which the supervisor already does for stall detection)."* So renewal is **not a worker action** — it piggybacks on the I1 lease the supervisor *must* maintain for stall detection regardless of whether Scratch exists. `claim.lease_expires = min(requested_ttl, worker_supervisor_lease)`. No second liveness system; the ghost-claim fix falls out of machinery already running.

**TTL/lease-expiry is not a control-plane import — it *is* pheromone evaporation, a core stigmergic mechanism.** The red team's "ants don't have leases" is biologically wrong: ant pheromone *evaporates on a timescale*, and that evaporation is precisely what prevents dead-source trails from persisting — it is the natural fix for the death-spiral the red team invokes. A leased claim with TTL is the digital evaporation rate. And the `scratch.claim_expired` event is itself a **stigmergic mark** — others *read* the expiry from the shared medium; nobody is *messaged* "w1 is dead." Reusing the durable ledger/lease substrate that everything rests on is not "putting the control plane back in the loop"; it is stigmergic coordination resting on durable substrate, which is the whole point (design law 5: *"the medium is the record"*).

**Graceful degradation is *unqualified* for durable marks.** The red team narrows to liveness state (claims/presence). For the other stigmergic media — the ledger, git commits, posted facts, the KG — a crashed worker's marks are straightforwardly durable and helpful: its committed code, its facts, its events survive and inform successors with no ghost problem, because a fact is timeless while a claim is a liveness assertion. "A crashed agent leaves its marks; a new agent reads them" is literally true for the durable media and true-with-evaporation for the liveness media.

**Concede (internal inconsistency).** The module's *interface* section still lists `scratch_heartbeat(claim_id)` as a worker verb, contradicting its own §1 critic. The doc is internally inconsistent until that verb is struck and the lease-slaving is written into the interface. And the design *must actually ship* lease-slaving (not worker heartbeat) or the ghost-claim bug is real.

**Residual.** doc 10's blanket phrasing should distinguish durable marks (graceful, unqualified) from liveness marks (graceful *only because* they self-evaporate via I1-slaved leases). The correctness of the whole property is contingent on the adapter-driven renewal actually being built — a build obligation the interface hasn't yet reflected.

---

### SERIOUS 5 — "You relabeled chatter as ledger events aimed at the same scarce context" — **DEFEND** (with an enumeration concession)

**Worker↔worker stigmergy does not route through the orchestrator's context at all.** The red team's premise is `fleet_wait(classes=['scratch'])`. But `classes` is a filter the orchestrator *chooses*: supervisor §3a — *"classes lets the orchestrator subscribe to a priority lane only (e.g. ['control','health'])."* When w2 reads w5's claim, the flow is worker→board→worker; the orchestrator sees it only if it opts in. That is exactly the T3-vs-T2 distinction: the coordination that used to concentrate on the scarce context now flows peer-to-peer through shared substrate and never lands there unless the orchestrator asks.

**The lane discipline routes the chatty signals *away* from priority — the red team miscategorizes what rides it.** coordination-repl §Integration puts only *"claim/fact/retract events on the priority lane"* — the rare, load-bearing ones — while *"Bench output deltas are bench.* on the bulk lane (coalescible/droppable)… a chatty shared kernel degrades resolution, not fleet safety."* The red team's alarm is the *high-frequency* traffic: presence heartbeats at 20s TTL, O(N/TTL). Those are `scratch.signal` (LWW presence) — high-frequency, coalescible, droppable — which by the supervisor §4 lane definition (bulk = *"coalescible/droppable"*; priority = *"small, rare, load-bearing"*) belong on the **bulk lane**, where overflow coalesces to *"last-N + a dropped: k marker."* The O(N/TTL) presence stream degrades *resolution on the bulk lane*, not the orchestrator's priority context.

**Whatever the orchestrator does see is a bounded digest, not raw events.** supervisor §4: *"The digest the orchestrator sees is computed from the priority lane + coalesced bulk, so a delta flood degrades resolution, not safety."* Plus the ~200-token `suppressed`+`more` cap. Context cost is bounded regardless of event volume.

**Durable-on-disk ≠ in-context.** The red team's "the record *is* the chatter, now durably accumulating" conflates two costs. T2's "poisons context" is about tokens *in a model's window*; a JSONL ledger growing on disk poisons *nothing* until read, and every read is digest-bounded and *pull*-initiated by the reader (who can decline), unlike an AAI message *pushed* into a recipient's window with no opt-out. Durable accumulation costs disk and buys auditability/replay; it does not cost context.

**Concede (enumeration gap).** The doc explicitly routes only claim/fact/retract to priority and never states where `scratch.signal` presence/heartbeat goes. It *must* be pinned to the bulk lane, or a naive implementation routing presence to priority makes the red team's O(N/TTL) flood real. Fix: one line — "presence signals and heartbeats ride the bulk lane (coalescible/droppable); only claim/fact/retract ride priority."

**Residual.** The defense is contingent on that lane assignment being made explicit; as written it is implied by the lane *properties* but not enumerated for `scratch.signal`.

---

### SERIOUS 6 — "No fleet_chat is unenforceable; agents launder messages into typed facts" — **CONCEDE-AND-FIX**

**Concede the shipped interface is abusable.** `scratch_post(kind:'fact', body: Json)` accepts an arbitrary body an LLM can fill with `{note:"@w3 …"}`, and the doc itself admits it can *"only bias, not enforce."* The red team is right that a JSON blob is structured and still a message, and that the anti-messaging design law (§93) is a *pressure*, not an invariant. I will not hand-wave that.

**But the fix is already written *in the doc*, mechanism-backed, within the same contract — it must be promoted from critic to interface.** The red team dismisses the critic's §6 as "not in the design," but the critic appendix is part of the ratified doc and doc 11 §"Honest cross-cutting risks" explicitly carries these passes forward. The mechanism: *"there is no free-text 'post to the board' verb a worker calls… the Board cannot become a chatroom — the anti-pattern is designed out, not merely biased against."* Concretely:
1. **Remove the worker-callable free-text `scratch_post`.** Workers emit facts *only* via structured side-channels — auto-presence on first scoped edit, `bench_run(publish_as:…)` (a fact minted from a *sandboxed computation*, not prose) — and read via `scratch_check`/`scratch_read`. Free-form posting becomes **orchestrator-only** (arbitration).
2. **Turn schema-check from bias into enforcement.** The interface already says *"schema-checked if a schema is registered."* Require a registered schema for any worker-posted keyed fact; a `{re:"w3", msg:…}` blob fails validation. The residual (unschema'd ad-hoc facts) closes because unschema'd worker posts are rejected.
3. **The existing structural absences already defang the laundered message:** *"there is no to: field; watch is content-addressed not agent-addressed"* (Limitations). A stuffed "@w3" is never *delivered* or *addressed* — w3 sees it only by coincidentally querying a matching glob. So even pre-fix, the channel is a *bad* message bus (no delivery, no receipt), which makes chat-through-facts unreliable, not merely discouraged.

**The escalation to KG re-poisoning is blocked by the promotion gate.** The red team's "re-poisoning the epistemic plane" requires the pseudo-message to be *promoted*. Promotion scans facts *"read ≥N times or referenced by a completed task"* (coordination-repl §Integration) and the epistemic plane applies provenance + temporal-coherence audits (doc 08 §2). A directed message relevant to one recipient structurally won't be cited ≥N times, and un-cited facts *"simply TTL away, uncurated."* So the KG is protected by construction even when a pseudo-message slips onto the Board.

**Residual (honest).** Even after removing the free-text verb, two cooperative LLMs can *steganographically* coordinate through the *content* of legitimate facts (post a real fact whose existence signals intent). You can constrain a shared medium's *shape*; you cannot prevent two cooperating agents from encoding signals in any shared channel. The design's honest position is that this is acceptable because it is (a) auditable (every write is a ledger event), (b) ineffective as a covert bus (no addressing/delivery), and (c) promotion-gated against KG poisoning. The anti-messaging law is a strong design pressure with structural teeth, **not** an inviolable invariant — concede that framing explicitly rather than claiming enforcement.

---

### ANNOYING 7 — "Bounded digest false-negatives the relevant conflict at scale" — **DEFEND** (with a spec-tightening concession)

**The authoritative pre-edit conflict check is `scratch_claim`, which is *not* digest-bounded.** The red team attacks the ~200-token `scratch_read` *survey* as if it were the coordination path. It isn't. The correctness primitive is `scratch_claim`, whose interface returns *"conflict: [{ holder, intent, resource, lease_expires }]"* — the **full** set of intersecting holders computed *server-side at acquire time*, as data, with no 200-token cap. A worker acquiring a claim on `payments/stripe_adapter.py` gets *every* conflicting holder (including the `path:payments/**` claim), not a truncated digest. The 200-token cap governs `scratch_read` (ambient survey), never the claim-acquire. A worker that coordinates by eyeballing the survey digest instead of acquiring a claim is misusing the API; the design intends the claim (or the critic's boolean `scratch_check(resource) -> {clear} | {held_by,…}`) as the pre-contended-edit check, and that path cannot truncate away the relevant conflict.

**Scoped queries filter before suppression.** `scratch_read` takes `resource_glob`; the red team's false-negative requires w9 to query the *whole* `payments/**` namespace and let the specific conflict fall into the suppressed tail. A correctly scoped `scratch_read({resource_glob:"payments/stripe_adapter.py", kinds:['claim']})` filters to *intersecting* claims first; suppression then applies to irrelevant residual breadth, not the queried resource's conflicts.

**Concede (two real, critic-flagged gaps).** (a) Glob-intersection conflict semantics are unspecified — critic §4: *"Claim conflict = glob intersection, not string equality… Specify it or claims will false-negative on the overlaps that matter most."* This *must* be specified as a write-time server-side check on `scratch_claim`. (b) Rank-before-truncate for `scratch_read` is unspecified (the analogous demand is made explicit for atlas in discovery-search critic §2); the survey must rank by relevance (glob-intersection, exclusivity, recency) *then* cut, with suppressed-conflict count in the summary.

**Residual.** A worker that relies on the ambient survey rather than acquiring a claim *can* miss a suppressed conflict. The durable fix is the critic's §6 ambient side-channel: inject the intersecting claim into the *Edit tool result itself*, so conflict awareness never depends on the worker choosing to survey — the server computes intersection at the moment of the contended action, unbounded by any read digest.

---

### ANNOYING 8 — "Biological analogy imports none of the properties that make natural stigmergy robust" — **DEFEND**

**Baton substitutes re-verification for population averaging — a *stronger* small-N mechanism.** The red team assumes stigmergy's only robustness source is large-N averaging. Baton has a mechanism ants lack: every load-bearing mark is **re-runnable by the hub**. capability-plane law 4: *"Any capability output a downstream decision trusts… is re-runnable by the hub via reverify… a worker cannot forge a capability result the hub re-checks (supervisor I7)."* A wrong `{api_idempotent:true}` doesn't need millions of contradicting ants to wash out — it needs *one* hub re-verification. coordination-repl: *"a bench result is an unverified claim… until the hub independently re-runs the brief's verification — a worker cannot launder a wrong answer into fleet-trusted truth."* Averaging needs many samples; re-verification needs one authoritative re-run. That is *better* at N=3–10, not worse.

**The design already concedes no-averaging and routes truth-adjudication downstream — a labeled residual, not a hidden flaw.** coordination-repl Limitations: *"The Board does not adjudicate truth. Two contradictory append-only facts can coexist live… the epistemic plane, with provenance and temporal-coherence audits, is where contradictions get resolved, and that's deliberately not this module's job."* The Board is explicitly the fast, un-adjudicated lane; correctness lives in the epistemic plane + I7. The red team presents as a gotcha what the design states as a mitigated residual.

**Small-N corroboration replaces the fake precision the red team implicitly leans on.** The critic §2 already killed `confidence: 0.8` (*"fabricated precision… Replace with structural confidence the hub can actually compute: corroboration count (N independent posts of the same key), cited count"*). "3 workers independently observed this" is the honest small-N aggregate — not millions, but real, and paired with re-verification for anything load-bearing.

**The analogy's actual claim is a topology claim, and it holds at any N.** doc 10 §44 invokes ants for exactly one property: *"no ant messages another ant; each modifies the shared environment… and others read it."* That is the coordination-*without-messaging* topology — N-independent, true at N=3 or N=3M. The termite line illustrates emergence from local rules — also topology, not error-tolerance. Neither sentence claims baton inherits ant-colony statistical robustness; the red team imports a property the design never asserted and knocks down the strawman.

**Concede (rhetoric only).** "Termites build cathedrals this way" *evokes* large-N robustness the mechanism doesn't inherit. Trim doc 10 to the topology claim it actually makes; drop any gesture at biological error-tolerance.

**Residual.** If a fleet ships **Rung 0 only** (Board without I7 re-verification and epistemic adjudication), a wrong *un-cited* fact can mislead cooperating workers *within a run* until it TTLs — the small-N fragility is real *for the un-verified fast lane*. That is precisely why load-bearing facts must be I7-gated before they're trusted, and why the ambient survey must never be the sole basis for a consequential decision.

---

### Verdict on the bottom line

The T3 bet **survives**; three of the four "fatals" are not fatal:

- **FATAL 1**: the red team's own numbers are O(N·E) (linear); the N² term needs a false re-poll premise. Defend the complexity, concede-and-fix the headline's under-specified metric (name "scarce orchestrator context," adopt ambient observation).
- **FATAL 2**: the serialized fraction is a non-blocking CAS, not the work; exclusion is worktree-isolation + re-verified merge, which the design states explicitly — the Board was never the lock. Defend.
- **FATAL 3**: genuinely lands on doc 10 §49's sentence, which is false for uncommitted edits — **concede-and-fix** by redistributing the capability (content-stigmergy at commit tempo via atlas base-folding; live metadata-stigmergy via Scratch claims). Not fatal to the architecture; fatal to one sentence.
- **SERIOUS 4/5**: defend on mechanism (I1-slaved leases = evaporation, not control-plane import; lane discipline keeps chatty signals off the scarce context), with a heartbeat-verb-deletion and a presence-lane-enumeration concession.
- **SERIOUS 6**: **concede-and-fix** — remove the worker free-text `scratch_post`, make schema-check enforcing, lean on the no-`to:`/promotion-gate structure; but concede the anti-messaging law is a pressure with teeth, not an invariant.
- **ANNOYING 7/8**: defend (claim-acquire is the unbounded correctness path; I7 + epistemic adjudication + corroboration replace large-N averaging), with spec-tightening concessions (glob-intersection, rank-before-truncate) and a rhetoric trim.

**The one true finding across all eight**: the red team's closing sentence — *"doc 10's headline O(N)-vs-O(N²) claim was never corrected to reflect [its own critic]."* That is right and is the actual defect. It is an **editorial reconciliation debt** — doc 10's prose (§49 code-index sentence, §53 O(N) metric, §44 ant-robustness gesture) predates and was never reconciled with coordination-repl's ratified critic (delete `scratch_heartbeat`, remove free-text post, ambient side-channel, glob-intersection spec). Every architectural mechanism the defense relies on already exists in the design; what's missing is that doc 10's five sentences of headline prose were not updated to match. Fix the prose per the four edits above and the bet is defensible as written.

## EXPLORE & VERDICT
## Explore & verdict: stigmergy-scale

I read doc 10 (§0 thesis, T1/T2/T3, §5 laws), coordination-repl.md (interface + critic §§1–6), discovery-search.md (base⊕overlay isolation), doc 08 (§1 tempos, §4 concurrency). Red attacked the O(N) math *inside* the frame; Blue defended *inside* the frame. Neither asked the question the user actually posed: **is "stigmergy/AIAI is the bet" the right name for what baton built?** It isn't — and that mislabel is the root cause of every wound both teams circled.

### The strongest alternative

**Recast T3 from "stigmergy" to what the mechanisms literally are: a hub-owned coordination *service* (etcd/Consul advisory leases + Bazel content-addressed result cache + a shared read index), sized for small-N, with the parallelism strategy being "partition so coordination is rare" (shared-nothing), not "build a rich substrate to coordinate the contended."**

The tell is in baton's own text. Stigmergy's *defining* property (Grassé) is coordination **without a central coordinator** — ants have no queen routing traffic. But baton has one: coordination-repl.md line 45 — *"All verbs are hub-mediated, fence-checked, and emit ledger events."* Claims serialize through *"CAS on a hub transaction"* (line 149). Contention is resolved by *"the supervisor... inject the decision as a `steer`"* (critic §6, line 279). The Board is *"the materialized view"* the hub owns (line 100). This is not indirect coordination through a shared environment — it is a **centrally-mediated shared-state service**. The module's own critic already names the honest lineage: *"The claim/lease/heartbeat/fence design **is** an advisory distributed lock with a fencing token... I1's fence **is** Kleppmann's fencing token"* (line 267), and points at Bazel RBE (line 265), Ray's object store (266), Chubby/etcd/Consul (267). None of those are stigmergy. They are 20-year-solved distributed-coordination primitives wearing an ant costume.

The alternative keeps **every mechanism** and drops **only the narrative**: Board = advisory-lease service, Bench = Bazel-style action cache, atlas = shared index, ledger = append log, KG = promotion sink. Then the parallelism thesis flips to shared-nothing: doc 08 §4 line 50 already says *"Task claims are the only place that needs serialization... No shared mutable world state blob."* The winning large-scale parallel systems (MapReduce, Bazel hermetic actions, git worktrees) don't get rich coordination — they get **independence by construction** and treat contention as a decomposition bug. Blue's own defense of FATAL 2 concedes this: contention *"is a decomposition failure, and the design detects and repairs it"* by re-minting one task. So the design budget belongs in **decomposition + merge-conflict-as-refinement (the real safety floor, already via worktree isolation + I7)**, not in a blackboard.

### Honest comparison

| | baton's T3 framing | Coordination-service + shared-nothing |
|---|---|---|
| Scaling story | "O(N) reads/writes... degrades gracefully" (doc 10 §53) — miscounts reads, dies under contention (Red FATAL 1/2) | "Advisory leases serialize on the hub; sized for N=3–10; contention is a decomposition signal" — no O(N) claim to falsify |
| Perception cost | ant analogy promises free ambient sensing; reality is a paid ~200-tok poll per look (critic §2: *"the polling tax... is the whole ballgame"*) | Honest: reads cost tokens; minimize by partitioning + injecting conflicts into tool results workers already call |
| Robustness | borrows large-N statistical averaging baton never has at N=3–10 (Red FATAL 8; Blue concedes rhetoric) | Doesn't claim it; trust comes from I7 re-verification, not population averaging |
| "Novel third topology" | rhetorically grand; weaponizable | mundane, correct, immune to the four failure modes |

Where baton's framing genuinely wins and the alternative must keep it: the **design *pressure*** — "prefer modifying durable shared structure over ephemeral messaging" (law 3) — yields the auditability/replay win (law 5, *"the medium is the record"*, no-invisible-hand). That's real and survives dropping the biology. So this is not "throw T3 out"; it's "keep the 60% that's distributed-systems hygiene, cut the 40% that's misleading zoology." The cost of the reframe is deflating doc 10's grand "beyond-HCI, third-topology" narrative — but that narrative is precisely the surface the red team attacked, and it buys nothing the coordination-service framing doesn't.

The **10×-smaller version that captures ~80% of the value** (and is exactly what coordination-repl's own critic argues for): delete `scratch_watch`, `scratch_heartbeat`, CAS cells, and the free-text `scratch_post`; keep only (a) an advisory lease **slaved to the I1 worker lease** (critic §1, line 223), (b) presence **auto-emitted on first scoped edit**, and (c) the conflicting claim **injected into the Edit tool result** (critic §6, line 276). That is ~20% of the current surface. Everything else in Rungs 1–4 is speculative at N=3–10 — and per the critic's own verdict (line 214), *"Rung 0 ships a board the orchestrator can watch but that doesn't yet coordinate workers — the thing that makes it useful."*

### Verdict: REVISE — right instinct, wrong frame

Not KEEP: the "stigmergy/O(N)/biology" framing is not decoration — it *causes* the defects (miscounted scaling, uncosted polling, non-transferable robustness, the chatroom-drift that "the medium is the record" makes sound benign). Not CUT: the useful core — *don't route worker↔worker coordination through the orchestrator's scarce context; coordinate through durable hub-mediated structure so it's auditable* — is correct and load-bearing. Not REPLACE-wholesale: the alternative keeps every mechanism baton already designed.

REVISE means: **rename and re-anchor T3.** Strike "AIAI/stigmergy is the bet"; state it as "mediated shared state, not broadcast messaging — a coordination service in the etcd/Bazel/Consul lineage, sized for small-N, with partitioning as the primary parallelism strategy and the Board as a thin advisory layer above the worktree-isolation + I7-merge safety floor." This is stronger than Blue's "editorial reconciliation debt" verdict: Blue treats the five bad sentences as prose that drifted from the mechanisms; I claim the *frame itself* is the bug, because it keeps generating bad prose (and invites the next reviewer to re-run the same O(N) miscount) as long as "stigmergy" is the headline.

### The one thing to get right

**Make coordination a byproduct of hub-mediated work the worker was already doing — not a discipline it must remember to poll.** Concretely: no worker-callable read/post/heartbeat verbs; the hub injects the conflicting claim into the `Edit` tool result at the moment the worker touches a contended path, and auto-emits presence on first scoped edit (critic §6). This is the linchpin both teams converge on from opposite sides: it is the *only* change that makes the read cost genuinely free (the thing the ant analogy **promises** but the current poll-driven design **fails to deliver** — Red FATAL 1), and it structurally kills the `fleet_chat`-drift the design admits it can *"only bias, not enforce"* (line 170) by removing the free-text post verb entirely. Get that one move right and the frame survives contact with contention; leave it as a critic footnote and the whole T3 bet remains, as Red showed, an accounting error dressed as an architecture.
