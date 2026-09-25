import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const PRODUCER_NAME = 'atlas-representation-producer';
const OPERATION = 'representation.produce';
const RECEIPT_KIND = 'representation-receipt';
const RECEIPT_MEDIA = 'application/vnd.baton.representation-receipt+json';
const SAFE_ID = /^[A-Za-z0-9._:-]{1,256}$/u;
const HEX = /^[a-f0-9]{64}$/u;
const MAP = Object.freeze({
  structural_delta: Object.freeze({ capability: 'atlas-structural', version: '0.1.0', operation: 'diff.structural', rung: 'R1', representationType: 'ast_cst_structural_delta', artifactKind: 'structural_delta', mediaType: 'application/vnd.baton.atlas-structural+json', sideEffects: 'writes_content_addressed_artifact' }),
  symbol_snapshot: Object.freeze({ capability: 'atlas-index', version: '0.1.0', operation: 'scip.export', rung: 'R2', representationType: 'scip_symbol_snapshot', artifactKind: 'scip_json', mediaType: 'application/scip+json', sideEffects: 'writes_content_addressed_artifact' }),
  cpg_semantic_delta: Object.freeze({ capability: 'atlas-cpg-delta', version: '0.1.0', operation: 'cpg.delta', rung: 'R3', representationType: 'bounded_cpg_semantic_delta', artifactKind: 'cpg_delta', mediaType: 'application/vnd.baton.atlas-cpg-delta+json', sideEffects: 'writes_content_addressed_artifacts' }),
});
const POLICY_FIELDS = Object.freeze(['schemaVersion', 'repoId', 'maxArgumentBytes', 'maxSourceRefs', 'maxSourceRefBytes', 'maxEvidenceRefs', 'maxReceiptBytes', 'maxGraphBatchBytes', 'maxResultItems', 'maxResultRefs', 'maxResultBytes']);

const typed = (message, code) => Object.assign(new Error(message), { code });
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => JSON.parse(JSON.stringify(value));
const canonical = (value) => Array.isArray(value)
  ? value.map(canonical)
  : record(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const canonicalText = (value) => JSON.stringify(canonical(value));
const digest = (value) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonicalText(value)).digest('hex');
const bytes = (value) => Buffer.byteLength(canonicalText(value));
function jsonValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const values = Array.isArray(value) ? value : Object.getPrototypeOf(value) === Object.prototype ? Object.values(value) : null;
  const ok = values !== null && values.every((item) => jsonValue(item, seen));
  seen.delete(value); return ok;
}
function same(left, right) { return canonicalText(left) === canonicalText(right); }
function publicRef(ref) {
  if (!record(ref)) throw typed('representation source artifact reference is invalid', 'representation_source_ref_invalid');
  const allowed = ['handle', 'kind', 'digest', 'bytes', 'mediaType'];
  const value = Object.fromEntries(allowed.filter((key) => Object.hasOwn(ref, key)).map((key) => [key, ref[key]]));
  if (typeof value.handle !== 'string' || Buffer.byteLength(value.handle) > 4_096 || !HEX.test(value.digest ?? '')
    || typeof value.kind !== 'string' || typeof value.mediaType !== 'string'
    || !Number.isSafeInteger(value.bytes) || value.bytes < 0) throw typed('representation source artifact reference is invalid', 'representation_source_ref_invalid');
  return Object.freeze(value);
}
function stableResultProjection(result) {
  const projection = clone(result);
  projection.refs = projection.refs.map(publicRef);
  if (record(projection.cost)) delete projection.cost.wall_ms;
  return projection;
}
function terminalEvidence(attested) {
  const evidence = attested?.evidence?.filter((item) => item.kind === 'capability.op.completed').at(-1);
  if (!evidence) throw typed('capability invocation did not yield exact mapped terminal evidence', 'representation_evidence_unavailable');
  return Object.freeze(clone(evidence));
}
function validatePolicy(value) {
  const policy = clone(value);
  if (!record(policy) || Object.keys(policy).sort().join(',') !== [...POLICY_FIELDS].sort().join(',')
    || policy.schemaVersion !== 1 || typeof policy.repoId !== 'string' || !SAFE_ID.test(policy.repoId)
    || POLICY_FIELDS.filter((key) => !['schemaVersion', 'repoId'].includes(key)).some((key) => !Number.isSafeInteger(policy[key]) || policy[key] <= 0)
    || policy.maxArgumentBytes > 1024 * 1024 || policy.maxSourceRefs > 256 || policy.maxSourceRefBytes > 64 * 1024
    || policy.maxEvidenceRefs < 2 || policy.maxEvidenceRefs > 1024
    || policy.maxReceiptBytes > 16 * 1024 * 1024 || policy.maxGraphBatchBytes > 16 * 1024 * 1024
    || policy.maxResultItems > 1024 || policy.maxResultRefs > 256
    || policy.maxResultBytes > 16 * 1024 * 1024) throw new TypeError('representation production policy is invalid');
  return Object.freeze(policy);
}
function validateEnvironment(kind, value, repoId) {
  if (!record(value) || value.repoId !== repoId || !jsonValue(value)) throw typed('representation environment identity is invalid', 'representation_environment_invalid');
  const structural = ['afterOverlayDigest', 'afterTreeSha', 'beforeOverlayDigest', 'beforeTreeSha', 'kind', 'repoId', 'schemaVersion'];
  const index = ['indexEpoch', 'kind', 'overlayDigest', 'repoId', 'schemaVersion', 'treeSha'];
  const expected = kind === 'symbol_snapshot' ? index : structural;
  if (Object.keys(value).sort().join(',') !== expected.sort().join(',') || value.schemaVersion !== 1
    || value.kind !== (kind === 'symbol_snapshot' ? 'index_snapshot' : 'tree_delta')) throw typed('representation environment identity is invalid', 'representation_environment_invalid');
  const treeKeys = kind === 'symbol_snapshot' ? ['treeSha'] : ['beforeTreeSha', 'afterTreeSha'];
  const digestKeys = kind === 'symbol_snapshot' ? ['indexEpoch'] : ['beforeOverlayDigest', 'afterOverlayDigest'];
  if (treeKeys.some((key) => typeof value[key] !== 'string' || !/^[a-f0-9]{4,128}$/u.test(value[key]))
    || digestKeys.some((key) => typeof value[key] !== 'string' || !HEX.test(value[key]))
    || (kind === 'symbol_snapshot' && value.overlayDigest !== null && !HEX.test(value.overlayDigest ?? ''))) throw typed('representation environment identity is invalid', 'representation_environment_invalid');
  return Object.freeze(clone(value));
}

