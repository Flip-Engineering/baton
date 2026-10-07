#!/usr/bin/env node
// Series-scoped Git environment and GitHub App HTTPS credential helper.
import { constants as cryptoConstants, sign } from 'node:crypto';
import { accessSync, constants, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import https from 'node:https';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const REPOSITORY = 'Flip-Engineering/baton';
export const PERMISSIONS = { contents: 'write', pull_requests: 'write', metadata: 'read' };
export const API_ROOT = 'https://api.github.com';
export const SERIES = ['gpt', 'muse', 'deepseek', 'claude', 'glm', 'kimi'];
export const SERIES_LABELS = { gpt: 'GPT', muse: 'Muse', deepseek: 'DeepSeek',
  claude: 'Claude', glm: 'GLM', kimi: 'Kimi' };

export class Refusal extends Error {}

function require(condition, message) {
  if (!condition) throw new Refusal(message);
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function path(value) {
  const expanded = value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
  return realpathSync(resolve(expanded));
}

export function public_json(filename) {
  const info = lstatSync(filename);
  require(info.isFile() && info.uid === process.geteuid() && !(info.mode & 0o022),
    'Public identity metadata must be an owned regular file.');
  return JSON.parse(readFileSync(filename, 'utf8'));
}

export function selected_identity(registry_path, model_key = null, series_key = null) {
  const registry = public_json(registry_path);
  require(object(registry) && object(registry.models) && object(registry.series),
    'The series registry is incomplete.');
  if (model_key !== null) require(typeof model_key === 'string' && model_key && !/[\r\n\0]/.test(model_key),
    'The exact model key is invalid.');
  const configured = model_key !== null && Object.hasOwn(registry.models, model_key);
  const mapped = configured ? registry.models[model_key] : null;
  if (configured) require(SERIES.includes(mapped),
    'The exact-model mapping names an invalid series.');
  series_key ??= mapped;
  require(SERIES.includes(series_key) && Object.hasOwn(registry.series, series_key),
    'Select an explicitly configured model mapping or registered series.');
  require(mapped === null || mapped === series_key,
    'The explicit series differs from the configured exact-model mapping.');
  require(typeof registry.series[series_key] === 'string', 'The series registry entry must name a directory.');
  const directory = path(registry.series[series_key]);
  const identity = public_json(join(directory, 'identity-series.json'));
  require(identity.seriesKey === series_key, 'The selected identity belongs to another series.');
  require(identity.displaySeries === SERIES_LABELS[series_key],
    'The public displaySeries must match its selected series label.');
  const github = identity.github ?? {};
  for (const field of ['appId', 'botId', 'installationId', 'repositoryId']) {
    require(Number.isSafeInteger(github[field]) && github[field] > 0,
      'The public identity requires verified positive numeric GitHub IDs.');
  }
  for (const field of ['clientId', 'slug', 'botLogin', 'commitEmail']) {
    require(typeof github[field] === 'string' && github[field] && !/[\r\n\0]/.test(github[field]),
      'The public identity requires verified GitHub names and email.');
  }
  require(/^[A-Za-z0-9-]+$/.test(github.slug), 'The App slug is invalid.');
  require(github.botLogin === github.slug + '[bot]', 'The bot login differs from the App slug.');
  require(github.commitEmail === `${github.botId}+${github.botLogin}@users.noreply.github.com`,
    'The commit email differs from the verified bot identity.');
  require(github.repositoryFullName === REPOSITORY, 'The App identity must name Flip-Engineering/baton.');
  require(isDeepStrictEqual(github.permissions, PERMISSIONS),
    'The App identity permissions differ from the approved permissions.');
  return [series_key, directory, github];
}

function credential_config(key) {
  const lower = key.toLowerCase();
  return lower.startsWith('credential.') || lower === 'core.askpass'
    || (lower.startsWith('http.') && lower.endsWith('.extraheader'));
}

export function shell_quote(value) {
  return value && /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

export function shell_split(value) {
  const words = [];
  let word = '', quote = null, started = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quote === "'") {
      if (char === quote) quote = null;
      else word += char;
    } else if (char === '\\') {
      require(index + 1 < value.length, 'An inherited Git configuration parameter is invalid.');
      const next = value[++index];
      word += quote && next !== quote && next !== '\\' ? '\\' + next : next;
      started = true;
    } else if (quote) {
      if (char === quote) quote = null;
      else word += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (' \t\r\n'.includes(char)) {
      if (started) words.push(word);
      word = '';
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  require(!quote, 'An inherited Git configuration parameter is invalid.');
  if (started) words.push(word);
  return words;
}

export function runtime_pairs(environment) {
  const count = environment.GIT_CONFIG_COUNT || '0';
  require(/^[0-9]+$/.test(count), 'GIT_CONFIG_COUNT is invalid.');
  const pairs = [];
  for (let index = 0; index < Number(count); index++) {
    const key = environment[`GIT_CONFIG_KEY_${index}`], value = environment[`GIT_CONFIG_VALUE_${index}`];
    require(key !== undefined && value !== undefined, 'An inherited Git configuration pair is incomplete.');
    if (!credential_config(key)) pairs.push([key, value]);
  }
  for (const parameter of shell_split(environment.GIT_CONFIG_PARAMETERS || '')) {
    const separator = parameter.indexOf('=');
    require(separator !== -1, 'An inherited Git configuration parameter is invalid.');
    const key = parameter.slice(0, separator), value = parameter.slice(separator + 1);
    if (!credential_config(key)) pairs.push([key, value]);
  }
  return pairs;
}

export function scoped_environment(registry_path, series_key, github, inherited) {
  const environment = { ...inherited }, pairs = runtime_pairs(environment);
  for (const key of Object.keys(environment)) {
    if (/^GIT_CONFIG_(KEY|VALUE)_[0-9]+$/.test(key)) delete environment[key];
  }
  for (const key of ['GIT_CONFIG_PARAMETERS', 'GH_TOKEN', 'GITHUB_TOKEN']) delete environment[key];
  const name = 'Flip Baton - ' + SERIES_LABELS[series_key];
  Object.assign(environment, { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: github.commitEmail,
    GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: github.commitEmail });
  const helper = '!' + [process.execPath, fileURLToPath(import.meta.url), 'helper',
    '--registry', registry_path, '--series-key', series_key].map(shell_quote).join(' ');
  const deny = [process.execPath, fileURLToPath(import.meta.url), 'deny-askpass'].map(shell_quote).join(' ');
  const context = 'https://github.com/' + REPOSITORY;
  pairs.push(['credential.helper', ''], ['credential.interactive', 'false'],
    ['http.extraHeader', ''], ['http.https://github.com/.extraHeader', '']);
  for (const repository_context of [context, context + '.git']) {
    pairs.push([`credential.${repository_context}.helper`, helper],
      [`credential.${repository_context}.useHttpPath`, 'true'],
      [`credential.${repository_context}.username`, 'x-access-token'],
      [`http.${repository_context}.extraHeader`, '']);
  }
  environment.GIT_CONFIG_COUNT = String(pairs.length);
  pairs.forEach(([key, value], index) => {
    environment[`GIT_CONFIG_KEY_${index}`] = key;
    environment[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  environment.GIT_TERMINAL_PROMPT = '0';
  environment.GIT_ASKPASS = deny;
  return environment;
}

function exec_command(program, command, environment) {
  require(typeof process.execve === 'function', 'The Git launcher requires Node 22.15 or later on a POSIX host.');
  const candidates = program.includes('/') ? [program]
    : (environment.PATH ?? '/bin:/usr/bin').split(delimiter).map(directory => join(directory || '.', program));
  for (const filename of candidates) {
    try {
      accessSync(filename, constants.X_OK);
      if (!statSync(filename).isFile()) continue;
    } catch { continue; }
    process.execve(filename, command, environment);
  }
  throw new Refusal('The selected command is not executable.');
}

export function launch(args, inherited = process.env, execute = exec_command) {
  const command = args.command[0] === '--' ? args.command.slice(1) : args.command;
  require(command.length, 'The launcher requires a command.');
  const registry_path = path(args.registry);
  if (args.native_model) {
    require(args.model_key, 'Native validation requires an explicit exact model key.');
    const observed = [];
    for (let index = 1; index < command.length; index++) {
      if (['--model', '-m'].includes(command[index])) {
        require(index + 1 < command.length, 'The native model option requires a value.');
        observed.push(command[index + 1]);
      } else if (command[index].startsWith('--model=')) observed.push(command[index].slice(8));
    }
    require(observed.length && observed.every(model => model === args.model_key),
      'The native model option differs from the explicit exact model key.');
  }
  const [series_key, , github] = selected_identity(registry_path, args.model_key, args.series_key);
  const environment = scoped_environment(registry_path, series_key, github, inherited);
  if (series_key === 'gpt') {
    delete environment.OPENAI_API_KEY;
    delete environment.CODEX_API_KEY;
  }
  execute(command[0], command, environment);
}

// Resolve the configured series identity for an exact model key without
// launching a command. The coordinator runs this before it stores an endpoint or
// a native turn that embeds the key, so an unmapped model is reported at the
// configuration command that names it.
export function check(args) {
  selected_identity(path(args.registry), args.model_key);
}

export async function api(api_path, authorization, body = null, request = https.request) {
  require(api_path.startsWith('/') && !api_path.startsWith('//'), 'The GitHub API path is invalid.');
  return new Promise((accept, refuse) => {
    const failed = () => refuse(new Refusal('The GitHub API request or response verification failed.'));
    try {
      const outgoing = request(API_ROOT + api_path, {
        method: body === null ? 'GET' : 'POST',
        headers: { Authorization: 'Bearer ' + authorization, Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2026-03-10', 'Content-Type': 'application/json', 'User-Agent': 'Baton2-series-git' },
      }, incoming => {
        if (incoming.statusCode >= 300 && incoming.statusCode < 400) {
          refuse(new Refusal('GitHub authentication responses must not redirect.'));
          incoming.resume();
          return;
        }
        if (incoming.statusCode < 200 || incoming.statusCode >= 300) {
          failed();
          incoming.resume();
          return;
        }
        const chunks = [];
        incoming.on('error', failed);
        incoming.on('aborted', failed);
        incoming.on('data', chunk => chunks.push(Buffer.from(chunk)));
        incoming.on('end', () => {
          try { accept(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { failed(); }
        });
      });
      outgoing.on('error', failed);
      outgoing.end(body === null ? undefined : JSON.stringify(body));
    } catch { failed(); }
  });
}

export function app_jwt(directory, github, now = Math.floor(Date.now() / 1000)) {
  const key = join(directory, 'private-key.pem'), info = lstatSync(key);
  require(info.isFile() && info.uid === process.geteuid() && (info.mode & 0o7777) === 0o600,
    'The App private key must be an owned regular file with mode 0600.');
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 600,
    iss: github.clientId })).toString('base64url');
  const unsigned = header + '.' + payload;
  const signature = sign('RSA-SHA256', Buffer.from(unsigned),
    { key: readFileSync(key), padding: cryptoConstants.RSA_PKCS1_PADDING });
  return unsigned + '.' + signature.toString('base64url');
}

function verify_installation(installation, github) {
  require(installation.id === github.installationId && installation.app_id === github.appId
    && installation.app_slug === github.slug,
    'The GitHub installation differs from the selected App identity.');
  require(installation.account?.login === REPOSITORY.split('/')[0]
    && (installation.suspended_at ?? null) === null,
    'The GitHub installation account is incorrect or suspended.');
  require(isDeepStrictEqual(installation.permissions, PERMISSIONS),
    'The GitHub installation permissions differ from the approved permissions.');
}

function valid_expiration(value) {
  if (typeof value !== 'string') return false;
  const fields = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!fields) return false;
  const [, year, month, day, hour, minute, second, , offset_hour, offset_minute] = fields.map((value, index) =>
    index === 0 || index === 7 || value === undefined ? value : Number(value));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && hour < 24 && minute < 60 && second < 60
    && (offset_hour === undefined || (offset_hour < 24 && offset_minute < 60))
    && Date.parse(value) > Date.now();
}

export async function installation_token(directory, github, jwt = app_jwt, request = api) {
  const signed = jwt(directory, github), app = await request('/app', signed);
  require(app.id === github.appId && app.slug === github.slug,
    'The signing key authenticated another GitHub App.');
  if (Object.hasOwn(app, 'client_id')) require(app.client_id === github.clientId, 'The GitHub App client ID differs.');
  verify_installation(await request(`/app/installations/${github.installationId}`, signed), github);
  verify_installation(await request('/repos/' + REPOSITORY + '/installation', signed), github);
  const issued = await request(`/app/installations/${github.installationId}/access_tokens`, signed,
    { repository_ids: [github.repositoryId], permissions: PERMISSIONS });
  require(isDeepStrictEqual(issued.permissions, PERMISSIONS),
    'The issued token permissions differ from the approved permissions.');
  require(typeof issued.token === 'string' && issued.token && !/[\r\n\0]/.test(issued.token),
    'GitHub returned an invalid installation token.');
  require(valid_expiration(issued.expires_at), 'GitHub returned an expired installation token.');
  const repositories = await request('/installation/repositories', issued.token);
  const actual = new Map((repositories.repositories ?? []).map(repo => [repo.id, repo.full_name]));
  require(isDeepStrictEqual(actual, new Map([[github.repositoryId, REPOSITORY]])) && repositories.total_count === 1,
    'The issued token repository access differs from the approved repository.');
  return issued.token;
}

export function credential_context(input) {
  const fields = new Map();
  for (const line of input.split('\n')) {
    if (!line) break;
    const separator = line.indexOf('=');
    require(separator !== -1 && !/[\r\0]/.test(line), 'Git supplied an invalid credential request.');
    const key = line.slice(0, separator), value = line.slice(separator + 1);
    if (key.endsWith('[]')) continue;
    require(!fields.has(key), 'Git supplied an ambiguous credential request.');
    fields.set(key, value);
  }
  require(fields.get('protocol') === 'https' && fields.get('host') === 'github.com'
    && [REPOSITORY, REPOSITORY + '.git'].includes(fields.get('path'))
    && (fields.get('username') ?? 'x-access-token') === 'x-access-token',
    'Git credentials are restricted to the approved HTTPS repository.');
}

export async function helper(args, input = process.stdin, output = process.stdout, issue = installation_token) {
  if (['store', 'erase'].includes(args.operation)) return;
  let context = '';
  input.setEncoding('utf8');
  for await (const chunk of input.iterator({ destroyOnReturn: false })) {
    context += chunk;
    if (context.startsWith('\n') || context.includes('\n\n')) break;
  }
  input.pause();
  credential_context(context);
  const [, directory, github] = selected_identity(path(args.registry), null, args.series_key);
  const token = await issue(directory, github);
  output.write('username=x-access-token\npassword=' + token + '\n\n');
}

export function parse(argv) {
  const [verb, ...options] = argv;
  if (['--help', '-h'].includes(verb)) return { help: true };
  require(['launch', 'helper', 'deny-askpass', 'check'].includes(verb), 'Select launch, helper, deny-askpass or check.');
  const args = { verb, model_key: null, series_key: null, native_model: false, command: [] };
  if (verb === 'deny-askpass') return args;
  for (let index = 0; index < options.length; index++) {
    const option = options[index], separator = option.indexOf('='), name = option.split('=')[0];
    if (['--help', '-h'].includes(option)) return { help: true };
    if (['--registry', '--model-key', '--series-key'].includes(name)) {
      require(verb === 'launch' || verb === 'check' || name !== '--model-key',
        'The helper does not take an exact model option.');
      const value = separator === -1 ? options[++index] : option.slice(separator + 1);
      require(value !== undefined, 'The selected option requires a value.');
      args[name.slice(2).replaceAll('-', '_')] = value;
    } else if (verb === 'launch' && option === '--native-model') args.native_model = true;
    else if (verb === 'launch' && (option === '--' || !option.startsWith('-'))) {
      args.command = options.slice(index);
      break;
    } else {
      require(verb === 'helper' && ['get', 'store', 'erase'].includes(option) && !args.operation,
        'The selected operation or option is invalid.');
      args.operation = option;
    }
  }
  require(args.registry !== undefined, 'The registry option is required.');
  if (args.series_key !== null) require(SERIES.includes(args.series_key), 'The selected series is invalid.');
  if (verb === 'helper') require(args.series_key !== null && args.operation, 'The helper requires a series and operation.');
  if (verb === 'check') require(args.model_key !== null && args.series_key === null,
    'The check takes an exact model key and no series option.');
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const args = parse(argv);
    if (args.help) {
      process.stdout.write('git-series.mjs launch --registry FILE [--model-key MODEL] [--series-key SERIES] [--native-model] -- COMMAND...\n'
        + 'git-series.mjs check --registry FILE --model-key MODEL\n'
        + 'git-series.mjs helper --registry FILE --series-key SERIES get|store|erase\n');
    } else if (args.verb === 'launch') launch(args);
    else if (args.verb === 'check') check(args);
    else if (args.verb === 'helper') await helper(args);
    else return 1;
    return 0;
  } catch (error) {
    process.stderr.write(error instanceof Refusal ? 'Series Git operation refused: ' + error.message + '\n'
      : 'Series Git configuration, signing or response parsing failed.\n');
    return 1;
  }
}

let direct = false;
try { direct = process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url); } catch {}
if (direct) {
  process.exitCode = await main();
}
