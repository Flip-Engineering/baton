// Phase 93a.2 approval template (§93.8, amended). The authoring Program carries a
// non-authoritative template whose projections are exact and closed: roles equal the sorted
// normalized-catalog role names, effectKinds equal the sorted set of the seven effect kinds
// statically present in the Program's own nodes only (the caller computes and passes
// usedEffectKinds; 93a.2 control-only Programs yield the empty set; repeat/child bodies are
// independently normalized Programs bound by their own approval envelopes, never restated here),
// repositoryScopes equal the sorted union of every **inline** catalog role template's pathScope
// and contextScope with a [0..policy.maxEvidenceRefs] bound, and the three constraint digests
// recompute over the Program-canonical exact{kind, entries} preimages with set-like-by-role
// entries. templateDigest hashes the complete template excluding itself.
// A content_ref role template's bytes are an immutable approved artifact read only at replay, so
// its scopes are bound by that artifact's own approvalDigest and never join the static union
// here; a catalog whose roles are all content_ref carries an empty repositoryScopes projection.
// No I/O, no clocks, no randomness: every rejection happens before any effect.

import {
  canonicalProgramDigest, compareProgramIdentityKeys, deepFreezeProgramValue,
  isProgramValueAuthority, normalizeCanonicalProgramValue,
} from './canonical-value.mjs';
import {
  digestValue, exactFields, fail, normalizePathArray, safeId,
} from './control-nodes.mjs';
import { isProgramPolicy } from './program-policy.mjs';
import { isProgramRoleCatalog } from './role-catalog.mjs';

export const EFFECT_KINDS = Object.freeze([
  'call', 'checkpoint', 'finish', 'gate', 'map', 'notify', 'reduce',
]);

function authority(value) {
  if (!isProgramValueAuthority(value)) {
    fail('Approval template validation requires deployment-injected authority', 'program_policy_invalid');
  }
  return value;
}

function constraintDigest(kind, entries, deployed) {
  return canonicalProgramDigest({ kind, entries }, deployed);
}

// The exact §93.8 projections of a normalized catalog, reused by createApprovalTemplate so a
// fixture built with this helper is byte-identical to one validated by normalizeApprovalTemplate.
export function approvalTemplateProjections(catalog, usedEffectKinds, valueAuthority) {
  const deployed = authority(valueAuthority);
  if (!isProgramRoleCatalog(catalog)) fail('Approval template projections require a normalized role catalog');
  if (!Array.isArray(usedEffectKinds)
    || usedEffectKinds.some((kind) => typeof kind !== 'string' || !EFFECT_KINDS.includes(kind))) {
    fail('usedEffectKinds must be an array of the seven effect kinds');
  }
  const roles = catalog.roles.map((role) => role.role);
  const effectKinds = [...new Set(usedEffectKinds)].sort(compareProgramIdentityKeys);
  const scopes = new Set();
  for (const role of catalog.roles) {
    if (role.templateBinding.kind !== 'inline') continue;
    for (const scope of role.templateBinding.nodeTemplate.pathScope) scopes.add(scope);
    for (const scope of role.templateBinding.nodeTemplate.contextScope) scopes.add(scope);
  }
  const repositoryScopes = [...scopes].sort(compareProgramIdentityKeys);
  const routeConstraintDigest = constraintDigest('baton.route_constraint',
    catalog.roles.map((role) => ({ role: role.role, routeRequest: role.routeRequest })), deployed);
  const serviceTierConstraintDigest = constraintDigest('baton.service_tier_constraint',
    catalog.roles.map((role) => ({ role: role.role, serviceTierRequest: role.serviceTierRequest })),
    deployed);
  const workerPolicyConstraintDigest = constraintDigest('baton.worker_policy_constraint',
    catalog.roles.map((role) => ({
      role: role.role,
      workerPolicyRequest: role.workerPolicyRequest,
      workerPolicyRequestDigest: role.workerPolicyRequestDigest,
    })), deployed);
  return {
    roles, effectKinds, repositoryScopes,
    routeConstraintDigest, serviceTierConstraintDigest, workerPolicyConstraintDigest,
  };
}

