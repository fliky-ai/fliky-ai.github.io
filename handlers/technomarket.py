import time
import random
import logging
from pathlib import Path
from aiogram import Router, types, F
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import FSInputFile

from database import db_conn, check_user_registered, get_user, DEFAULT_NICK, log_action

logger = logging.getLogger(__name__)
router = Router()

PHOTOS_DIR = Path(__file__).resolve().parent / "photos"
SIM_PRICE = 5000
SELL_RATE = 0.90


# ================== FSM ==================
class TechMarketStates(StatesGroup):
    waiting_sell_confirm = State()


# ================== КАТАЛОГ ==================
PHONES = {
    "nokia_3310": {"name": "Nokia 3310", "price": 5_000, "photo": "phone.jpg"},
    "redmi_note_13": {"name": "Xiaomi Redmi Note 13", "price": 50_000, "photo": "phone2.jpg"},
    "nothing_3": {"name": "Nothing Phone (3)", "price": 200_000, "photo": "phone3.jpg"},
    "rog_phone_9": {"name": "Asus ROG Phone 9", "price": 500_000, "photo": "phone4.jpg"},
    "iphone_17_pm": {"name": "iPhone 17 Pro Max", "price": 1_500_000, "photo": "phone5.jpg"},
    "galaxy_zfold7": {"name": "Samsung Galaxy Z Fold 7", "price": 2_500_000, "photo": "phone6.jpg"},
}


