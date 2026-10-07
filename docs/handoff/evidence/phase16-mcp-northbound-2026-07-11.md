# Phase 16 MCP northbound evidence — 2026-07-11

## Deterministic gate

- Contract: `spec/phase16/mcp-northbound.md` (MN1–MN10).
- Focused command: `npm test -- --test test/phase16-mcp-northbound.test.mjs` from `impl/`.
- Focused result: 14/14 passing.
- Canonical command: `npm test` from `impl/`.
- Full result: 692/692 passing; the canonical suite owner removed its `baton-suite-*` root.

The tests cover the stable MCP 2025-11-25 handshake, deterministic closed eight-tool
inventory, newline-delimited stdio, split oversize-frame discard, JSON-RPC versus tool
errors, fixed injected identity, repo/capability/quota checks, credential-field refusal,
fences, bounded wait, object-shaped structured content plus text fallback, and exact
`CodexAppServerCli` / `gpt-5.6-sol` / `low` route propagation.

The hardening pass additionally proves fatal invalid-UTF-8 refusal, stdout write-error
propagation, initialization readiness/duplicate refusal, async deployment quota support,
closed nested model/session schemas, and a deployment-derived message-size ceiling.
The packaged `baton-mcp` subprocess itself is exercised over stdin/stdout, and state-command
exceptions distinguish typed stale-fence/precondition results from `command_outcome_unknown`.

## Durable effect gate

State-changing MCP calls are admitted into the append-only coordination stream before
dispatch. The raw idempotency key is not stored. Tests prove terminal replay after a
store restart, same-key/different-arguments conflict, admitted retry refusal, and the
post-effect completion-write failure window: the first call cannot report success and a
retry cannot repeat the effect.

## Runnable boundary

`impl/scripts/mcp-stdio.mjs` is the actual MCP subprocess entry point and
`impl/MCP.md` documents its deployment-owned configuration factory. The factory injects
the principal, repository scope, quota authority, real coordinator, adapter credentials,
and trust policy; tool arguments cannot acquire those authorities.

## Honest remaining boundary

This is stdio, not Streamable HTTP. MCP Tasks, progress heartbeats, resumable HTTP
streams, host allowlist installation, liveness canaries, and daemon startup recovery
remain planned. The recursive exact-route Baton review reached native
`gpt-5.6-sol` and was then refused by the provider usage limit before content. It fully
reaped its PID/worktree/runtime/branch, but no independent verdict is claimed; see
`docs/reference/evidence/phase16-mcp-review-2026-07-11/attempt-usage-limit-2026-07-11.md`.
