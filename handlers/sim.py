import time
import logging
from aiogram import Router, types, F
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

from database import db_conn, check_user_registered, get_user, log_action

logger = logging.getLogger(__name__)
router = Router()

UNLIMIT_PRICE = 50_000
UNLIMIT_DAYS = 30
MIN_TOPUP = 100


# ================== FSM ==================
class SimStates(StatesGroup):
    topup_amount = State()


# ================== БД ==================
def _init_sim_db():
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS sim_cards (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    operator TEXT,
                    phone_number TEXT UNIQUE,
                    balance INTEGER DEFAULT 0,
                    internet_gb REAL DEFAULT 0,
                    internet_expire INTEGER DEFAULT 0,
                    created_at INTEGER,
                    status TEXT DEFAULT 'active'
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS user_sim (
                    user_id INTEGER PRIMARY KEY,
                    sim_id INTEGER,
                    active INTEGER DEFAULT 0
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS sim_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    action_type TEXT,
                    amount INTEGER DEFAULT 0,
                    details TEXT,
                    created_at INTEGER
                )
            """)
        logger.info("sim: таблицы инициализированы")
    except Exception as e:
        logger.exception("init_sim_db failed: %s", e)


_init_sim_db()


# ================== УТИЛИТЫ ==================
def _fmt(n) -> str:
    try:
        return f"{int(n):,}".replace(",", " ")
    except (TypeError, ValueError):
        return "0"


def _esc(s) -> str:
    return (str(s) if s is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def get_user_balance(user_id: int) -> int:
    try:
        user = get_user(user_id)
        return int((user or {}).get("balance_up") or 0)
    except Exception:
        return 0


def get_user_sim_info(user_id: int):
    """SIM info. Включает created_at — фикс бага sim_stats."""
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT sim_id, active FROM user_sim WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row or not row[1]:
                return None
            sim_id = row[0]
            cur.execute("""
                SELECT id, operator, phone_number, balance, internet_gb,
                       internet_expire, status, created_at
                FROM sim_cards WHERE id = ? AND status = 'active'
            """, (sim_id,))
            srow = cur.fetchone()
        if not srow:
            return None
        return {
            "id": srow[0],
            "operator": srow[1],
            "phone_number": srow[2],
            "balance": srow[3] or 0,
            "internet_gb": srow[4] or 0,
            "internet_expire": srow[5] or 0,
            "status": srow[6],
            "created_at": srow[7] or 0,
        }
    except Exception as e:
        logger.exception("get_user_sim_info failed: %s", e)
        return None


def _is_unlimited_active(sim) -> bool:
    try:
        return int(sim.get("internet_expire") or 0) > int(time.time())
    except Exception:
        return False


def _unlimited_days_left(sim) -> int:
    try:
        remain = int(sim.get("internet_expire") or 0) - int(time.time())
        if remain <= 0:
            return 0
        return remain // 86400
    except Exception:
        return 0


def _add_sim_history(user_id: int, action: str, amount: int = 0, details: str = ""):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO sim_history (user_id, action_type, amount, details, created_at)
                VALUES (?, ?, ?, ?, ?)
            """, (user_id, action, amount, details, int(time.time())))
    except Exception as e:
        logger.exception("_add_sim_history failed: %s", e)


def _sim_log(user_id: int, user, action: str, **kwargs):
    try:
        log_action(
            user_id=user_id,
            username=getattr(user, "username", None),
            display_name=getattr(user, "full_name", None),
            action_type="SIM",
            extra=action,
            **kwargs,
        )
    except Exception:
        pass


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


# ================== ГЛАВНОЕ МЕНЮ ==================
@router.message(F.text.casefold().in_({"мой сим", "сим", "симкарта"}))
async def cmd_sim(message: types.Message):
    try:
        if not await _require_reg(message):
            return
        _sim_log(message.from_user.id, message.from_user, "open_sim")
        await _show_sim_profile(message, message.from_user.id)
    except Exception as e:
        logger.exception("cmd_sim failed: %s", e)


