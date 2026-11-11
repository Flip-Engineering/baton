"""Adapt independent CPU preparation stages while preserving render commands."""
import ast
import hashlib
import pathlib


QUALIFIED_SOURCE_SHA256 = {
    'ca2f5c5c61b7c6829554e476ff2acd42239953544241bf00b20f960435976f3e',
    'bac02e41a7e7ed08aca5c8d91a3ad1aec3fd06c6676eb4efe482b1b4417eb7d0',
}
QUALIFIED_DRIVERS = {
    'eye7_job.py': '74ed0897c50ecb1927a12ca971fbcbdc41af5e1da334a194379fd2fc4c51cf76',
    'anat8p_person_job.py': 'c36376761ea003241115e5a4dfe2df97ed52b186fd287a7c090cfecab18d4097',
    'person7_job.py': 'c30d79dcebf274d2bd035bacc9d3e954e6058fcbe3eb30426c0567f5f03320db',
    'allpower_people_job.py': '6136b9cc3fa6bf8a160cfdb5e20c1fcc8b7d2edaa7e87d43d5042294b3a3077f',
    'byauthority_crew_job.py': '33d4281c9e976c4f2c36bf4ed6557bfc691b12c9c5900dde1f98df7d7332ac8c',
}
QUALIFIED_DRIVER_VARIANTS = {
    'person7_job.py': {'e7888d1355d84eae6cb62815d732da2d1f55d88481243b9e793c3a044f0ea4c9'},
}


def source_fingerprint(source):
    return hashlib.sha256(source.encode()).hexdigest()


HELPER = '''
import builtins as farm_builtins
import threading as farm_threading
farm_print_lock = farm_threading.Lock()
def print(*args, **kwargs):
    with farm_print_lock:
        return farm_builtins.print(*args, **kwargs)

def farm_cpu_map(function, items):
    from concurrent.futures import ThreadPoolExecutor
    items = list(items)
    workers = min(len(items), int(os.environ.get('ACP_CPU_STAGE_WORKERS', '1')))
    if workers < 1:
        raise ValueError('ACP_CPU_STAGE_WORKERS must be positive')
    with ThreadPoolExecutor(max_workers=workers) as pool:
        # Consume every result. A failed preparation prevents the GPU stages.
        list(pool.map(function, items))

'''


LEASE_HELPER = '''
def farm_resource_run(command, **kwargs):
    import socket
    script = command[1] if len(command) > 1 else ''
    cpu = script in ('web/labs/human8/export_person.mjs', 'web/labs/eyes/eye7_maps.mjs')
    cpu = cpu or os.path.basename(script) == 'bake_post.py'
    cpu = cpu or ('-P' in command and os.path.basename(command[command.index('-P') + 1]) == 'unwrap.py')
    cpu = cpu or (os.environ.get('BAKE_GL', '').lower() == 'swiftshader' and
                  script in ('web/labs/human8/bake_skin.mjs', 'web/labs/clothing2/fabric7_texbake.mjs'))
    if cpu:
        return subprocess.run(command, **kwargs)
    address = os.environ.get('ACP_GPU_STAGE_SOCKET')
    if not address:
        raise RuntimeError('GPU stage coordinator is required for this prepared recipe')
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.connect(address)
        with connection.makefile('rwb') as stream:
            stream.write((json.dumps(dict(action='acquire', command=shlex.join(command))) + '\\n').encode())
            stream.flush()
            response = json.loads(stream.readline())
            if response.get('granted') is not True:
                raise RuntimeError('GPU stage refused: ' + str(response))
            try:
                result = subprocess.run(command, **kwargs)
            except OSError:
                stream.write(b'{"action":"release","exit_code":-1}\\n')
                stream.flush()
                json.loads(stream.readline())
                raise
            stream.write((json.dumps(dict(action='release', exit_code=result.returncode)) + '\\n').encode())
            stream.flush()
            if json.loads(stream.readline()).get('released') is not True:
                raise RuntimeError('GPU stage release was not confirmed')
            return result

'''


