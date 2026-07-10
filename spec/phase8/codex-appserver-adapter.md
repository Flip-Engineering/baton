# Codex app-server SESSION adapter — spec (phase 8, cluster: Codex control plane)

*Fills in `spec/adapter-contract.md`'s Codex row with a real, session-shaped implementation.
Where this doc gives a concrete decision that `spec/adapter-contract.md` left open (e.g.
per-worker vs shared-daemon transport), that decision is normative for this cluster and is
called out explicitly against RECONCILIATION.md D1/D9/D3. This doc does not amend
RECONCILIATION.md — every contract point below is a refinement within D1/D9/D3, not a
contradiction of them.*

**Ground truth.** All method names, param/response shapes, and decision vocabularies below
are cited verbatim from `codex app-server generate-json-schema` output (codex-cli 0.144.0,
schema bundle at `/private/tmp/claude-501/-Users-wahargis-Development/73adbbf2-a514-4a17-8729-9cda68da5bac/scratchpad/codex-appserver-schema/`),
re-verified live during this phase (see command transcript below) — not trusted from the
dossier alone, per the task's own instruction that the schema outranks the dossier.

```
$ codex --version                         -> codex-cli 0.144.0
$ python3 -c '...ClientRequest.json...'   -> 87 client methods (enum verified)
$ python3 -c '...ServerRequest.json...'   -> 10 server->client request methods (enum verified)
$ python3 -c '...ServerNotification.json...' -> 68 notification methods (enum verified)
```

Confirmed present, wire-exact: `initialize`, `thread/start`, `turn/start`, `turn/steer`,
`turn/interrupt`, `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`,
`item/tool/requestUserInput`, `thread/tokenUsage/updated`, `account/rateLimits/updated`,
`turn/started`, `turn/completed`, `item/started`, `item/completed`. `TurnStartParams` required
= `['input','threadId']`; `TurnSteerParams` required = `['expectedTurnId','input','threadId']`,
response required = `['turnId']`; `TurnInterruptParams` required = `['threadId','turnId']`;
`CommandExecutionRequestApprovalResponse`/`FileChangeRequestApprovalResponse` required =
`['decision']`, decision enum = `accept | acceptForSession | decline | cancel` (plus
amendment-object variants, not used by this MVP); `ToolRequestUserInputResponse` required =
`['answers']`, shape `{answers: {<qid>: {answers: string[]}}}`. All of this matches
`docs/reference/codex-app-server.md` — no drift found this pass.

---

## 1. Transport & isolation (XA1–XA5)

**XA1 — One child `codex app-server` process per WORKER.** `CodexAppServerCli` spawns a
dedicated `codex app-server` child per worker (`cmd`/`args`/`env` all constructor-injectable,
see XA-config below), not a shared daemon behind a broker.

*Justification (vs. shared-server multiplexing):* both the official docs and OpenAI's own
Claude Code plugin document a **-32001 contention hazard** on any shared endpoint — the
server's own ingress-overload rejection, *and* the plugin's private single-flight broker
(`BROKER_BUSY_RPC_CODE = -32001`, "Shared Codex broker is busy.") that only allows
`turn/interrupt` through while another client streams. The plugin's own production fallback on
`-32001` is "close and reconnect with `disableBroker: true`" — i.e., degrade *to* a private
child. Baton's fleet driver needs every worker to be independently interruptible/steerable at
any time without contending with siblings for a shared connection's single-flight slot, so this
adapter starts there directly: **one child per worker is the steady state, not a fallback.**
This trades a larger process count (bounded by `card().concurrencyCeiling`, itself a
constructor-injectable, real-resource-derived number — see D5) for structural elimination of
inter-worker head-of-line blocking. A future shared-daemon transport (for the
`docs/reference/codex-app-server.md` §11 remote-control/foreman topology) is out of scope here
and does not contradict this choice — it would be a *second* transport implementation behind
the same Adapter interface, selected by the hub, not a change to this one.

**XA2 — NDJSON JSON-RPC over stdio.** One JSON object per line, `"jsonrpc"` omitted on the
wire (matches the live-verified 0.144.0 behavior, dossier §2). Client-initiated requests carry
`{id, method, params}`; the adapter assigns monotonically increasing integer ids per child.
Notifications from the server carry `{method, params}` (no id). Server->client requests
(approvals, questions) carry `{id, method, params}` where `id` is the SERVER's id space — the
adapter must echo it back unchanged in `{id, result}`, never reuse its own id counter for it.

