import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const INTERVENTIONS = new Set([
  'control.send', 'control.steer', 'control.nudge', 'control.follow_up_requested',
  'control.interrupt_requested', 'kill.requested', 'control.recovery_requested',
]);
const RETAINED_GOAL_CATALOG = Object.freeze([
  'northbound-authenticated-user-orchestrator-control', 'southbound-harness-model-effort-routing', 'persistent-session-resume-fork', 'lifecycle-replay-kill-reap',
  'os-sandbox-scoped-secrets', 'provenance-correct-messaging', 'budgets-watchdogs-telemetry-operator-control', 'verification-mutation-independent-oracle-semantic-review',
  'integration-approval-gated-publication', 'adaptive-routing-evaluation-context-governance', 'shared-memory-promotion-recall-feedback-contradiction-temporal-integrity',
  'project-manager-inspired-self-contained-selective-typed-causal-graph', 'atlas-search-ast-cst-symbol-scip-cpg-ir-semantic-delta', 'graph-backed-representation-nodes-and-semantic-diff',
  'vantage-debugging-evidence-ladder', 'scratch-repl-bench-notify-contention-and-control-failure-promotion', 'skill-forge-computer-use', 'cartographer-quartermaster-cairn',
  'structured-semantic-merge-behavioral-fingerprints', 'research-bet-egraphs', 'audit-gated-bounded-lexical-graph-recall', 'session-provider-northbound-runtime-depth',
  'deeper-language-lsp-ssa-pdg-path-alias-heap-implicit-flow-interprocedural-analysis', 'deployment-neutral-export-no-external-project-manager-or-homelab-runtime',
]);

const typed = (message, code) => Object.assign(new Error(message), { code });
const clone = (value) => JSON.parse(JSON.stringify(value));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const validRunId = (value) => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(value);
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const publicClaim = (value) => {
  const copy = clone(value);
  if (copy && Array.isArray(copy.refs)) copy.refs = copy.refs.map(({ path: _path, ...ref }) => ref);
  return copy;
};
const group = (items, key) => Object.fromEntries([...new Set(items.map(key))].sort().map((name) => [name, items.filter((item) => key(item) === name).length]));

export class CairnRunScorecard {
  constructor(opts = {}) {
    if (!opts.coordination || typeof opts.coordination.snapshot !== 'function' || typeof opts.coordination.sealRunScorecard !== 'function') {
      throw new TypeError('Cairn requires durable coordination with run sealing');
    }
    if (typeof opts.readOperational !== 'function') throw new TypeError('Cairn requires an authoritative operational reader');
    if (typeof opts.artifactRoot !== 'string' || opts.artifactRoot.length === 0) throw new TypeError('Cairn artifactRoot required');
    this.coordination = opts.coordination;
    this.readOperational = opts.readOperational;
    this.artifactRoot = resolve(opts.artifactRoot);
    this.routeAdvisor = opts.routeAdvisor ?? null;
    this.routeAdvice = opts.routeAdvice ?? null;
    if ((this.routeAdvisor === null) !== (this.routeAdvice === null)) throw new TypeError('Cairn route advice requires router and ceilings together');
    if (this.routeAdvisor && (typeof this.routeAdvisor.advice !== 'function' || typeof this.routeAdvisor.policy !== 'function' || typeof this.routeAdvisor.snapshot !== 'function' || typeof this.coordination.routeObservations !== 'function'
      || !this.routeAdvice || Object.keys(this.routeAdvice).sort().join(',') !== ['maxBytes', 'maxCandidates', 'maxRows', 'maxTaskTypeBytes'].sort().join(',')
      || Object.values(this.routeAdvice).some((value) => !Number.isSafeInteger(value) || value <= 0) || this.routeAdvice.maxCandidates > 10_000 || this.routeAdvice.maxRows > 10_000 || this.routeAdvice.maxRows < this.routeAdvice.maxCandidates || this.routeAdvice.maxTaskTypeBytes > 4_096 || this.routeAdvice.maxBytes > 16 * 1024 * 1024)) throw new TypeError('Cairn route advice configuration is invalid');
    this.knowledgeAuditPolicy = opts.knowledgeAuditPolicy ? clone(opts.knowledgeAuditPolicy) : null;
    if (this.knowledgeAuditPolicy) {
      const names = ['repoId', 'maxStateRows', 'maxNodes', 'maxEdges', 'maxEvidenceRefs', 'maxAuditSamples', 'maxTraceDepth', 'maxTraceRows', 'maxArtifactBytes', 'maxResultBytes'];
      const numeric = names.filter((name) => name !== 'repoId'); const p = this.knowledgeAuditPolicy;
      if (Object.keys(p).sort().join(',') !== names.sort().join(',') || typeof p.repoId !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(p.repoId)
        || numeric.some((name) => !Number.isSafeInteger(p[name]) || p[name] <= 0) || p.maxNodes > p.maxStateRows || p.maxEdges > p.maxStateRows || p.maxAuditSamples > p.maxStateRows || p.maxTraceRows > p.maxStateRows || p.maxEvidenceRefs > 1_000_000 || p.maxEvidenceRefs > p.maxStateRows * 64
        || p.maxTraceDepth > 64 || p.maxStateRows > 1_000_000 || p.maxArtifactBytes > 16 * 1024 * 1024 || p.maxResultBytes > 16 * 1024 * 1024
        || typeof this.coordination.auditKnowledge !== 'function' || typeof this.coordination.traceKnowledgeBounded !== 'function' || typeof this.coordination.observationTime !== 'function') throw new TypeError('Cairn causal audit configuration is invalid');
      this.knowledgeAuditPolicy = Object.freeze(p); this.knowledgePolicyDigest = sha256(stable(p));
    }
    mkdirSync(this.artifactRoot, { recursive: true, mode: 0o700 });
  }

  card() {
    const ops = {
      'run.scorecard': {
        latency_class: 'interactive', deterministic: true, side_effects: ['artifact.write', 'coordination.append', 'knowledge.promote'], reverifiable: true,
      },
    };
    if (this.routeAdvisor) ops['route.advice'] = { latency_class: 'interactive', deterministic: true, side_effects: [], reverifiable: true };
    if (this.knowledgeAuditPolicy) {
      ops['causal.audit'] = { latency_class: 'interactive', deterministic: true, side_effects: ['artifact.write'], reverifiable: true };
      ops['causal.trace'] = { latency_class: 'interactive', deterministic: true, side_effects: [], reverifiable: true };
    }
    return {
      name: 'cairn', version: 1,
      ops,
    };
  }

  deploymentRepoId() { return this.knowledgeAuditPolicy?.repoId ?? null; }

  _routeAdvice(args) {
    if (!this.routeAdvisor) throw typed('route advice is not deployment-configured', 'capability_op_unavailable');
    if (!args || Object.keys(args).sort().join(',') !== ['candidates', 'observedAt', 'taskType'].sort().join(',') || typeof args.taskType !== 'string' || args.taskType.trim().length === 0 || Buffer.byteLength(args.taskType) > this.routeAdvice.maxTaskTypeBytes
      || !Number.isFinite(Date.parse(args.observedAt)) || new Date(Date.parse(args.observedAt)).toISOString() !== args.observedAt || !Array.isArray(args.candidates) || args.candidates.length === 0 || args.candidates.length > this.routeAdvice.maxCandidates || args.candidates.length > this.routeAdvice.maxRows) throw typed('route advice request is invalid', 'route_advice_invalid');
    const candidates = args.candidates.map((row) => {
      if (!row || Object.keys(row).sort().join(',') !== ['concurrencyCeiling', 'inFlight', 'modelFamily', 'routeKey'].sort().join(',') || typeof row.routeKey !== 'string' || Buffer.byteLength(row.routeKey) > 4096 || typeof row.modelFamily !== 'string' || row.modelFamily.length === 0 || Buffer.byteLength(row.modelFamily) > 128
        || !Number.isSafeInteger(row.concurrencyCeiling) || row.concurrencyCeiling <= 0 || !Number.isSafeInteger(row.inFlight) || row.inFlight < 0) throw typed('route advice candidate is invalid', 'route_advice_invalid');
      let tuple; try { tuple = JSON.parse(row.routeKey); } catch { throw typed('route advice tuple is invalid', 'route_advice_invalid'); }
      if (!Array.isArray(tuple) || tuple.length !== 6 || tuple[4] !== row.modelFamily || tuple[5] !== args.taskType) throw typed('route advice tuple is invalid', 'route_advice_invalid');
      return { modelVersion: row.routeKey, family: row.modelFamily, concurrencyCeiling: row.concurrencyCeiling, inFlight: row.inFlight };
    });
    if (new Set(candidates.map((row) => row.modelVersion)).size !== candidates.length) throw typed('route advice candidates are duplicated', 'route_advice_invalid');
    const observations = this.coordination.routeObservations(); const latestObservedAt = observations.at(-1)?.observedAt ?? null;
    if (latestObservedAt && Date.parse(args.observedAt) < Date.parse(latestObservedAt)) throw typed('route advice observation time predates durable evidence', 'route_advice_invalid');
    const before = this.routeAdvisor.snapshot?.(); const advice = this.routeAdvisor.advice({ taskType: args.taskType }, candidates, { now: Date.parse(args.observedAt) });
    if (before && stable(before) !== stable(this.routeAdvisor.snapshot())) throw typed('route advice mutated router state', 'route_advice_integrity');
    const coordinationUpperBound = observations.at(-1)?.eventSeq ?? 0; const core = { schemaVersion: 1, taskType: args.taskType, observedAt: args.observedAt, coordinationUpperBound, policyDigest: sha256(stable(this.routeAdvisor.policy())), selectedRouteKey: advice.selected, effectiveMode: advice.mode, rows: advice.rows.map((row) => ({ routeKey: row.modelVersion, modelFamily: row.family, eligible: row.eligible, verifiedWeight: row.weight, evidenceCount: row.count, successRate: row.rate, score: row.score, seededFrom: row.seededFrom, selected: row.selected, reason: row.reason })) };
    const document = { ...core, adviceDigest: sha256(stable(core)) };
    if (document.rows.length > this.routeAdvice.maxRows || Buffer.byteLength(stable(document)) > this.routeAdvice.maxBytes) throw typed('route advice exceeded deployment ceiling', 'route_advice_oversize');
    return document;
  }

