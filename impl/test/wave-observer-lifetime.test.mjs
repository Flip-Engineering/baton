import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWave } from '../src/index.mjs';

// OBSERVER-LIFETIME: a wave observation is an OBSERVER, never lifecycle authority. Two things end
// one, and neither touches a member's work: the observation's own single invocation deadline
// (or the caller's signal), and the cancellation of the drive pumps that observation owns. These
// pins hold the PUBLIC handle boundary with deferred-promise facades, so every claim is about
// truth and ordering, never wall-clock timing:
//   1. a hung member read never withholds a healthy peer, and the receipt names the unobserved
//      member (`wave_observer_timeout`) instead of inventing a phase for it — and never stops it;
//   2. a sibling that finishes mid-window while another member stays hung still contributes its
//      finished phase AND preserved result, and a member whose read never answered is never driven;
//   3. the receipt is built from observations taken INSIDE the deadline: no read is started after
//      it, and a read that fails after the observation ended is consumed, never consulted;
//   4. ending an observation cancels the drive pump it owns through run.complete's signal: the
//      observer is cancelled, the worker is untouched;
//   5. a hung read is not sticky — a later observation reads the member fresh;
//   6. overlapping callers never cancel each other: one drive serves both, and it is cancelled
//      only when its LAST owner releases;
//   7. close asks every drive to end before it stops the member, and reports the drive accounting
//      instead of claiming that aborting a loop proved the facade's loop ended;
//   8. a facade that ignores the abort is reported as an unconfirmed drive, never claimed drained;
//   9. a cancelled drive that has not settled is RETAINED, never replaced by a second loop over
//      the same run handle, and is re-armed only once it actually settles;
//  10. an earlier settle finishing late cannot overwrite the evidence a later settle published;
//  11. progress() and settle() both accept a caller signal and end as a typed cancelled observer —
//      including a cancellation while a result read is outstanding, which detaches promptly and
//      starts no further facade effect.
// Determinism: every await is on an explicit deferred resolved by the test or a facade hook; the
// only real timers are the short, relative observation budgets themselves, and no assertion
// depends on how long anything took.

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const member = (role) => ({ role, objective: `${role} objective`, scope: [`${role}.mjs`] });

// The minimal live-run handle the wave handle touches. `complete` receives the observer's options —
// the pump's abort signal is the whole point of the lifetime pins — and every hook appends to
// `calls` so initiation ORDER is readable.
function memberHandle(role, calls, hooks = {}) {
  return {
    id: `run-${role}`,
    approve: async () => {},
    status: async () => {
      calls.push(`status:${role}`);
      return hooks.status ? hooks.status() : { view: { phase: 'working' } };
    },
    complete: async (options = {}) => {
      calls.push(`pump:${role}`);
      return hooks.complete ? hooks.complete(options.signal ?? null) : undefined;
    },
    inspect: async () => (hooks.inspect ? hooks.inspect() : { section: { items: [] } }),
    stop: async (reason) => {
      calls.push(`stop:${role}`);
      return hooks.stop ? hooks.stop(reason) : {};
    },
  };
}

function facadeFor(calls, hooksByRole = {}) {
  return {
    runs: {
      start: async (objective, options) => memberHandle(options.waveRole, calls, hooksByRole[options.waveRole] ?? {}),
    },
  };
}

