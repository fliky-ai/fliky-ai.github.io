import sqlite3
import random
import string
import time
import logging
from contextlib import contextmanager
from aiogram import Router, types, F
from aiogram.filters import Command
from database import DB_NAME, get_or_create_user, log_action
from config import is_creator

logger = logging.getLogger(__name__)
router = Router()

REF_REWARD_REFERRER = 500
REF_REWARD_NEWBIE = 100
REF_CODE_LEN = 6
DEFAULT_NICK = "Игрок"


# ---------- Безопасное соединение ----------
@contextmanager
def db_conn():
    conn = None
    try:
        conn = sqlite3.connect(DB_NAME, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=10000")
        yield conn
        conn.commit()
    except Exception:
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        raise
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


# ---------- Утилиты ----------
def check_user_registered(user_id: int) -> bool:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT 1 FROM users WHERE user_id = ?", (user_id,))
            return cur.fetchone() is not None
    except Exception as e:
        logger.exception("check_user_registered failed for %s: %s", user_id, e)
        return False


def generate_unique_ref_code() -> str:
    chars = string.ascii_uppercase + string.digits
    with db_conn() as conn:
        cur = conn.cursor()
        for _ in range(20):
            code = "".join(random.choices(chars, k=REF_CODE_LEN))
            cur.execute("SELECT 1 FROM users WHERE ref_code = ?", (code,))
            if not cur.fetchone():
                return code
        raise RuntimeError("Не удалось сгенерировать уникальный ref_code за 20 попыток")


def get_user_ref_code(user_id: int) -> str:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT ref_code FROM users WHERE user_id = ?", (user_id,))
        row = cur.fetchone()
        if row and row[0]:
            return row[0]

        code = generate_unique_ref_code()
        cur.execute("UPDATE users SET ref_code = ? WHERE user_id = ?", (code, user_id))
        return code


def get_user_nickname(user_id: int) -> str:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT nickname FROM users WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            return row[0] if row and row[0] else DEFAULT_NICK
    except Exception as e:
        logger.exception("get_user_nickname failed for %s: %s", user_id, e)
        return DEFAULT_NICK


def get_user_by_ref_code(ref_code: str):
    if not ref_code or not isinstance(ref_code, str):
        return None
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT user_id FROM users WHERE ref_code = ?", (ref_code,))
            row = cur.fetchone()
            return row[0] if row else None
    except Exception as e:
        logger.exception("get_user_by_ref_code failed for %s: %s", ref_code, e)
        return None


def _already_referred(user_id: int) -> bool:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT 1 FROM referrals WHERE referred_id = ?", (user_id,))
            return cur.fetchone() is not None
    except Exception as e:
        logger.exception("_already_referred failed for %s: %s", user_id, e)
        return True


def _apply_referral(referrer_id: int, newbie_id: int) -> bool:
    """Атомарно применяет реферал. True — если применили."""
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT 1 FROM referrals WHERE referred_id = ?", (newbie_id,))
            if cur.fetchone():
                return False

            cur.execute(
                "INSERT INTO referrals (referrer_id, referred_id, created_at, reward) VALUES (?, ?, ?, ?)",
                (referrer_id, newbie_id, int(time.time()), REF_REWARD_REFERRER)
            )
            cur.execute(
                "UPDATE users SET invited_by = ?, balance_up = balance_up + ? WHERE user_id = ?",
                (referrer_id, REF_REWARD_REFERRER, referrer_id)
            )
            cur.execute(
                "UPDATE users SET balance_up = balance_up + ? WHERE user_id = ?",
                (REF_REWARD_NEWBIE, newbie_id)
            )
            return True
    except Exception as e:
        logger.exception("_apply_referral failed (%s -> %s): %s", referrer_id, newbie_id, e)
        return False


def get_user_balance(user_id: int) -> int:
    """Текущий баланс для логирования (баланс до/после)."""
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT balance_up FROM users WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            return int(row[0]) if row and row[0] is not None else 0
    except Exception:
        return 0


def _log(user_id: int, username, display_name, action_type: str,
         command: str = None, message_text: str = None,
         callback_data: str = None, balance_before: int = None,
         balance_after: int = None, extra: str = None):
    """Обёртка для логирования в click_logs + admin_logs. Не падает."""
    try:
        bc = None
        if balance_before is not None and balance_after is not None:
            bc = balance_after - balance_before
        log_action(
            user_id=user_id,
            username=username,
            display_name=display_name,
            action_type=action_type,
            command=command,
            callback_data=callback_data,
            message_text=message_text,
            balance_before=balance_before,
            balance_after=balance_after,
            balance_change=bc,
            extra=extra,
        )
    except Exception as e:
        logger.exception("log failed: %s", e)


# ---------- Клавиатура главного меню ----------
def build_main_keyboard(user_id: int, chat_type: str) -> types.ReplyKeyboardMarkup:
    rows = [
        [types.KeyboardButton(text="👤 Профиль"), types.KeyboardButton(text="🎁 Бонус")],
        [types.KeyboardButton(text="🎮 Игры"), types.KeyboardButton(text="📜 Политика")],
        [types.KeyboardButton(text="❓ Помощь"), types.KeyboardButton(text="💬 Чаты")],
    ]

    try:
        if chat_type == "private" and is_creator(user_id):
            rows.append([types.KeyboardButton(text="🛠️ Админ-панель")])
    except Exception as e:
        logger.warning("is_creator check failed for %s: %s", user_id, e)

    return types.ReplyKeyboardMarkup(keyboard=rows, resize_keyboard=True)


# ---------- Хендлер /start ----------
@router.message(Command("start"))
async def cmd_start(message: types.Message):
    try:
        user = message.from_user
        if not user:
            return
        user_id = user.id
        username = user.username
        display_name = user.full_name or DEFAULT_NICK

        _log(
            user_id=user_id,
            username=username,
            display_name=display_name,
            action_type="MESSAGE",
            command="/start",
            message_text=(message.text or "")[:200],
            extra=f"chat_type={message.chat.type}"
        )

        if message.chat.type != "private":
            try:
                await message.answer(
                    "🤖 Чтобы начать игру, перейдите в личные сообщения бота и нажмите /start!"
                )
            except Exception:
                pass
            return

        args = (message.text or "").split()
        balance_before = get_user_balance(user_id)
        already_exists = check_user_registered(user_id)

        referrer_id = None
        if len(args) > 1 and args[1].startswith("ref_") and not already_exists:
            ref_code_input = args[1].replace("ref_", "", 1).strip()
            if ref_code_input:
                _log(
                    user_id=user_id,
                    username=username,
                    display_name=display_name,
                    action_type="MESSAGE",
                    command="/start",
                    extra=f"ref_code={ref_code_input}"
                )
                potential_referrer = get_user_by_ref_code(ref_code_input)
                if potential_referrer and potential_referrer != user_id and not _already_referred(user_id):
                    referrer_id = potential_referrer

        try:
            is_new, game_id, balance_up, balance_uc = get_or_create_user(user_id)
        except Exception as e:
            logger.exception("get_or_create_user failed for %s: %s", user_id, e)
            try:
                await message.answer("⚠️ Не удалось создать профиль. Попробуй позже.")
            except Exception:
                pass
            return

        if is_new and not already_exists:
            _log(
                user_id=user_id,
                username=username,
                display_name=display_name,
                action_type="REGISTER",
                extra=f"game_id={game_id} start_balance={balance_up} uc={balance_uc}",
                balance_before=0,
                balance_after=balance_up,
            )
        else:
            _log(
                user_id=user_id,
                username=username,
                display_name=display_name,
                action_type="LOGIN",
                extra=f"game_id={game_id} balance={balance_up}",
                balance_before=balance_up,
                balance_after=balance_up,
            )

        player_nick = get_user_nickname(user_id)
        if player_nick == DEFAULT_NICK:
            try:
                with db_conn() as conn:
                    cur = conn.cursor()
                    cur.execute(
                        "UPDATE users SET nickname = ? WHERE user_id = ? AND (nickname IS NULL OR nickname = '')",
                        (DEFAULT_NICK, user_id)
                    )
            except Exception as e:
                logger.exception("nickname fix failed for %s: %s", user_id, e)

        if not already_exists and referrer_id:
            if _apply_referral(referrer_id, user_id):
                _log(
                    user_id=user_id,
                    username=username,
                    display_name=display_name,
                    action_type="REFERRAL",
                    extra=f"referrer={referrer_id} reward={REF_REWARD_NEWBIE}",
                    balance_before=balance_before,
                    balance_after=get_user_balance(user_id),
                )
                _log(
                    user_id=referrer_id,
                    username=None,
                    display_name=None,
                    action_type="REFERRAL_BONUS",
                    extra=f"newbie={user_id} reward={REF_REWARD_REFERRER}",
                )
                try:
                    newbie_nick = get_user_nickname(user_id)
                    await message.bot.send_message(
                        referrer_id,
                        "🎉 <b>Новый игрок присоединился!</b>\n\n"
                        f"👤 Игрок: <b>{newbie_nick}</b>\n\n"
                        f"🎁 <b>Награда:</b> +{REF_REWARD_REFERRER} UP",
                        parse_mode="HTML"
                    )
                except Exception as e:
                    logger.warning("Не удалось уведомить реферера %s: %s", referrer_id, e)

        kb = build_main_keyboard(user_id, message.chat.type)

        if is_new and not already_exists:
            text = (
                f"🐯 <b>Добро пожаловать в Upgradebot, {player_nick}!</b>\n\n"
                f"⚡️ Твоя личная игровая платформа успешно запущена.\n"
                f"🎁 На стартовый счет зачислено: <code>+5 000 UP</code>.\n\n"
                f"👇 Выбирай нужный раздел в меню ниже и погнали!"
            )
        else:
            text = (
                f"🐅 <b>С возвращением, {player_nick}!</b>\n\n"
                f"⚡️ Ты снова в игре. Выбирай режим в меню и продолжай прокачку.\n\n"
                f"👇 Жми на кнопку ниже:"
            )

        try:
            await message.answer(text, parse_mode="HTML", reply_markup=kb)
            _log(
                user_id=user_id,
                username=username,
                display_name=display_name,
                action_type="BOT_REPLY",
                command="/start",
                extra="start_menu_sent",
            )
        except Exception as e:
            logger.exception("Не удалось отправить стартовое сообщение %s: %s", user_id, e)

    except Exception as e:
        logger.exception("Критическая ошибка в cmd_start: %s", e)
        try:
            await message.answer("⚠️ Что-то пошло не так. Попробуй ещё раз.")
        except Exception:
            pass