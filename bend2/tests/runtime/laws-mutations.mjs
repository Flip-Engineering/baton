#!/usr/bin/env node
// Scoped negative controls for the runtime-values law modules. Mirrors the
// mechanics of bend2/scripts/laws-check.mjs restricted to this lane: the
// isolated entry bend2/tests/runtime/observations-laws.bend must compile with
// every proof in place, must fail after each proof removal, and must fail
// after each implementation mutation, so every law shown here binds the real
// function it names. Run on an admitted runner:
//   node bend2/tests/runtime/laws-mutations.mjs [path-to-bend-2.0.25]
// Prints one JSON row per control and exits nonzero when any control fails.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const RUNTIME_DIR = join('bend2', 'src', 'context', 'runtime');
const ENTRY = join('bend2', 'tests', 'runtime', 'observations-laws.bend');
const SCRATCH = join(ROOT, '.scratch', 'runtime-values-laws-mutations');
const ENV = { ...process.env, BEND_NO_TELEMETRY: '1' };

function resolveBend() {
  const candidates = [process.argv[2], process.env.BEND].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  console.error('Bend is unavailable. Pass the Bend 2.0.25 executable or set BEND.');
  process.exit(1);
}

const BEND = resolveBend();

function compile(dir) {
  try {
    execFileSync(BEND, [ENTRY, '--check-only'], { env: ENV, cwd: dir, encoding: 'utf8', maxBuffer: Infinity });
    return { ok: true, output: '' };
  } catch (err) {
    return { ok: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

function prepareScratch() {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
  cpSync(join(ROOT, 'bend2'), join(SCRATCH, 'bend2'), { recursive: true });
}

function readModule(name) {
  return readFileSync(join(SCRATCH, 'bend2', 'src', 'context', 'runtime', name), 'utf8');
}

function writeModule(name, text) {
  writeFileSync(join(SCRATCH, 'bend2', 'src', 'context', 'runtime', name), text);
}

// Removes the `def <name>(...)` block that proves <name>: the def line and
// the following proof line. Returns false when no such def exists.
function removeProof(name, moduleText) {
  const pattern = new RegExp(`\\ndef ${name}\\([^)]*\\):\\n  \\{==\\}\\n`);
  if (!pattern.test(moduleText)) return false;
  return moduleText.replace(pattern, '\n');
}

const CAPTURE = 'observations-capture.bend';
const CLASSIFY = 'observations-classification.bend';

const LAWS = [
  { name: 'runtime_evidence_preserves_every_identity_member', file: CAPTURE },
  { name: 'capture_record_carries_both_event_identities_and_the_fixed_consistency_pair', file: CAPTURE },
  { name: 'capture_without_an_end_event_stays_open', file: CAPTURE },
  { name: 'runtime_fact_admits_only_the_observed_classification', file: CLASSIFY },
  { name: 'class_tags_are_the_four_fixed_names', file: CLASSIFY },
  { name: 'expansion_admits_each_class_at_itself', file: CLASSIFY },
  { name: 'observed_expansion_refuses_every_other_classification', file: CLASSIFY },
  { name: 'observed_value_completeness_follows_the_conservative_rule', file: CLASSIFY },
  { name: 'a_preview_is_incomplete_regardless_of_its_flags', file: CLASSIFY },
];

const MUTATIONS = [
  {
    name: 'capture-record-changes-consistency',
    file: CAPTURE,
    find: 'consistency: "per-response"',
    replace: 'consistency: "per-response-wrong"',
    law: 'capture_record_carries_both_event_identities_and_the_fixed_consistency_pair',
  },
  {
    name: 'capture-record-claims-verified-exclusivity',
    file: CAPTURE,
    find: 'controlExclusivity: "unverified"',
    replace: 'controlExclusivity: "verified"',
    law: 'capture_record_carries_both_event_identities_and_the_fixed_consistency_pair',
  },
  {
    name: 'unfinished-capture-manufactures-a-record',
    file: CAPTURE,
    find: 'case False{}: CaptureOpen{detail: "multirequest capture has no end event identity"}',
    replace: 'case False{}: CaptureRecord{startEvent: startEvent, endEvent: endEvent, consistency: "per-response", controlExclusivity: "unverified", epoch: epoch}',
    law: 'capture_without_an_end_event_stays_open',
  },
  {
    name: 'runtime-evidence-drops-the-original-member',
    file: CAPTURE,
    find: 'RuntimeEvidence{runtime: runtime, epoch: epoch, thread: thread, script: script, generated: generated, original: original}',
    replace: 'RuntimeEvidence{runtime: runtime, epoch: epoch, thread: thread, script: script, generated: generated, original: ""}',
    law: 'runtime_evidence_preserves_every_identity_member',
  },
  {
    name: 'runtime-facts-admit-checked',
    file: CLASSIFY,
    find: 'match cls:\n    case Observed{}: True{}\n    case StaticPossible{}: False{}\n    case Checked{}: False{}',
    replace: 'match cls:\n    case Observed{}: True{}\n    case StaticPossible{}: False{}\n    case Checked{}: True{}',
    law: 'runtime_fact_admits_only_the_observed_classification',
  },
  {
    name: 'expansion-upgrades-every-fact-to-observed',
    file: CLASSIFY,
    find: 'String.eq(class_tag(original), class_tag(proposed))',
    replace: 'True{}',
    law: 'observed_expansion_refuses_every_other_classification',
  },
  {
    name: 'static-possible-tag-renamed',
    file: CLASSIFY,
    find: '"static-possible"',
    replace: '"static"',
    law: 'class_tags_are_the_four_fixed_names',
  },
  {
    name: 'completeness-ignores-the-preview',
    file: CLASSIFY,
    find: 'Bool.and(Bool.not(hasPreview), Bool.not(expansionOverflow))',
    replace: 'Bool.not(expansionOverflow)',
    law: 'observed_value_completeness_follows_the_conservative_rule',
  },
];

prepareScratch();
const baseline = compile(SCRATCH);
const baselineRow = { control: 'entry-compiles-with-every-law-proven', refused: baseline.ok };
console.log(JSON.stringify(baselineRow));
let failures = baseline.ok ? 0 : 1;

for (const law of LAWS) {
  prepareScratch();
  const original = readFileSync(join(ROOT, 'bend2', 'src', 'context', 'runtime', law.file), 'utf8');
  const stripped = removeProof(law.name, original);
  if (!stripped) {
    console.log(JSON.stringify({ control: 'proof-removal', law: law.name, refused: false, error: 'no proof def found' }));
    failures += 1;
    continue;
  }
  writeModule(law.file, stripped);
  const result = compile(SCRATCH);
  const row = { control: 'proof-removal', law: law.name, refused: !result.ok };
  console.log(JSON.stringify(row));
  if (result.ok) failures += 1;
}

for (const mutation of MUTATIONS) {
  prepareScratch();
  const original = readFileSync(join(ROOT, 'bend2', 'src', 'context', 'runtime', mutation.file), 'utf8');
  if (!original.includes(mutation.find)) {
    console.log(JSON.stringify({ control: 'mutation', name: mutation.name, refused: false, error: 'find text absent' }));
    failures += 1;
    continue;
  }
  writeModule(mutation.file, original.replace(mutation.find, mutation.replace));
  const result = compile(SCRATCH);
  const row = { control: 'mutation', name: mutation.name, law: mutation.law, refused: !result.ok };
  console.log(JSON.stringify(row));
  if (result.ok) failures += 1;
}

rmSync(SCRATCH, { recursive: true, force: true });
console.log(`laws-mutations: ${failures === 0 ? 'green' : 'red'} - ${LAWS.length} proof removals, ${MUTATIONS.length} mutations, ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
