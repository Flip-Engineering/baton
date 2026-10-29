#!/usr/bin/env python3
"""Execute one queued compiler invocation for a staged C-generation attempt.

Execution-only module. The queue adapter submits this file as a queue input:
staging verifies its bytes against the key's input digest, and the executed
command names the staged copy. Every byte here is therefore part of the cache
key and of the executed closure. Keep diagnostics in queue-native-checks.py;
an edit to this file is an executed-semantics change and produces a new key.

The compiler keeps emitted units in a directory it reads from
BEND_CGEN_CACHE_DIR. This module chooses that directory and passes it to the
compiler explicitly; a value inherited from the job environment is ignored.

The choice rests on file ownership, which the kernel enforces. A host
administrator creates <state root>/cgen-cache/trusted, owned by the one user that
may publish units and writable by no one else (no group, other or ACL write
entry, access or default). A compile that runs as that user shares the
directory and runs with umask 022, so that what it publishes can be read by others. A compile that runs as any other user gets
<state root>/cgen-cache/untrusted/<uid>, a directory only that user can use.
The unit cache treats a failed write as an observed error and goes on, so a user
that can read but not write the shared directory would lose only the writes.

Which jobs run as the publishing user is decided by where the workflow sends
them (runner labels or groups); this module cannot see the job's event. The
decision and its reason are written to cache-selection.json in the attempt
directory.
"""
import json
import os
import signal
import stat
import struct
import subprocess
import sys
import time
from pathlib import Path

ACL_USER, ACL_GROUP_OBJ, ACL_GROUP, ACL_MASK, ACL_OTHER = 0x02, 0x04, 0x08, 0x10, 0x20
WRITE = 0x02


def state_root(output):
    """The queue state root that owns this attempt: the directory that holds keys/."""
    for parent in Path(output).resolve().parents:
        if parent.name == 'keys' and (parent.parent / 'heavy.lock').exists():
            return parent.parent
    return None


def acl_grants_write(path, name):
    """True if the ACL stored under extended attribute `name` lets anyone but the owner write."""
    try:
        data = os.getxattr(path, name, follow_symlinks=False)
    except OSError:
        return False
    entries = [struct.unpack_from('<HHI', data, at) for at in range(4, len(data) - 7, 8)]
    mask = next((perm for tag, perm, _ in entries if tag == ACL_MASK), 0x07)
    for tag, perm, _ in entries:
        if tag == ACL_OTHER and perm & WRITE:
            return True
        if tag in (ACL_USER, ACL_GROUP, ACL_GROUP_OBJ) and perm & mask & WRITE:
            return True
    return False


def sole_writer(path, uid=None):
    """(ok, reason): `path` is a directory that `uid` owns and no one else can write."""
    uid = os.getuid() if uid is None else uid
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return False, 'the shared cache directory does not exist'
    except OSError as error:
        return False, 'cannot read the shared cache directory: ' + error.__class__.__name__
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        return False, 'the shared cache path is not a plain directory'
    if info.st_uid != uid:
        return False, 'the shared cache directory is owned by uid %d, not by the running user (uid %d)' % (info.st_uid, uid)
    if info.st_mode & 0o022:
        return False, 'the shared cache directory is writable by its group or by others'
    for name in ('system.posix_acl_access', 'system.posix_acl_default'):
        if acl_grants_write(path, name):
            return False, 'the shared cache directory has an ACL that lets another user or group write (%s)' % name
    # Whoever can write the parent can rename the shared directory away and put another in its place,
    # unless the parent is sticky (only an entry's owner can rename or remove it).
    parent = os.lstat(os.path.dirname(path))
    if parent.st_mode & 0o022 and not parent.st_mode & stat.S_ISVTX:
        return False, 'the parent directory is writable by others and not sticky, so the shared directory could be replaced'
    return True, 'the running user owns the shared cache directory and no one else can write it'


def private_directory(state):
    path = state / 'cgen-cache' / 'untrusted' / str(os.getuid())
    previous = os.umask(0o077)
    try:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = path.stat()
    except OSError as error:
        return None, 'cannot create the private cache: ' + error.__class__.__name__
    finally:
        os.umask(previous)
    if info.st_uid != os.getuid() or info.st_mode & 0o077:
        return None, 'the private cache is not private to this user'
    return path, ''


def select(output, environment):
    """(directory, selection) for this attempt."""
    selection = {'schema': 'baton2-cgen-cache-selection-v2', 'inherited_cache_dir': environment.get('BEND_CGEN_CACHE_DIR'),
                 'inherited_xdg_cache_home': environment.get('XDG_CACHE_HOME'), 'uid': os.getuid(),
                 'decided_at': time.time(), 'shared': False, 'reason': ''}
    state = state_root(output)
    directory = None
    if state is None:
        selection['reason'] = 'the attempt is not inside a queue state root'
        selection['kind'] = 'attempt'
    else:
        shared = state / 'cgen-cache' / 'trusted'
        ok, reason = sole_writer(shared)
        selection['reason'] = reason
        if ok:
            directory, selection['shared'], selection['kind'] = shared, True, 'shared'
        else:
            directory, problem = private_directory(state)
            selection['kind'] = 'private'
            if directory is None:
                selection['reason'] += '; ' + problem
                selection['kind'] = 'attempt'
    if directory is None:
        directory = Path(output).resolve().parent / 'cgen-cache'
        directory.mkdir(parents=True, exist_ok=True)
    info = directory.stat()
    selection.update(directory=str(directory), mode=oct(stat.S_IMODE(info.st_mode)), owner=info.st_uid, group=info.st_gid,
                     inode=info.st_ino)
    return directory, selection


def main():
    output, *command = sys.argv[1:]
    environment = dict(os.environ)
    directory, selection = select(output, environment)
    environment['BEND_CGEN_CACHE_DIR'] = str(directory)
    if selection['shared']:
        # The runner unit sets umask 0077, which would make every published unit unreadable to other users.
        os.umask(0o022)
        selection['umask'] = '022'
    try:
        (Path(output).resolve().parent.parent / 'cache-selection.json').write_text(json.dumps(selection, indent=2) + '\n')
    except OSError:
        # Evidence only; the compiler must still run.
        pass
    code = subprocess.run(command, env=environment).returncode
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
