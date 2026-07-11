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
  constructor(writableLength = 0, writeResult = true) { super(); this.writableLength = writableLength; this.writeResult = writeResult; this.output = ''; }
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  write(value) { this.output += value; return this.writeResult; }
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

test('WN6: audit ordering fails closed before live ticket state or SSE headers', () => {
  const { coordination } = fixture();
  const original = coordination.recordWebAudit.bind(coordination);
  coordination.recordWebAudit = (fields, auth) => {
    if (fields.kind === 'stream_ticket_issued') throw new Error('disk unavailable');
    return original(fields, auth);
  };
  const stream = new WebEventStream({ coordination, allowedOrigins: ['https://control.test'], repoIds: ['repo-a'], now: () => clock });
  assert.equal(stream.issue(principal(), 'https://control.test', 'repo-a').status, 503);
  assert.equal(stream.tickets.size, 0);
  coordination.recordWebAudit = original;
  const issued = stream.issue(principal(), 'https://control.test', 'repo-a');
  coordination.recordWebAudit = (fields, auth) => {
    if (fields.kind === 'stream_connected') throw new Error('disk unavailable');
    return original(fields, auth);
  };
  const res = new Response();
  assert.equal(stream.open({ ticket: issued.body.ticket, principal: principal(), origin: 'https://control.test' }, res).status, 503);
  assert.equal(res.status, undefined);
  assert.equal(res.output, '');
});

test('WN6: pruning and ticket/connection ceilings are enforced', () => {
  clock = Date.parse('2026-07-11T12:00:00.000Z');
  const { stream } = fixture({ ticketTtlMs: 10, maxTickets: 1, maxConnections: 1, maxFrameBytes: 100_000 });
  assert.equal(stream.issue(principal(), 'https://control.test', 'repo-a').status, 201);
  assert.equal(stream.issue(principal(), 'https://control.test', 'repo-a').status, 429);
  clock += 11;
  const first = stream.issue(principal(), 'https://control.test', 'repo-a');
  assert.equal(stream.tickets.size, 1);
  const open = new Response();
  assert.equal(stream.open({ ticket: first.body.ticket, principal: principal(), origin: 'https://control.test' }, open), null);
  const second = stream.issue(principal(), 'https://control.test', 'repo-a');
  assert.equal(stream.open({ ticket: second.body.ticket, principal: principal(), origin: 'https://control.test' }, new Response()).status, 429);
  open.emit('close');
  assert.equal(stream.activeConnections, 0);
});

test('WN6: one authority and bounded snapshot/control frames with split trust', () => {
  assert.throws(() => fixture({ repoIds: ['repo-a', 'repo-b'] }), /exactly one repository/);
  const { coordination, stream } = fixture({ maxFrameBytes: 200, maxControlFrameBytes: 512, maxBufferedBytes: 1 });
  coordination.recordWebAudit({ kind: 'seed', prose: 'x'.repeat(500) }, { actor: 'test', key: 'large-seed' });
  const bounded = new Response();
  const refusal = stream.open({ ticket: stream.issue(principal(), 'https://control.test', 'repo-a').body.ticket, principal: principal(), origin: 'https://control.test' }, bounded);
  assert.equal(refusal.status, 503);
  assert.equal(refusal.body.error.code, 'temporarily_unavailable');
  assert.equal(bounded.status, undefined);
  assert.equal(bounded.output, '');
  const cursor = coordination.snapshot().lastSeq;
  const lagged = new Response(2);
  stream.open({ ticket: stream.issue(principal(), 'https://control.test', 'repo-a').body.ticket, principal: principal(), origin: 'https://control.test', cursor }, lagged);
  assert.ok(Buffer.byteLength(lagged.output) <= 512);
  const trusted = fixture({ maxFrameBytes: 100_000, maxBufferedBytes: 100_000 });
  const output = new Response();
  trusted.stream.open({ ticket: trusted.stream.issue(principal(), 'https://control.test', 'repo-a').body.ticket, principal: principal(), origin: 'https://control.test' }, output);
  assert.match(output.output, /"occurrenceTrust":"authoritative"/);
  assert.match(output.output, /"contentTrust":"mixed"/);
  output.emit('close');
});