// A drive pump that ends only when its observer's signal aborts — the shape the wave must cancel.
function abortablePump(role, calls) {
  return (signal) => new Promise((resolve) => {
    if (!signal) { calls.push(`unbounded:${role}`); return; }
    if (signal.aborted) { calls.push(`abort:${role}`); resolve(); return; }
    signal.addEventListener('abort', () => { calls.push(`abort:${role}`); resolve(); }, { once: true });
  });
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('WAVE-OBSERVER: a hung member read never withholds a healthy peer and never outlives the budget', async () => {
  const calls = [];
  const wedged = deferred(); // alpha's status read never answers
  const betaObserved = deferred();
  const facade = facadeFor(calls, {
    alpha: { status: () => wedged.promise },
    beta: { status: async () => { betaObserved.resolve(); return { view: { phase: 'completed' } }; } },
  });
  const wave = await createWave(facade, { members: [member('alpha'), member('beta')] });

  let resolved = false;
  const startedAt = Date.now();
  const pending = wave.settle({ timeoutMs: 40 }).then((outcomes) => { resolved = true; return outcomes; });

  // beta's whole observation lands while alpha's read is still outstanding.
  await betaObserved.promise;
  assert.equal(resolved, false, 'settle does not resolve while alpha is unobserved');
  const outcomes = await pending;
  assert.ok(Date.now() - startedAt < 1_000,
    'the wedged read never holds the observation open beyond its budget');

  assert.deepEqual(outcomes.map(({ role }) => role), ['alpha', 'beta'],
    'the receipt is roster-ordered even when one member could not be observed');
  const [alpha, beta] = outcomes;
  assert.equal(alpha.phase, 'outcome_error', 'an unobserved member is given no phase it did not report');
  assert.equal(alpha.terminal, false, 'an observation failure never invents terminality');
  assert.deepEqual(alpha.error, { code: 'wave_observer_timeout', message: 'wave observer budget elapsed' },
    'the receipt names the observer budget, never a facade failure nobody observed');
  assert.equal(beta.phase, 'completed', 'the healthy peer is observed, not collateral');
  assert.equal(beta.terminal, true);
  assert.equal(calls.some((call) => call.startsWith('stop:')), false,
    'an observation budget is never authority to stop a member');
});

test('WAVE-OBSERVER: the receipt comes from inside the window — no read is started after it', async (t) => {
  const calls = [];
  const reads = [];
  const unhandled = [];
  const onUnhandled = (reason) => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.off('unhandledRejection', onUnhandled));
  let invocations = 0;
  const facade = facadeFor(calls, {
    alpha: {
      // First (and only) read inside the window wedges; a read started later would find the member
      // terminal — so a receipt that says `completed` would prove post-budget work.
      status: () => {
        invocations += 1;
        if (invocations === 1) {
          const read = deferred();
          reads.push(read);
          return read.promise;
        }
        return Promise.resolve({ view: { phase: 'completed' } });
      },
    },
  });
  const wave = await createWave(facade, { members: [member('alpha')] });
  const outcomes = await wave.settle({ timeoutMs: 30 });

  assert.equal(invocations, 1, 'the observation never starts a read after its deadline');
  assert.equal(outcomes[0].phase, 'outcome_error');
  assert.deepEqual(outcomes[0].error, { code: 'wave_observer_timeout', message: 'wave observer budget elapsed' });

  // The abandoned read fails AFTER its observation ended.
  reads[0].reject(Object.assign(new Error('late transport death'), { code: 'transport_closed' }));
  await flush();
  assert.deepEqual(unhandled, [], 'an abandoned read stays handled — no unhandled rejection escapes');
  assert.deepEqual(wave.evidence().outcomes[0].error,
    { code: 'wave_observer_timeout', message: 'wave observer budget elapsed' },
    'the late failure cannot mutate the settled receipt');

  // A fresh observation reads a fresh row, untainted by the abandoned read.
  const snapshot = await wave.progress();
  assert.equal(snapshot.members[0].phase, 'completed');
  assert.equal(snapshot.members[0].error, undefined, 'the refreshed row carries no stale failure');
});

