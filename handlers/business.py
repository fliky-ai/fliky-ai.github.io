
import time
import math
import random
import logging
from aiogram import Router, types, F
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

from database import db_conn, check_user_registered, get_user, DEFAULT_NICK, log_action

logger = logging.getLogger(__name__)
router = Router()

# ================== КАТАЛОГ БИЗНЕСОВ ==================
SHOPS_DATA = {
    "shop_1": {"name": "🥤 Мини-маркет",     "price": 25_000,    "income": 300,     "max_lvl": 10},
    "shop_2": {"name": "👕 Магазин одежды",  "price": 150_000,   "income": 2_000,   "max_lvl": 10},
    "shop_3": {"name": "📱 Магазин техники", "price": 750_000,   "income": 10_000,  "max_lvl": 10},
    "shop_4": {"name": "💎 Люкс-магазин",    "price": 5_000_000, "income": 50_000,  "max_lvl": 10},
    "shop_5": {"name": "🏢 Торговый центр",  "price": 25_000_000,"income": 250_000, "max_lvl": 10},
}

HIRE_COST = 15_000
STOCK_COST = {"drinks": 5_000, "food": 5_000, "tech": 10_000}
DESIGN_COST = {"neon": 10_000, "prem": 50_000}
DESIGN_NAME = {"neon": "🌟 Неоновый стиль", "prem": "💎 Премиум стиль"}
DESIGN_POP = {"neon": 10, "prem": 25}
QUEST_REWARD = 3_000
SELL_RATE = 0.7

EVENT_COOLDOWN_MIN = 600
EVENT_CHANCE = 40  # процентов


class ShopStates(StatesGroup):
    waiting_for_shop_name = State()

def _init_shop_db():
    try:
        with db_conn() as conn:
            cur = conn.cursor()

            cur.execute("""
                CREATE TABLE IF NOT EXISTS user_business (
                    user_id INTEGER PRIMARY KEY,
                    shop_type TEXT,
                    shop_name TEXT DEFAULT 'Мой магазин',
                    level INTEGER DEFAULT 1,
                    last_income_time INTEGER,
                    accumulated_up INTEGER DEFAULT 0,
                    employees_count INTEGER DEFAULT 0,
                    stock_drinks INTEGER DEFAULT 100,
                    stock_food INTEGER DEFAULT 100,
                    stock_tech INTEGER DEFAULT 100,
                    popularity INTEGER DEFAULT 100,
                    streak_days INTEGER DEFAULT 0,
                    last_bonus_date TEXT,
                    total_earned INTEGER DEFAULT 0,
                    total_sold INTEGER DEFAULT 0,
                    days_worked INTEGER DEFAULT 1,
                    design_style TEXT DEFAULT 'Обычный',
                    quest_claim INTEGER DEFAULT 0,
                    quest_upgrade INTEGER DEFAULT 0,
                    quest_hire INTEGER DEFAULT 0,
                    quest_rewarded TEXT,
                    event_text TEXT DEFAULT 'Пока нет событий',
                    event_end_time INTEGER DEFAULT 0,
                    last_event_time INTEGER DEFAULT 0
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS business_employees (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    emp_type TEXT,
                    level INTEGER DEFAULT 1,
                    salary INTEGER DEFAULT 500
                )
            """)

            # === МИГРАЦИЯ: добавляем недостающие колонки ===
            cur.execute("PRAGMA table_info(user_business)")
            cols = {c[1] for c in cur.fetchall()}

            required = {
                "shop_type": "TEXT",
                "shop_name": "TEXT DEFAULT 'Мой магазин'",
                "level": "INTEGER DEFAULT 1",
                "last_income_time": "INTEGER",
                "accumulated_up": "INTEGER DEFAULT 0",
                "employees_count": "INTEGER DEFAULT 0",
                "stock_drinks": "INTEGER DEFAULT 100",
                "stock_food": "INTEGER DEFAULT 100",
                "stock_tech": "INTEGER DEFAULT 100",
                "popularity": "INTEGER DEFAULT 100",
                "streak_days": "INTEGER DEFAULT 0",
                "last_bonus_date": "TEXT",
                "total_earned": "INTEGER DEFAULT 0",
                "total_sold": "INTEGER DEFAULT 0",
                "days_worked": "INTEGER DEFAULT 1",
                "design_style": "TEXT DEFAULT 'Обычный'",
                "quest_claim": "INTEGER DEFAULT 0",
                "quest_upgrade": "INTEGER DEFAULT 0",
                "quest_hire": "INTEGER DEFAULT 0",
                "quest_rewarded": "TEXT",
                "event_text": "TEXT DEFAULT 'Пока нет событий'",
                "event_end_time": "INTEGER DEFAULT 0",
                "last_event_time": "INTEGER DEFAULT 0",
            }

            for col, col_type in required.items():
                if col not in cols:
                    try:
                        cur.execute(f"ALTER TABLE user_business ADD COLUMN {col} {col_type}")
                        logger.info("user_business: добавлена колонка %s", col)
                    except Exception as e:
                        logger.exception("миграция user_business.%s: %s", col, e)

            # фикс: если shop_type NULL у старых бизнесов — поставим shop_1
            try:
                cur.execute("UPDATE user_business SET shop_type = 'shop_1' WHERE shop_type IS NULL OR shop_type = ''")
                cur.execute("UPDATE user_business SET shop_name = 'Мой магазин' WHERE shop_name IS NULL OR shop_name = ''")
                cur.execute("UPDATE user_business SET level = 1 WHERE level IS NULL OR level < 1")
                cur.execute("UPDATE user_business SET popularity = 100 WHERE popularity IS NULL")
                cur.execute("UPDATE user_business SET stock_drinks = 100 WHERE stock_drinks IS NULL")
                cur.execute("UPDATE user_business SET stock_food = 100 WHERE stock_food IS NULL")
                cur.execute("UPDATE user_business SET stock_tech = 100 WHERE stock_tech IS NULL")
                cur.execute("UPDATE user_business SET last_income_time = ? WHERE last_income_time IS NULL", (int(time.time()),))
                cur.execute("UPDATE user_business SET days_worked = 1 WHERE days_worked IS NULL")
                cur.execute("UPDATE user_business SET event_text = 'Пока нет событий' WHERE event_text IS NULL")
            except Exception as e:
                logger.exception("фикс данных user_business: %s", e)

            cur.execute("CREATE INDEX IF NOT EXISTS idx_be_user ON business_employees(user_id)")

        logger.info("business: таблицы готовы")
    except Exception as e:
        logger.exception("init_shop_db failed: %s", e)


