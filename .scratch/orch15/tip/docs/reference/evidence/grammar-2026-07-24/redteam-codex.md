# Codex adversarial red-team: unified control grammar

Scope: `docs/35-unified-control-grammar.md`, read in full before inspecting the implementation. This report attacks executable mechanics and current contracts, not the document's goals.

## Findings

1. **R-CX-1 — P0 — §4.1, §5 L1/L2, §6, §8.1: the 41-operation set is not a lossless closure of either live registry.**

   Grounding: `impl/src/application.mjs:126-153` defines 26 application commands, including `application.shutdown`; `impl/src/application-semantics.mjs:213-323` defines the Context action family; `impl/src/application-semantics.mjs:355-405` defines checkpoint and semantic-control actions; `impl/src/application-semantics.mjs:470-548` defines revision, member-stop, review, integration, export, retry, resume, and stop actions. Direct Context evaluation accepts exactly one of `runId` or `manifestDigest`, plus optional role and program (`impl/src/application.mjs:464-476`), while the run-advertised action has a different server-derived addressing contract (`impl/src/application-semantics.mjs:213-225`).

   Failure: the canonical table has no replacement for `application.shutdown`, so “deployment lifecycle” loses its only close operation. More seriously, `context.eval` cannot absorb `context_retry`, `context_reduce`, or `context_map`: those actions propose separately approved successor Plans and have `effect: plan_proposal`, whereas `context_eval` is pure compute. Even pure `context.eval` has two authorities—Run-addressed action and manifest-addressed direct operation—that §6 collapses without stating whether manifest addressing survives. The table also has no canonical operation for `nudge_turn`, `wait_turn`, or `claim_turn`, three observably different checkpoint effects. `context_search`, `context_chunk`, and `context_coverage` can be normalized to `context.eval` programs, but the document does not give that translation or preserve their defaults and result addressing. Thus M1 cannot make every live action definitionally sugar for a named canonical operation, and L1 cannot be tested as a bijection.

   Minimal repair to docs/35: replace the prose “replaces” table with an exhaustive generated crosswalk containing every D1, D2, and D3 row and every argument. Add at least `deployment.stop`, `context.map`, `context.reduce`, `context.retry`, and three checkpoint operations such as `run.attention.nudge`, `run.attention.wait`, and `run.attention.claim`. Preserve `context.eval`'s closed `runId XOR manifestDigest` address union, or explicitly declare manifest evaluation outside the unified Run grammar. Normatively translate search/chunk/coverage into exact `context.eval` programs, including defaults and addressed result shapes. Require the crosswalk test to fail on an unmapped source row or a canonical row with no source/new-semantics declaration.

2. **R-CX-2 — P1 — §4.1 note ‡, §6 `run.view`/`run.watch`/`run.result`: the read fold drops cursor, settlement, and selector contracts.**

   Grounding: the current schemas distinguish `run.inspect` selectors from Episode selectors and `run.follow`/`run.wait` (`impl/src/application.mjs:130-140`; `impl/src/application-semantics.mjs:125-155`). `run.wait` waits for **provider execution settlement**, not application terminality (`impl/src/application.mjs:7060-7074`). `run.follow` returns a bounded categorized change page keyed by `afterCursor`, reauthorizes after waiting, and enforces deployment ceilings (`impl/src/application.mjs:7212-7292`; `impl/src/web-northbound.mjs:561-564`). `run.result` currently retains role, generation, evidence depth, cursor, and wait arguments through the Episode adapter (`impl/src/application-semantics.mjs:607-608`; `impl/src/application.mjs:10112-10163`).

   Failure: `run.watch(channel=progress|events|output|changes)` does not say how to express `afterCursor`, bounded page continuation, timeout, provider-settled wait, application-terminal wait, post-wait reauthorization, or profile ceilings. Treating `run.wait` as an ordinary changes stream changes when drivers return: `work_completed` satisfies the former but is intentionally not terminal. The `run.result` row names the operation but does not preserve its member-generation and evidence selectors. An implementation following §6 can pass name derivation while silently changing driver liveness and result attribution.

   Minimal repair to docs/35: pin schemas, not just names. Give `run.watch` `channel`, `afterCursor`, `timeoutMs`, and `until: change|provider_settled|application_terminal`, plus the existing bounded-page and post-wait authorization semantics. Give `run.view` the full `depth/section/item/offset/pageCursor/recipient/cursor/waitMs` selector contract. Give `run.result` `role?`, `generation?`, `detail`, `cursor?`, and `waitMs?`, with current result-settlement continuation semantics. Cite `impl/test/phase67-run-terminality.test.mjs` as a required migration contract.

