#!/usr/bin/env node
// Relay complete root messages from the database host into a Codex thread.
// A message is queued through the Codex CLI and its read is recorded only after
// the app-server that owns the thread returns the complete message as a user
// message in that thread.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const USAGE = 'usage: codex-root-relay.mjs --ssh HOST --database PATH --coordinator PATH --conductor PATH --session ID --thread ID [--node PATH] [--codex PATH]\n';

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
    if (!['--ssh', '--database', '--coordinator', '--conductor', '--session', '--thread', '--node', '--codex'].includes(key)) {
      fail(`Unknown option: ${key}\n${USAGE}`);
    }
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) fail(`${key} requires a value\n${USAGE}`);
    options[key.slice(2)] = value;
  }
  for (const key of ['ssh', 'database', 'coordinator', 'conductor', 'session', 'thread']) {
    if (!options[key]) fail(`--${key} is required\n${USAGE}`);
  }
  return { ...options, node: options.node || 'node', codex: options.codex || 'codex' };
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

class Peer {
  constructor(child, { jsonrpc = true } = {}) {
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
    this.lines = createInterface({ input: child.stdout });
    this.lines.on('line', line => this.receive(line));
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
    this.child.stdin.write(JSON.stringify(this.jsonrpc ? { jsonrpc: '2.0', ...message } : message) + '\n');
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
// 'codex app-server proxy' under the caller's CODEX_HOME. The connection only
// reads thread state.
async function openAppServer(options) {
  const child = spawn(options.codex, ['app-server', 'proxy'], {
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const server = new Peer(child, { jsonrpc: false });
  const initialized = await server.request('initialize', {
    clientInfo: { name: 'baton_codex_root_relay', title: 'Baton Codex root relay', version: '1' },
  });
  if (initialized.error) throw new Error('Codex app-server initialization failed: ' + JSON.stringify(initialized.error));
  server.send({ method: 'initialized' });
  return server;
}

async function appRequest(server, method, params) {
  const reply = await server.request(method, params);
  if (reply.error) throw new Error(`Codex app-server ${method} failed: ` + JSON.stringify(reply.error));
  return reply.result;
}

async function requireLoadedThread(server, thread) {
  let cursor = null;
  do {
    const page = await appRequest(server, 'thread/loaded/list', cursor ? { cursor } : {});
    if (page.data.includes(thread)) return;
    cursor = page.nextCursor ?? null;
  } while (cursor);
  throw new Error('The Codex app-server does not have the recorded root thread loaded: ' + thread);
}

// The newest turn and its item IDs before the notice is queued. Queued input
// can join that turn, so its earlier items are excluded from the receipt search.
async function newestTurn(server, thread) {
  const page = await appRequest(server, 'thread/turns/list',
    { threadId: thread, limit: 1, sortDirection: 'desc', itemsView: 'full' });
  const turn = page.data[0];
  return { turn: turn?.id ?? null, items: new Set((turn?.items || []).map(item => item.id)) };
}

function userText(item) {
  const text = (item.content || []).filter(part => part.type === 'text').map(part => part.text);
  return [text.join(''), text.join('\n'), ...text];
}

// The newest user message that contains the complete notice, searched from the
// newest turn back to the turn that was newest before the notice was queued.
// `before` is the result of newestTurn.
async function findUserMessage(server, thread, content, before) {
  let cursor = null;
  do {
    const page = await appRequest(server, 'thread/turns/list', { threadId: thread, limit: PAGE_TURNS,
      sortDirection: 'desc', itemsView: 'full', ...(cursor ? { cursor } : {}) });
    for (const turn of page.data) {
      for (const item of [...turn.items].reverse()) {
        if (item.type === 'userMessage' && !(turn.id === before.turn && before.items.has(item.id))
            && userText(item).some(text => text.includes(content))) {
          return { turn: turn.id, item: item.id };
        }
      }
      if (turn.id === before.turn) return null;
    }
    cursor = page.nextCursor ?? null;
  } while (cursor);
  return null;
}

async function awaitUserMessage(peer, server, id, thread, content, before) {
  process.stderr.write(JSON.stringify({ type: 'codexRootMessageQueued', thread, message: id }) + '\n');
  while (!peer.exited) {
    const found = await findUserMessage(server, thread, content, before);
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
  throw new Error('SSH conductor closed before Codex returned Baton message ' + id + ' in the root thread.');
}

async function deliverNotice(peer, options, params) {
  const id = messageId(params);
  const server = await openAppServer(options);
  let received;
  let queued;
  try {
    await requireLoadedThread(server, options.thread);
    const before = await newestTurn(server, options.thread);
    queued = await queueMessage(options, id, params.content);
    received = await awaitUserMessage(peer, server, id, options.thread, params.content, before);
  } finally {
    if (server.child.stdin.writable) server.child.stdin.end();
    server.child.kill('SIGTERM');
    await server.closed;
  }
  const read = await peer.request('tools/call', { name: 'baton2_root_delivery',
    arguments: { id, thread: options.thread, content: params.content, turn: received.turn, item: received.item } });
  if (read.error || read.result?.isError) {
    throw new Error('Codex returned Baton message ' + id + ' in the root thread, but its read was not recorded: ' + JSON.stringify(read));
  }
  process.stderr.write(JSON.stringify({ type: 'codexRootMessageReceived', session: options.session,
    thread: options.thread, message: id, turn: received.turn, item: received.item, queue: queued.stdout.trim() }) + '\n');
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
    '--session', options.session, '--root-harness', 'codex', '--thread', options.thread]
    .map(shellQuote).join(' ');
  const child = spawn('ssh', ['-T', options.ssh, 'exec ' + remote], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const peer = new Peer(child);
  connection = peer;
  peer.closed.then(exit => {
    if (!clientLines.closed) {
      process.stderr.write('codex-root-relay: SSH conductor exited: ' + JSON.stringify(exit) + '\n');
      process.exitCode = 1;
      clientLines.close();
    }
  });
  peer.onNotice = params => {
    peer.delivery = (peer.delivery || Promise.resolve())
      .then(() => deliverNotice(peer, options, params))
      .catch(error => {
        if (peer.closing) {
          process.stderr.write(JSON.stringify({ type: 'codexRootMessageUnread', session: options.session,
            thread: options.thread, reason: String(error.message || error) }) + '\n');
          return;
        }
        process.stderr.write(`codex-root-relay: ${error.stack || error}\n`);
        process.exitCode = 1;
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
clientLines.on('line', line => {
  try {
    const message = JSON.parse(line);
    codexMcpRequest(message);
    if (message.method === 'notifications/initialized') {
      connecting = connecting.then(() => connect(options));
      connecting.catch(error => {
        process.stderr.write(`codex-root-relay: ${error.stack || error}\n`);
        process.exitCode = 1;
      });
    }
  } catch (error) {
    process.stderr.write(`codex-root-relay: ${error.stack || error}\n`);
    process.exitCode = 1;
  }
});

clientLines.on('close', async () => {
  if (connection) {
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
