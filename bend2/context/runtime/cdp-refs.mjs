// CDP runtime lane: runtime reference identity, canonical encoding and
// epoch/mutation-scoped admission.
//
// Contract: docs/bend2/semantic-context-spec.md, "Results, classifications and
// references" and "Runtime contract". Every frame/object ref includes runtime,
// adapter, thread, epoch and mutation generation. An adapter-owned epoch advances at
// every observed pause and at an invalidating resume or context destruction. A separate
// mutation generation advances before explicit evaluation, retiring previously issued
// live-value refs. A stale ref refuses before any backend request. The backend may reuse
// identical ids at a later pause, so adapter validation is mandatory and a same-pause
// handle is never trusted across an epoch or mutation-generation change.
//
// Counter identities are canonical unsigned decimal text (runtime-counter-boundary-69):
// they are carried and compared as text, never as a Number. The canonical reference
// array layout itself belongs to the codec/core owner; this module supplies the
// validation the adapter performs on a ref before any backend request.

import { counterValid, counterPair } from './cdp-counter.mjs';

export const REF_KINDS = Object.freeze(['runtime', 'thread', 'frame', 'scope', 'object', 'script']);

// The production ref decision. `decision` is the authoritative member: only an
// `admitted` decision with a revalidated identity lets a caller send against the ref.
// A refused decision carries the condition and detail. A caller must not treat any other
// value, including a bare `{ok:true}`, null, undefined or a malformed object, as success.
export const REF_DECISIONS = Object.freeze(['admitted', 'refused']);

export class RefRefusal extends Error {
  constructor(condition, detail) {
    super(detail === undefined || detail === null ? condition : `${condition}: ${detail}`);
    this.name = 'RefRefusal';
    this.condition = condition;
    this.detail = detail === undefined ? null : detail;
  }
}

const isText = (value) => typeof value === 'string' && value.length > 0;

function refusedDecision(condition, detail) {
  return { decision: 'refused', ok: false, condition, detail: detail === undefined ? null : detail };
}

function admittedDecision(identity) {
  return { decision: 'admitted', ok: true, identity };
}

export function refIdentity({ runtime, adapter, thread, epoch, mutationGeneration, kind, handle }) {
  const identity = { runtime, adapter, thread, epoch, mutationGeneration, kind, handle };
  const admitted = admitIdentity(identity);
  if (!admitted.ok) throw new RefRefusal(admitted.condition, admitted.detail);
  return identity;
}

function admitIdentity(identity) {
  if (typeof identity !== 'object' || identity === null || Array.isArray(identity)) {
    return refusedDecision('refMalformed', 'identity is not an object');
  }
  if (!isText(identity.runtime)) return refusedDecision('refMalformed', 'runtime');
  if (!isText(identity.adapter)) return refusedDecision('refMalformed', 'adapter');
  if (!isText(identity.thread)) return refusedDecision('refMalformed', 'thread');
  if (!counterValid(identity.epoch)) return refusedDecision('refMalformed', 'epoch is not canonical counter text');
  if (!counterValid(identity.mutationGeneration)) {
    return refusedDecision('refMalformed', 'mutationGeneration is not canonical counter text');
  }
  if (!REF_KINDS.includes(identity.kind)) return refusedDecision('refMalformed', `kind ${identity.kind}`);
  if (!isText(identity.handle)) return refusedDecision('refMalformed', 'handle');
  return admittedDecision(identity);
}

// Canonical id text: ["runtime",runtime,adapter,thread,epoch,mutationGeneration,kind,handle]
// with both counters as their admitted text.
export function encodeRefId(identity) {
  const admitted = admitIdentity(identity);
  if (!admitted.ok) throw new RefRefusal(admitted.condition, admitted.detail);
  return JSON.stringify([
    'runtime',
    identity.runtime,
    identity.adapter,
    identity.thread,
    identity.epoch,
    identity.mutationGeneration,
    identity.kind,
    identity.handle,
  ]);
}

