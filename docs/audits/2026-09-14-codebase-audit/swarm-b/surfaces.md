# swarm-b / surfaces — audit report (work-surfaces)

Auditor: participant `surfaces`. Scope: application* CLI/client/deployment/host, control-surface-unification, mcp-northbound, mcp-web-bridge, web-northbound, resident-authority, scripts (baton/mcp-stdio/mcp-web/surface-gate), CLI.md, MCP.md, and the harness adapters (adapter, cli-adapters, omp-rpc, claude-session, codex-appserver, grok-acp, kimi-acp). Focus: silent failures, non-converging waits, state lies, agentic experience.

## FRICTIONS

F1. Vendor stderr is thrown away on every CLI/app-server tier, so crash receipts can't say why. `child.stderr.on('data', () => {}); // discard; errors surface via the event stream / exit code` (impl/src/cli-adapters.mjs:322; same at impl/src/omp-rpc.mjs:192, impl/src/codex-appserver.mjs:395, impl/src/grok-acp.mjs:360). An auth-failed codex that prints its reason to stderr and exits 1 becomes `error: `exited ${code} (${signal})` (impl/src/cli-adapters.mjs:421) — the operator re-runs the same dead route blind.

F2. omp spawn's receipt reports a sessionId it did not observe. `return { ok: true, sessionId: session.observedSessionId ?? (session.process.child?.pid ? `omp-pid-${session.process.child.pid}` : null) };` (impl/src/omp-rpc.mjs:965). `observedSessionId` is set by the fire-and-forget `get_session_stats` at :950-956, which cannot have resolved yet, so the run record's session identity is always the pid pseudo-id while the death cert later carries the real one — two identities for one session, and `--resume` consumers see the fake one first.

F3. Interrupt/kill of an unknown worker resolves `{ ok: true }` — success for nothing. `return { ok: true, emulated: true }; // subprocess interrupt is emulated` (impl/src/cli-adapters.mjs:460-461; kill same pattern :462-475; impl/src/omp-rpc.mjs:1090 `return { ok: true, terminal: true };`; impl/src/claude-session.mjs:1476/1574). D9 makes acks non-authoritative, but the ack carries no "this worker is unknown; no confirmation will ever arrive" hint, so a typo'd worker id looks controlled until the orchestrator's wait starves.

F4. `reconcile` bounds every admitted command by the client's 30s default even when the work legitimately runs longer: `throw cliError('Baton Web command remains admitted', 'cli_command_pending');` (impl/src/application-cli.mjs:2421, deadline from `commandTimeoutMs`, default 30_000 at impl/scripts/baton.mjs:48). The commandId is minted internally, so the CLI operator has no reattach path — the work continues server-side while the surface reports failure.

F5. `nudge` is per-harness roulette: buffered by codex (`session.nudgeQueue.push(content)` impl/src/codex-appserver.mjs:995) and grok (impl/src/grok-acp.mjs:871), steer-or-turn in omp (impl/src/omp-rpc.mjs:1003-1012), wire-identical to turn in claude (impl/src/claude-session.mjs:1457-1461), but refused by kimi: `return { ok: false, notSent: true, reason: `Kimi ACP ${mode} is unsupported` };` (impl/src/kimi-acp.mjs:634). An orchestrator cannot rely on the one steering verb every brief advertises.

F6. `budgetUsed.tokens` reports 0 when usage is actually unknown: `budgetUsed: { tokens: tokens ?? 0, usd: exactUsd ?? 0 }` (impl/src/cli-adapters.mjs:214; same shape impl/src/claude-session.mjs:488, impl/src/codex-appserver.mjs:205-214) while the companion `usageSeal` says `{ tokens: 'unavailable', ... }`. Any consumer that folds the WorkerResult instead of the seal books unknown-cost turns as free.

F7. A failed prompt write leaves an eternally open turn: `session.process.send({ type: 'prompt', ... }).catch(() => {})` (impl/src/omp-rpc.mjs:611-614) — `turn_started` was already broadcast at :605, the write refusal is observed only as a stall notice, and by the TERMINALITY law nothing but process exit will ever settle that turn.

