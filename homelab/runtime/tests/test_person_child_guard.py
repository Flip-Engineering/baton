import hashlib
import pathlib
import unittest

import common_person
import person_pipeline


class PersonChildGuard(unittest.TestCase):
    def test_required_guard_is_present_and_qualified(self):
        guard = pathlib.Path(common_person.__file__).with_name('person_child_failures.py')
        self.assertTrue(guard.is_file(), 'common_person.py needs person_child_failures.py beside it')
        self.assertEqual(hashlib.sha256(guard.read_bytes()).hexdigest(),
                         common_person.CHILD_GUARD_SHA256)
        self.assertIn('person_child_failures.py', person_pipeline.RUNTIME_MODULES)

    def test_guard_is_copied_into_the_job_harness(self):
        source = pathlib.Path(person_pipeline.__file__).with_name('gpu_jobs.py').read_text()
        self.assertIn("'person_child_failures.py'", source)
        self.assertIn("'common_person.py'", source)


if __name__ == '__main__':
    unittest.main()
