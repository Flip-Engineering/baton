# Host Unix domain socket effect: one-shot send to a path.
#
# Backed by bend2/src/host/unix-socket.c. Used by the harness wake module to
# deliver a cross-session frame to a Claude Code session socket.

import Base

def UnixSocket.send(path: String, data: String) -> IO(Unit):
  import "./unix-socket.c"
