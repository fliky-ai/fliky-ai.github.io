import os
from aiogram import Router, types, F
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import FSInputFile
from database import sqlite3, DB_NAME

router = Router()

PHOTOS_DIR = os.path.join(os.path.dirname(__file__), "photos")

# ========== ДАННЫЕ ПЕРСОНАЖЕЙ ==========
PERSONAGES = {
    "bomzh": {
        "name": "🧙 Бомж",
        "photo": "personage.jpg",
        "rarity": "⚪ Обычный",
        "price": 0,
        "description": "Начальный персонаж. Достаётся всем при старте."
    },
    "novice": {
        "name": "🌱 Начинающий",
        "photo": "personage2.jpg",
        "rarity": "🟢 Необычный",
        "price": 10000,
        "description": "Первый шаг к успеху."
    },
    "starter": {
        "name": "💼 Стартовый",
        "photo": "personage3.jpg",
        "rarity": "🔵 Редкий",
        "price": 50000,
        "description": "Уверенный старт в игре."
    },
    "student": {
        "name": "📚 Ученик",
        "photo": "personage4.jpg",
        "rarity": "🟣 Эпический",
        "price": 150000,
        "description": "Ученик, познавший силу UP."
    },
    "citizen": {
        "name": "🏙 Городской",
        "photo": "personage5.jpg",
        "rarity": "🟠 Легендарный",
        "price": 500000,
        "description": "Уважаемый житель города."
    },
    "titan": {
        "name": "👑 Титан",
        "photo": "personage6.jpg",
        "rarity": "🔴 Мифический",
        "price": 2000000,
        "description": "Властелин всего UPGRADE."
    },
}

# ========== ИНИЦИАЛИЗАЦИЯ БД ==========
def init_personages_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_wardrobe (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            personage_id TEXT,
            bought_at INTEGER,
            UNIQUE(user_id, personage_id)
        )
    """)
    
    cursor.execute("PRAGMA table_info(users)")
    cols = [col[1] for col in cursor.fetchall()]
    if "skin" not in cols:
        try:
            cursor.execute("ALTER TABLE users ADD COLUMN skin TEXT DEFAULT 'personage.jpg'")
        except Exception:
            pass
    
    conn.commit()
    conn.close()

init_personages_db()

# ========== ВСПОМОГАТЕЛЬНЫЕ ==========
def check_user_registered(user_id):
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM users WHERE user_id = ?", (user_id,))
        res = cursor.fetchone()
        conn.close()
        return res is not None
    except Exception:
        return False

def get_user_balance(user_id):
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("SELECT balance_up FROM users WHERE user_id = ?", (user_id,))
        res = cursor.fetchone()
        conn.close()
        return res[0] if res else 0
    except Exception:
        return 0

def update_balance(user_id, amount):
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("UPDATE users SET balance_up = balance_up + ? WHERE user_id = ?", (amount, user_id))
        conn.commit()
        conn.close()
        return True
    except Exception:
        return False

def get_user_skin(user_id):
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("SELECT skin FROM users WHERE user_id = ?", (user_id,))
        res = cursor.fetchone()
        conn.close()
        if res and res[0]:
            return res[0]
        return "personage.jpg"
    except Exception:
        return "personage.jpg"

def set_user_skin(user_id, skin_file):
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("UPDATE users SET skin = ? WHERE user_id = ?", (skin_file, user_id))
        conn.commit()
        conn.close()
        return True
    except Exception:
        return False

def get_user_wardrobe(user_id):
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("SELECT personage_id FROM user_wardrobe WHERE user_id = ?", (user_id,))
        rows = cursor.fetchall()
        conn.close()
        return [row[0] for row in rows]
    except Exception:
        return []

def add_to_wardrobe(user_id, personage_id):
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR IGNORE INTO user_wardrobe (user_id, personage_id, bought_at)
            VALUES (?, ?, strftime('%s','now'))
        """, (user_id, personage_id))
        conn.commit()
        conn.close()
        return True
    except Exception:
        return False

def has_personage(user_id, personage_id):
    return personage_id in get_user_wardrobe(user_id)

