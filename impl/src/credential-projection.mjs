import {
  chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, writeSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

// #245: identity stores GROW by design (the omp agent.db carries session history — the
// 2026-08-20 campaign's reached 1.36MB and killed every member at spawn under the old
// 1MiB default). 8MiB/file, 32MiB total accommodates years of growth while the oversize
// guard still catches pathological sources (the pin refuses a 64MiB file).
const DEFAULT_FILE_LIMIT = 8 * 1024 * 1024;
const DEFAULT_TOTAL_LIMIT = 32 * 1024 * 1024;
const SECRET_ASSIGNMENT = /(?:api[_-]?key|token|secret|password)\s*=\s*["']([^"']{8,})["']/gi;

function projectionError(code) {
  return Object.assign(new Error(`credential projection refused (${code})`), { code });
}

function privateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function assertOwnedSafeDirectory(path) {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw projectionError('source_path_unsafe');
  const uid = process.getuid?.();
  if (uid !== undefined && stat.uid !== BigInt(uid)) throw projectionError('source_owner_mismatch');
  if ((Number(stat.mode) & 0o022) !== 0) throw projectionError('source_directory_writable');
  return stat;
}

function normalizeRelativeFile(value) {
  if (typeof value !== 'string' || value.length === 0 || isAbsolute(value) || value.includes('\0')) {
    throw projectionError('relative_path_invalid');
  }
  const normalized = value.split(/[\\/]+/).filter(Boolean);
  if (normalized.length === 0 || normalized.some((part) => part === '.' || part === '..')) {
    throw projectionError('relative_path_invalid');
  }
  return normalized.join(sep);
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function collectRedactions(relativeFile, bytes, output) {
  const text = bytes.toString('utf8');
  const credentialShaped = relativeFile.includes(`${sep}credentials${sep}`)
    || relativeFile.startsWith(`credentials${sep}`)
    || /(?:^|[._-])(?:auth|credential|key)(?:[._-]|$)/iu.test(relativeFile);
  if (credentialShaped && relativeFile.endsWith('.json')) {
    try {
      const visit = (value, key = '') => {
        if (typeof value === 'string') {
          if (value.length >= 8 && /(?:api[_-]?key|token|secret|password|credential)/i.test(key)) output.add(value);
          return;
        }
        if (Array.isArray(value)) { for (const item of value) visit(item, key); return; }
        if (value && typeof value === 'object') for (const [childKey, item] of Object.entries(value)) visit(item, childKey);
      };
      visit(JSON.parse(text));
    } catch { throw projectionError('credential_json_invalid'); }
  } else if (credentialShaped) {
    const secret = text.trim();
    if (secret.length >= 8) output.add(secret);
  }
  if (relativeFile.endsWith('config.toml')) {
    for (const match of text.matchAll(SECRET_ASSIGNMENT)) output.add(match[1]);
  }
}

function redactStrings(value, secrets, depth = 0) {
  if (depth > 64) throw projectionError('provider_frame_too_deep');
  if (typeof value === 'string') {
    let result = value;
    for (const secret of secrets) result = result.split(secret).join('[REDACTED]');
    return result;
  }
  if (Array.isArray(value)) return value.map((item) => redactStrings(item, secrets, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactStrings(item, secrets, depth + 1)]));
  }
  return value;
}

/**
 * Copies a fixed, relative allow-list from an owned source tree into a fresh private tree.
 * No source path or credential name is returned; the optional frame redactor stays in memory.
 */
export function projectCredentialTree(options = {}) {
  const sourceRoot = options.sourceRoot;
  const targetRoot = options.targetRoot;
  const relativeFiles = options.relativeFiles ?? [];
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_FILE_LIMIT;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_TOTAL_LIMIT;
  if (typeof sourceRoot !== 'string' || typeof targetRoot !== 'string') throw projectionError('root_invalid');
  if (!Array.isArray(relativeFiles) || relativeFiles.length === 0) throw projectionError('allowlist_empty');
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0
    || !Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < maxFileBytes) throw projectionError('limit_invalid');

  assertOwnedSafeDirectory(sourceRoot);
  privateDirectory(targetRoot);
  const redactions = new Set();
  let totalBytes = 0;
  let count = 0;

  for (const input of relativeFiles) {
    const relativeFile = normalizeRelativeFile(input);
    const source = join(sourceRoot, relativeFile);
    const escaped = relative(sourceRoot, source);
    if (escaped.startsWith(`..${sep}`) || escaped === '..' || isAbsolute(escaped)) throw projectionError('relative_path_invalid');

    let cursor = sourceRoot;
    for (const segment of dirname(relativeFile).split(sep).filter((part) => part && part !== '.')) {
      cursor = join(cursor, segment);
      assertOwnedSafeDirectory(cursor);
    }

    const before = lstatSync(source, { bigint: true });
    const uid = process.getuid?.();
    if (!before.isFile() || before.isSymbolicLink()) throw projectionError('source_file_unsafe');
    if (uid !== undefined && before.uid !== BigInt(uid)) throw projectionError('source_owner_mismatch');
    if ((Number(before.mode) & 0o022) !== 0) throw projectionError('source_file_writable');
    if (before.size > BigInt(maxFileBytes)) throw projectionError('source_file_oversize');

    let descriptor;
    let bytes;
    try {
      descriptor = openSync(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const opened = fstatSync(descriptor, { bigint: true });
      if (!sameIdentity(before, opened)) throw projectionError('source_file_changed');
      bytes = readFileSync(descriptor);
      options.afterRead?.({ relativeFile });
      const after = fstatSync(descriptor, { bigint: true });
      if (!sameIdentity(opened, after) || BigInt(bytes.length) !== after.size) throw projectionError('source_file_changed');
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }

    totalBytes += bytes.length;
    if (totalBytes > maxTotalBytes) throw projectionError('source_total_oversize');
    collectRedactions(relativeFile, bytes, redactions);
    const target = join(targetRoot, relativeFile);
    privateDirectory(dirname(target));
    let output;
    try {
      output = openSync(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
      writeSync(output, bytes);
      fsyncSync(output);
      chmodSync(target, 0o600);
    } finally {
      if (output !== undefined) closeSync(output);
    }
    count += 1;
  }

  const secrets = [...redactions].sort((left, right) => right.length - left.length);
  return Object.freeze({
    count,
    redactProviderFrame: (frame) => redactStrings(frame, secrets),
  });
}