F8. Malformed NDJSON lines vanish without count or receipt: `try { frame = JSON.parse(line); } catch { continue; }` (impl/src/omp-rpc.mjs:335; same tolerance impl/src/claude-session.mjs:1018, impl/src/codex-appserver.mjs:553-554). A degrading wire is invisible unless a frame happens to cross the byte ceiling.

## GAPS

G1. cli-adapters has no transport-liveness or stall receipt at all — omp emits a `provider_dial_never_observed` baseline (impl/src/omp-rpc.mjs:941-946), but the one-shot CLI tier emits nothing between `process_started` and the terminal, so a silent-from-birth worker is indistinguishable from a slow one.

G2. The legacy SubprocessAdapter tier can never execute yet ships full cards: `throw new Error('SubprocessAdapter: live execution path is not implemented in this MVP');` (impl/src/adapter.mjs:753, family at :726-822). Its prompt/interrupt/approve/answer/kill all return `{ ok: false, reason: '...not implemented' }` (:764-768) — kept alive next to the real families in cli-adapters/claude-session.

G3. Web admission failures are cause-free 503s: `} catch { return error(503, 'temporarily_unavailable'); }` around `admitWebCommand` (impl/src/web-northbound.mjs:1075-1077; the same bare-catch pattern repeats at :1089, :1098, :1104, :1131, :1138, :1144). Ledger corruption and a closed edge are indistinguishable to the client.

G4. kimi's question channel is an admitted dead end: `async answer() { return { ok: false, reason: 'Kimi question elicitation is not yet schema-pinned' }; }` (impl/src/kimi-acp.mjs:670) while grok refuses with a named contract reason (impl/src/grok-acp.mjs:952-956) and omp implements full validation (impl/src/omp-rpc.mjs:1053-1086) — three different stories for one adapter-contract verb.

G5. `swarm watch --follow` wake truth depends on runtime-state strings: `const LIVE_RUNTIME_STATES = new Set(['pending', 'working', 'blocked', 'idle', 'stopping']);` (impl/src/application-cli.mjs:1338) — a new participant runtime state silently reads as "not alive" and ends the follow early.

## ERRORS

E1. [high] CLI.md's fleet-route table contradicts the zero-assembly deployment. Doc: `| `glm` | `glm-5.2` | low/medium/high/xhigh/max | repo `glm_key.json` present |` and `| `deepseek` | `deepseek-v4-flash` (primary) | low/medium/high/xhigh/max |` (impl/CLI.md:227-229). Code registers glm/deepseek on omp with different ids and ladders: `harness: 'omp', model: 'zai/glm-5.3-flash', effort` with `GLM_EFFORTS = ['low', 'high', 'max']` (impl/src/application-deployment.mjs:95-101) and `harness: 'omp', model: 'deepseek/deepseek-flash'` (:102-108). The doc's harness names, model ids, and effort sets are stale for the #228 omp migration.

E2. [high] omp route readiness is keyed on credential files the omp adapter never reads. `: route.harness === 'omp' ? existingRegular(join(repoRoot, 'deepseek_key.json')) || existingRegular(join(repoRoot, 'glm_key.json')) : false` (impl/src/application-deployment.mjs:733-734). omp's actual auth is `~/.omp/agent`: `if (existingRegular(join(ompRoot, 'agent', 'agent.db')))` projecting `.omp/agent/agent.db`, `config.yml`, `models.yml` (:694-703). `baton doctor` can mark `zai/glm-5.3-flash` ready because a deepseek claude-compat key exists, and blocked when `~/.omp/agent` is the real gate.

E3. [medium] The two route-list derivations disagree with each other. `locallyReadyRoutes` gates omp on repo key files (:728-735) while the configured map hard-codes `omp: true,` with the comment "its inventory is honest pre-credential" and `'claude-code': true,` (:746-758). Same deployment, two answers depending on which function a caller hits.

