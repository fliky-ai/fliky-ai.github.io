import time
import uuid
import logging
import re
from aiogram import Router, types, F
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

from database import db_conn

try:
    from database import get_user as _get_user_db
except Exception:
    _get_user_db = None

logger = logging.getLogger(__name__)
router = Router()


# ================== ДОЛЖНОСТИ ==================
RANK_OWNER = 5
RANK_CHIEF = 4
RANK_ADMIN = 3
RANK_MODER = 2
RANK_HELPER = 1
RANK_USER = 0

RANKS = {
    5: {"name": "Владелец",             "emoji": "👑"},
    4: {"name": "Главный администратор", "emoji": "💎"},
    3: {"name": "Администратор",         "emoji": "🛡"},
    2: {"name": "Модератор",             "emoji": "🔨"},
    1: {"name": "Хелпер",                "emoji": "🔰"},
    0: {"name": "Участник",              "emoji": "👤"},
}


def rank_name(rank: int) -> str:
    return RANKS.get(rank, RANKS[0])["name"]


def rank_emoji(rank: int) -> str:
    return RANKS.get(rank, RANKS[0])["emoji"]


PERMS = {
    "ban": RANK_ADMIN, "unban": RANK_ADMIN,
    "mute": RANK_MODER, "unmute": RANK_MODER,
    "kick": RANK_MODER, "warn": RANK_MODER,
    "unwarn": RANK_MODER, "warnings_view": RANK_MODER,
    "delete_msg": RANK_MODER, "mutes_view": RANK_MODER,
    "logs_view": RANK_ADMIN,
    "settings": RANK_OWNER, "rules_edit": RANK_OWNER,
    "perms_edit": RANK_OWNER, "subscribe_edit": RANK_OWNER,
    "manage_staff": RANK_ADMIN,
}


def can_do(rank: int, action: str) -> bool:
    return rank >= PERMS.get(action, RANK_OWNER)


MANAGE_MAX = {
    RANK_OWNER: 4, RANK_CHIEF: 3, RANK_ADMIN: 2,
    RANK_MODER: None, RANK_HELPER: None, RANK_USER: None,
}


def can_manage_rank(actor_rank: int, target_rank: int) -> bool:
    try:
        if actor_rank == RANK_OWNER and target_rank == RANK_OWNER:
            return False
        max_r = MANAGE_MAX.get(actor_rank)
        if max_r is None or target_rank > max_r:
            return False
        return True
    except Exception:
        return False


PERM_KEYS = ["ban", "mute", "warn", "kick"]


# ================== АНТИАБУЗ BAN ==================
BAN_ABUSE_WINDOW = 300
BAN_ABUSE_THRESHOLD = 5
BAN_ABUSE_BLOCK_TIME = 86400


# ================== ДЛИТЕЛЬНОСТИ ==================
MUTE_DURATIONS = {
    "10m": 600, "10м": 600, "10мин": 600,
    "30m": 1800, "30м": 1800, "30мин": 1800,
    "1h": 3600, "1ч": 3600, "1час": 3600,
    "6h": 21600, "6ч": 21600,
    "12h": 43200, "12ч": 43200,
    "1d": 86400, "1д": 86400, "1день": 86400,
}


def parse_duration(s: str):
    return MUTE_DURATIONS.get((s or "").strip().lower())


def fmt_duration(seconds: int) -> str:
    try:
        seconds = int(seconds)
    except Exception:
        return "—"
    if seconds <= 0:
        return "0м"
    d, h, m = seconds // 86400, (seconds % 86400) // 3600, (seconds % 3600) // 60
    parts = []
    if d: parts.append(f"{d}д")
    if h: parts.append(f"{h}ч")
    if m: parts.append(f"{m}м")
    return " ".join(parts) or f"{seconds}с"