test('WAVE-OBSERVER: ending the observation cancels its drive pump — the observer, never the worker', async () => {
  const calls = [];
  const pumping = deferred();
  const facade = facadeFor(calls, {
    alpha: {
      status: async () => ({ view: { phase: 'working' } }), // never resting: the member is driven
      complete: (signal) => { pumping.resolve(signal); return abortablePump('alpha', calls)(signal); },
    },
  });
  const wave = await createWave(facade, { members: [member('alpha')] });
  const outcomes = await wave.settle({ timeoutMs: 30 });

  const signal = await pumping.promise;
  assert.ok(signal, 'the drive pump was given an observer signal');
  assert.equal(signal.aborted, true, 'the observation cancelled the drive pump it armed');
  assert.equal(calls.filter((call) => call === 'abort:alpha').length, 1, 'the drive loop observed its abort');
  assert.equal(calls.filter((call) => call === 'pump:alpha').length, 1,
    're-arming inside one observation joins the drive, it never doubles it');
  assert.equal(wave.pumpQuiescent, true, 'a confirmed cancellation leaves no drive behind');
  assert.equal(outcomes[0].terminal, false, 'the member keeps its real, observed non-terminal phase');
  assert.equal(outcomes[0].error, undefined, 'an observation that saw the member carries no error');
  assert.equal(calls.some((call) => call.startsWith('stop:')), false,
    'cancelling the observer never stops the worker');
});

test('WAVE-OBSERVER: a hung read is not sticky — a later observation reads the member fresh', async () => {
  const calls = [];
  let wedged = true;
  const facade = facadeFor(calls, {
    alpha: {
      status: () => (wedged
        ? new Promise(() => {})
        : Promise.resolve({ view: { phase: 'completed', narrative: 'reported' } })),
    },
  });
  const wave = await createWave(facade, { members: [member('alpha')] });

  const first = await wave.settle({ timeoutMs: 30 });
  assert.equal(first[0].error.code, 'wave_observer_timeout');

  wedged = false;
  const second = await wave.settle({ timeoutMs: 5_000 });
  assert.notEqual(second[0], first[0], 'a repeated settle returns a fresh outcome object');
  assert.equal(second[0].phase, 'completed', 'the refreshed observation replaces the earlier failure');
  assert.equal(second[0].terminal, true);
  assert.equal(second[0].narrative, 'reported');
  assert.equal(second[0].error, undefined, 'the refreshed outcome carries no stale error');
  assert.equal(wave.evidence().outcomes[0].phase, 'completed', 'the handle ledger holds the refreshed outcome');
});

test('WAVE-OWNERSHIP: overlapping observations never cancel each other; the last owner releases the drive', async () => {
  const calls = [];
  const pumping = deferred();
  let phase = 'working';
  const facade = facadeFor(calls, {
    alpha: {
      status: async () => ({ view: { phase } }),
      complete: (signal) => { pumping.resolve(signal); return abortablePump('alpha', calls)(signal); },
    },
  });
  const wave = await createWave(facade, { members: [member('alpha')] });
  const shortObservation = wave.settle({ timeoutMs: 30 });
  const longObservation = wave.settle({ timeoutMs: 5_000 });

  const first = await shortObservation;
  assert.equal(first[0].terminal, false, 'a still-running member settles with its observed phase');
  assert.equal(calls.filter((call) => call === 'pump:alpha').length, 1,
    'one drive serves every overlapping observation');
  assert.equal(calls.includes('abort:alpha'), false,
    'an observation that ends does not cancel a drive a live observation still owns');

  phase = 'completed';
  const second = await longObservation;
  assert.equal(second[0].phase, 'completed');
  assert.equal(second[0].terminal, true);
  assert.equal(calls.includes('abort:alpha'), true, 'the last owner to release cancels the drive');
  assert.equal(wave.pumpQuiescent, true);
});

