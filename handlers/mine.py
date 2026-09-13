
import time
import random
import asyncio
from aiogram import Router, types, F
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.context import FSMContext
from aiogram.exceptions import TelegramRetryAfter, TelegramBadRequest
from database import sqlite3, DB_NAME

router = Router()

# ==================== ЗАЩИТА ОТ ДВОЙНОГО НАЖАТИЯ (АНТИСПАМ ЛОК) ====================
_active_actions = set()

# ==================== СОСТОЯНИЯ FSM ====================
class SellResourceState(StatesGroup):
    waiting_for_amount = State()
    confirm_sale = State()

# ==================== ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ ====================
def init_upgrade_mine_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS upgrade_mine (
            user_id INTEGER PRIMARY KEY,
            energy INTEGER DEFAULT 10,
            max_energy INTEGER DEFAULT 10,
            last_energy_update INTEGER DEFAULT 0,
            exp INTEGER DEFAULT 0,
            level_name TEXT DEFAULT 'Камень 🪨',
            stone INTEGER DEFAULT 0,
            iron INTEGER DEFAULT 0,
            gold INTEGER DEFAULT 0,
            diamond INTEGER DEFAULT 0,
            amethyst INTEGER DEFAULT 0,
            emerald INTEGER DEFAULT 0,
            aquamarine INTEGER DEFAULT 0,
            pickaxe_lvl INTEGER DEFAULT 1,
            backpack_lvl INTEGER DEFAULT 1,
            backpack_max INTEGER DEFAULT 100,
            battery_lvl INTEGER DEFAULT 1,
            regen_lvl INTEGER DEFAULT 1,
            total_mined INTEGER DEFAULT 0,
            total_exp_gained INTEGER DEFAULT 0,
            total_earned_up INTEGER DEFAULT 0
        )
    """)
    
    cursor.execute("PRAGMA table_info(upgrade_mine)")
    columns = [col[1] for col in cursor.fetchall()]
    if "stone" not in columns:
        cursor.execute("ALTER TABLE upgrade_mine ADD COLUMN stone INTEGER DEFAULT 0")
    if "last_energy_update" not in columns:
        cursor.execute("ALTER TABLE upgrade_mine ADD COLUMN last_energy_update INTEGER DEFAULT 0")

    conn.commit()
    conn.close()

init_upgrade_mine_db()

# ==================== ПРОВЕРКА РЕГИСТРАЦИИ ====================
def check_user_registered(user_id: int) -> bool:
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT 1 FROM users WHERE user_id = ?", (user_id,))
    res = cursor.fetchone()
    conn.close()
    return res is not None

# ==================== БЕЗОПАСНЫЙ EDIT TEXT ====================
async def safe_edit_message(message: types.Message, text: str, reply_markup: types.InlineKeyboardMarkup = None, parse_mode: str = "HTML"):
    for _ in range(3):
        try:
            await message.edit_text(text, parse_mode=parse_mode, reply_markup=reply_markup)
            return True
        except TelegramRetryAfter as e:
            await asyncio.sleep(e.retry_after)
        except TelegramBadRequest as e:
            err_msg = str(e).lower()
            if "message is not modified" in err_msg:
                return True
            return False
        except Exception:
            return False
    return False

# ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

def get_or_create_mine_data(user_id):
    current_time = int(time.time())
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT energy, max_energy, last_energy_update, exp, level_name, 
               stone, iron, gold, diamond, amethyst, emerald, aquamarine, 
               pickaxe_lvl, backpack_lvl, backpack_max, battery_lvl, regen_lvl,
               total_mined, total_exp_gained, total_earned_up 
        FROM upgrade_mine WHERE user_id = ?
    """, (user_id,))
    row = cursor.fetchone()
    
    is_new = False
    if not row:
        is_new = True
        cursor.execute("""
            INSERT INTO upgrade_mine (user_id, energy, max_energy, last_energy_update, exp, level_name, backpack_max)
            VALUES (?, 10, 10, ?, 0, 'Камень', 100)
        """, (user_id, current_time))
        conn.commit()
        cursor.execute("""
            SELECT energy, max_energy, last_energy_update, exp, level_name, 
                   stone, iron, gold, diamond, amethyst, emerald, aquamarine, 
                   pickaxe_lvl, backpack_lvl, backpack_max, battery_lvl, regen_lvl,
                   total_mined, total_exp_gained, total_earned_up 
            FROM upgrade_mine WHERE user_id = ?
        """, (user_id,))
        row = cursor.fetchone()
        
    conn.close()
    
    energy, max_energy, last_up, exp, level_name, stone, iron, gold, diamond, amethyst, emerald, aquamarine, pickaxe_lvl, backpack_lvl, backpack_max, battery_lvl, regen_lvl, total_mined, total_exp, total_earned = row
    
    regen_intervals = {1: 300, 2: 180, 3: 120, 4: 60}
    interval = regen_intervals.get(regen_lvl, 60)
    
    if energy < max_energy:
        passed_time = current_time - last_up
        if passed_time >= interval:
            recovered_points = passed_time // interval
            new_energy = min(max_energy, energy + recovered_points)
            new_last_up = last_up + (recovered_points * interval)
            
            conn = sqlite3.connect(DB_NAME)
            cursor = conn.cursor()
            cursor.execute("UPDATE upgrade_mine SET energy = ?, last_energy_update = ? WHERE user_id = ?", (new_energy, new_last_up, user_id))
            conn.commit()
            conn.close()
            energy = new_energy

    return {
        "is_new": is_new,
        "energy": energy, "max_energy": max_energy, "exp": exp, "level_name": level_name,
        "stone": stone, "iron": iron, "gold": gold, "diamond": diamond, "amethyst": amethyst, "emerald": emerald, "aquamarine": aquamarine,
        "pickaxe_lvl": pickaxe_lvl, "backpack_lvl": backpack_lvl, "backpack_max": backpack_max,
        "battery_lvl": battery_lvl, "regen_lvl": regen_lvl,
        "total_mined": total_mined, "total_exp_gained": total_exp, "total_earned_up": total_earned
    }