3. **R-CX-3 — P0 — §4.1 note ‡, §6 `run.view`, M3: the Episode fold is syntactically wrong and does not pin the evidence guarantees it claims to retain.**

   Grounding: current view selection uses `section: "episode"` and item ids `episode:<topic>[:<role>:g<generation>]`, not a dotted section (`impl/src/application.mjs:9328-9350`, `9464-9472`). The projection isolates artifacts by task and generation and preserves temporal/evidence coordinates (`impl/src/application.mjs:9085-9127`), marks authority separately for summaries, sources, lineage, contradictions, route, verification, result, and cleanup (`impl/src/application.mjs:9255-9326`), and emits evidence capsules at evidence depth (`impl/src/application.mjs:9353-9393`). Output has distinct pagination and untrusted-content authority (`impl/src/application.mjs:9603-9626`).

   Failure: the example `--section episode.output` is not a valid spelling of the current selector model. More importantly, “taxonomy unchanged” is not enough to preserve the Phase 92 contracts: complete topic vocabulary (including `help`), O(1) broad snapshot use, sibling isolation, exact predecessor generation addressing, contradiction direction, evidence/temporal coordinates, verifier failure capsules, output provenance, and logical continuations are all executable guarantees. A generic section fold could flatten the chapter into a normal item and still satisfy the current text while failing `impl/test/phase92-episode-workstream-red.test.mjs:77-121` and `impl/test/phase92-episode-attribution-red.test.mjs:88-176`.

   Minimal repair to docs/35: specify the exact canonical selector as `run.view {section:"episode", item:"episode:<topic>[:<role>:g<generation>]", depth, pageCursor?, cursor?, waitMs?}` (or define a different structured selector and a total translation). Make the eleven-topic vocabulary and all Phase 92 attribution/authority invariants normative acceptance contracts. Require the legacy `run.episode` and canonical `run.view` paths to return the same semantic projection during M3.

4. **R-CX-4 — P0 — §7.1, L4, C3: `work_completed→completed` collapses a deliberately non-terminal trust-chain state, and the “exhaustive” map omits two workflow resting states.**

   Grounding: provider-settled phases and application-terminal phases are separate closed sets (`impl/src/application.mjs:117-124`). `run.wait` stops at the former (`impl/src/application.mjs:7069-7074`), while inspection/follow continues at `work_completed` (`impl/src/application.mjs:8955-8980`). The application emits `work_completed` before result finalization (`impl/src/application.mjs:6711-6722`). Workflow projections also emit `selection_required` and `candidate_selected` (`impl/src/application.mjs:6414-6458`), both included in provider-settled but not application-terminal authority.

   Failure: mapping `work_completed` to terminal `completed` makes `run.watch`, embedded `complete()`, waves, and recursive drivers stop before adoption, selection, integration, or export becomes available. It directly contradicts `impl/test/phase67-run-terminality.test.mjs:23-63`. The supposedly exhaustive mapping also omits `selection_required` and `candidate_selected`, states on which workflow selection/adoption tests depend (for example `impl/test/phase79-workflow-composition-red.test.mjs`). No typed cause can reconstruct the lost “provider done, application still open” distinction.

   Minimal repair to docs/35: add a non-terminal `result_ready` (or equivalent) and map `work_completed` to it. Add explicit non-terminal mappings for `selection_required` and `candidate_selected`—for example `awaiting_selection` and `result_selected`—or prove a gate-sensitive mapping into distinct existing phases. Define and test two registry-owned predicates, `providerSettled(phase)` and `applicationTerminal(phase)`; do not derive either from a single terminal enum.

