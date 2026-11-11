#!/usr/bin/env python3
"""SSH-operated, revision-pinned render queue. GPU scheduling stays outside the repo."""
import argparse, concurrent.futures, datetime, fcntl, hashlib, json, math, os
import pathlib, re, signal, subprocess, sys, threading, time, uuid, shutil

# CLI execution and imported helpers must share the same stop signal and config.
if __name__ == '__main__':
    sys.modules['farm']=sys.modules[__name__]

HOME = pathlib.Path(__file__).resolve().parent
CONFIG = json.loads((HOME / 'config.json').read_text())
BASE = pathlib.Path(CONFIG['storage'])
JOBS = BASE / 'jobs'
ENV = dict(os.environ, DOCKER_HOST='unix:///var/run/docker.sock', GIT_LFS_SKIP_SMUDGE='1')
STOP = threading.Event()
RENDERER_HELPERS = ('gpu-sync.js', 'three-renderer-wrapper.mjs', 'capture-bridge.js')

class JobInputError(RuntimeError):
    """A source/asset failure confirmed after workers exited and GPU checks passed."""

class RenderContextError(RuntimeError):
    """A rejected browser context after workers exited and GPU checks passed."""

def stage_renderer_helpers(job, source_root=None):
    """Copy pinned renderer helpers into a scene job before preparation."""
    source_root = pathlib.Path(source_root or HOME)
    sources = {name: source_root / name for name in RENDERER_HELPERS}
    missing = [str(path) for path in sources.values() if not path.is_file()]
    if missing:
        raise JobInputError('Missing renderer helper assets: ' + ', '.join(missing))
    harness = job / 'harness'
    output = job / 'out'
    harness.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    for name, source in sources.items():
        shutil.copy2(source, harness / name)
        shutil.copy2(source, output / name)

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def write(path, data):
    if path.name=='status.json' and isinstance(data,dict) and data.get('state')=='running':
        data['execution_boot_id']=boot_id()
    tmp = path.with_suffix('.tmp')
    with tmp.open('w') as stream:
        stream.write(json.dumps(data, indent=2) + '\n')
        stream.flush()
        os.fsync(stream.fileno())
    tmp.replace(path)
    sync_directory(path.parent)
    sync_directory(path.parent.parent)

def sync_directory(path):
    descriptor=os.open(path,os.O_RDONLY)
    try:os.fsync(descriptor)
    finally:os.close(descriptor)

def boot_id():
    path=pathlib.Path('/proc/sys/kernel/random/boot_id')
    return path.read_text().strip() if path.exists() else 'local-development'

def sync_storage(path):
    """Flush this filesystem before publishing a stage checkpoint."""
    import ctypes
    library=ctypes.CDLL(None,use_errno=True)
    descriptor=os.open(path,os.O_RDONLY)
    try:
        if hasattr(library,'syncfs'):
            if library.syncfs(descriptor):
                error=ctypes.get_errno()
                raise OSError(error,os.strerror(error))
        else:os.fsync(descriptor)
    finally:os.close(descriptor)

def run(cmd, cwd=None, log=None):
    print('+ ' + ' '.join(map(str, cmd)), flush=True)
    if log:
        with open(log, 'a') as f:
            subprocess.run(list(map(str, cmd)), cwd=cwd, env=ENV, stdout=f, stderr=subprocess.STDOUT, check=True)
        return ''
    return subprocess.check_output(list(map(str, cmd)), cwd=cwd, env=ENV, stderr=subprocess.STDOUT, text=True).strip()

def runtime_cache_mounts(job):
    """Provide installed instrument libraries without per-job downloads."""
    mounts=[]
    for name,location in CONFIG.get('runtime_home_caches',{}).items():
        if not re.fullmatch(r'[A-Za-z0-9_-]+',name):
            raise ValueError('Invalid runtime cache name: '+name)
        cache=pathlib.Path(location)
        if not cache.is_absolute() or not cache.is_dir():
            raise ValueError('Configured runtime cache is unavailable: '+str(cache))
        (job/'tmp/.cache').mkdir(parents=True,exist_ok=True)
        mounts += ['--mount',f'type=bind,src={cache},dst=/render-tmp/.cache/{name},readonly']
    return mounts

def docker(job, cmd, gpu=None, picture=False, log=None, memory_bytes=None):
    d = ['docker', 'run', '--rm', '--name', f"acp-{job.name}-{gpu['label'] if gpu else 'cpu'}"]
    if memory_bytes is not None:
        if not isinstance(memory_bytes, int) or memory_bytes <= 0:
            raise ValueError('Container memory limit must be a positive integer byte count')
        # Keep the process within its admitted host budget and disable swap use.
        d += ['--memory', str(memory_bytes), '--memory-swap', str(memory_bytes)]
    if gpu:
        d += ['--runtime=nvidia', '--gpus', 'device=' + gpu['uuid'],
              '-e', 'NVIDIA_VISIBLE_DEVICES=' + gpu['uuid'], '-e', 'NVIDIA_DRIVER_CAPABILITIES=all',
              '-e', 'ACP_GPU_LABEL=' + gpu['label'], '-e', 'ACP_EXPECTED_GPU_UUID=' + gpu['uuid'], '--shm-size=1g']
    d += ['--user', f'{os.getuid()}:{os.getgid()}', '-e', 'HOME=/render-tmp',
          '-e', 'ACP_NO_INBOX=1', '-e', 'ACP_PICTURE_ONLY=' + str(int(picture)),
          '-e', 'TMPDIR=/render-tmp', '-e', 'ACP_DAW_CACHE=/work/videos/out/.daw-cache',
          '--mount', f'type=bind,src={job / "repo"},dst=/work',
          '--mount', f'type=bind,src={job / "out"},dst=/work/videos/out',
          '--mount', f'type=bind,src={job / "tmp"},dst=/render-tmp',
          '--mount', f'type=bind,src={BASE / "plugins"},dst=/usr/lib/vst3,readonly',
          ]
    if (BASE/'npm-cache').exists():
        d += ['--mount', f'type=bind,src={BASE / "npm-cache"},dst=/render-cache/npm']
    d += runtime_cache_mounts(job)
    from job_dependencies import runtime_image
    d += ['-w', '/work/videos', runtime_image(job, CONFIG['image'])] + cmd
    return run(d, log=log)

