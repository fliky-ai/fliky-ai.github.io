import time
import logging
from aiogram import Router, types, F
from aiogram.fsm.context import FSMContext
from database import db_conn, get_user, DEFAULT_NICK, check_user_registered

logger = logging.getLogger(__name__)
router = Router()

OWNER_ID = 8771009385
REF_PER_PAGE = 5


def _esc(s: str) -> str:
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def get_user_nickname(user_id: int) -> str:
    try:
        user = get_user(user_id)
        return user.get("nickname") or DEFAULT_NICK if user else DEFAULT_NICK
    except Exception:
        return DEFAULT_NICK


def get_user_ref_code(user_id: int) -> str:
    try:
        user = get_user(user_id)
        return user.get("ref_code") or "ERROR" if user else "ERROR"
    except Exception:
        return "ERROR"


def get_user_rank(user_id: int) -> int:
    """Место в топе рефералов. Один SQL-запрос с оконной функцией."""
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT ref_rank FROM (
                    SELECT referrer_id, ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) AS ref_rank
                    FROM referrals GROUP BY referrer_id
                ) WHERE referrer_id = ?
            """, (user_id,))
            row = cur.fetchone()
            return row[0] if row else 0
    except Exception as e:
        logger.exception("get_user_rank failed for %s: %s", user_id, e)
        return 0


def get_ref_keyboard() -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(
        inline_keyboard=[
            [
                types.InlineKeyboardButton(text="📊 Статистика", callback_data="ref_stats"),
                types.InlineKeyboardButton(text="👥 Мои рефералы", callback_data="ref_list_1")
            ],
            [
                types.InlineKeyboardButton(text="🎁 Награды", callback_data="ref_rewards"),
                types.InlineKeyboardButton(text="🏆 Топ рефералов", callback_data="ref_top")
            ],
            [
                types.InlineKeyboardButton(text="💰 Вывести", callback_data="ref_withdraw"),
                types.InlineKeyboardButton(text="🔄 Обновить", callback_data="ref_refresh")
            ]
        ]
    )


async def generate_ref_main_text(user_id: int, bot) -> str:
    try:
        ref_code = get_user_ref_code(user_id)
        bot_info = await bot.get_me()
        ref_link = f"https://t.me/{bot_info.username}?start=ref_{ref_code}"

        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM referrals WHERE referrer_id = ?", (user_id,))
            total_refs = cur.fetchone()[0] or 0
            cur.execute("SELECT COALESCE(SUM(reward), 0) FROM referrals WHERE referrer_id = ?", (user_id,))
            earned_up = cur.fetchone()[0] or 0

        rank = get_user_rank(user_id)
        rank_str = f"#{rank}" if rank > 0 else "#-"

        return (
            "🤝 <b>РЕФЕРАЛЬНЫЙ ЦЕНТР</b>\n\n"
            "Приглашайте друзей и получайте награды!\n\n"
            f"🔗 <b>Ваша ссылка:</b>\n<code>{_esc(ref_link)}</code>\n\n"
            f"👥 <b>Приглашено:</b> {total_refs}\n"
            f"💰 <b>Заработано:</b> {earned_up:,} UP\n"
            f"🏆 <b>Место в топе:</b> {rank_str}"
        ).replace(",", " ")
    except Exception as e:
        logger.exception("generate_ref_main_text failed for %s: %s", user_id, e)
        return "❌ Ошибка загрузки реферального центра."


@router.message(F.text.casefold().in_({"реф", "рефералы", "🤝 рефералы", "/ref"}))
async def cmd_ref_center(message: types.Message):
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

        text = await generate_ref_main_text(user_id, message.bot)
        await message.answer(text, parse_mode="HTML", reply_markup=get_ref_keyboard())
    except Exception as e:
        logger.exception("cmd_ref_center failed: %s", e)


@router.callback_query(F.data == "none")
async def cb_none(callback: types.CallbackQuery):
    try:
        await callback.answer()
    except Exception:
        pass


@router.callback_query(F.data.startswith("ref_"))
async def handle_ref_callbacks(callback: types.CallbackQuery, state: FSMContext):
    data = callback.data or ""
    user_id = callback.from_user.id if callback.from_user else None
    if not user_id:
        try:
            await callback.answer()
        except Exception:
            pass
        return

    try:
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        if data == "ref_stats":
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("SELECT COUNT(*) FROM referrals WHERE referrer_id = ?", (user_id,))
                total = cur.fetchone()[0] or 0
                cur.execute("SELECT COALESCE(SUM(reward), 0) FROM referrals WHERE referrer_id = ?", (user_id,))
                earned = cur.fetchone()[0] or 0

            rank = get_user_rank(user_id)
            rank_str = f"#{rank}" if rank > 0 else "Нет места"

            text = (
                "📊 <b>Статистика рефералов</b>\n\n"
                f"👥 Всего приглашено: <b>{total}</b>\n"
                f"💰 Всего заработано: <b>{earned:,} UP</b>\n"
                f"🏆 Позиция в топе: <b>{rank_str}</b>"
            ).replace(",", " ")

            kb = types.InlineKeyboardMarkup(inline_keyboard=[[types.InlineKeyboardButton(text="⬅️ Назад", callback_data="ref_main")]])
            await _safe_edit(callback, text, kb)

        elif data.startswith("ref_list_"):
            try:
                page = int(data.split("_")[2])
            except (ValueError, IndexError):
                page = 1

            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute(
                    "SELECT referred_id, created_at FROM referrals WHERE referrer_id = ? ORDER BY created_at DESC",
                    (user_id,)
                )
                refs = cur.fetchall() or []

            total_refs = len(refs)
            total_pages = max(1, (total_refs + REF_PER_PAGE - 1) // REF_PER_PAGE)
            page = max(1, min(page, total_pages))
            start_idx = (page - 1) * REF_PER_PAGE
            current_refs = refs[start_idx:start_idx + REF_PER_PAGE]

            text = "👥 <b>Ваши рефералы:</b>\n\n"
            if not current_refs:
                text += "У вас пока нет приглашенных игроков."
            else:
                for i, (ref_id, timestamp) in enumerate(current_refs, start=start_idx + 1):
                    nick = _esc(get_user_nickname(ref_id))
                    try:
                        date_str = time.strftime("%d.%m.%Y", time.localtime(int(timestamp)))
                    except Exception:
                        date_str = "—"
                    text += f"{i}. <b>{nick}</b>\n🆔 ID: скрыт\n📅 Дата: {date_str}\n\n"

            text += f"<b>Всего:</b> {total_refs}"

            nav_row = []
            if page > 1:
                nav_row.append(types.InlineKeyboardButton(text="⬅️ Назад", callback_data=f"ref_list_{page - 1}"))
            nav_row.append(types.InlineKeyboardButton(text=f"{page}/{total_pages}", callback_data="none"))
            if page < total_pages:
                nav_row.append(types.InlineKeyboardButton(text="Вперёд ➡️", callback_data=f"ref_list_{page + 1}"))

            kb_list = [nav_row] if nav_row else []
            kb_list.append([types.InlineKeyboardButton(text="🏠 В меню", callback_data="ref_main")])
            await _safe_edit(callback, text, types.InlineKeyboardMarkup(inline_keyboard=kb_list))

        elif data == "ref_rewards":
            text = (
                "🎁 <b>Реферальная система наград</b>\n\n"
                "• За каждого приглашенного друга вы получаете <b>+500 UP</b> сразу на баланс.\n"
                "• Сам друг получает приветственный бонус <b>+100 UP</b>.\n\n"
                "Делитесь своей уникальной ссылкой и поднимайтесь в общем топе игроков!"
            )
            kb = types.InlineKeyboardMarkup(inline_keyboard=[[types.InlineKeyboardButton(text="⬅️ Назад", callback_data="ref_main")]])
            await _safe_edit(callback, text, kb)

        elif data == "ref_top":
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("""
                    SELECT referrer_id, COUNT(*) AS cnt
                    FROM referrals
                    GROUP BY referrer_id
                    ORDER BY cnt DESC
                    LIMIT 10
                """)
                top_users = cur.fetchall() or []

            text = "🏆 <b>ТОП-10 РЕФЕРАЛОВ</b>\n\n"
            if not top_users:
                text += "Список лидеров пока пуст."
            else:
                medals = ["🥇", "🥈", "🥉"]
                for i, (ref_uid, count) in enumerate(top_users, 1):
                    nick = _esc(get_user_nickname(ref_uid))
                    prefix = medals[i - 1] if i <= 3 else f"{i}."
                    text += f"{prefix} <b>{nick}</b> — {count} игроков\n"

            kb = types.InlineKeyboardMarkup(inline_keyboard=[[types.InlineKeyboardButton(text="⬅️ Назад", callback_data="ref_main")]])
            await _safe_edit(callback, text, kb)

        elif data == "ref_withdraw":
            await callback.answer(
                "✅ Все реферальные награды зачисляются автоматически на ваш основной баланс при регистрации приглашенного игрока!",
                show_alert=True
            )
            return

        elif data in ("ref_refresh", "ref_main"):
            text = await generate_ref_main_text(user_id, callback.bot)
            await _safe_edit(callback, text, get_ref_keyboard())
            if data == "ref_refresh":
                await callback.answer("🔄 Данные обновлены!", show_alert=True)
                return

    except Exception as e:
        logger.exception("handle_ref_callbacks failed (data=%s): %s", data, e)

    finally:
        try:
            await callback.answer()
        except Exception:
            pass


async def _safe_edit(callback: types.CallbackQuery, text: str, kb: types.InlineKeyboardMarkup):
    try:
        await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
    except Exception:
        try:
            await callback.message.answer(text, parse_mode="HTML", reply_markup=kb)
        except Exception as e:
            logger.warning("Не удалось ни отредактировать, ни отправить: %s", e)