const RELATIONS = Object.freeze([
  'follow_up', 'oracle', 'preserved_resume', 'recovery', 'review', 'revision',
]);

export const TASK_TOPOLOGY_RELATIONS = RELATIONS;

export const DEFAULT_TASK_TOPOLOGY_POLICY = Object.freeze({
  schemaVersion: 1,
  maxDepth: 32,
  maxChildrenPerTask: 64,
  maxTasksPerRun: 1_024,
  maxChildrenByRelation: Object.freeze({
    follow_up: 32,
    oracle: 8,
    preserved_resume: 8,
    recovery: 8,
    review: 8,
    revision: 8,
  }),
});

function invalid(message) {
  throw Object.assign(new TypeError(message), { code: 'task_topology_policy_invalid' });
}

export function normalizeTaskTopologyPolicy(value = DEFAULT_TASK_TOPOLOGY_POLICY) {
  const fields = ['maxChildrenByRelation', 'maxChildrenPerTask', 'maxDepth', 'maxTasksPerRun', 'schemaVersion'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== fields.sort().join(',')
    || value.schemaVersion !== 1
    || !Number.isSafeInteger(value.maxDepth) || value.maxDepth < 0 || value.maxDepth > 4_096
    || !Number.isSafeInteger(value.maxChildrenPerTask) || value.maxChildrenPerTask <= 0 || value.maxChildrenPerTask > 1_000_000
    || !Number.isSafeInteger(value.maxTasksPerRun) || value.maxTasksPerRun <= 0 || value.maxTasksPerRun > 1_000_000
    || !value.maxChildrenByRelation || typeof value.maxChildrenByRelation !== 'object'
    || Array.isArray(value.maxChildrenByRelation)
    || Object.keys(value.maxChildrenByRelation).sort().join(',') !== [...RELATIONS].sort().join(',')
    || Object.values(value.maxChildrenByRelation).some((limit) => !Number.isSafeInteger(limit) || limit < 0 || limit > value.maxChildrenPerTask)) {
    invalid('task topology policy must be one closed bounded deployment policy');
  }
  return Object.freeze({
    schemaVersion: 1,
    maxDepth: value.maxDepth,
    maxChildrenPerTask: value.maxChildrenPerTask,
    maxTasksPerRun: value.maxTasksPerRun,
    maxChildrenByRelation: Object.freeze(Object.fromEntries(
      RELATIONS.map((relation) => [relation, value.maxChildrenByRelation[relation]]),
    )),
  });
}

export function inferTaskTopologyRelation(fields, hint = null) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  if (fields.refines == null) {
    const rootRelation = hint ?? fields.relation ?? 'root';
    return rootRelation === 'root' ? 'root' : null;
  }
  const relation = hint
    ?? fields.relation
    ?? (['review', 'oracle'].includes(fields.review?.kind) ? fields.review.kind : null)
    ?? (['review', 'oracle'].includes(fields.taskType) ? fields.taskType : null);
  return RELATIONS.includes(relation) ? relation : null;
}
