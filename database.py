import sqlite3
import random
import time
import string
import json as _json
import logging
from contextlib import contextmanager
from typing import Optional, Tuple, List

logger = logging.getLogger(__name__)

DB_NAME = "upgrade_game.db"

START_BALANCE = 5000
REF_CODE_LEN = 6
DEFAULT_NICK = "Игрок"
BONUS_COOLDOWN = 86400
BONUS_REWARDS = [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000]
GAME_ID_MIN = 1000000000
GAME_ID_MAX = 9999999999
MAX_RETRIES = 3
RETRY_DELAY = 0.5

# ================== ЭКОНОМИКА РЕЙТИНГА ==================
RATING_BUY_PRICE = 100
RATING_SELL_PRICE = 100
RATING_COMMISSION = 0.05
RATING_MAX_PER_TX = 100000


# ================== БАЗОВЫЙ СЛОЙ ==================
@contextmanager
def db_conn():
    """Безопасное соединение: WAL, busy_timeout, commit/rollback, всегда close."""
    conn = None
    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            conn = sqlite3.connect(DB_NAME, timeout=10)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA busy_timeout=10000")
            conn.execute("PRAGMA foreign_keys=ON")
            break
        except sqlite3.OperationalError as e:
            last_err = e
            logger.warning("DB connect attempt %d failed: %s", attempt + 1, e)
            time.sleep(RETRY_DELAY * (attempt + 1))
    if conn is None:
        raise sqlite3.OperationalError(f"Не удалось подключиться к БД: {last_err}")

    try:
        yield conn
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _safe_execute(cur, query: str, params: tuple = ()):
    """Выполнить запрос с ретраем на lock. Принимает cursor."""
    for attempt in range(MAX_RETRIES):
        try:
            cur.execute(query, params)
            return cur
        except sqlite3.OperationalError as e:
            if "locked" in str(e).lower() and attempt < MAX_RETRIES - 1:
                logger.warning("DB locked, retry %d", attempt + 1)
                time.sleep(RETRY_DELAY * (attempt + 1))
                continue
            raise
    raise sqlite3.OperationalError("Исчерпаны ретраи")


# ================== ГЕНЕРАТОРЫ ==================
def _gen_code(cursor, column: str, length: int, numeric: bool = False) -> str:
    for _ in range(30):
        if numeric:
            value = str(random.randint(GAME_ID_MIN, GAME_ID_MAX))
        else:
            chars = string.ascii_uppercase + string.digits
            value = "".join(random.choices(chars, k=length))
        cursor.execute(f"SELECT 1 FROM users WHERE {column} = ?", (value,))
        if not cursor.fetchone():
            return value
    raise RuntimeError(f"Не удалось сгенерировать уникальное значение для {column} за 30 попыток")


def generate_unique_ref_code(cursor) -> str:
    return _gen_code(cursor, "ref_code", REF_CODE_LEN, numeric=False)


def generate_unique_game_id(cursor=None) -> str:
    if cursor is not None:
        return _gen_code(cursor, "game_id", 0, numeric=True)
    with db_conn() as conn:
        cur = conn.cursor()
        return _gen_code(cur, "game_id", 0, numeric=True)


