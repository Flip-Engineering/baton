# Issue #28 contract — wire-frame graceful degradation (v2)

(v2 folds the R28R red-team, verdict SOUND-WITH-FOLDS: R28R-1 the synthetic tool_result is
struck — `user` frames are dropped by the parse path, so degradation is discard + receipt
ONLY, with the corrective nudge delegated to the driver reacting to the receipt; R28R-2 the
receipt actor is 'worker' (the adapter boundary refuses 'policy'); R28R-3 both trigger sites
and the discard latch are named; R28R-4 the configurable range is capped at the 16MiB
governance cap; R28R-5 the closed-advanced key, builtInAdapters signature, and GLM/Kimi
parity are named; R28R-6 the card read-back is the existing governance.maxWireFrameBytes;
R28R-7 the tool_use_id head position gets a live-capture probe.)

Ground truth: issue #28. The wire ceiling exists and is correct as a bound; the defect is that
crossing it is always terminal. Contract for graceful degradation + deliberate ceilings.

## The shapes

**Inbound stream-json (claude-session family, `claude-session.mjs:770-790`).** Raw bytes
accumulate in `session.buf` until a newline completes a frame; today, buffer bytes over
`maxWireFrameBytes` → `_wireFrameFailure` → SIGKILL. The killer shape in practice: a worker
whole-file Reads a >1MiB file (or an unbounded command output), and the CLI's tool_result
wire frame carrying that content exceeds the ceiling.

**ACP json-rpc (`acp-json-rpc-process.mjs:130-160`).** Outbound frames over the ceiling are
already refused at write (an error, not a kill); inbound oversized lines fail the transport.
ACP stays as-is this contract: inbound oversize remains an honest terminal failure
(`wire_frame_oversize`), outbound stays a refusal.

## Rules

1. **Inbound tool_result frames degrade to discard + receipt; everything else still kills
   honestly.** The size check fires at BOTH ingestion sites — the completed-line path
   (`claude-session.mjs:756`) and the partial-buffer path (`:775`) — and at either, when the
   buffered line exceeds the ceiling, the adapter inspects the frame HEAD (first ≤256 bytes):
   if it matches a tool_result wire frame (`"type":"user"` with `"tool_result"` in the head),
   the adapter MUST NOT kill the run. It engages a session-scoped DISCARD LATCH
   (`session.discardingFrame = {bytesSeen}`) that drops every byte through the terminating
   newline (counting them, so the receipt's N is exact — and a frame bigger than 2× the
   ceiling cannot re-trigger on its own tail), then resumes normal parsing mid-chunk. NO
   synthetic frame is injected anywhere: `user` wire frames are dropped by the parse path
   (`claude-session.mjs:901-902`), the model already received the real result inside the CLI
   process (tools execute in-CLI; the echo is protocol noise to Baton), and nothing
   downstream waits on it (attack 2, verified). Degradation is discard + receipt — nothing
   more. The corrective nudge is NOT the adapter's: a driver/orchestrator reacting to the
   receipt may steer (nudge_turn/send), exactly as the wave drivers already do — the adapter
   emits no steer frames of its own (they have turn-accounting side effects).
2. **A typed degradation receipt is emitted** on every degradation: `wire.frame_degraded`
   with `{frameBytes: N, ceilingBytes: M, toolUseId: string|null}` — N counted through the
   terminating newline, M the effective ceiling. The actor is `'worker'` (the
   adapter→coordinator boundary refuses every non-worker actor, coordinator.mjs:1128, and
   rewrites to 'worker' at :1143-1147); the coordinator MAY mint a derived policy event from
   it (the :1131-1136 pattern). The kind lives in the operational log; whether it also enters
   the closed RUN_TIMELINE_OPERATIONAL_KINDS set is deferred to #53's debug projection. No
   content bytes, no secrets in the receipt. `toolUseId` is the head-parsed id when found
   (see the live-capture probe in Verification), else null; when the head window cannot hold
   a full tool_result signature (configured ceilings below ~128 bytes), the frame takes the
   honest-kill path of rule 3.
3. **Non-tool_result oversize is still terminal** with `wire_frame_oversize` — an oversized
   assistant frame or protocol frame cannot be salvaged honestly.
4. **The provider-secret check runs before degradation** (secret material in a partial frame
   is never handed to the model, truncated or not).
5. **Deliberate ceilings are deployment-owned.** `advanced.adapterOptions` gains
   `maxWireFrameBytes` (integer, **64KiB–16MiB** — the provider-governance cap,
   provider-governance.mjs:19, which the coordinator validates on every configured card).
   The key is added to the closed `advanced` shape (application-deployment.mjs:1351) with
   its own integer/range validation; `builtInAdapters` (:657) receives the advanced options
   and passes the ceiling to `ClaudeSessionCli` at `:692` AND to the GLM (`:703`) and Kimi
   (`:696`) family constructors — all three extend ClaudeSessionCli and spread `...opts`
   into super (claude-session.mjs:1261-1274, :1324-1333), so one plumbing change covers all
   three. The card read-back is the EXISTING `card().governance.maxWireFrameBytes`
   (claude-session.mjs:438) — no new wire block. The `BATON_CLAUDE_MAX_WIRE_FRAME_BYTES` env
   var remains as a lower-precedence fallback.

## Red-first tests — `impl/test/issue28-wire-degrade-red.test.mjs`

1. **R28-1 degrade:** a fake CLI emitting a >1MiB tool_result frame (with a parseable
   tool_use_id) does NOT kill the run; the worker receives the synthetic bounded refusal
   (text names N and M and "read in ranges"); a `wire.frame_degraded` event carries the
   byte counts and the id; the run continues to a normal completion.
2. **R28-2 honest kill:** an oversized non-tool_result frame (assistant-shaped) terminates
   with `wire_frame_oversize`.
3. **R28-3 plumbing:** `advanced.adapterOptions.maxWireFrameBytes` reaches the adapter (a
   frame under the default 1MiB but over a configured 256KiB degrades at the configured
   value) and `card().governance.maxWireFrameBytes` reports the configured ceiling. The
   256KiB case is delivered in multiple writes (multi-chunk path).
4. **R28-4 head-idempotent:** two oversized tool_result frames in one session each produce
   their own degradation and receipt (no state carryover), INCLUDING one frame larger than
   2× the ceiling delivered across multiple writes (the discard latch cannot re-trigger on
   the tail).
5. **R28-5 secret precedence:** an oversized frame whose head contains protected credential
   material is refused by the secret path, never degraded into the model.

Deterministic; fake CLI/adapter fixtures (`impl/test/fixtures/fake-claude.mjs` trigger-driven, a
BIG_TOOL_RESULT trigger emitting the giant `user` frame via send()); no live providers; fixed
clocks.

**Live-capture probe (Verification, alongside the suite):** one >1MiB Read against the real
claude CLI, pinning where `tool_use_id` actually sits in the captured frame head (the R28R-7
uncertainty — no captured tool_result frame exists in the repo today). The probe's output
settles whether the head-parse path is exact or always-null; the null path is acceptable
because the receipt is informational, not protocol-bearing.

## Verification

```text
node --test impl/test/issue28-wire-degrade-red.test.mjs
```

then the canonical suite (`node impl/scripts/run-suite.mjs` from the repo root) fully green.
