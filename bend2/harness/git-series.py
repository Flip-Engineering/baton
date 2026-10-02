#!/usr/bin/env python3
"""Series-scoped Git environment and GitHub App HTTPS credential helper."""
import argparse
import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener


REPOSITORY = 'Flip-Engineering/baton'
PERMISSIONS = {'contents': 'write', 'pull_requests': 'write', 'metadata': 'read'}
API_ROOT = 'https://api.github.com'
SERIES = ('gpt', 'muse', 'deepseek', 'claude', 'glm', 'kimi')


class Refusal(Exception):
    pass


def require(condition, message):
    if not condition:
        raise Refusal(message)


def public_json(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
            and not info.st_mode & 0o022, 'Public identity metadata must be an owned regular file.')
    return json.loads(path.read_text())


def selected_identity(registry_path, model_key=None, series_key=None):
    registry = public_json(registry_path)
    require(isinstance(registry, dict) and isinstance(registry.get('models'), dict)
            and isinstance(registry.get('series'), dict), 'The series registry is incomplete.')
    models, series = registry['models'], registry['series']
    if model_key is not None:
        require(isinstance(model_key, str) and model_key
                and not any(c in model_key for c in '\r\n\x00'), 'The exact model key is invalid.')
    mapped = models.get(model_key)
    if model_key in models:
        require(mapped in SERIES, 'The exact-model mapping names an invalid series.')
    if series_key is None:
        series_key = mapped
    require(series_key in SERIES and series_key in series,
            'Select an explicitly configured model mapping or registered series.')
    require(mapped is None or mapped == series_key,
            'The explicit series differs from the configured exact-model mapping.')
    directory = series[series_key]
    require(isinstance(directory, str), 'The series registry entry must name a directory.')
    directory = Path(directory).expanduser().resolve()
    identity = public_json(directory / 'identity-series.json')
    require(identity.get('seriesKey') == series_key, 'The selected identity belongs to another series.')
    require(isinstance(identity.get('displaySeries'), str) and identity['displaySeries'],
            'The public series identity is incomplete.')
    github = identity.get('github', {})
    for field in ('appId', 'botId', 'installationId', 'repositoryId'):
        require(type(github.get(field)) is int and github[field] > 0,
                'The public identity requires verified positive numeric GitHub IDs.')
    for field in ('clientId', 'slug', 'botLogin', 'commitEmail'):
        require(isinstance(github.get(field), str) and github[field]
                and not any(c in github[field] for c in '\r\n\x00'),
                'The public identity requires verified GitHub names and email.')
    require(re.fullmatch(r'[A-Za-z0-9-]+', github['slug']) is not None,
            'The App slug is invalid.')
    require(github['botLogin'] == github['slug'] + '[bot]', 'The bot login differs from the App slug.')
    require(github['commitEmail'] == f"{github['botId']}+{github['botLogin']}@users.noreply.github.com",
            'The commit email differs from the verified bot identity.')
    require(github.get('repositoryFullName') == REPOSITORY,
            'The App identity must name Flip-Engineering/baton.')
    require(github.get('permissions') == PERMISSIONS,
            'The App identity permissions differ from the approved permissions.')
    return series_key, directory, github


def credential_config(key):
    lower = key.lower()
    return (lower.startswith('credential.') or lower == 'core.askpass'
            or (lower.startswith('http.') and lower.endswith('.extraheader')))


def runtime_pairs(environment):
    count = environment.get('GIT_CONFIG_COUNT', '0') or '0'
    require(count.isdecimal(), 'GIT_CONFIG_COUNT is invalid.')
    pairs = []
    for index in range(int(count)):
        key = environment.get(f'GIT_CONFIG_KEY_{index}')
        value = environment.get(f'GIT_CONFIG_VALUE_{index}')
        require(key is not None and value is not None, 'An inherited Git configuration pair is incomplete.')
        if not credential_config(key):
            pairs.append((key, value))
    # Git's internal quoted parameter form may be inherited from a Git process.
    for parameter in shlex.split(environment.get('GIT_CONFIG_PARAMETERS', '')):
        require('=' in parameter, 'An inherited Git configuration parameter is invalid.')
        key, value = parameter.split('=', 1)
        if not credential_config(key):
            pairs.append((key, value))
    return pairs


def scoped_environment(registry_path, series_key, github, inherited):
    environment = dict(inherited)
    pairs = runtime_pairs(environment)
    for key in list(environment):
        if re.fullmatch(r'GIT_CONFIG_(KEY|VALUE)_\d+', key):
            del environment[key]
    environment.pop('GIT_CONFIG_PARAMETERS', None)
    environment.pop('GH_TOKEN', None)
    environment.pop('GITHUB_TOKEN', None)
    # Each recipient launcher replaces the sender's inherited Git identity.
    for key, value in {'GIT_AUTHOR_NAME': github['botLogin'], 'GIT_AUTHOR_EMAIL': github['commitEmail'],
                       'GIT_COMMITTER_NAME': github['botLogin'],
                       'GIT_COMMITTER_EMAIL': github['commitEmail']}.items():
        environment[key] = value
    helper = '!' + shlex.join([sys.executable, str(Path(__file__).resolve()), 'helper',
                         '--registry', str(registry_path), '--series-key', series_key])
    deny = shlex.join([sys.executable, str(Path(__file__).resolve()), 'deny-askpass'])
    context = 'https://github.com/' + REPOSITORY
    pairs += [('credential.helper', ''), ('credential.interactive', 'false'),
              ('http.extraHeader', ''), ('http.https://github.com/.extraHeader', '')]
    for repository_context in (context, context + '.git'):
        pairs += [(f'credential.{repository_context}.helper', helper),
                  (f'credential.{repository_context}.useHttpPath', 'true'),
                  (f'credential.{repository_context}.username', 'x-access-token'),
                  (f'http.{repository_context}.extraHeader', '')]
    environment['GIT_CONFIG_COUNT'] = str(len(pairs))
    for index, (key, value) in enumerate(pairs):
        environment[f'GIT_CONFIG_KEY_{index}'] = key
        environment[f'GIT_CONFIG_VALUE_{index}'] = value
    environment['GIT_TERMINAL_PROMPT'] = '0'
    environment['GIT_ASKPASS'] = deny
    return environment


def native_models(command):
    found = []
    for index, argument in enumerate(command[1:], 1):
        if argument in ('--model', '-m'):
            require(index + 1 < len(command), 'The native model option requires a value.')
            found.append(command[index + 1])
        elif argument.startswith('--model='):
            found.append(argument.removeprefix('--model='))
    return found


def launch(args):
    command = args.command
    if command and command[0] == '--':
        command = command[1:]
    require(bool(command), 'The launcher requires a command.')
    registry_path = Path(args.registry).expanduser().resolve()
    if args.native_model:
        require(bool(args.model_key), 'Native validation requires an explicit exact model key.')
        observed = native_models(command)
        require(bool(observed) and all(model == args.model_key for model in observed),
                'The native model option differs from the explicit exact model key.')
    series_key, _, github = selected_identity(registry_path, args.model_key, args.series_key)
    environment = scoped_environment(registry_path, series_key, github, os.environ)
    if series_key == 'gpt':
        environment.pop('OPENAI_API_KEY', None)
        environment.pop('CODEX_API_KEY', None)
    os.execvpe(command[0], command, environment)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Refusal('GitHub authentication responses must not redirect.')


def api(path, authorization, body=None):
    require(path.startswith('/') and not path.startswith('//'), 'The GitHub API path is invalid.')
    request = Request(API_ROOT + path,
                      data=None if body is None else json.dumps(body).encode(),
                      headers={'Authorization': 'Bearer ' + authorization,
                               'Accept': 'application/vnd.github+json',
                               'X-GitHub-Api-Version': '2026-03-10',
                               'Content-Type': 'application/json',
                               'User-Agent': 'Baton2-series-git'})
    try:
        # Redirects are refused so credentials remain on api.github.com.
        with build_opener(NoRedirect).open(request) as response:
            return json.load(response)
    except (HTTPError, URLError, ValueError):
        raise Refusal('The GitHub API request or response verification failed.') from None


def base64url(value):
    return base64.urlsafe_b64encode(value).rstrip(b'=')


def app_jwt(directory, github):
    key = directory / 'private-key.pem'
    info = key.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
            and stat.S_IMODE(info.st_mode) == 0o600,
            'The App private key must be an owned regular file with mode 0600.')
    now = int(time.time())
    # GitHub documents 60 seconds of clock allowance and at most ten minutes
    # from now for the JWT expiration claim.
    header = base64url(json.dumps({'alg': 'RS256', 'typ': 'JWT'}, separators=(',', ':')).encode())
    payload = base64url(json.dumps({'iat': now - 60, 'exp': now + 600,
                                  'iss': github['clientId']}, separators=(',', ':')).encode())
    unsigned = header + b'.' + payload
    signed = subprocess.run(['/usr/bin/openssl', 'dgst', '-sha256', '-sign', str(key)],
                            input=unsigned, capture_output=True)
    require(signed.returncode == 0, 'OpenSSL could not sign the App JWT.')
    return (unsigned + b'.' + base64url(signed.stdout)).decode()


