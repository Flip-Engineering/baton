"""Durable failure records and operator-requested checkpoint resumption."""
import argparse, datetime, json, pathlib, re
import farm


def record(job, error, stage, inspection=False):
    path=job/'repair.json'
    ticket=json.loads(path.read_text()) if path.exists() else {'job':job.name,'events':[]}
    status=json.loads((job/'status.json').read_text())
    ticket['events'].append({'at':farm.now(),'stage':stage,'error':str(error),'status':status})
    ticket.update(state='hardware_held' if inspection else 'needs_repair',stage=stage,
                  updated=farm.now(),request=str(job/'request.json'),checkpoints=[n for n in
                  ('prepared.json','pictured.json','receipt.json') if (job/n).exists()])
    if stage=='delivery' and not inspection:
        ticket['state']='retry_scheduled'
        delay=farm.CONFIG['protocol_poll_seconds']
        ticket['retry_after']=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(seconds=delay)).isoformat()
    farm.write(path,ticket)
    return ticket


def delivery_ready(job):
    p=job/'repair.json'
    if not p.exists():return True
    t=json.loads(p.read_text())
    deadline=t.get('retry_after') if t.get('stage')=='delivery' else None
    return not deadline or datetime.datetime.now(datetime.timezone.utc)>=datetime.datetime.fromisoformat(deadline)


def resolve(job):
    p=job/'repair.json'
    if p.exists():
        t=json.loads(p.read_text());t.update(state='resolved',resolved=farm.now());t.pop('retry_after',None)
        farm.write(p,t)


def inventory():
    for job in sorted(farm.JOBS.iterdir()):
        p=job/'status.json'
        if not p.exists():continue
        try:s=json.loads(p.read_text())
        except (OSError,ValueError):continue
        protocol=job/'protocol.json'
        try:d=json.loads(protocol.read_text()) if protocol.exists() else {}
        except (OSError,ValueError):d={}
        if not (job/'repair.json').exists():
            if s.get('state') in ('failed','recovery_held','interrupted'):
                record(job,s.get('error',s.get('recovery_note','Interrupted job')),
                       s.get('phase','unknown'),farm.failure_requires_inspection(job))
            elif d.get('state')=='delivery_failed':record(job,d.get('error','Delivery failed'),'delivery')


def request_resume(job,reason,reprepare=False):
    s=json.loads((job/'status.json').read_text())
    if s.get('state') not in ('failed','recovery_held','interrupted'):
        raise ValueError('Only a retained failed/interrupted job may be resumed')
    ticket=job/'repair.json'
    if not ticket.exists():record(job,s.get('error','Retained job'),s.get('phase','unknown'),farm.failure_requires_inspection(job))
    t=json.loads(ticket.read_text())
    t.update(state='resume_requested',repair_reason=reason,reprepare=reprepare,requested=farm.now())
    farm.write(ticket,t)


def resume_requests(owned):
    from recovery import restore
    from protocol_bridge import command
    import subprocess
    requests=[]
    for job in sorted(farm.JOBS.iterdir()):
        p=job/'repair.json'
        if job in owned or not p.exists():continue
        t=json.loads(p.read_text())
        if t.get('state')=='resume_requested':requests.append((job,t))
    if not requests:return
    kernel=subprocess.run(['journalctl','-k','-b','--no-pager'],capture_output=True,text=True)
    if kernel.returncode or re.search(r'NVRM: Xid|fallen off|Surprise Down',kernel.stdout,re.I):return
    containers=farm.run(['docker','ps','--format','{{.Names}}']).splitlines()
    for job,t in requests:
        try:
            if any(n.startswith('acp-'+job.name+'-') for n in containers):continue
            s=json.loads((job/'status.json').read_text());request=json.loads((job/'request.json').read_text())
            if s.get('state') not in ('failed','recovery_held','interrupted','recovering'):
                raise ValueError('Job is no longer awaiting repair')
            identifier=request.get('protocol_id')
            if identifier and farm.CONFIG.get('protocol_enabled'):
                remote=json.loads(command('show',identifier))
                if remote['state']=='done':raise ValueError('Canonical job is already delivered')
                if remote['pipeline_commit']!=request['commit'] or remote['run']!=request['protocol_spec']['run']:
                    raise ValueError('Canonical pinned recipe changed; retained checkpoint cannot resume')
                if remote['state']=='failed':
                    args=['repair',identifier,'--by',farm.CONFIG['protocol_worker'],'--commit',request['commit'],'--note',t['repair_reason'],'--dependencies',json.dumps(request.get('dependencies',{}))]
                    for run in request['protocol_spec']['run']:args.extend(['--run',run])
                    for output in request['protocol_spec'].get('outputs',[]):args.extend(['--out',output])
                    command(*args)
                    remote=json.loads(command('show',identifier))
                if remote['state']=='open':command('claim',identifier,'--by',farm.CONFIG['protocol_worker'],'--lease',str(farm.CONFIG['protocol_lease_hours']))
                elif remote.get('claim',{}).get('by')!=farm.CONFIG['protocol_worker']:
                    raise ValueError('Canonical job belongs to another worker')
            if t.get('reprepare') and s.get('state')!='recovering':
                import uuid
                attempt=job/'attempts'/uuid.uuid4().hex;attempt.mkdir(parents=True)
                farm.write(attempt/'status.json',s)
                farm.write(job/'status.json',dict(s,state='recovering',recovery_attempt=attempt.name,resume_state='queued'))
                s=json.loads((job/'status.json').read_text())
            restore(job,s)
            from script_guard_upgrade import upgrade, upgrade_webgl
            try:
                upgrade(job); upgrade_webgl(job)
            except Exception as error:
                status=json.loads((job/'status.json').read_text())
                status.update(state='failed',phase='preparing',failure_kind='job_input',error=str(error))
                farm.write(job/'status.json',status)
                t.update(state='needs_repair')
                raise
            marker=job/'protocol.json'
            if marker.exists():
                previous=json.loads(marker.read_text())
                status=json.loads((job/'status.json').read_text())
                attempt=status.get('previous_attempt')
                if attempt:farm.write(pathlib.Path(attempt)/'protocol.json',previous)
                farm.write(marker,dict(state='resumed',checkpoint=status['state'],resumed=farm.now(),
                                       protocol_id=identifier,previous_state=previous.get('state')))
            t.update(state='resumed',resumed=farm.now());t.pop('resume_error',None)
        except Exception as error:t.update(resume_error=str(error),checked=farm.now())
        farm.write(job/'repair.json',t)


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('action',choices=['inventory','list','resume'])
    ap.add_argument('job',nargs='?');ap.add_argument('--reason');ap.add_argument('--reprepare',action='store_true')
    a=ap.parse_args()
    if a.action=='inventory':inventory()
    elif a.action=='resume':
        if not a.job or not re.fullmatch(r'[A-Za-z0-9_-]+',a.job) or not a.reason:ap.error('resume requires job and --reason describing the repair')
        request_resume(farm.JOBS/a.job,a.reason,a.reprepare)
    else:
        for p in sorted(farm.JOBS.glob('*/repair.json')):
            t=json.loads(p.read_text())
            if t.get('state')!='resolved':print(json.dumps(t))

if __name__=='__main__':main()
