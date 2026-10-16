# artifacts cluster — steering verdicts

Read all 7 capability docs (full, incl. their critique appendices), plus `prototype/README.md`, `CRITIQUE.md`, and `src/*.ts` + `demo.mjs`. Doc 19 read first as the authority.

The through-line: the 7 capability docs are, by doc 19's own table, **support** ("tools the driver hands its workers"). Most position themselves correctly as support and do NOT invert — their real problem is a wall of self-referential codenames, exactly the jargon the user is tired of. The **prototype** is where the inversion actually lives: its prose, and several code comments, still call the Referee "baton's real value" and gate the whole product on a verification-vs-fleet eval.

---

### docs/capabilities/causal-research-bok.md
- **Steering**: ON-TRACK (hierarchy) / DRIFTING (execution)
- **Residual inversion / drift**: No demotion of the driver — it's explicitly opt-in support ("most fleets should stop at the near-free run scorecard"), which is the right altitude. Drift is that a 30KB dossier for a feature "most fleets should skip" never once mentions *driving* a fleet; it lives entirely in "the hub"/"the fleet" abstraction. Also carries raw model cruft: line 1 is leftover preamble ("I now have everything…") and lines 202-207 are a truncated appendix stub ("The user references docs. Let me read them…"). Cut both.
- **Jargon**: "Cairn / BoK" → "shared run history"; "bi-temporal causal shadow-graph" → "a record of what happened and when we learned it"; "epistemic plane" → "the memory layer".
- **Soundness for the driver**: Fine as memory support; correctly pull-only and export-only so it can't silently re-poison a run. Not the driver's job to carry messaging/telemetry.
- **One improvement**: Open with one sentence tying it to the driver ("this is how the orchestrator remembers which worker is good at what, and how you replay what the fleet did") and delete the preamble/appendix cruft.

### docs/capabilities/coordination-repl.md
- **Steering**: ON-TRACK (hierarchy) / DRIFTING (jargon)
- **Residual inversion / drift**: None that demotes the driver — it's a worker-coordination tool and says so. Its own critique appendix is excellent and already flags the real gaps (worker can't poll mid-turn, diverging-worktree "facts" are staleness traps). Drift is scope: two whole subsystems (Board + Bench) proposed before the driver they support exists.
- **Jargon**: "Scratch / the Board / the Bench" → "shared scratchpad" and "shared sandbox"; "stigmergic" → "coordinate by leaving marks others notice"; "tuple-space, per-cell-type consistency" → "a few typed slots, each with its own update rule".
- **Soundness for the driver**: The advisory-claim / lease-slaved-to-worker-lease design is sound. The critique's point stands: as scoped, the MVP is a board the orchestrator can *watch* but that doesn't yet *coordinate workers*.
- **One improvement**: Adopt its own appendix's §6 fix — make coordination a side-channel on tools the worker already calls, not a new verb it must remember to poll.

### docs/capabilities/debug-interp.md
- **Steering**: ON-TRACK (hierarchy) / DRIFTING (conformance)
- **Residual inversion / drift**: No driver demotion. The tie to the driver is actually good ("the control plane *detects* pathology; nothing *diagnoses* it — Vantage is the missing half"). Drift: the appendix's own headline finding — it "invents a second framework instead of being a module of the first" and its flagship output can't be produced at the MVP rung it's attached to.
- **Jargon**: "Vantage" → "the debug module"; "CausalObservation" → "a structured 'why it failed' object"; "DAP-driven … fork-per-reader replay" → keep DAP (it's a real standard) but gloss "one recording, many readers".
- **Soundness for the driver**: Strong instinct — recording the hub's re-run verification failure "for free" directly serves the driver's trust step. Missing nothing for messaging/telemetry (not its lane).
- **One improvement**: Re-cut the MVP to the "postmortem digest, no live session" rung its own critique identifies — that delivers the value without the expensive live-debugger control machinery.

### docs/capabilities/discovery-search.md
- **Steering**: ON-TRACK
- **Residual inversion / drift**: None on the driver goal — and it earns points by making search a *steering* surface (`code_seed`: orchestrator pushes attention to a worker), which is squarely in the driver's wheelhouse. Drift is conformance-to-spec (its appendix: doesn't implement the capability-plane envelope/`reverify`) not goal-inversion.
- **Jargon**: "atlas" → "the shared code index"; "base ⊕ per-worker overlay / COW-LSM query model" → "index the shared commit once, add each worker's diff on top"; "frecency" is real jargon but standard — leave with a two-word gloss.
- **Soundness for the driver**: The base+overlay idea is the right core and directly respects worker isolation. Nothing missing for the driver's named features.
- **One improvement**: Lead with the steering framing (search as an orchestrator attention-lever) rather than the index internals — that's what makes it a driver feature not a library.

