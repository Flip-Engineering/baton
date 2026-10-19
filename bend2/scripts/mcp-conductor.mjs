#!/usr/bin/env node
// Bend2 Channels MCP Conductor adapter.
//
// A minimal MCP server bridging the Bend2 coordinator's SQLite database to
// Claude Code's Channels protocol. A Conductor loads it with:
//   --mcp-config <config.json>
//   --dangerously-load-development-channels server:baton-conductor
//
// Usage: node bend2/scripts/mcp-conductor.mjs <database-path> [coordinator-executable]
//
// The server reads pending Conductor messages from the coordinator's database and
// delivers them as notifications/claude/channel. Tool calls delegate to the
// coordinator executable for mutations. No npm dependencies; node stdlib only.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { createServer, createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

function hasParent(session) {
  return session?.parent !== null && session?.parent !== undefined;
}

const positional = [];
let sessionId = 'root';
let delivery = null;
let inputWitness = null;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--session') {
    sessionId = process.argv[++i];
    if (sessionId === undefined) throw new Error('--session requires a session ID');
  } else if (arg === '--deliver') {
    delivery = { socket: process.argv[++i], message: process.argv[++i] };
    if (!delivery.socket || !delivery.message) throw new Error('--deliver requires a socket and committed message ID');
  } else if (arg === '--input-witness') {
    inputWitness = process.argv[++i];
    if (inputWitness === undefined) throw new Error('--input-witness requires the connected input context');
  } else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
  else positional.push(arg);
}
const dbPath = positional[0] ? resolve(positional[0]) : null;
const installed = resolve(ROOT, 'bin/baton2');
const coordinatorExe = resolve(positional[1] || (existsSync(installed) ? installed : resolve(ROOT, '.scratch/bend2/baton2')));

if (!dbPath) {
  process.stderr.write('usage: mcp-conductor.mjs <database-path> [coordinator-executable] [--session ID]\n');
  process.exit(1);
}

function processFacts(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('The connected process PID is invalid.');
  if (process.platform === 'linux') {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    if (fields[0] === 'Z' || fields[0] === 'X') throw new Error('The connected process has ended.');
    return { pid, parent: Number(fields[1]), birth: fields[19],
      executable: realpathSync(`/proc/${pid}/exe`),
      argv: readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean) };
  }
  if (process.platform === 'darwin') {
    const line = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'ppid=', '-o', 'lstart=', '-o', 'stat='],
      { encoding: 'utf8', maxBuffer: Infinity }).trim();
    const found = /^(\d+)\s+(.+?)\s+(\S+)$/.exec(line);
    if (!found || found[3].startsWith('Z')) throw new Error('The connected process has ended.');
    const command = execFileSync('/bin/ps', ['-ww', '-p', String(pid), '-o', 'command='],
      { encoding: 'utf8', maxBuffer: Infinity }).replace(/\n$/, '');
    return { pid, parent: Number(found[1]), birth: found[2], command };
  }
  throw new Error('Connected Claude input custody is supported on Linux and macOS.');
}

function processIdentity(facts) {
  return { pid: facts.pid, parent: facts.parent, birth: facts.birth };
}

function sameProcess(actual, expected) {
  return actual.pid === expected?.pid && actual.parent === expected.parent && actual.birth === expected.birth;
}

function nativeSelector(facts) {
  if (facts.argv) {
    for (let i = 1; i < facts.argv.length; i++) {
      if (facts.argv[i] === '--session-id' || facts.argv[i] === '--resume') {
        return facts.argv[i + 1] ?? '';
      }
      for (const flag of ['--session-id=', '--resume=']) {
        if (facts.argv[i].startsWith(flag)) return facts.argv[i].slice(flag.length);
      }
    }
    return null;
  }
  return /(?:^|\s)--(?:session-id|resume)(?:=|\s+)([^\s]+)/.exec(facts.command)?.[1] ?? null;
}

async function connectedInputWitness(encoded) {
  const context = JSON.parse(encoded);
  const database = realpathSync(dbPath);
  const coordinator = realpathSync(coordinatorExe);
  if (context.database !== database || context.coordinator !== coordinator || context.session !== sessionId
      || typeof context.connection !== 'string' || !context.connection || !context.ready
      || typeof context.native !== 'string' || !context.native) {
    throw new Error('The connected input context does not match this database, actor and native conversation.');
  }
  const caller = processFacts(process.ppid);
  const bridge = processFacts(caller.parent);
  const client = processFacts(bridge.parent);
  if (!sameProcess(bridge, context.bridge) || !sameProcess(client, context.client)
      || (caller.executable && caller.executable !== coordinator)) {
    throw new Error('The input action is outside its live coordinator, MCP bridge and native client ancestry.');
  }
  if (context.socket !== `conductor-${bridge.pid}-${context.connection}.sock`) {
    throw new Error('The registered connection socket belongs to a different MCP process.');
  }
  const selectedNative = nativeSelector(client);
  if (selectedNative !== null && selectedNative !== context.native) {
    throw new Error('The native client session selector differs from the recorded conversation.');
  }
  const { DatabaseSync } = await import('node:sqlite');
  const connection = new DatabaseSync(database, { readOnly: true });
  try {
    let selected, stopped;
    for (;;) {
      try {
        selected = connection.prepare('SELECT native,harness,endpoint FROM sessions WHERE id=?').get(sessionId);
        stopped = connection.prepare('SELECT 1 FROM session_stops WHERE session=?').get(sessionId);
        break;
      } catch (error) {
        if (!Number.isInteger(error?.errcode) || (error.errcode & 255) !== 5) throw error;
        process.stderr.write(JSON.stringify({ type: 'mcpInputWitnessDatabaseBusy', session: sessionId,
          errcode: error.errcode, cause: error.message }) + '\n');
        execFileSync(coordinatorExe, [dbPath, 'session', sessionId], { encoding: 'utf8', maxBuffer: Infinity });
      }
    }
    if (!selected || selected.harness !== 'claude-code' || selected.native !== context.native
        || selected.endpoint !== context.endpoint || stopped) {
      throw new Error('The connected input context is no longer the active recipient endpoint and native conversation.');
    }
    const endpoint = JSON.parse(selected.endpoint);
    if (JSON.stringify(endpoint) !== JSON.stringify([process.execPath, fileURLToPath(import.meta.url),
      database, coordinator, '--session', sessionId, '--deliver', context.socket])) {
      throw new Error('The registered endpoint does not identify this exact connected MCP helper.');
    }
    process.stdout.write(JSON.stringify({ active: true, session: sessionId, native: selected.native,
      endpoint: selected.endpoint, attempt: `claude-mcp:${context.connection}`,
      identity: JSON.stringify(['claude-mcp', selected.native, context.connection,
        bridge.pid, bridge.birth, client.pid, client.birth]) }) + '\n');
  } finally { connection.close(); }
}

if (inputWitness !== null) {
  try { await connectedInputWitness(inputWitness); }
  catch (error) {
    process.stderr.write(JSON.stringify({ error: 'handling-context', condition: error.message }) + '\n');
    process.exitCode = 2;
  }
  process.exit(process.exitCode ?? 0);
}

// The report writer calls this one-shot client for the attached channel endpoint.
if (delivery) {
  const socketName = delivery.socket;
  const messageId = delivery.message;
  process.chdir(dirname(resolve(dbPath)));
  await new Promise((done, fail) => {
    const client = createConnection(socketName);
    let answer = '';
    client.on('connect', () => client.end(JSON.stringify(messageId) + '\n'));
    client.on('data', (chunk) => { answer += chunk; });
    client.on('error', fail);
    client.on('end', () => answer === 'ok\n' ? done() : fail(new Error(answer)));
  });
  process.exit(0);
}

