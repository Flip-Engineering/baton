#!/usr/bin/env python3
"""Exercise the real account binding before any provider process can start."""
import os
import pathlib
import subprocess
import tempfile


def main():
    smoke = os.environ.get('BATON2_ACCOUNT_BINDING_SMOKE')
    helper = os.environ.get('BATON2_API_KEY_EXEC')
    if not smoke or not helper:
        raise SystemExit('BATON2_ACCOUNT_BINDING_SMOKE and BATON2_API_KEY_EXEC must name the built fixtures')
    with tempfile.TemporaryDirectory() as directory:
        root = pathlib.Path(directory)
        secret = root / 'secret with spaces'
        secret.write_text('sk-binding-smoke\n')
        secret.chmod(0o600)
        marker = root / 'child-started'
        stub = root / 'stub with spaces.sh'
        stub.write_text('#!/bin/sh\nprintf started > ' + repr(str(marker)) + '\n')
        stub.chmod(0o755)
        result = subprocess.run(
            [smoke, helper, 'file:' + str(secret), str(stub), 'model', 'high'],
            capture_output=True, text=True, check=False)
        assert result.returncode == 0, (result.returncode, result.stderr)
        assert result.stdout.strip() == 'credit-admission-refused', result.stdout
        assert result.stderr == '', result.stderr
        assert not marker.exists(), 'the retained child started despite the hold'
        assert secret.read_text() == 'sk-binding-smoke\n'


if __name__ == '__main__':
    main()
