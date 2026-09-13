import time
import random
import asyncio
import re
import logging
from pathlib import Path
from aiogram import Router, types, F
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import FSInputFile

from database import db_conn, check_user_registered, get_user, DEFAULT_NICK, log_action

logger = logging.getLogger(__name__)
router = Router()

PHOTOS_DIR = Path(__file__).resolve().parent / "photos"

NPC_INTERVAL = 1800
NPC_ERROR_BACKOFF = 300
MAX_VIDEO_DURATION = 60
PROCESSING_TTL = 30


# ================== МНОЖИТЕЛИ ТЕЛЕФОНОВ ==================
PHONE_MULTIPLIERS = {
    "nokia_3310":     None,
    "redmi_note_13":  1.0,
    "nothing_3":      1.5,
    "rog_phone_9":    2.0,
    "iphone_17_pm":   3.0,
    "galaxy_zfold7":  4.0,
}

PHONE_NAMES = {
    "nokia_3310":    "Nokia 3310",
    "redmi_note_13": "Xiaomi Redmi Note 13",
    "nothing_3":     "Nothing Phone (3)",
    "rog_phone_9":   "Asus ROG Phone 9",
    "iphone_17_pm":  "iPhone 17 Pro Max",
    "galaxy_zfold7": "Samsung Galaxy Z Fold 7",
}

MEDIA_PHOTO = "photo"
MEDIA_VIDEO = "video"

MEDIA_EMOJI = {
    MEDIA_PHOTO: "📷",
    MEDIA_VIDEO: "🎥",
}

MEDIA_LABEL = {
    MEDIA_PHOTO: "Фото",
    MEDIA_VIDEO: "Видео",
}

# Защита от повторной обработки
_processing_locks = set()


# ================== FSM ==================
class YouTubeStates(StatesGroup):
    yt_name = State()
    yt_surname = State()
    yt_email = State()
    yt_avatar = State()

    yt_post_media = State()
    yt_post_desc = State()
    yt_confirm = State()

    yt_comment = State()


# ================== БД ==================
def _init_yt_db():
    try:
        with db_conn() as conn:
            cur = conn.cursor()

            cur.execute("""
                CREATE TABLE IF NOT EXISTS youtube_accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER UNIQUE,
                    name TEXT,
                    surname TEXT,
                    email TEXT UNIQUE,
                    avatar TEXT,
                    subscribers INTEGER DEFAULT 0,
                    likes INTEGER DEFAULT 0,
                    views INTEGER DEFAULT 0,
                    created_at INTEGER
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS youtube_videos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    title TEXT,
                    description TEXT,
                    cover TEXT,
                    views INTEGER DEFAULT 0,
                    likes INTEGER DEFAULT 0,
                    comments INTEGER DEFAULT 0,
                    created_at INTEGER,
                    last_activity INTEGER
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS youtube_subscriptions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    channel_id INTEGER,
                    created_at INTEGER,
                    UNIQUE(user_id, channel_id)
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS youtube_video_likes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    video_id INTEGER,
                    created_at INTEGER,
                    UNIQUE(user_id, video_id)
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS youtube_video_views (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    video_id INTEGER,
                    created_at INTEGER,
                    UNIQUE(user_id, video_id)
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS youtube_comments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    video_id INTEGER,
                    comment TEXT,
                    created_at INTEGER
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS youtube_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    action_type TEXT,
                    details TEXT,
                    created_at INTEGER
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS youtube_tags (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    post_id INTEGER,
                    user_id INTEGER,
                    tag TEXT,
                    created_at INTEGER
                )
            """)

            # миграция: media_type, media_file_id
            cur.execute("PRAGMA table_info(youtube_videos)")
            cols = {c[1] for c in cur.fetchall()}
            if "media_type" not in cols:
                try:
                    cur.execute("ALTER TABLE youtube_videos ADD COLUMN media_type TEXT DEFAULT 'photo'")
                except Exception as e:
                    logger.exception("миграция media_type: %s", e)
            if "media_file_id" not in cols:
                try:
                    cur.execute("ALTER TABLE youtube_videos ADD COLUMN media_file_id TEXT")
                except Exception as e:
                    logger.exception("миграция media_file_id: %s", e)

            try:
                cur.execute("""
                    UPDATE youtube_videos
                    SET media_file_id = cover
                    WHERE (media_file_id IS NULL OR media_file_id = '')
                      AND cover IS NOT NULL AND cover != ''
                """)
                cur.execute("""
                    UPDATE youtube_videos
                    SET media_type = 'photo'
                    WHERE media_type IS NULL OR media_type = ''
                """)
            except Exception:
                pass

            cur.execute("CREATE INDEX IF NOT EXISTS idx_yt_videos_user ON youtube_videos(user_id, id DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_yt_videos_created ON youtube_videos(created_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_yt_comments_video ON youtube_comments(video_id, id DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_yt_subs_user ON youtube_subscriptions(user_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_yt_subs_channel ON youtube_subscriptions(channel_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_yt_tags_post ON youtube_tags(post_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_yt_tags_tag ON youtube_tags(tag)")

        logger.info("youtube: таблицы готовы")
    except Exception as e:
        logger.exception("init_youtube_db failed: %s", e)


_init_yt_db()


# ================== ХЭШТЕГИ ==================
def _extract_tags(text: str) -> list:
    try:
        if not text:
            return []
        found = re.findall(r"#([A-Za-zА-Яа-я0-9_]{2,32})", text)
        seen = []
        for t in found:
            t_low = t.lower()
            if t_low not in seen:
                seen.append(t_low)
            if len(seen) >= 10:
                break
        return seen
    except Exception:
        return []


def _save_hashtags(post_id: int, user_id: int, text: str) -> int:
    try:
        tags = _extract_tags(text)
        if not tags:
            return 0
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            for t in tags:
                cur.execute(
                    "INSERT INTO youtube_tags (post_id, user_id, tag, created_at) VALUES (?, ?, ?, ?)",
                    (post_id, user_id, t, _now())
                )
        return len(tags)
    except Exception as e:
        logger.exception("_save_hashtags failed: %s", e)
        return 0


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


def _nick(user_id: int) -> str:
    try:
        u = get_user(user_id) or {}
        return u.get("nickname") or DEFAULT_NICK
    except Exception:
        return DEFAULT_NICK


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


def _yt_log(user_id: int, user, action: str, **kwargs):
    try:
        log_action(
            user_id=user_id,
            username=getattr(user, "username", None),
            display_name=getattr(user, "full_name", None),
            action_type="YOUTUBE",
            extra=action,
            **kwargs,
        )
    except Exception:
        pass


def _add_history(user_id: int, action: str, details: str = ""):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO youtube_history (user_id, action_type, details, created_at) VALUES (?, ?, ?, ?)",
                (user_id, action, details, _now()),
            )
    except Exception as e:
        logger.exception("_add_history failed: %s", e)


