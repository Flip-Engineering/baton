# Recursive MCP review attempt — provider usage limit

Status: `PENDING-LIVE-provider-usage-limit`.

Baton launched its own `CodexAppServerCli` reviewer through exact route
`codex@codex-cli 0.144.1` / `gpt-5.6-sol` / `low`. The native thread and worker PID
were observed, so this was not a deterministic mock. The provider then returned its usage-limit
refusal before producing review content. No review verdict or integration is claimed.

The refusal path remained clean: Baton emitted `kill.confirmed`; the native PID is gone; and the
owned worktree, runtime scope, task branch, and git worktree registration are gone. Raw events and
the machine-readable failed-gate summary are beside this note.
