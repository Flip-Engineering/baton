# Grok Build ACP SESSION adapter — spec (phase 9, cluster: Grok control plane)

*Fills the Grok row of `spec/adapter-contract.md` with a session-shaped implementation over
`grok agent stdio` (native ACP). Same normative posture as `spec/phase8/codex-appserver-adapter.md`:
every contract below is a refinement within RECONCILIATION.md D1/D3/D9, never a contradiction.*

**Ground truth.** Wire claims are pinned from `docs/reference/grok-build-cli.md` (grok 0.1.216):
the **[live]** facts are the unauthenticated `initialize` handshake (verbatim frames committed at
`docs/reference/evidence/grok-0.1.216/grok-acp-probe2.jsonl`) and the `session/new` auth-gate error
`{"code":-32000,"message":"Authentication required","data":"no auth method id provided"}`. Turn-level
semantics (`session/prompt`/`session/update`/`session/cancel`/`session/request_permission`) are
**[acp-spec]+[doc]**-grade — the bundled user guide claims ACP conformance and the ACP spec pins the
shapes, but grok's own conformance is NOT yet live-verified because every model-side call is
auth-gated on this machine.

**⛔ Live-smoke gate (docs/23 standing rule).** This adapter is *buildable and fake-provable* now,
but it is **not "done"** until each verb its card declares `native` has been smoked against the real
binary post-`grok login` (or `XAI_API_KEY`) and the fake corrected to what live shows. The phase-8
lesson is the whole reason this paragraph exists: all three live-breaking claude-adapter defects sat
exactly where the fake mirrored the adapter's assumptions instead of the vendor's behavior.
Post-auth smoke checklist (in order):
1. `session/cancel` conformance — does the outstanding `session/prompt` resolve
   `{stopReason:"cancelled"}` and does the session survive for another prompt? (GA8's whole basis)
2. What is `cancelRewind:true` (live-advertised, undocumented) — does cancel restore files?
3. `session/request_permission` — exact params (toolCall/options vocabulary) and whether it fires at
   all under default config (`[features] support_permission = false` appears in the config doc).
4. Mid-turn second `session/prompt` — rejected, queued, or spliced? (If spliced, GA13's emulated
   steer gets upgraded to native, exactly like claude E2.)
5. `agent_message_chunk` / `tool_call` update payload shapes; any usage/token `_meta`.

---

## 1. Transport & isolation (GA1–GA5)

**GA1 — One `grok agent stdio` child per WORKER.** Same isolation rationale as XA1: every worker
independently interruptible without contending for a shared connection. Grok's first-party shared
**leader process** (`--leader`) is a legitimate future transport behind the same Adapter interface
— explicitly out of scope here, and its multi-client fan-out semantics are an open unknown in the
dossier anyway.

**GA2 — JSON-RPC 2.0 over stdio NDJSON, `jsonrpc:"2.0"` INCLUDED.** [live] Grok's wire carries the
`jsonrpc` member in both directions (unlike codex, which omits it). Client requests:
`{jsonrpc, id, method, params}`, monotonic integer ids per child. Server→client requests
(permissions) arrive in the SERVER's id space; the adapter echoes that id back unchanged.
`protocolVersion` is the **integer** `1` [live] (the bundled doc's string `"1"` is wrong).

**GA3 — Setup RPCs bounded; the prompt request deliberately UNBOUNDED.** `initialize` and
`session/new` are guarded by `requestTimeoutMs` (constructor-required, or `stopDeadlineMs`
mirroring the Coordinator's option name — same no-invented-constant rule as XA3; missing both
throws `TypeError`). **`session/prompt` is exempt**: in ACP the prompt request's *response is the
turn's terminal* — it legitimately stays pending for the turn's whole lifetime (minutes). Bounding
it with the setup timeout would kill every real turn. Hang protection for a wedged turn is the
coordinator's stall detection plus `interrupt()`/`kill()`, both of which resolve the pending
prompt (GA8/GA11).

**GA4 — Construction is injectable.** `new GrokAcpCli({ cmd='grok', args=['agent','stdio'], env,
requestTimeoutMs|stopDeadlineMs, ceiling, maxContext=500000, sandbox='workspace',
alwaysApprove=true, versionProbe, spawnFn })`. Tests point
`cmd` at `process.execPath` and `args` at `test/fixtures/fake-grok-acp.mjs --serve`. `maxContext`
defaults to **500000** — not invented: the live handshake's `totalContextTokens` for `grok-build`.

**GA5 — Garbage never crashes; id-less errors surface uncorrelated.** Malformed JSON lines and
unknown/future notification methods are dropped after the line buffer advances. An error frame with
no `id` is emitted as `error {correlated:false}` and never speculatively matched; pending *bounded*
requests still die on their own deadline (the unbounded prompt is resolved by close/cancel paths,
GA8/GA11-close).

---

## 2. Verbs (GA6–GA15)

**GA6 — `spawn(worker, brief, opts)`**: IN ORDER — spawn
`grok --sandbox off agent --always-approve … stdio` (cwd `opts.worktree`) →
`initialize {protocolVersion:1, clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},
terminal:false}}` (baton delegates no client-side fs/terminal to the worker's agent — the worker
does its own work in its worktree) → `session/new {cwd: opts.worktree, mcpServers:[]}` →
`lifecycle.spawned {sessionId, pid}` → dispatch the first turn (below) with
`renderBrief(brief, 'grok-acp')`. The Ack resolves once the first `session/prompt` is **dispatched
after a live handshake** — ACP has no separate turn-accepted response (codex's `turn/start` ack has
no analog); the successful `initialize`+`session/new` round-trips milliseconds prior are the
readiness proof. `--always-approve` removes routine tool prompts and sandbox `off` supplies the
default full-permission launch. Explicit constructor settings may narrow approvals or sandbox access.
The card discloses both settings without claiming same-UID host containment.
Turn identity: **ACP has no wire turn id** — the adapter mints `turnId`
(`t<seq>`) per dispatched prompt and carries `{sessionId, turnId}` on every event payload; the
adapter itself emits `lifecycle.turn_started` at dispatch (there is no `turn/started` notification
to relay).

**GA7 — `prompt(worker, content, mode)`:**
- `mode:'turn'` → a new `session/prompt` on the SAME `sessionId` (native multi-turn; the session
  retains history server-side). Queued nudges are prepended. `turnEpoch` increments. **If a turn is
  already active, resolves `{ok:false, reason}`** — ACP's baseline is one prompt turn at a time;
  mid-turn behavior is protocol-undefined until the post-auth probe (smoke item 4).
- `mode:'nudge'` → 🔧 emulated: buffered, prepended to the next `mode:'turn'`. Ack `emulated:true`.
- `mode:'steer'` → 🔧 **emulated** (GA13). Ack `emulated:true`.

**GA8 — `interrupt(worker, then?)`**: writes the `session/cancel` **notification** (no id, no
response exists to await — the Ack resolves on write; D9: the confirmed stop is exclusively an
event). Per ACP, the agent then resolves the outstanding `session/prompt` with
`{stopReason:"cancelled"}`; the adapter maps that resolution to `control.interrupt_confirmed`
(with a `makeResult('cancelled')` payload) — **the session survives**: a subsequent
`prompt(worker, x, 'turn')` runs on the same `sessionId`. `then` follow-up: issued when the
interrupt-confirmed resolution lands, superseded by any newer interrupt()/kill() (R5.1 discipline).

**GA9 — `approve(worker, requestId, decision, payload)`**: answers a pending
`session/request_permission` server→client request. The request carries ACP `options[]`
(`{optionId, name, kind}` with kind ∈ `allow_once|allow_always|reject_once|reject_always`); the
response is `{outcome:{outcome:'selected', optionId}}` or `{outcome:{outcome:'cancelled'}}`.
D1 mapping (closed enum):

| D1 decision | wire outcome |
|---|---|
| `'allow'` | `selected` — first option with kind `allow_once`, else `allow_always`, else options[0] |
| `'deny'` | `selected` — first option with kind `reject_once`, else `reject_always`, else last option |
| `'cancel'` | `{outcome:'cancelled'}` (per ACP, a cancelled turn's permission MUST resolve cancelled) |

`payload.optionId`, when supplied, overrides the kind-based selection (an orchestrator that
rendered the options can pick exactly). Answer-exactly-once via the keyed `waits` map (X4 lesson
applied from day one); unknown/already-answered requestId → `{ok:false}`, no wire write.

**GA10 — auth-gate is a typed spawn failure.** `session/new` failing with the [live]-pinned
`-32000 "Authentication required"` resolves `spawn() → {ok:false, code:-32000, reason}` after
killing the now-useless child. Never retried internally — authentication is an operator/coordinator
concern (the dossier's §6 paths: `grok login`, `XAI_API_KEY`, or driving `x.ai/auth/*`).

**GA11 — `kill(worker)`**: process-group SIGKILL (child spawned `detached:true`); Ack immediate;
`kill.confirmed` from the child's `'close'` handler. **Close also settles the wire**: any pending
bounded request rejects, and a pending prompt resolves through the crash path (GA18) — except when
`killing` is set, where the prompt's death is absorbed silently (kill.confirmed is the terminal;
a deliberate kill is not a worker crash).

**GA12 — `answer()` is `unsupported`.** ACP has no generic ask-user-a-question primitive and the
`x.ai/*` catalog documents none. `answer()` resolves `{ok:false, reason}` and the card declares
`answer:'unsupported'` — a named gap, not an emulation.

**GA13 — steer = cancel-then-reprompt emulation, WITHOUT phantom interrupt events.** The wire
genuinely lacks steer (ACP baseline has none; none in the `x.ai/*` catalog) — this is the case the
adapter-contract's emulation pattern exists for, *unlike* claude E2 where native existed. Semantics:
`prompt(w, content, 'steer')` with an active turn records a steer-pending marker and writes
`session/cancel`. When the cancelled prompt resolves, the adapter **suppresses**
`control.interrupt_confirmed` (the coordinator issued no interrupt — emitting one would be a
phantom, the exact pollution E2 flagged) and instead emits
`control.steer {emulated:true, resteeredFrom:<turnId>}`, then immediately dispatches `content` as a
new `session/prompt` (new turnId/turnEpoch; session history carries the original context natively).
A newer `interrupt()`/`kill()` supersedes a not-yet-consumed steer marker. No active turn →
`{ok:false}`. Smoke item 4 can upgrade this to native later; the card says `'emulated'` until live
proves otherwise.

**GA14 — `card()`**:
```js
{
  harness: 'grok', version, authPosture: 'subscription',
  concurrencyCeiling,           // injectable; real resource = local CPU/mem + plan concurrency (unpublished)
  maxContext,                   // default 500000 — live handshake totalContextTokens
  verbs: { spawn:'native', prompt:'native', steer:'emulated', interrupt:'native',
           approve:'native', answer:'unsupported', kill:'native', pause:'unsupported' },
}
```
Nothing here is silently emulated: `steer` is declared `'emulated'` at card level AND acked
`emulated:true` per call. `interrupt`/`approve` are declared native on [acp-spec] grounds — the
live-smoke gate above is what stands between this card and "done".

**GA15 — version probed once at construction, cached, never throws** (`grok --version`, injectable
`versionProbe`, `'unknown'` on failure).

---

## 3. Turn terminals & event mapping (GA16–GA20)

**GA16 — single-terminal-per-turn.** A turn = one `session/prompt` request lifetime. Its terminal
is exactly one of `lifecycle.turn_completed` XOR `lifecycle.crashed` XOR
`control.interrupt_confirmed` XOR (steer-consumed) `control.steer`; once terminal, trailing
updates for that turnId are dropped.

**GA17 — malformed/unknown input immunity** (= GA5, test-named separately): garbage lines, unknown
notification methods, and unknown `session/update.sessionUpdate` variants are ignored; the turn
still completes; nothing is mistaken for a crash.

**GA18 — terminal mapping (the ACP difference: the prompt RESPONSE is the terminal):**

| `session/prompt` resolution | BatonEvent | result |
|---|---|---|
| `{stopReason:"end_turn"}` | `lifecycle.turn_completed` | `makeResult('completed')` |
| `{stopReason:"max_tokens"}` / `"max_turn_requests"` | `lifecycle.turn_completed` (payload.stopReason surfaced — budget policy is the coordinator's, GA20) | `makeResult('completed', stopReason)` |
| `{stopReason:"cancelled"}` | `control.interrupt_confirmed` — or consumed by a pending steer per GA13 | `makeResult('cancelled')` |
| `{stopReason:"refusal"}` | `lifecycle.crashed` with `payload.stopReason:'refusal'` — the refusal signal the capability-routing memory needs (GLM non-refuser tier exists precisely because refusals are routable data) | — |
| JSON-RPC **error** response | `lifecycle.crashed` (`payload.error` = wire message) | — |
| transport close mid-turn (not killing) | `lifecycle.crashed` | — |

**GA19 — `session/update` mapping:**

| `update.sessionUpdate` | BatonEvent kind | Notes |
|---|---|---|
| `agent_message_chunk` | `content.message` | payload `{sessionId, turnId, text, chunked:true}` — chunks pass through individually (multiple content.message per turn is already the codex norm per item) |
| `tool_call` | `content.tool_call` | raw update payload carried through; first observation is `requested`, a known call is `progress` |
| `tool_call_update` | `content.tool_call` | status/diff update; a nonterminal first observation establishes the logical request, later observations are `progress`, and terminal statuses remain terminal |
| `agent_thought_chunk` | *(none)* | ignored, matching the codex adapter's reasoning-delta posture |
| `plan` | *(none)* | ignored (D3 has no plan kind); revisit with goal-pinning work |
| anything else | *(none)* | ignored — unmapped events never crash (D3) |

Unmapped **server→client REQUESTS** (any `x.ai/*` method outside `session/request_permission`) are
auto-answered `{id, error:{code:-32601, …}}` + an observable `error {correlated:true, serverMethod}`
event — the X3 anti-wedge rule applied from day one, not retrofitted.

**GA20 — faithful pipe; no wire usage telemetry in this MVP.** The dossier found no documented
token-usage payload on the ACP wire (open unknown; `signals.json` on disk is the post-hoc source).
This adapter therefore emits **no** `resource.tokens` events yet — a *named gap* (vs codex's
per-turn pushes), not an oversight; `makeResult().budgetUsed.tokens` is 0 until the post-auth smoke
discovers a wire source (`_meta` on updates or the prompt response) or a `signals.json` reader is
added at the coordinator layer. Nothing in this adapter gates on budgets (D5/D8).

---

## 4. Fake binary (`test/fixtures/fake-grok-acp.mjs`) — contract it must uphold

A protocol-level double of `grok agent stdio` speaking the pinned wire (JSON-RPC 2.0 **with**
`jsonrpc`, ACP methods, [live] frame shapes), zero quota, no vendor CLI. Discovery guard: exits
inert without `--serve`/`agent` in argv (phase8 R1 lesson — bare `node --test` sweeps up fixtures).
Session ids pid-namespaced (phase8 R2 lesson — per-worker children would otherwise collide).

1. `initialize` → the [live] response shape: `protocolVersion:1`, `agentCapabilities`
   (`loadSession`, `promptCapabilities`, `mcpCapabilities`), `authMethods:[{id:"grok.com",…}]`,
   `_meta` with `modelState` (`grok-build`, `totalContextTokens:500000`), `availableCommands`,
   `cancelRewind:true`.
2. `session/new` → `{sessionId}`; under `FAKE_GROK_UNAUTH=1` → the [live]-verbatim
   `{code:-32000, message:"Authentication required", data:"no auth method id provided"}` error.
3. `session/prompt` → streams `session/update` notifications (two `agent_message_chunk`, one
   `agent_thought_chunk`, one `tool_call`), then resolves the REQUEST with `{stopReason}` —
   honoring directives in the prompt text: `FAKE:CRASH` (error response, message "boom"),
   `FAKE:REFUSAL` (`stopReason:"refusal"`), `FAKE:REQUEST_PERMISSION` (blocks on a
   `session/request_permission` server→client request until answered; `selected` allow-kind →
   "approved: proceeding" + `end_turn`; reject-kind → "declined: skipping step" + `end_turn`;
   `cancelled` outcome → `stopReason:"cancelled"`), `FAKE:SERVER_UNKNOWN_REQUEST` (blocks on an
   `x.ai/*` request baton doesn't map — an error answer unwedges it), `FAKE:STAY_OPEN` (resolves
   only via `session/cancel`), `FAKE:LARGE_TOOL_OUTPUT` (emits oversized raw output and diff
   telemetry for the event-ceiling red), else natural `end_turn` ~10ms.
4. `session/cancel` (notification) → resolves the active prompt `{stopReason:"cancelled"}`; the
   session survives for further prompts.
5. `FAKE_GROK_HANG=1` → `initialize` never answered (times the adapter's bounded setup RPCs).
   `FAKE_GROK_MALFORMED=1` → one invalid-JSON line, one unknown-method notification, one unknown
   `sessionUpdate` variant, and one synthetic id-less error per turn.
6. Unknown methods with an id → id-matched `-32601` (JSON-RPC standard; grok's live unknown-method
   behavior is unprobed — noted, not claimed).

---

## 5. Non-goals / explicit deferrals

- **The one-shot `grok -p` tier** — deliberately not built: one-shot adapters are dispreferred for
  baton's use cases (standing steer), and grok's one-shot stream carries no tool telemetry
  (dossier §4). The wire format is documented in the dossier if it's ever wanted.
- `session/load` resume, `x.ai/session/fork`, `x.ai/rewind/*` — real per docs, out of MVP scope
  (same deferral shape as codex `thread/resume`/`fork`).
- Leader-process transport (`--leader`) and `agent serve` WebSocket — future transports behind the
  same interface.
- MCP server pass-through on `session/new` (`mcpServers` is sent `[]`).
- Reading `signals.json` for usage — coordinator-layer work, not adapter wire truth.
- `createDriver()` assembly — the phase-8.1 re-steer already schedules session-adapter assembly as
  the next milestone; GrokAcpCli joins ClaudeSessionCli/CodexAppServerCli in that batch.

---

## Errata — post-auth live smoke, grok 0.1.216 authenticated, 2026-07-10

The ⛔ gate at the top of this spec is **CLOSED**. Checklist results (raw frames:
`docs/reference/evidence/grok-0.1.216/grok-acp-probe{3,4}.jsonl`; adapter E2E ledger:
`grok-adapter-live-e2e.jsonl` — 8/8 verdicts PASS driving the real binary through the real
adapter):

1. `session/cancel` conforms exactly as GA8 assumed: pending prompt → `{stopReason:"cancelled"}`,
   session survives. **GA8 holds unmodified.**
2. `cancelRewind:true` does not auto-revert files — no adapter impact.
3. `session/request_permission` fires under default config (the `support_permission=false` doc
   ambiguity is resolved — it does not suppress ACP asks). Live options put `allow_always`
   FIRST; GA9's kind-preference (allow → `allow_once` before `allow_always`) picked the
   conservative once-scoped option and the allowed tool ran. **GA9 holds; fake corrected to the
   live-verbatim option list** (`always-allow`/`allow-once`/`reject-once`; no reject_always).
4. Mid-turn `session/prompt` **queues** (not rejected, not spliced) and **cancel kills active +
   queued together**. Consequences: (a) steer stays `emulated` — no native splice exists, the
   claude-E2-style upgrade does NOT apply; (b) GA13's cancel-first-THEN-prompt ordering is
   mandatory, not stylistic — a queue-then-cancel emulation would cancel its own steer content;
   (c) GA7's one-turn-at-a-time `{ok:false}` guard is retained deliberately even though the wire
   would queue: queued turns are invisible to the running turn and silently die on any cancel —
   a hazard baton chooses not to expose.
5. Update shapes confirmed: `agent_message_chunk`/`agent_thought_chunk` as pinned;
   **`tool_call_update` is a second update kind** (status transitions, `kind:"edit"`, diff
   content) → **F2**: mapped to `content.tool_call` alongside `tool_call` (test-locked).
6. **GA20 OVERTURNED — usage is on the wire**: every prompt response carries
   `_meta{totalTokens, inputTokens, outputTokens, cachedReadTokens, reasoningTokens, modelId}` →
   **F1**: adapter emits `resource.tokens {source:'promptMeta', …}` per turn and threads
   `totalTokens` into `makeResult().budgetUsed.tokens` (test-locked).
7. Post-auth model card: `session/new` returns `models` (grok-4.5 default, 500K ctx,
   reasoningEffort high; grok-composer-2.5-fast 200K). `maxContext: 500000` default stands.
8. Live notifications arrive under **`_x.ai/*`** (leading underscore), all ignored by GA19's
   default arm as designed; `available_commands_update` also observed and ignored. One stray
   id-bearing error response (`id:"skills-reload"`) was dropped by the pending-map discipline —
   GA5 held.
9. Fleet-isolation note: the user's global MCP servers + hooks ran inside the session
   (`mcpServers:[]` notwithstanding). Workers should set `GROK_HOME` to a minimal config dir via
   the constructor's `env` — no adapter change required.
10. Recursive Baton review exposed that live `tool_call_update` frames can contain arbitrarily
    large raw command/read/diff payloads. GA19 now applies a deployment-configurable
    `maxEventPayloadBytes` ceiling (64 KiB default) before authoritative logging. Oversized wire
    evidence becomes `{truncated, originalBytes, sha256, preview}` while stable session/update,
    tool-call, status, command, exit-code, and changed-path fields remain available. This is an
    evidence bound, not silent omission: the digest and byte count make truncation explicit and
    reproducible.
11. Phase 59 recursive dogfood against grok 0.2.99 exposed a second wire shape: Grok can emit
    `tool_call` and `tool_call_update` for an ID, then repeat that ID inside
    `session/request_permission`. The permission request remains an `approval.requested`, but its
    `content.tool_call` observation is `progress` when that ID is already known in the active
    turn. Permission-first calls still establish `requested`. This adapter normalization prevents
    one provider action from masquerading as two logical attempts while the coordinator correctly
    retains fail-closed rejection of genuinely repeated `requested` phases (**F3**, test-locked).
12. The same dogfood found Grok Build replaying stale `in_progress` snapshots after a tool call's
    `completed` snapshot. The adapter retains per-turn call phase and suppresses only nonterminal
    regression after a terminal observation; contradictory terminal outcomes still reach the
    coordinator's fail-closed protocol check. This keeps snapshot transport semantics separate
    from Baton's logical-call semantics (**F4**, test-locked).

Suite after corrections: **372/372** (+F1 usage test, +F2 tool_call_update test).
