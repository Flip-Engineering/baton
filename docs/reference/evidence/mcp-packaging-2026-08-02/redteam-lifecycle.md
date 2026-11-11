# Red-team: MCP+packaging contract v0.9 — LIFECYCLE / TRANSPORT angle

**Attacker role:** lifecycle-attacker (glm-5.2 @ high).
**Contract under review:** `docs/reference/evidence/mcp-packaging-2026-08-02/mcp-packaging-decisions.md` (v0.9, *pre-red-team* draft).
**Scope:** lifecycle and transport hazards of surfacing wave orchestration, decision answering, settlement, readiness, and packaging over stdio MCP — i.e. *what happens at the process/transport boundary* (host dies, reconnects, double-starts, oversized frames, expiring deadlines, descriptor re-reads). The AUTHORITY angle (principal binding, profile enforcement, leak class) is the sibling report `redteam-authority.md`; this report touches principal binding only where it changes a lifecycle verdict.
**Method:** read-only — no `impl/` edits; the only write target is this file. Every claim is grounded `file:line` against `impl/src/...`.

---

## 0. Framing finding (read first)

The single most important lifecycle fact, established before any per-vector work: **the contract proposes an MCP tool surface that does not yet exist in `impl/`.** Today's MCP northbound ships exactly **one** wave tool — `baton_waves_attach` → `waves.attach` (S-1 v2 portable atomic *attach-and-harvest*) — plus `baton_decision_answer` / `baton_decision_list`. There is **no** MCP `waves.start`, **no** `waves.progress`, **no** `waves.send`, **no** `waves.stop`, **no** `deployment.doctor`, and **no** settlement tools over MCP.

Evidence (tool inventory is closed and frozen at module load):

| Contract-proposed tool | Impl status | File:line |
|---|---|---|
| `waves.start` | **ABSENT** | only `baton_waves_attach` registered: `mcp-northbound.mjs:42,63,410` |
| `waves.progress` | **ABSENT** | (no dispatch branch; `APPLICATION_TOOL` has no entry) `mcp-northbound.mjs:30-45` |
| `waves.send` | **ABSENT** | only embedded: `wave.mjs:360` (`handle.send`) |
| `waves.stop` | **ABSENT** | only embedded: `wave.mjs:368` (`handle.stopMember`) |
| `waves.attach` | **EXISTS** (harvest-only) | `mcp-northbound.mjs:410`; row `application-semantics.mjs:1527` |
| `decision.answer` | **EXISTS** (reflex Part C) | `mcp-northbound.mjs:512,762,1313` |
| `decision.list` | **EXISTS** (surfacing matrix) | `mcp-northbound.mjs:1303`; `application-semantics.mjs:1185` |
| `deployment.doctor` | **ABSENT over MCP** | embedded only: `application-client.mjs:1574`; `application-deployment.mjs:1267` |
| MCP-W2 settlement (4 ops) | **ABSENT over MCP** | embedded-only v1 pin (contract KS9) |

This reframes every verdict below: most of MCP-W1's lifecycle hazards are **not yet defended because the surface does not yet exist** — the contract is describing semantics that the implementation has not yet had to survive a transport. Where the *embedded* primitive the proposed tool would wrap already carries a lifecycle hazard, that hazard is real and lands on the surface the moment the tool is wired. Those are the actionable items.

A second framing fact, equally load-bearing: the wave handle **holds no durable state of its own** (`wave.mjs:7`, "It holds no durable state of its own"). All live state — the member roster, the in-memory `progress`/`steering`/`stops` logs, the drive `pumps` — lives in the MCP host process. So "host dies mid-wave" is, by construction, a total loss of the *steering* layer; only what is durably registered in the coordination store survives.

---

## 1. Detached semantics — host dies mid-wave; re-attach; idempotency

**Verdict: NEEDS-AMENDMENT** (re-attach exists and is binding-proven, but the contract's `waves.start` idempotency story is undocumented over MCP, and MCP recovery is **harvest-only — there is no resume-steer path**, which the contract's tool list implies but does not make explicit).

### 1a. What survives a host death

When the MCP host process dies mid-wave, the member **runs** keep going only if they outlive the host. Two transport shapes behave very differently, and the contract flattens them into one:

- **Stdio with an in-process factory** (`scripts/mcp-stdio.mjs:13-17`): the config module's `createMcpServer`/`default` factory builds the Baton application **inside the MCP process**. There is no resident separation. If that process dies, the in-process coordinator and the coordination store's *live* worker handles die with it; only the on-disk store records remain. The contract's premise that "the runs keep going" is **not guaranteed for this shape** — it depends on whether member workers are spawned in a process group that survives the parent, which the contract does not pin.
- **Web bridge over a local socket** (`mcp-web-bridge.mjs:62`, *"MCP transport lifetime never owns the resident Baton application"*): the Baton application is **resident** (a separate `baton serve` process reached via `discoverBatonConnection`, `mcp-web-bridge.mjs:3,227-230`). Here host-death is genuinely survivable — a new bridge re-`discoverBatonConnection`s. **This** is the shape where "the runs keep going" holds.

