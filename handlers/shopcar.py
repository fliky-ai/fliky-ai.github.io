import time
import logging
from pathlib import Path
from aiogram import Router, types, F
from aiogram.fsm.context import FSMContext
from aiogram.types import FSInputFile

from database import db_conn, check_user_registered, get_user, DEFAULT_NICK, log_action

logger = logging.getLogger(__name__)
router = Router()

PHOTOS_DIR = Path(__file__).resolve().parent / "photos"

_car_file_ids = {}
_buy_locks = set()


# ================== КАТАЛОГ АВТО ==================
CARS = [
    {"key": "toyota_camry", "name": "Toyota Camry", "emoji": "🚘", "hp": 200, "speed": 210, "price": 150_000, "photo": "car2.jpg"},
    {"key": "bmw_m3",       "name": "BMW M3",       "emoji": "🏎️", "hp": 510, "speed": 290, "price": 500_000, "photo": "car.jpg"},
    {"key": "mercedes_c63", "name": "Mercedes C63", "emoji": "🏎️", "hp": 650, "speed": 300, "price": 850_000, "photo": "car3.jpg"},
    {"key": "porsche_911",  "name": "Porsche 911",  "emoji": "🏁", "hp": 650, "speed": 330, "price": 1_500_000, "photo": "car4.jpg"},
    {"key": "g_class",      "name": "G-Class",      "emoji": "🛡️", "hp": 585, "speed": 240, "price": 1_200_000, "photo": "car5.jpg"},
]

CAR_BY_KEY = {c["key"]: c for c in CARS}


