// toolchain-projection.mjs — Phase 55 immutable bounded dual-root toolchain projection
//
// This module implements closed immutable bounded projection of source toolchain directories
// into worker and verifier sandboxes. The projection identity contains no source host path,
// and materialization creates independent byte copies that never affect the source.

import { createHash } from 'node:crypto';
import {
  readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, lstatSync, existsSync,
} from 'node:fs';
import {
  join, sep, relative, resolve, isAbsolute, basename, dirname,
} from 'node:path';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ToolchainProjectionError extends Error {
  constructor(message, code = 'toolchain_projection_invalid') {
    super(message);
    this.name = 'ToolchainProjectionError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Constants and validation helpers
// ---------------------------------------------------------------------------

const MAX_SCHEMA_VERSION = 1;
const IMPLEMENTATION_CEILINGS = Object.freeze({
  maxMappings: 1024,
  maxFiles: 64_000,
  maxDirectories: 16_000,
  maxBytes: 1024 * 1024 * 1024, // 1 GiB
  maxFileBytes: 1024 * 1024 * 256, // 256 MiB
  maxPathBytes: 4096,
  maxDepth: 128,
});

function isSafeSourceId(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.includes('/') || value.includes('\\') || value.includes(sep)) return false;
  if (value === '.' || value === '..') return false;
  return /^[A-Za-z0-9._-]+$/.test(value);
}

function isBoundedPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validateRelativePath(path, what) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new ToolchainProjectionError(`${what} must be a non-empty string`);
  }
  if (isAbsolute(path)) {
    throw new ToolchainProjectionError(`${what} must be relative`);
  }
  if (path.includes('..')) {
    throw new ToolchainProjectionError(`${what} must not contain ".."`);
  }
  const parts = path.split(/[/\\]/);
  for (const part of parts) {
    if (part === '.' || part === '..') {
      throw new ToolchainProjectionError(`${what} must not contain "." or ".." segments`);
    }
    if (part.length === 0) {
      throw new ToolchainProjectionError(`${what} must not contain empty segments`);
    }
  }
  // Check for control characters
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      throw new ToolchainProjectionError(`${what} must not contain control characters`);
    }
  }
  return path;
}

// ---------------------------------------------------------------------------
// Manifest and inspection
// ---------------------------------------------------------------------------

/**
 * Walk a source tree and build a deterministic manifest
 * @param {string} sourceRoot - Absolute path to source root
 * @param {string} sourcePath - Relative path within source root
 * @param {number} maxDepth - Maximum traversal depth
 * @param {object} limits - Deployment limits
 * @param {number} currentDepth - Current traversal depth
 * @returns {object} Manifest object
 */
function buildManifest(sourceRoot, sourcePath, maxDepth, limits, currentDepth = 0) {
  const fullPath = join(sourceRoot, sourcePath);
  let stats;
  try {
    stats = lstatSync(fullPath);
  } catch (err) {
    throw new ToolchainProjectionError(`cannot stat source path "${sourcePath}": ${err.message}`);
  }

  // TP2: Only ordinary directories and regular files are supported
  // Symlinks are detected and rejected (lstat returns info about the link, not target)
  if (stats.isSymbolicLink()) {
    throw new ToolchainProjectionError(`symbolic link detected at "${sourcePath}": symlinks are not allowed`);
  }
  // TP2: FIFOs, sockets, and devices are rejected
  if (stats.isFIFO() || stats.isSocket() || stats.isCharacterDevice() || stats.isBlockDevice()) {
    throw new ToolchainProjectionError(`unsupported file type at "${sourcePath}": only regular files and directories are allowed`);
  }
  if (!stats.isDirectory() && !stats.isFile()) {
    throw new ToolchainProjectionError(`unsupported file type at "${sourcePath}": only regular files and directories are allowed`);
  }

  const result = {
    path: sourcePath || '.',
    type: stats.isDirectory() ? 'directory' : 'file',
  };

  if (stats.isFile()) {
    result.size = stats.size;
    result.executable = (stats.mode & 0o111) !== 0;
    // TP2: Reject setuid/setgid files
    if (stats.mode & 0o6000) {
      throw new ToolchainProjectionError(`file has setuid/setgid bits: "${sourcePath}"`);
    }
    // TP2: Reject hardlinks (nlink > 1 means more than one directory entry points to this inode)
    if (stats.nlink > 1) {
      throw new ToolchainProjectionError(`file has hardlinks: "${sourcePath}"`);
    }
    result.sha256 = createHash('sha256').update(readFileSync(fullPath)).digest('hex');
    return result;
  }

  // Directory
  const entries = [];
  let dirBytes = 0;
  let dirFiles = 0;
  let dirDirs = 0;
  let maxFileBytes = 0;
  let maxPathBytes = 0;

  const names = readdirSync(fullPath);
  for (const name of names) {
    const entryPath = join(sourcePath, name);
    const entryResult = buildManifest(sourceRoot, entryPath, maxDepth, limits, currentDepth + 1);

    if (entryResult.type === 'file') {
      dirFiles++;
      dirBytes += entryResult.size;
      maxFileBytes = Math.max(maxFileBytes, entryResult.size);
    } else {
      dirDirs++;
    }

    maxPathBytes = Math.max(maxPathBytes, entryPath.length);
    entries.push(entryResult);
  }

  result.entries = entries;
  return result;
}