# ================== ИНИЦИАЛИЗАЦИЯ ==================
def init_db():
    try:
        with db_conn() as conn:
            cur = conn.cursor()

            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    user_id INTEGER PRIMARY KEY,
                    game_id TEXT UNIQUE,
                    balance_up INTEGER DEFAULT 5000,
                    balance_uc INTEGER DEFAULT 0,
                    last_bonus INTEGER DEFAULT 0,
                    nickname TEXT DEFAULT 'Игрок',
                    ref_code TEXT UNIQUE,
                    invited_by INTEGER DEFAULT NULL
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS referrals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    referrer_id INTEGER,
                    referred_id INTEGER UNIQUE,
                    created_at INTEGER,
                    reward INTEGER DEFAULT 500
                )
            """)

            # --- миграция колонок ДО индексов ---
            cur.execute("PRAGMA table_info(users)")
            columns = {col[1] for col in cur.fetchall()}

            required = {
                "game_id": "TEXT",
                "balance_up": "INTEGER DEFAULT 5000",
                "balance_uc": "INTEGER DEFAULT 0",
                "last_bonus": "INTEGER DEFAULT 0",
                "nickname": "TEXT DEFAULT 'Игрок'",
                "ref_code": "TEXT",
                "invited_by": "INTEGER DEFAULT NULL",
                "rating": "INTEGER DEFAULT 0",
                "reg_date": "INTEGER",
                "skin": "TEXT DEFAULT 'personage.jpg'",
                "level": "INTEGER DEFAULT 1",
                "xp": "INTEGER DEFAULT 0",
                "nickname_changes": "INTEGER DEFAULT 1",
            }
            for col, col_type in required.items():
                if col not in columns:
                    try:
                        cur.execute(f"ALTER TABLE users ADD COLUMN {col} {col_type}")
                        logger.info("Добавлена колонка users.%s", col)
                    except Exception as e:
                        logger.exception("Ошибка добавления колонки %s: %s", col, e)

            # --- слияние UC-колонок ---
            cur.execute("PRAGMA table_info(users)")
            columns = {col[1] for col in cur.fetchall()}
            for legacy in ("balance_ucoins", "ucoins"):
                if legacy in columns:
                    try:
                        cur.execute(f"UPDATE users SET balance_uc = balance_uc + COALESCE({legacy}, 0)")
                        logger.info("UC-колонка %s слита в balance_uc", legacy)
                    except Exception as e:
                        logger.exception("Не удалось слить %s: %s", legacy, e)

            # --- индексы ПОСЛЕ миграции ---
            for idx_sql in (
                "CREATE INDEX IF NOT EXISTS idx_users_balance ON users(balance_up DESC)",
                "CREATE INDEX IF NOT EXISTS idx_users_rating ON users(rating DESC)",
                "CREATE INDEX IF NOT EXISTS idx_users_ref_code ON users(ref_code)",
                "CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id)",
            ):
                try:
                    cur.execute(idx_sql)
                except Exception as e:
                    logger.warning("Не удалось создать индекс (%s): %s", idx_sql, e)

            # --- фиксы данных ---
            try:
                _safe_execute(cur, "UPDATE users SET nickname = ? WHERE nickname IS NULL OR nickname = ''", (DEFAULT_NICK,))
            except Exception as e:
                logger.exception("Fix nickname failed: %s", e)

            try:
                now_ts = int(time.time())
                _safe_execute(cur, "UPDATE users SET reg_date = ? WHERE reg_date IS NULL OR reg_date = 0", (now_ts,))
            except Exception as e:
                logger.exception("Fix reg_date failed: %s", e)

            try:
                _safe_execute(cur, "UPDATE users SET rating = 0 WHERE rating IS NULL OR rating < 0")
            except Exception as e:
                logger.exception("Fix rating failed: %s", e)

            try:
                _safe_execute(cur, "UPDATE users SET nickname_changes = 1 WHERE nickname_changes IS NULL")
            except Exception as e:
                logger.exception("Fix nickname_changes failed: %s", e)

            try:
                cur.execute("SELECT user_id FROM users WHERE ref_code IS NULL OR ref_code = ''")
                for (u_id,) in cur.fetchall():
                    try:
                        new_code = generate_unique_ref_code(cur)
                        cur.execute("UPDATE users SET ref_code = ? WHERE user_id = ?", (new_code, u_id))
                    except Exception as e:
                        logger.exception("Не удалось присвоить ref_code юзеру %s: %s", u_id, e)
            except Exception as e:
                logger.exception("Fix ref_code batch failed: %s", e)

            try:
                cur.execute("SELECT user_id FROM users WHERE game_id IS NULL OR game_id = ''")
                for (u_id,) in cur.fetchall():
                    try:
                        new_id = generate_unique_game_id(cur)
                        cur.execute("UPDATE users SET game_id = ? WHERE user_id = ?", (new_id, u_id))
                    except Exception as e:
                        logger.exception("Не удалось присвоить game_id юзеру %s: %s", u_id, e)
            except Exception as e:
                logger.exception("Fix game_id batch failed: %s", e)

        logger.info("БД инициализирована успешно")

    except Exception as e:
        logger.exception("Критическая ошибка init_db: %s", e)
        raise


# ================== ПОЛЬЗОВАТЕЛИ ==================
def check_user_registered(user_id: int) -> bool:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT 1 FROM users WHERE user_id = ?", (user_id,))
            return cur.fetchone() is not None
    except Exception as e:
        logger.exception("check_user_registered failed for %s: %s", user_id, e)
        return False


def get_or_create_user(user_id: int) -> Tuple[bool, Optional[str], int, int]:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT game_id, balance_up, balance_uc, ref_code, nickname FROM users WHERE user_id = ?",
                (user_id,)
            )
            user = cur.fetchone()

            if not user:
                game_id = generate_unique_game_id(cur)
                ref_code = generate_unique_ref_code(cur)
                now_ts = int(time.time())
                cur.execute(
                    "INSERT INTO users (user_id, game_id, balance_up, balance_uc, last_bonus, ref_code, nickname, reg_date) "
                    "VALUES (?, ?, ?, 0, 0, ?, ?, ?)",
                    (user_id, game_id, START_BALANCE, ref_code, DEFAULT_NICK, now_ts)
                )
                return True, game_id, START_BALANCE, 0

            game_id, balance_up, balance_uc, ref_code, nickname = user

            if not game_id:
                game_id = generate_unique_game_id(cur)
                cur.execute("UPDATE users SET game_id = ? WHERE user_id = ?", (game_id, user_id))

            if not ref_code:
                ref_code = generate_unique_ref_code(cur)
                cur.execute("UPDATE users SET ref_code = ? WHERE user_id = ?", (ref_code, user_id))

            if not nickname:
                cur.execute("UPDATE users SET nickname = ? WHERE user_id = ?", (DEFAULT_NICK, user_id))

            return False, game_id, balance_up or 0, balance_uc or 0

    except Exception as e:
        logger.exception("get_or_create_user failed for %s: %s", user_id, e)
        return False, None, 0, 0


def get_user(user_id: int) -> Optional[dict]:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("PRAGMA table_info(users)")
            cols = {c[1] for c in cur.fetchall()}

            wanted = ["user_id", "game_id", "balance_up", "balance_uc", "last_bonus",
                      "nickname", "ref_code", "invited_by", "rating", "reg_date", "skin",
                      "level", "xp"]
            wanted = [c for c in wanted if c in cols]

            cur.execute(f"SELECT {', '.join(wanted)} FROM users WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row:
                return None
            return dict(zip(wanted, row))
    except Exception as e:
        logger.exception("get_user failed for %s: %s", user_id, e)
        return None


def get_top_players(limit: int = 10) -> List[Tuple]:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT user_id, game_id, balance_up FROM users ORDER BY balance_up DESC LIMIT ?",
                (limit,)
            )
            return cur.fetchall()
    except Exception as e:
        logger.exception("get_top_players failed: %s", e)
        return []


# ================== БОНУС ==================
def claim_daily_bonus(user_id: int):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT last_bonus, balance_up FROM users WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row:
                return False, None, None

            last_bonus, balance_up = row
            last_bonus = last_bonus or 0
            balance_up = balance_up or 0
            now = int(time.time())

            if now - last_bonus < BONUS_COOLDOWN:
                remaining = BONUS_COOLDOWN - (now - last_bonus)
                return False, remaining // 3600, (remaining % 3600) // 60

            reward = random.choice(BONUS_REWARDS)
            new_balance = balance_up + reward

            _safe_execute(
                cur,
                "UPDATE users SET balance_up = ?, last_bonus = ? WHERE user_id = ?",
                (new_balance, now, user_id)
            )
            return True, reward, new_balance

    except Exception as e:
        logger.exception("claim_daily_bonus failed for %s: %s", user_id, e)
        return False, -1, -1


# ================== ДЕНЬГИ ==================
def add_up(user_id: int, amount: int) -> bool:
    if not isinstance(amount, int):
        return False
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            _safe_execute(cur, "UPDATE users SET balance_up = balance_up + ? WHERE user_id = ?", (amount, user_id))
            return cur.rowcount > 0
    except Exception as e:
        logger.exception("add_up failed for %s: %s", user_id, e)
        return False


def add_uc(user_id: int, amount: int) -> bool:
    if not isinstance(amount, int):
        return False
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            _safe_execute(cur, "UPDATE users SET balance_uc = balance_uc + ? WHERE user_id = ?", (amount, user_id))
            return cur.rowcount > 0
    except Exception as e:
        logger.exception("add_uc failed for %s: %s", user_id, e)
        return False


def transfer_up(from_id: int, to_id: int, amount: int) -> Tuple[bool, str]:
    if not isinstance(amount, int) or amount <= 0:
        return False, "invalid_amount"
    if from_id == to_id:
        return False, "self_transfer"

    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")

            cur.execute("SELECT balance_up FROM users WHERE user_id = ?", (from_id,))
            row = cur.fetchone()
            if not row:
                return False, "sender_not_found"
            if (row[0] or 0) < amount:
                return False, "insufficient_funds"

            cur.execute("SELECT 1 FROM users WHERE user_id = ?", (to_id,))
            if not cur.fetchone():
                return False, "receiver_not_found"

            cur.execute("UPDATE users SET balance_up = balance_up - ? WHERE user_id = ?", (amount, from_id))
            cur.execute("UPDATE users SET balance_up = balance_up + ? WHERE user_id = ?", (amount, to_id))
            return True, "ok"
    except Exception as e:
        logger.exception("transfer_up failed %s->%s: %s", from_id, to_id, e)
        return False, "db_error"


# ================== АДМИН-ТАБЛИЦЫ ==================
def _init_admin_tables():
    try:
        with db_conn() as conn:
            cur = conn.cursor()

            cur.execute("""
                CREATE TABLE IF NOT EXISTS admin_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    username TEXT,
                    display_name TEXT,
                    action_type TEXT,
                    command TEXT,
                    callback_data TEXT,
                    message_text TEXT,
                    game_type TEXT,
                    game_id TEXT,
                    balance_before INTEGER,
                    balance_after INTEGER,
                    balance_change INTEGER,
                    extra TEXT,
                    created_at INTEGER
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS balance_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    admin_id INTEGER,
                    old_balance INTEGER,
                    new_balance INTEGER,
                    change_amount INTEGER,
                    reason TEXT,
                    created_at INTEGER
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS click_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    username TEXT,
                    display_name TEXT,
                    log_type TEXT,
                    content TEXT,
                    callback_data TEXT,
                    game_type TEXT,
                    game_id TEXT,
                    balance_change INTEGER,
                    created_at INTEGER
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS user_skins (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    skin_file TEXT,
                    granted_by INTEGER,
                    granted_at INTEGER,
                    is_active INTEGER DEFAULT 0,
                    UNIQUE(user_id, skin_file)
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS user_jobs (
                    user_id INTEGER PRIMARY KEY,
                    job_key TEXT,
                    job_level INTEGER DEFAULT 1,
                    job_xp INTEGER DEFAULT 0,
                    jobs_done INTEGER DEFAULT 0,
                    total_earned INTEGER DEFAULT 0,
                    streak INTEGER DEFAULT 0,
                    cooldown_until INTEGER DEFAULT 0
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS user_business (
                    user_id INTEGER PRIMARY KEY,
                    business_key TEXT,
                    level INTEGER DEFAULT 1,
                    income INTEGER DEFAULT 0,
                    last_collect INTEGER DEFAULT 0,
                    total_earned INTEGER DEFAULT 0
                )
            """)

            cur.execute("CREATE INDEX IF NOT EXISTS idx_admin_logs_user ON admin_logs(user_id, id DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_admin_logs_time ON admin_logs(created_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_balance_history_user ON balance_history(user_id, id DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_click_logs_user ON click_logs(user_id, id DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_click_logs_time ON click_logs(created_at DESC)")

        logger.info("Админ-таблицы инициализированы")
    except Exception as e:
        logger.exception("init_admin_tables failed: %s", e)


_init_admin_tables()


# ================== GAME SESSIONS ==================
def _init_game_sessions_table():
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS game_sessions (
                    game_id INTEGER PRIMARY KEY,
                    game_type TEXT,
                    user_id INTEGER,
                    bet INTEGER,
                    state_json TEXT,
                    result TEXT,
                    win_amount INTEGER,
                    status TEXT,
                    started_at INTEGER,
                    ended_at INTEGER
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_game_sessions_user ON game_sessions(user_id, game_id DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_game_sessions_type ON game_sessions(game_type, game_id DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_game_sessions_status ON game_sessions(status)")
        logger.info("Таблица game_sessions инициализирована")
    except Exception as e:
        logger.exception("init_game_sessions_table failed: %s", e)


_init_game_sessions_table()


def game_session_start(game_id: int, game_type: str, user_id: int, bet: int, initial_state: dict):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT OR REPLACE INTO game_sessions
                (game_id, game_type, user_id, bet, state_json, result, win_amount, status, started_at, ended_at)
                VALUES (?, ?, ?, ?, ?, NULL, NULL, 'active', ?, NULL)
            """, (game_id, game_type, user_id, bet,
                  _json.dumps(initial_state, ensure_ascii=False), int(time.time())))
    except Exception as e:
        logger.exception("game_session_start failed: %s", e)


def game_session_update(game_id: int, state: dict):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                UPDATE game_sessions SET state_json = ? WHERE game_id = ?
            """, (_json.dumps(state, ensure_ascii=False), game_id))
    except Exception as e:
        logger.exception("game_session_update failed: %s", e)


def game_session_end(game_id: int, result: str, win_amount: int, final_state: dict):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                UPDATE game_sessions
                SET state_json = ?, result = ?, win_amount = ?, status = 'completed', ended_at = ?
                WHERE game_id = ?
            """, (_json.dumps(final_state, ensure_ascii=False), result, win_amount,
                  int(time.time()), game_id))
    except Exception as e:
        logger.exception("game_session_end failed: %s", e)


