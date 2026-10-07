# surfaces — control surfaces, script entrypoints, and harness adapters

Auditor: `surfaces` (swarm audit-a, work-surfaces). Scope: `impl/src/application*.mjs`,
`control-surface-unification.mjs`, `mcp-northbound.mjs`, `mcp-web-bridge.mjs`,
`web-northbound.mjs`, `resident-authority.mjs`, `adapter.mjs`, `cli-adapters.mjs`,
`omp-rpc.mjs`, `claude-session.mjs`, `codex-appserver.mjs`, `grok-acp.mjs`, `kimi-acp.mjs`,
`impl/scripts/{baton,mcp-stdio,mcp-web,surface-gate}.mjs`, `impl/CLI.md`, `impl/MCP.md`.

Method note (disclosed): three mutation probes temporarily rewrote
`impl/src/mcp-northbound.mjs`, ran `node impl/scripts/surface-gate.mjs`, and restored the file
from an in-memory copy in a `finally`. The sha256 was re-checked after each run
(`4c7cd16ecd18259dcea2bfae0f12a811e5bf2581e011c7e023c3da8024a5367e`, unchanged). These ran
before the lead's "no source changes" guidance arrived; no source change survives. The suite was
not run.

---

## FRICTIONS

1. **The one table that says which routes exist is the one table with no generator.**
   `impl/CLI.md:15-16` promises the generated block "fails if they drift from served truth", and
   `impl/scripts/render-surface-docs.mjs:151-154` indeed byte-checks exactly two blocks. The
   "Fleet routes" table sits *outside* every generated block (`impl/CLI.md:220-229`) while the
   served inventory is `DEFAULT_BATON_DEPLOYMENT_ROUTES` (`impl/src/application-deployment.mjs:2207`).
   Printing the served table yields five harnesses — `codex`, `kimi-code`, `grok`, `claude-code`,
   `omp` — and models `omp | deepseek/deepseek-flash`, `omp | deepseek/deepseek-v4-pro[1m]`,
   `omp | zai/glm-5.3-flash` (`application-deployment.mjs:100`, `:107`, `:112`). The doc names
   `glm` and `deepseek` as harnesses, names `omp` nowhere, and gives the primary DeepSeek model as
   `deepseek-v4-flash`. An operator route-picking from the doc picks a `harness` value the
   deployment does not register.

2. **A registry row and the code that consumes it disagree, and only the projection is patched.**
   `impl/src/application-semantics.mjs:1989` still carries
   `['run.attention.list', 'mcp.baton', 'baton_decision_list'],` while the live dispatch is
   `impl/src/mcp-northbound.mjs:2023-2024`: `else if (name === 'baton_decision_list') { value = await
   this.application.decisionList({ runId: args.runId }, {`. The correction lives in a hand ledger,
   `impl/src/control-surface-unification.mjs:22-30`. Any reader of `APPLICATION_SEMANTIC_REGISTRY`
   that does not go through the unified projection — the registry is imported directly by
   `mcp-northbound.mjs:9`, `web-northbound.mjs:13`, `render-surface-docs.mjs` — sees the wrong owner
   for the alias.

3. **An advertised action that cannot be satisfied on a whole route family.**
   `run.act.answer_approval` is a required-priority action (`application-semantics.mjs:477-482`)
   reachable via `baton run do` / `baton_run_do`. On every omp-backed route the adapter answers
   `impl/src/omp-rpc.mjs:1050`:
   `async approve() { return { ok: false, reason: 'omp rpc approvals are handled by launch flags, not runtime elicitation' }; }`.
   The router never sees approval requests because the launch flag makes them moot
   (`omp-rpc.mjs:105`, `if (permissionMode === 'yolo') args.push('--approval-mode', 'yolo');`), so
   the refusal is honest — but the Run outline advertises the action with no signal that it is
   inert on this route, and an orchestrator must learn it by spending a turn.

