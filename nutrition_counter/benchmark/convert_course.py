"""Convert the course command cheat-sheets and questions into the app corpus and benchmark format."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

BENCHMARK_DIR = Path(__file__).resolve().parent
KNOWLEDGE_DIR = BENCHMARK_DIR.parent / "backend" / "knowledge"

SOURCES = {
    "D01": ("https://git-scm.com/docs/git-reset", "Git documentation"),
    "D02": ("https://git-scm.com/docs/git-revert", "Git documentation"),
    "D03": ("https://git-scm.com/docs/git-reflog", "Git documentation"),
    "D04": ("https://www.gnu.org/software/coreutils/manual/html_node/chmod-invocation.html", "GNU Coreutils manual"),
    "D05": ("https://www.gnu.org/software/coreutils/manual/html_node/chown-invocation.html", "GNU Coreutils manual"),
    "D06": ("https://learn.microsoft.com/powershell/module/microsoft.powershell.security/set-executionpolicy", "Microsoft Learn"),
    "D07": ("https://www.gnu.org/software/coreutils/manual/html_node/df-invocation.html", "GNU Coreutils manual"),
    "D08": ("https://www.gnu.org/software/coreutils/manual/html_node/du-invocation.html", "GNU Coreutils manual"),
    "D09": ("https://keith.github.io/xcode-man-pages/diskutil.8.html", "Apple diskutil man page (mirror)"),
    "D10": ("https://man7.org/linux/man-pages/man1/ps.1.html", "Linux man-pages"),
    "D11": ("https://man7.org/linux/man-pages/man1/top.1.html", "Linux man-pages"),
    "D12": ("https://man7.org/linux/man-pages/man1/kill.1.html", "Linux man-pages"),
    "D13": ("https://man7.org/linux/man-pages/man8/ping.8.html", "Linux man-pages"),
    "D14": ("https://man7.org/linux/man-pages/man8/traceroute.8.html", "Linux man-pages"),
    "D15": ("https://www.bitwizard.nl/mtr/", "BitWizard MTR"),
    "D16": ("https://docs.docker.com/reference/cli/docker/container/ls/", "Docker Docs"),
    "D17": ("https://docs.docker.com/reference/cli/docker/container/logs/", "Docker Docs"),
    "D18": ("https://docs.docker.com/reference/cli/docker/container/exec/", "Docker Docs"),
    "D19": ("https://www.sqlite.org/lang_select.html", "SQLite documentation"),
    "D20": ("https://www.sqlite.org/lang_select.html", "SQLite documentation"),
    "D21": ("https://www.sqlite.org/lang_select.html", "SQLite documentation"),
    "D22": ("https://docs.python.org/3/library/venv.html", "Python documentation"),
    "D23": ("https://pip.pypa.io/en/stable/cli/pip_install/", "pip documentation"),
    "D24": ("https://pip.pypa.io/en/stable/cli/pip_freeze/", "pip documentation"),
    "D25": ("https://man.openbsd.org/ssh.1", "OpenBSD manual pages"),
    "D26": ("https://man.openbsd.org/scp.1", "OpenBSD manual pages"),
    "D27": ("https://rsync.samba.org/documentation.html", "rsync documentation"),
    "D28": ("https://www.gnu.org/software/grep/manual/grep.html", "GNU grep manual"),
    "D29": ("https://man7.org/linux/man-pages/man1/find.1.html", "Linux man-pages"),
    "D30": ("https://learn.microsoft.com/powershell/module/microsoft.powershell.utility/select-string", "Microsoft Learn"),
}

CHECKED_ON = "2026-11-28"


def convert_docs(docs: list[dict]) -> list[dict]:
    articles = []
    for doc in docs:
        url, publisher = SOURCES[doc["id"]]
        examples = "; ".join(doc["examples"])
        content = f"{doc['description']} Команда: {doc['command']}. Примеры: {examples}."
        keywords = list(dict.fromkeys(doc["tags"]))
        articles.append({
            "id": doc["id"],
            "title": doc["name"],
            "category": "articles",
            "description": f"Учебная шпаргалка по команде «{doc['name']}». Не полный текст оригинала; сверяйте с документацией по ссылке.",
            "publisher": publisher,
            "url": url,
            "updated_at": CHECKED_ON,
            "content": content,
            "keywords": keywords,
        })
    return articles


def convert_questions(dataset: dict) -> dict:
    cases = []
    for item in dataset["questions"]:
        if item["type"] == "regular":
            cases.append({
                "id": item["id"],
                "kind": "normal",
                "question": item["question"],
                "relevant_documents": item["relevant"],
                "reference_answer": item["reference"],
                "expected_points": [f"Упоминает: {term}" for term in item["must_include"]],
                "should_abstain": False,
            })
        else:
            cases.append({
                "id": item["id"],
                "kind": "trap",
                "question": item["question"],
                "relevant_documents": [],
                "reference_answer": item["expected"],
                "expected_points": ["Не выдумывает ответ при отсутствии данных в документах"],
                "should_abstain": True,
                "missing_information": item["expected"],
            })
    return {
        "benchmark_id": "course-commands-v1",
        "version": "1.0.0",
        "created_on": CHECKED_ON,
        "frozen_before_first_retrieval_run": True,
        "description": "Учебный набор команд: 30 документов D01–D30, 10 вопросов с ответом и 5 ловушек. Конвертирован из docs.json и questions.json.",
        "cases": cases,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docs", type=Path, required=True)
    parser.add_argument("--questions", type=Path, required=True)
    args = parser.parse_args()
    docs = json.loads(args.docs.read_text(encoding="utf-8"))
    questions = json.loads(args.questions.read_text(encoding="utf-8"))
    articles = convert_docs(docs)
    (KNOWLEDGE_DIR / "commands.json").write_text(
        json.dumps(articles, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    (BENCHMARK_DIR / "course-questions.json").write_text(
        json.dumps(convert_questions(questions), ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"documents: {len(articles)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