function coordinatorSurface() {
  const help = spawnSync(coordinatorExe, ['--help'], { encoding: 'utf8', maxBuffer: Infinity });
  return String(help.stdout ?? '') + String(help.stderr ?? '');
}

const commandSurface = coordinatorSurface();
const batchMessaging = ['outbox', 'delivery-batch', 'message-batch'].every((name) => commandSurface.includes(name));
const inputDetail = commandSurface.includes('input MESSAGE_ID');
const contextualActions = /baton2? as SESSION ACTION/.test(commandSurface);
const replInput = contextualActions && /^Actions:.*\brepl\b/m.test(commandSurface);
const contextEval = contextualActions && commandSurface.includes('context engines|install|query|eval|result');
const nativeAttachmentInput = commandSurface.includes('native-attachment-input');
const dispatchInput = commandSurface.includes('dispatch --stdin');
const taskInput = dispatchInput || commandSurface.includes('task --stdin');
const batchMessageTools = new Set([
  'baton2_delivery_batch',
  'baton2_outbox',
  'baton2_message_batch',
]);
const unavailableTools = new Set([
  ...(!batchMessaging ? batchMessageTools : []),
  ...(!inputDetail ? ['baton2_input'] : []),
  ...(!dispatchInput ? ['baton2_dispatch'] : []),
  ...(!taskInput ? ['baton2_task'] : []),
  ...(!contextualActions ? ['baton2_action'] : []),
  ...(!replInput ? ['baton2_repl'] : []),
  ...(!contextEval ? ['baton2_context_eval'] : []),
]);

function messageInstructions() {
  if (contextualActions) {
    return `Use ${dispatchInput ? 'baton2_dispatch' : 'baton2_task'} for complete task text or a UTF-8 file, with to or session selecting an existing conversation. Baton preserves its current assignment automatically. Dispatch input and setup outcomes are stored in the database. Use baton2_action for the contextual native actions: inbox, read, send, completion-request, completion-confirmed, guide, acknowledge and domain help. The attached session supplies actor identity. Pass action and its named argument tokens; use action:help with the domain name for usage. Complete action argument strings travel directly through JSON standard input to native admission. Multi-message reads, independent sends and explicit acknowledgements return each item outcome. Successful recipient turns record handling of complete inputs; failed turns retain unfinished handling. Baton generates mutation identities and selects current owned input, receipts and completion requests. Use acknowledge without identifiers after handling input, and completion-confirmed with an optional recipient. Task completion and coordinator decisions remain separate recorded actions.` +
      (replInput ? ' Use baton2_repl for Bend2 define, eval, bind, read, recover, share and import operations; the packaged compiler checks types and affine use and each result retains complete output and process outcomes.' : '');
  }
  const messaging = batchMessaging
    ? 'Use baton2_inbox or baton2_pending to see pending messages, and baton2_outbox to inspect authored messages and receipts. Their optional index:true argument returns metadata; baton2_delivery and baton2_delivery_batch read selected complete messages. Use baton2_ack to acknowledge your own fully read and handled input; retain unfinished work in your reports and project state. Use baton2_guide or baton2_message_batch to direct recipients. Each batch item keeps its own admission, wake, retained message and receipt facts.'
    : 'Use baton2_inbox or baton2_pending to see pending messages. Their optional index:true argument returns metadata. baton2_delivery reads one complete stored message and its receipt. Use baton2_ack to acknowledge your own fully read and handled input; retain unfinished work in your reports and project state. Use baton2_guide to direct one recipient.';
  return messaging + (inputDetail
    ? ' baton2_input relates one stored message to its admission, recipient-owned receipt, current recipient state and available attempt evidence.'
    : '');
}

// node:sqlite (Node 22+)
const { DatabaseSync } = await import('node:sqlite');

// MCP stdio carries one JSON-RPC message per line.
function writeMessage(msg) {
  const body = JSON.stringify(msg);
  process.stdout.write(body + '\n');
}

function sendResponse(id, result) {
  writeMessage({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  writeMessage({ jsonrpc: '2.0', id, error: { code, message } });
}

function sendNotification(method, params) {
  writeMessage({ jsonrpc: '2.0', method, params });
}

// Claude Code sends newline-delimited initialization and tool requests.
let inputBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  inputBuffer += chunk;
  let newline;
  while ((newline = inputBuffer.indexOf('\n')) !== -1) {
    const body = inputBuffer.slice(0, newline);
    inputBuffer = inputBuffer.slice(newline + 1);
    if (!body.trim()) continue;
    try {
      handleMessage(JSON.parse(body));
    } catch (error) {
      process.stderr.write(`mcp-conductor: parse error: ${error.message}\n`);
    }
  }
});

process.stdin.on('end', () => {
  channelReady = false;
  connectionCustody = null;
  deliveryServer?.close();
  if (db) { try { db.close(); } catch {} db = null; }
});

// Coordinator CLI helper.
function coord(...args) {
  return coordInput(undefined, ...args);
}

function coordInput(input, ...args) {
  return coordInputRaw(input, ...args).trim();
}

function coordInputRaw(input, ...args) {
  try {
    return execFileSync(coordinatorExe, [dbPath, ...args], {
      encoding: 'utf8', input, maxBuffer: Infinity,
      env: { ...process.env, BATON_SESSION: sessionId, BATON_DATABASE: dbPath,
        BATON_MCP_INPUT: channelReady && connectionCustody
          ? JSON.stringify({ ...connectionCustody, ready: true }) : '' },
    });
  } catch (error) {
    const status = Number.isInteger(error.status) ? `\nexit code: ${error.status}` : '';
    error.message += `${status}\nstdout:\n${error.stdout ?? ''}\nstderr:\n${error.stderr ?? ''}`;
    throw error;
  }
}

const messageIndexProperties = {
  index: { type: 'boolean', description: 'Return ordered message metadata; filters select this output automatically' },
  sender: { type: 'string', description: 'Match a literal sender ID' },
  kind: { type: 'string', description: 'Match a literal message kind' },
  state: { type: 'string', enum: ['pending', 'acknowledged', 'all'], description: 'Receipt state (default: pending)' },
  afterSeq: { type: 'string', description: 'Exclusive integer sequence bound, kept as text for exact integer comparisons' },
  throughSeq: { type: 'string', description: 'Inclusive integer sequence bound, kept as text for exact integer comparisons' },
  pretty: { type: 'boolean', description: 'Pretty-print the JSON result' },
};

function contextualAction(action, values) {
  if (!contextualActions) throw new Error('The recorded executable must advertise contextual native actions to infer operation identity or handling state.');
  if (typeof action !== 'string' || !Array.isArray(values) || values.some(value => typeof value !== 'string')) {
    throw new Error('A contextual action requires its name and an array of argument strings.');
  }
  if ([action, ...values].some(value => !value.isWellFormed() || value.includes('\0'))) {
    throw new Error('Contextual action arguments must contain complete UTF-8 text without NUL bytes.');
  }
  return coordInput(JSON.stringify([action, ...values]), 'agent-contextual-input', sessionId);
}

const dispatchInputSchema = { type: 'object', properties: {
  text: { type: 'string' }, file: { type: 'string' }, project: { type: 'string' },
  to: { type: 'string', description: 'Select an existing conversation' },
  session: { type: 'string', description: 'Compatibility alias for to' },
  continue: { type: 'boolean' }, new: { type: 'boolean' },
  route: { type: 'string' }, harness: { type: 'string' }, command: { type: 'string' },
  model: { type: 'string' }, effort: { type: 'string' }, workspace: { type: 'string' },
  outputLog: { type: 'string' }, dispatchId: { type: 'string' },
  taskId: { type: 'string', description: 'Compatibility alias for dispatchId' },
}, oneOf: [{ required: ['text'] }, { required: ['file'] }], additionalProperties: false };

