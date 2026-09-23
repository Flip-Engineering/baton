// adapter.mjs — the D1 unified, session-shaped Adapter contract (spec/RECONCILIATION.md
// D1 overrides spec/IMPLEMENTATION.md §2 wherever they differ).
//
// Every harness (Mock/Codex/Claude/Glm) implements exactly:
//   card() / spawn() / prompt() / interrupt() / approve() / answer() / kill() / onEvent()
// `answer()` is distinct from `approve()` (red core#1): approvals carry a closed
// 'allow'|'deny'|'cancel' decision; questions carry free-form {text|decision}.
// Confirmed-stop (interrupt/kill) is ALWAYS an event, never a return value (red core#2):
// interrupt()/kill() Acks resolve immediately; the authoritative stop is
// control.interrupt_confirmed / kill.confirmed observed via onEvent. The ONE exception is the
// typed settled Ack (`terminal:true`) defined in the Ack vocabulary below: it says the worker is
// already stopped, so no confirmation event can ever follow and the Ack itself is the confirmation.
//
// MockAdapter additionally keeps the pre-D1 `run(brief, opts)` convenience
// (= spawn + await the terminal event + translate to WorkerResult / AdapterCrashError)
// so one-shot Cluster-B tests (adapter/worktree/referee) keep working.

import { execFileSync } from 'node:child_process';
import { closeSync, constants as fsConstants, fstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { normalizeConcurrencyCeiling } from './concurrency-policy.mjs';
import { renderVerificationExecution } from './verification-presentation.mjs';
import { renderAttentionSection, renderContinuitySection, renderReplObjectsSection } from './messages.mjs';
import { advertisesBatonControlSurface } from './control-surface-unification.mjs';
import { FRAME_LIMITS } from './limits.mjs';

// ── #341 part 2: the closed provider-refusal table a card carries ───────────────────────────────
//
// A provider that refuses a turn says so in its OWN words, and until #341 that text was the only
// place the fact existed: `doctor --check` kept reporting the route ready while every recruit on it
// died with "You've hit your usage limit … try again at <date>", and readiness never moved (#346,
// #348: a claude-code seat died on "401 OAuth access token has expired" with readiness still
// saying ready). The refusal is a fact about the ROUTE — a successor on the same route is refused
// identically — so the route's own card is where the vocabulary that recognises it is declared: a
// small CLOSED table, one row per class the provider states in its own text. Readiness matches
// crash text against THESE rows and nothing else: a pattern with no card row is a pattern nobody
// owns, and it never blocks a route.

/** The classes a provider refusal falls in.
 *
 * `quota` — the provider refused for a spent plan/limit. Its text may name the instant the limit
 * resets; when it does, that instant is read out of the provider's own words (never invented) and
 * the route reads blocked until it passes.
 * `authentication` — the provider refused the credential. No instant exists to wait for, so only a
 * later turn that succeeds clears the block. */
export const PROVIDER_REFUSAL_CODES = Object.freeze({
  quota: 'provider_quota_exhausted',
  authentication: 'provider_auth_expired',
});

/** A row whose provider text carries the reset instant the provider itself stated. */
export const PROVIDER_RESET_AT_FROM_TEXT = 'provider-text';

/**
 * One card's closed provider-refusal table. Each row is `{code, pattern, resetAt}`: the closed
 * code the route reads blocked by, the provider's own refusal text as a regex SOURCE (so a table
 * stays data — serializable, comparable, reviewable as text), and `resetAt` =
 * PROVIDER_RESET_AT_FROM_TEXT when that text names the reset instant, else null.
 *
 * Validated where the card is built: an unknown code or an uncompilable pattern refuses at
 * construction, never as a silently inert row nobody notices until a lane dies on it.
 * @param {string} harness the provider whose vocabulary this table is
 * @param {Array<{code: string, pattern: string, resetAt: string|null}>} rows
 */
export function providerRefusals(harness, rows) {
  if (typeof harness !== 'string' || harness.length === 0) {
    throw new TypeError('providerRefusals requires the harness the table belongs to');
  }
  if (!Array.isArray(rows)) throw new TypeError(`provider refusal table for ${harness} must be an array`);
  const codes = new Set(Object.values(PROVIDER_REFUSAL_CODES));
  return Object.freeze(rows.map((row) => {
    if (!codes.has(row?.code)) {
      throw new TypeError(`provider refusal row for ${harness} names no known code`);
    }
    if (typeof row.pattern !== 'string' || row.pattern.length === 0) {
      throw new TypeError(`provider refusal row for ${harness} carries no provider text pattern`);
    }
    if (row.resetAt !== null && row.resetAt !== undefined && row.resetAt !== PROVIDER_RESET_AT_FROM_TEXT) {
      throw new TypeError(`provider refusal row for ${harness} declares an unusable resetAt source`);
    }
    try { new RegExp(row.pattern, 'iu'); } catch (error) {
      throw new TypeError(`provider refusal row for ${harness} carries an uncompilable pattern: ${error.message}`);
    }
    return Object.freeze({
      code: row.code, pattern: row.pattern,
      resetAt: row.resetAt === PROVIDER_RESET_AT_FROM_TEXT ? PROVIDER_RESET_AT_FROM_TEXT : null,
    });
  }));
}

// The provider texts themselves, each captured from the harness that said it — one spelling per
// provider, so a reader sees whose words a row recognises and no second copy can drift from it.

// codex (#341, observed live): "You've hit your usage limit. Visit
// https://chatgpt.com/codex/settings/usage … or try again at Sep 19th, 2026 10:28 PM."
const CODEX_QUOTA_REFUSAL_TEXT = String.raw`you(?:'ve| have)? hit your usage limit|usage limit (?:reached|exceeded)`;

// claude-code (#348): the result strings the claude session tier's own reader already recognises
// (claude-session.mjs `claudeResultFailureCode`) plus the live capture that opened #348.
const CLAUDE_AUTH_REFUSAL_TEXT = String.raw`authentication_error|not logged in[^\n]*please run (?:/login|claude auth login)|failed to authenticate[^\n]*\b401\b|oauth access token has (?:expired|been revoked)`;

// muse (#341 part 3): the CLI's OWN credential refusal, captured from a credential-free
// `muse exec --json` (an empty keyring): "missing meta credentials: run `muse login` or set
// META_API_KEY, or save credentials at <path>". Only this vocabulary blocks a muse route —
// `\bunauthorized\b` / "not logged in" matched ANY prose that happened to contain those words,
// which is a pattern nobody captured and which a route must never be refused by.
const MUSE_AUTH_REFUSAL_TEXT = String.raw`missing meta credentials|set META_API_KEY|\bmuse login\b`;

// The provider-limit vocabulary every other served provider answers with — the SAME set the
// provider-faults taxonomy already reads at the omp boundary (#295), plus DeepSeek's documented
// 402 text ("Insufficient Balance", api-docs.deepseek.com/quick_start/error_codes).
const PROVIDER_LIMIT_REFUSAL_TEXT = String.raw`usage limit|rate.?limit|quota|too many requests|\b429\b|insufficient (?:balance|quota|credit)|\b402\b`;

/** A card for a harness whose provider refusal text this build has never captured publishes an
 * EMPTY table — recorded absence, never a pattern guessed on that provider's behalf. Empty, so the
 * matcher returns null for every text and no route is ever blocked by a pattern nobody owns. */
export const NO_PROVIDER_REFUSALS = Object.freeze([]);

const PROVIDER_REFUSALS_BY_HARNESS = Object.freeze({
  codex: providerRefusals('codex', [
    { code: PROVIDER_REFUSAL_CODES.quota, pattern: CODEX_QUOTA_REFUSAL_TEXT, resetAt: PROVIDER_RESET_AT_FROM_TEXT },
  ]),
  'claude-code': providerRefusals('claude-code', [
    { code: PROVIDER_REFUSAL_CODES.authentication, pattern: CLAUDE_AUTH_REFUSAL_TEXT, resetAt: null },
  ]),
  muse: providerRefusals('muse', [
    { code: PROVIDER_REFUSAL_CODES.authentication, pattern: MUSE_AUTH_REFUSAL_TEXT, resetAt: null },
  ]),
  // zai (GLM) and the omp-served providers (deepseek, zai, omp): their own limit refusal, whose
  // text may name a reset instant.
  'glm-via-claude': providerRefusals('glm-via-claude', [
    { code: PROVIDER_REFUSAL_CODES.quota, pattern: PROVIDER_LIMIT_REFUSAL_TEXT, resetAt: PROVIDER_RESET_AT_FROM_TEXT },
  ]),
  omp: providerRefusals('omp', [
    { code: PROVIDER_REFUSAL_CODES.quota, pattern: PROVIDER_LIMIT_REFUSAL_TEXT, resetAt: PROVIDER_RESET_AT_FROM_TEXT },
    { code: PROVIDER_REFUSAL_CODES.authentication, pattern: String.raw`\b(?:invalid|revoked|expired) (?:api )?key\b|\bunauthorized\b|\b401\b|\bauthentication (?:failed|required|error)\b`, resetAt: null },
  ]),
  // DeepSeek on its OWN Anthropic-compatible endpoint (DeepseekSessionCli, the GLM session tier
  // pointed at api.deepseek.com): reaching a provider directly does not change whose refusal it is,
  // so this harness carries the same documented limit vocabulary — including DeepSeek's 402
  // ("Insufficient Balance") — the provider-faults taxonomy already reads at the omp boundary.
  deepseek: providerRefusals('deepseek', [
    { code: PROVIDER_REFUSAL_CODES.quota, pattern: PROVIDER_LIMIT_REFUSAL_TEXT, resetAt: PROVIDER_RESET_AT_FROM_TEXT },
  ]),
});

/** The harness spellings that NAME a provider another harness already answers from. A refusal
 * vocabulary is a fact about the PROVIDER, not the transport, so a second spelling resolves to the
 * ONE table object — never a second copy of the same rows that could drift out of step with it. */
const PROVIDER_REFUSAL_HARNESS_ALIASES = Object.freeze({
  // The GLM session tier IS Claude Code driving z.ai's Anthropic-compatible endpoint (the one-shot
  // ZCodeCli's env pattern lifted onto the session adapter), under the class default spelling and
  // the deployment's shorter one.
  'glm-via-claude-session': 'glm-via-claude',
  glm: 'glm-via-claude',
});

/** The closed refusal table the card for this harness carries. */
export function providerRefusalsForHarness(harness) {
  const key = typeof harness === 'string' && Object.hasOwn(PROVIDER_REFUSAL_HARNESS_ALIASES, harness)
    ? PROVIDER_REFUSAL_HARNESS_ALIASES[harness] : harness;
  return PROVIDER_REFUSALS_BY_HARNESS[key] ?? NO_PROVIDER_REFUSALS;
}

const refusalMatchers = new Map();

/** One table holds at most a handful of rows and a card compiles its table on construction, so the
 * compiled source is cached by its own text — never recompiled on the readiness read path. */
function refusalMatcher(source) {
  let compiled = refusalMatchers.get(source);
  if (compiled === undefined) {
    compiled = new RegExp(source, 'iu');
    refusalMatchers.set(source, compiled);
  }
  compiled.lastIndex = 0;
  return compiled;
}

/**
 * The refusal row a provider's own text carries, or null. Reads ONLY the card's table: a card that
 * declares none recognises nothing, so a route is never blocked by a pattern nobody owns (#341).
 * @param {object} card @param {string} text the provider's own words
 */
export function matchProviderRefusal(card, text) {
  const rows = card?.providerRefusals;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  if (typeof text !== 'string' || text.length === 0) return null;
  for (const row of rows) if (refusalMatcher(row.pattern).test(text)) return row;
  return null;
}

/** #387: the adapter-card axis a SESSION route's readiness reads — the closed provider-refusal
 * table the card publishes for its own harness. Declared beside the vocabulary it checks, in the
 * SAME `{axis, consumes, validate}` shape every card axis in adapter-contract.mjs declares, so the
 * card contract admits ONE rule by reference instead of re-deriving it.
 *
 * The value must BE `providerRefusalsForHarness(card.harness)`. Cards for the session tiers
 * (claude-session.mjs, codex-appserver.mjs, kimi-acp.mjs, grok-acp.mjs) published no such key at
 * all, so `matchProviderRefusal` returned null for every text they ever wrote and a #348-style
 * provider death left the route reading ready while each successor on it died the same way. That
 * silent-ready degradation is a CONSTRUCTION error: a card that publishes no table, or one it
 * assembled itself instead of deriving from its harness, refuses where it is built. */
export const PROVIDER_REFUSALS_CARD_AXIS = Object.freeze({
  axis: 'providerRefusals',
  consumes: 'route readiness matches a crash/turn-failure text against card.providerRefusals (#341/#387)',
  validate: (value, harness) => {
    const derived = providerRefusalsForHarness(harness);
    if (!Object.is(value, derived)) {
      throw Object.assign(new TypeError(
        `adapter card for ${harness} does not publish its harness's own provider-refusal table (${derived.length} row(s)): a route read from it can never block on a provider refusal — publish providerRefusals: providerRefusalsForHarness(${JSON.stringify(harness)}), one derivation, never a copy`,
      ), { code: 'adapter_card_incomplete', detail: { axis: 'providerRefusals', missing: ['providerRefusals'] } });
    }
  },
});

/** The card-contract gate for the axis above: every session tier that can seat a route renders its
 * card through this, so the tier refuses at construction rather than reading ready forever. */
export function assertCardProviderRefusals(card) {
  PROVIDER_REFUSALS_CARD_AXIS.validate(card?.providerRefusals, card?.harness ?? 'unknown');
  return card;
}

const STOP_SETTLE_MS = 8;
const MOCK_TOKEN_METRIC = 'mock_scenario_tokens';

function mockUsage(scenario, counterId) {
  const usage = scenario?.budgetUsed;
  const tokensReported = Number.isSafeInteger(usage?.tokens) && usage.tokens >= 0;
  const usdReported = Number.isFinite(usage?.usd) && usage.usd >= 0;
  return {
    payload: {
      source: 'mockScenario', accounting: 'delta',
      ...(tokensReported ? { tokens: usage.tokens } : {}),
      ...(usdReported ? { usd: usage.usd } : {}),
      ...((tokensReported || usdReported) ? { counterId, tokenMetric: tokensReported ? MOCK_TOKEN_METRIC : null } : {}),
    },
    seal: {
      tokens: tokensReported ? 'reported' : 'unavailable',
      usd: usdReported ? 'reported' : 'unavailable',
      counterId: (tokensReported || usdReported) ? counterId : null,
      tokenMetric: tokensReported ? MOCK_TOKEN_METRIC : null,
    },
    reported: tokensReported || usdReported,
  };
}

function localGitEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('GIT_')) env[key] = value;
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
}

