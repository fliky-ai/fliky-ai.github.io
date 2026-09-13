import random
import asyncio
import json
import logging
from aiogram import Router, types, F
from database import (
    db_conn,
    check_user_registered,
    get_user,
    DEFAULT_NICK,
    log_action,
    game_session_start,
    game_session_update,
    game_session_end,
)

logger = logging.getLogger(__name__)
router = Router()

# ================== IN-MEMORY СОСТОЯНИЯ ==================
user_states = {}
cooldowns = {}
roulette_bets = {}
blackjack_games = {}
mines_games = {}
hilo_games = {}
hunt_games = {}
trade_games = {}
flip_games = {}

# ================== КОНСТАНТЫ ==================
MIN_BET = 10
MAX_BET = 1_000_000_000
RISK_MULTIPLIERS = {1: 1.5, 2: 2.2, 3: 3.5, 4: 5.0, 5: 8.0}
CARD_SUITS = ["♠️", "♣️", "♥️", "♦️"]
CARD_NAMES = {"Туз": 11, "Король": 10, "Дама": 10, "Валет": 10, "10": 10,
              "9": 9, "8": 8, "7": 7, "6": 6, "5": 5, "4": 4, "3": 3, "2": 2}
HILO_CARDS = [
    {"name": "2", "val": 2, "suit": "♣️"}, {"name": "3", "val": 3, "suit": "♣️"},
    {"name": "4", "val": 4, "suit": "♣️"}, {"name": "5", "val": 5, "suit": "♣️"},
    {"name": "6", "val": 6, "suit": "♣️"}, {"name": "7", "val": 7, "suit": "♣️"},
    {"name": "8", "val": 8, "suit": "♣️"}, {"name": "9", "val": 9, "suit": "♣️"},
    {"name": "10", "val": 10, "suit": "♣️"}, {"name": "Валет", "val": 11, "suit": "♣️"},
    {"name": "Дама", "val": 12, "suit": "♣️"}, {"name": "Король", "val": 13, "suit": "♣️"},
    {"name": "Туз", "val": 14, "suit": "♣️"}
]


# ================== ИНИЦИАЛИЗАЦИЯ ТАБЛИЦ ИГР ==================
def _init_games_tables():
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS game_counters (
                    game_type TEXT PRIMARY KEY,
                    last_id INTEGER DEFAULT 0
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS games_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    game_id INTEGER,
                    game_type TEXT,
                    user_id INTEGER,
                    bet INTEGER,
                    result TEXT,
                    win_amount INTEGER,
                    status TEXT,
                    details TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS active_mines_games (
                    user_id INTEGER PRIMARY KEY,
                    game_id INTEGER,
                    bet INTEGER,
                    mines TEXT,
                    opened TEXT,
                    multiplier REAL,
                    game_over INTEGER,
                    last_clicked INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cur.execute("INSERT OR IGNORE INTO game_counters (game_type, last_id) VALUES ('global_games', 0)")

            # миграция: добавить game_id в games_history, если ещё нет
            cur.execute("PRAGMA table_info(games_history)")
            cols = {c[1] for c in cur.fetchall()}
            if "game_id" not in cols:
                try:
                    cur.execute("ALTER TABLE games_history ADD COLUMN game_id INTEGER")
                    logger.info("Добавлена колонка games_history.game_id")
                except Exception as e:
                    logger.exception("Не удалось добавить game_id: %s", e)

            cur.execute("CREATE INDEX IF NOT EXISTS idx_games_history_user ON games_history(user_id, id DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_games_history_type ON games_history(game_type, id DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_games_history_gid ON games_history(game_id)")
    except Exception as e:
        logger.exception("init_games_tables failed: %s", e)


_init_games_tables()


# ================== УТИЛИТЫ ==================
def get_balance(user_id: int) -> int:
    try:
        user = get_user(user_id)
        return int((user or {}).get("balance_up") or 0)
    except Exception as e:
        logger.exception("get_balance failed for %s: %s", user_id, e)
        return 0


def get_user_nickname(user_id: int) -> str:
    try:
        user = get_user(user_id)
        return (user or {}).get("nickname") or DEFAULT_NICK
    except Exception as e:
        logger.exception("get_user_nickname failed for %s: %s", user_id, e)
        return DEFAULT_NICK


def _esc(s) -> str:
    return (str(s) if s is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _fmt(n) -> str:
    try:
        return f"{int(n):,}".replace(",", " ")
    except (TypeError, ValueError):
        return "0"


def get_next_global_game_id() -> int:
    """Атомарно инкрементит счётчик игр."""
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            cur.execute("SELECT last_id FROM game_counters WHERE game_type = 'global_games'")
            row = cur.fetchone()
            new_id = (row[0] if row else 0) + 1
            cur.execute("INSERT OR REPLACE INTO game_counters (game_type, last_id) VALUES ('global_games', ?)", (new_id,))
            return new_id
    except Exception as e:
        logger.exception("get_next_global_game_id failed: %s", e)
        return int(asyncio.get_event_loop().time() * 1000) % 1_000_000_000


def update_balance(user_id: int, amount: int):
    """Атомарно меняет баланс. Возвращает новый баланс или None."""
    if not isinstance(amount, int):
        return None
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            cur.execute(
                "UPDATE users SET balance_up = balance_up + ? WHERE user_id = ?",
                (amount, user_id)
            )
            if cur.rowcount == 0:
                return None
            cur.execute("SELECT balance_up FROM users WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            return row[0] if row else None
    except Exception as e:
        logger.exception("update_balance failed for %s (%s): %s", user_id, amount, e)
        return None


def try_bet(user_id: int, bet: int) -> bool:
    """Атомарно списывает ставку только если хватает средств."""
    if not isinstance(bet, int) or bet <= 0:
        return False
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            cur.execute("SELECT balance_up FROM users WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            if not row or (row[0] or 0) < bet:
                return False
            cur.execute("UPDATE users SET balance_up = balance_up - ? WHERE user_id = ?", (bet, user_id))
            return True
    except Exception as e:
        logger.exception("try_bet failed for %s (%s): %s", user_id, bet, e)
        return False


def log_game_history(game_type: str, user_id: int, bet: int, result: str,
                     win_amount: int, status: str, details: str = "",
                     game_id: int = None):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO games_history (game_id, game_type, user_id, bet, result, win_amount, status, details)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (game_id, game_type, user_id, bet, result, win_amount, status, details))
    except Exception as e:
        logger.exception("log_game_history failed: %s", e)


# ================== ЛОГИРОВАНИЕ ДЕЙСТВИЙ (click_logs) ==================
def _user_meta(user_id: int):
    """Возвращает (username, display_name) из последних данных."""
    return None, get_user_nickname(user_id)


def log_game_event(user_id: int, game_type: str, game_id: int, action: str,
                   balance_change: int = None, details: str = "", callback_data: str = None):
    """
    Пишет действие в click_logs с game_type/game_id.
    action — короткое имя действия: 'start', 'cell_open', 'side_choose', 'spin', 'hit', 'stand', 'cashout', 'lose' и т.д.
    """
    try:
        username, display = _user_meta(user_id)
        log_action(
            user_id=user_id,
            username=username,
            display_name=display,
            action_type="GAME",
            callback_data=callback_data,
            game_type=game_type,
            game_id=str(game_id),
            balance_change=balance_change,
            extra=f"{action}: {details}" if details else action,
        )
    except Exception as e:
        logger.exception("log_game_event failed: %s", e)


# ================== СОХРАНЕНИЕ / ЗАГРУЗКА МИН ==================
def save_mines_game(user_id: int, game_data: dict):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT OR REPLACE INTO active_mines_games
                (user_id, game_id, bet, mines, opened, multiplier, game_over, last_clicked)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                user_id,
                game_data["game_id"],
                game_data["bet"],
                ",".join(map(str, sorted(game_data["mines"]))),
                ",".join(map(str, sorted(game_data["opened"]))),
                game_data["multiplier"],
                1 if game_data["game_over"] else 0,
                game_data.get("last_clicked", -1)
            ))
    except Exception as e:
        logger.exception("save_mines_game failed for %s: %s", user_id, e)


def load_mines_game(user_id: int):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM active_mines_games WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
        if not row:
            return None
        return {
            "game_id": row[1],
            "bet": row[2],
            "mines": set(map(int, row[3].split(","))) if row[3] else set(),
            "opened": set(map(int, row[4].split(","))) if row[4] else set(),
            "multiplier": row[5],
            "game_over": bool(row[6]),
            "last_clicked": row[7] if row[7] != -1 else None
        }
    except Exception as e:
        logger.exception("load_mines_game failed for %s: %s", user_id, e)
        return None


def delete_mines_game(user_id: int):
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM active_mines_games WHERE user_id = ?", (user_id,))
    except Exception as e:
        logger.exception("delete_mines_game failed for %s: %s", user_id, e)


# ================== ВСПОМОГАТЕЛЬНОЕ ==================
def _clean_user_state(user_id: int):
    for storage in (user_states, roulette_bets, blackjack_games,
                    mines_games, hilo_games, hunt_games, trade_games, flip_games):
        storage.pop(user_id, None)


def get_game_bet_keyboard(game_name: str) -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(
        inline_keyboard=[
            [
                types.InlineKeyboardButton(text="1000 UP", callback_data=f"bet_{game_name}_1000"),
                types.InlineKeyboardButton(text="5000 UP", callback_data=f"bet_{game_name}_5000")
            ],
            [
                types.InlineKeyboardButton(text="10000 UP", callback_data=f"bet_{game_name}_10000"),
                types.InlineKeyboardButton(text="✍️ Своя ставка", callback_data=f"bet_{game_name}_custom")
            ]
        ]
    )


async def _not_registered(message: types.Message) -> bool:
    user_id = message.from_user.id if message.from_user else None
    if not user_id:
        return True
    if check_user_registered(user_id):
        return False
    if message.chat.type == "private":
        try:
            await message.answer(
                "❌ <b>Вы еще не зарегистрированы!</b>\n\n"
                "💡 Пожалуйста, перейдите в <b>личные сообщения</b> бота и нажмите /start, чтобы активировать игровой профиль!",
                parse_mode="HTML"
            )
        except Exception:
            pass
    return True


def _validate_bet(bet: int) -> tuple:
    if not isinstance(bet, int):
        return False, "⚠️ Ставка должна быть числом."
    if bet < MIN_BET:
        return False, f"❌ Минимальная ставка: {MIN_BET} UP!"
    if bet > MAX_BET:
        return False, "❌ Слишком большая ставка."
    return True, ""
# ================== ОБЩИЕ КНОПКИ НАВИГАЦИИ ==================
@router.message(F.text == "Назад")
async def back_to_main_menu(message: types.Message):
    try:
        user_id = message.from_user.id if message.from_user else None
        if not user_id:
            return

        # Логируем
        try:
            log_action(
                user_id=user_id,
                username=message.from_user.username,
                display_name=message.from_user.full_name,
                action_type="MESSAGE",
                command="Назад",
                message_text="Назад",
                extra="back_to_main",
            )
        except Exception:
            pass

        _clean_user_state(user_id)
        delete_mines_game(user_id)
        from handlers.start import cmd_start
        await cmd_start(message)
    except Exception as e:
        logger.exception("back_to_main_menu failed: %s", e)


@router.message(F.text.in_({"🔙 Назад", " Назад", "Назад"}))
async def back_to_games(message: types.Message):
    try:
        user_id = message.from_user.id if message.from_user else None
        if not user_id:
            return

        try:
            log_action(
                user_id=user_id,
                username=message.from_user.username,
                display_name=message.from_user.full_name,
                action_type="MESSAGE",
                command=message.text,
                message_text=message.text,
                extra="back_to_games",
            )
        except Exception:
            pass

        _clean_user_state(user_id)
        delete_mines_game(user_id)
        await cmd_games(message)
    except Exception as e:
        logger.exception("back_to_games failed: %s", e)


# ================== ГЛАВНОЕ МЕНЮ ИГР ==================
@router.message(F.text == "🎮 Игры")
async def cmd_games(message: types.Message):
    try:
        if await _not_registered(message):
            return
        user_id = message.from_user.id

        try:
            log_action(
                user_id=user_id,
                username=message.from_user.username,
                display_name=message.from_user.full_name,
                action_type="MESSAGE",
                command="🎮 Игры",
                message_text="🎮 Игры",
            )
        except Exception:
            pass

        user_states.pop(user_id, None)
        balance = get_balance(user_id)

        kb = types.ReplyKeyboardMarkup(
            keyboard=[
                [types.KeyboardButton(text="🪙 Флип"), types.KeyboardButton(text="🎮 TG Games"), types.KeyboardButton(text="🎡 Рулетка")],
                [types.KeyboardButton(text="🃏Блэкджек"), types.KeyboardButton(text="💣 Мины"), types.KeyboardButton(text="📈Хило")],
                [types.KeyboardButton(text="🏹 Охота"), types.KeyboardButton(text="📊 Трейд"), types.KeyboardButton(text=" Назад")]
            ],
            resize_keyboard=True
        )

        text = (
            f"🎮 <b>UPGRADE GAMES</b>\n\n"
            f"Выберите игру:\n\n"
            f"──────────────────────────\n"
            f"💵 Баланс: <b>{_fmt(balance)} UP</b>"
        )
        await message.answer(text, parse_mode="HTML", reply_markup=kb)
    except Exception as e:
        logger.exception("cmd_games failed: %s", e)


# ================== ФЛИП — ОБЩИЙ СТАРТЕР ==================
async def _start_flip_game(target, user_id: int, bet: int):
    try:
        ok, err = _validate_bet(bet)
        if not ok:
            await target.answer(err)
            return False

        if user_id in flip_games:
            await target.answer("⚠️ У вас уже есть активная игра Флип! Завершите её.")
            return False

        if not try_bet(user_id, bet):
            await target.answer("❌ Недостаточно средств на балансе!")
            return False

        game_id = get_next_global_game_id()
        flip_games[user_id] = {
            "game_id": game_id,
            "bet": bet,
            "level": 1,
            "multiplier": 1.00,
            "status": "waiting_choice",
            "last_interaction": asyncio.get_event_loop().time(),
            "history": [],
        }

        # === Логируем старт игры ===
        log_game_event(
            user_id=user_id,
            game_type="flip",
            game_id=game_id,
            action="start",
            balance_change=-bet,
            details=f"bet={bet}",
        )
        game_session_start(
            game_id=game_id,
            game_type="flip",
            user_id=user_id,
            bet=bet,
            initial_state={
                "level": 1,
                "multiplier": 1.0,
                "status": "waiting_choice",
                "history": [],
            }
        )

        nickname = _esc(get_user_nickname(user_id))
        text = (
            f"╭━━━━━━━━━━━━━━╮\n"
            f"     🎲 FLIP #{game_id}\n"
            f"╰━━━━━━━━━━━━━━╯\n\n"
            f"👤 Игрок: <a href='tg://user?id={user_id}'>{nickname}</a>\n\n"
            f"💰 Ставка:\n"
            f"<b>{_fmt(bet)} UP</b>\n\n"
            f"🔥 Множитель:\n"
            f"x1.00\n\n"
            f"💵 Возможный выигрыш:\n"
            f"<b>{_fmt(bet)} UP</b>\n\n"
            f"<b>Выберите сторону:</b>"
        )

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[
                types.InlineKeyboardButton(text="🪙 Орёл", callback_data=f"flip_side_orel_{game_id}"),
                types.InlineKeyboardButton(text="🪙 Решка", callback_data=f"flip_side_reshka_{game_id}")
            ]]
        )

        if isinstance(target, types.CallbackQuery):
            msg = await target.message.answer(text, parse_mode="HTML", reply_markup=kb)
        else:
            msg = await target.answer(text, parse_mode="HTML", reply_markup=kb)

        flip_games[user_id]["message_id"] = msg.message_id
        flip_games[user_id]["chat_id"] = msg.chat.id

        asyncio.create_task(flip_timeout_guard(user_id, game_id))
        log_game_history("flip", user_id, bet, "started", 0, "active",
                         f"Flip #{game_id} started", game_id=game_id)
        return True
    except Exception as e:
        logger.exception("_start_flip_game failed for %s: %s", user_id, e)
        try:
            await target.answer("⚠️ Ошибка запуска игры. Попробуйте позже.")
        except Exception:
            pass
        return False


