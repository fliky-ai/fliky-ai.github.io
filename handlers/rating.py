import time
import logging
from aiogram import Router, types, F
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

from database import (
    check_user_registered,
    get_user,
    get_rating,
    buy_rating,
    sell_rating,
    get_rating_history,
    log_action,
    RATING_BUY_PRICE,
    RATING_SELL_PRICE,
    RATING_COMMISSION,
    DEFAULT_NICK,
)

logger = logging.getLogger(__name__)
router = Router()

BUY_PRESETS = [10, 50, 100, 500, 1000]
SELL_PRESETS = [10, 50, 100, 500, 1000]


class RatingStates(StatesGroup):
    waiting_buy_amount = State()
    waiting_sell_amount = State()


# ================== ХЕЛПЕРЫ ==================
def _fmt(n) -> str:
    try:
        return f"{int(n):,}".replace(",", " ")
    except (TypeError, ValueError):
        return "0"


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
                "💡 Пожалуйста, перейдите в <b>личные сообщения</b> бота "
                "и нажмите /start, чтобы активировать игровой профиль!",
                parse_mode="HTML",
            )
        except Exception:
            pass
    return False


def _log(uid: int, user, action: str, **kwargs):
    try:
        log_action(
            user_id=uid,
            username=getattr(user, "username", None),
            display_name=getattr(user, "full_name", None),
            action_type="RATING",
            extra=action,
            **kwargs,
        )
    except Exception:
        pass


# ================== КЛАВИАТУРЫ ==================
def kb_buy_presets() -> types.InlineKeyboardMarkup:
    rows = []
    row = []
    for p in BUY_PRESETS:
        cost = p * RATING_BUY_PRICE
        row.append(types.InlineKeyboardButton(
            text=f"{_fmt(p)} ⭐ · {_fmt(cost)} UP",
            callback_data=f"rating_buy_amt_{p}"
        ))
        if len(row) == 2:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    rows.append([types.InlineKeyboardButton(text="✍️ Своё количество", callback_data="rating_buy_custom")])
    return types.InlineKeyboardMarkup(inline_keyboard=rows)


def kb_sell_presets(rating_have: int) -> types.InlineKeyboardMarkup:
    rows = []
    row = []
    for p in SELL_PRESETS:
        if p > rating_have:
            continue
        gross = p * RATING_SELL_PRICE
        comm = int(gross * RATING_COMMISSION)
        net = gross - comm
        row.append(types.InlineKeyboardButton(
            text=f"{_fmt(p)} ⭐ · {_fmt(net)} UP",
            callback_data=f"rating_sell_amt_{p}"
        ))
        if len(row) == 2:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    if rating_have > 0:
        rows.append([types.InlineKeyboardButton(text=f"💰 Всё ({_fmt(rating_have)} ⭐)", callback_data=f"rating_sell_amt_{rating_have}")])
    rows.append([types.InlineKeyboardButton(text="✍️ Своё количество", callback_data="rating_sell_custom")])
    return types.InlineKeyboardMarkup(inline_keyboard=rows)


def kb_confirm_buy(amount: int, price: int) -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="✅ Подтвердить", callback_data=f"rating_buy_confirm_{amount}_{price}")],
            [types.InlineKeyboardButton(text="❌ Отмена", callback_data="rating_cancel")],
        ]
    )


def kb_confirm_sell(amount: int, gross: int, comm: int, net: int) -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(
                text="✅ Подтвердить",
                callback_data=f"rating_sell_confirm_{amount}_{gross}_{comm}_{net}"
            )],
            [types.InlineKeyboardButton(text="❌ Отмена", callback_data="rating_cancel")],
        ]
    )


# ================== 1. КОМАНДА «РЕЙТИНГ» ==================
@router.message(Command("rating"))
async def cmd_rating(message: types.Message):
    try:
        if not await _require_reg(message):
            return
        uid = message.from_user.id
        rating = get_rating(uid)
        _log(uid, message.from_user, "view_rating")
        await message.answer(
            f"⭐ <b>Ваш рейтинг:</b> <b>{_fmt(rating)}</b>",
            parse_mode="HTML"
        )
    except Exception as e:
        logger.exception("cmd_rating failed: %s", e)