def _esc(s) -> str:
    return (str(s) if s is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _user_mention(user_id: int, name: str = None) -> str:
    try:
        safe = _esc(name) if name else f"ID {user_id}"
        return f"<a href='tg://user?id={user_id}'>{safe}</a>"
    except Exception:
        return f"ID {user_id}"


class AdminStates(StatesGroup):
    waiting_rules = State()
    waiting_welcome_text = State()
    waiting_welcome_photo = State()
    waiting_sub_link = State()
    waiting_sub_type = State()
    waiting_period = State()


# ================== БД ==================
def _init_group_db():
    try:
        with db_conn() as conn:
            cur = conn.cursor()

            # --- сотрудники ---
            cur.execute("""
                CREATE TABLE IF NOT EXISTS group_staff (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    rank INTEGER DEFAULT 1,
                    appointed_by INTEGER,
                    appointed_at INTEGER,
                    perm_ban  INTEGER DEFAULT -1,
                    perm_mute INTEGER DEFAULT -1,
                    perm_warn INTEGER DEFAULT -1,
                    perm_kick INTEGER DEFAULT -1,
                    UNIQUE(chat_id, user_id)
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_staff_chat ON group_staff(chat_id, rank DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_staff_user ON group_staff(user_id)")

            cur.execute("PRAGMA table_info(group_staff)")
            cols = {c[1] for c in cur.fetchall()}
            for perm in PERM_KEYS:
                col = f"perm_{perm}"
                if col not in cols:
                    try:
                        cur.execute(f"ALTER TABLE group_staff ADD COLUMN {col} INTEGER DEFAULT -1")
                    except Exception:
                        pass

            # --- предупреждения ---
            cur.execute("""
                CREATE TABLE IF NOT EXISTS group_warns (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_id INTEGER,
                    user_id INTEGER,
                    moderator_id INTEGER,
                    reason TEXT DEFAULT '',
                    created_at INTEGER,
                    active INTEGER DEFAULT 1
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_warns_chat_user ON group_warns(chat_id, user_id, active)")

            # --- наказания ---
            cur.execute("""
                CREATE TABLE IF NOT EXISTS group_punishments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    operation_id TEXT UNIQUE,
                    chat_id INTEGER,
                    user_id INTEGER,
                    moderator_id INTEGER,
                    punish_type TEXT,
                    reason TEXT DEFAULT '',
                    duration INTEGER DEFAULT 0,
                    issued_at INTEGER,
                    expires_at INTEGER DEFAULT 0,
                    status TEXT DEFAULT 'active'
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_pun_chat_user ON group_punishments(chat_id, user_id, status)")

            # --- настройки ---
            cur.execute("""
                CREATE TABLE IF NOT EXISTS group_settings (
                    chat_id INTEGER PRIMARY KEY,
                    warn_limit INTEGER DEFAULT 3,
                    warn_action TEXT DEFAULT 'mute_1h',
                    rules TEXT DEFAULT '',
                    welcome_text TEXT DEFAULT '',
                    welcome_photo TEXT DEFAULT '',
                    welcome_enabled INTEGER DEFAULT 0,
                    subscription_enabled INTEGER DEFAULT 0,
                    logs_enabled INTEGER DEFAULT 1
                )
            """)
            cur.execute("PRAGMA table_info(group_settings)")
            cols = {c[1] for c in cur.fetchall()}
            for col, ct in (
                ("welcome_photo", "TEXT DEFAULT ''"),
                ("welcome_enabled", "INTEGER DEFAULT 0"),
                ("subscription_enabled", "INTEGER DEFAULT 0"),
            ):
                if col not in cols:
                    try:
                        cur.execute(f"ALTER TABLE group_settings ADD COLUMN {col} {ct}")
                    except Exception:
                        pass

            # --- логи ---
            cur.execute("""
                CREATE TABLE IF NOT EXISTS group_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    operation_id TEXT,
                    chat_id INTEGER,
                    user_id INTEGER,
                    moderator_id INTEGER,
                    action TEXT,
                    reason TEXT DEFAULT '',
                    duration INTEGER DEFAULT 0,
                    extra TEXT DEFAULT '',
                    created_at INTEGER
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_glogs_chat ON group_logs(chat_id, id DESC)")

            # --- антиабуз ban ---
            cur.execute("""
                CREATE TABLE IF NOT EXISTS moderation_ban_abuse (
                    chat_id INTEGER,
                    user_id INTEGER,
                    ban_count INTEGER DEFAULT 0,
                    window_start INTEGER DEFAULT 0,
                    temporary_block_until INTEGER DEFAULT 0,
                    manual_ban_perm INTEGER DEFAULT -1,
                    PRIMARY KEY (chat_id, user_id)
                )
            """)

            # --- обязательная подписка (UNIQUE на chat_id+source_id) ---
            cur.execute("""
                CREATE TABLE IF NOT EXISTS required_subscriptions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_id INTEGER NOT NULL,
                    source_id INTEGER NOT NULL,
                    source_type TEXT,
                    source_title TEXT,
                    source_username TEXT,
                    source_link TEXT,
                    created_by INTEGER,
                    created_at INTEGER,
                    enabled INTEGER DEFAULT 1,
                    UNIQUE(chat_id, source_id)
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_req_sub_chat ON required_subscriptions(chat_id, enabled)")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS subscription_check_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_id INTEGER,
                    user_id INTEGER,
                    result TEXT,
                    missing TEXT,
                    created_at INTEGER
                )
            """)

        logger.info("grouphelper: таблицы готовы")
    except Exception as e:
        logger.exception("init_group_db failed: %s", e)


_init_group_db()


# ================== TELEGRAM-СТАТУСЫ ==================
async def get_real_owner(bot, chat_id: int) -> int:
    try:
        admins = await bot.get_chat_administrators(chat_id)
        for a in admins:
            try:
                if a.status == "creator":
                    return a.user.id
            except Exception:
                continue
    except Exception as e:
        logger.warning("get_chat_administrators failed: %s", e)
    return 0


async def is_telegram_admin(bot, chat_id: int, user_id: int) -> bool:
    try:
        m = await bot.get_chat_member(chat_id, user_id)
        return m.status in ("administrator", "creator")
    except Exception:
        return False


async def is_group_member(bot, chat_id: int, user_id: int) -> bool:
    try:
        m = await bot.get_chat_member(chat_id, user_id)
        return m.status not in ("left", "kicked")
    except Exception:
        return False


async def bot_can_restrict(bot, chat_id: int):
    try:
        me = await bot.get_me()
        m = await bot.get_chat_member(chat_id, me.id)
        if m.status not in ("administrator", "creator"):
            return False, "Бот не администратор группы"
        if m.status == "administrator":
            if not getattr(m, "can_restrict_members", False):
                return False, "У бота нет права ограничивать участников"
        return True, ""
    except Exception as e:
        return False, str(e)


async def bot_can_delete(bot, chat_id: int):
    try:
        me = await bot.get_me()
        m = await bot.get_chat_member(chat_id, me.id)
        if m.status == "creator":
            return True, ""
        if m.status != "administrator":
            return False, "Бот не администратор группы"
        if not getattr(m, "can_delete_messages", False):
            return False, "У бота нет права удалять сообщения"
        return True, ""
    except Exception as e:
        return False, str(e)


# ================== РАНГ ==================
def get_rank(chat_id: int, user_id: int) -> int:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT rank FROM group_staff WHERE chat_id = ? AND user_id = ?", (chat_id, user_id))
            row = cur.fetchone()
            return int(row[0]) if row else RANK_USER
    except Exception:
        return RANK_USER


def get_staff_row(chat_id: int, user_id: int):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM group_staff WHERE chat_id = ? AND user_id = ?", (chat_id, user_id))
            row = cur.fetchone()
            if not row:
                return None
            cols = [d[0] for d in cur.description]
            return dict(zip(cols, row))
    except Exception:
        return None


def set_rank(chat_id: int, user_id: int, rank: int, appointed_by: int) -> bool:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            if rank <= 0:
                cur.execute("DELETE FROM group_staff WHERE chat_id = ? AND user_id = ?", (chat_id, user_id))
            else:
                cur.execute("""
                    INSERT INTO group_staff (chat_id, user_id, rank, appointed_by, appointed_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(chat_id, user_id) DO UPDATE SET
                        rank = excluded.rank,
                        appointed_by = excluded.appointed_by,
                        appointed_at = excluded.appointed_at
                """, (chat_id, user_id, rank, appointed_by, int(time.time())))
        return True
    except Exception as e:
        logger.exception("set_rank failed: %s", e)
        return False


def set_perm(chat_id: int, user_id: int, perm_key: str, value: int) -> bool:
    if perm_key not in PERM_KEYS or value not in (-1, 0, 1):
        return False
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            cur.execute(f"UPDATE group_staff SET perm_{perm_key} = ? WHERE chat_id = ? AND user_id = ?",
                        (value, chat_id, user_id))
        return True
    except Exception:
        return False


def has_individual_perm(chat_id: int, user_id: int, perm_key: str) -> int:
    row = get_staff_row(chat_id, user_id)
    if not row:
        return -1
    val = row.get(f"perm_{perm_key}")
    try:
        return int(val) if val is not None else -1
    except Exception:
        return -1


def list_staff(chat_id: int) -> list:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT user_id, rank FROM group_staff
                WHERE chat_id = ? AND rank > 0
                ORDER BY rank DESC, appointed_at ASC
            """, (chat_id,))
            return cur.fetchall() or []
    except Exception:
        return []


async def effective_rank(bot, chat_id: int, user_id: int) -> int:
    try:
        real_owner = await get_real_owner(bot, chat_id)
        if real_owner and real_owner == user_id:
            cur_rank = get_rank(chat_id, user_id)
            if cur_rank != RANK_OWNER:
                set_rank(chat_id, user_id, RANK_OWNER, user_id)
            return RANK_OWNER
    except Exception:
        pass
    return get_rank(chat_id, user_id)


def can_use_action(chat_id: int, user_id: int, rank: int, action: str) -> bool:
    if not can_do(rank, action):
        return False
    if action in PERM_KEYS:
        individual = has_individual_perm(chat_id, user_id, action)
        if individual == 0:
            return False
        if individual == 1:
            return True
    return True


# ================== ЛОГИ ==================
def add_log(chat_id: int, user_id: int, moderator_id: int, action: str,
            reason: str = "", duration: int = 0, extra: str = "") -> str:
    op_id = str(uuid.uuid4())
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO group_logs
                (operation_id, chat_id, user_id, moderator_id, action, reason, duration, extra, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (op_id, chat_id, user_id, moderator_id, action, reason, duration, extra, int(time.time())))
    except Exception:
        pass
    return op_id


def get_logs(chat_id: int, limit: int = 10) -> list:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT operation_id, user_id, moderator_id, action, reason, duration, created_at
                FROM group_logs WHERE chat_id = ? ORDER BY id DESC LIMIT ?
            """, (chat_id, limit))
            return cur.fetchall() or []
    except Exception:
        return []


# ================== НАСТРОЙКИ ==================
def get_settings(chat_id: int) -> dict:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM group_settings WHERE chat_id = ?", (chat_id,))
            row = cur.fetchone()
            if not row:
                cur.execute("INSERT OR IGNORE INTO group_settings (chat_id) VALUES (?)", (chat_id,))
                return {"chat_id": chat_id, "warn_limit": 3, "warn_action": "mute_1h",
                        "rules": "", "welcome_text": "", "welcome_photo": "",
                        "welcome_enabled": 0, "subscription_enabled": 0, "logs_enabled": 1}
            cols = [c[0] for c in cur.description]
            return dict(zip(cols, row))
    except Exception:
        return {"chat_id": chat_id, "warn_limit": 3, "warn_action": "mute_1h",
                "rules": "", "welcome_text": "", "welcome_photo": "",
                "welcome_enabled": 0, "subscription_enabled": 0, "logs_enabled": 1}


# ================== WARN ==================
def warn_count(chat_id: int, user_id: int) -> int:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM group_warns WHERE chat_id = ? AND user_id = ? AND active = 1",
                        (chat_id, user_id))
            return int((cur.fetchone() or [0])[0] or 0)
    except Exception:
        return 0


def add_warn(chat_id: int, user_id: int, moderator_id: int, reason: str) -> int:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            cur.execute("""
                INSERT INTO group_warns (chat_id, user_id, moderator_id, reason, created_at, active)
                VALUES (?, ?, ?, ?, ?, 1)
            """, (chat_id, user_id, moderator_id, reason, int(time.time())))
            cur.execute("SELECT COUNT(*) FROM group_warns WHERE chat_id = ? AND user_id = ? AND active = 1",
                        (chat_id, user_id))
            return int((cur.fetchone() or [0])[0] or 0)
    except Exception:
        return 0


def clear_last_warn(chat_id: int, user_id: int) -> bool:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            cur.execute("""
                UPDATE group_warns SET active = 0
                WHERE id = (SELECT id FROM group_warns
                            WHERE chat_id = ? AND user_id = ? AND active = 1
                            ORDER BY id DESC LIMIT 1)
            """, (chat_id, user_id))
            return cur.rowcount > 0
    except Exception:
        return False


def clear_all_warns(chat_id: int, user_id: int) -> int:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            cur.execute("UPDATE group_warns SET active = 0 WHERE chat_id = ? AND user_id = ? AND active = 1",
                        (chat_id, user_id))
            return cur.rowcount
    except Exception:
        return 0


# ================== НАКАЗАНИЯ ==================
def add_punish(chat_id: int, user_id: int, moderator_id: int,
               ptype: str, reason: str, duration: int) -> str:
    op_id = str(uuid.uuid4())
    now = int(time.time())
    expires = now + duration if duration > 0 else 0
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            cur.execute("""
                INSERT INTO group_punishments
                (operation_id, chat_id, user_id, moderator_id, punish_type, reason,
                 duration, issued_at, expires_at, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
            """, (op_id, chat_id, user_id, moderator_id, ptype, reason, duration, now, expires))
    except Exception:
        pass
    return op_id


def remove_punish(chat_id: int, user_id: int, ptype: str) -> bool:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            cur.execute("""
                UPDATE group_punishments SET status = 'removed'
                WHERE chat_id = ? AND user_id = ? AND punish_type = ? AND status = 'active'
            """, (chat_id, user_id, ptype))
            return cur.rowcount > 0
    except Exception:
        return False


def list_active_mutes(chat_id: int, limit: int = 20) -> list:
    """Список активных мутов в группе."""
    try:
        now = int(time.time())
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT user_id, reason, expires_at, duration, issued_at
                FROM group_punishments
                WHERE chat_id = ? AND punish_type = 'mute' AND status = 'active'
                ORDER BY issued_at DESC LIMIT ?
            """, (chat_id, limit))
            rows = cur.fetchall() or []
            result = []
            for r in rows:
                uid, reason, expires, duration, issued = r
                # если срок истёк — пропускаем
                if expires and expires < now:
                    continue
                remaining = (expires - now) if expires else 0
                result.append({"user_id": uid, "reason": reason or "",
                               "remaining": remaining, "duration": duration or 0})
            return result
    except Exception:
        return []


# ================== АНТИАБУЗ BAN ==================
def _ban_abuse_get(chat_id: int, user_id: int) -> dict:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT ban_count, window_start, temporary_block_until, manual_ban_perm
                FROM moderation_ban_abuse WHERE chat_id = ? AND user_id = ?
            """, (chat_id, user_id))
            row = cur.fetchone()
            if not row:
                return {"ban_count": 0, "window_start": 0,
                        "temporary_block_until": 0, "manual_ban_perm": -1}
            return {"ban_count": int(row[0] or 0), "window_start": int(row[1] or 0),
                    "temporary_block_until": int(row[2] or 0),
                    "manual_ban_perm": int(row[3]) if row[3] is not None else -1}
    except Exception:
        return {"ban_count": 0, "window_start": 0, "temporary_block_until": 0, "manual_ban_perm": -1}


def ban_abuse_register(chat_id: int, user_id: int) -> dict:
    now = int(time.time())
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            cur.execute("""
                SELECT ban_count, window_start, temporary_block_until, manual_ban_perm
                FROM moderation_ban_abuse WHERE chat_id = ? AND user_id = ?
            """, (chat_id, user_id))
            row = cur.fetchone()
            if not row:
                ban_count, window_start = 1, now
                block_until, manual = 0, -1
                cur.execute("""
                    INSERT INTO moderation_ban_abuse
                    (chat_id, user_id, ban_count, window_start, temporary_block_until, manual_ban_perm)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (chat_id, user_id, ban_count, window_start, block_until, manual))
            else:
                ban_count = int(row[0] or 0)
                window_start = int(row[1] or 0)
                block_until = int(row[2] or 0)
                manual = int(row[3]) if row[3] is not None else -1
                if now - window_start > BAN_ABUSE_WINDOW:
                    ban_count, window_start = 0, now
                ban_count += 1
                if ban_count >= BAN_ABUSE_THRESHOLD:
                    block_until = now + BAN_ABUSE_BLOCK_TIME
                cur.execute("""
                    UPDATE moderation_ban_abuse
                    SET ban_count = ?, window_start = ?, temporary_block_until = ?
                    WHERE chat_id = ? AND user_id = ?
                """, (ban_count, window_start, block_until, chat_id, user_id))
            return {"ban_count": ban_count, "window_start": window_start,
                    "temporary_block_until": block_until, "manual_ban_perm": manual}
    except Exception:
        return {"ban_count": 0, "window_start": now, "temporary_block_until": 0, "manual_ban_perm": -1}


def ban_abuse_is_blocked(chat_id: int, user_id: int) -> int:
    rec = _ban_abuse_get(chat_id, user_id)
    bu = rec["temporary_block_until"]
    if bu and bu > int(time.time()):
        return bu
    return 0


def ban_abuse_manual_perm_set(chat_id: int, user_id: int, value: int) -> bool:
    if value not in (-1, 0, 1):
        return False
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            cur.execute("""
                INSERT INTO moderation_ban_abuse
                (chat_id, user_id, ban_count, window_start, temporary_block_until, manual_ban_perm)
                VALUES (?, ?, 0, 0, 0, ?)
                ON CONFLICT(chat_id, user_id) DO UPDATE SET manual_ban_perm = excluded.manual_ban_perm
            """, (chat_id, user_id, value))
        return True
    except Exception:
        return False


# ================== ПОДПИСКА (БД) ==================
def list_required_subs(chat_id: int) -> list:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT id, source_id, source_type, source_title, source_username, source_link
                FROM required_subscriptions
                WHERE chat_id = ? AND enabled = 1
                ORDER BY id ASC
            """, (chat_id,))
            return cur.fetchall() or []
    except Exception:
        return []


def add_required_sub(chat_id: int, source_id: int, source_type: str,
                     title: str, username: str, link: str, created_by: int):
    """Возвращает (ok:bool, reason:str, sub_id:int)."""
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            cur.execute("SELECT id FROM required_subscriptions WHERE chat_id = ? AND source_id = ?",
                        (chat_id, source_id))
            if cur.fetchone():
                return False, "duplicate", 0
            cur.execute("""
                INSERT INTO required_subscriptions
                (chat_id, source_id, source_type, source_title, source_username, source_link,
                 created_by, created_at, enabled)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
            """, (chat_id, source_id, source_type, title, username, link,
                  created_by, int(time.time())))
            return True, "ok", cur.lastrowid
    except Exception as e:
        logger.exception("add_required_sub failed: %s", e)
        return False, "db_error", 0


def remove_required_sub(chat_id: int, sub_id: int) -> bool:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            cur.execute("DELETE FROM required_subscriptions WHERE chat_id = ? AND id = ?", (chat_id, sub_id))
            return cur.rowcount > 0
    except Exception:
        return False


def set_subscription_enabled(chat_id: int, enabled: int):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            cur.execute("""
                INSERT INTO group_settings (chat_id, subscription_enabled) VALUES (?, ?)
                ON CONFLICT(chat_id) DO UPDATE SET subscription_enabled = excluded.subscription_enabled
            """, (chat_id, 1 if enabled else 0))
    except Exception:
        pass


def subscription_enabled(chat_id: int) -> bool:
    try:
        s = get_settings(chat_id)
        return bool(int(s.get("subscription_enabled") or 0))
    except Exception:
        return False


def log_sub_check(chat_id: int, user_id: int, result: str, missing: str = ""):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO subscription_check_logs (chat_id, user_id, result, missing, created_at)
                VALUES (?, ?, ?, ?, ?)
            """, (chat_id, user_id, result, missing[:500], int(time.time())))
    except Exception:
        pass


# ================== ПОДПИСКА (логика) ==================
async def is_subscribed(bot, user_id: int, source_id: int) -> bool:
    try:
        m = await bot.get_chat_member(source_id, user_id)
        return m.status not in ("left", "kicked")
    except Exception as e:
        logger.warning("is_subscribed failed (%s -> %s): %s", user_id, source_id, e)
        return False


async def user_missing_subs(bot, user_id: int, chat_id: int) -> list:
    missing = []
    try:
        for sub in list_required_subs(chat_id):
            try:
                sub_id, source_id, stype, title, username, link = sub
                ok = await is_subscribed(bot, user_id, source_id)
                if not ok:
                    missing.append({"id": sub_id, "source_id": source_id, "type": stype,
                                    "title": title, "username": username, "link": link})
            except Exception:
                continue
    except Exception:
        pass
    return missing


def _normalize_link(link: str) -> str:
    """Нормализует ссылку/username в @username или пустую строку."""
    if not link:
        return ""
    s = link.strip()
    s = s.replace("https://t.me/", "").replace("http://t.me/", "")
    s = s.replace("t.me/", "").strip("/")
    if s.startswith("@"):
        s = s[1:]
    return s.split("/")[0] if s else ""


async def _resolve_chat_from_link(bot, link: str):
    """Возвращает (ok, chat_obj_or_error)."""
    try:
        s = link.strip()
        if not s:
            return False, "Пустая ссылка"
        # @username или https://t.me/username
        if s.startswith("https://t.me/") or s.startswith("http://t.me/") or s.startswith("t.me/"):
            uname = _normalize_link(s)
            if not uname or uname.startswith("+"):
                return False, "Приватные ссылки-приглашения не поддерживаются. Используйте @username."
            try:
                chat_obj = await bot.get_chat("@" + uname)
                return True, chat_obj
            except Exception as e:
                return False, f"Не удалось получить @{uname}: {e}"
        elif s.startswith("@"):
            try:
                chat_obj = await bot.get_chat(s)
                return True, chat_obj
            except Exception as e:
                return False, f"Не удалось получить {s}: {e}"
        else:
            try:
                chat_obj = await bot.get_chat(s)
                return True, chat_obj
            except Exception as e:
                return False, f"Не удалось получить: {e}"
    except Exception as e:
        return False, str(e)
# ================== ТОЛЬКО В ГРУППЕ ==================
async def require_group(event) -> bool:
    try:
        chat = getattr(event, "chat", None) or getattr(getattr(event, "message", None), "chat", None)
        if chat and chat.type in ("group", "supergroup"):
            return True
        if isinstance(event, types.CallbackQuery):
            try:
                await event.answer("Эта команда работает только в группе", show_alert=True)
            except Exception:
                pass
        elif isinstance(event, types.Message):
            try:
                await event.answer(
                    "⚠️ <b>Эта команда работает только в группе.</b>\n\n"
                    "💬 Добавьте бота в группу и используйте команду там.",
                    parse_mode="HTML",
                )
            except Exception:
                pass
        return False
    except Exception:
        return False


# ================== РЕЗОЛВ ЦЕЛИ ==================
async def _resolve_target(message: types.Message, args: list):
    """
    Возвращает (target_id, target_name, remaining_args) или (None, ..., args).
    Поддерживает:
      - reply
      - @username
      - user_id
    """
    chat = message.chat
    # 1. reply
    if message.reply_to_message and message.reply_to_message.from_user:
        u = message.reply_to_message.from_user
        return u.id, (u.full_name or f"ID {u.id}"), args

    if not args:
        return None, None, args

    first = args[0]
    rest = args[1:]

    # 2. @username
    if first.startswith("@"):
        uname = first[1:]
        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("SELECT user_id FROM users WHERE LOWER(nickname) = ? LIMIT 1", (uname.lower(),))
                # не получим username из БД, попробуем напрямую
        except Exception:
            pass
        # Ищем в группе — но Telegram API не даёт поиск по username. Просим ID.
        try:
            m = await message.bot.get_chat_member(chat.id, first)
            u = m.user
            return u.id, (u.full_name or first), rest
        except Exception:
            pass
        # не нашли
        return None, None, args

    # 3. user_id
    try:
        uid = int(first)
        # проверим что в группе
        try:
            m = await message.bot.get_chat_member(chat.id, uid)
            u = m.user
            return uid, (u.full_name or f"ID {uid}"), rest
        except Exception:
            return None, None, args
    except ValueError:
        return None, None, args


# ================== ОБЩИЕ ПРОВЕРКИ МОДЕРАЦИИ ==================
async def _pre_mod_checks(event, action: str, target_id: int):
    """Возвращает dict с результатом."""
    res = {"ok": False, "reason": "", "actor_rank": 0, "target_rank": 0,
           "target_name": None, "target_is_tg_admin": False}
    try:
        chat = getattr(event, "chat", None) or getattr(getattr(event, "message", None), "chat", None)
        user = event.from_user
        if not chat or not user:
            res["reason"] = "Нет данных"; return res
        if chat.type not in ("group", "supergroup"):
            res["reason"] = "Только для групп"; return res

        actor_rank = await effective_rank(event.bot, chat.id, user.id)
        if not can_use_action(chat.id, user.id, actor_rank, action):
            res["reason"] = "Недостаточно прав"; return res

        if not await is_telegram_admin(event.bot, chat.id, user.id):
            res["reason"] = "Вы не администратор Telegram-группы"; return res

        if target_id == user.id:
            res["reason"] = "Нельзя применить к себе"; return res

        if not await is_group_member(event.bot, chat.id, target_id):
            res["reason"] = "Пользователь не в группе"; return res

        real_owner = await get_real_owner(event.bot, chat.id)
        if real_owner and target_id == real_owner:
            res["reason"] = "Нельзя применять к владельцу"; return res

        target_rank = await effective_rank(event.bot, chat.id, target_id)
        if target_rank == RANK_OWNER:
            res["reason"] = "Нельзя применять к владельцу"; return res
        if actor_rank <= target_rank and actor_rank != RANK_OWNER:
            res["reason"] = "Нельзя применять к равному или выше по должности"; return res

        try:
            m = await event.bot.get_chat_member(chat.id, target_id)
            res["target_name"] = m.user.full_name or f"ID {target_id}"
        except Exception:
            res["target_name"] = f"ID {target_id}"

        res["target_is_tg_admin"] = await is_telegram_admin(event.bot, chat.id, target_id)
        res["ok"] = True
        res["actor_rank"] = actor_rank
        res["target_rank"] = target_rank
        return res
    except Exception as e:
        logger.exception("_pre_mod_checks failed: %s", e)
        res["reason"] = "Внутренняя ошибка"
        return res


async def _deny(event, msg: str):
    try:
        if isinstance(event, types.CallbackQuery):
            await event.answer(f"⛔ {msg}", show_alert=True)
        else:
            await event.reply(f"⛔ {msg}")
    except Exception:
        pass


async def _respond_no_target(event):
    try:
        await event.reply(
            "⚠️ <b>Не указан пользователь</b>\n\n"
            "Ответьте на сообщение или укажите ID/@username:\n"
            "<code>Мут 30м Причина</code>\n"
            "<code>Бан 123456789 Причина</code>"
        )
    except Exception:
        pass


async def _respond_tg_admin_error(event):
    try:
        await event.reply(
            "⚠️ <b>Наказание невозможно</b>\n\n"
            "👤 Пользователь является администратором Telegram-группы.\n\n"
            "Чтобы применить наказание, сначала необходимо снять его с администраторов Telegram."
        )
    except Exception:
        pass


# ================== TELEGRAM API ДЕЙСТВИЯ ==================
async def _try_restrict(bot, chat_id: int, user_id: int, until_ts: int):
    try:
        from aiogram.types import ChatPermissions
        perms = ChatPermissions(
            can_send_messages=False, can_send_media_messages=False,
            can_send_polls=False, can_send_other_messages=False,
            can_add_web_page_previews=False, can_change_info=False,
            can_invite_users=False, can_pin_messages=False,
        )
        until = until_ts if until_ts else None
        await bot.restrict_chat_member(chat_id=chat_id, user_id=user_id, permissions=perms, until_date=until)
        return True, ""
    except Exception as e:
        return False, str(e)


async def _try_unrestrict(bot, chat_id: int, user_id: int):
    try:
        from aiogram.types import ChatPermissions
        perms = ChatPermissions(
            can_send_messages=True, can_send_media_messages=True,
            can_send_polls=True, can_send_other_messages=True,
            can_add_web_page_previews=True, can_invite_users=True,
        )
        await bot.restrict_chat_member(chat_id=chat_id, user_id=user_id, permissions=perms)
        return True, ""
    except Exception as e:
        return False, str(e)


async def _try_ban(bot, chat_id: int, user_id: int):
    try:
        await bot.ban_chat_member(chat_id=chat_id, user_id=user_id)
        return True, ""
    except Exception as e:
        return False, str(e)


async def _try_unban(bot, chat_id: int, user_id: int):
    try:
        await bot.unban_chat_member(chat_id=chat_id, user_id=user_id, only_if_banned=True)
        return True, ""
    except Exception as e:
        return False, str(e)


async def _try_kick(bot, chat_id: int, user_id: int):
    try:
        await bot.ban_chat_member(chat_id=chat_id, user_id=user_id)
        await bot.unban_chat_member(chat_id=chat_id, user_id=user_id, only_if_banned=True)
        return True, ""
    except Exception as e:
        return False, str(e)


def _is_tg_admin_error(err: str) -> bool:
    e = (err or "").lower()
    return "administrator" in e or "not enough rights" in e or "chat_admin_required" in e


# ================== БАН ==================
_BAN_RE = re.compile(r"^(?:бан|/ban)(?:@\w+)?(?:\s+(.+))?$", re.IGNORECASE)


@router.message(F.text.regexp(r"^(бан|/ban)(@\w+)?(\s|$)", flags=re.IGNORECASE))
async def cmd_ban(message: types.Message):
    try:
        if not await require_group(message):
            return
        args_text = message.text or ""
        m = _BAN_RE.match(args_text.strip())
        tail = (m.group(1) or "").strip() if m else ""
        args = tail.split() if tail else []

        target_id, target_name, rest = await _resolve_target(message, args)
        if not target_id:
            await _respond_no_target(message)
            return

        check = await _pre_mod_checks(message, "ban", target_id)
        if not check["ok"]:
            await _deny(message, check["reason"])
            return

        chat_id = message.chat.id
        actor_id = message.from_user.id
        actor_rank = check["actor_rank"]
        target_name = check["target_name"]

        # антиабуз
        if actor_rank != RANK_OWNER:
            blocked = ban_abuse_is_blocked(chat_id, actor_id)
            if blocked:
                until = time.strftime("%d.%m.%Y %H:%M", time.localtime(blocked))
                await message.reply(
                    "🚫 <b>Бан временно недоступен</b>\n\n"
                    "🛡️ Система безопасности временно отключила ваше право на BAN.\n\n"
                    f"⏳ Доступ восстановится: <b>{until}</b>"
                )
                return

        if check["target_is_tg_admin"]:
            await _respond_tg_admin_error(message)
            return

        reason = " ".join(rest) if rest else ""

        ok, err = await _try_ban(message.bot, chat_id, target_id)
        if not ok:
            if _is_tg_admin_error(err):
                await _respond_tg_admin_error(message)
            else:
                await message.reply("⚠️ Не удалось забанить пользователя.")
            return

        try:
            if message.reply_to_message:
                await message.reply_to_message.delete()
        except Exception:
            pass

        add_punish(chat_id, target_id, actor_id, "ban", reason, 0)
        add_log(chat_id, target_id, actor_id, "ban", reason=reason)

        if actor_rank != RANK_OWNER:
            rec = ban_abuse_register(chat_id, actor_id)
            if rec["temporary_block_until"] > int(time.time()):
                try:
                    await message.bot.send_message(
                        chat_id,
                        "⚠️ <b>Система безопасности</b>\n\n"
                        f"Обнаружена подозрительно высокая активность с использованием BAN.\n\n"
                        "🚫 Право на BAN временно отключено на <b>24 часа</b>."
                    )
                except Exception:
                    pass

        text = (
            "🚫 <b>Бан выдан</b>\n\n"
            f"👤 {_user_mention(target_id, target_name)}\n"
            f"🛡 Модератор: {_user_mention(actor_id, message.from_user.full_name)}"
        )
        if reason:
            text += f"\n📝 Причина: {_esc(reason)}"
        await message.reply(text, parse_mode="HTML")
    except Exception as e:
        logger.exception("cmd_ban failed: %s", e)


# ================== РАЗБАН ==================
_UNBAN_RE = re.compile(r"^(?:разбан|/unban)(?:@\w+)?(?:\s+(.+))?$", re.IGNORECASE)


@router.message(F.text.regexp(r"^(разбан|/unban)(@\w+)?(\s|$)", flags=re.IGNORECASE))
async def cmd_unban(message: types.Message):
    try:
        if not await require_group(message):
            return
        chat = message.chat
        rank = await effective_rank(message.bot, chat.id, message.from_user.id)
        if not can_use_action(chat.id, message.from_user.id, rank, "unban"):
            await _deny(message, "Недостаточно прав")
            return

        m = _UNBAN_RE.match((message.text or "").strip())
        tail = (m.group(1) or "").strip() if m else ""
        args = tail.split() if tail else []

        target_id, target_name, _ = await _resolve_target(message, args)
        if not target_id:
            await _respond_no_target(message)
            return

        ok, err = await _try_unban(message.bot, chat.id, target_id)
        if not ok:
            await message.reply("⚠️ Не удалось разбанить.")
            return
        remove_punish(chat.id, target_id, "ban")
        add_log(chat.id, target_id, message.from_user.id, "unban")
        await message.reply(f"✅ {_user_mention(target_id, target_name)} разбанен.", parse_mode="HTML")
    except Exception as e:
        logger.exception("cmd_unban failed: %s", e)


# ================== МУТ ==================
_MUTE_RE = re.compile(r"^(?:мут|/mute)(?:@\w+)?(?:\s+(.+))?$", re.IGNORECASE)


@router.message(F.text.regexp(r"^(мут|/mute)(@\w+)?(\s|$)", flags=re.IGNORECASE))
async def cmd_mute(message: types.Message):
    try:
        if not await require_group(message):
            return
        m = _MUTE_RE.match((message.text or "").strip())
        tail = (m.group(1) or "").strip() if m else ""
        args = tail.split() if tail else []

        target_id, target_name, rest = await _resolve_target(message, args)
        if not target_id:
            await _respond_no_target(message)
            return

        check = await _pre_mod_checks(message, "mute", target_id)
        if not check["ok"]:
            await _deny(message, check["reason"])
            return

        # ищем срок и причину
        duration_arg, reason_args = None, []
        for a in rest:
            if duration_arg is None and parse_duration(a):
                duration_arg = a
            else:
                reason_args.append(a)
        reason = " ".join(reason_args).strip()

        if not duration_arg:
            await message.reply(
                "⚠️ Укажите срок мута:\n"
                "<code>10м 30м 1ч 6ч 12ч 1д</code>\n\n"
                "Пример: <code>Мут 30м Спам</code>"
            )
            return

        duration = parse_duration(duration_arg)
        if not duration:
            await message.reply("⚠️ Неверный срок.")
            return

        if check["target_is_tg_admin"]:
            await _respond_tg_admin_error(message)
            return

        until = int(time.time()) + duration
        ok, err = await _try_restrict(message.bot, message.chat.id, target_id, until)
        if not ok:
            if _is_tg_admin_error(err):
                await _respond_tg_admin_error(message)
            else:
                await message.reply("⚠️ Не удалось замутить.")
            return

        try:
            if message.reply_to_message:
                await message.reply_to_message.delete()
        except Exception:
            pass

        remove_punish(message.chat.id, target_id, "mute")
        add_punish(message.chat.id, target_id, message.from_user.id, "mute", reason, duration)
        add_log(message.chat.id, target_id, message.from_user.id, "mute",
                reason=reason, duration=duration)

        text = (
            "🔇 <b>Мут выдан</b>\n\n"
            f"👤 {_user_mention(target_id, target_name)}\n"
            f"🛡 Модератор: {_user_mention(message.from_user.id, message.from_user.full_name)}\n"
            f"⏱ Срок: <b>{fmt_duration(duration)}</b>"
        )
        if reason:
            text += f"\n📝 Причина: {_esc(reason)}"
        await message.reply(text, parse_mode="HTML")
    except Exception as e:
        logger.exception("cmd_mute failed: %s", e)


# ================== РАЗМУТ ==================
_UNMUTE_RE = re.compile(r"^(?:размут|/unmute)(?:@\w+)?(?:\s+(.+))?$", re.IGNORECASE)


@router.message(F.text.regexp(r"^(размут|/unmute)(@\w+)?(\s|$)", flags=re.IGNORECASE))
async def cmd_unmute(message: types.Message):
    try:
        if not await require_group(message):
            return
        chat = message.chat
        rank = await effective_rank(message.bot, chat.id, message.from_user.id)
        if not can_use_action(chat.id, message.from_user.id, rank, "unmute"):
            await _deny(message, "Недостаточно прав")
            return

        m = _UNMUTE_RE.match((message.text or "").strip())
        tail = (m.group(1) or "").strip() if m else ""
        args = tail.split() if tail else []

        target_id, target_name, _ = await _resolve_target(message, args)
        if not target_id:
            await _respond_no_target(message)
            return

        ok, err = await _try_unrestrict(message.bot, chat.id, target_id)
        if not ok:
            await message.reply("⚠️ Не удалось снять мут.")
            return
        remove_punish(chat.id, target_id, "mute")
        add_log(chat.id, target_id, message.from_user.id, "unmute")
        await message.reply(f"🔊 {_user_mention(target_id, target_name)} размучен.", parse_mode="HTML")
    except Exception as e:
        logger.exception("cmd_unmute failed: %s", e)


# ================== КИК ==================
_KICK_RE = re.compile(r"^(?:кик|/kick)(?:@\w+)?(?:\s+(.+))?$", re.IGNORECASE)


@router.message(F.text.regexp(r"^(кик|/kick)(@\w+)?(\s|$)", flags=re.IGNORECASE))
async def cmd_kick(message: types.Message):
    try:
        if not await require_group(message):
            return
        m = _KICK_RE.match((message.text or "").strip())
        tail = (m.group(1) or "").strip() if m else ""
        args = tail.split() if tail else []

        target_id, target_name, rest = await _resolve_target(message, args)
        if not target_id:
            await _respond_no_target(message)
            return

        check = await _pre_mod_checks(message, "kick", target_id)
        if not check["ok"]:
            await _deny(message, check["reason"])
            return

        if check["target_is_tg_admin"]:
            await _respond_tg_admin_error(message)
            return

        reason = " ".join(rest).strip() if rest else ""
        ok, err = await _try_kick(message.bot, message.chat.id, target_id)
        if not ok:
            if _is_tg_admin_error(err):
                await _respond_tg_admin_error(message)
            else:
                await message.reply("⚠️ Не удалось кикнуть.")
            return

        try:
            if message.reply_to_message:
                await message.reply_to_message.delete()
        except Exception:
            pass

        add_log(message.chat.id, target_id, message.from_user.id, "kick", reason=reason)

        text = (
            "👢 <b>Кик выдан</b>\n\n"
            f"👤 {_user_mention(target_id, target_name)}\n"
            f"🛡 Модератор: {_user_mention(message.from_user.id, message.from_user.full_name)}"
        )
        if reason:
            text += f"\n📝 Причина: {_esc(reason)}"
        await message.reply(text, parse_mode="HTML")
    except Exception as e:
        logger.exception("cmd_kick failed: %s", e)


# ================== ВАРН ==================
_WARN_RE = re.compile(r"^(?:варн|/warn)(?:@\w+)?(?:\s+(.+))?$", re.IGNORECASE)


@router.message(F.text.regexp(r"^(варн|/warn)(@\w+)?(\s|$)", flags=re.IGNORECASE))
async def cmd_warn(message: types.Message):
    try:
        if not await require_group(message):
            return
        m = _WARN_RE.match((message.text or "").strip())
        tail = (m.group(1) or "").strip() if m else ""
        args = tail.split() if tail else []

        target_id, target_name, rest = await _resolve_target(message, args)
        if not target_id:
            await _respond_no_target(message)
            return

        check = await _pre_mod_checks(message, "warn", target_id)
        if not check["ok"]:
            await _deny(message, check["reason"])
            return

        reason = " ".join(rest).strip() if rest else ""
        total = add_warn(message.chat.id, target_id, message.from_user.id, reason)
        add_log(message.chat.id, target_id, message.from_user.id, "warn",
                reason=reason, extra=f"total={total}")

        try:
            if message.reply_to_message:
                await message.reply_to_message.delete()
        except Exception:
            pass

        settings = get_settings(message.chat.id)
        limit = int(settings.get("warn_limit") or 3)

        text = (
            "⚠️ <b>Предупреждение</b>\n\n"
            f"👤 {_user_mention(target_id, target_name)}\n"
            f"📊 Предупреждений: <b>{total} / {limit}</b>"
        )
        if reason:
            text += f"\n📝 Причина: {_esc(reason)}"
        await message.reply(text, parse_mode="HTML")

        if limit > 0 and total >= limit:
            await _apply_auto_punish(
                bot=message.bot, chat_id=message.chat.id, user_id=target_id,
                user_name=target_name, moderator_id=message.from_user.id,
                settings=settings,
            )
    except Exception as e:
        logger.exception("cmd_warn failed: %s", e)


# ================== СНЯТЬ ВАРН ==================
_UNWARN_RE = re.compile(r"^(?:снять\s+варн|/unwarn)(?:@\w+)?(?:\s+(.+))?$", re.IGNORECASE)


@router.message(F.text.regexp(r"^(снять\s+варн|/unwarn)(@\w+)?(\s|$)", flags=re.IGNORECASE))
async def cmd_unwarn(message: types.Message):
    try:
        if not await require_group(message):
            return
        chat = message.chat
        rank = await effective_rank(message.bot, chat.id, message.from_user.id)
        if not can_use_action(chat.id, message.from_user.id, rank, "unwarn"):
            await _deny(message, "Недостаточно прав")
            return

        m = _UNWARN_RE.match((message.text or "").strip())
        tail = (m.group(1) or "").strip() if m else ""
        args = tail.split() if tail else []

        target_id, target_name, _ = await _resolve_target(message, args)
        if not target_id:
            await _respond_no_target(message)
            return

        ok = clear_last_warn(chat.id, target_id)
        add_log(chat.id, target_id, message.from_user.id, "unwarn")
        if not ok:
            await message.reply(f"⚠️ У {_user_mention(target_id, target_name)} нет активных варнов.", parse_mode="HTML")
            return

        total = warn_count(chat.id, target_id)
        settings = get_settings(chat.id)
        limit = int(settings.get("warn_limit") or 3)
        await message.reply(
            f"✅ Снято предупреждение.\n"
            f"👤 {_user_mention(target_id, target_name)}\n"
            f"📊 Осталось: <b>{total} / {limit}</b>",
            parse_mode="HTML",
        )
    except Exception as e:
        logger.exception("cmd_unwarn failed: %s", e)


# ================== ВАРНЫ ==================
_WARNINGS_RE = re.compile(r"^(?:варны|/warnings)(?:@\w+)?(?:\s+(.+))?$", re.IGNORECASE)


@router.message(F.text.regexp(r"^(варны|/warnings)(@\w+)?(\s|$)", flags=re.IGNORECASE))
async def cmd_warnings(message: types.Message):
    try:
        if not await require_group(message):
            return
        chat = message.chat
        rank = await effective_rank(message.bot, chat.id, message.from_user.id)
        if not can_use_action(chat.id, message.from_user.id, rank, "warnings_view"):
            await _deny(message, "Недостаточно прав")
            return

        m = _WARNINGS_RE.match((message.text or "").strip())
        tail = (m.group(1) or "").strip() if m else ""
        args = tail.split() if tail else []

        target_id, target_name, _ = await _resolve_target(message, args)
        if not target_id:
            target_id = message.from_user.id
            target_name = message.from_user.full_name or f"ID {target_id}"

        total = warn_count(chat.id, target_id)
        settings = get_settings(chat.id)
        limit = int(settings.get("warn_limit") or 3)

        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("""
                    SELECT moderator_id, reason, created_at FROM group_warns
                    WHERE chat_id = ? AND user_id = ? AND active = 1
                    ORDER BY id DESC LIMIT 10
                """, (chat.id, target_id))
                rows = cur.fetchall() or []
        except Exception:
            rows = []

        lines = [
            "📋 <b>Предупреждения</b>", "",
            f"👤 {_user_mention(target_id, target_name)}",
            f"📊 Активных: <b>{total} / {limit}</b>",
        ]
        for mod_id, reason, ts in rows:
            try:
                d = time.strftime("%d.%m %H:%M", time.localtime(int(ts or 0)))
            except Exception:
                d = "—"
            r = _esc(reason) if reason else "<i>без причины</i>"
            lines.append(f"• {d} — {r} (от {_user_mention(mod_id)})")
        await message.reply("\n".join(lines), parse_mode="HTML")
    except Exception as e:
        logger.exception("cmd_warnings failed: %s", e)


# ================== УДАЛИТЬ ==================
_DEL_RE = re.compile(r"^(?:удалить|/del)(?:@\w+)?(?:\s+(\d+))?$", re.IGNORECASE)


@router.message(F.text.regexp(r"^(удалить|/del)(@\w+)?(\s|$)", flags=re.IGNORECASE))
async def cmd_del(message: types.Message):
    try:
        if not await require_group(message):
            return
        chat = message.chat
        rank = await effective_rank(message.bot, chat.id, message.from_user.id)
        if not can_use_action(chat.id, message.from_user.id, rank, "delete_msg"):
            await _deny(message, "У вас нет доступа к удалению сообщений.")
            return

        ok_bot, err = await bot_can_delete(message.bot, chat.id)
        if not ok_bot:
            await message.reply("⚠️ Бот не может удалять сообщения в этой группе.")
            return

        m = _DEL_RE.match((message.text or "").strip())
        msg_id_arg = m.group(1) if m else None

        target_id = 0
        if message.reply_to_message:
            target_id = message.reply_to_message.from_user.id if message.reply_to_message.from_user else 0
            try:
                await message.reply_to_message.delete()
            except Exception:
                await message.reply("⚠️ Не удалось удалить сообщение.")
                return
            try:
                await message.delete()
            except Exception:
                pass
            add_log(chat.id, target_id, message.from_user.id, "delete_msg")
            return

        if msg_id_arg:
            try:
                await message.bot.delete_message(chat_id=chat.id, message_id=int(msg_id_arg))
                try:
                    await message.delete()
                except Exception:
                    pass
                add_log(chat.id, 0, message.from_user.id, "delete_msg",
                        extra=f"msg_id={msg_id_arg}")
                return
            except Exception:
                await message.reply("⚠️ Не удалось удалить сообщение.")
                return

        await message.reply("⚠️ Ответьте на сообщение или укажите ID:\n<code>Удалить 123</code>")
    except Exception as e:
        logger.exception("cmd_del failed: %s", e)


# ================== МУТЫ ==================
@router.message(F.text.casefold().in_({"муты", "/mutes", "активные муты"}))
async def cmd_mutes(message: types.Message):
    try:
        if not await require_group(message):
            return
        chat = message.chat
        rank = await effective_rank(message.bot, chat.id, message.from_user.id)
        if not can_use_action(chat.id, message.from_user.id, rank, "mutes_view"):
            await _deny(message, "Недостаточно прав")
            return

        mutes = list_active_mutes(chat.id, limit=20)
        if not mutes:
            await message.reply("🔇 Активных мутов нет.")
            return

        lines = ["🔇 <b>Активные муты</b>", ""]
        for m in mutes:
            uid = m["user_id"]
            rem = m["remaining"]
            reason = m["reason"]
            try:
                u = await message.bot.get_chat_member(chat.id, uid)
                name = u.user.full_name or f"ID {uid}"
            except Exception:
                name = f"ID {uid}"
            line = f"👤 {_user_mention(uid, name)}\n⏳ Осталось: {fmt_duration(rem) if rem else 'бессрочно'}"
            if reason:
                line += f"\n📝 Причина: {_esc(reason)}"
            lines.append(line)
        await message.reply("\n\n".join(lines), parse_mode="HTML")
    except Exception as e:
        logger.exception("cmd_mutes failed: %s", e)


# ================== АВТОЛИМИТ ВАРНОВ ==================
async def _apply_auto_punish(bot, chat_id: int, user_id: int, user_name: str,
                             moderator_id: int, settings: dict):
    try:
        action = (settings.get("warn_action") or "mute_1h").lower()
        duration = 0
        do_mute = do_ban = do_kick = False

        if action.startswith("mute_"):
            duration = parse_duration(action.replace("mute_", "")) or 3600
            do_mute = True
        elif action == "ban":
            do_ban = True
        elif action == "kick":
            do_kick = True
        else:
            do_mute = True; duration = 3600

        done = False
        if do_mute:
            until = int(time.time()) + duration
            ok, err = await _try_restrict(bot, chat_id, user_id, until)
            if ok:
                add_punish(chat_id, user_id, moderator_id, "mute",
                           "auto (лимит предупреждений)", duration)
                add_log(chat_id, user_id, moderator_id, "auto_mute",
                        reason="Достигнут лимит предупреждений",
                        duration=duration, extra="auto")
                done = True
        elif do_ban:
            ok, err = await _try_ban(bot, chat_id, user_id)
            if ok:
                add_punish(chat_id, user_id, moderator_id, "ban",
                           "auto (лимит предупреждений)", 0)
                add_log(chat_id, user_id, moderator_id, "auto_ban",
                        reason="Достигнут лимит предупреждений", extra="auto")
                done = True
        elif do_kick:
            ok, err = await _try_kick(bot, chat_id, user_id)
            if ok:
                add_log(chat_id, user_id, moderator_id, "auto_kick",
                        reason="Достигнут лимит предупреждений", extra="auto")
                done = True

        if done:
            cleared = clear_all_warns(chat_id, user_id)
            lines = [
                "🚨 <b>Автоматическое наказание</b>", "",
                f"👤 {_user_mention(user_id, user_name)}",
                "📊 Достигнут лимит предупреждений",
            ]
            if do_mute: lines.append(f"🔇 Мут на <b>{fmt_duration(duration)}</b>")
            elif do_ban: lines.append("🚫 Бан")
            elif do_kick: lines.append("👢 Кик")
            if cleared: lines.append(f"🔄 Варны сброшены ({cleared})")
            try:
                await bot.send_message(chat_id, "\n".join(lines), parse_mode="HTML")
            except Exception:
                pass
    except Exception as e:
        logger.exception("_apply_auto_punish failed: %s", e)
# ================== /admins ==================
async def _build_admins_view(bot, chat_id: int, viewer_id: int):
    staff = list_staff(chat_id)
    by_rank = {5: [], 4: [], 3: [], 2: [], 1: []}
    for uid, r in staff:
        if r in by_rank:
            by_rank[r].append(uid)

    lines = ["🛡️ <b>Администрация группы</b>", ""]
    for r in (5, 4, 3, 2, 1):
        lines.append(f"{rank_emoji(r)} <b>{rank_name(r)}</b>")
        if by_rank[r]:
            for uid in by_rank[r]:
                try:
                    m = await bot.get_chat_member(chat_id, uid)
                    name = m.user.full_name or f"ID {uid}"
                except Exception:
                    name = f"ID {uid}"
                lines.append(f"└─ {_user_mention(uid, name)}")
        else:
            lines.append("└─ Пока никого нет")
        lines.append("")

    text = "\n".join(lines)
    viewer_rank = await effective_rank(bot, chat_id, viewer_id)
    max_manage = MANAGE_MAX.get(viewer_rank)

    kb_rows = []
    if max_manage is not None:
        for r in (4, 3, 2, 1):
            if r > max_manage:
                continue
            if not by_rank.get(r):
                continue
            kb_rows.append([types.InlineKeyboardButton(
                text=f"{rank_emoji(r)} Управление · {rank_name(r)}",
                callback_data=f"gh_list_{r}"
            )])
        if max_manage >= 1:
            kb_rows.append([types.InlineKeyboardButton(
                text="➕ Назначить должность", callback_data="gh_assign_menu"
            )])

    kb = types.InlineKeyboardMarkup(inline_keyboard=kb_rows) if kb_rows else None
    return text, kb


@router.message(F.text.casefold().in_({"админы", "администрация", "/admins", "admins"}))
async def cmd_admins(message: types.Message):
    try:
        if not await require_group(message):
            return
        if not message.from_user:
            return
        text, kb = await _build_admins_view(message.bot, message.chat.id, message.from_user.id)
        await message.reply(text, parse_mode="HTML", reply_markup=kb)
    except Exception as e:
        logger.exception("cmd_admins failed: %s", e)


@router.callback_query(F.data == "gh_admins")
async def cb_admins(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        text, kb = await _build_admins_view(callback.bot, chat.id, callback.from_user.id)
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_admins failed: %s", e)


@router.callback_query(F.data.startswith("gh_list_"))
async def cb_list_rank(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        viewer_id = callback.from_user.id
        try:
            rank_view = int((callback.data or "").replace("gh_list_", ""))
        except ValueError:
            return
        viewer_rank = await effective_rank(callback.bot, chat.id, viewer_id)
        max_manage = MANAGE_MAX.get(viewer_rank)
        if max_manage is None or rank_view > max_manage:
            await callback.answer("⛔ Недостаточно прав", show_alert=True)
            return

        staff = list_staff(chat.id)
        target_ids = [u for u, r in staff if r == rank_view]
        lines = [f"{rank_emoji(rank_view)} <b>{rank_name(rank_view)}</b>", ""]
        kb_rows = []
        for tid in target_ids:
            try:
                m = await callback.bot.get_chat_member(chat.id, tid)
                name = m.user.full_name or f"ID {tid}"
            except Exception:
                name = f"ID {tid}"
            lines.append(f"└─ {_user_mention(tid, name)}")
            kb_rows.append([types.InlineKeyboardButton(
                text=f"👤 {name[:24]}", callback_data=f"gh_user_{tid}"
            )])
        if not target_ids:
            lines.append("└─ Пока никого нет")
        kb_rows.append([types.InlineKeyboardButton(text="◀️ Назад", callback_data="gh_admins")])
        kb = types.InlineKeyboardMarkup(inline_keyboard=kb_rows)
        try:
            await callback.message.edit_text("\n".join(lines), parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_list_rank failed: %s", e)


async def _build_user_card(bot, chat_id: int, viewer_id: int, target_id: int):
    target_rank = await effective_rank(bot, chat_id, target_id)
    viewer_rank = await effective_rank(bot, chat_id, viewer_id)
    try:
        m = await bot.get_chat_member(chat_id, target_id)
        name = m.user.full_name or f"ID {target_id}"
        username = m.user.username
    except Exception:
        name = f"ID {target_id}"
        username = None

    lines = ["👤 <b>Участник</b>", "", f"└─ {_user_mention(target_id, name)}"]
    if username:
        lines.append(f"└─ @{_esc(username)}")
    lines.append(f"└─ {rank_emoji(target_rank)} <b>{rank_name(target_rank)}</b>")

    if target_rank > 0:
        lines.append("")
        lines.append("🛡️ <b>Доступ к модерации:</b>")
        for key in PERM_KEYS:
            individual = has_individual_perm(chat_id, target_id, key)
            base_ok = can_do(target_rank, key)
            mark = "🚫" if individual == 0 else ("✅" if individual == 1 or base_ok else "❌")
            label = {"ban": "Бан", "mute": "Мут", "warn": "Warn", "kick": "Kick"}[key]
            lines.append(f"{mark} {label}")

    text = "\n".join(lines)
    rows = []
    can_manage = can_manage_rank(viewer_rank, target_rank)

    if can_manage:
        if target_rank < RANK_CHIEF:
            rows.append([types.InlineKeyboardButton(text="📈 Повысить", callback_data=f"gh_promote_{target_id}")])
        if target_rank > RANK_HELPER:
            rows.append([types.InlineKeyboardButton(text="📉 Понизить", callback_data=f"gh_demote_{target_id}")])
        rows.append([types.InlineKeyboardButton(text="❌ Снять должность", callback_data=f"gh_remove_{target_id}")])

    if viewer_rank == RANK_OWNER and 0 < target_rank < RANK_OWNER:
        for key in PERM_KEYS:
            individual = has_individual_perm(chat_id, target_id, key)
            label = {"ban": "бан", "mute": "мут", "warn": "warn", "kick": "kick"}[key]
            if individual == 0:
                btn = f"✅ Дать {label}"; val = -1
            else:
                btn = f"🚫 Забрать {label}"; val = 0
            rows.append([types.InlineKeyboardButton(text=btn, callback_data=f"gh_perm_{key}_{val}_{target_id}")])

    rows.append([types.InlineKeyboardButton(text="◀️ Назад", callback_data="gh_admins")])
    kb = types.InlineKeyboardMarkup(inline_keyboard=rows)
    return text, kb


@router.callback_query(F.data.startswith("gh_user_"))
async def cb_user_card(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        try:
            target_id = int((callback.data or "").replace("gh_user_", ""))
        except ValueError:
            return
        text, kb = await _build_user_card(callback.bot, chat.id, callback.from_user.id, target_id)
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_user_card failed: %s", e)


@router.callback_query(F.data.startswith("gh_perm_"))
async def cb_perm_toggle(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        viewer_id = callback.from_user.id
        parts = (callback.data or "").split("_")
        if len(parts) < 5:
            return
        key = parts[2]
        try:
            value = int(parts[3]); target_id = int(parts[4])
        except ValueError:
            return
        if key not in PERM_KEYS or value not in (-1, 0):
            return
        viewer_rank = await effective_rank(callback.bot, chat.id, viewer_id)
        if viewer_rank != RANK_OWNER:
            await callback.answer("⛔ Только владелец может менять права", show_alert=True)
            return
        target_rank = await effective_rank(callback.bot, chat.id, target_id)
        if target_rank == RANK_OWNER or target_rank <= 0:
            await callback.answer("⛔ Недопустимая цель", show_alert=True)
            return
        if not set_perm(chat.id, target_id, key, value):
            await callback.answer("⚠️ Ошибка", show_alert=True)
            return
        if key == "ban":
            ban_abuse_manual_perm_set(chat.id, target_id, value)
        add_log(chat.id, target_id, viewer_id, "perm_change",
                reason=f"{key}={value}", extra=f"perm_{key}")
        text, kb = await _build_user_card(callback.bot, chat.id, viewer_id, target_id)
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_perm_toggle failed: %s", e)


def _confirm_kb(action: str, target_id: int) -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="✅ Подтвердить", callback_data=f"gh_do_{action}_{target_id}")],
            [types.InlineKeyboardButton(text="❌ Отмена", callback_data=f"gh_user_{target_id}")],
        ]
    )


@router.callback_query(F.data.startswith("gh_promote_"))
async def cb_promote(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        viewer_id = callback.from_user.id
        try:
            target_id = int((callback.data or "").replace("gh_promote_", ""))
        except ValueError:
            return
        target_rank = await effective_rank(callback.bot, chat.id, target_id)
        viewer_rank = await effective_rank(callback.bot, chat.id, viewer_id)
        if not can_manage_rank(viewer_rank, target_rank):
            await callback.answer("⛔ Недостаточно прав", show_alert=True)
            return
        if target_rank >= RANK_CHIEF:
            await callback.answer("Уже максимальная должность", show_alert=True)
            return
        new_rank = target_rank + 1
        if not await is_telegram_admin(callback.bot, chat.id, target_id):
            try:
                m = await callback.bot.get_chat_member(chat.id, target_id)
                name = m.user.full_name or f"ID {target_id}"
            except Exception:
                name = f"ID {target_id}"
            await callback.answer("⛔ Пользователь не является администратором этой Telegram-группы.", show_alert=True)
            try:
                await callback.bot.send_message(
                    chat.id,
                    f"❌ <b>Нельзя назначить должность.</b>\n\n"
                    f"👤 {_user_mention(target_id, name)}\n\n"
                    "Пользователь не является администратором Telegram-группы.\n"
                    "Сначала назначьте его администратором в настройках Telegram.",
                    parse_mode="HTML"
                )
            except Exception:
                pass
            return
        try:
            m = await callback.bot.get_chat_member(chat.id, target_id)
            name = m.user.full_name or f"ID {target_id}"
        except Exception:
            name = f"ID {target_id}"
        text = (
            "📈 <b>Повышение должности</b>\n\n"
            f"👤 Игрок: {_user_mention(target_id, name)}\n\n"
            f"{rank_emoji(target_rank)} {rank_name(target_rank)} → "
            f"{rank_emoji(new_rank)} {rank_name(new_rank)}\n\n"
            "Подтвердить?"
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=_confirm_kb("promote", target_id))
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_promote failed: %s", e)


@router.callback_query(F.data.startswith("gh_demote_"))
async def cb_demote(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        viewer_id = callback.from_user.id
        try:
            target_id = int((callback.data or "").replace("gh_demote_", ""))
        except ValueError:
            return
        target_rank = await effective_rank(callback.bot, chat.id, target_id)
        viewer_rank = await effective_rank(callback.bot, chat.id, viewer_id)
        if not can_manage_rank(viewer_rank, target_rank) or target_rank <= RANK_HELPER:
            await callback.answer("⛔ Невозможно", show_alert=True)
            return
        new_rank = target_rank - 1
        try:
            m = await callback.bot.get_chat_member(chat.id, target_id)
            name = m.user.full_name or f"ID {target_id}"
        except Exception:
            name = f"ID {target_id}"
        text = (
            "📉 <b>Понижение должности</b>\n\n"
            f"👤 Игрок: {_user_mention(target_id, name)}\n\n"
            f"{rank_emoji(target_rank)} {rank_name(target_rank)} → "
            f"{rank_emoji(new_rank)} {rank_name(new_rank)}\n\n"
            "Подтвердить?"
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=_confirm_kb("demote", target_id))
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_demote failed: %s", e)


@router.callback_query(F.data.startswith("gh_remove_"))
async def cb_remove(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        viewer_id = callback.from_user.id
        try:
            target_id = int((callback.data or "").replace("gh_remove_", ""))
        except ValueError:
            return
        target_rank = await effective_rank(callback.bot, chat.id, target_id)
        viewer_rank = await effective_rank(callback.bot, chat.id, viewer_id)
        if not can_manage_rank(viewer_rank, target_rank):
            await callback.answer("⛔ Недостаточно прав", show_alert=True)
            return
        try:
            m = await callback.bot.get_chat_member(chat.id, target_id)
            name = m.user.full_name or f"ID {target_id}"
        except Exception:
            name = f"ID {target_id}"
        text = (
            "❌ <b>Снятие должности</b>\n\n"
            f"👤 Игрок: {_user_mention(target_id, name)}\n"
            f"{rank_emoji(target_rank)} {rank_name(target_rank)} → 👤 Участник\n\n"
            "Подтвердить?"
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=_confirm_kb("remove", target_id))
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_remove failed: %s", e)


@router.callback_query(F.data.startswith("gh_do_"))
async def cb_do_action(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        viewer_id = callback.from_user.id
        parts = (callback.data or "").split("_")
        if len(parts) < 4:
            return
        action = parts[2]
        try:
            target_id = int(parts[3])
        except ValueError:
            return
        target_rank = await effective_rank(callback.bot, chat.id, target_id)
        viewer_rank = await effective_rank(callback.bot, chat.id, viewer_id)
        if not can_manage_rank(viewer_rank, target_rank):
            await callback.answer("⛔ Недостаточно прав", show_alert=True)
            return
        max_manage = MANAGE_MAX.get(viewer_rank)
        if max_manage is None or target_rank > max_manage:
            await callback.answer("⛔ Недостаточно прав", show_alert=True)
            return
        if target_id == viewer_id:
            await callback.answer("⛔ Нельзя менять свою должность", show_alert=True)
            return
        if target_rank == RANK_OWNER:
            await callback.answer("⛔ Владельца нельзя трогать", show_alert=True)
            return
        ok = False
        new_rank = target_rank
        if action == "promote":
            if target_rank < RANK_CHIEF:
                new_rank = target_rank + 1
                if not await is_telegram_admin(callback.bot, chat.id, target_id):
                    await callback.answer("⛔ Пользователь не Telegram-админ", show_alert=True)
                    return
                ok = set_rank(chat.id, target_id, new_rank, viewer_id)
                add_log(chat.id, target_id, viewer_id, "promote",
                        extra=f"{rank_name(target_rank)} -> {rank_name(new_rank)}")
        elif action == "demote":
            if target_rank > RANK_HELPER:
                new_rank = target_rank - 1
                ok = set_rank(chat.id, target_id, new_rank, viewer_id)
                add_log(chat.id, target_id, viewer_id, "demote",
                        extra=f"{rank_name(target_rank)} -> {rank_name(new_rank)}")
        elif action == "remove":
            new_rank = 0
            ok = set_rank(chat.id, target_id, 0, viewer_id)
            add_log(chat.id, target_id, viewer_id, "remove",
                    extra=f"was {rank_name(target_rank)}")
        else:
            return
        if not ok:
            await callback.answer("⚠️ Ошибка", show_alert=True)
            return
        text, kb = await _build_user_card(callback.bot, chat.id, viewer_id, target_id)
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_do_action failed: %s", e)


@router.callback_query(F.data == "gh_assign_menu")
async def cb_assign_menu(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        viewer_rank = await effective_rank(callback.bot, chat.id, callback.from_user.id)
        if MANAGE_MAX.get(viewer_rank) is None:
            await callback.answer("⛔ Недостаточно прав", show_alert=True)
            return
        text = (
            "➕ <b>Назначение должности</b>\n\n"
            "Ответьте на сообщение игрока командой:\n\n"
            "<code>Повысить 1</code> — 🔰 Хелпер\n"
            "<code>Повысить 2</code> — 🔨 Модератор\n"
            "<code>Повысить 3</code> — 🛡 Администратор\n"
            "<code>Повысить 4</code> — 💎 Главный администратор\n\n"
            "⚠️ Назначаемый должен быть <b>администратором Telegram-группы</b>."
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="◀️ Назад", callback_data="gh_admins")]]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_assign_menu failed: %s", e)


# ================== РУССКИЕ ПОВЫСИТЬ/ПОНИЗИТЬ ==================
_PROMOTE_RE = re.compile(r"^(?:повысить|/rank)\s+(\d)\s*$", re.IGNORECASE)
_DEMOTE_RE = re.compile(r"^понизить\s+(\d)\s*$", re.IGNORECASE)


async def _do_set_rank_reply(message, new_rank: int):
    chat = message.chat
    if not message.from_user:
        return
    if not message.reply_to_message or not message.reply_to_message.from_user:
        await message.reply("⚠️ Ответьте на сообщение игрока.")
        return
    target_id = message.reply_to_message.from_user.id
    target_rank = await effective_rank(message.bot, chat.id, target_id)
    actor_rank = await effective_rank(message.bot, chat.id, message.from_user.id)
    if not can_manage_rank(actor_rank, target_rank):
        await message.reply("⛔ Недостаточно прав.")
        return
    max_manage = MANAGE_MAX.get(actor_rank)
    if max_manage is None or new_rank > max_manage:
        await message.reply("⛔ Нельзя назначить выше своих полномочий.")
        return
    if target_id == message.from_user.id:
        await message.reply("⛔ Нельзя менять свою должность.")
        return
    if target_rank == RANK_OWNER:
        await message.reply("⛔ Владельца нельзя трогать.")
        return
    if new_rank >= RANK_HELPER:
        if not await is_telegram_admin(message.bot, chat.id, target_id):
            await message.reply(
                "❌ <b>Нельзя назначить должность.</b>\n\n"
                "Пользователь не является администратором Telegram-группы.\n"
                "Сначала назначьте его администратором в настройках Telegram.",
                parse_mode="HTML",
            )
            return
    ok = set_rank(chat.id, target_id, new_rank, message.from_user.id)
    if not ok:
        await message.reply("⚠️ Ошибка сохранения.")
        return
    add_log(chat.id, target_id, message.from_user.id, "set_rank",
            extra=f"{rank_name(target_rank)} -> {rank_name(new_rank)}")
    try:
        m = await message.bot.get_chat_member(chat.id, target_id)
        name = m.user.full_name or f"ID {target_id}"
    except Exception:
        name = f"ID {target_id}"
    await message.reply(
        f"✅ <b>Должность изменена</b>\n\n"
        f"👤 {_user_mention(target_id, name)}\n"
        f"{rank_emoji(new_rank)} <b>{rank_name(new_rank)}</b>",
        parse_mode="HTML",
    )


@router.message(F.text.regexp(r"^(?:повысить|/rank)\s+\d+\s*$"))
async def cmd_promote_ru(message: types.Message):
    try:
        if not await require_group(message):
            return
        m = _PROMOTE_RE.match((message.text or "").strip())
        if not m:
            return
        r = int(m.group(1))
        if r < 1 or r > 4:
            await message.reply("⚠️ Допустимые ранги: 1, 2, 3, 4.")
            return
        await _do_set_rank_reply(message, r)
    except Exception as e:
        logger.exception("cmd_promote_ru failed: %s", e)


@router.message(F.text.regexp(r"^понизить\s+\d+\s*$"))
async def cmd_demote_ru(message: types.Message):
    try:
        if not await require_group(message):
            return
        m = _DEMOTE_RE.match((message.text or "").strip())
        if not m:
            return
        new_r = int(m.group(1))
        if new_r < 0 or new_r > 4:
            await message.reply("⚠️ Допустимые ранги: 0–4.")
            return
        await _do_set_rank_reply(message, new_r)
    except Exception as e:
        logger.exception("cmd_demote_ru failed: %s", e)


# ================== /adminshelp С ВЫБОРОМ ГРУППЫ ==================
def _help_text_for_rank(rank: int) -> str:
    if rank == RANK_OWNER:
        return (
            "🛡️ <b>Администрация</b>\n\n"
            "🔨 <b>Модерация</b>\n"
            "• Бан — /ban\n"
            "• Разбан — /unban\n"
            "• Мут — /mute\n"
            "• Размут — /unmute\n"
            "• Кик — /kick\n"
            "• Варн — /warn\n"
            "• Снять варн — /unwarn\n"
            "• Варны — /warnings\n"
            "• Удалить — /del\n"
            "• Муты — /mutes\n\n"
            "⚙️ <b>Управление</b>\n"
            "• Админы — /admins\n"
            "• Повысить N (reply)\n"
            "• Понизить N (reply)\n\n"
            "🔧 <b>Настройки</b>\n"
            "• Настройки — /settings\n"
            "• Правила / +Правила / -Правила\n"
            "• +Приветствие / -Приветствие\n"
            "• Обязательная подписка\n"
            "• Логи — /logs\n"
            "• Справка — /modhelp"
        )
    if rank == RANK_CHIEF:
        return (
            "🛡️ <b>Главный администратор</b>\n\n"
            "🔨 <b>Модерация</b>\n"
            "• Бан — /ban\n"
            "• Разбан — /unban\n"
            "• Мут — /mute\n"
            "• Размут — /unmute\n"
            "• Кик — /kick\n"
            "• Варн — /warn\n"
            "• Снять варн — /unwarn\n"
            "• Варны — /warnings\n"
            "• Удалить — /del\n"
            "• Муты — /mutes\n\n"
            "⚙️ <b>Управление</b>\n"
            "• Админы — /admins\n"
            "• Повысить N (reply, до 3)\n"
            "• Понизить N (reply)\n\n"
            "🔧 <b>Прочее</b>\n"
            "• Логи — /logs\n"
            "• Справка — /modhelp"
        )
    if rank == RANK_ADMIN:
        return (
            "🛡️ <b>Администратор</b>\n\n"
            "🔨 <b>Модерация</b>\n"
            "• Бан — /ban\n"
            "• Разбан — /unban\n"
            "• Мут — /mute\n"
            "• Размут — /unmute\n"
            "• Кик — /kick\n"
            "• Варн — /warn\n"
            "• Снять варн — /unwarn\n"
            "• Варны — /warnings\n"
            "• Удалить — /del\n"
            "• Муты — /mutes\n\n"
            "⚙️ <b>Управление</b>\n"
            "• Админы — /admins\n"
            "• Повысить N (reply, до 2)\n"
            "• Понизить N (reply)\n\n"
            "🔧 <b>Прочее</b>\n"
            "• Логи — /logs\n"
            "• Справка — /modhelp"
        )
    if rank == RANK_MODER:
        return (
            "🔨 <b>Модератор</b>\n\n"
            "🔨 <b>Модерация</b>\n"
            "• Мут — /mute\n"
            "• Размут — /unmute\n"
            "• Кик — /kick\n"
            "• Варн — /warn\n"
            "• Снять варн — /unwarn\n"
            "• Варны — /warnings\n"
            "• Удалить — /del\n"
            "• Муты — /mutes\n\n"
            "🔧 <b>Прочее</b>\n"
            "• Админы — /admins\n"
            "• Справка — /modhelp\n\n"
            "<i>Бан и управление должностями недоступны.</i>"
        )
    if rank == RANK_HELPER:
        return (
            "🔰 <b>Хелпер</b>\n\n"
            "Начальная должность.\n\n"
            "<b>Доступно:</b>\n"
            "• Админы — /admins\n"
            "• Правила — Правила\n\n"
            "<i>Инструменты модерации пока недоступны.\n"
            "Покажите активность, чтобы владелец повысил вас.</i>"
        )
    return ""


@router.message(F.text.regexp(r"^/adminshelp(\s|$)", flags=re.IGNORECASE))
async def cmd_adminshelp(message: types.Message):
    try:
        if message.chat.type != "private":
            try:
                await message.reply(
                    "💬 <b>Команда /adminshelp работает только в ЛС бота.</b>",
                    parse_mode="HTML",
                )
            except Exception:
                pass
            return
        if not message.from_user:
            return
        uid = message.from_user.id

        # Ищем группы, где есть запись в staff
        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("""
                    SELECT chat_id, rank FROM group_staff
                    WHERE user_id = ? AND rank > 0
                    ORDER BY rank DESC, appointed_at ASC
                """, (uid,))
                rows = cur.fetchall() or []
        except Exception:
            rows = []

        # Проверяем, что юзер реально Telegram-админ в каждой группе
        valid = []
        for chat_id, rank in rows:
            try:
                if await is_telegram_admin(message.bot, chat_id, uid):
                    valid.append((chat_id, rank))
            except Exception:
                continue

        if not valid:
            # нет прав — молчим
            return

        # одна группа — сразу справка
        if len(valid) == 1:
            chat_id, rank = valid[0]
            try:
                c = await message.bot.get_chat(chat_id)
                title = c.title or f"ID {chat_id}"
            except Exception:
                title = f"ID {chat_id}"
            text = f"📌 <b>{_esc(title)}</b>\n└─ {rank_emoji(rank)} <b>{rank_name(rank)}</b>\n\n" + _help_text_for_rank(rank)
            try:
                await message.answer(text, parse_mode="HTML")
            except Exception:
                pass
            return

        # несколько групп — даём выбор
        lines = ["🛡️ <b>Выберите группу</b>", "", "Вам доступны административные права в:", ""]
        kb_rows = []
        for i, (chat_id, rank) in enumerate(valid, 1):
            try:
                c = await message.bot.get_chat(chat_id)
                title = c.title or f"ID {chat_id}"
            except Exception:
                title = f"ID {chat_id}"
            lines.append(f"📌 {_esc(title)}\n└─ {rank_emoji(rank)} <b>{rank_name(rank)}</b>")
            kb_rows.append([types.InlineKeyboardButton(
                text=f"{rank_emoji(rank)} {title[:30]}",
                callback_data=f"gh_help_{chat_id}"
            )])
        kb = types.InlineKeyboardMarkup(inline_keyboard=kb_rows)
        try:
            await message.answer("\n".join(lines), parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cmd_adminshelp failed: %s", e)


@router.callback_query(F.data.startswith("gh_help_"))
async def cb_help_group(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        if not callback.message or callback.message.chat.type != "private":
            return
        uid = callback.from_user.id
        try:
            chat_id = int((callback.data or "").replace("gh_help_", ""))
        except ValueError:
            return
        if not await is_telegram_admin(callback.bot, chat_id, uid):
            await callback.answer("⛔ Нет доступа", show_alert=True)
            return
        rank = get_rank(chat_id, uid)
        if rank <= 0:
            await callback.answer("⛔ Нет доступа", show_alert=True)
            return
        try:
            c = await callback.bot.get_chat(chat_id)
            title = c.title or f"ID {chat_id}"
        except Exception:
            title = f"ID {chat_id}"
        text = f"📌 <b>{_esc(title)}</b>\n└─ {rank_emoji(rank)} <b>{rank_name(rank)}</b>\n\n" + _help_text_for_rank(rank)
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="◀️ Назад", callback_data="gh_help_back")]]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_help_group failed: %s", e)


@router.callback_query(F.data == "gh_help_back")
async def cb_help_back(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        if not callback.message:
            return
        uid = callback.from_user.id
        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("""
                    SELECT chat_id, rank FROM group_staff
                    WHERE user_id = ? AND rank > 0
                    ORDER BY rank DESC
                """, (uid,))
                rows = cur.fetchall() or []
        except Exception:
            rows = []
        valid = []
        for chat_id, rank in rows:
            try:
                if await is_telegram_admin(callback.bot, chat_id, uid):
                    valid.append((chat_id, rank))
            except Exception:
                continue
        if not valid:
            try:
                await callback.message.delete()
            except Exception:
                pass
            return
        if len(valid) == 1:
            chat_id, rank = valid[0]
            try:
                c = await callback.bot.get_chat(chat_id)
                title = c.title or f"ID {chat_id}"
            except Exception:
                title = f"ID {chat_id}"
            text = f"📌 <b>{_esc(title)}</b>\n└─ {rank_emoji(rank)} <b>{rank_name(rank)}</b>\n\n" + _help_text_for_rank(rank)
            try:
                await callback.message.edit_text(text, parse_mode="HTML")
            except Exception:
                pass
            return
        lines = ["🛡️ <b>Выберите группу</b>", ""]
        kb_rows = []
        for chat_id, rank in valid:
            try:
                c = await callback.bot.get_chat(chat_id)
                title = c.title or f"ID {chat_id}"
            except Exception:
                title = f"ID {chat_id}"
            lines.append(f"📌 {_esc(title)}\n└─ {rank_emoji(rank)} <b>{rank_name(rank)}</b>")
            kb_rows.append([types.InlineKeyboardButton(
                text=f"{rank_emoji(rank)} {title[:30]}",
                callback_data=f"gh_help_{chat_id}"
            )])
        kb = types.InlineKeyboardMarkup(inline_keyboard=kb_rows)
        try:
            await callback.message.edit_text("\n".join(lines), parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_help_back failed: %s", e)


# ================== /modhelp ==================
@router.message(F.text.casefold().in_({"модхелп", "/modhelp", "модерация"}))
async def cmd_modhelp(message: types.Message):
    try:
        if not await require_group(message):
            return
        if not message.from_user:
            return
        rank = await effective_rank(message.bot, message.chat.id, message.from_user.id)
        if rank <= 0:
            return
        text = _help_text_for_rank(rank)
        if not text:
            return
        text += "\n\n💡 Полная справка в ЛС: /adminshelp"
        await message.reply(text, parse_mode="HTML")
    except Exception as e:
        logger.exception("cmd_modhelp failed: %s", e)


# ================== /logs ==================
@router.message(F.text.casefold().in_({"логи", "/logs"}))
async def cmd_logs(message: types.Message):
    try:
        if not await require_group(message):
            return
        chat = message.chat
        rank = await effective_rank(message.bot, chat.id, message.from_user.id)
        if not can_use_action(chat.id, message.from_user.id, rank, "logs_view"):
            await _deny(message, "Недостаточно прав")
            return
        rows = get_logs(chat.id, limit=10)
        if not rows:
            await message.reply("📜 Логов пока нет.")
            return
        action_map = {
            "ban": "🚫 Бан", "unban": "✅ Разбан",
            "mute": "🔇 Мут", "unmute": "🔊 Размут",
            "kick": "👢 Кик", "warn": "⚠️ Варн",
            "unwarn": "✅ Снятие варна", "promote": "📈 Повышение",
            "demote": "📉 Понижение", "remove": "❌ Снятие должности",
            "set_rank": "🔧 Ранг", "delete_msg": "🗑 Удаление",
            "auto_mute": "🚨 Авто-мут", "auto_ban": "🚨 Авто-бан",
            "auto_kick": "🚨 Авто-кик", "auto_sub_mute": "🚨 Авто-мут (подписка)",
            "perm_change": "🛡 Права", "settings": "⚙ Настройки",
        }
        lines = ["📜 <b>Логи модерации</b>", ""]
        for op_id, user_id, mod_id, action, reason, duration, ts in rows:
            try:
                d = time.strftime("%d.%m %H:%M", time.localtime(int(ts or 0)))
            except Exception:
                d = "—"
            act = action_map.get(action, f"⚙ {_esc(action)}")
            lines.append(f"{act}")
            lines.append(f"👤 {_user_mention(user_id) if user_id else '—'} · 🛡 {_user_mention(mod_id) if mod_id else '—'}")
            if duration: lines.append(f"⏱ {fmt_duration(duration)}")
            if reason: lines.append(f"📝 {_esc(reason)}")
            lines.append(f"🕐 {d}")
            lines.append("")
        text = "\n".join(lines)
        if len(text) > 3800:
            text = text[:3800] + "\n\n<i>…обрезано</i>"
        await message.reply(text, parse_mode="HTML")
    except Exception as e:
        logger.exception("cmd_logs failed: %s", e)
# ================== ПРАВИЛА ==================
@router.message(F.text.casefold().in_({"правила", "/rules", "rules"}))
async def cmd_rules_view(message: types.Message):
    try:
        if not await require_group(message):
            return
        chat = message.chat
        settings = get_settings(chat.id)
        rules = (settings.get("rules") or "").strip()
        if not rules:
            await message.reply(
                "📜 <b>Правила группы</b>\n\n"
                "В этой группе пока нет установленных правил.",
                parse_mode="HTML",
            )
            return
        await message.reply(
            "📜 <b>Правила группы</b>\n\n"
            f"{_esc(rules)}",
            parse_mode="HTML",
        )
    except Exception as e:
        logger.exception("cmd_rules_view failed: %s", e)


@router.message(F.text.regexp(r"^\+[Пп]равила(\s|$)"))
async def cmd_rules_set(message: types.Message, state: FSMContext):
    try:
        if not await require_group(message):
            return
        chat = message.chat
        rank = await effective_rank(message.bot, chat.id, message.from_user.id)
        if not can_use_action(chat.id, message.from_user.id, rank, "rules_edit"):
            await _deny(message, "Недостаточно прав")
            return
        parts = (message.text or "").split(maxsplit=1)
        if len(parts) < 2 or not parts[1].strip():
            await message.reply(
                "⚠️ Укажите текст правил:\n\n"
                "<code>+Правила Не спамить. Уважать участников.</code>",
                parse_mode="HTML",
            )
            return
        rules = parts[1].strip()[:3500]
        await state.update_data(pending_rules=rules, pending_rules_chat=chat.id)
        await state.set_state(AdminStates.waiting_rules)
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="✅ Да", callback_data="rules_apply_yes")],
                [types.InlineKeyboardButton(text="❌ Отмена", callback_data="rules_apply_no")],
            ]
        )
        await message.reply(
            "📜 <b>Новые правила</b>\n\n"
            f"{_esc(rules)}\n\n"
            "Вы уверены, что хотите установить эти правила?",
            parse_mode="HTML",
            reply_markup=kb,
        )
    except Exception as e:
        logger.exception("cmd_rules_set failed: %s", e)


@router.callback_query(F.data == "rules_apply_yes")
async def cb_rules_apply_yes(callback: types.CallbackQuery, state: FSMContext):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        data = await state.get_data()
        rules = data.get("pending_rules")
        if not rules:
            await state.clear()
            return
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO group_settings (chat_id, rules) VALUES (?, ?)
                ON CONFLICT(chat_id) DO UPDATE SET rules = excluded.rules
            """, (chat.id, rules))
        add_log(chat.id, 0, callback.from_user.id, "settings", reason="rules updated")
        await state.clear()
        try:
            await callback.message.edit_text(
                "✅ <b>Правила установлены</b>",
                parse_mode="HTML",
            )
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_rules_apply_yes failed: %s", e)


