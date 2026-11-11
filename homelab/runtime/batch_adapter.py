"""Collect qualified person shots into one Blender process with durable results."""
import ast
import hashlib
from pathlib import Path

VERSION='person-pristine-scene-batch-v1'
QUALIFIED={'acp_display.py': '19fdd54b796830a379fa2c3d0ff93968a7b47540e0285bd18eb6f7f40ae807ec', 'camera7_display.py': '17b4ca3f2907846178533453eb460a4244c43f1850f59500d746586831c5f3e4', 'camera7_stage.py': 'b75f4388196e87d7e371d25922d7ec4163abcf9efbdfb4a366e225c09212fcc5', 'cover8.py': '7fb83a3ab2e628a7712570be6b4ce647a9df27047b7e157d0801b7a91eaefad6', 'eye7_cycles.py': '1e5859f1811ec2bb02bc210795675c72ffee902074bc47b2491479ecf60cdbab', 'fabric7_cycles.py': '3f77d870346f63fd882349e6d44d9f3565eae59b7511f9bf1327543f7da6b433', 'fabric7_tiles.py': '7bd039da62e3aa13bf92199d22a5f5b461bc809e6359fc6606fc6dcdebd94529', 'hairmat7.py': '4d7f1a1edf43b603a522725087b0d1259e27bb1dba17820a81eaa2530282eb9a', 'light5.py': '3764d4a44d9db6f0b97bc9db6f852319eb7580d7979004f615004b906ff3da1a', 'person_guard.py': 'be85616611ed03e468ec9d599f74de38012a510aeccccc93b58487bb548d2965', 'person_hair.py': 'eeb5278b6efe627e8bbfdeeaf82c2076455e7b6571542a2918af7b1f2ec089de', 'person_io.py': 'af998217a758473813f9ffe67e8a324a2eacac55363c79020754aeb63132539d', 'person_scene.py': '696eb662fe5039118a73221fa462e323dd54284ec0ff95ad8b0ef6367449d223', 'render_person.py': '715ee9d2efe0c0d7f62780c9a6671422bbdc4dca124659edc75eb12a4c7c55cb', 'stage_scene.py': 'f3775c0b21d38e8b9ab5bdcc1cdae39f68ff6c3cfed9b168b6fa737efc8743b0'}

