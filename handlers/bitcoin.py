import random
import time
import asyncio
import math
from aiogram import Router, types, F
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from database import sqlite3, DB_NAME

router = Router()

# ========== FSM СОСТОЯНИЯ ==========
class BitcoinStates(StatesGroup):
    waiting_for_buy_amount = State()
    waiting_for_sell_amount = State()
    waiting_for_transfer_amount = State()
    waiting_for_transfer_user = State()
    confirm_buy = State()
    confirm_sell = State()
    confirm_transfer = State()

# ========== ИНИЦИАЛИЗАЦИЯ БД ==========
def init_bitcoin_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS bitcoin_balances (
            user_id INTEGER PRIMARY KEY,
            btc_balance REAL DEFAULT 0,
            total_bought REAL DEFAULT 0,
            total_sold REAL DEFAULT 0,
            total_spent_up INTEGER DEFAULT 0,
            total_earned_up INTEGER DEFAULT 0,
            last_updated INTEGER DEFAULT 0,
            daily_transfers INTEGER DEFAULT 0,
            last_transfer_reset INTEGER DEFAULT 0
        )
    """)
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS bitcoin_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rate INTEGER,
            timestamp INTEGER,
            change_percent REAL DEFAULT 0,
            event_type TEXT DEFAULT 'normal'
        )
    """)
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS bitcoin_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            type TEXT,
            btc_amount REAL,
            up_amount INTEGER,
            rate INTEGER,
            target_user INTEGER DEFAULT NULL,
            timestamp INTEGER
        )
    """)
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS bitcoin_transfers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_user INTEGER,
            to_user INTEGER,
            btc_amount REAL,
            rate INTEGER,
            timestamp INTEGER,
            status TEXT DEFAULT 'completed'
        )
    """)
    
    cursor.execute("PRAGMA table_info(bitcoin_balances)")
    columns = [col[1] for col in cursor.fetchall()]
    
    if "daily_transfers" not in columns:
        cursor.execute("ALTER TABLE bitcoin_balances ADD COLUMN daily_transfers INTEGER DEFAULT 0")
    if "last_transfer_reset" not in columns:
        cursor.execute("ALTER TABLE bitcoin_balances ADD COLUMN last_transfer_reset INTEGER DEFAULT 0")
    
    cursor.execute("PRAGMA table_info(bitcoin_history)")
    columns = [col[1] for col in cursor.fetchall()]
    if "event_type" not in columns:
        cursor.execute("ALTER TABLE bitcoin_history ADD COLUMN event_type TEXT DEFAULT 'normal'")
    
    cursor.execute("PRAGMA table_info(bitcoin_transactions)")
    columns = [col[1] for col in cursor.fetchall()]
    if "target_user" not in columns:
        cursor.execute("ALTER TABLE bitcoin_transactions ADD COLUMN target_user INTEGER DEFAULT NULL")
    
    conn.commit()
    conn.close()

init_bitcoin_db()

# ========== ПРОВЕРКА РЕГИСТРАЦИИ ==========
def check_user_registered(user_id: int) -> bool:
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT 1 FROM users WHERE user_id = ?", (user_id,))
    res = cursor.fetchone()
    conn.close()
    return res is not None

# ========== ТЕКУЩИЙ КУРС ==========
CURRENT_BTC_RATE = 125000
RATE_HISTORY = []
MARKET_EVENTS = [
    {"title": "🚀 Институциональные инвесторы", "desc": "Крупные инвесторы вошли в Bitcoin!", "change": 3.0},
    {"title": "📰 Позитивные новости", "desc": "Новости о принятии Bitcoin в крупных компаниях!", "change": 2.0},
    {"title": "⚠️ Регуляторные риски", "desc": "Регуляторы ужесточают контроль над криптобиржами!", "change": -2.0},
    {"title": "📉 Медвежий рынок", "desc": "Инвесторы выводят средства из криптовалют!", "change": -3.0},
    {"title": "🎉 Партнёрство", "desc": "Крупный банк интегрирует Bitcoin!", "change": 2.5},
    {"title": "💥 Технический скачок", "desc": "Сеть Bitcoin показывает рекордную скорость!", "change": 1.5},
    {"title": "🔴 Коррекция рынка", "desc": "Коррекция после роста, инвесторы фиксируют прибыль!", "change": -1.5},
    {"title": "🟢 Бычий импульс", "desc": "Быки контролируют рынок, рост продолжается!", "change": 2.8},
    {"title": "⚠️ Волатильность", "desc": "Высокая волатильность, рынок нестабилен!", "change": -2.5},
    {"title": "🎊 Новый рекорд", "desc": "Bitcoin обновляет исторический максимум!", "change": 3.5},
]

bot = None

def set_bot(bot_instance):
    global bot
    bot = bot_instance

def get_current_rate():
    return CURRENT_BTC_RATE

def get_rate_history(limit=24):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT rate, timestamp, change_percent, event_type FROM bitcoin_history ORDER BY timestamp DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    conn.close()
    return rows[::-1]

