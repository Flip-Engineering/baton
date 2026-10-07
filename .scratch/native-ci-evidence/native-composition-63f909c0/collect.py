#!/usr/bin/python3.12
"""Collect retained evidence into retained-evidence.tar.gz."""
from pathlib import Path
import subprocess
import tarfile

ROOT = Path('/mnt/nvme4tb/ci-runners/baton2-native-homelab/qualifications/native-composition-63f909c0')
OUT = ROOT / 'retained-evidence.tar.gz'
members = ['evidence', 'candidate-dirty.patch', 'provision-toolchain.txt',
           'provision-stdlib.txt', 'executor.pid', 'executor-started.txt',
           'executor-ended.txt', 'executor-exit.json', 'service-home-before.txt',
           'service-home-after.txt', 'service.stdout', 'service.stderr',
           'inputs.sha256', 'provision.sh', 'qualify.py', 'executor.sh',
           'collect.py', 'toolchain.sha256', 'compiler.sha256',
           'python-stdlib.sha256']
with tarfile.open(OUT, 'w:gz') as tar:
    for name in members:
        path = ROOT / name
        if path.exists():
            tar.add(path, arcname=name)
subprocess.run(['sha256sum', OUT.name], cwd=ROOT, check=True)
