"""The turn-end report withholds a repeated final no-change report (#723).

Live evidence 2026-10-22 to 2026-10-28: a coordinator seat that ends every turn
with the same final text ("No change." was recorded 92 times) wrote one report
row per turn, and each row was new unread input for the operator. The completion
SQL in commands.bend now compares the terminal body with the newest report the
session already sent the same recipient and writes no second identical row: a
withheld terminal records no report row and no turn row, so it delivers nothing
and wakes nobody. The direct finish check in turn.bend counts a withheld
terminal as a recorded result instead of reporting a missing native result.

The SQL under test is evaluated from the definitions in commands.bend,
message-status.bend and turn.bend, so the statements are the statements the
coordinator runs. The terminal frames are OMP agent_end frames shaped like the
recorded live episodes.
"""
import json
import pathlib
import re
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
COMMANDS = ROOT / 'bend2/src/coordinator/commands.bend'
STATUS = ROOT / 'bend2/src/coordinator/message-status.bend'
TURN = ROOT / 'bend2/src/coordinator/turn.bend'
REPL = ROOT / 'bend2/src/coordinator/repl-schema.bend'

SOURCES = {'': COMMANDS.read_text(), 'MessageStatus.': STATUS.read_text(),
           'C.': COMMANDS.read_text(), 'Turn.': TURN.read_text()}

FORBIDDEN = ('Bool.pick', 'match ', ' <- ', 'IO.', 'String.', 'List.', 'Bool.')


def definitions(text):
    found = {}
    for match in re.finditer(r'^def (\w+)\(([^)]*)\) -> String:\n((?:[ \t]+.*\n)+)',
                             text, re.M):
        params = [re.sub(r'^[+-]', '', part.split(':')[0].strip())
                  for part in match.group(2).split(',') if part.strip()]
        found[match.group(1)] = (params, match.group(3))
    return found

DEFINITIONS = {'': definitions(COMMANDS.read_text()),
               'MessageStatus.': definitions(STATUS.read_text()),
               'C.': definitions(COMMANDS.read_text()),
               'Turn.': definitions(TURN.read_text())}


def sql_quote(value):
    return "'" + value.replace("'", "''") + "'"


def scan(text, position):
    """One string literal, one identifier (with optional call arguments) or fail."""
    if text[position] == '"':
        end = position + 1
        while text[end] != '"':
            end += 2 if text[end] == '\\' else 1
        return ('str', text[position + 1:end].encode().decode('unicode_escape'),
                None, end + 1)
    match = re.match(r'[A-Za-z_][A-Za-z0-9_.]*', text[position:])
    assert match, text[position:position + 40]
    name = match.group(0)
    end = position + len(name)
    while end < len(text) and text[end] in ' \t':
        end += 1
    if end < len(text) and text[end] == '(':
        depth, walk = 0, end
        while True:
            if text[walk] == '(':
                depth += 1
            elif text[walk] == ')':
                depth -= 1
                if depth == 0:
                    break
            elif text[walk] == '"':
                walk += 1
                while text[walk] != '"':
                    walk += 2 if text[walk] == '\\' else 1
            walk += 1
        return ('call', name, text[end + 1:walk], walk + 1)
    return ('name', name, None, end)


def split_arguments(text):
    parts, start, depth = [], 0, 0
    walk = 0
    while walk < len(text):
        char = text[walk]
        if char == '"':
            walk += 1
            while text[walk] != '"':
                walk += 2 if text[walk] == '\\' else 1
        elif char in '([':
            depth += 1
        elif char in ')]':
            depth -= 1
        elif char == ',' and depth == 0:
            parts.append(text[start:walk])
            start = walk + 1
        walk += 1
    if text[start:].strip():
        parts.append(text[start:])
    return parts


def evaluate_call(name, arguments, bindings, module=''):
    if name in ('q', 'C.q'):
        return sql_quote(expression(arguments, bindings, module))
    for prefix in ('MessageStatus.', 'C.', 'Turn.'):
        if name.startswith(prefix):
            short = name[len(prefix):]
            return call_body(DEFINITIONS[prefix], short,
                             expression_values(arguments, bindings, module))
    if module and name in DEFINITIONS[module]:
        return call_body(DEFINITIONS[module], name,
                         expression_values(arguments, bindings, module))
    if name in DEFINITIONS['']:
        return call_body(DEFINITIONS[''], name,
                         expression_values(arguments, bindings, module))
    raise AssertionError(f'unknown helper {name}')


