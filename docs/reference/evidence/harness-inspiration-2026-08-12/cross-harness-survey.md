# Cross-Harness Orchestration Survey — baton capability inspiration (issue #144, research half)

**Role:** research (glm seat). **Attempt:** hk-2026-08-12T19:45:51Z. **Scope:** survey other harnesses and cross-harness orchestration projects for capabilities baton should ADOPT, ADAPT, or deliberately REJECT — with emphasis on (a) **ohmypi / oh-my-pi (omp)** and (b) the wider field (ACP, OpenHands, SWE-agent, CrewAI/AutoGen, Aider, Cline/Continue, Serena, LSP-for-agents prior art). **Laws carried from the brief:** cite a URL or file for every claim; mark unverifiable items honestly; no clocks; read-only outside this deliverable path.

This report is the research half of issue #144. The companion brief is `research-brief.md` (same directory). Everything here is verifiable against the cited URL or the cited `docs/...` file.

---

## 0. How to read the verdicts — baton's three laws as the filter

Every per-idea verdict below is graded against baton's binding campaign control law (canonical statement: `docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:134-143`), summarized in the brief as three prohibitions. A borrowing survives only if it is **EVAL-ABLE, CONSTRUCTIVE, or CONVERSATIONAL** and violates none of these:

- **No clocks as controls.** "Arbitrary turn-limits and time windows are the wrong class … any clock is a deployment-class last resort for total silence, never the primary signal." Resource circuit-breakers (token/usd/turn) bound *spend*, not *progress* (`bidirectional-v3-decisions.md:134-143`; enforced at `docs/reference/evidence/prescriptive-doctor-2026-08-12/prescriptive-doctor-contract.md:179-203,466-467`).
- **No unbounded content.** "Content gates that verify content, not counts" (`bidirectional-v3-decisions.md:137`); every numeric bound must name its cap + derivation (`docs/reference/evidence/tight-cell-2026-08-06/tight-cell-contract.md:691-693`); artifacts are byte-bounded, slices token-bounded.
- **No authority-free zones.** One authority path, identity stream-bound (never caller-named), tiers worker < orchestrator < operator/policy, surface inventory constrained by construction (`bidirectional-v3-decisions.md:145,147`; `docs/36-unified-control-grammar.md:95-97,298-299`).

**Baton in one paragraph (so the "seam" each borrowing rides is clear):** baton is a *cross-vendor fleet driver* — one orchestrator agent directs **full-harness** worker agents (Claude Code, Codex, GLM, Grok, Kimi, DeepSeek — not raw API calls), sending work, watching, and interrupting/steering mid-run, over a hub that owns dispatch, a durable event ledger, per-worker isolated git worktrees, and an **independent re-verification trust gate** (`docs/19-north-star-corrected.md:7,15,34-36`; `docs/PROGRESS.md:32-35`). Work is a **run** (unit of delegated work) or a **wave** (multi-member coordinated run) (`docs/37-wave-driver.md:11-13`). The seams a new capability rides are: the **coordinator** (dispatch/spawn/recover/interrupt/kill/trust gate), the **coordination-store** event ledger + knowledge graph, the **capability-plane/orientation** modules (atlas, cartographer), the **context-harness** layer (downward briefs, upward receipts), and the **unified control grammar** (the one registry every surface projects).

---

## 1. Honesty notes (read first — these change how the LSP section lands)

