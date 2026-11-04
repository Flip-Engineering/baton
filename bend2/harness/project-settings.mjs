// Strict named-route reader composed from issue #703 candidate
// 25f29f0d294031f3c0aab5d90ea877130b8ba9f3, owned task
// root-project-settings-703-20261012. Task startup consumes this reader;
// the original settings feature retains its independent acceptance.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SETTINGS_SCHEMA = 'baton2-project-settings-v1';
export const SETTINGS_RELATIVE_PATH = 'baton2/settings.json';

const ROUTE_HARNESSES = new Set(['codex', 'omp', 'muse', 'claude-code', 'dsh', 'antigravity']);
const SUBSCRIPTION_HARNESSES = new Set(['codex', 'omp', 'muse', 'claude-code', 'claude']);

function refused(reason, detail = null) {
  return Object.freeze({ status: 'refused', reason, detail });
}

function hasDuplicateObjectKeys(text) {
  const stack = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') {
      stack.push({ object: true, keys: new Set(), expectKey: true });
    } else if (char === '[') {
      stack.push({ object: false });
    } else if (char === '}' || char === ']') {
      stack.pop();
    } else if (char === ',' && stack.at(-1)?.object) {
      stack.at(-1).expectKey = true;
    } else if (char === '"') {
      const start = index;
      index += 1;
      while (index < text.length) {
        if (text[index] === '\\') index += 2;
        else if (text[index] === '"') break;
        else index += 1;
      }
      if (index >= text.length) return true;
      const parent = stack.at(-1);
      if (parent?.object && parent.expectKey) {
        let key;
        try {
          key = JSON.parse(text.slice(start, index + 1));
        } catch {
          return true;
        }
        if (parent.keys.has(key)) return true;
        parent.keys.add(key);
        parent.expectKey = false;
      }
    }
  }
  return false;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Control bytes are never valid inside stored settings strings. Labels
// additionally exclude every whitespace character, while stores allow
// spaces but no other whitespace. Lone surrogates are rejected as well so
// no consumer silently replaces invalid bytes when writing UTF-8.
const CONTROL_BYTES = (() => {
  const bytes = [];
  for (let code = 0; code < 32; code += 1) bytes.push(String.fromCharCode(code));
  bytes.push(String.fromCharCode(127));
  for (let code = 128; code < 160; code += 1) bytes.push(String.fromCharCode(code));
  return Object.freeze(bytes);
})();

function hasControlBytes(value) {
  return CONTROL_BYTES.some((byte) => value.includes(byte));
}

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function exactKeys(value, names) {
  if (!isPlainObject(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...names].sort());
}

function validToken(value) {
  return typeof value === 'string' && value.length > 0
    && !hasControlBytes(value) && !hasLoneSurrogate(value);
}

function validLabel(value) {
  return typeof value === 'string' && /^\S+$/.test(value)
    && !hasControlBytes(value) && !hasLoneSurrogate(value);
}

function validStore(value) {
  return typeof value === 'string' && value.length > 0
    && !hasControlBytes(value) && !hasLoneSurrogate(value);
}

function checkRoute(entry, index, seen) {
  if (!isPlainObject(entry)) return `routes[${index}] must be an object`;
  const keys = Object.keys(entry);
  for (const key of ['name', 'harness', 'model', 'effort']) {
    if (!keys.includes(key)) return `routes[${index}] is missing ${key}`;
  }
  for (const key of keys) {
    if (!['name', 'harness', 'model', 'effort', 'profile'].includes(key)) {
      return `routes[${index}] carries an unknown key ${key}`;
    }
  }
  if (!validToken(entry.name)) return `routes[${index}].name must be a nonempty string`;
  if (seen.has(entry.name)) return `routes[${index}].name duplicates ${entry.name}`;
  seen.add(entry.name);
  if (!ROUTE_HARNESSES.has(entry.harness)) {
    return `routes[${index}].harness names an unsupported harness`;
  }
  if (!validToken(entry.model)) return `routes[${index}].model must be a nonempty string`;
  if (!validToken(entry.effort)) return `routes[${index}].effort must be a nonempty string`;
  if (entry.profile !== undefined && !validToken(entry.profile)) {
    return `routes[${index}].profile must be a nonempty string`;
  }
  return null;
}

function checkStringList(entries, field) {
  if (!Array.isArray(entries)) return `${field} must be an array`;
  const seen = new Set();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!validToken(entry)) return `${field}[${index}] must be a nonempty string`;
    if (seen.has(entry)) return `${field}[${index}] duplicates ${entry}`;
    seen.add(entry);
  }
  return null;
}

