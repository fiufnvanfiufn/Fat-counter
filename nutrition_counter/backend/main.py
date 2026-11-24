"""FastAPI application for the Fat-counter nutrition tracker."""

from __future__ import annotations

import re
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

from database import get_db, init_db
from schemas import (
    ChatRequest,
    ChatResponse,
    FoodRead,
    MealCreate,
    MealRead,
    ProfileRead,
    ProfileUpdate,
    SourceBookmarkUpdate,
    SourceRead,
)

# ── Mock responses (moved from frontend) ──

MOCK_RESPONSES = {
    "alternatives": {
        "intro": "В качестве замены свинине можно рассмотреть несколько отличных продуктов — выбор зависит от конкретного блюда и ваших целей:",
        "items": [
            "Птица (курица, индейка) — диетический источник белка с низким содержанием насыщенных жиров.",
            "Рыба и морепродукты — обогащают рацион Омега-3 жирными кислотами.",
            "Чечевица, фасоль и нут — растительные альтернативы с высоким содержанием клетчатки.",
        ],
        "end": "Попробуйте начать с замены в одном любимом блюде (например, приготовьте рагу с индейкой или нутом).",
        "sources": ["alternatives", "protein"],
    },
    "protein": {
        "intro": "Белок необходимо получать из разнообразных источников для полноценного набора аминокислот:",
        "items": [
            "Животные источники: филе индейки/курицы, нежирная рыба, творог 2-5%, яйца.",
            "Растительные источники: чечевица, маш, нут, тофу и цельнозерновые крупы.",
            "Орехи и семена — как дополнение к основным блюдам.",
        ],
        "end": "Оптимально распределять белок равномерно между 3–4 приёмами пищи в течение дня.",
        "sources": ["protein", "plate"],
    },
    "plate": {
        "intro": "Для сборки сбалансированного приёма пищи используйте проверенное правило гарвардской тарелки:",
        "items": [
            "1/2 тарелки: свежие или тушёные овощи, зелень, салатные листья.",
            "1/4 тарелки: нежирный белок (рыба, птица, бобовые, яйца).",
            "1/4 тарелки: сложные углеводы (гречка, бурый рис, киноа, цельнозерновые макароны).",
        ],
        "end": "Добавьте 1 чайную ложку полезного растительного масла (оливковое, льняное) для заправки.",
        "sources": ["plate", "habits"],
    },
    "snacks": {
        "intro": "Полезный перекус должен сочетать сложные углеводы или клетчатку с белком:",
        "items": [
            "Натуральный греческий йогурт + горсть свежих ягод.",
            "Яблоко или дольки груши + 15–20 г сырого миндаля.",
            "Цельнозерновой тост + паста из авокадо или хумус.",
        ],
        "end": "Такие сочетания обеспечивают долгую сытость без резких скачков сахара в крови.",
        "sources": ["snacks", "habits"],
    },
    "general": {
        "intro": "Спасибо за вопрос! Чтобы составить правильный рацион, придерживайтесь базовых ориентиров:",
        "items": [
            "Разнообразие: включайте продукты разных цветов и групп каждый день.",
            "Регулярность: питайтесь каждые 3.5–4.5 часа без длительного голодания.",
            "Гидратация: поддерживайте питьевой режим в течение дня.",
        ],
        "end": "Задайте более конкретный вопрос — например: «Какие продукты богаты белком?» или «Как собрать сбалансированный обед?».",
        "sources": ["plate", "habits"],
    },
}


def select_mock(question: str) -> dict:
    q = question.lower()
    if re.search(r"свинин|замен|альтернатив", q):
        return MOCK_RESPONSES["alternatives"]
    if re.search(r"бел[ко]|протеин", q):
        return MOCK_RESPONSES["protein"]
    if re.search(r"обед|сбаланс|тарелк", q):
        return MOCK_RESPONSES["plate"]
    if re.search(r"перекус", q):
        return MOCK_RESPONSES["snacks"]
    return MOCK_RESPONSES["general"]


# ── Application ──

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(
    title="Fat-counter API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Profile endpoints ──

@app.get("/api/profile", response_model=ProfileRead)
async def get_profile():
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM profile WHERE id = 1")
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(404, "Profile not found")
        return ProfileRead(
            name=row["name"], age=row["age"], height=row["height"],
            weight=row["weight"], goal=row["goal"], calories=row["calories"],
            protein=row["protein"], lactose=bool(row["lactose"]),
            gluten=bool(row["gluten"]), veg=bool(row["veg"]),
            sugar=bool(row["sugar"]),
        )
    finally:
        await db.close()


@app.put("/api/profile", response_model=ProfileRead)
async def update_profile(data: ProfileUpdate):
    db = await get_db()
    try:
        updates = data.model_dump(exclude_none=True)
        if not updates:
            raise HTTPException(400, "No fields to update")

        # Convert booleans to int for SQLite
        for key in ("lactose", "gluten", "veg", "sugar"):
            if key in updates:
                updates[key] = int(updates[key])

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values())
        await db.execute(f"UPDATE profile SET {set_clause} WHERE id = 1", values)
        await db.commit()

        return await get_profile()
    finally:
        await db.close()


