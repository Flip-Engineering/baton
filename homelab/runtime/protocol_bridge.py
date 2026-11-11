"""Use the pipeline's own Git queue and delivery tool; GPU work stays in farm.py."""
import json, os, pathlib, re, shlex, shutil, subprocess, threading, fcntl, math
import farm
import farm_targeted_acquire as targeted

GIT_LOCKS = {lane:threading.Lock() for lane in ('queue','delivery')}

def command(*args, allow_empty=False):
    lane='delivery' if args and args[0]=='deliver' else 'queue'
    cache='protocol-delivery-cache' if lane=='delivery' else 'protocol-cache'
    env = dict(farm.ENV, FARM_CACHE=str(farm.BASE/cache),
               TMPDIR=str(farm.BASE/'tmp'), FARM_NAME='Homelab V100 farm',
               FARM_EMAIL='flip-engineer@users.noreply.github.com')
    with GIT_LOCKS[lane], open(farm.BASE/('protocol-'+lane+'.lock'),'w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        r = subprocess.run(['python3', str(farm.HOME/'protocol/pipeline-farm.py'), *map(str,args)],
                           env=env,capture_output=True,text=True)
    if allow_empty and r.returncode == 3:
        return None
    if r.returncode:
        raise RuntimeError('Pipeline queue: '+r.stderr.strip()+' '+r.stdout.strip())
    return r.stdout.strip()

def parse_run(commands):
    if len(commands) != 1:
        raise ValueError('This worker supports one local_render.sh command per job; post bake steps separately')
    words = shlex.split(commands[0])
    if not words or words.pop(0) not in ('sh','bash') or not words or words.pop(0) not in (
            'videos/scripts/local_render.sh','./videos/scripts/local_render.sh'):
        raise ValueError('Supported recipe: sh videos/scripts/local_render.sh --seg SCENE:CLOSER_BEAT[:BPM]')
    words = [w for w in words if w != '--seg']
    if len(words) != 1:
        raise ValueError('This worker supports one full scene per job and the --seg flag')
    match = re.fullmatch(r'([A-Za-z0-9_-]+):([0-9]+(?:\.[0-9]+)?)(?::([0-9]+(?:\.[0-9]+)?))?',words[0])
    if not match:
        raise ValueError('Invalid local_render scene/closer specification')
    scene,beat,bpm = match.groups()
    if not math.isfinite(float(beat)) or float(beat)<=0 or (bpm and (not math.isfinite(float(bpm)) or float(bpm)<=0)):
        raise ValueError('Closer beat and optional BPM must be positive')
    return {'scene':scene,'closer_beat':float(beat),'bpm':float(bpm) if bpm else None}

def acquire():
    target_path=os.environ.get('ACP_PROTOCOL_TARGET_CLAIM_FILE')
    lane=farm.CONFIG.get('worker_lane')
    target=targeted.load_target(target_path,lane) if target_path and lane else None
    worker=farm.CONFIG['protocol_worker']
    lease_hours=farm.CONFIG['protocol_lease_hours']
    if target:
        result=targeted.acquire(target,lane,worker,lease_hours,
                                lambda args:command(*args))
    else:
        result=command('claim','--by',worker,
                       '--lease',str(lease_hours),allow_empty=True)
    if result is None:
        return None
    if target:
        identifier,spec=result
    else:
        identifier,body = result.split('\n',1)
        spec = json.loads(body)
    try:
        if not re.fullmatch(r'[A-Za-z0-9_-]+',identifier):
            raise ValueError('Invalid pipeline job identifier')
        from protocol.farm_dependencies import normalize
        dependencies = normalize(spec.get('dependencies'))
        if any('gpu_job.sh' in c for c in spec['run']):
            from gpu_jobs import parse
            parsed = parse(dict(spec,id=identifier))
        else:
            parsed = parse_run(spec['run'])
        if not re.fullmatch('[0-9a-f]{40}',spec['pipeline_commit']):
            raise ValueError('Job must pin a full pipeline commit SHA')
        reuse_audio=spec.get('reuse_audio_from')
        if reuse_audio and (not re.fullmatch(r'[A-Za-z0-9_-]+',reuse_audio) or spec.get('retry_of')!=reuse_audio):
            raise ValueError('Saved audio reuse must name the linked retry source')
        job = farm.JOBS / ('protocol-'+identifier)
        if job.exists() and (job/'request.json').exists():
            request=json.loads((job/'request.json').read_text())
            if (request.get('protocol_id')!=identifier or request.get('commit')!=spec['pipeline_commit'] or
                    request.get('dependencies',normalize())!=dependencies or
                    any(request.get(key)!=value for key,value in parsed.items()) or
                    request.get('protocol_spec',{}).get('outputs',[])!=spec.get('outputs',[])):
                raise ValueError('Queue recipe differs from its durable local request')
            state=json.loads((job/'status.json').read_text()).get('state')
            if target:
                targeted.mark_consumed(target_path,target,worker,farm.now())
            print('Retained pipeline job '+identifier+' at durable stage '+str(state),flush=True)
            return job if state=='queued' else None
        if job.exists():
            if any(path.name not in ('request.tmp','status.tmp') for path in job.iterdir()):
                raise OSError('Local job data has no durable request; retained for inspection')
            import uuid
            for path in job.iterdir():
                path.rename(job/('uncommitted-'+uuid.uuid4().hex+'-'+path.name))
        job.mkdir(exist_ok=True)
        request = dict(parsed,commit=spec['pipeline_commit'],ref=spec['pipeline_commit'],seconds=None,
                       dependencies=dependencies,protocol_id=identifier,protocol_spec=spec,submitted=farm.now())
        farm.write(job/'request.json',request)
        farm.write(job/'status.json',{'state':'queued'})
        if target:
            targeted.mark_consumed(target_path,target,worker,farm.now())
        print('Claimed pipeline job '+identifier,flush=True)
        return job
    except OSError:
        # Keep the claim recoverable when local persistence fails.
        raise
    except Exception as e:
        command('fail',identifier,'--by',farm.CONFIG['protocol_worker'],'--why',str(e))
        print('Declined unsupported pipeline job '+identifier+': '+str(e),flush=True)
        return None