def save_rate_to_history(rate, change_percent=0, event_type="normal"):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("INSERT INTO bitcoin_history (rate, timestamp, change_percent, event_type) VALUES (?, ?, ?, ?)", 
                   (rate, int(time.time()), change_percent, event_type))
    conn.commit()
    conn.close()

# ========== ФОНОВОЕ ОБНОВЛЕНИЕ КУРСА ==========
async def update_bitcoin_rate():
    global CURRENT_BTC_RATE
    
    while True:
        await asyncio.sleep(3600)
        
        change = random.uniform(-3.0, 3.0)
        event_type = "normal"
        event_text = ""
        
        if random.random() < 0.15:
            event = random.choice(MARKET_EVENTS)
            event_type = "event"
            event_text = event["desc"]
            change = event["change"] + random.uniform(-0.5, 0.5)
            await notify_btc_holders(event["title"], event["desc"], change)
        
        change = round(change, 2)
        old_rate = CURRENT_BTC_RATE
        new_rate = int(old_rate * (1 + change / 100))
        
        if new_rate < 500:
            new_rate = 500
        if new_rate > 2000000:
            new_rate = 2000000
        
        CURRENT_BTC_RATE = new_rate
        save_rate_to_history(new_rate, change, event_type)
        
        print(f"📊 Курс BTC обновлён: {old_rate} → {new_rate} ({change:+.2f}%)")

async def notify_btc_holders(title, desc, change):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT user_id FROM bitcoin_balances WHERE btc_balance > 0.001")
    holders = cursor.fetchall()
    conn.close()
    
    emoji = "🚨" if change < 0 else "🎉"
    text = (
        f"{emoji} <b>Новости рынка</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        f"📰 {title}\n"
        f"📝 {desc}\n\n"
        f"📊 Изменение курса: <b>{change:+.2f}%</b>\n"
        f"📈 Текущий курс: <b>{format_number(get_current_rate())} UP</b>"
    )
    
    for (user_id,) in holders:
        try:
            await bot.send_message(user_id, text, parse_mode="HTML")
        except Exception:
            pass

# ========== ПОЛУЧЕНИЕ ДАННЫХ ==========
def get_user_bitcoin_balance(user_id):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT btc_balance, total_bought, total_sold, total_spent_up, total_earned_up, 
               daily_transfers, last_transfer_reset 
        FROM bitcoin_balances WHERE user_id = ?
    """, (user_id,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        return {
            "btc_balance": 0.0,
            "total_bought": 0.0,
            "total_sold": 0.0,
            "total_spent_up": 0,
            "total_earned_up": 0,
            "daily_transfers": 0,
            "last_transfer_reset": 0
        }
    
    return {
        "btc_balance": row[0],
        "total_bought": row[1],
        "total_sold": row[2],
        "total_spent_up": row[3],
        "total_earned_up": row[4],
        "daily_transfers": row[5],
        "last_transfer_reset": row[6]
    }

def update_user_bitcoin_balance(user_id, btc_delta=0, spent_up=0, earned_up=0, transfer_delta=0):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    cursor.execute("SELECT btc_balance, total_bought, total_sold, total_spent_up, total_earned_up, daily_transfers FROM bitcoin_balances WHERE user_id = ?", (user_id,))
    row = cursor.fetchone()
    
    if not row:
        btc_balance = btc_delta
        total_bought = btc_delta if btc_delta > 0 else 0
        total_sold = abs(btc_delta) if btc_delta < 0 else 0
        total_spent_up = spent_up
        total_earned_up = earned_up
        daily_transfers = transfer_delta if transfer_delta > 0 else 0
    else:
        btc_balance = row[0] + btc_delta
        total_bought = row[1] + (btc_delta if btc_delta > 0 else 0)
        total_sold = row[2] + (abs(btc_delta) if btc_delta < 0 else 0)
        total_spent_up = row[3] + spent_up
        total_earned_up = row[4] + earned_up
        daily_transfers = row[5] + transfer_delta
    
    cursor.execute("""
        INSERT OR REPLACE INTO bitcoin_balances 
        (user_id, btc_balance, total_bought, total_sold, total_spent_up, total_earned_up, 
         last_updated, daily_transfers, last_transfer_reset)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (user_id, btc_balance, total_bought, total_sold, total_spent_up, total_earned_up, 
          int(time.time()), daily_transfers, int(time.time())))
    
    conn.commit()
    conn.close()
    return btc_balance

def get_user_up_balance(user_id):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT balance_up FROM users WHERE user_id = ?", (user_id,))
    res = cursor.fetchone()
    conn.close()
    return res[0] if res else 0

def update_user_up_balance(user_id, amount):
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
    return res[0] if res and res[0] else "Игрок"

def add_bitcoin_transaction(user_id, trans_type, btc_amount, up_amount, rate, target_user=None):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO bitcoin_transactions (user_id, type, btc_amount, up_amount, rate, target_user, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (user_id, trans_type, btc_amount, up_amount, rate, target_user, int(time.time())))
    conn.commit()
    conn.close()

