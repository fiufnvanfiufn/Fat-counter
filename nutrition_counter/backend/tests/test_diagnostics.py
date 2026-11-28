import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from diagnostics import annotate


class DiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.cases = json.loads((Path(__file__).resolve().parents[2] / 'benchmark/questions.json').read_text(encoding='utf-8'))['cases']

    def check(self, case, mode, hits):
        index = SimpleNamespace(search=lambda question: [{'source_id': value} for value in hits])
        return annotate(case['question'], SimpleNamespace(mode=mode), index)

    def test_trap_refusal_is_not_e5_but_answer_is(self):
        trap = next(case for case in self.cases if case['kind'] == 'trap')
        self.assertEqual(self.check(trap, 'no_context', ['D01'])['codes'], [])
        self.assertIn('О —', self.check(trap, 'no_context', ['D01'])['label'])
        self.assertEqual(self.check(trap, 'gemini', ['D01'])['codes'], ['E5'])

    def test_rank_four_is_e1_and_no_semantic_grades_are_invented(self):
        case = self.cases[0]
        gold = case['relevant_documents'][0]
        self.assertEqual(self.check(case, 'gemini', ['D30', 'D29', 'D28', gold])['codes'], ['E1'])
        result = self.check(case, 'gemini', [gold])
        self.assertEqual(result['codes'], [])
        self.assertIn('требуют сверки', result['label'])

    def test_retrieval_only_is_not_graded_as_generation(self):
        result = self.check(self.cases[0], 'retrieval', [])
        self.assertEqual(result['codes'], [])
        self.assertIn('не выполнялась', result['label'])

    def test_unknown_question_needs_gold(self):
        result = annotate('Несуществующий вопрос', SimpleNamespace(mode='gemini'), None)
        self.assertEqual(result['codes'], [])
        self.assertIn('нужен эталон', result['label'])
