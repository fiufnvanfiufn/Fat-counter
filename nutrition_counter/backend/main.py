"""FastAPI application for the Fat-counter nutrition tracker."""

from __future__ import annotations

import asyncio
import uuid
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from fastapi.requests import Request

from config import load_settings
from database import get_db, init_db, sync_articles, get_diary_context
from llm import LLMError
from diagnostics import annotate
from rag import RagService
from retrieval import BM25Index, load_articles
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

# ── Application ──

@asynccontextmanager
async def lifespan(app: FastAPI):
    articles = load_articles()
    settings = load_settings()
    await init_db()
    await sync_articles(articles)
    app.state.rag = RagService(BM25Index(articles), settings)
    yield


app = FastAPI(
    title="Fat-counter API",
    version="1.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
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

@app.get("/api/knowledge", response_model=list[SourceRead])
async def knowledge_catalog(request: Request, q: str = Query(default="", max_length=200)):
    # Exactly the indexed documents, independent of bookmarks and legacy rows.
    article_ids = {article.id for article in request.app.state.rag.index.articles}
    sources = await list_sources(request)
    query = q.strip().casefold().replace("ё", "е")
    return [source for source in sorted(sources, key=lambda source: source.id)
            if source.id in article_ids and (not query or query in " ".join(
                (source.id, source.title, source.description, source.content)
            ).casefold().replace("ё", "е"))]

def source_from_row(row) -> SourceRead:
    return SourceRead(**{**dict(row), "bookmarked": bool(row["bookmarked"])})

@app.get("/api/sources", response_model=list[SourceRead])
async def list_sources(request: Request):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM sources")
        rows = await cursor.fetchall()
        migrated_ids = {article.legacy_id for article in request.app.state.rag.index.articles
                        if article.legacy_id}
        # Keep old rows addressable, but do not show duplicate canonical/legacy cards.
        return [source_from_row(row) for row in rows if row["id"] not in migrated_ids]
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
        return source_from_row(row)
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
        source = source_from_row(row)
        source.bookmarked = data.bookmarked
        return source
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


# ── Chat endpoints (BM25 + optional Gemini) ──

@app.get("/api/chat/status")
async def chat_status(request: Request):
    return request.app.state.rag.status()

@app.post("/api/chat", response_model=ChatResponse)
async def chat(data: ChatRequest, request: Request):
    # Only the explicit diary action reads personal records for the provider.
    if data.scope == "diary":
        diary_context = await get_diary_context()
        task = asyncio.create_task(request.app.state.rag.answer(data.question, diary_context=diary_context))
    else:
        task = asyncio.create_task(request.app.state.rag.answer(data.question))
    try:
        # Uvicorn does not cancel a normal handler automatically on disconnect.
        # Stop the provider call and release its slot when the browser resets chat.
        while not task.done():
            done, _ = await asyncio.wait({task}, timeout=0.2)
            if not done and await request.is_disconnected():
                return Response(status_code=499)
        answer = await task
        if data.scope == "general":
            answer.diagnostic = annotate(data.question, answer, request.app.state.rag.index)
        return answer
    except LLMError as error:
        raise HTTPException(
            error.status_code, detail={"code": error.code, "message": error.message},
            headers={"Retry-After": "10"} if error.status_code == 429 else None,
        ) from None
    finally:
        if not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


# ── Favicon (prevent 404 in browser logs) ──

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)


# ── Serve frontend static files ──

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")

