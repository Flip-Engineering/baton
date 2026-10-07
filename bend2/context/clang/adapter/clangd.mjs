// clangd protocol adapter (one-shot). Installed argv:
//   <absolute node> <package>/libexec/baton2/context/clang/adapter/clangd.mjs -
// Commands over the single stdin document:
//   providerEngines: fixed executable probe (realpath, version, sha256).
//   diagnose: one managed-free one-shot language service capture. Completion
//     of the diagnostics projection requires textDocument/publishDiagnostics
//     for the exact URI carrying the exact recorded integer version; an
//     explicit empty array completes with no diagnostics. Versionless
//     publications, other URIs and other versions are retained protocol
//     evidence that cannot complete the projection. No timer treats silence
//     as completion or failure; provider exit, transport failure and
//     structured protocol errors are their own failure evidence.
// Floor: Node 22.15.0.
import { spawn } from 'node:child_process';
import {
  parseJsonBytes,
  readStdinBytes,
  realPath,
  refuse,
  runProcess,
  sha256File,
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

function refusedFlag(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-plugin' || args[i] === '-load') return true;
    if (
      args[i] === '-Xclang' &&
      (args[i + 1] === '-plugin' || args[i + 1] === '-load')
    ) {
      return true;
    }
  }
  return false;
}

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
          sha256: null,
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
        sha256: available ? sha256File(real) : null,
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
//   compileArguments:[...], methods:[{method, params}]
async function diagnose(doc) {
  for (const key of [
    'version',
    'command',
    'executable',
    'root',
    'file',
    'uriFile',
    'docVersion',
    'languageId',
    'text',
    'compileArguments',
    'methods',
  ]) {
    // every member must be one of these (closed check below)
  }
  const allowed = new Set([
    'version',
    'command',
    'executable',
    'root',
    'file',
    'uriFile',
    'docVersion',
    'languageId',
    'text',
    'compileArguments',
    'methods',
  ]);
  for (const key of Object.keys(doc)) {
    if (!allowed.has(key)) refuse('diagnose', `unknownMember:${key}`);
  }
  if (doc.version !== 1) refuse('diagnose', 'versionMustEqual1');
  if (!Number.isInteger(doc.docVersion)) refuse('diagnose', 'docVersionMustBeInteger');
  if (!Array.isArray(doc.methods)) refuse('diagnose', 'methodsMustBeArray');
  if (!Array.isArray(doc.compileArguments)) refuse('diagnose', 'compileArgumentsMustBeArray');
  if (refusedFlag(doc.compileArguments)) refuse('diagnose', 'unsupportedCompilerFlag');
  const real = realPath(doc.executable);
  if (!real) refuse('diagnose', 'executableMissing');

  const uriOf = (p) => 'file://' + p;
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

  function baseHandler(msg) {
    if (msg.method === 'textDocument/publishDiagnostics') {
      publications.push({
        uri: msg.params?.uri ?? null,
        version: msg.params?.version ?? null,
        diagnosticCount: Array.isArray(msg.params?.diagnostics)
          ? msg.params.diagnostics.length
          : null,
      });
      if (
        msg.params?.uri === targetUri &&
        msg.params?.version === doc.docVersion
      ) {
        publicationMatched = true;
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
  while (true) {
    if (lsp.closed) {
      failure = {
        code: 'providerExit',
        detail: `exit ${lsp.exit?.code ?? 'null'} signal ${lsp.exit?.signal ?? 'null'}`,
      };
      break;
    }
    const allResponses = doc.methods.every((_, i) => {
      const id = requestedIds[i];
      return id !== undefined && responses.has(id);
    });
    if (publicationMatched && allResponses) break;
    // Structured protocol errors on requested ids are failure evidence.
    for (const [, msg] of responses) {
      if (msg.error) {
        failure = {
          code: 'protocolError',
          detail: `${msg.error.code}: ${msg.error.message ?? ''}`,
        };
      }
    }
    if (failure) break;
    await lsp.nextEvent();
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
      matchingPublication: publicationMatched
        ? { uri: targetUri, version: doc.docVersion }
        : null,
      publications,
    },
    responses: outResponses,
    failure,
    executable: { path: real, sha256: sha256File(real) },
    limits: publicationMatched
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