@router.callback_query(F.data == "rules_apply_no")
async def cb_rules_apply_no(callback: types.CallbackQuery, state: FSMContext):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        await state.clear()
        await callback.message.edit_text("❌ Отменено.", parse_mode="HTML")
    except Exception:
        pass


@router.message(F.text.casefold().in_({"-правила", "/clearrules"}))
async def cmd_rules_clear(message: types.Message, state: FSMContext):
    try:
        if not await require_group(message):
            return
        chat = message.chat
        rank = await effective_rank(message.bot, chat.id, message.from_user.id)
        if not can_use_action(chat.id, message.from_user.id, rank, "rules_edit"):
            await _deny(message, "Недостаточно прав")
            return
        settings = get_settings(chat.id)
        if not (settings.get("rules") or "").strip():
            await message.reply("📜 Правила пока не установлены.")
            return
        await state.update_data(clear_rules_chat=chat.id)
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="✅ Да, удалить", callback_data="rules_clear_yes")],
                [types.InlineKeyboardButton(text="❌ Отмена", callback_data="rules_clear_no")],
            ]
        )
        await message.reply(
            "🗑️ <b>Удалить правила?</b>\n\nПравила будут стёрты для этой группы.",
            parse_mode="HTML",
            reply_markup=kb,
        )
    except Exception as e:
        logger.exception("cmd_rules_clear failed: %s", e)


