"""Upgrade prepared scene adapters while retaining checksums and prior files."""
import hashlib,json,pathlib,uuid,os
import farm
from render_policy import SCRIPT_FAILURE_GUARD, add_webgl_guard
ANCHOR="page.on('pageerror', farmPageError);\ntry {"

def replace_file(path,data):
    temp=path.with_suffix('.upgrade')
    with temp.open('wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
    temp.replace(path);farm.sync_directory(path.parent)


def upgrade(job):
    def transform(source):
        if source.count(ANCHOR)!=1:raise ValueError('Prepared renderer guard anchor changed')
        return source.replace(ANCHOR,"page.on('pageerror', farmPageError);\n"+SCRIPT_FAILURE_GUARD+"try {",1)
    return upgrade_adapter(job,'script-load','__farmScriptLoadFailure','script_load_guard',transform)

def upgrade_webgl(job):
    return upgrade_adapter(job,'webgl-context','__farmWebGLContextFailure','webgl_context_guard',add_webgl_guard)

def upgrade_adapter(job,name,token,field,transform):
    request=json.loads((job/'request.json').read_text())
    if request.get('kind')=='gpu':return
    if json.loads((job/'status.json').read_text()).get('state')!='prepared':return
    marker=job/('harness/'+name+'-upgrade.json')
    renderer=job/'repo/videos/web/render.farm.mjs'
    if marker.exists():
        transaction=json.loads(marker.read_text())
        if transaction['state']=='complete':return
        attempt=job/transaction['attempt']
        old=(attempt/'renderer.mjs').read_bytes()
        data=transform(old.decode()).encode()
        current=json.loads((job/'prepared.json').read_text())
        if current not in (transaction['old'],transaction['new']):raise ValueError('Prepared checkpoint changed during adapter upgrade')
        if farm.file_sha256(renderer) not in (transaction['old']['renderer_adapted_sha256'],transaction['new']['renderer_adapted_sha256']):
            raise ValueError('Renderer changed during adapter upgrade')
    else:
        from recovery import validate_prepared
        current=validate_prepared(job);old=renderer.read_bytes()
        if token in old.decode():return
        data=transform(old.decode()).encode()
        attempt=job/'attempts'/(name+'-upgrade-'+uuid.uuid4().hex);attempt.mkdir(parents=True)
        replace_file(attempt/'renderer.mjs',old);farm.write(attempt/'prepared.json',current)
        updated=dict(current,renderer_adapted_sha256=hashlib.sha256(data).hexdigest(),**{field:True})
        transaction={'state':'pending','attempt':str(attempt.relative_to(job)),'old':current,'new':updated,'started':farm.now()}
        farm.write(marker,transaction)
    replace_file(renderer,data);farm.write(job/'prepared.json',transaction['new'])
    transaction.update(state='complete',finished=farm.now());farm.write(marker,transaction)


def upgrade_pending():
    for job in sorted(farm.JOBS.iterdir()):
        if not (job/'status.json').exists() or not (job/'prepared.json').exists():continue
        try:
            upgrade(job)
            upgrade_webgl(job)
        except Exception as error:
            s=json.loads((job/'status.json').read_text());s.update(state='failed',phase='preparing',failure_kind='job_input',error=str(error));farm.write(job/'status.json',s)
            from repair_queue import record
            record(job,error,'preparing')
            print('Adapter upgrade retained for repair: '+job.name+': '+str(error),flush=True)
