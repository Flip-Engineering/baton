"""Local, operator-authorized review exchange with the existing Claude session."""
import json
import os
from pathlib import Path
import selectors
import socket
import time
import uuid

ROOT = Path('/tmp/baton-bend2-laws-review')
TARGET = '/tmp/cc-socks/1448.sock'
SESSION = '7c72f137-7943-4a2a-b6cb-500a0dfa866d'
ADDRESS = f'/tmp/cc-socks/{os.getpid()}.sock'
CONTROL = f'/tmp/cc-socks/{os.getpid()}.control.sock'
selector = selectors.DefaultSelector()


def record(name, value):
    with (ROOT / name).open('a') as output:
        output.write(json.dumps(value) + '\n')


def send(body):
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
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.connect(TARGET)
        client.sendall((json.dumps(frame) + '\n').encode())
    record('codex-delivery-outbox.jsonl', {'sent_at': time.time(), 'payload': frame})
    return message_id


for path, kind in [(ADDRESS, 'reply'), (CONTROL, 'control')]:
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(path)
    os.chmod(path, 0o600)
    server.listen()
    selector.register(server, selectors.EVENT_READ, kind)

metadata = {'pid': os.getpid(), 'reply': f'uds:{ADDRESS}', 'control': CONTROL,
            'target': f'uds:{TARGET}', 'session_id': SESSION}
(ROOT / 'codex-delivery-bridge.json').write_text(json.dumps(metadata, indent=2) + '\n')
message_id = send((ROOT / 'codex-review-message.txt').read_text())
print(json.dumps({'sent': message_id, **metadata}), flush=True)

try:
    while True:
        for key, _ in selector.select():
            connection, _ = key.fileobj.accept()
            with connection:
                with connection.makefile('r') as incoming:
                    for line in incoming:
                        try:
                            payload = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if key.data == 'control':
                            if payload.get('action') == 'send':
                                result = {'sent': send(payload['body'])}
                                connection.sendall((json.dumps(result) + '\n').encode())
                                break
                        elif payload.get('type') == 'user':
                            item = {'received_at': time.time(), 'payload': payload}
                            record('codex-delivery-inbox.jsonl', item)
                            print(json.dumps(item), flush=True)
                            break
finally:
    for path in [ADDRESS, CONTROL]:
        Path(path).unlink(missing_ok=True)
