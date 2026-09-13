# Токен твоего бота (вставишь свой)
TOKEN = "убрал токен"

# Названия валют
CURRENCY_UP = "UP"
CURRENCY_UC = "UC"

# ================== ВЛАДЕЛЕЦ И РОЛИ ==================
# ID владельца бота — получает статус 🏆 OWNER и полный доступ
OWNER_ID = 8771009385

# Списки ID для остальных ролей (добавляй через запятую)
ADMIN_IDS = []
MODERATOR_IDS = []
VIP_IDS = []

# Общий список для проверки админ-доступа
ADMINS = [OWNER_ID] + ADMIN_IDS

# Названия ролей (для отображения в профиле)
ROLE_OWNER = "🏆 OWNER"
ROLE_ADMIN = "⚡ ADMIN"
ROLE_MODERATOR = "🛡 MODERATOR"
ROLE_VIP = "💎 VIP"
ROLE_PLAYER = "👤 Игрок"

# ================== СОЗДАТЕЛЬ ==================
# Создатель = владелец. Единственный, кому доступна админ-панель.
CREATOR_ID = OWNER_ID


def get_user_role(user_id: int) -> str:
    """Возвращает название роли пользователя."""
    if user_id == OWNER_ID:
        return ROLE_OWNER
    if user_id in ADMIN_IDS:
        return ROLE_ADMIN
    if user_id in MODERATOR_IDS:
        return ROLE_MODERATOR
    if user_id in VIP_IDS:
        return ROLE_VIP
    return ROLE_PLAYER


def is_admin(user_id: int) -> bool:
    """Проверка: имеет ли юзер админ-права (OWNER или ADMIN)."""
    return user_id == OWNER_ID or user_id in ADMIN_IDS


def is_staff(user_id: int) -> bool:
    """Проверка: имеет ли юзер любые права персонала."""
    return (
        user_id == OWNER_ID
        or user_id in ADMIN_IDS
        or user_id in MODERATOR_IDS
    )


def is_creator(user_id: int) -> bool:
    """Проверка: является ли юзер создателем (полный доступ к админ-панели)."""
    return user_id == CREATOR_ID


# ================== БД ==================
DB_NAME = "upgrade_game.db"

# ================== ХОСТИНГ ==================
import os
WEB_PORT = int(os.getenv("PORT", 8080))