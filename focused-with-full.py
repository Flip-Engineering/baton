import pathlib,subprocess,os,json,hashlib,time,resource
root=pathlib.Path(__file__).resolve().parent;e=root/'qualification-with-full';e.mkdir()
cg=pathlib.Path('/sys/fs/cgroup')/next(x[3:] for x in pathlib.Path('/proc/self/cgroup').read_text().splitlines() if x.startswith('0::')).lstrip('/')
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def save(n,v):(e/n).write_text(json.dumps(v,indent=2)+'\n')
full=root/'.scratch/bend2/baton-full';recovery=root/'.scratch/bend2/baton-recovery'
assert sha(full)=='f590c49798c2df63c4a007f25620599a570dafb2eec74d54768fc340aec889fa'
env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':os.environ['HOME'],'USER':'batonci','LANG':'C.UTF-8','KEEP_OBSERVER_FIXTURE':'1','OBSERVER_RECOVERY_BIN':str(recovery)}
assert (cg/'memory.swap.max').read_text().strip()=='0'
assert resource.getrlimit(resource.RLIMIT_AS)[0]==resource.RLIM_INFINITY
save('identity.json',{'source':'2cf17ad94229f870d6ff33154793f582d65dcd93','full_source':'97916000d2742e1e4d29514001cca2b87f411f39','full_sha256':sha(full),'recovery_sha256':sha(recovery),'cgroup':str(cg)})
try:
 for label,args in [('help',['--help']),('status',[str(root/'.scratch/bend2/observer-monitor-dxk8my60/state.db'),'status'])]:
  a=subprocess.run([str(full),*args],env=env,capture_output=True,timeout=30)
  b=subprocess.run([str(recovery),*args],env=env,capture_output=True,timeout=30)
  save(label+'-parity.json',{'full_exit':a.returncode,'helper_exit':b.returncode,'stdout_match':a.stdout==b.stdout,'stderr_match':a.stderr==b.stderr,'stdout_sha256':hashlib.sha256(a.stdout).hexdigest(),'stderr_sha256':hashlib.sha256(a.stderr).hexdigest()})
  assert (a.returncode,a.stdout,a.stderr)==(b.returncode,b.stdout,b.stderr)
  assert a.returncode==0
 with (e/'observer-monitor.stdout').open('wb') as stdout,(e/'observer-monitor.stderr').open('wb') as stderr:
  code=subprocess.run(['python3','bend2/test/observer-monitor.py','-v'],cwd=root,env=env,stdout=stdout,stderr=stderr).returncode
 save('result.json',{'result':'pass' if code==0 else 'fail','exit_code':code})
 if code:raise SystemExit(code)
except BaseException as error:
 save('failure.json',{'type':type(error).__name__,'error':str(error)})
 raise
finally:save('memory.json',{'peak':(cg/'memory.peak').read_text().strip(),'events':(cg/'memory.events').read_text().splitlines(),'swap_current':(cg/'memory.swap.current').read_text().strip()})
