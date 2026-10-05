// Validation and merge of received group evidence, plus the agreed per-case
// classification endpoint. The aggregate recomputes every check from retained
// bytes, the rediscovered work set and the selected checkout: classification
// comes from the shared classifier over complete raw diagnostics and the
// actual recorded outcome; each case's applied delta is re-derived from the
// checkout bytes; producer inputs and baseline inputs are bound per bundle.
// Producer labels and counts are never accepted as evidence. Retained paths
// are confined to their bundle by filesystem identity, not lexically.

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { classifyControl } from './classify.mjs';
import { bindingOf, definitionExpectation, discoveryRecords, sha256Hex } from './work-set.mjs';
import { ENTRY, proofBlockRange, ROOT } from '../laws-check.mjs';
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
  if (createDigest(bytes) !== stream.sha256) return `stream sha256 changed: ${stream.path}`;
  return null;
}

function createDigest(data) {
  return sha256Hex(data);
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
      const processValid = process.state === 'exited' && typeof process.exit_code === 'number' && process.exit_code > 0
        && process.signal === null && process.spawn_error === null
        && typeof process.started === 'number' && typeof process.ended === 'number'
        && process.started <= process.ended;
      if (!processValid) {
        rejections.push(reject('unfinished-case', name, 'result did not exit normally with a nonzero code over its interval', caseId));
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
      if (!delta || typeof delta.original_sha256 !== 'string' || typeof delta.changed_sha256 !== 'string'
        || typeof delta.changed_path !== 'string') {
        rejections.push(reject('delta-missing', name, 'result does not retain its applied delta', caseId));
      } else {
        const originalText = existsSync(originalPath) ? readFileSync(originalPath, 'utf8') : null;
        if (originalText === null || sha256Hex(Buffer.from(originalText, 'utf8')) !== delta.original_sha256) {
          rejections.push(reject('delta-source-mismatch', name, 'delta original does not match the selected tree bytes', caseId));
        } else {
          const changedFound = bundlePath(bundleDir, realBundleDir, delta.changed_path);
          if (changedFound.fault) {
            rejections.push(reject('delta-mismatch', name, changedFound.fault, caseId));
          } else {
            const changedText = readFileSync(changedFound.path, 'utf8');
            if (sha256Hex(Buffer.from(changedText, 'utf8')) !== delta.changed_sha256) {
              rejections.push(reject('delta-mismatch', name, 'retained changed bytes differ from the recorded delta digest', caseId));
            } else if (expectedChangedBytes(originalText, expected, definitionList) !== changedText) {
              rejections.push(reject('delta-shape-mismatch', name, 'retained delta is not the exact intended application', caseId));
            }
          }
        }
      }

      // Classification recomputed from the complete raw diagnostics, with the
      // definition-bound expectation and the matched baseline requirement.
      const stderrFound = result.stderr?.path ? bundlePath(bundleDir, realBundleDir, result.stderr.path) : { fault: 'stderr path missing' };
      const stderrText = stderrFound.path ? readFileSync(stderrFound.path, 'utf8') : '';
      let verdict = classifyControl({
        state: process.state,
        exitCode: process.exit_code,
        signal: process.signal,
        spawnError: process.spawn_error,
        stderrText,
        control: expected,
        expectation: definitionExpectation(definitionList.find((mutation) => `mutation:${mutation.name}` === expected.id))
          ?? expected.expectation,
      });
      if (verdict.class === 'intended-law-refusal' && expected.kind === 'proof-removal' && !baselineOk) {
        verdict = { class: 'unclassified-rejection', attributedLaw: null };
      }
      if (verdict.class !== 'intended-law-refusal' || verdict.attributedLaw !== expected.law) {
        rejections.push(reject('diagnostic-mismatch', name, `recomputed classification is ${verdict.class}`, caseId));
      }
      if (result.diagnostic?.class !== verdict.class || result.diagnostic?.attributed_law !== verdict.attributedLaw) {
        rejections.push(reject('misreported-diagnostic', name, 'supplied diagnostic metadata disagrees with the recomputed classification', caseId));
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

// `laws-check.mjs --classify`: the single per-case classification endpoint.
// The request arrives as one JSON object on stdin and carries the discovery
// case, the actual process outcome, absolute stream paths and the matched
// baseline context. The answer is one structured verdict object on stdout and
// exit 0; a refused request prints one reason line on stderr and exits 2.
// Unknown or disagreeing case identities are refusals, never verdicts.
export function classifyCli(argv) {
  if (argv.length > 0) refusal(`no positional arguments are accepted, got: ${argv.join(' ')}`);
  let request;
  let input;
  try {
    input = readFileSync(0, 'utf8');
  } catch (error) {
    refusal(`stdin is unreadable: ${error}`);
  }
  try {
    request = JSON.parse(input);
  } catch (error) {
    refusal(`request is not JSON: ${error}`);
  }
  const requestCase = request?.case;
  if (!requestCase || typeof requestCase.id !== 'string' || typeof requestCase.kind !== 'string'
    || typeof requestCase.law !== 'string' || typeof requestCase.module !== 'string'
    || typeof requestCase.definition_sha256 !== 'string') {
    refusal('request case is missing required identity fields');
  }
  const outcome = request?.outcome;
  if (!outcome || typeof outcome.state !== 'string') refusal('request outcome is missing its state');
  for (const key of ['stdout', 'stderr']) {
    if (typeof request?.[key] !== 'string' || request[key] === '') refusal(`request ${key} stream path is missing`);
  }
  const discovered = discoveryRecords().find((record) => record.id === requestCase.id);
  if (!discovered) refusal(`case ${requestCase.id} is not in the rediscovered work set`);
  if (discovered.definition_sha256 !== requestCase.definition_sha256
    || discovered.law !== requestCase.law || discovered.kind !== requestCase.kind
    || discovered.module !== requestCase.module) {
    refusal(`case ${requestCase.id} does not match its discovery record`);
  }
  const readStream = (label, path) => {
    if (typeof path !== 'string' || path === '' || !existsSync(path)) refusal(`${label} stream is unreadable: ${path}`);
    return readFileSync(path, 'utf8');
  };
  const stderrText = readStream('stderr', request.stderr);
  readStream('stdout', request.stdout);
  const baseline = request?.baseline;
  const baselineOutcome = baseline?.outcome;
  if (!baselineOutcome || typeof baselineOutcome.state !== 'string') refusal('request baseline outcome is missing its state');
  readStream('baseline stdout', baseline.stdout);
  readStream('baseline stderr', baseline.stderr);
  const baselineOk = baselineOutcome.state === 'exited' && baselineOutcome.exit_code === 0
    && baselineOutcome.signal === null && baselineOutcome.spawn_error === null;

  let verdict = classifyControl({
    state: outcome.state,
    exitCode: outcome.exit_code,
    signal: outcome.signal,
    spawnError: outcome.spawn_error,
    stderrText,
    control: discovered,
    expectation: discovered.expectation,
  });
  if (verdict.class === 'intended-law-refusal' && discovered.kind === 'proof-removal' && !baselineOk) {
    verdict = { class: 'unclassified-rejection', attributedLaw: null };
  }
  let deltaChecked = false;
  const delta = request.delta;
  if (delta !== undefined) {
    deltaChecked = true;
    if (typeof delta.original_path !== 'string' || typeof delta.changed_path !== 'string'
      || typeof delta.original_sha256 !== 'string' || typeof delta.changed_sha256 !== 'string') {
      refusal('request delta is missing its paths or digests');
    }
    const originalText = existsSync(delta.original_path) ? readFileSync(delta.original_path, 'utf8') : null;
    const changedText = existsSync(delta.changed_path) ? readFileSync(delta.changed_path, 'utf8') : null;
    if (originalText === null || sha256Hex(Buffer.from(originalText, 'utf8')) !== delta.original_sha256
      || changedText === null || sha256Hex(Buffer.from(changedText, 'utf8')) !== delta.changed_sha256
      || expectedChangedBytes(originalText, discovered, MUTATIONS) !== changedText) {
      verdict = { class: 'delta-mismatch', attributedLaw: null };
    }
  }
  const diagnostics = splitDiagnostics(stderrText);
  const verdictLine = {
    schema: 'capacity-controls/classify-verdict@1',
    id: discovered.id,
    class: verdict.class,
    attributed_law: verdict.attributedLaw,
    law: discovered.law,
    match: verdict.class === 'intended-law-refusal' && verdict.attributedLaw === discovered.law,
    reason: verdict.reason ?? null,
    diagnostic_sha256: sha256Hex(Buffer.from(diagnostics, 'utf8')),
    accounting: accountingOf(stderrText),
    baseline: { state: baselineOutcome.state, exit_code: baselineOutcome.exit_code, ok: baselineOk },
    expectation: discovered.expectation ?? null,
    supplied: request.supplied ?? null,
    supplied_agrees: request.supplied
      ? request.supplied.class === verdict.class && request.supplied.attributed_law === verdict.attributedLaw
      : null,
    delta_checked: deltaChecked,
  };
  console.log(JSON.stringify(verdictLine));
  process.exit(0);
}

// Split helpers reused for the verdict's evidence fields; the classifier owns
// the same boundary.
function splitDiagnostics(stderrText) {
  const match = /^\s*(?:[0-9.]+ real\s+[0-9.]+ user\s+[0-9.]+ sys\s*$|Command being exectured:|User time \(seconds\):)/m.exec(stderrText);
  return match ? stderrText.slice(0, match.index) : stderrText;
}

function accountingOf(stderrText) {
  const diagnostics = splitDiagnostics(stderrText);
  if (diagnostics === stderrText) return { profile: null, valid: true, present: false };
  const suffix = stderrText.slice(diagnostics.length);
  if (/Maximum resident set size \(kbytes\):/.test(suffix) || /User time \(seconds\):/.test(suffix)) {
    return { profile: 'gnu-time-v', valid: true, present: true };
  }
  if (/maximum resident set size/.test(suffix)) return { profile: 'darwin-usr-bin-time', valid: true, present: true };
  return { profile: 'unknown', valid: false, present: true };
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