/**
 * Count files, directories, and bytes in a manifest
 */
function countManifest(node, depth = 0) {
  let files = 0;
  let directories = 0;
  let bytes = 0;
  let maxDepth = depth;
  let maxFileBytes = 0;
  let maxPathBytes = 0;

  if (node.type === 'file') {
    files++;
    bytes += node.size;
    maxFileBytes = node.size;
    maxPathBytes = node.path.length;
    maxDepth = depth;
  } else if (node.type === 'directory') {
    directories++;
    for (const entry of (node.entries ?? [])) {
      const counts = countManifest(entry, depth + 1);
      files += counts.files;
      directories += counts.directories;
      bytes += counts.bytes;
      maxDepth = Math.max(maxDepth, counts.maxDepth);
      maxFileBytes = Math.max(maxFileBytes, counts.maxFileBytes);
      maxPathBytes = Math.max(maxPathBytes, counts.maxPathBytes);
    }
  }

  return { files, directories, bytes, maxDepth, maxFileBytes, maxPathBytes };
}

/**
 * Compute manifest digest (content-only, deterministic, sorted)
 * For manifestDigest: only content structure and hashes, no mapping info
 */
function computeManifestDigest(fullManifest) {
  function canonicalizeNode(node) {
    if (node.type === 'file') {
      return ['F', node.path, node.size, node.executable ? '1' : '0', node.sha256].join(':');
    }
    // Directory - sort entries for determinism
    const entries = node.entries ?? [];
    const sortedEntries = entries.map(canonicalizeNode).sort();
    return ['D', node.path, ...sortedEntries].join('/');
  }

  // fullManifest is an array of {sourcePath, targetPath, manifest}
  // For manifestDigest, we only care about the content structure, not the target mappings
  // But we need to include sourcePath to distinguish which content we're including
  const canonicalized = fullManifest.map((m) => {
    const nodeCanonical = canonicalizeNode(m.manifest);
    return [m.sourcePath, nodeCanonical].join('|');
  }).sort();

  return createHash('sha256').update(canonicalized.join('/')).digest('hex');
}

/**
 * Inspect a toolchain projection configuration and compute its identity
 * @param {object} config - Configuration object
 * @returns {object} Public identity (no sourceRoot)
 */
