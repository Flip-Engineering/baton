#!/usr/bin/env python3
"""Fixture for the retained Claude argv with one api_key account.

The smoke composes the real account binding and Claude profile argv, then runs
the native api-key helper with a stub Claude command whose path and model/effort
arguments contain spaces. The stub prints the child environment and arguments.
No live credential, account, or provider is used.
"""
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
        stub = root / 'stub with spaces.sh'
        stub.write_text(
            '#!/bin/sh\n'
            'printf "CMD=%s\\n" "$0"\n'
            'printf "KEY=%s\\n" "${ANTHROPIC_API_KEY-}"\n'
            'printf "AUTH=%s\\n" "${ANTHROPIC_AUTH_TOKEN-}"\n'
            'printf "OAUTH=%s\\n" "${CLAUDE_CODE_OAUTH_TOKEN-}"\n'
            'printf "ARG=%s\\n" "$@"\n')
        stub.chmod(0o755)
        result = subprocess.run(
            [smoke, helper, 'file:' + str(secret), str(stub), 'model with spaces', 'high effort'],
            capture_output=True, text=True, check=False)
        assert result.returncode == 0, (result.returncode, result.stderr)
        output = result.stdout
        assert 'KEY=sk-binding-smoke' in output, output
        assert 'AUTH=\n' in output and 'OAUTH=\n' in output, output
        assert 'CMD=' + str(stub) in output, output
        assert 'ARG=model with spaces' in output, output
        assert 'ARG=high effort' in output, output
        assert 'sk-binding-smoke' not in result.stderr


if __name__ == '__main__':
    main()
