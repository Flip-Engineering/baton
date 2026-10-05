// Historical expectation pins.
//
// A historical reproduction is valid only against the exact frozen producer
// closure it was observed on. The closure digest is sha256 over the sorted
// `name:digest` lines of the seven producer files (see lib/env.mjs). A fixture
// runs a historical expectation only when the admitted closure digest equals
// the named pin; otherwise it refuses rather than mixing source eras.
//
// review-verified-2026-10-05 is the closure this critic measured:
//   bootstrap.mjs             096263a4e99f3b254c6f852cec46086dec0e9eff96574bc7d1fe20843b46d157
//   bootstrap-admission.mjs   843f84e13f9ba960bf0a44bc2cce9fcc1f66fa00023be4f73c7f3cf876b1f35c
//   cdp-endpoint.mjs          0bb2e2eabe2cf8959672d039c8da76585cc0bbdd68eccee916eeef9d2f7ad609
//   cdp-intents.mjs           b79789d96c5318ac49f27c45c4a7336973f63a3e2a5bd7852776d20edd6aefdb
//   cdp-session.mjs           8a20c9347020c4d3c8fcb6d2c4a23adb4ff352c90f6954e435f7788389819c3d
//   cdp-state.mjs             2f10c04cd1816c08ba1586f8585e5c628f5f1d935fc63478497b1d5c8ac71f12
//   cdp-transport.mjs         251193dc8dcdb3137c085a76899af3816f07a2d0b6845ceb5d72c3f5cb8b1a18
//
// That closure already contains the endpoint failure-channel fix, so no
// historical expectation is registered for endpoint-watch: the pre-fix stderr
// throw is attributed to a source revision this critic did not retain a digest
// for, and asserting it against any closure would mix eras.

import { EnvironmentRefusal } from './env.mjs';

export const HISTORICAL_PINS = Object.freeze({
  'review-verified-2026-10-05': Object.freeze({
    closureSha256: 'edffa694953b8ba9d99b0833fdabe1651a7b0d52275baf073c119775b5d55018',
    fixtures: Object.freeze(['bootstrap-exec', 'grants-admission']),
    description: 'bootstrap pre-exec validation gap and ungranted observation-path admission',
  }),
});

// Resolve the historical expectation for one fixture against the admitted
// closure, or refuse.
export function historicalExpectation(environment, fixture) {
  const pin = environment.historicalPin;
  if (pin === null) {
    throw new EnvironmentRefusal('historicalPinMissing', 'BATON_HISTORICAL_CLOSURE_SHA256');
  }
  const entry = HISTORICAL_PINS[pin];
  if (entry === undefined) {
    throw new EnvironmentRefusal('historicalPinUnknown', pin);
  }
  if (!entry.fixtures.includes(fixture)) {
    throw new EnvironmentRefusal('historicalPinNotRegisteredForFixture', `${fixture} @ ${pin}`);
  }
  if (environment.closureSha256 !== entry.closureSha256) {
    throw new EnvironmentRefusal('historicalPinMismatch',
      `expected ${entry.closureSha256} observed ${environment.closureSha256}`);
  }
  return entry;
}