4. **A harness in the shipped registry that cannot run.** `impl/src/cli-adapters.mjs:690`
   exports `CLI_ADAPTERS = { codex: CodexCli, claude: ClaudeCli, zcode: ZCodeCli, glm: ZCodeCli, pi: PiCli };`
   where `pi` is self-described at `cli-adapters.mjs:635-637` as "Not installed on this machine and
   no confirmed headless flags, so this is a configurable placeholder". The class reports honest
   status, but the name resolves in a registry a caller treats as the runnable set.

5. **One-shot adapters refuse `approve()` while sharing the adapter interface.**
   `impl/src/cli-adapters.mjs:479`: `async approve() { return { ok: false, reason: 'no interactive
   approvals in one-shot mode (sandboxed to the worktree instead)' }; }`. Same class of dead-end as
   item 3, reachable through the same advertised action.

---

## GAPS

6. **`fleet_drain` is advertised and permanently exempt from the resolvability probe.**
   `impl/scripts/surface-gate.mjs:119`: `if (tool.name === 'fleet_drain') continue; // drains the
   host; its wiring is the drain path itself`. Every other advertised tool is at least attempted;
   this one has no proof, including no proof that the exemption is still the right call.

7. **The resident-admission proof is skipped precisely for tools with no bridged command.**
   `surface-gate.mjs:136`: `const own = commandForTool(tool.name); if (own && !bridge._admits(own))
   { omittedOverResident.push(tool.name); continue; }`. `commandForTool` returns `null` for direct
   -method tools (`mcp-northbound.mjs:1050-1052`), so for those the gate performs no bridge check
   at all. `baton_decision_list` is one: it reaches `application.decisionList(...)`
   (`mcp-northbound.mjs:2024`) — a method `BatonWebApplicationFacade` does not implement anywhere in
   `impl/src/mcp-web-bridge.mjs:184-264` (only `authorizeReplay`, `actionAuthority`, `command`) —
   and the advertisement filter keeps it, because of the same null exemption:
   `mcp-northbound.mjs:1553-1554` `const selectedTools = this.admitsCommand ? surfaceTools.filter((tool)
   => { const command = commandForTool(tool.name); return !command || this.admitsCommand(command); }) }`.
   The production resident builds `surface: 'application'` (`mcp-web-bridge.mjs:331`), whose table
   excludes `baton_decision_list`, so this is not a live production break — it is a live break for
   any host that builds a combined-surface server over a remote facade, and the gate cannot see it.

8. **Capability coverage asserts cli and mcp parity; `web` has no analogue.**
   `impl/src/surface-capability-catalog.mjs:464-465` computes only
   `missingCli` / `missingMcp`, and the throw at `:489-491` tests only those two plus
   `uncategorized`, `unrepresentedMcpTools`, `emptyCategories`. `web` is a first-class surface in
   the same file (`:402`) and in the unified registry (`control-surface-unification.mjs:4`), and its
   admitted set is separately hand-maintained at `web-northbound.mjs:152-165`, but nothing asserts a
   `parityRequired` row is reachable there.

9. **No proof that a tool dispatches the command it advertises.** The probe records which command
   arrived (`applicationCalls.push(name)` in `surface-gate.mjs:87`) and then only asks whether the
   *observed* commands are bridge-admitted (`:138-140`). Nothing compares an observed command to
   `commandForTool(tool.name)`. A tool rewired to a sibling command — `baton_decision_list` calling
   `run.attention.list` — is still "reached" and still green. I confirmed the gate's baseline
   classification is 101 reached / 28 typed-refusal / 1 substantive / 1 skipped of 131 advertised
   tools; of the 101, the only evidence recorded is the command string, never its identity.

10. **`_admits` accepts the card snapshot, not the live card.** `mcp-web-bridge.mjs:127-130`
    `_admits(name) { return typeof name === 'string' && name !== 'application.shutdown' &&
    (ORDINARY_COMMANDS.includes(name) || this._card.commands.includes(name)); }` reads `this._card`,
    frozen at construction (`:105`, `this._card = Object.freeze(clone(applicationCard));`). Session
    churn *is* re-attested live per call (`:141-142`, `const current = await this.client.session();
    if (digest(current) !== this._sessionDigest)`), so freshness is asymmetric: a rotating session is
    caught, a resident that grows a command is refused until the MCP server restarts.

