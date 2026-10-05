// Assertion and result recording for the portable fixture set.
//
// Source admission runs centrally in lib/env.mjs before a fixture imports any
// producer module or spawns any child, so a report is only ever created for an
// admitted closure. Every report records the admitted manifest path, the
// observed closure digest and the historical pin, if any.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function createReport(fixture, environment) {
  const checks = [];
  const notes = [];
  const report = {
    fixture,
    mode: environment.historicalPin === null ? 'candidate' : `historical:${environment.historicalPin}`,
    platform: environment.platform,
    producerRoot: environment.producerRoot,
    runtimeDir: environment.runtimeDir,
    producerHashesObserved: environment.hashes,
    expectedManifest: environment.expectedPath,
    expectedEntries: environment.expectedEntries,
    closureSha256Observed: environment.closureSha256,
    historicalPin: environment.historicalPin,
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
    fail(name, detail = null) {
      checks.push({ name, ok: false, detail });
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

// Real exit statuses: 0 pass, 1 assertion failure, 3 refused environment.
export function finish(environment, name, report) {
  writeReport(environment, name, report);
  const failed = report.failedChecks ?? [];
  const line = report.ok
    ? `PASS ${report.fixture} (${report.mode}) checks=${report.checks.length}`
    : `FAIL ${report.fixture} (${report.mode}) failed=${failed.join(',')}`;
  process.stdout.write(`${line}\n${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.ok ? 0 : 1);
}

// A refused environment records the refusal and exits 3 for any fixture.
export function refuseEnvironment(error) {
  const condition = error?.condition ?? 'environmentRefusal';
  const detail = error?.detail ?? String(error);
  process.stdout.write(`FAIL environment ${condition}${detail === null ? '' : `: ${detail}`}\n`);
  process.exit(3);
}
