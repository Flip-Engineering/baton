"""The native Codex proxy retains WebSocket messages and actual child status."""
import json
import os
import pathlib
import shlex
import signal
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]

PROXY = r'''import base64,hashlib,json,os,pathlib,signal,struct,sys
assert sys.argv[1:]==['app-server','proxy']
inp=sys.stdin.buffer;out=sys.stdout.buffer
def read(size):
    data=b''
    while len(data)<size:
        part=inp.read(size-len(data))
        if not part: raise EOFError(data.hex())
        data+=part
    return data
def frame(payload,opcode=1,final=True):
    start=bytes([(128 if final else 0)|opcode])
    if len(payload)<126: start+=bytes([len(payload)])
    elif len(payload)<65536: start+=b'\x7e'+struct.pack('!H',len(payload))
    else: start+=b'\x7f'+struct.pack('!Q',len(payload))
    out.write(start+payload);out.flush()
def incoming():
    a,b=read(2);assert a&128 and b&128
    size=b&127
    if size==126:size=struct.unpack('!H',read(2))[0]
    elif size==127:size=struct.unpack('!Q',read(8))[0]
    mask=read(4);payload=read(size)
    return a&15,bytes(v^mask[i%4] for i,v in enumerate(payload))
header=b''
while not header.endswith(b'\r\n\r\n'):header+=read(1)
assert header.startswith(b'GET / HTTP/1.1\r\n')
key=next(line.split(b':',1)[1].strip() for line in header.split(b'\r\n') if line.lower().startswith(b'sec-websocket-key:'))
accept=base64.b64encode(hashlib.sha1(key+b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest())
mode=os.environ['BATON_CODEX_FIXTURE']
if mode=='bad-upgrade':out.write(b'HTTP/1.1 403 Forbidden\r\nX-Error: complete cause\r\n\r\n');out.flush();inp.read();sys.exit(23)
out.write(b'HTTP/1.1 101 Switching Protocols\r\nSec-WebSocket-Accept: '+accept+b'\r\n\r\n');out.flush()
if mode=='echo':
    opcode,payload=incoming();assert opcode==1
    greeting=json.dumps({'method':'notice','params':{'text':'\u2603\U0001f680','home':os.environ['HOME'],'codexHome':os.environ['CODEX_HOME'],'cwd':os.getcwd()}},ensure_ascii=False,separators=(',',':')).encode()
    cut=greeting.index('\U0001f680'.encode())+1
    frame(greeting[:cut],final=False);frame(b'ping payload',9);frame(greeting[cut:],0)
    assert incoming()==(10,b'ping payload')
    frame(payload)
elif mode=='utf8':frame(b'\xed\xa0\x80')
elif mode=='binary':frame(b'\x00\xffcomplete',2)
elif mode=='partial':out.write(b'\x81\x05ab');out.flush();sys.exit(9)
elif mode=='external':
    signal.signal(signal.SIGINT,signal.SIG_DFL)
    signal.signal(signal.SIGTERM,signal.SIG_DFL)
    frame(b'{"ready":true}')
    signal.pause()
elif mode=='blocked-close':frame(b'{"ready":true}')
elif mode=='cancel':
    # The parent cancels only after the complete upgrade was observed.
    signal.pause()
opcode,payload=incoming();assert opcode==8 and payload==b''
frame(b'',8);assert inp.read()==b''
sys.exit(7 if mode=='exit-seven' else 0)
'''