5. **R-CX-5 — P1 — §7.1/§7.2: `approved→working`, `closed→stopped`, and `start_failed→failed` erase three different authority facts.**

   Grounding: an approved Plan with no dispatched task emits `approved`, while a task id is required for `running` (`impl/src/application.mjs:6685-6725`). `stopped`/`stopping`/`cancelled` receive the “not observed before stop” route attestation, while other provider-settled phases such as `closed` receive “unavailable” (`impl/src/application.mjs:1412-1437`). Wave `start_failed` is synthesized precisely when no Run handle exists (`impl/src/wave.mjs:147-168`, `277-292`). Paused is separately durable, non-terminal, and cannot transition directly to completed (`impl/src/coordination-store.mjs:120-130`).

   Failure: `approved→working` asserts live execution before dispatch authority has produced a task. `closed→stopped` fabricates an operator-stop interpretation and changes route evidence. `start_failed→failed` fabricates a failed **Run phase** for a wave member that never acquired a Run. These distinctions are consumed by progress renderers and drivers, so a cause field alone is insufficient if the wrong state controls liveness or attestation.

   Minimal repair to docs/35: add `queued`/`dispatching` and map `approved` there; map legacy `closed` to a non-stop terminal such as `cancelled` with cause `deployment_closed` (or retain a distinct canonical phase); classify wave start failure as member state `failed` with cause `start`, `runId: null`, not as a Run phase. Keep `paused` first-class exactly as written.

6. **R-CX-6 — P0 — §3 attention unification, §5 L9, §7.3: checkpoint `continue|settle` through `run.answer` contradicts the landed issue-31 executable contract.**

   Grounding: `nudge_turn` admits a fresh provider turn, `wait_turn` records a non-consuming receipt without changing state, and `claim_turn` reruns the trust gate (`impl/src/application-semantics.mjs:355-379`). All three are advertised for the same `turn_checkpoint` with exact server-derived pause/task/epoch coordinates (`impl/src/application.mjs:8786-8799`). The story fold keeps paused distinct from idle and working (`impl/src/story.mjs:225-242`, `359-377`).

   Failure: neither binary option matches the three effects. In particular, “wait” must leave the checkpoint pending and re-advertise all three actions, while “claim” consumes it and may complete without another provider turn. `impl/test/turn-checkpoints-31b5-surface-red.test.mjs:150-224` pins those differences. Folding them into `run.answer` without a three-way effect-preserving response breaks durability, turn consumption, and provider-call accounting.

   Minimal repair to docs/35: define checkpoint attention options as typed bound operations (`nudge`, `wait`, `claim`) with their existing effects and server-derived coordinates. Either retain three canonical verbs under `run.attention.*`, or allow `run.answer` only if its response union has three explicit variants whose dispatch is exactly those existing actions. Replace L9's `continue|settle` wording and name the issue-31 tests in C5.

7. **R-CX-7 — P0 — §5 L2, §8.2, C2: `{action, inputs}` is not a portable executable do-block under current freshness and authority digests.**

   Grounding: an action id binds registry, repository, Run, principal **and session**, profile, Plan, semantic view digest, kind, and target (`impl/src/application.mjs:7310-7322`). Advertised actions are capability-filtered only when the northbound context supplies capability authority (`impl/src/application.mjs:8869-8875`). Semantic authority is an exact six-field object whose digest covers sorted required capabilities (`impl/src/application.mjs:561-594`). The MCP/Web bridge reattests the session and validates `actionId`, `kind`, `effect`, sorted capabilities, and `authorityDigest` before replay (`impl/src/mcp-web-bridge.mjs:90-99`, `111-177`).

   Failure: a canonical verb or action kind in `action` is insufficient; execution requires the freshness-bound `actionId`. A block captured under one session is intentionally not executable under another, and actions omitted by one surface's capability projection cannot be promised on “all four surfaces.” Web/MCP also require transport context and semantic authority out of band; their closed envelopes cannot accept the literal same JSON as CLI or embedded. “Byte-identical resulting view modulo cursor” is also too strong because replay/transport wrappers differ.

   Minimal repair to docs/35: define the logical block exactly as:

   ```json
   {
     "operation": "run.do",
     "arguments": {"runId": "…", "actionId": "…", "inputs": {}},
     "authority": {
       "schemaVersion": 1,
       "actionId": "…",
       "kind": "…",
       "effect": "…",
       "requiredCapabilities": ["sorted"],
       "authorityDigest": "…"
     }
   }
   ```

   State that transport adapters execute `arguments` verbatim and carry the authority/envelope metadata out of band. Scope L2 to the same authenticated principal/session, registry/profile/Plan/view authority, and surfaces enabled for that capability projection. Compare canonical semantic views after excluding cursor and transport/replay metadata, not raw response bytes.

