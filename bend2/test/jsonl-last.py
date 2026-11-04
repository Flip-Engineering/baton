"""Actual file I/O of the backward JSONL reader that decides Claude Code stdin closure (#1298).

BATON2_JSONL_LAST_FIXTURE names the queue-built jsonl-last.c fixture. It reads a
real file with pread and reports the bytes read on stderr. The predicate and needle
are the text guidance.bend passes, so the coordinator's selection is the one tested.
"""
import errno
import json
import os
import pathlib
import re
import subprocess
import tempfile
import unittest

GUIDANCE = pathlib.Path(__file__).resolve().parents[1] / 'src/coordinator/guidance.bend'

TASKS = '{"type":"system","subtype":"background_tasks_changed","tasks":[{"task_id":"b08nmjy6o","task_type":"local_bash"}],"session_id":"dc9081fb"}'
EMPTY = '{"type":"system","subtype":"background_tasks_changed","tasks":[],"session_id":"dc9081fb"}'
INIT = '{"type":"system","subtype":"init","session_id":"dc9081fb"}'
RESULT = '{"type":"result","subtype":"success","result":"STARTED","session_id":"dc9081fb"}'
# An ordinary frame of about 1 KiB, as the stream between task lists.
FILLER = json.dumps({'type': 'assistant', 'message': {'content': [{'type': 'text', 'text': 'x' * 900}]}})


def guidance_text(name):
    match = re.search(r'^def ' + name + r'\(\) -> String:\n  "((?:[^"\\]|\\.)*)"\n', GUIDANCE.read_text(), re.M)
    assert match, name
    return match.group(1).encode().decode('unicode_escape')


PREDICATE = guidance_text('spool_list_sql')
NEEDLE = re.search(r'JsonlLast\.Jsonl\.read_last\(spool,"([^"]*)",spool_list_sql\(\)\)', GUIDANCE.read_text()).group(1)