# ================== DEVICES / SIM ==================
def get_user_phone_key(user_id: int):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT phone, phone_level FROM user_devices WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row or not row[0]:
                return None, None
            return row[1], row[0]
    except Exception as e:
        logger.exception("get_user_phone_key failed: %s", e)
        return None, None


def get_phone_multiplier(phone_key):
    if not phone_key:
        return None
    return PHONE_MULTIPLIERS.get(phone_key)


def get_unlimited_active(user_id: int) -> bool:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT sim_id, active FROM user_sim WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row or not row[1]:
                return False
            cur.execute("SELECT internet_expire FROM sim_cards WHERE id = ? AND status = 'active'", (row[0],))
            srow = cur.fetchone()
            if not srow:
                return False
            return int(srow[0] or 0) > _now()
    except Exception as e:
        logger.exception("get_unlimited_active failed: %s", e)
        return False


# ================== YOUTUBE КАНАЛ ==================
def get_youtube_channel(user_id: int):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM youtube_accounts WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row:
                return None
            cols = [d[0] for d in cur.description]
            return dict(zip(cols, row))
    except Exception as e:
        logger.exception("get_youtube_channel failed: %s", e)
        return None


def get_youtube_channel_by_id(channel_id: int):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM youtube_accounts WHERE id = ?", (channel_id,))
            row = cur.fetchone()
            if not row:
                return None
            cols = [d[0] for d in cur.description]
            return dict(zip(cols, row))
    except Exception as e:
        logger.exception("get_youtube_channel_by_id failed: %s", e)
        return None


def _create_channel(user_id: int, name: str, surname: str, email: str, avatar: str) -> int:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")

            cur.execute("SELECT id FROM youtube_accounts WHERE user_id = ?", (user_id,))
            if cur.fetchone():
                return 0

            cur.execute("SELECT id FROM youtube_accounts WHERE email = ?", (email,))
            if cur.fetchone():
                return -1

            cur.execute("""
                INSERT INTO youtube_accounts
                (user_id, name, surname, email, avatar, subscribers, likes, views, created_at)
                VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?)
            """, (user_id, name, surname, email, avatar, _now()))
            return cur.lastrowid
    except Exception as e:
        logger.exception("_create_channel failed: %s", e)
        return 0


# ================== ГЛАВНОЕ МЕНЮ ==================
@router.message(F.text.casefold().in_({"ютуб", "youtube", "📺 youtube"}))
async def cmd_youtube(message: types.Message):
    try:
        if not await _require_reg(message):
            return
        uid = message.from_user.id

        # только ЛС
        if message.chat.type != "private":
            try:
                await message.answer(
                    "📺 YouTube доступен только в личных сообщениях бота.\n\n"
                    "💬 Откройте личный чат с ботом и напишите «Ютуб».",
                )
            except Exception:
                pass
            return

        _yt_log(uid, message.from_user, "open_youtube", extra="private")

        phone_key, phone_name = get_user_phone_key(uid)
        if not phone_key:
            await message.answer(
                "📱 <b>У вас нет телефона</b>\n\n"
                "Купите телефон в <b>Техномаркет</b>, чтобы пользоваться YouTube.",
                parse_mode="HTML",
            )
            return

        if get_phone_multiplier(phone_key) is None:
            await message.answer(
                f"📱 <b>{_esc(phone_name)}</b>\n\n"
                "Ваш телефон <b>не поддерживает</b> приложение YouTube.\n\n"
                "💡 Купите более современный телефон в <b>Техномаркет</b>.",
                parse_mode="HTML",
            )
            return

        if not get_unlimited_active(uid):
            await message.answer(
                "📡 <b>Нет подключения к интернету</b>\n\n"
                "Для YouTube нужен активный тариф.\n\n"
                "💡 Подключите <b>Безлимит</b>: Симкарта → Тарифы.",
                parse_mode="HTML",
            )
            return

        channel = get_youtube_channel(uid)
        if not channel:
            await message.answer(
                "🎬 <b>YouTube</b>\n\n"
                "У вас ещё нет канала.\n\n"
                "💡 Для создания укажите имя, фамилию, почту "
                "<code>username@upgrade.com</code> и аватар.",
                parse_mode="HTML",
                reply_markup=types.InlineKeyboardMarkup(
                    inline_keyboard=[[types.InlineKeyboardButton(text="🎬 Создать канал", callback_data="yt_create_channel")]]
                ),
            )
            return

        await _show_yt_menu(message, uid)
    except Exception as e:
        logger.exception("cmd_youtube failed: %s", e)


def _menu_text(channel: dict) -> str:
    name = channel.get("name") or ""
    surname = channel.get("surname") or ""
    email = channel.get("email") or "—"
    subs = int(channel.get("subscribers") or 0)
    likes = int(channel.get("likes") or 0)
    views = int(channel.get("views") or 0)

    return (
        "🎬 <b>YouTube</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        f"📺 <b>{_esc(name)} {_esc(surname)}</b>\n"
        f"📧 {_esc(email)}\n\n"
        f"❤️ {_fmt(likes)}   👁 {_fmt(views)}   👥 {_fmt(subs)}"
    )


def _menu_kb() -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="➕ Создать публикацию", callback_data="yt_create_video")],
            [types.InlineKeyboardButton(text="🎞 Мои публикации", callback_data="yt_my_videos")],
            [types.InlineKeyboardButton(text="▶️ Смотреть видео", callback_data="yt_watch")],
            [types.InlineKeyboardButton(text="👥 Подписки", callback_data="yt_friends"),
             types.InlineKeyboardButton(text="🏆 Топ", callback_data="yt_top")],
        ]
    )


async def _show_yt_menu(target, user_id: int):
    try:
        channel = get_youtube_channel(user_id)
        if not channel:
            return
        text = _menu_text(channel)
        kb = _menu_kb()

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
        logger.exception("_show_yt_menu failed: %s", e)


@router.callback_query(F.data == "yt_menu")
async def cb_yt_menu(callback: types.CallbackQuery, state: FSMContext):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        try:
            await state.clear()
        except Exception:
            pass
        if not check_user_registered(callback.from_user.id):
            return
        await _show_yt_menu(callback, callback.from_user.id)
    except Exception as e:
        logger.exception("cb_yt_menu failed: %s", e)


