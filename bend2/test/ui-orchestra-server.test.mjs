import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createOrchestraServer } from '../ui/orchestra/server.mjs';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'baton-orchestra-ui-'));
  const databasePath = join(directory, 'orchestra.db');
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, parent TEXT, harness TEXT NOT NULL, model TEXT NOT NULL,
      effort TEXT NOT NULL, native TEXT NOT NULL DEFAULT '', observed_harness TEXT NOT NULL DEFAULT '',
      observed_model TEXT NOT NULL DEFAULT '', observed_effort TEXT NOT NULL DEFAULT '',
      workspace TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '', base TEXT NOT NULL DEFAULT '',
      endpoint TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE session_roles (session TEXT PRIMARY KEY, role TEXT NOT NULL);
    CREATE TABLE executions (session TEXT PRIMARY KEY, id TEXT, mode TEXT, phase TEXT, status TEXT);
    CREATE TABLE turns (id TEXT PRIMARY KEY, worker TEXT, event TEXT);
    CREATE TABLE messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT, sender TEXT, recipient TEXT,
      kind TEXT, body TEXT, receipt TEXT);
    CREATE TABLE session_stops (session TEXT PRIMARY KEY, id TEXT, outcome TEXT, attempt TEXT, report_id TEXT);
    CREATE TABLE ensembles (id TEXT PRIMARY KEY, owner TEXT, coupling TEXT);
    CREATE TABLE ensemble_members (ensemble TEXT, session TEXT);
    CREATE TABLE sections (ensemble TEXT, id TEXT, capability TEXT);
    CREATE TABLE section_members (ensemble TEXT, section TEXT, session TEXT);
    CREATE TABLE native_changes (
      change_id INTEGER PRIMARY KEY AUTOINCREMENT, recorded_at TEXT NOT NULL,
      entity TEXT NOT NULL, entity_id TEXT NOT NULL, session_id TEXT NOT NULL,
      operation TEXT NOT NULL, kind TEXT NOT NULL, summary TEXT NOT NULL
    );
    CREATE TRIGGER ui_execution_change AFTER UPDATE ON executions
    BEGIN
      INSERT INTO native_changes(recorded_at,entity,entity_id,session_id,operation,kind,summary)
      VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'),'execution',NEW.session,NEW.session,'update',
        'execution',NEW.phase || ' ' || NEW.status);
    END;
    CREATE TRIGGER ui_message_change AFTER INSERT ON messages
    BEGIN
      INSERT INTO native_changes(recorded_at,entity,entity_id,session_id,operation,kind,summary)
      VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'),'message',NEW.id,NEW.recipient,'insert',
        'message:' || NEW.kind,NEW.kind || ' from ' || NEW.sender);
    END;
    CREATE TRIGGER ui_receipt_change AFTER UPDATE OF receipt ON messages
    WHEN OLD.receipt IS NOT NEW.receipt
    BEGIN
      INSERT INTO native_changes(recorded_at,entity,entity_id,session_id,operation,kind,summary)
      VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'),'message',NEW.id,NEW.recipient,'update',
        'receipt','acknowledged');
    END;
    INSERT INTO sessions(id,parent,harness,model,effort,workspace,branch,base,endpoint)
      VALUES ('root',NULL,'codex','configured/root','high','/root','main','base',''),
             ('child','root','muse','configured/child','medium','/child','work','base','["node","endpoint"]'),
             ('grandchild','child','omp','configured/grandchild','high','/grandchild','nested','base',''),
             ('sibling','root','codex','configured/sibling','low','/sibling','other','base',''),
             ('external','sibling','codex','configured/external','low','/external','other','base','');
    INSERT INTO session_roles VALUES ('root','conductor'),('child','conductor'),('grandchild','player'),('sibling','player');
    INSERT INTO executions VALUES ('child','attempt-1','direct','running','');
    INSERT INTO messages(id,sender,recipient,kind,body) VALUES
      ('pending-1','root','child','task','pending input body');
    INSERT INTO ensembles VALUES ('shared-ensemble','external','tight');
    INSERT INTO ensemble_members VALUES ('shared-ensemble','child'),('shared-ensemble','external');
    INSERT INTO sections VALUES ('shared-ensemble','shared-section','fixture capability');
    INSERT INTO section_members VALUES ('shared-ensemble','shared-section','child'),
      ('shared-ensemble','shared-section','external'),
      ('shared-ensemble','shared-section','orphan');
    INSERT INTO ensemble_members VALUES ('shared-ensemble','orphan');
  `);
  db.close();
  return { directory, databasePath };
}

function commitNotifications(generation = 'owner-1') {
  const subscribers = new Set();
  return {
    subscribeCommittedChanges: async ({ onNotice }) => {
      const subscriber = { onNotice };
      subscribers.add(subscriber);
      return {
        generation,
        close: () => subscribers.delete(subscriber),
      };
    },
    committed: (cursor = '') => {
      for (const subscriber of subscribers) subscriber.onNotice({ kind: 'commit', cursor });
    },
    generationChanged: (next) => {
      for (const subscriber of subscribers) {
        subscriber.onNotice({ kind: 'generation', generation: next });
      }
    },
    lost: () => {
      for (const subscriber of subscribers) subscriber.onNotice({ kind: 'lost' });
    },
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', async () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('snapshot binds a selected subtree to the reader and preserves recorded unknowns', async (t) => {
  const f = fixture();
  const notifications = commitNotifications();
  const server = createOrchestraServer({ databasePath: f.databasePath, reader: 'root',
    subscribeCommittedChanges: notifications.subscribeCommittedChanges });
  t.after(async () => { await close(server); rmSync(f.directory, { recursive: true, force: true }); });
  const base = await listen(server);

  const page = await fetch(base, { redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.match(page.headers.get('location'), /^\/?\?api=http%3A%2F%2F127\.0\.0\.1%3A/);

  const response = await fetch(`${base}/orchestra/snapshot?subject=child&since=0`);
  assert.equal(response.status, 200);
  const snapshot = await response.json();
  assert.equal(snapshot.contractVersion, 1);
  assert.equal(snapshot.selection.rule, 'parent-owner-member-routes-v1');
  assert.deepEqual(snapshot.players.map((player) => player.id), ['child', 'grandchild']);
  assert.equal(snapshot.players[0].model, 'configured/child');
  assert.equal(snapshot.players[0].observedModel, '');
  assert.equal(snapshot.players[0].actualProcess, 'unknown');
  assert.equal(snapshot.players[0].liveReceiver, null);
  assert.equal(snapshot.players[0].endpointRegistered, true);
  assert.equal(snapshot.players[0].pendingCount, 1);
  assert.deepEqual(snapshot.ensembles[0].members, ['child']);
  assert.equal(snapshot.ensembles[0].owner, null);
  assert.deepEqual(snapshot.ensembles[0].sections[0].members, ['child']);

  const denied = await fetch(`${base}/orchestra/snapshot?subject=external&since=0`);
  assert.equal(denied.status, 403);
});

test('event endpoint stays unavailable when the canonical owner has no subscription source', async (t) => {
  const f = fixture();
  const server = createOrchestraServer({ databasePath: f.databasePath, reader: 'root' });
  t.after(async () => { await close(server); rmSync(f.directory, { recursive: true, force: true }); });
  const base = await listen(server);
  const response = await fetch(`${base}/orchestra/events?subject=root&since=0`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'native-owner-subscription-unavailable' });
});

test('SSE pumps committed rows from owner hints and replays by durable cursor after reconnect', async (t) => {
  const f = fixture();
  const notifications = commitNotifications();
  const server = createOrchestraServer({ databasePath: f.databasePath, reader: 'root',
    subscribeCommittedChanges: notifications.subscribeCommittedChanges });
  t.after(async () => { await close(server); rmSync(f.directory, { recursive: true, force: true }); });
  const base = await listen(server);
  const response = await fetch(`${base}/orchestra/events?subject=root&since=0`);
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const first = await reader.read();
  assert.match(decoder.decode(first.value), /event: hello/);
  const hello = decoder.decode(first.value).match(/"generation":"([^"]+)"/);
  assert.equal(hello?.[1], 'owner-1');

  const writer = new DatabaseSync(f.databasePath);
  writer.exec("INSERT INTO messages(id,sender,recipient,kind,body) VALUES ('outside-scope','sibling','external','guidance','private sibling input');");
  notifications.committed();
  let cursorOnly = '';
  const cursorDeadline = Date.now() + 3000;
  while (!cursorOnly.includes('event: cursor') && Date.now() < cursorDeadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 1000)),
    ]);
    if (!chunk.timeout) cursorOnly += decoder.decode(chunk.value);
  }
  assert.match(cursorOnly, /event: cursor/);
  assert.doesNotMatch(cursorOnly, /outside-scope|private sibling input|external/);
  writer.exec("INSERT INTO messages(id,sender,recipient,kind,body) VALUES ('pending-2','root','child','guidance','new input');");
  notifications.committed();
  let messageEvents = '';
  const messageDeadline = Date.now() + 3000;
  while (!messageEvents.includes('guidance from root') && Date.now() < messageDeadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 1000)),
    ]);
    if (!chunk.timeout) messageEvents += decoder.decode(chunk.value);
  }
  assert.match(messageEvents, /event: pending/);
  assert.match(messageEvents, /"unacknowledgedCount":2/);
  assert.match(messageEvents, /"at":"\d{4}-\d\d-\d\dT/);
  assert.match(messageEvents, /guidance from root/);
  writer.exec("UPDATE messages SET receipt='accepted' WHERE id='pending-2';");
  notifications.committed();
  let receiptEvents = '';
  const receiptDeadline = Date.now() + 3000;
  while (!receiptEvents.includes('"unacknowledgedCount":1') && Date.now() < receiptDeadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 1000)),
    ]);
    if (!chunk.timeout) receiptEvents += decoder.decode(chunk.value);
  }
  assert.match(receiptEvents, /event: pending/);
  assert.match(receiptEvents, /"unacknowledgedCount":1/);
  const beforeRollback = await fetch(`${base}/orchestra/snapshot?subject=root&since=0`);
  const beforeRollbackCursor = (await beforeRollback.json()).cursor;
  writer.exec("BEGIN; UPDATE executions SET phase='exited', status='exit 1' WHERE session='child'; ROLLBACK;");
  const rolledBack = await fetch(`${base}/orchestra/snapshot?subject=root&since=0`);
  assert.equal((await rolledBack.json()).cursor, beforeRollbackCursor);
  writer.exec("UPDATE executions SET phase='exited', status='exit 1' WHERE session='child';");
  notifications.committed();
  writer.close();

  let text = '';
  const deadline = Date.now() + 3000;
  while (!text.includes('exited exit 1') && Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 1000)),
    ]);
    if (chunk.timeout) continue;
    text += decoder.decode(chunk.value);
  }
  assert.match(text, /event: player/);
  assert.match(text, /event: transition/);
  assert.match(text, /exited exit 1/);
  assert.match(text, /"status":"exit 1"/);
  await reader.cancel();

  const replay = await fetch(`${base}/orchestra/events?subject=root&since=${beforeRollbackCursor}&generation=owner-1`);
  assert.equal(replay.status, 200);
  const replayReader = replay.body.getReader();
  let replayText = '';
  const replayDeadline = Date.now() + 3000;
  while (!replayText.includes('exited exit 1') && Date.now() < replayDeadline) {
    const chunk = await Promise.race([
      replayReader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 1000)),
    ]);
    if (chunk.timeout) continue;
    replayText += decoder.decode(chunk.value);
  }
  assert.match(replayText, /exited exit 1/);
  await replayReader.cancel();

  const generationResponse = await fetch(`${base}/orchestra/events?subject=root&since=${beforeRollbackCursor}&generation=owner-1`);
  const generationReader = generationResponse.body.getReader();
  await generationReader.read();
  notifications.generationChanged('owner-2');
  const generationFrame = decoder.decode((await generationReader.read()).value);
  assert.match(generationFrame, /event: gap[\s\S]*owner-generation-changed/);
  await generationReader.cancel();

  const lostResponse = await fetch(`${base}/orchestra/events?subject=root&since=${beforeRollbackCursor}&generation=owner-1`);
  const lostReader = lostResponse.body.getReader();
  await lostReader.read();
  notifications.lost();
  const lostFrame = decoder.decode((await lostReader.read()).value);
  assert.match(lostFrame, /event: gap[\s\S]*owner-notification-lost/);
  await lostReader.cancel();

  const prunedWriter = new DatabaseSync(f.databasePath);
  prunedWriter.exec('DELETE FROM native_changes WHERE change_id < (SELECT max(change_id) FROM native_changes);');
  notifications.committed();
  prunedWriter.close();
  const staleSnapshot = await fetch(`${base}/orchestra/snapshot?subject=root&since=1`);
  assert.equal((await staleSnapshot.json()).selection.gap, true);
  const staleStream = await fetch(`${base}/orchestra/events?subject=root&since=1`);
  assert.match(await staleStream.text(), /event: gap[\s\S]*cursor-gap/);

  const gap = await fetch(`${base}/orchestra/snapshot?subject=root&since=99`);
  const gapSnapshot = await gap.json();
  assert.equal(gapSnapshot.selection.gap, true);
  const gapStream = await fetch(`${base}/orchestra/events?subject=root&since=99`);
  assert.match(await gapStream.text(), /event: gap[\s\S]*cursor-gap/);
});

test('native coordinator commit is replayed through an injected owner notification contract', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-orchestra-native-'));
  const databasePath = join(directory, 'orchestra.db');
  const repository = join(directory, 'repository');
  const workspace = join(directory, 'child-worktree');
  const binary = join(process.cwd(), '.scratch/bend2/baton2');
  const notifications = commitNotifications();
  const native = (...args) => {
    const value = execFileSync(binary, [databasePath, ...args], { encoding: 'utf8' });
    notifications.committed();
    return value;
  };
  mkdirSync(repository);
  execFileSync('git', ['-C', repository, 'init', '-q', '-b', 'main']);
  execFileSync('git', ['-C', repository, 'config', 'user.name', 'Orchestra UI native fixture']);
  execFileSync('git', ['-C', repository, 'config', 'user.email', 'ui-fixture@example.invalid']);
  execFileSync('git', ['-C', repository, 'commit', '-q', '--allow-empty', '-m', 'fixture']);
  native('attach', 'root', 'codex', '', '');
  native('role', 'root', 'principal-conductor');
  native('recruit', 'child', 'root', 'muse', 'configured-model', 'low', repository,
    'child-branch', workspace, 'HEAD');

  const server = createOrchestraServer({ databasePath, reader: 'root',
    subscribeCommittedChanges: notifications.subscribeCommittedChanges });
  t.after(async () => { await close(server); rmSync(directory, { recursive: true, force: true }); });
  const base = await listen(server);
  const initial = await fetch(`${base}/orchestra/snapshot?subject=child&since=0`);
  const cursor = (await initial.json()).cursor;
  const response = await fetch(`${base}/orchestra/events?subject=child&since=${cursor}`);
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  await reader.read();

  native('message', 'socket-notify', 'root', 'child', 'guidance', 'private message body');
  let frames = '';
  const deadline = Date.now() + 3000;
  while (!frames.includes('guidance from root') && Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 1000)),
    ]);
    if (!chunk.timeout) frames += decoder.decode(chunk.value);
  }
  assert.match(frames, /event: pending/);
  assert.match(frames, /"pendingCount":1/);
  assert.match(frames, /guidance from root/);
  assert.doesNotMatch(frames, /private message body/);
  await reader.cancel();
});