**XA3 — Per-request timeout, derived not invented.** Every client-initiated RPC
(`initialize`, `thread/start`, `turn/start`, `turn/steer`, `turn/interrupt`) is guarded by a
timeout. This guards against a real, documented protocol hazard: unknown-method errors on this
wire arrive **id-less** (`-32600`, no `id` field — dossier §9, live-verified), so a request that
hits a version-skewed or wedged server can never be correlated to a rejection and would hang
forever without a client-side deadline. The timeout value is **not a new invented constant** —
the constructor requires the caller to supply `requestTimeoutMs`, or `stopDeadlineMs` (the same
option name/semantics the `Coordinator` already threads through at construction,
`coordinator.mjs:63`, default `15000`). If neither is given, the constructor throws
`TypeError` naming both options — the adapter refuses to silently pick a number the coordinator
didn't derive. A hung/misbehaving server (e.g. `initialize` never answered) causes the pending
call to reject with a `CodexRpcTimeoutError` within `requestTimeoutMs`; `spawn()` then resolves
`{ok:false, reason, code:'timeout'}` rather than hanging the caller.

**XA4 — Construction is injectable.** `new CodexAppServerCli({ cmd, args, env, requestTimeoutMs
| stopDeadlineMs, ceiling, maxContext, versionProbe, spawnFn })`. `cmd`/`args` default to
`'codex'`/`['app-server']`; tests point `cmd` at `process.execPath` and `args` at
`test/fixtures/fake-codex-appserver.mjs`. `spawnFn` defaults to `node:child_process.spawn` and
is overridable for unit-level process-free tests.

**XA5 — id-less errors never wedge a pending call past its deadline.** An error response with
no `id` (the documented `-32600` hazard) is not speculatively matched to any pending request; it
is logged/emitted as an `error` BatonEvent tagged `{correlated:false}` and the real pending
request(s) still time out on their own deadline (XA3). No silent retry loop is triggered by the
adapter itself — retry/reschedule is the coordinator's job (mirrors the busy-error contract,
XA10).

---

## 2. Verbs (XA6–XA14)

**XA6 — `spawn(worker, brief, opts)`**: performs, IN ORDER, `initialize` (+ `initialized`
notification) → `thread/start` (`cwd: opts.worktree`, `sandbox: opts.sandbox ??
'workspace-write'`, `approvalPolicy: opts.approvalPolicy ?? 'never'`, `ephemeral: true`) →
`turn/start` with `input: [{type:'text', text: renderBrief(brief, 'codex-v2')}]` (reusing the
existing D2 brief-rendering contract from `src/adapter.mjs`, not a second dialect). The `Ack`
returned by `spawn()` resolves once `turn/start`'s response is received (turn accepted,
`status:"inProgress"`) — **not** once the turn completes (D1: spawn does not block on
completion). Session state after a successful spawn: `{child, threadId, activeTurn:{id},
turnEpoch:1}`.

**XA7 — `prompt(worker, content, mode)` — the 3-way D1 verb, all mapped onto this ONE thread:**
- `mode:'turn'` → a **new** `turn/start` on the SAME `threadId` (multi-turn, native — the
  capability one-shot adapters structurally cannot offer, per `docs/22 §4`). Any nudges queued
  since the last turn (see below) are prepended. `turnEpoch` increments.
