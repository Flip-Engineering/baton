import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';

const PROTOCOL_VERSION = '2025-11-25';
const CAPABILITY = Object.freeze({
  fleet_spawn: 'control', fleet_send: 'control', fleet_wait: 'observe', fleet_respond: 'approve',
  fleet_interrupt: 'control', fleet_result: 'observe', fleet_list: 'observe', fleet_kill: 'emergency_stop',
});
const STATEFUL = new Set(['fleet_spawn', 'fleet_send', 'fleet_respond', 'fleet_interrupt', 'fleet_kill']);
const FENCED = new Set(['fleet_send', 'fleet_interrupt', 'fleet_kill']);
const FORBIDDEN_KEY = /^(?:access[_-]?token|refresh[_-]?token|token|secret|credential|password|api[_-]?key|authorization|userId|sessionId|capabilities|repoIds)$/i;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,256}$/;

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function nonempty(value) { return typeof value === 'string' && value.length > 0; }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!record(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function hash(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function containsForbidden(value) {
  if (Array.isArray(value)) return value.some(containsForbidden);
  if (!record(value)) return false;
  return Object.entries(value).some(([key, child]) => FORBIDDEN_KEY.test(key) || containsForbidden(child));
}
function normalized(value) { return value === undefined ? null : clone(value); }
function toolResult(value, isError = false) {
  const normalizedValue = normalized(value);
  const structuredContent = record(normalizedValue) ? normalizedValue : { result: normalizedValue };
  return Object.freeze({ content: Object.freeze([{ type: 'text', text: JSON.stringify(structuredContent) }]), structuredContent: Object.freeze(structuredContent), isError });
}
function toolError(code) { return toolResult({ ok: false, error: { code } }, true); }
function protocolResult(id, result) { return { jsonrpc: '2.0', id, result }; }
function protocolError(id, code, message, data) {
  if (id === undefined) return null;
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}
function schema(properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}
const text = { type: 'string', minLength: 1 };
const repo = { repoId: text };
const idem = { idempotencyKey: { type: 'string', minLength: 1, maxLength: 256, pattern: '^[A-Za-z0-9._:-]+$' } };
const fence = { expectedFence: { type: 'integer' } };
const TOOL_DEFINITIONS = Object.freeze([
  { name: 'fleet_spawn', description: 'Spawn one Baton worker with independently selected harness, model, and effort.', inputSchema: schema({ ...repo, ...idem, harness: text, model: text, effort: text, modelPolicy: { type: 'object' }, brief: { type: 'object' }, taskId: text, deps: { type: 'array', items: text }, taskType: text, session: { type: 'object' }, refines: text }, ['repoId', 'idempotencyKey', 'harness', 'brief']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_send', description: 'Send a turn, steer, or nudge to a fenced worker.', inputSchema: schema({ ...repo, ...idem, ...fence, workerId: text, message: text, mode: { type: 'string', enum: ['turn', 'steer', 'nudge'] } }, ['repoId', 'idempotencyKey', 'expectedFence', 'workerId', 'message', 'mode']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_wait', description: 'Wait for fleet events for at most the host-safe bounded interval.', inputSchema: schema({ ...repo, timeoutMs: { type: 'integer', minimum: 0 } }, ['repoId']), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_respond', description: 'Answer one pending approval or question.', inputSchema: schema({ ...repo, ...idem, requestId: text, answer: {} }, ['repoId', 'idempotencyKey', 'requestId', 'answer']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_interrupt', description: 'Interrupt a fenced worker, optionally with a follow-up instruction.', inputSchema: schema({ ...repo, ...idem, ...fence, workerId: text, then: text }, ['repoId', 'idempotencyKey', 'expectedFence', 'workerId']), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_result', description: 'Read the current or terminal result for one worker.', inputSchema: schema({ ...repo, workerId: text }, ['repoId', 'workerId']), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_list', description: 'List workers visible to the injected repository authority.', inputSchema: schema({ ...repo }, ['repoId']), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_kill', description: 'Kill and reap one fenced worker.', inputSchema: schema({ ...repo, ...idem, ...fence, workerId: text }, ['repoId', 'idempotencyKey', 'expectedFence', 'workerId']), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
].map((tool) => Object.freeze({ ...tool, execution: Object.freeze({ taskSupport: 'forbidden' }) })));
const TOOL_BY_NAME = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));

function validateArguments(name, args) {
  if (!record(args)) return 'invalid_arguments';
  const schemaDefinition = TOOL_BY_NAME.get(name).inputSchema;
  if (Object.keys(args).some((key) => !Object.hasOwn(schemaDefinition.properties, key))) return 'unknown_argument_field';
  if (schemaDefinition.required.some((key) => !Object.hasOwn(args, key))) return 'missing_argument';
  if (containsForbidden(args)) return 'credential_fields_forbidden';
  if (!nonempty(args.repoId)) return 'invalid_repo';
  if (STATEFUL.has(name) && !SAFE_ID.test(args.idempotencyKey ?? '')) return 'invalid_idempotency_key';
  if (FENCED.has(name) && !Number.isSafeInteger(args.expectedFence)) return 'expected_fence_required';
  if (name === 'fleet_spawn') {
    if (!nonempty(args.harness) || !record(args.brief)) return 'invalid_spawn';
    if (Object.hasOwn(args, 'model') && !nonempty(args.model)) return 'invalid_model';
    if (Object.hasOwn(args, 'effort') && !nonempty(args.effort)) return 'invalid_effort';
    if (Object.hasOwn(args, 'modelPolicy') && !record(args.modelPolicy)) return 'invalid_model_policy';
    if (Object.hasOwn(args, 'deps') && (!Array.isArray(args.deps) || !args.deps.every(nonempty))) return 'invalid_dependencies';
  }
  if (['fleet_send', 'fleet_interrupt', 'fleet_result', 'fleet_kill'].includes(name) && !nonempty(args.workerId)) return 'invalid_worker';
  if (name === 'fleet_send' && (!nonempty(args.message) || !['turn', 'steer', 'nudge'].includes(args.mode))) return 'invalid_send';
  if (name === 'fleet_respond' && !nonempty(args.requestId)) return 'invalid_request';
  if (name === 'fleet_wait' && Object.hasOwn(args, 'timeoutMs') && (!Number.isSafeInteger(args.timeoutMs) || args.timeoutMs < 0)) return 'invalid_timeout';
  return null;
}

export class McpFleetServer {
  constructor(opts) {
    if (!opts?.coordinator || !opts?.coordination || !record(opts.principal)) throw new TypeError('MCP northbound requires coordinator, coordination, and injected principal');
    for (const method of ['admitMcpCall', 'completeMcpCall', 'failMcpCall', 'mcpCall', 'recordMcpAudit']) {
      if (typeof opts.coordination[method] !== 'function') throw new TypeError(`coordination authority is missing ${method}()`);
    }
    if (typeof opts.takeToolQuota !== 'function') throw new TypeError('MCP northbound requires an injected tool quota authority');
    this.coordinator = opts.coordinator;
    this.coordination = opts.coordination;
    this.principal = Object.freeze(clone(opts.principal));
    this.repoIds = new Set(opts.repoIds ?? []);
    this.now = opts.now ?? Date.now;
    this.maxWaitMs = opts.maxWaitMs ?? 25_000;
    this.takeToolQuota = opts.takeToolQuota;
    if (!Number.isSafeInteger(this.maxWaitMs) || this.maxWaitMs <= 0) throw new TypeError('maxWaitMs must be a positive safe integer');
    this.initialized = false;
  }

  callScope(tool, args) {
    return hash({ channel: 'mcp', userId: this.principal.userId, tool, repoId: args.repoId, idempotencyKey: args.idempotencyKey });
  }

  callDigest(args) {
    const { idempotencyKey: _key, ...semantic } = args;
    return hash(semantic);
  }

  _authority(name, args) {
    const p = this.principal;
    const expiresAt = Date.parse(p.expiresAt);
    if (!nonempty(p.userId) || !nonempty(p.sessionId) || p.revoked === true || !Number.isFinite(expiresAt) || expiresAt <= this.now()) return 'unauthenticated';
    if (!Array.isArray(p.capabilities) || !p.capabilities.includes(CAPABILITY[name])) return 'forbidden';
    if (!this.repoIds.has(args.repoId) || !Array.isArray(p.repoIds) || !p.repoIds.includes(args.repoId)) return 'forbidden';
    return null;
  }

  _audit(kind, tool, args, detail = null) {
    return this.coordination.recordMcpAudit({
      kind, tool, userId: this.principal.userId, sessionId: this.principal.sessionId,
      repoId: nonempty(args?.repoId) ? args.repoId : null, detail,
    }, { actor: `mcp:${this.principal.userId}:${this.principal.sessionId}`, key: `mcp.audit:${randomUUID()}` });
  }

  async handle(message) {
    if (!record(message) || message.jsonrpc !== '2.0' || !nonempty(message.method)) return protocolError(message?.id ?? null, -32600, 'Invalid Request');
    const { id, method, params } = message;
    if (method === 'initialize') {
      if (id === undefined || !record(params) || !nonempty(params.protocolVersion) || !record(params.capabilities) || !record(params.clientInfo)) return protocolError(id, -32602, 'Invalid params');
      this.initialized = true;
      return protocolResult(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'baton', version: '0.1.0' } });
    }
    if (method === 'notifications/initialized') return id === undefined ? null : protocolError(id, -32600, 'Invalid Request');
    if (method === 'ping') return id === undefined ? null : protocolResult(id, {});
    if (!this.initialized) return protocolError(id, -32002, 'Server not initialized');
    if (method === 'tools/list') return id === undefined ? null : protocolResult(id, { tools: TOOL_DEFINITIONS.map(clone) });
    if (method !== 'tools/call') return protocolError(id, -32601, 'Method not found');
    if (id === undefined || !record(params) || !nonempty(params.name) || !TOOL_BY_NAME.has(params.name)) return protocolError(id, -32602, 'Invalid params');
    const args = params.arguments ?? {};
    const invalid = validateArguments(params.name, args);
    if (invalid) {
      try { this._audit('tool_invalid', params.name, args, invalid); } catch { return protocolResult(id, toolError('temporarily_unavailable')); }
      return protocolResult(id, toolError(invalid));
    }
    const refused = this._authority(params.name, args);
    if (refused) {
      try { this._audit('tool_refused', params.name, args, refused); } catch { return protocolResult(id, toolError('temporarily_unavailable')); }
      return protocolResult(id, toolError(refused));
    }
    let quota;
    try { quota = this.takeToolQuota({ userId: this.principal.userId, sessionId: this.principal.sessionId, tool: params.name, repoId: args.repoId }); }
    catch { return protocolResult(id, toolError('temporarily_unavailable')); }
    if (!quota?.ok) {
      try { this._audit('tool_rate_limited', params.name, args); } catch { return protocolResult(id, toolError('temporarily_unavailable')); }
      return protocolResult(id, toolError('rate_limited'));
    }
    return protocolResult(id, await this._callTool(params.name, args));
  }

  async _callTool(name, args) {
    if (!STATEFUL.has(name)) {
      try {
        const outcome = toolResult(await this._dispatch(name, args));
        this._audit('tool_completed', name, args);
        return outcome;
      } catch {
        try { this._audit('tool_failed', name, args, 'command_failed'); }
        catch { return toolError('temporarily_unavailable'); }
        return toolError('command_failed');
      }
    }
    const callId = randomUUID();
    const scopeKey = this.callScope(name, args);
    const actor = `mcp:${this.principal.userId}:${this.principal.sessionId}`;
    let admission;
    try {
      admission = this.coordination.admitMcpCall({ callId, scopeKey, requestDigest: this.callDigest(args), tool: name, repoId: args.repoId, userId: this.principal.userId }, { actor, key: `mcp.admit:${scopeKey}` });
    } catch { return toolError('temporarily_unavailable'); }
    if (!admission.ok) return toolError(admission.result === 'idempotency_conflict' ? 'idempotency_conflict' : 'invalid_call');
    if (admission.result === 'replay') return admission.call.status === 'admitted' ? toolError('call_admitted') : clone(admission.call.outcome);
    let outcome;
    try { outcome = toolResult(await this._dispatch(name, args, actor, callId)); }
    catch {
      outcome = toolError('command_failed');
      try { this.coordination.failMcpCall(callId, outcome, { actor, key: `mcp.fail:${callId}` }); }
      catch { return toolError('temporarily_unavailable'); }
      return outcome;
    }
    try { this.coordination.completeMcpCall(callId, outcome, { actor, key: `mcp.complete:${callId}` }); }
    catch { return toolError('temporarily_unavailable'); }
    return outcome;
  }

  async _dispatch(name, args, actor, callId) {
    let value;
    if (name === 'fleet_spawn') value = await this.coordinator.spawn(args.harness, args.brief, {
      model: args.model, effort: args.effort, modelPolicy: args.modelPolicy, taskId: args.taskId ?? `mcp-${callId}`,
      deps: args.deps, taskType: args.taskType, session: args.session, refines: args.refines,
      actor, idempotencyKey: `mcp.call:${callId}`,
    });
    else if (name === 'fleet_send') value = await this.coordinator.send(args.workerId, args.message, args.mode, { expectedFence: args.expectedFence });
    else if (name === 'fleet_wait') value = await this.coordinator.wait(Math.min(args.timeoutMs ?? this.maxWaitMs, this.maxWaitMs));
    else if (name === 'fleet_respond') value = await this.coordinator.respond(args.requestId, args.answer, actor);
    else if (name === 'fleet_interrupt') value = await this.coordinator.interrupt(args.workerId, args.then, actor, { expectedFence: args.expectedFence });
    else if (name === 'fleet_result') value = await this.coordinator.result(args.workerId);
    else if (name === 'fleet_list') value = this.coordinator.list();
    else if (name === 'fleet_kill') value = await this.coordinator.kill(args.workerId, actor, { expectedFence: args.expectedFence });
    if (value?.result === 'stale_fence') throw new Error('stale fence');
    return normalized(value);
  }
}

