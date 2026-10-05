// Worker-host fixture: spawns the worker with emptied execArgv before the
// host pause, so NodeWorker enumeration happens against a live worker.
import { Worker } from 'node:worker_threads';

const worker = new Worker(new URL('./fixture-worker.mjs', import.meta.url), { execArgv: [] });
worker.on('error', () => {});
function host() {
  const handoff = { workerId: null };
  debugger; // host pause after the worker attached; the fixture test enumerates here
  return handoff;
}
setTimeout(host, 40);
