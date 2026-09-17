// cli-adapters.test.mjs — structural tests for the real subprocess adapters. NO live CLI is
// invoked (spawn is guarded behind live:true), so these cost zero quota. Parsers are checked
// against REAL captured output lines from `codex exec --json` and `claude -p --output-format
// stream-json` (captured 2026-07-10).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import {
  CodexCli, ClaudeCli, ZCodeCli, PiCli, CLI_ADAPTERS,
  parseCodexEvent, parseClaudeEvent, renderPrompt,
} from '../src/cli-adapters.mjs';
import { assertIsAdapter, renderBrief } from '../src/adapter.mjs';

// Real captured lines (verbatim shapes).
const CODEX_LINES = [
  { type: 'thread.started', thread_id: '019f4b9a' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'HELLO' } },
  { type: 'turn.completed', usage: { input_tokens: 18089, output_tokens: 6 } },
];
const CLAUDE_LINES = [
  { type: 'system', subtype: 'init', session_id: 's1', cwd: '/tmp' },
  { type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }] } },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'HELLO' }], usage: { output_tokens: 3 } } },
  { type: 'result', subtype: 'success', is_error: false, result: 'HELLO', total_cost_usd: 0.01, usage: { output_tokens: 3 } },
];
const FAKE_CLI_ENV = fileURLToPath(new URL('./fixtures/fake-cli-env.mjs', import.meta.url));

// ---------- codex parser ----------

test('parseCodexEvent maps the real event stream: turn.started->turn_started, agent_message->message, turn.completed->terminal', () => {
  const out = CODEX_LINES.map((o) => parseCodexEvent(o, 'w1', 'codex@0.144.0', 1));
  assert.equal(out[0].event, undefined, 'thread.started is not surfaced');
  assert.equal(out[1].event.kind, 'lifecycle.turn_started');
  assert.equal(out[2].event.kind, 'content.message');
  assert.equal(out[2].message, 'HELLO');
  assert.equal(out[3].terminal, true);
  assert.equal(out[3].event.kind, 'lifecycle.turn_completed');
  assert.equal(out[3].event.payload.result.status, 'completed');
  assert.equal(out[3].event.worker, 'w1');
  assert.deepEqual(out[2].events.map((event) => event.kind), ['resource.provider_call', 'content.message']);
  assert.deepEqual(out[2].events[0].payload, { callId: 'item_0', phase: 'completed' });
});

test('one-shot usage is emitted before terminal with a matching explicit counter and truthful availability seal', () => {
  const codex = parseCodexEvent({ type: 'turn.completed', usage: { input_tokens: 7, output_tokens: 3 } }, 'w1', 'codex', 4);
  assert.equal(codex.beforeTerminal[0].kind, 'resource.tokens');
  assert.deepEqual(codex.beforeTerminal[0].payload, {
    source: 'result', accounting: 'delta', tokens: 10,
    counterId: 'cli:w1:4', tokenMetric: 'codex_turn_input_plus_output_tokens',
  });
  assert.deepEqual(codex.event.payload.usageSeal, {
    tokens: 'reported', usd: 'unavailable', counterId: 'cli:w1:4',
    tokenMetric: 'codex_turn_input_plus_output_tokens',
  });

  const missing = parseCodexEvent({ type: 'turn.completed', usage: { output_tokens: 3 } }, 'w1', 'codex', 5);
  assert.deepEqual(missing.beforeTerminal, []);
  assert.deepEqual(missing.event.payload.usageSeal, {
    tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null,
  });
});

test('one-shot usage never rounds inexact USD or emits an unsafe token sum', () => {
  const mixed = parseClaudeEvent({
    type: 'result', subtype: 'success', is_error: false, result: 'mixed',
    usage: { input_tokens: 10, output_tokens: 11 }, total_cost_usd: 0.1000000001,
  }, 'w1', 'claude', 6);
  assert.equal(mixed.beforeTerminal.length, 1);
  assert.deepEqual(mixed.beforeTerminal[0].payload, {
    source: 'result', accounting: 'delta', tokens: 21,
    counterId: 'cli:w1:6', tokenMetric: 'anthropic_input_plus_output_tokens_excluding_cache',
  });
  assert.deepEqual(mixed.event.payload.usageSeal, {
    tokens: 'reported', usd: 'unavailable', counterId: 'cli:w1:6',
    tokenMetric: 'anthropic_input_plus_output_tokens_excluding_cache',
  });
  assert.deepEqual(mixed.event.payload.result.budgetUsed, { tokens: 21, usd: 0 });

  const overflow = parseCodexEvent({
    type: 'turn.completed', usage: { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1 },
  }, 'w2', 'codex', 7);
  assert.deepEqual(overflow.beforeTerminal, []);
  assert.deepEqual(overflow.event.payload.usageSeal, {
    tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null,
  });
  assert.deepEqual(overflow.event.payload.result.budgetUsed, { tokens: 0, usd: 0 });
});