8. **R-CX-8 — P1 — §3 member unification, H4, §6 `run.member.*`: role plus optional generation is not collision-free and does not preserve the current `work` recipient.**

   Grounding: semantic control currently constructs a special `work` recipient that means the explicit `work` role when present, otherwise the sole eligible active member; parallel ambiguity is refused (`impl/src/application.mjs:1926-1977`). It deduplicates explicit recipients by role and does not expose a generation coordinate (`impl/src/application.mjs:1941-1956`). Role/id syntax permits colon (`impl/src/application.mjs:221`), while workstream/Episode item parsing interprets any trailing `:gN` as a generation suffix (`impl/src/application.mjs:9332-9350`).

   Failure: a real role named `work` collides with the implicit current-work sentinel. A real role named `reviewer:g2` collides with serialized `{role:"reviewer", generation:2}`. If two live generations of one role are visible during recovery/revision, deduplicating by role cannot express which generation `member.send` targets; defaulting to “current” does not define how freshness is chosen. Consequently role[+generation] neither covers every current `--to RECIPIENT` case nor forms an injective address space.

   Minimal repair to docs/35: make member addresses structured everywhere: `{role, generation?}`. Represent the run-level default separately as `{current:true}` or by omitting `member` entirely; never encode generation into the role string. Reserve or reject ambiguous legacy role spellings (`work` as sentinel and trailing `:gN`) during migration, and specify that effectful member operations resolve only an advertised current generation and fail closed on ambiguity.

9. **R-CX-9 — P1 — §8.1, M1, M4, “Honest edges”: merging D1/D3 in M1 can change the Web wire contract before the generated renderer exists.**

   Grounding: Web command names, capability admission, read-only/reconcilable classification, exact allowed arguments, and application-card inventory are all derived at module load from `APPLICATION_COMMAND_DEFINITIONS` (`impl/src/web-northbound.mjs:11-60`, `1378-1384`). The Web envelope is closed and rejects unknown commands and arguments (`impl/src/web-northbound.mjs:276-302`). Admission identity hashes the transport command and canonical request, and durable admission records that transport command (`impl/src/web-northbound.mjs:648-650`, `700-708`). The semantic registry currently has only ten operations and keeps 27 actions in a separate namespace (`impl/src/application-semantics.mjs:112-181`, `820-840`).

   Failure: a naive “D1/D2/D3 merge behind one table” either exposes action kinds as standalone Web commands, removes D3-only commands, or changes exact argument/flag metadata. Even adding a canonical alias changes Web command identity and idempotency scope; it is not byte-compatible with the legacy envelope. M1 promises the merge, while M4 is where renderers and hand tables are actually replaced. That is a dependency inversion: M1 cannot preserve the current Web adapter unless it retains a D3-shaped compatibility projection that §8.1 does not specify.

   Minimal repair to docs/35: in M1 create registry v2 as a shadow semantic source but keep an explicit, byte-pinned D3 compatibility projection for Web admission and cards. Do not promote action entries to transport commands. Move the physical table deletion/renderer switch to M4, or move the Web compatibility adapter and its golden envelope tests into M1. Specify that legacy and canonical aliases may dispatch to one semantic operation only **after** their distinct admitted transport identities have been preserved.

10. **R-CX-10 — P1 — §5 L3, §7.1, C5: “every terminal carries cause” misclassifies successful completion and contradicts a passing contract.**

   Grounding: successful read-only evidence Runs reach `completed` with `terminalCause: null` (`impl/src/application.mjs:6711-6715`). The outline projects that null honestly (`impl/src/application.mjs:9918-9953`). `impl/test/phase92-read-only-result-red.test.mjs:90-103` explicitly asserts `phase === "completed"` and `terminalCause === null`.

   Failure: a cause is appropriate for failure, cancellation, denial, or stop, but requiring one for success either invents a fake failure-shaped cause or breaks the passing success contract. C5's unconditional `cause non-null` therefore cannot land as a red-to-green migration test without changing established result semantics unrelated to the grammar.

   Minimal repair to docs/35: change L3 to “every non-success terminal has a typed cause; every success terminal has a typed outcome/result authority.” Change C5 to require cause only for `failed|cancelled|denied|stopped` (and any retained abnormal terminal), and require `completed` to carry a non-null accepted result/outcome while permitting `terminalCause: null`.

