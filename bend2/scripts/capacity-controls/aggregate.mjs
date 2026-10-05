// Validation and merge of received group evidence. The aggregate recomputes
// every check from retained bytes, the rediscovered work set and the selected
// checkout: classification comes from the shared classifier over complete raw
// diagnostics and the actual recorded outcome; each case's applied delta is
// re-derived from the checkout bytes; producer inputs and baseline inputs are
// bound per bundle. Producer labels and counts are never accepted as evidence.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { classifyControl } from './classify.mjs';
import { bindingOf, discoveryRecords, sha256Hex } from './work-set.mjs';
import { ENTRY, MUTATIONS, proofBlockRange, ROOT } from '../laws-check.mjs';

export class UsageError extends Error {}

function reject(kind, bundle, detail, caseId) {
  return caseId === undefined ? { kind, bundle, detail } : { kind, bundle, case: caseId, detail };
}

// Stream paths must stay inside the bundle directory.
function bundlePath(bundleDir, stream) {
  if (!stream || typeof stream.path !== 'string') return { fault: 'stream path missing' };
  if (stream.path === '' || isAbsolute(stream.path) || stream.path.split(/[\\/]/).includes('..')) {
    return { fault: `stream path escapes the bundle: ${stream.path}` };
  }
  const path = resolve(bundleDir, stream.path);
  if (!path.startsWith(resolve(bundleDir) + sep)) return { fault: `stream path escapes the bundle: ${stream.path}` };
  if (!existsSync(path)) return { fault: `stream file missing: ${stream.path}` };
  return { path };
}

