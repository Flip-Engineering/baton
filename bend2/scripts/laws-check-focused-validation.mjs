#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const SOURCE = resolve(process.argv[2] ?? '');
const BEND = resolve(process.argv[3] ?? '');
const OUTPUT = resolve(process.argv[4] ?? '');
if (!SOURCE || !BEND || !OUTPUT || !existsSync(join(SOURCE, 'bend2', 'scripts', 'laws-check.mjs')) || !existsSync(BEND)) {
  console.error('usage: node laws-check-focused-validation.mjs SOURCE_ROOT BEND OUTPUT_DIR');
  process.exit(2);
}

const PIN = '351c9aba85c69f4e4aab1f86cc31fb0f415fe327';
const SOURCE_SHA = execFileSync('git', ['-C', SOURCE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (SOURCE_SHA !== PIN) throw new Error(`source pin mismatch: ${SOURCE_SHA}`);
const SOURCE_TREE = execFileSync('git', ['-C', SOURCE, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
if (SOURCE_TREE !== '9afffc172eec7b77eb5d3df1a15aaa6cc2e334c5') throw new Error(`source tree mismatch: ${SOURCE_TREE}`);
const DRIVER_SHA = process.env.BATON2_DRIVER_SHA ?? null;
const DRIVER_TREE = process.env.BATON2_DRIVER_TREE ?? null;
const CONTROL_MODE = process.env.BATON2_CONTROL_MODE ?? 'all';
if (!['all', 'proof-removal-only'].includes(CONTROL_MODE)) throw new Error(`unsupported control mode: ${CONTROL_MODE}`);
const PRIOR_MUTATION_EVIDENCE = CONTROL_MODE === 'proof-removal-only' ? {
  runId: process.env.BATON2_PRIOR_MUTATION_RUN ?? null,
  artifactId: process.env.BATON2_PRIOR_MUTATION_ARTIFACT ?? null,
  artifactSha256: process.env.BATON2_PRIOR_MUTATION_ARCHIVE_SHA256 ?? null,
  sourceSha: process.env.BATON2_PRIOR_MUTATION_SOURCE_SHA ?? null,
  sourceTree: process.env.BATON2_PRIOR_MUTATION_SOURCE_TREE ?? null,
  driverSha: process.env.BATON2_PRIOR_MUTATION_DRIVER_SHA ?? null,
  driverTree: process.env.BATON2_PRIOR_MUTATION_DRIVER_TREE ?? null,
  scope: 'baseline-and-five-positive-mutation-controls',
  proofRemovalQualification: 'failed-prior-diagnostic-predicate',
} : null;
if (CONTROL_MODE === 'proof-removal-only' && (
  !PRIOR_MUTATION_EVIDENCE.runId || !PRIOR_MUTATION_EVIDENCE.artifactId
  || !/^[a-f0-9]{64}$/.test(PRIOR_MUTATION_EVIDENCE.artifactSha256 ?? '')
  || PRIOR_MUTATION_EVIDENCE.sourceSha !== PIN
  || PRIOR_MUTATION_EVIDENCE.sourceTree !== SOURCE_TREE
  || !PRIOR_MUTATION_EVIDENCE.sourceTree || !PRIOR_MUTATION_EVIDENCE.driverSha || !PRIOR_MUTATION_EVIDENCE.driverTree
)) throw new Error('proof-removal-only mode requires immutable same-source positive-control evidence');
mkdirSync(OUTPUT, { recursive: true });
const CASES = join(OUTPUT, 'case-tree');
const LOGS = join(OUTPUT, 'logs');
mkdirSync(LOGS, { recursive: true });
const commands = [];
let inventory = [];
let selectedNames = [];
const proofRemovalEvidence = [];
let gateStatus = 'in_progress';
const controlFailures = [];
const lawsCheckPath = join(SOURCE, 'bend2', 'scripts', 'laws-check.mjs');
const lawsText = readFileSync(lawsCheckPath, 'utf8');
const mutationStart = lawsText.indexOf('const MUTATIONS = [');
const loopStart = lawsText.indexOf('\nfor (const mutation of MUTATIONS)', mutationStart);
if (mutationStart < 0 || loopStart < 0) throw new Error('could not locate static MUTATIONS block');
const metadataProgram = `${lawsText.slice(mutationStart, loopStart)}\nMUTATIONS;`;
const mutations = runInNewContext(metadataProgram, { join }, { timeout: 3000 });
if (!Array.isArray(mutations) || mutations.length === 0) throw new Error('expected a non-empty runtime mutation list');

function shaBytes(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function shaFile(path) { return shaBytes(readFileSync(path)); }
function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }
function lineNumbers(text, needle) {
  const lines = [];
  let from = 0;
  while (true) {
    const index = text.indexOf(needle, from);
    if (index < 0) return lines;
    lines.push(text.slice(0, index).split('\n').length);
    from = index + 1;
  }
}
function lawDefinitions(name) {
  const found = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.bend')) {
        const text = readFileSync(path, 'utf8');
        const re = new RegExp(`^law\\s+${name}\\s*:`, 'gm');
        let match;
        while ((match = re.exec(text))) found.push({ path: relative(SOURCE, path), line: text.slice(0, match.index).split('\n').length });
      }
    }
  }
  walk(join(SOURCE, 'bend2', 'src'));
  return found;
}
function persistSummary() {
  writeJson(join(OUTPUT, 'summary.json'), {
    schema: 'laws-check-focused-partial-validation-v1',
    status: gateStatus,
    sourceSha: SOURCE_SHA,
    sourceTree: SOURCE_TREE,
    driverSha: DRIVER_SHA,
    driverTree: DRIVER_TREE,
    driverSha256: shaFile(new URL(import.meta.url).pathname),
    bendPath: BEND,
    bendVersion: globalThis.bendVersion ?? null,
    lawsCheckSha256: shaFile(lawsCheckPath),
    staticMutationCount: inventory.length,
    controlMode: CONTROL_MODE,
    priorMutationEvidence: PRIOR_MUTATION_EVIDENCE,
    focusedMutationNames: selectedNames,
    proofRemovalEvidence,
    controlFailures,
    compileCount: commands.length,
    commands,
    completeLawsSuiteOrPackageAcceptance: false,
  });
}
function recordCommand(name, argv, cwd, result, expected) {
  const prefix = join(LOGS, name);
  const stdoutPath = `${prefix}.stdout`;
  const stderrPath = `${prefix}.stderr`;
  writeFileSync(stdoutPath, result.stdout ?? '');
  writeFileSync(stderrPath, result.stderr ?? '');
  const entry = {
    name, argv, cwd,
    environment: { BEND_NO_TELEMETRY: '1', LANG: process.env.LANG ?? '', LC_ALL: process.env.LC_ALL ?? '', PATH: process.env.PATH ?? '' },
    exitCode: result.status,
    stdout: { path: relative(OUTPUT, stdoutPath), bytes: Buffer.byteLength(result.stdout ?? ''), sha256: shaFile(stdoutPath) },
    stderr: { path: relative(OUTPUT, stderrPath), bytes: Buffer.byteLength(result.stderr ?? ''), sha256: shaFile(stderrPath) },
    passed: expected(result),
  };
  commands.push(entry);
  persistSummary();
  return entry;
}
function bendCheck(name) {
  const argv = [BEND, join(CASES, 'bend2', 'src', 'coordinator', 'main.bend'), '--check-only'];
  try {
    const stdout = execFileSync(argv[0], argv.slice(1), { cwd: CASES, env: { ...process.env, BEND_NO_TELEMETRY: '1' }, encoding: 'utf8', maxBuffer: Infinity });
    return recordCommand(name, argv, CASES, { status: 0, stdout, stderr: '' }, () => true);
  } catch (error) {
    return recordCommand(name, argv, CASES, { status: error.status ?? 1, stdout: `${error.stdout ?? ''}`, stderr: `${error.stderr ?? ''}` }, () => false);
  }
}
function restore(relativePath) {
  copyFileSync(join(SOURCE, relativePath), join(CASES, relativePath));
}
function removeProof(relativePath, name) {
  const path = join(CASES, relativePath);
  const source = readFileSync(path, 'utf8');
  const lines = source.split('\n');
  const matches = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].startsWith(`def ${name}(`)) matches.push(i);
  if (matches.length !== 1) return null;
  const start = matches[0];
  let end = start + 1;
  while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]))) end++;
  const proofText = lines.slice(start, end).join('\n');
  lines.splice(start, end - start);
  const mutatedSource = lines.join('\n');
  writeFileSync(path, mutatedSource);
  return {
    sourceSha256: shaBytes(Buffer.from(source)),
    proofSha256: shaBytes(Buffer.from(proofText)),
    proofText,
    startLine: start + 1,
    endLine: end,
    mutatedSha256: shaBytes(Buffer.from(mutatedSource)),
  };
}

