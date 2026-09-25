# ROW BRIEF — row-adapter-contract: the omp harness adapter's normative contract

Deliverable: contract-omp-adapter.md — a NORMATIVE contract (no implementation).

## Ground to read first

- impl/src/adapter.mjs — the dialect set (codex-v2/claude/grok-acp/kimi-acp) and
  renderBrief; the adapter contract baton already knows how to hold.
- impl/src/claude-session.mjs — the compat adapter's session surface (the layer being
  retired for deepseek/glm seats per #228): spawn/reap, credentials, turn lifecycle,
  events emitted, process close facts.
- impl/src/runtime-isolation.mjs — per-member runtime homes (KIMI_CODE_HOME-style env pinning).
- Issue #228 (the failure catalog that motivates the swap) and #225 (death-cert fields the
  adapter must surface natively).

## The contract must specify (closed, testable)

1. Session dialect: how baton opens/steers/stops an omp member (stdio protocol, brief
   rendering, tool-call event mapping to baton's lifecycle vocabulary).
2. Native provider posture: deepseek/glm credentials and routing WITHOUT the anthropic-compat
   translation; provider status classes surfaced on terminal events (the #225 fields).
3. Process lifecycle: single-spawn semantics (no #199 double-spawn window), reap exactness,
   exit code/signal capture at close.
4. Tool surface scope: which omp tools members get (LSP, ast-grep, task fan-out?) and the
   containment boundary (worktree scope, network, approvals NEVER defaulting to yes).
5. Concurrency/backpressure: provider-true only (no synthetic seats — #221 law).
6. MCP posture: whether/how an omp member may hold its own baton MCP connection (#74
   nested-orchestration cross-ref) — the resident profile projection question.
7. Refusal codes for every failure mode, named.

## Hard bounds
Contract only; every invariant testable; no clocks; cite the motivating issue per section.
