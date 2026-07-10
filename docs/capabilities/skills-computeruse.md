I have deep architecture context and current (2025-26) prior art. Here is the design dossier.

---

# Skill Forge & Computer-Use Surface — baton capability module

*A capability-plane module with two linked sub-capabilities that both EXPAND what a worker can do: (A) a **skill forge** where workers author, the hub verifies/versions/shares, and the fleet adopts reusable skills mid-run; and (B) a **computer-use surface** that adds a GUI/browser worker modality under the same control plane — plus the bridge that turns (B)'s flaky trajectories into (A)'s deterministic skills.*

## Summary (5 bullets)

- **Reflexive capability growth is a fleet property, not a worker property.** A worker that discovers "how to do X" today should make X cheaper for every worker tomorrow. Baton already has the two organs this needs — hub-run verification (supervisor **I7**) and the git artifact registry (doc 08 §3b) — so the forge is mostly *wiring existing invariants to a new object type* (a skill), not new machinery.
- **A worker-authored skill is worker-authored CODE, so the trust story reuses baton's authorization boundary verbatim:** the **OS sandbox is the boundary, not a string scan** (doc 05 §5), verification is **hub-run not worker-reported** (I7), and fleet promotion is gated by the **single-consumer approval arbiter** (I2). Trust tiers (`draft → verified → blessed → deprecated`) map onto machinery that already exists.
- **Computer use is just another southbound adapter tier** (`cua-adapter`) emitting the same `BatonEvent` stream and obeying the same steer/interrupt/approve verbs — but honestly the *flaky, expensive, injection-exposed* tier. Frontier computer-use agents sit at ~72% on OSWorld and ~21% on long-horizon OSWorld 2.0, and prompt injection is, per OpenAI, "unsolved." It is the GUI escape hatch, the computer-use analog of baton's PTY tier: *exists so the fleet's reach is total, not so it's good.*
- **Agent-computer interaction, not human-computer interaction:** the orchestrator never receives screenshots. GUI steps become structured `action.gui_step` events with screenshot **artifact refs** (blobs by hash, in the registry), and the orchestrator consumes a token-bounded digest ("step 7/12 clicked *Export CSV*; screen state changed; goal-progress ok"), never pixels.
- **The capstone links the two:** after a computer-use worker succeeds, the forge **distills the successful trajectory into a deterministic skill** (an AWM/ASI/SkillWeaver-style induction) — the flaky vision loop becomes a replayable Playwright/`browser-use` script or a discovered API call, blessed once and adopted fleet-wide. The fleet converts slow/flaky computer-use into fast/reliable skills as it works.

## The problem for an agent fleet (why harness-native tools are insufficient here)

