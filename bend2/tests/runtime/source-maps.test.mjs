// Unit laws for source map decoding, lookup and admitted-closure loading
// against the hand-authored compiled fixture pair (fixtures/fixture-ts.js +
// fixture-ts.js.map). These tests pin decoder behavior, identity rules,
// refusal conditions and the structural numeric bounds; the real provider
// path (scriptParsed wiring, mapped pause frames, embedded maps) is
// exercised by cdp-fixture.test.mjs and the production admission by
// cdp-composition.test.mjs, all on remote runners.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SourceMapError,
  decodeVlqSegment,
  decodeMappings,
  parseSourceMapV3,
  loadSourceMap,
  createAdmittedFileReader,
  originalPositionFor,
  resolveSourcePath,
  mapGeneratedPosition,
} from '../../context/runtime/source-maps.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');
const MAP_JSON = readFileSync(join(FIXTURES, 'fixture-ts.js.map'), 'utf8');
const MAP_TEXT_BYTES = Buffer.from(MAP_JSON, 'utf8');

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Test-side VLQ encoder used to build structural vectors the shipped
// fixtures do not contain (huge magnitudes, negative deltas).
function encodeVlqNumber(value) {
  let vlq = value < 0 ? -value * 2 + 1 : value * 2;
  let out = '';
  do {
    let digit = vlq % 32;
    vlq = Math.floor(vlq / 32);
    if (vlq > 0) digit += 32;
    out += BASE64_CHARS[digit];
  } while (vlq > 0);
  return out;
}

function conditionOf(fn) {
  try {
    fn();
  } catch (err) {
    if (err instanceof SourceMapError) return err.condition;
    throw err;
  }
  throw new Error('expected a SourceMapError');
}

test('VLQ segment decoding follows base64 VLQ with signed single-byte fields', () => {
  assert.deepEqual(decodeVlqSegment('A'), [0]);
  assert.deepEqual(decodeVlqSegment('AAAA'), [0, 0, 0, 0]);
  assert.deepEqual(decodeVlqSegment('D'), [-1]);
  assert.deepEqual(decodeVlqSegment('H'), [-3]);
  assert.deepEqual(decodeVlqSegment('gB'), [16]);
  assert.deepEqual(decodeVlqSegment('OAGE'), [7, 0, 3, 2]);
  assert.deepEqual(decodeVlqSegment('MAGQ'), [6, 0, 3, 8]);
  assert.deepEqual(decodeVlqSegment('JACN'), [-4, 0, 1, -6]);
  assert.deepEqual(decodeVlqSegment(encodeVlqNumber(-6)), [-6]);
});

test('VLQ decoding refuses unknown characters, truncated continuations and bad field counts', () => {
  assert.equal(conditionOf(() => decodeVlqSegment('!')), 'badVLQ');
  assert.equal(conditionOf(() => decodeVlqSegment('')), 'badVLQ');
  assert.equal(conditionOf(() => decodeVlqSegment('g')), 'badVLQ');
  assert.equal(conditionOf(() => decodeVlqSegment('AAA')), 'badVLQ');
  assert.equal(conditionOf(() => decodeVlqSegment('AAAAAA')), 'badVLQ');
});

test('VLQ accumulation is bounded by the safe-integer domain, not a U32 rule', () => {
  const huge = encodeVlqNumber(2 ** 54);
  assert.equal(conditionOf(() => decodeVlqSegment(huge)), 'coordinateRangeExceeded');
  // Values inside the exact safe-integer domain decode exactly.
  assert.deepEqual(decodeVlqSegment(encodeVlqNumber(2 ** 30)), [2 ** 30]);
});

test('mapping segments decode with per-line generated columns and persistent source state', () => {
  const segments = decodeMappings(';MAGQ;JACN;;');
  assert.deepEqual(segments, [
    { generatedLine: 1, generatedColumn: 6, sourceIndex: 0, sourceLine: 3, sourceColumn: 8 },
    { generatedLine: 2, generatedColumn: 2, sourceIndex: 0, sourceLine: 4, sourceColumn: 2 },
  ]);
  assert.deepEqual(decodeMappings(''), []);
});

