# Phase 78 Codex wire-recovery live evidence — 2026-07-17

Command:

```sh
node docs/reference/evidence/phase78-codex-wire-recovery-live-2026-07-17/run.mjs
```

The concise `openBaton`/bound-Run surface launched exact
`codex@codex-cli 0.144.5 / gpt-5.6-sol / medium` with unattended full host access. The objective
required one deterministic shell command with more than 1 MiB of stdout before writing its one
scoped review. Baton discarded the oversized closed telemetry notification within its internal
wire bound, kept the provider turn alive, freshly verified the result, and completed automatic
adoption.

- Run: `run-f05501ca8da51d4cb64f40f0a9e1e30f`
- terminal phase: `completed`
- launch enforcement: harness/model/effort `matched`
- provider attestation: exact model `gpt-5.6-sol` matched; harness and effort honestly unavailable
- result: verified and adopted at `299eb80747ec50384f79cc586e251815d208cb7e`
- deployment close: `{workers:0, workerIds:[], closed:true}`
- close/reopen inspection: cleanup `complete`, owned count `0`, no stale stop action

This live pass closes the real `wire_frame_oversize` friction found by the earlier paired
Codex/Kimi dogfood. Oversized responses, RPC requests, malformed/ambiguous frames, and late
top-level response IDs remain fail-closed and exactly reaped; only a closed method-first telemetry
notification can be dropped while the turn continues.
