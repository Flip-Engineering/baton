// The provider transport and the closed-schema validation of one TypeScript query.
//
// The admitted canonical request bytes are the request: the adapter never reads a request file and
// never rebuilds the request from a parsed object. A transitional unwrap accepts a single-member
// {"requestCanonical": "..."} frame so the adapter can run before core settles the transport;
// both shapes carry the same admitted bytes verbatim.
//
// Refusal conditions are fixed text and name the rule that refused. Request member values, paths
// and expressions never appear in a refusal, and provider stderr never does either.

import { pathToFileURL } from 'node:url';

export const REFUSAL_EXIT = 2;
export const FAILURE_EXIT = 1;

export class Refusal extends Error {
  constructor(condition, limits = []) {
    super(condition);
    this.name = 'Refusal';
    this.condition = condition;
    this.limits = limits;
  }
}

export class ProviderFailure extends Error {
  constructor(condition, detail) {
    super(detail ? `${condition}: ${detail}` : condition);
    this.name = 'ProviderFailure';
    this.condition = condition;
    this.detail = detail ?? null;
  }
}

export const CLASSIFICATIONS = ['observed', 'static-possible', 'checked', 'declared'];

export const PROJECTION_BITS = {
  definition: 1,
  type: 2,
  references: 4,
  calls: 8,
  callers: 16,
  dependencies: 32,
  diagnostics: 64,
  flow: 128,
  exceptions: 256,
  databaseAccesses: 512,
};

export const SOURCE_PROJECTION_MASK = 1023;
export const DIAGNOSTIC_PROJECTION_MASK = 449;

export const SOURCE_SUFFIXES = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];

const ROOT_KEYS = new Set(['version', 'engine', 'subject', 'select', 'cwd', 'options', 'effects']);
const OPTION_KEYS = new Set(['project', 'readRoots', 'database', 'client']);
const C_ONLY_OPTION_KEYS = new Set(['buildProvenance', 'security', 'analysis']);
const SUBJECT_KEYS = {
  position: new Set(['kind', 'path', 'line', 'column']),
  symbol: new Set(['kind', 'path', 'name', 'container']),
  diagnostic: new Set(['kind', 'path', 'line', 'column', 'code']),
};
const EFFECTS = new Set([
  'executeTarget',
  'planTargetSql',
  'replayMigrations',
  'evaluateRuntime',
  'controlRuntime',
]);
export const DATABASE_ENGINES = ['sqlite-schema', 'postgres-schema'];

export function subjectMask(kind) {
  if (kind === 'diagnostic') return DIAGNOSTIC_PROJECTION_MASK;
  return SOURCE_PROJECTION_MASK;
}

export function sourceSuffixMatches(path) {
  return SOURCE_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

export function selectMask(select) {
  let mask = 0;
  for (const name of select) mask |= PROJECTION_BITS[name] ?? 0;
  return mask;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(object, allowed, condition) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw new Refusal(condition);
  }
}

function requireU32(value, condition) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new Refusal(condition);
  return value;
}

function requireNonEmptyString(value, condition) {
  if (typeof value !== 'string' || value.length === 0) throw new Refusal(condition);
  return value;
}

