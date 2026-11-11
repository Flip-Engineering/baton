"""Resume durable render stages after a clean boot and retain earlier attempts."""
import json
from pathlib import Path
import re
import subprocess
import time
import uuid
import farm


def validate_prepared(job):
    context=json.loads((job/'prepared.json').read_text())
    request=json.loads((job/'request.json').read_text())
    if context['request']!=request or context['commit']!=request['commit']:
        raise ValueError('Prepared request changed')
    if farm.run(['git','rev-parse','HEAD'],cwd=job/'repo')!=context['commit']:
        raise ValueError('Prepared revision changed')
    expected=context.get('dependencies_manifest_sha256')
    if expected and farm.file_sha256(job/'dependencies.json')!=expected:
        raise ValueError('Prepared dependency manifest changed')
    if request.get('kind')=='gpu':
        inputs={job/'repo'/name:sha for name,sha in context['inputs'].items()}
    else:
        scene=context['scene']
        inputs={job/'repo/videos/web/render.farm.mjs':context['renderer_adapted_sha256'],
                job/'out'/f'.{scene}.wav':context['wav_sha256'],
                job/'out'/f'.{scene}.hits.json':context['hits_sha256']}
        inputs.update({job/'out'/name:sha for name,sha in context.get('capture_helpers',{}).items()})
    for path,sha in inputs.items():
        if path.is_symlink() or farm.file_sha256(path)!=sha:
            raise ValueError('Prepared input changed: '+str(path))
    return context


def completed_picture(job,context):
    if (job/'pictured.json').exists():
        pictured=json.loads((job/'pictured.json').read_text())
        if pictured['commit']!=context['commit'] or pictured['request']!=context['request']:
            raise ValueError('Picture checkpoint changed')
        for name,sha in pictured.get('deliver_hashes',{}).items():
            path=Path(pictured['deliver'])/name
            if path.is_symlink() or farm.file_sha256(path)!=sha:
                raise ValueError('Picture output changed: '+name)
        return True
    if context['request'].get('kind')!='gpu':
        return False
    identifier=context['request'].get('protocol_id',job.name)
    path=job/'out/gpu'/identifier/'deliver/receipt.json'
    if not path.exists():
        return False
    try:
        receipt=json.loads(path.read_text())
    except (json.JSONDecodeError, UnicodeDecodeError):
        print('Incomplete helper receipt retained with the interrupted attempt: '+str(path),flush=True)
        return False
    if receipt.get('status')!='ok':
        return False
    from gpu_jobs import save_picture
    allocation=job/'allocation.json'
    cards=json.loads(allocation.read_text())['gpus'] if allocation.exists() else context.get(
        'allocated_gpus',farm.CONFIG.get('gpu_job_gpus',farm.CONFIG['gpus'])[:context['request']['gpu_count']])
    save_picture(job,context,{g['uuid'] for g in cards},receipt.get('seconds',{}).get('run',0))
    return True


def move(source,target):
    if source.exists():
        if target.exists():
            if source.is_dir() and not any(source.iterdir()):return
            raise ValueError('Recovery destination already contains data: '+str(target))
        target.parent.mkdir(parents=True,exist_ok=True)
        source.rename(target)
        farm.sync_directory(source.parent)
        farm.sync_directory(target.parent)