The contract's detached-semantics section speaks of "stdio MCP" as one thing. **Amendment 1-A:** the contract must name *which* transport guarantees run survival, and must state that the in-process stdio factory shape does **not** — an external orchestrator that wants crash-survivable waves must connect to a resident baton (web bridge / local socket), not spawn an in-process stdio server.

### 1b. Is re-attach via `waves.attach` enough?

Re-attach exists and is cryptographically honest: `attachWave` (`wave.mjs:234-303`) rebuilds a handle by listing runs and matching on **objective** (the per-wave-salted fingerprint, `wave.mjs:224-231,254-261`), then **proves each member's binding** via the required `mintDetached` callback, which asserts the run's `steering.registered` waveId and throws `application_wave_member_mismatch` on any run bound to another wave or none (`wave.mjs:281-286`). An attach that binds zero members is refused with `wave_attach_unknown_wave` rather than silently minting a new wave (`wave.mjs:299-301`). The server-side proof is constructed **inside** the application client (`application-client.mjs:1552-1556`), so an MCP caller never supplies it — the proof is automatic and transport-safe.

**But:** over MCP, `waves.attach` is *harvest-only*. Its registry contract is explicit: *"portable attach-and-harvest … Transport returns a closed `{outcomes, waveDriverDetached}` payload — live handles stay embedded-only"* (`application-semantics.mjs:1525-1526`); the recipes attach path proves it by calling `wave.settle({ timeoutMs })` (`recipes.mjs:479`). So after a host death, an MCP caller can **terminate-and-harvest** the orphaned wave, but cannot resume steering it **with wave-level guarantees** — there is no MCP `waves.send`/`waves.stop`/`waves.progress` to drive the re-attached members forward. The contract's MCP-W1 list (`waves.start/progress/send/stop`) implies a resume path, but **none of those tools exist**, and the one that does (`waves.attach`) is terminal.

**Caveat that softens — but sharpens — the above:** an MCP caller is *not* fully stranded, because wave members are ordinary runs and the ordinary surface already steers runs by `runId`: `baton_run_act`/`run.do` takes `{runId, actionId, inputs}` (`mcp-northbound.mjs:399`) and the 31-b steering acts (`nudge`/`claim`/`wait`) plus `stop_member` are all run-scoped actions (`coordinator.mjs:2223-2414`; `wave.mjs:374` uses `stop_member` itself). So a determined MCP orchestrator can re-attach by `waves.attach`, read member `runId`s, then steer/stop each member with `baton_run_act` / `baton_workstream_notify`. **What it loses** is exactly the wave layer's value-add: the binding proof (no check that a given `runId` is a member of *this* wave — `run.act` operates on any run), the aggregated steering ledger (`state.steering`/`state.stops`, `wave.mjs:364,375`), and the `evidence()` trace (`wave.mjs:489-500`). The wave abstraction silently degrades to N independent runs, with no signal to the orchestrator that it has dropped from "wave steering" to "run steering."

This is the S-1 `transportHidden` law made concrete: live handles never cross the transport (`application-semantics.mjs:1248,1532`; `wave.mjs` `mintWaveDetached`/`waveId` declared hidden). The contract's `waves.send`/`waves.stop` would have to be designed as **detached** operations (operate by `waveId`+`role`, never a live handle) to stay S-1-conformant. The contract asserts `waves.start` returns detached `{waveId, members}` (contract §MCP-W1) — that part is S-1-safe — but never states the corresponding invariant for `send`/`stop`/`progress`, nor that the recovery surface is asymmetric (harvest-only today).

**Amendment 1-B:** state explicitly that (i) re-attach-and-resume over MCP requires the four *new* detached tools to land, and until they do the only MCP recovery is terminal `waves.attach`; (ii) `waves.send`/`waves.stop`/`waves.progress` must operate by `waveId`+`role` (detached), never accept or return a live handle; (iii) `attachWave` itself rejects a foreign/empty wave (`wave.mjs:300`), so a caller that lost the waveId cannot bluff re-attach; (iv) until the detached tools ship, **document that post-attach steering over MCP is run-level only** (`baton_run_act`/`baton_workstream_notify` by `runId`) and silently forfeits the wave binding proof, steering ledger, and `evidence()` trace — the degradation in §1b's caveat.

### 1c. The idempotencyKey story across a double-start

Idempotency **exists at the embedded layer and is well-designed**, but is **absent from the MCP surface**:

