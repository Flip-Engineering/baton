// application-admission.mjs — issue #259 slice 16: the application's admission bucket.
//
// The 36 admission members of BatonApplication — the authority-op guards, the route and policy
// admission, the wave/message/scratchpad/board/knowledge argument normalizers — move here
// verbatim under the bare `application` receiver, exactly as slice 15 moved the observation
// bucket. No port: the members reach the driver's faces through the receiver, and refusals
// throw through the same applicationError spelling.
//
// Helper reads resolve to their slice-15 homes: the module-scope declarations slice 15 kept in
// application.mjs and that the admission bodies read relocate here in source order; the slice-15
// exports the bodies share import from application-observation.mjs (one-way: admission reads the
// observation helpers, never the reverse); the remaining shared bindings re-import from their
// original modules. The host imports back exactly the helpers its staying code still reads and
// re-exports the ones its CLI/MCP/Web consumers import from it. This module imports neither
// application.mjs nor coordinator.mjs.
//
// Moved verbatim from application.mjs: same names, same parameter lists, same arities; the class
// keeps same-name delegates, so the command dispatch table and every caller are untouched.
import { contextEffectNodeBinding } from './context-call.mjs';
import { FRAME_LIMITS } from './limits.mjs';
import { normalizeWorkflowRevision } from './workflow-revision.mjs';
import { isPhysicalWorkspaceId } from './shared-workspace-custody.mjs';
import { createHash } from 'node:crypto';
import { APPLICATION_WORKFLOW_RECORD_KIND, EPISODE_TOPICS, MAX_RUN_VIEW_BYTES, SECRET_SHAPED_TEXT, applicationError, clone, deepFreeze, digest, exactObject, normalizeCommandContext, normalizePrincipal, normalizeRoute, runViewNarrowedRead, safeScopePath, scopeEntryWithin, validId, validText, workflowDefinitionPolicy, workflowEligibilityProjection, workflowRevisionBudget } from './application-observation.mjs';

export const MAX_REVIEW_SOURCE_BYTES = FRAME_LIMITS['view.review_source.bytes'].value;
const RESULT_INTENTS = Object.freeze(new Set(['change', 'read_only_evidence']));
// Issue #31 §2.2(4): the closed set of run drivers. Only the wave path exists today — an
// MCP/embedded explicit registration channel is a named future extension, not built here.
const DRIVER_KINDS = Object.freeze(new Set(['wave']));
export function contentDigest(value) {
  return createHash('sha256').update(value).digest('hex');
}
function normalizeRouteSelector(value) {
  if (value === undefined) return null;
  const allowed = new Set(['harness', 'model', 'effort']);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length === 0 || Object.keys(value).some((key) => !allowed.has(key))
    || Object.values(value).some((item) => !validText(item, 256))
    || value.model === undefined || value.effort === undefined) {
    throw applicationError('route selector is invalid', 'application_route_invalid');
  }
  return deepFreeze(clone(value));
}
export function normalizeIntent(value) {
  const allowed = new Set([
    // Issue #31 §2.2(4): `driverKind` declares WHO is driving a run. The dispatcher validates
    // `run.start` args through this same function before the handler runs, and start() derives
    // its working intent by calling it again — so without the key here, any caller passing
    // driverKind is refused `application_intent_invalid` before the handler body is reached.
    'runId', 'objective', 'resultIntent', 'profile', 'route', 'scope', 'composition', 'driverKind',
    // 93B: `waveId`/`waveRole` bind this run to a wave, carried into steering.registered so a
    // driver dying mid-loop leaves already-started members discoverable; `waveStart` (roster +
    // idempotencyKey) rides only the first member's run.start and mints the pre-loop wave.started
    // record. None of these describe what the run IS — same non-identity treatment as driverKind.
    'waveId', 'waveRole', 'waveStart',
  ]);
  const hasResultIntent = Object.hasOwn(value ?? {}, 'resultIntent');
  const hasDriverKind = Object.hasOwn(value ?? {}, 'driverKind');
  const hasWaveId = Object.hasOwn(value ?? {}, 'waveId');
  const hasWaveRole = Object.hasOwn(value ?? {}, 'waveRole');
  const hasWaveStart = Object.hasOwn(value ?? {}, 'waveStart');
  const waveStart = value?.waveStart;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.has(key))
    || !Object.hasOwn(value, 'objective')
    || (hasResultIntent && !RESULT_INTENTS.has(value.resultIntent))
    // Server-side revalidation of the closed literal set, mirroring RESULT_INTENTS exactly —
    // defense in depth behind the client-layer whitelist, the same two-tier shape resultIntent
    // already uses.
    || (hasDriverKind && !DRIVER_KINDS.has(value.driverKind))
    || (hasWaveId && !validId(value.waveId))
    || (hasWaveRole && !validId(value.waveRole))
    || (hasWaveStart && (!waveStart || typeof waveStart !== 'object' || Array.isArray(waveStart)
      // D2.2 (epic #132): the closed key set is deploymentId,idempotencyKey,roster for the
      // direct-port wave.start; the facade runs.start (wave.mjs:205) still carries the legacy
      // idempotencyKey,roster pair — both are accepted so the pre-loop mint dedups either way.
      || !['deploymentId,idempotencyKey,roster', 'idempotencyKey,roster'].includes(Object.keys(waveStart).sort().join(','))
      || !validId(waveStart.idempotencyKey)
      || !Array.isArray(waveStart.roster) || waveStart.roster.length === 0 || waveStart.roster.length > 64
      || !waveStart.roster.every((member) => (
        // B2 legacy shape: a string-array roster stays a raw role string in the projection.
        (typeof member === 'string' && validId(member))
        // D2.2 NEW shape: each member carries {role, route: {effort, harness, model}, scope}.
        || (member !== null && typeof member === 'object' && !Array.isArray(member)
          && validId(member.role)
          && member.route !== null && typeof member.route === 'object' && !Array.isArray(member.route)
          && (member.scope === undefined
            || (Array.isArray(member.scope) && member.scope.length > 0 && member.scope.length <= 64
              && member.scope.every((item) => validText(item))
              && new Set(member.scope).size === member.scope.length)))
      ))))
    || (value.runId !== undefined && !validId(value.runId))
    // Decision 2: the objective is SHAPE-checked here (non-empty string, no NUL) — the byte law
    // and the spill economy live at the run.start ADMISSION seam (oversize admits with spill up
    // to the spill.body ceiling, then the typed coaching refusal), never a shape-factory wall.
    || typeof value.objective !== 'string' || value.objective.length === 0 || value.objective.includes('\0')
    || (value.profile !== undefined && !validId(value.profile))
    || (value.scope !== undefined && (!Array.isArray(value.scope) || value.scope.length === 0 || value.scope.length > 64
      || value.scope.some((item) => !validText(item)) || new Set(value.scope).size !== value.scope.length))) {
    throw applicationError('run intent is invalid', 'application_intent_invalid');
  }
  return deepFreeze({
    runId: value.runId ?? null,
    objective: value.objective.normalize('NFKC').trim(),
    ...(hasResultIntent ? { resultIntent: value.resultIntent } : {}),
    // Deliberately NOT folded into intentDigest or runId derivation: driverKind describes who is
    // driving a run, not what the run is. Two calls with identical objective/profile/route/scope
    // must resolve to the SAME run whether or not a wave happens to be the caller. Same rationale
    // for waveId/waveRole/waveStart below.
    ...(hasDriverKind ? { driverKind: value.driverKind } : {}),
    ...(hasWaveId ? { waveId: value.waveId } : {}),
    ...(hasWaveRole ? { waveRole: value.waveRole } : {}),
    ...(hasWaveStart ? { waveStart: {
      deploymentId: waveStart.deploymentId,
      idempotencyKey: waveStart.idempotencyKey,
      roster: [...waveStart.roster],
    } } : {}),
    profile: value.profile ?? null,
    route: normalizeRouteSelector(value.route),
    scope: value.scope === undefined ? null : [...value.scope].sort(),
    composition: value.composition === undefined ? null : normalizeWorkflowComposition(value.composition),
  });
}
function normalizeWorkflowComposition(value) {
  exactObject(value, ['strategy', 'workspace', 'join', 'team'],
    'application_workflow_invalid', 'workflow composition');
  if (value.strategy !== 'parallel_attempts' || value.workspace !== 'isolated'
    || value.join !== 'operator_selected' || !Array.isArray(value.team)
    || value.team.length < 2 || value.team.length > 16) {
    throw applicationError('workflow composition is outside the supported authority',
      'application_workflow_invalid');
  }
  const team = value.team.map((member) => {
    exactObject(member, ['role', 'route'], 'application_workflow_invalid', 'workflow team member');
    if (!validId(member.role)) {
      throw applicationError('workflow role is invalid', 'application_workflow_invalid');
    }
    return { role: member.role, route: clone(normalizeRoute(member.route, 'application_workflow_invalid')) };
  }).sort((left, right) => (left.role < right.role ? -1 : left.role > right.role ? 1 : 0));
  if (new Set(team.map(({ role }) => role)).size !== team.length) {
    throw applicationError('workflow roles contain duplicates', 'application_workflow_invalid');
  }
  return deepFreeze({
    strategy: 'parallel_attempts', workspace: 'isolated', join: 'operator_selected', team,
  });
}
export function workflowFeedbackBodySetDigest(packets) {
  return digest(packets.map((packet) => digest(packet.feedback)).sort());
}
export function routeEqual(a, b) {
  return a.harness === b.harness && a.model === b.model && a.effort === b.effort;
}
// Issue #335: the route grammar the `application_route_not_allowed` teaching names. A model
// selector is `[provider/]model` per harness — a bare model for most harnesses (muse serves
// `muse-spark-1.3-contributor`), `provider/model` where the route id is one (omp serves
// `deepseek/deepseek-flash`) — while the exact tuple is `HARNESS/MODEL@EFFORT`.
const ROUTE_TEACHING_GRAMMAR = 'select model as [provider/]model with effort'
  + ' (a bare model for most harnesses, provider/model for omp),'
  + ' or the exact route as HARNESS/MODEL@EFFORT';
