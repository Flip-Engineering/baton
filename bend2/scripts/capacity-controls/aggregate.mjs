// Validation and merge of received group evidence, plus the agreed per-case
// classification endpoint. Every acceptance decision flows through the one
// shared qualification boundary in classify.mjs: independently discovered
// case identity, confined immutable artifacts with verified lengths and
// digests, a successful exact baseline for both control kinds, the mandatory
// exact applied delta against the selected source snapshot, the actual
// terminal outcome, and the definition-owned diagnostic constraints. Producer
// labels and counts never establish acceptance. Retained paths are confined
// by filesystem identity, not lexically.

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { accountingValid, classifyCase, splitTimeAccounting, validChildOutcome } from './classify.mjs';
import { bindingOf, definitionExpectation, definitionLocation, discoveryRecords, sha256Hex } from './work-set.mjs';
import { ENTRY, proofBlockRange, ROOT } from '../laws-common.mjs';
import { MUTATIONS } from '../laws-mutations.mjs';

export class UsageError extends Error {}

function reject(kind, bundle, detail, caseId) {
  return caseId === undefined ? { kind, bundle, detail } : { kind, bundle, case: caseId, detail };
}

// Module bytes for one record under the selected tree root. The root is the
// bend2 directory the records bind; repo-relative case paths start with
// bend2/.
function modulePath(moduleRoot, record) {
  const relativePath = record.module.startsWith('bend2/') ? record.module.slice('bend2/'.length) : record.module;
  return join(moduleRoot, relativePath);
}

// The exact changed bytes a control must have produced, re-derived from the
// original bytes and the authoritative definitions.
function expectedChangedBytes(originalText, record, definitions) {
  if (record.kind === 'proof-removal') {
    const block = proofBlockRange(originalText, record.law);
    if (!block) return null;
    const lines = originalText.split('\n');
    lines.splice(block.start, block.end - block.start);
    return lines.join('\n');
  }
  const definition = definitions.find((mutation) => `mutation:${mutation.name}` === record.id);
  if (!definition) return null;
  if (!originalText.includes(definition.find)) return null;
  return originalText.replace(definition.find, definition.replace);
}

// Retained evidence must live inside its bundle by filesystem identity, so a
// symlink cannot escape the directory.
function bundlePath(bundleDir, realBundleDir, relPath) {
  if (typeof relPath !== 'string' || relPath === '' || isAbsolute(relPath) || relPath.split(/[\\/]/).includes('..')) {
    return { fault: `retained path escapes the bundle: ${relPath}` };
  }
  const target = resolve(bundleDir, relPath);
  if (!existsSync(target)) return { fault: `retained file missing: ${relPath}` };
  if (lstatSync(target).isSymbolicLink()) return { fault: `retained file is a symlink: ${relPath}` };
  const real = realpathSync(target);
  if (real !== realBundleDir && !real.startsWith(realBundleDir + sep)) {
    return { fault: `retained path escapes the bundle: ${relPath}` };
  }
  return { path: target };
}

function verifyStream(bundleDir, realBundleDir, stream) {
  const found = bundlePath(bundleDir, realBundleDir, stream?.path);
  if (found.fault) return found.fault;
  const bytes = readFileSync(found.path);
  if (bytes.byteLength !== stream.bytes) {
    return `stream byte count changed: ${stream.path} recorded ${stream.bytes} actual ${bytes.byteLength}`;
  }
  if (sha256Hex(bytes) !== stream.sha256) return `stream sha256 changed: ${stream.path}`;
  return null;
}

function sameCase(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function ownSourceSnapshot() {
  if (!existsSync(join(ROOT, '.git'))) return null;
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: Infinity }).trim();
  return {
    head: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'),
    bend2_tree: git('rev-parse', 'HEAD:bend2'),
  };
}

function rewriteStream(bundleName, stream) {
  if (!stream || typeof stream.path !== 'string') return stream;
  return { ...stream, path: `${bundleName}/${stream.path}` };
}