- `createWave` derives `waveId = wave:sha256(idempotencyKey)[:32]` (`wave.mjs:176-179`), so the same key deterministically yields the same waveId, and the pre-loop `wave.started` record (ridden on the first member's `runs.start` via `waveStart: { roster, idempotencyKey }`, `wave.mjs:205`) dedups so only the first attempt mints it (`wave.mjs:172-178`). The red-team runner itself relies on this: `run-redteam.mjs:104` passes `idempotencyKey: 'mcp-packaging-redteam-2026-08-02'`. So an embedded client that retries `waves.start` after a transport blip gets the **same** wave, not a duplicate.
- **Over MCP there is no idempotencyKey on any wave operation.** The `baton_waves_attach` schema is `{ repoId, waveId, members:[{role,objective}], timeoutMs, repoRoot }` with **no** `...idem` spread (`mcp-northbound.mjs:412-424`); it is marked `idempotentHint: true` (`mcp-northbound.mjs:425`) but that hint reflects attach's *binding-proof* dedup (the `wave.driver_detached` key, `wave.mjs:231,285`), not a caller-supplied retry key. And `waves.start` does not exist yet, so the contract's claim that `waves.start` is "idempotent across a transport retry that double-starts a wave" is **unimplemented and untestable over MCP**.

**Amendment 1-C:** the contract must specify the MCP `waves.start` argument contract to include a required `idempotencyKey` (the embedded `validateWaveIdempotencyKey` grammar, `wave.mjs:217-222`) and document that retry-with-same-key resolves to the existing waveId — wiring the embedded guarantee (`wave.mjs:176-179`) through to the surface. Without this, a transport retry on a not-yet-existing `waves.start` would mint a duplicate wave (new uuid, `wave.mjs:178`), and the contract's "double-starts a wave" hazard is real the day the tool ships.

---

## 2. waves.progress freshness — polling vs follow; frame wedging

**Verdict: CONFIRMED-HOLE** (two distinct holes: a freshness model with no follow/subscribe primitive, and a serialization ceiling that is ~112× the contract's stated frame size — a progress read fails, by design, on a large wave).

### 2a. Freshness — polling only, no follow

The wave progress projection is a **synchronous per-call snapshot**: `handle.progress()` (`wave.mjs:306-333`) issues `run.status()` for every member and returns `{ elapsedMs, members:[…] }`. There is **no follow/subscribe/streaming primitive** in the wave surface (`wave.mjs:502-510` lists `progress, send, stopMember, settle, close, evidence` — all poll/request, none event-push). The wave-driver's *embedded* `policy.onProgress` callback (`wave-driver.mjs:507-514`) is a push hook, but it is an **embedded-only** driver contract — it cannot ride stdio MCP, which is strictly request/response (`serveMcpStdio`, `mcp-northbound.mjs:1523-1576`, newline-delimited JSON frames).

So an MCP `waves.progress` (if it existed) would be **poll-only**. That is not itself a defect, but the contract does not name the cost: under the per-call tool quota (`mcp-northbound.mjs:1089-1095`, every call gates through `takeToolQuota`), a tight poll loop burns the caller's tool budget (see §6c). The contract's "polling vs follow" framing implies a choice exists; over MCP today, **only polling is possible**, and there is no bounded-cadence guidance.

### 2b. Frame wedging — the ceiling mismatch (the real hole)

The contract asserts `maxMessageBytes` is **64 KiB** (contract §attack-2). The implementation contradicts this on three counts:

1. **`maxMessageBytes` is deployment-derived and mandatory**, not a fixed 64 KiB. The constructor rejects any non-positive non-integer (`mcp-northbound.mjs:896-899`: *"must be a deployment-derived positive safe integer"*). The web bridge defaults it to **256 KiB** (`mcp-web-bridge.mjs:296`); the stdio path takes whatever the factory injects (`scripts/mcp-stdio.mjs` → `new McpFleetServer(configured)`, `mcp-stdio.mjs:17`). There is **no** `64 * 1024` literal anywhere for `maxMessageBytes` (grep across `impl/src` finds 64 KiB only for credential-metadata caps, `application-deployment.mjs:65-66`, unrelated). **The contract's "64 KiB" is an assertion about a value that does not exist as stated.**

2. **The wave progress serialization ceiling is 7 MiB** — `MAX_WAVE_PROGRESS_BYTES = 7 * 1024 * 1024` (`wave.mjs:21`), enforced by `boundedJsonBytes` which throws `wave_progress_oversize` past it (`wave.mjs:23-28,330`). That is **~28× the web-bridge default (256 KiB) and ~112× the contract's claimed 64 KiB.** So a progress projection can be *internally legal* (under 7 MiB) yet **far exceed the MCP response ceiling**.

3. **The MCP response-ceiling guard is a hard fail, not a wedge and not a truncate.** At `mcp-northbound.mjs:1469-1471`: if `Buffer.byteLength(JSON.stringify(toolResult(value))) > this.maxMessageBytes`, the call throws `application_run_view_oversize` — the tool returns an **error**, not partial progress. (Oversized *request* lines are a separate path: the stdio line reader discards them and replies `-32700 Parse error`, `mcp-northbound.mjs:1530-1557` — so an oversized *inbound* frame cannot wedge the reader either.)

So the precise failure mode is: **a large wave's `waves.progress` returns `application_run_view_oversize` instead of progress** — a silent degradation for any caller that treats it as "no progress available" rather than "the projection is too big to transport." The projection includes each member's `scratchpad` projection (`wave.mjs:322`, `scratchpad: outline.scratchpad ?? null`), so a 64-member wave (`maxItems: 64`, `application-semantics.mjs:1536`) with non-trivial scratchpads reaches the response ceiling long before the 7 MiB internal cap.

**Amendment 2-A (correctness of the contract):** replace "maxMessageBytes 64KiB" with the truth — `maxMessageBytes` is deployment-derived (`mcp-northbound.mjs:899`), web-bridge default 256 KiB (`mcp-web-bridge.mjs:296`), and **must be ≥ the wave progress ceiling to be useful**, which today (7 MiB internal cap, `wave.mjs:21`) no transport default satisfies.
**Amendment 2-B (the hole):** `waves.progress` cannot transport a full 64-member projection under any realistic `maxMessageBytes`. Either (i) bound the MCP progress projection independently and strictly below `maxMessageBytes` (digest-only member view — drop `scratchpad`, cap `attention`), and document the truncation honestly; or (ii) paginate/cursor the projection. As specified, the tool would error on the exact large wave it is meant to observe.

### 2c. The hazard is not hypothetical — it already applies to the one wave tool that exists

The oversize guard at `mcp-northbound.mjs:1469` fires on **any** `APPLICATION_TOOL` result, and the only wave tool that exists (`baton_waves_attach`) returns the wave's closed harvest payload. That payload, as built by the recipes attach path, is `wave.evidence()` **plus** stop/remainingCount overlays (`recipes.mjs:481-494`), and `evidence()` is unbounded by design — it returns the **full** `outcomes`, `steering`, `stops`, and `progress` arrays accumulated over the wave's life (`wave.mjs:489-500`). The `progress` array grows on every `progress()` poll (`wave.mjs:331`) and `outcomes` carries each member's `narrative` (`wave.mjs:438`). So a long-lived, oft-polled, 64-member wave can push the *existing* `waves.attach` result past `maxMessageBytes` → `application_run_view_oversize`, the same hard fail. The proposed `waves.progress` merely makes an already-present failure mode more frequent.

**Documentation/impl seam (flagged, not fully resolved):** the registry *documents* that `waves.attach` "returns a closed `{outcomes, waveDriverDetached}` payload" (`application-semantics.mjs:1525-1526`), but the **only** code that constructs that closed shape is the recipes `attachRun` path (`recipes.mjs:477-494`, the `basis: 'attached'` builder); the deployment facade's `waves.attach` instead returns a **live handle** (`application-deployment.mjs:1228` → `createWaveHandle`, `wave.mjs:302,305`), and the `APPLICATION_COMMAND_DEFINITIONS['waves.attach']` handler that mediates `application.command('waves.attach')` → closed payload was not located in this review (the symbol is imported into `mcp-northbound.mjs:4` from `application.mjs`, where a textual search returns zero hits — it is constructed dynamically). This means the *exact* return shape of the MCP `waves.attach` call — closed-payload (oversize-prone per above) vs raw-handle serialization — is not verifiable from the dispatch surface. **Amendment 2-C:** pin the MCP `waves.attach` return contract to a bounded, explicitly-enumerated shape (which fields, capped sizes) and assert it against `maxMessageBytes` in a gate test; do not leave the oversize behavior of the one shipped wave tool to inference from comments.

---

## 3. decision.answer across a transport gap — expiry while disconnected; one-pending honesty

**Verdict: DEFENDED** (the hub auto-expires honestly and a late answer returns a typed `already_resolved`; one-pending admission is honest). **One NEEDS-AMENDMENT** for how the expiry surfaces to an MCP caller.

### 3a. What the caller sees after an expiry-during-disconnect

Decision lifecycle is **hub-side** in `coordinator.mjs` (note: the contract's anchor "claude-session.mjs (decision lanes)" is **wrong** — `claude-session.mjs` is the *adapter* layer; the authority/expiry lanes are in `coordinator.mjs`). The flow:

- A decision record carries `deadlineAt` (`coordinator.mjs:11218` `deadlineAt: this._now() + request.deadlineMs`; approvals at `:11127`).
- The deadline sweep `_sweepDeadlines` auto-resolves expired records: approvals/publications → `{ decision: 'deny' }`; decisions → `_expireDecision` (`coordinator.mjs:2701-2705`).
- `_expireDecision` (`coordinator.mjs:9283-9312`) sets `record.resolution = { disposition: 'expired', answer: null }`, notifies the worker adapter with `{ expired: true }`, and returns `{ ok: true, result: 'expired' }`.
- A late answer to an already-resolved record returns **`{ ok: false, result: 'already_resolved', resolution }`** (`coordinator.mjs:8920` for decisions, `:2274,2279` for approvals/publications, `:9284` re-entry guard) — the caller sees the actual resolution (`{ disposition: 'expired', answer: null }`), **not** a silent loss and not a fabricated acceptance.

So across a transport gap: caller disconnects → decision expires → caller reconnects and calls `baton_decision_answer` → the MCP dispatch (`mcp-northbound.mjs:1313-1321`, which routes to `run.answer`) returns the `already_resolved` payload with `disposition: 'expired'`. **This is honest.** The answer is not lost (it is explicitly refused with the reason), and the wave is not closed/superseded because a callback failed (the wave-driver's `onDecision` records an invalid/deferred return as evidence and *never* answers, `wave-driver.mjs:516-554`).

### 3b. One-pending admission is honest

When a worker asks a second decision while one is pending, the hub rejects it with `control.decision_already_pending_rejected`, reason `decision_already_pending`, carrying the `pendingRequestId` (`coordinator.mjs:11190-11199`). This is a coordination event, observable through the run's attention/decision projection. The MCP `decision.list` (`mcp-northbound.mjs:1303-1309`, dispatching to `application.decisionList`) is the surface an MCP caller uses to see what is pending. **Honesty caveat on `deadlineAt` visibility:** the registry *documents* that `decision.list` projects `deadlineAt` (`application-semantics.mjs:1185`: *"deadlineAt is projected"*; liveMethod `application.decisionList`, `:1342`), but the `decisionList` projection body was **not located** in this review, so the claim rests on the registry comment, not verified code. **Amendment 3-B:** add a gate test asserting `decision.list` actually emits `deadlineAt` (the amendment in 3-A depends on it — an MCP poller cannot compute "time to expiry" without it).

### 3c. The amendment — expiry visibility for an MCP poller

The embedded wave-driver surfaces `expiresInMs` to its `onDecision` callback (`wave-driver.mjs:526-539`) — but that callback is **embedded-only**; an MCP caller has no push channel and learns the deadline only by polling `decision.list` and computing against `deadlineAt`. The `already_resolved`/`expired` outcome is returned as a **generic tool result** (`{ ok:false, result:'already_resolved', … }`), not as a typed MCP error code that a structured caller can switch on. A naive MCP orchestrator that treats any `ok:false` as "retry" would loop against an expired decision.

**Amendment 3-A:** (i) surface decision expiry/resolution as a **typed MCP error code** (e.g. `decision_expired` / `decision_already_resolved`) rather than only a success-shape payload, so a caller can distinguish "expired, stop retrying" from "transient, retry"; (ii) document that the expiry window is hub-configured (`request.deadlineMs` / `_approvalTimeoutMs`) and that an MCP poller's cadence must be well inside it, since there is no push lane.

---

## 4. Acceptance driver failure modes — external MCP-only orchestrator

The contract's acceptance bar (contract §Acceptance) is: an external process, connected **only** via stdio MCP with a declarative descriptor, starts a 2-member wave, watches progress, answers a decision through `decision.answer`, and settles with outcomes harvested — no embedded API touched. Walking that flow step-by-step against today's impl, naming the silent-degradation each step hits:

| Step | Tool (contract) | Impl status | Silent-degradation mode | Verdict |
|---|---|---|---|---|
| 1. Connect via descriptor | `baton-mcp <descriptor.json>` (PKG-1) | **ABSENT** — script takes a JS factory module (`mcp-stdio.mjs:7-17`) | The driver literally cannot start: there is no descriptor parser. It must hand-write a factory importing `impl/src/` — exactly the thing PKG-1 is meant to remove (contract GT#3). | **CONFIRMED-HOLE** (PKG-1 unimpl.) |
| 2. Start wave | `waves.start` | **ABSENT** | No MCP way to start a wave. Only `waves.attach` exists, and it harvests a *prior* wave's runs — it cannot mint one (`wave.mjs:234`, requires existing matched runs; zero-match → `wave_attach_unknown_wave`, `wave.mjs:300`). | **CONFIRMED-HOLE** |
| 3. Watch progress | `waves.progress` | **ABSENT** | No MCP progress read. The driver can only poll per-run `run.inspect`, which is **not** the wave-driver projection (no stall markers, attention, knowledge counts) and which **errors with `application_run_view_oversize`** on large runs (`mcp-northbound.mjs:1469`). Progress is **hallucinated-as-fresh only if** the driver treats a stale `run.inspect` as wave progress — there is no freshness token. | **CONFIRMED-HOLE** |
| 4. Answer decision | `decision.answer` | **EXISTS** | Works (`mcp-northbound.mjs:1313`). Failure mode: if the decision expires while the driver is between polls (no push lane, §3), the answer returns `already_resolved` (`coordinator.mjs:8920`) — **the driver may mis-read this as "answer lost" and re-spawn work**, duplicating outcomes. | NEEDS-AMENDMENT (3-A) |
| 5. Settle / harvest | `waves.attach` (harvest) | **EXISTS** | Works as terminal harvest (`recipes.mjs:479`). Failure mode (narrowed): durable settlement is **idempotency-keyed** — `knowledge.settlement_lease` / run-control settlement refuse replays with typed conflicts (`coordination-store.mjs:11891,12228`; `coordinator.mjs:10081`), so a retried `waves.attach` does **not** double-admit knowledge. The duplication that *does* happen is in the **caller's accounting**, not the store: each `attachWave` builds a fresh handle with a fresh `state.outcomes` (`wave.mjs:266-273`), and `settle` only dedups within one handle (`wave.mjs:428`). So a retried attach returns outcomes again — carrying the **same `resultSha`s** — and a driver that counts `outcomes.length` instead of keying on `resultSha` double-counts. | NEEDS-AMENDMENT (1-B) |
| 6. Admit knowledge | MCP-W2 settlement | **ABSENT over MCP** | `knowledge.promote`/`settlement_lease` are embedded-only (KS9). The driver cannot settle knowledge through MCP at all today. | **CONFIRMED-HOLE** (by design v1) |
| 7. Readiness | `deployment.doctor` | **ABSENT over MCP** | Driver picks routes blind (contract GT#4). | **CONFIRMED-HOLE** |

**Net:** the acceptance driver as written **cannot run today** — steps 1, 2, 3, 6, 7 have no MCP tool. The contract is red-teaming a surface that does not yet exist. The two failure modes that *will* bite the moment the tools land are: (a) progress hallucinated-as-fresh (no freshness token, oversized reads erroring out), and (b) outcome duplication on a retried harvest. Both are addressable by the amendments in §2 and §1.

---

## 5. PKG-1 descriptor lifecycle — live edits, re-read, partial JSON, BOM/encoding

**Verdict: CONFIRMED-HOLE** (the declarative descriptor does not exist; the script takes a JS factory module; every lifecycle question in the contract is therefore unaddressed and untestable).

### 5a. The descriptor is not implemented

`scripts/mcp-stdio.mjs:7-17` resolves `process.argv[2] ?? BATON_MCP_CONFIG`, **imports it as a module** (`import(pathToFileURL(resolve(configPath)))`), and requires `createMcpServer`/`default` to be a **function** returning server config or an `McpFleetServer`. There is **no JSON descriptor parser anywhere** in `impl/src`: the `descriptor` tokens in `application-deployment.mjs:355,429` and `application-cli.mjs:138,399` are unrelated (profile/repoId selector files, credential-cache PID files), not the PKG-1 deployment descriptor. So PKG-1 (`baton-mcp <descriptor.json>`) is, today, **vapor** — and the contract's red-team targets (path escape, file-credential-ref smuggling, schema smuggling) belong to the *authority* report's PKG-1 section; the **lifecycle** questions are unanswerable because there is no code.

### 5b. The lifecycle questions, and what the analogous code implies

Because the only precedent is a **JS factory invoked once at startup**, the de-facto lifecycle today is: **config is read exactly once, at process start; there is no re-read, no file watch, no restart-on-change.** Translating the contract's questions:

- **Edits while the server runs → re-read? restart? pinned at open?** Today: **pinned at open** (the factory runs once, `mcp-stdio.mjs:16`). A descriptor-driven server, if implemented naively with `JSON.parse(readFileSync(...))` at startup (the pattern at `application-deployment.mjs:355,429`), would inherit the same pin-at-open semantics — mid-run route/credential/principal edits would be **invisible until restart**, silently. This is the highest-value lifecycle hole: an operator who edits the descriptor to add a route or rotate a credential will see **no effect** and no error.
- **Partial JSON / truncation:** `JSON.parse` throws on truncation (`application-deployment.mjs:355` pattern) → process exits with `startup failed` (`mcp-stdio.mjs:28-29`). Acceptable, but a descriptor written by a concurrent writer mid-flush would fail startup non-deterministically — no atomic-rename discipline is documented.
- **BOM / encoding:** `readFileSync(path, 'utf8')` (`application-deployment.mjs:355,429`) does **not** strip a UTF-8 BOM; `JSON.parse` on a BOM-prefixed string **throws**. A descriptor saved by Notaclassic editors (BOM-on-save) would fail startup with an opaque parse error.

**Amendment 5-A:** before PKG-1 ships, the contract must specify: (i) **pin-at-open** semantics explicitly (descriptor is read once at server start; edits require restart — documented, not silent), OR a documented re-read/watch policy; (ii) **atomic load** (read with a `stat`+rename or a temp-then-rename writer contract) to avoid torn reads; (iii) **BOM-tolerant, UTF-8-validated** parse (strip a leading BOM, reject non-UTF-8 with a typed `descriptor_encoding_invalid` code rather than a generic parse error). None of this is defensible today because the loader does not exist.

---

## 6. MCP-W3 doctor freshness — per-call vs cached; quota interactions

**Verdict: NEEDS-AMENDMENT** (the freshness *model* is correct and defended in the embedded layer, but `deployment.doctor` does not exist over MCP, and the quota interaction is an unaddressed hole).

### 6a. Freshness — the embedded model is per-call (defended)

`doctorReadiness()` (`application-deployment.mjs:1254-1263`) is explicitly per-call fresh for the volatile parts — the comment at `:1252-1253` is direct: *"workspace capacity is observed FRESH at each doctor/card read — disk state moves, and an open-time snapshot would go stale exactly when the answer matters."* Each call re-runs `this.#workspaceProbe()` and `this.#claudeCredentialProbe()` (`:1255-1256`) and overlays them. `doctor()` simply returns `doctorReadiness()` (`application-deployment.mjs:1267`). So the contract's "per-call fresh read, not open-time cached" claim is **true for workspace + credentials**.

**Nuance the contract must state:** the **routes** array is **construction-pinned** — `this.#readiness` is captured when the deployment is built (`doctorReadiness` spreads `...this.#readiness`, `:1262`); only the claude-code credential overlay and workspace are re-probed per call (`:1257-1260`). So a route whose underlying provider goes away mid-session is **not** detected by doctor until restart. (Claude credential expiry *is* caught, because that overlay is fresh.) **Amendment 6-A:** state that doctor is per-call-fresh for workspace/credentials and construction-pinned for routes.

### 6b. The tool does not exist over MCP

`deployment.doctor` is **not** an MCP tool (no entry in any tool table; `application-client.mjs:1574` `doctor()` is embedded-only; the web bridge exposes doctor through the application facade, not as a named MCP tool). So the contract's MCP-W3 — like MCP-W1 — proposes a surface that is not wired. The freshness model would carry over cleanly when wired (it is a plain method call), but until then an external orchestrator **cannot read readiness at all** (contract GT#4: "Readiness honesty doesn't cross the boundary").

### 6c. Quota interaction — the hole

Every MCP tool call gates through `takeToolQuota` **before** dispatch (`mcp-northbound.mjs:1089-1095`; the quota authority is mandatory, `:851`). On quota exhaustion the call returns `rate_limited` (`:1094`); if the quota call itself throws, `temporarily_unavailable` (`:1091`). The quota authority is a flat windowed counter with **no per-tool carve-out** (web bridge: `mcp-web-bridge.mjs:276-284`, `calls <= maxCalls` over a window — every tool, including health reads, counts identically).

Consequences for `deployment.doctor` (and the polling-only `waves.progress` of §2, and `decision.list` of §3):

- A readiness probe **counts against the same budget** as a control call. An orchestrator that polls doctor before each decision (reasonable defensive practice) or polls progress in a loop will exhaust its tool window and start receiving `rate_limited` — **masking the real readiness/progress answer behind a quota error.**
- This is worse than it looks because `rate_limited` and `temporarily_unavailable` are also what an actual outage returns, so the caller cannot distinguish "I am throttled" from "the deployment is unhealthy" — the one signal doctor is meant to provide is corrupted by the quota gate that doctor itself trips.

**Amendment 6-B:** read-only health/observe tools (`deployment.doctor`, `waves.progress`, `decision.list`) should be **quota-exempt or on a separate observe budget** — the generic gate at `mcp-northbound.mjs:1089` does not distinguish them today. At minimum the contract must document that doctor counts against quota and specify the cadence a caller should use, since an unthrottled health poll self-DoSes the caller's tool window.

---

## Appendix A — Tool-surface ground-truth table

Closed, frozen at module load (`mcp-northbound.mjs:427-431` freeze + `_meta registryDigest`). Confirmed by the executable inventory helpers `mcpApplicationToolNames`/`mcpCombinedToolNames`/`mcpDispatchToolNames` (`mcp-northbound.mjs:1580-1591`).

| Contract tool | Ordinary/Advanced/Reflex | Impl | Evidence |
|---|---|---|---|
| `waves.attach` (`baton_waves_attach`) | ordinary | ✅ harvest-only | `mcp-northbound.mjs:410`; `application-semantics.mjs:1527` |
| `waves.start` | — | ❌ | absent from `APPLICATION_TOOL` (`mcp-northbound.mjs:30-45`) |
| `waves.progress` | — | ❌ | absent |
| `waves.send` | — | ❌ (embedded `wave.mjs:360`) | absent over MCP |
| `waves.stop` | — | ❌ (embedded `wave.mjs:368`) | absent over MCP |
| `decision.answer` (`baton_decision_answer`) | reflex Part C | ✅ | `mcp-northbound.mjs:512,762,1313` |
| `decision.list` (`baton_decision_list`) | surfacing matrix | ✅ | `mcp-northbound.mjs:1303` |
| `deployment.doctor` | — | ❌ (embedded `application-client.mjs:1574`) | absent over MCP |
| MCP-W2 settlement (4 ops) | — | ❌ (embedded-only KS9) | absent |
| `run.start/inspect/act/stop` (`baton_run_*`) | ordinary | ✅ | `mcp-northbound.mjs:402-407` |

Transport frame facts: `maxMessageBytes` deployment-derived+mandatory (`mcp-northbound.mjs:896-899`); web-bridge default **256 KiB** (`mcp-web-bridge.mjs:296`); wave progress internal ceiling **7 MiB** (`wave.mjs:21`); response oversize → `application_run_view_oversize` throw (`mcp-northbound.mjs:1469-1471`); request oversize → discarded `-32700` (`mcp-northbound.mjs:1530-1557`).

## Appendix B — Open questions for the authority-attacker sibling (`redteam-authority.md`)

These lifecycle findings hand off to / depend on the authority angle:

1. **Settlement-lease session binding (MCP-W2).** This report treats the four settlement ops as "absent over MCP (KS9)." Whether the S-2 `sessionAuthority` envelope crossing stdio is ceremony or substance after #63's XB — and whether deriving the session from the deployment principal re-opens the bearer hole — is the authority report's MCP-W2 target (contract §MCP-W2 red-team). The lifecycle concern here is only: until those tools land, the acceptance driver's step 6 (admit knowledge) is impossible over MCP.
2. **`waves.attach` mintWaveDetached server-side proof.** This report confirms the proof is constructed server-side (`application-client.mjs:1552-1556`) so no live handle crosses the transport (S-1). Whether an MCP caller can *present* a forged/foreign `waveId` and get anything back is the authority angle — lifecycle notes only that `attachWave` refuses a zero-bind with `wave_attach_unknown_wave` (`wave.mjs:300`) and a mismatched run with `application_wave_member_mismatch` (`wave.mjs:283`), so re-attach is scoped, not bluffable.
3. **PKG-1 descriptor path-escape / credential-ref smuggling.** This report covers the *lifecycle* of the descriptor (pin-at-open, atomic load, BOM). The *authority* hazards of the descriptor (path escape outside repo root, file credential refs outside repo, schema smuggling, env-ref leaking) are the authority report's PKG-1 section — but both reports share the root fact that **the descriptor parser does not exist yet** (§5a), so all PKG-1 targets are presently untestable.

---

## Verdict roll-up

| # | Vector | Verdict | Headline amendment |
|---|---|---|---|
| 1 | Detached semantics / host-death / re-attach / idempotency | **NEEDS-AMENDMENT** | MCP recovery is harvest-only today (run-level steering via `baton_run_act` is the escape hatch but loses wave guarantees); `waves.start` idempotencyKey undocumented over MCP; name which transport survives host death (1-A/1-B/1-C) |
| 2 | waves.progress freshness / frame wedging | **CONFIRMED-HOLE** | 7 MiB internal ceiling vs deployment-derived `maxMessageBytes` (256 KiB default) → `application_run_view_oversize` on large waves; the *existing* `waves.attach` closed payload is already oversize-prone; poll-only; contract's "64 KiB" doesn't exist (2-A/2-B/2-C) |
| 3 | decision.answer across transport gap | **DEFENDED** (+amendments) | Late answer returns honest `already_resolved`/`expired`; amend to typed MCP code, document poll cadence, and gate-test `deadlineAt` projection (3-A/3-B) |
| 4 | Acceptance driver failure modes | **CONFIRMED-HOLE** (5 of 7 steps have no MCP tool) | Driver cannot run today; will hit progress-hallucination + caller-accounting outcome-duplication (durable settlement is idempotency-keyed) when tools land |
| 5 | PKG-1 descriptor lifecycle | **CONFIRMED-HOLE** | Descriptor parser absent; pin-at-open/atomic-load/BOM all unspecified (5-A) |
| 6 | MCP-W3 doctor freshness | **NEEDS-AMENDMENT** | Freshness model right; tool absent over MCP; observe tools self-DoS the quota window (6-A/6-B) |

**Overarching:** the contract is a sound *design* for a surface that the implementation has not yet built. The lifecycle hazards that are **already real in the embedded primitives** (7 MiB progress ceiling vs transport frame size; poll-only freshness; harvest-only wave recovery; quota gating health reads; pin-at-open config) are the ones to amend *into the contract before the tools are wired*, so the surface lands defensible rather than inheriting silent degradations. The hazards that are **absent because the surface is absent** (waves.start/progress/send/stop, deployment.doctor, MCP-W2, PKG-1 descriptor) are CONFIRMED-HOLE *as specified against today's impl* and become NEEDS-AMENDMENT the day implementation begins — the amendments above are the contracts each tool must satisfy to be transport-safe.