async def flip_timeout_guard(user_id: int, game_id: int):
    try:
        await asyncio.sleep(60)
        if user_id in flip_games and flip_games[user_id]["game_id"] == game_id \
                and flip_games[user_id]["status"] == "waiting_choice":
            g = flip_games.pop(user_id)
            update_balance(user_id, g["bet"])

            log_game_event(
                user_id=user_id,
                game_type="flip",
                game_id=game_id,
                action="timeout",
                balance_change=g["bet"],
                details=f"refund {g['bet']}",
            )
            game_session_end(game_id, result="timeout", win_amount=g["bet"],
                             final_state={"status": "timeout"})
            log_game_history("flip", user_id, g["bet"], "timeout", 0, "cancelled",
                             f"Flip #{game_id} timed out", game_id=game_id)
    except Exception as e:
        logger.exception("flip_timeout_guard failed: %s", e)


@router.message(F.text == "🪙 Флип")
async def menu_flip(message: types.Message):
    try:
        if await _not_registered(message):
            return
        try:
            log_action(
                user_id=message.from_user.id,
                username=message.from_user.username,
                display_name=message.from_user.full_name,
                action_type="MESSAGE",
                command="🪙 Флип",
                message_text="🪙 Флип",
            )
        except Exception:
            pass

        await message.answer(
            "🪙 Модуль <b>UPGRADE FLIP</b>.\nВыберите сумму ставки или используйте формат:\n<code>Флип [ставка]</code>\n\n> ⚠️ Мин. ставка: 10 UP",
            parse_mode="HTML",
            reply_markup=get_game_bet_keyboard("flip")
        )
    except Exception as e:
        logger.exception("menu_flip failed: %s", e)


@router.message(F.text.lower().startswith("флип "))
async def text_flip_bet(message: types.Message):
    try:
        if await _not_registered(message):
            return
        parts = (message.text or "").split()
        if len(parts) < 2:
            await message.answer("⚠️ Неверный формат! Пример: <code>Флип 1000</code>", parse_mode="HTML")
            return
        try:
            bet = int(parts[1])
        except ValueError:
            await message.answer("⚠️ Неверный формат! Пример: <code>Флип 1000</code>", parse_mode="HTML")
            return
        await _start_flip_game(message, message.from_user.id, bet)
    except Exception as e:
        logger.exception("text_flip_bet failed: %s", e)


