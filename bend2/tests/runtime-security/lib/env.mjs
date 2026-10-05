// Portable fixture environment contract and central closure-aware admission.
//
// Injected inputs:
//   BATON_PRODUCER_ROOT              absolute producer worktree root under test
//   BATON_FLOOR_NODE                 absolute exact-floor Node executable
//   BATON_EVIDENCE_DIR               absolute evidence directory (must exist)
//   BATON_EXPECTED_PRODUCER_HASHES   absolute ROOT-ADMITTED manifest (required)
//   BATON_HISTORICAL_PIN             optional pin NAME that selects one historical case
//   BATON_HISTORICAL_CLOSURE_SHA256  optional cross-check equal to that pin's closure digest
//
// Admission has one authority: the admitted execution manifest. In BOTH modes
// every actually executed producer module must appear in that manifest with a
// matching digest; a missing, unsupported, unresolved, uncovered or mismatched
// dependency refuses. The historical pin adds provenance labelling on top of
// that check and never replaces it: retained-history incompleteness is reported
// as incomplete, and is never presented as exact historical qualification.

import { createHash } from 'node:crypto';
import { readFileSync, statSync, accessSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, basename } from 'node:path';
import os from 'node:os';
import { ClosureRefusal, resolveClosure } from './closure.mjs';
import { HISTORICAL_PINS } from './pins.mjs';

export const LIB_DIR = dirname(fileURLToPath(import.meta.url));
export const SUITE_DIR = dirname(LIB_DIR);
export const HELPERS_DIR = join(SUITE_DIR, 'helpers');

export const FIXTURE_ENTRIES = Object.freeze({
  'exec-continuity': Object.freeze(['bootstrap.mjs']),
  'json-list-fields': Object.freeze([]),
  'inspector-boundary': Object.freeze([]),
  'bootstrap-exec': Object.freeze(['bootstrap.mjs']),
  'grants-admission': Object.freeze(['cdp-intents.mjs', 'cdp-state.mjs', 'cdp-session.mjs']),
  'session-transport': Object.freeze(['cdp-session.mjs']),
  'endpoint-watch': Object.freeze(['cdp-endpoint.mjs']),
  'endpoint-replacement': Object.freeze(['cdp-endpoint.mjs']),
});

export function unionEntries() {
  const all = new Set();
  for (const entries of Object.values(FIXTURE_ENTRIES)) for (const name of entries) all.add(name);
  return [...all].sort();
}

export class EnvironmentRefusal extends Error {
  constructor(condition, detail) {
    super(detail === undefined || detail === null ? condition : `${condition}: ${detail}`);
    this.name = 'EnvironmentRefusal';
    this.condition = condition;
    this.detail = detail === undefined ? null : detail;
  }
}

function requireAbsolute(name, value) {
  if (typeof value !== 'string' || value.length === 0) throw new EnvironmentRefusal('missingEnvironment', name);
  if (!isAbsolute(value)) throw new EnvironmentRefusal('relativeEnvironment', `${name}=${value}`);
  return value;
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function closureDigest(hashes, names) {
  const lines = [...names].sort().map((name) => `${name}:${hashes[name] ?? ''}`);
  return createHash('sha256').update(`${lines.join('\n')}\n`).digest('hex');
}

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

  const pinName = process.env.BATON_HISTORICAL_PIN ?? null;
  const pinClosure = process.env.BATON_HISTORICAL_CLOSURE_SHA256 ?? null;
  if (pinName !== null && HISTORICAL_PINS[pinName] === undefined) {
    throw new EnvironmentRefusal('historicalPinUnknown', pinName);
  }
  if (pinName !== null && pinClosure !== null && HISTORICAL_PINS[pinName].closureSha256 !== pinClosure) {
    throw new EnvironmentRefusal('historicalPinClosureDisagreement',
      `${pinName} is ${HISTORICAL_PINS[pinName].closureSha256}, got ${pinClosure}`);
  }

  return {
    producerRoot,
    runtimeDir,
    floorNode,
    floorNodeSha256: sha256File(floorNode),
    evidenceDir,
    expectedPath,
    expectedEntries: Object.fromEntries(parseExpectedHashes(expectedPath)),
    pinName,
    pin: pinName === null ? null : HISTORICAL_PINS[pinName],
    platform: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      nodeVersion: process.version,
      floorNode,
      floorNodeSha256: sha256File(floorNode),
    },
    platformInjectedEnvKeys: process.platform === 'darwin' ? ['__CF_USER_TEXT_ENCODING'] : [],
    runtimePath: (name) => join(runtimeDir, name),
    helperPath: (name) => join(HELPERS_DIR, name),
  };
}

