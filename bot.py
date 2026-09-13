import asyncio
import logging
from aiogram import Bot, Dispatcher
from aiohttp import web

from config import TOKEN, WEB_PORT, is_creator, CREATOR_ID
from database import init_db

# Импортируем все handlers
from handlers import (
    start, profile, balance, bonus, policy, games, top, business, tester,
    bank, nick, ref, bitcoin, mine, technomarket, youtube, sim, treasury,
    jobs, help, unknown, mycar, shopcar, pay, testpers, personages, chats,
    inventory, admin, rating,
)

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ================== ВЕБ-СЕРВЕР (для Render/Replit) ==================
async def handle(request):
    return web.Response(text="UpgradeBot is running!")


async def web_server():
    try:
        app = web.Application()
        app.router.add_get("/", handle)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "0.0.0.0", WEB_PORT)
        await site.start()
        logger.info("🌐 Веб-сервер запущен на порту %s", WEB_PORT)
    except Exception as e:
        logger.exception("Не удалось запустить веб-сервер: %s", e)


# ================== БЕЗОПАСНАЯ ОБЁРТКА ДЛЯ ФОНОВЫХ ЗАДАЧ ==================
async def _safe_bg(coro, name: str):
    """Обёртка: если фоновая задача упадёт, лог, а не молчание."""
    try:
        await coro
    except asyncio.CancelledError:
        logger.info("Фоновая задача %s отменена", name)
    except Exception as e:
        logger.exception("Фоновая задача %s упала: %s", name, e)


# ================== MAIN ==================
async def main():
    # Инициализируем базу данных при запуске
    try:
        init_db()
    except Exception as e:
        logger.exception("init_db упал: %s", e)
        return

    if not TOKEN or TOKEN in ("ТВОЙ_ТОКЕН_БОТА", "ВСТАВЬ_ТОКЕН_ИЛИ_ПЕРЕМЕННУЮ"):
        print("ОШИБКА: Не забудь указать токен своего бота в файле config.py!")
        return

    bot = Bot(token=TOKEN)
    dp = Dispatcher()

    # ================== ПОДКЛЮЧЕНИЕ MIDDLEWARE ==================
    # Middleware работает ДО хендлеров: логирует всё и защищает регистрацию.
    try:
        from handlers.middleware_logger import LoggingMiddleware, RegistrationGateMiddleware

        dp.message.middleware(LoggingMiddleware())
        dp.callback_query.middleware(LoggingMiddleware())
        dp.message.middleware(RegistrationGateMiddleware())

        print("🛡️ Middleware подключён: логирование + защита регистрации")
    except Exception as e:
        logger.exception("Не удалось подключить middleware: %s", e)

    # ================== ПОДКЛЮЧЕНИЕ РОУТЕРОВ ==================
    # Порядок важен: более специфичные — раньше, unknown — последним.

    dp.include_router(games.router)              # 🎮 Игры
    dp.include_router(technomarket.router)       # 🏬 Техномаркет
    dp.include_router(youtube.router)            # 📺 YouTube
    dp.include_router(sim.router)                # 📶 SIM-карты
    dp.include_router(treasury.router)           # 🏦 Казна чата
    dp.include_router(jobs.router)               # 👔 Работа
    dp.include_router(mycar.router)              # 🚗 Моя машина
    dp.include_router(shopcar.router)            # 🚘 Автосалон
    dp.include_router(pay.router)                # 💸 Переводы UP
    dp.include_router(testpers.router)           # 🎨 Выдача скинов
    dp.include_router(personages.router)         # 🎭 Персонажи
    dp.include_router(chats.router)              # 💬 Чаты
    dp.include_router(inventory.router)          # 🎒 Инвентарь
    dp.include_router(help.router)               # 📚 Помощь
    dp.include_router(start.router)              # 🚀 Старт
    dp.include_router(profile.router)            # 👤 Профиль
    dp.include_router(balance.router)            # 💰 Баланс
    dp.include_router(top.router)                # 🏆 Топ
    dp.include_router(bonus.router)              # 🎁 Бонус
    dp.include_router(policy.router)             # 📜 Политика
    dp.include_router(business.router)           # 🏪 Бизнес
    dp.include_router(tester.router)             # 🧪 Тестер
    dp.include_router(bank.router)               # 🏦 Банк
    dp.include_router(nick.router)               # 👑 Никнеймы
    dp.include_router(ref.router)                # 🤝 Рефералы
    dp.include_router(bitcoin.router)            # 🪙 Bitcoin
    dp.include_router(mine.router)               # ⛏ Шахта
    dp.include_router(rating.router)             # ⭐ Рейтинг

    # 🛠 Админ-панель — подключаем ПЕРЕД unknown
    dp.include_router(admin.router)

    dp.include_router(unknown.router)            # ❓ Неизвестные (ПОСЛЕДНИМ!)

    # ================== ФОНОВЫЕ ЗАДАЧИ ==================
    asyncio.create_task(_safe_bg(bitcoin.start_bitcoin_updater(), "bitcoin_updater"))
    print("🪙 Bitcoin курс будет обновляться каждый час!")

    asyncio.create_task(_safe_bg(youtube.youtube_npc_activity(), "youtube_npc"))
    print("📺 YouTube NPC активность запущена!")

    print("👔 Система работы загружена!")
    print("📚 Система помощи загружена!")
    print("❓ Система неизвестных команд загружена!")
    print("🚗 Система транспорта загружена!")
    print("💸 Система переводов UP загружена!")
    print("🎨 Система скинов загружена!")
    print("🎭 Система персонажей загружена!")
    print("💬 Система чатов загружена!")
    print("🎒 Система инвентаря загружена!")
    print("⭐ Система рейтинга загружена!")
    print("🛠️ Админ-панель загружена!")
    print(f"👑 Создатель ID: {CREATOR_ID}")

    # ================== ВЕБ-СЕРВЕР ==================
    await web_server()

    # ================== ИНФО ==================
    print("🚀 Бот успешно запущен и готов к работе!")
    print("📊 Все системы активны:")
    print("  • 🎮 Игровая система")
    print("  • 🏦 Банковская система")
    print("  • 🏪 Бизнес-система")
    print("  • ⛏ Шахта")
    print("  • 🤝 Реферальная система")
    print("  • 🪙 Bitcoin Market")
    print("  • 🏬 Техномаркет")
    print("  • 📺 YouTube")
    print("  • 📶 SIM-карты")
    print("  • 🏦 Казна чата")
    print("  • 👔 Система работы")
    print("  • 📚 Помощь")
    print("  • ❓ Обработка неизвестных команд")
    print("  • 🚗 Транспорт")
    print("  • 💸 Переводы UP")
    print("  • 🎨 Скины персонажа")
    print("  • 🎭 Магазин персонажей и гардероб")
    print("  • 💬 Чаты")
    print("  • 🎒 Инвентарь")
    print("  • ⭐ Рейтинг")
    print("  • 🛠️ Админ-панель (только создатель)")

    # Удаляем вебхуки и запускаем поллинг
    await bot.delete_webhook(drop_pending_updates=True)
    await dp.start_polling(bot)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        print("\n👋 Бот остановлен.")
    except Exception as e:
        logging.exception("Критическая ошибка при запуске: %s", e)