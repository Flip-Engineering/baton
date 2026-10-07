// Custody invariants of the retained acquisition operand.
//
// The retained set here is a local stand-in that behaves as the retained captured-filesystem host
// does: it reads each recorded name once, from disk, at construction time, keeps the accepted
// bytes, records every readBytes call, and lists rows through descriptors(). The suite asserts
// what the glue is responsible for: existence, canonical identity and bytes decided only by the
// recorded set; absence stated and never inferred; no host access for an unrecorded name; the base
// located by the pinned digest; and a captured record refused as an acquisition source.
//
// The last two cases drive the reviewed frontend adapter with this operand, which is the consumer
// contract the glue satisfies without a change to that adapter. A shared record is filed under the
// requested key and the canonical key, so the adapter's snapshot lists two entries for it while the
// retained set was read once; the settled shape is asserted here rather than a count of one.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createRetainedAcquisition, isClaimedCaptureRecord } from './acquisition.mjs';
import { createFrontendAdapter } from './frontend-adapter.mjs';

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// A retained captured set over real files. `recordFile` performs the read, as the retained host
// does; `readBytes` serves the retained buffer and records the call.
function createRetainedSet() {
  const entries = new Map();
  const readBacks = [];
  return {
    readBacks,
    recordFile(name, diskPath, kind = 'file') {
      const bytes = new Uint8Array(readFileSync(diskPath));
      entries.set(name, {
        kind,
        path: name,
        real: realpathSync(diskPath),
        sha256: sha256Hex(bytes),
        bytes,
      });
    },
    recordDirectory(name, diskPath) {
      entries.set(name, { kind: 'directory', path: name, real: realpathSync(diskPath) });
    },
    recordAbsent(name) {
      entries.set(name, { kind: 'absent', path: name });
    },
    recordFailed(name, detail) {
      entries.set(name, { kind: 'failed', path: name, detail });
    },
    recordLink(name, targetName) {
      const target = entries.get(targetName);
      entries.set(name, { kind: 'symlink', path: name, real: target.real });
    },
    recordLinkTo(name, real) {
      entries.set(name, { kind: 'symlink', path: name, real });
    },
    recordFileLookupMarker(name) {
      entries.set(name, { kind: 'absent', path: name, fileLookup: true });
    },
    descriptors() {
      return [...entries.values()]
        .filter((entry) => entry.fileLookup !== true)
        .map((entry) => ({
          kind: entry.kind,
          path: entry.path,
          real: entry.real ?? '',
          sha256: entry.sha256 ?? '',
          ...(entry.detail === undefined ? {} : { detail: entry.detail }),
        }));
    },
    readBytes(name) {
      readBacks.push(name);
      const entry = entries.get(name);
      if (entry === undefined) return undefined;
      return entry.kind === 'file' || entry.kind === 'config' ? entry.bytes : undefined;
    },
  };
}

// A workspace of real files, removed when the test ends.
function withWorkspace(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'baton-custody-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const paths = {};
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, name);
    writeFileSync(path, text);
    paths[name] = path;
  }
  return { dir, paths };
}

test('existence, canonical identity and exact bytes come from the retained set', (t) => {
  const { dir, paths } = withWorkspace(t, { root: 'law main()\n' });
  const set = createRetainedSet();
  set.recordFile(paths.root, paths.root);
  const acquisition = createRetainedAcquisition({ capture: set });

  const presence = acquisition.resolve(paths.root);
  assert.equal(presence.exists, true);
  assert.equal(presence.identity, realpathSync(paths.root), 'the canonical identity is the recorded real path');

  const answer = acquisition.read(presence.identity);
  assert.ok(answer.bytes instanceof Uint8Array);
  assert.equal(Buffer.from(answer.bytes).toString('utf8'), 'law main()\n');
  assert.equal(sha256Hex(answer.bytes), sha256Hex(Buffer.from('law main()\n')), 'the bytes are the accepted bytes');
  assert.equal(acquisition.resolve(realpathSync(paths.root)).identity, presence.identity, 'the canonical spelling resolves');
  assert.deepEqual(set.readBacks, [paths.root], 'one read per recorded file, at construction');
});

