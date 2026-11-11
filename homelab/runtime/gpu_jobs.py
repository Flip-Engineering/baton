"""Run Blender/Python recipes on scheduler-allocated GPUs and validate delivery."""
import hashlib, json, math, os, pathlib, re, shlex, shutil, subprocess, time
import farm

SCRIPT={k:re.compile(r'videos/'+d+r'/(?:[A-Za-z0-9_][A-Za-z0-9_.-]*/)*[A-Za-z0-9_][A-Za-z0-9_.-]*\.py') for k,d in [('blender','blender'),('python','gpu')]}

def parse(spec):
    run=spec.get('run') or []
    if len(run)!=1: raise ValueError('GPU jobs require exactly one gpu_job.sh command')
    argv=shlex.split(run[0])
    if any(any(c in a for c in '\0\r\n') for a in argv): raise ValueError('Invalid GPU argument')
    if len(argv)<4 or argv[:2]!=['sh','videos/scripts/gpu_job.sh'] or argv[2] not in SCRIPT:
        raise ValueError('Supported GPU recipe: sh videos/scripts/gpu_job.sh blender|python SCRIPT')
    if not SCRIPT[argv[2]].fullmatch(argv[3]) or '..' in pathlib.PurePosixPath(argv[3]).parts:
        raise ValueError('GPU script must be a plain path under videos/blender/ or videos/gpu/')
    head=argv[4:argv.index('--')] if '--' in argv else argv[4:]
    values={};i=0
    while i<len(head):
        a=head[i]
        if a=='--per-gpu': i+=1;continue
        key,sep,val=a.partition('=')
        if key not in ('--id','--gpus','--time','--mem','--device','--blend') or key in values:
            raise ValueError('Unknown/duplicate GPU option '+key)
        if not sep:
            i+=1
            if i==len(head): raise ValueError('Missing GPU option value')
            val=head[i]
        values[key]=val;i+=1
    job_id=spec.get('protocol_id',spec.get('id'))
    if not job_id or values.get('--id')!=job_id: raise ValueError('GPU --id must match the queue job id')
    n=int(values.get('--gpus','1'))
    capacity=len(farm.CONFIG.get('gpu_job_gpus',farm.CONFIG['gpus']))
    if not 1<=n<=capacity: raise ValueError('Requested GPU count exceeds available isolated cards')
    return dict(kind='gpu',gpu_kind=argv[2],gpu_argv=argv,gpu_count=n)


def read_request(job):
    path=pathlib.Path(job)/'request.json'
    if path.is_symlink() or not path.is_file(): raise ValueError('GPU queue request manifest must be a regular file')
    request=json.loads(path.read_text())
    if not isinstance(request,dict): raise ValueError('GPU queue request manifest must be an object')
    identifier=request.get('protocol_id')
    commit=request.get('commit')
    argv=request.get('gpu_argv')
    if not isinstance(identifier,str) or not identifier or not isinstance(commit,str) or not re.fullmatch(r'[0-9a-f]{40}',commit):
        raise ValueError('GPU queue request manifest requires protocol_id and pinned commit')
    if not isinstance(argv,list) or len(argv)<4 or not all(isinstance(x,str) for x in argv):
        raise ValueError('GPU queue request manifest requires argv array')
    return path,request


def launch_limits(job,request=None):
    if request is None: _,request=read_request(job)
    prepared=pathlib.Path(job)/'prepared.json'
    memory=None
    if prepared.is_file(): memory=json.loads(prepared.read_text()).get('host_memory_gib')
    argv=request['gpu_argv']
    if memory is None:
        for i,arg in enumerate(argv):
            if arg=='--': break
            if arg=='--mem':
                if i+1<len(argv): memory=argv[i+1]
                break
            if arg.startswith('--mem='):
                memory=arg.split('=',1)[1]
                break
    if memory is None: raise ValueError('GPU queue request must declare --mem for a bounded container cgroup')
    cpu=farm.CONFIG.get('gpu_job_cpu_limit',14)
    try: memory=float(memory); cpu=float(cpu)
    except (TypeError,ValueError): raise ValueError('GPU container memory and CPU limits must be numeric')
    if not math.isfinite(memory) or memory<=0 or not math.isfinite(cpu) or cpu<=0:
        raise ValueError('GPU container memory and CPU limits must be positive and finite')
    return dict(memory_gib=memory,cpu_cores=cpu)


