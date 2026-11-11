# Phase 78 integrated deployment dogfood — 2026-07-17

The first concise paired native-Kimi/Codex run was deliberately retained as failure evidence. It
admitted both exact routes concurrently and exactly reaped both, but exposed two application P0s:

- native Kimi `kimi-code/k3` at `max` reached ACP initialization/yolo/model selection, then the
  provider refused the first prompt with `Authentication required`; its local subscription token
  metadata was expired;
- Codex `gpt-5.6-sol` at `medium` stayed productive until one oversized closed tool-output
  notification exceeded the former all-frame ceiling and terminated the session.

Those findings produced bounded pre-spawn Kimi expiry readiness, sanitized actionable terminal
causes, and constant-space Codex telemetry discard with fail-closed RPC ambiguity. The subsequent
Codex evidence in `../phase78-codex-wire-recovery-live-2026-07-17/` is green. Native Kimi remains
truthfully auth-red until the ordinary `kimi` login is refreshed; no API key is requested for its
subscription route.
