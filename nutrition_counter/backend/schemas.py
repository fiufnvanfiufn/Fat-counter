"""Pydantic schemas for the Fat-counter API."""

from __future__ import annotations
from pydantic import BaseModel, Field, StringConstraints
from typing import Annotated, Literal, Optional


# ── Profile ──

class ProfileRead(BaseModel):
    name: str
    age: int
    height: int
    weight: int
    goal: str
    calories: int
    protein: int
    lactose: bool
    gluten: bool
    veg: bool
    sugar: bool


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    age: Optional[int] = None
    height: Optional[int] = None
    weight: Optional[int] = None
    goal: Optional[str] = None
    calories: Optional[int] = None
    protein: Optional[int] = None
    lactose: Optional[bool] = None
    gluten: Optional[bool] = None
    veg: Optional[bool] = None
    sugar: Optional[bool] = None


# ── Meals ──

class MealCreate(BaseModel):
    meal: str = Field(..., pattern=r"^(breakfast|lunch|dinner|snack)$")
    name: str = Field(..., min_length=1, max_length=200)
    cals: int = Field(default=0, ge=0)
    protein: float = Field(default=0, ge=0)
    fat: float = Field(default=0, ge=0)
    carbs: float = Field(default=0, ge=0)
    weight: int = Field(default=150, ge=0)


class MealRead(BaseModel):
    id: str
    meal: str
    name: str
    cals: int
    protein: float
    fat: float
    carbs: float
    weight: int


# ── Sources ──

class SourceRead(BaseModel):
    id: str
    title: str
    category: str
    description: str
    bookmarked: bool
    url: str = ""
    publisher: str = ""
    content: str = ""
    updated_at: str = ""


class SourceBookmarkUpdate(BaseModel):
    bookmarked: bool


# ── Foods ──

class FoodRead(BaseModel):
    id: str
    name: str
    cals: int
    protein: float
    fat: float
    carbs: float
    weight: int


# ── Chat (BM25 + Gemini) ──

class ChatRequest(BaseModel):
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    scope: Literal["general", "diary"] = "general"


class DiarySummary(BaseModel):
    record_count: int
    totals: dict[str, float]
    targets: dict[str, float]
    scope_note: str


class PassageRead(BaseModel):
    source_id: str
    chunk_id: str
    title: str
    text: str
    url: str
    score: float


class ChatResponse(BaseModel):
    intro: str
    items: list[str]
    end: str
    sources: list[str]
    mode: Literal["gemini", "retrieval", "no_context"]
    model: Optional[str] = None
    warning: Optional[str] = None
    passages: list[PassageRead] = Field(default_factory=list)
    diary_summary: Optional[DiarySummary] = None
    diagnostic: Optional[dict] = None

