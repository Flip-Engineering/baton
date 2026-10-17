#!/usr/bin/env node

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Phase 57 recursive Baton-on-Baton matrix. The shared runner retains its Phase 56 defaults for
// historical reproduction; this profile turns on exact observe-mode provider governance and the
// Phase 57 spec/test/report catalog.
process.env.BATON_EVIDENCE_DIR ??= dirname(fileURLToPath(import.meta.url));
process.env.BATON_REVIEW_PHASE = '57';
process.env.BATON_PROVIDER_GOVERNANCE_MODE = 'observe';
process.env.BATON_SPARSE_VERIFY = '1';
await import('../phase56-live-harness-drain-2026-07-13/run.mjs');