def update_mine_db(user_id, **kwargs):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    fields = ", ".join([f"{k} = ?" for k in kwargs.keys()])
    values = list(kwargs.values()) + [user_id]
    cursor.execute(f"UPDATE upgrade_mine SET {fields} WHERE user_id = ?", values)
    conn.commit()
    conn.close()

def get_user_balance(user_id):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(users)")
    cols = [col[1] for col in cursor.fetchall()]
    up_col = "balance_up" if "balance_up" in cols else ("balance" if "balance" in cols else None)
    
    if not up_col:
        conn.close()
        return 0
        
    cursor.execute(f"SELECT {up_col} FROM users WHERE user_id = ?", (user_id,))
    res = cursor.fetchone()
    conn.close()
    return res[0] if res else 0

def update_user_balance(user_id, amount):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(users)")
    cols = [col[1] for col in cursor.fetchall()]
    up_col = "balance_up" if "balance_up" in cols else ("balance" if "balance" in cols else None)
    
    if up_col:
        cursor.execute(f"UPDATE users SET {up_col} = {up_col} + ? WHERE user_id = ?", (amount, user_id))
        conn.commit()
    conn.close()

def calculate_mine_level(exp):
    if exp >= 50000:
        return "Легенда"
    elif exp >= 20000:
        return "Аметист"
    elif exp >= 10000:
        return "Изумруд"
    elif exp >= 5000:
        return "Алмаз"
    elif exp >= 2000:
        return "Золото"
    elif exp >= 500:
        return "Железо"
    else:
        return "Камень"

def generate_energy_bar(current, max_e):
    filled_blocks = int((current / max_e) * 10) if max_e > 0 else 0
    filled_blocks = max(0, min(10, filled_blocks))
    return "🟩" * filled_blocks + "⬜" * (10 - filled_blocks)

# ==================== ГЛАВНОЕ МЕНЮ ШАХТЫ ====================

@router.message(F.text.casefold().in_({"⛏ моя шахта", "шахта", "mine", "/mine"}))
async def cmd_my_mine(message: types.Message):
    uid = message.from_user.id
    
    # Проверяем зарегистрирован ли пользователь
    if not check_user_registered(uid):
        if message.chat.type != "private":
            return
        await message.answer(
            "❌ <b>Вы еще не зарегистрированы!</b>\n\n"
            "💡 Пожалуйста, перейдите в <b>личные сообщения</b> бота и нажмите /start, чтобы активировать игровой профиль!",
            parse_mode="HTML"
        )
        return
    
    if uid in _active_actions:
        return
    _active_actions.add(uid)
    try:
        data = get_or_create_mine_data(uid)
        correct_lvl = calculate_mine_level(data["exp"])
        if correct_lvl != data["level_name"]:
            update_mine_db(uid, level_name=correct_lvl)
            data["level_name"] = correct_lvl

        total_backpack_items = data["stone"] + data["iron"] + data["gold"] + data["diamond"] + data["amethyst"] + data["emerald"] + data["aquamarine"]
        energy_bar = generate_energy_bar(data["energy"], data["max_energy"])

        text = (
            "💎 <b>ТЕРРИТОРИЯ КРИСТАЛЛОВ • ШАХТА</b> 💎\n"
            "━━━━━━━━━━━━━━━━━━━━━━\n"
            f"🔋 <b>Энергия:</b> {energy_bar} <code>{data['energy']}/{data['max_energy']}</code>\n"
            f"🎯 <b>Опыт:</b> <code>{data['exp']:,}</code> XP\n"
            f"🪨 <b>Ранг:</b> <b>{data['level_name']}</b>\n"
            f"📦 <b>Рюкзак:</b> <code>{total_backpack_items}/{data['backpack_max']}</code> ед.\n"
            "━━━━━━━━━━━━━━━━━━━━━━"
        )

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="⛏ Начать копать", callback_data="mine_dig")],
                [types.InlineKeyboardButton(text="🎒 Инвентарь", callback_data="mine_inventory"),
                 types.InlineKeyboardButton(text="🛒 Черный рынок", callback_data="mine_sell_menu")],
                [types.InlineKeyboardButton(text="⚙️ Мастерская", callback_data="mine_upgrades"),
                 types.InlineKeyboardButton(text="📊 Статистика", callback_data="mine_stats")]
            ]
        )
        await message.answer(text, parse_mode="HTML", reply_markup=kb)
    finally:
        _active_actions.remove(uid)

