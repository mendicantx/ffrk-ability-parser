"""Unit tests for scripts/infer_statuses.py.

Run with: python -I -m unittest discover -s test/python
"""
import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "infer_statuses.py"
spec = importlib.util.spec_from_file_location("infer_statuses", SCRIPT)
infer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(infer)


class CapWordTest(unittest.TestCase):
    # docs/decisions.md "_cap_word — CID is not a Roman numeral"
    def test_keeps_every_game_numeral_upper_case(self):
        for numeral in ["II", "III", "IV", "V", "VI", "VII", "VIII", "IX",
                        "X", "XI", "XII", "XIII", "XIV", "XV", "XVI"]:
            self.assertEqual(infer._cap_word(numeral), numeral)

    def test_title_cases_words_made_of_numeral_letters(self):
        for word, expected in [("CID", "Cid"), ("DID", "Did"), ("MIX", "Mix"), ("CLIVE", "Clive")]:
            self.assertEqual(infer._cap_word(word), expected)


if __name__ == "__main__":
    unittest.main()
