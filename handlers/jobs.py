import time
import random
import asyncio
import logging
from aiogram import Router, types, F
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

from database import (
    db_conn, check_user_registered, get_user, DEFAULT_NICK,
    get_user_level, add_exp, log_action,
)

logger = logging.getLogger(__name__)
router = Router()

COOLDOWN_SECONDS = 600
_active_users = set()


# ================== ПРОФЕССИИ ==================
JOBS = {
    "garbage":     {"name": "Мусорщик",        "emoji": "🗑️", "level_req": 1,  "base_reward": 1000,  "exp": (2, 4)},
    "taxi":        {"name": "Таксист",         "emoji": "🚕", "level_req": 3,  "base_reward": 2500,  "exp": (3, 6)},
    "mechanic":    {"name": "Механик",         "emoji": "🔧", "level_req": 5,  "base_reward": 4000,  "exp": (4, 7)},
    "programmer":  {"name": "Программист",     "emoji": "💻", "level_req": 8,  "base_reward": 7000,  "exp": (5, 9)},
    "businessman": {"name": "Предприниматель", "emoji": "🏢", "level_req": 12, "base_reward": 12000, "exp": (7, 12)},
    "investor":    {"name": "Инвестор",        "emoji": "📈", "level_req": 20, "base_reward": 25000, "exp": (10, 15)},
}


