"""Stage exact anatomy caches for future wrappers with qualified common inputs."""
import hashlib
import ast
import json
import os
import pathlib
import re
import tempfile

VERSION = 'common-person-anatomy-v1'
QUERY_HELPER_SHA256 = '03fc2e36b1dceaa73aa8638f0ce688601ac4f8d3c191e21f3f27d498d0f4ed6c'
QUERY_VERSION = 'anatomy-queries-exact-v1'
QUALIFIED_CPU_POLICY = '07f541989fb4cde60edeea912f56d38313128e15b5f358d79903c3f07547cbaf'
EXISTING_PIPELINE_ENTRIES = {
    'person_job.py', 'eye7_job.py', 'anat8p_person_job.py', 'person7_job.py',
    'allpower_people_job.py', 'byauthority_crew_job.py',
}
QUALIFIED_PERSON = {'bac02e41a7e7ed08aca5c8d91a3ad1aec3fd06c6676eb4efe482b1b4417eb7d0'}
QUALIFIED_HELPERS = {
    'soft_parallel.mjs': 'da7b438eef755ebf114a345f25cd58b92b58192e743ab7747bea85228e9a51fd',
    'pelvis_coalesce.mjs': '4e0470602102aa02090042688decb4be663a3927f8d5b4aff2a3939edf666acd',
}
MODERN_LIBRARIES = {'825439d5668bcead39d98453a6a7c11cd94f1ac182808967ac91b8d7c6d9ca6e', '34b7a460220d46d15a6cccda9e59532b1b120b082463bc45254ccf56f4927c58'}
MODERN_HELPERS = {'common_soft_fields.mjs': '4b606f426cbe69cc9f1b0f1cd952c1390a392c3a2f7271fa5472533f8abd9eb7', 'common_pelvis_fields.mjs': '202329e3adc552077bc8840c308a7d9875d66bf596f07de389e1ef0d1f7a3c95'}
CHILD_GUARD_SHA256 = 'd7a186ba9a5e511b4a19d68e62256e471dfd4d31d65e6cadfbe137cdd30e72a1'
# This family differs from the established integration library only in fine,
# cloth, face and likeness sources. Both anatomy numerical closures are exact.
ADDITIONAL_LIBRARIES = {'bc81b7818030d18667566470536cb735f9028182e56e7d91163b3cde6a7aa02a'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def atomic_write(target, data):
    if target.is_symlink():
        raise ValueError('Common generated member is a symlink')
    descriptor, temporary = tempfile.mkstemp(prefix='.common-', dir=target.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, target)
        descriptor = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def library_digest(web):
    result = hashlib.sha256()
    def walk(directory):
        if directory.is_symlink():
            raise ValueError('Unexpected source symlink')
        for entry in sorted(directory.iterdir()):
            if entry.is_symlink():
                raise ValueError('Unexpected source symlink')
            if entry.is_dir():
                walk(entry)
            elif entry.is_file():
                result.update(entry.relative_to(web).as_posix().encode())
                result.update(b'\0'); result.update(entry.read_bytes()); result.update(b'\0')
            else:
                raise ValueError('Unexpected source type')
    walk(web / 'lib')
    return result.hexdigest()


def helper_sources(modern=False):
    result = {}
    for name, expected in (MODERN_HELPERS if modern else QUALIFIED_HELPERS).items():
        data = pathlib.Path(__file__).with_name(name).read_bytes()
        if digest(data) != expected:
            raise ValueError('Unqualified common helper: ' + name)
        result[name] = data.decode()
    return result


def function_source(source, name):
    marker = 'function ' + name + '('
    if source.count(marker) != 1:
        raise ValueError('Helper function layout changed: ' + name)
    start = source.index(marker)
    end = source.index('\n}\n', start) + 2
    return source[start:end]


def qualified_set(source, name):
    match = re.search(r'const ' + re.escape(name) + r' = new Set\(\[([\s\S]*?)\]\);', source)
    if not match:
        raise ValueError('Helper qualification layout changed')
    return set(re.findall(r"'([0-9a-f]{64})'", match.group(1)))


def bootstrap_source(sources):
    configs = {}
    modern = 'common_soft_fields.mjs' in sources
    names = [('soft', 'common_soft_fields.mjs'), ('pelvis', 'common_pelvis_fields.mjs')] if modern else [('soft', 'soft_parallel.mjs'), ('pelvis', 'pelvis_coalesce.mjs')]
    pins = MODERN_HELPERS if modern else QUALIFIED_HELPERS
    for kind, filename in names:
        source = sources[filename]
        configs[kind] = dict(filename=filename, sha256=pins[filename],
            hooks=sorted(qualified_set(source, 'QUALIFIED_HOOKS')),
            libraries=sorted(qualified_set(source, 'QUALIFIED_LIBRARIES') | (set() if modern else ADDITIONAL_LIBRARIES)),
            transform=function_source(source, 'transformHook').replace('import.meta.url', 'helperURL'),
            sourceDigest=function_source(source, 'sourceDigest'))
    return BOOTSTRAP.replace('CONFIGURATION', json.dumps(configs, sort_keys=True))


BOOTSTRAP = r'''// Generated from pinned exact anatomy transforms.
'use strict';
var fs = require('fs'), path = require('path'), crypto = require('crypto'), urls = require('url');
var configuration = CONFIGURATION;
function sha(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function prepare(kind) {
  var c = configuration[kind], helper = path.join(__dirname, c.filename);
  if (sha(fs.readFileSync(helper)) !== c.sha256) throw Error('Common helper bytes changed: ' + kind);
  var factory = new Function('fs', 'path', 'fileURLToPath', 'createHash', 'sha',
    'QUALIFIED_HOOKS', 'QUALIFIED_LIBRARIES', 'helperURL',
    c.sourceDigest + '\n' + c.transform + '\nreturn transformHook;');
  return factory(fs, path, urls.fileURLToPath, crypto.createHash, sha,
    new Set(c.hooks), new Set(c.libraries), urls.pathToFileURL(helper).href);
}
var transforms = {};
function transform(kind, source, url) {
  if (!transforms[kind]) transforms[kind] = prepare(kind);
  return transforms[kind](source, url);
}
function initialize(nodeModule) {
  if (typeof nodeModule.registerHooks !== 'function') {
    console.error('farm common anatomy: loader unavailable; using original solve');
    return false;
  }
  nodeModule.registerHooks({ load: function(url, context, next) {
    var loaded = next(url, context), kind;
    if (url.endsWith('/lib/fx/anatomy/soft/hook.js')) kind = 'soft';
    if (url.endsWith('/lib/fx/anatomy/pelvis/hook.js')) kind = 'pelvis';
    if (kind && loaded.format === 'module') {
      try {
        var output = Object.assign({}, loaded);
        output.source = transform(kind, Buffer.from(loaded.source).toString(), url);
        return output;
      } catch(error) {
        console.error('farm common anatomy: ' + error.message + '; using original solve');
      }
    }
    return loaded;
  }});
  return true;
}
module.exports = { transform: transform, initialize: initialize };
if (process.env.ACP_COMMON_PERSON_ANATOMY === '1') initialize(require('module'));
'''


SHIM = '''# Generated future-job entry; original wrapper bytes remain pinned.
def _farm_common_person_entry():
    import hashlib, os, pathlib, sys
    folder = pathlib.Path(__file__).resolve().parent
    original = folder / {original_name!r}
    expected = {original_sha!r}
    data = original.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise RuntimeError('Common person entry bytes changed')
    bundle = folder / {bundle_path!r}
    for name, expected in {file_hashes!r}.items():
        member = bundle / name
        if member.is_symlink() or hashlib.sha256(member.read_bytes()).hexdigest() != expected:
            raise RuntimeError('Common person helper bytes changed: ' + name)
    if {cache_enabled!r}:
        helper = bundle / 'common_anatomy.cjs'
        token = '--require=' + __import__('json').dumps(str(helper.resolve()))
        os.environ['NODE_OPTIONS'] = (os.environ.get('NODE_OPTIONS', '') + ' ' + token).strip()
        os.environ['ACP_COMMON_PERSON_ANATOMY'] = '1'
        persistent = os.environ.get('XDG_CACHE_HOME')
        if not persistent:
            home = os.environ.get('GPU_JOB_HOME')
            persistent = os.path.join(home, 'cache') if home else str(folder.parent / 'out')
        os.environ.setdefault('ACP_SOFT_CACHE_DIR', os.path.join(persistent, 'farm-anatomy'))
        os.environ.setdefault('ACP_PELVIS_CACHE_DIR', os.path.join(persistent, 'farm-pelvis'))
    # Keep the original interpreter arguments and restore its script token.
    for index, value in enumerate(sys.argv):
        if index and sys.argv[index - 1] == '--':
            break
        if index and sys.argv[index - 1] not in ('--python', '-P'):
            continue
        if value == __file__ or value == {generated_entry!r}:
            sys.argv[index] = str(original) if os.path.isabs(value) else {original_entry!r}
    namespace = globals()
    namespace['__file__'] = str(original)
    del namespace['_farm_common_person_entry']
    guard_name = {guard_name!r}
    if guard_name:
        import importlib.util
        spec = importlib.util.spec_from_file_location('farm_person_child_failures_v1', bundle / guard_name)
        guard = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(guard)
        guard.exec_driver(data, str(original), namespace)
    else:
        exec(compile(data, str(original), 'exec'), namespace, namespace)
_farm_common_person_entry()
'''


def install_fallback(repo, argv, prior_policy):
    """Return a future recipe. The caller retains its existing admission budget."""
    result, policy = list(argv), dict(prior_policy)
    if policy.get('status') != 'original_recipe' or policy.get('cpu_stage_workers') != 1:
        return result, policy
    if (len(argv) < 4 or argv[:3] != ['sh', 'videos/scripts/gpu_job.sh', 'blender']):
        return result, policy
    entry = pathlib.PurePosixPath(argv[3])
    if entry.parent != pathlib.PurePosixPath('videos/blender') or entry.suffix != '.py':
        return result, policy
    if entry.name in EXISTING_PIPELINE_ENTRIES:
        return result, policy
    folder = pathlib.Path(repo) / 'videos/blender'
    original = folder / entry.name
    if original.is_symlink() or not original.is_file():
        return result, policy
    original_sha = digest(original.read_bytes())
    guard_name = None
    guard_file = pathlib.Path(__file__).with_name('person_child_failures.py')
    if guard_file.is_symlink() or not guard_file.is_file():
        raise ValueError('Common child failure guard is required')
    guard_data = guard_file.read_bytes()
    if digest(guard_data) != CHILD_GUARD_SHA256:
        raise ValueError('Unqualified common child failure guard')
    tree = ast.parse(guard_data)
    qualified = next(ast.literal_eval(node.value) for node in tree.body
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'QUALIFIED_DRIVERS' for t in node.targets))
    files = {}
    if original_sha in qualified:
        for name, expected in qualified[original_sha].items():
            dependency = folder / name
            if dependency.is_symlink() or not dependency.is_file() or digest(dependency.read_bytes()) != expected:
                raise ValueError('Qualified person child source changed: ' + name)
        guard_name = 'person_child_failures.py'
        files[guard_name] = guard_data.decode()
    person = folder / 'person_job.py'
    library = None
    cache_enabled = False
    reason = None
    try:
        if person.is_symlink() or digest(person.read_bytes()) not in QUALIFIED_PERSON:
            raise ValueError('Common person source requires qualification')
        library = library_digest(pathlib.Path(repo) / 'videos/web')
        sources = helper_sources(modern=library in MODERN_LIBRARIES)
        # A generic interface needs both exact numerical closures qualified.
        common = set.intersection(*(qualified_set(s, 'QUALIFIED_LIBRARIES') | ADDITIONAL_LIBRARIES
                                    for s in sources.values()))
        if library not in common:
            raise ValueError('Common anatomy library requires qualification')
        bootstrap = bootstrap_source(sources)
        query_file = pathlib.Path(__file__).with_name('anatomy_queries.cjs')
        if query_file.is_symlink() or not query_file.is_file():
            raise ValueError('Common numerical query helper is required')
        query_data = query_file.read_bytes()
        if digest(query_data) != QUERY_HELPER_SHA256:
            raise ValueError('Unqualified common numerical query helper')
        bootstrap += "\nif (process.env.ACP_COMMON_PERSON_ANATOMY === '1') require('./anatomy_queries.cjs').initialize();\n"
        files.update(sources, **{'common_anatomy.cjs': bootstrap, 'anatomy_queries.cjs': query_data.decode()})
        cache_enabled = True
    except (OSError, ValueError) as error:
        reason = str(error)
    if not cache_enabled and guard_name is None:
        return result, dict(policy, common_anatomy='qualification_required', reason=reason, library_sha256=library)
    file_hashes = {name: digest(data.encode()) for name, data in files.items()}
    bundle = digest(json.dumps(file_hashes, sort_keys=True).encode())
    relative = '.farm-common-anatomy/' + bundle
    destination = folder / relative
    if destination.parent.is_symlink() or destination.is_symlink():
        raise ValueError('Common helper destination is a symlink')
    destination.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        target = destination / name
        if target.is_symlink():
            raise ValueError('Common helper member is a symlink')
        if target.exists():
            if target.read_text() != data:
                raise ValueError('Common generated member bytes changed')
        else:
            atomic_write(target, data.encode())
    generated_entry = str(entry.with_name(entry.stem + '.farm-common.py'))
    generated = folder / pathlib.PurePosixPath(generated_entry).name
    if generated.is_symlink():
        raise ValueError('Common entry is a symlink')
    atomic_write(generated, SHIM.format(original_name=entry.name, original_sha=original_sha,
        bundle_path=relative, file_hashes=file_hashes, generated_entry=generated_entry,
        original_entry=str(entry), guard_name=guard_name, cache_enabled=cache_enabled).encode())
    result[3] = generated_entry
    return result, dict(policy, status='common_anatomy_cache_v1' if cache_enabled else 'common_person_guard_v1', gpu_stage_leases='whole_job',
        source_sha256=digest(person.read_bytes()),
        common_anatomy=dict(enabled=cache_enabled, library_sha256=library, reason=reason, **({'numerical_queries': QUERY_VERSION} if cache_enabled else {})),
        common_person=dict(version=VERSION, helper_sha256=file_hashes,
            bundle_sha256=bundle, original_entry=str(entry), original_sha256=original_sha,
            child_failure_guard=guard_name is not None,
            concurrency='original_wrapper', quality_parameters='original_arguments'))


def adapt_cpu_policy(source):
    """Add the generic fallback after the exact current policy returns."""
    if digest(source.encode()) != QUALIFIED_CPU_POLICY:
        raise ValueError('Common person host policy requires qualification')
    result = source + '''

FARM_COMMON_PERSON_VERSION = 'common-person-anatomy-v1'
farm_existing_person_install = install
def install(repo, argv, workers, lease_stages=False):
    from common_person import install_fallback
    result, policy = farm_existing_person_install(repo, argv, workers, lease_stages=lease_stages)
    return install_fallback(repo, result, policy)
'''
    compile(result, 'person_cpu_policy.py', 'exec')
    return result
