import { CLI_WEB_COMMANDS } from './application-cli.mjs';

/**
 * Production connected-CLI additions whose application implementation and parser already existed,
 * but whose resident Web route was previously missing. The exported list is consumed by the
 * catalogue and closure audit; mutating the established Set keeps BatonWebClient.command() as the
 * single connected-CLI admission seam.
 */
export const PRODUCTION_CONNECTED_CLI_COMMANDS = Object.freeze([
  'run.debug',
]);

for (const command of PRODUCTION_CONNECTED_CLI_COMMANDS) CLI_WEB_COMMANDS.add(command);
