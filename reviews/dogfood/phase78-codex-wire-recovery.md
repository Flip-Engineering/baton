# Phase 78 Codex wire-recovery assessment

**Assessment: usable.** Under deployment profile `default@d85f2959507c8c1cad6ce62a8d83fdc486f5d639587884656c610e429a9629c1`, Baton Run's command action executed `node -e "process.stdout.write('A'.repeat(1048577))"`, deterministically producing 1,048,577 stdout bytes. The route returned exit code 0 and chunk `20108a`; it bounded the displayed result with a truncation warning while reporting `original_token_count: 262144`.

Recovery preserved cleanup truth: the result had `session_id: null`, so no live command session remained to reap. A subsequent Baton Run command completed normally, demonstrating that the Codex session remained usable after the oversized wire result.
