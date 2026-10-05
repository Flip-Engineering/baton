#!/usr/bin/env node
// CDP lane: raw evidence acquisition for the native runtime laws.
//
// This is a temporary, out-of-scan entrypoint for independent module development. The
// delivered obligation is that bend2/src/context/runtime/cdp-runtime-laws.bend is imported
// by the coordinator entry's law graph (bend2/src/coordinator/laws.bend), so the tree's own
// laws-check.mjs discovers and controls every statement. Until that import lands this
// entrypoint acquires evidence for two controls against the law module alone: per-law proof
// removal and per-control implementation mutation.
//
// This entrypoint observes and reports; it decides nothing. The mutation definitions and
// their declared expectations live in the side-effect-free module cdp-mutations.mjs, which
// is the importable handoff for the Interfaces owner. Attribution of a control belongs to
// the shared classification endpoint (bend2/scripts/laws-check.mjs --classify, CI
// f6108315, correction-required and pending); no local predicate marks a control as
// accepted, qualified or refused.
//
// One frozen snapshot of both native source files is taken once, before any control runs,
// and every case copies from that snapshot rather than from the live working tree, so each
// case is bound to the same complete original bytes as the baseline compile. Case
// directories and every edited, removed and unchanged byte are kept at durable evidence
// paths under the run directory; nothing referenced by a case record is deleted.
//
// Compilation runs on an admitted remote runner, never on the operator laptop.
//
// Usage: node bend2/context/runtime/cdp-native-laws.mjs [bend]
// Evidence: .scratch/cdp-lane/native-laws-<run>/

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  NATIVE_ENTRY,
  NATIVE_MODULES,
  NATIVE_MUTATIONS,
  PROOF_REMOVAL_DIAGNOSTIC,
  controlMetadata,
  mutationDefinition,
  mutationDefinitionDigest,
  sha256Bytes,
  sha256Text,
} from './cdp-mutations.mjs';

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '..', '..', '..');
const LAW_MODULE = 'bend2/src/context/runtime/cdp-runtime-laws.bend';
const OPERATIVE_MODULE = 'bend2/src/context/runtime/cdp-runtime.bend';
const RUN = join(ROOT, '.scratch', 'cdp-lane', `native-laws-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
mkdirSync(RUN, { recursive: true, mode: 0o700 });

const ENV_OVERRIDES = Object.freeze({ BEND_NO_TELEMETRY: '1' });
const ENV = { ...process.env, ...ENV_OVERRIDES };
const CLASSIFY_ENDPOINT = 'bend2/scripts/laws-check.mjs --classify (CI f6108315, correction-required and pending)';

// Environment identity: the names and a digest of the canonical name=value text the
// compiler ran with, plus the explicit overrides. Values are not copied into evidence.
function environmentIdentity() {
  const names = Object.keys(ENV).sort();
  const canonical = names.map((name) => `${name}=${ENV[name]}`).join('\u0000');
  return {
    entryCount: names.length,
    names,
    overrides: ENV_OVERRIDES,
    canonicalSha256: sha256Text(canonical),
  };
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

function resolveBend() {
  const candidates = [
    process.argv[2],
    process.env.BEND,
    join(ROOT, '.bend', 'bin', 'bend'),
    join(ROOT, 'node_modules', '.bend', 'bin', 'bend'),
    '/Users/wahargis/Development/Experiments/baton-bend2-root-delivery-20260928/.scratch/'
      + 'native-artifact-qualification-20261002T174637Z/toolchain-home/bin/bend',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  console.error('Bend is unavailable. Pass the qualified Bend 2.0.25 executable as an argument or set BEND.');
  process.exit(2);
}

const BEND = resolveBend();

function compilerIdentity() {
  const bytes = readFileSync(BEND);
  const version = spawnSync(BEND, ['version'], { env: ENV, encoding: 'utf8' });
  return {
    path: BEND,
    sha256: sha256Bytes(bytes),
    bytes: bytes.length,
    versionStdout: (version.stdout ?? '').trim(),
    versionStderr: (version.stderr ?? '').trim(),
    versionStatus: version.status,
  };
}

// The toolchain archive identity. Release archive bytes are not retained at the resolved
// install root, so only install markers can be reported: they are evidence that an
// installation exists there, not archive-byte identity, and the archive identity stays
// explicitly unavailable.
function archiveIdentity(bendPath) {
  const installRoot = resolve(bendPath, '..', '..');
  const markers = ['version', 'VERSION', 'SHASUMS256.txt', 'MANIFEST.json', 'bend2/base.bend'];
  const found = [];
  for (const marker of markers) {
    const path = join(installRoot, marker);
    if (!existsSync(path)) continue;
    const stats = statSync(path);
    found.push({
      path,
      bytes: stats.size,
      sha256: stats.isFile() ? sha256Bytes(readFileSync(path)) : null,
      kind: stats.isFile() ? 'file' : 'directory',
    });
  }
  return {
    installRoot,
    installMarkers: found,
    installMarkerEvidence: found.length > 0,
    reason: found.length > 0 ? null : 'no install marker found at the resolved install root',
    archiveIdentity: {
      available: false,
      reason: 'no release archive bytes are retained at the resolved install root; install markers are not archive-byte identity',
    },
  };
}

function runCompiler({ argv, cwd, label }) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(BEND, argv, { cwd, env: ENV, encoding: 'buffer', maxBuffer: Infinity });
  const endedAt = new Date().toISOString();
  const stdout = Buffer.from(result.stdout ?? Buffer.alloc(0));
  const stderr = Buffer.from(result.stderr ?? Buffer.alloc(0));
  const stdoutPath = join(RUN, `${label}.stdout.txt`);
  const stderrPath = join(RUN, `${label}.stderr.txt`);
  writeFileSync(stdoutPath, stdout);
  writeFileSync(stderrPath, stderr);
  return {
    record: {
      label,
      argv: [BEND, ...argv],
      cwd,
      envPolicy: { inherited: true, overrides: ENV_OVERRIDES },
      envSha256: environmentIdentity().canonicalSha256,
      // The compiler is spawned directly: this is the process that ran it, and there is no
      // wrapper process to name.
      wrapperArgv: null,
      wrapperPid: null,
      compilerPid: result.pid ?? null,
      startedAt,
      endedAt,
      status: result.status,
      signal: result.signal,
      spawnError: result.error === undefined || result.error === null
        ? null
        : { code: result.error.code ?? null, message: result.error.message },
      stdout: { path: stdoutPath, bytes: stdout.length, sha256: sha256Bytes(stdout) },
      stderr: { path: stderrPath, bytes: stderr.length, sha256: sha256Bytes(stderr) },
    },
    stdoutText: stdout.toString('utf8'),
    stderrText: stderr.toString('utf8'),
  };
}

// The one frozen snapshot every case and the baseline are bound to.
function freezeSnapshot() {
  const directory = join(RUN, 'frozen');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const files = {};
  for (const relative of NATIVE_MODULES) {
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
  for (const relative of NATIVE_MODULES) {
    const target = join(directory, relative.split('/').pop());
    cpSync(frozen.files[relative].frozenPath, target);
    const bytes = readFileSync(target);
    snapshot[relative] = {
      casePath: target,
      frozenSha256: frozen.files[relative].frozenSha256,
      caseSha256: sha256Bytes(bytes),
      bytes: bytes.length,
      matchesFrozen: sha256Bytes(bytes) === frozen.files[relative].frozenSha256,
    };
  }
  return { directory, snapshot, entry: snapshot[LAW_MODULE].casePath };
}

// Remove the `def <name>(...)` block, keeping the removed bytes and the edited module at
// durable paths.
function removeProof(caseDirectory, relative, name) {
  const path = join(caseDirectory, relative.split('/').pop());
  const original = readFileSync(path, 'utf8');
  const lines = original.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`def ${name}(`));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]))) end += 1;
  const prefix = start === 0 ? '' : `${lines.slice(0, start).join('\n')}\n`;
  const startByte = Buffer.byteLength(prefix, 'utf8');
  const removed = `${lines.slice(start, end).join('\n')}\n`;
  const changed = [...lines.slice(0, start), ...lines.slice(end)].join('\n');
  const removedPath = join(RUN, `proof-removed-${name}.txt`);
  const changedPath = join(RUN, `proof-edited-${name}.bend`);
  writeFileSync(removedPath, removed);
  writeFileSync(changedPath, changed);
  writeFileSync(path, changed);
  return {
    law: name,
    startLine: start + 1,
    endLine: end,
    // The exact byte delta of the edit, with the line range above.
    byteDelta: {
      startByte,
      endByte: startByte + Buffer.byteLength(removed, 'utf8'),
      removedBytes: Buffer.byteLength(removed, 'utf8'),
      originalBytes: Buffer.byteLength(original, 'utf8'),
      changedBytes: Buffer.byteLength(changed, 'utf8'),
      deltaBytes: Buffer.byteLength(changed, 'utf8') - Buffer.byteLength(original, 'utf8'),
    },
    sourceBinding: {
      relativePath: relative,
      casePath: path,
      originalSha256: sha256Text(original),
    },
    removedBytes: Buffer.byteLength(removed, 'utf8'),
    removedSha256: sha256Text(removed),
    removedPath,
    changedPath,
    changedBytes: Buffer.byteLength(changed, 'utf8'),
    changedSha256: sha256Text(changed),
    originalSha256: sha256Text(original),
  };
}

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

function lawNames(caseDirectory) {
  const rows = [];
  for (const line of readFileSync(join(caseDirectory, LAW_MODULE.split('/').pop()), 'utf8').split('\n')) {
    const match = /^law ([A-Za-z0-9_]+):/.exec(line);
    if (match) rows.push(match[1]);
  }
  return rows;
}

function caseRecordPath(label) {
  return join(RUN, `${label}.case.json`);
}

function writeCase(label, payload) {
  const path = caseRecordPath(label);
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
  return path;
}

function main() {
  const cases = [];
  const toolchain = compilerIdentity();
  const runtime = runtimeIdentity();
  const environment = environmentIdentity();
  const archive = archiveIdentity(BEND);
  const frozen = freezeSnapshot();
  const binding = { frozenSnapshot: frozen, toolchain, runtime, environment, archive };

  writeFileSync(join(RUN, 'toolchain.json'), `${JSON.stringify({ toolchain, runtime, environment, archive, wrapperPid: null }, null, 2)}\n`);

  const baselineCase = prepareCase('baseline', frozen);
  const baseline = runCompiler({ argv: [baselineCase.entry, '--check-only'], cwd: baselineCase.directory, label: 'baseline' });
  const baselineRecord = {
    case: 'baseline',
    kind: 'baseline',
    metadata: { control: 'entry-compiles-with-every-law-proven', law: null, entry: NATIVE_ENTRY, definitionSha256: null },
    binding,
    caseSnapshot: baselineCase.snapshot,
    observation: { process: baseline.record },
    attribution: { state: 'pending-shared-endpoint', endpoint: CLASSIFY_ENDPOINT },
  };
  baselineRecord.caseJson = writeCase('baseline', baselineRecord);
  cases.push(baselineRecord);
  const baselineLink = {
    caseJson: baselineRecord.caseJson,
    observationSha256: sha256Text(JSON.stringify(baselineRecord.observation)),
    frozenSnapshotDirectory: frozen.directory,
  };

  const names = lawNames(baselineCase.directory);
  for (const [index, name] of names.entries()) {
    const label = `proof-${index + 1}-${name}`;
    const prepared = prepareCase(label, frozen);
    const edit = removeProof(prepared.directory, LAW_MODULE, name);
    if (edit === null) {
      const missing = {
        case: `proof-removal:${name}`,
        kind: 'proof-removal',
        metadata: {
          control: `proof-removal:${name}`,
          law: name,
          file: LAW_MODULE,
          entry: NATIVE_ENTRY,
          expectedConstructors: null,
          diagnosticMarkers: [...PROOF_REMOVAL_DIAGNOSTIC],
          attributionRule: 'exact-proof-edit+diagnostic',
          definitionSha256: null,
        },
        binding,
        baselineLink,
        observation: { process: null, reason: 'the law has no proof beside it' },
        attribution: { state: 'pending-shared-endpoint', endpoint: CLASSIFY_ENDPOINT },
      };
      missing.caseJson = writeCase(label, missing);
      cases.push(missing);
      continue;
    }
    const run = runCompiler({ argv: [prepared.entry, '--check-only'], cwd: prepared.directory, label });
    const lawTextPath = join(RUN, `proof-compiled-${name}.bend`);
    writeFileSync(lawTextPath, readFileSync(prepared.entry));
    const record = {
      case: `proof-removal:${name}`,
      kind: 'proof-removal',
      metadata: {
        control: `proof-removal:${name}`,
        law: name,
        file: LAW_MODULE,
        entry: NATIVE_ENTRY,
        expectedConstructors: null,
        diagnosticMarkers: [...PROOF_REMOVAL_DIAGNOSTIC],
        attributionRule: 'exact-proof-edit+diagnostic',
        definitionSha256: null,
      },
      binding,
      baselineLink,
      caseSnapshot: prepared.snapshot,
      proofEdit: edit,
      lawTextAsCompiled: {
        path: lawTextPath,
        sha256: sha256Text(readFileSync(lawTextPath, 'utf8')),
      },
      nonTargetInputs: [OPERATIVE_MODULE],
      restoration: {
        caseDirectoryKept: true,
        frozenSnapshotUntouched: true,
        liveSourceUntouched: true,
      },
      observation: { process: run.record },
      attribution: { state: 'pending-shared-endpoint', endpoint: CLASSIFY_ENDPOINT },
    };
    record.caseJson = writeCase(label, record);
    cases.push(record);
  }

  for (const [index, mutation] of NATIVE_MUTATIONS.entries()) {
    const label = `mutation-${index + 1}-${mutation.name}`;
    const prepared = prepareCase(label, frozen);
    const detail = applyMutation(prepared.directory, mutation);
    if (!detail.applied) {
      const missing = {
        case: `mutation:${mutation.name}`,
        kind: 'implementation-mutation',
        metadata: controlMetadata(mutation, NATIVE_ENTRY),
        definition: mutationDefinition(mutation),
        definitionSha256: mutationDefinitionDigest(mutation),
        binding,
        baselineLink,
        observation: { process: null, reason: `the mutation subject occurs ${detail.occurrences} times` },
        attribution: { state: 'pending-shared-endpoint', endpoint: CLASSIFY_ENDPOINT },
      };
      missing.caseJson = writeCase(label, missing);
      cases.push(missing);
      continue;
    }
    const run = runCompiler({ argv: [prepared.entry, '--check-only'], cwd: prepared.directory, label });
    const lawTextPath = join(RUN, `mutation-compiled-${mutation.name}.bend`);
    writeFileSync(lawTextPath, readFileSync(prepared.entry));
    const record = {
      case: `mutation:${mutation.name}`,
      kind: 'implementation-mutation',
      metadata: controlMetadata(mutation, NATIVE_ENTRY),
      definition: mutationDefinition(mutation),
      definitionSha256: mutationDefinitionDigest(mutation),
      binding,
      baselineLink,
      caseSnapshot: prepared.snapshot,
      delta: detail,
      lawTextUnchanged: {
        path: lawTextPath,
        sha256: sha256Text(readFileSync(lawTextPath, 'utf8')),
      },
      nonTargetInputs: [LAW_MODULE],
      restoration: {
        caseDirectoryKept: true,
        frozenSnapshotUntouched: true,
        liveSourceUntouched: true,
      },
      observation: { process: run.record },
      attribution: { state: 'pending-shared-endpoint', endpoint: CLASSIFY_ENDPOINT },
    };
    record.caseJson = writeCase(label, record);
    cases.push(record);
  }

  const verdict = {
    suite: 'cdp-native-laws',
    classification: {
      state: 'pending-shared-endpoint',
      endpoint: CLASSIFY_ENDPOINT,
      note: 'this entrypoint acquires evidence only; no local predicate marks a control accepted or refused',
    },
    toolchain,
    runtime,
    environment,
    archive,
    frozenSnapshot: frozen,
    baseline: baselineRecord.caseJson,
    controlCount: cases.length,
    cases: cases.map((entry) => ({
      case: entry.case,
      caseJson: entry.caseJson,
      definitionSha256: entry.definitionSha256 ?? entry.metadata.definitionSha256 ?? null,
      stdout: entry.observation.process?.stdout?.path ?? null,
      stderr: entry.observation.process?.stderr?.path ?? null,
    })),
    run: RUN,
  };
  writeFileSync(join(RUN, 'acquisition.json'), `${JSON.stringify(verdict, null, 2)}\n`);
  for (const entry of cases) process.stdout.write(`acquired ${entry.case} -> ${entry.caseJson}\n`);
  process.stdout.write(`${JSON.stringify({ acquisition: 'complete', controls: cases.length, cases: RUN, classification: 'pending-shared-endpoint' })}\n`);
  process.exitCode = 0;
}

main();