_init_shop_db()


# ================== УТИЛИТЫ ==================
def _fmt(n) -> str:
    try:
        return f"{int(n):,}".replace(",", " ")
    except (TypeError, ValueError):
        return "0"


def _esc(s) -> str:
    return (str(s) if s is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _now() -> int:
    return int(time.time())


async def _require_reg(message: types.Message) -> bool:
    uid = message.from_user.id if message.from_user else None
    if not uid:
        return False
    if check_user_registered(uid):
        return True
    if message.chat.type == "private":
        try:
            await message.answer(
                "❌ <b>Вы еще не зарегистрированы!</b>\n\n"
                "💡 Перейдите в <b>личные сообщения</b> бота и нажмите /start.",
                parse_mode="HTML",
            )
        except Exception:
            pass
    return False


def _biz_log(user_id: int, user, action: str, **kwargs):
    try:
        log_action(
            user_id=user_id,
            username=getattr(user, "username", None),
            display_name=getattr(user, "full_name", None),
            action_type="BUSINESS",
            extra=action,
            **kwargs,
        )
    except Exception:
        pass


# ================== БИЗНЕС (CRUD) ==================
def get_user_business(user_id: int):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM user_business WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row:
                return None
            cols = [d[0] for d in cur.description]
            return dict(zip(cols, row))
    except Exception as e:
        logger.exception("get_user_business failed: %s", e)
        return None


def get_user_employees(user_id: int):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT emp_type, level, salary FROM business_employees WHERE user_id = ?", (user_id,))
            return cur.fetchall() or []
    except Exception as e:
        logger.exception("get_user_employees failed: %s", e)
        return []


def get_balance(user_id: int) -> int:
    try:
        u = get_user(user_id) or {}
        return int(u.get("balance_up") or 0)
    except Exception:
        return 0


# ================== ДОХОД ==================
def _calc_employees_bonus(user_id: int, base_income: int) -> float:
    """+20% к базовому доходу за каждого директора (с учётом его уровня)."""
    try:
        employees = get_user_employees(user_id)
        bonus = 0.0
        for emp in employees:
            try:
                emp_type, emp_lvl, _ = emp
                if emp_type == "director":
                    bonus += 0.2 * emp_lvl * base_income
            except Exception:
                continue
        return bonus
    except Exception:
        return 0.0


def calculate_accumulated(biz: dict) -> int:
    """Сколько накоплено с last_income_time (без записи)."""
    try:
        now = _now()
        last_time = int(biz.get("last_income_time") or now)
        hours_passed = max(0.0, (now - last_time) / 3600.0)
        accumulated = int(biz.get("accumulated_up") or 0)
        if hours_passed <= 0:
            return accumulated

        shop_info = SHOPS_DATA.get(biz.get("shop_type"), {"income": 300})
        base_income = shop_info["income"] * int(biz.get("level") or 1)
        emp_bonus = _calc_employees_bonus(biz["user_id"], base_income)

        avg_stock = (int(biz.get("stock_drinks") or 0) +
                     int(biz.get("stock_food") or 0) +
                     int(biz.get("stock_tech") or 0)) / 300.0
        pop_mult = max(0.1, min(1.0, int(biz.get("popularity") or 100) / 100.0))

        hourly = (base_income + emp_bonus) * avg_stock * pop_mult

        # событие "удачный день"
        if biz.get("event_end_time") and now < int(biz["event_end_time"]):
            if "удачный день" in str(biz.get("event_text") or "").lower():
                hourly *= 1.5

        earned = int(hourly * hours_passed)
        return accumulated + earned
    except Exception as e:
        logger.exception("calculate_accumulated failed: %s", e)
        return int(biz.get("accumulated_up") or 0)


def update_biz_state(user_id: int) -> None:
    """Атомарно фиксирует accumulated на текущий момент."""
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            cur.execute("SELECT * FROM user_business WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row:
                return
            cols = [d[0] for d in cur.description]
            biz = dict(zip(cols, row))

            new_acc = calculate_accumulated(biz)
            cur.execute(
                "UPDATE user_business SET accumulated_up = ?, last_income_time = ? WHERE user_id = ?",
                (new_acc, _now(), user_id)
            )
    except Exception as e:
        logger.exception("update_biz_state failed: %s", e)


# ================== СОБЫТИЯ ==================
def _apply_event(user_id: int, pop_delta: int = 0, stock_full: bool = False):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            if stock_full:
                cur.execute("""
                    UPDATE user_business SET stock_drinks = 100, stock_food = 100, stock_tech = 100
                    WHERE user_id = ?
                """, (user_id,))
            if pop_delta:
                cur.execute("""
                    UPDATE user_business
                    SET popularity = MAX(10, MIN(100, popularity + ?))
                    WHERE user_id = ?
                """, (pop_delta, user_id))
    except Exception as e:
        logger.exception("_apply_event failed: %s", e)


async def check_and_trigger_event(bot, user_id: int, biz: dict):
    """Может выкинуть случайное событие. Асинхронная — вызывается через create_task."""
    try:
        now = _now()
        last_event = int(biz.get("last_event_time") or 0)
        level = int(biz.get("level") or 1)
        cooldown = max(1800 - level * 60, EVENT_COOLDOWN_MIN)

        if now - last_event < cooldown:
            return
        if random.randint(1, 100) > EVENT_CHANCE:
            return

        events_pool = [
            {"title": "🔥 Удачный день!", "desc": "Клиентов больше обычного.\n📈 Доход +50% на 1 час.",
             "duration": 3600, "apply": None},
            {"title": "🚀 Реклама сработала!", "desc": "Популярность выросла.\n📈 +20% к популярности.",
             "duration": 0, "pop": 20},
            {"title": "📦 Большая поставка!", "desc": "Свежие товары бесплатно.\n📦 Склад пополнен.",
             "duration": 0, "stock_full": True},
            {"title": "⚠️ Мало клиентов!", "desc": "Конкуренты переманивают.\n📉 Популярность −10%.",
             "duration": 0, "pop": -10},
        ]

        ev = random.choice(events_pool)
        end_time = now + ev["duration"] if ev["duration"] > 0 else 0
        full_event_str = f"{ev['title']}"

        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE")
                cur.execute("""
                    UPDATE user_business
                    SET event_text = ?, event_end_time = ?, last_event_time = ?
                    WHERE user_id = ?
                """, (full_event_str, end_time, now, user_id))
        except Exception as e:
            logger.exception("event update failed: %s", e)
            return

        if ev.get("pop"):
            _apply_event(user_id, pop_delta=ev["pop"])
        if ev.get("stock_full"):
            _apply_event(user_id, stock_full=True)

        try:
            await bot.send_message(
                user_id,
                f"🎲 <b>Событие бизнеса</b>\n\n"
                f"🏪 {_esc(biz.get('shop_name') or 'Бизнес')}\n\n"
                f"{ev['title']}\n{ev['desc']}",
                parse_mode="HTML"
            )
        except Exception:
            pass
    except Exception as e:
        logger.exception("check_and_trigger_event failed: %s", e)
# ================== ГЛАВНОЕ МЕНЮ БИЗНЕСА ==================
@router.message(F.text.casefold().in_({"магазин", "бизнес", "🏪 магазин", "🏪 бизнес"}))
async def cmd_shop(message: types.Message):
    try:
        if not await _require_reg(message):
            return
        uid = message.from_user.id
        _biz_log(uid, message.from_user, "open_business")
        await _render_shop_menu(message, uid, message.bot)
    except Exception as e:
        logger.exception("cmd_shop failed: %s", e)


async def _render_shop_menu(target, user_id: int, bot, edit: bool = False):
    try:
        update_biz_state(user_id)
        biz = get_user_business(user_id)

        if not biz:
            text = (
                "🏪 <b>Бизнес</b>\n"
                "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
                "У вас пока нет своего бизнеса.\n"
                "Откройте первый магазин и начните зарабатывать."
            )
            kb = types.InlineKeyboardMarkup(
                inline_keyboard=[[types.InlineKeyboardButton(text="🔨 Открыть бизнес", callback_data="build_shop_menu")]]
            )
            await _send_or_edit(target, text, kb, edit)
            return

        # пробуем запустить событие в фоне (не ждём)
        try:
            import asyncio
            asyncio.create_task(check_and_trigger_event(bot, user_id, biz))
        except Exception:
            pass

        shop_info = SHOPS_DATA.get(biz["shop_type"], {"name": "🏪 Магазин", "income": 300, "max_lvl": 10})
        current_acc = calculate_accumulated(biz)
        max_emp = int(biz["level"]) * 2

        text = (
            f"🏪 <b>{_esc(biz['shop_name'])}</b> · {shop_info['name']}\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"🎨 Стиль: {_esc(biz['design_style'] or 'Обычный')}\n"
            f"⭐ Уровень: {biz['level']}/{shop_info['max_lvl']}\n"
            f"💎 Накоплено: <b>{_fmt(current_acc)} UP</b>\n"
            f"👥 Сотрудники: {biz['employees_count']}/{max_emp}\n"
            f"📈 Популярность: {biz['popularity']}%\n"
            f"🎲 Событие: {_esc(biz['event_text'] or 'Пока нет')}\n\n"
            f"📦 Склад:\n"
            f"  🥤 {biz['stock_drinks']}%   🍔 {biz['stock_food']}%   📱 {biz['stock_tech']}%"
        )

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="💰 Забрать доход", callback_data="shop_claim"),
                 types.InlineKeyboardButton(text="⬆️ Улучшить", callback_data="shop_upgrade_menu")],
                [types.InlineKeyboardButton(text="👥 Сотрудники", callback_data="shop_emp_menu"),
                 types.InlineKeyboardButton(text="📦 Склад", callback_data="shop_stock_menu")],
                [types.InlineKeyboardButton(text="🎨 Оформление", callback_data="shop_design_menu"),
                 types.InlineKeyboardButton(text="🎯 Задания", callback_data="shop_quests_menu")],
                [types.InlineKeyboardButton(text="📊 Статистика", callback_data="shop_stats"),
                 types.InlineKeyboardButton(text="🏷 Продать", callback_data="shop_sell_confirm_menu")],
            ]
        )
        await _send_or_edit(target, text, kb, edit)
    except Exception as e:
        logger.exception("_render_shop_menu failed: %s", e)


