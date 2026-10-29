#!/usr/bin/env node
// Relay complete root messages from the database host into a Codex thread.
// A message is queued through the Codex CLI and its read is recorded only after
// the app-server that owns the thread returns the complete message as a user
// message in that thread.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';

const USAGE = 'usage: codex-root-relay.mjs --ssh HOST --database PATH --coordinator PATH --conductor PATH --session ID [--thread ID] [--register] [--node PATH] [--codex PATH]\n';

const RECONNECT_MS = 2000;

const POLL_MS = 1000;
const PAGE_TURNS = 8;

function fail(message) {
  process.stderr.write(message.endsWith('\n') ? message : message + '\n');
  process.exit(2);
}

function parse(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--register') {
      options.register = true;
      continue;
    }
    if (!['--ssh', '--database', '--coordinator', '--conductor', '--session', '--thread', '--node', '--codex'].includes(key)) {
      fail(`Unknown option: ${key}\n${USAGE}`);
    }
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) fail(`${key} requires a value\n${USAGE}`);
    options[key.slice(2)] = value;
  }
  for (const key of ['ssh', 'database', 'coordinator', 'conductor', 'session']) {
    if (!options[key]) fail(`--${key} is required\n${USAGE}`);
  }
  // Without --thread, the Codex process that launched the relay may name its
  // conversation in CODEX_THREAD_ID.
  const thread = options.thread || process.env.CODEX_THREAD_ID || '';
  const source = options.thread ? 'argument' : thread ? 'environment' : 'recorded';
  return { ...options, thread, threadSource: source, node: options.node || 'node', codex: options.codex || 'codex' };
}

