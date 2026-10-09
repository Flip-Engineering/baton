// CDP lane fixture: a long-running Node target.
//
// Used by the pending-evaluation and adapter-loss cases. It prints one heartbeat
// line every 50ms and keeps running until the keeper signals it. Under
// --inspect-brk no user code runs before the adapter's startup handshake, so a
// blocking evaluation issued at the initial stop prevents this body from running
// at all: that is what makes the evaluation stay unanswered.
//
// Each heartbeat names the process id and the complete environment the target
// received, so a test can prove same-child continuity across the bootstrap and
// the exact declared environment.

const started = Date.now();
const envKeys = Object.keys(process.env).sort();

setInterval(() => {
  process.stdout.write(`${JSON.stringify({
    heartbeat: true,
    pid: process.pid,
    elapsed: Date.now() - started,
    envKeys,
    marker: process.env.BATON_CDP_FIXTURE_MARKER ?? null,
  })}\n`);
}, 50);

process.on('SIGTERM', () => {
  process.stdout.write(`${JSON.stringify({ signal: 'SIGTERM', pid: process.pid })}\n`);
  process.exit(0);
});

