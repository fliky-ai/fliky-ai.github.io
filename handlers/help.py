import os
import logging
from pathlib import Path
from aiogram import Router, types, F
from aiogram.filters import Command
from aiogram.types import FSInputFile

logger = logging.getLogger(__name__)
router = Router()

PHOTOS_DIR = Path(__file__).resolve().parent / "photos"
HELP_PHOTO = PHOTOS_DIR / "help.jpg"


# ================== ОБЩИЕ ТЕКСТЫ ==================
HELP_MENU_TEXT = (
    "📚 <b>ПОМОЩЬ UPGRADE GAME</b>\n\n"
    "🎯 <b>Выберите категорию:</b>\n\n"
    "   1️⃣ Основное\n"
    "   2️⃣ Игры\n"
    "   3️⃣ Развлекательное\n"
    "   4️⃣ Кланы"
)

HELP_MAIN_TEXT = (
    "👤 <b>ОСНОВНОЕ</b>\n"
    "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
    "👤 <b>Профиль</b> — информация о персонаже\n"
    "💰 <b>Баланс</b> — ваш баланс UP\n"
    "✒ <b>Ник</b> — изменить никнейм\n"
    "🎁 <b>Бонус</b> — ежедневная награда\n"
    "🏆 <b>Топ</b> — рейтинг игроков\n"
    "👔 <b>Работа</b> — система профессий\n"
    "🤝 <b>Реф</b> — реферальная система\n"
    "🏦 <b>Банк</b> — банковская система\n"
    "📈 <b>Курс</b> — курсы валют\n"
    "⚙ <b>Настройки</b> — настройки аккаунта\n\n"
    "━━━━━━━━━━━━━━━━━━━━━━━"
)

HELP_GAMES_TEXT = (
    "🎮 <b>ИГРЫ</b>\n"
    "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
    "🪙 <b>Флип</b> <code>[ставка]</code> — монетка\n"
    "💣 <b>Мины</b> <code>[ставка]</code> — мины\n"
    "📈 <b>Хило</b> <code>[ставка]</code> — выше/ниже\n"
    "🎡 <b>Рулетка</b> <code>[ставка]</code> — рулетка\n"
    "🃏 <b>Блэкджек</b> <code>[ставка]</code> — карты\n"
    "🎯 <b>Охота</b> <code>[ставка]</code> — охота\n"
    "💼 <b>Трейд</b> <code>[ставка]</code> — торговля\n"
    "⚔ <b>Дуэль</b> — против игрока\n\n"
    "🚀 <b>TG Games:</b>\n"
    "🏀 <b>Баскетбол</b> <code>[ставка]</code>\n"
    "⚽ <b>Футбол</b> <code>[ставка]</code>\n"
    "🎳 <b>Боулинг</b> <code>[ставка]</code>\n"
    "🎲 <b>Кубик</b> <code>[1-6] [ставка]</code>\n"
    "🎯 <b>Дартс</b> <code>[ставка]</code>\n"
    "🎰 <b>Слоты</b> <code>[ставка]</code>\n\n"
    "━━━━━━━━━━━━━━━━━━━━━━━"
)

HELP_FUN_TEXT = (
    "🎉 <b>РАЗВЛЕКАТЕЛЬНОЕ</b>\n"
    "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
    "⛏ <b>Шахта</b> — добыча ресурсов\n"
    "🏪 <b>Бизнесы</b> — создать бизнес\n"
    "🛒 <b>Магазин</b> — покупки\n"
    "📺 <b>YouTube</b> — свой канал\n"
    "🏬 <b>Техномаркет</b> — устройства\n"
    "🚗 <b>Автосалон</b> — машины\n"
    "🪙 <b>Bitcoin</b> — криптовалюта\n\n"
    "━━━━━━━━━━━━━━━━━━━━━━━"
)