export function aggregate({ dir, records, definitions, moduleRoot }) {
  const expectedRecords = records ?? discoveryRecords();
  const expectedBinding = bindingOf(expectedRecords);
  const expectedById = new Map(expectedRecords.map((record) => [record.id, record]));
  const definitionList = definitions ?? MUTATIONS;
  const treeRoot = moduleRoot ?? join(ROOT, 'bend2');
  const checkerPath = join(ROOT, 'bend2', 'scripts', 'laws-check.mjs');
  const ownCheckerSha256 = sha256Hex(readFileSync(checkerPath));
  const ownSource = ownSourceSnapshot();

  const rejections = [];
  if (expectedRecords.length === 0) {
    rejections.push(reject('empty-work-set', null, 'discovery produced no controls'));
  }
  const bundleNames = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'group-manifest.json')))
      .map((entry) => entry.name)
      .sort()
    : [];
  if (bundleNames.length === 0 && expectedRecords.length > 0) {
    rejections.push(reject('no-bundles', dir, 'no group manifest was received'));
  }

  const publishedBundles = [];
  const seenCases = new Map();
  const producingJobs = new Map();
  let reference = null;

  for (const name of bundleNames) {
    const bundleDir = join(dir, name);
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(bundleDir, 'group-manifest.json'), 'utf8'));
    } catch (error) {
      rejections.push(reject('corrupt-manifest', name, String(error)));
      continue;
    }
    const realBundleDir = realpathSync(bundleDir);

    if (manifest.binding !== expectedBinding) {
      rejections.push(reject('binding-mismatch', name, 'bundle discovery binding differs from the rediscovered work set'));
    }
    if (manifest.checker_sha256 !== ownCheckerSha256) {
      rejections.push(reject('checker-mismatch', name, 'bundle was produced by a different checker build'));
    }

    const identity = {
      source: manifest.source,
      origin: manifest.origin,
      compiler_sha256: manifest.compiler?.sha256 ?? null,
    };
    if (reference === null) {
      reference = identity;
    } else {
      if (JSON.stringify(identity.source) !== JSON.stringify(reference.source)) {
        rejections.push(reject('source-mismatch', name, 'bundle source snapshot differs from the other bundles'));
      }
      for (const key of ['workflow', 'run_id', 'run_attempt', 'image_os', 'image_version']) {
        if (JSON.stringify(identity.origin?.[key]) !== JSON.stringify(reference.origin?.[key])) {
          rejections.push(reject('origin-mismatch', name, `bundle origin ${key} differs from the other bundles`));
        }
      }
      if (identity.compiler_sha256 !== reference.compiler_sha256) {
        rejections.push(reject('compiler-mismatch', name, 'bundle compiler differs from the other bundles'));
      }
    }
    const github = {
      workflow: process.env.GITHUB_WORKFLOW,
      run_id: process.env.GITHUB_RUN_ID,
      run_attempt: process.env.GITHUB_RUN_ATTEMPT,
    };
    if (github.workflow !== undefined && manifest.origin?.workflow !== github.workflow
      || github.run_id !== undefined && manifest.origin?.run_id !== github.run_id
      || github.run_attempt !== undefined && manifest.origin?.run_attempt !== github.run_attempt) {
      rejections.push(reject('origin-environment-mismatch', name, 'bundle origin does not name the producing workflow run'));
    }

    const producing = manifest.producing;
    if (!producing || !producing.compiler || typeof producing.origin?.job !== 'string' || producing.origin.job === ''
      || typeof producing.checker_sha256 !== 'string') {
      rejections.push(reject('producing-missing', name, 'bundle does not bind its producing compiler, checker and origin job'));
    } else if (producingJobs.has(producing.origin.job)) {
      rejections.push(reject('producing-job-duplicate', name, `producing origin job already used by ${producingJobs.get(producing.origin.job)}`));
    } else {
      producingJobs.set(producing.origin.job, name);
    }
    if (producing?.checker_sha256 !== undefined && producing.checker_sha256 !== manifest.checker_sha256) {
      rejections.push(reject('producing-checker-mismatch', name, 'producing checker differs from the bundle checker'));
    }
    if (producing?.compiler && reference?.compiler_sha256 !== null && producing.compiler.sha256 !== reference.compiler_sha256) {
      rejections.push(reject('producing-compiler-mismatch', name, 'producing compiler differs from the recorded compiler'));
    }
    if (ownSource !== null && JSON.stringify(manifest.source) !== JSON.stringify(ownSource)) {
      rejections.push(reject('source-checkout-mismatch', name, 'bundle source snapshot differs from the selected checkout'));
    }

    const baseline = manifest.baseline;
    const baselineProcess = baseline?.process;
    if (!baselineProcess || baselineProcess.state !== 'exited' || baselineProcess.exit_code !== 0
      || baselineProcess.signal !== null || baselineProcess.spawn_error !== null
      || typeof baselineProcess.started !== 'number' || typeof baselineProcess.ended !== 'number'
      || baselineProcess.started > baselineProcess.ended) {
      rejections.push(reject('baseline-invalid', name, 'baseline did not exit 0 over a started interval'));
    } else {
      for (const key of ['stdout', 'stderr']) {
        const fault = verifyStream(bundleDir, realBundleDir, baseline[key]);
        if (fault) rejections.push(reject('baseline-stream-mismatch', name, fault));
      }
    }
    const baselineEntry = manifest.entry ?? ENTRY;
    const expectedBaselineArgv = [manifest.compiler?.path ?? null, baselineEntry, '--check-only'];
    if (JSON.stringify(baseline?.argv) !== JSON.stringify(expectedBaselineArgv)) {
      rejections.push(reject('baseline-argv-mismatch', name, 'baseline argv does not name the recorded compiler and entry'));
    }
    const inputs = baseline?.inputs;
    if (!inputs || inputs.compiler_sha256 !== (producing?.compiler?.sha256 ?? null)
      || inputs.checker_sha256 !== (producing?.checker_sha256 ?? null)
      || inputs.archive_sha256 !== (producing?.archive?.sha256 ?? null)
      || inputs.runtime_set_sha256 !== (producing?.runtime_set_sha256 ?? null)) {
      rejections.push(reject('baseline-inputs-mismatch', name, 'baseline inputs do not bind the producing compiler, checker, archive and runtime set'));
    }
    const baselineOk = baselineProcess?.state === 'exited' && baselineProcess?.exit_code === 0;
    const baselineEnded = typeof baselineProcess?.ended === 'number' ? baselineProcess.ended : null;

    const attempts = new Set(typeof baselineProcess?.attempt === 'string' ? [baselineProcess.attempt] : []);
    const previousEnds = [];
    for (const result of manifest.results ?? []) {
      const caseId = result.case?.id ?? null;
      const expected = expectedById.get(caseId);
      if (!expected) {
        rejections.push(reject('unexpected-case', name, 'case is not in the rediscovered work set', caseId));
        continue;
      }
      if (seenCases.has(caseId)) {
        rejections.push(reject('duplicate-case', name, `case already received from bundle ${seenCases.get(caseId)}`, caseId));
        continue;
      }
      seenCases.set(caseId, name);
      if (!sameCase(result.case, expected)) {
        rejections.push(reject('case-mismatch', name, 'case record differs from the discovery record', caseId));
      }
      if (result.case.module !== manifest.module) {
        rejections.push(reject('case-module-mismatch', name, 'case module differs from the bundle module', caseId));
      }
      if (result.setup !== 'applied') {
        rejections.push(reject('unapplied-case', name, `setup is ${JSON.stringify(result.setup)}`, caseId));
        continue;
      }
      const process = result.process ?? {};
      const attempt = process.attempt;
      if (attempt === null || attempt === undefined) {
        rejections.push(reject('missing-attempt', name, 'result carries no attempt id', caseId));
      } else if (attempts.has(attempt)) {
        rejections.push(reject('duplicate-attempt', name, `attempt id reused: ${attempt}`, caseId));
      }
      attempts.add(attempt);
      const processValid = validChildOutcome({
        state: process.state,
        exitCode: process.exit_code,
        signal: process.signal,
        spawnError: process.spawn_error,
      }) && process.state === 'exited'
        && Number.isInteger(process.exit_code) && process.exit_code > 0
        && typeof process.started === 'number' && typeof process.ended === 'number'
        && process.started <= process.ended;
      if (!processValid) {
        rejections.push(reject('unfinished-case', name, 'result did not exit normally with a positive integer code over its interval', caseId));
        continue;
      }
      if (typeof process.wrapper_pid !== 'number' || process.wrapper_pid <= 0) {
        rejections.push(reject('missing-wrapper-pid', name, 'result carries no observed wrapper process id', caseId));
      }
      if (baselineEnded !== null && process.started < baselineEnded) {
        rejections.push(reject('interval-before-baseline', name, 'child started before the baseline ended', caseId));
      }
      for (const [index, previousEnd] of previousEnds.entries()) {
        if (process.started < previousEnd) {
          rejections.push(reject('interval-overlap', name, `child overlaps the child at result index ${index}`, caseId));
        }
      }
      previousEnds.push(process.ended);
      for (const key of ['stdout', 'stderr']) {
        const fault = verifyStream(bundleDir, realBundleDir, result[key]);
        if (fault) rejections.push(reject('stream-mismatch', name, fault, caseId));
      }

      // Exact applied delta, re-derived from the selected tree bytes.
      const delta = result.delta;
      const originalPath = modulePath(treeRoot, expected);
      let originalText = null;
      let changedText = null;
      if (!delta || typeof delta.original_sha256 !== 'string' || typeof delta.changed_sha256 !== 'string'
        || typeof delta.changed_path !== 'string') {
        rejections.push(reject('delta-missing', name, 'result does not retain its applied delta', caseId));
      } else {
        originalText = existsSync(originalPath) ? readFileSync(originalPath, 'utf8') : null;
        if (originalText === null || sha256Hex(Buffer.from(originalText, 'utf8')) !== delta.original_sha256) {
          rejections.push(reject('delta-source-mismatch', name, 'delta original does not match the selected tree bytes', caseId));
        } else {
          const changedFound = bundlePath(bundleDir, realBundleDir, delta.changed_path);
          if (changedFound.fault) {
            rejections.push(reject('delta-mismatch', name, changedFound.fault, caseId));
          } else {
            changedText = readFileSync(changedFound.path, 'utf8');
            if (sha256Hex(Buffer.from(changedText, 'utf8')) !== delta.changed_sha256) {
              rejections.push(reject('delta-mismatch', name, 'retained changed bytes differ from the recorded delta digest', caseId));
              changedText = null;
            }
          }
        }
      }

      // The one shared qualification boundary, with the producer's own label
      // as the supplied claim it must match.
      const stderrFound = result.stderr?.path ? bundlePath(bundleDir, realBundleDir, result.stderr.path) : { fault: 'stderr path missing' };
      const stderrText = stderrFound.path ? readFileSync(stderrFound.path, 'utf8') : '';
      const definition = definitionList.find((mutation) => `mutation:${mutation.name}` === expected.id) ?? null;
      const verdict = classifyCase({
        control: expected,
        expectation: expected.expectation ?? definitionExpectation(definition),
        location: expected.location ?? definitionLocation(definition),
        state: process.state,
        exitCode: process.exit_code,
        signal: process.signal,
        spawnError: process.spawn_error,
        stderrText,
        baselineOk,
        delta: originalText !== null && changedText !== null
          ? { changedText, expectedChangedText: expectedChangedBytes(originalText, expected, definitionList) }
          : null,
        supplied: result.diagnostic?.class
          ? { class: result.diagnostic.class, attributed_law: result.diagnostic.attributed_law ?? null }
          : null,
      });
      if (verdict.class !== 'intended-law-refusal' || verdict.attributedLaw !== expected.law || !verdict.qualified) {
        rejections.push(reject('diagnostic-mismatch', name, `recomputed qualification is ${verdict.class}`, caseId));
      }
    }

    publishedBundles.push({
      ...manifest,
      baseline: {
        ...manifest.baseline,
        stdout: rewriteStream(name, manifest.baseline?.stdout),
        stderr: rewriteStream(name, manifest.baseline?.stderr),
      },
      results: (manifest.results ?? []).map((result) => ({
        ...result,
        delta: result.delta ? { ...result.delta, changed_path: `${name}/${result.delta.changed_path}` } : result.delta,
        stdout: rewriteStream(name, result.stdout),
        stderr: rewriteStream(name, result.stderr),
      })),
    });
  }

  for (const record of expectedRecords) {
    if (!seenCases.has(record.id)) {
      rejections.push(reject('missing-case', null, `no bundle delivered case ${record.id}`));
    }
  }

  const summary = {
    binding: expectedBinding,
    source_sha: reference?.source?.head ?? null,
    source_tree: reference?.source?.tree ?? null,
    source_bend2_tree: reference?.source?.bend2_tree ?? null,
    checker_sha256: ownCheckerSha256,
    compiler_sha256: reference?.compiler_sha256 ?? null,
    origin: reference?.origin ?? null,
    expected_cases: expectedRecords.length,
    received_cases: publishedBundles.reduce((sum, bundle) => sum + (bundle.results?.length ?? 0), 0),
    distinct_cases: seenCases.size,
    groups: publishedBundles.length,
    rejections,
    bundles: publishedBundles,
  };
  return { summary, rejections };
}