test('a file the set never recorded is never read, even while it exists on disk', (t) => {
  const { dir, paths } = withWorkspace(t, { recorded: 'a\n', unrecorded: 'b\n' });
  const set = createRetainedSet();
  set.recordFile(paths.recorded, paths.recorded);
  const acquisition = createRetainedAcquisition({ capture: set });

  assert.equal(acquisition.resolve(paths.unrecorded), undefined, 'no row means no existence answer');
  assert.equal(acquisition.read(paths.unrecorded), undefined, 'no row means no byte answer');
  assert.equal(set.readBacks.includes(paths.unrecorded), false, 'the unrecorded name was never read');
});

test('a recorded absence answers absent and a name with no row answers nothing', (t) => {
  const { dir, paths } = withWorkspace(t, { root: 'a\n' });
  const set = createRetainedSet();
  set.recordAbsent(join(dir, 'sibling.bend'));
  const acquisition = createRetainedAcquisition({ capture: set });

  const absent = acquisition.resolve(join(dir, 'sibling.bend'));
  assert.equal(absent.exists, false, 'a recorded absence states absence');
  assert.equal(absent.identity, join(dir, 'sibling.bend'));
  assert.equal(acquisition.resolve(join(dir, 'never-asked.bend')), undefined, 'a missing row states nothing');
});

test('a file-lookup marker row answers nothing', (t) => {
  const { dir, paths } = withWorkspace(t, { root: 'a\n' });
  const set = createRetainedSet();
  set.recordFileLookupMarker(join(dir, 'looked-up.bend'));
  set.recordDirectory(join(dir, 'a-directory'), dir);
  const acquisition = createRetainedAcquisition({ capture: set });

  assert.equal(acquisition.resolve(join(dir, 'looked-up.bend')), undefined, 'the marker row is not listed and not answered');
  const directory = acquisition.resolve(join(dir, 'a-directory'));
  assert.equal(directory.exists, true);
  assert.equal(directory.identity, realpathSync(dir));
});

test('the served bytes are the bytes captured, after the file changes on disk', (t) => {
  const { dir, paths } = withWorkspace(t, { root: 'original()\n' });
  const set = createRetainedSet();
  set.recordFile(paths.root, paths.root);
  const acquisition = createRetainedAcquisition({ capture: set });

  writeFileSync(paths.root, 'replaced()\n');
  const answer = acquisition.read(realpathSync(paths.root));
  assert.equal(Buffer.from(answer.bytes).toString('utf8'), 'original()\n', 'the retained bytes are served');
});

test('a directory row refuses as source input and a link row serves its recorded target', (t) => {
  const { dir, paths } = withWorkspace(t, { root: 'a\n' });
  const set = createRetainedSet();
  set.recordFile(paths.root, paths.root);
  set.recordDirectory(join(dir, 'a-directory'), dir);
  set.recordLink(join(dir, 'a-link'), paths.root);
  set.recordLink(join(dir, 'directory-link'), join(dir, 'a-directory'));
  set.recordLinkTo(join(dir, 'unrecorded-link'), join(dir, 'not-recorded.bend'));
  const acquisition = createRetainedAcquisition({ capture: set });

  const directory = acquisition.read(join(dir, 'a-directory'));
  assert.equal(directory.refuse, 'sourceInputKindUnsupported: directory');
  const link = acquisition.read(join(dir, 'a-link'));
  assert.equal(Buffer.from(link.bytes).toString('utf8'), 'a\n', 'the link serves the recorded target bytes');
  const directoryLink = acquisition.read(join(dir, 'directory-link'));
  assert.equal(
    directoryLink.refuse,
    'sourceInputKindUnsupported: directory',
    'the refusal names what the recorded target is',
  );
  const unrecorded = acquisition.read(join(dir, 'unrecorded-link'));
  assert.equal(unrecorded.refuse, 'sourceInputKindUnsupported: symlink');
  assert.equal(acquisition.resolve(join(dir, 'unrecorded-link')).identity, join(dir, 'not-recorded.bend'));
});