def campaign_admission(job, allocated):
    """Return a verified scheduler receipt for the UUIDs passed into a GPU container."""
    if not allocated:
        return None
    from gpu_allocation import process_start

    request_path, request = read_request(job)
    prepared_path = pathlib.Path(job) / 'prepared.json'
    admission_path = pathlib.Path(job) / 'admission.json'
    allocation_path = pathlib.Path(job) / 'allocation.json'
    status_path = pathlib.Path(job) / 'status.json'
    required = (prepared_path, admission_path, allocation_path, status_path)
    if any(not path.is_file() or path.is_symlink() for path in required):
        raise ValueError('GPU launch requires regular prepared, admission, allocation, and status files')

    prepared_bytes = prepared_path.read_bytes()
    prepared = json.loads(prepared_bytes)
    admission = json.loads(admission_path.read_text())
    allocation = json.loads(allocation_path.read_text())
    status = json.loads(status_path.read_text())
    prepared_sha = hashlib.sha256(prepared_bytes).hexdigest()
    request_sha = hashlib.sha256(request_path.read_bytes()).hexdigest()
    allocated_uuids = [gpu['uuid'] for gpu in allocated]
    recorded_uuids = [gpu.get('uuid') for gpu in allocation.get('gpus', [])]
    if status.get('state') != 'running' or status.get('phase') != 'rendering':
        raise ValueError('GPU launch requires a running render phase')
    if request.get('kind') != 'gpu' or request.get('protocol_id') != request_path.parent.name.removeprefix('protocol-'):
        raise ValueError('GPU request identity does not match its durable job directory')
    if prepared.get('commit') != request.get('commit'):
        raise ValueError('GPU prepared source commit differs from its request')
    if admission.get('boot_id') != farm.boot_id():
        raise ValueError('GPU scheduler admission belongs to another boot')
    owner = admission.get('owner_pid')
    owner_start = admission.get('owner_start')
    if not isinstance(owner, int) or not owner_start or process_start(owner) != owner_start:
        raise ValueError('GPU scheduler admission owner is no longer live')
    if admission.get('prepared_sha256') != prepared_sha:
        raise ValueError('GPU prepared checkpoint changed after scheduler admission')
    if allocated_uuids != recorded_uuids:
        raise ValueError('GPU allocation does not match the UUIDs requested by the container')
    if request.get('gpu_count') != len(allocated_uuids):
        raise ValueError('GPU allocation count differs from the pinned request')

    limits = launch_limits(job, request)
    receipt = {
        'schema': 'acp.gpu-campaign-admission/v1',
        'job': request['protocol_id'],
        'pipeline_commit': request['commit'],
        'request_sha256': request_sha,
        'prepared_sha256': prepared_sha,
        'admission_sha256': farm.file_sha256(admission_path),
        'allocation_sha256': farm.file_sha256(allocation_path),
        'boot_id': admission['boot_id'],
        'owner_pid': owner,
        'owner_start': owner_start,
        'memory_bytes': admission.get('memory_bytes'),
        'container_memory_gib': limits['memory_gib'],
        'container_cpu_cores': limits['cpu_cores'],
        'gpu_uuids': allocated_uuids,
        'issued_at': farm.now(),
    }
    return json.dumps(receipt, separators=(',', ':'), sort_keys=True)


def lane_gpu_cache_source(container_path):
    """Map a container GPU-cache path to the selected lane's host cache."""
    root=pathlib.PurePosixPath('/nvme/acp-gpu')
    path=pathlib.PurePosixPath(container_path)
    try:
        relative=path.relative_to(root)
    except ValueError as error:
        raise ValueError('THE CHASM artifact path must be under /nvme/acp-gpu') from error
    if not relative.parts or any(part in ('.','..') for part in relative.parts):
        raise ValueError('THE CHASM artifact path escapes /nvme/acp-gpu')
    return pathlib.Path(farm.BASE)/'gpu-work'/pathlib.Path(*relative.parts)


