import { setImmediate as immediate } from 'node:timers/promises';

import { resolveUnifiedSurfaceCommand } from './control-surface-unification.mjs';
import './production-cli-extensions.mjs';
import { decorateAttentionApplication } from './production-attention-authorization.mjs';
import {
  PRODUCTION_WORKFLOW_WEB_PORTS,
  executeProductionWorkflowWebPort,
} from './production-web-workflow-ports.mjs';
import { WebNorthbound } from './web-northbound.mjs';

const INSTALLED = Symbol.for('baton.productionWebConvergence.installed');
const NATIVE_WEB_QUERIES = new Set([
  'list', 'result', 'wait', 'capabilities', 'provider_status', 'goal_plan_status',
  'waves_progress', 'waves_list', 'waves_compile', 'deployment_doctor',
  'run_message_receipt', 'run_attention_watch', 'run_scratchpad_read', 'run_board_read',
]);

function modeFor(command) {
  const workflow = PRODUCTION_WORKFLOW_WEB_PORTS[command];
  if (workflow) return workflow.mode;
  try { return resolveUnifiedSurfaceCommand('web', command).mode; }
  catch (error) {
    if (error?.code !== 'command_unknown') throw error;
  }
  return NATIVE_WEB_QUERIES.has(command) ? 'query' : 'effect';
}

function admittedResponse(commandId) {
  return Object.freeze({
    status: 202,
    body: Object.freeze({ ok: true, commandId, status: 'admitted' }),
  });
}

async function convergedExecute(target, original, ctx, envelope) {
  if (target.application) {
    target.application = decorateAttentionApplication(target.application, { transport: 'web' });
  }
  const workflowPort = PRODUCTION_WORKFLOW_WEB_PORTS[envelope?.command];
  if (workflowPort) {
    return executeProductionWorkflowWebPort(target, ctx, envelope, workflowPort);
  }
  if (!envelope || modeFor(envelope.command) === 'query') return original(ctx, envelope);

  let settled = false;
  let settledValue;
  const dispatch = Promise.resolve().then(() => original(ctx, envelope));
  void dispatch.then(
    (value) => { settled = true; settledValue = value; },
    () => { settled = true; },
  );

  for (;;) {
    const command = target.coordination?.webCommand?.(envelope.commandId) ?? null;
    if (command?.status === 'admitted') {
      void dispatch.catch(() => {});
      return admittedResponse(command.commandId ?? envelope.commandId);
    }
    if (settled) return settledValue ?? dispatch;
    await immediate();
  }
}

/** Apply convergence to one WebNorthbound instance without mutating its class or other imports. */
export function decorateProductionWebNorthbound(northbound) {
  if (!northbound || typeof northbound.execute !== 'function') {
    throw new TypeError('WebNorthbound-compatible instance is required');
  }
  if (northbound[INSTALLED]) return northbound;
  const original = northbound.execute.bind(northbound);
  Object.defineProperty(northbound, INSTALLED, { value: true });
  northbound.execute = (ctx, envelope) => convergedExecute(northbound, original, ctx, envelope);
  return northbound;
}

/**
 * Explicit global opt-in for deployment factories that construct WebNorthbound internally.
 * Merely importing this module, the package root, or `baton/converged` performs no mutation.
 */
export function installProductionWebConvergence({ global = false } = {}) {
  if (global !== true) return false;
  if (WebNorthbound.prototype[INSTALLED]) return false;
  const original = WebNorthbound.prototype.execute;
  Object.defineProperty(WebNorthbound.prototype, INSTALLED, { value: true });
  WebNorthbound.prototype.execute = function productionConvergedExecute(ctx, envelope) {
    return convergedExecute(this, (nextCtx, nextEnvelope) => (
      original.call(this, nextCtx, nextEnvelope)
    ), ctx, envelope);
  };
  return true;
}