### docs/capabilities/math-proof.md
- **Steering**: DRIFTING (borderline over-billing)
- **Residual inversion / drift**: Closest of the capability docs to inversion. It correctly says "the module does not decide policy, it executes and attests" (support) — but inflates with "**This is the crown-jewel realization of I7**" and frames validation as *the* merge gate. It doesn't call verification "the product," so not fully INVERTED, but the grandeur over-bills one support element. (Its own appendix also debunks the crown-jewel claim as technically false without an axiom audit, and notes the MVP is redundant with the supervisor invariant that already ships.)
- **Jargon**: "anvil / where a claim gets hammered into a hub-re-checkable attestation" → "the proof-checking module"; "proof-carrying validation / forgeability not pass/fail" → "the worker can't fake a passing check because the hub re-checks it"; "auto-active / autoformalization" → gloss "turning an English spec into a machine-checkable one (the weak link)".
- **Soundness for the driver**: The real, correct idea is small and driver-serving: give the driver a rigor *dial* per task so "done" means what the task's stakes require. The seven-rung tool zoo is far beyond anything the driver needs first.
- **One improvement**: Demote the "crown-jewel" language; reframe as "the driver's trust dial" and lead with the two rungs (mutation test + one z3 check) that actually aren't redundant with the supervisor.

### docs/capabilities/orientation-reuse.md
- **Steering**: ON-TRACK (best driver-connection of the set)
- **Residual inversion / drift**: None. Explicitly: "baton's whole thesis is control-plane steering; orientation is the highest-leverage thing to steer." `fleet_orient_worker` re-narrows a drifting worker mid-task — a concrete steering primitive. This is what "support that serves the driver" should read like.
- **Jargon**: Worst-named in the cluster — TWO cutesy codenames for ONE module. "Cartographer / Quartermaster" → "the repo-map side" and "the dependency-vetting side"; "reachability gating" → "only flag vulnerabilities the code actually calls".
- **Soundness for the driver**: Solid. Ties dependency-vetting and orientation to real fleet failure modes (N workers each re-orienting; unvetted `npm install`s across workers). Advisory-not-authorization boundary is correct.
- **One improvement**: Drop the two-codename conceit entirely; call it the orientation module and the reuse module. The metaphor adds nothing and is exactly the self-referential naming the user dislikes.

