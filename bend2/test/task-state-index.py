"""Check task-state query indexes and unchanged lifecycle results (#1321)."""
import json
from pathlib import Path
import re
import sqlite3
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'src/coordinator/commands.bend'
functions={}
for match in re.finditer(r'^def ([A-Za-z_][\w]*)\(([^\n]*?)\) -> String:\n(.*?)(?=\n\n|\Z)',SOURCE.read_text(),re.M|re.S):
 name,params,body=match.groups();functions[name]=([re.search(r'([A-Za-z_][\w]*)\s*:',p).group(1) for p in params.split(',') if p.strip()],body)
token=re.compile(r'"(?:\\.|[^"\\])*"|[A-Za-z_][\w.]*|\+\+|[(),]')
def evaluate(expression,local):
 tokens=token.findall(expression);pos=0
 def primary():
  nonlocal pos
  t=tokens[pos];pos+=1
  if t.startswith('"'):return json.loads(t)
  if pos<len(tokens) and tokens[pos]=='(':
   pos+=1;args=[]
   if tokens[pos]!=')':
    while True:
     args.append(expr())
     if tokens[pos]!=',':break
     pos+=1
   assert tokens[pos]==')';pos+=1
   return call(t,args)
  return local[t]
 def expr():
  nonlocal pos
  out=primary()
  while pos<len(tokens) and tokens[pos]=='++':pos+=1;out+=primary()
  return out
 out=expr();assert pos==len(tokens),(expression,tokens[pos:]);return out

def call(name,args):
 if name=='q':return "'"+args[0].replace("'","''")+"'"
 params,body=functions[name];local=dict(zip(params,args));lines=[l.strip() for l in body.splitlines() if l.strip() and not l.lstrip().startswith('#')]
 while lines and re.match(r'\+?\w+\s*:\s*String\s*=',lines[0]):
  line=lines.pop(0);m=re.match(r'\+?(\w+)\s*:\s*String\s*=\s*(.*)',line);local[m.group(1)]=evaluate(m.group(2),local)
 return evaluate(' '.join(lines),local)



def indexes():
    return call('task_state_index_schema', [])

def projection():
    return 'SELECT id,' + call('task_state_sql', ['sessions.id']) + ' FROM sessions ORDER BY id'

def seed():
    db = sqlite3.connect(':memory:')
    db.executescript("CREATE TABLE sessions(id TEXT PRIMARY KEY,parent TEXT);"
        "CREATE TABLE session_roles(session TEXT PRIMARY KEY,role TEXT);"
        "CREATE TABLE session_stops(session TEXT PRIMARY KEY);"
        "CREATE TABLE messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,sender TEXT,recipient TEXT,kind TEXT,body TEXT,receipt TEXT);"
        "CREATE INDEX messages_recipient_seq ON messages(recipient,seq,id);")
    db.executemany('INSERT INTO sessions VALUES(?,?)', [
        ('operator',None),('conductor','operator'),('worker','conductor'),
        ('nested','worker'),('successor','operator'),('other','operator')])
    db.executemany('INSERT INTO session_roles VALUES(?,?)', [
        ('operator','operator'),('conductor','conductor'),('successor','conductor')])
    db.executemany('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)', [
        ('history-'+str(i),'other','operator','report','body '+str(i)) for i in range(1000)])
    db.commit()
    return db

def message(db, identity, sender, recipient, kind, body=''):
    db.execute('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)',
               (identity,sender,recipient,kind,body))

def snapshot(db):
    return {table:db.execute('SELECT * FROM '+table+' ORDER BY rowid').fetchall()
            for table in ['sessions','session_roles','session_stops','messages']}

class TaskStateIndexes(unittest.TestCase):
    def assert_preserved(self, db):
        db.executescript("DROP INDEX IF EXISTS messages_sender_kind_seq;DROP INDEX IF EXISTS messages_recipient_kind_seq;")
        before = db.execute(projection()).fetchall()
        rows = snapshot(db)
        db.executescript(indexes())
        db.executescript(indexes())
        self.assertEqual(before,db.execute(projection()).fetchall())
        self.assertEqual(rows,snapshot(db))
        return {identity:json.loads(value) for identity,value in before}

    def test_migration_preserves_completion_reopening_succession_and_stops(self):
        db=seed()
        self.addCleanup(db.close)
        message(db,'task','conductor','worker','task','Complete the assignment.')
        opened=self.assert_preserved(db)
        self.assertTrue(opened['worker']['open'])
        message(db,'request','worker','conductor','completion-request','Complete.')
        message(db,'confirmed','conductor','worker','completion-confirmed','request')
        ended=self.assert_preserved(db)
        self.assertTrue(ended['worker']['ended'])
        self.assertFalse(ended['worker']['open'])
        message(db,'succession:conductor:successor','successor','conductor','succession')
        succeeded=self.assert_preserved(db)
        self.assertTrue(succeeded['worker']['ended'])
        message(db,'next','successor','worker','guidance','Continue the new assignment.')
        reopened=self.assert_preserved(db)
        self.assertTrue(reopened['worker']['open'])
        self.assertFalse(reopened['worker']['ended'])
        db.execute("INSERT INTO session_stops VALUES('worker')")
        stopped=self.assert_preserved(db)
        self.assertFalse(stopped['worker']['open'])

    def test_correlated_sender_and_succession_reads_use_indexes(self):
        db=seed()
        self.addCleanup(db.close)
        db.executescript(indexes())
        plan=[row[3] for row in db.execute('EXPLAIN QUERY PLAN '+projection())]
        self.assertTrue(any('SEARCH r USING INDEX messages_sender_kind_seq' in row for row in plan),plan)
        self.assertTrue(any('SEARCH chain_succession USING INDEX messages_recipient_kind_seq' in row for row in plan),plan)
        self.assertFalse(any(row.startswith('SCAN r') for row in plan),plan)

if __name__ == '__main__':
    unittest.main()
