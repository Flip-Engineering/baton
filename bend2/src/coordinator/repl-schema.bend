import Base

# Immutable REPL values and the versions selected by each native turn.
def schema() -> String:
  "CREATE TABLE IF NOT EXISTS repl_notebooks(id TEXT PRIMARY KEY NOT NULL,owner TEXT NOT NULL REFERENCES sessions(id),name TEXT NOT NULL,workspace TEXT NOT NULL,compiler TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(owner,name));"
  ++ "CREATE TABLE IF NOT EXISTS repl_drafts(notebook TEXT PRIMARY KEY NOT NULL REFERENCES repl_notebooks(id),operation TEXT NOT NULL DEFAULT 'eval',source TEXT NOT NULL DEFAULT '');"
  ++ "CREATE TABLE IF NOT EXISTS repl_cells(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,notebook TEXT NOT NULL REFERENCES repl_notebooks(id),operation TEXT NOT NULL CHECK(operation IN('define','eval')),source TEXT NOT NULL,expected_type TEXT NOT NULL,label TEXT NOT NULL,snapshot TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);"
  ++ "CREATE TABLE IF NOT EXISTS repl_attempts(cell TEXT NOT NULL REFERENCES repl_cells(id),stage TEXT NOT NULL CHECK(stage IN('compiler','native')),directory TEXT UNIQUE NOT NULL,argv TEXT NOT NULL CHECK(json_valid(argv)),input TEXT NOT NULL,stdout TEXT,stderr TEXT,wait_status TEXT,cause TEXT,PRIMARY KEY(cell,stage));"
  ++ "CREATE TABLE IF NOT EXISTS repl_shares(message TEXT PRIMARY KEY NOT NULL REFERENCES messages(id),cell TEXT NOT NULL REFERENCES repl_cells(id));"
  ++ "CREATE TABLE IF NOT EXISTS repl_context_values(cell TEXT PRIMARY KEY NOT NULL REFERENCES repl_cells(id),value TEXT NOT NULL CHECK(json_valid(value)));"
  ++ "CREATE TABLE IF NOT EXISTS repl_context_bindings(owner TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id),cell TEXT NOT NULL REFERENCES repl_context_values(cell),version INTEGER NOT NULL);"
  ++ "CREATE TABLE IF NOT EXISTS repl_context_turns(turn TEXT PRIMARY KEY NOT NULL REFERENCES turns(id),owner TEXT NOT NULL REFERENCES sessions(id),cell TEXT REFERENCES repl_context_values(cell),version INTEGER,CHECK((cell IS NULL)=(version IS NULL)));"