11. **R-CX-11 — P2 — H10, §8.2, C2/C8: field order is already deterministic locally, but making parser dependence normative is the wrong identity boundary.**

   Grounding: views and outlines are assembled with deterministic JavaScript object-literal insertion order (`impl/src/application.mjs:9918-9958`), but the semantic digest recursively sorts object keys and excludes the transport cursor (`impl/src/application.mjs:171-187`). Action ids use that order-insensitive semantic view digest (`impl/src/application.mjs:7310-7322`). Different depth branches and conditional spreads legitimately assemble different subsets/orders (`impl/src/application.mjs:9655-9818`).

   Failure: pinning raw field order in the registry does not by itself govern the many nested ad hoc objects. Worse, “parsers may rely on it” makes harmless reordering a compatibility break even though all replay/action identities intentionally canonicalize keys. If C2/C8 compare raw JSON bytes, surface wrappers, conditional fields, and replay metadata will create false failures; changing the canonical digest to become order-sensitive would stale action ids and replay authority for no semantic change.

   Minimal repair to docs/35: require deterministic canonical encoding for golden output, but state that parsers must be order-insensitive. Keep semantic/action/request digests on the existing sorted-key canonical form. Define C8 over the canonical semantic view after documented exclusions; if human-facing presentation order is desired, version and test it separately from replay or authority identity.

12. **R-CX-12 — P1 — §5 L10, C5: “deeper depths never add new kinds of truth” is undefined and is not tested by the proposed acceptance contract.**

   Grounding: the registry currently has 18 section kinds (`impl/src/application-semantics.mjs:191-211`), while an outline exposes a summary and a single expansion to index, not those kinds (`impl/src/application.mjs:9954-9975`). Episode evidence depth introduces explicit source-coordinate, route, verification, result-capsule, and cleanup evidence kinds (`impl/src/application.mjs:9353-9393`) that are not outline fields.

   Failure: “kind of truth” has no machine definition, so L10's universal “every question of the form what/why/what now” cannot be property-tested. C5 tests only terminal and attention-bearing states, which permits a new non-terminal section, gate, contradiction class, or next-action prerequisite to appear only at depth and still pass. Read literally, the law also forbids the evidence kinds that progressive disclosure is designed to reveal.

   Minimal repair to docs/35: define a closed registry-owned `outlineTruthKinds` enum (phase, stage, terminal cause/outcome, attention, next action, route, progress, resources, preservation, and section availability). Require outline to advertise availability/links for every registered section kind, while deeper depths may add authoritative coordinates and payloads. Replace the universal-question wording with a finite phase × attention × next-action matrix and extend C5 to every row.

13. **R-CX-13 — P1 — §8.4, M0-M5, C4: the migration ledger can admit new divergence, and L2 is scheduled before its capability/surface prerequisites.**

   Grounding: the current audit explicitly says textual extraction is best-effort and asserts nothing (`impl/scripts/surface-audit.mjs:9-12`). It extracts MCP/CLI/method names and selected phase literals but not operation argument schemas, authority behavior, continuations, or aliases (`impl/scripts/surface-audit.mjs:27-73`). Current action capability filtering is northbound-context-dependent (`impl/src/application.mjs:8869-8875`), while the unified profile projection is deferred to M4.

   Failure: seeding an “allowed divergence” ledger from Appendix A and merely requiring it to shrink does not forbid adding a new entry later; nor can this inventory notice a divergence in arguments, effect class, authority digest, or continuation behavior. C4's banned list is also incomplete relative to §4.1: it omits at least `wait`, `follow`, `progress`, `events`, `output`, and `episode`, and spelling variants such as `stop_member` can evade `stop-member`. Separately, M1 requires all-surface L2 while M4 is the first phase that unifies capability projection and surface rendering, so C2 cannot honestly pass at M1.

   Minimal repair to docs/35: make the ledger monotone and closed: no new entry after M0 without a spec-version change and explicit red-team approval; key rows by operation, surface, arguments, effect, capability set, output, continuation, and aliases. Generate the banned-synonym set from §4.1 with token normalization. Move all-surface L2/C2 to M4, or move generated capability projection and transport adapters into M1. Keep M1 limited to same-surface advertised-do execution until that prerequisite lands.