async def _send_or_edit(target, text: str, kb, edit: bool = False):
    """target — Message или CallbackQuery. edit — редактировать текущее сообщение."""
    try:
        if isinstance(target, types.CallbackQuery):
            try:
                await target.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
                return
            except Exception:
                try:
                    await target.message.answer(text, parse_mode="HTML", reply_markup=kb)
                    return
                except Exception:
                    pass
        await target.answer(text, parse_mode="HTML", reply_markup=kb)
    except Exception as e:
        logger.exception("_send_or_edit failed: %s", e)


@router.callback_query(F.data == "shop_main_back")
async def cb_main_back(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        await _render_shop_menu(callback, uid, callback.bot, edit=True)
    except Exception as e:
        logger.exception("cb_main_back failed: %s", e)


# ================== СОЗДАНИЕ БИЗНЕСА ==================
@router.callback_query(F.data == "build_shop_menu")
async def cb_build_menu(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        if get_user_business(uid):
            try:
                await callback.answer("У вас уже есть бизнес", show_alert=True)
            except Exception:
                pass
            await _render_shop_menu(callback, uid, callback.bot, edit=True)
            return

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="🥤 Мини-маркет · 25к", callback_data="buy_view_shop_1")],
                [types.InlineKeyboardButton(text="👕 Одежда · 150к", callback_data="buy_view_shop_2")],
                [types.InlineKeyboardButton(text="📱 Техника · 750к", callback_data="buy_view_shop_3")],
                [types.InlineKeyboardButton(text="💎 Люкс · 5 млн", callback_data="buy_view_shop_4")],
                [types.InlineKeyboardButton(text="🏢 ТЦ · 25 млн", callback_data="buy_view_shop_5")],
                [types.InlineKeyboardButton(text="◀️ Назад", callback_data="shop_main_back")],
            ]
        )
        text = "🏪 <b>Открытие бизнеса</b>\n\nВыберите тип магазина:"
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            try:
                await callback.message.answer(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                pass
    except Exception as e:
        logger.exception("cb_build_menu failed: %s", e)


@router.callback_query(F.data.startswith("buy_view_shop_"))
async def cb_view_shop(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        if get_user_business(uid):
            try:
                await callback.answer("У вас уже есть бизнес", show_alert=True)
            except Exception:
                pass
            return

        shop_key = "shop_" + (callback.data or "").split("_")[-1]
        info = SHOPS_DATA.get(shop_key)
        if not info:
            return

        balance = get_balance(uid)
        text = (
            f"🏪 <b>Открытие бизнеса</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"{info['name']}\n\n"
            f"💰 Цена: <b>{_fmt(info['price'])} UP</b>\n"
            f"📈 Доход: +{_fmt(info['income'])} UP/час\n"
            f"⭐ Макс. уровень: {info['max_lvl']}\n\n"
            f"💵 Ваш баланс: <b>{_fmt(balance)} UP</b>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="✅ Купить", callback_data=f"buy_confirm_{shop_key}")],
                [types.InlineKeyboardButton(text="◀️ Назад", callback_data="build_shop_menu")],
            ]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_view_shop failed: %s", e)


@router.callback_query(F.data.startswith("buy_confirm_"))
async def cb_buy_confirm(callback: types.CallbackQuery, state: FSMContext):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        if get_user_business(uid):
            try:
                await callback.answer("У вас уже есть бизнес", show_alert=True)
            except Exception:
                pass
            await _render_shop_menu(callback, uid, callback.bot, edit=True)
            return

        shop_key = (callback.data or "").replace("buy_confirm_", "")
        info = SHOPS_DATA.get(shop_key)
        if not info:
            return

        balance = get_balance(uid)
        if balance < info["price"]:
            try:
                await callback.answer(f"Недостаточно UP. Нужно {_fmt(info['price'])}", show_alert=True)
            except Exception:
                pass
            return

        # только в ЛС — название
        try:
            chat_type = callback.message.chat.type
        except Exception:
            chat_type = None
        if chat_type != "private":
            try:
                await callback.answer("Название бизнеса задаётся в ЛС бота", show_alert=True)
            except Exception:
                pass
            return

        await state.update_data(pending_shop=shop_key, shop_price=info["price"])
        await state.set_state(ShopStates.waiting_for_shop_name)

        text = (
            "✏️ <b>Название бизнеса</b>\n\n"
            "Введите название (до 30 символов):"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="❌ Отмена", callback_data="build_shop_menu")]]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_buy_confirm failed: %s", e)