class Lease:
    def __init__(self,identifier):
        self.identifier=identifier;self.stop=threading.Event();self.thread=None
    def start(self):
        if not self.identifier:return
        def renew():
            interval=farm.CONFIG['protocol_lease_hours']*3600/2
            while not self.stop.wait(interval):
                try:
                    command('touch',self.identifier,'--by',farm.CONFIG['protocol_worker'],
                            '--lease',str(farm.CONFIG['protocol_lease_hours']), '--note','Homelab workers still rendering')
                except Exception as e:
                    print('Lease renewal failed: '+str(e),flush=True)
        self.thread=threading.Thread(target=renew);self.thread.start()
    def close(self):
        self.stop.set()
        if self.thread:self.thread.join()

def failed(job,error):
    request=json.loads((job/'request.json').read_text())
    if request.get('protocol_id'):
        from failure_reporting import explain
        command('fail',request['protocol_id'],'--by',farm.CONFIG['protocol_worker'],
                '--why',explain(job,error))

def deliver(job):
    marker=job/'protocol.json'
    if marker.exists() and json.loads(marker.read_text()).get('state')=='delivered':
        return json.loads(marker.read_text())
    request=json.loads((job/'request.json').read_text())
    if request.get('kind')=='gpu':
        from gpu_jobs import deliver as gpu_deliver
        return gpu_deliver(job)
    receipt=json.loads((job/'receipt.json').read_text())
    if json.loads((job/'status.json').read_text())['state']!='complete':
        raise RuntimeError('Cannot deliver an incomplete render')
    if farm.context_loss_logs(job):
        raise RuntimeError('Cannot deliver WebGL context-loss output; retain for repair')
    scene=receipt['scene'];out=job/'out';master=out/(scene+'.mp4');share=out/(scene+'_share.mp4')
    if farm.file_sha256(master)!=receipt['output_sha256']:
        raise RuntimeError('Master changed after validation')
    from archive import make_share
    share=make_share(job,receipt)
    sheet=out/(scene+'_sheet.jpg');shutil.copyfile(out/'contact-sheet.jpg',sheet)
    identifier=request.get('protocol_id')
    if not identifier:
        closer=receipt['bounds'].get('closer_beat')
        recipe=(f'sh videos/scripts/local_render.sh --seg {scene}:{closer:g}' if closer else
                f'node videos/web/render.mjs {scene} --to {receipt["seconds"]}')
        identifier=command('post','--title',f'Homelab completed build: {scene} ({receipt["commit"][:7]})',
            '--piece',scene,'--by',farm.CONFIG['protocol_worker'],'--commit',receipt['commit'],
            '--run',recipe,'--out',f'videos/out/farm/{scene}.mp4','--out',f'videos/out/farm/{scene}_share.mp4',
            '--dependencies',json.dumps(request.get('dependencies',{})),
            '--notes','Registration of an already-completed, validated local render. '
            'The exact rendered span and GPU adapter hashes are in receipt.json; no additional render is requested.').splitlines()[-1]
        command('claim',identifier,'--by',farm.CONFIG['protocol_worker'],
                '--lease',str(farm.CONFIG['protocol_lease_hours']))
        request['protocol_id']=identifier;farm.write(job/'request.json',request)
    paths=[master,share,sheet,job/'receipt.json',*sorted(out.glob('*.finish.json')),
           *sorted(out.glob('homelab-*-renderer.json'))]
    manifest=job/'dependencies.json'
    if manifest.exists(): paths.append(manifest)
    patch=job/'harness/audio-report-adapter.patch'
    if patch.exists() and patch.stat().st_size:
        paths.append(patch)
    outputs=request.get('protocol_spec',{}).get('outputs',[])
    available={p.name for p in paths}
    if any(pathlib.PurePosixPath(name).name not in available for name in outputs):
        raise RuntimeError('Requested output is not produced by this scene renderer: '+str(outputs))
    note=(f'Homelab job {job.name}; source {receipt["commit"]}; {receipt["frames"]} frames at 30 fps; '
          'GPU0/GPU1 only. Full decode, frame counts, measured AAC and seam checks recorded in receipt.json. '
          'Source mix guidance is preserved; the studio owns numbered-version publication.')
    remote=json.loads(command('show',identifier))
    if remote['state']!='done':
        command('deliver',identifier,'--by',farm.CONFIG['protocol_worker'],*paths,'--note',note)
    remote=json.loads(command('show',identifier))
    if remote['state']!='done' or remote['delivery']['by']!=farm.CONFIG['protocol_worker']:
        raise RuntimeError('Pipeline queue did not confirm delivery')
    entry=next(f for f in remote['delivery']['files'] if f['name']==master.name)
    if entry['sha256']!=receipt['output_sha256']:
        raise RuntimeError('Delivered master hash differs from validated master')
    result={'state':'delivered','protocol_id':identifier,'archive_dir':remote['delivery']['archive_dir'],
            'pipeline_job':remote,'verified':farm.now(),
            'url':'https://github.com/flip-engineer/automated-content-pipeline-video-studies-archive/tree/main/farm/'+identifier}
    farm.write(marker,result)
    return result