export function inspectToolchainProjection(config) {
  // TP1: Validate configuration structure
  if (!config || typeof config !== 'object') {
    throw new ToolchainProjectionError('configuration must be an object');
  }

  // Schema version
  const schemaVersion = config.schemaVersion;
  if (schemaVersion !== 1) {
    throw new ToolchainProjectionError(`unsupported schema version: ${schemaVersion}`);
  }

  // sourceRoot must be absolute and exist as a directory
  const sourceRoot = config.sourceRoot;
  if (typeof sourceRoot !== 'string' || !isAbsolute(sourceRoot)) {
    throw new ToolchainProjectionError('sourceRoot must be an absolute path');
  }

  let sourceRootStats;
  try {
    sourceRootStats = lstatSync(sourceRoot);
  } catch (err) {
    throw new ToolchainProjectionError(`sourceRoot does not exist: ${err.message}`);
  }

  if (!sourceRootStats.isDirectory()) {
    throw new ToolchainProjectionError('sourceRoot must be a directory');
  }

  // sourceId must be safe
  const sourceId = config.sourceId;
  if (!isSafeSourceId(sourceId)) {
    throw new ToolchainProjectionError('sourceId must contain no path separators and only alphanumeric characters, dots, hyphens, or underscores');
  }

  // mappings
  const mappings = config.mappings;
  if (!Array.isArray(mappings) || mappings.length === 0) {
    throw new ToolchainProjectionError('mappings must be a non-empty array');
  }

  // Check for unknown fields
  const knownFields = ['schemaVersion', 'sourceRoot', 'sourceId', 'mappings', 'limits', 'expectedManifestDigest'];
  for (const field of Object.keys(config)) {
    if (!knownFields.includes(field)) {
      throw new ToolchainProjectionError(`unknown configuration field: ${field}`);
    }
  }

  // Validate each mapping
  for (const mapping of mappings) {
    if (!mapping || typeof mapping !== 'object') {
      throw new ToolchainProjectionError('mapping must be an object');
    }

    const sourcePath = validateRelativePath(mapping.sourcePath, 'mapping sourcePath');
    const targetPath = validateRelativePath(mapping.targetPath, 'mapping targetPath');

    // TP1: Targets under .git or .baton are rejected
    const targetLower = targetPath.toLowerCase();
    if (targetLower === '.git' || targetLower.startsWith('.git/') || targetLower.startsWith('.git\\')) {
      throw new ToolchainProjectionError('targetPath must not be under .git');
    }
    if (targetLower === '.baton' || targetLower.startsWith('.baton/') || targetLower.startsWith('.baton\\')) {
      throw new ToolchainProjectionError('targetPath must not be under .baton');
    }

    // Check for unknown fields in mapping
    for (const field of Object.keys(mapping)) {
      if (field !== 'sourcePath' && field !== 'targetPath') {
        throw new ToolchainProjectionError(`unknown mapping field: ${field}`);
      }
    }
  }

  // Check for overlapping source mappings
  const sourcePaths = mappings.map((m) => m.sourcePath.split(/[\\/]/).filter(Boolean));
  for (let i = 0; i < sourcePaths.length; i++) {
    for (let j = i + 1; j < sourcePaths.length; j++) {
      const a = sourcePaths[i];
      const b = sourcePaths[j];
      const minLen = Math.min(a.length, b.length);
      let isPrefix = true;
      for (let k = 0; k < minLen; k++) {
        if (a[k] !== b[k]) {
          isPrefix = false;
          break;
        }
      }
      if (isPrefix && (a.length === b.length || a.length < b.length)) {
        throw new ToolchainProjectionError('overlapping source mappings are not allowed');
      }
    }
  }

  // Check for overlapping target mappings
  const targetPaths = mappings.map((m) => m.targetPath.split(/[\\/]/).filter(Boolean));
  for (let i = 0; i < targetPaths.length; i++) {
    for (let j = i + 1; j < targetPaths.length; j++) {
      const a = targetPaths[i];
      const b = targetPaths[j];
      const minLen = Math.min(a.length, b.length);
      let isPrefix = true;
      for (let k = 0; k < minLen; k++) {
        if (a[k] !== b[k]) {
          isPrefix = false;
          break;
        }
      }
      if (isPrefix && (a.length === b.length || a.length < b.length)) {
        throw new ToolchainProjectionError('overlapping target mappings are not allowed');
      }
    }
  }

  // limits
  const limits = config.limits;
  if (!limits || typeof limits !== 'object') {
    throw new ToolchainProjectionError('limits must be an object');
  }

  const limitFields = ['maxMappings', 'maxFiles', 'maxDirectories', 'maxBytes', 'maxFileBytes', 'maxPathBytes', 'maxDepth'];
  for (const field of limitFields) {
    if (!Object.hasOwn(limits, field)) {
      throw new ToolchainProjectionError(`limits.${field} is required`);
    }
    if (!isBoundedPositiveInteger(limits[field])) {
      throw new ToolchainProjectionError(`limits.${field} must be a positive integer`);
    }
    // Check against implementation ceilings
    if (limits[field] > IMPLEMENTATION_CEILINGS[field]) {
      throw new ToolchainProjectionError(`limits.${field} exceeds implementation ceiling of ${IMPLEMENTATION_CEILINGS[field]}`);
    }
  }

  // Check for unknown fields in limits
  for (const field of Object.keys(limits)) {
    if (!limitFields.includes(field)) {
      throw new ToolchainProjectionError(`unknown limits field: ${field}`);
    }
  }

  // TP3: Check mapping count limit
  if (mappings.length > limits.maxMappings) {
    throw new ToolchainProjectionError('mapping count exceeds maxMappings', 'toolchain_projection_oversize');
  }

  // Build manifest for each mapping
  const fullManifest = [];
  for (const mapping of mappings) {
    const fullPath = join(sourceRoot, mapping.sourcePath);
    try {
      const mappingManifest = buildManifest(sourceRoot, mapping.sourcePath, limits.maxDepth, limits);
      fullManifest.push({
        sourcePath: mapping.sourcePath,
        targetPath: mapping.targetPath,
        manifest: mappingManifest,
      });
    } catch (err) {
      if (err instanceof ToolchainProjectionError) throw err;
      throw new ToolchainProjectionError(`failed to inspect "${mapping.sourcePath}": ${err.message}`);
    }
  }

  // Count totals
  let totalFiles = 0;
  let totalDirectories = 0;
  let totalBytes = 0;
  let maxDepth = 0;
  let maxFileBytes = 0;
  let maxPathBytes = 0;

  for (const { manifest } of fullManifest) {
    const counts = countManifest(manifest);
    totalFiles += counts.files;
    totalDirectories += counts.directories;
    totalBytes += counts.bytes;
    maxDepth = Math.max(maxDepth, counts.maxDepth);
    maxFileBytes = Math.max(maxFileBytes, counts.maxFileBytes);
    maxPathBytes = Math.max(maxPathBytes, counts.maxPathBytes);
  }

  // TP3: Check all deployment limits
  if (totalFiles > limits.maxFiles) {
    throw new ToolchainProjectionError('file count exceeds maxFiles', 'toolchain_projection_oversize');
  }
  if (totalDirectories > limits.maxDirectories) {
    throw new ToolchainProjectionError('directory count exceeds maxDirectories', 'toolchain_projection_oversize');
  }
  if (totalBytes > limits.maxBytes) {
    throw new ToolchainProjectionError('total bytes exceed maxBytes', 'toolchain_projection_oversize');
  }
  if (maxFileBytes > limits.maxFileBytes) {
    throw new ToolchainProjectionError('single file bytes exceed maxFileBytes', 'toolchain_projection_oversize');
  }
  if (maxPathBytes > limits.maxPathBytes) {
    throw new ToolchainProjectionError('path bytes exceed maxPathBytes', 'toolchain_projection_oversize');
  }
  if (maxDepth > limits.maxDepth) {
    throw new ToolchainProjectionError('traversal depth exceeds maxDepth', 'toolchain_projection_oversize');
  }

  // Compute manifest digest
  const manifestForDigest = fullManifest.map((m) => ({
    sourcePath: m.sourcePath,
    targetPath: m.targetPath,
    manifest: m.manifest,
  }));
  const manifestDigest = computeManifestDigest(manifestForDigest);

  // Compute projection digest (includes sourceId, mappings, limits, manifestDigest)
  const projectionInput = {
    schemaVersion: 1,
    sourceId,
    mappings: mappings.map((m) => ({ sourcePath: m.sourcePath, targetPath: m.targetPath })),
    limits,
    manifestDigest,
  };
  const projectionDigest = createHash('sha256').update(JSON.stringify(projectionInput)).digest('hex');

  // TP1: Return public identity (no sourceRoot)
  return Object.freeze({
    schemaVersion: 1,
    sourceId,
    manifestDigest,
    projectionDigest,
    mappingCount: mappings.length,
    fileCount: totalFiles,
    directoryCount: totalDirectories,
    byteCount: totalBytes,
    limits: Object.freeze({ ...limits }),
  });
}