test('WAVE-CLOSE: close asks an outstanding drive to end before it stops the member', async () => {
  const calls = [];
  const pumping = deferred();
  let stopped = false;
  const facade = facadeFor(calls, {
    alpha: {
      status: async () => ({ view: { phase: stopped ? 'stopped' : 'working' } }),
      complete: (signal) => { pumping.resolve(signal); return abortablePump('alpha', calls)(signal); },
      stop: async () => {
        stopped = true;
        return { stop: 'stopped', outline: { resources: { state: 'closed', cleanupState: 'clean', ownedCount: 0 } } };
      },
    },
  });
  const wave = await createWave(facade, { members: [member('alpha')] });
  const observation = wave.settle({ timeoutMs: 5_000 });
  await pumping.promise; // the observation is driving the member

  const receipt = await wave.close({ reason: 'close cancels the observer pump' });
  assert.ok(calls.indexOf('abort:alpha') >= 0
    && calls.indexOf('abort:alpha') < calls.indexOf('stop:alpha'),
  'the drive loop is asked to end BEFORE the member is stopped — close does not stop under a drive');
  assert.equal(receipt.stops[0].ownedCount, 0);
  assert.equal(receipt.drivesCancelled, 1, 'the receipt accounts for the drive close asked to end');
  await flush();
  assert.equal(receipt.pumpQuiescent, true, 'a drive that honoured the abort is observed ended');
  assert.equal(wave.pumpQuiescent, true);

  const outcomes = await observation;
  assert.equal(outcomes[0].phase, 'stopped', 'the concurrent observation still reports the member truthfully');
});

test('WAVE-CLOSE: a drive that ignores the abort is reported as unconfirmed, not claimed closed', async () => {
  const calls = [];
  const pumping = deferred();
  let stopped = false;
  const facade = facadeFor(calls, {
    alpha: {
      status: async () => ({ view: { phase: stopped ? 'stopped' : 'working' } }),
      complete: () => { pumping.resolve(); return new Promise(() => {}); }, // ignores the signal
      stop: async () => {
        stopped = true;
        return { stop: 'stopped', outline: { resources: { state: 'closed', cleanupState: 'clean', ownedCount: 0 } } };
      },
    },
  });
  const wave = await createWave(facade, { members: [member('alpha')] });
  const observation = wave.settle({ timeoutMs: 5_000 });
  await pumping.promise;

  const receipt = await wave.close({ reason: 'close meets an abort-ignoring drive' });
  assert.equal(receipt.drivesCancelled, 1);
  assert.equal(receipt.pumpQuiescent, false,
    'cancellation is a request: an unconfirmed drive is reported, never assumed ended');
  assert.equal(wave.pumpQuiescent, false);

  await observation;
  assert.equal(wave.evidence().pumpDrained, false,
    'the evidence reports the outstanding drive instead of claiming an impossible closure');
});

test('WAVE-OBSERVER: a facade that ignores the abort keeps its cancelled drive visible', async () => {
  const calls = [];
  const facade = facadeFor(calls, {
    alpha: {
      status: async () => ({ view: { phase: 'working' } }),
      complete: () => new Promise(() => {}), // ignores the observer's signal entirely
    },
  });
  const wave = await createWave(facade, { members: [member('alpha')] });
  const outcomes = await wave.settle({ timeoutMs: 30 });

  assert.equal(outcomes[0].terminal, false);
  assert.equal(wave.pumpQuiescent, false, 'a drive that cannot confirm its end stays registered');
  assert.equal(wave.evidence().pumpDrained, false,
    'the receipt reports the uncertainty instead of an impossible closure claim');
  assert.equal(calls.some((call) => call.startsWith('stop:')), false);
});