test('a failed row answers nothing and reports its detail', (t) => {
  const set = createRetainedSet();
  set.recordFailed('/work/unreadable.bend', 'unreadable');
  const acquisition = createRetainedAcquisition({ capture: set });

  assert.equal(acquisition.resolve('/work/unreadable.bend'), undefined, 'a failed probe is not an existence claim');
  assert.equal(acquisition.read('/work/unreadable.bend').refuse, 'captureFailed: unreadable');
});

test('aliases share one answer and differing digests refuse construction', (t) => {
  const { paths } = withWorkspace(t, { root: 'a\n' });
  const set = createRetainedSet();
  set.recordFile(paths.root, paths.root);
  set.recordFile(`${paths.root}-alias`, paths.root);
  const acquisition = createRetainedAcquisition({ capture: set });

  assert.equal(acquisition.resolve(`${paths.root}-alias`).identity, realpathSync(paths.root));
  assert.equal(
    acquisition.resolve(`${paths.root}-alias`),
    acquisition.resolve(paths.root),
    'the alias and its canonical identity share one answer object',
  );
  assert.deepEqual(set.readBacks, [paths.root], 'the alias was resolved without a second read');

  const conflicting = createRetainedAcquisition({
    capture: {
      descriptors: () => [
        { kind: 'file', path: paths.root, real: realpathSync(paths.root), sha256: sha256Hex(Buffer.from('a\n')) },
        { kind: 'file', path: `${paths.root}-alias`, real: realpathSync(paths.root), sha256: sha256Hex(Buffer.from('b\n')) },
      ],
      readBytes: (name) => new Uint8Array(Buffer.from(name === paths.root ? 'a\n' : 'b\n')),
    },
  });
  assert.equal(conflicting.status, 'refused');
  assert.equal(conflicting.reason, 'captureSetMalformed');
  assert.match(conflicting.detail, /different digests/);
});

test('the base is located by the pinned digest', (t) => {
  const { dir, paths } = withWorkspace(t, { base: 'type Empty is Data:\n', decoy: 'not the base\n' });
  const baseBytes = Buffer.from('type Empty is Data:\n');
  const pin = { path: 'bend2/base.bend', sha256: sha256Hex(baseBytes) };

  const set = createRetainedSet();
  set.recordFile(join(dir, 'installed-base.bend'), paths.base);
  set.recordFile('bend2/base.bend', paths.decoy);
  const acquisition = createRetainedAcquisition({ capture: set, basePin: pin });

  assert.equal(acquisition.baseBend, join(dir, 'installed-base.bend'), 'the digest selects the base, not the pinned name');
  assert.equal(
    Buffer.from(acquisition.read(acquisition.baseBend).bytes).toString('utf8'),
    Buffer.from(baseBytes).toString('utf8'),
  );

  const withoutBase = createRetainedAcquisition({ capture: set });
  assert.equal(withoutBase.baseBend, undefined, 'no pin means no base operand');

  const unmatched = createRetainedAcquisition({
    capture: set,
    basePin: { path: 'bend2/base.bend', sha256: sha256Hex(Buffer.from('some other base\n')) },
  });
  assert.equal(unmatched.baseBend, undefined, 'a pin whose digest no row carries selects no base');
});

test('a capture record is refused as an acquisition source', () => {
  const record = {
    captureKind: 'file',
    role: 'input',
    path: '/work/root.bend',
    marker: sha256Hex(Buffer.from('a\n')),
    payload: Buffer.from('a\n').toString('base64'),
    payloadEncoding: 'base64',
    producerModule: 'typescript',
    producerDigest: 'd'.repeat(64),
    producerOperation: 'sourceAnalysis',
  };
  assert.equal(isClaimedCaptureRecord(record), true);
  const refused = createRetainedAcquisition({ capture: record });
  assert.equal(refused.status, 'refused');
  assert.equal(refused.reason, 'claimedRecordNotCustody');
  assert.match(refused.detail, /retained captured set/);
});

