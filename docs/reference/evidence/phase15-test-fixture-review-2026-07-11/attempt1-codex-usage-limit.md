# Attempt 1 — exact-route Codex usage-limit refusal

Baton created an isolated review worktree and runtime scope, launched `CodexAppServerCli` through
`codex-cli 0.144.1`, and observed the requested `gpt-5.6-sol` model with `low` effort resolved. The
provider then returned its account usage limit before producing any review content.

This attempt is not a review verdict. Baton recorded the typed crash, confirmed kill, and proved
the PID, worktree, runtime scope, metadata, task branch, and runner log root were gone. The
provider-backed TF1–TF4 review remains pending until the stated quota reset; Grok fallback remains
pending provider reauthentication.
