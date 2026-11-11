"""Overlap independent CPU detail preparation with GPU atlas baking."""
import ast
from pathlib import Path

VERSION = 'person-detail-overlap-and-shared-tiles-v4'

HELPER = r'''
FARM_PERSON_PIPELINE = 'person-detail-overlap-and-shared-tiles-v4'
farm_fine7_pool = None
farm_fine7_tasks = []

def farm_fine7_hash(path):
    import hashlib
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()

def farm_fine7_sync(directory):
    descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

def farm_fine7_record(directory, detail):
    from pathlib import Path
    detail = Path(detail)
    with open(detail / 'fine7.json') as stream:
        metadata = json.load(stream)
    W, H, n = (metadata.get(name) for name in ('W', 'H', 'n'))
    if any(type(value) is not int or value <= 0 for value in (W, H, n)):
        raise ValueError('Invalid detail map dimensions')
    sizes = {'height.f32': W * H * 4, 'uv.f32': n * 3 * 4}
    if metadata.get('split'):
        sizes.update({name: W * H * 4 for name in ('height_lo.f32', 'height_hi.f32', 'cav_hi.f32')})
    if metadata.get('var'):
        sizes['var.f32'] = W * H * 4
    if metadata.get('mix'):
        sizes.update({name: W * H * 4 for name in ('varo.f32', 'hide.f32')})
    for name, size in sizes.items():
        path = detail / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size != size:
            raise ValueError('Incomplete detail map: ' + name)
    return dict(version=1, inputs={name: farm_fine7_hash(Path(directory) / name)
        for name in ('manifest.json', 'person.bin')},
        files={name: farm_fine7_hash(detail / name) for name in [*sizes, 'fine7.json']})

def farm_fine7_ready(directory):
    from pathlib import Path
    detail = Path(directory) / 'fine7'
    completion = detail / '.farm-complete.json'
    if not completion.exists():
        return (detail / 'fine7.json').exists()
    try:
        with open(completion) as stream:
            expected = json.load(stream)
        if expected != farm_fine7_record(directory, detail):
            raise ValueError('Detail checkpoint hashes changed')
        return True
    except (OSError, ValueError, TypeError) as error:
        import uuid
        os.rename(detail, str(detail) + '.farm-incomplete-' + uuid.uuid4().hex)
        farm_fine7_sync(directory)
        print('farm fine7: preserving invalid detail checkpoint for retry: ' + repr(error), flush=True)
        return False

def farm_fine7_workspace(directory):
    import hashlib
    import shutil
    import tempfile
    from pathlib import Path
    holder = tempfile.TemporaryDirectory(prefix='.farm-fine7-', dir=WORK)
    root = Path(holder.name)
    web = root / 'web'
    web.mkdir()
    original = Path(VIDEOS) / 'web'
    shutil.copytree(original / 'lib', web / 'lib', ignore=shutil.ignore_patterns('__pycache__'))
    for name in ['package.json', 'package-lock.json']:
        if (original / name).exists(): shutil.copy2(original / name, web / name)
    (web / 'node_modules').symlink_to(original / 'node_modules', target_is_directory=True)
    script = web / 'labs/human8/fine7_bake.mjs'
    script.parent.mkdir(parents=True)
    shutil.copy2(original / 'labs/human8/fine7_bake.mjs', script)
    mutable = ('anatomy/soft', 'anatomy/pelvis', 'person/anat8h/cache', 'person/fine7/navel')
    def mirror(source, target, relative=''):
        target.mkdir()
        for entry in source.iterdir():
            name = relative + '/' + entry.name if relative else entry.name
            destination = target / entry.name
            if name in mutable:
                shutil.copytree(entry, destination)
            elif any(prefix.startswith(name + '/') for prefix in mutable):
                mirror(entry, destination, name)
            else:
                destination.symlink_to(entry, target_is_directory=entry.is_dir())
    mirror(original / 'assets', web / 'assets')
    def assets():
        return {str(path.relative_to(web / 'assets')): hashlib.sha256(path.read_bytes()).hexdigest()
                for prefix in mutable for path in (web / 'assets' / prefix).rglob('*') if path.is_file()}
    before = assets()
    export = root / 'export'
    export.mkdir()
    for name in ['manifest.json', 'person.bin']:
        (export / name).symlink_to(Path(directory) / name)
    guard = root / 'guard.mjs'
    guard.write_text("""import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const roots = JSON.parse(process.env.ACP_FINE7_WRITE_ROOTS);
const permit = target => {
  const p = target instanceof URL ? new URL(target).pathname : path.resolve(String(target));
  if (!roots.some(root => p === root || p.startsWith(root + '/'))) throw new Error('fine7 write outside private cache: ' + p);
  if (fs.existsSync(p)) {
    const real = fs.realpathSync(p);
    if (!roots.some(root => real === root || real.startsWith(root + '/'))) throw new Error('fine7 write through source link: ' + p);
  }
};
for (const name of ['writeFileSync', 'mkdirSync']) {
  const original = fs[name];
  fs[name] = function(target, ...args) { permit(target); return original.call(this, target, ...args); };
}
syncBuiltinESMExports();
""")
    return holder, root, export, assets, before

def farm_fine7_publish(result, directory):
    import tempfile
    from pathlib import Path
    code, holder, root, export, assets, before = result
    try:
        if code:
            return code
        detail = export / 'fine7'
        record = farm_fine7_record(directory, detail)
        completion = detail / '.farm-complete.json'
        completion.write_text(json.dumps(record, sort_keys=True))
        for name in [*record['files'], completion.name]:
            with open(detail / name, 'rb') as stream:
                os.fsync(stream.fileno())
        farm_fine7_sync(detail)
        for name, digest in assets().items():
            if before.get(name) == digest:
                continue
            if Path(name).suffix not in ('.json', '.bin'):
                raise ValueError('Unexpected generated anatomy asset: ' + name)
            source = root / 'web/assets' / name
            target = Path(VIDEOS) / 'web/assets' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(prefix='.farm-fine7-', dir=target.parent, delete=False) as stream:
                temporary = stream.name
                stream.write(source.read_bytes()); stream.flush(); os.fsync(stream.fileno())
            os.replace(temporary, target)
            farm_fine7_sync(target.parent)
        target = Path(directory) / 'fine7'
        if farm_fine7_ready(directory):
            return 0
        if target.exists():
            os.rename(target, str(target) + '.farm-incomplete-' + os.path.basename(str(root)))
        os.rename(export / 'fine7', target)
        farm_fine7_sync(directory)
        return 0
    finally:
        holder.cleanup()

def farm_scene_command(command):
    command = list(command)
    boundary = command.index('--') if '--' in command else len(command)
    for index in range(boundary - 1):
        if command[index] in ('-P', '--python') and os.path.basename(command[index + 1]) == 'render_person.py':
            setup = 'import sys;sys.path.insert(0,' + repr(HERE) + ');farm_tiles={};exec(' + repr(FARM_SCENE_TILE_SOURCE) + ',farm_tiles);farm_tiles["install"]()'
            command[index:index] = ['--python-expr', setup]
            break
    return command

def farm_fine7_start():
    global farm_fine7_pool, farm_fine7_tasks
    import hashlib
    from concurrent.futures import ThreadPoolExecutor
    if DRY:
        return
    script = os.path.join(VIDEOS, 'web/labs/human8/fine7_bake.mjs')
    if not os.path.exists(script):
        return
    with open(script, 'rb') as source:
        if hashlib.sha256(source.read()).hexdigest() != 'a85f51a9870a730b8516aa1bf9c8b1181d7dc1b64d463a21cd74bae3b3506193':
            print('farm fine7: source requires qualification; scene build owns detail preparation', flush=True)
            return
    selected = []
    for wear in dict.fromkeys(shot[2] for shot in SHOTS):
        directory = ex[wear]
        with open(os.path.join(directory, 'manifest.json')) as source:
            options = (json.load(source).get('spec') or {}).get('popts') or {}
        setting = options.get('fine7')
        if setting is None or setting is False or farm_fine7_ready(directory):
            continue
        selected.append((wear, directory))
    if not selected:
        return
    workers = min(len(selected), int(os.environ.get('ACP_CPU_STAGE_WORKERS', '1')))
    if workers < 1:
        raise ValueError('ACP_CPU_STAGE_WORKERS must be positive')
    farm_fine7_pool = ThreadPoolExecutor(max_workers=workers)
    def prepare(wear, directory):
        started = time.monotonic()
        holder, root, export, assets, before = farm_fine7_workspace(directory)
        command = [NODE, '--import', str(root / 'guard.mjs'), str(root / 'web/labs/human8/fine7_bake.mjs'), str(export)]
        roots = [str(root / 'web/assets' / prefix) for prefix in ('anatomy/soft', 'anatomy/pelvis', 'person/anat8h/cache', 'person/fine7/navel')]
        env = dict(os.environ, ACP_FINE7_WRITE_ROOTS=json.dumps([*roots, str(export / 'fine7')]))
        print('farm fine7: CPU preparation started for ' + wear, flush=True)
        try:
            result = subprocess.run(command, cwd=str(root), env=env)
        except BaseException:
            holder.cleanup()
            raise
        record = dict(cmd=command[:4], tag='fine7-cpu-' + wear,
                      s=round(time.monotonic() - started, 1), code=result.returncode)
        log.append(record)
        print('farm fine7: CPU preparation finished ' + json.dumps(record), flush=True)
        return result.returncode, holder, root, export, assets, before
    farm_fine7_tasks = [(wear, farm_fine7_pool.submit(prepare, wear, directory)) for wear, directory in selected]

def farm_fine7_wait():
    global farm_fine7_pool, farm_fine7_tasks
    if farm_fine7_pool is None:
        return
    try:
        for wear, future in farm_fine7_tasks:
            try:
                result = future.result()
                code = farm_fine7_publish(result, ex[wear])
            except Exception as error:
                print('farm fine7: CPU preparation failed for ' + wear + ': ' + repr(error) + '; scene build will retry', flush=True)
                continue
            if code:
                print('farm fine7: CPU preparation exited ' + str(code) + ' for ' + wear + '; scene build will retry', flush=True)
    finally:
        farm_fine7_pool.shutdown(wait=True)
        farm_fine7_pool = None
        farm_fine7_tasks = []

'''


