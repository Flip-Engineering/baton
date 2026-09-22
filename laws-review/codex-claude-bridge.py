"""Local, operator-authorized review exchange with the existing Claude session."""
import json
import os
from pathlib import Path
import selectors
import signal
import socket
import subprocess
import time
import uuid

ROOT = Path('/tmp/baton-bend2-laws-review')
SESSION = '7c72f137-7943-4a2a-b6cb-500a0dfa866d'
ADDRESS = f'/tmp/cc-socks/{os.getpid()}.sock'
CONTROL = f'/tmp/cc-socks/{os.getpid()}.control.sock'
selector = selectors.DefaultSelector()


def record(name, value):
    with (ROOT / name).open('a') as output:
        output.write(json.dumps(value) + '\n')


def current_target():
    result = subprocess.run(['claude', 'agents', '--json'], check=True,
                            text=True, capture_output=True, timeout=10)
    matches = [agent for agent in json.loads(result.stdout)
               if agent.get('sessionId') == SESSION]
    if len(matches) != 1:
        raise RuntimeError('Expected one live Claude process for the authorized session')
    agent = matches[0]
    pid = agent.get('pid')
    if not isinstance(pid, int) or pid <= 0:
        raise RuntimeError('Claude discovery returned an invalid process identity')
    return f'/tmp/cc-socks/{pid}.sock', agent


def metadata(target=None):
    value = {'pid': os.getpid(), 'reply': f'uds:{ADDRESS}', 'control': CONTROL,
             'session_id': SESSION, 'routing': 'live-session-discovery',
             'startup_replay': False, 'target': f'uds:{target}' if target else None}
    temporary = ROOT / f'codex-delivery-bridge.{os.getpid()}.json.tmp'
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(ROOT / 'codex-delivery-bridge.json')
    return value


def send(body):
    if not isinstance(body, str) or not body.strip():
        return {'error': 'A nonempty message body is required', 'delivery': 'not_attempted'}
    message_id = str(uuid.uuid4())
    content = (
        f'<cross-session-message from="uds:{ADDRESS}" '
        'from-name="Codex-bend2-review" from-mode="bypass">\n'
        + body + '\n</cross-session-message>'
    )
    frame = {
        'msgV': 1, 'msg_id': message_id, 'type': 'user',
        'message': {'role': 'user', 'content': content},
        'priority': 'next', 'session_id': SESSION, 'from': f'uds:{ADDRESS}',
    }
    target = None
    delivery = 'not_attempted'
    try:
        target, agent = current_target()
        metadata(target)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(10)
            client.connect(target)
            delivery = 'unknown'
            client.sendall((json.dumps(frame) + '\n').encode())
        result = {'sent': message_id, 'target': f'uds:{target}',
                  'target_pid': agent['pid'], 'delivery': 'written_to_socket'}
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        result = {'message_id': message_id, 'target': f'uds:{target}' if target else None,
                  'delivery': delivery, 'error': str(error)}
    record('codex-delivery-outbox.jsonl',
           {'sent_at': time.time(), **result, 'payload': frame})
    return result


def stop(signum, frame):
    raise SystemExit(0)


def main():
    signal.signal(signal.SIGTERM, stop)
    for path, kind in [(ADDRESS, 'reply'), (CONTROL, 'control')]:
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        server.bind(path)
        os.chmod(path, 0o600)
        server.listen()
        selector.register(server, selectors.EVENT_READ, kind)
    print(json.dumps({'ready': True, **metadata()}), flush=True)
    try:
        while True:
            for key, _ in selector.select():
                connection, _ = key.fileobj.accept()
                with connection:
                    try:
                        with connection.makefile('r') as incoming:
                            for line in incoming:
                                payload = json.loads(line)
                                if key.data == 'control':
                                    if payload.get('action') == 'send':
                                        result = send(payload.get('body'))
                                    elif payload.get('action') == 'status':
                                        target, agent = current_target()
                                        result = {'ready': True, **metadata(target)}
                                    else:
                                        result = {'error': 'Unknown control action'}
                                    connection.sendall((json.dumps(result) + '\n').encode())
                                    break
                                elif payload.get('type') == 'user':
                                    item = {'received_at': time.time(), 'payload': payload}
                                    record('codex-delivery-inbox.jsonl', item)
                                    print(json.dumps(item), flush=True)
                                    break
                    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
                        record('codex-delivery-errors.jsonl',
                               {'at': time.time(), 'error': str(error), 'channel': key.data})
                        try:
                            connection.sendall((json.dumps({'error': str(error)}) + '\n').encode())
                        except OSError:
                            pass
    finally:
        selector.close()
        for path in [ADDRESS, CONTROL]:
            Path(path).unlink(missing_ok=True)


if __name__ == '__main__':
    main()