# ================== СОЗДАНИЕ КАНАЛА ==================
@router.callback_query(F.data == "yt_create_channel")
async def cb_yt_create_channel(callback: types.CallbackQuery, state: FSMContext):
    try:
        try:
            await callback.answer()
        except Exception:
            pass

        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        try:
            chat_type = callback.message.chat.type
        except Exception:
            chat_type = None
        if chat_type != "private":
            return

        if get_youtube_channel(uid):
            return

        await state.set_state(YouTubeStates.yt_name)
        text = (
            "🎬 <b>Создание канала</b>\n"
            "Шаг 1 из 4\n\n"
            "✍️ Введите <b>имя</b>:\n"
            "<i>От 2 до 30 символов</i>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="❌ Отмена", callback_data="yt_cancel")]]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            try:
                await callback.message.answer(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                pass
    except Exception as e:
        logger.exception("cb_yt_create_channel failed: %s", e)


@router.callback_query(F.data == "yt_cancel")
async def cb_yt_cancel(callback: types.CallbackQuery, state: FSMContext):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        try:
            await state.clear()
        except Exception:
            pass
        try:
            await callback.message.delete()
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_yt_cancel failed: %s", e)


@router.message(YouTubeStates.yt_name)
async def yt_name(message: types.Message, state: FSMContext):
    try:
        if not await _require_reg(message):
            await state.clear()
            return
        raw = (message.text or "").strip()
        if len(raw) < 2 or len(raw) > 30:
            await message.answer("⚠️ Имя: от 2 до 30 символов.")
            return
        if any(c in raw for c in "<>&"):
            await message.answer("⚠️ Без символов &lt; &gt; &amp;")
            return
        await state.update_data(yt_name=raw)
        await state.set_state(YouTubeStates.yt_surname)
        await message.answer(
            "🎬 <b>Создание канала</b>\nШаг 2 из 4\n\n"
            "✍️ Введите <b>фамилию</b>:",
            parse_mode="HTML",
        )
    except Exception as e:
        logger.exception("yt_name failed: %s", e)


@router.message(YouTubeStates.yt_surname)
async def yt_surname(message: types.Message, state: FSMContext):
    try:
        if not await _require_reg(message):
            await state.clear()
            return
        raw = (message.text or "").strip()
        if len(raw) < 2 or len(raw) > 30:
            await message.answer("⚠️ Фамилия: от 2 до 30 символов.")
            return
        if any(c in raw for c in "<>&"):
            await message.answer("⚠️ Без символов &lt; &gt; &amp;")
            return
        await state.update_data(yt_surname=raw)
        await state.set_state(YouTubeStates.yt_email)
        await message.answer(
            "🎬 <b>Создание канала</b>\nШаг 3 из 4\n\n"
            "📧 Введите <b>почту</b>:\n"
            "<i>Формат: username@upgrade.com</i>",
            parse_mode="HTML",
        )
    except Exception as e:
        logger.exception("yt_surname failed: %s", e)


@router.message(YouTubeStates.yt_email)
async def yt_email(message: types.Message, state: FSMContext):
    try:
        if not await _require_reg(message):
            await state.clear()
            return
        email = (message.text or "").strip().lower()

        if not re.match(r'^[a-z0-9._%+-]{2,30}@upgrade\.com$', email):
            await message.answer(
                "⚠️ Разрешена только почта формата\n"
                "<code>username@upgrade.com</code>",
                parse_mode="HTML",
            )
            return

        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("SELECT 1 FROM youtube_accounts WHERE email = ?", (email,))
                if cur.fetchone():
                    await message.answer("⚠️ Эта почта уже используется.")
                    return
        except Exception:
            pass

        await state.update_data(yt_email=email)
        await state.set_state(YouTubeStates.yt_avatar)
        await message.answer(
            "🎬 <b>Создание канала</b>\nШаг 4 из 4\n\n"
            "🖼 Отправьте <b>аватар</b> (фото):",
            parse_mode="HTML",
        )
    except Exception as e:
        logger.exception("yt_email failed: %s", e)


@router.message(YouTubeStates.yt_avatar, F.photo)
async def yt_avatar(message: types.Message, state: FSMContext):
    try:
        if not await _require_reg(message):
            await state.clear()
            return

        photo = message.photo[-1]
        file_id = photo.file_id
        data = await state.get_data()
        uid = message.from_user.id

        name = data.get("yt_name") or ""
        surname = data.get("yt_surname") or ""
        email = data.get("yt_email") or ""

        result = _create_channel(uid, name, surname, email, file_id)
        if result == -1:
            await message.answer("⚠️ Эта почта уже используется. Начните заново.")
            await state.clear()
            return
        if result == 0:
            await message.answer("⚠️ Ошибка создания канала.")
            await state.clear()
            return

        await state.clear()
        _add_history(uid, "Создание канала", f"{name} {surname}")
        _yt_log(uid, message.from_user, "create_channel", extra=f"email={email}")

        text = (
            "🎉 <b>Канал создан</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"📺 <b>{_esc(name)} {_esc(surname)}</b>\n"
            f"📧 {_esc(email)}\n\n"
            "❤️ 0   👁 0   👥 0"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="📺 Открыть YouTube", callback_data="yt_menu")]]
        )
        await message.answer(text, parse_mode="HTML", reply_markup=kb)
    except Exception as e:
        logger.exception("yt_avatar failed: %s", e)
        try:
            await state.clear()
        except Exception:
            pass


@router.message(YouTubeStates.yt_avatar)
async def yt_avatar_invalid(message: types.Message, state: FSMContext):
    try:
        await message.answer("⚠️ Отправьте именно <b>фото</b>.", parse_mode="HTML")
    except Exception as e:
        logger.exception("yt_avatar_invalid failed: %s", e)


# ================== ПУБЛИКАЦИИ ==================
def _create_post(user_id: int, title: str, description: str, media_type: str,
                 media_file_id: str, multiplier: float) -> int:
    try:
        start_views = int(random.randint(5, 20) * multiplier)
        start_likes = random.randint(1, 5)

        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")

            cur.execute("""
                INSERT INTO youtube_videos
                (user_id, title, description, cover, media_type, media_file_id,
                 views, likes, comments, created_at, last_activity)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            """, (user_id, title, description, media_file_id, media_type, media_file_id,
                  start_views, start_likes, _now(), _now()))
            post_id = cur.lastrowid

            cur.execute("""
                UPDATE youtube_accounts
                SET views = views + ?, likes = likes + ?
                WHERE user_id = ?
            """, (start_views, start_likes, user_id))

        return post_id
    except Exception as e:
        logger.exception("_create_post failed: %s", e)
        return 0


def get_post_by_id(post_id: int):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT id, user_id, title, description, cover,
                       media_type, media_file_id, views, likes, comments, created_at
                FROM youtube_videos WHERE id = ?
            """, (post_id,))
            row = cur.fetchone()
        if not row:
            return None
        return {
            "id": row[0],
            "user_id": row[1],
            "title": row[2],
            "description": row[3],
            "cover": row[4],
            "media_type": row[5] or MEDIA_PHOTO,
            "media_file_id": row[6] or row[4],
            "views": int(row[7] or 0),
            "likes": int(row[8] or 0),
            "comments": int(row[9] or 0),
            "created_at": int(row[10] or 0),
        }
    except Exception as e:
        logger.exception("get_post_by_id failed: %s", e)
        return None


def get_user_posts(user_id: int, limit: int = 10):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT id, title, media_type, views, likes, comments, created_at
                FROM youtube_videos
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT ?
            """, (user_id, limit))
            return cur.fetchall() or []
    except Exception as e:
        logger.exception("get_user_posts failed: %s", e)
        return []


