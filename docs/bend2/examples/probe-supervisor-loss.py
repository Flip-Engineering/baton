"""Verify native output and queued work survive a killed receive observer.

Run after building .scratch/bend2/baton2. The probe uses a fresh database and
socket-controlled native fixtures. It kills only its own receive observer.
JSON includes partial evidence on failure; --output retains it in a file.
"""
import argparse
import hashlib
import importlib
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
receive = importlib.import_module('bend2.test.receive')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--harness', choices=('codex', 'omp'), default='codex')
    parser.add_argument('--no-retry', action='store_true',
                        help='verify recovery without another receive invocation')
    parser.add_argument('--terminal-before-loss', action='store_true',
                        help='kill the observer after terminal output while native exit is held')
    parser.add_argument('--output', type=pathlib.Path)
    args = parser.parse_args()
    evidence = {
        'source': subprocess.check_output(
            ['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'executable': str(receive.EXE),
        'executableSha256': hashlib.sha256(receive.EXE.read_bytes()).hexdigest(),
        'harness': args.harness,
        'retryRequested': not args.no_retry,
        'terminalBeforeObserverLoss': args.terminal_before_loss,
        'duplicateNativeSession': None,
        'postLossOutputRetained': False,
        'originalCompletionRetained': False,
        'pendingInputDrained': False,
        'parentNotified': False,
    }
    fixture = receive.Receive()
    try:
        fixture.setUp()
        fixture.exercise_observer_loss(args.harness, retry=not args.no_retry,
                                       terminal_before_loss=args.terminal_before_loss,
                                       evidence=evidence)
        evidence['status'] = 'passed'
    except Exception as error:
        evidence.update({'status': 'failed', 'error': type(error).__name__ + ': ' + str(error)})
    finally:
        if hasattr(fixture, 'directory'):
            evidence['processesBeforeCleanup'] = fixture.owned_processes()
            log = fixture.directory / 'parent.jsonl'
            if log.exists():
                evidence['retainedNativeLog'] = log.read_text(errors='replace')
        if not fixture.doCleanups():
            evidence.update({'status': 'failed', 'cleanupFailed': True})
    serialized = json.dumps(evidence, indent=2) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized)
    print(serialized, end='')
    return 0 if evidence['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
