import { createHash } from 'node:crypto';

export const MAX_VERIFIER_FAILURE_TAIL_BYTES = 8_192;

const SECRET_PATTERNS = Object.freeze([
  /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----/giu,
  /\b(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+[^\s]+/giu,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|credential|password|secret)\s*[:=]\s*["']?[^\s"']{8,}/giu,
  /\b(?:sk|sk-proj)-[A-Za-z0-9_-]{16,}\b/gu,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
]);

const digest = (value) => createHash('sha256').update(value).digest('hex');

function byteTail(value, maxBytes) {
  const source = Buffer.from(value, 'utf8');
  if (source.length <= maxBytes) return { text: source.toString('utf8'), truncated: false };
  const marker = Buffer.from('…\n');
  return {
    text: `${marker.toString('utf8')}${source.subarray(source.length - (maxBytes - marker.length)).toString('utf8')}`,
    truncated: true,
  };
}

// ── issue #299: the tool-row evidence digests ────────────────────────────────────────────────────
// A content.tool_call row carries what the worker SENT (the arguments) and what it was TOLD (the
// result), so a refused publish or a failed call is readable where the work happened instead of
// inside the worker's home directory. Both digests are derived HERE, beside the referee's own
// failure capsule, so the redaction set is the ONE set the verification path already applies
// (SECRET_PATTERNS, via sanitizeVerifierDiagnosticText — never a second redaction vocabulary) and
// the byte bound is the ONE bound that capsule already uses (MAX_VERIFIER_FAILURE_TAIL_BYTES —
// never a new constant). Adapters digest at the emit boundary, so raw provider input never
// reaches the durable ledger row at all.

/** The typed marker a row carries when the adapter's provider frame names no arguments (or no
 * result) at all — recorded absence, never silence (issue #299). */
export const TOOL_EVIDENCE_UNOBSERVED = Object.freeze({
  args: 'tool_args_unobserved:provider_frame_carries_no_input',
  result: 'tool_result_unobserved:provider_frame_carries_no_output',
});

/** Canonical evidence text: strings pass through, structures serialize deterministically enough
 * for a digest (key order is the provider's own; the digest is evidence, never an identity). */
function evidenceText(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try { return JSON.stringify(value); } catch { return String(value); }
}

/** The bounded, redacted digest of a tool call's arguments (the command line or the tool input
 * object). Null only when the caller observed nothing — the row then carries the typed
 * TOOL_EVIDENCE_UNOBSERVED.args marker instead. */
export function toolCallArgumentDigest(value) {
  const text = evidenceText(value);
  if (text === '') return null;
  return sanitizeVerifierDiagnosticText(text).text;
}

/** The bounded, redacted digest of a tool call's result: exit status and byte counts in a header
 * line, then the FIRST lines of the output that fit the same bound the referee's capsule uses.
 * The header reserves its own bytes, and the sanitizer's final bound holds no matter how much
 * redaction grows the text — the returned digest is always within the derivation. */
export function toolCallResultDigest({ ok = null, exitCode = null, output = null } = {}) {
  const raw = evidenceText(output);
  const status = exitCode !== null && exitCode !== undefined ? `exit=${exitCode}`
    : ok === true ? 'exit=ok' : ok === false ? 'exit=error' : 'exit=unknown';
  const header = `${status} bytes=${Buffer.byteLength(raw, 'utf8')}`;
  const budget = MAX_VERIFIER_FAILURE_TAIL_BYTES - Buffer.byteLength(header, 'utf8') - 1;
  const lines = [];
  let used = 0;
  for (const line of (raw === '' ? [] : raw.split('\n'))) {
    const size = Buffer.byteLength(line, 'utf8') + 1;
    if (used + size > budget) break;
    lines.push(line);
    used += size;
  }
  return sanitizeVerifierDiagnosticText(lines.length > 0 ? `${header}\n${lines.join('\n')}` : header).text;
}

export function sanitizeVerifierDiagnosticText(value, { sandboxRoots = [] } = {}) {
  if (typeof value !== 'string') return Object.freeze({ text: '', redacted: false });
  let text = value.normalize('NFKC')
    .replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/gu, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '�');
  let redacted = text !== value;
  for (const root of [...new Set(sandboxRoots.filter((candidate) => (
    typeof candidate === 'string' && candidate.length > 0
  )))].sort((left, right) => right.length - left.length)) {
    if (text.includes(root)) {
      text = text.replaceAll(root, '[verification-sandbox]');
      redacted = true;
    }
  }
  const pathSanitizers = [
    [/(?:file:\/\/)?\/(?:private\/)?(?:tmp|var\/folders)\/[^\s:'"\])}]+/gu, '[temporary-path]'],
    // Redact the WHOLE home path (username + every subdirectory + a `file.rs:12` line:col suffix),
    // never just the username — a leaked `projects/secret/lib.rs` tail still crosses the provider
    // seam as a raw capsule fragment (issue #79 F6). Stops at whitespace/quote.
    [/(?:file:\/\/)?\/(?:Users|home)\/[^\s'"]+/gu, '/[home]/'],
  ];
  for (const [pattern, replacement] of pathSanitizers) {
    if (pattern.test(text)) {
      pattern.lastIndex = 0;
      text = text.replace(pattern, replacement);
      redacted = true;
    }
    pattern.lastIndex = 0;
  }
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      pattern.lastIndex = 0;
      text = text.replace(pattern, '[credential-shaped content redacted]');
      redacted = true;
    }
    pattern.lastIndex = 0;
  }
  const bounded = byteTail(text, MAX_VERIFIER_FAILURE_TAIL_BYTES);
  return Object.freeze({ text: bounded.text, redacted, truncated: bounded.truncated });
}

export function verifierFailureCapsule(output, {
  capturedOutputBytes, capturedOutputDigest, sandboxRoots = [],
} = {}) {
  const raw = typeof output === 'string' ? output : '';
  const selected = byteTail(raw, MAX_VERIFIER_FAILURE_TAIL_BYTES);
  const sanitized = sanitizeVerifierDiagnosticText(selected.text, { sandboxRoots });
  const text = sanitized.text || '[verifier produced no diagnostic output]';
  return Object.freeze({
    schemaVersion: 1,
    kind: 'verification_failure_tail',
    text,
    textDigest: digest(text),
    capturedOutputBytes: Number.isSafeInteger(capturedOutputBytes) && capturedOutputBytes >= 0
      ? capturedOutputBytes : Buffer.byteLength(raw),
    capturedOutputDigest: typeof capturedOutputDigest === 'string'
      && /^[a-f0-9]{64}$/u.test(capturedOutputDigest)
      ? capturedOutputDigest : digest(raw),
    truncated: selected.truncated || sanitized.truncated,
    redacted: sanitized.redacted,
  });
}

export function normalizeVerifierFailureCapsule(value, {
  capturedOutputBytes, capturedOutputDigest,
} = {}) {
  const fields = ['capturedOutputBytes', 'capturedOutputDigest', 'kind', 'redacted',
    'schemaVersion', 'text', 'textDigest', 'truncated'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== fields.sort().join('\0')
    || value.schemaVersion !== 1 || value.kind !== 'verification_failure_tail'
    || typeof value.text !== 'string' || Buffer.byteLength(value.text) > MAX_VERIFIER_FAILURE_TAIL_BYTES
    || typeof value.truncated !== 'boolean' || typeof value.redacted !== 'boolean'
    || !Number.isSafeInteger(value.capturedOutputBytes) || value.capturedOutputBytes < 0
    || !/^[a-f0-9]{64}$/u.test(value.capturedOutputDigest ?? '')
    || !/^[a-f0-9]{64}$/u.test(value.textDigest ?? '')
    || value.textDigest !== digest(value.text)
    || (capturedOutputBytes !== undefined && value.capturedOutputBytes !== capturedOutputBytes)
    || (capturedOutputDigest !== undefined && value.capturedOutputDigest !== capturedOutputDigest)) {
    return null;
  }
  const sanitized = sanitizeVerifierDiagnosticText(value.text);
  const text = sanitized.text || '[verifier produced no diagnostic output]';
  return Object.freeze({
    ...value,
    text,
    textDigest: digest(text),
    truncated: value.truncated || sanitized.truncated,
    redacted: value.redacted || sanitized.redacted,
  });
}
