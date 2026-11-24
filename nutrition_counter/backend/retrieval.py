"""Deterministic local BM25 retrieval over reviewed, source-linked Russian notes."""

from __future__ import annotations

import json
import math
import re
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

import snowballstemmer
from pydantic import BaseModel, Field, field_validator


CORPUS_PATH = Path(__file__).parent / "knowledge" / "articles.json"
STOP_WORDS = set("а без бы в вам вас ваш ваши вы где да для до его ее если есть еще же за зачем и из или их к как какие какой когда ли мне мой мы на над наш не него нее нет но о об он она они от по под при про с со так такой там то только у уже чем через что это эту я the a an and or in of for to is are with how what".split())


class Article(BaseModel):
    id: str = Field(pattern=r"^(?:D(?:0[1-9]|[12][0-9]|30)|[a-z0-9][a-z0-9-]{1,99})$")
    legacy_id: str | None = Field(default=None, pattern=r"^[a-z0-9][a-z0-9-]{1,99}$")
    title: str = Field(min_length=1, max_length=250)
    category: Literal["articles", "tips", "recipes"] = "articles"
    description: str = Field(min_length=1, max_length=2000)
    publisher: str = Field(min_length=1, max_length=200)
    url: str
    updated_at: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    content: str = Field(min_length=50, max_length=30000)
    keywords: list[str] = Field(default_factory=list, max_length=50)

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Corpus URL must be a public HTTPS source link")
        return value


def load_articles(path: Path = CORPUS_PATH) -> list[Article]:
    records = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(records, list) or not records:
        raise ValueError("Knowledge corpus must be a non-empty JSON array")
    articles = [Article.model_validate(record) for record in records]
    if len({a.id for a in articles}) != len(articles):
        raise ValueError("Knowledge corpus contains duplicate source ids")
    return articles


class Tokenizer:
    def __init__(self):
        self.ru = snowballstemmer.stemmer("russian")
        self.en = snowballstemmer.stemmer("english")

    def __call__(self, text: str) -> list[str]:
        text = unicodedata.normalize("NFKC", text).lower().replace("ё", "е")
        words = re.findall(r"[a-zа-я]+", text)
        # Instance is used synchronously on the event loop, never from concurrent threads.
        stems = [(self.ru if re.search("[а-я]", word) else self.en).stemWord(word)
                 for word in words if len(word) > 1 and word not in STOP_WORDS]
        # Snowball does not conflate the fleeting vowel in «белок / белком».
        return ["белк" if stem == "белок" else stem for stem in stems]


def chunk_text(text: str, max_words: int = 180) -> list[str]:
    """Group paragraphs while preserving verbatim substrings and bounded word count."""
    chunks = []
    current = ""
    for paragraph in re.split(r"\n\s*\n", text.strip()):
        paragraph = paragraph.strip()
        # Split oversized paragraphs at word boundaries without changing the original text.
        spans = list(re.finditer(r"\S+", paragraph))
        parts = [paragraph[spans[i].start():spans[min(i + max_words, len(spans)) - 1].end()]
                 for i in range(0, len(spans), max_words)]
        for part in parts:
            if current and len(current.split()) + len(part.split()) > max_words:
                chunks.append(current)
                current = ""
            current = f"{current}\n\n{part}" if current else part
    if current:
        chunks.append(current)
    return chunks


class BM25Index:
    def __init__(self, articles: list[Article], *, title_weight: float = 2.0):
        if not math.isfinite(title_weight) or title_weight < 0:
            raise ValueError("title_weight must be finite and non-negative")
        self.title_weight = title_weight
        self.articles = articles
        self.tokenize = Tokenizer()
        self.passages: list[dict] = []
        self.frequencies = []
        self.content_terms = []
        self.title_frequencies = []
        for article in articles:
            for index, text in enumerate(chunk_text(article.content)):
                self.passages.append(dict(source_id=article.id, chunk_id=f"{article.id}:{index + 1}",
                                          title=article.title, text=text, url=article.url))
                self.frequencies.append(Counter(self.tokenize(
                    article.title + " " + " ".join(article.keywords) + " " + text)))
                self.title_frequencies.append(Counter(self.tokenize(article.title)))
                self.content_terms.append(set(self.tokenize(article.title + " " + text)))
        self.document_frequency = Counter(term for terms in self.frequencies for term in terms)
        self.lengths = [sum(terms.values()) for terms in self.frequencies]
        self.average_length = sum(self.lengths) / max(len(self.lengths), 1) or 1
        self.title_lengths = [sum(terms.values()) for terms in self.title_frequencies]
        self.average_title_length = sum(self.title_lengths) / max(len(self.title_lengths), 1) or 1

    def search(self, question: str, limit: int = 4) -> list[dict]:
        query = set(self.tokenize(question))
        if not query or limit <= 0:
            return []
        ranked = []
        n = len(self.passages)
        for index, terms in enumerate(self.frequencies):
            if not query.intersection(self.content_terms[index]):
                continue
            score = 0.0
            for term in query:
                tf = terms[term]
                if not tf:
                    continue
                df = self.document_frequency[term]
                idf = math.log(1 + (n - df + 0.5) / (df + 0.5))
                score += idf * tf * 2.5 / (tf + 1.5 * (0.25 + 0.75 * self.lengths[index] / self.average_length))
                # A topic named in a title is more informative than a passing mention
                # in another article. Keep that signal from being swamped by generic
                # query terms such as time/portion words in the body.
                title_tf = self.title_frequencies[index][term]
                if title_tf:
                    score += self.title_weight * idf * title_tf * 2.5 / (
                        title_tf + 1.5 * (0.25 + 0.75 * self.title_lengths[index] / self.average_title_length)
                    )
            if score > 0:
                ranked.append((score, index))
        ranked.sort(key=lambda pair: (-pair[0], pair[1]))
        selected, counts = [], Counter()
        for score, index in ranked:
            passage = self.passages[index]
            if counts[passage["source_id"]] >= 2:
                continue
            counts[passage["source_id"]] += 1
            selected.append({**passage, "score": round(score, 6)})
            if len(selected) >= min(limit, 4):
                break
        return selected
