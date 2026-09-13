from aiogram import Router, types, F
from database import DB_NAME
from handlers.start import check_user_registered
import sqlite3
import logging

logger = logging.getLogger(__name__)
router = Router()

@router.message(F.text.casefold().in_({"б", "баланс"}))
async def cmd_balance(message: types.Message):
    user_id = message.from_user.id

    try:
        registered = check_user_registered(user_id)
    except Exception as e:
        logger.exception("check_user_registered failed for %s: %s", user_id, e)
        await message.reply("⚠️ Временная ошибка. Попробуй позже.", parse_mode="HTML")
        return

    if not registered:
        await message.answer(
            "❌ <b>Вы еще не зарегистрированы!</b>\n\n"
            "💡 Пожалуйста, перейдите в <b>личные сообщения</b> бота и нажмите /start, чтобы активировать игровой профиль!",
            parse_mode="HTML"
        )
        return

    balance = _fetch_balance(user_id)

    if balance is None:
        await message.reply("⚠️ Не удалось загрузить баланс. Попробуй позже.", parse_mode="HTML")
        return

    formatted_balance = f"{balance:,}".replace(",", " ")
    text = f"💰 Баланс: <b>{formatted_balance} UP</b>"
    await message.reply(text, parse_mode="HTML")


def _fetch_balance(user_id: int) -> int | None:
    conn = None
    try:
        conn = sqlite3.connect(DB_NAME, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=10000")
        cursor = conn.cursor()

        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        if not cursor.fetchone():
            logger.error("Table 'users' does not exist")
            return None

        cursor.execute("PRAGMA table_info(users)")
        cols = {col[1] for col in cursor.fetchall()}

        for candidate in ("balance_up", "balance"):
            if candidate in cols:
                up_col = candidate
                break
        else:
            logger.error("No balance column found in users table. Columns: %s", cols)
            return None

        cursor.execute(f"SELECT {up_col} FROM users WHERE user_id = ?", (user_id,))
        row = cursor.fetchone()

        if not row or row[0] is None:
            return 0

        try:
            return int(row[0])
        except (TypeError, ValueError):
            logger.error("Invalid balance value for user %s: %r", user_id, row[0])
            return 0

    except sqlite3.OperationalError as e:
        logger.exception("SQLite operational error for user %s: %s", user_id, e)
        return None
    except sqlite3.DatabaseError as e:
        logger.exception("SQLite database error for user %s: %s", user_id, e)
        return None
    except Exception as e:
        logger.exception("Unexpected error fetching balance for %s: %s", user_id, e)
        return None
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass