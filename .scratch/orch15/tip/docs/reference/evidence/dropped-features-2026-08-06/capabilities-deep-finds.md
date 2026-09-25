# Capabilities deep-finds — dropped features in the capability plane that still pay

*Hunt conducted 2026-08-06 against the effective tree. Corpus: `docs/capabilities/**` (7 module
dossiers) + `docs/reference/capability-atlas-2026-08-03/{design-corpus,shipped-surface,spec-history}.md`
+ `docs/28-exhaustive-capability-audit.md` + `docs/PROGRESS.md`. Landed-ness cross-checked by
vocabulary grep against `impl/src` (command transcript in the appendix).*

## 0. Headline

The through-line of every real find here is the **"rigorous, unreached-for" verdict**. The 2026-08-03
downstream worker review rated the capability plane **2/5**, and its two loudest specific complaints
were (a) **knowledge poverty 2/5** — "I re-derive the entire world on every task" — and (b)
**ATLAS/context-program 2/5** — rigorous, unreached-for. The BD3 spine (worker read port
`context.read`, context packages `mintContextPack`, message lane `message.send`, attention inbox)
landed *immediately after* that review, in the same arc that filed #78 (board worker-half, now
24/24 green). That is the pivot: **the machinery these dropped features needed to reach the worker
did not exist when they were designed, and it exists now.** Every recommendation below is a feature
that was designed in detail, never built (or built only as substrate), and is now cheap because the
delivery surface it was missing has since landed.

## 1. Finds table