14. **R-CX-14 — P0 — §5 L1/L8, §6 board/package rows, §8.3: universal board/package projection requires authority semantics the document declares out of scope.**

   Grounding: board/package reflex tools are deliberately outside both application-command derivation sets and are registered by hand (`impl/src/mcp-northbound.mjs:51-78`). Board mutations require an active Run-orchestrator lease and an exact `expectedBoardFence` CAS before dispatch; package admit/attach also require that lease (`impl/src/mcp-northbound.mjs:1301-1350`, `1399-1417`). The current ordinary MCP contract explicitly does **not** register `baton_board_claim` or `baton_board_report` (`impl/test/mcp-reflex-board-package-red.test.mjs:213-224`, `413-421`). Their underlying store operations instead bind a worker/owner, observed item version/digest, and board fence (`impl/src/coordination-store.mjs:12717-12753`).

   Failure: §6 says board `claim/report` are already-clean `baton_board_*` operations that merely gain CLI/embedded/Web projections. They are not current MCP tools at all, and their worker-side authority cannot be recreated from an ordinary operator principal without adding a new delegation rule. The other board/package mutations also cannot be generated from the proposed registry entry, which lists only capabilities and omits the required orchestrator lease, board fence, exact attachment idempotency key, and operator-versus-worker projection. L1's “every operation on every enabled surface” either breaks the pinned absence contract or silently broadens authority, violating the non-goal.

   Minimal repair to docs/35: make authority profile part of operation reachability. Mark `board.claim/report` worker-profile-only unless a separately specified operator delegation is approved; keep their absence from ordinary MCP/Web/CLI. Give orchestrator board/package mutations registry fields for required active orchestrator lease, `expectedBoardFence`, exact idempotency binding, and projection role. Rewrite L1 as “every operation is reachable on every surface enabled for the same authority profile,” and add the negative inventory assertions from the reflex test to C1/L8.

15. **R-CX-15 — P1 — §4.1 banned aliases, §6 `run.member.send`, M3/M5: `run.steer` is not a semantic alias of member send and cannot be replay-preserved as one.**

   Grounding: the compatibility command has the exact arguments `{runId,target,mode,message,reason}`, where `target` is a worker id and `reason` is mandatory (`impl/src/application.mjs:479-486`). It resolves that worker's current fence inside the application and records the worker target, mode, reason, result, and emulation truth (`impl/src/application.mjs:10825-10853`). Its command definition is intentionally `reconcilable: false` (`impl/src/application.mjs:142`). `impl/test/phase64-integrated-run-application.test.mjs:680-707` pins worker ownership/fence resolution and foreign-worker refusal.

   Failure: §4.1 calls `steer` a deprecated alias of `member.send --now`, while §6 folds it into `run.member.send`. The canonical operation instead uses role/generation addressing, supports delivery modes independently, and has no stated mandatory audit reason. Rewriting the alias before dispatch loses the old request shape and worker-target refusal; treating it as reconcilable changes retry semantics. This is a compatibility adapter with intentionally different authority, not a synonym.

   Minimal repair to docs/35: list `run.steer` in the divergence ledger as a deprecated **compatibility command**, not an alias. Preserve its exact five-field schema, worker ownership/fence lookup, mandatory reason, response audit fields, and non-reconcilable admission through M5. Keep it out of generated canonical inventories/help except as deprecated compatibility, and delete it only at the breaking alias sunset.

## Sections that survived attack

- §6.1's mechanical name derivation is sound once each operation has an explicit enabled-surface set and aliases cannot bypass the derivation.
- §7's decision to keep `paused` non-terminal is sound and matches the coordination and story folds.
- L5's wave approval mechanic already exists: `createWave` explicitly calls `run.approve()` (`impl/src/wave.mjs:147-157`), which records the ordinary goal/Plan approval before dispatch (`impl/src/application.mjs:3932-3964`). Treat that existing approval event as the recorded expansion; do not add a second synthetic approval event.
- L6, L7, and L8 are implementable as goals after the registry/ledger and authority-shape folds above; no additional mechanical contradiction was found.

## Verdict

**UNSOUND**

The grammar is directionally coherent, but its current canonical set and laws are not implementable without breaking pinned authority, liveness, and evidence contracts.

The three findings to fold first:

1. **R-CX-1** — make the canonical operation set exhaustive and preserve Context/checkpoint/deployment effects.
2. **R-CX-4** — restore the provider-settled versus application-terminal lifecycle distinction.
3. **R-CX-7** — define a freshness- and authority-correct portable do-block and scope L2 honestly.
