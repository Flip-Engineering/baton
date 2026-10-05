// Historical API adapter.
//
// The historical expectation targets a producer surface that no longer exists:
// `admitRequest(record, method)` and a `breakpoint` entry in `INTENT_TABLE`.
// The current surface is `admitReadRequest` / `admitControlRequest` and an
// intent table without `breakpoint`. This adapter probes the historical surface
// only, and refuses when the module does not expose it, so a historical run
// cannot silently fall through to the current API and pass.

import { EnvironmentRefusal } from './env.mjs';

export function historicalApiPresent(module_) {
  return typeof module_.admitRequest === 'function';
}

export function requireHistoricalApi(module_, pinName) {
  if (!historicalApiPresent(module_)) {
    throw new EnvironmentRefusal('historicalAdapterUnsupported',
      `${pinName} expects admitRequest, absent in this closure`);
  }
  return module_;
}

// Observations on the historical send path. Intents are read from the module's
// own table, which the historical closure exposes.
export function historicalSendObservations(module_, { running, waiting, pending }) {
  const { admitRequest } = module_;
  const table = module_.INTENT_TABLE ?? {};
  const conditionParams = {
    action: 'setByUrl',
    url: 'file:///tmp/fixture.js',
    lineNumber: 3,
    condition: '(globalThis.__baton_condition_ran = true, false)',
  };
  let breakpointRequest = null;
  try {
    breakpointRequest = module_.requestForIntent('breakpoint', conditionParams);
  } catch (error) {
    breakpointRequest = { threw: error.condition ?? String(error) };
  }
  return {
    waitState: admitRequest(waiting, 'Runtime.runIfWaitingForDebugger'),
    workerDetach: admitRequest(running, 'NodeWorker.detach'),
    waitStateWhilePending: admitRequest(pending, 'Runtime.runIfWaitingForDebugger'),
    breakpointRequest,
    breakpointTableEffects: table.breakpoint === undefined ? null : table.breakpoint.effects,
  };
}