E4. [medium] CLI.md's claude-code ready-when is not what gates the route. Doc: `| `claude-code` | `claude-opus-4-6` | low/medium/high/xhigh/max | bounded version + `auth status` probes |` (impl/CLI.md:225). Code: `const claudeReady = existingRegular(join(homedir(), '.claude', '.credentials.json'));` (impl/src/application-deployment.mjs:722) or unconditionally true (:746-758, whose own comment admits it is "deployment configuration rather than an ambient executable/authentication observation"). The `auth status` probe exists only inside ClaudeSessionCli.authenticationReadiness (impl/src/claude-session.mjs:550-593), not in route admission.

E5. [medium] grok-acp re-issues timed-out setup RPCs with fresh ids — the exact effect-duplication the house law forbids. The retry ladder `const attempt = (n) => this._sendRequestOnce(session, method, params, bound).catch(...)` re-sends session/new / session/load after `grok_transport_timeout` (impl/src/grok-acp.mjs:306-320). omp records the opposite rule: "a timed-out command is therefore NEVER re-sent: a fresh id would duplicate the native effect" (impl/src/omp-rpc.mjs:236-243, header :15-17). A slow-but-successful session/new orphans a live native session inside the child.

E6. [medium] kimi interrupt reports success without checking delivery: `await session.process.notify('session/cancel', { sessionId: session.sessionId }); return { ok: true };` (impl/src/kimi-acp.mjs:649-650). Sibling grok checks the write and refuses: `if (!written) { session.pendingFollowUp = null; return { ok: false, reason: 'grok agent stdio closed before interrupt delivery' }; }` (impl/src/grok-acp.mjs:918-919). Kimi's pendingInterrupt is then never confirmed — a stop that silently didn't start.

E7. [medium] cli-adapters swallows worktreeReady failure and spawns in a fallback cwd; the session tier refuses instead. `if (opts.worktreeReady) { try { const r = await opts.worktreeReady; if (r && r.path) cwd = r.path; } catch { /* surfaces below */ } }` (impl/src/cli-adapters.mjs:283) — "below" is just `if (!cwd)`, so a prepared-worktree rejection silently downgrades to the raw worktree. claude-session refuses (`if (!cwd) return { ok: false, reason: 'spawn requires a worktree...' }`, impl/src/claude-session.mjs:746) and codex calls the silent-wrong-cwd case a named failure class (impl/src/codex-appserver.mjs:794-796).

E8. [medium] The brief renderer's two-field effect convention silently drops the mutation-authority section. `if (Array.isArray(brief.requiredEffects) && brief.requiredEffects.includes('repository_edit')) {...} else if (Array.isArray(brief.effects) && !brief.effects.includes('repository_edit')) {...}` (impl/src/adapter.mjs:134-140). A brief with effects including repository_edit and no requiredEffects matches neither branch — no mutation authority and no read-only notice. The workflow normalizer manufactures exactly that shape (`requiredEffects: stringArray(node.requiredEffects ?? [], ...)` impl/src/workflow-definition.mjs:110) while the plan normalizer refuses the same omission (`fail('plan node omits repository_edit from requiredEffects without the analysis:true field'...)` impl/src/goal-plan.mjs:358-360).

E9. [low] Entry-script help path can crash on parsed.args being undefined: `process.stdout.write(`${batonCliHelp(parsed.topic ?? parsed.args.topic)}
`);` (impl/scripts/baton.mjs:122) versus the guarded `parsed.topic ?? parsed.args?.topic` one line up (:120).

E10. [low] MCP.md's own inventory labels the settlement tools kernel while the code serves them on the documented default surface. Table rows `| `knowledge.promote` | `kernel` | `baton_knowledge_promote` |` (impl/MCP.md:188-189, :209-210) versus the implementation registering them as "the ordinary-surface wave ergonomics, doctor, and settlement tools" (impl/src/mcp-northbound.mjs:128-144, definitions at :733-756) and MCP.md:46-47 itself calling settlement part of the ordinary application surface.