---

## ERRORS

11. **confidence: high — the surface gate accepts a typed refusal as proof that a tool is wired, and
    `TypeError` is one of those refusals.** `surface-gate.mjs:148-154`:
    `if (response?.result?.isError === true) { ... if (code === 'forbidden') findings.push(...);
    continue; // any other typed refusal is a resolved path }`.
    `mcp-northbound.mjs:395` maps an internal fault into the same lane:
    `if (['ModelSelectionError', 'SessionSelectionError', 'DuplicateTaskIdError', 'UnknownVendorError',
    'DependencyCycleError', 'TypeError'].includes(cause?.name)) return 'invalid_command';`
    Mutation proof (file restored, hash verified): rewriting `this.application.decisionList(` →
    `this.application.decisionList_MUTANT(` makes `baton_decision_list` return
    `typed_refusal:invalid_command` — the exact unwired-name signature the file's own comment at
    `surface-gate.mjs:52-57` claims to catch — and `node impl/scripts/surface-gate.mjs` still prints
    `surface-gate: ok` with exit 0.

12. **confidence: high — the probe's coordinator is a total proxy, so "reached the coordinator"
    proves nothing.** `surface-gate.mjs:91-96`:
    `const coordinator = new Proxy({}, { get: (_target, property) => (typeof property === 'string'
    ? (...args) => { coordinatorCalls.push(property); return { ok: true, result: 'ok', args }; } :
    undefined), has: () => true, });`.
    Mutation proof: rewriting all 29 `this.coordinator.<method>(` call sites in
    `mcp-northbound.mjs` to nonexistent `<method>_MUTANT` names changed **0 of 131** tool
    classifications, and the gate stayed green. A typo'd, renamed, or deleted coordinator method is
    invisible.

13. **confidence: high — three headline verbs are "proven" by a refusal the probe itself caused.**
    The probe's application mock implements five members (`surface-gate.mjs:83-90`:
    `card`, `authorizeReplay`, `command`, `contextEval`, `decisionList`) but not `actionAuthority`.
    `baton_run_act`, `baton_run_do` and `run.act` therefore fail inside dispatch and surface as
    `typed_refusal:application_unavailable`, which item 11's branch accepts. Adding an
    `actionAuthority` method to the mock flipped exactly those three from refusal to genuinely
    reached (`app=["DIRECT:actionAuthority","CMD:run.act"]`). The probe's own incompleteness is
    indistinguishable from a legitimate refusal.

14. **confidence: medium — the gate's proof rests heavily on refusals, not dispatch.** Baseline:
    28 of 131 advertised tools (21%) are classified as resolved *only* because they returned a typed
    refusal; the codes include `application_unavailable` (`baton_run_act`, `baton_run_do`, `run.act`),
    `invalid_run_command` (`baton_waves_attach`, `baton_swarm_update`, `run.answer`),
    `artifact_unavailable` (`baton_package_read`). Given items 11-13, a refusal is not evidence of a
    live path, and the gate treats it as one for a fifth of the surface.

15. **confidence: medium — three dispatch maps over the same tool table can drift, and the counts
    already differ.** `mcp-northbound.mjs:2540-2551` exposes
    `mcpApplicationToolNames()` (47), `mcpAdvancedToolNames()` (19), `mcpCombinedToolNames()` (131),
    `mcpDispatchToolNames()` (`[...Object.keys(APPLICATION_TOOL)].sort()`, 87). The combined surface
    therefore advertises 44 tools with no entry in the dispatch map, whose `commandForTool` is `null`
    — the set that items 7 and 13 show is exempt from both proofs.

