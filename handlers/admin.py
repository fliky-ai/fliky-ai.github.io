import io
import time
import logging
from datetime import datetime
from aiogram import Router, types, F
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

from config import CREATOR_ID, is_creator
from database import (
    db_conn,
    get_user,
    get_user_stats,
    get_bot_stats,
    get_game_by_id,
    get_game_session,
    get_game_actions,
    get_admin_logs,
    get_balance_history,
    get_all_click_logs,
    get_all_user_ids,
    get_user_skins,
    admin_set_balance,
    admin_add_balance,
    admin_set_level,
    admin_set_xp,
    admin_set_skin,
    admin_grant_skin,
    admin_revoke_skin,
    clear_old_logs,
    log_action,
    DEFAULT_NICK,
)

logger = logging.getLogger(__name__)
router = Router()


# ================== FSM ==================
class AdminStates(StatesGroup):
    find_player = State()
    find_game = State()
    balance_amount = State()
    balance_set = State()
    level_amount = State()
    xp_amount = State()
    skin_input = State()
    broadcast_text = State()


# ================== ХЕЛПЕРЫ ==================
def _fmt(n) -> str:
    try:
        return f"{int(n):,}".replace(",", " ")
    except (TypeError, ValueError):
        return "0"


def _esc(s) -> str:
    return (str(s) if s is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _is_creator(user_id: int) -> bool:
    return is_creator(user_id)


async def _deny(target):
    try:
        if isinstance(target, types.CallbackQuery):
            await target.answer("⛔ Доступ запрещён", show_alert=True)
        else:
            await target.answer("⛔ Доступ запрещён")
    except Exception:
        pass


def _creator_check(event) -> bool:
    try:
        user = event.from_user
        if not user or not _is_creator(user.id):
            return False
        chat = getattr(event, "chat", None) or getattr(getattr(event, "message", None), "chat", None)
        if chat and chat.type != "private":
            return False
        return True
    except Exception:
        return False


async def _safe_edit(callback: types.CallbackQuery, text: str, kb=None):
    try:
        await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
    except Exception:
        try:
            await callback.message.answer(text, parse_mode="HTML", reply_markup=kb)
        except Exception as e:
            logger.warning("_safe_edit failed: %s", e)


# ================== КЛАВИАТУРЫ ==================
def kb_main_panel() -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="🔎 Поиск игрока", callback_data="adm_find_player")],
            [types.InlineKeyboardButton(text="🎮 Поиск игры", callback_data="adm_find_game")],
            [types.InlineKeyboardButton(text="📜 Логи", callback_data="adm_logs"),
             types.InlineKeyboardButton(text="🖱️ Click-данные", callback_data="adm_click")],
            [types.InlineKeyboardButton(text="💰 Управление балансом", callback_data="adm_bal_help")],
            [types.InlineKeyboardButton(text="⭐ Управление уровнем", callback_data="adm_lvl_help")],
            [types.InlineKeyboardButton(text="🎭 Выдать скин", callback_data="adm_skin_help")],
            [types.InlineKeyboardButton(text="📢 Рассылка", callback_data="adm_broadcast")],
            [types.InlineKeyboardButton(text="👥 Статистика игроков", callback_data="adm_stats_players")],
            [types.InlineKeyboardButton(text="📊 Статистика бота", callback_data="adm_stats_bot")],
            [types.InlineKeyboardButton(text="⚙️ Настройки", callback_data="adm_settings")],
        ]
    )


def kb_back_main() -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(
        inline_keyboard=[[types.InlineKeyboardButton(text="◀️ Назад", callback_data="adm_main")]]
    )


def kb_player_actions(user_id: int) -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="💰 Баланс", callback_data=f"adm_p_bal_{user_id}"),
             types.InlineKeyboardButton(text="⭐ Уровень", callback_data=f"adm_p_lvl_{user_id}")],
            [types.InlineKeyboardButton(text="🎭 Скин", callback_data=f"adm_p_skin_{user_id}"),
             types.InlineKeyboardButton(text="📜 История", callback_data=f"adm_p_hist_{user_id}")],
            [types.InlineKeyboardButton(text="🎮 Игры", callback_data=f"adm_p_games_{user_id}")],
            [types.InlineKeyboardButton(text="◀️ В панель", callback_data="adm_main")],
        ]
    )


def kb_balance_actions(user_id: int) -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="➕ Выдать UP", callback_data=f"adm_bal_add_{user_id}"),
             types.InlineKeyboardButton(text="➖ Забрать UP", callback_data=f"adm_bal_sub_{user_id}")],
            [types.InlineKeyboardButton(text="🔄 Установить баланс", callback_data=f"adm_bal_set_{user_id}")],
            [types.InlineKeyboardButton(text="📜 История баланса", callback_data=f"adm_bal_hist_{user_id}")],
            [types.InlineKeyboardButton(text="◀️ Назад", callback_data=f"adm_player_{user_id}")],
        ]
    )


def kb_level_actions(user_id: int) -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="⭐ Установить уровень", callback_data=f"adm_lvl_set_{user_id}")],
            [types.InlineKeyboardButton(text="📈 Установить XP", callback_data=f"adm_xp_set_{user_id}")],
            [types.InlineKeyboardButton(text="◀️ Назад", callback_data=f"adm_player_{user_id}")],
        ]
    )


def kb_skin_actions(user_id: int) -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="🎭 Выдать скин", callback_data=f"adm_skin_grant_{user_id}")],
            [types.InlineKeyboardButton(text="⭐ Установить активный", callback_data=f"adm_skin_set_{user_id}")],
            [types.InlineKeyboardButton(text="📦 Скины игрока", callback_data=f"adm_skin_list_{user_id}")],
            [types.InlineKeyboardButton(text="◀️ Назад", callback_data=f"adm_player_{user_id}")],
        ]
    )


def kb_stats_period(prefix: str) -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(
        inline_keyboard=[
            [types.InlineKeyboardButton(text="📅 Сегодня", callback_data=f"{prefix}_1"),
             types.InlineKeyboardButton(text="📅 7 дней", callback_data=f"{prefix}_7")],
            [types.InlineKeyboardButton(text="📅 30 дней", callback_data=f"{prefix}_30"),
             types.InlineKeyboardButton(text="📊 Всё время", callback_data=f"{prefix}_0")],
            [types.InlineKeyboardButton(text="◀️ Назад", callback_data="adm_main")],
        ]
    )


