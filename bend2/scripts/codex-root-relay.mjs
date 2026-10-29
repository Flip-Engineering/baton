#!/usr/bin/env node
// Relay complete root messages from the database host into a Codex thread.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const USAGE = 'usage: codex-root-relay.mjs --ssh HOST --database PATH --coordinator PATH --conductor PATH --session ID --thread ID [--node PATH] [--codex PATH]\n';

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
  constructor(child) {
    this.child = child;
    this.nextId = 0;
    this.pending = new Map();
    this.closed = new Promise(resolve => child.once('close', (code, signal) => {
      const exit = { code, signal };
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
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
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

async function deliverNotice(peer, options, params) {
  const id = messageId(params);
  const queued = await queueMessage(options, id, params.content);
  const read = await peer.request('tools/call', { name: 'baton2_root_delivery',
    arguments: { id, thread: options.thread, content: params.content } });
  if (read.error || read.result?.isError) {
    throw new Error('Codex accepted Baton message ' + id + ', but its read was not recorded: ' + JSON.stringify(read));
  }
  process.stderr.write(JSON.stringify({ type: 'codexRootMessageAccepted', session: options.session,
    thread: options.thread, message: id, queue: queued.stdout.trim() }) + '\n');
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
    await connection.delivery;
    if (connection.child.stdin.writable) connection.child.stdin.end();
    const exit = await connection.closed;
    if (exit.code !== 0 && exit.signal !== 'SIGTERM') {
      process.stderr.write('codex-root-relay: SSH conductor exited: ' + JSON.stringify(exit) + '\n');
      process.exitCode = 1;
    }
  }
  try { await connecting; }
  catch { return; }
});
