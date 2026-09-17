// Issue #333: the suite runner's host-wide verify lease, behind one testable seam.
//
// run-suite.mjs holds ONE `verify` lease from the host capacity authority for the whole
// verdict — a full suite costs every core but the hub's (the #269 measurement), so two
// residents each running a suite would drive the load the way the 2026-09-14 incident did.
// The lease is acquired before the lanes start and released at the verdict; while the
// request waits it prints the queued row (position, ahead, shortfall — the #329 shape), and
// a spent wait refuses BEFORE any lane starts unless the dimension names a standing host
// limit no wait could cure (suiteQueueTimeoutDecision).
//
// BATON_HOST_CAPACITY_DISABLED=1 stays the operator bypass (the run acquires nothing and
// touches no lease directory); a nested runner — one spawned from a test file, carrying
// BATON_TEST_SUITE_ROOT — stays unwired the same way deployments do, so the suite's own
// self-checks never queue behind their parent's lease. Every test-file child stays unwired
// through the BATON_HOST_CAPACITY_DISABLED=1 run-suite.mjs already pins in the child
// environment. The runner's own wait defaults short (verify leases are held for minutes, so
// a longer wait only delays the same decision); BATON_HOST_CAPACITY_WAIT_MS extends it and
// BATON_HOST_CAPACITY_POLL_MS sets the queue poll.

import { HostCapacityAuthority, HOST_CAPACITY_BYPASS } from '../src/host-capacity.mjs';

/** The operator bypass: when set, the runner acquires nothing. */
export function suiteLeaseDisabled(env = process.env) {
  return env?.BATON_HOST_CAPACITY_DISABLED === '1';
}

/** A nested runner — spawned from a test file, which inherits the suite root — stays unwired,
 * the same rule deployments follow (a suite host is oversubscribed by design, and a nested
 * verdict queuing behind its parent's lease would deadlock the suite's own self-checks). */
export function suiteLeaseNested(env = process.env) {
  return env?.BATON_TEST_SUITE_ROOT !== undefined;
}

/** The lease holder this runner enqueues under — visible on the authority's queue. */
export function suiteLeaseHolder() {
  return `run-suite:${process.pid}`;
}

function positiveInt(value) {
  const parsed = typeof value === 'string' && value.trim().length > 0 ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** The runner's default admission wait: short on purpose. Verify leases are held for whole
 * suites and checks (minutes), so a longer wait would only delay the same refuse/degrade
 * decision — while a top-level run that stalls the authority default (120s) would break the
 * suite's own time-bound self-checks on a host with no room. The operator extends it through
 * BATON_HOST_CAPACITY_WAIT_MS when queuing behind a known-finishing holder. */
export const DEFAULT_SUITE_LEASE_WAIT_MS = 2_000;

/** The runner's own admission wait bound: the operator pin, else the short default. */
export function suiteLeaseWaitMs(env = process.env) {
  return positiveInt(env?.BATON_HOST_CAPACITY_WAIT_MS) ?? DEFAULT_SUITE_LEASE_WAIT_MS;
}

/** The runner's own queue poll interval, when the operator pins one. */
export function suiteLeasePollMs(env = process.env) {
  return positiveInt(env?.BATON_HOST_CAPACITY_POLL_MS);
}

/** The authority this runner admits through: the shared host directory, never a fixture. */
export function createSuiteLeaseAuthority(env = process.env) {
  return new HostCapacityAuthority({
    ...(typeof env?.BATON_HOST_CAPACITY_ROOT === 'string' && env.BATON_HOST_CAPACITY_ROOT.length > 0
      ? { root: env.BATON_HOST_CAPACITY_ROOT } : {}),
    waitMs: suiteLeaseWaitMs(env),
    ...(suiteLeasePollMs(env) !== null ? { pollMs: suiteLeasePollMs(env) } : {}),
    residentId: `run-suite-${process.pid}`,
  });
}

/** The queued row the runner prints while it waits — the #329 shape with its numbers. */
export function formatSuiteQueueRow(row) {
  const shortfall = row?.shortfall
    ? `; waiting on ${row.shortfall.dimension}: ${row.shortfall.observed} ${row.shortfall.unit} observed, ${row.shortfall.required} required`
    : '';
  return `baton test runner: host capacity queued this verify request at position ${row?.position} (${row?.ahead} ahead)${shortfall} (operator bypass: ${HOST_CAPACITY_BYPASS})`;
}

/** The spent-wait decision for the runner: `refuse`, unless the dimension names a limit no
 * wait could cure. A `budget` shortfall means another lease holds the verdict lane and a
 * `load` shortfall means the host is oversubscribed — waiting can resolve either, so a spent
 * wait refuses before lanes, the way a recruit refuses pre-effect. A `memory` shortfall
 * means the host itself cannot fund a full suite's entitled share (a standing property of a
 * small host, not a transient queue): refusing would brick the suite there forever, so the
 * runner proceeds degraded without mutual exclusion and says so. Anything unrecognized
 * fails closed to `refuse`. */
export function suiteQueueTimeoutDecision(error) {
  if (error?.code !== 'host_capacity_queue_timeout') return 'refuse';
  return error?.shortfall?.dimension === 'memory' ? 'proceed-degraded' : 'refuse';
}

/** The degraded-run warning: the host cannot fund a verdict, so this run proceeds without
 * the exclusion the lease would have bought — concurrent suites here will contend. */
export function formatSuiteDegradedWarning(error) {
  const shortfall = error?.shortfall
    ? `waiting on ${error.shortfall.dimension}: ${error.shortfall.observed} ${error.shortfall.unit} observed, ${error.shortfall.required} required`
    : 'no room for a verify lease';
  return `baton test runner: proceeding WITHOUT a host verify lease (${shortfall}) — this host cannot fund a full suite, so no wait would admit it; concurrent suites here will contend`;
}

/** Acquire the runner's verify lease, printing the queued row while it waits. Resolves with
 * `{disabled, nested, token, authority, release}`; a bypassed or nested run resolves
 * `{disabled: true}` without touching the lease directory, and a spent wait rejects with the
 * authority's typed `host_capacity_queue_timeout` — the caller refuses before lanes or
 * degrades visibly (suiteQueueTimeoutDecision), never starved silently inside them. */
export async function acquireSuiteVerifyLease({
  authority = null, createAuthority = createSuiteLeaseAuthority,
  holder = suiteLeaseHolder(), env = process.env,
  log = (line) => process.stderr.write(`${line}\n`), onQueued = null,
} = {}) {
  if (suiteLeaseDisabled(env) || suiteLeaseNested(env)) {
    return Object.freeze({
      disabled: true, nested: suiteLeaseNested(env),
      token: null, authority: null, release: async () => false,
    });
  }
  const resolved = authority ?? createAuthority(env);
  let reported = false;
  const outcome = await resolved.acquire('verify', {
    holder,
    onQueued: (row) => {
      if (reported) return;
      reported = true;
      if (onQueued) onQueued(row);
      log(formatSuiteQueueRow(row));
    },
  });
  let released = false;
  return Object.freeze({
    disabled: false, nested: false,
    token: outcome.token,
    authority: resolved,
    release: async () => {
      if (released) return false;
      released = true;
      return resolved.release(outcome.token);
    },
  });
}