function shellQuote(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function messageId(params) {
  let ids;
  try { ids = JSON.parse(params.meta?.messageIds || '[]'); }
  catch (error) { throw new Error('Baton root notice has invalid message IDs.', { cause: error }); }
  if (!Array.isArray(ids) || ids.length !== 1 || typeof ids[0] !== 'string' || !ids[0]) {
    throw new Error('Baton root notice must identify one committed message.');
  }
  if (typeof params.content !== 'string' || !params.content) {
    throw new Error('Baton root notice has no complete message body.');
  }
  return ids[0];
}

// The client side of a WebSocket carried over a child's standard streams.
// 'codex app-server proxy' copies raw bytes between its standard streams and
// the app-server control socket, which speaks HTTP and then WebSocket. The
// client sends an HTTP Upgrade request, waits for status 101, then exchanges
// WebSocket frames. Frames to the server are masked and frames from it are not.
class WebSocketStream {
  constructor(child, onText) {
    this.child = child;
    this.onText = onText;
    this.buffer = Buffer.alloc(0);
    this.text = null;
    this.upgraded = false;
    this.opened = new Promise((resolve, reject) => {
      this.open = resolve;
      this.refuse = reject;
    });
    this.opened.catch(() => {});
    child.stdout.on('data', chunk => this.feed(chunk));
    child.once('close', () => {
      if (!this.upgraded) this.refuse(new Error('Codex app-server proxy closed before the WebSocket upgrade.'));
    });
  }

  upgrade() {
    this.child.stdin.write('GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
      + `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    return this.opened;
  }

  feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (!this.upgraded) {
      const end = this.buffer.indexOf('\r\n\r\n');
      if (end === -1) return;
      const head = this.buffer.subarray(0, end).toString('latin1');
      this.buffer = this.buffer.subarray(end + 4);
      if (!/^HTTP\/1\.[01] 101 /.test(head)) {
        this.refuse(new Error('Codex app-server proxy refused the WebSocket upgrade: ' + head.split('\r\n')[0]));
        return;
      }
      this.upgraded = true;
      this.open();
    }
    for (;;) {
      const frame = this.frame();
      if (!frame) return;
      this.handle(frame);
    }
  }

  // One complete frame from the buffer, or null.
  frame() {
    const b = this.buffer;
    if (b.length < 2) return null;
    let length = b[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (b.length < 4) return null;
      length = b.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (b.length < 10) return null;
      length = Number(b.readBigUInt64BE(2));
      offset = 10;
    }
    const masked = (b[1] & 0x80) !== 0;
    if (b.length < offset + (masked ? 4 : 0) + length) return null;
    const mask = masked ? b.subarray(offset, offset + 4) : null;
    if (masked) offset += 4;
    const payload = Buffer.from(b.subarray(offset, offset + length));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    this.buffer = b.subarray(offset + length);
    return { fin: (b[0] & 0x80) !== 0, opcode: b[0] & 0x0f, payload };
  }

  handle({ fin, opcode, payload }) {
    if (opcode === 0x9) this.write(0xa, payload);
    else if (opcode === 0x8) this.child.stdin.end();
    else if (opcode === 0x1 || opcode === 0x0) {
      this.text = this.text ? Buffer.concat([this.text, payload]) : payload;
      if (fin) {
        const text = this.text.toString('utf8');
        this.text = null;
        this.onText(text);
      }
    }
  }

  write(opcode, payload) {
    if (!this.child.stdin.writable) return;
    const mask = randomBytes(4);
    const length = payload.length;
    const head = length < 126 ? Buffer.from([0x80 | opcode, 0x80 | length])
      : length < 65536 ? Buffer.from([0x80 | opcode, 0x80 | 126, length >> 8, length & 0xff])
        : Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | 127]), (() => {
          const size = Buffer.alloc(8);
          size.writeBigUInt64BE(BigInt(length));
          return size;
        })()]);
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    this.child.stdin.write(Buffer.concat([head, mask, masked]));
  }

  sendText(text) {
    this.write(0x1, Buffer.from(text, 'utf8'));
  }

  close() {
    this.write(0x8, Buffer.alloc(0));
  }
}

class Peer {
  constructor(child, { jsonrpc = true, websocket = false } = {}) {
    this.child = child;
    this.jsonrpc = jsonrpc;
    this.nextId = 0;
    this.pending = new Map();
    this.exited = false;
    this.closed = new Promise(resolve => child.once('close', (code, signal) => {
      const exit = { code, signal };
      this.exited = true;
      this.rejectAll(new Error('SSH conductor closed before replying: ' + JSON.stringify(exit)));
      resolve(exit);
    }));
    if (websocket) this.ws = new WebSocketStream(child, text => this.receive(text));
    else {
      this.lines = createInterface({ input: child.stdout });
      this.lines.on('line', line => this.receive(line));
    }
    child.stderr.pipe(process.stderr, { end: false });
    child.once('error', error => this.rejectAll(error));
    child.stdin.on('error', error => this.rejectAll(error));
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  send(message) {
    if (!this.child.stdin.writable) throw new Error('SSH conductor input is closed.');
    const text = JSON.stringify(this.jsonrpc ? { jsonrpc: '2.0', ...message } : message);
    if (this.ws) this.ws.sendText(text);
    else this.child.stdin.write(text + '\n');
  }

  // Answers a request from the peer. When the connection has ended, the peer
  // sends the request again on its next connection, so the answer is dropped.
  reply(message) {
    if (this.exited || !this.child.stdin.writable) return;
    try { this.send(message); }
    catch (error) { process.stderr.write(`codex-root-relay: reply dropped: ${error.message}\n`); }
  }

  receive(line) {
    let message;
    try { message = JSON.parse(line); }
    catch { throw new Error('SSH conductor returned invalid JSON-RPC input: ' + line); }
    if (message.id !== undefined && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      pending.resolve(message);
      return;
    }
    if (message.method === 'ping' && message.id !== undefined) {
      this.send({ id: message.id, result: {} });
      return;
    }
    if (message.method === 'baton/rootThreadItem' && message.id !== undefined) {
      this.onItemRequest?.(message.params).then(
        result => this.reply({ id: message.id, result }),
        error => this.reply({ id: message.id, error: { code: -32000, message: String(error.message || error) } }));
      return;
    }
    if (message.method === 'notifications/claude/channel') {
      this.onNotice?.(message.params);
      return;
    }
    if (message.id !== undefined) this.send({ id: message.id, error: { code: -32601, message: 'Method not found' } });
  }

  request(method, params) {
    const id = ++this.nextId;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.send({ id, method, params });
    return result;
  }
}

function childResult(child, args) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', part => { stdout += part; });
    child.stderr?.on('data', part => { stderr += part; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr, args }));
  });
}

async function queueMessage(options, id, content) {
  const args = ['queue', '--thread', options.thread, '--message', content];
  const result = await childResult(spawn(options.codex, args, {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  }), args);
  if (result.code !== 0 || result.signal) {
    throw new Error('Codex did not accept Baton message ' + id + ': ' + JSON.stringify(result));
  }
  return result;
}

// The Codex app-server that owns the thread, reached through the supported
// 'codex app-server proxy' under the caller's CODEX_HOME. The proxy carries a
// WebSocket, which the app-server speaks as JSON text frames. The connection
// only reads thread state.
async function openAppServer(options) {
  const child = spawn(options.codex, ['app-server', 'proxy'], {
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const server = new Peer(child, { jsonrpc: false, websocket: true });
  try {
    await server.ws.upgrade();
    const initialized = await server.request('initialize', {
      clientInfo: { name: 'baton_codex_root_relay', title: 'Baton Codex root relay', version: '1' },
    });
    if (initialized.error) throw appError('Codex app-server initialization failed: ' + JSON.stringify(initialized.error));
    server.send({ method: 'initialized' });
  } catch (error) {
    closeAppServer(server);
    throw error;
  }
  return server;
}

function closeAppServer(server) {
  if (server.ws.upgraded) server.ws.close();
  if (server.child.stdin.writable) server.child.stdin.end();
  server.child.kill('SIGTERM');
}

// An error reply from the app-server. Lost connections are not app errors.
function appError(message) {
  const error = new Error(message);
  error.appServer = true;
  return error;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Requests to the app-server that reconnect through the proxy when the
// connection is lost, for as long as the SSH conductor is open. A restarted
// app-server is found again through the same control socket lookup.
class AppSession {
  constructor(options, peer) {
    this.options = options;
    this.peer = peer;
    this.server = null;
    this.lost = '';
  }

  async request(method, params) {
    for (;;) {
      try {
        this.server ??= await openAppServer(this.options);
        const reply = await this.server.request(method, params);
        if (reply.error) throw appError(`Codex app-server ${method} failed: ` + JSON.stringify(reply.error));
        this.lost = '';
        return reply.result;
      } catch (error) {
        if (error.appServer || this.peer.exited) throw error;
        if (this.server) closeAppServer(this.server);
        this.server = null;
        const reason = String(error.message || error);
        if (reason !== this.lost) {
          this.lost = reason;
          process.stderr.write(JSON.stringify({ type: 'codexAppServerUnavailable', thread: this.options.thread, reason }) + '\n');
        }
        await sleep(POLL_MS);
      }
    }
  }

  async close() {
    if (this.server) {
      closeAppServer(this.server);
      await this.server.closed;
      this.server = null;
    }
  }
}

// Waits until the app-server has the thread loaded. A restarted app-server
// loads the root thread again when the root client resumes it.
async function awaitLoadedThread(delivery, session, thread) {
  let reported = false;
  while (!delivery.exited) {
    let cursor = null;
    do {
      const page = await session.request('thread/loaded/list', cursor ? { cursor } : {});
      if (page.data.includes(thread)) return;
      cursor = page.nextCursor ?? null;
    } while (cursor);
    if (!reported) {
      reported = true;
      process.stderr.write(JSON.stringify({ type: 'codexRootThreadNotLoaded', thread }) + '\n');
    }
    await sleep(POLL_MS);
  }
  throw endedDelivery(delivery, 'the Codex app-server loaded the root thread: ' + thread);
}

// The newest turn and its item IDs before the notice is queued. Queued input
// can join that turn, so its earlier items are excluded from the receipt search.
async function newestTurn(session, thread) {
  const page = await session.request('thread/turns/list',
    { threadId: thread, limit: 1, sortDirection: 'desc', itemsView: 'full' });
  const turn = page.data[0];
  return { turn: turn?.id ?? null, items: new Set((turn?.items || []).map(item => item.id)) };
}

function userText(item) {
  const text = (item.content || []).filter(part => part.type === 'text').map(part => part.text);
  return [text.join(''), text.join('\n'), ...text];
}

// Walks the thread's turns from the newest. `visit` returns a value to stop the
// walk with it, null to stop with no value, or undefined to continue.
async function walkTurns(session, thread, visit) {
  let cursor = null;
  do {
    const page = await session.request('thread/turns/list', { threadId: thread, limit: PAGE_TURNS,
      sortDirection: 'desc', itemsView: 'full', ...(cursor ? { cursor } : {}) });
    for (const turn of page.data) {
      const found = visit(turn);
      if (found !== undefined) return found;
    }
    cursor = page.nextCursor ?? null;
  } while (cursor);
  return null;
}

// The newest user message that contains the complete notice, searched from the
// newest turn back to the turn that was newest before the notice was queued.
// `before` is the result of newestTurn.
function findUserMessage(session, thread, content, before) {
  return walkTurns(session, thread, turn => {
    for (const item of [...turn.items].reverse()) {
      if (item.type === 'userMessage' && !(turn.id === before.turn && before.items.has(item.id))
          && userText(item).some(text => text.includes(content))) {
        return { turn: turn.id, item: item.id };
      }
    }
    return turn.id === before.turn ? null : undefined;
  });
}

// The conductor asks for the item that the relay claims returned a notice, and
// decides from this read whether the read is recorded.
async function readThreadItem(session, thread, turnId, itemId) {
  const found = await walkTurns(session, thread, turn => {
    if (turn.id !== turnId) return undefined;
    const item = turn.items.find(candidate => candidate.id === itemId);
    return item ? { item } : null;
  });
  if (!found) throw new Error(`Thread ${thread} has no item ${itemId} in turn ${turnId}.`);
  const { item } = found;
  return { thread, turn: turnId, item: itemId, type: item.type,
    ...(item.type === 'userMessage' ? { text: userText(item)[0] } : {}) };
}

async function awaitUserMessage(delivery, session, id, thread, content, before) {
  process.stderr.write(JSON.stringify({ type: 'codexRootMessageQueued', thread, message: id }) + '\n');
  while (!delivery.exited) {
    const found = await findUserMessage(session, thread, content, before);
    if (found) return found;
    await sleep(POLL_MS);
  }
  throw endedDelivery(delivery, 'Codex returned Baton message ' + id + ' in the root thread.');
}

// A delivery ends when the SSH conductor closes or when the conductor names a
// different root conversation. The message stays unread in both cases.
function endedDelivery(delivery, waitingFor) {
  const error = new Error(delivery.superseded
    ? `The root conversation changed before ${waitingFor}`
    : `SSH conductor closed before ${waitingFor}`);
  error.superseded = delivery.superseded;
  return error;
}

function noticeThread(options, params) {
  const thread = params.meta?.thread ?? options.thread;
  if (typeof thread !== 'string' || !thread) throw new Error('Baton root notice does not identify the root thread.');
  if (options.thread && thread !== options.thread) {
    throw new Error(`Baton root notice is for thread ${thread}, not ${options.thread}.`);
  }
  return thread;
}

async function deliverNotice(peer, delivery, options, params) {
  const id = messageId(params);
  const thread = noticeThread(options, params);
  const session = new AppSession({ ...options, thread }, delivery);
  let received;
  let queued;
  try {
    await awaitLoadedThread(delivery, session, thread);
    const before = await newestTurn(session, thread);
    queued = await queueMessage({ ...options, thread }, id, params.content);
    received = await awaitUserMessage(delivery, session, id, thread, params.content, before);
  } finally {
    await session.close();
  }
  if (delivery.exited) throw endedDelivery(delivery, 'the read of Baton message ' + id + ' was recorded.');
  const read = await peer.request('tools/call', { name: 'baton2_root_delivery',
    arguments: { id, thread, content: params.content, turn: received.turn, item: received.item } });
  if (read.error || read.result?.isError) {
    // The conductor refuses a read from a conversation it no longer serves.
    if (delivery.superseded) throw endedDelivery(delivery, 'the read of Baton message ' + id + ' was recorded.');
    throw new Error('Codex returned Baton message ' + id + ' in the root thread, but its read was not recorded: ' + JSON.stringify(read));
  }
  process.stderr.write(JSON.stringify({ type: 'codexRootMessageReceived', session: options.session,
    thread, message: id, turn: received.turn, item: received.item, queue: queued.stdout.trim() }) + '\n');
}

function codexMcpRequest(message) {
  if (message.method === 'initialize') {
    sendClient({ id: message.id, result: {
      protocolVersion: message.params?.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'baton-codex-root-relay', version: '1.0.0' },
    } });
  } else if (message.method === 'tools/list') {
    sendClient({ id: message.id, result: { tools: [] } });
  } else if (message.method === 'ping') {
    sendClient({ id: message.id, result: {} });
  } else if (message.id !== undefined) {
    sendClient({ id: message.id, error: { code: -32601, message: 'Method not found' } });
  }
}

function sendClient(message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
}

async function connect(options) {
  const remote = [options.node, options.conductor, options.database, options.coordinator,
    '--session', options.session, '--root-harness', 'codex', ...(options.thread ? ['--thread', options.thread] : []),
    ...(options.register ? ['--register'] : [])]
    .map(shellQuote).join(' ');
  const child = spawn('ssh', ['-T', options.ssh, 'exec ' + remote], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const peer = new Peer(child);
  connection = peer;
  peer.onItemRequest = async params => {
    const session = new AppSession({ ...options, thread: params.thread }, peer);
    try { return await readThreadItem(session, params.thread, params.turn, params.item); }
    finally { await session.close(); }
  };
  peer.onNotice = params => {
    if (peer.closing || peer.exited) return;
    // A notice for another root conversation replaces the delivery in progress.
    // The earlier message stays unread, and a late return from its conversation
    // is not recorded because the conductor now serves the new one.
    let thread = null;
    try { thread = noticeThread(options, params); } catch {}
    const delivery = { thread, superseded: false, get exited() { return peer.exited || this.superseded; } };
    if (peer.active && peer.active.thread !== thread) peer.active.superseded = true;
    peer.active = delivery;
    peer.delivery = (peer.delivery || Promise.resolve())
      .then(() => {
        if (peer.closing || delivery.exited) return;
        return deliverNotice(peer, delivery, options, params);
      })
      .catch(error => {
        if (peer.closing || peer.exited || error.superseded) {
          process.stderr.write(JSON.stringify({ type: error.superseded ? 'codexRootMessageSuperseded' : 'codexRootMessageUnread',
            session: options.session, thread, reason: String(error.message || error) }) + '\n');
          return;
        }
        process.stderr.write(`codex-root-relay: ${error.stack || error}\n`);
        process.exitCode = 1;
        peer.closing = true;
        peer.deliveryFailed = true;
        child.kill('SIGTERM');
      });
  };
  try {
    const initialized = await peer.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'baton_codex_root_relay', title: 'Baton Codex root relay', version: '1' },
    });
    if (initialized.error) throw new Error('SSH conductor initialization failed: ' + JSON.stringify(initialized.error));
    peer.send({ method: 'notifications/initialized', params: {} });
    const listed = await peer.request('tools/list', {});
    if (listed.error) throw new Error('SSH conductor tool discovery failed: ' + JSON.stringify(listed.error));
    return peer;
  } catch (error) {
    if (child.stdin.writable) child.stdin.end();
    await peer.closed;
    throw error;
  }
}

const options = parse(process.argv.slice(2));
const clientLines = createInterface({ input: process.stdin });
let connection = null;
let connecting = Promise.resolve();
let clientClosed = false;

// Keeps one SSH conductor connection open for as long as the Codex client is.
// A conductor that cannot be started or initialized the first time is a
// configuration failure and ends the relay. After a connection was established,
// a lost connection is opened again; the conductor sends the oldest unread
// message on each new connection.
async function maintain() {
  process.stderr.write(JSON.stringify({ type: 'codexRelayIdentity', session: options.session,
    thread: options.thread || null, threadSource: options.threadSource, register: Boolean(options.register) }) + '\n');
  let established = false;
  while (!clientClosed) {
    try {
      connection = await connect(options);
      established = true;
    } catch (error) {
      if (!established) throw error;
      process.stderr.write(`codex-root-relay: SSH conductor connection failed: ${error.message}\n`);
      await new Promise(resolve => setTimeout(resolve, RECONNECT_MS));
      continue;
    }
    const exit = await connection.closed;
    if (clientClosed) return;
    // A failed delivery (a queue error or refused read evidence) ends the relay
    // with its diagnostic. Only a lost connection is opened again.
    if (connection.deliveryFailed) {
      clientLines.close();
      return;
    }
    process.stderr.write(JSON.stringify({ type: 'codexRelayConductorLost', session: options.session, exit }) + '\n');
    await new Promise(resolve => setTimeout(resolve, RECONNECT_MS));
  }
}

clientLines.on('line', line => {
  try {
    const message = JSON.parse(line);
    codexMcpRequest(message);
    if (message.method === 'notifications/initialized') {
      connecting = connecting.then(maintain);
      connecting.catch(error => {
        process.stderr.write(`codex-root-relay: ${error.stack || error}\n`);
        process.exitCode = 1;
        clientLines.close();
      });
    }
  } catch (error) {
    process.stderr.write(`codex-root-relay: ${error.stack || error}\n`);
    process.exitCode = 1;
  }
});

clientLines.on('close', async () => {
  clientClosed = true;
  if (connection && !connection.exited) {
    // A message not yet returned by the root thread stays unread in the database.
    connection.closing = true;
    if (connection.child.stdin.writable) connection.child.stdin.end();
    await connection.delivery;
    const exit = await connection.closed;
    if (exit.code !== 0 && exit.signal !== 'SIGTERM') {
      process.stderr.write('codex-root-relay: SSH conductor exited: ' + JSON.stringify(exit) + '\n');
      process.exitCode = 1;
    }
  }
  try { await connecting; }
  catch { return; }
});
