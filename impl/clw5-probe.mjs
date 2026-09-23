import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoordinationStore } from './src/coordination-store.mjs';
const CLOCK = () => '2026-09-13T00:00:00.000Z';
const root = mkdtempSync(join(tmpdir(), 'clw5-probe-'));
try {
  const store = new CoordinationStore(root, { clock: CLOCK, checkpointInterval: 16 });
  store.claimWriterLease();
  const fields = (id, deps = []) => ({ id, brief: { goal: id }, deps, refines: null, taskType: 'test', reservedWorkerId: `w-${id}` });
  store.createTask(fields('clw-a'), { actor: 'orchestrator', key: 'fixture-a' });
  store.createTask(fields('clw-b', ['clw-a']), { actor: 'orchestrator', key: 'fixture-b' });
  store.createTask(fields('clw-b-changed', ['clw-a']), { actor: 'orchestrator', key: 'fixture-b' });
  store.claimTask('clw-a', 'w-clw-a', 1, { actor: 'orchestrator', key: 'fixture-claim-a' });
  store.grantContextPack({ packId: 'pack:x', runId: 'run:x', taskId: 'clw-a', taskVersion: 2, workerId: 'w-clw-a' },
    { actor: 'orchestrator', key: 'context.pack_granted:clw-a:pack:x' });
  store.createTask(fields('clw-c'), { actor: 'orchestrator', key: 'fixture-c' });
  store.createTask(fields('clw-d'), { actor: 'orchestrator', key: 'fixture-d' });
  store.compact({ beforeSeq: 3 });
  const raw = readFileSync(join(root, 'projection.checkpoint'), 'utf8');
  console.log('checkpoint sha256:', createHash('sha256').update(raw).digest('hex'));
  console.log('checkpoint bytes:', Buffer.byteLength(raw));
  console.log('--- content ---');
  console.log(raw.slice(0, 1200));
} finally { rmSync(root, { recursive: true, force: true }); }
