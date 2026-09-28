"""Record receive behavior after killing its supervisor with a native child alive.

Run from the repository root after building .scratch/bend2/baton2.
Uses controlled harness processes and a fresh database. JSON reports observations;
a duplicate is an unresolved runtime defect.
"""
import importlib
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
receive = importlib.import_module('bend2.test.receive')


def process_rows(*pids):
    result = subprocess.run(
        ['ps', '-o', 'pid=,ppid=,stat=', '-p', ','.join(map(str, pids))],
        capture_output=True, text=True, check=False,
    )
    if result.returncode not in (0, 1):
        raise RuntimeError(result.stderr)
    return result.stdout.splitlines()


def main():
    fixture = receive.Receive()
    orphan = None
    try:
        fixture.setUp()
        source = fixture.fixture.read_text()
        source = source.replace('import json,pathlib,re,socket,subprocess,sys',
                                'import json,pathlib,re,socket,subprocess,sys,os')
        source = source.replace("reply({'session':model,",
                                "reply({'pid':os.getpid(),'session':model,")
        source = source.replace("    if action.get('turn'):",
                                "    if action.get('exit_probe'): break\n    if action.get('turn'):")
        fixture.fixture.write_text(source)
        fixture.worker()
        fixture.message('first', 'parent')
        first = fixture.spawn(*fixture.receive_args('parent'))
        orphan, started = fixture.accept('parent')
        binding = fixture.coord('session', 'parent')
        first.kill()
        first.communicate(timeout=5)
        surviving = process_rows(started['pid'])

        retry = fixture.spawn(*fixture.receive_args('parent'))
        control, resumed = fixture.accept('parent')
        overlap = process_rows(started['pid'], resumed['pid'])
        evidence = {
            'source': subprocess.check_output(
                ['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
            'firstSupervisor': first.pid,
            'firstNative': started['pid'],
            'supervisorExit': first.returncode,
            'survivingNative': surviving,
            'recordedNativeId': binding['native'],
            'retrySupervisor': retry.pid,
            'retryNative': resumed['pid'],
            'retryResumeId': resumed['resume'],
            'retryIncludesPendingInput': '[id: first]' in resumed['prompt'],
            'overlap': overlap,
            'duplicateNativeSession': len(overlap) == 2 and resumed['resume'] == binding['native'],
            'pendingBeforeCompletion': fixture.coord('inbox', 'parent'),
        }
        fixture.action(control)
        fixture.finish(retry)
        evidence['pendingAfterRetry'] = fixture.coord('inbox', 'parent')
        evidence['turnsAfterRetry'] = fixture.coord('turns', 'parent')
        print(json.dumps(evidence, indent=2))
    finally:
        try:
            if orphan is not None:
                # Release the owned fixture without writing to its dead supervisor.
                try:
                    fixture.action(orphan, exit_probe=True)
                    if orphan.readline() != b'':
                        raise RuntimeError('Expected the orphan fixture control socket to close')
                except (OSError, ValueError):
                    pass
        finally:
            fixture.doCleanups()


if __name__ == '__main__':
    main()