function localGit(args, cwd, opts = {}) {
  return execFileSync('git', args, { ...opts, cwd, env: localGitEnv() });
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown (as a Promise rejection from `run`) when the WORKER PROCESS ITSELF dies
 * unexpectedly — distinct from a WorkerResult with status "failed".
 */
export class AdapterCrashError extends Error {
  /** @param {{workerId: string, taskId?: string, cause?: unknown}} info */
  constructor(info = {}) {
    super(`AdapterCrashError: worker ${info.workerId ?? 'unknown'} crashed`);
    this.name = 'AdapterCrashError';
    this.workerId = info.workerId;
    this.taskId = info.taskId;
    this.cause = info.cause;
  }
}

/**
 * Ack vocabulary — the exact meaning of every field an interrupt()/kill() return value may carry.
 * Both verbs return this shape; nothing else about a stop may be smuggled onto it.
 *
 *   ok:true        — the request was accepted (or is a moot no-op). On its own it is NOT a
 *                    confirmation: it says the request was delivered/understood, not that the
 *                    worker stopped.
 *   emulated:true  — the stop is a signal or supervisor action rather than a graceful protocol
 *                    operation. Declared, never silent.
 *   notSent:true   — nothing was written to the provider; the Ack is not delivery evidence.
 *   terminal:true  — ONE meaning: this worker's stop is ALREADY SETTLED, so no stop-confirmation
 *                    event will ever be emitted for this operation, and this Ack IS that
 *                    confirmation. Every adapter sets it for that same fact, from whichever
 *                    evidence proves it: the owning session is already terminal (its in-memory
 *                    turn machine has ended and can publish nothing further about it), or the
 *                    owned process generation is already reaped (its close latch confirmed), or
 *                    no owned session/process exists at all. Those are several proofs of ONE
 *                    fact — an already-stopped worker cannot become more stopped — so one field
 *                    carries them; splitting them would invent a distinction no consumer can act
 *                    on (the coordinator's `_wireAck` reads it as "treat the Ack as the
 *                    confirmation").
 *   terminal absent — the stop is NOT settled: it arrives as an event
 *                    (control.interrupt_confirmed / kill.confirmed) on the onEvent stream.
 *   result         — never present on an Ack; a turn's result rides the terminal event.
 *
 * The two verbs are asymmetric, and the Ack must not blur it. An interrupt of an idle-but-LIVE
 * session is confirmed by the EVENT: the session survives the stop, so there is still a fact to
 * publish, and `terminal:true` would be a lie about a live worker. An interrupt of a session that
 * is already terminal is confirmed by the ACK, because no further fact about it can exist.
 */
// #195 (PA-A): the adapter contract Definition role as a NAMED export — the shape a registry checks
// against. assertIsAdapter derives its required-method list from this declaration so the contract
// and the check share one source.
export const ADAPTER_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  methods: Object.freeze(['card', 'spawn', 'prompt', 'interrupt', 'approve', 'answer', 'kill', 'onEvent']),
});

