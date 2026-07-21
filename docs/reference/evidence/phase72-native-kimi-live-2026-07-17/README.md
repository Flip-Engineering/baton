# Phase 72 native Kimi Code live proof — 2026-07-17

This proof used Baton's ordinary objective-first application surface against a clean private clone
of snapshot `f228430e5abaaf924894dcfe12c917e388331972`.

- selected route: harness `kimi-code`, model `kimi-code/k3`, effort `max`;
- adapter permission mode: ACP `yolo`, set and observed before prompt;
- provider effect: candidate `4fe8712bce98dbeea1c8f39c8dec1459f022bdda` added exactly
  `impl/test/fixtures/native-kimi-live-proof.txt` with the requested single line;
- trust gate: the pinned 249-test candidate/base application suite passed;
- required effect: one in-scope `repository_edit` was observed before result acceptance;
- result: adopted, receipt `665ba9d491768cbbd4929f442230ca839cb90afc128621ee48f50fb216527268`;
- delivery: exact directory-v1 export completed with tree-exact and manifest-verified checks,
  receipt `114c3cc81ab1d546487cf271142a0f1dee91e2518bc537b02c52b5857f00d338`;
- checkout effects: not changed, integrated, deployed, or published;
- lifecycle: one process observed and closed, `lifecycle.process_closed` preceded
  `kill.confirmed`, remaining worker count zero, coordinator closed, writer released;
- cleanup: only the disposable clone's main worktree remained; Baton runtime and worker-worktree
  roots contained no files; the outer disposable clone was then removed; and
- event efficiency: the successful worker log contained 28 events after bounded ACP stream
  coalescing, compared with 10,980 events in the earlier stalled pre-coalescing run.

The successful run predated the runner's pre/post digest field for the four approved global Kimi
source files. Deterministic private-projection/nonmutation tests were green, and the runner now
fails a native-Kimi live gate unless content, mode, and owner digests of those exact source files
remain unchanged. A later live receipt must close that final direct-observation item.
