// Assertion and result recording. Admission runs centrally in lib/env.mjs
// before a report exists, so every report describes an admitted closure.
// Executable identity and the verified closure are recorded with each result.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function createReport(fixture, environment) {
  const checks = [];
  const notes = [];
  const report = {
    fixture,
    mode: environment.pin === null ? 'candidate' : `historical:${environment.pinName}`,
    platform: environment.platform,
    floorNode: environment.floorNode,
    floorNodeSha256: environment.floorNodeSha256,
    producerRoot: environment.producerRoot,
    runtimeDir: environment.runtimeDir,
    entries: environment.entries,
    closureFiles: environment.closureFiles,
    observedHashes: environment.observedHashes,
    expectedManifest: environment.expectedPath,
    uncoveredInManifest: environment.uncoveredInManifest,
    historicalScope: environment.historicalScope,
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

// Persist a raw debuggee stream verbatim and return its artifact name.
export function writeStream(environment, name, text) {
  mkdirSync(environment.evidenceDir, { recursive: true });
  writeFileSync(join(environment.evidenceDir, name), text ?? '');
  return { artifact: name, bytes: Buffer.byteLength(text ?? '') };
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

export function refuseEnvironment(error) {
  const condition = error?.condition ?? 'environmentRefusal';
  const detail = error?.detail ?? String(error);
  process.stdout.write(`FAIL environment ${condition}${detail === null ? '' : `: ${detail}`}\n`);
  process.exit(3);
}
