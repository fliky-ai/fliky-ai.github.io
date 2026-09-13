import os
import sqlite3
from aiogram import Router, types, F
from database import DB_NAME, sqlite3 as sqlite_module

router = Router()

# ========== НАСТРОЙКА ==========
# ID владельца бота (только он может выдавать скины)
OWNER_ID = 8771009385

# Путь к папке со скинами
PHOTOS_DIR = os.path.join(os.path.dirname(__file__), "photos")

# Доступные скины (personage.jpg - personage6.jpg)
AVAILABLE_SKINS = {
    "1": "personage.jpg",
    "2": "personage2.jpg",
    "3": "personage3.jpg",
    "4": "personage4.jpg",
    "5": "personage5.jpg",
    "6": "personage6.jpg",
}

# ========== ИНИЦИАЛИЗАЦИЯ БД ==========
def init_testpers_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    # Добавляем колонку skin в таблицу users, если её нет
    cursor.execute("PRAGMA table_info(users)")
    columns = [col[1] for col in cursor.fetchall()]
    
    if "skin" not in columns:
        try:
            cursor.execute("ALTER TABLE users ADD COLUMN skin TEXT DEFAULT 'personage.jpg'")
        except Exception:
            pass
    
    conn.commit()
    conn.close()

init_testpers_db()

# ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
def get_user_nickname(user_id):
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("SELECT nickname FROM users WHERE user_id = ?", (user_id,))
        res = cursor.fetchone()
        conn.close()
        if res and res[0]:
            return res[0]
        return "Игрок"
    except Exception:
        return "Игрок"

def check_user_registered(user_id: int) -> bool:
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM users WHERE user_id = ?", (user_id,))
        res = cursor.fetchone()
        conn.close()
        return res is not None
    except Exception:
        return False

def set_user_skin(user_id, skin_file):
    """Устанавливает скин игроку (старый автоматически заменяется)"""
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("UPDATE users SET skin = ? WHERE user_id = ?", (skin_file, user_id))
        conn.commit()
        conn.close()
        return True
    except Exception:
        return False

def get_user_skin(user_id):
    """Возвращает текущий скин игрока"""
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(users)")
        cols = [col[1] for col in cursor.fetchall()]
        
        if "skin" not in cols:
            conn.close()
            return "personage.jpg"
        
        cursor.execute("SELECT skin FROM users WHERE user_id = ?", (user_id,))
        res = cursor.fetchone()
        conn.close()
        
        if res and res[0]:
            return res[0]
        return "personage.jpg"
    except Exception:
        return "personage.jpg"


# ========== КОМАНДА "СКИН" ==========
@router.message(F.text.lower().startswith("скин "))
async def cmd_skin(message: types.Message):
    user_id = message.from_user.id
    
    # Проверка на владельца
    if user_id != OWNER_ID:
        # Тихо игнорируем (или можешь отправить "недостаточно прав")
        return
    
    # Проверка что это reply на сообщение
    if not message.reply_to_message:
        await message.reply(
            "⚠️ <b>Использование:</b>\n\n"
            "Ответьте на сообщение игрока командой:\n"
            "<code>Скин [номер 1-6]</code>\n\n"
            "Пример: <code>Скин 3</code>",
            parse_mode="HTML"
        )
        return
    
    parts = message.text.split()
    if len(parts) < 2:
        await message.reply(
            "⚠️ <b>Укажите номер скина!</b>\n\n"
            "Пример: <code>Скин 3</code>\n\n"
            "Доступные скины: 1-6",
            parse_mode="HTML"
        )
        return
    
    skin_number = parts[1].strip()
    
    if skin_number not in AVAILABLE_SKINS:
        await message.reply(
            "❌ <b>Неверный номер скина!</b>\n\n"
            "Доступные: <code>1, 2, 3, 4, 5, 6</code>",
            parse_mode="HTML"
        )
        return
    
    # Получаем ID игрока из reply
    target_id = message.reply_to_message.from_user.id
    target_nick = get_user_nickname(target_id)
    
    # Проверка что игрок зарегистрирован
    if not check_user_registered(target_id):
        await message.reply(
            f"❌ <b>Игрок {target_nick} не зарегистрирован!</b>",
            parse_mode="HTML"
        )
        return
    
    # Проверка что игрок не бот
    if message.reply_to_message.from_user.is_bot:
        await message.reply(
            "❌ <b>Нельзя выдать скин боту!</b>",
            parse_mode="HTML"
        )
        return
    
    # Получаем старый скин
    old_skin = get_user_skin(target_id)
    
    # Устанавливаем новый скин (старый автоматически заменяется)
    skin_file = AVAILABLE_SKINS[skin_number]
    success = set_user_skin(target_id, skin_file)
    
    if not success:
        await message.reply(
            "❌ <b>Ошибка при выдаче скина!</b>\n\n"
            "Попробуйте позже.",
            parse_mode="HTML"
        )
        return
    
    # Проверяем что фото существует
    photo_path = os.path.join(PHOTOS_DIR, skin_file)
    
    if not os.path.exists(photo_path):
        await message.reply(
            f"⚠️ <b>Скин выдан, но фото не найдено:</b>\n"
            f"<code>{skin_file}</code>",
            parse_mode="HTML"
        )
        return
    
    # Отправляем уведомление в чат
    text = (
        f"✅ <b>Скин выдан!</b>\n\n"
        f"👤 <b>Игрок:</b> {target_nick}\n"
        f"🎨 <b>Скин:</b> #{skin_number}\n"
        f"📁 <b>Файл:</b> <code>{skin_file}</code>"
    )
    
    await message.reply(text, parse_mode="HTML")
    
    # Уведомляем игрока в ЛС
    try:
        from aiogram.types import FSInputFile
        photo = FSInputFile(photo_path)
        await message.bot.send_photo(
            target_id,
            photo=photo,
            caption=(
                f"🎨 <b>Вам выдан новый скин!</b>\n\n"
                f"👤 Игрок: <b>{target_nick}</b>\n"
                f"🎁 Скин: <b>#{skin_number}</b>\n\n"
                f"👇 Напишите <code>Б</code> чтобы увидеть его в балансе"
            ),
            parse_mode="HTML"
        )
    except Exception as e:
        print(f"Skin notification error: {e}")