def format_number(num):
    return f"{num:,}".replace(",", " ")

async def safe_edit_photo(message, photo_path, caption, reply_markup=None):
    """Универсальное редактирование фото-сообщения с текстом"""
    try:
        if os.path.exists(photo_path):
            photo = FSInputFile(photo_path)
            try:
                await message.edit_media(
                    media=types.InputMediaPhoto(media=photo, caption=caption, parse_mode="HTML"),
                    reply_markup=reply_markup
                )
                return True
            except Exception:
                # Если не удалось — удаляем и отправляем новое
                try:
                    await message.delete()
                except Exception:
                    pass
                await message.answer_photo(photo=photo, caption=caption, parse_mode="HTML", reply_markup=reply_markup)
                return True
        else:
            try:
                await message.edit_text(caption, parse_mode="HTML", reply_markup=reply_markup)
                return True
            except Exception:
                try:
                    await message.delete()
                except Exception:
                    pass
                await message.answer(caption, parse_mode="HTML", reply_markup=reply_markup)
                return True
    except Exception as e:
        print(f"safe_edit_photo error: {e}")
        return False

# ========== МАГАЗИН ПЕРСОНАЖЕЙ ==========
@router.message(F.text.casefold().in_({"персонаж", "персонажи", "personage"}))
async def cmd_personages(message: types.Message):
    user_id = message.from_user.id
    
    if not check_user_registered(user_id):
        if message.chat.type != "private":
            return
        await message.answer(
            "❌ <b>Вы еще не зарегистрированы!</b>\n\n"
            "💡 Напишите /start в личных сообщениях.",
            parse_mode="HTML"
        )
        return
    
    text = (
        "🧑‍🚀 <b>ВЫБОР ПЕРСОНАЖА</b>\n\n"
        "Выберите персонажа:"
    )
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="🧙 Бомж", callback_data="pers_info_bomzh")],
            [types.InlineKeyboardButton(text="🌱 Начинающий", callback_data="pers_info_novice")],
            [types.InlineKeyboardButton(text="💼 Стартовый", callback_data="pers_info_starter")],
            [types.InlineKeyboardButton(text="📚 Ученик", callback_data="pers_info_student")],
            [types.InlineKeyboardButton(text="🏙 Городской", callback_data="pers_info_citizen")],
            [types.InlineKeyboardButton(text="👑 Титан", callback_data="pers_info_titan")],
        ]
    )
    
    await message.answer(text, parse_mode="HTML", reply_markup=kb)