### docs/capabilities/skills-computeruse.md
- **Steering**: ON-TRACK
- **Residual inversion / drift**: No driver demotion — computer-use is honestly slotted as "the flaky tier … exists so the fleet's reach is total, not so it's good," and skills/CUA ride the same steer/interrupt/approve verbs. Drift (per its own strong appendix): the MVP reimplements harness-native single-worker behavior and defers the one fleet-specific thing (a *second* worker adopting the first's skill).
- **Jargon**: "Skill Forge" → "shared skill library"; "reflexive capability growth" → "the fleet gets more capable as it works"; "the capstone bridge / distill a CUA trajectory" → "turn a successful click-through into a reusable script".
- **Soundness for the driver**: Good — the "screenshots are refs, orchestrator gets a digest not pixels" discipline is real driver hygiene. The appendix's catch is important: `skill_verify` reuses I7 machinery but NOT its trust assumption (the test now comes from a possibly-injected worker, not the trusted brief) — don't call it "verbatim I7."
- **One improvement**: Re-cut MVP to cross-worker *confined* adoption via spawn-time push (proves the fleet thesis, needs only the sandbox), and ship a command-recipe registry ("the test cmd is `mise exec -- mix test`") before general code-skills.

### prototype/README.md
- **Steering**: INVERTED
- **Residual inversion / drift**: The clearest surviving inversion in the cluster. "**The durable value is the Referee** … This is the un-vendorable, ToS-clean, bitter-lesson-proof core." And it demotes the product: "**Not the Conductor's steering machinery.** turn/steer, two-phase interrupt … the *Conductor branch earned by the eval*, not the MVP." And the go/no-go doc 19 stood down: "the next unit of value … is running `eval.ts` … to get the number that decides whether anything above this should exist."
- **Jargon**: "Referee / Conductor" → "the re-checker" / "the fleet driver"; "bitter-lesson-proof, un-vendorable core" → drop entirely (it's moat/institution talk); "honest MVP" → just say what it is.
- **Soundness for the driver**: The skeleton (dispatch + concurrency + DAG + trust gate) is real and useful, but the README itself admits the actual product surface — messaging, telemetry, interrupt/steer — is absent and deferred behind an eval. Per doc 19 those are the *next* build, not an optional branch.
- **One improvement**: Rewrite the framing: "this is the fleet-driver skeleton (spawn workers, run them in parallel, trust their results); next we add messaging, a live feed, and interrupt/steer" — and delete the eval-gates-everything paragraph.

### prototype/CRITIQUE.md
- **Steering**: DRIFTING
- **Residual inversion / drift**: Inherits the Referee-centric framing ("The durable value is the Referee") but its substance actually *defends the driver*: finding F1 says "the one thing a fleet exists to do — run workers in parallel — is absent" and fixes it. So the engineering pulls toward the driver even while the prose header points the other way.
- **Jargon**: "Referee", "self-sandboxed", "I7 discipline turned on my own code" → "re-check the evidence instead of trusting the claim".
- **Soundness for the driver**: This is the most technically honest file in the cluster — it caught that the "concurrent fleet" was sequential, the sandbox wasn't fresh, the fleet wasn't actually multi-vendor. All directly load-bearing for real fleet-driving.
- **One improvement**: Re-label the two "durable value = Referee" references as "the driver's trust step" so the honesty isn't wrapped in the inverted headline.

### prototype/src/orchestrator.ts
- **Steering**: DRIFTING
- **Residual inversion / drift**: Code is the driver skeleton (async concurrent dispatch, per-harness ceilings, DAG ready-work) — pro-driver. Comment demotes the product: "Steering/interruption are the Conductor branch, built out only if the eval justifies it." That "only if the eval justifies it" is the inverted gate.
- **Jargon**: In-code "Referee", "Conductor branch", "trust gate" — fine as code comments but rename Conductor→driver for consistency with the corrected north star.
- **Soundness for the driver**: The genuinely concurrent semaphore-bounded dispatch is exactly right and is the driver's core loop. Missing: any interrupt/steer/message hook — there's no seam where the orchestrator could interrupt an in-flight `adapter.run`. That seam is the product and isn't stubbed.
- **One improvement**: Add an interruption seam (cancellable `adapter.run` / abort signal) even if unimplemented, so the file shows the driver's named feature has a home, not "someday if the eval says so."

### prototype/src/referee.ts
- **Steering**: INVERTED (framing) / sound (code)
- **Residual inversion / drift**: Header comment: "This is the ~50 lines that carry **most of baton's real, un-vendorable value**." That's the doc-19-retired claim, in code — verification billed as baton's core value rather than as the driver's trust feature.
- **Jargon**: "Referee", "un-vendorable value", "ToS-clean" → "the re-checker; re-runs the check the worker claims to have passed."
- **Soundness for the driver**: The mechanism (re-run the pinned command in a fresh sandbox built from committed artifacts, ignore worker prose) is correct and is a legitimate, valuable trust feature *of* the driver. No technical problem — only the over-billing comment.
- **One improvement**: Change the header to "the driver's trust step — how it knows a worker's 'done' is real before merging/rerouting," dropping "most of baton's real value."

### prototype/src/eval.ts
- **Steering**: INVERTED
- **Residual inversion / drift**: The whole file encodes the go/no-go doc 19 explicitly stands down: "Everything above the control/verification plane gates on ONE number," and the HALT verdict literally reads "do NOT build above the control/verification plane." It treats the verification plane as the base every driver feature must justify itself against — the inverted hierarchy in executable form.
- **Jargon**: "pre-registered metric / pivot criterion", "soloist vs fleet arm", "hub_verified_pass_rate" → "does a mixed-vendor fleet actually beat one strong agent, measured by checks the hub re-ran."
- **Soundness for the driver**: A solo-vs-fleet measurement is a *fine optional de-risking* of one support feature (verification), exactly as doc 19 says. The defect is scope: it's framed as a gate on the entire product.
- **One improvement**: Demote it from "the actual first deliverable" to "an optional check on whether cross-vendor verification pays off," and delete the "do NOT build above the plane" HALT language.

### prototype/demo.mjs
- **Steering**: DRIFTING
- **Residual inversion / drift**: More balanced than the other prototype files — it actually *demonstrates the driver* (parallel workers, ceiling=1 GLM serializing vs ceiling=4 parallelizing, DAG locking). But the closing narration is Referee-centric: "Every status came from the Referee … worker prose is non-authoritative (I7)."
- **Jargon**: "Referee", "trust gate", "non-authoritative (I7)" → "the hub re-checks each result before trusting it."
- **Soundness for the driver**: Good demo of the dispatch/concurrency core. Gap: it shows no telemetry feed, no interrupt, no message — so a viewer sees the trust gate and scheduling but not the product's headline features.
- **One improvement**: Add a couple of lines showing a live event feed and an interrupt of an in-flight worker, so the demo showcases the driver's named features, not just verification + scheduling.

---

**Cluster summary**: The 7 capability docs are steered right on the hierarchy — they read as support tools for the driver (orientation-reuse and discovery-search even wire themselves to steering) — but they're buried under cutesy codenames (Cairn, Scratch, Vantage, atlas, anvil, Cartographer/Quartermaster) that are precisely the jargon the user dislikes. The live inversion is concentrated in the **prototype**: README, referee.ts, and eval.ts still call verification "baton's real value" and gate the whole product on a verification-vs-fleet number, while the actual named product surface — messaging, telemetry, interrupt/steer — is explicitly deferred as an "optional Conductor branch." **Top fix**: re-flag the prototype (README + referee.ts header + eval.ts) so verification is described as the driver's *trust step*, not its core value, and put messaging/telemetry/interrupt on the build path as the next increment rather than behind an eval — then strip the codenames from the capability docs.