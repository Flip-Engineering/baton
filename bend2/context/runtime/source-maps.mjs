// Source map v3 decoding and generated-to-original position lookup for
// runtime observation (docs/bend2/semantic-context-spec.md, Runtime contract;
// the recorded CDP research facts).
//
// Maps arrive through Debugger.scriptParsed.sourceMapURL as local files or
// embedded data URLs. Remote map fetch is unavailable and unknown schemes
// never become local paths; a relative local reference without a recorded
// generated base refuses instead of resolving against an unrecorded working
// directory. A mapping records the generated and mapped segment positions
// and the map digest; it does not reconstruct renamed runtime bindings from
// map names, and a segment lookup is segment-exact, not character-exact.
//
// Identity rules: a loaded map keeps separate identities. The source
// identities are the names in sources resolved against the map's own base
// first (a loaded file map resolves map-relative; an embedded map falls back
// to the generated script base; URL bases stay in URL space), the map
// identity is the SHA-256 of the raw map bytes - provenance only unless the
// caller supplied an expected digest to verify against - the read identity
// is the enforced file identity of the read itself, and the loaded/disk
// identities of the generated script belong to the caller's script record.
// None of these is derived from another.
//
// Read closure: local map reads go through createAdmittedFileReader. Every
// admission check - real-path closure membership and the file-identity
// binding - happens BEFORE any byte is read, and the identity checks are
// maintained after the read: descriptor identity, path re-resolution and
// size/mtime comparison refuse a replacement, including a same-size write
// that the inode binding alone would not surface. The binding is inode and
// digest based: a hard link shares an inode and can carry an admitted name,
// and no OS-permission boundary is claimed - the concrete guarantee is that
// the bytes read are the bytes bound to the admitted name at read time, and
// replacement afterwards is refused or surfaced in the recorded identity. A
// composer may inject its own readAdmitted capability, which then owns that
// enforcement; plain readFile injection is deliberately not offered.

