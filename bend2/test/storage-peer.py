"""A consumer owned by the native storage fixture."""
import ctypes
import os
import pathlib
import signal
import sys

proc = pathlib.Path(os.environ['BATON_STORAGE_TEST_PROC'])
entry = proc / str(os.getpid())
held = os.open(sys.argv[1], os.O_RDONLY) if sys.argv[1] else None
if sys.argv[2] == '1':
    assert ctypes.CDLL(None).prctl(4, 0, 0, 0, 0) == 0


def finish(signum, frame):
    raise SystemExit(0)


signal.signal(signal.SIGTERM, finish)
entry.symlink_to(f'/proc/{os.getpid()}')
try:
    print('ready', flush=True)
    signal.pause()
finally:
    entry.unlink()
    if held is not None:
        os.close(held)
