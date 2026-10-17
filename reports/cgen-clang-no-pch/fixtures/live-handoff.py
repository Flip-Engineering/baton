import hashlib, importlib.util, json, os, pathlib, signal, sqlite3, subprocess, sys, unittest
work=pathlib.Path('/run/baton2-native-homelab/retained/baton2-compiler-741-20261015/postrelease-751-761-20261015-11/source')
module_path=work/'bend2/test/receive.py'
spec=importlib.util.spec_from_file_location('baton_receive_focus', module_path)
mod=importlib.util.module_from_spec(spec)
sys.modules[spec.name]=mod
spec.loader.exec_module(mod)
exe=pathlib.Path('/run/baton2-native-homelab/retained/baton-compiler-forkflush-20261016T195048Z/worktrees/cgen-clang-review-20261017/reports/cgen-clang-review/scratch/qual60-no-pch/baton2').resolve()
mod.EXE=exe
(work/'bend2/.scratch/bend2').mkdir(parents=True,exist_ok=True)

def argv(pid):
    return [x.decode(errors='replace') for x in pathlib.Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')[:-1]]

def live_handoff_twice(self):
    self.player('parent','omp')
    self.prepare_input('live-handoff-task','parent','Read and complete the controlled live-handoff task.',kind='task')
    observer=self.spawn(*self.receive_args('parent'))
    stream,started=self.accept_child(observer,'parent')
    native=started['native']
    provider_pid=started['pid']
    self.assertIn('Read and complete the controlled live-handoff task.',started['prompt'])
    attempt=pathlib.Path(self.execution('parent')[2])
    checkpoint=attempt/'checkpoint'
    raw=attempt/'stdout'
    def wait_for(observation,description,seconds=10):
        deadline=__import__('time').monotonic()+seconds
        while __import__('time').monotonic()<deadline:
            value=observation()
            if value: return value
            __import__('time').sleep(.02)
        self.fail(description)
    wait_for(lambda: checkpoint.is_file() and raw.is_file(), 'receiver did not create checkpoint/raw spool')
    st=raw.stat(); cp=checkpoint.read_bytes()
    def checkpoint_output(data):
        at=data.find(b'{"schema":1,')
        if at<0: return None
        return int(json.loads(data[at:])['output'])
    initial_output=checkpoint_output(cp)
    self.assertIsNotNone(initial_output,'checkpoint has no schema-1 output cursor')
    first_argv=argv(observer.pid)
    self.assertEqual(pathlib.Path(first_argv[1]).resolve(), self.db.resolve())
    self.assertEqual(first_argv[2:4], ['receive', 'parent'])
    self.assertEqual(len(first_argv), 10)
    # An unrelated live caller process must be refused and remain alive.
    wrong=os.getpid(); wrong_before=int(pathlib.Path(f'/proc/{wrong}/stat').read_text().split()[21])
    denied=self.coord('recover-observer','parent',wrong,ok=False)
    self.assertNotEqual(denied.returncode,0,denied.stdout+denied.stderr)
    self.assertEqual(int(pathlib.Path(f'/proc/{wrong}/stat').read_text().split()[21]),wrong_before)
    self.assertIsNone(observer.poll(),'wrong PID refusal retired the real observer')
    # First supported handover replaces the normal public receive observer.
    one=self.spawn('recover-observer','parent',observer.pid)
    self.finish_observer_during_recovery(observer,one,drain=True)
    self.assertEqual(observer.returncode,-signal.SIGTERM)
    self.assertIsNone(one.poll(),'first replacement exited before the second handover')
    one_argv=argv(one.pid)
    self.assertGreaterEqual(len(one_argv),5)
    self.assertEqual(pathlib.Path(one_argv[1]).resolve(),self.db.resolve())
    self.assertEqual(one_argv[2:4],['recover-observer','parent'])
    self.assertEqual(one_argv[4],str(observer.pid))
    self.assertEqual(self.coord('player','parent')['native'],native)
    os.kill(provider_pid,0)
    # Prove the same native still accepts and the replacement observes its stream.
    raw_before_one=raw.stat().st_size
    self.action(stream,progress='after-first-handoff')
    self.assertEqual(json.loads(stream.readline()),{'progress_written':'after-first-handoff'})
    wait_for(lambda: checkpoint.is_file() and (checkpoint_output(checkpoint.read_bytes()) or -1)>initial_output,
             'first replacement did not advance the durable output cursor')
    self.assertEqual(raw.stat().st_ino,st.st_ino)
    self.assertGreater(raw.stat().st_size,raw_before_one,'first controlled delta did not reach raw spool')
    after_one=checkpoint.read_bytes()
    self.assertTrue(after_one,'checkpoint disappeared after first handover')
    output_one=checkpoint_output(after_one)
    self.assertIsNotNone(output_one)
    self.assertGreater(output_one,initial_output,'checkpoint cursor did not advance at first handover')
    # Second handover targets a recover-observer process whose argv names the prior observer.
    two=self.spawn('recover-observer','parent',one.pid)
    self.finish_observer_during_recovery(one,two,drain=True)
    self.assertEqual(one.returncode,-signal.SIGTERM)
    self.assertIsNone(two.poll(),'second replacement exited before the native completed')
    two_argv=argv(two.pid)
    self.assertGreaterEqual(len(two_argv),5)
    self.assertEqual(pathlib.Path(two_argv[1]).resolve(),self.db.resolve())
    self.assertEqual(two_argv[2:4],['recover-observer','parent'])
    self.assertEqual(two_argv[4],str(one.pid))
    self.assertEqual(self.coord('player','parent')['native'],native)
    raw_before_two=raw.stat().st_size
    self.action(stream,progress='after-second-handoff')
    self.assertEqual(json.loads(stream.readline()),{'progress_written':'after-second-handoff'})
    wait_for(lambda: checkpoint.is_file() and (checkpoint_output(checkpoint.read_bytes()) or -1)>output_one,
             'second replacement did not advance the durable output cursor')
    self.assertEqual(raw.stat().st_ino,st.st_ino)
    self.assertGreater(raw.stat().st_size,raw_before_two,'second controlled delta did not reach raw spool')
    final_checkpoint=checkpoint.read_bytes()
    self.assertTrue(final_checkpoint,'checkpoint missing after second handover')
    output_final=checkpoint_output(final_checkpoint)
    self.assertIsNotNone(output_final)
    self.assertGreater(output_final,output_one,'checkpoint cursor did not advance at second handover')
    self.assertEqual(self.coord('player','parent')['native'],native)
    os.kill(provider_pid,0)
    raw_before_terminal=raw.stat().st_size
    self.action(stream,body='The same native completed after two guarded observer handovers.',
                exit_after_terminal=True,hold_exit=True,complete_task=False)
    self.assertEqual(json.loads(stream.readline()),{'terminal_written':True})
    self.action(stream,exit_fixture=True)
    self.finish(two)
    self.assertEqual(self.coord('player','parent')['native'],native)
    self.assertEqual(self.coord('delivery','live-handoff-task')['receipt'],'native-reviewed')
    self.assertEqual(len(self.coord('turns','parent')),1)
    raw_after=raw.stat() if raw.exists() else None
    if raw_after is not None:
        self.assertEqual(raw_after.st_ino,st.st_ino)
        self.assertGreaterEqual(raw_after.st_size,raw_before_terminal)
    self.assertTrue(cp)
    self.shutdown_idle_database_owner('controlled owner did not exit')
    print(json.dumps({'candidate':str(exe),'candidateSha256':hashlib.sha256(exe.read_bytes()).hexdigest(),
                      'native':native,'providerPid':provider_pid,'attempt':attempt.name,
                      'firstTargetArgv':'receive','secondTargetArgv':'recover-observer',
                      'rawInodeBeforeTerminal':st.st_ino,'rawSizeBeforeTerminal':raw_before_terminal,
                      'rawPresentAfterTerminalCleanup':raw_after is not None,
                      'checkpointBytesFinal':len(final_checkpoint),
                      'checkpointOutputCursors':[initial_output,output_one,output_final],
                      'taskReceipt':'native-reviewed'}),flush=True)

mod.Receive.test_candidate_live_handoff_twice=live_handoff_twice
assert mod.Receive.coord.__globals__['EXE'] is mod.EXE
assert str(mod.EXE)==str(exe)
print(json.dumps({'selectedExe':str(exe),'sha256':hashlib.sha256(exe.read_bytes()).hexdigest(),
                  'methodGlobalExe':str(mod.Receive.coord.__globals__['EXE'].resolve())}),flush=True)
suite=unittest.TestSuite([mod.Receive('test_candidate_live_handoff_twice')])
result=unittest.TextTestRunner(stream=sys.stdout,verbosity=2).run(suite)
sys.exit(0 if result.wasSuccessful() else 1)
