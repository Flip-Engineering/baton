#!/usr/bin/env node
// Deliver a committed inbox pointer through the public managed Codex lifecycle.
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { createInterface } from 'node:readline';

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
    this.responses = new Map();
    this.onNotification = () => {};
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
    this.reader = this.readMessages();
    await this.rpc('initialize', {
      clientInfo: { name: 'baton_inbox_wake', title: 'Baton inbox wake', version: '1' },
      capabilities: { experimentalApi: true, optOutNotificationMethods: [
        'item/started', 'item/completed', 'item/agentMessage/delta', 'item/plan/delta',
        'item/reasoning/summaryTextDelta', 'item/reasoning/summaryPartAdded',
        'item/reasoning/textDelta', 'item/commandExecution/outputDelta',
        'turn/diff/updated', 'turn/plan/updated', 'thread/tokenUsage/updated',
      ] },
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
    if (this.readerError) throw this.readerError;
    const id = ++this.sequence;
    const response = new Promise((resolve, reject) => this.responses.set(id, { resolve, reject }));
    try { this.send({ id, method, params }); }
    catch (error) { this.responses.delete(id); throw error; }
    const message = await response;
    if (message.error) throw new Error('Public Codex ' + method + ' refused input: ' + JSON.stringify(message));
    if (!Object.hasOwn(message, 'result')) throw new Error('Public Codex ' + method + ' returned no result: ' + JSON.stringify(message));
    return message.result;
  }

  async readMessages() {
    try {
      for (;;) {
        const message = await this.message();
        if (message.method) this.onNotification(message);
        else {
          const response = this.responses.get(message.id);
          if (response) {
            this.responses.delete(message.id);
            response.resolve(message);
          }
        }
      }
    } catch (error) {
      if (!this.closing) {
        this.readerError = error;
        this.onNotification({ error });
      }
      for (const response of this.responses.values()) response.reject(error);
      this.responses.clear();
    }
  }

  async close() {
    let closeError;
    this.closing = true;
    try {
      try {
        if (this.upgraded && !this.child.stdin.destroyed) this.frame(Buffer.alloc(0), 8);
      } finally {
        this.child.stdin.end();
      }
      if (this.reader) await this.reader;
      else for (;;) { if ((await this.stream.next()).done) break; }
    } catch (error) {
      closeError = error;
    }
    const exit = await this.closed;
    record({ type: 'codexProxyExit', ...exit });
    const causes = [closeError, this.spawnError, this.writeError, this.readerError].filter(Boolean).map(error => String(error.stack || error));
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
  return result;
}

class Events {
  constructor() { this.values = []; }
  push(value) {
    if (this.waiter) { const resolve = this.waiter; this.waiter = null; resolve(value); }
    else if (!value.change || !this.values.some(event => event.change)) this.values.push(value);
  }
  next() {
    if (this.values.length) return Promise.resolve(this.values.shift());
    return new Promise(resolve => { this.waiter = resolve; });
  }
  async committed() {
    const deferred = [];
    try {
      for (;;) {
        const event = await this.next();
        if (event.error) throw event.error;
        if (event.change) return;
        deferred.push(event);
      }
    } finally {
      this.values = deferred.concat(this.values);
    }
  }
}

async function reportFailure(executable, database, session, threadId, error) {
  const body = { type: 'codex-inbox-continuation-failed', session, threadId, cause: String(error.stack || error) };
  record(body);
  const child = spawn(executable, [database, 'report-file', 'codex-inbox-failure:' + randomBytes(16).toString('hex'), session, '-'],
    { stdio: ['pipe', 'pipe', 'inherit'] });
  let output = '', writeError;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', text => { output += text; });
  child.stdin.on('error', error => { writeError = error; });
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
    child.stdin.end(JSON.stringify(body));
  });
  record({ type: 'codexInboxFailureReport', session, threadId, ...exit, output, ...(writeError ? { writeError: String(writeError) } : {}) });
  if (writeError || exit.code !== 0 || exit.signal) {
    throw new Error(body.cause + '\nBaton parent/operator failure notification failed: ' + JSON.stringify({ ...exit, output }), { cause: writeError });
  }
}