def get_game_session(game_id: int) -> dict:
    try:
        gid = int(str(game_id).replace("#", "").strip())
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM game_sessions WHERE game_id = ?", (gid,))
            row = cur.fetchone()
            if not row:
                return None
            cols = [d[0] for d in cur.description]
            data = dict(zip(cols, row))
            if data.get("state_json"):
                try:
                    data["state"] = _json.loads(data["state_json"])
                except Exception:
                    data["state"] = {}
            else:
                data["state"] = {}
            return data
    except Exception as e:
        logger.exception("get_game_session failed: %s", e)
        return None


def get_game_actions(game_id: int, limit: int = 200) -> list:
    try:
        gid = str(game_id).replace("#", "").strip()
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT * FROM click_logs
                WHERE game_id = ?
                ORDER BY id ASC LIMIT ?
            """, (gid, limit))
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
    except Exception as e:
        logger.exception("get_game_actions failed: %s", e)
        return []


# ================== ЛОГИ ==================
def log_action(user_id: int, username: str = None, display_name: str = None,
               action_type: str = None, command: str = None,
               callback_data: str = None, message_text: str = None,
               game_type: str = None, game_id: str = None,
               balance_before: int = None, balance_after: int = None,
               balance_change: int = None, extra: str = None) -> bool:
    now = int(time.time())
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO admin_logs
                (user_id, username, display_name, action_type, command,
                 callback_data, message_text, game_type, game_id,
                 balance_before, balance_after, balance_change, extra, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (user_id, username, display_name, action_type, command,
                  callback_data, message_text, game_type, game_id,
                  balance_before, balance_after, balance_change, extra, now))

            cur.execute("""
                INSERT INTO click_logs
                (user_id, username, display_name, log_type, content,
                 callback_data, game_type, game_id, balance_change, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (user_id, username, display_name, action_type or "UNKNOWN",
                  command or message_text or callback_data or "",
                  callback_data, game_type, game_id, balance_change, now))
        return True
    except Exception as e:
        logger.exception("log_action failed: %s", e)
        return False


