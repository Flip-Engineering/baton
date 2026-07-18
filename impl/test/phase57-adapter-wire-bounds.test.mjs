import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { ClaudeSessionCli } from '../src/claude-session.mjs';
import { CodexAppServerCli } from '../src/codex-appserver.mjs';
import { GrokAcpCli } from '../src/grok-acp.mjs';

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.destroyed = false;
  child.stdin.writableEnded = false;
  child.killCount = 0;
  child.kill = () => { child.killCount += 1; };
  return child;
}

const expectedFailure = {
  error: 'provider wire frame exceeded configured byte ceiling',
  code: 'wire_frame_oversize',
  phase: 'wire',
  usageSeal: { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null },
};

test('Claude session NDJSON buffer is bounded, cleared, killed, and never retains or echoes the provider frame', () => {
  const cli = new ClaudeSessionCli({ maxWireFrameBytes: 32 });
  const child = fakeChild();
  const session = { worker: 'w', child, pid: 99999999, terminal: false, processFailure: null, buf: '', turnEpoch: 1 };
  cli._onData(session, `{"secret":"${'c'.repeat(64)}"}\n`);
  assert.equal(session.buf, '');
  assert.deepEqual(session.processFailure, expectedFailure);
  assert.equal(child.killCount, 1);
  assert.doesNotMatch(JSON.stringify(session.processFailure), /cccccccc/);
});

test('Codex app-server NDJSON buffer is bounded, cleared, killed, and records only the fixed failure', () => {
  const cli = new CodexAppServerCli({ requestTimeoutMs: 100, maxWireFrameBytes: 32, versionProbe: () => 'test' });
  const child = fakeChild();
  const session = { worker: 'w', child, terminal: false, processFailure: null, buf: '' };
  cli._attachChild(session);
  child.stdout.emit('data', `{"secret":"${'o'.repeat(64)}"}\n`);
  assert.equal(session.buf, '');
  assert.deepEqual(session.processFailure, {
    ...expectedFailure,
    remediation: 'The frame could affect RPC correlation, so Baton terminated and reaped this Codex session. Retry with an updated Codex app-server.',
  });
  assert.equal(child.killCount, 1);
  assert.doesNotMatch(JSON.stringify(session.processFailure), /oooooooo/);
});

test('Grok ACP NDJSON buffer is bounded, cleared, killed, and records only the fixed failure', () => {
  const cli = new GrokAcpCli({ requestTimeoutMs: 100, maxWireFrameBytes: 32, versionProbe: () => 'test' });
  const child = fakeChild();
  const session = { worker: 'w', child, closed: false, processFailure: null, buf: '' };
  cli._attachChild(session);
  child.stdout.emit('data', `{"secret":"${'g'.repeat(64)}"}\n`);
  assert.equal(session.buf, '');
  assert.deepEqual(session.processFailure, expectedFailure);
  assert.equal(child.killCount, 1);
  assert.doesNotMatch(JSON.stringify(session.processFailure), /gggggggg/);
});