/** Throws TypeError with a precise message if `obj` doesn't duck-type the D1 Adapter. */
export function assertIsAdapter(obj) {
  if (!obj || typeof obj !== 'object') {
    throw new TypeError('assertIsAdapter: expected an object implementing the D1 Adapter contract');
  }
  for (const method of ADAPTER_CONTRACT_DEFINITION.methods) {
    if (typeof obj[method] !== 'function') {
      throw new TypeError(`assertIsAdapter: missing required method "${method}()"`);
    }
  }
}

// ── The adapter listener slot is a CHAIN, never a single owner (#477) ───────────────────────────
//
// Every tier spells `onEvent(cb)` as ONE private slot (`_cb`, `_userCb`, `_onEvent`, `_callback`)
// and delivers to exactly that listener. Two consumers register on the same adapter object — the
// coordinator's worker-event seam and the deployment's liveness observer — and on the ASYNC open
// path (coordinationAsyncOpen, #351 lane 3 / #434) the coordinator's registration lands AFTER the
// liveness wrapper: the wrapper is installed while the deployment opens, and the coordinator
// registers when its deferred startup reconstruction completes. A registration that REPLACES the
// slot therefore strands every observer installed before it — measured, a probe's
// `lifecycle.spawned` / `resource.provider_call` / `lifecycle.turn_completed` all fired and the
// liveness controller observed none of them, so `ensure()` waited out its (unref'd) deadline and
// settled `unknown` on every real deployment, silently (#477).
//
// The law that makes registration order irrelevant is spelled HERE, once, beside the contract that
// declares `onEvent`: a registration OBSERVES ALONGSIDE, it never replaces. Both consumers call it,
// so a tier that adds a fifth private slot name — or a consumer that registers later — cannot drift
// from the one place that reads the slot.
const ADAPTER_LISTENER_SLOTS = Object.freeze(['_userCb', '_cb', '_onEvent', '_callback']);

/** The listener an adapter currently delivers to, across every tier's private slot spelling. */
function adapterListener(adapter) {
  for (const slot of ADAPTER_LISTENER_SLOTS) {
    const listener = adapter?.[slot];
    if (typeof listener === 'function') return listener;
  }
  return null;
}

/** Register `observer` as an ADDITIONAL adapter listener: whoever the adapter already delivers to
 * keeps receiving every event, so no consumer is orphaned by a later registration — the newest
 * registration holds the slot and forwards to the one it replaced. */
export function observeAdapterEvents(adapter, observer) {
  if (typeof adapter?.onEvent !== 'function' || typeof observer !== 'function') return;
  const prior = adapterListener(adapter);
  adapter.onEvent(prior ? (event) => { prior(event); observer(event); } : observer);
}

// ---------------------------------------------------------------------------
// renderBrief — the ONE provider-facing brief renderer (audit A-F1/A-I1). Pure function, no side
// effects.
//
// Every tier renders through this function: the session adapters pass their own dialect tag, and
// `renderPrompt` (cli-adapters.mjs) is the `cli` dialect of this same table. A dialect changes how
// a fixed set of lines READ; it never changes WHICH sections a worker receives — a tier that is
// never told its write authority, whether repository mutation is authorized, which tools are
// advertised, what budget it holds or what it must output is exactly the bug this seam prevents.
// ---------------------------------------------------------------------------

/** The dialect rendered by `renderPrompt` — the Claude-family session tier and the one-shot CLIs. */
export const CLI_PROMPT_DIALECT = 'cli';

/** The advertised tools, normalized to names: an entry is a bare name or an MCP tool object. */
function advertisedToolNames(tools) {
  if (!Array.isArray(tools)) return [];
  const names = [];
  for (const tool of tools) {
    const name = typeof tool === 'string' ? tool : (typeof tool?.name === 'string' ? tool.name : null);
    if (!name || names.includes(name)) continue;
    names.push(name);
  }
  return names;
}

/**
 * A-F2/A-I2: both dialects order the worker to use only the tools this Brief advertises, so both
 * list them. An empty advertisement is said out loud — silence is what made that order unfollowable.
 */
function renderToolsSection(tools) {
  const names = advertisedToolNames(tools);
  if (names.length === 0) {
    return [
      '## Tools',
      'No tools are advertised for this Brief. Use only your own native harness tools; do not search for, launch or invent a Baton surface that is not advertised here.',
    ];
  }
  return [
    '## Tools',
    'Use only the tools advertised here for Baton actions; any other Baton surface is not authorized for this task.',
    ...names.map((name) => `- ${name}`),
  ];
}

/**
 * A-F3: the budget ships as what it factually is — notify-only evidence. Token and USD spend is
 * measured against the deployment's thresholds and a crossing raises a `budget_alarm` for the
 * orchestrator; wall time is advisory because the #163 law retired the wall-time fate clock.
 */
function renderBudgetSection(budget) {
  if (!budget || typeof budget !== 'object' || Array.isArray(budget)) return [];
  const thresholds = [];
  if (Number.isFinite(budget.tokens)) thresholds.push(`- tokens: ${budget.tokens}`);
  if (Number.isFinite(budget.usd)) thresholds.push(`- usd: ${budget.usd}`);
  if (Number.isFinite(budget.wallMin)) thresholds.push(`- wall: ${budget.wallMin} minutes (advisory — no wall-time clock feeds fate)`);
  if (thresholds.length === 0) return [];
  return [
    '## Budget (notify-only evidence — a threshold never stops you)',
    'These are thresholds, not limits on the work: Baton measures your spend against them and raises a notify-only budget alarm for the orchestrator when one is crossed. Crossing one never stops, interrupts or fails your turn; no clock, counter or threshold decides a member\'s fate here (#163).',
    ...thresholds,
    'Work to the Definition of done; if the budget runs out, report it in your result instead of abandoning the work silently.',
  ];
}

// The per-dialect lines that legitimately read differently. A row overrides how a line READS —
// never which sections ship, and never whether an authority paragraph is present.
const CANONICAL_PRESENTATION = Object.freeze({
  goal: (brief) => ['## Goal', brief.goal ?? ''],
  context: (brief) => [
    '## Immutable Context',
    `Call: ${brief.contextInput.callId}`,
    brief.contextInput.unitId
      ? `Unit: ${brief.contextInput.unitId}`
      : `Partition: ${brief.contextInput.partitionId}`,
    'Use the attached value directly; do not replace it with a broader repository review:',
    JSON.stringify(brief.contextInput.value, null, 2),
  ],
  constraints: (brief) => ['## Constraints', ...brief.constraints.map((constraint) => `- ${constraint}`)],
  pathScope: (brief) => ['## Path scope', ...brief.pathScope.map((scope) => `- ${scope}`)],
  definitionOfDone: (brief) => ['## Definition of done', brief.definitionOfDone ?? ''],
  worktree: () => [],
  verificationLead: () => [],
});

const DIALECT_PRESENTATION = Object.freeze({
  [CLI_PROMPT_DIALECT]: Object.freeze({
    goal: (brief) => [`Task: ${brief.goal ?? ''}`],
    context: (brief) => [
      'Attached immutable Context (the authoritative input for this task):',
      `Call: ${brief.contextInput.callId}`,
      brief.contextInput.unitId
        ? `Unit: ${brief.contextInput.unitId}`
        : `Partition: ${brief.contextInput.partitionId}`,
      'Use the attached value directly. Do not search the repository for this source or replace it with a broader review.',
      JSON.stringify(brief.contextInput.value, null, 2),
    ],
    constraints: (brief) => [`Constraints:\n- ${brief.constraints.join('\n- ')}`],
    pathScope: (brief) => [`Work only within: ${brief.pathScope.join(', ')}`],
    definitionOfDone: (brief) => [`Done when: ${brief.definitionOfDone ?? ''}`],
    worktree: () => ['You are in a dedicated git worktree; edit files here directly. Do not push or run destructive commands.'],
    verificationLead: (brief) => [brief.contextInput
      ? 'A reviewer independently enforces the following exact execution contract. Run it only when the requested work needs code verification; do not substitute it for analyzing the attached Context.'
      : 'A reviewer will independently enforce the following exact execution contract. Make it pass without changing its executable, argv, working directory, or expected exit.'],
  }),
});
/** #341 part 3: the ONE rendering of a deployment's route-usage rows — one `- ` line per served
 * route, the shape both the seat's brief and the provider-facing `### Route usage` subsection
 * show. `recruitable` is the GRANT fact (may this seat recruit on the route at all, and is the
 * route in a state a recruit would be admitted on); it is rendered only when a row carries it, so
 * a reader with no grant in hand renders exactly what part 1 rendered. #444: `design` is the
 * route's best Design Arena arena and Elo (the same fact the doctor's profile row carries),
 * rendered only when the row HAS one — a route whose design axis is absent says why on the doctor
 * row, never with a fabricated number here. */
