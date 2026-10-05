#!/usr/bin/env node
// CDP lane: raw evidence acquisition for the lane's JavaScript laws.
//
// Each law in cdp-law-checks.mjs is stated over the real exported functions of this lane's
// modules. For every control this entrypoint imports the mutated module set in process,
// runs the same law statements and records what the registry produced: which named law
// failed with what detail, which other laws failed, and whether the mutated set loaded at
// all. It decides nothing: attribution belongs to the shared classification endpoint
// (bend2/scripts/laws-check.mjs --classify, CI f6108315, correction-required and pending),
// and no local predicate marks a control accepted or refused.
//
// The mutation definitions, their canonical digests and their declared metadata live in the
// side-effect-free module cdp-mutations.mjs, which is the importable handoff for the
// Interfaces owner; this runnable entrypoint carries no definition of its own.
//
// One frozen snapshot of the module set is taken once, before any control runs, and every
// case copies from that snapshot rather than from the live working tree, so each case is
// bound to the same complete original bytes as the baseline run. Case directories and the
// changed bytes are kept at durable evidence paths under the run directory; nothing a case
// record references is deleted.
//
// Usage: node bend2/context/runtime/cdp-laws.mjs
// Evidence: .scratch/cdp-lane/laws-<run>/

import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as nodeFs from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { laws as lawStatements } from './cdp-law-checks.mjs';
import {
  JS_MODULES,
  JS_MUTATIONS,
  controlMetadata,
  mutationDefinition,
  mutationDefinitionDigest,
  sha256Bytes,
  sha256Text,
} from './cdp-mutations.mjs';

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '..', '..', '..');
const RUN = join(ROOT, '.scratch', 'cdp-lane', `laws-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
mkdirSync(RUN, { recursive: true, mode: 0o700 });

const JS_ENTRY = 'bend2/context/runtime/cdp-law-checks.mjs';
const CLASSIFY_ENDPOINT = 'bend2/scripts/laws-check.mjs --classify (CI f6108315, correction-required and pending)';
const ENV_OVERRIDES = Object.freeze({});

// Environment identity: the names and a digest of the canonical name=value text this
// process runs with, plus the explicit overrides. Values are not copied into evidence.
function environmentIdentity() {
  const names = Object.keys(process.env).sort();
  const canonical = names.map((name) => `${name}=${process.env[name]}`).join('\u0000');
  return { entryCount: names.length, names, overrides: ENV_OVERRIDES, canonicalSha256: sha256Text(canonical) };
}

// Runtime identity: the process that runs this entrypoint.
function runtimeIdentity() {
  const runtime = { path: process.execPath, version: process.version, sha256: null, bytes: null, reason: null };
  try {
    const bytes = readFileSync(process.execPath);
    runtime.sha256 = sha256Bytes(bytes);
    runtime.bytes = bytes.length;
  } catch (error) {
    runtime.reason = error.code ?? error.message;
  }
  return runtime;
}

// The one frozen snapshot every case and the baseline are bound to.
function freezeModules() {
  const directory = join(RUN, 'frozen');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const files = {};
  for (const relative of JS_MODULES) {
    const source = join(ROOT, relative);
    const frozenPath = join(directory, relative.split('/').pop());
    cpSync(source, frozenPath);
    const frozen = readFileSync(frozenPath);
    files[relative] = {
      sourcePath: source,
      frozenPath,
      sourceSha256: sha256Bytes(readFileSync(source)),
      frozenSha256: sha256Bytes(frozen),
      bytes: frozen.length,
      matchesSourceAtFreeze: sha256Bytes(frozen) === sha256Bytes(readFileSync(source)),
    };
  }
  return { directory, files };
}

// A case copies from the frozen snapshot, never from the live working tree.
function prepareCase(label, frozen) {
  const directory = join(RUN, 'cases', label);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const snapshot = {};
  for (const relative of JS_MODULES) {
    const target = join(directory, relative.split('/').pop());
    cpSync(frozen.files[relative].frozenPath, target);
    snapshot[relative] = {
      casePath: target,
      frozenSha256: frozen.files[relative].frozenSha256,
      caseSha256: sha256Bytes(readFileSync(target)),
      bytes: frozen.files[relative].bytes,
      matchesFrozen: sha256Bytes(readFileSync(target)) === frozen.files[relative].frozenSha256,
    };
  }
  return { directory, snapshot };
}

async function loadModules(directory) {
  const load = async (name) => import(pathToFileURL(join(directory, name)).href);
  const [counter, protocol, refs, state, intents, transport, endpoint, scripts, session, bootstrap] = await Promise.all([
    load('cdp-counter.mjs'),
    load('cdp-protocol.mjs'),
    load('cdp-refs.mjs'),
    load('cdp-state.mjs'),
    load('cdp-intents.mjs'),
    load('cdp-transport.mjs'),
    load('cdp-endpoint.mjs'),
    load('cdp-scripts.mjs'),
    load('cdp-session.mjs'),
    load('bootstrap-admission.mjs'),
  ]);
  return {
    counter, protocol, refs, state, intents, transport, endpoint, scripts, session, bootstrap,
    fs: nodeFs,
    scratchPrefix: join(RUN, 'tmp-'),
  };
}

async function runLaws(moduleSet, statementNames) {
  const failures = [];
  const statements = lawStatements(moduleSet);
  for (const statement of statements) {
    try {
      // A law may be asynchronous (a session refusal is observed through a promise).
      await statement.run();
    } catch (error) {
      failures.push({ law: statement.name, detail: error.message });
    }
  }
  const seen = new Set(statements.map((statement) => statement.name));
  for (const name of statementNames) {
    if (!seen.has(name)) failures.push({ law: name, detail: 'the law statement is missing from the module set' });
  }
  return failures;
}

// Apply one mutation, keeping the changed bytes at a durable path.
function applyMutation(caseDirectory, mutation) {
  const path = join(caseDirectory, mutation.file.split('/').pop());
  const original = readFileSync(path, 'utf8');
  const occurrences = original.split(mutation.find).length - 1;
  if (occurrences !== 1) return { applied: false, occurrences };
  const startByte = Buffer.byteLength(original.slice(0, original.indexOf(mutation.find)), 'utf8');
  const changed = original.replace(mutation.find, mutation.replace);
  const changedPath = join(RUN, `mutation-${mutation.name}.changed`);
  writeFileSync(changedPath, changed);
  writeFileSync(path, changed);
  return {
    applied: true,
    occurrences,
    changedPath,
    offsets: { startByte, endByte: startByte + Buffer.byteLength(mutation.find, 'utf8') },
    removedBytes: Buffer.byteLength(mutation.find, 'utf8'),
    removedSha256: sha256Text(mutation.find),
    insertedBytes: Buffer.byteLength(mutation.replace, 'utf8'),
    insertedSha256: sha256Text(mutation.replace),
    originalSha256: sha256Text(original),
    changedSha256: sha256Text(changed),
  };
}

function writeCase(label, payload) {
  const path = join(RUN, `${label}.case.json`);
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
  return path;
}

async function main() {
  const cases = [];
  const runtime = runtimeIdentity();
  const environment = environmentIdentity();
  const frozen = freezeModules();
  const binding = {
    frozenSnapshot: frozen,
    runtime,
    environment,
    compiler: null,
    archive: null,
    processModel: 'in-process module import; no compiler, child process or fixture is spawned',
  };

  const baselineCase = prepareCase('baseline', frozen);
  const statementNames = lawStatements(await loadModules(frozen.directory)).map((statement) => statement.name);
  const baselineFailures = await runLaws(await loadModules(frozen.directory), statementNames);
  const baseline = {
    case: 'shipped-modules',
    kind: 'baseline',
    metadata: { control: 'shipped-modules', law: null, entry: JS_ENTRY, definitionSha256: null },
    binding,
    caseSnapshot: baselineCase.snapshot,
    observation: { statementCount: statementNames.length, failures: baselineFailures },
    attribution: { state: 'pending-shared-endpoint', endpoint: CLASSIFY_ENDPOINT },
  };
  baseline.caseJson = writeCase('baseline', baseline);
  cases.push(baseline);

  for (const [index, mutation] of JS_MUTATIONS.entries()) {
    const label = `mutation-${index + 1}-${mutation.name}`;
    const prepared = prepareCase(label, frozen);
    const detail = applyMutation(prepared.directory, mutation);
    if (!detail.applied) {
      const missing = {
        case: `mutation:${mutation.name}`,
        kind: 'implementation-mutation',
        metadata: controlMetadata(mutation, JS_ENTRY, { attributionRule: 'named-law-failure' }),
        definition: mutationDefinition(mutation),
        definitionSha256: mutationDefinitionDigest(mutation),
        binding,
        caseSnapshot: prepared.snapshot,
        observation: { reason: `the mutation subject occurs ${detail.occurrences} times` },
        attribution: { state: 'pending-shared-endpoint', endpoint: CLASSIFY_ENDPOINT },
      };
      missing.caseJson = writeCase(label, missing);
      cases.push(missing);
      continue;
    }
    let loadFailure = null;
    let failures = [];
    try {
      const mutated = await loadModules(prepared.directory);
      failures = await runLaws(mutated, statementNames);
    } catch (error) {
      loadFailure = { message: error.message, code: error.code ?? null };
    }
    const record = {
      case: `mutation:${mutation.name}`,
      kind: 'implementation-mutation',
      metadata: controlMetadata(mutation, JS_ENTRY, { attributionRule: 'named-law-failure' }),
      definition: mutationDefinition(mutation),
      definitionSha256: mutationDefinitionDigest(mutation),
      binding,
      caseSnapshot: prepared.snapshot,
      delta: detail,
      nonTargetInputs: JS_MODULES.filter((file) => file !== mutation.file),
      restoration: { caseDirectoryKept: true, frozenSnapshotUntouched: true, liveSourceUntouched: true },
      observation: {
        namedLawFailure: failures.find((failure) => failure.law === mutation.law) ?? null,
        alsoFailed: failures.filter((failure) => failure.law !== mutation.law).map((failure) => failure.law),
        loadFailure,
      },
      attribution: { state: 'pending-shared-endpoint', endpoint: CLASSIFY_ENDPOINT },
    };
    record.caseJson = writeCase(label, record);
    cases.push(record);
  }

  const verdict = {
    suite: 'cdp-laws',
    classification: {
      state: 'pending-shared-endpoint',
      endpoint: CLASSIFY_ENDPOINT,
      note: 'this entrypoint acquires evidence only; no local predicate marks a control accepted or refused',
    },
    runtime,
    environment,
    frozenSnapshot: frozen,
    statementCount: statementNames.length,
    baseline: baseline.caseJson,
    controlCount: cases.length,
    cases: cases.map((entry) => ({
      case: entry.case,
      caseJson: entry.caseJson,
      definitionSha256: entry.definitionSha256 ?? null,
    })),
    run: RUN,
  };
  writeFileSync(join(RUN, 'acquisition.json'), `${JSON.stringify(verdict, null, 2)}\n`);
  for (const entry of cases) process.stdout.write(`acquired ${entry.case} -> ${entry.caseJson}\n`);
  process.stdout.write(`${JSON.stringify({ acquisition: 'complete', statements: statementNames.length, controls: cases.length, run: RUN, classification: 'pending-shared-endpoint' })}\n`);
  // Acquisition is not acceptance.
  process.exitCode = 0;
}

await main();
