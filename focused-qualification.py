import pathlib,subprocess,os,json,hashlib,time,resource
root=pathlib.Path(__file__).resolve().parent
e=root/'qualification-evidence';e.mkdir()
cg=pathlib.Path('/sys/fs/cgroup')/next(x[3:] for x in pathlib.Path('/proc/self/cgroup').read_text().splitlines() if x.startswith('0::')).lstrip('/')
compiler=pathlib.Path('/run/baton2-native-homelab/home/.local/share/bend2/releases/2.0.25-27629713-20261018/bin/bend')
def sha(p):
 h=hashlib.sha256()
 with pathlib.Path(p).open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def save(name,v):(e/name).write_text(json.dumps(v,indent=2)+'\n')
assert int((cg/'memory.max').read_text())==16*1024**3
assert (cg/'memory.swap.max').read_text().strip()=='0'
assert resource.getrlimit(resource.RLIMIT_AS)[0]==resource.RLIM_INFINITY
save('identity.json',{'source':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'boot':pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'cgroup':str(cg),'compiler':str(compiler),'compiler_sha256':sha(compiler),'compiler_main_sha256':sha(compiler.parent.parent/'bend2/main.ts'),'memory_max':(cg/'memory.max').read_text().strip(),'swap_max':(cg/'memory.swap.max').read_text().strip()})
env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':os.environ['HOME'],'USER':'batonci','LANG':'C.UTF-8','BEND':str(compiler),'BATON2_ADMISSION_CGROUP':str(cg),'BEND_NO_TELEMETRY':'1','CC':'/usr/bin/clang-19','BUN_JSC_maxPerThreadStackUsage':'67108864','KEEP_OBSERVER_FIXTURE':'1'}
out=root/'.scratch/bend2/baton-recovery'
env['OBSERVER_RECOVERY_BIN']=str(out)
rows=[]
try:
 for label,argv in [('build-recovery',['sh','bend2/scripts/build-native.sh','bend2/src/coordinator/receive-recovery-focused.bend',str(out)]),('build-fixture',['sh','bend2/scripts/build-native.sh','bend2/test/monitor-fixture.bend',str(root/'.scratch/bend2/monitor-fixture')]),('observer-monitor',['python3','bend2/test/observer-monitor.py','-v'])]:
  if label=='build-recovery':env['BATON2_RECOVERY_HELPER']='1'
  else:env.pop('BATON2_RECOVERY_HELPER',None)
  start=time.time()
  with (e/(label+'.stdout')).open('wb') as stdout,(e/(label+'.stderr')).open('wb') as stderr:
   code=subprocess.run(argv,cwd=root,env=env,stdout=stdout,stderr=stderr).returncode
  rows.append({'label':label,'argv':argv,'started_at':start,'ended_at':time.time(),'exit':code})
  save('commands.json',rows)
  if code:raise subprocess.CalledProcessError(code,argv)
 save('result.json',{'result':'pass','qualification':'focused recovery observer-monitor suite','binary':str(out),'binary_sha256':sha(out),'c_sha256':sha(str(out)+'.c')})
except BaseException as error:
 save('result.json',{'result':'fail','type':type(error).__name__,'error':str(error)})
 raise
finally:
 save('memory.json',{'peak':(cg/'memory.peak').read_text().strip(),'events':(cg/'memory.events').read_text().splitlines(),'swap_current':(cg/'memory.swap.current').read_text().strip()})
