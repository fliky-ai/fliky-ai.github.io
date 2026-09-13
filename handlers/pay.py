import time
import uuid
import logging
from aiogram import Router, types, F
from database import db_conn, get_user, DEFAULT_NICK, check_user_registered, log_action

logger = logging.getLogger(__name__)
router = Router()

DAILY_LIMIT = 100_000
MAX_AMOUNT = 1_000_000_000

GIVE_COMMANDS = {"дать", "даровать", "дар"}


# ================== БД ==================
def _init_give_tables():
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS give_limits (
                    user_id INTEGER PRIMARY KEY,
                    given_today INTEGER DEFAULT 0,
                    last_reset INTEGER DEFAULT 0
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS give_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    operation_id TEXT UNIQUE,
                    sender_id INTEGER,
                    receiver_id INTEGER,
                    amount INTEGER,
                    status TEXT DEFAULT 'completed',
                    created_at INTEGER
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_give_history_sender ON give_history(sender_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_give_history_created ON give_history(created_at)")
    except Exception as e:
        logger.exception("init_give_tables failed: %s", e)


_init_give_tables()


# ================== УТИЛИТЫ ==================
def _fmt(n) -> str:
    try:
        return f"{int(n):,}".replace(",", " ")
    except (TypeError, ValueError):
        return "0"


def _esc(s) -> str:
    return (str(s) if s is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _nick(user_id: int) -> str:
    try:
        u = get_user(user_id) or {}
        return u.get("nickname") or DEFAULT_NICK
    except Exception:
        return DEFAULT_NICK


def _balance(user_id: int) -> int:
    try:
        u = get_user(user_id) or {}
        return int(u.get("balance_up") or 0)
    except Exception:
        return 0


def _reset_time(last_reset) -> str:
    try:
        remaining = (int(last_reset) + 86400) - int(time.time())
        if remaining <= 0:
            return "сейчас"
        h, m = remaining // 3600, (remaining % 3600) // 60
        return f"{h}ч {m}м" if h > 0 else f"{m}м"
    except Exception:
        return "—"


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


def _pay_log(user_id: int, user, action: str, **kwargs):
    try:
        log_action(
            user_id=user_id,
            username=getattr(user, "username", None),
            display_name=getattr(user, "full_name", None),
            action_type="PAY",
            extra=action,
            **kwargs,
        )
    except Exception:
        pass


# ================== ЛИМИТ ==================
def _get_limit(user_id: int) -> dict:
    try:
        now = int(time.time())
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT given_today, last_reset FROM give_limits WHERE user_id = ?", (user_id,))
            row = cur.fetchone()

            if not row:
                cur.execute(
                    "INSERT OR IGNORE INTO give_limits (user_id, given_today, last_reset) VALUES (?, 0, ?)",
                    (user_id, now)
                )
                return {"given_today": 0, "last_reset": now, "remaining": DAILY_LIMIT}

            given, last_reset = row
            given = given or 0
            last_reset = last_reset or now

            if now - last_reset >= 86400:
                cur.execute(
                    "UPDATE give_limits SET given_today = 0, last_reset = ? WHERE user_id = ?",
                    (now, user_id)
                )
                given, last_reset = 0, now

            return {
                "given_today": given,
                "last_reset": last_reset,
                "remaining": max(0, DAILY_LIMIT - given),
            }
    except Exception as e:
        logger.exception("_get_limit failed for %s: %s", user_id, e)
        return {"given_today": 0, "last_reset": int(time.time()), "remaining": DAILY_LIMIT}


# ================== АТОМАРНЫЙ ПЕРЕВОД ==================
def _do_transfer(sender_id: int, receiver_id: int, amount: int):
    if amount <= 0:
        return False, "invalid_amount"
    if sender_id == receiver_id:
        return False, "self_transfer"

    now = int(time.time())
    operation_id = str(uuid.uuid4())

    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")

            cur.execute("SELECT balance_up FROM users WHERE user_id = ?", (sender_id,))
            srow = cur.fetchone()
            if not srow:
                return False, "sender_not_found"
            if (srow[0] or 0) < amount:
                return False, "insufficient_funds"

            cur.execute("SELECT 1 FROM users WHERE user_id = ?", (receiver_id,))
            if not cur.fetchone():
                return False, "receiver_not_found"

            cur.execute("SELECT given_today, last_reset FROM give_limits WHERE user_id = ?", (sender_id,))
            lrow = cur.fetchone()
            if not lrow:
                cur.execute(
                    "INSERT INTO give_limits (user_id, given_today, last_reset) VALUES (?, 0, ?)",
                    (sender_id, now)
                )
                given, last_reset = 0, now
            else:
                given, last_reset = (lrow[0] or 0), (lrow[1] or now)
                if now - last_reset >= 86400:
                    given, last_reset = 0, now

            remaining = max(0, DAILY_LIMIT - given)
            if remaining <= 0:
                return False, "limit_exhausted"
            if amount > remaining:
                return False, f"limit_exceeded:{remaining}"

            cur.execute("UPDATE users SET balance_up = balance_up - ? WHERE user_id = ?", (amount, sender_id))
            cur.execute("UPDATE users SET balance_up = balance_up + ? WHERE user_id = ?", (amount, receiver_id))

            cur.execute(
                "UPDATE give_limits SET given_today = given_today + ?, last_reset = ? WHERE user_id = ?",
                (amount, last_reset, sender_id)
            )

            cur.execute(
                "INSERT INTO give_history (operation_id, sender_id, receiver_id, amount, status, created_at) "
                "VALUES (?, ?, ?, ?, 'completed', ?)",
                (operation_id, sender_id, receiver_id, amount, now)
            )

            return True, operation_id
    except Exception as e:
        logger.exception("_do_transfer failed %s->%s: %s", sender_id, receiver_id, e)
        return False, "db_error"


async def _reply_error(message: types.Message, reason: str):
    mapping = {
        "invalid_amount": "укажите корректную сумму",
        "self_transfer": "нельзя переводить самому себе",
        "sender_not_found": "отправитель не найден",
        "receiver_not_found": "получатель не найден или ещё не зарегистрирован",
        "insufficient_funds": "недостаточно UP на балансе",
        "limit_exhausted": "дневной лимит исчерпан",
        "db_error": "ошибка транзакции, попробуйте позже",
    }

    if reason.startswith("limit_exceeded:"):
        val = reason.split(":", 1)[1]
        body = f"можно передать сегодня ещё <b>{_fmt(val)} UP</b>"
    else:
        body = mapping.get(reason, "не удалось выполнить перевод")

    try:
        await message.reply(
            f"❌ <b>Перевод невозможен</b>\n\n> {body}",
            parse_mode="HTML",
        )
    except Exception:
        pass


# ================== ПОДСКАЗКА ==================
async def _show_hint(message: types.Message):
    """Короткая подсказка. Работает и в ЛС, и в группе."""
    try:
        await message.reply(
            "❌ <b>Используйте:</b> <code>даровать сумма [id]</code>",
            parse_mode="HTML",
        )
    except Exception as e:
        logger.exception("_show_hint failed: %s", e)


# ================== КОМАНДА «ЛИМИТ» ==================
@router.message(F.text.casefold().in_({"лимит", "мой лимит", "лимит переводов"}))
async def cmd_limit(message: types.Message):
    try:
        if not await _require_reg(message):
            return
        uid = message.from_user.id

        info = _get_limit(uid)
        text = (
            "📊 <b>Ваш лимит</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"💸 Дневной лимит: <b>{_fmt(DAILY_LIMIT)} UP</b>\n"
            f"📤 Передано сегодня: <b>{_fmt(info['given_today'])} UP</b>\n"
            f"💰 Осталось: <b>{_fmt(info['remaining'])} UP</b>\n"
            f"🔄 Сброс: <b>{_reset_time(info['last_reset'])}</b>"
        )
        await message.answer(text, parse_mode="HTML")
    except Exception as e:
        logger.exception("cmd_limit failed: %s", e)


# ================== «ДАТЬ / ДАРОВАТЬ» БЕЗ АРГУМЕНТОВ ==================
@router.message(F.text.casefold().in_(GIVE_COMMANDS))
async def cmd_give_empty(message: types.Message):
    try:
        if not await _require_reg(message):
            return
        await _show_hint(message)
    except Exception as e:
        logger.exception("cmd_give_empty failed: %s", e)


# ================== КОМАНДА С АРГУМЕНТАМИ ==================
@router.message(F.text.lower().startswith(("даровать ", "дать ", "дар ")))
async def cmd_give(message: types.Message):
    try:
        if not await _require_reg(message):
            return

        uid = message.from_user.id
        parts = (message.text or "").split()

        receiver_id = None
        amount = None

        # === с reply ===
        if message.reply_to_message and message.reply_to_message.from_user:
            if len(parts) < 2:
                await message.reply(
                    "❌ <b>Укажите сумму</b>\n\n"
                    "<i>Пример: даровать 1000</i>",
                    parse_mode="HTML",
                )
                return
            try:
                amount = int(parts[1])
                receiver_id = message.reply_to_message.from_user.id
            except (ValueError, IndexError):
                await message.reply(
                    "❌ <b>Некорректная сумма</b>\n\n"
                    "<i>Пример: даровать 1000</i>",
                    parse_mode="HTML",
                )
                return

        # === без reply ===
        else:
            if len(parts) < 3:
                await message.reply(
                    "❌ <b>Используйте:</b> <code>даровать сумма [id]</code>",
                    parse_mode="HTML",
                )
                return
            try:
                amount = int(parts[1])
                receiver_id = int(parts[2])
            except ValueError:
                await message.reply(
                    "❌ <b>Используйте:</b> <code>даровать сумма [id]</code>",
                    parse_mode="HTML",
                )
                return

        # === валидация суммы ===
        if amount is None or amount <= 0:
            await message.reply("❌ <b>Некорректная сумма</b>", parse_mode="HTML")
            return
        if amount > MAX_AMOUNT:
            await message.reply("❌ <b>Слишком большая сумма</b>", parse_mode="HTML")
            return

        # === self ===
        if receiver_id == uid:
            await message.reply("❌ <b>Нельзя переводить самому себе</b>", parse_mode="HTML")
            return

        # === бот-получатель ===
        if message.reply_to_message and message.reply_to_message.from_user:
            if message.reply_to_message.from_user.is_bot:
                await message.reply("❌ <b>Нельзя переводить ботам</b>", parse_mode="HTML")
                return

        # === получатель зареган ===
        if not check_user_registered(receiver_id):
            await message.reply(
                "❌ <b>Пользователь не найден или ещё не зарегистрирован</b>",
                parse_mode="HTML",
            )
            return

        # === перевод ===
        ok, info = _do_transfer(uid, receiver_id, amount)
        if not ok:
            await _reply_error(message, info)
            return

        _pay_log(uid, message.from_user, "give",
                 balance_before=_balance(uid) + amount,
                 balance_after=_balance(uid),
                 extra_detail=f"to={receiver_id} amount={amount}")

        receiver_nick = _nick(receiver_id)
        sender_nick = _nick(uid)

        # уведомление получателю
        try:
            await message.bot.send_message(
                receiver_id,
                f"💸 <b>Вам перевели UP</b>\n\n"
                f"👤 От: <b>{_esc(sender_nick)}</b>\n"
                f"💰 Сумма: <b>+{_fmt(amount)} UP</b>",
                parse_mode="HTML",
            )
        except Exception as e:
            logger.warning("Не удалось уведомить %s: %s", receiver_id, e)

        await message.reply(
            f"💸 <b>Перевод выполнен</b>\n\n"
            f"👤 Получатель: <b>{_esc(receiver_nick)}</b>\n"
            f"💰 Сумма: <b>+{_fmt(amount)} UP</b>",
            parse_mode="HTML",
        )
    except Exception as e:
        logger.exception("cmd_give failed: %s", e)