#!/usr/bin/env node
// Provider executable probe for the adapter environment cases (group E).
//
// The probe records the exact argument vector, working directory and complete
// environment it was started with, then reports a version. Recording happens on
// every invocation, including a --version admission call, because the recorded
// environment is the evidence the case checks.
//
//   ENV_PROBE_MARKER  marker path; defaults to env-probe.marker.json beside
//                     this script

import { appendFileSync, mkdirSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION_LINE = "env-probe 1.0.0";

const markerPath =
  process.env.ENV_PROBE_MARKER ||
  fileURLToPath(new URL("env-probe.marker.json", import.meta.url));

const sortedEnvironment = {};
for (const key of Object.keys(process.env).sort()) {
  sortedEnvironment[key] = process.env[key];
}

const entry = {
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: sortedEnvironment,
};

mkdirSync(dirname(markerPath), { recursive: true });
appendFileSync(markerPath, JSON.stringify(entry) + "\n");
writeSync(1, VERSION_LINE + "\n");
process.exit(0);
