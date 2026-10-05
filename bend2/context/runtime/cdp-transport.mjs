// CDP runtime lane: the loopback inspector transport.
//
// Contract: docs/bend2/semantic-context-spec.md, "Runtime contract". The adapter owns
// one connection to the target's ephemeral loopback inspector endpoint. Every request
// is correlated by id. A transport-level error and an in-band exception are separate
// evidence: a rejected evaluation arrives as exceptionDetails inside a successful
// response, so a protocol-level error check alone misses it. An evaluation does not
// await a returned Promise; the Promise object is the result.
//
// Endpoint secrecy: inspector endpoint URLs and UUIDs stay internal. This module keeps
// the URL in a private field, refuses a non-loopback endpoint at the connection
// boundary, and never puts the URL, host, port or UUID into an error detail, a retained
// frame record or a returned value. Evidence that a connection existed is a
// non-reversible digest, which correlates records without disclosing the endpoint.
//
// Lost or closed transport: the connection becomes unusable and every pending request
// fails. The transport asserts nothing about the target; a caller records the adapter
// failure and keeps target custody separate.

import { createHash } from 'node:crypto';

const LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', 'localhost', '::1', '[::1]']);

export class TransportRefusal extends Error {
  constructor(condition, detail) {
    super(detail === undefined || detail === null ? condition : `${condition}: ${detail}`);
    this.name = 'TransportRefusal';
    this.condition = condition;
    this.detail = detail === undefined ? null : detail;
  }
}

export function endpointIdentity(url) {
  return createHash('sha256').update(url, 'utf8').digest('hex');
}

export function admitLoopbackEndpoint(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, condition: 'endpointMalformed' };
  }
  if (parsed.protocol !== 'ws:') return { ok: false, condition: 'endpointNotWebSocket' };
  if (!LOOPBACK_HOSTS.includes(parsed.hostname)) {
    return { ok: false, condition: 'endpointNotLoopback', detail: 'the inspector endpoint is not loopback' };
  }
  const port = Number.parseInt(parsed.port, 10);
  if (!Number.isSafeInteger(port) || port <= 0) return { ok: false, condition: 'endpointMalformed' };
  if (parsed.pathname === '/' || parsed.pathname.length < 2) return { ok: false, condition: 'endpointMalformed' };
  return { ok: true, identity: endpointIdentity(url) };
}

// The default request timeout is a caller-supplied observation bound, never a protocol
// rule: the protocol has no response deadline. A caller that passes no deadline waits
// indefinitely, which is what a pending evaluation requires.
export class CdpTransport {
  #socket;
  #url;
  #nextId = 1;
  #pending = new Map();
  #frames = [];
  #handlers = new Map();
  #failure = null;
  #closed = false;
  #failureHandlers = [];