def get_feed_post(offset: int, exclude_user_id: int = None):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            if exclude_user_id:
                cur.execute("""
                    SELECT id FROM youtube_videos
                    WHERE user_id != ?
                    ORDER BY created_at DESC
                    LIMIT 1 OFFSET ?
                """, (exclude_user_id, offset))
            else:
                cur.execute("""
                    SELECT id FROM youtube_videos
                    ORDER BY created_at DESC
                    LIMIT 1 OFFSET ?
                """, (offset,))
            row = cur.fetchone()
        if not row:
            return None
        return get_post_by_id(row[0])
    except Exception as e:
        logger.exception("get_feed_post failed: %s", e)
        return None


def _register_view(viewer_id: int, post_id: int, owner_id: int):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            cur.execute("SELECT 1 FROM youtube_video_views WHERE user_id = ? AND video_id = ?",
                        (viewer_id, post_id))
            if cur.fetchone():
                return
            cur.execute("""
                INSERT INTO youtube_video_views (user_id, video_id, created_at)
                VALUES (?, ?, ?)
            """, (viewer_id, post_id, _now()))
            cur.execute("UPDATE youtube_videos SET views = views + 1 WHERE id = ?", (post_id,))
            cur.execute("UPDATE youtube_accounts SET views = views + 1 WHERE user_id = ?", (owner_id,))
    except Exception as e:
        logger.exception("_register_view failed: %s", e)


def _toggle_like(user_id: int, post_id: int, owner_id: int, add: bool) -> bool:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")

            if add:
                cur.execute("SELECT 1 FROM youtube_video_likes WHERE user_id = ? AND video_id = ?",
                            (user_id, post_id))
                if cur.fetchone():
                    return False
                cur.execute("""
                    INSERT INTO youtube_video_likes (user_id, video_id, created_at)
                    VALUES (?, ?, ?)
                """, (user_id, post_id, _now()))
                cur.execute("UPDATE youtube_videos SET likes = likes + 1 WHERE id = ?", (post_id,))
                cur.execute("UPDATE youtube_accounts SET likes = likes + 1 WHERE user_id = ?", (owner_id,))
            else:
                cur.execute("DELETE FROM youtube_video_likes WHERE user_id = ? AND video_id = ?",
                            (user_id, post_id))
                if cur.rowcount == 0:
                    return False
                cur.execute("UPDATE youtube_videos SET likes = CASE WHEN likes > 0 THEN likes - 1 ELSE 0 END WHERE id = ?", (post_id,))
                cur.execute("UPDATE youtube_accounts SET likes = CASE WHEN likes > 0 THEN likes - 1 ELSE 0 END WHERE user_id = ?", (owner_id,))
        return True
    except Exception as e:
        logger.exception("_toggle_like failed: %s", e)
        return False


def _toggle_sub(user_id: int, channel_id: int, add: bool) -> bool:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")

            if add:
                cur.execute("SELECT 1 FROM youtube_subscriptions WHERE user_id = ? AND channel_id = ?",
                            (user_id, channel_id))
                if cur.fetchone():
                    return False
                cur.execute("""
                    INSERT INTO youtube_subscriptions (user_id, channel_id, created_at)
                    VALUES (?, ?, ?)
                """, (user_id, channel_id, _now()))
                cur.execute("UPDATE youtube_accounts SET subscribers = subscribers + 1 WHERE id = ?", (channel_id,))
            else:
                cur.execute("DELETE FROM youtube_subscriptions WHERE user_id = ? AND channel_id = ?",
                            (user_id, channel_id))
                if cur.rowcount == 0:
                    return False
                cur.execute("UPDATE youtube_accounts SET subscribers = CASE WHEN subscribers > 0 THEN subscribers - 1 ELSE 0 END WHERE id = ?", (channel_id,))
        return True
    except Exception as e:
        logger.exception("_toggle_sub failed: %s", e)
        return False


def _is_liked(user_id: int, post_id: int) -> bool:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT 1 FROM youtube_video_likes WHERE user_id = ? AND video_id = ?",
                        (user_id, post_id))
            return cur.fetchone() is not None
    except Exception:
        return False


def _is_subbed(user_id: int, channel_id: int) -> bool:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT 1 FROM youtube_subscriptions WHERE user_id = ? AND channel_id = ?",
                        (user_id, channel_id))
            return cur.fetchone() is not None
    except Exception:
        return False


# ================== ОТПРАВКА / РЕДАКТИРОВАНИЕ ==================
async def _send_media(bot, chat_id: int, post: dict, caption: str, kb):
    try:
        mt = post.get("media_type") or MEDIA_PHOTO
        file_id = post.get("media_file_id") or post.get("cover")
        if not file_id:
            return await bot.send_message(chat_id, caption, parse_mode="HTML", reply_markup=kb)

        if mt == MEDIA_PHOTO:
            return await bot.send_photo(chat_id, photo=file_id, caption=caption, parse_mode="HTML", reply_markup=kb)
        if mt == MEDIA_VIDEO:
            return await bot.send_video(chat_id, video=file_id, caption=caption, parse_mode="HTML", reply_markup=kb)
        return await bot.send_photo(chat_id, photo=file_id, caption=caption, parse_mode="HTML", reply_markup=kb)
    except Exception as e:
        logger.exception("_send_media failed: %s", e)
        try:
            return await bot.send_message(chat_id, caption, parse_mode="HTML", reply_markup=kb)
        except Exception:
            return None


async def _edit_media(callback: types.CallbackQuery, post: dict, caption: str, kb) -> bool:
    try:
        msg = callback.message
        mt = post.get("media_type") or MEDIA_PHOTO
        file_id = post.get("media_file_id") or post.get("cover")

        if not file_id:
            try:
                await msg.edit_text(caption, parse_mode="HTML", reply_markup=kb)
                return True
            except Exception:
                return False

        from aiogram.types import InputMediaPhoto, InputMediaVideo

        if mt == MEDIA_PHOTO:
            try:
                await msg.edit_media(
                    media=InputMediaPhoto(media=file_id, caption=caption, parse_mode="HTML"),
                    reply_markup=kb,
                )
                return True
            except Exception:
                pass
        elif mt == MEDIA_VIDEO:
            try:
                await msg.edit_media(
                    media=InputMediaVideo(media=file_id, caption=caption, parse_mode="HTML"),
                    reply_markup=kb,
                )
                return True
            except Exception:
                pass

        try:
            await msg.delete()
        except Exception:
            pass
        await _send_media(callback.bot, msg.chat.id, post, caption, kb)
        return False
    except Exception as e:
        logger.exception("_edit_media failed: %s", e)
        return False


