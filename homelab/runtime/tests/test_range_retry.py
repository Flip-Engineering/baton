"""Homelab tests for validated scene-range retry and output reuse."""
import json
import shutil
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import farm
import range_retry
import recovery


class SceneRangeRetry(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.job = self.root / 'scene-job'
        self.job.mkdir()
        (self.job / 'logs').mkdir()
        (self.job / 'out').mkdir()
        (self.job / 'repo/videos/web').mkdir(parents=True)
        (self.job / 'repo/videos/web/render.farm.mjs').write_text('pinned renderer')
        (self.job / 'out/.scene.wav').write_bytes(b'pinned audio')
        (self.job / 'out/.scene.hits.json').write_text('{}')
        self.cards = [dict(label=f'gpu{i}', uuid=f'GPU-{i}') for i in range(3)]
        self.request = {'kind':'scene','commit':'pinned','protocol_id':'scene-job'}
        self.items = [dict(gpu=card, first=i*2, end_exclusive=(i+1)*2, preroll=0)
                      for i,card in enumerate(self.cards)]
        self.context = {
            'request':self.request, 'commit':'pinned', 'scene':'scene',
            'ranges':self.items, 'frames':6, 'duration':0.2,
            'bounds':{}, 'finish_span':False, 'host_memory_gib':6,
            'renderer_adapted_sha256':farm.file_sha256(self.job/'repo/videos/web/render.farm.mjs'),
            'wav_sha256':farm.file_sha256(self.job/'out/.scene.wav'),
            'hits_sha256':farm.file_sha256(self.job/'out/.scene.hits.json'),
            'capture_helpers':{}, 'prime_passes':0, 'stabilize_three':False,
            'dependencies':{},
        }
        farm.write(self.job/'request.json', self.request)
        farm.write(self.job/'prepared.json', self.context)
        farm.write(self.job/'status.json', {
            'state':'failed','phase':'rendering','failure_kind':'render_context',
            'error':'WebGL context loss in gpu1.log,gpu2.log; outputs rejected',
            'execution_boot_id':'old-boot','finished':'2026-10-19T00:00:00Z',
        })
        self.template = self.root/'valid-range.mp4'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i',
                        'color=c=black:s=1080x1920:r=30','-frames:v','2',
                        '-c:v','mpeg4','-threads','1','-pix_fmt','yuv420p',
                        str(self.template)],check=True)
        (self.job/'out/gpu0.mp4').write_bytes(self.template.read_bytes())
        (self.job/'out/gpu1.mp4').write_bytes(b'partial output')
        (self.job/'logs/gpu0.log').write_text(
            'scene: wrote /work/videos/out/gpu0.mp4 in 1s (500 ms/frame incl. grab + encode)\n')
        (self.job/'logs/gpu1.log').write_text('GL_CONTEXT_LOST_KHR\n')
        (self.job/'logs/gpu2.log').write_text('GL_CONTEXT_LOST_KHR\n')

    def test_recovery_reuses_only_validated_range_and_retry_runs_pending_ranges_serially(self):
        def recovery_command(argv,**kwargs):
            if argv[0] in ('ffprobe','ffmpeg'):
                return subprocess.check_output(list(map(str,argv)),text=True)
            return 'pinned'
        with patch.object(farm,'run',side_effect=recovery_command):
            recovery.restore(self.job,json.loads((self.job/'status.json').read_text()))
        status=json.loads((self.job/'status.json').read_text())
        self.assertEqual(status['state'],'prepared')
        plan=json.loads((self.job/'range-retry.json').read_text())
        self.assertEqual(plan['retry_count'],1)
        self.assertEqual([x['label'] for x in plan['completed']],['gpu0'])
        self.assertTrue((self.job/'out/gpu0.mp4').is_file())
        attempt=Path(status['previous_attempt'])
        self.assertTrue((attempt/'partial-picture/gpu1.mp4').is_file())
        pending,loaded=range_retry.pending_ranges(self.job,self.context)
        self.assertEqual([x['gpu']['label'] for x in pending],['gpu1','gpu2'])
        self.assertEqual(loaded['retry_count'],1)

        reloaded=json.loads((self.job/'prepared.json').read_text())
        pending_after_restore,_=range_retry.pending_ranges(self.job,reloaded)
        self.assertEqual([x['gpu']['label'] for x in pending_after_restore],['gpu1','gpu2'])
        calls=[]
        active=0
        peak=0
        lock=threading.Lock()
        def render(job,cmd,gpu=None,picture=False,log=None,memory_bytes=None):
            nonlocal active,peak
            with lock:
                active+=1;peak=max(peak,active)
            try:
                label=gpu['label']; destination=job/'out'/(label+'.mp4')
                shutil.copyfile(self.template,destination)
                Path(log).write_text(
                    f'scene: wrote /work/videos/out/{label}.mp4 in 1s (500 ms/frame incl. grab + encode)\n')
                calls.append((label,memory_bytes,cmd))
                return ''
            finally:
                with lock: active-=1

        def command(argv,**kwargs):
            if argv[0] in ('ffprobe','ffmpeg'):
                return subprocess.check_output(list(map(str,argv)),text=True)
            if argv[:2]==['git','rev-parse']: return 'pinned'
            if argv[:1]==['date']: return '2026-10-19T00:01:00Z'
            raise AssertionError(argv)

        with patch.object(farm,'run',side_effect=command), \
             patch.object(farm,'scene_preflight'), \
             patch.object(farm,'docker',side_effect=render), \
             patch.object(farm,'check_render_outcome'), \
             patch.object(farm,'sync_storage'), \
             patch('bench_parallel.validate_inputs'), \
             patch.dict(farm.CONFIG,gpus=self.cards,telemetry_seconds=0.01,gpu_health_timeout_seconds=1):
            farm.picture(self.job)

        self.assertEqual([label for label,_,_ in calls],['gpu1','gpu2'])
        self.assertEqual([(cmd[cmd.index('--from')+1],cmd[cmd.index('--to')+1])
                          for _,_,cmd in calls],
                         [(str(2/30),str(4/30)),(str(4/30),str(6/30))])
        self.assertEqual(peak,1)
        self.assertEqual([memory for _,memory,_ in calls],[6*2**30,6*2**30])
        self.assertEqual([x['gpu']['label'] for x in json.loads((self.job/'pictured.json').read_text())['ranges']],
                         ['gpu0','gpu1','gpu2'])
        self.assertEqual(json.loads((self.job/'status.json').read_text())['state'],'pictured')
        self.assertEqual((self.job/'out/gpu0.mp4').read_bytes(),self.template.read_bytes())

    def test_changed_or_unreceipted_output_is_never_reused(self):
        attempt=self.job/'attempts'/'first'
        attempt.mkdir(parents=True)
        status=json.loads((self.job/'status.json').read_text())
        plan=range_retry.begin_or_update(self.job,status,self.context,attempt)
        self.assertEqual([x['label'] for x in plan['completed']],['gpu0'])
        pending,_=range_retry.pending_ranges(self.job,self.context)
        self.assertEqual([x['gpu']['label'] for x in pending],['gpu1','gpu2'])

        original=(self.job/'out/gpu0.mp4').read_bytes()
        (self.job/'out/gpu0.mp4').write_bytes(original+b'changed')
        pending,_=range_retry.pending_ranges(self.job,self.context)
        self.assertEqual([x['gpu']['label'] for x in pending],['gpu0','gpu1','gpu2'])

        (self.job/'out/gpu0.mp4').write_bytes(original)
        (self.job/'logs/gpu1.log').write_text('worker stopped before output receipt')
        pending,_=range_retry.pending_ranges(self.job,self.context)
        self.assertEqual([x['gpu']['label'] for x in pending],['gpu1','gpu2'])
        self.assertFalse(range_retry.eligible(
            self.job,dict(status,failure_kind='job_input'),self.context))


    def test_protocol_failed_context_loss_uses_pinned_repair_then_recovers_ranges(self):
        recipe=['sh videos/scripts/local_render.sh --seg scene:1']
        spec={'run':recipe,'outputs':[],'pipeline_commit':'pinned'}
        self.request.update(protocol_spec=spec,dependencies={})
        self.context['request']=self.request
        farm.write(self.job/'request.json',self.request)
        farm.write(self.job/'prepared.json',self.context)
        remote={'id':'scene-job','state':'failed','pipeline_commit':'pinned',
                'run':recipe,'outputs':[],'dependencies':{},
                'delivery':{'by':'homelab-v100-farm','why':'WebGL context loss'}}
        calls=[]
        def protocol(*args):
            calls.append(args)
            if args[0]=='show':
                return json.dumps(remote)
            if args[0]=='repair':
                self.assertEqual(args[1:4],('scene-job','--by','homelab-v100-farm'))
                remote.setdefault('repairs',[]).append(
                    {'by':remote['delivery']['by'],'failure':remote['delivery']})
                remote.update(state='open',claim=None,delivery=None)
                return ''
            if args[0]=='claim':
                self.assertEqual(args[1],'scene-job')
                remote.update(state='claimed',claim={'by':'homelab-v100-farm'})
                return ''
            raise AssertionError(args)
        def runner(argv,**kwargs):
            if argv[:2]==['docker','ps']:
                return ''
            if argv[:2]==['git','rev-parse']:
                return 'pinned'
            if argv[0]=='ffprobe':
                return json.dumps({'streams':[{'codec_type':'video','nb_read_frames':'2',
                    'width':1080,'height':1920,'avg_frame_rate':'30/1'}]})
            if argv[0]=='ffmpeg':
                return ''
            raise AssertionError(argv)
        with (
            patch.object(farm,'JOBS',self.root),
            patch.object(farm,'boot_id',return_value='new-boot'),
            patch.object(farm,'run',side_effect=runner),
            patch.object(recovery.subprocess,'run',
                         return_value=subprocess.CompletedProcess([],0,'','')),
            patch('protocol_bridge.command',side_effect=protocol),
            patch.dict(farm.CONFIG,protocol_enabled=True,protocol_worker='homelab-v100-farm'),
        ):
            recovery.recover()
        self.assertEqual([call[0] for call in calls],['show','repair','show','claim'])
        self.assertIn('--commit',calls[1])
        self.assertIn('--run',calls[1])
        self.assertEqual(remote['repairs'][0]['failure']['why'],'WebGL context loss')
        self.assertEqual(remote['state'],'claimed')
        status=json.loads((self.job/'status.json').read_text())
        self.assertEqual(status['state'],'prepared')
        plan=json.loads((self.job/'range-retry.json').read_text())
        self.assertEqual(plan['retry_count'],1)
        self.assertEqual([row['label'] for row in plan['completed']],['gpu0'])
        self.assertEqual(json.loads((self.job/'request.json').read_text()),self.request)

    def test_protocol_failed_context_loss_with_changed_pins_is_held(self):
        self.request.update(protocol_spec={'run':['different recipe'],'outputs':[],
                                          'pipeline_commit':'pinned'},dependencies={})
        self.context['request']=self.request
        farm.write(self.job/'request.json',self.request)
        farm.write(self.job/'prepared.json',self.context)
        remote={'state':'failed','pipeline_commit':'pinned','run':['original recipe'],
                'outputs':[],'dependencies':{},'delivery':{'by':'homelab-v100-farm'}}
        calls=[]
        def protocol(*args):
            calls.append(args)
            return json.dumps(remote)
        def runner(argv,**kwargs):
            if argv[:2]==['docker','ps']:
                return ''
            return 'pinned'
        with (
            patch.object(farm,'JOBS',self.root),
            patch.object(farm,'boot_id',return_value='new-boot'),
            patch.object(farm,'run',side_effect=runner),
            patch.object(recovery.subprocess,'run',
                         return_value=subprocess.CompletedProcess([],0,'','')),
            patch('protocol_bridge.command',side_effect=protocol),
            patch.dict(farm.CONFIG,protocol_enabled=True,protocol_worker='homelab-v100-farm'),
        ):
            recovery.recover()
        self.assertEqual([call[0] for call in calls],['show'])
        status=json.loads((self.job/'status.json').read_text())
        self.assertEqual(status['state'],'failed')
        self.assertIn('canonical job does not match',status['recovery_error'])
        self.assertFalse((self.job/'attempts').exists())

    def test_protocol_retry_limit_holds_failed_queue_without_reopening(self):
        recipe=['sh videos/scripts/local_render.sh --seg scene:1']
        self.request.update(protocol_spec={'run':recipe,'outputs':[],'pipeline_commit':'pinned'},
                            dependencies={})
        self.context['request']=self.request
        farm.write(self.job/'request.json',self.request)
        farm.write(self.job/'prepared.json',self.context)
        farm.write(self.job/'range-retry.json',{
            'schema':'acp.scene-range-retry/v1','pins':range_retry.pins(self.job,self.context),
            'retry_count':range_retry.MAX_EXPLICIT_RETRIES,'completed':[],'attempts':[]})
        remote={'state':'failed','pipeline_commit':'pinned','run':recipe,
                'outputs':[],'dependencies':{},'delivery':{'by':'homelab-v100-farm'}}
        calls=[]
        def protocol(*args):
            calls.append(args)
            return json.dumps(remote)
        def runner(argv,**kwargs):
            if argv[:2]==['docker','ps']:
                return ''
            if argv[:2]==['git','rev-parse']:
                return 'pinned'
            raise AssertionError(argv)
        with (
            patch.object(farm,'JOBS',self.root),
            patch.object(farm,'boot_id',return_value='new-boot'),
            patch.object(farm,'run',side_effect=runner),
            patch.object(recovery.subprocess,'run',
                         return_value=subprocess.CompletedProcess([],0,'','')),
            patch('protocol_bridge.command',side_effect=protocol),
            patch.dict(farm.CONFIG,protocol_enabled=True,protocol_worker='homelab-v100-farm'),
        ):
            recovery.recover()
        self.assertEqual([call[0] for call in calls],['show'])
        status=json.loads((self.job/'status.json').read_text())
        self.assertEqual(status['state'],'failed')
        self.assertIn('retry limit reached',status['recovery_error'])
        self.assertFalse((self.job/'attempts').exists())

    def test_recover_admits_terminal_context_loss_and_holds_live_running_job(self):
        original=json.loads((self.job/'status.json').read_text())
        live=dict(original,state='running',execution_boot_id='old-boot')
        farm.write(self.job/'status.json',live)

        def recover(containers):
            def runner(argv,**kwargs):
                if argv[:2]==['docker','ps']:
                    return containers
                if argv[:2]==['git','rev-parse']:
                    return 'pinned'
                if argv[0]=='ffprobe':
                    return json.dumps({'streams':[{'codec_type':'video','nb_read_frames':'2',
                        'width':1080,'height':1920,'avg_frame_rate':'30/1'}]})
                if argv[0]=='ffmpeg':
                    return ''
                raise AssertionError(argv)
            with patch.object(farm,'JOBS',self.root), \
                 patch.object(farm,'boot_id',return_value='new-boot'), \
                 patch.object(farm,'run',side_effect=runner), \
                 patch.object(recovery.subprocess,'run',
                              return_value=subprocess.CompletedProcess([],0,'','')), \
                 patch.dict(farm.CONFIG,protocol_enabled=False):
                recovery.recover()

        recover('acp-scene-job-worker\n')
        self.assertEqual(json.loads((self.job/'status.json').read_text())['state'],'running')
        self.assertFalse((self.job/'attempts').exists())

        failed=dict(original,execution_boot_id='new-boot')
        farm.write(self.job/'status.json',failed)
        recover('')
        status=json.loads((self.job/'status.json').read_text())
        self.assertEqual(status['state'],'prepared')
        self.assertEqual(json.loads((self.job/'range-retry.json').read_text())['retry_count'],1)
        self.assertTrue((self.job/'out/gpu0.mp4').is_file())
        self.assertEqual([row['label'] for row in json.loads(
            (self.job/'range-retry.json').read_text())['completed']],['gpu0'])

    def test_second_context_loss_preserves_newly_completed_range_and_caps_retries(self):
        def media(argv,**kwargs):
            if argv[0] in ('ffprobe','ffmpeg'):
                return subprocess.check_output(list(map(str,argv)),text=True)
            return 'pinned'
        with patch.object(farm,'run',side_effect=media):
            recovery.restore(self.job,json.loads((self.job/'status.json').read_text()))
        first=json.loads((self.job/'status.json').read_text())
        first_attempt=Path(first['previous_attempt'])
        self.assertTrue((first_attempt/'partial-picture/gpu1.mp4').exists())

        shutil.copyfile(self.template,self.job/'out/gpu1.mp4')
        (self.job/'logs/gpu1.log').write_text(
            'scene: wrote /work/videos/out/gpu1.mp4 in 1s (500 ms/frame incl. grab + encode)\n')
        (self.job/'logs/gpu2.log').write_text('GL_CONTEXT_LOST_KHR\n')
        (self.job/'out/gpu2.mp4').write_bytes(b'partial second attempt')
        failed=dict(first,state='failed',phase='rendering',failure_kind='render_context',
                    error='WebGL context loss in gpu2.log',finished='2026-10-19T00:02:00Z')
        farm.write(self.job/'status.json',failed)
        with patch.object(farm,'run',side_effect=media):
            recovery.restore(self.job,failed)
        second=json.loads((self.job/'status.json').read_text())
        plan=json.loads((self.job/'range-retry.json').read_text())
        self.assertEqual(plan['retry_count'],2)
        self.assertEqual([r['label'] for r in plan['completed']],['gpu0','gpu1'])
        self.assertTrue((self.job/'out/gpu0.mp4').is_file())
        self.assertTrue((self.job/'out/gpu1.mp4').is_file())
        self.assertFalse((self.job/'out/gpu2.mp4').exists())
        self.assertTrue((Path(second['previous_attempt'])/'partial-picture/gpu2.mp4').exists())

        def retry_failure_and_restore():
            (self.job/'logs').mkdir(exist_ok=True)
            (self.job/'logs/gpu2.log').write_text('GL_CONTEXT_LOST_KHR\n')
            (self.job/'out/gpu2.mp4').write_bytes(b'partial retry output')
            status=dict(second,state='failed',phase='rendering',failure_kind='render_context',
                        error='WebGL context loss in gpu2.log')
            farm.write(self.job/'status.json',status)
            with patch.object(farm,'run',side_effect=media):
                recovery.restore(self.job,status)
            return json.loads((self.job/'status.json').read_text())

        second=retry_failure_and_restore()
        self.assertEqual(json.loads((self.job/'range-retry.json').read_text())['retry_count'],3)
        (self.job/'logs').mkdir(exist_ok=True)
        (self.job/'logs/gpu2.log').write_text('GL_CONTEXT_LOST_KHR\n')
        blocked=dict(second,state='failed',phase='rendering',failure_kind='render_context',
                     error='WebGL context loss in gpu2.log')
        farm.write(self.job/'status.json',blocked)
        attempts_before=set((self.job/'attempts').iterdir())
        with patch.object(farm,'run',side_effect=media):
            with self.assertRaisesRegex(ValueError,'retry limit reached'):
                recovery.restore(self.job,blocked)
        self.assertEqual(set((self.job/'attempts').iterdir()),attempts_before)


    def test_recovery_keeps_retry_eligibility_bound_to_each_job_in_both_orders(self):
        hardware=self.root/'hardware-job'
        hardware.mkdir(exist_ok=True)
        recipe=['sh videos/scripts/local_render.sh --seg scene:1']
        self.request.update(protocol_spec={'run':recipe,'outputs':[],'pipeline_commit':'pinned'},dependencies={})
        self.context['request']=self.request
        farm.write(self.job/'request.json',self.request)
        farm.write(self.job/'prepared.json',self.context)
        farm.write(hardware/'request.json',{'kind':'scene','commit':'pinned','protocol_id':'hardware-job'})
        orderings=[(self.job,hardware),(hardware,self.job)]
        for order in orderings:
            with self.subTest(order=[path.name for path in order]):
                farm.write(self.job/'status.json', {
                    'state':'failed','phase':'rendering','failure_kind':'render_context',
                    'error':'WebGL context loss in gpu1.log,gpu2.log; outputs rejected',
                    'execution_boot_id':'old-boot'})
                farm.write(hardware/'status.json',{'state':'failed','phase':'rendering',
                    'failure_kind':'render_context','error':'GPU kernel check failed','execution_boot_id':'old-boot'})
                calls=[];restored=[];remote={}
                def protocol(*args):
                    calls.append(args)
                    identifier=args[1]
                    state=remote.setdefault(identifier,{'id':identifier,'state':'failed',
                        'pipeline_commit':'pinned','run':['sh videos/scripts/local_render.sh --seg scene:1'],
                        'outputs':[],'dependencies':{},
                        'delivery':{'by':'homelab-v100-farm','why':'WebGL context loss'}})
                    if args[0]=='show': return json.dumps(state)
                    if args[0]=='repair':
                        state.update(state='open',claim=None,delivery=None)
                        return ''
                    if args[0]=='claim':
                        state.update(state='claimed',claim={'by':'homelab-v100-farm'})
                        return ''
                    raise AssertionError(args)
                def runner(argv,**kwargs):
                    if argv[:2]==['docker','ps']: return ''
                    return 'pinned'
                real_iterdir=Path.iterdir
                def ordered_iterdir(path):
                    if path==self.root: return iter(order)
                    return real_iterdir(path)
                with (
                    patch.object(farm,'JOBS',self.root),
                    patch.object(farm,'boot_id',return_value='new-boot'),
                    patch.object(farm,'run',side_effect=runner),
                    patch.object(recovery.subprocess,'run',
                                 return_value=subprocess.CompletedProcess([],0,'','')),
                    patch.object(recovery.Path,'iterdir',ordered_iterdir),
                    patch.object(recovery,'restore',side_effect=lambda job,status: restored.append(job.name)),
                    patch('protocol_bridge.command',side_effect=protocol),
                    patch.dict(farm.CONFIG,protocol_enabled=True,protocol_worker='homelab-v100-farm'),
                ):
                    recovery.recover()
                repaired=[args[1] for args in calls if args[0]=='repair']
                self.assertEqual(repaired,['scene-job'])
                self.assertEqual(restored,['scene-job'])
                self.assertNotIn('recovery_error',json.loads((hardware/'status.json').read_text()))


if __name__=='__main__':
    unittest.main()