inventory = mutations.map((mutation) => {
  if (typeof mutation.name !== 'string' || !mutation.name || typeof mutation.file !== 'string' || !mutation.file || typeof mutation.find !== 'string' || !mutation.find || typeof mutation.replace !== 'string' || typeof mutation.law !== 'string' || !mutation.law) throw new Error('mutation metadata is incomplete');
  const path = join(SOURCE, mutation.file);
  const sourceText = readFileSync(path, 'utf8');
  const lawFiles = lawDefinitions(mutation.law);
  return {
    name: mutation.name,
    file: mutation.file,
    fileSha256: shaFile(path),
    needle: mutation.find,
    needleSha256: shaBytes(Buffer.from(mutation.find)),
    needleOccurrenceLines: lineNumbers(sourceText, mutation.find),
    law: mutation.law,
    lawDefinitions: lawFiles,
    replacement: mutation.replace,
  };
});
const multipleNames = new Set([
  'native-main-discards-runtime-arguments',
  'principal-report-ignores-immediate-parent',
  'later-terminal-replaces-the-managed-completion',
  'native-detached-launch-skipped',
  'native-receiver-accepts-unchecked-endpoint',
  'native-receiver-duplicates-wake-argument',
  'native-start-entry-skips-setup',
  'player-retry-ignores-harness',
  'player-retry-ignores-model',
  'connect-admits-non-text-argv',
  'knowledge-empty-record-result-delivers-the-old-notice',
]);
const missingNeedles = inventory.filter((item) => item.needleOccurrenceLines.length === 0);
const multipleNeedles = inventory.filter((item) => item.needleOccurrenceLines.length > 1);
const badLaws = inventory.filter((item) => item.lawDefinitions.length !== 1);
const duplicateNames = inventory.filter((item, index) => inventory.findIndex((other) => other.name === item.name) !== index);
if (missingNeedles.length || badLaws.length || duplicateNames.length || multipleNeedles.length !== multipleNames.size || multipleNeedles.some((item) => !multipleNames.has(item.name)) || [...multipleNames].some((name) => !multipleNeedles.some((item) => item.name === name))) {
  writeJson(join(OUTPUT, 'inventory.json'), { sourceSha: SOURCE_SHA, sourceTree: SOURCE_TREE, inventory, missingNeedles, multipleNeedles, duplicateNames, badLaws });
  throw new Error('complete runtime mutation inventory does not match the pinned occurrence contract');
}
writeJson(join(OUTPUT, 'inventory.json'), {
  schema: 'laws-check-complete-static-inventory-v1',
  sourceSha: SOURCE_SHA,
  sourceTree: SOURCE_TREE,
  lawsCheckSha256: shaFile(lawsCheckPath),
  mutationCount: inventory.length,
  missingNeedles,
  multipleNeedles,
  duplicateNames,
  lawDefinitionErrors: badLaws,
  entries: inventory,
});