def _post_caption(post: dict, viewer_id: int, position: str = None) -> str:
    owner_id = post["user_id"]
    nick = _nick(owner_id)
    mt = post.get("media_type") or MEDIA_PHOTO
    label = MEDIA_LABEL.get(mt, "Публикация")
    emoji = MEDIA_EMOJI.get(mt, "📷")

    head = f"{emoji} <b>{_esc(post['title'])}</b>"
    if position:
        head = f"{head}\n<i>{position}</i>"

    text = (
        f"{head}\n"
        "━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"👤 <b>{_esc(nick)}</b>\n"
        f"🎯 {label}\n\n"
    )
    if post.get("description"):
        text += f"{_esc(post['description'])}\n\n"

    text += (
        f"❤️ {_fmt(post['likes'])}   👁 {_fmt(post['views'])}   💬 {_fmt(post['comments'])}"
    )
    return text


def _post_kb(post: dict, viewer_id: int, back_cb: str, next_cb: str = None) -> types.InlineKeyboardMarkup:
    owner_id = post["user_id"]
    rows = []

    if owner_id != viewer_id:
        liked = _is_liked(viewer_id, post["id"])
        like_text = "❤️ Убрать лайк" if liked else "🤍 Лайк"
        rows.append([types.InlineKeyboardButton(text=like_text, callback_data=f"yt_like_{post['id']}")])

        channel = get_youtube_channel(owner_id)
        if channel:
            subbed = _is_subbed(viewer_id, channel["id"])
            sub_text = "✅ Отписаться" if subbed else "➕ Подписаться"
            rows.append([types.InlineKeyboardButton(text=sub_text, callback_data=f"yt_sub_{post['id']}")])

    rows.append([types.InlineKeyboardButton(text="💬 Комментарии", callback_data=f"yt_comments_{post['id']}")])

    nav = []
    if next_cb:
        nav.append(types.InlineKeyboardButton(text="⏭️ Следующее", callback_data=next_cb))
    nav.append(types.InlineKeyboardButton(text="◀️ Назад", callback_data=back_cb))
    if nav:
        rows.append(nav)

    return types.InlineKeyboardMarkup(inline_keyboard=rows)


# ================== ЛЕНТА ==================
@router.callback_query(F.data == "yt_watch")
async def cb_yt_watch(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        await _render_feed(callback, uid, offset=0)
    except Exception as e:
        logger.exception("cb_yt_watch failed: %s", e)


async def _render_feed(target, uid: int, offset: int):
    post = get_feed_post(offset, exclude_user_id=uid)
    if not post:
        text = "🎬 <b>Лента пуста</b>\n\nПубликаций от других игроков пока нет."
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="◀️ Назад", callback_data="yt_menu")]]
        )
        try:
            await target.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            try:
                await target.message.answer(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                pass
        return

    if post["user_id"] != uid:
        _register_view(uid, post["id"], post["user_id"])
        post = get_post_by_id(post["id"]) or post

    caption = _post_caption(post, uid)
    kb = _post_kb(post, uid, back_cb="yt_menu", next_cb=f"yt_next_{offset + 1}")

    await _edit_media(target, post, caption, kb)


@router.callback_query(F.data.startswith("yt_next_"))
async def cb_yt_next(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        try:
            offset = int((callback.data or "").replace("yt_next_", ""))
        except ValueError:
            offset = 0

        post = get_feed_post(offset, exclude_user_id=uid)
        if not post:
            offset = 0

        await _render_feed(callback, uid, offset)
    except Exception as e:
        logger.exception("cb_yt_next failed: %s", e)


# ================== ЛАЙК / ПОДПИСКА ==================
@router.callback_query(F.data.startswith("yt_like_"))
async def cb_yt_like(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        try:
            post_id = int((callback.data or "").replace("yt_like_", ""))
        except ValueError:
            return

        post = get_post_by_id(post_id)
        if not post:
            return
        if post["user_id"] == uid:
            try:
                await callback.answer("Нельзя лайкать своё", show_alert=True)
            except Exception:
                pass
            return

        liked = _is_liked(uid, post_id)
        ok = _toggle_like(uid, post_id, post["user_id"], add=not liked)
        if ok:
            _yt_log(uid, callback.from_user, "like" if not liked else "unlike",
                    extra=f"post_id={post_id}")

        post = get_post_by_id(post_id)
        caption = _post_caption(post, uid)
        kb = _post_kb(post, uid, back_cb="yt_menu", next_cb=f"yt_next_0")
        await _edit_media(callback, post, caption, kb)
    except Exception as e:
        logger.exception("cb_yt_like failed: %s", e)


@router.callback_query(F.data.startswith("yt_sub_"))
async def cb_yt_sub(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        try:
            post_id = int((callback.data or "").replace("yt_sub_", ""))
        except ValueError:
            return

        post = get_post_by_id(post_id)
        if not post:
            return

        my_channel = get_youtube_channel(uid)
        if not my_channel:
            try:
                await callback.answer("У вас нет канала", show_alert=True)
            except Exception:
                pass
            return

        target_channel = get_youtube_channel(post["user_id"])
        if not target_channel:
            return
        if my_channel["id"] == target_channel["id"]:
            try:
                await callback.answer("Нельзя подписаться на себя", show_alert=True)
            except Exception:
                pass
            return

        subbed = _is_subbed(uid, target_channel["id"])
        ok = _toggle_sub(uid, target_channel["id"], add=not subbed)
        if ok:
            _yt_log(uid, callback.from_user, "subscribe" if not subbed else "unsubscribe",
                    extra=f"channel_id={target_channel['id']}")

        post = get_post_by_id(post_id)
        caption = _post_caption(post, uid)
        kb = _post_kb(post, uid, back_cb="yt_menu", next_cb=f"yt_next_0")
        await _edit_media(callback, post, caption, kb)
    except Exception as e:
        logger.exception("cb_yt_sub failed: %s", e)


# ================== МОИ ПУБЛИКАЦИИ ==================
@router.callback_query(F.data == "yt_my_videos")
async def cb_yt_my_videos(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        posts = get_user_posts(uid, limit=10)
        if not posts:
            text = "🎞 <b>Мои публикации</b>\n\nПока пусто. Создайте первую!"
            kb = types.InlineKeyboardMarkup(
                inline_keyboard=[
                    [types.InlineKeyboardButton(text="➕ Создать", callback_data="yt_create_video")],
                    [types.InlineKeyboardButton(text="◀️ Назад", callback_data="yt_menu")],
                ]
            )
            try:
                await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                pass
            return

        text = "🎞 <b>Мои публикации</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        kb_rows = []
        for pid, title, mtype, views, likes, comments, created_at in posts:
            emoji = MEDIA_EMOJI.get(mtype or MEDIA_PHOTO, "📷")
            try:
                date_str = time.strftime("%d.%m", time.localtime(int(created_at or 0)))
            except Exception:
                date_str = "—"
            text += (
                f"{emoji} <b>{_esc(title)}</b>\n"
                f"   ❤️ {_fmt(likes)}  👁 {_fmt(views)}  💬 {_fmt(comments)}  · {date_str}\n\n"
            )
            kb_rows.append([types.InlineKeyboardButton(
                text=f"{emoji} {title[:24]}",
                callback_data=f"yt_my_{pid}"
            )])

        kb_rows.append([types.InlineKeyboardButton(text="➕ Создать", callback_data="yt_create_video")])
        kb_rows.append([types.InlineKeyboardButton(text="◀️ Назад", callback_data="yt_menu")])
        kb = types.InlineKeyboardMarkup(inline_keyboard=kb_rows)
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_yt_my_videos failed: %s", e)


@router.callback_query(F.data.startswith("yt_my_"))
async def cb_yt_my_post(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        try:
            post_id = int((callback.data or "").replace("yt_my_", ""))
        except ValueError:
            return

        post = get_post_by_id(post_id)
        if not post or post["user_id"] != uid:
            return

        caption = _post_caption(post, uid)
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="💬 Комментарии", callback_data=f"yt_comments_{post_id}")],
                [types.InlineKeyboardButton(text="◀️ Назад", callback_data="yt_my_videos")],
            ]
        )
        await _edit_media(callback, post, caption, kb)
    except Exception as e:
        logger.exception("cb_yt_my_post failed: %s", e)


# ================== СОЗДАНИЕ ПУБЛИКАЦИИ (НОВЫЙ ПРОЦЕСС) ==================
@router.callback_query(F.data == "yt_create_video")
async def cb_yt_create_video(callback: types.CallbackQuery, state: FSMContext):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        if get_phone_multiplier(get_user_phone_key(uid)[0]) is None:
            return
        if not get_unlimited_active(uid):
            return
        if not get_youtube_channel(uid):
            return

        await state.set_state(YouTubeStates.yt_post_media)
        await state.update_data(post_type=None, post_desc=None)

        text = "📤 <b>Новая публикация</b>\n\nОтправьте фото или видео."
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="❌ Отмена", callback_data="yt_cancel")]]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_yt_create_video failed: %s", e)