// Tool definitions exposed to the attached Conductor.
const TOOLS = [
  {
    name: 'baton2_repl',
    description: 'Evaluate actual Bend2 source or retain checked definitions in the attached actor\'s notebook. The packaged canonical compiler infers types and checks affine use. IO runs in the recorded workspace through native custody. Read returns complete source, results, diagnostics and process outcomes; recover observes the original attempt. Bind checks a named definition from a pure result for later expressions. Labels select saved result records. Share sends a complete cell through ordinary message routing; import displays the complete received message through the owned-read path and checks its declaration snapshot. Standard installations include the Bend2 REPL compiler and runtime. Use baton2_action with action help and arguments ["repl"] for usage.',
    inputSchema: { type: 'object', properties: {
      operation: { enum: ['define', 'eval', 'bind', 'read', 'recover', 'share', 'import'] },
      source: { type: 'string', description: 'Complete Bend2 declarations or expression for define or eval.' },
      expectedType: { type: 'string', description: 'Optional expected Bend2 type for eval.' },
      name: { type: 'string', description: 'Bend2 definition name for binding a selected pure result.' },
      label: { type: 'string', description: 'Semantic label for the saved cell.' },
      notebook: { type: 'string' }, cell: { type: 'string' }, to: { type: 'string' },
      message: { type: 'string', description: 'Received message selected by import.' },
    }, required: ['operation'], additionalProperties: false },
  },
  {
    name: 'baton2_action',
    description: 'Run a contextual native action as the attached session. Use inbox, read, send, completion-request, completion-confirmed, guide, acknowledge, repl or help with a command domain. Named arguments and independent batch clauses use the same native grammar as baton. Complete argument strings travel through JSON standard input. Each item retains its outcome and actual failure cause.',
    inputSchema: { type: 'object', properties: {
      action: { type: 'string' }, arguments: { type: 'array', items: { type: 'string' } },
    }, required: ['action'], additionalProperties: false },
  },
  {
    name: 'baton2_dispatch',
    description: 'Dispatch complete task text or a UTF-8 file through the installed product operation. The attached session supplies the sender. Select to for an existing assignment; Baton chooses continuation automatically; new sessions use a named saved route or explicit provider settings. Complete requests, setup outcomes and failure causes are retained in the database.',
    inputSchema: dispatchInputSchema,
  },
  {
    name: 'baton2_task',
    description: 'Compatibility alias for baton2_dispatch with the same complete input, route, continuation and retained database outcomes.',
    inputSchema: dispatchInputSchema,
  },
  {
    name: 'baton2_project',
    description: 'Describe a project and register this coordinator database under its shared Git directory.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } },
      required: ['path'], additionalProperties: false },
  },
  {
    name: 'baton2_project_sessions',
    description: 'List the project\'s recorded sessions, native identities and pending input counts.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } },
      required: ['path'], additionalProperties: false },
  },
  {
    name: 'baton2_resume',
    description: 'Continue a recorded session through its registered receiver using its oldest pending input. An empty inbox after a failed native turn receives recovery guidance to continue the interrupted task in the same conversation.',
    inputSchema: { type: 'object', properties: { session: { type: 'string' },
      liftStop: { type: 'boolean', description: 'Explicitly lift the current stop before resuming the same conversation.' } },
      required: ['session'], additionalProperties: false },
  },
  {
    name: 'baton2_context_engines',
    description: 'List installed context modules and their capabilities. Optional session scope includes the attached session\'s project settings and each module\'s enabled and preferred state.',
    inputSchema: { type: 'object', properties: {
      scope: { type: 'string', enum: ['session'], description: 'Use the attached session\'s recorded workspace' },
    }, additionalProperties: false },
  },
  {
    name: 'baton2_context_install',
    description: 'Acquire a context module from a locally supplied, already-built module directory or extracted Baton2 distribution. Copy its dependency closure into this coordinator installation; an existing module remains present. Inspect capabilities with baton2_context_engines.',
    inputSchema: { type: 'object', properties: {
      module: { type: 'string', description: 'Module ID from its native provider declaration' },
      path: { type: 'string', description: 'Complete module directory or extracted distribution prefix' },
    }, required: ['module', 'path'], additionalProperties: false },
  },
  {
    name: 'baton2_context_query_file',
    description: 'Evaluate a native context query from a JSON request file as the attached session and retain its result in this database. Baton generates the query identity when omitted; the file must be accessible to the coordinator.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string' }, path: { type: 'string', description: 'Path to the query request JSON file' },
    }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'baton2_context_eval',
    description: 'Evaluate one expression in an already launched native runtime session as the attached session and retain the complete result in this database. Baton submits the existing runtime evaluate request with its control and evaluation effects; no second evaluator exists. Omitted query identity is generated; omitted cwd uses the owner recorded workspace.',
    inputSchema: { type: 'object', properties: {
      session: { type: 'string', description: 'Launched runtime session identity' },
      expression: { type: 'string', description: 'Expression to evaluate in the selected runtime session' },
      frame: { type: 'string', description: 'Optional admitted frame handle' },
      query: { type: 'string' }, owner: { type: 'string' }, cwd: { type: 'string' },
    }, required: ['session', 'expression'], additionalProperties: false },
  },
  {
    name: 'baton2_context_result',
    description: 'Read the latest context query owned by the attached session, or an explicitly selected query ID.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } },
      additionalProperties: false },
  },
  {
    name: 'baton2_knowledge',
    description: 'Discover finding metadata or read an exact finding and its complete evidence as the attached session. Index rows carry literal detailRead argv, and retained-message metadata carries literal deliveryRead argv.',
    inputSchema: { type: 'object', properties: {
      scope: { type: 'string', description: 'universal, worker, group, or all (the default discovery view)' },
      subject: { type: 'string', description: 'Worker or Ensemble ID; universal can name its Principal Conductor' },
      index: { type: 'boolean', description: 'Return compact metadata for visible findings' },
      id: { type: 'string', description: 'Return the complete visible finding with this exact stored ID' },
      pretty: { type: 'boolean', description: 'Pretty-print the JSON result' },
    }, additionalProperties: false },
  },
  {
    name: 'baton2_knowledge_relations',
    description: 'Read directed knowledge relationships, including message and external-reference links. Defaults to the attached session\'s authored relationships and links touching its held findings; optional scopes use the existing knowledge holdings.',
    inputSchema: { type: 'object', properties: {
      scope: { type: 'string', description: 'worker (default), group, universal, or all' },
      subject: { type: 'string', description: 'Worker or Ensemble ID; universal can name its Principal Conductor' },
      pretty: { type: 'boolean', description: 'Pretty-print the JSON result' },
    }, additionalProperties: false },
  },
  {
    name: 'baton2_knowledge_search',
    description: 'Search typed knowledge in explicit holdings. Every space-separated term matches ID, kind, claim, evidence, limits or retained evidence message bodies. Returns ranked matches, typed neighboring records and relationships, complete evidence and literal record reads. Ranking describes lexical matches and recorded connectivity.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string' },
      scope: { type: 'string', enum: ['worker', 'group', 'universal', 'all'], description: 'Default: attached worker holdings' },
      subject: { type: 'string', description: 'Worker, Ensemble or Principal Conductor ID' },
      pretty: { type: 'boolean' },
    }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'baton2_knowledge_traverse',
    description: 'Follow a knowledge or evidence reference through incoming, outgoing or both directions. Returns typed nodes, authored causal relationships and recorded citations with complete record reads. Optional recursive traversal follows the connected subgraph and terminates on cycles; relation selects one authored relationship name.',
    inputSchema: { type: 'object', properties: {
      reference: { type: 'string', description: 'finding:ID, bare knowledge ID, message:ID or external reference' },
      scope: { type: 'string', enum: ['worker', 'group', 'universal', 'all'], description: 'Default: attached worker holdings' },
      subject: { type: 'string' },
      direction: { type: 'string', enum: ['in', 'out', 'both'], description: 'Default: both' },
      relation: { type: 'string', description: 'Omitted means every relationship' },
      recursive: { type: 'boolean', description: 'Default: immediate neighbors' },
      pretty: { type: 'boolean' },
    }, required: ['reference'], additionalProperties: false },
  },
  {
    name: 'baton2_knowledge_record',
    description: 'Record typed evidence, findings, hypotheses, experiments, decisions or principles with cited sources and limits. Optional links commit authored causal relationships with the record in one transaction. A committed record notifies the immediate parent.',
    inputSchema: { type: 'object', properties: {
      id: { type: 'string' }, claim: { type: 'string' },
      kind: { type: 'string', description: 'Authored item type; omitted means finding. Types are free-form.' },
      evidence: { type: 'string', description: 'Use report for the unique authored report to the current coordinator after this actor\'s current assignment. Missing or ambiguous reports refuse. Explicit references, such as message:MESSAGE_ID, preserve deliberate selections.' },
      limits: { type: 'string' },
      links: { type: 'array', description: 'Authored relationships committed with this record', items: {
        type: 'object', properties: {
          id: { type: 'string' }, source: { type: 'string' },
          relation: { type: 'string' }, target: { type: 'string' },
        }, required: ['source', 'relation', 'target'], additionalProperties: false,
      } },
    }, required: ['claim', 'evidence', 'limits'], additionalProperties: false },
  },
  {
    name: 'baton2_knowledge_relate',
    description: 'Connect two knowledge or evidence references with an authored relationship. The direction is source relation target, such as a correction Supersedes an earlier finding.',
    inputSchema: { type: 'object', properties: {
      id: { type: 'string' },
      source: { type: 'string', description: 'Reference such as finding:ID, message:ID or an external source' },
      relation: { type: 'string', description: 'Free-form relationship name, such as Supports, DerivedFrom or Supersedes' },
      target: { type: 'string', description: 'The related reference' },
    }, required: ['source', 'relation', 'target'], additionalProperties: false },
  },
  {
    name: 'baton2_knowledge_promote',
    description: 'Promote a finding from its recorded source into a session or Ensemble as the attached destination owner.',
    inputSchema: { type: 'object', properties: {
      id: { type: 'string', description: 'Promotion ID' }, source: { type: 'string' },
      destination: { type: 'string' }, finding: { type: 'string', description: 'Finding ID' },
      sourceKind: { type: 'string', enum: ['session', 'group'], description: 'Source endpoint kind (default: session)' },
      destinationKind: { type: 'string', enum: ['session', 'group'], description: 'Destination endpoint kind (default: session)' },
    }, required: ['destination', 'finding'], additionalProperties: false },
  },
  {
    name: 'baton2_player',
    description: 'Inspect a Player or Conductor by session ID, including its responsibility and native identity.',
    inputSchema: { type: 'object', properties: { player: { type: 'string' } },
      required: ['player'], additionalProperties: false },
  },
  {
    name: 'baton2_join',
    description: 'Register a Player in an existing checkout shared with other Players.',
    inputSchema: { type: 'object', properties: {
      player: { type: 'string', description: 'New Player session ID' },
      parent: { type: 'string', description: 'Parent session ID (default: attached Conductor)' },
      harness: { type: 'string' }, model: { type: 'string' }, effort: { type: 'string' },
      workspace: { type: 'string', description: 'Existing checkout path' },
    }, required: ['player', 'harness', 'model', 'effort', 'workspace'], additionalProperties: false },
  },
  {
    name: 'baton2_recruit',
    description: 'Recruit a Player for a task that needs a separate Git worktree. Name the target branch, requested remote and integration Conductor in its task assignment.',
    inputSchema: { type: 'object', properties: {
      player: { type: 'string', description: 'New Player session ID' },
      parent: { type: 'string', description: 'Parent session ID (default: attached Conductor)' },
      harness: { type: 'string' }, model: { type: 'string' }, effort: { type: 'string' },
      repo: { type: 'string', description: 'Repository path' },
      branch: { type: 'string' }, workspace: { type: 'string', description: 'New worktree path' },
      base: { type: 'string', description: 'Base Git revision' },
    }, required: ['player', 'harness', 'model', 'effort', 'repo', 'branch', 'workspace', 'base'],
    additionalProperties: false },
  },
  {
    name: 'baton2_receiver',
    description: 'Register a native receive endpoint for an explicit Codex, OMP, Muse or Claude Code Player session.',
    inputSchema: { type: 'object', properties: {
      player: { type: 'string', description: 'Registered Player session ID' },
      command: { type: 'string', description: 'Native harness executable path or command name' },
      log: { type: 'string', description: 'Native output log path' },
      cwd: { type: 'string', description: 'Working directory the session turns run in; recorded when supplied' },
    }, required: ['player', 'command', 'log'], additionalProperties: false },
  },
  {
    name: 'baton2_configure',
    description: 'Configure a Player\'s provider and reasoning effort for future turns, keeping its assignment, work, native conversation and pending input. Saving effort on the same harness and model works during active or stopped sessions and keeps the receiver, current turn and stop. Changing harness or model requires the current attempt to end and any stop to be lifted.',
    inputSchema: { type: 'object', properties: {
      player: { type: 'string', description: 'Registered Player session ID' },
      harness: { type: 'string', description: 'Selected provider harness' },
      model: { type: 'string', description: 'Selected model key' },
      effort: { type: 'string', description: 'Selected thinking effort' },
      command: { type: 'string', description: 'Native harness executable path or command name' },
      log: { type: 'string', description: 'Native output log path' },
      expectedHarness: { type: 'string', description: 'Recorded harness the caller expects' },
      expectedModel: { type: 'string', description: 'Recorded model the caller expects' },
      expectedEffort: { type: 'string', description: 'Recorded effort the caller expects' },
    }, required: ['player', 'harness', 'model', 'effort', 'command', 'log',
      'expectedHarness', 'expectedModel', 'expectedEffort'], additionalProperties: false },
  },
  {
    name: 'baton2_dispatch_file',
    description: 'Commit a file as authorized message input and launch delivery to its registered recipient.',
    inputSchema: { type: 'object', properties: {
      id: { type: 'string', description: 'Message ID' },
      sender: { type: 'string', description: 'Sender session ID (default: attached Conductor)' },
      recipient: { type: 'string', description: 'Recipient session ID' },
      kind: { type: 'string', description: 'Message kind' },
      path: { type: 'string', description: 'Message body file path' },
    }, required: ['recipient', 'kind', 'path'], additionalProperties: false },
  },
  {
    name: 'baton2_dispatch_turn',
    description: 'Launch a registered Player turn from a task file using its recorded model, effort and workspace.',
    inputSchema: { type: 'object', properties: {
      player: { type: 'string', description: 'Registered Player session ID' },
      id: { type: 'string', description: 'Turn ID' },
      command: { type: 'string', description: 'Native harness executable path or command name' },
      log: { type: 'string', description: 'Native output log path' },
      task: { type: 'string', description: 'Task file path' },
    }, required: ['player', 'command', 'log', 'task'], additionalProperties: false },
  },
  {
    name: 'baton2_role',
    description: 'Read or assign a session responsibility.',
    inputSchema: { type: 'object', properties: {
      session: { type: 'string' },
      role: { type: 'string', enum: ['player', 'principal-conductor', 'associate-conductor', 'operator'] },
    }, required: ['session'], additionalProperties: false },
  },
  {
    name: 'baton2_ensemble',
    description: 'Inspect an Ensemble or configure its owner and coupling.',
    inputSchema: { type: 'object', properties: {
      ensemble: { type: 'string' }, owner: { type: 'string' },
      coupling: { type: 'string', enum: ['loose', 'tight'], description: 'Omitting coupling preserves an existing Ensemble; new Ensembles default to loose.' },
    }, required: ['ensemble'], additionalProperties: false },
  },
  {
    name: 'baton2_ensemble_member',
    description: 'Add or remove a Player or Conductor from an explicitly designated Ensemble.',
    inputSchema: { type: 'object', properties: {
      ensemble: { type: 'string' }, owner: { type: 'string' }, player: { type: 'string' },
      action: { type: 'string', enum: ['add', 'remove'] },
    }, required: ['ensemble', 'player', 'action'], additionalProperties: false },
  },
  {
    name: 'baton2_section',
    description: 'Inspect a Section or declare its capability within an Ensemble.',
    inputSchema: { type: 'object', properties: {
      ensemble: { type: 'string' }, section: { type: 'string' },
      owner: { type: 'string' }, capability: { type: 'string' },
    }, required: ['ensemble', 'section'], additionalProperties: false },
  },
  {
    name: 'baton2_section_member',
    description: 'Add or remove an Ensemble member from one of its Sections.',
    inputSchema: { type: 'object', properties: {
      ensemble: { type: 'string' }, section: { type: 'string' }, owner: { type: 'string' },
      player: { type: 'string' }, action: { type: 'string', enum: ['add', 'remove'] },
    }, required: ['ensemble', 'section', 'player', 'action'], additionalProperties: false },
  },
  {
    name: 'baton2_orchestra',
    description: 'Inspect Players, both Conductor tiers, operators, Ensembles and their Sections.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'baton2_status',
    description: 'Show all coordinator sessions and their pending message counts.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'baton2_owner',
    description: 'Read the elected database owner readiness: generation, committed cursor and gap flag.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'baton2_inbox',
    description: 'Show a session inbox. The default returns unacknowledged complete messages; index or optional metadata filters return ordered metadata. baton2_delivery reads a complete stored message.',
    inputSchema: {
      type: 'object',
      properties: {
        recipient: { type: 'string', description: 'Session ID (default: attached Conductor)' },
        ...messageIndexProperties,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_delivery',
    description: 'Read one complete stored message and its receipt by ID.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } },
      required: ['id'], additionalProperties: false },
  },
  {
    name: 'baton2_input',
    description: 'Read one complete stored message with its admission, recipient-owned receipt, current recipient state, available attempt evidence and literal navigation commands.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } },
      required: ['id'], additionalProperties: false },
  },
  {
    name: 'baton2_delivery_batch',
    description: 'Read selected complete stored messages and their receipts in the supplied order. Each item retains its own found, absent or refused result.',
    inputSchema: { type: 'object', properties: {
      ids: { type: 'array', items: { type: 'string' } },
    }, required: ['ids'], additionalProperties: false },
  },
  {
    name: 'baton2_outbox',
    description: 'Show complete messages authored by a session, including each current receipt, in stored order.',
    inputSchema: { type: 'object', properties: {
      sender: { type: 'string', description: 'Session ID (default: attached session)' },
    }, additionalProperties: false },
  },
  {
    name: 'baton2_ack',
    description: 'Acknowledge the attached Conductor’s fully read and handled input. Record unfinished work in reports and project state.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Message ID to acknowledge' },
        receipt: { type: 'string', description: 'Input disposition' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_guide',
    description: 'Send an authored message to a player through the coordinator. The default kind is guidance. Baton generates the message identity. Completion-confirmed selects the current request for that recipient when its body and request are omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Optional explicit message ID; Baton generates it when omitted' },
        player: { type: 'string', description: 'Player session ID' },
        body: { type: 'string', description: 'Complete message body; current completion confirmation can omit it' },
        request: { type: 'string', description: 'Optional explicit completion request selector' },
        kind: { type: 'string', description: 'Authored message kind; default guidance' },
      },
      required: ['player'],
      anyOf: [{ required: ['body'] }, { properties: { kind: { const: 'completion-confirmed' } }, required: ['kind'] }],
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_message_batch',
    description: 'Send authored messages from the attached session to multiple recipients. Each item reports its admission, wake outcome, retained message and current recipient-owned receipt. Recipient work remains pending through its acknowledgment and completion flow.',
    inputSchema: {
      type: 'object',
      properties: {
        messages: { type: 'array', items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Optional explicit message ID; Baton generates it when omitted' },
            player: { type: 'string', description: 'Recipient Player session ID' },
            body: { type: 'string', description: 'Complete body; current completion confirmation may omit it' },
            request: { type: 'string', description: 'Optional explicit completion request selector' },
            kind: { type: 'string', description: 'Authored message kind; default guidance' },
          },
          required: ['player'],
          anyOf: [{ required: ['body'] }, { properties: { kind: { const: 'completion-confirmed' } }, required: ['kind'] }],
          additionalProperties: false,
        } },
      },
      required: ['messages'],
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_player_status',
    description: 'Show a player\'s Git worktree state (branch, commit, dirty).',
    inputSchema: {
      type: 'object',
      properties: { player: { type: 'string', description: 'Player session ID' } },
      required: ['player'],
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_land',
    description: 'Land a player\'s committed changes onto a target branch (fast-forward only).',
    inputSchema: {
      type: 'object',
      properties: {
        player: { type: 'string', description: 'Player session ID' },
        repo: { type: 'string', description: 'Repository path' },
        target: { type: 'string', description: 'Target branch name' },
        commit: { type: 'string', description: 'Optional reviewed commit from the recorded branch.' },
      },
      required: ['player', 'repo', 'target'],
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_land_checked',
    description: 'Land a player\'s changes onto a target branch with a check script gate.',
    inputSchema: {
      type: 'object',
      properties: {
        player: { type: 'string', description: 'Player session ID' },
        repo: { type: 'string', description: 'Repository path' },
        target: { type: 'string', description: 'Target branch name' },
        commit: { type: 'string', description: 'Optional reviewed commit from the recorded branch.' },
        check: { type: 'string', description: 'Check script path' },
        files: { type: 'string', description: 'Space-separated list of files to check' },
      },
      required: ['player', 'repo', 'target', 'check', 'files'],
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_players',
    description: 'List all players with their harness, route, workspace, latest report and pending message count.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'baton2_turns',
    description: 'List all turns for a player with event type, report body and receipt status.',
    inputSchema: {
      type: 'object',
      properties: { player: { type: 'string', description: 'Player session ID' } },
      required: ['player'],
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_pending',
    description: 'List pending messages. The default includes complete bodies; index or optional metadata filters return ordered metadata. baton2_delivery reads a complete stored message.',
    inputSchema: { type: 'object', properties: {
      recipient: { type: 'string', description: 'Match a literal recipient ID' },
      ...messageIndexProperties,
    }, additionalProperties: false },
  },
  {
    name: 'baton2_push',
    description: 'Push a branch to a remote after landing.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Repository path' },
        branch: { type: 'string', description: 'Branch name to push' },
        remote: { type: 'string', description: 'Remote name (e.g. origin)' },
      },
      required: ['repo', 'branch', 'remote'],
      additionalProperties: false,
    },
  },
];