// The requested selector as typed: the exact string form for a full tuple, the raw selector
// object for a partial one.
function formatRequestedRoute(requested) {
  if (requested && typeof requested === 'object' && !Array.isArray(requested)
    && typeof requested.harness === 'string'
    && typeof requested.model === 'string'
    && typeof requested.effort === 'string') {
    return `${requested.harness}/${requested.model}@${requested.effort}`;
  }
  return JSON.stringify(requested ?? null);
}
// One served row of the teaching detail, projected from a readiness row (the same rows doctor
// prints) — never a hand-kept list. A raw-application row carries no refusal code; the
// deployment facade's rows do.
function projectRouteTeachingRow(row) {
  return {
    harness: row.harness, model: row.model, effort: row.effort,
    state: row.state, code: row.code ?? null,
  };
}
function compareRouteTeachingRow(left, right) {
  if (left.harness !== right.harness) return left.harness < right.harness ? -1 : 1;
  if (left.model !== right.model) return left.model < right.model ? -1 : 1;
  if (left.effort !== right.effort) return left.effort < right.effort ? -1 : 1;
  return 0;
}
// Issue #335: the ONE teaching every `application_route_not_allowed` site composes — the
// requested selector as typed, the selector grammar, and the served routes of the requested
// harness with their readiness state, all read off the deployment's own readiness rows (the
// same rows doctor prints, passed in by the caller from `doctorReadiness()`). The CLI
// pre-check teaches before sending, but the swarm_recruit_follow path and every non-CLI
// caller (MCP bridge, swarm client, web) bypass it, so this refusal is their only teaching.
// The code stays `application_route_not_allowed`; a full tuple judges `options.exact`, a
// partial selector judges `route`.
export function routeNotAllowedRefusal(readinessRoutes, requested, { profileName, role = null } = {}) {
  const rows = Array.isArray(readinessRoutes) ? readinessRoutes : [];
  const seen = new Set();
  const served = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const key = `${row.harness}\0${row.model}\0${row.effort}`;
    if (seen.has(key)) continue;
    seen.add(key);
    served.push(projectRouteTeachingRow(row));
  }
  served.sort(compareRouteTeachingRow);
  const requestedHarness = requested && typeof requested === 'object' && !Array.isArray(requested)
    ? requested.harness ?? null : null;
  const field = typeof requestedHarness === 'string' ? 'options.exact' : 'route';
  const subject = role === null ? 'requested route' : `workflow role ${role} route`;
  const rendered = formatRequestedRoute(requested);
  const scope = `the deployment profile '${profileName}'`;
  let message;
  let servedHarnesses = null;
  if (typeof requestedHarness === 'string') {
    const harnessRows = served.filter((row) => row.harness === requestedHarness);
    if (harnessRows.length === 0) {
      servedHarnesses = [...new Set(served.map((row) => row.harness))].sort();
      message = `${subject} ${rendered} is outside ${scope};`
        + ` harness '${requestedHarness}' serves no routes.`
        + ` ${ROUTE_TEACHING_GRAMMAR}.`
        + ` Served harnesses: ${servedHarnesses.join(', ') || 'none'}`;
    } else {
      message = `${subject} ${rendered} is outside ${scope};`
        + ` ${ROUTE_TEACHING_GRAMMAR}.`
        + ` Served ${requestedHarness} routes: ${harnessRows
          .map((row) => `${row.harness}/${row.model}@${row.effort} (${row.state})`).join(', ')}`;
    }
    served.length = 0;
    served.push(...harnessRows);
  } else {
    message = `${subject} selector ${rendered} matches no route in ${scope};`
      + ` ${ROUTE_TEACHING_GRAMMAR}.`
      + ` Served routes: ${served
        .map((row) => `${row.harness}/${row.model}@${row.effort} (${row.state})`).join(', ') || 'none'}`;
  }
  return applicationError(message, 'application_route_not_allowed', {
    field,
    requested: clone(requested ?? null),
    grammar: ROUTE_TEACHING_GRAMMAR,
    served,
    ...(servedHarnesses === null ? {} : { servedHarnesses }),
  });
}
export function explicitResultIntentIdentity(intent) {
  return Object.hasOwn(intent, 'resultIntent') ? { resultIntent: intent.resultIntent } : {};
}
export function semanticSourceSlice(text, source) {
  const fields = ['path', 'startLine', 'startColumn', 'endLine', 'endColumn', 'contentDigest'];
  exactObject(source, fields, 'application_review_report_invalid', 'semantic finding source');
  if (!safeScopePath(source.path) || !/^[a-f0-9]{64}$/u.test(source.contentDigest ?? '')
    || ![source.startLine, source.startColumn, source.endLine, source.endColumn]
      .every((value) => Number.isSafeInteger(value) && value > 0)
    || source.endLine < source.startLine
    || (source.endLine === source.startLine && source.endColumn < source.startColumn)) {
    throw applicationError('semantic finding source range is invalid', 'application_review_report_invalid');
  }
  const lines = text.split('\n');
  if (source.startLine > lines.length || source.endLine > lines.length) {
    throw applicationError('semantic finding source range is stale', 'application_review_anchor_stale');
  }
  const selected = [];
  for (let lineNumber = source.startLine; lineNumber <= source.endLine; lineNumber += 1) {
    const points = Array.from(lines[lineNumber - 1]);
    const start = lineNumber === source.startLine ? source.startColumn - 1 : 0;
    const end = lineNumber === source.endLine ? source.endColumn - 1 : points.length;
    if (start > points.length || end > points.length || end < start) {
      throw applicationError('semantic finding source columns are stale', 'application_review_anchor_stale');
    }
    selected.push(points.slice(start, end).join(''));
  }
  return selected.join('\n');
}

export function _resolveSemanticControlTarget(application, current, recipient, operation) {
    const targets = application._semanticControlTargets(current);
    const eligible = operation === 'interrupt'
      ? targets.rows.filter((row) => ['working', 'blocked'].includes(row.worker.status)
        && row.worker.sessionPreservationCapable === true)
      : targets.rows;
    const row = recipient === 'work'
      ? (operation === 'interrupt' ? targets.interruptWork : targets.sendWork)
      : eligible.find((candidate) => candidate.role === recipient);
    if (!row) {
      throw applicationError(
        recipient === 'work' && eligible.length > 1
          ? 'Run work recipient is ambiguous; select an advertised workflow role'
          : 'Run control recipient is unavailable',
        recipient === 'work' && eligible.length > 1
          ? 'application_control_recipient_ambiguous'
          : 'application_control_recipient_unavailable',
      );
    }
    return {
      workerId: row.worker.id,
      taskId: row.task.id,
      fence: row.worker.fence,
      role: row.role,
      activeCount: targets.rows.length,
      turnEpoch: row.worker.turnEpoch,
      turnState: row.worker.status,
      sessionDigest: row.worker.semanticControlBinding?.sessionDigest ?? null,
      preservationReceiptDigest: row.worker.status === 'interrupted'
        ? row.worker.sessionPreservation?.receiptDigest ?? null : null,
      processGeneration: row.worker.semanticControlBinding?.processGeneration ?? 0,
      worktreeDigest: row.worker.semanticControlBinding?.worktreeDigest ?? digest(null),
      routeDigest: row.worker.semanticControlBinding?.routeDigest ?? digest(null),
      planBindingDigest: row.worker.semanticControlBinding?.planBindingDigest ?? digest(null),
      runAuthorityDigest: row.worker.semanticControlBinding?.runAuthorityDigest ?? digest(null),
    };
  }
