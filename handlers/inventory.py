import sqlite3
from aiogram import Router, types, F
from database import DB_NAME

router = Router()

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

def get_mine_data(user_id):
    """Получает данные шахты игрока"""
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT stone, iron, gold, diamond, amethyst, emerald, aquamarine, backpack_max
            FROM upgrade_mine WHERE user_id = ?
        """, (user_id,))
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return {
                "stone": 0, "iron": 0, "gold": 0, "diamond": 0,
                "amethyst": 0, "emerald": 0, "aquamarine": 0,
                "backpack_max": 100
            }
        
        return {
            "stone": row[0] or 0,
            "iron": row[1] or 0,
            "gold": row[2] or 0,
            "diamond": row[3] or 0,
            "amethyst": row[4] or 0,
            "emerald": row[5] or 0,
            "aquamarine": row[6] or 0,
            "backpack_max": row[7] or 100
        }
    except Exception:
        return {
            "stone": 0, "iron": 0, "gold": 0, "diamond": 0,
            "amethyst": 0, "emerald": 0, "aquamarine": 0,
            "backpack_max": 100
        }

# ========== КОМАНДА ИНВЕНТАРЬ ==========
@router.message(F.text.casefold().in_({"инвентарь", "инвентар", "inv", "inventory", "🎒 инвентарь"}))
async def cmd_inventory(message: types.Message):
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
    
    d = get_mine_data(user_id)
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
    
    await message.answer(text, parse_mode="HTML")