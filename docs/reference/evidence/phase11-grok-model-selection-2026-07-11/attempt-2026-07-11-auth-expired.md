# Current rerun attempt — provider auth expired

At `2026-07-11T19:00:00Z`, Baton retried the two-worker exact-model proof against repository head
`2643da30c2040c82fba159d08a9e46193a956e4e`. Runtime isolation correctly projected
`~/.grok/auth.json` into both private Grok homes, but the provider rejected both `session/new`
requests with `Authentication required`. A direct read-only `grok models` check independently
reported `You are not authenticated`.

No provider turns or native PIDs were established, so this attempt does not replace the earlier
passing live evidence in `events.jsonl` and `summary.json`. Both failed tasks terminalized, both
cleanup calls returned confirmed/already-dead, and every temporary worktree, metadata file, and
branch was reaped. The live rerun is `PENDING-LIVE-grok-reauth`; the zero-quota concurrent process
and kill/reap contract is covered by `impl/test/phase11-concurrent-grok-reap.test.mjs`.