export function _normalizeRunControlOutcome(application, outcome, schemaVersion = 2) {
    const base = {
      result: validText(outcome?.result, 256) ? outcome.result : 'provider_outcome_unknown',
      code: validText(outcome?.code, 256) ? outcome.code : null,
      emulated: outcome?.emulated === true,
      deliveredDespiteStale: outcome?.deliveredDespiteStale === true,
    };
    if (schemaVersion < 2) return base;
    return {
      ...base,
      actualDelivery: ['nudge', 'now', 'turn'].includes(outcome?.actualDelivery)
        ? outcome.actualDelivery : null,
      preservation: outcome?.preservation ? clone(outcome.preservation) : null,
      continuation: outcome?.continuation ? clone(outcome.continuation) : null,
    };
  }
export function _resolveIntent(application, rawIntent) {
    const requested = normalizeIntent(rawIntent);
    const profileName = requested.profile ?? application.defaults.profile;
    if (profileName === null) {
      throw applicationError('Run profile is ambiguous; inspect deployment defaults', 'application_profile_ambiguous');
    }
    const profile = application._profile(profileName);
    const selector = requested.route;
    let selectedRoute = null;
    if (selector === null) {
      if (requested.composition) selectedRoute = requested.composition.team[0].route;
      else if (profile.routes.length === 1) selectedRoute = profile.routes[0];
      if (selectedRoute === null) {
        throw applicationError('Run route is ambiguous; select model and effort or inspect advanced routing help', 'application_route_ambiguous');
      }
    } else {
      const matches = profile.routes.filter((candidate) => Object.entries(selector)
        .every(([axis, value]) => candidate[axis] === value));
      if (matches.length === 0) {
        throw routeNotAllowedRefusal(application.doctorReadiness().routes, selector, { profileName });
      }
      if (matches.length === 1) selectedRoute = matches[0];
      else {
        throw applicationError('Run route selector is ambiguous; inspect advanced routing help', 'application_route_ambiguous');
      }
    }
    let composition = requested.composition;
    if (composition) {
      for (const member of composition.team) {
        if (!profile.routes.some((candidate) => routeEqual(candidate, member.route))) {
          throw routeNotAllowedRefusal(application.doctorReadiness().routes, member.route, { profileName, role: member.role });
        }
      }
      composition = deepFreeze(clone(composition));
      selectedRoute = composition.team[0].route;
    }
    return deepFreeze({
      ...requested, profile: profileName, route: clone(selectedRoute), composition,
    });
  }
/** Admit one deliberate shared-checkout attachment for a recruited Run, or refuse its shape.
   * The attachment is a live observation the swarm already resolved (which checkout, whose native
   * session handed it over, and how many holders were in it) — never caller-supplied coordinates. */
export function _admitWorkspaceAttachment(application, runId, workspace) {
    const fields = ['holderCount', 'sessionContext', 'workspaceId'];
    if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)
      || Object.keys(workspace).sort().join(',') !== fields.sort().join(',')
      || !isPhysicalWorkspaceId(workspace.workspaceId ?? '')
      || !workspace.sessionContext || typeof workspace.sessionContext !== 'object'
      || Array.isArray(workspace.sessionContext)
      || workspace.sessionContext.ownerTaskId !== workspace.workspaceId) {
      throw applicationError('shared workspace attachment is invalid', 'application_workspace_attachment_invalid');
    }
    if (application._workspaceAttachments.has(runId)) {
      throw applicationError('this Run already has a shared workspace attachment', 'application_workspace_attachment_conflict');
    }
    application._workspaceAttachments.set(runId, Object.freeze({
      workspaceId: workspace.workspaceId, context: workspace.sessionContext,
    }));
  }
/** Decision 4 item 4: resolve a spilled objective's citation to the full body at the reader
   * projection seam — a routine reader never sees the citation. The goal record stores a bounded
   * head + `[SPILLED {...}]` citation; this resolves it via the durable spill artifact. */
export function _resolveSpillObjective(application, objective) {
    if (typeof objective !== 'string') return objective;
    const marker = '\n[SPILLED ';
    const start = objective.lastIndexOf(marker);
    if (start === -1) return objective;
    const end = objective.indexOf(']', start + marker.length);
    if (end === -1) return objective;
    try {
      const citation = JSON.parse(objective.slice(start + marker.length, end));
      if (citation && typeof citation.spill === 'string' && citation.spill.startsWith('spill:sha256:')
        && typeof application.driver.coordination.materializeSpill === 'function') {
        const served = application.driver.coordination.materializeSpill(citation.spill);
        if (served && typeof served.body === 'string') return served.body;
      }
    } catch { /* malformed citation — leave the objective as stored */ }
    return objective;
  }
export function _isWorkflowRun(application, current) {
    if (!current.plan) return false;
    if (current.plan.nodes.length === 1 && current.plan.nodes[0]?.revision) return true;
    // Plan cardinality is not Workflow authority: later reduce/retry generations may have one
    // node, while ordinary recovery/refinement Plans may have several. The application-owned,
    // content-addressed definition event is the authority.
    if (typeof application.driver.coordination.events !== 'function') return false;
    return application.driver.coordination.eventsView().some((event) => (
      event.kind === 'driver.recorded'
      && event.payload?.kind === APPLICATION_WORKFLOW_RECORD_KIND
      && event.payload?.repoId === application.repoId
      && event.payload?.runId === current.goal.runId
      && event.payload?.planDigest === current.plan.digest
    ));
  }
export function resolveCompletedResultExport(application, coordinates) {
    return application._completedResultExport(coordinates)?.receipt ?? null;
  }
export function _validateSemanticEvidence(application, ref, target) {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref) || !validText(ref.kind, 64)) {
      throw applicationError('semantic finding evidence is invalid', 'application_review_evidence_invalid');
    }
    if (ref.kind === 'artifact') {
      exactObject(ref, ['kind', 'id', 'digest'], 'application_review_evidence_invalid', 'semantic artifact evidence');
      if (!validText(ref.id, 4_096) || !/^[a-f0-9]{64}$/u.test(ref.digest ?? '')) {
        throw applicationError('semantic artifact evidence is invalid', 'application_review_evidence_invalid');
      }
      const artifact = application.driver.coordination.artifact(ref.id);
      if (!artifact || artifact.digest !== ref.digest || artifact.accepted !== true
        || artifact.supersededBy !== null || Object.hasOwn(artifact, 'acceptanceInvalidation')
        || (artifact.taskId && artifact.taskId !== target.taskId)) {
        throw applicationError('semantic artifact evidence is stale or substituted', 'application_review_evidence_stale');
      }
      return clone(ref);
    }
    if (ref.kind === 'representation') {
      exactObject(ref, ['kind', 'identityDigest', 'graphDigest'], 'application_review_evidence_invalid', 'semantic Representation evidence');
      if (!/^[a-f0-9]{64}$/u.test(ref.identityDigest ?? '') || !/^[a-f0-9]{64}$/u.test(ref.graphDigest ?? '')) {
        throw applicationError('semantic Representation evidence is invalid', 'application_review_evidence_invalid');
      }
      const representation = application.driver.coordination.representationProduction?.(ref.identityDigest);
      if (!representation || representation.graphDigest !== ref.graphDigest
        || representation.identity?.repoId !== application.repoId || representation.identity?.runId !== target.runId
        || representation.identity?.environment?.treeSha !== target.resultSha) {
        throw applicationError('semantic Representation evidence is stale or substituted', 'application_review_evidence_stale');
      }
      return clone(ref);
    }
    throw applicationError('semantic finding evidence kind is unsupported', 'application_review_evidence_invalid');
  }