async function openInbox(executable, database, session, threadId) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(database, { readOnly: true });
  const query = `SELECT s.native,s.parent,
    EXISTS(SELECT 1 FROM session_stops WHERE session=s.id) AS stopped,
    (SELECT count(*) FROM messages WHERE recipient=s.id AND receipt IS NULL) AS pendingCount,
    (SELECT max(seq) FROM messages WHERE recipient=s.id) AS inputSeq,
    (SELECT id FROM messages WHERE recipient=s.id AND receipt IS NULL ORDER BY seq LIMIT 1) AS message
    FROM sessions s WHERE s.id=?`;
  let state;
  return {
    read() {
      state ??= db.prepare(query);
      const row = state.get(session);
      if (!row) throw new Error('Baton session is not recorded: ' + session);
      if (row.native !== threadId) throw new Error('Baton session now records another native conversation: ' + JSON.stringify({ session, native: row.native }));
      return row;
    },
    close() { db.close(); },
    pointer(row) {
      return 'Baton input is pending.\n' + JSON.stringify({ database, recipient: session, message: row.message, pendingCount: row.pendingCount }) +
        '\nRead all owed input with baton2 DATABASE inbox RECIPIENT. Read complete stored bodies with baton2 DATABASE delivery MESSAGE. ' +
        'Handle the work in this continuation. Acknowledge each handled own message with baton2 DATABASE ack MESSAGE RECIPIENT RECEIPT. ' +
        'Read your inbox again before ending the turn. Admission is separate from handling and acknowledgement. ' +
        'A native turn ending does not finish your task. Continue your assignment until its immediate coordinator confirms completion. ' +
        (row.parent ? 'When the task is ready, send one completion-request message from ' + session + ' to ' + row.parent +
          ' with your result and remaining work. Continue useful work while it is reviewed. The coordinator sends guidance or completion-confirmed with the request ID as its body. ' :
          'This parentless session follows the operator task. ') +
        'Coordinator executable/database argv: ' + JSON.stringify([executable, database]) +
        '. Use message REQUEST_ID SESSION PARENT completion-request SUMMARY and acknowledge each handled own input separately. Explicit operator stops remain effective.';
    },
  };
}

function databaseBusy(error) {
  return Number.isInteger(error?.errcode) && (error.errcode & 255) === 5;
}

function recoverableTurn(turn) {
  if (turn?.status !== 'failed') return false;
  const info = turn.error?.codexErrorInfo;
  if (info === 'serverOverloaded' || info === 'internalServerError') return true;
  for (const kind of ['httpConnectionFailed', 'responseStreamConnectionFailed',
    'responseStreamDisconnected', 'responseTooManyFailedAttempts']) {
    if (info && Object.hasOwn(info, kind)) {
      const status = info[kind]?.httpStatusCode;
      return status == null || status === 429 || (status >= 500 && status <= 599);
    }
  }
  return false;
}

async function readCommittedInbox(inbox, events, session, threadId) {
  let waiting = false;
  for (;;) {
    try {
      const row = inbox.read();
      if (waiting) record({ type: 'codexInboxDatabaseReady', session, threadId });
      return row;
    } catch (error) {
      if (!databaseBusy(error)) throw error;
      if (!waiting) record({ type: 'codexInboxDatabaseBusy', session, threadId,
        errcode: error.errcode, cause: error.message });
      waiting = true;
      await events.committed();
    }
  }
}

