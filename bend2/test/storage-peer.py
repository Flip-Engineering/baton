"""A consumer owned by the native storage fixture."""
import ctypes
import os
import pathlib
import signal
import sys

LINUX = sys.platform == 'linux'
proc = pathlib.Path(os.environ['BATON_STORAGE_TEST_PROC'])
entry = proc / str(os.getpid())
held = os.open(sys.argv[1], os.O_RDONLY) if sys.argv[1] else None
# PR_SET_DUMPABLE off makes this account's own /proc entries unreadable, the
# same evidence shape as an unreadable launcher. Linux only: other platforms
# have no dumpable toggle and the peer stays readable.
if sys.argv[2] == '1' and LINUX:
    assert ctypes.CDLL(None).prctl(4, 0, 0, 0, 0) == 0


def finish(signum, frame):
    raise SystemExit(0)


signal.signal(signal.SIGTERM, finish)
if LINUX:
    # Failed native tests release their fixture consumers when the parent exits.
    assert ctypes.CDLL(None).prctl(1, signal.SIGTERM, 0, 0, 0) == 0
if os.getppid() == 1:
    raise SystemExit('native fixture already exited')
entry.symlink_to(f'/proc/{os.getpid()}')
try:
    print('ready', flush=True)
    signal.pause()
finally:
    entry.unlink()
    if held is not None:
        os.close(held)