test('WAVE-OWNERSHIP: a cancelled drive is retained, never replaced while it is unsettled', async () => {
  const calls = [];
  const firstDrive = deferred();
  const secondDrive = deferred();
  let invocations = 0;
  const facade = facadeFor(calls, {
    alpha: {
      status: async () => ({ view: { phase: 'working' } }),
      // Both drives ignore the abort signal: neither can confirm its own cancellation.
      complete: () => {
        invocations += 1;
        return invocations === 1 ? firstDrive.promise : secondDrive.promise;
      },
    },
  });
  const wave = await createWave(facade, { members: [member('alpha')] });

  await wave.settle({ timeoutMs: 20 });
  assert.equal(invocations, 1);
  assert.equal(wave.pumpQuiescent, false, 'the cancelled drive is outstanding: retained, not forgotten');

  await wave.settle({ timeoutMs: 20 });
  assert.equal(invocations, 1,
    'no second loop is started over the same run handle while the first has not settled');
  assert.equal(wave.pumpQuiescent, false);

  firstDrive.resolve({}); // the first drive finally settles
  await flush();
  assert.equal(wave.pumpQuiescent, true, 'the retired drive reaps itself once it actually settles');

  await wave.settle({ timeoutMs: 20 });
  assert.equal(invocations, 2, 'a drive is re-armed only after the earlier one actually settled');
  assert.equal(calls.filter((call) => call === 'pump:alpha').length, 2);
});

test('WAVE-OWNERSHIP: an earlier settle finishing late cannot overwrite a newer settle evidence', async () => {
  const calls = [];
  let polls = 0;
  const facade = facadeFor(calls, {
    alpha: { status: async () => ({ view: { phase: 'working', narrative: `poll-${(polls += 1)}` } }) },
  });
  const wave = await createWave(facade, { members: [member('alpha')] });

  const earlier = wave.settle({ timeoutMs: 200 });
  const later = wave.settle({ timeoutMs: 20 });
  const laterOutcomes = await later;
  const earlierOutcomes = await earlier;

  assert.notEqual(laterOutcomes[0].narrative, earlierOutcomes[0].narrative,
    'the earlier call observed the member again after the later call had published');
  assert.equal(wave.evidence().outcomes[0].narrative, laterOutcomes[0].narrative,
    'the ledger holds the later invocation evidence, not the earlier call that finished last');
});

test('WAVE-OBSERVER: a healthy member finishes and reports its result while a sibling stays hung', async () => {
  const calls = [];
  const wedged = deferred(); // alpha never answers, for the whole invocation
  const betaFirstRead = deferred();
  const betaSha = 'b'.repeat(40);
  let betaPhase = 'working';
  const facade = facadeFor(calls, {
    alpha: { status: () => wedged.promise },
    beta: {
      status: async () => {
        betaFirstRead.resolve();
        return { view: { phase: betaPhase } };
      },
      inspect: async () => ({ section: { items: [{ value: { sha: betaSha } }] } }),
    },
  });
  const wave = await createWave(facade, { members: [member('alpha'), member('beta')] });

  const startedAt = Date.now();
  const pending = wave.settle({ timeoutMs: 400 });
  await betaFirstRead.promise; // beta was observed while alpha is hung
  betaPhase = 'completed'; // beta finishes — and exposes its result — with alpha still hung
  const outcomes = await pending;

  const [alpha, beta] = outcomes;
  assert.equal(alpha.phase, 'outcome_error', 'the hung member is never given a phase it did not report');
  assert.deepEqual(alpha.error, { code: 'wave_observer_timeout', message: 'wave observer budget elapsed' });
  assert.equal(beta.phase, 'completed',
    'the healthy member keeps being observed on its own cadence — a hung sibling does not freeze it');
  assert.equal(beta.terminal, true);
  assert.equal(beta.resultSha, betaSha,
    'and its preserved result is observed inside the same budget');
  assert.equal(calls.filter((call) => call === 'status:alpha').length, 1,
    'the hung read is bounded once: its loop never spins');
  assert.equal(calls.filter((call) => call === 'pump:alpha').length, 0,
    'a member whose read never answered is never driven — no facade effect after the budget');
  assert.ok(Date.now() - startedAt < 2_000, 'the receipt returns with the invocation budget');
});