@router.callback_query(F.data == "open_mine_main")
async def callback_open_mine_main(callback: types.CallbackQuery):
    uid = callback.from_user.id
    
    if not check_user_registered(uid):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    if uid in _active_actions:
        await callback.answer("⏳ Подождите, действие выполняется...", cache_time=1)
        return
    _active_actions.add(uid)
    try:
        data = get_or_create_mine_data(uid)
        correct_lvl = calculate_mine_level(data["exp"])
        if correct_lvl != data["level_name"]:
            update_mine_db(uid, level_name=correct_lvl)
            data["level_name"] = correct_lvl

        total_backpack_items = data["stone"] + data["iron"] + data["gold"] + data["diamond"] + data["amethyst"] + data["emerald"] + data["aquamarine"]
        energy_bar = generate_energy_bar(data["energy"], data["max_energy"])

        text = (
            "💎 <b>ТЕРРИТОРИЯ КРИСТАЛЛОВ • ШАХТА</b> 💎\n"
            "━━━━━━━━━━━━━━━━━━━━━━\n"
            f"🔋 <b>Энергия:</b> {energy_bar} <code>{data['energy']}/{data['max_energy']}</code>\n"
            f"🎯 <b>Опыт:</b> <code>{data['exp']:,}</code> XP\n"
            f"🪨 <b>Ранг:</b> <b>{data['level_name']}</b>\n"
            f"📦 <b>Рюкзак:</b> <code>{total_backpack_items}/{data['backpack_max']}</code> ед.\n"
            "━━━━━━━━━━━━━━━━━━━━━━"
        )

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="⛏ Начать копать", callback_data="mine_dig")],
                [types.InlineKeyboardButton(text="🎒 Инвентарь", callback_data="mine_inventory"),
                 types.InlineKeyboardButton(text="🛒 Черный рынок", callback_data="mine_sell_menu")],
                [types.InlineKeyboardButton(text="⚙️ Мастерская", callback_data="mine_upgrades"),
                 types.InlineKeyboardButton(text="📊 Статистика", callback_data="mine_stats")]
            ]
        )

        await safe_edit_message(callback.message, text, reply_markup=kb)
        await callback.answer()
    finally:
        _active_actions.remove(uid)


# ==================== ИНВЕНТАРЬ РЕСУРСОВ ====================

@router.callback_query(F.data == "mine_inventory")
async def callback_mine_inventory(callback: types.CallbackQuery):
    uid = callback.from_user.id
    
    if not check_user_registered(uid):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    if uid in _active_actions:
        await callback.answer()
        return
    _active_actions.add(uid)
    try:
        d = get_or_create_mine_data(uid)
        total_ores = d["stone"] + d["iron"] + d["gold"] + d["diamond"] + d["amethyst"] + d["emerald"] + d["aquamarine"]

        text = (
            "🎒 <b>ТВОЙ СКЛАД РЕСУРСОВ</b> 🎒\n"
            "━━━━━━━━━━━━━━━━━━━━━━\n"
            f"🪨 Камень: <code>{d['stone']}</code>\n"
            f"⛓ Железо: <code>{d['iron']}</code>\n"
            f"🥇 Золото: <code>{d['gold']}</code>\n"
            f"💎 Алмаз: <code>{d['diamond']}</code>\n"
            f"💜 Аметист: <code>{d['amethyst']}</code>\n"
            f"💚 Изумруд: <code>{d['emerald']}</code>\n"
            f"🔷 Аквамарин: <code>{d['aquamarine']}</code>\n"
            "━━━━━━━━━━━━━━━━━━━━━━\n"
            f"📦 Занято мест: <code>{total_ores}/{d['backpack_max']}</code>"
        )

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="🔙 Вернуться в шахту", callback_data="open_mine_main")]
            ]
        )

        await safe_edit_message(callback.message, text, reply_markup=kb)
        await callback.answer()
    finally:
        _active_actions.remove(uid)