test('a missing captured set is refused with the operand named', () => {
  const refused = createRetainedAcquisition({});
  assert.equal(refused.status, 'refused');
  assert.equal(refused.reason, 'custodyOperandMissing');
  assert.match(refused.detail, /descriptors\(\) and readBytes\(\)/);

  const shapeOnly = createRetainedAcquisition({ capture: { descriptors: () => [] } });
  assert.equal(shapeOnly.reason, 'custodyOperandMissing');
});

test('the claimed producing association is a claim carried beside the capture', (t) => {
  const { dir, paths } = withWorkspace(t, { root: 'a\n' });
  const set = createRetainedSet();
  set.recordFile(paths.root, paths.root);
  const producers = new Map([
    [paths.root, { module: 'typescript', digest: 'd'.repeat(64), operation: 'sourceAnalysis' }],
    ['/work/not-recorded.bend', { module: 'typescript', digest: 'e'.repeat(64), operation: 'sqlPlan' }],
  ]);
  const acquisition = createRetainedAcquisition({ capture: set, claimedProducers: producers });

  const association = acquisition.association(paths.root);
  assert.deepEqual(association, { module: 'typescript', digest: 'd'.repeat(64), operation: 'sourceAnalysis' });
  assert.equal(Object.isFrozen(association), true);
  assert.equal(acquisition.association(paths.root), association, 'the same claim object is returned');
  assert.equal(acquisition.association('/work/unclaimed.bend'), undefined);

  producers.set(paths.root, { module: 'other', digest: 'f'.repeat(64), operation: 'other' });
  assert.equal(acquisition.association(paths.root), association, 'a later write to the caller map changes nothing');

  assert.equal(
    acquisition.resolve('/work/not-recorded.bend'),
    undefined,
    'a claim adds no existence',
  );
  assert.equal(acquisition.read('/work/not-recorded.bend'), undefined, 'a claim adds no bytes');
  assert.equal(acquisition.resolve(paths.root).exists, true, 'the claim did not disturb the recorded answers');
});

test('malformed rows and malformed associations refuse construction', () => {
  const noKind = createRetainedAcquisition({ capture: { descriptors: () => [{ path: '/work/a.bend' }], readBytes: () => undefined } });
  assert.equal(noKind.reason, 'captureSetMalformed');
  assert.match(noKind.detail, /carries no kind/);

  const noBytes = createRetainedAcquisition({
    capture: { descriptors: () => [{ kind: 'file', path: '/work/a.bend', real: '/work/a.bend', sha256: 'a'.repeat(64) }], readBytes: () => undefined },
  });
  assert.equal(noBytes.reason, 'captureSetMalformed');
  assert.match(noBytes.detail, /bytes of \/work\/a\.bend are unavailable/);

  const throwing = createRetainedAcquisition({
    capture: { descriptors: () => { throw new Error('host gone'); }, readBytes: () => undefined },
  });
  assert.equal(throwing.reason, 'captureSetMalformed');
  assert.match(throwing.detail, /host gone/);

  const badClaim = createRetainedAcquisition({
    capture: { descriptors: () => [], readBytes: () => undefined },
    claimedProducers: new Map([['/work/a.bend', { module: 'typescript' }]]),
  });
  assert.equal(badClaim.reason, 'claimedProducerMalformed');
  assert.match(badClaim.detail, /carries no digest/);
});

test('answers are frozen and repeated questions return the identical object', (t) => {
  const { dir, paths } = withWorkspace(t, { root: 'a\n' });
  const set = createRetainedSet();
  set.recordFile(paths.root, paths.root);
  set.recordAbsent(join(dir, 'missing.bend'));
  const acquisition = createRetainedAcquisition({ capture: set });

  assert.equal(Object.isFrozen(acquisition), true);
  assert.equal(acquisition.resolve(paths.root), acquisition.resolve(paths.root));
  assert.equal(acquisition.read(paths.root), acquisition.read(paths.root));
  assert.equal(Object.isFrozen(acquisition.resolve(paths.root)), true);
  assert.equal(Object.isFrozen(acquisition.read(paths.root)), true);
  assert.equal(Object.isFrozen(acquisition.resolve(join(dir, 'missing.bend'))), true);
  assert.deepEqual(set.readBacks, [paths.root], 'immutability costs no extra reads');
});

