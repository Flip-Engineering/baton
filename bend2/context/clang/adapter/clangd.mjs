// clangd protocol adapter (one-shot). Installed argv:
//   <absolute node> <package>/libexec/baton2/context/clang/adapter/clangd.mjs -
// Commands over the single stdin document:
//   providerEngines: executable probe and version.
//   diagnose: one managed-free one-shot language service capture. Completion
//     of the diagnostics projection requires textDocument/publishDiagnostics
//     for the exact URI carrying the exact recorded integer version; an
//     explicit empty array completes with no diagnostics. Versionless
//     publications, other URIs and other versions are retained protocol
//     evidence that cannot complete the projection. Requests that select no
//     diagnostics projection complete on their language-service responses,
//     with publications retained as evidence. No timer treats silence as
//     completion or failure; provider exit, transport failure and structured
//     protocol errors are their own failure evidence.
// Floor: Node 22.15.0.
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  parseJsonBytes,
  readStdinBytes,
  realPath,
  refuse,
  runProcess,
  writeJsonDoc,
} from './common.mjs';
import { LspConnection } from './lsp.mjs';

const PROJECTIONS = [
  'definition',
  'type',
  'references',
  'calls',
  'callers',
  'dependencies',
  'diagnostics',
];

async function providerEngines(doc) {
  const exe = doc.executable;
  if (typeof exe !== 'string' || !exe.startsWith('/')) {
    refuse('providerEngines', 'absoluteExecutableRequired');
  }
  const real = realPath(exe);
  if (!real) {
    return {
      version: 1,
      provider: 'clangd',
      engines: [
        {
          engine: 'clangd',
          provider: 'clangd',
          version: null,
          executable: exe,
          linkedIdentity: null,
          projections: PROJECTIONS,
          effects: [],
          availability: 'unavailable',
          limits: [{ code: 'executableMissing', detail: exe }],
        },
      ],
    };
  }
  const probe = await runProcess([real, '--version']);
  const text = probe.stdout.toString('utf-8');
  const match = /clangd version (\S+)/.exec(text);
  const available = probe.code === 0 && match !== null;
  return {
    version: 1,
    provider: 'clangd',
    engines: [
      {
        engine: 'clangd',
        provider: 'clangd',
        version: available ? match[1] : null,
        executable: real,
        linkedIdentity: available ? { versionOutput: text.trim() } : null,
        projections: PROJECTIONS,
        effects: [],
        availability: available ? 'available' : 'unavailable',
        limits: available ? [] : [{ code: 'probeFailed', detail: `exit ${probe.code}` }],
      },
    ],
  };
}

// One-shot diagnose. Input members (closed):
//   version:1, command:"diagnose", executable:<abs clangd>,
//   root:<abs capture dir>, file:<path as in compile command>,
//   uriFile:<abs file whose publication completes the projection>,
//   docVersion:<integer>, languageId:<string>, text:<captured bytes string>,
//   compileArguments:[...], methods:[{method, params}],
//   requireDiagnosticPublication:<boolean>  (diagnostics projection selected)
async function diagnose(doc) {
  if (doc.version !== 1) refuse('diagnose', 'versionMustEqual1');
  if (!Number.isInteger(doc.docVersion)) refuse('diagnose', 'docVersionMustBeInteger');
  if (
    doc.requireDiagnosticPublication !== undefined &&
    typeof doc.requireDiagnosticPublication !== 'boolean'
  ) {
    refuse('diagnose', 'requireDiagnosticPublicationMustBeBoolean');
  }
  if (!Array.isArray(doc.methods)) refuse('diagnose', 'methodsMustBeArray');
  if (!Array.isArray(doc.compileArguments)) refuse('diagnose', 'compileArgumentsMustBeArray');
  const real = realPath(doc.executable);
  if (!real) refuse('diagnose', 'executableMissing');

  const uriOf = (p) => pathToFileURL(p).href;
  const targetUri = uriOf(doc.uriFile);

  const child = spawn(real, [
    `--compile-commands-dir=${doc.root}`,
    '--background-index=0',
    '--enable-config=0',
    '--pch-storage=memory',
    '--log=verbose',
  ], { stdio: ['pipe', 'pipe', 'pipe'], cwd: doc.root });
  const lsp = new LspConnection(child);

  const publications = [];
  const responses = new Map();
  const requestedIds = [];
  let serverInfo = null;
  let failure = null;
  let publicationMatched = false;
  let matchedPublication = null;
  let initialized = false;

  function baseHandler(msg) {
    if (msg.method === 'textDocument/publishDiagnostics') {
      // Retain the complete publication: every diagnostic entry with its
      // message, range, severity, code and source survives in the output.
      const publication = {
        uri: msg.params?.uri ?? null,
        version: msg.params?.version ?? null,
        diagnostics: Array.isArray(msg.params?.diagnostics)
          ? msg.params.diagnostics
          : null,
      };
      publications.push(publication);
      if (
        msg.params?.uri === targetUri &&
        msg.params?.version === doc.docVersion
      ) {
        publicationMatched = true;
        matchedPublication = publication;
      }
      return;
    }
    if (msg.id !== undefined) responses.set(msg.id, msg);
  }

  lsp.onMessage = (msg) => {
    if (!initialized) {
      if (msg.id !== undefined && msg.result && !msg.error) {
        initialized = true;
        serverInfo = msg.result.serverInfo ?? null;
        lsp.notify('initialized', {});
        lsp.notify('textDocument/didOpen', {
          textDocument: {
            uri: uriOf(doc.file),
            languageId: doc.languageId,
            version: doc.docVersion,
            text: doc.text,
          },
        });
        doc.methods.forEach((m, i) => {
          requestedIds[i] = lsp.send(m.method, m.params);
        });
      } else if (msg.error) {
        failure = {
          code: 'protocolError',
          detail: `${msg.error.code}: ${msg.error.message ?? ''}`,
        };
      }
    }
    baseHandler(msg);
  };

  // initialize
  lsp.send('initialize', {
    processId: process.pid,
    rootUri: uriOf(doc.root),
    capabilities: {
      textDocument: {
        publishDiagnostics: { versionSupport: true },
      },
    },
  });

  // Event loop: resolve on completion or provider failure. No timers.
  // The diagnostics projection is required only when the caller selected
  // diagnostics; definition/references/type/calls requests complete on
  // their responses, with publications retained as evidence either way.
  const diagnosticsRequired = doc.requireDiagnosticPublication === true;
  while (true) {
    if (lsp.closed) {
      failure = {
        code: 'providerExit',
        detail: `exit ${lsp.exit?.code ?? 'null'} signal ${lsp.exit?.signal ?? 'null'}`,
        stderr: lsp.stderrText(),
      };
      break;
    }
    // Classify observed protocol errors before any completion report, so a
    // failed response cannot satisfy completion with failure null.
    for (const [, msg] of responses) {
      if (msg.error && failure === null) {
        failure = {
          code: 'protocolError',
          detail: `${msg.error.code}: ${msg.error.message ?? ''}`,
        };
      }
    }
    if (failure) break;
    // An empty method selection with no diagnostics projection performs no
    // service work: after initialization completes, report the unsupported
    // selection instead of inventing a complete result. Initialization is
    // retained, and a provider that dies first reports its own failure.
    if (initialized && doc.methods.length === 0 && !diagnosticsRequired) {
      failure = {
        code: 'unsupportedSelection',
        detail:
          'no supported language-service method for the selected subject and projections',
      };
      break;
    }
    const allResponses = doc.methods.every((_, i) => {
      const id = requestedIds[i];
      return id !== undefined && responses.has(id);
    });
    if (allResponses && (publicationMatched || !diagnosticsRequired)) break;
    await lsp.nextEvent();
  }

  const prepareIndex = doc.methods.findIndex((method) => method.method === 'textDocument/prepareCallHierarchy');
  const prepared = prepareIndex >= 0 ? responses.get(requestedIds[prepareIndex])?.result : null;
  const callItems = Array.isArray(prepared) ? prepared : [];
  const callRequests = [];
  for (const item of callItems) {
    for (const followup of doc.methods[prepareIndex]?.followups ?? []) {
      const method = followup === 'outgoingCalls' ? 'callHierarchy/outgoingCalls' : 'callHierarchy/incomingCalls';
      const id = lsp.send(method, { item });
      callRequests.push({ item, followup, id });
    }
  }
  while (callRequests.some(({ id }) => !responses.has(id))) {
    if (lsp.closed) {
      failure = { code: 'providerExit',
        detail: `exit ${lsp.exit?.code ?? 'null'} signal ${lsp.exit?.signal ?? 'null'}`,
        stderr: lsp.stderrText() };
      break;
    }
    for (const { id } of callRequests) {
      const response = responses.get(id);
      if (response?.error) failure = { code: 'protocolError', detail: `${response.error.code}: ${response.error.message ?? ''}` };
    }
    if (failure) break;
    await lsp.nextEvent();
  }
  for (const { id } of callRequests) {
    const response = responses.get(id);
    if (response?.error) failure = { code: 'protocolError',
      detail: `${response.error.code}: ${response.error.message ?? ''}`,
      stderr: lsp.stderrText() };
  }

  // Map responses back onto the requested methods in order.
  const outResponses = doc.methods.map((m, i) => {
    const id = requestedIds[i];
    const msg = id !== undefined ? responses.get(id) : undefined;
    return {
      method: m.method,
      response: msg
        ? { result: msg.result ?? null, error: msg.error ?? null }
        : null,
    };
  });

  const out = {
    version: 1,
    provider: 'clangd',
    serverIdentity: serverInfo,
    diagnostics: {
      completed: publicationMatched,
      matchingPublication: publicationMatched ? matchedPublication : null,
      publications,
    },
    responses: outResponses,
    callHierarchy: callRequests.map(({ item, followup, id }) => ({
      direction: followup,
      name: item.name,
      response: responses.get(id)?.result ?? null,
      error: responses.get(id)?.error ?? null,
    })),
    failure,
    executable: { path: real },
    limits: publicationMatched || !diagnosticsRequired
      ? []
      : [
          {
            projection: 'diagnostics',
            code: 'diagnosticsUnobserved',
            detail: failure
              ? failure.detail
              : 'no matching versioned publication observed',
          },
        ],
  };
  writeJsonDoc(out);
  process.exit(0);
}

const argv = process.argv.slice(2);
if (argv.length !== 1 || argv[0] !== '-') {
  process.stderr.write(
    JSON.stringify({
      error: 'validationRefusal',
      command: 'clangd',
      condition: 'stdinCommandRequired',
      next: [],
    }) + '\n',
  );
  process.exit(2);
}
const raw = readStdinBytes();
if (!raw) refuse('providerEngines', 'stdinDocumentRequired');
const doc = parseJsonBytes(raw, 'providerEngines');
if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
  refuse('providerEngines', 'documentMustBeObject');
}
if (doc.version !== 1) refuse('providerEngines', 'versionMustEqual1');
switch (doc.command) {
  case 'providerEngines': {
    const out = await providerEngines(doc);
    writeJsonDoc(out);
    process.exit(0);
    break;
  }
  case 'diagnose':
    await diagnose(doc);
    break;
  default:
    refuse('providerEngines', `unknownCommand:${String(doc.command)}`);
}
