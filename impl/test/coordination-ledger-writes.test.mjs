// coordination-ledger-writes.test.mjs — issue #259, slice 7. Pins the module the store's effect
// bucket moved into (impl/src/coordination-ledger-writes.mjs) and the store that now delegates to
// it. Four claims are load-bearing, mirroring coordination-internals.test.mjs:
//
//   1. CONTEXT-FREE — the module has no `this`, no module-level mutable state, and never imports
//      the store back: every function is a function of what it is handed, nothing else.
//   2. THE SAME INPUT GIVES THE SAME OUTCOME — calling every moved export against two independently
//      built, identically seeded stores produces identical values or identical refusals, modulo the
//      identities a write mints (lease tokens, temp paths): an effect member's determinism is
//      measured after normalizing exactly those.
//   3. THE PORT IS EXPLICIT — every export takes `store` first, and the store reaches each one
//      through exactly one delegate whose name and arity are the member's own (Function.length is
//      pinned per member).
//   4. THE STORE'S BEHAVIOR IS UNCHANGED — a fixture that claims the writer lease, writes the
//      canonical-order receipt, compacts into a segment, checkpoints, releases, re-claims and
//      restarts produces byte-identical durable output to the pre-move store (digests captured at
//      36295b70, the slice-4 revision this slice was generated against).
//
// The delegates and their arities are derived from the AST and cross-checked against the committed
// seam map, so a helper that loses its delegate, or a member that changes signature, fails here.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as coordinationLedgerWrites from '../src/coordination-ledger-writes.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';

const require = createRequire(import.meta.url);
const { Lang, parse } = require('@ast-grep/napi');

const MODULE_FILE = 'src/coordination-ledger-writes.mjs';
const MODULE_ARTIFACT = 'impl/src/coordination-ledger-writes.mjs';
const STORE_FILE = 'src/coordination-store.mjs';
const MAP_STORE_FILE = 'impl/src/coordination-store.mjs';
const NAMESPACE = 'coordinationLedgerWrites';
const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const parseOf = (text) => parse(Lang.JavaScript, text).root();
const tokens = (node) => node.children().filter((child) => !['(', ')', ','].includes(child.kind()));
function lengthOf(parameters) {
  let count = 0;
  for (const parameter of parameters) {
    if (parameter.kind() === 'assignment_pattern' || parameter.kind() === 'rest_pattern') break;
    count += 1;
  }
  return count;
}

/** The relocated primitives the moved bodies read; module-scope, unexported, map-visible. */
const RELOCATED_HELPERS = Object.freeze([
  'nullPrototypeFields', 'validRepresentationPolicy', 'validRoutePolicy', 'writerOwnerState',
  'writerProcessStartIdentity',
]);

const CLOCK = () => '2026-09-13T00:00:00.000Z';

/** A fresh, identically seeded store: the fixture the determinism and behavior claims run on. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'baton-ledger-writes-'));
  const store = new CoordinationStore(root, { clock: CLOCK });
  const fields = (id, deps = []) => ({ id, brief: { goal: id }, deps, refines: null, taskType: 'test', reservedWorkerId: `w-${id}` });
  const records = [
    store.createTask(fields('clw-a'), { actor: 'orchestrator', key: 'fixture-a' }),
    store.createTask(fields('clw-b', ['clw-a']), { actor: 'orchestrator', key: 'fixture-b' }),
    store.claimTask('clw-a', 'w-clw-a', 1, { actor: 'orchestrator', key: 'fixture-claim-a' }),
  ];
  return { root, store, records, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** The delegate every moved member kept: `return coordinationLedgerWrites.<helper>(this, …)` —
 * or, for the constructor, the same call as an expression statement (a constructor returns no value). */
