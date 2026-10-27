import Base
import ./observer-checkpoint.bend as Observer

law failed_store_observation_does_not_advance_the_native_cursor:
  for +db: String
  for +handle: U32
  for +state: Observer.State
  for +spool: String
  for +code: U32
  for +text: String
  {Observer.after_observation(db,handle,spool,state,True{},False{},Fail{(code,text)}) == IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(code,text)}) : IO(Result<&1,&1,U32 & String,Unit>)}

law disabled_checkpoint_does_not_write_native_state:
  for +db: String
  for +handle: U32
  for +state: Observer.State
  for +spool: String
  {Observer.after_observation(db,handle,spool,state,False{},False{},Done{"observed"}) == IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}) : IO(Result<&1,&1,U32 & String,Unit>)}

law successful_observation_commits_the_reducer_snapshot:
  for +db: String
  for +handle: U32
  for +state: Observer.State
  for +spool: String
  for +body: String
  {Observer.after_observation(db,handle,spool,state,True{},False{},Done{body}) == Observer.commit_with_held(db,handle,spool,state,True{},False{}) : IO(Result<&1,&1,U32 & String,Unit>)}

law reducer_schema_version_is_explicit:
  {Observer.schema_version() == 1 : U32}

law held_prefix_progress_keeps_the_prior_replay_offset:
  for +prefix: String
  {Observer.checkpoint_due(Observer.empty(),Observer.make("0\n","","","","","","",prefix)) == False{} : Bool}

law output_cursor_progress_keeps_the_prior_replay_offset:
  for +offset: String
  {Observer.checkpoint_due_fields(Observer.with_output(Observer.make("0\n","","","","same terminal","","",""),"0"),Observer.with_output(Observer.make("0\n","","","","same terminal","","",""),offset),True{},True{},True{}) == False{} : Bool}

law terminal_change_advances_reducer_checkpoint:
  for +terminal: String
  {Observer.checkpoint_due_fields(Observer.make("0\n","","","","","","",""),Observer.make("0\n","","","",terminal,"","",""),True{},True{},True{}) == Bool.or(Bool.not(String.eq("",terminal)),False{}) : Bool}

law omp_completed_message_advances_reducer_checkpoint:
  for +message: String
  {Observer.checkpoint_due(Observer.empty(),Observer.make("0\n",message,"","","","","","")) == Bool.or(Bool.not(String.eq("",message)),False{}) : Bool}

law muse_primary_identity_advances_reducer_checkpoint:
  for +command: String
  {Observer.checkpoint_due(Observer.empty(),Observer.make("0\n","",command,"","","","","")) == Bool.or(Bool.not(String.eq("",command)),False{}) : Bool}

law first_spanned_output_advances_checkpoint:
  {Observer.checkpoint_due_span(Observer.empty(),Observer.with_output(Observer.empty(),"1"),True{},True{},True{},True{}) == True{} : Bool}

law later_progress_span_keeps_the_prior_checkpoint:
  {Observer.checkpoint_due_span(Observer.with_output(Observer.empty(),"10"),Observer.with_output(Observer.empty(),"20"),True{},True{},True{},True{}) == False{} : Bool}

law retained_terminal_seals_later_span_checkpoints:
  {Observer.checkpoint_due_span(Observer.make("0\n","","","","terminal","","",""),Observer.make("0\n","","","","terminal","","",""),True{},True{},True{},True{}) == False{} : Bool}

def first_spanned_output_advances_checkpoint():
  {==}

def later_progress_span_keeps_the_prior_checkpoint():
  {==}

def retained_terminal_seals_later_span_checkpoints():
  {==}

def failed_store_observation_does_not_advance_the_native_cursor(db,handle,state,spool,code,text):
  {==}

def disabled_checkpoint_does_not_write_native_state(db,handle,state,spool):
  {==}

def successful_observation_commits_the_reducer_snapshot(db,handle,state,spool,body):
  {==}

def reducer_schema_version_is_explicit():
  {==}

def held_prefix_progress_keeps_the_prior_replay_offset(prefix):
  {==}

def output_cursor_progress_keeps_the_prior_replay_offset(offset):
  {==}

def terminal_change_advances_reducer_checkpoint(terminal):
  {==}

def omp_completed_message_advances_reducer_checkpoint(message):
  {==}

def muse_primary_identity_advances_reducer_checkpoint(command):
  {==}
