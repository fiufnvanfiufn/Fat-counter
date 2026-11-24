"""Retrieval + optional grounded Gemini generation; no mock-answer fallback."""

from __future__ import annotations

import asyncio

from config import Settings
from llm import GeminiClient, LLMError
from retrieval import BM25Index
from schemas import ChatResponse, DiarySummary


class RagService:
    def __init__(self, index: BM25Index, settings: Settings, client: GeminiClient | None = None):
        self.index = index
        self.settings = settings
        self.client = client or GeminiClient(settings)
        self._busy = False

    def status(self) -> dict:
        return dict(provider="gemini", configured=bool(self.settings.api_key), model=self.settings.model,
                    documents=len(self.index.articles), chunks=len(self.index.passages))

    async def answer(self, question: str, *, diary_context: dict | None = None) -> ChatResponse:
        diary_summary = (DiarySummary(**{key: diary_context[key] for key in
                         ("record_count", "totals", "targets", "scope_note")})
                         if diary_context is not None else None)
        if diary_context is not None and not diary_context["record_count"]:
            return ChatResponse(intro="В дневнике пока нет записанных блюд.", items=[],
                                end="Добавьте блюда в дневник питания и снова нажмите кнопку анализа.",
                                sources=[], mode="no_context", diary_summary=diary_summary)
        # For diary analysis retrieve general nutrition principles; calculations come
        # from the explicit server snapshot, never from invented personal records.
        search_question = question if diary_context is None else question + " сбалансированный рацион белок энергия"
        passages = self.index.search(search_question)
        if not passages:
            return ChatResponse(intro="В локальной базе не найдено подходящих материалов.", items=[],
                                end="Попробуйте уточнить вопрос о продуктах, белке, сбалансированном питании, соли или сахаре.",
                                sources=[], mode="no_context", passages=[], diary_summary=diary_summary)
        source_ids = list(dict.fromkeys(p["source_id"] for p in passages))
        if not self.settings.api_key:
            return ChatResponse(intro="Найдены материалы по вашему вопросу. Ниже — выдержки локальных конспектов.",
                                items=[], end="Откройте карточки, чтобы проверить конспект и оригинальную публикацию.",
                                sources=source_ids, passages=passages, mode="retrieval",
                                warning="LLM не подключена: добавьте GEMINI_API_KEY в backend/.env и перезапустите сервер.",
                                diary_summary=diary_summary)
        # No await occurs between the check and acquisition on a single event loop.
        if self._busy:
            raise LLMError("llm_busy", "Другой запрос к Gemini ещё выполняется. Попробуйте чуть позже.", 429)
        self._busy = True
        try:
            try:
                generation = (self.client.generate(question, passages) if diary_context is None
                              else self.client.generate(question, passages, diary_context=diary_context))
                generated = await asyncio.wait_for(generation, timeout=self.settings.timeout_seconds)
            except asyncio.TimeoutError:
                raise LLMError("llm_timeout", "Gemini не ответил вовремя. Попробуйте позже.", 504) from None
            if not generated.answerable:
                # A lexical hit is not proof that the requested fact exists. Do not
                # show loosely related sources as if they supported an answer.
                return ChatResponse(
                    intro="В найденных материалах недостаточно данных для ответа на этот вопрос.",
                    items=[], sources=[], passages=[], mode="no_context", model=self.settings.model,
                    end="Уточните вопрос или добавьте в корпус документ с нужными сведениями.",
                    warning="Gemini проверил найденные фрагменты и отказался от ответа: подтверждающих данных недостаточно.",
                    diary_summary=diary_summary,
                )
            if not generated.sources or not set(generated.sources).issubset(source_ids):
                raise LLMError("llm_invalid_citations", "Ответ содержит неподтверждённые источники и не был показан.")
            citations = list(dict.fromkeys(generated.sources))
            return ChatResponse(**{**generated.model_dump(exclude={"answerable"}), "sources": citations}, mode="gemini",
                                model=self.settings.model,
                                passages=[p for p in passages if p["source_id"] in citations],
                                diary_summary=diary_summary)
        finally:
            self._busy = False
