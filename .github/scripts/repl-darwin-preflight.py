"""Verify the required Bend2 compiler dependency on a remote Darwin runner."""
from pathlib import Path
import argparse,datetime,hashlib,json,os,platform,subprocess,sys,tarfile,traceback

ROOT=Path(__file__).resolve().parents[2]
def fact(path):
 digest=hashlib.sha256()
 with path.open('rb') as stream:
  for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
 return {'sha256':digest.hexdigest(),'bytes':path.stat().st_size}
def save(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',required=True,type=Path)
args=parser.parse_args()
assert platform.system()=='Darwin' and platform.machine()=='arm64'
os.umask(0o077)
out=args.output.resolve();out.mkdir()
work=out/'workspace';work.mkdir()
commands=out/'commands';commands.mkdir()
env=os.environ.copy()
for key in list(env):
 if key.startswith(('BEND','BUN','BATON','CODEX','OMP')) or key in ['CC','CXX','CFLAGS','LDFLAGS','CPATH','C_INCLUDE_PATH','CPLUS_INCLUDE_PATH','LIBRARY_PATH','SDKROOT','CUDA_HOME','PYTHONPATH']:env.pop(key,None)
env.update(PATH='/usr/bin:/bin:/usr/sbin:/sbin',TMPDIR=str(out/'tmp'))
Path(env['TMPDIR']).mkdir()
records=[]
def run(label,argv,input_text=None,expected=0):
 directory=commands/('%03d-'%len(records)+label);directory.mkdir()
 (directory/'stdin').write_text(input_text or '')
 row={'label':label,'argv':list(map(str,argv)),'cwd':str(work),'started':now()}
 with (directory/'stdout').open('xb') as stdout,(directory/'stderr').open('xb') as stderr:
  child=subprocess.Popen(row['argv'],cwd=work,env=env,stdout=stdout,stderr=stderr,stdin=subprocess.PIPE if input_text is not None else subprocess.DEVNULL)
  row['pid']=child.pid
  if input_text is not None:child.communicate(input_text.encode())
  row['returncode']=child.wait()
 row.update(ended=now(),natural_wait_completed=True,streams={name:fact(directory/name) for name in ['stdin','stdout','stderr']})
 save(directory/'result.json',row);records.append(row);save(out/'commands.json',records)
 assert row['returncode']==expected,row
 return (directory/'stdout').read_text(),(directory/'stderr').read_text()
hidden=ROOT.with_name(ROOT.name+'-preflight-source-unavailable')
try:
 save(out/'scope.json',{'scope':'Required compiler dependency and frontend preflight only. Normal coordinator archive, CLI, installer activation, and live adoption acceptance remain pending.','producer_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'platform':platform.platform(),'machine':platform.machine(),'inputs':{name:fact(ROOT/name) for name in ['.github/scripts/repl-package.py','bend2/scripts/stage-repl-compiler.py','bend2/compiler/repl.ts','bend2/compiler/repl-upstream.lock.json','bend2/compiler/repl-upstream.provenance.json']}})
 helper=ROOT/'.github/scripts/repl-package.py'
 run('source-inputs',[sys.executable,helper,'source','--source',ROOT/'bend2/compiler/upstream','--output',out/'source-inputs'])
 run('runtime-inputs',[sys.executable,helper,'runtime','--output',out/'runtime-inputs'])
 runtime=json.loads((out/'runtime-inputs/runtime.json').read_text())
 run('stage-dependency',[sys.executable,ROOT/'bend2/scripts/stage-repl-compiler.py','--source',out/'source-inputs/source','--runtime',out/'runtime-inputs/bun','--runtime-sha256',runtime['binary']['sha256'],'--runtime-notices',out/'runtime-inputs/Bun-NOTICES','--output',out/'staged'])
 archive=out/'required-repl-dependency.tar.gz'
 with tarfile.open(archive,'w:gz') as tar:tar.add(out/'staged',arcname='repl')
 extracted=out/'extracted';extracted.mkdir()
 with tarfile.open(archive) as tar:tar.extractall(extracted)
 compiler=extracted/'repl/compiler'
 inventory=json.loads((extracted/'repl/upstream/compiler.json').read_text())
 assert inventory['language']=='Bend2' and inventory['nativeLibraries']==['sqlite3']
 for member in inventory['files']:
  p=extracted/'repl'/member['path']
  assert fact(p)=={key:member[key] for key in ['sha256','bytes']} and oct(p.stat().st_mode&0o777)==member['mode']
 save(out/'archive-custody.json',{'archive':fact(archive),'compiler_manifest':fact(extracted/'repl/upstream/compiler.json'),'inventory':inventory,'runtime':runtime})
 clang_text,_=run('find-clang',['xcrun','--find','clang']);clang=Path(clang_text.strip()).resolve()
 version,_=run('clang-version',[clang,'--version'])
 sdk_text,_=run('find-sdk',['xcrun','--sdk','macosx','--show-sdk-path']);sdk=Path(sdk_text.strip()).resolve()
 sdk_version,_=run('sdk-version',['xcrun','--sdk','macosx','--show-sdk-version'])
 save(out/'system-dependencies.json',{'compiler':{'path':str(clang),**fact(clang),'version':version},'sdk':{'path':str(sdk),'version':sdk_version.strip(),'sqlite_header':fact(sdk/'usr/include/sqlite3.h'),'sqlite_stub':fact(sdk/'usr/lib/libsqlite3.tbd')}})
 (work/'sqlite.c').write_text('#include <sqlite3.h>\n#include <stdio.h>\nint main(void){sqlite3 *db=0;if(sqlite3_open(":memory:",&db))return 1;puts(sqlite3_libversion());return sqlite3_close(db);}\n')
 run('sqlite-build',[clang,work/'sqlite.c','-lsqlite3','-o',work/'sqlite'])
 sqlite_version,_=run('sqlite-run',[work/'sqlite'])
 (out/'staged').rename(out/'staged-unavailable')
 (out/'source-inputs').rename(out/'source-inputs-unavailable')
 os.chdir(work)
 assert not hidden.exists();ROOT.rename(hidden)
 assert not ROOT.exists() and not (out/'staged').exists() and not (out/'source-inputs').exists()
 save(out/'source-unavailable.json',{'time':now(),'checkout_original_path_absent':not ROOT.exists(),'staging_original_path_absent':not (out/'staged').exists(),'input_source_original_path_absent':not (out/'source-inputs').exists(),'execution_prefix':str(extracted/'repl'),'environment':{key:env[key] for key in ['PATH','TMPDIR']}})
 run('bundled-bun-version',[extracted/'repl/bun','--version'])
 definitions='def double(+x: U32) -> U32:\n  U32.add(x,x)\n'
 definition_file=work/'definition.bend';definition_file.write_text(definitions)
 defined,_=run('define',[compiler,'define',definition_file,work,work/'definition'],'[]')
 assert json.loads(defined)['kind']=='definitions'
 def evaluate(label,source,expected_type='',expected=0,snapshot=None):
  source_file=work/(label+'.bend');source_file.write_text(source)
  return run(label,[compiler,'eval',source_file,work,work/label,expected_type],json.dumps(snapshot or []),expected)
 pure,_=evaluate('pure','double(21)',snapshot=[definitions]);assert json.loads(pure)['value']=='42'
 evaluate('type-refusal','"wrong"','U32',expected=1)
 for label,source in [('js-const-refusal','const answer = 42;'),('js-arrow-refusal','((x: number) => x + 1)(41)'),('python-call-refusal','print(42)')]:evaluate(label,source,expected=1)
 body='Complete bundled Bend2 IO λ🙂\nSecond line.\n'
 native,diagnostic=evaluate('native-io','IO.write('+json.dumps(body,ensure_ascii=False)+')','IO(Unit)')
 result=json.loads(native);assert result['kind']=='native'
 steps=[value['compilerStep'] for line in diagnostic.splitlines() if line.startswith('{') and 'compilerStep' in (value:=json.loads(line))]
 assert steps and all(step['status']==0 and '-lsqlite3' in step['arguments'] for step in steps)
 for key in ['generatedC','executable']:assert fact(Path(result[key]['path']))['sha256']==result[key]['sha256']
 stdout,stderr=run('run-native-io',[result['executable']['path']]);assert stdout==body and stderr==''
 save(out/'result.json',{'success':True,'completed':now(),'scope':'Required Darwin arm64 compiler dependency and frontend preflight. Normal coordinator archive and installed CLI acceptance remain pending.','source_unavailable_during_evaluation':True,'pure':json.loads(pure),'native':result,'compiler_steps':steps,'sqlite_version':sqlite_version.strip(),'full_native_stdout':stdout})
except BaseException:
 save(out/'failure.json',{'time':now(),'traceback':traceback.format_exc()});raise
finally:
 if hidden.exists() and not ROOT.exists():hidden.rename(ROOT)
