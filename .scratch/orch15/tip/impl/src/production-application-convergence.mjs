import { BatonApplication } from './application.mjs';

const RUNTIME_BY_APPLICATION = new WeakMap();
const INSTALLED = Symbol.for('baton.productionApplicationConvergence.installed');

export function registerProductionApplicationRuntime(application, runtime) {
  if (!application || typeof application !== 'object'
    || !runtime || typeof runtime.observeApplicationCommand !== 'function') return false;
  RUNTIME_BY_APPLICATION.set(application, runtime);
  return true;
}

export function unregisterProductionApplicationRuntime(application, runtime = null) {
  if (!application || typeof application !== 'object') return false;
  if (runtime !== null && RUNTIME_BY_APPLICATION.get(application) !== runtime) return false;
  return RUNTIME_BY_APPLICATION.delete(application);
}

/**
 * Explicitly install one observation hook on Baton's existing application command authority.
 * Importing this module does not mutate BatonApplication. The original command remains the sole
 * validation, authorization, coordination and result authority.
 */
export function installProductionApplicationConvergence() {
  if (BatonApplication.prototype[INSTALLED]) return false;
  const original = BatonApplication.prototype.command;
  Object.defineProperty(BatonApplication.prototype, INSTALLED, { value: true });
  BatonApplication.prototype.command = async function convergedApplicationCommand(
    name, args, principal, context = null, options = null,
  ) {
    const result = await original.call(this, name, args, principal, context, options);
    const runtime = RUNTIME_BY_APPLICATION.get(this);
    if (runtime) {
      try {
        runtime.observeApplicationCommand({
          name, args, result, application: this, principal, context,
        });
      } catch (error) {
        try {
          runtime.journal.append('convergence.observation.failed', {
            command: name,
            code: error?.code ?? 'convergence_observation_failed',
          });
        } catch { /* the application result remains authoritative */ }
      }
    }
    return result;
  };
  return true;
}
