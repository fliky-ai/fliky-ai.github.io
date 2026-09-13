import time
import random
import asyncio
import logging
from pathlib import Path
from aiogram import Router, types, F
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import FSInputFile

from database import db_conn, check_user_registered, get_user, DEFAULT_NICK, log_action, add_exp

logger = logging.getLogger(__name__)
router = Router()

PHOTOS_DIR = Path(__file__).resolve().parent / "photos"

SELL_RATE = 0.70
TRIP_COOLDOWN = 600  # 10 минут

# Кэш file_id фото машин
_car_file_ids = {}
# Lock-и от двойного нажатия
_buy_locks = set()


# ================== КАТАЛОГ ==================
CARS_INFO = {
    "toyota_camry": {
        "name": "Toyota Camry", "emoji": "🚘", "photo": "car2.jpg",
        "rarity": "Обычная",
        "base_hp": 200, "base_speed": 210, "base_accel": 8.5,
        "fuel_cost_refuel": 50, "repair_cost": 30, "trip_bonus": 1.00,
    },
    "bmw_m3": {
        "name": "BMW M3", "emoji": "🏎️", "photo": "car.jpg",
        "rarity": "Редкая",
        "base_hp": 480, "base_speed": 250, "base_accel": 4.2,
        "fuel_cost_refuel": 80, "repair_cost": 55, "trip_bonus": 1.25,
    },
    "mercedes_c63": {
        "name": "Mercedes C63", "emoji": "🏎️", "photo": "car3.jpg",
        "rarity": "Редкая",
        "base_hp": 620, "base_speed": 280, "base_accel": 3.9,
        "fuel_cost_refuel": 100, "repair_cost": 70, "trip_bonus": 1.40,
    },
    "porsche_911": {
        "name": "Porsche 911", "emoji": "🏁", "photo": "car4.jpg",
        "rarity": "Эпическая",
        "base_hp": 650, "base_speed": 330, "base_accel": 3.2,
        "fuel_cost_refuel": 140, "repair_cost": 95, "trip_bonus": 1.65,
    },
    "g_class": {
        "name": "G-Class", "emoji": "🛡️", "photo": "car5.jpg",
        "rarity": "Эпическая",
        "base_hp": 585, "base_speed": 240, "base_accel": 4.5,
        "fuel_cost_refuel": 110, "repair_cost": 80, "trip_bonus": 1.50,
    },
}

UPGRADES = {
    "engine":       {"name": "Двигатель",         "emoji": "🔧", "max": 5, "col": "upg_engine"},
    "turbo":        {"name": "Турбина",           "emoji": "🚀", "max": 5, "col": "upg_turbo"},
    "transmission": {"name": "Трансмиссия",       "emoji": "⚡", "max": 5, "col": "upg_transmission"},
    "fuel_system":  {"name": "Топливная система", "emoji": "⛽", "max": 5, "col": "upg_fuel_system"},
    "chassis":      {"name": "Ходовая часть",     "emoji": "🛞", "max": 5, "col": "upg_chassis"},
}

ENGINE_HP_GAIN = [0, 30, 30, 35, 40, 50]
TURBO_SPEED_GAIN = [0, 10, 12, 15, 18, 25]
TRANS_ACCEL_REDUCE = [0, 0.2, 0.3, 0.3, 0.4, 0.5]
FUEL_MAX_BY_LEVEL = [100, 110, 120, 130, 140, 150]
CHASSIS_DAMAGE_REDUCE = [0, 0, 5, 8, 12, 15]

UPGRADE_BASE_COST = {
    "engine": 4500, "turbo": 5200, "transmission": 4000,
    "fuel_system": 3500, "chassis": 3800,
}

TRIP_TYPES = {
    "short":  {"name": "Короткая поездка", "emoji": "🛣️", "min_min": 5,  "dist": (10, 20), "reward": (100, 250), "fuel": (5, 10),  "cond_loss": 2},
    "normal": {"name": "Обычная поездка",  "emoji": "🛣️", "min_min": 10, "dist": (20, 40), "reward": (250, 500), "fuel": (10, 18), "cond_loss": 3},
    "long":   {"name": "Дальняя поездка",  "emoji": "🛣️", "min_min": 15, "dist": (40, 70), "reward": (500, 900), "fuel": (18, 30), "cond_loss": 5},
}


class MyCarStates(StatesGroup):
    confirm_upgrade = State()