selectedNames = [
  'principal-completion-preparation-uses-parent-only',
  'naming-entry-skips-the-store',
  'm17-refused-conversation-completes-instead',
  'm3a-held-advance-drops-the-fast-forward-requirement',
  'admitted-wake-skips-the-detached-native-launch',
];
const selected = selectedNames.map((name) => mutations.find((item) => item.name === name));
if (selected.some((item) => !item)) throw new Error('focused mutation entry is missing');
if (CONTROL_MODE === 'all') for (const item of selected) {
  const entry = inventory.find((row) => row.name === item.name);
  if (entry.needleOccurrenceLines.length !== 1) throw new Error(`focused needle must occur exactly once: ${item.name}`);
}

rmSync(CASES, { recursive: true, force: true });
mkdirSync(CASES, { recursive: true });
cpSync(join(SOURCE, 'bend2'), join(CASES, 'bend2'), { recursive: true });
persistSummary();
bendCheck('baseline-source-check');
const baselinePassed = commands.at(-1).passed;
if (!baselinePassed) {
  gateStatus = 'failed';
  controlFailures.push({ phase: 'baseline', name: 'baseline-source-check', exitCode: commands.at(-1).exitCode });
  persistSummary();
}

if (CONTROL_MODE === 'all') for (const item of selected) {
  restore(item.file);
  const path = join(CASES, item.file);
  const original = readFileSync(path, 'utf8');
  if (lineNumbers(original, item.find).length !== 1) throw new Error(`needle count changed in case tree: ${item.name}`);
  writeFileSync(path, original.replace(item.find, item.replace));
  const result = bendCheck(`mutation-${item.name}`);
  const output = readFileSync(join(OUTPUT, result.stderr.path), 'utf8') + readFileSync(join(OUTPUT, result.stdout.path), 'utf8');
  result.expectedDiagnosticLaw = item.law;
  result.expectedDiagnosticObserved = result.exitCode !== 0 && output.includes(item.law);
  result.qualification = baselinePassed ? 'qualified' : 'unqualified-baseline-failed';
  result.passed = baselinePassed && result.expectedDiagnosticObserved;
  restore(item.file);
  if (baselinePassed && !result.passed) {
    gateStatus = 'failed';
    controlFailures.push({ phase: 'mutation', name: item.name, law: item.law, exitCode: result.exitCode });
    persistSummary();
  }
}