export function validateRequest(value) {
  if (!isPlainObject(value)) throw new Refusal('context-request-invalid');
  rejectUnknownKeys(value, ROOT_KEYS, 'context-request-unknown-field');
  if (value.version !== 1) throw new Refusal('context-request-version');
  if (value.engine !== undefined && value.engine !== 'typescript' && value.engine !== 'auto') {
    throw new Refusal('context-request-engine');
  }
  const engine = value.engine ?? 'auto';

  const subject = value.subject;
  if (!isPlainObject(subject)) throw new Refusal('context-request-invalid');
  const kind = subject.kind;
  const subjectKeys = SUBJECT_KEYS[kind];
  if (subjectKeys === undefined) throw new Refusal('context-subject-unknown');
  rejectUnknownKeys(subject, subjectKeys, 'context-subject-unknown-field');
  const normalizedSubject = { kind };
  normalizedSubject.path = requireNonEmptyString(subject.path, 'context-subject-incomplete');
  if (!sourceSuffixMatches(normalizedSubject.path)) throw new Refusal('context-subject-unsupported-source');
  if (kind === 'position' || kind === 'diagnostic') {
    normalizedSubject.line = requireU32(subject.line, 'context-subject-incomplete');
    normalizedSubject.column = requireU32(subject.column, 'context-subject-incomplete');
  }
  if (kind === 'symbol') {
    normalizedSubject.name = requireNonEmptyString(subject.name, 'context-subject-incomplete');
    normalizedSubject.container = subject.container === undefined ? '' : subject.container;
    if (typeof normalizedSubject.container !== 'string') throw new Refusal('context-subject-incomplete');
  }
  if (kind === 'diagnostic') {
    normalizedSubject.code = requireNonEmptyString(subject.code, 'context-subject-incomplete');
  }

  if (!Array.isArray(value.select) || value.select.length === 0) throw new Refusal('context-select-empty');
  const select = [];
  const maskBits = new Set();
  for (const name of value.select) {
    if (typeof name !== 'string') throw new Refusal('context-projection-unknown');
    const bit = PROJECTION_BITS[name];
    if (bit === undefined) throw new Refusal('context-projection-unknown');
    if (maskBits.has(bit)) throw new Refusal('context-projection-duplicate');
    maskBits.add(bit);
    select.push(name);
  }
  const mask = selectMask(select);
  if ((mask & subjectMask(kind)) !== mask) throw new Refusal('context-projection-unsupported-for-subject');

  const cwd = requireNonEmptyString(value.cwd, 'context-cwd-missing');

  const options = value.options ?? {};
  if (!isPlainObject(options)) throw new Refusal('context-request-invalid');
  for (const key of Object.keys(options)) {
    if (C_ONLY_OPTION_KEYS.has(key)) throw new Refusal('context-option-unsupported-for-engine');
  }
  rejectUnknownKeys(options, OPTION_KEYS, 'context-option-unknown');
  const normalizedOptions = {
    project: options.project === undefined ? '' : requireNonEmptyString(options.project, 'context-option-invalid'),
    readRoots: [],
    database: null,
    client: null,
  };
  if (options.readRoots !== undefined) {
    if (!Array.isArray(options.readRoots)) throw new Refusal('context-option-invalid');
    for (const root of options.readRoots) {
      normalizedOptions.readRoots.push(requireNonEmptyString(root, 'context-option-invalid'));
    }
  }
  if (options.database !== undefined) {
    if (!isPlainObject(options.database)) throw new Refusal('context-option-invalid');
    const engineName = options.database.engine;
    if (!DATABASE_ENGINES.includes(engineName)) throw new Refusal('context-database-engine-unsupported');
    if (engineName === 'sqlite-schema') {
      normalizedOptions.database = {
        engine: engineName,
        path: requireNonEmptyString(options.database.path, 'context-database-path-missing'),
      };
    } else {
      normalizedOptions.database = {
        engine: engineName,
        connectionFile: requireNonEmptyString(
          options.database.connectionFile,
          'context-database-path-missing',
        ),
      };
    }
  }
  if (options.client !== undefined) {
    if (!isPlainObject(options.client)) throw new Refusal('context-option-invalid');
    normalizedOptions.client = {
      path: requireNonEmptyString(options.client.path, 'context-typescript-client-missing'),
      line: requireU32(options.client.line ?? 0, 'context-option-invalid'),
      column: requireU32(options.client.column ?? 0, 'context-option-invalid'),
    };
  }

  const effects = value.effects ?? [];
  if (!Array.isArray(effects)) throw new Refusal('context-request-invalid');
  for (const effect of effects) {
    if (!EFFECTS.has(effect)) throw new Refusal('context-effect-unknown');
  }

  const needsDatabase =
    subject.kind === 'position' || subject.kind === 'symbol' ? (mask & PROJECTION_BITS.databaseAccesses) !== 0 : false;
  if (needsDatabase) {
    if (normalizedOptions.database === null) throw new Refusal('context-database-path-missing');
    if (normalizedOptions.client === null) throw new Refusal('context-typescript-client-missing');
  }

  return { engine, subject: normalizedSubject, select, mask, cwd, options: normalizedOptions, effects };
}

export function decodeFrameBytes(bytes) {
  if (bytes.length === 0) throw new Refusal('context-request-empty');
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new Refusal('context-request-bom');
  if (bytes.includes(0)) throw new Refusal('context-request-nul');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Refusal('context-request-unreadable');
  }
  return text;
}

// The transitional unwrap: exactly one trailing newline is the frame terminator, and a
// single-member {"requestCanonical": "..."} object is unwrapped to the bytes it carries.
export function unwrapCanonical(text) {
  const trimmed = text.endsWith('\n') ? text.slice(0, -1) : text;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Refusal('context-request-invalid');
  }
  if (isPlainObject(parsed) && Object.keys(parsed).length === 1 && typeof parsed.requestCanonical === 'string') {
    return { canonicalText: parsed.requestCanonical, value: JSON.parse(parsed.requestCanonical) };
  }
  return { canonicalText: trimmed, value: parsed };
}

export function parseRequestBytes(bytes) {
  const text = decodeFrameBytes(bytes);
  const { canonicalText, value } = unwrapCanonical(text);
  return { request: validateRequest(value), canonicalText };
}

export function validateResult(result) {
  if (!isPlainObject(result) || result.version !== 1) {
    throw new ProviderFailure('result-shape-invalid', 'version');
  }
  for (const key of ['facts', 'relations', 'refs', 'limits']) {
    if (!Array.isArray(result[key])) throw new ProviderFailure('result-shape-invalid', key);
  }
  const ids = new Set();
  for (const item of [...result.facts, ...result.relations]) {
    if (typeof item.id !== 'string' || item.id.length === 0) {
      throw new ProviderFailure('result-shape-invalid', 'id');
    }
    if (ids.has(item.id)) throw new ProviderFailure('result-ids-not-unique', item.id);
    ids.add(item.id);
    if (!CLASSIFICATIONS.includes(item.classification)) {
      throw new ProviderFailure('result-classification-invalid', String(item.classification));
    }
    if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
      throw new ProviderFailure('result-evidence-missing', item.id);
    }
  }
  const refIds = new Set();
  for (const ref of result.refs) {
    if (typeof ref.id !== 'string' || ref.id.length === 0) {
      throw new ProviderFailure('result-shape-invalid', 'ref id');
    }
    if (refIds.has(ref.id)) throw new ProviderFailure('result-ref-ids-not-unique', ref.id);
    refIds.add(ref.id);
    if (typeof ref.snapshotId !== 'string' || ref.snapshotId.length === 0) {
      throw new ProviderFailure('result-ref-snapshot-missing', ref.id);
    }
  }
  return result;
}

export function refusalFrame(condition, query, engine = 'typescript') {
  return {
    version: 1,
    engine,
    query: query ?? null,
    error: { kind: 'validationRefusal', condition, limits: [] },
  };
}

export function writeFrame(frame) {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

export function moduleUrl(path) {
  return pathToFileURL(path).href;
}
