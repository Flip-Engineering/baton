// Source map v3 decoding and generated-to-original position lookup.
// Maps are local files or embedded data URLs reported by Debugger.scriptParsed.
// Relative map references use the generated script directory; original sources
// use the map directory, or the generated script directory for embedded maps.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUES = new Int32Array(128).fill(-1);
for (let i = 0; i < BASE64_CHARS.length; i += 1) {
  BASE64_VALUES[BASE64_CHARS.charCodeAt(i)] = i;
}

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

export class SourceMapError extends Error {
  constructor(condition, detail) {
    super(detail ?? condition);
    this.name = 'SourceMapError';
    this.condition = condition;
  }
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// Decodes one VLQ segment (for example "MAGQ" or "JACN") into its field
// values. Refuses unknown characters, truncated continuations and field
// counts other than 1, 4 and 5 by throwing a SourceMapError with condition
// 'badVLQ'. Accumulation is contained: a long zero continuation can drive
// the place value to Infinity and the running value to NaN, so both the
// value and its finiteness are checked after every accumulation and any
// overflow refuses with 'coordinateRangeExceeded'.
export function decodeVlqSegment(segment) {
  const values = [];
  let value = 0;
  let shift = 1;
  for (const ch of String(segment)) {
    const code = ch.charCodeAt(0);
    const digit = code < 128 ? BASE64_VALUES[code] : -1;
    if (digit < 0) {
      throw new SourceMapError('badVLQ', `invalid base64 VLQ character ${JSON.stringify(ch)}`);
    }
    value += (digit & 31) * shift;
    if (!Number.isFinite(value) || value > SAFE_INTEGER) {
      throw new SourceMapError('coordinateRangeExceeded', `segment ${JSON.stringify(segment)} leaves the exact safe-integer VLQ domain`);
    }
    shift *= 32;
    if ((digit & 32) === 0) {
      const negative = value % 2 === 1;
      const magnitude = Math.floor(value / 2);
      values.push(negative ? -magnitude : magnitude);
      value = 0;
      shift = 1;
    }
  }
  if (shift !== 1) {
    throw new SourceMapError('badVLQ', `truncated VLQ continuation in ${JSON.stringify(segment)}`);
  }
  if (values.length !== 1 && values.length !== 4 && values.length !== 5) {
    throw new SourceMapError('badVLQ', `segment ${JSON.stringify(segment)} carries ${values.length} fields`);
  }
  return values;
}

function advance(running, delta, field) {
  const next = running + delta;
  if (!Number.isSafeInteger(next)) {
    throw new SourceMapError('coordinateRangeExceeded', `${field} leaves the safe-integer domain`);
  }
  if (next < 0) {
    throw new SourceMapError('badVLQ', `${field} would go negative`);
  }
  return next;
}

// Decodes the mappings string into ordered segments with zero-based generated
// positions. Generated columns restart at every line. Source, line, column
// and name deltas follow the encoded order; decoded segments are sorted by
// generated position for lookup. Coordinates stay nonnegative and inside
// the safe-integer domain. Throws SourceMapError with
// conditions 'badVLQ' or 'coordinateRangeExceeded'.
export function decodeMappings(mappingsText) {
  const segments = [];
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let nameIndex = 0;
  const lines = String(mappingsText).split(';');
  for (let line = 0; line < lines.length; line += 1) {
    const raw = lines[line];
    if (raw === '') continue;
    let generatedColumn = 0;
    for (const part of raw.split(',')) {
      if (part === '') {
        throw new SourceMapError('badVLQ', 'empty mapping segment between separators');
      }
      const fields = decodeVlqSegment(part);
      generatedColumn = advance(generatedColumn, fields[0], 'generated column');
      const segment = { generatedLine: line, generatedColumn };
      if (fields.length >= 4) {
        sourceIndex = advance(sourceIndex, fields[1], 'source index');
        sourceLine = advance(sourceLine, fields[2], 'source line');
        sourceColumn = advance(sourceColumn, fields[3], 'source column');
        segment.sourceIndex = sourceIndex;
        segment.sourceLine = sourceLine;
        segment.sourceColumn = sourceColumn;
      }
      if (fields.length === 5) {
        nameIndex = advance(nameIndex, fields[4], 'name index');
        segment.nameIndex = nameIndex;
      }
      segments.push(segment);
    }
  }
  return segments.sort((a, b) => a.generatedLine - b.generatedLine || a.generatedColumn - b.generatedColumn);
}

// Parses a source map v3 document and returns the decoded map with its raw
// byte digest. Throws SourceMapError with conditions 'malformedMap',
// 'unsupportedVersion', 'badVLQ', 'coordinateRangeExceeded',
// 'sourceUrlOutOfRange' or 'nameOutOfRange'.
export function parseSourceMapV3(text) {
  const bytes = Buffer.isBuffer(text) ? text : Buffer.from(String(text), 'utf8');
  const digest = sha256Hex(bytes);
  let doc;
  try {
    doc = JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    throw new SourceMapError('malformedMap', `map text is not JSON: ${err.message}`);
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new SourceMapError('malformedMap', 'map document is not an object');
  }
  if (doc.version !== 3) {
    throw new SourceMapError('unsupportedVersion', `map declares version ${JSON.stringify(doc.version)}`);
  }
  if (!Array.isArray(doc.sources)) {
    throw new SourceMapError('malformedMap', 'sources is not an array');
  }
  if (typeof doc.mappings !== 'string') {
    throw new SourceMapError('malformedMap', 'mappings is not a string');
  }
  if (doc.names !== undefined && !Array.isArray(doc.names)) {
    throw new SourceMapError('malformedMap', 'names is not an array');
  }
  if (doc.sourcesContent !== undefined && !Array.isArray(doc.sourcesContent)) {
    throw new SourceMapError('malformedMap', 'sourcesContent is not an array');
  }
  if (doc.sourceRoot !== undefined && doc.sourceRoot !== null && typeof doc.sourceRoot !== 'string') {
    throw new SourceMapError('malformedMap', 'sourceRoot is not a string');
  }
  for (const entry of doc.sources) {
    if (entry !== null && typeof entry !== 'string') {
      throw new SourceMapError('malformedMap', 'sources entries are strings or null');
    }
  }
  const names = doc.names ?? [];
  for (const entry of names) {
    if (typeof entry !== 'string') {
      throw new SourceMapError('malformedMap', 'names entries are strings');
    }
  }
  if (Array.isArray(doc.sourcesContent)) {
    if (doc.sourcesContent.length !== doc.sources.length) {
      throw new SourceMapError('malformedMap', 'sourcesContent length does not correspond to sources');
    }
    for (const entry of doc.sourcesContent) {
      if (entry !== null && typeof entry !== 'string') {
        throw new SourceMapError('malformedMap', 'sourcesContent entries are strings or null');
      }
    }
  }
  const segments = decodeMappings(doc.mappings);
  for (const segment of segments) {
    if (segment.sourceIndex !== undefined && (segment.sourceIndex < 0 || segment.sourceIndex >= doc.sources.length)) {
      throw new SourceMapError('sourceUrlOutOfRange', `segment maps source index ${segment.sourceIndex}`);
    }
    if (segment.nameIndex !== undefined && (segment.nameIndex < 0 || segment.nameIndex >= names.length)) {
      throw new SourceMapError('nameOutOfRange', `segment maps name index ${segment.nameIndex}`);
    }
  }
  return {
    version: 3,
    file: typeof doc.file === 'string' ? doc.file : null,
    sourceRoot: typeof doc.sourceRoot === 'string' ? doc.sourceRoot : '',
    sources: doc.sources.slice(),
    sourcesContent: Array.isArray(doc.sourcesContent) ? doc.sourcesContent.slice() : null,
    names: names.slice(),
    mappings: doc.mappings,
    segments,
    digest,
  };
}

// Resolves one entry of sources for evidence. The base kind decides the
// relationship, in this precedence: a URL sourceRoot keeps the source in URL
// space; a file sourceRoot joins on the filesystem; otherwise a loaded map's
// own location (base.mapPath) is the map-relative base, the generated script
// base (base.generatedPath) applies when the map has no location of its own,
// and a URL base stays in URL space while a file base resolves on the
// filesystem. URL-shaped or data source entries pass through with their
// recorded spelling. A null source entry resolves to null. No URL is ever
// handed to the filesystem resolver.
export function resolveSourcePath(map, sourceIndex, base = null) {
  const source = map.sources[sourceIndex];
  if (source === null) return null;
  if (typeof source !== 'string') {
    throw new SourceMapError('malformedMap', 'source entry is not a string');
  }
  const sourceRoot = typeof map.sourceRoot === 'string' ? map.sourceRoot : '';
  if (SCHEME.test(sourceRoot) && !sourceRoot.startsWith('file://')) {
    const urlBase = sourceRoot.endsWith('/') ? sourceRoot : `${sourceRoot}/`;
    try {
      return new URL(source, urlBase).href;
    } catch (err) {
      throw new SourceMapError('malformedMap', `source does not join the URL sourceRoot: ${err.message}`);
    }
  }
  if (source.startsWith('data:') || SCHEME.test(source)) {
    return source;
  }
  if (sourceRoot.startsWith('file://')) {
    try {
      const urlBase = sourceRoot.endsWith('/') ? sourceRoot : `${sourceRoot}/`;
      return fileURLToPath(new URL(source, urlBase).href);
    } catch (err) {
      throw new SourceMapError('malformedMap', `source does not join the file sourceRoot: ${err.message}`);
    }
  }
  const mapPath = base && typeof base === 'object' ? base.mapPath ?? null : null;
  const generatedPath = base && typeof base === 'object' ? base.generatedPath ?? null : base;
  const baseLocation = mapPath ?? generatedPath;
  if (baseLocation && SCHEME.test(baseLocation)) {
    // A URL base - remote or file - resolves entirely in URL space with real
    // URL parsing, never raw text slicing: the directory drops the last
    // segment together with any query or fragment (a slash inside a query
    // is not a path separator), the sourceRoot then resolves against that
    // directory under URL semantics (a slash-leading sourceRoot is
    // origin-rooted), and the source joins last. A file:// result decodes
    // back to a filesystem path.
    let href;
    try {
      const directory = new URL('.', baseLocation);
      const root = sourceRoot ? new URL(sourceRoot.endsWith('/') ? sourceRoot : `${sourceRoot}/`, directory) : directory;
      href = new URL(source, root).href;
    } catch (err) {
      throw new SourceMapError('malformedMap', `source does not join the URL base: ${err.message}`);
    }
    return baseLocation.startsWith('file://') ? fileURLToPath(href) : href;
  }
  const fileBase = baseLocation ?? null;
  const rooted = sourceRoot
    ? (sourceRoot.endsWith('/') ? sourceRoot + source : `${sourceRoot}/${source}`)
    : source;
  if (isAbsolute(rooted)) return rooted;
  if (fileBase) return resolvePath(dirname(fileBase), rooted);
  return rooted;
}

function parseDataUrlMap(url) {
  const match = /^data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/.exec(url);
  if (!match) {
    throw new SourceMapError('malformedDataUrl', 'data URL does not split into type, parameters and payload');
  }
  const mimeType = match[1];
  const parameters = match[2];
  const payload = match[3];
  if (mimeType !== 'application/json') {
    throw new SourceMapError('malformedDataUrl', `unsupported data URL type ${JSON.stringify(mimeType)}`);
  }
  if (/;base64/i.test(parameters)) {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
      throw new SourceMapError('malformedDataUrl', 'data URL payload is not base64 text');
    }
    return Buffer.from(payload, 'base64');
  }
  return Buffer.from(decodeURIComponent(payload), 'utf8');
}

