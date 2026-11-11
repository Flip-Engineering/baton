#!/usr/bin/env node

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.BATON_REVIEW_PHASE = '53';
process.env.BATON_EVIDENCE_DIR ??= HERE;

await import('../phase51-process-lifecycle-review-2026-07-13/run.mjs');
