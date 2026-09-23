// Issue #294 — the wake consumers' test double for the RESIDENT side of the stream.
//
// The deployment-scope wake stream itself belongs to impl/src/wake-stream.mjs and its resident mount
// (web-northbound.mjs `GET /v1/wakes`); these tests are about the two CONSUMERS, so what they need is
// a resident that speaks the published contract exactly: SSE frames with the wake seq as the SSE id,
// `last-event-id` honored as `since`, the `Accept: application/json` one-page pull, and the typed lag
// frame. It is a transport double, never a second implementation of the stream: it does not derive
// wake classes, it replays the frames a test hands it. The three resident routes beside the stream
// (`/readyz`, `/v1/application-card`, `/v1/session`) are what every Baton client opens with, so the
// consumers under test are built by the PRODUCTION paths (`createBatonWebMcpServer`, BatonWebClient)
// against this socket instead of by hand.
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const WAKE_STREAM_PATH = '/v1/wakes';

export function wakeFrame({ seq, wakeClass, swarmId = null, participantId = null, row = null }) {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'baton.wake',
    seq,
    ts: `2026-09-14T00:00:${`${seq % 60}`.padStart(2, '0')}.000Z`,
    wakeClass,
    swarmId,
    participantId,
    workerId: null,
    runId: null,
    actor: 'orchestrator',
    subject: participantId === null ? null : Object.freeze({ kind: 'participant', id: participantId }),
    next: null,
    observation: false,
    row,
  });
}

/** One resident double on an owner-only Unix socket. `frames` is the deployment's ledger the double
 * replays; `push` appends to it and fans the frame out to every open SSE attachment. */
export async function startWakeResident({ token, frames = [], card, session } = {}) {
  if (typeof token !== 'string' || token.length === 0) throw new TypeError('the double needs a resident token');
  if (card === null || card === undefined || session === null || session === undefined) {
    throw new TypeError('the double needs the served card and session');
  }
  // A short, owner-only path: the consumer's local transport bounds the socket path at 103 bytes and
  // validates the socket's own mode on every request.
  const directory = mkdtempSync(join(tmpdir(), 'bt-wake-double-'));
  const socketPath = join(directory, 'resident.sock');
  const ledger = [...frames];
  const attachments = new Set();
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const json = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (url.pathname === '/readyz') return json(200, { ok: true, ready: true, schemaVersion: 1 });
    if (url.pathname === '/v1/application-card') return json(200, { ok: true, application: card });
    if (url.pathname === '/v1/session') {
      return json(200, { ok: true, identity: session.identity, expiresAt: session.expiresAt });
    }
    requests.push(Object.freeze({
      path: url.pathname,
      since: url.searchParams.get('since'),
      lastEventId: request.headers['last-event-id'] ?? null,
      kinds: url.searchParams.get('kinds'),
      swarms: url.searchParams.get('swarms'),
    }));
    const kinds = url.searchParams.get('kinds')?.split(',').filter((value) => value.length > 0) ?? null;
    const swarms = url.searchParams.get('swarms')?.split(',').filter((value) => value.length > 0) ?? null;
    // The stream's cursor rule, applied by the double exactly as the resident applies it: no cursor
    // means FROM NOW (an attachment never replays a deployment's whole history).
    const head = ledger.reduce((high, frame) => Math.max(high, frame.seq), 0);
    const declared = request.headers['last-event-id'] ?? url.searchParams.get('since') ?? null;
    const declaredSince = declared === null ? Number.NaN : Number(declared);
    const from = Number.isSafeInteger(declaredSince) ? declaredSince : head;
    const matching = () => ledger.filter((frame) => (
      frame.seq > from
      && (kinds === null || kinds.includes(frame.wakeClass))
      && (swarms === null || swarms.includes(frame.swarmId ?? ''))
    ));
    if (`${request.headers.accept ?? ''}`.includes('application/json')) {
      return json(200, {
        ok: true,
        wakes: {
          schemaVersion: 1, kind: 'baton.wake_page',
          cursor: Math.max(head, from),
          swarms: [...new Set(ledger.map((frame) => frame.swarmId).filter((value) => value !== null))].sort(),
          frames: matching(), lagged: null,
        },
      });
    }
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' });
    // Answered at attach, exactly as the resident does: the comment frame carries the headers out.
    response.write(': wake attachment open\n\n');
    const attachment = { response, closed: false };
    attachments.add(attachment);
    const write = (type, id, value) => {
      if (attachment.closed) return;
      try { response.write(`id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(value)}\n\n`); }
      catch { /* the consumer went away */ }
    };
    for (const frame of matching()) write('wake', frame.seq, frame);
    const close = () => {
      if (attachment.closed) return;
      attachment.closed = true;
      attachments.delete(attachment);
    };
    response.on('close', close);
    response.on('error', close);
    attachment.write = write;
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(socketPath, () => resolveListen());
  });
  chmodSync(socketPath, 0o700);
  return Object.freeze({
    socketPath,
    requests,
    attachmentCount: () => attachments.size,
    ledger: () => Object.freeze([...ledger]),
    /** Append one frame to the deployment's ledger and fan it out to every open attachment. */
    push: (frame) => {
      ledger.push(frame);
      for (const attachment of [...attachments]) attachment.write('wake', frame.seq, frame);
    },
    /** Wait until a consumer's attachment has actually reached the resident, so a test can hand a
     * frame to an attachment that exists instead of racing the in-flight request. */
    waitForAttachment: async ({ timeoutMs = 5_000 } = {}) => {
      const deadline = Date.now() + timeoutMs;
      while (attachments.size === 0) {
        if (Date.now() > deadline) throw new Error('no wake attachment reached the resident double');
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
    },
    /** The typed lag marker: the consumer fell further behind than the replay bound. */
    lag: (marker) => {
      for (const attachment of [...attachments]) attachment.write('lagged', marker.cursor, marker);
    },
    /** Drop every open attachment the way a resident restart does: sockets end, nothing is written. */
    drop: () => {
      for (const attachment of [...attachments]) {
        attachment.closed = true;
        attachment.response.destroy();
      }
      attachments.clear();
    },
    close: async () => {
      for (const attachment of [...attachments]) {
        attachment.closed = true;
        attachment.response.destroy();
      }
      attachments.clear();
      await new Promise((resolveClose) => server.close(resolveClose));
      rmSync(directory, { recursive: true, force: true });
    },
  });
}
