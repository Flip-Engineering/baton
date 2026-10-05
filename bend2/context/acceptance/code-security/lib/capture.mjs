// Capture-consistency helpers: phase recording and a concurrent mutator.

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256File } from './fixtures.mjs';

export const CAPTURE_FILES = ['include/alpha.h', 'include/beta.h', 'src/main.c'];

export function setPhase(path, digit) {
  const text = readFileSync(path, 'utf8');
  if (!/^(#define [A-Z_]+_PHASE )\d+/m.test(text)) throw new Error(`no phase define in ${path}`);
  const next = text.replace(/^(#define [A-Z_]+_PHASE )\d+/m, `$1${digit}`);
  if (next !== text) writeFileSync(path, next);
}

// Records the digest of every capture file at each phase, then leaves phase 0.
export function recordPhases(captureRoot) {
  const phases = [];
  for (const digit of ['0', '1']) {
    const phase = {};
    for (const file of CAPTURE_FILES) {
      const path = join(captureRoot, file);
      setPhase(path, digit);
      phase[path] = sha256File(path);
    }
    phases.push(phase);
  }
  for (const file of CAPTURE_FILES) setPhase(join(captureRoot, file), '0');
  return phases;
}

// Toggles every captured file between the two phases while a query runs.
export function startMutator(captureRoot) {
  const files = CAPTURE_FILES.map((file) => join(captureRoot, file));
  const script = [
    "const { readFileSync, writeFileSync, renameSync } = require('node:fs');",
    `const files = ${JSON.stringify(files)};`,
    'let digit = 0;',
    'const timer = setInterval(() => {',
    '  digit = 1 - digit;',
    '  for (const file of files) {',
    '    try {',
    "      const text = readFileSync(file, 'utf8');",
    "      const next = text.replace(/^(#define [A-Z_]+_PHASE )\\d+/m, '$1' + digit);",
    "      const scratch = file + '.phase-scratch';",
    '      writeFileSync(scratch, next);',
    '      renameSync(scratch, file);',
    '    } catch {}',
    '  }',
    '}, 5);',
    "process.on('SIGTERM', () => { clearInterval(timer); process.exit(0); });",
  ].join('\n');
  return spawn(process.execPath, ['-e', script], { stdio: 'ignore' });
}

export function sourceDigestSet(envelope) {
  const digests = [];
  const result = envelope?.result;
  for (const item of [...(result?.facts ?? []), ...(result?.relations ?? [])]) {
    for (const evidence of item.evidence ?? []) {
      if (evidence?.kind === 'source') digests.push(`${evidence.path}:${evidence.sha256}`);
    }
  }
  return digests.sort();
}
