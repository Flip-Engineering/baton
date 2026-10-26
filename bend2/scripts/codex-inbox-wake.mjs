#!/usr/bin/env node
// Deliver a committed inbox pointer through the public managed Codex lifecycle.
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function record(value) {
  const stream = process.argv[2] === '--input-witness' ? process.stderr : process.stdout;
  stream.write(JSON.stringify(value) + '\n');
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
        'item/started', 'item/agentMessage/delta', 'item/plan/delta',
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

async function deliver(proxy, threadId, text, refresh) {
  let { thread } = await proxy.rpc('thread/read', { threadId, includeTurns: false });
  if (thread.status.type === 'notLoaded') ({ thread } = await proxy.rpc('thread/resume', { threadId }));
  let method, result;
  if (thread.status.type === 'active') {
    const current = await currentTurn(proxy, threadId);
    method = 'turn/steer';
    if (refresh) text = await refresh(thread.status.type);
    if (text === null) return;
    result = await proxy.rpc(method, { threadId, input: [{ type: 'text', text }], expectedTurnId: current.id });
  } else {
    method = 'turn/start';
    if (refresh) text = await refresh(thread.status.type);
    if (text === null) return;
    result = await proxy.rpc(method, { threadId, input: [{ type: 'text', text }] });
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

async function reportTurn(executable, database, session, threadId, turn, completedItems) {
  const id = 'codex-inbox-turn:' + session + ':' + threadId + ':' + turn.id;
  const body = { type: 'codex-inbox-turn-settled', session, threadId, turn, completedItems };
  const child = spawn(executable, [database, 'report-file', id, session, '-'],
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
  record({ type: 'codexInboxTurnReport', id, session, threadId, ...exit, output,
    ...(writeError ? { writeError: String(writeError) } : {}) });
  if (writeError || exit.code !== 0 || exit.signal) {
    throw new Error('Baton parent/operator terminal notification failed: ' +
      JSON.stringify({ id, ...exit, output }), { cause: writeError });
  }
}

async function openInbox(executable, database, session, threadId) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(database);
  const query = `SELECT s.native,s.parent,
    EXISTS(SELECT 1 FROM session_stops WHERE session=s.id) AS stopped,
    (SELECT count(*) FROM messages WHERE recipient=s.id AND receipt IS NULL) AS pendingCount,
    (SELECT max(seq) FROM messages WHERE recipient=s.id) AS inputSeq,
    (SELECT count(*) FROM messages WHERE recipient=s.id AND receipt IS NOT NULL) AS handledCount,
    (SELECT max(m.seq) FROM messages m WHERE m.recipient=s.id AND
      (m.kind IN ('task','guidance','recovery','task-assignment','task-continuation','completion-confirmed','question') OR
       EXISTS(SELECT 1 FROM session_roles r WHERE r.session=m.sender AND r.role='operator'))) AS controlSeq,
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
    waitForDatabase() { return coordinatorCommand(executable, database, ['session', session]); },
    claimed(row) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='codex_inbox_wakes'").get()) return false;
      const claim = db.prepare('SELECT native,cause FROM codex_inbox_wakes WHERE session=?').get(session);
      if (!claim || claim.native !== threadId) return false;
      try {
        const inputSeq = JSON.parse(claim.cause).inputSeq;
        return !Number.isInteger(inputSeq) || inputSeq >= row.inputSeq;
      } catch { return true; }
    },
    claim() {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec(`CREATE TABLE IF NOT EXISTS codex_inbox_wakes(session TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id),
          native TEXT NOT NULL,token TEXT NOT NULL,cause TEXT NOT NULL DEFAULT '');
          CREATE TRIGGER IF NOT EXISTS codex_inbox_wake_receipt AFTER UPDATE OF receipt ON messages
          WHEN OLD.receipt IS NULL AND NEW.receipt IS NOT NULL BEGIN
          DELETE FROM codex_inbox_wakes WHERE session=NEW.recipient;END;`);
        const current = this.read();
        if (current.stopped || !current.pendingCount || this.claimed(current)) {
          db.exec('COMMIT');
          return null;
        }
        const token = randomBytes(16).toString('hex');
        db.prepare(`INSERT INTO codex_inbox_wakes(session,native,token,cause) VALUES(?,?,?,?)
          ON CONFLICT(session) DO UPDATE SET native=excluded.native,token=excluded.token,cause=excluded.cause`)
          .run(session, threadId, token, JSON.stringify({ inputSeq: current.inputSeq }));
        db.exec('COMMIT');
        return { token, row: current };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    async admitted(token, result) {
      const turnId = result?.turnId ?? result?.turn?.id;
      if (!token || !turnId) return;
      for (;;) {
        try {
          db.prepare(`UPDATE codex_inbox_wakes SET cause=json_set(cause,'$.turnId',?)
            WHERE session=? AND native=? AND token=? AND json_valid(cause)`)
            .run(turnId, session, threadId, token);
          return;
        } catch (error) {
          if (!databaseBusy(error)) throw error;
          record({ type: 'codexInboxDatabaseBusy', session, threadId,
            operation: 'admitted', errcode: error.errcode, cause: error.message });
          await coordinatorCommand(executable, database, ['session', session]);
        }
      }
    },
    refresh(token, status) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = this.read();
        let claim;
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='codex_inbox_wakes'").get()) {
          claim = db.prepare('SELECT token,native,cause FROM codex_inbox_wakes WHERE session=?').get(session);
        }
        let retained = row.stopped || !row.pendingCount ||
          (token && (!claim || claim.token !== token || claim.native !== threadId));
        let metadata;
        try { metadata = JSON.parse(claim?.cause); } catch {}
        if (metadata?.turnId) retained ||= row.inputSeq <= metadata.inputSeq ||
          (status === 'active' && row.controlSeq <= metadata.inputSeq && !metadata.cause);
        if (!retained && claim && Number.isInteger(metadata?.inputSeq)) {
          db.prepare("UPDATE codex_inbox_wakes SET cause=json_remove(json_set(cause,'$.inputSeq',?),'$.cause') WHERE session=? AND token=?")
            .run(row.inputSeq, session, claim.token);
        }
        db.exec('COMMIT');
        if (retained) {
          record({ type: 'codexInboxCoalesced', session, threadId, stopped: Boolean(row.stopped),
            pendingCount: row.pendingCount, inputSeq: row.inputSeq, status });
          return null;
        }
        return { row, token: claim?.token };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    failed(row, cause, turnId) {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='codex_inbox_wakes'").get()) {
        db.prepare(`UPDATE codex_inbox_wakes SET cause=CASE WHEN json_valid(cause)
          THEN json_set(cause,'$.cause',?) ELSE json_object('inputSeq',?,'cause',?) END
          WHERE session=? AND native=? AND (? IS NULL OR CASE WHEN json_valid(cause)
            THEN json_extract(cause,'$.turnId') IS NULL OR json_extract(cause,'$.turnId')=? ELSE 1 END)`)
          .run(cause, row.inputSeq, cause, session, threadId, turnId ?? null, turnId ?? null);
      }
    },
    pointer(row) {
      return 'Baton input is pending.\n' + JSON.stringify({ database, recipient: session, message: row.message, pendingCount: row.pendingCount }) +
        '\nUse baton inbox to read all complete owed input. Use baton read MESSAGE_ID... for selected complete bodies and ' +
        'baton send TARGET --kind KIND --text TEXT and TARGET --kind KIND --file PATH for independent messages. ' +
        'Use baton help ACTION for named arguments and context overrides. Successful recipient turns record handling of their complete inputs. ' +
        'Use baton completion-request --text SUMMARY when the assignment is ready, and baton completion-confirmed --to PLAYER to confirm a child\'s current request. ' +
        'Select an explicit context with baton DATABASE as RECIPIENT ACTION. Coordinator executable/database argv: ' +
        JSON.stringify([executable, database]) + '. ' +
        'Carry out authorized work and read your inbox as work continues. Direct operator instructions and explicit stops remain effective.';
    },
  };
}

function databaseBusy(error) {
  return Number.isInteger(error?.errcode) && (error.errcode & 255) === 5;
}

async function retainFailure(inbox, row, cause, turnId) {
  for (;;) {
    try { inbox.failed(row, cause, turnId); return; }
    catch (error) {
      if (!databaseBusy(error)) throw error;
      await inbox.waitForDatabase();
    }
  }
}
// One committed-change notification source for a committed inbox read. The
// first line confirms the subscription started; every later line is one
// committed database change. close() tears the child down and reports an
// abnormal exit, prefixing the failure that was already being propagated.
function committedChanges(executable, database, events) {
  const changes = spawn(executable, [database, 'ui-subscribe', '0', '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = new Promise(resolve => changes.once('close', (code, signal) => resolve({ code, signal })));
  const lines = createInterface({ input: changes.stdout });
  let ready = false, closing = false;
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
  const close = async failure => {
    closing = true;
    lines.close();
    changes.kill('SIGTERM');
    const exit = await exited;
    if (exit.code !== 0 && exit.signal !== 'SIGTERM') {
      throw new Error((failure ? String(failure.stack || failure) + '\n' : '') + 'Baton inbox change subscription exit: ' + JSON.stringify(exit));
    }
  };
  return { readiness, close };
}

// Inbox reads wait out database contention through the coordinator's
// ordinary session read: main.bend dispatches it through read_command to
// host SQLite opened read-only with the existing busy handler, which waits
// through lock contention without an attempt or time cap and performs no
// schema installation or data mutation. A writer holding the lock - also one
// committing an empty transaction - releases before that read returns; the
// Node inbox read then rereads the current native, stop and pending state.
// A missing session or a genuine command error remains an error.
async function readInbox(inbox, session, threadId) {
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
      await inbox.waitForDatabase();
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
  const completedItems = new Map();
  const reportedTurns = new Set();
  const observedTurns = new Set();
  let notificationFailure;
  const notifyFailure = async error => {
    try { await reportFailure(executable, database, session, threadId, error); }
    catch (error) { notificationFailure = error; throw error; }
  };
  const claimed = async row => {
    for (;;) {
      try { return inbox.claimed(row); }
      catch (error) {
        if (!databaseBusy(error)) throw error;
        record({ type: 'codexInboxDatabaseBusy', session, threadId, operation: 'claimed',
          errcode: error.errcode, cause: error.message });
        await coordinatorCommand(executable, database, ['session', session]);
      }
    }
  };
  proxy.onNotification = message => {
    if (message.error) events.push(message);
    else if (message.params?.threadId === threadId && message.method === 'item/completed') {
      const { turnId, item } = message.params;
      if (turnId && item) {
        if (!reportedTurns.has(turnId)) observedTurns.add(turnId);
        let items = completedItems.get(turnId);
        if (!items) completedItems.set(turnId, items = new Map());
        items.set(item.id, item);
        record({ type: 'codexInboxItemCompleted', session, ...message.params });
      }
    } else if (message.params?.threadId === threadId && message.method === 'turn/completed') {
      if (!reportedTurns.has(message.params.turn.id)) observedTurns.add(message.params.turn.id);
      events.push(message);
    } else if (message.params?.threadId === threadId && message.method === 'turn/started') {
      observedTurns.add(message.params.turn.id);
      events.push(message);
    } else if (message.params?.threadId === threadId && message.method === 'thread/status/changed' &&
      message.params.status.type !== 'active') events.push(message);
  };
  const subscription = committedChanges(executable, database, events);
  let failure;
  try {
    await subscription.readiness;
    await proxy.connect();
    let row = await readInbox(inbox, session, threadId);
    if (row.stopped) {
      record({ type: 'codexInboxReleased', session, threadId, stopped: true, pendingCount: row.pendingCount });
      return;
    }
    await proxy.rpc('thread/resume', { threadId });
    record({ type: 'codexInboxSubscribed', session, threadId });
    let previous = row;
    let event = { initial: true };
    for (;;) {
      if (event.error) throw event.error;
      row = await readInbox(inbox, session, threadId);
      if (event.method === 'turn/completed') {
        const turn = event.params.turn;
        record({ type: 'codexInboxTurnSettled', session, threadId, turnId: turn.id, status: turn.status, turn });
        if (turn.status !== 'completed') await retainFailure(inbox, row, JSON.stringify(turn), turn.id);
        if (!reportedTurns.has(turn.id)) {
          const items = [...(completedItems.get(turn.id)?.values() ?? [])];
          await reportTurn(executable, database, session, threadId, turn, items);
          await coordinatorCommand(executable, database,
            ['settle-agent-input', session, threadId, turn.id, turn.status]);
          reportedTurns.add(turn.id);
          completedItems.delete(turn.id);
        }
        observedTurns.delete(turn.id);
        if (turn.status !== 'completed') record({ type: 'codexInboxTurnRetained', session, threadId, turn });
        row = await readInbox(inbox, session, threadId);
      }
      if (row.stopped) {
        record({ type: 'codexInboxReleased', session, threadId, stopped: true, pendingCount: row.pendingCount });
        return;
      }
      const { thread } = await proxy.rpc('thread/read', { threadId, includeTurns: false });
      if (thread.status.type === 'active' && !observedTurns.size) observedTurns.add((await currentTurn(proxy, threadId)).id);
      if (!row.pendingCount && thread.status.type !== 'active' && !observedTurns.size) {
        record({ type: 'codexInboxReleased', session, threadId, stopped: false, pendingCount: 0 });
        return;
      }
      const recipientProgress = row.handledCount !== previous.handledCount;
      const coordinatorInput = row.controlSeq !== previous.controlSeq;
      previous = row;
      let freshThread = false;
      if (event.initial && thread.status.type === 'idle' && row.pendingCount) {
        const turns = await proxy.rpc('thread/turns/list', { threadId, sortDirection: 'desc', itemsView: 'notLoaded' });
        freshThread = !await claimed(row);
        if (!freshThread) record({ type: 'codexInboxTurnRetained', session, threadId, turn: turns.data[0] });
      }
      const admit = row.pendingCount && (freshThread || recipientProgress || coordinatorInput ||
        (thread.status.type === 'idle' && !await claimed(row)));
      if (admit) {
        row = await readInbox(inbox, session, threadId);
        if (!row.stopped && row.pendingCount && !await claimed(row)) {
          let admission;
          try {
            for (;;) {
              try { admission = inbox.claim(); break; }
              catch (error) {
                if (!databaseBusy(error)) throw error;
                record({ type: 'codexInboxDatabaseBusy', session, threadId, operation: 'claim',
                  errcode: error.errcode, cause: error.message });
                await coordinatorCommand(executable, database, ['session', session]);
              }
            }
            if (!admission) { event = {}; continue; }
            const result = await deliver(proxy, threadId, inbox.pointer(admission.row), async status => {
              for (;;) {
                try {
                  const current = inbox.refresh(admission.token, status);
                  return current ? inbox.pointer(current.row) : null;
                } catch (error) { if (!databaseBusy(error)) throw error; await inbox.waitForDatabase(); }
              }
            });
            await inbox.admitted(admission.token, result);
            const turnId = result?.turnId ?? result?.turn?.id;
            if (turnId && !reportedTurns.has(turnId)) observedTurns.add(turnId);
          } catch (error) {
            if (proxy.readerError) throw error;
            await retainFailure(inbox, row, String(error.stack || error));
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
    try {
      const row = await readInbox(inbox, session, threadId);
      await retainFailure(inbox, row, String(error.stack || error));
    } catch (retentionError) {
      failure = new Error(String(error.stack || error) + '\nAdmission failure custody could not be updated: ' +
        String(retentionError.stack || retentionError), { cause: error });
    }
    try { if (error !== notificationFailure) await notifyFailure(failure); }
    catch (error) { failure = error; }
    throw failure;
  } finally {
    await subscription.close(failure);
  }
}

const args = process.argv.slice(2);
const inputWitness = args[0] === '--input-witness';
const managed = args[0] === '--session' || args[0] === '--follow';
const [mode, executable, database, session, native, message, claimToken] = managed ? args : [];
const [threadId, pointer] = inputWitness ? [args[1], undefined] : managed ? [native, undefined] : args;
if (!threadId || (managed ? !executable || !database || !session || (mode === '--session' && message === undefined) : !inputWitness && pointer === undefined)) {
  process.stderr.write('usage: codex-inbox-wake.mjs THREAD INBOX_POINTER\n       codex-inbox-wake.mjs --session EXE DATABASE PLAYER THREAD MESSAGE\n       codex-inbox-wake.mjs --follow EXE DATABASE PLAYER THREAD\n       codex-inbox-wake.mjs --input-witness THREAD\n');
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
    if (inputWitness) {
      proxy = new PublicProxy();
      await proxy.connect();
      const { thread } = await proxy.rpc('thread/read', { threadId, includeTurns: false });
      const active = thread.status.type === 'active';
      const turn = active ? await currentTurn(proxy, threadId) : null;
      process.stdout.write(JSON.stringify({ threadId: thread.id, turnId: turn?.id ?? null, active }) + '\n');
    } else if (managed) {
      inbox = await openInbox(executable, database, session, threadId);
      if (mode === '--follow') {
        proxy = new PublicProxy();
        await follow(proxy, executable, database, session, threadId, inbox);
      } else {
        // The one-shot delivery keeps the local read as its fast path and
        // rereads through the coordinator on database contention: the native
        // reads wait through the lock in the host busy handler, so a writer
        // that releases its lock without a committed-change notification
        // still unblocks the delivery, which then admits the exact committed
        // input. Explicit stops, an empty inbox, a changed native conversation
        // and command failures keep their recorded outcomes.
        const row = await readInbox(inbox, session, threadId);
        if (row.stopped || !row.pendingCount) {
          record({ type: 'codexInboxRetained', session, threadId, stopped: Boolean(row.stopped), pendingCount: row.pendingCount });
        } else {
          proxy = new PublicProxy();
          await proxy.connect();
          let token;
          const result = await deliver(proxy, threadId, inbox.pointer(row), async status => {
            for (;;) {
              try {
                const current = inbox.refresh(claimToken, status);
                if (!current) return null;
                token = current.token;
                return inbox.pointer(current.row);
              } catch (error) {
                if (!databaseBusy(error)) throw error;
                await coordinatorCommand(executable, database, ['session', session]);
              }
            }
          });
          await inbox.admitted(token, result);
        }
      }
    } else {
      let pending, coordinator, row;
      if (pointer.startsWith('Baton input is pending.\n')) {
        pending = JSON.parse(pointer.split('\n')[1]);
        const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
        const installed = resolve(root, 'bin/baton2');
        coordinator = existsSync(installed) ? installed : resolve(root, '.scratch/bend2/baton2');
        inbox = await openInbox(coordinator, pending.database, pending.recipient, threadId);
        row = await readInbox(inbox, pending.recipient, threadId);
      }
      if (row && (row.stopped || !row.pendingCount)) {
        record({ type: 'codexInboxRetained', session: pending.recipient, threadId,
          stopped: Boolean(row.stopped), pendingCount: row.pendingCount });
      } else {
        proxy = new PublicProxy();
        await proxy.connect();
        let token;
        const result = await deliver(proxy, threadId, pointer, inbox ? async status => {
          for (;;) {
            try {
              const current = inbox.refresh(pending.claimToken, status);
              if (!current) return null;
              token = current.token;
              const newline = pointer.indexOf('\n', pointer.indexOf('\n') + 1);
              const { claimToken: custodyToken, ...notice } = pending;
              return 'Baton input is pending.\n' + JSON.stringify({ ...notice, pendingCount: current.row.pendingCount }) +
                (newline < 0 ? '' : pointer.slice(newline));
            } catch (error) {
              if (!databaseBusy(error)) throw error;
              record({ type: 'codexInboxDatabaseBusy', session: pending.recipient, threadId,
                operation: 'refresh', errcode: error.errcode, cause: error.message });
              await coordinatorCommand(coordinator, pending.database, ['session', pending.recipient]);
            }
          }
        } : undefined);
        if (inbox) await inbox.admitted(token, result);
      }
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
