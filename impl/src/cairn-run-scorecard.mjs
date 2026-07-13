import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const INTERVENTIONS = new Set([
  'control.send', 'control.steer', 'control.nudge', 'control.follow_up_requested',
  'control.interrupt_requested', 'kill.requested', 'control.recovery_requested',
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
    mkdirSync(this.artifactRoot, { recursive: true, mode: 0o700 });
  }

  card() {
    const ops = {
      'run.scorecard': {
        latency_class: 'interactive', deterministic: true, side_effects: ['artifact.write', 'coordination.append', 'knowledge.promote'], reverifiable: true,
      },
    };
    if (this.routeAdvisor) ops['route.advice'] = { latency_class: 'interactive', deterministic: true, side_effects: [], reverifiable: true };
    return {
      name: 'cairn', version: 1,
      ops,
    };
  }

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

  async reverify(claim, op, args) {
    try {
      if (op === 'route.advice') { const rebuilt = this._routeAdvice(args); const observed = claim?.payload?.[0]; return { ok: stable(observed) === stable(rebuilt) && observed?.adviceDigest === rebuilt.adviceDigest, digest: rebuilt.adviceDigest }; }
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