1. **The brief's "#123 verbs" is a conflated reference; baton's own ledger splits it.** The **unified control grammar is issue #43** (`docs/36-unified-control-grammar.md:7`; `docs/PROGRESS.md:277,289`). **Issue #123 is "atlas fleet discovery verbs"** — surfacing the landed atlas index as fleet verbs `code_symbol`/`code_grep`/`code_index_status` (deliberately NOT `code_semantic`) over `context.read`, plus an absence cache (`docs/reference/evidence/dropped-features-2026-08-06/SYNTHESIS.md:55-59,146`). This matters because **#123 (the discovery verbs) is precisely the code-intelligence surface** the LSP section is about — so the brief's grouping ("atlas substrate + #123 verbs + #144 LSP pool") is coherent *if* #123 means the discovery verbs. I cover **#43 (grammar)** and **#123 (discovery verbs)** as the two distinct things they are; where the brief says "#123 verbs" I map it to whichever is load-bearing in context and say so.
2. **Issue #144 has no standalone spec doc in the tree.** The issue itself lives in the GitHub tracker ("the open work tracker is the GitHub issue list," per `docs/PROGRESS.md`). The docs reference #144 only via this survey's sibling brief. The substantive design context for the "#144 LSP pool" lives in `docs/capabilities/orientation-reuse.md:30-31,212,250` — which states the idea as a *reject-and-reverse* of Serena's per-agent model ("baton needs a *hub-shared cache*, not a per-agent LSP session") and records that live LSP is an explicit non-goal of the current atlas epic (`docs/reference/evidence/atlas-2026-07-31/atlas-decisions.md:172`). I treat that doc, not a phantom spec, as #144's authority.
3. **OpenHands' current README no longer foregrounds CodeAct / the event-stream architecture** — those are OpenDevin-era concepts. The current surface is *Agent Canvas + Agent Server + Automation Server + ACP interop*. I mark the older concepts as such rather than presenting them as current.
4. **The ACP introduction page is high-level.** It states transport, envelope, and the LSP-for-agents framing, but is silent on lifecycle states, interruption/steering, and subagent semantics. I flag those as not-verified-from-the-intro rather than assert them.
5. **Star counts / popularity claims** (e.g., a listing's "23.9k stars" for omp) are taken from third-party listing sites and **not independently verified**; I avoid relying on them.

---

## 2. oh-my-pi (omp) — the primary target

**What it is (verified from the GitHub README, https://github.com/can1357/oh-my-pi, and https://omp.sh/).** omp is a terminal AI coding agent/harness by can1357 (`@can1357`), a coding-first fork of **Pi / pi-mono** by Mario Zechner (`@badlogic`), with an added ~80k-line Rust native layer and a 31-tool surface. Entry points share one engine: interactive TUI, one-shot (`-p`), SDK, RPC (NDJSON over stdio), and **ACP** (`omp acp`) for editor integration. *Could not independently verify* the third-party "23.9k stars" figure; the architecture above is from the project's own README.

### 2.1 LSP wired into every write (+ DAP) — `lsp` tool, 14 ops; `debug` tool, 28 ops
**Idea.** omp exposes the language server not as a discovery tool the agent must remember to call, but as a **gate wired into writes**: diagnostics, go-to-definition, references, workspace symbols, **semantic renames through `workspace/willRenameFiles`** (so re-exports, barrel files, and aliased imports update before a move), code actions, and raw LSP method calls. Separately, **DAP** (28 ops: breakpoints, stepping, threads, stack, variable inspection; attaches lldb/dlv/debugpy to live processes). The README's line: *"everything your IDE knows, the agent knows"* (https://github.com/can1357/oh-my-pi).
**Verdict — ADAPT (load-bearing for #144).** ADOPT the *write-gating* idea — LSP/DAP as a **constructive content gate**, not a discovery toy — but ADAPT it onto baton's **hub-shared pool** (#144) instead of omp's per-agent in-process server. baton's own law is explicit: "a *hub-shared cache*, not a per-agent LSP session" (`docs/capabilities/orientation-reuse.md:30`). omp proves the *value* of LSP-at-the-gate; baton's adaptation is to make one hub-managed LSP session per `(repo, language)` serve the whole fleet, surfaced as the **#123 discovery verbs** (`code_symbol`/`code_grep`/`code_index_status`) over `context.read`, and consulted by the **trust gate** on edits. Seam: capability-plane (atlas) + control grammar (#123/#43) + trust gate.
**Honest cost flag.** baton already recorded why live LSP is deferred: "Cross-file semantic edges need a live language server per language — heavy, and LSP quality is uneven (great for TS/Go/Rust, weak for dynamic/templated/DSL code)" (`docs/capabilities/orientation-reuse.md:250`; non-goal at `atlas-decisions.md:172`). So this is highest-ceiling, highest-cost — ranked accordingly in §6.

### 2.2 Hash-anchored edits ("hashline") — content-hash line anchors + stale-rejection
**Idea.** The `edit` tool references lines by content-hash anchors instead of retyping them; "edit a stale file and the anchors diverge — we reject the patch before it corrupts anything"; reported ~61% output-token cut on one model (https://github.com/can1357/oh-my-pi; standalone `@oh-my-pi/hashline` package).
**Verdict — ADOPT.** Stale-rejection-before-corruption is a textbook **constructive content gate** (verifies content, not counts → law-compliant), and the token cut serves **no-unbounded-content**. It rides the **trust-gate / context-harness edit seam** and complements atlas's `diff.structural` (`pure_reformat|logic_changed|signature_changed`, `docs/reference/evidence/atlas-2026-07-31/atlas-decisions.md:116-139`). The empirical edit-format lesson (format choice moves pass-rate 2–10×) is the same lesson Aider and SWE-agent learned (§§4–5).

### 2.3 Time-Traveling Stream Rules (TTSR) — pattern-triggered mid-generation steering that survives compaction
**Idea.** Dormant rules wake on a regex match against the live token stream: a match **aborts the stream mid-token**, injects the rule as a system reminder, and retries from the same point — *mid-generation, not between turns*; "injections survive compaction, so the fix sticks" (https://github.com/can1357/oh-my-pi).
**Verdict — ADOPT (strongest single AX borrowing for baton).** This is a pure **CONVERSATIONAL control** — it is steering — and it lands directly in baton's wheelhouse: baton already does mid-turn steer and confirmed interrupt natively (`docs/PROGRESS.md:32-35`). What TTSR adds is two refinements: (a) **pattern-triggered** (not human-triggered) course-correction, and (b) **compaction-persistence**, so a steering rule survives the context-collapse that otherwise erases mid-turn interventions. baton's "up is receipt-heavy / down is framing-heavy / lateral is mediated" directionality (`bidirectional-v3-decisions.md:147`) already frames downstream injection as wrapped-data-not-instruction; TTSR is a mechanism for that lane. Seam: **coordinator steer/interrupt**. (Caveat: pattern rules are authored policy — they must enter via the operator authority path, not become an authority-free inline control. That is a placement constraint, not a rejection.)

### 2.4 First-class subagents — isolated worktrees, schema-validated yields, `agent://` field addressing
**Idea.** `task` fans out into **isolated git worktrees** (the `pi-iso` crate uses copy-on-write FS — apfs/btrfs/zfs/reflink/overlayfs — for zero-copy creation), each with its own tool surface; the yield is a **schema-validated object the parent reads directly** ("no prose to parse, no merge conflicts between siblings"); `agent://<id>/findings.0.path` lets a parent pull a structured field; an **Agent Hub** (`Alt+A`) gives live roster/transcript/steer/revive/kill (https://github.com/can1357/oh-my-pi).
**Verdict — ADOPT (mostly confirmation + two concrete borrowings).** baton already runs per-worker isolated git worktrees and dispatches waves (`docs/37-wave-driver.md:11-13`), and the schema-validated yield is exactly baton's **upward receipt/capsule** over the event ledger (worker output is untrusted prose → must become structured evidence; `bidirectional-v3-decisions.md:147`). Two concrete borrowings: (a) **copy-on-write worktree creation** (reflink/btrfs/zfs) to cut worktree-spawn cost — a perf refinement to baton's coordinator; (b) the **`agent://` field-addressing URI** as a resolution scheme over the coordination-store, so a parent references `run://<id>/result.<field>` instead of re-reading prose. Seam: coordinator + coordination-store.

### 2.5 Advisor — a second model reads every turn, injects notes inline
**Idea.** A separate model bound to an "advisor" role "reads every turn the main agent takes, injecting notes inline," with its own context and model (https://github.com/can1357/oh-my-pi).
**Verdict — ADAPT.** This is continuous **doubt/review** — adjacent to baton's trust gate and the doubt-review work (#66). ADOPT the *second-model-over-the-shoulder* as an optional verification lane that emits **evidence** (up-is-receipt-heavy), never authority. Cost is the concern: "reads every turn" is a spend circuit-breaker matter, so it must be a deployment-configurable lane, not a default. Seam: verification/trust gate.

### 2.6 Memory — retain/recall/reflect/learn/forget, project-scoped
**Idea.** Tools `retain`/`recall`/`reflect`/`memory_edit`/`learn` (→ promote to a managed skill)/`manage_skill`; backends local / **Hindsight** / **Mnemopi** (SQLite); "project-scoped by default — what it learns about this repo stays with this repo" (https://github.com/can1357/oh-my-pi).
**Verdict — ADAPT selectively; REJECT any authority role for memory.** baton already has the **coordination-store KG** and the cross-deployment-knowledge law that **a projected recall is a READ, never an authority input** (`docs/reference/evidence/...` #70 contract: "federated recall is orientation, never authority"). omp's `reflect` (synthesize-over-bank) and `learn`→skill are borrowable as **evidence/orientation** producers feeding the KG. The hard line: memory must never become an authority-free zone — `memory_edit`'s "forget/invalidate" must route through the ledger with a principal, exactly as baton's scratch/board claims carry derived TTLs (`docs/capabilities/coordination-repl.md:168`). Seam: coordination-store KG (orientation only).

### 2.7 Internal URI schemes; in-process coreutils; magic keywords (orchestrate/workflowz/vibe); plan mode + 10 model roles
- **Internal URIs** (`pr://`, `issue://`, `agent://`, `skill://`, `ssh://`, `conflict://` …) "resolve transparently inside every FS-shaped tool" → **ADAPT** as a resolution layer behind the **#43 control grammar** (one name per concept, `docs/36-unified-control-grammar.md:265+`), provided resolution stays bounded (no-unbounded-content) and authority-routed.
- **In-process ripgrep/glob/find + 58 coreutils, no fork/exec on the hot path** → **ADAPT** (perf lesson), low priority: baton drives full harnesses rather than running its own in-process tool surface, but the "link tools into the process" principle applies to baton's own Node ESM scanners (`docs/reference/capability-atlas-2026-08-03/shipped-surface.md`).
- **Magic keywords** (`ultrathink`/`orchestrate`/`workflowz` trigger only in prose, not in code/identifiers) → **REJECT as a control surface.** Prose-keyword triggering is fragile and authority-adjacent; baton's deterministic **wave recipes / goal-plan** (`docs/37-wave-driver.md`) already capture the "orchestrate/workflowz" intent as a *constructive* (named, replayable) control, not a magic word.
- **Plan mode + 10 model roles + routing knobs** (custom providers, fallback chains on 429, path-scoped models, round-robin creds with session affinity + per-credential backoff) → **ADAPT.** baton has `goal-plan.mjs` and model routing; omp's **dedicated `plan` model role** and **per-credential backoff with session affinity** are concrete borrowings for baton's routing lane.

---

## 3. Serena — the per-agent-LSP exemplar baton defines itself against

**What it is (verified: https://github.com/oraios/serena; https://oraios.github.io/serena/01-about/000_intro.html).** Serena (Oraios) is an MCP toolkit that wraps an **LSP abstraction layer** to give an LLM symbol-level retrieval/edit/refactor/debug tools across 40+ languages, configured **per project**. It is the canonical "give one agent its own language server" design.
**Verdict — REJECT the topology, ADOPT the capability vocabulary.** baton already rejected this topology by name: it "needs a *hub-shared cache*, not a per-agent LSP session" (`docs/capabilities/orientation-reuse.md:30`) — Serena's per-project/per-agent servers do not amortize across a fleet of concurrent workers the way a hub pool does. But Serena's **symbol-tool vocabulary** (`find_referencing_symbols`, symbol-path addressing) is exactly the precision baton wants at **rung 2** of its representation ladder — "LSP/Serena precision (symbol-path addressing, `find_referencing_symbols`), SCIP incremental index" (`docs/capabilities/orientation-reuse.md:212`). So: REJECT per-agent topology; ADOPT the symbol-tool *shapes* as the API the **#123 discovery verbs** expose over the **hub-shared pool** (#144). Seam: #123 verbs + capability-plane.

---

## 4. Aider — tree-sitter repo-map (the closest external analog to atlas) + search/replace edits

**What it is (verified: https://aider.chat/2023/10/22/repomap.html; https://aider.chat/docs/repomap.html).** Aider is a CLI pair-programming agent. Its repo-map parses every file with **tree-sitter**, extracts definitions/references, builds a **graph (nodes = files, edges = dependencies)**, ranks it with a **PageRank-style centrality** ("the ones most often referenced by other portions of the code"), and **greedily truncates to a token budget** (`--map-tokens`, default 1k) — producing a skeletal, ellided symbol map the LLM sees as context. Edits use **search/replace blocks** (switched from older unified-diff/edit-block formats to cut malformed edits).

### 4.1 PageRank token-budgeted slice selection
**Idea.** Rank symbols by reference-centrality, keep the top-N within a token budget.
**Verdict — ADOPT (confirms atlas, sharpens the selection policy).** This is the external mirror of baton's atlas economics: "builds the map **once per `(repo, commit_sha)`**, CAS-deduped … serves **token-bounded, addressed slices** — never a whole-repo dump" (`docs/capabilities/orientation-reuse.md:7`). baton's ladder goes further (R0 text → … → R3 CPG → … → R7 e-graphs; `docs/reference/capability-atlas-2026-08-03/design-corpus.md:278-285`), so atlas is the strictly-richer substrate. The borrowing is **the ranking-as-context-selection policy**: when the hub decides which addressed slice to push to a worker, PageRank-centrality is a principled selector that fits the **no-unbounded-content** law (named cap = the worker's context budget). Seam: atlas/orientation (`cartographer-quartermaster.mjs`).

### 4.2 search/replace edit format
**Verdict — ADAPT.** The empirical lesson — edit-format choice moves correctness 2–10× (also seen in omp §2.2 and SWE-agent §5) — is direct evidence for investing in the **edit/diff shape at baton's trust gate**. baton's `atlas-structural.mjs` already classifies edits; pairing that with a hash-anchored or search/replace wire shape (vs. raw unified diff) is the Aider/omp convergence. Seam: trust gate / context-harness.

---

## 5. SWE-agent — the Agent-Computer Interface (ACI), "the single most-imitated idea"

**What it is (verified: https://arxiv.org/abs/2405.15793; https://github.com/swe-agent/swe-agent).** SWE-agent (Princeton, Yang et al. 2024) inverts the naïve "give the LM a shell" design and engineers a **custom Agent-Computer Interface** — LM-friendly commands and feedback windows tuned so the agent can navigate, edit, and reason about a repo. The paper's headline: the ACI, not the model, drove SOTA pass@1 (12.5% on SWE-bench at the time). A practitioner write-up calls the ACI "the single most-imitated idea in coding agents today" (https://dev.to/truongpx396/swe-agent-deep-dive-build-your-own-guide-ade).

### 5.1 The ACI design principle — tools engineered for LM ergonomics, with self-correcting feedback
**Verdict — ADOPT (validates baton's #43 grammar investment).** SWE-agent's empirical claim — *the interface matters more than the model* — is independent evidence that baton's **unified control grammar (#43)** and its "advertised is executable" law (`docs/36-unified-control-grammar.md:111-113,265+`) are load-bearing, not bikeshedding. The borrowing is the **discipline**: closed-shape commands, feedback that makes errors self-correcting, and a small, opinionated surface — all of which are already baton's L2/L8 laws. Seam: control grammar (#43).

### 5.2 SWE-bench as held-out, independently-verified eval
**Verdict — ADOPT (the EVAL-ABLE law, made concrete).** baton's trust gate is independent re-verification; SWE-bench is the field's canonical *held-out, DoD-anchored* benchmark. The borrowing is not "run SWE-bench" per se but the **eval posture**: a verification lane whose pass criterion is a DoD checked by an independent process, not a self-report — exactly baton's "controls must be EVAL-ABLE (validated goals: DoD, verification, referee)" (`bidirectional-v3-decisions.md:134-143`). Seam: trust gate / verification.

---

## 6. OpenHands (formerly OpenDevin) — Agent Canvas, Agent/Automation Servers, ACP interop

**What it is (verified: https://github.com/All-Hands-AI/OpenHands).** OpenHands is the open, model-agnostic platform for cloud coding agents. Its **current** surface is: **Agent Canvas** (a self-hosted control center driving one or more **Agent Servers** — a REST API for multiple agents on one host), an **Automation Server** ("create automations and workflows that integrate with Slack, GitHub, Linear, and more … agents that run on a schedule or in response to events"), **ACP** as the any-agent interop ("Use with OpenHands, Claude Code, Codex, Gemini, or any agent with Agent-Client Protocol"), and a **Docker sandbox** runtime. *(CodeAct and the event-stream architecture are OpenDevin-era concepts and are **not** foregrounded on the current README — flagged, not relied on.)*

### 6.1 Automation Server — event/schedule-triggered agents
**Idea.** Agents launch on external events (Slack, GitHub, Linear) or on a schedule, not only on a human prompt.
**Verdict — ADAPT (opens the fleet to non-human triggers).** This extends baton's fleet driver beyond "operator types in a CLI" to **waves launched by external events** — a natural new lane for the **wave-driver** (`docs/37-wave-driver.md`). Law check: an event-triggered wave is still dispatched through the one authority path with a principal (the trigger source is authenticated as a principal; its reach is constrained by construction — `docs/36-unified-control-grammar.md:298-299`). The schedule side must not smuggle in a *clock-as-progress-control*; a schedule is a **trigger**, and liveness/progress is still judged from the event vocabulary (`bidirectional-v3-decisions.md:134-143`). Seam: wave-driver / coordinator.

### 6.2 Agent Canvas as control center; Docker sandbox
**Verdict — ADAPT (Canvas) / already-have (sandbox).** The Canvas-as-control-center maps onto baton's web bus + resident `baton serve` host. baton's isolation is **isolated git worktrees + fresh-worktree trust gates** rather than a Docker sandbox; both achieve "agent can't poison the host," baton's is repo-native. Seam: web bus / resident host.

---

## 7. CrewAI — role-based crews + deterministic flows

**What it is (verified: https://crewai.com/multi-agent-ai-framework-for-task-automation; comparisons at https://peliqan.io/blog/crewai-vs-autogen/, https://blog.logrocket.com/autogen-vs-crew-ai/).** CrewAI orchestrates **role-based crews** — each agent has a role, goal, and backstory — joined by **deterministic flows** for production LLM workflows, with structured task delegation.
**Verdict — ADAPT (role/goal as brief framing; flows as recipes); REJECT free delegation where it opens authority-free zones.**
- **Role/goal/backstory per agent → ADAPT** as baton's **per-worker downward brief** specialization (baton already specializes workers per run; CrewAI's role/goal is a clean template for that brief). Seam: context-harness downward briefs.
- **Deterministic flows → ADAPT/confirm** as baton's **wave recipes** (`docs/37-wave-driver.md`) — baton is already on the deterministic side, deliberately.
- **Free conversational delegation → REJECT** where it lets agents mint authority over each other without a principal/ledger referent (baton: lateral is mediated, never free; `bidirectional-v3-decisions.md:147`). CrewAI's structured delegation is fine *because* it is structured; the lesson is to keep delegation routed, not peer-to-peer authoritative.

---

## 8. AutoGen — conversation-driven dialog loops

**What it is (verified: same comparison set as §7).** AutoGen (Microsoft Research) orchestrates **flexible, conversation-driven** multi-agent dialog loops, strong at autonomous code-generation with self-correction/re-execution.
**Verdict — REJECT the orchestration topology; ADAPT the self-correction loop.** Open-ended conversation-as-orchestration is hard to bound (content) and hard to attribute (authority) — both law-violating as a primary control. But the **self-correct/re-execute loop inside one bounded run** is a constructive control and is borrowable as a per-run execution pattern. Seam: coordinator (within a run).

---

## 9. Cline — Plan/Act toggle, approval gates, MCP

**What it is (verified: https://cline.bot/; https://github.com/cline/cline; https://medium.com/@floralan212/inside-cline-how-its-agentic-chat-system-really-works-3d582935efa5).** Cline is an open-source, approval-gated coding agent whose signature is a **Plan ↔ Act toggle** (Plan explores/asks/strategizes; Act executes), first-class **MCP** integration, and a ~20-tool surface run under human **checkpoints/approvals**.
**Verdict — ADOPT the Plan/Act AX; baton already has approvals.**
- **Plan/Act separation → ADOPT** as a clean **AX** borrowing: it makes the *decision* vs *execution* boundary explicit and user-visible — adjacent to baton's `goal-plan.mjs` and the "decisions-first payloads" discipline already in the wake/grammar work. A named toggle is a better mental model than an implicit one. Seam: goal-plan + coordinator.
- **Approval-gated checkpoints → already have**, confirm: baton's approvals are first-class (`docs/PROGRESS.md:32-35`); Cline's explicit checkpoint UX is a borrowing for baton's web bus, not a gap.
- **MCP first-class → confirm**: baton already speaks two MCP dialects and folds them into the one grammar (`docs/36-unified-control-grammar.md:30-49`).

---

## 10. Continue — IDE copilot (brief)

**What it is (verified: comparison set, https://fast.io/resources/cline-vs-continue/, https://www.respan.ai/market-map/compare/cline-vs-continue-dev).** Continue is an open-source IDE assistant/copilot — inline completions, chat, codebase context in-editor; less of an autonomous agent than Cline.
**Verdict — mostly REJECT (different layer); ADAPT only the codebase-context-as-orientation signal.** baton drives full harnesses, not an IDE copilot, so Continue's core is out of lane. The one borrowing is the **"context-as-you-navigate"** orientation cue, which maps to atlas's push-first `orientation.slice` over the nudge lane (`docs/reference/evidence/atlas-2026-07-31/atlas-decisions.md:116-139`). Seam: capability-plane orientation (already present).

---

## 11. ACP (Agent Client Protocol) — and baton's already-settled position

**What it is (verified: https://github.com/zed-industries/agent-client-protocol; https://agentclientprotocol.com/get-started/introduction; https://zed.dev/acp).** ACP is Zed's open standard — explicitly "**the LSP for AI coding agents**" — that decouples editors/IDEs (clients) from coding agents (servers). It uses a **JSON-RPC envelope**, negotiates a **`protocolVersion`** in an **`initialize`** handshake, advertises **capabilities** within a version, supports **local (JSON-RPC over stdio) and remote (HTTP/WebSocket)** agents, **reuses MCP's JSON representations where possible** and adds custom types for agentic UX (e.g., diffs); default user-readable format is Markdown. SDKs exist for Kotlin/Java/Python/Rust/TypeScript; Apache-2.0; adopted by JetBrains, Google, GitHub, and 25+ agents (https://www.morphllm.com/agent-client-protocol; https://blog.marcnuri.com/agent-client-protocol-acp-introduction).
*Not verified from the intro:* concrete lifecycle states, mid-turn interruption/steering semantics, and subagent/parallelism support — the introduction does not specify them.

**Verdict — REJECT as baton's core (baton already decided); ADOPT ACP as a tier-2 southbound + borrow its protocol discipline.** baton has already done this analysis in `docs/reference/acp-bridge-lessons.md`, studying the two production bridges (`@agentclientprotocol/claude-agent-acp` v0.58.1, `@agentclientprotocol/codex-acp` v1.1.2):
- **"ACP is a fine tier-2 southbound, and … can't be baton's core"** (`acp-bridge-lessons.md:254`): it **drops steer, inject, diffs, PTY, goals, rate limits, hooks, background tasks** (`:12`) — exactly the capabilities baton's native Codex-app-server and Claude-SDK/stream-json adapters exist to preserve.
- **"Neither bridge restarts a wedged harness"** (`:11`) — baton must do better (respawn + resume) because baton owns the fleet, not an editor UI.
- The hardest code is **cancellation-vs-completion race handling** (`:10`): force-cancel grace floors, orphan-result ledgers, owed-idle-debt counters, stale-turn marking, turn identity pinned by harness-echoed uuid (never ordering) (`:240-244`).

These are already baton's design lessons. The *new* borrowings from ACP-as-spec (not the bridges) are **protocol-discipline** patterns: the **JSON-RPC envelope + `protocolVersion` negotiation + capability advertisement** as a model for how baton's own adapter tiers declare and degrade capability. Seam: coordinator adapters (tier-2). Note: omp also exposes `omp acp` as an entry point (§2), so a baton↔omp tier-2 adapter is feasible without baton surrendering its native steer/interrupt on its primary adapters.

---

## 12. The LSP-for-agents section (the #144 heart)

**The landscape.** Four distinct "give the agent code intelligence" designs exist, in ascending order of how much live language-server they assume:

1. **Static symbol graph (no live LSP).** Aider's tree-sitter repo-map: AST → definition/reference graph → PageRank → token-budgeted slice (§4). Cheapest, language-broad, but **no type resolution, no rename, no diagnostics** — navigation only.
2. **MCP-wrapped LSP, per project/agent.** Serena (§3): a full LSP abstraction layer, symbol-level tools, 40+ languages, but **one server per project per agent** — unamortized across a fleet.
3. **In-process LSP wired into every write.** omp (§2.1): the agent's own process drives LSP/DAP; renames go through `willRenameFiles`; diagnostics gate writes. **Per-agent process**, highest precision, highest cost.
4. **Host-IDE LSP bridge.** Claude Code issue #24249 (https://github.com/anthropics/claude-code/issues/24249): when the agent runs as a VS Code extension, bridge to the **host IDE's already-running** language servers — `textDocument/{references,rename,definition,implementation}`, `workspace/symbol`, diagnostics, `textDocument/codeAction` — with **graceful degradation** (no server → fall back to grep/edit). The issue's own motivator is the cleanest one-liner for why this matters: in a large Java monorepo, grep for a method returns hundreds of false positives ("can't distinguish `report.getTitle()` from `narrative.getTitle()`"), while the language server already knows the 12 real call sites — *"Claude Code is sitting right next to this infrastructure but can't use it"* (issue closed as duplicate, i.e. the ask is recognized).

**Comparison to baton's substrate + #123 verbs + the #144 LSP pool.**
- baton's **atlas** is already a strictly richer substrate than Aider's repo-map: the R0→R7 ladder (text → CST/AST → **symbol/SCIP** → **CPG (AST+CFG+PDG)** → compiler IR → behavioral fingerprints → semantic diff-merge → e-graphs; `docs/reference/capability-atlas-2026-08-03/design-corpus.md:278-285`), built once per `(repo, commit_sha)`, CAS-deduped, **token-bounded addressed slices** (`docs/capabilities/orientation-reuse.md:7`), with shipped modules `atlas-index`/`atlas-structural`/`atlas-cpg`/`atlas-cpg-delta`/`atlas-cpg-taint`/`atlas-behavior-fingerprint` (`shipped-surface.md:246-255`). So baton does **not** need to borrow the *substrate* — it needs to borrow the **access pattern**.
- baton's **#123 (discovery verbs)** is the unbuilt surface that exposes the index: `code_symbol`/`code_grep`/`code_index_status` over `context.read` + the absence cache (`docs/reference/evidence/dropped-features-2026-08-06/SYNTHESIS.md:55-59`). This is exactly the seam where LSP-shaped capability lands — it is the *verb* layer designs 2–4 above lack.
- baton's **#144 (LSP pool)** is the *topology* decision: **hub-shared**, not per-agent (rejecting Serena's model; `docs/capabilities/orientation-reuse.md:30`), with **SCIP incremental** as the durable index and **live LSP/Serena precision at rung 2** (`:31,212`), and live LSP currently an explicit non-goal because it is "heavy" and "uneven" (`:250`; `atlas-decisions.md:172`).

**Top-3 LSP-adjacent borrowings for baton** (ranked by value-per-cost, each with its seam):

1. **The omp "wired into every write" gate + Claude-Code-#24249's graceful-degradation ladder (HIGHEST value-per-cost among LSP ideas).** Make LSP/DAP a **constructive content gate** consulted on edits (rename via `willRenameFiles`, diagnostics before accept) — sourced from the **hub-shared pool**, exposed via the **#123 discovery verbs**, degrading `live-LSP → SCIP index → grep` when no server is available. This is #144 done law-compliantly: bounded (slice, not whole-repo), constructive (gate, not toy), authority-routed (verb over `context.read`). Seam: trust gate + #123 verbs + capability-plane.
2. **Serena's symbol-tool vocabulary as the API shape of the #123 verbs.** REJECT Serena's per-project topology, but ADOPT `find_referencing_symbols` / symbol-path addressing as the *shapes* `code_symbol`/`code_grep` return — baton already named this as rung-2 precision (`docs/capabilities/orientation-reuse.md:212`). Seam: #123 verbs.
3. **Aider's PageRank token-budgeted selection as the pool's *output* policy.** When the hub pool must answer a worker, select the addressed slice by reference-centrality within the worker's context budget — the same economics atlas already follows, made explicit as a ranking policy. Seam: atlas/orientation.

**What baton should *not* borrow:** omp's per-agent in-process LSP (unamortized across a fleet; violates the hub-shared law), Serena's per-project servers (same), and any "LSP as the only navigation" design that abandons the SCIP/CPG substrate baton already has. The honest summary: **baton's substrate is ahead of the field; baton's *access pattern* (verbs + pool + gate) is the gap, and #144/#123 are the issues that close it.**

---

## 13. Top-5 cross-project inspirations for baton — ranked by value-per-cost

Each ranked by value-per-cost (not raw value), each with the baton lane it would join. The ranking bakes in baton's existing-investment discount: a thing baton mostly has costs less to gain.

1. **Time-Traveling Stream Rules — pattern-triggered, compaction-persistent mid-generation steering (omp §2.3).** *Lane: coordinator steer/interrupt.* **Why #1:** baton already has native mid-turn steer + confirmed interrupt, so this is a *refinement* (pattern-trigger + compaction-survival), not new infrastructure; it is a pure CONVERSATIONAL control (law-pluperfect); and mid-generation course-correction is high-leverage AX. Value-per-cost is the highest here.
2. **Hash-anchored edits with stale-rejection (omp hashline §2.2; converges with Aider §4.2).** *Lane: trust gate / context-harness edit shape.* **Why #2:** stale-rejection is a constructive content gate (law-compliant) and the token cut serves no-unbounded-content; the edit-format lesson is independently re-confirmed by three projects. Medium cost, high value.
3. **LSP/DAP via a hub-shared pool, gated into writes (omp §2.1 + Claude-Code #24249 + Serena §3; baton #144/#123).** *Lane: capability-plane (atlas) + control grammar (#123/#43) + trust gate.* **Why #3 (not #1):** highest *ceiling* — it closes the code-intelligence gap and baton's substrate is already ahead of the field — but also **highest cost** and baton has *already* deferred live LSP as heavy/uneven (`orientation-reuse.md:250`; `atlas-decisions.md:172`). Value-per-cost ranks it below the two cheaper wins; the cheap sub-piece (the #123 discovery verbs over the *existing* SCIP index, no live LSP) is itself a strong candidate and should land first.
4. **ACI ergonomics + held-out eval discipline (SWE-agent §5).** *Lane: control grammar (#43) + trust gate/verification.* **Why #4:** mostly *confirms and sharpens* baton's direction ("the interface matters more than the model" validates the grammar; SWE-bench validates EVAL-ABLE). Low cost because baton is already building it; moderate marginal value.
5. **External event/schedule-triggered waves + Plan/Act AX (OpenHands Automation Server §6.1 + Cline §9).** *Lane: wave-driver/coordinator + goal-plan.* **Why #5:** opens the fleet to non-human triggers (Slack/GitHub/Linear events) and gives a clean decision-vs-execution AX. Medium value, medium cost; the schedule half must stay a *trigger*, not a clock-as-progress-control.

**Deliberate REJECTS (recorded so they are not re-litigated):** AutoGen's unbounded conversation-as-orchestration and omp's magic-keyword triggers (authority-free / unbounded-content risks); Serena's and omp's per-agent/per-project LSP topology (violates the hub-shared law); CodeAct as a primary layer (baton drives full harnesses, not actions-as-code); Continue's IDE-copilot core (out of lane).

---

## Sources

External (cited inline; all retrieved 2026-08-12):
- oh-my-pi: https://github.com/can1357/oh-my-pi · https://omp.sh/
- Serena: https://github.com/oraios/serena · https://oraios.github.io/serena/01-about/000_intro.html
- Aider repo-map: https://aider.chat/2023/10/22/repomap.html · https://aider.chat/docs/repomap.html
- SWE-agent: https://arxiv.org/abs/2405.15793 · https://github.com/swe-agent/swe-agent · https://dev.to/truongpx396/swe-agent-deep-dive-build-your-own-guide-ade
- OpenHands: https://github.com/All-Hands-AI/OpenHands
- CrewAI / AutoGen: https://crewai.com/multi-agent-ai-framework-for-task-automation · https://peliqan.io/blog/crewai-vs-autogen/ · https://blog.logrocket.com/autogen-vs-crew-ai/
- Cline / Continue: https://cline.bot/ · https://github.com/cline/cline · https://fast.io/resources/cline-vs-continue/ · https://www.respan.ai/market-map/compare/cline-vs-continue-dev · https://medium.com/@floralan212/inside-cline-how-its-agentic-chat-system-really-works-3d582935efa5
- ACP: https://github.com/zed-industries/agent-client-protocol · https://agentclientprotocol.com/get-started/introduction · https://zed.dev/acp · https://www.morphllm.com/agent-client-protocol · https://blog.marcnuri.com/agent-client-protocol-acp-introduction
- Claude Code LSP-as-tools: https://github.com/anthropics/claude-code/issues/24249
- LSP-for-agents trend: https://tech-talk.the-experts.nl/give-your-ai-coding-agent-eyes-how-lsp-integration-transform-coding-agents-4ccae8444929

Baton-internal (cited inline; repo-relative):
- Product/seams: `docs/19-north-star-corrected.md` · `docs/00-brief.md` · `docs/PROGRESS.md` · `docs/37-wave-driver.md`
- Laws: `docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md` · `docs/reference/evidence/prescriptive-doctor-2026-08-12/prescriptive-doctor-contract.md` · `docs/reference/evidence/tight-cell-2026-08-06/tight-cell-contract.md`
- Control grammar (#43) + discovery verbs (#123): `docs/36-unified-control-grammar.md` · `docs/reference/evidence/dropped-features-2026-08-06/SYNTHESIS.md` · `docs/reference/evidence/grammar-2026-07-24/`
- Atlas / #144 / orientation: `docs/capabilities/orientation-reuse.md` · `docs/reference/capability-atlas-2026-08-03/design-corpus.md` · `docs/reference/capability-atlas-2026-08-03/shipped-surface.md` · `docs/reference/evidence/atlas-2026-07-31/atlas-decisions.md`
- ACP bridges: `docs/reference/acp-bridge-lessons.md`
- Coordination store: `docs/capabilities/coordination-repl.md`