16. **confidence: medium — vestigial route filters that no longer match any route.**
    `application-deployment.mjs:744-758` builds
    `configured = { codex: ..., grok: ..., 'kimi-code': ..., 'claude-code': true, deepseek: true, omp: true }`
    and filters with `:759` `DEFAULT_ROUTES.filter((route) => configured[route.harness] === true)`.
    No row of `DEFAULT_ROUTES` has `harness: 'deepseek'` (they are `omp`), so that key matches
    nothing, while `glm` — which `builtInAdapters` still implements at `:954-966`,
    `} else if (route.harness === 'glm') { const allowedModels = new Set(['glm-5.2', 'glm-5.3']);` —
    is absent from the map. `locallyReadyRoutes` has the same shape of hole (`:728-735` branches on
    codex/grok/kimi-code/claude-code/omp, else `false`). A caller-supplied `routes` entry with
    harness `glm` is therefore silently dropped by both local filters; the trap is latent, not live.

17. **confidence: low — a genuine race window between the two lease checks.**
    `resident-authority.mjs:174-181` re-stats and re-reads the lease before reclaiming
    (`const observed = lstatSync(path); const current = safeRegular(join(path, 'owner.json'), ownerUid, 16 * 1024);
    if (observed.dev !== stat.dev || observed.ino !== stat.ino || !current.equals(raw)) { throw ... }
    rmSync(path, { recursive: true, force: false });`). The compare-then-`rmSync` is not atomic, so a
    second process winning the `mkdirSync` between the compare and the removal would have its fresh
    lease deleted. The window is narrow and the loser's next `assertHeld` fails closed
    (`:204-212`), which is why this is low rather than high.

18. **confidence: low — `surface-gate.mjs:165` reports an omission on stderr while exiting 0.**
    `if (omittedOverResident.length > 0) process.stderr.write(...)` for the three host-local tools
    (`baton_scratchpad_elevate`, `baton_scratchpad_settle`, `baton_knowledge_settlement_lease`).
    Nothing in the exit code or stdout distinguishes "checked and clean" from "checked, with three
    tools excluded", so a CI log line is the only trace.

---

## IMPROVEMENTS

19. Make the refusal lane honest in `surface-gate.mjs:148-154`: treat `invalid_command` and
    `application_unavailable` as *findings* ("path unproven"), not resolution. They are produced by
    internal faults (`mcp-northbound.mjs:395`, `TypeError`), which is exactly the class the probe
    exists to catch. (Fix for items 11 and 14.)

20. Replace the total-proxy coordinator (`surface-gate.mjs:91-96`) with an object that records and
    throws on unknown properties, or assert the recorded property against a real method inventory of
    the coordinator. A mock that answers every question cannot fail. (Fix for item 12.)

21. Give the probe's application mock the full method surface of the real application — starting
    with `actionAuthority` — or derive the mock from the real class's prototype so an omission is a
    test error rather than a passing refusal. (Fix for item 13.)

22. Compare observed commands to declared commands: in `surface-gate.mjs:138-140`, assert
    `applicationCalls.slice(before)` equals `commandForTool(tool.name)` when the latter is non-null.
    This converts reachability into dispatch identity. (Fix for item 9.)

23. Add `missingWeb` beside `missingCli`/`missingMcp` in `surface-capability-catalog.mjs:464-465`
    and include it in the throw at `:489-491`, deriving the web admitted set from
    `webAdmittedCommandNames()` the way the MCP set is derived from `mcpCombinedToolNames()`.

24. Retire `SURFACE_ALIAS_CORRECTIONS` by fixing `application-semantics.mjs:1989` to name
    `decision.list`, so the registry and the dispatch agree and the projection stops carrying a
    private exception. `correctedAliasCanonical` (`control-surface-unification.mjs:39-44`) reads only
    `surface`, `name` and `canonical`; the `supersedes` field (`:27`) is never consumed, so the
    ledger's own rationale is unreachable from code.

25. Generate the "Fleet routes" table from `DEFAULT_BATON_DEPLOYMENT_ROUTES`
    (`application-deployment.mjs:2207`) as a third `TARGETS` entry in
    `render-surface-docs.mjs:151-154`, and render the readiness predicate from the `route.harness
    === 'omp' ? ...` chain at `application-deployment.mjs:728-735` rather than the prose "Ready when"
    column. (Fix for item 1.)

