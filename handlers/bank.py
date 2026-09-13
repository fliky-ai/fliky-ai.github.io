import time
import random
import logging
from aiogram import Router, types, F
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from database import db_conn, get_user, DEFAULT_NICK, check_user_registered

logger = logging.getLogger(__name__)
router = Router()

OWNER_ID = 8771009385
BANK_DAILY_LIMIT = 100000
LOAN_AMOUNT = 50000
LOAN_PERCENT = 0.20
LOAN_DAYS = 7
CARD_PREFIX = 4000
CARD_PREFIX_MAX = 4999
CARD_MIN_AGE_FOR_LOAN = 86400
CARD_MIN_OPS_FOR_LOAN = 3


class BankStates(StatesGroup):
    waiting_for_transfer_card = State()
    waiting_for_transfer_amount = State()


def _init_bank_db():
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS user_bank (
                    user_id INTEGER PRIMARY KEY,
                    card_number TEXT UNIQUE,
                    balance_bank INTEGER DEFAULT 0,
                    created_at INTEGER
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS bank_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    action_type TEXT,
                    amount INTEGER,
                    target_info TEXT,
                    card_full TEXT,
                    timestamp INTEGER
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS bank_credits (
                    user_id INTEGER PRIMARY KEY,
                    loan_amount INTEGER,
                    return_amount INTEGER,
                    percent REAL,
                    taken_at INTEGER,
                    due_at INTEGER,
                    status TEXT
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS bank_limits (
                    user_id INTEGER PRIMARY KEY,
                    transferred_today INTEGER DEFAULT 0,
                    last_reset_time INTEGER
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_bank_history_user ON bank_history(user_id, id DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_bank_limits_reset ON bank_limits(last_reset_time)")
    except Exception as e:
        logger.exception("init_bank_db failed: %s", e)


_init_bank_db()


def fmt(n) -> str:
    try:
        return f"{int(n):,}".replace(",", " ")
    except (TypeError, ValueError):
        return "0"


def get_game_username(user_id: int) -> str:
    try:
        user = get_user(user_id)
        return user.get("nickname") or DEFAULT_NICK if user else DEFAULT_NICK
    except Exception:
        return DEFAULT_NICK


def generate_card_number() -> str:
    """Уникальный номер карты, с лимитом попыток."""
    for _ in range(30):
        card = (
            f"{random.randint(CARD_PREFIX, CARD_PREFIX_MAX)} "
            f"{random.randint(1000, 9999)} "
            f"{random.randint(1000, 9999)} "
            f"{random.randint(1000, 9999)}"
        )
        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("SELECT 1 FROM user_bank WHERE card_number = ?", (card,))
                if not cur.fetchone():
                    return card
        except Exception as e:
            logger.exception("generate_card_number query failed: %s", e)
            continue
    raise RuntimeError("Не удалось сгенерировать уникальный номер карты")


def get_user_bank(user_id: int):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT card_number, balance_bank, created_at FROM user_bank WHERE user_id = ?",
                (user_id,)
            )
            row = cur.fetchone()
            if not row:
                return None
            return {"card_number": row[0], "balance_bank": row[1] or 0, "created_at": row[2] or 0}
    except Exception as e:
        logger.exception("get_user_bank failed for %s: %s", user_id, e)
        return None


def get_card_level(user_id: int):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT COUNT(*), COALESCE(SUM(amount), 0) FROM bank_history WHERE user_id = ?",
                (user_id,)
            )
            op_count, turnover = cur.fetchone()
            op_count = op_count or 0
            turnover = turnover or 0

        if op_count >= 50 or turnover >= 1_000_000:
            return "💎 Diamond", "#00F0FF"
        if op_count >= 25 or turnover >= 500_000:
            return "🥇 Gold", "#FFD700"
        if op_count >= 10 or turnover >= 100_000:
            return "🥈 Silver", "#C0C0C0"
        return "💳 Bronze", "#CD7F32"
    except Exception as e:
        logger.exception("get_card_level failed for %s: %s", user_id, e)
        return "💳 Bronze", "#CD7F32"


def add_history(user_id: int, action_type: str, amount: int, target_info: str, card_full: str):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO bank_history (user_id, action_type, amount, target_info, card_full, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (user_id, action_type, amount, target_info, card_full, int(time.time())))
            return True
    except Exception as e:
        logger.exception("add_history failed for %s: %s", user_id, e)
        return False


def check_and_get_transfer_limit(user_id: int, amount_to_transfer: int = 0):
    """
    Возвращает (allowed, remaining_or_reason).
    Атомарно: проверяет и сразу списывает лимит, если amount > 0.
    """
    try:
        now = int(time.time())
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")

            cur.execute("SELECT transferred_today, last_reset_time FROM bank_limits WHERE user_id = ?", (user_id,))
            row = cur.fetchone()

            if not row:
                cur.execute(
                    "INSERT INTO bank_limits (user_id, transferred_today, last_reset_time) VALUES (?, 0, ?)",
                    (user_id, now)
                )
                transferred, last_reset = 0, now
            else:
                transferred, last_reset = row[0] or 0, row[1] or now
                if now - last_reset >= 86400:
                    transferred, last_reset = 0, now

            remaining = BANK_DAILY_LIMIT - transferred

            if amount_to_transfer > 0:
                if amount_to_transfer > remaining:
                    return False, max(0, remaining)
                transferred += amount_to_transfer
                remaining = BANK_DAILY_LIMIT - transferred

            cur.execute(
                "UPDATE bank_limits SET transferred_today = ?, last_reset_time = ? WHERE user_id = ?",
                (transferred, last_reset, user_id)
            )
            return True, remaining
    except Exception as e:
        logger.exception("check_and_get_transfer_limit failed for %s: %s", user_id, e)
        return False, 0


# ---------- АТОМАРНЫЕ ОПЕРАЦИИ С ДЕНЬГАМИ ----------
def bank_deposit(user_id: int, amount: int) -> tuple[bool, str, int]:
    """Кошелёк → банк. Возвращает (ok, reason, new_bank_balance)."""
    if amount <= 0:
        return False, "invalid_amount", 0
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")

            cur.execute("SELECT balance_up FROM users WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row:
                return False, "user_not_found", 0
            if (row[0] or 0) < amount:
                return False, "insufficient_wallet", row[0] or 0

            cur.execute("SELECT 1 FROM user_bank WHERE user_id = ?", (user_id,))
            if not cur.fetchone():
                return False, "no_card", 0

            cur.execute("UPDATE users SET balance_up = balance_up - ? WHERE user_id = ?", (amount, user_id))
            cur.execute("UPDATE user_bank SET balance_bank = balance_bank + ? WHERE user_id = ?", (amount, user_id))
            cur.execute("SELECT balance_bank FROM user_bank WHERE user_id = ?", (user_id,))
            new_bal = cur.fetchone()[0] or 0
            return True, "ok", new_bal
    except Exception as e:
        logger.exception("bank_deposit failed for %s: %s", user_id, e)
        return False, "db_error", 0


def bank_withdraw(user_id: int, amount: int) -> tuple[bool, str, int]:
    """Банк → кошелёк. Возвращает (ok, reason, new_bank_balance)."""
    if amount <= 0:
        return False, "invalid_amount", 0
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")

            cur.execute("SELECT balance_bank FROM user_bank WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row:
                return False, "no_card", 0
            if (row[0] or 0) < amount:
                return False, "insufficient_bank", row[0] or 0

            cur.execute("UPDATE user_bank SET balance_bank = balance_bank - ? WHERE user_id = ?", (amount, user_id))
            cur.execute("UPDATE users SET balance_up = balance_up + ? WHERE user_id = ?", (amount, user_id))
            cur.execute("SELECT balance_bank FROM user_bank WHERE user_id = ?", (user_id,))
            new_bal = cur.fetchone()[0] or 0
            return True, "ok", new_bal
    except Exception as e:
        logger.exception("bank_withdraw failed for %s: %s", user_id, e)
        return False, "db_error", 0


def bank_transfer(sender_id: int, receiver_id: int, amount: int) -> tuple[bool, str]:
    """
    Атомарный перевод банк→банк + лимит + 2 записи истории, всё в одной транзакции.
    """
    if amount <= 0:
        return False, "invalid_amount"
    if sender_id == receiver_id:
        return False, "self_transfer"

    now = int(time.time())
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")

            cur.execute("SELECT card_number, balance_bank FROM user_bank WHERE user_id = ?", (sender_id,))
            srow = cur.fetchone()
            if not srow:
                return False, "no_sender_card"
            sender_card, sender_bal = srow[0], srow[1] or 0
            if sender_bal < amount:
                return False, "insufficient_bank"

            cur.execute("SELECT card_number FROM user_bank WHERE user_id = ?", (receiver_id,))
            rrow = cur.fetchone()
            if not rrow:
                return False, "no_receiver_card"
            receiver_card = rrow[0]

            # Лимит в той же транзакции
            cur.execute("SELECT transferred_today, last_reset_time FROM bank_limits WHERE user_id = ?", (sender_id,))
            lrow = cur.fetchone()
            if not lrow:
                transferred, last_reset = 0, now
                cur.execute("INSERT INTO bank_limits (user_id, transferred_today, last_reset_time) VALUES (?, 0, ?)", (sender_id, now))
            else:
                transferred, last_reset = lrow[0] or 0, lrow[1] or now
                if now - last_reset >= 86400:
                    transferred, last_reset = 0, now

            if transferred + amount > BANK_DAILY_LIMIT:
                return False, f"limit_exceeded:{BANK_DAILY_LIMIT - transferred}"

            cur.execute("UPDATE user_bank SET balance_bank = balance_bank - ? WHERE user_id = ?", (amount, sender_id))
            cur.execute("UPDATE user_bank SET balance_bank = balance_bank + ? WHERE user_id = ?", (amount, receiver_id))

            cur.execute(
                "UPDATE bank_limits SET transferred_today = ?, last_reset_time = ? WHERE user_id = ?",
                (transferred + amount, last_reset, sender_id)
            )

            sender_name = get_game_username(sender_id)
            receiver_name = get_game_username(receiver_id)

            cur.execute("""
                INSERT INTO bank_history (user_id, action_type, amount, target_info, card_full, timestamp)
                VALUES (?, 'Отправлено', ?, ?, ?, ?)
            """, (sender_id, amount, receiver_name, receiver_card, now))
            cur.execute("""
                INSERT INTO bank_history (user_id, action_type, amount, target_info, card_full, timestamp)
                VALUES (?, 'Получено', ?, ?, ?, ?)
            """, (receiver_id, amount, sender_name, sender_card, now))

            return True, "ok"
    except Exception as e:
        logger.exception("bank_transfer failed %s->%s: %s", sender_id, receiver_id, e)
        return False, "db_error"


def bank_loan_take(user_id: int) -> tuple[bool, str]:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")

            cur.execute("SELECT status FROM bank_credits WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if row and row[0] == "active":
                return False, "already_active"

            cur.execute("SELECT 1 FROM user_bank WHERE user_id = ?", (user_id,))
            if not cur.fetchone():
                return False, "no_card"

            now = int(time.time())
            return_amt = int(LOAN_AMOUNT * (1 + LOAN_PERCENT))
            due_at = now + LOAN_DAYS * 86400

            cur.execute("""
                INSERT OR REPLACE INTO bank_credits
                (user_id, loan_amount, return_amount, percent, taken_at, due_at, status)
                VALUES (?, ?, ?, ?, ?, ?, 'active')
            """, (user_id, LOAN_AMOUNT, return_amt, LOAN_PERCENT, now, due_at))

            cur.execute("UPDATE user_bank SET balance_bank = balance_bank + ? WHERE user_id = ?", (LOAN_AMOUNT, user_id))
            return True, "ok"
    except Exception as e:
        logger.exception("bank_loan_take failed for %s: %s", user_id, e)
        return False, "db_error"


def bank_loan_pay(user_id: int) -> tuple[bool, str, int]:
    """Возвращает (ok, reason, return_amount)."""
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")

            cur.execute("SELECT return_amount FROM bank_credits WHERE user_id = ? AND status = 'active'", (user_id,))
            row = cur.fetchone()
            if not row:
                return False, "no_active_loan", 0
            return_amt = row[0] or 0

            cur.execute("SELECT balance_bank FROM user_bank WHERE user_id = ?", (user_id,))
            brow = cur.fetchone()
            if not brow:
                return False, "no_card", return_amt
            if (brow[0] or 0) < return_amt:
                return False, "insufficient_bank", return_amt

            cur.execute("UPDATE user_bank SET balance_bank = balance_bank - ? WHERE user_id = ?", (return_amt, user_id))
            cur.execute("DELETE FROM bank_credits WHERE user_id = ?", (user_id,))
            return True, "ok", return_amt
    except Exception as e:
        logger.exception("bank_loan_pay failed for %s: %s", user_id, e)
        return False, "db_error", 0


async def _safe_edit(target, text: str, kb=None):
    """edit_text с fallback на answer."""
    try:
        if hasattr(target, "message") and target.message:
            await target.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        else:
            await target.answer(text, parse_mode="HTML", reply_markup=kb)
    except Exception:
        try:
            if hasattr(target, "message") and target.message:
                await target.message.answer(text, parse_mode="HTML", reply_markup=kb)
            else:
                await target.answer(text, parse_mode="HTML", reply_markup=kb)
        except Exception as e:
            logger.warning("_safe_edit failed: %s", e)
async def render_bank_menu(message_or_callback, user_id: int, edit: bool = False):
    try:
        bank = get_user_bank(user_id)
        game_name = get_game_username(user_id)

        wallet_balance = 0
        try:
            user = get_user(user_id)
            wallet_balance = int((user or {}).get("balance_up") or 0)
        except Exception as e:
            logger.exception("render_bank_menu wallet fetch failed: %s", e)

        if not bank:
            text = (
                "🏦 <b>Банк Апгрейд</b>\n\n"
                "👋 Добро пожаловать в игровой банк!\n\n"
                "У вас ещё нет банковской карты.\n\n"
                "💳 Откройте свою первую карту, чтобы:\n"
                "• хранить UP\n"
                "• отправлять переводы\n"
                "• получать деньги\n"
                "• пользоваться кредитами"
            )
            kb = types.InlineKeyboardMarkup(
                inline_keyboard=[[types.InlineKeyboardButton(text="💳 Открыть банковскую карту", callback_data="bank_open")]]
            )
        else:
            last4 = (bank["card_number"] or "----")[-4:]
            card_lvl, _ = get_card_level(user_id)

            text = (
                "🏦 <b>Банк Апгрейд</b>\n\n"
                f"💳 <b>Уровень карты:</b> {card_lvl}\n"
                f"💳 <b>Номер:</b> •••• {last4}\n"
                f"👤 <b>Владелец:</b> {game_name}\n\n"
                "💰 <b>Средства:</b>\n"
                f"🏦 Банк: <b>{fmt(bank['balance_bank'])} UP</b>\n"
                f"💎 Наличные: <b>{fmt(wallet_balance)} UP</b>"
            )
            kb = types.InlineKeyboardMarkup(
                inline_keyboard=[
                    [types.InlineKeyboardButton(text="💰 Пополнить", callback_data="bank_deposit_menu"),
                     types.InlineKeyboardButton(text="💸 Снять", callback_data="bank_withdraw_menu")],
                    [types.InlineKeyboardButton(text="🔄 Перевод", callback_data="bank_transfer_menu"),
                     types.InlineKeyboardButton(text="💳 Кредит", callback_data="bank_loan_menu")],
                    [types.InlineKeyboardButton(text="📊 Статистика", callback_data="bank_stats"),
                     types.InlineKeyboardButton(text="📜 История", callback_data="bank_history")],
                    [types.InlineKeyboardButton(text="💳 Моя карта", callback_data="bank_my_card"),
                     types.InlineKeyboardButton(text="🔙 Назад", callback_data="main_menu")]
                ]
            )

        if edit:
            await _safe_edit(message_or_callback, text, kb)
        else:
            await message_or_callback.answer(text, parse_mode="HTML", reply_markup=kb)

    except Exception as e:
        logger.exception("render_bank_menu failed for %s: %s", user_id, e)
        try:
            if edit:
                await _safe_edit(message_or_callback, "⚠️ Ошибка загрузки банка. Попробуйте позже.")
            else:
                await message_or_callback.answer("⚠️ Ошибка загрузки банка. Попробуйте позже.")
        except Exception:
            pass


@router.message(F.text.casefold().in_({"банк", "upgrade bank", "🏦 банк"}))
async def cmd_bank(message: types.Message):
    try:
        user_id = message.from_user.id if message.from_user else None
        if not user_id:
            return

        if not check_user_registered(user_id):
            if message.chat.type != "private":
                return
            await message.answer(
                "❌ <b>Вы еще не зарегистрированы!</b>\n\n"
                "💡 Пожалуйста, перейдите в <b>личные сообщения</b> бота и нажмите /start, чтобы активировать игровой профиль!",
                parse_mode="HTML"
            )
            return

        await render_bank_menu(message, user_id, edit=False)
    except Exception as e:
        logger.exception("cmd_bank failed: %s", e)


@router.callback_query(F.data == "bank_main_back")
async def cb_bank_back(callback: types.CallbackQuery, state: FSMContext):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return
        try:
            await state.clear()
        except Exception:
            pass
        await render_bank_menu(callback, user_id, edit=True)
    except Exception as e:
        logger.exception("cb_bank_back failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data == "bank_open")
async def cb_bank_open(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        if get_user_bank(user_id):
            await callback.answer("❌ У вас уже есть счёт!", show_alert=True)
            await render_bank_menu(callback, user_id, edit=True)
            return

        try:
            card = generate_card_number()
        except Exception as e:
            logger.exception("card generation failed: %s", e)
            await callback.answer("⚠️ Не удалось создать карту. Попробуйте позже.", show_alert=True)
            return

        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute(
                    "INSERT INTO user_bank (user_id, card_number, balance_bank, created_at) VALUES (?, ?, 0, ?)",
                    (user_id, card, int(time.time()))
                )
        except sqlite3.IntegrityError:
            await callback.answer("❌ У вас уже есть счёт!", show_alert=True)
            return
        except Exception as e:
            logger.exception("bank_open insert failed: %s", e)
            await callback.answer("⚠️ Ошибка создания карты. Попробуйте позже.", show_alert=True)
            return

        add_history(user_id, "Открытие", 0, "Банк Апгрейд", card)

        text = (
            "🏦 <b>Банк Апгрейд</b>\n\n"
            "✅ Счёт успешно открыт!\n\n"
            "💳 <b>Ваша карта:</b>\n"
            f"<code>{card}</code>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="📋 Скопировать карту", callback_data=f"bank_copy_{card}")],
                [types.InlineKeyboardButton(text="🏦 В личный кабинет", callback_data="bank_main_back")]
            ]
        )
        await _safe_edit(callback, text, kb)
        await callback.answer("Счёт успешно открыт!")
    except Exception as e:
        logger.exception("cb_bank_open failed: %s", e)
        try:
            await callback.answer("⚠️ Ошибка", show_alert=True)
        except Exception:
            pass


@router.callback_query(F.data.startswith("bank_copy_"))
async def cb_bank_copy(callback: types.CallbackQuery):
    try:
        card_num = (callback.data or "").replace("bank_copy_", "")
        await callback.answer(f"📋 Номер скопирован:\n{card_num}", show_alert=True)
    except Exception as e:
        logger.exception("cb_bank_copy failed: %s", e)
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data == "bank_my_card")
async def cb_bank_my_card(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        bank = get_user_bank(user_id)
        if not bank:
            await render_bank_menu(callback, user_id, edit=True)
            return

        card_lvl, _ = get_card_level(user_id)
        text = (
            "🏦 <b>Банк Апгрейд</b>\n\n"
            f"💳 <b>Личная карта ({card_lvl})</b>\n\n"
            f"<code>{bank['card_number']}</code>\n\n"
            "<i>Используйте номер для переводов и пополнений.</i>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="📋 Скопировать карту", callback_data=f"bank_copy_{bank['card_number']}")],
                [types.InlineKeyboardButton(text="🔙 Назад", callback_data="bank_main_back")]
            ]
        )
        await _safe_edit(callback, text, kb)
    except Exception as e:
        logger.exception("cb_bank_my_card failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data == "bank_deposit_menu")
async def cb_bank_deposit_menu(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="10 000 UP", callback_data="bank_dep_amt_10000"),
                 types.InlineKeyboardButton(text="50 000 UP", callback_data="bank_dep_amt_50000")],
                [types.InlineKeyboardButton(text="100 000 UP", callback_data="bank_dep_amt_100000"),
                 types.InlineKeyboardButton(text="🎛 Вся сумма", callback_data="bank_dep_amt_all")],
                [types.InlineKeyboardButton(text="🔙 Назад", callback_data="bank_main_back")]
            ]
        )
        text = (
            "🏦 <b>Банк Апгрейд</b>\n\n"
            "💰 <b>Пополнение счёта</b>\n\n"
            "Выберите сумму перевода с кошелька на счёт:"
        )
        await _safe_edit(callback, text, kb)
    except Exception as e:
        logger.exception("cb_bank_deposit_menu failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data.startswith("bank_dep_amt_"))
async def cb_bank_dep_amt(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        val = (callback.data or "").replace("bank_dep_amt_", "")

        user = get_user(user_id)
        wallet = int((user or {}).get("balance_up") or 0)

        if val == "all":
            amount = wallet
        else:
            try:
                amount = int(val)
            except (TypeError, ValueError):
                await callback.answer("❌ Некорректная сумма", show_alert=True)
                return

        if amount <= 0:
            await callback.answer("❌ Нечего пополнять", show_alert=True)
            return
        if wallet < amount:
            await callback.answer(f"❌ Недостаточно средств! На руках: {fmt(wallet)} UP", show_alert=True)
            return

        ok, reason, new_bal = bank_deposit(user_id, amount)
        if not ok:
            msg = {
                "invalid_amount": "❌ Некорректная сумма",
                "user_not_found": "❌ Пользователь не найден",
                "no_card": "❌ Сначала откройте карту",
                "insufficient_wallet": "❌ Недостаточно средств",
                "db_error": "⚠️ Ошибка БД. Попробуйте позже",
            }.get(reason, "⚠️ Ошибка")
            await callback.answer(msg, show_alert=True)
            return

        bank = get_user_bank(user_id)
        if bank:
            add_history(user_id, "Пополнение", amount, "Кошелек", bank["card_number"])

        text = (
            "🏦 <b>Банк Апгрейд</b>\n\n"
            "✅ Успешно пополнено!\n\n"
            f"💰 Сумма: <b>+{fmt(amount)} UP</b>\n"
            f"🏦 Баланс банка: <b>{fmt(new_bal)} UP</b>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="🔙 Назад в банк", callback_data="bank_main_back")]]
        )
        await _safe_edit(callback, text, kb)
        await callback.answer("Пополнено!")
    except Exception as e:
        logger.exception("cb_bank_dep_amt failed: %s", e)
        try:
            await callback.answer("⚠️ Ошибка", show_alert=True)
        except Exception:
            pass


@router.callback_query(F.data == "bank_withdraw_menu")
async def cb_bank_withdraw_menu(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        bank = get_user_bank(user_id)
        if not bank or (bank["balance_bank"] or 0) <= 0:
            await callback.answer("❌ На счёте нет средств!", show_alert=True)
            return

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="10 000 UP", callback_data="bank_wit_amt_10000"),
                 types.InlineKeyboardButton(text="50 000 UP", callback_data="bank_wit_amt_50000")],
                [types.InlineKeyboardButton(text="100 000 UP", callback_data="bank_wit_amt_100000"),
                 types.InlineKeyboardButton(text="🎛 Всё со счёта", callback_data="bank_wit_amt_all")],
                [types.InlineKeyboardButton(text="🔙 Назад", callback_data="bank_main_back")]
            ]
        )
        text = (
            "🏦 <b>Банк Апгрейд</b>\n\n"
            "💸 <b>Снятие средств</b>\n\n"
            "Выберите сумму для вывода на руки:"
        )
        await _safe_edit(callback, text, kb)
    except Exception as e:
        logger.exception("cb_bank_withdraw_menu failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data.startswith("bank_wit_amt_"))
async def cb_bank_wit_amt(callback: types.CallbackQuery, state: FSMContext):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        val = (callback.data or "").replace("bank_wit_amt_", "")
        bank = get_user_bank(user_id)
        if not bank:
            await callback.answer("❌ Счёт не найден", show_alert=True)
            return

        if val == "all":
            amount = bank["balance_bank"] or 0
        else:
            try:
                amount = int(val)
            except (TypeError, ValueError):
                await callback.answer("❌ Некорректная сумма", show_alert=True)
                return

        if amount <= 0:
            await callback.answer("❌ Нечего снимать", show_alert=True)
            return
        if (bank["balance_bank"] or 0) < amount:
            await callback.answer("❌ Недостаточно средств на счёте!", show_alert=True)
            return

        ok, reason, new_bal = bank_withdraw(user_id, amount)
        if not ok:
            msg = {
                "invalid_amount": "❌ Некорректная сумма",
                "no_card": "❌ Счёт не найден",
                "insufficient_bank": "❌ Недостаточно средств на счёте",
                "db_error": "⚠️ Ошибка БД. Попробуйте позже",
            }.get(reason, "⚠️ Ошибка")
            await callback.answer(msg, show_alert=True)
            return

        add_history(user_id, "Снятие", amount, "На руки", bank["card_number"])

        text = (
            "🏦 <b>Банк Апгрейд</b>\n\n"
            "✅ Успешно снято!\n\n"
            f"💎 Получено: <b>+{fmt(amount)} UP</b>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="🔙 Назад в банк", callback_data="bank_main_back")]]
        )
        await _safe_edit(callback, text, kb)
        await callback.answer("Успешно!")
    except Exception as e:
        logger.exception("cb_bank_wit_amt failed: %s", e)
        try:
            await callback.answer("⚠️ Ошибка", show_alert=True)
        except Exception:
            pass


@router.callback_query(F.data == "bank_stats")
async def cb_bank_stats(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        bank = get_user_bank(user_id)
        if not bank:
            await callback.answer("❌ Счёт не открыт", show_alert=True)
            return

        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT COUNT(*), COALESCE(SUM(amount), 0) FROM bank_history "
                "WHERE user_id = ? AND action_type = 'Отправлено'",
                (user_id,)
            )
            sent_count, sent_sum = cur.fetchone()
            cur.execute(
                "SELECT COUNT(*), COALESCE(SUM(amount), 0) FROM bank_history "
                "WHERE user_id = ? AND action_type = 'Получено'",
                (user_id,)
            )
            recv_count, recv_sum = cur.fetchone()
            cur.execute("SELECT COUNT(*) FROM bank_history WHERE user_id = ?", (user_id,))
            total_ops = cur.fetchone()[0] or 0

        sent_count = sent_count or 0
        recv_count = recv_count or 0
        sent_sum = sent_sum or 0
        recv_sum = recv_sum or 0

        try:
            open_date = time.strftime("%d.%m.%Y", time.localtime(int(bank["created_at"])))
        except Exception:
            open_date = "—"

        text = (
            "🏦 <b>Банк Апгрейд</b>\n\n"
            "📊 <b>Статистика счета</b>\n\n"
            f"Всего переводов: <b>{sent_count + recv_count}</b>\n\n"
            f"Отправлено: <b>{fmt(sent_sum)} UP</b>\n\n"
            f"Получено: <b>{fmt(recv_sum)} UP</b>\n\n"
            f"Операций: <b>{total_ops}</b>\n\n"
            f"Дата открытия карты:\n<b>{open_date}</b>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="🔙 Назад", callback_data="bank_main_back")]]
        )
        await _safe_edit(callback, text, kb)
    except Exception as e:
        logger.exception("cb_bank_stats failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data == "bank_history")
async def cb_bank_history(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT action_type, amount, target_info, card_full, timestamp "
                "FROM bank_history WHERE user_id = ? ORDER BY id DESC LIMIT 5",
                (user_id,)
            )
            rows = cur.fetchall() or []

        hist_lines = []
        for r in rows:
            try:
                action_type, amount, target_info, card_full, ts = r
                amount = amount or 0
                date_str = time.strftime("%d.%m.%Y %H:%M", time.localtime(int(ts or time.time())))

                if action_type in ("Получено", "Пополнение", "Кредит"):
                    icon, sign, party_label = "📥", "+", "Отправитель"
                elif action_type == "Отправлено":
                    icon, sign, party_label = "📤", "-", "Получатель"
                else:
                    icon, sign, party_label = "💳", "", "Инфо"

                amount_str = f"{sign}{fmt(amount)} UP" if amount > 0 else "0 UP"
                target_info = target_info or "—"

                if action_type in ("Получено", "Отправлено"):
                    hist_lines.append(
                        f"{icon} <b>{action_type}:</b>\n"
                        f"Сумма: {amount_str}\n"
                        f"{party_label}: {target_info}\n"
                        f"Карта: <code>{card_full or '----'}</code>\n"
                        f"<i>{date_str}</i>\n"
                    )
                else:
                    last4 = card_full[-4:] if card_full else "----"
                    hist_lines.append(
                        f"{icon} <b>{action_type}</b>\n"
                        f"Сумма: {amount_str}\n"
                        f"Инфо: {target_info}\n"
                        f"Карта: •••• {last4}\n"
                        f"<i>{date_str}</i>\n"
                    )
            except Exception as e:
                logger.warning("History row render failed: %s", e)
                continue

        hist_text = "\n".join(hist_lines) if hist_lines else "История операций пока пуста."

        text = (
            "🏦 <b>Банк Апгрейд</b>\n\n"
            "📜 <b>История операций</b>\n\n"
            f"{hist_text}"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="🔙 Назад", callback_data="bank_main_back")]]
        )
        await _safe_edit(callback, text, kb)
    except Exception as e:
        logger.exception("cb_bank_history failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass
@router.callback_query(F.data == "bank_transfer_menu")
async def cb_bank_transfer_menu(callback: types.CallbackQuery, state: FSMContext):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        bank = get_user_bank(user_id)
        if not bank:
            await callback.answer("❌ Сначала откройте карту!", show_alert=True)
            return

        allowed, remaining = check_and_get_transfer_limit(user_id, 0)
        if not allowed:
            await callback.answer("⚠️ Ошибка проверки лимита", show_alert=True)
            return

        await state.set_state(BankStates.waiting_for_transfer_card)
        await state.update_data(bank_menu_chat_id=callback.message.chat.id)

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="❌ Отмена", callback_data="bank_main_back")]]
        )
        text = (
            "🏦 <b>Банк Апгрейд</b>\n\n"
            "💳 <b>Введите номер карты</b>\n\n"
            f"💡 Суточный лимит: <b>{fmt(remaining)} / {fmt(BANK_DAILY_LIMIT)} UP</b>\n\n"
            "Введите номер карты получателя в чат:\n\n"
            "<i>Пример:</i>\n<code>4829 6157 2038 9471</code>"
        )
        await _safe_edit(callback, text, kb)
    except Exception as e:
        logger.exception("cb_bank_transfer_menu failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.message(BankStates.waiting_for_transfer_card)
async def process_transfer_card(message: types.Message, state: FSMContext):
    try:
        user_id = message.from_user.id if message.from_user else None
        if not user_id:
            await state.clear()
            return

        if not check_user_registered(user_id):
            await state.clear()
            if message.chat.type == "private":
                await message.answer(
                    "❌ <b>Вы еще не зарегистрированы!</b>\n\n"
                    "💡 Пожалуйста, перейдите в <b>личные сообщения</b> бота и нажмите /start.",
                    parse_mode="HTML"
                )
            return

        raw = (message.text or "").strip()
        if not raw or len(raw) > 40:
            await message.answer("❌ Некорректный номер карты. Попробуйте снова или нажмите «Отмена».")
            return

        # Нормализация: убираем лишние пробелы
        target_card = " ".join(raw.split())

        sender_bank = get_user_bank(user_id)
        if not sender_bank:
            await state.clear()
            await message.answer("❌ У вас нет карты. Откройте её в банке.")
            return

        if sender_bank["card_number"] == target_card:
            await message.answer("❌ Нельзя переводить средства на собственную карту!")
            return

        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("SELECT user_id, card_number FROM user_bank WHERE card_number = ?", (target_card,))
                res = cur.fetchone()
        except Exception as e:
            logger.exception("transfer_card lookup failed: %s", e)
            await message.answer("⚠️ Ошибка БД. Попробуйте позже.")
            return

        if not res:
            await message.answer("❌ Карта не найдена в Банке Апгрейд!\nПожалуйста, проверьте правильность номера.")
            return

        target_id, target_card_full = res
        if target_id == user_id:
            await message.answer("❌ Нельзя переводить самому себе!")
            return

        target_name = get_game_username(target_id)

        await state.update_data(
            transfer_target_id=target_id,
            transfer_target_card=target_card_full,
            target_name=target_name,
        )
        await state.set_state(BankStates.waiting_for_transfer_amount)

        allowed, remaining = check_and_get_transfer_limit(user_id, 0)
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="❌ Отмена", callback_data="bank_main_back")]]
        )
        await message.answer(
            "🏦 <b>Банк Апгрейд</b>\n\n"
            "🔄 <b>Сумма перевода</b>\n\n"
            f"👤 Получатель: <b>{target_name}</b>\n"
            f"💳 Карта: <code>{target_card_full}</code>\n\n"
            f"💡 Доступно лимита: <b>{fmt(remaining)} UP</b>\n\n"
            "Введите сумму перевода в чат:",
            parse_mode="HTML", reply_markup=kb
        )
    except Exception as e:
        logger.exception("process_transfer_card failed: %s", e)
        try:
            await state.clear()
            await message.answer("⚠️ Ошибка. Попробуйте снова.")
        except Exception:
            pass


