// Portable fixture environment contract for the runtime security/lifecycle set.
//
// Nothing here hardcodes a host path. The caller injects:
//   BATON_PRODUCER_ROOT       absolute root of the admitted producer worktree
//   BATON_FLOOR_NODE          absolute exact-floor Node executable
//   BATON_EVIDENCE_DIR        absolute directory for result artifacts (required)
//   BATON_EXPECT              historical | corrected   (default corrected)
//   BATON_EXPECTED_PRODUCER_HASHES  optional file of `sha256  <path>` lines
//
// The producer runtime modules are resolved as
// <BATON_PRODUCER_ROOT>/bend2/context/runtime/<name>, and the expected digests
// in BATON_EXPECTED_PRODUCER_HASHES are matched by basename. A digest mismatch
// refuses the run: the review does not apply to that tree.

import { createHash } from 'node:crypto';
import { readFileSync, statSync, accessSync, constants, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, basename } from 'node:path';
import os from 'node:os';

export const LIB_DIR = dirname(fileURLToPath(import.meta.url));
export const SUITE_DIR = dirname(LIB_DIR);
export const HELPERS_DIR = join(SUITE_DIR, 'helpers');

export const PRODUCER_FILES = Object.freeze([
  'bootstrap.mjs',
  'bootstrap-admission.mjs',
  'cdp-intents.mjs',
  'cdp-state.mjs',
  'cdp-session.mjs',
  'cdp-transport.mjs',
  'cdp-endpoint.mjs',
]);

export class EnvironmentRefusal extends Error {
  constructor(condition, detail) {
    super(detail === undefined || detail === null ? condition : `${condition}: ${detail}`);
    this.name = 'EnvironmentRefusal';
    this.condition = condition;
    this.detail = detail === undefined ? null : detail;
  }
}

function requireAbsolute(name, value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new EnvironmentRefusal('missingEnvironment', name);
  }
  if (!isAbsolute(value)) {
    throw new EnvironmentRefusal('relativeEnvironment', `${name}=${value}`);
  }
  return value;
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function parseExpectedHashes(path) {
  const text = readFileSync(path, 'utf8');
  const map = new Map();
  for (const line of text.split('\n')) {
    const match = /^([0-9a-f]{64})\s+(.+)$/.exec(line.trim());
    if (match === null) continue;
    map.set(basename(match[2].trim()), match[1]);
  }
  return map;
}

export function loadEnvironment() {
  const producerRoot = requireAbsolute('BATON_PRODUCER_ROOT', process.env.BATON_PRODUCER_ROOT);
  const floorNode = requireAbsolute('BATON_FLOOR_NODE', process.env.BATON_FLOOR_NODE);
  const evidenceDir = requireAbsolute('BATON_EVIDENCE_DIR', process.env.BATON_EVIDENCE_DIR);
  const expect = process.env.BATON_EXPECT ?? 'corrected';
  if (expect !== 'historical' && expect !== 'corrected') {
    throw new EnvironmentRefusal('unknownExpectation', expect);
  }
  if (!existsSync(evidenceDir)) {
    throw new EnvironmentRefusal('evidenceDirectoryMissing', evidenceDir);
  }
  const runtimeDir = join(producerRoot, 'bend2', 'context', 'runtime');
  if (!existsSync(runtimeDir)) {
    throw new EnvironmentRefusal('producerRuntimeMissing', runtimeDir);
  }
  try {
    accessSync(floorNode, constants.X_OK);
  } catch (error) {
    throw new EnvironmentRefusal('floorNodeNotExecutable', `${floorNode}: ${error.code ?? error.message}`);
  }

  const floorHash = sha256File(floorNode);
  const expectedPath = process.env.BATON_EXPECTED_PRODUCER_HASHES ?? null;
  const expected = expectedPath === null ? null : parseExpectedHashes(expectedPath);
  const hashes = {};
  const mismatches = [];
  const missing = [];
  for (const name of PRODUCER_FILES) {
    const path = join(runtimeDir, name);
    if (!existsSync(path)) {
      missing.push(name);
      continue;
    }
    const digest = sha256File(path);
    hashes[name] = digest;
    if (expected !== null) {
      const wanted = expected.get(name);
      if (wanted === undefined) missing.push(`${name} (not in expected list)`);
      else if (wanted !== digest) mismatches.push(`${name}: expected ${wanted} found ${digest}`);
    }
  }

  const platform = {
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    nodeVersion: process.version,
    floorNode,
    floorNodeSha256: floorHash,
  };

  return {
    producerRoot,
    runtimeDir,
    floorNode,
    floorHash,
    evidenceDir,
    expect,
    expectedPath,
    hashes,
    mismatches,
    missing,
    platform,
    // The platform keys an explicit child environment may gain. On macOS the
    // text-encoding variable appears; on Linux the expected addition set is empty.
    platformInjectedEnvKeys: process.platform === 'darwin' ? ['__CF_USER_TEXT_ENCODING'] : [],
    runtimePath: (name) => join(runtimeDir, name),
    helperPath: (name) => join(HELPERS_DIR, name),
  };
}

export function producerDigestLines(environment) {
  return Object.keys(environment.hashes).sort()
    .map((name) => `${environment.hashes[name]}  ${join(environment.runtimeDir, name)}`);
}
