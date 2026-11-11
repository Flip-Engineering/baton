# Attempt 1 — exact `gpt-5.6` slug rejected by ChatGPT Codex transport

Baton requested, resolved, and observed exact `gpt-5.6` at low effort, but the ChatGPT-backed Codex
transport returned HTTP 400: that slug is not supported for the account transport. Baton performed
no fallback, failed the task durably, issued automatic two-phase kill, confirmed process death, and
reaped runtime, worktree, and branch. The reproducible runner now uses the transport-specific exact
slug `gpt-5.6-sol`; acceptance still requires requested/resolved/observed identity equality.