@router.message(ShopStates.waiting_for_shop_name)
async def process_shop_name(message: types.Message, state: FSMContext):
    try:
        if not await _require_reg(message):
            await state.clear()
            return

        uid = message.from_user.id
        raw = (message.text or "").strip()

        if not raw:
            await message.answer("⚠️ Введите название.")
            return
        if len(raw) > 30:
            await message.answer("⚠️ Название: до 30 символов.")
            return
        # санитайз: убираем < > & из имени
        if any(c in raw for c in "<>&"):
            await message.answer("⚠️ Название не должно содержать символы &lt; &gt; &amp;.")
            return

        data = await state.get_data()
        shop_key = data.get("pending_shop")
        price = data.get("shop_price")

        info = SHOPS_DATA.get(shop_key)
        if not info or not price:
            await state.clear()
            await message.answer("⚠️ Ошибка покупки. Попробуйте заново.")
            return

        # атомарно: проверка баланса → списание → создание бизнеса
        success = False
        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE")

                # защита от дублей
                cur.execute("SELECT 1 FROM user_business WHERE user_id = ?", (uid,))
                if cur.fetchone():
                    await state.clear()
                    await message.answer("⚠️ У вас уже есть бизнес.")
                    return

                cur.execute("SELECT balance_up FROM users WHERE user_id = ?", (uid,))
                row = cur.fetchone()
                if not row:
                    await state.clear()
                    await message.answer("⚠️ Профиль не найден.")
                    return
                balance = int(row[0] or 0)
                if balance < price:
                    await state.clear()
                    await message.answer("⚠️ Недостаточно UP.")
                    return

                cur.execute("UPDATE users SET balance_up = ? WHERE user_id = ?", (balance - price, uid))
                cur.execute("""
                    INSERT INTO user_business
                    (user_id, shop_type, shop_name, level, last_income_time, accumulated_up,
                     employees_count, stock_drinks, stock_food, stock_tech, popularity,
                     total_earned, days_worked, event_text)
                    VALUES (?, ?, ?, 1, ?, 0, 0, 100, 100, 100, 100, 0, 1, 'Пока нет событий')
                """, (uid, shop_key, raw, _now()))
                success = True
        except Exception as e:
            logger.exception("business create failed: %s", e)
            await state.clear()
            await message.answer("⚠️ Ошибка. Попробуйте позже.")
            return

        await state.clear()

        if not success:
            return

        _biz_log(uid, message.from_user, "create_business",
                 balance_before=balance, balance_after=balance - price,
                 extra_detail=f"shop={shop_key} name={raw} price={price}")

        await message.answer(
            f"🎉 <b>Бизнес открыт</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"🏪 <b>{_esc(raw)}</b>\n"
            f"💰 Списано: <b>{_fmt(price)} UP</b>\n"
            f"💵 Баланс: <b>{_fmt(balance - price)} UP</b>",
            parse_mode="HTML",
        )
        await _render_shop_menu(message, uid, message.bot)
    except Exception as e:
        logger.exception("process_shop_name failed: %s", e)
        try:
            await state.clear()
        except Exception:
            pass


