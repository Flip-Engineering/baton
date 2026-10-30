# The waiter of a start that a draining instance owner refused (#1399): it waits
# in process for the owner to exit or be replaced, then redelivers the owed
# message. A delivery failure is observed by the existing
# delivery control (Control.redeliver: a busy failure retries until the writer is
# gone, any other failure is reported durably to the recipient's coordinator). A
# failure of the wait is reported the same way, with the same escalation, and is
# not retried: the wait fails at once, so a retry would be a loop without an event.
import Base
import ./control.bend as Control
import ../host/instance.bend as Custody

def wait_failed(+db: String, +message: String, +code: U32, +detail: String) -> IO(Unit):
  do IO<Unit>:
    +text : String <- IO.pure(String,"Waiting for the draining instance owner failed (error code " ++ U32.show(code) ++ "): " ++ detail ++ "; the input stays owed")
    reported : Result<&1,&1,U32 & String,String> <- Control.undelivered_reported(db,message,text)
    Control.escalated(db,message,code,text,reported)

def waited(+db: String, +message: String, status: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match status:
    case Done{state}: Control.redeliver(db,message)
    case Fail{(+code,+detail)}: wait_failed(db,message,code,detail)

def drain_redeliver(+db: String, +message: String) -> IO(Unit):
  do IO<Unit>:
    status : Result<&1,&1,U32 & String,String> <- Custody.Instance.owner_wait(db)
    waited(db,message,status)