async function writeFrame(output, frame) {
  if (frame === null) return;
  if (!output.write(`${JSON.stringify(frame)}\n`)) await once(output, 'drain');
}

export async function serveMcpStdio(server, opts = {}) {
  if (!(server instanceof McpFleetServer)) throw new TypeError('serveMcpStdio requires McpFleetServer');
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const maxLineBytes = opts.maxLineBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes <= 0) throw new TypeError('maxLineBytes must be a positive safe integer');
  let buffered = Buffer.alloc(0);
  let discardingOversize = false;
  const processLine = async (line, oversized = false) => {
    if (oversized || line.length > maxLineBytes) return writeFrame(output, protocolError(null, -32700, 'Parse error'));
    let message;
    try { message = JSON.parse(line.toString('utf8')); } catch { return writeFrame(output, protocolError(null, -32700, 'Parse error')); }
    if (Array.isArray(message)) return writeFrame(output, protocolError(null, -32600, 'Invalid Request'));
    return writeFrame(output, await server.handle(message));
  };
  for await (const chunk of input) {
    const bytes = Buffer.from(chunk);
    let offset = 0;
    while (offset < bytes.length) {
      const newline = bytes.indexOf(0x0a, offset);
      if (discardingOversize) {
        if (newline === -1) break;
        await processLine(Buffer.alloc(0), true);
        discardingOversize = false;
        offset = newline + 1;
        continue;
      }
      if (newline === -1) {
        const tail = bytes.subarray(offset);
        if (buffered.length + tail.length > maxLineBytes) {
          buffered = Buffer.alloc(0);
          discardingOversize = true;
        } else buffered = Buffer.concat([buffered, tail]);
        break;
      }
      const segment = bytes.subarray(offset, newline);
      if (buffered.length + segment.length > maxLineBytes) await processLine(Buffer.alloc(0), true);
      else {
        let line = buffered.length === 0 ? segment : Buffer.concat([buffered, segment]);
        if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
        await processLine(line);
      }
      buffered = Buffer.alloc(0);
      offset = newline + 1;
    }
  }
  if (discardingOversize) await processLine(Buffer.alloc(0), true);
  if (buffered.length > 0) await processLine(buffered);
}
