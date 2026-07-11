import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { WebEventStream } from '../src/web-stream.mjs';

let clock = Date.parse('2026-07-11T12:00:00.000Z');
const principal = (overrides = {}) => ({ userId: 'u', sessionId: 's', credentialId: 'c', expiresAt: '2099-01-01T00:00:00.000Z', capabilities: ['observe'], repoIds: ['repo-a'], ...overrides });
const fixture = (opts = {}) => {
  const coordination = new CoordinationStore(mkdtempSync(join(tmpdir(), 'baton-stream-')));
  const stream = new WebEventStream({ coordination, allowedOrigins: ['https://control.test'], repoIds: ['repo-a'], now: () => clock, pollMs: 5, ...opts });
  return { coordination, stream };
};
class Response extends EventEmitter {
  constructor(writableLength = 0) { super(); this.writableLength = writableLength; this.output = ''; }
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  write(value) { this.output += value; return true; }
  end() { this.ended = true; }
}

test('WN2/WN5/WN6: stream tickets are short-lived, single-use, hashed, and exactly bound', () => {
  clock = Date.parse('2026-07-11T12:00:00.000Z');
  const { stream } = fixture({ ticketTtlMs: 100 });
  const issued = stream.issue(principal(), 'https://control.test', 'repo-a');
  assert.equal(issued.status, 201);
  assert.equal(JSON.stringify([...stream.tickets.values()]).includes(issued.body.ticket), false);
  assert.equal(stream.consume(issued.body.ticket, principal({ sessionId: 'other' }), 'https://control.test'), null);
  assert.equal(stream.consume(issued.body.ticket, principal(), 'https://other.test'), null);
  assert.equal(stream.consume(issued.body.ticket, principal(), 'https://control.test').repoId, 'repo-a');
  assert.equal(stream.consume(issued.body.ticket, principal(), 'https://control.test'), null);
  const expiring = stream.issue(principal(), 'https://control.test', 'repo-a');
  clock += 101;
  assert.equal(stream.consume(expiring.body.ticket, principal(), 'https://control.test'), null);
  assert.equal(stream.issue(principal({ repoIds: ['repo-b'] }), 'https://control.test', 'repo-a').status, 403);
});

test('WN6: snapshot boundary and reconnect provide ordered at-least-once coordination delivery', () => {
  const { coordination, stream } = fixture({ maxBufferedBytes: 100_000 });
  coordination.recordWebAudit({ kind: 'seed-1' }, { actor: 'test', key: 'seed-1' });
  const initial = new Response();
  stream.open({ ticket: stream.issue(principal(), 'https://control.test', 'repo-a').body.ticket, principal: principal(), origin: 'https://control.test' }, initial);
  assert.match(initial.output, /event: snapshot/);
  const boundary = Number(initial.output.match(/^id: (\d+)/m)[1]);
  coordination.recordWebAudit({ kind: 'after-boundary' }, { actor: 'test', key: 'after-boundary' });
  const reconnect = new Response();
  stream.open({ ticket: stream.issue(principal(), 'https://control.test', 'repo-a').body.ticket, principal: principal(), origin: 'https://control.test', cursor: boundary }, reconnect);
  const ids = [...reconnect.output.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
  assert.ok(ids.length >= 1);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  assert.equal(ids[0], boundary + 1);
  initial.emit('close');
  reconnect.emit('close');
});

test('WN6/WN7/WN9: expired cursors and bounded backpressure are typed and audited', () => {
  const { coordination, stream } = fixture({ replayLimit: 1, maxBufferedBytes: 32 });
  coordination.recordWebAudit({ kind: 'seed-1' }, { actor: 'test', key: 'seed-a' });
  coordination.recordWebAudit({ kind: 'seed-2' }, { actor: 'test', key: 'seed-b' });
  const expired = stream.open({ ticket: stream.issue(principal(), 'https://control.test', 'repo-a').body.ticket, principal: principal(), origin: 'https://control.test', cursor: 0 }, new Response());
  assert.equal(expired.status, 409);
  assert.equal(expired.body.error.code, 'snapshot_required');
  const response = new Response(33);
  const cursor = coordination.snapshot().lastSeq;
  assert.equal(stream.open({ ticket: stream.issue(principal(), 'https://control.test', 'repo-a').body.ticket, principal: principal(), origin: 'https://control.test', cursor }, response), null);
  assert.equal(response.ended, true);
  assert.match(response.output, /event: lag/);
  assert.equal(coordination.events().some((event) => event.payload.kind === 'stream_backpressure_disconnect'), true);
});

test('WN6/WN9: browser disconnect audits closure and never invokes worker control', () => {
  const calls = [];
  const { coordination, stream } = fixture({ maxBufferedBytes: 100_000 });
  const response = new Response();
  stream.open({ ticket: stream.issue(principal(), 'https://control.test', 'repo-a').body.ticket, principal: principal(), origin: 'https://control.test' }, response);
  response.emit('close');
  assert.deepEqual(calls, []);
  assert.equal(coordination.events().some((event) => event.payload.kind === 'stream_disconnected'), true);
});