def restore(job,status):
    """Finish a recorded recovery transaction, including after a second power loss."""
    if status.get('state')=='recovering':
        attempt=job/'attempts'/status['recovery_attempt']
        original=json.loads((attempt/'status.json').read_text())
        target=status['resume_state']
        context=validate_prepared(job) if target!='queued' else None
        if target=='pictured' and not completed_picture(job,context):
            raise ValueError('Completed picture checkpoint is missing')
        retry_plan=None
        if target=='prepared' and context and (job/'range-retry.json').is_file():
            from range_retry import load_plan
            retry_plan=load_plan(job,context)
    else:
        context=validate_prepared(job) if (job/'prepared.json').exists() else None
        target='pictured' if context and completed_picture(job,context) else 'prepared' if context else 'queued'
        original=status
        attempt=job/'attempts'/uuid.uuid4().hex
        retry_plan=None
        if target=='prepared' and context:
            from range_retry import begin_or_update, eligible, load_plan, MAX_EXPLICIT_RETRIES
            if eligible(job,status,context):
                existing=load_plan(job,context)
                if existing and existing['retry_count']>=MAX_EXPLICIT_RETRIES:
                    raise ValueError('Scene range retry limit reached; outputs retained for inspection')
                attempt.mkdir(parents=True)
                retry_plan=begin_or_update(job,status,context,attempt)
        if not attempt.exists():
            attempt.mkdir(parents=True)
        farm.write(attempt/'status.json',original)
        recovering=dict(original,state='recovering',recovery_attempt=attempt.name,
                        resume_state=target,recovery_boot_id=farm.boot_id())
        if retry_plan:
            recovering['range_retry_plan']='range-retry.json'
        farm.write(job/'status.json',recovering)
    move(job/'logs',attempt/'logs')
    (job/'logs').mkdir(exist_ok=True)
    if target=='queued':
        for name in ('repo','out','tmp','harness','dependencies.json','prepared.json','pictured.json',
                     'receipt.json','allocation.json','range-retry.json'):
            move(job/name,attempt/name)
    elif target=='prepared':
        if context['request'].get('kind')=='gpu':
            identifier=context['request'].get('protocol_id',job.name)
            move(job/'out/gpu'/identifier,attempt/'gpu-output')
            move(job/'repo/videos/web/node_modules',attempt/'runtime-node-modules')
        else:
            if retry_plan:
                from range_retry import archive_unvalidated
                archive_unvalidated(job,context,attempt,retry_plan)
            else:
                for item in context['ranges']:
                    name=item['gpu']['label']+'.mp4'
                    move(job/'out'/name,attempt/'partial-picture'/name)
            for report in (job/'out').glob('homelab-*-scene-failure.json'):
                move(report,attempt/'diagnostics'/report.name)
    finished=dict(original,state=target,phase='ready_to_finish' if target=='pictured' else 'ready' if target=='prepared' else 'waiting',
                  recovered_at=farm.now(),recovery_boot_id=farm.boot_id(),previous_attempt=str(attempt))
    if retry_plan:
        finished['range_retry_plan']='range-retry.json'
        finished['range_retry_count']=retry_plan['retry_count']
    if context:
        finished.setdefault('started',original.get('render_started',farm.now()))
        finished.setdefault('prepared',farm.now())
    finished.pop('error',None);finished.pop('failure_kind',None)
    farm.sync_storage(job)
    farm.write(job/'status.json',finished)
    farm.write(attempt/'recovery.json',dict(resumed_as=target,job_id=job.name,boot_id=farm.boot_id(),finished=farm.now()))
    print('Recovered '+job.name+' as '+target+'; prior attempt '+str(attempt),flush=True)