Every harness *already* has skills (Claude Code's SKILL.md) and some have computer use (Claude, Codex Background Computer Use). Dropping those in per-worker solves nothing for a fleet, and actively creates three orchestration-specific failures:

1. **Skills are trapped in one worker's context.** Claude Code Skills live in a worker's local skill directory; a skill `w_codex_01` authors mid-task is invisible to `w_claude_03` and evaporates when the worker exits. Harness-native skills have **no cross-vendor, cross-worker sharing path** — a Codex worker cannot adopt a Claude worker's SKILL.md, and neither survives the run. Reflexivity ("the fleet gets more capable as it works") is impossible without a *fleet-owned* registry and a promotion pipeline the harnesses don't have.

2. **Harness-native skill trust is trust-on-first-use, which is catastrophic at fleet scale.** In a single-user Claude Code session, a bad skill hurts one user who clicked "trust." In a fleet, a skill authored by *one* worker (possibly a prompt-injected one) and adopted by *N* workers is a **supply-chain / lateral-movement vector**: the exact attack class demonstrated in 2025-26 (Cato's *Weaponizing Claude Skills with MedusaLocker*; Reversec's *Skill Issues*; CVE-2025-59536 RCE on untrusted-dir launch). The community marketplace has *no automated vetting* and *visibility ends after first approval* (Repello). A fleet cannot inherit trust-on-first-use; it needs a **non-LLM verification-and-review gate** that is exactly the supervisor's job — but the harnesses don't provide one.

3. **Not everything is a CLI, and a GUI worker breaks every fleet assumption if bolted on naively.** A legacy web app with no API, a visual-diff check, an OAuth consent screen — these need a GUI worker. But a computer-use loop is *push-shaped, minutes-long, screenshot-heavy, non-deterministic, and prompt-injectable*. Bolted on outside the control plane it would: flood the orchestrator's scarce context with images (HCI, not ACI), be un-interruptible (a runaway browser session), and hold real credentials into an injection-exposed surface (the Brave-vs-Comet OTP-exfil attack). It has to be **wrapped in the same steer/interrupt/approve/ledger machinery** as any worker, with GUI-specific derived signals — which is a capability-plane design problem, not an install.

The through-line: harness-native tools optimize for *one agent, one session, human-in-the-loop trust*. A fleet needs *shared, verified, versioned, observable, steerable, provenance-tracked* capability. That gap is this module.

## Prior art

Real tools/systems; 2025-26 status; what baton borrows vs rejects.

| Tool / system | What it does | 2025-26 status | What baton borrows | What baton rejects |
|---|---|---|---|---|
| **Voyager** ([arXiv 2305.16291](https://arxiv.org/abs/2305.16291), TMLR '24) | LLM authors an ever-growing **skill library of executable code**; retrieval by embedding-similarity over skill descriptions; iterative **self-verification** loop | Seminal; spawned the '25-26 skill-induction line | Skills-**as-code** (not NL); the create→verify→refine loop; retrieve-by-description | Model-*owned* self-verification (baton makes it hub-run, I7); single-agent; sim env |
| **Claude Code Skills / SKILL.md** ([Anthropic](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)) | Folder of instructions+scripts+resources; YAML frontmatter + Markdown; **progressive disclosure**; composable; `allowed-tools` | Published as an **open standard** (Dec '25); large ecosystem | The **SKILL.md format itself** (interop — a baton skill *is* a valid Claude skill), progressive disclosure, `allowed-tools` as a capability manifest | Trust-on-first-use; no automated vetting; visibility-ends-after-approval |
| **Claude Code Plugins + marketplaces** ([docs](https://code.claude.com/docs/en/plugins-reference)) | `plugin.json` bundles skills/agents/hooks/MCP; a **git repo = a marketplace/registry** | Shipping; [`anthropics/claude-plugins-official`](https://github.com/anthropics/claude-plugins-official) | git-repo-as-registry; the bundle manifest idea | Install-time-only trust; no runtime re-confinement; human-curation only |
| **Official MCP Registry** ([blog](https://blog.modelcontextprotocol.io/posts/2025-09-08-mcp-registry-preview/)) | Meta-registry: **metadata not code**; reverse-domain namespaces; **immutable semver** versions | Preview Sept '25; API freeze v0.1 Oct '25 | Reverse-domain namespacing, immutable versions, **meta-registry** (skill *code* lives in git, registry is the index) | Public/global scope (baton is fleet-private); no verification gate before listing |
| **Code execution with MCP** ([Anthropic, Nov '25](https://www.anthropic.com/engineering/code-execution-with-mcp)) | Materialize tools as **filesystem code wrappers**; progressive disclosure cut a workflow **150k→2k tokens (98.7%)**; state in files | Current best practice | Filesystem materialization of adopted skills; the token economics; state-in-files for resumable skill runs | (adopt heavily; little to reject) |
| **ToolMaker** ([arXiv 2502.11705](https://huggingface.co/papers/2502.11705), ACL '25) / CREATOR ('23) / ToolACE-DEV ('25) | Agents autonomously **create → unit-test → refine** their own tools; ToolMaker passes 80% of 124 unit tests (vs OpenHands 20%) | Active research line | **Unit-test-gated acceptance**: a skill isn't real until its own tests pass in a sandbox | Unbounded tool-creation autonomy with no trust/review gate |
| **AWM / ASI / SkillWeaver / SKILL.md-mining** ([AWM](https://arxiv.org/html/2606.15017), [ASI], [2606.20363](https://arxiv.org/html/2606.20363v1)) | **Induce reusable skills from agent trajectories**; ASI mines Python browser-action skills; SkillWeaver synthesizes executable APIs where a **strong agent uplifts weaker downstream agents** | Very active '25-26 | The **capstone bridge**: distill a CUA trajectory → deterministic skill; online induction from *successful* traces; strong→weak uplift | Fully-automatic promotion without verification + review |
| **Claude Computer Use** ([Anthropic](https://www.digitalapplied.com/blog/computer-use-agents-2026-claude-openai-gemini-matrix)) | Portable **screenshot + mouse/keyboard** tool; cross-VM/container; only frontier CUA that drives a **full desktop** | Sonnet 4.6 **72.5% OSWorld-Verified** (Feb '26); Anthropic acq. Vercept | The portable tool spec + VM isolation as the desktop CUA driver | Nothing as a driver; but treat the *whole modality* as the flaky tier |
| **OpenAI CUA/Operator → ChatGPT Agent; Codex Background Computer Use** | o3-based; virtual browser; **parallel background desktop sessions** (macOS-first, Apr '26) | Operator standalone deprecated → folded into ChatGPT Agent | The background/parallel-session model; virtual-browser sandboxing | Closed; browser-anchored default; no external control plane |
| **browser-use** ([site](https://browser-use.com/posts/ai-browser-agent-benchmark)) | Open-source, **model-agnostic** browser agent; DOM+vision | **81k+ GitHub stars** (Mar '26); **89.1% WebVoyager** | The **browser-only CUA driver** behind `cua-adapter`; DOM-first (cheaper than pure vision) | Browser-only reach (no desktop) → pair with Claude/Simular for OS tasks |

Load-bearing benchmark reality (for the "honest residuals" argument): OSWorld went 12% (Apr '24) → 38.1% (OpenAI CUA, Jan '25) → 61.4% (Sonnet 4.5, Sept '25) → 72.6% (Simular Agent S2, Dec '25, first past the 72.36% human baseline) → 72.5% (Sonnet 4.6, Feb '26). On **OSWorld 2.0** (long-horizon; median task = 1.6 human-hours) the best frontier system completes **20.6%**. Prompt injection is OWASP-LLM **#1** with ~84% attack success and, per OpenAI's CISO, "may never be fully solved" for browser agents.

## Module design

Both sub-capabilities are exposed on the **same hub MCP server** as the `fleet_*` verbs, in two namespaces: `skill_*` (forge) and `cua_*`/`fleet_spawn(harness='cua')` (computer use). They are consulted against the harness card and enforced by the non-LLM supervisor, exactly like control verbs.

### A. Skill Forge — agent-facing interface (MCP verbs, concrete signatures)

```
# ---- authoring (worker or orchestrator) ----
skill_draft(name, intent, entrypoint, files:[{path,blob}], harness_compat:[…],
            manifest:{allowed_tools,net:none|scoped,paths}, self_test) -> skill_id   # status=draft
skill_verify(skill_id) -> VerifyReport          # hub-run, throwaway sandbox (I7); long op → task-DAG
skill_publish(skill_id, semver, review:{reviewer?}) -> {ns_id, version}  # gated: verified + I2 approval
# ---- discovery / adoption (any worker) ----
skill_search(query|capability, harness, trust>=verified, limit=8) -> [SkillCard]      # token-bounded
skill_adopt(ns_id@semver, worker) -> {installed_path}   # materializes into worker's skill dir (progressive disclosure)
skill_report(ns_id@semver, outcome:worked|failed|flaky, ledger_ref, note?) -> ack     # reflexive feedback
# ---- governance (orchestrator/human only) ----
skill_promote(ns_id@semver, tier:blessed) / skill_deprecate(ns_id@semver, reason, supersedes?)
```

- **Invocation is native, not intercepted.** A worker runs a skill the harness-native way (reads SKILL.md, executes its code). Baton does not proxy invocation — it *observes* it: the adapter maps the skill run to a `capability.skill_invoked` event (+ the underlying `action.command_exec`/`file_edit`). Non-interception keeps skills interoperable (a baton skill is a valid Claude skill) and token-cheap.
- **Skills as code + filesystem materialization.** A skill = SKILL.md frontmatter (Voyager retrieve-by-description) + optional Python/TS wrappers (Anthropic "code execution with MCP"). `skill_adopt` materializes it into the worker's skill dir; progressive disclosure means only the matched SKILL.md enters context, not the whole registry.

### B. Computer-Use Surface — agent-facing interface

A CUA worker is spawned like any worker; the `cua-adapter` fronts a driver (`browser-use` for browser-only, Claude computer-use tool for desktop, Simular/Gemini as alternates), declared in its harness card.

```
fleet_spawn(harness='cua', driver='browser-use'|'claude-cu'|…, sandbox='ephemeral-vm',
            creds=scoped_token?, brief, budget, verification) -> worker_id
# then the SAME control verbs as any worker:
fleet_send(worker, goal, mode=steer)      # redirect the browsing/desktop goal in-flight
fleet_interrupt(worker, then?)            # two-phase stop (I6): halt loop → kill VM/browser → verify death
fleet_respond(request_id, allow|deny)     # risky GUI actions (submit/purchase/cross-origin) → single-consumer arbiter
cua_distill(worker, trajectory_range) -> skill_id   # the capstone: successful trajectory → draft skill
```

### Integration with the three planes

**Knowledge plane — operational ledger (doc 05).** New closed-set `BatonEvent` kinds, all carrying `actor` + provenance:
- `capability.skill_drafted / .verified / .published / .adopted / .invoked / .deprecated / .reported` — priority-lane (small, rare, load-bearing).
- `action.gui_step` (`{action:click|type|nav|scroll, target, screen_ref, url}`), `action.dom_snapshot` (ref) — **bulk lane**, coalescible; screenshots are **artifact refs by hash, never inlined**.
- `health.cua_uncertain` (the flakiness signal — agent unsure it succeeded), `health.injection_suspected` (page contains instruction-shaped text; ties to the injection threat) — priority-lane.

**Knowledge plane — coordinative (task-DAG + artifact registry, doc 08).**
- `skill_verify` and `cua_distill` are **long operations → tasks in the DAG** (`working → completed/failed`), interruptible, resumable.
- Skill code = **artifacts in git** (worktree-committed with the authoring worker's identity + `Harness:` trailer, doc 08 §3b). The registry maps `ns_id@version → {commit_sha, files, manifest, verify_report_ref, reviewer, provenance:[event_seq…]}` — the **registry is the index; git is the memory** (doc 08). Immutable versions = a "new version" is a new row, never an update-in-place.
- CUA screenshots/DOM snapshots = blob artifacts by hash in the registry, referenced from events.

**Knowledge plane — epistemic (selective promotion, doc 08 §5).** At run boundaries, notable skills promote into the PM-style KG: a blessed skill → a `Principle`/`Finding`-shaped node; "CUA task X was distilled into deterministic skill Y" → a `Decision` with provenance edges to the justifying events (temporal-coherence-checked: a promotion can't cite an event that hadn't happened). *Which skills survive and get reused across runs* is precisely the durable cross-run signal doc 08 §7 Q2 flags — the forge is a natural producer for the epistemic layer, without baton becoming a second brain.

**Control plane — how the orchestrator STEERS it.**
- *Forge:* the orchestrator governs **which capability is in play** — `skill_promote`/`skill_deprecate`, sets the adoptable trust-tier policy, force-reviews a skill, supersedes a bad version. This is "steering the fleet's capability surface," not a worker's turn.
- *CUA:* the same `steer`/`interrupt` verbs redirect the browsing goal or narrow the task; a flailing CUA worker (repeated `health.cua_uncertain`) is steered, escalated to **human takeover** (doc 05 §7), or the task is **rerouted to a different modality** (drop CUA, find an API).

**Control plane — how it's interrupted / trust-gated.**
- Skill **verification is hub-run, never worker-reported (I7):** a worker's "my skill is safe/works" is an unverified *claim*; the hub executes the skill's self-test in a **fresh throwaway sandbox with egress monitoring** and treats only its own observed exit/output as authoritative.
- The **OS sandbox is the authorization boundary (doc 05 §5), not the static scan.** The SKILL.md `allowed-tools`/net/paths manifest becomes the **sandbox profile**, re-applied on **every invocation** (this directly counters the Cato/Repello "visibility-ends-after-approval, clean-script-hidden-helper" finding — baton re-confines each run, not once). The static scan (secret-exfil patterns, egress, denylist) is a **tripwire that logs**, never the boundary — mirroring baton's policy-engine correction.
- **Promotion to fleet-adoptable requires a single-consumer reviewer decision (I2):** `draft` (author-only) → `verified` (passed hub sandbox; adoptable *confined* only) → `blessed` (reviewer-approved via the approval arbiter; fleet-wide) → `deprecated`. Human > orchestrator > policy precedence applies; **high-privilege skills (net-scoped, cross-worktree) must require orchestrator/human blessing, not worker-only review** — transitive worker trust is capped by the sandbox.
- CUA **interrupt is two-phase (I6):** halt the loop → drain any outstanding GUI approval (`cancel`) → **kill the VM/browser and verify death** → release the session lease. Risky GUI actions (form submit, purchase, cross-origin, credential entry) surface as **approvals through the single-consumer arbiter** — and a CUA worker runs in an **ephemeral VM with scoped/no credentials** (auth posture is per-worker, adapter-contract §4), so an injection hijack can't spend the orchestrator's real creds.

### Agent-ergonomic output shape (concrete, token-bounded)

`skill_search("extract tables from a rendered PDF", harness=codex)` returns a bounded list, not a fan-out:

```jsonc
{ "results": [
  { "ns": "baton.fleet/pdf-table-extract", "version": "1.2.0", "trust": "blessed",
    "intent": "Extract tables from a rendered (image-only) PDF to CSV via pdfplumber+ocr fallback",
    "harness_compat": ["codex","claude","glm"], "manifest": {"net":"none","paths":["./out"]},
    "score": 0.91, "usage": {"adopted": 14, "worked": 12, "flaky": 1, "failed": 1},
    "authored_by": "w_claude_03@run_88", "verify": "pass(12/12)" }
  // …≤8 rows, ranked by embedding-similarity × win-rate
], "cursor": null }
```

`skill_verify(...)` returns a decision-ready report, not a log dump:

```jsonc
{ "skill": "baton.fleet/pdf-table-extract@1.2.0", "verdict": "verified",
  "self_test": {"exit": 0, "cases": "12/12"},
  "sandbox": {"egress_attempts": 0, "writes_outside_manifest": 0, "peak_mem_mb": 210, "wall_s": 4.1},
  "tripwires": [], "risk": "low", "requires_review_tier": "policy",
  "provenance": ["seq:4471","seq:4519"] }
```

A CUA digest the orchestrator receives (pixels stay in the registry):

```jsonc
{ "worker": "w_cua_02", "kind": "action.gui_step", "seq": 337,
  "step": "7/≈12", "action": "click", "target": "button:'Export CSV'",
  "url": "https://legacy.example/reports", "screen_ref": "blob:sha256:9f…",
  "goal_progress": "on_track", "confidence": 0.74 }
// derived signal, priority lane:
{ "worker": "w_cua_02", "kind": "health.cua_uncertain", "seq": 341,
  "reason": "screen state unchanged after 3 clicks", "suggest": "steer|escalate" }
```

### Shared vs per-worker (and concurrency)

- **The skill registry is SHARED and hub-owned — that IS the reflexive point.** Concurrency is clean by construction (doc 08 §4): publishes are a CAS on `(namespace, semver)`; **immutable versions mean no update-in-place → no lost-update** (a new version is a new append, exactly "immutable-once-written"). Adoption is read-only (no contention). The **win/loss counter is the one mutable shared datum — and it is never a shared blob:** `skill_report` appends a `capability.skill_reported` *event*, and the counter is a *projection* rebuilt from the ledger (the SQLite index is derived; drop-and-replay if it corrupts).
- **Per-worker:** each worker's *installed* skill set (its materialized skill dir / MCP filesystem) is per-worker state written on `skill_adopt`; progressive disclosure keeps it cheap. CUA sessions are strictly per-worker — each owns its ephemeral VM/browser; **there is no shared GUI world-state** (a shared browser would be the doc 08 §4 deadlock/lost-update generator).

## Scoping (MVP rung vs later rungs)

- **Rung 0 (MVP — smallest useful, reflexive *within* a run):** `skill_draft` + `skill_verify` + intra-worker/orchestrator re-invocation, **no cross-worker sharing yet**. A worker authors a SKILL.md-shaped skill; the hub verifies it in a throwaway sandbox (**pure reuse of I7 + the artifact registry that already exist**); the same worker (or orchestrator) re-invokes it later in the run. Proves "capability grows as it works" for a few weeks of effort, adds *zero* new trust-boundary machinery.
- **Rung 1 (fleet-wide reflexivity):** the shared registry + `skill_search`/`skill_adopt` cross-worker + trust tiers + the single-consumer reviewer gate (**reuse of I2**). Now `w_claude_03`'s skill is adoptable by `w_codex_01`.
- **Rung 2 (self-tuning):** `skill_report` win/loss projection → auto-flag-for-review and orchestrator `skill_deprecate`/`skill_promote` governance; epistemic promotion at run end.
- **Rung 3 (computer-use surface):** the `cua-adapter` (spawn a CUA worker, digest telemetry, steer/interrupt via I6, ephemeral-VM sandbox, approval-gated risky actions, GUI derived signals). Deliberately later — the honest default advice is "avoid unless GUI-only."
- **Rung 4 (the capstone bridge):** `cua_distill` — a successful CUA trajectory becomes a `draft` deterministic skill (AWM/ASI/SkillWeaver induction) that flows through the Rung-1 verify→bless→adopt pipeline. Depends on both R1 and R3; this is where the fleet stops *repeating* flaky GUI work and starts *replacing* it.

## Limitations & honest residuals

- **Computer-use prompt injection is unsolved — baton bounds blast radius, it does not prevent hijack.** Per OpenAI, indirect injection "may never be fully patched" for browser agents (Brave-vs-Comet exfiltrated OTPs via white-on-white text; Unit 42 saw it in the wild). Baton's mitigations are containment, not cure: ephemeral VM, **scoped/no credentials** (never the orchestrator's real creds), approval-gated cross-boundary actions, and the `health.injection_suspected` signal. A CUA worker must be treated as *potentially adversary-controlled from the moment it loads an untrusted page.*
- **A skill can be prompt-injection-*authored*.** An attacker controlling a worker's inputs can try to author a malicious skill. The verify-sandbox + reviewer gate + provenance cap this, but a **logic-bomb / sandbox-evasion skill** — benign in verification, malicious in the field — is a real residual (the Cato "clean script, hidden helper" pattern). Defense-in-depth (re-confine every invocation to the declared manifest, runtime egress monitoring, win/loss anomaly flags) reduces but cannot *prove* absence. High-privilege skills therefore require human/orchestrator blessing, not worker-only review.
- **"Blessed" is only as trustworthy as its reviewer.** If the reviewer is another (possibly compromised) worker, trust is transitive. The sandbox stays the real boundary; cross-worker review is a *convenience for low-privilege skills*, and the module deliberately refuses to let worker-only review authorize net-scoped or cross-worktree skills.
- **Verification proves the self-test passes, not that the skill is *correct* for a new context** — the same limit as any test suite. Embedding-similarity retrieval (Voyager) can also surface the *wrong* skill; a wrong adoption wastes a turn. Bounded by win-rate-weighted ranking and the addressed-slice discipline (doc 08 §2), not eliminated.
- **CUA economics are genuinely bad relative to CLI.** ~72% OSWorld means ~1-in-4 GUI tasks fail; long-horizon OSWorld 2.0 is ~21%; a CUA turn is minutes and screenshot-heavy even as artifacts. Budget/stall signals need CUA-specific calibration, and the orchestrator's steering philosophy (doc 05 §6) should bias hard toward "is there an API/MCP/CLI path?" before spawning a CUA worker.
- **Non-determinism weakens the ledger's replay guarantee for CUA.** A replayed screenshot loop may not reproduce; the environment isn't git-reproducible. The artifact registry stores what *was* seen, but CUA postmortems are best-effort, not deterministic replays — which is *exactly* why Rung 4 (distill to a deterministic skill) is the payoff, not an afterthought.

## Sources

- Voyager — [arXiv 2305.16291](https://arxiv.org/abs/2305.16291) · [HF paper page](https://huggingface.co/papers/2305.16291)
- Claude Agent Skills — [Anthropic engineering](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) · [Claude Code skills docs](https://code.claude.com/docs/en/skills)
- Claude Code Plugins & marketplaces — [plugins reference](https://code.claude.com/docs/en/plugins-reference) · [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- Official MCP Registry — [MCP blog (2025-09-08)](https://blog.modelcontextprotocol.io/posts/2025-09-08-mcp-registry-preview/) · [modelcontextprotocol/registry](https://github.com/modelcontextprotocol/registry)
- Code execution with MCP — [Anthropic engineering (2025-11-04)](https://www.anthropic.com/engineering/code-execution-with-mcp) · [Simon Willison](https://simonwillison.net/2025/Nov/4/code-execution-with-mcp/)
- Tool-making agents — [ToolMaker / "LLM Agents Making Agent Tools" (arXiv 2502.11705)](https://huggingface.co/papers/2502.11705) · [KatherLab/ToolMaker](https://github.com/KatherLab/ToolMaker)
- Skill induction from trajectories — [AWM budget study (arXiv 2606.15017)](https://arxiv.org/html/2606.15017) · [SKILL.md-mining for CUAs (arXiv 2606.20363)](https://arxiv.org/html/2606.20363v1) · [online skill learning (arXiv 2606.04391)](https://arxiv.org/html/2606.04391v1)
- Computer-use agents & benchmarks — [Computer-Use Agents 2026 matrix](https://www.digitalapplied.com/blog/computer-use-agents-2026-claude-openai-gemini-matrix) · [OSWorld results 2026](https://coasty.ai/blog/osworld-benchmark-results-2026-ai-computer-use-agents-ranked) · [browser-use benchmark](https://browser-use.com/posts/ai-browser-agent-benchmark) · [Browser Use vs Operator vs Claude](https://particula.tech/blog/browser-use-vs-operator-vs-claude-computer-use-web-agents)
- Skill security / supply-chain — [Cato: Weaponizing Claude Skills w/ MedusaLocker](https://www.catonetworks.com/blog/cato-ctrl-weaponizing-claude-skills-with-medusalocker/) · [Repello: audit any skill](https://repello.ai/blog/claude-code-skill-security) · [Reversec: Skill Issues](https://labs.reversec.com/posts/2026/05/skill-issues-compromising-claude-code-with-malicious-skills-agents-part-1) · [prompt-injection in skills/tools/protocols (arXiv 2601.17548)](https://arxiv.org/html/2601.17548v1)
- Computer-use injection — [OpenAI: injection may never be solved (CyberScoop)](https://cyberscoop.com/openai-chatgpt-atlas-prompt-injection-browser-agent-security-update-head-of-preparedness/) · [Unit 42: injection in the wild](https://unit42.paloaltonetworks.com/ai-agent-prompt-injection/) · [Wiz: agentic browser security year-end review](https://www.wiz.io/blog/agentic-browser-security-2025-year-end-review)

---

# Appendix: Design critique (workflow critic pass)

I have what I need. The docs give me the exact invariants the dossier leans on (I2/I6/I7, the "deliberately small" northbound surface, doc 08 §2's push-not-pull rule, doc 08 §4's multi-writer framing), and the web checks resolved which factual claims hold and which don't. Writing the critique.

## Design critique & sharpening for skills-computeruse

**Verdict up front.** This is the strongest plane-integration of any module I've reviewed here: the event-kind lane assignment (skill_* → priority, gui_step/dom_snapshot → bulk/coalescible) is *correct* against supervisor §4, the "screenshots are artifact refs by hash, never inlined" discipline is genuinely ACI-not-HCI, and the honesty about CUA economics and unsolved injection is calibrated, not performative. It also does not invent tool names — Voyager, ToolMaker, browser-use, Agent S2, OSWorld 2.0 all check out (see corrections for the citation numbers). But five load-bearing things are wrong or hand-waved, and two of them are in exactly the places the dossier claims are "clean by construction" or "verbatim reuse." Ordered by how much they should change the build.

---

### 1. Scoping — the MVP is mis-cut: Rung 0 reimplements harness-native behavior and proves the *least* baton-specific thing

The module's own thesis (bullet 1) is "reflexive capability growth is a **fleet** property, not a worker property." Rung 0 then explicitly has **no cross-worker sharing** — one worker authors a SKILL.md and *the same worker* re-invokes it later in the run. That is precisely what Claude Code Skills already do natively (SKILL.md in the worker's dir, re-read next turn), and the dossier's own "problem" section argues harness-native single-worker skills "solve nothing for a fleet." So Rung 0 as cut spends weeks of ceremony (draft/verify MCP round-trips) to reproduce a behavior the harness ships for free, and defers the one thing that justifies baton's existence (a *second* worker adopting the first's skill) to Rung 1.

**Re-cut the MVP to the smallest rung that proves the fleet thesis:** one worker authors → hub verifies+registers → a **different** worker (or the same worker in a fresh session/worktree) adopts it **at `verified`-confined tier**. Crucially, this is *less* machinery than the dossier's Rung 1, not more: `verified`-confined adoption is gated by the **sandbox** (doc 05 §5), so it does **not** need the I2 single-consumer reviewer/bless gate at all. Defer I2 and the `blessed` tier to a later rung and adopt confined-only until then. The dossier has the dependency backwards — it puts the expensive trust gate (I2) at R1 and the cheap-but-pointless self-loop at R0. Invert: cross-worker confined adoption first (proves reflexivity, reuses only the sandbox), bless/promote later (earns the human gate on demand).

**Cheaper, higher-hit-rate MVP object hiding in plain sight.** The dossier's skill model is code-shaped (Voyager). But the single most-rediscovered thing in a coding fleet is not code — it's a **verified environment fact / command recipe**: "the test command is `mise exec -- mix test`, not `mix test`"; "the build needs `NODE_OPTIONS=--max-old-space-size`." These are trivial to verify (run the command, capture exit/tail — this *is* literally I7's shape) and enormously reusable across workers on the same repo. A **command-recipe registry** is a strict, cheaper subset of the skill forge where the "code" is one command and the self-test *is* the command, and it's the honest 80% of fleet reflexivity. Ship that as R0; general code-skills as R1. This also sidesteps most of the trust surface (a recipe has a much smaller injection blast radius than an arbitrary Python wrapper).

---

### 2. Agent-ergonomic output — the *shapes* are good; the *interaction model* violates the dossier's own cited principle (this is the biggest single fix)

The SkillCard and VerifyReport JSON are genuinely decision-ready and token-bounded. But `skill_search` as a **worker mid-turn verb** is a human-tool-with-an-API-bolted-on, and it directly contradicts doc 08 §2, which the dossier itself cites: *"a worker mid-turn doesn't want a research briefing… Baton's downward context is push, addressed, minimal — not a query into a shared brain."* Making the worker (a) know the registry exists, (b) form a query, (c) read 8 cards, (d) pick, (e) adopt, (f) then use — mid-turn — is a similarity fan-out into a shared brain, the exact anti-pattern doc 08 §2 rejects, and it burns the scarcest resource (doc 05 §3: orchestrator/worker context).

**Fix — skill provisioning is a spawn-time push, not a worker pull:**
- The **hub/orchestrator** pre-selects verified skills relevant to the brief and **materializes only their SKILL.md descriptions** into the worker's skill dir *at spawn*. Progressive disclosure then works *natively* (the model passively sees one-liners; the body loads only on match) and the worker never spends a turn searching. This is "push, addressed, minimal" done right.
- `skill_search` becomes an **orchestrator-plane** verb (the conductor deciding what to provision), never a worker verb.
- Even better, and distinctively agent-native: **skill recommendation as a derived signal** (doc 05 §2), not a lookup. The hub already watches every worker's action stream for loop/stall/scope-drift. Add a matcher: when a worker's `action.command_exec`/`file_edit` signature matches a verified skill's intent, surface it as a **nudge at a tool boundary** ("verified skill `pdf-table-extract` matches what you're doing; adopt?"). Skill discovery moves from worker-pull to hub-push using the *same machinery as stall detection*. That is the reframe that makes this "agent-computer interaction."

This also collapses the **northbound-surface bloat** problem. Doc 04 calls the `fleet_*` surface "deliberately small" (9 verbs) and doc 05 §6 explicitly refuses new verbs that invite pathology (it kills `fleet_chat`). The dossier roughly *doubles* the surface with ~10 skill_*/cua_* verbs. Most of them (`skill_search/adopt/report`) are only worker-facing because of the pull model; kill the pull model and the **worker-facing surface drops to ~zero new verbs** (skills are pushed at spawn, invoked natively, observed as events, reported implicitly by the outcome the hub already sees). `skill_draft/publish/promote/deprecate` remain, cleanly, as orchestrator-plane verbs.

**Architectural ambiguity the dossier never resolves:** *who is the MCP client for the skill_* verbs?* Baton's hub is northbound-MCP to the **orchestrator**; workers are **southbound** of adapters. For a worker to call `skill_adopt`/`skill_report`, the hub must *also* be mounted as a worker-facing MCP server (via `mcpServers` at spawn) — a brand-new reversed surface that (a) costs worker context per call and (b) re-triggers the nested-approval regress of supervisor §5 (a worker's `skill_report` is itself a tool call that may need host approval). The dossier silently assumes this away. The push model above dissolves the problem; if you keep any worker-facing skill verb, you owe supervisor §5 an answer for it.

---

### 3. Three-plane integration — mostly real, but two wires are drawn and never connected

Genuinely integrated: new event kinds on the right lanes, long ops → DAG tasks, skill code → git artifacts with `Harness:` trailer, epistemic promotion at boundaries with temporal-coherence checks. Credit where due. Two gaps:

**(a) `skill_verify`/`cua_distill` are called "long ops → task-DAG" but the agent-ergonomic example shows `skill_verify(skill_id) -> VerifyReport` returning synchronously.** A sandbox self-test trivially exceeds `HOST_SAFE_MS` (I4, 25s), so a synchronous return is a spec violation. Make the signature honest: `skill_verify -> {task_id, status:working}`; the VerifyReport is the task's `result_ref`, surfaced via `fleet_wait`'s digest. And state the **resume semantics** you're asserting: skill verification is idempotent → interrupt = restart-from-scratch, fine, *say so*. `cua_distill` is **not** obviously idempotent (it consumes a trajectory range) — is it resumable or restart-only? Under-specified; pick one and write it down or you'll debug it forever.

**(b) Deprecation does not propagate to already-materialized copies — a cache-invalidation hole the dossier presents as a steering lever.** The §"control plane steers the forge" says `skill_deprecate` lets the orchestrator "supersede a bad version." But deprecation is a *registry-row* operation, and adoption *materialized a copy into the worker's filesystem*. If `w_codex_01` adopted `pdf-extract@1.2.0` and the hub then finds it malicious and deprecates it, **the materialized copy is still on disk and still invokes.** There is no revocation path. This is exactly the "visibility-ends-after-approval" failure the dossier *quotes Cato/Repello on* — and then reintroduces at the fleet layer. Fix, and it's the same fix that makes trust real: **the trust-tier check must be per-invocation against the *live* registry, not per-adoption against a cached copy.** The dossier already commits to "re-confine every invocation to the declared manifest" (the *sandbox profile* is re-applied each run) — extend that: on each `capability.skill_invoked`, the adapter also checks the live tier; a `deprecated`/quarantined skill is refused (or forced to `draft`-confined) at invocation. Adoption must be a **hub-registered lease** (hub knows worker→version) so deprecation can emit a `capability.skill_revoked` control event the adapter enforces. Without this, "deprecate" is theater.

---

### 4. Shared-state — "concurrency is clean by construction" is true for the easy question and false for the hard one

The dossier proves **write-concurrency** is clean: CAS on `(namespace, semver)`, immutable versions → no lost update, adoption read-only, win/loss as a ledger projection. All correct, and nicely done. But it then *implies* it has solved shared-state consistency, and it hasn't touched the hard question doc 08 §4 actually flags (multi-writer semantic consistency). Four concrete holes:

- **Staleness under diverging worktrees (the central omission).** A skill is code that runs against a repo/worktree. The high-value fleet skills are *repo-specific* ("run our test suite," "regenerate the protobufs"), and those are exactly the ones whose validity is **scoped to a repo state**. `verified` means "passed in the *author's* worktree at commit X." It says nothing about validity in `w_codex_01`'s worktree at commit Y (diverged, or a different repo). A repo-bound skill adopted into a divergent worktree silently does the wrong thing. The registry has immutable versions but **no applicability scope.** Fix: skills carry a machine-checkable **applicability manifest** `{repo, commit_range?, path_preconditions[], env_preconditions[]}`, split explicitly into **portable** (context-free, e.g. pdf-extract) vs **repo-bound**; `skill_adopt` runs a *cheap precondition check* (not a full re-verify) against the adopter's worktree and refuses/warns on miss. This is the shared-state consistency story the dossier is missing, and it's buildable.
- **The win/loss counter is confounded and cannot self-correct.** Aggregated across worktrees, a skill that works in repo A and fails in repo B reads as ~50% — neither adopted nor deprecated correctly. **Partition the counter by applicability class / repo-shape.** And add **recency/commit-window weighting**: a skill that was 95% at commit X keeps getting recommended after the repo evolves and silently breaks it at X+500. Cumulative win-rate has no rot detection; rank on a decaying, commit-windowed rate.
- **Multi-writer accretion (the problem doc 08 §4 says PM never had to solve).** Two workers concurrently discover "extract PDF tables," pick different names, and the registry now holds near-duplicate skills; retrieval surfaces three variants of one capability; win/loss splinters across them. Namespace-CAS only prevents *same-name-same-semver* collisions, not *semantic* duplicates. Add **draft-time near-duplicate detection** (embedding match against existing verified skills → "a skill for this intent exists: `…/pdf-table-extract@1.2.0`; extend or supersede?"). Without canonicalization the registry rots into a junk drawer at fleet tempo.
- **`harness_compat` is an author claim on shared state — hub-verify it.** The dossier takes `harness_compat:[codex,claude,glm]` as an author-declared field in `skill_draft`. Per the module's own "no worker self-report" discipline (I7), compat must be **hub-verified per harness** (run the self-test under each target harness's sandbox), because the code-wrapper runtime and `allowed-tools` semantics differ across harnesses. Make it a hub-attested matrix, not a declaration.

---

### 5. The "I7 reuse is verbatim" claim quietly imports a trust assumption that doesn't hold — and the VerifyReport leaks an attacker-controlled number as an attestation

This is the sharpest correction. The dossier says the trust story "reuses baton's authorization boundary **verbatim**" and that `skill_verify` is "hub-run verification (supervisor **I7**)." **It is not verbatim, and the difference is the whole ballgame.** I7's guarantee — *the hub re-executes and only hub-observed output is authoritative* — transfers fine. What does **not** transfer is I7's *implicit assumption that the verification spec is trustworthy*: in I7 the verification command comes from the **brief** (orchestrator-authored, trusted). In `skill_verify` the `self_test` comes from the **skill author** — a possibly prompt-injected worker. So `verified` attests only "**the author's own test passed under hub-observed sandbox confinement**," which is strictly weaker than "this skill does what it claims." A malicious skill ships a trivially-passing self-test; the sandbox still confines it (good — the *boundary* holds), but the **signal** is compromised.

And the signal leaks into the agent-ergonomic output: the SkillCard's `verify: pass(12/12)` and the VerifyReport's `self_test: {exit:0, cases:"12/12"}` are **author-controlled numbers presented as hub attestations** to an adopting worker's ranking decision. Fix by splitting the report into **hub-attested facts** (`egress_attempts:0`, `writes_outside_manifest:0`, resource envelope — these *are* trustworthy, the hub observed them) vs **author-declared** (`self_test` count/pass — the hub only attests it *ran the author's test and it exited 0*, not that the test is meaningful). Rank and gate on the hub-attested facts; render the self-test as `author_declared`. This is the honest version, and it's the same shape as the "math-proof / autoformalization" trap the critique brief warns about — the dossier mostly *avoids* that trap elsewhere (it correctly says "verification proves the self-test passes, not that the skill is correct"), but this one field re-opens it. Credit: the dossier does *not* over-claim verification=correctness in prose; it just under-labels one JSON field.

**The isolation primitive the entire trust story rests on is never named.** Doc 05 §5 makes "the OS sandbox is the boundary" the load-bearing claim, and this module leans on it 100% — yet "throwaway sandbox with egress monitoring" is left abstract. The worker sandbox (`permissionMode`/`sandboxPolicy`) confines *the LLM's* tool calls; it is *not* self-evidently sufficient for running arbitrary attacker-authored skill self-tests, and the hub is not a Codex/Claude process, so it has no such sandbox for free. Name the primitive. The concrete, current answer (and a reusable one): **Codex CLI already ships exactly this** — bubblewrap + seccomp (with Landlock fallback) on Linux, Seatbelt/`sandbox-exec` on macOS, and its `sbx` CLI / Docker-microVM path for stronger isolation, with a `restricted-network` mode that denies all socket families except `AF_UNIX` (seccomp is inherited across fork/exec under `NO_NEW_PRIVS`, so a spawned self-test inherits the egress denial). The verification sandbox should be a named tier — bubblewrap+seccomp for cheap, a Firecracker/gVisor microVM (e2b/Modal/Daytona-style, or Codex's own `sbx`) for untrusted skills — not an adjective.

---

### 6. What it missed, and the one distinctively agent-native move

**Missed / mis-stated tools & facts:**
- **AWM citation is wrong.** The dossier links AWM to `arXiv 2606.15017` ("AWM budget study"). Canonical **Agent Workflow Memory is arXiv 2409.07429** (Wang, Mao, Fried, Neubig, Sept 2024). Cite the primary; the 2606 paper, if real, is a follow-on, not AWM.
- **The SKILL.md interop claim is actually *stronger* than the dossier argues, but for a different reason.** The dossier hedges "a baton skill is a valid Claude skill" and lists Codex under `harness_compat` as if by luck. In fact **Anthropic open-sourced the Agent Skills spec (Dec 2025) and OpenAI adopted SKILL.md for Codex CLI and ChatGPT** — it's a cross-agent standard. So lean in: the *format* is portable. But the *discovery mechanism* is not uniform (Codex's project context is `AGENTS.md`; SKILL.md discovery differs), and translation tooling exists in the wild (`claude-code-skill-factory`, `convert.sh`). The portable part is the **code wrapper invoked via `command_exec`**; the discovery/progressive-disclosure layer is adapter-emulated per harness. State that split.
- **Sandbox/isolation vendors** (§5): Firecracker, gVisor, bubblewrap, Landlock, e2b, Modal, Daytona, Codex `sbx` — none named, and the boundary is the whole security argument.
- **Retrieval at scale**: pure embedding-similarity (Voyager) is weak once the registry has hundreds of skills; the current best practice is hard **pre-filter (harness_compat × trust-tier × worktree-applicability) then rank** — which is also the push-model from §2.

**Correct-and-verified (don't touch these):** OSWorld 2.0 is real (**arXiv 2606.29537**, 108 tasks, ~1.6 human-hr median) and the **20.6% top score** (Claude Opus 4.8, 500 steps) is accurate; the OSWorld 1.0 trajectory (Agent S2 72.6% first past the 72.36% human baseline, Dec '25; Sonnet 4.6 72.5%, Feb '26) checks out; browser-use's WebVoyager/stars are in the right range. The benchmark honesty is a strength — keep it.

**One distinctively agent-native move (beyond porting a human skill library): make the capability plane *self-healing* by closing the win/loss ledger back into re-verification.** A human skill library is authored-then-used and rots silently. Baton has something no human library has: a live outcome ledger. Wire it: when a skill's *field* win-rate (partitioned per §4, commit-windowed) drops below its *verified* baseline by a threshold, the hub **auto-opens a re-verification task in the DAG** (skill-rot detection). If it fails, **auto-deprecate + auto-open a distill/repair task** — and this is exactly where the CUA↔skill capstone (Rung 4) earns its keep as a *repair* mechanism, not a one-shot: a broken deterministic skill falls back to a CUA worker that re-derives it. That is "capability that maintains itself from usage telemetry," which is only possible because the three planes are wired — the epistemic layer's `Contradicts` edge (win-rate contradicts verify-report) *is* the trigger. Ship it as the thing that distinguishes this from "we installed a skills folder."

**One CUA-capstone sharpening (Rung 4) the dossier lumps together:** it says distillation yields "a Playwright/browser-use script **or** a discovered API call" as if equivalent. They have opposite durability. A **selector-replay** script is *as brittle as the DOM it recorded* — the next site redesign silently breaks a `blessed` skill, which is worse than the adaptive CUA loop it replaced. A **discovered API call** (SkillWeaver-style) is durable. So: **prefer API-discovery distillation; treat selector-replay as a short-lived cache with mandatory precondition guards and an embedded CUA-fallback on selector-miss.** This permanently couples R4 back to R3 (a distilled GUI skill must be able to re-invoke CUA when its selectors miss) — which is fine, but the dossier frames R4 as "the fleet *stops* repeating flaky GUI work," and the honest framing is "the fleet *caches* it, with a self-healing fallback." Fold the selector-replay skills into the §6 auto-re-verify loop and the brittleness becomes a managed cost instead of a landmine.

---

**Net:** the module is real and mostly buildable, but ship it as (R0) a hub-verified **command-recipe** registry with cross-worker confined adoption via **spawn-time push** (no worker-facing search verb, no I2 yet), (R1) general code-skills + applicability manifests + near-dup detection + the split hub-attested/author-declared VerifyReport, (R2) the self-healing win/loss→re-verify loop and bless/deprecate with **per-invocation live-tier checks**, and (R3/R4) CUA + API-preferring distillation with CUA-fallback. Correct the AWM citation, name the isolation primitive, and stop calling the I7 reuse "verbatim" — it's an analogy that flips the verification spec's provenance from trusted to untrusted, and the design has to earn that difference rather than assert it away.