# ==================== ДОБЫЧА РЕСУРСОВ ====================

@router.callback_query(F.data == "mine_dig")
async def callback_mine_dig(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    if user_id in _active_actions:
        await callback.answer("⛏ Добыча уже выполняется...\nПодождите немного ⚡", show_alert=True)
        return
        
    _active_actions.add(user_id)
    try:
        await callback.answer()

        d = get_or_create_mine_data(user_id)

        if d["energy"] <= 0:
            await safe_edit_message(callback.message, "❌ Недостаточно энергии для добычи!")
            return

        total_ores = d["stone"] + d["iron"] + d["gold"] + d["diamond"] + d["amethyst"] + d["emerald"] + d["aquamarine"]
        resources_to_mine = d["pickaxe_lvl"]
        
        if total_ores + resources_to_mine > d["backpack_max"]:
            await safe_edit_message(callback.message, "🎒 Твой рюкзак забит под завязку!")
            return

        new_energy = d["energy"] - 1
        update_mine_db(user_id, energy=new_energy)
        d["energy"] = new_energy

        energy_bar = generate_energy_bar(d["energy"], d["max_energy"])
        process_text = (
            "⛏ <b>Добыча руды...</b>\n\n"
            "⏳ <b>Ищем ресурсы...</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━\n"
            f"🔋 <b>Энергия:</b> {energy_bar} <code>{d['energy']}/{d['max_energy']}</code> (-1 ⚡)"
        )
        
        await safe_edit_message(callback.message, process_text)
        await asyncio.sleep(1.5)

        roll = random.random()
        if roll < 0.45:
            ore_name, ore_col, exp_gain = "🪨 Камень", "stone", 5
        elif roll < 0.75:
            ore_name, ore_col, exp_gain = "⛓ Железо", "iron", 12
        elif roll < 0.90:
            ore_name, ore_col, exp_gain = "🥇 Золото", "gold", 25
        elif roll < 0.96:
            ore_name, ore_col, exp_gain = "💎 Алмаз", "diamond", 50
        elif roll < 0.985:
            ore_name, ore_col, exp_gain = "💜 Аметист", "amethyst", 80
        elif roll < 0.995:
            ore_name, ore_col, exp_gain = "💚 Изумруд", "emerald", 120
        else:
            ore_name, ore_col, exp_gain = "🔷 Аквамарин", "aquamarine", 180

        actual_mined = 1 * resources_to_mine
        new_ore_val = d[ore_col] + actual_mined
        new_exp = d["exp"] + exp_gain
        new_level_name = calculate_mine_level(new_exp)

        update_mine_db(
            user_id,
            exp=new_exp,
            level_name=new_level_name,
            total_mined=d["total_mined"] + actual_mined,
            total_exp_gained=d["total_exp_gained"] + exp_gain,
            **{ore_col: new_ore_val}
        )

        d_updated = get_or_create_mine_data(user_id)
        energy_bar_res = generate_energy_bar(d_updated["energy"], d_updated["max_energy"])

        result_text = (
            "✅ <b>Добыча завершена!</b>\n\n"
            f"🪨 <b>Получено:</b>\n"
            f"{ore_name} x{actual_mined}\n\n"
            f"⚡ <b>Энергия:</b> -1\n"
            f"🎯 <b>Опыт:</b> +{exp_gain} XP\n"
            "━━━━━━━━━━━━━━━━━━━━━━"
        )

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="⛏ Копать еще", callback_data="mine_dig")],
                [types.InlineKeyboardButton(text="🔙 В шахту", callback_data="open_mine_main")]
            ]
        )

        await safe_edit_message(callback.message, result_text, reply_markup=kb)
    finally:
        _active_actions.remove(user_id)


# ==================== УЛУЧШЕНИЯ ШАХТЫ (МАСТЕРСКАЯ) ====================

