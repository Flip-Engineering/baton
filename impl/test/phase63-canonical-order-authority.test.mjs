import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  CANONICAL_ORDER_VERSION, canonicalJson, compareCanonicalStrings, foldCanonicalCase, sortCanonicalStrings,
} from '../src/canonical-order.mjs';
import { CoordinationIntegrityError, CoordinationRefusal, CoordinationStore, migrateCanonicalOrderLedger } from '../src/coordination-store.mjs';
import { createDriver, MockAdapter } from '../src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');
const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase63-${name}-`));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const policy = Object.freeze({
  maxLedgerBytes: 1024 * 1024, maxEventBytes: 64 * 1024,
  maxEvents: 1_000, maxReceiptBytes: 64 * 1024,
});

test('CO1: canonical case fold is deterministic for Unicode, Turkish I, and fullwidth dot', () => {
  assert.equal(foldCanonicalCase('Straße'), 'straße');
  assert.equal(foldCanonicalCase('Iİıi'), 'ii̇ıi');
  assert.equal(foldCanonicalCase('．GIT'), '．git');
  assert.equal(foldCanonicalCase('．GIT'.normalize('NFKC')), '.git');
  assert.throws(() => foldCanonicalCase(null), TypeError);
});
const migration = (fields) => ({ ...fields, ...policy });
const task = (id) => ({ id, brief: { goal: id }, deps: [], refines: null, taskType: 'phase63', reservedWorkerId: `w-${id}` });

test('CO1: canonical comparator is exact UTF-16 code-unit order with closed inputs', () => {
  const values = ['Z', 'a', 'ä', 'Å', 'I', 'ı', 'İ', 'i', '\u{1F600}', '\uE000', 'e\u0301', 'é'];
  const expected = [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  assert.equal(CANONICAL_ORDER_VERSION, 1);
  assert.deepEqual(sortCanonicalStrings(values, { maxItems: values.length }), expected);
  assert.deepEqual(values, ['Z', 'a', 'ä', 'Å', 'I', 'ı', 'İ', 'i', '\u{1F600}', '\uE000', 'e\u0301', 'é']);
  assert.equal(compareCanonicalStrings('a', 'a'), 0);
  assert.equal(compareCanonicalStrings('Z', 'a'), -1);
  assert.equal(compareCanonicalStrings('ä', 'Å'), 1);
  assert.throws(() => compareCanonicalStrings(1, '1'), TypeError);
  assert.throws(() => sortCanonicalStrings(['a', 1], { maxItems: 2 }), TypeError);
  assert.throws(() => sortCanonicalStrings(['a', 'b'], { maxItems: 1 }), RangeError);
  assert.deepEqual(canonicalJson({ ä: 1, Z: { ı: 2, I: 3 }, a: 4 }), { Z: { I: 3, ı: 2 }, a: 4, ä: 1 });
});

test('CO2: production authority has no locale-sensitive collation escape hatch', () => {
  const offenders = [];
  for (const name of readdirSync(SRC).filter((entry) => entry.endsWith('.mjs')).sort()) {
    const source = readFileSync(join(SRC, name), 'utf8');
    for (const pattern of [/\.localeCompare\s*\(/gu, /new\s+Intl\.Collator\s*\(/gu, /\.toLocale(?:LowerCase|UpperCase|String)\s*\(/gu]) {
      if (pattern.test(source)) offenders.push(`${name}:${pattern.source}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('CO3: canonical order is byte-identical across installed process locales', () => {
  const available = new Set(execFileSync('locale', ['-a'], { encoding: 'utf8' }).split('\n').filter(Boolean));
  const requested = ['C.UTF-8', 'en_US.UTF-8', 'sv_SE.UTF-8', 'tr_TR.UTF-8'];
  const locales = requested.filter((name) => available.has(name));
  assert.ok(locales.length >= 2, `need two installed locales, found ${locales.join(', ')}`);
  const moduleUrl = pathToFileURL(join(SRC, 'canonical-order.mjs')).href;
  const probe = `import { sortCanonicalStrings, canonicalJson } from ${JSON.stringify(moduleUrl)};
    const values = ['Z','a','ä','Å','I','ı','İ','i','😀','\\uE000'];
    process.stdout.write(JSON.stringify({ values: sortCanonicalStrings(values), object: canonicalJson(Object.fromEntries(values.map((key, index) => [key, index]))) }));`;
  const results = locales.map((locale) => execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
    encoding: 'utf8', env: { ...process.env, LANG: locale, LC_ALL: locale },
  }));
  assert.ok(results.every((value) => value === results[0]), `locale divergence: ${locales.join(', ')}`);
});