@router.callback_query(F.data == "rules_clear_yes")
async def cb_rules_clear_yes(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        rank = await effective_rank(callback.bot, chat.id, callback.from_user.id)
        if not can_use_action(chat.id, callback.from_user.id, rank, "rules_edit"):
            return
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("UPDATE group_settings SET rules = '' WHERE chat_id = ?", (chat.id,))
        add_log(chat.id, 0, callback.from_user.id, "settings", reason="rules cleared")
        try:
            await callback.message.edit_text("✅ Правила удалены.", parse_mode="HTML")
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_rules_clear_yes failed: %s", e)


@router.callback_query(F.data == "rules_clear_no")
async def cb_rules_clear_no(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        await callback.message.edit_text("❌ Отменено.", parse_mode="HTML")
    except Exception:
        pass


# ================== ПРИВЕТСТВИЕ ==================
@router.message(F.text.regexp(r"^\+[Пп]риветствие(\s|$)"))
async def cmd_welcome_set(message: types.Message, state: FSMContext):
    try:
        if not await require_group(message):
            return
        chat = message.chat
        rank = await effective_rank(message.bot, chat.id, message.from_user.id)
        if not can_use_action(chat.id, message.from_user.id, rank, "settings"):
            await _deny(message, "Недостаточно прав")
            return
        parts = (message.text or "").split(maxsplit=1)
        if len(parts) < 2 or not parts[1].strip():
            await message.reply(
                "⚠️ Укажите текст приветствия:\n\n"
                "<code>+Приветствие Добро пожаловать, {name}!</code>\n\n"
                "Переменные: <code>{name}</code>, <code>{username}</code>, <code>{chat}</code>",
                parse_mode="HTML",
            )
            return
        text = parts[1].strip()[:1000]
        await state.update_data(pending_welcome=text, welcome_chat=chat.id)
        await state.set_state(AdminStates.waiting_welcome_text)
        settings = get_settings(chat.id)
        has_photo = bool((settings.get("welcome_photo") or "").strip())
        kb_rows = [
            [types.InlineKeyboardButton(text="✅ Да", callback_data="welcome_apply_yes")],
            [types.InlineKeyboardButton(text="❌ Отмена", callback_data="welcome_apply_no")],
            [types.InlineKeyboardButton(
                text=("🖼️ Изменить фото" if has_photo else "🖼️ Добавить фото для приветствия"),
                callback_data="welcome_add_photo"
            )],
        ]
        kb = types.InlineKeyboardMarkup(inline_keyboard=kb_rows)
        preview = (
            "👋 <b>Новое приветствие</b>\n\n"
            f"{_esc(text)}\n\n"
            "Вы уверены, что хотите установить это приветствие?"
        )
        if has_photo:
            try:
                await message.reply_photo(photo=settings["welcome_photo"], caption=preview,
                                          parse_mode="HTML", reply_markup=kb)
                return
            except Exception:
                pass
        await message.reply(preview, parse_mode="HTML", reply_markup=kb)
    except Exception as e:
        logger.exception("cmd_welcome_set failed: %s", e)


@router.callback_query(F.data == "welcome_add_photo")
async def cb_welcome_add_photo(callback: types.CallbackQuery, state: FSMContext):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        await state.set_state(AdminStates.waiting_welcome_photo)
        await callback.message.reply(
            "🖼️ <b>Отправьте фотографию</b>, которая будет использоваться в приветствии.",
            parse_mode="HTML",
        )
    except Exception as e:
        logger.exception("cb_welcome_add_photo failed: %s", e)


@router.message(AdminStates.waiting_welcome_photo, F.photo)
async def cmd_welcome_photo(message: types.Message, state: FSMContext):
    try:
        chat = message.chat
        rank = await effective_rank(message.bot, chat.id, message.from_user.id)
        if not can_use_action(chat.id, message.from_user.id, rank, "settings"):
            await state.clear()
            return
        photo_id = message.photo[-1].file_id
        data = await state.get_data()
        welcome_text = data.get("pending_welcome") or ""
        await state.update_data(pending_welcome_photo=photo_id)
        await state.set_state(AdminStates.waiting_welcome_text)
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="✅ Да", callback_data="welcome_apply_yes")],
                [types.InlineKeyboardButton(text="❌ Отмена", callback_data="welcome_apply_no")],
            ]
        )
        await message.reply_photo(
            photo=photo_id,
            caption=(
                "👋 <b>Приветствие нового участника</b>\n\n"
                f"{_esc(welcome_text) if welcome_text else '<i>текст не задан</i>'}\n\n"
                "Установить это приветствие?"
            ),
            parse_mode="HTML",
            reply_markup=kb,
        )
    except Exception as e:
        logger.exception("cmd_welcome_photo failed: %s", e)