test('empty segments between separators refuse', () => {
  assert.equal(conditionOf(() => decodeMappings('A,,A')), 'badVLQ');
});

test('running coordinate state must stay nonnegative and inside the safe-integer domain', () => {
  // generated column below zero
  assert.equal(conditionOf(() => decodeMappings(`${encodeVlqNumber(10)},${encodeVlqNumber(-20)}`)), 'badVLQ');
  // source line below zero
  const negativeSourceLine = `${encodeVlqNumber(0)},${encodeVlqNumber(0)},${encodeVlqNumber(-1)},${encodeVlqNumber(0)}`;
  assert.equal(conditionOf(() => decodeMappings(negativeSourceLine)), 'badVLQ');
  // source line beyond the safe-integer domain
  const hugeSourceLine = `${encodeVlqNumber(0)},${encodeVlqNumber(0)},${encodeVlqNumber(2 ** 54)},${encodeVlqNumber(0)}`;
  assert.equal(conditionOf(() => decodeMappings(hugeSourceLine)), 'coordinateRangeExceeded');
});

test('generated columns must not decrease within one line', () => {
  // A positive delta after a larger column still increases; encode a
  // decreasing chain through the negative delta form.
  const decreasing = `${encodeVlqNumber(10)},${encodeVlqNumber(-4)}`;
  assert.equal(conditionOf(() => decodeMappings(decreasing)), 'badVLQ');
});

test('source map v3 parsing keeps sources, sourceRoot, names and the raw byte digest', () => {
  const map = parseSourceMapV3(MAP_TEXT_BYTES);
  assert.equal(map.version, 3);
  assert.equal(map.file, 'fixture-ts.js');
  assert.deepEqual(map.sources, ['fixture-ts.ts']);
  assert.equal(map.sourceRoot, '');
  assert.deepEqual(map.names, []);
  assert.equal(map.digest, createHash('sha256').update(MAP_TEXT_BYTES).digest('hex'));
  assert.equal(map.segments.length, 2);
  assert.equal(map.sourcesContent[0].includes('const adjusted'), true);
});

test('parsing refuses non-JSON, wrong versions and bad shapes', () => {
  assert.equal(conditionOf(() => parseSourceMapV3('{not json')), 'malformedMap');
  assert.equal(conditionOf(() => parseSourceMapV3('[]')), 'malformedMap');
  assert.equal(conditionOf(() => parseSourceMapV3(JSON.stringify({ version: 2, sources: [], mappings: '' }))), 'unsupportedVersion');
  assert.equal(conditionOf(() => parseSourceMapV3(JSON.stringify({ version: 3, sources: 'a', mappings: '' }))), 'malformedMap');
  assert.equal(conditionOf(() => parseSourceMapV3(JSON.stringify({ version: 3, sources: [], mappings: 5 }))), 'malformedMap');
  assert.equal(conditionOf(() => parseSourceMapV3(JSON.stringify({ version: 3, sources: [], mappings: '', names: {} }))), 'malformedMap');
  assert.equal(conditionOf(() => parseSourceMapV3(JSON.stringify({ version: 3, sourceRoot: 4, sources: [], mappings: '' }))), 'malformedMap');
});

test('sources, names and sourcesContent element domains are checked', () => {
  const badSource = JSON.stringify({ version: 3, sources: [5], mappings: '' });
  assert.equal(conditionOf(() => parseSourceMapV3(badSource)), 'malformedMap');
  const badName = JSON.stringify({ version: 3, sources: ['a.ts'], names: [null], mappings: '' });
  assert.equal(conditionOf(() => parseSourceMapV3(badName)), 'malformedMap');
  const badContent = JSON.stringify({ version: 3, sources: ['a.ts'], sourcesContent: [7], mappings: '' });
  assert.equal(conditionOf(() => parseSourceMapV3(badContent)), 'malformedMap');
  // The admitted domains still hold: null source entries and null content
  // entries are legal.
  const legal = parseSourceMapV3(JSON.stringify({ version: 3, sources: [null], sourcesContent: [null], names: [], mappings: '' }));
  assert.deepEqual(legal.sources, [null]);
});

