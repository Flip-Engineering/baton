// visual-renderer.mjs — #242 row: the visual RENDERER + MCP presentation.
//
// Renders the shared `baton.visual_model` (produced by ../src/visual-model.mjs,
// `projectBatonVisualModel`) into:
//   - `batonVisualWidth`: terminal display width (wide/combining-aware, ANSI-blind);
//   - `renderBatonVisual`: one responsive text frame for a view, width-bounded;
//   - `createBatonMcpPresentation`: the MCP `baton.visual_presentation` envelope.
//
// Presentation laws (docs/38-flip-visual-surfaces.md):
//   P1  The renderer only ever reads the model — it never invents worker state.
//   P2  Worker prose is rendered inside `‹angle delimiters›`; ANSI is stripped
//       before projection (the model already guarantees no control bytes).
//   P3  Non-TTY output: one stable frame, no ANSI, no animation. `color:false`
//       means the frame contains no escape bytes at all.
//   P4  Flip appears in the header; motion is limited to four low-amplitude
//       sparkle frames (carried as MCP animation metadata).
//   P5  No renderer gesture bypasses authority; action hints lower through the
//       existing `run.answer` / `baton_surface_visualize` commands.

// ---------------------------------------------------------------------------
// Display width
// ---------------------------------------------------------------------------

// CSI escape sequences occupy no terminal columns.
const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/gu;

// Zero-width marks: combining diacritics, variation selectors, ZWJ/ZWNJ, etc.
const COMBINING_PATTERN =
  /[\u0300-\u036f\u0483-\u0489\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7\u06e8\u06ea-\u06ed\u0711\u0730-\u074a\u07a6-\u07b0\u07eb-\u07f3\u0816-\u0819\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0859-\u085b\u08d3-\u08e1\u08e3-\u08ff\u0900-\u0902\u093a\u093c\u0941-\u0948\u094d\u0951-\u0957\u0962\u0963\u0981\u09bc\u09be\u09c1-\u09c4\u09cd\u09d7\u09e2\u09e3\u0a01\u0a02\u0a3c\u0a41\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a70\u0a71\u0a75\u0a81\u0a82\u0abc\u0ac1-\u0ac5\u0ac7\u0ac8\u0acd\u0ae2\u0ae3\u0b01\u0b3c\u0b3e\u0b3f\u0b41-\u0b44\u0b4d\u0b56\u0b57\u0b62\u0b63\u0b82\u0bbe\u0bc0\u0bcd\u0c00\u0c3e-\u0c40\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c62\u0c63\u0c81\u0cbc\u0cbf\u0cc2\u0cc6\u0ccc\u0ccd\u0cd5\u0cd6\u0ce2\u0ce3\u0d01\u0d3e\u0d41-\u0d44\u0d4d\u0d57\u0d62\u0d63\u0dca\u0dd2-\u0dd4\u0dd6\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0eb1\u0eb4-\u0eb9\u0ebb\u0ebc\u0ec8-\u0ecd\u0f18\u0f19\u0f35\u0f37\u0f39\u0f71-\u0f7e\u0f80-\u0f84\u0f86\u0f87\u0f8d-\u0f97\u0f99-\u0fbc\u0fc6\u102d-\u1030\u1032-\u1037\u1039\u103a\u103d\u103e\u1058\u1059\u105e-\u1060\u1071-\u1074\u1082\u1085\u1086\u108d\u109d\u135d-\u135f\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17b4\u17b5\u17b7-\u17bd\u17c6\u17c9-\u17d3\u17dd\u180b-\u180d\u18a9\u1920-\u1922\u1927\u1928\u1932\u1939-\u193b\u1a17\u1a18\u1a1b\u1a56\u1a58-\u1a5e\u1a60\u1a62\u1a65-\u1a6c\u1a73-\u1a7c\u1a7f\u1ab0-\u1abe\u1b00-\u1b03\u1b34\u1b36-\u1b3a\u1b3c\u1b42\u1b6b-\u1b73\u1b80\u1b81\u1ba2-\u1ba5\u1ba8\u1ba9\u1bab-\u1bad\u1be6\u1be8-\u1be9\u1bed\u1bef-\u1bf1\u1c2c-\u1c33\u1c36\u1c37\u1cd0-\u1cd2\u1cd4-\u1ce0\u1ce2-\u1ce8\u1ced\u1cf4\u1cf8\u1cf9\u1dc0-\u1df5\u1dfc-\u1dff\u200c\u200d\u20d0-\u20dc\u20e1\u20e5-\u20f0\u2cef-\u2cf1\u2d7f\u2de0-\u2dff\u302a-\u302d\u3099\u309a\ua66f\ua674-\ua67d\ua69e\ua69f\ua6f0\ua6f1\ua802\ua806\ua80b\ua825\ua826\ua8c4\ua8e0-\ua8f1\ua926-\ua92d\ua947-\ua951\ua980-\ua982\ua9b3\ua9b6-\ua9b9\ua9bc\ua9e5\uaa29-\uaa2e\uaa31\uaa32\uaa35\uaa36\uaa43\uaa4c\uaa7c\uaab0\uaab2-\uaab4\uaab7\uaab8\uaabe\uaabf\uaac1\uaaec\uaaed\uaaf6\uabe5\uabe8\uabed\ufb1e\ufe00-\ufe0f\ufe20-\ufe2f\uff9e\uff9f]/u;