# ================== МИНИ-ИГРЫ ==================
MINI_GAMES = {
    "garbage": [
        {"correct": "🍎", "wrong": ["🗑️"] * 5, "text": "Найди полезный предмет"},
        {"correct": "🍕", "wrong": ["🗑️"] * 5, "text": "Найди еду"},
        {"correct": "🥤", "wrong": ["🗑️"] * 5, "text": "Найди напиток"},
        {"correct": "🍌", "wrong": ["🗑️"] * 5, "text": "Найди фрукт"},
        {"correct": "🥪", "wrong": ["🗑️"] * 5, "text": "Найди бутерброд"},
    ],
    "taxi": [
        {"correct": "✈️ Аэропорт", "wrong": ["🛣️ Трасса", "🏙️ Центр", "🌳 Парк", "🏠 Дом", "🏭 Завод"], "text": "Пассажир хочет в аэропорт"},
        {"correct": "🏙️ Центр",   "wrong": ["✈️ Аэропорт", "🛣️ Трасса", "🌳 Парк", "🏠 Дом", "🏭 Завод"], "text": "Пассажир хочет в центр"},
        {"correct": "🏠 Дом",      "wrong": ["✈️ Аэропорт", "🛣️ Трасса", "🏙️ Центр", "🌳 Парк", "🏭 Завод"], "text": "Пассажир хочет домой"},
        {"correct": "🏭 Завод",    "wrong": ["✈️ Аэропорт", "🛣️ Трасса", "🏙️ Центр", "🌳 Парк", "🏠 Дом"], "text": "Пассажир хочет на завод"},
        {"correct": "🌳 Парк",     "wrong": ["✈️ Аэропорт", "🛣️ Трасса", "🏙️ Центр", "🏠 Дом", "🏭 Завод"], "text": "Пассажир хочет в парк"},
    ],
    "mechanic": [
        {"correct": "🛠️ Тормоза",     "wrong": ["🛞 Колесо", "🔋 Аккумулятор", "💡 Фара", "🪑 Сиденье", "📻 Магнитола"], "text": "Машина плохо тормозит"},
        {"correct": "🔋 Аккумулятор", "wrong": ["🛞 Колесо", "🛠️ Тормоза", "💡 Фара", "🪑 Сиденье", "📻 Магнитола"], "text": "Машина не заводится"},
        {"correct": "💡 Фара",        "wrong": ["🛞 Колесо", "🛠️ Тормоза", "🔋 Аккумулятор", "🪑 Сиденье", "📻 Магнитола"], "text": "Фара не горит"},
        {"correct": "🛞 Колесо",      "wrong": ["🛠️ Тормоза", "🔋 Аккумулятор", "💡 Фара", "🪑 Сиденье", "📻 Магнитола"], "text": "Машина вибрирует"},
        {"correct": "📻 Магнитола",   "wrong": ["🛞 Колесо", "🛠️ Тормоза", "🔋 Аккумулятор", "💡 Фара", "🪑 Сиденье"], "text": "Музыка не играет"},
    ],
    "programmer": [
        {"correct": "print()", "wrong": ["prinnt()", "prnt()", "pirnt()", "pritn()", "prnit()"], "text": "Найди правильный код"},
        {"correct": "def",     "wrong": ["deff", "dfe", "dff", "dep", "defn"], "text": "Найди правильный оператор"},
        {"correct": "for",     "wrong": ["forr", "fro", "fo", "fr", "forn"], "text": "Найди правильный цикл"},
        {"correct": "if",      "wrong": ["iff", "fi", "iif", "iph", "ifn"], "text": "Найди правильное условие"},
        {"correct": "while",   "wrong": ["whille", "whlie", "wile", "whil", "whhile"], "text": "Найди правильный цикл"},
    ],
    "businessman": [
        {"correct": "📢 Реклама",     "wrong": ["❌ Закрыть магазин", "💸 Потратить всё", "🗑️ Убрать товар", "📉 Поднять цены", "🚫 Ничего"], "text": "Продажи упали. Что делать?"},
        {"correct": "📦 Новый товар", "wrong": ["❌ Закрыть бизнес", "💸 Потратить всё", "🗑️ Убрать всё", "📉 Уволить всех", "🚫 Ничего"], "text": "Клиенты хотят новинки"},
        {"correct": "📢 Акция",       "wrong": ["❌ Закрыть", "💸 Потратить всё", "🗑️ Убрать товар", "📉 Поднять цены", "🚫 Ничего"], "text": "Как привлечь клиентов?"},
        {"correct": "💼 Инвестиции",  "wrong": ["❌ Закрыть", "💸 Потратить всё", "🗑️ Убрать всё", "📉 Уволить всех", "🚫 Ничего"], "text": "Есть свободные деньги"},
        {"correct": "📊 Анализ",      "wrong": ["❌ Закрыть", "💸 Потратить всё", "🗑️ Убрать всё", "📉 Уволить всех", "🚫 Ничего"], "text": "Продажи падают"},
    ],
    "investor": [
        {"correct": "📊 Стабильная компания", "wrong": ["🎲 Случайная ставка", "❌ Ничего", "💸 Потратить всё", "🗑️ Уничтожить", "❌ Отдать бесплатно"], "text": "Куда вложиться?"},
        {"correct": "📈 Акции роста",         "wrong": ["🎲 Казино", "❌ Ничего", "💸 Потратить всё", "🗑️ Уничтожить", "❌ Отдать бесплатно"], "text": "Ищем прибыль"},
        {"correct": "🏦 Облигации",           "wrong": ["🎲 Лотерея", "❌ Ничего", "💸 Потратить всё", "🗑️ Уничтожить", "❌ Отдать бесплатно"], "text": "Надёжное вложение"},
        {"correct": "💎 Золото",              "wrong": ["🎲 Рулетка", "❌ Ничего", "💸 Потратить всё", "🗑️ Уничтожить", "❌ Отдать бесплатно"], "text": "Защита от инфляции"},
        {"correct": "📈 Диверсификация",      "wrong": ["🎲 Всё на одно", "❌ Ничего", "💸 Потратить всё", "🗑️ Уничтожить", "❌ Отдать бесплатно"], "text": "Снизить риск"},
    ],
}


class JobStates(StatesGroup):
    playing = State()


