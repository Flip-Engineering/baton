"""Issue #723: delivered/read derives from stored read rows alone.

Source-only: reads the coordinator definitions, checks that every pending and
read derivation names message_reads and never messages.receipt, checks that
read recording is not gated on turn success, then exercises the legacy receipt
backfill and the owed/read predicates over a scratch database.
"""
import pathlib
import re
import sqlite3
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
COORD = ROOT / 'bend2/src/coordinator'
COMMANDS = COORD / 'commands.bend'
STATUS = COORD / 'message-status.bend'
OWED_SQL = ("SELECT id FROM messages WHERE recipient='leaf' "
            "AND NOT EXISTS(SELECT 1 FROM message_reads r WHERE r.message=messages.id AND r.recipient=messages.recipient) "
            "ORDER BY seq")
READ_SQL = ("SELECT id FROM messages WHERE recipient='leaf' "
            "AND EXISTS(SELECT 1 FROM message_reads r WHERE r.message=messages.id AND r.recipient=messages.recipient) "
            "ORDER BY seq")


def definition(path, name):
    text = path.read_text()
    start = text.index(f'def {name}(')
    return text[start:].split('\ndef ', 1)[0]


def literal(path, prefix):
    match = re.search(r'"(' + re.escape(prefix) + r'[^"]*)"', path.read_text())
    if not match:
        raise AssertionError(f'literal not found in {path}: {prefix}')
    return match.group(1)


class SourceDerivation(unittest.TestCase):
    def test_complete_inbox_and_pending_bodies_record_owned_reads(self):
        agent_command = definition(COORD / 'agent-command.bend', 'execute')
        agent_input = definition(COORD / 'agent-input.bend', 'command_pending_output')
        command_output = definition(COORD / 'agent-input.bend', 'command_output_value')
        record = definition(STATUS, 'record_sql')
        cli = definition(STATUS, 'cli_read_sql')
        self.assertIn('AgentInput.output(db,session,saved,True{})', agent_command)
        self.assertIn('command_owned_output(db,session,saved,saved,True{})', agent_input)
        self.assertIn('case C.Inbox{session}: command_owned_output(db,session,saved,saved,True{})', command_output)
        self.assertIn("json_type(j.value,'$.body')='text'", definition(STATUS, 'found'))
        self.assertIn('m.recipient=' + '" ++ q(session) ++ "', record)
        self.assertIn('AND m.body=', record)
        self.assertIn('exposed(read,"body")', record)
        self.assertIn('e.id=', record)
        self.assertIn('s.native=', record)
        self.assertIn('q(attempt)', record)
        self.assertIn('q(native)', record)
        self.assertIn("json_type(j.value,'$.body')='text'", cli)
        self.assertIn("m.body=coalesce(json_extract(j.value,'$.delivery.body'),json_extract(j.value,'$.body'))", cli)
        self.assertIn("m.recipient=coalesce(json_extract(j.value,'$.delivery.recipient'),json_extract(j.value,'$.recipient'))", cli)

    def test_owed_and_read_consult_read_rows_only(self):
        owed = definition(STATUS, 'owed_sql')
        read = definition(STATUS, 'read_sql')
        self.assertNotIn('receipt', owed)
        self.assertNotIn('receipt', read)
        self.assertIn('NOT EXISTS(SELECT 1 FROM message_reads', owed)
        self.assertIn('EXISTS(SELECT 1 FROM message_reads', read)

    def test_pending_read_and_wake_projections_name_no_receipt(self):
        sites = [
            ('receive.bend', 'pending_count_sql'),
            ('delivery.bend', 'wake_sql'),
            ('guidance.bend', 'outstanding_sql'),
            ('stall.bend', 'owed_expr'),
            ('stop.bend', 'result_sql'),
            ('commands.bend', 'completion_pending_sql'),
            ('commands.bend', 'completion_oldest_sql'),
            ('commands.bend', 'wake_state_sql'),
            ('message-batch.bend', 'snapshot_sql'),
        ]
        for name, function in sites:
            body = definition(COORD / name, function)
            self.assertNotIn('receipt', body,
                             f'{name}:{function} derives state from a receipt')

    def test_no_coordinator_or_driver_source_tests_a_receipt(self):
        # message-status.bend holds the one backfill that reads historical receipts.
        sources = [path for path in COORD.glob('*.bend') if path != STATUS]
        sources += sorted((ROOT / 'bend2/scripts').glob('*.mjs'))
        for path in sources:
            text = path.read_text()
            self.assertNotIn('receipt IS NULL', text, path.name)
            self.assertNotIn('receipt IS NOT NULL', text, path.name)

    def test_read_recording_is_not_success_gated(self):
        for name in ('record_sql', 'forwarded_read_sql', 'prompt_record_sql',
                     'codex_record_sql'):
            body = definition(STATUS, name)
            self.assertIn('INSERT INTO message_reads', body, name)
            self.assertNotIn('settle', body, name)
            self.assertNotIn('handled', body, name)


