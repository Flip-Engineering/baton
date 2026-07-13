// messages.mjs — the message shapes (the Brief delegation contract + nudge/steer/ask/
// answer/result/digest) and provenance typing (hub-computed facts vs untrusted worker
// prose). Pure: deterministic given injected now/idGen. No trust is ever implied by shape.

import { randomUUID } from 'node:crypto';

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
// Provenance typing — facts (hub-computed, trusted) vs prose (worker, untrusted)
// ---------------------------------------------------------------------------

export function wrapFact(worker, kind, data) {
  return { worker, kind, data, provenance: 'hub-computed', untrusted: false };
}

export function wrapProse(worker, text) {
  return { worker, text, provenance: 'model-authored', untrusted: true };
}

export function isFact(x) {
  return !!x && x.provenance === 'hub-computed' && x.untrusted === false;
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
