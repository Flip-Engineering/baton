#!/usr/bin/env python3
"""Record Darwin tool metadata and observe an accepted installed scientific package."""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import stat
import subprocess
import sys
import traceback
import urllib.error
import urllib.request
import uuid
import zipfile


SOURCE_COMMIT = '82029c6e9f194184de0c03fa197a3a40ecbe0286'
SOURCE_MANIFEST_SHA = 'a15d8859dc688b3217496aa50369ad3df5b17bc7309bfc7023b8627c0eca667b'
PACKAGE_DRIVER_COMMIT = 'e0e687bc360a2a718a110fa8cb905a67b5164c46'
RETAINED_HELPER_SHA = 'd11beae117be95a57e18ed7f2b994f138bd4fb34cab4610044c1c9823cae0bc5'
WORKFLOW_PATH = '.github/workflows/final-core-combined-qualification.yml'
NODE_VERSION = '22.23.3'
CHROME_VERSION = '155.0.8059.39'
CHROME_URL = 'https://storage.googleapis.com/chrome-for-testing-public/155.0.8059.39/mac-arm64/chrome-mac-arm64.zip'
CHROME_METADATA_URL = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json'
CHROME_METADATA = {'size': 10450, 'sha256': 'be245c9e1d73dc9b57f6ffa2ff764d0311c22ec19cfabdf0656a4d836667eccf'}
CHROME_EXECUTABLE = 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
SUITES = [('knowledge-v1.py', None), ('knowledge.py', None), ('messaging.py', None),
          ('mcp-command.py', None), ('mcp-contract.py', None), ('ui-orchestra-native.py', None),
          ('receive.py', 'Receive.test_muse_receive_reports_the_durable_final_assistant_message'),
          ('receive.py', 'Receive.test_muse_receive_preserves_terminal_text_when_final_boundary_is_missing'),
          ('receive.py', 'Receive.test_muse_final_response_is_extracted_after_observer_recovery')]


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1048576), b''):
            h.update(chunk)
    return h.hexdigest()


def identity(path):
    path = Path(path)
    return {'size': path.stat().st_size, 'sha256': digest(path)}


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write('\n')


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def member(root, relative):
    relative = PurePosixPath(relative)
    require(not relative.is_absolute() and relative.parts and '..' not in relative.parts,
            'Unsafe member path: ' + str(relative))
    path = root.joinpath(*relative.parts)
    require(path.is_file() and not path.is_symlink()
            and path.resolve(strict=True).is_relative_to(root.resolve(strict=True)),
            'Contained regular file is absent: ' + str(relative))
    return path


def bound_file(root, relative, expected):
    require(isinstance(expected, dict) and set(expected) == {'size', 'sha256'}
            and isinstance(expected['size'], int) and expected['size'] >= 0
            and isinstance(expected['sha256'], str)
            and re.fullmatch('[0-9a-f]{64}', expected['sha256']),
            'File binding is incomplete: ' + relative)
    path = member(root, relative)
    require(identity(path) == expected, 'File binding differs: ' + relative)
    return path


def command(evidence, label, argv, environment=None, cwd=None, expected=0):
    row = {'argv': list(map(str, argv)), 'cwd': str(cwd or Path.cwd()), 'startedUTC': utc()}
    save(evidence / (label + '.started.json'), row)
    try:
        with (evidence / (label + '.stdout')).open('xb') as out, \
                (evidence / (label + '.stderr')).open('xb') as err:
            child = subprocess.Popen(row['argv'], cwd=cwd, env=environment,
                                     stdin=subprocess.DEVNULL, stdout=out, stderr=err)
            row['pid'] = child.pid
            save(evidence / (label + '.spawn.json'), row)
            row['exitCode'] = child.wait()
    except BaseException as error:
        row.update(exception=repr(error), traceback=traceback.format_exc())
        raise
    finally:
        row['endedUTC'] = utc()
        for stream in ('stdout', 'stderr'):
            path = evidence / (label + '.' + stream)
            if path.is_file():
                row[stream] = identity(path)
        save(evidence / (label + '.json'), row)
    if expected is not None:
        require(row['exitCode'] == expected, label + ' failed; full streams are retained')
    return row


