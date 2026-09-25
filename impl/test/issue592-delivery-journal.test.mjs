import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DeliveryJournal } from '../src/delivery-journal.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';

const batch = (dispatchId = 'dispatch-1') => ({
  dispatchId, recipient: { kind: 'root' }, generation: 'generation-1', requestKey: `native-${dispatchId}`,
  itemKeys: ['obligation-1', 'obligation-2'], input: 'Review contribution with marker journal-592.',
});
const receipt = (state = 'accepted', receiptId = 'receipt-1') => ({
  receiptId, generation: 'generation-1', state, evidence: { nativeTurnId: 'turn-1' },
});
const options = (root) => ({ root, repoId: 'journal-test', deploymentId: 'deployment-test' });
const cleanup = new Map();
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-592-journal-'));
  cleanup.set(root, []);
  t.after(() => {
    try { for (const close of cleanup.get(root).reverse()) close(); }
    finally { cleanup.delete(root); rmSync(root, { recursive: true, force: true }); }
  });
  return root;
}
function open(t, root, extra = {}) {
  const journal = new DeliveryJournal({ ...options(root), ...extra });
  cleanup.get(root).push(() => journal.close());
  return journal;
}
function crash(root, boundary, operation = 'append') {
  const child = spawnSync(process.execPath,
    [new URL('./fixtures/issue592-journal-process.mjs', import.meta.url).pathname, root, boundary, operation],
    { encoding: 'utf8', timeout: 15_000 });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, 'SIGKILL', child.stderr);
}

test('prepared inputs and native evidence survive reopen with stable identities and immutable values', (t) => {
  const root = fixture(t);
  let journal = open(t, root);
  const input = batch();
  const prepared = journal.prepare(input);
  input.input = 'mutated caller input';
  prepared.body.itemKeys.pop();
  assert.equal(journal.prepare(batch()).body.itemKeys.length, 2);
  const accepted = journal.recordReceipt('dispatch-1', receipt());
  journal.close();
  journal = open(t, root);
  assert.deepEqual(journal.entries().map((entry) => entry.kind), ['prepared', 'receipt']);
  assert.deepEqual(journal.recordReceipt('dispatch-1', receipt()), accepted);
  assert.throws(() => journal.prepare({ ...batch(), input: 'different' }), { code: 'delivery_batch_conflict' });
  assert.throws(() => journal.recordReceipt('dispatch-1', receipt('processed')), { code: 'delivery_receipt_conflict' });
  assert.throws(() => journal.recordReceipt('dispatch-1', { ...receipt(), generation: 'replacement' }),
    { code: 'delivery_generation_mismatch' });
  assert.throws(() => journal.recordReceipt('absent', receipt()), { code: 'delivery_batch_unknown' });
});

test('live writer exclusion and closed writer refusal preserve the journal', (t) => {
  const root = fixture(t);
  const journal = open(t, root);
  journal.prepare(batch());
  assert.throws(() => new DeliveryJournal(options(root)), { code: 'application_host_busy' });
  const child = spawnSync(process.execPath,
    [new URL('./fixtures/issue592-journal-process.mjs', import.meta.url).pathname, root, 'none', 'append'],
    { encoding: 'utf8', timeout: 15_000 });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /application_host_busy/);
  journal.close();
  assert.throws(() => journal.prepare(batch('late')), { code: 'delivery_journal_closed' });
  assert.equal(open(t, root).entries().length, 1);
});

test('writer loss refuses a further append', (t) => {
  const root = fixture(t);
  const journal = new DeliveryJournal(options(root));
  const ownerPath = join(root, 'delivery.lease', 'owner.json');
  const owner = readFileSync(ownerPath);
  writeFileSync(ownerPath, JSON.stringify({ ...JSON.parse(owner), nonce: 'replacement' }));
  try { assert.throws(() => journal.prepare(batch()), { code: 'application_host_lease_lost' }); }
  finally { writeFileSync(ownerPath, owner); journal.close(); }
});

test('a storage failure returns no prepared receipt and poisons further operations until recovery', (t) => {
  const root = fixture(t);
  const journal = open(t, root, { onPersistenceBoundary(name) {
    if (name === 'append_body') throw Object.assign(new Error('injected sync failure'), { code: 'EIO' });
  } });
  assert.throws(() => journal.prepare(batch()), { code: 'EIO' });
  assert.throws(() => journal.prepare(batch('next')), { code: 'delivery_journal_unsynced' });
  assert.throws(() => journal.entries(), { code: 'delivery_journal_unsynced' });
  journal.close();
  assert.equal(open(t, root).prepare(batch()).body.input, batch().input);
});

for (const boundary of ['append_header', 'append_body', 'append_sync']) {
  test(`writer death at ${boundary} retains previous records and recovers a writable tail`, (t) => {
    const root = fixture(t);
    const before = new DeliveryJournal(options(root));
    before.prepare(batch());
    before.close();
    crash(root, boundary);
    const after = open(t, root);
    assert.deepEqual(after.entries()[0].body, batch());
    assert.equal(after.entries().some((entry) => entry.dispatchId === 'crashed'), boundary !== 'append_header');
    after.prepare(batch('after-crash'));
    after.close();
    assert.equal(open(t, root).entries().at(-1).dispatchId, 'after-crash');
  });
}

