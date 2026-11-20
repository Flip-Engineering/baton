export { BeeBus } from './bus.mjs';
export { BeeMutatorAdapter } from './mutator.mjs';
export { DEFAULT_LANES, planBag, startBag } from './bag.mjs';

export const name = 'baton-bees';

// Baton DSH-compatible plugin surface. This plugin intentionally does not
// override task admission or completion hooks; those remain Baton authority.
export function apply() {
  return undefined;
}
