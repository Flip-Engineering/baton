export function routeTupleKey(card, model, effort, taskType = 'general', workerPolicyResolution = null) {
  const fields = [card?.harness ?? 'unknown', card?.version ?? 'unknown', model ?? 'default', effort ?? 'default', card?.modelSelection?.family ?? 'default', taskType];
  if (workerPolicyResolution?.resolutionDigest) fields.push(workerPolicyResolution.resolutionDigest);
  return JSON.stringify(fields);
}

export function parseRouteTupleKey(value) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > 4096) {
    throw Object.assign(new TypeError('route tuple key is invalid'), { code: 'route_tuple_invalid' });
  }
  let tuple;
  try { tuple = JSON.parse(value); } catch {
    throw Object.assign(new TypeError('route tuple key is invalid'), { code: 'route_tuple_invalid' });
  }
  if (!Array.isArray(tuple) || ![6, 7].includes(tuple.length)
    || tuple.some((field) => typeof field !== 'string' || field.length === 0 || Buffer.byteLength(field) > 1024)
    || (tuple.length === 7 && !/^[a-f0-9]{64}$/u.test(tuple[6]))) {
    throw Object.assign(new TypeError('route tuple key is invalid'), { code: 'route_tuple_invalid' });
  }
  const fields = Object.freeze([...tuple]);
  return Object.freeze({
    key: value, fields,
    harness: fields[0], version: fields[1], model: fields[2], effort: fields[3],
    modelFamily: fields[4], taskType: fields[5],
    workerPolicyResolutionDigest: fields[6] ?? null,
    attested: fields.length === 7,
  });
}

export function resolveEffort(card, requested) {
  const inventory = card?.modelSelection?.reasoningEffort;
  if ((requested === undefined || requested === null || requested === '') && card?.modelSelection?.effortRequired === true) {
    return { ok: false, reason: 'reasoning_effort_required' };
  }
  if (requested != null && (!Array.isArray(inventory) || !inventory.includes(requested))) return { ok: false, reason: 'reasoning_effort_unsupported' };
  return { ok: true, effort: requested ?? card?.modelSelection?.configuredEffort ?? null };
}