- `mode:'nudge'` → 🔧 emulated: app-server has no "queue for next turn" primitive (per
  `spec/adapter-contract.md`'s own row); the adapter buffers the content and prepends it to the
  next `mode:'turn'` call's input. Ack carries `emulated:true`.
- `mode:'steer'` → ✅ `turn/steer` against the **currently active turn**
  (`expectedTurnId: session.activeTurn.id`). This is the capability one-shot adapters cannot
  give at all (`docs/22 §4`, §6 point 1). If there is no active turn, or the server rejects the
  precondition, `prompt()` resolves `{ok:false, reason}` — never throws.

**XA8 — `interrupt(worker, then?)`**: calls `turn/interrupt({threadId, turnId:
activeTurn.id})`. The Ack resolves as soon as the `{}` response arrives (D1: the confirmed stop
is an event, never this return value). The turn's own `turn/completed{status:"interrupted"}`
notification is what emits `control.interrupt_confirmed` (§3 below). **The thread — and the
child process — survive**: `activeTurn` is cleared but the session stays open, and a subsequent
`prompt(worker, x, 'turn')` starts a fresh `turn/start` on the same `threadId` and succeeds. If
`then` is supplied, once the interrupt-confirmed event is observed the adapter automatically
issues `prompt(worker, then, 'turn')` (the `interrupt(worker, then?)` shape from
`spec/adapter-contract.md`).

**XA9 — `approve(worker, requestId, decision, payload)`**: answers a pending
`item/commandExecution/requestApproval` or `item/fileChange/requestApproval` server-request.
`requestId` is an adapter-minted opaque string (not the raw wire id) recorded when the
`approval.requested` BatonEvent was emitted (XA13); this indirection exists because D1's
`approve()` contract takes a string `requestId` the coordinator's single-consumer CAS already
keys its state on, while the wire id is server-assigned and request-scoped. Decision mapping
(closed enum, per D1 `'allow'|'deny'|'cancel'`, onto the schema-verified
`CommandExecutionApprovalDecision`/`FileChangeApprovalDecision`):

| D1 decision | Codex wire decision |
|---|---|
| `'allow'` | `"accept"` |
| `'deny'` | `"decline"` |
| `'cancel'` | `"cancel"` |

(`"acceptForSession"` and the execpolicy/network-amendment variants are real but out of MVP
scope — not reachable through D1's closed enum; a future `payload.scope:'session'` could map to
`acceptForSession`, left as an explicit non-goal here.) Answering a request that isn't the
currently pending one for that worker returns `{ok:false, reason}` — never a wire write (D1:
answer exactly once, per dossier §6 "Requests are consumable messages... not replayable
facts").

**XA10 — spawn-time busy contention is a typed failure, not a crash-loop.** If `thread/start`
(or, symmetrically, `initialize`) returns a JSON-RPC error with `code:-32001`, `spawn()` kills
the now-useless child (it never got a thread) and resolves `{ok:false, reason, code:-32001}`.
It does **not** retry internally — per XA1, per-worker isolation already removes the
*shared-broker* half of the -32001 hazard; the remaining half (server ingress overload) is a
real backpressure signal the coordinator/scheduler must react to (reschedule/backoff), not
something this adapter papers over with an internal retry storm.

**XA11 — `kill(worker)`**: `process.kill(-child.pid, 'SIGKILL')` (process-GROUP kill — the
child is spawned `detached:true` so it owns its own group, matching the existing
`cli-adapters.mjs` pattern). The Ack resolves immediately; `kill.confirmed` is emitted from the
child's `'close'` handler once the OS confirms the process is gone (D1: confirmed-stop is
always an event).

**XA12 — `answer(worker, requestId, answer)`**: answers a pending
`item/tool/requestUserInput` (EXPERIMENTAL per schema description, but wire-real and
schema-verified at `ToolRequestUserInputParams`/`Response`). Baton's free-form
`{text?, decision?}` maps onto the (possibly multi-question) `{answers: {<qid>:
{answers:[string]}}}` shape by answering the **first** question id captured on the matching
`question.asked` event with `[answer.text ?? answer.decision ?? '']`. Multi-question turns are
a documented but unexercised edge (`Open unknowns`, dossier) — out of MVP scope, noted not
hidden.

**XA13 — approval/question requests become BatonEvents, not silent state.** On receiving
`item/commandExecution/requestApproval` / `item/fileChange/requestApproval`, the adapter mints
`requestId`, records `{rawId, kind, threadId, turnId, itemId}`, and emits `approval.requested`
with that `requestId` in the payload. On `item/tool/requestUserInput`, it emits
`question.asked` the same way (kind `'question'`), payload includes the raw `questions[]` so
the hub can render them. This is the routing target for "the coordinator's single-consumer
approvals" (RECONCILIATION D1) — this adapter's job stops at faithfully exposing the request
and delivering the coordinator's eventual decision back over the wire exactly once.

**XA14 — `card()`**:
```js
{
  harness: 'codex',
  version,                 // from versionProbe() at construction — see XA15
  authPosture: 'subscription',
  concurrencyCeiling,       // constructor-injected; real resource = local CPU/mem for N children
  maxContext,
  verbs: { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native',
           approve: 'native', answer: 'native', pause: 'unsupported' },
}
```
`pause:'unsupported'` is the RECONCILIATION D11 pin (Codex declares `steer:'native'`; the
"unsupported" note in earlier drafts referred to `pause`, not `steer` — D11 is explicit that
this is the correct reading). No verb here is silently emulated: everything marked `native`
above corresponds to a real, schema-verified 1:1 RPC (`turn/start`, `turn/steer`,
`turn/interrupt`, the two approval request methods, `item/tool/requestUserInput`); the one
emulated case (`prompt(...,'nudge')`) is flagged `emulated:true` on its own `Ack`, per the
"no silent emulation" rule (`spec/adapter-contract.md`) — it is not a `card()`-level capability
by itself since nudge is a *mode* of `prompt`, not a verb.

**XA15 — version is probed at construction, cached, injectable.** `versionProbe` defaults to
`execFileSync('codex', ['--version'])` (trimmed), invoked once synchronously in the
constructor and cached on `this._version`; on failure it caches `'unknown'` rather than
throwing (a harness card must always be producible). Tests inject a fake `versionProbe`
function so the suite never depends on a real `codex` binary being installed (dependency-free,
zero quota — this is metadata, not a model call, but the injection point exists regardless so
CI/dev machines without codex installed still get a deterministic, real adapter under test).

---

## 3. Event mapping (XA16–XA20)

All notifications are demuxed keyed on **`(threadId, turnId)`**, matching `docs/22`'s
instruction and `docs/reference/codex-app-server.md` §7's own guidance ("Baton's event demux
must key on `(threadId, turnId)`, not connection"). Each BatonEvent carries the D1 envelope
`{worker, harness, turnEpoch, actor:'worker', kind, payload}`; `payload` additionally always
carries `{threadId, turnId}` for downstream correlation, since Codex's own unit of "a turn" is
its `turnId`, distinct from baton's coordinator-level `turnEpoch` counter (which increments
once per `spawn`/`prompt('turn')` call, not per protocol round-trip).