export function accepted(summary) {
  return summary.expected_cases > 0 && summary.groups > 0
    && summary.rejections.length === 0 && summary.distinct_cases === summary.expected_cases;
}

function refusal(reason) {
  console.error(`classify: ${reason}`);
  process.exit(2);
}

// One verified stream: an absolute path inside the declared evidence root,
// carrying its own byte length and digest, with the file bytes matching both.
function readVerifiedStream(label, stream, realEvidenceRoot) {
  if (!stream || typeof stream.path !== 'string' || stream.path === '' || typeof stream.bytes !== 'number'
    || typeof stream.sha256 !== 'string') {
    refusal(`${label} stream must carry path, bytes and sha256`);
  }
  if (!isAbsolute(stream.path)) refusal(`${label} stream path must be absolute: ${stream.path}`);
  if (!existsSync(stream.path)) refusal(`${label} stream file is missing: ${stream.path}`);
  if (lstatSync(stream.path).isSymbolicLink()) refusal(`${label} stream file is a symlink: ${stream.path}`);
  const real = realpathSync(stream.path);
  if (real !== realEvidenceRoot && !real.startsWith(realEvidenceRoot + sep)) {
    refusal(`${label} stream path escapes the evidence root: ${stream.path}`);
  }
  const bytes = readFileSync(stream.path);
  if (bytes.byteLength !== stream.bytes) {
    refusal(`${label} stream byte count mismatch: recorded ${stream.bytes} actual ${bytes.byteLength}`);
  }
  if (sha256Hex(bytes) !== stream.sha256) refusal(`${label} stream sha256 mismatch`);
  return bytes.toString('utf8');
}