# ================== БД ==================
def _init_jobs_db():
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS user_jobs (
                    user_id INTEGER PRIMARY KEY,
                    current_job TEXT DEFAULT NULL,
                    job_level INTEGER DEFAULT 1,
                    job_exp INTEGER DEFAULT 0,
                    hired_at INTEGER DEFAULT 0,
                    last_work INTEGER DEFAULT 0
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS jobs_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    job_name TEXT,
                    action_type TEXT,
                    amount INTEGER DEFAULT 0,
                    exp_gained INTEGER DEFAULT 0,
                    result TEXT DEFAULT '',
                    created_at INTEGER
                )
            """)
            cur.execute("PRAGMA table_info(user_jobs)")
            cols = {c[1] for c in cur.fetchall()}
            for col, ct in (
                ("current_job", "TEXT DEFAULT NULL"),
                ("last_work", "INTEGER DEFAULT 0"),
                ("hired_at", "INTEGER DEFAULT 0"),
            ):
                if col not in cols:
                    try:
                        cur.execute(f"ALTER TABLE user_jobs ADD COLUMN {col} {ct}")
                    except Exception:
                        pass

            cur.execute("CREATE INDEX IF NOT EXISTS idx_jh_user ON jobs_history(user_id, id DESC)")

        logger.info("jobs: таблицы готовы")
    except Exception as e:
        logger.exception("init_jobs_db failed: %s", e)


_init_jobs_db()


# ================== УТИЛИТЫ ==================
def _fmt(n) -> str:
    try:
        return f"{int(n):,}".replace(",", " ")
    except (TypeError, ValueError):
        return "0"


def _esc(s) -> str:
    return (str(s) if s is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _fmt_time(seconds: int) -> str:
    if seconds < 0:
        seconds = 0
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def _xp_bar(xp: int, need: int, length: int = 10) -> str:
    try:
        if need <= 0:
            return "█" * length
        filled = int((xp / need) * length)
        filled = max(0, min(length, filled))
        return "█" * filled + "░" * (length - filled)
    except Exception:
        return "░" * length


def _balance(user_id: int) -> int:
    try:
        u = get_user(user_id) or {}
        return int(u.get("balance_up") or 0)
    except Exception:
        return 0


def _job_log(user_id: int, user, action: str, **kwargs):
    try:
        log_action(
            user_id=user_id,
            username=getattr(user, "username", None),
            display_name=getattr(user, "full_name", None),
            action_type="JOB",
            extra=action,
            **kwargs,
        )
    except Exception:
        pass


def _require_level(user_id: int) -> dict:
    return get_user_level(user_id)


# ================== CRUD ==================
def get_user_job(user_id: int) -> dict:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT current_job, last_work, hired_at FROM user_jobs WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row:
                return {"job": None, "last_work": 0, "hired_at": 0}
            return {"job": row[0], "last_work": int(row[1] or 0), "hired_at": int(row[2] or 0)}
    except Exception as e:
        logger.exception("get_user_job failed: %s", e)
        return {"job": None, "last_work": 0, "hired_at": 0}


def set_user_job(user_id: int, job_key: str) -> bool:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT OR REPLACE INTO user_jobs (user_id, current_job, hired_at, last_work)
                VALUES (?, ?, ?, 0)
            """, (user_id, job_key, int(time.time())))
        return True
    except Exception as e:
        logger.exception("set_user_job failed: %s", e)
        return False


def fire_user(user_id: int) -> bool:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM user_jobs WHERE user_id = ?", (user_id,))
        return True
    except Exception as e:
        logger.exception("fire_user failed: %s", e)
        return False


def update_last_work(user_id: int, ts: int) -> bool:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("UPDATE user_jobs SET last_work = ? WHERE user_id = ?", (ts, user_id))
        return True
    except Exception as e:
        logger.exception("update_last_work failed: %s", e)
        return False


def add_job_history(user_id: int, job_key: str, action_type: str,
                    amount: int = 0, exp_gained: int = 0, result: str = "") -> bool:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO jobs_history (user_id, job_name, action_type, amount, exp_gained, result, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (user_id, job_key, action_type, amount, exp_gained, result, int(time.time())))
        return True
    except Exception as e:
        logger.exception("add_job_history failed: %s", e)
        return False


def update_balance(user_id: int, amount: int) -> bool:
    if not isinstance(amount, int) or amount == 0:
        return False
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            cur.execute("UPDATE users SET balance_up = balance_up + ? WHERE user_id = ?", (amount, user_id))
            if cur.rowcount == 0:
                return False
        return True
    except Exception as e:
        logger.exception("update_balance failed: %s", e)
        return False