HELPER=r"""
farm_batch_original_run=run
farm_batch_commands=[]
def farm_batch_run(cmd,cwd=VIDEOS,fatal=True,tag=None,env=None):
    if not DRY and any(os.path.basename(str(v))=='render_person.py' for v in cmd):
        farm_batch_commands.append(dict(command=list(cmd),cwd=cwd,fatal=fatal,tag=tag,env=env))
        return
    return farm_batch_original_run(cmd,cwd=cwd,fatal=fatal,tag=tag,env=env)
run=farm_batch_run

def farm_batch_flush():
    import hashlib,math,pathlib,tempfile
    if not farm_batch_commands:
        return
    prefixes=[tuple(item['command'][:item['command'].index('--')])for item in farm_batch_commands]
    if any(prefix!=prefixes[0]for prefix in prefixes[1:]):
        for item in farm_batch_commands:
            farm_batch_original_run(item['command'],cwd=item['cwd'],fatal=item['fatal'],tag=item['tag'],env=item['env'])
        return
    def build_key(item):
        command=item['command']
        def opt(name,default=None):
            flag='--'+name
            return command[command.index(flag)+1] if flag in command else default
        export=opt('export')
        return (export,opt('maps',os.path.join(export,'maps')),opt('light','over'),opt('register'),
                opt('hair','1.0'),opt('sss'),(opt('stage') or opt('light') or 'studio').split('@')[0],
                json.dumps(item.get('env') or {},sort_keys=True))
    keys=[build_key(item) for item in farm_batch_commands]
    reusable=any(left==right for left,right in zip(keys,keys[1:]))
    if not reusable:
        for item in farm_batch_commands:
            farm_batch_original_run(item['command'],cwd=item['cwd'],fatal=item['fatal'],tag=item['tag'],env=item['env'])
        return
    for name,expected in FARM_BATCH_QUALIFIED.items():
        path=pathlib.Path(HERE)/name
        if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest()!=expected:
            print('person_job: batch source requires qualification: '+name,flush=True)
            for item in farm_batch_commands:
                farm_batch_original_run(item['command'],cwd=item['cwd'],fatal=item['fatal'],tag=item['tag'],env=item['env'])
            return
    directory=pathlib.Path(tempfile.mkdtemp(prefix='.farm-blender-batch-',dir=WORK))
    (directory/'scene_cache.py').write_text(FARM_BATCH_CACHE_SOURCE)
    (directory/'batch_runner.py').write_text(FARM_BATCH_RUNNER_SOURCE)
    commands=[dict(item,command=farm_scene_command(item['command'])) if 'farm_scene_command' in globals() else item for item in farm_batch_commands]
    identity=hashlib.sha256(json.dumps(dict(commands=commands,qualified=FARM_BATCH_QUALIFIED),sort_keys=True).encode()).hexdigest()
    request=dict(commands=commands,qualified=FARM_BATCH_QUALIFIED,result=str(directory/'result.json'),request_id=identity)
    manifest=directory/'request.json';manifest.write_text(json.dumps(request))
    command=[farm_batch_commands[0]['command'][0],'-b','--factory-startup','-noaudio','--python-exit-code','1',
             '--python',str(directory/'batch_runner.py'),'--',str(manifest)]
    print('person_job: batching '+str(len(farm_batch_commands))+' qualified shots',flush=True)
    execute=globals().get('farm_resource_run',subprocess.run)
    try:
        result=execute(command,cwd=VIDEOS)
        process_code=result.returncode
    except (OSError,subprocess.SubprocessError) as error:
        process_code=1
        print('person_job: batch process failed: '+repr(error),flush=True)
    report=dict(records=[],cache_events=[])
    receipt_error=None
    try:
        report=json.loads((directory/'result.json').read_text())
        if not isinstance(report,dict) or report.get('request_id')!=identity:
            raise ValueError('Batch receipt request identity changed')
        records=report.get('records')
        if not isinstance(records,list) or len(records)>len(farm_batch_commands):
            raise ValueError('Batch receipt is not a bounded prefix')
        for index,record in enumerate(records):
            if (not isinstance(record,dict) or type(record.get('index'))is not int
                    or record['index']!=index or type(record.get('exit_code'))is not int
                    or record.get('tag')!=farm_batch_commands[index]['tag']
                    or type(record.get('seconds'))not in (int,float)
                    or not math.isfinite(record['seconds']) or record['seconds']<0):
                raise ValueError('Batch receipt contains an invalid shot record')
    except (OSError,ValueError,TypeError) as error:
        receipt_error=repr(error)
        report=dict(records=[],cache_events=[])
        print('person_job: batch receipt requires fresh renders: '+receipt_error,flush=True)
    completed={r['index']:r for r in report['records']}
    if process_code or receipt_error:
        log.append(dict(tag='farm_blender_batch_process',code=process_code or 1,
                        farm_batch=FARM_BATCH_VERSION,receipt_error=receipt_error,recovery='fresh processes for unfinished shots'))
    for index,item in enumerate(farm_batch_commands):
        record=completed.get(index)
        if record is not None:
            log.append(dict(cmd=item['command'][:4],tag=item['tag'],s=round(record['seconds'],1),code=record['exit_code'],
                            farm_batch=FARM_BATCH_VERSION,cache_events=report.get('cache_events',[]),
                            retry=bool(record['exit_code'])))
        if record is None or record['exit_code']:
            print('person_job: retrying batch shot in a fresh Blender process: '+str(item['tag']),flush=True)
            farm_batch_original_run(item['command'],cwd=item['cwd'],fatal=item['fatal'],tag=item['tag'],env=item['env'])
    if process_code and len(completed)==len(farm_batch_commands) and all(r['exit_code']==0 for r in completed.values()):
        failed.append('Blender batch exited after durable completion with code '+str(process_code))
"""

def adapt(source):
    if VERSION in source:
        return source
    boot="boot = os.path.join(HERE, 'gpujob', 'boot.py')"
    ending="if not DRY:\n    os.makedirs(OUT, exist_ok=True); json.dump(log,"
    if source.count(boot)!=1 or source.count(ending)!=1:
        raise ValueError('Person batch boundaries require qualification')
    root=Path(__file__).resolve().parent
    prefix='FARM_BATCH_VERSION = '+repr(VERSION)+'\n'
    prefix+='FARM_BATCH_QUALIFIED = '+repr(QUALIFIED)+'\n'
    prefix+='FARM_BATCH_CACHE_SOURCE = '+repr((root/'scene_cache.py').read_text())+'\n'
    prefix+='FARM_BATCH_RUNNER_SOURCE = '+repr((root/'batch_runner.py').read_text())+'\n'
    result=source.replace(boot,HELPER+'\n'+boot,1)
    result=result.replace(ending,'farm_batch_flush()\n'+ending,1)
    result=prefix+result
    compile(result,'person_job.farm_batch.py','exec')
    return result
