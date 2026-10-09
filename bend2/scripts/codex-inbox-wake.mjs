#!/usr/bin/env node
// Deliver a committed inbox pointer through the public managed Codex lifecycle.
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';

function record(value) {
  process.stdout.write(JSON.stringify(value) + '\n');
}

class PublicProxy {
  constructor() {
    this.child = spawn('codex', ['app-server', 'proxy'], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.buffer = Buffer.alloc(0);
    this.stream = this.child.stdout[Symbol.asyncIterator]();
    this.sequence = 0;
    this.upgraded = false;
    this.spawnError = null;
    this.writeError = null;
    this.child.once('error', error => { this.spawnError = error; });
    this.child.stdin.on('error', error => { this.writeError = error; });
    this.closed = new Promise(resolve => this.child.once('close', (code, signal) => resolve({ code, signal })));
  }

  async bytes(length) {
    while (this.buffer.length < length) {
      const next = await this.stream.next();
      if (next.done) throw this.spawnError || this.writeError || new Error('Public Codex proxy closed before its response; incomplete bytes: ' + this.buffer.toString('hex'));
      this.buffer = Buffer.concat([this.buffer, next.value]);
    }
    const result = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return result;
  }

  write(bytes) {
    if (this.writeError) throw this.writeError;
    this.child.stdin.write(bytes);
  }

  async connect() {
    const key = randomBytes(16).toString('base64');
    this.write(Buffer.from('GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ' + key + '\r\n\r\n'));
    let header = Buffer.alloc(0);
    while (!header.subarray(-4).equals(Buffer.from('\r\n\r\n'))) header = Buffer.concat([header, await this.bytes(1)]);
    const text = header.toString('utf8');
    const fields = text.split('\r\n');
    const accept = fields.find(field => /^sec-websocket-accept:/i.test(field))?.split(':').slice(1).join(':').trim();
    const expected = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    if (!/^HTTP\/1\.1 101(?: |\r|$)/.test(text) || accept !== expected) throw new Error('Public Codex proxy did not complete its WebSocket upgrade: ' + text);
    this.upgraded = true;
    await this.rpc('initialize', {
      clientInfo: { name: 'baton_inbox_wake', title: 'Baton inbox wake', version: '1' },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: 'initialized', params: {} });
  }

  frame(bytes, opcode = 1) {
    const mask = randomBytes(4);
    let header;
    if (bytes.length < 126) header = Buffer.from([0x80 | opcode, 0x80 | bytes.length]);
    else if (bytes.length <= 0xffff) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(bytes.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(bytes.length), 2);
    }
    const payload = Buffer.from(bytes);
    for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % 4];
    this.write(Buffer.concat([header, mask, payload]));
  }

  send(message) {
    const raw = JSON.stringify(message);
    this.frame(Buffer.from(raw));
  }

  async message() {
    const fragments = [];
    let messageOpcode = null;
    for (;;) {
      const header = await this.bytes(2);
      const opcode = header[0] & 15;
      let length = header[1] & 127;
      if (length === 126) length = (await this.bytes(2)).readUInt16BE();
      else if (length === 127) {
        length = Number((await this.bytes(8)).readBigUInt64BE());
        if (!Number.isSafeInteger(length)) throw new Error('WebSocket length cannot be represented by the native buffer API');
      }
      const mask = header[1] & 128 ? await this.bytes(4) : null;
      const payload = Buffer.from(await this.bytes(length));
      if (mask) for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % 4];
      if (opcode === 8) {
        throw new Error('Public Codex proxy closed before RPC completion: ' + payload.toString('hex'));
      }
      if (opcode === 9) { this.frame(payload, 10); continue; }
      if (opcode === 10) continue;
      if (opcode !== 0) messageOpcode = opcode;
      fragments.push(payload);
      if (!(header[0] & 128)) continue;
      const bytes = Buffer.concat(fragments);
      if (messageOpcode !== 1) throw new Error('Public Codex proxy returned a non-text RPC frame: ' + bytes.toString('hex'));
      let raw;
      try { raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch (error) { throw new Error('Public Codex proxy returned invalid UTF-8: ' + bytes.toString('hex'), { cause: error }); }
      try { return JSON.parse(raw); }
      catch (error) { throw new Error('Public Codex proxy returned invalid JSON: ' + raw, { cause: error }); }
    }
  }

  async rpc(method, params) {
    const id = ++this.sequence;
    this.send({ id, method, params });
    for (;;) {
      const message = await this.message();
      if (message.id !== id || message.method) continue;
      if (message.error) throw new Error('Public Codex ' + method + ' refused input: ' + JSON.stringify(message));
      if (!Object.hasOwn(message, 'result')) throw new Error('Public Codex ' + method + ' returned no result: ' + JSON.stringify(message));
      return message.result;
    }
  }

  async close() {
    let closeError;
    try {
      try {
        if (this.upgraded && !this.child.stdin.destroyed) this.frame(Buffer.alloc(0), 8);
      } finally {
        this.child.stdin.end();
      }
      for (;;) {
        const next = await this.stream.next();
        if (next.done) break;
      }
    } catch (error) {
      closeError = error;
    }
    const exit = await this.closed;
    record({ type: 'codexProxyExit', ...exit });
    const causes = [closeError, this.spawnError, this.writeError].filter(Boolean).map(error => String(error.stack || error));
    if (exit.code !== 0 || exit.signal) causes.push('Public Codex proxy exited: ' + JSON.stringify(exit));
    if (causes.length) throw new Error(causes.join('\n'));
  }
}

async function currentTurn(proxy, threadId) {
  let cursor, page;
  do {
    const params = { threadId, sortDirection: 'desc', itemsView: 'notLoaded' };
    if (cursor) params.cursor = cursor;
    page = await proxy.rpc('thread/turns/list', params);
    const current = page.data.find(turn => turn.status === 'inProgress');
    if (current) return current;
    cursor = page.nextCursor;
  } while (cursor);
  throw new Error('Public Codex active thread ' + threadId + ' returned no in-progress turn identity after cursor exhaustion: ' + JSON.stringify(page));
}

async function deliver(proxy, threadId, text) {
  let { thread } = await proxy.rpc('thread/read', { threadId, includeTurns: false });
  if (thread.status.type === 'notLoaded') ({ thread } = await proxy.rpc('thread/resume', { threadId }));
  const input = [{ type: 'text', text }];
  let method, result;
  if (thread.status.type === 'active') {
    const current = await currentTurn(proxy, threadId);
    method = 'turn/steer';
    result = await proxy.rpc(method, { threadId, input, expectedTurnId: current.id });
  } else {
    method = 'turn/start';
    result = await proxy.rpc(method, { threadId, input });
  }
  record({ type: 'codexInboxAdmission', threadId, method, result });
}

const [threadId, pointer] = process.argv.slice(2);
if (!threadId || pointer === undefined) {
  process.stderr.write('usage: codex-inbox-wake.mjs THREAD INBOX_POINTER\n');
  process.exitCode = 2;
} else {
  const proxy = new PublicProxy();
  const cancel = signal => {
    record({ type: 'codexProxyCancellation', signal });
    proxy.child.kill(signal);
  };
  const interrupt = () => cancel('SIGINT');
  const terminate = () => cancel('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  try {
    await proxy.connect();
    await deliver(proxy, threadId, pointer);
  } catch (error) {
    process.stderr.write(String(error.stack || error) + '\n');
    process.exitCode = 1;
  } finally {
    try { await proxy.close(); }
    catch (error) { process.stderr.write(String(error.stack || error) + '\n'); process.exitCode = 1; }
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
  }
}
