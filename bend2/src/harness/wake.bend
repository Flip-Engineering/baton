# Claude Code root wake delivery.
#
# Constructs a cross-session NDJSON frame and writes it to the session socket
# at /tmp/cc-socks/<pid>.sock. A message delivered this way starts a new turn
# in the targeted Claude Code session.

import Base
import ../host/socket.bend as S

def dq() -> String:
  SCon{Char.from_u32(34), SNil{}}

def backslash() -> String:
  SCon{Char.from_u32(92), SNil{}}

def cp(c: Char) -> U32:
  Char.to_u32(c)

def is_eq(a: U32, b: U32) -> Bool:
  U32.is_eq(a, b)

def esc_char_inner(+code: U32, is_dq: Bool) -> String:
  match is_dq:
    case True{}: backslash() ++ dq()
    case False{}: Bool.pick(String, is_eq(code, 92), backslash() ++ backslash(),
      Bool.pick(String, is_eq(code, 10), backslash() ++ "n",
      Bool.pick(String, is_eq(code, 13), backslash() ++ "r",
      Bool.pick(String, is_eq(code, 9), backslash() ++ "t",
        SCon{Char.from_u32(code), SNil{}}))))

def esc_char(+c: Char) -> String:
  esc_char_inner(cp(c), is_eq(cp(c), 34))

def json_escape(s: String) -> String:
  match s:
    case SNil{}: SNil{}
    case SCon{+head, +tail}: esc_char(head) ++ json_escape(tail)

def json_str(s: String) -> String:
  dq() ++ json_escape(s) ++ dq()

def kv(key: String, val: String) -> String:
  json_str(key) ++ ":" ++ val

def frame_content(+from_name: String, body: String) -> String:
  "<cross-session-message from=" ++ dq() ++ from_name ++ dq()
  ++ " from-name=" ++ dq() ++ from_name ++ dq()
  ++ " from-mode=" ++ dq() ++ "bypass" ++ dq()
  ++ ">\n" ++ body ++ "\n</cross-session-message>"

def frame_message(content: String) -> String:
  "{" ++ kv("role", json_str("user")) ++ "," ++ kv("content", json_str(content)) ++ "}"

def wake_frame(+session_id: String, +from_name: String, +msg_id: String, body: String) -> String:
  "{" ++ kv("msgV", "1")
  ++ "," ++ kv("msg_id", json_str(msg_id))
  ++ "," ++ kv("type", json_str("user"))
  ++ "," ++ kv("message", frame_message(frame_content(from_name, body)))
  ++ "," ++ kv("priority", json_str("next"))
  ++ "," ++ kv("session_id", json_str(session_id))
  ++ "," ++ kv("from", json_str(from_name))
  ++ "}\n"

def socket_path(pid: U32) -> String:
  "/tmp/cc-socks/" ++ U32.show(pid) ++ ".sock"

def deliver_wake(+pid: U32, session_id: String, from_name: String, msg_id: String, body: String) -> IO(Unit):
  S.UnixSocket.send(socket_path(pid), wake_frame(session_id, from_name, msg_id, body))