# ================== ЛОГИКА ==================
def calculate_reward(job_key: str, account_level: int) -> int:
    """Зарплата зависит от ОБЩЕГО уровня аккаунта."""
    job = JOBS.get(job_key)
    if not job:
        return 0
    base = job["base_reward"]
    multiplier = 1 + (max(1, account_level) - 1) * 0.20
    return int(base * multiplier)


def roll_exp(job_key: str) -> int:
    """Случайный EXP за смену для профессии."""
    job = JOBS.get(job_key)
    if not job:
        return 1
    lo, hi = job.get("exp", (1, 1))
    if hi < lo:
        hi = lo
    return random.randint(lo, hi)


def exp_range_str(job_key: str) -> str:
    """Красивая строка диапазона: '+3–6 EXP'."""
    job = JOBS.get(job_key)
    if not job:
        return "+1 EXP"
    lo, hi = job.get("exp", (1, 1))
    if lo == hi:
        return f"+{lo} EXP"
    return f"+{lo}–{hi} EXP"


def get_available_jobs(account_level: int):
    return [k for k, j in JOBS.items() if account_level >= j["level_req"]]


# ================== SAFE EDIT ==================
async def safe_edit(message, text, reply_markup=None):
    try:
        await message.edit_text(text, parse_mode="HTML", reply_markup=reply_markup)
        return True
    except Exception:
        pass
    try:
        await message.edit_caption(caption=text, parse_mode="HTML", reply_markup=reply_markup)
        return True
    except Exception:
        pass
    try:
        await message.delete()
    except Exception:
        pass
    try:
        await message.answer(text, parse_mode="HTML", reply_markup=reply_markup)
        return True
    except Exception:
        return False


# ================== ГЛАВНОЕ МЕНЮ ==================
@router.message(F.text.casefold().in_({"работа", "работы", "профессия", "👔 работа"}))
async def cmd_jobs(message: types.Message, state: FSMContext):
    try:
        await state.clear()
        uid = message.from_user.id
        if not check_user_registered(uid):
            if message.chat.type == "private":
                await message.answer(
                    "❌ <b>Вы еще не зарегистрированы!</b>\n\n"
                    "💡 Напишите /start в ЛС бота.",
                    parse_mode="HTML",
                )
            return

        job_data = get_user_job(uid)
        if job_data["job"]:
            await _render_my_job(message, uid, edit=False)
        else:
            await _render_main_menu(message, uid, edit=False)
    except Exception as e:
        logger.exception("cmd_jobs failed: %s", e)


async def _render_main_menu(target, user_id: int, edit: bool = False):
    try:
        lvl = _require_level(user_id)
        bar = _xp_bar(lvl["xp"], lvl["xp_needed"])

        text = (
            "👔 <b>Работа</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"⭐ Уровень аккаунта: <b>{lvl['level']}</b>\n"
            f"📈 EXP: <b>{_fmt(lvl['xp'])} / {_fmt(lvl['xp_needed'])}</b>\n"
            f"<code>{bar}</code>\n\n"
            "💼 Выберите профессию и начните зарабатывать.\n"
            "💰 Зарплата и опыт растут вместе с вашим уровнем."
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="💼 Все вакансии", callback_data="jobs_vacancies")],
            ]
        )
        if edit and isinstance(target, types.CallbackQuery):
            await safe_edit(target.message, text, kb)
        else:
            await target.answer(text, parse_mode="HTML", reply_markup=kb)
    except Exception as e:
        logger.exception("_render_main_menu failed: %s", e)