export function normalizeApprovalTemplate(value, {
  authority: valueAuthority, policy, catalog, usedEffectKinds,
} = {}) {
  const deployed = authority(valueAuthority);
  if (!isProgramPolicy(policy)) {
    fail('Approval template validation requires a normalized ProgramPolicy', 'program_policy_invalid');
  }
  if (!isProgramRoleCatalog(catalog)) {
    fail('Approval template validation requires a normalized role catalog', 'program_policy_invalid');
  }
  const computed = approvalTemplateProjections(catalog, usedEffectKinds, deployed);
  const normalized = normalizeCanonicalProgramValue(value, deployed);
  exactFields(normalized, [
    'schemaVersion', 'kind', 'roles', 'effectKinds', 'repositoryScopes',
    'routeConstraintDigest', 'serviceTierConstraintDigest', 'workerPolicyConstraintDigest',
    'repeatBoundName', 'childBoundName', 'effectBoundName', 'templateDigest',
  ], 'Approval template');
  if (normalized.schemaVersion !== 1) fail('Approval template schemaVersion must be 1');
  if (normalized.kind !== 'baton.program_approval_template') fail('Approval template kind is invalid');
  if (!Array.isArray(normalized.roles) || normalized.roles.length < 1
    || normalized.roles.length > policy.maxProgramNodes) {
    fail('Approval template roles must contain 1..maxProgramNodes entries');
  }
  const roles = normalized.roles.map((role, index) => safeId(role, `Approval template roles[${index}]`));
  if (new Set(roles).size !== roles.length) fail('Approval template roles contains duplicates');
  if (!Array.isArray(normalized.effectKinds) || normalized.effectKinds.length > EFFECT_KINDS.length
    || normalized.effectKinds.some((kind) => typeof kind !== 'string' || !EFFECT_KINDS.includes(kind))) {
    fail('Approval template effectKinds must be a subset of the seven effect kinds');
  }
  if (new Set(normalized.effectKinds).size !== normalized.effectKinds.length) {
    fail('Approval template effectKinds contains duplicates');
  }
  const repositoryScopes = normalizePathArray(normalized.repositoryScopes,
    'Approval template repositoryScopes', { min: 0, max: policy.maxEvidenceRefs });
  const routeConstraintDigest = digestValue(normalized.routeConstraintDigest,
    'Approval template routeConstraintDigest');
  const serviceTierConstraintDigest = digestValue(normalized.serviceTierConstraintDigest,
    'Approval template serviceTierConstraintDigest');
  const workerPolicyConstraintDigest = digestValue(normalized.workerPolicyConstraintDigest,
    'Approval template workerPolicyConstraintDigest');
  if (normalized.repeatBoundName !== 'program_repeat_rounds') {
    fail('Approval template repeatBoundName must be "program_repeat_rounds"');
  }
  if (normalized.childBoundName !== 'program_child_depth') {
    fail('Approval template childBoundName must be "program_child_depth"');
  }
  if (normalized.effectBoundName !== 'program_effect_instances') {
    fail('Approval template effectBoundName must be "program_effect_instances"');
  }
  const templateDigest = digestValue(normalized.templateDigest, 'Approval template templateDigest');
  if (roles.length !== computed.roles.length
    || roles.some((role, index) => role !== computed.roles[index])) {
    fail('Approval template roles must equal the sorted normalized-catalog role names');
  }
  const effectKinds = [...normalized.effectKinds];
  if (effectKinds.length !== computed.effectKinds.length
    || effectKinds.some((kind, index) => kind !== computed.effectKinds[index])) {
    fail('Approval template effectKinds must equal the statically present effect kinds');
  }
  if (repositoryScopes.length !== computed.repositoryScopes.length
    || repositoryScopes.some((scope, index) => scope !== computed.repositoryScopes[index])) {
    fail('Approval template repositoryScopes must equal the catalog template scope union');
  }
  if (routeConstraintDigest !== computed.routeConstraintDigest) {
    fail('Approval template routeConstraintDigest does not match its catalog projection');
  }
  if (serviceTierConstraintDigest !== computed.serviceTierConstraintDigest) {
    fail('Approval template serviceTierConstraintDigest does not match its catalog projection');
  }
  if (workerPolicyConstraintDigest !== computed.workerPolicyConstraintDigest) {
    fail('Approval template workerPolicyConstraintDigest does not match its catalog projection');
  }
  const template = {
    schemaVersion: 1, kind: 'baton.program_approval_template',
    roles, effectKinds, repositoryScopes,
    routeConstraintDigest, serviceTierConstraintDigest, workerPolicyConstraintDigest,
    repeatBoundName: 'program_repeat_rounds', childBoundName: 'program_child_depth',
    effectBoundName: 'program_effect_instances', templateDigest,
  };
  const { templateDigest: _omitted, ...sansDigest } = template;
  if (templateDigest !== canonicalProgramDigest(sansDigest, deployed)) {
    fail('Approval template templateDigest does not match its canonical bytes');
  }
  return deepFreezeProgramValue(template);
}

// Test/builder convenience: computes every projection from the normalized catalog and the
// caller-supplied usedEffectKinds, then runs the full normalizer.
export function createApprovalTemplate({
  catalog, usedEffectKinds = [], authority: valueAuthority, policy,
} = {}) {
  const deployed = authority(valueAuthority);
  if (!isProgramPolicy(policy)) {
    fail('Approval template creation requires a normalized ProgramPolicy', 'program_policy_invalid');
  }
  const computed = approvalTemplateProjections(catalog, usedEffectKinds, deployed);
  const sansDigest = {
    schemaVersion: 1, kind: 'baton.program_approval_template',
    roles: computed.roles,
    effectKinds: computed.effectKinds,
    repositoryScopes: computed.repositoryScopes,
    routeConstraintDigest: computed.routeConstraintDigest,
    serviceTierConstraintDigest: computed.serviceTierConstraintDigest,
    workerPolicyConstraintDigest: computed.workerPolicyConstraintDigest,
    repeatBoundName: 'program_repeat_rounds',
    childBoundName: 'program_child_depth',
    effectBoundName: 'program_effect_instances',
  };
  return normalizeApprovalTemplate(
    { ...sansDigest, templateDigest: canonicalProgramDigest(sansDigest, deployed) },
    { authority: deployed, policy, catalog, usedEffectKinds });
}