@router.callback_query(F.data == "mine_upgrades")
async def callback_mine_upgrades(callback: types.CallbackQuery):
    uid = callback.from_user.id
    
    if not check_user_registered(uid):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    if uid in _active_actions:
        await callback.answer()
        return
    _active_actions.add(uid)
    try:
        d = get_or_create_mine_data(uid)

        text = (
            "⚙️ <b>МАСТЕРСКАЯ УЛУЧШЕНИЙ</b> ⚙️\n"
            "━━━━━━━━━━━━━━━━━━━━━━\n"
            f"⛏ <b>Кирка:</b> Уровень <code>{d['pickaxe_lvl']}</code>\n"
            f"🎒 <b>Рюкзак:</b> <code>{d['backpack_max']}</code> мест (Ур. <code>{d['backpack_lvl']}</code>)\n"
            f"🔋 <b>Батарея:</b> <code>{d['max_energy']}</code> энерг. (Ур. <code>{d['battery_lvl']}</code>)\n"
            f"⚡ <b>Регенерация:</b> Уровень <code>{d['regen_lvl']}</code>\n"
            "━━━━━━━━━━━━━━━━━━━━━━\n"
            "💡 <i>Выберите модуль для прокачки:</i>"
        )

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="⛏ Улучшить кирку", callback_data="up_pickaxe"),
                 types.InlineKeyboardButton(text="🎒 Улучшить рюкзак", callback_data="up_backpack")],
                [types.InlineKeyboardButton(text="🔋 Заряд батареи", callback_data="up_battery"),
                 types.InlineKeyboardButton(text="⚡ Ускорить реген", callback_data="up_regen")],
                [types.InlineKeyboardButton(text="🔙 Вернуться в шахту", callback_data="open_mine_main")]
            ]
        )

        await safe_edit_message(callback.message, text, reply_markup=kb)
        await callback.answer()
    finally:
        _active_actions.remove(uid)

# ---------- 1. КИРКА ----------
@router.callback_query(F.data == "up_pickaxe")
async def callback_up_pickaxe(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    d = get_or_create_mine_data(user_id)
    lvl = d["pickaxe_lvl"]
    price = lvl * 500

    text = (
        "⚙️ <b>МОДУЛЬ: КИРКА</b> ⚙️\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"⛏ Уровень: <code>{lvl}</code> ➜ <code>{lvl + 1}</code>\n\n"
        "📈 <b>Эффект после покупки:</b>\n"
        "• Добыча: <code>+1</code> ресурс за копание\n"
        f"• Новый уровень кирки: <code>{lvl + 1}</code>\n\n"
        f"💰 <b>Стоимость:</b> <code>{price:,}</code> UP\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        "❓ <i>Подтверждаете улучшение?</i>"
    )
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="✅ Купить", callback_data="confirm_buy_pickaxe"),
             types.InlineKeyboardButton(text="❌ Отмена", callback_data="mine_upgrades")]
        ]
    )
    await safe_edit_message(callback.message, text, reply_markup=kb)
    await callback.answer()

@router.callback_query(F.data == "confirm_buy_pickaxe")
async def callback_confirm_buy_pickaxe(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    d = get_or_create_mine_data(user_id)
    lvl = d["pickaxe_lvl"]
    price = lvl * 500

    if get_user_balance(user_id) < price:
        await callback.answer(f"❌ Недостаточно средств! Нужно: {price:,} UP", show_alert=True)
        return

    update_user_balance(user_id, -price)
    update_mine_db(user_id, pickaxe_lvl=lvl + 1)

    text = (
        "✅ <b>УСПЕШНО КУПЛЕНО!</b> ✅\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        "⛏ <b>Кирка:</b>\n"
        f"• Было: уровень <code>{lvl}</code>\n"
        f"• Стало: уровень <code>{lvl + 1}</code>\n\n"
        f"💰 Списано: <code>{price:,}</code> UP\n"
        "━━━━━━━━━━━━━━━━━━━━━━"
    )
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[[types.InlineKeyboardButton(text="⚙️ К улучшениям", callback_data="mine_upgrades")]]
    )
    await safe_edit_message(callback.message, text, reply_markup=kb)
    await callback.answer()


# ---------- 2. РЮКЗАК ----------
@router.callback_query(F.data == "up_backpack")
async def callback_up_backpack(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    d = get_or_create_mine_data(user_id)
    lvl = d["backpack_lvl"]
    price = lvl * 1000
    current_max = d["backpack_max"]
    new_max = current_max + 50

    text = (
        "⚙️ <b>МОДУЛЬ: РЮКЗАК</b> ⚙️\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🎒 Уровень: <code>{lvl}</code> ➜ <code>{lvl + 1}</code>\n\n"
        "📈 <b>Эффект после покупки:</b>\n"
        f"• Вместимость: <code>{current_max}</code> ➜ <code>{new_max}</code> мест\n"
        f"• Новый уровень рюкзака: <code>{lvl + 1}</code>\n\n"
        f"💰 <b>Стоимость:</b> <code>{price:,}</code> UP\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        "❓ <i>Подтверждаете улучшение?</i>"
    )
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="✅ Купить", callback_data="confirm_buy_backpack"),
             types.InlineKeyboardButton(text="❌ Отмена", callback_data="mine_upgrades")]
        ]
    )
    await safe_edit_message(callback.message, text, reply_markup=kb)
    await callback.answer()