function delegates() {
  const declaration = parseOf(read(STORE_FILE)).findAll({ rule: { kind: 'class_declaration' } })
    .find((node) => node.field('name')?.text() === 'CoordinationStore');
  const wired = new Map();
  for (const member of declaration.field('body').children()) {
    if (member.kind() !== 'method_definition') continue;
    const body = member.field('body');
    const statements = body.children();
    if (statements.length !== 3) continue;
    const middle = statements[1];
    if (middle.kind() !== 'return_statement' && middle.kind() !== 'expression_statement') continue;
    const call = middle.children().find((child) => child.kind() === 'call_expression');
    const callee = call?.field('function');
    if (!callee || callee.kind() !== 'member_expression') continue;
    if (callee.field('object')?.text() !== NAMESPACE) continue;
    const args = tokens(call.field('arguments'));
    wired.set(member.field('name')?.text(), {
      helper: callee.field('property')?.text(),
      args: args.length - 1,
      receiverIsThis: args[0]?.text() === 'this',
    });
  }
  return wired;
}

/** An outcome two runs can compare: minted identities (lease tokens, temp paths) are normalized. */
function outcome(fn, args, root) {
  const normalize = (text) => text
    .split(root).join('<root>')
    .replaceAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu, '<uuid>');
  try {
    const value = JSON.stringify(fn(...args) ?? null) ?? 'undefined';
    return `value:${normalize(value)}`;
  } catch (error) {
    return `refusal:${error?.code ?? error?.name}:${normalize(String(error?.message))}`;
  }
}

test('CLW1: the module is context-free — no this, no mutable module state, no store import', () => {
  const root = parseOf(read(MODULE_FILE));
  const receivers = root.findAll({ rule: { kind: 'this' } }).map((node) => node.range().start.line);
  assert.deepEqual(receivers, [], 'a moved helper must not read an implicit receiver');
  const mutable = [];
  const bound = new Set();
  for (const statement of root.children()) {
    const kind = statement.kind();
    if (kind === 'variable_declaration') mutable.push(statement.text().slice(0, 60));
    if (kind === 'lexical_declaration' && statement.children().some((child) => child.kind() === 'let')) {
      mutable.push(statement.text().slice(0, 60));
    }
    if (kind === 'import_statement') {
      const source = statement.children().find((child) => child.kind() === 'string')?.text();
      assert.notEqual(source, "'./coordination-store.mjs'",
        'the store imports this module, so this import would close a cycle');
      for (const specifier of statement.findAll({ rule: { kind: 'import_specifier' } })) {
        bound.add(specifier.field('alias')?.text() ?? specifier.field('name')?.text());
      }
      continue;
    }
    const declaration = kind === 'export_statement' ? (statement.field('declaration') ?? statement) : statement;
    for (const declarator of declaration.children()) {
      if (declarator.kind() === 'variable_declarator') bound.add(declarator.field('name')?.text());
    }
    const declared = declaration.field('name')?.text();
    if (declared) bound.add(declared);
  }
  const written = [];
  for (const statement of root.children()) {
    for (const assignment of statement.findAll({ rule: { kind: 'assignment_expression' } })) {
      const target = assignment.field('left');
      if (target?.kind() === 'identifier' && bound.has(target.text())) written.push(assignment.text().slice(0, 60));
    }
  }
  assert.deepEqual([...mutable, ...written], [], 'module-level state is constant only, never written');
});

