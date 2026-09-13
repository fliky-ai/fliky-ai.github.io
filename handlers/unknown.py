import logging
from aiogram import Router, types
from database import get_user, DEFAULT_NICK

logger = logging.getLogger(__name__)
router = Router()


def get_user_nickname(user_id: int) -> str:
    try:
        user = get_user(user_id)
        return (user or {}).get("nickname") or DEFAULT_NICK
    except Exception as e:
        logger.exception("unknown.get_user_nickname failed: %s", e)
        return DEFAULT_NICK


# Полный список известных текстов кнопок (в lower-case, с эмодзи)
KNOWN_TEXTS = {
    # Основное
    "профиль", "profile", "👤 профиль",
    "б", "баланс",
    "ник", "nickname", "👤 ник", "✒ ник",
    "бонус", "🎁 бонус",
    "топ", "топ 10", "рейтинг", "🏆 топ",
    "работа", "работы", "профессия", "👔 работа",
    "реф", "рефералы", "🤝 рефералы",
    "банк", "upgrade bank", "🏦 банк",
    "помощь", "help", "❓ помощь",
    "лимит", "мой лимит", "лимит переводов",
    "политика", "📜 политика",
    "чаты", "💬 чаты",

    # Игры — главное меню
    "🎮 игры",
    "🎮 tg games",
    "🪙 флип",
    "🎡 рулетка",
    "🃏блэкджек", "🃏 блэкджек", "блэкджек",
    "💣 мины", "мины",
    "📈хило", "📈 хило", "хило",
    "🏹 охота", "охота",
    "📊 трейд", "📊трейд", "трейд",
    "дуэль", "⚔ дуэль",

    # TG Games
    "🏀 баскетбол", "баскетбол",
    "⚽ футбол", "футбол",
    "🎳 боулинг", "боулинг",
    "🎲 кубик", "кубик",
    "🎯 дартс", "дартс",
    "🎰 слоты", "слоты",
    "🔙 назад", " назад", "назад",

    # Развлекательное
    "шахта", "⛏ моя шахта", "mine",
    "магазин", "бизнес", "🏪 магазин", "🏪 бизнес",
    "ютуб", "youtube", "📺 youtube",
    "техномаркет", "тм",
    "симкарта", "мой сим", "сим", "📶 sim",
    "bitcoin", "биткоин", "🪙 биткоин",

    # Транспорт
    "моя машина", "мой машина", "mycar", "🚗 моя машина",
    "автосалон", "shopcar", "🚘 автосалон",

    # Казна
    "казна", "казна чата", "🏦 казна",
    "награда казны", "🎁 награда казны",
    "статистика казны", "история казны",

    # Скины / персонажи / инвентарь
    "🎨 скины", "скины",
    "🎭 персонажи", "персонажи", "🎒 гардероб", "гардероб",
    "🎒 инвентарь", "инвентарь",
}


KNOWN_COMMANDS = {"start", "help", "profile", "ref"}


KNOWN_PREFIXES = (
    # Игры — ставки
    "флип ", "мины ", "хило ", "охота ", "трейд ", "бд ",
    "баскетбол ", "футбол ", "дартс ", "боулинг ", "слоты ", "кубик ",
    # Казна
    "пополнить казну ", "изменить награду ",
    # Переводы
    "дать ", "перевести ",
    # Ник
    "ник ",
    # Промо / команды
    "/",
)


@router.message()
async def unknown_message(message: types.Message):
    try:
        # ТОЛЬКО личные сообщения
        if message.chat.type != "private":
            return

        # Игнор нетекстовых сообщений
        if not message.text:
            return

        raw = message.text.strip()
        text_lower = raw.lower()

        # Все команды с / пропускаем
        if text_lower.startswith("/"):
            return

        # Известные тексты кнопок
        if text_lower in KNOWN_TEXTS:
            return

        # Известные префиксы
        for prefix in KNOWN_PREFIXES:
            if text_lower.startswith(prefix):
                return

        # Защита: если в сообщении есть эмодзи из ReplyKeyboard — пропускаем,
        # чтобы не мешать другим роутерам поймать (на случай опечаток).
        reply_emoji_prefixes = (
            "👤", "💰", "✒", "🎁", "🏆", "👔", "🤝", "🏦", "📈", "⚙",
            "🎮", "🪙", "🎡", "🃏", "💣", "📊", "🏹", "🎲", "🎰", "🎯",
            "🏀", "⚽", "🎳", "🔙", "💬", "❓", "📜", "⛏", "🏪", "📺",
            "📶", "🚗", "🚘", "🎨", "🎭", "🎒", "🛒", "🏬",
        )
        if raw[:1] in reply_emoji_prefixes or raw[:2] in reply_emoji_prefixes:
            return

        user_id = message.from_user.id if message.from_user else None
        if not user_id:
            return

        nickname = get_user_nickname(user_id)

        text = (
            f"<b>❌ {nickname}</b>, не удалось найти такую команду.\n\n"
            "❓ Откройте <code>«Помощь»</code> для списка команд"
        )

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[types.InlineKeyboardButton(text="❓ Помощь", callback_data="help_back")]]
        )

        try:
            await message.answer(text, parse_mode="HTML", reply_markup=kb)
        except Exception:
            pass
    except Exception as e:
        logger.exception("unknown_message failed: %s", e)