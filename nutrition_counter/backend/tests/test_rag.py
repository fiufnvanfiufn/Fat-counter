"""Run from any directory: python -m unittest discover -s .../backend/tests -v."""

import asyncio
import json
import math
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

import database
import main
from config import Settings
from llm import GroundedAnswer, LLMError
from rag import RagService
from retrieval import BM25Index, Tokenizer, chunk_text, load_articles


class RetrievalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.articles = load_articles()
        cls.index = BM25Index(cls.articles)

    def test_known_questions_retrieve_expected_original(self):
        questions = {
            "Чем заменить свинину в рационе?": "D04",
            "Какие продукты богаты белком?": "D03",
            "Как собрать сбалансированный обед?": "D02",
            "Как уменьшить соль?": "D07",
            "В каких продуктах клетчатка?": "D05",
            "Сколько пить воды?": "D09",
            "Что выбрать для перекуса?": "D11",
        }
        for question, expected in questions.items():
            with self.subTest(question=question):
                hits = self.index.search(question)
                self.assertIn(expected, [p["source_id"] for p in hits])
                self.assertLessEqual(len(hits), 4)
                for hit in hits:
                    article = next(a for a in self.articles if a.id == hit["source_id"])
                    self.assertIn(hit["text"], article.content)
                    self.assertGreater(hit["score"], 0)

    def test_no_context_instead_of_unrelated_sources(self):
        for question in ("", "   ", "что и как", "Квантовая телепортация фотонов", "123456"):
            self.assertEqual(self.index.search(question), [])

    def test_stemming_and_unicode(self):
        tokenize = Tokenizer()
        self.assertEqual(tokenize("БЕЛОК"), tokenize("белком"))
        self.assertEqual(tokenize("соль"), tokenize("соли"))
        self.assertEqual(tokenize("мёд"), tokenize("мед"))

    def test_bm25_formula(self):
        article = self.articles[0].model_copy(update={"title": "Клетчатка", "content": "Клетчатка", "keywords": []})
        index = BM25Index([article])
        expected = math.log(1 + 0.5 / 1.5) * 2 * 2.5 / (2 + 1.5)
        expected += 2 * math.log(1 + 0.5 / 1.5)
        self.assertAlmostEqual(index.search("клетчатка")[0]["score"], expected, places=5)

    def test_oversized_chunks_are_verbatim_and_bounded(self):
        text = " ".join(f"слово{i}" for i in range(410)) + "\n\nПоследний абзац."
        chunks = chunk_text(text)
        self.assertGreater(len(chunks), 2)
        self.assertTrue(all(len(chunk.split()) <= 180 and chunk in text for chunk in chunks))


class ServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.index = BM25Index(load_articles())

    async def test_no_key_returns_actual_retrieval(self):
        result = await RagService(self.index, Settings()).answer("Чем заменить свинину?")
        self.assertEqual(result.mode, "retrieval")
        self.assertIsNone(result.model)
        self.assertIn("GEMINI_API_KEY", result.warning)
        self.assertTrue(result.passages)

    async def test_no_matches_does_not_call_configured_provider(self):
        class NoCall:
            async def generate(self, *args):
                raise AssertionError("Should not call LLM without context")
        result = await RagService(self.index, Settings(api_key="test"), NoCall()).answer("Квантовый компьютер")
        self.assertEqual(result.mode, "no_context")
        self.assertEqual(result.sources, [])

    async def test_generation_limits_sources_to_cited_context(self):
        class Fake:
            async def generate(self, question, passages):
                return GroundedAnswer(answerable=True, intro="Ответ", items=[], end="", sources=[passages[0]["source_id"]])
        result = await RagService(self.index, Settings(api_key="test"), Fake()).answer("Продукты с белком")
        self.assertEqual(result.mode, "gemini")
        self.assertEqual({p.source_id for p in result.passages}, set(result.sources))

    async def test_unknown_citations_rejected(self):
        class Fake:
            async def generate(self, *args):
                return GroundedAnswer(answerable=True, intro="Ответ", items=[], end="", sources=["invented"])
        with self.assertRaises(LLMError) as error:
            await RagService(self.index, Settings(api_key="test"), Fake()).answer("Белок")
        self.assertEqual(error.exception.code, "llm_invalid_citations")

    async def test_lexical_matches_without_answer_support_refusal(self):
        # There are protein-related lexical hits, but no exact branded-product data.
        question = "Сколько белка ровно в банке продукта SuperExactBrand?"
        self.assertTrue(self.index.search(question))
        calls = []
        class Insufficient:
            async def generate(self, question, passages):
                calls.append((question, passages))
                return GroundedAnswer(answerable=False, intro="Данных нет.", items=[],
                                      end="Состав товара отсутствует.", sources=[])
        service = RagService(self.index, Settings(api_key="test"), Insufficient())
        result = await service.answer(question)
        self.assertEqual(len(calls), 1)
        self.assertEqual(result.mode, "no_context")
        self.assertEqual(result.model, Settings().model)
        self.assertEqual(result.items, [])
        self.assertEqual(result.sources, [])
        self.assertEqual(result.passages, [])
        self.assertFalse(service._busy)

    async def test_busy_slot_released_on_cancellation_and_error(self):
        entered = asyncio.Event()
        class Blocking:
            async def generate(self, *args):
                entered.set()
                await asyncio.Event().wait()
        service = RagService(self.index, Settings(api_key="test"), Blocking())
        task = asyncio.create_task(service.answer("Белок"))
        await entered.wait()
        with self.assertRaises(LLMError) as error:
            await service.answer("Белок")
        self.assertEqual(error.exception.status_code, 429)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertFalse(service._busy)

    async def test_disconnect_cancels_provider_and_releases_slot(self):
        class Blocking:
            async def generate(self, *args):
                await asyncio.Event().wait()
        service = RagService(self.index, Settings(api_key="test"), Blocking())
        async def disconnected():
            return True
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(rag=service)),
                                  is_disconnected=disconnected)
        result = await main.chat(main.ChatRequest(question="Белок"), request)
        self.assertEqual(result.status_code, 499)
        self.assertFalse(service._busy)


class ApiMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.dbpath = str(Path(self.temp.name) / "existing.db")
        # Simulate a pre-RAG DB with an existing favorite.
        with closing(sqlite3.connect(self.dbpath)) as db:
            db.execute("CREATE TABLE sources (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL, bookmarked INTEGER NOT NULL DEFAULT 0)")
            db.execute("INSERT INTO sources VALUES ('legacy', 'Старый материал', 'articles', 'Описание', 1)")
            db.execute("INSERT INTO sources VALUES ('harvard-protein', 'Белок (прежний ID)', 'articles', 'Сохранённый источник', 1)")
            db.commit()
        self.db_patch = patch.object(database, "DB_PATH", self.dbpath)
        self.settings_patch = patch.object(main, "load_settings", return_value=Settings())
        self.db_patch.start()
        self.settings_patch.start()
        self.client = TestClient(main.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.settings_patch.stop()
        self.db_patch.stop()
        self.temp.cleanup()

    def test_status_and_validation(self):
        status = self.client.get("/api/chat/status").json()
        self.assertFalse(status["configured"])
        self.assertEqual(status["documents"], len(load_articles()))
        for question in ("", "   ", "x" * 2001):
            self.assertEqual(self.client.post("/api/chat", json={"question": question}).status_code, 422)

    def test_chat_sources_can_be_opened_and_bookmarked(self):
        result = self.client.post("/api/chat", json={"question": "Чем заменить свинину?"})
        self.assertEqual(result.status_code, 200)
        answer = result.json()
        self.assertEqual(answer["mode"], "retrieval")
        source_id = answer["sources"][0]
        source = self.client.get(f"/api/sources/{source_id}").json()
        self.assertTrue(source["url"].startswith("https://"))
        self.assertTrue(source["content"])
        marked = self.client.patch(f"/api/sources/{source_id}/bookmark", json={"bookmarked": True}).json()
        self.assertTrue(marked["bookmarked"])
        self.assertEqual(marked["url"], source["url"])
        # Re-index/upsert must preserve this state.
        asyncio.run(database.sync_articles(load_articles()))
        self.assertTrue(self.client.get(f"/api/sources/{source_id}").json()["bookmarked"])

    def test_legacy_and_existing_apis_preserved(self):
        old = self.client.get("/api/sources/legacy").json()
        self.assertTrue(old["bookmarked"])
        self.assertEqual(old["url"], "")
        self.assertEqual(self.client.get("/api/profile").status_code, 200)
        self.assertEqual(self.client.get("/api/foods").status_code, 200)
        meal = self.client.post("/api/meals", json={"meal": "snack", "name": "Тест", "cals": 100}).json()
        self.assertIn(meal["id"], [m["id"] for m in self.client.get("/api/meals").json()])
        self.assertEqual(self.client.delete(f"/api/meals/{meal['id']}").status_code, 204)

    def test_canonical_id_migration_copies_bookmark_once(self):
        migrated = self.client.get("/api/sources/D03")
        self.assertEqual(migrated.status_code, 200)
        self.assertTrue(migrated.json()["bookmarked"])
        listed = {source["id"] for source in self.client.get("/api/sources").json()}
        self.assertIn("D03", listed)
        self.assertNotIn("harvard-protein", listed)
        # The user's newer unstar must take precedence over the retained old row.
        unstarred = self.client.patch("/api/sources/D03/bookmark", json={"bookmarked": False})
        self.assertEqual(unstarred.status_code, 200)
        self.assertFalse(unstarred.json()["bookmarked"])
        asyncio.run(database.sync_articles(load_articles()))
        self.assertFalse(self.client.get("/api/sources/D03").json()["bookmarked"])
        self.assertTrue(self.client.get("/api/sources/harvard-protein").json()["bookmarked"])

    def test_safe_provider_error_contract(self):
        async def fail(question):
            raise LLMError("llm_rate_limit", "Квота исчерпана", 429)
        with patch.object(main.app.state.rag, "answer", side_effect=fail):
            result = self.client.post("/api/chat", json={"question": "Белок"})
        self.assertEqual(result.status_code, 429)
        self.assertEqual(result.json()["detail"]["code"], "llm_rate_limit")
        self.assertEqual(result.headers["retry-after"], "10")

    def test_invalid_model_json_returns_specific_error_instead_of_502(self):
        async def fail(question):
            raise LLMError("llm_schema_mismatch", "JSON Gemini не соответствует формату ответа: items.", 424)
        with patch.object(main.app.state.rag, "answer", side_effect=fail):
            result = self.client.post("/api/chat", json={"question": "Белок"})
        self.assertEqual(result.status_code, 424)
        self.assertEqual(result.json()["detail"], {
            "code": "llm_schema_mismatch", "message": "JSON Gemini не соответствует формату ответа: items."
        })

    def test_benchmark_trap_refusal_has_automatic_annotation(self):
        cases = json.loads((Path(__file__).resolve().parents[2] / "benchmark/questions.json").read_text(encoding="utf-8"))["cases"]
        case = next(case for case in cases if case["id"] == "T05")
        async def refuse(question):
            return main.ChatResponse(mode="no_context", intro="Недостаточно данных", items=[], end="", sources=[], passages=[])
        with patch.object(main.app.state.rag, "answer", side_effect=refuse):
            result = self.client.post("/api/chat", json={"question": case["question"]})
        self.assertEqual(result.status_code, 200)
        diagnostic = result.json()["diagnostic"]
        self.assertEqual(diagnostic["case_id"], "T05")
        self.assertEqual(diagnostic["codes"], [])
        self.assertIn("О —", diagnostic["label"])

    def test_secrets_and_backend_not_served_as_static(self):
        for path in ("/.env", "/backend/.env", "/knowledge/articles.json"):
            self.assertEqual(self.client.get(path).status_code, 404)


if __name__ == "__main__":
    unittest.main()