def call_body(table, name, values, module=''):
    assert name in table, f'missing definition {name}'
    params, body = table[name]
    assert len(params) == len(values), name
    for token in FORBIDDEN:
        assert token not in body, (
            f'def {name} uses {token}; the evaluator covers string '
            'concatenation only')
    local = dict(zip(params, values))
    rest = []
    for raw in body.splitlines():
        line = raw.strip()
        let = re.match(r'^\+(\w+)(?:\s*:\s*String)?\s*=\s*(.+)$', line)
        if let:
            local[let.group(1)] = expression(let.group(2), local, module)
        elif line:
            rest.append(line)
    return expression('\n'.join(rest), local, module)


def expression_values(arguments, bindings, module=''):
    return [expression(part, bindings, module) for part in split_arguments(arguments)]


def expression(text, bindings, module=''):
    out, position = '', 0
    while position < len(text):
        char = text[position]
        if char in ' \t\r\n+':
            position += 1
            continue
        assert char != ';', 'unexpected statement separator'
        kind, first, rest, end = scan(text, position)
        if kind == 'str':
            out += first
        elif kind == 'name':
            assert first in bindings, f'unbound identifier {first}'
            out += bindings[first]
        else:
            out += evaluate_call(first, rest, bindings, module)
        position = end
    return out


def evaluate(name, values):
    return call_body(DEFINITIONS[''], name, values)


def statements(sql):
    parts, start, quoted = [], 0, False
    walk = 0
    while walk < len(sql):
        if sql[walk] == "'":
            quoted = not quoted
        elif sql[walk] == ';' and not quoted:
            parts.append(sql[start:walk + 1])
            start = walk + 1
        walk += 1
    if sql[start:].strip():
        parts.append(sql[start:])
    return parts


def source_literal(path, name):
    match = re.search(r'"(' + re.escape(name) + r'[^"]*)"', path.read_text())
    assert match, f'schema literal not found in {path}: {name}'
    return match.group(1)


class WithheldNoChangeReport(unittest.TestCase):
    def setUp(self):
        self.connection = sqlite3.connect(':memory:')
        self.connection.execute('PRAGMA foreign_keys=ON')
        literals = [
            source_literal(COMMANDS, 'CREATE TABLE IF NOT EXISTS sessions'),
            source_literal(COMMANDS, 'CREATE TABLE IF NOT EXISTS messages'),
            source_literal(COMMANDS, 'CREATE TABLE IF NOT EXISTS turns'),
            source_literal(COMMANDS, 'CREATE TABLE IF NOT EXISTS session_stops'),
            source_literal(COMMANDS, 'CREATE TABLE IF NOT EXISTS session_roles'),
            source_literal(STATUS, 'CREATE TABLE IF NOT EXISTS message_reads'),
            source_literal(STATUS, 'CREATE INDEX IF NOT EXISTS message_reads_message'),
            source_literal(REPL, 'CREATE TABLE IF NOT EXISTS repl_context_values'),
            source_literal(REPL, 'CREATE TABLE IF NOT EXISTS repl_context_bindings'),
            source_literal(REPL, 'CREATE TABLE IF NOT EXISTS repl_context_turns'),
        ]
        for literal in literals:
            self.connection.execute(literal)
        self.connection.executemany(
            'INSERT INTO sessions(id,parent,harness) VALUES(?,?,?)',
            [('boss', None, 'omp'), ('seat', 'boss', 'omp')])
        self.connection.execute(
            "INSERT INTO session_roles(session,role) VALUES('boss','conductor')")
        self.connection.commit()

    def tearDown(self):
        self.connection.close()

    @staticmethod
    def terminal(text):
        return json.dumps({'type': 'agent_end', 'isTerminal': True,
                           'session_id': 'seat',
                           'messages': [{'role': 'assistant',
                                         'content': [{'type': 'text',
                                                      'text': text}]}]})

    def observe(self, attempt, event):
        sql = evaluate('completion_sql', [attempt, 'seat', event])
        answer = None
        with self.connection:
            for statement in statements(sql):
                rows = self.connection.execute(statement).fetchall()
                if statement.lstrip().upper().startswith('SELECT'):
                    answer = json.loads(rows[0][0]) if rows else None
        return answer

    def state(self, attempt, event):
        sql = call_body(DEFINITIONS['Turn.'], 'completion_state_sql',
                        [attempt, 'seat', event], 'Turn.')
        return self.connection.execute(sql).fetchone()[0]

    def report_rows(self):
        return self.connection.execute(
            "SELECT id,body FROM messages WHERE sender='seat' "
            "AND kind='report' ORDER BY seq").fetchall()

    def turns_for(self, attempt):
        return self.connection.execute(
            'SELECT count(*) FROM turns WHERE id=?', (attempt,)).fetchone()[0]

    def result_recorded(self, attempt, event):
        sql = call_body(DEFINITIONS['Turn.'], 'result_recorded_sql',
                        [attempt, 'seat', event], 'Turn.')
        return self.connection.execute(sql).fetchone()[0]

    def test_repeated_final_no_change_text_writes_one_report(self):
        first = self.observe('receive:seat:9556757:382e9f08',
                             self.terminal('No change.'))
        self.assertEqual(first['reportId'], 'receive:seat:9556757:382e9f08')
        rows = self.report_rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][1], 'No change.')
        # A later attempt ends with the same final text: no second report row
        # and no turn row; the recipient keeps the report it already holds.
        second = self.observe('receive:seat:9556757:1468a420',
                              self.terminal('No change.'))
        self.assertIsNone(second['reportId'])
        self.assertEqual(self.report_rows(), rows)
        self.assertEqual(self.turns_for('receive:seat:9556757:382e9f08'), 1)
        self.assertEqual(self.turns_for('receive:seat:9556757:1468a420'), 0)
        # The direct finish check counts the withheld attempt as recorded.
        self.assertEqual(self.result_recorded('receive:seat:9556757:1468a420',
                                              self.terminal('No change.')), '1')

    def test_changed_final_text_writes_a_new_report(self):
        self.observe('a1', self.terminal('No change.'))
        self.observe('a2', self.terminal('No change.'))
        third = self.observe('a3', self.terminal('Work advanced.'))
        self.assertEqual(third['reportId'], 'a3')
        self.assertEqual([row[1] for row in self.report_rows()],
                         ['No change.', 'Work advanced.'])
        # The unchanged comparison names the newest report only, so a return to
        # earlier text is a change and is delivered.
        fourth = self.observe('a4', self.terminal('No change.'))
        self.assertEqual(fourth['reportId'], 'a4')
        self.assertEqual([row[1] for row in self.report_rows()],
                         ['No change.', 'Work advanced.', 'No change.'])
        fifth = self.observe('a5', self.terminal('No change.'))
        self.assertIsNone(fifth['reportId'])
        self.assertEqual(len(self.report_rows()), 3)
        self.assertEqual(self.connection.execute(
            'SELECT count(*) FROM turns').fetchone()[0], 3)
        # A withheld terminal whose text no longer matches the newest report is
        # delivered on its next observation.
        self.assertEqual(self.result_recorded('a5', self.terminal('No change.')),
                         '1')
        self.assertEqual(self.result_recorded('a5', self.terminal('New state')),
                         '0')

    def test_a_replay_of_a_withheld_terminal_records_nothing_new(self):
        self.observe('a1', self.terminal('No change.'))
        self.observe('a2', self.terminal('No change.'))
        before = self.report_rows()
        answer = self.observe('a2', self.terminal('No change.'))
        self.assertIsNone(answer['reportId'])
        self.assertEqual(self.report_rows(), before)
        self.assertEqual(self.turns_for('a2'), 0)
        self.assertEqual(self.state('a2', self.terminal('No change.')), '')

    def test_a_changed_terminal_on_a_recorded_attempt_is_still_a_conflict(self):
        self.observe('a1', self.terminal('No change.'))
        self.assertEqual(self.state('a1', self.terminal('No change.')), 'same')
        self.assertEqual(self.state('a1', self.terminal('Different text')),
                         'conflict')
        # A withheld attempt records no rows, so changed text is a fresh
        # observation and is delivered.
        self.observe('a2', self.terminal('No change.'))
        self.assertEqual(self.state('a2', self.terminal('Different text')), '')
        delivered = self.observe('a2', self.terminal('Different text'))
        self.assertEqual(delivered['reportId'], 'a2')
        self.assertEqual(self.turns_for('a2'), 1)

    def test_a_fresh_terminal_derives_an_empty_state(self):
        self.assertEqual(self.state('a9', self.terminal('Anything')), '')
        self.assertEqual(self.result_recorded('a9', self.terminal('Anything')),
                         '0')

    def test_a_report_to_another_recipient_does_not_suppress(self):
        self.observe('a1', self.terminal('Work advanced.'))
        self.connection.execute(
            "INSERT INTO sessions(id,parent,harness) VALUES('other',NULL,'omp')")
        self.connection.execute(
            "INSERT INTO messages(id,sender,recipient,kind,body) "
            "VALUES('manual','seat','other','report','No change.')")
        self.connection.commit()
        second = self.observe('a2', self.terminal('No change.'))
        # The newest report to the derived coordinator differs, so the terminal
        # is delivered; the identical body sent elsewhere does not suppress it.
        self.assertEqual(second['reportId'], 'a2')
        self.assertEqual([row[1] for row in self.report_rows()],
                         ['Work advanced.', 'No change.', 'No change.'])

if __name__ == '__main__':
    unittest.main()