async function coordinatorCommand(executable, database, args) {
  const child = spawn(executable, [database, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', diagnostic = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', part => { output += part; });
  child.stderr.on('data', part => { diagnostic += part; });
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  if (exit.code !== 0 || exit.signal) throw new Error('Baton coordinator command failed: ' + JSON.stringify({ args, ...exit, output, diagnostic }));
  return JSON.parse(output);
}

async function follow(proxy, executable, database, session, threadId, inbox) {
  const events = new Events();
  let notificationFailure;
  const notifyFailure = async error => {
    try { await reportFailure(executable, database, session, threadId, error); }
    catch (error) { notificationFailure = error; throw error; }
  };
  let taskInput, taskOpen;
  const unconfirmedTask = async row => {
    if (taskInput !== row.inputSeq || taskOpen === undefined) {
      const state = await coordinatorCommand(executable, database, ['session', session]);
      taskOpen = Boolean(state.taskCompletion?.open);
      taskInput = row.inputSeq;
      if (taskOpen && !row.pendingCount) record({ type: 'codexInboxTaskAwaitingConfirmation',
        session, threadId, taskCompletion: state.taskCompletion });
    }
    return taskOpen;
  };
  const continueTask = async turnId => {
    const state = await coordinatorCommand(executable, database, ['continue-task', session, turnId]);
    taskOpen = Boolean(state.taskCompletion?.open);
    taskInput = undefined;
    record({ type: 'codexInboxTaskContinuation', session, threadId, turnId,
      continuationId: state.continuationId, taskCompletion: state.taskCompletion });
  };
  proxy.onNotification = message => {
    if (message.error) events.push(message);
    else if (message.params?.threadId === threadId && message.method === 'turn/completed') {
      const { id, status, error } = message.params.turn;
      events.push({ method: message.method, params: { threadId, turn: { id, status, ...(error ? { error } : {}) } } });
    } else if (message.params?.threadId === threadId && message.method === 'thread/status/changed' &&
      message.params.status.type !== 'active') events.push({ method: message.method, params: message.params });
  };
  const changes = spawn(executable, [database, 'ui-subscribe', '0', '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = new Promise(resolve => changes.once('close', (code, signal) => resolve({ code, signal })));
  const lines = createInterface({ input: changes.stdout });
  let ready = false, closing = false, failure;
  const readiness = new Promise((resolve, reject) => {
    changes.once('error', error => { reject(error); events.push({ error }); });
    lines.on('line', line => {
      try {
        const notice = JSON.parse(line);
        if (!ready) { ready = true; resolve(); }
        else events.push({ change: notice });
      } catch (error) { reject(error); events.push({ error }); }
    });
    changes.once('close', (code, signal) => {
      if (!closing) {
        const error = new Error('Baton inbox change subscription ended: ' + JSON.stringify({ code, signal }));
        reject(error); events.push({ error });
      }
    });
  });
  try {
    await readiness;
    await proxy.connect();
    let row = await readCommittedInbox(inbox, events, session, threadId);
    if (row.stopped || (!row.pendingCount && !await unconfirmedTask(row))) return;
    await proxy.rpc('thread/resume', { threadId });
    record({ type: 'codexInboxSubscribed', session, threadId });
    let lastAdmission, lastInput = row.inputSeq;
    let event = { initial: true };
    for (;;) {
      if (event.error) throw event.error;
      row = await readCommittedInbox(inbox, events, session, threadId);
      if (event.method === 'turn/completed') {
        record({ type: 'codexInboxTurnSettled', session, threadId, turnId: event.params.turn.id,
          status: event.params.turn.status, ...(event.params.turn.error ? { error: event.params.turn.error } : {}) });
        if (event.params.turn.status !== 'completed') {
          await notifyFailure(new Error('Managed Codex turn settled with unfinished work: ' + JSON.stringify(event.params.turn)));
          if (!recoverableTurn(event.params.turn)) {
            lastAdmission = JSON.stringify([event.params.turn.id, row.inputSeq]);
            record({ type: 'codexInboxTurnRetained', session, threadId, turn: event.params.turn });
          }
        }
      }
      if (event.method === 'turn/completed' && !row.stopped &&
        (event.params.turn.status === 'completed' || recoverableTurn(event.params.turn))) {
        await continueTask(event.params.turn.id);
        row = await readCommittedInbox(inbox, events, session, threadId);
      }
      if (row.stopped || (!row.pendingCount && !await unconfirmedTask(row))) {
        record({ type: 'codexInboxReleased', session, threadId, stopped: Boolean(row.stopped), pendingCount: row.pendingCount });
        return;
      }
      if (!row.pendingCount) {
        if (event.initial) {
          const { thread } = await proxy.rpc('thread/read', { threadId, includeTurns: false });
          if (thread.status.type === 'idle') {
            const turns = await proxy.rpc('thread/turns/list', { threadId, sortDirection: 'desc', itemsView: 'notLoaded' });
            const latest = turns.data[0];
            if (latest?.status === 'completed' || recoverableTurn(latest)) {
              await continueTask(latest.id);
              row = await readCommittedInbox(inbox, events, session, threadId);
              if (row.pendingCount) continue;
            }
          }
        }
        event = await events.next();
        continue;
      }
      if (event.method === 'turn/completed' && event.params.turn.status !== 'completed' &&
        !recoverableTurn(event.params.turn)) {
        event = await events.next();
        continue;
      }
      if (event.change && row.inputSeq === lastInput) { event = await events.next(); continue; }
      lastInput = row.inputSeq;
      const { thread } = await proxy.rpc('thread/read', { threadId, includeTurns: false });
      if (thread.status.type === 'idle') {
        const turns = await proxy.rpc('thread/turns/list', { threadId, sortDirection: 'desc', itemsView: 'notLoaded' });
        const latest = turns.data[0];
        const settlement = JSON.stringify([latest?.id ?? null, row.inputSeq]);
        if (event.initial && (latest?.status === 'interrupted' ||
          (latest?.status === 'failed' && !recoverableTurn(latest)))) {
          lastAdmission = settlement;
          record({ type: 'codexInboxTurnRetained', session, threadId, turn: latest });
        } else if (settlement !== lastAdmission) {
          row = await readCommittedInbox(inbox, events, session, threadId);
          if (!row.stopped && row.pendingCount) {
            lastAdmission = settlement;
            try { await deliver(proxy, threadId, inbox.pointer(row)); }
            catch (error) {
              if (proxy.readerError) throw error;
              await notifyFailure(error);
            }
          }
        }
      } else if (thread.status.type === 'active' && event.method === 'turn/completed') {
        row = await readCommittedInbox(inbox, events, session, threadId);
        if (!row.stopped && row.pendingCount) {
          try { await deliver(proxy, threadId, inbox.pointer(row)); }
          catch (error) {
            if (proxy.readerError) throw error;
            await notifyFailure(error);
          }
        }
      } else if (thread.status.type === 'systemError' || thread.status.type === 'notLoaded') {
        throw new Error('Managed Codex inbox continuation cannot run: ' + JSON.stringify(thread.status));
      }
      event = await events.next();
    }
  } catch (error) {
    failure = error;
    try { if (error !== notificationFailure) await notifyFailure(error); }
    catch (error) { failure = error; }
    throw failure;
  } finally {
    closing = true;
    lines.close();
    changes.kill('SIGTERM');
    const exit = await exited;
    if (exit.code !== 0 && exit.signal !== 'SIGTERM') {
      throw new Error((failure ? String(failure.stack || failure) + '\n' : '') + 'Baton inbox change subscription exit: ' + JSON.stringify(exit));
    }
  }
}

const args = process.argv.slice(2);
const managed = args[0] === '--session' || args[0] === '--follow';
const [mode, executable, database, session, native, message] = managed ? args : [];
const [threadId, pointer] = managed ? [native, undefined] : args;
if (!threadId || (managed ? !executable || !database || !session || (mode === '--session' && message === undefined) : pointer === undefined)) {
  process.stderr.write('usage: codex-inbox-wake.mjs THREAD INBOX_POINTER\n       codex-inbox-wake.mjs --session EXE DATABASE PLAYER THREAD MESSAGE\n       codex-inbox-wake.mjs --follow EXE DATABASE PLAYER THREAD\n');
  process.exitCode = 2;
} else {
  let proxy;
  let inbox;
  const cancel = signal => {
    record({ type: 'codexProxyCancellation', signal });
    proxy?.child.kill(signal);
  };
  const interrupt = () => cancel('SIGINT');
  const terminate = () => cancel('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  try {
    if (managed) {
      inbox = await openInbox(executable, database, session, threadId);
      if (mode === '--follow') {
        proxy = new PublicProxy();
        await follow(proxy, executable, database, session, threadId, inbox);
      } else {
        const row = inbox.read();
        if (row.stopped || !row.pendingCount) {
          record({ type: 'codexInboxRetained', session, threadId, stopped: Boolean(row.stopped), pendingCount: row.pendingCount });
        } else {
          proxy = new PublicProxy();
          await proxy.connect();
          await deliver(proxy, threadId, inbox.pointer(row));
        }
      }
    } else {
      proxy = new PublicProxy();
      await proxy.connect();
      await deliver(proxy, threadId, pointer);
    }
  } catch (error) {
    process.stderr.write(String(error.stack || error) + '\n');
    process.exitCode = 1;
  } finally {
    inbox?.close();
    try { if (proxy) await proxy.close(); }
    catch (error) { process.stderr.write(String(error.stack || error) + '\n'); process.exitCode = 1; }
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
  }
}