test('segment indices outside sources or names refuse', () => {
  const missingSource = JSON.stringify({ version: 3, sources: ['only.ts'], mappings: 'ACAA' });
  assert.equal(conditionOf(() => parseSourceMapV3(missingSource)), 'sourceUrlOutOfRange');
  const missingName = JSON.stringify({ version: 3, sources: ['a.ts'], names: [], mappings: 'ACAAA' });
  assert.equal(conditionOf(() => parseSourceMapV3(missingName)), 'nameOutOfRange');
});

test('originalPositionFor finds the last segment at or before the generated column on that line', () => {
  const map = parseSourceMapV3(MAP_TEXT_BYTES);
  assert.deepEqual(originalPositionFor(map, { line: 1, column: 6 }), {
    source: 'fixture-ts.ts', sourceIndex: 0, line: 3, column: 8,
  });
  assert.deepEqual(originalPositionFor(map, { line: 1, column: 500 }), {
    source: 'fixture-ts.ts', sourceIndex: 0, line: 3, column: 8,
  });
  assert.equal(originalPositionFor(map, { line: 1, column: 5 }), null);
  assert.deepEqual(originalPositionFor(map, { line: 2, column: 2 }), {
    source: 'fixture-ts.ts', sourceIndex: 0, line: 4, column: 2,
  });
  assert.equal(originalPositionFor(map, { line: 0, column: 0 }), null);
  assert.equal(originalPositionFor(map, { line: 9, column: 0 }), null);
  assert.equal(originalPositionFor(map, { line: -1, column: 0 }), null);
});

test('a generated-only mapping segment maps to nothing', () => {
  const generatedOnly = parseSourceMapV3(JSON.stringify({ version: 3, sources: ['a.ts'], names: [], mappings: 'A' }));
  assert.equal(originalPositionFor(generatedOnly, { line: 0, column: 0 }), null);
});

test('resolveSourcePath keeps URL bases in URL space and file bases on the filesystem', () => {
  const urlRoot = parseSourceMapV3(JSON.stringify({
    version: 3, sourceRoot: 'https://cdn.example/app/', sources: ['a.ts', 'nested/b.ts'], names: [], mappings: '',
  }));
  assert.equal(resolveSourcePath(urlRoot, 0, '/work/gen.js'), 'https://cdn.example/app/a.ts');
  assert.equal(resolveSourcePath(urlRoot, 1, '/work/gen.js'), 'https://cdn.example/app/nested/b.ts');
  // A sourceRoot without a trailing slash still joins at the last segment.
  const urlRootNoSlash = parseSourceMapV3(JSON.stringify({
    version: 3, sourceRoot: 'https://cdn.example/app', sources: ['a.ts'], names: [], mappings: '',
  }));
  assert.equal(resolveSourcePath(urlRootNoSlash, 0, null), 'https://cdn.example/app/a.ts');

  const fileRoot = parseSourceMapV3(JSON.stringify({
    version: 3, sourceRoot: 'file:///work/src/', sources: ['a.ts'], names: [], mappings: '',
  }));
  assert.equal(resolveSourcePath(fileRoot, 0, null), join('/work', 'src', 'a.ts'));

  const rooted = parseSourceMapV3(JSON.stringify({
    version: 3, sourceRoot: 'src', sources: ['a.ts'], names: [], mappings: '',
  }));
  assert.equal(resolveSourcePath(rooted, 0, '/work/gen.js'), join('/work', 'src', 'a.ts'));
  const plain = parseSourceMapV3(JSON.stringify({ version: 3, sources: ['a.ts'], names: [], mappings: '' }));
  assert.equal(resolveSourcePath(plain, 0, '/work/gen.js'), join('/work', 'a.ts'));
  const absolute = parseSourceMapV3(JSON.stringify({ version: 3, sources: ['/lib/a.ts'], names: [], mappings: '' }));
  assert.equal(resolveSourcePath(absolute, 0, '/work/gen.js'), '/lib/a.ts');
  const dataEntry = parseSourceMapV3(JSON.stringify({ version: 3, sources: ['data:text/plain,x'], names: [], mappings: '' }));
  assert.equal(resolveSourcePath(dataEntry, 0, null), 'data:text/plain,x');
  const nullEntry = parseSourceMapV3(JSON.stringify({ version: 3, sources: [null], names: [], mappings: '' }));
  assert.equal(resolveSourcePath(nullEntry, 0, null), null);
});