def add_bitcoin_transfer(from_user, to_user, btc_amount, rate):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO bitcoin_transfers (from_user, to_user, btc_amount, rate, timestamp)
        VALUES (?, ?, ?, ?, ?)
    """, (from_user, to_user, btc_amount, rate, int(time.time())))
    conn.commit()
    conn.close()

def get_user_transactions(user_id, limit=10):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT type, btc_amount, up_amount, rate, target_user, timestamp 
        FROM bitcoin_transactions 
        WHERE user_id = ? 
        ORDER BY timestamp DESC 
        LIMIT ?
    """, (user_id, limit))
    rows = cursor.fetchall()
    conn.close()
    return rows

def get_btc_top_players(limit=10):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT user_id, btc_balance 
        FROM bitcoin_balances 
        WHERE btc_balance > 0.0001 
        ORDER BY btc_balance DESC 
        LIMIT ?
    """, (limit,))
    rows = cursor.fetchall()
    conn.close()
    return rows

def format_number(num):
    if isinstance(num, float):
        if num == 0:
            return "0"
        return f"{num:,.8f}".rstrip('0').rstrip('.')
    return f"{num:,}".replace(",", " ")

# ========== ГЛАВНОЕ МЕНЮ BTC ==========
@router.message(F.text.casefold().in_({"bitcoin", "биткоин", "🪙 биткоин", "/btc"}))
async def cmd_bitcoin(message: types.Message):
    user_id = message.from_user.id
    
    if not check_user_registered(user_id):
        if message.chat.type != "private":
            return
        await message.answer(
            "❌ <b>Вы еще не зарегистрированы!</b>\n\n"
            "💡 Пожалуйста, перейдите в <b>личные сообщения</b> бота и нажмите /start, чтобы активировать игровой профиль!",
            parse_mode="HTML"
        )
        return
    
    await show_bitcoin_menu(message, user_id)

async def show_bitcoin_menu(message_or_callback, user_id, edit=False):
    rate = get_current_rate()
    btc_data = get_user_bitcoin_balance(user_id)
    btc_balance = btc_data["btc_balance"]
    portfolio_value = int(btc_balance * rate)
    
    history = get_rate_history(2)
    change = 0
    if len(history) >= 2:
        old_rate = history[-2][0]
        change = ((rate - old_rate) / old_rate) * 100
    
    change_emoji = "📈" if change > 0 else "📉" if change < 0 else "➡️"
    
    btc_formatted = format_number(btc_balance)
    up_formatted = format_number(portfolio_value)
    
    text = (
        "🪙 <b>Bitcoin Market</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        f"📈 <b>Текущий курс:</b>\n"
        f"<code>1 BTC = {format_number(rate)} UP</code>\n"
        f"{change_emoji} <i>{change:+.2f}% за час</i>\n\n"
        f"{'🟢' if btc_balance > 0 else '⚫'} <b>Ваш портфель:</b>\n"
        f"BTC: <code>{btc_formatted}</code>\n"
        f"Стоимость: <code>{up_formatted} UP</code>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        "💡 <i>Выберите действие:</i>"
    )
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="🟢 Купить BTC", callback_data="btc_buy_menu"),
             types.InlineKeyboardButton(text="🔴 Продать BTC", callback_data="btc_sell_menu")],
            [types.InlineKeyboardButton(text="📊 Мой портфель", callback_data="btc_portfolio"),
             types.InlineKeyboardButton(text="📈 График BTC", callback_data="btc_chart")],
            [types.InlineKeyboardButton(text="🏆 Топ держателей", callback_data="btc_top"),
             types.InlineKeyboardButton(text="🔄 Перевести BTC", callback_data="btc_transfer_menu")],
            [types.InlineKeyboardButton(text="📰 История курса", callback_data="btc_history")]
        ]
    )
    
    if edit:
        await message_or_callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
    else:
        await message_or_callback.answer(text, parse_mode="HTML", reply_markup=kb)

# ========== ИСТОРИЯ КУРСА ==========
@router.callback_query(F.data == "btc_history")
async def cb_btc_history(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    history = get_rate_history(24)
    
    text = "📊 <b>История Bitcoin</b>\n"
    text += "━━━━━━━━━━━━━━━━━━━━━━\n\n"
    
    if not history:
        text += "📭 История пока пуста..."
    else:
        recent = history[-12:] if len(history) > 12 else history
        for rate, timestamp, change, event_type in recent:
            date_str = time.strftime("%H:%M", time.localtime(timestamp))
            emoji = "🟢" if change >= 0 else "🔴"
            event_icon = "📰" if event_type == "event" else ""
            text += f"{date_str} {emoji} {format_number(rate)} UP ({change:+.2f}%) {event_icon}\n"
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[[types.InlineKeyboardButton(text="🔙 Назад", callback_data="btc_back")]]
    )
    
    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
    await callback.answer()

# ========== ТОП ДЕРЖАТЕЛЕЙ ==========
@router.callback_query(F.data == "btc_top")
async def cb_btc_top(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    top = get_btc_top_players(10)
    
    text = "🏆 <b>Топ 10 держателей Bitcoin</b>\n"
    text += "━━━━━━━━━━━━━━━━━━━━━━\n\n"
    
    if not top:
        text += "📭 Пока нет держателей Bitcoin..."
    else:
        medals = ["🥇", "🥈", "🥉"]
        for i, (user_id, balance) in enumerate(top, 1):
            nickname = get_user_nickname(user_id)
            prefix = medals[i-1] if i <= 3 else f"{i}."
            text += f"{prefix} {nickname} — <code>{format_number(balance)} BTC</code>\n"
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[[types.InlineKeyboardButton(text="🔙 Назад", callback_data="btc_back")]]
    )
    
    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
    await callback.answer()

# ========== ПЕРЕВОД BTC ==========
@router.callback_query(F.data == "btc_transfer_menu")
async def cb_transfer_menu(callback: types.CallbackQuery, state: FSMContext):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    btc_data = get_user_bitcoin_balance(user_id)
    
    if btc_data["btc_balance"] <= 0:
        await callback.answer("❌ У вас нет BTC для перевода!", show_alert=True)
        return
    
    current_time = int(time.time())
    if current_time - btc_data["last_transfer_reset"] > 86400:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("UPDATE bitcoin_balances SET daily_transfers = 0, last_transfer_reset = ? WHERE user_id = ?", 
                       (current_time, user_id))
        conn.commit()
        conn.close()
        btc_data["daily_transfers"] = 0
    
    if btc_data["daily_transfers"] >= 3:
        await callback.answer("❌ Дневной лимит переводов (3) исчерпан!", show_alert=True)
        return
    
    await state.set_state(BitcoinStates.waiting_for_transfer_user)
    
    text = (
        "🪙 <b>Перевод Bitcoin</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        f"💎 Ваш баланс: <b>{format_number(btc_data['btc_balance'])} BTC</b>\n"
        f"📊 Доступно переводов: <b>{3 - btc_data['daily_transfers']}/3</b>\n\n"
        "✍️ <b>Введите ID получателя:</b>\n\n"
        "<i>Например: 123456789</i>"
    )
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[[types.InlineKeyboardButton(text="❌ Отмена", callback_data="btc_back")]]
    )
    
    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
    await callback.answer()

@router.message(BitcoinStates.waiting_for_transfer_user)
async def process_transfer_user(message: types.Message, state: FSMContext):
    user_id = message.from_user.id
    
    if not check_user_registered(user_id):
        if message.chat.type != "private":
            await state.clear()
            return
        await message.answer(
            "❌ <b>Вы еще не зарегистрированы!</b>\n\n"
            "💡 Пожалуйста, перейдите в <b>личные сообщения</b> бота и нажмите /start, чтобы активировать игровой профиль!",
            parse_mode="HTML"
        )
        await state.clear()
        return
    
    try:
        target_user = int(message.text.strip())
    except ValueError:
        await message.answer("❌ Введите корректный ID получателя!\n(Только цифры)")
        return
    
    if target_user == user_id:
        await message.answer("❌ Нельзя отправить BTC самому себе!")
        return
    
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT 1 FROM users WHERE user_id = ?", (target_user,))
    exists = cursor.fetchone()
    conn.close()
    
    if not exists:
        await message.answer("❌ Пользователь с таким ID не найден!")
        return
    
    target_nick = get_user_nickname(target_user)
    await state.update_data(target_user=target_user, target_nick=target_nick)
    await state.set_state(BitcoinStates.waiting_for_transfer_amount)
    
    btc_data = get_user_bitcoin_balance(user_id)
    
    text = (
        "🪙 <b>Перевод Bitcoin</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        f"👤 Получатель: <b>{target_nick}</b>\n"
        f"🆔 ID: <code>{target_user}</code>\n"
        f"💎 Ваш баланс: <b>{format_number(btc_data['btc_balance'])} BTC</b>\n\n"
        "✍️ <b>Введите количество BTC:</b>\n\n"
        "<i>Например: 0.5, 1, 0.001</i>"
    )
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[[types.InlineKeyboardButton(text="❌ Отмена", callback_data="btc_back")]]
    )
    
    await message.answer(text, parse_mode="HTML", reply_markup=kb)

@router.message(BitcoinStates.waiting_for_transfer_amount)
async def process_transfer_amount(message: types.Message, state: FSMContext):
    user_id = message.from_user.id
    
    if not check_user_registered(user_id):
        if message.chat.type != "private":
            await state.clear()
            return
        await message.answer(
            "❌ <b>Вы еще не зарегистрированы!</b>\n\n"
            "💡 Пожалуйста, перейдите в <b>личные сообщения</b> бота и нажмите /start, чтобы активировать игровой профиль!",
            parse_mode="HTML"
        )
        await state.clear()
        return
    
    try:
        amount = float(message.text.replace(",", "."))
    except ValueError:
        await message.answer("❌ Введите корректное число!\nНапример: 0.5, 1, 0.01")
        return
    
    if amount <= 0:
        await message.answer("❌ Количество должно быть больше 0!")
        return
    
    if amount < 0.0001:
        await message.answer("❌ Минимальное количество: 0.0001 BTC!")
        return
    
    btc_data = get_user_bitcoin_balance(user_id)
    
    if amount > btc_data["btc_balance"]:
        await message.answer(f"❌ У вас только {format_number(btc_data['btc_balance'])} BTC!")
        return
    
    if amount > 10:
        await message.answer("❌ Максимум за одну операцию: 10 BTC!")
        return
    
    data = await state.get_data()
    target_user = data.get("target_user")
    target_nick = data.get("target_nick")
    
    await state.update_data(transfer_amount=amount)
    await state.set_state(BitcoinStates.confirm_transfer)
    
    rate = get_current_rate()
    new_balance = btc_data["btc_balance"] - amount
    
    text = (
        "🪙 <b>Подтверждение перевода</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        f"📤 Вы отправляете: <b>{format_number(amount)} BTC</b>\n"
        f"👤 Получатель: <b>{target_nick}</b>\n"
        f"🆔 ID: <code>{target_user}</code>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"💎 После отправки:\n"
        f"{format_number(btc_data['btc_balance'])} BTC → <b>{format_number(new_balance)} BTC</b>\n\n"
        "❓ <i>Подтвердите перевод:</i>"
    )
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="✅ Отправить", callback_data="btc_confirm_transfer")],
            [types.InlineKeyboardButton(text="❌ Отмена", callback_data="btc_back")]
        ]
    )
    
    await message.answer(text, parse_mode="HTML", reply_markup=kb)

@router.callback_query(F.data == "btc_confirm_transfer")
async def cb_confirm_transfer(callback: types.CallbackQuery, state: FSMContext):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        await state.clear()
        return
    
    data = await state.get_data()
    
    target_user = data.get("target_user")
    target_nick = data.get("target_nick")
    amount = data.get("transfer_amount")
    
    btc_data = get_user_bitcoin_balance(user_id)
    
    if amount > btc_data["btc_balance"]:
        await callback.answer("❌ Недостаточно BTC!", show_alert=True)
        await state.clear()
        return
    
    current_time = int(time.time())
    if current_time - btc_data["last_transfer_reset"] > 86400:
        btc_data["daily_transfers"] = 0
    
    if btc_data["daily_transfers"] >= 3:
        await callback.answer("❌ Дневной лимит переводов исчерпан!", show_alert=True)
        await state.clear()
        return
    
    rate = get_current_rate()
    
    update_user_bitcoin_balance(user_id, btc_delta=-amount, transfer_delta=1)
    update_user_bitcoin_balance(target_user, btc_delta=amount)
    
    add_bitcoin_transaction(user_id, "Отправка", amount, 0, rate, target_user)
    add_bitcoin_transaction(target_user, "Получение", amount, 0, rate, user_id)
    add_bitcoin_transfer(user_id, target_user, amount, rate)
    
    await state.clear()
    
    sender_text = (
        "✅ <b>Bitcoin успешно отправлен!</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        f"🪙 Отправлено: <b>{format_number(amount)} BTC</b>\n"
        f"👤 Получатель: <b>{target_nick}</b>\n"
        f"💎 Ваш баланс: <b>{format_number(btc_data['btc_balance'] - amount)} BTC</b>"
    )
    
    receiver_text = (
        "🎉 <b>Вам поступил Bitcoin!</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        f"🪙 Получено: <b>+{format_number(amount)} BTC</b>\n"
        f"👤 Отправитель: <b>{get_user_nickname(user_id)}</b>\n"
        f"📈 Курс: <b>{format_number(rate)} UP</b>"
    )
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[[types.InlineKeyboardButton(text="🪙 В Bitcoin Market", callback_data="btc_back")]]
    )
    
    await callback.message.edit_text(sender_text, parse_mode="HTML", reply_markup=kb)
    
    try:
        await callback.bot.send_message(target_user, receiver_text, parse_mode="HTML")
    except Exception:
        pass
    
    await callback.answer("✅ Перевод выполнен!")

# ========== КУПИТЬ BTC ==========
@router.callback_query(F.data == "btc_buy_menu")
async def cb_buy_btc_menu(callback: types.CallbackQuery, state: FSMContext):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    rate = get_current_rate()
    
    text = (
        "🪙 <b>Покупка Bitcoin</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        f"📈 Текущий курс: <code>1 BTC = {format_number(rate)} UP</code>\n\n"
        "💡 <b>Выберите количество:</b>"
    )
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="🪙 1 BTC", callback_data="btc_buy_1"),
             types.InlineKeyboardButton(text="🪙 0.5 BTC", callback_data="btc_buy_0.5")],
            [types.InlineKeyboardButton(text="🪙 0.2 BTC", callback_data="btc_buy_0.2"),
             types.InlineKeyboardButton(text="🪙 0.1 BTC", callback_data="btc_buy_0.1")],
            [types.InlineKeyboardButton(text="✍️ Своё количество", callback_data="btc_buy_custom")],
            [types.InlineKeyboardButton(text="🔙 Назад", callback_data="btc_back")]
        ]
    )
    
    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
    await callback.answer()

@router.callback_query(F.data.startswith("btc_buy_"))
async def cb_buy_btc_preset(callback: types.CallbackQuery, state: FSMContext):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    value = callback.data.replace("btc_buy_", "")
    
    if value == "custom":
        await state.set_state(BitcoinStates.waiting_for_buy_amount)
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="❌ Отмена", callback_data="btc_back")]]
        )
        text = (
            "🪙 <b>Покупка Bitcoin</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━\n\n"
            "✍️ <b>Введите количество BTC:</b>\n\n"
            "<i>Например: 0.5, 2, 0.01</i>\n"
            "<i>Минимальное количество: 0.001 BTC</i>"
        )
        await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        await callback.answer()
        return
    
    try:
        amount = float(value)
    except ValueError:
        await callback.answer("❌ Ошибка!", show_alert=True)
        return
    
    await show_buy_confirmation(callback.message, user_id, amount)
    await callback.answer()

@router.message(BitcoinStates.waiting_for_buy_amount)
async def process_buy_amount(message: types.Message, state: FSMContext):
    user_id = message.from_user.id
    
    if not check_user_registered(user_id):
        if message.chat.type != "private":
            await state.clear()
            return
        await message.answer(
            "❌ <b>Вы еще не зарегистрированы!</b>\n\n"
            "💡 Пожалуйста, перейдите в <b>личные сообщения</b> бота и нажмите /start, чтобы активировать игровой профиль!",
            parse_mode="HTML"
        )
        await state.clear()
        return
    
    try:
        amount = float(message.text.replace(",", "."))
    except ValueError:
        await message.answer("❌ Введите корректное число!\nНапример: 0.5, 1, 0.01")
        return
    
    if amount <= 0:
        await message.answer("❌ Количество должно быть больше 0!")
        return
    
    if amount < 0.001:
        await message.answer("❌ Минимальное количество: 0.001 BTC!")
        return
    
    await state.clear()
    await show_buy_confirmation(message, user_id, amount)

async def show_buy_confirmation(message, user_id, amount):
    rate = get_current_rate()
    up_cost = int(amount * rate)
    balance = get_user_up_balance(user_id)
    
    if balance < up_cost:
        text = (
            "❌ <b>Недостаточно средств!</b>\n\n"
            f"💰 Вам нужно: <b>{format_number(up_cost)} UP</b>\n"
            f"💎 Ваш баланс: <b>{format_number(balance)} UP</b>"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="🔙 Назад", callback_data="btc_back")]]
        )
        await message.answer(text, parse_mode="HTML", reply_markup=kb)
        return
    
    text = (
        "🪙 <b>Подтверждение покупки</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        f"📈 Текущий курс: <code>1 BTC = {format_number(rate)} UP</code>\n\n"
        f"🪙 Вы покупаете: <b>{format_number(amount)} BTC</b>\n"
        f"💰 Цена: <b>{format_number(up_cost)} UP</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"💎 Ваш баланс: <b>{format_number(balance)} UP</b>\n\n"
        "❓ <i>Подтвердите покупку:</i>"
    )
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="✅ Купить", callback_data=f"btc_confirm_buy_{amount}")],
            [types.InlineKeyboardButton(text="❌ Отмена", callback_data="btc_back")]
        ]
    )
    
    if isinstance(message, types.Message):
        await message.answer(text, parse_mode="HTML", reply_markup=kb)
    else:
        await message.edit_text(text, parse_mode="HTML", reply_markup=kb)

@router.callback_query(F.data.startswith("btc_confirm_buy_"))
async def cb_confirm_buy(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    amount = float(callback.data.replace("btc_confirm_buy_", ""))
    rate = get_current_rate()
    up_cost = int(amount * rate)
    
    balance = get_user_up_balance(user_id)
    
    if balance < up_cost:
        await callback.answer("❌ Недостаточно UP!", show_alert=True)
        return
    
    update_user_up_balance(user_id, -up_cost)
    update_user_bitcoin_balance(user_id, btc_delta=amount, spent_up=up_cost)
    add_bitcoin_transaction(user_id, "Покупка", amount, up_cost, rate)
    
    btc_data = get_user_bitcoin_balance(user_id)
    new_balance_up = get_user_up_balance(user_id)
    
    text = (
        "🎉 <b>Покупка выполнена!</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        f"🪙 Вы приобрели: <b>{format_number(amount)} BTC</b>\n"
        f"💰 Потрачено: <b>{format_number(up_cost)} UP</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"💎 Ваш портфель: <b>{format_number(btc_data['btc_balance'])} BTC</b>\n"
        f"💵 Баланс UP: <b>{format_number(new_balance_up)} UP</b>"
    )
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[[types.InlineKeyboardButton(text="🪙 В Bitcoin Market", callback_data="btc_back")]]
    )
    
    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
    await callback.answer("✅ Покупка выполнена!")

# ========== ПРОДАТЬ BTC ==========
@router.callback_query(F.data == "btc_sell_menu")
async def cb_sell_btc_menu(callback: types.CallbackQuery, state: FSMContext):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    btc_data = get_user_bitcoin_balance(user_id)
    
    if btc_data["btc_balance"] <= 0:
        await callback.answer("❌ У вас нет BTC для продажи!", show_alert=True)
        return
    
    rate = get_current_rate()
    btc_balance = btc_data["btc_balance"]
    
    text = (
        "🪙 <b>Продажа Bitcoin</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        f"📈 Текущий курс: <code>1 BTC = {format_number(rate)} UP</code>\n\n"
        f"💎 Доступно BTC: <b>{format_number(btc_balance)} BTC</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        "💡 <b>Выберите количество:</b>"
    )
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="🪙 1 BTC", callback_data="btc_sell_1") if btc_balance >= 1 else types.InlineKeyboardButton(text="❌", callback_data="btc_none"),
             types.InlineKeyboardButton(text="🪙 0.5 BTC", callback_data="btc_sell_0.5") if btc_balance >= 0.5 else types.InlineKeyboardButton(text="❌", callback_data="btc_none")],
            [types.InlineKeyboardButton(text="🪙 0.2 BTC", callback_data="btc_sell_0.2") if btc_balance >= 0.2 else types.InlineKeyboardButton(text="❌", callback_data="btc_none"),
             types.InlineKeyboardButton(text="🪙 0.1 BTC", callback_data="btc_sell_0.1") if btc_balance >= 0.1 else types.InlineKeyboardButton(text="❌", callback_data="btc_none")],
            [types.InlineKeyboardButton(text="🪙 Все BTC", callback_data="btc_sell_all")],
            [types.InlineKeyboardButton(text="✍️ Своё количество", callback_data="btc_sell_custom")],
            [types.InlineKeyboardButton(text="🔙 Назад", callback_data="btc_back")]
        ]
    )
    
    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
    await callback.answer()

@router.callback_query(F.data == "btc_none")
async def cb_btc_none(callback: types.CallbackQuery):
    await callback.answer("⚠️ Недостаточно BTC!", show_alert=True)

@router.callback_query(F.data.startswith("btc_sell_"))
async def cb_sell_btc_preset(callback: types.CallbackQuery, state: FSMContext):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    value = callback.data.replace("btc_sell_", "")
    btc_data = get_user_bitcoin_balance(user_id)
    
    if value == "custom":
        await state.set_state(BitcoinStates.waiting_for_sell_amount)
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="❌ Отмена", callback_data="btc_back")]]
        )
        text = (
            "🪙 <b>Продажа Bitcoin</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"💎 Доступно BTC: <b>{format_number(btc_data['btc_balance'])} BTC</b>\n\n"
            "✍️ <b>Введите количество BTC для продажи:</b>"
        )
        await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        await callback.answer()
        return
    
    if value == "all":
        amount = btc_data["btc_balance"]
    else:
        try:
            amount = float(value)
        except ValueError:
            await callback.answer("❌ Ошибка!", show_alert=True)
            return
    
    if amount <= 0:
        await callback.answer("❌ Некорректное количество!", show_alert=True)
        return
    
    if amount > btc_data["btc_balance"]:
        await callback.answer(f"❌ У вас только {format_number(btc_data['btc_balance'])} BTC!", show_alert=True)
        return
    
    await show_sell_confirmation(callback.message, user_id, amount)
    await callback.answer()

@router.message(BitcoinStates.waiting_for_sell_amount)
async def process_sell_amount(message: types.Message, state: FSMContext):
    user_id = message.from_user.id
    
    if not check_user_registered(user_id):
        if message.chat.type != "private":
            await state.clear()
            return
        await message.answer(
            "❌ <b>Вы еще не зарегистрированы!</b>\n\n"
            "💡 Пожалуйста, перейдите в <b>личные сообщения</b> бота и нажмите /start, чтобы активировать игровой профиль!",
            parse_mode="HTML"
        )
        await state.clear()
        return
    
    try:
        amount = float(message.text.replace(",", "."))
    except ValueError:
        await message.answer("❌ Введите корректное число!\nНапример: 0.5, 1, 0.01")
        return
    
    if amount <= 0:
        await message.answer("❌ Количество должно быть больше 0!")
        return
    
    btc_data = get_user_bitcoin_balance(user_id)
    
    if amount > btc_data["btc_balance"]:
        await message.answer(f"❌ У вас только {format_number(btc_data['btc_balance'])} BTC!")
        return
    
    await state.clear()
    await show_sell_confirmation(message, user_id, amount)

async def show_sell_confirmation(message, user_id, amount):
    rate = get_current_rate()
    up_receive = int(amount * rate)
    btc_data = get_user_bitcoin_balance(user_id)
    
    text = (
        "🪙 <b>Подтверждение продажи</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        f"📈 Текущий курс: <code>1 BTC = {format_number(rate)} UP</code>\n\n"
        f"🪙 Вы продаёте: <b>{format_number(amount)} BTC</b>\n"
        f"💰 Получите: <b>{format_number(up_receive)} UP</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"💎 После продажи: <b>{format_number(btc_data['btc_balance'] - amount)} BTC</b>\n\n"
        "❓ <i>Подтвердите продажу:</i>"
    )
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="🔴 Продать", callback_data=f"btc_confirm_sell_{amount}")],
            [types.InlineKeyboardButton(text="❌ Отмена", callback_data="btc_back")]
        ]
    )
    
    if isinstance(message, types.Message):
        await message.answer(text, parse_mode="HTML", reply_markup=kb)
    else:
        await message.edit_text(text, parse_mode="HTML", reply_markup=kb)

@router.callback_query(F.data.startswith("btc_confirm_sell_"))
async def cb_confirm_sell(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    amount = float(callback.data.replace("btc_confirm_sell_", ""))
    rate = get_current_rate()
    up_receive = int(amount * rate)
    
    btc_data = get_user_bitcoin_balance(user_id)
    
    if amount > btc_data["btc_balance"]:
        await callback.answer("❌ Недостаточно BTC!", show_alert=True)
        return
    
    update_user_bitcoin_balance(user_id, btc_delta=-amount, earned_up=up_receive)
    update_user_up_balance(user_id, up_receive)
    add_bitcoin_transaction(user_id, "Продажа", amount, up_receive, rate)
    
    new_btc_data = get_user_bitcoin_balance(user_id)
    new_balance_up = get_user_up_balance(user_id)
    
    text = (
        "💰 <b>Продажа выполнена!</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        f"🪙 Продано: <b>{format_number(amount)} BTC</b>\n"
        f"💰 Получено: <b>+{format_number(up_receive)} UP</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"💎 Ваш портфель: <b>{format_number(new_btc_data['btc_balance'])} BTC</b>\n"
        f"💵 Баланс UP: <b>{format_number(new_balance_up)} UP</b>"
    )
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[[types.InlineKeyboardButton(text="🪙 В Bitcoin Market", callback_data="btc_back")]]
    )
    
    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
    await callback.answer("✅ Продажа выполнена!")

# ========== ПОРТФЕЛЬ ==========
@router.callback_query(F.data == "btc_portfolio")
async def cb_btc_portfolio(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    rate = get_current_rate()
    btc_data = get_user_bitcoin_balance(user_id)
    transactions = get_user_transactions(user_id, 5)
    
    portfolio_value = int(btc_data["btc_balance"] * rate)
    
    text = (
        "📊 <b>Мой Bitcoin портфель</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        f"🪙 BTC баланс: <b>{format_number(btc_data['btc_balance'])} BTC</b>\n"
        f"💰 Стоимость: <b>{format_number(portfolio_value)} UP</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"📈 Всего куплено: <b>{format_number(btc_data['total_bought'])} BTC</b>\n"
        f"📉 Всего продано: <b>{format_number(btc_data['total_sold'])} BTC</b>\n"
        f"💸 Потрачено UP: <b>{format_number(btc_data['total_spent_up'])} UP</b>\n"
        f"💵 Заработано UP: <b>{format_number(btc_data['total_earned_up'])} UP</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
    )
    
    if transactions:
        text += "📜 <b>Последние операции:</b>\n"
        for trans in transactions:
            trans_type, btc_amt, up_amt, rate_amt, target, timestamp = trans
            date_str = time.strftime("%d.%m %H:%M", time.localtime(timestamp))
            emoji = "🟢" if trans_type in ["Покупка", "Получение"] else "🔴"
            if target:
                target_text = f" → {get_user_nickname(target)}"
            else:
                target_text = ""
            text += f"{emoji} {trans_type} {format_number(btc_amt)} BTC{target_text} - {date_str}\n"
    else:
        text += "📭 История операций пуста."
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[[types.InlineKeyboardButton(text="🔙 Назад", callback_data="btc_back")]]
    )
    
    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
    await callback.answer()

# ========== ГРАФИК ==========
@router.callback_query(F.data == "btc_chart")
async def cb_btc_chart(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    history = get_rate_history(24)
    rate = get_current_rate()
    
    if not history:
        text = "📈 История курса пока пуста.\nПодождите немного, данные накапливаются..."
    else:
        max_rate = max(r for r, _, _, _ in history)
        min_rate = min(r for r, _, _, _ in history)
        range_rate = max_rate - min_rate if max_rate != min_rate else 1
        
        text = "📈 <b>График курса BTC (24 часа)</b>\n"
        text += "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        
        recent = history[-12:] if len(history) > 12 else history
        
        for i, (h_rate, timestamp, change, event_type) in enumerate(recent):
            norm = int((h_rate - min_rate) / range_rate * 10)
            bar = "█" * norm + "░" * (10 - norm)
            date_str = time.strftime("%H:%M", time.localtime(timestamp))
            emoji = "📈" if change >= 0 else "📉"
            text += f"{date_str} {bar} {format_number(h_rate)} {emoji}\n"
        
        text += "\n━━━━━━━━━━━━━━━━━━━━━━\n"
    
    text += f"📊 Текущий курс: <b>{format_number(rate)} UP</b>"
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[[types.InlineKeyboardButton(text="🔙 Назад", callback_data="btc_back")]]
    )
    
    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
    await callback.answer()

# ========== НАЗАД ==========
@router.callback_query(F.data == "btc_back")
async def cb_btc_back(callback: types.CallbackQuery, state: FSMContext):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    await state.clear()
    await show_bitcoin_menu(callback, user_id, edit=True)
    await callback.answer()

# ========== ЗАПУСК ФОНОВОЙ ЗАДАЧИ ==========
async def start_bitcoin_updater():
    asyncio.create_task(update_bitcoin_rate())