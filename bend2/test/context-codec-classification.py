"""Validate attribution of compiler mutation refusals."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("codec_fixture", Path(__file__).with_name("context-codec.py"))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

class Attribution(unittest.TestCase):
    def outcome(self, status, diagnostic):
        return fixture.mutation_outcome(status, diagnostic, "law_required", {"law_required", "law_other"})[0]

    def test_direct_law_refusal(self):
        self.assertEqual(self.outcome(1, "Location: law_required\n"), "refused")

    def test_imported_law_refusal(self):
        self.assertEqual(self.outcome(1, "Location: contracts.law_required\n"), "refused")

    def test_imported_other_law_requires_review(self):
        self.assertEqual(self.outcome(1, "Location: contracts.law_other\n"), "refused-other-law")

    def test_mention_in_type_error_is_unattributed(self):
        self.assertEqual(self.outcome(1, "expected: law_required\nLocation: unrelated_function\n"), "unattributed")

    def test_partial_law_name_is_unattributed(self):
        self.assertEqual(self.outcome(1, "Location: law_required_suffix\n"), "unattributed")

    def test_successful_mutation_survived(self):
        self.assertEqual(self.outcome(0, "Location: law_required\n"), "survived")

if __name__ == "__main__":
    unittest.main()