26. Delete the vestigial `deepseek: true` key and add the `glm` branch consistently in both
    `locallyConfiguredRoutes` and `locallyReadyRoutes` (`application-deployment.mjs:744-758`,
    `:728-735`), or drop the `deepseek`/`glm` adapter branches entirely if caller-supplied routes are
    no longer supported. (Fix for item 16.)

27. Make the `fleet_drain` exemption a declared, checked property rather than a literal:
    `surface-gate.mjs:119` could assert the exemption list equals a constant that a test owns, so a
    second exemption cannot be added silently.

---

## NOVEL INSIGHTS

28. **The doc-truth machinery protects prose about verbs and tools, not prose about routes.** The two
    generated blocks are byte-checked (`render-surface-docs.mjs:160-162`), and the doc-truth test
    only scans prose for forbidden claims (`impl/test/doc-truth-conformance-red.test.mjs:396-399`
    reads CLI.md for `run steer`). So the one document table an operator routes work from — which
    harness/model pairs exist — is the one with neither a generator nor a scanner. This is
    self-consistent with the repo's own thesis and is exactly the kind of drift the thesis predicts.

29. **The surface gate proves reachability, and nothing above it proves identity.** `tool → command`
    is declared once (`commandForTool`, `mcp-northbound.mjs:1050-1052`), dispatch is branched by
    tool name (`:2023`), and the union of the two is only ever tested for "some authority was
    touched". Nothing in the repo asserts the declared mapping and the executed branch agree, which
    is why a name can be advertised on one surface (`mcpCombinedToolNames`, 131) and absent from the
    dispatch map (87) without any check noticing (item 15).

30. **Freshness in the resident bridge is asymmetric by design, not by intent.** The facade
    re-attests the *session* on every call (`mcp-web-bridge.mjs:141-142` compares a live
    `client.session()` digest to a construction-time digest) but binds its *authority* to a
    construction-time card clone (`:105`, read by `_admits` at `:127-130`). An operator who adds one
    route to the resident sees it refused by MCP until restart, while a session that rotates is
    handled without restart. One of the two should follow the other.

31. **The registry is corrected where it is consumed, not where it is written.** Item 2's stale row
    is the single entry in a correction ledger (`control-surface-unification.mjs:22-30`) whose
    `supersedes` field is dead, and that ledger is folded into the registry digest
    (`:221`, `aliasCorrections: SURFACE_ALIAS_CORRECTIONS`). The digest therefore changes when the
    exception list changes — a consumer pinning the digest cannot tell a real surface change from a
    ledger edit.

32. **The three-way surface split is maintained by three different mechanisms.** MCP advertisement
    is a projection of `APPLICATION_COMMAND_DEFINITIONS` plus a reflex/matrix table
    (`mcp-northbound.mjs:22-30`, `:1017-1019`); web admission is a hand-written map plus spreads
    (`web-northbound.mjs:152-165`); CLI inventory is derived from the web whitelist plus host-local
    exceptions (`render-surface-docs.mjs:27-76`, `const HOST_LOCAL_CLI_KEYS = new Set(['run.debug']);`
    and the special-case at `:67-69` that re-adds `run.send` by hand). Each is defensible alone; the
    union of the three is only asserted for cli+mcp (item 8).

---

## First five fixes

33. `surface-gate.mjs:148-154` — stop treating `invalid_command` / `application_unavailable` as
    resolution (item 11; this is the one that makes the gate honest).
34. `surface-gate.mjs:91-96` — make the coordinator mock fail on unknown properties (item 12).
35. `surface-gate.mjs:83-90` — complete the application mock (or derive it), starting with
    `actionAuthority` (item 13).
36. `surface-capability-catalog.mjs:464-465` — add `missingWeb` (item 8).
37. `application-semantics.mjs:1989` — fix the alias row at the source and delete
    `SURFACE_ALIAS_CORRECTIONS` (item 2/24).