# ================== РЕНДЕР ИГРЫ (для поиска) ==================
def _render_game(session: dict) -> str:
    """
    Принимает запись из game_sessions, возвращает HTML-текст с рендером игры.
    """
    if not session:
        return "❌ Игра не найдена."

    gtype = session.get("game_type") or "—"
    gid = session.get("game_id")
    uid = session.get("user_id")
    bet = session.get("bet") or 0
    result = session.get("result") or "—"
    win_amount = session.get("win_amount") or 0
    status = session.get("status") or "—"
    started_at = session.get("started_at")
    ended_at = session.get("ended_at")
    state = session.get("state") or {}

    nickname = (get_user(uid) or {}).get("nickname") or DEFAULT_NICK

    try:
        date_str = time.strftime("%d.%m.%Y %H:%M:%S", time.localtime(int(started_at or 0)))
    except Exception:
        date_str = "—"

    try:
        end_str = time.strftime("%d.%m.%Y %H:%M:%S", time.localtime(int(ended_at))) if ended_at else "—"
    except Exception:
        end_str = "—"

    # Заголовок
    header = (
        f"🎮 <b>ИГРА #{gid}</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"👤 Игрок: <b>{_esc(nickname)}</b>\n"
        f"🆔 ID: <code>{uid}</code>\n"
        f"🎯 Тип: <b>{_esc(gtype)}</b>\n"
        f"💰 Ставка: <b>{_fmt(bet)} UP</b>\n"
        f"🎁 Выигрыш: <b>{_fmt(win_amount)} UP</b>\n"
        f"📊 Статус: <b>{_esc(status)}</b>\n"
        f"🏁 Результат: <b>{_esc(result)}</b>\n"
        f"🕐 Начало: <b>{date_str}</b>\n"
        f"🕓 Конец: <b>{end_str}</b>\n"
    )

    body = ""

    # ================== МИНЫ ==================
    if gtype == "mines":
        mines = set(state.get("mines") or [])
        opened = set(state.get("opened") or [])
        hit = state.get("hit_mine")
        multiplier = state.get("multiplier") or 1.0

        body += f"\n━━━━━━━━━━━━━━━━━━━━━━━\n💣 <b>ПОЛЕ МИН 5×5</b>\n\n"
        body += "Обозначения: 💎 открыто • 💣 мина • 🔥 подрыв • ❓ не открыто\n\n"

        # поле 5x5
        for r in range(5):
            row = ""
            for c in range(5):
                idx = r * 5 + c
                if idx == hit:
                    row += "🔥 "
                elif idx in opened:
                    row += "💎 "
                elif idx in mines:
                    row += "💣 "
                else:
                    row += "❓ "
            body += f"<code>{row.strip()}</code>\n"

        body += f"\n📈 Множитель: <b>x{multiplier:.2f}</b>\n"
        body += f"💎 Открыто ячеек: <b>{len(opened)}/20</b>\n"
        body += f"💣 Мин на поле: <b>{len(mines)}</b>\n"
        if hit is not None:
            body += f"💥 Подорвался на ячейке: <b>{int(hit) + 1}</b>\n"

        hist = state.get("history") or []
        if hist:
            body += "\n<b>История ходов:</b>\n"
            for h in hist[-15:]:
                if h.get("action") == "open":
                    mark = "💎" if h.get("result") == "safe" else "💣"
                    body += f"  {mark} Ячейка {int(h.get('cell', 0)) + 1} → x{h.get('multiplier', 0):.2f}\n"

    # ================== РУЛЕТКА ==================
    elif gtype == "roulette":
        winning_num = state.get("winning_num")
        color = state.get("color") or "—"
        bets = state.get("bets") or []
        results = state.get("results") or []
        total_bet = state.get("total_bet") or bet
        total_win = state.get("total_win") or win_amount
        diff = state.get("diff") or (total_win - total_bet)

        color_emoji = {"Красное": "🔴", "Чёрное": "⚫️", "Зеленое": "🟢"}.get(color, "⚪️")

        body += f"\n━━━━━━━━━━━━━━━━━━━━━━━\n🎡 <b>РУЛЕТКА</b>\n\n"
        if winning_num is not None:
            body += f"🎯 Выпало: <code>{winning_num}</code> {color_emoji} <b>{color}</b>\n"
        body += f"💰 Всего ставок: <b>{_fmt(total_bet)} UP</b>\n"
        body += f"🎁 Общий выигрыш: <b>{_fmt(total_win)} UP</b>\n"
        body += f"📉 Итог: <b>{'+' if diff >= 0 else ''}{_fmt(diff)} UP</b>\n"

        if bets:
            body += "\n<b>Ставки:</b>\n"
            for i, b in enumerate(bets):
                r = results[i] if i < len(results) else "—"
                mark = "✅" if "WIN" in str(r).upper() else "❌"
                body += f"  {mark} {_fmt(b.get('amount'))} UP на <code>{_esc(b.get('val'))}</code> ({b.get('type')})\n"
                if r:
                    body += f"      → {_esc(r)}\n"

    # ================== БЛЭКДЖЕК ==================
    elif gtype == "blackjack":
        p_cards = state.get("p_cards") or []
        d_cards = state.get("d_cards") or []
        p_score = state.get("p_score") or 0
        d_score = state.get("d_score") or 0
        doubled = state.get("doubled")
        hist = state.get("history") or []

        def _cards_str(cards):
            return " ".join([f"{c.get('suit', '')}{c.get('name', '')}" for c in cards]) or "—"

        body += f"\n━━━━━━━━━━━━━━━━━━━━━━━\n🃏 <b>БЛЭКДЖЕК</b>\n\n"
        body += f"🎫 Карты игрока: <code>{_cards_str(p_cards)}</code> → <b>{p_score}</b>\n"
        body += f"🎟 Карты дилера: <code>{_cards_str(d_cards)}</code> → <b>{d_score}</b>\n"
        if doubled:
            body += "💥 <b>Игрок удвоил ставку</b>\n"

        if hist:
            body += "\n<b>История ходов:</b>\n"
            for h in hist:
                act = h.get("action")
                if act == "hit":
                    body += f"  🔹 Hit: {_esc(h.get('card'))} → {h.get('p_score')}\n"
                elif act == "double":
                    body += f"  💥 Double: {h.get('old_bet')}→{h.get('new_bet')}, карта {_esc(h.get('card'))} → {h.get('p_score')}\n"
                elif act == "stand":
                    body += f"  🛑 Stand: {h.get('p_score')}\n"
                elif act == "dealer_play":
                    drew = h.get("drew") or []
                    body += f"  🤖 Дилер добрал: {', '.join(drew) if drew else '—'} → {h.get('d_score')}\n"

    # ================== ФЛИП ==================
    elif gtype == "flip":
        level = state.get("level") or 1
        mult = state.get("multiplier") or 1.0
        hist = state.get("history") or []
        cashout_win = state.get("cashout_win")

        body += f"\n━━━━━━━━━━━━━━━━━━━━━━━\n🎲 <b>FLIP</b>\n\n"
        body += f"📈 Уровень: <b>{level}</b> / 5\n"
        body += f"🔥 Множитель: <b>x{mult:.2f}</b>\n"
        if cashout_win:
            body += f"💎 Забрал: <b>+{_fmt(cashout_win)} UP</b>\n"

        if hist:
            body += "\n<b>История:</b>\n"
            for h in hist:
                lvl = h.get("level")
                if h.get("chose"):
                    mark = "✅" if h.get("win") else "❌"
                    body += f"  {mark} Ур.{lvl}: выбрал {h.get('chose')}, выпало {h.get('result')}\n"
                else:
                    mark = "✅" if h.get("win") else "❌"
                    body += f"  {mark} Ур.{lvl}: x{h.get('multiplier', 1)} — {'успех' if h.get('win') else 'провал'}\n"

    # ================== ХИЛО ==================
    elif gtype == "hilo":
        first_card = state.get("first_card")
        last_card = state.get("last_card")
        mult = state.get("multiplier") or 1.0
        hist = state.get("history") or []

        body += f"\n━━━━━━━━━━━━━━━━━━━━━━━\n📈 <b>ХИЛО</b>\n\n"
        if first_card:
            body += f"🎴 Первая карта: <code>{_esc(first_card)}</code>\n"
        if last_card:
            body += f"🎴 Последняя карта: <code>{_esc(last_card)}</code>\n"
        body += f"🔥 Множитель: <b>x{mult:.2f}</b>\n"

        if hist:
            body += "\n<b>История:</b>\n"
            for h in hist:
                mark = "✅" if h.get("success") else "❌"
                act = "Выше" if h.get("action") == "hilo_higher" else "Ниже"
                body += f"  {mark} {act}: {_esc(h.get('prev_card'))} → {_esc(h.get('new_card'))} (x{h.get('multiplier', 1):.2f})\n"

    # ================== ОХОТА ==================
    elif gtype == "hunt":
        sector = state.get("sector")
        drone = state.get("drone")
        mult = state.get("multiplier")

        body += f"\n━━━━━━━━━━━━━━━━━━━━━━━\n🎯 <b>ОХОТА</b>\n\n"
        if sector is not None:
            body += f"🛰 Сектор: <b>{sector}</b>\n"
        if drone:
            body += f"🛸 Цель: <code>{_esc(drone)}</code>\n"
        if mult:
            body += f"📈 Множитель: <b>x{mult}</b>\n"
        if result == "miss":
            body += "💨 <b>Промах</b>\n"

    # ================== ТРЕЙД ==================
    elif gtype == "trade":
        coin = state.get("coin")
        mult = state.get("multiplier")

        body += f"\n━━━━━━━━━━━━━━━━━━━━━━━\n💼 <b>ТРЕЙД</b>\n\n"
        if coin:
            body += f"💎 Актив: <code>{_esc(coin)}</code>\n"
        if mult:
            body += f"📈 Множитель: <b>x{mult}</b>\n"

    # ================== КУБИК / TG GAMES ==================
    elif gtype in ("dice", "basket", "football", "bowling", "darts", "slots"):
        dv = state.get("dice_value")
        target = state.get("target")
        mult = state.get("multiplier")

        body += f"\n━━━━━━━━━━━━━━━━━━━━━━━\n🎲 <b>{gtype.upper()}</b>\n\n"
        if target is not None:
            body += f"🎯 Цель: <b>{target}</b>\n"
        if dv is not None:
            body += f"🎲 Выпало: <b>{dv}</b>\n"
        if mult:
            body += f"📈 Множитель: <b>x{mult}</b>\n"

    # Универсальный дамп истории, если что-то не отрендерили
    else:
        if state:
            body += "\n━━━━━━━━━━━━━━━━━━━━━━━\n📦 <b>Состояние:</b>\n"
            for k, v in list(state.items())[:15]:
                body += f"  • <b>{_esc(k)}</b>: <code>{_esc(str(v)[:100])}</code>\n"

    return header + body


# ================== ВХОД / ГЛАВНОЕ МЕНЮ ==================
async def open_admin_panel(target):
    try:
        user = target.from_user
        if not user or not _is_creator(user.id):
            await _deny(target)
            return

        nickname = (get_user(user.id) or {}).get("nickname") or DEFAULT_NICK

        text = (
            "🛠️ <b>АДМИН-ПАНЕЛЬ</b>\n\n"
            f"👑 Создатель: <b>{_esc(nickname)}</b>\n"
            f"🆔 ID: <code>{user.id}</code>\n\n"
            "📊 <b>Управление Upgrade Game</b>\n"
            "⚙️ Система полностью под контролем."
        )

        if isinstance(target, types.CallbackQuery):
            await _safe_edit(target, text, kb_main_panel())
        else:
            await target.answer(text, parse_mode="HTML", reply_markup=kb_main_panel())
    except Exception as e:
        logger.exception("open_admin_panel failed: %s", e)


@router.message(Command("admin"))
async def cmd_admin(message: types.Message, state: FSMContext):
    try:
        if not _creator_check(message):
            await _deny(message)
            return
        await state.clear()
        await open_admin_panel(message)
    except Exception as e:
        logger.exception("cmd_admin failed: %s", e)


@router.message(F.text == "🛠️ Админ-панель")
async def btn_admin(message: types.Message, state: FSMContext):
    try:
        if not _creator_check(message):
            return
        await state.clear()
        await open_admin_panel(message)
    except Exception as e:
        logger.exception("btn_admin failed: %s", e)


