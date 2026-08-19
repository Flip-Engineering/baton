// death-cert.mjs — issue #225: the TERMINAL-EVENT DEATH CERTIFICATE.
//
// The 18:07Z cluster (2026-08-14) landed adapter-origin `lifecycle.crashed` events
// envelope-only: the close facts existed at the exact-close latch but never reached the
// ledger as fields, and no bounded stderr/stdout tail survived the death — every forensic
// dig had to re-derive cause from archaeology. This module is the shared enrichment seam:
//
//   - `DeathCertTail` — a BOUNDED rolling tail (last 4KiB by default) per stream, redacted
//     at snapshot per the SECRET_SHAPED_TEXT discipline (messages.mjs) plus the adapter's
//     configured literal credential values. Never unbounded, never a new event kind.
//   - `providerStatusClass(status)` — the HTTP status class of a failed provider request
//     (429 -> '4xx', 503 -> '5xx'), null for non-failure statuses.
//   - `deathCertBlock({...})` — assembles the closed-shape cert the terminal events carry.
//
// The cert rides the EVENT ENVELOPE as one additive `deathCert` field — the `payload` of
// `lifecycle.process_closed` stays byte-identical (its exact-keys validator is the terminal
// semantics pin; enrichment must never disturb it). The coordinator intake passes the block
// through, and the route tuple is attached there via `_routeAttribution`.

import { SECRET_SHAPED_TEXT } from './messages.mjs';

/** The bounded tail ceiling: last 4KiB per stream (issue #225 contract, item 2). */
export const DEATH_CERT_TAIL_BYTES = 4 * 1024;

const SECRET_SHAPED_MARKER = '[redacted]';
const LITERAL_SECRET_MARKER = '[REDACTED]';

/** HTTP status class of a failed provider request: 429 -> '4xx', 503 -> '5xx'; else null. */
export function providerStatusClass(status) {
  return Number.isSafeInteger(status) && status >= 400 && status <= 599
    ? `${Math.floor(status / 100)}xx`
    : null;
}

function capBytes(text, maxBytes) {
  let out = '';
  let bytes = 0;
  for (const ch of text) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > maxBytes) return out;
    out += ch;
    bytes += size;
  }
  return out;
}

/** SECRET_SHAPED_TEXT redaction (the shared messages.mjs pattern set), then literal values. */
function redactDeathCertText(text, literalSecrets = []) {
  let redacted = String(text ?? '');
  for (const pattern of SECRET_SHAPED_TEXT) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, SECRET_SHAPED_MARKER);
  }
  for (const secret of literalSecrets) {
    if (typeof secret === 'string' && secret.length > 0) {
      redacted = redacted.split(secret).join(LITERAL_SECRET_MARKER);
    }
  }
  return redacted;
}

/**
 * Bounded rolling stream tail: retains at most `maxBytes` UTF-8 bytes (aligned to scalar
 * boundaries), so a multi-megabyte chunk can never grow the retained window. `literalSecrets`
 * is a function returning the adapter's current credential VALUES (probed at snapshot time,
 * so a rotated credential is never baked into a long-lived closure).
 */
export class DeathCertTail {
  constructor({ maxBytes = DEATH_CERT_TAIL_BYTES, literalSecrets = () => [] } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new TypeError('DeathCertTail maxBytes must be a positive safe integer');
    }
    this._maxBytes = maxBytes;
    this._literalSecrets = typeof literalSecrets === 'function' ? literalSecrets : () => [];
    this._tail = '';
  }

  /** Append a stream chunk; the retained window stays at the LAST maxBytes bytes. */
  append(chunk) {
    const text = String(chunk ?? '');
    if (text.length === 0) return;
    this._tail += text;
    const bytes = Buffer.byteLength(this._tail, 'utf8');
    if (bytes <= this._maxBytes) return;
    const buf = Buffer.from(this._tail, 'utf8');
    // Advance to a UTF-8 scalar boundary so the window never starts mid-sequence.
    let start = bytes - this._maxBytes;
    while (start < buf.length && (buf[start] & 0xc0) === 0x80) start += 1;
    let tail = buf.subarray(start).toString('utf8');
    // The boundary alignment can overshoot by at most one scalar; drop leading scalars
    // until the window fits the byte ceiling exactly.
    while (Buffer.byteLength(tail, 'utf8') > this._maxBytes) {
      const first = tail.codePointAt(0);
      tail = tail.slice(String.fromCodePoint(first).length);
    }
    this._tail = tail;
  }

  /**
   * The redacted, byte-capped snapshot. Redaction runs on the WHOLE retained window first
   * (a credential straddling the cut boundary is still caught), then the result is re-capped
   * at maxBytes — redaction can change byte length.
   */
  snapshot() {
    let secrets = [];
    try { secrets = this._literalSecrets() ?? []; } catch { /* probe defects never leak */ }
    return capBytes(redactDeathCertText(this._tail, secrets), this._maxBytes);
  }

  get bytes() { return Buffer.byteLength(this._tail, 'utf8'); }
}

/**
 * Assemble the closed-shape death-cert block that rides a terminal event's envelope.
 * `providerCauseClass` is included ONLY when the adapter actually observed one (the
 * contract: "when the adapter observed one"). Tails are always present (possibly empty);
 * exitCode/signal are null when no close fact exists.
 */
export function deathCertBlock({ exitCode, signal, providerCauseClass, stderrTail, stdoutTail }) {
  const cert = {
    exitCode: Number.isSafeInteger(exitCode) ? exitCode : null,
    signal: typeof signal === 'string' && /^SIG[A-Z0-9]{1,16}$/.test(signal) ? signal : null,
    stderrTail: typeof stderrTail === 'string' ? stderrTail : '',
    stdoutTail: typeof stdoutTail === 'string' ? stdoutTail : '',
  };
  // Accept either the observed class literal ('4xx'/'5xx') or a raw HTTP status (429).
  const observed = typeof providerCauseClass === 'string' && /^[45]xx$/u.test(providerCauseClass)
    ? providerCauseClass
    : providerStatusClass(providerCauseClass);
  if (observed) cert.providerCauseClass = observed;
  return Object.freeze(cert);
}

/**
 * Coordinator-side synthesis: when an adapter-origin terminal event carries the close facts
 * in its payload but no adapter-provided `deathCert` block (non-enriched adapter tiers), the
 * ledger event still gets the cert — exitCode/signal, the canonical names — from the facts
 * that DO exist. Null-only facts produce no block (the contract: carry facts WHEN THEY EXIST).
 */
export function synthesizeTerminalDeathCert(event) {
  if (!event || !['lifecycle.process_closed', 'lifecycle.crashed', 'lifecycle.exited'].includes(event.kind)) return null;
  if (event.deathCert) return null; // the adapter block wins wholesale
  const payload = event.payload ?? {};
  const exitCode = Number.isSafeInteger(payload.exitCode) ? payload.exitCode
    : Number.isSafeInteger(payload.code) ? payload.code : null;
  const signal = typeof payload.signal === 'string' && /^SIG[A-Z0-9]{1,16}$/.test(payload.signal)
    ? payload.signal : null;
  if (exitCode === null && signal === null) return null;
  return Object.freeze({ exitCode, signal });
}