for (const boundary of ['checkpoint_write', 'checkpoint_sync', 'checkpoint_rename', 'checkpoint_directory_sync']) {
  test(`writer death at ${boundary} preserves pending imports and acknowledged identity`, (t) => {
    const root = fixture(t);
    const before = new DeliveryJournal(options(root));
    const prepared = before.prepare(batch());
    before.acknowledgeImport(prepared.entryId, 12);
    const accepted = before.recordReceipt('dispatch-1', receipt());
    before.acknowledgeImport(accepted.entryId, 13);
    before.recordReceipt('dispatch-1', receipt('processing', 'receipt-2'));
    before.close();
    crash(root, boundary, 'checkpoint');
    const after = open(t, root);
    assert.deepEqual(readdirSync(root).filter((name) => name.endsWith('.tmp')), []);
    assert.equal(after.pendingImports().length, 1);
    assert.equal(after.pendingImports()[0].body.state, 'processing');
    assert.equal(after.prepare(batch()).importedAt, 12);
    assert.equal(after.recordReceipt('dispatch-1', receipt()).importedAt, 13);
    assert.throws(() => after.recordReceipt('dispatch-1', receipt('processed')), { code: 'delivery_receipt_conflict' });
    after.prepare(batch('after-checkpoint'));
    after.close();
    assert.equal(open(t, root).entries().at(-1).dispatchId, 'after-checkpoint');
  });
}

test('import acknowledgment releases full input and evidence while retaining receipt validation and replay identity', (t) => {
  const journal = open(t, fixture(t));
  const prepared = journal.prepare(batch());
  const accepted = journal.recordReceipt('dispatch-1', receipt());
  journal.acknowledgeImport(prepared.entryId, 21);
  journal.acknowledgeImport(accepted.entryId, 22);
  assert.equal(journal.entries()[0].body, null);
  assert.deepEqual(journal.entries()[0].summary, { generation: 'generation-1' });
  journal.recordReceipt('dispatch-1', receipt('processed', 'result'));
  journal.checkpoint();
  const [input, imported, pending] = journal.entries();
  assert.equal(input.body, null);
  assert.equal(imported.body, null);
  assert.equal(imported.summary.state, 'accepted');
  assert.equal(pending.body.state, 'processed');
  assert.throws(() => journal.acknowledgeImport(input.entryId, 23), { code: 'delivery_import_conflict' });
});

test('coordination commit precedes import acknowledgment and receipt replay is idempotent after a crash', async (t) => {
  const root = fixture(t);
  const before = new DeliveryJournal(options(root));
  before.prepare(batch());
  before.recordReceipt('dispatch-1', receipt());
  before.close();
  crash(root, 'import_commit', 'import');
  const after = open(t, root);
  assert.equal(after.pendingImports().length, 2, 'the child died before acknowledging the coordination commit');
  const store = new CoordinationStore(join(root, 'coordination'));
  store.claimWriterLease();
  cleanup.get(root).push(() => store.releaseWriterLease());
  const imported = () => store.eventsView().filter((event) => event.payload?.kind === 'attention.delivery_recorded');
  assert.equal(imported().length, 1);
  await after.importPending(store);
  assert.equal(imported().length, 2, 'the committed prepared entry is not appended twice');
  assert.equal(after.pendingImports().length, 0);
  await after.importPending(store);
  assert.equal(imported().length, 2);
  assert.equal(imported()[1].payload.body.state, 'accepted');
});

test('failed coordination sync retains all journal import debt', async (t) => {
  const root = fixture(t);
  const journal = open(t, root);
  journal.prepare(batch());
  const store = new CoordinationStore(join(root, 'coordination'), {
    syncFile() { throw Object.assign(new Error('injected failure'), { code: 'EIO' }); },
  });
  store.claimWriterLease();
  cleanup.get(root).push(() => store.releaseWriterLease());
  await assert.rejects(journal.importPending(store), { code: 'coordination_ledger_unsynced' });
  assert.equal(journal.pendingImports().length, 1);
  journal.checkpoint();
  assert.deepEqual(journal.pendingImports()[0].body, batch());
});

for (const area of ['header', 'body', 'checkpoint']) {
  test(`corrupt ${area} is a storage fault and is never truncated as a partial append`, (t) => {
    const root = fixture(t);
    const journal = new DeliveryJournal(options(root));
    journal.prepare(batch());
    if (area === 'checkpoint') journal.checkpoint();
    const path = journal.path;
    journal.close();
    const bytes = readFileSync(path);
    if (area === 'checkpoint') truncateSync(path, bytes.length - 1);
    else { bytes[area === 'header' ? 9 : 80] ^= 1; writeFileSync(path, bytes); }
    const size = statSync(path).size;
    assert.throws(() => new DeliveryJournal(options(root)), { code: 'delivery_journal_corrupt' });
    assert.equal(statSync(path).size, size);
  });
}

test('a journal refuses another deployment identity after clean release', (t) => {
  const root = fixture(t);
  assert.throws(() => new DeliveryJournal({ ...options(root), repoId: 'invalid identity' }), TypeError);
  const journal = new DeliveryJournal(options(root));
  journal.prepare(batch());
  journal.close();
  assert.throws(() => new DeliveryJournal({ ...options(root), deploymentId: 'other-deployment' }),
    { code: 'delivery_journal_corrupt' });
});
