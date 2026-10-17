# Red/Blue/Explore — paradigm-vendor-obviation

## RED
## Red-team: paradigm-vendor-obviation

*Target: the paradigm & product frame — is baton the right thing to build at all? Read in full: doc 10 (interaction model), doc 12 (context/harness engineering), doc 11 (capability plane), doc 06 Q1/Q5/Q7, doc 01 §5/§6/§7, doc 09 §D/§F, and the three vendor dossiers (`claude-harness.md`, `claude-agent-sdk.md`, `codex-app-server.md`, `codex-runtime.md`). Attack only, ranked. Every citation is from the corpus.*

---

### FATAL-1 — The one differentiator (cross-vendor) is simultaneously the part vendors won't build *and* the part their ToS forbids. Baton is squeezed to zero from both sides.

**Claim attacked.** Doc 06 Q5: *"a third-party protocol bet competes with all of them. A third-party compatibility layer rides all of them. Stay a compatibility layer."* The whole strategic bet is that riding all three vendors is a durable niche because no single vendor spans them.

**Why it fails.** The corpus itself splits baton's value into two disjoint sets, and *both* are non-viable:
- **The valuable, buildable parts get built by the vendors** (see SERIOUS-1) — supervisor, reattach, telemetry, cross-review, multi-agent, skills. Single-vendor orchestration is "already good" (doc 06 Q1 opening line).
- **The one part vendors structurally *cannot/won't* provide — a single control plane spanning Claude+Codex+GLM — is precisely the part their economics forbid.** Doc 01 §7 + doc 09 §F5: Anthropic *already tried to meter programmatic subscription use* (2026-05-14), cancelled it but is *"reworking, not abandoning"*; Z.ai *"contractually restricted to officially supported tools … enforcement includes rate limiting, account freezing, bans"*; OpenAI *"directs job automation toward the Codex SDK"* (API-billed), and the app-server dossier's own §12 shows OpenAI wants enterprise integrations to *register a known client* — i.e. be identifiable and governable. Cross-vendor subscription orchestration is the *definition* of the arbitrage each vendor is moving to kill, because it cannibalizes their per-seat pricing.

So baton's survivable niche is exactly the contraband one. The docs' own hedge — doc 09 F5, *"subscription auth is provisionally allowed and vendor-narrow; API-key fallback is the default posture"* — quietly dissolves the thesis: if the default posture is API-key billing, baton is an API-orchestrator wearing a harness costume, and doc 00's own non-goal (*"Building a general multi-agent framework … those orchestrate API calls, not harnesses"*) fires on baton itself.

**Concrete scenario.** A user runs the "flat-rate three-vendor fleet" (doc 00 §2, the founding pitch). Month 1 works. Month 3: Anthropic reships the metered-programmatic split it announced in May; the GLM seat was always concurrency-1 (below); Codex tells them to move to the SDK. To keep running, the user sets all three to API keys — at which point they are paying per token to run three vendor CLIs through a fragile hub instead of calling three APIs through LangGraph. The harness-specific value (system prompts, sandboxing, compaction) is real but does not require baton — `codex exec` and `claude -p` deliver it in a for-loop. The cross-vendor control plane, the only thing baton adds, is the thing that just got switched off.

**Severity: fatal.** The value and the viability are anti-correlated; there is no configuration where both are present.

---

### FATAL-2 — "Three-vendor fleet" is inflated: it is a two-harness reality plus a model swap, and the GLM seat is a single worker with a queue.

**Claim attacked.** Doc 00 §2 / doc 01 §5: *"A three-vendor fleet on flat-rate plans is an economically different object than an API-billed swarm,"* built on *"{Claude Code, Codex CLI, Z-code/GLM harness}."* The headline is heterogeneity-as-asset (doc 12 §3: *"Heterogeneity is the asset"*).

**Why it fails.** The corpus refutes its own headcount:
- Doc 09 **D1** (accepted VALID): *"'Harness' conflates surface × model × seat. glm-adapter is really claude-surface + glm-model."* Doc 01 §5: *"Claude Code IS the GLM harness."* The Codex external review states it flatly: *"GLM-through-Claude is a second model provider, not a third independent harness architecture."* So baton adapts **two** harness surfaces (Claude Code, Codex), not three. A third of the advertised diversity is an `ANTHROPIC_BASE_URL` swap on an adapter baton already has.
- The remaining GLM "fleet" isn't a fleet. Doc 01 §7: Z.ai rations *"by concurrency tier … a GitHub issue documents Pro-tier concurrency of 1 in-flight request."* Doc 06 Q7: *"A GLM 'fleet' on a Lite/Pro plan is one worker with a queue."* And GLM burns *"3× during peak hours."*

So the marquee "error-decorrelation ensemble" (doc 12 §3, best-of-N across Codex/Claude/GLM) is, in the flat-rate world that justifies the project, a best-of-2 where one arm is throttled to serial. Doc 12 open-Q5 already sees the hole — *"the ensemble multiplies cost by N and hits per-vendor concurrency ceilings … when is decorrelation worth the N×"* — but never answers it, and the answer at concurrency-1 is "never."

**Concrete scenario.** Doc 06 Q9's honest eval ("orchestra beats soloist") is run. Arm (c), the baton fleet, is Claude-surface + Codex + a GLM seat that can hold one request. Against arm (b) — a single Claude Code session using its *native* agent teams (which already spawns Codex teammates: `claude-harness.md` §2.1 shows a live team member `"agentType": "codex:codex-rescue"`) — baton must demonstrate that cross-*hub* orchestration beats Claude's cross-*vendor-within-one-harness* teams. The vendor already fielded the two-vendor team baton was going to be famous for.

**Severity: fatal.** The founding economic object (flat-rate three-vendor fleet) does not exist as described; the real object is two-harness + a throttled model swap, which native agent teams already partially deliver.

---

### SERIOUS-1 — Obviation is present-tense, not a 12-month risk. Every plane baton claims already has a shipping or in-dev vendor-native equivalent — including baton's two headline "killer" demos.

**Claim attacked.** Doc 10 §0 frames baton as the mediator of three topologies HCI *"doesn't have names for."* Doc 09 §F elevates two demos as proof baton *earns its existence*: F2 — *"orchestrator dies/restarts mid-fleet and resumes command with pending approvals intact … the smallest demo that proves the hub earns its existence"*; F3 — cross-review, *"the use case with an existence proof."*

**Why it fails.** Map baton's planes onto what the dossiers show already exists in the *installed binaries*:

