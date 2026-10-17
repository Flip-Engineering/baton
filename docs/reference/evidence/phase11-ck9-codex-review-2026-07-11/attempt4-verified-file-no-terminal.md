# Attempt 4 — file verified inside worker, but no terminal claim

The budget-aware steer succeeded: the worker used 12 tool calls, wrote the required review, and
ran the exact pinned verification command with exit code 0. It then reached 385,386 cumulative
tokens against the 350,000 ceiling before emitting `lifecycle.turn_completed`.

Baton correctly killed and reaped the worker and discarded the uncommitted worktree. The file is
not accepted or salvaged because an internal tool exit is not the trust-gate terminal contract.
The next protocol adds a second native steer immediately after Baton observes the pinned command
succeed: emit the final answer now. The ceiling is 500,000 to cover the measured post-write tail.
