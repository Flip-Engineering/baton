# Issue #28 contract — wire-frame graceful degradation (v1)

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

1. **Inbound tool_result frames degrade; everything else still kills honestly.** When the
   buffered line exceeds the ceiling, inspect the frame HEAD (first ≤256 bytes): if it
   matches a tool_result wire frame (`"type":"user"` with `"tool_result"` in the head), the
   adapter MUST NOT kill the run. It discards the buffered bytes through the next newline
   and injects a bounded synthetic tool_result in its place: same `tool_use_id` when it can
   be parsed from the head (the id sits inside the first 4KiB of the frame), content exactly
   `[tool result withheld: the frame was N bytes, over the M-byte ceiling; read the file in
   ranges or bound the command output]` with N/M filled in. The worker learns the size and
   the corrective behavior; the turn continues.
2. **A typed degradation receipt is emitted** on every degradation: `wire.frame_degraded`
   with `{frameBytes: N, ceilingBytes: M, toolUseId: string|null}` (actor 'policy',
   turnEpoch of the session). No content bytes, no secrets in the receipt.
3. **Non-tool_result oversize is still terminal** with `wire_frame_oversize` — an oversized
   assistant frame or protocol frame cannot be salvaged honestly.
4. **The provider-secret check runs before degradation** (secret material in a partial frame
   is never handed to the model, truncated or not).
5. **Deliberate ceilings are deployment-owned.** `advanced.adapterOptions` gains
   `maxWireFrameBytes` (integer, 64KiB–64MiB), passed to `ClaudeSessionCli` at
   `application-deployment.mjs:643` (and the GLM family path, which rides the same class).
   The adapter card advertises the effective ceiling (`card().wire.maxFrameBytes` or the
   existing limits block) so a driver can read it back. The `BATON_CLAUDE_MAX_WIRE_FRAME_BYTES`
   env var remains as a lower-precedence fallback.

## Red-first tests — `impl/test/issue28-wire-degrade-red.test.mjs`

1. **R28-1 degrade:** a fake CLI emitting a >1MiB tool_result frame (with a parseable
   tool_use_id) does NOT kill the run; the worker receives the synthetic bounded refusal
   (text names N and M and "read in ranges"); a `wire.frame_degraded` event carries the
   byte counts and the id; the run continues to a normal completion.
2. **R28-2 honest kill:** an oversized non-tool_result frame (assistant-shaped) terminates
   with `wire_frame_oversize`.
3. **R28-3 plumbing:** `advanced.adapterOptions.maxWireFrameBytes` reaches the adapter (a
   frame under the default 1MiB but over a configured 256KiB degrades at the configured
   value) and the card advertises the configured ceiling.
4. **R28-4 head-idempotent:** two oversized tool_result frames in one session each produce
   their own degradation and receipt (no state carryover).
5. **R28-5 secret precedence:** an oversized frame whose head contains protected credential
   material is refused by the secret path, never degraded into the model.

Deterministic; fake CLI/adapter fixtures; no live providers; fixed clocks.

## Verification

```text
node --test impl/test/issue28-wire-degrade-red.test.mjs
```

then the canonical suite (`node impl/scripts/run-suite.mjs` from the repo root) fully green.