@router.callback_query(F.data == "confirm_buy_backpack")
async def callback_confirm_buy_backpack(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    d = get_or_create_mine_data(user_id)
    lvl = d["backpack_lvl"]
    price = lvl * 1000
    current_max = d["backpack_max"]
    new_max = current_max + 50

    if get_user_balance(user_id) < price:
        await callback.answer(f"❌ Недостаточно средств! Нужно: {price:,} UP", show_alert=True)
        return

    update_user_balance(user_id, -price)
    update_mine_db(user_id, backpack_lvl=lvl + 1, backpack_max=new_max)

    text = (
        "✅ <b>УСПЕШНО КУПЛЕНО!</b> ✅\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        "🎒 <b>Рюкзак:</b>\n"
        f"• Вместимость: <code>{current_max}</code> ➜ <code>{new_max}</code> мест\n"
        f"• Уровень: <code>{lvl}</code> ➜ <code>{lvl + 1}</code>\n\n"
        f"💰 Списано: <code>{price:,}</code> UP\n"
        "━━━━━━━━━━━━━━━━━━━━━━"
    )
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[[types.InlineKeyboardButton(text="⚙️ К улучшениям", callback_data="mine_upgrades")]]
    )
    await safe_edit_message(callback.message, text, reply_markup=kb)
    await callback.answer()


# ---------- 3. МАКСИМАЛЬНАЯ ЭНЕРГИЯ (БАТАРЕЯ) ----------
@router.callback_query(F.data == "up_battery")
async def callback_up_battery(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    d = get_or_create_mine_data(user_id)
    lvl = d["battery_lvl"]
    price = lvl * 1500
    current_max = d["max_energy"]
    new_max = current_max + 1

    text = (
        "⚙️ <b>МОДУЛЬ: БАТАРЕЯ</b> ⚙️\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🔋 Уровень: <code>{lvl}</code> ➜ <code>{lvl + 1}</code>\n\n"
        "📈 <b>Эффект после покупки:</b>\n"
        f"• Макс. энергия: <code>{current_max}</code> ➜ <code>{new_max}</code> ⚡\n"
        f"• Новый уровень батареи: <code>{lvl + 1}</code>\n\n"
        f"💰 <b>Стоимость:</b> <code>{price:,}</code> UP\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        "❓ <i>Подтверждаете улучшение?</i>"
    )
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="✅ Купить", callback_data="confirm_buy_battery"),
             types.InlineKeyboardButton(text="❌ Отмена", callback_data="mine_upgrades")]
        ]
    )
    await safe_edit_message(callback.message, text, reply_markup=kb)
    await callback.answer()

@router.callback_query(F.data == "confirm_buy_battery")
async def callback_confirm_buy_battery(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    d = get_or_create_mine_data(user_id)
    lvl = d["battery_lvl"]
    price = lvl * 1500
    current_max = d["max_energy"]
    new_max = current_max + 1

    if get_user_balance(user_id) < price:
        await callback.answer(f"❌ Недостаточно средств! Нужно: {price:,} UP", show_alert=True)
        return

    update_user_balance(user_id, -price)
    update_mine_db(user_id, battery_lvl=lvl + 1, max_energy=new_max, energy=d["energy"] + 1)

    text = (
        "✅ <b>УСПЕШНО КУПЛЕНО!</b> ✅\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        "🔋 <b>Максимальная энергия:</b>\n"
        f"• Предел: <code>{current_max}</code> ➜ <code>{new_max}</code> ⚡\n"
        f"• Уровень: <code>{lvl}</code> ➜ <code>{lvl + 1}</code>\n\n"
        f"💰 Списано: <code>{price:,}</code> UP\n"
        "━━━━━━━━━━━━━━━━━━━━━━"
    )
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[[types.InlineKeyboardButton(text="⚙️ К улучшениям", callback_data="mine_upgrades")]]
    )
    await safe_edit_message(callback.message, text, reply_markup=kb)
    await callback.answer()


# ---------- 4. СКОРОСТЬ ВОССТАНОВЛЕНИЯ ЭНЕРГИИ (РЕГЕНЕРАЦИЯ) ----------
@router.callback_query(F.data == "up_regen")
async def callback_up_regen(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    d = get_or_create_mine_data(user_id)
    lvl = d["regen_lvl"]

    if lvl >= 4:
        await callback.answer("❌ Достигнут максимальный уровень регенерации!", show_alert=True)
        return

    price = lvl * 3000

    text = (
        "⚙️ <b>МОДУЛЬ: РЕГЕНЕРАЦИЯ</b> ⚙️\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"⚡ Уровень: <code>{lvl}</code> ➜ <code>{lvl + 1}</code>\n\n"
        "📈 <b>Эффект после покупки:</b>\n"
        "• Ускорение восстановления энергии\n"
        f"• Новый уровень регена: <code>{lvl + 1}</code>\n\n"
        f"💰 <b>Стоимость:</b> <code>{price:,}</code> UP\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        "❓ <i>Подтверждаете улучшение?</i>"
    )
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="✅ Купить", callback_data="confirm_buy_regen"),
             types.InlineKeyboardButton(text="❌ Отмена", callback_data="mine_upgrades")]
        ]
    )
    await safe_edit_message(callback.message, text, reply_markup=kb)
    await callback.answer()

