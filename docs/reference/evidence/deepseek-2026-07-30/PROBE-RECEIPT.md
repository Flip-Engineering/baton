# W1.4 probe receipt — DeepSeek baton-route live confirmation (2026-07-31)

- **doctor:** `deepseek-v4-flash@low` reported `ready` ("The exact route passed static
  deployment readiness") with `deepseek_key.json` present at the repo root.
- **bounded live run** (`probe-flash.mjs`, isolated deployment root
  `.baton/deepseek-probe-2026-07-31`): real provider inference (`resource.provider_call`),
  turn completed, `worktree.progress_checkpointed` pin
  `aabf9faba60bdb1bf1d780fa7b40d2636ae087a3` authored by
  `baton-worker-deepseek:deepseek <baton-worker-deepseek:deepseek@localhost>`.
- **pin content proof:** `git show aabf9fab:deepseek-probe/hello.md` →
  `deepseek-flash probe ok` (exactly the instructed one line, in-scope write).
- probe script stopped the run after the first parked turn (no steering loop in the probe);
  finalization under steering is the W1.5 seat's job (`seat-flash.mjs`).
- side observation: the checkpoint pin also swept main-checkout stray untracked files — the
  known isolation-escape signature of issue #52; affects live workers, not deepseek-specific.