def eligible(source):
    return ("MAPS = {'bare':" in source and "boot = os.path.join(HERE, 'gpujob', 'boot.py')" in source
            and 'farm_cpu_map(farm_prepare_wear, wears)' in source)


def adapt(source):
    if "FARM_PERSON_PIPELINE = '" + VERSION + "'" in source:
        return adapt_scene_batch(source)
    source = remove_previous(source)
    if not eligible(source):
        return source
    tree = ast.parse(source)
    run = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'run')
    lines = source.splitlines(keepends=True)
    # Preserve the existing dispatch, diagnostics, cache restore, and error handling.
    lines.insert(run.body[0].lineno - 1, '    cmd = farm_scene_command(cmd)\n')
    source = ''.join(lines)
    for anchor, replacement in [
        ("MAPS = {'bare':", "farm_fine7_start()\nMAPS = {'bare':"),
        ("boot = os.path.join(HERE, 'gpujob', 'boot.py')", "farm_fine7_wait()\nboot = os.path.join(HERE, 'gpujob', 'boot.py')"),
    ]:
        if source.count(anchor) != 1:
            raise ValueError('Person stage boundary changed')
        source = source.replace(anchor, replacement, 1)
    tiles = (Path(__file__).with_name('scene_tiles.py')).read_text()
    result = 'FARM_SCENE_TILE_SOURCE = ' + repr(tiles) + '\n' + HELPER + source
    dispatch = next(node for node in ast.parse(result).body if isinstance(node, ast.FunctionDef) and node.name == 'run')
    if [arg.arg for arg in dispatch.args.args] == ['cmd', 'cwd', 'fatal', 'tag', 'env']:
        from person_anatomy import adapt as adapt_anatomy
        from person_fine_context import adapt as adapt_context
        from person_pelvis import adapt as adapt_pelvis
        result = adapt_pelvis(adapt_context(adapt_anatomy(result)))
    result = adapt_scene_batch(result)
    compile(result, 'person_pipeline.farm.py', 'exec')
    return result


