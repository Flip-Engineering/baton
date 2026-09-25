#!/usr/bin/env node

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Recursive Baton-on-Baton Phase 62 review: mandatory approved Goal/Plan dispatch across every
// exact supported provider route, followed by shared lifecycle, kill, and reap proof.
process.env.BATON_EVIDENCE_DIR ??= dirname(fileURLToPath(import.meta.url));
process.env.BATON_REVIEW_PHASE = '62';
process.env.BATON_REVIEW_TEST = 'impl/test/phase62-goal-plan-authority.test.mjs impl/test/phase62-goal-plan-replay-reds.test.mjs impl/test/phase62-web-goal-plan.test.mjs impl/test/phase62-goal-plan-stream.test.mjs impl/test/phase62-mcp-goal-plan.test.mjs';
process.env.BATON_PROVIDER_GOVERNANCE_MODE = 'observe';
process.env.BATON_SPARSE_VERIFY = '1';
process.env.BATON_WORKTREE_CAPACITY = '1';
await import('../phase56-live-harness-drain-2026-07-13/run.mjs');