def full_scene_mounts(request):
    """Return verified read-only input mounts for the pinned full-scene recipe."""
    argv=request.get('gpu_argv',[])
    scripts=('videos/gpu/fframes_full_scene.py','videos/gpu/fframes_chasm_glass_diagnostic.py')
    found=[script for script in scripts if script in argv]
    if not found:
        return []
    script=found[0]
    if len(found)!=1 or argv.count(script)!=1 or '--' not in argv:
        raise ValueError('Malformed THE CHASM render request')
    args=argv[argv.index('--')+1:]
    values=[]
    index=0
    while index<len(args):
        if args[index]=='--manifest-sha256':
            if index+1>=len(args): raise ValueError('Missing THE CHASM manifest digest')
            values.append(args[index+1]); index+=2
        else:
            index+=1
    if len(values)!=1:
        raise ValueError('THE CHASM request requires one content-addressed manifest digest')
    import fframes_recipe
    digest=values[0]
    manifest=fframes_recipe.read_full_scene_manifest(digest)
    entries=[
        (pathlib.Path(fframes_recipe.FULL_SCENE_CAPTURE_ROOT), fframes_recipe.FULL_SCENE_CONTAINER_CAPTURE, True),
        (pathlib.Path(fframes_recipe.FULL_SCENE_AUDIO), fframes_recipe.FULL_SCENE_CONTAINER_AUDIO, False),
        (pathlib.Path(fframes_recipe.FULL_SCENE_SOURCE_MANIFEST), fframes_recipe.FULL_SCENE_CONTAINER_SOURCE_MANIFEST, False),
        (lane_gpu_cache_source(fframes_recipe.FULL_SCENE_BINARY), fframes_recipe.FULL_SCENE_CONTAINER_BINARY, False),
        (lane_gpu_cache_source(fframes_recipe.FULL_SCENE_BINARY).parent/'manifest.json', fframes_recipe.FULL_SCENE_CONTAINER_ARTIFACT_MANIFEST, False),
        (pathlib.Path(fframes_recipe.FULL_SCENE_MANIFEST_STORE)/(digest+'.json'),
         fframes_recipe.FULL_SCENE_CONTAINER_MANIFEST, False),
    ]
    mounts=[]
    for source,destination,is_directory in entries:
        if source.is_symlink() or (not source.is_dir() if is_directory else not source.is_file()):
            raise ValueError('THE CHASM read-only input is missing or unsafe: '+str(source))
        resolved=source.resolve(strict=True)
        if resolved!=source.absolute():
            raise ValueError('THE CHASM read-only input resolves outside its approved path: '+str(source))
        if destination==fframes_recipe.FULL_SCENE_CONTAINER_BINARY:
            if fframes_recipe.sha256_file(resolved)!=fframes_recipe.FULL_SCENE_BINARY_SHA256:
                raise ValueError('THE CHASM renderer binary hash differs from the approved artifact')
        if destination==fframes_recipe.FULL_SCENE_CONTAINER_MANIFEST:
            if source.name!=digest+'.json' or not manifest:
                raise ValueError('THE CHASM manifest sidecar does not match its digest')
        mounts.append((resolved,destination))
    return mounts


