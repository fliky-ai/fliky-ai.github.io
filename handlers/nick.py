import time
import re
import logging
from aiogram import Router, types, F
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

from database import db_conn, check_user_registered, get_user, DEFAULT_NICK, log_action

logger = logging.getLogger(__name__)
router = Router()

NICK_MIN = 2
NICK_MAX = 20


# ================== FSM ==================
class NicknameStates(StatesGroup):
    waiting_for_new_nickname = State()
    confirm_nickname_change = State()


# ================== БД ==================
def _init_nick_db():
    """Создаём только nickname_history. Миграцию users делает database.init_db."""
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS nickname_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    old_nickname TEXT,
                    new_nickname TEXT,
                    change_date INTEGER
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_nick_hist_user ON nickname_history(user_id, id DESC)")
        logger.info("nick: таблицы готовы")
    except Exception as e:
        logger.exception("init_nick_db failed: %s", e)


_init_nick_db()


# ================== УТИЛИТЫ ==================
def _esc(s) -> str:
    return (str(s) if s is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


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


def _nick_log(user_id: int, user, action: str, **kwargs):
    try:
        log_action(
            user_id=user_id,
            username=getattr(user, "username", None),
            display_name=getattr(user, "full_name", None),
            action_type="NICKNAME",
            extra=action,
            **kwargs,
        )
    except Exception:
        pass


def _validate_nick(raw: str):
    """Возвращает (ok, normalized, error_msg)."""
    if not raw:
        return False, "", "⚠️ Введите ник."

    n = raw.strip()
    n = re.sub(r"\s+", " ", n)

    if len(n) < NICK_MIN or len(n) > NICK_MAX:
        return False, "", f"⚠️ Ник: от {NICK_MIN} до {NICK_MAX} символов."

    if not re.match(r"^[A-Za-zА-Яа-яЁё0-9_ ]+$", n):
        return False, "", "⚠️ Только буквы, цифры, <code>_</code> и пробел."

    return True, n, ""


def _get_nick_state(user_id: int):
    """Возвращает (nickname, changes_left) или (None, None)."""
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            # проверим, есть ли колонка nickname_changes
            cur.execute("PRAGMA table_info(users)")
            cols = {c[1] for c in cur.fetchall()}
            if "nickname_changes" in cols:
                cur.execute(
                    "SELECT nickname, COALESCE(nickname_changes, 1) FROM users WHERE user_id = ?",
                    (user_id,)
                )
            else:
                cur.execute("SELECT nickname FROM users WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row:
                return None, None
            nick = row[0] if row[0] else DEFAULT_NICK
            changes = int(row[1] or 0) if len(row) > 1 else 1
            return nick, changes
    except Exception as e:
        logger.exception("_get_nick_state failed: %s", e)
        return None, None


# ================== КЛАВИАТУРЫ ==================
def _nick_menu_kb(can_change: bool) -> types.InlineKeyboardMarkup:
    rows = []
    if can_change:
        rows.append([types.InlineKeyboardButton(text="✏️ Сменить ник", callback_data="change_nick")])
    rows.append([types.InlineKeyboardButton(text="📜 История", callback_data="nick_history")])
    return types.InlineKeyboardMarkup(inline_keyboard=rows)


def _nick_menu_text(nickname: str, changes_left: int) -> str:
    return (
        "👑 <b>Ник</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        f"👤 Текущий: <b>{_esc(nickname)}</b>\n"
        f"🔄 Осталось смен: <b>{changes_left}</b>"
    )


async def _show_nick_menu(target, user_id: int, edit: bool = False):
    try:
        nick, changes = _get_nick_state(user_id)
        if nick is None:
            return

        text = _nick_menu_text(nick, changes)
        kb = _nick_menu_kb(can_change=(changes > 0))

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
        logger.exception("_show_nick_menu failed: %s", e)


# ================== КОМАНДА ==================
@router.message(F.text.casefold().in_({"ник", "nickname", "/nickname", "👤 ник"}))
async def cmd_nickname(message: types.Message):
    try:
        if not await _require_reg(message):
            return
        uid = message.from_user.id
        _nick_log(uid, message.from_user, "open_nick")
        await _show_nick_menu(message, uid)
    except Exception as e:
        logger.exception("cmd_nickname failed: %s", e)


# ================== СМЕНА ==================
@router.callback_query(F.data == "change_nick")
async def cb_change_nick(callback: types.CallbackQuery, state: FSMContext):
    try:
        try:
            await callback.answer()
        except Exception:
            pass

        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        nick, changes = _get_nick_state(uid)
        if nick is None:
            return
        if changes <= 0:
            try:
                await callback.answer("Больше нет бесплатных смен", show_alert=True)
            except Exception:
                pass
            return

        await state.set_state(NicknameStates.waiting_for_new_nickname)
        text = (
            "✏️ <b>Смена ника</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"Введите новый ник:\n"
            f"<i>От {NICK_MIN} до {NICK_MAX} символов</i>\n"
            f"<i>Буквы, цифры, _ и пробел</i>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="❌ Отмена", callback_data="cancel_nick")]]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            try:
                await callback.message.answer(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                pass
    except Exception as e:
        logger.exception("cb_change_nick failed: %s", e)


@router.callback_query(F.data == "cancel_nick")
async def cb_cancel_nick(callback: types.CallbackQuery, state: FSMContext):
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
        await _show_nick_menu(callback, uid, edit=True)
    except Exception as e:
        logger.exception("cb_cancel_nick failed: %s", e)


@router.message(NicknameStates.waiting_for_new_nickname)
async def process_new_nickname(message: types.Message, state: FSMContext):
    try:
        if not await _require_reg(message):
            await state.clear()
            return

        uid = message.from_user.id
        ok, new_nick, err = _validate_nick(message.text or "")
        if not ok:
            await message.answer(err, parse_mode="HTML")
            return

        await state.update_data(new_nickname=new_nick)
        await state.set_state(NicknameStates.confirm_nickname_change)

        nick, changes = _get_nick_state(uid)
        if nick is None:
            await state.clear()
            return

        text = (
            "❓ <b>Подтверждение</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"С <b>{_esc(nick)}</b>\n"
            f"На <b>{_esc(new_nick)}</b>\n\n"
            f"Останется смен: <b>{max(changes - 1, 0)}</b>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="✅ Подтвердить", callback_data="confirm_nick_yes")],
                [types.InlineKeyboardButton(text="❌ Отмена", callback_data="confirm_nick_no")],
            ]
        )
        await message.answer(text, parse_mode="HTML", reply_markup=kb)
    except Exception as e:
        logger.exception("process_new_nickname failed: %s", e)


@router.callback_query(F.data.in_({"confirm_nick_yes", "confirm_nick_no"}))
async def cb_confirm_nick(callback: types.CallbackQuery, state: FSMContext):
    try:
        try:
            await callback.answer()
        except Exception:
            pass

        uid = callback.from_user.id
        if not check_user_registered(uid):
            await state.clear()
            return

        data = await state.get_data()
        current_state = await state.get_state()

        # отмена
        if callback.data == "confirm_nick_no" or current_state != NicknameStates.confirm_nickname_change:
            await state.clear()
            try:
                await callback.message.edit_text("❌ Смена ника отменена.", parse_mode="HTML")
            except Exception:
                pass
            await _show_nick_menu(callback, uid, edit=False)
            return

        new_nick = data.get("new_nickname")
        if not new_nick:
            await state.clear()
            return

        ok, new_nick, err = _validate_nick(new_nick)
        if not ok:
            await state.clear()
            try:
                await callback.message.edit_text(err, parse_mode="HTML")
            except Exception:
                pass
            return

        # === атомарная смена ===
        old_nick = None
        changes_left = 0
        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE")

                cur.execute(
                    "SELECT nickname, COALESCE(nickname_changes, 1) FROM users WHERE user_id = ?",
                    (uid,)
                )
                row = cur.fetchone()
                if not row:
                    await state.clear()
                    return

                old_nick = row[0] if row[0] else DEFAULT_NICK
                changes = int(row[1] or 0)
                if changes <= 0:
                    await state.clear()
                    try:
                        await callback.answer("Больше нет бесплатных смен", show_alert=True)
                    except Exception:
                        pass
                    return

                changes_left = changes - 1
                cur.execute(
                    "UPDATE users SET nickname = ?, nickname_changes = ? WHERE user_id = ?",
                    (new_nick, changes_left, uid)
                )
                cur.execute(
                    "INSERT INTO nickname_history (user_id, old_nickname, new_nickname, change_date) VALUES (?, ?, ?, ?)",
                    (uid, old_nick, new_nick, int(time.time()))
                )
        except Exception as e:
            logger.exception("nick change failed: %s", e)
            await state.clear()
            try:
                await callback.answer("⚠️ Ошибка. Попробуйте позже", show_alert=True)
            except Exception:
                pass
            return

        await state.clear()
        _nick_log(uid, callback.from_user, "change_nick",
                  extra_detail=f"{old_nick} -> {new_nick} (left={changes_left})")

        text = (
            "✅ <b>Ник изменён</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"👑 <b>{_esc(new_nick)}</b>\n"
            f"🔄 Осталось смен: <b>{changes_left}</b>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="👑 К нику", callback_data="back_to_nick")],
            ]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            try:
                await callback.message.answer(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                pass
    except Exception as e:
        logger.exception("cb_confirm_nick failed: %s", e)


@router.callback_query(F.data == "back_to_nick")
async def cb_back_to_nick(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        await _show_nick_menu(callback, uid, edit=True)
    except Exception as e:
        logger.exception("cb_back_to_nick failed: %s", e)


# ================== ИСТОРИЯ ==================
@router.callback_query(F.data == "nick_history")
async def cb_nick_history(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass

        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("""
                    SELECT old_nickname, new_nickname, change_date
                    FROM nickname_history
                    WHERE user_id = ?
                    ORDER BY id DESC LIMIT 10
                """, (uid,))
                history = cur.fetchall() or []
        except Exception:
            history = []

        if not history:
            text = (
                "📜 <b>История</b>\n"
                "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
                "Смены ников отсутствуют."
            )
        else:
            text = "📜 <b>История ников</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            for old, new, ts in history:
                try:
                    date_str = time.strftime("%d.%m.%Y %H:%M", time.localtime(int(ts or 0)))
                except Exception:
                    date_str = "—"
                text += (
                    f"<i>{date_str}</i>\n"
                    f"{_esc(old or '—')} → <b>{_esc(new or '—')}</b>\n\n"
                )

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="◀️ Назад", callback_data="back_to_nick")]]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            try:
                await callback.message.answer(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                pass
    except Exception as e:
        logger.exception("cb_nick_history failed: %s", e)