import time
import random
from aiogram import Router, types, F
from aiogram.filters import Command
from aiogram.types import ChatMemberAdministrator, ChatMemberOwner
from database import sqlite3, DB_NAME

router = Router()

# ========== ИНИЦИАЛИЗАЦИЯ БД ==========
def init_treasury_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS chat_treasury (
            chat_id INTEGER PRIMARY KEY,
            balance INTEGER DEFAULT 0,
            reward_amount INTEGER DEFAULT 500,
            total_donated INTEGER DEFAULT 0,
            total_paid INTEGER DEFAULT 0,
            created_at INTEGER,
            last_updated INTEGER
        )
    """)
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS treasury_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER,
            user_id INTEGER,
            user_name TEXT,
            action_type TEXT,
            amount INTEGER,
            balance_after INTEGER,
            details TEXT,
            created_at INTEGER
        )
    """)
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS treasury_new_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER,
            user_id INTEGER,
            inviter_id INTEGER,
            reward_amount INTEGER,
            member_count INTEGER DEFAULT 0,
            created_at INTEGER,
            UNIQUE(chat_id, user_id)
        )
    """)
    
    cursor.execute("PRAGMA table_info(chat_treasury)")
    columns = [col[1] for col in cursor.fetchall()]
    if "last_updated" not in columns:
        cursor.execute("ALTER TABLE chat_treasury ADD COLUMN last_updated INTEGER")
    
    conn.commit()
    conn.close()

init_treasury_db()

# ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
def check_user_registered(user_id: int) -> bool:
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT 1 FROM users WHERE user_id = ?", (user_id,))
    res = cursor.fetchone()
    conn.close()
    return res is not None

def get_treasury(chat_id):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT balance, reward_amount, total_donated, total_paid FROM chat_treasury WHERE chat_id = ?", (chat_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    return {
        "balance": row[0],
        "reward_amount": row[1],
        "total_donated": row[2],
        "total_paid": row[3]
    }

def create_treasury(chat_id):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("""
        INSERT OR IGNORE INTO chat_treasury (chat_id, balance, reward_amount, created_at, last_updated)
        VALUES (?, 0, 500, ?, ?)
    """, (chat_id, int(time.time()), int(time.time())))
    conn.commit()
    conn.close()

def add_to_treasury(chat_id, amount):
    if amount <= 0:
        return False
    
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    cursor.execute("SELECT balance FROM chat_treasury WHERE chat_id = ?", (chat_id,))
    row = cursor.fetchone()
    current_balance = row[0] if row else 0
    
    new_balance = current_balance + amount
    
    cursor.execute("""
        UPDATE chat_treasury 
        SET balance = ?, total_donated = total_donated + ?, last_updated = ?
        WHERE chat_id = ?
    """, (new_balance, amount, int(time.time()), chat_id))
    conn.commit()
    conn.close()
    return True

def remove_from_treasury(chat_id, amount):
    if amount <= 0:
        return False
    
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    cursor.execute("SELECT balance FROM chat_treasury WHERE chat_id = ?", (chat_id,))
    row = cursor.fetchone()
    current_balance = row[0] if row else 0
    
    if current_balance < amount:
        conn.close()
        return False
    
    new_balance = current_balance - amount
    
    cursor.execute("""
        UPDATE chat_treasury 
        SET balance = ?, total_paid = total_paid + ?, last_updated = ?
        WHERE chat_id = ?
    """, (new_balance, amount, int(time.time()), chat_id))
    conn.commit()
    conn.close()
    return True

def set_reward_amount(chat_id, amount):
    if amount < 100 or amount > 2500:
        return False
    
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("UPDATE chat_treasury SET reward_amount = ?, last_updated = ? WHERE chat_id = ?", (amount, int(time.time()), chat_id))
    conn.commit()
    conn.close()
    return True

def add_treasury_history(chat_id, user_id, user_name, action_type, amount, details="", balance_after=None):
    if balance_after is None:
        treasury = get_treasury(chat_id)
        balance_after = treasury['balance'] if treasury else 0
    
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO treasury_history (chat_id, user_id, user_name, action_type, amount, balance_after, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (chat_id, user_id, user_name, action_type, amount, balance_after, details, int(time.time())))
    conn.commit()
    conn.close()

def get_inviter_stats(chat_id, inviter_id):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT COUNT(*) FROM treasury_new_members 
        WHERE chat_id = ? AND inviter_id = ?
    """, (chat_id, inviter_id))
    count = cursor.fetchone()[0]
    conn.close()
    return count