@router.message(YouTubeStates.yt_post_media, F.photo)
async def yt_post_media_photo(message: types.Message, state: FSMContext):
    await _finalize_post(message, state, MEDIA_PHOTO, message.photo[-1].file_id)


@router.message(YouTubeStates.yt_post_media, F.video)
async def yt_post_media_video(message: types.Message, state: FSMContext):
    v = message.video
    await _finalize_post(message, state, MEDIA_VIDEO, v.file_id, duration=int(v.duration or 0))


@router.message(YouTubeStates.yt_post_media)
async def yt_post_media_invalid(message: types.Message, state: FSMContext):
    try:
        await message.answer(
            f"⚠️ Отправьте <b>фото</b> или <b>видео</b> (не длиннее {MAX_VIDEO_DURATION} секунд).",
            parse_mode="HTML",
        )
    except Exception as e:
        logger.exception("yt_post_media_invalid failed: %s", e)


async def _finalize_post(message: types.Message, state: FSMContext, mtype: str,
                         file_id: str, duration: int = 0):
    try:
        if not await _require_reg(message):
            await state.clear()
            return

        uid = message.from_user.id

        lock_key = f"{uid}_{file_id}"
        if lock_key in _processing_locks:
            return
        _processing_locks.add(lock_key)

        try:
            if mtype == MEDIA_VIDEO and duration > MAX_VIDEO_DURATION:
                await state.clear()
                await message.answer(
                    f"⚠️ Видео слишком длинное.\n"
                    f"Максимум — <b>{MAX_VIDEO_DURATION} секунд</b>.",
                    parse_mode="HTML",
                )
                return

            await state.update_data(
                preview_mtype=mtype,
                preview_file_id=file_id,
                preview_desc="",
                post_type=mtype,
            )
            await state.set_state(YouTubeStates.yt_post_desc)

            await message.answer(
                "📝 Напишите описание публикации.\n\n"
                "Можно добавить хэштеги:\n"
                "<code>Сегодня тестирую новую машину 🚗\n#UpgradeGame #игра</code>",
                parse_mode="HTML",
            )
        finally:
            async def _cleanup():
                await asyncio.sleep(PROCESSING_TTL)
                _processing_locks.discard(lock_key)
            try:
                asyncio.create_task(_cleanup())
            except Exception:
                _processing_locks.discard(lock_key)
    except Exception as e:
        logger.exception("_finalize_post failed: %s", e)
        try:
            await state.clear()
        except Exception:
            pass


@router.message(YouTubeStates.yt_post_desc)
async def yt_post_desc(message: types.Message, state: FSMContext):
    try:
        if not await _require_reg(message):
            await state.clear()
            return
        raw = (message.text or "").strip()
        if len(raw) < 1 or len(raw) > 500:
            await message.answer("⚠️ Описание: от 1 до 500 символов.")
            return
        if any(c in raw for c in "<>&"):
            await message.answer("⚠️ Без символов &lt; &gt; &amp;")
            return

        data = await state.get_data()
        mtype = data.get("preview_mtype") or data.get("post_type") or MEDIA_PHOTO
        file_id = data.get("preview_file_id")
        if not file_id:
            await message.answer("⚠️ Медиа потерялось. Начните заново.")
            await state.clear()
            return

        await state.update_data(preview_desc=raw)

        preview_text = (
            f"{MEDIA_EMOJI.get(mtype, '📷')} <b>Ваша публикация</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"👤 {_esc(_nick(message.from_user.id))}\n\n"
            f"📝 {_esc(raw)}"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="📤 Опубликовать", callback_data="yt_publish_yes")],
                [types.InlineKeyboardButton(text="✏️ Изменить описание", callback_data="yt_publish_edit")],
                [types.InlineKeyboardButton(text="❌ Отмена", callback_data="yt_publish_cancel")],
            ]
        )

        try:
            await message.delete()
        except Exception:
            pass

        await state.set_state(YouTubeStates.yt_confirm)

        if mtype == MEDIA_PHOTO:
            try:
                await message.answer_photo(photo=file_id, caption=preview_text,
                                           parse_mode="HTML", reply_markup=kb)
                return
            except Exception:
                pass
        elif mtype == MEDIA_VIDEO:
            try:
                await message.answer_video(video=file_id, caption=preview_text,
                                           parse_mode="HTML", reply_markup=kb)
                return
            except Exception:
                pass

        await message.answer(preview_text, parse_mode="HTML", reply_markup=kb)
    except Exception as e:
        logger.exception("yt_post_desc failed: %s", e)