test('WAVE-SETTLE: a caller cancel during a hung result read detaches the observation', async () => {
  const calls = [];
  const inspecting = deferred();
  let inspects = 0;
  const facade = facadeFor(calls, {
    alpha: {
      status: async () => ({ view: { phase: 'completed' } }),
      inspect: () => {
        inspects += 1;
        inspecting.resolve();
        return new Promise(() => {}); // the result read never answers
      },
    },
  });
  const wave = await createWave(facade, { members: [member('alpha')] });

  const controller = new AbortController();
  const startedAt = Date.now();
  const pending = wave.settle({ timeoutMs: 5_000, signal: controller.signal });
  await inspecting.promise; // the result read is outstanding
  controller.abort();
  await assert.rejects(pending, (error) => error?.code === 'wave_observer_cancelled',
    'a cancellation during a result read ends the observation, it does not run out the budget');
  assert.ok(Date.now() - startedAt < 1_500,
    'the cancelled observation detached promptly rather than at the deadline');
  assert.equal(inspects, 1, 'an abandoned invocation starts no further facade effect');
  assert.equal(calls.some((call) => call.startsWith('stop:')), false);
});

test('WAVE-PROGRESS: a caller signal ends the observation as a typed cancelled observer', async () => {
  const calls = [];
  const reading = deferred();
  const facade = facadeFor(calls, {
    alpha: { status: () => reading.promise },
    beta: { status: async () => ({ view: { phase: 'working' } }) },
  });
  const wave = await createWave(facade, { members: [member('alpha'), member('beta')] });

  const controller = new AbortController();
  const observation = wave.progress({ signal: controller.signal });
  controller.abort();
  await assert.rejects(observation,
    (error) => error?.code === 'wave_observer_cancelled',
    'a cancelled observation is a typed refusal, never a partial snapshot passed off as a roster read');

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(wave.progress({ signal: alreadyAborted.signal }),
    (error) => error?.code === 'wave_observer_cancelled');

  await assert.rejects(wave.progress({ signal: 'not-a-signal' }), (error) => error?.code === 'wave_invalid');
  await assert.rejects(wave.progress({ unexpected: true }), (error) => error?.code === 'wave_invalid');

  // The abandoned read is consumed, and the same signal leaves no trace on a later observation.
  reading.reject(Object.assign(new Error('late transport death'), { code: 'transport_closed' }));
  await flush();
  const snapshot = await wave.progress({ signal: new AbortController().signal });
  assert.deepEqual(snapshot.members.map(({ role }) => role), ['alpha', 'beta'],
    'a fresh observation still observes the whole roster');
  assert.equal(snapshot.members[1].phase, 'working');
});

test('WAVE-SETTLE: a caller signal ends settle as a typed cancelled observer and leaves no drive', async () => {
  const calls = [];
  const pumping = deferred();
  const facade = facadeFor(calls, {
    alpha: {
      status: async () => ({ view: { phase: 'working' } }),
      complete: (signal) => { pumping.resolve(signal); return abortablePump('alpha', calls)(signal); },
    },
  });
  const wave = await createWave(facade, { members: [member('alpha')] });

  const controller = new AbortController();
  const pending = wave.settle({ timeoutMs: 5_000, signal: controller.signal });
  await pumping.promise;
  controller.abort();
  await assert.rejects(pending, (error) => error?.code === 'wave_observer_cancelled',
    'the caller cancelled the observation: settle refuses typed rather than reporting a partial receipt');
  assert.equal(calls.includes('abort:alpha'), true, 'the cancelled observation still ended its own drive');
  await flush();
  assert.equal(wave.pumpQuiescent, true);
  assert.equal(calls.some((call) => call.startsWith('stop:')), false,
    'a cancelled observation never stops the worker');

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(wave.settle({ signal: alreadyAborted.signal }),
    (error) => error?.code === 'wave_observer_cancelled');
  await assert.rejects(wave.settle({ signal: 'not-a-signal' }), (error) => error?.code === 'wave_invalid');
});