@router.callback_query(F.data == "welcome_apply_yes")
async def cb_welcome_apply_yes(callback: types.CallbackQuery, state: FSMContext):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        rank = await effective_rank(callback.bot, chat.id, callback.from_user.id)
        if not can_use_action(chat.id, callback.from_user.id, rank, "settings"):
            return
        data = await state.get_data()
        text = data.get("pending_welcome") or ""
        photo = data.get("pending_welcome_photo") or ""
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO group_settings (chat_id, welcome_text, welcome_photo, welcome_enabled)
                VALUES (?, ?, ?, 1)
                ON CONFLICT(chat_id) DO UPDATE SET
                    welcome_text = excluded.welcome_text,
                    welcome_photo = excluded.welcome_photo,
                    welcome_enabled = 1
            """, (chat.id, text, photo))
        add_log(chat.id, 0, callback.from_user.id, "settings", reason="welcome updated")
        await state.clear()
        try:
            await callback.message.edit_caption(caption="✅ <b>Приветствие установлено</b>", parse_mode="HTML")
        except Exception:
            try:
                await callback.message.edit_text("✅ <b>Приветствие установлено</b>", parse_mode="HTML")
            except Exception:
                pass
    except Exception as e:
        logger.exception("cb_welcome_apply_yes failed: %s", e)


@router.callback_query(F.data == "welcome_apply_no")
async def cb_welcome_apply_no(callback: types.CallbackQuery, state: FSMContext):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        await state.clear()
        await callback.message.edit_text("❌ Отменено.", parse_mode="HTML")
    except Exception:
        pass


@router.message(F.text.casefold() == "-приветствие")
async def cmd_welcome_off(message: types.Message):
    try:
        if not await require_group(message):
            return
        chat = message.chat
        rank = await effective_rank(message.bot, chat.id, message.from_user.id)
        if not can_use_action(chat.id, message.from_user.id, rank, "settings"):
            await _deny(message, "Недостаточно прав")
            return
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO group_settings (chat_id, welcome_enabled) VALUES (?, 0)
                ON CONFLICT(chat_id) DO UPDATE SET welcome_enabled = 0
            """, (chat.id,))
        add_log(chat.id, 0, message.from_user.id, "settings", reason="welcome disabled")
        await message.reply("✅ Приветствие отключено.")
    except Exception as e:
        logger.exception("cmd_welcome_off failed: %s", e)


