// Fixture: inspector endpoint, external-client boundary, pause/custody and
// pending evaluation, against the exact floor executable.
//
//   A endpoint published on stderr, loopback bound
//   B /json/list publishes the UUID to an unauthenticated loopback client
//   C a client holding only the UUID executes Runtime.evaluate
//   D Debugger.resume is refused in the --inspect-brk pre-release wait state
//   E client socket close while paused ends the subject (no release command)
//   F a target-blocking evaluation never responds, and an external signal still
//     ends the subject
import { spawn } from 'node:child_process';
import { EnvironmentRefusal, openEnvironmentOrExit } from '../lib/env.mjs';
import { createReport, finish, refuseEnvironment } from '../lib/assert.mjs';
import { historicalExpectation } from '../lib/pins.mjs';
import { loopbackGet, parseBanner, waitFor } from '../lib/net.mjs';

let environment;
try {
  environment = openEnvironmentOrExit();
  if (environment.historicalPin !== null) historicalExpectation(environment, 'inspector-boundary');
} catch (error) {
  if (error instanceof EnvironmentRefusal) refuseEnvironment(error);
  throw error;
}

const reporter = createReport('inspector-boundary', environment);
const children = [];

function launch(tag) {
  const child = spawn(
    '/usr/bin/env',
    ['-i', 'PATH=/usr/bin:/bin', 'HOME=/tmp/baton-fixture-home', 'TMPDIR=/tmp', 'LC_ALL=C',
      environment.floorNode, '--inspect-brk=127.0.0.1:0', environment.helperPath('subject.mjs')],
    { cwd: environment.evidenceDir, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const state = { tag, child, pid: child.pid, stdout: '', stderr: '' };
  child.stdout.on('data', (chunk) => (state.stdout += chunk));
  child.stderr.on('data', (chunk) => (state.stderr += chunk));
  state.exited = new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal, at: Date.now() }));
  });
  children.push(state);
  return state;
}

function connect(url) {
  const socket = new WebSocket(url);
  const frames = [];
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener('message', (event) => {
    let frame = null;
    try {
      frame = JSON.parse(String(event.data));
    } catch {
      frames.push({ raw: String(event.data) });
      return;
    }
    frames.push(frame);
    if (frame.id !== undefined && pending.has(frame.id)) {
      pending.get(frame.id)(frame);
      pending.delete(frame.id);
    }
  });
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('websocket error')), { once: true });
  });
  const closed = new Promise((resolve) => {
    socket.addEventListener('close', (event) => resolve({ code: event.code, reason: event.reason }), { once: true });
  });
  return {
    socket,
    frames,
    opened,
    closed,
    send(method, params = {}, timeoutMs = 2500) {
      const id = nextId++;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ id, method, timedOut: true });
        }, timeoutMs);
        pending.set(id, (frame) => {
          clearTimeout(timer);
          resolve(frame);
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

try {
  // A and B.
  const first = launch('paused-subject');
  const found = await waitFor(() => parseBanner(first.stderr), 20000);
  const banner = found.value;
  reporter.check('A:banner-present', banner !== null, first.stderr.split('\n').slice(-2).join(' | '));
  let listBody = null;
  if (banner !== null) {
    const list = await loopbackGet(banner.port, '/json/list');
    listBody = list.body ?? null;
    reporter.check('B:list-publishes-uuid', typeof listBody === 'string' && listBody.includes(banner.uuid), null);
  } else {
    reporter.check('B:list-publishes-uuid', false, 'no banner');
  }

  // C and D.
  if (banner !== null) {
    const client = connect(banner.url);
    await client.opened;
    const resume = await client.send('Debugger.resume');
    reporter.check('D:resume-refused-in-wait-state', resume?.error?.code === -32000, resume?.error ?? null);
    await client.send('Runtime.enable');
    await client.send('Debugger.enable');
    const evaluate = await client.send('Runtime.evaluate', { expression: '6*7' });
    reporter.check('C:unauthenticated-evaluate', evaluate?.result?.result?.value === 42, evaluate?.result ?? null);

    // E.
    await client.send('Runtime.runIfWaitingForDebugger');
    await client.send('Debugger.pause');
    await waitFor(() => client.frames.some((frame) => frame.method === 'Debugger.paused'), 5000);
    client.socket.close();
    await client.closed;
    const afterClose = await Promise.race([
      first.exited.then((value) => ({ exited: true, value })),
      new Promise((resolve) => setTimeout(() => resolve({ exited: false }), 5000)),
    ]);
    reporter.check('E:client-close-ends-subject', afterClose.exited === true, afterClose);
  } else {
    reporter.check('C:unauthenticated-evaluate', false, 'no banner');
    reporter.check('D:resume-refused-in-wait-state', false, 'no banner');
    reporter.check('E:client-close-ends-subject', false, 'no banner');
  }

  // F.
  const second = launch('blocked-evaluation-subject');
  const foundSecond = await waitFor(() => parseBanner(second.stderr), 20000);
  const bannerSecond = foundSecond.value;
  if (bannerSecond !== null) {
    const client = connect(bannerSecond.url);
    await client.opened;
    await client.send('Runtime.enable');
    await client.send('Debugger.enable');
    await client.send('Runtime.runIfWaitingForDebugger');
    const blocked = client.send('Runtime.evaluate',
      { expression: 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)' }, 6000);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const following = client.send('Runtime.evaluate', { expression: '1+1' }, 3000);
    const [blockedResult, followingResult] = await Promise.all([blocked, following]);
    reporter.check('F:blocked-evaluation-no-response', blockedResult.timedOut === true, blockedResult);
    reporter.check('F:following-request-no-response', followingResult.timedOut === true, followingResult);
    const beforeKill = Date.now();
    second.child.kill('SIGTERM');
    const killed = await Promise.race([
      second.exited.then((value) => value),
      new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);
    reporter.check('F:external-signal-ends-subject', killed !== null, killed);
    reporter.note(JSON.stringify({ killLatencyMs: killed === null ? null : killed.at - beforeKill }));
  } else {
    reporter.check('F:blocked-evaluation-no-response', false, 'no banner');
    reporter.check('F:following-request-no-response', false, 'no banner');
    reporter.check('F:external-signal-ends-subject', false, 'no banner');
  }
} finally {
  for (const state of children) {
    try {
      state.child.kill('SIGKILL');
    } catch {
      // already gone
    }
  }
  await Promise.all(children.map((state) => state.exited.catch(() => null)));
}

finish(environment, 'inspector-boundary.result.json', reporter.finalize());