@router.message(BankStates.waiting_for_transfer_amount)
async def process_transfer_amount(message: types.Message, state: FSMContext):
    try:
        user_id = message.from_user.id if message.from_user else None
        if not user_id:
            await state.clear()
            return

        if not check_user_registered(user_id):
            await state.clear()
            if message.chat.type == "private":
                await message.answer(
                    "❌ <b>Вы еще не зарегистрированы!</b>\n\n"
                    "💡 Пожалуйста, перейдите в <b>личные сообщения</b> бота и нажмите /start.",
                    parse_mode="HTML"
                )
            return

        raw = (message.text or "").strip().replace(" ", "")
        if not raw.isdigit():
            await message.answer("❌ Введите корректное число!")
            return

        amount = int(raw)

        if amount <= 0:
            await message.answer("❌ Сумма должна быть больше 0!")
            return

        if amount > 1_000_000_000:
            await message.answer("❌ Слишком большая сумма!")
            return

        data = await state.get_data()
        target_id = data.get("transfer_target_id")
        target_card = data.get("transfer_target_card")
        target_name = data.get("target_name")

        if not target_id or not target_card:
            await state.clear()
            await message.answer("❌ Сессия перевода истекла. Начните заново.")
            return

        if target_id == user_id:
            await state.clear()
            await message.answer("❌ Нельзя переводить самому себе!")
            return

        # Атомарный перевод: баланс + лимит + история в одной транзакции
        ok, reason = bank_transfer(user_id, target_id, amount)
        if not ok:
            if reason.startswith("limit_exceeded:"):
                remaining = reason.split(":", 1)[1]
                await message.answer(
                    f"❌ Превышен суточный лимит!\n"
                    f"Вы можете отправить максимум: <b>{fmt(remaining)} UP</b>",
                    parse_mode="HTML"
                )
                return
            msg = {
                "invalid_amount": "❌ Некорректная сумма",
                "self_transfer": "❌ Нельзя переводить себе",
                "no_sender_card": "❌ У вас нет карты",
                "no_receiver_card": "❌ У получателя нет карты",
                "insufficient_bank": "❌ Недостаточно средств на счёте",
                "db_error": "⚠️ Ошибка транзакции. Попробуйте позже",
            }.get(reason, "⚠️ Ошибка перевода")
            await message.answer(msg)
            return

        await state.clear()

        sender_name = get_game_username(user_id)
        sender_bank = get_user_bank(user_id)
        sender_card = sender_bank["card_number"] if sender_bank else "—"
        current_date = time.strftime("%d.%m.%Y %H:%M", time.localtime(time.time()))

        # Уведомление получателю
        try:
            await message.bot.send_message(
                target_id,
                "🏦 <b>Банк Апгрейд</b>\n\n"
                "📥 <b>Вам поступил перевод!</b>\n\n"
                f"💰 Сумма:\n<b>+{fmt(amount)} UP</b>\n\n"
                f"👤 Отправитель:\n{sender_name}\n\n"
                f"💳 Карта отправителя:\n<code>{sender_card}</code>\n\n"
                f"📅 Дата:\n{current_date}",
                parse_mode="HTML"
            )
        except Exception as e:
            logger.warning("Не удалось уведомить %s: %s", target_id, e)

        text = (
            "🏦 <b>Банк Апгрейд</b>\n\n"
            "📤 <b>Перевод выполнен!</b>\n\n"
            f"💰 Сумма:\n<b>-{fmt(amount)} UP</b>\n\n"
            f"👤 Получатель:\n{target_name}\n\n"
            f"💳 Карта получателя:\n<code>{target_card}</code>\n\n"
            f"📅 Дата:\n{current_date}"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="🔙 Назад в банк", callback_data="bank_main_back")]]
        )
        await message.answer(text, parse_mode="HTML", reply_markup=kb)
    except Exception as e:
        logger.exception("process_transfer_amount failed: %s", e)
        try:
            await state.clear()
            await message.answer("⚠️ Ошибка. Попробуйте снова.")
        except Exception:
            pass