class LastTaskList(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='baton-jsonl-last-')
        self.addCleanup(self.directory.cleanup)
        self.path = pathlib.Path(self.directory.name) / 'stdout'
        self.binary = os.environ['BATON2_JSONL_LAST_FIXTURE']

    def read(self, lines, predicate=None, action=None):
        data = lines if isinstance(lines, bytes) else ''.join(line + '\n' for line in lines).encode()
        self.path.write_bytes(data)
        arguments = [self.binary, str(self.path), NEEDLE, predicate or PREDICATE]
        if action:
            arguments.append(action)
        result = subprocess.run(arguments, capture_output=True)
        read = int(re.match(rb'read (\d+)\n', result.stderr).group(1))
        return result.returncode, result.stdout.decode(), read

    def test_the_predicate_text_is_the_coordinators(self):
        self.assertEqual(NEEDLE, 'background_tasks_changed')
        self.assertIn("'$.subtype')='background_tasks_changed'", PREDICATE)

    def test_the_latest_list_wins_in_either_direction(self):
        self.assertEqual(self.read([INIT, TASKS, RESULT, EMPTY])[:2], (0, EMPTY))
        self.assertEqual(self.read([EMPTY, FILLER, TASKS, RESULT])[:2], (0, TASKS))

    def test_a_list_that_replaced_an_empty_one_is_the_latest(self):
        # The state a replaying observer holds at the empty frame is not the file's latest list.
        self.assertEqual(self.read([TASKS, EMPTY, TASKS, RESULT])[:2], (0, TASKS))

    def test_a_list_written_with_json_whitespace_is_found(self):
        spaced = json.dumps(json.loads(TASKS), indent=2).replace('\n', ' ')
        reordered = '{ "subtype" : "background_tasks_changed" , "type" : "system" , "tasks" : [ ] }'
        self.assertEqual(self.read([EMPTY, spaced, RESULT])[:2], (0, spaced))
        self.assertEqual(self.read([TASKS, reordered, RESULT])[:2], (0, reordered))

    def test_a_frame_that_only_quotes_the_list_name_is_skipped(self):
        quoted = json.dumps({'type': 'assistant', 'text': '"subtype":"background_tasks_changed","tasks":[]'})
        plain = json.dumps({'type': 'assistant', 'text': 'background_tasks_changed'})
        self.assertEqual(self.read([TASKS, quoted, plain, RESULT])[:2], (0, TASKS))

    def escaped(self, frame, spelling='\\u0062ackground_tasks_changed'):
        return frame.replace('background_tasks_changed', spelling)

    def test_a_list_whose_subtype_is_written_with_a_json_escape_is_found(self):
        # A raw search for the list name misses these spellings; the JSON parse decides.
        spellings = ('\\u0062ackground_tasks_changed', 'background_tasks_chang\\u0065d',
                     'background\\u005ftasks\\u005fchanged', ''.join('\\u%04x' % ord(c) for c in 'background_tasks_changed'))
        for spelling in spellings:
            later = self.escaped(TASKS, spelling)
            self.assertNotIn('background_tasks_changed', later)
            with self.subTest(spelling=spelling, order='literal empty, then escaped active'):
                self.assertEqual(self.read([EMPTY, FILLER, later, RESULT])[:2], (0, later))
            with self.subTest(spelling=spelling, order='escaped empty, then literal active'):
                earlier = self.escaped(EMPTY, spelling)
                self.assertEqual(self.read([earlier, TASKS, RESULT])[:2], (0, TASKS))
            with self.subTest(spelling=spelling, order='literal active, then escaped empty'):
                latest = self.escaped(EMPTY, spelling)
                self.assertEqual(self.read([TASKS, FILLER, latest, RESULT])[:2], (0, latest))

    def test_a_list_whose_keys_or_type_are_written_with_a_json_escape_is_found(self):
        key = TASKS.replace('"subtype"', '"sub\\u0074ype"')
        kind = TASKS.replace('"system"', '"\\u0073ystem"')
        both = key.replace('"system"', '"\\u0073ystem"').replace('"type"', '"\\u0074ype"')
        for later in (key, kind, both):
            with self.subTest(later=later):
                self.assertEqual(self.read([EMPTY, later, RESULT])[:2], (0, later))

    def test_a_frame_with_an_escape_that_is_not_a_list_is_skipped(self):
        ansi = json.dumps({'type': 'user', 'text': '\x1b[0m caf\u00e9'})
        self.assertIn('\\u', ansi)
        self.assertEqual(self.read([TASKS, ansi, ansi, RESULT])[:2], (0, TASKS))

    def test_a_malformed_or_truncated_frame_with_an_escape_is_unreadable(self):
        escaped = self.escaped(TASKS)
        for value in (escaped[:70], '{"subtype":"\\u0062ackground_tasks_changed",}', '\\u'):
            with self.subTest(value=value):
                self.assertEqual(self.read((EMPTY + '\n' + value + '\n').encode())[0], 1)

    def test_escaped_frames_do_not_widen_the_bytes_read(self):
        marked = json.dumps({'type': 'user', 'text': '\x1b[0m' + 'x' * 900})
        prefix = [TASKS, EMPTY] + [marked] * 48000
        tail = [self.escaped(TASKS), RESULT, marked, EMPTY, RESULT]
        status, output, read = self.read(prefix + tail)
        self.assertEqual((status, output), (0, EMPTY))
        self.assertLess(read, 256 * 1024)
        status, output, read = self.read(prefix + [self.escaped(TASKS), RESULT, marked])
        self.assertEqual((status, output), (0, self.escaped(TASKS)))
        self.assertLess(read, 256 * 1024)

    def test_a_file_without_a_list_returns_nothing(self):
        for lines in ([], [INIT, FILLER, RESULT]):
            with self.subTest(lines=lines):
                self.assertEqual(self.read(lines)[:2], (0, ''))

    def test_the_last_frame_needs_no_newline_and_blank_lines_are_skipped(self):
        self.assertEqual(self.read(('\n' + TASKS + '\n\n' + EMPTY).encode())[:2], (0, EMPTY))
        self.assertEqual(self.read((TASKS + '\r\n' + RESULT + '\n\n').encode())[:2], (0, TASKS + '\r'))

    def test_a_truncated_last_list_is_unreadable(self):
        self.assertEqual(self.read((EMPTY + '\n' + TASKS[:60]).encode())[0], 1)
        self.assertEqual(self.read((EMPTY + '\n' + TASKS[:60] + '\n').encode())[0], 1)

    def test_a_truncated_frame_without_the_list_name_is_ignored(self):
        self.assertEqual(self.read((TASKS + '\n' + RESULT[:20]).encode())[:2], (0, TASKS))

    def test_invalid_text_in_a_frame_that_names_a_list_is_unreadable(self):
        for value in (b'\xff background_tasks_changed', b'background_tasks_changed\0', b'{"subtype":"background_tasks_changed",}'):
            with self.subTest(value=value):
                self.assertEqual(self.read(TASKS.encode() + b'\n' + value + b'\n')[0], 1)

    def test_invalid_frames_before_the_latest_list_are_not_read(self):
        self.assertEqual(self.read(b'\xff\n{"truncated":\n' + TASKS.encode() + b'\n')[:2], (0, TASKS))

    def test_a_missing_file_and_a_directory_are_unreadable(self):
        arguments = [self.binary, self.directory.name + '/missing', NEEDLE, PREDICATE]
        self.assertEqual(subprocess.run(arguments, capture_output=True).returncode, 1)
        arguments[1] = self.directory.name
        self.assertEqual(subprocess.run(arguments, capture_output=True).returncode, 1)

    def test_a_predicate_that_is_not_one_readonly_boolean_scalar_fails(self):
        for query in ('SELECT 1; SELECT ?1', 'CREATE TABLE changed(value)', 'SELECT ?1,1', 'SELECT 2 WHERE ?1 IS NOT NULL',
                      "SELECT '1' WHERE ?1 IS NOT NULL", 'SELECT 1 FROM json_each(?1)'):
            with self.subTest(query=query):
                self.assertEqual(self.read([TASKS], predicate=query)[:2], (1, ''))

    def test_an_empty_needle_is_refused(self):
        self.path.write_text(TASKS + '\n')
        result = subprocess.run([self.binary, str(self.path), '', PREDICATE], capture_output=True)
        self.assertEqual(result.returncode, 1)

    def test_a_file_replaced_or_shortened_during_the_scan_is_retryable(self):
        for action in ('replace', 'truncate'):
            with self.subTest(action=action):
                status, output, read = self.read([EMPTY, RESULT, TASKS], predicate='SELECT fixture_change(?1)', action=action)
                self.assertEqual((status, output), (1, ''))

    def test_bytes_appended_during_the_scan_are_not_read_and_do_not_fail_it(self):
        self.assertEqual(self.read([EMPTY, RESULT, TASKS], predicate='SELECT fixture_change(?1)', action='append')[:2], (0, TASKS))

    def test_a_large_retained_prefix_is_not_read_when_the_latest_list_is_near_the_end(self):
        prefix = [TASKS, EMPTY] + [FILLER] * 48000
        size = sum(len(line) + 1 for line in prefix)
        self.assertGreater(size, 40 * 1024 * 1024)
        tail = [TASKS, RESULT, FILLER, EMPTY, RESULT]
        status, output, read = self.read(prefix + tail)
        self.assertEqual((status, output), (0, EMPTY))
        # The last block holds every line after the list.
        self.assertLess(read, 256 * 1024)

    def test_the_bytes_read_grow_with_the_frames_after_the_latest_list_only(self):
        prefix = [FILLER] * 40000
        after = [FILLER] * 200
        status, output, read = self.read(prefix + [TASKS] + after)
        self.assertEqual((status, output), (0, TASKS))
        written = sum(len(line) + 1 for line in after)
        self.assertGreater(read, written)
        self.assertLessEqual(read, written + 3 * 65536)

    def test_a_large_file_without_a_list_is_read_once(self):
        lines = [FILLER] * 30000
        size = sum(len(line) + 1 for line in lines)
        status, output, read = self.read(lines)
        self.assertEqual((status, output), (0, ''))
        self.assertGreaterEqual(read, size)
        self.assertLessEqual(read, int(size * 1.1) + 131072)

    def test_a_frame_larger_than_a_block_is_read_whole(self):
        big = json.dumps({'type': 'system', 'subtype': 'background_tasks_changed',
                          'tasks': [{'task_id': str(i), 'description': 'd' * 200} for i in range(2000)]})
        self.assertGreater(len(big), 200 * 1024)
        self.assertEqual(self.read([EMPTY, big, RESULT])[:2], (0, big))


if __name__ == '__main__':
    unittest.main()