## IMPROVEMENTS

I1. Capture a bounded stderr tail into lifecycle.crashed payloads on the cli/app-server/acp tiers (claude-session already owns the canary plumbing at impl/src/claude-session.mjs:1070-1084 — reuse it for diagnosis, not just secrets).

I2. Make unknown-worker interrupt/kill acks self-describing: return `{ ok: true, known: false }` (or `terminal: false, reason: 'unknown worker'`) so D9's "ack is not confirmation" is observable at the ack site (impl/src/cli-adapters.mjs:460, impl/src/omp-rpc.mjs:1090).

I3. Derive omp route readiness from the projected .omp/agent/agent.db tree and collapse locallyReadyRoutes and the configured map into one derivation (impl/src/application-deployment.mjs:694-703, :728-758).

I4. Give grok's setup retries replay safety: correlate the retry to the same wire id or probe for the first response before re-issuing session/new (impl/src/grok-acp.mjs:306-320).

I5. Check notify's return in kimi interrupt/steer and refuse undelivered stops the way grok does (impl/src/kimi-acp.mjs:631, :649).

I6. Emit a wire.frame_parse_failed counter/receipt alongside the tolerant continue so NDJSON degradation is measurable (impl/src/omp-rpc.mjs:335).

I7. Unify the module-config MCP surface default — entry script `configured.surface ?? (configured.application ? 'combined' : 'advanced')` (impl/scripts/mcp-stdio.mjs:30) vs class `opts.surface ?? (this.application ? 'application' : 'advanced')` (impl/src/mcp-northbound.mjs:1513).

I8. Render the mutation-authority section from one predicate over the union of effects and requiredEffects so the two spellings can't both miss (impl/src/adapter.mjs:134-140); add optional chaining at impl/scripts/baton.mjs:122.

## NOVEL INSIGHTS

N1. The fate clock is dead in triplicate but its corpse is load-bearing. `_onWallTimeout` is defined and never invoked in three adapters (impl/src/claude-session.mjs:1642-1650, impl/src/codex-appserver.mjs:1124-1132, impl/src/grok-acp.mjs:979-987); `wallTimer` is cleared but never assigned (claude-session :1427/:1604/:1638, codex :508/:719, grok :384/:628, kimi :594); the `timeoutFailure` close-branches can consequently never fire (claude-session :1607/:1610, codex :512/:516). Meanwhile the one-shot tier still runs a live wall-clock SIGKILL — `session.timeoutFailure = { error: `session wall-time budget exceeded (${opts.timeoutMs}ms)` ...` then `this._signal(worker, 'SIGKILL');` (impl/src/cli-adapters.mjs:348-354) — the exact mechanism the "#163 law" comments say was removed ("the wall-time fate clock is GONE — opts.timeoutMs is accepted for back-compat and deliberately ignored", impl/src/claude-session.mjs:869-871, impl/src/codex-appserver.mjs:861-862). One law, two tiers enforcing opposite answers, plus dead code that would reinstate it if ever wired.

N2. The terminal-event contract drifts between siblings while claiming to be one contract. omp emits flat `{ status, summary, artifacts, openQuestions, usageSeal }` (impl/src/omp-rpc.mjs:669-679) and its comment claims "the sibling session-CLI contract (claude-session emits status/summary/artifacts on turn_completed)" (:658-663) — but claude-session actually emits `{ result: makeResult(status, ...), usageSeal, ... }` (impl/src/claude-session.mjs:1270-1279), as do codex (impl/src/codex-appserver.mjs:730) and grok (impl/src/grok-acp.mjs:649). The comment documents the shape omp wishes existed; any trust-gate/referee consumer must special-case omp.