# ================== ЗАБРАТЬ ДОХОД ==================
@router.callback_query(F.data == "shop_claim")
async def cb_shop_claim(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        # сначала обновляем accumulated, потом атомарно списываем и начисляем
        update_biz_state(uid)

        claimed = 0
        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE")
                cur.execute("SELECT accumulated_up FROM user_business WHERE user_id = ?", (uid,))
                row = cur.fetchone()
                if not row or (row[0] or 0) <= 0:
                    try:
                        await callback.answer("Доход ещё не накопился", show_alert=True)
                    except Exception:
                        pass
                    return
                claimed = int(row[0])

                cur.execute("""
                    UPDATE user_business
                    SET accumulated_up = 0, total_earned = total_earned + ?, quest_claim = 1
                    WHERE user_id = ?
                """, (claimed, uid))
                cur.execute("UPDATE users SET balance_up = balance_up + ? WHERE user_id = ?", (claimed, uid))
        except Exception as e:
            logger.exception("claim failed: %s", e)
            try:
                await callback.answer("⚠️ Ошибка. Попробуйте позже", show_alert=True)
            except Exception:
                pass
            return

        _biz_log(uid, callback.from_user, "claim_income", extra_detail=f"amount={claimed}")

        try:
            await callback.answer(f"Получено +{_fmt(claimed)} UP", show_alert=True)
        except Exception:
            pass

        await _render_shop_menu(callback, uid, callback.bot, edit=True)
    except Exception as e:
        logger.exception("cb_shop_claim failed: %s", e)


# ================== УЛУЧШЕНИЕ ==================
@router.callback_query(F.data == "shop_upgrade_menu")
async def cb_shop_upgrade_menu(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        update_biz_state(uid)
        biz = get_user_business(uid)
        if not biz:
            return

        shop_info = SHOPS_DATA.get(biz["shop_type"])
        if not shop_info:
            return

        if biz["level"] >= shop_info["max_lvl"]:
            try:
                await callback.answer("Максимальный уровень уже достигнут", show_alert=True)
            except Exception:
                pass
            return

        upgrade_price = int(shop_info["price"] * (1.5 ** (int(biz["level"]) - 1)))
        new_lvl = int(biz["level"]) + 1
        current_income = int(shop_info["income"] * int(biz["level"]))
        next_income = int(shop_info["income"] * new_lvl)
        balance = get_balance(uid)

        text = (
            "⬆️ <b>Улучшение бизнеса</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"🏪 {_esc(biz['shop_name'])}\n\n"
            f"⭐ Сейчас: {biz['level']}/{shop_info['max_lvl']}\n"
            f"📈 Доход: +{_fmt(current_income)} UP/ч\n\n"
            f"🔓 После: <b>{new_lvl}</b>\n"
            f"📈 Доход: +{_fmt(next_income)} UP/ч\n\n"
            f"💰 Стоимость: <b>{_fmt(upgrade_price)} UP</b>\n"
            f"💵 Баланс: <b>{_fmt(balance)} UP</b>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text=f"✅ Улучшить", callback_data="shop_upgrade_confirm")],
                [types.InlineKeyboardButton(text="◀️ Назад", callback_data="shop_main_back")],
            ]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_shop_upgrade_menu failed: %s", e)


@router.callback_query(F.data == "shop_upgrade_confirm")
async def cb_shop_upgrade_confirm(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        update_biz_state(uid)

        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE")

                cur.execute("SELECT * FROM user_business WHERE user_id = ?", (uid,))
                row = cur.fetchone()
                if not row:
                    return
                cols = [d[0] for d in cur.description]
                biz = dict(zip(cols, row))

                shop_info = SHOPS_DATA.get(biz["shop_type"])
                if not shop_info:
                    return
                if biz["level"] >= shop_info["max_lvl"]:
                    try:
                        await callback.answer("Максимальный уровень", show_alert=True)
                    except Exception:
                        pass
                    return

                upgrade_price = int(shop_info["price"] * (1.5 ** (int(biz["level"]) - 1)))

                cur.execute("SELECT balance_up FROM users WHERE user_id = ?", (uid,))
                brow = cur.fetchone()
                if not brow:
                    return
                balance = int(brow[0] or 0)
                if balance < upgrade_price:
                    try:
                        await callback.answer("Недостаточно UP", show_alert=True)
                    except Exception:
                        pass
                    return

                new_lvl = int(biz["level"]) + 1
                cur.execute("UPDATE users SET balance_up = ? WHERE user_id = ?", (balance - upgrade_price, uid))
                cur.execute("""
                    UPDATE user_business
                    SET level = level + 1,
                        popularity = MIN(100, popularity + 5),
                        quest_upgrade = 1
                    WHERE user_id = ?
                """, (uid,))
        except Exception as e:
            logger.exception("upgrade failed: %s", e)
            try:
                await callback.answer("⚠️ Ошибка. Попробуйте позже", show_alert=True)
            except Exception:
                pass
            return

        _biz_log(uid, callback.from_user, "upgrade_business",
                 balance_before=balance, balance_after=balance - upgrade_price,
                 extra_detail=f"level={new_lvl} price={upgrade_price}")

        new_income = int(shop_info["income"] * new_lvl)
        try:
            await callback.answer("Бизнес улучшен", show_alert=True)
        except Exception:
            pass

        text = (
            "🎉 <b>Бизнес улучшен</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"🏪 {_esc(biz['shop_name'])}\n"
            f"⭐ Уровень: <b>{new_lvl}</b>\n"
            f"📈 Доход: +{_fmt(new_income)} UP/ч"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="🏪 В меню", callback_data="shop_main_back")]]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_shop_upgrade_confirm failed: %s", e)


# ================== ПРОДАЖА ==================
@router.callback_query(F.data == "shop_sell_confirm_menu")
async def cb_sell_confirm_menu(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        update_biz_state(uid)
        biz = get_user_business(uid)
        if not biz:
            return

        shop_info = SHOPS_DATA.get(biz["shop_type"], {"price": 0})
        sell_price = int(shop_info["price"] * SELL_RATE)
        accumulated = int(biz.get("accumulated_up") or 0)
        total = sell_price + accumulated

        text = (
            "🏷 <b>Продажа бизнеса</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"🏪 {_esc(biz['shop_name'])}\n"
            f"⭐ Уровень: {biz['level']}\n\n"
            f"💰 За бизнес: <b>{_fmt(sell_price)} UP</b>\n"
            f"💎 Накоплено: <b>{_fmt(accumulated)} UP</b>\n"
            f"📊 Итого: <b>{_fmt(total)} UP</b>\n\n"
            "⚠️ Магазин, сотрудники и улучшения будут удалены."
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="✅ Продать", callback_data="shop_sell_final")],
                [types.InlineKeyboardButton(text="❌ Отмена", callback_data="shop_main_back")],
            ]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_sell_confirm_menu failed: %s", e)