test('CLW2: the committed map, the delegates, and the exports are one bijection', () => {
  const map = JSON.parse(read('scripts/seam-inventory.json'));
  const moved = new Map();
  for (const member of map.files.find((file) => file.file === MAP_STORE_FILE).members) {
    if (member.evidence.some((entry) => entry.endsWith(':ledger_writes_port'))) {
      moved.set(`${member.name}#${member.ordinal}`, true);
      assert.equal(member.seam, 'effect',
        `${member.name}: the delegate keeps the effect seam its body had (the port rule is the evidence)`);
    }
  }
  assert.ok(moved.size > 0, 'the map must show the whole moved effect bucket');

  const wired = delegates();
  const movedNames = new Set([...moved.keys()].map((identity) => identity.split('#')[0]));
  const orphans = [...movedNames].filter((name) => !wired.has(name));
  assert.deepEqual(orphans, [], 'every mapped move must still be a delegate on the class');
  for (const [member, delegate] of wired) {
    assert.ok(moved.has(`${member}#0`), `${member}: a delegate into the module must be a mapped move`);
    assert.ok(delegate.receiverIsThis, `${member}: the delegate hands the store over as its receiver`);
    assert.ok(Object.hasOwn(coordinationLedgerWrites, delegate.helper),
      `${member}: ${NAMESPACE}.${delegate.helper} must be exported`);
  }
  assert.deepEqual([...wired.keys()].sort(), [...movedNames].sort(),
    'the delegate census is exactly the moved members');

  const moduleMembers = map.files.find((file) => file.file === MODULE_ARTIFACT)?.members ?? [];
  assert.equal(moduleMembers.length, wired.size + RELOCATED_HELPERS.length,
    'the module target carries the moved bodies plus the relocated function helpers');
  for (const member of moduleMembers) {
    if (wired.has(member.name)) {
      assert.equal(member.seam, 'effect', `${member.name}: the body keeps its effect seam in the module`);
    } else {
      assert.ok(RELOCATED_HELPERS.includes(member.name),
        `${member.name}: an unmapped module member must be a relocated helper`);
    }
  }
  assert.deepEqual(Object.keys(coordinationLedgerWrites).sort(), [...movedNames].sort(),
    'the module exports exactly the moved members — the relocated primitives stay unexported');
});

test('CLW3: the same input gives the same outcome on two identically seeded stores', () => {
  const wired = delegates();
  const failures = [];
  for (const [name] of wired) {
    const fn = coordinationLedgerWrites[name];
    const first = fixture();
    const second = fixture();
    try {
      const fromFirst = outcome(fn, [first.store, ...Array(8).fill(undefined)], first.root);
      const fromSecond = outcome(fn, [second.store, ...Array(8).fill(undefined)], second.root);
      if (fromFirst !== fromSecond) failures.push(`${name} — ${fromFirst} vs ${fromSecond}`);
    } finally {
      first.cleanup();
      second.cleanup();
    }
  }
  assert.deepEqual(failures, [], 'a moved member must be a function of the store it is handed');
});

test('CLW4: the store reaches every moved member through its own delegate, with its own arity', () => {
  const wired = delegates();
  assert.ok(wired.size > 0, 'the effect port carries delegates');
  const declaration = parseOf(read(STORE_FILE)).findAll({ rule: { kind: 'class_declaration' } })
    .find((node) => node.field('name')?.text() === 'CoordinationStore');
  const byName = new Map();
  for (const member of declaration.field('body').children()) {
    if (member.kind() === 'method_definition') byName.set(member.field('name')?.text(), member);
  }
  for (const [name] of wired) {
    const method = byName.get(name);
    assert.ok(method, `${name}: the class must still declare it`);
    const arity = lengthOf(tokens(method.field('parameters')));
    const descriptor = Object.getOwnPropertyDescriptor(CoordinationStore.prototype, name)
      ?? Object.getOwnPropertyDescriptor(CoordinationStore, name);
    assert.ok(descriptor, `${name}: the store must still answer on ${name}`);
    assert.equal(descriptor.value?.length ?? descriptor.get?.length, arity,
      `${name}: the signature must not move with the body`);
  }
});

