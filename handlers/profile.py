import time
import os
import logging
from pathlib import Path
from aiogram import Router, types, F
from aiogram.types import FSInputFile
from database import (
    db_conn, get_user, DEFAULT_NICK, check_user_registered as _check_reg,
    get_user_level,
)

logger = logging.getLogger(__name__)
router = Router()

PHOTOS_DIR = Path(__file__).resolve().parent / "photos"

DEFAULT_SKIN = "personage.jpg"
OWNER_ID = 8771009385

PERSONAGE_NAMES = {
    "personage.jpg": "🧙 Бомж",
    "personage2.jpg": "🌱 Начинающий",
    "personage3.jpg": "💼 Стартовый",
    "personage4.jpg": "📚 Ученик",
    "personage5.jpg": "🏙 Городской",
    "personage6.jpg": "👑 Титан",
}


def get_personage_name(skin_file: str | None) -> str:
    if not skin_file:
        return PERSONAGE_NAMES[DEFAULT_SKIN]
    return PERSONAGE_NAMES.get(skin_file, PERSONAGE_NAMES[DEFAULT_SKIN])


def check_user_registered(user_id: int) -> bool:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT 1 FROM users WHERE user_id = ?", (user_id,))
            return cur.fetchone() is not None
    except Exception as e:
        logger.exception("check_user_registered failed for %s: %s", user_id, e)
        return False


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


def get_user_skin(user_id: int) -> str:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("PRAGMA table_info(users)")
            cols = {c[1] for c in cur.fetchall()}
            if "skin" not in cols:
                return DEFAULT_SKIN
            cur.execute("SELECT skin FROM users WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            return row[0] if row and row[0] else DEFAULT_SKIN
    except Exception as e:
        logger.exception("get_user_skin failed for %s: %s", user_id, e)
        return DEFAULT_SKIN


def _fmt_number(value) -> str:
    try:
        return f"{int(value):,}".replace(",", " ")
    except (TypeError, ValueError):
        return "0"


def _xp_bar(xp: int, need: int, length: int = 10) -> str:
    """Прогресс-бар из символов."""
    try:
        if need <= 0:
            return "█" * length
        filled = int((xp / need) * length)
        filled = max(0, min(length, filled))
        return "█" * filled + "░" * (length - filled)
    except Exception:
        return "░" * length


def _fetch_bank(user_id: int):
    """Возвращает (card_masked, bank_balance_str) или (None, None)."""
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='user_bank'")
            if not cur.fetchone():
                return None, None

            cur.execute("PRAGMA table_info(user_bank)")
            cols = {c[1] for c in cur.fetchall()}
            if not {"card_number", "balance_bank"}.issubset(cols):
                return None, None

            cur.execute("SELECT card_number, balance_bank FROM user_bank WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row:
                return None, None

            card_number = row[0] or ""
            balance = row[1] or 0
            masked = f"•••• {card_number[-4:]}" if len(card_number) >= 4 else "Не открыта"
            return masked, f"{_fmt_number(balance)} UP"
    except Exception as e:
        logger.exception("_fetch_bank failed for %s: %s", user_id, e)
        return None, None


async def get_profile_text_and_kb(user_id: int):
    try:
        user = get_user(user_id)
        if not user:
            return None, None, None

        nickname = user.get("nickname") or DEFAULT_NICK
        wallet_up = user.get("balance_up") or 0
        ucoins = user.get("balance_uc") or 0
        rating = user.get("rating") or 0
        reg_ts = user.get("reg_date")

        # === Единая система уровня ===
        lvl_data = get_user_level(user_id)
        level = lvl_data.get("level", 1)
        xp = lvl_data.get("xp", 0)
        xp_need = lvl_data.get("xp_needed", 100)
        bar = _xp_bar(xp, xp_need)

        if reg_ts:
            try:
                reg_date_str = time.strftime("%d.%m.%Y", time.localtime(int(reg_ts)))
            except Exception:
                reg_date_str = time.strftime("%d.%m.%Y")
        else:
            reg_date_str = time.strftime("%d.%m.%Y")

        card_masked, bank_balance = _fetch_bank(user_id)
        if card_masked is None:
            card_masked = "Не открыта"
            bank_balance = "0 UP"

        status = "🏆 OWNER" if user_id == OWNER_ID else "👤 Игрок"

        skin_file = get_user_skin(user_id)
        personage_name = get_personage_name(skin_file)

        text = (
            f"👤 <b>Профиль игрока</b>\n"
            f"🆔 ID: <code>{user_id}</code>\n"
            f"🎭 Персонаж: <b>{personage_name}</b>\n"
            f"👑 Ник: <b>{nickname}</b>\n"
            f"⚡ Статус: <b>{status}</b>\n\n"
            f"⭐ Уровень: <b>{level}</b>\n"
            f"📈 EXP: <b>{_fmt_number(xp)} / {_fmt_number(xp_need)}</b>\n"
            f"<code>{bar}</code>\n\n"
            f"💰 Баланс: <b>{_fmt_number(wallet_up)} UP</b>\n"
            f"💎 U-coins: <b>{_fmt_number(ucoins)}</b>\n"
            f"⭐ Рейтинг: <b>{_fmt_number(rating)}</b>\n"
            f"🏦 Банк: <b>{bank_balance}</b>\n"
            f"💳 Карта: <code>{card_masked}</code>\n\n"
            f"📅 Регистрация: <b>{reg_date_str}</b>"
        )

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    types.InlineKeyboardButton(text="🏆 Топ", callback_data="top"),
                    types.InlineKeyboardButton(text="🎒 Гардероб", callback_data="wardrobe_open"),
                ]
            ]
        )
        return text, kb, skin_file

    except Exception as e:
        logger.exception("get_profile_text_and_kb failed for %s: %s", user_id, e)
        return None, None, None


