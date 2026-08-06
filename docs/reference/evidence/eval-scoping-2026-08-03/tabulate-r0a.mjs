// EVAL-R0a — the retrospective half of the first honest eval (issue #107): tabulate the fleet's
// existing track record from durable receipts, zero new spend. Sources: refs/baton/results pins
// (route trailers + timestamps) and docs/reference/evidence/**\/*-receipt.json (wave outcomes,
// nudges, claims). Output: r0a-retrospective.md + r0a-retrospective.json beside this script.
// Usage: node tabulate-r0a.mjs
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repo = resolve(process.cwd());
const EVIDENCE = join(repo, 'docs/reference/evidence');
const OUT = resolve(EVIDENCE, 'eval-scoping-2026-08-03');

// 1. Result pins: route trailers + commit time.
const pinShas = execFileSync('git', ['for-each-ref', 'refs/baton/results', '--format=%(objectname)'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const pins = pinShas.map((sha) => {
  const message = execFileSync('git', ['log', '-1', '--format=%B|%cI', sha], { cwd: repo, encoding: 'utf8' });
  const trailer = (name) => (message.match(new RegExp(`^${name}: (.*)$`, 'm')) ?? [])[1] ?? null;
  const [subject, date] = [message.split('\n')[0], (message.match(/\|(\S+)$/m) ?? [])[1] ?? null];
  return {
    sha, date, task: trailer('Baton-Task'), vendor: trailer('Baton-Vendor'),
    model: trailer('Baton-Model'), effort: trailer('Baton-Effort'), subject: subject.replace(/^baton snapshot: /, ''),
  };
}).sort((a, b) => (a.date < b.date ? -1 : 1));

// 2. Wave receipts: outcomes, nudges, claims, knowledge.
const receipts = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('-receipt.json') || entry.name === 'live-acceptance-receipt.json') {
      try {
        const data = JSON.parse(readFileSync(full, 'utf8'));
        receipts.push({ file: full.slice(repo.length + 1), data });
      } catch { /* unreadable receipt — skipped */ }
    }
  }
};
walk(EVIDENCE);

const rows = [];
for (const { file, data } of receipts) {
  const outcomes = data.outcomes ?? [];
  for (const outcome of outcomes) {
    rows.push({
      receipt: file,
      role: outcome.role ?? null,
      phase: outcome.phase ?? null,
      terminal: outcome.terminal ?? null,
      resultSha: outcome.resultSha ?? null,
      basis: data.basis ?? null,
      nudges: (data.nudges ?? []).length,
      claims: (data.claims ?? []).length,
      startedAt: data.startedAt ?? null,
    });
  }
}

// 3. Model/seat tallies + outcome rates.
const by = (list, key) => list.reduce((acc, row) => { const k = row[key] ?? 'unknown'; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
const pinModels = by(pins, 'model');
const outcomePhases = by(rows, 'phase');
const resultReady = rows.filter((row) => row.phase === 'result_ready');
const nudgeCounts = rows.map((row) => row.nudges).sort((a, b) => a - b);
const median = (sorted) => sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];
// Interpretation law: nudges/claims are the driver's ROUTINE claim-cadence steering, not failures
// — the campaign's one-shot pattern (no re-drive, no kill, suite green on first harvest) is not
// visible in receipts alone; the honest proxy here is phase + resultSha presence.

const table = [
  '| Receipt | Role | Phase | Nudges | Claims | Basis |',
  '|---|---|---|---|---|---|',
  ...rows.map((row) => `| ${row.receipt.replace('docs/reference/evidence/', '')} | ${row.role} | ${row.phase} | ${row.nudges} | ${row.claims} | ${row.basis ?? '—'} |`),
].join('\n');

const md = `# EVAL-R0a — the fleet's retrospective track record (issue #107)

Generated: ${new Date().toISOString()} · zero new spend — durable receipts only.

## Result pins: ${pins.length}

By model: ${Object.entries(pinModels).map(([model, count]) => `${model} ×${count}`).join(' · ')}

## Wave outcomes: ${rows.length} member-outcomes across ${receipts.length} receipts

By phase: ${Object.entries(outcomePhases).map(([phase, count]) => `${phase} ×${count}`).join(' · ')}

- result_ready outcomes: ${resultReady.length} of ${rows.length} rows · median nudges per outcome: ${median(nudgeCounts)} (nudges are the driver's routine claim cadence, not failures)
- the one-shot pattern (no re-drive, no kill, suite green on first harvest) is NOT visible in receipts alone — EVAL-R0's driven arms will pin it; every row carries its receipt file for re-verification.

## The table

${table}
`;

writeFileSync(join(OUT, 'r0a-retrospective.md'), md);
writeFileSync(join(OUT, 'r0a-retrospective.json'), JSON.stringify({ generatedAt: new Date().toISOString(), pins, rows, pinModels, outcomePhases, medianNudges: median(nudgeCounts), resultReadyCount: resultReady.length }, null, 2));
console.log(`pins: ${pins.length} · outcome rows: ${rows.length} · result_ready: ${resultReady.length} · median nudges: ${median(nudgeCounts)}`);
console.log(`models: ${JSON.stringify(pinModels)}`);
