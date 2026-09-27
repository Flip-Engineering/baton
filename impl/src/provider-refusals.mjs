// provider-refusals.mjs — the closed provider-refusal vocabulary a card carries (#341 part 2,
// #387) and the card axis every card is admitted by.
//
// Two readers need it and neither may import the other: adapter.mjs publishes the table on every
// card it builds, and adapter-contract.mjs admits card.providerRefusals as an axis while it
// completes the legacy tier's cards. Both read this one module, so the card contract and the cards
// it reads can never drift apart.

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
