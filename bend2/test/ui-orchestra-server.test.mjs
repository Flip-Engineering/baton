import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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
      change_id INTEGER PRIMARY KEY AUTOINCREMENT, committed_at TEXT NOT NULL,
      session_id TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL,
      operation TEXT NOT NULL, event_kind TEXT NOT NULL, summary TEXT NOT NULL
    );
    CREATE TRIGGER ui_execution_change AFTER UPDATE ON executions
    BEGIN
      INSERT INTO native_changes(committed_at,session_id,entity,entity_id,operation,event_kind,summary)
      VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.session,'player',NEW.session,'update',
        'execution','Execution entered ' || NEW.phase);
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
      ('shared-ensemble','shared-section','external');
  `);
  db.close();
  return { directory, databasePath };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', () => {
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
  const server = createOrchestraServer({ databasePath: f.databasePath, reader: 'root' });
  t.after(async () => { await close(server); rmSync(f.directory, { recursive: true, force: true }); });
  const base = await listen(server);

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

  const denied = await fetch(`${base}/orchestra/snapshot?subject=sibling&since=0`);
  assert.equal(denied.status, 403);
});

test('SSE replays committed projection rows after a silent write and reports cursor gaps', async (t) => {
  const f = fixture();
  const server = createOrchestraServer({ databasePath: f.databasePath, reader: 'root' });
  t.after(async () => { await close(server); rmSync(f.directory, { recursive: true, force: true }); });
  const base = await listen(server);
  const response = await fetch(`${base}/orchestra/events?subject=root&since=0`);
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const first = await reader.read();
  assert.match(decoder.decode(first.value), /event: hello/);

  const writer = new DatabaseSync(f.databasePath);
  writer.exec("BEGIN; UPDATE executions SET phase='exited', status='exit 1' WHERE session='child'; ROLLBACK;");
  const rolledBack = await fetch(`${base}/orchestra/snapshot?subject=root&since=0`);
  assert.equal((await rolledBack.json()).cursor, '0');
  writer.exec("UPDATE executions SET phase='exited', status='exit 1' WHERE session='child';");
  writer.close();

  let text = '';
  const deadline = Date.now() + 3000;
  while (!text.includes('Execution entered exited') && Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 1000)),
    ]);
    if (chunk.timeout) continue;
    text += decoder.decode(chunk.value);
  }
  assert.match(text, /event: player/);
  assert.match(text, /event: transition/);
  assert.match(text, /Execution entered exited/);
  assert.match(text, /"status":"exit 1"/);
  await reader.cancel();

  const replay = await fetch(`${base}/orchestra/events?subject=root&since=0`);
  assert.equal(replay.status, 200);
  const replayReader = replay.body.getReader();
  let replayText = '';
  const replayDeadline = Date.now() + 3000;
  while (!replayText.includes('Execution entered exited') && Date.now() < replayDeadline) {
    const chunk = await Promise.race([
      replayReader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 1000)),
    ]);
    if (chunk.timeout) continue;
    replayText += decoder.decode(chunk.value);
  }
  assert.match(replayText, /Execution entered exited/);
  await replayReader.cancel();

  const gap = await fetch(`${base}/orchestra/snapshot?subject=root&since=99`);
  const gapSnapshot = await gap.json();
  assert.equal(gapSnapshot.selection.gap, true);
});