test('WN6: invalid ceilings fail closed and response setup failures release connection authority', () => {
  for (const invalid of [
    { maxBufferedBytes: 0 }, { maxFrameBytes: Infinity }, { maxControlFrameBytes: -1 },
    { maxTickets: 0 }, { maxConnections: 0 }, { maxEventsPerPump: 0 },
    { ticketTtlMs: 1.5 }, { replayLimit: -1 }, { pollMs: 0 },
  ]) assert.throws(() => fixture(invalid), /safe integer/);

  const { coordination, stream } = fixture({ maxFrameBytes: 100_000, maxBufferedBytes: 100_000 });
  const issued = stream.issue(principal(), 'https://control.test', 'repo-a');
  class BrokenHeaders extends Response { writeHead() { throw new Error('socket failed'); } }
  const refused = stream.open({ ticket: issued.body.ticket, principal: principal(), origin: 'https://control.test' }, new BrokenHeaders());
  assert.equal(refused.status, 503);
  assert.equal(stream.activeConnections, 0);
  assert.equal(coordination.events().some((event) => event.payload.kind === 'stream_setup_failed'), true);
});

test('WN6: write backpressure stops immediately and claimed content never inherits authoritative trust', () => {
  const first = fixture({ maxFrameBytes: 100_000, maxBufferedBytes: 100_000 });
  const blocked = new Response(0, false);
  first.stream.open({ ticket: first.stream.issue(principal(), 'https://control.test', 'repo-a').body.ticket, principal: principal(), origin: 'https://control.test' }, blocked);
  assert.equal(blocked.ended, true);
  assert.equal(first.stream.activeConnections, 0);
  assert.match(blocked.output, /event: lag/);

  const second = fixture({ maxFrameBytes: 100_000, maxBufferedBytes: 100_000 });
  const claim = second.coordination.claimScratch({
    resource: 'path:src/**', ownerWorker: 'w-claim', ownerTask: 't-claim', intent: 'edit',
    envRef: { repoId: 'repo-a', treeSha: 'cafe1234' }, fence: 1, leaseDeadline: 'later',
  }, { actor: 'w-claim', key: 'claim-for-stream' });
  const output = new Response();
  second.stream.open({
    ticket: second.stream.issue(principal(), 'https://control.test', 'repo-a').body.ticket,
    principal: principal(), origin: 'https://control.test', cursor: claim.event.seq - 1,
  }, output);
  assert.match(output.output, /"kind":"scratch.claimed"/);
  assert.match(output.output, /"contentTrust":"claimed"/);
  output.emit('close');
});