import { createHash } from 'node:crypto';
import { closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
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

// Builds the enforced local reader for one admitted closure. Root resolution
// is lazy and refusal-shaped: a root that does not resolve surfaces as
// 'mapReadFailed' through the reader, never as a raw throw from
// construction.
//
// Admission ordering and the stated boundary: every admission check -
// real-path closure membership, the lstat identity binding, an immediate
// re-resolution, and the open with O_NOFOLLOW - happens BEFORE any byte is
// read. The immediate re-resolution catches the single parent-directory
// swap interleaving; the REMAINING supported scenario - parent-link changes
// across lstat, immediate re-resolution and open (outside/in/out) with the
// captured and opened inodes still matching - is an OPEN admission gap, not
// an accepted completed contract: documentation narrowing the claim does
// not close it. Within the covered checks the final path component cannot
// be swapped to a symlink (O_NOFOLLOW refuses it pre-read), and the after
// checks - descriptor identity, path re-resolution, size and nanosecond
// mtime/ctime comparison - refuse a replacement or a same-size content
// write that happened inside the covered interval.
//
// Timestamp limit, stated without an immutable-bytes claim: matching
// nanosecond timestamps do not PROVE the bytes never changed - a
// restoration that also restores timestamps, or a same-tick resolution
// residual, can suppress detection. The digest recorded beside the identity
// is the binding evidence for what was read; the boundary probes retained
// with this module exercise substitution and in-place-write intervals
// against these checks on admitted remote runs.
export function createAdmittedFileReader({ admittedRoots = [] } = {}) {
  let roots = null;
  const resolveRoots = () => {
    if (roots) return roots;
    try {
      roots = admittedRoots.map((root) => ({ requested: root, real: realpathSync(root) }));
    } catch (err) {
      throw new SourceMapError('mapReadFailed', `admitted root does not resolve: ${err.message}`);
    }
    return roots;
  };
  const inside = (candidate) =>
    resolveRoots().some((root) => {
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
    // Establish the admitted descriptor/path binding BEFORE any byte is read.
    let before;
    try {
      before = lstatSync(realPath, { bigint: true });
    } catch (err) {
      throw new SourceMapError('mapReadFailed', `${realPath} does not stat: ${err.message}`);
    }
    if (!before.isFile()) {
      throw new SourceMapError('mapReadFailed', `${realPath} is not a regular file`);
    }
    // Shrink the pre-open window: re-resolve immediately before the open.
    let immediate;
    try {
      immediate = realpathSync(realPath);
    } catch (err) {
      throw new SourceMapError('mapReplacedDuringRead', `${realPath} does not re-resolve before the open: ${err.message}`);
    }
    if (immediate !== realPath) {
      throw new SourceMapError('mapReplacedDuringRead', `${realPath} re-resolved to ${immediate} before the open`);
    }
    let fd = null;
    try {
      // O_NOFOLLOW refuses a final-component symlink swap that happened
      // after the re-resolution and before the read starts.
      fd = openSync(realPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      const opened = fstatSync(fd, { bigint: true });
      if (opened.dev !== before.dev || opened.ino !== before.ino) {
        throw new SourceMapError('mapReplacedDuringRead', `${realPath} changed identity between stat and open`);
      }
      const size = Number(opened.size);
      const bytes = Buffer.alloc(size);
      let offset = 0;
      while (offset < size) {
        const read = readSync(fd, bytes, offset, size - offset, offset);
        if (read === 0) break;
        offset += read;
      }
      if (offset !== size) {
        throw new SourceMapError('mapReplacedDuringRead', `${realPath} changed size during the read`);
      }
      const after = fstatSync(fd, { bigint: true });
      if (after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) {
        throw new SourceMapError('mapReplacedDuringRead', `${realPath} changed content or metadata during the read`);
      }
      closeSync(fd);
      fd = null;
      const afterStat = lstatSync(realPath, { bigint: true });
      if (
        afterStat.dev !== before.dev ||
        afterStat.ino !== before.ino ||
        afterStat.size !== before.size ||
        afterStat.mtimeNs !== before.mtimeNs ||
        afterStat.ctimeNs !== before.ctimeNs
      ) {
        throw new SourceMapError('mapReplacedDuringRead', `${realPath} named different content after the read`);
      }
      const finalReal = realpathSync(path);
      if (finalReal !== realPath || !inside(finalReal)) {
        throw new SourceMapError('mapReplacedDuringRead', `${path} re-resolved to ${finalReal} during the read`);
      }
      return {
        bytes,
        identity: {
          path,
          realPath,
          dev: before.dev.toString(),
          ino: before.ino.toString(),
          size: before.size.toString(),
          mtimeNs: before.mtimeNs.toString(),
          ctimeNs: before.ctimeNs.toString(),
        },
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
  // A relative local reference without a recorded base would otherwise
  // resolve against an unrecorded working directory.
  throw new SourceMapError('mapBaseUnrecorded', 'relative map reference has no recorded generated base');
}

// Reads and parses the map named by a script's recorded sourceMapURL.
//   sourceMapURL   the Debugger.scriptParsed.sourceMapURL string (or the
//                  cdp-scripts mapReference url)
//   generatedPath  absolute path of the generated script on disk; the base
//                  for relative map references; required for relative local
//                  references - absence refuses 'mapBaseUnrecorded' rather
//                  than resolving against an unrecorded directory
//   admittedRoots  absolute directories forming the admitted read closure,
//                  used by the default enforced reader
//   readAdmitted   optional composer capability (path) => {bytes, identity}
//                  that enforces the closure itself; when absent the default
//                  createAdmittedFileReader({admittedRoots}) enforces it
//   expectedDigest optional SHA-256 the map bytes must match; without it the
//                  recorded digest is provenance only
// Returns {sourceMapURL, origin:'file'|'embedded', path?, input?, digest,
// digestVerified, bytes, map} or a refusal {condition, sourceMapURL, ...}.
// Refusal conditions: 'remoteMapUnavailable', 'mapOutsideAdmittedRoots',
// 'mapReplacedDuringRead', 'missingMap', 'mapReadFailed',
// 'mapBaseUnrecorded', 'mapDigestMismatch', 'malformedDataUrl',
// 'malformedMap', 'unsupportedVersion', 'badVLQ', 'coordinateRangeExceeded',
// 'sourceUrlOutOfRange', 'nameOutOfRange'. This function does not throw
// refusal conditions.
export function loadSourceMap({ sourceMapURL, generatedPath = null, admittedRoots = [], readAdmitted, expectedDigest = null }) {
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
    return finishEmbedded({ sourceMapURL, bytes, expectedDigest });
  }
  if (SCHEME.test(sourceMapURL) && !sourceMapURL.startsWith('file://')) {
    return { condition: 'remoteMapUnavailable', sourceMapURL };
  }
  let mapPath;
  let read;
  try {
    mapPath = localMapPath(sourceMapURL, generatedPath);
    const reader = typeof readAdmitted === 'function' ? readAdmitted : createAdmittedFileReader({ admittedRoots });
    read = reader(mapPath);
  } catch (err) {
    if (err instanceof SourceMapError) {
      return { condition: err.condition, sourceMapURL, path: mapPath ?? null, detail: err.message };
    }
    return { condition: 'mapReadFailed', sourceMapURL, path: mapPath ?? null, detail: String(err) };
  }
  try {
    const digest = sha256Hex(read.bytes);
    if (expectedDigest !== null && expectedDigest !== undefined && digest !== expectedDigest) {
      return { condition: 'mapDigestMismatch', sourceMapURL, path: read.identity.realPath, digest, expectedDigest };
    }
    return {
      sourceMapURL,
      origin: 'file',
      path: read.identity.realPath,
      input: read.identity,
      digest,
      digestVerified: expectedDigest != null,
      bytes: read.bytes,
      map: parseSourceMapV3(read.bytes),
    };
  } catch (err) {
    return { condition: err.condition ?? 'malformedMap', sourceMapURL, path: read?.identity?.realPath ?? null, detail: err.message };
  }
}

function finishEmbedded({ sourceMapURL, bytes, expectedDigest }) {
  try {
    const digest = sha256Hex(bytes);
    if (expectedDigest !== null && expectedDigest !== undefined && digest !== expectedDigest) {
      return { condition: 'mapDigestMismatch', sourceMapURL, digest, expectedDigest };
    }
    return {
      sourceMapURL,
      origin: 'embedded',
      digest,
      digestVerified: expectedDigest != null,
      bytes,
      map: parseSourceMapV3(bytes),
    };
  } catch (err) {
    return { condition: err.condition ?? 'malformedMap', sourceMapURL, detail: err.message };
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