@router.callback_query(F.data == "confirm_buy_regen")
async def callback_confirm_buy_regen(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    d = get_or_create_mine_data(user_id)
    lvl = d["regen_lvl"]

    if lvl >= 4:
        await callback.answer("❌ Достигнут максимальный уровень регенерации!", show_alert=True)
        return

    price = lvl * 3000

    if get_user_balance(user_id) < price:
        await callback.answer(f"❌ Недостаточно средств! Нужно: {price:,} UP", show_alert=True)
        return

    update_user_balance(user_id, -price)
    update_mine_db(user_id, regen_lvl=lvl + 1)

    text = (
        "✅ <b>УСПЕШНО КУПЛЕНО!</b> ✅\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        "⚡ <b>Скорость регенерации:</b>\n"
        f"• Уровень: <code>{lvl}</code> ➜ <code>{lvl + 1}</code>\n\n"
        f"💰 Списано: <code>{price:,}</code> UP\n"
        "━━━━━━━━━━━━━━━━━━━━━━"
    )
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[[types.InlineKeyboardButton(text="⚙️ К улучшениям", callback_data="mine_upgrades")]]
    )
    await safe_edit_message(callback.message, text, reply_markup=kb)
    await callback.answer()


# ==================== ПРОДАЖА РЕСУРСОВ (FSM) ====================

PRICES = {
    "stone": 2, "iron": 10, "gold": 50, "diamond": 300,
    "amethyst": 1000, "emerald": 2500, "aquamarine": 6000
}
NAMES = {
    "stone": "🪨 Камень", "iron": "⛓ Железо", "gold": "🥇 Золото",
    "diamond": "💎 Алмаз", "amethyst": "💜 Аметист", "emerald": "💚 Изумруд", "aquamarine": "🔷 Аквамарин"
}

@router.callback_query(F.data == "mine_sell_menu")
async def callback_mine_sell_menu(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    text = (
        "🛒 <b>ТЕНЬ-РЫНОК • ПРОДАЖА РЕСУРСОВ</b> 🛒\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        "💡 <i>Выберите определенный минерал для продажи или сбросьте всё разом:</i>"
    )
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="🪨 Камень", callback_data="sell_res_stone"),
             types.InlineKeyboardButton(text="⛓ Железо", callback_data="sell_res_iron")],
            [types.InlineKeyboardButton(text="🥇 Золото", callback_data="sell_res_gold"),
             types.InlineKeyboardButton(text="💎 Алмаз", callback_data="sell_res_diamond")],
            [types.InlineKeyboardButton(text="💜 Аметист", callback_data="sell_res_amethyst"),
             types.InlineKeyboardButton(text="💚 Изумруд", callback_data="sell_res_emerald")],
            [types.InlineKeyboardButton(text="🔷 Аквамарин", callback_data="sell_res_aquamarine")],
            [types.InlineKeyboardButton(text="📦 Продать весь рюкзак", callback_data="sell_all_resources")],
            [types.InlineKeyboardButton(text="🔙 Вернуться в шахту", callback_data="open_mine_main")]
        ]
    )
    await safe_edit_message(callback.message, text, reply_markup=kb)
    await callback.answer()

@router.callback_query(F.data.startswith("sell_res_"))
async def callback_select_resource_to_sell(callback: types.CallbackQuery, state: FSMContext):
    res_key = callback.data.replace("sell_res_", "")
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    d = get_or_create_mine_data(user_id)
    count = d.get(res_key, 0)

    if count <= 0:
        await callback.answer("❌ У тебя нет этого ресурса в наличии!", show_alert=True)
        return

    await state.set_state(SellResourceState.waiting_for_amount)
    await state.update_data(res_key=res_key, max_count=count)

    text = (
        f"🛒 <b>ПРОДАЖА: {NAMES.get(res_key)}</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"📦 Доступно на складе: <code>{count}</code> шт.\n\n"
        "⌨️ <i>Введите точное количество для продажи в чат:</i>"
    )
    kb = types.InlineKeyboardMarkup(inline_keyboard=[[types.InlineKeyboardButton(text="❌ Отмена", callback_data="mine_sell_menu")]])
    await safe_edit_message(callback.message, text, reply_markup=kb)
    await callback.answer()