SCENE_MODULE_PREFLIGHT = "\nconst fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');\nconst { fileURLToPath } = require('node:url');\nconst root = fs.realpathSync(process.cwd()), seen = new Set(), errors = [];\nconst queue = JSON.parse(process.argv[1]).map((entry, index) => ({file: path.resolve(root, typeof entry === 'string' ? entry : entry.file), source: typeof entry === 'string' ? undefined : entry.source, inline: index, importer: 'scene HTML'}));\nwhile (queue.length) {\n  const {file, importer, source, inline} = queue.pop();\n  const key = source === undefined ? file : file + ':inline:' + inline;\n  if (seen.has(key)) continue;\n  seen.add(key);\n  const rel = path.relative(root, file);\n  if (rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {\n    errors.push({path: file, importer, error: 'Module escapes the source root'}); continue;\n  }\n  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {\n    errors.push({path: rel, importer, error: 'Missing module in pinned checkout'}); continue;\n  }\n  if (source === undefined && !/\\.(?:[cm]?js)$/.test(file)) continue;\n  let module;\n  try { module = new vm.SourceTextModule(source === undefined ? fs.readFileSync(file, 'utf8') : source, {identifier: key}); }\n  catch (error) { errors.push({path: rel, importer, error: String(error)}); continue; }\n  for (const name of module.dependencySpecifiers) {\n    if (!(name.startsWith('.') || name.startsWith('/'))) continue;\n    const url = name.startsWith('/')\n      ? new URL('.' + name, 'file://' + root + '/')\n      : new URL(name, 'file://' + file);\n    queue.push({file: fileURLToPath(url), importer: rel});\n  }\n}\nconsole.log(JSON.stringify({checked: seen.size, errors}, null, 2));\nif (errors.length) process.exitCode = 1;\n"

def scene_preflight(job, scene):
    from html.parser import HTMLParser
    from urllib.parse import urlsplit, unquote
    class Scripts(HTMLParser):
        def __init__(self):
            super().__init__(); self.sources = []; self.inline_sources = []; self.active = None
        def handle_starttag(self, tag, attrs):
            values = dict(attrs)
            if tag == 'script' and values.get('type') == 'module':
                if values.get('src'): self.sources.append(values['src'])
                else: self.active = []
        def handle_data(self, data):
            if self.active is not None: self.active.append(data)
        def handle_endtag(self, tag):
            if tag == 'script' and self.active is not None:
                self.inline_sources.append(''.join(self.active)); self.active = None
    html = job/'repo/videos/web/scenes'/f'{scene}.html'
    parser = Scripts(); parser.feed(html.read_text())
    root = (job/'repo/videos').resolve()
    sources = []
    commit = json.loads((job/'request.json').read_text())['commit']
    for name in parser.sources:
        url = urlsplit(name)
        if url.scheme or url.netloc: continue
        source = ((root/unquote(url.path).lstrip('/')) if url.path.startswith('/')
                  else (html.parent/unquote(url.path))).resolve()
        if not source.is_relative_to(root) or not source.is_file():
            raise JobInputError('Missing scene module '+name+' at commit '+commit)
        sources.append(str(source.relative_to(root)))
    sources.extend({'file':str(html.relative_to(root)), 'source':source} for source in parser.inline_sources)
    try:
        docker(job, ['node', '--experimental-vm-modules', '-e', SCENE_MODULE_PREFLIGHT,
                     json.dumps(sources)], log=job/'logs/scene-syntax.log')
    except subprocess.CalledProcessError as error:
        raise JobInputError('Scene module dependency or syntax error at commit '+commit+':\n'+
                            (job/'logs/scene-syntax.log').read_text()) from error

def prepare_reused_scene_audio(job, request, scene, target_repo):
    """Copy pinned audio from the explicitly named original retry input."""
    spec=request.get('protocol_spec') or {}
    source_id=spec.get('reuse_audio_from')
    if source_id is None:
        return None
    if (not isinstance(source_id,str) or not re.fullmatch(r'[A-Za-z0-9_-]+',source_id) or
            spec.get('retry_of')!=source_id or request.get('protocol_id')==source_id):
        raise JobInputError('Saved audio reuse must name the same original retry job')
    source_job=JOBS/('protocol-'+source_id)
    if not source_job.is_dir():
        raise JobInputError('Saved audio source job is not present locally')
    source_request=json.loads((source_job/'request.json').read_text())
    source_status=json.loads((source_job/'status.json').read_text())
    source_prepared=json.loads((source_job/'prepared.json').read_text())
    if (source_request.get('protocol_id')!=source_id or source_request.get('scene')!=scene or
            source_prepared.get('scene')!=scene or source_status.get('state')!='prepared' or
            source_prepared.get('commit')!=source_request.get('commit') or
            source_request.get('protocol_spec',{}).get('pipeline_commit')!=source_request.get('commit')):
        raise JobInputError('Saved audio source is not the matching prepared scene request')
    old_commit=source_request.get('commit')
    new_commit=request.get('commit')
    if (not re.fullmatch(r'[0-9a-f]{40}',str(old_commit)) or not re.fullmatch(r'[0-9a-f]{40}',str(new_commit)) or
            spec.get('pipeline_commit')!=new_commit):
        raise JobInputError('Saved audio reuse needs matching full source commit pins')
    source_request_sha=file_sha256(source_job/'request.json')
    source_prepared_sha=file_sha256(source_job/'prepared.json')
    try:
        run(['git','fetch','--depth','1','origin',old_commit],cwd=target_repo,
            log=job/'logs/audio-reuse-source.log')
        run(['git','diff','--quiet',old_commit,new_commit,'--','videos/web/audio'],cwd=target_repo,
            log=job/'logs/audio-reuse-source.log')
    except subprocess.CalledProcessError as error:
        raise JobInputError('Audio source tree differs across retry commits') from error
    files=[]
    names=[f'.{scene}.wav',f'.{scene}.hits.json',f'.{scene}.sting.wav']
    for index,name in enumerate(names):
        source=source_job/'out'/name
        if not source.is_file():
            if index<2:
                raise JobInputError('Saved audio source is missing '+name)
            continue
        digest=file_sha256(source)
        expected=source_prepared.get('wav_sha256') if index==0 else source_prepared.get('hits_sha256') if index==1 else None
        if index<2 and (not re.fullmatch(r'[0-9a-f]{64}',str(expected)) or digest!=expected):
            raise JobInputError('Saved audio source hash changed: '+name)
        target=job/'out'/name
        shutil.copy2(source,target)
        if file_sha256(target)!=digest:
            raise JobInputError('Saved audio copy hash mismatch: '+name)
        files.append({'path':name,'sha256':digest,'bytes':target.stat().st_size})
    if (file_sha256(source_job/'request.json')!=source_request_sha or
            file_sha256(source_job/'prepared.json')!=source_prepared_sha or
            json.loads((source_job/'status.json').read_text()).get('state')!='prepared'):
        raise JobInputError('Saved audio source job changed during copy')
    receipt={'schema':'acp.scene-audio-reuse/v1','source_protocol_id':source_id,
             'source_request_sha256':source_request_sha,
             'source_prepared_sha256':source_prepared_sha,
             'source_commit':old_commit,'target_commit':new_commit,'scene':scene,
             'audio_tree_unchanged':True,'files':files}
    write(job/'audio-reuse.json',receipt)
    return {'receipt':receipt,'source_prepared':source_prepared}


