// Issue #333: the suite runner's host-wide verify lease, behind one testable seam.
// Issue #424: the nested bypass is proven by the PARENT's lease token, never by the suite root.
// run-suite.mjs holds ONE `verify` lease from the host capacity authority for the whole
// verdict — a full suite costs every core but the hub's (the #269 measurement), so two
// residents each running a suite would drive the load the way the 2026-09-14 incident did.
// The lease is acquired before the lanes start and released at the verdict. The request is a
// durable intent (#541): admission waits IN ORDER printing the #329 queued row for as long as
// the host is busy — there is no wait bound and no timeout refusal — and a limit no wait could
// cure (the host cannot fund one suite's memory share) proceeds degraded with a warning
// instead of queueing forever. A bypassed run acquires nothing.
//
// BATON_HOST_CAPACITY_DISABLED=1 stays the operator bypass (the run acquires nothing and touches
// no lease directory). The `nested` bypass is narrower: a runner spawned BY a test file whose
// parent HOLDS the lease inherits that parent's token digest in BATON_SUITE_VERIFY_LEASE, and only
// the digest — never the inherited suite root — leaves it unwired. A deployment that itself runs
// under a suite root pins BATON_TEST_SUITE_ROOT for every child, and RuntimeIsolation projects the
// deployment's environment onto its seats with that name intact (only secret- and provider-shaped
// names are filtered), so reading the root as "nested" left every seat's verdict lease-free — the
// 2026-09-18 03:15 incident (#424: nine worker leases, no verify lease, three concurrent
// `run-suite.mjs --changed` runs, load 58). BATON_HOST_CAPACITY_POLL_MS sets the queue poll.

import { createHash } from 'node:crypto';

import { HostCapacityAuthority, HOST_CAPACITY_BYPASS } from '../src/host-capacity.mjs';

/** The operator bypass: when set, the runner acquires nothing. */
export function suiteLeaseDisabled(env = process.env) {
  return env?.BATON_HOST_CAPACITY_DISABLED === '1';
}

/** The environment variable a lease-holding runner hands the children it spawns: the digest of
 * the token it holds (suiteLeaseTokenDigest). */
export const SUITE_VERIFY_LEASE_ENV = 'BATON_SUITE_VERIFY_LEASE';

/** The digest a lease-holding runner publishes to its children — the ONE lease that nests them
 * (kind, nonce, resident), so a child proves its parent's admission without reading, or trusting,
 * the authority. Null for anything that is not a lease token. */
export function suiteLeaseTokenDigest(token) {
  if (!token || typeof token !== 'object' || typeof token.nonce !== 'string') return null;
  return createHash('sha256')
    .update([token.kind ?? '', token.nonce, token.residentId ?? ''].join(':'))
    .digest('hex');
}

/** A nested runner — one spawned BY a test file whose parent holds the lease — stays unwired: a
 * nested verdict queuing behind its parent's lease would deadlock the suite's own self-checks, and
 * a suite host is oversubscribed by design. The proof is the parent's token digest in the
 * environment, never the inherited BATON_TEST_SUITE_ROOT: a seat inherits that root from the
 * deployment it runs in and is a verdict like any other (#424). */
export function suiteLeaseNested(env = process.env) {
  const digest = env?.[SUITE_VERIFY_LEASE_ENV];
  return typeof digest === 'string' && /^[a-f0-9]{64}$/u.test(digest);
}

/** The lease holder this runner enqueues under — visible on the authority's queue, and on the
 * swarm view's participant row as `verify {state, position, ahead}` when it names a seat (#333).
 * A seat-run verdict is held under the participant holder the runtime projects into the worker
 * environment (`participant:<swarmId>:<participantId>`), so the participant's own row shows the
 * suite it is running; a runner outside a swarm keeps the runner's pid holder. */
export function suiteLeaseHolder(env = process.env) {
  const swarmId = env?.BATON_SWARM_BRIDGE_SWARM_ID;
  const participantId = env?.BATON_SWARM_BRIDGE_PARTICIPANT_ID;
  if (typeof swarmId === 'string' && swarmId.length > 0
    && typeof participantId === 'string' && participantId.length > 0) {
    // The authority bounds a holder record at 256 bytes; an over-long identity names no seat.
    const holder = `participant:${swarmId}:${participantId}`;
    if (Buffer.byteLength(holder) <= 256) return holder;
  }
  return `run-suite:${process.pid}`;
}