def validate_binding(binding):
    require(binding['format'] == 1 and binding['productSourceCommit'] == SOURCE_COMMIT,
            'Observer source binding differs')
    require(binding['sourceManifest']['sha256'] == SOURCE_MANIFEST_SHA,
            'Observer Main source manifest differs')
    for key in ('main', 'nineSuites', 'darwinPackage'):
        require(binding['accepted'][key] is True, 'Root acceptance is absent: ' + key)
    require(re.fullmatch('[0-9a-f]{40}', binding['observerDriverCommit'] or ''),
            'Published observer driver commit is absent')
    producer = binding['packageProducer']
    require(producer['driverCommit'] == PACKAGE_DRIVER_COMMIT
            and producer['workflowPath'] == WORKFLOW_PATH,
            'Package producer driver differs')
    require(producer['repository'] == os.environ['GITHUB_REPOSITORY'],
            'Artifact repository differs')
    for key in ('runId', 'runAttempt', 'jobId'):
        require(isinstance(producer[key], int) and producer[key] > 0,
                'Package producer identity is incomplete: ' + key)
    artifact = binding['artifact']
    require(isinstance(artifact['id'], int) and artifact['id'] > 0
            and artifact['name'] == f"final-native-context-darwin-{producer['runId']}-{producer['runAttempt']}"
            and re.fullmatch('sha256:[0-9a-f]{64}', artifact['digest'] or ''),
            'Full package artifact identity is incomplete')
    require(binding['tools']['node']['version'] == NODE_VERSION
            and binding['tools']['chrome']['version'] == CHROME_VERSION
            and binding['tools']['python']['version'], 'Observer tool versions are absent')
    require(binding['tools']['chrome']['url'] == CHROME_URL
            and binding['tools']['chrome']['relativeExecutable'] == CHROME_EXECUTABLE
            and binding['tools']['chrome']['metadata'] == CHROME_METADATA,
            'Darwin arm64 Chrome for Testing archive is required')
    baseline = binding['toolBaselineProvenance']
    require(baseline['accepted'] is True
            and re.fullmatch('[0-9a-f]{40}', baseline['driverCommit'] or '')
            and re.fullmatch('sha256:[0-9a-f]{64}', baseline['artifactDigest'] or '')
            and re.fullmatch('[0-9a-f]{64}', baseline['result']['sha256'] or '')
            and isinstance(baseline['result']['size'], int) and baseline['result']['size'] > 0
            and all(isinstance(baseline[key], int) and baseline[key] > 0
                    for key in ('runId', 'runAttempt', 'artifactId')),
            'Accepted actual tool-baseline provenance is absent')
    require(binding['package']['archivePath'] ==
            'package/baton2-development-darwin-arm64-' + SOURCE_COMMIT + '.tar.gz',
            'Full package archive path differs')


def github_json(path, evidence, label):
    request = urllib.request.Request('https://api.github.com/repos/' +
                                    os.environ['GITHUB_REPOSITORY'] + path,
                                    headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
                                             'Accept': 'application/vnd.github+json',
                                             'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.urlopen(request) as response:
        data = response.read()
        metadata = {'status': response.status, 'url': response.url,
                    'headers': dict(response.headers)}
    (evidence / (label + '.body')).write_bytes(data)
    save(evidence / (label + '.response.json'), metadata)
    return json.loads(data)


class StopRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


def download_artifact(binding, evidence):
    producer, artifact = binding['packageProducer'], binding['artifact']
    run = github_json(f"/actions/runs/{producer['runId']}/attempts/{producer['runAttempt']}",
                      evidence, 'package-run')
    require(run['id'] == producer['runId'] and run['run_attempt'] == producer['runAttempt']
            and run['head_sha'] == producer['driverCommit']
            and run['path'] == producer['workflowPath'] and run['status'] == 'completed'
            and run['conclusion'] == 'success', 'Accepted package workflow result differs')
    jobs = github_json(f"/actions/runs/{producer['runId']}/attempts/{producer['runAttempt']}/jobs?per_page=100",
                       evidence, 'package-jobs')
    job = next((row for row in jobs['jobs'] if row['id'] == producer['jobId']), None)
    require(job and job['name'] == 'darwin' and job['status'] == 'completed'
            and job['conclusion'] == 'success', 'Accepted Darwin package job differs')
    meta = github_json(f"/actions/artifacts/{artifact['id']}", evidence, 'artifact-metadata')
    require(meta['id'] == artifact['id'] and meta['name'] == artifact['name']
            and meta['digest'] == artifact['digest'] and meta['expired'] is False
            and meta['workflow_run']['id'] == producer['runId']
            and meta['workflow_run']['head_sha'] == producer['driverCommit'],
            'Accepted artifact metadata differs')
    request = urllib.request.Request('https://api.github.com/repos/' +
            producer['repository'] + f"/actions/artifacts/{artifact['id']}/zip",
            headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
                     'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
    try:
        urllib.request.build_opener(StopRedirect()).open(request)
        raise RuntimeError('Artifact download did not return its ordinary redirect')
    except urllib.error.HTTPError as response:
        require(response.code == 302, 'Artifact download status differs: ' + str(response.code))
        location = response.headers['Location']
    # The signed storage request carries no GitHub credential.
    require(location.startswith('https://'), 'Artifact storage redirect is not HTTPS')
    archive = evidence / 'accepted-full-artifact.zip'
    with urllib.request.urlopen(location) as response, archive.open('xb') as output:
        shutil.copyfileobj(response, output)
    require(digest(archive) == artifact['digest'].split(':', 1)[1],
            'Downloaded full artifact digest differs')
    destination = evidence / 'accepted-full-artifact'
    destination.mkdir(mode=0o700)
    with zipfile.ZipFile(archive) as packed:
        seen = set()
        for item in packed.infolist():
            name = PurePosixPath(item.filename)
            require(name.parts and not name.is_absolute() and '..' not in name.parts
                    and '\\' not in item.filename and name not in seen,
                    'Unsafe or repeated artifact member: ' + item.filename)
            seen.add(name)
            require(stat.S_IFMT(item.external_attr >> 16) in (0, stat.S_IFREG, stat.S_IFDIR),
                    'Unsupported artifact member: ' + item.filename)
            target = destination.joinpath(*name.parts)
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with packed.open(item) as inp, target.open('xb') as out:
                    shutil.copyfileobj(inp, out)
    return destination


def inventory(root):
    rows = {}
    for path in sorted(root.rglob('*')):
        item = path.lstat()
        relative = path.relative_to(root).as_posix()
        common = {'mode': stat.S_IMODE(item.st_mode), 'uid': item.st_uid, 'gid': item.st_gid}
        if path.is_symlink():
            rows[relative] = {**common, 'kind': 'symlink', 'target': os.readlink(path)}
        elif path.is_file():
            rows[relative] = {**common, 'kind': 'file', **identity(path)}
        elif path.is_dir():
            rows[relative] = {**common, 'kind': 'directory'}
        else:
            rows[relative] = {**common, 'kind': 'special'}
    return rows


def install(binding, artifact, evidence, product, driver):
    pkg = binding['package']
    archive = bound_file(artifact, pkg['archivePath'], pkg['archive'])
    manifest_path = bound_file(artifact, 'package/manifest.json', pkg['manifest'])
    bound_file(artifact, 'package/result.json', pkg['result'])
    sums = bound_file(artifact, 'package/SHA256SUMS', pkg['sha256sums'])
    smoke_path = bound_file(artifact, 'smoke/summary.json', pkg['smokeSummary'])
    result = json.loads(member(artifact, 'package/result.json').read_text())
    manifest = json.loads(manifest_path.read_text())
    smoke = json.loads(smoke_path.read_text())
    require(result['status'] == 'packaged' and manifest['source']['commit'] == SOURCE_COMMIT
            and result['source']['commit'] == SOURCE_COMMIT
            and manifest['platform']['artifact'] == 'darwin-arm64'
            and smoke['status'] == 'passed' and smoke['source']['commit'] == SOURCE_COMMIT,
            'Full package or smoke result differs')
    require(result['archive']['path'] == archive.name
            and result['archive']['sha256'] == pkg['archive']['sha256']
            and sums.read_text() == pkg['archive']['sha256'] + '  ' + archive.name + '\n',
            'Package archive sidecars differ')
    spec = importlib.util.spec_from_file_location('accepted_package_smoke',
            product / 'bend2/scripts/smoke-native-artifact.py')
    smoke_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(smoke_module)
    private_home = evidence / 'private-home'
    private_home.mkdir(mode=0o700)
    releases = private_home / '.local/share/baton2/releases'
    releases.mkdir(parents=True, mode=0o700)
    extracted, _ = smoke_module.extract(archive, manifest_path, releases)
    prefix = releases / ('development-' + SOURCE_COMMIT)
    require(not prefix.exists(), 'Private version prefix already exists')
    extracted.rename(prefix)
    binary = bound_file(prefix, 'bin/baton2', binding['darwinNative'])
    require(manifest['binary']['sha256'] == binding['darwinNative']['sha256']
            and manifest['binary']['source']['commit'] == SOURCE_COMMIT
            and manifest['binary']['source']['manifest']['sha256'] == SOURCE_MANIFEST_SHA,
            'Installed native/source identities differ')
    require(manifest['assets']['path'] == 'libexec/baton2'
            and manifest['assets']['source']['commit'] == SOURCE_COMMIT,
            'Installed assets source differs')
    installed_ui = prefix / 'libexec/baton2/ui'
    source_ui = product / 'bend2/ui/orchestra'
    require({p.relative_to(installed_ui).as_posix() for p in installed_ui.rglob('*') if p.is_file()} ==
            {p.relative_to(source_ui).as_posix() for p in source_ui.rglob('*') if p.is_file()},
            'Installed UI file set differs from immutable source')
    for path in sorted(source_ui.rglob('*')):
        if path.is_file():
            relative = path.relative_to(product / 'bend2/ui/orchestra').as_posix()
            require(identity(member(installed_ui, relative)) == identity(path),
                    'Installed UI member differs from immutable source: ' + relative)
    provenance = prefix / 'share/baton2/generated-c-provenance'
    proof = evidence / 'complete-handoff-verification'
    proof.mkdir(mode=0o700)
    handoff_path = bound_file(provenance, 'handoff-manifest.json', binding['handoffManifest'])
    handoff = json.loads(handoff_path.read_text())
    shutil.copyfile(handoff_path, proof / 'handoff-manifest.json')
    for relative, expected in handoff['files'].items():
        source = (bound_file(artifact, 'package/build/baton2.c', expected) if relative == 'baton2.c'
                  else bound_file(provenance, relative, expected))
        destination = proof.joinpath(*PurePosixPath(relative).parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
    require(identity(member(proof, 'source-manifest.json')) == binding['sourceManifest']
            and identity(member(proof, 'baton2.c')) == binding['generatedC']
            and identity(member(proof, 'native-build/result.json')) == binding['nativeBuildResult'],
            'Accepted Main/C evidence bindings differ')
    for key, name in [('after', 'after.json'), ('binding', 'binding.json'),
                      ('suiteResults', 'suite-results.json')]:
        bound_file(proof, 'qualification/' + name, binding['qualification'][key])
    bound_file(proof, 'qualification-plan.json', binding['qualification']['plan'])
    helper_path = driver / '.github/scripts/retained-generated-c.py'
    require(digest(helper_path) == RETAINED_HELPER_SHA, 'Retained C helper source differs')
    spec = importlib.util.spec_from_file_location('immutable_retained_c', helper_path)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    verified, build = helper.verify_handoff(proof, binding['handoffManifest']['sha256'], product)
    plan = json.loads(member(proof, 'qualification-plan.json').read_text())
    require([(Path(row['sourcePath']).name, row.get('selector')) for row in plan['suites']] == SUITES,
            'Accepted nine-suite source plan differs')
    require(build['binary']['sha256'] == binding['linuxNative']['sha256']
            and build['binary']['size'] == binding['linuxNative']['size'],
            'Accepted Linux Main native differs')
    require(manifest['build']['generated_c_provenance']['sha256'] == binding['handoffManifest']['sha256']
            and manifest['build']['generated_c_provenance']['generated_c'] == binding['generatedC'],
            'Package generated C provenance differs')
    command_dir = private_home / '.local/bin'
    command_dir.mkdir(parents=True, mode=0o700)
    executable = command_dir / 'baton2'
    executable.symlink_to(binary)
    save(evidence / 'installation.json', {'privateHome': str(private_home), 'prefix': str(prefix),
         'command': str(executable), 'commandTarget': str(executable.resolve(strict=True)),
         'binary': identity(binary), 'archive': identity(archive), 'manifest': identity(manifest_path),
         'handoff': identity(handoff_path), 'sourceCommit': verified['sourceCommit']})
    return private_home, prefix, executable


def inspect_tool(evidence, label, executable, expected=None):
    executable = executable.resolve(strict=True)
    info = executable.stat()
    observed = {'path': str(executable), 'uid': info.st_uid, 'gid': info.st_gid,
                'mode': stat.S_IMODE(info.st_mode), 'device': info.st_dev,
                'inode': info.st_ino, **identity(executable)}
    save(evidence / (label + '-before-execution.json'), observed)
    require(executable.is_file() and os.access(executable, os.X_OK),
            label + ' executable permission is absent')
    if expected is not None:
        require(identity(executable) == expected, label + ' executable differs')
    command(evidence, label + '-architecture', ['/usr/bin/file', '-b', executable])
    architecture = (evidence / (label + '-architecture.stdout')).read_text().strip()
    require('Mach-O' in architecture and 'arm64' in architecture,
            label + ' executable is not Darwin arm64')
    observed['architecture'] = architecture
    return observed


def tools(binding, evidence, driver, baseline=False):
    node = Path(shutil.which('node')).resolve(strict=True)
    python = Path(sys.executable).resolve(strict=True)
    observed = {}
    for label, executable in [('node', node), ('python', python)]:
        expected = None if baseline else binding['tools'][label]['executable']
        observed[label] = inspect_tool(evidence, label, executable, expected)
    metadata = bound_file(driver, '.github/scientific-observer/chrome-primary-metadata.json', CHROME_METADATA)
    shutil.copyfile(metadata, evidence / 'chrome-primary-metadata.json')
    shutil.copyfile(member(driver, '.github/scientific-observer/chrome-primary-source.json'),
                    evidence / 'chrome-primary-source.json')
    primary = json.loads(metadata.read_text())
    channel = primary['channels']['Stable']
    require(channel['version'] == CHROME_VERSION
            and {'platform': 'mac-arm64', 'url': CHROME_URL} in channel['downloads']['chrome'],
            'Retained Chrome primary metadata differs')
    save(evidence / 'chrome-metadata-source.json', {'url': CHROME_METADATA_URL,
         'identity': CHROME_METADATA, 'version': CHROME_VERSION, 'revision': channel['revision'],
         'platform': 'mac-arm64', 'archiveURL': CHROME_URL})
    archive = evidence / 'chrome-for-testing.zip'
    with urllib.request.urlopen(CHROME_URL) as response, archive.open('xb') as out:
        require(response.url == CHROME_URL and response.status == 200, 'Chrome archive response differs')
        save(evidence / 'chrome-download-response.json', {'url': response.url,
             'status': response.status, 'headers': dict(response.headers)})
        shutil.copyfileobj(response, out)
    archive_identity = identity(archive)
    save(evidence / 'chrome-archive-identity.json', archive_identity)
    if not baseline:
        require(archive_identity == binding['tools']['chrome']['archive'], 'Chrome archive identity differs')
    destination = evidence / 'chrome-for-testing'
    destination.mkdir(mode=0o700)
    with zipfile.ZipFile(archive) as packed:
        seen, links = set(), []
        for row in packed.infolist():
            path = PurePosixPath(row.filename)
            require(path.parts and not path.is_absolute() and '..' not in path.parts
                    and '\\' not in row.filename and path not in seen,
                    'Unsafe or repeated browser archive member')
            seen.add(path)
            kind = stat.S_IFMT(row.external_attr >> 16)
            require(kind in (0, stat.S_IFREG, stat.S_IFDIR, stat.S_IFLNK), 'Unsupported browser archive member')
            target = destination.joinpath(*path.parts)
            if kind == stat.S_IFLNK:
                link = packed.read(row).decode('utf-8')
                require(not Path(link).is_absolute() and '\x00' not in link
                        and (target.parent / link).resolve().is_relative_to(destination.resolve()),
                        'Browser symbolic link escapes its archive')
                links.append((target, link))
            elif row.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with packed.open(row) as source, target.open('xb') as out:
                    shutil.copyfileobj(source, out)
                target.chmod((row.external_attr >> 16) & 0o777 or 0o644)
        for target, link in links:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.symlink_to(link)
        for target, _ in links:
            require(target.resolve(strict=True).is_relative_to(destination.resolve()),
                    'Browser symbolic link target is unavailable or outside its archive')
    save(evidence / 'chrome-archive-inventory.json', inventory(destination))
    executable = member(destination, CHROME_EXECUTABLE)
    expected = None if baseline else binding['tools']['chrome']['executable']
    observed['chrome'] = inspect_tool(evidence, 'chrome', executable, expected)
    for label, path in [('node', node), ('python', python), ('chrome', executable)]:
        command(evidence, label + '-version', [path, '--version'])
        version = (evidence / (label + '-version.stdout')).read_text().strip()
        desired = ('v' + NODE_VERSION if label == 'node' else
                   'Google Chrome for Testing ' + CHROME_VERSION if label == 'chrome' else
                   None if baseline else binding['tools']['python']['version'])
        if desired is not None:
            require(version == desired, label + ' version differs')
        require(identity(path) == {key: observed[label][key] for key in ('size', 'sha256')},
                label + ' executable changed during metadata commands')
        observed[label]['version'] = version
        save(evidence / (label + '-identity.json'), observed[label])
    result = {'node': {'version': NODE_VERSION, 'executable': identity(node)},
              'python': {'version': observed['python']['version'], 'executable': identity(python)},
              'chrome': {'version': CHROME_VERSION, 'url': CHROME_URL,
                         'relativeExecutable': CHROME_EXECUTABLE, 'metadata': CHROME_METADATA,
                         'archive': archive_identity, 'executable': identity(executable)}}
    save(evidence / 'tool-bindings.json', result)
    return node, python, executable


def opener_snapshot(evidence, label):
    # LaunchServices may use an existing browser. These records do not grant custody of that browser.
    for suffix, argv in [('processes', ['/bin/ps', '-ww', '-axo', 'pid=,ppid=,lstart=,command=']),
                         ('applications', ['/usr/bin/lsappinfo', 'list'])]:
        command(evidence, label + '-' + suffix, argv, expected=None)


def flow(binding, name, evidence, driver, product, private_home, prefix, executable, tool_paths):
    node, python, chrome = tool_paths
    base = evidence / name
    base.mkdir(mode=0o700)
    controls = base / 'source'
    shutil.copytree(driver / '.github/scientific-observer' / name, controls)
    manifest = json.loads((driver / '.github/scientific-observer/bundle-manifest.json').read_text())
    for relative, expected in manifest[name].items():
        bound_file(controls, relative, expected)
    require(not (controls / 'native-binding.json').exists() and not (controls / 'ui').exists(),
            'Observer controls contain stale source/native overrides')
    shutil.copytree(product / 'bend2/ui/orchestra', controls / 'ui')
    save(controls / 'native-binding.json', {'executable': {'path': str(executable),
         'sha256': binding['darwinNative']['sha256']}, 'acceptedDarwinPackage': binding,
         'installedPrefix': str(prefix), 'observerDriverCommit': binding['observerDriverCommit']})
    runtime = Path('/private/tmp') / ('b2so-' + uuid.uuid4().hex[:12])
    runtime.mkdir(mode=0o700)
    temporary = runtime / 'tmp'
    temporary.mkdir(mode=0o700)
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith(('BEND_', 'OPENAI_', 'ANTHROPIC_', 'GOOGLE_', 'GEMINI_', 'DEEPSEEK_', 'ACTIONS_'))
                   and key not in ('GH_TOKEN', 'GITHUB_TOKEN', 'BASH_ENV', 'ENV', 'NODE_OPTIONS',
                                   'BATON_GIT_SERIES_CONFIG')}
    # HOME is changed only in the owned flow's environment.
    environment.update(HOME=str(private_home), PATH=str(executable.parent) + ':' + str(node.parent) +
                       ':/usr/bin:/bin:/usr/sbin:/sbin', XDG_RUNTIME_DIR=str(runtime),
                       TMPDIR=str(temporary), TMP=str(temporary), TEMP=str(temporary),
                       BATON_OBSERVER_PYTHON=str(python), BEND_NO_TELEMETRY='1')
    work, output = base / 'work', base / 'out'
    save(base / 'environment.json', {key: environment[key] for key in
         ('HOME', 'PATH', 'XDG_RUNTIME_DIR', 'TMPDIR', 'TMP', 'TEMP', 'BATON_OBSERVER_PYTHON')})
    save(base / 'custody-boundary.json', {'runtime': str(runtime), 'uid': os.getuid(),
         'gid': os.getgid(), 'runtimeMode': stat.S_IMODE(runtime.stat().st_mode),
         'executable': str(executable), 'work': str(work), 'out': str(output),
         'opener': 'Ordinary system open through the installed native view; external application state is observed separately.'})
    opener_snapshot(base, 'opener-before')
    record = command(base, 'flow', [node, controls / 'native-flow.mjs', work, output, chrome, executable],
                     environment=environment, cwd=base, expected=None)
    opener_snapshot(base, 'opener-after')
    spool_rows = {}
    for suffix in ('stdout', 'stderr'):
        path = work / ('orchestra.db.dispatch-766965772d6f70656e.' + suffix)
        spool_rows[suffix] = {'exists': path.exists(), 'identity': identity(path) if path.is_file() else None,
                              'path': str(path)}
    save(base / 'opener-observation.json', {'streams': spool_rows,
         'admittedPid': None,
         'sourceBoundary': 'ui-view.open_result discards Control.launch Done text containing deliveryPid; source spools and before/after application/process observations are retained.',
         'externalApplicationCustody': 'No stop or tab-close action is authorized for a default browser launched or reused by LaunchServices.'})
    if work.exists():
        save(base / 'work-inventory-after.json', inventory(work))
    save(base / 'runtime-inventory-after.json', inventory(runtime))
    if output.exists() and (output / 'custody-after.json').exists():
        after = json.loads((output / 'custody-after.json').read_text())
        require(after['ownProcesses'] == [], name + ' retained owned processes after cleanup')
    else:
        raise RuntimeError(name + ' final custody evidence is absent')
    require(record['exitCode'] == 0, name + ' scientific flow failed; complete output is retained')
    return record


def prepare(args):
    args.evidence.mkdir(mode=0o700, parents=False, exist_ok=False)
    require(os.environ['GITHUB_EVENT_NAME'] == 'workflow_dispatch'
            and os.environ['RUNTIME_SUITE'] == 'scientific-installed-darwin-observation',
            'Installed observer requires its explicit workflow selection')
    raw = os.environ['SCIENTIFIC_OBSERVATION_BINDING']
    (args.evidence / 'binding-input.json').write_text(raw)
    binding = json.loads(raw)
    validate_binding(binding)
    require(subprocess.check_output(['git', '-C', str(args.driver), 'rev-parse', 'HEAD'],
                                    text=True).strip() == binding['observerDriverCommit'],
            'Observer checkout differs from published binding')
    require(os.environ['GITHUB_SHA'] == binding['observerDriverCommit']
            and os.environ['GITHUB_WORKFLOW_SHA'] == binding['observerDriverCommit'],
            'Dispatch workflow source differs from observer checkout')
    save(args.evidence / 'workflow-context.json', {key: os.environ.get(key) for key in
         ('GITHUB_REPOSITORY', 'GITHUB_SHA', 'GITHUB_WORKFLOW_SHA', 'GITHUB_WORKFLOW_REF',
          'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_JOB', 'RUNNER_OS', 'RUNNER_ARCH', 'RUNNER_NAME')})
    save(args.evidence / 'account-platform.json', {'uid': os.getuid(), 'gid': os.getgid(),
         'user': subprocess.check_output(['/usr/bin/id', '-un'], text=True).strip(),
         'system': platform.system(), 'machine': platform.machine(), 'python': str(Path(sys.executable).resolve()),
         'pythonIdentity': identity(Path(sys.executable).resolve())})
    require(platform.system() == 'Darwin' and platform.machine() == 'arm64',
            'Installed scientific observer requires Darwin arm64')
    with Path(os.environ['GITHUB_OUTPUT']).open('a') as output:
        output.write('product_source=' + binding['productSourceCommit'] + '\n')
        output.write('node_version=' + binding['tools']['node']['version'] + '\n')


def baseline_prepare(args):
    args.evidence.mkdir(mode=0o700, parents=False, exist_ok=False)
    require(os.environ['GITHUB_EVENT_NAME'] == 'workflow_dispatch'
            and os.environ['RUNTIME_SUITE'] == 'scientific-darwin-tool-baseline',
            'Tool baseline requires its explicit workflow selection')
    raw = os.environ['SCIENTIFIC_OBSERVATION_BINDING']
    (args.evidence / 'binding-input.json').write_text(raw)
    binding = json.loads(raw)
    require(binding['format'] == 1 and re.fullmatch('[0-9a-f]{40}', binding['observerDriverCommit'] or ''),
            'Published baseline driver binding is absent')
    command(args.evidence, 'driver-commit', ['git', '-C', args.driver, 'rev-parse', 'HEAD'])
    require((args.evidence / 'driver-commit.stdout').read_text().strip() == binding['observerDriverCommit']
            and os.environ['GITHUB_SHA'] == binding['observerDriverCommit']
            and os.environ['GITHUB_WORKFLOW_SHA'] == binding['observerDriverCommit'],
            'Baseline dispatch workflow or checkout differs')
    save(args.evidence / 'workflow-context.json', {key: os.environ.get(key) for key in
         ('GITHUB_REPOSITORY', 'GITHUB_SHA', 'GITHUB_WORKFLOW_SHA', 'GITHUB_WORKFLOW_REF',
          'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_JOB', 'RUNNER_OS', 'RUNNER_ARCH', 'RUNNER_NAME')})
    sources = {}
    for label, relative in [('workflow', WORKFLOW_PATH),
                            ('observer-helper', '.github/scripts/scientific-installed-darwin-observer.py'),
                            ('retained-c-helper', '.github/scripts/retained-generated-c.py')]:
        source = member(args.driver, relative)
        sources[label] = {'relativePath': relative, **identity(source)}
        shutil.copyfile(source, args.evidence / (label + '.source'))
    require(sources['retained-c-helper']['sha256'] == RETAINED_HELPER_SHA,
            'Original retained C helper source differs')
    save(args.evidence / 'source-provenance.json', {'driverCommit': binding['observerDriverCommit'],
         'baseDriverCommit': PACKAGE_DRIVER_COMMIT, 'files': sources,
         'actions': {'checkout': '34e114876b0b11c390a56381ad16ebd13914f8d5',
                     'setupNode': '49933ea5288caeca8642d1e84afbd3f7d6820020',
                     'uploadArtifact': 'ea165f8d65b6e75b540449e92b4886f43607fa02'}})
    for label, argv in [('account', ['/usr/bin/id']), ('platform', ['/usr/bin/uname', '-a']),
                        ('os-version', ['/usr/bin/sw_vers'])]:
        command(args.evidence, label, argv)
    save(args.evidence / 'bootstrap-utility-identities.json', {name: {'path': path,
         **identity(Path(path).resolve(strict=True))} for name, path in
         [('id', '/usr/bin/id'), ('uname', '/usr/bin/uname'), ('swVers', '/usr/bin/sw_vers'),
          ('file', '/usr/bin/file'), ('git', shutil.which('git'))]})
    python = Path(sys.executable).resolve(strict=True)
    save(args.evidence / 'account-platform.json', {'uid': os.getuid(), 'gid': os.getgid(),
         'system': platform.system(), 'machine': platform.machine(), 'bootstrapPython': str(python),
         'bootstrapPythonIdentity': identity(python)})
    require(platform.system() == 'Darwin' and platform.machine() == 'arm64',
            'Tool baseline requires Darwin arm64')
    save(args.evidence / 'baseline-preparation.json', {'binding': identity(args.evidence / 'binding-input.json'),
         'driverCommit': binding['observerDriverCommit'], 'nodeVersion': NODE_VERSION,
         'chromeVersion': CHROME_VERSION, 'chromeURL': CHROME_URL, 'nativePackage': None})


def baseline(args):
    require(os.environ['RUNTIME_SUITE'] == 'scientific-darwin-tool-baseline',
            'Tool baseline selection differs')
    prepared = json.loads((args.evidence / 'baseline-preparation.json').read_text())
    require(identity(args.evidence / 'binding-input.json') == prepared['binding']
            and os.environ['GITHUB_SHA'] == prepared['driverCommit']
            and os.environ['GITHUB_WORKFLOW_SHA'] == prepared['driverCommit'],
            'Prepared baseline source or input changed')
    sources = json.loads((args.evidence / 'source-provenance.json').read_text())
    for row in sources['files'].values():
        require(identity(member(args.driver, row['relativePath'])) ==
                {key: row[key] for key in ('size', 'sha256')},
                'Baseline driver source changed after preparation')
    result = {'status': 'failed', 'startedUTC': utc(), 'driverCommit': prepared['driverCommit'],
              'binding': prepared['binding'], 'nativePackage': None, 'browserSession': None,
              'nodeSetupOutcome': os.environ.get('NODE_SETUP_OUTCOME')}
    try:
        tools(None, args.evidence, args.driver, baseline=True)
        result['tools'] = json.loads((args.evidence / 'tool-bindings.json').read_text())
        result['status'] = 'passed'
    except BaseException as error:
        result.update(exception=repr(error), traceback=traceback.format_exc())
        raise
    finally:
        result['endedUTC'] = utc()
        save(args.evidence / 'baseline-result.json', result)


def observe(args):
    binding = json.loads((args.evidence / 'binding-input.json').read_text())
    validate_binding(binding)
    before = None
    result = {'status': 'failed', 'startedUTC': utc(), 'sourceCommit': SOURCE_COMMIT,
              'flows': [], 'binding': identity(args.evidence / 'binding-input.json')}
    try:
        tool_paths = tools(binding, args.evidence, args.driver)
        artifact = download_artifact(binding, args.evidence)
        private_home, prefix, executable = install(binding, artifact, args.evidence, args.product, args.driver)
        before = inventory(prefix)
        save(args.evidence / 'installed-inventory-before.json', before)
        for name in ('reading', 'numeric'):
            result['flows'].append({'name': name, **flow(binding, name, args.evidence, args.driver,
                                 args.product, private_home, prefix, executable, tool_paths)})
        result['status'] = 'passed'
    except BaseException as error:
        result['exception'] = repr(error)
        result['traceback'] = traceback.format_exc()
        raise
    finally:
        result['endedUTC'] = utc()
        if before is not None:
            after = inventory(prefix)
            save(args.evidence / 'installed-inventory-after.json', after)
            result['installedPayloadUnchanged'] = before == after
            if before != after:
                result['status'] = 'failed'
                result['installedPayloadDifference'] = True
        result['openerLimit'] = 'Original native open path is preserved. The native view discards its admitted PID; observed default-browser state remains separate from owned CDP custody.'
        save(args.evidence / 'result.json', result)
    require(result['status'] == 'passed', 'Installed package payload changed during observation')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=('prepare', 'observe', 'baseline-prepare', 'baseline'))
    parser.add_argument('--driver', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--product', type=Path)
    args = parser.parse_args()
    try:
        if args.operation == 'prepare':
            prepare(args)
        elif args.operation == 'baseline-prepare':
            baseline_prepare(args)
        elif args.operation == 'baseline':
            baseline(args)
        else:
            require(args.product is not None, 'Immutable product checkout is required')
            observe(args)
    except BaseException:
        if args.evidence.is_dir() and not (args.evidence / 'runner-error.txt').exists():
            (args.evidence / 'runner-error.txt').write_text(traceback.format_exc())
        raise


if __name__ == '__main__':
    main()