function checkSubscription(entry, index, seen) {
  if (!exactKeys(entry, ['harness', 'label', 'store'])) {
    return `subscriptions[${index}] must hold exactly harness, label and store`;
  }
  if (!SUBSCRIPTION_HARNESSES.has(entry.harness)) {
    return `subscriptions[${index}].harness names an unsupported harness`;
  }
  if (!validLabel(entry.label)) return `subscriptions[${index}].label must be a nonempty token`;
  if (!validStore(entry.store)) return `subscriptions[${index}].store must be a nonempty path`;
  const key = `${entry.harness} ${entry.label}`;
  if (seen.has(key)) return `subscriptions[${index}] duplicates ${entry.harness} ${entry.label}`;
  seen.add(key);
  return null;
}

// One strict decoder for every consumer. It never throws: every malformed
// input, including malformed escapes and unterminated keys, becomes a
// structured projectSettingsMalformed refusal.
export function decodeSettings(text) {
  try {
    if (hasDuplicateObjectKeys(text)) {
      return refused('projectSettingsMalformed', 'duplicate object key');
    }
    let value;
    try {
      value = JSON.parse(text);
    } catch (error) {
      return refused('projectSettingsMalformed', error.message);
    }
    if (!exactKeys(value, ['schema', 'routes', 'context', 'subscriptions'])) {
      return refused('projectSettingsMalformed', 'top-level keys must be schema, routes, context and subscriptions');
    }
    if (value.schema !== SETTINGS_SCHEMA) {
      return refused('projectSettingsMalformed', 'schema must be baton2-project-settings-v1');
    }
    if (!Array.isArray(value.routes)) return refused('projectSettingsMalformed', 'routes must be an array');
    const names = new Set();
    for (let index = 0; index < value.routes.length; index += 1) {
      const fault = checkRoute(value.routes[index], index, names);
      if (fault !== null) return refused('projectSettingsMalformed', fault);
    }
    if (!exactKeys(value.context, ['disabled', 'preferred'])) {
      return refused('projectSettingsMalformed', 'context must hold exactly disabled and preferred');
    }
    for (const field of ['disabled', 'preferred']) {
      const fault = checkStringList(value.context[field], `context.${field}`);
      if (fault !== null) return refused('projectSettingsMalformed', fault);
    }
    if (!Array.isArray(value.subscriptions)) {
      return refused('projectSettingsMalformed', 'subscriptions must be an array');
    }
    const labels = new Set();
    for (let index = 0; index < value.subscriptions.length; index += 1) {
      const fault = checkSubscription(value.subscriptions[index], index, labels);
      if (fault !== null) return refused('projectSettingsMalformed', fault);
    }
    return Object.freeze({ status: 'decoded', value });
  } catch (error) {
    return refused('projectSettingsMalformed', error.message);
  }
}

export function settingsPathFor(key) {
  return join(key, SETTINGS_RELATIVE_PATH);
}

// The project key mirrors the coordinator: the canonical Git common
// directory, or the canonical path itself outside Git.
export function resolveProjectKey(worktree) {
  const canonical = realpathSync(worktree);
  try {
    const common = execFileSync(
      'git', ['-C', canonical, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).replace(/\n$/, '');
    if (!common) return canonical;
    return realpathSync(common);
  } catch {
    return canonical;
  }
}

export function readSettingsFile(path) {
  const bytes = readFileSync(path);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    return { status: 'refused', reason: 'projectSettingsMalformed', detail: error.message,
      path, bytesHex: bytes.toString('hex') };
  }
  const decoded = decodeSettings(text.startsWith('\uFEFF') ? text.slice(1) : text);
  if (decoded.status !== 'decoded') return { ...decoded, path, body: text };
  return Object.freeze({ status: 'decoded', path, body: text, value: decoded.value });
}

export function subscriptionLines(value) {
  return value.subscriptions.map((entry) => `${entry.harness} ${entry.label} ${entry.store}`);
}

export function routeByName(value, name) {
  return value.routes.find((entry) => entry.name === name) ?? null;
}

// The external store bound to a route profile label for one harness, or
// null when the authoritative subscriptions name no such label.
export function resolveRouteProfile(value, harness, label) {
  const found = value.subscriptions.find(
    (entry) => entry.harness === harness && entry.label === label,
  ) ?? null;
  return found === null ? null : found.store;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let result;
  if (args.length !== 2 || args[0] !== '--inspect') {
    result = refused('projectSettingsArguments', 'Expected --inspect PATH');
  } else {
    let path = args[1];
    try {
      path = settingsPathFor(resolveProjectKey(path));
      result = readSettingsFile(path);
    } catch (error) {
      result = { status: 'refused', reason: 'projectSettingsUnavailable', path,
        detail: error.message, code: error.code ?? null };
    }
  }
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = result.status === 'decoded' ? 0 : 1;
}
