import ast,hashlib,json,pathlib,signal,types,unittest,tempfile,runpy,sys,os,subprocess
from unittest.mock import patch
import gpu_jobs,gpu_policy
import farm

class Recipes(unittest.TestCase):
    def spec(self,cmd): return dict(id='test-gpu',run=[cmd])
    def test_single_and_dual_gpu(self):
        for n in (1,2):
            r=gpu_jobs.parse(self.spec(f'sh videos/scripts/gpu_job.sh blender videos/blender/gpujob/smoke.py --id test-gpu --gpus {n} -- --strict'))
            self.assertEqual(r['gpu_count'],n)
    def test_reject_before_allocation(self):
        capacity=len(farm.CONFIG.get('gpu_job_gpus',farm.CONFIG['gpus']))
        commands=['sh videos/scripts/gpu_job.sh python videos/gpu/../escape.py --id test-gpu',
          'sh videos/scripts/gpu_job.sh python videos/gpu/smoke.py --id other',
          f'sh videos/scripts/gpu_job.sh python videos/gpu/smoke.py --id test-gpu --gpus {capacity+1}',
          'sh videos/scripts/gpu_job.sh python videos/gpu/smoke.py --id test-gpu --gpus 1 --gpus 2',
          'sh videos/scripts/gpu_job.sh python videos/gpu/smoke.py --id test-gpu; touch /tmp/x',
          'sh videos/scripts/gpu_job.sh python /tmp/x.py --id test-gpu']
        for cmd in commands:
            with self.subTest(cmd=cmd),self.assertRaises((ValueError,KeyError)):gpu_jobs.parse(self.spec(cmd))
    def test_policy_no_elapsed_gate_or_forced_kill(self):
        original=pathlib.Path('maintenance/gpu-job-type-20261003/source/gpu_job.py').read_text()
        adapted=gpu_policy.apply(original)
        self.assertNotIn('signal.SIGKILL',adapted)
        tree=ast.parse(adapted);fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='run_children')
        clock=types.SimpleNamespace(t=0)
        clock.time=lambda:clock.t
        clock.sleep=lambda n:setattr(clock,'t',clock.t+n)
        signals=[]
        class Child:
            def __init__(self,*args):
                self.p=types.SimpleNamespace(pid=123,returncode=0,poll=lambda:None if clock.t<4 else 0,wait=lambda:0)
                self.t=types.SimpleNamespace(join=lambda:None)
            def signal(self,sig):signals.append(sig)
        ns=dict(Child=Child,time=clock,group_rss=lambda ids:0,signal=signal)
        exec(compile(ast.Module(body=[fn],type_ignores=[]),'policy','exec'),ns)
        codes,reason,seconds,*_=ns['run_children']([([],{},'x','')],1,1024)
        self.assertEqual(codes,[0]);self.assertIsNone(reason);self.assertGreater(seconds,1);self.assertEqual(signals,[])
    def test_claim_response_without_id(self):
        import protocol_bridge
        body={'run':['sh videos/scripts/gpu_job.sh python videos/gpu/smoke.py --id test-gpu'],
              'pipeline_commit':'a'*40,'outputs':[],'dependencies':{}}
        with tempfile.TemporaryDirectory() as td,patch.object(farm,'JOBS',pathlib.Path(td)),patch.object(protocol_bridge,'command',return_value='test-gpu\n'+json.dumps(body)):
            job=protocol_bridge.acquire()
            self.assertIsNotNone(job)
            request=json.loads((job/'request.json').read_text())
            self.assertEqual(request['gpu_count'],1);self.assertEqual(request['protocol_id'],'test-gpu')
    def test_post_placeholder_preserves_dependencies(self):
        sys.path.insert(0,str(farm.HOME/'protocol'))
        cli=runpy.run_path(str(farm.HOME/'protocol/pipeline-farm.py'))
        captured={}
        class Repo:
            def head(self): return 'a'*40
            def commit(self,parent,files,msg): captured.update(json.loads(next(iter(files.values()))));return True
        identifier=cli['post_job'](Repo(),'GPU smoke',['sh videos/scripts/gpu_job.sh python videos/gpu/smoke.py --id {id}'],'GPU','farm','','a'*40,'',['videos/out/gpu/{id}/deliver/'],{'python':['boltons==24.0.0']})
        self.assertIn('--id '+identifier,captured['run'][0]);self.assertEqual(captured['dependencies']['python'],['boltons==24.0.0'])
    def test_existing_scene_parser(self):
        from protocol_bridge import parse_run
        self.assertEqual(parse_run(['sh videos/scripts/local_render.sh --seg gary2036:128'])['scene'],'gary2036')

    def test_allocated_gpu_reaches_container_and_receipt_rejects_another_card(self):
        cards=[dict(label='gpu'+str(i),uuid='GPU-test-'+str(i)) for i in range(3)]
        for received in (cards[2],cards[0]):
            with self.subTest(received=received['uuid']),tempfile.TemporaryDirectory() as td:
                job=pathlib.Path(td)
                (job/'repo/videos/scripts').mkdir(parents=True)
                (job/'repo/videos/scripts/gpu_job.farm.py').write_text('pinned adapter')
                (job/'dependencies.json').write_text('{}')
                (job/'logs').mkdir()
                output=job/'out/gpu/test-gpu/deliver';output.mkdir(parents=True)
                (output/'frame.png').write_bytes(b'rendered frame')
                farm.write(output/'receipt.json',dict(status='ok',exit_code=0,repo={'commit':'pinned'},gpus=[received],
                    files=[dict(name='frame.png',sha256=farm.file_sha256(output/'frame.png'))]))
                request=dict(kind='gpu',gpu_kind='blender',gpu_count=1,protocol_id='test-gpu',commit='a'*40,gpu_argv=['sh','videos/scripts/gpu_job.sh','blender','videos/blender/smoke.py','--id','test-gpu','--mem','24'])
                farm.write(job/'request.json',request)
                request_sha=hashlib.sha256((job/'request.json').read_bytes()).hexdigest()
                farm.write(job/'prepared.json',dict(request=request,commit='pinned',request_manifest_sha256=request_sha,
                    inputs={'videos/scripts/gpu_job.farm.py':farm.file_sha256(job/'repo/videos/scripts/gpu_job.farm.py')},
                    dependencies_manifest_sha256=farm.file_sha256(job/'dependencies.json')))
                with patch.dict(farm.CONFIG,gpus=cards[:2],gpu_job_gpus=cards), \
                     patch.object(farm,'run',side_effect=['pinned','start',cards[2]['uuid']]), \
                     patch.object(farm,'check_render_outcome'),patch.object(gpu_jobs,'docker') as dispatch:
                    if received==cards[2]:
                        gpu_jobs.picture(job,gpus=[cards[2]])
                        self.assertEqual(json.loads((job/'status.json').read_text())['state'],'pictured')
                        self.assertEqual(json.loads((job/'receipt.json').read_text())['gpus'],[cards[2]])
                    else:
                        with self.assertRaisesRegex(RuntimeError,'unexpected GPU'):
                            gpu_jobs.picture(job,gpus=[cards[2]])
                        self.assertEqual(json.loads((job/'status.json').read_text())['failure_kind'],'unclassified')
                    self.assertEqual(dispatch.call_args.args[2],[cards[2]])


    def test_protocol_manifest_and_bounded_container_launch(self):
        with tempfile.TemporaryDirectory() as td:
            job=pathlib.Path(td)/'protocol-test-gpu'; job.mkdir()
            request=dict(kind='gpu',gpu_kind='blender',gpu_count=1,protocol_id='test-gpu',commit='a'*40,
                gpu_argv=['sh','videos/scripts/gpu_job.sh','blender','videos/blender/smoke.py','--id','test-gpu','--mem','48','--','--frames','1'])
            farm.write(job/'request.json',request)
            path,loaded=gpu_jobs.read_request(job)
            self.assertEqual(loaded['protocol_id'],'test-gpu')
            self.assertEqual(gpu_jobs.launch_limits(job,loaded),dict(memory_gib=48.0,cpu_cores=14.0))
            captured={}
            def capture(argv,**kwargs): captured['argv']=argv;return 'ok'
            cards=[dict(label='gpu0',uuid='GPU-test-0')]
            prepared=dict(commit='a'*40,host_memory_gib=48.0)
            farm.write(job/'prepared.json',prepared)
            farm.write(job/'status.json',dict(state='running',phase='rendering'))
            farm.write(job/'allocation.json',dict(gpus=cards))
            from gpu_allocation import process_start
            farm.write(job/'admission.json',dict(memory_bytes=48*2**30,
                prepared_sha256=farm.file_sha256(job/'prepared.json'),boot_id=farm.boot_id(),
                owner_pid=os.getpid(),owner_start=process_start(os.getpid())))
            with patch.dict(farm.CONFIG,{'gpus':cards,'gpu_job_gpus':cards,'image':'test-image'}), \
                 patch.object(farm,'BASE',pathlib.Path(td)),patch.object(farm,'runtime_cache_mounts',return_value=[]), \
                 patch('gpu_allocation.pool',return_value=cards),patch('job_dependencies.runtime_image',return_value='sha256:test'), \
                 patch.object(farm,'run',side_effect=capture):
                gpu_jobs.docker(job,['true'],cards)
            args=captured['argv']
            self.assertEqual(args[args.index('--cpus')+1],'14.0')
            self.assertEqual(args[args.index('--memory')+1],'48.0g')
            self.assertEqual(args[args.index('--memory-swap')+1],'48.0g')
            mount=next(args[i+1] for i,x in enumerate(args[:-1]) if x=='--mount' and 'dst=/run/acp-job-request.json' in args[i+1])
            self.assertEqual(mount,f'type=bind,src={path.resolve()},dst=/run/acp-job-request.json,readonly')
            self.assertIn('ACP_JOB_REQUEST_FILE=/run/acp-job-request.json',args)
            self.assertIn('ACP_JOB_MEMORY_LIMIT_GIB=48.0',args)
            self.assertIn('GPU_JOB_MAX_MEM=48.0',args)
            admitted=next(x.split('=',1)[1] for x in args if x.startswith('CAMPAIGN_ADMITTED_GPU_UUIDS='))
            self.assertEqual(admitted,'GPU-test-0')
            receipt=json.loads(next(x.split('=',1)[1] for x in args if x.startswith('OC_ADMISSION_RECEIPT=')))
            self.assertEqual(receipt['schema'],'acp.gpu-campaign-admission/v1')
            self.assertEqual(receipt['gpu_uuids'],['GPU-test-0'])
            self.assertEqual(receipt['container_memory_gib'],48.0)
            self.assertEqual(receipt['pipeline_commit'],'a'*40)
            with self.assertRaisesRegex(ValueError,'allocation does not match'):
                gpu_jobs.campaign_admission(job,[dict(label='gpu1',uuid='GPU-test-1')])

    def test_protocol_manifest_fails_closed(self):
        with tempfile.TemporaryDirectory() as td:
            job=pathlib.Path(td)
            with self.assertRaisesRegex(ValueError,'regular file'):gpu_jobs.read_request(job)
            farm.write(job/'request.json',dict(protocol_id='test-gpu',commit='bad',gpu_argv=['sh','a','b','c']))
            with self.assertRaisesRegex(ValueError,'pinned commit'):gpu_jobs.read_request(job)

    def test_null_helper_commit_requires_verified_host_inputs(self):
        for reported_commit,changed in ((None,False),(None,True),('different',False)):
            with self.subTest(reported_commit=reported_commit,changed=changed),tempfile.TemporaryDirectory() as td:
                job=pathlib.Path(td);adapter=job/'repo/videos/scripts/gpu_job.farm.py'
                adapter.parent.mkdir(parents=True);adapter.write_text('pinned adapter')
                farm.write(job/'dependencies.json',{})
                request=dict(kind='gpu',gpu_kind='blender',commit='pinned',protocol_id='test-gpu')
                farm.write(job/'request.json',request)
                context=dict(request=request,commit='pinned',inputs={'videos/scripts/gpu_job.farm.py':farm.file_sha256(adapter)},
                             dependencies_manifest_sha256=farm.file_sha256(job/'dependencies.json'))
                farm.write(job/'prepared.json',context)
                output=job/'out/gpu/test-gpu/deliver';output.mkdir(parents=True)
                (output/'frame.png').write_bytes(b'rendered frame')
                farm.write(output/'receipt.json',dict(status='ok',exit_code=0,job='test-gpu',repo={'commit':reported_commit},
                    gpus=[{'uuid':'GPU-test'}],files=[dict(name='frame.png',sha256=farm.file_sha256(output/'frame.png'))]))
                if changed:adapter.write_text('changed adapter')
                with patch.object(farm,'run',return_value='pinned'):
                    if changed or reported_commit:
                        with self.assertRaisesRegex((ValueError,farm.JobInputError),'Prepared input changed|revision mismatch'):
                            gpu_jobs.save_picture(job,context,{'GPU-test'},1)
                    else:
                        gpu_jobs.save_picture(job,context,{'GPU-test'},1)
                        self.assertEqual(json.loads((job/'status.json').read_text())['state'],'pictured')
                        self.assertEqual(json.loads((job/'receipt.json').read_text())['source_verification']['commit'],'pinned')

    def test_gpu_sparse_checkout_materializes_fframes_recipe(self):
        with tempfile.TemporaryDirectory() as td:
            repo=pathlib.Path(td)
            recipe=repo/'homelab/runtime/fframes_recipe.py'
            recipe.parent.mkdir(parents=True)
            recipe.write_text('FULL_SCENE_SEGMENT_FRAMES = 289\n')
            gpu=repo/'videos/gpu/probe.py'
            gpu.parent.mkdir(parents=True)
            gpu.write_text('pass\n')
            def git(*args):
                subprocess.run(['git',*args],cwd=repo,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
            git('init','--quiet')
            git('config','user.name','farm-test')
            git('config','user.email','farm-test@example.invalid')
            git('add','homelab/runtime/fframes_recipe.py','videos/gpu/probe.py')
            git('commit','--quiet','-m','sparse checkout fixture')
            git('sparse-checkout','init','--cone')
            git('sparse-checkout','set',*farm.CONFIG['sparse'])
            self.assertTrue(recipe.is_file())
            result=subprocess.run(
                [sys.executable,'-c',
                 "import sys; sys.path.insert(1, 'homelab/runtime'); import fframes_recipe; assert fframes_recipe.FULL_SCENE_SEGMENT_FRAMES == 289"],
                cwd=repo,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)


if __name__=='__main__': unittest.main()