// East Asian Wide / Fullwidth code points (a conservative unicode-width set).
const WIDE_PATTERN =
  /[\u1100-\u115f\u231a\u231b\u2329\u232a\u23e9-\u23ec\u23f0\u23f3\u25fd\u25fe\u2614\u2615\u2648-\u2653\u267f\u2693\u26a1\u26aa\u26ab\u26bd\u26be\u26c4\u26c5\u26ce\u26d4\u26ea\u26f2\u26f3\u26f5\u26fa\u26fd\u2705\u270a\u270b\u2728\u274c\u274e\u2753-\u2755\u2757\u2795-\u2797\u27b0\u27bf\u2b1b\u2b1c\u2b50\u2b55\u2e80-\u2e99\u2e9b-\u2ef3\u2f00-\u2fd5\u2ff0-\u2ffb\u3000-\u303e\u3041-\u3096\u3099-\u30ff\u3105-\u312d\u3131-\u318e\u3190-\u31ba\u31c0-\u31e3\u31f0-\u321e\u3220-\u3247\u3250-\u32fe\u3300-\u4dbf\u4e00-\ua48c\ua490-\ua4c6\ua960-\ua97c\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe52\ufe54-\ufe66\ufe68-\ufe6b\uff00-\uff60\uffe0-\uffe6\u{1f004}\u{1f0cf}\u{1f18e}\u{1f191}-\u{1f19a}\u{1f200}-\u{1f202}\u{1f210}-\u{1f23b}\u{1f240}-\u{1f248}\u{1f250}\u{1f251}\u{1f300}-\u{1f320}\u{1f32d}-\u{1f335}\u{1f337}-\u{1f37c}\u{1f37e}-\u{1f393}\u{1f3a0}-\u{1f3ca}\u{1f3cf}-\u{1f3d3}\u{1f3e0}-\u{1f3f0}\u{1f3f4}-\u{1f43e}\u{1f440}\u{1f442}-\u{1f4fc}\u{1f4ff}-\u{1f53d}\u{1f54b}-\u{1f54e}\u{1f550}-\u{1f567}\u{1f57a}\u{1f595}\u{1f596}\u{1f5a4}\u{1f5fb}-\u{1f64f}\u{1f680}-\u{1f6c5}\u{1f6cc}\u{1f6d0}-\u{1f6d2}\u{1f6eb}\u{1f6ec}\u{1f6f4}-\u{1f6f8}\u{1f910}-\u{1f93e}\u{1f940}-\u{1f94c}\u{1f950}-\u{1f96b}\u{1f980}-\u{1f997}\u{1f9c0}\u{1f9d0}-\u{1f9e6}\u{20000}-\u{2fffd}\u{30000}-\u{3fffd}]/u;

/**
 * Terminal display width of a string: ANSI escape sequences occupy no
 * columns, combining marks are zero-width, wide (CJK/emoji) code points
 * count two, everything else one.
 */