  constructor(socket, { url, identity }) {
    this.#socket = socket;
    this.#url = url;
    this.endpointIdentity = identity;
    socket.addEventListener('message', (event) => this.#receive(String(event.data)));
    socket.addEventListener('close', (event) => this.#fail('transportClosed',
      `code ${event.code ?? 'null'} reason ${JSON.stringify(event.reason ?? '')}`));
    socket.addEventListener('error', () => this.#fail('transportError', 'the socket reported an error'));
  }

  // The session registers here so a lost connection becomes an adapter failure the
  // moment the socket closes, rather than at the next request.
  subscribeFailure(handler) {
    if (this.#failure !== null) {
      handler(this.#failure);
      return () => {};
    }
    this.#failureHandlers.push(handler);
    return () => {
      this.#failureHandlers = this.#failureHandlers.filter((candidate) => candidate !== handler);
    };
  }

  static connect(url, { signal = null } = {}) {
    const admitted = admitLoopbackEndpoint(url);
    if (!admitted.ok) return Promise.reject(new TransportRefusal(admitted.condition, admitted.detail ?? null));
    return new Promise((resolve, reject) => {
      let socket;
      try {
        socket = new WebSocket(url);
      } catch {
        reject(new TransportRefusal('transportError', 'the inspector socket could not be constructed'));
        return;
      }
      const onAbort = () => {
        socket.close();
        reject(new TransportRefusal('transportAborted', null));
      };
      socket.addEventListener('open', () => {
        if (signal !== null) signal.removeEventListener('abort', onAbort);
        resolve(new CdpTransport(socket, { url, identity: admitted.identity }));
      });
      socket.addEventListener('error', () => {
        if (signal !== null) signal.removeEventListener('abort', onAbort);
        reject(new TransportRefusal('transportError', 'the inspector socket reported an error before it opened'));
      });
      if (signal !== null) {
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  // Every frame, in order, with direction and exact text. No endpoint identity appears.
  frames() {
    return this.#frames.slice();
  }

  failure() {
    return this.#failure;
  }

  closed() {
    return this.#closed || this.#failure !== null;
  }

  #fail(condition, detail) {
    if (this.#failure !== null) return;
    this.#failure = new TransportRefusal(condition, detail);
    for (const [, entry] of this.#pending) entry.reject(this.#failure);
    this.#pending.clear();
    const handlers = this.#failureHandlers;
    this.#failureHandlers = [];
    for (const handler of handlers) handler(this.#failure);
  }

  #receive(text) {
    this.#frames.push({ direction: 'in', text });
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      this.#fail('frameMalformed', 'the inspector sent a frame that is not JSON');
      return;
    }
    if (message !== null && typeof message === 'object' && message.method !== undefined) {
      this.#frames[this.#frames.length - 1].method = message.method;
      for (const handler of this.#handlers.get(message.method) ?? []) handler(message.params ?? {}, message);
      for (const handler of this.#handlers.get('*') ?? []) handler(message.params ?? {}, message);
      return;
    }
    const id = message?.id;
    if (typeof id !== 'number' || !this.#pending.has(id)) {
      this.#fail('responseUnmatched', `response id ${JSON.stringify(id)}`);
      return;
    }
    const entry = this.#pending.get(id);
    this.#pending.delete(id);
    entry.resolve(message);
  }

  // Subscribe to one event method. `*` receives every event. Returns an unsubscribe
  // function.
  subscribe(method, handler) {
    const list = this.#handlers.get(method) ?? [];
    list.push(handler);
    this.#handlers.set(method, list);
    return () => {
      const current = this.#handlers.get(method) ?? [];
      this.#handlers.set(method, current.filter((candidate) => candidate !== handler));
    };
  }

  // Send one request and resolve with the raw response message. A transport failure
  // before a response rejects with the retained failure.
  request(method, params = {}) {
    if (this.#failure !== null) return Promise.reject(this.#failure);
    if (this.#closed) return Promise.reject(new TransportRefusal('transportClosed', 'the caller closed the transport'));
    const id = this.#nextId++;
    const text = JSON.stringify({ id, method, params });
    this.#frames.push({ direction: 'out', text, method });
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, method });
      try {
        this.#socket.send(text);
      } catch {
        this.#pending.delete(id);
        reject(new TransportRefusal('transportError', 'the inspector socket refused the request'));
      }
    });
  }

  // A request whose response must carry a result. A protocol error is a transport-level
  // refusal naming the CDP code and message.
  async send(method, params = {}) {
    const message = await this.request(method, params);
    if (message.error !== undefined) {
      throw new TransportRefusal('cdpError',
        `${method} ${message.error.code}: ${message.error.message}`);
    }
    return message.result ?? {};
  }

  // An evaluating request. Both channels are reported distinctly: a protocol error
  // refuses through `send`, and an in-band rejection returns exceptionDetails alongside
  // the result. The returned Promise is the result; this method never awaits a target
  // Promise.
  async evaluate(method, params = {}) {
    const result = await this.send(method, params);
    const exceptionDetails = result.exceptionDetails ?? null;
    return { result, exceptionDetails, inBandException: exceptionDetails !== null };
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    // Dropping the URL reference keeps the endpoint out of any later inspection of this
    // object; only the digest survives.
    this.#url = null;
    try {
      this.#socket.close();
    } catch {
      // A socket that cannot be closed is already unusable; the retained failure, if
      // any, is the evidence.
    }
  }
}
