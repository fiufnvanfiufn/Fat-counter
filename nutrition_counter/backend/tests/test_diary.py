"""Knowledge catalog and explicit diary-context integration, isolated from user data."""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

import database
import main
from config import Settings
from llm import GroundedAnswer


class DiaryApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(database, "DB_PATH", str(Path(self.temp.name) / "test.db"))
        self.settings_patch = patch.object(main, "load_settings", return_value=Settings(api_key="test-not-real"))
        self.db_patch.start()
        self.settings_patch.start()
        self.client = TestClient(main.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.settings_patch.stop()
        self.db_patch.stop()
        self.temp.cleanup()

    def test_knowledge_catalog_independent_of_bookmarks_and_legacy(self):
        response = self.client.get("/api/knowledge")
        self.assertEqual(response.status_code, 200)
        catalog = response.json()
        self.assertEqual([source["id"] for source in catalog], [f"D{i:02}" for i in range(1, 31)])
        self.assertTrue(all(source["content"] and source["url"].startswith("https://") for source in catalog))
        self.assertEqual([source["id"] for source in self.client.get("/api/knowledge?q=d08").json()], ["D08"])
        self.assertIn("D08", [source["id"] for source in self.client.get("/api/knowledge?q=сахар").json()])
        self.assertEqual(self.client.get("/api/knowledge?q=несуществующаяабракадабра").json(), [])

    def test_general_chat_never_reads_or_sends_diary(self):
        captured = []
        class Fake:
            async def generate(self, question, passages, **options):
                captured.append(options)
                return GroundedAnswer(answerable=True, intro="Общий ответ", items=[], end="", sources=[passages[0]["source_id"]])
        main.app.state.rag.client = Fake()
        with patch.object(main, "get_diary_context", new_callable=AsyncMock) as snapshot:
            response = self.client.post("/api/chat", json={"question": "Белок"})
        self.assertEqual(response.status_code, 200)
        snapshot.assert_not_awaited()
        self.assertEqual(captured, [{}])
        self.assertIsNone(response.json()["diary_summary"])

    def test_explicit_diary_uses_server_totals_and_only_minimal_personal_fields(self):
        captured = []
        class Fake:
            async def generate(self, question, passages, *, diary_context=None):
                captured.append(diary_context)
                return GroundedAnswer(answerable=True, intro="Анализ записей", items=[], end="", sources=[passages[0]["source_id"]])
        main.app.state.rag.client = Fake()
        response = self.client.post("/api/chat", json={"question": "Проанализируй записанный рацион", "scope": "diary"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(captured), 1)
        context = captured[0]
        self.assertEqual(context["record_count"], 4)
        self.assertEqual(context["meal_groups_count"], 2)
        self.assertEqual(context["totals"], {"calories": 795, "protein": 59, "fat": 30.5, "carbs": 66})
        self.assertEqual(context["targets"], {"calories": 2100, "protein": 120})
        self.assertFalse(set(context).intersection({"name", "age", "height", "weight", "lactose", "gluten"}))
        self.assertNotIn("Алексей", json.dumps(context, ensure_ascii=False))
        summary = response.json()["diary_summary"]
        self.assertEqual(summary["totals"], context["totals"])
        self.assertNotIn("meals", summary)

    def test_empty_diary_is_helpful_and_never_calls_llm(self):
        self.client.delete("/api/meals")
        fake = AsyncMock()
        main.app.state.rag.client = fake
        response = self.client.post("/api/chat", json={"question": "Проанализируй рацион", "scope": "diary"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["mode"], "no_context")
        self.assertEqual(response.json()["diary_summary"]["record_count"], 0)
        self.assertIn("нет записанных блюд", response.json()["intro"])
        fake.generate.assert_not_awaited()

    def test_unknown_scope_rejected(self):
        self.assertEqual(self.client.post("/api/chat", json={"question": "Белок", "scope": "all-private-data"}).status_code, 422)


if __name__ == "__main__":
    unittest.main()
