#!/usr/bin/env node

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Focused retry after the full five-route run correctly rejected GLM's renamed executable
// artifact. The same approved five-node plan remains authoritative; only this node dispatches.
process.env.BATON_EVIDENCE_DIR ??= dirname(fileURLToPath(import.meta.url));
process.env.BATON_TASK_IDS = 'phase62-glm-review';
await import('../phase62-goal-plan-authority-review-2026-07-13/run.mjs');