@router.callback_query(F.data == "shop_sell_final")
async def cb_sell_final(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        update_biz_state(uid)

        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE")

                cur.execute("SELECT * FROM user_business WHERE user_id = ?", (uid,))
                row = cur.fetchone()
                if not row:
                    return
                cols = [d[0] for d in cur.description]
                biz = dict(zip(cols, row))

                shop_info = SHOPS_DATA.get(biz["shop_type"], {"price": 0})
                sell_price = int(shop_info["price"] * SELL_RATE)
                accumulated = int(biz.get("accumulated_up") or 0)
                total_payout = sell_price + accumulated

                cur.execute("UPDATE users SET balance_up = balance_up + ? WHERE user_id = ?", (total_payout, uid))
                cur.execute("DELETE FROM user_business WHERE user_id = ?", (uid,))
                cur.execute("DELETE FROM business_employees WHERE user_id = ?", (uid,))
        except Exception as e:
            logger.exception("sell failed: %s", e)
            try:
                await callback.answer("⚠️ Ошибка. Попробуйте позже", show_alert=True)
            except Exception:
                pass
            return

        _biz_log(uid, callback.from_user, "sell_business",
                 extra_detail=f"payout={total_payout} shop={biz['shop_name']}")

        new_bal = get_balance(uid)
        text = (
            "🏷 <b>Бизнес продан</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"💰 Получено: <b>+{_fmt(total_payout)} UP</b>\n"
            f"💵 Баланс: <b>{_fmt(new_bal)} UP</b>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="🏪 Открыть новый", callback_data="build_shop_menu")]]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
        try:
            await callback.answer("Бизнес продан", show_alert=True)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_sell_final failed: %s", e)
# ================== СОТРУДНИКИ ==================
@router.callback_query(F.data == "shop_emp_menu")
async def cb_shop_emp_menu(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        biz = get_user_business(uid)
        if not biz:
            await _render_shop_menu(callback, uid, callback.bot, edit=True)
            return

        max_emp = int(biz["level"]) * 2
        employees = get_user_employees(uid)

        if employees:
            emp_lines = []
            for emp in employees:
                try:
                    emp_type, emp_lvl, salary = emp
                    label = "Директор" if emp_type == "director" else "Менеджер"
                    emp_lines.append(f"• {label} · ур. {emp_lvl} · {_fmt(salary)} UP/ч")
                except Exception:
                    continue
            emp_text = "\n".join(emp_lines) if emp_lines else "Сотрудников пока нет."
        else:
            emp_text = "Сотрудников пока нет."

        text = (
            "👥 <b>Сотрудники</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"Занято мест: <b>{biz['employees_count']}/{max_emp}</b>\n\n"
            f"{emp_text}"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="➕ Нанять", callback_data="hire_select_type")],
                [types.InlineKeyboardButton(text="◀️ Назад", callback_data="shop_main_back")],
            ]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_shop_emp_menu failed: %s", e)


@router.callback_query(F.data == "hire_select_type")
async def cb_hire_select_type(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        text = (
            "👥 <b>Найм сотрудника</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"💰 Стоимость найма: <b>{_fmt(HIRE_COST)} UP</b>\n\n"
            "Выберите тип:"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="👨‍💼 Директор · +20% дохода", callback_data="hire_preview_director")],
                [types.InlineKeyboardButton(text="🧑‍💼 Менеджер · +популярность", callback_data="hire_preview_manager")],
                [types.InlineKeyboardButton(text="◀️ Назад", callback_data="shop_emp_menu")],
            ]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_hire_select_type failed: %s", e)


@router.callback_query(F.data.startswith("hire_preview_"))
async def cb_hire_preview(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        biz = get_user_business(uid)
        if not biz:
            return

        emp_type = (callback.data or "").replace("hire_preview_", "")
        if emp_type not in ("director", "manager"):
            return

        max_emp = int(biz["level"]) * 2
        bonus = "+20% к доходу" if emp_type == "director" else "+5% к популярности"
        label = "👨‍💼 Директор" if emp_type == "director" else "🧑‍💼 Менеджер"

        text = (
            "👤 <b>Найм сотрудника</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"{label}\n"
            f"💼 Мест: <b>{biz['employees_count']}/{max_emp}</b>\n"
            f"💰 Стоимость: <b>{_fmt(HIRE_COST)} UP</b>\n\n"
            f"📈 Бонус: {bonus}"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="✅ Нанять", callback_data=f"hire_exec_{emp_type}")],
                [types.InlineKeyboardButton(text="❌ Отмена", callback_data="shop_emp_menu")],
            ]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_hire_preview failed: %s", e)


