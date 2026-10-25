// Build delivery-route-entry.bend and select it with BATON2_DELIVERY_FIXTURE.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

assert.ok(process.env.BATON2_DELIVERY_FIXTURE, 'BATON2_DELIVERY_FIXTURE must select the compiled fixture');
const binary = resolve(process.env.BATON2_DELIVERY_FIXTURE);
function run(...args) {
  const child = spawnSync(binary, args, { encoding: 'utf8', maxBuffer: Infinity });
  console.log(JSON.stringify({ argv: [binary, ...args], status: child.status,
    signal: child.signal, error: child.error?.message, stdout: child.stdout, stderr: child.stderr }));
  assert.ifError(child.error);
  assert.equal(child.signal, null, child.stderr);
  return child;
}
const schema = run('schema');
assert.equal(schema.status, 0, schema.stderr);
const body = "Complete principal report λ🙂, including apostrophe '.\nSecond line.\n";

function fixture(t, harness, native = '', endpoint = '') {
  const directory = mkdtempSync(join(tmpdir(), 'baton-delivery-route-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'state.sqlite');
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  db.exec(schema.stdout);
  db.prepare('INSERT INTO sessions(id,harness,native,endpoint) VALUES(?,?,?,?)').run('operator', harness, native, endpoint);
  db.prepare('INSERT INTO sessions(id,harness) VALUES(?,?)').run('root', 'fixture');
  db.prepare('INSERT INTO session_roles(session,role) VALUES(?,?)').run('operator', 'operator');
  db.prepare('INSERT INTO session_roles(session,role) VALUES(?,?)').run('root', 'conductor');
  return { directory, path, db };
}
function reportRow(db) {
  return { ...db.prepare('SELECT sender,recipient,kind,body,receipt FROM messages WHERE id=?').get('report-fixture') };
}
function assertCommitted(db) {
  assert.deepEqual(reportRow(db), { sender: 'root', recipient: 'operator', kind: 'report', body, receipt: null });
}

for (const harness of ['operator', 'terminal']) {
  test(`${harness} operator without a route reports delivery failure and retains the complete report`, t => {
    const { path, db } = fixture(t, harness);
    const before = db.prepare('SELECT * FROM sessions ORDER BY id').all();
    const child = run('report', path, 'report-fixture', body);
    assertCommitted(db);
    assert.deepEqual(db.prepare('SELECT * FROM sessions ORDER BY id').all(), before);
    assert.equal(child.status, 2, child.stdout + child.stderr);
    assert.match(child.stderr, /committed/);
    assert.match(child.stderr, /operator/);
    assert.match(child.stderr, new RegExp(`"harness":"${harness}"`));
    assert.match(child.stderr, /harness-unsupported/);
  });
}

test('supported harness without an endpoint reports its missing route', t => {
  const { path, db } = fixture(t, 'omp', 'owned-native');
  const child = run('report', path, 'report-fixture', body);
  assertCommitted(db);
  assert.equal(child.status, 2, child.stdout + child.stderr);
  assert.match(child.stderr, /endpoint-absent/);
});

test('Codex without a native identity retains its existing diagnostic and complete report', t => {
  const { path, db } = fixture(t, 'codex');
  const child = run('report', path, 'report-fixture', body);
  assertCommitted(db);
  assert.equal(child.status, 2, child.stdout + child.stderr);
  assert.match(child.stderr, /no native session identity/);
});

test('Codex with a functional endpoint receives the committed message ID', t => {
  const { directory, path, db } = fixture(t, 'codex', 'owned-native');
  const script = join(directory, 'endpoint.cjs');
  const calls = join(directory, 'calls.json');
  writeFileSync(script, 'require("node:fs").writeFileSync(process.argv[2],JSON.stringify(process.argv.slice(3))); console.log("owned endpoint completed");\n');
  db.prepare('UPDATE sessions SET endpoint=? WHERE id=?').run(JSON.stringify([process.execPath, script, calls]), 'operator');
  const child = run('report', path, 'report-fixture', body);
  assertCommitted(db);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.equal(JSON.parse(child.stdout).id, 'report-fixture');
  assert.deepEqual(JSON.parse(readFileSync(calls, 'utf8')), ['report-fixture']);
  assert.match(readFileSync(path + '.root.log', 'utf8'), /owned endpoint completed/);
});

for (const harness of ['operator', 'codex']) {
  for (const disposition of ['unknown', 'handled', 'excluded']) {
    test(`${harness} ${disposition} selection remains a successful no-op`, t => {
      const { path, db } = fixture(t, harness);
      if (disposition !== 'unknown') {
        db.prepare('INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES(?,?,?,?,?,?)')
          .run('report-fixture', 'root', 'operator', 'report', body, disposition === 'handled' ? 'fixture-completed' : null);
      }
      const before = db.prepare('SELECT * FROM messages').all();
      const child = run('deliver', path, 'report-fixture', disposition === 'excluded' ? '0' : '1');
      assert.deepEqual(db.prepare('SELECT * FROM messages').all(), before);
      assert.equal(child.status, 0, child.stdout + child.stderr);
      assert.equal(child.stdout.trim(), 'retained-output');
    });
  }
}
