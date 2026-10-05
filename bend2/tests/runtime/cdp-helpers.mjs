// Shared harness for the runtime-values CDP fixtures: the WebSocket client,
// the debuggee launcher with spawn-error and stdio-close observation, the
// startup handshake, and the retained-evidence writer. The launcher observes
// spawn errors and waits for stdio close so the retained stdout and stderr
// are the complete byte streams, not whatever flushed before exit.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const EVIDENCE_DIR =
  process.env.BATON_RUNTIME_EVIDENCE_DIR ?? mkdtempSync(join(tmpdir(), 'runtime-values-evidence-'));
mkdirSync(EVIDENCE_DIR, { recursive: true });

let evidenceIndex = 0;
export function retain(name, record) {
  evidenceIndex += 1;
  const path = join(EVIDENCE_DIR, `${String(evidenceIndex).padStart(3, '0')}-${name}.json`);
  writeFileSync(path, JSON.stringify(record, null, 2));
  return path;
}

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export class Cdp {
  constructor(url) {
    this.url = url;
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.events = [];
    this.responses = [];
    this.scripts = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', () => reject(new Error('inspector websocket failed')), { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.pending.delete(msg.id);
        if (msg.error) entry.reject(Object.assign(new Error(`cdp error ${msg.error.code}: ${msg.error.message}`), { cdpCode: msg.error.code }));
        else entry.resolve(msg.result ?? {});
        return;
      }
      this.events.push(msg);
      if (msg.method === 'Debugger.scriptParsed') this.scripts.set(msg.params.scriptId, msg.params);
      for (const handler of this.handlers.get(msg.method) ?? []) handler(msg);
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    const request = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
    return request.then((result) => {
      this.responses.push({ method, params, result });
      return result;
    });
  }

  on(method, handler) {
    const list = this.handlers.get(method) ?? [];
    list.push(handler);
    this.handlers.set(method, list);
  }

  waitEvent(method, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${method}`)), timeoutMs);
      this.on(method, (msg) => {
        clearTimeout(timer);
        resolve({ params: msg.params, seq: this.events.length - 1 });
      });
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // the fixture records the close outcome separately when it matters
    }
  }
}

// Declared environment only; nothing is inherited (recorded
// net-debuggee-env-inherited fact). The endpoint comes from the child's
// stderr banner; /json/list is never consulted. The returned exit promise
// resolves with the observed exit plus any spawn error, and `closed` resolves
// after stdio closes so the captured streams are complete.
export function launchDebuggee(script, extraArgs = []) {
  let child;
  try {
    child = spawn(process.execPath, ['--inspect-brk=127.0.0.1:0', ...extraArgs, script], {
      env: { PATH: '/usr/bin:/bin', HOME: tmpdir() },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    return {
      child: null,
      endpoint: Promise.reject(Object.assign(new Error(`debuggee spawn failed: ${err.message}`), { spawnError: err })),
      exit: Promise.resolve({ code: null, signal: null, spawnError: String(err.message ?? err) }),
      closed: Promise.resolve(),
      stdoutText: () => '',
      stderrText: () => '',
    };
  }
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  let spawnError = null;
  child.on('error', (err) => {
    spawnError = err;
  });
  const endpoint = new Promise((resolve, reject) => {
    if (spawnError) {
      reject(Object.assign(new Error(`debuggee spawn failed: ${spawnError.message}`), { spawnError }));
      return;
    }
    let acc = '';
    const timer = setTimeout(() => reject(new Error(`no inspector banner; stderr so far: ${acc}`)), 15000);
    const onError = (err) => {
      clearTimeout(timer);
      child.stderr.removeListener('data', handler);
      reject(Object.assign(new Error(`debuggee spawn failed: ${err.message}`), { spawnError: err }));
    };
    const handler = (chunk) => {
      acc += chunk.toString('utf8');
      const match = /Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]+)/.exec(acc);
      if (match) {
        clearTimeout(timer);
        child.removeListener('error', onError);
        child.stderr.removeListener('data', handler);
        resolve(match[1]);
      }
    };
    child.stderr.on('data', handler);
    child.on('error', onError);
  });
  const exit = new Promise((resolve) =>
    child.on('exit', (code, signal) => resolve({ code, signal, spawnError: spawnError ? String(spawnError.message ?? spawnError) : null })),
  );
  const closed = new Promise((resolve) => child.on('close', () => resolve()));
  return {
    child,
    endpoint,
    exit,
    closed,
    stdoutText: () => Buffer.concat(stdout).toString('utf8'),
    stderrText: () => Buffer.concat(stderr).toString('utf8'),
  };
}

// Startup composition: enables plus async capture BEFORE any chain forms,
// then the start release. The initial brk stop and a later real paused event
// are distinct states; this returns the initial stop.
export async function handshake(client) {
  await client.send('Runtime.enable');
  await client.send('Debugger.enable');
  await client.send('Debugger.setAsyncCallStackDepth', { maxDepth: 32 });
  const paused = client.waitEvent('Debugger.paused');
  client.send('Runtime.runIfWaitingForDebugger');
  return paused;
}

// Waits for the debuggee to end and returns the retained closure record:
// observed exit, any spawn error, and the complete stdout and stderr text.
export async function finish(run) {
  const exit = await run.exit;
  await run.closed;
  return {
    exit,
    stdout: run.stdoutText(),
    stderr: run.stderrText(),
  };
}
