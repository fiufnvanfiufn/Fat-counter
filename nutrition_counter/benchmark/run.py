"""Reproducible classroom benchmark. Default mode is offline and never loads an API key."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

BENCHMARK_DIR = Path(__file__).resolve().parent
BACKEND_DIR = BENCHMARK_DIR.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from retrieval import BM25Index, load_articles

FROZEN_CORPUS = BENCHMARK_DIR / "corpus-v1.json"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_cases(path: Path, articles) -> tuple[dict, list[dict]]:
    dataset = json.loads(path.read_text(encoding="utf-8"))
    if dataset.get("frozen_before_first_retrieval_run") is not True:
        raise ValueError("Questions and reference answers must be frozen before evaluation")
    cases = dataset["cases"]
    expected_docs = {f"D{i:02}" for i in range(1, 31)}
    ids = [article.id for article in articles]
    if len(ids) != 30 or set(ids) != expected_docs:
        raise ValueError("Benchmark requires exactly 30 unique document IDs D01–D30")
    normal = [case for case in cases if case.get("kind") == "normal"]
    traps = [case for case in cases if case.get("kind") == "trap"]
    if len(cases) != 15 or len(normal) != 10 or len(traps) != 5:
        raise ValueError("Benchmark requires exactly 10 normal questions and 5 traps")
    if {case["id"] for case in normal} != {f"Q{i:02}" for i in range(1, 11)}:
        raise ValueError("Normal question IDs must be Q01–Q10")
    if {case["id"] for case in traps} != {f"T{i:02}" for i in range(1, 6)}:
        raise ValueError("Trap IDs must be T01–T05")
    if len({case["question"].strip() for case in cases}) != 15:
        raise ValueError("Questions must be unique")
    for case in cases:
        if not case["question"].strip() or not case["reference_answer"].strip() or not case["expected_points"]:
            raise ValueError(f"Missing question, reference answer or rubric: {case['id']}")
        relevant = case["relevant_documents"]
        if len(relevant) != len(set(relevant)) or not set(relevant).issubset(expected_docs):
            raise ValueError(f"Invalid gold document IDs: {case['id']}")
        if case["kind"] == "normal" and (not relevant or case["should_abstain"] is not False):
            raise ValueError(f"Answerable question needs relevant documents: {case['id']}")
        if case["kind"] == "trap" and (relevant or case["should_abstain"] is not True or not case.get("missing_information")):
            raise ValueError(f"Trap needs empty gold documents and missing-information rationale: {case['id']}")
    return dataset, cases


def retrieval_metrics(retrieved: list[str], relevant: list[str]) -> dict:
    """Metrics use unique document IDs, not repeated passages from the same document."""
    retrieved = list(dict.fromkeys(retrieved))[:4]
    gold = set(relevant)
    if not gold:
        raise ValueError("Retrieval relevance metrics are undefined for unanswerable questions")
    matches = len(set(retrieved).intersection(gold))
    first_rank = next((rank for rank, source_id in enumerate(retrieved, 1) if source_id in gold), None)
    return {
        "hit_at_4": int(matches > 0),
        "recall_at_4": matches / len(gold),
        "reciprocal_rank_at_4": 1 / first_rank if first_rank else 0.0,
    }


def evaluate_retrieval(index: BM25Index, cases: list[dict]) -> list[dict]:
    rows = []
    for case in cases:
        hits = index.search(case["question"], limit=4)
        retrieved = list(dict.fromkeys(hit["source_id"] for hit in hits))
        rows.append({
            "id": case["id"], "kind": case["kind"], "question": case["question"],
            "relevant_documents": case["relevant_documents"], "retrieved_documents": retrieved,
            "retrieved_passages": hits,
            "retrieval": retrieval_metrics(retrieved, case["relevant_documents"]) if case["kind"] == "normal" else None,
            "answer_evaluation": {"status": "not_run", "reason": "Offline mode measures retrieval only; no answer or semantic refusal was generated."},
        })
    return rows


async def evaluate_live(index: BM25Index, cases: list[dict], rows: list[dict], delay: float) -> str:
    # Import and read configuration only after the explicit --live flag.
    from config import load_settings
    from llm import LLMError
    from rag import RagService

    settings = load_settings()
    if not settings.api_key:
        raise ValueError("--live requires GEMINI_API_KEY in backend/.env or the environment; no live requests were made")
    service = RagService(index, settings)
    for position, (case, row) in enumerate(zip(cases, rows)):
        if position and delay:
            await asyncio.sleep(delay)
        print(f"[{position + 1}/{len(cases)}] {case['id']}: running", file=sys.stderr, flush=True)
        try:
            result = await service.answer(case["question"])
        except LLMError as error:
            row["answer_evaluation"] = {"status": "provider_error", "code": error.code, "message": error.message,
                                        "refusal_pass": False if case["should_abstain"] else None}
            print(f"[{position + 1}/{len(cases)}] {case['id']}: {error.code}", file=sys.stderr, flush=True)
            continue
        # A provider error or retrieval-only answer does not count as an abstention.
        refusal = result.mode == "no_context" and not result.sources and not result.items
        allowed = set(row["retrieved_documents"])
        evaluation = {
            "status": "evaluated", "actual_mode": result.mode,
            "sources_within_retrieved_context": set(result.sources).issubset(allowed),
            "cited_gold_document": bool(set(result.sources).intersection(case["relevant_documents"])) if case["kind"] == "normal" else None,
            "refusal_pass": refusal if case["should_abstain"] else None,
            "false_refusal": refusal if not case["should_abstain"] else None,
            "semantic_answer_grade": "manual_review_required",
            "actual_answer": result.model_dump(),
        }
        row["answer_evaluation"] = evaluation
        print(f"[{position + 1}/{len(cases)}] {case['id']}: {result.mode}", file=sys.stderr, flush=True)
    return settings.model


def summarize(rows: list[dict], live: bool) -> dict:
    normal = [row for row in rows if row["kind"] == "normal"]
    traps = [row for row in rows if row["kind"] == "trap"]
    summary = {
        "normal_questions": len(normal), "trap_questions": len(traps),
        "hit_at_4": sum(row["retrieval"]["hit_at_4"] for row in normal) / len(normal),
        "recall_at_4": sum(row["retrieval"]["recall_at_4"] for row in normal) / len(normal),
        "mrr_at_4": sum(row["retrieval"]["reciprocal_rank_at_4"] for row in normal) / len(normal),
        "trap_refusal_accuracy": None,
        "normal_answer_semantic_accuracy": None,
    }
    if live:
        # Errors remain in the denominator and are never scored as successful refusals.
        summary["trap_refusal_accuracy"] = sum(row["answer_evaluation"].get("refusal_pass") is True for row in traps) / len(traps)
        summary["provider_errors"] = sum(row["answer_evaluation"]["status"] == "provider_error" for row in rows)
        summary["false_refusals_on_normal_questions"] = sum(row["answer_evaluation"].get("false_refusal") is True for row in normal)
    return summary


def write_materials(articles, dataset: dict) -> None:
    """Readable instructor handout generated from the same frozen inputs as evaluation."""
    lines = ["# Документы benchmark: D01–D30", "", "Замороженный корпус исходного benchmark: `benchmark/corpus-v1.json`. Рабочие статьи приложения находятся отдельно в `backend/knowledge/articles.json` и могут обновляться. Все тексты ниже — краткие русскоязычные конспекты, не полные оригинальные статьи. Дата проверки относится к локальному конспекту.", "",
             "| ID | Документ | Издатель |", "| --- | --- | --- |"]
    for article in articles:
        lines.append(f"| [{article.id}](#{article.id.lower()}) | {article.title} | {article.publisher} |")
    for article in articles:
        lines.extend(["", f"## {article.id}", "", f"**{article.title}**", "", f"Издатель: {article.publisher}. Проверено: {article.updated_at}.", "",
                      f"[Оригинальная публикация]({article.url})", "", article.content])
    (BENCHMARK_DIR / "documents.md").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    lines = ["# Вопросы и эталонные ответы", "", f"Версия: `{dataset['version']}`. Набор подготовлен до первого прогона. При изменении корпуса или вопросов сохраняйте новые версии и сравнивайте отпечатки в отчёте.", ""]
    for case in dataset["cases"]:
        lines.extend([f"## {case['id']} — {'обычный вопрос' if case['kind'] == 'normal' else 'ловушка'}", "", case["question"], "",
                      "**Релевантные документы:** " + (", ".join(f"[{doc}](documents.md#{doc.lower()})" for doc in case["relevant_documents"]) or "нет: ответа в корпусе нет"), "",
                      "**Эталон:** " + case["reference_answer"], "", "**Критерии ручной оценки:**", ""])
        lines.extend(f"* {point}" for point in case["expected_points"])
        if case.get("missing_information"):
            lines.extend(["", "**Почему это ловушка:** " + case["missing_information"]])
        lines.append("")
    (BENCHMARK_DIR / "answer_key.md").write_text("\n".join(lines), encoding="utf-8", newline="\n")


def markdown_report(report: dict) -> str:
    summary = report["summary"]
    lines = ["# Результаты benchmark", "", f"Режим: **{report['mode']}**. Время: {report['created_at']}.", "",
             f"Корпус: {report['documents']} документов; набор: 10 обычных вопросов + 5 ловушек.", "",
             f"* Hit@4: **{summary['hit_at_4']:.1%}**", f"* Recall@4: **{summary['recall_at_4']:.1%}**", f"* MRR@4: **{summary['mrr_at_4']:.3f}**", ""]
    if report["mode"] == "offline":
        lines.append("**Генерация и семантический отказ не проверялись.** Найденные для ловушек документы показывают лексическое сходство, а не наличие ответа. Это не 5 успешных отказов. Качество текста и полноту ответа нужно оценивать отдельно.")
    else:
        lines.append(f"Отказы на ловушках: **{summary['trap_refusal_accuracy']:.1%}**; ошибки провайдера: {summary['provider_errors']}. Правильность обычных ответов требует ручной сверки с эталонами.")
    lines.extend(["", "## Поиск по обычным вопросам", "", "| Вопрос | Эталонные документы | Найдены | Hit@4 | Recall@4 | RR@4 |", "| --- | --- | --- | --- | --- | --- |"])
    for row in report["cases"]:
        if row["kind"] == "normal":
            score = row["retrieval"]
            lines.append(f"| {row['id']} | {', '.join(row['relevant_documents'])} | {', '.join(row['retrieved_documents']) or '—'} | {score['hit_at_4']} | {score['recall_at_4']:.2f} | {score['reciprocal_rank_at_4']:.3f} |")
    lines.extend(["", "## Ловушки", "", "| Вопрос | Лексические кандидаты | Проверка отказа |", "| --- | --- | --- |"])
    for row in report["cases"]:
        if row["kind"] == "trap":
            evaluation = row["answer_evaluation"]
            status = "не выполнялась" if evaluation["status"] == "not_run" else "ошибка провайдера" if evaluation["status"] == "provider_error" else "успешный отказ" if evaluation["refusal_pass"] else "ожидаемый отказ не получен"
            lines.append(f"| {row['id']} | {', '.join(row['retrieved_documents']) or 'нет'} | {status} |")
    if report["mode"] == "live":
        lines.extend(["", "## Фактические ответы для ручной проверки", ""])
        for row in report["cases"]:
            evaluation = row["answer_evaluation"]
            lines.extend([f"### {row['id']}", "", row["question"], ""])
            answer = evaluation.get("actual_answer")
            if answer:
                lines.extend([f"Режим: `{answer['mode']}`. Источники: {', '.join(answer['sources']) or 'нет'}.", "", answer["intro"], ""])
                lines.extend(f"* {item}" for item in answer["items"])
                lines.extend(["", answer["end"], ""])
            else:
                lines.extend(["Ошибка: " + evaluation.get("message", evaluation["status"]), ""])
    lines.extend(["", "## Воспроизводимость", "", f"* Benchmark: `{report['benchmark_id']}`, версия `{report['version']}`.", f"* SHA-256 корпуса: `{report['corpus_sha256']}`.", f"* SHA-256 вопросов: `{report['questions_sha256']}`.", f"* Поиск: `{report.get('retrieval_version', 'bm25-v1')}`, вес заголовка `{report.get('title_weight', 0)}`.", f"* Модель: `{report['model'] or 'не вызывалась'}`.", "", "Эталонные ответы и список релевантных документов не подаются поиску или модели. Совпадение допустимых ID источников не доказывает фактическую обоснованность всех утверждений."])
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Explicitly call Gemini for all 15 questions (uses provider quota)")
    parser.add_argument("--corpus", type=Path, default=FROZEN_CORPUS,
                        help="Corpus to evaluate; default is the archived v1 corpus, not the evolving app corpus")
    parser.add_argument("--title-weight", type=float, default=0,
                        help="Title BM25 boost: 0 reproduces original v1; 2 uses app retrieval v2")
    parser.add_argument("--delay", type=float, default=0, help="Seconds between live questions, 0–60; no retries")
    parser.add_argument("--export-documents", action="store_true", help="Refresh readable documents.md and answer_key.md from frozen inputs")
    parser.add_argument("--output", type=Path, default=None, help="Output prefix for .json and .md reports")
    args = parser.parse_args()
    if not 0 <= args.delay <= 60:
        parser.error("--delay must be between 0 and 60 seconds")
    if not 0 <= args.title_weight <= 10:
        parser.error("--title-weight must be between 0 and 10")
    try:
        articles = load_articles(args.corpus)
        questions_path = BENCHMARK_DIR / "questions.json"
        dataset, cases = load_cases(questions_path, articles)
        index = BM25Index(articles, title_weight=args.title_weight)
        rows = evaluate_retrieval(index, cases)
        model = asyncio.run(evaluate_live(index, cases, rows, args.delay)) if args.live else None
        report = {
            "benchmark_id": dataset["benchmark_id"], "version": dataset["version"],
            "created_at": datetime.now(timezone.utc).isoformat(), "mode": "live" if args.live else "offline",
            "model": model, "documents": len(articles), "chunks": len(index.passages),
            "corpus_sha256": sha256(args.corpus), "questions_sha256": sha256(questions_path),
            "retrieval_version": "bm25-v1" if args.title_weight == 0 else "bm25-title-v2",
            "title_weight": args.title_weight,
            "summary": summarize(rows, args.live), "cases": rows,
        }
        prefix = args.output or BENCHMARK_DIR / "results" / report["mode"]
        prefix.parent.mkdir(parents=True, exist_ok=True)
        prefix.with_suffix(".json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
        prefix.with_suffix(".md").write_text(markdown_report(report), encoding="utf-8", newline="\n")
        if args.export_documents:
            write_materials(articles, dataset)
        print(json.dumps({"mode": report["mode"], "summary": report["summary"], "report": str(prefix.with_suffix('.md'))}, ensure_ascii=False, indent=2))
        return 0
    except (ValueError, KeyError, OSError) as error:
        print(f"Benchmark error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
