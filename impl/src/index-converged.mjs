export * from './index.mjs';
export * as SurfaceCatalog from './surface-capability-catalog.mjs';
export * as SurfaceResolution from './surface-capability-resolution.mjs';
export * as SurfaceCli from './surface-cli.mjs';

import { openBaton as openRawBaton } from './index.mjs';
import { callConfiguredMcpTool, createConfiguredMcpServer } from './configured-mcp-client.mjs';
import { installProductionApplicationConvergence } from './production-application-convergence.mjs';
import {
  ProductionConvergenceRuntime,
  createProductionCommandRegistry,
  wrapProductionClient,
  wrapProductionDeployment,
} from './production-deployment-convergence.mjs';
import { wrapProductionCliClient } from './production-cli-convergence.mjs';
import { wrapProductionMcpServer } from './production-mcp-complete.mjs';
import { installProductionWebConvergence } from './production-web-convergence.mjs';

/**
 * Explicit opt-in deployment factory. Importing either `baton` or `baton/converged` is inert;
 * convergence hooks are installed only when this factory is called.
 */
export async function openConvergedBaton(options = {}) {
  installProductionApplicationConvergence();
  installProductionWebConvergence({ global: true });
  const deployment = await openRawBaton(options);
  return wrapProductionDeployment(deployment, {
    repoRoot: options.repo ?? process.cwd(),
  });
}

export {
  ProductionConvergenceRuntime,
  callConfiguredMcpTool,
  createConfiguredMcpServer,
  createProductionCommandRegistry,
  installProductionApplicationConvergence,
  installProductionWebConvergence,
  wrapProductionClient,
  wrapProductionDeployment,
  wrapProductionCliClient,
  wrapProductionMcpServer,
};
