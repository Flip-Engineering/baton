"""Read Darwin process identity for the isolated scientific observer."""

import ctypes
import json
import os
import re
import struct
import subprocess
import sys


MAXCOMLEN = 16
PROC_PIDTBSDINFO = 3
CTL_KERN = 1
KERN_PROCARGS2 = 49


class ProcBsdInfo(ctypes.Structure):
    _fields_ = [
        ("flags", ctypes.c_uint32), ("status", ctypes.c_uint32),
        ("exit_status", ctypes.c_uint32), ("pid", ctypes.c_uint32),
        ("ppid", ctypes.c_uint32), ("uid", ctypes.c_uint32),
        ("gid", ctypes.c_uint32), ("ruid", ctypes.c_uint32),
        ("rgid", ctypes.c_uint32), ("svuid", ctypes.c_uint32),
        ("svgid", ctypes.c_uint32), ("reserved", ctypes.c_uint32),
        ("comm", ctypes.c_char * MAXCOMLEN),
        ("name", ctypes.c_char * (2 * MAXCOMLEN)),
        ("nfiles", ctypes.c_uint32), ("pgid", ctypes.c_uint32),
        ("pjobc", ctypes.c_uint32), ("tty", ctypes.c_uint32),
        ("tpgid", ctypes.c_uint32), ("nice", ctypes.c_int32),
        ("start_sec", ctypes.c_uint64), ("start_usec", ctypes.c_uint64),
    ]


LIBPROC = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
LIBSYSTEM = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
LIBPROC.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64,
                                 ctypes.c_void_p, ctypes.c_int]
LIBPROC.proc_pidinfo.restype = ctypes.c_int
LIBPROC.proc_pidpath.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
LIBPROC.proc_pidpath.restype = ctypes.c_int
LIBSYSTEM.sysctl.argtypes = [ctypes.POINTER(ctypes.c_int), ctypes.c_uint,
                             ctypes.c_void_p, ctypes.POINTER(ctypes.c_size_t),
                             ctypes.c_void_p, ctypes.c_size_t]
LIBSYSTEM.sysctl.restype = ctypes.c_int


def argv_of(pid):
    mib = (ctypes.c_int * 3)(CTL_KERN, KERN_PROCARGS2, pid)
    size = ctypes.c_size_t()
    if LIBSYSTEM.sysctl(mib, 3, None, ctypes.byref(size), None, 0) != 0:
        raise OSError(ctypes.get_errno(), 'KERN_PROCARGS2 size')
    if size.value < ctypes.sizeof(ctypes.c_int):
        raise ValueError('KERN_PROCARGS2 returned too few bytes')
    raw_buffer = ctypes.create_string_buffer(size.value)
    if LIBSYSTEM.sysctl(mib, 3, raw_buffer, ctypes.byref(size), None, 0) != 0:
        raise OSError(ctypes.get_errno(), 'KERN_PROCARGS2 value')
    raw = raw_buffer.raw[:size.value]
    argc = struct.unpack_from('=i', raw)[0]
    if argc < 1 or argc > 65536:
        raise ValueError('Invalid KERN_PROCARGS2 argc')
    position = raw.index(b'\0', 4) + 1
    while position < len(raw) and raw[position] == 0:
        position += 1
    argv = []
    for _ in range(argc):
        end = raw.index(b'\0', position)
        argv.append(os.fsdecode(raw[position:end]))
        position = end + 1
    return argv


def cwd_of(pid):
    result = subprocess.run(['/usr/sbin/lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'],
                            capture_output=True, text=True, check=False)
    if result.returncode != 0:
        return {'unavailable': {'status': result.returncode, 'stderr': result.stderr}}
    names = [line[1:] for line in result.stdout.splitlines() if line.startswith('n')]
    return {'path': names[0]} if len(names) == 1 else {'unavailable': {'names': names}}


