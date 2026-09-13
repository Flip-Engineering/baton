import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { OmpRpcCli } from '../src/omp-rpc.mjs';

// Native capability defaults for the omp member adapter (2026-09-12). The builder used to push
// `--no-extensions --no-skills --no-rules --no-lsp --no-title --no-pty` unconditionally, justified
// as member containment. That justification was false: runtime isolation (runtime-isolation.mjs) is
// a same-UID private HOME + env boundary, and none of those switches is RPC-protocol-required.
//
// Installed-source evidence (omp 17.4.0, /opt/homebrew/Cellar/omp/17.4.0/bin/omp, arm64 build):
//   - `--mode rpc` is the transport this adapter speaks (`--mode` help: text|json|rpc|rpc-ui).
//   - Each suppressed switch is a session-scoped capability gate, not a protocol concern:
//       --no-extensions → `disableExtensionDiscovery` (explicit `-e` paths still load)
//       --no-skills     → session `skills = []`
//       --no-rules      → session `rules = []`
//       --no-lsp        → `enableLsp = false` (LSP tools, formatting, diagnostics)
//   - `--no-title` was redundant: rpc mode already sets `PI_NO_TITLE=1` itself, so title
//     auto-generation stays disabled by the mode default (no background inference is projected).
//   - `--no-pty` was inert under this adapter's mode: plain rpc reports `hasUI=false`, and omp's
//     interactive-bash PTY gate requires a UI session (`canUseInteractiveBashPty` → hasUI && ui);
//     omp auto-sets `PI_NO_PTY` only for `--mode rpc-ui`. (Limit, reported: interactive PTY bash is
//     unavailable under `--mode rpc` by omp's own mode gate — argv cannot restore it.)
//   - The extension_ui_request lane (the adapter answers it; #243/#255) is how native extensions
//     and questions reach the coordinator, so extension discovery is compatible with rpc.
//
// These pins defend: ordinary launch preserves the native harness (skills/extensions/rules/LSP),
// selected model/effort/permission mode ride exactly, resume args still append, and an explicitly
// supplied caller argv stays caller-owned.

const SUPPRESSION_FLAGS = ['--no-extensions', '--no-skills', '--no-rules', '--no-lsp', '--no-title', '--no-pty'];

class FakeStream extends EventEmitter {
  setEncoding() { /* fake */ }
  end() { /* fake */ }
  write() { return true; }
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdin = new FakeStream();
    this.stdout = new FakeStream();
    this.stderr = new FakeStream();
    this.pid = 424242;
    this.killed = false;
    this.kill = () => {
      this.killed = true;
      queueMicrotask(() => { this.emit('exit', 0, null); this.emit('close', 0, null); });
      return true;
    };
  }

  frame(frame) { this.stdout.emit('data', `${JSON.stringify(frame)}\n`); }
}

// Captures the exact argv of every launch. readiness is emitted from a microtask after spawnFn
// returns (the session registers synchronously inside spawn before waitReady).
function captureLaunch(adapterOptions = {}) {
  const launches = [];
  const children = [];
  const adapter = new OmpRpcCli({
    requestTimeoutMs: 1_000,
    modelCatalog: { m: ['low', 'high'] },
    versionProbe: () => '17.4.0-fixture',
    reapOwnedProcessGroup: async () => ({ confirmed: true, reason: null }),
    ...adapterOptions,
    spawnFn: (command, args, options) => {
      launches.push({ command, args: [...args], env: options?.env });
      const child = new FakeChild();
      children.push(child);
      queueMicrotask(() => child.frame({ type: 'ready', protocolVersion: 1 }));
      return child;
    },
  });
  return { adapter, launches, children };
}

function cleanup(t, adapter, children) {
  t.after(async () => {
    await Promise.all([...adapter._sessions.values()].map(async (session) => {
      await adapter.kill(session.worker);
      await session.process.closePromise;
    }));
    for (const child of children) child.kill();
  });
}

async function launch(adapter, worker, overrides = {}) {
  const outcome = await adapter.spawn(worker, { goal: 'g' }, {
    model: 'm', reasoningEffort: 'high', worktree: '/tmp', processGeneration: 1, ...overrides,
  });
  assert.equal(outcome.ok, true, `spawn must succeed (${JSON.stringify(outcome)})`);
  return outcome;
}

test('NATIVE LAUNCH: ordinary omp spawn injects no capability suppression — skills/extensions/rules/LSP stay native', async (t) => {
  const { adapter, launches, children } = captureLaunch();
  cleanup(t, adapter, children);

  await launch(adapter, 'w-native');
  assert.equal(launches.length, 1, 'exactly one child was launched');
  assert.equal(launches[0].command, 'omp', 'launch resolves the omp executable');

  const argv = launches[0].args;
  // Exact argv pins order AND absence in one assertion: the transport, the selected route, and
  // the permission mode — nothing else.
  assert.deepEqual(argv, ['--mode', 'rpc', '--model', 'm', '--thinking', 'high', '--approval-mode', 'yolo']);
  for (const flag of SUPPRESSION_FLAGS) {
    assert.equal(argv.includes(flag), false, `${flag} must not be injected by an ordinary launch`);
  }
});

test('NATIVE LAUNCH: an explicitly supplied caller argv stays caller-owned, opt-in suppression included', async (t) => {
  const explicit = ['--mode', 'rpc', '--model', 'm', '--thinking', 'high', '--no-skills', '--add-dir', '/work'];
  const { adapter, launches, children } = captureLaunch({ args: explicit });
  cleanup(t, adapter, children);

  await launch(adapter, 'w-explicit');
  assert.deepEqual(launches[0].args, explicit, 'options.args replaces the defaults verbatim');
  assert.equal(launches[0].args.includes('--no-skills'), true, 'a caller may still suppress a capability explicitly');
  for (const flag of SUPPRESSION_FLAGS) {
    assert.equal(launches[0].args.filter((arg) => arg === flag).length, flag === '--no-skills' ? 1 : 0,
      `${flag} appears only when the caller supplied it`);
  }
});

test('LAUNCH SHAPE: non-yolo permission mode omits --approval-mode; model and effort stay exact', async (t) => {
  const { adapter, launches, children } = captureLaunch({ permissionMode: 'always-ask' });
  cleanup(t, adapter, children);

  await launch(adapter, 'w-ask');
  const argv = launches[0].args;
  assert.deepEqual(argv, ['--mode', 'rpc', '--model', 'm', '--thinking', 'high'],
    'the refusal mode is enforced by the absent flag, not by a substituted one');
  assert.deepEqual(adapter.card().workerPolicy.autonomy.mechanisms, ['permission-mode-always-ask'],
    'the card advertises the permission mode the launch actually used');
});

test('RESUME: session resume and the isolated session store still append to the native defaults', async (t) => {
  const { adapter, launches, children } = captureLaunch();
  cleanup(t, adapter, children);

  await launch(adapter, 'w-resume', {
    sessionDir: '/home/w/sessions', session: { id: 'sess-prior', mode: 'resume' },
  });
  assert.deepEqual(launches[0].args, [
    '--mode', 'rpc', '--model', 'm', '--thinking', 'high', '--approval-mode', 'yolo',
    '--resume', 'sess-prior', '--session-dir', '/home/w/sessions',
  ], 'resume authority rides the same argv as the native defaults');
});

test('Flash defaults admit native efforts with exact selectors and refuse unsupported effort before spawning', async (t) => {
  const { adapter, launches, children } = captureLaunch({ modelCatalog: undefined });
  cleanup(t, adapter, children);
  for (const model of ['zai/glm-5.3-flash', 'deepseek/deepseek-flash']) {
    for (const effort of ['low', 'high', 'max']) {
      await launch(adapter, `${model}-${effort}`, { model, reasoningEffort: effort });
      assert.deepEqual(launches.at(-1).args, [
        '--mode', 'rpc', '--model', model, '--thinking', effort, '--approval-mode', 'yolo',
      ]);
    }
    const before = launches.length;
    const rejected = await adapter.spawn(`${model}-medium`, { goal: 'g' }, {
      model, reasoningEffort: 'medium', worktree: '/tmp',
    });
    assert.equal(rejected.code, 'effort_unavailable');
    assert.equal(launches.length, before);
  }
  assert.equal(adapter._sessions.size, 6, 'each admitted worker retains its independent live session');
});

test('concurrent Flash workers retain distinct native model identities when their messages interleave', async (t) => {
  const { adapter, children } = captureLaunch({ modelCatalog: undefined });
  cleanup(t, adapter, children);
  const events = [];
  adapter.onEvent((event) => events.push(event));
  await Promise.all([
    launch(adapter, 'glm', { model: 'zai/glm-5.3-flash' }),
    launch(adapter, 'deepseek', { model: 'deepseek/deepseek-flash' }),
  ]);
  for (const session of adapter._sessions.values()) adapter._startTurn(session, 'work');
  children[0].frame({ type: 'message_start', message: { role: 'assistant' } });
  children[1].frame({ type: 'message_start', message: { role: 'assistant' } });
  children[1].frame({ type: 'message_end', message: {
    role: 'assistant', provider: 'deepseek', model: 'deepseek-flash',
    usage: { totalTokens: 20, cost: { total: 0.001 } }, stopReason: 'stop',
  } });
  children[0].frame({ type: 'message_end', message: {
    role: 'assistant', provider: 'zai', model: 'glm-5.3-flash',
    usage: { totalTokens: 10, cost: { total: 0 } }, stopReason: 'stop',
  } });
  const usage = events.filter((event) => event.kind === 'resource.tokens');
  assert.deepEqual(usage.map(({ worker, payload }) => [worker, payload.modelObserved, payload.tokens]), [
    ['deepseek', 'deepseek/deepseek-flash', 20], ['glm', 'zai/glm-5.3-flash', 10],
  ]);
  assert.notEqual(usage[0].payload.counterId, usage[1].payload.counterId);
});