test('loadSourceMap reads a local map through the enforced reader with its read identity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-values-sm-'));
  try {
    const mapPath = join(dir, 'fixture-ts.js.map');
    writeFileSync(mapPath, MAP_JSON);
    const loaded = loadSourceMap({
      sourceMapURL: 'fixture-ts.js.map',
      generatedPath: join(dir, 'fixture-ts.js'),
      admittedRoots: [dir],
    });
    assert.equal(loaded.condition, undefined);
    assert.equal(loaded.origin, 'file');
    assert.equal(loaded.path, realpathSync(mapPath));
    assert.equal(loaded.input.realPath, realpathSync(mapPath));
    assert.equal(loaded.input.size, String(MAP_TEXT_BYTES.length), 'identity sizes are exact decimal text of the bigint stats');
    assert.notEqual(loaded.input.ino, undefined);
    assert.equal(loaded.digest, createHash('sha256').update(MAP_TEXT_BYTES).digest('hex'));
    assert.equal(loaded.map.sources[0], 'fixture-ts.ts');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadSourceMap resolves relative references against the generated script directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-values-sm-'));
  try {
    mkdirSync(join(dir, 'maps'));
    writeFileSync(join(dir, 'maps', 'm.map'), MAP_JSON);
    const loaded = loadSourceMap({
      sourceMapURL: 'maps/m.map',
      generatedPath: join(dir, 'build', 'gen.js'),
      admittedRoots: [dir],
    });
    assert.equal(loaded.condition, undefined);
    assert.equal(loaded.origin, 'file');
    assert.equal(loaded.path, realpathSync(join(dir, 'maps', 'm.map')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadSourceMap accepts embedded base64 and percent-encoded data URLs', () => {
  const base64 = `data:application/json;base64,${MAP_TEXT_BYTES.toString('base64')}`;
  const embedded = loadSourceMap({ sourceMapURL: base64, generatedPath: null, admittedRoots: [] });
  assert.equal(embedded.condition, undefined);
  assert.equal(embedded.origin, 'embedded');
  assert.equal(embedded.digest, createHash('sha256').update(MAP_TEXT_BYTES).digest('hex'));

  const percent = `data:application/json,${encodeURIComponent(MAP_JSON)}`;
  const decoded = loadSourceMap({ sourceMapURL: percent, generatedPath: null, admittedRoots: [] });
  assert.equal(decoded.condition, undefined);
  assert.equal(decoded.origin, 'embedded');
  assert.equal(decoded.map.segments.length, 2);
});

test('loadSourceMap refuses remote and unknown schemes before any path resolution', () => {
  assert.equal(loadSourceMap({ sourceMapURL: 'https://example.com/m.map' }).condition, 'remoteMapUnavailable');
  assert.equal(loadSourceMap({ sourceMapURL: 'http://127.0.0.1:9/m.map' }).condition, 'remoteMapUnavailable');
  assert.equal(loadSourceMap({ sourceMapURL: 'webpack:///./src/a.ts.map' }).condition, 'remoteMapUnavailable');
  assert.equal(loadSourceMap({ sourceMapURL: 'blob:https://example.com/uuid' }).condition, 'remoteMapUnavailable');
  assert.equal(loadSourceMap({ sourceMapURL: 'data:text/plain,abc' }).condition, 'malformedDataUrl');
  assert.equal(loadSourceMap({ sourceMapURL: 'data:application/json;base64,!!!!' }).condition, 'malformedDataUrl');
});

test('a symlink inside an admitted root may not point outside the closure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-values-sm-'));
  try {
    const outsideDir = mkdtempSync(join(tmpdir(), 'runtime-values-sm-out-'));
    const outsideMap = join(outsideDir, 'secret.map');
    writeFileSync(outsideMap, MAP_JSON);
    const link = join(dir, 'link.map');
    symlinkSync(outsideMap, link);
    const refusal = loadSourceMap({
      sourceMapURL: 'link.map',
      generatedPath: join(dir, 'gen.js'),
      admittedRoots: [dir],
    });
    assert.equal(refusal.condition, 'mapOutsideAdmittedRoots');
    assert.ok(String(refusal.detail).includes(realpathSync(outsideMap)));
    rmSync(outsideDir, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a symlink chain that stays inside the admitted closure reads with its real identity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-values-sm-'));
  try {
    const realMap = join(dir, 'real.map');
    writeFileSync(realMap, MAP_JSON);
    symlinkSync('real.map', join(dir, 'alias.map'));
    const loaded = loadSourceMap({
      sourceMapURL: 'alias.map',
      generatedPath: join(dir, 'gen.js'),
      admittedRoots: [dir],
    });
    assert.equal(loaded.condition, undefined);
    assert.equal(loaded.input.realPath, realpathSync(realMap));
    assert.equal(loaded.digest, createHash('sha256').update(MAP_TEXT_BYTES).digest('hex'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a requested path that never resolves inside the closure refuses by name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-values-sm-'));
  const other = mkdtempSync(join(tmpdir(), 'runtime-values-sm-'));
  try {
    writeFileSync(join(dir, 'm.map'), MAP_JSON);
    const refusal = loadSourceMap({
      sourceMapURL: 'm.map',
      generatedPath: join(dir, 'gen.js'),
      admittedRoots: [other],
    });
    assert.equal(refusal.condition, 'mapOutsideAdmittedRoots');
    const rel = relative(realpathSync(other), realpathSync(join(dir, 'm.map')));
    assert.ok(rel.startsWith('..'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test('loadSourceMap reports missing, unreadable and malformed local maps with distinct conditions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-values-sm-'));
  try {
    assert.equal(
      loadSourceMap({ sourceMapURL: 'absent.map', generatedPath: join(dir, 'gen.js'), admittedRoots: [dir] }).condition,
      'missingMap',
    );
    writeFileSync(join(dir, 'broken.map'), '{not json');
    assert.equal(
      loadSourceMap({ sourceMapURL: 'broken.map', generatedPath: join(dir, 'gen.js'), admittedRoots: [dir] }).condition,
      'malformedMap',
    );
    writeFileSync(join(dir, 'v2.map'), JSON.stringify({ version: 2, sources: [], mappings: '' }));
    assert.equal(
      loadSourceMap({ sourceMapURL: 'v2.map', generatedPath: join(dir, 'gen.js'), admittedRoots: [dir] }).condition,
      'unsupportedVersion',
    );
    mkdirSync(join(dir, 'adirectory.map'));
    assert.equal(
      loadSourceMap({ sourceMapURL: 'adirectory.map', generatedPath: join(dir, 'gen.js'), admittedRoots: [dir] }).condition,
      'mapReadFailed',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the injected read capability owns enforcement and its refusal renders verbatim; an accepted override is the capability contract', () => {
  // The composer capability contract: a readAdmitted injection owns the
  // enforcement, so loadSourceMap calls it verbatim and surfaces its
  // conditions unchanged.
  const dir = mkdtempSync(join(tmpdir(), 'runtime-values-sm-'));
  try {
    writeFileSync(join(dir, 'm.map'), MAP_JSON);
    const accepted = loadSourceMap({
      sourceMapURL: 'm.map',
      generatedPath: join(dir, 'gen.js'),
      admittedRoots: [],
      readAdmitted: () => ({
        bytes: MAP_TEXT_BYTES,
        identity: { path: 'injected', realPath: 'injected', dev: '0', ino: '0', size: String(MAP_TEXT_BYTES.length) },
      }),
    });
    // The injected capability answered with the complete decimal-string
    // identity, so the map loads; the identity shown is the injected one and
    // the path evidence carries it.
    assert.equal(accepted.condition, undefined);
    assert.equal(accepted.input.path, 'injected');
    const missingPath = loadSourceMap({
      sourceMapURL: 'm.map',
      generatedPath: join(dir, 'gen.js'),
      admittedRoots: [],
      readAdmitted: () => ({ bytes: MAP_TEXT_BYTES, identity: { realPath: 'injected', dev: '0', ino: '0', size: '1' } }),
    });
    assert.equal(missingPath.condition, 'readCapabilityIdentityMissing');
    const numericIdentity = loadSourceMap({
      sourceMapURL: 'm.map',
      generatedPath: join(dir, 'gen.js'),
      admittedRoots: [],
      readAdmitted: () => ({ bytes: MAP_TEXT_BYTES, identity: { path: 'injected', realPath: 'injected', dev: 0, ino: 0, size: MAP_TEXT_BYTES.length } }),
    });
    assert.equal(numericIdentity.condition, 'readCapabilityIdentityMissing', 'the identity fields are decimal strings, not numbers');
    const refusing = loadSourceMap({
      sourceMapURL: 'm.map',
      generatedPath: join(dir, 'gen.js'),
      admittedRoots: [],
      readAdmitted: () => {
        throw new SourceMapError('mapOutsideAdmittedRoots', 'injected capability refused');
      },
    });
    assert.equal(refusing.condition, 'mapOutsideAdmittedRoots');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a relative local reference without a recorded base refuses instead of using the cwd', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-values-sm-'));
  try {
    writeFileSync(join(dir, 'm.map'), MAP_JSON);
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      const refusal = loadSourceMap({ sourceMapURL: 'm.map', generatedPath: null, admittedRoots: [dir] });
      assert.equal(refusal.condition, 'mapBaseUnrecorded');
    } finally {
      process.chdir(previousCwd);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an expected digest verifies the recorded bytes; mismatch refuses by name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-values-sm-'));
  try {
    writeFileSync(join(dir, 'm.map'), MAP_JSON);
    const digest = createHash('sha256').update(MAP_TEXT_BYTES).digest('hex');
    const verified = loadSourceMap({
      sourceMapURL: 'm.map',
      generatedPath: join(dir, 'gen.js'),
      admittedRoots: [dir],
      expectedDigest: digest,
    });
    assert.equal(verified.condition, undefined);
    assert.equal(verified.digestVerified, true);
    const mismatch = loadSourceMap({
      sourceMapURL: 'm.map',
      generatedPath: join(dir, 'gen.js'),
      admittedRoots: [dir],
      expectedDigest: '00'.repeat(32),
    });
    assert.equal(mismatch.condition, 'mapDigestMismatch');
    const provenanceOnly = loadSourceMap({
      sourceMapURL: 'm.map',
      generatedPath: join(dir, 'gen.js'),
      admittedRoots: [dir],
    });
    assert.equal(provenanceOnly.condition, undefined);
    assert.equal(provenanceOnly.digestVerified, false, 'without an expected digest the recorded digest is provenance only');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing admitted root refuses through the reader instead of throwing at construction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-values-sm-'));
  try {
    writeFileSync(join(dir, 'm.map'), MAP_JSON);
    const missingRoot = join(dir, 'does-not-exist');
    const refusal = loadSourceMap({
      sourceMapURL: 'm.map',
      generatedPath: join(dir, 'gen.js'),
      admittedRoots: [missingRoot],
    });
    assert.equal(refusal.condition, 'mapReadFailed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('source map structural parsing checks sourcesContent correspondence', () => {
  const shortContent = JSON.stringify({ version: 3, sources: ['a.ts', 'b.ts'], sourcesContent: ['let a\n'], mappings: '' });
  assert.equal(conditionOf(() => parseSourceMapV3(shortContent)), 'malformedMap');
  const matching = parseSourceMapV3(JSON.stringify({ version: 3, sources: ['a.ts'], sourcesContent: ['let a\n'], mappings: '' }));
  assert.equal(matching.sourcesContent.length, 1);
});

test('VLQ place-value overflow through long continuations is contained', () => {
  // 'g' is a zero continuation digit; enough of them drive the place value
  // past the finite double range, where the running value would go Infinity
  // and then NaN without an explicit check.
  const overflowing = 'g'.repeat(210) + 'B';
  assert.equal(conditionOf(() => decodeVlqSegment(overflowing)), 'coordinateRangeExceeded');
});

test('resolveSourcePath composes the map base before the generated base, and URL bases stay URL', () => {
  const plain = parseSourceMapV3(JSON.stringify({ version: 3, sources: ['a.ts'], names: [], mappings: '' }));
  // A loaded local map's own location is the map-relative base and wins over
  // the generated script base.
  assert.equal(
    resolveSourcePath(plain, 0, { mapPath: '/maps/m.map', generatedPath: '/work/gen.js' }),
    join('/maps', 'a.ts'),
  );
  // Without a map location (embedded maps) the generated base applies.
  assert.equal(resolveSourcePath(plain, 0, { mapPath: null, generatedPath: '/work/gen.js' }), join('/work', 'a.ts'));
  // A URL generated base keeps the source in URL space.
  assert.equal(
    resolveSourcePath(plain, 0, { mapPath: null, generatedPath: 'https://cdn.example/app/bundle.js' }),
    'https://cdn.example/app/a.ts',
  );
  // A plain string base is still accepted as the generated base.
  assert.equal(resolveSourcePath(plain, 0, '/work/gen.js'), join('/work', 'a.ts'));
});

test('URL bases apply the sourceRoot in URL space before the source joins', () => {
  const plain = parseSourceMapV3(JSON.stringify({ version: 3, sources: ['a.ts'], names: [], mappings: '' }));
  // A generated bundle URL base without a sourceRoot resolves against the
  // bundle's directory.
  assert.equal(
    resolveSourcePath(plain, 0, { mapPath: null, generatedPath: 'https://cdn.example/app/bundle.js' }),
    'https://cdn.example/app/a.ts',
  );
  // A relative sourceRoot applies inside the URL directory BEFORE the source
  // joins; a file URL base decodes to the filesystem path with the same
  // composition.
  const rooted = parseSourceMapV3(JSON.stringify({ version: 3, sourceRoot: 'src', sources: ['a.ts'], names: [], mappings: '' }));
  assert.equal(
    resolveSourcePath(rooted, 0, { mapPath: null, generatedPath: 'https://cdn.example/app/bundle.js' }),
    'https://cdn.example/app/src/a.ts',
  );
  assert.equal(
    resolveSourcePath(rooted, 0, { mapPath: 'file:///srv/maps/m.map', generatedPath: null }),
    join('/srv', 'maps', 'src', 'a.ts'),
  );
});

test('mapGeneratedPosition composes the original path with the map digest for provenance', () => {
  const map = parseSourceMapV3(MAP_TEXT_BYTES);
  const named = parseSourceMapV3(JSON.stringify({
    version: 3, sources: ['a.ts'], sourcesContent: ['let x\n'], names: ['origName'], mappings: 'AAAAA',
  }));
  assert.deepEqual(mapGeneratedPosition(named, { line: 0, column: 0 }, '/work/gen.js'), {
    path: join('/work', 'a.ts'), line: 0, column: 0, name: 'origName', mapDigest: named.digest,
  });
  assert.equal(mapGeneratedPosition(map, { line: 0, column: 0 }), null);
});