function localMapPath(sourceMapURL, generatedPath) {
  if (sourceMapURL.startsWith('file://')) {
    try {
      return fileURLToPath(sourceMapURL);
    } catch (err) {
      throw new SourceMapError('malformedMap', `file URL does not decode: ${err.message}`);
    }
  }
  if (isAbsolute(sourceMapURL)) return sourceMapURL;
  if (generatedPath) return resolvePath(dirname(generatedPath), sourceMapURL);
  // Relative local map references require the generated script directory.
  throw new SourceMapError('mapBaseUnrecorded', 'relative map reference has no recorded generated base');
}

// Loads a local file or embedded map. Relative local references require the
// generated script path. Missing, unreadable and malformed maps return their
// condition; remote map URLs return remoteMapUnavailable.
export function loadSourceMap({ sourceMapURL, generatedPath = null }) {
  if (typeof sourceMapURL !== 'string' || sourceMapURL === '') {
    return { condition: 'missingMap', sourceMapURL: sourceMapURL ?? null };
  }
  if (sourceMapURL.startsWith('data:')) {
    try {
      return loadedMap(sourceMapURL, 'embedded', parseDataUrlMap(sourceMapURL));
    } catch (err) {
      return { condition: err.condition ?? 'malformedDataUrl', sourceMapURL, detail: err.message };
    }
  }
  if (SCHEME.test(sourceMapURL) && !sourceMapURL.startsWith('file://')) {
    return { condition: 'remoteMapUnavailable', sourceMapURL };
  }
  let mapPath;
  let bytes;
  try {
    mapPath = localMapPath(sourceMapURL, generatedPath);
    bytes = readFileSync(mapPath);
  } catch (err) {
    return { condition: err.condition ?? (err.code === 'ENOENT' ? 'missingMap' : 'mapReadFailed'),
      sourceMapURL, path: mapPath ?? null, detail: err.message };
  }
  try {
    return loadedMap(sourceMapURL, 'file', bytes, mapPath);
  } catch (err) {
    return { condition: err.condition ?? 'malformedMap', sourceMapURL, path: mapPath, detail: err.message };
  }
}

