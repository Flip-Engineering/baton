#!/usr/bin/env node

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Recursive Baton-on-Baton review across every exact supported provider route.
process.env.BATON_EVIDENCE_DIR ??= dirname(fileURLToPath(import.meta.url));
process.env.BATON_REVIEW_PHASE = '60';
process.env.BATON_REVIEW_SPEC = 'spec/phase60/attach-only-native-recovery.md';
process.env.BATON_REVIEW_TEST = 'impl/test/phase11-persistent-sessions.test.mjs impl/test/phase60-coordination-recovery.test.mjs';
process.env.BATON_PROVIDER_GOVERNANCE_MODE = 'observe';
process.env.BATON_SPARSE_VERIFY = '1';
process.env.BATON_WORKTREE_CAPACITY = '1';
await import('../phase56-live-harness-drain-2026-07-13/run.mjs');