# ================== ПРИВЕТСТВИЕ НОВЫХ УЧАСТНИКОВ ==================
@router.message(F.new_chat_members)
async def on_new_member(message: types.Message):
    """
    Обработка новых участников — ОБЯЗАТЕЛЬНО для работы приветствия.
    """
    try:
        chat = message.chat
        if chat.type not in ("group", "supergroup"):
            return
        settings = get_settings(chat.id)
        if not int(settings.get("welcome_enabled") or 0):
            return

        template = (settings.get("welcome_text") or "").strip()
        photo = (settings.get("welcome_photo") or "").strip()

        for member in (message.new_chat_members or []):
            try:
                if member.is_bot:
                    continue
                name = member.full_name or "Новый участник"
                username = f"@{member.username}" if member.username else name
                text_out = (
                    (template or "👋 Добро пожаловать, {name}!")
                    .replace("{name}", name)
                    .replace("{username}", username)
                    .replace("{chat}", chat.title or "")
                )
                if photo:
                    try:
                        await message.answer_photo(photo=photo, caption=text_out, parse_mode="HTML")
                        continue
                    except Exception:
                        pass
                await message.answer(text_out, parse_mode="HTML")
            except Exception as e:
                logger.warning("welcome to %s failed: %s", member.id, e)
    except Exception as e:
        logger.exception("on_new_member failed: %s", e)


