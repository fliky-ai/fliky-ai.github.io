from aiogram import Router, types, F

router = Router()

@router.message(F.text == "📜 Политика")
async def cmd_policy(message: types.Message):
    if message.chat.type != "private":
        return

    text = (
        "📜 <b>Политика конфиденциальности UpGrade</b>\n\n"
        "Используя нашего Telegram-бота, вы соглашаетесь с правилами проекта, порядком использования игровой валюты и защиты аккаунта.\n\n"
        "🔗 Ознакомиться с полным текстом можно по ссылке ниже:\n"
        "👉 <a href='https://teletype.in/@dauletbro/Upgrade-Bot'>Открыть документ политики</a>"
    )

    await message.answer(text, parse_mode="HTML", disable_web_page_preview=False)