async def _render_my_job(target, user_id: int, edit: bool = False):
    try:
        job_data = get_user_job(user_id)
        job_key = job_data["job"]
        job = JOBS.get(job_key)
        if not job:
            await _render_main_menu(target, user_id, edit)
            return

        lvl = _require_level(user_id)
        reward = calculate_reward(job_key, lvl["level"])
        exp_str = exp_range_str(job_key)
        bar = _xp_bar(lvl["xp"], lvl["xp_needed"])

        text = (
            "👔 <b>Моя работа</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"{job['emoji']} <b>{job['name']}</b>\n\n"
            f"⭐ Уровень аккаунта: <b>{lvl['level']}</b>\n"
            f"📈 EXP: <b>{_fmt(lvl['xp'])} / {_fmt(lvl['xp_needed'])}</b>\n"
            f"<code>{bar}</code>\n\n"
            f"💰 За смену: <b>{_fmt(reward)} UP</b>\n"
            f"📈 За смену: <b>{exp_str}</b>\n\n"
            "💡 Чтобы начать рабочий день — напишите:\n"
            "<b>Работать</b>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="❌ Уволиться", callback_data="jobs_fire_confirm")],
                [types.InlineKeyboardButton(text="◀️ Назад", callback_data="jobs_back")],
            ]
        )
        if edit and isinstance(target, types.CallbackQuery):
            await safe_edit(target.message, text, kb)
        else:
            await target.answer(text, parse_mode="HTML", reply_markup=kb)
    except Exception as e:
        logger.exception("_render_my_job failed: %s", e)


# ================== ВАКАНСИИ ==================
@router.callback_query(F.data == "jobs_vacancies")
async def cb_jobs_vacancies(callback: types.CallbackQuery, state: FSMContext):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        try:
            await state.clear()
        except Exception:
            pass

        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        job_data = get_user_job(uid)
        if job_data["job"]:
            job = JOBS.get(job_data["job"], {"emoji": "💼", "name": "—"})
            text = (
                "⚠️ <b>У вас уже есть работа</b>\n\n"
                f"💼 {job['emoji']} <b>{job['name']}</b>\n\n"
                "Чтобы выбрать другую — сначала увольтесь."
            )
            kb = types.InlineKeyboardMarkup(
                inline_keyboard=[
                    [types.InlineKeyboardButton(text="❌ Уволиться", callback_data="jobs_fire_confirm")],
                    [types.InlineKeyboardButton(text="◀️ Назад", callback_data="jobs_back")],
                ]
            )
            await safe_edit(callback.message, text, kb)
            return

        lvl = _require_level(uid)
        acc_level = lvl["level"]
        available = get_available_jobs(acc_level)

        text = (
            "💼 <b>Вакансии</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"⭐ Ваш уровень: <b>{acc_level}</b>\n\n"
        )
        kb_rows = []
        for key, job in JOBS.items():
            if key in available:
                reward = calculate_reward(key, acc_level)
                kb_rows.append([types.InlineKeyboardButton(
                    text=f"{job['emoji']} {job['name']} · {_fmt(reward)} UP",
                    callback_data=f"job_select_{key}",
                )])
            else:
                kb_rows.append([types.InlineKeyboardButton(
                    text=f"🔒 {job['emoji']} {job['name']} · с {job['level_req']} ур.",
                    callback_data="jobs_locked",
                )])
        kb_rows.append([types.InlineKeyboardButton(text="◀️ Назад", callback_data="jobs_back")])
        kb = types.InlineKeyboardMarkup(inline_keyboard=kb_rows)
        await safe_edit(callback.message, text, kb)
    except Exception as e:
        logger.exception("cb_jobs_vacancies failed: %s", e)


@router.callback_query(F.data == "jobs_locked")
async def cb_jobs_locked(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer("🔒 Эта работа пока недоступна. Прокачайте уровень.", show_alert=True)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_jobs_locked failed: %s", e)


# ================== ВЫБОР ==================
@router.callback_query(F.data.startswith("job_select_"))
async def cb_job_select(callback: types.CallbackQuery, state: FSMContext):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        job_key = (callback.data or "").replace("job_select_", "")
        job = JOBS.get(job_key)
        if not job:
            return

        job_data = get_user_job(uid)
        if job_data["job"]:
            try:
                await callback.answer("У вас уже есть работа", show_alert=True)
            except Exception:
                pass
            return

        lvl = _require_level(uid)
        if lvl["level"] < job["level_req"]:
            try:
                await callback.answer(f"Нужен уровень {job['level_req']}", show_alert=True)
            except Exception:
                pass
            return

        reward = calculate_reward(job_key, lvl["level"])
        exp_str = exp_range_str(job_key)
        text = (
            f"{job['emoji']} <b>{job['name']}</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"📊 Требуется уровень: <b>{job['level_req']}</b>\n"
            f"💰 За смену: <b>{_fmt(reward)} UP</b>\n"
            f"📈 За смену: <b>{exp_str}</b>\n\n"
            "Устроиться на эту работу?"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="💼 Устроиться", callback_data=f"job_hire_{job_key}")],
                [types.InlineKeyboardButton(text="◀️ Назад", callback_data="jobs_vacancies")],
            ]
        )
        await safe_edit(callback.message, text, kb)
    except Exception as e:
        logger.exception("cb_job_select failed: %s", e)


