# Adapter Contract (v0 draft — for review)

*The southbound interface every harness adapter implements, and the exact mapping from baton's abstract verbs to each harness's real API. Verb vocabulary from `docs/02`; APIs from `docs/01`/`docs/02` (verified) and the anatomy dossiers. This is the single most load-bearing practical artifact: if the mapping table has a lie in it, the adapter is a lie.*

## The adapter interface

An adapter is a process (or in-process module) the hub owns. It MUST implement:

```ts
interface Adapter {
  card(): HarnessCard;                       // capability negotiation, see harness-card.schema.json
  spawn(req: SpawnRequest): Promise<WorkerHandle>;
  prompt(worker: WorkerId, content: Content, mode: 'turn'|'nudge'|'steer'): Promise<Ack>;
  interrupt(worker: WorkerId, then?: Content): Promise<Ack>;
  approve(requestId: string, decision: Decision): Promise<void>;  // hub → worker approval reply
  resume(sessionRef: SessionRef): Promise<WorkerHandle>;
  kill(worker: WorkerId): Promise<void>;     // MUST verify process/thread death
  usage(worker: WorkerId): Promise<Usage>;
  // events: the adapter PUSHES BatonEvents to the hub via a callback set at construction.
  onEvent(cb: (e: BatonEvent) => void): void;
}
```

Every method that a given harness can't do natively either (a) emulates it and stamps `emulated: true` on the resulting `Ack`/event, or (b) rejects with `Unsupported` — and the `card()` MUST have declared which, up front. **No silent emulation.** (This rule is the whole reason capability negotiation exists; a judge-council concern to hold the line on.)

## Verb → real-API mapping

Legend: ✅ native call · 🔧 emulated (recipe given) · ❌ declared unsupported in card.

### Codex adapter → `codex app-server` (v0.144.0, protocol v2)