def preserve_scene_frame_ranges(source_prepared, frames, ranges):
    """Keep exact frame boundaries while taking GPU assignments from current config."""
    if source_prepared.get('frames')!=frames:
        raise JobInputError('Saved audio retry changed the prepared frame count')
    def bounds(items):
        return [(item.get('first'),item.get('end_exclusive')) for item in items]
    old=source_prepared.get('ranges')
    if not isinstance(old,list) or not old or bounds(old)!=bounds(ranges):
        raise JobInputError('Current queue cannot preserve the original frame ranges')
    return ranges


def prepare(job):
    if json.loads((job/'request.json').read_text()).get('kind')=='gpu':
        from gpu_jobs import prepare as gpu_stage
        return gpu_stage(job)
    request = json.loads((job / 'request.json').read_text())
    status = {'state': 'running', 'phase': 'preparing', 'started': now(), 'request': request}
    write(job / 'status.json', status)
    started = time.monotonic()
    try:
        for name in ('out', 'tmp', 'logs'):
            (job / name).mkdir(exist_ok=True)
        (job / 'harness').mkdir(exist_ok=True)
        for name in ('farm.py', 'config.json', 'renderer-adapter.json', 'archive.py', 'protocol_bridge.py', 'scheduler.py', 'admission_policy.py',
                     'render_policy.py', 'job_dependencies.py', 'failure_reporting.py', 'gpu_allocation.py', 'recovery.py', 'bench_parallel.py'):
            if (HOME / name).exists():
                shutil.copy2(HOME / name, job / 'harness' / name)
        stage_renderer_helpers(job)
        source = job / 'repo'
        run(['git', 'clone', '--depth', '1', '--filter=blob:none', '--no-checkout',
             CONFIG['repository'], source], log=job / 'logs' / 'checkout.log')
        cache = BASE / 'object-cache'
        if cache.exists():
            (source / '.git/objects/info/alternates').write_text(str(cache.resolve()) + '\n')
        run(['git', 'sparse-checkout', 'init', '--cone'], cwd=source)
        run(['git', 'sparse-checkout', 'set', *CONFIG['sparse']], cwd=source)
        run(['git', 'fetch', '--depth', '1', 'origin', request['commit']], cwd=source, log=job / 'logs' / 'checkout.log')
        run(['git', 'checkout', '--detach', request['commit']], cwd=source, log=job / 'logs' / 'checkout.log')
        # Immutable Git objects are shared on this disk. The cache has its own links
        # and remains valid even if an old job checkout is later removed.
        def link_object(src, dst):
            if not os.path.exists(dst):
                os.link(src, dst)
            return dst
        for objects in (source / '.git/objects').iterdir():
            if objects.is_dir() and (objects.name == 'pack' or re.fullmatch('[0-9a-f]{2}', objects.name)):
                shutil.copytree(objects, cache / objects.name, dirs_exist_ok=True, copy_function=link_object)
        commit = run(['git', 'rev-parse', 'HEAD'], cwd=source)
        if commit != request['commit']:
            raise RuntimeError('Checkout revision mismatch')
        scene = request['scene']
        if not (source / f'videos/web/scenes/{scene}.html').is_file():
            raise RuntimeError('Scene is absent in the pinned source')
        renderer = source / 'videos/web/render.mjs'
        original = renderer.read_text()
        adapted = original
        for change in json.loads((HOME / 'renderer-adapter.json').read_text()):
            if adapted.count(change['old']) != 1:
                raise RuntimeError('Renderer changed: adapter needs review; refusing an unverified patch')
            adapted = adapted.replace(change['old'], change['new'], 1)
        from render_policy import apply as apply_render_policy
        bench = source/'videos/web/lib/bench_scene.js'
        adapted = apply_render_policy(adapted, bench.read_text() if bench.exists() else None)
        (source / 'videos/web/render.farm.mjs').write_text(adapted)
        audio_file=source/'videos/web/audio/make_audio.py'
        audio_original=audio_file.read_text()
        audio_anchor='except Exception as e:  # noqa: BLE001\n            print(f"  logo vs payoff: check skipped ({e})")'
        audio_adapted=audio_original
        if audio_original.count(audio_anchor)==1:
            audio_adapted=audio_original.replace(audio_anchor,
                'except (Exception, SystemExit) as e:  # optional diagnostic must not invalidate a completed synth\n'
                '            print(f"  logo vs payoff: check skipped ({e})")',1)
        (source/'videos/web/audio/make_audio.farm.py').write_text(audio_adapted)
        import difflib
        (job/'harness/audio-report-adapter.patch').write_text(''.join(difflib.unified_diff(
            audio_original.splitlines(keepends=True),audio_adapted.splitlines(keepends=True),
            fromfile='videos/web/audio/make_audio.py',tofile='videos/web/audio/make_audio.py')))
        from job_dependencies import install_image, install_npm_and_record
        install_image(job)
        docker(job, ['node', '--check', 'web/render.farm.mjs'], log=job / 'logs/adapter.log')
        (BASE/'npm-cache').mkdir(exist_ok=True)
        docker(job, ['npm', 'ci', '--prefix', 'web', '--cache', '/render-cache/npm'], log=job / 'logs/npm.log')
        dependencies = install_npm_and_record(job)
        scene_preflight(job, scene)
        audio_reuse=prepare_reused_scene_audio(job,request,scene,source)
        if audio_reuse is None:
            docker(job, ['python3', 'web/audio/make_audio.farm.py', scene, '--quiet'], log=job / 'logs/audio.log')
        bounds = json.loads(docker(job, ['python3', '-c',
            'import sys,json;sys.path.insert(0,"scripts");from piece_bounds import piece_end;from engine import codec;'
            f'b=piece_end({scene!r});sr,x=codec.read_audio("out/.{scene}.wav");'
            'b["song_pcm_seconds"]=len(x)/sr;print(json.dumps(b))']))
        if request.get('closer_beat') is not None:
            hits=json.loads((job/'out'/f'.{scene}.hits.json').read_text())
            bpm=request.get('bpm') or hits.get('bpm')
            if not bpm or bpm<=0:
                raise RuntimeError('Queue recipe needs a valid BPM in its spec or beat map')
            bounds.update(closer_beat=request['closer_beat'],closer_t=request['closer_beat']*60/bpm,
                          source='Pipeline queue local_render recipe')
            if bounds['closer_t']>bounds['song_pcm_seconds']:
                raise RuntimeError('Queue closer falls after the song ends; verify the closer beat and BPM')
        finish_span = None
        if request.get('seconds') is None:
            finish_span = json.loads(docker(job, ['python3', '-c',
                'import json;from engine import finish,codec;'
                f'sr,x=codec.read_audio("out/.{scene}.wav");'
                f't,fade,why=finish.span(codec.to48(x,sr),finish.SR,{bounds["closer_t"]!r},finish.load_sheet({scene!r}));'
                'print(json.dumps({"end":t,"fade_s":fade,"source":why}))']))
            bounds['picture_bounds_end'] = bounds['end']
            bounds['end'] = finish_span['end']
        duration = request.get('seconds') or bounds['end']
        frames = picture_frames(duration, bounds['song_pcm_seconds'])
        if frames < len(CONFIG['gpus']):
            raise RuntimeError('Span has fewer frames than workers')
        duration = frames / 30
        ranges = worker_ranges(frames, scene)
        if audio_reuse is not None:
            ranges=preserve_scene_frame_ranges(audio_reuse['source_prepared'],frames,ranges)
        prime_passes = CONFIG.get('scene_prime_passes', {}).get(scene, 0)
        if not isinstance(prime_passes,int) or prime_passes<0:
            raise ValueError('Scene prime passes must be a nonnegative integer')
        context = dict(request=request, bounds=bounds, finish_span=finish_span, duration=duration,
                       frames=frames, ranges=ranges, commit=commit, scene=scene,
                       dependencies=dependencies,
                       dependencies_manifest_sha256=file_sha256(job/'dependencies.json'),
                       prime_passes=prime_passes,
                       stabilize_three=CONFIG.get('scene_stabilize_three',{}).get(scene,False),
                       capture_helpers={name:file_sha256(job/'out'/name) for name in
                                        ('gpu-sync.js','three-renderer-wrapper.mjs','capture-bridge.js')},
                       prepare_seconds=round(time.monotonic()-started,3),
                       renderer_original_sha256=hashlib.sha256(original.encode()).hexdigest(),
                       renderer_adapted_sha256=hashlib.sha256(adapted.encode()).hexdigest(),
                       audio_original_sha256=hashlib.sha256(audio_original.encode()).hexdigest(),
                       audio_adapter_sha256=hashlib.sha256(audio_adapted.encode()).hexdigest(),
                       wav_sha256=file_sha256(job/'out'/f'.{scene}.wav'),
                       hits_sha256=file_sha256(job/'out'/f'.{scene}.hits.json'))
        from bench_parallel import apply_context
        context = apply_context(job, context)
        sync_storage(job)
        write(job/'prepared.json', context)
        status.update(state='prepared', phase='ready', prepared=now())
        write(job/'status.json',status)
    except Exception as e:
        status.update(state='failed', error=str(e), finished=now(),
                      failure_kind='job_input' if isinstance(e, JobInputError) else 'render_context' if isinstance(e, RenderContextError) else 'unclassified')
        write(job / 'status.json', status)
        raise