HELP_CLANS_TEXT = (
    "👥 <b>КЛАНЫ</b>\n"
    "━━━━━━━━━━━━━━━━━━━━━━━\n\n"
    "🚧 <b>Система в разработке</b>\n\n"
    "🎯 <b>Скоро:</b>\n"
    "👥 Создание клана\n"
    "🏆 Рейтинг кланов\n"
    "💰 Общий банк\n"
    "⬆ Улучшение клана\n\n"
    "━━━━━━━━━━━━━━━━━━━━━━━\n"
    "💡 <i>Следите за обновлениями!</i>"
)


def get_menu_kb() -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(
        inline_keyboard=[
            [
                types.InlineKeyboardButton(text="👤 Основное", callback_data="help_main"),
                types.InlineKeyboardButton(text="🎮 Игры", callback_data="help_games")
            ],
            [
                types.InlineKeyboardButton(text="🎉 Развлекательное", callback_data="help_fun"),
                types.InlineKeyboardButton(text="👥 Кланы", callback_data="help_clans")
            ]
        ]
    )


def get_back_kb() -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(
        inline_keyboard=[[types.InlineKeyboardButton(text="⬅️ Назад", callback_data="help_back")]]
    )


async def _safe_render(callback: types.CallbackQuery, text: str, kb: types.InlineKeyboardMarkup):
    """Универсальный рендер: edit_caption → edit_text → answer. Не падает."""
    try:
        await callback.message.edit_caption(caption=text, parse_mode="HTML", reply_markup=kb)
        return
    except Exception:
        pass
    try:
        await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        return
    except Exception:
        pass
    try:
        await callback.message.answer(text, parse_mode="HTML", reply_markup=kb)
    except Exception as e:
        logger.warning("_safe_render failed: %s", e)


# ================== ГЛАВНОЕ МЕНЮ ==================
async def show_help_menu(message: types.Message):
    try:
        if HELP_PHOTO.exists():
            try:
                await message.answer_photo(
                    photo=FSInputFile(str(HELP_PHOTO)),
                    caption=HELP_MENU_TEXT,
                    parse_mode="HTML",
                    reply_markup=get_menu_kb()
                )
                return
            except Exception as e:
                logger.warning("Help photo send error: %s", e)
        await message.answer(HELP_MENU_TEXT, parse_mode="HTML", reply_markup=get_menu_kb())
    except Exception as e:
        logger.exception("show_help_menu failed: %s", e)


@router.message(Command("help"))
async def cmd_help(message: types.Message):
    await show_help_menu(message)


@router.message(F.text.casefold().in_({"помощь", "help", "❓ помощь", "❓ помощь"}))
async def cmd_help_text(message: types.Message):
    await show_help_menu(message)


# ================== КАТЕГОРИИ ==================
@router.callback_query(F.data == "help_main")
async def help_main(callback: types.CallbackQuery):
    try:
        await _safe_render(callback, HELP_MAIN_TEXT, get_back_kb())
    except Exception as e:
        logger.exception("help_main failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data == "help_games")
async def help_games(callback: types.CallbackQuery):
    try:
        await _safe_render(callback, HELP_GAMES_TEXT, get_back_kb())
    except Exception as e:
        logger.exception("help_games failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data == "help_fun")
async def help_fun(callback: types.CallbackQuery):
    try:
        await _safe_render(callback, HELP_FUN_TEXT, get_back_kb())
    except Exception as e:
        logger.exception("help_fun failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data == "help_clans")
async def help_clans(callback: types.CallbackQuery):
    try:
        await _safe_render(callback, HELP_CLANS_TEXT, get_back_kb())
    except Exception as e:
        logger.exception("help_clans failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


# ================== НАЗАД ==================
@router.callback_query(F.data == "help_back")
async def help_back(callback: types.CallbackQuery):
    try:
        await _safe_render(callback, HELP_MENU_TEXT, get_menu_kb())
    except Exception as e:
        logger.exception("help_back failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass