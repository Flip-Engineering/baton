// messages.mjs — the message shapes (the Brief delegation contract + nudge/steer/ask/
// answer/result/digest) and provenance typing (hub-computed facts vs untrusted worker
// prose). Pure: deterministic given injected now/idGen. No trust is ever implied by shape.

import { createHash, randomUUID } from 'node:crypto';

export class ValidationError extends Error {
  /** @param {string[]} errors */
  constructor(errors) {
    super(`validation failed: ${errors.join('; ')}`);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

export const MESSAGE_KINDS = Object.freeze(['brief', 'nudge', 'steer', 'ask', 'answer', 'result']);
export const ATTENTION_TYPES = Object.freeze(['approval', 'question', 'blocked', 'stalled', 'budget_alarm']);

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

// Briefs are persisted to the append-only JSON log, so admission accepts data rather than live
// object graphs. Clone every extension field too: otherwise a future nested field would either
// remain caller-owned or be frozen in the caller when deepFreeze() walks the admitted brief.
function cloneBriefData(value, path = 'brief', ancestors = new Set()) {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') {
    throw new ValidationError([`${path} must contain only JSON-compatible data`]);
  }
  if (ancestors.has(value)) throw new ValidationError([`${path} must not contain a cycle`]);

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) return value.map((item, i) => cloneBriefData(item, `${path}[${i}]`, nextAncestors));

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new ValidationError([`${path} must contain only plain objects and arrays`]);
  }
  const copy = {};
  for (const [key, item] of Object.entries(value)) copy[key] = cloneBriefData(item, `${path}.${key}`, nextAncestors);
  return copy;
}

const defaultOpts = () => ({ now: () => new Date().toISOString(), idGen: () => randomUUID() });

// ---------------------------------------------------------------------------
// Brief — the delegation contract (D2). verification is the ONE definition of done.
// ---------------------------------------------------------------------------

/** @param {object} fields @returns {{ok:boolean, errors:string[]}} */
export function validateBrief(fields) {
  const errors = [];
  if (!fields || typeof fields !== 'object') return { ok: false, errors: ['brief must be an object'] };
  if (typeof fields.goal !== 'string' || fields.goal.length === 0) errors.push('goal is required (non-empty string)');
  if (fields.verification == null || typeof fields.verification !== 'object') {
    errors.push('verification block is required (defines "done")');
  } else {
    if (typeof fields.verification.command !== 'string' || fields.verification.command.length === 0) {
      errors.push('verification.command is required — the exact command that defines "done"');
    }
    if (typeof fields.verification.expectExit !== 'number') errors.push('verification.expectExit must be a number');
  }
  if (fields.budget == null || typeof fields.budget !== 'object' || Array.isArray(fields.budget)) {
    errors.push('budget is required with exact tokens, usd, and wallMin ceilings');
  } else if (Object.keys(fields.budget).sort().join(',') !== 'tokens,usd,wallMin') {
    errors.push('budget must contain exactly tokens, usd, and wallMin');
  } else {
    if (!Number.isSafeInteger(fields.budget.tokens) || fields.budget.tokens <= 0) {
      errors.push('budget.tokens must be a positive safe integer');
    }
    if (!Number.isFinite(fields.budget.usd) || fields.budget.usd < 0) {
      errors.push('budget.usd must be a finite nonnegative number');
    }
    if (!Number.isSafeInteger(fields.budget.wallMin) || fields.budget.wallMin <= 0) {
      errors.push('budget.wallMin must be a positive safe integer');
    }
  }
  if (fields.pathScope != null) {
    if (!Array.isArray(fields.pathScope)) errors.push('pathScope must be a string[] of repo-relative globs');
    else for (const p of fields.pathScope) {
      if (typeof p !== 'string') errors.push('pathScope entries must be strings');
      else if (p.startsWith('/')) errors.push(`pathScope entry "${p}" must be repo-relative, not absolute`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** @param {object} fields @returns {object} a deeply-frozen Brief @throws {ValidationError} */
export function createBrief(fields) {
  const { ok, errors } = validateBrief(fields);
  if (!ok) throw new ValidationError(errors);
  const snapshot = cloneBriefData(fields);
  const brief = {
    ...snapshot,
    goal: snapshot.goal,
    constraints: [...(snapshot.constraints ?? [])],
    pathScope: [...(snapshot.pathScope ?? [])],
    tools: [...(snapshot.tools ?? [])],
    outputFormat: snapshot.outputFormat ?? '',
    definitionOfDone: snapshot.definitionOfDone ?? '',
    // CI1: preserve the whole verification contract (timeout, coverage command, and future
    // numbered extensions) while still owning a detached snapshot of the nested object.
    verification: { ...snapshot.verification },
    budget: { ...snapshot.budget, usd: snapshot.budget.usd === 0 ? 0 : snapshot.budget.usd },
  };
  if (snapshot.briefTemplate) brief.briefTemplate = snapshot.briefTemplate;
  if (snapshot.orientationRef) brief.orientationRef = snapshot.orientationRef;
  return deepFreeze(brief);
}

// ---------------------------------------------------------------------------
// Envelope + message constructors
// ---------------------------------------------------------------------------

/** @param {string} kind @param {{from,to,payload,turnEpoch,inReplyTo?}} fields @param {{now,idGen}} [opts] */
export function createMessage(kind, fields, opts) {
  const { now, idGen } = { ...defaultOpts(), ...(opts ?? {}) };
  if (!MESSAGE_KINDS.includes(kind)) throw new ValidationError([`unknown message kind "${kind}"`]);
  if (typeof fields.turnEpoch !== 'number' || !Number.isFinite(fields.turnEpoch)) {
    throw new ValidationError(['turnEpoch must be a finite number']);
  }
  return {
    msgId: idGen(),
    from: fields.from,
    to: fields.to,
    kind,
    inReplyTo: fields.inReplyTo ?? null,
    turnEpoch: fields.turnEpoch,
    ts: now(),
    payload: fields.payload,
  };
}

export function createNudge(fields, opts) {
  const at = fields.at ?? 'next_turn';
  if (at !== 'next_turn' && at !== 'tool_boundary') throw new ValidationError([`nudge.at must be next_turn|tool_boundary, got "${at}"`]);
  return createMessage('nudge', { ...fields, payload: { text: fields.text, at } }, opts);
}

export function createSteer(fields, opts) {
  const payload = { text: fields.text };
  if (fields.reason !== undefined) payload.reason = fields.reason;
  return createMessage('steer', { ...fields, payload }, opts);
}

export function createAsk(fields, opts) {
  const blocking = fields.blocking ?? true;
  return createMessage('ask', { ...fields, payload: { question: fields.question, blocking } }, opts);
}

export function createAnswer(fields, opts) {
  if (typeof fields.inReplyTo !== 'string' || fields.inReplyTo.length === 0) {
    throw new ValidationError(['answer.inReplyTo is required']);
  }
  if (fields.decision === undefined && fields.text === undefined) {
    throw new ValidationError(['answer must carry a decision and/or text']);
  }
  const payload = { inReplyTo: fields.inReplyTo };
  if (fields.decision !== undefined) payload.decision = fields.decision;
  if (fields.text !== undefined) payload.text = fields.text;
  return createMessage('answer', { ...fields, payload }, opts);
}

export function createResult(fields, opts) {
  if (fields.status === 'completed' && (fields.verification == null || typeof fields.verification.command !== 'string')) {
    throw new ValidationError(['a completed result must carry a verification claim (command + claimedExit)']);
  }
  // The verification block is always a CLAIM: claimedExit only, never observedExit (only the
  // external trust gate re-derives that). No verified/trusted field can imply trust by shape.
  const payload = {
    status: fields.status,
    summary: fields.summary,
    artifacts: fields.artifacts,
    openQuestions: fields.openQuestions ?? [],
    budgetUsed: fields.budgetUsed ?? { tokens: 0, usd: 0 },
  };
  if (fields.verification) payload.verification = { command: fields.verification.command, claimedExit: fields.verification.claimedExit };
  if (fields.blocker) payload.blocker = fields.blocker;
  if (typeof fields.progress === 'number') payload.progress = fields.progress;
  return createMessage('result', { ...fields, payload }, opts);
}

// ---------------------------------------------------------------------------
// Decision channel (issue #16, docs/32 §3.1) — closed request/answer shapes.
// A DecisionRequest is worker-authored content admitted as untrusted prose (F7); it is
// validated here for *shape* only. `optionId ∈ options` is a coordinator-side, per-record
// check (messages.mjs does not know a specific pending record's option set).
// ---------------------------------------------------------------------------

const SAFE_OPTION_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_DECISION_QUESTION_BYTES = 2_048;
const MAX_OPTION_LABEL_BYTES = 160;
const MAX_OPTION_SUMMARY_BYTES = 512;
const MAX_DECISION_TEXT_BYTES = 4_096;

function boundedNonEmpty(value, maxBytes) {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= maxBytes;
}

/** @param {{question,options,allowFreeResponse?,recommended?,deadlineMs}} fields @returns {object} a deeply-frozen DecisionRequest @throws {ValidationError} */
export function createDecisionRequest(fields) {
  const errors = [];
  const allowedKeys = new Set(['question', 'options', 'allowFreeResponse', 'recommended', 'deadlineMs']);
  for (const key of Object.keys(fields ?? {})) {
    if (!allowedKeys.has(key)) errors.push(`decision request has an unknown field "${key}"`);
  }
  if (!boundedNonEmpty(fields?.question, MAX_DECISION_QUESTION_BYTES)) {
    errors.push(`question is required (non-empty, <=${MAX_DECISION_QUESTION_BYTES} bytes)`);
  }
  let optionIds = [];
  if (!Array.isArray(fields?.options) || fields.options.length < 1 || fields.options.length > 8) {
    errors.push('options must be an array of 1..8 entries');
  } else {
    const seen = new Set();
    fields.options.forEach((opt, i) => {
      if (!opt || typeof opt !== 'object' || Array.isArray(opt)) { errors.push(`options[${i}] must be an object`); return; }
      const hasSummary = Object.hasOwn(opt, 'summary');
      const expectedKeys = hasSummary ? 'id,label,summary' : 'id,label';
      if (Object.keys(opt).sort().join(',') !== expectedKeys) errors.push(`options[${i}] has unexpected fields`);
      if (typeof opt.id !== 'string' || !SAFE_OPTION_ID.test(opt.id)) {
        errors.push(`options[${i}].id must be a safe id (letters, digits, "_.:-", 1..128 bytes)`);
      } else if (seen.has(opt.id)) {
        errors.push(`options[${i}].id "${opt.id}" duplicates an earlier option`);
      } else {
        seen.add(opt.id);
        optionIds.push(opt.id);
      }
      if (!boundedNonEmpty(opt.label, MAX_OPTION_LABEL_BYTES)) errors.push(`options[${i}].label must be non-empty, <=${MAX_OPTION_LABEL_BYTES} bytes`);
      if (hasSummary && opt.summary !== null && !boundedNonEmpty(opt.summary, MAX_OPTION_SUMMARY_BYTES)) {
        errors.push(`options[${i}].summary must be null or <=${MAX_OPTION_SUMMARY_BYTES} bytes`);
      }
    });
  }
  if (fields?.allowFreeResponse !== undefined && typeof fields.allowFreeResponse !== 'boolean') {
    errors.push('allowFreeResponse must be a boolean');
  }
  if (fields?.recommended !== undefined && fields.recommended !== null) {
    if (typeof fields.recommended !== 'string' || !optionIds.includes(fields.recommended)) {
      errors.push('recommended must name an existing option id');
    }
  }
  // F6/F5: v1 decisions are always blocking; an unbounded wait is the documented gating
  // deadlock. deadlineMs is mandatory, never inferred, never "never".
  if (!Number.isSafeInteger(fields?.deadlineMs) || fields.deadlineMs <= 0) {
    errors.push('deadlineMs is required and must be a positive safe integer');
  }
  if (errors.length) throw new ValidationError(errors);
  return deepFreeze({
    question: fields.question,
    options: fields.options.map((opt) => ({
      id: opt.id, label: opt.label, summary: Object.hasOwn(opt, 'summary') ? opt.summary : null,
    })),
    allowFreeResponse: fields.allowFreeResponse ?? false,
    recommended: fields.recommended ?? null,
    deadlineMs: fields.deadlineMs,
  });
}

/** @param {{optionId?,text?}} fields @returns {object} a deeply-frozen DecisionAnswer @throws {ValidationError} */
export function createDecisionAnswer(fields) {
  const errors = [];
  const allowedKeys = new Set(['optionId', 'text']);
  for (const key of Object.keys(fields ?? {})) {
    if (!allowedKeys.has(key)) errors.push(`decision answer has an unknown field "${key}"`);
  }
  const hasOptionId = fields?.optionId !== undefined && fields.optionId !== null;
  const hasText = fields?.text !== undefined && fields.text !== null;
  if (hasOptionId === hasText) errors.push('decision answer must carry exactly one of optionId or text');
  if (hasOptionId && (typeof fields.optionId !== 'string' || !SAFE_OPTION_ID.test(fields.optionId))) {
    errors.push('optionId must be a safe id');
  }
  if (hasText && !boundedNonEmpty(fields.text, MAX_DECISION_TEXT_BYTES)) {
    errors.push(`text must be non-empty, <=${MAX_DECISION_TEXT_BYTES} bytes`);
  }
  if (errors.length) throw new ValidationError(errors);
  return deepFreeze(hasOptionId ? { optionId: fields.optionId, text: null } : { optionId: null, text: fields.text });
}

// ---------------------------------------------------------------------------
// Board channel (REFLEX-2, issue #17, docs/32 §3.2) — closed shapes for the
// orchestrator-controlled task board. Items are worker/orchestrator-authored
// content; these factories validate *shape* only. Identity (itemId, itemVersion,
// itemDigest, ordinal) is hub-minted (never accepted from a submitter) and is not
// part of the post/edit shape; the report shape DOES carry the exact observed
// (itemVersion, itemDigest) the worker binds its evidence to (F8, rule 3).
// ---------------------------------------------------------------------------

const SAFE_BOARD_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const SAFE_ITEM_ID = /^[A-Za-z0-9_.:-]{1,256}$/;
const ITEM_DIGEST = /^[a-f0-9]{64}$/;
const MAX_BOARD_TITLE_BYTES = 160;
const MAX_BOARD_DETAIL_BYTES = 4_096;
const MAX_BOARD_REPORT_BYTES = 4_096;
const MAX_BOARD_EVIDENCE = 8;

function validEvidenceRef(ref) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return false;
  const keys = Object.keys(ref).sort().join(',');
  if (keys === 'coordinationSeq') return Number.isSafeInteger(ref.coordinationSeq) && ref.coordinationSeq > 0;
  if (keys === 'artifactId') return typeof ref.artifactId === 'string' && ref.artifactId.length > 0;
  return false;
}

/** @param {{board,title,detail?,owner?,evidence?}} fields @returns {object} a deeply-frozen BoardItem post shape @throws {ValidationError} */
export function createBoardItem(fields) {
  const errors = [];
  const allowedKeys = new Set(['board', 'title', 'detail', 'owner', 'evidence']);
  for (const key of Object.keys(fields ?? {})) {
    if (!allowedKeys.has(key)) errors.push(`board item has an unknown field "${key}"`);
  }
  if (typeof fields?.board !== 'string' || !SAFE_BOARD_ID.test(fields.board)) errors.push('board must be a safe id (letters, digits, "_.:-", 1..128 bytes)');
  if (!boundedNonEmpty(fields?.title, MAX_BOARD_TITLE_BYTES)) errors.push(`title is required (non-empty, <=${MAX_BOARD_TITLE_BYTES} bytes)`);
  if (fields?.detail !== undefined && fields.detail !== null && !boundedNonEmpty(fields.detail, MAX_BOARD_DETAIL_BYTES)) {
    errors.push(`detail must be null or non-empty, <=${MAX_BOARD_DETAIL_BYTES} bytes`);
  }
  if (fields?.owner !== undefined && fields.owner !== null && (typeof fields.owner !== 'string' || !SAFE_OPTION_ID.test(fields.owner))) {
    errors.push('owner must be null or a safe worker id');
  }
  if (fields?.evidence !== undefined) {
    if (!Array.isArray(fields.evidence) || fields.evidence.length > MAX_BOARD_EVIDENCE) errors.push(`evidence must be an array of 0..${MAX_BOARD_EVIDENCE} refs`);
    else fields.evidence.forEach((ref, i) => { if (!validEvidenceRef(ref)) errors.push(`evidence[${i}] must reference a positive coordinationSeq or an artifactId`); });
  }
  if (errors.length) throw new ValidationError(errors);
  return deepFreeze({
    board: fields.board,
    title: fields.title,
    detail: fields.detail ?? null,
    owner: fields.owner ?? null,
    evidence: (fields.evidence ?? []).map((ref) => ({ ...ref })),
  });
}

/** @param {{itemId,expectedBoardFence}} fields @returns {object} a deeply-frozen board claim request @throws {ValidationError} */
export function createBoardClaimRequest(fields) {
  const errors = [];
  const allowedKeys = new Set(['itemId', 'expectedBoardFence']);
  for (const key of Object.keys(fields ?? {})) {
    if (!allowedKeys.has(key)) errors.push(`board claim request has an unknown field "${key}"`);
  }
  if (typeof fields?.itemId !== 'string' || !SAFE_ITEM_ID.test(fields.itemId)) errors.push('itemId must be a safe id');
  if (!Number.isSafeInteger(fields?.expectedBoardFence) || fields.expectedBoardFence < 0) errors.push('expectedBoardFence is required and must be a non-negative safe integer');
  if (errors.length) throw new ValidationError(errors);
  return deepFreeze({ itemId: fields.itemId, expectedBoardFence: fields.expectedBoardFence });
}

/** @param {{itemId,itemVersion,itemDigest,body}} fields @returns {object} a deeply-frozen board report shape @throws {ValidationError} */
export function createBoardReport(fields) {
  const errors = [];
  const allowedKeys = new Set(['itemId', 'itemVersion', 'itemDigest', 'body']);
  for (const key of Object.keys(fields ?? {})) {
    if (!allowedKeys.has(key)) errors.push(`board report has an unknown field "${key}"`);
  }
  if (typeof fields?.itemId !== 'string' || !SAFE_ITEM_ID.test(fields.itemId)) errors.push('itemId must be a safe id');
  if (!Number.isSafeInteger(fields?.itemVersion) || fields.itemVersion <= 0) errors.push('itemVersion is required and must be a positive safe integer');
  if (typeof fields?.itemDigest !== 'string' || !ITEM_DIGEST.test(fields.itemDigest)) errors.push('itemDigest is required and must be a 64-hex content digest');
  if (!boundedNonEmpty(fields?.body, MAX_BOARD_REPORT_BYTES)) errors.push(`body is required (non-empty, <=${MAX_BOARD_REPORT_BYTES} bytes)`);
  if (errors.length) throw new ValidationError(errors);
  return deepFreeze({ itemId: fields.itemId, itemVersion: fields.itemVersion, itemDigest: fields.itemDigest, body: fields.body });
}

// ---------------------------------------------------------------------------
// Provenance typing — facts (hub-computed, trusted) vs prose (worker, untrusted)
// ---------------------------------------------------------------------------

export function wrapFact(worker, kind, data) {
  return { worker, kind, data, provenance: 'hub-computed', untrusted: false };
}

export function wrapProse(worker, text) {
  return { worker, text, provenance: 'model-authored', untrusted: true };
}

// Issue #33: seal the already-sanitized application projection before it crosses a provider or
// driver message boundary. Grammar/admission belongs to CoordinationStore; this constructor
// rejects extension bags and prevents downstream mutation of the closed projection union.
export function createScratchpadEntry(fields) {
  const keys = [
    'schemaVersion', 'entryId', 'entryDigest', 'contentDigest', 'runId', 'scope',
    'authorWorkerId', 'authorTaskId', 'ordinal', 'kind', 'createdEvent', 'createdAt',
    'candidateState', 'source', 'content',
  ];
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)
    || Object.keys(fields).sort().join(',') !== keys.sort().join(',')
    || fields.schemaVersion !== 1 || fields.candidateState !== 'candidate'
    || !['note', 'plan', 'doubt', 'link'].includes(fields.kind)
    || fields.content?.kind !== fields.kind) {
    throw new ValidationError(['scratchpad projection entry is invalid']);
  }
  return deepFreeze(JSON.parse(JSON.stringify(fields)));
}

// ---------------------------------------------------------------------------
// Attention-text hygiene (KG-3 rule 7, v2-P1-5). Relocated here from the app layer
// so the coordinator can import it without an app→coordinator cycle: messages.mjs
// imports only node:crypto and is already imported by both coordinator and
// application.mjs. NFKC-normalize, redact credential-shaped prose, cap at a byte
// ceiling. The KG briefing is *derived* from folded KG state (never free worker
// prose), so it is provenance-marked hub-derived/untrusted and can never diverge
// from what the projection contains.
// ---------------------------------------------------------------------------

export const MAX_ATTENTION_TEXT_BYTES = 4_096;

export const SECRET_SHAPED_TEXT = Object.freeze([
  /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/gu,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|credential|password|secret)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}/giu,
  /\b(?:sk|sk-proj)-[A-Za-z0-9_-]{16,}\b/gu,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu,
  /\bAKIA[A-Z0-9]{16}\b/gu,
  /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/gu,
]);

/** Cap a string at maxBytes without splitting a UTF-8 scalar. */
function capBytes(text, maxBytes) {
  let out = '';
  let bytes = 0;
  for (const ch of text) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > maxBytes) return { text: out, truncated: true };
    out += ch;
    bytes += size;
  }
  return { text: out, truncated: false };
}

/** NFKC-normalize, redact credential-shaped prose, cap at maxBytes. */
export function boundedAttentionText(value, maxBytes = MAX_ATTENTION_TEXT_BYTES) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  const normalized = text.normalize('NFKC');
  let redacted = normalized;
  for (const pattern of SECRET_SHAPED_TEXT) { pattern.lastIndex = 0; redacted = redacted.replace(pattern, '[redacted]'); }
  return capBytes(redacted, maxBytes).text;
}

/** Render a RecallPreview (coordination-store.mjs) into a provider-visible, sanitized,
 * byte-bounded briefing block. Contradiction nodes carry a WARNING: prefix; degrade
 * renders one honest line, never silence (KG-3 rule 7). Provenance is hub-derived/
 * untrusted — the briefing rides the `{ brief, briefing }` wrapper and never mutates
 * task.brief. */
export function renderBriefing(preview, maxBytes = MAX_ATTENTION_TEXT_BYTES) {
  const lines = [];
  if (!preview) {
    lines.push('briefing unavailable (no projection)');
  } else if (preview.briefingUnavailable) {
    lines.push(preview.contradictionFlood
      ? 'contradictions present, surfacing ceiling exceeded'
      : `briefing unavailable (${preview.reason})`);
  } else {
    for (const node of preview.nodes ?? []) {
      const prefix = node.warning ? 'WARNING: ' : '';
      const confidence = node.confidence ? ` [confidence ${node.confidence.label}]` : '';
      const staleness = node.staleness ? ` [stale: ${node.staleness.reasons.join(',')}]` : '';
      lines.push(boundedAttentionText(`${prefix}${node.id} (${node.type})${confidence}${staleness}: ${node.snippet ?? ''}`));
    }
    if (lines.length === 0) lines.push('no related knowledge surfaced');
  }
  const capped = capBytes(lines.join('\n'), maxBytes);
  return {
    text: capped.truncated ? boundedAttentionText(`${capped.text}\n[briefing truncated]`, maxBytes) : capped.text,
    truncated: capped.truncated,
    provenance: 'hub-derived',
    untrusted: true,
  };
}