@router.callback_query(F.data == "yt_publish_edit")
async def cb_yt_publish_edit(callback: types.CallbackQuery, state: FSMContext):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        await state.set_state(YouTubeStates.yt_post_desc)
        text = (
            "📝 Напишите описание публикации.\n\n"
            "Можно добавить хэштеги: <code>#UpgradeGame #игра</code>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="❌ Отмена", callback_data="yt_publish_cancel")]]
        )
        try:
            await callback.message.edit_caption(caption=text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            try:
                await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                pass
    except Exception as e:
        logger.exception("cb_yt_publish_edit failed: %s", e)


@router.callback_query(F.data == "yt_publish_cancel")
async def cb_yt_publish_cancel(callback: types.CallbackQuery, state: FSMContext):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        try:
            await state.clear()
        except Exception:
            pass
        try:
            await callback.message.delete()
        except Exception:
            pass
        await _show_yt_menu(callback, callback.from_user.id)
    except Exception as e:
        logger.exception("cb_yt_publish_cancel failed: %s", e)


@router.callback_query(F.data == "yt_publish_yes")
async def cb_yt_publish_yes(callback: types.CallbackQuery, state: FSMContext):
    try:
        try:
            await callback.answer()
        except Exception:
            pass

        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        data = await state.get_data()
        mtype = data.get("preview_mtype") or data.get("post_type") or MEDIA_PHOTO
        file_id = data.get("preview_file_id")
        description = (data.get("preview_desc") or "").strip()

        if not file_id:
            await callback.answer("⚠️ Медиа потерялось", show_alert=True)
            await state.clear()
            return

        lock_key = f"pub_{uid}_{file_id}"
        if lock_key in _processing_locks:
            return
        _processing_locks.add(lock_key)

        try:
            phone_key, _ = get_user_phone_key(uid)
            multiplier = get_phone_multiplier(phone_key) or 1.0

            title = description[:50] if description else "Публикация"

            post_id = _create_post(uid, title, description, mtype, file_id, multiplier)
            if not post_id:
                await callback.answer("⚠️ Ошибка публикации", show_alert=True)
                await state.clear()
                return

            _save_hashtags(post_id, uid, description)

            _add_history(uid, f"Публикация ({mtype})", description[:50])
            _yt_log(uid, callback.from_user, "create_post", extra=f"post_id={post_id} type={mtype}")

            await state.clear()

            post = get_post_by_id(post_id)
            caption = _post_caption(post, uid)
            kb = types.InlineKeyboardMarkup(
                inline_keyboard=[
                    [types.InlineKeyboardButton(text="🎬 К публикации", callback_data=f"yt_my_{post_id}")],
                    [types.InlineKeyboardButton(text="📺 В YouTube", callback_data="yt_menu")],
                ]
            )
            await _edit_media(callback, post, caption, kb)
        finally:
            async def _cleanup():
                await asyncio.sleep(PROCESSING_TTL)
                _processing_locks.discard(lock_key)
            try:
                asyncio.create_task(_cleanup())
            except Exception:
                _processing_locks.discard(lock_key)
    except Exception as e:
        logger.exception("cb_yt_publish_yes failed: %s", e)


# ================== КОММЕНТАРИИ ==================
def get_post_comments(post_id: int, limit: int = 10):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT user_id, comment, created_at
                FROM youtube_comments
                WHERE video_id = ?
                ORDER BY created_at DESC
                LIMIT ?
            """, (post_id, limit))
            return cur.fetchall() or []
    except Exception as e:
        logger.exception("get_post_comments failed: %s", e)
        return []


def _add_comment(user_id: int, post_id: int, comment: str) -> bool:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            cur.execute("""
                INSERT INTO youtube_comments (user_id, video_id, comment, created_at)
                VALUES (?, ?, ?, ?)
            """, (user_id, post_id, comment, _now()))
            cur.execute("UPDATE youtube_videos SET comments = comments + 1 WHERE id = ?", (post_id,))
        return True
    except Exception as e:
        logger.exception("_add_comment failed: %s", e)
        return False


def _comments_text(post: dict) -> str:
    comments = get_post_comments(post["id"], limit=10)
    text = "💬 <b>Комментарии</b>\n"
    if not comments:
        text += "\nПока пусто. Будьте первым!\n"
    else:
        text += "\n"
        for c_uid, comment, c_at in comments:
            nick = _nick(c_uid)
            try:
                date_str = time.strftime("%d.%m %H:%M", time.localtime(int(c_at or 0)))
            except Exception:
                date_str = "—"
            text += f"👤 <b>{_esc(nick)}</b> · {date_str}\n{_esc(comment)}\n\n"
    return text


def _comments_kb(post_id: int) -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="💬 Написать комментарий", callback_data=f"yt_comment_{post_id}")],
            [types.InlineKeyboardButton(text="◀️ К публикации", callback_data=f"yt_back_{post_id}")],
        ]
    )


@router.callback_query(F.data.startswith("yt_comments_"))
async def cb_yt_comments(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        try:
            post_id = int((callback.data or "").replace("yt_comments_", ""))
        except ValueError:
            return

        post = get_post_by_id(post_id)
        if not post:
            return

        text = _comments_text(post)
        kb = _comments_kb(post_id)
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            try:
                await callback.message.answer(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                pass
    except Exception as e:
        logger.exception("cb_yt_comments failed: %s", e)


@router.callback_query(F.data.startswith("yt_back_"))
async def cb_yt_back_to_post(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        try:
            post_id = int((callback.data or "").replace("yt_back_", ""))
        except ValueError:
            return

        post = get_post_by_id(post_id)
        if not post:
            return

        caption = _post_caption(post, uid)
        if post["user_id"] == uid:
            kb = types.InlineKeyboardMarkup(
                inline_keyboard=[
                    [types.InlineKeyboardButton(text="💬 Комментарии", callback_data=f"yt_comments_{post_id}")],
                    [types.InlineKeyboardButton(text="◀️ Назад", callback_data="yt_my_videos")],
                ]
            )
        else:
            kb = _post_kb(post, uid, back_cb="yt_menu", next_cb=f"yt_next_0")

        await _edit_media(callback, post, caption, kb)
    except Exception as e:
        logger.exception("cb_yt_back_to_post failed: %s", e)


@router.callback_query(F.data.startswith("yt_comment_"))
async def cb_yt_write_comment(callback: types.CallbackQuery, state: FSMContext):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        try:
            post_id = int((callback.data or "").replace("yt_comment_", ""))
        except ValueError:
            return

        if not get_post_by_id(post_id):
            return

        await state.update_data(comment_post_id=post_id)
        await state.set_state(YouTubeStates.yt_comment)

        text = (
            "💬 <b>Новый комментарий</b>\n\n"
            "✍️ Введите текст:\n"
            "<i>От 2 до 200 символов</i>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="❌ Отмена", callback_data=f"yt_back_{post_id}")]]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_yt_write_comment failed: %s", e)


@router.message(YouTubeStates.yt_comment)
async def yt_process_comment(message: types.Message, state: FSMContext):
    try:
        if not await _require_reg(message):
            await state.clear()
            return
        raw = (message.text or "").strip()
        if len(raw) < 2 or len(raw) > 200:
            await message.answer("⚠️ Комментарий: от 2 до 200 символов.")
            return
        if any(c in raw for c in "<>&"):
            await message.answer("⚠️ Без символов &lt; &gt; &amp;")
            return

        data = await state.get_data()
        post_id = data.get("comment_post_id")
        uid = message.from_user.id

        if not post_id:
            await state.clear()
            return

        ok = _add_comment(uid, int(post_id), raw)
        await state.clear()

        if not ok:
            await message.answer("⚠️ Не удалось добавить комментарий.")
            return

        _add_history(uid, "Комментарий", f"post_id={post_id}")
        _yt_log(uid, message.from_user, "comment", extra=f"post_id={post_id}")

        post = get_post_by_id(int(post_id))
        if not post:
            return

        # удаляем сообщение пользователя, показываем комментарии
        try:
            await message.delete()
        except Exception:
            pass
        text = _comments_text(post)
        kb = _comments_kb(int(post_id))
        try:
            await message.answer(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("yt_process_comment failed: %s", e)
        try:
            await state.clear()
        except Exception:
            pass


# ================== ПОДПИСКИ / ПОИСК / ТОП ==================
@router.callback_query(F.data == "yt_friends")
async def cb_yt_friends(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        my_channel = get_youtube_channel(uid)
        if not my_channel:
            return

        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT ya.user_id, ya.name, ya.surname, ya.subscribers
                FROM youtube_subscriptions ys
                JOIN youtube_accounts ya ON ya.id = ys.channel_id
                WHERE ys.user_id = ?
                ORDER BY ys.created_at DESC
                LIMIT 20
            """, (uid,))
            subs = cur.fetchall() or []

            cur.execute("""
                SELECT u.user_id, u.nickname
                FROM youtube_subscriptions ys
                JOIN users u ON u.user_id = ys.user_id
                WHERE ys.channel_id = ?
                ORDER BY ys.created_at DESC
                LIMIT 20
            """, (my_channel["id"],))
            followers = cur.fetchall() or []

        text = "👥 <b>Подписки</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        text += f"📌 Подписки: {len(subs)}\n"
        if subs:
            for s_uid, name, surname, count in subs[:10]:
                text += f"   • {_esc(_nick(s_uid))} — {_fmt(count)}\n"
        else:
            text += "   • Пока пусто\n"

        text += f"\n📌 Подписчики: {len(followers)}\n"
        if followers:
            for f_uid, nick in followers[:10]:
                text += f"   • {_esc(nick or DEFAULT_NICK)}\n"
        else:
            text += "   • Пока пусто\n"

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="🔍 Найти каналы", callback_data="yt_search")],
                [types.InlineKeyboardButton(text="◀️ Назад", callback_data="yt_menu")],
            ]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_yt_friends failed: %s", e)


