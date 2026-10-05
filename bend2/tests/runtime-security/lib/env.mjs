// Portable fixture environment contract and central source admission.
//
// Nothing here hardcodes a host path. The caller injects:
//   BATON_PRODUCER_ROOT              absolute root of the producer worktree under test
//   BATON_FLOOR_NODE                 absolute exact-floor Node executable
//   BATON_EVIDENCE_DIR               absolute directory for result artifacts (required)
//   BATON_EXPECTED_PRODUCER_HASHES   absolute ROOT-ADMITTED frozen manifest (required)
//   BATON_HISTORICAL_CLOSURE_SHA256  optional; enables the pinned historical expectation
//
// The expected manifest is an admitted input. It must not be produced from the
// tree under test: producing expectations from the tree under test would accept
// any tree. The runner records fresh observed digests separately, under
// `observed.producer.sha256`, and never feeds them back as expectations.
//
// Admission refuses before any producer import or child spawn when the manifest
// is absent, malformed, duplicated, incomplete for the imported dependency
// closure, or disagrees with the tree.

import { createHash } from 'node:crypto';
import { readFileSync, statSync, accessSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, basename } from 'node:path';
import os from 'node:os';

export const LIB_DIR = dirname(fileURLToPath(import.meta.url));
export const SUITE_DIR = dirname(LIB_DIR);
export const HELPERS_DIR = join(SUITE_DIR, 'helpers');

// The dependency closure this suite imports or launches from the producer tree.
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

export function closureDigest(hashes) {
  const lines = PRODUCER_FILES.slice().sort().map((name) => `${name}:${hashes[name] ?? ''}`);
  return createHash('sha256').update(`${lines.join('\n')}\n`).digest('hex');
}

// Strict manifest parse: every non-empty, non-comment line must be a well-formed
// digest entry, and a basename may appear once.
export function parseExpectedHashes(path) {
  if (!existsSync(path)) throw new EnvironmentRefusal('expectedHashesMissing', path);
  const text = readFileSync(path, 'utf8');
  const map = new Map();
  const malformed = [];
  const duplicates = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const match = /^([0-9a-f]{64})[ \t]+(.+)$/.exec(line);
    if (match === null) {
      malformed.push(`line ${index + 1}: ${line.slice(0, 80)}`);
      continue;
    }
    const name = basename(match[2].trim());
    if (map.has(name)) {
      duplicates.push(name);
      continue;
    }
    map.set(name, match[1]);
  }
  if (malformed.length > 0) throw new EnvironmentRefusal('expectedHashesMalformed', malformed.join(' | '));
  if (duplicates.length > 0) throw new EnvironmentRefusal('expectedHashesDuplicate', duplicates.join(', '));
  return map;
}

export function loadEnvironment() {
  const producerRoot = requireAbsolute('BATON_PRODUCER_ROOT', process.env.BATON_PRODUCER_ROOT);
  const floorNode = requireAbsolute('BATON_FLOOR_NODE', process.env.BATON_FLOOR_NODE);
  const evidenceDir = requireAbsolute('BATON_EVIDENCE_DIR', process.env.BATON_EVIDENCE_DIR);
  const expectedPath = requireAbsolute('BATON_EXPECTED_PRODUCER_HASHES', process.env.BATON_EXPECTED_PRODUCER_HASHES);
  if (!existsSync(evidenceDir)) throw new EnvironmentRefusal('evidenceDirectoryMissing', evidenceDir);
  const runtimeDir = join(producerRoot, 'bend2', 'context', 'runtime');
  if (!existsSync(runtimeDir)) throw new EnvironmentRefusal('producerRuntimeMissing', runtimeDir);
  try {
    accessSync(floorNode, 1); // X_OK
  } catch (error) {
    throw new EnvironmentRefusal('floorNodeNotExecutable', `${floorNode}: ${error.code ?? error.message}`);
  }
  statSync(floorNode);

  const expected = parseExpectedHashes(expectedPath);
  const missingInManifest = PRODUCER_FILES.filter((name) => !expected.has(name));
  if (missingInManifest.length > 0) {
    throw new EnvironmentRefusal('expectedHashesIncomplete', missingInManifest.join(', '));
  }

  const hashes = {};
  const missingFiles = [];
  const mismatches = [];
  for (const name of PRODUCER_FILES) {
    const path = join(runtimeDir, name);
    if (!existsSync(path)) {
      missingFiles.push(name);
      continue;
    }
    const digest = sha256File(path);
    hashes[name] = digest;
    if (expected.get(name) !== digest) {
      mismatches.push(`${name}: admitted ${expected.get(name)} observed ${digest}`);
    }
  }

  const closure = closureDigest(hashes);
  const historicalPin = process.env.BATON_HISTORICAL_CLOSURE_SHA256 ?? null;

  return {
    producerRoot,
    runtimeDir,
    floorNode,
    floorNodeSha256: sha256File(floorNode),
    evidenceDir,
    expectedPath,
    expectedEntries: Object.fromEntries(expected),
    hashes,
    missingFiles,
    mismatches,
    closureSha256: closure,
    historicalPin,
    historicalPinMatches: historicalPin !== null && historicalPin === closure,
    platform: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      nodeVersion: process.version,
      floorNode,
    },
    platformInjectedEnvKeys: process.platform === 'darwin' ? ['__CF_USER_TEXT_ENCODING'] : [],
    runtimePath: (name) => join(runtimeDir, name),
    helperPath: (name) => join(HELPERS_DIR, name),
  };
}

// Central admission: refuses before any producer import or child spawn.
export function admitSource(environment) {
  if (environment.missingFiles.length > 0) {
    throw new EnvironmentRefusal('producerFileMissing', environment.missingFiles.join(', '));
  }
  if (environment.mismatches.length > 0) {
    throw new EnvironmentRefusal('sourceHashMismatch', environment.mismatches.join(' | '));
  }
  return environment;
}

// Uniform entry point for every fixture and for the suite runner. Returns an
// admitted environment or exits 3 with the refusal recorded on stdout.
export function openEnvironmentOrExit() {
  let environment;
  try {
    environment = admitSource(loadEnvironment());
  } catch (error) {
    if (error instanceof EnvironmentRefusal) {
      process.stdout.write(`FAIL environment ${error.condition}${error.detail === null ? '' : `: ${error.detail}`}\n`);
      process.exit(3);
    }
    throw error;
  }
  return environment;
}

// Freshly observed digests, for evidence only.
export function observedDigestLines(environment) {
  return PRODUCER_FILES.slice().sort()
    .map((name) => `${environment.hashes[name] ?? 'MISSING'}  ${join(environment.runtimeDir, name)}`);
}
