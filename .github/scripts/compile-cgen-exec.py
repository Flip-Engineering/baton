#!/usr/bin/env python3
"""Execute one queued compiler invocation for a staged C-generation attempt.

Execution-only module. The queue adapter submits this file as a queue input:
staging verifies its bytes against the key's input digest, and the executed
command names the staged copy. Every byte here is therefore part of the cache
key and of the executed closure. Keep diagnostics in queue-native-checks.py;
an edit to this file is an executed-semantics change and produces a new key.
"""
import os
import signal
import subprocess
import sys
from pathlib import Path


def main():
    output, *command = sys.argv[1:]
    code = subprocess.run(command).returncode
    if code < 0:
        # OOM #1068 killed the compiler with SIGKILL. Preserve its signal
        # disposition when the queue observes this process.
        signum = -code
        if signum not in (signal.SIGKILL, signal.SIGSTOP):
            signal.signal(signum, signal.SIG_DFL)
        os.kill(os.getpid(), signum)
        return 128 + signum
    if not code and '-o' not in command:
        Path(output).write_text('/* Compiler check completed successfully. */\n')
    return code


if __name__ == '__main__':
    raise SystemExit(main())
