#!/usr/bin/env node

// Issue #42: mechanical guard against the time-bomb fixture class — a store built on the real
// clock in a file that also hardcodes a near-dated expiry literal. That shape passed green at
// commit twice and failed hours later when wall time crossed the literal (kg12, 0afe842; a
// phase89 lease shape in the bloc acceptance review). The lint flags a file only when all three
// hold: it constructs a CoordinationStore, the file nowhere injects a `clock`, and it contains
// an expiry-shaped ISO literal inside the active development horizon. Distant sentinels (2099)
// are effectively infinite and stay clean. `// baton-lint: allow-real-clock` opts a deliberate
// wall-time fixture out, visibly and reviewably.
//
// The horizon is configurable (BATON_FIXTURE_CLOCK_HORIZON_YEARS, default 3): an expiry within
// the repository's plausible active lifetime will be crossed while the suite still runs; that
// derivation, not an arbitrary cap, sets the default.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PRAGMA = /baton-lint:\s*allow-real-clock/u;
const STORE = /new\s+CoordinationStore\s*\(/u;
const CLOCK = /\bclock\b/u;
const EXPIRY_LITERAL = /(?:expiresAt|expiry|deadline|validTo)\s*[:=]\s*['"`](\d{4})-\d{2}-\d{2}T/u;

export function lintFixtureClocks(files, { now = Date.now(), horizonYears = defaultHorizonYears() } = {}) {
  const findings = [];
  const currentYear = new Date(now).getUTCFullYear();
  for (const file of files) {
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (PRAGMA.test(content) || !STORE.test(content) || CLOCK.test(content)) continue;
    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const match = EXPIRY_LITERAL.exec(lines[index]);
      if (!match) continue;
      const year = Number(match[1]);
      if (year < currentYear - 1 || year > currentYear + horizonYears) continue;
      findings.push({
        file, line: index + 1,
        reason: `near-dated expiry literal (${match[1]}…) beside a CoordinationStore with no injected clock — the kg12 time-bomb shape; inject a fixed clock or add "// baton-lint: allow-real-clock"`,
      });
    }
  }
  return findings;
}

function defaultHorizonYears() {
  const configured = Number(process.env.BATON_FIXTURE_CLOCK_HORIZON_YEARS);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 3;
}

export function lintDefaultTestDirectory() {
  const testDir = new URL('../test/', import.meta.url).pathname;
  const files = readdirSync(testDir).filter((name) => name.endsWith('.mjs')).map((name) => join(testDir, name));
  return lintFixtureClocks(files);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const findings = lintDefaultTestDirectory();
  for (const finding of findings) {
    process.stderr.write(`fixture-clock-lint: ${finding.file}:${finding.line}: ${finding.reason}\n`);
  }
  process.exitCode = findings.length === 0 ? 0 : 1;
}