const AVAILABLE_TOOLS = TOOLS.filter((tool) => !unavailableTools.has(tool.name));

// State.
let deliveryReady = null;
let channelReady = false;
let connectionCustody = null;
let notifiedSeqs = new Set();
let deliveryServer = null;
let db = null;

function openDb() {
  if (db) return db;
  if (!existsSync(dbPath)) return null;
  db = new DatabaseSync(dbPath, { open: true, readOnly: true });
  return db;
}

function pendingConductorMessages(messageId = null) {
  const conn = openDb();
  if (!conn) return [];
  try {
    const rows = conn.prepare(
      `SELECT m.seq, m.id, m.sender, m.kind, m.body
       FROM messages m
       JOIN sessions s ON s.id = m.recipient
       WHERE s.id = ? AND m.receipt IS NULL
         AND (? IS NULL OR m.id = ?)
       ORDER BY m.seq`
    ).all(sessionId, messageId, messageId);
    return rows;
  } catch (e) {
    return [];
  }
}

function notifyPending(messageId = null) {
  if (!channelReady) return;
  const messages = pendingConductorMessages(messageId);
  const newMessages = messages.filter((m) => !notifiedSeqs.has(m.seq));
  if (newMessages.length === 0) return;

  for (const m of newMessages) {
    notifiedSeqs.add(m.seq);
  }

  const content = newMessages.map((m) => {
    const prefix = m.kind === 'report' ? 'Player report' : `Message (${m.kind})`;
    return `${prefix} from ${m.sender} [id: ${m.id}]:\n${m.body}`;
  }).join('\n\n---\n\n');

  sendNotification('notifications/claude/channel', {
    content,
    meta: { recipient: sessionId, messageIds: JSON.stringify(newMessages.map((m) => m.id)) },
  });
}

async function startDelivery() {
  const database = realpathSync(dbPath);
  const coordinator = realpathSync(coordinatorExe);
  const connection = randomUUID();
  const socketName = `conductor-${process.pid}-${connection}.sock`;
  // A relative socket name also works in deeply nested repository worktrees.
  process.chdir(dirname(database));
  deliveryServer = createServer({ allowHalfOpen: true }, (client) => {
    let input = '';
    client.on('data', (chunk) => { input += chunk; });
    client.on('end', () => {
      try {
        notifyPending(JSON.parse(input));
        client.end('ok\n');
      } catch (error) {
        client.end(error.message + '\n');
      }
    });
    client.on('error', (error) => process.stderr.write(`mcp-conductor: ${error.message}\n`));
  });
  await new Promise((ready, fail) => {
    deliveryServer.once('error', fail);
    deliveryServer.listen(socketName, ready);
  });
  const endpoint = JSON.stringify([
    process.execPath, fileURLToPath(import.meta.url), database, coordinator,
    '--session', sessionId, '--deliver', socketName,
  ]);
  let existing;
  try { existing = selectedSession(); } catch {}
  if (hasParent(existing)) coord('connect', sessionId, existing.native || '', endpoint);
  else coord('attach', sessionId, 'claude-code', existing?.native || '', endpoint);
  coord('role', sessionId, hasParent(existing) ? 'associate-conductor' : 'principal-conductor');
  connectionCustody = { database, coordinator, session: sessionId,
    native: selectedSession()?.native, endpoint, socket: socketName, connection,
    bridge: processIdentity(processFacts(process.pid)), client: processIdentity(processFacts(process.ppid)) };
}

function selectedSession() {
  return openDb()?.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
}

function initialInstructions() {
  const guidance = `Baton ${hasParent(selectedSession()) ? 'Associate' : 'Principal'} Conductor attachment for session ${sessionId}. Use baton2_join for shared-checkout work and baton2_recruit when a separate worktree is needed. Name the target branch, remote and integration Conductor in the assignment. Commit completed changes. The integration Conductor lands or reconciles contributions and pushes the integrated target with baton2_push. After publication and turn completion, relocate the same Player with baton2_receiver to the shared checkout and retire clean unused merged task worktrees and branches through ordinary Git. Preserve active or unfinished work, explicit stops and receiver/toolchain dependencies. Use the advertised task dispatch tool for complete task text or an existing UTF-8 file. Baton retains task input and setup outcomes in its database, resolves the recorded route and preserves an existing assignment. Scratchpads contain deliberately authored working notes. Baton stores complete task text in the database. Use baton2_receiver to configure an ordinary receive endpoint where needed. Use baton2_configure to save future effort on the same harness and model during active or stopped sessions, keeping the receiver, current turn and stop. Change harness or model after the current attempt ends and any stop is lifted. Configuration keeps the Player's identity, work, native conversation and pending input. Use baton2_context_engines to discover installed context modules; scope:"session" includes the attached project settings. Use baton2_context_install to acquire a module from a supplied built module directory or extracted distribution. Use baton2_context_query_file for request files and baton2_context_result for retained query results. Use baton2_knowledge_search to find a topic in selected holdings and baton2_knowledge_traverse to follow authored links and citations. Follow returned detailRead commands for complete findings and deliveryRead commands for cited messages. Finding references outside selected holdings carry an explicit all-scope detail read; reading preserves their holdings. Use baton2_knowledge for exact findings or metadata and baton2_knowledge_relations for directed links, including links between retained messages or external references. ${messageInstructions()} The optional kind supports authored completion-request and completion-confirmed messages. Workers ask their immediate parent to confirm task completion and continue useful work until its reply. The parent uses completion-confirmed with the recipient when the task is complete; Baton selects that recipient's current request. Guidance carries further work. Baton generates mutation IDs and records recipient handling from actual native evidence. Agents can inspect current state without copying control IDs or receipts. Native turn settlement and inbox receipts do not finish the task. The coordinator CLI ask and ask-file send questions as your recorded session to its parent; a parentless Principal Conductor reaches the registered operator. Use baton2_player and baton2_players to inspect Players and both Conductor tiers. Use baton2_role, baton2_ensemble, baton2_ensemble_member, baton2_section and baton2_section_member to configure responsibilities and membership. Use baton2_orchestra to inspect the system. Use baton2_turns for turn history and baton2_land or baton2_land_checked to land a Player's changes. Supply commit to select a reviewed ancestor while later work remains on the recorded branch.`;
  if (!nativeAttachmentInput) return guidance;
  const selected = selectedSession();
  const native = nativeSelector(processFacts(process.ppid));
  if (native !== null) {
    if (selected?.native && selected.native !== native) {
      throw new Error('The native client session selector differs from the recorded conversation.');
    }
    if (!selected?.native) {
      if (hasParent(selected)) coord('connect', sessionId, native, selected.endpoint || '');
      else coord('attach', sessionId, 'claude-code', native, selected?.endpoint || '');
    }
  }
  return coordInputRaw(guidance, 'native-attachment-input', sessionId, 'mcp-instructions');
}

// MCP message handler.
function handleMessage(msg) {
  if (msg.id === 'conductor-channel-ready' && msg.result !== undefined) {
    channelReady = true;
    notifyPending();
    return;
  }
  if (msg.method === 'initialize') {
    let instructions;
    try { instructions = initialInstructions(); }
    catch (error) {
      sendError(msg.id, -32603, error.message);
      return;
    }
    sendResponse(msg.id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        experimental: { 'claude/channel': {} },
      },
      serverInfo: { name: 'baton-conductor', version: '2.0.0' },
      instructions,
    });
    return;
  }

  if (msg.method === 'notifications/initialized') {
    deliveryReady = startDelivery();
    deliveryReady.catch((error) => {
      process.stderr.write(`mcp-conductor: ${error.message}\n`);
      process.exit(1);
    });
    return;
  }

  if (msg.method === 'tools/list') {
    sendResponse(msg.id, { tools: AVAILABLE_TOOLS });
    // In the native recovery run, replay before the client installed its channel
    // handler was lost. Complete a round trip after discovery before replaying.
    if (!channelReady) deliveryReady?.then(() => {
      writeMessage({ jsonrpc: '2.0', id: 'conductor-channel-ready', method: 'ping' });
    });
    return;
  }

  if (msg.method === 'tools/call') {
    handleToolCall(msg);
    return;
  }

  if (msg.method === 'ping') {
    sendResponse(msg.id, {});
    return;
  }

  // Notifications we don't handle.
  if (!msg.id) return;

  sendError(msg.id, -32601, `Method not found: ${msg.method}`);
}