test('CO4/CO5: empty bootstrap and explicit compatible adoption pin immutable ledger prefixes', () => {
  const empty = root('empty');
  const first = new CoordinationStore(empty, { canonicalOrderPolicy: policy, clock: () => '2026-07-14T02:00:00.000Z' });
  first.claimWriterLease();
  const emptyReceipt = first.canonicalOrderReceipt();
  assert.equal(emptyReceipt.mode, 'empty_bootstrap');
  assert.equal(emptyReceipt.canonicalOrderVersion, 1);
  assert.equal(emptyReceipt.throughSeq, 0);
  assert.equal(emptyReceipt.prefixBytes, 0);
  assert.equal(emptyReceipt.prefixDigest, sha256(''));
  first.releaseWriterLease({ requireOwned: true });

  const legacyRoot = root('legacy');
  const legacy = new CoordinationStore(legacyRoot);
  legacy.createTask(task('legacy'), { actor: 'orchestrator', key: 'legacy:create' });
  legacy.releaseWriterLease({ requireOwned: true });
  const raw = readFileSync(join(legacyRoot, 'events.jsonl'));

  assert.throws(() => new CoordinationStore(legacyRoot, { canonicalOrderPolicy: policy }), (error) => error instanceof CoordinationRefusal && error.code === 'canonical_order_migration_required');
  assert.equal(existsSync(join(legacyRoot, 'writer.lease')), false);

  const receipt = migrateCanonicalOrderLedger(legacyRoot, {
    policy,
    migration: migration({ mode: 'adopt_compatible', expectedPrefixDigest: sha256(raw), expectedEvents: 1 }),
    clock: () => '2026-07-14T02:01:00.000Z',
  });
  const adopted = new CoordinationStore(legacyRoot, { canonicalOrderPolicy: policy });
  adopted.claimWriterLease();
  assert.deepEqual(adopted.canonicalOrderReceipt(), receipt);
  assert.equal(receipt.mode, 'adopt_compatible');
  assert.equal(receipt.throughSeq, 1);
  assert.equal(receipt.prefixBytes, raw.byteLength);
  assert.equal(receipt.prefixDigest, sha256(raw));
  adopted.createTask(task('after-cut'), { actor: 'orchestrator', key: 'after-cut:create' });
  adopted.releaseWriterLease({ requireOwned: true });

  const replay = new CoordinationStore(legacyRoot, { canonicalOrderPolicy: policy });
  replay.claimWriterLease();
  assert.deepEqual(replay.canonicalOrderReceipt(), receipt);
  assert.equal(replay.snapshot().lastSeq, 2);
  replay.releaseWriterLease({ requireOwned: true });
});

test('CO5/CO6: adoption request is exact, bounded, and cannot reset non-empty history', () => {
  const directory = root('adoption-reds');
  const legacy = new CoordinationStore(directory);
  legacy.createTask(task('legacy'), { actor: 'orchestrator', key: 'legacy:create' });
  legacy.releaseWriterLease({ requireOwned: true });
  const raw = readFileSync(join(directory, 'events.jsonl'));
  const attempt = (request, configuredPolicy = policy) => {
    assert.throws(() => migrateCanonicalOrderLedger(directory, { policy: configuredPolicy, migration: migration(request) }), (error) => error instanceof CoordinationRefusal || error instanceof TypeError);
    assert.equal(existsSync(join(directory, 'writer.lease')), false);
    assert.equal(existsSync(join(directory, 'canonical-order-receipt.json')), false);
  };
  attempt({ mode: 'adopt_compatible', expectedPrefixDigest: '0'.repeat(64), expectedEvents: 1 });
  attempt({ mode: 'adopt_compatible', expectedPrefixDigest: sha256(raw), expectedEvents: 2 });
  attempt({ mode: 'reset_empty' });
  attempt({ mode: 'adopt_compatible', expectedPrefixDigest: sha256(raw), expectedEvents: 1 }, { ...policy, maxLedgerBytes: Math.max(policy.maxEventBytes, raw.byteLength - 1) });
  assert.throws(() => migrateCanonicalOrderLedger(directory, { policy: { ...policy, maxEvents: 0 }, migration: migration({ mode: 'adopt_compatible', expectedPrefixDigest: sha256(raw), expectedEvents: 1 }) }), TypeError);
  assert.equal(existsSync(join(directory, 'writer.lease')), false);
  assert.throws(() => new CoordinationStore(directory, { canonicalOrderPolicy: policy, canonicalOrderMigration: migration({ mode: 'adopt_compatible', expectedPrefixDigest: sha256(raw), expectedEvents: 1 }) }), /offline-only/);
});