# ========== ИНФО О ПЕРСОНАЖЕ ==========
@router.callback_query(F.data.startswith("pers_info_"))
async def pers_info(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    personage_id = callback.data.replace("pers_info_", "")
    
    personage = PERSONAGES.get(personage_id)
    if not personage:
        await callback.answer("❌ Персонаж не найден!", show_alert=True)
        return
    
    owned = has_personage(user_id, personage_id)
    current_skin = get_user_skin(user_id)
    is_wearing = (current_skin == personage["photo"])
    
    text = (
        f"🎭 <b>{personage['name']}</b>\n\n"
        f"📖 <b>Описание:</b>\n{personage['description']}\n\n"
        f"⭐ <b>Редкость:</b> {personage['rarity']}\n"
        f"💰 <b>Цена:</b> {format_number(personage['price'])} UP"
    )
    
    kb_buttons = []
    
    if is_wearing:
        text += "\n\n✅ <b>Сейчас надет</b>"
        kb_buttons.append([types.InlineKeyboardButton(text="⬅️ Назад", callback_data="pers_back")])
    elif owned:
        text += "\n\n✅ <b>Уже куплен</b>"
        kb_buttons.append([types.InlineKeyboardButton(text="👕 Надеть", callback_data=f"pers_wear_{personage_id}")])
        kb_buttons.append([types.InlineKeyboardButton(text="⬅️ Назад", callback_data="pers_back")])
    else:
        kb_buttons.append([types.InlineKeyboardButton(text="🛒 Купить", callback_data=f"pers_buy_{personage_id}")])
        kb_buttons.append([types.InlineKeyboardButton(text="⬅️ Назад", callback_data="pers_back")])
    
    kb = types.InlineKeyboardMarkup(inline_keyboard=kb_buttons)
    
    photo_path = os.path.join(PHOTOS_DIR, personage["photo"])
    await safe_edit_photo(callback.message, photo_path, text, kb)
    await callback.answer()

# ========== ПОДТВЕРЖДЕНИЕ ПОКУПКИ ==========
@router.callback_query(F.data.startswith("pers_buy_"))
async def pers_buy_confirm(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    personage_id = callback.data.replace("pers_buy_", "")
    
    personage = PERSONAGES.get(personage_id)
    if not personage:
        await callback.answer("❌ Ошибка!", show_alert=True)
        return
    
    if has_personage(user_id, personage_id):
        await callback.answer("❌ Уже куплено!", show_alert=True)
        return
    
    balance = get_user_balance(user_id)
    if balance < personage["price"]:
        await callback.answer(
            f"❌ Недостаточно!\nНужно: {format_number(personage['price'])} UP",
            show_alert=True
        )
        return
    
    text = (
        f"❓ <b>Вы уверены, что хотите купить?</b>\n\n"
        f"🎭 Персонаж: <b>{personage['name']}</b>\n"
        f"⭐ Редкость: {personage['rarity']}\n"
        f"💰 Цена: <b>{format_number(personage['price'])} UP</b>\n\n"
        f"💵 Ваш баланс: <b>{format_number(balance)} UP</b>"
    )
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="✅ Да, купить", callback_data=f"pers_confirm_{personage_id}")],
            [types.InlineKeyboardButton(text="⬅️ Назад", callback_data=f"pers_info_{personage_id}")]
        ]
    )
    
    photo_path = os.path.join(PHOTOS_DIR, personage["photo"])
    await safe_edit_photo(callback.message, photo_path, text, kb)
    await callback.answer()

# ========== ПОКУПКА ==========
@router.callback_query(F.data.startswith("pers_confirm_"))
async def pers_confirm_buy(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    personage_id = callback.data.replace("pers_confirm_", "")
    
    personage = PERSONAGES.get(personage_id)
    if not personage:
        await callback.answer("❌ Ошибка!", show_alert=True)
        return
    
    if has_personage(user_id, personage_id):
        await callback.answer("❌ Уже куплено!", show_alert=True)
        return
    
    balance = get_user_balance(user_id)
    if balance < personage["price"]:
        await callback.answer("❌ Недостаточно средств!", show_alert=True)
        return
    
    update_balance(user_id, -personage["price"])
    add_to_wardrobe(user_id, personage_id)
    
    text = (
        f"🎉 <b>Покупка выполнена!</b>\n\n"
        f"🎭 Вы приобрели: <b>{personage['name']}</b>\n"
        f"💰 Потрачено: <b>{format_number(personage['price'])} UP</b>\n\n"
        f"🎒 Персонаж добавлен в гардероб!"
    )
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="⬅️ В магазин", callback_data="pers_back")]
        ]
    )
    
    photo_path = os.path.join(PHOTOS_DIR, personage["photo"])
    await safe_edit_photo(callback.message, photo_path, text, kb)
    await callback.answer("✅ Куплено!")

# ========== НАДЕТЬ ==========
@router.callback_query(F.data.startswith("pers_wear_"))
async def pers_wear(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    personage_id = callback.data.replace("pers_wear_", "")
    
    personage = PERSONAGES.get(personage_id)
    if not personage:
        await callback.answer("❌ Ошибка!", show_alert=True)
        return
    
    if not has_personage(user_id, personage_id):
        await callback.answer("❌ У вас нет этого персонажа!", show_alert=True)
        return
    
    set_user_skin(user_id, personage["photo"])
    
    text = (
        f"✅ <b>Персонаж надет!</b>\n\n"
        f"🎭 Теперь вы: <b>{personage['name']}</b>"
    )
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="⬅️ В магазин", callback_data="pers_back")]
        ]
    )
    
    photo_path = os.path.join(PHOTOS_DIR, personage["photo"])
    await safe_edit_photo(callback.message, photo_path, text, kb)
    await callback.answer("✅ Надет!")

