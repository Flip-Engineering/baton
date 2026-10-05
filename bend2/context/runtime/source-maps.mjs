// Source map v3 decoding and generated-to-original position lookup for
// runtime observation (docs/bend2/semantic-context-spec.md, Runtime contract;
// the recorded CDP research facts).
//
// Maps arrive through Debugger.scriptParsed.sourceMapURL as local files or
// embedded data URLs. Remote map fetch is unavailable. A mapping records the
// generated and mapped segment positions and the map digest; it does not
// reconstruct renamed runtime bindings from map names, and a segment lookup is
// segment-exact, not character-exact.
//
// Identity rules: a loaded map keeps three separate identities. The source
// identities are the names in sources joined with sourceRoot, the map identity
// is the SHA-256 of the raw map bytes, and the loaded/disk identities of the
// generated script belong to the caller's script record. None of the three is
// derived from another.

import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join as joinPath, relative, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUES = new Int32Array(128).fill(-1);
for (let i = 0; i < BASE64_CHARS.length; i += 1) {
  BASE64_VALUES[BASE64_CHARS.charCodeAt(i)] = i;
}

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

// Decodes one VLQ segment (for example "MAGQ" or "JACA") into its field
// values. Refuses unknown characters, truncated continuations and field counts
// other than 1, 4 and 5 by throwing a SourceMapError with condition 'badVLQ'.
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

// Decodes the mappings string into ordered segments with zero-based generated
// positions. Generated columns restart at every line; the source, line,
// column and name running state persists across lines. Throws SourceMapError
// with condition 'badVLQ' on malformed input.
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
      generatedColumn += fields[0];
      const segment = { generatedLine: line, generatedColumn };
      if (fields.length >= 4) {
        sourceIndex += fields[1];
        sourceLine += fields[2];
        sourceColumn += fields[3];
        segment.sourceIndex = sourceIndex;
        segment.sourceLine = sourceLine;
        segment.sourceColumn = sourceColumn;
      }
      if (fields.length === 5) {
        nameIndex += fields[4];
        segment.nameIndex = nameIndex;
      }
      segments.push(segment);
    }
  }
  return segments;
}

// Parses a source map v3 document and returns the decoded map with its raw
// byte digest. Throws SourceMapError with conditions 'malformedMap',
// 'unsupportedVersion', 'badVLQ', 'sourceUrlOutOfRange' or 'nameOutOfRange'.
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
  const names = doc.names ?? [];
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

// Joins one entry of sources with the map's sourceRoot. A relative entry
// resolves against the generated script's directory when its path is known;
// URL-shaped entries (data:, file://, http(s)://) pass through unchanged. The
// recorded spelling of the source entry is preserved in the returned string.
export function resolveSourcePath(map, sourceIndex, generatedPath = null) {
  const source = map.sources[sourceIndex];
  if (typeof source !== 'string') {
    throw new SourceMapError('malformedMap', 'source entry is not a string');
  }
  if (source.startsWith('data:') || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(source)) {
    return source;
  }
  const rooted = map.sourceRoot
    ? (map.sourceRoot.endsWith('/') ? map.sourceRoot + source : map.sourceRoot + '/' + source)
    : source;
  if (isAbsolute(rooted)) return rooted;
  if (generatedPath) return resolvePath(dirname(generatedPath), rooted);
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
  return resolvePath(sourceMapURL);
}

function insideRoots(mapPath, admittedRoots) {
  for (const root of admittedRoots) {
    const rel = relative(root, mapPath);
    if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) return true;
  }
  return false;
}

// Reads and parses the map named by a script's recorded sourceMapURL.
//   sourceMapURL   the Debugger.scriptParsed.sourceMapURL string
//   generatedPath  absolute path of the generated script on disk; the base for
//                  relative map references; null when unknown
//   admittedRoots  absolute directories forming the admitted read closure; a
//                  local map must resolve inside one of them
//   readFile       (path) => Buffer; the composer binds its own read policy
// Returns {sourceMapURL, origin:'file'|'embedded', path?, digest, bytes, map}
// or a refusal {condition, sourceMapURL, ...}. Refusal conditions:
// 'remoteMapUnavailable', 'mapOutsideAdmittedRoots', 'missingMap',
// 'mapReadFailed', 'malformedDataUrl', 'malformedMap', 'unsupportedVersion',
// 'badVLQ', 'sourceUrlOutOfRange', 'nameOutOfRange'. This function does not
// throw refusal conditions.
export function loadSourceMap({ sourceMapURL, generatedPath = null, admittedRoots = [], readFile }) {
  if (typeof sourceMapURL !== 'string' || sourceMapURL === '') {
    return { condition: 'missingMap', sourceMapURL: sourceMapURL ?? null };
  }
  if (sourceMapURL.startsWith('data:')) {
    let bytes;
    try {
      bytes = parseDataUrlMap(sourceMapURL);
    } catch (err) {
      return { condition: err.condition ?? 'malformedDataUrl', sourceMapURL, detail: err.message };
    }
    try {
      return { sourceMapURL, origin: 'embedded', digest: sha256Hex(bytes), bytes, map: parseSourceMapV3(bytes) };
    } catch (err) {
      return { condition: err.condition ?? 'malformedMap', sourceMapURL, detail: err.message };
    }
  }
  if (/^(?:http|https|ws|wss|ftp):\/\//i.test(sourceMapURL)) {
    return { condition: 'remoteMapUnavailable', sourceMapURL };
  }
  let mapPath;
  try {
    mapPath = localMapPath(sourceMapURL, generatedPath);
  } catch (err) {
    return { condition: err.condition ?? 'malformedMap', sourceMapURL, detail: err.message };
  }
  if (!insideRoots(mapPath, admittedRoots)) {
    return { condition: 'mapOutsideAdmittedRoots', sourceMapURL, path: mapPath };
  }
  let bytes;
  try {
    bytes = readFile(mapPath);
  } catch (err) {
    const condition = err && err.code === 'ENOENT' ? 'missingMap' : 'mapReadFailed';
    return { condition, sourceMapURL, path: mapPath, detail: String((err && err.message) ?? err) };
  }
  try {
    return { sourceMapURL, origin: 'file', path: mapPath, digest: sha256Hex(bytes), bytes, map: parseSourceMapV3(bytes) };
  } catch (err) {
    return { condition: err.condition ?? 'malformedMap', sourceMapURL, path: mapPath, detail: err.message };
  }
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
// with its absolute original path and the map digest for provenance, or null
// when the position maps to nothing.
export function mapGeneratedPosition(map, { line, column }, generatedPath = null) {
  const found = originalPositionFor(map, { line, column });
  if (!found) return null;
  return {
    path: resolveSourcePath(map, found.sourceIndex, generatedPath),
    line: found.line,
    column: found.column,
    name: found.name ?? null,
    mapDigest: map.digest,
  };
}