test('WN2/WN6: an established stream stops at credential expiry before reading later events', async () => {
  clock = Date.parse('2026-07-11T12:00:00.000Z');
  const { coordination, stream } = fixture({ maxFrameBytes: 100_000, maxBufferedBytes: 100_000, pollMs: 5 });
  const expiring = principal({ expiresAt: new Date(clock + 10).toISOString() });
  const output = new Response();
  stream.open({ ticket: stream.issue(expiring, 'https://control.test', 'repo-a').body.ticket, principal: expiring, origin: 'https://control.test' }, output);
  const beforeExpiry = output.output;
  clock += 11;
  coordination.recordWebAudit({ kind: 'after-expiry-secret' }, { actor: 'test', key: 'after-expiry-secret' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(output.ended, true);
  assert.equal(stream.activeConnections, 0);
  assert.equal(output.output.includes('after-expiry-secret'), false);
  assert.ok(output.output.length >= beforeExpiry.length);
  assert.equal(coordination.events().some((event) => event.payload.kind === 'stream_authorization_lost'), true);
});

test('WN6/WN7: snapshot acquisition failure is typed and audited before SSE setup', () => {
  const { coordination, stream } = fixture({ maxFrameBytes: 100_000, maxBufferedBytes: 100_000 });
  const ticket = stream.issue(principal(), 'https://control.test', 'repo-a');
  coordination.snapshot = () => { throw new Error('coordination unavailable'); };
  const output = new Response();
  const refused = stream.open({ ticket: ticket.body.ticket, principal: principal(), origin: 'https://control.test' }, output);
  assert.equal(refused.status, 503);
  assert.equal(refused.body.error.code, 'temporarily_unavailable');
  assert.equal(output.status, undefined);
  assert.equal(output.output, '');
  assert.equal(stream.activeConnections, 0);
  assert.equal(coordination.events().some((event) => event.payload.kind === 'stream_refused'
    && event.payload.reason === 'snapshot_unavailable'), true);
  assert.equal(stream.consume(ticket.body.ticket, principal(), 'https://control.test'), null, 'a connection attempt consumes its one-time nonce even on bounded setup refusal');
});

test('WN6/WN7: later coordination-read and socket-write exceptions close without escaping or stranding capacity', async () => {
  const first = fixture({ maxFrameBytes: 100_000, maxBufferedBytes: 100_000, pollMs: 5 });
  const firstResponse = new Response();
  first.stream.open({ ticket: first.stream.issue(principal(), 'https://control.test', 'repo-a').body.ticket, principal: principal(), origin: 'https://control.test' }, firstResponse);
  const firstEvents = first.coordination.events.bind(first.coordination);
  first.coordination.events = () => { throw new Error('read failed'); };
  await new Promise((resolve) => setTimeout(resolve, 20));
  first.coordination.events = firstEvents;
  assert.equal(firstResponse.ended, true);
  assert.equal(first.stream.activeConnections, 0);
  assert.equal(first.coordination.events().some((event) => event.payload.kind === 'stream_read_failed'), true);

  const second = fixture({ maxFrameBytes: 100_000, maxBufferedBytes: 100_000, pollMs: 5 });
  class LaterBrokenWrite extends Response {
    write(value) {
      this.writeCount = (this.writeCount ?? 0) + 1;
      if (this.writeCount > 2) throw new Error('socket write failed');
      return super.write(value);
    }
  }
  const secondResponse = new LaterBrokenWrite();
  second.stream.open({ ticket: second.stream.issue(principal(), 'https://control.test', 'repo-a').body.ticket, principal: principal(), origin: 'https://control.test' }, secondResponse);
  second.coordination.recordWebAudit({ kind: 'later-event' }, { actor: 'test', key: 'later-write-event' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(secondResponse.ended, true);
  assert.equal(second.stream.activeConnections, 0);
  assert.equal(second.coordination.events().some((event) => event.payload.kind === 'stream_read_failed'), true);
});

test('WN2/WN6: replay is count-bounded and rechecks authorization before every emitted event', () => {
  clock = Date.parse('2026-07-11T12:00:00.000Z');
  const { coordination, stream } = fixture({
    maxFrameBytes: 100_000, maxBufferedBytes: 100_000, maxEventsPerPump: 2,
  });
  const first = coordination.recordWebAudit({ kind: 'batch-one' }, { actor: 'test', key: 'batch-one' });
  coordination.recordWebAudit({ kind: 'batch-two' }, { actor: 'test', key: 'batch-two' });
  const expiring = principal({ expiresAt: new Date(clock + 10).toISOString() });
  class ExpireAfterFirst extends Response {
    write(value) {
      const accepted = super.write(value);
      if (value.includes('batch-one')) clock += 11;
      return accepted;
    }
  }
  const output = new ExpireAfterFirst();
  stream.open({
    ticket: stream.issue(expiring, 'https://control.test', 'repo-a').body.ticket,
    principal: expiring, origin: 'https://control.test', cursor: first.seq - 1,
  }, output);
  assert.match(output.output, /batch-one/);
  assert.equal(output.output.includes('batch-two'), false);
  assert.equal(output.ended, true);
  assert.equal(stream.activeConnections, 0);
  assert.equal(coordination.events().some((event) => event.payload.kind === 'stream_authorization_lost'), true);
});
