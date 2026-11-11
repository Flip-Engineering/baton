#!/usr/bin/env python3
"""Per-piece notes inbox: a way to get the client's notes into a round that is already running (1 Oct).

Messaging an agent inside a running workflow takes it out of the workflow (and can leave two copies running), so notes
that arrive mid-round go into research/inbox/<PIECE>.md instead. Builders re-read their piece's inbox before each
render and before publishing; render.mjs and publish.sh print it as a notice. Nothing here blocks anything.

    python3 videos/scripts/inbox.py add HORDE "text of the note"      # append a dated note (the studio does this)
    python3 videos/scripts/inbox.py show HORDE                         # print the inbox (a piece name or a scene name)
    python3 videos/scripts/inbox.py show horde3                        # scene names resolve to their piece
    python3 videos/scripts/inbox.py path HORDE                         # the file's path
Studios use their own names: inbox.py add studio_music "..."
    python3 videos/scripts/inbox.py close HORDE                        # the round ended: file the notes away
An inbox is for the round in flight. When a round ends, `close` files its notes in research/inbox/done/; the client's notes
on the series stay in the piece's record (research/pieces/<PIECE>.md), client_feedback_verbatim.md and PIECE_NOTES.
"""
import datetime
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
BOX = os.path.join(ROOT, 'research', 'inbox')


def pieces():
    """PIECE -> scene, from gate.py's map (read as text so importing gate's dependencies isn't needed)."""
    import ast
    import re
    src = open(os.path.join(HERE, 'gate.py')).read()
    m = re.search(r'^PIECES = (\{.*?\n\})', src, re.S | re.M)
    try:
        return ast.literal_eval(m.group(1)) if m else {}
    except Exception:
        return {}


def resolve(name):
    if os.path.exists(os.path.join(BOX, name + '.md')):
        return name
    p = pieces()
    if name in p:
        return name
    for k, v in p.items():
        if v == name or name.rstrip('0123456789') == v.rstrip('0123456789'):
            return k
    return name


def path(name):
    return os.path.join(BOX, resolve(name) + '.md')


def main(argv):
    if len(argv) < 2 or argv[0] not in ('add', 'show', 'path', 'close'):
        print(__doc__)
        return 2
    cmd, name = argv[0], argv[1]
    f = path(name)
    if cmd == 'path':
        print(f)
    elif cmd == 'add':
        os.makedirs(BOX, exist_ok=True)
        new = not os.path.exists(f)
        with open(f, 'a') as o:
            if new:
                o.write('# Notes inbox: %s\n\nNotes that arrived while a round was running, newest last. Read them before each render and before publishing; they win over an older brief where they differ (guidance, not rules).\n' % resolve(name))
            o.write('\n## %s\n\n%s\n' % (datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC'), ' '.join(argv[2:]).strip()))
        print(f)
    elif cmd == 'close':
        if os.path.exists(f):
            done = os.path.join(BOX, 'done'); os.makedirs(done, exist_ok=True)
            dst = os.path.join(done, '%s_%s.md' % (resolve(name), datetime.datetime.utcnow().strftime('%Y%m%d-%H%M')))
            os.replace(f, dst)
            print('closed ->', os.path.relpath(dst, ROOT))
    elif cmd == 'show':
        if os.path.exists(f):
            print('=' * 72)
            print('NOTES INBOX for %s (%s), read before rendering or publishing:' % (resolve(name), os.path.relpath(f, ROOT)))
            print(open(f).read().rstrip())
            print('=' * 72)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