function positiveInt(value) {
  const parsed = typeof value === 'string' && value.trim().length > 0 ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}


/** The authority this runner admits through: the shared host directory, never a fixture.
 * There is no wait bound to configure (#541): the queued intent waits in order until the
 * host admits it. */
export function createSuiteLeaseAuthority(env = process.env) {

/** The runner's own queue poll interval, when the operator pins one. */
export function suiteLeasePollMs(env = process.env) {
  return positiveInt(env?.BATON_HOST_CAPACITY_POLL_MS);
}

    ...(typeof env?.BATON_HOST_CAPACITY_ROOT === 'string' && env.BATON_HOST_CAPACITY_ROOT.length > 0
      ? { root: env.BATON_HOST_CAPACITY_ROOT } : {}),
    residentId: `run-suite-${process.pid}`,
  });
}
    ...(suiteLeasePollMs(env) !== null ? { pollMs: suiteLeasePollMs(env) } : {}),
/** The queued row the runner prints while it waits — the #329 shape with its numbers. */
export function formatSuiteQueueRow(row) {
  const shortfall = row?.shortfall
    ? `; waiting on ${row.shortfall.dimension}: ${row.shortfall.observed} ${row.shortfall.unit} observed, ${row.shortfall.required} required`
    : '';
  return `baton test runner: host capacity queued this verify request at position ${row?.position} (${row?.ahead} ahead)${shortfall}`;
}

/** The degraded-run warning: the host cannot fund a verdict, so this run proceeds without
 * the exclusion the lease would have bought — concurrent suites here will contend. The
 * argument is the authority's own shortfall row (#329 shape). */
export function formatSuiteDegradedWarning(shortfall) {
  const why = shortfall
    ? `waiting on ${shortfall.dimension}: ${shortfall.observed} ${shortfall.unit} observed, ${shortfall.required} required`
    : 'no room for a verify lease';
  return `baton test runner: proceeding WITHOUT a host verify lease (${why}) — this host cannot fund a full suite, so no wait would admit it; concurrent suites here will contend`;
}

/** The runner's pre-lane plan line (#424): the selection it expanded and the lane width it
 * resolved — one line printed BEFORE admission and before any lane, so a reader sees what is
 * about to run even when the host queues this verdict or degrades it. */
export function formatSuitePlan({
  expanded = 0, changedPaths = 0, parallel = 0, serial = 0, parallelism = 1, idleMs = 0,
} = {}) {
  const selection = changedPaths > 0
    ? `${expanded} file(s) expanded from ${changedPaths} changed path(s)`
    : `${expanded} file(s) in the whole suite`;
  return `baton test runner: plan — ${selection}: ${parallel} in the parallel lane (x${parallelism}), ${serial} in the serial lane; progress deadline ${idleMs} ms per file`;
}

/** Acquire the runner's verify lease, printing the queued row while it waits. Resolves with
 * `{disabled, nested, degraded, shortfall, token, authority, release}`; a bypassed or nested
 * run resolves `{disabled: true}` without touching the lease directory; a shortfall no wait
 * could cure (the host cannot fund one suite's memory share) resolves `degraded` AT ONCE,
 * before any queue entry exists; and otherwise the call waits IN ORDER — unbounded (#541) —
 * until the host admits the verdict. It never rejects for being early. */
export async function acquireSuiteVerifyLease({
  authority = null, createAuthority = createSuiteLeaseAuthority,
  env = process.env, holder = suiteLeaseHolder(env),
  log = (line) => process.stderr.write(`${line}\n`), onQueued = null,
} = {}) {
  if (suiteLeaseDisabled(env) || suiteLeaseNested(env)) {
    return Object.freeze({
      disabled: true, nested: suiteLeaseNested(env),
      degraded: false, shortfall: null,
      token: null, authority: null, release: async () => false,
    });
  }
  const resolved = authority ?? createAuthority(env);
  const standing = await resolved.shortfallFor('verify');
  if (standing?.dimension === 'memory') {
    return Object.freeze({
      disabled: false, nested: false,
      degraded: true, shortfall: standing,
      token: null, authority: null, release: async () => false,
    });
  }
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
    degraded: false, shortfall: null,
    release: async () => {
      if (released) return false;
      released = true;
      return resolved.release(outcome.token);
    },
  });
}
