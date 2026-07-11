export function routeTupleKey(card, model, effort, taskType = 'general') {
  const fields = [card?.harness ?? 'unknown', card?.version ?? 'unknown', model ?? 'default', effort ?? 'default', card?.modelSelection?.family ?? 'default', taskType];
  return JSON.stringify(fields);
}

export function resolveEffort(card, requested) {
  const inventory = card?.modelSelection?.reasoningEffort;
  if (requested != null && (!Array.isArray(inventory) || !inventory.includes(requested))) return { ok: false, reason: 'reasoning_effort_unsupported' };
  return { ok: true, effort: requested ?? card?.modelSelection?.configuredEffort ?? null };
}