# ================== БД ==================
def _init_mycar_db():
    """
    Важно: сначала СОЗДАЁМ user_cars (если нет), потом мигрируем.
    Иначе при импорте mycar.py ДО shopcar.py падает с 'no such table'.
    """
    try:
        with db_conn() as conn:
            cur = conn.cursor()

            # === 1. Создаём user_cars, если нет ===
            cur.execute("""
                CREATE TABLE IF NOT EXISTS user_cars (
                    user_id INTEGER PRIMARY KEY,
                    car_key TEXT,
                    car_name TEXT,
                    bought_price INTEGER DEFAULT 0,
                    bought_at INTEGER DEFAULT 0,
                    fuel INTEGER DEFAULT 100,
                    condition INTEGER DEFAULT 100,
                    upg_engine INTEGER DEFAULT 0,
                    upg_turbo INTEGER DEFAULT 0,
                    upg_transmission INTEGER DEFAULT 0,
                    upg_fuel_system INTEGER DEFAULT 0,
                    upg_chassis INTEGER DEFAULT 0,
                    last_trip INTEGER DEFAULT 0,
                    trip_in_progress_until INTEGER DEFAULT 0,
                    trip_type TEXT DEFAULT NULL,
                    trip_reward INTEGER DEFAULT 0,
                    trip_exp INTEGER DEFAULT 0,
                    total_trips INTEGER DEFAULT 0,
                    total_earned INTEGER DEFAULT 0,
                    total_fuel_used INTEGER DEFAULT 0,
                    total_repair_spent INTEGER DEFAULT 0
                )
            """)

            # === 2. Миграция: добавить недостающие колонки ===
            cur.execute("PRAGMA table_info(user_cars)")
            cols = {c[1] for c in cur.fetchall()}
            add_cols = {
                "car_key": "TEXT", "car_name": "TEXT",
                "bought_price": "INTEGER DEFAULT 0", "bought_at": "INTEGER DEFAULT 0",
                "fuel": "INTEGER DEFAULT 100", "condition": "INTEGER DEFAULT 100",
                "upg_engine": "INTEGER DEFAULT 0", "upg_turbo": "INTEGER DEFAULT 0",
                "upg_transmission": "INTEGER DEFAULT 0", "upg_fuel_system": "INTEGER DEFAULT 0",
                "upg_chassis": "INTEGER DEFAULT 0",
                "last_trip": "INTEGER DEFAULT 0",
                "trip_in_progress_until": "INTEGER DEFAULT 0",
                "trip_type": "TEXT DEFAULT NULL",
                "trip_reward": "INTEGER DEFAULT 0", "trip_exp": "INTEGER DEFAULT 0",
                "total_trips": "INTEGER DEFAULT 0", "total_earned": "INTEGER DEFAULT 0",
                "total_fuel_used": "INTEGER DEFAULT 0", "total_repair_spent": "INTEGER DEFAULT 0",
            }
            for col, ct in add_cols.items():
                if col not in cols:
                    try:
                        cur.execute(f"ALTER TABLE user_cars ADD COLUMN {col} {ct}")
                    except Exception as e:
                        logger.exception("миграция user_cars.%s: %s", col, e)

            # === 3. История поездок ===
            cur.execute("""
                CREATE TABLE IF NOT EXISTS cars_trips (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    car_key TEXT,
                    car_name TEXT,
                    trip_type TEXT,
                    distance INTEGER,
                    reward INTEGER,
                    exp_gained INTEGER,
                    fuel_used INTEGER,
                    condition_lost INTEGER,
                    started_at INTEGER,
                    finished_at INTEGER,
                    status TEXT DEFAULT 'active'
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_trips_user ON cars_trips(user_id, id DESC)")

            # === 4. История улучшений ===
            cur.execute("""
                CREATE TABLE IF NOT EXISTS cars_upgrades (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    car_key TEXT,
                    upgrade_key TEXT,
                    old_level INTEGER,
                    new_level INTEGER,
                    cost INTEGER,
                    created_at INTEGER
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_upgrades_user ON cars_upgrades(user_id, id DESC)")

        logger.info("mycar: таблицы готовы")
    except Exception as e:
        logger.exception("init_mycar_db failed: %s", e)


_init_mycar_db()


# ================== УТИЛИТЫ ==================
def _fmt(n) -> str:
    try:
        return f"{int(n):,}".replace(",", " ")
    except (TypeError, ValueError):
        return "0"


def _esc(s) -> str:
    return (str(s) if s is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _fmt_time(seconds: int) -> str:
    seconds = max(0, int(seconds))
    m, s = seconds // 60, seconds % 60
    return f"{m:02d}:{s:02d}"


def _balance(user_id: int) -> int:
    try:
        u = get_user(user_id) or {}
        return int(u.get("balance_up") or 0)
    except Exception:
        return 0


def _car_log(user_id: int, user, action: str, **kwargs):
    try:
        log_action(
            user_id=user_id,
            username=getattr(user, "username", None),
            display_name=getattr(user, "full_name", None),
            action_type="CAR",
            extra=action,
            **kwargs,
        )
    except Exception:
        pass


def _car_info(car_key: str) -> dict:
    return CARS_INFO.get(car_key) or CARS_INFO["toyota_camry"]


# ================== РАСЧЁТ ХАРАКТЕРИСТИК ==================
def calc_stats(car: dict) -> dict:
    info = _car_info(car.get("car_key"))
    hp = int(info["base_hp"])
    speed = int(info["base_speed"])
    accel = float(info["base_accel"])

    le = int(car.get("upg_engine") or 0)
    lt = int(car.get("upg_turbo") or 0)
    ltr = int(car.get("upg_transmission") or 0)
    lf = int(car.get("upg_fuel_system") or 0)
    lc = int(car.get("upg_chassis") or 0)

    for i in range(1, le + 1):
        hp += ENGINE_HP_GAIN[i]
    for i in range(1, lt + 1):
        speed += TURBO_SPEED_GAIN[i]
    for i in range(1, ltr + 1):
        accel -= TRANS_ACCEL_REDUCE[i]
    accel = max(1.5, round(accel, 1))

    fuel_max = FUEL_MAX_BY_LEVEL[min(5, lf)]
    damage_reduce = CHASSIS_DAMAGE_REDUCE[min(5, lc)]

    return {
        "hp": hp, "speed": speed, "accel": accel,
        "fuel_max": fuel_max, "damage_reduce": damage_reduce,
        "lvl_engine": le, "lvl_turbo": lt, "lvl_transmission": ltr,
        "lvl_fuel_system": lf, "lvl_chassis": lc,
    }


def upgrade_cost(car_key: str, upgrade_key: str, current_level: int) -> int:
    base = UPGRADE_BASE_COST.get(upgrade_key, 4000)
    return int(base * (1.6 ** current_level))


# ================== ЧТЕНИЕ ==================
def get_user_car(user_id: int):
    """Один быстрый SELECT."""
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM user_cars WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row:
                return None
            cols = [d[0] for d in cur.description]
            return dict(zip(cols, row))
    except Exception as e:
        logger.exception("get_user_car failed: %s", e)
        return None


def _insert_trip(user_id: int, car: dict, trip_type: str, distance: int,
                 reward: int, exp_gained: int, fuel_used: int, condition_lost: int,
                 started_at: int, status: str = "active"):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO cars_trips
                (user_id, car_key, car_name, trip_type, distance, reward, exp_gained,
                 fuel_used, condition_lost, started_at, finished_at, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            """, (user_id, car.get("car_key"), car.get("car_name"), trip_type, distance,
                  reward, exp_gained, fuel_used, condition_lost, started_at, status))
            return cur.lastrowid
    except Exception as e:
        logger.exception("_insert_trip failed: %s", e)
        return 0


def _insert_upgrade(user_id: int, car_key: str, upgrade_key: str,
                    old_lvl: int, new_lvl: int, cost: int):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO cars_upgrades
                (user_id, car_key, upgrade_key, old_level, new_level, cost, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (user_id, car_key, upgrade_key, old_lvl, new_lvl, cost, int(time.time())))
    except Exception as e:
        logger.exception("_insert_upgrade failed: %s", e)


# ================== КЛАВИАТУРЫ ==================
def _car_main_kb() -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="🏁 Поездка", callback_data="mycar_trip")],
            [types.InlineKeyboardButton(text="⛽ Заправить", callback_data="mycar_refuel")],
            [types.InlineKeyboardButton(text="🔧 Обслужить", callback_data="mycar_repair")],
            [types.InlineKeyboardButton(text="⬆️ Улучшения", callback_data="mycar_upgrades")],
            [types.InlineKeyboardButton(text="📊 Характеристики", callback_data="mycar_stats")],
            [types.InlineKeyboardButton(text="💰 Продать", callback_data="mycar_sell_ask")],
        ]
    )


def _back_kb() -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(
        inline_keyboard=[[types.InlineKeyboardButton(text="◀️ Назад", callback_data="mycar_back")]]
    )


def _car_main_text(car: dict) -> str:
    info = _car_info(car.get("car_key"))
    st = calc_stats(car)
    fuel = int(car.get("fuel") or 0)
    cond = int(car.get("condition") or 0)
    return (
        "🚘 <b>Моя машина</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        f"{info['emoji']} <b>{_esc(car.get('car_name') or info['name'])}</b>\n"
        f"💎 Редкость: <b>{_esc(info['rarity'])}</b>\n\n"
        f"🐎 Мощность: <b>{st['hp']} л.с.</b>\n"
        f"🚀 Скорость: <b>{st['speed']} км/ч</b>\n"
        f"⚡ Разгон: <b>{st['accel']} сек</b>\n\n"
        f"⛽ Топливо: <b>{fuel} / {st['fuel_max']}</b>\n"
        f"🔧 Состояние: <b>{cond}%</b>"
    )


# ================== БЫСТРАЯ ОТПРАВКА / РЕДАКТИРОВАНИЕ ==================
async def _edit_or_send(target, text: str, kb=None, photo_path=None):
    """
    target: Message или CallbackQuery.
    Пытается edit; если фото — через кэш file_id.
    Никогда не падает молча — в крайнем случае отправляет новое.
    """
    try:
        if isinstance(target, types.CallbackQuery):
            msg = target.message
            # 1) пробуем edit_caption (если сообщение с фото)
            try:
                await msg.edit_caption(caption=text, parse_mode="HTML", reply_markup=kb)
                return
            except Exception:
                pass
            # 2) пробуем edit_text (если сообщение текстовое)
            try:
                await msg.edit_text(text, parse_mode="HTML", reply_markup=kb)
                return
            except Exception:
                pass
            # 3) если есть фото — через кэш file_id
            if photo_path is not None:
                cached = _car_file_ids.get(str(photo_path))
                media_src = cached if cached else (FSInputFile(str(photo_path)) if photo_path.exists() else None)
                if media_src:
                    from aiogram.types import InputMediaPhoto
                    try:
                        await msg.edit_media(
                            media=InputMediaPhoto(media=media_src, caption=text, parse_mode="HTML"),
                            reply_markup=kb,
                        )
                        return
                    except Exception:
                        pass
                    try:
                        await msg.delete()
                    except Exception:
                        pass
                    try:
                        sent = await msg.answer_photo(
                            photo=media_src, caption=text, parse_mode="HTML", reply_markup=kb,
                        )
                        try:
                            if sent.photo:
                                _car_file_ids[str(photo_path)] = sent.photo[-1].file_id
                        except Exception:
                            pass
                        return
                    except Exception:
                        pass
            # 4) fallback
            try:
                await msg.answer(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                pass
        else:
            # Message — reply
            if photo_path is not None and photo_path.exists():
                cached = _car_file_ids.get(str(photo_path))
                media_src = cached if cached else FSInputFile(str(photo_path))
                try:
                    sent = await target.reply_photo(
                        photo=media_src, caption=text, parse_mode="HTML", reply_markup=kb,
                    )
                    try:
                        if sent.photo:
                            _car_file_ids[str(photo_path)] = sent.photo[-1].file_id
                    except Exception:
                        pass
                    return
                except Exception:
                    pass
            try:
                await target.reply(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                pass
    except Exception as e:
        logger.exception("_edit_or_send failed: %s", e)


async def _render_mycar(target, user_id: int, edit: bool = False):
    car = get_user_car(user_id)
    if not car:
        text = "🚘 <b>Моя машина</b>\n\nУ вас нет личного автомобиля."
        await _edit_or_send(target, text, None, None)
        return
    info = _car_info(car.get("car_key"))
    text = _car_main_text(car)
    kb = _car_main_kb()
    photo_path = PHOTOS_DIR / info["photo"]
    await _edit_or_send(target, text, kb, photo_path if photo_path.exists() else None)
# ================== ГЛАВНАЯ КОМАНДА ==================
@router.message(F.text.casefold().in_({"моя машина", "мой машина", "mycar", "🚘 моя машина"}))
async def cmd_mycar(message: types.Message, state: FSMContext):
    try:
        await state.clear()
        uid = message.from_user.id if message.from_user else None
        if not uid:
            return
        if not check_user_registered(uid):
            if message.chat.type == "private":
                try:
                    await message.reply(
                        "❌ <b>Вы еще не зарегистрированы!</b>\n\n💡 Напишите /start в ЛС бота.",
                        parse_mode="HTML",
                    )
                except Exception:
                    pass
            return
        _car_log(uid, message.from_user, "open_mycar")

        # сначала — завершаем поездку, если время пришло
        done = await _try_finish_trip(None, uid, is_callback=False)
        if done:
            return

        await _render_mycar(message, uid, edit=False)
    except Exception as e:
        logger.exception("cmd_mycar failed: %s", e)


# ================== НАЗАД ==================
@router.callback_query(F.data == "mycar_back")
async def cb_mycar_back(callback: types.CallbackQuery, state: FSMContext):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        try:
            await state.clear()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        done = await _try_finish_trip(callback, uid, is_callback=True)
        if done:
            return

        await _render_mycar(callback, uid, edit=True)
    except Exception as e:
        logger.exception("cb_mycar_back failed: %s", e)


@router.callback_query(F.data == "mycar_show")
async def cb_mycar_show(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        await _render_mycar(callback, uid, edit=True)
    except Exception as e:
        logger.exception("cb_mycar_show failed: %s", e)


# ================== ХАРАКТЕРИСТИКИ ==================
@router.callback_query(F.data == "mycar_stats")
async def cb_mycar_stats(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        car = get_user_car(uid)
        if not car:
            await _render_mycar(callback, uid, edit=True)
            return

        info = _car_info(car.get("car_key"))
        st = calc_stats(car)
        fuel = int(car.get("fuel") or 0)
        cond = int(car.get("condition") or 0)

        text = (
            "📊 <b>Характеристики</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"{info['emoji']} <b>{_esc(car.get('car_name') or info['name'])}</b>\n\n"
            f"🐎 Мощность: <b>{st['hp']} л.с.</b>\n"
            f"🚀 Скорость: <b>{st['speed']} км/ч</b>\n"
            f"⚡ Разгон: <b>{st['accel']} сек</b>\n"
            f"⛽ Топливо: <b>{fuel} / {st['fuel_max']}</b>\n"
            f"🔧 Состояние: <b>{cond}%</b>\n\n"
            f"🔧 Двигатель: <b>{st['lvl_engine']} / 5</b>\n"
            f"🚀 Турбина: <b>{st['lvl_turbo']} / 5</b>\n"
            f"⚡ Трансмиссия: <b>{st['lvl_transmission']} / 5</b>\n"
            f"⛽ Топливная система: <b>{st['lvl_fuel_system']} / 5</b>\n"
            f"🛞 Ходовая часть: <b>{st['lvl_chassis']} / 5</b>"
        )
        await _edit_or_send(callback, text, _back_kb())
    except Exception as e:
        logger.exception("cb_mycar_stats failed: %s", e)


# ================== ЗАПРАВКА ==================
@router.callback_query(F.data == "mycar_refuel")
async def cb_mycar_refuel(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        car = get_user_car(uid)
        if not car:
            await _render_mycar(callback, uid, edit=True)
            return

        info = _car_info(car.get("car_key"))
        st = calc_stats(car)
        fuel = int(car.get("fuel") or 0)
        fuel_max = st["fuel_max"]
        need = fuel_max - fuel
        if need <= 0:
            return

        price_per = int(info["fuel_cost_refuel"])
        total = need * price_per
        balance = _balance(uid)

        text = (
            "⛽ <b>Заправка</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"Топливо: <b>{fuel} / {fuel_max}</b>\n"
            f"Нужно долить: <b>{need}</b>\n"
            f"Цена: <b>{_fmt(price_per)} UP</b> за 1 ед.\n\n"
            f"💰 Итого: <b>{_fmt(total)} UP</b>\n"
            f"💵 Ваш баланс: <b>{_fmt(balance)} UP</b>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="✅ Заправить", callback_data="mycar_refuel_yes")],
                [types.InlineKeyboardButton(text="❌ Отмена", callback_data="mycar_back")],
            ]
        )
        await _edit_or_send(callback, text, kb)
    except Exception as e:
        logger.exception("cb_mycar_refuel failed: %s", e)


@router.callback_query(F.data == "mycar_refuel_yes")
async def cb_mycar_refuel_yes(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        lock = f"refuel_{uid}"
        if lock in _buy_locks:
            return
        _buy_locks.add(lock)

        try:
            ok = False
            reason = ""
            new_balance = 0
            new_fuel = 0

            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE")
                cur.execute("SELECT * FROM user_cars WHERE user_id = ?", (uid,))
                row = cur.fetchone()
                if not row:
                    reason = "no_car"
                else:
                    cols = [d[0] for d in cur.description]
                    car = dict(zip(cols, row))
                    info = _car_info(car.get("car_key"))
                    st = calc_stats(car)
                    fuel = int(car.get("fuel") or 0)
                    fuel_max = st["fuel_max"]
                    need = fuel_max - fuel
                    if need <= 0:
                        reason = "full"
                    else:
                        total = need * int(info["fuel_cost_refuel"])
                        cur.execute("SELECT balance_up FROM users WHERE user_id = ?", (uid,))
                        brow = cur.fetchone()
                        balance = int((brow[0] if brow else 0) or 0)
                        if balance < total:
                            reason = "insufficient"
                        else:
                            new_balance = balance - total
                            new_fuel = fuel_max
                            cur.execute("UPDATE users SET balance_up = ? WHERE user_id = ?", (new_balance, uid))
                            cur.execute("UPDATE user_cars SET fuel = ? WHERE user_id = ?", (new_fuel, uid))
                            ok = True

            if not ok:
                msg = {
                    "full": "Бак полный",
                    "insufficient": "Недостаточно UP",
                    "no_car": "Машина не найдена",
                }.get(reason, "Ошибка")
                try:
                    await callback.answer(msg, show_alert=True)
                except Exception:
                    pass
                return

            _car_log(uid, callback.from_user, "refuel",
                     balance_after=new_balance, extra_detail=f"fuel={new_fuel}")

            text = (
                "✅ <b>Заправлено</b>\n"
                "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
                f"⛽ Топливо: <b>{new_fuel} / {new_fuel}</b>\n"
                f"💵 Баланс: <b>{_fmt(new_balance)} UP</b>"
            )
            kb = types.InlineKeyboardMarkup(
                inline_keyboard=[[types.InlineKeyboardButton(text="🚘 К машине", callback_data="mycar_back")]]
            )
            await _edit_or_send(callback, text, kb)
        finally:
            async def _rel():
                await asyncio.sleep(3)
                _buy_locks.discard(lock)
            try:
                asyncio.create_task(_rel())
            except Exception:
                _buy_locks.discard(lock)
    except Exception as e:
        logger.exception("cb_mycar_refuel_yes failed: %s", e)


# ================== ОБСЛУЖИВАНИЕ ==================
@router.callback_query(F.data == "mycar_repair")
async def cb_mycar_repair(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        car = get_user_car(uid)
        if not car:
            await _render_mycar(callback, uid, edit=True)
            return

        info = _car_info(car.get("car_key"))
        cond = int(car.get("condition") or 0)
        need = 100 - cond
        if need <= 0:
            return

        cost_per = int(info["repair_cost"])
        total = need * cost_per
        balance = _balance(uid)

        text = (
            "🔧 <b>Обслуживание</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"Состояние: <b>{cond}%</b>\n"
            f"Восстановить: <b>{need}%</b>\n"
            f"Цена: <b>{_fmt(cost_per)} UP</b> за 1%\n\n"
            f"💰 Итого: <b>{_fmt(total)} UP</b>\n"
            f"💵 Ваш баланс: <b>{_fmt(balance)} UP</b>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="✅ Обслужить", callback_data="mycar_repair_yes")],
                [types.InlineKeyboardButton(text="❌ Отмена", callback_data="mycar_back")],
            ]
        )
        await _edit_or_send(callback, text, kb)
    except Exception as e:
        logger.exception("cb_mycar_repair failed: %s", e)


@router.callback_query(F.data == "mycar_repair_yes")
async def cb_mycar_repair_yes(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        lock = f"repair_{uid}"
        if lock in _buy_locks:
            return
        _buy_locks.add(lock)

        try:
            ok = False
            reason = ""
            new_balance = 0

            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE")
                cur.execute("SELECT * FROM user_cars WHERE user_id = ?", (uid,))
                row = cur.fetchone()
                if not row:
                    reason = "no_car"
                else:
                    cols = [d[0] for d in cur.description]
                    car = dict(zip(cols, row))
                    info = _car_info(car.get("car_key"))
                    cond = int(car.get("condition") or 0)
                    need = 100 - cond
                    if need <= 0:
                        reason = "full"
                    else:
                        total = need * int(info["repair_cost"])
                        cur.execute("SELECT balance_up FROM users WHERE user_id = ?", (uid,))
                        brow = cur.fetchone()
                        balance = int((brow[0] if brow else 0) or 0)
                        if balance < total:
                            reason = "insufficient"
                        else:
                            new_balance = balance - total
                            cur.execute("UPDATE users SET balance_up = ? WHERE user_id = ?", (new_balance, uid))
                            cur.execute("UPDATE user_cars SET condition = 100 WHERE user_id = ?", (uid,))
                            cur.execute(
                                "UPDATE user_cars SET total_repair_spent = total_repair_spent + ? WHERE user_id = ?",
                                (total, uid)
                            )
                            ok = True

            if not ok:
                msg = {
                    "full": "Машина уже в идеале",
                    "insufficient": "Недостаточно UP",
                    "no_car": "Машина не найдена",
                }.get(reason, "Ошибка")
                try:
                    await callback.answer(msg, show_alert=True)
                except Exception:
                    pass
                return

            _car_log(uid, callback.from_user, "repair",
                     balance_after=new_balance, extra_detail="condition=100")

            text = (
                "✅ <b>Обслуживание выполнено</b>\n"
                "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
                f"🔧 Состояние: <b>100%</b>\n"
                f"💵 Баланс: <b>{_fmt(new_balance)} UP</b>"
            )
            kb = types.InlineKeyboardMarkup(
                inline_keyboard=[[types.InlineKeyboardButton(text="🚘 К машине", callback_data="mycar_back")]]
            )
            await _edit_or_send(callback, text, kb)
        finally:
            async def _rel():
                await asyncio.sleep(3)
                _buy_locks.discard(lock)
            try:
                asyncio.create_task(_rel())
            except Exception:
                _buy_locks.discard(lock)
    except Exception as e:
        logger.exception("cb_mycar_repair_yes failed: %s", e)


# ================== ПРОДАЖА ==================
@router.callback_query(F.data == "mycar_sell_ask")
async def cb_mycar_sell_ask(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        car = get_user_car(uid)
        if not car:
            return
        bought_price = int(car.get("bought_price") or 0)
        sell_price = int(bought_price * SELL_RATE)
        if sell_price <= 0:
            return

        text = (
            "💸 <b>Продажа автомобиля</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"🚘 <b>{_esc(car.get('car_name') or 'Машина')}</b>\n\n"
            f"💰 Получите: <b>{_fmt(sell_price)} UP</b>\n\n"
            "Подтвердить продажу?"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="✅ Продать", callback_data="mycar_sell_yes")],
                [types.InlineKeyboardButton(text="❌ Отмена", callback_data="mycar_back")],
            ]
        )
        await _edit_or_send(callback, text, kb)
    except Exception as e:
        logger.exception("cb_mycar_sell_ask failed: %s", e)


@router.callback_query(F.data == "mycar_sell_yes")
async def cb_mycar_sell_yes(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        lock = f"sell_{uid}"
        if lock in _buy_locks:
            return
        _buy_locks.add(lock)

        try:
            ok = False
            sell_price = 0
            new_bal = 0
            car_name = "Машина"

            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE")
                cur.execute("SELECT * FROM user_cars WHERE user_id = ?", (uid,))
                row = cur.fetchone()
                if row:
                    cols = [d[0] for d in cur.description]
                    car = dict(zip(cols, row))
                    car_name = car.get("car_name") or "Машина"
                    bought_price = int(car.get("bought_price") or 0)
                    sell_price = int(bought_price * SELL_RATE)
                    if sell_price > 0:
                        cur.execute("UPDATE users SET balance_up = balance_up + ? WHERE user_id = ?", (sell_price, uid))
                        cur.execute("DELETE FROM user_cars WHERE user_id = ?", (uid,))
                        cur.execute("SELECT balance_up FROM users WHERE user_id = ?", (uid,))
                        new_bal = int((cur.fetchone() or [0])[0] or 0)
                        ok = True

            if not ok:
                try:
                    await callback.answer("Ошибка продажи", show_alert=True)
                except Exception:
                    pass
                return

            _car_log(uid, callback.from_user, "sell_car",
                     balance_after=new_bal,
                     extra_detail=f"car={car_name} price={sell_price}")

            text = (
                "💸 <b>Машина продана</b>\n"
                "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
                f"🚘 <b>{_esc(car_name)}</b>\n\n"
                f"💰 Получено: <b>+{_fmt(sell_price)} UP</b>\n"
                f"💵 Баланс: <b>{_fmt(new_bal)} UP</b>"
            )
            try:
                await callback.message.delete()
            except Exception:
                pass
            try:
                await callback.message.answer(text, parse_mode="HTML")
            except Exception:
                pass
        finally:
            async def _rel():
                await asyncio.sleep(3)
                _buy_locks.discard(lock)
            try:
                asyncio.create_task(_rel())
            except Exception:
                _buy_locks.discard(lock)
    except Exception as e:
        logger.exception("cb_mycar_sell_yes failed: %s", e)


# ================== ЗАВЕРШЕНИЕ ПОЕЗДКИ (internal) ==================
async def _try_finish_trip(callback, uid: int, is_callback: bool = True):
    """
    Если поездка завершена — начисляем и показываем результат.
    Возвращает True если что-то показали.
    """
    try:
        now = int(time.time())
        result_text = None
        kb = _back_kb()

        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            cur.execute("SELECT * FROM user_cars WHERE user_id = ?", (uid,))
            row = cur.fetchone()
            if not row:
                return False
            cols = [d[0] for d in cur.description]
            car = dict(zip(cols, row))

            trip_until = int(car.get("trip_in_progress_until") or 0)
            if trip_until == 0 or trip_until > now:
                return False

            cur.execute("""
                SELECT id, trip_type, distance, reward, exp_gained, fuel_used, condition_lost, started_at
                FROM cars_trips
                WHERE user_id = ? AND status = 'active'
                ORDER BY id DESC LIMIT 1
            """, (uid,))
            trow = cur.fetchone()
            if not trow:
                cur.execute("""
                    UPDATE user_cars
                    SET trip_in_progress_until = 0, trip_type = NULL,
                        trip_reward = 0, trip_exp = 0
                    WHERE user_id = ?
                """, (uid,))
                return False

            trip_id, trip_key, dist, reward, exp_gained, fuel_used, cond_lost, started_at = trow
            reward = int(reward or 0)
            exp_gained = int(exp_gained or 0)
            dist = int(dist or 0)
            trip_key = trip_key or "short"
            tinfo = TRIP_TYPES.get(trip_key, TRIP_TYPES["short"])

            cur.execute("UPDATE users SET balance_up = balance_up + ? WHERE user_id = ?", (reward, uid))
            cur.execute("""
                UPDATE user_cars
                SET trip_in_progress_until = 0, trip_type = NULL,
                    trip_reward = 0, trip_exp = 0,
                    total_trips = total_trips + 1,
                    total_earned = total_earned + ?,
                    total_fuel_used = total_fuel_used + ?
                WHERE user_id = ?
            """, (reward, fuel_used, uid))
            cur.execute("UPDATE cars_trips SET status = 'completed', finished_at = ? WHERE id = ?", (now, trip_id))
            cur.execute("SELECT balance_up FROM users WHERE user_id = ?", (uid,))
            new_balance = int((cur.fetchone() or [0])[0] or 0)

            result_text = (
                "🎉 <b>Поездка завершена</b>\n"
                "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
                f"🚘 <b>{_esc(car.get('car_name') or 'Машина')}</b>\n"
                f"{tinfo['emoji']} <b>{tinfo['name']}</b>\n"
                f"📍 Расстояние: <b>{dist} км</b>\n\n"
                f"💰 Награда: <b>+{_fmt(reward)} UP</b>\n"
                f"📈 EXP: <b>+{exp_gained}</b>\n"
                f"💵 Баланс: <b>{_fmt(new_balance)} UP</b>\n\n"
                "⏳ Следующая поездка через <b>10 минут</b>."
            )

        # EXP в общий уровень
        try:
            add_exp(uid, exp_gained)
        except Exception:
            pass

        _car_log(uid, None, "trip_finish",
                 balance_after=new_balance,
                 extra_detail=f"reward={reward} exp={exp_gained}")

        if is_callback and callback is not None:
            await _edit_or_send(callback, result_text, kb)
        return True
    except Exception as e:
        logger.exception("_try_finish_trip failed: %s", e)
        return False


# ================== ПОЕЗДКА — НАЧАЛО ==================
@router.callback_query(F.data == "mycar_trip")
async def cb_mycar_trip(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        # сначала — если поездка завершилась, выдаём награду
        done = await _try_finish_trip(callback, uid, is_callback=True)
        if done:
            return

        car = get_user_car(uid)
        if not car:
            await _render_mycar(callback, uid, edit=True)
            return

        now = int(time.time())

        # cooldown
        last_trip = int(car.get("last_trip") or 0)
        if last_trip and now - last_trip < TRIP_COOLDOWN:
            remaining = TRIP_COOLDOWN - (now - last_trip)
            text = (
                "⏳ <b>Машина ещё в пути</b>\n"
                "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
                f"🚘 Следующая поездка через:\n🕐 <b>{_fmt_time(remaining)}</b>"
            )
            await _edit_or_send(callback, text, _back_kb())
            return

        # уже идёт?
        in_progress_until = int(car.get("trip_in_progress_until") or 0)
        if in_progress_until > now:
            remaining = in_progress_until - now
            text = (
                "🏁 <b>Поездка в процессе</b>\n"
                "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
                f"🚘 Вернитесь через <b>{_fmt_time(remaining)}</b>\n\n"
                "Нажмите «🏁 Поездка» чтобы получить награду."
            )
            await _edit_or_send(callback, text, _back_kb())
            return

        cond = int(car.get("condition") or 0)
        if cond <= 0:
            text = (
                "⚠️ <b>Автомобиль требует обслуживания</b>\n"
                "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
                "🔧 Состояние: <b>0%</b>\n\n"
                "Перед поездкой восстановите состояние."
            )
            kb = types.InlineKeyboardMarkup(
                inline_keyboard=[
                    [types.InlineKeyboardButton(text="🔧 Обслужить", callback_data="mycar_repair")],
                    [types.InlineKeyboardButton(text="◀️ Назад", callback_data="mycar_back")],
                ]
            )
            await _edit_or_send(callback, text, kb)
            return

        # генерируем поездку
        r = random.random()
        if r < 0.55:
            trip_key = "short"
        elif r < 0.85:
            trip_key = "normal"
        else:
            trip_key = "long"
        tinfo = TRIP_TYPES[trip_key]

        dist = random.randint(tinfo["dist"][0], tinfo["dist"][1])
        fuel_need = max(tinfo["fuel"][0], min(tinfo["fuel"][1], int(dist / 2.5)))
        base_reward = random.randint(tinfo["reward"][0], tinfo["reward"][1])

        info = _car_info(car.get("car_key"))
        trip_bonus = float(info.get("trip_bonus", 1.0))
        reward = int(base_reward * trip_bonus)

        st = calc_stats(car)
        cond_loss_base = tinfo["cond_loss"]
        reduce = int(st.get("damage_reduce") or 0)
        cond_loss = max(1, cond_loss_base - int(cond_loss_base * reduce / 100))

        exp_gained = 2 + (1 if trip_key == "normal" else 2 if trip_key == "long" else 0)

        fuel_now = int(car.get("fuel") or 0)
        if fuel_now < fuel_need:
            text = (
                "⛽ <b>Недостаточно топлива</b>\n"
                "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
                f"Нужно: <b>{fuel_need}</b>\n"
                f"У вас: <b>{fuel_now}</b>\n\n"
                "Заправьте автомобиль перед поездкой."
            )
            kb = types.InlineKeyboardMarkup(
                inline_keyboard=[
                    [types.InlineKeyboardButton(text="⛽ Заправить", callback_data="mycar_refuel")],
                    [types.InlineKeyboardButton(text="◀️ Назад", callback_data="mycar_back")],
                ]
            )
            await _edit_or_send(callback, text, kb)
            return

        # сохраняем данные превью в user_cars (только ОДИН UPDATE)
        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE")
                cur.execute("""
                    UPDATE user_cars
                    SET trip_type = ?, trip_reward = ?, trip_exp = ?,
                        trip_in_progress_until = 0
                    WHERE user_id = ?
                """, (trip_key, reward, exp_gained, uid))
        except Exception as e:
            logger.exception("save trip preview failed: %s", e)
            return

        text = (
            "🏁 <b>Поездка</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"🚘 <b>{_esc(car.get('car_name') or info['name'])}</b>\n"
            f"{tinfo['emoji']} Маршрут: <b>{tinfo['name']}</b>\n"
            f"📍 Расстояние: <b>{dist} км</b>\n"
            f"⛽ Расход топлива: <b>{fuel_need}</b>\n"
            f"🔧 Потеря состояния: <b>-{cond_loss}%</b>\n\n"
            f"💰 Награда: <b>{_fmt(reward)} UP</b>\n"
            f"📈 EXP: <b>+{exp_gained}</b>\n\n"
            f"⏱️ Время поездки: <b>{tinfo['min_min']} мин</b>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="🚦 Начать поездку", callback_data="mycar_trip_start")],
                [types.InlineKeyboardButton(text="❌ Отмена", callback_data="mycar_back")],
            ]
        )
        await _edit_or_send(callback, text, kb)
    except Exception as e:
        logger.exception("cb_mycar_trip failed: %s", e)


# ================== ПОЕЗДКА — СТАРТ ==================
@router.callback_query(F.data == "mycar_trip_start")
async def cb_mycar_trip_start(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        lock = f"tripstart_{uid}"
        if lock in _buy_locks:
            return
        _buy_locks.add(lock)

        try:
            ok = False
            reason = ""
            trip_key = "short"
            tinfo = TRIP_TYPES["short"]
            fuel_need = 0
            cond_loss = 0
            reward = 0
            exp_gained = 0
            dist = 0
            new_fuel = 0
            new_cond = 0

            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE")
                cur.execute("SELECT * FROM user_cars WHERE user_id = ?", (uid,))
                row = cur.fetchone()
                if not row:
                    reason = "no_car"
                else:
                    cols = [d[0] for d in cur.description]
                    car = dict(zip(cols, row))

                    trip_key = car.get("trip_type") or "short"
                    tinfo = TRIP_TYPES.get(trip_key, TRIP_TYPES["short"])
                    reward = int(car.get("trip_reward") or 0)
                    exp_gained = int(car.get("trip_exp") or 0)

                    if reward <= 0:
                        reason = "no_preview"
                    else:
                        now = int(time.time())
                        last_trip = int(car.get("last_trip") or 0)
                        if last_trip and now - last_trip < TRIP_COOLDOWN:
                            reason = "cooldown"

                        in_progress_until = int(car.get("trip_in_progress_until") or 0)
                        if in_progress_until > now:
                            reason = "in_progress"

                        cond = int(car.get("condition") or 0)
                        if cond <= 0:
                            reason = "no_cond"

                        if reason == "":
                            st = calc_stats(car)
                            fuel_now = int(car.get("fuel") or 0)
                            dist = random.randint(tinfo["dist"][0], tinfo["dist"][1])
                            fuel_need = max(tinfo["fuel"][0], min(tinfo["fuel"][1], int(dist / 2.5)))

                            if fuel_now < fuel_need:
                                reason = "no_fuel"
                            else:
                                reduce = int(st.get("damage_reduce") or 0)
                                cond_loss_base = tinfo["cond_loss"]
                                cond_loss = max(1, cond_loss_base - int(cond_loss_base * reduce / 100))
                                new_fuel = fuel_now - fuel_need
                                new_cond = max(0, cond - cond_loss)
                                duration = tinfo["min_min"] * 60
                                trip_until = now + duration

                                cur.execute("""
                                    UPDATE user_cars
                                    SET fuel = ?, condition = ?,
                                        trip_in_progress_until = ?, last_trip = ?
                                    WHERE user_id = ?
                                """, (new_fuel, new_cond, trip_until, now, uid))

                                cur.execute("""
                                    INSERT INTO cars_trips
                                    (user_id, car_key, car_name, trip_type, distance, reward, exp_gained,
                                     fuel_used, condition_lost, started_at, finished_at, status)
                                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active')
                                """, (uid, car.get("car_key"), car.get("car_name"), trip_key,
                                      dist, reward, exp_gained, fuel_need, cond_loss, now))
                                ok = True

            if not ok:
                msg = {
                    "no_car": "Машина не найдена",
                    "no_preview": "Обновите карточку",
                    "cooldown": "Машина ещё в пути",
                    "in_progress": "Поездка уже идёт",
                    "no_cond": "Нужно обслуживание",
                    "no_fuel": "Недостаточно топлива",
                }.get(reason, "Ошибка")
                try:
                    await callback.answer(msg, show_alert=True)
                except Exception:
                    pass
                return

            _car_log(uid, callback.from_user, "trip_start",
                     extra_detail=f"type={trip_key} dist={dist} reward={reward} fuel={fuel_need}")

            text = (
                "🚦 <b>Поездка началась</b>\n"
                "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
                f"📍 Расстояние: <b>{dist} км</b>\n"
                f"⏱️ Время: <b>{tinfo['min_min']} мин</b>\n"
                f"⛽ Топливо: <b>{new_fuel}</b>\n"
                f"🔧 Состояние: <b>{new_cond}%</b>\n\n"
                "Возвращайтесь сюда после завершения,\nчтобы получить награду."
            )
            kb = types.InlineKeyboardMarkup(
                inline_keyboard=[[types.InlineKeyboardButton(text="🚘 К машине", callback_data="mycar_back")]]
            )
            await _edit_or_send(callback, text, kb)
        finally:
            async def _rel():
                await asyncio.sleep(3)
                _buy_locks.discard(lock)
            try:
                asyncio.create_task(_rel())
            except Exception:
                _buy_locks.discard(lock)
    except Exception as e:
        logger.exception("cb_mycar_trip_start failed: %s", e)


# ================== УЛУЧШЕНИЯ ==================
def _upg_list_text(car: dict) -> str:
    info = _car_info(car.get("car_key"))
    st = calc_stats(car)
    lines = [
        "⬆️ <b>Улучшения</b>",
        "━━━━━━━━━━━━━━━━━━━━━━━",
        "",
        f"🚘 <b>{_esc(car.get('car_name') or info['name'])}</b>",
        "",
    ]
    lvl_map = {
        "engine": st["lvl_engine"],
        "turbo": st["lvl_turbo"],
        "transmission": st["lvl_transmission"],
        "fuel_system": st["lvl_fuel_system"],
        "chassis": st["lvl_chassis"],
    }
    for key, u in UPGRADES.items():
        lines.append(f"{u['emoji']} {u['name']}: <b>{lvl_map[key]} / {u['max']}</b>")
    return "\n".join(lines)


def _upg_list_kb() -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="🔧 Двигатель", callback_data="mycar_upg_engine")],
            [types.InlineKeyboardButton(text="🚀 Турбина", callback_data="mycar_upg_turbo")],
            [types.InlineKeyboardButton(text="⚡ Трансмиссия", callback_data="mycar_upg_transmission")],
            [types.InlineKeyboardButton(text="⛽ Топливная система", callback_data="mycar_upg_fuel_system")],
            [types.InlineKeyboardButton(text="🛞 Ходовая часть", callback_data="mycar_upg_chassis")],
            [types.InlineKeyboardButton(text="◀️ Назад", callback_data="mycar_back")],
        ]
    )


@router.callback_query(F.data == "mycar_upgrades")
async def cb_mycar_upgrades(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        car = get_user_car(uid)
        if not car:
            await _render_mycar(callback, uid, edit=True)
            return
        text = _upg_list_text(car)
        await _edit_or_send(callback, text, _upg_list_kb())
    except Exception as e:
        logger.exception("cb_mycar_upgrades failed: %s", e)


def _upg_detail(car: dict, upg_key: str) -> dict:
    info = _car_info(car.get("car_key"))
    st = calc_stats(car)
    u = UPGRADES[upg_key]
    lvl_map = {
        "engine": st["lvl_engine"],
        "turbo": st["lvl_turbo"],
        "transmission": st["lvl_transmission"],
        "fuel_system": st["lvl_fuel_system"],
        "chassis": st["lvl_chassis"],
    }
    cur_lvl = lvl_map[upg_key]
    next_lvl = cur_lvl + 1
    can = next_lvl <= u["max"]
    cost = upgrade_cost(car.get("car_key") or "toyota_camry", upg_key, cur_lvl) if can else 0

    if upg_key == "engine":
        now_val = st["hp"]
        next_val = now_val + ENGINE_HP_GAIN[next_lvl] if can else now_val
        val_line = f"🐎 Сейчас: <b>{now_val} л.с.</b>\n➡️ После: <b>{next_val} л.с.</b>"
    elif upg_key == "turbo":
        now_val = st["speed"]
        next_val = now_val + TURBO_SPEED_GAIN[next_lvl] if can else now_val
        val_line = f"🚀 Сейчас: <b>{now_val} км/ч</b>\n➡️ После: <b>{next_val} км/ч</b>"
    elif upg_key == "transmission":
        now_val = st["accel"]
        next_val = max(1.5, round(now_val - TRANS_ACCEL_REDUCE[next_lvl], 1)) if can else now_val
        val_line = f"⚡ Сейчас: <b>{now_val} сек</b>\n➡️ После: <b>{next_val} сек</b>"
    elif upg_key == "fuel_system":
        now_val = st["fuel_max"]
        next_val = FUEL_MAX_BY_LEVEL[min(5, next_lvl)] if can else now_val
        val_line = f"⛽ Сейчас: <b>{now_val}</b>\n➡️ После: <b>{next_val}</b>"
    else:
        now_val = st["damage_reduce"]
        next_val = CHASSIS_DAMAGE_REDUCE[min(5, next_lvl)] if can else now_val
        val_line = f"🛞 Сейчас: <b>-{now_val}%</b>\n➡️ После: <b>-{next_val}%</b>"

    text = (
        f"⬆️ <b>{u['name']}</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        f"⭐ Уровень: <b>{cur_lvl} / {u['max']}</b>\n\n"
        f"{val_line}"
    )
    if can:
        text += f"\n\n💰 Стоимость: <b>{_fmt(cost)} UP</b>"
    else:
        text += "\n\n✅ Максимальный уровень"

    return {"text": text, "can": can, "cost": cost, "cur_lvl": cur_lvl, "next_lvl": next_lvl}


@router.callback_query(F.data.startswith("mycar_upg_") & ~F.data.startswith("mycar_upg_do_") & ~F.data.startswith("mycar_upg_yes_"))
async def cb_mycar_upg_detail(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        car = get_user_car(uid)
        if not car:
            await _render_mycar(callback, uid, edit=True)
            return

        upg_key = (callback.data or "").replace("mycar_upg_", "")
        if upg_key not in UPGRADES:
            return

        d = _upg_detail(car, upg_key)
        rows = []
        if d["can"]:
            rows.append([types.InlineKeyboardButton(
                text=f"⬆️ Улучшить за {_fmt(d['cost'])} UP",
                callback_data=f"mycar_upg_do_{upg_key}"
            )])
        rows.append([types.InlineKeyboardButton(text="◀️ Назад", callback_data="mycar_upgrades")])
        await _edit_or_send(callback, d["text"], types.InlineKeyboardMarkup(inline_keyboard=rows))
    except Exception as e:
        logger.exception("cb_mycar_upg_detail failed: %s", e)


@router.callback_query(F.data.startswith("mycar_upg_do_"))
async def cb_mycar_upg_do(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        car = get_user_car(uid)
        if not car:
            return

        upg_key = (callback.data or "").replace("mycar_upg_do_", "")
        if upg_key not in UPGRADES:
            return

        d = _upg_detail(car, upg_key)
        if not d["can"]:
            return

        balance = _balance(uid)
        text = (
            "⬆️ <b>Улучшение автомобиля</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"{UPGRADES[upg_key]['emoji']} <b>{UPGRADES[upg_key]['name']}</b>\n"
            f"⭐ Уровень: <b>{d['cur_lvl']} → {d['next_lvl']}</b>\n\n"
            f"💰 Стоимость: <b>{_fmt(d['cost'])} UP</b>\n"
            f"💵 Ваш баланс: <b>{_fmt(balance)} UP</b>\n\n"
            "Подтвердить улучшение?"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="✅ Подтвердить", callback_data=f"mycar_upg_yes_{upg_key}")],
                [types.InlineKeyboardButton(text="❌ Отмена", callback_data=f"mycar_upg_{upg_key}")],
            ]
        )
        await _edit_or_send(callback, text, kb)
    except Exception as e:
        logger.exception("cb_mycar_upg_do failed: %s", e)


@router.callback_query(F.data.startswith("mycar_upg_yes_"))
async def cb_mycar_upg_yes(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        upg_key = (callback.data or "").replace("mycar_upg_yes_", "")
        if upg_key not in UPGRADES:
            return

        lock = f"upg_{uid}_{upg_key}"
        if lock in _buy_locks:
            return
        _buy_locks.add(lock)

        try:
            ok = False
            reason = ""
            cost = 0
            old_lvl = 0
            new_lvl = 0
            car_key = ""

            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE")
                cur.execute("SELECT * FROM user_cars WHERE user_id = ?", (uid,))
                row = cur.fetchone()
                if not row:
                    reason = "no_car"
                else:
                    cols = [d[0] for d in cur.description]
                    car = dict(zip(cols, row))
                    car_key = car.get("car_key") or ""

                    col = UPGRADES[upg_key]["col"]
                    old_lvl = int(car.get(col) or 0)
                    if old_lvl >= UPGRADES[upg_key]["max"]:
                        reason = "max"
                    else:
                        cost = upgrade_cost(car_key, upg_key, old_lvl)
                        cur.execute("SELECT balance_up FROM users WHERE user_id = ?", (uid,))
                        brow = cur.fetchone()
                        balance = int((brow[0] if brow else 0) or 0)
                        if balance < cost:
                            reason = "insufficient"
                        else:
                            new_lvl = old_lvl + 1
                            cur.execute(f"UPDATE user_cars SET {col} = ? WHERE user_id = ?", (new_lvl, uid))
                            cur.execute("UPDATE users SET balance_up = balance_up - ? WHERE user_id = ?", (cost, uid))
                            cur.execute("""
                                INSERT INTO cars_upgrades
                                (user_id, car_key, upgrade_key, old_level, new_level, cost, created_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?)
                            """, (uid, car_key, upg_key, old_lvl, new_lvl, cost, int(time.time())))
                            ok = True

            if not ok:
                msg = {
                    "max": "Максимальный уровень",
                    "insufficient": "Недостаточно UP",
                    "no_car": "Машина не найдена",
                }.get(reason, "Ошибка")
                try:
                    await callback.answer(msg, show_alert=True)
                except Exception:
                    pass
                return

            _car_log(uid, callback.from_user, f"upgrade_{upg_key}",
                     extra_detail=f"{old_lvl}->{new_lvl} cost={cost}")

            text = (
                "✅ <b>Улучшение выполнено</b>\n"
                "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
                f"{UPGRADES[upg_key]['emoji']} <b>{UPGRADES[upg_key]['name']}</b>\n"
                f"⭐ Новый уровень: <b>{new_lvl} / {UPGRADES[upg_key]['max']}</b>\n\n"
                f"💰 Списано: <b>{_fmt(cost)} UP</b>\n"
                f"💵 Баланс: <b>{_fmt(_balance(uid))} UP</b>"
            )
            kb = types.InlineKeyboardMarkup(
                inline_keyboard=[
                    [types.InlineKeyboardButton(text="⬆️ К улучшениям", callback_data="mycar_upgrades")],
                    [types.InlineKeyboardButton(text="🚘 К машине", callback_data="mycar_back")],
                ]
            )
            await _edit_or_send(callback, text, kb)
        finally:
            async def _rel():
                await asyncio.sleep(3)
                _buy_locks.discard(lock)
            try:
                asyncio.create_task(_rel())
            except Exception:
                _buy_locks.discard(lock)
    except Exception as e:
        logger.exception("cb_mycar_upg_yes failed: %s", e)