// Resolve the executed closure and validate it against the admitted manifest.
// This runs in both modes.
function admitExecutedClosure(environment, entries) {
  // A resolver refusal is an admission outcome, not an uncaught exception, and
  // never a success. Any other error is a real defect and is not converted.
  let closure;
  try {
    closure = resolveClosure(environment.runtimeDir, entries);
  } catch (error) {
    if (error instanceof ClosureRefusal) throw new EnvironmentRefusal(error.condition, error.detail);
    throw error;
  }
  if (closure.unsupported.length > 0) {
    throw new EnvironmentRefusal('closureUnsupportedForm', closure.unsupported.join(' | '));
  }
  if (closure.missing.length > 0) throw new EnvironmentRefusal('closureModuleMissing', closure.missing.join(', '));

  const observed = {};
  const uncovered = [];
  const mismatches = [];
  for (const name of closure.files) {
    observed[name] = sha256File(join(environment.runtimeDir, name));
    const admitted = environment.expectedEntries[name];
    if (admitted === undefined) uncovered.push(name);
    else if (admitted !== observed[name]) mismatches.push(`${name}: admitted ${admitted} observed ${observed[name]}`);
  }
  if (uncovered.length > 0) throw new EnvironmentRefusal('expectedHashesIncomplete', uncovered.join(', '));
  if (mismatches.length > 0) throw new EnvironmentRefusal('sourceHashMismatch', mismatches.join(' | '));
  return { closure, observed };
}

// Declared for report completeness: what the scan can and cannot establish.
export const SCANNER_LIMITS = 'closure scan refuses unrecognised import/export/require forms and non-relative specifiers; template and regex literals are not modelled, so a dependency reachable only through them is not detected and such a tree requires an explicit manifest-bound graph';

export function admitEnvironment(environment, entries) {
  const { closure, observed } = admitExecutedClosure(environment, entries);

  let historicalScope = null;
  if (environment.pin !== null) {
    const scope = environment.pin.scopeFiles;
    const scopeObserved = {};
    const missing = [];
    const mismatch = [];
    for (const name of scope) {
      const path = join(environment.runtimeDir, name);
      if (!existsSync(path)) {
        missing.push(name);
        continue;
      }
      scopeObserved[name] = sha256File(path);
      const admitted = environment.expectedEntries[name];
      if (admitted === undefined) missing.push(`${name} (not in admitted manifest)`);
      else if (admitted !== scopeObserved[name]) mismatch.push(name);
    }
    if (missing.length > 0) throw new EnvironmentRefusal('historicalScopeUnavailable', missing.join(', '));
    if (mismatch.length > 0) throw new EnvironmentRefusal('historicalScopeHashMismatch', mismatch.join(', '));
    const scopeDigest = closureDigest(scopeObserved, scope);
    if (scopeDigest !== environment.pin.closureSha256) {
      throw new EnvironmentRefusal('historicalClosureMismatch',
        `expected ${environment.pin.closureSha256} observed ${scopeDigest}`);
    }
    historicalScope = {
      pin: environment.pinName,
      scopeFiles: scope,
      digest: scopeDigest,
      // Provenance labelling only: retained history covers these files.
      retainedHistoryFiles: scope.slice(),
      // Executed here but never digest-recorded for that era.
      unverifiedForEra: closure.files.filter((name) => !scope.includes(name)),
      exactHistoricalQualification: false,
      note: 'the executed closure is validated against the admitted current manifest; retained history is incomplete and is not exact historical qualification',
    };
  }

  return {
    ...environment,
    entries,
    closureFiles: closure.files,
    observedHashes: observed,
    closureScan: closure.scanner,
    closureAllowedBuiltins: closure.allowedBuiltins,
    closureScannerLimits: SCANNER_LIMITS,
    historicalScope,
  };
}

export function openEnvironmentOrExit(entries = []) {
  let environment;
  try {
    environment = admitEnvironment(loadEnvironment(), entries);
  } catch (error) {
    if (error instanceof EnvironmentRefusal) {
      process.stdout.write(`FAIL environment ${error.condition}${error.detail === null ? '' : `: ${error.detail}`}\n`);
      process.exit(3);
    }
    throw error;
  }
  return environment;
}

export function observedDigestLines(environment) {
  return Object.keys(environment.observedHashes).sort()
    .map((name) => `${environment.observedHashes[name]}  ${join(environment.runtimeDir, name)}`);
}
