// toolchain-projection.mjs — immutable bounded dual-root toolchain projection.
// Absolute source paths stay in this closure. Public identity is content/policy only.

import { createHash } from 'node:crypto';
import {
  closeSync, constants as fsConstants, existsSync, fstatSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export class ToolchainProjectionError extends Error {
  constructor(message, code = 'toolchain_projection_invalid') {
    super(message); this.name = 'ToolchainProjectionError'; this.code = code;
  }
}

const LIMIT_FIELDS = Object.freeze(['maxMappings', 'maxFiles', 'maxDirectories', 'maxBytes', 'maxFileBytes', 'maxPathBytes', 'maxDepth']);
const IMPLEMENTATION_CEILINGS = Object.freeze({
  maxMappings: 128, maxFiles: 1_000_000, maxDirectories: 250_000,
  maxBytes: 2 * 1024 * 1024 * 1024, maxFileBytes: 512 * 1024 * 1024,
  maxPathBytes: 4096, maxDepth: 256,
});
const BASE_FIELDS = Object.freeze(['schemaVersion', 'sourceRoot', 'sourceId', 'mappings', 'limits']);
const MAPPING_FIELDS = Object.freeze(['sourcePath', 'targetPath']);

const typed = (message, code = 'toolchain_projection_invalid') => new ToolchainProjectionError(message, code);
const digestBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const digestValue = (value) => digestBytes(JSON.stringify(canonical(value)));
const same = (a, b) => digestValue(a) === digestValue(b);

function exactKeys(value, expected, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== [...expected].sort().join('\0')) throw typed(message);
}

function safeRelative(value, label) {
  if (typeof value !== 'string' || value.length === 0 || isAbsolute(value) || value.includes('\\')
    || value.normalize('NFC') !== value || /[\u0000-\u001f\u007f*?\[\]!]/u.test(value)) throw typed(`${label} is invalid`);
  const parts = value.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) throw typed(`${label} is invalid`);
  return value;
}

function overlaps(a, b) {
  const left = a.toLocaleLowerCase('en-US'); const right = b.toLocaleLowerCase('en-US');
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function targetParentPaths(mappings) {
  const parents = new Map();
  for (const mapping of mappings) {
    const parts = mapping.targetPath.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const path = parts.slice(0, index).join('/');
      const key = path.toLocaleLowerCase('en-US');
      if (!parents.has(key)) parents.set(key, path);
    }
  }
  return Object.freeze([...parents.values()].sort((a, b) => a.localeCompare(b)));
}