# ================== УСТРОЙСТВО ==================
@router.callback_query(F.data.startswith("job_hire_"))
async def cb_job_hire(callback: types.CallbackQuery, state: FSMContext):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        job_key = (callback.data or "").replace("job_hire_", "")
        job = JOBS.get(job_key)
        if not job:
            return

        if get_user_job(uid)["job"]:
            try:
                await callback.answer("У вас уже есть работа", show_alert=True)
            except Exception:
                pass
            return

        lvl = _require_level(uid)
        if lvl["level"] < job["level_req"]:
            try:
                await callback.answer(f"Нужен уровень {job['level_req']}", show_alert=True)
            except Exception:
                pass
            return

        set_user_job(uid, job_key)
        add_job_history(uid, job_key, "hired", 0, 0, "Устроился")
        _job_log(uid, callback.from_user, "hired", extra_detail=f"job={job_key}")

        text = (
            "✅ <b>Вы устроились на работу</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"💼 Профессия: {job['emoji']} <b>{job['name']}</b>\n\n"
            "💡 Чтобы начать рабочий день — напишите:\n"
            "<b>Работать</b>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="👔 К работе", callback_data="jobs_back")]]
        )
        await safe_edit(callback.message, text, kb)
        try:
            await callback.answer("Устроились")
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_job_hire failed: %s", e)


# ================== «РАБОТАТЬ» ==================
@router.message(F.text.casefold().in_({"работать", "work", "⚒ работать"}))
async def cmd_work(message: types.Message, state: FSMContext):
    try:
        uid = message.from_user.id if message.from_user else None
        if not uid:
            return
        if not check_user_registered(uid):
            if message.chat.type == "private":
                await message.answer(
                    "❌ <b>Вы еще не зарегистрированы!</b>",
                    parse_mode="HTML",
                )
            return

        job_data = get_user_job(uid)
        if not job_data["job"]:
            await message.answer(
                "❌ <b>Вы сейчас нигде не работаете</b>\n\n"
                "💡 Напишите <b>Работа</b>, чтобы выбрать профессию.",
                parse_mode="HTML",
            )
            return

        now = int(time.time())
        last = int(job_data["last_work"] or 0)
        if now - last < COOLDOWN_SECONDS:
            remaining = COOLDOWN_SECONDS - (now - last)
            await message.answer(
                "⏳ <b>Рабочий день ещё не окончен</b>\n\n"
                f"Следующая смена через: <b>{_fmt_time(remaining)}</b>",
                parse_mode="HTML",
            )
            return

        if uid in _active_users:
            await message.answer("⏳ Подождите, работа уже выполняется...")
            return

        _active_users.add(uid)
        try:
            await state.update_data(job_key=job_data["job"], stage=1)
            await state.set_state(JobStates.playing)
            await _show_stage(message, uid, state)
        finally:
            _active_users.discard(uid)
    except Exception as e:
        logger.exception("cmd_work failed: %s", e)