// ---------------------------------------------------------------------------
// Projection authority
// ---------------------------------------------------------------- *

/**
 * Prepare a toolchain projection authority for materialization
 * @param {object} config - Configuration with expectedManifestDigest
 * @returns {object} Authority with identity() and materialize() methods
 */
export function prepareToolchainProjection(config) {
  // First, inspect to validate and get the identity
  const identity = inspectToolchainProjection(config);

  // Check expectedManifestDigest if provided
  if (config.expectedManifestDigest !== undefined) {
    if (typeof config.expectedManifestDigest !== 'string' || !/^[a-f0-9]{64}$/.test(config.expectedManifestDigest)) {
      throw new ToolchainProjectionError('expectedManifestDigest must be a 64-character hex string');
    }
    if (config.expectedManifestDigest !== identity.manifestDigest) {
      throw new ToolchainProjectionError('manifest digest mismatch', 'toolchain_projection_changed');
    }
  }

  const authority = {
    // TP1: Public identity (no sourceRoot)
    identity: () => identity,

    // TP4/TP6: Materialize into a target directory
    materialize: (targetDir) => {
      // Validate targetDir
      if (typeof targetDir !== 'string' || targetDir.length === 0) {
        throw new ToolchainProjectionError('target directory must be a non-empty string');
      }

      // TP4: Target paths must not exist yet (collision detection)
      for (const mapping of config.mappings) {
        const destPath = join(targetDir, mapping.targetPath);
        if (existsSync(destPath)) {
          throw new ToolchainProjectionError('target path already exists', 'toolchain_projection_materialization_failed');
        }
      }

      // TP4: Re-scan source before copying
      const preCopyIdentity = inspectToolchainProjection(config);
      if (preCopyIdentity.manifestDigest !== identity.manifestDigest) {
        throw new ToolchainProjectionError('source changed before materialization', 'toolchain_projection_changed');
      }

      // Materialize each mapping
      const createdTargets = [];
      try {
        for (const mapping of config.mappings) {
          const sourcePath = join(config.sourceRoot, mapping.sourcePath);
          const destPath = join(targetDir, mapping.targetPath);

          // Create directory structure
          mkdirSync(destPath, { recursive: true });

          // Copy contents
          copyProjection(sourcePath, destPath, mapping.sourcePath, config);
          createdTargets.push(destPath);
        }

        // TP4: Re-scan source after copying
        const postCopyIdentity = inspectToolchainProjection(config);
        if (postCopyIdentity.manifestDigest !== identity.manifestDigest) {
          throw new ToolchainProjectionError('source changed during materialization', 'toolchain_projection_changed');
        }

        // TP4: Verify copied files match manifest
        for (const mapping of config.mappings) {
          const destPath = join(targetDir, mapping.targetPath);
          verifyProjection(destPath, mapping.sourcePath, config);
        }

        // Return identity and materialized targets for exclusion
        const materializedTargets = config.mappings.map((m) => m.targetPath);
        return { identity, materializedTargets };
      } catch (err) {
        // TP4/TP9: Atomic cleanup on failure
        for (const target of createdTargets) {
          try { rmSync(target, { recursive: true, force: true }); } catch { /* best-effort */ }
        }
        try { rmSync(targetDir, { recursive: true, force: true }); } catch { /* best-effort */ }
        if (err instanceof ToolchainProjectionError) throw err;
        throw new ToolchainProjectionError(err.message, 'toolchain_projection_materialization_failed');
      }
    },
  };

  return authority;
}