test('parseCodexEvent surfaces command_execution and file_change items, and treats turn.failed/error as a crash', () => {
  const cmd = parseCodexEvent({ type: 'item.completed', item: { type: 'command_execution', command: 'ls', exit_code: 0 } }, 'w1', 'codex', 1);
  assert.equal(cmd.event.kind, 'content.tool_call');
  const edit = parseCodexEvent({ type: 'item.completed', item: { type: 'file_change', changes: [] } }, 'w1', 'codex', 1);
  assert.equal(edit.event.kind, 'content.file_edit');
  const failed = parseCodexEvent({ type: 'turn.failed', error: { message: 'boom' } }, 'w1', 'codex', 1);
  assert.equal(failed.crashed, true);
  assert.equal(failed.event.kind, 'lifecycle.crashed');
});

// ---------- claude parser ----------

test('parseClaudeEvent maps the real stream: system.init->turn_started, assistant text->message, result success->terminal', () => {
  const out = CLAUDE_LINES.map((o) => parseClaudeEvent(o, 'w1', 'claude@2.1', 1));
  assert.equal(out[0].event.kind, 'lifecycle.turn_started');
  assert.equal(out[1].event, undefined, 'a thinking-only assistant message is not surfaced');
  assert.equal(out[2].event.kind, 'content.message');
  assert.equal(out[2].message, 'HELLO');
  assert.equal(out[3].terminal, true);
  assert.equal(out[3].event.kind, 'lifecycle.turn_completed');
  assert.equal(out[3].event.payload.result.summary, 'HELLO');
});

test('parseClaudeEvent: an is_error result is a crash; a tool_use assistant message is a tool_call', () => {
  const err = parseClaudeEvent({ type: 'result', is_error: true, result: 'failed', subtype: 'error' }, 'w1', 'claude', 1);
  assert.equal(err.crashed, true);
  const tool = parseClaudeEvent({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { path: 'a' } }] } }, 'w1', 'claude', 1);
  assert.equal(tool.event.kind, 'content.tool_call');
  assert.equal(tool.event.payload.name, 'Edit');
});

test('parseClaudeEvent preserves text plus every tool_use with stable logical call ids and phases', () => {
  const parsed = parseClaudeEvent({
    type: 'assistant',
    message: {
      id: 'msg-native',
      content: [
        { type: 'text', text: 'working' },
        { type: 'tool_use', id: 'tool-a', name: 'Read', input: { path: 'a' } },
        { type: 'tool_use', id: 'tool-b', name: 'Edit', input: { path: 'b' } },
      ],
    },
  }, 'w1', 'claude', 2);
  assert.deepEqual(parsed.events.map((event) => event.kind), [
    'resource.provider_call', 'content.message', 'content.tool_call', 'content.tool_call',
  ]);
  assert.deepEqual(parsed.events[0].payload, { callId: 'msg-native', phase: 'completed' });
  assert.deepEqual(parsed.events.slice(2).map((event) => [event.payload.callId, event.payload.phase]), [
    ['tool-a', 'requested'], ['tool-b', 'requested'],
  ]);
});

// ---------- cards + conformance ----------

test('all CLI adapters conform to the session Adapter interface', () => {
  assert.doesNotThrow(() => assertIsAdapter(new CodexCli()));
  assert.doesNotThrow(() => assertIsAdapter(new ClaudeCli()));
  assert.doesNotThrow(() => assertIsAdapter(new ZCodeCli()));
  assert.doesNotThrow(() => assertIsAdapter(new PiCli()));
});

