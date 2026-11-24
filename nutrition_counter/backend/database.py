"""SQLite database layer using aiosqlite."""

import aiosqlite
import os
from pathlib import Path

DB_PATH = os.environ.get("FAT_COUNTER_DB", str(Path(__file__).parent / "fat_counter.db"))


async def get_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db


async def init_db() -> None:
    """Create tables and seed initial data if they don't exist."""
    db = await get_db()
    try:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS profile (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                name TEXT NOT NULL DEFAULT 'Алексей',
                age INTEGER NOT NULL DEFAULT 28,
                height INTEGER NOT NULL DEFAULT 178,
                weight INTEGER NOT NULL DEFAULT 74,
                goal TEXT NOT NULL DEFAULT 'maintenance',
                calories INTEGER NOT NULL DEFAULT 2100,
                protein INTEGER NOT NULL DEFAULT 120,
                lactose INTEGER NOT NULL DEFAULT 1,
                gluten INTEGER NOT NULL DEFAULT 0,
                veg INTEGER NOT NULL DEFAULT 0,
                sugar INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS meals (
                id TEXT PRIMARY KEY,
                meal TEXT NOT NULL CHECK (meal IN ('breakfast','lunch','dinner','snack')),
                name TEXT NOT NULL,
                cals INTEGER NOT NULL DEFAULT 0,
                protein REAL NOT NULL DEFAULT 0,
                fat REAL NOT NULL DEFAULT 0,
                carbs REAL NOT NULL DEFAULT 0,
                weight INTEGER NOT NULL DEFAULT 150,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS sources (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                category TEXT NOT NULL CHECK (category IN ('articles','tips','recipes')),
                description TEXT NOT NULL,
                bookmarked INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS foods (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                cals INTEGER NOT NULL DEFAULT 0,
                protein REAL NOT NULL DEFAULT 0,
                fat REAL NOT NULL DEFAULT 0,
                carbs REAL NOT NULL DEFAULT 0,
                weight INTEGER NOT NULL DEFAULT 150
            );
        """)

        # Add provenance columns to existing databases without replacing user bookmarks.
        columns = {row["name"] for row in await db.execute_fetchall("PRAGMA table_info(sources)")}
        for column in ("url", "publisher", "content", "updated_at"):
            if column not in columns:
                await db.execute(f"ALTER TABLE sources ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")

        # Seed profile if empty
        row = await db.execute_fetchall("SELECT id FROM profile")
        if not row:
            await db.execute("INSERT INTO profile (id) VALUES (1)")

        # Seed sources if empty
        row = await db.execute_fetchall("SELECT id FROM sources")
        if not row:
            initial_sources = [
                ('protein', 'Источники белка в повседневном рационе', 'articles',
                 'Статья о разнообразии белковых продуктов: птице, рыбе, яйцах, бобовых и тофу. Разбор пищевой ценности и усвояемости.', 0),
                ('alternatives', 'Как выбирать альтернативы мясу', 'tips',
                 'Практический обзор замен привычных видов мяса с учётом вкуса, способа приготовления и баланса нутриентов.', 0),
                ('plate', 'Принцип сбалансированной тарелки', 'articles',
                 'Наглядный метод формирования приёма пищи: 50% овощей и зелени, 25% белка, 25% сложных углеводов.', 1),
                ('habits', 'Простые привычки в питании', 'tips',
                 'Советы по планированию заготовок, регулярному гидратированию и осознанному выбору продуктов на каждый день.', 0),
                ('snacks', 'Идеи для полезного перекуса', 'recipes',
                 'Быстрые и питательные сочетания с белком и клетчаткой для поддержания энергии между основными приёмами пищи.', 0),
            ]
            await db.executemany(
                "INSERT INTO sources (id, title, category, description, bookmarked) VALUES (?, ?, ?, ?, ?)",
                initial_sources,
            )

        # Seed foods if empty
        row = await db.execute_fetchall("SELECT id FROM foods")
        if not row:
            initial_foods = [
                ('f1', 'Овсяная каша с ягодами', 210, 6, 4, 36, 200),
                ('f2', 'Омлет со шпинатом (2 яйца)', 240, 16, 18, 2, 150),
                ('f3', 'Куриное филе на гриле', 165, 31, 3.5, 0, 150),
                ('f4', 'Гречка отварная с оливковым маслом', 180, 6, 5, 28, 180),
                ('f5', 'Лосось на пару с овощами', 290, 24, 18, 6, 220),
                ('f6', 'Творог 5% с миндалём и мёдом', 230, 18, 11, 14, 160),
                ('f7', 'Салат из свежих овощей', 90, 2, 5, 8, 150),
                ('f8', 'Яблоко зелёное', 80, 0.4, 0.2, 19, 150),
                ('f9', 'Греческий йогурт натуральный', 130, 10, 5, 6, 140),
                ('f10', 'Тост с авокадо и яйцом пашот', 280, 11, 16, 22, 140),
            ]
            await db.executemany(
                "INSERT INTO foods (id, name, cals, protein, fat, carbs, weight) VALUES (?, ?, ?, ?, ?, ?, ?)",
                initial_foods,
            )

        # Seed meals if empty
        row = await db.execute_fetchall("SELECT id FROM meals")
        if not row:
            initial_meals = [
                ('m1', 'breakfast', 'Омлет со шпинатом (2 яйца)', 240, 16, 18, 2, 150),
                ('m2', 'breakfast', 'Овсяная каша с ягодами', 210, 6, 4, 36, 200),
                ('m3', 'lunch', 'Куриное филе на гриле', 165, 31, 3.5, 0, 150),
                ('m4', 'lunch', 'Гречка отварная с оливковым маслом', 180, 6, 5, 28, 180),
            ]
            await db.executemany(
                "INSERT INTO meals (id, meal, name, cals, protein, fat, carbs, weight) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                initial_meals,
            )

        await db.commit()
    finally:
        await db.close()


async def sync_articles(articles) -> None:
    """Upsert reviewed corpus metadata; bookmarked state belongs to the user."""
    db = await get_db()
    try:
        await db.executemany(
            """INSERT INTO sources (id, title, category, description, url, publisher, content, updated_at, bookmarked)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT bookmarked FROM sources WHERE id = ?), 0))
               ON CONFLICT(id) DO UPDATE SET
                   title=excluded.title, category=excluded.category, description=excluded.description,
                   url=excluded.url, publisher=excluded.publisher, content=excluded.content,
                   updated_at=excluded.updated_at""",
            [(a.id, a.title, a.category, a.description, a.url, a.publisher, a.content, a.updated_at,
              a.legacy_id or "")
             for a in articles],
        )
        await db.commit()
    finally:
        await db.close()


async def get_diary_context() -> dict:
    """Explicit user-requested snapshot: recorded foods/totals/goals, no identity fields."""
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            "SELECT meal, name, cals, protein, fat, carbs, weight FROM meals ORDER BY created_at"
        )
        profiles = await db.execute_fetchall("SELECT calories, protein FROM profile WHERE id = 1")
        totals = {
            "calories": sum(row["cals"] for row in rows),
            **{nutrient: round(sum(row[nutrient] for row in rows), 2)
               for nutrient in ("protein", "fat", "carbs")},
        }
        targets = ({key: profiles[0][key] for key in ("calories", "protein") if profiles[0][key] > 0}
                   if profiles else {})
        # The schema has no date filter: do not present these as a full current day.
        return {
            "meals": [dict(row) for row in rows[-50:]],
            "record_count": len(rows),
            "record_unit": "записанные блюда, не отдельные приёмы пищи",
            "meal_groups_count": len({row["meal"] for row in rows}),
            "totals": totals,
            "targets": targets,
            "scope_note": "Итоги всех записанных блюд, не обязательно полного дня. "
                          "Показаны последние 50 записей, суммы рассчитаны по всем записям. "
                          "Цели заданы пользователем, не рассчитаны как медицинские нормы.",
        }
    finally:
        await db.close()

