// CDP lane fixture: a target that starts one worker thread.
//
// The worker is created with `execArgv: []`, so it does not inherit the
// parent's --inspect-brk flags and is not silently paused at start. The worker
// prints its own thread identity and the parent waits for it, so a test can
// observe NodeWorker.attachedToWorker and the recorded worker thread identity.

import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const worker = new Worker(new URL('./cdp-fixture-worker-child.mjs', import.meta.url), { execArgv: ['--inspect=127.0.0.1:0'] });

worker.on('message', (message) => {
  process.stdout.write(`${JSON.stringify({ parent: true, fromWorker: message })}\n`);
  if (message.workerReady) worker.postMessage({ release: true });
});
worker.on('exit', (code) => {
  process.stdout.write(`${JSON.stringify({ parent: true, workerExit: code })}\n`);
});

process.on('SIGTERM', () => {
  process.stdout.write(`${JSON.stringify({ signal: 'SIGTERM', pid: process.pid })}\n`);
  process.exit(0);
});

setTimeout(() => {}, 24 * 60 * 60 * 1000);