export function isFact(x) {
  return !!x && x.provenance === 'hub-computed' && x.untrusted === false;
}

// ---------------------------------------------------------------------------
// buildKnowledgeSlice — KG activation rule 1: the ambient serving slice. Pure, deterministic given
// the recalled nodes and a fixed `now`. Filters expired-validity nodes at serve time (rule 5), bounds
// by BOTH a finding-count cap and a byte cap (whichever binds first), wraps every item in the
// `{provenance:'knowledge', untrusted:true}` prose envelope with its grounding ref + validity dates,
// and reports an honest empty slice for an empty graph (never fabricated relevance). The slice is the
// data renderBrief renders at the serving seam; it never enters task.brief (briefDigest is untouched).
// ---------------------------------------------------------------------------

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonicalValue(value[k])]));
}

function stableDigest(value) {
  return createHash('sha256').update(JSON.stringify(canonicalValue(value))).digest('hex');
}

/**
 * @param {Array<object>} nodes recalled knowledge nodes (e.g. queryKnowledge findings)
 * @param {{maxFindings?:number, maxBytes?:number, now?:number|string}} [opts]
 * @returns {{provenance:string, untrusted:boolean, items:Array<object>, bytes:number, truncated:boolean, honestEmpty:boolean}}
 */
export function buildKnowledgeSlice(nodes, { maxFindings = 8, maxBytes = 2_048, now } = {}) {
  const at = typeof now === 'number' ? now : (now == null ? Date.now() : Date.parse(now));
  const eligible = (Array.isArray(nodes) ? nodes : [])
    .filter((node) => {
      if (!node || node.validTo == null) return true;
      const end = Date.parse(node.validTo);
      return Number.isFinite(end) ? end > at : true;
    })
    .slice()
    .sort((a, b) => (a.observedSeq ?? 0) - (b.observedSeq ?? 0));
  const items = [];
  let bytes = 0;
  for (const node of eligible) {
    if (items.length >= maxFindings) break;
    const snippet = typeof node.body === 'string' ? capBytes(node.body, 256).text : '';
    const item = {
      provenance: 'knowledge',
      untrusted: true,
      id: node.id,
      ref: node.grounding ?? 'observed',
      groundingDigest: stableDigest({ grounding: node.grounding ?? null, evidence: node.evidence ?? [] }),
      validFrom: node.validFrom ?? null,
      validTo: node.validTo ?? null,
      snippet,
    };
    const itemBytes = Buffer.byteLength(JSON.stringify(item));
    if (items.length > 0 && bytes + itemBytes > maxBytes) break;
    items.push(item);
    bytes += itemBytes;
  }
  return deepFreeze({
    provenance: 'knowledge',
    untrusted: true,
    items: deepFreeze(items),
    bytes,
    truncated: items.length < eligible.length,
    honestEmpty: items.length === 0,
  });
}

export function isProse(x) {
  return !!x && x.provenance === 'model-authored' && x.untrusted === true;
}

/** @param {{cursor,more,attention?,facts?,prose?}} d */
export function createDigest(d) {
  const facts = d.facts ?? [];
  const prose = d.prose ?? [];
  const errors = [];
  facts.forEach((f, i) => { if (!isFact(f)) errors.push(`facts[${i}] lacks hub-computed/untrusted:false provenance`); });
  prose.forEach((p, i) => { if (!isProse(p)) errors.push(`prose[${i}] lacks model-authored/untrusted:true provenance`); });
  if (errors.length) throw new ValidationError(errors);
  return { cursor: d.cursor, more: !!d.more, attention: d.attention ?? [], facts, prose };
}

/** @param {{turnEpoch:number}} msg @param {number} currentTurnEpoch @returns {boolean} */
export function isStale(msg, currentTurnEpoch) {
  if (typeof msg.turnEpoch !== 'number' || !Number.isFinite(msg.turnEpoch)) {
    throw new ValidationError(['message.turnEpoch must be a finite number']);
  }
  return msg.turnEpoch < currentTurnEpoch;
}
