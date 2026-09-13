import time
import logging
from typing import Callable, Dict, Any, Awaitable
from aiogram import BaseMiddleware
from aiogram.types import Message, CallbackQuery, TelegramObject
from config import is_creator

logger = logging.getLogger(__name__)

# Импорт log_action / check_user_registered — с защитой от отсутствия
try:
    from database import log_action, check_user_registered
except Exception as e:
    logger.exception("middleware: не удалось импортировать функции из database: %s", e)
    log_action = None
    check_user_registered = None

# Импорт функций из grouphelper — с защитой от отсутствия
try:
    from handlers.grouphelper import (
        get_rank,
        subscription_enabled,
        user_missing_subs,
        apply_subscription_mute,
        is_sub_muted_recently,
        log_sub_check,
    )
    logger.info("middleware: grouphelper импортирован УСПЕШНО")
except Exception as e:
    logger.exception("middleware: grouphelper импорт упал: %s", e)
    get_rank = None
    subscription_enabled = None
    user_missing_subs = None
    apply_subscription_mute = None
    is_sub_muted_recently = None
    log_sub_check = None


_ALLOW_ALWAYS = {"/start", "/help", "/admin", "🛠️ Админ-панель"}


class LoggingMiddleware(BaseMiddleware):
    async def __call__(self, handler, event, data):
        try:
            user = getattr(event, "from_user", None)
            if user and log_action:
                if isinstance(event, Message):
                    text = event.text or event.caption or ""
                    ct = getattr(event.chat, "type", "—") if event.chat else "—"
                    log_action(user_id=user.id, username=user.username,
                               display_name=user.full_name or "Игрок",
                               action_type="MESSAGE",
                               message_text=(text or "")[:500],
                               extra=f"chat_type={ct}")
                elif isinstance(event, CallbackQuery):
                    log_action(user_id=user.id, username=user.username,
                               display_name=user.full_name or "Игрок",
                               action_type="CALLBACK",
                               callback_data=event.data or "")
        except Exception:
            logger.exception("LoggingMiddleware failed")
        return await handler(event, data)


class RegistrationGateMiddleware(BaseMiddleware):
    async def __call__(self, handler, event, data):
        try:
            user = getattr(event, "from_user", None)
            if not user:
                return await handler(event, data)
            if is_creator(user.id):
                return await handler(event, data)
            if isinstance(event, CallbackQuery):
                return await handler(event, data)

            text = ""
            if isinstance(event, Message):
                text = (event.text or "").strip()
            if text:
                tl = text.lower()
                if tl == "/start" or tl.startswith("/start ") or tl == "/help":
                    return await handler(event, data)
                if text in _ALLOW_ALWAYS:
                    return await handler(event, data)

            chat = getattr(event, "chat", None)
            ct = getattr(chat, "type", None) if chat else None

            if ct in ("group", "supergroup") and chat is not None and get_rank is not None:
                try:
                    rank = get_rank(chat.id, user.id)
                    if rank and rank > 0:
                        return await handler(event, data)
                except Exception:
                    pass

            if check_user_registered and not check_user_registered(user.id):
                if ct in ("group", "supergroup"):
                    return None
                if isinstance(event, Message):
                    try:
                        await event.answer(
                            "❌ <b>Вы еще не зарегистрированы!</b>\n\n"
                            "💡 Перейдите в <b>личные сообщения</b> бота и нажмите /start.",
                            parse_mode="HTML",
                        )
                    except Exception:
                        pass
                return None
        except Exception:
            logger.exception("RegistrationGateMiddleware failed")
        return await handler(event, data)


class SubscriptionGateMiddleware(BaseMiddleware):
    """
    Проверка обязательной подписки.
    ВАЖНО: добавлены debug-логи, чтобы видеть причину пропуска/блока.
    """

    _last_check: Dict[str, float] = {}

    async def __call__(self, handler, event, data):
        try:
            if not isinstance(event, Message):
                return await handler(event, data)

            chat = event.chat
            user = event.from_user
            if not chat or not user:
                return await handler(event, data)

            if chat.type not in ("group", "supergroup"):
                return await handler(event, data)

            # === ОТЛАДКА ===
            logger.info("[SubGate] msg from user=%s chat=%s text=%r",
                        user.id, chat.id, (event.text or "")[:50])

            if subscription_enabled is None:
                logger.warning("[SubGate] subscription_enabled = None → пропускаем")
                return await handler(event, data)

            try:
                enabled = subscription_enabled(chat.id)
            except Exception as e:
                logger.exception("[SubGate] subscription_enabled() упал: %s", e)
                return await handler(event, data)

            logger.info("[SubGate] подписка для chat=%s включена=%s", chat.id, enabled)
            if not enabled:
                return await handler(event, data)

            if is_creator(user.id):
                logger.info("[SubGate] создатель → пропуск")
                return await handler(event, data)

            if get_rank is not None:
                try:
                    rank = get_rank(chat.id, user.id)
                    logger.info("[SubGate] rank user=%s = %s", user.id, rank)
                    if rank > 0:
                        logger.info("[SubGate] staff → пропуск")
                        return await handler(event, data)
                except Exception as e:
                    logger.exception("[SubGate] get_rank упал: %s", e)

            if event.text and event.text.startswith("/"):
                logger.info("[SubGate] команда → пропуск")
                return await handler(event, data)

            # антиспам
            key = f"{chat.id}:{user.id}"
            now = time.time()
            if now - self._last_check.get(key, 0) < 20:
                logger.info("[SubGate] антиспам 20 сек → удаляем без реакции")
                try:
                    await event.delete()
                except Exception:
                    pass
                return None
            self._last_check[key] = now

            if user_missing_subs is None:
                logger.warning("[SubGate] user_missing_subs = None → пропуск")
                return await handler(event, data)

            try:
                missing = await user_missing_subs(event.bot, user.id, chat.id)
            except Exception as e:
                logger.exception("[SubGate] user_missing_subs упал: %s", e)
                return await handler(event, data)

            logger.info("[SubGate] missing=%s", [m.get("title") for m in (missing or [])])

            if not missing:
                logger.info("[SubGate] подписан на всё → пропуск")
                return await handler(event, data)

            if log_sub_check:
                try:
                    log_sub_check(chat.id, user.id, "auto_block",
                                  ",".join(str(m["id"]) for m in missing))
                except Exception:
                    pass

            if is_sub_muted_recently is not None:
                try:
                    if is_sub_muted_recently(event.bot, chat.id, user.id):
                        logger.info("[SubGate] уже недавно мутили → удаляем сообщение")
                        try:
                            await event.delete()
                        except Exception:
                            pass
                        return None
                except Exception:
                    pass

            logger.info("[SubGate] удаляем сообщение и выдаём мут 5 мин")
            try:
                await event.delete()
            except Exception as e:
                logger.warning("[SubGate] delete failed: %s", e)

            if apply_subscription_mute is not None:
                try:
                    await apply_subscription_mute(event.bot, chat.id, user.id, missing)
                    logger.info("[SubGate] apply_subscription_mute ВЫПОЛНЕНО")
                except Exception as e:
                    logger.exception("[SubGate] apply_subscription_mute упал: %s", e)

            return None
        except Exception as e:
            logger.exception("SubscriptionGateMiddleware failed: %s", e)

        return await handler(event, data)