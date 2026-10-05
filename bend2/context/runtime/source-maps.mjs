// Source map v3 decoding and generated-to-original position lookup for
// runtime observation (docs/bend2/semantic-context-spec.md, Runtime contract;
// the recorded CDP research facts).
//
// Maps arrive through Debugger.scriptParsed.sourceMapURL as local files or
// embedded data URLs. Remote map fetch is unavailable and unknown schemes
// never become local paths. A mapping records the generated and mapped
// segment positions and the map digest; it does not reconstruct renamed
// runtime bindings from map names, and a segment lookup is segment-exact, not
// character-exact.
//
// Identity rules: a loaded map keeps separate identities. The source
// identities are the names in sources resolved against the map's own base
// (URL bases stay in URL space, file bases resolve on the filesystem), the
// map identity is the SHA-256 of the raw map bytes, the read identity is the
// enforced file identity of the read itself, and the loaded/disk identities
// of the generated script belong to the caller's script record. None of
// these is derived from another.
//
// Read closure: local map reads go through createAdmittedFileReader, which
// resolves real paths, refuses escapes from the admitted roots, and refuses a
// file replaced during the read. A composer may inject its own readAdmitted
// capability, which then owns that enforcement; plain readFile injection is
// deliberately not offered.

import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve as resolvePath } from 'node:path';
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

// Builds the enforced local reader for one admitted closure. Every admitted
// root is resolved to its own real path first. A read resolves the requested
// path's real location, refuses when it escapes the closure (a symlink inside
// an admitted root may not point outside), opens and reads through one file
// descriptor, and re-checks the path's identity afterwards so a replacement
// during the read refuses. The result carries the actual read identity.
export function createAdmittedFileReader({ admittedRoots = [] } = {}) {
  const roots = admittedRoots.map((root) => ({ requested: root, real: realpathSync(root) }));
  const inside = (candidate) =>
    roots.some((root) => {
      const rel = relative(root.real, candidate);
      return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
    });
  return function readAdmitted(path) {
    let realPath;
    try {
      realPath = realpathSync(path);
    } catch (err) {
      if (err && err.code === 'ENOENT') throw new SourceMapError('missingMap', `${path} does not resolve`);
      throw new SourceMapError('mapReadFailed', `${path} does not resolve: ${err.message}`);
    }
    if (!inside(realPath)) {
      throw new SourceMapError('mapOutsideAdmittedRoots', `${realPath} resolves outside every admitted root`);
    }
    let fd = null;
    try {
      fd = openSync(realPath, 'r');
      const before = fstatSync(fd);
      if (!before.isFile()) {
        throw new SourceMapError('mapReadFailed', `${realPath} is not a regular file`);
      }
      const bytes = Buffer.alloc(before.size);
      let offset = 0;
      while (offset < before.size) {
        const read = readSync(fd, bytes, offset, before.size - offset, offset);
        if (read === 0) break;
        offset += read;
      }
      if (offset !== before.size) {
        throw new SourceMapError('mapReplacedDuringRead', `${realPath} changed size during the read`);
      }
      const after = fstatSync(fd);
      if (after.size !== before.size) {
        throw new SourceMapError('mapReplacedDuringRead', `${realPath} changed size during the read`);
      }
      closeSync(fd);
      fd = null;
      const afterStat = lstatSync(realPath);
      if (afterStat.dev !== before.dev || afterStat.ino !== before.ino) {
        throw new SourceMapError('mapReplacedDuringRead', `${realPath} named a different file after the read`);
      }
      const finalReal = realpathSync(path);
      if (finalReal !== realPath || !inside(finalReal)) {
        throw new SourceMapError('mapReplacedDuringRead', `${path} re-resolved to ${finalReal} during the read`);
      }
      return {
        bytes,
        identity: { path, realPath, dev: before.dev, ino: before.ino, size: before.size },
      };
    } finally {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          // the read already failed; the close error is not the finding
        }
      }
    }
  };
}