  _routeResult(document) {
    return { op: 'route.advice', status: 'ok', summary: `bounded Cairn advice for ${document.taskType}`, payload: [clone(document)], refs: [], cost: { tokens_out: Math.ceil(Buffer.byteLength(stable(document)) / 4), wall_ms: 0, usd: 0, underlying: 'cairn:deterministic' }, provenance: { deterministic: true, readOnly: true, coordinationUpperBound: document.coordinationUpperBound, workerAuthority: false, verificationAuthority: false, mergeAuthority: false, approvalAuthority: false, publicationAuthority: false, routingMutationAuthority: false } };
  }

  _knowledgeContext(ctx) {
    if (!this.knowledgeAuditPolicy) throw typed('causal audit is not deployment-configured', 'capability_op_unavailable');
    if (ctx?.repoId !== this.knowledgeAuditPolicy.repoId) throw typed('causal repository authority mismatch', 'causal_repo_mismatch');
    if (typeof ctx?.idempotencyKey !== 'string' || ctx.idempotencyKey.length === 0 || Buffer.byteLength(ctx.idempotencyKey) > 4_096) throw typed('causal invocation idempotency authority is invalid', 'causal_context_invalid');
    if (ctx.signal?.aborted) throw typed('causal operation cancelled', 'cancelled');
  }

  _causalBoundary(args, allowed, override = null) {
    if (!args || Object.keys(args).some((key) => !allowed.includes(key))) throw typed('causal request is invalid', 'causal_request_invalid');
    const upper = override ?? args.observedSeq ?? this.coordination.snapshot().lastSeq;
    if (!Number.isSafeInteger(upper) || upper < 0 || upper > this.coordination.snapshot().lastSeq || (args.observedSeq !== undefined && args.observedSeq !== upper)) throw typed('causal observation boundary is invalid', 'causal_request_invalid');
    return upper;
  }