def full_dispatch(source):
    tree = ast.parse(source)
    dispatch = next((node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'run'), None)
    return dispatch is not None and [arg.arg for arg in dispatch.args.args] == ['cmd', 'cwd', 'fatal', 'tag', 'env']


def scene_batch_eligible(source):
    return (eligible(source) and full_dispatch(source)
        and source.count("boot = os.path.join(HERE, 'gpujob', 'boot.py')") == 1
        and source.count("if not DRY:\n    os.makedirs(OUT, exist_ok=True); json.dump(log,") == 1
        and "os.path.join(HERE, 'render_person.py')" in source)


def adapt_scene_batch(source):
    if not scene_batch_eligible(source):
        return source
    from batch_adapter import adapt
    return adapt(source)


def is_current(source):
    if "FARM_PERSON_PIPELINE = '" + VERSION + "'" not in source:
        return False
    if not scene_batch_eligible(source):
        return True
    from batch_adapter import VERSION as batch_version
    return "FARM_BATCH_VERSION = '" + batch_version + "'" in source


def remove_previous(source):
    if "FARM_PERSON_PIPELINE = '" not in source:
        return source
    tree = ast.parse(source)
    version = next((node for node in tree.body if isinstance(node, ast.Assign)
        and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name)
        and node.targets[0].id == 'FARM_PERSON_PIPELINE'), None)
    allowed = {'person-detail-overlap-and-shared-tiles-v1',
        'person-detail-overlap-and-shared-tiles-v2', 'person-detail-overlap-and-shared-tiles-v3'}
    if version is None or not isinstance(version.value, ast.Constant) or version.value.value not in allowed:
        raise ValueError('Unknown person pipeline adapter version')
    end = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'farm_fine7_wait')
    names = {'FARM_SCENE_TILE_SOURCE', 'FARM_PERSON_PIPELINE', 'farm_fine7_pool', 'farm_fine7_tasks',
        'farm_fine7_workspace', 'farm_fine7_publish', 'farm_scene_command', 'farm_fine7_start', 'farm_fine7_wait',
        'farm_fine7_hash', 'farm_fine7_sync', 'farm_fine7_record', 'farm_fine7_ready',
        'FARM_FINE_CONTEXT_VERSION', 'FARM_FINE_CONTEXT_FILES', 'farm_fine_context_lock',
        'farm_fine_context_materialize', 'farm_fine_context_env', 'farm_fine_context_private',
        'farm_fine_context_one', 'farm_fine_context_patch_source',
        'FARM_ANATOMY_VERSION', 'FARM_ANATOMY_SOURCE', 'farm_anatomy_lock',
        'farm_anatomy_command', 'farm_anatomy_log_env'}
    keep = {'FARM_PREFETCH', 'farm_prefetch_restore'}
    imported = {'import threading as farm_fine_context_threading',
                'import threading as farm_anatomy_threading'}
    lines = source.splitlines(keepends=True)
    removed = set()
    for node in tree.body:
        if node.lineno > end.end_lineno:
            break
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
        elif isinstance(node, ast.FunctionDef):
            name = node.name
        elif isinstance(node, ast.Import) and ast.unparse(node) in imported:
            name = ast.unparse(node)
        else:
            raise ValueError('Person pipeline helper prefix changed')
        if name in keep:
            continue
        if name not in names and name not in imported:
            raise ValueError('Person pipeline helper prefix contains unknown code: ' + name)
        removed.add(name)
        lines[node.lineno - 1:node.end_lineno] = ['' for _ in range(node.end_lineno - node.lineno + 1)]
    base = ''.join(lines)
    tree = ast.parse(base)
    dispatch = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'run')
    headers = {'cmd = farm_scene_command(cmd)'}
    if 'farm_fine_context_env' in removed:
        headers.add('env = farm_fine_context_env(cmd, env)')
    if 'farm_anatomy_command' in removed:
        headers.add('cmd, env = farm_anatomy_command(cmd, env)')
    counts = {text: sum(ast.unparse(node) == text for node in dispatch.body) for text in headers}
    if any(value != 1 for value in counts.values()):
        raise ValueError('Person pipeline dispatcher changed')
    dispatch.body = [node for node in dispatch.body if ast.unparse(node) not in headers]
    for node in ast.walk(dispatch):
        if isinstance(node, ast.Call) and ast.unparse(node.func) == 'json.dumps':
            for index, argument in enumerate(node.args):
                if isinstance(argument, ast.Call) and isinstance(argument.func, ast.Name) and argument.func.id == 'farm_anatomy_log_env':
                    if len(argument.args) != 1 or argument.keywords:
                        raise ValueError('Person environment diagnostic changed')
                    node.args[index] = argument.args[0]
    if any(isinstance(node, ast.Name) and node.id == 'farm_anatomy_log_env' for node in ast.walk(dispatch)):
        raise ValueError('Unexpected person environment diagnostic use')
    lines = base.splitlines(keepends=True)
    lines[dispatch.lineno - 1:dispatch.end_lineno] = [ast.unparse(ast.fix_missing_locations(dispatch)) + '\n']
    base = ''.join(lines)
    for before, after in [
        ("farm_fine7_start()\nMAPS = {'bare':", "MAPS = {'bare':"),
        ("farm_fine7_wait()\nboot = os.path.join(HERE, 'gpujob', 'boot.py')", "boot = os.path.join(HERE, 'gpujob', 'boot.py')"),
    ]:
        if base.count(before) != 1:
            raise ValueError('Person pipeline invocation changed')
        base = base.replace(before, after, 1)
    compile(base, 'person_pipeline.previous.py', 'exec')
    return base

def metadata(source, adapter_hashes=None):
    result = dict(version=VERSION,
        scene_cache='pristine scene clones; independent mutable IDs' if 'FARM_BATCH_VERSION = ' in source else 'original shot subprocesses',
        pelvis='coalesced exact inputs; durable checked cache' if 'FARM_PELVIS_VERSION = ' in source else 'original recipe',
        detail_bake='CPU overlap with GPU atlas bakes; join before scene build',
        source_writes='private detail caches; publish after GPU bakes',
        fabric_images='shared immutable mosaics; independent material mappings',
        anatomy='coalesced independent sides' if 'FARM_ANATOMY_VERSION = ' in source else 'original recipe',
        detail_context='qualified export inputs; original rebuild fallback' if 'FARM_FINE_CONTEXT' in source else 'original person rebuild')
    if adapter_hashes is not None:
        result['adapter_hashes'] = adapter_hashes
    for node in ast.parse(source).body:
        if (isinstance(node, ast.Assign) and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name) and node.targets[0].id == 'FARM_BATCH_VERSION'):
            result['scene_cache_version'] = ast.literal_eval(node.value)
            break
    return result

RUNTIME_MODULES = ('person_pipeline.py', 'scene_tiles.py', 'person_cpu_policy.py',
    'person_anatomy.py', 'soft_parallel.mjs', 'person_fine_context.py',
    'farm_fine_context.mjs', 'capture_fine_context.mjs', 'person_pelvis.py',
    'pelvis_coalesce.mjs', 'person_prefetch.py', 'batch_adapter.py', 'batch_runner.py',
    'scene_cache.py', 'common_person.py', 'person_child_failures.py')

def refresh_harness(job, home):
    from script_guard_upgrade import replace_file
    for name in RUNTIME_MODULES:
        original = Path(home) / name
        if original.is_file():
            replace_file(Path(job) / 'harness' / name, original.read_bytes())