@router.callback_query(F.data == "yt_search")
async def cb_yt_search(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        my_channel = get_youtube_channel(uid)
        if not my_channel:
            return

        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT user_id, name, surname, subscribers, id
                FROM youtube_accounts
                WHERE user_id != ?
                ORDER BY RANDOM()
                LIMIT 5
            """, (uid,))
            channels = cur.fetchall() or []

        if not channels:
            text = "🔍 <b>Поиск каналов</b>\n\nПока других каналов нет."
            kb = types.InlineKeyboardMarkup(
                inline_keyboard=[[types.InlineKeyboardButton(text="◀️ Назад", callback_data="yt_friends")]]
            )
            try:
                await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                pass
            return

        text = "🔍 <b>Найти каналы</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        kb_rows = []
        for ch_uid, name, surname, subs, ch_id in channels:
            nick = _nick(ch_uid)
            subbed = _is_subbed(uid, ch_id)
            mark = "✅" if subbed else "🆕"
            text += f"{mark} <b>{_esc(nick)}</b> · 👥 {_fmt(subs)}\n"
            if not subbed:
                kb_rows.append([types.InlineKeyboardButton(
                    text=f"➕ {nick[:20]}",
                    callback_data=f"yt_subch_{ch_id}"
                )])

        kb_rows.append([types.InlineKeyboardButton(text="🔄 Обновить", callback_data="yt_search")])
        kb_rows.append([types.InlineKeyboardButton(text="◀️ Назад", callback_data="yt_friends")])
        kb = types.InlineKeyboardMarkup(inline_keyboard=kb_rows)
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_yt_search failed: %s", e)


@router.callback_query(F.data.startswith("yt_subch_"))
async def cb_yt_subch(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        try:
            channel_id = int((callback.data or "").replace("yt_subch_", ""))
        except ValueError:
            return

        my_channel = get_youtube_channel(uid)
        if not my_channel or my_channel["id"] == channel_id:
            return

        ok = _toggle_sub(uid, channel_id, add=True)
        if ok:
            _yt_log(uid, callback.from_user, "subscribe", extra=f"channel_id={channel_id}")

        await cb_yt_search(callback)
    except Exception as e:
        logger.exception("cb_yt_subch failed: %s", e)


@router.callback_query(F.data == "yt_top")
async def cb_yt_top(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT user_id, name, surname, subscribers, views
                FROM youtube_accounts
                ORDER BY subscribers DESC, views DESC
                LIMIT 10
            """)
            top = cur.fetchall() or []

        text = "🏆 <b>Топ каналов</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        if not top:
            text += "Пока пусто."
        else:
            medals = ["🥇", "🥈", "🥉"]
            for i, (ch_uid, name, surname, subs, views) in enumerate(top, 1):
                icon = medals[i - 1] if i <= 3 else f"{i}."
                nick = _nick(ch_uid)
                text += f"{icon} <b>{_esc(nick)}</b> · 👥 {_fmt(subs)} · 👁 {_fmt(views)}\n"

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="◀️ Назад", callback_data="yt_menu")]]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_yt_top failed: %s", e)


# ================== ФОНОВЫЙ NPC ==================
async def youtube_npc_activity():
    try:
        await asyncio.sleep(60)
    except Exception:
        pass

    while True:
        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE")
                cur.execute("""
                    SELECT id, user_id, created_at
                    FROM youtube_videos
                    ORDER BY created_at DESC
                    LIMIT 500
                """)
                posts = cur.fetchall() or []

                for post_id, owner_id, created_at in posts:
                    try:
                        age_days = (_now() - int(created_at or 0)) / 86400
                    except Exception:
                        age_days = 0

                    chance = max(5, 30 - age_days * 2)
                    if random.randint(1, 100) > chance:
                        continue

                    add_likes = 1 if random.random() < 0.3 else 0

                    cur.execute(
                        "UPDATE youtube_videos SET views = views + 1, likes = likes + ?, last_activity = ? WHERE id = ?",
                        (add_likes, _now(), post_id)
                    )
                    cur.execute(
                        "UPDATE youtube_accounts SET views = views + 1, likes = likes + ? WHERE user_id = ?",
                        (add_likes, owner_id)
                    )
        except Exception as e:
            logger.exception("youtube_npc_activity failed: %s", e)
            await asyncio.sleep(NPC_ERROR_BACKOFF)
            continue

        await asyncio.sleep(NPC_INTERVAL)