# ================== БД ==================
def _init_cars_db():
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS user_cars (
                    user_id INTEGER PRIMARY KEY,
                    car_key TEXT,
                    car_name TEXT,
                    bought_price INTEGER DEFAULT 0,
                    bought_at INTEGER DEFAULT 0
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS cars_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    action_type TEXT,
                    car_key TEXT,
                    car_name TEXT,
                    amount INTEGER DEFAULT 0,
                    created_at INTEGER
                )
            """)

            # === МИГРАЦИЯ: добавляем недостающие колонки ===
            cur.execute("PRAGMA table_info(user_cars)")
            cols = {c[1] for c in cur.fetchall()}
            required = {
                "car_key": "TEXT",
                "car_name": "TEXT",
                "bought_price": "INTEGER DEFAULT 0",
                "bought_at": "INTEGER DEFAULT 0",
            }
            for col, ct in required.items():
                if col not in cols:
                    try:
                        cur.execute(f"ALTER TABLE user_cars ADD COLUMN {col} {ct}")
                        logger.info("user_cars: добавлена колонка %s", col)
                    except Exception as e:
                        logger.exception("миграция user_cars.%s: %s", col, e)

            # фикс старых записей
            try:
                cur.execute("UPDATE user_cars SET car_key = 'toyota_camry' WHERE car_key IS NULL OR car_key = ''")
                cur.execute("UPDATE user_cars SET car_name = 'Toyota Camry' WHERE car_name IS NULL OR car_name = ''")
            except Exception:
                pass

            cur.execute("CREATE INDEX IF NOT EXISTS idx_cars_hist_user ON cars_history(user_id, id DESC)")
        logger.info("shopcar: таблицы готовы")
    except Exception as e:
        logger.exception("init_cars_db failed: %s", e)


_init_cars_db()


# ================== УТИЛИТЫ ==================
def _fmt(n) -> str:
    try:
        return f"{int(n):,}".replace(",", " ")
    except (TypeError, ValueError):
        return "0"


def _esc(s) -> str:
    return (str(s) if s is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _balance(user_id: int) -> int:
    try:
        u = get_user(user_id) or {}
        return int(u.get("balance_up") or 0)
    except Exception:
        return 0


def get_user_car(user_id: int):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT car_key, car_name, bought_price, bought_at FROM user_cars WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row:
                return None
            return {
                "key": row[0],
                "name": row[1],
                "bought_price": int(row[2] or 0),
                "bought_at": int(row[3] or 0),
            }
    except Exception as e:
        logger.exception("get_user_car failed: %s", e)
        return None


def _add_history(user_id: int, action: str, car_key: str, car_name: str, amount: int = 0):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO cars_history (user_id, action_type, car_key, car_name, amount, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (user_id, action, car_key, car_name, amount, int(time.time())))
    except Exception as e:
        logger.exception("_add_history failed: %s", e)


def _car_log(user_id: int, user, action: str, **kwargs):
    try:
        log_action(
            user_id=user_id,
            username=getattr(user, "username", None),
            display_name=getattr(user, "full_name", None),
            action_type="CAR",
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
                "💡 Перейдите в <b>личные сообщения</b> бота и нажмите /start.",
                parse_mode="HTML",
            )
        except Exception:
            pass
    return False


# ================== РЕНДЕР КАРТОЧКИ ==================
def _car_card_text(car: dict, idx: int, total: int) -> str:
    return (
        f"{car['emoji']} <b>{_esc(car['name'])}</b>\n"
        f"<i>{idx + 1} / {total}</i>\n"
        "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        f"🐎 Лошадиные силы: <b>{car['hp']}</b>\n"
        f"🚀 Максимальная скорость: <b>{car['speed']} км/ч</b>\n"
        f"💰 Стоимость: <b>{_fmt(car['price'])} UP</b>"
    )


def _car_card_kb(idx: int, total: int) -> types.InlineKeyboardMarkup:
    rows = [[types.InlineKeyboardButton(text="✅ Приобрести", callback_data=f"shopcar_buy_{idx}")]]
    nav = []
    if idx > 0:
        nav.append(types.InlineKeyboardButton(text="⬅️", callback_data=f"shopcar_nav_{idx - 1}"))
    nav.append(types.InlineKeyboardButton(text=f"{idx + 1} / {total}", callback_data="shopcar_none"))
    if idx < total - 1:
        nav.append(types.InlineKeyboardButton(text="➡️", callback_data=f"shopcar_nav_{idx + 1}"))
    rows.append(nav)
    return types.InlineKeyboardMarkup(inline_keyboard=rows)


async def _render_car(target, idx: int, edit: bool = True):
    try:
        total = len(CARS)
        idx = max(0, min(total - 1, idx))
        car = CARS[idx]
        car_key = car["key"]

        text = _car_card_text(car, idx, total)
        kb = _car_card_kb(idx, total)

        photo_path = PHOTOS_DIR / car["photo"]
        cached_id = _car_file_ids.get(car_key)

        if cached_id:
            media_src = cached_id
            has_photo = True
        elif photo_path.exists():
            media_src = FSInputFile(str(photo_path))
            has_photo = True
        else:
            media_src = None
            has_photo = False

        if isinstance(target, types.CallbackQuery):
            msg = target.message

            if has_photo:
                from aiogram.types import InputMediaPhoto
                try:
                    await msg.edit_media(
                        media=InputMediaPhoto(media=media_src, caption=text, parse_mode="HTML"),
                        reply_markup=kb,
                    )
                    return
                except Exception:
                    pass

                try:
                    await msg.delete()
                except Exception:
                    pass
                try:
                    sent = await msg.answer_photo(
                        photo=media_src, caption=text, parse_mode="HTML", reply_markup=kb,
                    )
                    try:
                        if sent.photo:
                            _car_file_ids[car_key] = sent.photo[-1].file_id
                    except Exception:
                        pass
                    return
                except Exception:
                    pass

            try:
                await msg.edit_text(text, parse_mode="HTML", reply_markup=kb)
                return
            except Exception:
                try:
                    await msg.delete()
                except Exception:
                    pass
                try:
                    await msg.answer(text, parse_mode="HTML", reply_markup=kb)
                    return
                except Exception:
                    pass
        else:
            if has_photo:
                try:
                    sent = await target.answer_photo(
                        photo=media_src, caption=text, parse_mode="HTML", reply_markup=kb,
                    )
                    try:
                        if sent.photo:
                            _car_file_ids[car_key] = sent.photo[-1].file_id
                    except Exception:
                        pass
                    return
                except Exception:
                    pass
            await target.answer(text, parse_mode="HTML", reply_markup=kb)
    except Exception as e:
        logger.exception("_render_car failed: %s", e)


# ================== ГЛАВНАЯ КОМАНДА ==================
@router.message(F.text.casefold().in_({"автосалон", "shopcar", "🚘 автосалон"}))
async def cmd_shopcar(message: types.Message):
    try:
        if not await _require_reg(message):
            return
        uid = message.from_user.id
        _car_log(uid, message.from_user, "open_shop")

        existing = get_user_car(uid)
        if existing:
            car_info = CAR_BY_KEY.get(existing["key"])
            emoji = car_info["emoji"] if car_info else "🚘"
            await message.answer(
                f"🚘 <b>У вас уже есть машина</b>\n\n"
                f"{emoji} <b>{_esc(existing['name'])}</b>\n\n"
                "Чтобы купить новую — сначала продайте текущую.\n"
                "Напишите: <b>Моя машина</b>",
                parse_mode="HTML",
            )
            return

        await _render_car(message, 0, edit=False)
    except Exception as e:
        logger.exception("cmd_shopcar failed: %s", e)


# ================== НАВИГАЦИЯ ==================
@router.callback_query(F.data == "shopcar_none")
async def cb_shopcar_none(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_shopcar_none failed: %s", e)


@router.callback_query(F.data.startswith("shopcar_nav_"))
async def cb_shopcar_nav(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        try:
            idx = int((callback.data or "").replace("shopcar_nav_", ""))
        except ValueError:
            return
        await _render_car(callback, idx, edit=True)
    except Exception as e:
        logger.exception("cb_shopcar_nav failed: %s", e)


# ================== ОКНО ПОДТВЕРЖДЕНИЯ ==================
@router.callback_query(F.data.startswith("shopcar_buy_"))
async def cb_shopcar_buy(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass

        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        try:
            idx = int((callback.data or "").replace("shopcar_buy_", ""))
        except ValueError:
            return
        if idx < 0 or idx >= len(CARS):
            return

        if get_user_car(uid):
            try:
                await callback.answer("У вас уже есть машина", show_alert=True)
            except Exception:
                pass
            return

        car = CARS[idx]
        price = car["price"]

        text = (
            "🚘 <b>Покупка автомобиля</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"{car['emoji']} Автомобиль: <b>{_esc(car['name'])}</b>\n"
            f"💰 Стоимость: <b>{_fmt(price)} UP</b>\n\n"
            "Подтвердить покупку?"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="✅ Подтвердить покупку", callback_data=f"shopcar_confirm_{idx}")],
                [types.InlineKeyboardButton(text="❌ Отмена", callback_data=f"shopcar_back_{idx}")],
            ]
        )
        try:
            await callback.message.edit_caption(caption=text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            try:
                await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                try:
                    await callback.message.answer(text, parse_mode="HTML", reply_markup=kb)
                except Exception:
                    pass
    except Exception as e:
        logger.exception("cb_shopcar_buy failed: %s", e)
        try:
            await callback.answer("⚠️ Ошибка", show_alert=True)
        except Exception:
            pass


# ================== ОТМЕНА ==================
@router.callback_query(F.data.startswith("shopcar_back_"))
async def cb_shopcar_back(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass
        uid = callback.from_user.id
        if not check_user_registered(uid):
            return
        try:
            idx = int((callback.data or "").replace("shopcar_back_", ""))
        except ValueError:
            idx = 0
        await _render_car(callback, idx, edit=True)
    except Exception as e:
        logger.exception("cb_shopcar_back failed: %s", e)


# ================== РЕАЛЬНАЯ ПОКУПКА ==================
@router.callback_query(F.data.startswith("shopcar_confirm_"))
async def cb_shopcar_confirm(callback: types.CallbackQuery):
    try:
        try:
            await callback.answer()
        except Exception:
            pass

        uid = callback.from_user.id
        if not check_user_registered(uid):
            return

        # lock от двойного нажатия
        lock_key = f"shopcar_buy_{uid}"
        if lock_key in _buy_locks:
            return
        _buy_locks.add(lock_key)

        try:
            try:
                idx = int((callback.data or "").replace("shopcar_confirm_", ""))
            except ValueError:
                return
            if idx < 0 or idx >= len(CARS):
                return

            # берём цену из каталога, не из callback
            car = CARS[idx]
            price = int(car["price"])

            success = False
            reason = ""
            new_balance = 0

            try:
                with db_conn() as conn:
                    cur = conn.cursor()
                    cur.execute("BEGIN IMMEDIATE")

                    cur.execute("SELECT car_key FROM user_cars WHERE user_id = ?", (uid,))
                    if cur.fetchone():
                        reason = "already_has_car"
                    else:
                        cur.execute("SELECT balance_up FROM users WHERE user_id = ?", (uid,))
                        brow = cur.fetchone()
                        if not brow:
                            reason = "no_user"
                        else:
                            balance = int(brow[0] or 0)
                            if balance < price:
                                reason = "insufficient"
                            else:
                                new_balance = balance - price
                                cur.execute(
                                    "UPDATE users SET balance_up = ? WHERE user_id = ?",
                                    (new_balance, uid)
                                )
                                cur.execute("""
                                    INSERT OR REPLACE INTO user_cars
                                    (user_id, car_key, car_name, bought_price, bought_at)
                                    VALUES (?, ?, ?, ?, ?)
                                """, (uid, car["key"], car["name"], price, int(time.time())))
                                success = True
            except Exception as e:
                logger.exception("shopcar_confirm transaction failed: %s", e)
                reason = "db_error"

            if not success:
                if reason == "already_has_car":
                    text = (
                        "❌ <b>Покупка невозможна</b>\n\n"
                        "🚘 У вас уже есть личный автомобиль."
                    )
                elif reason == "insufficient":
                    text = (
                        "❌ <b>Покупка невозможна</b>\n\n"
                        "💰 Недостаточно UP для покупки этого автомобиля."
                    )
                elif reason == "no_user":
                    text = "⚠️ Профиль не найден. Напишите /start."
                else:
                    text = "⚠️ Ошибка БД. Попробуйте позже."

                try:
                    await callback.message.edit_caption(caption=text, parse_mode="HTML")
                except Exception:
                    try:
                        await callback.message.edit_text(text, parse_mode="HTML")
                    except Exception:
                        try:
                            await callback.message.answer(text, parse_mode="HTML")
                        except Exception:
                            pass
                try:
                    await callback.answer(
                        "У вас уже есть машина" if reason == "already_has_car" else
                        "Недостаточно UP" if reason == "insufficient" else
                        "Ошибка",
                        show_alert=True,
                    )
                except Exception:
                    pass
                return

            # === успех ===
            _add_history(uid, "buy", car["key"], car["name"], price)
            _car_log(uid, callback.from_user, "buy_car",
                     balance_before=new_balance + price,
                     balance_after=new_balance,
                     extra_detail=f"car={car['name']} price={price}")

            text = (
                "✅ <b>Автомобиль приобретён!</b>\n"
                "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
                f"{car['emoji']} <b>{_esc(car['name'])}</b>\n"
                f"💰 Потрачено: <b>{_fmt(price)} UP</b>\n"
                f"💵 Баланс: <b>{_fmt(new_balance)} UP</b>\n\n"
                "🚘 Автомобиль добавлен в ваш гараж."
            )
            kb = types.InlineKeyboardMarkup(
                inline_keyboard=[
                    [types.InlineKeyboardButton(text="🚘 Моя машина", callback_data="mycar_show")],
                ]
            )
            try:
                await callback.message.edit_caption(caption=text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                try:
                    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
                except Exception:
                    try:
                        await callback.message.answer(text, parse_mode="HTML", reply_markup=kb)
                    except Exception:
                        pass

            try:
                await callback.answer("Куплено!")
            except Exception:
                pass
        finally:
            async def _release():
                import asyncio
                await asyncio.sleep(5)
                _buy_locks.discard(lock_key)
            try:
                import asyncio
                asyncio.create_task(_release())
            except Exception:
                _buy_locks.discard(lock_key)
    except Exception as e:
        logger.exception("cb_shopcar_confirm failed: %s", e)
        try:
            await callback.answer("⚠️ Ошибка", show_alert=True)
        except Exception:
            pass