def is_member_rewarded(chat_id, user_id):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM treasury_new_members WHERE chat_id = ? AND user_id = ?", (chat_id, user_id))
    row = cursor.fetchone()
    conn.close()
    return row is not None

def check_user_balance(user_id):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT balance_up FROM users WHERE user_id = ?", (user_id,))
    res = cursor.fetchone()
    conn.close()
    return res[0] if res else 0

def update_user_balance(user_id, amount):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET balance_up = balance_up + ? WHERE user_id = ?", (amount, user_id))
    conn.commit()
    conn.close()

def get_user_nickname(user_id):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT nickname FROM users WHERE user_id = ?", (user_id,))
    res = cursor.fetchone()
    conn.close()
    if res and res[0]:
        return res[0]
    return "Игрок"

def format_number(num):
    return f"{num:,}".replace(",", " ")

async def send_private_message(bot, user_id, text):
    try:
        await bot.send_message(user_id, text, parse_mode="HTML")
        return True
    except:
        return False

# ========== КОМАНДЫ ==========
@router.message(F.text.casefold().startswith("пополнить казну "))
async def cmd_donate_treasury(message: types.Message):
    chat_id = message.chat.id
    user_id = message.from_user.id
    
    if message.chat.type not in ["group", "supergroup"]:
        await message.answer("❌ Эта команда работает только в группах!")
        return
    
    if not check_user_registered(user_id):
        await send_private_message(
            message.bot, 
            user_id,
            "❌ <b>Вы не зарегистрированы в боте!</b>\n\nДля начала игры отправьте:\n<code>/start</code>"
        )
        return
    
    try:
        member = await message.bot.get_chat_member(chat_id, user_id)
        if not (member.status in ["creator", "administrator"]):
            await message.answer("❌ <b>У вас недостаточно прав для пополнения казны!</b>\nТребуется: <b>администратор</b>", parse_mode="HTML")
            return
    except:
        await message.answer("❌ Не удалось проверить ваши права!")
        return
    
    try:
        amount_text = message.text.split()[2].lower()
        if amount_text.endswith("к"):
            amount = int(float(amount_text[:-1]) * 1000)
        else:
            amount = int(amount_text)
    except (IndexError, ValueError):
        await message.answer("❌ Неверный формат!\nПример: <code>Пополнить казну 1000</code> или <code>Пополнить казну 10к</code>", parse_mode="HTML")
        return
    
    if amount <= 0:
        await message.answer("❌ Сумма должна быть больше 0!", parse_mode="HTML")
        return
    
    if amount < 100:
        await message.answer("❌ Минимальное пополнение: <b>100 UP</b>!", parse_mode="HTML")
        return
    
    balance = check_user_balance(user_id)
    if balance < amount:
        await message.answer(f"❌ Недостаточно UP для пополнения казны!\nВаш баланс: <b>{format_number(balance)} UP</b>", parse_mode="HTML")
        return
    
    create_treasury(chat_id)
    
    update_user_balance(user_id, -amount)
    
    success = add_to_treasury(chat_id, amount)
    if not success:
        update_user_balance(user_id, amount)
        await message.answer("❌ Ошибка при пополнении казны! Попробуйте позже.")
        return
    
    user_name = get_user_nickname(user_id)
    treasury = get_treasury(chat_id)
    add_treasury_history(chat_id, user_id, user_name, "donate", amount, f"Пополнение казны", treasury['balance'])
    
    text = (
        "🏦 <b>Казна пополнена!</b>\n\n"
        f"👤 Игрок: <b>{user_name}</b>\n"
        f"➕ Добавлено: <b>{format_number(amount)} UP</b>\n"
        f"💸 Баланс казны: <b>{format_number(treasury['balance'])} UP</b>"
    )
    
    await message.answer(text, parse_mode="HTML")