| Codex notification / response | BatonEvent kind | Notes |
|---|---|---|
| `turn/started` | `lifecycle.turn_started` | |
| `item/completed` (`type:'agentMessage'`) | `content.message` | |
| `item/completed` (`type:'commandExecution'`/`'mcpToolCall'`) | `content.tool_call` | |
| `item/completed` (`type:'fileChange'`) | `content.file_edit` | |
| `turn/completed` (`status:'completed'`) | `lifecycle.turn_completed` | payload.result built per the existing `makeResult()` shape (budgetUsed from the last `thread/tokenUsage/updated`) |
| `turn/completed` (`status:'interrupted'`) | `control.interrupt_confirmed` | NOT `lifecycle.turn_completed` — this is the D9 confirmed-stop event the coordinator awaits; thread survives |
| `turn/completed` (`status:'failed'`) | `lifecycle.crashed` | `error.message` surfaced |
| `item/commandExecution/requestApproval`, `item/fileChange/requestApproval` | `approval.requested` | XA13 |
| `item/tool/requestUserInput` | `question.asked` | XA13 |
| `thread/tokenUsage/updated` | `resource.tokens` | per-turn cadence; feeds the coordinator's (not the adapter's) `resource.budget_threshold` accounting — XA20 |
| `account/rateLimits/updated` | `resource.tokens` | payload tagged `{source:'rateLimit'}` to distinguish from token-usage pushes; same D3 kind, since D3's vocabulary has no separate rate-limit kind and the coordinator's budget-threshold math (docs/22 §3 gap #4) is explicitly out of this adapter's scope |
| any other notification (`guardianWarning`, `configWarning`, `deprecationNotice`, unknown/future methods, malformed JSON lines) | *(none)* | **silently ignored** — this is a hard requirement, not an oversight: `docs/22`/D3 both establish that an unmapped event must never crash the adapter or the coordinator |

**XA16 — single-terminal-per-turn.** Each `turnId` accepts exactly one terminal event
(`lifecycle.turn_completed` XOR `lifecycle.crashed` XOR `control.interrupt_confirmed`); once a
`turnId` is marked terminal, further notifications referencing it (a duplicate `turn/completed`,
trailing deltas) are dropped before reaching `onEvent`. This mirrors the existing
`cli-adapters.mjs` `_finish()` discipline, scoped per-turn instead of per-session since one
session now spans many turns.

**XA17 — malformed/unknown lines never crash the adapter.** A line that fails `JSON.parse`, or
parses but has a `method` outside the mapped table above, is dropped after the line-buffer
advances past it — never thrown, never surfaced as `lifecycle.crashed`. Verified by the fake
binary's `FAKE_CODEX_MALFORMED=1` mode (one invalid-JSON line + one well-formed
unknown-method notification per turn).