def docker(job,cmd,gpus=None,log=None):
    from gpu_allocation import pool
    from job_dependencies import runtime_image
    allocated=gpus or []
    request_path,request=read_request(job)
    limits=launch_limits(job,request)
    request_sha=hashlib.sha256(request_path.read_bytes()).hexdigest()
    d=['docker','run','--rm','--name','acp-'+job.name+'-gpujob', '--user',f'{os.getuid()}:{os.getgid()}',
       '--cpus',str(limits['cpu_cores']),'--memory',f"{limits['memory_gib']}g",'--memory-swap',f"{limits['memory_gib']}g"]
    if allocated:
        uuids=','.join(g['uuid'] for g in allocated)
        d+=['--runtime=nvidia','--gpus','"device='+uuids+'"','-e','NVIDIA_VISIBLE_DEVICES='+uuids,
            '-e','NVIDIA_DRIVER_CAPABILITIES=all','-e','CUDA_VISIBLE_DEVICES='+uuids]
    else: d+=['-e','NVIDIA_VISIBLE_DEVICES=void']
    free=os.statvfs(farm.BASE)
    prepared=job/'prepared.json'
    cpu_workers=json.loads(prepared.read_text()).get('cpu_stage_policy',{}).get('cpu_stage_workers',1) if prepared.exists() else farm.CONFIG.get('gpu_cpu_stage_workers',1)
    manifest=job/'dependencies.json'
    namespace=json.loads(manifest.read_text())['cache_key'] if manifest.exists() else 'base'
    for k,v in dict(HOME='/render-tmp',TMPDIR='/render-tmp',GPU_JOB_HOME='/nvme/acp-gpu/environments/'+namespace,
                   GPU_JOB_BLENDER='/opt/blender/blender',GPU_JOB_REQUIRE_GPU='1',
                   GPU_JOB_ID=request['protocol_id'],
                   GPU_JOB_MAX_GPUS=str(len(pool())),GPU_JOB_GRACE='never',
                   ACP_CPU_STAGE_WORKERS=str(cpu_workers),
                   GPU_JOB_MAX_MEM=str(limits['memory_gib']),
                   ACP_JOB_CPU_LIMIT=str(limits['cpu_cores']),ACP_JOB_MEMORY_LIMIT_GIB=str(limits['memory_gib']),
                   ACP_JOB_REQUEST_FILE='/run/acp-job-request.json',ACP_JOB_REQUEST_SHA256=request_sha,
                   GPU_JOB_MAX_OUT_MB=str(free.f_bavail*free.f_frsize//2**20),GPU_JOB_MAX_FILES=str(free.f_favail),
                   PYTHONUNBUFFERED='1',PIP_EXTRA_INDEX_URL='https://pypi.org/simple').items(): d+=['-e',k+'='+v]
    if allocated:
        admission_receipt = campaign_admission(job, allocated)
        d += ['-e', 'CAMPAIGN_ADMITTED_GPU_UUIDS='+','.join(g['uuid'] for g in allocated),
              '-e', 'OC_ADMISSION_RECEIPT='+admission_receipt]
    for src,dst,ro in [(job/'repo','/work',False),(job/'out','/work/videos/out',False),
                       (job/'tmp','/render-tmp',False),(farm.BASE/'gpu-work','/nvme/acp-gpu',False),
                       (pathlib.Path('/opt/blender'),'/opt/blender',True)]:
        d+=['--mount',f'type=bind,src={src},dst={dst}'+(',readonly' if ro else '')]
    d+=['--mount',f'type=bind,src={request_path.resolve()},dst=/run/acp-job-request.json,readonly']
    for source,destination in full_scene_mounts(request):
        d+=['--mount',f'type=bind,src={source},dst={destination},readonly']
    d+=farm.runtime_cache_mounts(job)
    d+=['--shm-size=1g','-w','/work',runtime_image(job,farm.CONFIG['image']),*cmd]
    return farm.run(d,log=log)

def state(job,**values):
    p=job/'status.json';s=json.loads(p.read_text()) if p.exists() else {};s.update(values);farm.write(p,s)

def prepare(job):
    request=json.loads((job/'request.json').read_text());started=time.monotonic()
    state(job,state='running',phase='preparing',started=farm.now(),request=request)
    try:
        for name in ('out','tmp','logs','harness'): (job/name).mkdir(exist_ok=True)
        (farm.BASE/'gpu-work').mkdir(exist_ok=True)
        src=job/'repo'
        farm.run(['git','clone','--depth','1','--filter=blob:none','--no-checkout',farm.CONFIG['repository'],src],log=job/'logs/checkout.log')
        cache=farm.BASE/'object-cache'
        if cache.exists(): (src/'.git/objects/info/alternates').write_text(str(cache.resolve())+'\n')
        farm.run(['git','sparse-checkout','set',*farm.CONFIG['sparse'],'videos/blender','videos/gpu'],cwd=src)
        farm.run(['git','fetch','--depth','1','origin',request['commit']],cwd=src,log=job/'logs/checkout.log')
        farm.run(['git','checkout','--detach',request['commit']],cwd=src,log=job/'logs/checkout.log')
        if farm.run(['git','rev-parse','HEAD'],cwd=src)!=request['commit']: raise ValueError('GPU checkout revision mismatch')
        from gpu_policy import apply
        from person_cpu_policy import install as install_cpu_policy
        execution_argv,cpu_policy=install_cpu_policy(src,request['gpu_argv'],farm.CONFIG.get('gpu_cpu_stage_workers',1))
        original=src/'videos/scripts/gpu_job.py';adapted=src/'videos/scripts/gpu_job.farm.py'
        adapted.write_text(apply(original.read_text()))
        # Preflight with the adapted pinned parser before allocating any GPU.
        docker(job,['python3','-c','import runpy,sys,json;m=runpy.run_path("videos/scripts/gpu_job.farm.py");o=m["parse"](sys.argv[1:]);open("videos/out/farm-resource-limits.json","w").write(json.dumps({"host_memory_gib":o["mem"]}))',*request['gpu_argv'][2:]],log=job/'logs/preflight.log')
        from job_dependencies import install_image
        deps=install_image(job)
        if deps['declared']['npm']: raise ValueError('GPU recipes do not use npm; declare Python or system packages')
        if request['gpu_kind']=='python':
            docker(job,['python3','videos/scripts/gpu_job.farm.py','setup-venv'],log=job/'logs/venv.log')
            # Extra Python dependencies belong in the requirements-keyed venv, not only the base image.
            if deps['declared']['python']:
                code='import runpy,subprocess,sys;m=runpy.run_path("videos/scripts/gpu_job.farm.py");p,_=m["ensure_venv"]();subprocess.run([p,"-m","pip","install",*sys.argv[1:]],check=True);subprocess.run([p,"-m","pip","check"],check=True)'
                docker(job,['python3','-c',code,*deps['declared']['python']],log=job/'logs/dependencies.log')
        if request['gpu_kind']=='python':
            probe='import runpy,subprocess,json;m=runpy.run_path("videos/scripts/gpu_job.farm.py");p,info=m["ensure_venv"]();freeze=subprocess.check_output([p,"-m","pip","freeze"],text=True);print(json.dumps(dict(venv=info,freeze=freeze)))'
            deps['resolved_gpu_python']=json.loads(docker(job,['python3','-c',probe]))
            farm.write(job/'dependencies.json',deps)
        inputs={str(p.relative_to(src)):farm.file_sha256(p) for prefix in ('videos/blender','videos/gpu','videos/scripts') for p in (src/prefix).rglob('*') if p.is_file() and '.pyc'!=p.suffix}
        resources=json.loads((job/'out/farm-resource-limits.json').read_text())
        limits=launch_limits(job,request)
        context=dict(request=request,commit=request['commit'],inputs=inputs,gpu_execution_argv=execution_argv,cpu_stage_policy=cpu_policy,host_memory_gib=resources['host_memory_gib'],resource_limits=limits,request_manifest_sha256=hashlib.sha256((job/'request.json').read_bytes()).hexdigest(),dependencies_manifest_sha256=farm.file_sha256(job/'dependencies.json'),prepare_seconds=round(time.monotonic()-started,3))
        for name in ('gpu_jobs.py','gpu_policy.py','person_cpu_policy.py','gpu_allocation.py','admission_policy.py','recovery.py','farm.py','protocol_bridge.py','scheduler.py','config.json','common_person.py','person_child_failures.py'): shutil.copy2(farm.HOME/name,job/'harness'/name)
        farm.sync_storage(job)
        farm.write(job/'prepared.json',context);state(job,state='prepared',phase='ready',prepared=farm.now())
    except Exception as e:
        state(job,state='failed',phase='preparing',error=str(e),finished=farm.now());raise

def picture(job, gpus=None):
    context=json.loads((job/'prepared.json').read_text())
    request_path,request=read_request(job)
    if context.get('request_manifest_sha256') and hashlib.sha256(request_path.read_bytes()).hexdigest()!=context['request_manifest_sha256']:
        raise farm.JobInputError('GPU queue request manifest changed after preparation')
    started=time.monotonic()
    allocated = farm.CONFIG.get('gpu_job_gpus',farm.CONFIG['gpus'])[:request['gpu_count']] if gpus is None else gpus
    from gpu_allocation import pool
    configured = {g['uuid'] for g in pool()}
    uuids = {g['uuid'] for g in allocated}
    if len(allocated) != request['gpu_count'] or len(uuids) != len(allocated) or not uuids <= configured:
        raise ValueError('Invalid exclusive GPU allocation')
    context['allocated_gpus'] = allocated
    state(job,state='running',phase='rendering',render_started=farm.now())
    try:
        if farm.run(['git','rev-parse','HEAD'],cwd=job/'repo')!=context['commit']: raise farm.JobInputError('GPU checkpoint revision changed')
        for rel,expected in context['inputs'].items():
            if farm.file_sha256(job/'repo'/rel)!=expected: raise farm.JobInputError('GPU prepared input changed: '+rel)
        if farm.file_sha256(job/'dependencies.json')!=context['dependencies_manifest_sha256']: raise farm.JobInputError('GPU dependency manifest changed')
        if request['gpu_kind']=='python':
            manifest=json.loads((job/'dependencies.json').read_text())
            probe='import runpy,subprocess;m=runpy.run_path("videos/scripts/gpu_job.farm.py");p,_=m["ensure_venv"]();print(subprocess.check_output([p,"-m","pip","freeze"],text=True),end="")'
            if docker(job,['python3','-c',probe]).strip()!=manifest['resolved_gpu_python']['freeze'].strip():
                raise farm.JobInputError('GPU Python environment changed after preparation')
        before=farm.run(['date','--iso-8601=seconds']);error=None
        try: docker(job,['python3','videos/scripts/gpu_job.farm.py',*context.get('gpu_execution_argv',request['gpu_argv'])[2:]],allocated,job/'logs/gpujob.log')
        except subprocess.CalledProcessError as e: error=e
        farm.check_render_outcome(job,before,[])
        health=farm.run(['timeout',str(farm.CONFIG['gpu_health_timeout_seconds']),'nvidia-smi','-i',','.join(g['uuid'] for g in allocated),'--query-gpu=uuid','--format=csv,noheader'])
        if sorted(health.split())!=sorted(uuids): raise RuntimeError('GPU health allocation mismatch')
        if error: raise farm.JobInputError('GPU script failed after clean exit and clean kernel/UUID checks: '+str(error))
        save_picture(job,context,uuids,round(time.monotonic()-started,3))
    except Exception as e:
        state(job,state='failed',phase='rendering',failure_kind='job_input' if isinstance(e,farm.JobInputError) else 'unclassified',error=str(e),finished=farm.now());raise

def save_picture(job,context,uuids,seconds):
    request=context['request'];jid=request.get('protocol_id',job.name)
    deliver=job/'out/gpu'/jid/'deliver';receipt=json.loads((deliver/'receipt.json').read_text())
    if receipt['status']!='ok' or receipt['exit_code']!=0:
        raise farm.JobInputError('GPU helper did not validate outputs')
    reported_commit=receipt.get('repo',{}).get('commit')
    if receipt.get('job',jid)!=jid or (reported_commit is not None and reported_commit!=context['commit']):
        raise farm.JobInputError('GPU receipt job or revision mismatch')
    if reported_commit is None:
        # The helper permits images without Git; verify the host checkout and inputs.
        from recovery import validate_prepared
        validate_prepared(job)
        receipt['source_verification']={'method':'host checkout and prepared input SHA256',
                                       'commit':context['commit']}
    if {g['uuid'] for g in receipt['gpus']}!=set(uuids):
        raise RuntimeError('GPU job used an unexpected GPU')
    names=set()
    for output in receipt['files']:
        name=output['name'];path=deliver/name
        if pathlib.Path(name).name!=name or name in names or path.is_symlink() or not path.is_file():
            raise farm.JobInputError('GPU receipt contains an invalid output file')
        names.add(name)
        if farm.file_sha256(path)!=output['sha256']:
            raise farm.JobInputError('GPU output hash mismatch')
    receipt.update(commit=context['commit'],kind='gpu',gpu_kind=request['gpu_kind'],worker_policy={'elapsed_time_gates':False,'force_kill':False},
                   cpu_stage_policy=context.get('cpu_stage_policy',{'cpu_stage_workers':1}),resource_limits=context.get('resource_limits'),
                   request_manifest_sha256=context.get('request_manifest_sha256'),
                   cpu_stage_adapter_hashes={k:v for k,v in context['inputs'].items() if k.startswith('videos/blender/') and k.endswith('.farm.py')},
                   adapter_sha256=context['inputs']['videos/scripts/gpu_job.farm.py'],dependencies_sha256=context['dependencies_manifest_sha256'])
    shutil.copy2(job/'dependencies.json',deliver/'farm-dependencies.json')
    farm.sync_storage(job)
    farm.write(deliver/'receipt.json',receipt);farm.write(job/'receipt.json',receipt)
    context.update(deliver=str(deliver),picture_seconds=seconds,picture_finished=farm.now(),deliver_hashes={p.name:farm.file_sha256(p) for p in deliver.iterdir() if p.is_file() and not p.is_symlink()})
    farm.write(job/'pictured.json',context)
    state(job,state='pictured',phase='ready_to_finish',picture_finished=context['picture_finished'])

def finish(job):
    try:
        context=json.loads((job/'pictured.json').read_text());deliver=pathlib.Path(context['deliver'])
        for name,sha in context['deliver_hashes'].items():
            if farm.file_sha256(deliver/name)!=sha: raise ValueError('GPU delivery output changed')
        state(job,state='complete',phase='validated',finished=farm.now())
    except Exception as e:
        state(job,state='failed',phase='validating',failure_kind='job_input',error=str(e),finished=farm.now());raise

def deliver(job):
    from protocol_bridge import command
    request=json.loads((job/'request.json').read_text());context=json.loads((job/'pictured.json').read_text());directory=pathlib.Path(context['deliver'])
    if json.loads((job/'status.json').read_text())['state']!='complete': raise ValueError('GPU job incomplete')
    paths=[directory/n for n in sorted(context['deliver_hashes'])]
    # Older completed checkpoints used a separately archived dependency manifest.
    if 'farm-dependencies.json' not in context['deliver_hashes']: paths.append(job/'dependencies.json')
    for p in paths:
        if p.is_symlink() or not p.is_file(): raise ValueError('Nonregular GPU delivery')
        expected=context['deliver_hashes'].get(p.name,context['dependencies_manifest_sha256'])
        if farm.file_sha256(p)!=expected: raise ValueError('GPU delivery hash changed')
    identifier=request['protocol_id']
    remote=json.loads(command('show',identifier))
    if remote['state']!='done':
        command('deliver',identifier,'--by',farm.CONFIG['protocol_worker'],*paths,'--note','GPU_JOB OK; Blender/Python recipe; exclusive GPU UUID allocation; all regular deliver outputs archived with SHA-256 receipt.')
    remote=json.loads(command('show',identifier))
    if remote['state']!='done' or remote['delivery']['by']!=farm.CONFIG['protocol_worker']: raise RuntimeError('Queue failed to confirm GPU delivery')
    reported={f['name']:f['sha256'] for f in remote['delivery']['files']}
    if any(reported.get(p.name)!=farm.file_sha256(p) for p in paths): raise RuntimeError('Archived GPU hashes differ')
    result=dict(state='delivered',protocol_id=identifier,archive_dir=remote['delivery']['archive_dir'],pipeline_job=remote,verified=farm.now(),url='https://github.com/flip-engineer/automated-content-pipeline-video-studies-archive/tree/main/farm/'+identifier)
    farm.write(job/'protocol.json',result);return result