def verify_installation(installation, github):
    require(installation.get('id') == github['installationId']
            and installation.get('app_id') == github['appId']
            and installation.get('app_slug') == github['slug'],
            'The GitHub installation differs from the selected App identity.')
    require(installation.get('account', {}).get('login') == REPOSITORY.split('/')[0]
            and installation.get('suspended_at') is None,
            'The GitHub installation account is incorrect or suspended.')
    require(installation.get('permissions') == PERMISSIONS,
            'The GitHub installation permissions differ from the approved permissions.')


def installation_token(directory, github):
    jwt = app_jwt(directory, github)
    app = api('/app', jwt)
    require(app.get('id') == github['appId'] and app.get('slug') == github['slug'],
            'The signing key authenticated another GitHub App.')
    if 'client_id' in app:
        require(app['client_id'] == github['clientId'], 'The GitHub App client ID differs.')
    installation = api(f"/app/installations/{github['installationId']}", jwt)
    verify_installation(installation, github)
    repository_installation = api('/repos/' + REPOSITORY + '/installation', jwt)
    verify_installation(repository_installation, github)
    issued = api(f"/app/installations/{github['installationId']}/access_tokens", jwt,
                 {'repository_ids': [github['repositoryId']], 'permissions': PERMISSIONS})
    require(issued.get('permissions') == PERMISSIONS,
            'The issued token permissions differ from the approved permissions.')
    token = issued.get('token')
    require(isinstance(token, str) and token and not any(c in token for c in '\r\n\x00'),
            'GitHub returned an invalid installation token.')
    expiry = datetime.fromisoformat(issued['expires_at'].replace('Z', '+00:00'))
    require(expiry > datetime.now(timezone.utc), 'GitHub returned an expired installation token.')
    repositories = api('/installation/repositories', token)
    actual = {repo['id']: repo['full_name'] for repo in repositories.get('repositories', [])}
    wanted = {github['repositoryId']: REPOSITORY}
    require(actual == wanted and repositories.get('total_count') == len(wanted),
            'The issued token repository access differs from the approved repository.')
    return token


def credential_context(stream):
    fields = {}
    for line in stream:
        line = line.rstrip('\n')
        if not line:
            break
        require('=' in line, 'Git supplied an invalid credential request.')
        key, value = line.split('=', 1)
        require(not any(c in key + value for c in '\r\x00'),
                'Git supplied an invalid credential request.')
        # Git's multi-valued extension attributes may repeat. This helper
        # supplies basic username/password credentials and ignores them.
        if key.endswith('[]'):
            continue
        require(key not in fields, 'Git supplied an ambiguous credential request.')
        fields[key] = value
    require(fields.get('protocol') == 'https' and fields.get('host') == 'github.com'
            and fields.get('path') in (REPOSITORY, REPOSITORY + '.git')
            and fields.get('username', 'x-access-token') == 'x-access-token',
            'Git credentials are restricted to the approved HTTPS repository.')


def helper(args):
    if args.operation in ('store', 'erase'):
        return
    credential_context(sys.stdin)
    _, directory, github = selected_identity(Path(args.registry).expanduser().resolve(),
                                             series_key=args.series_key)
    token = installation_token(directory, github)
    # Git receives credentials through this helper's private stdout pipe.
    # The token is not placed in a command argument, URL, file or diagnostic.
    sys.stdout.write('username=x-access-token\npassword=' + token + '\n\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='verb', required=True)
    for verb in ('launch', 'helper'):
        command = commands.add_parser(verb)
        command.add_argument('--registry', required=True)
        if verb == 'launch':
            command.add_argument('--model-key', help='Exact native model identifier with a configured series mapping.')
            command.add_argument('--series-key', choices=SERIES,
                                 help='Explicit Git identity series; required for an unmapped exact model.')
            command.add_argument('--native-model', action='store_true',
                                 help='Verify the native --model/-m option against the explicit model key.')
            command.add_argument('command', nargs=argparse.REMAINDER)
        else:
            command.add_argument('--series-key', required=True, choices=SERIES)
            command.add_argument('operation', choices=('get', 'store', 'erase'))
    commands.add_parser('deny-askpass').add_argument('prompt', nargs='*')
    args = parser.parse_args()
    try:
        if args.verb == 'launch':
            launch(args)
        elif args.verb == 'helper':
            helper(args)
        else:
            return 1
        return 0
    except Refusal as error:
        sys.stderr.write('Series Git operation refused: ' + str(error) + '\n')
        return 1
    except Exception:
        # Credential material and API response bodies are excluded from diagnostics.
        sys.stderr.write('Series Git configuration, signing or response parsing failed.\n')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