@router.callback_query(F.data.startswith("bet_flip_"))
async def cb_flip_quick_bet(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        parts = (callback.data or "").split("_")
        if len(parts) < 3:
            await callback.answer()
            return
        action = parts[2]

        # логируем нажатие
        try:
            log_action(
                user_id=user_id,
                username=callback.from_user.username,
                display_name=callback.from_user.full_name,
                action_type="CALLBACK",
                callback_data=callback.data,
                game_type="flip",
            )
        except Exception:
            pass

        if action == "custom":
            user_states[user_id] = {"step": "flip_custom"}
            await callback.message.answer("✍️ <b>Введите сумму ставки для Флип:</b>", parse_mode="HTML")
            await callback.answer()
            return

        try:
            bet = int(action)
        except ValueError:
            await callback.answer()
            return

        await _start_flip_game(callback, user_id, bet)
    except Exception as e:
        logger.exception("cb_flip_quick_bet failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data.startswith("flip_side_"))
async def cb_flip_side(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        if user_id not in flip_games:
            await callback.answer("❌ Время игры истекло или игра не найдена.", show_alert=True)
            return

        g = flip_games[user_id]
        parts = (callback.data or "").split("_")
        if len(parts) < 4:
            await callback.answer()
            return
        side = parts[2]
        try:
            cb_game_id = int(parts[3])
        except ValueError:
            await callback.answer()
            return

        if g["game_id"] != cb_game_id or g["status"] != "waiting_choice":
            await callback.answer("⚠️ Актуальная сессия игры изменилась.", show_alert=True)
            return

        side_ru = "ОРЁЛ" if side == "orel" else "РЕШКА"

        # === Логируем выбор стороны ===
        log_game_event(
            user_id=user_id,
            game_type="flip",
            game_id=cb_game_id,
            action="side_choose",
            callback_data=callback.data,
            details=f"chose={side_ru} level={g['level']}",
        )

        g["status"] = "rolling"
        g["side"] = side

        anim_text = (
            f"╭━━━━━━━━━━━━━━╮\n"
            f"     🎲 FLIP #{g['game_id']}\n"
            f"╰━━━━━━━━━━━━━━╯\n\n"
            f"💰 Ставка:\n"
            f"<b>{_fmt(g['bet'])} UP</b>\n\n"
            f"🪙 Выбор:\n"
            f"<b>{side_ru}</b>\n\n"
            f"⏳ Монета вращается...\n\n"
            f"🎲 🪙 🎲 🪙 🎲"
        )
        try:
            await callback.message.edit_text(anim_text, parse_mode="HTML", reply_markup=None)
        except Exception:
            pass

        await asyncio.sleep(1.5)

        result_side = random.choice(["orel", "reshka"])
        result_ru = "ОРЁЛ" if result_side == "orel" else "РЕШКА"

        # сохраняем ход
        g["history"].append({
            "level": g["level"],
            "chose": side_ru,
            "result": result_ru,
            "win": side == result_side,
        })

        if side == result_side:
            g["status"] = "won_round"
            mult = RISK_MULTIPLIERS[1]
            win_amount = int(g["bet"] * mult)
            g["current_win"] = win_amount
            g["multiplier"] = mult

            # === Логируем победу раунда ===
            log_game_event(
                user_id=user_id,
                game_type="flip",
                game_id=cb_game_id,
                action="win_round",
                details=f"level=1 result={result_ru} mult=x{mult} potential_win={win_amount}",
            )
            game_session_update(cb_game_id, {
                "level": g["level"],
                "multiplier": g["multiplier"],
                "status": g["status"],
                "current_win": win_amount,
                "history": g["history"],
            })

            new_bal = get_balance(user_id)
            text = (
                f"╭━━━━━━━━━━━━━━╮\n"
                f" 🏆 FLIP #{g['game_id']} ПОБЕДА\n"
                f"╰━━━━━━━━━━━━━━╯\n\n"
                f"🪙 Выпал:\n"
                f"<b>{result_ru}</b>\n\n"
                f"💰 Ставка:\n"
                f"{_fmt(g['bet'])} UP\n\n"
                f"📈 Множитель:\n"
                f"x{mult}\n\n"
                f"🎁 Выигрыш:\n"
                f"<b>{_fmt(win_amount)} UP</b>\n\n"
                f"💵 Баланс:\n"
                f"<code>{_fmt(new_bal)} UP</code>"
            )
            kb = types.InlineKeyboardMarkup(
                inline_keyboard=[
                    [types.InlineKeyboardButton(text="⚡ Продолжить риск (Ур. 2)", callback_data=f"flip_continue_{g['game_id']}")],
                    [types.InlineKeyboardButton(text="💰 Забрать выигрыш", callback_data=f"flip_cashout_{g['game_id']}")]
                ]
            )
            try:
                await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                pass
            log_game_history("flip", user_id, g["bet"], "win_round_1", win_amount,
                             "in_progress", f"Flip #{g['game_id']} level 1 win", game_id=cb_game_id)
        else:
            new_bal = get_balance(user_id)
            flip_games.pop(user_id, None)

            # === Логируем поражение ===
            log_game_event(
                user_id=user_id,
                game_type="flip",
                game_id=cb_game_id,
                action="lose",
                balance_change=0,
                details=f"level=1 chose={side_ru} result={result_ru} lost_bet={g['bet']}",
            )
            game_session_end(cb_game_id, result="lose", win_amount=0,
                             final_state={
                                 "level": g["level"],
                                 "multiplier": g["multiplier"],
                                 "status": "lose",
                                 "history": g["history"],
                                 "lost_bet": g["bet"],
                             })
            log_game_history("flip", user_id, g["bet"], "lose", 0, "completed",
                             f"Flip #{g['game_id']} lost on level 1", game_id=cb_game_id)

            text = (
                f"╭━━━━━━━━━━━━━━╮\n"
                f" 💀 FLIP #{g['game_id']} ПРОИГРЫШ\n"
                f"╰━━━━━━━━━━━━━━╯\n\n"
                f"🪙 Выпало:\n"
                f"<b>{result_ru}</b>\n\n"
                f"💸 Потеряно:\n"
                f"<b>{_fmt(g['bet'])} UP</b>\n\n"
                f"🔥 Серия:\n"
                f"сброшена\n\n"
                f"💵 Баланс:\n"
                f"<code>{_fmt(new_bal)} UP</code>"
            )
            try:
                await callback.message.edit_text(text, parse_mode="HTML", reply_markup=None)
            except Exception:
                pass
    except Exception as e:
        logger.exception("cb_flip_side failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data.startswith("flip_continue_"))
async def cb_flip_continue(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return
        if user_id not in flip_games:
            await callback.answer("❌ Активная игра не найдена.", show_alert=True)
            return

        g = flip_games[user_id]
        parts = (callback.data or "").split("_")
        try:
            cb_game_id = int(parts[2])
        except (IndexError, ValueError):
            await callback.answer()
            return

        if g["game_id"] != cb_game_id:
            await callback.answer("⚠️ Сессия недействительна.", show_alert=True)
            return

        g["level"] += 1
        lvl = g["level"]
        if lvl > 5:
            await _flip_cashout(callback, user_id)
            return

        mult = RISK_MULTIPLIERS[lvl]
        g["multiplier"] = mult
        win_amount = int(g["bet"] * mult)
        g["current_win"] = win_amount

        success = random.random() < (0.5 / (lvl * 0.2))

        # === Логируем продолжение ===
        log_game_event(
            user_id=user_id,
            game_type="flip",
            game_id=cb_game_id,
            action="continue",
            callback_data=callback.data,
            details=f"level={lvl} mult=x{mult} success={success}",
        )

        try:
            await callback.message.edit_text(
                f"╭━━━━━━━━━━━━━━╮\n     🎲 FLIP #{g['game_id']}\n╰━━━━━━━━━━━━━━╯\n\n⏳ Бросок на уровень риска <b>#{lvl} (x{mult})</b>...",
                parse_mode="HTML", reply_markup=None
            )
        except Exception:
            pass
        await asyncio.sleep(1.5)

        g["history"].append({
            "level": lvl,
            "multiplier": mult,
            "win": success,
        })

        if success:
            new_bal = get_balance(user_id)
            game_session_update(cb_game_id, {
                "level": lvl,
                "multiplier": g["multiplier"],
                "status": "won_round",
                "current_win": win_amount,
                "history": g["history"],
            })

            text = (
                f"╭━━━━━━━━━━━━━━╮\n"
                f" 🏆 FLIP #{g['game_id']} УСПЕХ УР. {lvl}\n"
                f"╰━━━━━━━━━━━━━━╯\n\n"
                f"📈 Множитель: <b>x{mult}</b>\n"
                f"🎁 Выигрыш: <b>{_fmt(win_amount)} UP</b>\n"
                f"🔥 Серия побед: {lvl}\n"
                f"💵 Баланс: <code>{_fmt(new_bal)} UP</code>"
            )
            kb_buttons = []
            if lvl < 5:
                kb_buttons.append([types.InlineKeyboardButton(text=f"🔥 Дальше (Ур. {lvl+1})", callback_data=f"flip_continue_{g['game_id']}")])
            kb_buttons.append([types.InlineKeyboardButton(text="💰 Забрать выигрыш", callback_data=f"flip_cashout_{g['game_id']}")])

            try:
                await callback.message.edit_text(text, parse_mode="HTML",
                                                 reply_markup=types.InlineKeyboardMarkup(inline_keyboard=kb_buttons))
            except Exception:
                pass
            log_game_history("flip", user_id, g["bet"], f"win_round_{lvl}", win_amount,
                             "in_progress", f"Flip #{g['game_id']} level {lvl} win", game_id=cb_game_id)
        else:
            flip_games.pop(user_id, None)
            new_bal = get_balance(user_id)

            log_game_event(
                user_id=user_id,
                game_type="flip",
                game_id=cb_game_id,
                action="lose_streak",
                details=f"level={lvl} lost_bet={g['bet']}",
            )
            game_session_end(cb_game_id, result="lose_streak", win_amount=0,
                             final_state={
                                 "level": lvl,
                                 "multiplier": g["multiplier"],
                                 "status": "lose",
                                 "history": g["history"],
                                 "lost_bet": g["bet"],
                             })
            log_game_history("flip", user_id, g["bet"], "lose_streak", 0, "completed",
                             f"Flip #{g['game_id']} lost on risk level {lvl}", game_id=cb_game_id)

            text = (
                f"╭━━━━━━━━━━━━━━╮\n"
                f" 💀 FLIP #{g['game_id']} ПРОИГРЫШ\n"
                f"╰━━━━━━━━━━━━━━╯\n\n"
                f"💸 Потеряно:\n"
                f"<b>{_fmt(g['bet'])} UP</b>\n\n"
                f"🔥 Серия:\n"
                f"сброшена\n\n"
                f"💵 Баланс:\n"
                f"<code>{_fmt(new_bal)} UP</code>"
            )
            try:
                await callback.message.edit_text(text, parse_mode="HTML", reply_markup=None)
            except Exception:
                pass
    except Exception as e:
        logger.exception("cb_flip_continue failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


async def _flip_cashout(target, user_id: int):
    if user_id not in flip_games:
        await target.answer("❌ Игра уже завершена.", show_alert=True)
        return
    g = flip_games.pop(user_id)
    win_amt = g.get("current_win", g["bet"])
    update_balance(user_id, win_amt)
    new_bal = get_balance(user_id)

    log_game_event(
        user_id=user_id,
        game_type="flip",
        game_id=g["game_id"],
        action="cashout",
        balance_change=win_amt,
        details=f"level={g['level']} mult=x{g['multiplier']} win={win_amt}",
    )
    game_session_end(g["game_id"], result="cashout", win_amount=win_amt,
                     final_state={
                         "level": g["level"],
                         "multiplier": g["multiplier"],
                         "status": "cashout",
                         "history": g.get("history", []),
                         "cashout_win": win_amt,
                     })
    log_game_history("flip", user_id, g["bet"], "cashout", win_amt, "completed",
                     f"Flip #{g['game_id']} cashout at level {g['level']}", game_id=g["game_id"])

    text = (
        f"╭━━━━━━━━━━━━━━╮\n"
        f" 🏆 FLIP #{g['game_id']} ЗАВЕРШЕНА\n"
        f"╰━━━━━━━━━━━━━━╯\n\n"
        f"💎 Вы зафиксировали прибыль: <b>+{_fmt(win_amt)} UP</b>\n"
        f"💵 Баланс: <code>{_fmt(new_bal)} UP</code>"
    )
    try:
        await target.message.edit_text(text, parse_mode="HTML", reply_markup=None)
    except Exception:
        pass


@router.callback_query(F.data.startswith("flip_cashout_"))
async def cb_flip_cashout(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return
        await _flip_cashout(callback, user_id)
        await callback.answer("✅ Выигрыш зачислен на баланс!")
    except Exception as e:
        logger.exception("cb_flip_cashout failed: %s", e)
        try:
            await callback.answer()
        except Exception:
            pass
# ================== TG GAMES МЕНЮ ==================
@router.message(F.text == "🎮 TG Games")
async def tg_games_menu(message: types.Message):
    try:
        if await _not_registered(message):
            return
        user_id = message.from_user.id

        try:
            log_action(
                user_id=user_id,
                username=message.from_user.username,
                display_name=message.from_user.full_name,
                action_type="MESSAGE",
                command="🎮 TG Games",
                message_text="🎮 TG Games",
            )
        except Exception:
            pass

        user_states.pop(user_id, None)

        kb = types.ReplyKeyboardMarkup(
            keyboard=[
                [types.KeyboardButton(text="🏀 Баскетбол"), types.KeyboardButton(text="⚽ Футбол"), types.KeyboardButton(text="🎳 Боулинг")],
                [types.KeyboardButton(text="🎲 Кубик"), types.KeyboardButton(text="🎯 Дартс"), types.KeyboardButton(text="🎰 Слоты")],
                [types.KeyboardButton(text="🔙 Назад")]
            ],
            resize_keyboard=True
        )

        text = (
            f"🚀 <b>UPGRADE TG GAMES</b>\n\n"
            f"🎲 <code>Кубик [число 1-6] [ставка]</code>\n"
            f"🎰 <code>Слоты [ставка]</code>\n"
            f"🏀 <code>Баскетбол [ставка]</code>\n"
            f"⚽ <code>Футбол [ставка]</code>\n"
            f"🎯 <code>Дартс [ставка]</code>\n"
            f"🎳 <code>Боулинг [ставка]</code>\n\n"
            f"> ⚠️ <b>Мин. ставка:</b> <code>{MIN_BET} UP</code>"
        )
        await message.answer(text, parse_mode="HTML", reply_markup=kb)
    except Exception as e:
        logger.exception("tg_games_menu failed: %s", e)


def _make_tg_game_menu_handler(game_key: str, title: str, hint: str):
    async def handler(message: types.Message):
        try:
            if await _not_registered(message):
                return

            try:
                log_action(
                    user_id=message.from_user.id,
                    username=message.from_user.username,
                    display_name=message.from_user.full_name,
                    action_type="MESSAGE",
                    command=message.text,
                    message_text=message.text,
                    game_type=game_key,
                )
            except Exception:
                pass

            await message.answer(
                f"{title} Выберите размер ставки или отправьте командой: \n<code>{hint}</code>",
                parse_mode="HTML",
                reply_markup=get_game_bet_keyboard(game_key)
            )
        except Exception as e:
            logger.exception("tg_game_menu %s failed: %s", game_key, e)
    return handler


_menus = [
    ("basket", "🏀", {"🏀 Баскетбол"}, "Баскетбол [ставка]"),
    ("football", "⚽", {"⚽ Футбол"}, "Футбол [ставка]"),
    ("bowling", "🎳", {"🎳 Боулинг"}, "Боулинг [ставка]"),
    ("dice", "🎲", {"🎲 Кубик"}, "Кубик [число 1-6] [ставка]"),
    ("darts", "🎯", {"🎯 Дартс"}, "Дартс [ставка]"),
    ("slots", "🎰", {"🎰 Слоты"}, "Слоты [ставка]"),
]

for _key, _emoji, _texts, _hint in _menus:
    router.message.register(
        _make_tg_game_menu_handler(_key, _emoji, _hint),
        F.text.in_(_texts)
    )


# ================== ОБРАБОТЧИК СТАВОК TG GAMES ==================
@router.callback_query(F.data.startswith("bet_"))
async def cb_tg_game_bet(callback: types.CallbackQuery):
    try:
        parts = (callback.data or "").split("_")
        if len(parts) < 3:
            await callback.answer()
            return

        game_key, action = parts[1], parts[2]
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return

        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        # Пропускаем flip — у него свой обработчик
        if game_key == "flip":
            return

        # логируем нажатие
        try:
            log_action(
                user_id=user_id,
                username=callback.from_user.username,
                display_name=callback.from_user.full_name,
                action_type="CALLBACK",
                callback_data=callback.data,
                game_type=game_key,
            )
        except Exception:
            pass

        game_map = {"basket": "basket", "football": "football", "bowling": "bowling",
                    "dice": "dice", "darts": "darts", "slots": "slots",
                    "bj": "bj", "mines": "mines", "hilo": "hilo",
                    "hunt": "hunt", "trade": "trade"}

        if game_key not in game_map:
            await callback.answer()
            return

        if action == "custom":
            user_states[user_id] = {"step": f"{game_key}_custom"}
            titles = {"bj": "Блэкджек", "mines": "Мины", "hilo": "Хило", "hunt": "Охоту",
                      "trade": "Трейдинг", "basket": "Баскетбол", "football": "Футбол",
                      "bowling": "Боулинг", "dice": "Кубик", "darts": "Дартс", "slots": "Слоты"}
            label = titles.get(game_key, "вашу ставку")
            await callback.message.answer(f"✍️ <b>Введите сумму ставки на {label} (от {MIN_BET} UP):</b>", parse_mode="HTML")
            return

        try:
            bet = int(action)
        except ValueError:
            await callback.answer()
            return

        if game_key == "bj":
            await start_blackjack(callback.message, user_id, bet)
        elif game_key == "mines":
            await start_mines(callback.message, user_id, bet)
        elif game_key == "hilo":
            await start_hilo(callback.message, user_id, bet)
        elif game_key == "hunt":
            await start_hunt(callback.message, user_id, bet)
        elif game_key == "trade":
            await start_trade(callback.message, user_id, bet)
        elif game_key == "dice":
            user_states[user_id] = {"step": "dice_target_custom", "bet": bet}
            await callback.message.answer("🎲 <b>Введите число от 1 до 6 для броска кубика:</b>", parse_mode="HTML")
        else:
            await execute_game_process(callback.message, user_id, game_map[game_key], bet)
    except Exception as e:
        logger.exception("cb_tg_game_bet failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


# ================== РУЛЕТКА ==================
@router.message(F.text == "Рулетка")
async def cmd_roulette(message: types.Message):
    try:
        if await _not_registered(message):
            return
        user_id = message.from_user.id

        try:
            log_action(
                user_id=user_id,
                username=message.from_user.username,
                display_name=message.from_user.full_name,
                action_type="MESSAGE",
                command="Рулетка",
                message_text=message.text,
                game_type="roulette",
            )
        except Exception:
            pass

        balance = get_balance(user_id)
        roulette_bets[user_id] = []
        user_states[user_id] = {"step": "roulette_bet"}
        await send_roulette_message(message, user_id, balance, edit=False)
    except Exception as e:
        logger.exception("cmd_roulette failed: %s", e)


async def send_roulette_message(message_or_cb, user_id: int, balance: int, edit: bool = False):
    try:
        bets = roulette_bets.get(user_id, [])
        if not bets:
            bets_str = "> 📌 <b>Активные ставки отсутствуют</b>"
            kb_buttons = []
        else:
            bets_str = "\n".join([f"> {i+1}️⃣ <b>{_fmt(b['amount'])} UP</b> на <code>{_esc(b['val'])}</code>" for i, b in enumerate(bets)])
            kb_buttons = [
                [types.InlineKeyboardButton(text="🎯 Запустить колесо", callback_data="roulette_spin"),
                 types.InlineKeyboardButton(text="❌ Сбросить ставки", callback_data="roulette_cancel")]
            ]

        kb = types.InlineKeyboardMarkup(inline_keyboard=kb_buttons) if kb_buttons else None
        game_id = get_next_global_game_id()

        text = (
            f"╭━━━━━━━━━━━━━━╮\n"
            f"     🎡 РУЛЕТКА #{game_id}\n"
            f"╰━━━━━━━━━━━━━━╯\n\n"
            f"💵 <b>Ваш баланс:</b> <code>{_fmt(balance)} UP</code>\n\n"
            f"📊 <b>Текущие ставки:</b>\n{bets_str}\n\n"
            f"📝 <b>Формат ставок в чат:</b>\n"
            f"• <code>30 красное</code>\n"
            f"• <code>90 четное</code>\n"
            f"• <code>50 1-15</code>\n"
            f"• <code>100 17</code>\n\n"
            f"> ⚠️ Мин. ставка: {MIN_BET} UP"
        )

        if edit:
            try:
                await message_or_cb.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                await message_or_cb.message.answer(text, parse_mode="HTML", reply_markup=kb)
        else:
            await message_or_cb.answer(text, parse_mode="HTML", reply_markup=kb)
    except Exception as e:
        logger.exception("send_roulette_message failed: %s", e)


@router.callback_query(F.data == "roulette_cancel")
async def roulette_cancel(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        try:
            log_action(
                user_id=user_id,
                username=callback.from_user.username,
                display_name=callback.from_user.full_name,
                action_type="CALLBACK",
                callback_data="roulette_cancel",
                game_type="roulette",
                extra="cancel_bets",
            )
        except Exception:
            pass

        roulette_bets[user_id] = []
        balance = get_balance(user_id)
        await send_roulette_message(callback, user_id, balance, edit=True)
        await callback.answer("❌ Все ставки успешно аннулированы.")
    except Exception as e:
        logger.exception("roulette_cancel failed: %s", e)
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data == "roulette_spin")
async def roulette_spin(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        bets = roulette_bets.get(user_id, [])
        if not bets:
            await callback.answer("❌ Сделайте хотя бы одну ставку перед запуском!", show_alert=True)
            return

        total_bet = sum(b['amount'] for b in bets)
        if not try_bet(user_id, total_bet):
            await callback.answer("❌ Недостаточно средств для покрытия всех ставок!", show_alert=True)
            return

        game_id = get_next_global_game_id()
        bets_snapshot = [dict(b) for b in bets]

        # === Логируем старт ===
        log_game_event(
            user_id=user_id,
            game_type="roulette",
            game_id=game_id,
            action="start_spin",
            balance_change=-total_bet,
            callback_data=callback.data,
            details=f"total_bet={total_bet} bets={len(bets)}",
        )
        game_session_start(
            game_id=game_id,
            game_type="roulette",
            user_id=user_id,
            bet=total_bet,
            initial_state={
                "bets": bets_snapshot,
                "status": "spinning",
            }
        )

        try:
            await callback.message.edit_text(
                f"╭━━━━━━━━━━━━━━╮\n     🎡 РУЛЕТКА #{game_id}\n╰━━━━━━━━━━━━━━╯\n\n🎯 <b>Колесо запущено... Шар выбирает сектор!</b> 🎡",
                parse_mode="HTML"
            )
        except Exception:
            pass
        await asyncio.sleep(2)

        winning_num = random.randint(0, 36)
        if winning_num == 0:
            color_name, color_emoji = "Зеленое", "🟢"
        elif winning_num % 2 != 0:
            color_name, color_emoji = "Красное", "🔴"
        else:
            color_name, color_emoji = "Чёрное", "⚫️"

        total_win = 0
        results_lines = []
        results_log = []

        for b in bets:
            won, mult, b_type, b_val, amt = False, 2, b['type'], b['val'], b['amount']

            if b_type == "color":
                if (b_val == "красное" and color_name == "Красное") or \
                   (b_val == "черное" and color_name == "Чёрное") or \
                   (b_val == "зеленое" and color_name == "Зеленое"):
                    won, mult = True, (14 if color_name == "Зеленое" else 2)
            elif b_type == "parity":
                if winning_num != 0 and ((b_val == "четное" and winning_num % 2 == 0) or
                                         (b_val == "нечетное" and winning_num % 2 != 0)):
                    won = True
            elif b_type == "range":
                low, high = map(int, b_val.split("-"))
                if low <= winning_num <= high:
                    won, mult = True, 3
            elif b_type == "exact":
                if winning_num == int(b_val):
                    won, mult = True, 35

            if won:
                w_amt = amt * mult
                total_win += w_amt
                results_lines.append(f"> ✅ <b>{_fmt(amt)} UP</b> на <code>{_esc(b_val)}</code> ➔ <b>+{_fmt(w_amt)} UP</b>")
                results_log.append(f"{b_val}: WIN x{mult} (+{w_amt})")
            else:
                results_lines.append(f"> ❌ <b>{_fmt(amt)} UP</b> на <code>{_esc(b_val)}</code>")
                results_log.append(f"{b_val}: LOSE")

        if total_win > 0:
            update_balance(user_id, total_win)

        new_bal = get_balance(user_id)
        diff = total_win - total_bet
        diff_str = f"+{_fmt(diff)} UP" if diff >= 0 else f"{_fmt(diff)} UP"

        res_text = (
            f"╭━━━━━━━━━━━━━━╮\n"
            f" 🎡 РУЛЕТКА #{game_id} ИТОГИ\n"
            f"╰━━━━━━━━━━━━━━╯\n\n"
            f"🎯 <b>Выпало:</b> <code>{winning_num}</code> {color_emoji} <b>{color_name}</b>\n"
            f"💵 <b>Баланс:</b> <code>{_fmt(new_bal)} UP</code>\n\n"
            f"📊 <b>Детализация ставок:</b>\n" + "\n".join(results_lines) + f"\n\n"
            f"> 📈 <b>Чистый результат:</b> <code>{diff_str}</code>"
        )

        # === Логируем результат ===
        log_game_event(
            user_id=user_id,
            game_type="roulette",
            game_id=game_id,
            action="spin_result",
            balance_change=total_win,
            details=f"winning_num={winning_num} color={color_name} total_bet={total_bet} total_win={total_win} diff={diff} | {' ; '.join(results_log)}",
        )
        game_session_end(
            game_id,
            result="win" if total_win > total_bet else ("lose" if total_win == 0 else "partial"),
            win_amount=total_win,
            final_state={
                "bets": bets_snapshot,
                "winning_num": winning_num,
                "color": color_name,
                "total_bet": total_bet,
                "total_win": total_win,
                "diff": diff,
                "results": results_log,
            }
        )
        log_game_history("roulette", user_id, total_bet, "win" if total_win > 0 else "lose",
                         total_win, "completed", f"Roulette #{game_id} result: {winning_num} ({color_name})",
                         game_id=game_id)

        user_states.pop(user_id, None)
        roulette_bets.pop(user_id, None)

        await callback.message.answer(res_text, parse_mode="HTML")
    except Exception as e:
        logger.exception("roulette_spin failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass

# ================== БЛЭКДЖЕК ==================
def calc_bj_score(cards) -> int:
    score = sum(c['val'] for c in cards)
    aces = sum(1 for c in cards if c['name'] == "Туз")
    while score > 21 and aces > 0:
        score -= 10
        aces -= 1
    return score


def _cards_to_list(cards) -> list:
    """Для сохранения в state_json."""
    return [{"name": c["name"], "suit": c["suit"], "val": c["val"]} for c in cards]


@router.message(F.text.in_({"Блэкджек", "🃏Блэкджек", "🃏 Блэкджек"}))
async def menu_blackjack(message: types.Message):
    try:
        if await _not_registered(message):
            return

        try:
            log_action(
                user_id=message.from_user.id,
                username=message.from_user.username,
                display_name=message.from_user.full_name,
                action_type="MESSAGE",
                command=message.text,
                message_text=message.text,
                game_type="blackjack",
            )
        except Exception:
            pass

        await message.answer("♣️ Запуск игрового модуля <b>UPGRADE BLACKJACK</b>. Укажите ставку:",
                             parse_mode="HTML", reply_markup=get_game_bet_keyboard("bj"))
    except Exception as e:
        logger.exception("menu_blackjack failed: %s", e)


async def start_blackjack(message: types.Message, user_id: int, bet: int):
    try:
        ok, err = _validate_bet(bet)
        if not ok:
            await message.answer(err)
            return

        if user_id in blackjack_games:
            await message.answer("⚠️ У вас уже есть активная игра Блэкджек!")
            return

        if not try_bet(user_id, bet):
            await message.answer("❌ Недостаточно средств на балансе!")
            return

        game_id = get_next_global_game_id()
        deck = [{"name": name, "val": val, "suit": suit}
                for suit in CARD_SUITS for name, val in CARD_NAMES.items()]
        random.shuffle(deck)

        p_cards = [deck.pop(), deck.pop()]
        d_cards = [deck.pop(), deck.pop()]

        blackjack_games[user_id] = {
            "game_id": game_id,
            "bet": bet,
            "deck": deck,
            "p_cards": p_cards,
            "d_cards": d_cards,
            "doubled": False,
            "history": [],
        }

        # === Логируем старт ===
        log_game_event(
            user_id=user_id,
            game_type="blackjack",
            game_id=game_id,
            action="start",
            balance_change=-bet,
            details=f"bet={bet} p_cards={[c['name'] for c in p_cards]} d_shown={d_cards[0]['name']}",
        )
        game_session_start(
            game_id=game_id,
            game_type="blackjack",
            user_id=user_id,
            bet=bet,
            initial_state={
                "p_cards": _cards_to_list(p_cards),
                "d_cards": _cards_to_list(d_cards),
                "p_score": calc_bj_score(p_cards),
                "d_visible": d_cards[0]["name"],
                "status": "playing",
                "history": [],
            }
        )

        await render_bj_board(message, user_id)
    except Exception as e:
        logger.exception("start_blackjack failed for %s: %s", user_id, e)
        try:
            await message.answer("⚠️ Ошибка запуска Блэкджека.")
        except Exception:
            pass


async def render_bj_board(target, user_id: int, final: bool = False):
    try:
        g = blackjack_games[user_id]
        p_score = calc_bj_score(g["p_cards"])
        d_score = calc_bj_score([g["d_cards"][0]]) if not final else calc_bj_score(g["d_cards"])

        p_str = "\n".join([f"  • {c['suit']} <b>{c['name']}</b>" for c in g["p_cards"]])
        if not final:
            d_str = f"  • {g['d_cards'][0]['suit']} <b>{g['d_cards'][0]['name']}</b>\n  • 🎴 <i>Скрытая карта</i>"
        else:
            d_str = "\n".join([f"  • {c['suit']} <b>{c['name']}</b>" for c in g["d_cards"]])

        text = (
            f"╭━━━━━━━━━━━━━━╮\n"
            f"   🃏 БЛЭКДЖЕК #{g['game_id']}\n"
            f"╰━━━━━━━━━━━━━━╯\n\n"
            f"👤 <b>Ваши очки:</b> <code>{p_score}</code> ⏐ 🤖 <b>Дилер:</b> <code>{d_score}</code>\n"
            f"💰 <b>Ставка:</b> <code>{_fmt(g['bet'])} UP</code>\n\n"
            f"🎫 <b>Ваши карты:</b>\n{p_str}\n\n"
            f"🎟 <b>Карты дилера:</b>\n{d_str}"
        )

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[
                types.InlineKeyboardButton(text="🔹 Ещё", callback_data="bj_hit"),
                types.InlineKeyboardButton(text="🛑 Стоп", callback_data="bj_stand"),
                types.InlineKeyboardButton(text="💥 Удвоить", callback_data="bj_double")
            ]]
        ) if not final else None

        if isinstance(target, types.CallbackQuery):
            try:
                await target.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                pass
        else:
            await target.answer(text, parse_mode="HTML", reply_markup=kb)
    except Exception as e:
        logger.exception("render_bj_board failed: %s", e)


@router.callback_query(F.data.in_({"bj_hit", "bj_stand", "bj_double"}))
async def bj_actions(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return
        if user_id not in blackjack_games:
            await callback.answer("❌ Активная игра не обнаружена.", show_alert=True)
            return

        g = blackjack_games[user_id]
        action = callback.data
        game_id = g["game_id"]

        if action == "bj_hit":
            new_card = g["deck"].pop()
            g["p_cards"].append(new_card)
            p_score = calc_bj_score(g["p_cards"])

            g["history"].append({
                "action": "hit",
                "card": f"{new_card['name']} {new_card['suit']}",
                "p_score": p_score,
            })

            # === Логируем hit ===
            log_game_event(
                user_id=user_id,
                game_type="blackjack",
                game_id=game_id,
                action="hit",
                callback_data=callback.data,
                details=f"drew={new_card['name']} {new_card['suit']} p_score={p_score}",
            )
            game_session_update(game_id, {
                "p_cards": _cards_to_list(g["p_cards"]),
                "d_cards": _cards_to_list(g["d_cards"]),
                "p_score": p_score,
                "d_score_visible": calc_bj_score([g["d_cards"][0]]),
                "status": "playing",
                "bet": g["bet"],
                "history": g["history"],
            })

            if p_score > 21:
                await finish_blackjack(callback, user_id, "lose",
                                       f"Перебор! Вы набрали {p_score}. Проигрыш.")
                return
            await render_bj_board(callback, user_id)

        elif action == "bj_double":
            if not try_bet(user_id, g["bet"]):
                await callback.answer("❌ Недостаточно средств для удвоения ставки!", show_alert=True)
                return
            old_bet = g["bet"]
            g["bet"] *= 2
            g["doubled"] = True
            new_card = g["deck"].pop()
            g["p_cards"].append(new_card)
            p_score = calc_bj_score(g["p_cards"])

            g["history"].append({
                "action": "double",
                "card": f"{new_card['name']} {new_card['suit']}",
                "old_bet": old_bet,
                "new_bet": g["bet"],
                "p_score": p_score,
            })

            # === Логируем double ===
            log_game_event(
                user_id=user_id,
                game_type="blackjack",
                game_id=game_id,
                action="double",
                callback_data=callback.data,
                balance_change=-old_bet,
                details=f"doubled_bet {old_bet}->{g['bet']} drew={new_card['name']} {new_card['suit']} p_score={p_score}",
            )
            game_session_update(game_id, {
                "p_cards": _cards_to_list(g["p_cards"]),
                "d_cards": _cards_to_list(g["d_cards"]),
                "p_score": p_score,
                "bet": g["bet"],
                "doubled": True,
                "status": "playing",
                "history": g["history"],
            })

            if p_score > 21:
                await finish_blackjack(callback, user_id, "lose",
                                       f"Удвоение привело к перебору ({p_score})! Поражение.")
                return
            await dealer_play_and_finish(callback, user_id)

        elif action == "bj_stand":
            p_score = calc_bj_score(g["p_cards"])

            g["history"].append({
                "action": "stand",
                "p_score": p_score,
            })

            # === Логируем stand ===
            log_game_event(
                user_id=user_id,
                game_type="blackjack",
                game_id=game_id,
                action="stand",
                callback_data=callback.data,
                details=f"p_score={p_score}",
            )

            await dealer_play_and_finish(callback, user_id)
    except Exception as e:
        logger.exception("bj_actions failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


async def dealer_play_and_finish(callback: types.CallbackQuery, user_id: int):
    try:
        g = blackjack_games[user_id]
        game_id = g["game_id"]

        dealer_draws = []
        while calc_bj_score(g["d_cards"]) < 17:
            new_card = g["deck"].pop()
            g["d_cards"].append(new_card)
            dealer_draws.append(f"{new_card['name']} {new_card['suit']}")

        p_score = calc_bj_score(g["p_cards"])
        d_score = calc_bj_score(g["d_cards"])

        g["history"].append({
            "action": "dealer_play",
            "drew": dealer_draws,
            "d_score": d_score,
        })

        # === Логируем ходы дилера ===
        log_game_event(
            user_id=user_id,
            game_type="blackjack",
            game_id=game_id,
            action="dealer_play",
            details=f"drew={dealer_draws} p_score={p_score} d_score={d_score}",
        )

        if d_score > 21 or p_score > d_score:
            if d_score > 21:
                msg, outcome = (f"У дилера перебор ({d_score})! Победа.", "win")
            else:
                msg, outcome = (f"Вы обыграли крупье: {p_score} против {d_score}.", "win")
        elif p_score < d_score:
            msg, outcome = (f"Дилер набрал больше: {d_score} против {p_score}. Поражение.", "lose")
        else:
            msg, outcome = (f"Ничья: {p_score}. Ставка возвращена.", "draw")

        await finish_blackjack(callback, user_id, outcome, msg)
    except Exception as e:
        logger.exception("dealer_play_and_finish failed: %s", e)


async def finish_blackjack(callback: types.CallbackQuery, user_id: int, outcome: str, msg: str):
    try:
        if user_id not in blackjack_games:
            return
        g = blackjack_games[user_id]
        game_id = g["game_id"]
        bet = g["bet"]
        win_amt = 0
        balance_change = 0

        if outcome == "win":
            win_amt = bet * 2
            update_balance(user_id, win_amt)
            balance_change = win_amt - bet  # чистая прибыль
        elif outcome == "draw":
            win_amt = bet
            update_balance(user_id, bet)
            balance_change = 0

        # === Логируем завершение ===
        log_game_event(
            user_id=user_id,
            game_type="blackjack",
            game_id=game_id,
            action=f"finish_{outcome}",
            balance_change=balance_change,
            details=f"bet={bet} win_amount={win_amt} p_score={calc_bj_score(g['p_cards'])} d_score={calc_bj_score(g['d_cards'])} result={outcome}",
        )
        game_session_end(
            game_id,
            result=outcome,
            win_amount=win_amt,
            final_state={
                "p_cards": _cards_to_list(g["p_cards"]),
                "d_cards": _cards_to_list(g["d_cards"]),
                "p_score": calc_bj_score(g["p_cards"]),
                "d_score": calc_bj_score(g["d_cards"]),
                "bet": bet,
                "doubled": g.get("doubled", False),
                "result": outcome,
                "win_amount": win_amt,
                "history": g["history"],
            }
        )

        await render_bj_board(callback, user_id, final=True)
        new_bal = get_balance(user_id)
        log_game_history("blackjack", user_id, bet, outcome, win_amt, "completed", msg, game_id=game_id)

        header = "ПОБЕДА" if outcome == "win" else ("ПРОИГРЫШ" if outcome == "lose" else "НИЧЬЯ")
        text = (
            f"╭━━━━━━━━━━━━━━╮\n"
            f" 🃏 БЛЭКДЖЕК #{game_id} {header}\n"
            f"╰━━━━━━━━━━━━━━╯\n\n"
            f"🏁 {msg}\n"
            f"💵 Баланс: <code>{_fmt(new_bal)} UP</code>"
        )
        await callback.message.answer(text, parse_mode="HTML")
        blackjack_games.pop(user_id, None)
    except Exception as e:
        logger.exception("finish_blackjack failed: %s", e)
# ================== МИНЫ ==================
@router.message(F.text == "Мины")
async def menu_mines(message: types.Message):
    try:
        if await _not_registered(message):
            return
        user_id = message.from_user.id

        try:
            log_action(
                user_id=user_id,
                username=message.from_user.username,
                display_name=message.from_user.full_name,
                action_type="MESSAGE",
                command="Мины",
                message_text=message.text,
                game_type="mines",
            )
        except Exception:
            pass

        saved_game = load_mines_game(user_id)
        if saved_game and not saved_game["game_over"]:
            mines_games[user_id] = saved_game
            await render_mines_board(message, user_id)
            return

        await message.answer("💣 Модуль <b>UPGRADE MINES</b> (поле 5x5). Укажите ставку:",
                             parse_mode="HTML", reply_markup=get_game_bet_keyboard("mines"))
    except Exception as e:
        logger.exception("menu_mines failed: %s", e)


async def start_mines(message: types.Message, user_id: int, bet: int):
    try:
        ok, err = _validate_bet(bet)
        if not ok:
            await message.answer(err)
            return

        if user_id in mines_games:
            await message.answer("⚠️ У вас уже есть активная игра Мины!")
            return

        if not try_bet(user_id, bet):
            await message.answer("❌ Недостаточно средств!")
            return

        game_id = get_next_global_game_id()
        mines_positions = sorted(random.sample(range(25), 5))

        mines_data = {
            "game_id": game_id,
            "bet": bet,
            "mines": set(mines_positions),
            "opened": set(),
            "multiplier": 1.0,
            "game_over": False,
            "last_clicked": None,
            "history": [],
        }
        mines_games[user_id] = mines_data
        save_mines_game(user_id, mines_data)

        # === Логируем старт ===
        log_game_event(
            user_id=user_id,
            game_type="mines",
            game_id=game_id,
            action="start",
            balance_change=-bet,
            details=f"bet={bet} mines={mines_positions}",
        )
        game_session_start(
            game_id=game_id,
            game_type="mines",
            user_id=user_id,
            bet=bet,
            initial_state={
                "mines": mines_positions,
                "opened": [],
                "multiplier": 1.0,
                "bet": bet,
                "status": "playing",
                "history": [],
            }
        )

        await render_mines_board(message, user_id)
    except Exception as e:
        logger.exception("start_mines failed for %s: %s", user_id, e)
        try:
            await message.answer("⚠️ Ошибка запуска игры.")
        except Exception:
            pass


def get_mines_kb(user_id: int) -> types.InlineKeyboardMarkup:
    g = mines_games[user_id]
    kb = []
    for r in range(5):
        row = []
        for c in range(5):
            idx = r * 5 + c
            if idx in g["opened"]:
                txt, cb = "💎", "none"
            else:
                if not g["game_over"]:
                    txt, cb = "❓", f"mine_cell_{idx}"
                else:
                    if idx == g.get("last_clicked"):
                        txt = "🔥"
                    elif idx in g["mines"]:
                        txt = "💣"
                    else:
                        txt = "◽"
                    cb = "none"
            row.append(types.InlineKeyboardButton(text=txt, callback_data=cb))
        kb.append(row)

    if not g["game_over"] and len(g["opened"]) > 0:
        win_payout = int(g['bet'] * g['multiplier'])
        kb.append([types.InlineKeyboardButton(text=f"💰 Забрать {_fmt(win_payout)} UP", callback_data="mine_cashout")])
    return types.InlineKeyboardMarkup(inline_keyboard=kb)


async def render_mines_board(target, user_id: int):
    try:
        g = mines_games[user_id]
        status = "💎 Ищите кристаллы на поле 5x5 и избегайте ловушек!" if not g["game_over"] else "💥 <b>Игра окончена!</b>"
        text = (
            f"╭━━━━━━━━━━━━━━╮\n"
            f"     💣 МИНЫ #{g['game_id']}\n"
            f"╰━━━━━━━━━━━━━━╯\n\n"
            f"💰 <b>Ставка:</b> <code>{_fmt(g['bet'])} UP</code>\n"
            f"📈 <b>Множитель:</b> <code>x{g['multiplier']:.2f}</code>\n"
            f"💎 <b>Потенциал:</b> <code>{_fmt(int(g['bet'] * g['multiplier']))} UP</code>\n\n"
            f"> {status}"
        )
        kb = get_mines_kb(user_id)
        if isinstance(target, types.CallbackQuery):
            try:
                await target.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
            except Exception:
                pass
        else:
            await target.answer(text, parse_mode="HTML", reply_markup=kb)
    except Exception as e:
        logger.exception("render_mines_board failed: %s", e)


@router.callback_query(F.data.startswith("mine_cell_"))
async def cb_mine_click(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        if user_id not in mines_games:
            saved_game = load_mines_game(user_id)
            if saved_game:
                mines_games[user_id] = saved_game
            else:
                await callback.answer("❌ Игра не найдена или завершена.", show_alert=True)
                return

        g = mines_games[user_id]
        if g["game_over"]:
            await callback.answer("❌ Игра уже завершена.", show_alert=True)
            return

        try:
            idx = int((callback.data or "").split("_")[2])
        except (IndexError, ValueError):
            await callback.answer()
            return

        if not (0 <= idx <= 24):
            await callback.answer("⚠️ Некорректная ячейка.")
            return

        if idx in g["opened"]:
            await callback.answer("⚠️ Ячейка уже открыта!")
            return

        game_id = g["game_id"]

        # === МИНА ===
        if idx in g["mines"]:
            g["game_over"] = True
            g["last_clicked"] = idx
            g["history"].append({
                "action": "open",
                "cell": idx,
                "result": "mine",
                "multiplier": g["multiplier"],
                "opened_count": len(g["opened"]),
            })
            mines_games[user_id] = g
            save_mines_game(user_id, g)
            await render_mines_board(callback, user_id)
            new_bal = get_balance(user_id)

            log_game_event(
                user_id=user_id,
                game_type="mines",
                game_id=game_id,
                action="hit_mine",
                callback_data=callback.data,
                balance_change=0,
                details=f"cell={idx} lost_bet={g['bet']} opened_safe={len(g['opened'])} multiplier=x{g['multiplier']:.2f}",
            )
            game_session_end(
                game_id,
                result="lose",
                win_amount=0,
                final_state={
                    "mines": sorted(g["mines"]),
                    "opened": sorted(g["opened"]),
                    "hit_mine": idx,
                    "multiplier": g["multiplier"],
                    "bet": g["bet"],
                    "status": "lose",
                    "history": g["history"],
                }
            )
            log_game_history("mines", user_id, g["bet"], "lose", 0, "completed",
                             f"Mines #{game_id} hit mine at cell {idx}", game_id=game_id)

            text = (
                f"╭━━━━━━━━━━━━━━╮\n"
                f" 💣 МИНЫ #{g['game_id']} ПРОИГРЫШ\n"
                f"╰━━━━━━━━━━━━━━╯\n\n"
                f"💥 БУМ! Вы подорвались на мине (ячейка {idx + 1}).\n"
                f"💸 Потеряно: <code>{_fmt(g['bet'])} UP</code>\n"
                f"💵 Баланс: <code>{_fmt(new_bal)} UP</code>"
            )
            await callback.message.answer(text, parse_mode="HTML")
            delete_mines_game(user_id)
            mines_games.pop(user_id, None)
            return

        # === БЕЗОПАСНАЯ ЯЧЕЙКА ===
        g["opened"].add(idx)
        g["multiplier"] += 0.30
        g["history"].append({
            "action": "open",
            "cell": idx,
            "result": "safe",
            "multiplier": g["multiplier"],
            "opened_count": len(g["opened"]),
        })
        mines_games[user_id] = g
        save_mines_game(user_id, g)

        log_game_event(
            user_id=user_id,
            game_type="mines",
            game_id=game_id,
            action="cell_open",
            callback_data=callback.data,
            details=f"cell={idx} safe multiplier=x{g['multiplier']:.2f} opened={len(g['opened'])}/20",
        )
        game_session_update(game_id, {
            "mines": sorted(g["mines"]),
            "opened": sorted(g["opened"]),
            "multiplier": g["multiplier"],
            "bet": g["bet"],
            "status": "playing",
            "history": g["history"],
        })

        # === ВСЕ БЕЗОПАСНЫЕ ОТКРЫТЫ ===
        if len(g["opened"]) == 20:
            win_amt = int(g["bet"] * g['multiplier'])
            update_balance(user_id, win_amt)
            g["game_over"] = True
            await render_mines_board(callback, user_id)
            new_bal = get_balance(user_id)

            log_game_event(
                user_id=user_id,
                game_type="mines",
                game_id=game_id,
                action="win_all_cleared",
                balance_change=win_amt,
                details=f"all_safe_cleared multiplier=x{g['multiplier']:.2f} win={win_amt}",
            )
            game_session_end(
                game_id,
                result="win",
                win_amount=win_amt,
                final_state={
                    "mines": sorted(g["mines"]),
                    "opened": sorted(g["opened"]),
                    "multiplier": g["multiplier"],
                    "bet": g["bet"],
                    "status": "win",
                    "win_amount": win_amt,
                    "history": g["history"],
                }
            )
            log_game_history("mines", user_id, g["bet"], "win", win_amt, "completed",
                             f"Mines #{game_id} cleared all safe cells", game_id=game_id)

            text = (
                f"╭━━━━━━━━━━━━━━╮\n"
                f" 💣 МИНЫ #{g['game_id']} ПОБЕДА\n"
                f"╰━━━━━━━━━━━━━━╯\n\n"
                f"🏆 Все безопасные ячейки найдены!\n"
                f"🎁 Выигрыш: <b>+{_fmt(win_amt)} UP</b>\n"
                f"💵 Баланс: <code>{_fmt(new_bal)} UP</code>"
            )
            await callback.message.answer(text, parse_mode="HTML")
            delete_mines_game(user_id)
            mines_games.pop(user_id, None)
        else:
            await render_mines_board(callback, user_id)
    except Exception as e:
        logger.exception("cb_mine_click failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data == "mine_cashout")
async def cb_mine_cashout(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return

        if user_id not in mines_games:
            saved_game = load_mines_game(user_id)
            if saved_game:
                mines_games[user_id] = saved_game
            else:
                await callback.answer("❌ Игра не найдена!", show_alert=True)
                return

        g = mines_games[user_id]
        if len(g["opened"]) == 0:
            await callback.answer("❌ Откройте хотя бы одну ячейку!", show_alert=True)
            return

        game_id = g["game_id"]
        win_amt = int(g["bet"] * g["multiplier"])
        update_balance(user_id, win_amt)
        g["game_over"] = True
        await render_mines_board(callback, user_id)
        new_bal = get_balance(user_id)

        log_game_event(
            user_id=user_id,
            game_type="mines",
            game_id=game_id,
            action="cashout",
            callback_data=callback.data,
            balance_change=win_amt,
            details=f"multiplier=x{g['multiplier']:.2f} win={win_amt} opened={len(g['opened'])}/20",
        )
        game_session_end(
            game_id,
            result="cashout",
            win_amount=win_amt,
            final_state={
                "mines": sorted(g["mines"]),
                "opened": sorted(g["opened"]),
                "multiplier": g["multiplier"],
                "bet": g["bet"],
                "status": "cashout",
                "win_amount": win_amt,
                "history": g["history"],
            }
        )
        log_game_history("mines", user_id, g["bet"], "cashout", win_amt, "completed",
                         f"Mines #{game_id} cashout x{g['multiplier']:.2f}", game_id=game_id)

        text = (
            f"╭━━━━━━━━━━━━━━╮\n"
            f" 💣 МИНЫ #{g['game_id']} ПОБЕДА\n"
            f"╰━━━━━━━━━━━━━━╯\n\n"
            f"✅ Вы зафиксировали прибыль!\n"
            f"🎁 Выигрыш: <b>+{_fmt(win_amt)} UP</b>\n"
            f"💵 Баланс: <code>{_fmt(new_bal)} UP</code>"
        )
        await callback.message.answer(text, parse_mode="HTML")
        delete_mines_game(user_id)
        mines_games.pop(user_id, None)
        await callback.answer()
    except Exception as e:
        logger.exception("cb_mine_cashout failed: %s", e)
        try:
            await callback.answer()
        except Exception:
            pass


# ================== ХИЛО ==================
@router.message(F.text.in_({"Хило", "📈Хило", "📈 Хило"}))
async def menu_hilo(message: types.Message):
    try:
        if await _not_registered(message):
            return

        try:
            log_action(
                user_id=message.from_user.id,
                username=message.from_user.username,
                display_name=message.from_user.full_name,
                action_type="MESSAGE",
                command=message.text,
                message_text=message.text,
                game_type="hilo",
            )
        except Exception:
            pass

        await message.answer("📈 Модуль <b>UPGRADE HILO</b> (Выше/Ниже). Укажите ставку:",
                             parse_mode="HTML", reply_markup=get_game_bet_keyboard("hilo"))
    except Exception as e:
        logger.exception("menu_hilo failed: %s", e)


async def start_hilo(message: types.Message, user_id: int, bet: int):
    try:
        ok, err = _validate_bet(bet)
        if not ok:
            await message.answer(err)
            return

        if user_id in hilo_games:
            await message.answer("⚠️ У вас уже есть активная игра Хило!")
            return

        if not try_bet(user_id, bet):
            await message.answer("❌ Недостаточно средств!")
            return

        game_id = get_next_global_game_id()
        first_card = random.choice(HILO_CARDS)

        hilo_games[user_id] = {
            "game_id": game_id,
            "bet": bet,
            "card": first_card,
            "multiplier": 1.0,
            "game_over": False,
            "history": [],
        }

        log_game_event(
            user_id=user_id,
            game_type="hilo",
            game_id=game_id,
            action="start",
            balance_change=-bet,
            details=f"bet={bet} first_card={first_card['name']} {first_card['suit']}",
        )
        game_session_start(
            game_id=game_id,
            game_type="hilo",
            user_id=user_id,
            bet=bet,
            initial_state={
                "first_card": f"{first_card['name']} {first_card['suit']}",
                "first_card_val": first_card["val"],
                "multiplier": 1.0,
                "bet": bet,
                "status": "playing",
                "history": [],
            }
        )

        await render_hilo_board(message, user_id, edit=False)
    except Exception as e:
        logger.exception("start_hilo failed for %s: %s", user_id, e)
        try:
            await message.answer("⚠️ Ошибка запуска игры.")
        except Exception:
            pass


def get_hilo_kb(user_id: int) -> types.InlineKeyboardMarkup:
    g = hilo_games[user_id]
    val = g["card"]["val"]
    higher_count = max(1, 14 - val)
    lower_count = max(1, val - 2)
    h_mult = round(max(1.05, min(15.0, 0.95 * (13 / higher_count))), 2) if val < 14 else 0
    l_mult = round(max(1.05, min(15.0, 0.95 * (13 / lower_count))), 2) if val > 2 else 0
    h_text = f"📈 Выше (x{h_mult})" if val < 14 else "⛔️ Закрыто"
    l_text = f"📉 Ниже (x{l_mult})" if val > 2 else "⛔️ Закрыто"
    current_win = int(g["bet"] * g["multiplier"])

    return types.InlineKeyboardMarkup(
        inline_keyboard=[
            [
                types.InlineKeyboardButton(text=h_text, callback_data="hilo_higher" if val < 14 else "hilo_none"),
                types.InlineKeyboardButton(text=l_text, callback_data="hilo_lower" if val > 2 else "hilo_none")
            ],
            [
                types.InlineKeyboardButton(text=f"💰 Забрать выигрыш ({_fmt(current_win)} UP)", callback_data="hilo_cashout")
            ]
        ]
    )


async def render_hilo_board(target, user_id: int, edit: bool = True):
    try:
        g = hilo_games[user_id]
        current_win = int(g["bet"] * g["multiplier"])
        text = (
            f"╭━━━━━━━━━━━━━━╮\n"
            f"     📈 ХИЛО #{g['game_id']}\n"
            f"╰━━━━━━━━━━━━━━╯\n\n"
            f"🎴 <b>Текущая карта:</b> <code>{g['card']['name']} {g['card']['suit']}</code>\n"
            f"💰 <b>Начальная ставка:</b> <code>{_fmt(g['bet'])} UP</code>\n"
            f"📈 <b>Множитель раунда:</b> <code>x{g['multiplier']:.2f}</code>\n"
            f"💎 <b>Текущий выигрыш:</b> <b>{_fmt(current_win)} UP</b>\n\n"
            f"> 🎯 Сделайте выбор:"
        )
        kb = get_hilo_kb(user_id)

        if isinstance(target, types.CallbackQuery):
            if edit:
                try:
                    await target.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
                except Exception:
                    pass
            else:
                await target.message.answer(text, parse_mode="HTML", reply_markup=kb)
        else:
            await target.answer(text, parse_mode="HTML", reply_markup=kb)
    except Exception as e:
        logger.exception("render_hilo_board failed: %s", e)


@router.callback_query(F.data.in_({"hilo_higher", "hilo_lower", "hilo_cashout"}))
async def cb_hilo_actions(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return
        if user_id not in hilo_games:
            await callback.answer("❌ Игра завершена.", show_alert=True)
            return

        g = hilo_games[user_id]
        game_id = g["game_id"]

        if callback.data == "hilo_cashout":
            win_amt = int(g["bet"] * g["multiplier"])
            update_balance(user_id, win_amt)
            new_bal = get_balance(user_id)

            log_game_event(
                user_id=user_id,
                game_type="hilo",
                game_id=game_id,
                action="cashout",
                callback_data=callback.data,
                balance_change=win_amt,
                details=f"multiplier=x{g['multiplier']:.2f} win={win_amt}",
            )
            game_session_end(
                game_id,
                result="cashout",
                win_amount=win_amt,
                final_state={
                    "last_card": f"{g['card']['name']} {g['card']['suit']}",
                    "multiplier": g["multiplier"],
                    "bet": g["bet"],
                    "status": "cashout",
                    "win_amount": win_amt,
                    "history": g["history"],
                }
            )
            log_game_history("hilo", user_id, g["bet"], "cashout", win_amt, "completed",
                             f"Hilo #{game_id} cashout x{g['multiplier']:.2f}", game_id=game_id)

            try:
                text = (
                    f"╭━━━━━━━━━━━━━━╮\n"
                    f" 📈 ХИЛО #{g['game_id']} ПОБЕДА\n"
                    f"╰━━━━━━━━━━━━━━╯\n\n"
                    f"✅ Выигрыш успешно забран!\n"
                    f"💎 Получено: <b>+{_fmt(win_amt)} UP</b>\n"
                    f"💵 Баланс: <code>{_fmt(new_bal)} UP</code>"
                )
                await callback.message.edit_text(text, parse_mode="HTML", reply_markup=None)
            except Exception:
                pass
            hilo_games.pop(user_id, None)
            return

        # === Higher / Lower ===
        curr_card = g["card"]
        curr_val = curr_card["val"]
        new_card = random.choice(HILO_CARDS)

        h_mult = round(max(1.05, min(15.0, 0.95 * (13 / max(1, 14 - curr_val)))), 2)
        l_mult = round(max(1.05, min(15.0, 0.95 * (13 / max(1, curr_val - 2)))), 2)

        action = callback.data
        success = ((action == "hilo_higher" and new_card["val"] >= curr_val) or
                   (action == "hilo_lower" and new_card["val"] <= curr_val))

        step_mult = h_mult if action == "hilo_higher" else l_mult
        if success:
            g["multiplier"] = round(g["multiplier"] * step_mult, 2)

        g["history"].append({
            "action": action,
            "prev_card": f"{curr_card['name']} {curr_card['suit']}",
            "new_card": f"{new_card['name']} {new_card['suit']}",
            "multiplier": g["multiplier"],
            "success": success,
        })

        log_game_event(
            user_id=user_id,
            game_type="hilo",
            game_id=game_id,
            action=action,
            callback_data=callback.data,
            details=f"prev={curr_card['name']} new={new_card['name']} success={success} mult=x{g['multiplier']:.2f}",
        )

        g["card"] = new_card

        if not success:
            hilo_games.pop(user_id, None)
            new_bal = get_balance(user_id)

            game_session_end(
                game_id,
                result="lose",
                win_amount=0,
                final_state={
                    "last_card": f"{new_card['name']} {new_card['suit']}",
                    "multiplier": g["multiplier"],
                    "bet": g["bet"],
                    "status": "lose",
                    "lost_bet": g["bet"],
                    "history": g["history"],
                }
            )
            log_game_history("hilo", user_id, g["bet"], "lose", 0, "completed",
                             f"Hilo #{game_id} wrong guess", game_id=game_id)

            try:
                text = (
                    f"╭━━━━━━━━━━━━━━╮\n"
                    f" 📈 ХИЛО #{g['game_id']} ПРОИГРЫШ\n"
                    f"╰━━━━━━━━━━━━━━╯\n\n"
                    f"💥 Выпала карта: <code>{new_card['name']} {new_card['suit']}</code>\n"
                    f"💸 Потеряно: <code>{_fmt(g['bet'])} UP</code>\n"
                    f"💵 Баланс: <code>{_fmt(new_bal)} UP</code>"
                )
                await callback.message.edit_text(text, parse_mode="HTML", reply_markup=None)
            except Exception:
                pass
            await callback.answer("❌ Неверный выбор! Раунд проигран.", show_alert=True)
        else:
            game_session_update(game_id, {
                "last_card": f"{new_card['name']} {new_card['suit']}",
                "last_card_val": new_card["val"],
                "multiplier": g["multiplier"],
                "bet": g["bet"],
                "status": "playing",
                "history": g["history"],
            })
            await render_hilo_board(callback, user_id, edit=True)
            await callback.answer("✅ Отлично! Прогноз верный.")
    except Exception as e:
        logger.exception("cb_hilo_actions failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


@router.callback_query(F.data == "hilo_none")
async def cb_hilo_none(callback: types.CallbackQuery):
    try:
        await callback.answer("⚠️ Выбор недоступен для текущего номинала карты!", show_alert=True)
    except Exception:
        pass
# ================== ОХОТА ==================
@router.message(F.text.in_({"Охота", "🏹 Охота", "🏹Охота"}))
async def menu_hunt(message: types.Message):
    try:
        if await _not_registered(message):
            return

        try:
            log_action(
                user_id=message.from_user.id,
                username=message.from_user.username,
                display_name=message.from_user.full_name,
                action_type="MESSAGE",
                command=message.text,
                message_text=message.text,
                game_type="hunt",
            )
        except Exception:
            pass

        await message.answer("🎯 Модуль <b>UPGRADE ОХОТА</b>. Укажите ставку:",
                             parse_mode="HTML", reply_markup=get_game_bet_keyboard("hunt"))
    except Exception as e:
        logger.exception("menu_hunt failed: %s", e)


async def start_hunt(message: types.Message, user_id: int, bet: int):
    try:
        ok, err = _validate_bet(bet)
        if not ok:
            await message.answer(err)
            return

        if user_id in hunt_games:
            await message.answer("⚠️ У вас уже есть активная охота!")
            return

        if not try_bet(user_id, bet):
            await message.answer("❌ Недостаточно средств!")
            return

        game_id = get_next_global_game_id()
        hunt_games[user_id] = {"game_id": game_id, "bet": bet, "active": True}

        log_game_event(
            user_id=user_id,
            game_type="hunt",
            game_id=game_id,
            action="start",
            balance_change=-bet,
            details=f"bet={bet}",
        )
        game_session_start(
            game_id=game_id,
            game_type="hunt",
            user_id=user_id,
            bet=bet,
            initial_state={
                "bet": bet,
                "status": "waiting_sector",
            }
        )

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[
                types.InlineKeyboardButton(text=f"🛰 Сектор {i}", callback_data=f"hunt_shot_{i}")
                for i in range(1, 6)
            ]]
        )
        text = (
            f"╭━━━━━━━━━━━━━━╮\n"
            f"     🎯 ОХОТА #{game_id}\n"
            f"╰━━━━━━━━━━━━━━╯\n\n"
            f"💰 <b>Ставка:</b> <code>{_fmt(bet)} UP</code>\n\n"
            f"> 🎯 Выберите один из 5 секторов для точечного залпа:"
        )
        if isinstance(message, types.CallbackQuery):
            await message.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        else:
            await message.answer(text, parse_mode="HTML", reply_markup=kb)
    except Exception as e:
        logger.exception("start_hunt failed for %s: %s", user_id, e)
        try:
            await message.answer("⚠️ Ошибка запуска охоты.")
        except Exception:
            pass


@router.callback_query(F.data.startswith("hunt_shot_"))
async def cb_hunt_shot(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return
        if user_id not in hunt_games or not hunt_games[user_id]["active"]:
            await callback.answer("❌ Сессия охоты завершена.", show_alert=True)
            return

        g = hunt_games.pop(user_id, None)
        if not g:
            await callback.answer("❌ Игра не найдена.", show_alert=True)
            return

        bet = g["bet"]
        game_id = g["game_id"]

        try:
            sector = int((callback.data or "").split("_")[2])
        except (IndexError, ValueError):
            sector = 0

        # === ПРОМАХ ===
        if not (random.random() < 0.40):
            new_bal = get_balance(user_id)

            log_game_event(
                user_id=user_id,
                game_type="hunt",
                game_id=game_id,
                action="miss",
                callback_data=callback.data,
                details=f"sector={sector} lost_bet={bet}",
            )
            game_session_end(
                game_id,
                result="miss",
                win_amount=0,
                final_state={
                    "sector": sector,
                    "bet": bet,
                    "status": "miss",
                    "lost_bet": bet,
                }
            )
            log_game_history("hunt", user_id, bet, "lose", 0, "completed",
                             f"Hunt #{game_id} missed target (sector {sector})", game_id=game_id)

            text = (
                f"╭━━━━━━━━━━━━━━╮\n"
                f" 🎯 ОХОТА #{game_id} ПРОИГРЫШ\n"
                f"╰━━━━━━━━━━━━━━╯\n\n"
                f"💨 Цель ушла в стелс... Промах (сектор {sector}).\n"
                f"💸 Потеряно: <code>{_fmt(bet)} UP</code>\n"
                f"💵 Баланс: <code>{_fmt(new_bal)} UP</code>"
            )
            try:
                await callback.message.edit_text(text, parse_mode="HTML", reply_markup=None)
            except Exception:
                pass
            await callback.answer("💨 Мимо цели!", show_alert=True)
            return

        # === ПОПАДАНИЕ ===
        rand_tier = random.random()
        if rand_tier < 0.60:
            drone_name, mult = "Обычный дрон", 1.5
        elif rand_tier < 0.90:
            drone_name, mult = "Редкий Квантовый Дрон", 3.5
        elif rand_tier < 0.98:
            drone_name, mult = "Элитный Боевой Дрон", 5.0
        else:
            drone_name, mult = "Легендарный Флагман", 10.0

        win_amt = int(bet * mult)
        update_balance(user_id, win_amt)
        new_bal = get_balance(user_id)

        log_game_event(
            user_id=user_id,
            game_type="hunt",
            game_id=game_id,
            action="hit",
            callback_data=callback.data,
            balance_change=win_amt,
            details=f"sector={sector} drone={drone_name} mult=x{mult} win={win_amt}",
        )
        game_session_end(
            game_id,
            result="win",
            win_amount=win_amt,
            final_state={
                "sector": sector,
                "bet": bet,
                "drone": drone_name,
                "multiplier": mult,
                "win_amount": win_amt,
                "status": "win",
            }
        )
        log_game_history("hunt", user_id, bet, "win", win_amt, "completed",
                         f"Hunt #{game_id} hit {drone_name} (x{mult})", game_id=game_id)

        text = (
            f"╭━━━━━━━━━━━━━━╮\n"
            f" 🎯 ОХОТА #{game_id} ПОБЕДА\n"
            f"╰━━━━━━━━━━━━━━╯\n\n"
            f"🛸 <b>Цель:</b> <code>{drone_name}</code>\n"
            f"📈 <b>Множитель:</b> <code>x{mult}</code>\n"
            f"🎁 <b>Выигрыш:</b> <b>+{_fmt(win_amt)} UP</b>\n"
            f"💵 <b>Баланс:</b> <code>{_fmt(new_bal)} UP</code>"
        )
        try:
            await callback.message.edit_text(text, parse_mode="HTML", reply_markup=None)
        except Exception:
            pass
        await callback.answer("🎯 Успешный перехват!", show_alert=True)
    except Exception as e:
        logger.exception("cb_hunt_shot failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass


# ================== ТРЕЙД ==================
@router.message(F.text.in_({"Трейд", "📊 Трейд", "📊Трейд"}))
async def menu_trade(message: types.Message):
    try:
        if await _not_registered(message):
            return

        try:
            log_action(
                user_id=message.from_user.id,
                username=message.from_user.username,
                display_name=message.from_user.full_name,
                action_type="MESSAGE",
                command=message.text,
                message_text=message.text,
                game_type="trade",
            )
        except Exception:
            pass

        await message.answer("💼 Модуль <b>UPGRADE ТРЕЙДИНГ</b>. Укажите инвестицию:",
                             parse_mode="HTML", reply_markup=get_game_bet_keyboard("trade"))
    except Exception as e:
        logger.exception("menu_trade failed: %s", e)


async def start_trade(message: types.Message, user_id: int, bet: int):
    try:
        ok, err = _validate_bet(bet)
        if not ok:
            await message.answer(err)
            return

        if user_id in trade_games:
            await message.answer("⚠️ У вас уже есть активная сделка!")
            return

        if not try_bet(user_id, bet):
            await message.answer("❌ Недостаточно средств!")
            return

        game_id = get_next_global_game_id()
        trade_games[user_id] = {"game_id": game_id, "bet": bet, "active": True}

        log_game_event(
            user_id=user_id,
            game_type="trade",
            game_id=game_id,
            action="start",
            balance_change=-bet,
            details=f"bet={bet}",
        )
        game_session_start(
            game_id=game_id,
            game_type="trade",
            user_id=user_id,
            bet=bet,
            initial_state={
                "bet": bet,
                "status": "choosing_asset",
            }
        )

        kb = types.InlineKeyboardMarkup(
            inline_keyboard=[[
                types.InlineKeyboardButton(text="🟢 DUROV", callback_data="trade_durov"),
                types.InlineKeyboardButton(text="🔵 TON-X", callback_data="trade_tonx"),
                types.InlineKeyboardButton(text="🔴 MEME", callback_data="trade_meme")
            ]]
        )
        text = (
            f"╭━━━━━━━━━━━━━━╮\n"
            f"     💼 ТРЕЙД #{game_id}\n"
            f"╰━━━━━━━━━━━━━━╯\n\n"
            f"💰 <b>Инвестиция:</b> <code>{_fmt(bet)} UP</code>\n\n"
            f"1️⃣ 🟢 <b>DUROV-Coin</b> [x1.8]\n"
            f"2️⃣ 🔵 <b>TON-X</b> [x3.0]\n"
            f"3️⃣ 🔴 <b>MEME-Pump</b> [x10.0]\n\n"
            f"> 📉 Выберите актив:"
        )
        if isinstance(message, types.CallbackQuery):
            await message.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
        else:
            await message.answer(text, parse_mode="HTML", reply_markup=kb)
    except Exception as e:
        logger.exception("start_trade failed for %s: %s", user_id, e)
        try:
            await message.answer("⚠️ Ошибка запуска сделки.")
        except Exception:
            pass


@router.callback_query(F.data.startswith("trade_"))
async def cb_trade_choice(callback: types.CallbackQuery):
    try:
        user_id = callback.from_user.id if callback.from_user else None
        if not user_id:
            return
        if not check_user_registered(user_id):
            await callback.answer("❌ Вы не зарегистрированы!", show_alert=True)
            return
        if user_id not in trade_games or not trade_games[user_id]["active"]:
            await callback.answer("❌ Ордер уже закрыт.", show_alert=True)
            return

        g = trade_games.pop(user_id, None)
        if not g:
            await callback.answer("❌ Игра не найдена.", show_alert=True)
            return

        bet = g["bet"]
        game_id = g["game_id"]

        parts = (callback.data or "").split("_")
        if len(parts) < 2:
            await callback.answer()
            return
        choice = parts[1]

        try:
            await callback.message.edit_text(
                f"╭━━━━━━━━━━━━━━╮\n     💼 ТРЕЙД #{game_id}\n╰━━━━━━━━━━━━━━╯\n\n⏳ <b>Анализ стакана котировок... Свеча закрывается!</b> 📊",
                parse_mode="HTML", reply_markup=None
            )
        except Exception:
            pass
        await asyncio.sleep(2)

        win, mult, coin = False, 1.0, ""
        if choice == "durov":
            coin, win = "🟢 DUROV-Coin", random.random() < 0.70
            if win:
                mult = round(random.uniform(1.1, 1.8), 2)
        elif choice == "tonx":
            coin, win = "🔵 TON-X", random.random() < 0.45
            if win:
                mult = round(random.uniform(1.5, 3.0), 2)
        elif choice == "meme":
            coin, win = "🔴 MEME-Pump", random.random() < 0.15
            if win:
                mult = round(random.uniform(4.0, 10.0), 2)
        else:
            await callback.answer("❌ Неизвестный актив.", show_alert=True)
            return

        if win:
            win_amt = int(bet * mult)
            update_balance(user_id, win_amt)
            new_bal = get_balance(user_id)

            log_game_event(
                user_id=user_id,
                game_type="trade",
                game_id=game_id,
                action="win",
                callback_data=callback.data,
                balance_change=win_amt,
                details=f"coin={coin} mult=x{mult} win={win_amt}",
            )
            game_session_end(
                game_id,
                result="win",
                win_amount=win_amt,
                final_state={
                    "coin": coin,
                    "multiplier": mult,
                    "bet": bet,
                    "win_amount": win_amt,
                    "status": "win",
                }
            )
            log_game_history("trade", user_id, bet, "win", win_amt, "completed",
                             f"Trade #{game_id} {coin} (x{mult})", game_id=game_id)

            text = (
                f"╭━━━━━━━━━━━━━━╮\n"
                f" 💼 ТРЕЙД #{game_id} ПОБЕДА\n"
                f"╰━━━━━━━━━━━━━━╯\n\n"
                f"🚀 <b>Актив:</b> <code>{coin}</code>\n"
                f"📈 <b>Рост курса:</b> <code>x{mult:.2f}</code>\n"
                f"🎁 <b>Выигрыш:</b> <b>+{_fmt(win_amt)} UP</b>\n"
                f"💵 <b>Баланс:</b> <code>{_fmt(new_bal)} UP</code>"
            )
        else:
            new_bal = get_balance(user_id)

            log_game_event(
                user_id=user_id,
                game_type="trade",
                game_id=game_id,
                action="lose",
                callback_data=callback.data,
                details=f"coin={coin} lost_bet={bet}",
            )
            game_session_end(
                game_id,
                result="lose",
                win_amount=0,
                final_state={
                    "coin": coin,
                    "bet": bet,
                    "status": "lose",
                    "lost_bet": bet,
                }
            )
            log_game_history("trade", user_id, bet, "lose", 0, "completed",
                             f"Trade #{game_id} liquidated on {coin}", game_id=game_id)

            text = (
                f"╭━━━━━━━━━━━━━━╮\n"
                f" 💼 ТРЕЙД #{game_id} ПРОИГРЫШ\n"
                f"╰━━━━━━━━━━━━━━╯\n\n"
                f"❌ <b>Актив:</b> <code>{coin}</code>\n"
                f"💸 Потеряно: <code>-{_fmt(bet)} UP</code>\n"
                f"💵 <b>Баланс:</b> <code>{_fmt(new_bal)} UP</code>"
            )

        try:
            await callback.message.answer(text, parse_mode="HTML")
        except Exception:
            pass
    except Exception as e:
        logger.exception("cb_trade_choice failed: %s", e)
    finally:
        try:
            await callback.answer()
        except Exception:
            pass
# ================== ОБРАБОТЧИК ВВОДА СТАВОК (FSM) ==================
@router.message(lambda msg: msg.from_user and msg.from_user.id in user_states)
async def process_user_state_input(message: types.Message):
    try:
        user_id = message.from_user.id
        if not user_id:
            return

        if not check_user_registered(user_id):
            user_states.pop(user_id, None)
            if message.chat.type == "private":
                await message.answer(
                    "❌ <b>Вы еще не зарегистрированы!</b>\n\n"
                    "💡 Пожалуйста, перейдите в <b>личные сообщения</b> бота и нажмите /start.",
                    parse_mode="HTML"
                )
            return

        text = (message.text or "").strip()
        if not text:
            return

        state_data = user_states.get(user_id)
        if not state_data:
            return
        step = state_data.get("step", "")

        # логируем ввод
        try:
            log_action(
                user_id=user_id,
                username=message.from_user.username,
                display_name=message.from_user.full_name,
                action_type="MESSAGE",
                message_text=text[:200],
                extra=f"state={step}",
            )
        except Exception:
            pass

        # --- Рулетка: приём ставок ---
        if step == "roulette_bet":
            parts = text.split(maxsplit=1)
            if len(parts) < 2:
                await message.answer("⚠️ Неверный формат! Пример: <code>30 красное</code> или <code>100 15</code>", parse_mode="HTML")
                return
            try:
                amt = int(parts[0])
                if amt < MIN_BET:
                    await message.answer(f"❌ Минимальная ставка: {MIN_BET} UP!")
                    return
                if amt > MAX_BET:
                    await message.answer("❌ Слишком большая ставка.")
                    return
            except ValueError:
                await message.answer("⚠️ Сумма ставки должна быть числом!")
                return

            balance = get_balance(user_id)
            current_bets = sum(b['amount'] for b in roulette_bets.get(user_id, []))
            if balance < (current_bets + amt):
                await message.answer(f"❌ Недостаточно средств! Баланс: {_fmt(balance)} UP.")
                return

            val = parts[1].lower()
            if val in ("красное", "черное", "зеленое"):
                b_type = "color"
            elif val in ("четное", "нечетное"):
                b_type = "parity"
            elif "-" in val:
                try:
                    low, high = map(int, val.split("-"))
                    if not (1 <= low <= 36 and 1 <= high <= 36 and low <= high):
                        raise ValueError()
                except ValueError:
                    await message.answer("⚠️ Диапазон должен быть от 1 до 36 (например: <code>1-15</code>)", parse_mode="HTML")
                    return
                b_type = "range"
            elif val.isdigit() and 1 <= int(val) <= 36:
                b_type = "exact"
            else:
                await message.answer("⚠️ Неверный тип ставки!", parse_mode="HTML")
                return

            roulette_bets.setdefault(user_id, [])
            roulette_bets[user_id].append({"amount": amt, "type": b_type, "val": parts[1]})

            try:
                log_action(
                    user_id=user_id,
                    username=message.from_user.username,
                    display_name=message.from_user.full_name,
                    action_type="GAME",
                    game_type="roulette",
                    extra=f"bet_added: {amt} on {parts[1]} ({b_type})",
                )
            except Exception:
                pass

            await send_roulette_message(message, user_id, get_balance(user_id), edit=False)
            return

        user_states.pop(user_id, None)

        # --- Флип: своя ставка ---
        if step == "flip_custom":
            try:
                bet = int(text)
            except ValueError:
                await message.answer("⚠️ Введите числовое значение ставки!")
                return
            await _start_flip_game(message, user_id, bet)
            return

        # --- Кубик: цель после своей ставки ---
        if step == "dice_target_custom":
            bet = state_data.get("bet", MIN_BET)
            try:
                target_num = int(text)
                if not (1 <= target_num <= 6):
                    await message.answer("⚠️ Число должно быть в диапазоне от 1 до 6!")
                    return
            except ValueError:
                await message.answer("⚠️ Введите цифру от 1 до 6!")
                return
            await execute_dice_game_process(message, user_id, bet, target_num)
            return

        # --- Универсальные "*_custom" ставки ---
        if step.endswith("_custom"):
            try:
                bet = int(text)
            except ValueError:
                await message.answer("⚠️ Введите числовое значение ставки!")
                return

            ok, err = _validate_bet(bet)
            if not ok:
                await message.answer(err)
                return

            base_game = step.replace("_custom", "")
            if base_game == "bj":
                await start_blackjack(message, user_id, bet)
            elif base_game == "mines":
                await start_mines(message, user_id, bet)
            elif base_game == "hilo":
                await start_hilo(message, user_id, bet)
            elif base_game == "hunt":
                await start_hunt(message, user_id, bet)
            elif base_game == "trade":
                await start_trade(message, user_id, bet)
            elif base_game in ("basket", "football", "bowling", "darts", "slots"):
                await execute_game_process(message, user_id, base_game, bet)
            elif base_game == "dice":
                user_states[user_id] = {"step": "dice_target_custom", "bet": bet}
                await message.answer("🎲 <b>Введите число от 1 до 6 для броска:</b>", parse_mode="HTML")
            return
    except Exception as e:
        logger.exception("process_user_state_input failed: %s", e)


# ================== ТЕКСТОВЫЕ КОМАНДЫ ==================
@router.message(F.text.lower().startswith(("бд ", "мины ", "хило ", "охота ", "трейд ")))
async def text_direct_game_bet(message: types.Message):
    try:
        if await _not_registered(message):
            return
        user_id = message.from_user.id
        parts = (message.text or "").split()
        cmd = parts[0].lower()
        if len(parts) < 2:
            await message.answer(f"⚠️ Неверный формат! Пример: <code>{parts[0]} 1000</code>", parse_mode="HTML")
            return
        try:
            bet = int(parts[1])
        except ValueError:
            await message.answer(f"⚠️ Неверный формат! Пример: <code>{parts[0]} 1000</code>", parse_mode="HTML")
            return

        try:
            log_action(
                user_id=user_id,
                username=message.from_user.username,
                display_name=message.from_user.full_name,
                action_type="MESSAGE",
                message_text=message.text[:200],
                extra=f"text_game_bet:{cmd}",
            )
        except Exception:
            pass

        if cmd == "бд":
            await start_blackjack(message, user_id, bet)
        elif cmd == "мины":
            await start_mines(message, user_id, bet)
        elif cmd == "хило":
            await start_hilo(message, user_id, bet)
        elif cmd == "охота":
            await start_hunt(message, user_id, bet)
        elif cmd == "трейд":
            await start_trade(message, user_id, bet)
    except Exception as e:
        logger.exception("text_direct_game_bet failed: %s", e)


@router.message(F.text.lower().startswith(("баскетбол ", "футбол ", "дартс ", "боулинг ", "слоты ")))
async def text_game_bet(message: types.Message):
    try:
        if await _not_registered(message):
            return
        user_id = message.from_user.id
        parts = (message.text or "").split()
        game_map = {"баскетбол": "basket", "футбол": "football", "дартс": "darts",
                    "боулинг": "bowling", "слоты": "slots"}
        if len(parts) < 2:
            await message.answer(f"⚠️ Неверный формат! Пример: <code>{parts[0]} 1000</code>", parse_mode="HTML")
            return
        try:
            bet = int(parts[1])
        except ValueError:
            await message.answer(f"⚠️ Неверный формат! Пример: <code>{parts[0]} 1000</code>", parse_mode="HTML")
            return
        await execute_game_process(message, user_id, game_map[parts[0].lower()], bet)
    except Exception as e:
        logger.exception("text_game_bet failed: %s", e)


@router.message(F.text.lower().startswith("кубик "))
async def text_dice_bet(message: types.Message):
    try:
        if await _not_registered(message):
            return
        user_id = message.from_user.id
        parts = (message.text or "").split()
        if len(parts) < 3:
            await message.answer("⚠️ Неверный формат! Пример: <code>Кубик 5 1000</code>", parse_mode="HTML")
            return
        try:
            target_num, bet = int(parts[1]), int(parts[2])
        except ValueError:
            await message.answer("⚠️ Неверный формат! Пример: <code>Кубик 5 1000</code>", parse_mode="HTML")
            return
        if not (1 <= target_num <= 6):
            await message.answer("⚠️ Число для кубика должно быть от 1 до 6!")
            return
        ok, err = _validate_bet(bet)
        if not ok:
            await message.answer(err)
            return
        await execute_dice_game_process(message, user_id, bet, target_num)
    except Exception as e:
        logger.exception("text_dice_bet failed: %s", e)


# ================== ВЫПОЛНЕНИЕ ИГР ==================
async def execute_game_process(message: types.Message, user_id: int, game: str, bet: int):
    try:
        ok, err = _validate_bet(bet)
        if not ok:
            await message.answer(err)
            return

        if not try_bet(user_id, bet):
            await message.answer("❌ Недостаточно средств на балансе!")
            return

        game_id = get_next_global_game_id()
        nickname = _esc(get_user_nickname(user_id))

        emoji_map = {"basket": "🏀", "football": "⚽", "darts": "🎯", "bowling": "🎳", "slots": "🎰"}
        titles = {"basket": "БАСКЕТБОЛ", "football": "ФУТБОЛ", "darts": "ДАРТС",
                  "bowling": "БОУЛИНГ", "slots": "СЛОТЫ"}

        log_game_event(
            user_id=user_id,
            game_type=game,
            game_id=game_id,
            action="start",
            balance_change=-bet,
            details=f"bet={bet}",
        )
        game_session_start(
            game_id=game_id,
            game_type=game,
            user_id=user_id,
            bet=bet,
            initial_state={"bet": bet, "status": "rolling"},
        )

        try:
            msg = await message.answer_dice(emoji=emoji_map.get(game, "🎲"))
            val = msg.dice.value
        except Exception as e:
            logger.exception("answer_dice failed: %s", e)
            update_balance(user_id, bet)
            log_game_event(
                user_id=user_id,
                game_type=game,
                game_id=game_id,
                action="refund",
                balance_change=bet,
                details="dice_error",
            )
            await message.answer("⚠️ Не удалось бросить кубик. Ставка возвращена.")
            return

        await asyncio.sleep(3)

        won, multiplier = False, 2
        if game in ("basket", "football"):
            won = val >= 4
        elif game in ("darts", "bowling"):
            won, multiplier = (val == 6), 3
        elif game == "slots":
            won, multiplier = (val in [1, 22, 43, 64]), 4

        if won:
            win_amt = bet * multiplier
            new_bal = update_balance(user_id, win_amt) or 0

            log_game_event(
                user_id=user_id,
                game_type=game,
                game_id=game_id,
                action="win",
                balance_change=win_amt,
                details=f"dice_value={val} mult=x{multiplier} win={win_amt}",
            )
            game_session_end(
                game_id,
                result="win",
                win_amount=win_amt,
                final_state={
                    "dice_value": val,
                    "multiplier": multiplier,
                    "bet": bet,
                    "win_amount": win_amt,
                    "status": "win",
                }
            )
            log_game_history(game, user_id, bet, "win", win_amt, "completed",
                             f"Game #{game_id} dice value {val}", game_id=game_id)

            result_text = (
                f"╭━━━━━━━━━━━━━━╮\n"
                f" 🏆 {titles.get(game, 'ИГРА')} #{game_id} ПОБЕДА\n"
                f"╰━━━━━━━━━━━━━━╯\n\n"
                f"👤 Игрок: <a href='tg://user?id={user_id}'>{nickname}</a>\n"
                f"💰 Ставка: {_fmt(bet)} UP\n"
                f"📈 Множитель: x{multiplier}\n"
                f"🎁 Выигрыш: <b>+{_fmt(win_amt)} UP</b>\n"
                f"💵 Баланс: <code>{_fmt(new_bal)} UP</code>"
            )
        else:
            new_bal = get_balance(user_id)

            log_game_event(
                user_id=user_id,
                game_type=game,
                game_id=game_id,
                action="lose",
                details=f"dice_value={val} lost_bet={bet}",
            )
            game_session_end(
                game_id,
                result="lose",
                win_amount=0,
                final_state={
                    "dice_value": val,
                    "bet": bet,
                    "status": "lose",
                    "lost_bet": bet,
                }
            )
            log_game_history(game, user_id, bet, "lose", 0, "completed",
                             f"Game #{game_id} dice value {val}", game_id=game_id)

            result_text = (
                f"╭━━━━━━━━━━━━━━╮\n"
                f" 💀 {titles.get(game, 'ИГРА')} #{game_id} ПРОИГРЫШ\n"
                f"╰━━━━━━━━━━━━━━╯\n\n"
                f"👤 Игрок: <a href='tg://user?id={user_id}'>{nickname}</a>\n"
                f"🎲 Выпало: <code>{val}</code>\n"
                f"💸 Потеряно: <b>{_fmt(bet)} UP</b>\n"
                f"💵 Баланс: <code>{_fmt(new_bal)} UP</code>"
            )

        await message.answer(result_text, parse_mode="HTML")
    except Exception as e:
        logger.exception("execute_game_process failed: %s", e)


async def execute_dice_game_process(message: types.Message, user_id: int, bet: int, target_num: int):
    try:
        ok, err = _validate_bet(bet)
        if not ok:
            await message.answer(err)
            return
        if not (1 <= target_num <= 6):
            await message.answer("⚠️ Число должно быть от 1 до 6!")
            return

        if not try_bet(user_id, bet):
            await message.answer("❌ Недостаточно средств на балансе!")
            return

        game_id = get_next_global_game_id()
        nickname = _esc(get_user_nickname(user_id))

        log_game_event(
            user_id=user_id,
            game_type="dice",
            game_id=game_id,
            action="start",
            balance_change=-bet,
            details=f"bet={bet} target={target_num}",
        )
        game_session_start(
            game_id=game_id,
            game_type="dice",
            user_id=user_id,
            bet=bet,
            initial_state={
                "bet": bet,
                "target": target_num,
                "status": "rolling",
            }
        )

        try:
            msg = await message.answer_dice(emoji="🎲")
            val = msg.dice.value
        except Exception as e:
            logger.exception("answer_dice failed: %s", e)
            update_balance(user_id, bet)
            log_game_event(
                user_id=user_id,
                game_type="dice",
                game_id=game_id,
                action="refund",
                balance_change=bet,
                details="dice_error",
            )
            await message.answer("⚠️ Не удалось бросить кубик. Ставка возвращена.")
            return

        await asyncio.sleep(3)

        if val == target_num:
            win_amt = bet * 5
            new_bal = update_balance(user_id, win_amt) or 0

            log_game_event(
                user_id=user_id,
                game_type="dice",
                game_id=game_id,
                action="win",
                balance_change=win_amt,
                details=f"target={target_num} rolled={val} win={win_amt}",
            )
            game_session_end(
                game_id,
                result="win",
                win_amount=win_amt,
                final_state={
                    "target": target_num,
                    "rolled": val,
                    "bet": bet,
                    "win_amount": win_amt,
                    "status": "win",
                }
            )
            log_game_history("dice", user_id, bet, "win", win_amt, "completed",
                             f"Dice #{game_id} target {target_num}, rolled {val}", game_id=game_id)

            result_text = (
                f"╭━━━━━━━━━━━━━━╮\n"
                f" 🏆 КУБИК #{game_id} ПОБЕДА\n"
                f"╰━━━━━━━━━━━━━━╯\n\n"
                f"🎲 Выпало: <code>{val}</code> (цель: {target_num})\n"
                f"🎁 Выигрыш: <b>+{_fmt(win_amt)} UP</b> (x5)\n"
                f"💵 Баланс: <code>{_fmt(new_bal)} UP</code>"
            )
        else:
            new_bal = get_balance(user_id)

            log_game_event(
                user_id=user_id,
                game_type="dice",
                game_id=game_id,
                action="lose",
                details=f"target={target_num} rolled={val} lost_bet={bet}",
            )
            game_session_end(
                game_id,
                result="lose",
                win_amount=0,
                final_state={
                    "target": target_num,
                    "rolled": val,
                    "bet": bet,
                    "status": "lose",
                    "lost_bet": bet,
                }
            )
            log_game_history("dice", user_id, bet, "lose", 0, "completed",
                             f"Dice #{game_id} target {target_num}, rolled {val}", game_id=game_id)

            result_text = (
                f"╭━━━━━━━━━━━━━━╮\n"
                f" 💀 КУБИК #{game_id} ПРОИГРЫШ\n"
                f"╰━━━━━━━━━━━━━━╯\n\n"
                f"🎲 Выпало: <code>{val}</code> (цель: {target_num})\n"
                f"💸 Потеряно: <b>{_fmt(bet)} UP</b>\n"
                f"💵 Баланс: <code>{_fmt(new_bal)} UP</code>"
            )

        await message.answer(result_text, parse_mode="HTML")
    except Exception as e:
        logger.exception("execute_dice_game_process failed: %s", e)