export function _parseSemanticReview(application, inspection, current, target) {
    let report;
    try { report = JSON.parse(inspection.report.text); }
    catch { throw applicationError('semantic review report is not valid JSON', 'application_review_report_invalid'); }
    exactObject(report, ['schemaVersion', 'targetDigest', 'verdict', 'summary', 'findings'], 'application_review_report_invalid', 'semantic review report');
    const policy = current.profile.reviewPolicy;
    if (report.schemaVersion !== 1 || report.targetDigest !== target.targetDigest
      || !['approved', 'revision_required', 'unverifiable'].includes(report.verdict)
      || !validText(report.summary, 8_192) || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(report.summary))
      || !Array.isArray(report.findings) || report.findings.length > policy.maxFindings) {
      throw applicationError('semantic review report is invalid or targets different work', 'application_review_report_invalid');
    }
    const findingIds = new Set();
    const findings = report.findings.map((finding) => {
      exactObject(finding, ['id', 'severity', 'disposition', 'claim', 'source', 'evidence', 'requiredCorrection'], 'application_review_report_invalid', 'semantic finding');
      if (!validId(finding.id) || findingIds.has(finding.id) || !['P0', 'P1', 'P2', 'P3'].includes(finding.severity)
        || !['confirmed', 'contradicted', 'unverifiable'].includes(finding.disposition)
        || !validText(finding.claim, 8_192) || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(finding.claim))
        || !Array.isArray(finding.evidence) || finding.evidence.length === 0 || finding.evidence.length > 64
        || (finding.disposition === 'confirmed'
          ? !validText(finding.requiredCorrection, 8_192)
          : finding.requiredCorrection !== null)
        || (typeof finding.requiredCorrection === 'string'
          && SECRET_SHAPED_TEXT.some((pattern) => pattern.test(finding.requiredCorrection)))) {
        throw applicationError('semantic finding is invalid', 'application_review_report_invalid');
      }
      findingIds.add(finding.id);
      if (!current.profile.pathScope.some((allowed) => scopeEntryWithin(finding.source?.path, allowed))) {
        throw applicationError('semantic finding source is outside approved scope', 'application_review_scope_violation');
      }
      let source;
      try {
        source = application.driver.coordinator.inspectCapturedFile(
          inspection.parentWorkerId, target.resultSha, finding.source.path, MAX_REVIEW_SOURCE_BYTES,
        );
      } catch (cause) {
        throw Object.assign(applicationError('semantic finding source is unavailable', 'application_review_anchor_stale'), { cause });
      }
      const excerpt = semanticSourceSlice(source.text, finding.source);
      if (contentDigest(excerpt) !== finding.source.contentDigest) {
        throw applicationError('semantic finding source digest is stale', 'application_review_anchor_stale');
      }
      const evidence = finding.evidence.map((ref) => application._validateSemanticEvidence(ref, target));
      return deepFreeze({ ...clone(finding), evidence, excerptDigest: contentDigest(excerpt) });
    });
    const derivedVerdict = findings.some((finding) => finding.disposition === 'unverifiable') ? 'unverifiable'
      : findings.some((finding) => finding.disposition === 'confirmed') ? 'revision_required' : 'approved';
    if (report.verdict !== derivedVerdict) {
      throw applicationError('semantic review verdict disagrees with its findings', 'application_review_verdict_inconsistent');
    }
    const state = derivedVerdict === 'approved' ? 'semantic_reviewed'
      : derivedVerdict === 'revision_required' ? 'revision_required' : 'review_failed';
    const route = {
      requested: {
        harness: inspection.reviewer.harness,
        model: inspection.reviewer.modelRequested,
        effort: inspection.reviewer.effortRequested,
      },
      resolved: {
        harness: inspection.reviewer.harness,
        model: inspection.reviewer.modelResolved,
        effort: inspection.reviewer.effortResolved,
      },
      observed: inspection.reviewer.modelObserved != null || inspection.reviewer.effortObserved != null ? {
        harness: inspection.reviewer.harness,
        model: inspection.reviewer.modelObserved,
        effort: inspection.reviewer.effortObserved,
      } : null,
    };
    const core = {
      state, verdict: derivedVerdict, summary: report.summary, findings,
      independent: inspection.independent, route,
      workerId: inspection.workerId, taskId: inspection.taskId,
      targetDigest: inspection.targetDigest, report: {
        path: inspection.reportPath, sha: inspection.reportSha,
        digest: contentDigest(inspection.report.text), bytes: inspection.report.bytes,
      },
    };
    return deepFreeze({ ...core, receiptDigest: digest(core) });
  }
export async function _semanticReview(application, current, baseView) {
    const target = application._semanticTarget(current, baseView);
    if (!target || current.profile.reviewPolicy.mode === 'none') return { state: 'semantics_unverified', findings: [] };
    const taskId = application._semanticTaskId(target);
    const task = application.driver.coordination.task(taskId);
    if (!task) return { state: 'semantics_unverified', findings: [], targetDigest: target.targetDigest };
    let handle = application.driver.coordinator.list().find((candidate) => candidate.taskId === taskId);
    if (!handle || task.review?.structured?.targetDigest !== target.targetDigest) {
      return { state: 'review_failed', findings: [], targetDigest: target.targetDigest, error: { code: 'application_review_target_conflict' } };
    }
    if (['pending', 'working', 'verifying'].includes(task.status)
      || ['pending', 'working', 'blocked', 'stopping'].includes(handle.status)) {
      return {
        state: 'review_running', findings: [], targetDigest: target.targetDigest,
        workerId: handle.id, taskId, route: {
          requested: { harness: handle.vendor, model: handle.modelRequested, effort: handle.effortRequested },
          resolved: handle.modelResolved ? { harness: handle.vendor, model: handle.modelResolved, effort: handle.effortResolved } : null,
          observed: handle.modelObserved || handle.effortObserved ? { harness: handle.vendor, model: handle.modelObserved, effort: handle.effortObserved } : null,
        },
      };
    }
    const reviewerReleased = (candidate) => ['dead', 'stopped'].includes(candidate?.status)
      && candidate.worktree === null && candidate.runtimeScope?.active !== true
      && (!candidate.processRef || candidate.processRef.state === 'closed');
    if (!reviewerReleased(handle)) {
      try {
        await application._performSemanticReviewLifecycle(handle.id, target.targetDigest);
      } catch {
        return {
          state: 'review_failed', findings: [], targetDigest: target.targetDigest, workerId: handle.id, taskId,
          error: { code: 'application_review_cleanup_incomplete' },
        };
      }
      handle = application.driver.coordinator.list().find((candidate) => candidate.taskId === taskId);
      if (!reviewerReleased(handle)) {
        return {
          state: 'review_failed', findings: [], targetDigest: target.targetDigest, workerId: handle?.id ?? null, taskId,
          error: { code: 'application_review_cleanup_incomplete' },
        };
      }
    }
    if (task.status !== 'completed') {
      return { state: 'review_failed', findings: [], targetDigest: target.targetDigest, workerId: handle.id, taskId, error: { code: 'application_review_worker_failed' } };
    }
    try {
      const inspection = application.driver.coordinator.inspectStructuredReview(handle.id, target.targetDigest);
      return application._parseSemanticReview(inspection, current, target);
    } catch (error) {
      return {
        state: 'review_failed', findings: [], targetDigest: target.targetDigest, workerId: handle.id, taskId,
        error: { code: error?.code ?? 'application_review_report_invalid' },
      };
    }
  }
export function _assertRunMutable(application, runId) {
    const stop = application.driver.coordination.runStop?.(runId);
    if (stop) {
      const stopped = stop.status === 'stopped';
      throw applicationError(`run ${runId} is ${stopped ? 'stopped' : 'stopping'}`,
        stopped ? 'application_run_stopped' : 'application_run_stopping');
    }
  }
export function _admitRecursiveRun(application, intent, principal, context) {
    const auth = application._recursiveAuth(principal, context, `run.lineage:${intent.runId}`);
    if (!auth) return null;
    if (typeof application.driver.coordination.admitRunLineage !== 'function') {
      throw applicationError('recursive Run lineage authority is unavailable', 'run_orchestrator_lease_not_found');
    }
    const admitted = application.driver.coordination.admitRunLineage({
      schemaVersion: 1,
      repoId: application.repoId,
      childRunId: intent.runId,
      intentDigest: digest({
        objective: intent.objective, profile: intent.profile,
        ...explicitResultIntentIdentity(intent),
        route: intent.route, composition: intent.composition,
        scope: intent.scope, runId: intent.runId,
      }),
    }, auth);
    application._authorizeRecursiveCommand('run.start', intent.runId, principal, context);
    return admitted;
  }