export class AtlasRepresentationProducer {
  constructor(opts = {}) {
    if (!opts.coordination || !['representationProductionAdmission', 'prepareRepresentationProduction', 'recordRepresentationProduction', 'representationProduction', 'representationProductionByRequest', 'reverifyRepresentationProduction'].every((name) => typeof opts.coordination[name] === 'function')) throw new TypeError('representation producer requires durable coordination authority');
    if (typeof opts.artifactRoot !== 'string' || opts.artifactRoot.length === 0) throw new TypeError('representation producer artifactRoot required');
    if (typeof opts.authorize !== 'function' || typeof opts.resolveEnvironment !== 'function') throw new TypeError('representation producer requires deployment authorization and environment authority');
    this.coordination = opts.coordination; this.policy = validatePolicy(opts.policy); this.authorize = opts.authorize; this.resolveEnvironment = opts.resolveEnvironment;
    this.policyDigest = digest(this.policy); this.artifactRoot = resolve(opts.artifactRoot); this.registry = null;
    if (existsSync(this.artifactRoot) && lstatSync(this.artifactRoot).isSymbolicLink()) throw new TypeError('representation producer artifactRoot must not be a symlink');
    mkdirSync(this.artifactRoot, { recursive: true, mode: 0o700 }); chmodSync(this.artifactRoot, 0o700);
    const artifactRootStat = lstatSync(this.artifactRoot);
    if (!artifactRootStat.isDirectory() || artifactRootStat.isSymbolicLink() || (artifactRootStat.mode & 0o777) !== 0o700
      || (typeof process.getuid === 'function' && artifactRootStat.uid !== process.getuid())) throw new TypeError('representation producer artifactRoot must be one owner-only real directory');
  }
  deploymentRepoId() { return this.policy.repoId; }
  card() {
    return Object.freeze({
      name: PRODUCER_NAME, version: '0.1.0',
      ops: { [OPERATION]: { latency_class: 'interactive', deterministic: true, side_effects: ['source_artifact.write', 'representation_receipt.write', 'coordination.append', 'knowledge.derive'], reverifiable: true, preflight_output: true } },
      mappings: clone(MAP), policyDigest: this.policyDigest,
      authority: { grounding: 'derived_only', edit: false, workerControl: false, route: false, verification: false, merge: false, approval: false, integration: false, publication: false, deployment: false, policyAuthoring: false, proof: false },
    });
  }
  bindRegistry(registry) {
    if (this.registry !== null) throw new TypeError('representation producer registry is already bound');
    if (!registry || !['cards', 'invokeAttested', 'resume', 'reverifyAttested'].every((name) => typeof registry[name] === 'function')) throw new TypeError('representation producer registry bridge is invalid');
    this.registry = registry; return this;
  }
  _registry() { if (!this.registry) throw typed('representation producer registry is unavailable', 'representation_registry_unavailable'); return this.registry; }
  _requestBase(args) {
    const allowed = ['producerKind', 'runId', 'sourceArgs', 'taskId'];
    const sourceFields = args?.producerKind === 'symbol_snapshot' ? ['indexEpoch']
      : args?.producerKind === 'cpg_semantic_delta' ? ['afterPath', 'beforePath', 'impactDepth']
        : ['afterPath', 'beforePath', 'language'];
    if (!record(args) || Object.keys(args).some((key) => !allowed.includes(key)) || !Object.hasOwn(MAP, args.producerKind)
      || typeof args.taskId !== 'string' || !SAFE_ID.test(args.taskId)
      || (args.runId !== undefined && args.runId !== null && (typeof args.runId !== 'string' || !SAFE_ID.test(args.runId)))
      || !record(args.sourceArgs) || !jsonValue(args.sourceArgs)
      || Object.keys(args.sourceArgs).some((key) => !sourceFields.includes(key))) throw typed('representation production request is invalid', 'representation_request_invalid');
    const argumentBytes = bytes(args.sourceArgs);
    if (argumentBytes > this.policy.maxArgumentBytes) throw typed('representation source arguments exceed deployment ceiling', 'representation_oversize');
    const sourceArgs = Object.freeze(clone(args.sourceArgs));
    return Object.freeze({
      taskId: args.taskId, runId: args.runId ?? null, producerKind: args.producerKind, sourceArgs,
      sourceArguments: Object.freeze({ digest: digest({ args: sourceArgs }), bytes: argumentBytes }),
    });
  }
  _request(base, environment) {
    if (base.producerKind === 'symbol_snapshot' && base.sourceArgs.indexEpoch !== environment.indexEpoch) throw typed('SCIP source arguments disagree with the authoritative index environment', 'representation_environment_changed');
    return Object.freeze({
      schemaVersion: 1, repoId: this.policy.repoId, taskId: base.taskId, runId: base.runId,
      producerKind: base.producerKind, sourceArguments: base.sourceArguments,
      environment,
    });
  }
  _card(mapping) {
    const cards = this._registry().cards().filter((card) => card.name === mapping.capability);
    if (cards.length !== 1) throw typed('mapped representation source capability is unavailable', 'representation_source_unavailable');
    const card = cards[0];
    const operation = card.ops?.[mapping.operation];
    if (card.version !== mapping.version || !record(operation) || operation.deterministic !== true
      || operation.latency_class !== 'interactive' || operation.side_effects !== mapping.sideEffects
      || operation.reverifiable !== true || card.actions?.invoke !== true || card.actions?.resume !== true
      || card.actions?.reverify !== true || !card.northbound?.inlineOps?.includes(mapping.operation)
      || card.northbound?.taskOpsRequiringTaskPlane?.includes(mapping.operation)) throw typed('mapped representation source card disagrees with the fixed producer contract', 'representation_source_card_mismatch');
    return Object.freeze({ card, digest: digest(card) });
  }
  _assertDurableCard(mapping, card, production) {
    if (!record(production?.source?.capability)
      || production.source.capability.name !== mapping.capability
      || production.source.capability.version !== mapping.version
      || production.source.capability.cardDigest !== card.digest) {
      throw typed('durable representation source card disagrees with the current fixed producer contract', 'representation_source_card_mismatch');
    }
  }
  async _authorized(ctx, request, action) {
    if (!record(ctx) || ctx.repoId !== this.policy.repoId || typeof ctx.actor !== 'string' || ctx.actor.length === 0 || !SAFE_ID.test(ctx.idempotencyKey ?? '') || !Number.isSafeInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0) throw typed('representation capability context is invalid', 'representation_context_invalid');
    if (ctx.signal?.aborted) throw typed('representation production cancelled', 'cancelled');
    if (await this.authorize(Object.freeze({ action, actor: ctx.actor, repoId: ctx.repoId, transport: ctx.transport ?? null, taskId: request.taskId, runId: request.runId, producerKind: request.producerKind })) !== true) throw typed('representation production is not authorized', 'representation_forbidden');
  }
  async _environment(base, action) {
    return validateEnvironment(base.producerKind, await this.resolveEnvironment(Object.freeze({
      action, repoId: this.policy.repoId, taskId: base.taskId, runId: base.runId,
      producerKind: base.producerKind, sourceArgs: clone(base.sourceArgs),
    })), this.policy.repoId);
  }
  async _confirmEnvironment(base, expected) {
    const current = await this._environment(base, 'confirm');
    if (!same(current, expected)) throw typed('representation environment changed during source production', 'representation_environment_changed');
  }
  _assertSourceEnvironment(base, environment, result) {
    if (base.producerKind !== 'symbol_snapshot') return;
    if (base.sourceArgs.indexEpoch !== environment.indexEpoch
      || result?.provenance?.index_epoch !== environment.indexEpoch
      || (result?.provenance?.overlay_digest ?? null) !== environment.overlayDigest) {
      throw typed('SCIP source result disagrees with its authoritative index environment', 'representation_environment_changed');
    }
  }
  _sourceCtx(ctx, requestDigest, stage, budgetTokens = ctx.budgetTokens) {
    return {
      actor: ctx.actor, repoId: ctx.repoId, budgetTokens, signal: ctx.signal,
      ...(!stage.startsWith('reverify-') ? { idempotencyKey: `representation:${stage}:${digest({ requestDigest })}` } : {}),
      ...(ctx.transport === undefined ? {} : { transport: ctx.transport }),
    };
  }
  _source(mapping, card, invoke, reverify) {
    const result = invoke.result;
    const honestlyResumable = result?.status === 'needs_resume' && card.card.actions?.resume === true
      && typeof result.cursor === 'string' && result.cursor.length > 0;
    if (!record(result) || (result.status !== 'ok' && !honestlyResumable)) throw typed('representation source must produce one complete or honestly resumable non-partial result', result?.status === 'partial' ? 'representation_source_partial' : 'representation_source_incomplete');
    const selected = result.refs.filter((ref) => ref.kind === mapping.artifactKind && ref.mediaType === mapping.mediaType);
    if (result.refs.length > this.policy.maxSourceRefs) throw typed('representation source references exceed deployment ceiling', 'representation_oversize');
    if (selected.length !== 1) throw typed('representation source did not return one exact mapped primary artifact', 'representation_source_ref_invalid');
    const primary = publicRef(selected[0]);
    if (bytes(primary) > this.policy.maxSourceRefBytes) throw typed('representation source reference exceeds deployment ceiling', 'representation_oversize');
    const expectedProjection = stableResultProjection(result); const expectedProjectionDigest = digest(expectedProjection);
    const check = reverify.result?.payload?.[0];
    if (reverify.result?.status !== 'ok' || check?.ok !== true || !same(check.primaryRef, primary)
      || !same(check.resultProjection, expectedProjection) || check.resultProjectionDigest !== expectedProjectionDigest) throw typed('representation source immediate reverify diverged', 'representation_source_diverged');
    return Object.freeze({
      capability: Object.freeze({ name: mapping.capability, version: mapping.version, cardDigest: card.digest }), operation: mapping.operation,
      artifact: primary, resultDigest: digest(result), resultProjectionDigest: expectedProjectionDigest,
      reverifyResultDigest: digest(reverify.result),
    });
  }
  async _probeResume(mapping, invoked, ctx, requestDigest, stage = 'resume-probe') {
    const result = invoked.result;
    if (result?.status !== 'needs_resume') return;
    const primary = result.refs?.filter((ref) => ref.kind === mapping.artifactKind && ref.mediaType === mapping.mediaType) ?? [];
    if (primary.length !== 1) throw typed('resumable representation source lacks one exact primary artifact', 'representation_source_ref_invalid');
    const resumed = await this._registry().resume(mapping.capability, mapping.operation, primary[0], result.cursor, this._sourceCtx(ctx, requestDigest, stage));
    const resumedPrimary = resumed?.refs?.filter((ref) => ref.kind === mapping.artifactKind && ref.mediaType === mapping.mediaType) ?? [];
    if (!record(resumed) || !['ok', 'needs_resume'].includes(resumed.status) || resumedPrimary.length !== 1
      || !same(publicRef(resumedPrimary[0]), publicRef(primary[0]))
      || (resumed.status === 'needs_resume' && resumed.cursor === result.cursor)) {
      throw typed('representation source advertised a non-executable resume contract', 'representation_source_resume_invalid');
    }
  }
  _writeReceipt(receipt, expectedRef, preparedSerialized = null) {
    const serialized = preparedSerialized ?? canonicalText(receipt); const receiptDigest = digest(serialized);
    if (serialized !== canonicalText(receipt)) throw typed('prepared representation receipt serialization is not canonical', 'representation_receipt_integrity');
    if (Buffer.byteLength(serialized) > this.policy.maxReceiptBytes) throw typed('representation receipt exceeds deployment ceiling', 'representation_oversize');
    if (!same(expectedRef, { kind: RECEIPT_KIND, mediaType: RECEIPT_MEDIA, handle: `art:sha256:${receiptDigest}`, digest: receiptDigest, bytes: Buffer.byteLength(serialized) })) throw typed('prepared representation receipt disagrees with exact content bytes', 'representation_receipt_integrity');
    const path = join(this.artifactRoot, `${receiptDigest}.json`);
    if (!existsSync(path)) writeFileSync(path, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    const stat = lstatSync(path); const observed = readFileSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600 || (typeof process.getuid === 'function' && stat.uid !== process.getuid())
      || observed.length !== Buffer.byteLength(serialized) || digest(observed) !== receiptDigest || observed.toString('utf8') !== serialized) throw typed('representation receipt integrity failure', 'representation_receipt_integrity');
    return Object.freeze({ kind: RECEIPT_KIND, mediaType: RECEIPT_MEDIA, handle: `art:sha256:${receiptDigest}`, digest: receiptDigest, bytes: observed.length, path });
  }
  _readReceipt(ref) {
    if (!record(ref) || !HEX.test(ref.digest ?? '') || !Number.isSafeInteger(ref.bytes) || ref.bytes <= 0) throw typed('representation receipt reference is invalid', 'representation_receipt_integrity');
    const path = join(this.artifactRoot, `${ref.digest}.json`); let stat; let observed;
    try { stat = lstatSync(path); observed = readFileSync(path); }
    catch (cause) { const error = typed('representation receipt is unavailable', 'representation_receipt_integrity'); error.cause = cause; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600
      || (typeof process.getuid === 'function' && stat.uid !== process.getuid())
      || observed.length !== ref.bytes || digest(observed) !== ref.digest) throw typed('representation receipt integrity failure', 'representation_receipt_integrity');
    return observed;
  }
  _result(production, receiptRef) {
    const node = production.node ?? {};
    const document = {
      schemaVersion: 1, identityDigest: production.identityDigest, representationId: production.representationId ?? node.id,
      eventSeq: production.eventSeq ?? production.recordedEvent, repoId: production.repoId ?? node.repoId,
      taskId: production.taskId ?? node.taskId, runId: production.runId ?? node.runId ?? null,
      producerKind: production.producerKind ?? node.producerKind, rung: production.rung ?? node.rung,
      representationType: production.representationType ?? node.representationType,
      grounding: 'derived', sourceArtifactDigest: production.source?.artifact?.digest ?? production.sourceArtifactDigest ?? production.sourceArtifact?.digest,
      receiptDigest: receiptRef.digest, policyDigest: this.policyDigest,
      authority: { edit: false, workerControl: false, route: false, verification: false, merge: false, approval: false, integration: false, publication: false, deployment: false, policyAuthoring: false, proof: false },
    };
    const result = { op: OPERATION, status: 'ok', summary: `produced derived ${document.rung} representation for ${document.taskId}`, payload: [document], refs: [publicRef(receiptRef)], cost: { tokens_out: Math.ceil(bytes(document) / 4), wall_ms: 0, usd: 0, underlying: 'baton:cairn-representation-v1' }, provenance: { deterministic: true, repoId: this.policy.repoId, identityDigest: document.identityDigest, representationId: document.representationId, eventSeq: document.eventSeq, policyDigest: this.policyDigest, grounding: 'derived', editAuthority: false, workerAuthority: false, routingMutationAuthority: false, verificationAuthority: false, mergeAuthority: false, approvalAuthority: false, integrationAuthority: false, publicationAuthority: false, deploymentAuthority: false, policyAuthoringAuthority: false, proofAuthority: false } };
    if (result.payload.length > this.policy.maxResultItems || result.refs.length > this.policy.maxResultRefs
      || bytes(result) > this.policy.maxResultBytes) throw typed('representation result exceeds deployment ceiling', 'representation_oversize');
    return Object.freeze(result);
  }
  _preflightResult(result, ctx) {
    const policy = ctx?.aciOutputPolicy;
    if (!record(policy) || !Number.isSafeInteger(policy.maxEnvelopeBytes) || policy.maxEnvelopeBytes <= 0
      || !Number.isSafeInteger(policy.maxPayloadBytes) || policy.maxPayloadBytes <= 0) throw typed('representation producer requires registry output preflight authority', 'representation_preflight_unavailable');
    if (Buffer.byteLength(JSON.stringify(result)) > policy.maxEnvelopeBytes
      || Buffer.byteLength(JSON.stringify(result.payload)) > policy.maxPayloadBytes) throw typed('representation result exceeds the admitted ACI output envelope', 'capability_result_oversize');
  }
  async invoke(op, args, ctx) {
    if (op !== OPERATION) throw typed('unsupported representation producer operation', 'unsupported_op');
    const base = this._requestBase(args); await this._authorized(ctx, base, 'produce');
    const environment = await this._environment(base, 'produce'); const request = this._request(base, environment);
    const auth = { actor: ctx.actor, key: `representation:${digest({ repoId: ctx.repoId, actor: ctx.actor, idempotencyKey: ctx.idempotencyKey })}` };
    const mapping = MAP[request.producerKind]; const card = this._card(mapping);
    const admission = this.coordination.representationProductionAdmission(request, auth);
    if (admission?.representation) {
      this._assertDurableCard(mapping, card, admission.representation);
      this.coordination.reverifyRepresentationProduction(admission.representation.identityDigest);
      this._readReceipt(admission.representation.receiptRef);
      return this._result(admission.representation, admission.representation.receiptRef);
    }
    const requestDigest = admission.requestDigest;
    // Reverify returns the stable source-result projection inside its own bounded ACI payload.
    // Reserve half of the caller's byte-derived token budget for that echoed projection instead
    // of letting the source fill the entire envelope and making honest resumability unverifiable.
    const invokeBudgetTokens = Math.max(1, Math.floor(ctx.budgetTokens / 2));
    const invoked = await this._registry().invokeAttested(mapping.capability, mapping.operation, clone(base.sourceArgs), this._sourceCtx(ctx, requestDigest, 'invoke', invokeBudgetTokens));
    this._assertSourceEnvironment(base, environment, invoked.result); await this._probeResume(mapping, invoked, ctx, requestDigest);
    const reverified = await this._registry().reverifyAttested(mapping.capability, mapping.operation, invoked.result, clone(base.sourceArgs), this._sourceCtx(ctx, requestDigest, 'reverify'));
    const source = this._source(mapping, card, invoked, reverified);
    await this._confirmEnvironment(base, environment);
    const fields = { request, requestDigest, source, evidence: { invoke: terminalEvidence(invoked), reverify: terminalEvidence(reverified) } };
    if (bytes(fields) > this.policy.maxGraphBatchBytes) throw typed('representation graph batch exceeds deployment ceiling', 'representation_oversize');
    const prepared = this.coordination.prepareRepresentationProduction(fields, auth);
    this._preflightResult(this._result({ ...prepared.projection, eventSeq: prepared.eventSeq }, prepared.receiptRef), ctx);
    const receiptRef = this._writeReceipt(prepared.receipt, prepared.receiptRef, prepared.receiptSerialized);
    const recorded = this.coordination.recordRepresentationProduction(fields, publicRef(receiptRef), auth);
    return this._result(recorded.representation, recorded.representation.receiptRef);
  }
  async reverify(claim, op, args, ctx) {
    if (op !== OPERATION || !record(claim?.payload?.[0]) || !HEX.test(claim.payload[0].identityDigest ?? '')) return Object.freeze({ ok: false, code: 'representation_claim_invalid' });
    const base = this._requestBase(args); await this._authorized(ctx, base, 'reverify');
    const environment = await this._environment(base, 'reverify'); const request = this._request(base, environment);
    const durable = this.coordination.representationProduction(claim.payload[0].identityDigest); if (!durable) return Object.freeze({ ok: false, code: 'representation_missing' });
    if (durable.repoId !== request.repoId || durable.taskId !== request.taskId || durable.runId !== request.runId
      || durable.producerKind !== request.producerKind || durable.receipt?.sourceArgumentsDigest !== request.sourceArguments.digest
      || !same(durable.receipt?.environment, request.environment) || durable.policyDigest !== this.policyDigest) return Object.freeze({ ok: false, code: 'representation_request_diverged' });
    const expectedClaim = this._result(durable, durable.receiptRef);
    if (!same(claim, expectedClaim)) return Object.freeze({ ok: false, code: 'representation_claim_invalid' });
    const mapping = MAP[request.producerKind]; const card = this._card(mapping);
    const invokeBudgetTokens = Math.max(1, Math.floor(ctx.budgetTokens / 2));
    const invoked = await this._registry().invokeAttested(mapping.capability, mapping.operation, clone(base.sourceArgs), this._sourceCtx(ctx, durable.requestDigest, 'reverify-invoke', invokeBudgetTokens));
    this._assertSourceEnvironment(base, environment, invoked.result); await this._probeResume(mapping, invoked, ctx, durable.requestDigest, 'reverify-resume-probe');
    const reverified = await this._registry().reverifyAttested(mapping.capability, mapping.operation, invoked.result, clone(base.sourceArgs), this._sourceCtx(ctx, durable.requestDigest, 'reverify-source'));
    const source = this._source(mapping, card, invoked, reverified);
    await this._confirmEnvironment(base, environment);
    const checked = this.coordination.reverifyRepresentationProduction(durable.identityDigest, source);
    const receiptPath = join(this.artifactRoot, `${durable.receiptRef.digest}.json`); let receiptBytes;
    try { receiptBytes = this._readReceipt(durable.receiptRef); } catch { return Object.freeze({ ok: false, code: 'representation_receipt_integrity' }); }
    const ok = checked?.ok === true && digest(receiptBytes) === durable.receiptRef.digest && receiptBytes.length === durable.receiptRef.bytes
      && same(claim, this._result(durable, { ...durable.receiptRef, path: receiptPath }));
    return Object.freeze({ ok, identityDigest: durable.identityDigest, representationId: durable.representationId, sourceResultProjectionDigest: source.resultProjectionDigest, receiptDigest: durable.receiptRef.digest, graphProjectionDigest: checked?.projection?.graphDigest ?? null });
  }
  async replay(op, claim, args, ctx) {
    const checked = await this.reverify(claim, op, args, ctx);
    if (checked?.ok !== true) throw typed('completed representation replay failed current integrity checks', checked?.code ?? 'representation_replay_diverged');
    return claim;
  }
  async reconcile(op, args, ctx) {
    if (op !== OPERATION || !record(args) || !Object.hasOwn(MAP, args.producerKind)) return null;
    const base = this._requestBase(args); await this._authorized(ctx, base, 'reconcile');
    const environment = await this._environment(base, 'reconcile'); const request = this._request(base, environment);
    const auth = { actor: ctx.actor, key: `representation:${digest({ repoId: ctx.repoId, actor: ctx.actor, idempotencyKey: ctx.idempotencyKey })}` };
    const mapping = MAP[request.producerKind]; const card = this._card(mapping);
    const admitted = this.coordination.representationProductionAdmission(request, auth);
    const production = admitted?.representation ?? this.coordination.representationProductionByRequest(admitted?.requestDigest);
    if (!production || this.coordination.reverifyRepresentationProduction(production.identityDigest)?.ok !== true) return null;
    this._assertDurableCard(mapping, card, production);
    const receipt = production.receiptRef; if (!receipt || !HEX.test(receipt.digest ?? '')) return null;
    try { this._readReceipt(receipt); } catch { return null; }
    return this._result(production, receipt);
  }
}