async def _show_sim_profile(target, user_id: int):
    try:
        sim = get_user_sim_info(user_id)

        if not sim:
            text = (
                "📶 <b>SIM-карта не найдена</b>\n"
                "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
                "💡 Купите SIM-карту в <b>Техномаркет</b>.\n\n"
                "👉 Команда: <b>Техномаркет</b>"
            )
            kb = types.InlineKeyboardMarkup(
                inline_keyboard=[[types.InlineKeyboardButton(text="🏬 Техномаркет", callback_data="tm_back")]]
            )
            if isinstance(target, types.CallbackQuery):
                try:
                    await target.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
                    return
                except Exception:
                    pass
            try:
                await target.answer(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                pass
            return

        # Основное инфо
        if _is_unlimited_active(sim):
            days_left = _unlimited_days_left(sim)
            internet_str = f"🌐 Безлимит (осталось {days_left} дн.)"
        else:
            internet_str = "🌐 Интернет: нет тарифа"

        text = (
            "📱 <b>Мобильный профиль</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"📶 Оператор: <b>{_esc(sim['operator'])}</b>\n"
            f"📞 Номер: <code>{_esc(sim['phone_number'])}</code>\n\n"
            f"💰 Баланс SIM: <b>{_fmt(sim['balance'])} UP</b>\n"
            f"{internet_str}\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n"
            "Выберите действие:"
        )

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="💳 Пополнить баланс", callback_data="sim_topup")],
                [types.InlineKeyboardButton(text="🌐 Тарифы", callback_data="sim_tariffs")],
                [types.InlineKeyboardButton(text="📊 Статистика", callback_data="sim_stats")],
            ]
        )

        if isinstance(target, types.CallbackQuery):
            try:
                await target.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
                return
            except Exception:
                pass
        try:
            await target.answer(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("_show_sim_profile failed: %s", e)


@router.callback_query(F.data == "sim_back")
async def cb_sim_back(callback: types.CallbackQuery, state: FSMContext):
    try:
        try:
            await state.clear()
        except Exception:
            pass
        await _show_sim_profile(callback, callback.from_user.id)
    except Exception as e:
        logger.exception("cb_sim_back failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


# ================== ПОПОЛНЕНИЕ ==================
@router.callback_query(F.data == "sim_topup")
async def cb_sim_topup(callback: types.CallbackQuery, state: FSMContext):
    try:
        uid = callback.from_user.id
        sim = get_user_sim_info(uid)
        if not sim:
            await callback.answer("❌ У вас нет SIM-карты", show_alert=True)
            return

        await state.set_state(SimStates.topup_amount)
        await state.update_data(sim_user=uid)

        text = (
            "💳 <b>Пополнение SIM</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"💰 Ваш баланс: <b>{_fmt(get_user_balance(uid))} UP</b>\n\n"
            f"Введите сумму пополнения:\n"
            f"<i>Минимум: {_fmt(MIN_TOPUP)} UP</i>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="❌ Отмена", callback_data="sim_back")]]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_sim_topup failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.message(SimStates.topup_amount)
async def process_topup(message: types.Message, state: FSMContext):
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

        if amount < MIN_TOPUP:
            await message.answer(f"❌ Минимальная сумма: {_fmt(MIN_TOPUP)} UP")
            return

        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE")

                cur.execute("SELECT sim_id, active FROM user_sim WHERE user_id = ?", (uid,))
                row = cur.fetchone()
                if not row or not row[1]:
                    await state.clear()
                    await message.answer("❌ У вас нет SIM-карты")
                    return
                sim_id = row[0]

                cur.execute("SELECT balance_up FROM users WHERE user_id = ?", (uid,))
                brow = cur.fetchone()
                if not brow:
                    await state.clear()
                    await message.answer("❌ Профиль не найден")
                    return
                balance = int(brow[0] or 0)
                if balance < amount:
                    await message.answer(f"❌ Недостаточно UP. У вас: {_fmt(balance)} UP")
                    return

                cur.execute("UPDATE users SET balance_up = ? WHERE user_id = ?", (balance - amount, uid))
                cur.execute("UPDATE sim_cards SET balance = balance + ? WHERE id = ?", (amount, sim_id))
                cur.execute("SELECT balance FROM sim_cards WHERE id = ?", (sim_id,))
                new_sim_balance = cur.fetchone()[0] or 0
        except Exception as e:
            logger.exception("topup failed: %s", e)
            await state.clear()
            await message.answer("⚠️ Ошибка пополнения. Попробуйте позже.")
            return

        await state.clear()
        _add_sim_history(uid, "Пополнение", amount)
        _sim_log(uid, message.from_user, "topup",
                 balance_before=balance, balance_after=balance - amount,
                 extra_detail=f"amount={amount}")

        text = (
            "✅ <b>Баланс SIM пополнен</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"💰 Пополнено: <b>+{_fmt(amount)} UP</b>\n"
            f"💎 Баланс SIM: <b>{_fmt(new_sim_balance)} UP</b>\n"
            f"💵 Основной баланс: <b>{_fmt(balance - amount)} UP</b>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="📶 Мой SIM", callback_data="sim_back")]]
        )
        await message.answer(text, parse_mode="HTML", reply_markup=kb)
    except Exception as e:
        logger.exception("process_topup failed: %s", e)
        try:
            await state.clear()
        except Exception:
            pass


# ================== ТАРИФЫ ==================
@router.callback_query(F.data == "sim_tariffs")
async def cb_sim_tariffs(callback: types.CallbackQuery):
    try:
        uid = callback.from_user.id
        sim = get_user_sim_info(uid)
        if not sim:
            await callback.answer("❌ У вас нет SIM-карты", show_alert=True)
            return

        active = _is_unlimited_active(sim)

        if active:
            days_left = _unlimited_days_left(sim)
            text = (
                "🌐 <b>Тарифы</b>\n"
                "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
                f"✅ У вас уже подключён безлимит.\n"
                f"⏳ Осталось: <b>{days_left} дн.</b>\n\n"
                "<i>Продление недоступно. Тариф можно подключить заново после окончания.</i>"
            )
            kb = types.InlineKeyboardMarkup(
                inline_keyboard=[[types.InlineKeyboardButton(text="🔙 Назад", callback_data="sim_back")]]
            )
            try:
                await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                pass
            return

        text = (
            "🌐 <b>Тарифы</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"🌐 <b>Безлимит на {UNLIMIT_DAYS} дней</b>\n"
            f"💰 Цена: <b>{_fmt(UNLIMIT_PRICE)} UP</b>\n\n"
            f"💎 Ваш баланс SIM: <b>{_fmt(sim['balance'])} UP</b>\n\n"
            "Подключить?"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(
                    text=f"✅ Подключить за {_fmt(UNLIMIT_PRICE)} UP",
                    callback_data="sim_tariff_buy"
                )],
                [types.InlineKeyboardButton(text="🔙 Назад", callback_data="sim_back")],
            ]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_sim_tariffs failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data == "sim_tariff_buy")
async def cb_sim_tariff_buy(callback: types.CallbackQuery):
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE")

                cur.execute("SELECT sim_id, active FROM user_sim WHERE user_id = ?", (uid,))
                row = cur.fetchone()
                if not row or not row[1]:
                    await callback.answer("❌ У вас нет SIM-карты", show_alert=True)
                    return
                sim_id = row[0]

                cur.execute("SELECT balance, internet_expire FROM sim_cards WHERE id = ? AND status = 'active'", (sim_id,))
                srow = cur.fetchone()
                if not srow:
                    await callback.answer("❌ SIM-карта не активна", show_alert=True)
                    return
                sim_balance = int(srow[0] or 0)
                expire = int(srow[1] or 0)

                if expire > int(time.time()):
                    await callback.answer("❌ У вас уже активен безлимит", show_alert=True)
                    return

                if sim_balance < UNLIMIT_PRICE:
                    await callback.answer(
                        f"❌ Недостаточно UP на балансе SIM\nНужно: {_fmt(UNLIMIT_PRICE)} UP",
                        show_alert=True
                    )
                    return

                new_balance = sim_balance - UNLIMIT_PRICE
                new_expire = int(time.time()) + UNLIMIT_DAYS * 86400

                cur.execute("""
                    UPDATE sim_cards
                    SET balance = ?, internet_gb = -1, internet_expire = ?
                    WHERE id = ?
                """, (new_balance, new_expire, sim_id))
        except Exception as e:
            logger.exception("tariff buy failed: %s", e)
            await callback.answer("⚠️ Ошибка подключения", show_alert=True)
            return

        _add_sim_history(uid, "Тариф безлимит", UNLIMIT_PRICE, f"{UNLIMIT_DAYS} дней")
        _sim_log(uid, callback.from_user, "buy_unlimited", extra_detail=f"price={UNLIMIT_PRICE}")

        text = (
            "✅ <b>Безлимит подключён</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"🌐 Тариф: <b>Безлимит на {UNLIMIT_DAYS} дней</b>\n"
            f"💰 Списано: <b>{_fmt(UNLIMIT_PRICE)} UP</b>\n"
            f"💎 Баланс SIM: <b>{_fmt(new_balance)} UP</b>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="📶 Мой SIM", callback_data="sim_back")]]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
        await callback.answer("✅ Подключено!")
    except Exception as e:
        logger.exception("cb_sim_tariff_buy failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


# ================== СТАТИСТИКА ==================
@router.callback_query(F.data == "sim_stats")
async def cb_sim_stats(callback: types.CallbackQuery):
    try:
        uid = callback.from_user.id
        sim = get_user_sim_info(uid)
        if not sim:
            await callback.answer("❌ У вас нет SIM-карты", show_alert=True)
            return

        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("SELECT COUNT(*) FROM sim_history WHERE user_id = ?", (uid,))
                total_ops = cur.fetchone()[0] or 0
        except Exception:
            total_ops = 0

        created_ts = int(sim.get("created_at") or 0)
        if created_ts:
            try:
                created_date = time.strftime("%d.%m.%Y", time.localtime(created_ts))
            except Exception:
                created_date = "—"
        else:
            created_date = "—"

        if _is_unlimited_active(sim):
            days_left = _unlimited_days_left(sim)
            internet_str = f"🌐 Безлимит (осталось {days_left} дн.)"
        else:
            internet_str = "🌐 Тариф не подключён"

        text = (
            "📊 <b>Статистика SIM</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"📞 Номер: <code>{_esc(sim['phone_number'])}</code>\n"
            f"📶 Оператор: <b>{_esc(sim['operator'])}</b>\n"
            f"📅 Активирована: <b>{created_date}</b>\n"
            f"💰 Операций: <b>{total_ops}</b>\n"
            f"💎 Баланс SIM: <b>{_fmt(sim['balance'])} UP</b>\n"
            f"{internet_str}"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="🔙 Назад", callback_data="sim_back")]]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_sim_stats failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass