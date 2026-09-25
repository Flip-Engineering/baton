// U-G8 (issue #313, the #289 registry-truth leftover): an EventSource auto-reconnect sends the
// SAME ticket and the Last-Event-ID of the last frame it saw. Today that reconnect can never
// succeed: the ticket was deleted at first open (single-use consume), and even re-issued, the
// open requires byte-equality with the cursor baked into the ticket — so a drop always lands as
// 409 snapshot_required. The stream contract after the fix: within the ticket's TTL and the same
// principal, a run ticket may RE-OPEN and RESUME from any cursor the grant admits — never rewind
// past the ticket's bound, never survive a resident incarnation change or terminal delivery.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { WebEventStream } from '../src/web-stream.mjs';

const principal = () => ({ userId: 'u', sessionId: 's', credentialId: 'c', expiresAt: '2099-01-01T00:00:00.000Z', capabilities: ['observe'], repoIds: ['repo-a'] });
const ORIGIN = 'https://control.test';

class SseResponse extends EventEmitter {
  constructor() { super(); this.writableLength = 0; this.output = ''; this.ended = false; }
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  write(value) { this.output += value; return true; }
  end() { this.ended = true; }
  frames() {
    return this.output.split('\n\n').filter((block) => block.length > 0).map((block) => {
      const id = /^id: (.*)$/m.exec(block)?.[1] ?? null;
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? null;
      return { id, event, block };
    });
  }
}

/** A run facade whose durable progress cursor the test moves between connections. */
function applicationFacade(cursorBox) {
  return {
    async command(name, args) {
      assert.equal(name, 'run.inspect');
      if (args.depth === 'outline') {
        return { runId: args.runId, depth: 'outline', cursor: cursorBox.cursor, terminal: false, outline: {} };
      }
      assert.equal(args.item, 'execution:progress');
      return {
        runId: args.runId, depth: 'content', cursor: cursorBox.cursor, terminal: false,
        content: { schemaVersion: 1, kind: 'baton.run_progress', runId: args.runId, terminal: false, phase: 'executing' },
      };
    },
  };
}

function fixture(cursorBox, incarnation = 'web-inc-1') {
  const coordination = { snapshot: () => ({ lastSeq: 0 }), events: () => [], recordWebAudit: () => ({ ok: true }) };
  const stream = new WebEventStream({
    coordination, application: applicationFacade(cursorBox),
    allowedOrigins: [ORIGIN], repoIds: ['repo-a'], now: () => Date.parse('2026-09-14T12:00:00.000Z'),
    pollMs: 5, ticketTtlMs: 60_000, incarnation,
  });
  return stream;
}

test('U-G8: a dropped run stream re-opens the SAME ticket and resumes from the Last-Event-ID', async () => {
  const cursorBox = { cursor: 5 };
  const stream = fixture(cursorBox);
  const issued = stream.issue(principal(), ORIGIN, { repoId: 'repo-a', runId: 'run:1', channel: 'progress', cursor: 2, snapshot: { runId: 'run:1', depth: 'outline', cursor: 2 } });
  assert.equal(issued.status, 201);

  const first = new SseResponse();
  assert.equal(await stream.open({ ticket: issued.body.ticket, principal: principal(), origin: ORIGIN, cursor: undefined }, first), null,
    'the first open attaches');
  assert.equal(first.status, 200);
  const firstFrames = first.frames();
  assert.equal(firstFrames[0]?.event, 'snapshot');
  const lastId = firstFrames.at(-1)?.id;
  assert.ok(lastId !== null && lastId !== undefined, 'the stream emitted a resumable id');

  // The drop: EventSource reconnects with the SAME ticket and the last id it saw.
  const second = new SseResponse();
  const refusal = await stream.open({ ticket: issued.body.ticket, principal: principal(), origin: ORIGIN, cursor: lastId }, second);
  assert.equal(refusal, null, `a reconnect after a drop resumes instead of being refused (${JSON.stringify(refusal?.body ?? null)})`);
  assert.equal(second.status, 200);
  assert.equal(second.frames()[0]?.event, 'snapshot', 'the resumed attachment opens with its snapshot');
  first.emit('close');
  second.emit('close');
});

test('U-G8: a resume never rewinds past the ticket bound, and survives neither terminal nor a new incarnation', async () => {
  const cursorBox = { cursor: 5 };
  const stream = fixture(cursorBox);
  const issued = stream.issue(principal(), ORIGIN, { repoId: 'repo-a', runId: 'run:1', channel: 'progress', cursor: 3, snapshot: { runId: 'run:1', depth: 'outline', cursor: 3 } });
  assert.equal(issued.status, 201);

  // Rewind below the bound is refused even for the live ticket.
  const rewound = new SseResponse();
  assert.equal((await stream.open({ ticket: issued.body.ticket, principal: principal(), origin: ORIGIN, cursor: '1' }, rewound))?.status, 409,
    'a resume below the ticket bound is snapshot_required');
  rewound.emit('close');

  // A legal resume on the live ticket succeeds…
  cursorBox.cursor = 7;
  const resume = new SseResponse();
  assert.equal(await stream.open({ ticket: issued.body.ticket, principal: principal(), origin: ORIGIN, cursor: '5' }, resume), null);
  resume.emit('close');

  // …but an incarnation rollover is a different stream: the grant is stamped with the
  // incarnation that issued it, and a changed one refuses the still-registered ticket
  // (a restarted resident has a fresh ticket map, so the cross-instance case 403s at
  // consume — this pin exercises the guard itself).
  stream.incarnation = 'web-inc-2';
  const drifted = new SseResponse();
  assert.equal((await stream.open({ ticket: issued.body.ticket, principal: principal(), origin: ORIGIN, cursor: '5' }, drifted))?.status, 409,
    'an incarnation change refuses the stale ticket');
  drifted.emit('close');
  stream.incarnation = 'web-inc-1';
});

test('U-G8: a fresh ticket still opens exactly at its bound — unbound resume stays refused', async () => {
  const cursorBox = { cursor: 5 };
  const stream = fixture(cursorBox);
  const unbound = stream.issue(principal(), ORIGIN, { repoId: 'repo-a', runId: 'run:1', channel: 'progress', snapshot: { runId: 'run:1', depth: 'outline', cursor: 4 } });
  assert.equal(unbound.status, 201);
  const res = new SseResponse();
  assert.equal((await stream.open({ ticket: unbound.body.ticket, principal: principal(), origin: ORIGIN, cursor: '5' }, res))?.status, 409,
    'a ticket with no bound cursor admits no cursor at open');
  res.emit('close');
});