// `laws-check.mjs --classify`: the single per-case qualification endpoint.
// The request carries the discovered case, the actual terminal outcome,
// digest-bound streams under one declared evidence root, the matched baseline
// over the same snapshot, the exact applied delta and the producing source
// and toolchain identities. Prerequisite verification is mandatory here: a
// verdict is produced only when every bound input verifies against this
// checkout and the rediscovered work set, and `qualified` is true only when
// the shared boundary accepts the whole chain. Well-formed semantic failures
// are verdicts with exit 0; invalid requests refuse with exit 2.
export function classifyCli(argv) {
  if (argv.length > 0 && argv[0] === '--classify') argv = argv.slice(1);
  if (argv.length > 0) refusal(`no positional arguments are accepted, got: ${argv.join(' ')}`);
  let request;
  try {
    request = JSON.parse(readFileSync(0, 'utf8'));
  } catch (error) {
    refusal(`request is not JSON: ${error}`);
  }
  const requestCase = request?.case;
  if (!requestCase || typeof requestCase !== 'object') refusal('request case is missing');
  const outcome = request?.outcome;
  if (!outcome || typeof outcome !== 'object') refusal('request outcome is missing');
  if (!validChildOutcome({ state: outcome.state, exitCode: outcome.exit_code, signal: outcome.signal, spawnError: outcome.spawn_error })) {
    refusal('request outcome is malformed for a terminal child');
  }
  if (requestCase.kind !== 'proof-removal' && requestCase.kind !== 'mutation') {
    refusal(`request case kind is not a control kind: ${JSON.stringify(requestCase.kind)}`);
  }
  const evidenceRoot = request?.evidence_root;
  if (typeof evidenceRoot !== 'string' || evidenceRoot === '' || !isAbsolute(evidenceRoot) || !existsSync(evidenceRoot)) {
    refusal('request evidence_root must be an existing absolute directory');
  }
  const realEvidenceRoot = realpathSync(evidenceRoot);
  if (typeof request?.source?.head !== 'string' || typeof request.source.tree !== 'string'
    || typeof request.source.bend2_tree !== 'string') {
    refusal('request source binding is missing');
  }
  const ownSource = ownSourceSnapshot();
  if (ownSource === null) refusal('this checkout has no git metadata to bind');
  if (JSON.stringify(request.source) !== JSON.stringify(ownSource)) {
    refusal('request source binding differs from this checkout');
  }
  // A dirty checkout cannot bind its inputs: uncommitted bytes change the
  // modules and helper hashes the verdict reports without any identity
  // change. The endpoint therefore qualifies only clean checkouts.
  const status = execFileSync('git', ['status', '--porcelain=v1'], { cwd: ROOT, encoding: 'utf8', maxBuffer: Infinity });
  if (status.trim() !== '') refusal('this checkout has uncommitted inputs; source binding requires a clean tree');
  const toolchain = request?.toolchain;
  if (!toolchain || typeof toolchain.compiler_path !== 'string' || toolchain.compiler_path === ''
    || typeof toolchain.compiler_sha256 !== 'string' || toolchain.compiler_sha256 === '') {
    refusal('request toolchain binding is missing its compiler path and sha256');
  }
  const baselineArgv = request?.baseline?.argv;
  if (!Array.isArray(baselineArgv) || baselineArgv.length !== 3
    || baselineArgv[0] !== toolchain.compiler_path || baselineArgv[2] !== '--check-only'
    || typeof baselineArgv[1] !== 'string' || baselineArgv[1] === '') {
    refusal('request baseline argv must name the bound compiler, an entry and --check-only');
  }

  // The case identity must equal this checkout's own discovery record
  // completely, metadata included.
  const discovered = discoveryRecords().find((record) => record.id === requestCase.id);
  if (!discovered) refusal(`case ${requestCase.id} is not in the rediscovered work set`);
  if (!sameCase(requestCase, discovered)) refusal(`case ${requestCase.id} does not match its discovery record`);

  const streams = request?.streams;
  if (!streams || typeof streams !== 'object') refusal('request streams are missing');
  const stdoutText = readVerifiedStream('stdout', streams.stdout, realEvidenceRoot);
  const stderrText = readVerifiedStream('stderr', streams.stderr, realEvidenceRoot);
  const baseline = request?.baseline;
  if (!baseline || typeof baseline.outcome !== 'object' || !baseline.streams
    || typeof baseline.streams !== 'object') {
    refusal('request baseline is missing its outcome and streams');
  }
  const baselineOutcome = baseline.outcome;
  if (!validChildOutcome({ state: baselineOutcome.state, exitCode: baselineOutcome.exit_code, signal: baselineOutcome.signal, spawnError: baselineOutcome.spawn_error })) {
    refusal('request baseline outcome is malformed for a terminal child');
  }
  readVerifiedStream('baseline stdout', baseline.streams.stdout, realEvidenceRoot);
  readVerifiedStream('baseline stderr', baseline.streams.stderr, realEvidenceRoot);
  const baselineOk = baselineOutcome.state === 'exited' && baselineOutcome.exit_code === 0
    && baselineOutcome.signal === null && baselineOutcome.spawn_error === null;

  // The exact applied delta is mandatory: the original comes from this
  // checkout's own module bytes, and the changed bytes must re-derive from
  // them under the authoritative definition.
  const delta = request?.delta;
  if (!delta || typeof delta.changed_path !== 'string' || typeof delta.original_sha256 !== 'string'
    || typeof delta.changed_sha256 !== 'string') {
    refusal('request delta is required and must carry changed_path and both digests');
  }
  const originalPath = modulePath(join(ROOT, 'bend2'), discovered);
  if (!existsSync(originalPath)) refusal('the selected checkout has no bytes for the requested case module');
  const originalBytes = readFileSync(originalPath);
  if (sha256Hex(originalBytes) !== delta.original_sha256) {
    refusal('delta original_sha256 differs from this checkout module bytes');
  }
  // delta.changed_path is evidence-root-relative and confined like streams.
  const changedFound = bundlePath(evidenceRoot, realEvidenceRoot, delta.changed_path);
  if (changedFound.fault) refusal(`delta changed bytes: ${changedFound.fault}`);
  const changedBytes = readFileSync(changedFound.path);
  if (sha256Hex(changedBytes) !== delta.changed_sha256) {
    refusal('delta changed_sha256 differs from the retained changed bytes');
  }
  const originalText = originalBytes.toString('utf8');
  if (!Buffer.from(originalText, 'utf8').equals(originalBytes)) {
    refusal('the checkout module bytes are not lossless UTF-8 for text comparison');
  }
  const changedText = changedBytes.toString('utf8');
  if (!Buffer.from(changedText, 'utf8').equals(changedBytes)) {
    refusal('the retained changed bytes are not lossless UTF-8 for text comparison');
  }

  const definition = MUTATIONS.find((mutation) => `mutation:${mutation.name}` === discovered.id) ?? null;
  // The clean-tree observation must hold across the whole classification:
  // original reads, stream hashing and verifier digesting happen under it.
  const statusAfter = execFileSync('git', ['status', '--porcelain=v1'], { cwd: ROOT, encoding: 'utf8', maxBuffer: Infinity });
  if (statusAfter !== status) refusal('this checkout changed during classification');
  const verdict = classifyCase({
    control: discovered,
    expectation: discovered.expectation ?? definitionExpectation(definition),
    location: discovered.location ?? definitionLocation(definition),
    state: outcome.state,
    exitCode: outcome.exit_code,
    signal: outcome.signal,
    spawnError: outcome.spawn_error,
    stderrText,
    baselineOk,
    delta: { changedText, expectedChangedText: expectedChangedBytes(originalText, discovered, MUTATIONS) },
    supplied: request.supplied ?? null,
  });
  const { diagnostics, accounting, profile } = splitTimeAccounting(stderrText);
  const match = verdict.class === 'intended-law-refusal' && verdict.attributedLaw === discovered.law && verdict.qualified;
  const verdictLine = {
    schema: 'capacity-controls/classify-verdict@1',
    id: discovered.id,
    class: verdict.class,
    attributed_law: verdict.attributedLaw,
    law: discovered.law,
    match,
    qualified: verdict.qualified === true,
    reason: verdict.reason ?? null,
    diagnostic_sha256: sha256Hex(Buffer.from(diagnostics, 'utf8')),
    accounting: {
      profile,
      valid: accounting === null ? true : accountingValid(accounting, profile),
      present: accounting !== null,
    },
    baseline: { state: baselineOutcome.state, exit_code: baselineOutcome.exit_code, ok: baselineOk, argv_bound: true },
    expectation: discovered.expectation ?? null,
    location: discovered.location ?? null,
    supplied: request.supplied ?? null,
    toolchain: { compiler_sha256: toolchain.compiler_sha256 },
    source: request.source,
    definition_sha256: discovered.definition_sha256,
    evidence_verified: true,
    verifier: {
      checker_sha256: sha256Hex(readFileSync(join(ROOT, 'bend2', 'scripts', 'laws-check.mjs'))),
      aggregate_module_sha256: sha256Hex(readFileSync(join(ROOT, 'bend2', 'scripts', 'capacity-controls', 'aggregate.mjs'))),
      classifier_module_sha256: sha256Hex(readFileSync(join(ROOT, 'bend2', 'scripts', 'capacity-controls', 'classify.mjs'))),
      work_set_module_sha256: sha256Hex(readFileSync(join(ROOT, 'bend2', 'scripts', 'capacity-controls', 'work-set.mjs'))),
      laws_common_module_sha256: sha256Hex(readFileSync(join(ROOT, 'bend2', 'scripts', 'laws-common.mjs'))),
      definitions_module_sha256: sha256Hex(readFileSync(join(ROOT, 'bend2', 'scripts', 'laws-mutations.mjs'))),
    },
  };
  console.log(JSON.stringify(verdictLine));
  process.exit(0);
}

export async function aggregateCli(argv) {
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      console.error(`aggregate: unknown option ${argv[i]}`);
      process.exit(2);
    }
    positional.push(argv[i]);
  }
  if (positional.length !== 1) {
    console.error('aggregate: exactly one directory is required');
    process.exit(2);
  }
  const { summary } = aggregate({ dir: positional[0] });
  const summaryPath = join(positional[0], 'controls-summary.json');
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({
    summary: summaryPath,
    accepted: accepted(summary),
    expected_cases: summary.expected_cases,
    distinct_cases: summary.distinct_cases,
    rejections: summary.rejections.length,
  }));
  process.exit(accepted(summary) ? 0 : 1);
}