class BackfillAndDerivation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='message-reads-')
        self.addCleanup(self.temp.cleanup)
        self.db = sqlite3.connect(pathlib.Path(self.temp.name) / 'reads.db')
        self.addCleanup(self.db.close)
        self.db.execute(literal(COMMANDS, 'CREATE TABLE IF NOT EXISTS sessions'))
        messages_schema = literal(COMMANDS, 'CREATE TABLE IF NOT EXISTS messages')
        self.assertIn('receipt TEXT', messages_schema)
        self.db.execute(messages_schema)
        self.db.execute(literal(STATUS, 'CREATE TABLE IF NOT EXISTS message_reads'))
        self.backfill = literal(STATUS, 'INSERT INTO message_reads')
        self.db.execute(
            "INSERT INTO sessions(id,parent,harness) "
            "VALUES('root',NULL,'omp'),('leaf','root','omp')")
        for ident, receipt in (('unread', None),
                               ('legacy', 'earliest receipt'),
                               ('read', None)):
            self.db.execute(
                'INSERT INTO messages(id,sender,recipient,kind,body,receipt) '
                'VALUES(?,?,?,?,?,?)',
                (ident, 'root', 'leaf', 'guidance', 'body', receipt))
        self.db.execute(
            "INSERT INTO message_reads(attempt,message,recipient,native,identity) "
            "VALUES('turn-1','read','leaf','native-1','owned')")
        self.db.commit()

    def ids(self, sql):
        return [row[0] for row in self.db.execute(sql)]

    def test_legacy_receipt_backfills_once_as_a_read(self):
        self.assertEqual(self.ids(OWED_SQL), ['unread', 'legacy'])
        self.assertEqual(self.ids(READ_SQL), ['read'])
        self.db.execute(self.backfill)
        self.db.commit()
        self.assertEqual(self.ids(OWED_SQL), ['unread'])
        self.assertEqual(self.ids(READ_SQL), ['legacy', 'read'])
        self.assertEqual(
            list(self.db.execute(
                "SELECT attempt,identity FROM message_reads WHERE message='legacy'")),
            [('legacy', 'receipt')])
        self.db.execute(self.backfill)
        self.db.commit()
        self.assertEqual(
            list(self.db.execute(
                "SELECT count(*) FROM message_reads WHERE message='legacy'")),
            [(1,)])

    def test_stored_receipt_values_do_not_change_state_after_the_backfill(self):
        self.db.execute(self.backfill)
        self.db.execute("UPDATE messages SET receipt='changed later' WHERE id='read'")
        self.db.execute("UPDATE messages SET receipt=NULL WHERE id='legacy'")
        self.db.commit()
        self.assertEqual(self.ids(OWED_SQL), ['unread'])
        self.assertEqual(self.ids(READ_SQL), ['legacy', 'read'])
        self.assertIsNone(self.db.execute(
            "SELECT handled FROM message_reads WHERE message='read'").fetchone()[0])


if __name__ == '__main__':
    unittest.main()
