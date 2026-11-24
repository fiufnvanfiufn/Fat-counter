"""Benchmark structure and metric semantics, without network or model calls."""

import importlib.util
import sys
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
BENCHMARK = BACKEND.parent / "benchmark"
sys.path.insert(0, str(BACKEND))
spec = importlib.util.spec_from_file_location("benchmark_runner", BENCHMARK / "run.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class BenchmarkTests(unittest.TestCase):
    def test_frozen_dataset_has_30_documents_and_10_plus_5_cases(self):
        articles = runner.load_articles(runner.FROZEN_CORPUS)
        dataset, cases = runner.load_cases(BENCHMARK / "questions.json", articles)
        self.assertTrue(dataset["frozen_before_first_retrieval_run"])
        self.assertEqual(len(articles), 30)
        self.assertEqual(len(cases), 15)

    def test_metrics_count_unique_documents_and_respect_rank(self):
        result = runner.retrieval_metrics(["D02", "D02", "D01", "D03"], ["D01", "D04"])
        self.assertEqual(result["hit_at_4"], 1)
        self.assertEqual(result["recall_at_4"], 0.5)
        self.assertEqual(result["reciprocal_rank_at_4"], 0.5)

    def test_absent_gold_is_not_a_successful_retrieval(self):
        result = runner.retrieval_metrics(["D02"], ["D01"])
        self.assertEqual(result["hit_at_4"], 0)
        self.assertEqual(result["reciprocal_rank_at_4"], 0)
        with self.assertRaises(ValueError):
            runner.retrieval_metrics(["D02"], [])

    def test_offline_report_does_not_claim_trap_refusals(self):
        articles = runner.load_articles(runner.FROZEN_CORPUS)
        _, cases = runner.load_cases(BENCHMARK / "questions.json", articles)
        rows = runner.evaluate_retrieval(runner.BM25Index(articles), cases)
        self.assertIsNone(runner.summarize(rows, live=False)["trap_refusal_accuracy"])
        for row in rows:
            self.assertEqual(row["answer_evaluation"]["status"], "not_run")
            if row["kind"] == "trap":
                self.assertIsNone(row["retrieval"])


if __name__ == "__main__":
    unittest.main()