export function renderRouteUsageLines(rows) {
  const lines = [];
  for (const row of rows) {
    const r = row.route;
    const tag = `${r.harness}/${r.model}@${r.effort}`;
    const parts = [`${tag}: ${row.state}`];
    if (row.usage) parts.push(`turns=${row.usage.turns} tokens=${row.usage.tokens}`);
    if (row.quota?.state === 'exhausted') parts.push(`quota=exhausted resetAt=${row.quota.resetAt ?? 'unknown'}`);
    if (row.concurrency) parts.push(`concurrency=${row.concurrency.inUse}/${row.concurrency.ceiling ?? '∞'}`);
    const design = row.profile?.design?.arenas?.[0] ?? null;
    if (design !== null) parts.push(`design: ${design.arena} ${design.elo}`);
    if (typeof row.recruitable === 'boolean') parts.push(`recruitable=${row.recruitable}`);
    lines.push(`- ${parts.join(' | ')}`);
  }
  return lines;
}

/**
 * @param {object} brief
 * @param {'codex-v2'|'claude'|'grok-acp'|'kimi-acp'|'omp-rpc'|'cli'} dialect
 * @returns {string}
 */
export function renderBrief(brief, dialect) {
  const presentation = DIALECT_PRESENTATION[dialect] ?? CANONICAL_PRESENTATION;
  const advertisesBatonTool = advertisesBatonControlSurface(brief.tools);
  const pathScopeRendered = Array.isArray(brief.pathScope) && brief.pathScope.length > 0;
  const lines = [`[baton brief:${dialect}]`];
  lines.push(...presentation.goal(brief));
  lines.push('## Dispatch');
  if (brief.contextInput) {
    lines.push(advertisesBatonTool
      ? 'This task is already dispatched by Baton. The attached immutable Context is the complete task input; do not inspect repository files, prior Run artifacts, receipts, or ledgers to reconstruct or broaden it. Writing a named output path does not authorize reading its preexisting contents. Orchestration actions may use only the Baton control surface explicitly listed in this Brief.'
      : 'This task is already dispatched and supervised by Baton. The attached immutable Context is the complete task input; do not inspect repository files, prior Run artifacts, receipts, or ledgers to reconstruct or broaden it. Writing a named output path does not authorize reading its preexisting contents. Do not search for or launch another Baton CLI, MCP server, or Run; use one only when this Brief explicitly advertises it.');
    lines.push(...presentation.context(brief));
  } else {
    lines.push('This task is already dispatched by Baton. Use your configured native harness tools, skills, context management and delegation to carry out the assigned work within its authority, and use only the tools explicitly advertised in this Brief. Delegated participants inherit the same constraints. Any Baton tools listed here extend those native capabilities.');
    // Two delegation mechanisms coexist (#275): the swarm governs recruits (permissions, capture,
    // review, stop); a harness's native subagents are observed only. Say so where the choice is made.
    lines.push(advertisesBatonTool
      ? 'Delegation: recruit through the Baton swarm surface listed here (swarm.recruit) for work the swarm should be able to review, capture or stop; use your harness\'s native subagents only for short, disposable exploration — the swarm observes them but cannot govern or stop them.'
      : 'Delegation: your harness\'s native subagents are observed by Baton but not governed by it — it cannot review, capture or stop them; keep them to short, disposable exploration and do the accountable work yourself.');
  }
  lines.push(...renderToolsSection(brief.tools));
  // Issue #309: a swarm participant's brief carries its Baton surface as one `## Swarm`
  // section. The text is derived ONCE (swarm-native-access.mjs: SWARM_NATIVE_GUIDANCE plus the
  // bridge's own guidance) and arrives ready-made on the provider-facing brief value; the ONE
  // renderer owns only the heading, so every dialect reads the same surface.
  if (brief.swarm) {
    lines.push('## Swarm', '', brief.swarm);
    if (Array.isArray(brief.routeUsage) && brief.routeUsage.length > 0) {
      lines.push('', '### Route usage', ...renderRouteUsageLines(brief.routeUsage));
    }
  }
  // Issue #305: the lane contract a recruit was given rides the provider-facing brief as
  // its own section — derived ONCE by the owner (the recruit join brief the swarm recorded),
  // the ONE renderer owns only the heading, like ## Swarm above. A missing or blank
  // contract renders nothing (the #89 frame-waste law lives at the renderer, never the seam).
  if (typeof brief.laneContract === 'string' && brief.laneContract.trim().length > 0) {
    lines.push('## Lane contract', '', brief.laneContract);
  }
  lines.push('## Write authority');
  // A-F4: name `## Path scope` in the authority paragraph only when that section is rendered.
  lines.push([
    'Harness permissions are execution capability, not write authority.',
    pathScopeRendered
      ? 'Write only inside the assigned Baton worktree and only at the Path scope below.'
      : 'Write only inside the assigned Baton worktree; this Brief declares no narrower write scope, so the worktree root is the whole of it.',
    'Never modify, move, chmod, delete, replace, or repair anything outside that authority, including the home directory, credentials, toolchains, shims, global configuration, or caches.',
    'Report an environmental blocker instead of repairing the host.',
  ].join(' '));
  if (Array.isArray(brief.requiredEffects) && brief.requiredEffects.includes('repository_edit')) {
    lines.push('## Repository mutation authority');
    lines.push('The approved Plan requires an in-scope repository edit for acceptance. Objective prose does not weaken this requirement.');
  } else if (Array.isArray(brief.effects) && !brief.effects.includes('repository_edit')) {
    lines.push('## Repository mutation authority');
    lines.push('Repository mutation is not authorized. Inspect/read and return evidence only; do not create, modify, or delete files.');
  }
  // Issue #334 acceptance: a read-only brief states exactly what acceptance will check, so
  // the worker never trades prose for a diff. The condition mirrors the trust gate's own
  // read-only signal (coordinator.mjs: effects without repository_edit), and the receipt
  // names the exact typed verdict the gate records.
  if (Array.isArray(brief.effects) && !brief.effects.includes('repository_edit')) {
    lines.push('## Acceptance');
    lines.push('Acceptance checks the captured diff, not prose: when the capture changed no path the hub runs no pinned verification and records {outcome: passed, diagnosticCode: verification_not_required, reason: read_only_no_change}, and the textual result completes the run; when the capture changed paths the scope gates apply and the hub re-runs the pinned verification below.');
  }
  if (Array.isArray(brief.constraints) && brief.constraints.length > 0) {
    lines.push(...presentation.constraints(brief));
  }
  if (pathScopeRendered) lines.push(...presentation.pathScope(brief));
  lines.push(...presentation.definitionOfDone(brief));
  lines.push(...presentation.worktree(brief));
  lines.push(...renderBudgetSection(brief.budget));
  lines.push('## Verification (preserve this execution contract; also satisfy the assigned work)');
  lines.push(...presentation.verificationLead(brief));
  const contract = renderVerificationExecution(brief.verification);
  if (contract) {
    lines.push(contract);
    // A-N4: the trust boundary, stated in every dialect. The pinned check is never trusted from the
    // worker — the hub re-runs it, and the worker's own claim about it is not evidence.
    lines.push('The hub re-runs this exact command independently after you finish; the exit code you report is untrusted and is never the evidence — make the command itself pass.');
  }
  if (brief.outputFormat) {
    lines.push('## Output format');
    lines.push(brief.outputFormat);
  }
  // KG activation rule 1: the ambient knowledge slice rides the provider-facing brief value (never
  // task.brief — briefDigest is byte-stable). renderBrief is the serving seam; the slice is built by
  // the coordinator from recalled knowledge and provenance-wrapped {knowledge, untrusted:true}.
  if (brief.knowledge) {
    lines.push('## Ambient knowledge (provenance: knowledge — untrusted, verify before use)');
    const items = Array.isArray(brief.knowledge.items) ? brief.knowledge.items : [];
    if (items.length === 0) {
      lines.push('(none — no recalled knowledge matched this objective)');
    } else {
      for (const item of items) {
        const window = item.validTo ? `${item.validFrom ?? 'origin'}→${item.validTo}` : `${item.validFrom ?? 'origin'}→ongoing`;
        lines.push(`- [knowledge/untrusted] ${item.ref} (${window}): ${item.snippet ?? ''}`);
      }
      if (brief.knowledge.truncated) {
        lines.push('- (truncated — more knowledge exists beyond the serve ceiling)');
      }
    }
  }
  // Issue #59 (D2/R9): the ONE total order for the carried-content sections is
  // `## Ambient knowledge` → `## Re-drive continuity` → `## Cited REPL objects` →
  // `## Pending attention`. Ambient knowledge and re-drive continuity are both context evidence
  // ("here is what you should know") and sit together first; cited REPL objects are
  // orchestrator-authored INPUT data the worker needs before acting, so they land after the
  // carried state and before the operational push; pending attention is operational push about the
  // worker's own lane traffic and stays the final lines. The `## Verification` contract above keeps
  // its position ahead of all of them, and every section is absent when it has nothing to serve
  // (the absence-on-empty pin, the #89 frame-waste law).
  const continuity = renderContinuitySection(brief.continuity);
  if (continuity) lines.push(continuity);
  // Issue #69 (D2/D7): the cited REPL objects, rendered by the family that owns their frame, their
  // bounding and their shed marker.
  const cited = renderReplObjectsSection(brief.replObjects);
  if (cited) lines.push(cited);
  // Issue #79 (D1): the worker-delivery push block lands AFTER the last data-bearing section
  // (`## Ambient knowledge`) so the `## Verification` contract keeps its position. Absent when
  // there is nothing to serve (the empty-pending-set pin).
  const attention = renderAttentionSection(brief.attention);
  if (attention) lines.push(attention);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// MockAdapter internals
// ---------------------------------------------------------------------------

function validateScenario(scenario) {
  if (!scenario || typeof scenario !== 'object') {
    return { ok: false, reason: 'MockAdapter: scenario is required' };
  }
  const validOutcomes = ['completed', 'failed', 'blocked', 'cancelled'];
  if (!validOutcomes.includes(scenario.outcome)) {
    return { ok: false, reason: `MockAdapter: scenario.outcome must be one of ${validOutcomes.join('|')}, got "${scenario.outcome}"` };
  }
  if (scenario.outcome === 'blocked' && !scenario.blocker) {
    return { ok: false, reason: 'MockAdapter: scenario.outcome "blocked" requires scenario.blocker to be set' };
  }
  return { ok: true };
}

function haltableDelay(ms, signal) {
  return new Promise((resolve) => {
    if (ms <= 0 || signal.aborted) { resolve(); return; }
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

function haltableAskWait(session, haltSignal = session.haltSignal) {
  return new Promise((resolve) => {
    const cleanup = () => {
      haltSignal.removeEventListener('abort', onAbort);
      session.askResolve = null;
    };
    const onAbort = () => { cleanup(); resolve({ aborted: true }); };
    session.askResolve = (outcome) => { cleanup(); resolve(outcome); };
    if (haltSignal.aborted) { onAbort(); return; }
    haltSignal.addEventListener('abort', onAbort, { once: true });
  });
}

export class MockAdapter {
  /**
   * @param {{harness?: string, version?: string, concurrencyCeiling?: number|null,
   *           maxContext?: number, scenario: object}} config
   */
  constructor(config = {}) {
    // Card fields may be given flat (config.harness) or nested in a `card` bag
    // (config.card.harness); the nested form wins where both are present.
    const c = { ...config, ...(config.card ?? {}) };
    this._harness = c.harness ?? 'mock';
    this._version = c.version ?? '1.0.0';
    this._model = c.model ?? 'mock-model';
    this._concurrencyCeiling = normalizeConcurrencyCeiling(c.concurrencyCeiling, 'MockAdapter concurrencyCeiling');
    this._maxContext = c.maxContext ?? 128000;
    this._defaultScenario = config.scenario;
    /** @type {Map<string, object>} */
    this._sessions = new Map();
    this._userCb = null;
    this._internalListeners = [];
    this._reqSeq = 0;
  }

  card() {
    return {
      harness: this._harness,
      version: this._version,
      // The mock adapter declares its exact route capability like every real adapter, so a
      // profile route {mock, mock-model, low} validates through the application's
      // selectExactRouteCard gate without a test-side card override. configuredDefault stays
      // null (an unrequested model resolves to the router's 'default' tuple, exactly as before
      // the card gained a modelSelection), while `available` names the concrete model so an
      // explicit route can match. The family stays the router's default (tests record route
      // wins under `family: 'default'`), never the harness name.
      modelSelection: {
        mode: 'exact', configuredDefault: null, available: [this._model],
        family: 'default', acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: ['low'], serviceTier: null,
      },
      authPosture: 'api_key',
      concurrencyCeiling: this._concurrencyCeiling,
      maxContext: this._maxContext,
      governance: {
        usage: { tokens: 'native', usd: 'native', tokenMetric: MOCK_TOKEN_METRIC, terminalSeal: 'native' },
        providerCalls: { observation: 'unavailable', enforcement: 'unavailable' },
        toolCalls: { observation: 'unavailable', enforcement: 'unavailable' },
        maxWireFrameBytes: 1024 * 1024,
      },
      // SC8: canonical 8-verb card. steer rides prompt(mode:'steer'), approve/answer ride the
      // respond flow — all genuinely implemented here; pause has no implementation and says so.
      verbs: { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported' },
      // #341 part 2: the double stands in for a REAL harness, so it publishes that harness's
      // closed provider-refusal table — a fixture can then drive the readiness derivation through
      // the same card vocabulary a live route would.
      providerRefusals: providerRefusalsForHarness(this._harness),
      // Part B (issue #16): a structured decision.requested/answer(optionId|text) event pair,
      // not text-grammar parsing — honestly 'native' for this deterministic test double.
      decision: 'native',
    };
  }

  onEvent(cb) {
    this._userCb = cb;
  }

  _addInternalListener(cb) { this._internalListeners.push(cb); }
  _removeInternalListener(cb) {
    const i = this._internalListeners.indexOf(cb);
    if (i >= 0) this._internalListeners.splice(i, 1);
  }

  _emit(session, kind, payload) {
    const evt = {
      worker: session.worker,
      harness: `${this._harness}@${this._version}`,
      turnEpoch: session.opts.turnEpoch ?? 0,
      kind,
      actor: 'worker',
      payload,
    };
    if (session.opts.log) session.opts.log.append({ ...evt });
    if (this._userCb) this._userCb(evt);
    for (const cb of this._internalListeners.slice()) cb(evt);
    return evt;
  }

  _clearTimers(session) {
    if (session.crashTimer) clearTimeout(session.crashTimer);
    if (session.timeoutTimer) clearTimeout(session.timeoutTimer);
    if (session.settleTimer) clearTimeout(session.settleTimer);
  }

  _scheduleSettle(session) {
    if (session.settleTimer) clearTimeout(session.settleTimer);
    session.settleTimer = setTimeout(() => this._finalizeStop(session.worker), STOP_SETTLE_MS);
  }

  /**
   * @param {string} worker
   * @param {object} brief
   * @param {object} opts
   * @returns {Promise<{ok:boolean, reason?:string}>}
   */
  async spawn(worker, brief, opts = {}) {
    if (opts.attachOnly === true && opts.session?.mode !== 'resume') {
      return {
        ok: false,
        code: 'attach_only_requires_resume',
        reason: 'attach-only is an internal native-resume primitive',
      };
    }
    const scenario = opts.scenario ?? this._defaultScenario;
    const validation = validateScenario(scenario);
    if (!validation.ok) return { ok: false, reason: validation.reason };

    const existing = this._sessions.get(worker);
    if (existing && !existing.terminal) {
      return { ok: false, reason: `worker ${worker} already has an active session` };
    }

    const haltController = new AbortController();
    const session = {
      worker, brief, scenario, opts,
      attachedOnly: opts.attachOnly === true,
      runStarted: false,
      turnGeneration: 0,
      haltController, haltSignal: haltController.signal,
      stopKind: null, terminal: false, crashed: false,
      wait: null, askHandled: false, askResolve: null,
      commits: [], appliedPaths: [], editsApplied: 0, totalEdits: scenario.edits?.length ?? 0,
      settleTimer: null, crashTimer: null, timeoutTimer: null,
      timeoutHit: false, deniedApproval: false,
    };
    this._sessions.set(worker, session);

    if (scenario.crashAfterMs !== undefined) {
      session.crashTimer = setTimeout(() => this._triggerCrash(worker), scenario.crashAfterMs);
    }
    if (opts.timeoutMs) {
      session.timeoutTimer = setTimeout(() => this._triggerTimeout(worker), opts.timeoutMs);
    }
    if (opts.signal) {
      if (opts.signal.aborted) this._beginStop(worker, 'interrupt');
      else opts.signal.addEventListener('abort', () => this._beginStop(worker, 'interrupt'), { once: true });
    }

    if (!session.attachedOnly) this._startSession(session);

    return { ok: true, ...(session.attachedOnly ? { attached: true } : {}) };
  }

  _startSession(session) {
    if (session.runStarted || session.terminal) return;
    session.runStarted = true;
    session.turnGeneration += 1;
    const turnGeneration = session.turnGeneration;
    const haltSignal = session.haltSignal;
    this._runSession(session, { turnGeneration, haltSignal }).catch((err) => {
      // A preserved successor owns a new signal generation. An older coroutine can neither
      // crash nor terminalize that shared native session after its own signal was aborted.
      if (session.turnGeneration !== turnGeneration) return;
      // WF2/WF3: the Coordinator owns readiness failure and already emitted its sole typed,
      // non-leaking terminal fact. Mock must not duplicate it as a worker crash after performing
      // no worker effect. Direct test callers likewise receive no fabricated native lifecycle.
      if (err?.code === 'worktree_unavailable') {
        session.terminal = true;
        this._clearTimers(session);
        return;
      }
      // An unexpected failure mid-session (e.g. an underlying git operation errored for a
      // reason we didn't anticipate) is an adapter/process-level failure, not a worker
      // outcome — surface it as a crash rather than leaving the session silently hung.
      if (!session.terminal) {
        session.crashed = true;
        session.terminal = true;
        this._clearTimers(session);
        this._emit(session, 'lifecycle.crashed', {
          error: String(err?.message ?? err),
          usageSeal: { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null },
        });
      }
    });
  }

  /**
   * One-shot convenience = spawn + await the terminal event + translate.
   * @param {object} brief
   * @param {object} opts
   * @returns {Promise<object>} WorkerResult
   * @throws {AdapterCrashError|TypeError}
   */
  async run(brief, opts = {}) {
    const worker = opts.workerId ?? 'w_unknown';
    let listener;
    const resultPromise = new Promise((resolve, reject) => {
      listener = (e) => {
        if (e.worker !== worker) return;
        if (e.kind === 'lifecycle.turn_completed' || e.kind === 'control.interrupt_confirmed' || e.kind === 'kill.confirmed') {
          this._removeInternalListener(listener);
          resolve(e.payload.result);
        } else if (e.kind === 'lifecycle.crashed') {
          this._removeInternalListener(listener);
          reject(new AdapterCrashError({ workerId: worker, cause: e.payload?.error }));
        }
      };
    });
    this._addInternalListener(listener);
    const ack = await this.spawn(worker, brief, opts);
    if (!ack.ok) {
      this._removeInternalListener(listener);
      throw new TypeError(ack.reason ?? 'MockAdapter: spawn rejected');
    }
    return resultPromise;
  }

  async prompt(worker, content, mode = 'turn') {
    const session = this._sessions.get(worker);
    if (!session) return { ok: false, notSent: true, reason: `unknown worker ${worker}` };
    if (session.terminal && (session.stopKind !== null || session.crashed)) {
      return { ok: false, notSent: true, reason: 'native session is closed' };
    }
    const nextTurn = mode === 'turn' && session.terminal;
    if (nextTurn) {
      const haltController = new AbortController();
      Object.assign(session, {
        terminal: false, runStarted: false, haltController, haltSignal: haltController.signal,
        wait: null, askHandled: false, askResolve: null, commits: [], appliedPaths: [],
        editsApplied: 0, deniedApproval: false, timeoutHit: false,
        opts: { ...session.opts, turnEpoch: (session.opts.turnEpoch ?? 0) + 1 },
      });
    }
    const kindMap = { turn: 'control.send', nudge: 'control.nudge', steer: 'control.steer' };
    this._emit(session, kindMap[mode] ?? 'control.send', { content, mode });
    if ((session.attachedOnly && mode === 'turn') || nextTurn) {
      session.attachedOnly = false;
      this._startSession(session);
    }
    return { ok: true };
  }

  _beginStop(worker, kind) {
    const session = this._sessions.get(worker);
    if (!session) return { ok: false, reason: `unknown worker ${worker}` };
    // D9: every interrupt/kill Ack resolves — never hangs, and a stop request racing a
    // session that already reached a terminal state is a moot no-op, not a failure.
    // A typed terminal Ack lets the coordinator complete its two-phase stop without waiting
    // for an event that cannot be emitted after this in-memory session has already ended.
    if (session.terminal) {
      session.stopKind ??= kind;
      return { ok: true, terminal: true, reason: 'already terminal' };
    }
    if (session.stopKind === null) {
      session.stopKind = kind;
      this._emit(session, kind === 'kill' ? 'kill.requested' : 'control.interrupt_requested', {});
      session.haltController.abort();
      this._scheduleSettle(session);
      return { ok: true };
    }
    if (kind === 'kill' && session.stopKind === 'interrupt') {
      session.stopKind = 'kill';
      this._emit(session, 'kill.requested', {});
      session.haltController.abort();
      this._scheduleSettle(session);
      return { ok: true };
    }
    // Redundant interrupt-while-interrupting, kill-while-killing, or a soft interrupt
    // arriving after a kill is already in flight: attach as a no-op waiter (D9).
    return { ok: true };
  }

  async interrupt(worker, then) {
    void then;
    return this._beginStop(worker, 'interrupt');
  }

  async kill(worker) {
    return this._beginStop(worker, 'kill');
  }

  async approve(worker, requestId, decision, payload) {
    const session = this._sessions.get(worker);
    if (!session) return { ok: false, reason: `unknown worker ${worker}` };
    if (!session.wait || session.wait.kind !== 'approval' || session.wait.requestId !== requestId) {
      return { ok: false, reason: 'approve(): no matching approval wait-item (D1: distinct from answer())' };
    }
    this._emit(session, 'approval.resolved', { requestId, decision, payload: payload ?? null });
    const denied = decision !== 'allow';
    session.askResolve?.({ denied });
    return { ok: true };
  }

  async answer(worker, requestId, answer) {
    const session = this._sessions.get(worker);
    if (!session) return { ok: false, reason: `unknown worker ${worker}` };
    if (!session.wait || !['question', 'decision'].includes(session.wait.kind) || session.wait.requestId !== requestId) {
      return { ok: false, reason: 'answer(): no matching question/decision wait-item (D1: distinct from approve())' };
    }
    if (session.wait.kind === 'decision' && answer?.expired === true) {
      // F5: wire-level expiry cancel — release the worker's turn without emitting a competing
      // worker-side settlement; the hub's decision.expired ledger event is already authoritative.
      session.askResolve?.({ denied: true });
      return { ok: true };
    }
    const eventKind = session.wait.kind === 'decision' ? 'decision.settled' : 'question.answered';
    this._emit(session, eventKind, { requestId, ...answer });
    session.askResolve?.({ denied: false });
    return { ok: true };
  }

  _triggerCrash(worker) {
    const session = this._sessions.get(worker);
    if (!session || session.terminal) return;
    session.crashed = true;
    session.terminal = true;
    this._clearTimers(session);
    session.haltController.abort();
    this._emit(session, 'lifecycle.crashed', {
      error: 'simulated crash (scenario.crashAfterMs elapsed)',
      usageSeal: { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null },
    });
  }

  _triggerTimeout(worker) {
    const session = this._sessions.get(worker);
    if (!session || session.terminal) return;
    session.timeoutHit = true;
    this._beginStop(worker, 'kill');
  }

  _finalizeStop(worker) {
    const session = this._sessions.get(worker);
    if (!session || session.terminal) return;
    session.terminal = true;
    this._clearTimers(session);
    const totalEdits = session.totalEdits;
    const progress = totalEdits > 0 ? session.editsApplied / totalEdits : (session.editsApplied > 0 ? 1 : 0);
    const result = {
      status: 'cancelled',
      progress,
      summary: session.timeoutHit
        ? `stopped: timeout exceeded (${session.opts.timeoutMs}ms)`
        : `stopped via ${session.stopKind}`,
      artifacts: { commits: session.commits.slice(), files: session.appliedPaths.slice() },
      verification: { command: session.brief.verification.command, claimedExit: -1 },
      openQuestions: [],
      budgetUsed: session.scenario.budgetUsed ?? { tokens: 0, usd: 0 },
    };
    const usage = mockUsage(session.scenario, `mock:${session.worker}:${session.opts.turnEpoch ?? 0}`);
    if (usage.reported) this._emit(session, 'resource.tokens', usage.payload);
    const kind = session.stopKind === 'kill' ? 'kill.confirmed' : 'control.interrupt_confirmed';
    this._emit(session, kind, { result, usageSeal: usage.seal });
  }

  _finalizeNatural(session) {
    if (session.terminal) return;
    session.terminal = true;
    this._clearTimers(session);
    const { scenario, brief } = session;
    let status = session.deniedApproval ? 'failed' : scenario.outcome;
    let claimedExit;
    if (scenario.forgeSuccess) {
      status = 'completed';
      claimedExit = brief.verification.expectExit;
    } else if (status === 'completed') {
      claimedExit = brief.verification.expectExit;
    } else {
      claimedExit = brief.verification.expectExit === 0 ? 1 : 0;
    }
    const progress = session.deniedApproval
      ? (session.totalEdits > 0 ? session.editsApplied / session.totalEdits : 0)
      : 1;
    const result = {
      status,
      progress,
      summary: scenario.summary ?? (session.deniedApproval ? 'approval denied' : `mock run ${status}`),
      artifacts: {
        commits: session.commits.slice(),
        diffRef: session.commits.length ? `${session.commits[0]}..${session.commits.at(-1)}` : undefined,
        files: session.appliedPaths.slice(),
      },
      verification: { command: brief.verification.command, claimedExit },
      openQuestions: scenario.openQuestions ?? [],
      budgetUsed: scenario.budgetUsed ?? { tokens: 0, usd: 0 },
    };
    if (status === 'blocked') result.blocker = scenario.blocker;
    const usage = mockUsage(scenario, `mock:${session.worker}:${session.opts.turnEpoch ?? 0}`);
    if (usage.reported) this._emit(session, 'resource.tokens', usage.payload);
    this._emit(session, 'lifecycle.turn_completed', { result, usageSeal: usage.seal });
  }

  async _applyEdit(session, edit) {
    const filePath = join(session.opts.worktree, edit.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, edit.content);
    const authorName = session.scenario.authorName ?? 'baton-worker-mock';
    const authorEmail = session.scenario.authorEmail ?? 'baton-worker-mock@localhost';
    localGit(['add', '-A'], session.opts.worktree);
    // If the edit's path is entirely gitignored (or otherwise produces no staged change),
    // `git add -A` silently skips it and there is nothing for `git commit` to record — the
    // file is still genuinely written to disk (honest, inspectable content), it's just not
    // tracked by git. Detect that case instead of letting `git commit` throw.
    const stagedClean = localGit(['status', '--porcelain'], session.opts.worktree, { encoding: 'utf8' }).trim() === '';
    let sha;
    if (!stagedClean) {
      localGit(
        ['commit', '-q', '-m', `mock edit: ${edit.path}`, `--author=${authorName} <${authorEmail}>`],
        session.opts.worktree,
      );
      sha = localGit(['rev-parse', 'HEAD'], session.opts.worktree, { encoding: 'utf8' }).trim();
      session.commits.push(sha);
    } else {
      sha = localGit(['rev-parse', 'HEAD'], session.opts.worktree, { encoding: 'utf8' }).trim();
    }
    session.appliedPaths.push(edit.path);
    session.editsApplied += 1;
    this._emit(session, 'content.file_edit', { path: edit.path, sha });
  }

  async _runSession(session, turn = {}) {
    const { scenario } = session;
    const haltSignal = turn.haltSignal ?? session.haltSignal;
    const turnGeneration = turn.turnGeneration ?? session.turnGeneration;
    const totalEdits = scenario.edits?.length ?? 0;
    session.totalEdits = totalEdits;

    // A real worker can't edit files before its worktree checkout exists. When the driver
    // creates the worktree asynchronously, it passes a readiness promise; wait for it before
    // announcing a native turn or touching disk. Backward-compatible: absent (e.g. adapter.test
    // with a ready worktree) means the explicit opts.worktree remains authoritative.
    if (session.opts.worktreeReady) {
      const res = await session.opts.worktreeReady;
      if (res && res.path && !session.opts.worktree) session.opts.worktree = res.path;
    }
    if (session.terminal || haltSignal.aborted
      || session.turnGeneration !== turnGeneration) return;
    if (!session.opts.worktree) throw new Error('worktree unavailable');
    this._emit(session, 'lifecycle.turn_started', {});

    const ask = scenario.ask;
    const askIndex = ask ? (ask.afterEditIndex ?? 0) : null;

    for (let i = 0; i <= totalEdits; i += 1) {
      if (ask && askIndex === i && !session.askHandled) {
        session.askHandled = true;
        const kind = ask.kind === 'approval' ? 'approval' : ask.kind === 'decision' ? 'decision' : 'question';
        const requestId = `req_${session.worker}_${(this._reqSeq += 1)}`;
        session.wait = { kind, requestId };
        if (kind === 'decision') {
          // Part B / F9: MockAdapter's deterministic emulated decision channel.
          this._emit(session, 'decision.requested', {
            requestId,
            request: {
              question: ask.question,
              options: ask.options,
              allowFreeResponse: ask.allowFreeResponse ?? false,
              recommended: ask.recommended ?? null,
              deadlineMs: ask.deadlineMs,
            },
          });
        } else {
          this._emit(
            session,
            kind === 'approval' ? 'approval.requested' : 'question.asked',
            { question: ask.question, requestId, blocking: ask.blocking !== false },
          );
        }
        // F6: v1 decisions are always blocking; question/approval keep their own blocking flag.
        if (kind === 'decision' || ask.blocking !== false) {
          const outcome = await haltableAskWait(session, haltSignal);
          session.wait = null;
          if (session.terminal) return;
          if (haltSignal.aborted || session.turnGeneration !== turnGeneration) break;
          if (outcome.denied) { session.deniedApproval = true; break; }
          for (const e of (ask.onAnswerEdits ?? [])) {
            if (haltSignal.aborted || session.turnGeneration !== turnGeneration) break;
            if (e.delayMs) await haltableDelay(e.delayMs, haltSignal);
            if (haltSignal.aborted || session.turnGeneration !== turnGeneration) break;
            await this._applyEdit(session, e);
          }
        }
      }

      if (session.terminal) return;
      if (haltSignal.aborted || session.turnGeneration !== turnGeneration) break;
      if (i === totalEdits) break;

      const edit = scenario.edits[i];
      if (edit.delayMs) {
        await haltableDelay(edit.delayMs, haltSignal);
        if (haltSignal.aborted || session.turnGeneration !== turnGeneration) break;
      }
      await this._applyEdit(session, edit);
    }

    if (session.terminal) return;
    if (haltSignal.aborted || session.turnGeneration !== turnGeneration) return;
    // Test pacing only: a scenario may hold its turn open for a while before settling, so a
    // fixture can observe a continuation (a nudge, a guide) as live work rather than as the
    // next checkpoint that an instant turn would already have reached.
    if (Number.isFinite(scenario.turnDelayMs) && scenario.turnDelayMs > 0) {
      await haltableDelay(scenario.turnDelayMs, haltSignal);
      if (session.terminal) return;
      if (haltSignal.aborted || session.turnGeneration !== turnGeneration) return;
    }
    this._finalizeNatural(session);
  }
}

// ---------------------------------------------------------------------------
// SubprocessAdapter family — structurally complete, execution-guarded off.
// ---------------------------------------------------------------------------

class SubprocessAdapterBase {
  card() { throw new Error('abstract'); }

  /** @param {object} brief @param {object} opts @returns {{cmd:string,args:string[]}} */
  argv(brief, opts) { void brief; void opts; throw new Error('abstract'); }

  _live(opts) {
    return opts.live === true && process.env.BATON_ALLOW_LIVE_ADAPTERS === '1';
  }

  async run(brief, opts = {}) {
    if (!this._live(opts)) {
      if (opts.simulateMs) await new Promise((r) => setTimeout(r, opts.simulateMs));
      return {
        status: 'blocked',
        progress: 0,
        summary: 'live adapters disabled',
        artifacts: { commits: [], files: [] },
        verification: { command: brief.verification.command, claimedExit: -1 },
        blocker: 'live adapters disabled (set BATON_ALLOW_LIVE_ADAPTERS=1 and opts.live=true)',
        openQuestions: [],
        budgetUsed: { tokens: 0, usd: 0 },
      };
    }
    throw new Error('SubprocessAdapter: live execution path is not implemented in this MVP');
  }

  async spawn(worker, brief, opts = {}) {
    void worker; void brief;
    if (!this._live(opts)) {
      return { ok: false, reason: 'live adapters disabled (set BATON_ALLOW_LIVE_ADAPTERS=1 and opts.live=true)' };
    }
    throw new Error('SubprocessAdapter: live spawn path is not implemented in this MVP');
  }

  async prompt() { return { ok: false, reason: 'SubprocessAdapter: not implemented' }; }
  async interrupt() { return { ok: false, reason: 'SubprocessAdapter: not implemented' }; }
  async approve() { return { ok: false, reason: 'SubprocessAdapter: not implemented' }; }
  async answer() { return { ok: false, reason: 'SubprocessAdapter: not implemented' }; }
  async kill() { return { ok: false, reason: 'SubprocessAdapter: not implemented' }; }
  onEvent(cb) { this._userCb = cb; }
}

export class CodexAdapter extends SubprocessAdapterBase {
  card() {
    return {
      harness: 'codex',
      version: '0.1.0',
      authPosture: 'subscription',
      concurrencyCeiling: null,
      maxContext: 200000,
      permissions: { mode: 'never', sandbox: 'danger-full-access', boundary: 'Unattended full host permissions by default; containment is a separate deployment boundary' },
      // SC8 honesty: SubprocessAdapterBase implements ONLY spawn — prompt/interrupt/approve/
      // answer/kill are not-implemented stubs, and the card may not claim otherwise.
      verbs: { spawn: 'native', prompt: 'unsupported', steer: 'unsupported', interrupt: 'unsupported', approve: 'unsupported', answer: 'unsupported', kill: 'unsupported', pause: 'unsupported' },
      // #341 part 2: the provider refusal text this tier's own provider answers with.
      providerRefusals: providerRefusalsForHarness('codex'),
      decision: 'unsupported',
    };
  }

  argv(brief, opts) {
    void opts;
    return { cmd: 'codex', args: ['--ask-for-approval', 'never', '--sandbox', 'danger-full-access', 'exec', '--json', '--skip-git-repo-check', renderBrief(brief, 'codex-v2')] };
  }
}

export class ClaudeAdapter extends SubprocessAdapterBase {
  card() {
    return {
      harness: 'claude-code',
      version: '0.1.0',
      authPosture: 'subscription',
      concurrencyCeiling: null,
      maxContext: 200000,
      permissions: { mode: 'bypassPermissions', sandbox: 'unverified', boundary: 'Approval autonomy only; host filesystem and network containment are unverified' },
      // SC8 honesty: only spawn is implemented on this legacy subprocess tier (see base stubs).
      verbs: { spawn: 'native', prompt: 'unsupported', steer: 'unsupported', interrupt: 'unsupported', approve: 'unsupported', answer: 'unsupported', kill: 'unsupported', pause: 'unsupported' },
      // #341 part 2: the claude auth refusal (#348) this tier's provider answers with.
      providerRefusals: providerRefusalsForHarness('claude-code'),
      decision: 'unsupported',
    };
  }

  argv(brief, opts) {
    const args = ['-p', renderBrief(brief, 'claude'), '--permission-mode', opts.permissionMode ?? 'bypassPermissions'];
    if (opts.model) args.push('--model', opts.model);
    return { cmd: 'claude', args };
  }
}

export class GlmAdapter extends ClaudeAdapter {
  card() {
    // No configured limit at this tier: such a constraint belongs to a deployment caller that
    // declares one (advanced.adapterOptions.concurrencyCeiling), never to a subclass default.
    return { ...super.card(), harness: 'glm-via-claude', providerRefusals: providerRefusalsForHarness('glm-via-claude') };
  }
}

// ── #429/#444: the live catalog credentials (Artificial Analysis, Design Arena) ─────────────────
//
// The measured model profile (#429) is read from the provider's own catalog, and that read needs
// one credential. WHERE it lives is declared HERE, once, with the other credential facts the
// readiness reads — so the reader, the deployment and the tests never spell the location twice:
//
//   BATON_AA_KEY             the environment variable (the deployment's own env, i.e.
//                            `advanced.resident.env`, else this process's)
//   ~/.config/baton/aa_key   else the operator's key file under the config root
//                            `kimi-credential-setup.mjs` already resolves for Baton's private
//                            credentials ($XDG_CONFIG_HOME/baton/... when XDG_CONFIG_HOME is set)
//
// The key is read at the deployment ROOT and nowhere else: RuntimeIsolation's secret-name sweep
// keeps `BATON_AA_KEY` out of every worker's environment, the file never leaves the host, the value
// is never printed, logged or echoed in an error, and a stray copy at the repository root is
// covered by .gitignore and by the deployment snapshot's credential exclusions. An absent
// credential is a DEGRADED profile row on the doctor, never a refusal.
//
// #444 adds the SECOND live source's credential beside it, on the identical contract:
//
//   BATON_DESIGNARENA_KEY           the Design Arena key the rankings read sends as a Bearer token
//   ~/.config/baton/designarena_key else the operator's key file under the SAME config root
export const AA_CREDENTIAL_ENV = 'BATON_AA_KEY';
export const AA_CREDENTIAL_FILE = 'aa_key';
export const DESIGNARENA_CREDENTIAL_ENV = 'BATON_DESIGNARENA_KEY';
export const DESIGNARENA_CREDENTIAL_FILE = 'designarena_key';

/** The key file's read bound is the registry's own credential-file row (limits.mjs), never a
 * literal here: a key that does not fit the declared credential-file bound is not a key. */
const CREDENTIAL_FILE_MAX_BYTES = FRAME_LIMITS['credential.file'].value;

/** The path of ONE Baton-private credential file, resolved under the config root
 * `kimi-credential-setup.mjs` already resolves for Baton's private credentials
 * ($XDG_CONFIG_HOME/baton/... when XDG_CONFIG_HOME is set). */
function credentialFilePath(file, { env, home }) {
  const configured = env.XDG_CONFIG_HOME;
  const configRoot = typeof configured === 'string' && configured.length > 0 ? configured : join(home, '.config');
  return join(configRoot, 'baton', file);
}

/** The path of the Artificial Analysis key file the readiness reads. */
export function aaCredentialPath({
  env = process.env, home = env.HOME ?? process.env.HOME ?? homedir(),
} = {}) {
  return credentialFilePath(AA_CREDENTIAL_FILE, { env, home });
}

/** #444: the path of the Design Arena key file — the same config root, its own file name. */
export function designArenaCredentialPath({
  env = process.env, home = env.HOME ?? process.env.HOME ?? homedir(),
} = {}) {
  return credentialFilePath(DESIGNARENA_CREDENTIAL_FILE, { env, home });
}

/** ONE credential file, or null when there is none to read. The file is read bounded by the
 * registry's `credential.file` row through a no-follow descriptor — a link, a directory, an
 * oversized or unreadable file, or an empty value is ABSENCE (the caller degrades its row). Nothing
 * here ever throws or carries the value: an error message names the path, never the key. */
function readCredentialFile(file, maxBytes) {
  let descriptor;
  try {
    descriptor = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size === 0 || stat.size > maxBytes) return null;
    const value = readFileSync(descriptor, 'utf8').trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) { try { closeSync(descriptor); } catch { /* already closed */ } }
  }
}

/** The Artificial Analysis key itself, or null when there is none to read. The environment wins
 * over the file. */
export function readAaCredential({
  env = process.env, home = env.HOME ?? process.env.HOME ?? homedir(), path = null,
  maxBytes = CREDENTIAL_FILE_MAX_BYTES,
} = {}) {
  const configured = env?.[AA_CREDENTIAL_ENV];
  if (typeof configured === 'string' && configured.trim().length > 0) return configured.trim();
  const file = typeof path === 'string' && path.length > 0 ? path : aaCredentialPath({ env, home });
  return readCredentialFile(file, maxBytes);
}

/** #444: the Design Arena key itself, or null — the same contract as `readAaCredential`, declared
 * HERE so the reader, the deployment and the tests never spell the location twice. */
export function readDesignArenaCredential({
  env = process.env, home = env.HOME ?? process.env.HOME ?? homedir(), path = null,
  maxBytes = CREDENTIAL_FILE_MAX_BYTES,
} = {}) {
  const configured = env?.[DESIGNARENA_CREDENTIAL_ENV];
  if (typeof configured === 'string' && configured.trim().length > 0) return configured.trim();
  const file = typeof path === 'string' && path.length > 0 ? path : designArenaCredentialPath({ env, home });
  return readCredentialFile(file, maxBytes);
}
