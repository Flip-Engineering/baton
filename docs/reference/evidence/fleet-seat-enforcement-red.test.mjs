import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// #228 re-seat enforcement (operator-ordered, 2026-08-15): the omp adapter LANDED (cfdb593e)
// but the fleet's packs still rode harness: deepseek — the compat layer kept orphaning
// claude-code processes and losing work to cause-less provider deaths. This suite enforces
// the seat: every ACTIVE wavefile in the evidence tree carries harness omp members.
//
// RED at HEAD: every fired pack says `harness deepseek`.

const EVIDENCE = import.meta.dirname;

function activeWavefiles() {
  const out = [];
  for (const campaign of readdirSync(EVIDENCE, { withFileTypes: true })) {
    if (!campaign.isDirectory()) continue;
    for (const sub of readdirSync(join(EVIDENCE, campaign.name), { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      const dir = join(EVIDENCE, campaign.name, sub.name);
      for (const f of readdirSync(dir)) {
        if (f.endsWith('.wavefile')) out.push({ label: `${campaign.name}/${sub.name}/${f}`, text: readFileSync(join(dir, f), 'utf8') });
      }
    }
  }
  return out;
}

test('SEAT: every wavefile member rides the omp harness — no compat-layer seats remain', () => {
  const offenders = [];
  for (const { label, text } of activeWavefiles()) {
    const memberHarnesses = [...text.matchAll(/^\s*harness\s+(\S+)/gmu)].map((m) => m[1]);
    if (memberHarnesses.length === 0) continue;
    const bad = memberHarnesses.filter((h) => h !== 'omp');
    if (bad.length > 0) offenders.push(`${label}: ${bad.join(',')}`);
  }
  assert.deepEqual(offenders, [],
    `wavefiles still riding the compat layer (the orphan-producing seats):\n${offenders.join('\n')}`);
});

test('SEAT: omp members name first-class deepseek/glm models (no anthropic-compat translation)', () => {
  for (const { label, text } of activeWavefiles()) {
    const models = [...text.matchAll(/^\s*model\s+"?([^"\s]+)"?/gmu)].map((m) => m[1]);
    for (const model of models) {
      if (model === 'omp') continue;
      assert.match(model, /^(deepseek|glm)\//,
        `${label}: model '${model}' is not a first-class omp provider route`);
    }
  }
});
