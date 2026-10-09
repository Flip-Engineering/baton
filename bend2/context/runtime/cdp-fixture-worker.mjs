// CDP lane fixture: a target that starts one worker thread.
//
// The worker starts with its own inspector endpoint and sends its thread identity.
// Its message listener keeps it attached until the fixture's runtime release.

import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const worker = new Worker(new URL('./cdp-fixture-worker-child.mjs', import.meta.url), { execArgv: ['--inspect=127.0.0.1:0'] });

worker.on('message', (message) => {
  process.stdout.write(`${JSON.stringify({ parent: true, fromWorker: message })}\n`);
});
worker.on('exit', (code) => {
  process.stdout.write(`${JSON.stringify({ parent: true, workerExit: code })}\n`);
});

process.on('SIGTERM', () => {
  process.stdout.write(`${JSON.stringify({ signal: 'SIGTERM', pid: process.pid })}\n`);
  process.exit(0);
});