class CodexProxy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='baton-codex-transport-')
        cls.home = pathlib.Path(cls.temp.name)
        cls.binary = cls.home / 'transport'
        compiler = shlex.split(os.environ.get('CC', 'clang'))
        command = [*compiler, '-std=c11', '-D_GNU_SOURCE', '-O1', '-pthread',
                   str(ROOT / 'bend2/test/codex-proxy.c'), '-o', str(cls.binary)]
        built = subprocess.run(command, capture_output=True)
        if built.returncode:
            raise RuntimeError(f'{command!r}\n{built.stdout.decode()}\n{built.stderr.decode()}')
        proxy = cls.home / 'codex'
        proxy.write_text(f'#!{sys.executable}\n' + PROXY)
        proxy.chmod(0o700)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def run_proxy(self, mode, operation, *arguments):
        env = {**os.environ, 'PATH': str(self.home) + os.pathsep + os.environ['PATH'],
               'HOME': str(self.home / 'recorded home'),
               'CODEX_HOME': str(self.home / 'recorded codex home'),
               'BATON_CODEX_FIXTURE': mode}
        return subprocess.run([str(self.binary), operation, *map(str, arguments)],
                              cwd=self.home, env=env, capture_output=True)

    def test_fragmented_notifications_ping_and_large_raw_rpc_error(self):
        value = {'id': 17, 'error': {'code': -32001, 'message': 'complete cause',
                 'data': {'retained': '\u2603\U0001f680' * 30000}}}
        raw = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()
        path = self.home / 'request.json'
        path.write_bytes(raw)
        result = self.run_proxy('echo', 'echo', path)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        notice, response, status = result.stdout.splitlines()
        self.assertEqual(response, raw)
        self.assertEqual(status, b'exit 0')
        self.assertEqual(json.loads(notice), {'method': 'notice', 'params': {
            'text': '\u2603\U0001f680', 'home': str(self.home / 'recorded home'),
            'codexHome': str(self.home / 'recorded codex home'), 'cwd': str(self.home)}})

    def test_upgrade_failure_retains_full_response(self):
        result = self.run_proxy('bad-upgrade', 'close')
        self.assertEqual(result.returncode, 1)
        response = b'HTTP/1.1 403 Forbidden\r\nX-Error: complete cause\r\n\r\n'
        self.assertIn(response.hex().encode(), result.stderr)

    def test_invalid_utf8_retains_complete_bytes(self):
        result = self.run_proxy('utf8', 'next')
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertIn(b'invalid UTF-8 bytes: eda080', result.stderr)
        self.assertEqual(result.stdout, b'exit 0\n')

    def test_binary_frame_retains_complete_bytes(self):
        result = self.run_proxy('binary', 'next')
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertIn(b'00ff636f6d706c657465', result.stderr)

    def test_partial_frame_preserves_bytes_and_actual_exit(self):
        result = self.run_proxy('partial', 'next')
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertIn(b'incomplete bytes: 6162', result.stderr)
        self.assertEqual(result.stdout, b'exit 9\n')

    def test_close_returns_actual_nonzero_exit(self):
        result = self.run_proxy('exit-seven', 'close')
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(result.stdout, b'exit 7\n')

    def test_cancel_refuses_actual_retired_child_with_outstanding_reference(self):
        result = self.run_proxy('exit-seven', 'retired-cancel')
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(result.stdout, b'retired-child-refused\n')

    def test_cancel_returns_actual_signal(self):
        result = self.run_proxy('cancel', 'cancel')
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(result.stdout, f'signal {signal.SIGTERM}\n'.encode())

    def test_bend_effect_registration_and_results(self):
        binary = ROOT / '.scratch/bend2/codex-proxy-test'
        env = {**os.environ, 'PATH': str(self.home) + os.pathsep + os.environ['PATH'],
               'HOME': str(self.home / 'recorded home'),
               'CODEX_HOME': str(self.home / 'recorded codex home'),
               'BATON_CODEX_FIXTURE': 'echo'}
        result = subprocess.run([str(binary)], cwd=self.home, env=env, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        notice, response, status = result.stdout.splitlines()
        self.assertEqual(json.loads(notice)['params']['text'], '\u2603\U0001f680')
        self.assertEqual(json.loads(response), {'id': 1, 'method': 'transport-test'})
        self.assertEqual(status, b'exit 0')

    def test_close_settles_a_concurrent_blocked_reader(self):
        result = self.run_proxy('blocked-close', 'blocked-close')
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(result.stdout, b'exit 0\n')

    def test_external_interrupt_restores_prior_handlers_after_actual_wait(self):
        result = self.run_proxy('external', 'external-int')
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(result.stdout, f'signal {signal.SIGINT}\n'.encode())

    def test_external_termination_restores_prior_handlers_after_actual_wait(self):
        result = self.run_proxy('external', 'external-term')
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(result.stdout, f'signal {signal.SIGTERM}\n'.encode())

    def test_external_signal_reaches_all_owned_handles_until_last_close(self):
        result = self.run_proxy('external', 'external-two')
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(result.stdout, (f'signal {signal.SIGTERM}\n' * 2).encode())


if __name__ == '__main__':
    unittest.main()