@router.callback_query(F.data.startswith("hire_exec_"))
async def cb_hire_exec(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        emp_type = (callback.data or "").replace("hire_exec_", "")
        if emp_type not in ("director", "manager"):
            return

        update_biz_state(uid)

        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE")

                cur.execute("SELECT level, employees_count FROM user_business WHERE user_id = ?", (uid,))
                row = cur.fetchone()
                if not row:
                    return
                level = int(row[0] or 1)
                emp_count = int(row[1] or 0)
                max_emp = level * 2
                if emp_count >= max_emp:
                    try:
                        await callback.answer("Достигнут лимит сотрудников", show_alert=True)
                    except Exception:
                        pass
                    return

                cur.execute("SELECT balance_up FROM users WHERE user_id = ?", (uid,))
                brow = cur.fetchone()
                if not brow:
                    return
                balance = int(brow[0] or 0)
                if balance < HIRE_COST:
                    try:
                        await callback.answer("Недостаточно UP", show_alert=True)
                    except Exception:
                        pass
                    return

                cur.execute("UPDATE users SET balance_up = ? WHERE user_id = ?", (balance - HIRE_COST, uid))
                cur.execute("""
                    INSERT INTO business_employees (user_id, emp_type, level, salary)
                    VALUES (?, ?, 1, 500)
                """, (uid, emp_type))

                # бонусы от сотрудника
                if emp_type == "manager":
                    cur.execute("""
                        UPDATE user_business
                        SET employees_count = employees_count + 1,
                            popularity = MIN(100, popularity + 5),
                            quest_hire = 1
                        WHERE user_id = ?
                    """, (uid,))
                else:
                    cur.execute("""
                        UPDATE user_business
                        SET employees_count = employees_count + 1,
                            quest_hire = 1
                        WHERE user_id = ?
                    """, (uid,))
        except Exception as e:
            logger.exception("hire failed: %s", e)
            try:
                await callback.answer("⚠️ Ошибка. Попробуйте позже", show_alert=True)
            except Exception:
                pass
            return

        _biz_log(uid, callback.from_user, "hire_employee",
                 balance_before=balance, balance_after=balance - HIRE_COST,
                 extra_detail=f"type={emp_type} cost={HIRE_COST}")

        try:
            await callback.answer("Сотрудник нанят", show_alert=True)
        except Exception:
            pass

        await cb_shop_emp_menu(callback)
    except Exception as e:
        logger.exception("cb_hire_exec failed: %s", e)


# ================== СКЛАД ==================
@router.callback_query(F.data == "shop_stock_menu")
async def cb_shop_stock_menu(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        biz = get_user_business(uid)
        if not biz:
            await _render_shop_menu(callback, uid, callback.bot, edit=True)
            return

        text = (
            "📦 <b>Склад и товары</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"🥤 Напитки: <b>{biz['stock_drinks']}%</b>\n"
            f"🍔 Еда: <b>{biz['stock_food']}%</b>\n"
            f"📱 Техника: <b>{biz['stock_tech']}%</b>\n\n"
            "⚠️ Ниже 50% — доход уменьшается."
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="🥤 Напитки · 5к", callback_data="stock_preview_drinks")],
                [types.InlineKeyboardButton(text="🍔 Еда · 5к", callback_data="stock_preview_food")],
                [types.InlineKeyboardButton(text="📱 Техника · 10к", callback_data="stock_preview_tech")],
                [types.InlineKeyboardButton(text="◀️ Назад", callback_data="shop_main_back")],
            ]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_shop_stock_menu failed: %s", e)