export function batonVisualWidth(input) {
  const text = String(input ?? '').replace(ANSI_PATTERN, '');
  let width = 0;
  for (const ch of text) {
    if (COMBINING_PATTERN.test(ch)) continue;
    width += WIDE_PATTERN.test(ch) ? 2 : 1;
  }
  return width;
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/** Truncate `text` to at most `width` display columns, ending with `…`. */
function fitToWidth(text, width) {
  const value = String(text ?? '');
  if (batonVisualWidth(value) <= width) return value;
  let out = '';
  let used = 0;
  for (const ch of value) {
    const w = batonVisualWidth(ch);
    if (used + w > Math.max(width - 1, 0)) break;
    out += ch;
    used += w;
  }
  return width <= 0 ? '' : out + '…';
}

/** Right-pad `text` to `width` display columns (never truncates). */
function padTo(text, width) {
  const value = String(text ?? '');
  const current = batonVisualWidth(value);
  return current >= width ? value : value + ' '.repeat(width - current);
}

/** Join two cells into one line of exactly `width` columns (or less). */
function twoColumns(left, right, width) {
  if (width <= 2) return '';
  const cell = Math.floor((width - 2) / 2);
  return `${padTo(fitToWidth(left, cell), cell)}  ${fitToWidth(right, cell)}`;
}

// ---------------------------------------------------------------------------
// Model accessors (defensive: the sibling model row is authoritative, but the
// renderer must degrade gracefully on any absent projection)
// ---------------------------------------------------------------------------

function routeLabel(route) {
  if (route == null) return '';
  if (typeof route === 'string') return route;
  if (typeof route === 'object') {
    const harness = route.harness ?? route.provider;
    const model = route.model ?? route.name;
    if (harness && model) return `${harness}/${model}`;
    return harness ?? model ?? route.route ?? '';
  }
  return String(route);
}

function edgeFrom(edge) {
  return edge?.from ?? edge?.source ?? edge?.workerId ?? edge?.worker ?? '';
}

function edgeTo(edge) {
  const target = edge?.to ?? edge?.target ?? edge?.route;
  return target == null ? '' : typeof target === 'string' ? target : routeLabel(target);
}

function edgeRelation(edge) {
  return edge?.relation ?? 'uses';
}

function timelineItems(model) {
  return Array.isArray(model?.timeline) ? model.timeline : [];
}

function fleetMembers(model) {
  return Array.isArray(model?.fleet?.members) ? model.fleet.members : [];
}

function telemetryRoutes(model) {
  return Array.isArray(model?.telemetry?.routes) ? model.telemetry.routes : [];
}

function attentionItems(model) {
  return Array.isArray(model?.attention) ? model.attention : [];
}

function pulseLanes(model) {
  const lanes = model?.pulse?.lanes ?? model?.telemetry?.lanes ?? model?.convergence?.lanes ?? [];
  return Array.isArray(lanes) ? lanes : [];
}

function pulseQueued(model) {
  return model?.pulse?.queued ?? model?.telemetry?.queued ?? model?.convergence?.queued ?? null;
}

// ---------------------------------------------------------------------------
// Color / motion (P3 progressive enhancement; off by default — non-TTY output
// carries no ANSI and no animation)
// ---------------------------------------------------------------------------

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  cyan: '\u001b[36m',
  yellow: '\u001b[33m',
  green: '\u001b[32m',
  red: '\u001b[31m',
};

