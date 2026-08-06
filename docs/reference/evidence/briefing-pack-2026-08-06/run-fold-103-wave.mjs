// #103 FOLD WAVE — a deepseek folder for the briefing-pack contract against its red-team.
// Facade-only launcher.
// Usage: node run-fold-103-wave.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/briefing-pack-2026-08-06');
mkdirSync(EVIDENCE, { recursive: true });
const ATTEMPT = new Date().toISOString();
const SALT = `f3${ATTEMPT.replace(/[-:T.Z]/g, '').slice(0, 14)}`;
const log = (line) => console.log(`[rt103 ${new Date().toISOString()}] ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const receipts = { attempt: ATTEMPT, salt: SALT, steps: [] };
const persist = () => writeFileSync(resolve(EVIDENCE, 'fold-103-receipt.json'), `${JSON.stringify(receipts, null, 2)}\n`);
const step = (name, receipt) => { receipts.steps.push({ step: name, receipt: receipt ?? null }); persist(); log(`${name}: ${JSON.stringify(receipt)?.slice(0, 140) ?? 'done'}`); };

const OBJECTIVE = [
  `[attempt: f3-${ATTEMPT}] You are FOLDING an adversarial red-team report into the briefing-pack contract. Read fully, in order: (1) the red-team report docs/reference/evidence/briefing-pack-2026-08-06/contract-redteam.md (5 blockers B1-B5 + 5 non-blocking N1-N5); (2) the contract docs/reference/evidence/briefing-pack-2026-08-06/briefing-pack-contract.md (your edit target).`,
  'Fold every blocker: B1 (the ledger-only composition law is unsatisfiable for the promised schema — waves/rings/lanes/parked/blocked-on are NOT store projections; the store snapshot has tasks/runs/boards/knowledge but no campaign rings) — EITHER re-scope the schema to what the durable ledger actually carries (name each field store source) OR add the campaign-state record to the settlement ritual as part of the rung (the ring/lane state minted INTO the ledger at wave close — a small new durable record; if you choose this, name the record shape + mint site + the honesty rule). B3 (staleness misreadable: the epoch-age measures ledger-head movement, frozen on idle deployments) — fix the staleness semantics (name what the age MEASURES vs what an operator reads it as; add the "no events since" disclosure). B5 (the CLI doctor render is mis-specified — byte-stability vs one-line render in tension) — pick one (recommend: the briefing rides the doctor JSON as a named additive field, never a text render; fix D6). N1 (header verification-HEAD drift — re-run the application-deployment anchors against the current HEAD). N2 (D4 ordering vs auth-key replay — the short-circuit before the key check or per-settlement-unique keys). N3 (the resolve-lane naming — the orchestrator-facing surface, not the MCP surface that cannot resolve it). N4 (the OQ2 config exception stated in D8). N5 (the A7 failure-forcing gap — an injected overflow path for the suite).',
  'Campaign law: no clocks; every new citation verified with grep -an/sed -n (NUL files: application.mjs + coordination-store.mjs only). Bump the header to v1.1 with the fold note. Write the fold summary (blocker → change map) to docs/reference/evidence/briefing-pack-2026-08-06/contract-fold.md. Edit ONLY the contract + the fold summary.',
].join(' ');
(