def picture(job, gpus=None):
    if not (job/'prepared.json').exists():
        prepare(job)
    context=read_admitted_context(job)
    if context['request'].get('kind')=='gpu':
        from gpu_jobs import picture as gpu_stage
        return gpu_stage(job, gpus=gpus)
    request=context['request']; bounds=context['bounds']; finish_span=context['finish_span']
    duration=context['duration']; frames=context['frames']; ranges=context['ranges']
    commit=context['commit']; scene=context['scene']
    status=json.loads((job/'status.json').read_text())
    started=time.monotonic()
    try:
        # Persisted prepared jobs survive a graceful reload, but must still match
        # their pinned source before a GPU is allocated.
        if run(['git','rev-parse','HEAD'],cwd=job/'repo')!=commit:
            raise JobInputError('Prepared checkout revision changed')
        for path,key in ((job/'repo/videos/web/render.farm.mjs','renderer_adapted_sha256'),
                         (job/'out'/f'.{scene}.wav','wav_sha256'),
                         (job/'out'/f'.{scene}.hits.json','hits_sha256')):
            if file_sha256(path)!=context[key]:
                raise JobInputError('Prepared input changed: '+path.name)
        if context.get('dependencies_manifest_sha256') and file_sha256(job/'dependencies.json') != context['dependencies_manifest_sha256']:
            raise JobInputError('Dependency manifest changed after preparation')
        for name,expected in context.get('capture_helpers',{}).items():
            if file_sha256(job/'out'/name)!=expected:
                raise JobInputError('Prepared capture helper changed: '+name)
        from bench_parallel import validate_inputs
        try:
            validate_inputs(job, context)
        except ValueError as error:
            raise JobInputError(str(error)) from error
        scene_preflight(job, scene)
        from range_retry import pending_ranges
        pending, retry_plan = pending_ranges(job, context)
        status.update(state='running', phase='rendering', frames=frames, seconds=duration, ranges=ranges,
                      pending_ranges=[r['gpu']['label'] for r in pending],
                      retry_count=retry_plan['retry_count'] if retry_plan else 0,
                      render_started=now())
        write(job / 'status.json', status)
        before = run(['date', '--iso-8601=seconds'])
        picture_started=time.monotonic()
        done = threading.Event()
        def telemetry():
            with open(job / 'logs/telemetry.csv', 'w') as f:
                while not done.is_set():
                    r = subprocess.run(['timeout',str(CONFIG['gpu_health_timeout_seconds']),'nvidia-smi', '-i', ','.join(g['uuid'] for g in CONFIG['gpus']),
                        '--query-gpu=timestamp,uuid,temperature.gpu,power.draw,utilization.gpu,memory.used',
                        '--format=csv,noheader'], capture_output=True, text=True)
                    f.write(r.stdout); f.flush()
                    done.wait(CONFIG['telemetry_seconds'])
        monitor = threading.Thread(target=telemetry)
        monitor.start()
        def worker(r):
            gpu = r['gpu']
            worker_context = dict(context, ranges=[r]) if retry_plan else context
            worker_memory = scene_worker_memory_bytes(worker_context)
            if worker_memory is not None and worker_memory <= 0:
                raise ValueError('Host memory budget is smaller than the number of scene workers')
            return docker(job, ['node', 'web/render.farm.mjs', scene, '--reuse-audio', '--no-slot',
                '--protect-tracked', '--from', str(r['first'] / 30), '--to', str(r['end_exclusive'] / 30),
                '--preroll', str(r.get('preroll',r['first'])),
                '--prime-passes', str(context.get('prime_passes',0)),
                '--stabilize-three', str(int(context.get('stabilize_three',False))),
                '--file', f'out/{gpu["label"]}.mp4'], gpu=gpu, picture=True,
                log=job / 'logs' / (gpu['label'] + '.log'), memory_bytes=worker_memory)
        try:
            worker_errors = []
            if pending:
                with concurrent.futures.ThreadPoolExecutor(max_workers=1 if retry_plan else len(pending)) as pool:
                    results = [pool.submit(worker, r) for r in pending]
                    for r, result in zip(pending, results):
                        try:
                            result.result()
                        except Exception as error:
                            worker_errors.append((r['gpu'], error))
        finally:
            done.set(); monitor.join()
        check_render_outcome(job, before, worker_errors)
        picture_seconds=time.monotonic()-picture_started
        context['picture_seconds']=round(picture_seconds,3)
        context['picture_finished']=now()
        sync_storage(job)
        write(job/'pictured.json',context)
        status.update(state='pictured',phase='ready_to_finish',picture_finished=context['picture_finished'])
        write(job/'status.json',status)
    except Exception as e:
        status.update(state='failed', error=str(e), finished=now(),
                      failure_kind='job_input' if isinstance(e, JobInputError) else 'render_context' if isinstance(e, RenderContextError) else 'unclassified')
        write(job / 'status.json', status)
        raise

