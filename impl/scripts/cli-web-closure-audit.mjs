#!/usr/bin/env node

import { CLI_WEB_COMMANDS } from '../src/application-cli.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import '../src/production-cli-extensions.mjs';
import { PRODUCTION_WORKFLOW_WEB_PORTS } from '../src/production-web-workflow-ports.mjs';
import { webAdmittedCommandNames } from '../src/web-northbound.mjs';

const liveWeb = new Set(webAdmittedCommandNames());
const workflowPorts = new Set(Object.keys(PRODUCTION_WORKFLOW_WEB_PORTS));
const operationByKey = new Map(APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
  .map((operation) => [operation.key, operation]));
const applicationAliases = new Map(APPLICATION_SEMANTIC_REGISTRY.surfaceAliases
  .filter((alias) => alias.surface === 'application.commands')
  .map((alias) => [alias.name, alias.canonical]));

function candidates(command) {
  const canonical = applicationAliases.get(command) ?? command;
  const operation = operationByKey.get(canonical) ?? operationByKey.get(command) ?? null;
  return [...new Set([
    command,
    command.replaceAll('.', '_'),
    canonical,
    canonical.replaceAll('.', '_'),
    operation?.names?.web,
    ...(operation?.aliases ?? [])
      .filter((alias) => alias.surface === 'web')
      .map((alias) => alias.name),
  ].filter(Boolean))];
}

const rows = [...CLI_WEB_COMMANDS].sort().map((command) => {
  const names = candidates(command);
  const admitted = names.find((name) => liveWeb.has(name)) ?? null;
  const adapted = names.find((name) => workflowPorts.has(name)) ?? null;
  return Object.freeze({
    command,
    candidates: Object.freeze(names),
    path: adapted ? 'production_workflow_web_port' : admitted ? 'web_admission' : null,
    admittedName: adapted ?? admitted,
  });
});

const missing = rows.filter((row) => row.path === null);
if (missing.length > 0) {
  throw new Error(`cli-web-closure-audit: connected CLI commands have no live Web admission: ${missing
    .map((row) => `${row.command} [${row.candidates.join(', ')}]`).join('; ')}`);
}

const staleWorkflowPorts = [...new Set(Object.values(PRODUCTION_WORKFLOW_WEB_PORTS)
  .map((port) => port.application))]
  .filter((command) => !CLI_WEB_COMMANDS.has(command));
if (staleWorkflowPorts.length > 0) {
  throw new Error(`cli-web-closure-audit: workflow Web adapters no longer have connected CLI owners: ${staleWorkflowPorts.join(', ')}`);
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  connectedCliCommands: rows.length,
  directWebAdmissions: rows.filter((row) => row.path === 'web_admission').length,
  adaptedWorkflowAdmissions: rows.filter((row) => row.path === 'production_workflow_web_port').length,
  missing: [],
  rows,
}, null, 2)}\n`);