# ================== ЭТАП ==================
async def _show_stage(message, user_id: int, state: FSMContext):
    try:
        data = await state.get_data()
        job_key = data.get("job_key")
        stage = data.get("stage", 1)
        if stage > 5:
            await _finish_success(message, user_id, state)
            return

        job = JOBS.get(job_key)
        stages = MINI_GAMES.get(job_key, [])
        if not job or stage > len(stages):
            await _finish_success(message, user_id, state)
            return

        stage_data = stages[stage - 1]
        correct = stage_data["correct"]
        wrong_list = stage_data["wrong"][:5]
        options = [correct] + wrong_list
        random.shuffle(options)
        correct_index = options.index(correct)
        await state.update_data(correct_index=correct_index, stage=stage)

        text = (
            f"{job['emoji']} <b>Этап {stage}/5</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"{stage_data['text']}\n\n"
            "Выберите правильный вариант:"
        )
        row1, row2 = [], []
        for i, opt in enumerate(options):
            btn = types.InlineKeyboardButton(text=opt, callback_data=f"stage_ans_{i}")
            (row1 if i < 3 else row2).append(btn)
        kb = types.InlineKeyboardMarkup(inline_keyboard=[r for r in (row1, row2) if r])
        await safe_edit(message, text, kb)
    except Exception as e:
        logger.exception("_show_stage failed: %s", e)


@router.callback_query(F.data.startswith("stage_ans_"), JobStates.playing)
async def cb_stage_answer(callback: types.CallbackQuery, state: FSMContext):
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            try:
                await callback.answer()
            except Exception:
                pass
            return

        data = await state.get_data()
        job_key = data.get("job_key")
        correct_index = data.get("correct_index")
        stage = data.get("stage", 1)

        if not job_key:
            try:
                await callback.answer("Игра не найдена", show_alert=True)
            except Exception:
                pass
            return

        try:
            answer_index = int((callback.data or "").replace("stage_ans_", ""))
        except ValueError:
            try:
                await callback.answer()
            except Exception:
                pass
            return

        if answer_index == correct_index:
            if stage >= 5:
                await state.update_data(stage=6)
                try:
                    await callback.answer("Готово")
                except Exception:
                    pass
                await _finish_success(callback.message, uid, state)
            else:
                await state.update_data(stage=stage + 1)
                try:
                    await callback.answer("Правильно")
                except Exception:
                    pass
                await safe_edit(callback.message, "✅ <b>Правильно!</b>\n\nПереход к следующему этапу...", None)
                await asyncio.sleep(0.6)
                await _show_stage(callback.message, uid, state)
        else:
            try:
                await callback.answer("Ошибка")
            except Exception:
                pass
            await _finish_fail(callback.message, uid, state)
    except Exception as e:
        logger.exception("cb_stage_answer failed: %s", e)


# ================== ФИНАЛ ==================
async def _finish_success(message, user_id: int, state: FSMContext):
    try:
        data = await state.get_data()
        job_key = data.get("job_key")
        job = JOBS.get(job_key)
        if not job:
            await state.clear()
            return

        lvl_before = _require_level(user_id)
        reward = calculate_reward(job_key, lvl_before["level"])

        # EXP за смену — случайный в диапазоне профессии
        exp_amount = roll_exp(job_key)

        # начисляем деньги
        update_balance(user_id, reward)

        # EXP в общий уровень
        exp_res = add_exp(user_id, exp_amount)

        # cooldown
        update_last_work(user_id, int(time.time()))

        add_job_history(user_id, job_key, "completed", reward, exp_amount, "Успешно 5/5")
        _job_log(
            user_id,
            getattr(message, "from_user", None),
            "work_done",
            balance_before=_balance(user_id) - reward,
            balance_after=_balance(user_id),
            extra_detail=f"job={job_key} reward={reward} exp={exp_amount}",
        )

        await state.clear()

        text = (
            "🎉 <b>Работа завершена</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"{job['emoji']} <b>{job['name']}</b>\n"
            f"✅ Пройдено: <b>5/5</b>\n\n"
            f"💰 Награда: <b>+{_fmt(reward)} UP</b>\n"
            f"📈 Опыт: <b>+{exp_amount} EXP</b>\n"
            f"💵 Баланс: <b>{_fmt(_balance(user_id))} UP</b>"
        )

        if exp_res.get("leveled_up"):
            new_lvl = exp_res["new_level"]
            new_xp = exp_res["xp"]
            new_need = exp_res["xp_needed"]

            text += (
                "\n\n🎉 <b>Новый уровень!</b>\n\n"
                f"⭐ Вы достигли <b>{new_lvl}</b> уровня\n"
                f"📈 EXP: <b>{_fmt(new_xp)} / {_fmt(new_need)}</b>"
            )

            unlocked_now = []
            for k, j in JOBS.items():
                if j["level_req"] == new_lvl:
                    unlocked_now.append(f"{j['emoji']} {j['name']}")
            if unlocked_now:
                text += "\n\n🔓 <b>Новая профессия:</b>\n" + "\n".join(unlocked_now)

        text += "\n\n⏳ Следующая смена через <b>10 минут</b>."

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="👔 К работе", callback_data="jobs_back")]]
        )
        await safe_edit(message, text, kb)
    except Exception as e:
        logger.exception("_finish_success failed: %s", e)
        try:
            await state.clear()
        except Exception:
            pass