async def generate_top_text() -> str:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT user_id, balance_up FROM users ORDER BY balance_up DESC LIMIT 10"
            )
            top_list = cur.fetchall()

        if not top_list:
            return "🏆 Рейтинг пока пуст!"

        text = "🏆 <b>Топ-10 богатейших игроков:</b>\n\n"
        medals = ["🥇", "🥈", "🥉"]

        for index, (user_id, balance) in enumerate(top_list, start=1):
            place_icon = medals[index - 1] if index <= 3 else f"<b>{index}.</b>"
            nickname = get_user_nickname(user_id)
            safe_nick = nickname.replace("<", "&lt;").replace(">", "&gt;")
            player_link = f"<a href='tg://user?id={user_id}'>{safe_nick}</a>"
            text += f"{place_icon} {player_link} — <code>{_fmt_number(balance)} UP</code>\n"

        return text

    except Exception as e:
        logger.exception("generate_top_text failed: %s", e)
        return "🏆 Ошибка загрузки топа!"


async def _send_profile(target, user_id: int, edit: bool = False):
    result = await get_profile_text_and_kb(user_id)
    if not result or not result[0]:
        try:
            await target.answer("❌ Ошибка загрузки профиля. Попробуйте позже.")
        except Exception:
            pass
        return False

    text, kb, skin_file = result
    photo_path = PHOTOS_DIR / skin_file

    if photo_path.exists():
        try:
            await target.answer_photo(
                photo=FSInputFile(str(photo_path)),
                caption=text,
                parse_mode="HTML",
                reply_markup=kb,
            )
            return True
        except Exception as e:
            logger.warning("Photo send error: %s", e)

    try:
        await target.answer(text, parse_mode="HTML", reply_markup=kb)
        return True
    except Exception as e:
        logger.exception("Profile text send error: %s", e)
        return False


@router.message(F.text.casefold().in_({"профиль", "profile", "/profile", "👤 профиль"}))
async def cmd_profile(message: types.Message):
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
                parse_mode="HTML",
            )
            return

        await _send_profile(message, user_id)

    except Exception as e:
        logger.exception("cmd_profile failed: %s", e)


@router.message(F.text.casefold().in_({"топ", "топ 10", "🏆 топ"}))
async def show_top_command(message: types.Message):
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
                parse_mode="HTML",
            )
            return

        text = await generate_top_text()
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="🏠 Главное меню", callback_data="main_menu")]]
        )
        await message.answer(text, parse_mode="HTML", reply_markup=kb)

    except Exception as e:
        logger.exception("show_top_command failed: %s", e)


@router.callback_query(F.data == "top")
async def show_top_callback(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            await callback.answer()
            return

        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        text = await generate_top_text()
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="🏠 Главное меню", callback_data="main_menu")]]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            await callback.message.answer(text, parse_mode="HTML", reply_markup=kb)

    except Exception as e:
        logger.exception("show_top_callback failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data == "main_menu")
async def back_to_main_menu(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            await callback.answer()
            return

        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        result = await get_profile_text_and_kb(user_id)
        if not result or not result[0]:
            try:
                await callback.message.edit_text("❌ Ошибка загрузки профиля.", parse_mode="HTML")
            except Exception:
                try:
                    await callback.message.answer("❌ Ошибка загрузки профиля.")
                except Exception:
                    pass
            return

        text, kb, skin_file = result

        try:
            await callback.message.delete()
        except Exception:
            pass

        photo_path = PHOTOS_DIR / skin_file
        if photo_path.exists():
            try:
                await callback.message.answer_photo(
                    photo=FSInputFile(str(photo_path)),
                    caption=text,
                    parse_mode="HTML",
                    reply_markup=kb,
                )
                return
            except Exception as e:
                logger.warning("Photo send error: %s", e)

        await callback.message.answer(text, parse_mode="HTML", reply_markup=kb)

    except Exception as e:
        logger.exception("back_to_main_menu failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass