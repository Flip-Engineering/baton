// CDP runtime lane: admission of the target launch document.
//
// Contract: docs/bend2/semantic-context-spec.md, "Runtime contract". The target
// keeper launches the packaged Node bootstrap under `/usr/bin/env -i`. That
// bootstrap reads the complete explicit target launch document from initial
// stdin through EOF, validates it, then calls `process.execve` with the selected
// absolute target Node, argv and complete target environment. The bootstrap and
// final executable identities are recorded separately, and no spawning wrapper
// survives the transfer.
//
// The document is closed:
//   {"version":1,"node":"/abs/node","argv":["/abs/node","/abs/target.js"],"env":{"K":"V"}}
//
// `node` is the absolute target Node. `argv` is the complete target argument
// vector, whose first member is exactly that Node: a document that would keep a
// wrapper in the argument vector is refused. `env` is the complete target
// environment, declared explicitly; nothing is inherited. Admission is pure and
// performs no filesystem access, so a missing or non-executable Node is reported
// by the bootstrap as a host failure rather than as a document refusal.

export const LAUNCH_VERSION = 1;

export const LAUNCH_KEYS = Object.freeze(['version', 'node', 'argv', 'env']);

export class LaunchRefusal extends Error {
  constructor(condition, detail) {
    super(detail === undefined || detail === null ? condition : `${condition}: ${detail}`);
    this.name = 'LaunchRefusal';
    this.condition = condition;
    this.detail = detail === undefined ? null : detail;
  }
}

function refusal(condition, detail) {
  return { ok: false, condition, detail: detail === undefined ? null : detail };
}

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function admitEnv(env) {
  if (!isPlainObject(env)) return refusal('launchEnvInvalid', 'env is not an object');
  for (const key of Object.keys(env)) {
    if (key.length === 0) return refusal('launchEnvInvalid', 'empty name');
    if (key.includes('=')) return refusal('launchEnvInvalid', `name ${key}`);
    if (key.includes('\u0000')) return refusal('launchEnvInvalid', 'NUL in a name');
    const value = env[key];
    if (typeof value !== 'string') return refusal('launchEnvInvalid', `value for ${key} is not text`);
    if (value.includes('\u0000')) return refusal('launchEnvInvalid', `NUL in the value for ${key}`);
  }
  return { ok: true, env: { ...env } };
}

export function admitLaunchDocument(text) {
  if (typeof text !== 'string') return refusal('launchDocumentMalformed', typeof text);
  if (text.length > 0 && text.charCodeAt(0) === 0xfeff) return refusal('launchDocumentBom', null);
  if (text.includes('\u0000')) return refusal('launchDocumentNul', null);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return refusal('launchDocumentMalformed', error.message);
  }
  if (!isPlainObject(parsed)) return refusal('launchDocumentMalformed', 'document is not an object');
  for (const key of Object.keys(parsed)) {
    if (!LAUNCH_KEYS.includes(key)) return refusal('launchDocumentUnknownField', key);
  }
  for (const key of LAUNCH_KEYS) {
    if (!Object.hasOwn(parsed, key)) return refusal('launchDocumentMissingField', key);
  }
  if (parsed.version !== LAUNCH_VERSION) return refusal('launchDocumentVersion', String(parsed.version));
  if (typeof parsed.node !== 'string' || parsed.node.length === 0) {
    return refusal('launchNodeMalformed', String(parsed.node));
  }
  if (!parsed.node.startsWith('/')) return refusal('launchNodeNotAbsolute', parsed.node);
  if (parsed.node.includes('\u0000')) return refusal('launchNodeMalformed', 'NUL in node');
  if (!Array.isArray(parsed.argv) || parsed.argv.length === 0) {
    return refusal('launchArgvInvalid', 'argv is not a nonempty array');
  }
  for (const member of parsed.argv) {
    if (typeof member !== 'string') return refusal('launchArgvInvalid', 'argv member is not text');
    if (member.includes('\u0000')) return refusal('launchArgvInvalid', 'NUL in argv');
  }
  if (parsed.argv[0] !== parsed.node) {
    return refusal('launchArgvMismatch', 'argv[0] must be the selected target Node');
  }
  const env = admitEnv(parsed.env);
  if (!env.ok) return env;
  return {
    ok: true,
    doc: {
      version: LAUNCH_VERSION,
      node: parsed.node,
      argv: [...parsed.argv],
      env: env.env,
    },
  };
}

// The launch document the native keeper sends: the selected absolute Node, the
// complete argument vector and the complete declared environment.
export function encodeLaunchDocument(doc) {
  const admitted = admitLaunchDocument(JSON.stringify(doc));
  if (!admitted.ok) throw new LaunchRefusal(admitted.condition, admitted.detail);
  return JSON.stringify(admitted.doc);
}