@router.callback_query(F.data == "bank_loan_menu")
async def cb_bank_loan_menu(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        bank = get_user_bank(user_id)
        if not bank:
            await callback.answer("❌ Счёт не открыт!", show_alert=True)
            return

        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT loan_amount, return_amount, percent, due_at, status "
                "FROM bank_credits WHERE user_id = ?",
                (user_id,)
            )
            loan = cur.fetchone()

        if loan and loan[4] == "active":
            try:
                due_date = time.strftime("%d.%m.%Y %H:%M", time.localtime(int(loan[3])))
            except Exception:
                due_date = "—"
            now = int(time.time())
            try:
                overdue = now > int(loan[3])
            except Exception:
                overdue = False

            header = "🏦 <b>Банк Апгрейд</b>\n\n💳 <b>Активный кредит</b>"
            if overdue:
                header += " ⚠️ <b>ПРОСРОЧЕН</b>"

            text = (
                f"{header}\n\n"
                f"💰 Сумма: <b>{fmt(loan[0])} UP</b>\n"
                f"📈 Вернуть: <b>{fmt(loan[1])} UP</b>\n"
                f"⏳ Срок до: <b>{due_date}</b>"
            )
            kb = types.InlineKeyboardMarkup(
                inline_keyboard=[
                    [types.InlineKeyboardButton(text="✅ Погасить кредит", callback_data="bank_loan_pay")],
                    [types.InlineKeyboardButton(text="🔙 Назад", callback_data="bank_main_back")]
                ]
            )
            await _safe_edit(callback, text, kb)
            return

        # Кредит ещё не взят — проверяем условия
        try:
            account_age = int(time.time()) - int(bank["created_at"] or 0)
        except Exception:
            account_age = 0
        if account_age < CARD_MIN_AGE_FOR_LOAN:
            hours_left = max(0, (CARD_MIN_AGE_FOR_LOAN - account_age) // 3600)
            await callback.answer(
                f"❌ Карта слишком новая для кредита. Попробуйте через ~{hours_left}ч.",
                show_alert=True
            )
            return

        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM bank_history WHERE user_id = ?", (user_id,))
            history_count = cur.fetchone()[0] or 0

        if history_count < CARD_MIN_OPS_FOR_LOAN:
            await callback.answer(
                f"❌ Нужно минимум {CARD_MIN_OPS_FOR_LOAN} операций для кредита (у вас {history_count}).",
                show_alert=True
            )
            return

        return_amt = int(LOAN_AMOUNT * (1 + LOAN_PERCENT))
        text = (
            "🏦 <b>Банк Апгрейд</b>\n\n"
            "💳 <b>Кредит банка</b>\n\n"
            f"Доступно:\n<b>{fmt(LOAN_AMOUNT)} UP</b>\n\n"
            f"Вернуть:\n<b>{fmt(return_amt)} UP</b>\n\n"
            f"Процент:\n<b>{int(LOAN_PERCENT * 100)}%</b>\n\n"
            f"Срок:\n<b>{LOAN_DAYS} дней</b>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="✅ Взять кредит", callback_data="bank_loan_take")],
                [types.InlineKeyboardButton(text="🔙 Назад", callback_data="bank_main_back")]
            ]
        )
        await _safe_edit(callback, text, kb)
    except Exception as e:
        logger.exception("cb_bank_loan_menu failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data == "bank_loan_take")
async def cb_bank_loan_take(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        bank = get_user_bank(user_id)
        if not bank:
            await callback.answer("❌ Счёт не найден", show_alert=True)
            return

        ok, reason = bank_loan_take(user_id)
        if not ok:
            msg = {
                "already_active": "❌ У вас уже есть активный кредит!",
                "no_card": "❌ Счёт не найден",
                "db_error": "⚠️ Ошибка БД. Попробуйте позже",
            }.get(reason, "⚠️ Ошибка выдачи кредита")
            await callback.answer(msg, show_alert=True)
            return

        add_history(user_id, "Кредит", LOAN_AMOUNT, "Банк Апгрейд", bank["card_number"])

        await callback.answer(f"✅ Кредит {fmt(LOAN_AMOUNT)} UP зачислен на счёт!", show_alert=True)
        await render_bank_menu(callback, user_id, edit=True)
    except Exception as e:
        logger.exception("cb_bank_loan_take failed: %s", e)
        try:
            await callback.answer("⚠️ Ошибка", show_alert=True)
        except Exception:
            pass


@router.callback_query(F.data == "bank_loan_pay")
async def cb_bank_loan_pay(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        ok, reason, return_amt = bank_loan_pay(user_id)
        if not ok:
            if reason == "insufficient_bank":
                await callback.answer(
                    f"❌ Недостаточно средств на счёте! Нужно: {fmt(return_amt)} UP",
                    show_alert=True
                )
            elif reason == "no_active_loan":
                await callback.answer("❌ Активных кредитов не найдено", show_alert=True)
            elif reason == "no_card":
                await callback.answer("❌ Счёт не найден", show_alert=True)
            else:
                await callback.answer("⚠️ Ошибка БД. Попробуйте позже", show_alert=True)
            return

        bank = get_user_bank(user_id)
        if bank:
            add_history(user_id, "Погашение", return_amt, "Банк Апгрейд", bank["card_number"])

        await callback.answer(f"✅ Кредит на {fmt(return_amt)} UP погашен!", show_alert=True)
        await render_bank_menu(callback, user_id, edit=True)
    except Exception as e:
        logger.exception("cb_bank_loan_pay failed: %s", e)
        try:
            await callback.answer("⚠️ Ошибка", show_alert=True)
        except Exception:
            pass