def finish(job):
    context=json.loads((job/'pictured.json').read_text())
    if context['request'].get('kind')=='gpu':
        from gpu_jobs import finish as gpu_stage
        return gpu_stage(job)
    request=context['request'];bounds=context['bounds'];finish_span=context['finish_span']
    duration=context['duration'];frames=context['frames'];ranges=context['ranges']
    commit=context['commit'];scene=context['scene'];picture_seconds=context['picture_seconds']
    status=json.loads((job/'status.json').read_text());started=time.monotonic()
    try:
        if context_loss_logs(job):
            check_render_outcome(job,status['render_started'],[])
        status['state']='running'
        status['phase'] = 'joining'; write(job / 'status.json', status)
        out = job / 'out'
        probes = []
        for r in ranges:
            p = json.loads(run(['ffprobe', '-v', 'error', '-count_frames', '-show_streams', '-of', 'json',
                               out / (r['gpu']['label'] + '.mp4')]))
            v = next(s for s in p['streams'] if s['codec_type'] == 'video')
            if int(v['nb_read_frames']) != r['end_exclusive'] - r['first']:
                raise RuntimeError('Worker frame count mismatch')
            probes.append(p)
        (out / 'concat.txt').write_text(''.join(f"file '{r['gpu']['label']}.mp4'\n" for r in ranges))
        run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', out / 'concat.txt',
             '-c', 'copy', out / 'picture.mp4'], log=job / 'logs/join.log')
        if finish_span:
            master_cmd = ['python3', '-m', 'engine.finish', 'render', '--scene', scene,
                '--wav', f'out/.{scene}.wav', '--to', str(duration), '-o', 'out/master.m4a',
                '--report', f'out/{scene}.finish.json']
            if bounds['closer_t'] is not None:
                master_cmd += ['--lock', str(bounds['closer_t'])]
            audio_target = -1.0
        else:
            master_cmd = ['python3', '-m', 'engine.codec', f'out/.{scene}.wav', '--to', str(duration), '-o', 'out/master.m4a']
            audio_target = -1.2
        docker(job, master_cmd, log=job / 'logs/master.log')
        final = out / (scene + '.mp4')
        run(['ffmpeg', '-y', '-v', 'error', '-i', out / 'picture.mp4', '-i', out / 'master.m4a',
             '-map', '0:v', '-map', '1:a', '-c', 'copy', '-movflags', '+faststart', final], log=job / 'logs/join.log')
        probe = json.loads(run(['ffprobe', '-v', 'error', '-count_frames', '-show_streams', '-show_format',
                               '-of', 'json', final]))
        video = next(s for s in probe['streams'] if s['codec_type'] == 'video')
        if int(video['nb_read_frames']) != frames or (video['width'], video['height']) != (1080,1920) or video['avg_frame_rate'] != '30/1':
            raise RuntimeError('Final video geometry or frame count mismatch')
        run(['ffmpeg', '-v', 'error', '-xerror', '-i', final, '-f', 'null', '-'], log=job / 'logs/decode.log')
        audio = json.loads(docker(job, ['python3', '-m', 'engine.codec', '--measure', f'out/{scene}.mp4']))
        if audio['tp_dbtp'] > audio_target:
            raise RuntimeError('Delivered AAC exceeds repo true-peak target')
        # Inspect the actual final file at each boundary using the repo seam tool.
        seam = json.loads(docker(job, ['python3', '-c',
            'import sys,json;sys.path.insert(0,"tools");import segrender;'
            'segrender.ffmpeg=lambda:"/usr/bin/ffmpeg";'
            f'print(json.dumps(segrender.seam_check("out/{scene}.mp4",{[r["first"] for r in ranges[1:]]})))']))
        run(['ffmpeg', '-y', '-v', 'error', '-i', final, '-vf',
             f'fps=1/{max(duration / 12, 1/30)},scale=180:320,tile=6x2', '-frames:v', '1', out / 'contact-sheet.jpg'])
        receipt = {'job':job.name, 'source':CONFIG['repository'], 'commit':commit, 'scene':scene,
                   'bounds':bounds, 'finish_span':finish_span, 'audio_target_dbtp':audio_target,
                   'bench_parallel':context.get('bench_parallel'),
                   'seconds':duration, 'frames':frames, 'ranges':ranges,
                   'image':context.get('dependencies',{}).get('image') or run(['docker','image','inspect','--format','{{.Id}}',CONFIG['image']]),
                   'dependencies':context.get('dependencies',{}),
                   'renderer_original_sha256':context['renderer_original_sha256'],
                   'renderer_adapted_sha256':context['renderer_adapted_sha256'],
                   'renderer_entrypoint':context.get('renderer_entrypoint','web/render.farm.mjs'),
                   'synthesis_reused_from':context.get('synthesis_reused_from'),
                   'capture_helpers':context.get('capture_helpers',{}),
                   'prime_passes':context.get('prime_passes',0),
                   'stabilize_three':context.get('stabilize_three',False),
                   'audio_original_sha256':context['audio_original_sha256'],
                   'audio_adapter_sha256':context['audio_adapter_sha256'],
                   'output_sha256':file_sha256(final),
                   'probe':probe, 'audio':audio, 'seams':seam,
                   'full_decode':'passed', 'elapsed_seconds':round(context['prepare_seconds']+picture_seconds+time.monotonic()-started,2),
                   'timings':{'prepare_seconds':context['prepare_seconds'],'picture_seconds':round(picture_seconds,3),
                              'finish_validation_seconds':round(time.monotonic()-started,3)},
                   'stage_times':{'prepare_started':status['started'],'prepared':status['prepared'],
                                  'render_started':status['render_started'],'picture_finished':context['picture_finished']},
                   'completed':now()}
        sync_storage(job)
        write(job / 'receipt.json', receipt)
        status.update(state='complete', phase='complete', completed=now(), artifact=str(final))
        write(job / 'status.json', status)
    except Exception as e:
        status.update(state='failed', error=str(e), finished=now(),
                      failure_kind='job_input' if isinstance(e, JobInputError) else 'render_context' if isinstance(e, RenderContextError) else 'unclassified')
        write(job / 'status.json', status)
        raise

def process(job):
    """Sequential entry point for manual use; the daemon overlaps stage functions."""
    picture(job)
    finish(job)

