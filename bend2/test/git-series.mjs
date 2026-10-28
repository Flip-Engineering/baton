// Controlled public identities, synthetic signing keys and HTTP responses.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { generateKeyPairSync, verify } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as model from '../harness/git-series.mjs';

const SOURCE = fileURLToPath(new URL('../harness/git-series.mjs', import.meta.url));
const REPOSITORY = 'Flip-Engineering/baton';
const retained = resolve(dirname(fileURLToPath(import.meta.url)), '../../.scratch/git-series-node-fixtures');
mkdirSync(retained, { recursive: true });
const directory = mkdtempSync(join(retained, 'public-'));
const registry = join(directory, "series λ '.json");
const models = { 'gpt-6-astra': 'gpt', 'kimi-code/k3': 'kimi', 'deepseek/deepseek-flash': 'deepseek',
  'muse-spark-1.3-contributor': 'muse', 'fixture/gpt-next-exact': 'gpt' };
const identities = {}, series = {};
function save(filename, value) {
  writeFileSync(filename, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}
for (const [index, key] of model.SERIES.entries()) {
  const home = join(directory, "App fixture λ ' " + key);
  mkdirSync(home);
  const slug = 'fixture-series-' + key, botId = 9000 + index;
  identities[key] = { appId: 1000 + index, clientId: 'fixture-client-' + index,
    slug, botLogin: slug + '[bot]', botId, commitEmail: `${botId}+${slug}[bot]@users.noreply.github.com`,
    installationId: 2000 + index, permissions: { ...model.PERMISSIONS } };
  save(join(home, 'identity-series.json'), { seriesKey: key, displaySeries: model.SERIES_LABELS[key], github: identities[key] });
  save(join(home, 'identity.json'), { modelKey: 'preserved-old-metadata', github: { appId: -1 } });
  series[key] = home;
}
save(registry, { models, series });
save(join(directory, 'BOUNDARY.json'), { actual_credentials: false, actual_profile_reads: false,
  provider_execution: false, network: false, public_metadata: 'invented',
  signing: 'generated fixture key only', launch: 'controlled Node child only' });
function args(key, command, native = false, selected = null, repository = null) {
  return { registry, model_key: key, series_key: selected, repository, native_model: native, command };
}
function execution(selected, environment = {}) {
  let observed;
  model.launch(selected, environment, (...values) => { observed = values; });
  return observed;
}
// Fake GitHub responses. `installed` lists the account owners with an App
// installation. `tamper` overrides one field of one response for a negative case.
function installation_api(github, installed, tamper = {}, permissions = model.PERMISSIONS) {
  const calls = [];
  const answer = (name, value) => ({ ...value, ...(tamper.name === name ? { [tamper.field]: tamper.value } : {}) });
  const request = async (api_path, authorization, body) => {
    calls.push({ api_path, authorization, body });
    if (api_path === '/app') return answer('app', { id: github.appId, slug: github.slug, client_id: github.clientId, permissions });
    const lookup = /^\/repos\/([^/]+)\/([^/]+)\/installation$/.exec(api_path);
    if (lookup) {
      const found = installed.find(entry => entry.owner === lookup[1]);
      const repository = lookup[1] + '/' + lookup[2];
      if (!found || (found.repositories && !found.repositories.some(name => model.same_repository(name, repository)))) {
        throw new model.Missing(`GitHub API GET ${api_path} returned HTTP 404: Not Found.`);
      }
      return answer('lookup', { id: found.id, app_id: github.appId, app_slug: github.slug,
        account: { login: found.owner }, suspended_at: null, permissions: { ...(found.permissions ?? permissions) } });
    }
    const access = /^\/app\/installations\/([0-9]+)\/access_tokens$/.exec(api_path);
    assert.ok(access, api_path);
    const owner = installed.find(entry => String(entry.id) === access[1]).owner;
    const granted = installed.find(entry => String(entry.id) === access[1])?.permissions ?? permissions;
    return answer('issue', { token: 'fixture-token-' + access[1], permissions: { ...(body?.permissions ?? granted) },
      repository_selection: body.repositories ? 'selected' : 'all',
      repositories: body.repositories?.map(name => ({ full_name: owner + '/' + name })),
      expires_at: new Date(Date.now() + 86400000).toISOString() });
  };
  return { calls, request };
}
function child(argv, { cwd = directory, input = '', env = { PATH: process.env.PATH } } = {}) {
  return new Promise((accept, reject) => {
    const processChild = spawn(process.execPath, argv, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [], stderr = [], started = Date.now();
    processChild.on('error', reject);
    processChild.stdout.on('data', chunk => stdout.push(chunk));
    processChild.stderr.on('data', chunk => stderr.push(chunk));
    processChild.stdin.end(input);
    processChild.on('close', (code, signal) => {
      const result = { pid: processChild.pid, code, signal, cwd, argv, started, ended: Date.now(),
        stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
      save(join(directory, 'child-' + processChild.pid + '.json'), result);
      accept(result);
    });
  });
}

const credentialHome = join(directory, 'credential-home');
mkdirSync(credentialHome, { recursive: true });
function credentialEnvironment(extra = {}) {
  return { PATH: process.env.PATH, HOME: credentialHome,
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0', ...extra };
}

test('exact models and all six series select fixed public metadata and friendly Git identities', () => {
  for (const key of model.SERIES) {
    const [selected, home, github] = model.selected_identity(registry, null, key);
    assert.equal(selected, key);
    assert.deepEqual(github, identities[key]);
    assert.ok(existsSync(join(home, 'identity.json')));
    const [, command, environment] = execution(args(null, ['git', 'commit', '-m', 'Fixture commit'], false, key));
    assert.deepEqual(command, ['git', 'commit', '-m', 'Fixture commit']);
    for (const field of ['GIT_AUTHOR_NAME', 'GIT_COMMITTER_NAME']) assert.equal(environment[field], 'Flip Baton - ' + model.SERIES_LABELS[key]);
    for (const field of ['GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_EMAIL']) assert.equal(environment[field], github.commitEmail);
  }
  for (const [key, selected] of Object.entries(models)) {
    for (const option of [['--model', key], ['-m', key], ['--model=' + key]]) {
      assert.equal(execution(args(key, ['native-fixture', ...option], true))[2].GIT_AUTHOR_EMAIL, identities[selected].commitEmail);
    }
  }
  const null_mapping = join(directory, 'literal-null-model.json');
  save(null_mapping, { models: { ...models, null: 'gpt' }, series });
  assert.equal(model.selected_identity(null_mapping, null, 'glm')[0], 'glm');
  assert.equal(model.selected_identity(null_mapping, 'null')[0], 'gpt');
  assert.throws(() => model.selected_identity(null_mapping, 'null', 'glm'), model.Refusal);
});

test('each push resolves the installation of its repository owner without a repository allowlist', async () => {
  const github = identities.gpt;
  const fixture = installation_api(github, [{ owner: 'Flip-Engineering', id: 5100 },
    { owner: 'flip-engineer', id: 5200 }]);
  const issue = (home, identity, repository) =>
    model.installation_token(home, identity, repository, () => 'fixture-jwt-no-key', fixture.request);
  for (const [repository, id] of [['Flip-Engineering/baton', 5100], ['flip-engineer/flip', 5200]]) {
    const input = new PassThrough(); let text = '';
    const response = model.helper({ registry, series_key: 'gpt', operation: 'get' }, input,
      { write(value) { text += value; } }, issue);
    input.end(`protocol=https\nhost=github.com\npath=${repository}.git\n\n`);
    await response;
    assert.equal(text, `username=x-access-token\npassword=fixture-token-${id}\n\n`);
  }
  assert.deepEqual(fixture.calls.map(call => call.api_path), [
    '/app', '/repos/Flip-Engineering/baton/installation', '/app/installations/5100/access_tokens',
    '/app', '/repos/flip-engineer/flip/installation', '/app/installations/5200/access_tokens']);
  for (const call of fixture.calls.filter(call => call.api_path.endsWith('/access_tokens'))) {
    assert.deepEqual(call.body, { permissions: model.PERMISSIONS });
  }
});

test('an uninstalled repository refuses and names the repository, App and checked account', async () => {
  const github = identities.gpt;
  const fixture = installation_api(github, [{ owner: 'Flip-Engineering', id: 5100 }]);
  await assert.rejects(model.installation_token(series.gpt, github, 'flip-engineer/flip', () => 'fixture-jwt-no-key', fixture.request),
    error => error instanceof model.Refusal && error.message.includes('flip-engineer/flip')
      && error.message.includes('fixture-series-gpt') && error.message.includes('account flip-engineer')
      && error.message.includes('HTTP 404'));
  assert.ok(!fixture.calls.some(call => call.api_path.includes('/access_tokens')));
});

test('check accepts a repository in the selected App installation and refuses a same-name wrong-owner repository', async () => {
  const github = identities.gpt;
  const fixture = installation_api(github, [
    { owner: 'Flip-Engineering', id: 5100, repositories: ['Flip-Engineering/baton'] },
    { owner: 'flip-engineer', id: 5200, repositories: ['flip-engineer/flip'] }]);
  assert.equal(await model.check({ registry, model_key: 'gpt-6-astra', repository: 'flip-engineer/flip' },
    () => 'fixture-jwt-no-key', fixture.request), undefined);
  await assert.rejects(model.check({ registry, model_key: 'gpt-6-astra', repository: 'Flip-Engineering/flip' },
    () => 'fixture-jwt-no-key', fixture.request), error => error instanceof model.Refusal
      && error.message.includes('Flip-Engineering/flip') && error.message.includes('fixture-series-gpt')
      && error.message.includes('account Flip-Engineering') && error.message.includes('HTTP 404'));
  assert.deepEqual(fixture.calls.map(call => call.api_path), ['/app', '/repos/flip-engineer/flip/installation',
    '/app', '/repos/Flip-Engineering/flip/installation']);
});

test('Git credentials accept granted workflow and actions permissions and keep the token request subset', async () => {
  for (const extra of [{}, { workflows: 'write' }, { workflows: 'write', actions: 'read' }]) {
    const permissions = { contents: 'write', pull_requests: 'write', metadata: 'read', ...extra };
    const fixture = installation_api(identities.gpt, [{ owner: 'Flip-Engineering', id: 5100 },
      { owner: 'flip-engineer', id: 5200 }], { name: 'lookup', field: 'permissions', value: permissions });
    const issue = (home, identity, repository) => model.installation_token(home, identity, repository,
      () => 'fixture-jwt-no-key', fixture.request);
    for (const repository of ['Flip-Engineering/baton', 'flip-engineer/flip']) {
      let response = '';
      await model.helper({ registry, series_key: 'gpt', repository, operation: 'get' },
        Readable.from([`protocol=https\nhost=github.com\npath=${repository}.git\n\n`]),
        { write(value) { response += value; } }, issue);
      assert.ok(response.startsWith('username=x-access-token\npassword=fixture-token-'));
      assert.deepEqual(fixture.calls.at(-1).body,
        { permissions: { contents: 'write', pull_requests: 'write', metadata: 'read' } });
    }
  }
});

test('identity metadata and issued tokens accept additional granted permissions', async () => {
  const permissions = { contents: 'write', pull_requests: 'write', metadata: 'read', workflows: 'write' };
  const home = join(directory, 'expanded-grants'); mkdirSync(home);
  save(join(home, 'identity-series.json'), { seriesKey: 'gpt', displaySeries: 'GPT',
    github: { ...identities.gpt, permissions } });
  const alternative = join(directory, 'expanded-registry.json');
  save(alternative, { models, series: { ...series, gpt: home } });
  assert.deepEqual(model.selected_identity(alternative, null, 'gpt')[2].permissions, permissions);
  const fixture = installation_api(identities.gpt, [{ owner: 'Flip-Engineering', id: 5100 }],
    { name: 'issue', field: 'permissions', value: permissions });
  assert.ok(await model.installation_token(home, identities.gpt, REPOSITORY,
    () => 'fixture-jwt-no-key', fixture.request));
});

test('missing or weaker Git permissions are refused by name in identities, installations and tokens', async () => {
  const home = join(directory, 'insufficient-grants'); mkdirSync(home);
  const alternative = join(directory, 'insufficient-registry.json');
  save(alternative, { models, series: { ...series, gpt: home } });
  for (const [permission, required] of Object.entries({ contents: 'write', pull_requests: 'write', metadata: 'read' })) {
    for (const level of [undefined, 'none', ...(required === 'write' ? ['read'] : [])]) {
      const permissions = { ...model.PERMISSIONS, workflows: 'write' };
      if (level === undefined) delete permissions[permission];
      else permissions[permission] = level;
      const namedRefusal = error => error instanceof model.Refusal && error.message.includes(permission + ':' + required);
      save(join(home, 'identity-series.json'), { seriesKey: 'gpt', displaySeries: 'GPT',
        github: { ...identities.gpt, permissions } });
      assert.throws(() => model.selected_identity(alternative, null, 'gpt'), namedRefusal);
      for (const name of ['lookup', 'issue']) {
        const fixture = installation_api(identities.gpt, [{ owner: 'Flip-Engineering', id: 5100 }],
          { name, field: 'permissions', value: permissions });
        await assert.rejects(model.installation_token(home, identities.gpt, REPOSITORY,
          () => 'fixture-jwt-no-key', fixture.request), namedRefusal);
        if (name === 'lookup') assert.ok(!fixture.calls.some(call => call.api_path.endsWith('/access_tokens')));
      }
    }
  }
});

test('Git tokens keep their permission subset after an installation gains seat CLI permissions', async () => {
  const grants = { ...model.GH_PERMISSIONS, workflows: 'write' };
  const fixture = installation_api(identities.gpt, [{ owner: 'Flip-Engineering', id: 5100 }], {}, grants);
  await model.installation_token(series.gpt, identities.gpt, REPOSITORY, () => 'fixture-jwt', fixture.request);
  assert.deepEqual(fixture.calls.at(-1).body,
    { permissions: { contents: 'write', pull_requests: 'write', metadata: 'read' } });
});

test('gh tokens request the full installation grant and accept stronger permissions', async () => {
  assert.deepEqual(model.GH_PERMISSIONS, { contents: 'write', pull_requests: 'write', metadata: 'read',
    issues: 'write', actions: 'read', checks: 'read', statuses: 'read' });
  for (const grants of [model.GH_PERMISSIONS,
    { ...model.GH_PERMISSIONS, actions: 'write', checks: 'write', statuses: 'write', workflows: 'write' }]) {
    const fixture = installation_api(identities.gpt, [{ owner: 'Flip-Engineering', id: 5100 }], {}, grants);
    assert.ok(await model.gh_installation_token(series.gpt, identities.gpt, REPOSITORY,
      () => 'fixture-jwt', fixture.request));
    assert.deepEqual(fixture.calls.at(-1).body, {});
  }
});

test('gh refuses each missing or weaker installation and token grant with its permission name', async () => {
  for (const [permission, required] of Object.entries(model.GH_PERMISSIONS)) {
    for (const level of [undefined, 'none', ...(required === 'write' ? ['read'] : [])]) {
      const grants = { ...model.GH_PERMISSIONS };
      if (level === undefined) delete grants[permission];
      else grants[permission] = level;
      for (const name of ['lookup', 'issue']) {
        const fixture = installation_api(identities.gpt, [{ owner: 'Flip-Engineering', id: 5100 }],
          { name, field: 'permissions', value: grants }, model.GH_PERMISSIONS);
        await assert.rejects(model.gh_installation_token(series.gpt, identities.gpt, REPOSITORY,
          () => 'fixture-jwt', fixture.request), error => error instanceof model.Refusal
            && error.message.includes(permission + ':' + required));
        if (name === 'lookup') assert.ok(!fixture.calls.some(call => call.api_path.endsWith('/access_tokens')));
      }
    }
  }
});

test('gh checks the target owner installation while narrow Git installations remain usable', async () => {
  const fixture = installation_api(identities.gpt, [
    { owner: 'Flip-Engineering', id: 5100, permissions: model.GH_PERMISSIONS },
    { owner: 'flip-engineer', id: 5200, permissions: model.PERMISSIONS }]);
  await model.gh_installation_token(series.gpt, identities.gpt, REPOSITORY, () => 'fixture-jwt', fixture.request);
  await assert.rejects(model.gh_installation_token(series.gpt, identities.gpt,
    'flip-engineer/automated-content-pipeline', () => 'fixture-jwt', fixture.request), /issues:write/);
  assert.ok(!fixture.calls.some(call => call.api_path === '/app/installations/5200/access_tokens'));
  await model.installation_token(series.gpt, identities.gpt,
    'flip-engineer/automated-content-pipeline', () => 'fixture-jwt', fixture.request);
  assert.equal(fixture.calls.at(-1).api_path, '/app/installations/5200/access_tokens');
  assert.deepEqual(fixture.calls.at(-1).body, { permissions: model.PERMISSIONS });
});

test('gh selects repository arguments, GH_REPO and GitHub origin in order', () => {
  const origin = () => 'origin-owner/project';
  for (const flags of [['-R', 'explicit/project'], ['--repo', 'explicit/project'],
    ['--repo=explicit/project'], ['-Rexplicit/project']]) {
    assert.equal(model.gh_repository(['pr', 'checks', ...flags], { GH_REPO: 'environment/project' },
      () => assert.fail('origin queried')), 'explicit/project');
  }
  assert.equal(model.gh_repository(['api', 'repos/{owner}/{repo}/checks'], { GH_REPO: 'environment/project' },
    () => assert.fail('origin queried')), 'environment/project');
  assert.equal(model.gh_repository(['issue', 'comment', '--', '-Rignored/project'], {}, origin), 'origin-owner/project');
  const repository = join(directory, 'gh-origin'); mkdirSync(repository);
  const git = (...command) => execFileSync('git', ['-C', repository, ...command], { env: credentialEnvironment() });
  git('init', '-q');
  for (const remote of ['https://github.com/origin-owner/project.git', 'git@github.com:origin-owner/project.git',
    'ssh://git@github.com/origin-owner/project.git']) {
    git('config', 'remote.origin.url', remote);
    const saved = process.cwd();
    try {
      process.chdir(repository);
      assert.equal(model.gh_repository(['pr', 'checks'], credentialEnvironment()), 'origin-owner/project');
    } finally { process.chdir(saved); }
  }
  for (const command of [['auth', 'status'], ['api', '/user']]) {
    assert.throws(() => model.gh_repository(command, {}, () => null), /owner could not be resolved/);
  }
  for (const command of [['pr', 'checks', '-R'], ['pr', 'checks', '--repo='], ['pr', 'checks', '-R', 'invalid']]) {
    assert.throws(() => model.gh_repository(command, {}, origin), model.Refusal);
  }
});

test('gh requests a fresh owner token per command and keeps it in the gh child environment', async () => {
  const bin = join(directory, 'real-gh'); mkdirSync(bin);
  const program = join(bin, 'gh');
  writeFileSync(program, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const inherited = { PATH: bin, GH_TOKEN: 'fixture-sender', GITHUB_TOKEN: 'fixture-sender' };
  const environment = execution(args(null, ['seat'], false, 'gpt'), inherited)[2];
  assert.equal(environment.PATH.split(delimiter)[0], join(dirname(SOURCE), 'git-series-bin') + '/');
  assert.ok(!('GH_TOKEN' in environment) && !('GITHUB_TOKEN' in environment));
  const original = { ...environment };
  const fixture = installation_api(identities.gpt, [{ owner: 'Flip-Engineering', id: 5100 },
    { owner: 'flip-engineer', id: 5200 }], {}, model.GH_PERMISSIONS);
  const issue = (home, github, repository) => model.gh_installation_token(home, github, repository,
    () => 'fixture-jwt-no-key', fixture.request);
  const observed = [];
  for (const repository of ['Flip-Engineering/baton', 'flip-engineer/flip', 'flip-engineer/flip']) {
    const command = ['pr', 'checks', '-R', repository];
    await model.gh(command, environment, (selected, argv, childEnvironment) => {
      assert.equal(selected, program);
      assert.deepEqual(argv, [program, ...command]);
      assert.ok(!('GITHUB_TOKEN' in childEnvironment));
      observed.push(childEnvironment.GH_TOKEN);
    }, issue);
    assert.deepEqual(environment, original);
    assert.ok(inherited.GH_TOKEN === 'fixture-sender');
  }
  assert.ok(observed[0] !== observed[1]);
  assert.equal(fixture.calls.filter(call => call.api_path.endsWith('/access_tokens')).length, 3);
  await assert.rejects(model.gh(['auth', 'status'], environment,
    () => assert.fail('executed'), () => assert.fail('token issued'), () => null), /owner could not be resolved/);
});

test('the executable gh wrapper reaches real gh and preserves its arguments, PID, streams and exit', async () => {
  const home = join(directory, 'gh-executable'); mkdirSync(home);
  const bin = join(home, 'bin'); mkdirSync(bin);
  const github = identities.gpt;
  save(join(home, 'identity-series.json'), { seriesKey: 'gpt', displaySeries: 'GPT', github });
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  writeFileSync(join(home, 'private-key.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const alternative = join(home, 'registry.json'); save(alternative, { models, series: { gpt: home } });
  const preload = join(home, 'fake-api.mjs');
  writeFileSync(preload, `import https from 'node:https';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
https.request = (url, options, received) => {
  const outgoing = new EventEmitter();
  outgoing.end = body => {
    const path = new URL(url).pathname;
    let response;
    if (path === '/app') response = ${JSON.stringify({ id: github.appId, slug: github.slug })};
    else if (path === '/repos/flip-engineer/flip/installation') response = ${JSON.stringify({
      id: 5200, app_id: github.appId, app_slug: github.slug, account: { login: 'flip-engineer' },
      permissions: model.GH_PERMISSIONS })};
    else if (path === '/app/installations/5200/access_tokens' && body === '{}') {
      response = { token: 'fixture-' + 5200, permissions: ${JSON.stringify(model.GH_PERMISSIONS)},
        expires_at: new Date(Date.now() + 3600000).toISOString() };
    } else throw Error('Unexpected fixture request');
    const incoming = new PassThrough(); incoming.statusCode = 200;
    queueMicrotask(() => { received(incoming); incoming.end(JSON.stringify(response)); });
  };
  return outgoing;
};\n`);
  writeFileSync(join(bin, 'gh'), `#!${process.execPath}
let input = ''; for await (const chunk of process.stdin) input += chunk;
process.stdout.write(JSON.stringify({ pid: process.pid, argv: process.argv.slice(2), input,
  authenticated: process.env.GH_TOKEN === 'fixture-' + 5200,
  senderRemoved: !('GITHUB_TOKEN' in process.env) }));
process.stderr.write('gh fixture diagnostic\\n'); process.exitCode = 7;\n`, { mode: 0o755 });
  const wrapper = join(dirname(SOURCE), 'git-series-bin/gh');
  const previous = join(home, 'previous-prefix/git-series-bin'); mkdirSync(previous, { recursive: true });
  copyFileSync(SOURCE, join(dirname(previous), 'git-series.mjs'));
  copyFileSync(wrapper, join(previous, 'gh')); chmodSync(join(previous, 'gh'), 0o755);
  // Nested source and installed launches share the seat's PATH.
  const environment = { PATH: [dirname(wrapper), previous, dirname(wrapper), bin, dirname(process.execPath)].join(delimiter),
    NODE_OPTIONS: '--import=' + pathToFileURL(preload).href, GH_REPO: 'flip-engineer/flip' };
  const result = await child([SOURCE, 'launch', '--registry', alternative, '--series-key', 'gpt',
    '--', 'gh', 'pr', 'checks', '--json', 'name,state'], { env: environment, input: 'fixture input\n' });
  assert.equal(result.code, 7, result.stderr); assert.equal(result.signal, null);
  const observed = JSON.parse(result.stdout);
  assert.equal(observed.pid, result.pid);
  assert.deepEqual(observed.argv, ['pr', 'checks', '--json', 'name,state']);
  assert.equal(observed.input, 'fixture input\n');
  assert.ok(observed.authenticated && observed.senderRemoved);
  assert.ok(result.stderr.endsWith('gh fixture diagnostic\n'));
  for (const command of [['issue', 'view', '291'], ['issue', 'view', '292'],
    ['issue', 'comment', '291', '--body', 'Fixture comment'], ['pr', 'view', '1'],
    ['pr', 'create', '--title', 'Fixture PR', '--body', 'Fixture body'],
    ['run', 'list'], ['run', 'view', '123', '--log']]) {
    const result = await child([wrapper, ...command], {
      env: { ...environment, BATON2_GH_REGISTRY: alternative, BATON2_GH_SERIES: 'gpt' } });
    assert.equal(result.code, 7, result.stderr);
    const observed = JSON.parse(result.stdout);
    assert.deepEqual(observed.argv, command);
    assert.ok(observed.authenticated && observed.senderRemoved);
    assert.ok(!result.stdout.includes('fixture-' + 5200));
  }
  const refusal = await child([wrapper, 'auth', 'status'], { env: { PATH: environment.PATH } });
  assert.equal(refusal.code, 1); assert.equal(refusal.stdout, '');
  assert.match(refusal.stderr, /owner could not be resolved/);
});

test('a retained repositories map is not read and the series directory serves every repository', () => {
  const retained = join(directory, 'retained-repositories.json');
  save(retained, { models, series, repositories: { 'flip-engineer/flip': { series: { gpt: join(directory, 'missing') } } } });
  const [, home] = model.selected_identity(retained, 'gpt-6-astra');
  assert.equal(home, series.gpt);
});

test('scoped environment names the assigned repository only when one is assigned', async () => {
  const pairsOf = environment => Object.fromEntries(Array.from({ length: Number(environment.GIT_CONFIG_COUNT) },
    (_, index) => [environment[`GIT_CONFIG_KEY_${index}`], environment[`GIT_CONFIG_VALUE_${index}`]]));
  const unscoped = pairsOf(model.scoped_environment(registry, 'gpt', identities.gpt, {}));
  assert.deepEqual(model.shell_split(unscoped['credential.https://github.com.helper'].slice(1)),
    [process.execPath, SOURCE, 'helper', '--registry', registry, '--series-key', 'gpt']);
  assert.equal(unscoped['credential.https://github.com.useHttpPath'], 'true');
  assert.ok(!Object.keys(unscoped).some(key => key.startsWith('credential.https://github.com/')));
  const scoped = pairsOf(model.scoped_environment(registry, 'gpt', identities.gpt, {}, undefined, undefined, REPOSITORY));
  assert.deepEqual(model.shell_split(scoped[`credential.https://github.com/${REPOSITORY}.helper`].slice(1)),
    [process.execPath, SOURCE, 'helper', '--registry', registry, '--series-key', 'gpt', '--repository', REPOSITORY]);
  assert.ok(!('credential.https://github.com.helper' in scoped));
  await assert.rejects(model.helper({ registry, series_key: 'gpt', repository: 'flip-engineer/flip', operation: 'get' },
    Readable.from(['protocol=https\nhost=github.com\npath=Flip-Engineering/baton.git\n\n']),
    { write() { assert.fail('unexpected credential'); } }, () => assert.fail('unexpected authentication')), model.Refusal);
});

test('the configured askpass executable runs and denies without a credential route', async () => {
  const environment = model.scoped_environment(registry, 'gpt', identities.gpt, credentialEnvironment(), undefined, undefined, REPOSITORY);
  const result = await new Promise((accept, reject) => {
    const processChild = spawn('git', ['credential', 'fill'], { cwd: directory, env: environment,
      stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [], stderr = [];
    processChild.on('error', reject);
    processChild.stdout.on('data', chunk => stdout.push(chunk));
    processChild.stderr.on('data', chunk => stderr.push(chunk));
    processChild.stdin.end('protocol=https\nhost=github.com\npath=other/repository.git\n\n');
    processChild.on('close', code => accept({ code, stdout: Buffer.concat(stdout).toString(),
      stderr: Buffer.concat(stderr).toString() }));
  });
  assert.equal(result.code, 128, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /unable to read askpass response from ['"]?false['"]?|unable to get password from user/);
  assert.doesNotMatch(result.stderr, /cannot exec/);
  assert.doesNotMatch(result.stderr, /Series Git/);
});

test('an inherited literal multi-word askpass cannot exec and is replaced by controlled denial', async () => {
  const repository = 'flip-engineer/automated-content-pipeline';
  const production = [process.execPath, SOURCE, 'deny-askpass'].join(' ');
  const request = `protocol=https\nhost=github.com\npath=${repository}.git\n\n`;
  const credential = environment => new Promise((accept, reject) => {
    const processChild = spawn('git', ['credential', 'fill'], { cwd: directory, env: environment,
      stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [], stderr = [];
    processChild.on('error', reject);
    processChild.stdout.on('data', chunk => stdout.push(chunk));
    processChild.stderr.on('data', chunk => stderr.push(chunk));
    processChild.stdin.end(request);
    processChild.on('close', code => accept({ code, stdout: Buffer.concat(stdout).toString(),
      stderr: Buffer.concat(stderr).toString() }));
  });

  const isolated = credentialEnvironment({ GIT_ASKPASS: production });
  assert.equal(isolated.HOME, credentialHome);
  assert.equal(isolated.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.equal(isolated.GIT_CONFIG_NOSYSTEM, '1');
  const raw = await credential(isolated);
  assert.equal(raw.code, 128, raw.stderr);
  assert.equal(raw.stdout, '');
  if (/cannot exec/.test(raw.stderr)) {
    assert.match(raw.stderr, /No such file or directory/);
  } else {
    assert.match(raw.stderr, /unable to read askpass response|unable to get password from user/);
  }
  assert.match(raw.stderr, /could not read Username|unable to get password from user/);
  assert.doesNotMatch(raw.stderr, /Series Git|password=/);

  const inherited = credentialEnvironment({ GIT_ASKPASS: production,
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.askpass', GIT_CONFIG_VALUE_0: production });
  const environment = model.scoped_environment(registry, 'gpt', identities.gpt, inherited, undefined, undefined, REPOSITORY);
  assert.equal(environment.GIT_ASKPASS, 'false');
  const pairs = Array.from({ length: Number(environment.GIT_CONFIG_COUNT) }, (_, index) =>
    [environment[`GIT_CONFIG_KEY_${index}`], environment[`GIT_CONFIG_VALUE_${index}`]]);
  assert.ok(!pairs.some(([key, value]) => key === 'core.askpass' || value === production));

  const scoped = await credential(environment);
  assert.equal(scoped.code, 128, scoped.stderr);
  assert.equal(scoped.stdout, '');
  assert.match(scoped.stderr, /unable to read askpass response from ['"]?false['"]?|unable to get password from user/);
  assert.doesNotMatch(scoped.stderr, /cannot exec/);
  assert.doesNotMatch(scoped.stderr, /deny-askpass|Series Git/);
  assert.equal(environment.HOME, credentialHome);
  assert.equal(environment.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.equal(environment.GIT_CONFIG_NOSYSTEM, '1');

  assert.throws(() => model.credential_context(request, 'Flip-Engineering/baton'), model.Refusal);
});

test('shared registry attribution changes Git headers and leaves selected App identities intact', async () => {
  const sharedRegistry = join(directory, 'shared-attribution.json');
  const attribution = { name: 'Flip - Baton', email: 'baton@example.invalid' };
  const repository = join(directory, 'shared-attribution-repository');
  save(sharedRegistry, { models, series, attribution });
  async function gitWith(registryPath, key, ...command) {
    return child([SOURCE, 'launch', '--registry', registryPath, '--series-key', key, '--', 'git', ...command]);
  }
  const git = (key, ...command) => gitWith(sharedRegistry, key, ...command);
  const initialized = await git('gpt', 'init', '--bare', repository);
  assert.equal(initialized.code, 0, initialized.stderr);
  const tree = await git('gpt', '-C', repository, 'hash-object', '-w', '-t', 'tree', '--stdin');
  assert.equal(tree.code, 0, tree.stderr);
  for (const key of model.SERIES) {
    const [selected, , github, email, name] = model.selected_identity(sharedRegistry, null, key);
    assert.equal(selected, key);
    assert.deepEqual(github, identities[key]);
    assert.equal(name, attribution.name);
    assert.equal(email, attribution.email);
    const committed = await git(key, '-C', repository, 'commit-tree', tree.stdout.trim(), '-m', 'Shared attribution fixture');
    assert.equal(committed.code, 0, committed.stderr);
    const readback = await git(key, '-C', repository, 'cat-file', 'commit', committed.stdout.trim());
    assert.equal(readback.code, 0, readback.stderr);
    for (const field of ['author', 'committer']) {
      assert.ok(readback.stdout.split('\n').some(line => line.startsWith(
        `${field} ${attribution.name} <${attribution.email}> `)), readback.stdout);
    }
  }
  const sharedOnly = join(directory, 'shared-attribution-only.json');
  save(sharedOnly, { models, series });
  const gptIdentityPath = join(series.gpt, 'identity-series.json');
  const originalIdentity = readFileSync(gptIdentityPath);
  try {
    save(gptIdentityPath, { seriesKey: 'gpt', displaySeries: 'GPT', authorEmail: 'gpt-author@example.invalid',
      github: identities.gpt });
    const [selected, , github, email, name] = model.selected_identity(sharedOnly, null, 'gpt');
    assert.equal(selected, 'gpt');
    assert.deepEqual(github, identities.gpt);
    assert.equal(name, 'Flip Baton - GPT');
    assert.equal(email, 'gpt-author@example.invalid');
    const perSeriesCommit = await gitWith(sharedOnly, 'gpt', '-C', repository, 'commit-tree', tree.stdout.trim(), '-m', 'Series attribution fixture');
    assert.equal(perSeriesCommit.code, 0, perSeriesCommit.stderr);
    const perSeriesReadback = await gitWith(sharedOnly, 'gpt', '-C', repository, 'cat-file', 'commit', perSeriesCommit.stdout.trim());
    assert.equal(perSeriesReadback.code, 0, perSeriesReadback.stderr);
    assert.ok(perSeriesReadback.stdout.split('\n').some(line =>
      line.startsWith('author Flip Baton - GPT <gpt-author@example.invalid> ')), perSeriesReadback.stdout);
    assert.ok(perSeriesReadback.stdout.split('\n').some(line =>
      line.startsWith('committer Flip Baton - GPT <gpt-author@example.invalid> ')), perSeriesReadback.stdout);
  } finally {
    writeFileSync(gptIdentityPath, originalIdentity, { mode: 0o600 });
  }
});

test('inherited shared Git identity configuration cannot override the selected series headers', async () => {
  const repository = join(directory, 'shared-config-repository');
  const environment = {
    PATH: process.env.PATH,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'Shared fixture',
    GIT_CONFIG_KEY_1: 'user.email', GIT_CONFIG_VALUE_1: 'fixture@example.invalid',
  };
  const launch = (key, ...command) => child(
    [SOURCE, 'launch', '--registry', registry, '--series-key', key, '--', 'git', ...command],
    { env: environment });
  const initialized = await launch('gpt', 'init', '--bare', repository);
  assert.equal(initialized.code, 0, initialized.stderr);
  const tree = await launch('gpt', '-C', repository, 'hash-object', '-w', '-t', 'tree', '--stdin');
  assert.equal(tree.code, 0, tree.stderr);
  for (const key of model.SERIES) {
    const committed = await launch(key, '-C', repository, 'commit-tree', tree.stdout.trim(),
      '-m', 'Shared configuration fixture');
    assert.equal(committed.code, 0, committed.stderr);
    const readback = await launch(key, '-C', repository, 'cat-file', 'commit', committed.stdout.trim());
    assert.equal(readback.code, 0, readback.stderr);
    const name = 'Flip Baton - ' + model.SERIES_LABELS[key], email = identities[key].commitEmail;
    for (const field of ['author', 'committer']) {
      assert.ok(readback.stdout.split('\n').some(line =>
        line.startsWith(`${field} ${name} <${email}> `)), readback.stdout);
    }
    assert.ok(!readback.stdout.includes('fixture@example.invalid'), readback.stdout);
  }
});

test('malformed shared registry attribution refuses before launching Git', () => {
  const alternative = join(directory, 'invalid-shared-attribution.json');
  const invalid = [null, {}, { name: 'Flip - Baton' }, { email: 'baton@example.invalid' },
    { name: 'Flip - Baton', email: 'not-an-email' },
    { name: 'Flip\nBaton', email: 'baton@example.invalid' },
    { name: 'Flip - Baton', email: 'baton@example.invalid\nuser.name=other' }];
  for (const attribution of invalid) {
    save(alternative, { models, series, attribution });
    const selected = { ...args('gpt-6-astra', ['git', 'status']), registry: alternative };
    assert.throws(() => model.launch(selected, {}, () => assert.fail('unexpected launch')), model.Refusal);
  }
});

test('native validation preserves exact model agreement and separate Git -m meanings', () => {
  for (const command of [['native-fixture'], ['native-fixture', '--model'],
    ['native-fixture', '--model', 'kimi-code/k3'], ['native-fixture', '--model=gpt-6-astra', '-m', 'another-model']]) {
    assert.throws(() => execution(args('gpt-6-astra', command, true)), model.Refusal);
  }
  assert.throws(() => execution(args(null, ['native-fixture', '--model', 'gpt-6-astra'], true, 'gpt')), model.Refusal);
  assert.equal(execution(args('gpt-6-astra', ['--', 'git', 'commit', '-m', 'Actual Player change']))[0], 'git');
  assert.throws(() => model.selected_identity(registry, 'deepseek/another-model'), model.Refusal);
  assert.throws(() => execution(args('gpt-6-astra', ['git', 'status'], false, 'glm')), model.Refusal);
  assert.equal(execution(args('unknown/exact', ['native-fixture', '--model', 'unknown/exact'], true, 'glm'))[2].GIT_COMMITTER_EMAIL,
    identities.glm.commitEmail);
  assert.throws(() => execution(args('unknown/exact', ['native-fixture', '--model', 'other'], true, 'glm')), model.Refusal);
});

test('recipient re-selection removes sender authentication and preserves noncredential Git parameters', () => {
  const inherited = { GH_TOKEN: 'fixture-sender', GITHUB_TOKEN: 'fixture-sender',
    GIT_AUTHOR_NAME: 'sender', GIT_COMMITTER_EMAIL: 'sender@example.invalid', GIT_ASKPASS: 'sender-askpass',
    GIT_CONFIG_COUNT: '4', GIT_CONFIG_KEY_0: 'diff.algorithm', GIT_CONFIG_VALUE_0: 'patience',
    GIT_CONFIG_KEY_1: 'credential.helper', GIT_CONFIG_VALUE_1: 'sender-helper',
    GIT_CONFIG_KEY_2: 'http.extraHeader', GIT_CONFIG_VALUE_2: 'Authorization: fixture-sender',
    GIT_CONFIG_KEY_3: 'core.fsmonitor', GIT_CONFIG_VALUE_3: 'false',
    GIT_CONFIG_PARAMETERS: ['gc.auto=0', "user.name=Fixture λ O'Brien", 'credential.helper=sender-helper', 'core.askpass=sender'].map(model.shell_quote).join(' ') };
  for (const key of model.SERIES) {
    const environment = model.scoped_environment(registry, key, identities[key], inherited, undefined, undefined, REPOSITORY);
    assert.equal(environment.GIT_AUTHOR_NAME, 'Flip Baton - ' + model.SERIES_LABELS[key]);
    assert.equal(environment.GIT_COMMITTER_EMAIL, identities[key].commitEmail);
    for (const field of ['GH_TOKEN', 'GITHUB_TOKEN', 'GIT_CONFIG_PARAMETERS']) assert.ok(!(field in environment));
    const pairs = Array.from({ length: Number(environment.GIT_CONFIG_COUNT) }, (_, index) =>
      [environment[`GIT_CONFIG_KEY_${index}`], environment[`GIT_CONFIG_VALUE_${index}`]]);
    const selected = Object.fromEntries(pairs);
    assert.equal(selected['diff.algorithm'], 'patience');
    assert.equal(selected['core.fsmonitor'], 'false');
    assert.equal(selected['gc.auto'], '0');
    assert.equal(selected['user.name'], "Fixture λ O'Brien");
    assert.equal(selected['credential.helper'], '');
    assert.equal(selected['http.extraHeader'], '');
    assert.ok(!pairs.some(([, value]) => value.includes('sender')));
    for (const suffix of ['', '.git']) {
      const command = model.shell_split(selected[`credential.https://github.com/${REPOSITORY}${suffix}.helper`].slice(1));
      assert.deepEqual(command, [process.execPath, SOURCE, 'helper', '--registry', registry,
        '--series-key', key, '--repository', REPOSITORY]);
    }
    assert.equal(environment.GIT_ASKPASS, 'false');
  }
  for (const key of ['gpt-6-astra', 'fixture/gpt-next-exact']) {
    const environment = execution(args(key, ['native-fixture', '--model', key], true),
      { OPENAI_API_KEY: 'fixture', CODEX_API_KEY: 'fixture' })[2];
    assert.ok(!('OPENAI_API_KEY' in environment) && !('CODEX_API_KEY' in environment));
  }
});

test('quoted Git parameters preserve empty, escaped and Unicode values and reject malformed input', () => {
  const values = ['', 'safe/path', 'text with spaces', "quote'and\"double", 'λ', 'line\nnext', '$(`fixture`)'];
  assert.deepEqual(model.shell_split(values.map(model.shell_quote).join(' ')), values);
  assert.deepEqual(model.shell_split("'user.name'='Fixture value' 'key=escaped\\value'"), ['user.name=Fixture value', 'key=escaped\\value']);
  for (const environment of [{ GIT_CONFIG_COUNT: '-1' }, { GIT_CONFIG_COUNT: '1' },
    { GIT_CONFIG_PARAMETERS: "'unterminated" }, { GIT_CONFIG_PARAMETERS: 'no-equals' }]) {
    assert.throws(() => model.runtime_pairs(environment), model.Refusal);
  }
});

test('metadata requires owned regular non-writable files and verified numeric identity fields', () => {
  const writable = join(directory, 'writable-registry.json');
  save(writable, { models, series }); chmodSync(writable, 0o666);
  assert.throws(() => model.public_json(writable), model.Refusal);
  const link = join(directory, 'linked-metadata.json'); symlinkSync(registry, link);
  assert.throws(() => model.public_json(link), model.Refusal);
  for (const [index, mutation] of [
    value => { value.displaySeries = 'gpt'; }, value => { value.seriesKey = 'kimi'; },
    value => { value.github.botId = true; }, value => { value.github.appId = '1000'; },
    value => { value.github.commitEmail = 'someone@example.invalid'; },
    value => { value.github.permissions.contents = 'read'; },
  ].entries()) {
    const home = join(directory, 'invalid-' + index); mkdirSync(home);
    const identity = { seriesKey: 'gpt', displaySeries: 'GPT', github: structuredClone(identities.gpt) };
    mutation(identity); save(join(home, 'identity-series.json'), identity);
    const alternative = join(directory, 'invalid-registry-' + index + '.json');
    save(alternative, { models, series: { ...series, gpt: home } });
    assert.throws(() => model.selected_identity(alternative, null, 'gpt'), model.Refusal);
  }
});

test('credential requests validate repeated extensions and unique scalar authority before authentication', async () => {
  const good = `protocol=https\nhost=github.com\npath=${REPOSITORY}.git\n`;
  for (const invalid of [good + 'host=github.com\n', good.replace('https', 'http'),
    good.replace('github.com', 'other.example'), good.replace(REPOSITORY, 'Flip-Engineering/other'),
    good + 'username=operator\n', 'protocol[]=https\nhost[]=github.com\npath[]=' + REPOSITORY + '\n',
    'capability[]=bad\0value\n' + good, 'capability[]=bad\rvalue\n' + good]) {
    let authenticated = false;
    await assert.rejects(model.helper({ registry: '/missing-fixture-registry', series_key: 'gpt',
      repository: REPOSITORY, operation: 'get' },
      Readable.from([invalid + '\n']), { write() { assert.fail('unexpected credential'); } },
      () => { authenticated = true; }), model.Refusal);
    assert.equal(authenticated, false);
  }
  const input = new PassThrough(); let text = '';
  const response = model.helper({ registry, series_key: 'gpt', operation: 'get' }, input,
    { write(value) { text += value; } }, async (_, github, repository) => {
      assert.deepEqual(github, identities.gpt); assert.equal(repository, REPOSITORY);
      return 'fixture-token-no-network';
    });
  input.write('capability[]=first\ncapability[]=second\n' + good + '\n');
  await response;
  assert.equal(text, 'username=x-access-token\npassword=fixture-token-no-network\n\n');
  assert.equal(input.readableEnded, false);
  input.end();
  for (const path of [REPOSITORY, REPOSITORY + '.git']) model.credential_context(good.replace(REPOSITORY + '.git', path) + '\n', REPOSITORY);
  assert.throws(() => model.credential_context(good, 'flip-engineer/flip'), model.Refusal);
});

test('store and erase perform no reads, signing, persistence or authentication', async () => {
  for (const operation of ['store', 'erase']) {
    await model.helper({ operation }, { setEncoding() { assert.fail('input read'); } },
      { write() { assert.fail('output'); } }, () => { assert.fail('authentication'); });
  }
});

test('installation token validates the App, owner installation, permissions and expiration', async () => {
  const github = identities.gpt, installed = [{ owner: 'Flip-Engineering', id: 5100 }];
  const fixture = installation_api(github, installed);
  const token = await model.installation_token(series.gpt, github, REPOSITORY, () => 'fixture-jwt-no-key', fixture.request);
  assert.equal(token, 'fixture-token-5100');
  assert.equal(fixture.calls.length, 3);
  assert.deepEqual(fixture.calls[2].body, { permissions: model.PERMISSIONS });
  assert.ok(!('repository_ids' in fixture.calls[2].body));
  const mutations = [['app', 'id', -1], ['app', 'client_id', 'wrong'],
    ['lookup', 'id', -1], ['lookup', 'id', 5100.5], ['lookup', 'app_id', -1], ['lookup', 'app_slug', 'other-app'],
    ['lookup', 'suspended_at', 'fixture-suspended'], ['lookup', 'account', { login: 'flip-engineer' }],
    ['lookup', 'permissions', { ...model.PERMISSIONS, contents: 'read' }],
    ['issue', 'permissions', { ...model.PERMISSIONS, pull_requests: 'read' }], ['issue', 'token', 'bad\nvalue'],
    ['issue', 'expires_at', '2000-01-01T00:00:00Z'], ['issue', 'expires_at', 9999], ['issue', 'expires_at', '9999'],
    ['issue', 'expires_at', '2099-02-30T00:00:00Z']];
  for (const [name, field, value] of mutations) {
    const tampered = installation_api(github, installed, { name, field, value });
    await assert.rejects(model.installation_token(series.gpt, github, REPOSITORY, () => 'fixture-jwt-no-key', tampered.request),
      model.Refusal, `${name}.${field}`);
  }
  await assert.rejects(model.installation_token(series.gpt, github, '//invalid', () => 'fixture-jwt-no-key', fixture.request),
    model.Refusal);
});

test('HTTP requests bind fixed API authority, reject redirects and redact transport and response errors', async () => {
  for (const status of [200, 302, 401, 404]) {
    const calls = [];
    function request(url, options, received) {
      calls.push({ url, options }); const outgoing = new EventEmitter();
      outgoing.end = body => {
        calls[0].body = body;
        const incoming = new PassThrough(); incoming.statusCode = status;
        incoming.headers = { location: 'https://other.example/credential-fixture' };
        queueMicrotask(() => { received(incoming); incoming.end('{"ok":true}'); });
      };
      return outgoing;
    }
    const response = model.api('/app', 'fixture-authorization', { fixture: true }, request);
    if (status === 200) assert.deepEqual(await response, { ok: true });
    else await assert.rejects(response, status === 404 ? model.Missing : model.Refusal);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.github.com/app');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-authorization');
    assert.equal(calls[0].body, '{"fixture":true}');
  }
  await assert.rejects(model.api('//other.example', 'fixture', null, () => assert.fail('request')), model.Refusal);
  await assert.rejects(model.api('/app', 'fixture', null, () => { throw new Error('fixture-secret'); }), error =>
    error instanceof model.Refusal && !error.message.includes('fixture-secret'));
});

test('RSA JWT signs fixture claims and refuses public permissions or symlink keys', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const home = join(directory, 'synthetic-signing'); mkdirSync(home);
  const key = join(home, 'private-key.pem');
  writeFileSync(key, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const now = 1791050000, jwt = model.app_jwt(home, identities.gpt, now);
  const [header, payload, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), { iat: now - 60, exp: now + 600, iss: identities.gpt.clientId });
  assert.ok(verify('RSA-SHA256', Buffer.from(header + '.' + payload), publicKey, Buffer.from(signature, 'base64url')));
  chmodSync(key, 0o644); assert.throws(() => model.app_jwt(home, identities.gpt), model.Refusal);
  chmodSync(key, 0o1600); assert.throws(() => model.app_jwt(home, identities.gpt), model.Refusal);
  chmodSync(key, 0o600);
  const linked = join(directory, 'linked-signing'); mkdirSync(linked);
  symlinkSync(key, join(linked, 'private-key.pem'));
  assert.throws(() => model.app_jwt(linked, identities.gpt), model.Refusal);
});

test('real launch replaces the helper PID and preserves cwd, stdin, output, argument bytes and numeric exit', async () => {
  const controlled = join(directory, 'controlled-child.mjs');
  writeFileSync(controlled, `let input=''; process.stdin.setEncoding('utf8'); for await(const chunk of process.stdin) input+=chunk;
process.stdout.write(JSON.stringify({pid:process.pid,cwd:process.cwd(),argv:process.argv.slice(2),input,
author:process.env.GIT_AUTHOR_NAME,email:process.env.GIT_COMMITTER_EMAIL,keys:['OPENAI_API_KEY','CODEX_API_KEY','GH_TOKEN','GITHUB_TOKEN'].filter(key=>key in process.env)}));
process.stderr.write('Fixture diagnostic λ\\n'); process.exitCode=7;\n`);
  for (const executable of [process.execPath, basename(process.execPath)]) {
    const result = await child([SOURCE, 'launch', '--registry', registry, '--model-key', 'gpt-6-astra', '--native-model',
      '--', executable, controlled, '--model', 'gpt-6-astra', "Fixture λ O'Brien"], {
      input: 'Complete stdin λ\nSecond line.\n', env: { PATH: dirname(process.execPath), OPENAI_API_KEY: 'fixture',
        CODEX_API_KEY: 'fixture', GH_TOKEN: 'fixture', GITHUB_TOKEN: 'fixture' } });
    assert.equal(result.code, 7, result.stderr); assert.equal(result.signal, null);
    const observed = JSON.parse(result.stdout);
    assert.equal(observed.pid, result.pid); assert.equal(observed.cwd, directory);
    assert.deepEqual(observed.argv, ['--model', 'gpt-6-astra', "Fixture λ O'Brien"]);
    assert.equal(observed.input, 'Complete stdin λ\nSecond line.\n');
    assert.equal(observed.author, 'Flip Baton - GPT'); assert.equal(observed.email, identities.gpt.commitEmail);
    assert.deepEqual(observed.keys, []); assert.ok(result.stderr.endsWith('Fixture diagnostic λ\n'));
  }
});

test('CLI parses existing options and refuses credential context or missing executables without leaking input', async () => {
  const parsed = model.parse(['launch', '--registry=' + registry, '--series-key', 'gpt', '--', 'git', 'commit', '-m', 'Fixture']);
  assert.equal(parsed.series_key, 'gpt'); assert.equal(parsed.model_key, null);
  assert.deepEqual(parsed.command, ['--', 'git', 'commit', '-m', 'Fixture']);
  const wrong = await child([SOURCE, 'helper', '--registry', '/missing-fixture', '--series-key', 'gpt', 'get'],
    { input: 'protocol=https\nhost=other.example\npath=fixture-secret\n\n' });
  assert.equal(wrong.code, 1); assert.equal(wrong.stdout, '');
  assert.ok(!wrong.stderr.includes('fixture-secret'));
  const signing = await child([SOURCE, 'helper', '--registry', registry, '--series-key', 'gpt', 'get'],
    { input: `protocol=https\nhost=github.com\npath=${REPOSITORY}\n\n` });
  assert.equal(signing.code, 1); assert.equal(signing.stdout, '');
  assert.equal(signing.stderr, 'Series Git configuration, signing or response parsing failed.\n');
  const missing = await child([SOURCE, 'launch', '--registry', registry, '--series-key', 'gpt', '--', 'missing-fixture-executable']);
  assert.equal(missing.code, 1); assert.equal(missing.stdout, '');
  assert.equal(missing.stderr, 'Series Git operation refused: The selected command is not executable.\n');
  const deny = await child([SOURCE, 'deny-askpass', 'fixture prompt']);
  assert.equal(deny.code, 1); assert.equal(deny.stdout + deny.stderr, '');
});

test('check resolves a configured exact model and refuses an unmapped one without launching', async () => {
  const parsed = model.parse(['check', '--registry', registry, '--model-key', 'gpt-6-astra']);
  assert.equal(parsed.verb, 'check'); assert.equal(parsed.model_key, 'gpt-6-astra');
  assert.equal(parsed.series_key, null); assert.deepEqual(parsed.command, []);
  assert.throws(() => model.parse(['check', '--registry', registry]), model.Refusal);
  assert.throws(() => model.parse(['check', '--registry', registry, '--model-key', 'gpt-6-astra', '--series-key', 'gpt']),
    /exact model key and no series option/);
  assert.equal(await model.check({ registry, model_key: 'gpt-6-astra' }), undefined);
  await assert.rejects(model.check({ registry, model_key: 'zai/glm-5.3-flash' }),
    /Select an explicitly configured model mapping or registered series/);
  const no_series = join(directory, 'no-series.json');
  save(no_series, { models: { ...models, 'fixture/no-series-model': null }, series });
  await assert.rejects(model.check({ registry: no_series, model_key: 'fixture/no-series-model' }),
    /The model fixture\/no-series-model is registered without a GitHub identity series\./);
  const resolved = await child([SOURCE, 'check', '--registry', registry, '--model-key', 'gpt-6-astra']);
  assert.equal(resolved.code, 0, resolved.stderr);
  assert.equal(resolved.stdout + resolved.stderr, '');
  const unmapped = await child([SOURCE, 'check', '--registry', registry, '--model-key', 'zai/glm-5.3-flash']);
  assert.equal(unmapped.code, 1); assert.equal(unmapped.stdout, '');
  assert.equal(unmapped.stderr,
    'Series Git operation refused: Select an explicitly configured model mapping or registered series.\n');
  const wrong = await child([SOURCE, 'check', '--registry', registry, '--model-key', 'gpt-6-astra', '--series-key', 'gpt']);
  assert.equal(wrong.code, 1); assert.equal(wrong.stdout, '');
  assert.equal(wrong.stderr, 'Series Git operation refused: The check takes an exact model key and no series option.\n');
});

const WORKFLOW_GRANTS = { contents: 'write', pull_requests: 'write', metadata: 'read', workflows: 'write' };
function workflow_fixture(tamper = {}) {
  const home = mkdtempSync(join(directory, 'workflow-'));
  const github = { ...identities.gpt, permissions: { ...WORKFLOW_GRANTS } };
  save(join(home, 'identity-series.json'), { seriesKey: 'gpt', displaySeries: 'GPT', github });
  const registry = join(home, 'registry.json');
  save(registry, { models: { ...models, 'gpt-6.1-sol': 'gpt' }, series: { ...series, gpt: home } });
  const api = installation_api(github, [{ owner: 'Flip-Engineering', id: 5100 },
    { owner: 'flip-engineer', id: 5200 }], tamper, WORKFLOW_GRANTS);
  return { home, registry, github, api };
}

test('workflow-write requires an explicit repository and preserves exact model selection', async () => {
  const fixture = workflow_fixture();
  for (const verb of ['launch', 'helper', 'check']) {
    const selection = verb === 'helper' ? ['--series-key', 'gpt', 'get'] : ['--model-key', 'gpt-6.1-sol'];
    const command = [verb, '--registry', fixture.registry, ...selection, '--profile=workflow-write'];
    assert.throws(() => model.parse(command), /requires --repository/);
    const parsed = model.parse([...command, '--repository', 'Flip-Engineering/riff']);
    assert.equal(parsed.profile, 'workflow-write');
    assert.equal(parsed.repository, 'Flip-Engineering/riff');
    if (verb === 'check') assert.equal(await model.check(parsed, () => 'fixture-jwt', fixture.api.request), undefined);
  }
  assert.throws(() => model.parse(['launch', '--registry', fixture.registry, '--profile', 'all']), /permission profile/);
  assert.throws(() => model.selected_identity(fixture.registry, 'unmapped-model', null,
    'workflow-write', 'Flip-Engineering/riff'), /Select an explicitly configured model/);
  assert.throws(() => model.selected_identity(fixture.registry, 'gpt-6.1-sol', 'glm',
    'workflow-write', 'Flip-Engineering/riff'), /explicit series differs/);
  assert.throws(() => model.selected_identity(registry, 'gpt-6-astra', null,
    'workflow-write', 'Flip-Engineering/riff'), /App identity requires workflows:write/);
});

test('workflow-write launch carries its profile and repository into the Git credential command', () => {
  const fixture = workflow_fixture();
  const selected = { registry: fixture.registry, model_key: 'gpt-6.1-sol', repository: 'Flip-Engineering/riff',
    profile: 'workflow-write', native_model: true, command: ['fixture-native', '--model', 'gpt-6.1-sol'] };
  const [, command, environment] = execution(selected, { GH_TOKEN: 'fixture-sender', GITHUB_TOKEN: 'fixture-sender' });
  assert.deepEqual(command, selected.command);
  const pairs = Object.fromEntries(Array.from({ length: Number(environment.GIT_CONFIG_COUNT) },
    (_, index) => [environment[`GIT_CONFIG_KEY_${index}`], environment[`GIT_CONFIG_VALUE_${index}`]]));
  assert.deepEqual(model.shell_split(pairs['credential.https://github.com/Flip-Engineering/riff.helper'].slice(1)),
    [process.execPath, SOURCE, 'helper', '--registry', fixture.registry, '--series-key', 'gpt',
      '--repository', 'Flip-Engineering/riff', '--profile', 'workflow-write']);
  assert.equal(environment.GIT_AUTHOR_NAME, 'Flip Baton - GPT');
  assert.equal(environment.GIT_COMMITTER_EMAIL, fixture.github.commitEmail);
  assert.ok(!('GH_TOKEN' in environment) && !('GITHUB_TOKEN' in environment));
  assert.throws(() => execution({ ...selected, repository: null }), /requires --repository/);
  assert.throws(() => execution({ ...selected, command: ['fixture-native', '--model', 'other-model'] }), /native model option differs/);
});

test('workflow-write tokens request four grants for one repository in the target owner installation', async () => {
  const fixture = workflow_fixture();
  for (const repository of ['Flip-Engineering/riff', 'flip-engineer/riff']) {
    await model.installation_token(fixture.home, fixture.github, repository, () => 'fixture-jwt',
      fixture.api.request, 'workflow-write');
    assert.deepEqual(fixture.api.calls.at(-1).body, { permissions: WORKFLOW_GRANTS, repositories: ['riff'] });
  }
  assert.deepEqual(fixture.api.calls.filter(call => call.api_path.endsWith('/access_tokens')).map(call => call.api_path),
    ['/app/installations/5100/access_tokens', '/app/installations/5200/access_tokens']);
  await model.installation_token(fixture.home, fixture.github, 'Flip-Engineering/riff', () => 'fixture-jwt', fixture.api.request);
  assert.deepEqual(fixture.api.calls.at(-1).body,
    { permissions: { contents: 'write', pull_requests: 'write', metadata: 'read' } });
});

test('workflow-write checks local, App, installation and issued permission levels before returning a credential', async () => {
  for (const [permission, required] of Object.entries(WORKFLOW_GRANTS)) {
    for (const level of [undefined, 'none', ...(required === 'write' ? ['read'] : [])]) {
      const permissions = { ...WORKFLOW_GRANTS };
      if (level === undefined) delete permissions[permission];
      else permissions[permission] = level;
      for (const name of ['identity', 'app', 'lookup', 'issue']) {
        const fixture = workflow_fixture({ name, field: 'permissions', value: permissions });
        if (name === 'identity') fixture.github.permissions = permissions;
        await assert.rejects(model.installation_token(fixture.home, fixture.github, 'Flip-Engineering/riff',
          () => 'fixture-jwt', fixture.api.request, 'workflow-write'), error => error instanceof model.Refusal
            && error.message.includes(permission + ':' + required));
        if (name !== 'issue') assert.ok(!fixture.api.calls.some(call => call.api_path.endsWith('/access_tokens')));
        if (name === 'identity') assert.equal(fixture.api.calls.length, 0);
      }
    }
  }
});

test('workflow-write refuses mismatched credential paths and tokens with broader or missing repository scope', async () => {
  const scopeChanges = [['repository_selection', 'all'], ['repositories', undefined], ['repositories', []],
    ['repositories', [{ full_name: 'Flip-Engineering/other' }]], ['repositories', [{ full_name: 'other-owner/riff' }]],
    ['repositories', [{ full_name: 'Flip-Engineering/riff' }, { full_name: 'Flip-Engineering/other' }]]];
  for (const [field, value] of scopeChanges) {
    const fixture = workflow_fixture({ name: 'issue', field, value });
    let responded = false;
    const issue = (home, github, repository, _jwt, _request, profile) =>
      model.installation_token(home, github, repository, () => 'fixture-jwt', fixture.api.request, profile);
    await assert.rejects(model.helper({ registry: fixture.registry, series_key: 'gpt', operation: 'get',
      repository: 'Flip-Engineering/riff', profile: 'workflow-write' },
    Readable.from(['protocol=https\nhost=github.com\npath=Flip-Engineering/riff.git\n\n']),
    { write() { responded = true; } }, issue), /must be restricted to Flip-Engineering\/riff/);
    assert.equal(responded, false);
  }
  const fixture = workflow_fixture();
  await assert.rejects(model.helper({ registry: fixture.registry, series_key: 'gpt', operation: 'get',
    repository: 'Flip-Engineering/riff', profile: 'workflow-write' },
  Readable.from(['protocol=https\nhost=github.com\npath=Flip-Engineering/baton.git\n\n']),
  { write() { assert.fail('credential returned'); } }, () => assert.fail('authenticated')), /assigned HTTPS repository/);
});

test('workflow-write executable launch supplies only a scoped Git credential with unchanged authorship', async () => {
  const fixture = workflow_fixture();
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  writeFileSync(join(fixture.home, 'private-key.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const preload = join(fixture.home, 'fake-api.mjs');
  writeFileSync(preload, `import assert from 'node:assert/strict';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
https.request = (url, options, received) => {
  const outgoing = new EventEmitter();
  outgoing.end = body => {
    const path = new URL(url).pathname;
    let response;
    if (path === '/app') response = ${JSON.stringify({ id: fixture.github.appId, slug: fixture.github.slug, permissions: WORKFLOW_GRANTS })};
    else if (path === '/repos/Flip-Engineering/riff/installation') response = ${JSON.stringify({
      id: 5100, app_id: fixture.github.appId, app_slug: fixture.github.slug,
      account: { login: 'Flip-Engineering' }, permissions: WORKFLOW_GRANTS })};
    else if (path === '/app/installations/5100/access_tokens') {
      assert.deepEqual(JSON.parse(body), ${JSON.stringify({ permissions: WORKFLOW_GRANTS, repositories: ['riff'] })});
      response = { token: 'fixture-workflow-only', permissions: ${JSON.stringify(WORKFLOW_GRANTS)},
        repository_selection: 'selected', repositories: [{ full_name: 'Flip-Engineering/riff' }],
        expires_at: new Date(Date.now() + 3600000).toISOString() };
    } else throw Error('Unexpected fixture request');
    const incoming = new PassThrough(); incoming.statusCode = 200;
    queueMicrotask(() => { received(incoming); incoming.end(JSON.stringify(response)); });
  };
  return outgoing;
};\n`);
  const capture = join(fixture.home, 'capture.mjs');
  writeFileSync(capture, `import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const credential = spawnSync('git', ['credential', 'fill'], { input: readFileSync(0), encoding: 'utf8' });
process.stdout.write(JSON.stringify({ authenticated: credential.status === 0 && credential.stdout.includes('password=fixture-workflow-only'),
  author: process.env.GIT_AUTHOR_NAME, email: process.env.GIT_AUTHOR_EMAIL, senderRemoved: !('GH_TOKEN' in process.env) && !('GITHUB_TOKEN' in process.env) }));\n`);
  const result = await child([SOURCE, 'launch', '--registry', fixture.registry, '--model-key', 'gpt-6.1-sol',
    '--repository', 'Flip-Engineering/riff', '--profile', 'workflow-write', '--', process.execPath, capture],
  { env: { PATH: process.env.PATH, NODE_OPTIONS: '--import=' + pathToFileURL(preload).href,
    GH_TOKEN: 'fixture-sender', GITHUB_TOKEN: 'fixture-sender' },
    input: 'protocol=https\nhost=github.com\npath=Flip-Engineering/riff.git\n\n' });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { authenticated: true, author: 'Flip Baton - GPT',
    email: fixture.github.commitEmail, senderRemoved: true });
  assert.ok(!result.stdout.includes('fixture-workflow-only'));
});
