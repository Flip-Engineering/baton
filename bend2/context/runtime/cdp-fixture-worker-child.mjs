// CDP lane fixture: the worker thread of cdp-fixture-worker.mjs.
import { isMainThread, parentPort, threadId } from 'node:worker_threads';

if (isMainThread) throw new Error('this fixture is a worker body');

parentPort.postMessage({ workerReady: true, threadId, pid: process.pid });
parentPort.on('message', (message) => {
  if (message?.release === true) {
    process.stdout.write(`${JSON.stringify({ worker: true, threadId, release: true })}\n`);
    process.exit(0);
  }
});
