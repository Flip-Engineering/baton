// Issue #383, child half: a worker's stdio pipes are Sockets. A write to a child that already
// exited fails ASYNCHRONOUSLY as 'error' on the stdin Socket — outside every try/catch — and
// with no listener Node raises it as an uncaught exception. That is what took the clone resident
// down at 03:38 UTC on 2026-09-18 after both http servers were guarded: the fifth EPIPE came from
// a worker's stdin. These rows pin the ONE guard every adapter attaches at spawn.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

import { guardChildPipes } from '../src/process-lifecycle.mjs';
import { OmpRpcProcess } from '../src/omp-rpc.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function exitedChild() {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: ['pipe', 'pipe', 'pipe'] });
  return new Promise((resolve) => child.once('close', () => resolve(child)));
}

test('#383 child (a): an unguarded child stdin turns EPIPE into a throw; the guard owns it, records it and tells the observer', async () => {
  const bare = await exitedChild();
  const epipe = () => Object.assign(new Error('write EPIPE'), { code: 'EPIPE', errno: -32, syscall: 'write' });
  // Red-before shape: with no listener, the socket's 'error' is thrown out of emit — on the
  // resident that throw was the uncaught exception that killed it.
  assert.throws(() => bare.stdin.emit('error', epipe()), /EPIPE/u, 'an unguarded stdin re-throws EPIPE');
  const child = await exitedChild();
  const seen = [];
  const record = guardChildPipes(child, (stream, error) => seen.push([stream, error?.code ?? null]));
  let uncaught = null;
  const onUncaught = (error) => { uncaught = error; };
  process.once('uncaughtException', onUncaught);
  try {
    assert.doesNotThrow(() => child.stdin.emit('error', epipe()), 'the guarded stdin owns the event');
    // And a real late write is a no-throw too, whatever the kernel does with it.
    assert.doesNotThrow(() => child.stdin.write('late frame\n'));
    await sleep(60);
  } finally { process.off('uncaughtException', onUncaught); }
  assert.equal(uncaught, null, 'nothing reached process');
  assert.equal(record.stdin?.code, 'EPIPE', 'the guard recorded the first stdin error');
  assert.deepEqual(seen[0], ['stdin', 'EPIPE'], 'the observer saw the stream and the code');
});

test('#383 child (b): OmpRpcProcess guards its child at start and reports the pipe error as a transport stall, never a crash', async () => {
  const stalls = [];
  const client = new OmpRpcProcess({
    command: process.execPath, args: ['-e', 'process.exit(0)'],
    onTransportStall: (row) => stalls.push(row),
  });
  client.start();
  // #586: the child exits on its own (process.exit(0)) and the emit below is only meaningful
  // once that exit has landed — a wall-clock guess at boot-plus-exit time raced it one run in
  // three. The exit event is the receipt this waits for.
  await new Promise((resolve) => client._child.once('exit', resolve));
  await sleep(20);
  let uncaught = null;
  const onUncaught = (error) => { uncaught = error; };
  process.once('uncaughtException', onUncaught);
  try {
    // The child is gone; notify() sees a destroyed stdin and answers false, but a frame that
    // slipped through before the exit landed raises on the pipe — emulate that raise directly.
    client._child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    await sleep(20);
  } finally { process.off('uncaughtException', onUncaught); }
  assert.equal(uncaught, null, 'nothing reached process');
  assert.equal(client.pipeErrors.stdin?.code, 'EPIPE', 'the client kept the pipe error');
  assert.ok(stalls.some((row) => row.phase === 'pipe_error' && row.stream === 'stdin' && row.code === 'EPIPE'),
    `the stall observer was told: ${JSON.stringify(stalls)}`);
  assert.equal(client.notify({ type: 'steer' }), false, 'a later write refuses instead of throwing');
});