  _knowledgeProvenance(kind, upper) {
    return { kind, repoId: this.knowledgeAuditPolicy.repoId, coordinationUpperBound: upper, policyDigest: this.knowledgePolicyDigest, deterministic: true, readOnly: true, workerAuthority: false, editAuthority: false, verificationAuthority: false, mergeAuthority: false, approvalAuthority: false, publicationAuthority: false, routingMutationAuthority: false, proofAuthority: false, noteAuthority: false, policyAuthoringAuthority: false };
  }

  _boundedKnowledgeResult(result) {
    if (Buffer.byteLength(stable(result)) > this.knowledgeAuditPolicy.maxResultBytes) throw typed('causal result exceeded deployment ceiling', result.op === 'causal.audit' ? 'causal_audit_oversize' : 'causal_trace_oversize');
    return result;
  }

  _causalAudit(args, ctx, override = null, writeArtifact = true) {
    this._knowledgeContext(ctx); const upper = this._causalBoundary(args, ['observedSeq'], override); const p = this.knowledgeAuditPolicy;
    const metrics = this.coordination.auditKnowledge({ observedSeq: upper, maxStateRows: p.maxStateRows, maxNodes: p.maxNodes, maxEdges: p.maxEdges, maxEvidenceRefs: p.maxEvidenceRefs, maxAuditSamples: p.maxAuditSamples });
    this._knowledgeContext(ctx);
    const retainedScope = { catalogVersion: 1, capabilityIds: [...RETAINED_GOAL_CATALOG] }; retainedScope.catalogDigest = sha256(stable(retainedScope));
    const core = { schemaVersion: 1, kind: 'baton.cairn.causal-audit', repoId: p.repoId, coordinationUpperBound: upper, coordinationObservedAt: this.coordination.observationTime(upper), policyDigest: this.knowledgePolicyDigest, metrics, disposition: { status: metrics.violations.critical === 0 ? 'pass' : 'fail', criticalViolations: metrics.violations.critical }, unresolvedContradictionsArePreserved: true, retainedScope, retainedNext: ['audit-gated-bounded-lexical-graph-recall', 'promotion-breadth', 'playbook-skill-promotion', 'recall-feedback', 'deployment-neutral-export'] };
    const bytes = stable(core); if (Buffer.byteLength(bytes) > p.maxArtifactBytes) throw typed('causal audit artifact exceeded deployment ceiling', 'causal_audit_oversize');
    const packetDigest = sha256(bytes); const path = this._artifactPath(packetDigest); const document = { ...core, auditDigest: packetDigest };
    const result = this._boundedKnowledgeResult({ op: 'causal.audit', status: 'ok', summary: `attested Cairn causal audit for ${p.repoId}`, payload: [document], refs: [{ kind: 'cairn-causal-audit', digest: packetDigest, bytes: Buffer.byteLength(bytes), path }], cost: { tokens_out: Math.ceil(Buffer.byteLength(stable(document)) / 4), wall_ms: 0, usd: 0, underlying: 'cairn:deterministic' }, provenance: this._knowledgeProvenance('causal-audit', upper) });
    if (existsSync(path)) { const stat = statSync(path); if (sha256(readFileSync(path)) !== packetDigest || (stat.mode & 0o777) !== 0o600 || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw typed('causal audit artifact path is occupied by invalid content, owner, or mode', 'causal_audit_integrity'); }
    else if (writeArtifact) { writeFileSync(path, bytes, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); const stat = statSync(path); if ((stat.mode & 0o777) !== 0o600 || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw typed('causal audit artifact owner or mode is invalid', 'causal_audit_integrity'); }
    else throw typed('causal audit artifact is missing', 'causal_audit_integrity');
    return result;
  }

  _causalTrace(args, ctx, override = null) {
    this._knowledgeContext(ctx); if (typeof args?.nodeId !== 'string' || args.nodeId.length === 0 || Buffer.byteLength(args.nodeId) > 4_096) throw typed('causal trace request is invalid', 'causal_request_invalid');
    const upper = this._causalBoundary(args, ['nodeId', 'observedSeq'], override); const p = this.knowledgeAuditPolicy;
    const trace = this.coordination.traceKnowledgeBounded(args.nodeId, { observedSeq: upper, maxDepth: p.maxTraceDepth, maxRows: p.maxTraceRows, maxEvidenceRefs: p.maxEvidenceRefs, maxStateRows: p.maxStateRows, maxNodes: p.maxNodes, maxEdges: p.maxEdges }); this._knowledgeContext(ctx);
    const core = { schemaVersion: 1, kind: 'baton.cairn.causal-trace', repoId: p.repoId, policyDigest: this.knowledgePolicyDigest, ...trace }; const traceDigest = sha256(stable(core)); const document = { ...core, traceDigest };
    return this._boundedKnowledgeResult({ op: 'causal.trace', status: trace.complete ? 'ok' : 'partial', summary: `bounded Cairn causal trace for ${args.nodeId}`, payload: [document], refs: [{ kind: 'cairn-causal-trace', digest: traceDigest, bytes: Buffer.byteLength(stable(core)) }], cost: { tokens_out: Math.ceil(Buffer.byteLength(stable(document)) / 4), wall_ms: 0, usd: 0, underlying: 'cairn:deterministic' }, provenance: this._knowledgeProvenance('causal-trace', upper) });
  }

  _events(worker, throughSeq) {
    const events = this.readOperational(worker, throughSeq);
    if (!Array.isArray(events)) throw typed('operational evidence reader unavailable', 'run_evidence_unavailable');
    const bounded = events.filter((event) => event.seq <= throughSeq);
    if (bounded.length !== throughSeq || bounded.some((event, index) => event.seq !== index + 1 || event.worker !== worker)) {
      throw typed(`operational prefix is incomplete for ${worker}`, 'run_evidence_gap');
    }
    return bounded;
  }

  _build(runId, sealed = null) {
    const snapshot = this.coordination.snapshot();
    const tasks = snapshot.tasks.filter((task) => task.runId === runId).sort((a, b) => a.id.localeCompare(b.id));
    if (tasks.length === 0) throw typed(`unknown run ${runId}`, 'run_not_found');
    if (tasks.some((task) => !TERMINAL.has(task.status))) throw typed(`run ${runId} is not terminal`, 'run_not_terminal');
    const expectedIds = sealed?.taskIds ?? tasks.map((task) => task.id);
    if (stable(expectedIds) !== stable(tasks.map((task) => task.id))) throw typed('sealed run membership diverged', 'run_membership_changed');

    const workerCache = new Map();
    const operationalTails = tasks.map((task) => {
      const pinned = sealed?.operationalTails?.find((tail) => tail.taskId === task.id);
      const all = this.readOperational(task.assignee, pinned?.tail ?? null);
      if (!Array.isArray(all)) throw typed('operational evidence reader unavailable', 'run_evidence_unavailable');
      const tail = pinned?.tail ?? all.at(-1)?.seq ?? 0;
      const events = this._events(task.assignee, tail);
      workerCache.set(`${task.id}:${task.assignee}`, events);
      return { taskId: task.id, worker: task.assignee, tail };
    });

    const coordinationUpperBound = sealed?.coordinationUpperBound ?? snapshot.lastSeq;
    const coordinationEvents = this.coordination.events(1, coordinationUpperBound);
    if (coordinationEvents.length !== coordinationUpperBound) throw typed('coordination prefix is incomplete', 'run_prefix_changed');
    const evidence = [];
    const taskRows = [];
    let verified = 0;
    let asserted = 0;
    const relevantEvents = [];

    for (const task of tasks) {
      evidence.push({ coordinationSeq: task.terminalEvent });
      const events = workerCache.get(`${task.id}:${task.assignee}`);
      for (const event of events) {
        if (event.taskId === task.id && event.runId !== runId) throw typed(`mixed run attribution for ${task.id}`, 'run_attribution_mismatch');
        if (event.taskId === task.id && event.runId === runId) relevantEvents.push(event);
      }
      const mappedVerification = coordinationEvents.filter((event) => event.kind === 'evidence.mapped' && event.payload?.kind === 'verify.reverified')
        .find((event) => {
          const source = events.find((candidate) => candidate.seq === event.payload.workerSeq && candidate.worker === event.payload.worker);
          return source?.taskId === task.id && source?.runId === runId && source?.kind === 'verify.reverified' && source?.payload?.accept === true;
        });
      const isVerified = task.status === 'completed' && Boolean(mappedVerification);
      if (isVerified) { verified += 1; evidence.push({ coordinationSeq: mappedVerification.seq }); }
      else if (task.status === 'completed') asserted += 1;
      const usage = events.filter((event) => event.taskId === task.id && event.runId === runId && event.kind === 'resource.tokens')
        .reduce((sum, event) => ({ tokens: sum.tokens + Number(event.payload?.tokens ?? 0), usd: sum.usd + Number(event.payload?.usd ?? 0) }), { tokens: 0, usd: 0 });
      taskRows.push({
        taskId: task.id, worker: task.assignee, outcome: task.status, verified: isVerified,
        route: {
          harnessRequested: task.harnessRequested ?? task.vendorRequested ?? null,
          harnessResolved: task.harnessResolved ?? null,
          modelRequested: task.modelRequested ?? null, modelResolved: task.modelResolved ?? null, modelObserved: task.modelObserved ?? null,
          effortRequested: task.effortRequested ?? null, effortResolved: task.effortResolved ?? null, effortObserved: task.effortObserved ?? null,
          routeKey: task.routeKey ?? null,
        },
        usage,
      });
    }

    const approvalsRequested = relevantEvents.filter((event) => event.kind === 'approval.requested').map((event) => event.payload?.requestId).filter(Boolean);
    const approvalsResolved = new Set(relevantEvents.filter((event) => event.kind === 'approval.resolved').map((event) => event.payload?.requestId).filter(Boolean));
    const interventions = relevantEvents.filter((event) => INTERVENTIONS.has(event.kind) && event.actor !== 'policy');
    const usage = taskRows.reduce((sum, task) => ({ tokens: sum.tokens + task.usage.tokens, usd: sum.usd + task.usage.usd }), { tokens: 0, usd: 0 });
    const row = {
      runId,
      tasks: { total: tasks.length, byOutcome: group(tasks, (task) => task.status) },
      completions: { verified, asserted },
      interventions: { total: interventions.length, byKind: group(interventions, (event) => event.kind), byActor: group(interventions, (event) => event.actor) },
      approvals: { requested: approvalsRequested.length, resolved: approvalsRequested.filter((id) => approvalsResolved.has(id)).length, unresolved: approvalsRequested.filter((id) => !approvalsResolved.has(id)).sort() },
      usage,
      routes: group(taskRows, (task) => task.route.routeKey ?? `${task.route.harnessResolved ?? task.route.harnessRequested ?? 'unknown'}|${task.route.modelResolved ?? task.route.modelRequested ?? 'unknown'}|${task.route.effortResolved ?? task.route.effortRequested ?? 'default'}`),
      workers: taskRows,
      definitionOfDoneCoverage: { status: 'unavailable', reason: 'free_form_definition_of_done' },
    };
    const document = { schemaVersion: 1, kind: 'baton.cairn.run-scorecard', runId, coordinationUpperBound, operationalTails, row };
    const bytes = stable(document);
    return { document, bytes, digest: sha256(bytes), evidence: [...new Map(evidence.map((ref) => [ref.coordinationSeq, ref])).values()].sort((a, b) => a.coordinationSeq - b.coordinationSeq) };
  }

  _result(run) {
    const bytes = readFileSync(run.artifact.path).byteLength;
    return {
      op: 'run.scorecard', status: 'ok', summary: `sealed Cairn scorecard for ${run.runId}`,
      payload: [clone(run.scorecard)], refs: [{ kind: 'cairn-run-scorecard', digest: run.scorecardDigest, bytes, path: run.artifact.path }],
      cost: { tokens_out: Math.ceil(Buffer.byteLength(stable(run.scorecard)) / 4), wall_ms: 0, usd: 0, underlying: 'cairn:deterministic' },
      provenance: { runId: run.runId, coordinationUpperBound: run.coordinationUpperBound, deterministic: true, mergeAuthority: false, verificationAuthority: false },
    };
  }

  _artifactPath(digest) { return join(this.artifactRoot, `${digest}.json`); }

  async invoke(op, args, ctx) {
    if (op === 'route.advice') return this._routeResult(this._routeAdvice(args));
    if (op === 'causal.audit') return this._causalAudit(args, ctx);
    if (op === 'causal.trace') return this._causalTrace(args, ctx);
    if (op !== 'run.scorecard') throw typed('unsupported Cairn operation', 'capability_op_unavailable');
    const runId = args?.runId;
    if (!validRunId(runId)) throw typed('runId is invalid', 'invalid_run_id');
    const existing = this.coordination.run(runId);
    if (existing) return this._result(existing);
    const built = this._build(runId);
    const path = this._artifactPath(built.digest);
    if (existsSync(path)) {
      if (sha256(readFileSync(path)) !== built.digest) throw typed('content-addressed scorecard path is occupied by different bytes', 'run_artifact_conflict');
    } else writeFileSync(path, built.bytes, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    const sealed = this.coordination.sealRunScorecard({
      runId, coordinationUpperBound: built.document.coordinationUpperBound,
      operationalTails: built.document.operationalTails, taskIds: built.document.operationalTails.map((tail) => tail.taskId),
      scorecardDigest: built.digest, scorecard: built.document.row,
      artifact: { kind: built.document.kind, path, digest: built.digest, bytes: Buffer.byteLength(built.bytes) }, evidence: built.evidence,
    }, { actor: ctx.actor, key: `run.sealed:${runId}:${built.digest}` });
    return this._result(sealed.run);
  }

  async reverify(claim, op, args, ctx = {}) {
    try {
      if (op === 'route.advice') { const rebuilt = this._routeAdvice(args); const observed = claim?.payload?.[0]; return { ok: stable(observed) === stable(rebuilt) && observed?.adviceDigest === rebuilt.adviceDigest, digest: rebuilt.adviceDigest }; }
      if (op === 'causal.audit') {
        const upper = claim?.payload?.[0]?.coordinationUpperBound; if (!Number.isSafeInteger(args?.observedSeq)) return { ok: false, reason: 'observation_boundary_required' };
        const rebuilt = this._causalAudit(args, ctx, upper, false); const digest = rebuilt.refs[0].digest;
        if (!existsSync(rebuilt.refs[0].path) || sha256(readFileSync(rebuilt.refs[0].path)) !== digest) return { ok: false, reason: 'artifact_digest_mismatch' };
        const transported = ['web', 'mcp'].includes(ctx?.transport);
        if ((!transported && typeof claim?.refs?.[0]?.path !== 'string') || (claim?.refs?.[0]?.path !== undefined && resolve(claim.refs[0].path) !== resolve(rebuilt.refs[0].path))) return { ok: false, reason: 'artifact_path_mismatch' };
        return { ok: stable(publicClaim(claim)) === stable(publicClaim(rebuilt)), digest };
      }
      if (op === 'causal.trace') { if (!Number.isSafeInteger(args?.observedSeq)) return { ok: false, reason: 'observation_boundary_required' }; const rebuilt = this._causalTrace(args, ctx, claim?.payload?.[0]?.observedSeq); return { ok: stable(claim) === stable(rebuilt), digest: rebuilt.refs[0].digest }; }
      if (op !== 'run.scorecard' || !validRunId(args?.runId)) return { ok: false, reason: 'invalid_request' };
      const run = this.coordination.run(args.runId);
      if (!run || !existsSync(run.artifact?.path)) return { ok: false, reason: 'missing_seal_or_artifact' };
      if (resolve(run.artifact.path) !== this._artifactPath(run.scorecardDigest)) return { ok: false, reason: 'artifact_path_mismatch' };
      const bytes = readFileSync(run.artifact.path);
      if (sha256(bytes) !== run.scorecardDigest || claim?.refs?.[0]?.digest !== run.scorecardDigest) return { ok: false, reason: 'artifact_digest_mismatch' };
      const built = this._build(args.runId, run);
      return { ok: built.digest === run.scorecardDigest && stable(built.document.row) === stable(run.scorecard), digest: built.digest };
    } catch (error) {
      return { ok: false, reason: error?.code ?? 'reverify_failed' };
    }
  }
}