@router.callback_query(F.data == "adm_main")
async def cb_main(callback: types.CallbackQuery, state: FSMContext):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        await state.clear()
        await open_admin_panel(callback)
    except Exception as e:
        logger.exception("cb_main failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


# ================== ПОИСК ИГРОКА ==================
@router.callback_query(F.data == "adm_find_player")
async def cb_find_player(callback: types.CallbackQuery, state: FSMContext):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        await state.set_state(AdminStates.find_player)
        text = "🔎 <b>ПОИСК ИГРОКА</b>\n\nВведите Telegram ID игрока:"
        await _safe_edit(callback, text, kb_back_main())
    except Exception as e:
        logger.exception("cb_find_player failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.message(AdminStates.find_player)
async def process_find_player(message: types.Message, state: FSMContext):
    try:
        if not _creator_check(message):
            await _deny(message)
            return

        raw = (message.text or "").strip()
        if not raw.isdigit():
            await message.answer("⚠️ ID должен быть числом. Попробуйте снова.")
            return

        user_id = int(raw)
        stats = get_user_stats(user_id)
        if not stats:
            await state.clear()
            await message.answer(
                f"❌ Игрок с ID <code>{user_id}</code> не найден.",
                parse_mode="HTML",
                reply_markup=kb_back_main()
            )
            return

        await state.clear()
        await show_player_card(message, user_id, stats)
    except Exception as e:
        logger.exception("process_find_player failed: %s", e)


async def show_player_card(target, user_id: int, stats: dict):
    try:
        nickname = stats.get("nickname") or DEFAULT_NICK
        reg_date = stats.get("reg_date")
        try:
            reg_str = time.strftime("%d.%m.%Y", time.localtime(int(reg_date))) if reg_date else "—"
        except Exception:
            reg_str = "—"

        bank_card = stats.get("bank_card") or "Не открыта"
        if bank_card and bank_card != "Не открыта":
            bank_card = f"•••• {bank_card[-4:]}"
        bank_bal = stats.get("bank_balance", 0)

        text = (
            "👤 <b>ИГРОК</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n"
            f"🆔 ID: <code>{user_id}</code>\n"
            f"👤 Ник: <b>{_esc(nickname)}</b>\n"
            f"📅 Регистрация: <b>{reg_str}</b>\n"
            f"💰 Баланс: <b>{_fmt(stats.get('balance_up', 0))} UP</b>\n"
            f"💎 UC: <b>{_fmt(stats.get('balance_uc', 0))}</b>\n"
            f"⭐ Уровень: <b>{stats.get('level', 1)}</b>\n"
            f"📈 Опыт: <b>{_fmt(stats.get('xp', 0))}</b>\n"
            f"💼 Работа: <b>{_esc(stats.get('job_key') or '—')}</b> "
            f"(ур. {stats.get('job_level', '—')}, XP {_fmt(stats.get('job_xp', 0))})\n"
            f"🏢 Бизнес: <b>{_esc(stats.get('business_key') or '—')}</b> "
            f"(ур. {stats.get('business_level', '—')})\n"
            f"🚗 Транспорт: <b>{_esc(stats.get('car') or '—')}</b>\n"
            f"🏦 Банк: <b>{_fmt(bank_bal)} UP</b>\n"
            f"💳 Карта: <code>{bank_card}</code>\n"
            f"🎭 Скин: <b>{_esc(stats.get('skin') or 'personage.jpg')}</b>\n"
            f"👥 Рефералов: <b>{stats.get('referrals', 0)}</b>\n"
            f"🎮 Игр: <b>{stats.get('games_total', 0)}</b>\n"
            f"🏆 Побед: <b>{stats.get('games_win', 0)}</b>\n"
            f"❌ Поражений: <b>{stats.get('games_lose', 0)}</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━"
        )

        kb = kb_player_actions(user_id)
        if isinstance(target, types.Message):
            await target.answer(text, parse_mode="HTML", reply_markup=kb)
        else:
            await _safe_edit(target, text, kb)
    except Exception as e:
        logger.exception("show_player_card failed: %s", e)


@router.callback_query(F.data.startswith("adm_player_"))
async def cb_player_again(callback: types.CallbackQuery):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        try:
            user_id = int(callback.data.split("_")[2])
        except (IndexError, ValueError):
            await callback.answer()
            return
        stats = get_user_stats(user_id)
        if not stats:
            await _safe_edit(callback, "❌ Игрок не найден.", kb_back_main())
            return
        await show_player_card(callback, user_id, stats)
    except Exception as e:
        logger.exception("cb_player_again failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


# ================== ПОИСК ИГРЫ ==================
@router.callback_query(F.data == "adm_find_game")
async def cb_find_game(callback: types.CallbackQuery, state: FSMContext):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        await state.set_state(AdminStates.find_game)
        text = (
            "🎮 <b>ПОИСК ИГРЫ</b>\n\n"
            "Введите номер игры в формате:\n"
            "<code>#12345</code>\n\n"
            "<i>Номер игры виден игроку в момент начала игры.</i>"
        )
        await _safe_edit(callback, text, kb_back_main())
    except Exception as e:
        logger.exception("cb_find_game failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.message(AdminStates.find_game)
async def process_find_game(message: types.Message, state: FSMContext):
    try:
        if not _creator_check(message):
            await _deny(message)
            return
        raw = (message.text or "").strip().replace("#", "").strip()
        if not raw.isdigit():
            await message.answer("⚠️ Введите номер игры, например: <code>#12345</code>", parse_mode="HTML")
            return

        gid = int(raw)
        await state.clear()

        # Сначала пробуем game_sessions (там полное состояние)
        session = get_game_session(gid)
        if session:
            text = _render_game(session)

            # Дополнительно — действия из click_logs
            actions = get_game_actions(gid, limit=50)
            if actions:
                text += "\n\n━━━━━━━━━━━━━━━━━━━━━━━\n📋 <b>Действия:</b>\n"
                for a in actions[-20:]:
                    try:
                        ts = time.strftime("%H:%M:%S", time.localtime(a.get("created_at") or 0))
                    except Exception:
                        ts = "—"
                    content = a.get("content") or "—"
                    ch = a.get("balance_change")
                    ch_str = f" ({'+' if ch >= 0 else ''}{_fmt(ch)} UP)" if ch else ""
                    text += f"  [{ts}] {_esc(content[:60])}{ch_str}\n"

            await message.answer(text, parse_mode="HTML", reply_markup=kb_back_main())
            return

        # Fallback: старая таблица games_history
        game = get_game_by_id(gid)
        if not game:
            await message.answer(
                f"❌ Игра <code>#{gid}</code> не найдена.\n\n"
                "💡 Убедитесь, что ввели номер, который показывался игроку.",
                parse_mode="HTML",
                reply_markup=kb_back_main()
            )
            return

        uid = game.get("user_id")
        nickname = (get_user(uid) or {}).get("nickname") or DEFAULT_NICK
        try:
            date_str = time.strftime("%d.%m.%Y %H:%M:%S", time.localtime(game.get("created_at") or 0))
        except Exception:
            date_str = "—"

        bet = game.get("bet") or 0
        win_amt = game.get("win_amount") or 0
        change = win_amt - bet

        text = (
            f"🎮 <b>ИГРА #{gid}</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n"
            f"👤 Игрок: <b>{_esc(nickname)}</b>\n"
            f"🆔 ID: <code>{uid}</code>\n"
            f"🎯 Игра: <b>{_esc(game.get('game_type') or '—')}</b>\n"
            f"💰 Ставка: <b>{_fmt(bet)} UP</b>\n"
            f"📈 Результат: <b>{_esc(game.get('result') or '—')}</b>\n"
            f"💵 Выигрыш: <b>{_fmt(win_amt)} UP</b>\n"
            f"📉 Изменение: <b>{'+' if change >= 0 else ''}{_fmt(change)} UP</b>\n"
            f"🕐 Время: <b>{date_str}</b>\n"
            f"📊 Статус: <b>{_esc(game.get('status') or '—')}</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n"
            "<i>Полное состояние игры недоступно (старая запись).</i>"
        )
        await message.answer(text, parse_mode="HTML", reply_markup=kb_back_main())
    except Exception as e:
        logger.exception("process_find_game failed: %s", e)


# ================== ЛОГИ ==================
@router.callback_query(F.data == "adm_logs")
async def cb_logs(callback: types.CallbackQuery):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        logs = get_admin_logs(limit=20)
        if not logs:
            text = "📜 <b>ЛОГИ</b>\n\nЗаписей пока нет."
        else:
            lines = ["📜 <b>ПОСЛЕДНИЕ 20 ЗАПИСЕЙ</b>\n"]
            for l in logs:
                try:
                    ts = time.strftime("%d.%m %H:%M", time.localtime(l.get("created_at") or 0))
                except Exception:
                    ts = "—"
                who = l.get("display_name") or l.get("username") or l.get("user_id")
                act = l.get("action_type") or "—"
                cmd = (l.get("command") or l.get("message_text") or l.get("callback_data") or "")[:40]
                ch = l.get("balance_change")
                ch_str = f" ({'+' if ch >= 0 else ''}{_fmt(ch)} UP)" if ch else ""
                lines.append(f"[{ts}] <b>{_esc(who)}</b> — {_esc(act)}: <code>{_esc(cmd)}</code>{ch_str}")
            text = "\n".join(lines)

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="🗑 Очистить старые", callback_data="adm_logs_clear")],
                [types.InlineKeyboardButton(text="◀️ Назад", callback_data="adm_main")],
            ]
        )
        await _safe_edit(callback, text, kb)
    except Exception as e:
        logger.exception("cb_logs failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data == "adm_logs_clear")
async def cb_logs_clear(callback: types.CallbackQuery):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        text = (
            "🗑 <b>ОЧИСТКА ЛОГОВ</b>\n\n"
            "Будут удалены записи старше 30 дней.\n\n"
            "⚠️ Действие необратимо. Подтвердите:"
        )
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="✅ Удалить старше 30 дней", callback_data="adm_logs_clear_yes")],
                [types.InlineKeyboardButton(text="❌ Отмена", callback_data="adm_logs")],
            ]
        )
        await _safe_edit(callback, text, kb)
    except Exception as e:
        logger.exception("cb_logs_clear failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data == "adm_logs_clear_yes")
async def cb_logs_clear_yes(callback: types.CallbackQuery):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        deleted = clear_old_logs(days=30)
        await _safe_edit(callback, f"✅ Удалено записей: <b>{deleted}</b>", kb_back_main())
    except Exception as e:
        logger.exception("cb_logs_clear_yes failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


# ================== CLICK-ДАННЫЕ ==================
@router.callback_query(F.data == "adm_click")
async def cb_click(callback: types.CallbackQuery):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return

        await callback.answer("⏳ Формирую файл...", show_alert=False)

        logs = get_all_click_logs(limit=10000)
        if not logs:
            await _safe_edit(callback, "🖱️ Click-логов пока нет.", kb_back_main())
            return

        buf = io.StringIO()
        for l in logs:
            try:
                ts = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(l.get("created_at") or 0))
            except Exception:
                ts = "—"
            name = l.get("display_name") or "—"
            uid = l.get("user_id") or "—"
            uname = l.get("username")
            uname_str = f"@{uname}" if uname else "—"
            ltype = l.get("log_type") or "—"
            content = l.get("content") or "—"
            cb_data = l.get("callback_data") or "—"
            game_type = l.get("game_type") or "—"
            game_id = l.get("game_id") or "—"
            ch = l.get("balance_change")
            ch_str = f"{'+' if ch and ch >= 0 else ''}{ch} UP" if ch else "—"

            buf.write("━━━━━━━━━━━━━━━━━━\n")
            buf.write(f"[{ts}]\n")
            buf.write(f"👤 Пользователь: {name}\n")
            buf.write(f"🆔 ID: {uid}\n")
            buf.write(f"🔗 Username: {uname_str}\n")
            buf.write(f"📍 Тип: {ltype}\n")
            if ltype == "MESSAGE":
                buf.write(f"💬 Текст: {content}\n")
            elif ltype == "CALLBACK":
                buf.write(f"🖱️ Нажато: {content}\n")
                buf.write(f"📦 Callback: {cb_data}\n")
            elif ltype == "GAME":
                buf.write(f"🎮 Действие: {content}\n")
                buf.write(f"🎯 Игра: {game_type} #{game_id}\n")
            else:
                buf.write(f"📌 {content}\n")
            buf.write(f"💰 Изменение баланса: {ch_str}\n")
            if game_type != "—":
                buf.write(f"🎮 Игра: {game_type} #{game_id}\n")

        data = buf.getvalue().encode("utf-8")
        file = types.BufferedInputFile(data, filename="click.txt")

        try:
            await callback.message.answer_document(
                document=file,
                caption=f"🖱️ <b>Click-данные</b>\nЗаписей: <b>{len(logs)}</b>",
                parse_mode="HTML"
            )
        except Exception as e:
            logger.exception("send click.txt failed: %s", e)
            await callback.message.answer("⚠️ Не удалось отправить файл.")
    except Exception as e:
        logger.exception("cb_click failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


# ================== БАЛАНС ==================
@router.callback_query(F.data == "adm_bal_help")
async def cb_bal_help(callback: types.CallbackQuery, state: FSMContext):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        text = (
            "💰 <b>УПРАВЛЕНИЕ БАЛАНСОМ</b>\n\n"
            "Введите Telegram ID игрока:\n\n"
            "<i>Затем выберите действие.</i>"
        )
        await _safe_edit(callback, text, kb_back_main())
        await state.set_state(AdminStates.find_player)
    except Exception as e:
        logger.exception("cb_bal_help failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data.startswith("adm_p_bal_"))
async def cb_player_balance(callback: types.CallbackQuery):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        try:
            user_id = int(callback.data.split("_")[3])
        except (IndexError, ValueError):
            await callback.answer()
            return

        user = get_user(user_id)
        if not user:
            await _safe_edit(callback, "❌ Игрок не найден.", kb_back_main())
            return

        balance = user.get("balance_up") or 0
        text = (
            "💰 <b>БАЛАНС ИГРОКА</b>\n\n"
            f"🆔 ID: <code>{user_id}</code>\n"
            f"👤 Ник: <b>{_esc(user.get('nickname') or DEFAULT_NICK)}</b>\n\n"
            f"Текущий баланс: <b>{_fmt(balance)} UP</b>"
        )
        await _safe_edit(callback, text, kb_balance_actions(user_id))
    except Exception as e:
        logger.exception("cb_player_balance failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data.startswith("adm_bal_add_"))
async def cb_bal_add(callback: types.CallbackQuery, state: FSMContext):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        user_id = int(callback.data.split("_")[3])
        await state.set_state(AdminStates.balance_amount)
        await state.update_data(target_user=user_id, mode="add")
        await _safe_edit(callback, f"➕ Введите сумму UP для выдачи игроку <code>{user_id}</code>:", kb_back_main())
    except Exception as e:
        logger.exception("cb_bal_add failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data.startswith("adm_bal_sub_"))
async def cb_bal_sub(callback: types.CallbackQuery, state: FSMContext):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        user_id = int(callback.data.split("_")[3])
        await state.set_state(AdminStates.balance_amount)
        await state.update_data(target_user=user_id, mode="sub")
        await _safe_edit(callback, f"➖ Введите сумму UP для списания у игрока <code>{user_id}</code>:", kb_back_main())
    except Exception as e:
        logger.exception("cb_bal_sub failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data.startswith("adm_bal_set_"))
async def cb_bal_set(callback: types.CallbackQuery, state: FSMContext):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        user_id = int(callback.data.split("_")[3])
        await state.set_state(AdminStates.balance_set)
        await state.update_data(target_user=user_id)
        await _safe_edit(callback, f"🔄 Введите новый баланс для игрока <code>{user_id}</code>:", kb_back_main())
    except Exception as e:
        logger.exception("cb_bal_set failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.message(AdminStates.balance_amount)
async def process_bal_amount(message: types.Message, state: FSMContext):
    try:
        if not _creator_check(message):
            await _deny(message)
            return
        data = await state.get_data()
        user_id = data.get("target_user")
        mode = data.get("mode")

        raw = (message.text or "").strip().replace(" ", "")
        if not raw.isdigit() or int(raw) <= 0:
            await message.answer("⚠️ Введите положительное число.")
            return

        amount = int(raw)
        if mode == "sub":
            amount = -amount

        admin_id = message.from_user.id
        ok, old, new = admin_add_balance(user_id, amount, admin_id, f"admin_{mode}")
        if not ok:
            await message.answer("❌ Не удалось изменить баланс.")
            await state.clear()
            return

        await state.clear()
        log_action(user_id=admin_id, action_type="admin_balance",
                   balance_before=old, balance_after=new, balance_change=new - old,
                   extra=f"target={user_id}")
        await message.answer(
            f"✅ Баланс игрока <code>{user_id}</code> изменён.\n\n"
            f"Было: <b>{_fmt(old)} UP</b>\n"
            f"Стало: <b>{_fmt(new)} UP</b>\n"
            f"Изменение: <b>{'+' if new - old >= 0 else ''}{_fmt(new - old)} UP</b>",
            parse_mode="HTML",
            reply_markup=kb_back_main()
        )
    except Exception as e:
        logger.exception("process_bal_amount failed: %s", e)


@router.message(AdminStates.balance_set)
async def process_bal_set(message: types.Message, state: FSMContext):
    try:
        if not _creator_check(message):
            await _deny(message)
            return
        data = await state.get_data()
        user_id = data.get("target_user")

        raw = (message.text or "").strip().replace(" ", "")
        if not raw.isdigit():
            await message.answer("⚠️ Введите целое число ≥ 0.")
            return

        new_balance = int(raw)
        admin_id = message.from_user.id
        ok, old, new = admin_set_balance(user_id, new_balance, admin_id, "admin_set")
        if not ok:
            await message.answer("❌ Не удалось установить баланс.")
            await state.clear()
            return

        await state.clear()
        log_action(user_id=admin_id, action_type="admin_set_balance",
                   balance_before=old, balance_after=new, balance_change=new - old,
                   extra=f"target={user_id}")
        await message.answer(
            f"✅ Баланс игрока <code>{user_id}</code> установлен.\n\n"
            f"Было: <b>{_fmt(old)} UP</b>\n"
            f"Стало: <b>{_fmt(new)} UP</b>",
            parse_mode="HTML",
            reply_markup=kb_back_main()
        )
    except Exception as e:
        logger.exception("process_bal_set failed: %s", e)


@router.callback_query(F.data.startswith("adm_bal_hist_"))
async def cb_bal_hist(callback: types.CallbackQuery):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        user_id = int(callback.data.split("_")[3])
        hist = get_balance_history(user_id, limit=15)
        if not hist:
            text = f"📜 История баланса игрока <code>{user_id}</code> пуста."
        else:
            lines = [f"📜 <b>История баланса</b> <code>{user_id}</code>\n"]
            for h in hist:
                try:
                    ts = time.strftime("%d.%m %H:%M", time.localtime(h.get("created_at") or 0))
                except Exception:
                    ts = "—"
                ch = h.get("change_amount") or 0
                lines.append(
                    f"[{ts}] <b>{'+' if ch >= 0 else ''}{_fmt(ch)} UP</b> "
                    f"({_fmt(h.get('old_balance'))}→{_fmt(h.get('new_balance'))}) — {_esc(h.get('reason') or '—')}"
                )
            text = "\n".join(lines)
        await _safe_edit(callback, text, kb_balance_actions(user_id))
    except Exception as e:
        logger.exception("cb_bal_hist failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


# ================== УРОВЕНЬ / XP ==================
@router.callback_query(F.data == "adm_lvl_help")
async def cb_lvl_help(callback: types.CallbackQuery):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        text = "⭐ <b>УПРАВЛЕНИЕ УРОВНЕМ</b>\n\nНайдите игрока через «🔎 Поиск игрока» и выберите «⭐ Уровень»."
        await _safe_edit(callback, text, kb_back_main())
    except Exception as e:
        logger.exception("cb_lvl_help failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data.startswith("adm_p_lvl_"))
async def cb_player_level(callback: types.CallbackQuery):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        user_id = int(callback.data.split("_")[3])
        user = get_user(user_id)
        if not user:
            await _safe_edit(callback, "❌ Игрок не найден.", kb_back_main())
            return
        text = (
            "⭐ <b>УРОВЕНЬ ИГРОКА</b>\n\n"
            f"🆔 ID: <code>{user_id}</code>\n"
            f"⭐ Уровень: <b>{user.get('level', 1)}</b>\n"
            f"📈 XP: <b>{_fmt(user.get('xp', 0))}</b>"
        )
        await _safe_edit(callback, text, kb_level_actions(user_id))
    except Exception as e:
        logger.exception("cb_player_level failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data.startswith("adm_lvl_set_"))
async def cb_lvl_set(callback: types.CallbackQuery, state: FSMContext):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        user_id = int(callback.data.split("_")[3])
        await state.set_state(AdminStates.level_amount)
        await state.update_data(target_user=user_id)
        await _safe_edit(callback, f"⭐ Введите новый уровень для игрока <code>{user_id}</code>:", kb_back_main())
    except Exception as e:
        logger.exception("cb_lvl_set failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.message(AdminStates.level_amount)
async def process_level(message: types.Message, state: FSMContext):
    try:
        if not _creator_check(message):
            await _deny(message)
            return
        data = await state.get_data()
        user_id = data.get("target_user")

        raw = (message.text or "").strip()
        if not raw.isdigit() or int(raw) < 1:
            await message.answer("⚠️ Введите уровень ≥ 1.")
            return

        new_level = int(raw)
        ok, old, new = admin_set_level(user_id, new_level, message.from_user.id, "admin_set")
        await state.clear()
        if not ok:
            await message.answer("❌ Не удалось установить уровень.", reply_markup=kb_back_main())
            return
        await message.answer(
            f"✅ Уровень игрока <code>{user_id}</code>: {old} → <b>{new}</b>",
            parse_mode="HTML",
            reply_markup=kb_back_main()
        )
    except Exception as e:
        logger.exception("process_level failed: %s", e)


@router.callback_query(F.data.startswith("adm_xp_set_"))
async def cb_xp_set(callback: types.CallbackQuery, state: FSMContext):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        user_id = int(callback.data.split("_")[3])
        await state.set_state(AdminStates.xp_amount)
        await state.update_data(target_user=user_id)
        await _safe_edit(callback, f"📈 Введите новый XP для игрока <code>{user_id}</code>:", kb_back_main())
    except Exception as e:
        logger.exception("cb_xp_set failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.message(AdminStates.xp_amount)
async def process_xp(message: types.Message, state: FSMContext):
    try:
        if not _creator_check(message):
            await _deny(message)
            return
        data = await state.get_data()
        user_id = data.get("target_user")

        raw = (message.text or "").strip()
        if not raw.isdigit() or int(raw) < 0:
            await message.answer("⚠️ Введите XP ≥ 0.")
            return

        new_xp = int(raw)
        ok, old, new = admin_set_xp(user_id, new_xp, message.from_user.id, "admin_set")
        await state.clear()
        if not ok:
            await message.answer("❌ Не удалось установить XP.", reply_markup=kb_back_main())
            return
        await message.answer(
            f"✅ XP игрока <code>{user_id}</code>: {_fmt(old)} → <b>{_fmt(new)}</b>",
            parse_mode="HTML",
            reply_markup=kb_back_main()
        )
    except Exception as e:
        logger.exception("process_xp failed: %s", e)


# ================== СКИНЫ ==================
@router.callback_query(F.data == "adm_skin_help")
async def cb_skin_help(callback: types.CallbackQuery):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        text = "🎭 <b>УПРАВЛЕНИЕ СКИНАМИ</b>\n\nНайдите игрока через «🔎 Поиск игрока» и выберите «🎭 Скин»."
        await _safe_edit(callback, text, kb_back_main())
    except Exception as e:
        logger.exception("cb_skin_help failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data.startswith("adm_p_skin_"))
async def cb_player_skin(callback: types.CallbackQuery):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        user_id = int(callback.data.split("_")[3])
        user = get_user(user_id)
        if not user:
            await _safe_edit(callback, "❌ Игрок не найден.", kb_back_main())
            return
        text = (
            "🎭 <b>СКИНЫ ИГРОКА</b>\n\n"
            f"🆔 ID: <code>{user_id}</code>\n"
            f"🎭 Активный: <b>{_esc(user.get('skin') or 'personage.jpg')}</b>"
        )
        await _safe_edit(callback, text, kb_skin_actions(user_id))
    except Exception as e:
        logger.exception("cb_player_skin failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data.startswith("adm_skin_grant_"))
async def cb_skin_grant(callback: types.CallbackQuery, state: FSMContext):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        user_id = int(callback.data.split("_")[3])
        await state.set_state(AdminStates.skin_input)
        await state.update_data(target_user=user_id, skin_mode="grant")
        await _safe_edit(callback, f"🎭 Введите имя файла скина (например: personage3.jpg):", kb_back_main())
    except Exception as e:
        logger.exception("cb_skin_grant failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data.startswith("adm_skin_set_"))
async def cb_skin_set_active(callback: types.CallbackQuery, state: FSMContext):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        user_id = int(callback.data.split("_")[3])
        await state.set_state(AdminStates.skin_input)
        await state.update_data(target_user=user_id, skin_mode="set")
        await _safe_edit(callback, f"⭐ Введите имя файла скина для активации:", kb_back_main())
    except Exception as e:
        logger.exception("cb_skin_set_active failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.message(AdminStates.skin_input)
async def process_skin(message: types.Message, state: FSMContext):
    try:
        if not _creator_check(message):
            await _deny(message)
            return
        data = await state.get_data()
        user_id = data.get("target_user")
        mode = data.get("skin_mode")
        skin = (message.text or "").strip()

        if not skin or len(skin) > 80:
            await message.answer("⚠️ Некорректное имя файла.")
            return

        admin_id = message.from_user.id
        if mode == "grant":
            ok = admin_grant_skin(user_id, skin, admin_id)
            action = "выдан"
        else:
            ok = admin_set_skin(user_id, skin, admin_id)
            action = "активирован"

        await state.clear()
        if not ok:
            await message.answer("❌ Не удалось применить скин.", reply_markup=kb_back_main())
            return

        log_action(user_id=admin_id, action_type=f"admin_skin_{mode}",
                   extra=f"target={user_id} skin={skin}")
        await message.answer(
            f"✅ Скин <code>{_esc(skin)}</code> {action} игроку <code>{user_id}</code>.",
            parse_mode="HTML",
            reply_markup=kb_back_main()
        )
    except Exception as e:
        logger.exception("process_skin failed: %s", e)


@router.callback_query(F.data.startswith("adm_skin_list_"))
async def cb_skin_list(callback: types.CallbackQuery):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        user_id = int(callback.data.split("_")[3])
        skins = get_user_skins(user_id)
        if not skins:
            text = f"📦 У игрока <code>{user_id}</code> нет выданных скинов."
        else:
            lines = [f"📦 <b>Скины игрока</b> <code>{user_id}</code>\n"]
            for sk, active in skins:
                mark = "⭐" if active else "▫️"
                lines.append(f"{mark} <code>{_esc(sk)}</code>")
            text = "\n".join(lines)
        await _safe_edit(callback, text, kb_skin_actions(user_id))
    except Exception as e:
        logger.exception("cb_skin_list failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


# ================== СТАТИСТИКА ==================
@router.callback_query(F.data == "adm_stats_players")
async def cb_stats_players(callback: types.CallbackQuery):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        text = "👥 <b>СТАТИСТИКА ИГРОКОВ</b>\n\nВыберите период:"
        await _safe_edit(callback, text, kb_stats_period("adm_sp"))
    except Exception as e:
        logger.exception("cb_stats_players failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data.startswith("adm_sp_"))
async def cb_stats_players_period(callback: types.CallbackQuery):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        days = int(callback.data.split("_")[2])
        s = get_bot_stats(period_days=days)
        label = {0: "Всё время", 1: "Сегодня", 7: "7 дней", 30: "30 дней"}.get(days, "—")
        text = (
            f"👥 <b>СТАТИСТИКА ИГРОКОВ</b> ({label})\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n"
            f"👥 Всего: <b>{_fmt(s.get('players', 0))}</b>\n"
            f"🟢 Активных (7д): <b>{_fmt(s.get('active', 0))}</b>\n"
            f"🎮 Игр: <b>{_fmt(s.get('games', 0))}</b>\n"
            f"💰 UP в системе: <b>{_fmt(s.get('total_up', 0))}</b>\n"
            f"📈 Выиграно: <b>{_fmt(s.get('won_up', 0))}</b>\n"
            f"📉 Поставлено: <b>{_fmt(s.get('lost_up', 0))}</b>\n"
            f"🏢 Бизнесов: <b>{_fmt(s.get('businesses', 0))}</b>\n"
            f"🏦 Банков: <b>{_fmt(s.get('banks', 0))}</b>\n"
            f"🎭 Скинов: <b>{_fmt(s.get('skins', 0))}</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━"
        )
        await _safe_edit(callback, text, kb_stats_period("adm_sp"))
    except Exception as e:
        logger.exception("cb_stats_players_period failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data == "adm_stats_bot")
async def cb_stats_bot(callback: types.CallbackQuery):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        text = "📊 <b>СТАТИСТИКА БОТА</b>\n\nВыберите период:"
        await _safe_edit(callback, text, kb_stats_period("adm_sb"))
    except Exception as e:
        logger.exception("cb_stats_bot failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data.startswith("adm_sb_"))
async def cb_stats_bot_period(callback: types.CallbackQuery):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        days = int(callback.data.split("_")[2])
        s = get_bot_stats(period_days=days)
        label = {0: "Всё время", 1: "Сегодня", 7: "7 дней", 30: "30 дней"}.get(days, "—")
        text = (
            f"📊 <b>СТАТИСТИКА БОТА</b> ({label})\n"
            "━━━━━━━━━━━━━━━━━━━━━━━\n"
            f"👥 Игроков: <b>{_fmt(s.get('players', 0))}</b>\n"
            f"🎮 Игр: <b>{_fmt(s.get('games', 0))}</b>\n"
            f"💰 UP в системе: <b>{_fmt(s.get('total_up', 0))}</b>\n"
            "━━━━━━━━━━━━━━━━━━━━━━━"
        )
        await _safe_edit(callback, text, kb_stats_period("adm_sb"))
    except Exception as e:
        logger.exception("cb_stats_bot_period failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data.startswith("adm_p_hist_"))
async def cb_player_hist(callback: types.CallbackQuery):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        user_id = int(callback.data.split("_")[3])
        hist = get_balance_history(user_id, limit=15)
        if not hist:
            text = f"📜 История игрока <code>{user_id}</code> пуста."
        else:
            lines = [f"📜 <b>История</b> <code>{user_id}</code>\n"]
            for h in hist:
                try:
                    ts = time.strftime("%d.%m %H:%M", time.localtime(h.get("created_at") or 0))
                except Exception:
                    ts = "—"
                ch = h.get("change_amount") or 0
                lines.append(
                    f"[{ts}] <b>{'+' if ch >= 0 else ''}{_fmt(ch)} UP</b> — {_esc(h.get('reason') or '—')}"
                )
            text = "\n".join(lines)
        await _safe_edit(callback, text, kb_player_actions(user_id))
    except Exception as e:
        logger.exception("cb_player_hist failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data.startswith("adm_p_games_"))
async def cb_player_games(callback: types.CallbackQuery):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        user_id = int(callback.data.split("_")[3])

        try:
            with db_conn() as conn:
                cur = conn.cursor()
                cur.execute("""
                    SELECT game_id, game_type, bet, result, win_amount, created_at
                    FROM games_history WHERE user_id = ?
                    ORDER BY id DESC LIMIT 15
                """, (user_id,))
                rows = cur.fetchall()
        except Exception:
            rows = []

        if not rows:
            text = f"🎮 У игрока <code>{user_id}</code> нет игр."
        else:
            lines = [f"🎮 <b>Последние игры</b> <code>{user_id}</code>\n"]
            for gid, gtype, bet, res, win, ts in rows:
                try:
                    t = time.strftime("%d.%m %H:%M", time.localtime(int(ts or 0)))
                except Exception:
                    t = "—"
                ch = (win or 0) - (bet or 0)
                lines.append(
                    f"#{gid} <b>{_esc(gtype)}</b> [{t}] "
                    f"ставка {_fmt(bet)} → {'✅' if (win or 0) > 0 else '❌'} "
                    f"{'+' if ch >= 0 else ''}{_fmt(ch)} UP"
                )
            text = "\n".join(lines)

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="◀️ Назад", callback_data=f"adm_player_{user_id}")],
            ]
        )
        await _safe_edit(callback, text, kb)
    except Exception as e:
        logger.exception("cb_player_games failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


# ================== РАССЫЛКА ==================
@router.callback_query(F.data == "adm_broadcast")
async def cb_broadcast(callback: types.CallbackQuery, state: FSMContext):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        await state.set_state(AdminStates.broadcast_text)
        text = (
            "📢 <b>РАССЫЛКА</b>\n\n"
            "Отправьте текст сообщения для рассылки всем игрокам.\n\n"
            "⚠️ После отправки потребуется подтверждение."
        )
        await _safe_edit(callback, text, kb_back_main())
    except Exception as e:
        logger.exception("cb_broadcast failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.message(AdminStates.broadcast_text)
async def process_broadcast_text(message: types.Message, state: FSMContext):
    try:
        if not _creator_check(message):
            await _deny(message)
            return
        text = (message.text or "").strip()
        if not text:
            await message.answer("⚠️ Пустое сообщение.")
            return
        await state.update_data(broadcast_text=text)
        await state.set_state(None)

        preview = text[:500]
        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="✅ Отправить", callback_data="adm_broadcast_yes")],
                [types.InlineKeyboardButton(text="❌ Отмена", callback_data="adm_main")],
            ]
        )
        await message.answer(
            f"📢 <b>РАССЫЛКА</b>\n\nСообщение:\n\n{_esc(preview)}\n\nОтправить всем игрокам?",
            parse_mode="HTML",
            reply_markup=kb
        )
    except Exception as e:
        logger.exception("process_broadcast_text failed: %s", e)


@router.callback_query(F.data == "adm_broadcast_yes")
async def cb_broadcast_yes(callback: types.CallbackQuery, state: FSMContext):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        data = await state.get_data()
        text = data.get("broadcast_text")
        if not text:
            await callback.answer("❌ Текст потерян.", show_alert=True)
            return

        await callback.answer("⏳ Начинаю рассылку...", show_alert=False)
        user_ids = get_all_user_ids()
        sent, failed = 0, 0
        for uid in user_ids:
            try:
                await callback.bot.send_message(uid, text, parse_mode="HTML")
                sent += 1
            except Exception:
                failed += 1
        await state.clear()
        log_action(user_id=callback.from_user.id, action_type="broadcast",
                   extra=f"sent={sent} failed={failed}")
        await _safe_edit(
            callback,
            f"✅ <b>Рассылка завершена</b>\n\nОтправлено: <b>{sent}</b>\nОшибок: <b>{failed}</b>",
            kb_back_main()
        )
    except Exception as e:
        logger.exception("cb_broadcast_yes failed: %s", e)


# ================== НАСТРОЙКИ ==================
@router.callback_query(F.data == "adm_settings")
async def cb_settings(callback: types.CallbackQuery):
    try:
        if not _creator_check(callback):
            await _deny(callback)
            return
        text = (
            "⚙️ <b>НАСТРОЙКИ</b>\n\n"
            f"👑 Создатель ID: <code>{CREATOR_ID}</code>\n"
            f"🕐 Время: <b>{datetime.now().strftime('%d.%m.%Y %H:%M')}</b>"
        )
        await _safe_edit(callback, text, kb_back_main())
    except Exception as e:
        logger.exception("cb_settings failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass