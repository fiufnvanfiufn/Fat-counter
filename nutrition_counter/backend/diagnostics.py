"""Post-generation benchmark checks; gold answers never enter retrieval or prompts."""
import json
from pathlib import Path


def annotate(question, answer, index):
    path = Path(__file__).parent.parent / "benchmark" / "questions.json"
    normalize = lambda value: " ".join(value.casefold().split()).rstrip(".?!")
    try:
        cases = json.loads(path.read_text(encoding="utf-8"))["cases"]
    except (OSError, ValueError, KeyError):
        return {"codes": [], "label": "E1–E6: эталоны недоступны",
                "basis": "Диагностика не выполнена. Это не влияет на получение ответа."}
    case = next((case for case in cases if normalize(case["question"]) == normalize(question)), None)
    if case is None:
        return {"codes": [], "label": "E1–E6: нужен эталон для автоматической проверки",
                "basis": "Вопрос не совпал с вопросом benchmark. Код не назначен; это не доказательство отсутствия ошибки."}
    if answer.mode == "retrieval":
        return {"codes": [], "label": "E1–E6: генерация не выполнялась",
                "basis": "Показаны найденные выдержки. Содержательный ответ не оценивался."}
    hits = list(dict.fromkeys(hit["source_id"] for hit in index.search(question)))
    gold = case["relevant_documents"]
    codes = []
    if case["should_abstain"]:
        if answer.mode == "no_context":
            label = "О — корректный отказ на вопрос-ловушку"
            basis = "По эталону ответа в корпусе нет; система отказалась и не показала выдуманный ответ. Это не E5."
        else:
            codes = ["E5"]
            label = "E5 — по эталону ответа в корпусе нет, но система ответила"
            basis = "Автоматическая структурная проверка вопроса-ловушки; содержание дополнительно проверяется человеком."
    else:
        if not set(gold).intersection(hits[:3]):
            codes.append("E1")
        label = ("E1 — эталонный документ отсутствует в топ-3" if codes else
                 "E1 не обнаружена; E2–E6 требуют сверки содержания")
        basis = "Нужные документы: " + ", ".join(gold) + ". Топ-3: " + (", ".join(hits[:3]) or "нет") + "."
        if answer.mode == "no_context" and set(gold).intersection(hits):
            label += "; проверить E3 — отказ при найденном эталонном документе"
    return {"case_id": case["id"], "codes": codes, "label": label, "basis": basis}