function verifyStream(bundleDir, stream) {
  const found = bundlePath(bundleDir, stream);
  if (found.fault) return found.fault;
  const bytes = readFileSync(found.path);
  if (bytes.byteLength !== stream.bytes) {
    return `stream byte count changed: ${stream.path} recorded ${stream.bytes} actual ${bytes.byteLength}`;
  }
  if (createHash('sha256').update(bytes).digest('hex') !== stream.sha256) {
    return `stream sha256 changed: ${stream.path}`;
  }
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

// Re-derive one case's changed module bytes from the checkout bytes and the
// authoritative definition, exactly as the runner must have applied it.
function expectedChangedBytes(originalText, record) {
  if (record.kind === 'proof-removal') {
    const block = proofBlockRange(originalText, record.law);
    if (!block) return null;
    const lines = originalText.split('\n');
    lines.splice(block.start, block.end - block.start);
    return lines.join('\n');
  }
  const definition = MUTATIONS.find((mutation) => `mutation:${mutation.name}` === record.id);
  if (!definition) return null;
  if (!originalText.includes(definition.find)) return null;
  return originalText.replace(definition.find, definition.replace);
}

export function aggregate({ dir, records, expectations }) {
  const expectedRecords = records ?? discoveryRecords();
  const expectedBinding = bindingOf(expectedRecords);
  const expectedById = new Map(expectedRecords.map((record) => [record.id, record]));
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
      const originKeys = ['workflow', 'run_id', 'run_attempt', 'image_os', 'image_version'];
      for (const key of originKeys) {
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

    // Producing inputs: the bundle must name its compiler, archive, runtime
    // and a unique producing origin job, and they must agree with the
    // aggregate's own checkout where the checkout can bind them.
    const producing = manifest.producing;
    if (!producing || !producing.compiler || !producing.origin || typeof producing.origin.job !== 'string'
      || producing.origin.job === '') {
      rejections.push(reject('producing-missing', name, 'bundle does not bind its producing compiler and origin job'));
    } else if (producingJobs.has(producing.origin.job)) {
      rejections.push(reject('producing-job-duplicate', name, `producing origin job already used by ${producingJobs.get(producing.origin.job)}`));
    } else {
      producingJobs.set(producing.origin.job, name);
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
        const fault = verifyStream(bundleDir, baseline[key]);
        if (fault) rejections.push(reject('baseline-stream-mismatch', name, fault));
      }
    }
    // The baseline command must be exactly the recorded compiler checking the
    // real entry, and its inputs must name the producing compiler, archive and
    // runtime identities.
    const expectedBaselineArgv = [manifest.compiler?.path ?? null, ENTRY, '--check-only'];
    if (JSON.stringify(baseline?.argv) !== JSON.stringify(expectedBaselineArgv)) {
      rejections.push(reject('baseline-argv-mismatch', name, 'baseline argv does not name the recorded compiler and entry'));
    }
    const inputs = baseline?.inputs;
    if (!inputs || inputs.compiler_sha256 !== (producing?.compiler?.sha256 ?? null)
      || inputs.archive_sha256 !== (producing?.archive?.sha256 ?? null)
      || inputs.runtime_sha256 !== (producing?.runtime?.sha256 ?? null)) {
      rejections.push(reject('baseline-inputs-mismatch', name, 'baseline inputs do not bind the producing compiler, archive and runtime'));
    }
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
      if (typeof process.pid !== 'number' || process.pid <= 0) {
        rejections.push(reject('missing-pid', name, 'result carries no observed child process id', caseId));
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
        const fault = verifyStream(bundleDir, result[key]);
        if (fault) rejections.push(reject('stream-mismatch', name, fault, caseId));
      }

      // Exact applied delta, re-derived from the checkout bytes.
      const delta = result.delta;
      const modulePath = join(ROOT, expected.module);
      if (!delta || typeof delta.original_sha256 !== 'string' || typeof delta.changed_sha256 !== 'string'
        || typeof delta.changed_path !== 'string') {
        rejections.push(reject('delta-missing', name, 'result does not retain its applied delta', caseId));
      } else {
        const checkoutBytes = existsSync(modulePath) ? readFileSync(modulePath, 'utf8') : null;
        if (checkoutBytes === null || sha256Hex(Buffer.from(checkoutBytes, 'utf8')) !== delta.original_sha256) {
          rejections.push(reject('delta-source-mismatch', name, 'delta original does not match the selected checkout bytes', caseId));
        } else {
          const changedFound = bundlePath(bundleDir, { path: delta.changed_path });
          if (changedFound.fault) {
            rejections.push(reject('delta-mismatch', name, changedFound.fault, caseId));
          } else {
            const changedBytes = readFileSync(changedFound.path, 'utf8');
            if (sha256Hex(Buffer.from(changedBytes, 'utf8')) !== delta.changed_sha256) {
              rejections.push(reject('delta-mismatch', name, 'retained changed bytes differ from the recorded delta digest', caseId));
            } else if (expectedChangedBytes(checkoutBytes, expected) !== changedBytes) {
              rejections.push(reject('delta-shape-mismatch', name, 'retained delta is not the exact intended application', caseId));
            }
          }
        }
      }

      // Classification recomputed from the complete raw diagnostics.
      const stderrPath = result.stderr?.path;
      const stderrFound = stderrPath ? bundlePath(bundleDir, { path: stderrPath }) : { fault: 'stderr path missing' };
      const stderrText = stderrFound.path ? readFileSync(stderrFound.path, 'utf8') : '';
      const verdict = classifyControl({
        state: process.state,
        exitCode: process.exit_code,
        signal: process.signal,
        spawnError: process.spawn_error,
        stderrText,
        control: expected,
        expectation: expectations?.[caseId] ?? result.expectation ?? undefined,
      });
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

function rewriteStream(bundleName, stream) {
  if (!stream || typeof stream.path !== 'string') return stream;
  return { ...stream, path: `${bundleName}/${stream.path}` };
}

export function accepted(summary) {
  return summary.expected_cases > 0 && summary.groups > 0
    && summary.rejections.length === 0 && summary.distinct_cases === summary.expected_cases;
}

// `laws-check.mjs --classify <dir>`: recompute one bundle's classifications
// from its complete raw streams and recorded outcomes through the shared
// classifier. This is the classification half of the aggregate, exposed for
// the package consumer; it accepts no producer labels.
export function classifyBundle({ dir, expectations }) {
  const manifestPath = join(dir, 'group-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const rows = [];
  let allIntended = manifest.results.length > 0;
  for (const result of manifest.results) {
    const caseId = result.case?.id ?? null;
    const expected = discoveryRecords().find((record) => record.id === caseId) ?? result.case;
    const stderrFound = result.stderr?.path ? bundlePath(dir, { path: result.stderr.path }) : { fault: 'stderr path missing' };
    const stderrText = stderrFound.path ? readFileSync(stderrFound.path, 'utf8') : '';
    const process = result.process ?? {};
    const verdict = classifyControl({
      state: process.state,
      exitCode: process.exit_code,
      signal: process.signal,
      spawnError: process.spawn_error,
      stderrText,
      control: expected,
      expectation: expectations?.[caseId] ?? result.expectation ?? undefined,
    });
    const intended = verdict.class === 'intended-law-refusal' && verdict.attributedLaw === expected.law;
    allIntended = allIntended && intended;
    rows.push({
      id: caseId,
      class: verdict.class,
      attributed_law: verdict.attributedLaw,
      law: expected.law,
      match: intended,
      supplied: { class: result.diagnostic?.class ?? null, attributed_law: result.diagnostic?.attributed_law ?? null },
    });
  }
  return { module: manifest.module, rows, allIntended };
}

export function classifyCli(argv) {
  const positional = [];
  let expectationsPath = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--expectations') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        console.error('classify: option --expectations needs a value');
        process.exit(2);
      }
      expectationsPath = value;
      i++;
      continue;
    }
    if (argv[i].startsWith('--')) {
      console.error(`classify: unknown option ${argv[i]}`);
      process.exit(2);
    }
    positional.push(argv[i]);
  }
  if (positional.length !== 1) {
    console.error('classify: exactly one bundle directory is required');
    process.exit(2);
  }
  let expectations;
  if (expectationsPath !== null) {
    try {
      expectations = JSON.parse(readFileSync(expectationsPath, 'utf8'));
    } catch (error) {
      console.error(`classify: expectations file is unreadable: ${error}`);
      process.exit(2);
    }
  }
  const result = classifyBundle({ dir: positional[0], expectations });
  for (const row of result.rows) console.log(JSON.stringify(row));
  process.exit(result.allIntended ? 0 : 1);
}

export async function aggregateCli(argv) {
  const positional = [];
  let expectationsPath = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--expectations') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        console.error('aggregate: option --expectations needs a value');
        process.exit(2);
      }
      expectationsPath = value;
      i++;
      continue;
    }
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
  let expectations;
  if (expectationsPath !== null) {
    try {
      expectations = JSON.parse(readFileSync(expectationsPath, 'utf8'));
    } catch (error) {
      console.error(`aggregate: expectations file is unreadable: ${error}`);
      process.exit(2);
    }
  }
  const { summary } = aggregate({ dir: positional[0], expectations });
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