# ── Meals endpoints ──

@app.get("/api/meals", response_model=list[MealRead])
async def list_meals():
    db = await get_db()
    try:
        cursor = await db.execute("SELECT id, meal, name, cals, protein, fat, carbs, weight FROM meals ORDER BY created_at")
        rows = await cursor.fetchall()
        return [
            MealRead(id=r["id"], meal=r["meal"], name=r["name"], cals=r["cals"],
                     protein=r["protein"], fat=r["fat"], carbs=r["carbs"], weight=r["weight"])
            for r in rows
        ]
    finally:
        await db.close()


@app.post("/api/meals", response_model=MealRead, status_code=201)
async def create_meal(data: MealCreate):
    db = await get_db()
    try:
        meal_id = f"m_{uuid.uuid4().hex[:12]}"
        await db.execute(
            "INSERT INTO meals (id, meal, name, cals, protein, fat, carbs, weight) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (meal_id, data.meal, data.name, data.cals, data.protein, data.fat, data.carbs, data.weight),
        )
        await db.commit()
        return MealRead(id=meal_id, meal=data.meal, name=data.name, cals=data.cals,
                        protein=data.protein, fat=data.fat, carbs=data.carbs, weight=data.weight)
    finally:
        await db.close()


@app.delete("/api/meals/{meal_id}", status_code=204)
async def delete_meal(meal_id: str):
    db = await get_db()
    try:
        cursor = await db.execute("DELETE FROM meals WHERE id = ?", (meal_id,))
        if cursor.rowcount == 0:
            raise HTTPException(404, "Meal not found")
        await db.commit()
    finally:
        await db.close()


@app.delete("/api/meals", status_code=204)
async def delete_all_meals():
    db = await get_db()
    try:
        await db.execute("DELETE FROM meals")
        await db.commit()
    finally:
        await db.close()


# ── Sources endpoints ──

@app.get("/api/sources", response_model=list[SourceRead])
async def list_sources():
    db = await get_db()
    try:
        cursor = await db.execute("SELECT id, title, category, description, bookmarked FROM sources")
        rows = await cursor.fetchall()
        return [
            SourceRead(id=r["id"], title=r["title"], category=r["category"],
                       description=r["description"], bookmarked=bool(r["bookmarked"]))
            for r in rows
        ]
    finally:
        await db.close()


@app.get("/api/sources/{source_id}", response_model=SourceRead)
async def get_source(source_id: str):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM sources WHERE id = ?", (source_id,))
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(404, "Source not found")
        return SourceRead(id=row["id"], title=row["title"], category=row["category"],
                          description=row["description"], bookmarked=bool(row["bookmarked"]))
    finally:
        await db.close()


@app.patch("/api/sources/{source_id}/bookmark", response_model=SourceRead)
async def toggle_source_bookmark(source_id: str, data: SourceBookmarkUpdate):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM sources WHERE id = ?", (source_id,))
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(404, "Source not found")
        await db.execute(
            "UPDATE sources SET bookmarked = ? WHERE id = ?",
            (int(data.bookmarked), source_id),
        )
        await db.commit()
        return SourceRead(id=row["id"], title=row["title"], category=row["category"],
                          description=row["description"], bookmarked=data.bookmarked)
    finally:
        await db.close()


# ── Foods endpoints ──

@app.get("/api/foods", response_model=list[FoodRead])
async def list_foods(q: str = Query(default="", max_length=200)):
    db = await get_db()
    try:
        if q.strip():
            cursor = await db.execute(
                "SELECT * FROM foods WHERE name LIKE ?",
                (f"%{q.strip()}%",),
            )
        else:
            cursor = await db.execute("SELECT * FROM foods")
        rows = await cursor.fetchall()
        return [
            FoodRead(id=r["id"], name=r["name"], cals=r["cals"], protein=r["protein"],
                     fat=r["fat"], carbs=r["carbs"], weight=r["weight"])
            for r in rows
        ]
    finally:
        await db.close()


# ── Chat endpoint (mock) ──

@app.post("/api/chat", response_model=ChatResponse)
async def chat(data: ChatRequest):
    mock = select_mock(data.question)
    return ChatResponse(**mock)


# ── Favicon (prevent 404 in browser logs) ──

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)


# ── Serve frontend static files ──

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")