function validateConfig(config, withExpected) {
  exactKeys(config, withExpected ? [...BASE_FIELDS, 'expectedManifestDigest'] : BASE_FIELDS, 'toolchain projection configuration is invalid');
  if (config.schemaVersion !== 1 || typeof config.sourceRoot !== 'string' || !isAbsolute(config.sourceRoot)
    || typeof config.sourceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(config.sourceId)) throw typed('toolchain projection configuration is invalid');
  let sourceRoot;
  try {
    const rootStat = lstatSync(config.sourceRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw typed('toolchain source is unavailable');
    sourceRoot = realpathSync(config.sourceRoot);
  } catch (error) {
    if (error instanceof ToolchainProjectionError) throw error;
    throw typed('toolchain source is unavailable');
  }
  if (!Array.isArray(config.mappings) || config.mappings.length === 0) throw typed('toolchain mappings are invalid');
  const mappings = config.mappings.map((mapping) => {
    exactKeys(mapping, MAPPING_FIELDS, 'toolchain mapping is invalid');
    const sourcePath = safeRelative(mapping.sourcePath, 'toolchain source path');
    const targetPath = safeRelative(mapping.targetPath, 'toolchain target path');
    const sourceFirst = sourcePath.split('/')[0].toLocaleLowerCase('en-US');
    const first = targetPath.split('/')[0].toLocaleLowerCase('en-US');
    if (sourceFirst === '.git' || sourceFirst === '.baton' || first === '.git' || first === '.baton') throw typed('toolchain mapping uses a reserved path');
    const source = resolve(sourceRoot, sourcePath); const within = relative(sourceRoot, source);
    if (within === '' || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw typed('toolchain source path is invalid');
    return Object.freeze({ sourcePath, targetPath });
  }).sort((a, b) => a.sourcePath.localeCompare(b.sourcePath) || a.targetPath.localeCompare(b.targetPath));
  for (let i = 0; i < mappings.length; i += 1) for (let j = i + 1; j < mappings.length; j += 1) {
    if (overlaps(mappings[i].sourcePath, mappings[j].sourcePath) || overlaps(mappings[i].targetPath, mappings[j].targetPath)) throw typed('toolchain mappings overlap');
  }
  exactKeys(config.limits, LIMIT_FIELDS, 'toolchain projection limits are invalid');
  const limits = {};
  for (const field of LIMIT_FIELDS) {
    const value = config.limits[field];
    if (!Number.isSafeInteger(value) || value <= 0 || value > IMPLEMENTATION_CEILINGS[field]) throw typed('toolchain projection limits are invalid');
    limits[field] = value;
  }
  if (limits.maxFileBytes > limits.maxBytes) throw typed('toolchain projection limits are invalid');
  if (mappings.length > limits.maxMappings) throw typed('toolchain projection exceeded a deployment limit', 'toolchain_projection_oversize');
  if (withExpected && (typeof config.expectedManifestDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(config.expectedManifestDigest))) throw typed('toolchain manifest digest is invalid');
  return Object.freeze({ sourceRoot, sourceId: config.sourceId, mappings: Object.freeze(mappings), limits: Object.freeze(limits), expectedManifestDigest: config.expectedManifestDigest });
}

function statSignature(stat) {
  return [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
}

function safeEntryName(name) {
  return typeof name === 'string' && name.length > 0 && name.normalize('NFC') === name
    && !name.includes('\\') && !/[\u0000-\u001f\u007f]/u.test(name);
}

function scanProjection(config, actualRoot, sourceSide, retainBytes = false) {
  const counters = { files: 0, directories: 0, bytes: 0 };
  const pathKeys = new Set();
  const exceed = () => { throw typed('toolchain projection exceeded a deployment limit', 'toolchain_projection_oversize'); };
  const changed = () => { throw typed('toolchain source changed', 'toolchain_projection_changed'); };
  const invalid = () => { throw typed(sourceSide ? 'toolchain source contains an unsupported entry' : 'toolchain materialization is invalid', sourceSide ? 'toolchain_projection_invalid' : 'toolchain_projection_materialization_failed'); };

  const walk = (absolutePath, logicalPath, depth) => {
    let before;
    try { before = lstatSync(absolutePath); } catch { if (sourceSide) changed(); else invalid(); }
    if (before.isSymbolicLink() || (!before.isDirectory() && !before.isFile())) invalid();
    if (Buffer.byteLength(logicalPath) > config.limits.maxPathBytes || depth > config.limits.maxDepth) exceed();
    const key = logicalPath.normalize('NFC').toLocaleLowerCase('en-US');
    if (pathKeys.has(key)) invalid(); pathKeys.add(key);
    if (before.isFile()) {
      counters.files += 1; counters.bytes += before.size;
      if (counters.files > config.limits.maxFiles || before.size > config.limits.maxFileBytes || counters.bytes > config.limits.maxBytes) exceed();
      if (before.nlink !== 1 || (before.mode & 0o6000) !== 0) invalid();
      let fd; let bytes; let opened; let after;
      try {
        fd = openSync(absolutePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
        opened = fstatSync(fd); bytes = readFileSync(fd); after = fstatSync(fd);
      } catch { if (sourceSide) changed(); else invalid(); }
      finally { if (fd !== undefined) try { closeSync(fd); } catch { /* no-op */ } }
      if (!opened?.isFile() || statSignature(before) !== statSignature(opened) || statSignature(opened) !== statSignature(after) || bytes.byteLength !== before.size) {
        if (sourceSide) changed(); else invalid();
      }
      return Object.freeze({ path: logicalPath, type: 'file', bytes: before.size, executable: (before.mode & 0o111) !== 0, digest: digestBytes(bytes), ...(retainBytes ? { content: bytes } : {}) });
    }
    counters.directories += 1; if (counters.directories > config.limits.maxDirectories) exceed();
    let names;
    try { names = readdirSync(absolutePath).sort((a, b) => a.localeCompare(b)); } catch { if (sourceSide) changed(); else invalid(); }
    if (!names.every(safeEntryName)) invalid();
    const children = names.map((name) => walk(join(absolutePath, name), `${logicalPath}/${name}`, depth + 1));
    let after; let afterNames;
    try { after = lstatSync(absolutePath); afterNames = readdirSync(absolutePath).sort((a, b) => a.localeCompare(b)); } catch { if (sourceSide) changed(); else invalid(); }
    if (!after.isDirectory() || statSignature(before) !== statSignature(after) || JSON.stringify(names) !== JSON.stringify(afterNames)) {
      if (sourceSide) changed(); else invalid();
    }
    return Object.freeze({ path: logicalPath, type: 'directory', children: Object.freeze(children) });
  };

  const trees = config.mappings.map((mapping) => {
    const actualPath = resolve(actualRoot, sourceSide ? mapping.sourcePath : mapping.targetPath);
    const within = relative(actualRoot, actualPath);
    if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) invalid();
    return Object.freeze({ sourcePath: mapping.sourcePath, targetPath: mapping.targetPath, tree: walk(actualPath, mapping.sourcePath, 0) });
  });
  const manifestRows = (nodes) => nodes.flatMap((node) => node.type === 'file'
    ? [{ path: node.path, type: node.type, bytes: node.bytes, executable: node.executable, digest: node.digest }]
    : [{ path: node.path, type: node.type }, ...manifestRows(node.children)]);
  const manifest = Object.freeze(trees.map((row) => Object.freeze({ sourcePath: row.sourcePath, entries: Object.freeze(manifestRows([row.tree])) })));
  return Object.freeze({ trees: Object.freeze(trees), manifest, counters: Object.freeze({ ...counters }), manifestDigest: digestValue({ schemaVersion: 1, manifest }) });
}

function publicIdentity(config, scanned) {
  const targetParents = targetParentPaths(config.mappings);
  const directoryCount = scanned.counters.directories + targetParents.length;
  if (directoryCount > config.limits.maxDirectories) throw typed('toolchain projection exceeded a deployment limit', 'toolchain_projection_oversize');
  const core = {
    schemaVersion: 1, directoryAccountingVersion: 2, sourceId: config.sourceId, manifestDigest: scanned.manifestDigest,
    mappingCount: config.mappings.length, fileCount: scanned.counters.files,
    directoryCount, targetParentDirectoryCount: targetParents.length,
    targetParentDirectoryDigest: digestValue(targetParents), byteCount: scanned.counters.bytes,
    limits: config.limits,
  };
  return Object.freeze({ ...core, projectionDigest: digestValue({ ...core, mappings: config.mappings }) });
}

export function inspectToolchainProjection(rawConfig) {
  const config = validateConfig(rawConfig, false);
  return publicIdentity(config, scanProjection(config, config.sourceRoot, true));
}

function removeCreated(targetRoot, targets, parents) {
  for (const target of [...targets].reverse()) try { rmSync(resolve(targetRoot, target), { recursive: true, force: true }); } catch { /* best effort */ }
  for (const parent of [...parents].sort((a, b) => b.length - a.length)) try { rmdirSync(parent); } catch { /* non-empty or absent */ }
}

function ensureParents(targetRoot, targetPath, createdParents) {
  const target = resolve(targetRoot, targetPath); const missing = [];
  for (let current = dirname(target); current !== targetRoot && current.startsWith(`${targetRoot}${sep}`); current = dirname(current)) if (!existsSync(current)) missing.push(current);
  mkdirSync(dirname(target), { recursive: true }); for (const path of missing) createdParents.add(path);
  return target;
}

function writeTree(tree, targetRoot, mapping, createdParents) {
  const suffix = tree.path === mapping.sourcePath ? '' : tree.path.slice(mapping.sourcePath.length + 1);
  const relativeTarget = suffix ? `${mapping.targetPath}/${suffix}` : mapping.targetPath;
  const target = ensureParents(targetRoot, relativeTarget, createdParents);
  if (tree.type === 'directory') {
    mkdirSync(target, { recursive: false, mode: 0o755 });
    for (const child of tree.children) writeTree(child, targetRoot, mapping, createdParents);
  } else writeFileSync(target, tree.content, { flag: 'wx', mode: tree.executable ? 0o755 : 0o644 });
}

export function prepareToolchainProjection(rawConfig) {
  const config = validateConfig(rawConfig, true);
  const initial = scanProjection(config, config.sourceRoot, true);
  const identity = publicIdentity(config, initial);
  if (identity.manifestDigest !== config.expectedManifestDigest) throw typed('toolchain source changed', 'toolchain_projection_changed');
  const targetPaths = Object.freeze(config.mappings.map((mapping) => mapping.targetPath));
  const targetParents = targetParentPaths(config.mappings);

  const authority = {
    identity: () => identity,
    targetPaths: () => [...targetPaths],
    targetParentPaths: () => [...targetParents],
    matchesIdentity: (candidate) => same(candidate, identity),
    verifyMaterialization: (targetRoot) => {
      try {
        const scanned = scanProjection(config, realpathSync(targetRoot), false);
        if (scanned.manifestDigest !== identity.manifestDigest || !same(publicIdentity(config, scanned), identity)) throw typed('toolchain materialization is invalid', 'toolchain_projection_materialization_failed');
        return identity;
      } catch (error) {
        if (error instanceof ToolchainProjectionError) throw error;
        throw typed('toolchain materialization is invalid', 'toolchain_projection_materialization_failed');
      }
    },
    materialize: (targetRootInput) => {
      let targetRoot;
      try {
        targetRoot = realpathSync(targetRootInput);
        if (!lstatSync(targetRoot).isDirectory()) throw new Error();
      } catch { throw typed('toolchain materialization failed', 'toolchain_projection_materialization_failed'); }
      for (const targetPath of targetPaths) if (existsSync(resolve(targetRoot, targetPath))) throw typed('toolchain materialization failed', 'toolchain_projection_materialization_failed');
      const snapshot = scanProjection(config, config.sourceRoot, true, true);
      if (snapshot.manifestDigest !== identity.manifestDigest || !same(publicIdentity(config, snapshot), identity)) throw typed('toolchain source changed', 'toolchain_projection_changed');
      const created = []; const parents = new Set();
      try {
        for (const row of snapshot.trees) {
          const mapping = config.mappings.find((candidate) => candidate.sourcePath === row.sourcePath && candidate.targetPath === row.targetPath);
          writeTree(row.tree, targetRoot, mapping, parents); created.push(mapping.targetPath);
        }
        authority.verifyMaterialization(targetRoot);
        const after = scanProjection(config, config.sourceRoot, true);
        if (after.manifestDigest !== identity.manifestDigest || !same(publicIdentity(config, after), identity)) throw typed('toolchain source changed', 'toolchain_projection_changed');
        return Object.freeze({ identity, materializedTargets: [...targetPaths] });
      } catch (error) {
        removeCreated(targetRoot, [...new Set([...created, ...targetPaths])], parents);
        if (error instanceof ToolchainProjectionError) throw error;
        throw typed('toolchain materialization failed', 'toolchain_projection_materialization_failed');
      }
    },
  };
  return Object.freeze(authority);
}