def file_sha256(path):
    with open(path, 'rb') as content:
        return hashlib.file_digest(content, 'sha256').hexdigest()

def picture_frames(duration, pcm_seconds):
    # engine.finish.span rounds the measured PCM end to milliseconds. Beat-map
    # duration may omit a synthesized reverb tail, so it cannot bound the master.
    if not duration or not math.isfinite(duration) or duration <= 0 or duration > round(pcm_seconds, 3):
        raise RuntimeError('No valid picture span within the generated audio')
    return round(duration * 30)

def worker_ranges(frames, scene=None):
    per_gpu=CONFIG.get('scene_workers_per_gpu',{}).get(scene,CONFIG.get('workers_per_gpu',1))
    if not isinstance(per_gpu,int) or per_gpu<1:
        raise ValueError('workers_per_gpu must be a positive integer')
    count=len(CONFIG['gpus'])*per_gpu
    if frames<count:
        raise ValueError('Span has fewer frames than configured workers')
    result=[]
    for i in range(count):
        physical=CONFIG['gpus'][i%len(CONFIG['gpus'])]
        gpu=dict(physical)
        if per_gpu>1:
            gpu['label']+='-w'+str(i//len(CONFIG['gpus']))
        first=frames*i//count
        # Replay the history of the original one-worker-per-GPU segment.
        parent=next(j for j in reversed(range(len(CONFIG['gpus'])))
                    if first>=frames*j//len(CONFIG['gpus']))
        result.append(dict(gpu=gpu,first=first,end_exclusive=frames*(i+1)//count,
                           preroll=frames*parent//len(CONFIG['gpus'])))
    return result

def read_admitted_context(job):
    """Read the exact prepared checkpoint reserved by the scheduler."""
    prepared=job/'prepared.json'
    payload=prepared.read_bytes()
    admission_path=job/'admission.json'
    if admission_path.is_file():
        admission=json.loads(admission_path.read_text())
        expected=admission.get('prepared_sha256')
        if expected is not None and hashlib.sha256(payload).hexdigest()!=expected:
            raise JobInputError('Prepared checkpoint changed after scheduler admission')
    return json.loads(payload)

def scene_worker_memory_bytes(context):
    """Divide an admitted scene memory budget across its render containers."""
    value=context.get('host_memory_gib')
    if value is None:
        return None
    ranges=context.get('ranges')
    if not isinstance(ranges,list) or not ranges:
        raise ValueError('Scene memory budget requires at least one worker range')
    if not isinstance(value,(int,float)) or not math.isfinite(value) or value<=0:
        raise ValueError('Scene memory budget must be finite and positive')
    return int(value * 2**30) // len(ranges)

def _declare_scene_canary_locked(job, host_memory_gib):
    """Declare a finite one-worker budget for a prepared scene canary."""
    job = pathlib.Path(job)
    status_path = job/'status.json'
    request_path = job/'request.json'
    prepared_path = job/'prepared.json'
    if not status_path.is_file() or not request_path.is_file() or not prepared_path.is_file():
        raise ValueError('Canary declaration requires a prepared job')
    status=json.loads(status_path.read_text())
    request=json.loads(request_path.read_text())
    context=json.loads(prepared_path.read_text())
    if status.get('state')!='prepared' or request.get('kind')=='gpu':
        raise ValueError('Canary declaration requires a prepared scene job')
    if (job/'admission.json').exists():
        raise ValueError('Canary declaration is closed after scheduler admission')
    if not isinstance(host_memory_gib,(int,float)) or not math.isfinite(host_memory_gib) or host_memory_gib<=0:
        raise ValueError('Host memory budget must be finite and positive')
    existing=context.get('ranges')
    frames=context.get('frames')
    if not isinstance(existing,list) or not existing or not isinstance(frames,int) or frames<1:
        raise ValueError('Prepared scene has no valid worker ranges')
    # A canary uses one of the already selected UUIDs for the complete frame span.
    selected=existing[0]
    gpu=dict(selected['gpu'])
    gpu['label']=re.sub(r'-w\d+$','',gpu['label'])
    old_ranges=context['ranges']
    new_ranges=[dict(gpu=gpu,first=0,end_exclusive=frames,preroll=0)]
    context['host_memory_gib']=float(host_memory_gib)
    context['ranges']=new_ranges
    receipt=dict(schema='acp.scene-canary-resources/v1',job=job.name,
                 request_sha256=file_sha256(request_path),source_commit=context.get('commit'),
                 renderer_original_sha256=context.get('renderer_original_sha256'),
                 renderer_adapted_sha256=context.get('renderer_adapted_sha256'),
                 previous_ranges=old_ranges,ranges=new_ranges,
                 host_memory_gib=float(host_memory_gib),container_memory_gib=float(host_memory_gib),
                 declared_at=now())
    # Publish the receipt first. memory_required() ignores it until the atomic
    # prepared checkpoint contains the matching budget and ranges.
    write(job/'resource-declaration.json',receipt)
    context['resource_declaration_sha256']=file_sha256(job/'resource-declaration.json')
    write(job/'prepared.json',context)
    return receipt

def declare_scene_canary(job, host_memory_gib):
    """Declare a scene canary while holding the scheduler admission lock."""
    import gpu_allocation
    with gpu_allocation.admission_guard():
        return _declare_scene_canary_locked(job,host_memory_gib)

def _declare_scene_resources_locked(job, host_memory_gib):
    """Bind a finite host budget to an existing prepared scene and its ranges."""
    job=pathlib.Path(job)
    status_path=job/'status.json'
    request_path=job/'request.json'
    prepared_path=job/'prepared.json'
    if not status_path.is_file() or not request_path.is_file() or not prepared_path.is_file():
        raise ValueError('Scene resource declaration requires a prepared job')
    status=json.loads(status_path.read_text())
    request=json.loads(request_path.read_text())
    context=json.loads(prepared_path.read_text())
    if status.get('state')!='prepared' or request.get('kind')=='gpu':
        raise ValueError('Scene resource declaration requires a prepared scene job')
    if (job/'admission.json').exists():
        raise ValueError('Scene resource declaration is closed after scheduler admission')
    if (job/'resource-declaration.json').exists():
        raise ValueError('Scene resource declaration already exists')
    if not isinstance(host_memory_gib,(int,float)) or not math.isfinite(host_memory_gib) or host_memory_gib<=0:
        raise ValueError('Host memory budget must be finite and positive')
    ranges=context.get('ranges')
    if not isinstance(ranges,list) or not ranges:
        raise ValueError('Prepared scene has no valid worker ranges')
    frames=context.get('frames')
    if not isinstance(frames,int) or frames<1:
        raise ValueError('Prepared scene has no valid frame count')
    for item in ranges:
        if (not isinstance(item,dict) or not isinstance(item.get('gpu'),dict) or
                not isinstance(item.get('first'),int) or not isinstance(item.get('end_exclusive'),int) or
                item['first']<0 or item['end_exclusive']<=item['first'] or item['end_exclusive']>frames):
            raise ValueError('Prepared scene has invalid worker ranges')
    # The declaration records the caller's configured job limit. The scheduler
    # divides this limit across the already prepared ranges.
    context['host_memory_gib']=float(host_memory_gib)
    context['host_memory_basis']='operator_configured_limit'
    receipt=dict(schema='acp.scene-resources/v1',job=job.name,
                 request_sha256=file_sha256(request_path),source_commit=context.get('commit'),
                 renderer_original_sha256=context.get('renderer_original_sha256'),
                 renderer_adapted_sha256=context.get('renderer_adapted_sha256'),
                 ranges=ranges,host_memory_gib=float(host_memory_gib),
                 container_memory_gib=float(host_memory_gib),
                 memory_basis='operator_configured_limit',declared_at=now())
    write(job/'resource-declaration.json',receipt)
    context['resource_declaration_sha256']=file_sha256(job/'resource-declaration.json')
    write(prepared_path,context)
    return receipt

def declare_scene_resources(job, host_memory_gib):
    """Declare a scene budget without changing prepared ranges or source pins."""
    import gpu_allocation
    with gpu_allocation.admission_guard():
        return _declare_scene_resources_locked(job,host_memory_gib)

def context_loss_logs(job):
    return [log.name for log in sorted((job/'logs').glob('*.log'))
            if re.search(r'GL_CONTEXT_LOST_KHR|Unexpected driver error|"name":\s*"FarmWebGLContextLost"',
                         log.read_text(errors='replace'))]

def check_render_outcome(job, before, worker_errors):
    # Called after every worker has exited, even if one returned an error.
    errors = subprocess.run(['journalctl', '-k', '--since', before, '--no-pager'], capture_output=True, text=True)
    (job / 'logs/kernel.log').write_text(errors.stdout + errors.stderr)
    if errors.returncode or re.search(r'NVRM: Xid|fallen off the bus|Surprise Down', errors.stdout, re.I):
        raise RuntimeError('GPU kernel check failed: inspect kernel.log before further work')
    context_losses = context_loss_logs(job)
    if not worker_errors and not context_losses:
        return
    selected = ','.join(g['uuid'] for g in CONFIG['gpus'])
    try:
        health = subprocess.run(['nvidia-smi', '-i', selected, '--query-gpu=uuid', '--format=csv,noheader'],
                                capture_output=True, text=True,
                                timeout=CONFIG['gpu_health_timeout_seconds'])
    except subprocess.TimeoutExpired as error:
        raise RuntimeError('GPU health probe timed out; dispatch requires inspection') from error
    (job / 'logs/gpu-health.log').write_text(health.stdout + health.stderr)
    if health.returncode or sorted(health.stdout.split()) != sorted(g['uuid'] for g in CONFIG['gpus']):
        raise RuntimeError('GPU health probe failed; dispatch requires inspection')
    if context_losses:
        # Do not conceal an unrelated worker failure behind another worker's loss.
        for gpu, error in worker_errors:
            if (gpu['label']+'.log') not in context_losses:
                raise error
        raise RenderContextError('WebGL context loss in '+', '.join(context_losses)+
                                 '; output rejected; workers exited and GPU/kernel checks passed')
    missing = set()
    scene_errors = set()
    for gpu, error in worker_errors:
        log = (job / 'logs' / (gpu['label'] + '.log')).read_text(errors='replace')
        if (isinstance(error, subprocess.CalledProcessError) and error.returncode == 75
                and 'render.mjs: WATCHDOG: no new frame' in log
                and 'Closing the browser, releasing the slot, exit 75' in log):
            continue
        # A rejected dynamic import reaches Playwright's evaluate promise.
        # Match the renderer receipt to this worker and its pinned request.
        dynamic = re.findall(r'^\[FARM_RENDER_FAILURE\] (.+)$', log, re.M)
        if dynamic and isinstance(error, subprocess.CalledProcessError) and error.returncode == 1:
            try:
                request = json.loads((job/'request.json').read_text())
                report = json.loads((job/'out'/('homelab-'+gpu['label']+'-scene-failure.json')).read_text())
                if (report.get('commit') == request['commit'] and
                        report.get('worker') == {'label': gpu['label'], 'uuid': gpu['uuid']}):
                    for item in dynamic:
                        detail = json.loads(item)
                        match = re.fullmatch(r'page\.evaluate: TypeError: Failed to fetch dynamically imported module: (http://127\.0\.0\.1:[0-9]+/\S+)', detail.get('message', ''))
                        if (match and report.get('error') == detail and
                                any(row.get('status') == 404 and row.get('resource_type') == 'script' and
                                    row.get('url') == match[1] for row in report.get('http_failures', []))):
                            scene_errors.add('Missing dynamic scene module: '+match[1])
                            break
                    else:
                        raise ValueError('Dynamic import failure has no matching script 404')
                    continue
            except (OSError, ValueError, TypeError, KeyError, AttributeError):
                raise error
        fatal = re.findall(r'^\[FARM_FATAL_PAGEERROR\] (.+)$', log, re.M)
        if fatal and isinstance(error, subprocess.CalledProcessError) and error.returncode == 1:
            try:
                for item in fatal:
                    detail = json.loads(item)
                    detail['name'] = str(detail.get('name', '')).removeprefix('Uncaught ')
                    if detail.get('name') == '' and detail.get('message') == 'Event':
                        # Image.onerror can reject a scene promise with a DOM Event,
                        # not an Error. Require both a local missing image response
                        # and DevTools evidence that the event targeted an image.
                        images = re.findall(r'^\[HTTP\] 404 (http://127\.0\.0\.1:[0-9]+/[^\s]*\.(?:png|jpe?g|webp|gif|svg|avif))(?:\s|$)', log, re.M)
                        report_path = job/'out'/('homelab-'+gpu['label']+'-scene-failure.json')
                        report = json.loads(report_path.read_text()) if report_path.exists() else {}
                        image_event = False
                        for browser in report.get('browser_exceptions', []):
                            exception = browser.get('exception', {})
                            props = {p.get('name'):p for p in exception.get('preview', {}).get('properties', [])}
                            image_event |= (exception.get('className') == 'Event' and
                                            props.get('type', {}).get('value') == 'error' and
                                            props.get('target', {}).get('value') == 'img')
                        if images and image_event:
                            scene_errors.add('Missing image asset(s): '+', '.join(sorted(set(images))))
                            continue
                    if detail.get('name') not in ('Error', 'SyntaxError', 'TypeError', 'ReferenceError', 'RangeError') or not detail.get('message'):
                        raise ValueError('Unrecognized browser failure')
                    scene_errors.add(detail['name'] + ': ' + detail['message'])
            except (ValueError, TypeError, AttributeError):
                raise error
            continue
        assets = re.findall(r'^\[HTTP\] 404 (http://127\.0\.0\.1:[0-9]+/[^\s]*\.json)(?:\s|$)', log, re.M)
        # Match the observed missing-JSON scene failure, rather than treating
        # arbitrary browser timeouts or unrelated favicon 404s as safe.
        if not assets or not re.search(r"\[pageerror\].*Failed to execute 'json' on 'Response'", log):
            raise error
        missing.update(assets)
    if scene_errors:
        raise JobInputError('Scene JavaScript failed: ' + '; '.join(sorted(scene_errors)) +
                            '; workers exited and GPU/kernel checks passed')
    if not missing:
        raise JobInputError('Renderer watchdog expired; workers exited and GPU/kernel checks passed; elapsed-time render gates have been removed')
    raise JobInputError('Scene requested missing JSON asset(s): ' + ', '.join(sorted(missing)) +
                        '; workers exited and GPU/kernel checks passed')

def failure_requires_inspection(job):
    """Input failures with confirmed clean worker exits may leave polling on."""
    try:
        status = json.loads((job / 'status.json').read_text())
    except (OSError, ValueError):
        return True
    return not (status.get('state') == 'failed' and
                (status.get('phase') == 'preparing' or status.get('failure_kind') in ('job_input','render_context')))

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest='command', required=True)
    submit = sub.add_parser('submit')
    submit.add_argument('scene'); submit.add_argument('--ref', default='main')
    submit.add_argument('--seconds', type=float)
    submit.add_argument('--dependencies', default='{}', help='Dependency JSON object or @local-file.json')
    sub.add_parser('status')
    archive = sub.add_parser('archive')
    archive.add_argument('job')
    deliver = sub.add_parser('deliver')
    deliver.add_argument('job')
    declare = sub.add_parser('declare-scene-canary')
    declare.add_argument('job')
    declare.add_argument('--host-memory-gib',type=float,required=True)
    resources = sub.add_parser('declare-scene-resources')
    resources.add_argument('job')
    resources.add_argument('--host-memory-gib',type=float,required=True)
    full_scene = sub.add_parser('submit-fframes-full-scene')
    full_scene.add_argument('--pipeline-commit', required=True)
    full_scene.add_argument('--memory-gib', type=float, required=True,
                            help='Finite host/container memory reservation from retained renderer evidence')
    full_scene.add_argument('--time-minutes', type=float, required=True)
    sub.add_parser('work')
    args = ap.parse_args()
    JOBS.mkdir(parents=True, exist_ok=True)
    if args.command == 'submit':
        if not re.fullmatch(r'[A-Za-z0-9_-]+', args.scene):
            ap.error('Scene must be a filename stem')
        if args.seconds is not None and (not math.isfinite(args.seconds) or args.seconds <= 0):
            ap.error('--seconds must be finite and positive')
        from protocol.farm_dependencies import parse
        try: dependencies=parse(args.dependencies)
        except (ValueError,OSError) as error: ap.error(str(error))
        ref = args.ref
        if re.fullmatch(r'[0-9a-f]{40}', ref):
            commit = ref
        else:
            if ref.startswith('-') or any(c.isspace() for c in ref):
                ap.error('Invalid ref')
            resolved = run(['git', 'ls-remote', CONFIG['repository'], 'refs/heads/' + ref, 'refs/tags/' + ref])
            candidates = {line.split()[0] for line in resolved.splitlines() if line}
            if len(candidates) != 1:
                ap.error('Ref is missing or ambiguous; submit its full commit SHA')
            commit = candidates.pop()
        job = JOBS / (datetime.datetime.now().strftime('%Y%m%dT%H%M%S%f') + '-' + uuid.uuid4().hex[:8])
        job.mkdir()
        write(job / 'request.json', {'scene':args.scene, 'commit':commit, 'ref':ref,
                                    'seconds':args.seconds, 'dependencies':dependencies, 'submitted':now()})
        write(job / 'status.json', {'state':'queued'})
        print(json.dumps({'job':job.name, 'commit':commit, 'directory':str(job)},indent=2))
    elif args.command == 'status':
        for job in sorted(JOBS.iterdir()):
            if (job / 'status.json').is_file():
                s = json.loads((job / 'status.json').read_text())
                if (job/'protocol.json').exists():
                    s['delivery']=json.loads((job/'protocol.json').read_text()).get('state')
                print(job.name, json.dumps(s))
    elif args.command == 'archive':
        if not re.fullmatch(r'[A-Za-z0-9_-]+', args.job):
            ap.error('Invalid job ID')
        from archive import publish
        print(json.dumps(publish(JOBS / args.job),indent=2))
    elif args.command == 'deliver':
        if not re.fullmatch(r'[A-Za-z0-9_-]+',args.job):
            ap.error('Invalid job ID')
        from protocol_bridge import deliver
        print(json.dumps(deliver(JOBS/args.job),indent=2))
    elif args.command == 'submit-fframes-full-scene':
        if not re.fullmatch(r'[0-9a-f]{40}', args.pipeline_commit):
            ap.error('--pipeline-commit must be a full lowercase commit SHA')
        if not math.isfinite(args.memory_gib) or args.memory_gib <= 0:
            ap.error('--memory-gib must be positive and finite')
        if not math.isfinite(args.time_minutes) or args.time_minutes <= 0:
            ap.error('--time-minutes must be positive and finite')
        try:
            from fframes_recipe import post_full_scene
            result = post_full_scene(args.pipeline_commit, args.memory_gib, args.time_minutes)
        except (OSError, ValueError, RuntimeError, KeyError) as error:
            ap.error(str(error))
        print(json.dumps(result, indent=2))
    elif args.command == 'declare-scene-canary':
        if not re.fullmatch(r'[A-Za-z0-9_-]+',args.job):
            ap.error('Invalid job ID')
        try: receipt=declare_scene_canary(JOBS/args.job,args.host_memory_gib)
        except (OSError,ValueError,KeyError) as error: ap.error(str(error))
        print(json.dumps(receipt,indent=2))
    elif args.command == 'declare-scene-resources':
        if not re.fullmatch(r'[A-Za-z0-9_-]+',args.job):
            ap.error('Invalid job ID')
        try: receipt=declare_scene_resources(JOBS/args.job,args.host_memory_gib)
        except (OSError,ValueError,KeyError) as error: ap.error(str(error))
        print(json.dumps(receipt,indent=2))
    else:
        signal.signal(signal.SIGTERM, lambda *_:STOP.set())
        signal.signal(signal.SIGINT, lambda *_:STOP.set())
        with open(BASE / 'worker.lock', 'w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            from recovery import recover
            if recover() is False:
                raise SystemExit(78)
            from scheduler import work
            work()

if __name__ == '__main__':
    main()
