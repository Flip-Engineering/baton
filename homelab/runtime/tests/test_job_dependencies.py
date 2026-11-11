import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch
import farm
import protocol_bridge
from job_dependencies import plan, runtime_image
from protocol.farm_dependencies import normalize, npm_name, parse

class DependencyChecks(unittest.TestCase):
    def test_old_job_and_empty_declarations_are_compatible(self):
        self.assertEqual(normalize(),{'python':[],'system':[],'npm':[]})
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(runtime_image(pathlib.Path(d),'base'),'base')
            (pathlib.Path(d)/'dependencies.json').write_text('{"image":"sha256:job"}')
            self.assertEqual(runtime_image(pathlib.Path(d),'base'),'sha256:job')

    def test_invalid_declarations_never_reach_an_installer(self):
        cases=[[],{'unknown':[]},{'python':'numpy'}, {'system':['-y']}, {'system':['curl\nRUN rm -rf /']},
               {'npm':['--global']},{'npm':['../../escape']},{'python':['-r /secret']},
               {'python':['foo\nRUN bad']},{'python':[5]}]
        for case in cases:
            with self.subTest(case=case),self.assertRaises(ValueError):normalize(case)

    def test_pins_markers_scoped_packages_and_file_input_survive(self):
        value={'python':['numpy==2.2.0','typing-extensions>=4; python_version < "3.12"'],
               'system':['figlet','libgl1:amd64=1.7.0-1'], 'npm':['@scope/pkg@1.2.3','is-number@7.0.0']}
        self.assertEqual(npm_name('@scope/pkg@1.2.3'),'@scope/pkg')
        self.assertEqual(npm_name('@scope/pkg'),'@scope/pkg')
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'deps.json';p.write_text(json.dumps(value))
            self.assertEqual(parse('@'+str(p)),normalize(value))

    def test_image_cache_is_immutable_and_order_independent(self):
        a=plan('sha256:aaa',{'python':['a==1','b==2']})
        b=plan('sha256:aaa',{'python':['b==2','a==1','a==1']})
        self.assertEqual(a,b)
        self.assertNotEqual(a[1],plan('sha256:bbb',{'python':['a==1','b==2']})[1])
        self.assertNotEqual(a[1],plan('sha256:aaa',{'python':['a==2','b==2']})[1])
        # Checkout-local npm additions never invalidate a Python/system image.
        self.assertEqual(a[1],plan('sha256:aaa',{'python':['a==1','b==2'],'npm':['foo@2']})[1])

    def test_docker_install_commands_preserve_requirement_as_single_argument(self):
        req='typing-extensions>=4; python_version < "3.12"'
        _,_,file=plan('sha256:aaa',{'python':[req]})
        commands=[json.loads(l[4:]) for l in file.splitlines() if l.startswith('RUN ')]
        self.assertIn(req,commands[0])
        self.assertEqual(commands[0][:4],['python3','-m','pip','install'])

    def test_changed_dependency_manifest_refuses_gpu_dispatch(self):
        with tempfile.TemporaryDirectory() as temp:
            job=pathlib.Path(temp);(job/'out').mkdir();(job/'repo/videos/web').mkdir(parents=True)
            files={'repo/videos/web/render.farm.mjs':'renderer','out/.test.wav':'wav','out/.test.hits.json':'{}','dependencies.json':'{"image":"sha256:original"}'}
            for path,value in files.items():(job/path).write_text(value)
            context=dict(request={},bounds={},finish_span=None,duration=1,frames=30,ranges=[],commit='pinned',scene='test',
                         renderer_adapted_sha256=farm.file_sha256(job/'repo/videos/web/render.farm.mjs'),
                         wav_sha256=farm.file_sha256(job/'out/.test.wav'),hits_sha256=farm.file_sha256(job/'out/.test.hits.json'),
                         dependencies_manifest_sha256=farm.file_sha256(job/'dependencies.json'))
            farm.write(job/'prepared.json',context);farm.write(job/'status.json',{})
            (job/'dependencies.json').write_text('{"image":"sha256:other"}')
            with patch.object(farm,'run',return_value='pinned'),patch.object(farm,'docker') as dispatch:
                with self.assertRaisesRegex(farm.JobInputError,'Dependency manifest changed'):farm.picture(job)
                dispatch.assert_not_called()

    def test_producer_posts_and_claims_dependencies_without_live_queue(self):
        spec=importlib.util.spec_from_file_location('producer',farm.HOME/'protocol/pipeline-farm.py')
        m=importlib.util.module_from_spec(spec)
        sys.path.insert(0,str(farm.HOME/'protocol'))
        try:spec.loader.exec_module(m)
        finally:sys.path.pop(0)
        class Repo:
            def head(self):return 'a'*40
            def commit(self,head,files,message):
                self.job=json.loads(next(iter(files.values())));return True
        repo=Repo();deps={'python':['boltons==24.0.0'],'npm':['is-number@7.0.0']}
        m.post_job(repo,'test',['sh videos/scripts/local_render.sh --seg gary2036:112'],'GARY','test','','a'*40,'',[],deps)
        self.assertEqual(repo.job['dependencies'],normalize(deps))

    def test_queue_claim_preserves_declaration_in_local_request(self):
        deps={'python':['boltons==24.0.0'],'system':['figlet'],'npm':['is-number@7.0.0']}
        spec={'run':['sh videos/scripts/local_render.sh --seg gary2036:112'],
              'pipeline_commit':'a'*40,'outputs':[],'notes':'test','dependencies':deps}
        with tempfile.TemporaryDirectory() as d,patch.object(farm,'JOBS',pathlib.Path(d)), \
             patch.object(protocol_bridge,'command',return_value='test-job\n'+json.dumps(spec)):
            job=protocol_bridge.acquire()
            self.assertEqual(json.loads((job/'request.json').read_text())['dependencies'],normalize(deps))

    def test_queue_claim_accepts_old_job_without_dependencies(self):
        spec={'run':['sh videos/scripts/local_render.sh --seg gary2036:112'],
              'pipeline_commit':'a'*40,'outputs':[],'notes':''}
        with tempfile.TemporaryDirectory() as d,patch.object(farm,'JOBS',pathlib.Path(d)), \
             patch.object(protocol_bridge,'command',return_value='old-job\n'+json.dumps(spec)):
            job=protocol_bridge.acquire()
            self.assertEqual(json.loads((job/'request.json').read_text())['dependencies'],normalize())

    def test_every_gpu_worker_uses_the_resolved_job_image(self):
        with tempfile.TemporaryDirectory() as d:
            job=pathlib.Path(d);(job/'dependencies.json').write_text('{"image":"sha256:job"}')
            with patch.object(farm,'run',return_value='') as run:
                farm.docker(job,['node','web/render.farm.mjs'],gpu=farm.CONFIG['gpus'][0])
            command=run.call_args.args[0]
            self.assertIn('sha256:job',command)
            self.assertNotIn(farm.CONFIG['image'],command)

if __name__=='__main__':unittest.main()
