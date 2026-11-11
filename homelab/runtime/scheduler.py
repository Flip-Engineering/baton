"""Prepare jobs, allocate GPU worker slots, and deliver completed render outputs."""
import concurrent.futures, json, time
from collections import deque, Counter
import farm
import gpu_allocation
import repair_queue
import admission_policy
from protocol_bridge import Lease, acquire, deliver, failed, command

def reserved_ram(rendering):
    """Reserve running headroom above MemAvailable plus external reservations."""
    return sum(gpu_allocation.reserved_memory(job,'running') for job in rendering)+gpu_allocation.external_reserved()


def preparation_buffer_usage(jobs):
    """Count prepared jobs with a usable memory reservation against the lookahead buffer."""
    return sum(gpu_allocation.memory_required(job) is not None for job in jobs)


def work():
    from script_guard_upgrade import upgrade_pending
    upgrade_pending()
    repair_queue.inventory()
    if farm.CONFIG.get('retire_duplicate_prepared', True):
        from claim_reconciliation import retire_prepared_duplicates
        try:
            with gpu_allocation.admission_guard():
                retirement=retire_prepared_duplicates(
                    farm.CONFIG.get('coordinator_root',farm.JOBS.parent),apply=True,
                    min_age_seconds=farm.CONFIG.get('duplicate_prepared_min_age_seconds',300))
            if retirement.get('retired'):
                print('Retired duplicate prepared copies: '+json.dumps(retirement['retired'],sort_keys=True),flush=True)
        except Exception as error:
            print('Duplicate prepared retirement failed: '+str(error),flush=True)
    preparing=delivering=None
    rendering={}
    ready_delivery=deque()
    leases={}
    inspection_failures=[]
    next_poll=0
    next_repair=0
    last_unavailable=None
    reported_admission_holds={}
    def lease(job):
        if job not in leases:
            request=json.loads((job/'request.json').read_text())
            state=json.loads((job/'status.json').read_text()).get('state')
            if request.get('protocol_id') and state in ('prepared','pictured'):
                # A resumed checkpoint may have outlived its upstream lease.
                command('touch',request['protocol_id'],'--by',farm.CONFIG['protocol_worker'],
                        '--lease',str(farm.CONFIG['protocol_lease_hours']),
                        '--note','Homelab resuming its durable stage checkpoint')
            leases[job]=Lease(request.get('protocol_id'));leases[job].start()
    def close(job):
        value=leases.pop(job,None)
        if value:value.close()
    def failure(job,error):
        print(f'Job {job.name} failed: {error}',flush=True)
        inspect=farm.failure_requires_inspection(job)
        repair_queue.record(job,error, json.loads((job/'status.json').read_text()).get('phase','unknown'),inspect)
        if farm.CONFIG.get('protocol_enabled') and not inspect:
            try:failed(job,error)
            except Exception as checkin:print('Failed to check job failure in: '+str(checkin),flush=True)
        close(job)
        if inspect:
            inspection_failures.append(job.name)
            if farm.CONFIG.get('protocol_enabled'):
                path=job/'protocol.json'
                pending=json.loads(path.read_text()) if path.exists() else {}
                pending.update(state='waiting_for_recovery',error=str(error),updated=farm.now())
                farm.write(path,pending)
            print('Dispatch paused: inspect GPU-stage failure before restarting',flush=True)
            farm.STOP.set()
        else:print('Job input/preparation failure checked in; continuing queue',flush=True)
    def delivery(job):
        if json.loads((job/'status.json').read_text()).get('state')!='complete':
            farm.finish(job)
        if farm.CONFIG.get('protocol_enabled'):
            farm.write(job/'protocol.json',{'state':'delivering','started':farm.now()})
            try:deliver(job)
            except Exception as error:
                farm.write(job/'protocol.json',{'state':'delivery_failed','error':str(error),'finished':farm.now()})
                repair_queue.record(job,error,'delivery')
                raise
        if farm.CONFIG.get('archive_outputs'):
            from archive import publish
            publish(job)
        repair_queue.resolve(job)
    def render(job,gpus):
        request=json.loads((job/'request.json').read_text())
        try:
            return farm.picture(job,**({'gpus':gpus} if request.get('kind')=='gpu' else {}))
        except Exception:
            if farm.failure_requires_inspection(job):
                farm.STOP.set()
            raise
    def available(state):
        owned=set(rendering) | set(ready_delivery)
        owned.update(slot[0] for slot in (preparing,delivering) if slot)
        for job in sorted(farm.JOBS.iterdir()):
            p=job/'status.json'
            if job not in owned and p.exists() and json.loads(p.read_text()).get('state')==state and (state not in ('pictured','complete') or repair_queue.delivery_ready(job)):
                yield job
    capacity=sum(gpu_allocation.slot_limits().values())
    if not capacity:
        raise ValueError('No GPUs configured')
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as prep_pool, \
         concurrent.futures.ThreadPoolExecutor(max_workers=capacity) as gpu_pool, \
         concurrent.futures.ThreadPoolExecutor(max_workers=1) as delivery_pool:
        try:
            while not farm.STOP.is_set() or preparing or rendering or delivering or ready_delivery:
                changed=False
                if delivering and delivering[1].done():
                    job,future=delivering
                    try:future.result()
                    except Exception as error:
                        if json.loads((job/'status.json').read_text()).get('state')=='failed':
                            failure(job,error)
                        else:print(f'Pipeline delivery failed for {job.name}: {error}',flush=True)
                    close(job);delivering=None;changed=True
                # Observe all completed failures before admitting another job.
                for job,(future,gpus) in list(rendering.items()):
                    if future.done():
                        try:future.result()
                        except Exception as error:failure(job,error)
                        else:ready_delivery.append(job)
                        del rendering[job];changed=True
                if preparing and preparing[1].done():
                    job,future=preparing
                    try:future.result()
                    except Exception as error:
                        failure(job,error);preparing=None;changed=True
                    else:
                        if farm.STOP.is_set():
                            close(job);preparing=None;changed=True
                        else:
                            preparing=None;changed=True
                if not delivering:
                    job=ready_delivery.popleft() if ready_delivery else next(available('pictured'),None)
                    if not job and farm.CONFIG.get('protocol_enabled'):
                        for completed in available('complete'):
                            request=json.loads((completed/'request.json').read_text())
                            protocol=completed/'protocol.json'
                            state=json.loads(protocol.read_text()).get('state') if protocol.exists() else None
                            if request.get('protocol_id') and state!='delivered':
                                job=completed
                                break
                    if job:
                        lease(job);delivering=(job,delivery_pool.submit(delivery,job));changed=True
                if not farm.STOP.is_set():
                    if time.monotonic()>=next_repair:
                        next_repair=time.monotonic()+farm.CONFIG['protocol_poll_seconds']
                        repair_queue.resume_requests(set(rendering) | set(ready_delivery) | {slot[0] for slot in (preparing,delivering) if slot})
                    unavailable=gpu_allocation.unavailable()
                    if unavailable != last_unavailable:
                        print('GPU admission status: '+json.dumps(unavailable,sort_keys=True),flush=True)
                        last_unavailable=unavailable
                    with gpu_allocation.admission_guard():
                        occupied=Counter()
                        for running,(_,cards) in rendering.items():occupied.update(gpu_allocation.slot_costs(running,cards))
                        available_ram=gpu_allocation.memory_available()
                        # MemAvailable already includes resident usage, so running
                        # jobs reserve only their declared budget above cgroup usage.
                        reserved_ram_value=reserved_ram(rendering)
                        admission_holds={}
                        def report_hold(job,reason):
                            admission_holds[job.name]=reason
                            if reported_admission_holds.get(job.name)!=reason:
                                print('GPU admission hold: '+json.dumps({'job':job.name,'reason':reason},sort_keys=True),flush=True)
                                reported_admission_holds[job.name]=reason
                        admissions=admission_policy.plan(list(available('prepared')),occupied,unavailable,available_ram,reserved_ram_value,on_hold=report_hold)
                        for held_job in sorted(set(reported_admission_holds)-set(admission_holds)):
                            print('GPU admission hold cleared: '+json.dumps({'job':held_job,'reason':reported_admission_holds.pop(held_job)},sort_keys=True),flush=True)
                        for job,gpus,required_ram in admissions:
                            if farm.STOP.is_set() or any(future.done() for future,_ in rendering.values()):
                                break
                            lease(job)
                            farm.write(job/'allocation.json',{'gpus':gpus,'dispatched':farm.now(),
                                       'admission_policy':'submission_order_with_resource_reservation'})
                            gpu_allocation.reserve(job,required_ram)
                            rendering[job]=(gpu_pool.submit(render,job,gpus),gpus)
                            changed=True
                            print('GPU allocation '+job.name+': '+','.join(g['uuid'] for g in gpus),flush=True)
                    if not preparing:
                        # Unknown-budget jobs stay held without blocking queue intake.
                        prepared_jobs=list(available('prepared'))
                        if preparation_buffer_usage(prepared_jobs)<capacity:
                            job=next(available('queued'),None)
                            if not job and farm.CONFIG.get('protocol_enabled') and time.monotonic()>=next_poll:
                                next_poll=time.monotonic()+farm.CONFIG['protocol_poll_seconds']
                                try:job=acquire()
                                except Exception as error:print('Pipeline poll failed: '+str(error),flush=True)
                            if job:
                                lease(job);preparing=(job,prep_pool.submit(farm.prepare,job));changed=True
                if not changed:
                    # Future completion wakes up through short configurable polling;
                    # STOP does not busy-spin while active stages finish naturally.
                    time.sleep(farm.CONFIG.get('stage_poll_seconds',1))
        finally:
            for job in list(leases):close(job)

    if inspection_failures:
        print('Dispatch requires inspection: '+', '.join(inspection_failures),flush=True)
        raise SystemExit(78)
