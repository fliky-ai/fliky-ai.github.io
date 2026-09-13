from aiogram import Router, types, F

router = Router()

# ========== КНОПКА ЧАТЫ ==========
@router.message(F.text.casefold().in_({"💬 чаты", "чаты", "чат"}))
async def cmd_chats(message: types.Message):
    # Только в личных сообщениях
    if message.chat.type != "private":
        return
    
    text = (
        "👥 <b>Играйте вместе с другими игроками Upgrade Game</b>\n"
        "и общайтесь в чате!\n\n"
        "━━━━━━━━━━━━━━━━━━━━━━━"
    )
    
    kb = types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="💬 Общий чат", url="https://t.me/UpgradeGame_chat")],
            [types.InlineKeyboardButton(text="📢 Официальный канал", url="https://t.me/UpgradeGame_channel")]
        ]
    )
    
    await message.answer(text, parse_mode="HTML", reply_markup=kb)