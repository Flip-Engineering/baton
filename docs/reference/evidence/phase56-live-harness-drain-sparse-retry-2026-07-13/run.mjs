#!/usr/bin/env node

// The first live run proved five-route concurrent process lifecycle and exact drain/reap, but its
// full fresh-verifier checkouts exhausted the host's remaining disk. Reuse the same closed runner
// with its explicit sparse-verifier switch; all target and toolchain identities remain unchanged.
import '../phase56-live-harness-drain-2026-07-13/run.mjs';
