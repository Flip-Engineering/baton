// Controlled public identities, synthetic signing keys and HTTP responses.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, verify } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as model from '../harness/git-series.mjs';

const SOURCE = fileURLToPath(new URL('../harness/git-series.mjs', import.meta.url));
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
    installationId: 2000 + index, repositoryFullName: model.REPOSITORY, repositoryId: 3000,
    permissions: { ...model.PERMISSIONS } };
  save(join(home, 'identity-series.json'), { seriesKey: key, displaySeries: model.SERIES_LABELS[key], github: identities[key] });
  save(join(home, 'identity.json'), { modelKey: 'preserved-old-metadata', github: { appId: -1 } });
  series[key] = home;
}
save(registry, { models, series });
save(join(directory, 'BOUNDARY.json'), { actual_credentials: false, actual_profile_reads: false,
  provider_execution: false, network: false, public_metadata: 'invented',
  signing: 'generated fixture key only', launch: 'controlled Node child only' });

function args(key, command, native = false, selected = null) {
  return { registry, model_key: key, series_key: selected, native_model: native, command };
}
function execution(selected, environment = {}) {
  let observed;
  model.launch(selected, environment, (...values) => { observed = values; });
  return observed;
}
function responses(github) {
  const installation = { id: github.installationId, app_id: github.appId, app_slug: github.slug,
    account: { login: 'Flip-Engineering' }, suspended_at: null, permissions: { ...model.PERMISSIONS } };
  return [{ id: github.appId, slug: github.slug, client_id: github.clientId }, installation,
    structuredClone(installation), { token: 'fixture-token-no-network', permissions: { ...model.PERMISSIONS },
      expires_at: new Date(Date.now() + 86400000).toISOString() },
    { total_count: 1, repositories: [{ id: github.repositoryId, full_name: model.REPOSITORY }] }];
}
function token_fixture(values, calls = []) {
  return (...args) => { calls.push(args); return Promise.resolve(values[calls.length - 1]); };
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
    const environment = model.scoped_environment(registry, key, identities[key], inherited);
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
      const command = model.shell_split(selected[`credential.https://github.com/${model.REPOSITORY}${suffix}.helper`].slice(1));
      assert.deepEqual(command, [process.execPath, SOURCE, 'helper', '--registry', registry, '--series-key', key]);
    }
    assert.deepEqual(model.shell_split(environment.GIT_ASKPASS), [process.execPath, SOURCE, 'deny-askpass']);
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
    value => { value.github.repositoryId = 9007199254740992; },
    value => { value.github.commitEmail = 'someone@example.invalid'; },
    value => { value.github.permissions.issues = 'write'; },
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
  const good = `protocol=https\nhost=github.com\npath=${model.REPOSITORY}.git\n`;
  for (const invalid of [good + 'host=github.com\n', good.replace('https', 'http'),
    good.replace('github.com', 'other.example'), good.replace(model.REPOSITORY, 'Flip-Engineering/other'),
    good + 'username=operator\n', 'protocol[]=https\nhost[]=github.com\npath[]=' + model.REPOSITORY + '\n',
    'capability[]=bad\0value\n' + good, 'capability[]=bad\rvalue\n' + good]) {
    let authenticated = false;
    await assert.rejects(model.helper({ registry: '/missing-fixture-registry', series_key: 'gpt', operation: 'get' },
      Readable.from([invalid + '\n']), { write() { assert.fail('unexpected credential'); } },
      () => { authenticated = true; }), model.Refusal);
    assert.equal(authenticated, false);
  }
  const input = new PassThrough(); let text = '';
  const response = model.helper({ registry, series_key: 'gpt', operation: 'get' }, input,
    { write(value) { text += value; } }, async (_, github) => {
      assert.deepEqual(github, identities.gpt); return 'fixture-token-no-network';
    });
  input.write('capability[]=first\ncapability[]=second\n' + good + '\n');
  await response;
  assert.equal(text, 'username=x-access-token\npassword=fixture-token-no-network\n\n');
  assert.equal(input.readableEnded, false);
  input.end();
  for (const path of [model.REPOSITORY, model.REPOSITORY + '.git']) model.credential_context(good.replace(model.REPOSITORY + '.git', path) + '\n');
});

test('store and erase perform no reads, signing, persistence or authentication', async () => {
  for (const operation of ['store', 'erase']) {
    await model.helper({ operation }, { setEncoding() { assert.fail('input read'); } },
      { write() { assert.fail('output'); } }, () => { assert.fail('authentication'); });
  }
});

test('installation token validates exact App, both installations, permissions and repository access', async () => {
  const calls = [], github = identities.gpt;
  const token = await model.installation_token(series.gpt, github, () => 'fixture-jwt-no-key', token_fixture(responses(github), calls));
  assert.equal(token, 'fixture-token-no-network');
  assert.deepEqual(calls[3], [`/app/installations/${github.installationId}/access_tokens`, 'fixture-jwt-no-key',
    { repository_ids: [github.repositoryId], permissions: model.PERMISSIONS }]);
  const mutations = [[0, 'id', -1], [0, 'client_id', 'wrong'], [1, 'id', -1],
    [2, 'app_id', -1], [2, 'suspended_at', 'fixture-suspended'],
    [3, 'permissions', { ...model.PERMISSIONS, issues: 'write' }], [3, 'token', 'bad\nvalue'],
    [3, 'expires_at', '2000-01-01T00:00:00Z'], [3, 'expires_at', 9999], [3, 'expires_at', '9999'],
    [3, 'expires_at', '2099-02-30T00:00:00Z'],
    [4, 'repositories', [{ id: -1, full_name: model.REPOSITORY }]], [4, 'total_count', 2]];
  for (const [position, key, value] of mutations) {
    const selected = responses(github); selected[position][key] = value;
    await assert.rejects(model.installation_token(series.gpt, github, () => 'fixture-jwt-no-key', token_fixture(selected)), model.Refusal);
  }
});

test('HTTP requests bind fixed API authority, reject redirects and redact transport and response errors', async () => {
  for (const status of [200, 302, 401]) {
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
    else await assert.rejects(response, model.Refusal);
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
  chmodSync(key, 0o4600); assert.throws(() => model.app_jwt(home, identities.gpt), model.Refusal);
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
    { input: `protocol=https\nhost=github.com\npath=${model.REPOSITORY}\n\n` });
  assert.equal(signing.code, 1); assert.equal(signing.stdout, '');
  assert.equal(signing.stderr, 'Series Git configuration, signing or response parsing failed.\n');
  const missing = await child([SOURCE, 'launch', '--registry', registry, '--series-key', 'gpt', '--', 'missing-fixture-executable']);
  assert.equal(missing.code, 1); assert.equal(missing.stdout, '');
  assert.equal(missing.stderr, 'Series Git operation refused: The selected command is not executable.\n');
  const deny = await child([SOURCE, 'deny-askpass', 'fixture prompt']);
  assert.equal(deny.code, 1); assert.equal(deny.stdout + deny.stderr, '');
});