test('CO4/CO6: exact migration retry is immutable and changed cut authority conflicts', () => {
  const directory = root('retry');
  const legacy = new CoordinationStore(directory);
  legacy.createTask(task('legacy'), { actor: 'orchestrator', key: 'legacy:create' });
  legacy.releaseWriterLease({ requireOwned: true });
  const raw = readFileSync(join(directory, 'events.jsonl'));
  const request = migration({ mode: 'adopt_compatible', expectedPrefixDigest: sha256(raw), expectedEvents: 1 });
  const first = migrateCanonicalOrderLedger(directory, { policy, migration: request, clock: () => '2026-07-14T02:02:00.000Z' });
  const receiptBytes = readFileSync(join(directory, 'canonical-order-receipt.json'));
  const retry = migrateCanonicalOrderLedger(directory, { policy, migration: request, clock: () => '2026-07-14T02:03:00.000Z' });
  assert.deepEqual(retry, first);
  assert.deepEqual(readFileSync(join(directory, 'canonical-order-receipt.json')), receiptBytes);
  const narrower = { ...request, maxEvents: request.maxEvents - 1 };
  assert.throws(() => migrateCanonicalOrderLedger(directory, { policy, migration: narrower }), (error) => error instanceof CoordinationRefusal && error.code === 'canonical_order_migration_invalid');
  assert.equal(existsSync(join(directory, 'writer.lease')), false);
});

test('CO4/CO6: receipt and adopted prefix tampering fail before writer authority', () => {
  const adoptedRoot = root('prefix-tamper');
  const legacy = new CoordinationStore(adoptedRoot);
  legacy.createTask(task('legacy'), { actor: 'orchestrator', key: 'legacy:create' });
  legacy.releaseWriterLease({ requireOwned: true });
  const raw = readFileSync(join(adoptedRoot, 'events.jsonl'));
  migrateCanonicalOrderLedger(adoptedRoot, { policy, migration: migration({ mode: 'adopt_compatible', expectedPrefixDigest: sha256(raw), expectedEvents: 1 }) });
  writeFileSync(join(adoptedRoot, 'events.jsonl'), Buffer.from(raw.toString('utf8').replaceAll('legacy', 'forged')));
  assert.throws(() => new CoordinationStore(adoptedRoot, { canonicalOrderPolicy: policy }), (error) => error instanceof CoordinationRefusal && error.code === 'canonical_order_integrity');
  assert.equal(existsSync(join(adoptedRoot, 'writer.lease')), false);

  const receiptRoot = root('receipt-tamper');
  const store = new CoordinationStore(receiptRoot, { canonicalOrderPolicy: policy });
  store.claimWriterLease(); store.releaseWriterLease({ requireOwned: true });
  const receiptPath = join(receiptRoot, 'canonical-order-receipt.json');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  receipt.createdAt = '2026-07-14T02:04:00.000Z';
  writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
  assert.throws(() => new CoordinationStore(receiptRoot, { canonicalOrderPolicy: policy }), (error) => error instanceof CoordinationRefusal && error.code === 'canonical_order_integrity');
  assert.equal(existsSync(join(receiptRoot, 'writer.lease')), false);
});