function landCommit(args) {
  if (args.commit === undefined) return [];
  if (typeof args.commit !== 'string') throw new Error('commit must be a string');
  return ['--commit', args.commit];
}

function messageReadOptions(args, pending = false) {
  const flags = [];
  for (const [field, flag] of [
    ...(pending ? [['recipient', '--recipient']] : []),
    ['sender', '--sender'], ['kind', '--kind'], ['state', '--state'],
    ['afterSeq', '--after-seq'], ['throughSeq', '--through-seq'],
  ]) {
    if (args?.[field] !== undefined) flags.push(flag, args[field]);
  }
  return [
    ...(args?.index === true || flags.length ? ['--index'] : []),
    ...flags,
    ...(args?.pretty === true ? ['--pretty'] : []),
  ];
}

function handleToolCall(msg) {
  const { name } = msg.params;
  const args = msg.params.arguments ?? {};
  const player = args?.player ?? args?.worker;
  if (unavailableTools.has(name)) {
    sendError(msg.id, -32601, `The recorded coordinator executable does not advertise ${name}. Use baton2_delivery or baton2_guide until that executable is updated.`);
    return;
  }
  try {
    let result;
    switch (name) {
      case 'baton2_repl': {
        const values = [args.operation];
        if (['define', 'eval'].includes(args.operation)) {
          if (typeof args.source !== 'string') throw new Error('Supply complete Bend2 source.');
          values.push(args.source);
        } else if (args.operation === 'bind') {
          if (typeof args.name !== 'string') throw new Error('Supply the Bend2 definition name.');
          values.push(args.name);
        } else if (args.operation === 'import') {
          if (typeof args.message !== 'string') throw new Error('Select a received declaration message.');
          values.push(args.message);
        }
        for (const [field, flag] of [['expectedType', '--type'], ['label', '--label'],
          ['notebook', '--notebook'], ['cell', '--cell'], ['to', '--to']]) {
          if (args[field] !== undefined) values.push(flag, args[field]);
        }
        result = contextualAction('repl', values);
        break;
      }
      case 'baton2_action':
        result = contextualAction(args.action, args.arguments ?? []);
        break;
      case 'baton2_dispatch':
      case 'baton2_task': {
        const flags = ['--sender', sessionId];
        const project = args.project ?? selectedSession()?.workspace;
        if (!project) throw new Error('Task project context is absent. Pass project with the recorded checkout path.');
        flags.push('--project', project);
        for (const [field, flag] of [['to', '--to'], ['session', '--session'], ['route', '--route'],
          ['harness', '--harness'], ['command', '--command'], ['model', '--model'],
          ['effort', '--effort'], ['workspace', '--workspace'], ['outputLog', '--output-log'],
          ['dispatchId', '--dispatch-id'], ['taskId', '--task-id']]) {
          if (args[field] !== undefined) flags.push(flag, args[field]);
        }
        if (args.continue === true) flags.push('--continue');
        if (args.new === true) flags.push('--new');
        if ((args.text === undefined) === (args.file === undefined)) {
          throw new Error('Task input requires exactly one text or UTF-8 file value.');
        }
        const verb = dispatchInput ? 'dispatch' : 'task';
        result = args.text !== undefined ? coordInput(args.text, verb, '--stdin', ...flags)
          : coord(verb, '--file', args.file, ...flags);
        break;
      }
      case 'baton2_project':
        result = coord('project', args.path);
        break;
      case 'baton2_project_sessions':
        result = coord('project-sessions', args.path);
        break;
      case 'baton2_resume':
        result = coord('resume', args.session, ...(args.liftStop === true ? ['--lift-stop'] : []));
        break;
      case 'baton2_context_engines':
        result = coord('context-engines', ...(args?.scope === 'session' ? [sessionId] : []));
        break;
      case 'baton2_context_install':
        result = coord('context-install', args.module, args.path);
        break;
      case 'baton2_context_query_file':
        result = args.query !== undefined ? coord('context-query-file', sessionId, args.query, args.path)
          : contextualAction('context', ['query', '--file', args.path]);
        break;
      case 'baton2_context_eval':
        result = args.query !== undefined
          ? coord('context-eval', args.owner ?? sessionId, args.query, args.session,
                  args.expression, args.frame ?? '', args.cwd ?? '')
          : contextualAction('context', ['eval', '--session', args.session,
              '--expression', args.expression,
              ...(args.frame !== undefined ? ['--frame', args.frame] : []),
              ...(args.cwd !== undefined ? ['--cwd', args.cwd] : []),
              ...(args.owner !== undefined ? ['--owner', args.owner] : [])]);
        break;
      case 'baton2_context_result':
        result = args.query !== undefined ? coord('context-result', args.query)
          : contextualAction('context', ['result']);
        break;
      case 'baton2_knowledge': {
        const options = args;
        const selection = options.index === true ? ['--index']
          : options.id === undefined ? [] : ['--id', options.id];
        const presentation = options.pretty === true ? ['--pretty'] : [];
        result = options.scope === undefined
          ? coord('knowledge', sessionId, ...selection, ...presentation)
          : coord('knowledge-scope', sessionId, options.scope,
              options.subject ?? (options.scope === 'worker' ? sessionId : ''),
              ...selection, ...presentation);
        break;
      }
      case 'baton2_knowledge_relations': {
        const scope = args.scope ?? 'worker';
        const subject = args.subject ?? (scope === 'worker' ? sessionId : '');
        result = coord('knowledge-relations', sessionId, scope, subject,
          ...(args.pretty === true ? ['--pretty'] : []));
        break;
      }
      case 'baton2_knowledge_search': {
        const scope = args.scope ?? 'worker';
        result = coord('knowledge-search', sessionId, scope,
          args.subject ?? (scope === 'worker' ? sessionId : ''), args.query,
          ...(args.pretty === true ? ['--pretty'] : []));
        break;
      }
      case 'baton2_knowledge_traverse': {
        const scope = args.scope ?? 'worker';
        result = coord('knowledge-traverse', sessionId, scope,
          args.subject ?? (scope === 'worker' ? sessionId : ''), args.reference,
          args.direction ?? 'both', args.relation ?? '',
          args.recursive === true ? 'recursive' : 'neighbors',
          ...(args.pretty === true ? ['--pretty'] : []));
        break;
      }
      case 'baton2_knowledge_record':
        if (args.evidence === 'report' || args.id === undefined || args.links?.some(link => link.id === undefined)) {
          result = contextualAction('knowledge', ['record', '--kind', args.kind ?? 'finding',
            '--claim', args.claim, '--evidence', args.evidence, '--limits', args.limits,
            ...(args.id === undefined ? [] : ['--id', args.id]),
            ...(args.links === undefined ? [] : ['--links', JSON.stringify(args.links)])]);
          break;
        }
        result = args.links !== undefined
          ? coord('record-linked', args.id, sessionId, args.kind ?? 'finding',
              args.claim, args.evidence, args.limits, JSON.stringify(args.links))
          : args.kind === undefined
          ? coord('record', args.id, sessionId, args.claim, args.evidence, args.limits)
          : coord('record-typed', args.id, sessionId, args.kind, args.claim, args.evidence, args.limits);
        break;
      case 'baton2_knowledge_relate':
        result = args.id !== undefined ? coord('relate', args.id, sessionId, args.source, args.relation, args.target)
          : contextualAction('knowledge', ['relate', '--source', args.source, '--relation', args.relation, '--target', args.target]);
        break;
      case 'baton2_knowledge_promote':
        if (args.id === undefined || args.source === undefined) {
          result = contextualAction('knowledge', ['promote', '--to', args.destination, '--finding', args.finding,
            ...(args.id === undefined ? [] : ['--id', args.id]),
            ...(args.source === undefined ? [] : ['--from', args.source]),
            ...(args.sourceKind === undefined ? [] : ['--source-kind', args.sourceKind]),
            ...(args.destinationKind === undefined ? [] : ['--destination-kind', args.destinationKind])]);
          break;
        }
        result = args.sourceKind === undefined && args.destinationKind === undefined
          ? coord('promote', args.id, sessionId, args.source, args.destination, args.finding)
          : coord('promote-scoped', args.id, sessionId, args.sourceKind ?? 'session', args.source,
            args.destinationKind ?? 'session', args.destination, args.finding);
        break;
      case 'baton2_player':
        result = coord('player', player);
        break;
      case 'baton2_join':
        result = coord('join', player, args.parent ?? sessionId, args.harness, args.model,
          args.effort, args.workspace);
        break;
      case 'baton2_recruit':
        result = coord('recruit', player, args.parent ?? sessionId, args.harness, args.model,
          args.effort, args.repo, args.branch, args.workspace, args.base);
        break;
      case 'baton2_receiver':
        result = coord('receiver', player, args.command, args.log,
                       ...(args.cwd === undefined ? [] : [args.cwd]));
        break;
      case 'baton2_configure':
        result = coord('configure', player, args.harness, args.model, args.effort,
          args.command, args.log, args.expectedHarness, args.expectedModel, args.expectedEffort);
        break;
      case 'baton2_dispatch_file':
        if (args.id === undefined && args.sender !== undefined && args.sender !== sessionId) {
          throw new Error('Automatic dispatch identity uses the attached actor; sender must match that actor.');
        }
        result = args.id !== undefined ? coord('dispatch-file', args.id, args.sender ?? sessionId,
          args.recipient, args.kind, args.path)
          : contextualAction('dispatch', ['--to', args.recipient, '--kind', args.kind, '--file', args.path]);
        break;
      case 'baton2_dispatch_turn':
        result = args.id !== undefined ? coord('dispatch-turn', player, args.id, args.command, args.log, args.task)
          : contextualAction('turn', ['--session', player, '--command', args.command, '--output-log', args.log, '--file', args.task]);
        break;
      case 'baton2_role':
        result = coord('role', args.session, ...(args.role === undefined ? [] : [args.role]));
        break;
      case 'baton2_ensemble':
        result = coord('ensemble', args.ensemble,
          ...(args.owner === undefined && args.coupling === undefined ? []
            : [args.owner ?? sessionId, ...(args.coupling === undefined ? [] : [args.coupling])]));
        break;
      case 'baton2_ensemble_member':
        result = coord('ensemble-member', args.ensemble, args.owner ?? sessionId, player, args.action);
        break;
      case 'baton2_section':
        if (args.owner !== undefined && args.capability === undefined) throw new Error('Declaring a Section requires its capability');
        result = coord('section', args.ensemble, args.section,
          ...(args.capability === undefined ? [] : [args.owner ?? sessionId, args.capability]));
        break;
      case 'baton2_section_member':
        result = coord('section-member', args.ensemble, args.section, args.owner ?? sessionId, player, args.action);
        break;
      case 'baton2_orchestra':
        result = coord('orchestra');
        break;
      case 'baton2_status':
        result = coord('status');
        break;
      case 'baton2_owner':
        result = coord('owner-status');
        break;
      case 'baton2_inbox':
        result = coord('inbox', args?.recipient ?? sessionId, ...messageReadOptions(args));
        break;
      case 'baton2_delivery':
        result = coord('delivery', args.id);
        break;
      case 'baton2_input':
        result = coord('input', args.id);
        break;
      case 'baton2_delivery_batch':
        result = coord('delivery-batch', JSON.stringify(args.ids));
        break;
      case 'baton2_outbox':
        result = coord('outbox', args?.sender ?? sessionId);
        break;
      case 'baton2_ack':
        result = args?.id !== undefined && args?.receipt !== undefined ? coord('ack', args.id, sessionId, args.receipt)
          : contextualAction('acknowledge', [...(args?.id === undefined ? [] : [args.id]),
            ...(args?.receipt === undefined ? [] : ['--receipt', args.receipt])]);
        break;
      case 'baton2_guide':
        if (args.kind === 'completion-confirmed' && (args.body === undefined || args.request !== undefined)) {
          result = contextualAction('completion-confirmed', ['--to', player,
            ...(args.request === undefined ? [] : ['--request', args.request]),
            ...(args.id === undefined ? [] : ['--id', args.id])]);
        } else {
          result = args.id !== undefined ? coord('message', args.id, sessionId, player, args.kind ?? 'guidance', args.body)
            : contextualAction('send', [player, '--kind', args.kind ?? 'guidance', '--text', args.body]);
        }
        break;
      case 'baton2_message_batch': {
        const inferredCompletion = args.messages.some(message => message.kind === 'completion-confirmed'
          && (message.body === undefined || message.request !== undefined));
        if (inferredCompletion) {
          const values = args.messages.flatMap((message, index) => {
            const prefix = index === 0 ? [] : ['--and'];
            if (message.kind === 'completion-confirmed') {
              const request = message.request ?? message.body;
              return [...prefix, 'completion-confirmed', '--to', message.player,
                ...(request === undefined ? [] : ['--request', request]),
                ...(message.id === undefined ? [] : ['--id', message.id])];
            }
            return [...prefix, 'dispatch', '--to', message.player, '--kind', message.kind ?? 'guidance',
              '--text', message.body, ...(message.id === undefined ? [] : ['--id', message.id])];
          });
          result = contextualAction(values[0], values.slice(1));
        } else if (args.messages.some(message => message.id === undefined)) {
          result = contextualAction('send', args.messages.flatMap((message, index) => [
            ...(index === 0 ? [] : ['--and']), message.player, '--kind', message.kind ?? 'guidance',
            '--text', message.body, ...(message.id === undefined ? [] : ['--id', message.id])]));
        } else {
          result = coord('message-batch', sessionId, JSON.stringify(args.messages.map(message => ({
            id: message.id, recipient: message.player, kind: message.kind ?? 'guidance', body: message.body,
          }))));
        }
        break;
      }
      case 'baton2_player_status':
      case 'baton2_worker_status':
        result = coord('worktree', player);
        break;
      case 'baton2_land':
        result = coord('land', player, args.repo, args.target, ...landCommit(args));
        break;
      case 'baton2_land_checked':
        result = coord('land-checked', player, args.repo, args.target, args.check, args.files, ...landCommit(args));
        break;
      case 'baton2_players':
        result = coord('players');
        break;
      case 'baton2_workers':
        result = coord('workers');
        break;
      case 'baton2_turns':
        result = coord('turns', player);
        break;
      case 'baton2_pending':
        result = coord('pending', ...messageReadOptions(args, true));
        break;
      case 'baton2_push':
        result = coord('push', args.repo, args.branch, args.remote);
        break;
      default:
        sendError(msg.id, -32602, `Unknown tool: ${name}`);
        return;
    }
    sendResponse(msg.id, {
      content: [{ type: 'text', text: result }],
    });
  } catch (e) {
    sendResponse(msg.id, {
      content: [{ type: 'text', text: `Error: ${e.message}` }],
      isError: true,
    });
  }
}

process.on('SIGINT', () => {
  deliveryServer?.close();
  db?.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  deliveryServer?.close();
  db?.close();
  process.exit(0);
});