// Decodes one VLQ segment (for example "MAGQ" or "JACN") into its field
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
    if (value > SAFE_INTEGER) {
      throw new SourceMapError('coordinateRangeExceeded', `segment ${JSON.stringify(segment)} overflows the safe-integer VLQ domain`);
    }
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
// positions. Generated columns restart at every line and must stay
// non-decreasing within a line; the source, line, column and name running
// state persists across lines and must stay inside the safe-integer domain
// and nonnegative. No U32 bound is applied: the bound is the exact numeric
// domain the arithmetic itself can answer for. Throws SourceMapError with
// conditions 'badVLQ', 'malformedMap' or 'coordinateRangeExceeded'.
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
      const previousColumn = generatedColumn;
      generatedColumn = advance(generatedColumn, fields[0], 'generated column');
      if (segments.length > 0 && generatedColumn < previousColumn) {
        throw new SourceMapError('malformedMap', 'generated columns decrease within one line');
      }
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
  return segments;
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
// relationship: a URL sourceRoot keeps the source in URL space (file:// roots
// come back as absolute paths), a file source joins the map-relative or
// generated-relative filesystem base, and URL-shaped or data entries pass
// through with their recorded spelling. A null source entry resolves to null.
// No URL is ever handed to the filesystem resolver.
export function resolveSourcePath(map, sourceIndex, generatedPath = null) {
  const source = map.sources[sourceIndex];
  if (source === null) return null;
  if (typeof source !== 'string') {
    throw new SourceMapError('malformedMap', 'source entry is not a string');
  }
  const sourceRoot = typeof map.sourceRoot === 'string' ? map.sourceRoot : '';
  if (SCHEME.test(sourceRoot) && !sourceRoot.startsWith('file://')) {
    const base = sourceRoot.endsWith('/') ? sourceRoot : `${sourceRoot}/`;
    try {
      return new URL(source, base).href;
    } catch (err) {
      throw new SourceMapError('malformedMap', `source does not join the URL sourceRoot: ${err.message}`);
    }
  }
  if (source.startsWith('data:') || SCHEME.test(source)) {
    return source;
  }
  if (sourceRoot.startsWith('file://')) {
    try {
      const base = sourceRoot.endsWith('/') ? sourceRoot : `${sourceRoot}/`;
      return fileURLToPath(new URL(source, base).href);
    } catch (err) {
      throw new SourceMapError('malformedMap', `source does not join the file sourceRoot: ${err.message}`);
    }
  }
  const rooted = sourceRoot
    ? (sourceRoot.endsWith('/') ? sourceRoot + source : `${sourceRoot}/${source}`)
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

// Reads and parses the map named by a script's recorded sourceMapURL.
//   sourceMapURL   the Debugger.scriptParsed.sourceMapURL string (or the
//                  cdp-scripts mapReference url)
//   generatedPath  absolute path of the generated script on disk; the base
//                  for relative map references; null when unknown
//   admittedRoots  absolute directories forming the admitted read closure,
//                  used by the default enforced reader
//   readAdmitted   optional composer capability (path) => {bytes, identity}
//                  that enforces the closure itself; when absent the default
//                  createAdmittedFileReader({admittedRoots}) enforces it
// Returns {sourceMapURL, origin:'file'|'embedded', path?, input?, digest,
// bytes, map} or a refusal {condition, sourceMapURL, ...}. Refusal
// conditions: 'remoteMapUnavailable', 'mapOutsideAdmittedRoots',
// 'mapReplacedDuringRead', 'missingMap', 'mapReadFailed', 'malformedDataUrl',
// 'malformedMap', 'unsupportedVersion', 'badVLQ', 'coordinateRangeExceeded',
// 'sourceUrlOutOfRange', 'nameOutOfRange'. This function does not throw
// refusal conditions.
export function loadSourceMap({ sourceMapURL, generatedPath = null, admittedRoots = [], readAdmitted }) {
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
  if (SCHEME.test(sourceMapURL) && !sourceMapURL.startsWith('file://')) {
    return { condition: 'remoteMapUnavailable', sourceMapURL };
  }
  let mapPath;
  try {
    mapPath = localMapPath(sourceMapURL, generatedPath);
  } catch (err) {
    return { condition: err.condition ?? 'malformedMap', sourceMapURL, detail: err.message };
  }
  const reader = typeof readAdmitted === 'function' ? readAdmitted : createAdmittedFileReader({ admittedRoots });
  let read;
  try {
    read = reader(mapPath);
  } catch (err) {
    if (err instanceof SourceMapError) {
      return { condition: err.condition, sourceMapURL, path: mapPath, detail: err.message };
    }
    return { condition: 'mapReadFailed', sourceMapURL, path: mapPath, detail: String(err) };
  }
  try {
    return {
      sourceMapURL,
      origin: 'file',
      path: read.identity.realPath,
      input: read.identity,
      digest: sha256Hex(read.bytes),
      bytes: read.bytes,
      map: parseSourceMapV3(read.bytes),
    };
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
// with its resolved original path (URL bases keep their URL spelling) and the
// map digest for provenance, or null when the position maps to nothing.
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