**XA18 — token/rate-limit notifications become `resource.*` events, per D3's closed vocabulary.**
Since D3 only defines `resource.tokens | resource.budget_threshold`, and
`resource.budget_threshold` is explicitly the coordinator's threshold-crossing computation over
accumulated `handle.budgetUsed` (docs/22 §3, gap #4 — not this adapter's job), both
`thread/tokenUsage/updated` and `account/rateLimits/updated` map to `resource.tokens`,
distinguished by a `payload.source` tag (`'tokenUsage'` | `'rateLimit'`). This is a deliberate,
documented reuse of one D3 kind for two wire sources — not a new kind string (D3: "No other kind
strings exist").

**XA19 — a `turn/completed{status:'failed'}` after a scripted crash never falls through to a
completed result** — the crash path is checked before the natural-completion path in the
mapping function, and once emitted the turn is immediately marked terminal (XA16).

**XA20 — resource events never gate anything in this adapter.** Emitting `resource.tokens`
carries no side effect here (no internal throttling, no invented ceiling); consuming it into a
budget decision is exclusively the coordinator's concern (RECONCILIATION D5/D8, docs/22 §3 gap
#4). This adapter is a faithful pipe, not a policy point.

---

## 4. Fake binary (`test/fixtures/fake-codex-appserver.mjs`) — contract it must uphold

The fixture is a real (if minimal) implementation of the wire methods this spec cites, not a
mock of the adapter's internals. It must, and does:

1. Answer `initialize` → `{userAgent, codexHome, platformFamily, platformOs}` (schema-shaped);
   emit `remoteControl/status/changed` after `initialized`, matching the live-verified
   unsolicited-notification-before-first-thread behavior (dossier §3) so adapters are proven to
   tolerate it.
2. Answer `thread/start` → a schema-shaped `ThreadStartResponse`; on `FAKE_CODEX_BUSY=1`, the
   FIRST call instead returns `{error:{code:-32001, message:"Shared Codex broker is busy."}}`
   (verbatim message from the dossier), then behaves normally on any retry attempt from a
   fresh/second worker.
3. Answer `turn/start` → schema-shaped `TurnStartResponse` (`status:"inProgress"`), then
   asynchronously stream `turn/started` → `item/completed(agentMessage)` → …→
   `turn/completed`, branching on directives embedded in the input text (`FAKE:CRASH`,
   `FAKE:REQUEST_APPROVAL:command|fileChange`, `FAKE:REQUEST_QUESTION`, `FAKE:STAY_OPEN`, or
   plain natural completion).
4. Issue a real approval request (`item/commandExecution/requestApproval` or
   `item/fileChange/requestApproval`) and **block** — emit nothing further for that turn — until
   it receives the client's `{id, result:{decision}}` response, honoring
   `accept*/decline/cancel` per the real decision semantics (docs: `decline` → "the agent will
   continue the turn"; `cancel` → "the turn will also be immediately interrupted").
5. Issue `item/tool/requestUserInput` and block until answered, per XA12's `{answers}` shape.
6. Honor `turn/steer`: validate `expectedTurnId` against the currently active turn (reject with
   a real JSON-RPC error otherwise, matching the schema's documented precondition failure);
   on success, emit an acknowledging `item/completed(agentMessage, "STEERED: …")` and then wrap
   the turn shortly after — the scripted proof that the steer altered subsequent output, even on
   an otherwise-`FAKE:STAY_OPEN` turn.
7. Honor `turn/interrupt`: ack `{}`, then emit `turn/completed{status:"interrupted"}` for that
   turn — the child process and `threadId` remain live; a subsequent `turn/start` on the same
   thread is answered normally (thread survives).
8. On `FAKE_CODEX_MALFORMED=1`, interleave one invalid-JSON stdout line and one well-formed
   unknown-method notification per turn.
9. On `FAKE_CODEX_HANG=1`, receive `initialize` and never answer it — the sole purpose is
   proving the adapter's `requestTimeoutMs` (XA3) actually bounds the wait.
10. Never touch the filesystem, network, or a real vendor CLI — it is pure NDJSON logic over
    stdio, so the whole test file costs zero model quota and zero external dependencies.

---

## 5. Non-goals / explicit deferrals (named, not silently dropped)

- `thread/resume`/`thread/fork`/`thread/rollback` (session persistence/reattach) — real and
  schema-verified, but out of this phase's scope (docs/22 doesn't ask for it here); a future
  cluster can add `resume()`/`fork()` alongside the existing 8 D1 verbs without touching this
  spec's contracts.
- `acceptForSession` / execpolicy / network-policy amendment decision variants (XA9) — real,
  schema-verified, unreachable through D1's closed `allow|deny|cancel` enum today.
- Multi-question `item/tool/requestUserInput` turns (XA12) — schema supports an array of
  questions per request; this MVP answers only the first, documented as a known gap.
- A shared-daemon/broker transport (XA1) — a legitimate alternative topology for a future
  "foreman" build, deliberately not built here; per-worker isolation is the chosen default for
  this cluster, not a placeholder for it.

---

## Errata — live-verified against codex-cli 0.144.0 app-server, 2026-07-10 (post-implementation re-evaluation)

A raw-wire live probe (session scratchpad `probe-codex-appserver.mjs`, raw frames in
`codex-probe-raw.jsonl`) re-verified this spec's protocol claims against the real binary and the
`codex app-server generate-json-schema` bundle. The architecture held up: `initialize`/
`initialized`/`thread/start`/`turn/start`/`turn/steer`/`turn/interrupt` are all real with the
pinned param shapes; `TurnStatus` is exactly `completed|interrupted|failed|inProgress`; the
approval decision vocabulary contains exactly the pinned `accept`/`decline`/`cancel` (plus
richer variants unused here); `turn/interrupt` → `{}` → `turn/completed{status:'interrupted'}`
with the THREAD SURVIVING was proven live, as was mid-turn `turn/steer` redirecting a running
turn. Two pinned details were wrong, and one robustness gap was closed:

### X1 — stale-steer error is an ID-MATCHED `-32600`, not `-32010`

Live: `turn/steer` with a wrong `expectedTurnId` fails with
`{"error":{"code":-32600,"message":"expected active turn id \`X\` but found \`Y\`"},"id":<req>}`.
The `-32010` code in the fixture/tests was never verified and is fiction for 0.144.0. The
adapter itself never branched on the code (it propagates `err.message`) — behavior unchanged;
fixture and comments corrected.

### X2 — unknown-method errors are ID-MATCHED on 0.144.0; the id-less hazard is demoted to defensive modeling

Live: an unknown method gets an id-matched `-32600` (`"Invalid request: unknown variant ..."`),
correlated to its request. The dossier's "id-less -32600, verified live" (docs/reference/
codex-app-server.md §Unknown method) does not hold on 0.144.0 — either version drift or a
flawed original observation. XA3/XA5 remain: per-request timeouts stay mandatory (a wedged
server sends nothing at all), and the adapter still surfaces any genuinely id-less error as an
uncorrelated `error` event (fixture models one synthetically under `FAKE_CODEX_MALFORMED`,
labeled synthetic).

### X3 — unmapped server→client REQUESTS must be answered, never ignored (anti-wedge)

The real schema also serves `item/permissions/requestApproval` and `item/tool/call` — outside
this MVP's mapped table. The original "silently ignored" rule left a JSON-RPC request dangling,
wedging its turn forever. Amendment: the adapter replies
`{id, error:{code:-32601, message:'baton: unhandled server->client request "<method>"'}}` and
emits an observable `error` event (`correlated:true, serverMethod`). XA17's "never crash" gains
"never wedge".

### X4 — single pending-request slot replaced by a keyed map

`session.wait` (one slot) would clobber an earlier pending approval/question if the server
issued two concurrently, leaving the first's `rawId` unanswerable — the same wedge class as X3.
Now `session.waits: Map(requestId -> wait)`; `approve()`/`answer()` consume by key
(answer-exactly-once preserved per request).

### Still open (honestly)

- `-32001` busy on `thread/start` remains fixture-pinned only (hard to reproduce on demand);
  the adapter's typed-failure path is what the tests lock.
- Live approval round-trip not yet exercised (an `approvalPolicy:'untrusted'` echo probe was
  auto-run without prompting); the static schema match (decision vocab, answers shape) is exact.
