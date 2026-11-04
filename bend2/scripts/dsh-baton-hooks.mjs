// Baton input and completion hooks for the DSH headless profile.
//
// The plugin also moves the Git configuration pairs the launcher exports into
// GIT_CONFIG_PARAMETERS. DSH removes environment names that contain KEY from
// the bash tool and keeps GIT_CONFIG_COUNT, so Git in that tool otherwise stops
// at the missing GIT_CONFIG_KEY_n entries.
//
// The tool patch mounts this file as a DSH plugin, so it runs inside the DSH
// host process, outside the process sandbox that confines the bash tool. It
// calls the retained Baton entry with the same `--stop-hook` protocol the
// Claude Code hooks use:
//   - before each model step, owed input is delivered into that step and its
//     read is recorded by the entry at delivery;
//   - when a turn is about to close, owed input and an open assignment without
//     a completion request keep the turn open through a steering message.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export const name = 'baton-hooks';

function configured(environment) {
  return Boolean(environment.BATON_STOP_HOOK && environment.BATON_DATABASE && environment.BATON_SESSION);
}

// Runs the entry for one hook event and returns its parsed JSON answer, or
// null when the entry prints nothing or fails. A failed entry lets the turn
// continue; the turn-end continuation and the coordinator report still cover
// owed input.
export function runHook(event, environment = process.env) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(environment.BATON_STOP_HOOK, ['--stop-hook'], { env: environment, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch { resolve(null); return; }
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; });
    child.on('error', () => resolve(null));
    child.on('close', () => {
      try { resolve(output.trim() ? JSON.parse(output) : null); } catch { resolve(null); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ hook_event_name: event }));
  });
}

// Complete owed bodies for this step, or an empty string.
export async function deliveredInput(environment = process.env) {
  const answer = await runHook('PostToolUse', environment);
  const text = answer?.hookSpecificOutput?.additionalContext;
  return typeof text === 'string' ? text : '';
}

// The gate's reason when the turn may not close, or an empty string.
export async function gateReason(environment = process.env) {
  const answer = await runHook('Stop', environment);
  return answer?.decision === 'block' && typeof answer.reason === 'string' ? answer.reason : '';
}

const COMPLETION_TOOL = 'In this session the completion request is the baton-worker completion_request tool; '
  + 'the report, ask, inbox and read tools replace the same-named Baton commands.';

function quoted(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

// Rewrites GIT_CONFIG_COUNT, GIT_CONFIG_KEY_n and GIT_CONFIG_VALUE_n in the
// given environment as GIT_CONFIG_PARAMETERS entries after any existing ones.
export function foldGitConfiguration(environment) {
  const count = /^[0-9]+$/.test(environment.GIT_CONFIG_COUNT ?? '') ? Number(environment.GIT_CONFIG_COUNT) : 0;
  const entries = [];
  for (let index = 0; index < count; index++) {
    const key = environment[`GIT_CONFIG_KEY_${index}`];
    const value = environment[`GIT_CONFIG_VALUE_${index}`];
    if (key !== undefined && value !== undefined) entries.push(`${quoted(key)}=${quoted(value)}`);
  }
  for (const key of Object.keys(environment)) {
    if (/^GIT_CONFIG_(KEY|VALUE)_[0-9]+$/.test(key)) delete environment[key];
  }
  delete environment.GIT_CONFIG_COUNT;
  if (entries.length) {
    environment.GIT_CONFIG_PARAMETERS = [environment.GIT_CONFIG_PARAMETERS, ...entries].filter(Boolean).join(' ');
  }
}

export function userMessage(text) {
  return { id: randomUUID(), role: 'user', content: [{ type: 'text', text }], source: { kind: 'baton' } };
}

export function apply(ctx) {
  foldGitConfiguration(process.env);
  if (!configured(process.env)) return;
  ctx.on('agent/pre-step', async ({ messages }, next) => {
    const decision = await next();
    if (decision.kind !== 'enter') return decision;
    const text = await deliveredInput();
    if (!text) return decision;
    return { ...decision, messages: [...decision.messages, userMessage(text)] };
  });
  ctx.on('agent/turn-stopping', async ({ agent }) => {
    const text = await deliveredInput();
    if (text) { agent.steer(userMessage(text)); return; }
    const reason = await gateReason();
    if (reason) agent.steer(userMessage(reason + '\n' + COMPLETION_TOOL));
  });
}
