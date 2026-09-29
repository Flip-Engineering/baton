#!/bin/sh
# Adapt one JS suite verdict to land-checked's four hex-encoded fields.
# stdout contains identities only; diagnostics and runner output go to stderr.
# A run without a verdict is unjudged and blocks the landing.
set -eu
if [ "$#" -ne 1 ]; then
  echo 'usage: check-node-test.sh impl/test/SELECTED.test.mjs' >&2
  exit 2
fi
exec node --input-type=module - "$1" <<'JS'
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const selected = process.argv[2];
const root = process.cwd();
const absolute = resolve(root, selected);
const file = relative(root, absolute).split(sep).join('/');
const unjudged = (reason) => {
  console.error(`check-node-test: ${reason}`);
  // Non-identity output makes the existing gate name this cause as unjudged.
  console.log(`unjudged: ${reason}`);
  process.exitCode = 2;
};
// The runner's #606 incident was an empty selection that started the whole suite.
if (!file.startsWith('impl/test/') || !existsSync(absolute)) {
  unjudged(`selected test file is unavailable: ${selected}`);
} else {
  const parent = resolve(root, '.scratch/bend2');
  mkdirSync(parent, { recursive: true });
  const scratch = mkdtempSync(resolve(parent, 'node-check-'));
  const verdict = resolve(scratch, 'verdict.json');
  try {
    const result = spawnSync(process.execPath, ['impl/scripts/run-suite.mjs', absolute], {
      cwd: root,
      env: { ...process.env, BATON_SUITE_VERDICT_FILE: verdict },
      stdio: ['ignore', 2, 2],
    });
    if (result.error || result.signal) throw new Error(result.error?.message || `runner ended on ${result.signal}`);
    const document = JSON.parse(readFileSync(verdict, 'utf8'));
    if (!Array.isArray(document.failures) || !Array.isArray(document.reportedFiles)) {
      throw new Error('the runner verdict lacks typed failures or reportedFiles; use the current repository runner');
    }
    const runnerFile = file.slice('impl/'.length);
    const matches = (path) => path === file || path === runnerFile || path === absolute;
    if (!document.reportedFiles.some(matches) || (document.skipped || []).some(row => matches(row.file))) {
      throw new Error(`the runner did not judge ${file}`);
    }
    const { failureKind, FILE_LEVEL_FAILURE_TYPES } = await import(
      pathToFileURL(resolve(root, 'impl/src/suite-comparison.mjs')));
    const lines = document.failures.map(row => {
      if (!matches(row.file) || typeof row.name !== 'string' || typeof row.failureType !== 'string') {
        throw new Error('a failure row lacks the selected file, test name or failure type');
      }
      const name = FILE_LEVEL_FAILURE_TYPES.includes(row.failureType) ? '-' : row.name;
      return [file, name || '-', failureKind(row.failureType), row.failureType || '-']
        .map(value => Buffer.from(value, 'utf8').toString('hex')).join(' ');
    });
    if (!lines.length && (result.status !== 0 || document.green !== true)) {
      throw new Error('the runner ended without a passing verdict or failure identities');
    }
    for (const line of lines) console.log(line);
    process.exitCode = lines.length ? 1 : 0;
  } catch (error) {
    unjudged(error.message);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
JS