/** Wrap `text` in ANSI codes when color is enabled. `text` must be short. */
function styled(text, color, codes) {
  if (!color) return text;
  return codes.map((code) => ANSI[code]).join('') + text + ANSI.reset;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function header(model, view, { width, color, motion }) {
  const runId = model?.run?.runId ?? 'run:unknown';
  let line = `baton top · ${view} · ${runId}`;
  if (motion) line += ' ✦'; // Flip presence — P4
  return styled(fitToWidth(line, width), color, ['bold', 'cyan']);
}

function rule(width) {
  return '─'.repeat(Math.max(width, 0));
}

function renderOverview(model, { width, color, motion }) {
  const lines = [];
  lines.push(header(model, 'overview', { width, color, motion }));
  lines.push(styled(fitToWidth(rule(width), width), color, ['dim']));

  // Narrative — P1: story compiler is the primary source, clearly labeled
  // deterministic projection otherwise.
  const narrative = model?.story?.narrative ?? model?.run?.narrative ?? '';
  lines.push(styled('What is happening', color, ['bold']));
  lines.push(fitToWidth(`  ${narrative}`, width));

  // Run spine.
  lines.push(styled('Run spine', color, ['bold']));
  const run = model?.run ?? {};
  lines.push(fitToWidth(`  runId       ${run.runId ?? '—'}`, width));
  lines.push(fitToWidth(`  phase       ${run.phase ?? '—'}`, width));
  lines.push(fitToWidth(`  objective   ${run.objective ?? '—'}`, width));
  lines.push(fitToWidth(`  progress    ${run.progress?.current ?? '—'}`, width));

  // Fleet roster — narrow: stacked; wide: balanced two columns (P3).
  lines.push(styled('Fleet roster', color, ['bold']));
  const members = fleetMembers(model);
  if (members.length === 0) {
    lines.push(fitToWidth('  (no members projected)', width));
  } else if (width >= 120) {
    const cells = members.map((member) => {
      const route = routeLabel(member?.route);
      const base = `${member?.workerId ?? '?'}  ${member?.role ?? 'worker'}  ${member?.state ?? '?'}`;
      return route ? `${base}  ·  ${route}` : base;
    });
    const left = [];
    const right = [];
    cells.forEach((cell, index) => (index % 2 === 0 ? left : right).push(cell));
    const rows = Math.max(left.length, right.length);
    for (let i = 0; i < rows; i += 1) {
      lines.push(twoColumns(left[i] ?? '', right[i] ?? '', width));
    }
  } else {
    for (const member of members) {
      const route = routeLabel(member?.route);
      const base = `  ${member?.workerId ?? '?'}  ${member?.role ?? 'worker'}  ${member?.state ?? '?'}`;
      lines.push(fitToWidth(route ? `${base}  route ${route}` : base, width));
    }
  }

  // Attention — P5: only answerable requests are actionable.
  lines.push(styled('Attention', color, ['bold']));
  const attention = attentionItems(model);
  if (attention.length === 0) {
    lines.push(fitToWidth('  (no pending attention)', width));
  }
  for (const item of attention) {
    const respondable = item?.respondable === true ? 'respondable' : 'not-answerable';
    lines.push(fitToWidth(
      `  ${item?.requestId ?? item?.id ?? '?'}  ${item?.kind ?? '?'}  ${item?.requiredAction ?? '?'}  ${item?.prompt ?? ''}  [${respondable}]`,
      width,
    ));
  }

  // Pulse.
  lines.push(styled('Pulse', color, ['bold']));
  const lanes = pulseLanes(model);
  lines.push(fitToWidth(`  lanes   ${lanes.length > 0 ? lanes.join(', ') : '—'}`, width));
  const queued = pulseQueued(model);
  if (queued != null && typeof queued === 'object') {
    const queuedText = Object.entries(queued).map(([lane, count]) => `${lane} ${count}`).join(', ');
    lines.push(fitToWidth(`  queued  ${queuedText || '—'}`, width));
  }
  const routes = telemetryRoutes(model);
  const ready = routes.filter((route) => route?.state === 'ready').length;
  lines.push(fitToWidth(`  routes  ${ready} ready of ${routes.length}`, width));

  return lines;
}

function renderTopology(model, { width, color, motion }) {
  const lines = [];
  lines.push(header(model, 'topology', { width, color, motion }));
  lines.push(styled(fitToWidth(rule(width), width), color, ['dim']));

  lines.push(styled('Fleet graph', color, ['bold']));
  lines.push(fitToWidth('  coordinates (x, y) — node grid positions:', width));

  // Node inventory: deployment → run → members → routes (+ attention edges).
  const nodes = [];
  const pushNode = (id, label, layer) => {
    if (id && !nodes.some((node) => node.id === id)) nodes.push({ id, label, layer });
  };
  if (model?.deployment?.deploymentId) {
    pushNode(model.deployment.deploymentId, model.deployment.deploymentId, 0);
  }
  pushNode(model?.run?.runId, model?.run?.runId ?? 'run:unknown', 1);
  for (const member of fleetMembers(model)) {
    pushNode(member?.workerId, `${member?.workerId ?? '?'} ${member?.role ?? 'worker'}`, 2);
  }
  for (const route of telemetryRoutes(model)) {
    pushNode(routeLabel(route), routeLabel(route), 3);
  }
  for (const item of attentionItems(model)) {
    pushNode(item?.requestId ?? item?.id, `${item?.requestId ?? item?.id} (${item?.kind ?? 'attention'})`, 4);
  }

  nodes.forEach((node, index) => {
    lines.push(fitToWidth(`    ${index},0  ${node.label}`, width));
  });

  // Edges: model's own topology edges when present, else derive worker→route
  // `uses` edges from fleet members (bounded, deterministic — P1).
  let edges = Array.isArray(model?.topology?.edges) ? model.topology.edges : null;
  if (edges == null || edges.length === 0) {
    edges = fleetMembers(model)
      .filter((member) => member?.route)
      .map((member) => ({ from: member.workerId, to: routeLabel(member.route), relation: 'uses' }));
  }
  if (edges.length > 0) {
    lines.push(fitToWidth('  edges:', width));
    for (const edge of edges) {
      lines.push(fitToWidth(`    ${edgeFrom(edge)} ${edgeRelation(edge)} ${edgeTo(edge)}`, width));
    }
  }

  return lines;
}

function renderTimeline(model, { width, color, motion }) {
  const lines = [];
  lines.push(header(model, 'timeline', { width, color, motion }));
  lines.push(styled(fitToWidth(rule(width), width), color, ['dim']));

  lines.push(styled('Timeline', color, ['bold']));
  lines.push(fitToWidth('  provenance: prose ‹worker words› · fact', width)); // P2 legend
  const items = timelineItems(model);
  if (items.length === 0) {
    lines.push(fitToWidth('  (no events yet)', width));
  }
  for (const item of items) {
    const isProse = item?.provenance === 'worker_prose';
    const label = isProse ? 'prose' : 'fact';
    const content = isProse ? `‹${item?.summary ?? ''}›` : (item?.summary ?? item?.message ?? '');
    let line = `  #${item?.seq ?? '?'}  ${label}  ${content}`;
    if (batonVisualWidth(line) > width) {
      line = `  ${label}  ${content}`; // drop the sequence prefix first
    }
    lines.push(fitToWidth(line, width));
  }

  return lines;
}

function renderTelemetry(model, { width, color, motion }) {
  const lines = [];
  lines.push(header(model, 'telemetry', { width, color, motion }));
  lines.push(styled(fitToWidth(rule(width), width), color, ['dim']));

  lines.push(styled('Route readiness', color, ['bold']));
  const routes = telemetryRoutes(model);
  if (routes.length === 0) {
    lines.push(fitToWidth('  (no route projection)', width));
  }
  for (const route of routes) {
    const state = route?.state ?? '?';
    const stateColor = state === 'ready' ? ['green'] : state === 'blocked' ? ['red'] : ['yellow'];
    const base = `  ${route?.harness ?? '?'}  ${route?.model ?? '?'}  ${route?.effort ?? '?'}`;
    const summary = route?.summary ? `  ${route.summary}` : '';
    const plain = `${base}  ${state}${summary}`;
    // Color only when the line fits un-truncated, so an escape sequence can
    // never be split by the width fitter.
    lines.push(
      batonVisualWidth(plain) <= width
        ? `${base}  ${styled(state, color, stateColor)}${summary}`
        : fitToWidth(plain, width),
    );
  }

  const counts = model?.fleet?.counts ?? {};
  if (counts.active != null || counts.total != null) {
    lines.push(styled('Workers', color, ['bold']));
    lines.push(fitToWidth(`  active ${counts.active ?? 0}  ·  total ${counts.total ?? counts.active ?? 0}`, width));
  }

  lines.push(styled('Scheduler', color, ['bold']));
  const lanes = pulseLanes(model);
  lines.push(fitToWidth(`  lanes   ${lanes.length > 0 ? lanes.join(', ') : '—'}`, width));
  const queued = pulseQueued(model);
  if (queued != null && typeof queued === 'object') {
    const queuedText = Object.entries(queued).map(([lane, count]) => `${lane} ${count}`).join(', ');
    lines.push(fitToWidth(`  queued  ${queuedText || '—'}`, width));
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Public renderer
// ---------------------------------------------------------------------------

/**
 * Render one static frame of the visual model.
 *
 * @param {object} model  the `baton.visual_model` projection.
 * @param {object} [options]
 * @param {number} [options.width]  terminal width in columns (default model.width or 96).
 * @param {boolean} [options.color]  enable ANSI color (default false — P3).
 * @param {boolean} [options.motion]  enable motion hints (default false — P3).
 * @param {string}  [options.view]   overview | topology | timeline | telemetry.
 * @returns {string}  a single text frame; every line is ≤ width display columns.
 */
export function renderBatonVisual(model, options = {}) {
  const width = options.width ?? model?.width ?? 96;
  const color = Boolean(options.color);
  const motion = Boolean(options.motion);
  const view = options.view ?? model?.view ?? 'overview';
  const ctx = { width, color, motion };

  let lines;
  switch (view) {
    case 'topology': lines = renderTopology(model, ctx); break;
    case 'timeline': lines = renderTimeline(model, ctx); break;
    case 'telemetry': lines = renderTelemetry(model, ctx); break;
    case 'overview':
    default: lines = renderOverview(model, ctx); break;
  }

  // Final width guard. Lines already containing ANSI are short by construction
  // (color is applied only to labels), so they are never re-truncated.
  return lines
    .map((line) => (line.includes('\u001b') ? line : fitToWidth(line, width)))
    .join('\n')
    .concat('\n');
}

// ---------------------------------------------------------------------------
// MCP presentation (P3/P4: static text always present, animation optional,
// ANSI never)
// ---------------------------------------------------------------------------

const FLIP_SPARKLE_FRAMES = [
  { glyph: '✦', x: 0, y: 0, opacity: 0.2 },
  { glyph: '✦', x: 1, y: -1, opacity: 0.45 },
  { glyph: '✦', x: -1, y: -1, opacity: 0.7 },
  { glyph: '✦', x: 0, y: 0, opacity: 1 },
];

/**
 * Build the MCP `baton.visual_presentation` envelope: a static ANSI-free text
 * rendering, an accessible summary from the run narrative, four low-amplitude
 * Flip sparkle frames (P4), and exact refresh arguments that lower through
 * `baton_surface_visualize` (P5).
 */
export function createBatonMcpPresentation(model, options = {}) {
  const width = options.width ?? model?.width ?? 96;
  const text = renderBatonVisual(model, { width, color: false, motion: false });
  const run = model?.run ?? {};
  const controls = model?.controls ?? {};

  const refreshArguments = {
    runId: run.runId ?? null,
    follow: true,
    afterCursor: model?.cursors?.after ?? 0,
    attentionCursor: model?.cursors?.attention ?? model?.cursors?.attentionCursor ?? 0,
  };

  const approvals = Array.isArray(controls.approvals) ? controls.approvals : [];
  const actionSuggestions = approvals.map((approval) => {
    const requestId = approval?.requestId ?? approval?.id;
    return {
      requestId,
      kind: approval?.kind ?? 'approval',
      command: approval?.allow?.command ?? 'run.answer',
      arguments: { requestId },
    };
  });

  return {
    kind: 'baton.visual_presentation',
    text,
    accessibleSummary: run.narrative ?? model?.story?.narrative ?? '',
    animation: {
      kind: 'flip_sparkle',
      loop: true,
      msPerFrame: 350,
      frames: FLIP_SPARKLE_FRAMES,
    },
    refresh: {
      tool: 'baton_surface_visualize',
      arguments: refreshArguments,
    },
    actionSuggestions,
  };
}