/** Issue #324: run admission consults the deployment's route readiness pre-effect — the
   * single route and every composition team route, through the injected gate, before the
   * first durable effect. A blocked route refuses here, so there is no goal/plan record to
   * approve, no worktree, no capacity reservation, and no worker spawn — with the blocked
   * row (state, code, summary) as the typed refusal. */
export function _assertRouteAdmission(application, intent) {
    if (typeof application.routeAdmission !== 'function') return;
    application.routeAdmission(intent.route);
    if (intent.composition) {
      for (const member of intent.composition.team) {
        application.routeAdmission({ exact: member.route });
      }
    }
  }
/** The ONE oversize refusal (issue #489): the byte count, the section that dominates the view,
   * the sections a narrowed read already shed, and the narrowing that WORKS — never a bare
   * "exceeds deployment policy" and never a remedy the deployment refuses. */
export function _runViewOversizeRefusal(application, runId, view, observed, shed) {
    const measured = Object.entries(view)
      .map(([section, value]) => Object.freeze({
        section, bytes: Buffer.byteLength(JSON.stringify(value ?? null), 'utf8'),
      }))
      .sort((left, right) => (right.bytes - left.bytes) || (left.section < right.section ? -1 : 1));
    const largest = measured[0] ?? Object.freeze({ section: 'view', bytes: observed });
    const error = applicationError(
      `Run view is ${observed} bytes, over the deployment's ${MAX_RUN_VIEW_BYTES}-byte view ceiling;`
      + ` the largest section is ${largest.section} (${largest.bytes} bytes)`
      + (shed.length === 0 ? '' : `, already shed: ${shed.map((row) => row.section).join(', ')}`)
      + ` — narrow the read (${runViewNarrowedRead(runId)}) or raise the deployment ceiling`,
      'application_run_view_oversize',
      { field: 'depth', cap: MAX_RUN_VIEW_BYTES, actual: observed, unit: 'bytes',
        section: largest.section, sectionBytes: largest.bytes,
        ...(shed.length === 0 ? {} : { shed: clone(shed) }),
        gracefulPath: 'depth:outline' },
    );
    error.cap = MAX_RUN_VIEW_BYTES; error.actual = observed; error.unit = 'bytes';
    return error;
  }
export async function _workflowRevisionEligibility(application, current, prepared = {}) {
    const history = application._workflowPlanHistory(current);
    const definition = prepared.definition ?? application._workflowDefinition(current);
    const policy = workflowDefinitionPolicy(definition);
    const projection = prepared.projection
      ?? await application._goalPlanStatus(current, application.principals.observer);
    const candidates = prepared.candidates
      ?? application._workflowCandidates(current, projection, definition);
    const selection = prepared.selection
      ?? application._workflowSelection(current, definition, candidates);
    const feedback = prepared.feedback
      ?? application._workflowFeedback(current, definition, candidates);
    const selected = selection
      ? candidates.find((candidate) => candidate.candidateId === selection.candidate.id) ?? null
      : null;
    const packets = selected ? application._workflowRevisionFeedbackRows(feedback, selected) : [];
    const sourceNode = selected
      ? current.plan.nodes.find((node) => node.key === selected.nodeKey) ?? null : null;
    const budget = workflowRevisionBudget(
      current.profile, history.map((entry) => entry.plan), 1, policy.maxRounds,
    );
    const nextRound = history.length + 1;
    const result = (state, reason) => ({
      state, reason, nextRound, maxRounds: policy.maxRounds,
      policy, budget, history, definition, projection, candidates,
      selection, feedback, selected, packets, sourceNode,
    });
    if (history.length >= policy.maxRounds) return result('blocked', 'round_limit');
    if (!selected || !sourceNode) return result('blocked', 'selection_required');
    if (packets.length === 0) return result('blocked', 'feedback_required');
    const priorFeedbackCount = history.slice(1).reduce((sum, entry) => (
      sum + normalizeWorkflowRevision(entry.plan.nodes[0].revision).feedback.length
    ), 0);
    if (packets.length > policy.maxFeedbackPacketsPerRound
      || priorFeedbackCount + packets.length > policy.maxFeedbackPacketsTotal) {
      return result('blocked', 'feedback_limit');
    }
    const ancestorSelectedShas = new Set(history.slice(1).map((entry) => (
      normalizeWorkflowRevision(entry.plan.nodes[0].revision).parent.resultSha
    )));
    if (ancestorSelectedShas.has(selected.resultSha)) {
      return result('blocked', 'no_verified_progress');
    }
    const feedbackBodyDigest = workflowFeedbackBodySetDigest(packets);
    const priorFeedbackDigests = new Set(history.slice(1).map((entry) => (
      workflowFeedbackBodySetDigest(normalizeWorkflowRevision(
        entry.plan.nodes[0].revision,
      ).feedback)
    )));
    if (priorFeedbackDigests.has(feedbackBodyDigest)) {
      return result('blocked', 'repeated_feedback');
    }
    if (packets.some((packet) => packet.feedback.findings.some((finding) => (
      finding.kind === 'contradiction'
    )))) {
      return result('blocked', 'unresolved_contradiction');
    }
    if (!budget) return result('blocked', 'budget_exhausted');
    return result('eligible', 'ready');
  }
export async function _validateWorkflowRevisionPlan(application, current) {
    const node = current.plan?.nodes[0];
    if (!node?.revision) return null;
    const definition = application._workflowDefinition(current);
    const history = application._workflowPlanHistory(current);
    if (history.length < 2) {
      throw applicationError('Workflow revision history is incomplete',
        'application_workflow_integrity');
    }
    const predecessor = history.at(-2);
    const predecessorDefinition = application._workflowDefinition(predecessor);
    const eligibility = await application._workflowRevisionEligibility(predecessor, {
      definition: predecessorDefinition,
    });
    const { selected, packets } = eligibility;
    const revision = normalizeWorkflowRevision(node.revision);
    const expectedParent = selected ? {
      role: selected.role, nodeKey: selected.nodeKey, taskId: selected.taskId,
      candidateId: selected.candidateId, candidateDigest: selected.candidateDigest,
      resultSha: selected.resultSha, retainedResultRef: selected.retainedResultRef,
      treeIdentityDigest: digest({
        resultSha: selected.resultSha, retainedResultRef: selected.retainedResultRef,
      }),
      changedPaths: clone(selected.changedPaths), changedPathsDigest: digest(selected.changedPaths),
      evidenceDigest: selected.evidenceDigest,
      commitArtifact: clone(selected.evidence.commitArtifact),
      verificationArtifact: clone(selected.evidence.verificationArtifact),
    } : null;
    if (eligibility.state !== 'eligible' || !selected || packets.length === 0 || !eligibility.budget
      || revision.round !== history.length
      || revision.workflow.definitionDigest !== predecessorDefinition.definitionDigest
      || revision.predecessorPlan.planId !== predecessor.plan.planId
      || revision.predecessorPlan.version !== predecessor.plan.version
      || revision.predecessorPlan.digest !== predecessor.plan.digest
      || digest(revision.parent) !== digest(expectedParent)
      || digest(revision.feedback) !== digest(packets)
      || digest(node.budget) !== digest(eligibility.budget)
      || definition.revisionDigest !== revision.revisionDigest
      || definition.workflowPolicyDigest !== eligibility.policy.policyDigest) {
      throw applicationError('Workflow revision Plan failed its immutable Candidate and feedback binding',
        'application_workflow_integrity');
    }
    return deepFreeze({
      predecessor, predecessorDefinition, selected, packets, revision,
      eligibility: workflowEligibilityProjection(eligibility),
    });
  }
export function _validateContextMapPlan(application, current) {
    const bindings = current.plan?.nodes?.map((node) => node.contextCall).filter(Boolean) ?? [];
    if (bindings.length === 0) return null;
    if (bindings.length !== current.plan.nodes.length
      || new Set(bindings.map((binding) => binding.callId)).size !== 1) {
      throw applicationError('Context map Plan bindings are incomplete or ambiguous',
        'application_context_map_integrity');
    }
    const call = application.driver.coordination.contextCall?.(bindings[0].callId);
    if (!call || call.expectedPlanDigest !== current.plan.digest
      || call.source.runId !== current.goal.runId
      || call.source.predecessorPlan.digest !== current.plan.predecessor?.digest
      || call.partitions.length !== bindings.length
      || bindings.some((binding) => (
        binding.callDigest !== call.callDigest
        || !call.partitions.some((partition) => (
          partition.partitionId === binding.partition.partitionId
        ))
      ))) {
      throw applicationError('Context map Plan differs from its durable call admission',
        'application_context_map_integrity');
    }
    return deepFreeze(call);
  }