function startQuery(adapter, identity) {
  const started = adapter.beginQuery({ identity });
  assert.equal(started.status, 'started');
  return started.token;
}

test('the operand drives the adapter: a shared record yields the settled two snapshot entries', (t) => {
  const { paths } = withWorkspace(t, { root: 'law main()\n' });
  const set = createRetainedSet();
  set.recordFile(paths.root, paths.root);
  const alias = `${paths.root}-alias`;
  set.recordFile(alias, paths.root);
  const acquisition = createRetainedAcquisition({ capture: set });
  const adapter = createFrontendAdapter({ acquisition, captureOnly: true });

  const owner = startQuery(adapter, alias);
  assert.equal(adapter.sink.readSource(alias, owner), 'law main()\n', 'the loader reads the retained bytes');
  const canonical = adapter.sink.resolveSource(realpathSync(paths.root), owner);
  assert.equal(canonical.status, 'captured');
  assert.equal(canonical.identity, realpathSync(paths.root));
  adapter.endQuery();

  const session = adapter.report().sessions[0];
  assert.equal(session.completeness, 'complete');
  assert.equal(
    session.acquisitions.length,
    2,
    'the requested key and the canonical key each carry the one shared record',
  );
  assert.deepEqual(
    session.acquisitions.map((entry) => entry.status),
    ['captured', 'captured'],
  );
  assert.deepEqual(
    [...new Set(session.acquisitions.map((entry) => entry.canonical))],
    [realpathSync(paths.root)],
    'the two snapshot entries name one canonical identity',
  );
  assert.deepEqual(set.readBacks, [paths.root], 'the retained set was read once for the shared record');
});

test('the operand drives the adapter: the base pin and the two non-capture answers', (t) => {
  const { dir, paths } = withWorkspace(t, { base: 'type Empty is Data:\n', root: 'law main()\n' });
  const baseBytes = Buffer.from('type Empty is Data:\n');
  const basePin = { path: 'bend2/base.bend', sha256: sha256Hex(baseBytes) };
  const set = createRetainedSet();
  set.recordFile(paths.root, paths.root);
  set.recordFile(join(dir, 'installed-base.bend'), paths.base);
  set.recordAbsent(join(dir, 'LAWS.bend'));
  const acquisition = createRetainedAcquisition({ capture: set, basePin });
  const adapter = createFrontendAdapter({ acquisition, captureOnly: true });

  const owner = startQuery(adapter, paths.root);
  const base = adapter.sink.baseBendPath(owner);
  assert.equal(base.status, 'captured');
  assert.equal(base.path, realpathSync(paths.base), 'the adapter reports the recorded canonical path');
  assert.equal(base.digest, basePin.sha256, 'the reported digest is the pinned digest of the accepted bytes');

  const sibling = adapter.sink.lookupSource(join(dir, 'LAWS.bend'), owner);
  assert.equal(sibling.status, 'absent', 'a recorded absence reaches the gate as an absence');
  assert.equal(adapter.counters.uncapturedDependencies, 0, 'a non-acquiring lookup counts no dependency');

  const unrecorded = adapter.sink.resolveSource(join(dir, 'not-in-the-set.bend'), owner);
  assert.equal(unrecorded.status, 'unavailable', 'a name with no row is not an absence claim');
  assert.equal(adapter.counters.uncapturedDependencies, 1, 'the unrecorded dependency is counted once');
  assert.equal(set.readBacks.includes(join(dir, 'not-in-the-set.bend')), false, 'the unrecorded name was never read');
  adapter.endQuery();
});