@router.callback_query(F.data.startswith("stock_preview_"))
async def cb_stock_preview(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        stype = (callback.data or "").replace("stock_preview_", "")
        if stype not in STOCK_COST:
            return

        cost = STOCK_COST[stype]
        label = {"drinks": "🥤 Напитки", "food": "🍔 Еда", "tech": "📱 Техника"}[stype]

        text = (
            "📦 <b>Поставка</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"{label} — до 100%\n"
            f"💰 Стоимость: <b>{_fmt(cost)} UP</b>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="✅ Закупить", callback_data=f"stock_exec_{stype}")],
                [types.InlineKeyboardButton(text="❌ Отмена", callback_data="shop_stock_menu")],
            ]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_stock_preview failed: %s", e)


@router.callback_query(F.data.startswith("stock_exec_"))
async def cb_stock_exec(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        stype = (callback.data or "").replace("stock_exec_", "")
        if stype not in STOCK_COST:
            return
        cost = STOCK_COST[stype]
        col = f"stock_{stype}"

        update_biz_state(uid)

        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE")

                cur.execute("SELECT balance_up FROM users WHERE user_id = ?", (uid,))
                brow = cur.fetchone()
                if not brow:
                    return
                balance = int(brow[0] or 0)
                if balance < cost:
                    try:
                        await callback.answer("Недостаточно UP", show_alert=True)
                    except Exception:
                        pass
                    return

                cur.execute("UPDATE users SET balance_up = ? WHERE user_id = ?", (balance - cost, uid))
                cur.execute(f"UPDATE user_business SET {col} = 100 WHERE user_id = ?", (uid,))
        except Exception as e:
            logger.exception("stock exec failed: %s", e)
            try:
                await callback.answer("⚠️ Ошибка. Попробуйте позже", show_alert=True)
            except Exception:
                pass
            return

        _biz_log(uid, callback.from_user, f"stock_{stype}",
                 balance_before=balance, balance_after=balance - cost,
                 extra_detail=f"cost={cost}")

        try:
            await callback.answer("Поставка закуплена", show_alert=True)
        except Exception:
            pass

        await cb_shop_stock_menu(callback)
    except Exception as e:
        logger.exception("cb_stock_exec failed: %s", e)


# ================== ДИЗАЙН ==================
@router.callback_query(F.data == "shop_design_menu")
async def cb_shop_design(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        biz = get_user_business(uid)
        if not biz:
            await _render_shop_menu(callback, uid, callback.bot, edit=True)
            return

        text = (
            "🎨 <b>Оформление</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"Сейчас: <b>{_esc(biz['design_style'] or 'Обычный')}</b>\n\n"
            "Выберите стиль:"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="🌟 Неон · 10к · +10%", callback_data="buy_design_neon")],
                [types.InlineKeyboardButton(text="💎 Премиум · 50к · +25%", callback_data="buy_design_prem")],
                [types.InlineKeyboardButton(text="◀️ Назад", callback_data="shop_main_back")],
            ]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_shop_design failed: %s", e)


@router.callback_query(F.data.startswith("buy_design_"))
async def cb_buy_design(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        d_type = (callback.data or "").replace("buy_design_", "")
        if d_type not in DESIGN_COST:
            return
        cost = DESIGN_COST[d_type]
        name = DESIGN_NAME[d_type]
        pop = DESIGN_POP[d_type]

        update_biz_state(uid)

        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE")

                cur.execute("SELECT balance_up FROM users WHERE user_id = ?", (uid,))
                brow = cur.fetchone()
                if not brow:
                    return
                balance = int(brow[0] or 0)
                if balance < cost:
                    try:
                        await callback.answer(f"Нужно {_fmt(cost)} UP", show_alert=True)
                    except Exception:
                        pass
                    return

                cur.execute("UPDATE users SET balance_up = ? WHERE user_id = ?", (balance - cost, uid))
                cur.execute("""
                    UPDATE user_business
                    SET design_style = ?, popularity = MIN(100, popularity + ?)
                    WHERE user_id = ?
                """, (name, pop, uid))
        except Exception as e:
            logger.exception("design failed: %s", e)
            try:
                await callback.answer("⚠️ Ошибка. Попробуйте позже", show_alert=True)
            except Exception:
                pass
            return

        _biz_log(uid, callback.from_user, f"design_{d_type}",
                 balance_before=balance, balance_after=balance - cost,
                 extra_detail=f"style={name} cost={cost}")

        try:
            await callback.answer(f"Стиль: {name}", show_alert=True)
        except Exception:
            pass

        await _render_shop_menu(callback, uid, callback.bot, edit=True)
    except Exception as e:
        logger.exception("cb_buy_design failed: %s", e)


# ================== ЗАДАНИЯ ==================
@router.callback_query(F.data == "shop_quests_menu")
async def cb_shop_quests(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        biz = get_user_business(uid)
        if not biz:
            await _render_shop_menu(callback, uid, callback.bot, edit=True)
            return

        today = time.strftime("%Y-%m-%d")
        rewarded = (biz.get("quest_rewarded") == today)

        c1 = "✅" if biz["quest_claim"] else "⬜"
        c2 = "✅" if biz["quest_upgrade"] else "⬜"
        c3 = "✅" if biz["quest_hire"] else "⬜"

        text = (
            "🎯 <b>Задания дня</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"{c1} Забрать доход\n"
            f"{c2} Улучшить бизнес\n"
            f"{c3} Нанять сотрудника\n\n"
            f"🎁 Награда: <b>{_fmt(QUEST_REWARD)} UP</b>"
        )
        if rewarded:
            text += "\n\n✅ Награда уже получена сегодня"

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="🎁 Забрать награду", callback_data="shop_claim_quest")],
                [types.InlineKeyboardButton(text="◀️ Назад", callback_data="shop_main_back")],
            ]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_shop_quests failed: %s", e)


@router.callback_query(F.data == "shop_claim_quest")
async def cb_claim_quest(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        today = time.strftime("%Y-%m-%d")

        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE")

                cur.execute("""
                    SELECT quest_claim, quest_upgrade, quest_hire, quest_rewarded
                    FROM user_business WHERE user_id = ?
                """, (uid,))
                row = cur.fetchone()
                if not row:
                    return
                q1, q2, q3, rewarded = row
                if rewarded == today:
                    try:
                        await callback.answer("Уже получено сегодня", show_alert=True)
                    except Exception:
                        pass
                    return
                if not (q1 and q2 and q3):
                    try:
                        await callback.answer("Выполнены не все задания", show_alert=True)
                    except Exception:
                        pass
                    return

                cur.execute("UPDATE users SET balance_up = balance_up + ? WHERE user_id = ?", (QUEST_REWARD, uid))
                cur.execute("UPDATE user_business SET quest_rewarded = ? WHERE user_id = ?", (today, uid))
        except Exception as e:
            logger.exception("quest claim failed: %s", e)
            try:
                await callback.answer("⚠️ Ошибка. Попробуйте позже", show_alert=True)
            except Exception:
                pass
            return

        _biz_log(uid, callback.from_user, "quest_reward", extra_detail=f"amount={QUEST_REWARD}")

        try:
            await callback.answer(f"Награда +{_fmt(QUEST_REWARD)} UP", show_alert=True)
        except Exception:
            pass

        await _render_shop_menu(callback, uid, callback.bot, edit=True)
    except Exception as e:
        logger.exception("cb_claim_quest failed: %s", e)


# ================== СТАТИСТИКА ==================
@router.callback_query(F.data == "shop_stats")
async def cb_shop_stats(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        biz = get_user_business(uid)
        if not biz:
            await _render_shop_menu(callback, uid, callback.bot, edit=True)
            return

        text = (
            "📊 <b>Статистика бизнеса</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"🏪 {_esc(biz['shop_name'])}\n"
            f"⭐ Уровень: {biz['level']}\n"
            f"💰 Всего заработано: <b>{_fmt(biz['total_earned'])} UP</b>\n"
            f"👥 Сотрудники: {biz['employees_count']}\n"
            f"📅 Дней в работе: {biz['days_worked']}"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="◀️ Назад", callback_data="shop_main_back")]]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_shop_stats failed: %s", e)