function loadedMap(sourceMapURL, origin, bytes, path = null) {
  const map = parseSourceMapV3(bytes);
  return { sourceMapURL, origin, ...(path === null ? {} : { path }),
    digest: map.digest, bytes, map };
}

// Finds the mapping segment for a generated zero-based position: the last
// segment on that exact generated line whose generatedColumn is <= column.
// Returns {source, sourceIndex, line, column, name?, nameIndex?} or null.
// A generated line without segments, and a segment without a source mapping,
// map to nothing. The lookup is segment-exact; it does not claim
// character-exact fidelity, and map names never become runtime bindings.
export function originalPositionFor(map, { line, column }) {
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line < 0 || column < 0) {
    return null;
  }
  if (!map._lineIndex) {
    const index = [];
    for (let i = 0; i < map.segments.length; i += 1) {
      const generatedLine = map.segments[i].generatedLine;
      if (index.length === 0 || index[index.length - 1].generatedLine !== generatedLine) {
        index.push({ generatedLine, start: i });
      }
    }
    map._lineIndex = index;
  }
  const index = map._lineIndex;
  let low = 0;
  let high = index.length - 1;
  let at = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (index[mid].generatedLine === line) { at = mid; break; }
    if (index[mid].generatedLine < line) low = mid + 1; else high = mid - 1;
  }
  if (at === -1) return null;
  const end = at + 1 < index.length ? index[at + 1].start : map.segments.length;
  let best = null;
  for (let i = index[at].start; i < end; i += 1) {
    const segment = map.segments[i];
    if (segment.generatedColumn <= column) best = segment;
    else break;
  }
  if (!best || best.sourceIndex === undefined) return null;
  const result = {
    source: map.sources[best.sourceIndex],
    sourceIndex: best.sourceIndex,
    line: best.sourceLine,
    column: best.sourceColumn,
  };
  if (best.nameIndex !== undefined) {
    result.name = map.names[best.nameIndex];
    result.nameIndex = best.nameIndex;
  }
  return result;
}

// Convenience composition used by the stack mapper's caller: resolves a
// generated position through a loaded map and returns the original position
// with its resolved original path and the map digest for provenance, or null
// when the position maps to nothing. base carries the explicit composition
// of the map's own location (base.mapPath - the map-relative base, set from
// the loaded map's recorded path) and the generated script base
// (base.generatedPath - the fallback for embedded maps); a plain string is
// accepted as the generated base. URL bases stay in URL space; file bases
// resolve on the filesystem.
export function mapGeneratedPosition(map, { line, column }, base = null) {
  const found = originalPositionFor(map, { line, column });
  if (!found) return null;
  return {
    path: resolveSourcePath(map, found.sourceIndex, base),
    line: found.line,
    column: found.column,
    name: found.name ?? null,
    mapDigest: map.digest,
  };
}
