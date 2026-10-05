// Unit laws for source map decoding and lookup against the hand-authored
// compiled fixture pair (fixtures/fixture-ts.js + fixture-ts.js.map). These
// tests pin decoder behavior, identity rules and refusal conditions; the real
// provider path (scriptParsed wiring, mapped pause frames, embedded maps) is
// exercised by cdp-fixture.test.mjs on a remote runner.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SourceMapError,
  decodeVlqSegment,
  decodeMappings,
  parseSourceMapV3,
  loadSourceMap,
  originalPositionFor,
  resolveSourcePath,
  mapGeneratedPosition,
} from '../../context/runtime/source-maps.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');
const MAP_JSON = readFileSync(join(FIXTURES, 'fixture-ts.js.map'), 'utf8');
const MAP_TEXT_BYTES = Buffer.from(MAP_JSON, 'utf8');

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
  assert.deepEqual(decodeVlqSegment('JACA'), [-4, 0, 1, 0]);
});

test('VLQ decoding refuses unknown characters, truncated continuations and bad field counts', () => {
  assert.equal(conditionOf(() => decodeVlqSegment('!')), 'badVLQ');
  assert.equal(conditionOf(() => decodeVlqSegment('')), 'badVLQ');
  assert.equal(conditionOf(() => decodeVlqSegment('g')), 'badVLQ');
  assert.equal(conditionOf(() => decodeVlqSegment('AAA')), 'badVLQ');
  assert.equal(conditionOf(() => decodeVlqSegment('AAAAAA')), 'badVLQ');
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

test('a mapping segment without a source maps to nothing', () => {
  const map = parseSourceMapV3(JSON.stringify({ version: 3, sources: ['a.ts'], names: [], mappings: 'AAAA' }));
  // single-field generated-only segment
  const generatedOnly = parseSourceMapV3(JSON.stringify({ version: 3, sources: ['a.ts'], names: [], mappings: 'A' }));
  assert.equal(originalPositionFor(generatedOnly, { line: 0, column: 0 }), null);
});

test('resolveSourcePath honors sourceRoot and the generated script base, preserving URL entries', () => {
  const rooted = parseSourceMapV3(JSON.stringify({
    version: 3, sourceRoot: 'src', sources: ['a.ts'], names: [], mappings: '',
  }));
  assert.equal(resolveSourcePath(rooted, 0, '/work/gen.js'), join('/work', 'src', 'a.ts'));
  const plain = parseSourceMapV3(JSON.stringify({ version: 3, sources: ['a.ts'], names: [], mappings: '' }));
  assert.equal(resolveSourcePath(plain, 0, '/work/gen.js'), join('/work', 'a.ts'));
  const absolute = parseSourceMapV3(JSON.stringify({ version: 3, sources: ['/lib/a.ts'], names: [], mappings: '' }));
  assert.equal(resolveSourcePath(absolute, 0, '/work/gen.js'), '/lib/a.ts');
  const data = parseSourceMapV3(JSON.stringify({ version: 3, sources: ['data:text/plain,x'], names: [], mappings: '' }));
  assert.equal(resolveSourcePath(data, 0, null), 'data:text/plain,x');
});

test('loadSourceMap reads a local map inside the admitted closure with its raw digest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-values-sm-'));
  try {
    const mapPath = join(dir, 'fixture-ts.js.map');
    writeFileSync(mapPath, MAP_JSON);
    const loaded = loadSourceMap({
      sourceMapURL: 'fixture-ts.js.map',
      generatedPath: join(dir, 'fixture-ts.js'),
      admittedRoots: [dir],
      readFile: (p) => readFileSync(p),
    });
    assert.equal(loaded.condition, undefined);
    assert.equal(loaded.origin, 'file');
    assert.equal(loaded.path, mapPath);
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
      readFile: (p) => readFileSync(p),
    });
    assert.equal(loaded.condition, undefined);
    assert.equal(loaded.origin, 'file');
    assert.equal(loaded.path, join(dir, 'maps', 'm.map'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadSourceMap accepts embedded base64 and percent-encoded data URLs', () => {
  const base64 = `data:application/json;base64,${MAP_TEXT_BYTES.toString('base64')}`;
  const embedded = loadSourceMap({ sourceMapURL: base64, generatedPath: null, admittedRoots: [], readFile: () => { throw new Error('must not read'); } });
  assert.equal(embedded.condition, undefined);
  assert.equal(embedded.origin, 'embedded');
  assert.equal(embedded.digest, createHash('sha256').update(MAP_TEXT_BYTES).digest('hex'));

  const percent = `data:application/json,${encodeURIComponent(MAP_JSON)}`;
  const decoded = loadSourceMap({ sourceMapURL: percent, generatedPath: null, admittedRoots: [], readFile: () => { throw new Error('must not read'); } });
  assert.equal(decoded.condition, undefined);
  assert.equal(decoded.origin, 'embedded');
  assert.equal(decoded.map.segments.length, 2);
});

test('loadSourceMap refuses remote fetch and malformed data URLs', () => {
  assert.equal(loadSourceMap({ sourceMapURL: 'https://example.com/m.map', readFile: () => {} }).condition, 'remoteMapUnavailable');
  assert.equal(loadSourceMap({ sourceMapURL: 'http://127.0.0.1:9/m.map', readFile: () => {} }).condition, 'remoteMapUnavailable');
  assert.equal(loadSourceMap({ sourceMapURL: 'data:text/plain,abc', readFile: () => {} }).condition, 'malformedDataUrl');
  assert.equal(loadSourceMap({ sourceMapURL: 'data:application/json;base64,!!!!', readFile: () => {} }).condition, 'malformedDataUrl');
});

test('loadSourceMap refuses maps outside the admitted read closure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-values-sm-'));
  const other = mkdtempSync(join(tmpdir(), 'runtime-values-sm-'));
  try {
    writeFileSync(join(dir, 'm.map'), MAP_JSON);
    const refusal = loadSourceMap({
      sourceMapURL: 'm.map',
      generatedPath: join(dir, 'gen.js'),
      admittedRoots: [other],
      readFile: (p) => readFileSync(p),
    });
    assert.equal(refusal.condition, 'mapOutsideAdmittedRoots');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test('loadSourceMap reports missing, unreadable and malformed local maps with distinct conditions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-values-sm-'));
  try {
    assert.equal(
      loadSourceMap({ sourceMapURL: 'absent.map', generatedPath: join(dir, 'gen.js'), admittedRoots: [dir], readFile: (p) => readFileSync(p) }).condition,
      'missingMap',
    );
    writeFileSync(join(dir, 'broken.map'), '{not json');
    assert.equal(
      loadSourceMap({ sourceMapURL: 'broken.map', generatedPath: join(dir, 'gen.js'), admittedRoots: [dir], readFile: (p) => readFileSync(p) }).condition,
      'malformedMap',
    );
    writeFileSync(join(dir, 'v2.map'), JSON.stringify({ version: 2, sources: [], mappings: '' }));
    assert.equal(
      loadSourceMap({ sourceMapURL: 'v2.map', generatedPath: join(dir, 'gen.js'), admittedRoots: [dir], readFile: (p) => readFileSync(p) }).condition,
      'unsupportedVersion',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