# ================== /settings ==================
@router.message(F.text.casefold().in_({"настройки", "/settings"}))
async def cmd_settings(message: types.Message):
    try:
        if not await require_group(message):
            return
        chat = message.chat
        rank = await effective_rank(message.bot, chat.id, message.from_user.id)
        if not can_use_action(chat.id, message.from_user.id, rank, "settings"):
            await _deny(message, "Только владелец может менять настройки")
            return
        await _render_settings(message)
    except Exception as e:
        logger.exception("cmd_settings failed: %s", e)


async def _render_settings(target, edit: bool = False):
    try:
        chat = target.chat if isinstance(target, types.Message) else target.message.chat
        settings = get_settings(chat.id)
        limit = int(settings.get("warn_limit") or 3)
        action = settings.get("warn_action") or "mute_1h"
        sub_enabled = int(settings.get("subscription_enabled") or 0)
        action_names = {
            "mute_10m": "🔇 Мут 10 минут", "mute_30m": "🔇 Мут 30 минут",
            "mute_1h": "🔇 Мут 1 час", "mute_6h": "🔇 Мут 6 часов",
            "mute_12h": "🔇 Мут 12 часов", "mute_1d": "🔇 Мут 1 день",
            "ban": "🚫 Бан", "kick": "👢 Кик",
        }
        label = action_names.get(action, action)
        text = (
            "⚙️ <b>Настройки группы</b>\n\n"
            f"⚠️ Лимит предупреждений: <b>{limit}</b>\n"
            f"🔨 Наказание при лимите: <b>{label}</b>\n"
            f"📢 Обязательная подписка: <b>{'🟢 включена' if sub_enabled else '🔴 выключена'}</b>\n\n"
            "Изменить:"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="⚠️ Лимит предупреждений", callback_data="gh_set_limit")],
                [types.InlineKeyboardButton(text="🔨 Наказание за лимит", callback_data="gh_set_action")],
                [types.InlineKeyboardButton(text="📢 Обязательная подписка", callback_data="gh_sub_menu")],
                [types.InlineKeyboardButton(text="📜 Правила группы", callback_data="gh_set_rules_info")],
            ]
        )
        if edit and isinstance(target, types.CallbackQuery):
            try:
                await target.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
                return
            except Exception:
                pass
        await target.reply(text, parse_mode="HTML", reply_markup=kb)
    except Exception as e:
        logger.exception("_render_settings failed: %s", e)


@router.callback_query(F.data == "gh_set_limit")
async def cb_set_limit(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        rows = [[types.InlineKeyboardButton(text=f"{n} предупреждений", callback_data=f"gh_set_limit_{n}")]
                for n in (2, 3, 4, 5, 6, 7, 8, 10)]
        rows.append([types.InlineKeyboardButton(text="◀️ Назад", callback_data="gh_settings_back")])
        try:
            await callback.message.edit_text(
                "⚠️ <b>Лимит предупреждений</b>\n\nВыберите количество:",
                parse_mode="HTML",
                reply_markup=types.InlineKeyboardMarkup(inline_keyboard=rows),
            )
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_set_limit failed: %s", e)


@router.callback_query(F.data.startswith("gh_set_limit_"))
async def cb_set_limit_apply(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        try:
            n = int((callback.data or "").replace("gh_set_limit_", ""))
        except ValueError:
            return
        if n < 2 or n > 20:
            return
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO group_settings (chat_id, warn_limit) VALUES (?, ?)
                ON CONFLICT(chat_id) DO UPDATE SET warn_limit = excluded.warn_limit
            """, (chat.id, n))
        add_log(chat.id, 0, callback.from_user.id, "settings", reason=f"warn_limit={n}")
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="◀️ К настройкам", callback_data="gh_settings_back")]]
        )
        try:
            await callback.message.edit_text(f"✅ Лимит: <b>{n}</b>", parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_set_limit_apply failed: %s", e)


@router.callback_query(F.data == "gh_set_action")
async def cb_set_action(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        opts = [
            ("mute_10m", "🔇 Мут 10 минут"), ("mute_30m", "🔇 Мут 30 минут"),
            ("mute_1h", "🔇 Мут 1 час"), ("mute_6h", "🔇 Мут 6 часов"),
            ("mute_12h", "🔇 Мут 12 часов"), ("mute_1d", "🔇 Мут 1 день"),
            ("ban", "🚫 Бан"), ("kick", "👢 Кик"),
        ]
        rows = [[types.InlineKeyboardButton(text=label, callback_data=f"gh_set_action_{key}")] for key, label in opts]
        rows.append([types.InlineKeyboardButton(text="◀️ Назад", callback_data="gh_settings_back")])
        try:
            await callback.message.edit_text(
                "🔨 <b>Наказание при лимите</b>\n\nВыберите действие:",
                parse_mode="HTML",
                reply_markup=types.InlineKeyboardMarkup(inline_keyboard=rows),
            )
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_set_action failed: %s", e)


@router.callback_query(F.data.startswith("gh_set_action_"))
async def cb_set_action_apply(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        key = (callback.data or "").replace("gh_set_action_", "")
        allowed = {"mute_10m", "mute_30m", "mute_1h", "mute_6h", "mute_12h", "mute_1d", "ban", "kick"}
        if key not in allowed:
            return
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO group_settings (chat_id, warn_action) VALUES (?, ?)
                ON CONFLICT(chat_id) DO UPDATE SET warn_action = excluded.warn_action
            """, (chat.id, key))
        add_log(chat.id, 0, callback.from_user.id, "settings", reason=f"warn_action={key}")
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="◀️ К настройкам", callback_data="gh_settings_back")]]
        )
        try:
            await callback.message.edit_text(f"✅ Наказание: <b>{_esc(key)}</b>", parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_set_action_apply failed: %s", e)


@router.callback_query(F.data == "gh_set_rules_info")
async def cb_set_rules_info(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        settings = get_settings(chat.id)
        rules = (settings.get("rules") or "").strip()
        text = (
            "📜 <b>Правила группы</b>\n\n"
            f"{_esc(rules) if rules else '<i>Пока не заданы</i>'}\n\n"
            "<b>Управление:</b>\n"
            "+Правила текст — установить\n"
            "-Правила — удалить\n"
            "Правила — показать всем"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="◀️ Назад", callback_data="gh_settings_back")]]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_set_rules_info failed: %s", e)


@router.callback_query(F.data == "gh_settings_back")
async def cb_settings_back(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        await _render_settings(callback, edit=True)
    except Exception as e:
        logger.exception("cb_settings_back failed: %s", e)


# ================== ОБЯЗАТЕЛЬНАЯ ПОДПИСКА ==================
@router.callback_query(F.data == "gh_sub_menu")
async def cb_sub_menu(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        rank = await effective_rank(callback.bot, chat.id, callback.from_user.id)
        if not can_use_action(chat.id, callback.from_user.id, rank, "subscribe_edit"):
            await callback.answer("⛔ Недостаточно прав", show_alert=True)
            return
        settings = get_settings(chat.id)
        enabled = int(settings.get("subscription_enabled") or 0)
        subs = list_required_subs(chat.id)
        ch_cnt = sum(1 for s in subs if s[2] == "channel")
        chat_cnt = sum(1 for s in subs if s[2] == "chat")
        text = (
            "📢 <b>Обязательная подписка</b>\n\n"
            f"Статус: <b>{'🟢 Включена' if enabled else '🔴 Выключена'}</b>\n"
            f"📋 Каналов: <b>{ch_cnt}</b>\n"
            f"💬 Чатов: <b>{chat_cnt}</b>\n\n"
            "Настройте каналы и чаты, на которые пользователь\n"
            "должен подписаться перед использованием группы."
        )
        toggle_text = "🔴 Выключить" if enabled else "🟢 Включить"
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text=toggle_text, callback_data="gh_sub_toggle")],
                [types.InlineKeyboardButton(text="➕ Добавить канал", callback_data="gh_sub_add_channel")],
                [types.InlineKeyboardButton(text="➕ Добавить чат", callback_data="gh_sub_add_chat")],
                [types.InlineKeyboardButton(text="📋 Список подписок", callback_data="gh_sub_list")],
                [types.InlineKeyboardButton(text="🔄 Проверить настройки", callback_data="gh_sub_check_health")],
                [types.InlineKeyboardButton(text="◀️ Назад", callback_data="gh_settings_back")],
            ]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_sub_menu failed: %s", e)