@router.message(F.text.casefold().startswith("изменить награду "))
async def cmd_change_reward(message: types.Message):
    chat_id = message.chat.id
    user_id = message.from_user.id
    
    if message.chat.type not in ["group", "supergroup"]:
        await message.answer("❌ Эта команда работает только в группах!")
        return
    
    if not check_user_registered(user_id):
        await send_private_message(
            message.bot, 
            user_id,
            "❌ <b>Вы не зарегистрированы в боте!</b>\n\nДля начала игры отправьте:\n<code>/start</code>"
        )
        return
    
    try:
        member = await message.bot.get_chat_member(chat_id, user_id)
        if not (member.status in ["creator", "administrator"]):
            await message.answer("❌ <b>У вас недостаточно прав для изменения награды!</b>\nТребуется: <b>администратор</b>", parse_mode="HTML")
            return
    except:
        await message.answer("❌ Не удалось проверить ваши права!")
        return
    
    try:
        amount_text = message.text.split()[2].lower()
        if amount_text.endswith("к"):
            amount = int(float(amount_text[:-1]) * 1000)
        else:
            amount = int(amount_text)
    except (IndexError, ValueError):
        await message.answer("❌ Неверный формат!\nПример: <code>Изменить награду 1000</code> или <code>Изменить награду 2.5к</code>", parse_mode="HTML")
        return
    
    if amount <= 0:
        await message.answer("❌ Награда должна быть больше 0!", parse_mode="HTML")
        return
    
    if amount < 100:
        await message.answer("❌ Минимальная награда: <b>100 UP</b>!", parse_mode="HTML")
        return
    
    if amount > 2500:
        await message.answer("❌ Максимальная награда: <b>2500 UP</b>!", parse_mode="HTML")
        return
    
    create_treasury(chat_id)
    
    success = set_reward_amount(chat_id, amount)
    if not success:
        await message.answer("❌ Ошибка при изменении награды!")
        return
    
    user_name = get_user_nickname(user_id)
    treasury = get_treasury(chat_id)
    add_treasury_history(chat_id, user_id, user_name, "change_reward", amount, f"Изменение награды", treasury['balance'])
    
    text = (
        "✅ <b>Награда изменена!</b>\n\n"
        f"🎁 Теперь за нового участника: <b>{format_number(amount)} UP</b>"
    )
    
    await message.answer(text, parse_mode="HTML")

@router.message(F.text.casefold().in_({"🏦 казна", "казна", "казна чата"}))
async def cmd_treasury(message: types.Message):
    chat_id = message.chat.id
    user_id = message.from_user.id
    
    if message.chat.type not in ["group", "supergroup"]:
        await message.answer("❌ Эта команда работает только в группах!")
        return
    
    if not check_user_registered(user_id):
        await send_private_message(
            message.bot, 
            user_id,
            "❌ <b>Вы не зарегистрированы в боте!</b>\n\nДля начала игры отправьте:\n<code>/start</code>"
        )
        return
    
    create_treasury(chat_id)
    treasury = get_treasury(chat_id)
    
    if treasury['balance'] < 0:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("UPDATE chat_treasury SET balance = 0 WHERE chat_id = ?", (chat_id,))
        conn.commit()
        conn.close()
        treasury['balance'] = 0
    
    text = (
        "💰 <b>КАЗНА ЧАТА</b>\n\n"
        f"💸 Баланс:\n<b>{format_number(treasury['balance'])} UP</b>"
    )
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="ℹ️ Информация", callback_data="treasury_info")]
        ]
    )
    
    await message.answer(text, parse_mode="HTML", reply_markup=kb)

@router.callback_query(F.data == "treasury_info")
async def cmd_treasury_info(callback: types.CallbackQuery):
    chat_id = callback.message.chat.id
    user_id = callback.from_user.id
    
    if callback.message.chat.type not in ["group", "supergroup"]:
        await callback.answer("❌ Эта команда работает только в группах!", show_alert=True)
        return
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        await send_private_message(
            callback.bot, 
            user_id,
            "❌ <b>Вы не зарегистрированы в боте!</b>\n\nДля начала игры отправьте:\n<code>/start</code>"
        )
        return
    
    treasury = get_treasury(chat_id)
    if not treasury:
        create_treasury(chat_id)
        treasury = get_treasury(chat_id)
    
    if treasury['balance'] < 0:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("UPDATE chat_treasury SET balance = 0 WHERE chat_id = ?", (chat_id,))
        conn.commit()
        conn.close()
        treasury['balance'] = 0
    
    text = (
        "ℹ️ <b>ИНФОРМАЦИЯ О КАЗНЕ</b>\n\n"
        "💰 <b>Что такое казна?</b>\n"
        "Казна чата — это общий баланс, из которого выплачиваются награды новым участникам.\n\n"
        "🎁 <b>Как работают награды?</b>\n"
        "Когда вы приглашаете нового участника в чат, вы получаете награду из казны.\n\n"
        "📝 <b>Команды:</b>\n"
        "🔹 <code>Казна</code> — баланс казны\n"
        "🔹 <code>Награда казны</code> — текущая награда\n"
        "🔹 <code>Пополнить казну [сумма]</code> — пополнение (только админы)\n"
        "🔹 <code>Изменить награду [сумма]</code> — изменение награды (владелец/админы)\n\n"
        "💡 <b>Примеры:</b>\n"
        "▫️ <code>Пополнить казну 5000</code>\n"
        "▫️ <code>Пополнить казну 10к</code>\n"
        "▫️ <code>Изменить награду 500</code>\n\n"
        "⚙️ <b>Условия:</b>\n"
        "▫️ Минимум пополнения: <b>100 UP</b>\n"
        "▫️ Награда: от <b>100</b> до <b>2500 UP</b>\n"
        "▫️ Изменять награду могут владелец и администраторы\n"
        "▫️ В казне должно быть достаточно средств для выплаты"
    )
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="🔙 Назад", callback_data="treasury_back")]
        ]
    )
    
    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
    await callback.answer()

