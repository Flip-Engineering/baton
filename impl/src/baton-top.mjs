// impl/src/baton-top.mjs — the Flip-driven operator terminal seat (docs/38).
//
// `baton top` is explicitly human output. It projects Baton's existing Run, story, event,
// attention, readiness, route, worker, and convergence authorities into one bounded visual
// model (the visual-model sibling) and renders it through visual-renderer's renderBatonVisual.
// No renderer becomes an authority: it never invents worker state, moves cursors, answers an
// interaction silently, or creates a second event bus. The TUI's allow/deny gestures lower
// through respondToVisualAttention → client.command('run.answer', …) only.
//
// The visual-model/visual-renderer siblings land in parallel waves; they are loaded lazily so
// package imports stay inert (docs/38 acceptance #8) and ordinary CLI parsing is never blocked
// while the siblings are absent.

export const BATON_TOP_HELP = `baton top — the responsive operator seat (docs/38)

Usage:
  baton top [RUN_ID] [--wave-id WAVE_ID]
            [--view overview|topology|timeline|telemetry]
            [--refresh MS] [--width N] [--once]
            [--plain] [--no-motion] [--no-color]

Interactive keys:
  1-4  switch views       tab  cycle view       r  refresh
  p    pause reads         m    toggle motion    ?  help
  [ ]  select attention   a/d  allow/deny       j/k scroll
  q    quit

The four views:
  overview   existing story/Run narrative, Run spine, fleet roster, attention, and pulse
  topology   deployment -> Run -> member -> route/scope plus attention edges
  timeline   bounded event tail with explicit fact/prose provenance
  telemetry  route readiness, scheduler lanes, worker counts, budget, and transport

Rendering laws (docs/38 P2-P3):
  Worker/provider prose is marked worker_prose in the model and rendered inside
  ‹angle delimiters›; facts are shown directly. Non-TTY output is one stable frame with
  no ANSI. Ordinary Baton commands retain machine-clean JSON on stdout.
`;

const VIEWS = Object.freeze(['overview', 'topology', 'timeline', 'telemetry']);
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/u;

function cliError(message, code = 'cli_invalid') {
  return Object.assign(new Error(message), { code });
}

function boundedId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw cliError(`${label} is invalid`);
  return value;
}

function takeValue(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0) return null;
  if (index === args.length - 1 || args[index + 1].startsWith('--')) {
    throw cliError(`${flag} requires a value`);
  }
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
}

function takeFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function positiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw cliError(`${flag} must be a positive integer`);
  return parsed;
}

/**
 * Parse `baton top` argv. Returns null for any argv that does not start with 'top' so the
 * ordinary CLI parser is never swallowed; `['top', '--help']` → { kind: 'top_help' }.
 */
export function parseBatonTopCli(argv) {
  if (!Array.isArray(argv) || argv[0] !== 'top') return null;
  const args = argv.slice(1);
  if (args.includes('--help') || args.includes('-h')) {
    return Object.freeze({ kind: 'top_help' });
  }
  const runIdRaw = args.length > 0 && !args[0].startsWith('--') ? args.shift() : null;
  const waveIdRaw = takeValue(args, '--wave-id');
  const viewRaw = takeValue(args, '--view');
  const refreshRaw = takeValue(args, '--refresh');
  const widthRaw = takeValue(args, '--width');
  const once = takeFlag(args, '--once');
  const plain = takeFlag(args, '--plain');
  const noMotion = takeFlag(args, '--no-motion');
  const noColor = takeFlag(args, '--no-color');
  if (args.length > 0) throw cliError(`unexpected argument ${args[0]}`);
  const runId = runIdRaw === null ? null : boundedId(runIdRaw, 'Run ID');
  const waveId = waveIdRaw === null ? null : boundedId(waveIdRaw, 'wave ID');
  const view = viewRaw === null ? 'overview' : viewRaw;
  if (!VIEWS.includes(view)) {
    throw cliError(`view must be one of ${VIEWS.join(', ')}`);
  }
  const refreshMs = refreshRaw === null ? 1000 : positiveInteger(refreshRaw, '--refresh');
  const width = widthRaw === null ? null : positiveInteger(widthRaw, '--width');
  return Object.freeze({
    kind: 'top', runId, waveId, view, refreshMs, width,
    once: once || plain, plain, motion: !(noMotion || plain), color: !(noColor || plain),
  });
}

async function loadVisualModules() {
  const [modelModule, rendererModule] = await Promise.all([
    import('./visual-model.mjs'),
    import('./visual-renderer.mjs'),
  ]);
  if (typeof modelModule.projectBatonVisualModel !== 'function') {
    throw cliError('visual-model sibling must export projectBatonVisualModel', 'visual_sibling_invalid');
  }
  if (typeof rendererModule.renderBatonVisual !== 'function') {
    throw cliError('visual-renderer sibling must export renderBatonVisual', 'visual_sibling_invalid');
  }
  return {
    projectBatonVisualModel: modelModule.projectBatonVisualModel,
    renderBatonVisual: rendererModule.renderBatonVisual,
  };
}

async function projectFrame(parsed, env, visuals, { color, motion, width, view } = {}) {
  const snapshot = await env.client.surfaceSnapshot({ runId: parsed.runId, waveId: parsed.waveId });
  const model = visuals.projectBatonVisualModel({ snapshot, width });
  const text = visuals.renderBatonVisual(model, { width, color, motion, view });
  return { model, text };
}

/**
 * Run the seat. Non-TTY (or `--once`/`--plain`) renders exactly one stable frame from the
 * existing surfaceSnapshot seam — no ANSI, no polling — and returns { run } carrying
 * model.run. On a real TTY without --once it runs the responsive interactive loop; every
 * allow/deny gesture lowers through respondToVisualAttention → run.answer.
 */
export async function runBatonTop(parsed, { client, stdout, stdin, clock }) {
  if (parsed?.kind !== 'top') throw cliError('runBatonTop requires a parsed top command', 'cli_invalid');
  if (!client || typeof client.surfaceSnapshot !== 'function') {
    throw cliError('baton top requires an authenticated resident client', 'cli_config_invalid');
  }
  const width = parsed.width ?? (stdout?.columns ?? 80);
  const tty = stdout?.isTTY === true;
  const visuals = await loadVisualModules();

  if (!tty || parsed.once || parsed.plain) {
    const { model, text } = await projectFrame(parsed, { client }, visuals, {
      color: false, motion: false, width, view: parsed.view,
    });
    if (!stdout || typeof stdout.write !== 'function') {
      throw cliError('baton top requires a writable stdout', 'cli_config_invalid');
    }
    stdout.write(`${text}\n`);
    return { run: model.run };
  }

  const state = {
    view: parsed.view,
    motion: parsed.motion,
    paused: false,
    selected: 0,
    scroll: 0,
    help: false,
    status: '',
  };
  let currentModel = null;
  let done = false;
  let wake = null;
  let timer = null;

  const notify = (message) => { state.status = message; };
  const answer = (decision) => {
    void respondToVisualAttention(client, currentModel, state.selected, decision)
      .then(() => notify(`answered ${decision}`))
      .catch((error) => {
        notify(error?.code === 'visual_action_unavailable'
          ? 'no answerable attention item at the selection'
          : (error?.message ?? String(error)));
      });
  };

  const onData = (chunk) => {
    for (const char of String(chunk)) {
      if (char === 'q') { done = true; break; }
      if (char === '1') state.view = 'overview';
      else if (char === '2') state.view = 'topology';
      else if (char === '3') state.view = 'timeline';
      else if (char === '4') state.view = 'telemetry';
      else if (char === '\t') {
        state.view = VIEWS[(VIEWS.indexOf(state.view) + 1) % VIEWS.length];
      } else if (char === 'r') { /* refresh happens on the next tick */ }
      else if (char === 'p') state.paused = !state.paused;
      else if (char === 'm') state.motion = !state.motion;
      else if (char === '?') state.help = !state.help;
      else if (char === '[') state.selected = Math.max(0, state.selected - 1);
      else if (char === ']') state.selected += 1;
      else if (char === 'a') answer('allow');
      else if (char === 'd') answer('deny');
      else if (char === 'j') state.scroll += 1;
      else if (char === 'k') state.scroll = Math.max(0, state.scroll - 1);
    }
    if (wake) {
      const resolve = wake;
      wake = null;
      clearTimeout(timer);
      resolve();
    }
  };

  const raw = typeof stdin?.setRawMode === 'function';
  if (raw) stdin.setRawMode(true);
  stdin.on('data', onData);
  try {
    for (;;) {
      const { model, text } = await projectFrame(parsed, { client }, visuals, {
        color: parsed.color,
        motion: state.motion && !state.paused,
        width,
        view: state.view,
      });
      currentModel = model;
      const attention = Array.isArray(model.attention) ? model.attention : [];
      state.selected = Math.min(Math.max(0, state.selected), Math.max(0, attention.length - 1));
      stdout.write(`\u001b[2J\u001b[H${text}`);
      if (state.status) {
        stdout.write(`\n${state.status}\n`);
        state.status = '';
      }
      if (state.help) stdout.write(`\n${BATON_TOP_HELP}\n`);
      if (done) break;
      await new Promise((resolve) => {
        wake = resolve;
        timer = setTimeout(() => {
          wake = null;
          resolve();
        }, state.paused ? 5000 : parsed.refreshMs);
      });
    }
    return { run: currentModel?.run ?? null };
  } finally {
    stdin.removeListener('data', onData);
    if (raw) stdin.setRawMode(false);
  }
}

/**
 * Lower one TUI approval gesture through the existing run.answer command for the
 * model.attention[index] item. Empty or non-answerable attention refuses the typed
 * 'visual_action_unavailable' error — the TUI never invents an answerable identity.
 */
export async function respondToVisualAttention(client, model, index, decision) {
  const attention = Array.isArray(model?.attention) ? model.attention : [];
  const item = attention[index];
  // The visual model's attention items carry requestId (+ optional per-item runId); the
  // run identity lives on model.run when the item omits it (attention read from the
  // run-scoped projection). Accept both — run.answer requires the run identity.
  const runId = typeof item?.runId === 'string' ? item.runId
    : typeof model?.run?.runId === 'string' ? model.run.runId : null;
  if (!item || runId === null || typeof item?.requestId !== 'string') {
    throw Object.assign(new Error('visual action unavailable: no answerable attention item at the selected index'), {
      code: 'visual_action_unavailable',
    });
  }
  return client.command('run.answer', {
    runId,
    requestId: item.requestId,
    answer: { decision },
  });
}