| Baton plane / demo | Vendor-native equivalent, already shipping (dossier evidence) |
|---|---|
| Control plane: supervisor, durable state outliving the orchestrator (doc 06 Q3) | Claude `--bg` dispatches to a **per-user supervisor daemon** with `~/.claude/daemon/roster.json`, `jobs/<id>/state.json`, subcommands `attach/logs/stop/respawn/rm/daemon` (`claude-harness.md` §3). Codex ships a **managed daemon** (`codex app-server daemon start\|bootstrap`) persisting `settings.json`/`daemon.lock` (`codex-app-server.md` §2). |
| **F2 killer demo**: orchestrator-death → reattach with pending approvals intact | Claude SDK **`reinitialize()`** — the dossier annotates it verbatim: *"This is the daemon-reattach primitive baton doc 02 said Claude lacked,"* and it *"redelivers `pending_permission_requests`"* (`claude-agent-sdk.md` §3). Codex `thread/resume` *"rejoins that thread"* (`codex-app-server.md` §4). **Baton's proof-of-existence demo is a one-call native primitive on both harnesses.** |
| Knowledge plane: hub/ledger/mailbox/task-DAG (doc 08, doc 10 T3) | Claude **agent teams**: shared task store with `blocks`/`blockedBy` dependency DAG, **PID-lockfile file-claiming**, per-agent **mailbox**, `TaskCreated/TaskCompleted/TeammateIdle` hooks (`claude-harness.md` §2). This *is* the hub/ledger/mailbox shape doc 01 §6 admits is *"convergent evidence for the hub/ledger/mailbox shape."* |
| Telemetry: *"normalized cross-vendor event schema"* (doc 00 D4) | Claude **native OTel**: `claude_code.*` metrics/logs/traces with `query_source (main\|subagent\|auxiliary)`, `agent.name`, cost, tokens, `tool_decision`, per-hook spans (`claude-harness.md` §4). The normalized schema baton wants to invent is exported by one vendor today. |
| **F3 killer app**: cross-review / adversarial review | OpenAI's **own Claude Code plugin** ships a `Stop`-hook **review gate** running Codex over every Claude turn (`claude-harness.md` §6, live `hooks.json`). Codex ships **`approvalsReviewer: "auto_review"\|"guardian_subagent"`** routing approvals to a risk-assessing subagent (`codex-app-server.md` §4). Baton's headline use case is a production feature of a competitor's plugin. |
| Capability plane: Skill Forge portable skills (doc 11 module 5) | **`SKILL.md` is already a cross-vendor open standard** *"adopted across Codex CLI, Gemini CLI, Copilot, Cursor, ~40 clients"* (doc 12 §3, baton's own citation). Baton doesn't own skill portability; it rents it. |
| Capability plane: best-of-N ensemble (doc 12 §3) | **`codex cloud exec --attempts <N>`** is native best-of-N (`codex-runtime.md` §7). |
| Foreman posture: hub on a big box, SSH northbound (doc 06 Q10) | **`codex app-server daemon bootstrap --remote-control … targets SSH-driven fleets"**; `ssh host codex app-server proxy` gives a clean NDJSON pipe (`codex-app-server.md` §2, §11). OpenAI shipped baton's deployment topology. |

**Concrete scenario.** Baton spends F4's honestly-re-estimated *"few weeks to a tested skeleton for one adapter"* (doc 09 F4) building the supervisor + reattach + cross-review M1. During that window, both vendors ship one more turn of what they're already shipping: Codex `multi_agent` is *stable/on today* with `multi_agent_v2` and `enable_fanout` *under development* (`codex-runtime.md` §8); Claude agent teams graduate from experimental. Baton ships its "orchestrator can die and resume" demo the same quarter Anthropic documents `reinitialize()` in a blog post. The demo that was supposed to prove baton earns its existence proves the SDK does.

**Severity: serious.** Both of baton's existence-justifying demos (F2, F3) already exist vendor-native; the obviation clock reads ~0 months, not 12.

---

### SERIOUS-2 — The adapter is a permanent, moat-less maintenance tax on two experimental control planes the vendors owe baton nothing about.

**Claim attacked.** Doc 12 §2: *"baton declares each capability op … once, in a harness-neutral form … and projects the concrete syntax per harness. Semantics are invariant; presentation is a projection."* The premise is that a stable neutral core sits above churning adapters.

**Why it fails.** The dossiers are a signed confession that the southbound surfaces churn faster than any stable projection can track, and that the churn is *semantic*, not cosmetic:
- Codex app-server: *"Whole surface is experimental … subject to breaking changes. Pin the codex version and regenerate schemas per release"*; **runtime method list (121) ≠ exported schema (88)**; **v1→v2 already happened** — *"the old v1 conversation API is gone from the 0.144.0 runtime"* (`codex-app-server.md` §10, Limitations). `codex features list` shows `steer` as *"removed"*, i.e. a verb baton's card would advertise can graduate/vanish between releases.
- Claude: *"the stream-json protocol has no machine-readable contract"*; transcript JSONL *"is internal to Claude Code and changes between versions"*; and **semantics flip between *minor* versions** — `claude-agent-sdk.md` Limitation 2: SDK 0.2.44→0.3.x flipped `settingSources` (omitted = *none* → *all*) and `env` (merged → *replaced*). A silent semantic inversion in a point release will corrupt a GLM worker's environment (lose `PATH`/`HOME`) with no error.

Doc 06 Q8's own rule — *"conformance tests per adapter run against the installed CLI version in CI … treat every vendor release as a potentially breaking dependency"* — is the tax written down. Baton must chase **two** experimental planes forever, each breaking per release, to stay at *parity* with a single-vendor orchestration the vendor gets right for free (first-party, same-repo, atomic with the change). There is no moat: baton's entire value is being current with surfaces *designed to change*, owned by companies with a commercial interest in *not* stabilizing them for a cross-vendor arbitrageur.

**Concrete scenario.** codex 0.145.0 renames a v2 update variant (doc 01 already flags *"ACP's v2 schema is unstable — renamed variants like `tool_call_content_chunk`, `plan_update`"*). Baton's `steer:native` card claim silently degrades; the id-less `-32600` error on the vanished method (`codex-app-server.md` §9) *"break[s] request correlation,"* a `fleet_steer` hangs, the hub-side watchdog fires a false interrupt. The user's fleet corrupts a worktree. Root cause: a point release of a dependency that told baton, in its own `--help`, that it was experimental.

**Severity: serious.** Permanent N× upkeep with zero durable advantage; the maintenance curve is the product.

---

### SERIOUS-3 — Strategic self-contradiction: Q5 says "stay a thin compatibility layer, don't build protocol #15," while docs 10–12 build a maximal competing platform on the vendors' own turf.

**Claim attacked.** Doc 06 Q5: *"Don't build protocol #15 … Resist (xkcd 927) … keep the hub's internal schema private until it's earned generalization … Stay a compatibility layer."*

**Why it fails.** The rest of the corpus does the opposite at maximal scale. Doc 11 ships **seven capability modules** — `atlas` (a fleet code-search engine), `Vantage` (a DAP debug service), the **Validation Ladder** (seven rungs up to Lean/Rocq machine-checked proof), `Scratch` (a Linda tuple-space coordination REPL), the **Skill Forge**, `Cartographer`/`Quartermaster` (repo-map + supply-chain oracle), `Cairn` (a bi-temporal causal knowledge graph). Doc 12 adds a provenance-typed context composition layer and an emergence engine. This is not a compatibility layer; it is a platform that **competes with the vendors' native capability surfaces** — Codex has native search, skills, guardian review, sandboxing; Claude has native search, skills, checkpoints, subagents — and it competes at the **N× maintenance disadvantage of SERIOUS-2**, on capabilities the vendors ship first-party and improve every release.

The contradiction is structural: a *thin* layer's whole defense against obviation is that it's cheap to rebuild when a vendor moves (Q5's logic). A *seven-module capability platform* forfeits that defense — it's expensive, it duplicates vendor-native tools, and every vendor capability release makes one of its modules redundant. Doc 11's own "MVP" — *"atlas lexical+structural search + Validation Ladder's bottom two rungs + Cartographer's repo_map + Cairn's run-scorecard"* — is four subsystems duplicating things `ripgrep`, `pytest`, tree-sitter, and a CSV already do inside each harness, wrapped in a hub. That is protocol #15's fatter cousin: platform #15.

**Concrete scenario.** Baton ships `atlas`. Two months later Anthropic ships fleet-shared code indexing for agent teams (the `WorktreeCreate` hook and `~/.claude/worktrees/` isolation in `claude-harness.md` §3.2 are the substrate; a shared index is the obvious next step). `atlas`'s "defining multi-agent constraint nobody else solves — N worktrees diverge" (doc 11 module 1) is now solved by the vendor for the Claude case, and baton still owns it only for the cross-vendor case that FATAL-1 showed is contraband. The module's entire justification was the cross-vendor gap; the gap is the forbidden zone.

**Severity: serious.** The product cannot be both the humble adapter Q5 prescribes and the ambitious paradigm docs 10–12 build; the ambition destroys the adapter's only obviation defense.

---

### ANNOYING-1 — The "beyond HCI / three topologies / stigmergy" framing is retrofitted vocabulary over existing prior art, and the doc walks back its own boldest claim one paragraph later.

**Claim attacked.** Doc 10 §0: baton is built from *"three interaction topologies that HCI doesn't have names for."* §3 title: *"'Beyond modular architectures' — the unit of decomposition changes."*

**Why it fails.** The topologies are renamings of named, shipping prior art — by the doc's own admission:
- *"Agent-Computer Interaction (ACI)"* — doc 10 T1 concedes *"This is a real, named idea — the 'Agent-Computer Interface' from the SWE-agent line of work."* It's the field's term, not baton's paradigm.
- *"Stigmergy"* — doc 10 T3 concedes *"claude-squad's whole model is stigmergic; git is a coordination medium."* Git-as-coordination and a shared task board are what claude-squad and Claude agent teams already do (`claude-harness.md` §2). The word is new; the mechanism is the status quo.
- *"Beyond modular architectures"* — §3.2 immediately retracts it: *"baton's OWN architecture stays ruthlessly modular."* The profound thesis reduces to "workers are briefed by task not module (ordinary task decomposition, which agent teams' `blocks`/`blockedBy` DAG already does) and the hub is modular (ordinary good engineering)." Nothing is *beyond* anything.

The tell is doc 10 open-Q2: *"is that a fourth topology (agent-time-agent)? Probably just T3 across time."* A framework that generates candidate topologies to name is doing taxonomy, not design. The vocabulary adds a citation surface and a pitch deck; it does not change a single adapter call.

**Severity: annoying** (it's branding, not a load-bearing defect) — but it inflates reviewer confidence in a thesis whose engineering (SERIOUS-1/2) is undifferentiated, so it's worth puncturing.

---

### ANNOYING-2 — "Emergence" is defined down to "a uniform result envelope lets primitives compose" (an API contract), and the honest hedges concede the bitter lesson eats the ambitious parts.

**Claim attacked.** Doc 12 §4: *"Emergence in baton is compositional, not mystical, and it comes from exactly one mechanism: because every capability … returns the same token-bounded ACI envelope … any primitive composes with any other … there is no magic step."*

**Why it fails.** Stripped of the word "emergence," the mechanism is: *tools share an output schema and pass handles, so you can pipe them.* That is Unix pipes / a well-typed API — doc 11 §"How they compose" even calls it *"ACI's Unix pipes."* Naming a stable interface "the emergence engine" is inflation. Worse, the section's own two disciplines concede the ambitious half is doomed:
- *"Scaffold WHAT and VERIFICATION, never HOW … the how parts, yes, deliberately [get obsoleted by better models]."* So by baton's own bitter-lesson reasoning, the parts a stronger base model routes around are conceded away — and the WHAT/VERIFY parts that survive are exactly the ones the vendors are shipping natively (guardian `auto_review`, hub-run tests via `codex cloud`, best-of-N `--attempts`; SERIOUS-1).
- *"Measure emergence as a net win or it's just complexity … a skill a stronger base model makes redundant is evicted."* Doc 11 risk 5 and doc 11 module 7: *"most fleets should stop at the scorecard."* These are admissions that the elaborate emergence/BoK machinery is over-built for realistic demand and will mostly be deleted.

So the emergence thesis survives only as "compose well-typed tools and measure whether it helped" — sound engineering, but the opposite of the generative-emergence intent doc 00 gestured at, and nothing a for-loop plus a results table couldn't do.

**Severity: annoying** — no incorrect mechanism, but the grand framing oversells an API contract, and the load-bearing hedges quietly surrender the ambitious claims to the bitter lesson.

---

### ANNOYING-3 — The O(N)-vs-O(N²) stigmergy scaling claim is a hand-wave; the coordination cost reappears as contention + fencing on the hot shared medium, and the ant analogy breaks exactly where agent goals conflict.

**Claim attacked.** Doc 10 §T3: *"direct AAI is O(N²) chatter that poisons context and doesn't scale; stigmergic AIAI is O(N) reads/writes against shared structure … degrades gracefully."* Design law 3: *"Prefer stigmergy to messaging."*

**Why it fails.** Stigmergy doesn't delete coordination cost; it relocates it into contention on the shared structure — and the corpus shows exactly where:
- The shared code index *"can approach re-index cost"* under divergence (doc 11 module 1 / risk 2 — *"the 'when does a worker's overlay trigger a private re-index' threshold is unproven"*). N diverging worktrees is not O(N) cheap reads; it's N overlays that can each force an O(index) rebuild.
- `Scratch` needs *"CAS cells, take-once leases"* and the Board is *"a materialized view over the ledger"* rebuilt on crash (doc 11 module 4). That's a concurrency-control protocol, i.e. coordination cost, not its absence.
- The entire supervisor spec — I1 fencing tokens, turn-scoped epochs, I2 single-consumer CAS, worktree leases (doc 09 §A/§B) — **is** the coordination cost stigmergy claimed to avoid. Two workers reaching for `payments/` don't message each other; they contend on a lease, and the lease needs fencing to be safe. You replaced N² messages with N² *contended reads/writes plus a fencing protocol*.

The ant analogy fails precisely because ants have *homogeneous, non-conflicting* goals in a *forgiving* environment; pheromone staleness is harmless. Code agents have *heterogeneous, conflicting* goals (overlapping scope, a stale index cell, an uncommitted lease) where the "pheromone" is exactly the race surface. Doc 10's own open-Q1 wobbles on this — *"the blackboard IS worker↔worker coordination through infrastructure — is that blessed?"* — meaning the design hasn't decided whether its central bet is even distinct from the messaging it bans.

**Severity: annoying** — stigmergy-via-git/ledger is a fine *implementation*, and "don't poison the orchestrator's context with chatter" (doc 05) is a real, correct concern. But the O(N)/graceful-degradation *scaling argument* used to elevate it to "the bet" is unearned: the cost moved, it didn't vanish, and the fencing apparatus is the receipt.

---

### Bottom line

The paradigm is intellectually rich and mostly *correct as description* — which is the problem. Docs 10–12 describe, in elevated vocabulary (ACI, stigmergy, emergence, three topologies), a set of mechanisms the vendors are already shipping single-vendor (agent teams = hub/ledger/mailbox/task-DAG; `--bg` daemon + `reinitialize`/rejoin = supervisor + baton's own F2 "existence proof"; native OTel = the normalized schema; guardian `auto_review` + OpenAI's CC stop-gate = baton's F3 "killer app"; `SKILL.md` standard, `codex cloud --attempts`, `daemon bootstrap --remote-control`). Baton's sole differentiator is doing this *across* vendors — and that is the exact axis every vendor's ToS is moving to forbid (FATAL-1), inflated in headcount to begin with (FATAL-2), obviated in the present tense on the parts that are legal (SERIOUS-1), maintainable only as a permanent moat-less tax (SERIOUS-2), and strategically self-contradictory between "thin compatibility layer" and "seven-module platform" (SERIOUS-3). The honest product left after the attack is doc 06 Q1's own reluctant residue: *coarse parallel delegation + cross-review* — which is `codex exec` and `claude --bg` in a for-loop with a results table, not a three-plane paradigm. The corpus's most defensible sentence about its own future is already in it (Q1): *"Deep interleaved collaboration is where cross-vendor orchestration goes to die; don't design for it."* Docs 10–12 design for it anyway.

## BLUE
I have read the full corpus the attack cites. Here is the blue-team response.

## Blue-team: paradigm-vendor-obviation

Verdict summary: no finding is fatal *as written* — the two "FATAL" findings each rest on a conflation (FATAL-1) or a factual error (FATAL-2) that the corpus already forecloses. But SERIOUS-1 and SERIOUS-2 together land a real, non-fatal structural truth the design must own, and I concede it below rather than hand-wave it.

---

### FATAL-1 — cross-vendor is both un-buildable-by-vendors and ToS-forbidden → squeezed to zero

**Verdict: DEFEND (overreach) + concede-and-fix (narrow the value claim). Not fatal.**

The attack's engine is a single collapse: it equates "cross-vendor value" with "subscription arbitrage," then kills arbitrage on ToS and declares the whole differentiator contraband. But doc 00 §"Why full-harness matters" lists **four** independent reasons full-harness beats an API call, and arbitrage is only #2. The other three survive any auth posture: **#1 "The harness IS the product … A GPT-5.x called via raw API inside a Claude-shaped harness underperforms GPT-5.x inside Codex"**; #3 session continuity ("re-prompted in its existing session next week"); #4 vendor-native safety/sandbox. These are properties of *running the vendor's CLI*, not of *how you paid for the token*.

That directly defeats the attack's own escape scenario ("set all three to API keys → you're paying per token to run three CLIs through a fragile hub instead of calling three APIs through LangGraph"). LangGraph-on-three-APIs gets you three raw models **in one harness shape** — precisely the underperformance doc 00 #1 names. And doc 00's non-goal ("frameworks … orchestrate *API calls*, not harnesses") fires on LangGraph, **not** on baton-on-API-keys: baton's unit of delegation is still a full CLI harness session (vendor system prompt, sandbox, compaction, `thread/resume`), not a completion. The non-goal does not fire on baton.

The ToS claim is also mis-scoped. What the vendors are metering is **programmatic *subscription* use** (doc 01 §7: Anthropic's cancelled-but-reworking split; OpenAI's "trusted runners"; Z.ai's supported-tool lock) — an *auth/billing* axis, not a *cross-vendor* axis. Cross-vendor orchestration on **API-key billing is first-party-sanctioned today**: OpenAI's own plugin runs Codex under a Claude orchestrator (doc 01 §6 — "Claude→Codex has a blessing"), and Anthropic's Agent SDK is *built* for metered programmatic use. So "the survivable niche is the contraband one" is false: the API-key niche is both survivable and sanctioned.

**Concede-and-fix:** the attack is right that the *magnitude* of the surviving differentiator is far smaller than the "flat-rate free fleet" pitch. The honest value under API billing is (a) harness-shaped execution quality, (b) error-decorrelated cross-review, (c) a supervisor that outlives the orchestrator — not "free marginal task." The corpus already prices this: doc 06 Q1 ("the elaborate steering machinery must justify itself against `codex exec` in a for-loop — the *telemetry, approvals, and session durability* are the actual product"); doc 09 F5 makes API-key the **default** posture; doc 07 M0 experiment 4 makes "hub beats a for-loop on ~5 tasks" a literal falsification gate, and M1 sets the pivot: **"fleet ≤ solo pass-rate and >1.5× wall-clock → halt and rethink."** Baton has instrumented the exact experiment that would prove this finding correct and gated its own existence on the outcome.

**Residual:** genuine. If the eval shows harness-shaped-quality + cross-review + durable supervisor does *not* clear the for-loop bar by enough to justify the maintenance tax (SERIOUS-2), baton should halt — and its own roadmap says so. The value is defensible but modest; the paradigm framing oversells it.

---

### FATAL-2 — "three-vendor fleet" is two harnesses + a model swap; GLM is one worker with a queue

**Verdict: DEFEND. Contains a factual error; the rest is baton's own accepted finding cited back as if it were a refutation. Not fatal.**

Both "revelations" are things baton already ruled VALID and is acting on. Doc 09 **D1** (accepted): "'Harness' conflates surface × model × seat. glm-adapter is really claude-*surface* + glm-*model*" → the fix already commits to factoring **SurfaceAdapter / ModelProfile / Seat** into `BatonEvent` before M1 freezes it. Doc 06 Q7 already says verbatim "A GLM 'fleet' on a Lite/Pro plan is one worker with a queue," and doc 07 M2 already makes "scheduler respects plan concurrency ceilings (Pro ≈ 1 in-flight) **as a hard input**." Citing baton's own accepted findings is not a new attack.

The ensemble thesis does **not** collapse, because error-decorrelation is a property of the **model family, not the surface**. Doc 12 §3's ensemble is "best-of-N across Codex/Claude/GLM" — **three distinct model families** (GPT, Claude, GLM) that "fail differently" (doc 06 Q1.1). Two surfaces carrying three models is still a genuine best-of-**3-models** ensemble; the attack's "best-of-2" miscounts surfaces for models.

The load-bearing error: **"the vendor already fielded the two-vendor team baton was going to be famous for."** It didn't. The cited teammate (`claude-harness.md` §2.1) is `{"agentType":"codex:codex-rescue", "model":"sonnet", "backendType":"in-process"}` — a **Claude sonnet subagent in-process**, wearing a codex-flavored *plugin* subagent definition. It is not a Codex CLI session. Agent teams' documented hard limit (doc 01 §6, from Anthropic's own docs) is **"no cross-vendor teammates."** The one thing the attack says the vendor already shipped is the exact thing the vendor explicitly forbids in-product. Far from obviating baton, that boundary *is* baton's reason to exist (doc 01 §6: "its single-vendor boundary is exactly baton's reason to exist").

**Residual:** real and already flagged as doc 12 open-Q5 — GLM's *marginal* decorrelation value at concurrency-1 is unproven. If measurement shows a serialized GLM arm adds no decorrelation, the ensemble is effectively Claude+GPT (best-of-2 models), still valid but thinner than the "three" headline. That's an eval question baton owes, not a fatal defect.

---

### SERIOUS-1 — obviation is present-tense; every plane, including F2 and F3, has a shipping vendor-native equivalent

**Verdict: DEFEND the "obviated" framing as a category error, but CONCEDE three real hits. This is the finding that lands hardest and I will not pretend otherwise.**

The table's structural flaw: **every row cites a *single-vendor* primitive against a *cross-vendor composition* claim.** Baton's stated thesis is not "invent primitives vendors lack." Doc 06 Q5: "the *primitives already exist* per-harness and are good; what's missing is **normalization** (event schema), **policy**, **durability** (ledger), and a **northbound agents can call**. All of that is a program, not a protocol." Doc 11 "the shape they share": "take a capability … from harness-native tools, and make it (a) fleet-shared, (b) agent-shaped, (c) orchestration-aware, (d) re-runnable by the hub." Doc 12 §3: "Unification lives at the abstraction + observability layer, **never at the capability layer**." Baton *cites the existence of these primitives as validation and as ingredients*, not as threats. Row by row:

- **Supervisor**: Claude `--bg` and the Codex daemon each supervise *their own* vendor's workers. Neither provides cross-vendor **fencing** (supervisor I1) — a human-takeover of a Codex worker fenced against a stale Claude-orchestrator op. Also the Claude dossier itself: "daemon *service* install is **disabled** in this version — runs on demand and exits when the last client disconnects," and `roster.json`/`jobs/` schemas "absent on this machine." The native supervisor is single-vendor *and* partly aspirational even single-vendor.
- **Knowledge plane**: agent teams = hub/ledger/mailbox/task-DAG — and doc 01 §6 says exactly that, then finishes the sentence the attack truncates: "**and its single-vendor boundary is exactly baton's reason to exist.**" Roadmap open-Q7 even proposes baton *compose* with it ("could baton workers appear as 'teammates' to a Claude orchestrator, reusing its mailbox/task ledger rather than competing").
- **Telemetry**: Claude OTel is *Claude's schema for Claude*. Codex emits a different vocabulary (`thread/tokenUsage/updated`, `codex exec --json`). `BatonEvent` is the *mapping from* Claude-OTel + Codex-NDJSON + ACP-updates into one stream — one vendor exporting its own OTel is one input, not the normalization.
- **best-of-N**: `codex cloud exec --attempts N` is N samples of **Codex on one task** — single-family sampling, not cross-family decorrelation.
- **Foreman**: `codex app-server daemon bootstrap --remote-control` remotes a **Codex** fleet; roadmap M3 explicitly *consumes* it ("unix control socket + `codex app-server proxy` + `codex remote-control` pairing") as one adapter's remoting.
- **Skills**: baton never claimed to own portability — doc 12 §3 *cites* the `SKILL.md` standard as the mechanism ("ships portable artifacts, not vendor-locked ones"); the novel part is the **hub-verified reflexive forge** (Voyager re-grounded on I7), not the file format.

**Concede (three genuine hits):**
1. **F2's worker-reattach half is now native and baton under-credited it.** `claude-agent-sdk.md` §3 is explicit: `reinitialize()` "is the daemon-reattach primitive baton doc 02 **said Claude lacked**," and `thread/resume` rejoins. Baton's doc 02 was wrong. The demo's differentiating core shrinks from "reattach at all" to only "**orchestrator**-death + **cross-vendor** fleet rehydration with a single fence epoch and multi-vendor pending approvals intact" — which the native single-vendor primitives are the *ingredients* for, not a substitute for, but the novelty is narrower than the roadmap implies. **Fix:** rewrite doc 02/F2 to credit `reinitialize()`/`thread/resume` as the southbound reattach primitives and reframe F2's claim precisely as *cross-vendor orchestrator-death recovery*, not "reattach that a for-loop can't do."
2. **F3's pattern is already occupied, one-directionally, by a competitor.** OpenAI's stop-gate (Codex reviews Claude) and Codex `auto_review` exist. Baton's `fleet_review` generalizes to *symmetric vendor choice + hub re-verification (I7) + not-locked-to-reviewing-Claude* — a feature, not a paradigm. The corpus already treats the plugin as an *existence proof it cites*, not a surprise; but F3's marginal value over "install the plugin" is incremental and must be shown in the eval, not asserted as a "killer app."
3. **The obviation clock is real and fast, and the moat is a single reversible vendor decision.** `codex-runtime.md` §8: `multi_agent` is stable/on today, `multi_agent_v2`/`enable_fanout` under development; agent teams are graduating. Baton's entire moat is the "**no cross-vendor teammates**" boundary. That is a *product decision Anthropic can reverse*, not a technical barrier. If they ship cross-vendor teammates, baton's core evaporates for the Claude case.

**Residual:** baton's existence is a bet that vendors keep *declining* to cross the vendor boundary. That bet is honest but fragile, and no mechanism in the corpus can make it durable — it is a strategy risk to be watched on a calendar (doc 06 Q7's "re-check on a calendar"), not engineered away.

---

### SERIOUS-2 — permanent, moat-less maintenance tax over two experimental control planes

**Verdict: CONCEDE (largely) — but the corpus already prices this exact cost, and "moat-less" is the normal condition of a compatibility layer, not a defect unique to baton.**

The tax is not hidden; it is baton's own stated cost. Doc 06 Q8: "conformance tests per adapter run against the *installed* CLI version in CI … treat every vendor release as a potentially breaking dependency." Doc 07 M0 guiding re-estimate: "Cross-vendor conformance is a **months-long, permanently-recurring cost**: every vendor CLI release is a potential break." Doc 09 F4: "Model the 6-month and 2-year maintenance trajectory." The attack's "the maintenance curve is the product" is a restatement of baton's own accepted F4.

"Moat-less" is true and unremarkable: it describes *every* compatibility layer (Terraform across clouds, LSP clients, ffmpeg). The value of that category is the cross-vendor abstraction plus the maintenance labor nobody else wants — and doc 06 Q5 explicitly chooses that identity ("Stay a compatibility layer"). Baton does not claim a tech moat; claiming it lacks one is not a refutation.

**The mitigation is specified and materially shrinks the tax:** ride the *narrowest, most-stable subset* of each surface, not the raw experimental one. Roadmap M1: "benchmark the official **Codex SDK** and **two-tool `codex mcp-server`** … a lower-ToS-risk path" — the 2-tool stable MCP surface instead of the raw 121-method app-server; the Claude *SDK* over hand-rolled stream-json. Doc 09 G: "offline version-specific codegen … pin CLI versions + hash schemas + maintain tested compatibility ranges." Feature-detect via `system/init.capabilities`, never version-sniff.

**The honest residual I concede fully:** baton's foundation is materially *worse* than Terraform's. Terraform sits on stable, documented, compatibility-committed cloud APIs. Baton sits on surfaces the vendors label "**whole surface experimental, subject to breaking changes**" (`codex-app-server.md` §10) and "**no machine-readable contract**" (`claude-agent-sdk.md` Limitation 8) — and worse, the semantic-flip hazard is real: `settingSources` omitted flipped *none→all* and `env` flipped *merged→replaced* between **minor** SDK versions (`claude-agent-sdk.md` Limitation 2). Conformance CI catches only fields it tests; a semantic inversion in an untested field ships silently and can strip a GLM worker's `PATH`/`HOME`. **Fix:** promote the semantic-flip class to a first-class adapter risk — golden-transcript conformance tests that assert *effective behavior* (env contents, setting-source resolution) not just schema shape, plus a hard version-pin gate that refuses to run an adapter against an unqualified CLI build. Even so, the residual cannot be zeroed; this is baton's single largest ongoing liability and the roadmap is right to model the 2-year curve rather than promise stability.

---

### SERIOUS-3 — self-contradiction: Q5 "thin compatibility layer" vs docs 10–12's seven-module platform

**Verdict: DEFEND (misread of Q5's scope) + concede-and-fix (defer the capability plane harder).**

Q5's "thin" is specifically about the **wire protocol**: "Don't build protocol #15 … keep the hub's internal schema private … Stay a compatibility layer" — i.e. do not spec and evangelize "BatonProtocol v1" against ACP/app-server. That discipline **is** held: doc 07 "deliberately cut" lists "A public 'BatonProtocol' spec (doc 06 Q5 — stay a compatibility layer)." The contradiction the attack alleges requires reading Q5 as a cap on *capability ambition*; it is a cap on *protocol proliferation*.

The capability plane is a **demand-gated design catalog, not a build commitment.** Doc 11's own MVP is explicit: "**Not seven modules — one thin vertical**" (atlas lexical+structural + two validation rungs + repo_map + run-scorecard), and "The framework is the deliverable; the modules are earned by demand." Doc 12 §4 discipline 2 makes it self-pruning: "a skill a stronger base model makes redundant is **evicted**"; doc 11 risk 5: "most fleets should stop at the scorecard." The "seven-module platform #15" is the ambition space; the committed object is four subsystems that delete themselves if they don't measure a net win.

**Concede-and-fix:** the attack's deeper point survives — even the 4-subsystem MVP's value is **cross-vendor-contingent**. For a single-vendor fleet, Claude's native search + agent-teams task store already have the "fleet-shared, agent-shaped, orchestration-aware" properties atlas claims; atlas's "defining constraint nobody else solves — N worktrees diverge" is solved *for the Claude case* the moment Anthropic ships fleet-shared indexing (the substrate — `WorktreeCreate` hook, `~/.claude/worktrees/` — already exists). So the capability plane inherits SERIOUS-1's single-reversible-moat fragility. **Fix:** defer the capability plane *harder* than doc 11 currently does. The truly honest MVP is the **control plane alone** — supervisor (I1 fencing, I3/I4 cursors, I6 two-phase stop, I7 hub-run verify) + `fleet_review` + orchestrator-death recovery + eval — with **zero** capability modules until the cross-vendor control plane itself clears the for-loop bar (M0.4 / M1 pivot). atlas/Vantage/the ladder should not be built before that gate passes. This aligns the capability plane with the roadmap's own "earned by measured demand" discipline instead of front-loading it.

**Residual:** if the control-plane-only MVP fails the for-loop gate, the capability plane never earns its start — which is the correct outcome, but it means docs 10–12 are, today, a design catalog whose payoff is entirely downstream of an experiment not yet run.

---

### ANNOYING-1 — "beyond HCI / three topologies / stigmergy" is retrofitted vocabulary; the doc walks back its boldest claim

**Verdict: DEFEND.** The corpus concedes every prior-art attribution the attack "exposes," in the same breath it introduces the term: doc 10 T1 "This is a real, named idea — the *Agent-Computer Interface* from the SWE-agent line"; T3 "claude-squad's whole model is stigmergic; git is a coordination medium." Using an established name (ACI is SWE-agent's; stigmergy is the swarm-biology term) to *organize* a design is expository framing, not a novelty claim — baton never claims to have invented ACI or stigmergy.

The "walks back beyond-modularity one paragraph later" jab walks straight into doc 10 §3.2's pre-emption: "a critique that 'you said beyond modularity but your hub is modular' **conflates the coordinated work with the coordinating system**." §3.2 does not retract; it distinguishes the *fleet's work* (post-modular, organized by task+substrate) from *baton's architecture* (modular, for vendor-churn survival).

And the vocabulary is **load-bearing, not decorative** — it generates design laws that change the product: "Two channels, never fused" ⇒ **there is no `fleet_chat` verb**; "interruption flows down only" ⇒ fence order = preemption hierarchy (I1); "prefer stigmergy to messaging" ⇒ worker↔worker chat is banned (doc 06 Q6). The absence of a `fleet_chat` verb is a direct, checkable consequence. **Residual (grant):** "paradigm reframe" over-elevates what is, mechanically, disciplined interaction design; the pitch-deck register is a real overreach even if the mechanisms underneath are sound.

---

### ANNOYING-2 — "emergence" defined down to an API contract; the hedges concede the bitter lesson eats the ambition

**Verdict: DEFEND the mechanism, concede the framing oversells.** The attack agrees with the corpus while styling agreement as attack. Doc 12 §4's *section title* is "the honest version," and its thesis is "Emergence in baton is compositional, **not mystical** … **there is no magic step**." Doc 11 §"How they compose" literally calls it "**ACI's Unix pipes**." Baton is not hiding that emergence = uniform-envelope + handle-passing composition; that is the stated, deliberately deflationary claim ("behavior the designers didn't explicitly program," e.g. `find→orient→debug→prove→remember`).

The bitter-lesson hedge is a *strength honestly stated*, not a surrender: §4 discipline 1 — "Scaffold WHAT and VERIFICATION, never HOW … the *how* parts, yes, deliberately [get obsoleted]; the *what/verify* parts … compound." The attack's "the survivors are exactly what vendors ship natively" is SERIOUS-1's cross-vendor point recycled — baton's verify is **hub-run and cross-vendor** (I7 re-checks a Codex claim independently of Codex), the vendors' is intra-vendor. **Residual (grant):** the generative-emergence intent doc 00 gestured at *is* surrendered to the bitter lesson; what remains is "compose typed tools and evict what doesn't measure a win." That is sound engineering, not a breakthrough — and the corpus should retire the label "emergence engine" in favor of "typed composition + measured eviction," which is what the mechanism actually is.

---

### ANNOYING-3 — the O(N) vs O(N²) stigmergy scaling claim is a hand-wave; cost reappears as contention+fencing; the ant analogy breaks where goals conflict

**Verdict: CONCEDE the asymptotic framing, DEFEND the load-bearing argument.** The attack is right that stigmergy relocates coordination cost into contention rather than deleting it, and the corpus itself documents those costs (doc 11 risk 2: overlay "can approach re-index cost"; Scratch's "CAS cells, take-once leases"; the whole I1 fencing apparatus). The clean "O(N) reads/writes … degrades gracefully" notation oversimplifies and should be dropped.

But the notation is not the argument. The two load-bearing claims survive contention untouched, and the attack **grants the first**: (1) **context-preservation** — N² messages *all land in scarce orchestrator context* (doc 05; doc 09 D4: "untrusted input compressed by the cheapest model"); N reads/writes against git/ledger land in *durable storage*, consuming zero attention budget. The attack concedes "'don't poison the orchestrator's context with chatter' is a real, correct concern." (2) **Durability/auditability** — design law 5, "the medium is the record"; coordination is auto-replayable.

And the attack's own rebuttal miscounts the contention it introduces: "N² contended reads/writes plus a fencing protocol." Two workers reaching for `payments/` contend on **one lease** (I1 fencing) — that is O(number of contended resources), *not* O(N²). Fencing *bounds* contention; it does not reintroduce N² cross-chatter.

**Concede the analogy:** ants have homogeneous, non-conflicting goals in a forgiving medium; code agents have conflicting goals where a stale cell is a race surface — the analogy is illustrative rhetoric, not load-bearing, and the corpus actually handles conflict with the take-once-lease+fence discipline *precisely because* staleness is not harmless there. Doc 10 open-Q1 ("is the blackboard blessed stigmergy or banned messaging?") is genuinely unresolved; the "medium has structure, a message doesn't" distinction is real but not airtight. **Fix:** restate the bet as "stigmergy trades N² *context-poisoning* messages for *bounded* contention on durable, auditable shared structure" — keep the context + durability arguments, drop the unqualified O(N)/graceful-degradation claim.

---

### On the attack's bottom line

One correction to the closing sentence: **"Docs 10–12 design for [deep interleaved collaboration] anyway"** is false and checkable. Doc 06 Q1 warns "Deep interleaved collaboration … is where cross-vendor orchestration goes to die; don't design for it." Docs 10–12 do the *opposite* of designing for it: design law 3 bans worker↔worker messaging as "a decomposition smell," and the entire stigmergy bet (T3) is coordination *without* messaging — a substrate built specifically to *avoid* the deep-collab trap Q1 names. The attack reads stigmergy (minimize messaging, coordinate through substrate) as its inverse (rich inter-agent collaboration).

Where the attack is right, and the corpus already agrees: the honest surviving product is narrower than the three-plane paradigm — supervisor + cross-review + durable orchestrator-death recovery + independent hub re-verification, cross-vendor. That is baton's own M1. The residual disagreement is exactly whether *that* clears the `codex exec`/`claude --bg` for-loop bar by enough to justify the SERIOUS-2 tax — and baton has made that a falsification gate (M0.4, M1 pivot criteria) rather than an assertion. The strongest honest blue-team position is not "the red team is wrong," but: **every attack overreaches into "fatal" by a conflation or a factual error, the real damage (SERIOUS-1's single-reversible moat, SERIOUS-2's vendor-unstable foundation, SERIOUS-3's cross-vendor-contingent capability value) is genuine and already priced, and baton has instrumented the one experiment that would prove the residual right and pre-committed to halting if it does.**

## EXPLORE & VERDICT
## Explore & verdict: paradigm-vendor-obviation

Both the red attack and the blue defense argue *inside* one frame: "is baton — a cross-vendor **conductor** — the right thing to build?" Red says the conductor is obviated + contraband + a two-harness fiction; blue says the honest residue (supervisor + cross-review + orchestrator-death recovery + hub re-verify) is real and gated on an eval. Stepping past both: the frame itself is half-wrong. Baton is two products fused under one word ("orchestration"), and the corpus keeps discovering — without acting on it — that the two halves have *opposite* fates.

### Strongest alternative: **Baton-as-Referee, not Baton-as-Conductor**

Invert the product. Make the **verification / adjudication / decorrelation-measurement plane** the trunk and the deliverable; demote the *drive-a-fleet* control plane to a thin, optional, API-key-default, best-effort branch that rides vendor-native primitives instead of reimplementing a fragile supervisor across two experimental surfaces.

This isn't a new idea bolted on — it's baton's own crown jewels, re-sorted by which survive:

- I7 hub-run verification: doc 09 C1 — *"The hub re-runs verification independently; it never trusts worker-reported exit codes … 'worker prose is non-authoritative; only independently re-run evidence counts'."*
- The Validation Ladder: doc 11 mod 3 — *"The load-bearing insight is forgeability, not pass/fail … the hub independently re-checks."*
- Cairn's RouteStat: doc 11 mod 7 — *"hub-verified win/loss per (harness × task-class) … fed only by I7 outcomes, never worker self-report."*
- The ensemble: doc 12 §3 already names the shape — *"best-of-N across Codex/Claude/GLM with **the hub as the judge**."*

The referee is the exact quadrant the red team declared empty. Red's FATAL-1 thesis is "value and viability are anti-correlated — the buildable part gets built by vendors, the differentiating part is ToS-contraband." That holds for the **conductor** (driving subscription sessions is what every vendor is moving to meter — doc 01 §7). It **inverts** for the **referee**: independent cross-vendor adjudication is (a) something no single vendor will ever build — a vendor grading itself against a competitor is the fox guarding the henhouse; doc 01 §6 says the *"single-vendor boundary is exactly baton's reason to exist,"* and adjudication is the one thing that boundary permanently protects; (b) ToS-clean — a referee consumes artifacts (`codex exec --json`, `claude -p` output, git diffs, exit codes), it does **not** drive subscription-authed control loops; (c) bitter-lesson-proof by baton's own reasoning — doc 12 §4: *"Scaffold WHAT and VERIFICATION, never HOW … the what/verify parts … compound"* as models improve. The referee **is** the verify half. So make it the whole thing.

Alternatives I considered and rejected as weaker: **do-nothing / ride vendor convergence** — correct for the conductor (agent teams, `multi_agent`, the OpenAI plugin, `reinitialize()` are eating it), but wrong for the referee, because waiting never closes the one gap vendors are structurally disincentivized to close. **Contribute `steer`/usage to ACP upstream** (doc 06 Q5's own corollary) — a fine complementary move, but it's a control protocol, not an adjudication layer, and it's investing in someone else's commons with no product. **Ship only cross-review** — that's *one* referee application, and OpenAI already occupies it one-directionally (doc 01 §6); the referee generalizes it to symmetric, N-way, hub-re-verified, decorrelation-scored.

### Honest comparison

| | Baton-as-Conductor (current frame) | Baton-as-Referee (proposed) |
|---|---|---|
| Southbound surfaces it must chase | The **control** plane: spawn/steer/interrupt/two-phase-stop/approval across the app-server's 121 experimental methods + stream-json (SERIOUS-2's whole N× tax lives here) | The **observation** plane: `exec --json`, output streams, git, exit codes — far stabler, and what a referee reads anyway |
| Obviation clock | ~0 months — `reinitialize()`/`thread/resume` already are the F2 demo; agent teams already are the hub/ledger/mailbox | Not obviated — vendors won't build cross-vendor adjudication |
| ToS posture | The metered/contraband axis (doc 01 §7) | Artifact-consuming, subscription-neutral |
| Bitter lesson | The steering/HOW machinery is the part a stronger model routes around (doc 12 §4) | The verify/WHAT machinery compounds |
| Fragile demo it leans on | "orchestrator dies and resumes" — now a one-call native primitive on both harnesses | "independent adjudication no vendor gives you" — no native equivalent |

What the referee frame **loses**, honestly: live mid-fleet steering, human-takeover seats, and the flat-rate arbitrage of actually *driving* a big fleet cheaply. If the user's true need is "run and steer a cheap three-vendor swarm," the referee doesn't do it — but red FATAL-1/FATAL-2 already showed that need is the contraband, two-harness-plus-throttled-GLM one. The referee also concedes it does not "orchestrate" in doc 00's literal `Claude→GPT+GLM` sense — so this is a genuine *replacement of emphasis*, licensed by the user's explicit ask for "REPLACEMENTS" and "critiques beyond their list." Note the corpus is already drifting here: doc 07 M1 front-loads cross-review + I7 + eval; doc 12 §3 already calls the hub "the judge." The referee frame is what baton keeps *discovering* and then re-burying under the conductor headline.

### Verdict: **REVISE** (right frame is reachable from here; one decisive re-ordering) — with a **CUT** rider on the paradigm vocabulary

Not KEEP: leading with the conductor walks straight into every durable red-team hit (single-reversible moat, N× tax on two experimental planes, both "existence-proof" demos now native). Not CUT: the referee core is genuinely defensible and mostly already designed. Not REPLACE-wholesale: the change keeps baton's best machinery (I7, Validation Ladder, RouteStat, provenance-typed context in doc 12 §1b, `BatonEvent` normalization) — it re-sorts trunk vs branch rather than starting over.

The revision, precisely: **the referee is the product; the conductor is an optional adapter.** Consequences that fall out —
- The supervisor liveness apparatus (I1 fencing, I6 two-phase stop, the priority lane, the whole steering channel of doc 10 §1) drops from *headline* to *only-if-you-use-the-driving-branch*. A referee is stateless w.r.t. sessions; it has no orchestrator to die, so F2's fragile "orchestrator-death recovery" demo stops being the existence proof.
- **CUT the paradigm framing of docs 10–12** as load-bearing pitch — "beyond HCI," "three topologies," "stigmergy as the bet," "the emergence engine." Red ANNOYING-1/2/3 and blue both concede these are retrofitted vocabulary over shipping prior art and an API contract; they inflate reviewer confidence without changing an adapter call. Keep the two *mechanisms* that earn their keep (two-channels-never-fused → no `fleet_chat`; type-every-token-by-provenance) as engineering rules, not as a paradigm.
- The eval baton already committed to (doc 07 M1: *"fleet ≤ solo pass-rate and >1.5× wall-clock → halt"*) gets **restated for the referee**: does best-of-N *with an independent referee* beat best-of-1, and does *cross-vendor* decorrelation beat *same-vendor* best-of-N, by enough to justify N×? That's the falsification gate that matters.

### The one thing to get right

**The grader-provenance / independent-verification trust boundary.** A referee's entire value is that it beats self-report — and its entire failure mode is *green-check theater that's strictly worse than trusting the worker.* The boundary has to satisfy all three at once: re-verify (i) in a sandbox neither the worker nor its vendor controls (doc 09 C2: verification runs in a fresh throwaway sandbox, hub consumes exit+output as *data*), (ii) against a spec/grader the **human or orchestrator** pins — never a worker-supplied restatement, because doc 11 mod 3's honest soft spot is exactly this: *"a perfect proof of the wrong theorem is worthless."* Autoformalization — turning the real definition-of-done into the property actually checked — is where the trust leaks, and it is *the* unsolved risk the corpus flags for the red team. Get this boundary right and the referee is the one thing in baton that vendors won't build, ToS can't forbid, and better models make *more* valuable. Get it wrong — grade against a forgeable, worker-adjacent spec — and the referee is a rubber stamp, and the whole inverted product is hollow.