export function _validateContextEffectPlan(application, current) {
    const bindings = current.plan?.nodes?.map((node) => node.contextCall).filter(Boolean) ?? [];
    if (bindings.length === 0) return null;
    if (bindings.length !== current.plan.nodes.length
      || new Set(bindings.map((binding) => binding.callId)).size !== 1) {
      throw applicationError('Context effect Plan bindings are incomplete or ambiguous',
        'application_context_call_integrity');
    }
    if (bindings[0].kind === 'context_map_child') return application._validateContextMapPlan(current);
    const call = application.driver.coordination.contextCall?.(bindings[0].callId);
    const predecessor = call?.authority?.predecessorPlan;
    const unitIds = new Set(call?.executionUnitIds ?? []);
    const bindingUnitIds = new Set(bindings.map((binding) => binding.unit?.unitId));
    const callCore = call ? {
      schemaVersion: call.schemaVersion, kind: call.kind, operator: call.operator,
      requestId: call.requestId, requestDigest: call.requestDigest,
      generation: call.generation, predecessorCall: clone(call.predecessorCall),
      executionUnitIds: clone(call.executionUnitIds),
      inheritedChildren: clone(call.inheritedChildren), authority: clone(call.authority),
      source: clone(call.source), role: call.role, instruction: call.instruction,
      units: clone(call.units), callId: call.callId, callDigest: call.callDigest,
    } : null;
    if (!call || call.kind !== 'baton.context_effect_call'
      || call.expectedPlanDigest !== current.plan.digest
      || call.authority.contextPrincipal.runId !== current.goal.runId
      || predecessor?.digest !== current.plan.predecessor?.digest
      || bindings.length !== call.executionUnitIds.length
      || bindingUnitIds.size !== bindings.length
      || bindings.some((binding) => (
        binding.kind !== 'context_effect_child'
        || binding.callDigest !== call.callDigest
        || binding.requestId !== call.requestId
        || binding.requestDigest !== call.requestDigest
        || binding.operator !== call.operator
        || !unitIds.has(binding.unit?.unitId)
        || digest(binding) !== digest(contextEffectNodeBinding(
          callCore, call.units.find((unit) => unit.unitId === binding.unit?.unitId),
        ))
      ))) {
      throw applicationError('Context effect Plan differs from its durable call admission',
        'application_context_call_integrity');
    }
    return deepFreeze(call);
  }
export async function _resolveContextEvalRunTarget(application, runId, role) {
    if (!validId(runId)) {
      throw applicationError('Context evaluation Run is invalid', 'application_action_input_invalid');
    }
    const current = application._findRun(runId);
    const view = application._withContextProjection(current, await application._buildView(
      current, application.principals.observer,
    ));
    const targets = application._contextEvalTargets(current, view);
    const selectedRole = targets.length === 1 ? targets[0].role : role;
    const target = targets.find((candidate) => candidate.role === selectedRole);
    if (!target) {
      throw applicationError('Context target is outside current Run authority',
        'application_action_input_invalid');
    }
    return { current, target };
  }
export async function _resolveContextEvalManifestTarget(application, manifestDigest) {
    const sessions = (application.driver.coordination.snapshot().context?.sessions ?? [])
      .filter((session) => session.repoId === application.repoId && session.manifestDigest === manifestDigest);
    if (sessions.length !== 1) {
      throw applicationError('Context manifest is not durably admitted',
        'application_context_eval_manifest_unavailable');
    }
    const [session] = sessions;
    // REPL-1 rule 13a: a REPL manifestDigest resolves to a REPL session with no `workflow`
    // coordinate; refuse with the existing typed code rather than dereferencing `.workflow`.
    if (session.manifest.kind !== 'baton.context_manifest') {
      throw applicationError('Context manifest is not durably admitted',
        'application_context_eval_manifest_unavailable');
    }
    const baseCurrent = application._findRun(session.runId, { allowUnavailableProfile: true });
    const plan = application.driver.coordination.planVersion(
      session.manifest.workflow.plan.planId, session.manifest.workflow.plan.version,
    );
    if (!plan || plan.digest !== session.manifest.workflow.plan.digest) {
      throw applicationError('Context manifest is not durably admitted',
        'application_context_eval_manifest_unavailable');
    }
    const current = application._runAtPlan(baseCurrent, plan);
    const view = application._withContextProjection(current, await application._buildView(
      current, application.principals.observer,
    ));
    const targets = application._contextEvalTargets(current, view);
    const target = targets.find((candidate) => candidate.nodeKey === session.manifest.workflow.node.key);
    if (!target) {
      throw applicationError('Context manifest is not durably admitted',
        'application_context_eval_manifest_unavailable');
    }
    return { current, target };
  }
// REFLEX-3 (docs/32 §3.3, issue #18; contract: docs/reference/evidence/
// reflex-wave-live-2026-07-21/reflex3-packages-decisions.md, Part D / red-team F14): direct
// command ports for context-package admit/attach/branch-resolve, mirroring `contextEval`'s
// "direct command port" transport above — deliberately NOT entries in
// `APPLICATION_COMMAND_DEFINITIONS` for the identical reason documented at that table (:136-147):
// any new key there breaks `card().commands`/MCP-tool-derivation fixtures this task cannot touch.
// Web, MCP, and generic `application.command(...)` string dispatch remain a documented gap.
export async function admitContextPackage(application, rawFields, rawPrincipal, rawContext = null) {
    application._assertOpen();
    await application.ready;
    const context = normalizeCommandContext(rawContext);
    const principal = normalizePrincipal(rawPrincipal, 'context package principal');
    await application._authorize('application.context_package_admit', principal, null, {});
    application._assertOpen();
    const auth = {
      actor: principal.actor,
      key: context?.idempotencyKey ?? `context-package.admit:${digest(rawFields)}`,
    };
    const admitted = application.driver.coordination.admitContextPackage(rawFields, auth);
    return { result: admitted.result, package: clone(admitted.package) };
  }
export function _selectedSemanticItem(application, current, view, section, item, items, episodeContext = null) {
    const selected = items.find((entry) => entry.id === item);
    if (selected || typeof item !== 'string') return selected ?? null;
    if (section === 'workstreams' && item.startsWith('workstream:')) {
      const coordinate = item.slice('workstream:'.length);
      const generationMatch = /:g([1-9][0-9]*)$/u.exec(coordinate);
      const role = generationMatch ? coordinate.slice(0, generationMatch.index) : coordinate;
      return items.filter((entry) => entry.value?.role === role
        && (!generationMatch || entry.value.generation === Number(generationMatch[1])))
        .sort((left, right) => right.value.generation - left.value.generation)[0] ?? null;
    }
    if (section !== 'episode') return null;
    const topic = EPISODE_TOPICS
      .find((candidate) => item === `episode:${candidate}`
        || item.startsWith(`episode:${candidate}:`));
    if (!topic) return null;
    const prefix = `episode:${topic}`;
    const coordinate = item === prefix ? '' : item.slice(prefix.length + 1);
    const generationMatch = /:g([1-9][0-9]*)$/u.exec(coordinate);
    const generation = generationMatch ? Number(generationMatch[1]) : null;
    const role = generationMatch ? coordinate.slice(0, generationMatch.index) : coordinate;
    return application._episodeItem(current, view, topic, role || null, episodeContext, generation);
  }
// #170 (D2/D4): the surface-side compile seam. A DSL text (specDsl inline, or a specPath whose
// content is a wavefile) compiles to the closed IR object waves.run accepts; a JSON spec passes
// through untouched. The only file READ in the DSL pipeline is this explicit specPath load.
export async function _resolveWorkflowSpec(application, request, repoRoot) {
    if (request.spec !== undefined) return request.spec;
    if (request.specDsl !== undefined) {
      const { compileWavefile } = await import('./workflow-dsl.mjs');
      return compileWavefile(String(request.specDsl), { repoRoot });
    }
    if (request.specPath !== undefined) {
      const { readFileSync } = await import('node:fs');
      let text;
      try { text = readFileSync(request.specPath, 'utf8'); }
      catch { throw applicationError('the workflow spec path cannot be read', 'workflow_spec_invalid'); }
      return application._sniffWorkflowText(text, repoRoot);
    }
    return request.spec ?? request.specPath;
  }