test('CLW5: the store keeps its exact durable behavior across the move', async () => {
  const root = mkdtempSync(join(tmpdir(), 'baton-clw5-a-'));
  try {
    const store = new CoordinationStore(root, { clock: CLOCK, checkpointInterval: 16 });
    const lease = store.claimWriterLease();
    assert.deepEqual(Object.keys(lease).sort(), ['path', 'pid', 'pidStart', 'token']);
    assert.equal(lease.pid, process.pid);

    const fields = (id, deps = []) => ({ id, brief: { goal: id }, deps, refines: null, taskType: 'test', reservedWorkerId: `w-${id}` });
    const r1 = store.createTask(fields('clw-a'), { actor: 'orchestrator', key: 'fixture-a' });
    const r2 = store.createTask(fields('clw-b', ['clw-a']), { actor: 'orchestrator', key: 'fixture-b' });
    const retry = store.createTask(fields('clw-b-changed', ['clw-a']), { actor: 'orchestrator', key: 'fixture-b' });
    const r3 = store.claimTask('clw-a', 'w-clw-a', 1, { actor: 'orchestrator', key: 'fixture-claim-a' });
    assert.deepEqual([r1.event.seq, r2.event.seq, r3.event.seq], [1, 2, 3]);
    assert.deepEqual([retry.result, retry.event.seq, retry.event.kind], ['idempotent', 2, 'task.created']);

    // The cheap moved-member paths, with their pre-move outcomes.
    assert.deepEqual(await store.waitAfter(1, 50), { advanced: true, upperBound: 3 });
    assert.equal(store.materializeSpill('spill:none'), null);
    assert.throws(() => store.materializeContextPack('pack:none'), { code: 'context_pack_not_found' });
    assert.throws(() => store.attachContextPackage(
      { packageDigest: '0'.repeat(64), runId: 'run:x', scope: 'run' },
      { actor: 'orchestrator', key: 'package.attach:bad' }), { code: 'context_package_attach_invalid' });
    assert.throws(() => store.proposeOrientationCandidate(
      { leafDigest: 'a'.repeat(64), packDigest: 'b'.repeat(64) },
      { actor: 'worker:w-clw-a', key: 'k' }), { code: 'orientation_propose_refused' });
    const grant = store.grantContextPack(
      { packId: 'pack:x', runId: 'run:x', taskId: 'clw-a', taskVersion: 2, workerId: 'w-clw-a' },
      { actor: 'orchestrator', key: 'context.pack_granted:clw-a:pack:x' });
    assert.deepEqual([grant.result, grant.event.kind, grant.event.seq], ['granted', 'context.pack_granted', 4]);
    assert.deepEqual(store.revokeBoardGrants({ workerId: 'w-clw-a' }, { actor: 'orchestrator', key: 'revoke-none' }),
      { ok: true, revoked: [] });

    // The compaction seam: segment file, segment index, ledger rewrite, checkpoint — byte-pinned.
    store.createTask(fields('clw-c'), { actor: 'orchestrator', key: 'fixture-c' });
    store.createTask(fields('clw-d'), { actor: 'orchestrator', key: 'fixture-d' });
    assert.deepEqual(store.compact({ beforeSeq: 3 }), {
      schemaVersion: 1, beforeSeq: 3, archivedThroughSeq: 2, windowEvents: 4,
      segment: {
        fromSeq: 1, throughSeq: 2,
        digest: '7918adfd723e6dd6cb8f2257f02d07f4c6e42f0a757e5aaea845aad9520f4c0f', bytes: 545,
      },
      segments: 1, ledgerBytes: 1023,
    });
    const sha = (buf) => createHash('sha256').update(buf).digest('hex');
    const segDir = join(root, 'segments');
    assert.deepEqual(readdirSync(segDir).sort().map((name) => [name.replace(/^[0-9a-f]{64}/u, '<digest>'), sha(readFileSync(join(segDir, name)))]),
      [['<digest>.jsonl', '7918adfd723e6dd6cb8f2257f02d07f4c6e42f0a757e5aaea845aad9520f4c0f'],
        ['index.json', '778d58928e63d98d3a06c5264105abdae5a69ce95ba492371b5ad4abd3703763']]);
    assert.equal(sha(readFileSync(join(root, 'events.jsonl'))),
      '0baa9c18c598e1face7da42bf9e773a6d29588fdfa56f00322e383963d1927ea');
    // Re-captured after the projection gained its surface: #66 (1e050e42) added the doubt review
    // plane to PROJECTION_CHECKPOINT_FIELDS, so projectionShapeDigest and projectionDigest moved
    // and the checkpoint's bytes with them. The other two digests on this line's neighbours are
    // unchanged, which is what says the move is the projection's and not the write path's.
    assert.equal(sha(readFileSync(join(root, 'projection.checkpoint'))),
      'a3c561371c766feb32f4cde09a93ec7785df5047eadc070c366b2608fa1da7b6');

    assert.equal(store.releaseWriterLease({ requireOwned: true }), true);
    assert.equal(existsSync(join(root, 'writer.lease')), false);
    const reclaimed = store.claimWriterLease();
    assert.notEqual(reclaimed.token, lease.token, 'a re-claim after a clean release mints a fresh token');
    assert.equal(store.releaseWriterLease(), true);

    const restarted = new CoordinationStore(root, { clock: CLOCK });
    assert.deepEqual(restarted.startupStatus(), {
      schemaVersion: 1, state: 'ready', source: 'segments_checkpoint', totalEvents: 6,
      checkpointEvents: 4, replayedEvents: 0, checkpoint: 'valid', failure: null,
      poison: null, quarantined: [],
    }, 'restart replays the segment checkpoint through the moved write path');
    assert.equal(sha(JSON.stringify(restarted.snapshot())), sha(JSON.stringify(store.snapshot())),
      'replay reconstructs the identical projection');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  // The canonical-order receipt: minted by the moved _writeCanonicalReceipt under the held lease.
  const canonicalRoot = mkdtempSync(join(tmpdir(), 'baton-clw5-b-'));
  try {
    const policy = { maxEventBytes: 65_536, maxEvents: 1_000, maxLedgerBytes: 1_048_576, maxReceiptBytes: 65_536 };
    const store = new CoordinationStore(canonicalRoot, { clock: CLOCK, canonicalOrderPolicy: policy });
    store.claimWriterLease();
    const created = store.createTask(
      { id: 'clw-e', brief: { goal: 'clw-e' }, deps: [], refines: null, taskType: 'test', reservedWorkerId: 'w-clw-e' },
      { actor: 'orchestrator', key: 'fixture-e' });
    assert.deepEqual([created.result, created.event.seq], ['created', 1]);
    const receiptPath = join(canonicalRoot, 'canonical-order-receipt.json');
    assert.equal(existsSync(receiptPath), true);
    assert.equal(createHash('sha256').update(readFileSync(receiptPath)).digest('hex'),
      'a1d6aed1549cc499337b8faa4d3eaf5869e360883c0324cacf2b2d95b5d64dcc');
    assert.equal(store.canonicalOrderReceipt().receiptDigest,
      '30a459b6aeca6de33664920032450eeaa15195ca0a374f18dd6ada5ff0290464');
    assert.equal(createHash('sha256').update(readFileSync(join(canonicalRoot, 'events.jsonl'))).digest('hex'),
      'f79c48e1d54ef9858f9743f2fd32499156bb35f38a923d43ac7ec2f54d815418');
    store.releaseWriterLease();
  } finally {
    rmSync(canonicalRoot, { recursive: true, force: true });
  }
});

test('CLW6: the constructor delegate is complete — a blank prototype constructs identically', () => {
  const rootA = mkdtempSync(join(tmpdir(), 'baton-clw6-a-'));
  const rootB = mkdtempSync(join(tmpdir(), 'baton-clw6-b-'));
  try {
    const viaNew = new CoordinationStore(rootA, { clock: CLOCK });
    const blank = Object.create(CoordinationStore.prototype);
    coordinationLedgerWrites.constructor(blank, rootB, { clock: CLOCK });
    assert.deepEqual(blank.startupStatus(), viaNew.startupStatus(),
      'constructing through the module function answers the same startup report');
    const created = blank.createTask(
      { id: 'clw-f', brief: { goal: 'clw-f' }, deps: [], refines: null, taskType: 'test', reservedWorkerId: 'w-clw-f' },
      { actor: 'orchestrator', key: 'fixture-f' });
    assert.deepEqual([created.result, created.event.seq], ['created', 1]);
    assert.throws(() => coordinationLedgerWrites.constructor(blank, rootB, { checkpointInterval: 1 }),
      { name: 'TypeError', message: 'checkpointInterval is invalid' },
      'the moved constructor keeps its admission refusals');
  } finally {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  }
});
