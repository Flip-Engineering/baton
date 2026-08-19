#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const implRoot = resolve(here, '..');
const root = mkdtempSync(join(tmpdir(), 'baton-package-smoke-'));
let packed = null;

function npm(args, cwd, options = {}) {
  return execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options,
  });
}

try {
  const packOutput = npm(['pack', '--silent'], implRoot).trim().split(/\r?\n/u).filter(Boolean);
  if (packOutput.length !== 1) throw new Error(`release-smoke: npm pack returned ${packOutput.length} package names`);
  packed = resolve(implRoot, packOutput[0]);
  if (!existsSync(packed)) throw new Error('release-smoke: packed archive is missing');

  npm(['init', '-y'], root);
  npm(['install', '--ignore-scripts', packed], root);
  const installedRoot = join(root, 'node_modules', 'baton');
  const pkg = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'));
  const expectedBins = Object.entries(pkg.bin ?? {});
  if (expectedBins.length === 0) throw new Error('release-smoke: installed package advertises no bins');
  for (const [name, relative] of expectedBins) {
    const path = join(installedRoot, relative);
    if (!existsSync(path)) throw new Error(`release-smoke: ${name} target is missing: ${relative}`);
  }

  const convergenceTarget = pkg.exports?.['./production-convergence'];
  if (typeof convergenceTarget !== 'string') throw new Error('release-smoke: production convergence export is not advertised');
  const convergenceModule = await import(pathToFileURL(join(installedRoot, convergenceTarget)).href);
  if (typeof convergenceModule.ProductionConvergenceRuntime !== 'function'
    || typeof convergenceModule.wrapProductionDeployment !== 'function') {
    throw new Error('release-smoke: production convergence export is incomplete');
  }
  const convergence = new convergenceModule.ProductionConvergenceRuntime({
    repoRoot: root, worktreeRoot: join(root, 'worktrees'),
  });
  if (convergence.audit().registryDigest.length !== 64) throw new Error('release-smoke: production convergence registry digest is invalid');

  const surfaceTarget = pkg.exports?.['./surface'];
  if (typeof surfaceTarget !== 'string') throw new Error('release-smoke: unified surface export is not advertised');
  const surfaceModule = await import(pathToFileURL(join(installedRoot, surfaceTarget)).href);
  const coverage = surfaceModule.assertUnifiedCapabilityCoverage?.();
  if (!coverage || coverage.missingCli.length !== 0 || coverage.missingMcp.length !== 0) {
    throw new Error('release-smoke: unified capability coverage is incomplete');
  }

  const resolutionTarget = pkg.exports?.['./surface-resolution'];
  if (typeof resolutionTarget !== 'string') throw new Error('release-smoke: complete surface resolution export is not advertised');
  const resolutionModule = await import(pathToFileURL(join(installedRoot, resolutionTarget)).href);
  const nameClosure = resolutionModule.assertSurfaceCapabilityNameClosure?.();
  const watch = resolutionModule.resolveSurfaceCapability?.('surface.watch');
  if (!nameClosure || nameClosure.unresolved.length !== 0
    || watch?.names?.mcp !== 'baton_surface_watch'
    || !resolutionModule.completeUnifiedCapabilityCatalog?.({ category: 'notifications' })
      .some((row) => row.id === 'surface.watch')) {
    throw new Error('release-smoke: complete surface resolution or watch capability is unavailable');
  }

  await import(pathToFileURL(join(installedRoot, 'src', 'production-cli-extensions.mjs')).href);
  const applicationCli = await import(pathToFileURL(join(installedRoot, 'src', 'application-cli.mjs')).href);
  const workflowPorts = await import(pathToFileURL(join(installedRoot, 'src', 'production-web-workflow-ports.mjs')).href);
  if (!applicationCli.CLI_WEB_COMMANDS?.has?.('run.debug')
    || workflowPorts.PRODUCTION_WORKFLOW_WEB_PORTS?.run_debug?.application !== 'run.debug'
    || !workflowPorts.PRODUCTION_WORKFLOW_WEB_PORTS.run_debug.fields.includes('limit')) {
    throw new Error('release-smoke: installed connected run.debug repair is unavailable');
  }
  for (const command of [
    'run_message_send', 'run_message_receipt', 'run_attention_watch',
    'run_scratchpad_read', 'run_scratchpad_elevate',
    'run_board_post', 'run_board_read', 'run_knowledge_seed',
  ]) {
    if (!workflowPorts.PRODUCTION_WORKFLOW_WEB_PORTS?.[command]) {
      throw new Error(`release-smoke: installed workflow Web adapter is missing ${command}`);
    }
  }

  const baton = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'baton.cmd' : 'baton');
  const help = spawnSync(baton, ['help'], { cwd: root, encoding: 'utf8' });
  if (help.status !== 0 || !/baton/iu.test(`${help.stdout}\n${help.stderr}`)) {
    throw new Error(`release-smoke: baton help failed with ${help.status}`);
  }
  const surfaceHelp = spawnSync(baton, ['surface', 'help'], { cwd: root, encoding: 'utf8' });
  if (surfaceHelp.status !== 0
    || !/control, observation, telemetry/iu.test(surfaceHelp.stdout)
    || !/surface watch RUN_ID/iu.test(surfaceHelp.stdout)) {
    throw new Error(`release-smoke: baton surface help failed with ${surfaceHelp.status}`);
  }
  const catalog = spawnSync(baton, ['surface', 'catalog', '--category', 'telemetry'], {
    cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  if (catalog.status !== 0 || !/"capabilities"/u.test(catalog.stdout) || !/"telemetry"/u.test(catalog.stdout)) {
    throw new Error(`release-smoke: packaged telemetry catalog failed with ${catalog.status}`);
  }
  const watchDescribe = spawnSync(baton, ['surface', 'describe', 'surface.watch'], {
    cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
  });
  if (watchDescribe.status !== 0 || !/"baton_surface_watch"/u.test(watchDescribe.stdout)) {
    throw new Error(`release-smoke: packaged watch description failed with ${watchDescribe.status}`);
  }
  const debugDescribe = spawnSync(baton, ['surface', 'describe', 'run.debug'], {
    cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
  });
  if (debugDescribe.status !== 0 || !/"run.debug"/u.test(debugDescribe.stdout)) {
    throw new Error(`release-smoke: packaged run.debug description failed with ${debugDescribe.status}`);
  }

  const mcp = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'baton-mcp.cmd' : 'baton-mcp');
  const mcpUsage = spawnSync(mcp, [], { cwd: root, encoding: 'utf8' });
  if (mcpUsage.status !== 2 || !/usage: baton-mcp/iu.test(`${mcpUsage.stdout}\n${mcpUsage.stderr}`)) {
    throw new Error(`release-smoke: baton-mcp usage contract failed with ${mcpUsage.status}`);
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    archive: basename(packed),
    bins: expectedBins.map(([name]) => name),
    convergence: true,
    unifiedCapabilities: coverage.totalCapabilities,
    completeCapabilityNames: nameClosure.names,
    notificationWatch: true,
    connectedRunDebug: true,
    workflowWebPorts: 8,
  })}\n`);
} finally {
  if (packed) rmSync(packed, { force: true });
  rmSync(root, { recursive: true, force: true });
}