export function decodeRefId(text) {
  if (typeof text !== 'string') throw new RefRefusal('refMalformed', 'id is not text');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new RefRefusal('refMalformed', error.message);
  }
  if (!Array.isArray(parsed) || parsed.length !== 8 || parsed[0] !== 'runtime') {
    throw new RefRefusal('refMalformed', 'id is not a canonical runtime ref array');
  }
  const identity = {
    runtime: parsed[1],
    adapter: parsed[2],
    thread: parsed[3],
    epoch: parsed[4],
    mutationGeneration: parsed[5],
    kind: parsed[6],
    handle: parsed[7],
  };
  const admitted = admitIdentity(identity);
  if (!admitted.ok) throw new RefRefusal(admitted.condition, admitted.detail);
  return identity;
}

// Admit one ref against the live scope. `ref` is an identity object or the canonical
// id text. The scope is {runtime, adapter, epoch, mutationGeneration} with counters as
// admitted text. The epoch is checked before the mutation generation: a ref from
// another pause is stale, and a live-value ref from an earlier mutation generation is
// retired by the evaluation that advanced it.
export function admitRef(ref, scope) {
  if (typeof scope !== 'object' || scope === null) return refusedDecision('refMalformed', 'scope');
  const counters = counterPair(scope.epoch, scope.mutationGeneration);
  if (!counters.ok) return refusedDecision('refMalformed', `scope ${counters.detail}`);
  let identity;
  try {
    identity = typeof ref === 'string' ? decodeRefId(ref) : ref;
  } catch (error) {
    return refusedDecision(error.condition ?? 'refMalformed', error.detail ?? error.message);
  }
  const admitted = admitIdentity(identity);
  if (!admitted.ok) return admitted;
  if (identity.runtime !== scope.runtime) {
    return refusedDecision('foreignRuntime', `${identity.runtime} != ${scope.runtime}`);
  }
  if (identity.adapter !== scope.adapter) {
    return refusedDecision('foreignAdapter', `${identity.adapter} != ${scope.adapter}`);
  }
  if (identity.epoch !== scope.epoch) {
    return refusedDecision('staleReference', `epoch ${identity.epoch} != live epoch ${scope.epoch}`);
  }
  if (identity.mutationGeneration !== scope.mutationGeneration) {
    return refusedDecision('refRetiredByMutation',
      `mutation generation ${identity.mutationGeneration} != live ${scope.mutationGeneration}`);
  }
  return admittedDecision(identity);
}

// Normalize one candidate decision. Only `{decision:'admitted', identity}` with an
// identity that still validates is admitted; a refusal keeps its condition; and null,
// undefined, a missing or unknown decision, a non-object or a malformed identity refuses.
// `ok` is retained for compatibility and must not contradict `decision`: an admitted
// decision carrying `ok:false` refuses as refDecisionContradictory rather than being
// silently believed.
//
// This function revalidates the identity's own shape and the decision's coherence only.
// Admission against the live runtime, epoch and mutation generation remains
// admitRef(ref, scope), and session.admitRef is the current-scope gate a caller uses
// before a send.
export function refDecision(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return refusedDecision('refDecisionMalformed', 'not a decision object');
  }
  if (value.decision !== 'admitted') {
    return refusedDecision(
      typeof value.condition === 'string' ? value.condition : 'refDecisionRefused',
      value.decision === 'refused' ? value.detail ?? null : `decision ${JSON.stringify(value.decision)}`,
    );
  }
  if (value.ok === false) {
    return refusedDecision('refDecisionContradictory', 'an admitted decision carried ok:false');
  }
  const admitted = admitIdentity(value.identity);
  if (!admitted.ok) return admitted;
  return admitted;
}

// The identity of an admitted decision, or a thrown refusal. This is the only sanctioned
// way to turn a decision into something a send may use.
export function requireAdmittedRef(value) {
  const decision = refDecision(value);
  if (decision.decision !== 'admitted') throw new RefRefusal(decision.condition, decision.detail);
  return decision.identity;
}