// Bounded closed validation for the wave ergonomics direct ports (the MCP schema and the MCP
// validator already reject obvious shape failures; these guards keep the embedded direct ports
// honest under the same closed-shape discipline as the rest of the command table).
export function _normalizeWaveStart(application, value) {
    const allowed = new Set(['idempotencyKey', 'members']);
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some((key) => !allowed.has(key))
      || !validId(value.idempotencyKey) || !Array.isArray(value.members)
      || value.members.length === 0 || value.members.length > 64) {
      throw applicationError('wave start request is invalid', 'application_wave_start_invalid');
    }
    const roles = new Set();
    const members = [];
    for (const member of value.members) {
      // The member objective is SHAPE-checked only (non-empty string): the wave.member.objective
      // byte law admits oversize with spill at run.start (Decision 2 / OQ5) — never a wall in
      // front of a spill lane (v1.2 blue-team blocker 4).
      if (!member || typeof member !== 'object' || Array.isArray(member)
        || Object.keys(member).some((key) => !['role', 'objective', 'exact', 'scope'].includes(key))
        || !validId(member.role)
        || typeof member.objective !== 'string' || member.objective.length === 0 || member.objective.includes('\0')
        || !member.exact || typeof member.exact !== 'object' || Array.isArray(member.exact)
        || !['harness', 'model', 'effort'].every((axis) => validText(member.exact[axis]))
        || (member.scope !== undefined
          && (!Array.isArray(member.scope) || member.scope.length === 0 || member.scope.length > 64
            || member.scope.some((item) => !validText(item))))) {
        throw applicationError('wave start member is invalid', 'application_wave_start_invalid');
      }
      if (roles.has(member.role)) throw applicationError('wave start member roles contain duplicates', 'application_wave_start_invalid');
      roles.add(member.role);
      members.push(deepFreeze({
        role: member.role, objective: member.objective.normalize('NFKC').trim(),
        exact: Object.freeze({ harness: member.exact.harness, model: member.exact.model, effort: member.exact.effort }),
        scope: member.scope === undefined ? null : [...member.scope].sort(),
      }));
    }
    return deepFreeze({ idempotencyKey: value.idempotencyKey, members });
  }
export function _normalizeWaveProgress(application, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some((key) => !['waveId', 'cursor', 'sinceSeq'].includes(key))
      || typeof value.waveId !== 'string' || !/^wave:[a-f0-9]{32}$/u.test(value.waveId)
      || (value.cursor !== undefined && !Number.isSafeInteger(value.cursor))
      || (value.sinceSeq !== undefined && (!Number.isSafeInteger(value.sinceSeq) || value.sinceSeq < 0))) {
      throw applicationError('wave progress request is invalid', 'application_wave_progress_invalid');
    }
    return deepFreeze({ waveId: value.waveId, cursor: value.cursor ?? 0, sinceSeq: value.sinceSeq ?? null });
  }
// D2.4: waves.list — the registry read accepts only the optional cursor.
export function _normalizeWaveList(application, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some((key) => !['cursor'].includes(key))
      || (value.cursor !== undefined && !Number.isSafeInteger(value.cursor))) {
      throw applicationError('wave list request is invalid', 'application_wave_list_invalid');
    }
    return deepFreeze({ cursor: value.cursor ?? 0 });
  }
export function _normalizeWaveMemberAction(application, value, label, opts = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some((key) => !['runId', 'message', 'delivery', 'reason', 'claimGrant'].includes(key))
      || !validId(value.runId)
      || (opts.reason !== true && !validText(value.message))
      || (opts.reason === true && !validText(value.reason))
      || (value.delivery !== undefined && !['nudge', 'now', 'turn'].includes(value.delivery))) {
      throw applicationError(`${label} request is invalid`, 'application_wave_member_action_invalid');
    }
    // Epic #78 Decision 2: the optional closed claimGrant request — {boardRunId, board} ONLY.
    // The caller names no grantee and no permissions; the hub resolves both server-side.
    if (value.claimGrant !== undefined) {
      const claimGrant = value.claimGrant;
      if (!claimGrant || typeof claimGrant !== 'object' || Array.isArray(claimGrant)
        || Object.keys(claimGrant).sort().join(',') !== 'board,boardRunId'
        || !validId(claimGrant.board) || !validId(claimGrant.boardRunId)) {
        throw applicationError(`${label} claim grant is invalid`, 'application_wave_member_action_invalid');
      }
    }
    return deepFreeze(clone(value));
  }
// -------------------------------------------------------------------------
// Facade-projection epic (#87+#48, contract v2.2) — the workflow-surface direct ports.
// These eight commands are DIRECT PORTS (never APPLICATION_COMMAND_DEFINITIONS keys, so the
// byte-stable command-table key set is unchanged) dispatched ahead of the recursive-session
// gate exactly like the wave ergonomics. Each projects ONE landed kernel lane with the
// projection law: reach, never semantics (Decision 1) — lane outcomes pass through verbatim
// with only the schemaVersion: 1 envelope marker; lane-thrown coded refusals propagate with
// their .code untouched. The facade's closed validators are exactly as permissive as the
// lane's — never narrower (a facade refusal the lane would not produce is a semantics change).
// -------------------------------------------------------------------------
export function _normalizeMessageSend(application, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some((key) => !['runId', 'workerId', 'kind', 'body', 'budget'].includes(key))
      || (Object.hasOwn(value, 'runId') === Object.hasOwn(value, 'workerId'))
      || (Object.hasOwn(value, 'runId') && !validId(value.runId))
      || (Object.hasOwn(value, 'workerId') && !validId(value.workerId))
      || !['inform', 'query', 'steer', 'brief', 'result'].includes(value.kind)
      || typeof value.body !== 'string' || value.body.length === 0 || value.body.includes('\0')) {
      throw applicationError('run message send request is invalid', 'application_message_send_invalid');
    }
    // Decision 12: the lane's 2,048-byte send cap is projected as the facade's admission bound;
    // the oversize refusal names cap AND actual (#89's admitted-refusal law).
    const bodyBytes = Buffer.byteLength(value.body);
    if (bodyBytes > FRAME_LIMITS['message.send.body'].value) {
      throw applicationError(
        `Run message body exceeds the ${FRAME_LIMITS['message.send.body'].value}-byte message cap (actual ${bodyBytes} bytes)`,
        'application_message_send_invalid',
      );
    }
    // #105 D6/B-5b: budget is passed RAW (value.budget ?? 1) — the lane is the single budget
    // authority for shape AND range (1.5 and "3" both reach the lane's message_budget_invalid,
    // never the facade's shape code). No range check here; the facade stays exactly as
    // permissive as the lane.
    return deepFreeze({
      ...(Object.hasOwn(value, 'runId') ? { runId: value.runId } : {}),
      ...(Object.hasOwn(value, 'workerId') ? { workerId: value.workerId } : {}),
      kind: value.kind,
      body: value.body,
      budget: value.budget ?? 1,
    });
  }
export function _normalizeMessageReceipt(application, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'messageId'
      || typeof value.messageId !== 'string' || !/^message:[a-f0-9]{64}$/u.test(value.messageId)) {
      throw applicationError('run message receipt request is invalid', 'application_message_receipt_invalid');
    }
    return deepFreeze({ messageId: value.messageId });
  }
export function _normalizeAttentionWatch(application, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some((key) => !['runId', 'kind', 'cursor'].includes(key))
      || !validId(value.runId)
      || (value.kind !== undefined && !validId(value.kind))
      || (value.cursor !== undefined && (!Number.isSafeInteger(value.cursor) || value.cursor < 0))) {
      throw applicationError('run attention watch request is invalid', 'application_attention_watch_invalid');
    }
    return deepFreeze({
      runId: value.runId,
      ...(value.kind !== undefined ? { kind: value.kind } : {}),
      ...(value.cursor !== undefined ? { cursor: value.cursor } : {}),
    });
  }