for (const item of selected) {
  const declaration = lawDefinitions(item.law);
  if (declaration.length !== 1) {
    gateStatus = 'failed';
    controlFailures.push({ phase: 'proof-removal', name: item.name, law: item.law, error: `expected exactly one law definition, found ${declaration.length}` });
    persistSummary();
    continue;
  }
  restore(declaration[0].path);
  const removed = removeProof(declaration[0].path, item.law);
  if (!removed) {
    gateStatus = 'failed';
    controlFailures.push({ phase: 'proof-removal', name: item.name, law: item.law, error: 'proof helper not found' });
    persistSummary();
    continue;
  }
  const proofDir = join(OUTPUT, 'proof-removals');
  mkdirSync(proofDir, { recursive: true });
  const proofArtifact = join(proofDir, `${item.law}.proof.txt`);
  const mutatedArtifact = join(proofDir, `${item.law}.bend`);
  writeFileSync(proofArtifact, removed.proofText);
  copyFileSync(join(CASES, declaration[0].path), mutatedArtifact);
  proofRemovalEvidence.push({
    law: item.law,
    lawDeclarationLine: declaration[0].line,
    functionName: item.law,
    file: declaration[0].path,
    startLine: removed.startLine,
    endLine: removed.endLine,
    sourceSha256: removed.sourceSha256,
    proofArtifact: relative(OUTPUT, proofArtifact),
    proofSha256: shaFile(proofArtifact),
    mutatedFileArtifact: relative(OUTPUT, mutatedArtifact),
    mutatedFileSha256: shaFile(mutatedArtifact),
  });
  const result = bendCheck(`proof-removal-${item.law}`);
  const output = readFileSync(join(OUTPUT, result.stderr.path), 'utf8') + readFileSync(join(OUTPUT, result.stdout.path), 'utf8');
  result.expectedDiagnosticLaw = item.law;
  result.expectedDiagnostic = 'Error: 1 TODO found. The code is incomplete, and not a valid proof yet.';
  result.expectedDiagnosticObserved = result.exitCode !== 0
    && (output.match(/TODO found/g) ?? []).length === 1
    && /Error: 1 TODO found\.\s+The code is incomplete, and not a valid proof yet\./.test(output);
  proofRemovalEvidence.at(-1).diagnosticObserved = result.expectedDiagnosticObserved;
  proofRemovalEvidence.at(-1).stderrSha256 = result.stderr.sha256;
  result.qualification = baselinePassed ? 'qualified' : 'unqualified-baseline-failed';
  result.passed = baselinePassed && result.expectedDiagnosticObserved;
  restore(declaration[0].path);
  if (baselinePassed && !result.passed) {
    gateStatus = 'failed';
    controlFailures.push({ phase: 'proof-removal', name: item.name, law: item.law, exitCode: result.exitCode });
    persistSummary();
  }
}

const version = execFileSync(BEND, ['version'], { encoding: 'utf8', env: { ...process.env, BEND_NO_TELEMETRY: '1' } }).trim();
globalThis.bendVersion = version;
gateStatus = commands.every((command) => command.passed) && controlFailures.length === 0 ? 'passed' : 'failed';
persistSummary();
console.log(JSON.stringify({ passed: gateStatus === 'passed', sourceSha: SOURCE_SHA, bendVersion: version, staticMutationCount: inventory.length, compileCount: commands.length, status: gateStatus }));
if (gateStatus !== 'passed') process.exitCode = 1;
