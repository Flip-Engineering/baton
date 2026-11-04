#!/usr/bin/env python3
"""Build the target through the queue and retain its request keys and reuse receipts."""
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys


def main():
    target, evidence = map(Path, sys.argv[1:])
    queue = runpy.run_path(str(Path(__file__).with_name('queue-native-checks.py')))
    environment = queue['legacy_environment'](dict(os.environ))
    # Each invocation computes its key, then the native client verifies and copies
    # a completed result for that key or submits the request on a miss.
    code = subprocess.run(['sh', 'bend2/scripts/build-native.sh'], cwd=target, env=environment).returncode
    requests = []
    for path in sorted((evidence / 'compile-queue').glob('*/request.json')):
        request = json.loads(path.read_text())
        receipt = path.with_name('receipt')
        fields = None
        if receipt.is_file():
            fields = dict(line.split('=', 1) for line in receipt.read_text().splitlines() if '=' in line)
        requests.append({'key': request['key'], 'request': str(path.relative_to(evidence)),
                         'exit_code': request.get('exit_code'), 'receipt': fields})
    result = {'schema': 'baton2-target-build-reuse-v2', 'exit_code': code, 'requests': requests}
    (evidence / 'target-build-reuse.json').write_text(json.dumps(result, indent=2) + '\n')
    return code


if __name__ == '__main__':
    raise SystemExit(main())
