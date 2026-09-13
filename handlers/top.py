from aiogram import Router, types, F
from database import get_top_players, sqlite3, DB_NAME

router = Router()

def check_user_registered(user_id: int) -> bool:
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT 1 FROM users WHERE user_id = ?", (user_id,))
    res = cursor.fetchone()
    conn.close()
    return res is not None

def get_user_nickname(user_id):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT nickname FROM users WHERE user_id = ?", (user_id,))
    res = cursor.fetchone()
    conn.close()
    if res and res[0]:
        return res[0]
    return "Игрок"

@router.message(F.text.casefold().in_({"топ", "топ 10", "топ10"}))
async def show_top_command(message: types.Message):
    user_id = message.from_user.id
    
    # Проверяем зарегистрирован ли пользователь
    if not check_user_registered(user_id):
        if message.chat.type != "private":
            return
        await message.answer(
            "❌ <b>Вы еще не зарегистрированы!</b>\n\n"
            "💡 Пожалуйста, перейдите в <b>личные сообщения</b> бота и нажмите /start, чтобы активировать игровой профиль!",
            parse_mode="HTML"
        )
        return
    
    top_list = get_top_players()
    
    if not top_list:
        await message.answer("🏆 Рейтинг пока пуст!")
        return

    text = "🏆 <b>Топ-10 богатейших игроков:</b>\n\n"
    medals = ["🥇", "🥈", "🥉"]
    
    for index, (user_id, balance) in enumerate(top_list, start=1):
        place_icon = medals[index - 1] if index <= 3 else f"<b>{index}.</b>"
        
        # Получаем актуальный ник игрока из базы
        nickname = get_user_nickname(user_id)
        player_link = f"<a href='tg://user?id={user_id}'>{nickname}</a>"
        
        text += f"{place_icon} {player_link} — <code>{balance:,} UP</code>\n"

    await message.answer(text, parse_mode="HTML")