def log_balance_change(user_id: int, admin_id: int, old_balance: int,
                       new_balance: int, reason: str) -> bool:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO balance_history
                (user_id, admin_id, old_balance, new_balance, change_amount, reason, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (user_id, admin_id, old_balance, new_balance,
                  new_balance - old_balance, reason, int(time.time())))
        return True
    except Exception as e:
        logger.exception("log_balance_change failed: %s", e)
        return False


def get_admin_logs(limit: int = 100, offset: int = 0, user_id: int = None,
                   action_type: str = None) -> list:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            query = "SELECT * FROM admin_logs WHERE 1=1"
            params = []
            if user_id:
                query += " AND user_id = ?"
                params.append(user_id)
            if action_type:
                query += " AND action_type = ?"
                params.append(action_type)
            query += " ORDER BY id DESC LIMIT ? OFFSET ?"
            params.extend([limit, offset])
            cur.execute(query, tuple(params))
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
    except Exception as e:
        logger.exception("get_admin_logs failed: %s", e)
        return []


def get_balance_history(user_id: int, limit: int = 20) -> list:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT * FROM balance_history
                WHERE user_id = ? ORDER BY id DESC LIMIT ?
            """, (user_id, limit))
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
    except Exception as e:
        logger.exception("get_balance_history failed: %s", e)
        return []


def admin_set_balance(user_id: int, new_balance: int, admin_id: int, reason: str) -> tuple:
    if not isinstance(new_balance, int) or new_balance < 0:
        return False, 0, 0
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")

            cur.execute("SELECT balance_up FROM users WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row:
                return False, 0, 0
            old_balance = row[0] or 0

            cur.execute("UPDATE users SET balance_up = ? WHERE user_id = ?", (new_balance, user_id))

            cur.execute("""
                INSERT INTO balance_history
                (user_id, admin_id, old_balance, new_balance, change_amount, reason, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (user_id, admin_id, old_balance, new_balance,
                  new_balance - old_balance, reason, int(time.time())))

            return True, old_balance, new_balance
    except Exception as e:
        logger.exception("admin_set_balance failed: %s", e)
        return False, 0, 0


