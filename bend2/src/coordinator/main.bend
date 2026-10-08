# The entry imports the operative laws module. Every compile of this file,
# including the native build of the executable, therefore verifies every
# operative law and its proof; an unproven or false law fails that compile.
import Base
import ./laws.bend as Laws
import ./store.bend as Store
import ./turn.bend as Turn
import ./stop.bend as Stop
import ./receive.bend as Receive
import ./native-requests.bend as NativeRequests
import ./recruit.bend as Recruit
import ./land.bend as Land
import ./knowledge.bend as Knowledge
import ./usage.bend as Usage
import ./logs.bend as Logs
import ./ui-view.bend as UiView
import ./commands.bend as C
import ./control.bend as Control
import ./wake.bend as Wake
import ./control-laws.bend as ControlLaws
import ../host/text.bend as T
import ../host/process.bend as P

def output(value: String, empty: Bool) -> IO(Unit):
  match empty:
    case True{}: IO.die(Unit,1,"No matching session or message; inspect status and the requested ID.")
    case False{}: IO.write(value)

def print_result(+result: String) -> IO(Unit):
  output(result, String.is_empty(result))

# The entry's own answer path. An empty answer is a refusal that names the next
# action; a non-empty answer is the command's own text, written unchanged.

# M-14: an empty answer refuses with the rule and the next action it names.
law m14_an_empty_answer_names_its_rule:
  for +value: String
  {output(value, True{}) == IO.die(Unit,1,"No matching session or message; inspect status and the requested ID.") : IO(Unit)}

def m14_an_empty_answer_names_its_rule(value):
  {==}

# M-1: a non-empty answer is the command's own text, written as it stands.
law m1_a_non_empty_answer_is_written_unchanged:
  for +value: String
  {output(value, False{}) == IO.write(value) : IO(Unit)}

def m1_a_non_empty_answer_is_written_unchanged(value):
  {==}

# M-14: the entry answers the store's result as it stands, refusing exactly when
# the store's answer was empty.
law m14_an_empty_store_answer_is_refused:
  {print_result(SNil{}) == output(SNil{}, True{}) : IO(Unit)}

def m14_an_empty_store_answer_is_refused():
  {==}

law m1_a_stored_answer_is_written_unchanged:
  for +h: Char
  for +t: String
  {print_result(SCon{h, t}) == output(SCon{h, t}, False{}) : IO(Unit)}

def m1_a_stored_answer_is_written_unchanged(h, t):
  {==}

# A committed message admission is evaluated for a due wake before the entry
# answers. Refused admissions never reach the driver: Store.apply fails first.
def run(+db: String, +command: C.Command) -> IO(Unit):
  do IO<Unit>:
    +result : String <- IO.try(String, Store.apply(db,command))
    woken : Result<&1,&1,U32 & String,Unit> <- Wake.drive_command(db,command,Done{result})
    print_result(result)

law stored_command_entry_uses_the_actual_store:
  for db: String
  for command: C.Command
  {run(db,command) == (do IO<Unit>:
    +result : String <- IO.try(String,Store.apply(db,command))
    woken : Result<&1,&1,U32 & String,Unit> <- Wake.drive_command(db,command,Done{result})
    print_result(result)) : IO(Unit)}

def stored_command_entry_uses_the_actual_store(db,command):
  {==}

def usage() -> String:
  "usage: baton2 DATABASE COMMAND ARGS\nstart SESSION HARNESS HARNESS_CMD MODEL EFFORT CWD OUTPUT_LOG TASK_ID TASK_FILE\nreceiver SESSION HARNESS_CMD OUTPUT_LOG\ndispatch-file ID SENDER RECIPIENT KIND PATH\ndispatch-turn PLAYER TURN_ID HARNESS_CMD OUTPUT_LOG TASK_FILE\nstatus --pretty\nplayers --pretty\norchestra --pretty\npending --pretty\nplayer ID --pretty\nsession ID --pretty\ninbox ID --pretty\ndelivery ID --pretty\nturns PLAYER_ID --pretty\nknowledge READER --pretty\nworktree ID --pretty\nattach ID HARNESS NATIVE ENDPOINT\nrecruit ID PARENT HARNESS MODEL EFFORT REPO BRANCH PATH BASE\nworktree ID\nconnect ID NATIVE ENDPOINT\nbind ID NATIVE HARNESS MODEL EFFORT\nconfigure ID HARNESS MODEL EFFORT HARNESS_CMD OUTPUT_LOG EXPECTED_HARNESS EXPECTED_MODEL EXPECTED_EFFORT\nrole SESSION [player|principal-conductor|associate-conductor|operator]\nensemble ID [OWNER [loose|tight]]\nensemble-member ID OWNER PLAYER add|remove\nsection ENSEMBLE SECTION [OWNER CAPABILITY]\nsection-member ENSEMBLE SECTION OWNER PLAYER add|remove\norchestra\nmessage ID SENDER RECIPIENT KIND BODY\nmessage-file ID SENDER RECIPIENT KIND PATH\nobserve-file ID PLAYER PATH\nreport ID PLAYER BODY\nask ID PLAYER BODY\nask-file ID PLAYER PATH\nnative-reply PARENT REQUEST RESPONSE_JSON\nnative-reply-file PARENT REQUEST PATH\nsession ID\ndelivery ID\npending\ninbox RECIPIENT\nack ID RECIPIENT NATIVE_RECEIPT\nstatus\nplayers\nplayer ID\nturns PLAYER_ID\nland PLAYER_ID REPO TARGET_BRANCH\nland-checked PLAYER_ID REPO TARGET_BRANCH CHECK FILES\npush REPO BRANCH REMOTE\nremote-tip REPO BRANCH REMOTE\nobserved-usage SESSION\nlogs SESSION [LEVEL [BUDGET_BYTES [KEEP_SEGMENTS]]]\nlogs-storage\nlogs-clean SESSION\nview SUBJECT [READER [PORT]]\nturn PLAYER TURN_ID HARNESS_CMD MODEL EFFORT CWD TASK_FILE OUTPUT_LOG RESUME_SESSION\nstop SESSION STOP_ID REASON\nforce-stop SESSION STOP_ID\nreceive SESSION HARNESS_CMD MODEL EFFORT CWD OUTPUT_LOG MESSAGE_ID\nrecord FINDING_ID AUTHOR CLAIM EVIDENCE LIMITS\nknowledge READER\npromote PROMOTION_ID PROMOTER SOURCE DESTINATION FINDING\nview starts the optional read-only Orchestra live view: a loopback server for the subject's recorded state under the reader's admitted scope (default the subject itself), opened in a browser when one answers; it serves until the command exits.\nEmpty receive MODEL/EFFORT/CWD use recorded values; empty MESSAGE_ID reads the pending inbox.\nPATH - reads stdin; empty RESUME_SESSION starts a new native session\nconfigure changes one registered Player's route for its next admitted turn, keeps its identity, parentage, workspace, branch, base, native conversation and pending input, and rebuilds the receiver endpoint from the selected model key; the expected route fences a delayed continuation.\nComplete stored input: delivery MESSAGE_ID returns the full body and receipt of any message; turns PLAYER_ID lists turn history with report bodies; players reports latestReport and latestReportId. Acknowledged messages leave inbox and pending and remain readable by ID."