test('cards report the right harness identity and concurrency; no ceiling is configured unless declared', () => {
  assert.equal(new CodexCli().card().harness, 'codex');
  assert.equal(new ClaudeCli().card().harness, 'claude-code');
  const z = new ZCodeCli().card();
  assert.equal(z.harness, 'glm-via-claude');
  assert.equal(z.concurrencyCeiling, null,
    'no configured limit by default — the Z.ai in-flight constraint is a deployment declaration, never a class default');
  assert.equal(new ZCodeCli({ ceiling: 1 }).card().concurrencyCeiling, 1,
    'an explicitly configured ceiling is preserved verbatim');
  assert.equal(new CodexCli().card().verbs.interrupt, 'emulated');
  assert.deepEqual(new CodexCli().card().governance.usage, {
    tokens: 'native', usd: 'unavailable', tokenMetric: 'codex_turn_input_plus_output_tokens', terminalSeal: 'native',
  });
  assert.deepEqual(new ClaudeCli().card().governance.providerCalls, { observation: 'native', enforcement: 'unavailable' });
  assert.deepEqual(new PiCli().card().governance.usage, { tokens: 'unavailable', usd: 'unavailable', tokenMetric: null, terminalSeal: 'native' });
  assert.deepEqual(new CodexCli({ model: 'gpt-5.6-sol' }).card().modelSelection.configuredDefault, 'gpt-5.6-sol');
  assert.deepEqual(new ClaudeCli({ model: 'opus' }).card().modelSelection.reasoningEffort, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(new ZCodeCli({ model: 'glm-5.2' }).card().modelSelection.family, 'glm');
});

test('Z-Code injects the Z.ai Anthropic-compatible endpoint into the child env', () => {
  const z = new ZCodeCli({ authToken: 'test-key', model: 'glm-5.2' });
  assert.equal(z._cfg.env.ANTHROPIC_BASE_URL, 'https://api.z.ai/api/anthropic');
  assert.equal(z._cfg.env.ANTHROPIC_AUTH_TOKEN, 'test-key');
  assert.equal(z._cfg.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'glm-5.2');
});

test('argv: one-shot workers default to approval-free operation and disclose route-specific containment', () => {
  const cargs = new CodexCli()._cfg.args({});
  assert.ok(cargs.includes('exec') && cargs.includes('--json') && cargs.includes('danger-full-access'));
  assert.deepEqual(cargs.slice(cargs.indexOf('--ask-for-approval'), cargs.indexOf('--ask-for-approval') + 2), ['--ask-for-approval', 'never']);
  assert.ok(cargs.indexOf('--ask-for-approval') < cargs.indexOf('exec'));
  const clargs = new ClaudeCli()._cfg.args({});
  assert.ok(clargs.includes('-p') && clargs.includes('stream-json') && clargs.includes('bypassPermissions'));
  assert.deepEqual(new CodexCli().card().permissions, {
    mode: 'never', sandbox: 'danger-full-access', boundary: 'Unattended full host permissions by default; containment is a separate deployment boundary',
  });
  assert.deepEqual(new ClaudeCli().card().permissions, {
    mode: 'bypassPermissions', sandbox: 'unverified',
    boundary: 'Full same-UID host access by default; filesystem and network containment are unverified',
  });
});

test('one-shot workers honor RuntimeIsolation replacement env without inheriting ambient host state', async () => {
  const originalPoison = process.env.BATON_AMBIENT_POISON;
  process.env.BATON_AMBIENT_POISON = 'must-not-cross';
  try {
    const adapter = new PiCli({
      cmd: process.execPath, args: () => [FAKE_CLI_ENV], live: true,
      env: { BATON_ADAPTER_ONLY: 'adapter' },
    });
    const terminal = new Promise((resolve) => adapter.onEvent((event) => {
      if (event.kind === 'lifecycle.turn_completed') resolve(event);
    }));
    const ack = await adapter.spawn('runtime-env-worker', {
      goal: 'observe the child environment', constraints: [], pathScope: ['**'],
      definitionOfDone: 'environment observed', verification: { command: 'true', expectExit: 0 },
    }, {
      live: true, worktree: '/tmp', replaceEnv: true,
      env: { PATH: process.env.PATH, HOME: '/private/baton-home', BATON_RUNTIME_ONLY: 'runtime' },
    });
    assert.equal(ack.ok, true);
    const event = await terminal;
    assert.deepEqual(JSON.parse(event.payload.result.summary), {
      home: '/private/baton-home', runtimeOnly: 'runtime', adapterOnly: 'adapter', ambientPoison: null,
    });
  } finally {
    if (originalPoison === undefined) delete process.env.BATON_AMBIENT_POISON;
    else process.env.BATON_AMBIENT_POISON = originalPoison;
  }
});

test('one-shot workers preserve explicit narrower permission overrides', () => {
  const codex = new CodexCli({ sandbox: 'read-only', approvalPolicy: 'untrusted' });
  assert.deepEqual(codex.card().permissions, {
    mode: 'untrusted', sandbox: 'read-only', boundary: 'Harness sandbox requested; its containment remains separately attested',
  });
  assert.deepEqual(codex._cfg.args({}).slice(0, 5), ['--ask-for-approval', 'untrusted', '--sandbox', 'read-only', 'exec']);
  const claude = new ClaudeCli({ permissionMode: 'acceptEdits' });
  assert.equal(claude.card().permissions.mode, 'acceptEdits');
  const argv = claude._cfg.args({});
  assert.equal(argv[argv.indexOf('--permission-mode') + 1], 'acceptEdits');
  assert.equal(new ZCodeCli({ permissionMode: 'acceptEdits' }).card().permissions.mode, 'acceptEdits');
});

test('one-shot argv binds each coordinator-selected model and effort instead of constructor defaults', () => {
  const codex = new CodexCli({ model: 'constructor-model' })._cfg.args({}, { model: 'gpt-5.6-sol', reasoningEffort: 'low' });
  assert.deepEqual(codex.slice(codex.indexOf('-m')), ['-m', 'gpt-5.6-sol', '-c', 'model_reasoning_effort="low"']);
  const claude = new ClaudeCli({ model: 'constructor-model' })._cfg.args({}, { model: 'claude-opus-4-6', reasoningEffort: 'low' });
  assert.deepEqual(claude.slice(claude.indexOf('--model')), ['--model', 'claude-opus-4-6', '--effort', 'low']);
  const glm = new ZCodeCli({ model: 'constructor-model' })._cfg.args({}, { model: 'glm-5.2', reasoningEffort: 'low' });
  assert.deepEqual(glm.slice(glm.indexOf('--model')), ['--model', 'glm-5.2', '--effort', 'low']);
});

// ---------- the live guard + Pi placeholder ----------

test('spawn() with live:false refuses to launch a real CLI (never spends quota by accident)', async () => {
  const ack = await new CodexCli().spawn('w1', { goal: 'x', verification: { command: 'true', expectExit: 0 } }, { live: false, worktree: '/tmp' });
  assert.equal(ack.ok, false);
  assert.match(ack.reason, /live:false/);
});

test('PiCli is an inert placeholder until configured with a real command', async () => {
  const bare = new PiCli();
  assert.equal(bare.card().verbs.spawn, 'unsupported');
  const ack = await bare.spawn('w1', {}, { live: true, worktree: '/tmp' });
  assert.equal(ack.ok, false, 'unconfigured Pi refuses to spawn');
  const configured = new PiCli({ cmd: 'pi', args: () => ['run'] });
  assert.equal(configured.card().verbs.spawn, 'native');
});

// ---------- prompt rendering ----------

test('renderPrompt puts the pinned verification command in the brief so the worker aims at the real check', () => {
  const p = renderPrompt({ goal: 'add rate limiting', constraints: ['no deps'], pathScope: ['src/**'], definitionOfDone: 'tests pass', verification: { command: 'npm test', expectExit: 0 } });
  assert.match(p, /add rate limiting/);
  assert.match(p, /npm test/);
  assert.match(p, /src\/\*\*/);
});

test('renderPrompt gives Claude-family providers the complete structured verifier argv', () => {
  const p = renderPrompt({
    goal: 'validate the implementation', constraints: [], pathScope: ['impl/**'],
    definitionOfDone: 'the focused suite passes',
    verification: { command: 'npm', arguments: ['test', '--prefix', 'impl'], cwd: '.', expectExit: 0 },
  });
  assert.match(p, /direct executable and argv \(no shell\)/u);
  assert.match(p, /Executable \(JSON string\): "npm"/u);
  assert.ok(p.includes('Arguments (JSON array, in order): ["test","--prefix","impl"]'));
  assert.doesNotMatch(p, /check your work: `npm`/u);
});

test('renderPrompt carries the same delegation guidance as the brief (#275)', () => {
  const base = { goal: 'add rate limiting', constraints: [], pathScope: ['src/**'], definitionOfDone: 'tests pass', verification: { command: 'npm test', expectExit: 0 } };
  assert.match(renderPrompt({ ...base, tools: ['baton_swarm_recruit'] }), /Delegation: recruit through the Baton swarm surface listed here \(swarm\.recruit\)/u);
  assert.match(renderPrompt({ ...base, tools: [] }), /native subagents are observed by Baton but not governed by it/u);
});

test('renderPrompt decides the control-surface paragraph by registry membership of the advertised tools, never by substring (#267)', () => {
  const base = {
    goal: 'Review only the attached slice', constraints: [], pathScope: ['review.md'], definitionOfDone: 'one finding',
    verification: { command: 'node --test settlement.test.mjs', expectExit: 0 },
    contextInput: { callId: `context-call:${'b'.repeat(64)}`, unitId: `context-unit:${'a'.repeat(64)}`, value: { content: 'slice' } },
  };
  assert.match(renderPrompt({ ...base, tools: ['baton_swarm_view'] }), /Orchestration actions may use only the Baton control surface/u);
  assert.match(renderPrompt({ ...base, tools: [{ name: 'fleet_swarm_view' }] }), /Orchestration actions may use only the Baton control surface/u);
  const lookalike = renderPrompt({ ...base, tools: ['my-baton-helper'] });
  assert.match(lookalike, /Do not search for or launch another Baton CLI, MCP server, or Run/u);
  assert.doesNotMatch(lookalike, /Orchestration actions may use only/u);
});

test('renderPrompt makes a generic Context unit self-describing before repository and verification guidance', () => {
  const unitId = `context-unit:${'a'.repeat(64)}`;
  const p = renderPrompt({
    goal: 'Review only the attached settlement slice', constraints: [], pathScope: ['review.md'],
    definitionOfDone: 'write one grounded finding',
    verification: { command: 'node --test settlement.test.mjs', expectExit: 0 },
    contextInput: {
      callId: `context-call:${'b'.repeat(64)}`, unitId,
      value: { path: 'impl/src/coordination-store.mjs', content: 'selected immutable slice' },
    },
  });
  assert.match(p, new RegExp(`Unit: ${unitId}`, 'u'));
  assert.doesNotMatch(p, /Partition: undefined/u);
  assert.match(p, /Use the attached value directly/u);
  assert.match(p, /already dispatched and supervised by Baton/u);
  assert.match(p, /attached immutable Context is the complete task input/u);
  assert.match(p, /Writing a named output path does not authorize reading/u);
  assert.match(p, /Do not search for or launch another Baton CLI, MCP server, or Run/u);
  assert.match(p, /do not substitute it for analyzing the attached Context/u);
  assert.ok(p.indexOf('Attached immutable Context') < p.indexOf('Work only within'));
  assert.ok(p.indexOf('selected immutable slice') < p.indexOf('node --test settlement.test.mjs'));
});

// ---------- the `cli` dialect is the ONE brief renderer (A-F1/A-I1, A-F2/A-I2, A-F3, A-F4, A-N4) ----------

/** The brief this tier received, which used to carry none of its authority sections. */
function makePromptBrief(overrides = {}) {
  return {
    goal: 'add rate limiting',
    constraints: ['no new dependencies'],
    pathScope: ['impl/src/**'],
    definitionOfDone: 'the focused suite passes',
    verification: { command: 'npm', arguments: ['test', '--prefix', 'impl'], cwd: '.', expectExit: 0 },
    budget: { tokens: 120000, usd: 4.5, wallMin: 45 },
    tools: ['baton_swarm_view'],
    effects: [],
    requiredEffects: [],
    outputFormat: 'one paragraph, no headings',
    knowledge: {
      items: [{
        ref: 'finding:live', validFrom: '2026-09-01', validTo: '2026-09-30',
        snippet: 'the drain deadline latches shut',
      }],
      truncated: false,
    },
    ...overrides,
  };
}

test('renderPrompt is the `cli` dialect of the ONE brief renderer: the Claude-family tier receives every authority section (A-F1/A-I1)', () => {
  const p = renderPrompt(makePromptBrief());
  assert.ok(p.startsWith('[baton brief:cli]'), 'the dialect tag leads the prompt');
  assert.match(p, /Task: add rate limiting/u);
  assert.match(p, /## Write authority/u);
  assert.match(p, /Harness permissions are execution capability, not write authority/u);
  assert.match(p, /Never modify, move, chmod, delete, replace, or repair anything outside that authority/u);
  assert.match(p, /home directory, credentials, toolchains, shims, global configuration, or caches/u);
  assert.match(p, /## Repository mutation authority\nRepository mutation is not authorized\. Inspect\/read and return evidence only; do not create, modify, or delete files\./u);
  assert.match(p, /## Output format\none paragraph, no headings/u);
  assert.match(p, /## Ambient knowledge \(provenance: knowledge — untrusted, verify before use\)\n- \[knowledge\/untrusted\] finding:live \(2026-09-01→2026-09-30\): the drain deadline latches shut/u);
  // The CLI lines this tier is read by stay verbatim.
  assert.match(p, /Constraints:\n- no new dependencies/u);
  assert.match(p, /Work only within: impl\/src\/\*\*/u);
  assert.match(p, /Done when: the focused suite passes/u);

  const authorized = renderPrompt(makePromptBrief({
    goal: 'Audit only and do not edit despite this inverse prose.',
    effects: ['repository_edit'], requiredEffects: ['repository_edit'],
  }));
  assert.match(authorized, /## Repository mutation authority\nThe approved Plan requires an in-scope repository edit for acceptance\./u);
  assert.doesNotMatch(authorized, /Repository mutation is not authorized/u);
});

test('renderPrompt snapshot (cli): the Claude-family dialect renders byte-for-byte', () => {
  const rendered = renderPrompt(makePromptBrief());
  assert.equal(rendered, [
    '[baton brief:cli]',
    'Task: add rate limiting',
    '## Dispatch',
    'This task is already dispatched by Baton. Use your configured native harness tools, skills, context management and delegation to carry out the assigned work within its authority, and use only the tools explicitly advertised in this Brief. Delegated participants inherit the same constraints. Any Baton tools listed here extend those native capabilities.',
    "Delegation: recruit through the Baton swarm surface listed here (swarm.recruit) for work the swarm should be able to review, capture or stop; use your harness's native subagents only for short, disposable exploration — the swarm observes them but cannot govern or stop them.",
    '## Tools',
    'Use only the tools advertised here for Baton actions; any other Baton surface is not authorized for this task.',
    '- baton_swarm_view',
    '## Write authority',
    'Harness permissions are execution capability, not write authority. Write only inside the assigned Baton worktree and only at the Path scope below. Never modify, move, chmod, delete, replace, or repair anything outside that authority, including the home directory, credentials, toolchains, shims, global configuration, or caches. Report an environmental blocker instead of repairing the host.',
    '## Repository mutation authority',
    'Repository mutation is not authorized. Inspect/read and return evidence only; do not create, modify, or delete files.',
    '## Acceptance',
    'Acceptance checks the captured diff, not prose: when the capture changed no path the hub runs no pinned verification and records {outcome: passed, diagnosticCode: verification_not_required, reason: read_only_no_change}, and the textual result completes the run; when the capture changed paths the scope gates apply and the hub re-runs the pinned verification below.',
    'Constraints:',
    '- no new dependencies',
    'Work only within: impl/src/**',
    'Done when: the focused suite passes',
    'You are in a dedicated git worktree; edit files here directly. Do not push or run destructive commands.',
    '## Budget (notify-only evidence — a threshold never stops you)',
    "These are thresholds, not limits on the work: Baton measures your spend against them and raises a notify-only budget alarm for the orchestrator when one is crossed. Crossing one never stops, interrupts or fails your turn; no clock, counter or threshold decides a member's fate here (#163).",
    '- tokens: 120000',
    '- usd: 4.5',
    '- wall: 45 minutes (advisory — no wall-time clock feeds fate)',
    'Work to the Definition of done; if the budget runs out, report it in your result instead of abandoning the work silently.',
    '## Verification (preserve this execution contract; also satisfy the assigned work)',
    'A reviewer will independently enforce the following exact execution contract. Make it pass without changing its executable, argv, working directory, or expected exit.',
    'Execution mode: direct executable and argv (no shell)',
    'Executable (JSON string): "npm"',
    "Arguments (JSON array, in order): [\"test\",\"--prefix\",\"impl\"]",
    'Working directory (relative to the assigned worktree): "."',
    'Expected exit code: 0',
    'The hub re-runs this exact command independently after you finish; the exit code you report is untrusted and is never the evidence — make the command itself pass.',
    '## Output format',
    'one paragraph, no headings',
    '## Ambient knowledge (provenance: knowledge — untrusted, verify before use)',
    '- [knowledge/untrusted] finding:live (2026-09-01→2026-09-30): the drain deadline latches shut',
  ].join('\n'));
});

test('renderPrompt lists the advertised tools beside the order to use only them, and states an empty advertisement (A-F2/A-I2)', () => {
  const p = renderPrompt(makePromptBrief({ tools: ['baton_swarm_view', { name: 'baton_scratchpad_write' }] }));
  const orderAt = p.indexOf('use only the tools explicitly advertised in this Brief');
  const toolsAt = p.indexOf('## Tools');
  assert.ok(orderAt >= 0 && toolsAt > orderAt, '## Tools follows the paragraph whose order it makes followable');
  assert.equal(p.slice(orderAt, toolsAt).includes('## '), false, 'nothing but the advertisement sits between the order and the list');
  assert.ok(p.includes('- baton_swarm_view\n- baton_scratchpad_write'), 'every advertised tool is listed by name');
  assert.match(renderPrompt(makePromptBrief({ tools: [] })), /## Tools\nNo tools are advertised for this Brief\./u);
  const { tools, ...withoutTools } = makePromptBrief();
  assert.equal(tools.length, 1, 'fixture sanity: the advertised list is not empty');
  assert.match(renderPrompt(withoutTools), /## Tools\nNo tools are advertised for this Brief\./u,
    'an absent list is the empty list — the section still renders');
});

test('renderPrompt names ## Path scope only when that section renders, and renders the budget as notify-only evidence (A-F4/A-F3)', () => {
  const scoped = renderPrompt(makePromptBrief());
  assert.match(scoped, /Write only inside the assigned Baton worktree and only at the Path scope below\./u);
  assert.match(scoped, /Work only within: impl\/src\/\*\*/u);

  const unscoped = renderPrompt(makePromptBrief({ pathScope: [] }));
  assert.ok(unscoped.includes('## Write authority'));
  assert.equal(unscoped.includes('Path scope'), false, 'the authority paragraph never names a section that is not rendered');
  assert.match(unscoped, /Write only inside the assigned Baton worktree; this Brief declares no narrower write scope/u);

  assert.match(scoped, /## Budget \(notify-only evidence — a threshold never stops you\)/u);
  assert.match(scoped, /- tokens: 120000\n- usd: 4\.5\n- wall: 45 minutes \(advisory — no wall-time clock feeds fate\)/u);
  assert.match(scoped, /Crossing one never stops, interrupts or fails your turn/u);
  const { budget, ...budgetless } = makePromptBrief();
  assert.equal(budget.tokens, 120000, 'fixture sanity: the budget carries the values the renderer prints');
  assert.equal(renderPrompt(budgetless).includes('## Budget'), false, 'no budget carried, no empty header');
});

test('renderPrompt states the hub re-runs the pinned command and that the claimed exit is untrusted (A-N4)', () => {
  const trust = /The hub re-runs this exact command independently after you finish; the exit code you report is untrusted and is never the evidence — make the command itself pass\./u;
  assert.match(renderPrompt(makePromptBrief()), trust);
  // No dialect is the weak one: the canonical renderer states the same boundary.
  assert.match(renderBrief(makePromptBrief(), 'claude'), trust);
});

test('_onData emits each terminal event exactly once and ignores trailing output after terminal', () => {
  // Drives the real stdout parse/emit path with a synthetic stream — NO child process, zero quota.
  const a = new CodexCli();
  const seen = [];
  a.onEvent((e) => seen.push(e.kind));
  const session = { worker: 'w1', terminal: false, turnEpoch: 1, buf: '' };
  // A stream that turn.completes, then keeps emitting (a real CLI can print usage/error lines after).
  const stream = [
    { type: 'turn.started' },
    { type: 'item.completed', item: { type: 'agent_message', text: 'done' } },
    { type: 'turn.completed', usage: { output_tokens: 1 } },
    { type: 'error', message: 'you hit your usage limit' }, // trailing, must be ignored
    { type: 'turn.failed', error: { message: 'also trailing' } },
  ].map((o) => JSON.stringify(o)).join('\n') + '\n';
  a._onData(session, stream);
  assert.equal(session.turnSettled, true);
  assert.equal(session.terminal, false);
  assert.equal(seen.filter((k) => k === 'lifecycle.turn_completed').length, 1, 'exactly one terminal');
  assert.equal(seen.filter((k) => k === 'lifecycle.crashed').length, 0, 'no crash after a clean terminal');
  assert.deepEqual(seen, ['lifecycle.turn_started', 'resource.provider_call', 'content.message', 'lifecycle.turn_completed']);
});

test('_onData orders authoritative usage before terminal and oversized frames fail closed without echoing provider bytes', () => {
  const ordered = new CodexCli();
  const events = [];
  ordered.onEvent((event) => events.push(event));
  ordered._onData({ worker: 'w1', terminal: false, turnEpoch: 3, buf: '', logicalSequence: 0 }, `${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 2, output_tokens: 1 } })}\n`);
  assert.deepEqual(events.map((event) => event.kind), ['resource.tokens', 'lifecycle.turn_completed']);
  assert.equal(events[0].payload.counterId, events[1].payload.usageSeal.counterId);

  const bounded = new CodexCli({ maxWireFrameBytes: 32 });
  const failures = [];
  bounded.onEvent((event) => failures.push(event));
  const session = { worker: 'w2', terminal: false, turnEpoch: 1, buf: '', logicalSequence: 0 };
  bounded._onData(session, `{"secret":"${'x'.repeat(64)}"}\n`);
  assert.equal(session.buf, '');
  assert.equal(session.turnSettled, true);
  assert.equal(failures.length, 1);
  assert.deepEqual(failures[0].payload, {
    error: 'provider wire frame exceeded configured byte ceiling', code: 'wire_frame_oversize', phase: 'wire',
    usageSeal: { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null },
  });
  assert.doesNotMatch(JSON.stringify(failures), /xxxxxxxx/);
});

test('oversized one-shot wire frame kills and exactly reaps the owned process group before kill.confirmed', async (t) => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  t.after(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exactly reaped */ }
  });
  await once(child, 'spawn');

  const adapter = new CodexCli({ maxWireFrameBytes: 32 });
  const events = [];
  let resolveConfirmed;
  const confirmed = new Promise((resolve) => { resolveConfirmed = resolve; });
  adapter.onEvent((event) => {
    events.push(event);
    if (event.kind === 'kill.confirmed') resolveConfirmed(event);
  });
  const session = {
    worker: 'wire-close-worker', child, terminal: false, turnSettled: false,
    processClosePending: false, processClosedEmitted: false, processGeneration: 1,
    processReapTimeoutMs: 2000, turnEpoch: 1, buf: '', logicalSequence: 0,
    spawnError: null, timeoutFailure: null,
  };
  adapter._sessions.set(session.worker, session);
  child.once('close', (code, signal) => adapter._onClose(session, code, signal));

  adapter._onData(session, `{"secret":"${'z'.repeat(64)}"}\n`);
  let timeout;
  const killEvent = await Promise.race([
    confirmed,
    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('kill confirmation timed out after oversized-frame close')), 3000); }),
  ]).finally(() => clearTimeout(timeout));

  assert.equal(session.terminal, true);
  assert.equal(session.processClosedEmitted, true);
  assert.deepEqual(events.map((event) => event.kind), [
    'lifecycle.crashed', 'lifecycle.process_closed', 'kill.confirmed',
  ]);
  assert.equal(events.filter((event) => event.kind === 'kill.confirmed').length, 1);
  assert.equal(events.filter((event) => event.kind === 'lifecycle.process_reap_unconfirmed').length, 0);
  assert.equal(killEvent.actor, 'worker');
  assert.equal(killEvent.payload.terminalCause, 'wire_frame_oversize');
  assert.deepEqual(killEvent.payload.usageSeal, {
    tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null,
  });
});

test('_onData handles a split terminal line arriving across two chunks without duplicating it', () => {
  const a = new CodexCli();
  const seen = [];
  a.onEvent((e) => seen.push(e.kind));
  const session = { worker: 'w1', terminal: false, turnEpoch: 1, buf: '' };
  const full = JSON.stringify({ type: 'turn.completed', usage: {} }) + '\n';
  a._onData(session, full.slice(0, 10));   // partial — no newline yet
  assert.equal(seen.length, 0, 'nothing emitted until the line completes');
  a._onData(session, full.slice(10));      // completes the line
  assert.deepEqual(seen, ['lifecycle.turn_completed']);
});

test('CLI_ADAPTERS registry maps the harness names the user asked for', () => {
  assert.equal(CLI_ADAPTERS.codex, CodexCli);
  assert.equal(CLI_ADAPTERS.claude, ClaudeCli);
  assert.equal(CLI_ADAPTERS.zcode, ZCodeCli);
  assert.equal(CLI_ADAPTERS.glm, ZCodeCli);
  assert.equal(CLI_ADAPTERS.pi, PiCli);
});

// ---------------------------------------------------------------------------
// A-E2/A-F8: the one-shot stop Ack is typed when the owned generation is settled
// ---------------------------------------------------------------------------

test('A-E2/A-F8: an interrupt of an already-reaped one-shot generation returns the typed settled Ack', async () => {
  const adapter = new PiCli({ cmd: process.execPath, args: () => [FAKE_CLI_ENV], live: true });
  const events = [];
  let resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });
  adapter.onEvent((event) => {
    events.push(event);
    if (event.kind === 'lifecycle.process_closed') resolveClosed(event);
  });

  const ack = await adapter.spawn('one-shot-settled', {
    goal: 'finish immediately', constraints: [], pathScope: ['**'],
    definitionOfDone: 'done', verification: { command: 'true', expectExit: 0 },
  }, { live: true, worktree: '/tmp', replaceEnv: true, env: { PATH: process.env.PATH } });
  assert.equal(ack.ok, true);
  // process_closed is published only after the exact owned group is proven absent.
  await closed;
  assert.equal(events.some((event) => event.kind === 'lifecycle.turn_completed'), true);

  // A confirmation event for this generation can never be emitted again: the Ack IS the
  // confirmation. Without the flag a stop waiter would wait out its whole deadline.
  assert.deepEqual(await adapter.interrupt('one-shot-settled'), { ok: true, terminal: true });
  assert.deepEqual(await adapter.interrupt('never-spawned'), { ok: true, terminal: true });
  assert.deepEqual(await adapter.kill('never-spawned'), { ok: true, terminal: true });
});

