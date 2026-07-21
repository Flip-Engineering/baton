import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcpJsonRpcProcess } from '../src/acp-json-rpc-process.mjs';
import { projectCredentialTree } from '../src/credential-projection.mjs';

const APPROVED = ['config.toml', 'device_id', 'credentials/kimi-code.json', 'oauth/kimi-code'];
const sourceRoot = process.env.KIMI_SOURCE_HOME ?? join(homedir(), '.kimi-code');
const command = process.env.KIMI_CMD ?? join(sourceRoot, 'bin', 'kimi');
const root = mkdtempSync(join(tmpdir(), 'baton-kimi-probe-'));
const runtime = join(root, 'runtime');
const cwd = join(root, 'work');
for (const path of [runtime, cwd, join(root, 'home'), join(root, 'tmp')]) mkdirSync(path, { recursive: true, mode: 0o700 });

function identities() {
  return APPROVED.map((relativeFile) => {
    const path = join(sourceRoot, relativeFile);
    const stat = lstatSync(path);
    return {
      relativeFile,
      mode: stat.mode & 0o777,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      digest: createHash('sha256').update(readFileSync(path)).digest('hex'),
    };
  });
}

function optionSummary(option) {
  if (!option || typeof option !== 'object') return null;
  const choices = option.options ?? option.values ?? [];
  return {
    id: option.id ?? option.configId ?? null,
    type: option.type ?? null,
    currentValue: option.currentValue ?? option.value ?? null,
    choices: Array.isArray(choices)
      ? choices.map((choice) => typeof choice === 'object'
        ? { value: choice.value ?? choice.id ?? null, name: choice.name ?? choice.label ?? null }
        : { value: choice, name: null })
      : [],
  };
}

const before = identities();
let acp;
try {
  const projection = projectCredentialTree({ sourceRoot, targetRoot: runtime, relativeFiles: APPROVED });
  const notifications = [];
  const env = {};
  for (const key of ['PATH', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TZ']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  env.HOME = join(root, 'home');
  env.TMPDIR = join(root, 'tmp');
  env.KIMI_CODE_HOME = runtime;
  env.KIMI_DISABLE_TELEMETRY = '1';
  env.KIMI_CODE_NO_AUTO_UPDATE = '1';
  env.KIMI_CODE_BACKGROUND_KEEP_ALIVE_ON_EXIT = '0';
  acp = new AcpJsonRpcProcess({
    command, args: ['acp'], cwd, env, setupTimeoutMs: 10_000,
    sanitizeFrame: projection.redactProviderFrame,
    onNotification(method, params) {
      if (method === 'session/update' && params?.update?.sessionUpdate === 'config_option_update') {
        notifications.push(params.update);
      }
    },
  }).start();
  const initialized = await acp.request('initialize', {
    protocolVersion: 1,
    clientInfo: { name: 'baton-metadata-probe', version: '1' },
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  });
  await acp.request('authenticate', { methodId: 'login' });
  const created = await acp.request('session/new', { cwd, mcpServers: [] });
  const model = (created?.configOptions ?? []).find((option) => (option.id ?? option.configId) === 'model');
  const modelValue = model?.currentValue ?? model?.value;
  const setModelResult = await acp.request('session/set_config_option', {
    sessionId: created.sessionId, configId: 'model', value: modelValue,
  });
  process.stdout.write(`${JSON.stringify({
    agentInfo: initialized?.agentInfo ?? null,
    authMethodIds: (initialized?.authMethods ?? []).map((method) => method?.id).filter(Boolean),
    capabilities: initialized?.agentCapabilities ?? null,
    sessionIdPresent: typeof created?.sessionId === 'string' && created.sessionId.length > 0,
    configOptions: (created?.configOptions ?? []).map(optionSummary).filter(Boolean),
    setModelResult,
    configUpdateNotifications: notifications,
  }, null, 2)}\n`);
} finally {
  if (acp) await acp.kill();
  const after = identities();
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    process.stderr.write('global Kimi subscription metadata changed during isolated probe\n');
    process.exitCode = 2;
  }
  rmSync(root, { recursive: true, force: true });
}