def recover(include_running=True):
    candidates=[]
    boot=farm.boot_id()
    uptime=Path('/proc/uptime')
    boot_started=time.time()-float(uptime.read_text().split()[0]) if uptime.exists() else time.time()
    for job in sorted(farm.JOBS.iterdir()):
        path=job/'status.json'
        request=job/'request.json'
        if not path.is_file():
            if not request.is_file():continue
            status=dict(state='interrupted',error='Durable request has no stage status',
                        previous_boot_inferred=request.stat().st_mtime<boot_started)
            farm.write(path,status)
        else:
            try:status=json.loads(path.read_text())
            except (OSError,ValueError) as error:
                print('Recovery held for '+job.name+': stage status could not be read: '+str(error),flush=True)
                continue
        state=status.get('state')
        if state=='running' and not include_running:continue
        hardware_failure=state=='failed' and status.get('failure_kind')!='job_input' and re.search(
            r'GPU kernel|GPU health|Xid|fallen off|Surprise Down',status.get('error',''),re.I)
        retry_failure=False
        if state=='failed' and (job/'prepared.json').is_file():
            try:
                from range_retry import eligible
                retry_context=json.loads((job/'prepared.json').read_text())
                retry_failure=eligible(job,status,retry_context)
            except (OSError,ValueError,TypeError,KeyError):
                retry_failure=False
        if state not in ('running','interrupted','recovering') and not hardware_failure and not retry_failure:
            continue
        old_boot=status.get('execution_boot_id')
        prior_boot=old_boot!=boot if old_boot else status.get('previous_boot_inferred',False) or path.stat().st_mtime<boot_started
        if not old_boot and state=='interrupted' and status.get('error','').startswith('Worker exited before completing'):
            origin=job/'prepared.json' if (job/'prepared.json').exists() else request
            prior_boot=prior_boot or (origin.exists() and origin.stat().st_mtime<boot_started)
        if state=='recovering':prior_boot=True
        if prior_boot or retry_failure:
            candidates.append((job,status,retry_failure))
    if not candidates and not farm.CONFIG.get('gpu_activity_directory'):return
    kernel=subprocess.run(['journalctl','-k','-b','--no-pager'],
                          text=True,capture_output=True)
    if kernel.returncode or re.search(r'NVRM: Xid|fallen off|Surprise Down',kernel.stdout,re.I):
        farm.STOP.set()
        print('Recovery held: current boot GPU kernel check failed',flush=True)
        return False
    if not candidates:return
    containers=farm.run(['docker','ps','--format','{{.Names}}']).splitlines()
    for job,status,retry_failure in candidates:
        if any(name.startswith('acp-'+job.name+'-') for name in containers):
            print('Recovery held: live container owns '+job.name,flush=True)
            continue
        if status.get('state')=='running':
            status=dict(status,state='interrupted',error='Worker exited before completing; durable checkpoint retained',
                        previous_boot_inferred=True)
            farm.write(job/'status.json',status)
        try:
            request=json.loads((job/'request.json').read_text())
            identifier=request.get('protocol_id')
            if identifier and farm.CONFIG.get('protocol_enabled'):
                from protocol_bridge import command
                remote=json.loads(command('show',identifier))
                if remote['state']=='failed' and retry_failure:
                    from protocol.farm_dependencies import normalize
                    from range_retry import load_plan, MAX_EXPLICIT_RETRIES
                    spec=request.get('protocol_spec') or {}
                    if (remote.get('pipeline_commit')!=request.get('commit') or
                            remote.get('run')!=spec.get('run') or
                            remote.get('outputs',[])!=spec.get('outputs',[]) or
                            normalize(remote.get('dependencies'))!=normalize(request.get('dependencies')) or
                            (remote.get('delivery') or {}).get('by')!=farm.CONFIG['protocol_worker']):
                        raise ValueError('Failed canonical job does not match the retained retry pins or owner')
                    context=validate_prepared(job)
                    existing=load_plan(job,context)
                    if existing and existing['retry_count']>=MAX_EXPLICIT_RETRIES:
                        raise ValueError('Scene range retry limit reached; outputs retained for inspection')
                    args=['repair',identifier,'--by',farm.CONFIG['protocol_worker'],
                          '--commit',request['commit'],'--note',
                          'Resume validated ranges after retained WebGL context-loss recovery',
                          '--dependencies',json.dumps(request.get('dependencies',{}))]
                    for run in spec.get('run',[]):args.extend(['--run',run])
                    for output in spec.get('outputs',[]):args.extend(['--out',output])
                    command(*args)
                    remote=json.loads(command('show',identifier))
                if remote['state'] in ('done','failed'):
                    farm.write(job/'status.json',dict(status,state='remote_complete' if remote['state']=='done' else 'recovery_held',
                               canonical_state=remote['state'],recovery_note='Canonical queue is terminal; local request and checkpoints retained'))
                    print('Recovery retained '+identifier+'; canonical state '+remote['state'],flush=True)
                    continue
                if remote['state']=='open':
                    command('claim',identifier,'--by',farm.CONFIG['protocol_worker'],
                            '--lease',str(farm.CONFIG['protocol_lease_hours']))
                elif remote.get('claim',{}).get('by')!=farm.CONFIG['protocol_worker']:
                    farm.write(job/'status.json',dict(status,recovery_error='Canonical lease belongs to another worker'))
                    print('Recovery held: canonical lease belongs to another worker for '+identifier,flush=True)
                    continue
            restore(job,status)
        except Exception as error:
            current=json.loads((job/'status.json').read_text())
            farm.write(job/'status.json',dict(current,recovery_error=str(error)))
            print('Recovery held for '+job.name+': '+str(error),flush=True)
