import Base
import ./observer-checkpoint.bend as Observer

law failed_store_observation_does_not_advance_the_native_cursor:
  for +db: String
  for +handle: U32
  for +state: Observer.State
  for +code: U32
  for +text: String
  {Observer.after_observation(db,handle,state,True{},Fail{(code,text)}) == IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(code,text)}) : IO(Result<&1,&1,U32 & String,Unit>)}

law disabled_checkpoint_does_not_write_native_state:
  for +db: String
  for +handle: U32
  for +state: Observer.State
  {Observer.after_observation(db,handle,state,False{},Done{"observed"}) == IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}) : IO(Result<&1,&1,U32 & String,Unit>)}

law successful_observation_commits_the_reducer_snapshot:
  for +db: String
  for +handle: U32
  for +state: Observer.State
  for +body: String
  {Observer.after_observation(db,handle,state,True{},Done{body}) == Observer.commit(db,handle,state,True{}) : IO(Result<&1,&1,U32 & String,Unit>)}

law reducer_schema_version_is_explicit:
  {Observer.schema_version() == 1 : U32}

law held_prefix_progress_keeps_the_prior_replay_offset:
  for +prefix: String
  {Observer.checkpoint_due(Observer.empty(),Observer.make("0\n","","","","","","",prefix)) == False{} : Bool}

law omp_completed_message_advances_reducer_checkpoint:
  for +message: String
  {Observer.checkpoint_due(Observer.empty(),Observer.make("0\n",message,"","","","","","")) == Bool.or(Bool.not(String.eq("",message)),False{}) : Bool}

law muse_primary_identity_advances_reducer_checkpoint:
  for +command: String
  {Observer.checkpoint_due(Observer.empty(),Observer.make("0\n","",command,"","","","","")) == Bool.or(Bool.not(String.eq("",command)),False{}) : Bool}

law output_cursor_progress_keeps_the_prior_replay_offset:
  {Observer.checkpoint_due(Observer.with_output(Observer.empty(),"15418859"),Observer.with_output(Observer.empty(),"15418960")) == False{} : Bool}

law completed_message_with_output_progress_advances_the_reducer_checkpoint:
  {Observer.checkpoint_due(Observer.with_output(Observer.make("0\n","message","","","same terminal","","",""),"15418859"),Observer.with_output(Observer.make("0\n","message\n","","","same terminal","","",""),"15418960")) == True{} : Bool}

law guidance_cursor_change_advances_reducer_checkpoint:
  {Observer.checkpoint_due(Observer.empty(),Observer.make("1\n","","","","","","","")) == True{} : Bool}

law episode_change_advances_reducer_checkpoint:
  {Observer.checkpoint_due(Observer.with_episode(Observer.empty(),"0"),Observer.with_episode(Observer.empty(),"1")) == True{} : Bool}

law omp_activity_change_advances_reducer_checkpoint:
  {Observer.checkpoint_due(Observer.empty(),Observer.with_omp_activity(Observer.empty(),"{\"kind\":\"message_start\"}")) == True{} : Bool}

law muse_current_identity_advances_reducer_checkpoint:
  {Observer.checkpoint_due(Observer.empty(),Observer.make("0\n","","","current","","","","")) == True{} : Bool}

law terminal_change_advances_reducer_checkpoint:
  {Observer.checkpoint_due(Observer.empty(),Observer.make("0\n","","","","terminal","","","")) == True{} : Bool}

law filter_mode_change_advances_reducer_checkpoint:
  {Observer.checkpoint_due(Observer.empty(),Observer.make("0\n","","","","","array+delta","","")) == True{} : Bool}

law codex_completed_frame_advances_reducer_checkpoint:
  {Observer.checkpoint_due(Observer.empty(),Observer.make("0\n","","","","","","{\"type\":\"item.completed\"}","")) == True{} : Bool}

law finish_output_clears_held_and_marks_output_done:
  for +state: Observer.State
  for +position: String
  {Bool.and(String.is_empty(Observer.held(Observer.finish_output(state,position))),Observer.output_done(Observer.finish_output(state,position))) == True{} : Bool}

law finish_output_keeps_the_final_output_position:
  for +state: Observer.State
  for +position: String
  {String.eq(Observer.output(Observer.finish_output(state,position)),position) == True{} : Bool}

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

def output_cursor_progress_keeps_the_prior_replay_offset():
  {==}

def completed_message_with_output_progress_advances_the_reducer_checkpoint():
  {==}

def guidance_cursor_change_advances_reducer_checkpoint():
  {==}

def episode_change_advances_reducer_checkpoint():
  {==}

def omp_activity_change_advances_reducer_checkpoint():
  {==}

def muse_current_identity_advances_reducer_checkpoint():
  {==}

def terminal_change_advances_reducer_checkpoint():
  {==}

def filter_mode_change_advances_reducer_checkpoint():
  {==}

def codex_completed_frame_advances_reducer_checkpoint():
  {==}

def finish_output_clears_held_and_marks_output_done(state,position):
  {==}

def finish_output_keeps_the_final_output_position(state,position):
  {==}