def admin_add_balance(user_id: int, amount: int, admin_id: int, reason: str) -> tuple:
    if not isinstance(amount, int) or amount == 0:
        return False, 0, 0
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")

            cur.execute("SELECT balance_up FROM users WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row:
                return False, 0, 0
            old_balance = row[0] or 0
            new_balance = old_balance + amount
            if new_balance < 0:
                new_balance = 0

            cur.execute("UPDATE users SET balance_up = ? WHERE user_id = ?", (new_balance, user_id))

            cur.execute("""
                INSERT INTO balance_history
                (user_id, admin_id, old_balance, new_balance, change_amount, reason, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (user_id, admin_id, old_balance, new_balance,
                  new_balance - old_balance, reason, int(time.time())))

            return True, old_balance, new_balance
    except Exception as e:
        logger.exception("admin_add_balance failed: %s", e)
        return False, 0, 0


def get_user_stats(user_id: int) -> dict:
    try:
        with db_conn() as conn:
            cur = conn.cursor()

            cur.execute("PRAGMA table_info(users)")
            cols = {c[1] for c in cur.fetchall()}

            wanted = ["user_id", "nickname", "balance_up", "balance_uc", "reg_date",
                      "level", "xp", "skin", "ref_code", "game_id", "rating"]
            wanted = [c for c in wanted if c in cols]

            cur.execute(f"SELECT {', '.join(wanted)} FROM users WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row:
                return None
            user_data = dict(zip(wanted, row))

            cur.execute("SELECT COUNT(*) FROM referrals WHERE referrer_id = ?", (user_id,))
            user_data["referrals"] = cur.fetchone()[0] or 0

            cur.execute("SELECT COUNT(*) FROM games_history WHERE user_id = ?", (user_id,))
            user_data["games_total"] = cur.fetchone()[0] or 0
            cur.execute("SELECT COUNT(*) FROM games_history WHERE user_id = ? AND result = 'win'", (user_id,))
            user_data["games_win"] = cur.fetchone()[0] or 0
            cur.execute("SELECT COUNT(*) FROM games_history WHERE user_id = ? AND result = 'lose'", (user_id,))
            user_data["games_lose"] = cur.fetchone()[0] or 0

            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='user_bank'")
            if cur.fetchone():
                cur.execute("SELECT card_number, balance_bank FROM user_bank WHERE user_id = ?", (user_id,))
                brow = cur.fetchone()
                if brow:
                    user_data["bank_card"] = brow[0]
                    user_data["bank_balance"] = brow[1]
                else:
                    user_data["bank_card"] = None
                    user_data["bank_balance"] = 0

            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='user_jobs'")
            if cur.fetchone():
                cur.execute("SELECT job_key, job_level, job_xp, jobs_done, total_earned, streak FROM user_jobs WHERE user_id = ?", (user_id,))
                jrow = cur.fetchone()
                if jrow:
                    user_data["job_key"], user_data["job_level"], user_data["job_xp"], \
                    user_data["jobs_done"], user_data["job_earned"], user_data["job_streak"] = jrow

            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='user_business'")
            if cur.fetchone():
                cur.execute("SELECT business_key, level, income FROM user_business WHERE user_id = ?", (user_id,))
                brow = cur.fetchone()
                if brow:
                    user_data["business_key"], user_data["business_level"], user_data["business_income"] = brow

            for table in ("user_cars", "my_cars", "user_car"):
                cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,))
                if cur.fetchone():
                    try:
                        cur.execute(f"SELECT car_name FROM {table} WHERE user_id = ?", (user_id,))
                        crow = cur.fetchone()
                        if crow:
                            user_data["car"] = crow[0]
                            break
                    except Exception:
                        pass

            return user_data
    except Exception as e:
        logger.exception("get_user_stats failed for %s: %s", user_id, e)
        return None


def get_bot_stats(period_days: int = 0) -> dict:
    try:
        with db_conn() as conn:
            cur = conn.cursor()

            if period_days > 0:
                since = int(time.time()) - period_days * 86400
                cur.execute("SELECT COUNT(*) FROM users WHERE reg_date >= ?", (since,))
                players = cur.fetchone()[0] or 0
                cur.execute("SELECT COUNT(*) FROM games_history WHERE created_at >= ?", (since,))
                games = cur.fetchone()[0] or 0
                cur.execute("SELECT COALESCE(SUM(win_amount), 0) FROM games_history WHERE created_at >= ?", (since,))
                won = cur.fetchone()[0] or 0
                cur.execute("SELECT COALESCE(SUM(bet), 0) FROM games_history WHERE created_at >= ?", (since,))
                lost = cur.fetchone()[0] or 0
            else:
                cur.execute("SELECT COUNT(*) FROM users")
                players = cur.fetchone()[0] or 0
                cur.execute("SELECT COUNT(*) FROM games_history")
                games = cur.fetchone()[0] or 0
                cur.execute("SELECT COALESCE(SUM(win_amount), 0) FROM games_history")
                won = cur.fetchone()[0] or 0
                cur.execute("SELECT COALESCE(SUM(bet), 0) FROM games_history")
                lost = cur.fetchone()[0] or 0

            cur.execute("SELECT COALESCE(SUM(balance_up), 0) FROM users")
            total_up = cur.fetchone()[0] or 0

            week_ago = int(time.time()) - 7 * 86400
            cur.execute("SELECT COUNT(DISTINCT user_id) FROM click_logs WHERE created_at >= ?", (week_ago,))
            active = cur.fetchone()[0] or 0

            stats = {
                "players": players,
                "active": active,
                "games": games,
                "total_up": total_up,
                "won_up": won,
                "lost_up": lost,
            }

            for table, key in (("user_business", "businesses"),
                               ("user_bank", "banks"),
                               ("user_skins", "skins")):
                try:
                    cur.execute(f"SELECT COUNT(*) FROM {table}")
                    stats[key] = cur.fetchone()[0] or 0
                except Exception:
                    stats[key] = 0

            return stats
    except Exception as e:
        logger.exception("get_bot_stats failed: %s", e)
        return {}


def get_game_by_id(game_id: str) -> dict:
    try:
        gid = str(game_id).replace("#", "").strip()
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM games_history WHERE game_id = ? ORDER BY id DESC LIMIT 1", (gid,))
            row = cur.fetchone()
            if not row:
                cur.execute("SELECT * FROM games_history WHERE id = ?", (gid,))
                row = cur.fetchone()
            if not row:
                return None
            cols = [d[0] for d in cur.description]
            return dict(zip(cols, row))
    except Exception as e:
        logger.exception("get_game_by_id failed: %s", e)
        return None


def clear_old_logs(days: int = 30) -> int:
    try:
        cutoff = int(time.time()) - days * 86400
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM admin_logs WHERE created_at < ?", (cutoff,))
            deleted = cur.rowcount
            cur.execute("DELETE FROM click_logs WHERE created_at < ?", (cutoff,))
            return deleted
    except Exception as e:
        logger.exception("clear_old_logs failed: %s", e)
        return 0


def get_all_click_logs(limit: int = 10000) -> list:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT * FROM click_logs ORDER BY id DESC LIMIT ?
            """, (limit,))
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
    except Exception as e:
        logger.exception("get_all_click_logs failed: %s", e)
        return []


def admin_set_level(user_id: int, level: int, admin_id: int, reason: str) -> tuple:
    if not isinstance(level, int) or level < 1:
        return False, 0, 0
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            cur.execute("SELECT level FROM users WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row:
                return False, 0, 0
            old_level = row[0] or 1
            cur.execute("UPDATE users SET level = ? WHERE user_id = ?", (level, user_id))
            cur.execute("""
                INSERT INTO admin_logs
                (user_id, action_type, extra, created_at)
                VALUES (?, 'level_set', ?, ?)
            """, (user_id, f"{old_level}->{level} (by {admin_id}, {reason})", int(time.time())))
            return True, old_level, level
    except Exception as e:
        logger.exception("admin_set_level failed: %s", e)
        return False, 0, 0


def admin_set_xp(user_id: int, xp: int, admin_id: int, reason: str) -> tuple:
    if not isinstance(xp, int) or xp < 0:
        return False, 0, 0
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            cur.execute("SELECT xp FROM users WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row:
                return False, 0, 0
            old_xp = row[0] or 0
            cur.execute("UPDATE users SET xp = ? WHERE user_id = ?", (xp, user_id))
            cur.execute("""
                INSERT INTO admin_logs
                (user_id, action_type, extra, created_at)
                VALUES (?, 'xp_set', ?, ?)
            """, (user_id, f"{old_xp}->{xp} (by {admin_id}, {reason})", int(time.time())))
            return True, old_xp, xp
    except Exception as e:
        logger.exception("admin_set_xp failed: %s", e)
        return False, 0, 0


def admin_set_skin(user_id: int, skin_file: str, admin_id: int) -> bool:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")

            cur.execute("UPDATE users SET skin = ? WHERE user_id = ?", (skin_file, user_id))
            if cur.rowcount == 0:
                return False

            cur.execute("SELECT 1 FROM user_skins WHERE user_id = ? AND skin_file = ?", (user_id, skin_file))
            if not cur.fetchone():
                cur.execute("""
                    INSERT INTO user_skins (user_id, skin_file, granted_by, granted_at, is_active)
                    VALUES (?, ?, ?, ?, 1)
                """, (user_id, skin_file, admin_id, int(time.time())))
            else:
                cur.execute("""
                    UPDATE user_skins SET is_active = 1, granted_by = ?, granted_at = ?
                    WHERE user_id = ? AND skin_file = ?
                """, (admin_id, int(time.time()), user_id, skin_file))

            cur.execute("UPDATE user_skins SET is_active = 0 WHERE user_id = ? AND skin_file != ?", (user_id, skin_file))

            cur.execute("""
                INSERT INTO admin_logs
                (user_id, action_type, extra, created_at)
                VALUES (?, 'skin_set', ?, ?)
            """, (user_id, f"skin={skin_file} (by {admin_id})", int(time.time())))
            return True
    except Exception as e:
        logger.exception("admin_set_skin failed: %s", e)
        return False


def admin_grant_skin(user_id: int, skin_file: str, admin_id: int) -> bool:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT OR IGNORE INTO user_skins
                (user_id, skin_file, granted_by, granted_at, is_active)
                VALUES (?, ?, ?, ?, 0)
            """, (user_id, skin_file, admin_id, int(time.time())))
            cur.execute("""
                INSERT INTO admin_logs
                (user_id, action_type, extra, created_at)
                VALUES (?, 'skin_grant', ?, ?)
            """, (user_id, f"skin={skin_file} (by {admin_id})", int(time.time())))
            return True
    except Exception as e:
        logger.exception("admin_grant_skin failed: %s", e)
        return False


def admin_revoke_skin(user_id: int, skin_file: str, admin_id: int) -> bool:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM user_skins WHERE user_id = ? AND skin_file = ?", (user_id, skin_file))
            cur.execute("""
                INSERT INTO admin_logs
                (user_id, action_type, extra, created_at)
                VALUES (?, 'skin_revoke', ?, ?)
            """, (user_id, f"skin={skin_file} (by {admin_id})", int(time.time())))
            return True
    except Exception as e:
        logger.exception("admin_revoke_skin failed: %s", e)
        return False


def get_user_skins(user_id: int) -> list:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT skin_file, is_active FROM user_skins WHERE user_id = ?", (user_id,))
            return cur.fetchall()
    except Exception as e:
        logger.exception("get_user_skins failed: %s", e)
        return []


def get_all_user_ids() -> list:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT user_id FROM users")
            return [row[0] for row in cur.fetchall()]
    except Exception as e:
        logger.exception("get_all_user_ids failed: %s", e)
        return []


# ================== РЕЙТИНГ ==================
def _init_rating_tables():
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS rating_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    op_type TEXT,
                    amount INTEGER,
                    price INTEGER,
                    commission INTEGER,
                    final_amount INTEGER,
                    rating_before INTEGER,
                    rating_after INTEGER,
                    balance_before INTEGER,
                    balance_after INTEGER,
                    created_at INTEGER
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_rating_history_user ON rating_history(user_id, id DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_rating_history_time ON rating_history(created_at DESC)")
        logger.info("Таблица rating_history инициализирована")
    except Exception as e:
        logger.exception("init_rating_tables failed: %s", e)


_init_rating_tables()


def get_rating(user_id: int) -> int:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT rating FROM users WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            return int(row[0]) if row and row[0] is not None else 0
    except Exception as e:
        logger.exception("get_rating failed for %s: %s", user_id, e)
        return 0


def buy_rating(user_id: int, amount: int) -> tuple:
    if not isinstance(amount, int) or amount <= 0 or amount > RATING_MAX_PER_TX:
        return False, "invalid_amount", {}

    total_price = amount * RATING_BUY_PRICE
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")

            cur.execute("SELECT balance_up, rating FROM users WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row:
                return False, "user_not_found", {}

            balance_before = int(row[0] or 0)
            rating_before = int(row[1] or 0)

            if balance_before < total_price:
                return False, "insufficient_funds", {"balance": balance_before, "need": total_price}

            rating_after = rating_before + amount
            balance_after = balance_before - total_price

            cur.execute("UPDATE users SET balance_up = ?, rating = ? WHERE user_id = ?",
                        (balance_after, rating_after, user_id))

            cur.execute("""
                INSERT INTO rating_history
                (user_id, op_type, amount, price, commission, final_amount,
                 rating_before, rating_after, balance_before, balance_after, created_at)
                VALUES (?, 'buy', ?, ?, 0, ?, ?, ?, ?, ?, ?)
            """, (user_id, amount, total_price, total_price,
                  rating_before, rating_after, balance_before, balance_after, int(time.time())))

            return True, "ok", {
                "amount": amount,
                "price": total_price,
                "rating_before": rating_before,
                "rating_after": rating_after,
                "balance_before": balance_before,
                "balance_after": balance_after,
            }
    except Exception as e:
        logger.exception("buy_rating failed for %s: %s", user_id, e)
        return False, "db_error", {}


def sell_rating(user_id: int, amount: int) -> tuple:
    if not isinstance(amount, int) or amount <= 0 or amount > RATING_MAX_PER_TX:
        return False, "invalid_amount", {}

    gross = amount * RATING_SELL_PRICE
    commission = int(gross * RATING_COMMISSION)
    net = gross - commission

    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")

            cur.execute("SELECT balance_up, rating FROM users WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row:
                return False, "user_not_found", {}

            balance_before = int(row[0] or 0)
            rating_before = int(row[1] or 0)

            if rating_before < amount:
                return False, "not_enough_rating", {"rating": rating_before, "need": amount}

            rating_after = rating_before - amount
            if rating_after < 0:
                rating_after = 0
            balance_after = balance_before + net

            cur.execute("UPDATE users SET balance_up = ?, rating = ? WHERE user_id = ?",
                        (balance_after, rating_after, user_id))

            cur.execute("""
                INSERT INTO rating_history
                (user_id, op_type, amount, price, commission, final_amount,
                 rating_before, rating_after, balance_before, balance_after, created_at)
                VALUES (?, 'sell', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (user_id, amount, gross, commission, net,
                  rating_before, rating_after, balance_before, balance_after, int(time.time())))

            return True, "ok", {
                "amount": amount,
                "gross": gross,
                "commission": commission,
                "net": net,
                "rating_before": rating_before,
                "rating_after": rating_after,
                "balance_before": balance_before,
                "balance_after": balance_after,
            }
    except Exception as e:
        logger.exception("sell_rating failed for %s: %s", user_id, e)
        return False, "db_error", {}


def get_rating_history(user_id: int, limit: int = 10) -> list:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT * FROM rating_history
                WHERE user_id = ? ORDER BY id DESC LIMIT ?
            """, (user_id, limit))
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
    except Exception as e:
        logger.exception("get_rating_history failed: %s", e)
        return []


# ================== ЕДИНАЯ СИСТЕМА УРОВНЯ ==================
def xp_needed(level: int) -> int:
    try:
        lvl = max(1, int(level))
        return 100 + (lvl - 1) * 100
    except Exception:
        return 100


def get_user_level(user_id: int) -> dict:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT COALESCE(level, 1), COALESCE(xp, 0) FROM users WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row:
                return {"level": 1, "xp": 0, "xp_needed": xp_needed(1)}
            level = max(1, int(row[0] or 1))
            xp = max(0, int(row[1] or 0))
            return {"level": level, "xp": xp, "xp_needed": xp_needed(level)}
    except Exception as e:
        logger.exception("get_user_level failed: %s", e)
        return {"level": 1, "xp": 0, "xp_needed": xp_needed(1)}


def add_exp(user_id: int, amount: int) -> dict:
    result = {"ok": False, "old_level": 1, "new_level": 1, "leveled_up": False,
              "xp": 0, "xp_needed": xp_needed(1), "levels_gained": 0}
    if not isinstance(amount, int) or amount == 0:
        return result
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            cur.execute("SELECT COALESCE(level, 1), COALESCE(xp, 0) FROM users WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row:
                return result

            level = max(1, int(row[0] or 1))
            xp = max(0, int(row[1] or 0)) + amount
            old_level = level

            if xp < 0:
                xp = 0

            gained = 0
            while xp >= xp_needed(level):
                xp -= xp_needed(level)
                level += 1
                gained += 1

            cur.execute("UPDATE users SET level = ?, xp = ? WHERE user_id = ?", (level, xp, user_id))

            result.update({
                "ok": True,
                "old_level": old_level,
                "new_level": level,
                "leveled_up": gained > 0,
                "xp": xp,
                "xp_needed": xp_needed(level),
                "levels_gained": gained,
            })
            return result
    except Exception as e:
        logger.exception("add_exp failed: %s", e)
        return result


def get_unlocked_jobs(level: int) -> list:
    jobs = [
        (1, "garbage"),
        (3, "taxi"),
        (5, "mechanic"),
        (8, "programmer"),
        (12, "businessman"),
        (20, "investor"),
    ]
    return [key for lvl, key in jobs if level >= lvl]