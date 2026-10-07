#!/usr/bin/env node

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Focused retry at the bounded 16 MiB provider-frame ceiling after the full five-route run
// surfaced a real 1 MiB Codex app-server frame rather than losing lifecycle ownership.
process.env.BATON_EVIDENCE_DIR ??= dirname(fileURLToPath(import.meta.url));
process.env.BATON_TASK_IDS = 'phase62-codex-review';
// A first hardened-checkpoint retry consumed 494,099 tokens and the accepted retry
// consumed 502,895 under Codex's cumulative thread counter, so keep this review
// explicitly inside its approved node and reserve rather than using the catalog default.
process.env.BATON_TASK_TOKEN_BUDGET ??= '650000';
process.env.BATON_TERMINAL_RESERVE_TOKENS ??= '650000';
await import('../phase62-goal-plan-authority-review-2026-07-13/run.mjs');