| Baton verb | Codex method(s) | Notes / payload reality |
|---|---|---|
| spawn | ✅ `thread/start` | params carry `cwd`; config via `-c key=val` at daemon launch or per-thread overrides. Returns `threadId`. Connect via daemon (`codex app-server daemon start` + proxy) for multi-client, or child stdio for isolation. |
| prompt (turn) | ✅ `turn/start` | accepts per-turn `sandboxPolicy` / `approvalPolicy` overrides — set these from the task's policy, don't rely on global config. |
| prompt (nudge) | 🔧 queue → next `turn/start` | app-server has no "queue for next turn"; the adapter holds the message and starts the next turn with it prepended. |
| prompt (steer) | ✅ `turn/steer` | **behavioral semantics unverified** (queue vs immediate context-splice) — M0 must test; card declares `steer: native` only after that test passes, else downgrade to 🔧. |
| inject context | ✅ `thread/inject_items` | first-class; use for post-compaction brief re-pinning too. |
| goal pin | ✅ `thread/goal/set` | persists goal state + accounting outside the transcript. **Correction (Codex review):** the documented guarantee is *persisted goal state*, NOT that arbitrary acceptance criteria are re-injected verbatim into every post-compaction prompt. Treat as a durable slot baton reads and re-injects on `PreCompact`, not an auto-compaction-proof DoD. No Claude equivalent. |
| interrupt | ✅ `turn/interrupt` | returns `{}` immediately; turn actually unwinds async — watch for `turn/completed` with a cancelled disposition before declaring idle. **Cross-client interrupt is allowed** even while another socket streams (OpenAI's own broker special-cases this) — baton relies on it for the deadlock guard (doc 05 §5). |
| approve | ✅ reply to server-requests | `execCommandApproval`, `applyPatchApproval`, `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput`, `mcpServer/elicitation/request`. Vocabulary: `accept / acceptForSession / decline / cancel`. **Correction (Codex review):** there is NO "edit the pending command" option. Command approvals additionally allow an *exec-policy amendment*, but that amends future policy, it does **not** rewrite the command in front of you; file approvals have no amendment at all. So baton's `approve(edit)` maps to `decline + steer/reprompt` on Codex — see `fleet_approve` semantics. Requests are consumable messages (a `serverRequest/resolved` notification fires), **not replayable facts** — answer exactly once. |
| resume/fork | ✅ `thread/resume` / `thread/fork` / `thread/rollback` | durable; `thread/list` to enumerate. |
| usage | ✅ `thread/tokenUsage/updated` (push) + `account/rateLimits/read` | rate-limit push means the scheduler learns ceilings without probing. |
| kill | 🔧 **sequence, not one call** | **Correction (Codex review):** `thread/archive` only moves persisted thread logs — it does NOT terminate an active turn, background terminal, or the app-server process. Real kill = `turn/interrupt` (unwind active turn) → terminate any `command/exec` background terminals → archive/close thread → stop/clean the app-server child if per-worker → **verify** process/thread death → emit `lifecycle.exited`. |
| events | ✅ notifications | `item/started`, `item/completed`, `item/agentMessage/delta`, `item/reasoning/*Delta`, `item/commandExecution/outputDelta`, `item/fileChange/patchUpdated`, `item/plan/delta`, `turn/plan/updated`, `turn/diff/updated`, `turn/started`, `turn/completed`, `error`, `process/exited`, `model/rerouted`, `thread/status/changed`, `guardianWarning`. |

Transport: NDJSON JSON-RPC over stdio (default); experimental WebSocket (`--listen ws://127.0.0.1:PORT`) and unix socket exist. **Contention reality:** OpenAI's shared broker single-flights requests and returns a `BROKER_BUSY`-style error when busy; if baton runs its own app-server per worker this is moot, but if it shares one it must handle busy-rejection with backoff.

### Claude adapter → Claude Agent SDK / stream-json (Claude Code 2.1.205)

| Baton verb | Claude mechanism | Notes / payload reality |
|---|---|---|
| spawn | ✅ `query()` (SDK) or `claude -p --input-format stream-json --output-format stream-json` child | one process per worker; adapter is the daemon Claude lacks. Options: `model`, `permissionMode`, `mcpServers`, `agents`, `cwd`, `resume`, `settingSources`, `includePartialMessages`, `abortController`. |
| prompt (turn) | ✅ stream-json user message on stdin | streaming-input mode keeps stdin open → multiple turns per process. |
| prompt (nudge) | 🔧 queue → next stdin message | native; just don't send mid-turn. |
| prompt (steer) | 🔧 `interrupt()` → re-prompt with steering, OR **PreToolUse hook `updatedInput`/`updatedToolOutput`** | the hook path is a *finer* native steering than Codex's message-level steer — rewrite the pending tool call rather than nudge the model. Card declares `steer: emulated(hook)`; arguably superior, flag it as such in telemetry. |
| inject context | 🔧 between turns; `--append-system-prompt` at spawn; hooks per-event | no `inject_items` equivalent mid-turn; re-inject brief post-compaction via a `SessionStart`/`PreCompact` hook. |
| goal pin | ❌ (emulate via `--append-system-prompt` + re-inject) | no durable goal slot; card declares unsupported-native. |
| interrupt | ✅ SDK `interrupt()` | streaming mode only; returns `SDKControlInterruptResponse` whose `still_queued` lists surviving user-message UUIDs — **the adapter must reconcile these** or a queued nudge silently applies post-interrupt. |
| steer-reconfig | ✅ `setModel()`, `setPermissionMode()`, `applyFlagSettings()` | mid-run model/effort/permission/hook/agent change applied next turn — a steering surface Codex lacks. |
| approve | ✅ `canUseTool` callback → `PermissionResult` | `{behavior:'allow', updatedInput?}` / `{behavior:'deny', message}` / interrupt flag. `updatedInput` = approval-editing (doc 05 §5) natively. Also `--permission-mode`, PreToolUse hooks (allow/deny/ask/defer). |
| resume/fork | ✅ `--resume`/`--continue` / `--fork-session` | transcripts are JSONL under `~/.claude/projects/<slug>/` — replayable; **no rollback** (card: `rollback: unsupported`). |
| usage | ✅ result-message usage fields + OTel export | `CLAUDE_CODE_ENABLE_TELEMETRY` → OTel; result subtypes carry token/cost. Merge, don't double-count, if the worker self-exports. |
| kill | ✅ SIGTERM → SIGKILL escalation | transcript preserved; verify death. |
| events | ✅ stream-json SDKMessages | system/init, assistant, user, result(subtypes), `SDKTaskProgressMessage`, hook events (`includeHookEvents:true`), partial deltas (`includePartialMessages:true`). Underlying control frames: `control_request`/`control_response` (interrupt, can_use_tool, hook_callback, set_permission_mode, mcp_message...). The `claude-agent-acp` source is the de-facto frame documentation. |

### GLM adapter → Claude adapter + Z.ai env (officially supported config)

Identical to the Claude adapter with env at spawn: `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic`, `ANTHROPIC_AUTH_TOKEN=<z.ai key>`, and exact model selection through both Claude's `--model` flag and `ANTHROPIC_DEFAULT_*_MODEL`. As of the Phase 30 refresh, Z.ai maps the normal Opus/Sonnet route to `glm-4.7`, Haiku to `glm-4.5-air`, and offers explicit `glm-5.1` as a higher-cost route; deployments must select rather than infer from an adapter version. Card differences from Claude: `usage` fidelity ⚠️ (Z.ai-side reporting unverified — may not populate OTel/cost the same way); **`concurrency_ceiling` set from plan tier** (Pro ≈ 1 in-flight) — the scheduler treats this as hard. Alternative worker: OpenCode against GLM (richer server API: `opencode serve` REST/WS, `opencode attach`, `export/import` session JSON, `acp` mode) — evaluate as a *distinct* adapter if Claude-harness/GLM mismatch degrades quality (dossier: `glm-opencode-leg`).

### ACP adapter (tier 2) → any ACP agent (Gemini CLI, others)

One adapter, many harnesses, lowest-common-denominator card: spawn=`session/new`, prompt=`session/prompt` (returns `stopReason`), interrupt=`session/cancel` (one-way; expect `StopReason::Cancelled`), approve=`session/request_permission` (`allow_once/allow_always/reject_once/reject_always`), resume=capability-gated `session/resume`, events=`session/update`. **Declares unsupported: steer, inject, goal-pin, usage-telemetry** (not in ACP). Use for reach, not for first-class workers.

### PTY adapter (tier 3, escape hatch) → tmux/PTY

spawn=new pane, prompt=send-keys, events=🔧 screen-scrape → best-effort `content.*` events only, everything else ❌. Card is almost all-unsupported by design; exists so the fleet view is total, not so it's good (doc 04 Option C).

## The harness card (capability negotiation)

Each adapter's `card()` returns a `HarnessCard` (schema: `harness-card.schema.json`) declaring, per verb, one of `native | emulated | unsupported`, plus limits (`concurrency_ceiling`, `max_context`, `supports_rollback`, `usage_fidelity`), the harness version string, and an `auth_posture` (`subscription | api_key`). The hub's `fleet_*` tools consult the card to (a) reject impossible requests early with a clear error, (b) stamp `emulated` on degraded ops, (c) feed the scheduler real ceilings. **Cards are generated by probing where possible** (Codex `generate-json-schema` + `features list`; Claude `--help` + SDK version) so they can't drift from the installed binary — a version-skew defense (doc 06 Q8).

## Non-obvious contract requirements (learned from the ACP bridges — see `acp-bridge-source` dossier)

1. **Interrupt/completion race**: `interrupt()` and a naturally-completing turn can both be in flight. The adapter owns reconciliation (claude-agent-acp uses a wedge-recovery grace period; baton adapters must expose a single authoritative "turn is truly over" event, not two racing ones).
2. **Cancelled approvals**: an approval request outstanding when a turn is cancelled MUST be answered `cancel`, or the worker hangs. Applies to every harness.
3. **Capability loss is data**: when ACP (or PTY) can't express a native capability, that loss is declared in the card AND stamped on affected events — downstream (scheduler, orchestrator, human) must see degraded mode, never infer it.
4. **Auth posture is per-worker**: subscription vs API key is a card field with graceful API-key fallback (doc 06 Q7); a GLM worker gets only its Z.ai auth in its env, never the orchestrator's Anthropic key (doc 06 Q10 secrets scoping).
