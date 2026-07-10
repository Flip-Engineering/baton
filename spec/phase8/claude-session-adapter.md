# Phase 8 — Claude Session Adapter (`ClaudeSessionCli`)

*Fills the biggest gap named in `docs/22-completeness-audit.md` §4/§6#1: a real Claude Code worker
driven as a persistent session over `--input-format stream-json`, instead of the one-shot `claude -p`
child in `src/cli-adapters.mjs`. This spec does not amend `spec/RECONCILIATION.md` — every decision
below fits inside the existing D1 (session-shaped 8-verb Adapter), D3 (EventKind vocabulary), and D9
(interrupt/kill composition) contracts unchanged. Where this module must pick a semantics D-decisions
leave open (steer's mechanism, the exact `answer()` wire reply), that choice is pinned here, not by
amending RECONCILIATION.**

Module: `impl/src/claude-session.mjs` (new; not yet implemented — this phase is spec + TDD-red tests).
Tests: `impl/test/claude-session.test.mjs`. Fixture: `impl/test/fixtures/fake-claude.mjs` (a scriptable
fake `claude` binary; zero model quota — the real `claude` binary is never invoked by the test suite).

## 0. Ground truth this spec is pinned to (verified live, 2026-07-10)

- `claude --help` (installed CLI **2.1.206**) confirms: `--input-format <format>` (`text`|`stream-json`,
  "only works with --print"), `--output-format <format>` (`text`|`json`|`stream-json`), `--verbose`,
  `--resume [value]` / `-r`, `--continue` / `-c`, `--session-id <uuid>`, `--replay-user-messages`.
  **`--permission-prompt-tool` does NOT appear in `--help` output** (confirmed via `grep` — exit 1) —
  it is an undocumented/hidden flag. `strings` on the installed binary
  (`/Users/wahargis/.local/share/claude/versions/2.1.206`) confirms the flag exists
  (`--permission-prompt-tool <tool>`) and that its normal contract is "must be an MCP tool" — a bare
  value is rejected with *"not found. Available MCP tools: …"* UNLESS the value is the literal magic
  string `"stdio"`. Ground truth for that magic value comes from the Agent SDK's own source
  (`@anthropic-ai/claude-agent-sdk` 0.3.205 `sdk.mjs`, local install), which is the de-facto spec:
  ```
  if(L0){if(w)throw Error("canUseTool callback cannot be used with permissionPromptToolName...");
         m.push("--permission-prompt-tool","stdio")}
  ```
  (`L0` = the SDK's `canUseTool` callback.) **This resolves the audit's ambiguity**: `--permission-prompt-tool
  stdio` is real, vendor-shipped, and is how the SDK itself gets tool-approval requests routed onto the
  control-request/control-response channel instead of a named MCP tool. `ClaudeSessionCli` uses the exact
  same flag+value when constructed with `approvals: true`.
- The **exact `interrupt` control-frame shape** is taken verbatim from the same `sdk.mjs` (not inferred
  from the dossier, which only gave an *example*): `Query.request()` builds
  `{request_id: <random base36>, type:"control_request", request: Q}` and `Query.interrupt()` calls
  `this.request({subtype:"interrupt"})`. So the wire frame this adapter sends is:
  ```json
  {"type":"control_request","request_id":"<id>","request":{"subtype":"interrupt"}}
  ```
  This is a stronger source than `docs/reference/claude-agent-sdk.md`'s illustrative example (same
  shape, but that doc could not cite the generator) — no ambiguity remains for this frame.
- `system/init`, `assistant` (text/tool_use), `result` (success/is_error) shapes reuse the **verbatim
  captured fixtures** already in `impl/test/cli-adapters.test.mjs` (`CLAUDE_LINES`), extended with the
  additional fields the dossier documents (`session_id`, `capabilities`, `stop_reason`).
- `can_use_tool` control_request/response shape and the `PermissionResult` union
  (`{behavior:'allow', updatedInput?}` / `{behavior:'deny', message, interrupt?}`) are taken directly
  from `docs/reference/claude-agent-sdk.md` §5/§7, cross-referenced against `sdk.d.ts` line citations.
  This is fully pinned — no ambiguity.
- The `elicitation` control_request (CLI→client, used here for `answer()`/questions) is confirmed to
  exist as a wire subtype (dossier §7, and in the 2.1.206 binary's control-subtype string table), but
  **the exact reply envelope a non-hook client sends back is NOT captured anywhere in the dossier** —
  only the `ElicitationResult` *hook input* fields (`mcp_server_name, action, content, mode,
  elicitation_id`) are documented, and hooks are a different channel (`hook_callback`, not a raw
  `control_response`). **This is a genuine ambiguity.** §5 below specifies the reply frame this adapter
  implements and flags it explicitly as the least-verified part of this spec.

## 1. Constructor (the testability contract)

```js
new ClaudeSessionCli({
  cmd = 'claude',            // overridden to process.execPath in tests
  args = [],                 // prefixed before the standard flags; e.g. [fakeClaudePath] in tests
  env = {},                  // merged over process.env
  harness = 'claude-code',
  version = '2.1.206',
  ceiling = 4,
  maxContext = 200000,
  approvals = false,         // adds --permission-prompt-tool stdio + enables approve()/answer()
  sessionId,                 // if set, adds --resume <sessionId> (CS15)
  killGraceMs = 5000,        // SIGTERM->SIGKILL escalation window (see CS14 derivation)
})
```

Final child argv = `[...args, ...buildClaudeSessionArgs({approvals, sessionId, model})]`.
`buildClaudeSessionArgs()` is exported as a **pure function** (no process spawned) so its shape can be
asserted directly, mirroring the existing `renderPrompt`/`parseCodexEvent` pure-function test style in
`cli-adapters.mjs`. It always includes `--input-format stream-json --output-format stream-json
--verbose` (the CLI's own binary-string constraints require `--verbose` and `--print` for stream-json;
`--print` is added too since stream-json "only works with --print").

`killGraceMs` default of **5000ms is not an arbitrary number**: it is the same SIGTERM→SIGKILL grace
window the Agent SDK's own `ProcessTransport.close()` uses (verified in `sdk.mjs`:
`this.process.kill("SIGTERM"),setTimeout(()=>{if(!killed)this.process.kill("SIGKILL")},5000)`). This
adapter reuses the vendor's own precedent rather than inventing a number, and the field is
constructor-injectable (tests set it to tens of ms) per the house "no arbitrary numeric limits" rule.

## 2. Contract table (CS1..CS19)

| # | Contract |
|---|---|
| CS1 | `buildClaudeSessionArgs()` always includes `--print --input-format stream-json --output-format stream-json --verbose`; adds `--permission-prompt-tool stdio` iff `approvals:true`; adds `--resume <id>` iff `sessionId` given. |
| CS2 | `spawn(worker, brief, opts)` requires `opts.worktree` (cwd); the Brief (rendered via the existing `renderPrompt()` from `cli-adapters.mjs` — reused, not duplicated) is written as the **first** `user` message frame on stdin; **stdin is left open** (never `.end()`-ed) — this is the entire reason session mode exists. |
| CS3 | `lifecycle.spawned` is emitted only once per session, when the real `system/init` frame arrives; payload carries the wire's own `session_id` (never a client-generated uuid) and the child's `pid`. |
| CS4 | `lifecycle.turn_started` is emitted by the ADAPTER (not parsed off the wire) at the moment a `user` message frame is written — stream-json has no CLI-emitted "turn started" marker (unlike Codex's `turn.started`); this is documented here as the honest limit of what the wire gives you. |
| CS5 | `lifecycle.turn_completed` fires on a `result` frame with `is_error:false`; the underlying process is NOT torn down — the session persists for the next `prompt()`. |
| CS6 | Multi-turn, one process: two sequential `prompt()` calls yield two `lifecycle.turn_completed` events whose payload `pid` is IDENTICAL (asserted as the effect proving no respawn occurred, not merely that two Acks returned `ok:true`). |
| CS7 | `prompt(worker, content, 'turn'|'nudge')` writes a plain `user` message frame (native — no `emulated` flag on the Ack). Honest limit: this is **turn-boundary injection only** — stream-json gives no way to splice content into a completion already in flight; `'nudge'` and `'turn'` are wire-identical for Claude (both just queue the next `user` frame), unlike Codex where nudge vs turn differ. |
| CS8 | `prompt(worker, content, 'steer')` is **emulated** as: `interrupt()` → await `control.interrupt_confirmed` → send `content` as the next `user` frame. Chosen over "queued-priority-message" because it actually redirects an in-flight turn (abandons wasted work) rather than just moving a message up a FIFO — see §3. `card().verbs.steer === 'emulated'`; the Ack carries `emulated:true` (no silent emulation, D1). |
| CS9 | `interrupt(worker)` sends `{type:'control_request', request_id, request:{subtype:'interrupt'}}` (exact shape, §0). The Ack resolves immediately as `{ok:true}` (native — this is a real control-plane primitive, not a signal). The CONFIRMED stop is a **later** `control.interrupt_confirmed` event, matched by the `control_response` carrying the same `request_id` — never returned from `interrupt()` itself (D1). |
| CS10 | **Session survives interrupt**: after `control.interrupt_confirmed`, a subsequent `prompt()` on the same worker succeeds and completes normally on the SAME child `pid` — proving the process was never killed. |
| CS11 | A `result` frame for the just-interrupted turn that arrives after (or racing) the `control_response` is discarded — never turned into a `lifecycle.turn_completed` (mirrors D9: "a `lifecycle.turn_completed` that arrives during the stopping window is discarded"). Single-terminal-per-TURN: the turn's one terminal event is `control.interrupt_confirmed`, not both. |
| CS12 | `approve()`: a `can_use_tool` control_request from the wire surfaces as `approval.requested` (`requestId` = the wire `request_id`, `payload.toolName`/`payload.input` from `tool_name`/`input`). `approve(worker, requestId, decision, payload)` writes the matching `control_response`: `allow`→`{behavior:'allow', updatedInput: payload?.updatedInput}`; `deny`→`{behavior:'deny', message: payload?.message ?? 'denied by baton'}`; `cancel`→`{behavior:'deny', message: payload?.message ?? 'cancelled by baton', interrupt:true}` (the wire's `PermissionResult` union has no native `cancel`; this is the closest achievable mapping — **flagged as an emulation** via `emulated:true` on the Ack specifically for the `cancel` decision, per D1 "no silent emulation"). A denied/cancelled tool call does **not** crash the turn — the turn still completes normally (real Claude continues after a tool denial); only a genuine process-level failure produces `lifecycle.crashed`. |
| CS13 | `answer()`: an `elicitation` control_request surfaces as `question.asked` (`requestId` = `elicitation_id`). `answer(worker, requestId, {text, decision})` replies `{type:'control_response', response:{subtype:'success', request_id, response:{action: decision ?? (text ? 'accept' : 'decline'), content: text !== undefined ? {value:text} : undefined}}}`. **Ambiguity flagged** (§0): the exact reply shape for a non-hook client answering a wire-level `elicitation` request is not captured in the dossier; this is this adapter's best-effort construction from the documented `ElicitationResult` hook fields, and the fake binary in this repo is the only thing that currently understands it. |
| CS14 | `kill(worker)`: SIGTERM to the process group immediately; if the process has not exited within `killGraceMs`, escalate to SIGKILL (derivation: §1). `kill.confirmed` fires on the process `close` event, carrying which signal actually took effect. Every `kill()` Ack resolves — matches D9 "kill always works," never hangs on a value the process can't emit. |
| CS15 | `sessionId` in the constructor adds `--resume <sessionId>`; the resumed session's `lifecycle.spawned` reports that SAME `session_id` (round-trip proof, not just an argv-shape check). |
| CS16 | Once `lifecycle.exited`/`lifecycle.crashed` fires for a worker, no further event is EVER emitted for that worker — a stray trailing line on a closing pipe is silently ignored (mirrors `CliAdapter._onData`'s single-terminal discipline, but at the session level, since a session outlives many turns). |
| CS17 | Session death mapping: a clean process exit (code 0, not from a `kill()`/`interrupt()` we initiated) → `lifecycle.exited`; a nonzero exit, a spawn `'error'` event, or an unrecoverable stream failure → `lifecycle.crashed`. |
| CS18 | `approvals:false` (default) ⇒ `card().verbs.approve === 'unsupported'` and `card().verbs.answer === 'unsupported'`; `approve()`/`answer()` reject `{ok:false}` without touching the wire (no `--permission-prompt-tool` flag was even passed, so there is nothing to reply to — a wire `can_use_tool` request in this mode would simply never arrive because the CLI never emits one without the flag). `approvals:true` ⇒ both report `'native'` (the `cancel` decision sub-case notwithstanding, per CS12). |
| CS19 | Every Ack for a genuinely native verb omits `emulated` (or is `false`); only `steer` and the `cancel` sub-path of `approve` ever carry `emulated:true` — asserted directly, not inferred (D1's "no silent emulation" rule). |

## 3. Steer semantics — the ONE picked (audit §4 asks for exactly one)

Two candidate semantics were named in the assignment: (a) interrupt-then-reprompt-with-context, or
(b) queued-priority-message. **This adapter implements (a).** Rationale: `'nudge'` mode already covers
(b) — mode `'nudge'` and mode `'turn'` both just append a `user` frame that the CLI processes once
idle (CS7); if `'steer'` did the *same* thing, it would be indistinguishable from `'nudge'` and the
card's `steer:'emulated'` declaration would be a lie by omission (nothing would actually be steered,
only queued). Semantics (a) is the only one of the two that changes the *in-flight* turn's outcome —
it genuinely redirects the worker rather than politely waiting its turn. The cost, honestly stated: the
turn-in-progress's partial work is abandoned (not spliced), exactly like Codex's own
`turn/steer` "behavioral semantics unverified" caveat in `spec/adapter-contract.md` — except here the
tradeoff is not merely unverified, it is the KNOWN, stated tradeoff of the emulation, which is why the
card says `emulated`, not `native`.

## 4. Event → BatonEvent kind mapping (D3 vocabulary only, no new kind strings)

| Wire signal | BatonEvent kind |
|---|---|
| `system/init` (first time only) | `lifecycle.spawned` |
| adapter writes a `user` frame | `lifecycle.turn_started` |
| `assistant` frame with `text` content | `content.message` |
| `assistant` frame with `tool_use` content | `content.tool_call` |
| `result` (`is_error:false`) | `lifecycle.turn_completed` |
| `result` for an already-interrupted turn | *(discarded — no event, CS11)* |
| adapter sends `control_request{subtype:'interrupt'}` | `control.interrupt_requested` |
| matching `control_response` for that request | `control.interrupt_confirmed` |
| CLI `control_request{subtype:'can_use_tool'}` | `approval.requested` |
| adapter's reply to it | `approval.resolved` |
| CLI `control_request{subtype:'elicitation'}` | `question.asked` |
| adapter's reply to it | `question.answered` |
| adapter sends SIGTERM/SIGKILL via `kill()` | `kill.requested` → `kill.confirmed` on close |
| clean process exit (no stop in flight) | `lifecycle.exited` |
| nonzero exit / spawn error | `lifecycle.crashed` |
| `prompt(..., 'nudge')` | `control.nudge` (in addition to the turn_started/turn_completed pair) |
| `prompt(..., 'steer')` | `control.steer` (see §3 sequence) |

## 4b. Payload shapes (what the test suite pins down)

| kind | payload |
|---|---|
| `lifecycle.spawned` | `{sessionId, pid}` — `sessionId` from the wire `system/init`, never client-generated |
| `lifecycle.turn_started` | `{}` |
| `content.message` | `{text}` |
| `content.tool_call` | `{name, input}` |
| `lifecycle.turn_completed` | `{result: {status:'completed', summary, artifacts, verification, openQuestions, budgetUsed}, pid}` — same `WorkerResult` shape `makeResult()` produces in `cli-adapters.mjs`, for downstream (referee/story) consistency |
| `lifecycle.crashed` | `{error}` |
| `lifecycle.exited` | `{code}` |
| `approval.requested` | `{requestId, toolName, input}` |
| `approval.resolved` | `{requestId, decision, payload}` |
| `question.asked` | `{requestId, question}` |
| `question.answered` | `{requestId, text, decision}` |
| `control.interrupt_confirmed` / `kill.confirmed` | `{signal}` |

## 5. `card()`

```js
{
  harness: 'claude-code', version, authPosture: 'subscription',
  concurrencyCeiling: ceiling, maxContext,
  verbs: {
    spawn: 'native', prompt: 'native', steer: 'emulated', interrupt: 'native',
    approve: approvals ? 'native' : 'unsupported',
    answer:  approvals ? 'native' : 'unsupported',
    kill: 'native',
  },
}
```

## 6. Fake binary (`test/fixtures/fake-claude.mjs`)

A standalone, dependency-free ESM script (`node test/fixtures/fake-claude.mjs`) that:
- Emits a `system/init` line on startup (`session_id` = `--resume`/`--session-id` value if given, else a
  fresh uuid; includes `capabilities:["interrupt_receipt_v1"]` matching the dossier's feature-detect
  convention).
- Reads stdin line-delimited JSON (`readline`, `terminal:false`); tolerates blank lines and malformed
  JSON exactly like the real CLI's tolerant NDJSON reader (skipped rather than fatal).
- Per incoming `user` frame, scripts behavior deterministically off **content markers** (no
  sleep-based timing races):
  - `REQUEST_APPROVAL:<toolName>` → emits a `can_use_tool` control_request and blocks the turn until a
    `control_response` answers it, then completes the turn reflecting the decision.
  - `REQUEST_QUESTION` → emits an `elicitation` control_request, blocks until answered, then completes.
  - `HOLD_UNTIL_INTERRUPT` → emits one `assistant` text event and then blocks forever (no `result`)
    until an `interrupt` control_request arrives.
  - `TRIGGER_CRASH` → writes to stderr and `process.exit(1)` immediately, simulating a genuine vendor
    process failure (for CS17).
  - anything else → emits an `assistant` text event (`Echo: <text>`) then a success `result` — this is
    how CS2's "the Brief was actually delivered" effect is asserted (the echoed text contains the
    brief's `goal`).
  - a `user` frame arriving while a turn is already in flight is queued and started once the current
    turn ends (drains after interrupt confirmation or normal completion) — real turn-boundary queueing.
- Honors `interrupt` control_requests exactly per §0's frame: replies
  `{type:'control_response', response:{subtype:'success', request_id, response:{still_queued:[]}}}`,
  then (if a turn was in flight) emits that turn's terminal `result` with `stop_reason:'interrupted'`
  and clears any pending approval/question wait for it — and **stays alive** for the next prompt.
- Exits 0 when stdin closes (EOF) — matches `sdk.mjs`'s own contract, "stream-json input requires a
  readable stdin for the lifetime of the session."
- `FAKE_CLAUDE_IGNORE_SIGTERM=1` env var makes it install a no-op `SIGTERM` handler once (simulating an
  unresponsive vendor process) so `kill()`'s SIGKILL escalation (CS14) is exercised, not just SIGTERM.

## 7. What this phase does NOT do

- Does not implement `impl/src/claude-session.mjs` itself (TDD-red: the test file imports it and must
  fail on that import today, for the right reason).
- Does not wire `ClaudeSessionCli` into `CLI_ADAPTERS`/`index.mjs` — that is the next (green) phase.
- Does not attempt PreToolUse-hook-based input rewriting (dossier's alternative steer mechanism) — out
  of scope for the base stream-json control surface this phase targets; noted as a future upgrade path,
  not a missing requirement (D1 already satisfied via CS8's emulation).
