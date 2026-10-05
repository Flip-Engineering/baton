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

export class RefRefusal extends Error {
  constructor(condition, detail) {
    super(detail === undefined || detail === null ? condition : `${condition}: ${detail}`);
    this.name = 'RefRefusal';
    this.condition = condition;
    this.detail = detail === undefined ? null : detail;
  }
}

const isText = (value) => typeof value === 'string' && value.length > 0;

function refusal(condition, detail) {
  return { ok: false, condition, detail: detail === undefined ? null : detail };
}

export function refIdentity({ runtime, adapter, thread, epoch, mutationGeneration, kind, handle }) {
  const identity = { runtime, adapter, thread, epoch, mutationGeneration, kind, handle };
  const admitted = admitIdentity(identity);
  if (!admitted.ok) throw new RefRefusal(admitted.condition, admitted.detail);
  return identity;
}

function admitIdentity(identity) {
  if (typeof identity !== 'object' || identity === null || Array.isArray(identity)) {
    return refusal('refMalformed', 'identity is not an object');
  }
  if (!isText(identity.runtime)) return refusal('refMalformed', 'runtime');
  if (!isText(identity.adapter)) return refusal('refMalformed', 'adapter');
  if (!isText(identity.thread)) return refusal('refMalformed', 'thread');
  if (!counterValid(identity.epoch)) return refusal('refMalformed', 'epoch is not canonical counter text');
  if (!counterValid(identity.mutationGeneration)) {
    return refusal('refMalformed', 'mutationGeneration is not canonical counter text');
  }
  if (!REF_KINDS.includes(identity.kind)) return refusal('refMalformed', `kind ${identity.kind}`);
  if (!isText(identity.handle)) return refusal('refMalformed', 'handle');
  return { ok: true, identity };
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
  if (typeof scope !== 'object' || scope === null) return refusal('refMalformed', 'scope');
  const counters = counterPair(scope.epoch, scope.mutationGeneration);
  if (!counters.ok) return refusal('refMalformed', `scope ${counters.detail}`);
  let identity;
  try {
    identity = typeof ref === 'string' ? decodeRefId(ref) : ref;
  } catch (error) {
    return refusal(error.condition ?? 'refMalformed', error.detail ?? error.message);
  }
  const admitted = admitIdentity(identity);
  if (!admitted.ok) return admitted;
  if (identity.runtime !== scope.runtime) {
    return refusal('foreignRuntime', `${identity.runtime} != ${scope.runtime}`);
  }
  if (identity.adapter !== scope.adapter) {
    return refusal('foreignAdapter', `${identity.adapter} != ${scope.adapter}`);
  }
  if (identity.epoch !== scope.epoch) {
    return refusal('staleReference', `epoch ${identity.epoch} != live epoch ${scope.epoch}`);
  }
  if (identity.mutationGeneration !== scope.mutationGeneration) {
    return refusal('refRetiredByMutation',
      `mutation generation ${identity.mutationGeneration} != live ${scope.mutationGeneration}`);
  }
  return { ok: true, identity };
}