# ================== БД ==================
def _init_tm_db():
    try:
        with db_conn() as conn:
            cur = conn.cursor()

            cur.execute("""
                CREATE TABLE IF NOT EXISTS user_devices (
                    user_id INTEGER PRIMARY KEY,
                    phone TEXT DEFAULT NULL,
                    phone_level TEXT DEFAULT NULL,
                    pc TEXT DEFAULT NULL,
                    pc_parts TEXT DEFAULT NULL,
                    tablet TEXT DEFAULT NULL,
                    youtube_channel_id INTEGER DEFAULT NULL
                )
            """)

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
                CREATE TABLE IF NOT EXISTS technomarket_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    action_type TEXT,
                    item_name TEXT,
                    amount INTEGER,
                    details TEXT,
                    created_at INTEGER
                )
            """)

            cur.execute("PRAGMA table_info(user_devices)")
            cols = {c[1] for c in cur.fetchall()}
            for col, col_type in (
                ("phone_buy_price", "INTEGER DEFAULT 0"),
                ("phone_buy_date", "INTEGER DEFAULT 0"),
            ):
                if col not in cols:
                    try:
                        cur.execute(f"ALTER TABLE user_devices ADD COLUMN {col} {col_type}")
                        logger.info("Добавлена колонка user_devices.%s", col)
                    except Exception as e:
                        logger.exception("Ошибка миграции %s: %s", col, e)

        logger.info("technomarket: таблицы инициализированы")
    except Exception as e:
        logger.exception("init_tm_db failed: %s", e)


_init_tm_db()


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


def get_user_devices(user_id: int):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM user_devices WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row:
                return None
            cols = [d[0] for d in cur.description]
            return dict(zip(cols, row))
    except Exception as e:
        logger.exception("get_user_devices failed: %s", e)
        return None


def get_user_sim_info(user_id: int):
    """Возвращает dict с SIM или None. Включает created_at — нужно для sim.py."""
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


def _add_history(user_id: int, action: str, item: str, amount: int = 0, details: str = ""):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO technomarket_history (user_id, action_type, item_name, amount, details, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (user_id, action, item, amount, details, int(time.time())))
    except Exception as e:
        logger.exception("_add_history failed: %s", e)


def _tm_log(user_id: int, user, action: str, **kwargs):
    try:
        log_action(
            user_id=user_id,
            username=getattr(user, "username", None),
            display_name=getattr(user, "full_name", None),
            action_type="TECHNOMARKET",
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
@router.message(F.text.casefold().in_({"техномаркет", "тм"}))
async def cmd_technomarket(message: types.Message):
    try:
        if not await _require_reg(message):
            return
        _tm_log(message.from_user.id, message.from_user, "open_menu")
        await _show_tm_menu(message, message.from_user.id)
    except Exception as e:
        logger.exception("cmd_technomarket failed: %s", e)


async def _show_tm_menu(target, user_id: int):
    try:
        balance = get_user_balance(user_id)
        devices = get_user_devices(user_id)
        sim = get_user_sim_info(user_id)

        phone = devices.get("phone") if devices and devices.get("phone") else "нет"
        sim_status = "активна" if sim else "нет"

        text = (
            "🏬 <b>Техномаркет</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"💰 Баланс: <b>{_fmt(balance)} UP</b>\n\n"
            f"📱 Телефон: <b>{_esc(phone)}</b>\n"
            f"📶 SIM: <b>{sim_status}</b>\n\n"
            "Выберите раздел:"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="📱 Телефоны", callback_data="tm_phones")],
                [types.InlineKeyboardButton(text="📶 SIM-карты", callback_data="tm_sim")],
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
        logger.exception("_show_tm_menu failed: %s", e)


@router.callback_query(F.data == "tm_back")
async def cb_tm_back(callback: types.CallbackQuery, state: FSMContext):
    try:
        try:
            await state.clear()
        except Exception:
            pass
        await _show_tm_menu(callback, callback.from_user.id)
    except Exception as e:
        logger.exception("cb_tm_back failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


# ================== СПИСОК ТЕЛЕФОНОВ ==================
@router.callback_query(F.data == "tm_phones")
async def cb_tm_phones(callback: types.CallbackQuery):
    try:
        _tm_log(callback.from_user.id, callback.from_user, "open_phones")
        rows = []
        for key, phone in PHONES.items():
            rows.append([types.InlineKeyboardButton(
                text=f"{phone['name']} — {_fmt(phone['price'])} UP",
                callback_data=f"tm_phone_{key}"
            )])
        rows.append([types.InlineKeyboardButton(text="🔙 Назад", callback_data="tm_back")])

        text = (
            "📱 <b>Телефоны</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            "Выберите телефон для просмотра:"
        )
        try:
            await callback.message.edit_text(
                text, parse_mode="HTML",
                reply_markup=types.InlineKeyboardMarkup(inline_keyboard=rows)
            )
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_tm_phones failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data.startswith("tm_phone_"))
async def cb_tm_phone_view(callback: types.CallbackQuery):
    try:
        key = (callback.data or "").replace("tm_phone_", "")
        phone = PHONES.get(key)
        if not phone:
            await callback.answer("❌ Телефон не найден", show_alert=True)
            return

        uid = callback.from_user.id
        balance = get_user_balance(uid)
        devices = get_user_devices(uid)
        has_phone = bool(devices and devices.get("phone"))

        text = (
            f"📱 <b>{_esc(phone['name'])}</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"💰 Цена: <b>{_fmt(phone['price'])} UP</b>\n"
            f"💵 Ваш баланс: <b>{_fmt(balance)} UP</b>"
        )
        if has_phone:
            text += "\n\n⚠️ <i>У вас уже есть телефон. Чтобы купить новый — сначала продайте текущий.</i>"

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="✅ Купить", callback_data=f"tm_buy_{key}")],
                [types.InlineKeyboardButton(text="🔙 Назад", callback_data="tm_phones")],
            ]
        )

        photo_path = PHOTOS_DIR / phone["photo"]
        sent = False
        if photo_path.exists():
            try:
                await callback.message.delete()
            except Exception:
                pass
            try:
                await callback.message.answer_photo(
                    photo=FSInputFile(str(photo_path)),
                    caption=text,
                    parse_mode="HTML",
                    reply_markup=kb,
                )
                sent = True
            except Exception as e:
                logger.warning("phone photo send error: %s", e)

        if not sent:
            try:
                await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                try:
                    await callback.message.answer(text, parse_mode="HTML", reply_markup=kb)
                except Exception:
                    pass
    except Exception as e:
        logger.exception("cb_tm_phone_view failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data.startswith("tm_buy_"))
async def cb_tm_buy(callback: types.CallbackQuery):
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        key = (callback.data or "").replace("tm_buy_", "")
        phone = PHONES.get(key)
        if not phone:
            await callback.answer("❌ Телефон не найден", show_alert=True)
            return

        price = phone["price"]

        # === Атомарная покупка с полной защитой ===
        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE")

                # защита от второго телефона
                cur.execute("SELECT phone FROM user_devices WHERE user_id = ?", (uid,))
                drow = cur.fetchone()
                if drow and drow[0]:
                    await callback.answer("❌ У вас уже есть телефон. Сначала продайте его.", show_alert=True)
                    return

                # баланс
                cur.execute("SELECT balance_up FROM users WHERE user_id = ?", (uid,))
                brow = cur.fetchone()
                if not brow:
                    await callback.answer("❌ Профиль не найден", show_alert=True)
                    return
                balance = int(brow[0] or 0)
                if balance < price:
                    await callback.answer(
                        f"❌ Недостаточно UP\nНужно: {_fmt(price)} UP", show_alert=True
                    )
                    return

                new_balance = balance - price
                cur.execute("UPDATE users SET balance_up = ? WHERE user_id = ?", (new_balance, uid))

                cur.execute("""
                    INSERT OR REPLACE INTO user_devices
                    (user_id, phone, phone_level, phone_buy_price, phone_buy_date)
                    VALUES (?, ?, ?, ?, ?)
                """, (uid, phone["name"], key, price, int(time.time())))
        except Exception as e:
            logger.exception("buy phone failed: %s", e)
            await callback.answer("⚠️ Ошибка покупки", show_alert=True)
            return

        _add_history(uid, "Покупка телефона", phone["name"], price)
        _tm_log(uid, callback.from_user, "buy_phone",
                balance_before=balance, balance_after=new_balance,
                extra_detail=f"phone={phone['name']} price={price}")

        text = (
            "✅ <b>Телефон куплен</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"📱 {_esc(phone['name'])}\n"
            f"💰 Списано: <b>{_fmt(price)} UP</b>\n"
            f"💵 Баланс: <b>{_fmt(new_balance)} UP</b>\n\n"
            "💡 Посмотреть — команда <b>Мой телефон</b>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="🔙 В техномаркет", callback_data="tm_back")]]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            try:
                await callback.message.answer(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                pass
        await callback.answer("✅ Куплено!")
    except Exception as e:
        logger.exception("cb_tm_buy failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


# ================== SIM-КАРТЫ ==================
@router.callback_query(F.data == "tm_sim")
async def cb_tm_sim(callback: types.CallbackQuery):
    try:
        uid = callback.from_user.id
        sim = get_user_sim_info(uid)

        if sim:
            text = (
                "📶 <b>SIM-карта</b>\n"
                "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
                f"📡 Оператор: <b>{_esc(sim['operator'])}</b>\n"
                f"📱 Номер: <code>{_esc(sim['phone_number'])}</code>\n"
                f"💰 Баланс: <b>{_fmt(sim['balance'])} UP</b>\n"
                f"🌐 Интернет: <b>{sim['internet_gb']} ГБ</b>\n\n"
                "💡 Управление — команда <b>Симкарта</b>"
            )
            kb = types.InlineKeyboardMarkup(
                inline_keyboard=[[types.InlineKeyboardButton(text="🔙 Назад", callback_data="tm_back")]]
            )
            try:
                await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                pass
            return

        text = (
            "📶 <b>SIM-карты</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"💰 Стоимость: <b>{_fmt(SIM_PRICE)} UP</b>\n\n"
            "Выберите оператора:"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="🔵 Beeline", callback_data="tm_sim_op_Beeline")],
                [types.InlineKeyboardButton(text="🟢 Tele2", callback_data="tm_sim_op_Tele2")],
                [types.InlineKeyboardButton(text="🔙 Назад", callback_data="tm_back")],
            ]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_tm_sim failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


def _gen_number(operator: str) -> str:
    prefixes = {
        "Beeline": ["777", "778", "779", "700", "701", "702"],
        "Tele2": ["707", "708", "709", "705", "706"],
    }
    prefix = random.choice(prefixes.get(operator, ["777"]))
    a = f"{random.randint(100, 999)}"
    b = f"{random.randint(10, 99)}"
    c = f"{random.randint(10, 99)}"
    return f"+7 {prefix} {a} {b} {c}"


@router.callback_query(F.data.startswith("tm_sim_op_"))
async def cb_tm_sim_op(callback: types.CallbackQuery):
    try:
        uid = callback.from_user.id
        operator = (callback.data or "").replace("tm_sim_op_", "")

        sim = get_user_sim_info(uid)
        if sim:
            await callback.answer("❌ У вас уже есть SIM-карта", show_alert=True)
            return

        devices = get_user_devices(uid)
        if not devices or not devices.get("phone"):
            await callback.answer("❌ Сначала купите телефон", show_alert=True)
            return

        balance = get_user_balance(uid)
        if balance < SIM_PRICE:
            await callback.answer(f"❌ Недостаточно UP (нужно {_fmt(SIM_PRICE)})", show_alert=True)
            return

        number = _gen_number(operator)
        for _ in range(20):
            try:
                with db_conn() as conn:
                    cur = conn.cursor()
                    cur.execute("SELECT 1 FROM sim_cards WHERE phone_number = ?", (number,))
                    if not cur.fetchone():
                        break
                number = _gen_number(operator)
            except Exception:
                break

        text = (
            "📱 <b>Новый номер</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"📡 Оператор: <b>{_esc(operator)}</b>\n"
            f"📞 Номер: <code>{_esc(number)}</code>\n"
            f"💰 Цена: <b>{_fmt(SIM_PRICE)} UP</b>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="✅ Купить", callback_data=f"tm_sim_buy_{operator}_{number}")],
                [types.InlineKeyboardButton(text="🔄 Другой номер", callback_data=f"tm_sim_op_{operator}")],
                [types.InlineKeyboardButton(text="❌ Отмена", callback_data="tm_sim")],
            ]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_tm_sim_op failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data.startswith("tm_sim_buy_"))
async def cb_tm_sim_buy(callback: types.CallbackQuery):
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        data = (callback.data or "").replace("tm_sim_buy_", "")
        if "_" not in data:
            await callback.answer()
            return
        operator, number = data.split("_", 1)

        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE")

                cur.execute("SELECT sim_id, active FROM user_sim WHERE user_id = ?", (uid,))
                row = cur.fetchone()
                if row and row[1]:
                    await callback.answer("❌ У вас уже есть SIM-карта", show_alert=True)
                    return

                cur.execute("SELECT balance_up FROM users WHERE user_id = ?", (uid,))
                brow = cur.fetchone()
                if not brow:
                    await callback.answer("❌ Профиль не найден", show_alert=True)
                    return
                balance = int(brow[0] or 0)
                if balance < SIM_PRICE:
                    await callback.answer("❌ Недостаточно UP", show_alert=True)
                    return

                cur.execute("UPDATE users SET balance_up = ? WHERE user_id = ?", (balance - SIM_PRICE, uid))

                cur.execute("""
                    INSERT INTO sim_cards (user_id, operator, phone_number, balance, internet_gb, internet_expire, created_at)
                    VALUES (?, ?, ?, 0, 0, 0, ?)
                """, (uid, operator, number, int(time.time())))
                sim_id = cur.lastrowid

                cur.execute("""
                    INSERT OR REPLACE INTO user_sim (user_id, sim_id, active)
                    VALUES (?, ?, 1)
                """, (uid, sim_id))
        except Exception as e:
            logger.exception("sim buy failed: %s", e)
            await callback.answer("⚠️ Ошибка покупки", show_alert=True)
            return

        _add_history(uid, "Покупка SIM", f"{operator} {number}", SIM_PRICE)
        _tm_log(uid, callback.from_user, "buy_sim",
                balance_before=balance, balance_after=balance - SIM_PRICE,
                extra_detail=f"{operator} {number}")

        text = (
            "✅ <b>SIM-карта куплена</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"📡 Оператор: <b>{_esc(operator)}</b>\n"
            f"📞 Номер: <code>{_esc(number)}</code>\n"
            f"💰 Списано: <b>{_fmt(SIM_PRICE)} UP</b>\n\n"
            "💡 Управление — команда <b>Симкарта</b>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="🔙 В техномаркет", callback_data="tm_back")]]
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
        await callback.answer("✅ Куплено!")
    except Exception as e:
        logger.exception("cb_tm_sim_buy failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


# ================== «МОЙ ТЕЛЕФОН» ==================
@router.message(F.text.casefold().in_({"мой телефон", "телефон", "мой тел"}))
async def cmd_my_phone(message: types.Message):
    try:
        if not await _require_reg(message):
            return
        uid = message.from_user.id
        devices = get_user_devices(uid)

        if not devices or not devices.get("phone"):
            await message.answer(
                "📱 <b>Мой телефон</b>\n\n"
                "К сожалению, у вас нет телефона.\n"
                "Купить его можно в <b>Техномаркет</b> — раздел «📱 Телефоны».",
                parse_mode="HTML",
            )
            return

        phone_name = devices.get("phone") or "—"
        phone_key = devices.get("phone_level") or ""

        phone_info = PHONES.get(phone_key)
        photo_file = phone_info["photo"] if phone_info else "phone.jpg"

        sim = get_user_sim_info(uid)
        if sim:
            sim_str = f"{_esc(sim['operator'])} · <code>{_esc(sim['phone_number'])}</code>"
        else:
            sim_str = "нет"

        text = (
            "📱 <b>Мой телефон</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"📱 Модель: <b>{_esc(phone_name)}</b>\n"
            f"📶 SIM: <b>{sim_str}</b>"
        )

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="💸 Продать телефон", callback_data=f"tm_sell_ask_{phone_key}")],
            ]
        )

        _tm_log(uid, message.from_user, "view_my_phone")

        photo_path = PHOTOS_DIR / photo_file
        if photo_path.exists():
            try:
                await message.answer_photo(
                    photo=FSInputFile(str(photo_path)),
                    caption=text,
                    parse_mode="HTML",
                    reply_markup=kb,
                )
                return
            except Exception as e:
                logger.warning("my phone photo send error: %s", e)

        await message.answer(text, parse_mode="HTML", reply_markup=kb)
    except Exception as e:
        logger.exception("cmd_my_phone failed: %s", e)


@router.callback_query(F.data.startswith("tm_sell_ask_"))
async def cb_tm_sell_ask(callback: types.CallbackQuery):
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        key = (callback.data or "").replace("tm_sell_ask_", "")
        devices = get_user_devices(uid)
        if not devices or not devices.get("phone"):
            await callback.answer("❌ У вас нет телефона", show_alert=True)
            return

        if devices.get("phone_level") != key:
            await callback.answer("⚠️ Этот телефон уже не активен", show_alert=True)
            return

        phone_buy_price = int(devices.get("phone_buy_price") or 0)
        if phone_buy_price <= 0:
            info = PHONES.get(key)
            phone_buy_price = info["price"] if info else 0

        sell_price = int(phone_buy_price * SELL_RATE)

        text = (
            "💸 <b>Продажа телефона</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"📱 {_esc(devices.get('phone'))}\n"
            f"💰 Вы получите: <b>{_fmt(sell_price)} UP</b>\n\n"
            "Подтвердить продажу?"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="✅ Продать", callback_data=f"tm_sell_yes_{key}_{sell_price}")],
                [types.InlineKeyboardButton(text="❌ Отмена", callback_data="tm_sell_cancel")],
            ]
        )
        try:
            await callback.message.edit_caption(caption=text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            try:
                await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                pass
    except Exception as e:
        logger.exception("cb_tm_sell_ask failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data == "tm_sell_cancel")
async def cb_tm_sell_cancel(callback: types.CallbackQuery):
    try:
        try:
            await callback.message.delete()
        except Exception:
            pass
        await callback.answer("Отменено")
    except Exception as e:
        logger.exception("cb_tm_sell_cancel failed: %s", e)


@router.callback_query(F.data.startswith("tm_sell_yes_"))
async def cb_tm_sell_yes(callback: types.CallbackQuery):
    try:
        uid = callback.from_user.id
        if not check_user_registered(uid):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        data = (callback.data or "").replace("tm_sell_yes_", "")
        try:
            key, sell_price_str = data.rsplit("_", 1)
            sell_price = int(sell_price_str)
        except (ValueError, AttributeError):
            await callback.answer("❌ Ошибка данных", show_alert=True)
            return

        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE")

                cur.execute("SELECT phone, phone_level FROM user_devices WHERE user_id = ?", (uid,))
                row = cur.fetchone()
                if not row or not row[0]:
                    await callback.answer("❌ У вас нет телефона", show_alert=True)
                    return
                phone_name = row[0]
                current_key = row[1]
                if current_key != key:
                    await callback.answer("⚠️ Этот телефон уже не активен", show_alert=True)
                    return

                cur.execute("SELECT balance_up FROM users WHERE user_id = ?", (uid,))
                brow = cur.fetchone()
                balance = int(brow[0] or 0) if brow else 0
                new_balance = balance + sell_price

                cur.execute("UPDATE users SET balance_up = ? WHERE user_id = ?", (new_balance, uid))

                cur.execute("""
                    UPDATE user_devices
                    SET phone = NULL, phone_level = NULL, phone_buy_price = 0, phone_buy_date = 0
                    WHERE user_id = ?
                """, (uid,))
        except Exception as e:
            logger.exception("sell phone failed: %s", e)
            await callback.answer("⚠️ Ошибка продажи", show_alert=True)
            return

        _add_history(uid, "Продажа телефона", phone_name, sell_price)
        _tm_log(uid, callback.from_user, "sell_phone",
                balance_before=balance, balance_after=new_balance,
                extra_detail=f"phone={phone_name} sell_price={sell_price}")

        text = (
            "💸 <b>Телефон продан</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"📱 {_esc(phone_name)}\n"
            f"💰 Получено: <b>+{_fmt(sell_price)} UP</b>\n"
            f"💵 Баланс: <b>{_fmt(new_balance)} UP</b>"
        )
        try:
            await callback.message.delete()
        except Exception:
            pass
        try:
            await callback.message.answer(text, parse_mode="HTML")
        except Exception:
            pass
        await callback.answer("✅ Продано!")
    except Exception as e:
        logger.exception("cb_tm_sell_yes failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass