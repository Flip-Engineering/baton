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
