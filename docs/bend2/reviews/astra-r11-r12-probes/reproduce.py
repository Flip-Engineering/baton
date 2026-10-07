"""Reproduce revision 12 evidence and the combined review's adversarial probes."""
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
WORK = HERE / '.work'
WORK.mkdir(exist_ok=True)
BEND = Path(sys.argv[1]).resolve()
PIN = '3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c'
assert hashlib.sha256(BEND.read_bytes()).hexdigest() == PIN, 'compiler digest mismatch'
ENV = {**os.environ, 'BEND_NO_TELEMETRY': '1', 'TMPDIR': str(WORK)}


def apply_recorded_diff(source, diff):
    lines = source.splitlines()
    changes = []
    chunks = re.split(r'(?m)^(\d+(?:,\d+)?[acd]\d+(?:,\d+)?)\n', diff.strip() + '\n')
    for header, body in zip(chunks[1::2], chunks[2::2]):
        original, action, _ = re.fullmatch(r'(\d+(?:,\d+)?)([acd])(\d+(?:,\d+)?)', header).groups()
        span = [int(n) for n in original.split(',')]
        start, end = span[0] - 1, span[-1]
        old = [line[2:] for line in body.splitlines() if line.startswith('< ')]
        new = [line[2:] for line in body.splitlines() if line.startswith('> ')]
        if action == 'a':
            start = end
        else:
            assert lines[start:end] == old, (header, lines[start:end], old)
        changes.append((start, end, new))
    for start, end, new in reversed(changes):
        lines[start:end] = new
    return '\n'.join(lines) + '\n'


def invoke(path, check=True):
    args = [str(path.relative_to(ROOT))] + (['--check-only'] if check else [])
    result = subprocess.run([str(BEND), *args], cwd=ROOT, env=ENV, text=True, capture_output=True)
    print('$ BEND_NO_TELEMETRY=1 $BEND ' + ' '.join(args), flush=True)
    for output in [result.stdout, result.stderr]:
        print('\n'.join(line.rstrip(' \t') for line in output.split('\n')), end='', flush=True)
    print('exit=' + str(result.returncode), flush=True)
    return result


print('Compiler SHA256: ' + PIN)
for stem in ['no-ledger', 'no-ceiling', 'derived-catalog', 'orchestrator-authority']:
    path = ROOT / 'docs/bend2/examples' / ('laws-' + stem + '.bend')
    invoke(path)
    invoke(path, False)
    if stem == 'no-ledger':
        continue
    evidence = path.with_suffix('.evidence.md').read_text()
    for number, diff in enumerate(re.findall(r'```diff\n(.*?)```', evidence, re.S), 1):
        control = WORK / (stem + '-control-' + str(number) + '.bend')
        control.write_text(apply_recorded_diff(path.read_text(), diff))
        invoke(control)
for name in ['a-inputs', 'a-timer', 'a-transition', 'b-exclusion', 'b-discovery', 'c-relation', 'c-dispatch', 'g1', 'g1-always-deny', 'g1-smuggle', 'g2', 'g2-label', 'g2-orchestrator-wait']:
    path = HERE / (name + '.bend')
    invoke(path)
    invoke(path, False)
# Direct violations inside the quantified functions must be rejected.
g1 = (HERE / 'g1.bend').read_text().replace('  observed_allowed\n', '  match notes:\n    case 0n: observed_allowed\n    case 1n+n: False{}\n', 1)
(WORK / 'g1-control.bend').write_text(g1)
invoke(WORK / 'g1-control.bend')
g2 = (HERE / 'g2.bend').read_text().replace('def required(record: Nat) -> Need:\n  NoAct{}', 'def required(record: Nat) -> Need:\n  Bookkeeping{}', 1)
(WORK / 'g2-control.bend').write_text(g2)
invoke(WORK / 'g2-control.bend')

transition = (HERE / 'a-transition.bend').read_text().replace('case Tick{}: state', 'case Tick{}: ExternalFailed{}', 1)
(WORK / 'a-transition-control.bend').write_text(transition)
invoke(WORK / 'a-transition-control.bend')