@router.message(SellResourceState.waiting_for_amount)
async def process_sell_amount_input(message: types.Message, state: FSMContext):
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
    
    if not message.text.isdigit():
        await message.answer("❌ Ошибка! Введите числовое значение.")
        return

    amount = int(message.text)
    data = await state.get_data()
    res_key = data.get("res_key")
    max_count = data.get("max_count")

    if amount <= 0 or amount > max_count:
        await message.answer(f"❌ Неверное количество! У тебя есть только: {max_count} шт.")
        return

    total_price = amount * PRICES.get(res_key, 1)
    await state.update_data(sell_amount=amount, total_price=total_price)
    await state.set_state(SellResourceState.confirm_sale)

    text = (
        "🛒 <b>ПОДТВЕРЖДЕНИЕ СДЕЛКИ</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"• Ресурс: {NAMES.get(res_key)}\n"
        f"• Количество: <code>{amount}</code> шт.\n"
        f"• Сумма выплаты: <code>{total_price:,}</code> UP\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        "❓ <i>Продаем?</i>"
    )
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="✅ Продать", callback_data="confirm_sell_yes"),
             types.InlineKeyboardButton(text="❌ Отмена", callback_data="mine_sell_menu")]
        ]
    )
    await message.answer(text, parse_mode="HTML", reply_markup=kb)

@router.callback_query(SellResourceState.confirm_sale, F.data == "confirm_sell_yes")
async def callback_confirm_sale(callback: types.CallbackQuery, state: FSMContext):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        await state.clear()
        return
    
    data = await state.get_data()
    res_key, amount, total_price = data.get("res_key"), data.get("sell_amount"), data.get("total_price")

    d = get_or_create_mine_data(user_id)
    update_mine_db(user_id, total_earned_up=d["total_earned_up"] + total_price, **{res_key: d.get(res_key, 0) - amount})
    update_user_balance(user_id, total_price)
    await state.clear()

    text = (
        "✅ <b>СДЕЛКА УСПЕШНО ЗАВЕРШЕНА!</b> ✅\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"💰 Вы получили на счет: <code>{total_price:,}</code> UP\n"
        "━━━━━━━━━━━━━━━━━━━━━━"
    )
    kb = types.InlineKeyboardMarkup(inline_keyboard=[[types.InlineKeyboardButton(text="🔙 В шахту", callback_data="open_mine_main")]])
    await safe_edit_message(callback.message, text, reply_markup=kb)
    await callback.answer()

@router.callback_query(F.data == "sell_all_resources")
async def callback_sell_all_resources(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    
    if not check_user_registered(user_id):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    d = get_or_create_mine_data(user_id)

    total_earned = 0
    res_keys = ["stone", "iron", "gold", "diamond", "amethyst", "emerald", "aquamarine"]
    update_dict = {}

    for r in res_keys:
        count = d.get(r, 0)
        if count > 0:
            total_earned += count * PRICES.get(r, 1)
            update_dict[r] = 0

    if total_earned <= 0:
        await callback.answer("❌ Твой рюкзак абсолютно пуст!", show_alert=True)
        return

    update_mine_db(user_id, total_earned_up=d["total_earned_up"] + total_earned, **update_dict)
    update_user_balance(user_id, total_earned)

    text = (
        "✅ <b>ВСЕ РЕСУРСЫ ПРОДАНЫ!</b> ✅\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"💰 Выручка с продажи: <code>{total_earned:,}</code> UP\n"
        "━━━━━━━━━━━━━━━━━━━━━━"
    )
    kb = types.InlineKeyboardMarkup(inline_keyboard=[[types.InlineKeyboardButton(text="🔙 В шахту", callback_data="open_mine_main")]])
    await safe_edit_message(callback.message, text, reply_markup=kb)
    await callback.answer()


# ==================== СТАТИСТИКА ШАХТЫ ====================

@router.callback_query(F.data == "mine_stats")
async def callback_mine_stats(callback: types.CallbackQuery):
    uid = callback.from_user.id
    
    if not check_user_registered(uid):
        await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
        return
    
    if uid in _active_actions:
        await callback.answer()
        return
    _active_actions.add(uid)
    try:
        d = get_or_create_mine_data(uid)

        text = (
            "📊 <b>СТАТИСТИКА ШАХТЕРА</b> 📊\n"
            "━━━━━━━━━━━━━━━━━━━━━━\n"
            f"⛏ Добыто руды: <code>{d['total_mined']:,}</code> ед.\n"
            f"🎯 Получено опыта: <code>{d['total_exp_gained']:,}</code> XP\n"
            f"💰 Заработано с продаж: <code>{d['total_earned_up']:,}</code> UP\n"
            "━━━━━━━━━━━━━━━━━━━━━━"
        )

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="🔙 Вернуться в шахту", callback_data="open_mine_main")]]
        )

        await safe_edit_message(callback.message, text, reply_markup=kb)
        await callback.answer()
    finally:
        _active_actions.remove(uid)