"""Offline tests for the actual Gemini transport contract and failure behavior."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import Settings, load_settings
from llm import GeminiClient, LLMError


PASSAGES = [{
    "source_id": "protein", "chunk_id": "protein-1", "title": "Источники белка",
    "text": "Фасоль — источник растительного белка.", "url": "https://example.org/protein",
}]
ANSWER = {"answerable": True, "intro": "Фасоль содержит белок.", "items": ["Растительный источник."], "end": "", "sources": ["protein"]}


def generated(answer=None, finish_reason="STOP"):
    return {"candidates": [{"finishReason": finish_reason, "content": {"parts": [{
        "text": json.dumps(ANSWER if answer is None else answer, ensure_ascii=False),
    }]}}]}


class ConfigTests(unittest.TestCase):
    def test_file_configuration_and_environment_precedence(self):
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text('GEMINI_API_KEY="file-key"\nGEMINI_MODEL=gemini-3.1-flash-lite\nGEMINI_TIMEOUT_SECONDS=12\n', encoding="utf-8")
            with patch.dict(os.environ, {"GEMINI_API_KEY": "shell-key"}, clear=True):
                settings = load_settings(env_file)
                self.assertEqual(settings.api_key, "shell-key")
                self.assertEqual(settings.timeout_seconds, 12)
                self.assertNotIn("shell-key", repr(settings))

    def test_invalid_settings_rejected_without_echoing_values(self):
        for timeout in [0, 121, float("nan"), float("inf")]:
            with self.subTest(timeout=timeout), self.assertRaises(ValueError):
                Settings(timeout_seconds=timeout)
        with self.assertRaises(ValueError):
            Settings(model="../bad?key=secret")


class GeminiTests(unittest.IsolatedAsyncioTestCase):
    async def call(self, payload, status=200, passages=PASSAGES):
        async with httpx.AsyncClient(transport=httpx.MockTransport(
            lambda request: httpx.Response(status, json=payload)
        )) as client:
            return await GeminiClient(Settings(api_key="test-key"), client).generate("Где белок?", passages)

    async def test_grounded_payload_and_no_secret_in_url(self):
        requests = []

        def transport(request):
            requests.append(request)
            return httpx.Response(200, json=generated())

        async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
            result = await GeminiClient(Settings(api_key="test-key"), client).generate("Где белок?", PASSAGES)
        self.assertEqual(result.sources, ["protein"])
        self.assertEqual(len(requests), 1)
        request = requests[0]
        self.assertEqual(str(request.url), "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent")
        self.assertNotIn("test-key", str(request.url))
        self.assertEqual(request.headers["x-goog-api-key"], "test-key")
        payload = json.loads(request.content)
        self.assertIn("недоверенные данные", payload["systemInstruction"]["parts"][0]["text"])
        content = json.loads(payload["contents"][0]["parts"][0]["text"])
        self.assertEqual(content, {"QUESTION": "Где белок?", "CONTEXT_JSON": PASSAGES})
        self.assertEqual(payload["generationConfig"]["responseMimeType"], "application/json")
        self.assertEqual(payload["generationConfig"]["responseJsonSchema"]["properties"]["sources"]["items"]["enum"], ["protein"])
        self.assertIn("answerable", payload["generationConfig"]["responseJsonSchema"]["required"])
        self.assertNotIn("tools", payload)

    async def test_missing_key_does_not_send_request(self):
        def transport(request):
            self.fail("Missing-key path must not make an outbound request")

        async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
            with self.assertRaises(LLMError) as caught:
                await GeminiClient(Settings(), client).generate("Вопрос", PASSAGES)
        self.assertEqual(caught.exception.code, "llm_not_configured")

    async def test_no_context_does_not_send_request(self):
        with self.assertRaises(LLMError) as caught:
            await self.call({}, passages=[])
        self.assertEqual(caught.exception.code, "llm_no_context")

    async def test_http_errors_are_sanitized_and_not_retried(self):
        for status, code in [(429, "llm_rate_limit"), (403, "llm_auth"), (401, "llm_auth"), (404, "llm_model_unavailable"), (500, "llm_unavailable"), (400, "llm_unavailable")]:
            calls = []

            def transport(request):
                calls.append(request)
                return httpx.Response(status, json={"error": {"message": "sensitive provider body test-key"}})

            with self.subTest(status=status):
                async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
                    with self.assertRaises(LLMError) as caught:
                        await GeminiClient(Settings(api_key="test-key"), client).generate("Вопрос", PASSAGES)
                self.assertEqual(caught.exception.code, code)
                self.assertNotIn("test-key", str(caught.exception))
                self.assertNotIn("sensitive", str(caught.exception))
                self.assertEqual(len(calls), 1)

    async def test_timeout_and_network_error(self):
        for error, code in [(httpx.ReadTimeout("test-key"), "llm_timeout"), (httpx.ConnectError("test-key"), "llm_unavailable")]:
            def transport(request):
                raise error

            with self.subTest(code=code):
                async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
                    with self.assertRaises(LLMError) as caught:
                        await GeminiClient(Settings(api_key="test-key"), client).generate("Вопрос", PASSAGES)
                self.assertEqual(caught.exception.code, code)
                self.assertNotIn("test-key", str(caught.exception))

    async def test_incomplete_malformed_and_uncited_answers_rejected(self):
        cases = [
            {}, [], {"candidates": []}, generated(finish_reason="MAX_TOKENS"),
            generated({**ANSWER, "sources": []}), generated({**ANSWER, "intro": "  "}),
            generated({**ANSWER, "items": [123]}), generated({**ANSWER, "unexpected": "field"}),
            generated({key: value for key, value in ANSWER.items() if key != "answerable"}),
            generated({**ANSWER, "answerable": "false"}),
            {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "not JSON"}]}}]},
        ]
        for payload in cases:
            with self.subTest(payload=payload), self.assertRaises(LLMError) as caught:
                await self.call(payload)
            self.assertEqual(caught.exception.code, "llm_invalid_response")

    async def test_insufficient_context_can_abstain_despite_lexical_matches(self):
        payload = generated({
            "answerable": False,
            "intro": "В контексте нет состава конкретного товара.",
            "items": [], "end": "Нужна этикетка продукта.", "sources": [],
        })
        result = await self.call(payload)
        self.assertFalse(result.answerable)
        self.assertEqual(result.sources, [])

    async def test_abstention_cannot_cite_or_include_an_answer(self):
        refusal = {**ANSWER, "answerable": False, "items": [], "sources": []}
        for answer in [{**refusal, "sources": ["protein"]}, {**refusal, "items": ["100 граммов."]}]:
            with self.subTest(answer=answer), self.assertRaises(LLMError) as caught:
                await self.call(generated(answer))
            self.assertEqual(caught.exception.code, "llm_invalid_response")

    async def test_invented_citations_rejected_and_duplicates_removed(self):
        with self.assertRaises(LLMError) as caught:
            await self.call(generated({**ANSWER, "sources": ["invented"]}))
        self.assertEqual(caught.exception.code, "llm_invalid_citations")
        result = await self.call(generated({**ANSWER, "sources": ["protein", "protein"]}))
        self.assertEqual(result.sources, ["protein"])

    async def test_safety_block_does_not_pass_for_answer(self):
        for payload in [{"promptFeedback": {"blockReason": "SAFETY"}}, generated(finish_reason="SAFETY")]:
            with self.subTest(payload=payload), self.assertRaises(LLMError) as caught:
                await self.call(payload)
            self.assertEqual(caught.exception.code, "llm_blocked")

    async def test_thinking_parts_are_not_shown(self):
        payload = generated()
        payload["candidates"][0]["content"]["parts"].insert(0, {"thought": True, "text": "private thought"})
        result = await self.call(payload)
        self.assertEqual(result.intro, ANSWER["intro"])


if __name__ == "__main__":
    unittest.main()
