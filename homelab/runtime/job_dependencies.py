"""Resolve dependencies into immutable job images; no host/global installation."""
import fcntl
import hashlib
import json
import pathlib
import subprocess
from protocol.farm_dependencies import normalize, npm_name

POLICY_VERSION = 1

def base_reference(image):
    return 'local/acp-deps-base:' + image.removeprefix('sha256:')

def plan(base_image, dependencies):
    declared = normalize(dependencies)
    # npm is installed into the pinned checkout after npm ci, not into this image.
    build = dict(policy=POLICY_VERSION, base_image=base_image,
                 python=declared['python'], system=declared['system'])
    key = hashlib.sha256(json.dumps(build, sort_keys=True).encode()).hexdigest()
    # BuildKit treats bare image IDs as registry names. Snapshot the local base
    # under a content-addressed local tag, and record/verify the actual image ID.
    dockerfile = ['FROM ' + base_reference(base_image)]
    if build['system']:
        system_install = '''import json,subprocess,sys
missing=[]
for req in json.loads(sys.argv[1]):
 name,_,version=req.partition('=')
 r=subprocess.run(['dpkg-query','-W','-f=${Status}\\t${Version}',name],capture_output=True,text=True)
 status,_,installed=r.stdout.partition('\\t')
 if r.returncode or status!='install ok installed' or (version and version!=installed): missing.append(req)
if missing:
 subprocess.run(['apt-get','update'],check=True)
 subprocess.run(['apt-get','install','-y','--no-install-recommends',*missing],check=True)
'''
        dockerfile.extend([
            'USER root',
            'RUN ' + json.dumps(['python3', '-c', system_install, json.dumps(build['system'])]),
        ])
    if build['python']:
        dockerfile.extend([
            'USER root',
            'RUN ' + json.dumps(['python3', '-m', 'pip', 'install', '--no-cache-dir', *build['python']]),
            'RUN ' + json.dumps(['python3', '-m', 'pip', 'check']),
        ])
    return declared, key, '\n'.join(dockerfile) + '\n'

def runtime_image(job, default):
    path = pathlib.Path(job) / 'dependencies.json'
    return json.loads(path.read_text())['image'] if path.exists() else default

def install_image(job):
    import farm
    request = json.loads((job/'request.json').read_text())
    declared = normalize(request.get('dependencies', request.get('protocol_spec', {}).get('dependencies')))
    base = farm.run(['docker', 'image', 'inspect', '--format', '{{.Id}}', farm.CONFIG['image']])
    declared, key, dockerfile = plan(base, declared)
    target = 'local/acp-job-deps:' + key
    log = job/'logs/dependencies.log'
    # Shared image cache is keyed by immutable base image plus the declaration.
    # Each job records the resolved image ID; subsequent tags cannot affect it.
    cache = farm.BASE/'dependency-images'; cache.mkdir(exist_ok=True)
    if declared['python'] or declared['system']:
        directory=cache/key;directory.mkdir(exist_ok=True)
        with open(cache/(key+'.lock'), 'w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            found = subprocess.run(['docker','image','inspect',target],env=farm.ENV,capture_output=True)
            if found.returncode:
                farm.run(['docker','tag',base,base_reference(base)])
                (directory/'Dockerfile').write_text(dockerfile)
                farm.run(['docker','build','--tag',target,str(directory)],log=log)
            image = farm.run(['docker','image','inspect','--format','{{.Id}}',target])
    else:
        image = base
    manifest = dict(policy_version=POLICY_VERSION,declared=declared,base_image=base,image=image,cache_key=key)
    (job/'harness/dependencies.Dockerfile').write_text(dockerfile)
    farm.write(job/'dependencies.json',manifest)
    return manifest

def install_npm_and_record(job):
    import farm
    manifest=json.loads((job/'dependencies.json').read_text())
    declared=manifest['declared']
    log=job/'logs/dependencies.log'
    if declared['npm']:
        farm.docker(job,['npm','install','--no-save','--package-lock=false','--prefix','web',
                         '--cache','/render-cache/npm',*declared['npm']],log=log)
    # Record actual distribution versions, including resolved transitive packages.
    probe = '''import json,importlib.metadata as m,pathlib,subprocess
names=json.loads(__import__('sys').argv[1]);system=json.loads(__import__('sys').argv[2])
npm={n:json.loads((pathlib.Path('web/node_modules')/n/'package.json').read_text())['version'] for n in names}
packages={d.metadata['Name']:d.version for d in m.distributions() if d.metadata['Name']}
apt={}
for req in system:
 name=req.split('=',1)[0]
 apt[name]=subprocess.check_output(['dpkg-query','-W','-f=${Version}',name],text=True).strip()
print(json.dumps(dict(python=packages,npm=npm,system=apt),sort_keys=True))
'''
    manifest['resolved'] = json.loads(farm.docker(job,['python3','-c',probe,
        json.dumps([npm_name(x) for x in declared['npm']]),json.dumps(declared['system'])]))
    farm.write(job/'dependencies.json',manifest)
    return manifest
