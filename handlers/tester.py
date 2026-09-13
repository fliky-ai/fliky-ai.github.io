from aiogram import Router, types, F
from database import sqlite3, DB_NAME

router = Router()

def check_user_registered(user_id: int) -> bool:
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT 1 FROM users WHERE user_id = ?", (user_id,))
    res = cursor.fetchone()
    conn.close()
    return res is not None

@router.message(F.text.casefold().in_({"выдать", "тест", "/givetester", "💎 тест баланс"}))
async def cmd_givetester(message: types.Message):
    user_id = message.from_user.id
    
    # Проверяем зарегистрирован ли пользователь
    if not check_user_registered(user_id):
        # Если сообщение в группе - просто игнорируем
        if message.chat.type != "private":
            return
        # Если в личке - показываем сообщение о регистрации
        await message.answer(
            "❌ <b>Вы еще не зарегистрированы!</b>\n\n"
            "💡 Пожалуйста, перейдите в <b>личные сообщения</b> бота и нажмите /start, чтобы активировать игровой профиль!",
            parse_mode="HTML"
        )
        return

    amount = 50000

    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    # Проверяем, есть ли таблица users и пользователь в ней
    cursor.execute("SELECT balance_up FROM users WHERE user_id = ?", (user_id,))
    res = cursor.fetchone()
    
    if not res:
        # Если пользователя нет в базе users, создаем его
        cursor.execute("INSERT OR IGNORE INTO users (user_id, balance_up) VALUES (?, ?)", (user_id, amount))
    else:
        # Если есть, прибавляем баланс
        cursor.execute("UPDATE users SET balance_up = balance_up + ? WHERE user_id = ?", (amount, user_id))
        
    conn.commit()
    
    # Узнаем актуальный баланс
    cursor.execute("SELECT balance_up FROM users WHERE user_id = ?", (user_id,))
    new_balance = cursor.fetchone()[0]
    conn.close()

    text = (
        f"🧪 <b>Тестовый режим</b>\n\n"
        f"💎 Успешно выдано: <b>+{amount:,} UP</b>\n"
        f"💰 Твой текущий баланс: <b>{new_balance:,} UP</b>\n\n"
        f"Теперь можешь протестировать покупку бизнеса!"
    )
    
    await message.answer(text, parse_mode="HTML")
