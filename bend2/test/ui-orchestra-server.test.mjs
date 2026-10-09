import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
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
    CREATE TABLE native_requests (
      id TEXT PRIMARY KEY NOT NULL, worker TEXT NOT NULL, parent TEXT NOT NULL, attempt TEXT NOT NULL,
      native_id TEXT NOT NULL, method TEXT NOT NULL, event TEXT NOT NULL, reply TEXT,
      written INTEGER NOT NULL DEFAULT 0, closed TEXT, UNIQUE(attempt, native_id)
    );
    CREATE TRIGGER ui_request_insert AFTER INSERT ON native_requests
    BEGIN
      INSERT INTO native_changes(recorded_at,entity,entity_id,session_id,operation,kind,summary)
      VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'),'native-request',NEW.id,NEW.worker,'insert',
        'native-request',NEW.method || ' request recorded');
    END;
    CREATE TRIGGER ui_request_update AFTER UPDATE ON native_requests
    WHEN OLD.reply IS NOT NEW.reply OR OLD.written IS NOT NEW.written OR OLD.closed IS NOT NEW.closed
    BEGIN
      INSERT INTO native_changes(recorded_at,entity,entity_id,session_id,operation,kind,summary)
      VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'),'native-request',NEW.id,NEW.worker,'update',
        'native-request',NEW.method || CASE WHEN NEW.reply IS NOT OLD.reply THEN ' response stored'
          WHEN NEW.written IS NOT OLD.written THEN ' response written' ELSE ' request closed' END);
    END;
    CREATE TRIGGER ui_request_delete AFTER DELETE ON native_requests
    BEGIN
      INSERT INTO native_changes(recorded_at,entity,entity_id,session_id,operation,kind,summary)
      VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'),'native-request',OLD.id,OLD.worker,'delete',
        'native-request',OLD.method || ' request removed');
    END;
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
    CREATE TRIGGER ui_ensemble_update AFTER UPDATE OF coupling ON ensembles
    WHEN OLD.coupling IS NOT NEW.coupling
    BEGIN
      INSERT INTO native_changes(recorded_at,entity,entity_id,session_id,operation,kind,summary)
      VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'),'ensemble',NEW.id,NEW.owner,'update',
        'ensemble',NEW.coupling);
    END;
    CREATE TRIGGER ui_membership_delete AFTER DELETE ON ensemble_members
    BEGIN
      INSERT INTO native_changes(recorded_at,entity,entity_id,session_id,operation,kind,summary)
      VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'),'membership',OLD.ensemble,OLD.session,'delete',
        'membership',OLD.ensemble);
    END;
    CREATE TRIGGER ui_ensemble_delete AFTER DELETE ON ensembles
    BEGIN
      INSERT INTO native_changes(recorded_at,entity,entity_id,session_id,operation,kind,summary)
      VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'),'ensemble',OLD.id,OLD.owner,'delete',
        'ensemble','deleted');
    END;
    INSERT INTO sessions(id,parent,harness,model,effort,workspace,branch,base,endpoint)
      VALUES ('root',NULL,'codex','configured/root','high','/root','main','base',''),
             ('child','root','muse','configured/child','medium','/child','work','base','["node","endpoint"]'),
             ('grandchild','child','omp','configured/grandchild','high','/grandchild','nested','base',''),
             ('sibling','root','codex','configured/sibling','low','/sibling','other','base',''),
             ('external','sibling','codex','configured/external','low','/external','other','base','');
    INSERT INTO session_roles VALUES ('root','conductor'),('child','conductor'),('grandchild','player'),('sibling','player');
    INSERT INTO executions VALUES ('child','attempt-1','direct','running','');
    INSERT INTO native_requests(id,worker,parent,attempt,native_id,method,event)
      VALUES ('req-1','grandchild','child','attempt-1','native-req-1','input','{"id":"native-req-1","method":"input"}');
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
    subscribeCommittedChanges: async ({ afterCursor, onNotice }) => {
      const subscriber = { onNotice };
      subscribers.add(subscriber);
      return {
        ready: true,
        generation,
        cursor: afterCursor,
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
  return new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
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

test('snapshot serves ordinary databases before native requests are recorded', async (t) => {
  const f = fixture();
  const db = new DatabaseSync(f.databasePath);
  db.exec('DROP TABLE native_requests');
  db.close();
  const server = createOrchestraServer({ databasePath: f.databasePath, reader: 'root' });
  t.after(async () => { await close(server); rmSync(f.directory, { recursive: true, force: true }); });
  const base = await listen(server);

  const response = await fetch(`${base}/orchestra/snapshot?subject=child`);
  assert.equal(response.status, 200);
  const snapshot = await response.json();
  const byId = new Map(snapshot.players.map((player) => [player.id, player]));
  assert.deepEqual([...byId.keys()], ['child', 'grandchild']);
  assert.equal(byId.get('child').currentAction.kind, 'execution');
  assert.equal(byId.get('child').currentAction.label, 'running');
  assert.equal(byId.get('child').pendingSample[0].id, 'pending-1');
  assert.equal(byId.get('grandchild').currentAction, null);
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

test('event endpoint requires a ready owner subscription with a durable cursor', async (t) => {
  const f = fixture();
  const server = createOrchestraServer({ databasePath: f.databasePath, reader: 'root',
    subscribeCommittedChanges: async () => ({ generation: 'owner-1', close() {} }) });
  t.after(async () => { await close(server); rmSync(f.directory, { recursive: true, force: true }); });
  const base = await listen(server);
  const response = await fetch(`${base}/orchestra/events?subject=child&since=0`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'native-owner-subscription-unavailable' });
});

test('a stale owner gap flag does not close a stream with a valid durable position', async (t) => {
  const f = fixture();
  const notifications = commitNotifications();
  const server = createOrchestraServer({ databasePath: f.databasePath, reader: 'root',
    subscribeCommittedChanges: async (args) => ({
      ...await notifications.subscribeCommittedChanges(args), gap: true,
    }) });
  t.after(async () => { await close(server); rmSync(f.directory, { recursive: true, force: true }); });
  const base = await listen(server);
  const snapshot = await (await fetch(`${base}/orchestra/snapshot?subject=child&since=0`)).json();
  const response = await fetch(`${base}/orchestra/events?subject=child&since=${snapshot.cursor}`);
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let frames = decoder.decode((await reader.read()).value);
  const writer = new DatabaseSync(f.databasePath);
  writer.exec("UPDATE executions SET phase='exited',status='exit 0' WHERE session='child';");
  writer.close();
  notifications.committed();
  while (!frames.includes('exited exit 0')) {
    const { done, value } = await reader.read();
    if (done) break;
    frames += decoder.decode(value, { stream: true });
  }
  assert.match(frames, /event: hello/);
  assert.match(frames, /event: player/);
  assert.match(frames, /event: transition[\s\S]*exited exit 0/);
  assert.match(frames, /"status":"exit 0"/);
  assert.doesNotMatch(frames, /event: gap/);
  await reader.cancel();
});

test('an out-of-scope knowledge change still invalidates the shared overview', async (t) => {
  const f = fixture();
  const notifications = commitNotifications();
  const server = createOrchestraServer({ databasePath: f.databasePath, reader: 'root',
    subscribeCommittedChanges: notifications.subscribeCommittedChanges });
  t.after(async () => { await close(server); rmSync(f.directory, { recursive: true, force: true }); });
  const base = await listen(server);
  const snapshot = await (await fetch(`${base}/orchestra/snapshot?subject=child&since=0`)).json();
  const response = await fetch(`${base}/orchestra/events?subject=child&since=${snapshot.cursor}`);
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  await reader.read();
  const writer = new DatabaseSync(f.databasePath);
  writer.exec(`
    CREATE TABLE knowledge (id TEXT PRIMARY KEY, author TEXT, claim TEXT, evidence TEXT, limits TEXT);
    CREATE TABLE knowledge_promotions (id TEXT PRIMARY KEY, finding TEXT, author TEXT,
      source TEXT, destination TEXT, promoted_by TEXT);
    BEGIN;
    INSERT INTO knowledge VALUES ('finding-outside','sibling','Shared outside finding','Observed source','Recorded limits');
    INSERT INTO native_changes(recorded_at,entity,entity_id,session_id,operation,kind,summary)
      VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'),'knowledge','finding-outside','sibling','insert','knowledge','finding recorded');
    COMMIT;
  `);
  writer.close();
  notifications.committed();
  const readEntity = async (entity) => {
    let frames = '';
    while (!frames.includes(`"entity":"${entity}"`)) {
      const { done, value } = await reader.read();
      if (done) break;
      frames += decoder.decode(value, { stream: true });
    }
    assert.match(frames, /event: transition/);
    assert.ok(frames.includes(`"entity":"${entity}"`));
    assert.match(frames, /"session":""/);
    assert.doesNotMatch(frames, /sibling|external|Shared outside finding/);
  };
  await readEntity('knowledge');
  const overview = await (await fetch(`${base}/orchestra/knowledge/overview`)).json();
  assert.deepEqual(overview.findings, [{ id: 'finding-outside', author: 'sibling', claim: 'Shared outside finding' }]);
  const promotionWriter = new DatabaseSync(f.databasePath);
  promotionWriter.exec(`
    BEGIN;
    INSERT INTO knowledge_promotions VALUES ('promotion-outside','finding-outside','sibling','sibling','external','root');
    INSERT INTO native_changes(recorded_at,entity,entity_id,session_id,operation,kind,summary)
      VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'),'promotion','promotion-outside','external','insert','promotion','finding shared');
    COMMIT;
  `);
  promotionWriter.close();
  notifications.committed();
  await readEntity('promotion');
  const promoted = await (await fetch(`${base}/orchestra/knowledge/overview`)).json();
  assert.equal(promoted.promotions[0].destination, 'external');
  assert.equal(promoted.actors.external.received, 1);
  await reader.cancel();
});

test('CLI reports its actual URL and exits cleanly when stdin reaches EOF', async (t) => {
  const f = fixture();
  const entry = fileURLToPath(new URL('../ui/orchestra/server.mjs', import.meta.url));
  const child = spawn(process.execPath, [entry, '--database', f.databasePath,
    '--reader', 'root', '--subject', 'child', '--port', '0'],
  { stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = new Promise((resolve) => child.once('close', (code) => resolve(code)));
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const errors = [];
  child.stderr.on('data', (chunk) => errors.push(String(chunk)));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    if (child.exitCode === null && child.signalCode === null) {
      await closed;
    }
    rmSync(f.directory, { recursive: true, force: true });
  });

  const machine = await lines.next();
  assert.equal(machine.done, false, errors.join(''));
  const binding = JSON.parse(machine.value);
  const reportedUrl = await lines.next();
  assert.equal(reportedUrl.done, false, errors.join(''));
  assert.equal(reportedUrl.value, `http://127.0.0.1:${binding.port}/`);
  const page = await fetch(reportedUrl.value, { redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.match(page.headers.get('location'), /subject=child/);

  child.stdin.end();
  const exit = await closed;
  assert.equal(exit, 0, errors.join(''));
});

test('scoped readers receive updates to outside-owned ensembles they can see through membership', async (t) => {
  const f = fixture();
  const notifications = commitNotifications();
  const server = createOrchestraServer({ databasePath: f.databasePath, reader: 'root',
    subscribeCommittedChanges: notifications.subscribeCommittedChanges });
  t.after(async () => { await close(server); rmSync(f.directory, { recursive: true, force: true }); });
  const base = await listen(server);
  const snapshotResponse = await fetch(`${base}/orchestra/snapshot?subject=child&since=0`);
  const snapshot = await snapshotResponse.json();
  const response = await fetch(`${base}/orchestra/events?subject=child&since=${snapshot.cursor}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  await reader.read();
  const writer = new DatabaseSync(f.databasePath);
  writer.exec("UPDATE ensembles SET coupling='loose' WHERE id='shared-ensemble';");
  notifications.committed();
  let frame = '';
  while (!frame.includes('event: ensemble')) {
    const chunk = await reader.read();
    if (chunk.done) break;
    frame += decoder.decode(chunk.value);
  }
  assert.match(frame, /event: ensemble/);
  assert.match(frame, /"owner":null/);
  assert.match(frame, /"members":\["child"\]/);
  assert.doesNotMatch(frame, /"owner":"external"/);
  writer.close();
  await reader.cancel();
});

test('membership removal updates the ensemble and the affected player', async (t) => {
  const f = fixture();
  const notifications = commitNotifications();
  const server = createOrchestraServer({ databasePath: f.databasePath, reader: 'root',
    subscribeCommittedChanges: notifications.subscribeCommittedChanges });
  t.after(async () => { await close(server); rmSync(f.directory, { recursive: true, force: true }); });
  const base = await listen(server);
  const snapshot = await (await fetch(`${base}/orchestra/snapshot?subject=child&since=0`)).json();
  const response = await fetch(`${base}/orchestra/events?subject=child&since=${snapshot.cursor}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  await reader.read();
  const writer = new DatabaseSync(f.databasePath);
  writer.exec("DELETE FROM ensemble_members WHERE ensemble='shared-ensemble' AND session='child';");
  notifications.committed();
  let frames = '';
  while (!frames.includes('event: transition')) {
    const chunk = await reader.read();
    if (chunk.done) break;
    frames += decoder.decode(chunk.value);
  }
  assert.match(frames, /event: ensemble/);
  assert.match(frames, /"members":\[\]/);
  assert.match(frames, /event: player/);
  assert.match(frames, /"memberEnsembles":\[\]/);
  writer.close();
  await reader.cancel();
});

test('removing a visible ensemble emits a gap for an authoritative snapshot', async (t) => {
  const f = fixture();
  const notifications = commitNotifications();
  const server = createOrchestraServer({ databasePath: f.databasePath, reader: 'root',
    subscribeCommittedChanges: notifications.subscribeCommittedChanges });
  t.after(async () => { await close(server); rmSync(f.directory, { recursive: true, force: true }); });
  const base = await listen(server);
  const snapshot = await (await fetch(`${base}/orchestra/snapshot?subject=child&since=0`)).json();
  const response = await fetch(`${base}/orchestra/events?subject=child&since=${snapshot.cursor}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  await reader.read();
  const writer = new DatabaseSync(f.databasePath);
  writer.exec("DELETE FROM ensembles WHERE id='shared-ensemble';");
  notifications.committed();
  const frame = decoder.decode((await reader.read()).value);
  assert.match(frame, /event: gap[\s\S]*ensemble-removed/);
  writer.close();
  await reader.cancel();
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
  writer.exec("INSERT INTO messages(id,sender,recipient,kind,body) VALUES ('outside-scope','root','orphan','guidance','private sibling input');");
  notifications.committed();
  let cursorOnly = '';
  while (!cursorOnly.includes('event: cursor')) {
    const chunk = await reader.read();
    if (chunk.done) break;
    cursorOnly += decoder.decode(chunk.value);
  }
  assert.match(cursorOnly, /event: cursor/);
  assert.doesNotMatch(cursorOnly, /outside-scope|private sibling input|external/);
  writer.exec("INSERT INTO messages(id,sender,recipient,kind,body) VALUES ('pending-2','root','child','guidance','new input');");
  notifications.committed();
  let messageEvents = '';
  while (!messageEvents.includes('guidance from root')) {
    const chunk = await reader.read();
    if (chunk.done) break;
    messageEvents += decoder.decode(chunk.value);
  }
  assert.match(messageEvents, /event: pending/);
  assert.match(messageEvents, /"unacknowledgedCount":2/);
  assert.match(messageEvents, /"at":"\d{4}-\d\d-\d\dT/);
  assert.match(messageEvents, /guidance from root/);
  writer.exec("UPDATE messages SET receipt='accepted' WHERE id='pending-2';");
  notifications.committed();
  let receiptEvents = '';
  while (!receiptEvents.includes('"unacknowledgedCount":1')) {
    const chunk = await reader.read();
    if (chunk.done) break;
    receiptEvents += decoder.decode(chunk.value);
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
  while (!text.includes('exited exit 1')) {
    const chunk = await reader.read();
    if (chunk.done) break;
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
  while (!replayText.includes('exited exit 1')) {
    const chunk = await replayReader.read();
    if (chunk.done) break;
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

test('old-cursor replay yields to HTTP and SQLite commits and drains every change in order', async (t) => {
  const f = fixture();
  const writer = new DatabaseSync(f.databasePath);
  writer.exec(`
    CREATE TABLE knowledge (id TEXT PRIMARY KEY, author TEXT, claim TEXT, evidence TEXT, limits TEXT);
    CREATE TABLE knowledge_promotions (id TEXT PRIMARY KEY, finding TEXT, author TEXT,
      source TEXT, destination TEXT, promoted_by TEXT);
    WITH RECURSIVE history(n) AS (
      SELECT 1 UNION ALL SELECT n + 1 FROM history WHERE n < 256
    )
    INSERT INTO native_changes(recorded_at,entity,entity_id,session_id,operation,kind,summary)
      SELECT '2026-10-09T00:00:00Z','execution','child','child','update','execution',
             'recorded execution ' || n FROM history;
  `);
  const initialIds = writer.prepare('SELECT change_id FROM native_changes ORDER BY change_id')
    .all().map((row) => row.change_id);
  const notifications = commitNotifications();
  const server = createOrchestraServer({ databasePath: f.databasePath, reader: 'root',
    subscribeCommittedChanges: notifications.subscribeCommittedChanges });
  let streamReader;
  t.after(async () => {
    await streamReader?.cancel();
    await close(server);
    writer.close();
    rmSync(f.directory, { recursive: true, force: true });
  });
  const base = await listen(server);
  let emittedCursor = 0;
  let interleaved = false;
  const duringReplay = new Promise((resolve, reject) => {
    server.on('request', (request, response) => {
      if (!request.url.startsWith('/orchestra/events')) return;
      const write = response.write.bind(response);
      response.write = (chunk, ...args) => {
        const frame = String(chunk);
        if (frame.includes('\nevent: transition\n')) {
          emittedCursor = Number(frame.match(/^id: (\d+)/)[1]);
          if (!interleaved) {
            interleaved = true;
            setImmediate(async () => {
              try {
                assert.ok(emittedCursor < initialIds.at(-1), 'replay held the event loop until its final row');
                writer.exec(`
                  BEGIN EXCLUSIVE;
                  UPDATE executions SET phase='exited',status='committed during replay' WHERE session='child';
                  INSERT INTO knowledge VALUES ('during-replay','sibling','Committed shared finding','Source','Limits');
                  INSERT INTO native_changes(recorded_at,entity,entity_id,session_id,operation,kind,summary)
                    VALUES ('2026-10-09T00:00:01Z','knowledge','during-replay','sibling','insert','knowledge','finding recorded');
                  COMMIT;
                `);
                notifications.committed();
                const [page, knowledge] = await Promise.all([
                  fetch(`${base}/app.js`),
                  fetch(`${base}/orchestra/knowledge/overview`),
                ]);
                assert.equal(page.status, 200);
                await page.text();
                assert.equal(knowledge.status, 200);
                assert.equal((await knowledge.json()).findings[0].id, 'during-replay');
                assert.ok(emittedCursor < initialIds.at(-1), 'HTTP completed after the replay drained');
                resolve(writer.prepare('SELECT change_id FROM native_changes ORDER BY change_id')
                  .all().map((row) => row.change_id));
              } catch (error) {
                reject(error);
              }
            });
          }
        }
        return write(chunk, ...args);
      };
    });
  });
  const [response, expectedIds] = await Promise.all([
    fetch(`${base}/orchestra/events?subject=child&since=0`),
    duringReplay,
  ]);
  assert.equal(response.status, 200);
  streamReader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  const transitions = [];
  while (transitions.at(-1)?.id !== expectedIds.at(-1)) {
    const chunk = await streamReader.read();
    assert.equal(chunk.done, false);
    buffered += decoder.decode(chunk.value, { stream: true });
    let boundary;
    while ((boundary = buffered.indexOf('\n\n')) !== -1) {
      const frame = buffered.slice(0, boundary);
      buffered = buffered.slice(boundary + 2);
      if (!frame.includes('\nevent: transition\n')) continue;
      transitions.push({
        id: Number(frame.match(/^id: (\d+)/)[1]),
        data: JSON.parse(frame.split('\ndata: ')[1]),
      });
    }
  }
  assert.deepEqual(transitions.map((transition) => transition.id), expectedIds);
  assert.equal(transitions.at(-2).data.summary, 'exited committed during replay');
  assert.equal(transitions.at(-1).data.entity, 'knowledge');
  assert.equal(transitions.at(-1).data.session, '');
  assert.equal(transitions.at(-1).data.entityId, '');
});

test('native coordinator commit is replayed through an injected owner notification contract', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-orchestra-native-'));
  const databasePath = join(directory, 'orchestra.db');
  const repository = join(directory, 'repository');
  const workspace = join(directory, 'child-worktree');
  const binary = join(process.cwd(), '.scratch/bend2/baton2');
  const database = new DatabaseSync(databasePath);
  database.close();
  const owner = spawn(binary, ['--instance-owner', databasePath], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const ownerErrors = [];
  owner.on('error', (error) => ownerErrors.push(String(error)));
  owner.stderr.on('data', (chunk) => ownerErrors.push(String(chunk)));
  const ownerClosed = new Promise((resolve) => {
    owner.once('close', (code, signal) => resolve({ code, signal }));
  });
  const notifications = commitNotifications();
  const native = (...args) => {
    const value = execFileSync(binary, [databasePath, ...args], { encoding: 'utf8' });
    notifications.committed();
    return value;
  };
  let reader;
  let server;
  t.after(async () => {
    if (reader) await reader.cancel().catch(() => {});
    if (server) await close(server);
    execFileSync(binary, ['--instance-shutdown', databasePath], { encoding: 'utf8' });
    const stopped = await ownerClosed;
    assert.deepEqual(stopped, { code: 0, signal: null }, ownerErrors.join(''));
    rmSync(directory, { recursive: true, force: true });
  });
  let ownerReadiness;
  while (!ownerReadiness) {
    const result = spawnSync(binary, [databasePath, 'owner-status'], {
      encoding: 'utf8',
    });
    if (result.error) throw result.error;
    if (result.status === 0 && result.stdout.trim()) ownerReadiness = JSON.parse(result.stdout);
    else if (owner.exitCode !== null || owner.signalCode !== null) {
      assert.fail(`native database owner exited before readiness: ${ownerErrors.join('')}`);
    } else await new Promise((resolve) => setTimeout(resolve, 50));
  }
  mkdirSync(repository);
  execFileSync('git', ['-C', repository, 'init', '-q', '-b', 'main']);
  execFileSync('git', ['-C', repository, 'config', 'user.name', 'Orchestra UI native fixture']);
  execFileSync('git', ['-C', repository, 'config', 'user.email', 'ui-fixture@example.invalid']);
  execFileSync('git', ['-C', repository, 'commit', '-q', '--allow-empty', '-m', 'fixture']);
  native('attach', 'root', 'codex', '', '');
  native('role', 'root', 'principal-conductor');
  native('recruit', 'child', 'root', 'muse', 'configured-model', 'low', repository,
    'child-branch', workspace, 'HEAD');

  server = createOrchestraServer({ databasePath, reader: 'root',
    subscribeCommittedChanges: notifications.subscribeCommittedChanges });
  const base = await listen(server);
  const initial = await fetch(`${base}/orchestra/snapshot?subject=child&since=0`);
  const cursor = (await initial.json()).cursor;
  const response = await fetch(`${base}/orchestra/events?subject=child&since=${cursor}`);
  assert.equal(response.status, 200);
  reader = response.body.getReader();
  const decoder = new TextDecoder();
  await reader.read();

  native('message', 'socket-notify', 'root', 'child', 'guidance', 'private message body');
  let frames = '';
  while (!frames.includes('guidance from root')) {
    const chunk = await reader.read();
    if (chunk.done) break;
    frames += decoder.decode(chunk.value);
  }
  assert.match(frames, /event: pending/);
  assert.match(frames, /"pendingCount":1/);
  assert.match(frames, /guidance from root/);
  assert.doesNotMatch(frames, /private message body/);
  await reader.cancel();
});

test('view CLI streams a committed native message through the owner subscription', {
  skip: process.env.BATON2_REQUIRE_NATIVE_VIEW !== '1'
    && !existsSync(process.env.BATON2_NATIVE_BINARY
      || join(process.cwd(), '.scratch/bend2/baton2')),
}, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-orchestra-owner-view-'));
  const databasePath = join(directory, 'orchestra.db');
  const repository = join(directory, 'repository');
  const workspace = join(directory, 'child-worktree');
  const binary = process.env.BATON2_NATIVE_BINARY
    || join(process.cwd(), '.scratch/bend2/baton2');
  assert.ok(existsSync(binary), `native Baton2 binary is missing: ${binary}`);
  const packageRoot = process.env.BATON2_PACKAGE_ROOT;
  if (packageRoot) {
    assert.equal(resolve(binary), resolve(packageRoot, 'bin/baton2'),
      'package asset coverage must launch the packaged Baton2 executable');
  }
  const uiRoot = packageRoot
    ? join(packageRoot, 'libexec/baton2/ui')
    : fileURLToPath(new URL('../ui/orchestra', import.meta.url));
  const serverPath = join(uiRoot, 'server.mjs');
  const adapterPath = join(uiRoot, 'native-owner-subscription.mjs');
  assert.ok(existsSync(serverPath), `view server is missing: ${serverPath}`);
  assert.ok(existsSync(adapterPath), `native owner adapter is missing: ${adapterPath}`);
  const binDirectory = join(directory, 'bin');
  mkdirSync(binDirectory);
  for (const command of ['open', 'xdg-open']) {
    const opener = join(binDirectory, command);
    writeFileSync(opener, '#!/bin/sh\nexit 0\n');
    chmodSync(opener, 0o755);
  }

  mkdirSync(repository);
  const native = (...args) => execFileSync(binary, [databasePath, ...args], {
    encoding: 'utf8',
  });
  const git = (...args) => execFileSync('git', ['-C', repository, ...args]);
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Orchestra owner view fixture');
  git('config', 'user.email', 'owner-view@example.invalid');
  git('commit', '-q', '--allow-empty', '-m', 'fixture');
  native('attach', 'root', 'codex', '', '');
  native('role', 'root', 'principal-conductor');
  native('recruit', 'child', 'root', 'muse', 'configured-model', 'low', repository,
    'child-branch', workspace, 'HEAD');

  const path = [binDirectory, dirname(process.execPath), process.env.PATH || ''].join(delimiter);
  const view = spawn(binary, [databasePath, 'view', 'child', 'root', '0'], {
    env: { ...process.env, PATH: path },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const viewClosed = new Promise((resolve) => view.once('close', (code) => resolve(code)));
  const viewErrors = [];
  view.stderr.on('data', (chunk) => viewErrors.push(String(chunk)));
  const viewLines = createInterface({ input: view.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]();
  let streamReader;
  t.after(async () => {
    if (streamReader) await streamReader.cancel().catch(() => {});
    if (view.exitCode === null && view.signalCode === null) {
      try { process.kill(-view.pid, 'SIGTERM'); } catch {}
      await viewClosed;
    }
    try { execFileSync(binary, ['--instance-shutdown', databasePath]); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });

  let ownerReadiness;
  while (!ownerReadiness) {
    const result = spawnSync(binary, [databasePath, 'owner-status'], {
      encoding: 'utf8',
    });
    if (result.error) throw result.error;
    if (result.status === 0 && result.stdout.trim()) ownerReadiness = JSON.parse(result.stdout);
    else if (view.exitCode !== null || view.signalCode !== null) {
      assert.fail(`view command exited before owner readiness: ${viewErrors.join('')}`);
    } else await new Promise((resolve) => setTimeout(resolve, 50));
  }

  let base;
  for await (const line of viewLines) {
    const match = /^Orchestra live view: (https?:\/\/\S+)$/.exec(line);
    if (match) {
      base = match[1];
      break;
    }
  }
  assert.ok(base, `view command exited before printing its URL: ${viewErrors.join('')}`);
  const pageResponse = await fetch(base);
  assert.equal(pageResponse.status, 200);
  const page = await pageResponse.text();
  const assets = [...page.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)];
  assert.ok(assets.length, 'the installed view references its interface assets');
  for (const [, path] of assets) {
    const asset = await fetch(new URL(path, base));
    assert.equal(asset.status, 200, `installed interface asset ${path}`);
    assert.ok((await asset.text()).length, `installed interface asset ${path} has content`);
  }
  const snapshotResponse = await fetch(`${base}orchestra/snapshot?subject=child&since=0`);
  assert.equal(snapshotResponse.status, 200);
  const initial = await snapshotResponse.json();
  const response = await fetch(`${base}orchestra/events?subject=child&since=${initial.cursor}`
    + `&generation=${ownerReadiness.generation}`);
  assert.equal(response.status, 200, viewErrors.join(''));
  streamReader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  async function readStreamChunk() {
    return streamReader.read();
  }
  async function nextFrame() {
    while (!pending.includes('\n\n')) {
      const chunk = await readStreamChunk();
      assert.equal(chunk.done, false, 'native owner event stream closed before the frame arrived');
      pending += decoder.decode(chunk.value, { stream: true });
    }
    const end = pending.indexOf('\n\n');
    const frame = pending.slice(0, end);
    pending = pending.slice(end + 2);
    return frame;
  }
  const hello = await nextFrame();
  assert.match(hello, /event: hello/);
  assert.match(hello, new RegExp(`"generation":"${ownerReadiness.generation}"`));

  const messageId = 'native-owner-view-message';
  native('message', messageId, 'root', 'child', 'guidance', 'private message body');
  const stored = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(stored.prepare('SELECT body FROM messages WHERE id=?').get(messageId)?.body,
    'private message body');
  stored.close();

  let frames = '';
  while (!frames.includes('guidance from root')) {
    frames += await nextFrame();
  }
  assert.match(frames, /event: pending/);
  assert.match(frames, /"pendingCount":1/);
  assert.match(frames, /guidance from root/);
  assert.doesNotMatch(frames, /private message body/);
  execFileSync(binary, ['--instance-shutdown', databasePath]);
  let shutdownEvents = '';
  let streamClosed = false;
  while (!streamClosed) {
    const chunk = await readStreamChunk();
    streamClosed = chunk.done;
    if (chunk.value) shutdownEvents += decoder.decode(chunk.value);
  }
  assert.match(shutdownEvents, /event: gap/);
  assert.match(shutdownEvents, /owner-notification-lost/);
  assert.equal(streamClosed, true, 'owner shutdown did not close the SSE response');
  streamReader = undefined;
  assert.equal(view.exitCode, null, 'view command exited when its owner stopped');
  const afterShutdown = await fetch(`${base}orchestra/snapshot?subject=child&since=0`);
  assert.equal(afterShutdown.status, 200, 'read-only HTTP server stopped with the owner');
});

test('a held write lock answers recoverably and the view keeps serving', async (t) => {
  // An ordinary writer holds the database while an actor commits. Both routes must
  // answer with a state the page already handles, and the process must survive:
  // the page retries the snapshot and resumes the event connection.
  const space = fixture();
  t.after(() => rmSync(space.directory, { recursive: true, force: true }));
  const server = createOrchestraServer({
    databasePath: space.databasePath,
    reader: 'root',
    subscribeCommittedChanges: commitNotifications().subscribeCommittedChanges,
  });
  const base = await listen(server);
  t.after(() => close(server));

  const healthy = await fetch(`${base}/orchestra/snapshot?subject=child`);
  assert.equal(healthy.status, 200);

  const writer = new DatabaseSync(space.databasePath);
  writer.exec('BEGIN EXCLUSIVE');
  let busySnapshot;
  let busyEvents;
  try {
    busySnapshot = await fetch(`${base}/orchestra/snapshot?subject=child`);
    busyEvents = await fetch(`${base}/orchestra/events?subject=child`);
  } finally {
    writer.exec('ROLLBACK');
    writer.close();
  }

  assert.equal(busySnapshot.status, 503);
  assert.deepEqual(await busySnapshot.json(), { error: 'snapshot-unavailable' });
  assert.equal(busyEvents.status, 503);
  assert.deepEqual(await busyEvents.json(), { error: 'database-busy' });

  const recovered = await fetch(`${base}/orchestra/snapshot?subject=child`);
  assert.equal(recovered.status, 200, 'the view stopped serving after a locked read');
  assert.equal((await recovered.json()).players[0].id, 'child');
});

test('the snapshot names the recorded current action and every stored awaiting', async (t) => {
  const space = fixture();
  t.after(() => rmSync(space.directory, { recursive: true, force: true }));
  const server = createOrchestraServer({ databasePath: space.databasePath, reader: 'root' });
  const base = await listen(server);
  t.after(() => close(server));

  const response = await fetch(`${base}/orchestra/snapshot?subject=child`);
  assert.equal(response.status, 200);
  const snapshot = await response.json();
  const byId = new Map(snapshot.players.map((player) => [player.id, player]));

  // An open recorded native request is what that actor waits on.
  const waiting = byId.get('grandchild');
  assert.equal(waiting.currentAction.kind, 'native-request');
  assert.equal(waiting.currentAction.label, 'input request awaiting response');
  assert.match(waiting.currentAction.at, /^\d{4}-\d{2}-\d{2}T/);

  // The running actor records no open request, so its execution phase is its action.
  const running = byId.get('child');
  assert.equal(running.currentAction.kind, 'execution');
  assert.equal(running.currentAction.label, 'running');

  // The awaiting sample names the stored message itself, not a summary of it.
  assert.equal(running.pendingSample.length, 1);
  assert.equal(running.pendingSample[0].id, 'pending-1');
  assert.equal(running.pendingSample[0].kind, 'task');

  // The tasks map carries the recorded task message behind the action label.
  assert.equal(snapshot.tasks.child.id, 'pending-1');
  assert.equal(snapshot.tasks.child.title, 'pending input body');
  assert.equal(snapshot.tasks.child.status, 'pending');
  assert.match(snapshot.tasks.child.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(snapshot.providers.child, { name: 'configured/child', status: 'configured' });
});

test('selected work reads the recorded cursors and complete bodies', async (t) => {
  const space = fixture();
  t.after(() => rmSync(space.directory, { recursive: true, force: true }));
  const server = createOrchestraServer({ databasePath: space.databasePath, reader: 'root' });
  const base = await listen(server);
  t.after(() => close(server));
  const db = new DatabaseSync(space.databasePath);
  t.after(() => db.close());

  // The launch input the running attempt actually included, recorded by cursor.
  db.prepare(`INSERT INTO messages(id,sender,recipient,kind,body)
    VALUES ('launch-1','root','child','guidance','Launch the review pass now')`).run();
  const seq = db.prepare(`SELECT seq FROM messages WHERE id = 'launch-1'`).get().seq;
  db.prepare(`UPDATE executions SET id = ?, phase = 'running' WHERE session = 'child'`)
    .run(`receive:child:${seq}`);
  // A newer pending guidance arrives while that input is still running.
  db.prepare(`INSERT INTO messages(id,sender,recipient,kind,body)
    VALUES ('pending-2','root','child','guidance','Newer guidance while running')`).run();
  // The actor reports its own failure in full.
  db.prepare(`INSERT INTO messages(id,sender,recipient,kind,body)
    VALUES ('report-1','child','root','report','Worker failed: missing fixture input.')`).run();

  const snapshot = await (await fetch(`${base}/orchestra/snapshot?subject=child`)).json();
  const child = snapshot.players.find((player) => player.id === 'child');

  // The receive cursor drives the action label, not the newer pending input.
  assert.equal(child.currentAction.kind, 'execution');
  assert.equal(child.currentAction.label, 'running · guidance input: Launch the review pass now');
  assert.equal(child.pendingSample[0].id, 'pending-2');
  assert.equal(snapshot.tasks.child.id, 'pending-1');
  assert.equal(snapshot.tasks.child.status, 'pending');
  assert.equal(child.latestReportId, 'report-1');

  // The selected read carries complete bodies, never excerpts.
  const work = await (await fetch(`${base}/orchestra/work?subject=child`)).json();
  assert.equal(work.actor, 'child');
  assert.equal(work.task.description, 'pending input body');
  assert.equal(work.input.body, 'Launch the review pass now');
  assert.equal(work.report.body, 'Worker failed: missing fixture input.');

  // The open request keeps its recorded method, event, and transport stage.
  const grandchildWork = await (await fetch(`${base}/orchestra/work?subject=grandchild`)).json();
  assert.equal(grandchildWork.request.method, 'input');
  assert.equal(grandchildWork.request.event, '{"id":"native-req-1","method":"input"}');
  assert.equal(grandchildWork.request.reply, null);
  assert.equal(grandchildWork.request.written, 0);
  assert.equal(grandchildWork.request.closed, null);

  // Acknowledging the task flips its receipt state without rewriting history.
  db.prepare(`UPDATE messages SET receipt = 'fixture-read' WHERE id = 'pending-1'`).run();
  const after = await (await fetch(`${base}/orchestra/snapshot?subject=child`)).json();
  assert.equal(after.tasks.child.status, 'acknowledged');
  assert.ok(!after.players.find((player) => player.id === 'child')
    .pendingSample.some((row) => row.id === 'pending-1'));
});