| # | Find | WHAT (designed) | WHY dropped (best evidence) | WOULD GIVE today | SIZE |
|---|---|---|---|---|---|
| **A** | **Command-recipe registry** | Skill Forge R0 re-cut (skills-computeruse.md §1): a curated, repo-scoped map of command knowledge — "the test command is `mise exec -- mix test`, not `mix test`" | Skill Forge module never started (docs/28:543 "Skill Forge/computer use … pending"); `recipes.mjs` landed as **workflow-composition** recipes (RC-A, R-DC-6), a different animal — nothing captures per-repo command knowledge | Workers stop rediscovering test/lint/build incantations every task — the #1 knowledge-poverty leak; rides `recipes.mjs` data-discipline + BD3 read port + orientation push | **small** |
| **B** | **Failed-verification postmortem digest** | Vantage MVP re-cut (debug-interp.md §C): a postmortem digest with **no live session** — capture exception + traceback + locals on a failed verification and hand it to the worker | Vantage module entirely unbuilt (docs/28:543); the live-DAP design was judged over-ambitious (rr/dataflow, exclusive live lease) and the whole module was shelved rather than re-cut to the cheap rung | Turns the trust gate's reject from a dead-end ("[verifier produced no diagnostic output]") into actionable data; rides the landed message lane + `verifier-diagnostics.mjs` hook + `referee.mjs` | **small** |
| **C** | **Atlas fleet discovery verb surface** | discovery-search.md's whole surface: `code_grep`/`code_find_files`/`code_symbol`/`code_semantic`/`code_index_status` over a base⊕overlay shared index with staleness honesty | Phase 13 landed the **index substrate** (`atlas-index.mjs` epochs + worktree overlay) but the fleet-facing verbs never got surfaces; effort pivoted to the representation ladder (R1–R7, extensively landed). `code_context_pack` was silently superseded by BD3 `mintContextPack` | Directly answers "ATLAS 2/5 rigorous, unreached-for": fleet-shared symbol/grep queries on the already-landed epoch+overlay index, delivered through `context.read`; no new index machinery | **medium** |
| **D** | **Side-channel board surfacing** | coordination-repl.md §6: make Board participation a **side-channel on tools the worker already calls** — hub injects "w1 holds claim path:payments/**" into the Edit tool result | The tuple-space itself was correctly cut (critique deleted `scratch_watch`/`scratch_heartbeat`); what landed instead was the REFLEX-2 board (#78, now green) — but the **injection** step is unbuilt | Answers "boards 2/5": claim/lease state reaches the worker without a new verb surface, on the exact tools it already invokes | **small–medium** |
| **E** | **Quartermaster authority-bearing composition** | orientation-reuse.md pending ledger: `fleet_reuse`/`fleet_provenance` **composite** surfaces + positive clearance as its own non-resurrection transaction | Never built; explicitly the last entry of the authoritative pending ledger (docs/28:466-467). The evidence floor landed (phases 36–43); the composition capstone did not | One call answers "is this code vetted + decided for this repo?" instead of multi-call archaeology; binds the landed `decideReuse`/`recheckReuseDecision` into the landed Goal/Plan approval surface (phase 62) | **medium** |
| **F** | **Fleet-wide counterexample regression corpus** | math-proof.md §7: a fleet-wide content-addressed corpus of counterexamples keyed by code region, so a fixed failure never regresses | Cairn landed a `Counterexample` **node type** (phase 49 promotion taxonomy) but not the keyed-by-code-region regression corpus; the evidence-ladder module itself is ceiling-gated at R3 (phase 24) | Composes the landed KG + phase-53 contradiction workspace into a regression net for the code the fleet actually touches | **medium** |

## 2. Per-find details

### A. Command-recipe registry (Skill Forge R0 re-cut) — **small**

**WHAT.** `skills-computeruse.md`'s critique appendix (§1, "Rung 0 mis-cut") re-cut Skill Forge's MVP
away from draft/verify/publish skill-objects to the thing a coding fleet re-discovers most: **a
registry of repo-specific command invocations** — `{ command_name → argv + working_dir + env
preconditions }`, e.g. `test` → `mise exec -- mix test`, `build` → `mise exec -- mix compile`. The
module design's full `skill_draft/verify/publish/search/adopt/report/promote/deprecate` + `cua_*`
surface was judged too heavy for the first rung; the registry was the cheap high-hit-rate replacement.

**WHY DROPPED.** Skill Forge as a module is unbuilt — docs/28:543-544 lists "Skill Forge/computer
use … remain pending", and the grep cross-check finds **zero** `skill_*` or `cua_*` vocabulary in
`impl/src`. What *did* land — `recipes.mjs` (RC-A, "dynamic workflow composition — recipes,
invocation manifests (v2)") — is **workflow-composition** recipes: `baton.recipes.run(recipe, …)`
with a closed data schema (R-DC-6: "recipes are DATA, not code"). It is the orchestrator's recipe for
*a wave*, not the fleet's recipe for *a command*. Nothing in the tree captures "how you run the tests
in this repo." The re-cut recommendation was never acted on.

**WOULD GIVE.** Every worker on every task re-derives the test/build/lint invocation (the exact
knowledge-poverty failure: "I re-derive the entire world on every task"). A command-recipe registry
is a tiny **data** surface — one repo-scoped manifest, curated once by the orchestrator, served
through the machinery that now exists:
- `recipes.mjs`'s data discipline (closed schema, no-function values, content-addressed identity) is
  the perfect precedent to copy — the registry is "recipes, but for commands";
- the BD3 read port (`context.read` / `recordContextRead`, coordination-store.mjs:13252) is the
  delivery lane the design lacked — the worker asks, the hub answers with the recipe;
- the landed orientation push (`code.seed` / `repo.map` / `orientWorker`, phases 32/33) can pre-seed
  the recipes at spawn instead of waiting for the read;
- the wave driver's steering vocabulary gives the hub a natural place to attach `{recipe, applied}`.

**SIZE: small.** One manifest schema (reuse recipes.mjs's closed-schema/`assertClosed` machinery), one
read-port op or a pre-seeded orientation field, one orchestrator-side curation verb. No worker-facing
skill lifecycle, no verification-of-skills, no CUA. The full Skill Forge module stays unbuilt —
correctly, until there is a fleet of skills to vet.

---

### B. Failed-verification postmortem digest (Vantage MVP re-cut) — **small**

**WHAT.** `debug-interp.md`'s critique (§C) re-cut Vantage (DAP debugging) from a live-session debugger
to a **postmortem digest with no live session**: when the hub's pinned verification fails, capture the
exception + traceback + sanitized locals from the failing run, attach them to the reject record, and
deliver them to the worker that produced the candidate. `docs/28:540` still carries the phrase
verbatim as a pending trust-ramp item: "**structured reject postmortems**."

**WHY DROPPED.** Vantage is one of the two "entirely unbuilt" modules (docs/28:543). The full design —
`dbg_record/dbg_open/dbg_observe/dbg_bisect/dbg_diff/dbg_slice/dbg_profile/dbg_explain`,
`CausalObservation` units, live leases, fork-per-reader replay — was judged over-ambitious (the
critique: dataflow needs rr; recordings are fossils of code-state). The whole module was shelved
rather than re-cut to the one cheap rung. Grep confirms **zero** `dbg_*` / `CausalObservation` /
`debugpy` vocabulary anywhere in `impl/src`. `run.debug` (issue #53) landed, but it is the **operator's**
run-introspection surface (messages/receipts/failure-causes on a Run), not a worker-facing
failed-verification postmortem.

**WOULD GIVE.** Today the trust gate rejects a candidate and the worker gets `verifier-diagnostics.mjs`
output that, when empty, is literally summarized as *"[verifier produced no diagnostic output]"*
(verifier-diagnostics.mjs:71,106). The single most expensive loop in the fleet — a failed pinned
verification — hands the worker the least information. A postmortem digest changes the loop:
- `referee.mjs` already runs the tests (and the mutation probe) — it *has* the failure in hand at the
  moment it decides `rejected`;
- `verifier-diagnostics.mjs` is the exact existing sanitization hook (digests-only honesty is already
  its design — it strips raw tails, so the postmortem rides a sanctioned pipeline);
- the BD3 message lane (`message.send`/MESSAGE_SEND, #86/#92) and context packages (`mintContextPack`,
  coordination-store.mjs:13157) are the delivery surfaces the design lacked;
- I7 hub-observed verification remains authoritative — the postmortem is *evidence attached to the
  reject*, not a new verdict channel, so no invariant is touched.

**SIZE: small.** One capture module (exception + traceback + sanitized locals from the failing
sandbox, byte-bounded), one field on the reject receipt, one read-port/message-lane projection. No
live session, no lease, no DAP. This is the highest-leverage small change in the hunt.

---

### C. Atlas fleet discovery verb surface — **medium**

**WHAT.** `discovery-search.md`'s whole design was the fleet-facing code-discovery service:
`code_grep` / `code_find_files` / `code_ast` / `code_symbol` / `code_semantic` / `code_context_pack` /
`code_index_status` / `code_seed`, over a **base⊕overlay shared index** (immutable base content-addressed
by Merkle root, per-worker dirty overlay), with staleness honesty (`fresh | lagging | base_only`),
epoch-pinned cursors, cold-start single-flight, and shard GC. The critique appendix's signature
addition was the **absence cache** — cache proven-zero greps keyed by base epoch so a worker never
re-scans the tree for a query the fleet already proved empty.

**WHY DROPPED.** Phase 13 landed the *substrate* — `atlas-index.mjs` with epochs and the worktree
overlay (`overlay(base, worktreeRoot, …)`, atlas-index.mjs:170-185), phase 32 landed `code.seed` /
`repo.map` / `orientation.slice`, and the BD3 spine landed `mintContextPack` (the `code_context_pack`
idea under the context-package name). But the **verb surface** — the thing a worker would actually
call — is absent: grep returns **zero** for every `code_*` verb in `impl/src`. The effort went into the
representation ladder instead (R1 structural delta, R2 SCIP, R3 CPG/delta/taint, R5 behavioral, R6
merge, R7 e-graph Decision), which is now extensively landed and attested (phase 46/61). The discovery
verbs were silently superseded — the index exists, the reach never happened. The downstream verdict
named this precisely: "ATLAS/context-program 2/5 — rigorous, unreached-for."

**WOULD GIVE.** The "rigorous, unreached-for" gap closed:
- workers get `code_symbol` (where is X defined) and repo-scoped `code_grep` served **by the hub** from
  the already-landed epoch+overlay index, with the staleness honesty the design insisted on (`base_only`
  when the overlay is stale), delivered through `context.read` (recordContextRead,
  coordination-store.mjs:13252) — the read port the design predates;
- per-worker dirty overlays already exist in `atlas-index.mjs`, so the "dirty files" re-cut the critique
  recommended over tombstones is already half-built;
- the **absence cache** is a genuinely agent-native, tiny addition on top (one CAS row per
  `{base_epoch, query}` with a proven-zero verdict) — no other tool has it, and it composes with the
  read port's receipt discipline.

**Honest cut.** The design's *semantic* leg (`code_semantic`, embedding/BM25 defaults) is **correctly
dropped** — the representation ladder (CPG + structural + behavioral) replaced it with something more
precise, and the corpus's own lesson (Augment/Claude Code) was that embedding defaults don't earn
their cost. Recommend only the structural/symbol/grep subset over the landed index.

**SIZE: medium.** Verb surface + staleness frame over landed `atlas-index.mjs`, projection onto
`context.read`, absence-cache CAS rows. Not large — no new index machinery, no shard GC until the
fleet queries actually land.

---

### D. Side-channel board surfacing — **small–medium**

**WHAT.** `coordination-repl.md`'s critique (§6) named the agent-native move for the Scratch Board:
**make Board participation a side-channel on tools the worker already calls** — the hub injects
"w1 holds claim path:payments/**" into the **Edit tool result** the worker is already reading, instead
of making the worker learn a new `scratch_claim` verb and poll a board. The tuple-space design
(`scratch_post/claim/heartbeat/release/cas/read/watch/retract` + `bench_*`) was the vehicle; the
critique explicitly deleted `scratch_heartbeat` (slave the claim lease to the I1 supervisor lease) and
cut `scratch_watch` (redundant with `fleet_wait`).

**WHY DROPPED.** The tuple-space never landed as verbs (grep: **zero** `scratch_post`/`scratch_claim`/
`bench_run`/…). What landed instead, under the reflexive-orchestration arc: the **scratchpad**
(write/elevate/settle, issue #33), the **REFLEX-2 board** with a worker half (board.claim/board.report,
claimGrant — coordination-store.mjs:445-451, events `board.claim_requested`/`board.claim_expired`/
`board.report_submitted` at :153, now green 24/24 via #78), and the **closed Context Program "Bench"**
vertical (phase 81/84/85 — the original sandboxed Bench was deferred and replaced). So the claim/CAS
*authority* is landed; the critique's §6 **injection** step — surfacing claim/lease state inside
existing tool results — is the one unbuilt piece.

**WOULD GIVE.** The boards 2/5 verdict was specifically "board.claim/report are registry ghosts";
#78 made them real. But a real board is only useful if **workers see it without new ceremony**. The
side-channel is now genuinely cheap:
- the worker-half authority (#78 grants/claims) exists and is store-backed — the hub can read
  "who holds what" with zero new coordination;
- the message lane (`message.send`, #86/#92) and attention inbox (#79) give the delivery path the
  design predated;
- the tool-result injection point is a thin adapter over the adapter layer — the place Baton already
  frames tool results.

**SIZE: small–medium.** A read of the claim table + an injection into the tool-result framing path for
the coordination-relevant verbs (Edit/Write). The tuple-space itself should **stay dropped** — the
fleet does not need a raw blackboard when board + scratchpad + message lane cover the semantics.

---

### E. Quartermaster authority-bearing composition — **medium**

**WHAT.** `orientation-reuse.md`'s "Authoritative pending Quartermaster ledger" closes with the
unbuilt capstone: **independent provenance**, **reachability gating**, and "**authority-bearing
composition**" — a high-level `fleet_reuse` and a unified `fleet_provenance` surface, where positive
clearance is its own non-resurrection transaction (a cleared decision can bind into a new approval
without re-litigating the evidence). The critique appendix for this dossier was never completed (it
stops mid-sentence in the file), so the design intent is carried by the ledger + docs/28:466-467.

**WHY DROPPED.** Never built — it is the *last* entry of a ledger whose earlier entries all shipped.
What landed is the evidence floor, extensively: `reuse.internal` (phase 32), external dossier
(phase 36), exact-lockfile SBOM (37), immutable `borrow|build` decision (38 — grep confirms
`fleet_reuse_decide`/`fleet_reuse_recheck` are live MCP tools, mcp-northbound.mjs:697-701), advisory
TTL invalidation (39), proposed install graph (40), transitive advisory projection (41), policy-epoch
reconciliation (42), adverse-provider ingestion (43). But `fleet_vet` and `fleet_provenance` are
**zero** in `impl/src`, and reachability is honestly "vulnerable-function reachability remains unknown"
(cartographer-quartermaster.mjs:386-390) — a designed-honest limit, not a defect.

**WOULD GIVE.** Today, a worker adopting a dependency cannot answer "was this already vetted and
decided for this repo?" in one call — the evidence is spread across dossier/SBOM/decision/recheck
artifacts, and only the orchestrator can compose it. The composition step is now buildable because the
two halves it binds both exist:
- `coordinator.decideReuse`/`recheckReuseDecision` are durable, replay-validated authorities;
- the Goal/Plan approval surface (phase 62: `goal_define`/`plan_propose`/`plan_approve`,
  distinct-authority approval) is the natural place a positive clearance becomes a bindable
  pre-condition on a Plan node — the "authority-bearing" part the ledger names;
- the Run application's adoption path can carry the provenance receipt into the accepted result.

**SIZE: medium.** A provenance-read verb (compose dossier/SBOM/decision/recheck reads under one
authority) + a clearance transaction bound to the phase-62 approval envelope. Reachability gating is
**not** part of the recommendation — phase 41's "never clears" is the right honest stance; don't
promise what the evidence cannot carry.

---

### F. Fleet-wide counterexample regression corpus — **medium**

**WHAT.** `math-proof.md`'s critique (§7) proposed, as the agent-native move for the Evidence Ladder, a
**fleet-wide content-addressed counterexample corpus** keyed by code region: every time a harness
failure observation or a rejected candidate yields a concrete counterexample, it is stored once and
re-applied as a regression net on later candidates touching the same region. Companion idea: a
conjecture/lemma market (open obligations as shareable work items).

**WHY DROPPED.** The evidence-ladder module itself is ceiling-gated at R3 for JS/TS (phase 24
Decision — no honest compiler IR; docs/28:568-570), so the ladder's higher rungs never came. What
landed is a *taxonomy* node, not a *corpus*: phase 49 promotes "closed policy failure observations"
into `Counterexample` KG nodes (docs/28:164) — a promotion class, not a keyed-by-region regression
corpus. Grep finds no corpus machinery.

**WOULD GIVE.** Compose the landed pieces: the KG (Cairn) with its contradiction workspace
(phase 53), the `Counterexample` node type, and the verified-outcome substrate (`causal.assess_recall`,
phase 52) into a keyed-by-region regression store. When a worker revises a candidate in a region with
known past counterexamples, the hub attaches them to the brief via the BD3 context-package lane. This
is the "remember what the fleet has already disproven" move — a real knowledge-poverty cure, not a
solver feature.

**SIZE: medium.** A content-addressed store keyed by region + an attach-to-brief projection. Lower
priority than A–C because the value lands only when a region *has* accumulated counterexamples, and
the honesty discipline (content-address, no fabricated "proof" claims) has to be built from scratch.

## 3. Correctly dropped — WARNING, do not resurrect

These were dropped for good reasons that still hold; a find that ignores them is a trap.

- **Evidence Ladder R4–R6 (Kani/CBMC/BMC/SMT/Lean4 kernel re-check).** Explicitly ceiling-retired by a
  landed Decision (phase 24: JS/TS has no honest compiler IR; R3 is the ceiling — docs/28:568-570).
  The critique independently found the "crown jewel" claim unsound (`sorry`→sorryAx, `axiom cheat`,
  `native_decide`) and none of the tools installed. **The valuable half of R1.5 — mutation testing —
  already landed** (`referee.mjs:320-334`: `mutationCommand`, `survivedMutants`, mutation strength) as
  part of the trust gate's hard-to-fool cluster. Do not re-spec the ladder.
- **Semantic search / embedding defaults (`code_semantic`).** Dropped for the Augment/Claude Code
  lesson the corpus itself records; the representation ladder (CPG + structural + behavioral) is the
  more precise replacement. Only the structural/symbol subset of Find C is worth reviving.
- **Scratch tuple-space + heartbeats (`scratch_post`/`scratch_claim`/`scratch_heartbeat`/`bench_*`).**
  The critique itself cut `scratch_watch` (redundant with `fleet_wait`) and `scratch_heartbeat`
  (slave to the I1 lease); the semantics were superseded by scratchpad + REFLEX-2 board + message lane.
  Only the side-channel injection (Find D) survives.
- **Vantage live DAP (`dbg_record`/leases/rr replay).** Over-ambitious for the value; correctly shelved.
  Only the postmortem slice (Find B) survives.
- **Selector-replay skill distillation (`cua_distill`).** The critique preferred API-discovery
  distillation; both are speculative until a CUA fleet exists. Leave it.

## 4. Superseded-but-landed (not finds — already covered)

- `code_context_pack` (discovery-search.md) → **`mintContextPack` / BD3 context packages** (#17/#18,
  coordination-store.mjs:13157) — the idea landed under the BD3 name.
- Sandboxed **Scratch Bench** → **closed Context Program vertical** (phase 81/84/85) — the deferred
  bench was replaced by the pure-cell program bench; `StatelessContextBench` (context-program.mjs).
- `fleet_*` tool dialect (phase 16) → `fleet_run_*` default (phase 64); the old dialect survives under
  the `combined` surface deliberately.
- **capability-plane conformance** (`reverify`, `AciResult` envelope): the seven module dossiers'
  critique appendices all flag non-conformance — but the **contract itself is landed and enforced**
  (`capability-registry.mjs` validates `summary`/`refs`/`cost`/`provenance`; `reverify` is live across
  all atlas/cartographer/cairn modules). The "gap" is simply that the modules that would need to
  conform (Vantage, Skill Forge, Evidence Ladder) were never built. The plane is not the missing half;
  the modules are.

## 5. Top-3 recommendations (ranked by value-per-cost)

1. **Command-recipe registry (A) — small, every-task frequency.** The single most-rediscovered
   knowledge in a fleet, captured as a closed data manifest served through the BD3 read port / orientation
   push. Copy `recipes.mjs`'s "recipes are DATA" discipline verbatim; the schema precedent and the
   delivery lane both exist. Cost: a day of surface work. Value: the top knowledge-poverty leak closed.
2. **Failed-verification postmortem digest (B) — small, highest-leverage event.** Attach
   exception+traceback+sanitized-locals to the trust gate's reject and deliver it through the message
   lane. The failure moment is the fleet's most expensive loop and currently its most information-poor.
   `verifier-diagnostics.mjs` is already the sanctioned sanitization hook; I7 authority is untouched
   because the digest is evidence attached to the reject, not a new verdict.
3. **Atlas fleet discovery verbs over the landed index (C) — medium, closes "rigorous,
   unreached-for".** Surface `code_symbol`/`code_grep`/`code_index_status` over the already-landed
   epoch+overlay index (`atlas-index.mjs`), delivered through `context.read`, with the absence cache
   as the cheap agent-native add-on. The index machinery is the expensive half and it exists; only the
   verb surface and staleness frame are missing.

*Also worth a slot on a longer list:* side-channel board surfacing (D) when the #78 board reaches the
worker, then Quartermaster authority-bearing composition (E) once a provenance read has a consumer.

## Appendix — verification commands (NUL discipline honored)

`impl/src/application.mjs` and `impl/src/coordination-store.mjs` are NUL-byte-bearing; greps over them
use `grep -an` and prints use `sed -n`. All other files are ordinary text.

- **Atlas verbs:** `grep -ranE "code_grep|code_find_files|code_symbol|code_semantic|code_context_pack|code_index_status|code_seed" impl/src --include="*.mjs" -l` → *zero files*.
  Substrate present: `atlas-index.mjs:170-185` (`epoch`, `overlay(base, worktreeRoot, …)`).
- **Vantage:** `grep -ranE "dbg_record|dbg_open|dbg_observe|dbg_bisect|dbg_diff|dbg_slice|dbg_profile|dbg_explain|CausalObservation|debugpy|postmortem" impl/src --include="*.mjs" -l` → *zero files*.
  `verifier-diagnostics.mjs:71,106` ("[verifier produced no diagnostic output]") is the sanitize hook.
- **Evidence ladder:** `verify_plan|attest_check|spec_formalize|spec_register|kani|cbmc|lean4checker` → *zero*;
  `cargo-mutants` → *zero*. **Mutation probe landed under a different name:** `referee.mjs:320-334`
  (`mutationCommand`, `survivedMutants`, mutation strength).
- **Scratch tuple-space:** `scratch_post|scratch_claim|scratch_heartbeat|scratch_release|scratch_cas|scratch_read|scratch_watch|scratch_retract|bench_run|bench_session|bench_observe|bench_interrupt|bench_kill` → *zero*.
  Board worker-half landed: `coordination-store.mjs:153` (`board.claim_requested`/`board.claim_expired`/`board.report_submitted`), `:445-451` (`board.claim`/`board.report` ops), `claimGrant` in `application.mjs`.
- **Skill Forge:** `skill_draft|skill_verify|skill_publish|skill_search|skill_adopt|skill_promote|skill_deprecate|cua_distill` → *zero*. `recipes.mjs` is workflow composition (RC-A, R-DC-6 "recipes are DATA").
- **Quartermaster:** `fleet_reuse_decide`/`fleet_reuse_recheck` → landed MCP tools (`mcp-northbound.mjs:697-701`), backed by `coordinator.decideReuse`/`recheckReuseDecision`. `fleet_vet|fleet_provenance` → *zero*. Reachability honestly "unknown" (`cartographer-quartermaster.mjs:386-390`).
- **Cairn / plane:** `bok_note|bok_recall|bok_route|bok_scorecard|bok_audit|bok_trace|bok_export` → *zero* (surface renamed to `cairn/causal.*` + `knowledge.*`); `RouteStat` → 19 matches (landed); `reverify` → 216 matches; envelope enforced in `capability-registry.mjs:37-48`.
- **BD3 / board / context:** `mintContextPack` (`coordination-store.mjs:13157`), `recordContextRead` (:13252), `context.read` events (:8739) — all landed.
- **Canonical op surface** (`application-semantics.mjs:1218+` CANONICAL_OPERATION_SPECS): contains `run.*`, `board`, `attention_read`, `semantic_review`, `revise_candidate`, etc. — **no** `verify_*`, `skill_*`, `scratch_*`, or `dbg_*` op keys.