def process(pid):
    info = ProcBsdInfo()
    ctypes.set_errno(0)
    amount = LIBPROC.proc_pidinfo(pid, PROC_PIDTBSDINFO, 0,
                                  ctypes.byref(info), ctypes.sizeof(info))
    if amount == 0:
        return {'pid': pid, 'unavailable': {'errno': ctypes.get_errno()}}
    if amount != ctypes.sizeof(info) or info.pid != pid:
        return {'pid': pid, 'unavailable': {'bytes': amount, 'expected': ctypes.sizeof(info)}}
    birth = [info.start_sec, info.start_usec]
    # A zombie may retain BSD identity after its argv and executable are gone.
    if info.status == 5:
        after = ProcBsdInfo()
        ctypes.set_errno(0)
        after_amount = LIBPROC.proc_pidinfo(pid, PROC_PIDTBSDINFO, 0,
                                            ctypes.byref(after), ctypes.sizeof(after))
        if after_amount != ctypes.sizeof(after) or after.pid != pid or \
                [after.start_sec, after.start_usec] != birth:
            return {'pid': pid, 'unavailable': {'operation': 'zombie generation changed',
                                               'errno': ctypes.get_errno(), 'bytes': after_amount}}
        return {'pid': pid, 'ppid': info.ppid, 'uid': info.uid,
                'birth': birth, 'status': info.status, 'argv': None,
                'exe': None, 'cwd': None}
    buffer = ctypes.create_string_buffer(4096)
    length = LIBPROC.proc_pidpath(pid, buffer, ctypes.sizeof(buffer))
    if length <= 0:
        return {'pid': pid, 'unavailable': {'operation': 'proc_pidpath',
                                           'errno': ctypes.get_errno()}}
    try:
        argv = argv_of(pid)
    except (OSError, ValueError, IndexError) as error:
        return {'pid': pid, 'unavailable': {'operation': 'KERN_PROCARGS2',
                                           'errno': getattr(error, 'errno', None),
                                           'error': repr(error)}}
    cwd = cwd_of(pid)
    after = ProcBsdInfo()
    ctypes.set_errno(0)
    after_amount = LIBPROC.proc_pidinfo(pid, PROC_PIDTBSDINFO, 0,
                                        ctypes.byref(after), ctypes.sizeof(after))
    if after_amount != ctypes.sizeof(after):
        return {'pid': pid, 'unavailable': {'operation': 'proc_pidinfo after argv',
                                           'errno': ctypes.get_errno(), 'bytes': after_amount}}
    if after.pid != pid or [after.start_sec, after.start_usec] != birth:
        return {'pid': pid, 'unavailable': {'operation': 'process generation changed',
                                           'beforeBirth': birth,
                                           'afterBirth': [after.start_sec, after.start_usec],
                                           'afterPid': after.pid}}
    if after.status == 5:
        return {'pid': pid, 'ppid': after.ppid, 'uid': after.uid,
                'birth': birth, 'status': after.status, 'argv': None,
                'exe': None, 'cwd': None}
    return {'pid': pid, 'ppid': after.ppid, 'uid': after.uid,
            'birth': birth,
            'status': after.status, 'argv': argv,
            'exe': os.path.realpath(os.fsdecode(buffer.raw[:length].rstrip(b'\0'))),
            'cwd': cwd.get('path'), 'cwdObservation': cwd}


def candidates(work, executable):
    result = subprocess.run(['/bin/ps', '-ww', '-axo', 'pid=,command='],
                            capture_output=True, text=True, check=True)
    rows = []
    for line in result.stdout.splitlines():
        match = re.match(r'^\s*(\d+)\s+(.*)$', line)
        if match and int(match.group(1)) != os.getpid() and \
                (work in match.group(2) or executable in match.group(2)):
            row = process(int(match.group(1)))
            row['candidateCommand'] = match.group(2)
            rows.append(row)
    return rows


if __name__ == '__main__':
    if sys.argv[1] == 'one' and len(sys.argv) == 3:
        value = process(int(sys.argv[2]))
    elif sys.argv[1] == 'all' and len(sys.argv) == 4:
        value = candidates(sys.argv[2], sys.argv[3])
    else:
        raise SystemExit('Usage: darwin-process.py one PID | all WORK EXECUTABLE')
    print(json.dumps(value, sort_keys=True))