async def _finish_fail(message, user_id: int, state: FSMContext):
    try:
        data = await state.get_data()
        job_key = data.get("job_key")
        job = JOBS.get(job_key, {"emoji": "💼", "name": "Работа"})

        update_last_work(user_id, int(time.time()))
        add_job_history(user_id, job_key, "failed", 0, 0, "Провалена")
        _job_log(
            user_id,
            getattr(message, "from_user", None),
            "work_failed",
            extra_detail=f"job={job_key}",
        )

        await state.clear()

        text = (
            "❌ <b>Работа провалена</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"{job['emoji']} <b>{job['name']}</b>\n\n"
            f"💰 Награда: <b>0 UP</b>\n\n"
            "⏳ Следующая смена через <b>10 минут</b>."
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="👔 К работе", callback_data="jobs_back")]]
        )
        await safe_edit(message, text, kb)
    except Exception as e:
        logger.exception("_finish_fail failed: %s", e)
        try:
            await state.clear()
        except Exception:
            pass


# ================== УВОЛЬНЕНИЕ ==================
@router.callback_query(F.data == "jobs_fire_confirm")
async def cb_jobs_fire_confirm(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        job_data = get_user_job(uid)
        if not job_data["job"]:
            try:
                await callback.answer("У вас нет работы", show_alert=True)
            except Exception:
                pass
            return

        job = JOBS.get(job_data["job"], {"emoji": "💼", "name": "—"})
        text = (
            "⚠️ <b>Увольнение</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            "Вы действительно хотите уволиться?\n\n"
            f"💼 {job['emoji']} <b>{job['name']}</b>\n"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="✅ Да, уволиться", callback_data="jobs_fire_yes")],
                [types.InlineKeyboardButton(text="❌ Отмена", callback_data="jobs_back")],
            ]
        )
        await safe_edit(callback.message, text, kb)
    except Exception as e:
        logger.exception("cb_jobs_fire_confirm failed: %s", e)


@router.callback_query(F.data == "jobs_fire_yes")
async def cb_jobs_fire_yes(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        job_data = get_user_job(uid)
        if job_data["job"]:
            add_job_history(uid, job_data["job"], "fired", 0, 0, "Уволился")
            _job_log(uid, callback.from_user, "fired", extra_detail=f"job={job_data['job']}")
            fire_user(uid)

        text = (
            "✅ <b>Вы уволились</b>\n\n"
            "💡 Напишите <b>Работа</b>, чтобы выбрать новую профессию."
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="💼 К профессиям", callback_data="jobs_back")]]
        )
        await safe_edit(callback.message, text, kb)
        try:
            await callback.answer("Уволились")
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_jobs_fire_yes failed: %s", e)


# ================== НАЗАД ==================
@router.callback_query(F.data == "jobs_back")
async def cb_jobs_back(callback: types.CallbackQuery, state: FSMContext):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        try:
            await state.clear()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        job_data = get_user_job(uid)
        if job_data["job"]:
            await _render_my_job(callback, uid, edit=True)
        else:
            await _render_main_menu(callback, uid, edit=True)
    except Exception as e:
        logger.exception("cb_jobs_back failed: %s", e)