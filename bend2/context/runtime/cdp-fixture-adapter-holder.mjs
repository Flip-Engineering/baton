// CDP lane fixture: a stand-in adapter process used by the adapter-loss case.
//
// The test starts this module as a separate process, lets it connect and run the
// startup handshake, then kills it with SIGKILL. The target is in the native
// target keeper's custody, so it must stay alive afterwards. The kept process
// prints its pid and a readiness line and writes a readiness file, so the test
// can observe that the connection was established without polling a timer.
//
// Usage: node cdp-fixture-adapter-holder.mjs <webSocketUrl> <readinessPath>

import { writeFileSync } from 'node:fs';

import { createAdapterSession } from './cdp-session.mjs';

const [webSocketUrl, readinessPath] = process.argv.slice(2);

const session = createAdapterSession({
  runtime: 'rt:adapter-loss',
  adapter: 'adapter:loss',
  incarnation: '0',
  emit: ({ bytes }) => process.stdout.write(`${JSON.stringify({ holder: 'frame', bytes })}\n`),
});

process.stdout.write(`${JSON.stringify({ holder: 'pid', pid: process.pid })}\n`);
await session.execute('launch', { effects: ['controlRuntime'], webSocketUrl });
await session.execute('resume-step', { effects: ['controlRuntime'], action: 'resume' });
process.stdout.write(`${JSON.stringify({ holder: 'ready', state: session.snapshot().state })}\n`);
if (typeof readinessPath === 'string' && readinessPath.length > 0) {
  writeFileSync(readinessPath, `${JSON.stringify({ pid: process.pid, state: session.snapshot().state })}\n`);
}

setInterval(() => {}, 1000);
