// W6.1 AX-report wave: three heterogeneous seats report their agentic experience from
// inside baton — frictions hit, gaps noticed, ranked proposals. One wave, three members,
// per-seat receipt pointers. Usage: node run-ax-wave.mjs
import { resolve } from 'node:path';
import { createWaveDriver, openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const ATTEMPT = new Date().toISOString();
const log = (line) => console.log(`[ax ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'ax-report-2026-07-31'),
    routes: [
      { harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' },
      { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' },
      { harness: 'glm', model: 'glm-5.2', effort: 'high' },
    ],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

const COMMON = [
  'Write an agentic-experience report from a WORKER\'S seat driving baton this campaign.',
  'Sections: (1) FRICTIONS you actually hit — objective quality (was the task shape clear? were coordinates given or did you burn turns discovering them?), the wire_frame_oversize discipline, turn/checkpoint ergonomics (pausing, nudges — did nudge messages help or confuse?), the trust gate, scope rules, scratchpad/grammar lines, stall clocks; (2) GAPS — what you needed from inside that does not exist (surfaces, signals, tools, projections); (3) PROPOSALS ranked P0/P1/P2, each with grounding (what happened, where), the failure, and a minimal repair — red-team rigor, worker perspective.',
  'Be candid and specific; cite the receipts you are pointed at plus anything you verify live. ~100-150 lines.',
  'HARD CONSTRAINT (wire_frame_oversize kills runs, issue #28): never read a whole file over ~1500 lines — grep to locate, then read targeted ranges. Bound every command output.',
];

const MEMBERS = [
  {
    role: 'ax-opus',
    exact: { harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' },
    receipts: 'Your seat\'s receipts: docs/reference/evidence/setup-token-2026-07-31/redteam-v2.md (your #11 verification), docs/reference/evidence/control-surface-2026-07-31/s2-redteam-v1.md (your S-2 security review), docs/reference/evidence/grammar-2026-07-24/redteam-opus.md (your grammar review).',
  },
  {
    role: 'ax-sonnet',
    exact: { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' },
    receipts: 'Your seat\'s receipts: docs/reference/evidence/issue53-run-debug-2026-07-24/ (your #53 run.debug), docs/reference/evidence/bidirectional-2026-07-31/impl-evidence.json and impl-a2-evidence.json (your three BD wave deaths — stall-killed twice, zero-output; say plainly what happened from your side).',
  },
  {
    role: 'ax-glm',
    exact: { harness: 'glm', model: 'glm-5.2', effort: 'high' },
    receipts: 'Your seat\'s receipts: docs/reference/evidence/atlas-2026-07-31/redteam-v1.md (your ATLAS review — your first red-team seat), docs/PROGRESS.md (search "glm" for your earlier waves: #46 driver implementation, the 20-min stream death #50, the second-worker spawn failure #49).',
  },
];

try {
  const driver = createWaveDriver(baton, {
    steering: 'nudge-on-checkpoint',
    finalization: 'claim-on-stall',
    pollIntervalMs: 20_000,
    stallTimeoutMs: 15 * 60_000,
    hardCapMs: 3_600_000,
    settleTimeoutMs: 15_000,
    saltObjectives: true,
    evidencePath: resolve(repo, 'reviews/ax-report-2026-07-31/wave-evidence.json'),
    onProgress: (line) => log(`progress ${line}`),
  });
  const receipt = await driver.run({
    members: MEMBERS.map((member) => ({
      role: member.role,
      objective: [
        `You are the ${member.role} seat. ${member.receipts}`,
        ...COMMON,
        `Write the report to reviews/ax-report-2026-07-31/${member.role}.md — begin with the section skeleton in your first work turn, then deepen.`,
        `[attempt: ${ATTEMPT}]`,
      ].join(' '),
      exact: member.exact,
      scope: ['reviews/ax-report-2026-07-31/**'],
    })),
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1500)}`);
  log('AX-WAVE-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