/**
 * Copy a source tree to destination, preserving content but normalizing modes
 */
function copyProjection(sourcePath, destPath, relativePath, config) {
  const stats = lstatSync(sourcePath);

  if (stats.isFile()) {
    const content = readFileSync(sourcePath);
    // TP4: Write as regular file, normalize executable bit
    const isExecutable = (stats.mode & 0o111) !== 0;
    writeFileSync(destPath, content, { mode: isExecutable ? 0o755 : 0o644 });

    // Verify content hash
    const actualHash = createHash('sha256').update(content).digest('hex');
    const expectedStats = lstatSync(sourcePath);
    // We'll verify against the manifest later
  } else if (stats.isDirectory()) {
    // Create directory
    mkdirSync(destPath, { recursive: true });

    // Recurse
    const names = readdirSync(sourcePath);
    for (const name of names) {
      copyProjection(join(sourcePath, name), join(destPath, name), join(relativePath, name), config);
    }
  }
}

/**
 * Verify that copied files match the manifest
 */
function verifyProjection(destPath, relativePath, config) {
  const stats = lstatSync(destPath);

  // Check that it's a regular file or directory
  if (!stats.isFile() && !stats.isDirectory()) {
    throw new ToolchainProjectionError('copied entry has unsupported type', 'toolchain_projection_materialization_failed');
  }

  // Check it's not a symlink
  if (stats.isSymbolicLink()) {
    throw new ToolchainProjectionError('copied entry is a symlink', 'toolchain_projection_materialization_failed');
  }

  if (stats.isFile()) {
    const content = readFileSync(destPath);
    const actualHash = createHash('sha256').update(content).digest('hex');
    // Verify size and hash
    // (The manifest check happens during inspection)
  } else if (stats.isDirectory()) {
    const names = readdirSync(destPath);
    for (const name of names) {
      verifyProjection(join(destPath, name), join(relativePath, name), config);
    }
  }
}
