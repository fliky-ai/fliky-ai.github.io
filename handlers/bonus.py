import logging
from aiogram import Router, types, F
from database import claim_daily_bonus, check_user_registered

logger = logging.getLogger(__name__)
router = Router()


@router.message(F.text == "🎁 Бонус")
async def cmd_bonus(message: types.Message):
    try:
        user_id = message.from_user.id if message.from_user else None
        if not user_id:
            return

        if not check_user_registered(user_id):
            if message.chat.type != "private":
                return
            await message.answer(
                "❌ <b>Вы еще не зарегистрированы!</b>\n\n"
                "💡 Пожалуйста, перейдите в <b>личные сообщения</b> бота и нажмите /start, чтобы активировать игровой профиль!",
                parse_mode="HTML"
            )
            return

        success, data1, data2 = claim_daily_bonus(user_id)

        # --- Бонус выдан ---
        if success:
            reward = data1
            new_balance = data2
            text = (
                "🎁 <b>Вы успешно забрали ежедневный бонус!</b>\n\n"
                f"💰 Вам начислено: <b>+{reward:,} UP</b>\n".replace(",", " ") +
                f"💎 Текущий баланс: <b>{new_balance:,} UP</b>\n".replace(",", " ") +
                "\n⏳ Следующий бонус станет доступен ровно через 24 часа."
            )
            await message.answer(text, parse_mode="HTML")
            return

        # --- Юзер не найден ---
        if data1 is None and data2 is None:
            await message.answer(
                "❌ <b>Профиль не найден.</b>\n\n"
                "💡 Напишите /start в личных сообщениях бота, чтобы создать профиль.",
                parse_mode="HTML"
            )
            return

        # --- Ошибка БД ---
        if data1 == -1 and data2 == -1:
            await message.answer(
                "⚠️ <b>Временная ошибка.</b>\n\n"
                "Попробуйте забрать бонус чуть позже.",
                parse_mode="HTML"
            )
            return

        # --- Кулдаун ---
        hours = max(0, int(data1 or 0))
        minutes = max(0, int(data2 or 0))
        text = (
            "⏳ <b>Вы уже получали бонус!</b>\n\n"
            "Следующий бонус будет доступен через:\n"
            f"🕒 <b>{hours} час. {minutes} мин.</b>"
        )
        await message.answer(text, parse_mode="HTML")

    except Exception as e:
        logger.exception("cmd_bonus failed: %s", e)
        try:
            await message.answer("⚠️ Ошибка. Попробуйте позже.")
        except Exception:
            pass