@router.callback_query(F.data == "gh_sub_toggle")
async def cb_sub_toggle(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        rank = await effective_rank(callback.bot, chat.id, callback.from_user.id)
        if not can_use_action(chat.id, callback.from_user.id, rank, "subscribe_edit"):
            await callback.answer("⛔ Недостаточно прав", show_alert=True)
            return
        settings = get_settings(chat.id)
        enabled = int(settings.get("subscription_enabled") or 0)
        if enabled:
            # выключаем — с подтверждением
            kb = types.InlineKeyboardMarkup(
                inline_keyboard=[
                    [types.InlineKeyboardButton(text="✅ Да", callback_data="gh_sub_disable_yes")],
                    [types.InlineKeyboardButton(text="❌ Отмена", callback_data="gh_sub_menu")],
                ]
            )
            try:
                await callback.message.edit_text(
                    "⚠️ <b>Отключить обязательную подписку?</b>",
                    parse_mode="HTML",
                    reply_markup=kb,
                )
            except Exception:
                pass
            return
        # включаем — проверяем наличие источников
        subs = list_required_subs(chat.id)
        if not subs:
            await callback.answer("Сначала добавьте хотя бы один канал или чат", show_alert=True)
            return
        set_subscription_enabled(chat.id, 1)
        add_log(chat.id, 0, callback.from_user.id, "settings", reason="subscription_enabled=1")
        await callback.answer("Включено", show_alert=True)
        await cb_sub_menu(callback)
    except Exception as e:
        logger.exception("cb_sub_toggle failed: %s", e)


@router.callback_query(F.data == "gh_sub_disable_yes")
async def cb_sub_disable_yes(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        set_subscription_enabled(chat.id, 0)
        add_log(chat.id, 0, callback.from_user.id, "settings", reason="subscription_enabled=0")
        await cb_sub_menu(callback)
    except Exception as e:
        logger.exception("cb_sub_disable_yes failed: %s", e)


@router.callback_query(F.data == "gh_sub_add_channel")
async def cb_sub_add_channel(callback: types.CallbackQuery, state: FSMContext):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        rank = await effective_rank(callback.bot, chat.id, callback.from_user.id)
        if not can_use_action(chat.id, callback.from_user.id, rank, "subscribe_edit"):
            return
        await state.update_data(sub_type="channel", sub_chat=chat.id)
        await state.set_state(AdminStates.waiting_sub_link)
        await callback.message.reply(
            "📢 <b>Добавление канала</b>\n\n"
            "Отправьте ссылку на канал.\n\n"
            "Например: <code>https://t.me/username</code> или <code>@username</code>",
            parse_mode="HTML",
        )
    except Exception as e:
        logger.exception("cb_sub_add_channel failed: %s", e)


@router.callback_query(F.data == "gh_sub_add_chat")
async def cb_sub_add_chat(callback: types.CallbackQuery, state: FSMContext):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        rank = await effective_rank(callback.bot, chat.id, callback.from_user.id)
        if not can_use_action(chat.id, callback.from_user.id, rank, "subscribe_edit"):
            return
        await state.update_data(sub_type="chat", sub_chat=chat.id)
        await state.set_state(AdminStates.waiting_sub_link)
        await callback.message.reply(
            "💬 <b>Добавление чата</b>\n\n"
            "Отправьте ссылку на группу/чат.\n\n"
            "Например: <code>https://t.me/username</code> или <code>@username</code>",
            parse_mode="HTML",
        )
    except Exception as e:
        logger.exception("cb_sub_add_chat failed: %s", e)


@router.message(AdminStates.waiting_sub_link)
async def cmd_sub_link(message: types.Message, state: FSMContext):
    try:
        chat = message.chat
        if chat.type not in ("group", "supergroup"):
            await state.clear()
            return
        rank = await effective_rank(message.bot, chat.id, message.from_user.id)
        if not can_use_action(chat.id, message.from_user.id, rank, "subscribe_edit"):
            await state.clear()
            return
        data = await state.get_data()
        stype = data.get("sub_type") or "channel"
        link = (message.text or "").strip()
        if not link:
            await message.reply("⚠️ Отправьте ссылку.")
            return
        ok, res = await _resolve_chat_from_link(message.bot, link)
        if not ok:
            await message.reply(
                "⚠️ <b>Не удалось добавить источник.</b>\n\n"
                "Проверьте:\n"
                "• ссылка правильная;\n"
                "• канал/чат существует;\n"
                "• бот добавлен в источник;\n"
                "• у бота есть необходимые права.\n\n"
                f"<i>{_esc(res)}</i>",
                parse_mode="HTML",
            )
            return
        chat_obj = res
        target_chat_id = chat_obj.id
        title = chat_obj.title or str(target_chat_id)
        username = chat_obj.username or ""
        real_type = chat_obj.type
        if stype == "channel" and real_type != "channel":
            await message.reply("⚠️ По ссылке найден не канал. Используйте «Добавить чат».")
            return
        if stype == "chat" and real_type == "channel":
            await message.reply("⚠️ По ссылке найден канал. Используйте «Добавить канал».")
            return
        # бот должен быть админом источника
        try:
            me = await message.bot.get_me()
            member = await message.bot.get_chat_member(target_chat_id, me.id)
            if member.status not in ("administrator", "creator"):
                await message.reply(
                    "⚠️ <b>Невозможно подключить этот источник.</b>\n\n"
                    "Бот не является администратором канала/чата.\n"
                    "Добавьте бота администратором, чтобы он мог проверять подписку.",
                    parse_mode="HTML",
                )
                return
        except Exception as e:
            await message.reply(f"⚠️ Не удалось проверить права бота: {_esc(str(e))}")
            return
        sub_ok, reason, sub_id = add_required_sub(
            chat_id=chat.id,
            source_id=target_chat_id,
            source_type=("channel" if real_type == "channel" else "chat"),
            title=title,
            username=username,
            link=(f"https://t.me/{username}" if username else link),
            created_by=message.from_user.id,
        )
        if not sub_ok:
            if reason == "duplicate":
                await message.reply(
                    "⚠️ Этот источник уже добавлен в обязательную подписку."
                )
            else:
                await message.reply("⚠️ Ошибка сохранения.")
            await state.clear()
            return
        add_log(chat.id, 0, message.from_user.id, "settings",
                reason=f"sub_added type={real_type} id={target_chat_id}")
        set_subscription_enabled(chat.id, 1)
        await state.clear()
        emoji = "📢" if real_type == "channel" else "💬"
        await message.reply(
            f"✅ <b>{'Канал' if real_type == 'channel' else 'Чат'} добавлен</b>\n\n"
            f"{emoji} {_esc(title)}\n"
            f"🔗 {_esc('@' + username if username else link)}\n\n"
            "Обязательная подписка включена.",
            parse_mode="HTML",
        )
    except Exception as e:
        logger.exception("cmd_sub_link failed: %s", e)
        try:
            await state.clear()
        except Exception:
            pass


@router.callback_query(F.data == "gh_sub_list")
async def cb_sub_list(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        rank = await effective_rank(callback.bot, chat.id, callback.from_user.id)
        if not can_use_action(chat.id, callback.from_user.id, rank, "subscribe_edit"):
            return
        subs = list_required_subs(chat.id)
        if not subs:
            text = "📋 <b>Список подписок</b>\n\nПока пусто."
            kb = types.InlineKeyboardMarkup(
                inline_keyboard=[[types.InlineKeyboardButton(text="◀️ Назад", callback_data="gh_sub_menu")]]
            )
            try:
                await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                pass
            return
        lines = ["📋 <b>Список подписок</b>", ""]
        kb_rows = []
        for i, (sub_id, source_id, stype, title, username, link) in enumerate(subs, 1):
            emoji = "📢" if stype == "channel" else "💬"
            lines.append(f"{i}. {emoji} {_esc(title)}")
            kb_rows.append([types.InlineKeyboardButton(
                text=f"🗑️ Удалить #{i}", callback_data=f"gh_sub_del_{sub_id}"
            )])
        kb_rows.append([types.InlineKeyboardButton(text="◀️ Назад", callback_data="gh_sub_menu")])
        kb = types.InlineKeyboardMarkup(inline_keyboard=kb_rows)
        try:
            await callback.message.edit_text("\n".join(lines), parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_sub_list failed: %s", e)


@router.callback_query(F.data.startswith("gh_sub_del_"))
async def cb_sub_del(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        rank = await effective_rank(callback.bot, chat.id, callback.from_user.id)
        if not can_use_action(chat.id, callback.from_user.id, rank, "subscribe_edit"):
            return
        try:
            sub_id = int((callback.data or "").replace("gh_sub_del_", ""))
        except ValueError:
            return
        if remove_required_sub(chat.id, sub_id):
            add_log(chat.id, 0, callback.from_user.id, "settings", reason=f"sub_removed id={sub_id}")
        await cb_sub_list(callback)
    except Exception as e:
        logger.exception("cb_sub_del failed: %s", e)


@router.callback_query(F.data == "gh_sub_check_health")
async def cb_sub_check_health(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        rank = await effective_rank(callback.bot, chat.id, callback.from_user.id)
        if not can_use_action(chat.id, callback.from_user.id, rank, "subscribe_edit"):
            return
        subs = list_required_subs(chat.id)
        if not subs:
            await callback.answer("Нет подписок", show_alert=True)
            return
        me = await callback.bot.get_me()
        lines = ["🔄 <b>Проверка настроек</b>", ""]
        for sub_id, source_id, stype, title, username, link in subs:
            try:
                member = await callback.bot.get_chat_member(source_id, me.id)
                if member.status in ("administrator", "creator"):
                    lines.append(f"✅ {_esc(title)} — OK")
                else:
                    lines.append(f"⚠️ {_esc(title)} — бот не админ")
            except Exception as e:
                lines.append(f"❌ {_esc(title)} — ошибка: {_esc(str(e))[:60]}")
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="◀️ Назад", callback_data="gh_sub_menu")]]
        )
        try:
            await callback.message.edit_text("\n".join(lines), parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_sub_check_health failed: %s", e)


# ================== КНОПКА «Я ПОДПИСАЛСЯ» ==================
SUB_MUTE_SECONDS = 300


async def apply_subscription_mute(bot, chat_id: int, user_id: int, missing: list):
    """
    Выдаёт мут на 5 минут за отсутствие подписки.
    НЕ мутит Telegram-админов.
    """
    try:
        # Telegram-админ — не мутим
        if await is_telegram_admin(bot, chat_id, user_id):
            # просто показываем требование
            lines = ["🔒 <b>Обязательная подписка</b>", "",
                     "Чтобы писать в этой группе, подпишитесь:"]
            kb_rows = []
            for m in missing:
                emoji = "📢" if m["type"] == "channel" else "💬"
                lines.append(f"{emoji} {_esc(m['title'] or m['source_id'])}")
                if m["link"]:
                    kb_rows.append([types.InlineKeyboardButton(
                        text=f"{emoji} Подписаться", url=m["link"]
                    )])
            kb_rows.append([types.InlineKeyboardButton(text="✅ Я подписался", callback_data="sub_check")])
            kb = types.InlineKeyboardMarkup(inline_keyboard=kb_rows)
            try:
                await bot.send_message(chat_id, "\n".join(lines), parse_mode="HTML", reply_markup=kb)
            except Exception:
                pass
            return False

        until = int(time.time()) + SUB_MUTE_SECONDS
        ok, err = await _try_restrict(bot, chat_id, user_id, until)
        if not ok:
            return False
        add_punish(chat_id, user_id, bot.id if hasattr(bot, "id") else 0,
                   "sub_mute", "Нет подписки", SUB_MUTE_SECONDS)
        add_log(chat_id, user_id, 0, "auto_sub_mute",
                reason="Нет обязательной подписки",
                duration=SUB_MUTE_SECONDS, extra="auto")

        lines = ["🔒 <b>Обязательная подписка</b>", "",
                 "Чтобы писать в этой группе, подпишитесь:"]
        kb_rows = []
        for m in missing:
            emoji = "📢" if m["type"] == "channel" else "💬"
            lines.append(f"{emoji} {_esc(m['title'] or m['source_id'])}")
            if m["link"]:
                kb_rows.append([types.InlineKeyboardButton(
                    text=f"{emoji} Подписаться", url=m["link"]
                )])
        kb_rows.append([types.InlineKeyboardButton(text="✅ Я подписался", callback_data="sub_check")])
        kb = types.InlineKeyboardMarkup(inline_keyboard=kb_rows)
        try:
            await bot.send_message(chat_id, "\n".join(lines), parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
        return True
    except Exception as e:
        logger.exception("apply_subscription_mute failed: %s", e)
        return False


def is_sub_muted_recently(bot, chat_id: int, user_id: int) -> bool:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT issued_at FROM group_punishments
                WHERE chat_id = ? AND user_id = ? AND punish_type = 'sub_mute' AND status = 'active'
                ORDER BY id DESC LIMIT 1
            """, (chat_id, user_id))
            row = cur.fetchone()
            if not row:
                return False
            return int(row[0] or 0) + SUB_MUTE_SECONDS > int(time.time())
    except Exception:
        return False


@router.callback_query(F.data == "sub_check")
async def cb_sub_check(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass
    try:
        chat = callback.message.chat if callback.message else None
        if not chat or chat.type not in ("group", "supergroup"):
            return
        uid = callback.from_user.id

        missing = await user_missing_subs(callback.bot, uid, chat.id)
        if missing:
            log_sub_check(chat.id, uid, "fail", ",".join(str(m["id"]) for m in missing))
            try:
                await callback.answer("Подписка ещё не подтверждена", show_alert=True)
            except Exception:
                pass
            return

        # снимаем мут
        try:
            from aiogram.types import ChatPermissions
            perms = ChatPermissions(
                can_send_messages=True, can_send_media_messages=True,
                can_send_polls=True, can_send_other_messages=True,
                can_add_web_page_previews=True, can_invite_users=True,
            )
            await callback.bot.restrict_chat_member(chat_id=chat.id, user_id=uid, permissions=perms)
            remove_punish(chat.id, uid, "sub_mute")
            add_log(chat.id, uid, callback.from_user.id, "unmute",
                    reason="Подписка подтверждена", extra="auto_sub")
        except Exception as e:
            logger.warning("unmute after sub failed: %s", e)

        log_sub_check(chat.id, uid, "ok")

        try:
            await callback.answer("✅ Подписка подтверждена!", show_alert=True)
        except Exception:
            pass
        try:
            await callback.message.delete()
        except Exception:
            pass
        try:
            await callback.bot.send_message(
                chat.id,
                "✅ <b>Подписка подтверждена</b>\n\nТеперь вы можете писать в группе.",
                parse_mode="HTML",
            )
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_sub_check failed: %s", e)