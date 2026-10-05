// Expectation checker for one coordinator answer.
//
// It reads only fields the specification fixes, and it reports the check that
// failed with the observed value. Route and cut-set key spellings are resolved
// from a small candidate list until the schema owner publishes the exact names;
// a relation whose route keys cannot be resolved fails the check that needs them.

import { existsSync, readFileSync } from 'node:fs';
import { sha256File } from './fixtures.mjs';

const ROUTE_KEYS = ['acceptedRoutes', 'accepted_routes', 'accepted'];
const DENIED_KEYS = ['deniedRoutes', 'denied_routes', 'denied'];
const CUTSET_KEYS = ['cutEdgeSet', 'cut_edge_set', 'cutset'];
const RETURN_KEYS = ['returnRefs', 'returnRef', 'return_refs', 'returns', 'terminal'];
const GUARD_KEYS = ['guardRef', 'guard_ref', 'conditionRef', 'condition_ref'];
const CALL_KEYS = ['callRef', 'call_ref', 'callsite'];

function firstKey(object, keys) {
  if (object === null || typeof object !== 'object') return null;
  for (const key of keys) if (key in object) return key;
  return null;
}

export function itemsOf(envelope) {
  const result = envelope?.result;
  const facts = Array.isArray(result?.facts) ? result.facts : [];
  const relations = Array.isArray(result?.relations) ? result.relations : [];
  return [...facts, ...relations];
}

export function relationsOf(envelope) {
  const result = envelope?.result;
  return Array.isArray(result?.relations) ? result.relations : [];
}

export function limitsOf(envelope) {
  const limits = [];
  if (Array.isArray(envelope?.result?.limits)) limits.push(...envelope.result.limits);
  if (Array.isArray(envelope?.error?.limits)) limits.push(...envelope.error.limits);
  return limits;
}

function edgeIdentity(edge) {
  if (edge === null || edge === undefined) return null;
  if (typeof edge === 'string') return edge;
  const keys = ['from', 'fromBlock', 'from_block', 'source', 'pred', 'block', 'edge', 'id'];
  const parts = [];
  for (const key of keys) if (key in edge) parts.push(`${key}=${JSON.stringify(edge[key])}`);
  if (parts.length === 0) return JSON.stringify(edge);
  return parts.join('|');
}

function edgeSet(edges) {
  return new Set((Array.isArray(edges) ? edges : []).map(edgeIdentity).filter(Boolean));
}

export function byteSpanOf(ref) {
  if (ref === null || typeof ref !== 'object') return null;
  for (const candidate of [ref, ref.value, Array.isArray(ref.evidence) ? ref.evidence[0] : null]) {
    if (!candidate || typeof candidate !== 'object') continue;
    const start = firstKey(candidate, ['byteStart', 'byte_start']);
    const end = firstKey(candidate, ['byteEnd', 'byte_end']);
    if (start !== null && end !== null) return { start: candidate[start], end: candidate[end] };
    const range = candidate.range;
    if (range && typeof range === 'object' && typeof range.begin?.offset === 'number') {
      return { start: range.begin.offset, end: range.end?.offset };
    }
  }
  return null;
}

function resolveRefValue(envelope, ref) {
  if (ref === null || typeof ref === 'object') return ref;
  if (typeof ref !== 'string') return null;
  const refs = Array.isArray(envelope?.result?.refs) ? envelope.result.refs : [];
  return refs.find((entry) => entry?.id === ref) ?? null;
}

function sourceEvidence(envelope) {
  const found = [];
  for (const item of itemsOf(envelope)) {
    const evidence = Array.isArray(item.evidence) ? item.evidence : [];
    for (const entry of evidence) if (entry?.kind === 'source') found.push({ item, entry });
  }
  return found;
}

function mention(ex, text) {
  return typeof text === 'string' && text.length > 0 && ex.includes(text);
}

export function checkExpectation(expect, answer, context = {}) {
  const failures = [];
  const notes = [];
  const envelope = answer?.envelope ?? null;
  const fail = (message) => failures.push(message);

  // exit code and outcome
  if (typeof expect.exitCode === 'number' && answer?.exitCode !== expect.exitCode) {
    fail(`exitCode: expected ${expect.exitCode}, observed ${answer?.exitCode}`);
  }
  if (expect.outcome) {
    const state = envelope?.state
      ?? (typeof envelope?.error === 'string' ? 'refused' : envelope?.error?.kind)
      ?? null;
    if (state !== expect.outcome) fail(`outcome: expected ${expect.outcome}, observed ${state}`);
    if (expect.outcome === 'refused' && !envelope?.error) fail('outcome refused without an error object');
  }
  if (expect.refusalCondition || expect.refusalConditionIncludes) {
    const condition = envelope?.condition ?? envelope?.error?.condition ?? null;
    const text = JSON.stringify(condition ?? '');
    if (!condition) fail('refusalCondition: no condition field on the refusal');
    if (expect.refusalConditionIncludes && !mention(text, expect.refusalConditionIncludes)) {
      fail(`refusalConditionIncludes: ${JSON.stringify(expect.refusalConditionIncludes)} absent from ${text}`);
    }
    if (expect.refusalCondition && text !== JSON.stringify(expect.refusalCondition)) {
      notes.push(`refusalCondition observed as ${text}`);
    }
  }

  // required relations
  for (const spec of expect.relations ?? []) {
    const matching = relationsOf(envelope).filter((item) => item?.kind === spec.kind);
    if (matching.length === 0) {
      fail(`relations: no relation of kind ${spec.kind}`);
      continue;
    }
    let qualified = matching;
    if (spec.classification) {
      qualified = matching.filter((item) => item?.classification === spec.classification);
      if (qualified.length === 0) {
        fail(`relations: ${spec.kind} present but none classified ${spec.classification} (observed ${matching.map((item) => item.classification).join(', ')})`);
        continue;
      }
    }
    if (spec.count) {
      const { min, max } = spec.count;
      if (typeof min === 'number' && qualified.length < min) fail(`relations: ${spec.kind} count ${qualified.length} below ${min}`);
      if (typeof max === 'number' && qualified.length > max) fail(`relations: ${spec.kind} count ${qualified.length} above ${max}`);
    }
    if (spec.minAcceptedRoutes || spec.cutSetCoversAccepted || spec.deniedRouteReachesReturn) {
      const item = qualified[0];
      const value = item.value ?? item;
      const acceptedKey = firstKey(value, ROUTE_KEYS);
      const deniedKey = firstKey(value, DENIED_KEYS);
      const cutKey = firstKey(value, CUTSET_KEYS);
      if (spec.minAcceptedRoutes) {
        if (acceptedKey === null) {
          fail(`minAcceptedRoutes: ${spec.kind} value carries no accepted route key (${ROUTE_KEYS.join(', ')})`);
        } else {
          const accepted = new Set((value[acceptedKey] ?? []).map(edgeIdentity).filter(Boolean));
          if (accepted.size < spec.minAcceptedRoutes) {
            fail(`minAcceptedRoutes: expected at least ${spec.minAcceptedRoutes} distinct accepted edges, observed ${accepted.size}`);
          }
        }
      }
      if (spec.cutSetCoversAccepted) {
        if (acceptedKey === null || cutKey === null) {
          fail(`cutSetCoversAccepted: missing accepted or cut-set key on ${spec.kind}`);
        } else {
          const accepted = edgeSet(value[acceptedKey]);
          const cut = edgeSet(value[cutKey]);
          for (const edge of accepted) if (!cut.has(edge)) fail(`cutSetCoversAccepted: accepted edge ${edge} absent from the cut set`);
          for (const edge of cut) if (!accepted.has(edge)) fail(`cutSetCoversAccepted: cut-set edge ${edge} absent from the accepted set`);
          if (cut.size === 0) fail('cutSetCoversAccepted: empty cut set');
        }
      }
      if (spec.deniedRouteReachesReturn) {
        if (deniedKey === null) {
          fail(`deniedRouteReachesReturn: ${spec.kind} value carries no denied route key (${DENIED_KEYS.join(', ')})`);
        } else {
          const denied = value[deniedKey] ?? [];
          if (!Array.isArray(denied) || denied.length === 0) fail('deniedRouteReachesReturn: no denied routes recorded');
          else {
            for (const route of denied) {
              const key = firstKey(route, RETURN_KEYS);
              if (key === null || route[key] === null || route[key] === undefined) {
                fail(`deniedRouteReachesReturn: denied route ${JSON.stringify(route)} names no return`);
              }
            }
          }
        }
      }
    }
  }

  // forbidden relations
  for (const spec of expect.forbiddenRelations ?? []) {
    const matching = relationsOf(envelope).filter((item) => item?.kind === spec.kind);
    if (spec.callsite) {
      const hits = matching.filter((item) => JSON.stringify(item).includes(spec.callsite));
      if (hits.length > 0) fail(`forbiddenRelations: ${spec.kind} names callsite ${spec.callsite}`);
    } else if (matching.length > 0) {
      fail(`forbiddenRelations: ${matching.length} relation(s) of kind ${spec.kind}`);
    }
  }

  // limits
  const limits = limitsOf(envelope);
  for (const spec of expect.limits ?? []) {
    const hits = limits.filter((entry) => entry?.projection === spec.projection && (!spec.code || entry?.code === spec.code));
    if (hits.length === 0) {
      fail(`limits: no entry with projection ${spec.projection}${spec.code ? ` and code ${spec.code}` : ''}; observed ${JSON.stringify(limits)}`);
    }
  }
  for (const spec of expect.forbiddenLimits ?? []) {
    const hits = limits.filter((entry) => entry?.projection === spec.projection && entry?.code === spec.code);
    if (hits.length > 0) fail(`forbiddenLimits: entry ${spec.projection}/${spec.code} present`);
  }

  // byte-level checks
  const outputText = `${answer?.stdout ?? ''}\n${answer?.stderr ?? ''}\n${JSON.stringify(envelope ?? null)}`;
  for (const needle of expect.mustNotMention ?? []) {
    if (outputText.includes(needle)) fail(`mustNotMention: ${JSON.stringify(needle)} appears in the answer`);
  }
  if (expect.sourceIdentitiesVerified) {
    const evidence = sourceEvidence(envelope);
    if (evidence.length === 0) fail('sourceIdentitiesVerified: no source evidence items');
    for (const { entry } of evidence) {
      if (!entry.path || !existsSync(entry.path)) {
        fail(`sourceIdentitiesVerified: evidence path ${entry.path} does not exist`);
        continue;
      }
      const observed = sha256File(entry.path);
      if (entry.sha256 !== observed) fail(`sourceIdentitiesVerified: ${entry.path} digest ${entry.sha256} != ${observed}`);
    }
  }
  if (expect.snapshotInputs) {
    const snapshotText = JSON.stringify(envelope?.result?.snapshot ?? null);
    for (const relativePath of expect.snapshotInputs) {
      if (!snapshotText.includes(relativePath)) fail(`snapshotInputs: ${relativePath} absent from the snapshot`);
    }
  }
  if (expect.phaseConsistent) {
    const phases = context.phases ?? [];
    for (const { entry } of sourceEvidence(envelope)) {
      if (!entry.path || !existsSync(entry.path)) continue;
      const observed = sha256File(entry.path);
      const allowed = phases.map((phase) => phase[entry.path]).filter(Boolean);
      if (allowed.length > 0 && !allowed.includes(observed)) {
        fail(`phaseConsistent: ${entry.path} digest ${observed} matches no recorded phase`);
      }
    }
  }
  if (expect.ordering === 'guardPrecedesCall') {
    const guarded = relationsOf(envelope).filter((item) => item?.kind === 'guarded_call');
    if (guarded.length === 0) fail('ordering guardPrecedesCall: no guarded_call relation to order');
    for (const item of guarded) {
      const value = item.value ?? item;
      const guardKey = firstKey(value, GUARD_KEYS);
      const callKey = firstKey(value, CALL_KEYS);
      if (guardKey === null || callKey === null) {
        fail('ordering guardPrecedesCall: the relation names no guard or call ref');
        continue;
      }
      const guard = byteSpanOf(resolveRefValue(envelope, value[guardKey]));
      const call = byteSpanOf(resolveRefValue(envelope, value[callKey]));
      if (!guard || !call || typeof guard.end !== 'number' || typeof call.start !== 'number') {
        fail('ordering guardPrecedesCall: byte spans unavailable on the guard or call ref');
        continue;
      }
      if (call.start < guard.end) fail(`ordering guardPrecedesCall: call at ${call.start} precedes guard end ${guard.end}`);
    }
  }
  if (expect.applicability) {
    const observed = envelope?.result?.applicability ?? null;
    if (observed !== expect.applicability) fail(`applicability: expected ${expect.applicability}, observed ${observed}`);
  }
  if (expect.forbiddenOutcome) {
    const state = envelope?.state ?? null;
    if (state === expect.forbiddenOutcome) fail(`forbiddenOutcome: observed ${state}`);
  }
  if (expect.waitingForAll) {
    const waiting = envelope?.progress?.waitingFor;
    if (!Array.isArray(waiting)) {
      fail('waitingForAll: the envelope carries no progress.waitingFor array');
    } else {
      for (const spec of expect.waitingForAll) {
        const hit = waiting.some((entry) => entry?.kind === spec.kind && (!spec.reason || entry?.reason === spec.reason));
        if (!hit) fail(`waitingForAll: no entry for ${JSON.stringify(spec)}; observed ${JSON.stringify(waiting)}`);
      }
    }
  }
  if (expect.eitherOf) {
    const outcomes = expect.eitherOf.map((alternative) => checkExpectation(alternative, answer, context));
    if (!outcomes.some((outcome) => outcome.ok)) {
      fail(`eitherOf: no alternative held (${outcomes.map((outcome) => outcome.failures[0] ?? 'unknown').join(' | ')})`);
    }
  }
  if (expect.oneGuardPerCall) {
    const guarded = relationsOf(envelope).filter((item) => item?.kind === 'guarded_call');
    const seen = new Map();
    for (const item of guarded) {
      const value = item.value ?? item;
      const callKey = firstKey(value, CALL_KEYS);
      const identity = callKey === null ? JSON.stringify(item) : edgeIdentity(value[callKey]);
      seen.set(identity, (seen.get(identity) ?? 0) + 1);
    }
    for (const [identity, count] of seen) if (count > 1) fail(`oneGuardPerCall: ${count} relations for ${identity}`);
  }

  return { ok: failures.length === 0, failures, notes };
}