# ========== НАЗАД В МАГАЗИН ==========
@router.callback_query(F.data == "pers_back")
async def pers_back(callback: types.CallbackQuery):
    text = (
        "🧑‍🚀 <b>ВЫБОР ПЕРСОНАЖА</b>\n\n"
        "Выберите персонажа:"
    )
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="🧙 Бомж", callback_data="pers_info_bomzh")],
            [types.InlineKeyboardButton(text="🌱 Начинающий", callback_data="pers_info_novice")],
            [types.InlineKeyboardButton(text="💼 Стартовый", callback_data="pers_info_starter")],
            [types.InlineKeyboardButton(text="📚 Ученик", callback_data="pers_info_student")],
            [types.InlineKeyboardButton(text="🏙 Городской", callback_data="pers_info_citizen")],
            [types.InlineKeyboardButton(text="👑 Титан", callback_data="pers_info_titan")],
        ]
    )
    
    # Пробуем отредактировать сообщение (убираем фото)
    try:
        await callback.message.delete()
    except Exception:
        pass
    
    await callback.message.answer(text, parse_mode="HTML", reply_markup=kb)
    await callback.answer()

# ========== ГАРДЕРОБ ==========
@router.callback_query(F.data == "wardrobe_open")
async def wardrobe_open(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    
    wardrobe = get_user_wardrobe(user_id)
    
    # Бомж есть у всех по умолчанию
    if "bomzh" not in wardrobe:
        wardrobe.insert(0, "bomzh")
    
    current_skin = get_user_skin(user_id)
    
    text = "🎒 <b>ВАШ ГАРДЕРОБ</b>\n\n"
    
    kb_buttons = []
    for pid in wardrobe:
        personage = PERSONAGES.get(pid)
        if not personage:
            continue
        
        is_wearing = (current_skin == personage["photo"])
        prefix = "✅ " if is_wearing else "     "
        
        kb_buttons.append([
            types.InlineKeyboardButton(
                text=f"{prefix}{personage['name']}",
                callback_data=f"wardrobe_view_{pid}"
            )
        ])
    
    kb_buttons.append([types.InlineKeyboardButton(text="⬅️ Назад", callback_data="main_menu")])
    
    kb = types.InlineKeyboardMarkup(inline_keyboard=kb_buttons)
    
    # Редактируем сообщение (убираем фото профиля)
    try:
        await callback.message.delete()
    except Exception:
        pass
    
    await callback.message.answer(text, parse_mode="HTML", reply_markup=kb)
    await callback.answer()

@router.callback_query(F.data.startswith("wardrobe_view_"))
async def wardrobe_view(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    personage_id = callback.data.replace("wardrobe_view_", "")
    
    personage = PERSONAGES.get(personage_id)
    if not personage:
        await callback.answer("❌ Ошибка!", show_alert=True)
        return
    
    current_skin = get_user_skin(user_id)
    is_wearing = (current_skin == personage["photo"])
    
    text = (
        f"🎭 <b>{personage['name']}</b>\n\n"
        f"📖 {personage['description']}\n\n"
        f"⭐ <b>Редкость:</b> {personage['rarity']}"
    )
    
    if is_wearing:
        text += "\n\n✅ <b>Сейчас надет</b>"
    
    kb_buttons = []
    
    if not is_wearing:
        kb_buttons.append([types.InlineKeyboardButton(text="👕 Надеть", callback_data=f"pers_wear_{personage_id}")])
    
    kb_buttons.append([types.InlineKeyboardButton(text="⬅️ В гардероб", callback_data="wardrobe_open")])
    
    kb = types.InlineKeyboardMarkup(inline_keyboard=kb_buttons)
    
    photo_path = os.path.join(PHOTOS_DIR, personage["photo"])
    await safe_edit_photo(callback.message, photo_path, text, kb)
    await callback.answer()