def apply(source, lease_stages=False, pipeline=False):
    tree = ast.parse(source)
    loops = [n for n in tree.body if isinstance(n, ast.For)
             and ast.unparse(n.target) == 'w' and ast.unparse(n.iter) == 'wears']
    posts = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'posts']
    if len(loops) != 1 or len(posts) != 1:
        raise ValueError('CPU stage layout changed; qualification required')
    loop = loops[0]
    if 'unwrap(ex[w])' not in ast.get_source_segment(source, loop):
        raise ValueError('CPU preparation body changed; qualification required')
    post = posts[0]
    if len(post.body) != 1 or not isinstance(post.body[0], ast.For):
        raise ValueError('CPU postprocessing layout changed; qualification required')
    post_loop = post.body[0]
    if ast.unparse(post_loop.target) != 'w' or ast.unparse(post_loop.iter) != 'wears':
        raise ValueError('CPU postprocessing inputs changed; qualification required')
    if ast.unparse(post_loop.body[0]).find("bake_post.py") < 0:
        raise ValueError('CPU postprocessing command changed; qualification required')
    prepare = ast.FunctionDef(name='farm_prepare_wear', args=ast.arguments(
        posonlyargs=[], args=[ast.arg(arg='w')], kwonlyargs=[], kw_defaults=[], defaults=[]),
        body=loop.body, decorator_list=[])
    process = ast.FunctionDef(name='farm_post_wear', args=prepare.args,
                             body=post_loop.body, decorator_list=[])
    replacement = ast.unparse(ast.fix_missing_locations(prepare)) + '\nfarm_cpu_map(farm_prepare_wear, wears)\n'
    new_post = ast.unparse(ast.fix_missing_locations(process)) + '\ndef posts():\n    farm_cpu_map(farm_post_wear, wears)\n'
    lines = source.splitlines(keepends=True)
    replacements = [(loop.lineno, loop.end_lineno, replacement),
                    (post.lineno, post.end_lineno, new_post)]
    if lease_stages:
        run = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'run')
        calls = [n for n in ast.walk(run) if isinstance(n, ast.Call)
                 and ast.unparse(n.func) == 'subprocess.run']
        if len(calls) != 1:
            raise ValueError('GPU command dispatcher changed; qualification required')
        calls[0].func = ast.Name(id='farm_resource_run', ctx=ast.Load())
        replacements.append((run.lineno, run.end_lineno, ast.unparse(ast.fix_missing_locations(run)) + '\n'))
    for start, end, value in sorted(replacements, reverse=True):
        lines[start-1:end] = [value]
    result = HELPER + (LEASE_HELPER if lease_stages else '') + ''.join(lines)
    if pipeline:
        from person_pipeline import adapt
        result = adapt(result)
    compile(result, 'person_job.farm.py', 'exec')
    return result


def install(repo, argv, workers, lease_stages=False):
    """Return execution arguments and retain both original and generated sources."""
    if not isinstance(workers, int) or workers < 1:
        raise ValueError('gpu_cpu_stage_workers must be a positive integer')
    result = list(argv)
    supported = {'videos/blender/'+name for name in ['person_job.py', *QUALIFIED_DRIVERS]}
    if workers == 1 or argv[3] not in supported:
        return result, dict(cpu_stage_workers=1, status='original_recipe')
    folder = pathlib.Path(repo) / 'videos/blender'
    source = (folder/'person_job.py').read_text()
    fingerprint = source_fingerprint(source)
    if fingerprint not in QUALIFIED_SOURCE_SHA256:
        return result, dict(cpu_stage_workers=1,status='qualification_required',source_sha256=fingerprint)
    # Qualified batch drivers launch person_job sequentially. Other batch drivers
    # retain their whole-job GPU reservation for their additional render commands.
    use_leases = lease_stages and pathlib.PurePosixPath(argv[3]).name in ('person_job.py', 'person7_job.py')
    try:
        adapted = apply(source, lease_stages=use_leases, pipeline=True)
    except ValueError as error:
        return result, dict(cpu_stage_workers=1,status='qualification_required',reason=str(error))
    entry = pathlib.PurePosixPath(argv[3])
    if entry.name != 'person_job.py':
        driver = (folder/entry.name).read_text()
        qualified = {QUALIFIED_DRIVERS[entry.name], *QUALIFIED_DRIVER_VARIANTS.get(entry.name, ())}
        if source_fingerprint(driver) not in qualified or driver.count("'person_job.py'") != 1:
            return result, dict(cpu_stage_workers=1,status='qualification_required',reason='Person batch entry changed')
        (folder/(entry.stem+'.farm.py')).write_text(driver.replace("'person_job.py'", "'person_job.farm.py'"))
    (folder/'person_job.farm.py').write_text(adapted)
    result[3] = str(entry.with_name(entry.stem+'.farm.py'))
    return result, dict(cpu_stage_workers=workers, status='parallel_cpu_wears',
                        gpu_stages='original_sequence', quality_parameters='original_arguments',
                        source_sha256=fingerprint,
                        gpu_stage_leases='person_commands_v1' if use_leases else 'whole_job',
                        person_pipeline=__import__('person_pipeline').metadata(adapted) if 'FARM_PERSON_PIPELINE = ' in adapted else None)


FARM_COMMON_PERSON_VERSION = 'common-person-anatomy-v1'
farm_existing_person_install = install
def install(repo, argv, workers, lease_stages=False):
    from common_person import install_fallback
    result, policy = farm_existing_person_install(repo, argv, workers, lease_stages=lease_stages)
    return install_fallback(repo, result, policy)