@router.message(F.text.casefold() == "рейтинг")
async def cmd_rating_text(message: types.Message):
    try:
        if not await _require_reg(message):
            return
        uid = message.from_user.id
        rating = get_rating(uid)
        _log(uid, message.from_user, "view_rating")
        await message.answer(
            f"⭐ <b>Ваш рейтинг:</b> <b>{_fmt(rating)}</b>",
            parse_mode="HTML"
        )
    except Exception as e:
        logger.exception("cmd_rating_text failed: %s", e)


# ================== 2. КОМАНДА «РЕЙТИНГ КУПИТЬ» ==================
@router.message(Command("buyrating"))
async def cmd_buy_rating(message: types.Message):
    try:
        if not await _require_reg(message):
            return
        await _show_buy_menu(message, message.from_user.id)
    except Exception as e:
        logger.exception("cmd_buy_rating failed: %s", e)


@router.message(F.text.casefold().in_({"рейтинг купить", "купить рейтинг"}))
async def cmd_buy_rating_text(message: types.Message):
    try:
        if not await _require_reg(message):
            return
        await _show_buy_menu(message, message.from_user.id)
    except Exception as e:
        logger.exception("cmd_buy_rating_text failed: %s", e)


async def _show_buy_menu(target, uid: int):
    user = get_user(uid) or {}
    balance = int(user.get("balance_up") or 0)

    text = (
        "⭐ <b>Покупка рейтинга</b>\n\n"
        f"💱 Цена: <b>{_fmt(RATING_BUY_PRICE)} UP</b> за 1 ⭐\n"
        f"💰 Ваш баланс: <b>{_fmt(balance)} UP</b>\n\n"
        "Выберите количество:"
    )
    kb = kb_buy_presets()

    try:
        if isinstance(target, types.CallbackQuery):
            await target.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        else:
            await target.answer(text, parse_mode="HTML", reply_markup=kb)
    except Exception:
        try:
            await target.answer(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass


# ================== 3. КОМАНДА «РЕЙТИНГ ПРОДАТЬ» ==================
@router.message(Command("sellrating"))
async def cmd_sell_rating(message: types.Message):
    try:
        if not await _require_reg(message):
            return
        await _show_sell_menu(message, message.from_user.id)
    except Exception as e:
        logger.exception("cmd_sell_rating failed: %s", e)


@router.message(F.text.casefold().in_({"рейтинг продать", "продать рейтинг"}))
async def cmd_sell_rating_text(message: types.Message):
    try:
        if not await _require_reg(message):
            return
        await _show_sell_menu(message, message.from_user.id)
    except Exception as e:
        logger.exception("cmd_sell_rating_text failed: %s", e)


async def _show_sell_menu(target, uid: int):
    rating = get_rating(uid)
    if rating <= 0:
        try:
            if isinstance(target, types.CallbackQuery):
                await target.answer("❌ У вас нет рейтинга для продажи", show_alert=True)
            else:
                await target.answer("❌ У вас нет рейтинга для продажи")
        except Exception:
            pass
        return

    text = (
        "⭐ <b>Продажа рейтинга</b>\n\n"
        f"⭐ У вас: <b>{_fmt(rating)}</b>\n"
        f"💱 Курс: <b>{_fmt(RATING_SELL_PRICE)} UP</b> за 1 ⭐\n"
        f"🏦 Комиссия: <b>{int(RATING_COMMISSION * 100)}%</b>\n\n"
        "Выберите количество:"
    )
    kb = kb_sell_presets(rating)

    try:
        if isinstance(target, types.CallbackQuery):
            await target.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        else:
            await target.answer(text, parse_mode="HTML", reply_markup=kb)
    except Exception:
        try:
            await target.answer(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass


# ================== CALLBACK: ОТМЕНА ==================
@router.callback_query(F.data == "rating_cancel")
async def cb_rating_cancel(callback: types.CallbackQuery, state: FSMContext):
    try:
        try:
            await state.clear()
        except Exception:
            pass
        try:
            await callback.message.delete()
        except Exception:
            pass
        await callback.answer("Отменено")
    except Exception as e:
        logger.exception("cb_rating_cancel failed: %s", e)


# ================== CALLBACK: ПОКУПКА ==================
@router.callback_query(F.data.startswith("rating_buy_amt_"))
async def cb_rating_buy_amt(callback: types.CallbackQuery):
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        try:
            amount = int(callback.data.split("_")[3])
        except (IndexError, ValueError):
            await callback.answer()
            return

        if amount <= 0:
            await callback.answer("❌ Некорректное количество", show_alert=True)
            return

        price = amount * RATING_BUY_PRICE
        user = get_user(uid) or {}
        balance = int(user.get("balance_up") or 0)

        text = (
            "⭐ <b>Подтверждение покупки</b>\n\n"
            f"⭐ Рейтинг: <b>+{_fmt(amount)}</b>\n"
            f"💰 Стоимость: <b>{_fmt(price)} UP</b>\n"
            f"💵 Ваш баланс: <b>{_fmt(balance)} UP</b>\n\n"
            "Подтвердить?"
        )
        try:
            await callback.message.edit_text(
                text, parse_mode="HTML",
                reply_markup=kb_confirm_buy(amount, price)
            )
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_rating_buy_amt failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data == "rating_buy_custom")
async def cb_rating_buy_custom(callback: types.CallbackQuery, state: FSMContext):
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return
        await state.set_state(RatingStates.waiting_buy_amount)
        text = (
            "⭐ <b>Покупка рейтинга</b>\n\n"
            f"💱 Цена: <b>{_fmt(RATING_BUY_PRICE)} UP</b> за 1 ⭐\n\n"
            "Введите количество рейтинга, которое хотите купить:"
        )
        try:
            await callback.message.edit_text(
                text, parse_mode="HTML",
                reply_markup=types.InlineKeyboardMarkup(inline_keyboard=[
                    [types.InlineKeyboardButton(text="❌ Отмена", callback_data="rating_cancel")]
                ])
            )
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_rating_buy_custom failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.message(RatingStates.waiting_buy_amount)
async def process_buy_amount(message: types.Message, state: FSMContext):
    try:
        uid = message.from_user.id if message.from_user else None
        if not uid:
            return
        if not check_user_registered(uid):
            await state.clear()
            return

        raw = (message.text or "").strip().replace(" ", "")
        if not raw.isdigit() or int(raw) <= 0:
            await message.answer("⚠️ Введите положительное число.")
            return
        amount = int(raw)

        price = amount * RATING_BUY_PRICE
        user = get_user(uid) or {}
        balance = int(user.get("balance_up") or 0)

        await state.clear()

        text = (
            "⭐ <b>Подтверждение покупки</b>\n\n"
            f"⭐ Рейтинг: <b>+{_fmt(amount)}</b>\n"
            f"💰 Стоимость: <b>{_fmt(price)} UP</b>\n"
            f"💵 Ваш баланс: <b>{_fmt(balance)} UP</b>\n\n"
            "Подтвердить?"
        )
        await message.answer(
            text, parse_mode="HTML",
            reply_markup=kb_confirm_buy(amount, price)
        )
    except Exception as e:
        logger.exception("process_buy_amount failed: %s", e)
        try:
            await state.clear()
        except Exception:
            pass


@router.callback_query(F.data.startswith("rating_buy_confirm_"))
async def cb_rating_buy_confirm(callback: types.CallbackQuery):
    try:
        uid = callback.from_user.id if callback.from_user else None
        if not uid:
            return
        if not check_user_registered(uid):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        parts = (callback.data or "").split("_")
        try:
            amount = int(parts[3])
            expected_price = int(parts[4])
        except (IndexError, ValueError):
            await callback.answer("❌ Некорректные данные", show_alert=True)
            return

        actual_price = amount * RATING_BUY_PRICE
        if actual_price != expected_price:
            user = get_user(uid) or {}
            balance = int(user.get("balance_up") or 0)
            text = (
                "⭐ <b>Подтверждение покупки</b>\n\n"
                f"⭐ Рейтинг: <b>+{_fmt(amount)}</b>\n"
                f"💰 Стоимость: <b>{_fmt(actual_price)} UP</b>\n"
                f"💵 Ваш баланс: <b>{_fmt(balance)} UP</b>\n\n"
                "Подтвердить?"
            )
            try:
                await callback.message.edit_text(
                    text, parse_mode="HTML",
                    reply_markup=kb_confirm_buy(amount, actual_price)
                )
            except Exception:
                pass
            await callback.answer("⚠️ Цена обновилась")
            return

        ok, reason, info = buy_rating(uid, amount)
        if not ok:
            msgs = {
                "invalid_amount": "❌ Некорректное количество",
                "user_not_found": "❌ Профиль не найден",
                "insufficient_funds": "❌ Недостаточно UP",
                "db_error": "⚠️ Ошибка БД, попробуйте позже",
            }
            await callback.answer(msgs.get(reason, "⚠️ Ошибка"), show_alert=True)
            return

        _log(uid, callback.from_user, "buy_success",
             balance_before=info["balance_before"], balance_after=info["balance_after"],
             extra_detail=f"amount={amount} price={info['price']}")

        try:
            text = (
                "⭐ <b>Рейтинг куплен</b>\n\n"
                f"⭐ Получено: <b>+{_fmt(amount)}</b>\n"
                f"💰 Списано: <b>{_fmt(info['price'])} UP</b>\n"
                f"⭐ Теперь у вас: <b>{_fmt(info['rating_after'])}</b>\n"
                f"💵 Баланс: <b>{_fmt(info['balance_after'])} UP</b>"
            )
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=None)
        except Exception:
            pass
        await callback.answer("✅ Готово!")
    except Exception as e:
        logger.exception("cb_rating_buy_confirm failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


# ================== CALLBACK: ПРОДАЖА ==================
@router.callback_query(F.data.startswith("rating_sell_amt_"))
async def cb_rating_sell_amt(callback: types.CallbackQuery):
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        try:
            amount = int(callback.data.split("_")[3])
        except (IndexError, ValueError):
            await callback.answer()
            return

        if amount <= 0:
            await callback.answer("❌ Некорректное количество", show_alert=True)
            return

        rating = get_rating(uid)
        if amount > rating:
            await callback.answer(f"❌ У вас только {_fmt(rating)} ⭐", show_alert=True)
            return

        gross = amount * RATING_SELL_PRICE
        comm = int(gross * RATING_COMMISSION)
        net = gross - comm

        text = (
            "💸 <b>Подтверждение продажи</b>\n\n"
            f"⭐ Рейтинг: <b>{_fmt(amount)}</b>\n"
            f"💰 Стоимость: <b>{_fmt(gross)} UP</b>\n"
            f"🏦 Комиссия: <b>{int(RATING_COMMISSION * 100)}%</b> — {_fmt(comm)} UP\n"
            f"💵 К получению: <b>{_fmt(net)} UP</b>\n\n"
            "Подтвердить?"
        )
        try:
            await callback.message.edit_text(
                text, parse_mode="HTML",
                reply_markup=kb_confirm_sell(amount, gross, comm, net)
            )
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_rating_sell_amt failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data == "rating_sell_custom")
async def cb_rating_sell_custom(callback: types.CallbackQuery, state: FSMContext):
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return
        rating = get_rating(uid)
        if rating <= 0:
            await callback.answer("❌ У вас нет рейтинга для продажи", show_alert=True)
            return

        await state.set_state(RatingStates.waiting_sell_amount)
        text = (
            "💸 <b>Продажа рейтинга</b>\n\n"
            f"⭐ У вас: <b>{_fmt(rating)}</b>\n"
            f"💱 Курс: <b>{_fmt(RATING_SELL_PRICE)} UP</b> за 1 ⭐\n"
            f"🏦 Комиссия: <b>{int(RATING_COMMISSION * 100)}%</b>\n\n"
            "Введите количество для продажи:"
        )
        try:
            await callback.message.edit_text(
                text, parse_mode="HTML",
                reply_markup=types.InlineKeyboardMarkup(inline_keyboard=[
                    [types.InlineKeyboardButton(text="❌ Отмена", callback_data="rating_cancel")]
                ])
            )
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_rating_sell_custom failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.message(RatingStates.waiting_sell_amount)
async def process_sell_amount(message: types.Message, state: FSMContext):
    try:
        uid = message.from_user.id if message.from_user else None
        if not uid:
            return
        if not check_user_registered(uid):
            await state.clear()
            return

        raw = (message.text or "").strip().replace(" ", "")
        if not raw.isdigit() or int(raw) <= 0:
            await message.answer("⚠️ Введите положительное число.")
            return
        amount = int(raw)

        rating = get_rating(uid)
        if amount > rating:
            await message.answer(f"❌ У вас только {_fmt(rating)} ⭐")
            return

        gross = amount * RATING_SELL_PRICE
        comm = int(gross * RATING_COMMISSION)
        net = gross - comm

        await state.clear()

        text = (
            "💸 <b>Подтверждение продажи</b>\n\n"
            f"⭐ Рейтинг: <b>{_fmt(amount)}</b>\n"
            f"💰 Стоимость: <b>{_fmt(gross)} UP</b>\n"
            f"🏦 Комиссия: <b>{int(RATING_COMMISSION * 100)}%</b> — {_fmt(comm)} UP\n"
            f"💵 К получению: <b>{_fmt(net)} UP</b>\n\n"
            "Подтвердить?"
        )
        await message.answer(
            text, parse_mode="HTML",
            reply_markup=kb_confirm_sell(amount, gross, comm, net)
        )
    except Exception as e:
        logger.exception("process_sell_amount failed: %s", e)
        try:
            await state.clear()
        except Exception:
            pass


@router.callback_query(F.data.startswith("rating_sell_confirm_"))
async def cb_rating_sell_confirm(callback: types.CallbackQuery):
    try:
        uid = callback.from_user.id if callback.from_user else None
        if not uid:
            return
        if not check_user_registered(uid):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        parts = (callback.data or "").split("_")
        try:
            amount = int(parts[3])
            gross = int(parts[4])
            comm = int(parts[5])
            net = int(parts[6])
        except (IndexError, ValueError):
            await callback.answer("❌ Некорректные данные", show_alert=True)
            return

        actual_gross = amount * RATING_SELL_PRICE
        actual_comm = int(actual_gross * RATING_COMMISSION)
        actual_net = actual_gross - actual_comm
        if (actual_gross, actual_comm, actual_net) != (gross, comm, net):
            text = (
                "💸 <b>Подтверждение продажи</b>\n\n"
                f"⭐ Рейтинг: <b>{_fmt(amount)}</b>\n"
                f"💰 Стоимость: <b>{_fmt(actual_gross)} UP</b>\n"
                f"🏦 Комиссия: <b>{int(RATING_COMMISSION * 100)}%</b> — {_fmt(actual_comm)} UP\n"
                f"💵 К получению: <b>{_fmt(actual_net)} UP</b>\n\n"
                "Подтвердить?"
            )
            try:
                await callback.message.edit_text(
                    text, parse_mode="HTML",
                    reply_markup=kb_confirm_sell(amount, actual_gross, actual_comm, actual_net)
                )
            except Exception:
                pass
            await callback.answer("⚠️ Условия обновились")
            return

        ok, reason, info = sell_rating(uid, amount)
        if not ok:
            msgs = {
                "invalid_amount": "❌ Некорректное количество",
                "user_not_found": "❌ Профиль не найден",
                "not_enough_rating": f"❌ У вас только {_fmt(info.get('rating', 0))} ⭐",
                "db_error": "⚠️ Ошибка БД, попробуйте позже",
            }
            await callback.answer(msgs.get(reason, "⚠️ Ошибка"), show_alert=True)
            return

        _log(uid, callback.from_user, "sell_success",
             balance_before=info["balance_before"], balance_after=info["balance_after"],
             extra_detail=f"amount={amount} net={info['net']} comm={info['commission']}")

        try:
            text = (
                "💸 <b>Рейтинг продан</b>\n\n"
                f"⭐ Списано: <b>-{_fmt(amount)}</b>\n"
                f"💰 Начислено: <b>+{_fmt(info['net'])} UP</b>\n"
                f"🏦 Комиссия: <b>{_fmt(info['commission'])} UP</b>\n"
                f"⭐ Теперь у вас: <b>{_fmt(info['rating_after'])}</b>\n"
                f"💵 Баланс: <b>{_fmt(info['balance_after'])} UP</b>"
            )
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=None)
        except Exception:
            pass
        await callback.answer("✅ Готово!")
    except Exception as e:
        logger.exception("cb_rating_sell_confirm failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass