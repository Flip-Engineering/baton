import Base
import ./observer-checkpoint.bend as Observer

law failed_store_observation_does_not_advance_the_native_cursor:
  for +db: String
  for +handle: U32
  for +state: Observer.ReducerState
  for +code: U32
  for +text: String
  {Observer.after_observation(db,handle,state,True{},Fail{(code,text)}) == IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(code,text)}) : IO(Result<&1,&1,U32 & String,Unit>)}

law disabled_checkpoint_does_not_write_native_state:
  for +db: String
  for +handle: U32
  for +state: Observer.ReducerState
  {Observer.after_observation(db,handle,state,False{},Done{"observed"}) == IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}) : IO(Result<&1,&1,U32 & String,Unit>)}

law successful_observation_commits_the_reducer_snapshot:
  for +db: String
  for +handle: U32
  for +state: Observer.ReducerState
  for +body: String
  {Observer.after_observation(db,handle,state,True{},Done{body}) == Observer.commit(db,handle,state,True{}) : IO(Result<&1,&1,U32 & String,Unit>)}

law reducer_schema_version_is_explicit:
  {Observer.schema_version() == 1 : U32}

law held_prefix_progress_keeps_the_prior_replay_offset:
  for +prefix: String
  {Observer.checkpoint_due(Observer.empty(),Observer.make("0\n","","","","","","",prefix)) == False{} : Bool}

law omp_completed_message_advances_reducer_checkpoint:
  for +message: String
  {Observer.checkpoint_due(Observer.empty(),Observer.make("0\n",message,"","","","","","")) == Bool.not(String.is_empty(message)) : Bool}

law muse_primary_identity_advances_reducer_checkpoint:
  for +command: String
  {Observer.checkpoint_due(Observer.empty(),Observer.make("0\n","",command,"","","","","")) == Bool.not(String.is_empty(command)) : Bool}

def failed_store_observation_does_not_advance_the_native_cursor(db,handle,state,code,text):
  {==}

def disabled_checkpoint_does_not_write_native_state(db,handle,state):
  {==}

def successful_observation_commits_the_reducer_snapshot(db,handle,state,body):
  {==}

def reducer_schema_version_is_explicit():
  {==}

def held_prefix_progress_keeps_the_prior_replay_offset(prefix):
  {==}

def omp_completed_message_advances_reducer_checkpoint(message):
  {==}

def muse_primary_identity_advances_reducer_checkpoint(command):
  {==}
