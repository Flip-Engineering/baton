// Native OMP 17.4.0 assistant message shape (j2a, offset ~75993585, confirmed from installed binary):
//   role: "assistant"
//   provider: string          — raw provider name  (e.g. "deepseek")
//   model: string             — raw model ID       (e.g. "deepseek-v4-flash")
//   usage.totalTokens: int    — input+output+cacheRead+cacheWrite (canonical baton metric)
//   usage.cost.total: number  — USD for THIS one provider API call (additive, not cumulative)
//   stopReason: string        — "end_turn" | "tool_use" | "aborted" | "error" | ...
//   errorMessage: string|null — present on stopReason==="error"
//
// message_end.message has this same shape (one event per provider API call within a turn).
// agent_end.messages is the array of NEW messages from the run (LQo, same offsets); user+tool
// messages are also present — filter role==="assistant" before accounting.
//
// IDENTITY: qualification merges provider+"/"+model.  If model already starts with
// "provider/", do not re-prefix (native may emit "deepseek/deepseek-v4-flash" as model).
// EVERY observed provider/model is returned so coordinator mismatch detection fires on
// route changes; first-only observation is NOT used.
//
// DEDUP/BOUNDARY: message_start marks the open of one API call; message_end closes it.
// consumeMessageStart is optional — a no-start fallback assumption is documented below.
// Each consumeMessageEnd returns the delta for THAT call; finalize adds only a fallback
// delta when ZERO message_end events were seen. No accumulated re-emission of prior deltas.
//
// TELEMETRY: agent_end.telemetry shape is not documented in the protocol reference and
// its token field names are unverified. It is NOT used. Use agent_end.messages instead.

import { createHash } from 'node:crypto';
import { usdToNanos, usdFromNanos, USD_NANO_SCALE } from './usd.mjs';

// Exported so root can declare this in the governance card when upgrading to native accounting.
export const OMP_TOKEN_METRIC = 'message_end.totalTokens';

const MAX_COUNTER_ID_BYTES = 256;

function unavailableSeal() {
  return { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null };
}

// Stable counterId that uniquely identifies one (worker, turnEpoch, processGeneration) triple.
// Falls back to a SHA-256 hex digest when the natural form would exceed the 256-byte limit.
function makeCounterId(worker, turnEpoch, processGeneration) {
  if (typeof worker !== 'string' || worker.length === 0) return null;
  if (!Number.isSafeInteger(turnEpoch) || turnEpoch < 0) return null;
  if (!Number.isSafeInteger(processGeneration) || processGeneration < 0) return null;
  const candidate = `omp:${worker}:${turnEpoch}:${processGeneration}`;
  if (!candidate.includes('\0') && Buffer.byteLength(candidate) <= MAX_COUNTER_ID_BYTES) {
    return candidate;
  }
  // Long worker name: hash to stay within the coordinator contract (always 70 bytes).
  const digest = createHash('sha256')
    .update(`omp\0${worker}\0${turnEpoch}\0${processGeneration}`)
    .digest('hex');
  return `omp-h:${digest}`;
}

// Qualify raw provider+model to "provider/model".
// If model already starts with "provider/", preserve as-is to avoid double-prefixing.
function qualifyIdentity(provider, model) {
  if (typeof provider !== 'string' || provider.length === 0) return null;
  if (typeof model !== 'string' || model.length === 0) return null;
  const prefix = `${provider}/`;
  return model.startsWith(prefix) ? model : `${prefix}${model}`;
}

function safeNonNegativeInt(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// Native OMP prices can produce fractions smaller than Baton's existing nanodollar ledger.
// Round upward to that ledger unit so reported spend is never silently omitted or understated.
// The raw native amount remains on the event; the excess is less than one ledger unit per call.
function nativeUsdNanos(value) {
  if (!Number.isFinite(value) || value < 0) return null;
  const exact = usdToNanos(value);
  if (exact !== null) return exact;
  const rounded = Math.ceil(value * USD_NANO_SCALE);
  return Number.isSafeInteger(rounded) && rounded >= 0 ? rounded : null;
}

// Extract per-call tokens and USD from a native assistant message's usage block.
// Dimensions are independent: invalid tokens do not suppress valid USD and vice versa.
function extractUsageDimensions(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    return { tokens: null, usd: null };
  }
  const tokens = safeNonNegativeInt(usage.totalTokens);
  // usdToNanos returns null for negative, NaN, Infinity, or imprecise values.
  const costNanos = nativeUsdNanos(usage.cost?.total);
  const usd = costNanos !== null ? usdFromNanos(costNanos) : null;
  return { tokens, usd };
}

/**
 * Per-turn usage accumulator for OMP native message_end events.
 *
 * Lifecycle:
 *   1. Create once per (worker, turnEpoch, processGeneration) triple at turn start.
 *   2. Call consumeMessageStart / consumeMessageEnd for each native pair.
 *      consumeMessageEnd returns a per-call resourceTokens delta the root emits immediately.
 *   3. Call snapshot() at any time (crash, interrupt) to get a partial usage seal.
 *   4. Call finalize({ terminalMessages, isTerminal }) on agent_end:
 *        - If isTerminal===false: no terminal seal produced (non-terminal agent_end).
 *        - If message_end coverage exists: seal closes what was already reported.
 *        - If zero coverage: attempts fallback from agent_end.messages array.
 *
 * Never reuse across turns or process restarts (processGeneration distinguishes restarts).
 */
export class OmpTurnUsageAccumulator {
  #counterId;
  #invalid;
  #finalized = false;
  #pendingStart = false;     // true between consumeMessageStart and consumeMessageEnd
  #sawStart = false;
  #coverageGap = false;
  #tokensMissing = false;
  #usdMissing = false;
  #noStartCount = 0;         // how many ends arrived without a preceding start
  #messageEndCount = 0;      // total ends processed (assistant-role only)
  #anyTokensReported = false;
  #anyUsdReported = false;

  /**
   * @param {string}  worker
   * @param {number}  turnEpoch
   * @param {number}  [processGeneration=1]
   */
  constructor(worker, turnEpoch, processGeneration = 1) {
    const id = makeCounterId(worker, turnEpoch, processGeneration);
    this.#invalid = id === null;
    this.#counterId = id;
  }

  /** Stable counterId for all resource.tokens events in this turn, or null when args invalid. */
  get counterId() { return this.#counterId; }

  /** Count of assistant-role message_end events successfully processed. */
  get messageEndCount() { return this.#messageEndCount; }

  /**
   * Consume a native message_start event.
   * Optional but recommended: establishes the start/end boundary for dedup tracking.
   * Calling consumeMessageEnd without a preceding consumeMessageStart is accepted
   * (no-start fallback) but increments a counter used for diagnostics.
   *
   * @returns {{ ok: boolean, code?: string }}
   */
  consumeMessageStart(event) {
    if (this.#finalized) return { ok: false, code: 'already_finalized' };
    if (this.#invalid) return { ok: false, code: 'invalid_counter' };
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      return { ok: false, code: 'event_invalid' };
    }
    if (event.type !== 'message_start') return { ok: false, code: 'wrong_event_type' };
    if (event.message?.role !== 'assistant') return { ok: true, code: 'non_assistant_role' };
    // A second assistant start opens the next observed native boundary.
    if (this.#pendingStart) this.#coverageGap = true;
    this.#sawStart = true;
    this.#pendingStart = true;
    return { ok: true };
  }

  /**
   * Consume one native message_end event.
   * Returns a per-call resource.tokens delta the root should emit immediately.
   * Does not accumulate totals: each call is independent.
   *
   * Only role==="assistant" events are accounted; user/tool messages yield ok+skipped.
   * Both usage dimensions (tokens, USD) are evaluated independently — an invalid or absent
   * totalTokens does not suppress a valid cost.total, and vice versa.
   *
   * @returns {{
   *   ok: boolean,
   *   code?: string,
   *   resourceTokens: object | null,
   *   modelObserved: string | null,
   *   stopReason: string | null,
   * }}
   */
  consumeMessageEnd(event) {
    const none = (code, extra = {}) => ({ ok: false, code, resourceTokens: null, modelObserved: null, stopReason: null, ...extra });
    const skip = (code) => ({ ok: true, code, resourceTokens: null, modelObserved: null, stopReason: null });

    if (this.#finalized) return none('already_finalized');
    if (this.#invalid) return none('invalid_counter');
    if (!event || typeof event !== 'object' || Array.isArray(event)) return none('event_invalid');
    if (event.type !== 'message_end') return none('wrong_event_type');

    const message = event.message;
    if (!message || typeof message !== 'object' || Array.isArray(message)) return none('message_missing');

    // User and tool frames never carry provider accounting authority.
    if (message.role !== 'assistant') return skip('non_assistant_role');
    if (this.#sawStart && !this.#pendingStart) return skip('duplicate_message_end');
    if (this.#pendingStart) this.#pendingStart = false;
    else this.#noStartCount += 1;
    // Without any start frames, ordered local stdio is the observation source: each end is
    // a separate call. Native OMP has no stable event IDs, so arbitrary whole-stream replay
    // cannot be deduplicated by pretending equal content necessarily means equal calls.

    // Qualify identity from THIS message's provider/model (every call, not only first).
    const modelObserved = qualifyIdentity(message.provider, message.model);
    const stopReason = typeof message.stopReason === 'string' ? message.stopReason : null;

    const { tokens, usd } = extractUsageDimensions(message.usage);
    const tokensOk = tokens !== null;
    const usdOk = usd !== null;

    this.#messageEndCount += 1;
    if (!tokensOk) this.#tokensMissing = true;
    if (!usdOk) this.#usdMissing = true;
    if (tokensOk) this.#anyTokensReported = true;
    if (usdOk) this.#anyUsdReported = true;

    if (!tokensOk && !usdOk) {
      return { ok: true, code: 'no_usage', resourceTokens: null, modelObserved, stopReason };
    }

    const resourceTokens = {
      source: 'message_end', accounting: 'delta',
      counterId: this.#counterId,
      ...(tokensOk ? { tokens, tokenMetric: OMP_TOKEN_METRIC } : {}),
      ...(usdOk ? { usd, nativeUsd: message.usage.cost.total, usdRounding: 'ceil_nanodollar' } : {}),
    };

    return { ok: true, resourceTokens, modelObserved, stopReason };
  }

  /**
   * Snapshot seal for the current accumulated reporting state.
   * Safe to call at any time: on crash, interrupt, or before finalize.
   * Reflects only usage already returned via consumeMessageEnd resourceTokens fields.
   *
   * @returns {{ seal: object }}
   */
  snapshot() {
    return { seal: this.#buildSeal(), coverage: { assistantCalls: this.#messageEndCount,
      unpairedEnds: this.#noStartCount, pendingAssistant: this.#pendingStart, gap: this.#coverageGap } };
  }

  /**
   * Finalize the turn's accounting.
   *
   * When message_end events were consumed they are authoritative; this method just seals
   * them — no additional resourceTokens is produced.
   *
   * When zero message_end events were seen, terminalMessages (agent_end.messages) is used
   * as a fallback: assistant-role messages are scanned and their usage is summed. This is
   * safe against double-counting because it is only executed when messageEndCount === 0.
   *
   * When isTerminal===false (non-terminal agent_end), no seal is produced; return is null
   * for both resourceTokens and seal so root knows the turn continues.
   *
   * @param {{
   *   terminalMessages?: unknown[],
   *   isTerminal?: boolean
   * }} [opts]
   * @returns {{
   *   resourceTokens: object | null,
   *   seal: object | null,
   *   modelObserved: string | null,
   * }}
   */
  finalize(opts = {}) {
    if (this.#finalized) throw new Error('OmpTurnUsageAccumulator: already finalized');
    const { isTerminal = true, terminalMessages } = opts ?? {};

    if (this.#messageEndCount > 0 && Array.isArray(terminalMessages)
      && terminalMessages.filter((message) => message?.role === 'assistant').length > this.#messageEndCount) {
      this.#coverageGap = true;
    }
    // Non-terminal agent_end: turn continues; do not close accounting.
    if (isTerminal === false) {
      return { resourceTokens: null, seal: null, modelObserved: null };
    }

    this.#finalized = true;
    if (this.#invalid) {
      return { resourceTokens: null, seal: unavailableSeal(), modelObserved: null };
    }

    // message_end coverage exists: deltas already emitted; close with current seal.
    if (this.#messageEndCount > 0) {
      return { resourceTokens: null, seal: this.#buildSeal(), modelObserved: null };
    }

    // No message_end coverage: try agent_end.messages as fallback.
    if (Array.isArray(terminalMessages) && terminalMessages.length > 0) {
      return this.#buildFromMessages(terminalMessages);
    }

    return { resourceTokens: null, seal: unavailableSeal(), modelObserved: null };
  }

  // ---- private -----------------------------------------------------------

  #buildSeal() {
    // A partially reported dimension cannot certify the full turn. Retain the known deltas,
    // but leave the terminal seal unavailable when reporting was inconsistent across calls.
    if (this.#coverageGap || this.#pendingStart || (this.#tokensMissing && this.#anyTokensReported)
      || (this.#usdMissing && this.#anyUsdReported)) return unavailableSeal();
    const tokensStatus = this.#anyTokensReported ? 'reported' : 'unavailable';
    const usdStatus = this.#anyUsdReported ? 'reported' : 'unavailable';
    const anyReported = this.#anyTokensReported || this.#anyUsdReported;
    return {
      tokens: tokensStatus,
      usd: usdStatus,
      counterId: anyReported ? this.#counterId : null,
      tokenMetric: this.#anyTokensReported ? OMP_TOKEN_METRIC : null,
    };
  }

  // Fallback: sum usage from agent_end.messages (assistant-role only).
  // Called only when messageEndCount === 0, so there is no double-count risk.
  #buildFromMessages(messages) {
    let totalTokens = 0;
    let tokensOk = false;
    let totalUsdNanos = 0;
    let usdOk = false;
    let lastModelObserved = null;

    for (const msg of messages) {
      if (!msg || typeof msg !== 'object' || msg.role !== 'assistant') continue;

      const qualified = qualifyIdentity(msg.provider, msg.model);
      if (qualified !== null) lastModelObserved = qualified;

      const { tokens, usd } = extractUsageDimensions(msg.usage);

      if (tokens !== null) {
        const next = totalTokens + tokens;
        if (Number.isSafeInteger(next)) {
          totalTokens = next;
          tokensOk = true;
        }
        else this.#tokensMissing = true;
        // Preserve known amounts on overflow; the full usage seal stays unavailable.
      } else this.#tokensMissing = true;

      if (usd !== null) {
        const nanos = usdToNanos(usd);
        if (nanos !== null) {
          const next = totalUsdNanos + nanos;
          if (Number.isSafeInteger(next)) {
            totalUsdNanos = next;
            usdOk = true;
          } else this.#usdMissing = true;
        }
      } else this.#usdMissing = true;
    }

    if (!tokensOk && !usdOk) {
      return { resourceTokens: null, seal: unavailableSeal(), modelObserved: lastModelObserved };
    }

    const usdValue = usdOk ? usdFromNanos(totalUsdNanos) : null;
    const usdReported = usdValue !== null;

    const resourceTokens = {
      source: 'agent_end_messages', accounting: 'delta',
      counterId: this.#counterId,
      ...(tokensOk ? { tokens: totalTokens, tokenMetric: OMP_TOKEN_METRIC } : {}),
      ...(usdReported ? { usd: usdValue } : {}),
    };

    this.#anyTokensReported = tokensOk;
    this.#anyUsdReported = usdReported;
    const seal = this.#buildSeal();

    return { resourceTokens, seal, modelObserved: lastModelObserved };
  }
}
