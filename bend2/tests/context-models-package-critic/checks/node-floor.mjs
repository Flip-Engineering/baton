// Node floor origin capability. Invoked once under the exact Node 22.15.0
// toolchain (mode=floor, assertions enforced) and once under the host node
// (mode=host, facts recorded only). Records the actual node:sqlite engine
// identity and the capability booleans that the approved specification pins
// to the 22.15.0 floor: read-only open works; StatementSync.columns,
// DatabaseSync.setAuthorizer and function registration are absent.

import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mode = process.env.PCM_NODE_MODE ?? 'floor';

function facts() {
  const dir = mkdtempSync(join(tmpdir(), 'pcm-floor-'));
  const dbPath = join(dir, 'subject.db');
  let readOnlyOpen = null;
  let writeRefused = null;
  let errorMessage = null;
  try {
    const writer = new DatabaseSync(dbPath);
    writer.exec('create table t (v integer)');
    writer.prepare('insert into t values (?)').run(41);
    writer.close();
    const reader = new DatabaseSync(dbPath, { readOnly: true });
    const row = reader.prepare('select v from t').get();
    readOnlyOpen = row && row.v === 41;
    try {
      reader.exec('create table u (v integer)');
      writeRefused = false;
    } catch (error) {
      writeRefused = true;
      errorMessage = String(error.message);
    }
    reader.close();
  } catch (error) {
    errorMessage = String(error.message);
  }
  let engine = null;
  let sourceId = null;
  let compileOptions = null;
  let columns = null;
  let setAuthorizer = null;
  let createFunction = null;
  let errorMessage2 = null;
  try {
    const db = new DatabaseSync(':memory:');
    const row = db.prepare('select sqlite_version() v, sqlite_source_id() s').get();
    engine = row.v;
    sourceId = row.s;
    compileOptions = db.prepare('select compile_options o from pragma_compile_options()').all().map((r) => r.o);
    try {
      columns = typeof db.prepare('select 1').columns === 'function';
    } catch (error) {
      columns = `error:${error.code ?? ''}`;
    }
    setAuthorizer = typeof db.setAuthorizer === 'function';
    createFunction = typeof db.createFunction === 'function';
    db.close();
  } catch (error) {
    errorMessage2 = String(error.message);
  }
  const result = {
    mode,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    sqlite: { engine, sourceId, compileOptionCount: compileOptions?.length ?? null, compileOptionsHead: (compileOptions ?? []).slice(0, 6) },
    capability: { readOnlyOpen, writeRefused, StatementSync_columns: columns, setAuthorizer, createFunction },
  };
  if (errorMessage || errorMessage2) result.errors = [errorMessage, errorMessage2].filter(Boolean);
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* retained on failure */ }
  return result;
}

const observed = facts();

if (mode === 'floor') {
  const expect = [];
  const add = (ok, detail) => { if (!ok) expect.push(detail); };
  add(observed.node === 'v22.15.0', `process.version is ${observed.node}, expected v22.15.0`);
  add(observed.capability.readOnlyOpen === true, 'node:sqlite readOnly open did not read committed rows');
  add(observed.capability.writeRefused === true, 'readOnly connection allowed a write');
  add(observed.capability.StatementSync_columns === false, `StatementSync.columns must be absent at the 22.15.0 floor (observed ${observed.capability.StatementSync_columns})`);
  add(observed.capability.setAuthorizer === false, 'DatabaseSync.setAuthorizer must be absent at the 22.15.0 floor');
  add(observed.capability.createFunction === false, 'function registration must be absent at the 22.15.0 floor');
  add(observed.sqlite.engine !== null, 'sqlite_version() unavailable');
  if (expect.length > 0) {
    process.stdout.write(JSON.stringify({ check: 'node-floor', status: 'fail', details: { observed, refusals: expect } }) + '\n');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ check: 'node-floor', status: 'pass', details: observed }) + '\n');
  process.exit(0);
}
process.stdout.write(JSON.stringify({ check: 'node-floor-host-differential', status: 'pass', details: observed }) + '\n');
process.exit(0);