N3. Two adapter generations coexist with contradictory authority stories. adapter.mjs's tier advertises `permissions: { mode: 'never', sandbox: 'danger-full-access', boundary: 'Unattended full host permissions by default...' }` (impl/src/adapter.mjs:780) while the live tiers moved the same facts into attestable workerPolicy blocks (e.g. impl/src/codex-appserver.mjs:301-316). The dead tier's cards still answer card() with the pre-attestation worldview — a registry that enumerates adapters inherits two vocabularies.

N4. Four timeout philosophies over one RPC shape. omp: no command timeout, never re-send (impl/src/omp-rpc.mjs:236-243; ready-wait ladder :41 with stall-and-continue :212-219). codex: bound every client RPC and reject (impl/src/codex-appserver.mjs:377-387). grok: bound, retry with fresh ids (impl/src/grok-acp.mjs:306-320). kimi: bound setup only, prompt explicitly unbounded `{ timeoutMs: null }` (impl/src/kimi-acp.mjs:425-427). Nothing cross-checks these against the operator laws they each cite.

N5. The anti-wedge rule inverted between the two ACP adapters. codex answers an unmapped server-to-client request on the wire and keeps the turn alive: "Reply with a method-not-found error... never a silent drop (XA17 keeps 'never crash'; this adds 'never wedge')" (impl/src/codex-appserver.mjs:630-636). kimi kills the child for the same condition: `void session.process.kill(); throw Object.assign(new Error(`unsupported Kimi reverse request ${method}`), { code: -32601 });` (impl/src/kimi-acp.mjs:565-568). A new reverse-request type in a CLI update is a refused call on one harness and a member crash on the other.

N6. The CLI doc carries one truth in two vocabularies. The generated table claims completeness from the executable inventory ("produced from the executable ordinary-CLI principal inventory (parser + web-client whitelist + host-local ops), never a hand list", impl/CLI.md:8-9, conformance-pinned :15-16), yet the prose teaches baton run status/show/progress/events/output — verbs that exist only as registry folds into run.view/run.watch (impl/src/application-semantics.mjs:1915-1917, :1957-1959) and therefore cannot appear in the canonical table. A reader diffing prose against table concludes the doc lies; the truth is a fold the table cannot express.

N7. Deepseek's doc describes the retired path as the primary one. impl/CLI.md:231-241 specifies "The deployment projects, for deepseek routes only, { authTokenFile, authTokenJsonPointer: '/deepseek_key', baseUrl, harness: 'deepseek' }" with deepseek-v4-flash as "the primary... and the adapter default" — but DEFAULT_ROUTES put deepseek on omp native (:102-108) and the claude-compat DeepseekSessionCli branch survives only behind explicit advanced.routes (impl/src/application-deployment.mjs:945-953, where deepseek-v4-flash is the only admitted model of that legacy tier).

## TOP 5 TO FIX FIRST

1. E1+E2+E3 (impl/CLI.md:220-241 vs impl/src/application-deployment.mjs:95-114, :694-735, :746-758): the route table, the ready-when column, and both readiness derivations disagree with each other and with the omp migration. Doctor/route selection — the first surface every orchestrator touches — is currently licensed to lie.
2. E4 (impl/CLI.md:225 vs application-deployment.mjs:722/:746-758): same lie one row over; fold the claude auth status probe (claude-session.mjs:550-593) into route admission or fix the doc.
3. N1 (dead _onWallTimeout/wallTimer/timeoutFailure in three adapters vs live timeout kill in cli-adapters.mjs:348-354): delete the vestiges or re-wire them — today the TERMINALITY law is enforced by tier lottery.
4. E8 (adapter.mjs:134-140 + workflow-definition.mjs:110 vs goal-plan.mjs:358-360): repository_edit briefs from the workflow path silently lose both the mutation-authority section and the required-effect gate.
5. E5+E6 (grok-acp.mjs:306-320, kimi-acp.mjs:649-650): the two newest adapters respectively duplicate possibly-succeeded native effects and report undelivered stops as delivered — both silent-failure classes the rest of the codebase pays typed refusals to avoid.