test('CO5/CO6: unknown history, receipt symlinks, and oversize receipts fail closed', () => {
  const unknownRoot = root('unknown-kind');
  const unknown = { schemaVersion: 1, seq: 1, ts: '2026-07-14T02:05:00.000Z', kind: 'attacker.unknown', actor: 'orchestrator', idempotencyKey: 'unknown:1', payload: {} };
  const unknownBytes = Buffer.from(`${JSON.stringify(unknown)}\n`);
  writeFileSync(join(unknownRoot, 'events.jsonl'), unknownBytes);
  assert.throws(() => migrateCanonicalOrderLedger(unknownRoot, { policy, migration: migration({ mode: 'adopt_compatible', expectedPrefixDigest: sha256(unknownBytes), expectedEvents: 1 }) }), (error) => error instanceof CoordinationIntegrityError && error.code === 'unsupported_event_kind');
  assert.equal(existsSync(join(unknownRoot, 'canonical-order-receipt.json')), false);
  assert.equal(existsSync(join(unknownRoot, 'writer.lease')), false);

  const eventRoot = root('oversize-event');
  const legacy = new CoordinationStore(eventRoot); legacy.createTask(task('oversize'), { actor: 'orchestrator', key: 'oversize:create' }); legacy.releaseWriterLease({ requireOwned: true });
  const eventBytes = readFileSync(join(eventRoot, 'events.jsonl'));
  const eventPolicy = { ...policy, maxEventBytes: eventBytes.byteLength - 1 };
  assert.throws(() => migrateCanonicalOrderLedger(eventRoot, { policy: eventPolicy, migration: { ...eventPolicy, mode: 'adopt_compatible', expectedPrefixDigest: sha256(eventBytes), expectedEvents: 1 } }), (error) => error instanceof CoordinationRefusal && error.code === 'canonical_order_migration_invalid');
  assert.equal(existsSync(join(eventRoot, 'canonical-order-receipt.json')), false);
  assert.equal(existsSync(join(eventRoot, 'writer.lease')), false);

  const symlinkRoot = root('receipt-symlink'); const target = join(symlinkRoot, 'outside.json');
  writeFileSync(target, '{}\n'); symlinkSync(target, join(symlinkRoot, 'canonical-order-receipt.json'));
  assert.throws(() => new CoordinationStore(symlinkRoot, { canonicalOrderPolicy: policy }), (error) => error instanceof CoordinationRefusal && error.code === 'canonical_order_integrity');
  unlinkSync(join(symlinkRoot, 'canonical-order-receipt.json'));

  const tinyRoot = root('tiny-receipt'); const tinyPolicy = { ...policy, maxReceiptBytes: 64 };
  const tiny = new CoordinationStore(tinyRoot, { canonicalOrderPolicy: tinyPolicy });
  assert.throws(() => tiny.claimWriterLease(), (error) => error instanceof CoordinationRefusal && error.code === 'canonical_order_integrity');
  assert.equal(existsSync(join(tinyRoot, 'canonical-order-receipt.json')), false);
  assert.equal(existsSync(join(tinyRoot, 'writer.lease')), false);

  const resetRoot = root('reset-empty');
  const reset = migrateCanonicalOrderLedger(resetRoot, { policy, migration: migration({ mode: 'reset_empty' }) });
  assert.equal(reset.mode, 'empty_bootstrap'); assert.equal(reset.throughSeq, 0);
});

test('CO4/CO6: empty bootstrap is private and removes only stale receipt temporaries while leased', () => {
  const directory = root('bootstrap-hygiene');
  writeFileSync(join(directory, '.canonical-order-receipt.stale'), 'partial');
  writeFileSync(join(directory, 'unrelated.tmp'), 'retain');
  const store = new CoordinationStore(directory, { canonicalOrderPolicy: policy, clock: () => '2026-07-14T02:06:00.000Z' });
  store.claimWriterLease();
  const receiptPath = join(directory, 'canonical-order-receipt.json');
  assert.equal(lstatSync(receiptPath).mode & 0o777, 0o600);
  assert.equal(existsSync(join(directory, '.canonical-order-receipt.stale')), false);
  assert.equal(existsSync(join(directory, 'unrelated.tmp')), true);
  store.releaseWriterLease({ requireOwned: true });
});

test('CO4/CO8: createDriver wires and re-attests an explicitly deployed canonical-order policy', () => {
  const repo = root('driver-repo'); const logDir = root('driver-log');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase63@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 63'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const make = () => createDriver({
    repoRoot: repo, repoId: 'repo-phase63', logDir,
    adapters: { mock: new MockAdapter() }, canonicalOrderPolicy: policy,
  });
  const first = make(); const receipt = first.coordination.canonicalOrderReceipt(); first.close();
  assert.equal(receipt.mode, 'empty_bootstrap');
  const replay = make(); assert.deepEqual(replay.coordination.canonicalOrderReceipt(), receipt); replay.close();
});
