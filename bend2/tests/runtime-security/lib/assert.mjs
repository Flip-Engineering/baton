// Assertion and result recording for the portable fixture set.
//
// Every fixture builds one result object, writes it to BATON_EVIDENCE_DIR, and
// exits 0 only when every assertion passed. A refused environment or a source
// digest mismatch yields a non-zero exit and a recorded reason.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function createReport(fixture, environment, mode) {
  const checks = [];
  const notes = [];
  const report = {
    fixture,
    expect: mode,
    platform: environment.platform,
    producerRoot: environment.producerRoot,
    runtimeDir: environment.runtimeDir,
    producerHashes: environment.hashes,
    expectedHashesFile: environment.expectedPath,
    producerHashMismatches: environment.mismatches,
    producerHashMissing: environment.missing,
    checks,
    notes,
    ok: false,
  };
  return {
    report,
    check(name, ok, detail = null) {
      checks.push({ name, ok: ok === true, detail });
      return ok === true;
    },
    note(text) {
      notes.push(text);
    },
    finalize(extra = {}) {
      Object.assign(report, extra);
      const failed = checks.filter((entry) => !entry.ok);
      report.ok = failed.length === 0;
      report.failedChecks = failed.map((entry) => entry.name);
      return report;
    },
  };
}

export function writeReport(environment, name, report) {
  mkdirSync(environment.evidenceDir, { recursive: true });
  const path = join(environment.evidenceDir, name);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

export function finish(environment, name, report, exitCodeOverride = null) {
  const path = writeReport(environment, name, report);
  const failed = report.failedChecks ?? [];
  const line = report.ok
    ? `PASS ${report.fixture} (${report.expect}) checks=${report.checks.length}`
    : `FAIL ${report.fixture} (${report.expect}) failed=${failed.join(',')}`;
  process.stdout.write(`${line}\n${JSON.stringify(report, null, 2)}\n`);
  if (exitCodeOverride !== null) process.exit(exitCodeOverride);
  process.exit(report.ok ? 0 : 1);
}

// A fixture whose environment refuses before any observation still records why.
export function failEnvironment(condition, detail) {
  process.stdout.write(`FAIL environment ${condition}${detail === null ? '' : `: ${detail}`}\n`);
  process.exit(3);
}