@router.callback_query(F.data == "treasury_back")
async def cmd_treasury_back(callback: types.CallbackQuery):
    chat_id = callback.message.chat.id
    
    treasury = get_treasury(chat_id)
    
    if treasury and treasury['balance'] < 0:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("UPDATE chat_treasury SET balance = 0 WHERE chat_id = ?", (chat_id,))
        conn.commit()
        conn.close()
        treasury['balance'] = 0
    
    text = (
        "💰 <b>КАЗНА ЧАТА</b>\n\n"
        f"💸 Баланс:\n<b>{format_number(treasury['balance'])} UP</b>"
    )
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="ℹ️ Информация", callback_data="treasury_info")]
        ]
    )
    
    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
    await callback.answer()

@router.message(F.text.casefold().in_({"🎁 награда казны", "награда казны"}))
async def cmd_reward_info(message: types.Message):
    chat_id = message.chat.id
    user_id = message.from_user.id
    
    if message.chat.type not in ["group", "supergroup"]:
        await message.answer("❌ Эта команда работает только в группах!")
        return
    
    if not check_user_registered(user_id):
        await send_private_message(
            message.bot, 
            user_id,
            "❌ <b>Вы не зарегистрированы в боте!</b>\n\nДля начала игры отправьте:\n<code>/start</code>"
        )
        return
    
    create_treasury(chat_id)
    treasury = get_treasury(chat_id)
    
    if treasury['balance'] < 0:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("UPDATE chat_treasury SET balance = 0 WHERE chat_id = ?", (chat_id,))
        conn.commit()
        conn.close()
        treasury['balance'] = 0
    
    if treasury['balance'] == 0:
        text = (
            "❌ <b>В казне недостаточно средств!</b>\n\n"
            f"🏦 Баланс казны:\n<b>{format_number(treasury['balance'])} UP</b>\n\n"
            "🎁 Награда временно недоступна."
        )
    else:
        text = (
            "🎁 <b>НАГРАДА КАЗНЫ</b>\n\n"
            f"💰 За одного нового участника:\n<b>{format_number(treasury['reward_amount'])} UP</b>\n\n"
            f"💸 В казне: <b>{format_number(treasury['balance'])} UP</b>"
        )
    
    await message.answer(text, parse_mode="HTML")

@router.message(F.text.casefold().in_({"статистика казны", "история казны"}))
async def cmd_treasury_stats(message: types.Message):
    chat_id = message.chat.id
    user_id = message.from_user.id
    
    if message.chat.type not in ["group", "supergroup"]:
        await message.answer("❌ Эта команда работает только в группах!")
        return
    
    if not check_user_registered(user_id):
        await send_private_message(
            message.bot, 
            user_id,
            "❌ <b>Вы не зарегистрированы в боте!</b>\n\nДля начала игры отправьте:\n<code>/start</code>"
        )
        return
    
    try:
        member = await message.bot.get_chat_member(chat_id, user_id)
        if not (member.status in ["creator", "administrator"]):
            await message.answer("❌ <b>У вас недостаточно прав для просмотра статистики!</b>\nТребуется: <b>администратор</b>", parse_mode="HTML")
            return
    except:
        await message.answer("❌ Не удалось проверить ваши права!")
        return
    
    create_treasury(chat_id)
    treasury = get_treasury(chat_id)
    
    if treasury['balance'] < 0:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("UPDATE chat_treasury SET balance = 0 WHERE chat_id = ?", (chat_id,))
        conn.commit()
        conn.close()
        treasury['balance'] = 0
    
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT COUNT(*) FROM treasury_history 
        WHERE chat_id = ? AND action_type = 'donate'
    """, (chat_id,))
    donate_count = cursor.fetchone()[0]
    
    cursor.execute("""
        SELECT COUNT(*) FROM treasury_history 
        WHERE chat_id = ? AND action_type = 'reward'
    """, (chat_id,))
    reward_count = cursor.fetchone()[0]
    
    cursor.execute("""
        SELECT user_name, SUM(amount) as total 
        FROM treasury_history 
        WHERE chat_id = ? AND action_type = 'donate'
        GROUP BY user_id 
        ORDER BY total DESC 
        LIMIT 5
    """, (chat_id,))
    top_donors = cursor.fetchall()
    conn.close()
    
    text = (
        "📊 <b>СТАТИСТИКА КАЗНЫ</b>\n\n"
        f"💰 Баланс: <b>{format_number(treasury['balance'])} UP</b>\n"
        f"🎁 Награда: <b>{format_number(treasury['reward_amount'])} UP</b>\n\n"
        f"📥 Пополнений: <b>{donate_count}</b>\n"
        f"📤 Выплат: <b>{reward_count}</b>\n"
        f"💎 Всего собрано: <b>{format_number(treasury['total_donated'])} UP</b>\n"
        f"🎁 Всего выплачено: <b>{format_number(treasury['total_paid'])} UP</b>\n\n"
    )
    
    if top_donors:
        text += "🏆 <b>Топ донатеров:</b>\n"
        for name, total in top_donors:
            text += f"   • {name} — {format_number(total)} UP\n"
    
    await message.answer(text, parse_mode="HTML")

# ========== ОБРАБОТЧИК НОВЫХ УЧАСТНИКОВ ==========
@router.message(F.new_chat_members)
async def on_new_member(message: types.Message):
    chat_id = message.chat.id
    
    if message.chat.type not in ["group", "supergroup"]:
        return
    
    create_treasury(chat_id)
    treasury = get_treasury(chat_id)
    
    if treasury['balance'] < 0:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("UPDATE chat_treasury SET balance = 0 WHERE chat_id = ?", (chat_id,))
        conn.commit()
        conn.close()
        treasury['balance'] = 0
    
    if treasury['balance'] < treasury['reward_amount']:
        return
    
    for member in message.new_chat_members:
        if member.is_bot:
            continue
        
        user_id = member.id
        
        if is_member_rewarded(chat_id, user_id):
            continue
        
        inviter_id = None
        inviter_name = "Неизвестный"
        
        if message.reply_to_message:
            inviter_id = message.reply_to_message.from_user.id
            inviter_name = get_user_nickname(inviter_id)
        elif message.from_user:
            inviter_id = message.from_user.id
            inviter_name = get_user_nickname(inviter_id)
        
        if not inviter_id:
            continue
        
        if inviter_id == user_id:
            continue
        
        try:
            inviter_user = await message.bot.get_chat_member(chat_id, inviter_id)
            if inviter_user.user.is_bot:
                continue
        except:
            continue
        
        if not check_user_registered(inviter_id):
            continue
        
        treasury = get_treasury(chat_id)
        if treasury['balance'] < treasury['reward_amount']:
            continue
        
        reward = treasury['reward_amount']
        
        success = remove_from_treasury(chat_id, reward)
        if not success:
            continue
        
        update_user_balance(inviter_id, reward)
        
        inviter_stats = get_inviter_stats(chat_id, inviter_id) + 1
        
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR IGNORE INTO treasury_new_members (chat_id, user_id, inviter_id, reward_amount, member_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (chat_id, user_id, inviter_id, reward, inviter_stats, int(time.time())))
        conn.commit()
        conn.close()
        
        treasury_after = get_treasury(chat_id)
        add_treasury_history(chat_id, inviter_id, inviter_name, "reward", reward, f"За приглашение {get_user_nickname(user_id)}", treasury_after['balance'])
        
        inviter_link = f"<a href='tg://user?id={inviter_id}'>{inviter_name}</a>"
        new_user_link = f"<a href='tg://user?id={user_id}'>{get_user_nickname(user_id)}</a>"
        
        if inviter_stats == 1:
            person_word = "человека"
        elif 2 <= inviter_stats <= 4:
            person_word = "человека"
        else:
            person_word = "человек"
        
        text = (
            f"🎉 {inviter_link} пригласил {person_word} {new_user_link} и получил +{format_number(reward)} UP"
        )
        
        await message.answer(text, parse_mode="HTML")