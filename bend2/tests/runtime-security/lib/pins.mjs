// Historical expectation pins, selected by NAME.
//
// Contract: BATON_HISTORICAL_PIN names the pin. The optional
// BATON_HISTORICAL_CLOSURE_SHA256 must equal that pin's closureSha256; it is a
// cross-check, never the lookup key.
//
// review-verified-2026-10-05 is the closure this critic measured. The retained
// evidence holds digests for seven files only; the current producer closure
// additionally imports cdp-counter.mjs, whose historical digest was not
// retained. scopeComplete is therefore false and the run reports which executed
// modules are unverified for that era. Missing old hashes are not fabricated.
//
//   bootstrap.mjs             096263a4e99f3b254c6f852cec46086dec0e9eff96574bc7d1fe20843b46d157
//   bootstrap-admission.mjs   843f84e13f9ba960bf0a44bc2cce9fcc1f66fa00023be4f73c7f3cf876b1f35c
//   cdp-endpoint.mjs          0bb2e2eabe2cf8959672d039c8da76585cc0bbdd68eccee916eeef9d2f7ad609
//   cdp-intents.mjs           b79789d96c5318ac49f27c45c4a7336973f63a3e2a5bd7852776d20edd6aefdb
//   cdp-session.mjs           8a20c9347020c4d3c8fcb6d2c4a23adb4ff352c90f6954e435f7788389819c3d
//   cdp-state.mjs             2f10c04cd1816c08ba1586f8585e5c628f5f1d935fc63478497b1d5c8ac71f12
//   cdp-transport.mjs         251193dc8dcdb3137c085a76899af3816f07a2d0b6845ceb5d72c3f5cb8b1a18
//
// That era exposes admitRequest and a breakpoint intent; cdp-counter.mjs is not
// covered. No historical expectation is registered for endpoint-watch: the
// pre-fix stderr throw belongs to a revision this critic did not retain.

// Kept free of the env import so env.mjs can import HISTORICAL_PINS without a
// load-time cycle. The thrown value carries the same condition/detail fields.
function refusal(condition, detail) {
  const error = new Error(detail === undefined || detail === null ? condition : `${condition}: ${detail}`);
  error.name = 'EnvironmentRefusal';
  error.condition = condition;
  error.detail = detail === undefined ? null : detail;
  return error;
}

export const HISTORICAL_PINS = Object.freeze({
  'review-verified-2026-10-05': Object.freeze({
    closureSha256: 'edffa694953b8ba9d99b0833fdabe1651a7b0d52275baf073c119775b5d55018',
    scopeComplete: false,
    scopeFiles: Object.freeze([
      'bootstrap.mjs',
      'bootstrap-admission.mjs',
      'cdp-endpoint.mjs',
      'cdp-intents.mjs',
      'cdp-session.mjs',
      'cdp-state.mjs',
      'cdp-transport.mjs',
    ]),
    fixtures: Object.freeze(['bootstrap-exec', 'grants-admission']),
    unverifiedForEra: Object.freeze(['cdp-counter.mjs']),
    adapter: Object.freeze({ 'grants-admission': 'historical-adapter.mjs' }),
    description: 'bootstrap pre-exec validation gap and ungranted observation-path admission',
  }),
});

export function requirePin(environment, fixture) {
  if (environment.pin === null) {
    throw refusal('historicalPinMissing', 'BATON_HISTORICAL_PIN');
  }
  const pin = environment.pin;
  if (!pin.fixtures.includes(fixture)) {
    throw refusal('historicalPinNotRegisteredForFixture', `${fixture} @ ${environment.pinName}`);
  }
  return pin;
}