// ---------------------------------------------------------------------------
// #281 one-shot half (audit A-G3): kill() reports unconfirmed while live
// ---------------------------------------------------------------------------

test('A-G3: kill() of a live one-shot generation reports unconfirmed until the process confirms its exit', async (t) => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  t.after(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exactly reaped */ }
  });
  await once(child, 'spawn');

  const adapter = new CodexCli({ maxWireFrameBytes: 32 });
  const events = [];
  let resolveConfirmed;
  const confirmed = new Promise((resolve) => { resolveConfirmed = resolve; });
  adapter.onEvent((event) => {
    events.push(event);
    if (event.kind === 'kill.confirmed') resolveConfirmed(event);
  });
  const session = {
    worker: 'kill-unconfirmed', child, terminal: false, turnSettled: false,
    processClosePending: false, processClosedEmitted: false, processGeneration: 1,
    processReapTimeoutMs: 2000, turnEpoch: 1, buf: '', logicalSequence: 0,
    spawnError: null, timeoutFailure: null,
  };
  adapter._sessions.set(session.worker, session);
  adapter._processCloseLatch(session);
  child.once('close', (code, signal) => adapter._onClose(session, code, signal));

  // The child is still alive: no close fact exists, so the Ack must say unconfirmed —
  // a bare {ok:true} would read as done while nothing was observed.
  assert.deepEqual(await adapter.kill(session.worker), { ok: true, confirmed: false, reason: 'close_pending' });

  let timeout;
  await Promise.race([
    confirmed,
    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('kill confirmation timed out after SIGKILL close')), 5000); }),
  ]).finally(() => clearTimeout(timeout));

  // The generation is reaped now: no confirmation event can ever follow, so the Ack IS it.
  assert.deepEqual(await adapter.kill(session.worker), { ok: true, terminal: true });
});
