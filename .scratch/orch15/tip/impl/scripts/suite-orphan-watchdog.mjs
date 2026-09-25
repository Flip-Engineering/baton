// Issue #40: imported (via --import) into the detached test group that run-suite.mjs spawns.
// If the parent dies without running handlers (SIGKILL-class), the group is reparented; this
// watchdog notices and the process terminates itself instead of working headless forever. Armed
// only when run-suite sets BATON_SUITE_WATCHDOG=1, so importing this module anywhere else is
// inert.
//
// Two orphan shapes exist and both are covered (SH3/SH4 pin them):
// - Orphaned after boot: the armed parent pid changes (reparenting) — the poll notices.
// - Orphaned BEFORE this module loads (the parent died while the child was still booting): the
//   boot-time ppid is already the reaper (pid 1) instead of the expected parent that
//   BATON_SUITE_WATCHDOG_PPID names, so waiting for a change would wait forever. Detected at
//   arm time. A process whose boot ppid is neither (a test-runner grandchild under the runner)
//   arms against its own live parent instead.
//
// The poll interval is latency-only (how quickly an orphan notices), never correctness; it is
// env-overridable for tests.

if (process.env.BATON_SUITE_WATCHDOG === '1') {
  const expectedParent = Number(process.env.BATON_SUITE_WATCHDOG_PPID);
  const armedParent = process.ppid;
  const debug = process.env.BATON_SUITE_WATCHDOG_DEBUG === '1';
  const terminate = () => {
    // SIGTERM lets the node test runner abort tests and reap its own children; the exit
    // handler chain then runs normally in this process.
    process.kill(process.pid, 'SIGTERM');
  };
  if (Number.isSafeInteger(expectedParent) && expectedParent > 0
    && armedParent !== expectedParent && armedParent === 1) {
    if (debug) process.stderr.write(`watchdog: orphaned before arming (expected ${expectedParent})\n`);
    terminate();
  } else {
    const pollMs = Number(process.env.BATON_SUITE_WATCHDOG_POLL_MS) > 0
      ? Number(process.env.BATON_SUITE_WATCHDOG_POLL_MS) : 500;
    const timer = setInterval(() => {
      if (debug) process.stderr.write(`watchdog poll: ppid=${process.ppid} armed=${armedParent}\n`);
      if (process.ppid !== armedParent) {
        clearInterval(timer);
        terminate();
      }
    }, pollMs);
    timer.unref();
  }
}