export function _normalizeScratchpadRead(application, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some((key) => !['runId', 'scope', 'cursor'].includes(key))
      || !validId(value.runId)
      || typeof value.scope !== 'string' || !/^(?:shared|worker:[A-Za-z0-9._:-]{1,256})$/u.test(value.scope)
      || (value.cursor !== undefined && (!Number.isSafeInteger(value.cursor) || value.cursor < 0))) {
      throw applicationError('run scratchpad read request is invalid', 'application_scratchpad_read_invalid');
    }
    return deepFreeze({
      runId: value.runId, scope: value.scope,
      ...(value.cursor !== undefined ? { cursor: value.cursor } : {}),
    });
  }
export function _normalizeScratchpadAppend(application, value) {
    // #158: the shared-scratchpad write envelope — the MCP tool's shipped schema
    // (baton_run_scratchpad_append): {runId, scope, kind?, body, idempotencyKey?}. Scope
    // follows the D1.2 law verbatim (workers write worker:<id> + shared). The entry body
    // bound is the store's own admission row (appendScratchpad D3); validated there,
    // never duplicated here.
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some((key) => !['runId', 'scope', 'kind', 'body', 'idempotencyKey'].includes(key))
      || !validId(value.runId)
      || typeof value.scope !== 'string' || !/^(?:shared|worker:[A-Za-z0-9._:-]{1,256})$/u.test(value.scope)
      || (value.kind !== undefined && !['note', 'plan', 'doubt', 'link'].includes(value.kind))
      || (value.idempotencyKey !== undefined
        && (typeof value.idempotencyKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value.idempotencyKey)))
      || (typeof value.body !== 'string' && (value.body === null || typeof value.body !== 'object'))) {
      throw applicationError('run scratchpad append request is invalid', 'application_scratchpad_append_invalid');
    }
    if (typeof value.body === 'string' && value.body.length === 0) {
      throw applicationError('run scratchpad append request is invalid', 'application_scratchpad_append_invalid');
    }
    return deepFreeze({
      runId: value.runId, scope: value.scope,
      kind: value.kind ?? 'note',
      body: value.body,
      ...(value.idempotencyKey !== undefined ? { idempotencyKey: value.idempotencyKey } : {}),
    });
  }
export function _normalizeScratchpadElevate(application, value) {
    // Decision 12: ≤128 unique scratchpad-entry:<64 hex> ids (the store's MAX_SCRATCHPAD_WORKER_ENTRIES).
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some((key) => !['runId', 'taskId', 'entryIds'].includes(key))
      || !validId(value.runId) || !validId(value.taskId)
      || !Array.isArray(value.entryIds)
      || new Set(value.entryIds).size !== value.entryIds.length
      || value.entryIds.some((id) => typeof id !== 'string' || !/^scratchpad-entry:[a-f0-9]{64}$/u.test(id))) {
      throw applicationError('run scratchpad elevate request is invalid', 'application_scratchpad_elevate_invalid');
    }
    if (value.entryIds.length > 128) {
      throw applicationError(
        `Run scratchpad elevation entryIds exceeds the 128-entry cap (actual ${value.entryIds.length} entries)`,
        'application_scratchpad_elevate_invalid',
      );
    }
    return deepFreeze({ runId: value.runId, taskId: value.taskId, entryIds: [...value.entryIds] });
  }
export function _normalizeBoardPost(application, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some((key) => !['runId', 'board', 'title', 'detail', 'owner', 'evidence'].includes(key))
      || !validId(value.runId)
      || typeof value.board !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/u.test(value.board)
      || typeof value.title !== 'string' || value.title.length === 0
      || (value.detail !== undefined && value.detail !== null
        && (typeof value.detail !== 'string' || value.detail.length === 0))
      || (value.owner !== undefined && value.owner !== null
        && (typeof value.owner !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/u.test(value.owner)))
      || (value.evidence !== undefined && !Array.isArray(value.evidence))) {
      throw applicationError('run board post request is invalid', 'application_board_post_invalid');
    }
    const titleBytes = Buffer.byteLength(value.title);
    if (titleBytes > FRAME_LIMITS['board.title'].value) {
      throw applicationError(
        `Board title exceeds the ${FRAME_LIMITS['board.title'].value}-byte cap (actual ${titleBytes} bytes)`,
        'application_board_post_invalid',
      );
    }
    if (value.detail != null) {
      const detailBytes = Buffer.byteLength(value.detail);
      if (detailBytes > FRAME_LIMITS['board.detail'].value) {
        throw applicationError(
          `Board detail exceeds the ${FRAME_LIMITS['board.detail'].value}-byte cap (actual ${detailBytes} bytes)`,
          'application_board_post_invalid',
        );
      }
    }
    const evidence = value.evidence ?? [];
    if (evidence.length > 8) {
      throw applicationError(
        `Board evidence exceeds the 8-ref cap (actual ${evidence.length} refs)`,
        'application_board_post_invalid',
      );
    }
    for (const ref of evidence) {
      if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
        throw applicationError('run board post request is invalid', 'application_board_post_invalid');
      }
      const keys = Object.keys(ref).sort().join(',');
      if (!((keys === 'coordinationSeq' && Number.isSafeInteger(ref.coordinationSeq) && ref.coordinationSeq > 0)
        || (keys === 'artifactId' && typeof ref.artifactId === 'string' && ref.artifactId.length > 0))) {
        throw applicationError('run board post request is invalid', 'application_board_post_invalid');
      }
    }
    return deepFreeze({
      runId: value.runId, board: value.board, title: value.title,
      ...(value.detail !== undefined ? { detail: value.detail } : {}),
      ...(value.owner !== undefined ? { owner: value.owner } : {}),
      evidence: [...evidence],
    });
  }
export function _normalizeBoardRead(application, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'board,runId'
      || !validId(value.runId)
      || typeof value.board !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/u.test(value.board)) {
      throw applicationError('run board read request is invalid', 'application_board_read_invalid');
    }
    return deepFreeze({ runId: value.runId, board: value.board });
  }
// The 19 landed knowledge node types (coordination-store KNOWLEDGE_NODE_TYPES, minus the
// recorded subtraction: Decision is unseedable through the closed shape — a Decision requires
// informedBy graph sources the shape does not carry, so the facade refuses at validation what
// the lane would refuse as causal_orphan).
export function _normalizeKnowledgeSeed(application, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some((key) => !['runId', 'type', 'grounding', 'body', 'evidence'].includes(key))
      || !validId(value.runId)
      || !['Run', 'Task', 'Artifact', 'Phase', 'Experiment', 'Finding', 'Decision', 'Question', 'Hypothesis',
        'Principle', 'Constraint', 'Literature', 'Research', 'RouteStat', 'Skill', 'Counterexample',
        'Representation', 'ScratchFact', 'Source'].includes(value.type)
      || value.type === 'Decision'
      || !['verified', 'observed', 'derived', 'asserted'].includes(value.grounding)
      || typeof value.body !== 'string' || value.body.length === 0 || value.body.includes('\0')
      || (value.evidence !== undefined && !Array.isArray(value.evidence))) {
      throw applicationError('run knowledge seed request is invalid', 'application_knowledge_seed_invalid');
    }
    const bodyBytes = Buffer.byteLength(value.body);
    if (bodyBytes > FRAME_LIMITS['run.objective'].value) {
      throw applicationError(
        `Knowledge seed body exceeds the ${FRAME_LIMITS['run.objective'].value}-byte cap (actual ${bodyBytes} bytes)`,
        'application_knowledge_seed_invalid',
      );
    }
    const evidence = value.evidence ?? [];
    for (const ref of evidence) {
      if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
        throw applicationError('run knowledge seed request is invalid', 'application_knowledge_seed_invalid');
      }
      const keys = Object.keys(ref).sort().join(',');
      if (!((keys === 'coordinationSeq' && Number.isSafeInteger(ref.coordinationSeq) && ref.coordinationSeq > 0)
        || (keys === 'artifactId' && typeof ref.artifactId === 'string' && ref.artifactId.length > 0))) {
        throw applicationError('run knowledge seed request is invalid', 'application_knowledge_seed_invalid');
      }
    }
    // The Finding-scoped rule (mirrored EXACTLY as the lane scopes it — the store's rule is
    // Finding-specific, so a verified Constraint without evidence is lane-legal and NOT refused).
    if (value.type === 'Finding' && value.grounding === 'verified' && evidence.length === 0) {
      throw applicationError('verified Finding requires evidence', 'application_knowledge_seed_invalid');
    }
    return deepFreeze({
      runId: value.runId, type: value.type, grounding: value.grounding, body: value.body,
      evidence: [...evidence],
    });
  }
