#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
main.py — сервер + Telegram-бот + БД мессенджера (Secure v5).

Запуск:
    pip install -r requirements.txt
    BOT_TOKEN=xxxx ADMIN_TG_ID=123 BOT_APP_LINK=https://t.me/your_bot/app python main.py

Переменные окружения:
    BOT_TOKEN        (обязательно) токен бота из @BotFather
    ADMIN_TG_ID      Telegram ID администратора (необязательно). Админ может начислять себе звёзды/Premium для проверки
    ADMIN_NUMBER     особый номер администратора (по умолчанию +88888888888)
    WEB_URL          адрес фронтенда (по умолчанию https://fliky-ai.github.io/)
    BOT_APP_LINK     прямая ссылка Mini App https://t.me/<bot>/<app> (скрывает WEB_URL в кнопке бота)
    CORS_ORIGINS     разрешённые origin через запятую (по умолчанию origin из WEB_URL)
    TRUST_PROXY      1 — доверять X-Forwarded-For (ставь 1, если сервер стоит за прокси хостинга:
                     иначе у всех пользователей будет один и тот же IP и общий лимит запросов)
    PROXY_HOPS       сколько прокси стоит перед сервером (по умолчанию 1; нужно только при TRUST_PROXY=1)
    WS_LEGACY_TOKEN  1 — разрешить старый вход по ?token= в WebSocket (по умолчанию 0:
                     новый фронт шлёт токен первым сообщением, а не в адресе)
    SECRET_KEY       ключ Fernet (иначе берётся/создаётся secret.key)
    MAX_UPLOAD_MB    максимальный размер файла в мегабайтах (по умолчанию 50)
    GIPHY_KEY        ключ api.giphy.com — включает поиск GIF в панели стикеров (без него есть «Мои GIF»)
    HOST, PORT       адрес и порт сервера
"""
import os, re, sys, json, time, hmac, hashlib, base64, secrets, sqlite3, threading, ipaddress
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlparse
import requests
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, utils as ec_utils, padding as rsa_padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
from flask_sock import Sock
from werkzeug.exceptions import HTTPException


# ───────────────────────── НАСТРОЙКИ ─────────────────────────
def env_int(name, default=0):
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


BOT_TOKEN = os.environ.get("8878544024:AAFzlAgJ5typSAFyo-FLKQ8VZBG4HLiLRA4", "8878544024:AAFzlAgJ5typSAFyo-FLKQ8VZBG4HLiLRA4").strip()
if not BOT_TOKEN:
    sys.exit("BOT_TOKEN не задан. Запуск: BOT_TOKEN=xxxx python main.py")

WEB_URL = os.environ.get("WEB_URL", "https://fliky-ai.github.io/")
BOT_APP_LINK = os.environ.get("BOT_APP_LINK", "").strip()
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = env_int("PORT", 26033)
ADMIN_TG_ID = env_int("ADMIN_TG_ID")
ADMIN_NUMBER = os.environ.get("ADMIN_NUMBER", "+88888888888")
TRUST_PROXY = os.environ.get("TRUST_PROXY", "0") == "1"
PROXY_HOPS = max(1, env_int("PROXY_HOPS", 1))
WS_LEGACY_TOKEN = os.environ.get("WS_LEGACY_TOKEN", "0") == "1"

_o = urlparse(WEB_URL)
CORS_ORIGINS = [x.strip() for x in os.environ.get("CORS_ORIGINS", f"{_o.scheme}://{_o.netloc}").split(",") if x.strip()]

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "messenger.db")
KEY_PATH = os.path.join(BASE, "secret.key")
AVATAR_DIR = os.path.join(BASE, "avatars")
UPLOAD_DIR = os.path.join(BASE, "uploads")
os.makedirs(AVATAR_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)
MAX_UPLOAD = max(1, env_int("MAX_UPLOAD_MB", 50)) * 1024 * 1024   # максимальный размер одного файла
GIPHY_KEY = os.environ.get("GIPHY_KEY", "").strip()                # ключ для поиска GIF (необязательно)

SYSTEM_ID = 1                        # официальный аккаунт "Dicegram" (служебные уведомления)
SYSTEM_NAME = "Dicegram"
CODE_TTL = 300                       # код живёт 5 минут
LOCK_SECONDS = 900                   # блокировка после перебора кода
SESSION_TTL = 30 * 86400             # сессия живёт 30 дней с последней активности
MAX_SESSIONS = 10                    # максимум устройств на аккаунт
MAX_WS_PER_USER = 5
PREMIUM_PRICE = {"year": 4990, "month": 500}      # цена Premium в звёздах
PREMIUM_DAYS = {"year": 365, "month": 30}
AUTO_DEL_MAX = 365 * 86400           # максимальный срок автоудаления сообщений
PREFS_MAX = 24_000                   # размер синхронизируемых настроек (папки, уведомления…)
CODE_LEN = {ADMIN_NUMBER: 6}         # у остальных код из 5 цифр
MAX_TRIES = {ADMIN_NUMBER: 3}        # у остальных 5 попыток
TG = f"https://api.telegram.org/bot{BOT_TOKEN}"


# ───────────────────── ШИФРОВАНИЕ (Fernet AES) ─────────────────────
def load_or_create_key():
    env = os.environ.get("SECRET_KEY")
    if env:
        return env.encode()
    if os.path.exists(KEY_PATH):
        with open(KEY_PATH, "rb") as f:
            return f.read().strip()
    key = Fernet.generate_key()
    fd = os.open(KEY_PATH, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(key)
    return key


_KEY = load_or_create_key()
cipher = Fernet(_KEY)
PEPPER = hashlib.sha256(b"codes:" + _KEY).digest()
SIGKEY = hashlib.sha256(b"files:" + _KEY).digest()


def encrypt_text(plain):
    # Без «тихого» отката в открытый текст: при ошибке сообщение не сохранится.
    return cipher.encrypt((plain or "").encode("utf-8")).decode("utf-8") if plain else ""


def decrypt_text(encrypted):
    if not encrypted:
        return ""
    try:
        return cipher.decrypt(encrypted.encode("utf-8")).decode("utf-8")
    except (InvalidToken, Exception):
        return encrypted  # старое сообщение, сохранённое без шифрования


def code_hash(num, code):
    return hmac.new(PEPPER, f"{num}:{code}".encode(), hashlib.sha256).hexdigest()


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


# ───────────────────────── FLASK ─────────────────────────
app = Flask(__name__)
BODY_MAX = 1024 * 1024                 # обычные запросы (JSON) — не больше 1 МБ
UPLOAD_BODY_MAX = 4 * 1024 * 1024 + 4096   # кусок файла — до 4 МБ (клиент растит размер куска сам, если связь быстрая)
app.config["MAX_CONTENT_LENGTH"] = UPLOAD_BODY_MAX
app.config["SOCK_SERVER_OPTIONS"] = {"ping_interval": 25}
CORS(app, resources={r"/*": {"origins": CORS_ORIGINS}}, max_age=86400)
sock = Sock(app)
http = requests.Session()
clients = {}                         # user_id -> set(ws)
ws_tok = {}                          # ws -> хэш токена сессии
_geo = {}
_rl = {}
_rl_lock = threading.Lock()


def hit(bucket, key, n, per):
    """Скользящее окно: True, если запрос разрешён."""
    now = time.time()
    k = (bucket, key)
    with _rl_lock:
        lst = [t for t in _rl.get(k, []) if now - t < per]
        if len(lst) >= n:
            _rl[k] = lst
            return False
        lst.append(now)
        _rl[k] = lst
        return True


# ───────────────────────── БАЗА (одно соединение, WAL) ─────────────────────────
_db = None
db_lock = threading.RLock()


def init_db():
    global _db
    _db = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
    _db.row_factory = sqlite3.Row
    _db.create_function("plower", 1, lambda s: (s or "").lower())
    _db.execute("PRAGMA journal_mode=WAL")
    _db.execute("PRAGMA synchronous=NORMAL")
    _db.executescript("""
    CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        number TEXT UNIQUE NOT NULL,
        tg_id INTEGER UNIQUE,
        name TEXT DEFAULT '',
        username TEXT DEFAULT '',
        bio TEXT DEFAULT '',
        avatar TEXT DEFAULT '',
        last_seen INTEGER DEFAULT 0,
        is_system INTEGER DEFAULT 0,
        created INTEGER);
    CREATE TABLE IF NOT EXISTS codes(
        number TEXT PRIMARY KEY, code_hash TEXT, expires INTEGER, tries INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions(
        token TEXT PRIMARY KEY, user_id INTEGER, ip TEXT, country TEXT,
        device TEXT, created INTEGER, last_used INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS locks(number TEXT PRIMARY KEY, until INTEGER);
    CREATE TABLE IF NOT EXISTS messages(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender INTEGER, receiver INTEGER, text TEXT, ts INTEGER, is_read INTEGER DEFAULT 0,
        cid TEXT);
    CREATE INDEX IF NOT EXISTS ix_msg ON messages(sender, receiver);
    CREATE INDEX IF NOT EXISTS ix_msg_recv ON messages(receiver, is_read);
    CREATE INDEX IF NOT EXISTS ix_msg_recv2 ON messages(receiver, sender);
    CREATE TABLE IF NOT EXISTS reacts(
        msg_id INTEGER, user_id INTEGER, emoji TEXT, ts INTEGER, PRIMARY KEY(msg_id, user_id));
    CREATE TABLE IF NOT EXISTS files(
        fid TEXT PRIMARY KEY, owner INTEGER, name TEXT, size INTEGER, mime TEXT,
        got INTEGER DEFAULT 0, done INTEGER DEFAULT 0, ts INTEGER);
    CREATE TABLE IF NOT EXISTS stickers(
        id INTEGER PRIMARY KEY AUTOINCREMENT, owner INTEGER, fid TEXT, kind TEXT, w INTEGER, h INTEGER,
        emoji TEXT DEFAULT '', mime TEXT DEFAULT '', ts INTEGER);
    CREATE INDEX IF NOT EXISTS ix_stk_owner ON stickers(owner, kind);
    CREATE TABLE IF NOT EXISTS stories(
        id INTEGER PRIMARY KEY AUTOINCREMENT, owner INTEGER, fid TEXT, tfid TEXT, kind TEXT,
        w INTEGER DEFAULT 0, h INTEGER DEFAULT 0, dur INTEGER DEFAULT 0, cap TEXT DEFAULT '',
        aud INTEGER DEFAULT 0, ts INTEGER, exp INTEGER);
    CREATE INDEX IF NOT EXISTS ix_story_owner ON stories(owner, ts);
    CREATE INDEX IF NOT EXISTS ix_story_fid ON stories(fid);
    CREATE TABLE IF NOT EXISTS story_views(
        story_id INTEGER, viewer INTEGER, ts INTEGER, PRIMARY KEY(story_id, viewer));
    CREATE TABLE IF NOT EXISTS tickets(
        id TEXT PRIMARY KEY, user_id INTEGER, expires INTEGER, tz INTEGER DEFAULT 0, device TEXT DEFAULT '', ip TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS star_tx(
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, title TEXT, kind TEXT, ts INTEGER);
    CREATE INDEX IF NOT EXISTS ix_star_user ON star_tx(user_id, id);
    CREATE TABLE IF NOT EXISTS support(
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, text TEXT, ts INTEGER);
    CREATE TABLE IF NOT EXISTS biz_links(
        slug TEXT PRIMARY KEY, owner INTEGER, title TEXT DEFAULT '', text TEXT DEFAULT '', uses INTEGER DEFAULT 0, ts INTEGER);
    CREATE INDEX IF NOT EXISTS ix_biz_owner ON biz_links(owner);
    CREATE TABLE IF NOT EXISTS biz_auto(
        owner INTEGER, peer INTEGER, kind TEXT, ts INTEGER, PRIMARY KEY(owner, peer, kind));
    CREATE TABLE IF NOT EXISTS emoji_sets(
        id INTEGER PRIMARY KEY AUTOINCREMENT, owner INTEGER, title TEXT DEFAULT '', ts INTEGER);
    CREATE INDEX IF NOT EXISTS ix_eset_owner ON emoji_sets(owner);
    CREATE TABLE IF NOT EXISTS emoji_items(
        id INTEGER PRIMARY KEY AUTOINCREMENT, set_id INTEGER, owner INTEGER, fid TEXT, mime TEXT DEFAULT '',
        emoji TEXT DEFAULT '', ts INTEGER);
    CREATE INDEX IF NOT EXISTS ix_eitem_set ON emoji_items(set_id, id);
    CREATE INDEX IF NOT EXISTS ix_eitem_fid ON emoji_items(fid);
    CREATE TABLE IF NOT EXISTS chats(
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, title TEXT DEFAULT '', about TEXT DEFAULT '', photo TEXT DEFAULT '',
        owner INTEGER, ts INTEGER, slug TEXT DEFAULT '', hist INTEGER DEFAULT 0, topics INTEGER DEFAULT 0,
        react_mode TEXT DEFAULT 'all', react_list TEXT DEFAULT '', greet TEXT DEFAULT '', greet_on INTEGER DEFAULT 0,
        perms TEXT DEFAULT '', slow INTEGER DEFAULT 0, auto_del INTEGER DEFAULT 0, sign INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS chat_members(
        chat_id INTEGER, user_id INTEGER, role TEXT DEFAULT 'member', rights TEXT DEFAULT '', tag TEXT DEFAULT '',
        joined INTEGER, last_read INTEGER DEFAULT 0, last_send INTEGER DEFAULT 0, adder INTEGER DEFAULT 0,
        restr TEXT DEFAULT '', until INTEGER DEFAULT 0, first_id INTEGER DEFAULT 0,
        PRIMARY KEY(chat_id, user_id));
    CREATE INDEX IF NOT EXISTS ix_cm_user ON chat_members(user_id);
    CREATE TABLE IF NOT EXISTS chat_bans(
        chat_id INTEGER, user_id INTEGER, ts INTEGER, adder INTEGER DEFAULT 0, PRIMARY KEY(chat_id, user_id));
    CREATE TABLE IF NOT EXISTS chat_links(
        slug TEXT PRIMARY KEY, chat_id INTEGER, creator INTEGER, title TEXT DEFAULT '', prim INTEGER DEFAULT 0,
        expires INTEGER DEFAULT 0, lim INTEGER DEFAULT 0, uses INTEGER DEFAULT 0, revoked INTEGER DEFAULT 0, ts INTEGER);
    CREATE INDEX IF NOT EXISTS ix_cl_chat ON chat_links(chat_id);
    CREATE TABLE IF NOT EXISTS chat_topics(
        id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER, title TEXT DEFAULT '', color INTEGER DEFAULT 0, emoji TEXT DEFAULT '',
        closed INTEGER DEFAULT 0, creator INTEGER, ts INTEGER);
    CREATE INDEX IF NOT EXISTS ix_ct_chat ON chat_topics(chat_id);
    CREATE TABLE IF NOT EXISTS blocks(blocker INTEGER, blocked INTEGER, ts INTEGER, PRIMARY KEY(blocker, blocked));
    CREATE INDEX IF NOT EXISTS ix_blocks_b ON blocks(blocked);
    CREATE TABLE IF NOT EXISTS saved_contacts(owner INTEGER, contact INTEGER, ts INTEGER, PRIMARY KEY(owner, contact));
    CREATE TABLE IF NOT EXISTS phone_shares(owner INTEGER, target INTEGER, ts INTEGER, PRIMARY KEY(owner, target));
    CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY AUTOINCREMENT, reporter INTEGER, kind TEXT, target INTEGER, reason TEXT, text TEXT DEFAULT '', ts INTEGER);
    CREATE TABLE IF NOT EXISTS gifts(
        id INTEGER PRIMARY KEY AUTOINCREMENT, from_id INTEGER, to_id INTEGER, key TEXT, coll TEXT DEFAULT '', model INTEGER DEFAULT 0,
        backdrop INTEGER DEFAULT 0, pattern INTEGER DEFAULT 0, num INTEGER DEFAULT 0, anon INTEGER DEFAULT 0, msg TEXT DEFAULT '',
        price INTEGER DEFAULT 0, ts INTEGER, shown INTEGER DEFAULT 1, pin INTEGER DEFAULT 0);
    CREATE INDEX IF NOT EXISTS ix_gifts_to ON gifts(to_id, id);
    CREATE INDEX IF NOT EXISTS ix_gifts_from ON gifts(from_id);
    CREATE TABLE IF NOT EXISTS coll_mint(coll TEXT PRIMARY KEY, minted INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS emoji_saved(user_id INTEGER, set_id INTEGER, ts INTEGER, PRIMARY KEY(user_id, set_id));
    CREATE TABLE IF NOT EXISTS chat_audit(
        id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER, actor INTEGER, target INTEGER DEFAULT 0,
        kind TEXT, data TEXT DEFAULT '', ts INTEGER);
    CREATE INDEX IF NOT EXISTS ix_audit_chat ON chat_audit(chat_id, id);
    CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS admin_log(
        id INTEGER PRIMARY KEY AUTOINCREMENT, actor INTEGER, kind TEXT, target INTEGER DEFAULT 0,
        data TEXT DEFAULT '', ts INTEGER);
    CREATE INDEX IF NOT EXISTS ix_admin_log ON admin_log(id);
    CREATE TABLE IF NOT EXISTS push_subs(
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, endpoint TEXT, p256dh TEXT, auth TEXT, ts INTEGER,
        UNIQUE(user_id, endpoint));
    CREATE INDEX IF NOT EXISTS ix_push_subs_user ON push_subs(user_id);
    CREATE TABLE IF NOT EXISTS game_scores(
        user_id INTEGER, game TEXT, day TEXT, score INTEGER DEFAULT 0, ts INTEGER,
        PRIMARY KEY(user_id, game, day));
    CREATE INDEX IF NOT EXISTS ix_game_board ON game_scores(game, day, score DESC);
    CREATE TABLE IF NOT EXISTS game_wallet(
        user_id INTEGER PRIMARY KEY, coins INTEGER DEFAULT 0, streak INTEGER DEFAULT 0,
        captcha TEXT DEFAULT '', captcha_ans INTEGER DEFAULT 0, captcha_at INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS fcm_tokens(
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, token TEXT UNIQUE, install TEXT DEFAULT '', ts INTEGER);
    CREATE INDEX IF NOT EXISTS ix_fcm_user ON fcm_tokens(user_id);
    """)
    # миграции для баз, созданных старыми версиями
    for table, col, ddl in (("users", "avatar", "TEXT DEFAULT ''"), ("users", "last_seen", "INTEGER DEFAULT 0"),
                            ("users", "surname", "TEXT DEFAULT ''"), ("users", "birthday", "TEXT DEFAULT ''"),
                            ("users", "birthday_vis", "TEXT DEFAULT 'contacts'"),
                            ("users", "cloud_hash", "TEXT DEFAULT ''"), ("users", "cloud_salt", "TEXT DEFAULT ''"),
                            ("users", "cloud_hint", "TEXT DEFAULT ''"), ("users", "login_email", "TEXT DEFAULT ''"),
                            ("users", "auto_del", "INTEGER DEFAULT 0"), ("users", "prefs", "TEXT DEFAULT ''"),
                            ("users", "priv", "TEXT DEFAULT ''"), ("users", "stars", "INTEGER DEFAULT 0"),
                            ("users", "premium_until", "INTEGER DEFAULT 0"), ("users", "biz", "TEXT DEFAULT ''"),
                            ("users", "estatus", "TEXT DEFAULT ''"), ("users", "nft", "INTEGER DEFAULT 0"), ("users", "pchan", "INTEGER DEFAULT 0"),
                            ("emoji_sets", "code", "TEXT DEFAULT ''"),
                            ("messages", "exp", "INTEGER DEFAULT 0"),
                            ("sessions", "last_used", "INTEGER DEFAULT 0"), ("messages", "cid", "TEXT"),
                            ("messages", "kind", "TEXT DEFAULT 'text'"), ("messages", "meta", "TEXT"),
                            ("messages", "reply_to", "INTEGER"), ("messages", "fid", "TEXT"), ("messages", "tfid", "TEXT"),
                            ("messages", "edited", "INTEGER DEFAULT 0"), ("messages", "pin", "INTEGER DEFAULT 0"),
                            ("messages", "del_s", "INTEGER DEFAULT 0"), ("messages", "del_r", "INTEGER DEFAULT 0"),
                            ("messages", "topic", "INTEGER DEFAULT 0"), ("messages", "only_u", "INTEGER DEFAULT 0"),
                            ("saved_contacts", "fname", "TEXT DEFAULT ''"), ("saved_contacts", "lname", "TEXT DEFAULT ''"),
                            ("chats", "disc_chat_id", "INTEGER DEFAULT 0"), ("gifts", "sold", "INTEGER DEFAULT 0"),
                            ("users", "vtier", "TEXT DEFAULT ''"), ("chats", "vtier", "TEXT DEFAULT ''"),
                            ("users", "uname_nft", "INTEGER DEFAULT 0"), ("users", "uname_ton", "INTEGER DEFAULT 0"),
                            ("game_wallet", "click_power", "INTEGER DEFAULT 0"), ("game_wallet", "passive_level", "INTEGER DEFAULT 0"),
                            ("game_wallet", "passive_ts", "INTEGER DEFAULT 0")):
        cols = {r["name"] for r in _db.execute(f"PRAGMA table_info({table})")}
        if col not in cols:
            _db.execute(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")
    try:
        pk = [r["name"] for r in _db.execute("PRAGMA table_info(reacts)") if r["pk"]]
        if pk == ["msg_id", "user_id"]:
            _db.executescript("""CREATE TABLE reacts_n(msg_id INTEGER, user_id INTEGER, emoji TEXT, ts INTEGER, PRIMARY KEY(msg_id, user_id, emoji));
                INSERT OR IGNORE INTO reacts_n SELECT msg_id, user_id, emoji, ts FROM reacts;
                DROP TABLE reacts; ALTER TABLE reacts_n RENAME TO reacts;""")
        _db.execute("CREATE INDEX IF NOT EXISTS ix_reacts_msg ON reacts(msg_id)")
    except sqlite3.Error as e:
        print("reacts migration:", e)
    try:
        for r in _db.execute("SELECT id FROM emoji_sets WHERE code='' OR code IS NULL").fetchall():
            _db.execute("UPDATE emoji_sets SET code=? WHERE id=?", (secrets.token_urlsafe(8).replace("-", "a").replace("_", "b")[:10], r["id"]))
        _db.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_eset_code ON emoji_sets(code) WHERE code != ''")
    except sqlite3.Error as e:
        print("emoji code:", e)
    try:
        _db.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_username ON users(username COLLATE NOCASE) WHERE username != ''")
    except sqlite3.Error as e:
        print("username index:", e)
    try:
        # защита от дублей при повторной отправке: одно и то же cid от одного отправителя сохраняется один раз
        _db.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_msg_cid ON messages(sender, cid) WHERE cid IS NOT NULL")
    except sqlite3.Error as e:
        print("cid index:", e)
    for ix in ("CREATE INDEX IF NOT EXISTS ix_msg_rid ON messages(receiver, id)",
               "CREATE UNIQUE INDEX IF NOT EXISTS ux_chat_slug ON chats(slug COLLATE NOCASE) WHERE slug != ''",
               "CREATE INDEX IF NOT EXISTS ix_msg_fid ON messages(fid)", "CREATE INDEX IF NOT EXISTS ix_msg_tfid ON messages(tfid)",
               "CREATE INDEX IF NOT EXISTS ix_msg_exp ON messages(exp) WHERE exp>0",
               "CREATE INDEX IF NOT EXISTS ix_msg_pin ON messages(sender, receiver, pin)"):
        try:
            _db.execute(ix)
        except sqlite3.Error as e:
            print("index:", e)
    _db.execute("INSERT OR IGNORE INTO users(id,number,name,is_system,created) VALUES(?,?,?,1,?)",
                (SYSTEM_ID, "+42777", SYSTEM_NAME, int(time.time())))
    _db.execute("UPDATE users SET name=? WHERE id=? AND name<>?", (SYSTEM_NAME, SYSTEM_ID, SYSTEM_NAME))


def run(sql, args=()):
    with db_lock:
        try:
            return _db.execute(sql, args)
        except Exception as e:
            print(f"DB Run Error [{sql[:60]}]:", e)
            raise


def q1(sql, args=()):
    with db_lock:
        try:
            r = _db.execute(sql, args).fetchone()
            return dict(r) if r else None
        except Exception as e:
            print(f"DB Q1 Error [{sql[:60]}]:", e)
            return None


def qa(sql, args=()):
    with db_lock:
        try:
            return [dict(r) for r in _db.execute(sql, args).fetchall()]
        except Exception as e:
            print(f"DB QA Error [{sql[:60]}]:", e)
            return []


# ───────────────────── НОМЕРА И КОДЫ ─────────────────────
def has_seq(d, k=4):
    for i in range(len(d) - k + 1):
        s = d[i:i + k]
        if all(int(s[j + 1]) - int(s[j]) == 1 for j in range(k - 1)) or \
           all(int(s[j]) - int(s[j + 1]) == 1 for j in range(k - 1)):
            return True
    return False


def is_vip(d):
    if re.search(r"(\d)\1{2,}", d) or len(set(d)) <= 4 or d.count("0") >= 3 or has_seq(d):
        return True
    return bool(re.search(r"(\d\d)\1", d) or re.search(r"(\d{3})\1", d) or d[:4] == d[4:][::-1])


def gen_number():
    while True:
        tail = "".join(str(secrets.randbelow(10)) for _ in range(8))
        if tail[0] == "0" or is_vip(tail):
            continue
        num = "+888" + tail
        if not q1("SELECT 1 FROM users WHERE number=?", (num,)):
            return num


def gen_code(n):
    while True:
        c = "".join(str(secrets.randbelow(10)) for _ in range(n))
        if len(set(c)) >= 4 and not re.search(r"(\d)\1\1", c) and not has_seq(c):
            return c


def norm(num):
    d = re.sub(r"\D", "", num or "")
    return "+" + d if d else ""


def locked(num):
    r = q1("SELECT until FROM locks WHERE number=?", (num,))
    return bool(r and r["until"] > time.time())


def lock_number(num):
    run("INSERT OR REPLACE INTO locks(number,until) VALUES(?,?)", (num, int(time.time()) + LOCK_SECONDS))


# ───────────────────── TELEGRAM BOT ─────────────────────
def tg(method, **data):
    try:
        res = http.post(f"{TG}/{method}", json=data, timeout=35)
        return res.json() if res.status_code == 200 else {}
    except Exception as e:
        # в тексте ошибки requests бывает URL с токеном — вычищаем
        print("tg error:", str(e).replace(BOT_TOKEN, "***"))
        return {}


def send_login_code(user, code):
    if not user.get("tg_id"):
        return False
    text = (f"Код для входа в Ваш аккаунт Dicegram: <code>{code}</code>. "
            "<b>Не давайте код никому, даже если его требуют от имени Dicegram!</b>\n\n"
            "❗️<i>Этот код используется для входа в Ваш аккаунт в Dicegram. "
            "Он не может быть использован для чего-либо ещё.</i>\n\n"
            "Если Вы не запрашивали код для входа в аккаунт на другом устройстве, "
            "проигнорируйте это сообщение.")
    r = tg("sendMessage", chat_id=user["tg_id"], text=text, parse_mode="HTML",
           disable_web_page_preview=True)
    return bool(r.get("ok"))


def alert_admin(text):
    if ADMIN_TG_ID:
        threading.Thread(target=lambda: tg("sendMessage", chat_id=ADMIN_TG_ID, text=text), daemon=True).start()


def open_keyboard():
    """Кнопка «Открыть». Если задан BOT_APP_LINK — это ссылка t.me/..., и реальный адрес сайта
    в сообщении не передаётся (его не увидят ни обычные, ни модифицированные клиенты)."""
    if BOT_APP_LINK:
        btn = {"text": "💬 Открыть мессенджер", "url": BOT_APP_LINK}
    else:
        btn = {"text": "💬 Открыть мессенджер", "web_app": {"url": WEB_URL}}
    return {"inline_keyboard": [[btn]]}


def get_or_create_user(frm):
    tid = frm["id"]
    name = (frm.get("first_name", "") or "").strip()[:64]
    surname = (frm.get("last_name", "") or "").strip()[:64]
    now = int(time.time())
    with db_lock:  # атомарно: два параллельных /start не создадут дубль
        user = q1("SELECT * FROM users WHERE tg_id=?", (tid,))
        if ADMIN_TG_ID and tid == ADMIN_TG_ID:
            if not user:
                other = q1("SELECT * FROM users WHERE number=?", (ADMIN_NUMBER,))
                if other and not other["tg_id"]:
                    run("UPDATE users SET tg_id=? WHERE id=?", (tid, other["id"]))
                elif not other:
                    run("INSERT INTO users(number,tg_id,name,surname,created) VALUES(?,?,?,?,?)", (ADMIN_NUMBER, tid, name, surname, now))
            elif user["number"] != ADMIN_NUMBER and not q1("SELECT 1 FROM users WHERE number=?", (ADMIN_NUMBER,)):
                run("UPDATE users SET number=? WHERE id=?", (ADMIN_NUMBER, user["id"]))
        elif not user:
            run("INSERT INTO users(number,tg_id,name,surname,created) VALUES(?,?,?,?,?)", (gen_number(), tid, name, surname, now))
        return q1("SELECT * FROM users WHERE tg_id=?", (tid,))


def handle_update(u):
    m = u.get("message")
    if not m or "text" not in m or m["chat"].get("type") != "private":
        return
    frm = m.get("from") or {}
    if frm.get("is_bot"):
        return
    text, chat_id = m["text"], m["chat"]["id"]
    cmd = text.split()[0].split("@")[0].lower() if text.strip() else ""
    if cmd == "/start":
        user = get_or_create_user(frm)
        if not user:
            return
        tg("sendMessage", chat_id=chat_id, parse_mode="HTML",
           text=f"👋 <b>Добро пожаловать!</b>\n\nВаш номер: <code>{user['number']}</code>\n\n"
                "Нажмите кнопку ниже, введите номер — код для входа придёт сюда.",
           reply_markup=open_keyboard())
    elif cmd == "/number":
        user = q1("SELECT number FROM users WHERE tg_id=?", (frm.get("id"),))
        tg("sendMessage", chat_id=chat_id,
           text=f"Ваш номер: {user['number']}" if user else "Сначала нажмите /start")


def bot_loop():
    tg("setMyCommands", commands=[{"command": "start", "description": "Получить номер и открыть мессенджер"},
                                  {"command": "number", "description": "Показать мой номер"}])
    # Кнопка меню — обычный список команд: адрес сайта в ней не передаётся.
    tg("setChatMenuButton", menu_button={"type": "commands"})
    offset = 0
    while True:
        try:
            r = tg("getUpdates", offset=offset, timeout=30, allowed_updates=["message"])
            for u in r.get("result", []):
                offset = u["update_id"] + 1
                try:
                    handle_update(u)
                except Exception as e:
                    print("update error:", e)
            if not r:
                time.sleep(2)
        except Exception as e:
            print("Bot loop error:", e)
            time.sleep(5)


# ───────────────────── АВТОРИЗАЦИЯ ЗАПРОСОВ ─────────────────────
def request_init():
    return request.headers.get("X-Init-Data") or request.args.get("init") or ""


def init_tid(raw):
    """('none') — вход с обычного сайта, ('ok', tg_id) — из Mini App, ('bad') — подделка."""
    if not raw:
        return "none", None
    try:
        pairs = dict(parse_qsl(raw, keep_blank_values=True))
        h = pairs.pop("hash", "")
        check = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
        secret = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
        calc = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(calc, h):
            return "bad", None
        if time.time() - int(pairs.get("auth_date", "0")) > 7 * 86400:
            return "bad", None
        return "ok", int(json.loads(pairs["user"])["id"])
    except Exception:
        return "bad", None


def get_token():
    return request.headers.get("Authorization", "").replace("Bearer ", "").strip()


def auth_from(token, raw_init):
    if not token:
        return None
    h = token_hash(token)
    s = q1("SELECT * FROM sessions WHERE token=?", (h,))
    if not s:
        return None
    now = int(time.time())
    last = s.get("last_used") or s["created"] or 0
    if now - last > SESSION_TTL:
        run("DELETE FROM sessions WHERE token=?", (h,))
        return None
    u = q1("SELECT * FROM users WHERE id=?", (s["user_id"],))
    if not u:
        return None
    st, tid = init_tid(raw_init)
    if st == "bad" or (st == "ok" and u["tg_id"] != tid):
        return None
    if now - last > 3600:
        run("UPDATE sessions SET last_used=? WHERE token=?", (now, h))
    return u


def auth_user():
    try:
        return auth_from(get_token(), request_init())
    except Exception:
        return None


def err(msg, code=400):
    return jsonify(ok=False, error=msg), code


@app.before_request
def limit_body():
    """Общий лимит запроса — 1 МБ; больше разрешён только куску файла (upload_chunk)."""
    n = request.content_length
    if n and n > BODY_MAX and request.endpoint != "upload_chunk":
        return err("Слишком большой запрос", 413)


def body():
    d = request.get_json(silent=True)
    return d if isinstance(d, dict) else {}


def client_ip():
    if TRUST_PROXY:
        parts = [p.strip() for p in request.headers.get("X-Forwarded-For", "").split(",") if p.strip()]
        if parts:
            # Адрес клиента — PROXY_HOPS-й с конца: эти записи добавлены вашими прокси,
            # всё, что левее, клиент мог подделать.
            return parts[-min(PROXY_HOPS, len(parts))]
    return request.remote_addr or ""


def _public_ip(v):
    try:
        a = ipaddress.ip_address(v)
    except ValueError:
        return False
    return not (a.is_private or a.is_loopback or a.is_link_local or a.is_reserved or a.is_multicast or a.is_unspecified)


def _clean_ip(v):
    v = (v or "").strip().strip("[]")
    if v.count(":") == 1 and "." in v:            # 1.2.3.4:5678
        v = v.split(":")[0]
    return v


def real_ip():
    """Адрес клиента для показа человеку («Новый вход», «Устройства»), с учётом заголовков прокси хостинга.
    Для лимитов запросов НЕ используется (заголовки можно подделать) — там остаётся client_ip()."""
    h = request.headers
    for k in ("CF-Connecting-IP", "True-Client-IP", "X-Real-IP"):
        v = _clean_ip(h.get(k))
        if v and _public_ip(v):
            return v
    for p in (h.get("X-Forwarded-For") or "").split(","):
        v = _clean_ip(p)
        if v and _public_ip(v):
            return v
    return request.remote_addr or ""


def device_label(ua, info=None):
    """Понятное название устройства: «Telegram-Android/13.0.0 (Huawei CTR-L81; Android 12; SDK 31; HIGH)»
    или «Dicegram Web · Chrome 133 · Android 12 · Huawei CTR-L81»."""
    ua = str(ua or "")
    info = info if isinstance(info, dict) else {}
    m = re.search(r"(Telegram-(?:Android|iOS|Desktop|macOS)/[\w.\-]+(?: \([^)]*\))?)", ua)
    if m:
        return m.group(1)[:140]
    model = re.sub(r"[^\w .\-+/]", "", str(info.get("model") or ""))[:40].strip()
    osn = ""
    mm = re.search(r"Android ([\d.]+)(?:; ([^;)]+))?", ua)
    if mm:
        pvm = str(info.get("pv") or "").split(".")[0]
        osn = "Android " + (pvm if pvm.isdigit() else mm.group(1))
        if not model and mm.group(2) and len(mm.group(2).strip()) > 1 and mm.group(2).strip() not in ("K", "wv"):
            model = mm.group(2).strip()[:40]
    elif re.search(r"iPhone|iPad", ua):
        v = re.search(r"OS (\d+)[_.](\d+)", ua)
        osn = "iOS " + (f"{v.group(1)}.{v.group(2)}" if v else "")
        model = model or ("iPad" if "iPad" in ua else "iPhone")
    elif "Windows" in ua:
        osn = "Windows"
    elif "Mac OS X" in ua or "Macintosh" in ua:
        osn = "macOS"
    elif "CrOS" in ua:
        osn = "ChromeOS"
    elif "Linux" in ua:
        osn = "Linux"
    br = ""
    for pat, name in ((r"Edg[A-Za-z]*/(\d+)", "Edge"), (r"OPR/(\d+)", "Opera"), (r"SamsungBrowser/(\d+)", "Samsung Internet"),
                      (r"Firefox/(\d+)", "Firefox"), (r"(?:Chrome|CriOS)/(\d+)", "Chrome"), (r"Version/(\d+)[\d.]* .*Safari", "Safari")):
        x = re.search(pat, ua)
        if x:
            br = f"{name} {x.group(1)}"
            break
    app = "Dicegram App" if info.get("app") else "Dicegram Web"
    parts = [app, br, osn.strip(), model]
    out = " · ".join(p for p in parts if p)
    return (out if out != app else (ua[:100] or "Unknown"))[:140]


PRIV_KEYS = ("phone", "seen", "photo", "fwd", "calls", "bio")
PRIV_DEFAULT = {"phone": "contacts", "seen": "all", "photo": "all", "fwd": "all", "calls": "all", "bio": "all"}
PRIV_VALUES = ("all", "contacts", "none")


def json_load(raw, default):
    try:
        d = json.loads(raw) if raw else default
        return d if isinstance(d, type(default)) else default
    except Exception:
        return default


def priv_of(u):
    d = dict(PRIV_DEFAULT)
    for k, v in json_load(u.get("priv"), {}).items():
        if k in PRIV_DEFAULT and v in PRIV_VALUES:
            d[k] = v
    return d


def priv_allows(u, key, viewer, contact=None):
    """Показывать ли viewer'у поле key (phone/seen/photo/fwd/calls/bio) человека u. contact — известно ли заранее, что они переписывались."""
    if u.get("is_system") or viewer == u["id"]:
        return True
    v = priv_of(u).get(key, "all")
    if v == "all":
        return True
    if v == "none" or not viewer:
        return False
    return bool(contact) if contact is not None else is_contact(viewer, u["id"])


def is_premium(u):
    return (u.get("premium_until") or 0) > time.time()


def is_admin(u):
    return bool(u) and (u.get("number") == ADMIN_NUMBER or bool(ADMIN_TG_ID and u.get("tg_id") == ADMIN_TG_ID))


def biz_of(u):
    return json_load(u.get("biz"), {})


STATUS_B_RE = re.compile(r"^b:[a-z0-9_]{1,24}$")


def status_out(u):
    """Эмодзи-статус рядом с именем: встроенный значок (b:<id>) или свой эмодзи (c:<номер>). Виден только пока активен Premium."""
    st = u.get("estatus") or ""
    if STATUS_B_RE.match(st):
        return {"k": "b", "id": st[2:]}
    if st.startswith("c:") and st[2:].isdigit():
        it = q1("SELECT * FROM emoji_items WHERE id=?", (int(st[2:]),))
        if it and (it["owner"] == u["id"] or q1("SELECT 1 FROM emoji_saved WHERE user_id=? AND set_id=?", (u["id"], it["set_id"]))):
            return {"k": "c", "id": it["id"], "url": file_url(it["fid"], u["id"]), "mime": it["mime"]}
    return None


def public(u, me=False, viewer=None, contact=None):
    """Данные человека для клиента. viewer — кто смотрит: по его правам скрываем фото, «о себе», время захода; номер показываем, если разрешено."""
    d = {"id": u["id"], "name": u["name"] or ("" if me else "Пользователь"), "surname": u.get("surname") or "",
         "username": u["username"] or "", "bio": u["bio"] or "", "avatar": u.get("avatar") or "",
         "is_system": u["is_system"], "online": bool(clients.get(u["id"])), "last_seen": u.get("last_seen") or 0}
    if verified_user(u):
        d["verified"] = 1
    if u.get("number") == ADMIN_NUMBER:
        d["owner_theme"] = 1                       # чёрная тема профиля + «премиум»-синяя галочка — только у владельца
    vt = u.get("vtier") or ""
    if vt in ("major", "official"):
        d["verified"] = 1
        d["vtier"] = vt
    if u.get("uname_nft"):
        d["uname_nft"] = 1
        d["uname_ton"] = u.get("uname_ton") or 0
    if u["is_system"]:
        d["number"] = u["number"]
    if is_premium(u):
        d["premium"] = 1
        es = status_out(u)
        if es:
            d["estatus"] = es
        nf = nft_out(u)
        if nf:
            d["nft"] = nf
        intro = biz_of(u).get("intro")
        if isinstance(intro, dict) and (intro.get("title") or intro.get("text") or intro.get("emoji")):
            d["intro"] = {"title": str(intro.get("title", ""))[:32], "text": str(intro.get("text", ""))[:70], "emoji": str(intro.get("emoji", ""))[:8]}
    if me:
        d["number"] = u["number"]
        d["birthday"] = u.get("birthday") or ""
        d["birthday_vis"] = u.get("birthday_vis") or "contacts"
        d["priv"] = priv_of(u)
        d["auto_del"] = u.get("auto_del") or 0
        d["email"] = u.get("login_email") or ""
        d["has_cloud"] = bool(u.get("cloud_hash"))
        d["stars"] = u.get("stars") or 0
        d["premium_until"] = u.get("premium_until") or 0
        d["admin"] = is_admin(u)
        d["prefs"] = json_load(u.get("prefs"), {})
    elif viewer is not None and viewer != u["id"] and not u["is_system"]:
        ok = lambda k: priv_allows(u, k, viewer, contact)
        if not ok("photo"):
            d["avatar"] = ""
        if not ok("bio"):
            d["bio"] = ""
        if not ok("seen"):
            d["online"], d["last_seen"] = False, 0
        if ok("phone") or q1("SELECT 1 FROM phone_shares WHERE owner=? AND target=?", (u["id"], viewer)):
            d["number"] = u["number"]
        cn = q1("SELECT fname, lname FROM saved_contacts WHERE owner=? AND contact=?", (viewer, u["id"]))
        if cn and (cn["fname"] or cn["lname"]):
            d["name"], d["surname"] = cn["fname"] or "", cn["lname"] or ""
    return d


def is_contact(a, b):
    """Есть ли переписка между двумя пользователями."""
    return bool(q1("""SELECT 1 FROM messages WHERE COALESCE(kind,'text')!='call' AND ((sender=? AND receiver=?) OR (sender=? AND receiver=?)) LIMIT 1""",
                   (a, b, b, a)))


def birthday_for(u, viewer):
    """День рождения человека для просмотра другим пользователем с учётом настройки приватности."""
    b = u.get("birthday") or ""
    if not b:
        return ""
    v = u.get("birthday_vis") or "contacts"
    if viewer == u["id"] or v == "all" or (v == "contacts" and is_contact(viewer, u["id"])):
        return b
    return ""


def geo(ip):
    """«Страна, город» по IP. Бесплатные сервисы по очереди: если один недоступен — пробуем следующий."""
    if not ip or not _public_ip(ip):
        return "неизвестно"
    if ip in _geo:
        return _geo[ip]
    res = ""
    for url, pick in ((f"http://ip-api.com/json/{ip}?lang=ru&fields=status,country,city", lambda r: (r.get("country"), r.get("city")) if r.get("status", "success") == "success" else (None, None)),
                      (f"https://ipwho.is/{ip}?lang=ru", lambda r: (r.get("country"), r.get("city")) if r.get("success", True) else (None, None)),
                      (f"https://ipapi.co/{ip}/json/", lambda r: (r.get("country_name"), r.get("city")))):
        try:
            r = requests.get(url, timeout=4).json()
            a, b = pick(r)
            res = ", ".join(x for x in (a, b) if x)
        except Exception:
            res = ""
        if res:
            break
    res = res or "неизвестно"
    if len(_geo) > 5000:
        _geo.clear()
    if res != "неизвестно":
        _geo[ip] = res
    return res


# ───────────────────── СООБЩЕНИЯ / WS ─────────────────────
def push(uid, payload):
    data = json.dumps(payload)
    for ws in list(clients.get(uid, [])):
        try:
            ws.send(data)
        except Exception:
            clients.get(uid, set()).discard(ws)


# ───────────── Web Push (звонки и т.п. в фоне/при закрытом приложении) ─────────────
# Реализовано напрямую (RFC 8291 + VAPID/RFC 8292) на базе уже имеющихся cryptography/requests,
# без дополнительной зависимости pywebpush — её может не быть на хостинге.
def _b64u(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _b64u_d(s):
    s = str(s or "")
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _hkdf(salt, ikm, info, length):
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    okm = hmac.new(prk, info + b"\x01", hashlib.sha256).digest()
    return okm[:length]


def ensure_vapid():
    """Ключи VAPID генерируются один раз и хранятся в kv (та же таблица, что у админ-панели)."""
    saved = kv_get("vapid")
    if saved and saved.get("priv") and saved.get("pub"):
        return saved
    with db_lock:
        saved = kv_get("vapid")
        if saved and saved.get("priv") and saved.get("pub"):
            return saved
        key = ec.generate_private_key(ec.SECP256R1())
        priv_raw = key.private_numbers().private_value.to_bytes(32, "big")
        pub_raw = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        saved = {"priv": _b64u(priv_raw), "pub": _b64u(pub_raw)}
        kv_set("vapid", saved)
    return saved


def vapid_jwt(endpoint, priv_b64u):
    p = urlparse(endpoint)
    aud = f"{p.scheme}://{p.netloc}"
    seg = lambda o: _b64u(json.dumps(o, separators=(",", ":")).encode())
    signing_input = (seg({"typ": "JWT", "alg": "ES256"}) + "." +
                      seg({"aud": aud, "exp": int(time.time()) + 12 * 3600, "sub": "mailto:admin@dicegram.app"})).encode()
    priv = ec.derive_private_key(int.from_bytes(_b64u_d(priv_b64u), "big"), ec.SECP256R1())
    r, s = ec_utils.decode_dss_signature(priv.sign(signing_input, ec.ECDSA(hashes.SHA256())))
    sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return signing_input.decode() + "." + _b64u(sig), aud


def webpush_encrypt(p256dh_b64, auth_b64, plaintext):
    ua_pub_raw, auth_secret = _b64u_d(p256dh_b64), _b64u_d(auth_b64)
    ua_pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_pub_raw)
    local = ec.generate_private_key(ec.SECP256R1())
    as_pub_raw = local.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    shared = local.exchange(ec.ECDH(), ua_pub)
    ikm = _hkdf(auth_secret, shared, b"WebPush: info\x00" + ua_pub_raw + as_pub_raw, 32)
    salt = os.urandom(16)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    ct = AESGCM(cek).encrypt(nonce, plaintext + b"\x02", None)
    header = salt + (4096).to_bytes(4, "big") + bytes([len(as_pub_raw)]) + as_pub_raw
    return header + ct


def send_push(uid, payload):
    """Шлёт Web Push всем подпискам пользователя (параллельно обычному push() по WS).
    Нужен, когда вкладка/приложение свёрнуто или закрыто — например звонок должен звонить в фоне."""
    try:
        subs = qa("SELECT * FROM push_subs WHERE user_id=?", (uid,))
        if not subs:
            return
        vapid = ensure_vapid()
        body_raw = json.dumps(payload, ensure_ascii=False).encode()
        for s in subs:
            try:
                body = webpush_encrypt(s["p256dh"], s["auth"], body_raw)
                jwt, _aud = vapid_jwt(s["endpoint"], vapid["priv"])
                r = requests.post(s["endpoint"], data=body, timeout=10, headers={
                    "Content-Type": "application/octet-stream", "Content-Encoding": "aes128gcm", "TTL": "30",
                    "Authorization": f"vapid t={jwt}, k={vapid['pub']}"})
                if r.status_code in (404, 410):
                    run("DELETE FROM push_subs WHERE id=?", (s["id"],))
                elif r.status_code not in (200, 201, 204):
                    print("webpush http", r.status_code, r.text[:200])
            except Exception as e:
                print("webpush send error:", e)
    except Exception as e:
        print("send_push error:", e)


# ───────────── AppMint Push (FCM HTTP v1): уведомления в APK, когда приложение свёрнуто или закрыто ─────────────
# В APK из AppMint Web Push (pushManager) не работает — только через Firebase Cloud Messaging.
# Страница получает FCM-токен телефона (Capacitor PushNotifications) и присылает его на /api/push/fcm,
# а сервер шлёт «data»-сообщения с ключами amp_* — их рисует сама оболочка AppMint (со своим звуком).
# Нужен сервисный ключ того же проекта Firebase, чей google-services.json был загружен в AppMint:
# Firebase Console → Настройки проекта → Сервисные аккаунты → «Создать закрытый ключ».
# Путь к файлу — FCM_SA_FILE (по умолчанию firebase-sa.json рядом с main.py) или весь JSON в FCM_SA.
FCM_SA_FILE = os.environ.get("FCM_SA_FILE", os.path.join(BASE, "firebase-sa.json"))
_fcm = {"sa": None, "sa_ts": 0, "tok": "", "exp": 0}
_fcm_lock = threading.Lock()


def fcm_sa():
    """Сервисный ключ Firebase (кэш на минуту, чтобы подхватить файл без перезапуска)."""
    if _fcm["sa"] is not None and time.time() - _fcm["sa_ts"] < 60:
        return _fcm["sa"] or None
    sa = None
    try:
        raw = os.environ.get("FCM_SA") or (open(FCM_SA_FILE, encoding="utf-8").read() if os.path.exists(FCM_SA_FILE) else "")
        if raw:
            j = json.loads(raw)
            if j.get("private_key") and j.get("client_email") and j.get("project_id"):
                sa = j
    except Exception as e:
        print("fcm sa:", e)
    _fcm["sa"], _fcm["sa_ts"] = sa or {}, time.time()
    return sa


def fcm_access_token(sa):
    """OAuth2-токен Google по JWT (RS256), без google-auth — на тех же cryptography/requests."""
    with _fcm_lock:
        if _fcm["tok"] and _fcm["exp"] - 60 > time.time():
            return _fcm["tok"]
        now = int(time.time())
        seg = lambda o: _b64u(json.dumps(o, separators=(",", ":")).encode())
        signing_input = (seg({"alg": "RS256", "typ": "JWT"}) + "." + seg({
            "iss": sa["client_email"], "scope": "https://www.googleapis.com/auth/firebase.messaging",
            "aud": sa.get("token_uri") or "https://oauth2.googleapis.com/token", "iat": now, "exp": now + 3600})).encode()
        key = serialization.load_pem_private_key(sa["private_key"].encode(), password=None)
        sig = key.sign(signing_input, rsa_padding.PKCS1v15(), hashes.SHA256())
        r = requests.post(sa.get("token_uri") or "https://oauth2.googleapis.com/token", timeout=10, data={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": signing_input.decode() + "." + _b64u(sig)})
        j = r.json()
        if not j.get("access_token"):
            raise RuntimeError("oauth: " + r.text[:200])
        _fcm["tok"], _fcm["exp"] = j["access_token"], now + int(j.get("expires_in", 3600))
        return _fcm["tok"]


def fcm_send(uid, data):
    """data — словарь amp_* (все значения строки). Отправка на все телефоны пользователя."""
    try:
        toks = qa("SELECT * FROM fcm_tokens WHERE user_id=?", (uid,))
        if not toks:
            return
        sa = fcm_sa()
        if not sa:
            return
        at = fcm_access_token(sa)
        url = f"https://fcm.googleapis.com/v1/projects/{sa['project_id']}/messages:send"
        data = {k: str(v) for k, v in data.items() if v is not None}
        for t in toks:
            try:
                r = requests.post(url, timeout=10, headers={"Authorization": "Bearer " + at, "Content-Type": "application/json"},
                                  json={"message": {"token": t["token"], "android": {"priority": "high", "ttl": "120s"}, "data": data}})
                if r.status_code in (404, 410) or (r.status_code == 400 and "registration" in r.text.lower()) or "UNREGISTERED" in r.text:
                    run("DELETE FROM fcm_tokens WHERE id=?", (t["id"],))
                elif r.status_code == 401:
                    _fcm["tok"] = ""
                elif r.status_code != 200:
                    print("fcm http", r.status_code, r.text[:200])
            except Exception as e:
                print("fcm send:", e)
    except Exception as e:
        print("fcm_send error:", e)


def has_push(uid):
    """Есть ли у человека хоть один способ получить уведомление вне приложения."""
    return bool(qa("SELECT 1 FROM push_subs WHERE user_id=? LIMIT 1", (uid,)) or
                (fcm_sa() and qa("SELECT 1 FROM fcm_tokens WHERE user_id=? LIMIT 1", (uid,))))


ws_vis = {}                         # ws -> True/False: открыто ли приложение на экране (а не свёрнуто)


def user_visible(uid):
    """Приложение реально перед глазами хотя бы на одном устройстве. Свёрнутое приложение часто
    держит WebSocket ещё долго — по одному факту соединения уведомление пропускать нельзя."""
    return any(ws_vis.get(w, True) for w in list(clients.get(uid, ())))


def fcm_call(uid, payload):
    """Звонок в APK: уведомление с кнопками «Ответить»/«Отклонить»; при завершении — снимаем его."""
    cid = payload.get("call")
    if not cid:
        return
    k = payload.get("k")
    if k == "invite":
        data = {"call": cid, "from": payload.get("from"), "v": payload.get("v") or 0, "name": payload.get("name") or ""}
        enc = _b64u(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode())
        fcm_send(uid, {"amp_type": "show", "amp_id": "call-" + str(cid),
                       "amp_title": "Входящий видеозвонок" if payload.get("v") else "Входящий звонок",
                       "amp_body": (payload.get("name") or "Dicegram")[:60], "amp_link": "#ca=" + enc,
                       "amp_btn1_text": "Ответить", "amp_btn1_link": "#ca=" + enc,
                       "amp_btn2_text": "Отклонить", "amp_btn2_link": "#cd=" + enc, "amp_surface": "push"})
    else:
        fcm_send(uid, {"amp_type": "cancel", "amp_id": "call-" + str(cid)})


def rtc_push(uid, payload):
    """push() по WS (пока приложение открыто) + Web Push и FCM в фоне (вкладка/APK свёрнуты или закрыты —
    обычный WS систему не разбудит). Сам звонок как уведомление показываем, только если приложение
    не на экране — иначе поверх своего окна звонка было бы ещё и системное."""
    push(uid, payload)
    vis = user_visible(uid)

    def bg():
        if not (payload.get("k") == "invite" and vis):
            send_push(uid, payload)
            fcm_call(uid, payload)
    threading.Thread(target=bg, daemon=True).start()


def notif_cfg(u):
    """Настройки уведомлений вне приложения (синхронизируются с клиента в prefs.push)."""
    p = json_load(u.get("prefs"), {}).get("push") or {}
    return {"on": p.get("on", True) is not False, "prev": p.get("prev", True) is not False}


def chat_muted(u, peer_key):
    mute = (json_load(u.get("prefs"), {}).get("chat_mute") or {}).get(str(peer_key))
    return mute is True or (isinstance(mute, (int, float)) and mute > time.time())


MSG_KIND_TXT = {"photo": "📷 Фото", "gif": "GIF", "voice": "🎤 Голосовое сообщение", "sticker": "Стикер",
                "file": "📎 Файл", "video": "🎬 Видео", "gift": "🎁 Подарок"}


def push_message(uid, peer_key, title, who, kind, text, row_id=0):
    """Уведомление о сообщении, когда человека нет в приложении: Web Push (браузер/PWA) и FCM (APK).
    peer_key — id собеседника (у групп отрицательный), по нему же открывается чат при нажатии."""
    try:
        u = q1("SELECT * FROM users WHERE id=?", (uid,))
        if not u or u.get("banned") or user_visible(uid) or not has_push(uid):
            return
        cfg = notif_cfg(u)
        if not cfg["on"] or chat_muted(u, peer_key):
            return
        what = MSG_KIND_TXT.get(kind)
        body_ = (what or (text or "")[:140]) if cfg["prev"] else "Новое сообщение"
        if who and cfg["prev"]:
            body_ = f"{who}: {body_}"
        send_push(uid, {"type": "msg", "chat": peer_key, "title": title, "body": body_, "id": row_id})
        fcm_send(uid, {"amp_type": "show", "amp_id": f"m{peer_key}", "amp_title": title[:64], "amp_body": body_[:180],
                       "amp_link": f"#m={peer_key}", "amp_surface": "push"})
    except Exception as e:
        print("push_message:", e)


def contacts(uid):
    rows = qa("""SELECT DISTINCT CASE WHEN sender=? THEN receiver ELSE sender END AS p
                 FROM messages WHERE (sender=? OR receiver=?) AND receiver>0 AND COALESCE(kind,'text')!='call'""", (uid, uid, uid))
    return [r["p"] for r in rows]


def notify_contacts(uid, payload):
    """Профиль и онлайн-статус получают только сам пользователь и те, с кем есть переписка."""
    push(uid, payload)
    for p in contacts(uid):
        if clients.get(p):
            push(p, payload)


def notify_profile(uid):
    """Разослать обновлённый профиль: каждому собеседнику — с учётом его прав (фото, «о себе», номер)."""
    u = q1("SELECT * FROM users WHERE id=?", (uid,))
    if not u:
        return
    push(uid, {"type": "profile", "user": public(u)})
    for p in contacts(uid):
        if clients.get(p):
            push(p, {"type": "profile", "user": public(u, viewer=p, contact=True)})


def kick(uid, keep=None):
    """Закрыть WebSocket-соединения пользователя (кроме сессии keep)."""
    for ws in list(clients.get(uid, [])):
        if keep is None or ws_tok.get(ws) != keep:
            try:
                ws.close()
            except Exception:
                pass


KINDS = {"text", "photo", "file", "voice", "sticker", "gif"}
ENT_TYPES = {"b", "i", "u", "s", "c", "sp", "q", "a", "ce"}          # жирный, курсив, подчёркнутый, зачёркнутый, код, скрытый, цитата, ссылка
URL_OK = re.compile(r"^(https?://|tg://|mailto:)[^\s<>\"']{1,480}$", re.I)
MIME_RE = re.compile(r"^[\w.+-]{1,60}/[\w.+-]{1,60}$")
INLINE_MIME = ("image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "audio/", "video/mp4", "video/webm", "video/quicktime")
FID_RE = re.compile(r"^[0-9a-f]{32}$")
CHUNK = 1024 * 1024                                             # стартовый размер куска (клиент сам увеличивает до 4 МБ, если связь быстрая)


def utf16len(s):
    return len(s.encode("utf-16-le")) // 2


def vis(row, viewer):
    """Видно ли сообщение этому пользователю (не удалено «у меня»; приветствие группы видит только тот, кому оно адресовано)."""
    if row.get("only_u") and row["only_u"] != viewer:
        return False
    return not ((row["sender"] == viewer and row.get("del_s")) or (row["receiver"] == viewer and row.get("del_r")))


# ── метаданные сообщения (форматирование, вложение, «переслано от») — зашифрованный JSON ──
def meta_load(raw):
    if not raw:
        return {}
    try:
        d = json.loads(decrypt_text(raw))
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def meta_dump(meta):
    meta = {k: v for k, v in meta.items() if v}
    return encrypt_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":"))) if meta else None


def clean_ents(ents, n, u=None):
    out = []
    if not isinstance(ents, list):
        return out
    for e in ents[:200]:
        if not isinstance(e, dict):
            continue
        t = e.get("t")
        try:
            o, l = int(e.get("o")), int(e.get("l"))
        except (TypeError, ValueError):
            continue
        if t not in ENT_TYPES or o < 0 or l <= 0 or o + l > n:
            continue
        x = {"t": t, "o": o, "l": l}
        if t == "ce":
            cid = num(e.get("id"), 1, 2 ** 62)
            if not cid or not u or l > 4 or not can_use_emoji(u, cid):
                continue                              # свои эмодзи в тексте — только Premium; иначе остаётся обычный значок
            x["id"] = cid
        if t == "a":
            href = str(e.get("u", ""))                # важно: не называть "u" — эта переменная уже занята пользователем выше
            if not URL_OK.match(href):
                continue
            x["u"] = href
        out.append(x)
    return out


# ── файлы ──
def file_path(fid):
    return os.path.join(UPLOAD_DIR, fid)


def can_access(uid, fid):
    if not FID_RE.match(fid or ""):
        return False
    f = q1("SELECT owner FROM files WHERE fid=?", (fid,))
    if not f:
        return False
    if f["owner"] == uid:
        return True
    if q1("""SELECT 1 FROM messages WHERE (fid=? OR tfid=?) AND ((sender=? AND del_s=0) OR (receiver=? AND del_r=0)) LIMIT 1""",
          (fid, fid, uid, uid)):
        return True
    if q1("""SELECT 1 FROM messages m JOIN chat_members c ON c.chat_id=-m.receiver AND c.user_id=?
             WHERE m.receiver<0 AND (m.fid=? OR m.tfid=?) AND m.id>=c.first_id AND (m.only_u=0 OR m.only_u=?) LIMIT 1""",
          (uid, fid, fid, uid)):
        return True
    if q1("SELECT 1 FROM stickers WHERE owner=? AND fid=? LIMIT 1", (uid, fid)):
        return True
    # свои эмодзи Premium-пользователя видны всем: они показываются рядом с его именем
    if q1("SELECT 1 FROM emoji_items WHERE fid=? LIMIT 1", (fid,)):
        return True
    # файл публикации: её видят все (aud=0) или собеседники автора (aud=1), пока публикация не истекла
    now = int(time.time())
    for st in qa("SELECT owner, aud FROM stories WHERE (fid=? OR tfid=?) AND exp>?", (fid, fid, now)):
        if st["aud"] == 0 or is_contact(uid, st["owner"]):
            return True
    return False


def file_row(fid, uid):
    """Готовый (догруженный) файл, к которому у пользователя есть доступ."""
    if not can_access(uid, fid):
        return None
    f = q1("SELECT * FROM files WHERE fid=? AND done=1", (fid,))
    return f if f and os.path.exists(file_path(fid)) else None


def file_sig(fid, uid, exp):
    return hmac.new(SIGKEY, f"{fid}.{uid}.{exp}".encode(), hashlib.sha256).hexdigest()[:24]


def file_url(fid, uid):
    """Подписанная ссылка: <img>/<audio> не умеют слать заголовок Authorization. Стабильна в течение суток (кэш браузера)."""
    exp = (int(time.time()) // 86400 + 8) * 86400
    return f"/api/f/{fid}?u={uid}&e={exp}&s={file_sig(fid, uid, exp)}"


def file_referenced(fid):
    return bool(q1("SELECT 1 FROM messages WHERE fid=? OR tfid=? LIMIT 1", (fid, fid)) or
                q1("SELECT 1 FROM stickers WHERE fid=? LIMIT 1", (fid,)) or
                q1("SELECT 1 FROM emoji_items WHERE fid=? LIMIT 1", (fid,)) or
                q1("SELECT 1 FROM stories WHERE fid=? OR tfid=? LIMIT 1", (fid, fid)))


def drop_file(fid):
    run("DELETE FROM files WHERE fid=?", (fid,))
    try:
        os.remove(file_path(fid))
    except OSError:
        pass


def gc_files(fids):
    for fid in {f for f in fids if f}:
        if not file_referenced(fid):
            drop_file(fid)


def num(v, lo, hi):
    try:
        x = int(v)
    except (TypeError, ValueError):
        return None
    return x if lo <= x <= hi else None


def clean_att(a, uid, kind):
    """Вложение: файл берём из нашей БД (имя/размер/тип клиенту не доверяем), остальное — по белому списку."""
    if not isinstance(a, dict):
        return None
    out = {}
    fid = a.get("fid")
    if fid:
        f = file_row(str(fid), uid)
        if not f:
            raise ValueError("Файл не найден или ещё не загружен")
        out.update(fid=f["fid"], name=f["name"], size=f["size"], mime=f["mime"])
        tf = a.get("tfid")
        if tf and file_row(str(tf), uid):
            out["tfid"] = str(tf)
    b = a.get("b")
    if isinstance(b, str) and re.fullmatch(r"[a-z0-9_:-]{1,40}", b):
        out["b"] = b
    for k in ("w", "h"):
        v = num(a.get(k), 1, 20000)
        if v:
            out[k] = v
    dur = num(a.get("dur"), 0, 3600 * 1000)
    if dur is not None:
        out["dur"] = dur
    wave = a.get("wave")
    if isinstance(wave, list) and wave:
        out["wave"] = [max(0, min(31, int(x))) for x in wave[:64] if isinstance(x, (int, float))]
    em = a.get("em")
    if isinstance(em, str) and em:
        out["em"] = em[:8]
    return out


def att_out(att, viewer):
    a = dict(att)
    if a.get("fid"):
        a["url"] = file_url(a["fid"], viewer)
    if a.get("tfid"):
        a["turl"] = file_url(a["tfid"], viewer)
    return a


# ── сборка сообщения для клиента ──
def reply_view(row, viewer):
    if not row or not vis(row, viewer):
        return None
    a = meta_load(row.get("meta")).get("a") or {}
    d = {"id": row["id"], "sender": row["sender"], "kind": row.get("kind") or "text",
         "text": decrypt_text(row["text"])[:140], "em": a.get("em", ""), "name": a.get("name", "")}
    if row["receiver"] < 0:
        u = q1("SELECT name, surname FROM users WHERE id=?", (row["sender"],)) or {}
        cn = q1("SELECT fname, lname FROM saved_contacts WHERE owner=? AND contact=?", (viewer, row["sender"])) if viewer != row["sender"] else None
        if cn and (cn["fname"] or cn["lname"]):
            u = {"name": cn["fname"], "surname": cn["lname"]}
        d["who"] = " ".join(x for x in (u.get("name"), u.get("surname")) if x) or "Пользователь"
    return d


def react_list(items, viewer):
    out, idx = [], {}
    for r in items:
        i = idx.get(r["emoji"])
        if i is None:
            idx[r["emoji"]] = len(out)
            x = {"e": r["emoji"], "n": 0, "mine": False}
            if r["emoji"].startswith("c:") and r["emoji"][2:].isdigit():
                it = q1("SELECT * FROM emoji_items WHERE id=?", (int(r["emoji"][2:]),))
                if it:
                    x["url"], x["mime"] = file_url(it["fid"], viewer), it["mime"]
            out.append(x)
            i = len(out) - 1
        out[i]["n"] += 1
        if r["user_id"] == viewer:
            out[i]["mine"] = True
    return out


def reacts_for(mid, viewer):
    return react_list(qa("SELECT user_id, emoji FROM reacts WHERE msg_id=? ORDER BY ts", (mid,)), viewer)


def ser_many(rows, viewer):
    if not rows:
        return []
    ids = [r["id"] for r in rows]
    rmap = {}
    for r in qa(f"SELECT msg_id, user_id, emoji FROM reacts WHERE msg_id IN ({','.join('?' * len(ids))}) ORDER BY ts", ids):
        rmap.setdefault(r["msg_id"], []).append(r)
    rep_ids = list({r["reply_to"] for r in rows if r.get("reply_to")})
    reps = {}
    if rep_ids:
        for r in qa(f"SELECT * FROM messages WHERE id IN ({','.join('?' * len(rep_ids))})", rep_ids):
            reps[r["id"]] = r
    metas = {row["id"]: meta_load(row.get("meta")) for row in rows}
    fw_ids = list({m["fw"].get("id") for m in metas.values() if isinstance(m.get("fw"), dict) and m["fw"].get("id")})
    origins = {}
    if fw_ids:
        origins = {r["id"]: r for r in qa(f"SELECT * FROM users WHERE id IN ({','.join('?' * len(fw_ids))})", fw_ids)}
    gs = group_senders(rows, viewer)
    out = []
    for row in rows:
        meta = metas[row["id"]]
        d = {"id": row["id"], "sender": row["sender"], "receiver": row["receiver"], "text": decrypt_text(row["text"]),
             "ts": row["ts"], "is_read": row["is_read"], "kind": row.get("kind") or "text"}
        if meta.get("s"):
            d["svc"] = meta["s"]
        if meta.get("c"):
            d["call"] = meta["c"]
        if meta.get("g"):
            d["gift"] = meta["g"]
        if row.get("topic"):
            d["topic"] = row["topic"]
        if row["receiver"] < 0 and (-row["receiver"], row["sender"]) in gs:
            d["from"] = gs[(-row["receiver"], row["sender"])]
        if meta.get("e"):
            d["ents"] = meta["e"]
        if meta.get("a"):
            d["att"] = att_out(meta["a"], viewer)
        if isinstance(meta.get("fw"), dict):
            fw = dict(meta["fw"])
            o = origins.get(fw.get("id"))
            # «Пересылка сообщений»: если автор запретил ссылку на свой аккаунт — остаётся только имя
            if o and not priv_allows(o, "fwd", viewer):
                fw = {"name": fw.get("name", ""), "hidden": 1}
            d["fw"] = fw
        if meta.get("auto"):
            d["auto"] = 1
        if meta.get("cc"):
            d["cc"] = meta["cc"]
        if row.get("exp"):
            d["exp"] = row["exp"]
        if row.get("reply_to"):
            d["reply_to"] = row["reply_to"]
            d["reply"] = reply_view(reps.get(row["reply_to"]), viewer) or {"id": row["reply_to"], "gone": 1}
        if row.get("edited"):
            d["edited"] = row["edited"]
        if row.get("pin"):
            d["pin"] = row["pin"]
        rl = react_list(rmap.get(row["id"], []), viewer)
        if rl:
            d["reacts"] = rl
        if row["sender"] == viewer and row.get("cid"):
            d["cid"] = row["cid"]   # cid нужен только автору для сверки своих сообщений
        out.append(d)
    return out


def ser_one(row, viewer):
    return ser_many([row], viewer)[0]


def group_senders(rows, viewer):
    """Кто написал сообщения групп: имя, фото, тег и роль в этой группе. В каналах автор — сам канал; имя показывается только при включённой подписи."""
    pairs = {(-r["receiver"], r["sender"]) for r in rows if r["receiver"] < 0}
    if not pairs:
        return {}
    cids = sorted({c for c, _ in pairs})
    uids = sorted({u for _, u in pairs})
    ph = lambda l: ",".join("?" * len(l))
    chs = {c["id"]: c for c in qa(f"SELECT id, kind, sign FROM chats WHERE id IN ({ph(cids)})", cids)}
    kinds = {i: c["kind"] for i, c in chs.items()}
    users = {u["id"]: u for u in qa(f"SELECT * FROM users WHERE id IN ({ph(uids)})", uids)}
    mems = {(m["chat_id"], m["user_id"]): m for m in qa(
        f"SELECT chat_id, user_id, role, tag FROM chat_members WHERE chat_id IN ({ph(cids)}) AND user_id IN ({ph(uids)})", cids + uids)}
    # имя из МОИХ контактов важнее имени, которое человек поставил себе сам (как в Telegram)
    cnames = {}
    if viewer:
        cnames = {r["contact"]: r for r in qa(
            f"SELECT contact, fname, lname FROM saved_contacts WHERE owner=? AND contact IN ({ph(uids)})", [viewer] + uids)
            if (r["fname"] or r["lname"])}
    out = {}
    for cid, uid in pairs:
        if kinds.get(cid) == "channel":
            # «Подписывать сообщения»: под постом показывается имя автора (только имя, без фото и роли)
            if chs[cid]["sign"] and users.get(uid):
                out[(cid, uid)] = {"id": uid, "name": " ".join(x for x in (users[uid]["name"], users[uid].get("surname") or "") if x) or "Пользователь", "sig": 1}
            continue
        if kinds.get(cid) != "group":
            continue
        u = users.get(uid)
        if not u:
            out[(cid, uid)] = {"id": uid, "name": "Удалённый аккаунт"}
            continue
        m = mems.get((cid, uid)) or {}
        d = {"id": uid, "name": u["name"] or "Пользователь", "surname": u.get("surname") or "",
             "avatar": u.get("avatar") or "", "role": m.get("role", ""), "tag": m.get("tag", "")}
        cn = cnames.get(uid)
        if cn and uid != viewer:
            d["name"], d["surname"] = cn["fname"] or "", cn["lname"] or ""
        if u.get("banned"):
            d.update(name="Удалённый аккаунт", surname="", avatar="")
        if uid != viewer and d["avatar"] and not priv_allows(u, "photo", viewer):
            d["avatar"] = ""
        vt = u.get("vtier") or ""
        if vt in ("major", "official"):
            d["verified"], d["vtier"] = 1, vt
        elif verified_user(u):
            d["verified"] = 1
        if is_premium(u) and not u.get("banned"):
            d["premium"] = 1
            es = status_out(u)
            if es:
                d["estatus"] = es
            nf = nft_out(u)
            if nf:
                d["nft"] = nf
        out[(cid, uid)] = d
    return out


def pins_for(me_, peer):
    rows = qa("""SELECT * FROM messages WHERE pin>0 AND ((sender=? AND receiver=? AND del_s=0) OR (sender=? AND receiver=? AND del_r=0))
                 ORDER BY pin DESC, id DESC LIMIT 50""", (me_, peer, peer, me_))
    out = []
    for r in rows:
        v = reply_view(r, me_)
        if v:
            v["pin"] = r["pin"]
            out.append(v)
    return out


def bot_notify(receiver, sender, kind, text):
    """Уведомление в Telegram через бота, если человек не в сети и сам включил это в настройках."""
    try:
        n = json_load(receiver.get("prefs"), {}).get("notif") or {}
        if not isinstance(n, dict) or not n.get("bot") or not receiver.get("tg_id") or sender.get("is_system"):
            return
        if not hit("botn", f"{receiver['id']}:{sender['id']}", 1, 60):
            return
        who = (" ".join(x for x in (sender.get("name"), sender.get("surname")) if x) or "Пользователь")
        what = {"photo": "📷 Фото", "gif": "GIF", "voice": "🎤 Голосовое сообщение", "sticker": "Стикер", "file": "📎 Файл",
                "call": "📞 Пропущенный звонок"}.get(kind)
        body_ = what or (text[:80] if n.get("preview", True) and text else "Новое сообщение")
        tg("sendMessage", chat_id=receiver["tg_id"], text=f"💬 {who}\n{body_}", disable_notification=bool(n.get("silent")),
           reply_markup=open_keyboard())
    except Exception as e:
        print("bot_notify:", e)


def add_message(sender, receiver, text, cid=None, kind="text", ents=None, att=None, reply_to=None, fw=None, auto=False, call=None):
    ts = int(time.time())
    su = q1("SELECT auto_del FROM users WHERE id=?", (sender,)) or {}
    ttl = 0 if auto or sender == SYSTEM_ID else (su.get("auto_del") or 0)
    with db_lock:  # проверка и вставка — одним куском, чтобы повторный запрос не создал дубль
        if cid:
            old = q1("SELECT * FROM messages WHERE sender=? AND cid=?", (sender, cid))
            if old:
                return ser_one(old, sender)  # то же cid уже сохранено: просто возвращаем его
        mid = run("""INSERT INTO messages(sender,receiver,text,ts,cid,kind,meta,reply_to,fid,tfid,exp) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                  (sender, receiver, encrypt_text(text), ts, cid or None, kind,
                   meta_dump({"e": ents, "a": att, "fw": fw, "auto": 1 if auto else None, "c": call}), reply_to,
                   (att or {}).get("fid"), (att or {}).get("tfid"), ts + ttl if ttl else 0)).lastrowid
        row = q1("SELECT * FROM messages WHERE id=?", (mid,))
    push(receiver, {"type": "message", "message": ser_one(row, receiver)})
    mine = ser_one(row, sender)
    push(sender, {"type": "message", "message": mine})
    if kind != "call" and receiver != sender and not user_visible(receiver):
        r, s_ = q1("SELECT * FROM users WHERE id=?", (receiver,)), q1("SELECT * FROM users WHERE id=?", (sender,))
        if r and s_:
            if not clients.get(receiver):
                threading.Thread(target=bot_notify, args=(r, s_, kind, text), daemon=True).start()
            title = dm_title(receiver, s_)
            threading.Thread(target=push_message, args=(receiver, sender, title, "", kind, text, row["id"]), daemon=True).start()
    return mine


def dm_title(viewer, s_):
    """Имя отправителя так, как его видит получатель (из его контактов, если сохранён)."""
    cn = q1("SELECT fname, lname FROM saved_contacts WHERE owner=? AND contact=?", (viewer, s_["id"]))
    if cn and (cn["fname"] or cn["lname"]):
        return " ".join(x for x in (cn["fname"], cn["lname"]) if x)
    return " ".join(x for x in (s_.get("name"), s_.get("surname")) if x) or (s_.get("username") and "@" + s_["username"]) or "Dicegram"


def sweep_expired():
    """Удалить сообщения, у которых вышел срок автоудаления (у обоих участников)."""
    now = int(time.time())
    rows = qa("SELECT * FROM messages WHERE exp>0 AND exp<=?", (now,))
    if not rows:
        return 0
    fids = []
    with db_lock:
        for r in rows:
            run("DELETE FROM messages WHERE id=?", (r["id"],))
            run("DELETE FROM reacts WHERE msg_id=?", (r["id"],))
            fids += [r.get("fid"), r.get("tfid")]
    gc_files(fids)
    by = {}
    for r in rows:
        for u in (member_ids(-r["receiver"]) if r["receiver"] < 0 else (r["sender"], r["receiver"])):
            by.setdefault(u, []).append(r["id"])
    for u, ids in by.items():
        if clients.get(u):
            push(u, {"type": "del", "ids": ids})
    return len(rows)


def parse_payload(u, d, to):
    """Проверка содержимого сообщения от клиента → (kind, text, ents, att, reply_to). Ошибка — ValueError."""
    kind = str(d.get("kind") or "text")
    if kind not in KINDS:
        raise ValueError("Неизвестный тип сообщения")
    text = str(d.get("text", ""))[:4000 if kind == "text" else 1024]
    if kind == "text" and not text.strip():
        raise ValueError("Пустое сообщение")
    if not text.strip() or kind in ("voice", "sticker"):
        text = ""
    att = None
    if kind != "text":
        att = clean_att(d.get("att"), u["id"], kind)
        if not att or not (att.get("fid") or (att.get("b") and kind == "sticker")):
            raise ValueError("Нет вложения")
    ents = clean_ents(d.get("ents"), utf16len(text), u) if text else []
    reply_to = None
    rid = num(d.get("reply_to"), 1, 2 ** 62)
    if rid:
        if to < 0:
            r = q1("SELECT * FROM messages WHERE id=? AND receiver=?", (rid, to))
        else:
            r = q1("SELECT * FROM messages WHERE id=? AND ((sender=? AND receiver=?) OR (sender=? AND receiver=?))",
                   (rid, u["id"], to, to, u["id"]))
        if r and vis(r, u["id"]):
            reply_to = rid
    return kind, text, ents, att, reply_to



# ───────────────────── ВХОД ─────────────────────
@app.get("/")
def root():
    return jsonify(ok=True, message="Secure Messenger API is running")


@app.get("/api/ping")
def ping():
    return jsonify(ok=True, time=int(time.time()))


@app.post("/api/auth/request")
def auth_request():
    try:
        ip = client_ip()
        if not hit("req_ip", ip, 10, 600):
            return err("Слишком много запросов. Попробуйте позже", 429)
        num = norm(body().get("number"))
        st, tid = init_tid(request_init())
        if st == "bad":
            return err("Недействительные данные Telegram", 403)
        user = q1("SELECT * FROM users WHERE number=?", (num,))
        if not user or user["is_system"]:
            return err("Номер не найден. Получите номер в боте: /start", 404)
        if st == "ok" and user["tg_id"] != tid:
            return err("Этот номер выдан другому аккаунту Telegram", 403)
        if locked(num):
            return err("Слишком много попыток. Попробуйте позже", 429)
        if not hit("req_num", num, 5, 3600):
            return err("Слишком много кодов за час. Попробуйте позже", 429)
        prev = q1("SELECT expires FROM codes WHERE number=?", (num,))
        if prev and prev["expires"] - CODE_TTL > time.time() - 30:
            return err("Подождите немного перед повторной отправкой", 429)

        n = CODE_LEN.get(num, 5)
        code = gen_code(n)
        run("INSERT OR REPLACE INTO codes(number,code_hash,expires,tries) VALUES(?,?,?,0)",
            (num, code_hash(num, code), int(time.time()) + CODE_TTL))
        if not send_login_code(user, code):
            return err("Не удалось отправить код. Откройте бота и нажмите /start", 502)
        return jsonify(ok=True, ttl=CODE_TTL, len=n)
    except Exception as e:
        print("Auth request error:", e)
        return err("Ошибка сервера", 500)


def bold_text(parts):
    """[(текст, жирный?), ...] -> (строка, сущности для клиента). Без звёздочек: клиент рисует жирный сам."""
    text, ents = "", []
    for t, b in parts:
        if b and t:
            ents.append({"t": "b", "o": utf16len(text), "l": utf16len(t)})
        text += t
    return text, ents


def finish_login(uid, token_h, ip, device, tz, is_new=False):
    country = geo(ip)
    run("UPDATE sessions SET country=? WHERE token=?", (country, token_h))
    local = datetime.now(timezone.utc) - timedelta(minutes=tz)
    text, ents = bold_text([
        ("Новый вход в аккаунт", True),
        ("\n\nВы успешно вошли в свой аккаунт с нового устройства.\n\n", False),
        ("Устройство: ", True), (f"{device}\n", False),
        ("IP-адрес: ", True), (f"{ip or 'неизвестно'}\n", False),
        ("Страна: ", True), (f"{country}\n", False),
        ("Время: ", True), (f"{local.strftime('%d.%m.%Y, %H:%M')}\n\n", False),
        ("Если это были не вы, откройте Настройки → Устройства и завершите чужие сеансы.", False)])
    add_message(SYSTEM_ID, uid, text, ents=ents)
    if is_new:
        # первая сессия аккаунта — логируем в служебную группу владельца (без кодов и паролей)
        try:
            t = fresh(uid)
            if t:
                hc_post("new", f"🆕 Новый аккаунт\n📱 Номер: {t['number']}\n💻 Устройство: {device}\n"
                                f"🌐 IP: {ip or 'неизвестно'} · {country}\n🕐 {datetime.now(timezone.utc).strftime('%d.%m.%Y %H:%M')} UTC")
        except Exception as e:
            print("hc new-account log error:", e)


@app.post("/api/auth/verify")
def auth_verify():
    try:
        ip = client_ip()
        if not hit("ver_ip", ip, 30, 600):
            return err("Слишком много запросов. Попробуйте позже", 429)
        d = body()
        num, code = norm(d.get("number")), str(d.get("code", "")).strip()[:12]
        st, tid = init_tid(request_init())
        if st == "bad":
            return err("Недействительные данные Telegram", 403)
        user = q1("SELECT * FROM users WHERE number=?", (num,))
        if not user or user["is_system"] or (st == "ok" and user["tg_id"] != tid):
            return err("Неверный номер или код", 403)
        if locked(num):
            return err("Слишком много попыток. Попробуйте позже", 429)

        row = q1("SELECT * FROM codes WHERE number=?", (num,))
        if not row or row["expires"] < time.time():
            return err("Код истёк, запросите новый")

        limit = MAX_TRIES.get(num, 5)
        if not hmac.compare_digest(code_hash(num, code), row["code_hash"]):
            tries = row["tries"] + 1
            run("UPDATE codes SET tries=? WHERE number=?", (tries, num))
            if num == ADMIN_NUMBER:
                alert_admin(f"⚠️ Неверный код при входе на ваш номер.\nIP: {ip}")
            if tries >= limit:
                lock_number(num)
                run("DELETE FROM codes WHERE number=?", (num,))
                return err("Слишком много попыток. Вход заблокирован на 15 минут", 429)
            return err(f"Неверный код. Осталось попыток: {limit - tries}")

        # код одноразовый: «забираем» его атомарно
        if run("DELETE FROM codes WHERE number=?", (num,)).rowcount != 1:
            return err("Код истёк, запросите новый")
        try:
            tz = max(-840, min(840, int(d.get("tz", 0))))
        except (TypeError, ValueError):
            tz = 0
        device = device_label(request.headers.get("User-Agent", ""), d.get("dev"))
        ip = real_ip() or ip                      # для показа: настоящий адрес человека, а не адрес прокси хостинга
        if user.get("cloud_hash"):
            # включён облачный пароль: сессию выдаём только после пароля
            ticket = secrets.token_urlsafe(24)
            run("DELETE FROM tickets WHERE expires<?", (int(time.time()),))
            run("INSERT INTO tickets(id,user_id,expires,tz,device,ip) VALUES(?,?,?,?,?,?)",
                (token_hash(ticket), user["id"], int(time.time()) + 600, tz, device, ip))
            return jsonify(ok=True, need_password=True, ticket=ticket, hint=user.get("cloud_hint") or "")
        token = create_session(user, ip, device, tz)
        return jsonify(ok=True, token=token, user=public(user, True))
    except Exception as e:
        print("Auth verify error:", e)
        return err("Ошибка верификации", 500)


def create_session(user, ip, device, tz):
    token = secrets.token_hex(32)
    th_ = token_hash(token)
    now = int(time.time())
    is_new = not q1("SELECT 1 FROM sessions WHERE user_id=?", (user["id"],))      # первый вход этого аккаунта вообще
    run("INSERT INTO sessions(token,user_id,ip,country,device,created,last_used) VALUES(?,?,?,?,?,?,?)",
        (th_, user["id"], ip, "определяется…", device, now, now))
    run("""DELETE FROM sessions WHERE user_id=? AND token NOT IN
           (SELECT token FROM sessions WHERE user_id=? ORDER BY created DESC LIMIT ?)""",
        (user["id"], user["id"], MAX_SESSIONS))
    threading.Thread(target=finish_login, args=(user["id"], th_, ip, device, tz, is_new), daemon=True).start()
    return token


def pw_hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 150_000).hex()


def pw_ok(user, password):
    return bool(user.get("cloud_hash")) and hmac.compare_digest(pw_hash(password, user["cloud_salt"]), user["cloud_hash"])


@app.post("/api/auth/password")
def auth_password():
    """Второй шаг входа для аккаунтов с облачным паролем: {ticket, password}."""
    try:
        ip = client_ip()
        if not hit("pw_ip", ip, 20, 600):
            return err("Слишком много попыток. Попробуйте позже", 429)
        d = body()
        tid = token_hash(str(d.get("ticket", "")))
        t = q1("SELECT * FROM tickets WHERE id=?", (tid,))
        if not t or t["expires"] < time.time():
            return err("Время ввода пароля истекло. Войдите заново")
        user = q1("SELECT * FROM users WHERE id=?", (t["user_id"],))
        if not user or not user.get("cloud_hash"):
            return err("Войдите заново")
        if not hit("pw_user", user["id"], 8, 3600):
            run("DELETE FROM tickets WHERE id=?", (tid,))
            return err("Слишком много неверных паролей. Попробуйте через час", 429)
        if not pw_ok(user, str(d.get("password", ""))[:200]):
            return err("Неверный пароль")
        run("DELETE FROM tickets WHERE id=?", (tid,))
        token = create_session(user, t["ip"] or ip, t["device"] or "", t["tz"] or 0)
        return jsonify(ok=True, token=token, user=public(user, True))
    except Exception as e:
        print("Auth password error:", e)
        return err("Ошибка сервера", 500)


@app.post("/api/auth/logout")
def auth_logout():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    h = token_hash(get_token())
    run("DELETE FROM sessions WHERE token=?", (h,))
    for ws in list(clients.get(u["id"], [])):
        if ws_tok.get(ws) == h:
            try:
                ws.close()
            except Exception:
                pass
    return jsonify(ok=True)


# ───────────────────── ПРОФИЛЬ ─────────────────────
USER_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{3,30}[A-Za-z0-9]$")
RESERVED = {"telegram", "admin", "support", "botfather", "service", "official", "dicegram"}


def check_username(name, my_id):
    if not USER_RE.match(name):
        return "От 5 до 32 символов: латиница, цифры и _. Должно начинаться с буквы"
    if "__" in name:
        return "Нельзя использовать подряд два символа _"
    me_ = q1("SELECT * FROM users WHERE id=?", (my_id,)) or {}
    if name_reserved(name, me_):
        return "Это имя зарезервировано"
    if name_taken(name, skip_user=my_id):
        return "Это имя уже занято"
    return None


BDAY_RE = re.compile(r"^(\d{4}|-)-(\d{2})-(\d{2})$")


def clean_birthday(v):
    """'' — убрать; 'ГГГГ-ММ-ДД' или '--ММ-ДД' (без года). Возвращает строку или None, если дата неверна."""
    v = str(v or "").strip()
    if not v:
        return ""
    m = BDAY_RE.match(v)
    if not m:
        return None
    y, mo, dd = m.group(1), int(m.group(2)), int(m.group(3))
    try:
        if y == "-":
            datetime(2000, mo, dd)          # високосный год: 29 февраля допустимо
            return f"--{mo:02d}-{dd:02d}"
        yi = int(y)
        if yi < 1900:
            return None
        dt = datetime(yi, mo, dd)
        if dt > datetime.now() + timedelta(days=1):
            return None
        return f"{yi:04d}-{mo:02d}-{dd:02d}"
    except ValueError:
        return None


@app.get("/api/me")
def me():
    u = auth_user()
    return jsonify(ok=True, user=public(u, True)) if u else err("Требуется вход", 401)


@app.get("/api/username/check")
def username_check():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    name = request.args.get("u", "").strip().lstrip("@")
    e = check_username(name, u["id"])
    return jsonify(ok=True, available=e is None, reason=e or "")


@app.post("/api/me/update")
def me_update():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    name, username, bio = u["name"], u["username"], u["bio"]
    surname, birthday, bvis = u.get("surname") or "", u.get("birthday") or "", u.get("birthday_vis") or "contacts"
    if "name" in d:
        name = str(d["name"]).strip()[:64]
        if not name:
            return err("Введите имя")
    if "surname" in d:
        surname = str(d["surname"]).strip()[:64]
    if "birthday" in d:
        birthday = clean_birthday(d["birthday"])
        if birthday is None:
            return err("Неверная дата рождения")
    if "birthday_vis" in d:
        if d["birthday_vis"] not in ("all", "contacts", "none"):
            return err("Неверная настройка")
        bvis = d["birthday_vis"]
    if "bio" in d:
        bio = str(d["bio"]).strip()[:140 if is_premium(u) else 70]   # с Premium «О себе» длиннее
    if "username" in d:
        username = str(d["username"]).strip().lstrip("@")
        if username and username != u["username"]:
            e = check_username(username, u["id"])
            if e:
                return err(e)
    try:
        run("UPDATE users SET name=?, surname=?, username=?, bio=?, birthday=?, birthday_vis=? WHERE id=?",
            (name, surname, username, bio, birthday, bvis, u["id"]))
    except sqlite3.IntegrityError:
        return err("Это имя уже занято")
    nu = q1("SELECT * FROM users WHERE id=?", (u["id"],))
    notify_profile(u["id"])
    return jsonify(ok=True, user=public(nu, True))


@app.post("/api/me/avatar")
def avatar_set():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    m = re.match(r"^data:image/(jpeg|png|webp);base64,(.+)$", str(body().get("data", "")), re.S)
    if not m:
        return err("Неверный формат фото")
    try:
        raw = base64.b64decode(m.group(2), validate=True)
    except Exception:
        return err("Неверный формат фото")
    if len(raw) > 400_000:
        return err("Фото слишком большое")
    ext = ("jpg" if raw[:3] == b"\xff\xd8\xff" else "png" if raw[:8] == b"\x89PNG\r\n\x1a\n"
           else "webp" if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP" else None)
    if not ext:
        return err("Неверный формат фото")
    fname = f"{u['id']}_{secrets.token_hex(6)}.{ext}"
    with open(os.path.join(AVATAR_DIR, fname), "wb") as f:
        f.write(raw)
    old = u.get("avatar")
    run("UPDATE users SET avatar=? WHERE id=?", (fname, u["id"]))
    if old:
        try:
            os.remove(os.path.join(AVATAR_DIR, old))
        except OSError:
            pass
    nu = q1("SELECT * FROM users WHERE id=?", (u["id"],))
    notify_profile(u["id"])
    return jsonify(ok=True, user=public(nu, True))


@app.post("/api/me/avatar/remove")
def avatar_remove():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    if u.get("avatar"):
        try:
            os.remove(os.path.join(AVATAR_DIR, u["avatar"]))
        except OSError:
            pass
    run("UPDATE users SET avatar='' WHERE id=?", (u["id"],))
    nu = q1("SELECT * FROM users WHERE id=?", (u["id"],))
    notify_profile(u["id"])
    return jsonify(ok=True, user=public(nu, True))


@app.get("/avatar/<name>")
def avatar_get(name):
    if not re.fullmatch(r"g?\d+_[0-9a-f]{12}\.(jpg|png|webp)", name):
        return err("Не найдено", 404)
    r = send_from_directory(AVATAR_DIR, name)
    r.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return r


def hours_state(biz):
    """Открыто ли сейчас по графику работы: (есть_график, открыто)."""
    h = biz.get("hours")
    if not isinstance(h, dict) or not h.get("on") or not isinstance(h.get("days"), dict):
        return False, False
    try:
        tz = max(-840, min(840, int(h.get("tz", 0))))        # минуты к UTC (как у JS: getTimezoneOffset с обратным знаком)
    except (TypeError, ValueError):
        tz = 0
    now = datetime.now(timezone.utc) + timedelta(minutes=tz)
    mins = now.hour * 60 + now.minute
    for a, b in (h["days"].get(str(now.weekday())) or []):
        if isinstance(a, int) and isinstance(b, int) and a <= mins < b:
            return True, True
    return True, False


def biz_public(u):
    """Что видят другие в профиле бизнес-аккаунта (только пока активен Premium)."""
    if not is_premium(u):
        return None
    b = biz_of(u)
    out = {}
    if b.get("address"):
        out["address"] = str(b["address"])[:200]
    has, openn = hours_state(b)
    if has:
        out["hours"] = {"days": b["hours"]["days"], "tz": b["hours"].get("tz", 0), "open": openn}
    return out or None


@app.get("/api/user/<int:uid>")
def user_get(uid):
    viewer = auth_user()
    if not viewer:
        return err("Требуется вход", 401)
    u = q1("SELECT * FROM users WHERE id=?", (uid,))
    if not u:
        return err("Не найдено", 404)
    me_ = u["id"] == viewer["id"]
    out = public(u, me_, viewer=viewer["id"])
    out["birthday"] = birthday_for(u, viewer["id"])
    bp = biz_public(u)
    if bp:
        out["biz"] = bp
    out["rating"] = rating_of(u)
    if u["username"]:
        out["plink"] = link_url(u["username"], "u")
    out["gifts_n"] = q1("SELECT COUNT(*) n FROM gifts WHERE to_id=? AND shown=1", (uid,))["n"]
    pc = pchan_out(u, viewer["id"])
    if pc:
        out["pchan"] = pc
    if not me_ and not u["is_system"]:
        out["saved"] = bool(q1("SELECT 1 FROM saved_contacts WHERE owner=? AND contact=?", (viewer["id"], uid)))
        out["blocked"] = is_blocked(viewer["id"], uid)
        out["blocked_me"] = is_blocked(uid, viewer["id"])
        out["common"] = q1("""SELECT COUNT(*) n FROM chat_members a JOIN chat_members b ON a.chat_id=b.chat_id JOIN chats c ON c.id=a.chat_id
                              WHERE a.user_id=? AND b.user_id=? AND c.kind='group'""", (viewer["id"], uid))["n"]
    return jsonify(ok=True, user=out)


@app.get("/api/user/<int:uid>/common")
def user_common(uid):
    viewer = auth_user()
    if not viewer:
        return err("Требуется вход", 401)
    rows = qa("""SELECT c.* FROM chat_members a JOIN chat_members b ON a.chat_id=b.chat_id JOIN chats c ON c.id=a.chat_id
                 WHERE a.user_id=? AND b.user_id=? AND c.kind='group' ORDER BY c.id DESC LIMIT 100""", (viewer["id"], uid))
    return jsonify(ok=True, chats=[chat_public(c, member_row(c["id"], viewer["id"])) for c in rows])


@app.get("/api/sessions")
def sessions():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    cur = token_hash(get_token())
    live = {ws_tok.get(w) for w in clients.get(u["id"], ())}
    rows = qa("SELECT token,ip,country,device,created,last_used FROM sessions WHERE user_id=? ORDER BY created DESC", (u["id"],))
    return jsonify(ok=True, sessions=[{"id": r["token"][:16], "ip": r["ip"], "country": r["country"], "device": r["device"],
                                       "created": r["created"], "last": r["last_used"] or r["created"],
                                       "online": r["token"] in live, "current": r["token"] == cur} for r in rows])


@app.post("/api/sessions/terminate_others")
def sessions_terminate():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    cur = token_hash(get_token())
    run("DELETE FROM sessions WHERE user_id=? AND token!=?", (u["id"], cur))
    kick(u["id"], keep=cur)
    return jsonify(ok=True)


@app.post("/api/sessions/terminate")
def session_terminate():
    """Завершить один чужой сеанс: {id}."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    sid = str(body().get("id", ""))
    if not re.fullmatch(r"[0-9a-f]{16}", sid):
        return err("Сеанс не найден", 404)
    cur = token_hash(get_token())
    row = q1("SELECT token FROM sessions WHERE user_id=? AND substr(token,1,16)=?", (u["id"], sid))
    if not row:
        return err("Сеанс не найден", 404)
    if row["token"] == cur:
        return err("Чтобы выйти из этого сеанса, используйте «Выйти»")
    run("DELETE FROM sessions WHERE token=?", (row["token"],))
    for ws in list(clients.get(u["id"], [])):
        if ws_tok.get(ws) == row["token"]:
            try:
                ws.close()
            except Exception:
                pass
    return jsonify(ok=True)


@app.get("/api/unread")
def unread():
    """Сколько непрочитанных у аккаунта — для значка в списке «Аккаунты»."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    sweep_expired()
    r = q1("SELECT COUNT(*) n, COUNT(DISTINCT sender) c FROM messages WHERE receiver=? AND is_read=0 AND del_r=0", (u["id"],))
    gu = group_unread(u["id"])
    return jsonify(ok=True, unread=r["n"] + sum(gu.values()), chats=r["c"] + len([1 for v in gu.values() if v]))


# ───────────────────── БЕЗОПАСНОСТЬ И ПРИВАТНОСТЬ ─────────────────────
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$")


def clean_email(v):
    """Адрес почты или None, если он неверный. Проверяем форму и частые ошибки (точки подряд, точка по краям, дефис в начале домена)."""
    v = str(v or "").strip()
    if len(v) > 120 or not EMAIL_RE.match(v):
        return None
    local, domain = v.rsplit("@", 1)
    if ".." in v or local.startswith(".") or local.endswith("."):
        return None
    return local + "@" + domain.lower()


@app.post("/api/me/cloud")
def me_cloud():
    """Облачный пароль: {action: set|change|remove|hint, password, current, hint}."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    if not hit("cloud", u["id"], 12, 600):
        return err("Слишком много попыток. Подождите немного", 429)
    d = body()
    act = d.get("action")
    pw, cur, hint = str(d.get("password", "")), str(d.get("current", "")), str(d.get("hint", "")).strip()[:64]
    has = bool(u.get("cloud_hash"))
    if act in ("change", "remove", "hint") and not has:
        return err("Облачный пароль не установлен")
    if has and act in ("set", "change", "remove", "hint") and not pw_ok(u, cur):
        return err("Неверный текущий пароль")
    if act == "remove":
        run("UPDATE users SET cloud_hash='', cloud_salt='', cloud_hint='' WHERE id=?", (u["id"],))
    elif act in ("set", "change"):
        if len(pw) < 4 or len(pw) > 64:
            return err("Пароль: от 4 до 64 символов")
        if hint and hint.lower() == pw.lower():
            return err("Подсказка не должна совпадать с паролем")
        salt = secrets.token_hex(16)
        run("UPDATE users SET cloud_hash=?, cloud_salt=?, cloud_hint=? WHERE id=?", (pw_hash(pw, salt), salt, hint, u["id"]))
    elif act == "hint":
        if hint and hint.lower() == cur.lower():
            return err("Подсказка не должна совпадать с паролем")
        run("UPDATE users SET cloud_hint=? WHERE id=?", (hint, u["id"]))
    else:
        return err("Неизвестное действие")
    return jsonify(ok=True, user=public(q1("SELECT * FROM users WHERE id=?", (u["id"],)), True))


@app.post("/api/me/email")
def me_email():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    raw = str(body().get("email", "")).strip()
    em = "" if not raw else clean_email(raw)
    if em is None:
        return err("Неверный адрес почты. Пример: name@gmail.com")
    run("UPDATE users SET login_email=? WHERE id=?", (em, u["id"]))
    return jsonify(ok=True, user=public(q1("SELECT * FROM users WHERE id=?", (u["id"],)), True))


@app.post("/api/me/privacy")
def me_privacy():
    """{key: phone|seen|photo|fwd|calls|bio|birthday, value: all|contacts|none}"""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    key, val = d.get("key"), d.get("value")
    if val not in PRIV_VALUES or key not in PRIV_KEYS + ("birthday",):
        return err("Неверная настройка")
    if key == "birthday":
        run("UPDATE users SET birthday_vis=? WHERE id=?", (val, u["id"]))
    else:
        p = priv_of(u)
        p[key] = val
        run("UPDATE users SET priv=? WHERE id=?", (json.dumps(p), u["id"]))
    nu = q1("SELECT * FROM users WHERE id=?", (u["id"],))
    notify_profile(u["id"])
    return jsonify(ok=True, user=public(nu, True))


@app.post("/api/me/autodelete")
def me_autodelete():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    sec = num(body().get("seconds"), 0, AUTO_DEL_MAX)
    if sec is None or (0 < sec < 60):
        return err("Срок: от 1 минуты до года")
    run("UPDATE users SET auto_del=? WHERE id=?", (sec, u["id"]))
    return jsonify(ok=True, user=public(q1("SELECT * FROM users WHERE id=?", (u["id"],)), True))


@app.post("/api/prefs")
def prefs_set():
    """Настройки, которые синхронизируются между устройствами (папки, уведомления…): {set: {ключ: значение|null}}."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch = body().get("set")
    if not isinstance(ch, dict) or len(ch) > 20:
        return err("Неверные данные")
    cur = json_load(u.get("prefs"), {})
    for k, v in ch.items():
        if not re.fullmatch(r"[a-z_]{1,24}", str(k)):
            return err("Неверный ключ")
        if v is None:
            cur.pop(k, None)
        else:
            cur[k] = v
    raw = json.dumps(cur, ensure_ascii=False, separators=(",", ":"))
    if len(raw) > PREFS_MAX:
        return err("Слишком много данных в настройках")
    run("UPDATE users SET prefs=? WHERE id=?", (raw, u["id"]))
    return jsonify(ok=True, prefs=cur)


# ───────────────────── ЧАТЫ ─────────────────────
@app.get("/api/chats")
def chats():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    me_ = u["id"]
    sweep_expired()
    try:
        rows = qa("""SELECT m.*, CASE WHEN m.sender=:me THEN m.receiver ELSE m.sender END AS peer
                     FROM messages m WHERE m.id IN (
                       SELECT MAX(id) FROM messages
                       WHERE ((sender=:me AND del_s=0) OR (receiver=:me AND del_r=0)) AND receiver>0
                       GROUP BY CASE WHEN sender=:me THEN receiver ELSE sender END)
                     ORDER BY m.id DESC""", {"me": me_})
        unread = {r["sender"]: r["n"] for r in qa(
            "SELECT sender, COUNT(*) n FROM messages WHERE receiver=? AND is_read=0 AND del_r=0 GROUP BY sender", (me_,))}
        ids = [r["peer"] for r in rows]
        peers = {}
        if ids:
            for p in qa(f"SELECT * FROM users WHERE id IN ({','.join('?' * len(ids))})", ids):
                peers[p["id"]] = p
        lasts = ser_many(rows, me_)
        out = []
        for r, last in zip(rows, lasts):
            p = peers.get(r["peer"])
            if not p:
                continue
            out.append({"peer": public(p, viewer=me_, contact=True), "last": last, "unread": unread.get(r["peer"], 0)})
        gi = group_chat_items(me_)
        if gi:
            glasts = ser_many([x[0] for x in gi], me_)
            for (_, peer_, un_), last in zip(gi, glasts):
                out.append({"peer": peer_, "last": last, "unread": un_})
            out.sort(key=lambda c: c["last"]["id"], reverse=True)
        return jsonify(ok=True, chats=out)
    except Exception as e:
        print("Chats error:", e)
        return err("Ошибка загрузки чатов", 500)


@app.get("/api/contacts")
def contacts_list():
    """Люди, с которыми есть переписка (их можно добавлять в группы и каналы)."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ids = [i for i in contacts(u["id"]) if i != u["id"]]
    out = []
    if ids:
        for r in qa(f"SELECT * FROM users WHERE id IN ({','.join('?' * len(ids))}) AND is_system=0", ids):
            out.append(public(r, viewer=u["id"], contact=True))
    out.sort(key=lambda x: ((x.get("name") or "") + " " + (x.get("surname") or "")).strip().lower())
    return jsonify(ok=True, contacts=out)


@app.get("/api/messages/<int(signed=True):peer>")
def messages(peer):
    """?before=<id>&limit=<n> — пагинация назад по истории. Без before — последние сообщения
    (и входящие при этом помечаются прочитанными), плюс список закреплённых."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    if peer < 0:
        return g_messages(u, -peer)
    sweep_expired()
    try:
        before = request.args.get("before", type=int)
        limit = max(1, min(request.args.get("limit", 200, type=int), 200))
        if before is None and not request.args.get("peek"):     # peek=1 — «тихий» просмотр: собеседник не увидит, что вы прочитали
            cur = run("UPDATE messages SET is_read=1 WHERE sender=? AND receiver=? AND is_read=0", (peer, u["id"]))
            if cur.rowcount:
                push(peer, {"type": "read", "by": u["id"]})
        raw_msgs = qa("""SELECT * FROM messages
                         WHERE ((sender=? AND receiver=? AND del_s=0) OR (sender=? AND receiver=? AND del_r=0)) AND id < ?
                         ORDER BY id DESC LIMIT ?""",
                      (u["id"], peer, peer, u["id"], before or 2 ** 62, limit))[::-1]
        resp = {"ok": True, "messages": ser_many(raw_msgs, u["id"]), "has_more": len(raw_msgs) == limit}
        if before is None or request.args.get("pins"):
            resp["pins"] = pins_for(u["id"], peer)
        return jsonify(resp)
    except Exception as e:
        print("Messages error:", e)
        return err("Ошибка загрузки сообщений", 500)


@app.post("/api/read/<int(signed=True):peer>")
def read_peer(peer):
    """Пометить входящие от peer прочитанными — без повторной загрузки всей переписки."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    if not hit("read", u["id"], 120, 10):
        return err("Слишком часто", 429)
    if peer < 0:
        if member_row(-peer, u["id"]):
            mark_group_read(-peer, u["id"])
        return jsonify(ok=True, marked=0)
    cur = run("UPDATE messages SET is_read=1 WHERE sender=? AND receiver=? AND is_read=0", (peer, u["id"]))
    if cur.rowcount:
        push(peer, {"type": "read", "by": u["id"]})
    return jsonify(ok=True, marked=cur.rowcount)


@app.post("/api/send")
def send():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    try:
        to = int(d.get("to", 0))
    except (TypeError, ValueError):
        to = 0
    cid = str(d.get("cid", ""))
    cid = cid if re.fullmatch(r"[\w-]{1,40}", cid) else None
    if to < 0:
        return g_send(u, to, d, cid)
    peer = q1("SELECT id FROM users WHERE id=?", (to,))
    if not peer or to == u["id"]:
        return err("Нельзя отправить")
    be = block_err(u["id"], to)
    if be:
        return err(be, 403)
    try:
        kind, text, ents, att, reply_to = parse_payload(u, d, to)
    except ValueError as e:
        return err(str(e))
    if not hit("send", u["id"], 20, 10):
        return err("Слишком часто. Подождите пару секунд", 429)
    msg = add_message(u["id"], to, text, cid, kind, ents, att, reply_to)
    try:
        biz_auto_reply(u["id"], to)
    except Exception as e:
        print("biz auto reply:", e)
    return jsonify(ok=True, message=msg)


def other_of(row, uid):
    return row["receiver"] if row["sender"] == uid else row["sender"]


def mine_row(mid, uid):
    """Сообщение, в котором участвует пользователь и которое он ещё видит."""
    r = q1("SELECT * FROM messages WHERE id=?", (mid,))
    if not r:
        return None
    if r["receiver"] < 0:                                  # сообщение группы или канала: видит участник, начиная с момента входа
        m = member_row(-r["receiver"], uid)
        return r if m and r["id"] >= m["first_id"] and vis(r, uid) else None
    if uid not in (r["sender"], r["receiver"]):
        return None
    return r if vis(r, uid) else None


@app.post("/api/edit")
def edit():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    row = mine_row(num(d.get("id"), 1, 2 ** 62) or 0, u["id"])
    if not row:
        return err("Сообщение не найдено", 404)
    if row["sender"] != u["id"]:
        gch = chat_row(-row["receiver"]) if row["receiver"] < 0 else None
        if not gch or gch["kind"] != "channel" or not has_right(gch, member_row(gch["id"], u["id"]), "edit"):
            return err("Сообщение не найдено", 404)
    kind = row.get("kind") or "text"
    if kind in ("voice", "sticker", "svc", "call", "greet"):
        return err("Это сообщение нельзя изменить")
    text = str(d.get("text", ""))[:4000 if kind == "text" else 1024]
    if kind == "text" and not text.strip():
        return err("Пустое сообщение")
    if not text.strip():
        text = ""
    ents = clean_ents(d.get("ents"), utf16len(text), u) if text else []
    meta = meta_load(row["meta"])
    if text == decrypt_text(row["text"]) and ents == (meta.get("e") or []):
        return jsonify(ok=True, message=ser_one(row, u["id"]))
    if not hit("edit", u["id"], 30, 10):
        return err("Слишком часто", 429)
    meta["e"] = ents or None
    run("UPDATE messages SET text=?, meta=?, edited=? WHERE id=?", (encrypt_text(text), meta_dump(meta), int(time.time()), row["id"]))
    row = q1("SELECT * FROM messages WHERE id=?", (row["id"],))
    for v in audience(row):
        if clients.get(v):
            push(v, {"type": "edit", "message": ser_one(row, v)})
    return jsonify(ok=True, message=ser_one(row, u["id"]))


@app.post("/api/delete")
def delete():
    """{ids:[...], all:true} — удалить у всех (только свои сообщения); без all — только у меня."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    uid = u["id"]
    ids = [n for n in (num(x, 1, 2 ** 62) for x in (d.get("ids") or [])[:100] if isinstance(d.get("ids"), list)) if n]
    if not ids:
        return err("Нечего удалять")
    everyone = bool(d.get("all"))
    grows = qa(f"SELECT * FROM messages WHERE id IN ({','.join('?' * len(ids))}) AND receiver<0", ids)
    if grows:                                     # группы и каналы: сообщения удаляются у всех сразу
        done, e_ = g_delete(u, grows)
        if e_ and not done:
            return err(e_, 403)
        ids = [i for i in ids if i not in {g["id"] for g in grows}]
        if not ids:
            return jsonify(ok=True, ids=done)
    rows = [r for r in qa(f"SELECT * FROM messages WHERE id IN ({','.join('?' * len(ids))}) AND (sender=? OR receiver=?)",
                          ids + [uid, uid]) if vis(r, uid)]
    if everyone and any(r["sender"] != uid for r in rows):
        return err("Удалить у всех можно только свои сообщения", 403)
    hard, soft, fids, peers = [], [], [], set()
    with db_lock:
        for r in rows:
            peers.add(other_of(r, uid))
            col = "del_s" if r["sender"] == uid else "del_r"
            both = everyone or bool(r.get("del_r" if col == "del_s" else "del_s"))
            if both:
                run("DELETE FROM messages WHERE id=?", (r["id"],))
                run("DELETE FROM reacts WHERE msg_id=?", (r["id"],))
                fids += [r.get("fid"), r.get("tfid")]
                hard.append(r["id"])
                if not everyone:
                    soft.append(r["id"])   # у собеседника уже было удалено «у меня» — теперь сообщение стёрто совсем
            else:
                run(f"UPDATE messages SET {col}=1 WHERE id=?", (r["id"],))
                soft.append(r["id"])
    gc_files(fids)
    if everyone and hard:
        for p in peers | {uid}:
            push(p, {"type": "del", "ids": hard})
    elif soft:
        push(uid, {"type": "del", "ids": soft})
    return jsonify(ok=True, ids=hard if everyone else soft)


@app.post("/api/react")
def react():
    """{id, emoji, mode?}: mode="toggle" — поставить/снять эту реакцию (до 3 на сообщение с Premium, иначе одна);
    без mode — заменить все свои реакции на эту; emoji="" — снять все свои."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    uid = u["id"]
    row = mine_row(num(d.get("id"), 1, 2 ** 62) or 0, uid)
    if not row:
        return err("Сообщение не найдено", 404)
    emoji = str(d.get("emoji") or "")[:16]
    if emoji.startswith("c:"):
        cid_ = num(emoji[2:], 1, 2 ** 62)
        if not cid_ or not can_use_emoji(u, cid_):
            return err("Свои эмодзи в реакциях доступны только с Premium", 403)
        emoji = "c:" + str(cid_)
    elif emoji and ord(emoji[0]) < 0x80:
        return err("Нельзя поставить такую реакцию")
    if row["receiver"] < 0 and emoji:
        rch = chat_row(-row["receiver"])
        if not rch or (row.get("kind") in ("svc", "greet", "call")):
            return err("Нельзя поставить такую реакцию")
        if rch["react_mode"] == "none":
            return err("В этом чате реакции отключены")
        if rch["react_mode"] == "some" and emoji not in json_load(rch.get("react_list"), []):
            return err("Такая реакция здесь не разрешена")
    if not hit("react", uid, 40, 10):
        return err("Слишком часто", 429)
    limit = 3 if is_premium(u) else 1
    now_ms = int(time.time() * 1000)
    if not emoji:
        run("DELETE FROM reacts WHERE msg_id=? AND user_id=?", (row["id"], uid))
    elif d.get("mode") == "toggle":
        if q1("SELECT 1 FROM reacts WHERE msg_id=? AND user_id=? AND emoji=?", (row["id"], uid, emoji)):
            run("DELETE FROM reacts WHERE msg_id=? AND user_id=? AND emoji=?", (row["id"], uid, emoji))
        else:
            mine = qa("SELECT emoji FROM reacts WHERE msg_id=? AND user_id=? ORDER BY ts", (row["id"], uid))
            while len(mine) >= limit:                                           # лишнее: самая давняя реакция заменяется
                run("DELETE FROM reacts WHERE msg_id=? AND user_id=? AND emoji=?", (row["id"], uid, mine.pop(0)["emoji"]))
            run("INSERT OR REPLACE INTO reacts(msg_id,user_id,emoji,ts) VALUES(?,?,?,?)", (row["id"], uid, emoji, now_ms))
    else:
        run("DELETE FROM reacts WHERE msg_id=? AND user_id=?", (row["id"], uid))
        run("INSERT OR REPLACE INTO reacts(msg_id,user_id,emoji,ts) VALUES(?,?,?,?)", (row["id"], uid, emoji, now_ms))
    for v in audience(row):
        if clients.get(v):
            push(v, {"type": "react", "id": row["id"], "reacts": reacts_for(row["id"], v), "by": uid, "emoji": emoji})
    return jsonify(ok=True, reacts=reacts_for(row["id"], uid), max=limit)


@app.post("/api/pin")
def pin():
    """Закрепить/открепить сообщение — для обоих участников переписки."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    uid = u["id"]
    row = mine_row(num(d.get("id"), 1, 2 ** 62) or 0, uid)
    if not row:
        return err("Сообщение не найдено", 404)
    val = int(time.time() * 1000) if d.get("pin") else 0
    if row["receiver"] < 0:
        pch = chat_row(-row["receiver"])
        if not pch or not can_do(pch, member_row(pch["id"], uid), "pin"):
            return err("Нет прав закреплять сообщения", 403)
        if row.get("kind") in ("svc", "greet", "call"):
            return err("Это сообщение нельзя закрепить")
    if val:
        if row["receiver"] < 0:
            n = q1("SELECT COUNT(*) n FROM messages WHERE pin>0 AND receiver=?", (row["receiver"],))
        else:
            n = q1("""SELECT COUNT(*) n FROM messages WHERE pin>0 AND ((sender=? AND receiver=?) OR (sender=? AND receiver=?))""",
                   (uid, other_of(row, uid), other_of(row, uid), uid))
        if n and n["n"] >= 30:
            return err("Можно закрепить не больше 30 сообщений")
    run("UPDATE messages SET pin=? WHERE id=?", (val, row["id"]))
    for v in audience(row):
        if clients.get(v):
            push(v, {"type": "pin", "id": row["id"], "pin": val, "by": uid})
    return jsonify(ok=True, pin=val)


@app.post("/api/forward")
def forward():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    uid = u["id"]
    to = num(d.get("to"), -2 ** 62, 2 ** 62)
    tch = tm = None
    if to and to < 0:
        tch = chat_row(-to)
        tm = member_row(tch["id"], uid) if tch else None
        if not tch or not tm or not can_write(tch, tm):
            return err("Нельзя переслать")
    elif not to or to == uid or not q1("SELECT id FROM users WHERE id=?", (to,)):
        return err("Нельзя переслать")
    elif block_err(uid, to):
        return err(block_err(uid, to), 403)
    ids = sorted({n for n in (num(x, 1, 2 ** 62) for x in (d.get("ids") or [])[:20]) if n}) if isinstance(d.get("ids"), list) else []
    sent = []
    for mid in ids:
        r = mine_row(mid, uid)
        if not r:
            continue
        if not hit("send", uid, 20, 10):
            return err("Слишком часто. Подождите пару секунд", 429)
        if r.get("kind") in ("svc", "call", "greet"):
            continue
        meta = meta_load(r["meta"])
        fw = meta.get("fw")
        if not fw:
            src = chat_row(-r["receiver"]) if r["receiver"] < 0 else None
            if src and src["kind"] == "channel":
                fw = {"id": -src["id"], "name": src["title"]}
            else:
                a = q1("SELECT * FROM users WHERE id=?", (r["sender"],))
                fw = {"id": r["sender"], "name": (a and (a["name"] or "Пользователь")) or "Пользователь"}
        if tch:
            try:
                check_post(tch, tm, r.get("kind") or "text", decrypt_text(r["text"]), meta.get("a"))
            except ValueError as e:
                return err(str(e))
            sent.append(add_gmessage(tch, uid, decrypt_text(r["text"]), None, r.get("kind") or "text", meta.get("e"), meta.get("a"), None, fw))
            run("UPDATE chat_members SET last_send=? WHERE chat_id=? AND user_id=?", (int(time.time()), tch["id"], uid))
        else:
            sent.append(add_message(uid, to, decrypt_text(r["text"]), None, r.get("kind") or "text", meta.get("e"), meta.get("a"), None, fw))
    if not sent:
        return err("Сообщения не найдены", 404)
    return jsonify(ok=True, messages=sent)


# ───────────────────── ФАЙЛЫ (загрузка кусками) ─────────────────────
@app.post("/api/upload/init")
def upload_init():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    if not hit("upl", u["id"], 40, 60):
        return err("Слишком много загрузок. Подождите минуту", 429)
    d = body()
    name = re.sub(r"[\\/\x00-\x1f]", "_", str(d.get("name") or "file")).strip()[:120] or "file"
    size = num(d.get("size"), 1, 2 ** 40)
    if not size:
        return err("Пустой файл")
    if size > MAX_UPLOAD:
        return err(f"Файл слишком большой (максимум {MAX_UPLOAD // 1048576} МБ)")
    mime = str(d.get("mime") or "")[:100].lower()
    if not MIME_RE.match(mime):
        mime = "application/octet-stream"
    fid = secrets.token_hex(16)
    run("INSERT INTO files(fid,owner,name,size,mime,ts) VALUES(?,?,?,?,?,?)", (fid, u["id"], name, size, mime, int(time.time())))
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    open(file_path(fid), "wb").close()
    return jsonify(ok=True, fid=fid, chunk=CHUNK)


@app.get("/api/upload/<fid>")
def upload_state(fid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    f = q1("SELECT * FROM files WHERE fid=? AND owner=?", (fid, u["id"])) if FID_RE.match(fid) else None
    if not f:
        return err("Файл не найден", 404)
    return jsonify(ok=True, got=f["got"], size=f["size"], done=bool(f["done"]))


@app.post("/api/upload/<fid>")
def upload_chunk(fid):
    """Тело запроса — очередной кусок (любого размера, клиент берёт 0,25–4 МБ); ?off= — смещение. Когда набрался весь размер, файл готов."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    off = request.args.get("off", type=int)
    data = request.get_data(cache=False)
    with db_lock:
        f = q1("SELECT * FROM files WHERE fid=? AND owner=?", (fid, u["id"])) if FID_RE.match(fid) else None
        if not f:
            return err("Файл не найден", 404)
        if f["done"]:
            return jsonify(ok=True, got=f["got"], done=True)
        if off != f["got"]:
            return jsonify(ok=False, error="Сбой порядка кусков", got=f["got"]), 409
        if not data or f["got"] + len(data) > f["size"]:
            return err("Неверный размер куска")
        with open(file_path(fid), "r+b") as fh:
            fh.seek(off)
            fh.write(data)
        got = off + len(data)
        done = 1 if got == f["size"] else 0
        run("UPDATE files SET got=?, done=? WHERE fid=?", (got, done, fid))
    return jsonify(ok=True, got=got, done=bool(done))


@app.get("/api/f/<fid>")
def file_get(fid):
    """Отдача файла. Доступ — по подписанной ссылке (?u=&e=&s=) или по токену. ?dl=1 — скачать."""
    f = q1("SELECT * FROM files WHERE fid=? AND done=1", (fid,)) if FID_RE.match(fid) else None
    if not f:
        return err("Файл не найден", 404)
    uid = request.args.get("u", type=int)
    exp = request.args.get("e", type=int)
    sig = request.args.get("s", "")
    ok = False
    if uid and exp and sig and exp > time.time() and hmac.compare_digest(sig, file_sig(fid, uid, exp)):
        ok = can_access(uid, fid)
    else:
        a = auth_user()
        ok = bool(a) and can_access(a["id"], fid)
    if not ok:
        return err("Нет доступа", 403)
    safe = f["mime"].startswith(INLINE_MIME)
    inline = safe and request.args.get("dl") != "1"
    resp = send_file(file_path(fid), mimetype=f["mime"] if safe else "application/octet-stream", as_attachment=not inline,
                     download_name=f["name"], conditional=True, etag=True, max_age=86400)
    resp.headers["Cache-Control"] = "private, max-age=86400"
    resp.headers["Content-Security-Policy"] = "default-src 'none'; sandbox"
    return resp


# ───────────────────── ПУБЛИКАЦИИ (истории на 6–48 часов + архив) ─────────────────────
STORY_HOURS = (6, 12, 24, 48)
STORY_ACTIVE_MAX = 50                # одновременно активных публикаций у одного человека
STORY_ARCHIVE_MAX = 300              # сколько истёкших хранится в архиве (старые удаляются)
STORY_VIDEO_MS = 60_000              # максимальная длина видео


def story_visible(st, viewer):
    """Видит ли viewer публикацию: автор — всегда (и в архиве), остальные — только пока она не истекла."""
    if st["owner"] == viewer:
        return True
    if st["exp"] <= time.time():
        return False
    return st["aud"] == 0 or is_contact(viewer, st["owner"])


def story_out(st, viewer, seen=None, views=None):
    d = {"id": st["id"], "owner": st["owner"], "kind": st["kind"], "url": file_url(st["fid"], viewer),
         "turl": file_url(st["tfid"], viewer) if st["tfid"] else "", "w": st["w"] or 0, "h": st["h"] or 0,
         "dur": st["dur"] or 0, "cap": decrypt_text(st["cap"]), "ts": st["ts"], "exp": st["exp"], "aud": st["aud"],
         "active": st["exp"] > time.time()}
    if seen is not None:
        d["seen"] = seen
    if views is not None:
        d["views"] = views
    return d


def story_files_ok(f, owner):
    return bool(f) and f["owner"] == owner and f["mime"].startswith(INLINE_MIME)


@app.post("/api/story")
def story_add():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    if not hit("story", u["id"], 30, 3600):
        return err("Слишком много публикаций. Попробуйте позже", 429)
    d = body()
    fid = str(d.get("fid") or "")
    f = file_row(fid, u["id"])
    if not story_files_ok(f, u["id"]) or not (f["mime"].startswith("image/") or f["mime"].startswith("video/")):
        return err("Можно публиковать фото и видео (JPG, PNG, WebP, GIF, MP4, WebM)")
    kind = "photo" if f["mime"].startswith("image/") else "video"
    tfid = str(d.get("tfid") or "")
    if tfid:
        tf = file_row(tfid, u["id"])
        if not story_files_ok(tf, u["id"]) or not tf["mime"].startswith("image/"):
            tfid = ""
    hours = num(d.get("hours"), 1, 48)
    if hours not in STORY_HOURS:
        hours = 24
    aud = 1 if d.get("aud") in (1, "1") else 0
    cap = str(d.get("cap") or "").strip()[:200]
    dur = num(d.get("dur"), 0, 3600 * 1000) or 0
    if kind == "video" and dur > STORY_VIDEO_MS + 1500:
        return err("Видео для публикации — не длиннее 60 секунд")
    now = int(time.time())
    with db_lock:
        n = q1("SELECT COUNT(*) n FROM stories WHERE owner=? AND exp>?", (u["id"], now))["n"]
        if n >= STORY_ACTIVE_MAX:
            return err(f"Одновременно можно держать до {STORY_ACTIVE_MAX} публикаций")
        cur = run("INSERT INTO stories(owner,fid,tfid,kind,w,h,dur,cap,aud,ts,exp) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                  (u["id"], fid, tfid or None, kind, num(d.get("w"), 1, 20000) or 0, num(d.get("h"), 1, 20000) or 0, dur,
                   encrypt_text(cap), aud, now, now + hours * 3600))
        st = q1("SELECT * FROM stories WHERE id=?", (cur.lastrowid,))
    notify_contacts(u["id"], {"type": "story", "user": u["id"]})
    return jsonify(ok=True, story=story_out(st, u["id"], views=0))


def view_counts(ids):
    if not ids:
        return {}
    rows = qa(f"SELECT story_id, COUNT(*) n FROM story_views WHERE story_id IN ({','.join('?' * len(ids))}) GROUP BY story_id", ids)
    return {r["story_id"]: r["n"] for r in rows}


def own_stories(uid):
    now = int(time.time())
    active = qa("SELECT * FROM stories WHERE owner=? AND exp>? ORDER BY ts ASC, id ASC", (uid, now))
    archive = qa("SELECT * FROM stories WHERE owner=? AND exp<=? ORDER BY ts DESC, id DESC LIMIT ?", (uid, now, STORY_ARCHIVE_MAX))
    vc = view_counts([s_["id"] for s_ in active + archive])
    return ([story_out(x, uid, views=vc.get(x["id"], 0)) for x in active],
            [story_out(x, uid, views=vc.get(x["id"], 0)) for x in archive])


@app.get("/api/stories/me")
def stories_me():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    active, archive = own_stories(u["id"])
    return jsonify(ok=True, active=active, archive=archive)


@app.get("/api/stories/user/<int:uid>")
def stories_user(uid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    if uid == u["id"]:
        return jsonify(ok=True, stories=own_stories(uid)[0])
    now = int(time.time())
    rows = [x for x in qa("SELECT * FROM stories WHERE owner=? AND exp>? ORDER BY ts ASC, id ASC", (uid, now)) if story_visible(x, u["id"])]
    seen = {r["story_id"] for r in qa(f"SELECT story_id FROM story_views WHERE viewer=? AND story_id IN ({','.join('?' * len(rows))})",
                                      [u["id"]] + [x["id"] for x in rows])} if rows else set()
    return jsonify(ok=True, stories=[story_out(x, u["id"], seen=x["id"] in seen) for x in rows])


@app.get("/api/stories/feed")
def stories_feed():
    """Кто из собеседников (и я сам) сейчас выложил публикации: для колец вокруг аватарок."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    now = int(time.time())
    me_ = u["id"]
    mine = q1("SELECT COUNT(*) n FROM stories WHERE owner=? AND exp>?", (me_, now))["n"]
    cs = contacts(me_)
    users = []
    if cs:
        ph = ",".join("?" * len(cs))
        rows = qa(f"""SELECT owner, COUNT(*) n, MAX(ts) last,
                             SUM(CASE WHEN id IN (SELECT story_id FROM story_views WHERE viewer=?) THEN 0 ELSE 1 END) unseen
                      FROM stories WHERE exp>? AND owner IN ({ph}) GROUP BY owner ORDER BY last DESC""", [me_, now] + cs)
        urows = {r["id"]: r for r in qa(f"SELECT * FROM users WHERE id IN ({ph})", cs)}
        for r in rows:
            if r["owner"] in urows:
                users.append({"id": r["owner"], "count": r["n"], "unseen": r["unseen"] or 0, "last": r["last"], "user": public(urows[r["owner"]], viewer=me_, contact=True)})
    return jsonify(ok=True, mine=mine, users=users)


@app.post("/api/story/<int:sid>/view")
def story_view(sid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    if not hit("sview", u["id"], 400, 60):
        return err("Слишком часто", 429)
    st = q1("SELECT * FROM stories WHERE id=?", (sid,))
    if not st or not story_visible(st, u["id"]):
        return err("Публикация не найдена", 404)
    if st["owner"] != u["id"] and st["exp"] > time.time():
        run("INSERT OR IGNORE INTO story_views(story_id,viewer,ts) VALUES(?,?,?)", (sid, u["id"], int(time.time())))
    return jsonify(ok=True)


@app.get("/api/story/<int:sid>/views")
def story_views_list(sid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    st = q1("SELECT * FROM stories WHERE id=? AND owner=?", (sid, u["id"]))
    if not st:
        return err("Публикация не найдена", 404)
    rows = qa("SELECT viewer, ts FROM story_views WHERE story_id=? ORDER BY ts DESC LIMIT 200", (sid,))
    ids = [r["viewer"] for r in rows]
    people = {x["id"]: x for x in qa(f"SELECT * FROM users WHERE id IN ({','.join('?' * len(ids))})", ids)} if ids else {}
    return jsonify(ok=True, views=[{"user": public(people[r["viewer"]], viewer=u["id"]), "ts": r["ts"]} for r in rows if r["viewer"] in people])


@app.post("/api/story/<int:sid>/delete")
def story_delete(sid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    st = q1("SELECT * FROM stories WHERE id=? AND owner=?", (sid, u["id"]))
    if not st:
        return err("Публикация не найдена", 404)
    with db_lock:
        run("DELETE FROM stories WHERE id=?", (sid,))
        run("DELETE FROM story_views WHERE story_id=?", (sid,))
    gc_files([st["fid"], st["tfid"]])
    notify_contacts(u["id"], {"type": "story", "user": u["id"]})
    return jsonify(ok=True)


# ───────────────────── СТИКЕРЫ И GIF ─────────────────────
def sticker_out(r, uid):
    return {"id": r["id"], "fid": r["fid"], "w": r["w"], "h": r["h"], "emoji": r["emoji"], "mime": r["mime"], "url": file_url(r["fid"], uid)}


@app.get("/api/stickers")
def stickers_list():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    rows = qa("SELECT * FROM stickers WHERE owner=? ORDER BY id DESC", (u["id"],))
    return jsonify(ok=True, stickers=[sticker_out(r, u["id"]) for r in rows if r["kind"] == "sticker"],
                   gifs=[sticker_out(r, u["id"]) for r in rows if r["kind"] == "gif"], gif_search=bool(GIPHY_KEY))


@app.post("/api/stickers")
def stickers_add():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    uid = u["id"]
    kind = "gif" if d.get("kind") == "gif" else "sticker"
    f = file_row(str(d.get("fid") or ""), uid)
    if not f or not (f["mime"].startswith("image/") or (kind == "gif" and f["mime"].startswith("video/"))):
        return err("Файл не найден")
    old = q1("SELECT * FROM stickers WHERE owner=? AND fid=? AND kind=?", (uid, f["fid"], kind))
    if old:
        return jsonify(ok=True, item=sticker_out(old, uid))
    n = q1("SELECT COUNT(*) n FROM stickers WHERE owner=? AND kind=?", (uid, kind))
    if n and n["n"] >= 300:
        return err("Слишком много. Удалите ненужные")
    emoji = str(d.get("emoji") or "")[:8]
    rid = run("INSERT INTO stickers(owner,fid,kind,w,h,emoji,mime,ts) VALUES(?,?,?,?,?,?,?,?)",
              (uid, f["fid"], kind, num(d.get("w"), 1, 4096) or 0, num(d.get("h"), 1, 4096) or 0, emoji, f["mime"], int(time.time()))).lastrowid
    return jsonify(ok=True, item=sticker_out(q1("SELECT * FROM stickers WHERE id=?", (rid,)), uid))


@app.post("/api/stickers/delete")
def stickers_delete():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    r = q1("SELECT * FROM stickers WHERE id=? AND owner=?", (num(body().get("id"), 1, 2 ** 62) or 0, u["id"]))
    if r:
        run("DELETE FROM stickers WHERE id=?", (r["id"],))
        gc_files([r["fid"]])
    return jsonify(ok=True)


# ───────────────────── ЭМОДЗИ-СТАТУС И СВОИ ЭМОДЗИ (Premium) ─────────────────────
EMOJI_SETS_MAX, EMOJI_PER_SET = 10, 120
EMOJI_IMG_MAX, EMOJI_VID_MAX = 1024 * 1024, 4 * 1024 * 1024        # свои эмодзи маленькие: картинка до 1 МБ, видео до 4 МБ
EMOJI_IMG = ("image/png", "image/jpeg", "image/webp", "image/gif", "image/avif")
EMOJI_VID = ("video/mp4", "video/webm")


def emoji_item_out(r, uid):
    return {"id": r["id"], "set": r["set_id"], "url": file_url(r["fid"], uid), "mime": r["mime"], "emoji": r["emoji"],
            "video": r["mime"].startswith("video/")}


def emoji_link(code):
    return link_url(code, "e")


def emoji_set_out(st, uid):
    items = qa("SELECT * FROM emoji_items WHERE set_id=? ORDER BY id", (st["id"],))
    return {"id": st["id"], "title": st["title"], "code": st.get("code") or "", "link": emoji_link(st.get("code") or ""),
            "mine": st["owner"] == uid, "items": [emoji_item_out(i, uid) for i in items]}


def emoji_title(v):
    return re.sub(r"\s+", " ", str(v or "")).strip()[:32]


@app.get("/api/emoji")
def emoji_list():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    sets = qa("SELECT * FROM emoji_sets WHERE owner=? ORDER BY id", (u["id"],))
    saved = qa("""SELECT s.* FROM emoji_saved v JOIN emoji_sets s ON s.id=v.set_id WHERE v.user_id=? AND s.owner!=? ORDER BY v.ts DESC""", (u["id"], u["id"]))
    return jsonify(ok=True, sets=[emoji_set_out(x, u["id"]) for x in sets], saved=[emoji_set_out(x, u["id"]) for x in saved],
                   status=u.get("estatus") or "", max_sets=EMOJI_SETS_MAX, max_items=EMOJI_PER_SET)


@app.get("/api/emoji/pack/<code>")
def emoji_pack(code):
    """Набор эмодзи по ссылке: открыть может любой вошедший; добавить к себе — кнопкой."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    st = q1("SELECT * FROM emoji_sets WHERE code=?", (str(code)[:16],)) if re.fullmatch(r"[A-Za-z0-9]{6,16}", str(code)) else None
    if not st:
        return err("Набор не найден", 404)
    o = q1("SELECT * FROM users WHERE id=?", (st["owner"],))
    d = emoji_set_out(st, u["id"])
    d["owner"] = {"id": o["id"], "name": o["name"], "surname": o.get("surname") or ""} if o else None
    d["added"] = st["owner"] == u["id"] or bool(q1("SELECT 1 FROM emoji_saved WHERE user_id=? AND set_id=?", (u["id"], st["id"])))
    return jsonify(ok=True, set=d)


@app.post("/api/emoji/pack/<code>/add")
def emoji_pack_add(code):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    st = q1("SELECT * FROM emoji_sets WHERE code=?", (str(code)[:16],))
    if not st:
        return err("Набор не найден", 404)
    if st["owner"] != u["id"]:
        run("INSERT OR IGNORE INTO emoji_saved(user_id,set_id,ts) VALUES(?,?,?)", (u["id"], st["id"], int(time.time())))
    return jsonify(ok=True)


@app.post("/api/emoji/pack/<code>/remove")
def emoji_pack_remove(code):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    st = q1("SELECT * FROM emoji_sets WHERE code=?", (str(code)[:16],))
    if st:
        run("DELETE FROM emoji_saved WHERE user_id=? AND set_id=?", (u["id"], st["id"]))
    return jsonify(ok=True)


@app.get("/api/emoji/items")
def emoji_items():
    """?ids=1,2,3 — данные своих эмодзи, которые встретились в сообщениях и реакциях (показываются всем)."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ids = [int(x) for x in re.findall(r"\d+", request.args.get("ids", ""))[:60]]
    if not ids:
        return jsonify(ok=True, items=[])
    rows = qa(f"SELECT * FROM emoji_items WHERE id IN ({','.join('?' * len(ids))})", ids)
    return jsonify(ok=True, items=[emoji_item_out(r, u["id"]) for r in rows])


def can_use_emoji(u, item_id):
    """Использовать свои эмодзи в тексте и реакциях может Premium: из своих наборов или добавленных по ссылке."""
    if not is_premium(u):
        return False
    it = q1("SELECT * FROM emoji_items WHERE id=?", (item_id,))
    if not it:
        return False
    if it["owner"] == u["id"]:
        return True
    return bool(q1("SELECT 1 FROM emoji_saved WHERE user_id=? AND set_id=?", (u["id"], it["set_id"])))


@app.post("/api/emoji/set")
def emoji_set_new():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    bad = need_premium(u)
    if bad:
        return bad
    title = emoji_title(body().get("title"))
    if not title:
        return err("Введите название набора")
    n = q1("SELECT COUNT(*) n FROM emoji_sets WHERE owner=?", (u["id"],))
    if n and n["n"] >= EMOJI_SETS_MAX:
        return err(f"Можно создать не больше {EMOJI_SETS_MAX} наборов")
    rid = run("INSERT INTO emoji_sets(owner,title,ts,code) VALUES(?,?,?,?)",
              (u["id"], title, int(time.time()), secrets.token_urlsafe(8).replace("-", "a").replace("_", "b")[:10])).lastrowid
    return jsonify(ok=True, set=emoji_set_out(q1("SELECT * FROM emoji_sets WHERE id=?", (rid,)), u["id"]))


@app.post("/api/emoji/set/rename")
def emoji_set_rename():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    st = q1("SELECT * FROM emoji_sets WHERE id=? AND owner=?", (num(d.get("id"), 1, 2 ** 62) or 0, u["id"]))
    title = emoji_title(d.get("title"))
    if not st:
        return err("Набор не найден", 404)
    if not title:
        return err("Введите название набора")
    run("UPDATE emoji_sets SET title=? WHERE id=?", (title, st["id"]))
    return jsonify(ok=True, set=emoji_set_out(q1("SELECT * FROM emoji_sets WHERE id=?", (st["id"],)), u["id"]))


def emoji_status_check(u):
    """Если статус указывал на удалённый эмодзи — сбросить его."""
    if (u.get("estatus") or "").startswith("c:") and not status_out(u):
        run("UPDATE users SET estatus='' WHERE id=?", (u["id"],))
        notify_profile(u["id"])


@app.post("/api/emoji/set/delete")
def emoji_set_delete():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    st = q1("SELECT * FROM emoji_sets WHERE id=? AND owner=?", (num(body().get("id"), 1, 2 ** 62) or 0, u["id"]))
    if st:
        fids = [r["fid"] for r in qa("SELECT fid FROM emoji_items WHERE set_id=?", (st["id"],))]
        run("DELETE FROM emoji_items WHERE set_id=?", (st["id"],))
        run("DELETE FROM emoji_sets WHERE id=?", (st["id"],))
        gc_files(fids)
        emoji_status_check(fresh(u["id"]))
    return jsonify(ok=True)


@app.post("/api/emoji/item")
def emoji_item_add():
    """Добавить в набор загруженный файл (картинка, GIF, WebP или короткое видео)."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    bad = need_premium(u)
    if bad:
        return bad
    d = body()
    st = q1("SELECT * FROM emoji_sets WHERE id=? AND owner=?", (num(d.get("set"), 1, 2 ** 62) or 0, u["id"]))
    if not st:
        return err("Набор не найден", 404)
    f = file_row(str(d.get("fid") or ""), u["id"])
    if not f or f["owner"] != u["id"] or f["mime"] not in EMOJI_IMG + EMOJI_VID:
        return err("Файл не подходит: нужна картинка, GIF, WebP или короткое видео (MP4, WebM)")
    if f["size"] > (EMOJI_VID_MAX if f["mime"].startswith("video/") else EMOJI_IMG_MAX):
        return err("Файл слишком большой: картинка до 1 МБ, видео до 4 МБ")
    n = q1("SELECT COUNT(*) n FROM emoji_items WHERE set_id=?", (st["id"],))
    if n and n["n"] >= EMOJI_PER_SET:
        return err(f"В наборе не больше {EMOJI_PER_SET} эмодзи")
    old = q1("SELECT * FROM emoji_items WHERE set_id=? AND fid=?", (st["id"], f["fid"]))
    if old:
        return jsonify(ok=True, item=emoji_item_out(old, u["id"]))
    rid = run("INSERT INTO emoji_items(set_id,owner,fid,mime,emoji,ts) VALUES(?,?,?,?,?,?)",
              (st["id"], u["id"], f["fid"], f["mime"], str(d.get("emoji") or "")[:8], int(time.time()))).lastrowid
    return jsonify(ok=True, item=emoji_item_out(q1("SELECT * FROM emoji_items WHERE id=?", (rid,)), u["id"]))


@app.post("/api/emoji/item/delete")
def emoji_item_delete():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    it = q1("SELECT * FROM emoji_items WHERE id=? AND owner=?", (num(body().get("id"), 1, 2 ** 62) or 0, u["id"]))
    if it:
        run("DELETE FROM emoji_items WHERE id=?", (it["id"],))
        gc_files([it["fid"]])
        emoji_status_check(fresh(u["id"]))
    return jsonify(ok=True)


@app.post("/api/me/status")
def me_status():
    """Эмодзи-статус: {status: "" | "b:<значок>" | "c:<номер своего эмодзи>"}. Менять может только Premium; сбросить — любой."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    st = str(body().get("status") or "")
    if st:
        bad = need_premium(u)
        if bad:
            return bad
        if st.startswith("c:"):
            if not can_use_emoji(u, num(st[2:], 1, 2 ** 62) or 0):
                return err("Эмодзи не найден", 404)
            st = "c:" + str(int(st[2:]))
        elif not STATUS_B_RE.match(st):
            return err("Неверный статус")
    if st:
        run("UPDATE users SET estatus=?, nft=0 WHERE id=?", (st, u["id"]))          # статус и надетый NFT заменяют друг друга
    else:
        run("UPDATE users SET estatus='' WHERE id=?", (u["id"],))
    notify_profile(u["id"])
    return jsonify(ok=True, user=public(fresh(u["id"]), True))


@app.post("/api/notify/test")
def notify_test():
    """Пробное уведомление через бота — чтобы проверить, что оно доходит в Telegram."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    if not u.get("tg_id"):
        return err("Аккаунт не связан с Telegram")
    if not hit("ntest", u["id"], 6, 60):
        return err("Подождите немного перед следующим пробным уведомлением", 429)
    r = tg("sendMessage", chat_id=u["tg_id"], text="🔔 Проверка уведомлений: так бот сообщает о новых сообщениях.", reply_markup=open_keyboard())
    if not r.get("ok"):
        return err("Не удалось отправить. Откройте бота и нажмите /start")
    return jsonify(ok=True)


GIF_HOST = re.compile(r"^[\w-]+\.giphy\.com$")


@app.get("/api/gif/search")
def gif_search():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    if not GIPHY_KEY:
        return jsonify(ok=True, items=[], need_key=True)
    if not hit("gif", u["id"], 30, 60):
        return err("Слишком часто", 429)
    q = request.args.get("q", "").strip()[:60]
    try:
        r = http.get("https://api.giphy.com/v1/gifs/" + ("search" if q else "trending"),
                     params={"api_key": GIPHY_KEY, "q": q, "limit": 30, "rating": "pg-13", "lang": "ru"}, timeout=6).json()
    except Exception:
        return err("Поиск GIF недоступен", 502)
    items = []
    for g in r.get("data") or []:
        im = g.get("images") or {}
        small, full = im.get("fixed_height_small") or {}, im.get("downsized") or im.get("fixed_height") or {}
        if small.get("url") and full.get("url"):
            items.append({"id": g.get("id"), "thumb": small["url"], "url": full["url"],
                          "w": int(full.get("width") or 0), "h": int(full.get("height") or 0)})
    return jsonify(ok=True, items=items)


@app.post("/api/gif/import")
def gif_import():
    """Сервер сам скачивает выбранный GIF (только с giphy.com) и сохраняет как обычный файл."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    url = str(d.get("url") or "")
    pu = urlparse(url)
    if pu.scheme != "https" or not GIF_HOST.match(pu.hostname or ""):
        return err("Недопустимый адрес")
    if not hit("gif", u["id"], 30, 60):
        return err("Слишком часто", 429)
    try:
        with http.get(url, stream=True, timeout=8, allow_redirects=False) as r:
            ct = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if r.status_code != 200 or ct not in ("image/gif", "image/webp", "video/mp4"):
                return err("Не удалось скачать GIF")
            data, total = [], 0
            for ch in r.iter_content(65536):
                total += len(ch)
                if total > 8 * 1024 * 1024:
                    return err("GIF слишком большой")
                data.append(ch)
    except Exception:
        return err("Не удалось скачать GIF", 502)
    fid = secrets.token_hex(16)
    with open(file_path(fid), "wb") as fh:
        fh.write(b"".join(data))
    ext = {"image/gif": "gif", "image/webp": "webp", "video/mp4": "mp4"}[ct]
    run("INSERT INTO files(fid,owner,name,size,mime,got,done,ts) VALUES(?,?,?,?,?,?,1,?)",
        (fid, u["id"], f"giphy.{ext}", total, ct, total, int(time.time())))
    return jsonify(ok=True, fid=fid, mime=ct, size=total, name=f"giphy.{ext}")


@app.get("/api/search")
def search():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    q = request.args.get("q", "").strip().lstrip("@")[:64]
    if len(q) < 2:
        return jsonify(ok=True, users=[], chats=[])
    digits = re.sub(r"\D", "", q)
    if len(digits) >= 8 and re.fullmatch(r"[+\d\s]+", q):
        rows = qa("SELECT * FROM users WHERE number=? AND is_system=0 AND id!=?", ("+" + digits, u["id"]))
    else:
        ql = q.lower()
        like = "%" + ql.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        found = qa("""SELECT * FROM users WHERE is_system=0 AND id!=?
                      AND (plower(username) LIKE ? ESCAPE '\\' OR plower(name) LIKE ? ESCAPE '\\'
                           OR plower(surname) LIKE ? ESCAPE '\\' OR plower(name || ' ' || surname) LIKE ? ESCAPE '\\')
                      LIMIT 100""", (u["id"], like, like, like, like))
        scored = []
        for r in found:
            un, nm = (r["username"] or "").lower(), ((r["name"] or "") + " " + (r.get("surname") or "")).strip().lower()
            if un.startswith(ql):
                s = 0
            elif nm.startswith(ql) or any(w.startswith(ql) for w in nm.split()):
                s = 1
            else:
                s = 2
            scored.append((s, r))
        scored.sort(key=lambda x: x[0])
        rows = [r for _, r in scored[:20]]
    return jsonify(ok=True, users=[public(r, viewer=u["id"]) for r in rows], chats=public_chats_search(q, u["id"]))


# ───────────────────── ЗВЁЗДЫ И PREMIUM ─────────────────────
def star_tx(uid, amount, title, kind):
    run("INSERT INTO star_tx(user_id,amount,title,kind,ts) VALUES(?,?,?,?,?)", (uid, amount, title, kind, int(time.time())))
    try:
        run("INSERT INTO admin_log(actor,kind,target,data,ts) VALUES(?,?,0,?,?)",
            (uid, "star_tx", json.dumps({"amount": amount, "title": title, "kind": kind}, ensure_ascii=False), int(time.time())))
        t = fresh(uid)
        who = (t and t.get("number")) or str(uid)
        hc_post("logs", f"⭐ {who}: {'+' if amount >= 0 else ''}{amount} — {title}")
    except Exception as e:
        print("star_tx log error:", e)


def fresh(uid):
    return q1("SELECT * FROM users WHERE id=?", (uid,))


@app.get("/api/stars")
def stars_get():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    tx = qa("SELECT id, amount, title, kind, ts FROM star_tx WHERE user_id=? ORDER BY id DESC LIMIT 100", (u["id"],))
    return jsonify(ok=True, balance=u.get("stars") or 0, premium=is_premium(u), until=u.get("premium_until") or 0,
                   admin=is_admin(u), price=PREMIUM_PRICE, gift={str(m): v[0] for m, v in PREMIUM_GIFT.items()}, tx=tx)


@app.post("/api/stars/topup")
def stars_topup():
    """Пополнение пока доступно только администратору (для проверки). Остальным — «пока недоступно»."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    if not is_admin(u):
        return err("Пополнение баланса пока недоступно", 403)
    n = num(body().get("amount"), 1, 1_000_000)
    if not n:
        return err("Неверная сумма")
    run("UPDATE users SET stars=stars+? WHERE id=?", (n, u["id"]))
    star_tx(u["id"], n, "Пополнение (тест)", "topup")
    return jsonify(ok=True, user=public(fresh(u["id"]), True))


@app.post("/api/premium/buy")
def premium_buy():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    plan = body().get("plan")
    if plan not in PREMIUM_PRICE:
        return err("Неверный тариф")
    price = PREMIUM_PRICE[plan]
    now = int(time.time())
    with db_lock:
        cur = fresh(u["id"])
        if is_premium(cur):                                    # досрочно продлить нельзя — только когда подписка закончится
            return jsonify(ok=False, error="Premium уже активен. Продлить можно после окончания подписки", active=True), 409
        if (cur.get("stars") or 0) < price:
            return jsonify(ok=False, error=f"Недостаточно звёзд: нужно {price}, у вас {cur.get('stars') or 0}", need=price), 402
        base = max(now, cur.get("premium_until") or 0)          # покупка продлевает действующий Premium
        until = base + PREMIUM_DAYS[plan] * 86400
        run("UPDATE users SET stars=stars-?, premium_until=? WHERE id=?", (price, until, u["id"]))
        if not (cur.get("estatus") or "") and not cur.get("nft"):
            run("UPDATE users SET estatus='b:star' WHERE id=?", (u["id"],))      # при активации — только звезда у имени (её можно убрать)
        star_tx(u["id"], -price, "Premium на год" if plan == "year" else "Premium на месяц", "premium")
    nu = fresh(u["id"])
    txt, en = bold_text([("Premium активен", True), (f"\n\nСпасибо! Подписка действует до {datetime.fromtimestamp(until).strftime('%d.%m.%Y')}.", False)])
    add_message(SYSTEM_ID, u["id"], txt, ents=en, auto=True)
    notify_profile(u["id"])
    return jsonify(ok=True, user=public(nu, True))


@app.post("/api/admin/grant")
def admin_grant():
    """Только админ: {to: id или номер (по умолчанию он сам), stars, premium_days, gift, nft, username} — выдать
    звёзды / Premium / обычный подарок (ключ из GIFTS) / NFT (ключ коллекции из COLLS) / NFT-юзернейм бесплатно."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    if not is_admin(u):
        return err("Нет доступа", 403)
    d = body()
    to = d.get("to")
    t = u if to in (None, "", u["id"]) else (q1("SELECT * FROM users WHERE id=?", (num(to, 1, 2 ** 62) or 0,)) or q1("SELECT * FROM users WHERE number=?", (norm(str(to)),)))
    if not t:
        return err("Пользователь не найден", 404)
    st, days = num(d.get("stars"), -1_000_000, 1_000_000) or 0, num(d.get("premium_days"), -3650, 3650) or 0
    gift_key, nft_coll, uname = str(d.get("gift") or ""), str(d.get("nft") or ""), str(d.get("username") or "").lstrip("@")
    if uname:
        e = check_username(uname, t["id"])
        if e:
            return err(f"Нельзя выдать @{uname}: {e}")
        run("UPDATE users SET username=?, uname_nft=1, uname_ton=? WHERE id=?", (uname, random_ton_price(uname), t["id"]))
    if st:
        run("UPDATE users SET stars=MAX(0, stars+?) WHERE id=?", (st, t["id"]))
        star_tx(t["id"], st, "Начислено администратором", "grant")
    if days:
        base = max(int(time.time()), t.get("premium_until") or 0) if days > 0 else int(time.time())
        run("UPDATE users SET premium_until=? WHERE id=?", (base + days * 86400 if days > 0 else 0, t["id"]))
    if gift_key:
        if gift_key not in GIFTS:
            return err("Неизвестный подарок")
        e, n, pr, up = GIFTS[gift_key]
        gid = run("""INSERT INTO gifts(from_id,to_id,key,coll,model,backdrop,pattern,num,anon,msg,price,ts,shown)
                     VALUES(?,?,?,'',0,0,0,0,0,'',?,?,1)""", (SYSTEM_ID, t["id"], gift_key, pr, int(time.time()))).lastrowid
        gift_message(SYSTEM_ID, t["id"], q1("SELECT * FROM gifts WHERE id=?", (gid,)), f"🎁 Подарок от создателя: {n}")
    if nft_coll:
        if nft_coll not in COLLS:
            return err("Неизвестная коллекция")
        a = mint(nft_coll, t["id"])
        if not a:
            return err("Тираж этой коллекции закончился", 409)
        price = COLLS[nft_coll][3]
        gid = run("""INSERT INTO gifts(from_id,to_id,key,coll,model,backdrop,pattern,num,anon,msg,price,ts,shown)
                     VALUES(?,?,?,?,?,?,?,?,0,'',?,?,1)""",
                  (SYSTEM_ID, t["id"], "c:" + nft_coll, a["coll"], a["model"], a["backdrop"], a["pattern"], a["num"], price, int(time.time()))).lastrowid
        gift_message(SYSTEM_ID, t["id"], q1("SELECT * FROM gifts WHERE id=?", (gid,)), f"🎁 NFT-подарок от создателя: {COLLS[nft_coll][1]}")
    notify_profile(t["id"])
    return jsonify(ok=True, user=public(fresh(t["id"]), True) if t["id"] == u["id"] else None)


# ───────────────────── СЛУЖЕБНАЯ ГРУППА ВЛАДЕЛЬЦА (helpcreator) ─────────────────────
# Вместо отдельного экрана «админка» — обычная группа с темами: владелец печатает команды прямо в чат,
# бот отвечает тут же. Группа создаётся один раз и видна только владельцу (он единственный участник).
HC_TOPICS = (("logs", "Логи", "📋"), ("new", "Новые аккаунты", "🆕"), ("info", "Инфо об аккаунте", "🔎"),
             ("grant", "Grant", "🎁"), ("verify", "Верификация", "✅"))
_hc_cache = {}


def kv_get(k, default=None):
    r = q1("SELECT v FROM kv WHERE k=?", (k,))
    if not r:
        return default
    try:
        return json.loads(r["v"])
    except Exception:
        return default


def kv_set(k, v):
    run("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, json.dumps(v, ensure_ascii=False)))


def get_admin_user():
    t = q1("SELECT * FROM users WHERE number=?", (ADMIN_NUMBER,))
    if t:
        return t
    return q1("SELECT * FROM users WHERE tg_id=?", (ADMIN_TG_ID,)) if ADMIN_TG_ID else None


def ensure_helpcreator():
    """Возвращает (chat_row, {key: topic_id}); создаёт группу и темы при первой необходимости."""
    if _hc_cache.get("chat"):
        ch = chat_row(_hc_cache["chat"])
        if ch:
            return ch, _hc_cache["topics"]
        _hc_cache.clear()
    admin = get_admin_user()
    if not admin:
        return None, None
    with db_lock:
        saved = kv_get("hc") or {}
        ch = chat_row(saved.get("chat")) if saved.get("chat") else None
        if not ch:
            now = int(time.time())
            cid = run("INSERT INTO chats(kind,title,about,owner,ts,topics,hist) VALUES('group',?,?,?,?,1,1)",
                      ("Dicegram — создатель", "Служебная группа: видна только владельцу сервиса", admin["id"], now)).lastrowid
            run("INSERT INTO chat_members(chat_id,user_id,role,joined,adder) VALUES(?,?,'owner',?,0)", (cid, admin["id"], now))
            ch = chat_row(cid)
            saved = {"chat": cid, "topics": {}}
        topics = saved.get("topics") or {}
        changed = not saved.get("chat")
        for key, title, emoji in HC_TOPICS:
            if not topics.get(key):
                tid = run("INSERT INTO chat_topics(chat_id,title,color,emoji,creator,ts) VALUES(?,?,0,?,?,?)",
                          (ch["id"], title, emoji, admin["id"], int(time.time()))).lastrowid
                topics[key] = tid
                changed = True
        if changed:
            kv_set("hc", {"chat": ch["id"], "topics": topics})
    _hc_cache["chat"], _hc_cache["topics"] = ch["id"], topics
    return ch, topics


def hc_post(topic_key, text):
    """Опубликовать строку в служебной группе, если она уже создана (владелец хоть раз заходил в приложение)."""
    try:
        ch, topics = ensure_helpcreator()
        if not ch:
            return
        tid = topics.get(topic_key)
        if tid:
            add_gmessage(ch, SYSTEM_ID, text, topic=tid)
    except Exception as e:
        print("hc_post error:", e)


def hc_resolve(token):
    """номер телефона / @имя / #id чата → ('user', row) | ('chat', row) | None."""
    token = (token or "").strip()
    if not token:
        return None
    if token[0] == "#":
        cid = num(token[1:], 1, 2 ** 62)
        ch = q1("SELECT * FROM chats WHERE id=?", (cid,)) if cid else None
        return ("chat", ch) if ch else None
    if token[0] == "@":
        name = token[1:]
        t = q1("SELECT * FROM users WHERE username=? COLLATE NOCASE", (name,))
        if t:
            return ("user", t)
        ch = q1("SELECT * FROM chats WHERE slug=? COLLATE NOCASE", (name,))
        return ("chat", ch) if ch else None
    t = q1("SELECT * FROM users WHERE number=?", (norm(token),))
    return ("user", t) if t else None


def hc_fmt_ts(ts):
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%d.%m.%Y %H:%M UTC")
    except Exception:
        return "—"


def hc_cmd_info(text):
    r = hc_resolve(text)
    if not r or r[0] != "user":
        return "Аккаунт не найден. Укажите номер телефона или @username."
    t = r[1]
    lines = [
        f"📱 Номер: {t['number']}",
        f"👤 Имя: {((t.get('name') or '') + ' ' + (t.get('surname') or '')).strip() or '—'}",
        f"🔖 Username: @{t['username']}" if t.get("username") else "🔖 Username: —",
        f"🔐 Облачный пароль: {'установлен' if t.get('cloud_hash') else 'не установлен'}",
        f"🗓 Регистрация: {hc_fmt_ts(t.get('created') or 0)}",
        f"⭐ Звёзды: {t.get('stars') or 0}",
        f"💎 Premium: {'до ' + hc_fmt_ts(t['premium_until']) if is_premium(t) else 'нет'}",
    ]
    sess = qa("SELECT device, ip, country, last_used FROM sessions WHERE user_id=? ORDER BY last_used DESC LIMIT 5", (t["id"],))
    lines.append("—— Последние сессии ——" if sess else "Сессий нет.")
    for s in sess:
        lines.append(f"{s['device'] or '?'} · {s['ip'] or '?'} · {s['country'] or '?'} · {hc_fmt_ts(s['last_used'])}")
    return "\n".join(lines)


def random_ton_price(name):
    """Случайная цена NFT-юзернейма в TON: короче имя — дороже, как на Fragment."""
    n = len(name)
    lo, hi = (800, 8000) if n <= 4 else (150, 1500) if n <= 6 else (40, 400) if n <= 8 else (10, 100)
    return random.randint(lo, hi)


def hc_cmd_grant(text):
    parts = text.split()
    if len(parts) < 2:
        return "Формат: <номер/@ник> stars <число> | premium <дней> | gift <ключ> | nft <коллекция> | username <имя>"
    r = hc_resolve(parts[0])
    what = parts[1].lower()
    if not r or r[0] != "user":
        return "Пользователь не найден."
    t = r[1]
    if what == "username":
        name = (parts[2] if len(parts) > 2 else "").lstrip("@")
        e = check_username(name, t["id"])
        if e:
            return f"Нельзя выдать @{name}: {e}"
        price = random_ton_price(name)
        run("UPDATE users SET username=?, uname_nft=1, uname_ton=? WHERE id=?", (name, price, t["id"]))
        notify_profile(t["id"])
        return f"Готово: @{name} выдан {t['number']} как NFT-юзернейм (≈{price} TON)."
    if what == "stars":
        amt = num(parts[2], -1_000_000, 1_000_000) if len(parts) > 2 else None
        if amt is None:
            return "Укажите количество звёзд, например: +88800000001 stars 500"
        run("UPDATE users SET stars=MAX(0, stars+?) WHERE id=?", (amt, t["id"]))
        star_tx(t["id"], amt, "Начислено администратором", "grant")
        notify_profile(t["id"])
        return f"Готово: {'+' if amt >= 0 else ''}{amt} ⭐ пользователю {t['number']}."
    if what == "premium":
        days = num(parts[2], -3650, 3650) if len(parts) > 2 else None
        if days is None:
            return "Укажите число дней, например: +88800000001 premium 30"
        base = max(int(time.time()), t.get("premium_until") or 0) if days > 0 else int(time.time())
        run("UPDATE users SET premium_until=? WHERE id=?", (base + days * 86400 if days > 0 else 0, t["id"]))
        notify_profile(t["id"])
        return f"Готово: Premium {'+' + str(days) + ' дн.' if days > 0 else 'отключён'} пользователю {t['number']}."
    if what == "gift":
        key = parts[2] if len(parts) > 2 else ""
        if key not in GIFTS:
            return "Неизвестный подарок. Доступные: " + ", ".join(GIFTS.keys())
        e, n, pr, up = GIFTS[key]
        gid = run("""INSERT INTO gifts(from_id,to_id,key,coll,model,backdrop,pattern,num,anon,msg,price,ts,shown)
                     VALUES(?,?,?,'',0,0,0,0,0,'',?,?,1)""", (SYSTEM_ID, t["id"], key, pr, int(time.time()))).lastrowid
        gift_message(SYSTEM_ID, t["id"], q1("SELECT * FROM gifts WHERE id=?", (gid,)), f"🎁 Подарок от создателя: {n}")
        notify_profile(t["id"])
        return f"Готово: подарок «{n}» отправлен {t['number']}."
    if what == "nft":
        coll = parts[2] if len(parts) > 2 else ""
        if coll not in COLLS:
            return "Неизвестная коллекция. Доступные: " + ", ".join(COLLS.keys())
        a = mint(coll, t["id"])
        if not a:
            return "Тираж этой коллекции закончился."
        price = COLLS[coll][3]
        gid = run("""INSERT INTO gifts(from_id,to_id,key,coll,model,backdrop,pattern,num,anon,msg,price,ts,shown)
                     VALUES(?,?,?,?,?,?,?,?,0,'',?,?,1)""",
                  (SYSTEM_ID, t["id"], "c:" + coll, a["coll"], a["model"], a["backdrop"], a["pattern"], a["num"], price, int(time.time()))).lastrowid
        gift_message(SYSTEM_ID, t["id"], q1("SELECT * FROM gifts WHERE id=?", (gid,)), f"🎁 NFT-подарок от создателя: {COLLS[coll][1]}")
        notify_profile(t["id"])
        return f"Готово: NFT «{COLLS[coll][1]} №{a['num']}» выдан {t['number']}."
    return "Неизвестная команда. Используйте: stars / premium / gift / nft"


def hc_cmd_verify(text):
    parts = text.split()
    if len(parts) < 2:
        return "Формат: <номер/@ник/#id> major | official | none"
    tier = parts[1].lower()
    if tier not in ("major", "official", "none"):
        return "Укажите: major, official или none (снять отметку)."
    r = hc_resolve(parts[0])
    if not r:
        return "Не найдено. Укажите номер телефона, @username или #id чата."
    kind, row = r
    val = "" if tier == "none" else tier
    if kind == "user":
        run("UPDATE users SET vtier=? WHERE id=?", (val, row["id"]))
        notify_profile(row["id"])
        label = row["number"]
    else:
        run("UPDATE chats SET vtier=? WHERE id=?", (val, row["id"]))
        push_chat_update(chat_row(row["id"]))
        label = f"#{row['id']}" + (f" ({row['title']})" if row.get("title") else "")
    if val:
        return f"Готово: {label} получил отметку «{'Major' if val == 'major' else 'Official'}» (Подтверждено Dicegram)."
    return f"Готово: отметка снята у {label}."


def hc_dispatch(ch, u, topic, text):
    """Команда владельца в одной из тем служебной группы → выполнить и ответить тут же."""
    if not topic or not is_admin(u):
        return
    hch, topics = ensure_helpcreator()
    if not topics or not hch or hch["id"] != ch["id"]:
        return
    key = next((k for k, v in topics.items() if v == topic), None)
    if not key or key in ("logs", "new"):
        return
    try:
        if key == "info":
            reply = hc_cmd_info(text)
        elif key == "grant":
            reply = hc_cmd_grant(text)
        elif key == "verify":
            reply = hc_cmd_verify(text)
        else:
            reply = None
    except Exception as e:
        reply = f"Ошибка: {e}"
    if reply:
        add_gmessage(ch, SYSTEM_ID, reply, topic=topic)


# ───────────────────── БИЗНЕС-ФУНКЦИИ (только с Premium) ─────────────────────
SLUG_RE = re.compile(r"^[a-z0-9_]{4,32}$")
SHORT_RE = re.compile(r"^[\w\-]{1,32}$")
NEED_PREMIUM = "Эта функция доступна только с Premium"


def need_premium(u):
    return None if is_premium(u) else (jsonify(ok=False, error=NEED_PREMIUM, need_premium=True), 403)


def clean_hours(h):
    if not isinstance(h, dict):
        return None
    days = {}
    for k in "0123456":
        out = []
        raw = (h.get("days") or {}).get(k) or []
        if not isinstance(raw, list) or len(raw) > 3:
            return None
        for it in raw:
            try:
                a, b = int(it[0]), int(it[1])
            except (TypeError, ValueError, IndexError, KeyError):
                return None
            if not (0 <= a < b <= 1440):
                return None
            out.append([a, b])
        days[k] = out
    tz = num(h.get("tz"), -840, 840)
    return {"on": bool(h.get("on")), "tz": tz or 0, "days": days}


def clean_quick(items):
    if not isinstance(items, list) or len(items) > 20:
        return None
    out, seen = [], set()
    for it in items:
        if not isinstance(it, dict):
            return None
        name, text = str(it.get("name", "")).strip().lstrip("/"), str(it.get("text", "")).strip()[:1000]
        if not SHORT_RE.match(name) or not text or name.lower() in seen:
            return None
        seen.add(name.lower())
        out.append({"id": str(it.get("id") or secrets.token_hex(3))[:12], "name": name, "text": text})
    return out


@app.get("/api/biz/me")
def biz_me():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    links = qa("SELECT slug,title,text,uses FROM biz_links WHERE owner=? ORDER BY ts DESC", (u["id"],))
    b = biz_of(u)
    return jsonify(ok=True, premium=is_premium(u), biz=b, links=links)


@app.post("/api/biz/save")
def biz_save():
    """{section: address|hours|quick|greeting|away|intro, data}"""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    bad = need_premium(u)
    if bad:
        return bad
    d = body()
    sec, data = d.get("section"), d.get("data")
    b = biz_of(u)
    if sec == "address":
        b["address"] = str(data or "").strip()[:200]
    elif sec == "hours":
        h = clean_hours(data)
        if h is None:
            return err("Неверный график")
        b["hours"] = h
    elif sec == "quick":
        q = clean_quick(data)
        if q is None:
            return err("Проверьте быстрые ответы: у каждого должны быть уникальное имя (буквы, цифры, _) и текст")
        b["quick"] = q
    elif sec in ("greeting", "away"):
        if not isinstance(data, dict):
            return err("Неверные данные")
        text = str(data.get("text", "")).strip()[:1000]
        if data.get("on") and not text:
            return err("Введите текст сообщения")
        if sec == "greeting":
            b["greeting"] = {"on": bool(data.get("on")), "text": text, "days": data.get("days") if data.get("days") in (7, 14, 21, 28) else 7}
        else:
            b["away"] = {"on": bool(data.get("on")), "text": text, "mode": "outside" if data.get("mode") == "outside" else "always"}
    elif sec == "intro":
        if not isinstance(data, dict):
            return err("Неверные данные")
        b["intro"] = {"title": str(data.get("title", "")).strip()[:32], "text": str(data.get("text", "")).strip()[:70], "emoji": str(data.get("emoji", "")).strip()[:8]}
    else:
        return err("Неизвестный раздел")
    run("UPDATE users SET biz=? WHERE id=?", (json.dumps(b, ensure_ascii=False, separators=(",", ":")), u["id"]))
    if sec in ("address", "hours", "intro"):
        notify_profile(u["id"])
    return jsonify(ok=True, biz=b)


@app.post("/api/biz/link")
def biz_link_add():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    bad = need_premium(u)
    if bad:
        return bad
    d = body()
    title, text = str(d.get("title", "")).strip()[:40], str(d.get("text", "")).strip()[:500]
    slug = str(d.get("slug", "")).strip().lower() or secrets.token_hex(4)
    if not SLUG_RE.match(slug):
        return err("Адрес ссылки: от 4 до 32 символов — латиница, цифры, _")
    if q1("SELECT COUNT(*) n FROM biz_links WHERE owner=?", (u["id"],))["n"] >= 10:
        return err("Можно создать не больше 10 ссылок")
    try:
        run("INSERT INTO biz_links(slug,owner,title,text,ts) VALUES(?,?,?,?,?)", (slug, u["id"], title, text, int(time.time())))
    except sqlite3.IntegrityError:
        return err("Такой адрес уже занят")
    return jsonify(ok=True, links=qa("SELECT slug,title,text,uses FROM biz_links WHERE owner=? ORDER BY ts DESC", (u["id"],)))


@app.post("/api/biz/link/delete")
def biz_link_del():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    run("DELETE FROM biz_links WHERE slug=? AND owner=?", (str(body().get("slug", "")), u["id"]))
    return jsonify(ok=True, links=qa("SELECT slug,title,text,uses FROM biz_links WHERE owner=? ORDER BY ts DESC", (u["id"],)))


@app.get("/api/biz/link/<slug>")
def biz_link_open(slug):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    r = q1("SELECT * FROM biz_links WHERE slug=?", (slug.lower(),))
    owner = r and q1("SELECT * FROM users WHERE id=?", (r["owner"],))
    if not r or not owner:
        return err("Ссылка не найдена", 404)
    run("UPDATE biz_links SET uses=uses+1 WHERE slug=?", (slug.lower(),))
    return jsonify(ok=True, user=public(owner, viewer=u["id"]), text=r["text"] or "")


def biz_auto_reply(sender, receiver):
    """Приветствие новым собеседникам и сообщение «Нет на месте» — от имени бизнес-аккаунта (только с Premium)."""
    r = q1("SELECT * FROM users WHERE id=?", (receiver,))
    if not r or r["is_system"] or not is_premium(r):
        return
    b = biz_of(r)
    now = int(time.time())

    def sent_recently(kind, secs):
        a = q1("SELECT ts FROM biz_auto WHERE owner=? AND peer=? AND kind=?", (receiver, sender, kind))
        return bool(a and now - a["ts"] < secs)

    def mark(kind):
        run("INSERT OR REPLACE INTO biz_auto(owner,peer,kind,ts) VALUES(?,?,?,?)", (receiver, sender, kind, now))

    g, a = b.get("greeting") or {}, b.get("away") or {}
    if g.get("on") and g.get("text"):
        days = g.get("days") if g.get("days") in (7, 14, 21, 28) else 7
        # в окне уже есть только что отправленное сообщение, значит «новый чат» — это ровно одно сообщение
        win = q1("""SELECT COUNT(*) n FROM messages WHERE ((sender=? AND receiver=?) OR (sender=? AND receiver=?)) AND ts>?""",
                 (sender, receiver, receiver, sender, now - days * 86400 - 1))
        if win["n"] <= 1 and not sent_recently("greeting", days * 86400):
            mark("greeting")
            mark("away")                       # после приветствия не шлём ещё и «нет на месте» в тот же день
            add_message(receiver, sender, g["text"], auto=True)
            return
    if a.get("on") and a.get("text") and not sent_recently("away", 86400):
        outside = a.get("mode") != "outside" or (hours_state(b)[0] and not hours_state(b)[1])
        if outside:
            mark("away")
            add_message(receiver, sender, a["text"], auto=True)


@app.post("/api/support")
def support_send():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    text = str(body().get("text", "")).strip()[:2000]
    if not text:
        return err("Пустое сообщение")
    if not hit("support", u["id"], 10, 3600):
        return err("Слишком часто. Попробуйте позже", 429)
    run("INSERT INTO support(user_id,text,ts) VALUES(?,?,?)", (u["id"], text, int(time.time())))
    alert_admin(f"🆘 Обращение в поддержку от {u['number']}:\n{text[:500]}")
    return jsonify(ok=True)


# ───────────────────── ГРУППЫ И КАНАЛЫ ─────────────────────
# Группа или канал — «собеседник» с отрицательным номером: сообщения лежат в той же таблице messages, receiver = -id чата.
# Так работают все возможности обычных чатов: ответы, реакции, закрепы, файлы, пересылка, правка.
PERM_DEFAULT = {"text": 1, "photo": 1, "video": 1, "file": 1, "music": 1, "voice": 1, "sticker": 1, "gif": 1, "links": 1,
                "invite": 1, "pin": 0, "tag": 1, "info": 0, "topics": 0}
NOPERM = {"text": "Вам запрещено отправлять сообщения", "photo": "Вам запрещено отправлять фото", "video": "Вам запрещено отправлять видео",
          "file": "Вам запрещено отправлять файлы", "music": "Вам запрещено отправлять музыку", "voice": "Вам запрещено отправлять голосовые",
          "sticker": "Вам запрещено отправлять стикеры", "gif": "Вам запрещено отправлять GIF"}
RIGHTS_G = ("info", "delete", "ban", "invite", "pin", "topics", "calls", "admins")
RIGHTS_C = ("info", "post", "edit", "delete", "pin", "ban", "invite", "calls", "admins")
RIGHTS_DEFAULT = ("info", "delete", "ban", "invite", "pin", "topics", "calls", "post", "edit")
SLOW_STEPS = (0, 2, 5, 10, 30, 60, 300, 900, 3600)
SLUG_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{3,31}$")
LINK_RE = re.compile(r"^[A-Za-z0-9_-]{4,40}$")
URL_IN_TEXT = re.compile(r"(https?://|www\.|t\.me/|tg://)\S+", re.I)
MAX_MEMBERS = 5000
MAX_OWNED = 30
MAX_LINKS = 20
MAX_TOPICS = 100
vrooms = {}                      # chat_id -> {"users": {uid: {"mute": bool, "video": bool, "since": ts}}, "since": ts, "by": uid}
vlock = threading.RLock()


def chat_row(cid):
    return q1("SELECT * FROM chats WHERE id=?", (cid,)) if cid else None


def member_row(cid, uid):
    return q1("SELECT * FROM chat_members WHERE chat_id=? AND user_id=?", (cid, uid))


def member_ids(cid):
    return [r["user_id"] for r in qa("SELECT user_id FROM chat_members WHERE chat_id=?", (cid,))]


def member_count(cid):
    r = q1("SELECT COUNT(*) n FROM chat_members WHERE chat_id=?", (cid,))
    return r["n"] if r else 0


def ctx(u, cid):
    ch = chat_row(cid)
    return ch, (member_row(cid, u["id"]) if ch else None)


def chat_perms(ch):
    d = dict(PERM_DEFAULT)
    for k, v in json_load(ch.get("perms"), {}).items():
        if k in d:
            d[k] = 1 if v else 0
    return d


def rights_keys(ch):
    return RIGHTS_C if ch["kind"] == "channel" else RIGHTS_G


def my_rights(ch, m):
    if not m:
        return {}
    if m["role"] == "owner":
        return {k: 1 for k in rights_keys(ch)}
    if m["role"] == "admin":
        r = json_load(m.get("rights"), {})
        return {k: 1 for k in rights_keys(ch) if r.get(k)}
    return {}


def has_right(ch, m, key):
    return bool(my_rights(ch, m).get(key))


def eff_perms(ch, m):
    """Что участнику можно отправлять: общие права группы + личные ограничения. Владелец и админы группы — без ограничений."""
    if ch["kind"] == "channel":
        ok = 1 if has_right(ch, m, "post") else 0
        return {k: ok for k in PERM_DEFAULT}
    if m["role"] in ("owner", "admin"):
        return {k: 1 for k in PERM_DEFAULT}
    p = chat_perms(ch)
    if m.get("restr") and (not m.get("until") or m["until"] > time.time()):
        for k, v in json_load(m["restr"], {}).items():
            if k in p:
                p[k] = 1 if v else 0
    return p


def can_do(ch, m, key):
    """invite / pin / info / topics / tag: право администратора или разрешение участникам группы."""
    if not m:
        return False
    if key == "tag" and m["role"] in ("owner", "admin"):
        return True
    if has_right(ch, m, key):
        return True
    return ch["kind"] == "group" and m["role"] == "member" and bool(eff_perms(ch, m).get(key))


def can_write(ch, m):
    if ch["kind"] == "channel":
        return has_right(ch, m, "post")
    p = eff_perms(ch, m)
    return any(p.get(k) for k in ("text", "photo", "video", "file", "music", "voice", "sticker", "gif"))


def vc_count(cid):
    with vlock:
        r = vrooms.get(cid)
        return len(r["users"]) if r else 0


def chat_public(ch, m=None, count=None):
    """Чат как «собеседник» для клиента (id отрицательный)."""
    d = {"id": -ch["id"], "gid": ch["id"], "gk": ch["kind"], "name": ch["title"], "surname": "", "username": ch["slug"] or "",
         "bio": ch["about"] or "", "avatar": ch["photo"] or "", "is_system": 0, "online": False, "last_seen": 0,
         "members": member_count(ch["id"]) if count is None else count, "topics": int(ch["topics"] or 0), "owner": ch["owner"],
         "ts": ch["ts"], "react_mode": ch["react_mode"] or "all", "slow": ch["slow"] or 0, "vc": vc_count(ch["id"]),
         "react_list": json_load(ch.get("react_list"), []) if ch["react_mode"] == "some" else []}
    if ch["slug"]:
        d["plink"] = link_url(ch["slug"], "p")      # публичная ссылка (по адресу)
    vt = ch.get("vtier") or ""
    if vt in ("major", "official"):
        d["verified"] = 1
        d["vtier"] = vt
    if ch["kind"] == "channel" and ch.get("disc_chat_id"):
        d["disc"] = ch["disc_chat_id"]               # привязанная группа обсуждения — под постами показывается «Комментарии»
    if m:
        d["role"] = m["role"]
        d["rights"] = my_rights(ch, m)
        d["post"] = 1 if can_write(ch, m) else 0
        d["perms"] = eff_perms(ch, m)
        d["tag"] = m.get("tag") or ""
        d["can_invite"] = 1 if can_do(ch, m, "invite") else 0
        if m["role"] == "member" and ch["slow"]:
            d["slow_left"] = max(0, int((m.get("last_send") or 0) + ch["slow"] - time.time()))      # сколько секунд осталось до следующего сообщения
    return d


def chat_full(ch, m):
    d = chat_public(ch, m)
    d.update({"hist": int(ch["hist"] or 0), "greet": ch["greet"] or "", "greet_on": int(ch["greet_on"] or 0), "perms_all": chat_perms(ch),
              "auto_del": ch["auto_del"] or 0, "sign": int(ch["sign"] or 0),
              "pfmt": link_url("{s}", "p")})            # шаблон публичной ссылки: {s} заменяется адресом
    if m and (m["role"] in ("owner", "admin")):
        d["admins"] = (q1("SELECT COUNT(*) n FROM chat_members WHERE chat_id=? AND role IN ('owner','admin')", (ch["id"],)) or {}).get("n", 0)
        d["banned"] = (q1("SELECT COUNT(*) n FROM chat_bans WHERE chat_id=?", (ch["id"],)) or {}).get("n", 0)
        d["links"] = (q1("SELECT COUNT(*) n FROM chat_links WHERE chat_id=? AND revoked=0", (ch["id"],)) or {}).get("n", 0)
    if ch["kind"] == "channel":
        d["disc_chat_id"] = ch.get("disc_chat_id") or 0
        if d["disc_chat_id"]:
            g = chat_row(d["disc_chat_id"])
            d["disc_name"] = g["title"] if g else ""
    return d


def uname(uid):
    u = q1("SELECT name, surname FROM users WHERE id=?", (uid,)) or {}
    return " ".join(x for x in (u.get("name"), u.get("surname")) if x) or "Пользователь"


def chat_push(ch, payload_fn, only_online=True):
    """Разослать событие всем участникам чата; payload_fn(uid) → словарь (или None — пропустить)."""
    for uid in member_ids(ch["id"]):
        if only_online and not clients.get(uid):
            continue
        p = payload_fn(uid)
        if p:
            push(uid, p)


def push_chat_update(ch):
    def fn(uid):
        return {"type": "chat", "chat": chat_public(ch, member_row(ch["id"], uid))}
    chat_push(ch, fn)


def add_gmessage(ch, sender, text, cid=None, kind="text", ents=None, att=None, reply_to=None, fw=None, topic=0, svc=None, only=0):
    """Сообщение в группу или канал: сохраняем и рассылаем всем, кто сейчас в сети."""
    ts = int(time.time())
    ttl = 0 if kind in ("svc", "greet") else (ch["auto_del"] or 0)
    with db_lock:
        if cid:
            old = q1("SELECT * FROM messages WHERE sender=? AND cid=?", (sender, cid))
            if old:
                return ser_one(old, sender)
        mid = run("""INSERT INTO messages(sender,receiver,text,ts,cid,kind,meta,reply_to,fid,tfid,exp,topic,only_u) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                  (sender, -ch["id"], encrypt_text(text), ts, cid or None, kind,
                   meta_dump({"e": ents, "a": att, "fw": fw, "s": svc}), reply_to,
                   (att or {}).get("fid"), (att or {}).get("tfid"), ts + ttl if ttl else 0, topic or 0, only or 0)).lastrowid
        row = q1("SELECT * FROM messages WHERE id=?", (mid,))
    targets = [only] if only else member_ids(ch["id"])
    for uid in targets:
        if clients.get(uid):
            push(uid, {"type": "message", "message": ser_one(row, uid)})
    if kind not in ("svc", "greet"):
        threading.Thread(target=notify_offline_members, args=(ch, row, sender, kind, text), daemon=True).start()
    if reply_to and kind not in ("svc", "greet"):
        bump_comment_count(reply_to)
    return ser_one(row, sender)


def bump_comment_count(reply_to_id):
    """Ответ в привязанной группе обсуждения, адресованный «сообщению-якорю» поста, — увеличить счётчик комментариев у исходного поста канала."""
    anchor = q1("SELECT * FROM messages WHERE id=?", (reply_to_id,))
    if not anchor:
        return
    src = meta_load(anchor.get("meta")).get("src")
    if not isinstance(src, dict) or not src.get("post"):
        return
    post = q1("SELECT * FROM messages WHERE id=?", (src["post"],))
    if not post:
        return
    pm = meta_load(post.get("meta"))
    pm["cc"] = (pm.get("cc") or 0) + 1
    run("UPDATE messages SET meta=? WHERE id=?", (meta_dump(pm), post["id"]))
    if post["receiver"] < 0:
        for uid in member_ids(-post["receiver"]):
            if clients.get(uid):
                push(uid, {"type": "cc", "chat": post["receiver"], "id": post["id"], "cc": pm["cc"]})


def notify_offline_members(ch, row, sender, kind, text):
    """Сообщение пришло в группу/канал, а участника нет в приложении: Web Push / FCM (APK) и, если включено, бот.
    Учитываются «без звука» для чата и настройки уведомлений участника."""
    try:
        s_ = q1("SELECT * FROM users WHERE id=?", (sender,)) or {}
        who = " ".join(x for x in (s_.get("name"), s_.get("surname")) if x) or "Пользователь"
        what = {"photo": "📷 Фото", "gif": "GIF", "voice": "🎤 Голосовое сообщение", "sticker": "Стикер", "file": "📎 Файл"}.get(kind)
        only = row.get("only_u") or 0
        for uid in ([only] if only else member_ids(ch["id"])[:500]):
            if uid == sender or user_visible(uid):
                continue
            # в канале автора не подписываем (если не включена подпись); в группе имя — как в контактах получателя
            w = "" if ch["kind"] == "channel" else dm_title(uid, s_) if s_ else who
            push_message(uid, -ch["id"], ch["title"] or "Dicegram", w, kind, text, row["id"])
            if clients.get(uid):
                continue
            r = q1("SELECT * FROM users WHERE id=?", (uid,))
            if not r or not r.get("tg_id"):
                continue
            prefs = json_load(r.get("prefs"), {})
            n = prefs.get("notif") or {}
            mute = (prefs.get("chat_mute") or {}).get(str(-ch["id"]))
            if not isinstance(n, dict) or not n.get("bot") or mute is True or (isinstance(mute, (int, float)) and mute > time.time()):
                continue
            if not hit("botn", f"{uid}:g{ch['id']}", 1, 120):
                continue
            body_ = what or (text[:80] if n.get("preview", True) and text else "Новое сообщение")
            tg("sendMessage", chat_id=r["tg_id"], text=f"💬 {ch['title']}\n{who}: {body_}", disable_notification=bool(n.get("silent")),
               reply_markup=open_keyboard())
    except Exception as e:
        print("notify_offline_members:", e)


def svc_add(ch, actor, t, to=None, x="", topic=0):
    """Служебное сообщение в чате: «создал(а) группу», «добавил(а) …», «вышел(а)»…"""
    s = {"t": t, "by": {"id": actor, "name": uname(actor)}}
    if to:
        s["to"] = [{"id": i, "name": uname(i)} for i in to[:20]]
        if len(to) > 20:
            s["more"] = len(to) - 20
    if x:
        s["x"] = str(x)[:80]
    return add_gmessage(ch, actor, "", None, "svc", svc=s, topic=topic)


def audit(ch, actor, kind, target=0, data=None):
    """Запись в журнал последних действий группы/канала: кто что сделал и когда (видно только администраторам)."""
    run("INSERT INTO chat_audit(chat_id,actor,target,kind,data,ts) VALUES(?,?,?,?,?,?)",
        (ch["id"], actor or 0, target or 0, kind, json.dumps(data, ensure_ascii=False) if data else "", int(time.time())))


def group_unread(uid):
    """{chat_id: непрочитанных} по всем чатам, где состоит пользователь."""
    out = {}
    for m in qa("SELECT chat_id, last_read, first_id FROM chat_members WHERE user_id=?", (uid,)):
        r = q1("""SELECT COUNT(*) n FROM messages WHERE receiver=? AND id>? AND id>=? AND sender!=? AND (only_u=0 OR only_u=?)
                  AND COALESCE(kind,'text') NOT IN ('svc')""",
               (-m["chat_id"], m["last_read"], m["first_id"], uid, uid))
        out[m["chat_id"]] = r["n"] if r else 0
    return out


def group_chat_items(uid):
    """Группы и каналы пользователя для списка чатов: [(последнее_сообщение, chat_public, непрочитанных)]."""
    items = []
    un = group_unread(uid)
    for m in qa("SELECT * FROM chat_members WHERE user_id=?", (uid,)):
        ch = chat_row(m["chat_id"])
        if not ch:
            continue
        last = q1("""SELECT * FROM messages WHERE receiver=? AND id>=? AND (only_u=0 OR only_u=?) ORDER BY id DESC LIMIT 1""",
                  (-ch["id"], m["first_id"], uid))
        if last:
            items.append((last, chat_public(ch, m), un.get(ch["id"], 0)))
    return items


def pins_for_group(cid, uid, first_id):
    rows = qa("""SELECT * FROM messages WHERE pin>0 AND receiver=? AND id>=? AND only_u=0 ORDER BY pin DESC, id DESC LIMIT 50""", (-cid, first_id))
    out = []
    for r in rows:
        v = reply_view(r, uid)
        if v:
            v["pin"] = r["pin"]
            out.append(v)
    return out


def check_post(ch, m, kind, text, att):
    """Можно ли этому участнику отправить такое сообщение (права, ссылки, медленный режим). Ошибка — ValueError."""
    if ch["kind"] == "channel":
        if not has_right(ch, m, "post"):
            raise ValueError("В канале публиковать могут только администраторы")
        return
    p = eff_perms(ch, m)
    mime = (att or {}).get("mime", "") or ""
    if kind == "photo":
        need = "video" if mime.startswith("video/") else "photo"
    elif kind == "file":
        need = "music" if mime.startswith("audio/") else "video" if mime.startswith("video/") else "file"
    elif kind in ("voice", "sticker", "gif"):
        need = kind
    else:
        need = "text"
    if not p.get(need):
        raise ValueError(NOPERM[need])
    if text and not p.get("links") and URL_IN_TEXT.search(text):
        raise ValueError("В этой группе нельзя отправлять ссылки")
    if m["role"] == "member" and ch["slow"]:
        wait = (m.get("last_send") or 0) + ch["slow"] - int(time.time())
        if wait > 0:
            raise ValueError("Медленный режим: подождите %s" % (f"{wait} с" if wait < 60 else f"{(wait + 59) // 60} мин"))


def g_send(u, to, d, cid):
    ch, m = ctx(u, -to)
    if not ch or not m:
        return err("Нельзя отправить")
    try:
        kind, text, ents, att, reply_to = parse_payload(u, d, to)
        check_post(ch, m, kind, text, att)
    except ValueError as e:
        return err(str(e))
    topic = 0
    if ch["kind"] == "group" and ch["topics"]:
        topic = num(d.get("topic"), 0, 2 ** 62) or 0
        if topic:
            t = q1("SELECT * FROM chat_topics WHERE id=? AND chat_id=?", (topic, ch["id"]))
            if not t:
                return err("Тема не найдена")
            if t["closed"] and m["role"] == "member":
                return err("Тема закрыта")
    if not hit("send", u["id"], 20, 10):
        return err("Слишком часто. Подождите пару секунд", 429)
    msg = add_gmessage(ch, u["id"], text, cid, kind, ents, att, reply_to, topic=topic)
    run("UPDATE chat_members SET last_send=? WHERE chat_id=? AND user_id=?", (int(time.time()), ch["id"], u["id"]))
    if topic and text and is_admin(u):
        try:
            hc_dispatch(ch, u, topic, text)
        except Exception as e:
            print("hc_dispatch error:", e)
    return jsonify(ok=True, message=msg)


def g_messages(u, cid):
    ch, m = ctx(u, cid)
    if not ch or not m:
        return err("Нет доступа", 403)
    sweep_expired()
    before = request.args.get("before", type=int)
    limit = max(1, min(request.args.get("limit", 200, type=int), 200))
    topic = request.args.get("topic", type=int)
    cond, args = "receiver=? AND id>=? AND (only_u=0 OR only_u=?) AND id<?", [-cid, m["first_id"], u["id"], before or 2 ** 62]
    if topic is not None:
        cond += " AND topic=?"
        args.append(topic)
    rows = qa(f"SELECT * FROM messages WHERE {cond} ORDER BY id DESC LIMIT ?", args + [limit])[::-1]
    if before is None and not request.args.get("peek"):
        mark_group_read(cid, u["id"])
    resp = {"ok": True, "messages": ser_many(rows, u["id"]), "has_more": len(rows) == limit}
    if before is None or request.args.get("pins"):
        resp["pins"] = pins_for_group(cid, u["id"], m["first_id"])
    return jsonify(resp)


def mark_group_read(cid, uid):
    top = (q1("SELECT MAX(id) m FROM messages WHERE receiver=?", (-cid,)) or {}).get("m") or 0
    run("UPDATE chat_members SET last_read=? WHERE chat_id=? AND user_id=? AND last_read<?", (top, cid, uid, top))


def ensure_primary_link(ch, creator):
    r = q1("SELECT * FROM chat_links WHERE chat_id=? AND prim=1 AND revoked=0", (ch["id"],))
    if r:
        return r
    slug = secrets.token_urlsafe(12).replace("-", "A").replace("_", "B")[:16]
    run("INSERT INTO chat_links(slug,chat_id,creator,prim,ts) VALUES(?,?,?,1,?)", (slug, ch["id"], creator, int(time.time())))
    return q1("SELECT * FROM chat_links WHERE slug=?", (slug,))


def link_url(slug, pref="j"):
    if BOT_APP_LINK:
        return f"{BOT_APP_LINK}{'&' if '?' in BOT_APP_LINK else '?'}startapp={pref}_{slug}"
    return WEB_URL.rstrip("/") + f"/#{pref}={slug}"


def link_out(l):
    return {"slug": l["slug"], "url": link_url(l["slug"]), "title": l["title"] or "", "prim": int(l["prim"]), "expires": l["expires"] or 0,
            "lim": l["lim"] or 0, "uses": l["uses"] or 0, "revoked": int(l["revoked"]), "creator": l["creator"], "ts": l["ts"]}


def join_chat(ch, uid, adder=0, by=None):
    """Добавить человека в чат. True — вошёл сейчас, False — уже был. Ошибка — ValueError.
    adder — кто стоит в chat_members.adder (для прав: кого назначил/добавил этот человек);
    by — кто на самом деле совершил вход, для журнала действий (по умолчанию — сам uid, то есть самостоятельный вход,
    даже если adder указывает на создателя пригласительной ссылки)."""
    cid = ch["id"]
    if q1("SELECT 1 FROM chat_bans WHERE chat_id=? AND user_id=?", (cid, uid)):
        raise ValueError("Вы заблокированы в этом канале" if ch["kind"] == "channel" else "Вы заблокированы в этой группе")
    with db_lock:
        if member_row(cid, uid):
            return False
        if member_count(cid) >= MAX_MEMBERS:
            raise ValueError("В чате слишком много участников")
        top = (q1("SELECT MAX(id) m FROM messages WHERE receiver=?", (-cid,)) or {}).get("m") or 0
        first = 0 if (ch["kind"] == "channel" or ch["hist"]) else top + 1
        run("INSERT INTO chat_members(chat_id,user_id,role,joined,last_read,adder,first_id) VALUES(?,?,'member',?,?,?,?)",
            (cid, uid, int(time.time()), top, adder or 0, first))
    actor = uid if by is None else by
    if actor != uid:
        audit(ch, actor, "add", uid)
    else:
        audit(ch, uid, "join", 0)
    return True


def send_greeting(ch, uid):
    """Приветствие группы: каждому новому участнику — один раз и только ему."""
    if ch["kind"] != "group" or not ch["greet_on"] or not (ch["greet"] or "").strip():
        return
    if q1("SELECT 1 FROM messages WHERE receiver=? AND only_u=? AND kind='greet' LIMIT 1", (-ch["id"], uid)):
        return
    add_gmessage(ch, ch["owner"], ch["greet"], None, "greet", only=uid)


def add_members(ch, actor, ids):
    """Добавить нескольких человек: одно служебное сообщение «X добавил(а) …». Возвращает список добавленных."""
    added = []
    for i in ids:
        try:
            if join_chat(ch, i, actor, by=actor):
                added.append(i)
        except ValueError:
            continue
    if added:
        for i in added:
            if clients.get(i):
                push(i, {"type": "chat", "chat": chat_public(ch, member_row(ch["id"], i)), "joined": True})
        if ch["kind"] == "group":
            svc_add(ch, actor, "add", added)
        for i in added:
            send_greeting(ch, i)
        push_chat_update(ch)
    return added


def destroy_chat(ch):
    cid = ch["id"]
    ids = member_ids(cid)
    rows = qa("SELECT id, fid, tfid FROM messages WHERE receiver=?", (-cid,))
    with db_lock:
        for r in rows:
            run("DELETE FROM reacts WHERE msg_id=?", (r["id"],))
        run("DELETE FROM messages WHERE receiver=?", (-cid,))
        for t in ("chat_members", "chat_bans", "chat_links", "chat_topics"):
            run(f"DELETE FROM {t} WHERE chat_id=?", (cid,))
        run("DELETE FROM chats WHERE id=?", (cid,))
    gc_files([x for r in rows for x in (r["fid"], r["tfid"])])
    if ch.get("photo"):
        try:
            os.remove(os.path.join(AVATAR_DIR, ch["photo"]))
        except OSError:
            pass
    with vlock:
        vrooms.pop(cid, None)
    for uid in ids:
        push(uid, {"type": "chat_gone", "id": -cid})


def audience(row):
    return member_ids(-row["receiver"]) if row["receiver"] < 0 else [row["sender"], row["receiver"]]


def clean_title(v):
    return re.sub(r"\s+", " ", str(v or "")).strip()[:64]


def save_photo(prefix, data):
    m = re.match(r"^data:image/(jpeg|png|webp);base64,(.+)$", str(data or ""), re.S)
    if not m:
        raise ValueError("Неверный формат фото")
    try:
        raw = base64.b64decode(m.group(2), validate=True)
    except Exception:
        raise ValueError("Неверный формат фото")
    if len(raw) > 400_000:
        raise ValueError("Фото слишком большое")
    ext = ("jpg" if raw[:3] == b"\xff\xd8\xff" else "png" if raw[:8] == b"\x89PNG\r\n\x1a\n"
           else "webp" if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP" else None)
    if not ext:
        raise ValueError("Неверный формат фото")
    fname = f"{prefix}_{secrets.token_hex(6)}.{ext}"
    with open(os.path.join(AVATAR_DIR, fname), "wb") as f:
        f.write(raw)
    return fname


def drop_photo(name):
    if name:
        try:
            os.remove(os.path.join(AVATAR_DIR, name))
        except OSError:
            pass


# ── создание, сведения, настройки ──
@app.post("/api/chat/create")
def chat_create():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    kind = d.get("kind")
    if kind not in ("group", "channel"):
        return err("Неверные данные")
    title = clean_title(d.get("title"))
    if not title:
        return err("Введите название")
    if not hit("chatnew", u["id"], 10, 3600):
        return err("Слишком часто. Попробуйте позже", 429)
    if (q1("SELECT COUNT(*) n FROM chats WHERE owner=?", (u["id"],)) or {}).get("n", 0) >= MAX_OWNED:
        return err("Можно создать не больше %d групп и каналов" % MAX_OWNED)
    about = str(d.get("about") or "").strip()[:255]
    auto = num(d.get("auto_del"), 0, AUTO_DEL_MAX) or 0
    now = int(time.time())
    with db_lock:
        cid = run("INSERT INTO chats(kind,title,about,owner,ts,auto_del) VALUES(?,?,?,?,?,?)", (kind, title, about, u["id"], now, auto)).lastrowid
        run("INSERT INTO chat_members(chat_id,user_id,role,joined,adder) VALUES(?,?,'owner',?,0)", (cid, u["id"], now))
    ch = chat_row(cid)
    ensure_primary_link(ch, u["id"])
    if d.get("photo"):
        try:
            name = save_photo(f"g{cid}", d.get("photo"))
            run("UPDATE chats SET photo=? WHERE id=?", (name, cid))
        except ValueError:
            pass
    svc_add(chat_row(cid), u["id"], "create")
    ids = [i for i in (num(x, 1, 2 ** 62) for x in (d.get("members") or [])[:200] if isinstance(d.get("members"), list)) if i and i != u["id"] and is_contact(u["id"], i)]
    if ids:
        add_members(chat_row(cid), u["id"], ids)
    ch = chat_row(cid)
    return jsonify(ok=True, chat=chat_full(ch, member_row(cid, u["id"])))


@app.get("/api/chat/<int:cid>")
def chat_info(cid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m:
        return err("Нет доступа", 403)
    return jsonify(ok=True, chat=chat_full(ch, m))


@app.post("/api/chat/<int:cid>/update")
def chat_update(cid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m:
        return err("Нет доступа", 403)
    d = body()
    can_info = can_do(ch, m, "info")
    sets, vals, notes = [], [], []
    old_title = ch["title"]

    def put(col, v):
        sets.append(f"{col}=?")
        vals.append(v)

    if "title" in d or "about" in d:
        if not can_info:
            return err("Нет прав на изменение", 403)
        if "title" in d:
            t = clean_title(d.get("title"))
            if not t:
                return err("Введите название")
            put("title", t)
        if "about" in d:
            put("about", str(d.get("about") or "").strip()[:255])
    settings_keys = ("slug", "hist", "topics", "react_mode", "react_list", "greet", "greet_on", "perms", "slow", "auto_del", "sign", "disc_chat_id")
    if any(k in d for k in settings_keys):
        if not has_right(ch, m, "info"):
            return err("Нет прав на изменение", 403)
        if "slug" in d:
            sl = str(d.get("slug") or "").strip().lstrip("@")
            if sl and not SLUG_RE.match(sl):
                return err("Адрес: от 4 до 32 символов — латиница, цифры, _. Должен начинаться с буквы")
            if sl and name_reserved(sl, u):
                return err("Этот адрес зарезервирован")
            if sl and name_taken(sl, skip_chat=cid):
                return err("Такой адрес уже занят")
            put("slug", sl)
        if "hist" in d:
            put("hist", 1 if d.get("hist") else 0)
        if "topics" in d:
            if ch["kind"] != "group":
                return err("Темы доступны только в группах")
            put("topics", 1 if d.get("topics") else 0)
        if "react_mode" in d:
            if d.get("react_mode") not in ("all", "some", "none"):
                return err("Неверные данные")
            put("react_mode", d["react_mode"])
        if "react_list" in d:
            lst = [str(e)[:16] for e in (d.get("react_list") or [])[:30] if isinstance(e, str) and e and ord(e[0]) >= 0x80] if isinstance(d.get("react_list"), list) else []
            put("react_list", json.dumps(lst, ensure_ascii=False))
        if "greet" in d:
            put("greet", str(d.get("greet") or "").strip()[:500])
        if "greet_on" in d:
            put("greet_on", 1 if d.get("greet_on") else 0)
        if "perms" in d:
            if ch["kind"] != "group" or not isinstance(d.get("perms"), dict):
                return err("Неверные данные")
            cur = chat_perms(ch)
            for k, v in d["perms"].items():
                if k in PERM_DEFAULT:
                    cur[k] = 1 if v else 0
            put("perms", json.dumps(cur))
        if "slow" in d:
            sv = num(d.get("slow"), 0, 3600)
            if sv is None or sv not in SLOW_STEPS or ch["kind"] != "group":
                return err("Неверные данные")
            put("slow", sv)
        if "auto_del" in d:
            put("auto_del", num(d.get("auto_del"), 0, AUTO_DEL_MAX) or 0)
        if "sign" in d:
            put("sign", 1 if d.get("sign") else 0)
        if "disc_chat_id" in d:
            if ch["kind"] != "channel":
                return err("Обсуждение доступно только в каналах")
            gid = num(d.get("disc_chat_id"), 0, 2 ** 62) or 0
            if gid:
                gch, gm = ctx(u, gid)
                if not gch or gch["kind"] != "group" or not gm or gm["role"] not in ("owner", "admin"):
                    return err("Выберите группу, которой вы управляете")
                other = q1("SELECT id FROM chats WHERE kind='channel' AND disc_chat_id=? AND id!=?", (gid, cid))
                if other:
                    return err("Эта группа уже привязана к другому каналу")
            put("disc_chat_id", gid)
    if not sets:
        return jsonify(ok=True, chat=chat_full(ch, m))
    touched = [s.split("=")[0] for s in sets]
    run(f"UPDATE chats SET {', '.join(sets)} WHERE id=?", vals + [cid])
    ch = chat_row(cid)
    if "title" in d and ch["title"] != old_title:
        svc_add(ch, u["id"], "title", x=ch["title"])
    audit(ch, u["id"], "settings", 0, {"keys": touched})
    push_chat_update(ch)
    return jsonify(ok=True, chat=chat_full(ch, member_row(cid, u["id"])))


@app.post("/api/chat/<int:cid>/comment/<int:mid>")
def chat_comment_open(cid, mid):
    """Открыть (или создать) ветку обсуждения конкретного поста канала в привязанной группе — «Комментарии», как в Telegram."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or ch["kind"] != "channel" or not m:
        return err("Нет доступа", 403)
    if not ch.get("disc_chat_id"):
        return err("К каналу не привязана группа обсуждения")
    post = q1("SELECT * FROM messages WHERE id=? AND receiver=?", (mid, -cid))
    if not post:
        return err("Сообщение не найдено", 404)
    gch = chat_row(ch["disc_chat_id"])
    if not gch:
        return err("Группа обсуждения недоступна")
    if q1("SELECT 1 FROM chat_bans WHERE chat_id=? AND user_id=?", (gch["id"], u["id"])):
        return err("Вы заблокированы в этой группе", 403)
    if not member_row(gch["id"], u["id"]):
        try:
            join_chat(gch, u["id"])
        except ValueError as e:
            return err(str(e), 403)
    pm = meta_load(post.get("meta"))
    anchor_id = pm.get("dm")
    if not anchor_id or not q1("SELECT 1 FROM messages WHERE id=?", (anchor_id,)):
        preview = decrypt_text(post["text"]) or {"photo": "📷 Фото", "gif": "GIF", "file": "📎 Файл", "voice": "🎤 Голосовое", "sticker": "Стикер"}.get(post.get("kind"), "")
        anchor = add_gmessage(gch, ch["owner"], preview[:300], None, "text", fw={"name": ch["title"], "hidden": 1})
        anchor_id = anchor["id"]
        pm["dm"] = anchor_id
        run("UPDATE messages SET meta=? WHERE id=?", (meta_dump(pm), post["id"]))
        am = meta_load((q1("SELECT meta FROM messages WHERE id=?", (anchor_id,)) or {}).get("meta"))
        am["src"] = {"chat": cid, "post": mid}
        run("UPDATE messages SET meta=? WHERE id=?", (meta_dump(am), anchor_id))
    return jsonify(ok=True, anchor=anchor_id, chat=chat_public(gch, member_row(gch["id"], u["id"])))


@app.post("/api/chat/<int:cid>/photo")
def chat_photo(cid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m or not can_do(ch, m, "info"):
        return err("Нет прав на изменение", 403)
    d = body()
    old = ch["photo"]
    try:
        name = save_photo(f"g{cid}", d["data"]) if d.get("data") else ""
    except ValueError as e:
        return err(str(e))
    run("UPDATE chats SET photo=? WHERE id=?", (name, cid))
    drop_photo(old)
    ch = chat_row(cid)
    if name:
        svc_add(ch, u["id"], "photo")
    audit(ch, u["id"], "photo" if name else "photo_rm")
    push_chat_update(ch)
    return jsonify(ok=True, chat=chat_full(ch, member_row(cid, u["id"])))


@app.post("/api/chat/<int:cid>/leave")
def chat_leave(cid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m:
        return err("Нет доступа", 403)
    if m["role"] == "owner":                      # владелец выходит = группа удаляется
        destroy_chat(ch)
        return jsonify(ok=True, deleted=True)
    run("DELETE FROM chat_members WHERE chat_id=? AND user_id=?", (cid, u["id"]))
    leave_vc(cid, u["id"])
    if ch["kind"] == "group":
        svc_add(ch, u["id"], "leave")
    audit(ch, u["id"], "leave")
    push_chat_update(ch)
    push(u["id"], {"type": "chat_gone", "id": -cid})
    return jsonify(ok=True)


@app.post("/api/chat/<int:cid>/delete")
def chat_delete(cid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m or m["role"] != "owner":
        return err("Удалить может только владелец", 403)
    destroy_chat(ch)
    return jsonify(ok=True)


# ── участники ──
def member_out(m, viewer, ch):
    u = q1("SELECT * FROM users WHERE id=?", (m["user_id"],))
    if not u:
        return None
    d = {"user": public(u, viewer=viewer), "role": m["role"], "tag": m.get("tag") or "", "joined": m["joined"], "adder": m.get("adder") or 0}
    if m["role"] == "admin":
        d["rights"] = my_rights(ch, m)
    if m.get("restr") and (not m.get("until") or m["until"] > time.time()):
        d["restr"] = json_load(m["restr"], {})
        d["until"] = m.get("until") or 0
    return d


@app.get("/api/chat/<int:cid>/members")
def chat_members(cid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m:
        return err("Нет доступа", 403)
    if ch["kind"] == "channel" and m["role"] == "member":
        return err("Нет доступа", 403)
    q = request.args.get("q", "").strip().lower()[:40]
    role = request.args.get("role", "")
    limit = max(1, min(request.args.get("limit", 100, type=int), 200))
    offset = max(0, request.args.get("offset", 0, type=int))
    cond, args = "chat_id=?", [cid]
    if role == "admin":
        cond += " AND role IN ('owner','admin')"
    rows = qa(f"""SELECT * FROM chat_members WHERE {cond}
                  ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, joined, user_id""", args)
    out = []
    for r in rows:
        o = member_out(r, u["id"], ch)
        if not o:
            continue
        if q:
            nm = ((o["user"]["name"] or "") + " " + (o["user"]["surname"] or "") + " " + (o["user"]["username"] or "")).lower()
            if q not in nm:
                continue
        out.append(o)
    total = len(out)
    return jsonify(ok=True, members=out[offset:offset + limit], total=total)


@app.post("/api/chat/<int:cid>/add")
def chat_add(cid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m:
        return err("Нет доступа", 403)
    if not can_do(ch, m, "invite"):
        return err("Нет прав на добавление участников", 403)
    d = body()
    ids = [i for i in (num(x, 1, 2 ** 62) for x in (d.get("users") or [])[:50]) if i] if isinstance(d.get("users"), list) else []
    ids = [i for i in dict.fromkeys(ids) if i != u["id"]]
    if not ids:
        return err("Выберите, кого добавить")
    bad = [i for i in ids if not q1("SELECT 1 FROM users WHERE id=? AND is_system=0", (i,)) or not is_contact(u["id"], i)]
    if bad and len(bad) == len(ids):
        return err("Добавлять можно только тех, с кем вы общались")
    if not hit("chatadd", u["id"], 30, 60):
        return err("Слишком часто. Подождите минуту", 429)
    ids = [i for i in ids if i not in bad]
    banned = [i for i in ids if q1("SELECT 1 FROM chat_bans WHERE chat_id=? AND user_id=?", (cid, i))]
    if banned and not has_right(ch, m, "ban"):
        ids = [i for i in ids if i not in banned]
    else:
        for i in banned:
            run("DELETE FROM chat_bans WHERE chat_id=? AND user_id=?", (cid, i))
    added = add_members(ch, u["id"], ids)
    return jsonify(ok=True, added=added, chat=chat_full(chat_row(cid), member_row(cid, u["id"])))


@app.post("/api/chat/<int:cid>/remove")
def chat_remove(cid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m or not has_right(ch, m, "ban"):
        return err("Нет прав", 403)
    d = body()
    tid = num(d.get("user"), 1, 2 ** 62)
    t = member_row(cid, tid) if tid else None
    if not t or t["role"] == "owner" or tid == u["id"]:
        return err("Нельзя удалить этого участника")
    if t["role"] == "admin" and m["role"] != "owner" and t.get("adder") != u["id"]:
        return err("Администратора может удалить только владелец или тот, кто его назначил", 403)
    run("DELETE FROM chat_members WHERE chat_id=? AND user_id=?", (cid, tid))
    leave_vc(cid, tid)
    if d.get("ban"):
        run("INSERT OR REPLACE INTO chat_bans(chat_id,user_id,ts,adder) VALUES(?,?,?,?)", (cid, tid, int(time.time()), u["id"]))
    if ch["kind"] == "group":
        svc_add(ch, u["id"], "ban" if d.get("ban") else "kick", [tid])
    audit(ch, u["id"], "ban" if d.get("ban") else "kick", tid)
    push(tid, {"type": "chat_gone", "id": -cid})
    push_chat_update(ch)
    return jsonify(ok=True)


@app.get("/api/chat/<int:cid>/banned")
def chat_banned(cid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m or not has_right(ch, m, "ban"):
        return err("Нет прав", 403)
    out = []
    for b in qa("SELECT * FROM chat_bans WHERE chat_id=? ORDER BY ts DESC LIMIT 200", (cid,)):
        x = q1("SELECT * FROM users WHERE id=?", (b["user_id"],))
        if x:
            out.append({"user": public(x, viewer=u["id"]), "ts": b["ts"], "adder": b["adder"]})
    return jsonify(ok=True, banned=out)


@app.post("/api/chat/<int:cid>/unban")
def chat_unban(cid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m or not has_right(ch, m, "ban"):
        return err("Нет прав", 403)
    tid = num(body().get("user"), 1, 2 ** 62)
    run("DELETE FROM chat_bans WHERE chat_id=? AND user_id=?", (cid, tid or 0))
    if tid:
        audit(ch, u["id"], "unban", tid)
    return jsonify(ok=True)


@app.post("/api/chat/<int:cid>/admin")
def chat_admin(cid):
    """{user, rights: {ключ: 0/1} | null (снять), tag} — назначить администратора, изменить его права или снять."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m or not has_right(ch, m, "admins"):
        return err("Нет прав", 403)
    d = body()
    tid = num(d.get("user"), 1, 2 ** 62)
    t = member_row(cid, tid) if tid else None
    if not t or t["role"] == "owner" or tid == u["id"]:
        return err("Нельзя изменить этого участника")
    mine = my_rights(ch, m)
    if d.get("rights") is None:                   # снять администратора
        if t["role"] != "admin":
            return err("Он не администратор")
        if m["role"] != "owner" and t.get("adder") != u["id"]:
            return err("Снять администратора может только владелец или тот, кто его назначил", 403)
        run("UPDATE chat_members SET role='member', rights='', tag='' WHERE chat_id=? AND user_id=?", (cid, tid))
        if ch["kind"] == "group":
            svc_add(ch, u["id"], "demote", [tid])
        audit(ch, u["id"], "demote", tid)
    else:
        if not isinstance(d.get("rights"), dict):
            return err("Неверные данные")
        if t["role"] == "admin" and m["role"] != "owner" and t.get("adder") != u["id"]:
            return err("Изменить права может только владелец или тот, кто его назначил", 403)
        want = {k: 1 for k in rights_keys(ch) if d["rights"].get(k)}
        if any(k not in mine for k in want):
            return err("Нельзя выдать права, которых нет у вас", 403)
        tag = re.sub(r"\s+", " ", str(d.get("tag") or "")).strip()[:16]
        was = t["role"] == "admin"
        run("UPDATE chat_members SET role='admin', rights=?, tag=?, adder=? WHERE chat_id=? AND user_id=?",
            (json.dumps(want), tag, t.get("adder") if was else u["id"], cid, tid))
        if not was and ch["kind"] == "group":
            svc_add(ch, u["id"], "promote", [tid])
        audit(ch, u["id"], "promote" if not was else "rights", tid, {"rights": list(want)})
    ch = chat_row(cid)
    for uid in (tid, u["id"]):
        if clients.get(uid):
            push(uid, {"type": "chat", "chat": chat_public(ch, member_row(cid, uid))})
    return jsonify(ok=True, member=member_out(member_row(cid, tid), u["id"], ch))


@app.post("/api/chat/<int:cid>/restrict")
def chat_restrict(cid):
    """{user, perms: {ключ: 0/1} | null, until} — личные ограничения участника группы."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m or not has_right(ch, m, "ban") or ch["kind"] != "group":
        return err("Нет прав", 403)
    d = body()
    tid = num(d.get("user"), 1, 2 ** 62)
    t = member_row(cid, tid) if tid else None
    if not t or t["role"] != "member":
        return err("Нельзя ограничить этого участника")
    perms = d.get("perms")
    if perms is None:
        run("UPDATE chat_members SET restr='', until=0 WHERE chat_id=? AND user_id=?", (cid, tid))
        audit(ch, u["id"], "unrestrict", tid)
    else:
        if not isinstance(perms, dict):
            return err("Неверные данные")
        clean = {k: 1 if v else 0 for k, v in perms.items() if k in PERM_DEFAULT}
        until = num(d.get("until"), 0, 2 ** 40) or 0
        run("UPDATE chat_members SET restr=?, until=? WHERE chat_id=? AND user_id=?", (json.dumps(clean), until, cid, tid))
        audit(ch, u["id"], "restrict", tid)
    push(tid, {"type": "chat", "chat": chat_public(ch, member_row(cid, tid))})
    return jsonify(ok=True, member=member_out(member_row(cid, tid), u["id"], ch))


@app.get("/api/chat/<int:cid>/actions")
def chat_actions(cid):
    """Журнал последних действий (как в Telegram): кто кого добавил/удалил/назначил, что поменял в настройках.
    Видно только владельцу и администраторам. ?before=<id>&limit=<n> — пагинация назад."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m or m["role"] not in ("owner", "admin"):
        return err("Нет прав", 403)
    before = request.args.get("before", type=int) or 2 ** 62
    limit = max(1, min(request.args.get("limit", 50, type=int), 100))
    rows = qa("SELECT * FROM chat_audit WHERE chat_id=? AND id<? ORDER BY id DESC LIMIT ?", (cid, before, limit))
    out = []
    for r in rows:
        x = {"id": r["id"], "kind": r["kind"], "ts": r["ts"], "actor": public_mini(r["actor"], u["id"])}
        if r["target"]:
            x["target"] = public_mini(r["target"], u["id"])
        if r.get("data"):
            try:
                x["data"] = json.loads(r["data"])
            except Exception:
                pass
        out.append(x)
    return jsonify(ok=True, actions=out, has_more=len(rows) == limit)


def public_mini(uid, viewer):
    t = q1("SELECT * FROM users WHERE id=?", (uid,)) if uid else None
    return public(t, viewer=viewer) if t else {"id": uid, "name": "Пользователь", "surname": ""}


@app.post("/api/chat/<int:cid>/tag")
def chat_tag(cid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m or ch["kind"] != "group" or not can_do(ch, m, "tag"):
        return err("Нет прав", 403)
    tag = re.sub(r"\s+", " ", str(body().get("tag") or "")).strip()[:16]
    run("UPDATE chat_members SET tag=? WHERE chat_id=? AND user_id=?", (tag, cid, u["id"]))
    push_chat_update(ch)
    return jsonify(ok=True, tag=tag)


# ── пригласительные ссылки ──
def link_check(ch, m):
    return bool(m and (can_do(ch, m, "invite")))


@app.get("/api/chat/<int:cid>/links")
def chat_links(cid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m or not link_check(ch, m):
        return err("Нет прав", 403)
    prim = ensure_primary_link(ch, ch["owner"])
    others = qa("SELECT * FROM chat_links WHERE chat_id=? AND prim=0 AND revoked=0 ORDER BY ts DESC", (cid,)) if m["role"] != "member" else []
    revoked = qa("SELECT * FROM chat_links WHERE chat_id=? AND revoked=1 ORDER BY ts DESC LIMIT 20", (cid,)) if m["role"] != "member" else []
    return jsonify(ok=True, primary=link_out(prim), links=[link_out(l) for l in others], revoked=[link_out(l) for l in revoked],
                   public=link_url(ch["slug"], "p") if ch["slug"] else "")


@app.post("/api/chat/<int:cid>/link")
def chat_link_new(cid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m or m["role"] == "member" or not link_check(ch, m):
        return err("Нет прав", 403)
    d = body()
    if (q1("SELECT COUNT(*) n FROM chat_links WHERE chat_id=? AND revoked=0", (cid,)) or {}).get("n", 0) >= MAX_LINKS:
        return err("Можно создать не больше %d ссылок" % MAX_LINKS)
    exp_in = num(d.get("expires_in"), 0, 366 * 86400) or 0
    lim = num(d.get("lim"), 0, 99999) or 0
    slug = secrets.token_urlsafe(12).replace("-", "A").replace("_", "B")[:16]
    run("INSERT INTO chat_links(slug,chat_id,creator,title,prim,expires,lim,ts) VALUES(?,?,?,?,0,?,?,?)",
        (slug, cid, u["id"], str(d.get("title") or "").strip()[:32], int(time.time()) + exp_in if exp_in else 0, lim, int(time.time())))
    return jsonify(ok=True, link=link_out(q1("SELECT * FROM chat_links WHERE slug=?", (slug,))))


@app.post("/api/chat/<int:cid>/link/edit")
def chat_link_edit(cid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m or m["role"] == "member" or not link_check(ch, m):
        return err("Нет прав", 403)
    d = body()
    l = q1("SELECT * FROM chat_links WHERE slug=? AND chat_id=?", (str(d.get("slug") or ""), cid))
    if not l or l["prim"]:
        return err("Ссылка не найдена", 404)
    if l["creator"] != u["id"] and m["role"] != "owner":
        return err("Нет прав", 403)
    exp_in = num(d.get("expires_in"), 0, 366 * 86400) or 0
    run("UPDATE chat_links SET title=?, expires=?, lim=? WHERE slug=?",
        (str(d.get("title") or "").strip()[:32], int(time.time()) + exp_in if exp_in else 0, num(d.get("lim"), 0, 99999) or 0, l["slug"]))
    return jsonify(ok=True, link=link_out(q1("SELECT * FROM chat_links WHERE slug=?", (l["slug"],))))


@app.post("/api/chat/<int:cid>/link/revoke")
def chat_link_revoke(cid):
    """Отозвать ссылку. Основную отзывать можно: сразу создаётся новая основная (старая перестаёт работать)."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m or m["role"] == "member" or not link_check(ch, m):
        return err("Нет прав", 403)
    l = q1("SELECT * FROM chat_links WHERE slug=? AND chat_id=?", (str(body().get("slug") or ""), cid))
    if not l:
        return err("Ссылка не найдена", 404)
    if l["creator"] != u["id"] and m["role"] != "owner" and not l["prim"]:
        return err("Нет прав", 403)
    run("UPDATE chat_links SET revoked=1 WHERE slug=?", (l["slug"],))
    prim = ensure_primary_link(ch, ch["owner"])
    return jsonify(ok=True, primary=link_out(prim))


@app.get("/api/join/<slug>")
def join_preview(slug):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, l = resolve_join(slug)
    if not ch:
        return err("Ссылка недействительна или устарела", 404)
    m = member_row(ch["id"], u["id"])
    d = chat_public(ch, m)
    d.update(bio=ch["about"] or "", joined=bool(m))
    if not m and q1("SELECT 1 FROM chat_bans WHERE chat_id=? AND user_id=?", (ch["id"], u["id"])):
        d["banned"] = True                                  # клиент покажет «Вы заблокированы в группе» вместо кнопки «Вступить»
    return jsonify(ok=True, chat=d)


def resolve_join(slug):
    """Чат по пригласительной ссылке или по публичному адресу. (chat, link|None)"""
    slug = str(slug or "")
    if not LINK_RE.match(slug):
        return None, None
    l = q1("SELECT * FROM chat_links WHERE slug=?", (slug,))
    if l:
        ch = chat_row(l["chat_id"])
        if not ch or l["revoked"]:
            return None, None
        if l["expires"] and l["expires"] < time.time():
            return None, None
        if l["lim"] and l["uses"] >= l["lim"]:
            return None, None
        return ch, l
    ch = q1("SELECT * FROM chats WHERE slug=? COLLATE NOCASE", (slug,))
    return (ch, None) if ch else (None, None)


@app.post("/api/join")
def join_do():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    if not hit("join", u["id"], 20, 60):
        return err("Слишком часто. Попробуйте позже", 429)
    ch, l = resolve_join(body().get("slug"))
    if not ch:
        return err("Ссылка недействительна или устарела", 404)
    try:
        joined = join_chat(ch, u["id"], l["creator"] if l else 0, by=u["id"])
    except ValueError as e:
        return err(str(e), 403)
    if joined:
        if l:
            run("UPDATE chat_links SET uses=uses+1 WHERE slug=?", (l["slug"],))
        if ch["kind"] == "group":
            svc_add(ch, u["id"], "join")
        send_greeting(ch, u["id"])
        push_chat_update(ch)
    return jsonify(ok=True, joined=joined, chat=chat_public(ch, member_row(ch["id"], u["id"])))


# ── темы ──
@app.get("/api/chat/<int:cid>/topics")
def topics_list(cid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m:
        return err("Нет доступа", 403)
    rows = qa("SELECT * FROM chat_topics WHERE chat_id=? ORDER BY id LIMIT ?", (cid, MAX_TOPICS))
    out, lasts = [], []
    for t in [{"id": 0, "title": "Общий", "color": 0, "emoji": "", "closed": 0, "general": 1}] + rows:
        last = q1("""SELECT * FROM messages WHERE receiver=? AND topic=? AND id>=? AND only_u=0 AND kind!='svc' ORDER BY id DESC LIMIT 1""",
                  (-cid, t["id"], m["first_id"]))
        lasts.append(last)
        out.append({"id": t["id"], "title": t["title"], "color": t.get("color") or 0, "emoji": t.get("emoji") or "",
                    "closed": int(t.get("closed") or 0), "general": int(t.get("general") or 0)})
    sers = ser_many([x for x in lasts if x], u["id"])
    it = iter(sers)
    for o, last in zip(out, lasts):
        o["last"] = next(it) if last else None
    out.sort(key=lambda o: (0 if o["general"] else 1, -((o["last"] or {}).get("id") or 0)))
    return jsonify(ok=True, topics=out)


@app.post("/api/chat/<int:cid>/topic")
def topic_new(cid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m or ch["kind"] != "group" or not ch["topics"] or not can_do(ch, m, "topics"):
        return err("Нет прав на создание тем", 403)
    d = body()
    title = clean_title(d.get("title"))[:40]
    if not title:
        return err("Введите название темы")
    if (q1("SELECT COUNT(*) n FROM chat_topics WHERE chat_id=?", (cid,)) or {}).get("n", 0) >= MAX_TOPICS:
        return err("Слишком много тем")
    color = num(d.get("color"), 0, 7) or 0
    emoji = str(d.get("emoji") or "")[:8]
    tid = run("INSERT INTO chat_topics(chat_id,title,color,emoji,creator,ts) VALUES(?,?,?,?,?,?)",
              (cid, title, color, emoji, u["id"], int(time.time()))).lastrowid
    svc_add(ch, u["id"], "topic", x=title, topic=tid)
    push_chat_update(ch)
    return jsonify(ok=True, topic={"id": tid, "title": title, "color": color, "emoji": emoji, "closed": 0, "general": 0})


@app.post("/api/chat/<int:cid>/topic/edit")
def topic_edit(cid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m or not has_right(ch, m, "topics"):
        return err("Нет прав", 403)
    d = body()
    t = q1("SELECT * FROM chat_topics WHERE id=? AND chat_id=?", (num(d.get("id"), 1, 2 ** 62) or 0, cid))
    if not t:
        return err("Тема не найдена", 404)
    title = clean_title(d.get("title"))[:40] if "title" in d else t["title"]
    if not title:
        return err("Введите название темы")
    closed = (1 if d.get("closed") else 0) if "closed" in d else t["closed"]
    run("UPDATE chat_topics SET title=?, closed=?, color=?, emoji=? WHERE id=?",
        (title, closed, num(d.get("color"), 0, 7) if "color" in d and num(d.get("color"), 0, 7) is not None else t["color"],
         str(d.get("emoji"))[:8] if "emoji" in d else t["emoji"], t["id"]))
    push_chat_update(ch)
    return jsonify(ok=True)


@app.post("/api/chat/<int:cid>/topic/delete")
def topic_delete(cid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m or not has_right(ch, m, "topics"):
        return err("Нет прав", 403)
    tid = num(body().get("id"), 1, 2 ** 62) or 0
    t = q1("SELECT * FROM chat_topics WHERE id=? AND chat_id=?", (tid, cid))
    if not t:
        return err("Тема не найдена", 404)
    rows = qa("SELECT * FROM messages WHERE receiver=? AND topic=?", (-cid, tid))
    with db_lock:
        for r in rows:
            run("DELETE FROM reacts WHERE msg_id=?", (r["id"],))
            run("DELETE FROM messages WHERE id=?", (r["id"],))
        run("DELETE FROM chat_topics WHERE id=?", (tid,))
    gc_files([x for r in rows for x in (r.get("fid"), r.get("tfid"))])
    ids = [r["id"] for r in rows]
    if ids:
        chat_push(ch, lambda uid: {"type": "del", "ids": ids})
    push_chat_update(ch)
    return jsonify(ok=True)


# ── действия над сообщениями группы ──
def g_delete(u, rows):
    """Удалить сообщения групп/каналов: свои — всегда, чужие — с правом «удалять сообщения». Возвращает (удалённые id, ошибка)."""
    chats, done, fids = {}, [], []
    for r in rows:
        cid = -r["receiver"]
        if cid not in chats:
            ch = chat_row(cid)
            chats[cid] = (ch, member_row(cid, u["id"]) if ch else None)
        ch, m = chats[cid]
        if not m:
            continue
        if r["sender"] != u["id"] and not has_right(ch, m, "delete"):
            return done, "Нет прав на удаление чужих сообщений"
        if r["kind"] in ("svc", "greet") and not has_right(ch, m, "delete"):
            continue
        with db_lock:
            run("DELETE FROM messages WHERE id=?", (r["id"],))
            run("DELETE FROM reacts WHERE msg_id=?", (r["id"],))
        fids += [r.get("fid"), r.get("tfid")]
        done.append(r["id"])
        ids_ = [r["id"]]
        chat_push(ch, lambda uid, ids_=ids_: {"type": "del", "ids": ids_})
    gc_files(fids)
    return done, None


# ── поиск публичных чатов и по сообщениям ──
def public_chats_search(q, viewer):
    like = "%" + q.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    rows = qa("""SELECT * FROM chats WHERE slug != '' AND (plower(slug) LIKE ? ESCAPE '\\' OR plower(title) LIKE ? ESCAPE '\\') LIMIT 20""", (like, like))
    out = []
    for ch in rows:
        out.append(chat_public(ch, member_row(ch["id"], viewer)))
    return out


@app.get("/api/search/messages")
def search_messages():
    """?q=текст&kind=all|media|file|link&peer=<id> — поиск по сообщениям, которые видит пользователь."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    q = request.args.get("q", "").strip().lower()[:64]
    kind = request.args.get("kind", "all")
    peer = request.args.get("peer", type=int)
    if kind == "all" and len(q) < 2:
        return jsonify(ok=True, messages=[])
    if not hit("msearch", u["id"], 30, 60):
        return err("Слишком часто. Попробуйте позже", 429)
    uid = u["id"]
    cond = ["((m.sender=:me AND m.del_s=0 AND m.receiver>0) OR (m.receiver=:me AND m.del_r=0) OR "
            "(m.receiver<0 AND EXISTS(SELECT 1 FROM chat_members c WHERE c.chat_id=-m.receiver AND c.user_id=:me AND m.id>=c.first_id AND (m.only_u=0 OR m.only_u=:me))))",
            "COALESCE(m.kind,'text') NOT IN ('svc','call','greet')"]
    args = {"me": uid}
    if peer:
        if peer < 0:
            cond.append("m.receiver=:peer")
        else:
            cond.append("((m.sender=:peer AND m.receiver=:me) OR (m.sender=:me AND m.receiver=:peer))")
        args["peer"] = peer
    if kind == "media":
        cond.append("m.kind IN ('photo','gif')")
    elif kind == "file":
        cond.append("m.kind='file'")
    rows = qa(f"SELECT m.* FROM messages m WHERE {' AND '.join(cond)} ORDER BY m.id DESC LIMIT 3000", args)
    out = []
    for r in rows:
        t = decrypt_text(r["text"])
        if kind == "link":
            if not URL_IN_TEXT.search(t):
                continue
            if q and q not in t.lower():
                continue
        elif kind in ("media", "file"):
            if q and q not in t.lower() and q not in str((meta_load(r.get("meta")).get("a") or {}).get("name", "")).lower():
                continue
        elif q not in t.lower():
            continue
        out.append(r)
        if len(out) >= 40:
            break
    peers = {}
    msgs = ser_many(out, uid)
    res = []
    for r, mm in zip(out, msgs):
        if r["receiver"] < 0:
            pid = r["receiver"]
            if pid not in peers:
                ch = chat_row(-pid)
                peers[pid] = chat_public(ch, member_row(ch["id"], uid)) if ch else None
        else:
            pid = r["receiver"] if r["sender"] == uid else r["sender"]
            if pid not in peers:
                p = q1("SELECT * FROM users WHERE id=?", (pid,))
                peers[pid] = public(p, viewer=uid, contact=True) if p else None
        if peers.get(pid):
            res.append({"peer": peers[pid], "message": mm})
    return jsonify(ok=True, messages=res)


@app.post("/api/chats/delete")
def chats_delete():
    """Удалить переписку у себя: в личном чате — все сообщения «у меня»; в группе или канале — выйти (владелец удаляет)."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    peer = num(body().get("peer"), -2 ** 62, 2 ** 62)
    if not peer:
        return err("Неверные данные")
    if peer < 0:
        return chat_leave(-peer)
    me_ = u["id"]
    rows = qa("SELECT * FROM messages WHERE (sender=? AND receiver=?) OR (sender=? AND receiver=?)", (me_, peer, peer, me_))
    fids, gone = [], []
    with db_lock:
        for r in rows:
            col = "del_s" if r["sender"] == me_ else "del_r"
            if r.get("del_r" if col == "del_s" else "del_s"):
                run("DELETE FROM messages WHERE id=?", (r["id"],))
                run("DELETE FROM reacts WHERE msg_id=?", (r["id"],))
                fids += [r.get("fid"), r.get("tfid")]
            else:
                run(f"UPDATE messages SET {col}=1 WHERE id=?", (r["id"],))
            gone.append(r["id"])
    gc_files(fids)
    if gone:
        push(me_, {"type": "del", "ids": gone})
    return jsonify(ok=True, n=len(gone))


# ───────────────────── ЗВОНКИ (WebRTC: сервер только передаёт сигналы) ─────────────────────
ICE_DEFAULT = [{"urls": ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"]}]
RING_TIMEOUT = 45
calls = {}                       # id звонка -> {"a": кто звонит, "b": кому, "v": видео, "ts": начало, "ans": время ответа}
clock = threading.RLock()
CALL_ID_RE = re.compile(r"^[\w-]{8,40}$")


def ice_servers():
    raw = os.environ.get("ICE_SERVERS", "").strip()
    if raw:
        try:
            v = json.loads(raw)
            if isinstance(v, list) and v:
                return v
        except ValueError:
            pass
    out = list(ICE_DEFAULT)
    if os.environ.get("TURN_URL"):
        out.append({"urls": [x.strip() for x in os.environ["TURN_URL"].split(",") if x.strip()],
                    "username": os.environ.get("TURN_USER", ""), "credential": os.environ.get("TURN_PASS", "")})
    elif os.environ.get("ICE_DEFAULT_TURN", "1") != "0":
        # бесплатный публичный ретранслятор Open Relay (нужен, когда прямое соединение невозможно, например в мобильных сетях)
        out.append({"urls": ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turn:openrelay.metered.ca:443?transport=tcp"],
                    "username": "openrelayproject", "credential": "openrelayproject"})
    return out


@app.get("/api/ice")
def ice_get():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    return jsonify(ok=True, iceServers=ice_servers())


@app.get("/api/push/vapid_key")
def push_vapid_key():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    return jsonify(ok=True, key=ensure_vapid()["pub"])


@app.post("/api/push/subscribe")
def push_subscribe():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    if not hit("pushsub", u["id"], 20, 300):
        return err("Слишком часто", 429)
    d = body()
    endpoint = str(d.get("endpoint") or "").strip()
    keys = d.get("keys") or {}
    p256dh, auth = str(keys.get("p256dh") or "").strip(), str(keys.get("auth") or "").strip()
    if not endpoint or not p256dh or not auth or len(endpoint) > 1000 or not endpoint.startswith(("http://", "https://")):
        return err("Некорректная подписка")
    with db_lock:
        run("""INSERT INTO push_subs(user_id,endpoint,p256dh,auth,ts) VALUES(?,?,?,?,?)
               ON CONFLICT(user_id,endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, ts=excluded.ts""",
            (u["id"], endpoint, p256dh, auth, int(time.time())))
        run("""DELETE FROM push_subs WHERE user_id=? AND id NOT IN
               (SELECT id FROM push_subs WHERE user_id=? ORDER BY ts DESC LIMIT 8)""", (u["id"], u["id"]))
    return jsonify(ok=True)


@app.post("/api/push/unsubscribe")
def push_unsubscribe():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    endpoint = str(body().get("endpoint") or "").strip()
    if endpoint:
        run("DELETE FROM push_subs WHERE user_id=? AND endpoint=?", (u["id"], endpoint))
    return jsonify(ok=True)


FCM_TOKEN_RE = re.compile(r"^[A-Za-z0-9_:\-.]{20,4096}$")


@app.post("/api/push/fcm")
def push_fcm():
    """FCM-токен телефона из APK (AppMint Push). Один токен — у одного аккаунта: при входе в другой аккаунт
    на том же телефоне токен переезжает к нему, чтобы уведомления прежнего аккаунта сюда не шли."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    if not hit("pushfcm", u["id"], 20, 300):
        return err("Слишком часто", 429)
    d = body()
    tok, inst = str(d.get("token") or "").strip(), str(d.get("install") or "")[:80]
    if not FCM_TOKEN_RE.match(tok):
        return err("Некорректный токен")
    with db_lock:
        if inst:
            run("DELETE FROM fcm_tokens WHERE user_id=? AND install=? AND token!=?", (u["id"], inst, tok))
        run("""INSERT INTO fcm_tokens(user_id,token,install,ts) VALUES(?,?,?,?)
               ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id, install=excluded.install, ts=excluded.ts""",
            (u["id"], tok, inst, int(time.time())))
        run("""DELETE FROM fcm_tokens WHERE user_id=? AND id NOT IN
               (SELECT id FROM fcm_tokens WHERE user_id=? ORDER BY ts DESC LIMIT 8)""", (u["id"], u["id"]))
    return jsonify(ok=True, ready=bool(fcm_sa()))


@app.post("/api/push/fcm/remove")
def push_fcm_remove():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    tok = str(body().get("token") or "").strip()
    if tok:
        run("DELETE FROM fcm_tokens WHERE user_id=? AND token=?", (u["id"], tok))
    return jsonify(ok=True)


def call_log(c, status):
    """Запись о звонке в переписке: исходящий / входящий / пропущенный / отклонённый."""
    dur = int(time.time() - c["ans"]) if c.get("ans") else 0
    try:
        add_message(c["a"], c["b"], "", None, "call", call={"st": status, "dur": dur, "v": 1 if c.get("v") else 0})
    except Exception as e:
        print("call_log:", e)


def call_end(cid, status, notify=None, by=None):
    with clock:
        c = calls.pop(cid, None)
    if not c:
        return None
    call_log(c, status)
    if status in ("missed", "cancelled", "offline") and not clients.get(c["b"]):
        # человека нет в приложении: сообщаем о пропущенном звонке через бота (если он включил это в настройках)
        r, s_ = q1("SELECT * FROM users WHERE id=?", (c["b"],)), q1("SELECT * FROM users WHERE id=?", (c["a"],))
        if r and s_:
            threading.Thread(target=bot_notify, args=(r, s_, "call", ""), daemon=True).start()
    if notify:
        for uid in {c["a"], c["b"]} - ({by} if by else set()):
            rtc_push(uid, {"type": "rtc", "call": cid, "k": notify})   # Web Push тоже: снять системное уведомление о звонке
    if by:
        rtc_push(by, {"type": "rtc", "call": cid, "k": "gone"})      # другие устройства этого человека перестают звонить
    return c


def call_busy(uid):
    with clock:
        return any(uid in (c["a"], c["b"]) for c in calls.values())


def rtc_handle(uid, d):
    k = str(d.get("k") or "")
    cid = str(d.get("call") or "")
    if not CALL_ID_RE.match(cid):
        return
    if not hit("rtc", uid, 900, 60):
        return
    if k == "invite":
        to = num(d.get("to"), 1, 2 ** 62)
        callee = q1("SELECT * FROM users WHERE id=?", (to,)) if to else None
        caller = q1("SELECT * FROM users WHERE id=?", (uid,))
        if not callee or not caller or to == uid or callee["is_system"]:
            return push(uid, {"type": "rtc", "call": cid, "k": "unavailable"})
        if not priv_allows(callee, "calls", uid) or block_err(uid, to):
            return push(uid, {"type": "rtc", "call": cid, "k": "denied"})
        if not hit("callinv", uid, 12, 60):
            return push(uid, {"type": "rtc", "call": cid, "k": "unavailable"})
        with clock:
            if cid in calls:
                return
            busy_me = any(uid in (c["a"], c["b"]) for c in calls.values())
        if busy_me:
            return push(uid, {"type": "rtc", "call": cid, "k": "busy"})
        c = {"a": uid, "b": to, "v": 1 if d.get("v") else 0, "ts": time.time(), "ans": 0}
        if call_busy(to):
            with clock:
                calls[cid] = c
            call_end(cid, "busy")
            return push(uid, {"type": "rtc", "call": cid, "k": "busy"})
        # приложение не открыто (нет WS): звоним через Web Push, если есть подписка — иначе сразу "офлайн"
        if not clients.get(to) and not has_push(to):
            with clock:
                calls[cid] = c
            call_end(cid, "offline")
            return push(uid, {"type": "rtc", "call": cid, "k": "offline"})
        with clock:
            calls[cid] = c
        cname = caller.get("name") or caller.get("username") or caller.get("number") or ""
        rtc_push(to, {"type": "rtc", "call": cid, "k": "invite", "from": uid, "v": c["v"], "name": cname,
                      "user": public(caller, viewer=to, contact=True)})
        return push(uid, {"type": "rtc", "call": cid, "k": "ringing"})
    with clock:
        c = calls.get(cid)
    if not c or uid not in (c["a"], c["b"]):
        return
    other = c["b"] if uid == c["a"] else c["a"]
    if k == "accept" and uid == c["b"] and not c["ans"]:
        c["ans"] = time.time()
        push(other, {"type": "rtc", "call": cid, "k": "accept"})
        push(uid, {"type": "rtc", "call": cid, "k": "answered"})        # остальные устройства перестают звонить
    elif k == "decline" and uid == c["b"] and not c["ans"]:
        call_end(cid, "declined", "decline", by=uid)
    elif k == "cancel" and uid == c["a"] and not c["ans"]:
        call_end(cid, "cancelled", "cancel", by=uid)
    elif k == "end":
        call_end(cid, "ended" if c["ans"] else ("cancelled" if uid == c["a"] else "declined"), "end", by=uid)
    elif k in ("sdp", "ice", "video", "mute", "fx"):
        dd = d.get("d")
        if k == "video":
            c["v"] = 1 if (dd or {}).get("on") else c["v"]
        push(other, {"type": "rtc", "call": cid, "k": k, "d": dd})


def call_drop(uid):
    """Пропало соединение: звонки этого человека завершаются."""
    with clock:
        ids = [i for i, c in calls.items() if uid in (c["a"], c["b"])]
    for i in ids:
        c = calls.get(i)
        if not c:
            continue
        call_end(i, "ended" if c["ans"] else ("cancelled" if uid == c["a"] else "declined"), "end", by=uid)


def call_sweep():
    now = time.time()
    with clock:
        ids = [i for i, c in calls.items() if not c["ans"] and now - c["ts"] > RING_TIMEOUT]
    for i in ids:
        call_end(i, "missed", "timeout")


# ── видеочат группы: комнаты, участники соединяются друг с другом напрямую ──
VC_MAX = 8


def vc_info_push(ch):
    n = vc_count(ch["id"])
    chat_push(ch, lambda uid: {"type": "vc", "op": "info", "chat": -ch["id"], "n": n})


def vc_room_state(cid):
    with vlock:
        r = vrooms.get(cid)
        if not r:
            return None
        return {"since": r["since"], "users": {str(k): dict(v) for k, v in r["users"].items()}}


def leave_vc(cid, uid):
    ended = None
    with vlock:
        r = vrooms.get(cid)
        if not r or uid not in r["users"]:
            return
        r["users"].pop(uid, None)
        rest = list(r["users"].keys())
        if not rest:
            vrooms.pop(cid, None)
            ended = int(time.time() - r["since"])
    for p in rest:
        push(p, {"type": "vc", "op": "left", "chat": -cid, "user": uid})
    ch = chat_row(cid)
    if ch:
        if ended is not None:
            svc_add(ch, uid, "vc_end", x=str(ended))
        vc_info_push(ch)


def vc_handle(uid, d):
    op = str(d.get("op") or "")
    cid = -num(d.get("chat"), -2 ** 62, -1) if num(d.get("chat"), -2 ** 62, -1) else 0
    ch = chat_row(cid) if cid else None
    m = member_row(cid, uid) if ch else None
    if not ch or not m:
        return
    if not hit("vc", uid, 900, 60):
        return
    if op == "join":
        with vlock:
            r = vrooms.get(cid)
            if not r:
                if not has_right(ch, m, "calls"):
                    return push(uid, {"type": "vc", "op": "denied", "chat": -cid})
                r = vrooms[cid] = {"users": {}, "since": time.time(), "by": uid}
                first = True
            else:
                first = False
            if uid not in r["users"] and len(r["users"]) >= VC_MAX:
                return push(uid, {"type": "vc", "op": "full", "chat": -cid})
            others = list(r["users"].keys())
            r["users"][uid] = {"mute": bool(d.get("mute")), "video": False, "since": int(time.time())}
        u = q1("SELECT * FROM users WHERE id=?", (uid,))
        st = vc_room_state(cid)
        users = {}
        for i in list((st or {}).get("users", {}).keys()):
            x = q1("SELECT * FROM users WHERE id=?", (int(i),))
            if x:
                users[i] = public(x, viewer=uid, contact=True)
        push(uid, {"type": "vc", "op": "state", "chat": -cid, "room": st, "users": users, "me": uid})
        for p in others:
            push(p, {"type": "vc", "op": "joined", "chat": -cid, "user": uid, "profile": public(u, viewer=p, contact=True)})
        if first:
            svc_add(ch, uid, "vc_start")
        vc_info_push(ch)
    elif op == "leave":
        leave_vc(cid, uid)
    elif op in ("mute", "video"):
        with vlock:
            r = vrooms.get(cid)
            if not r or uid not in r["users"]:
                return
            r["users"][uid]["mute" if op == "mute" else "video"] = bool(d.get("on"))
            others = [p for p in r["users"] if p != uid]
        for p in others:
            push(p, {"type": "vc", "op": op, "chat": -cid, "user": uid, "on": bool(d.get("on"))})
    elif op == "sig":
        to = num(d.get("to"), 1, 2 ** 62)
        with vlock:
            r = vrooms.get(cid)
            ok = bool(r and uid in r["users"] and to in r["users"])
        if ok:
            push(to, {"type": "vc", "op": "sig", "chat": -cid, "from": uid, "d": d.get("d")})


def vc_drop(uid):
    with vlock:
        cids = [c for c, r in vrooms.items() if uid in r["users"]]
    for c in cids:
        leave_vc(c, uid)


def ws_dispatch(uid, d):
    t = d.get("type")
    if t == "rtc":
        rtc_handle(uid, d)
    elif t == "vc":
        vc_handle(uid, d)


# ───────────────────── WEBSOCKET ─────────────────────
def set_presence(uid, online):
    ts = int(time.time())
    run("UPDATE users SET last_seen=? WHERE id=?", (ts, uid))
    u = q1("SELECT * FROM users WHERE id=?", (uid,))
    push(uid, {"type": "presence", "user": uid, "online": online, "last_seen": ts})
    for p in contacts(uid):
        if clients.get(p):
            shown = bool(u) and priv_allows(u, "seen", p, True)
            push(p, {"type": "presence", "user": uid, "online": online and shown, "last_seen": ts if shown else 0})


@sock.route("/ws")
def ws_route(ws):
    """Авторизация: первым сообщением {"type":"auth","token":"...","init":"<initData, если есть>"}.
    Старый способ (?token= в URL) работает только при WS_LEGACY_TOKEN=1."""
    u, token_h = None, ""
    try:
        legacy = request.args.get("token", "") if WS_LEGACY_TOKEN else ""
        if legacy:
            u = auth_from(legacy, request_init())
            token_h = token_hash(legacy)
        if not u:
            first = ws.receive(timeout=10)
            d = json.loads(first) if first else {}
            if isinstance(d, dict) and d.get("type") == "auth":
                tok = str(d.get("token", ""))
                u = auth_from(tok, str(d.get("init", "")))
                token_h = token_hash(tok)
    except Exception:
        u = None
    if not u or len(clients.get(u["id"], ())) >= MAX_WS_PER_USER:
        try:
            ws.close()
        except Exception:
            pass
        return
    uid = u["id"]
    first_conn = not clients.get(uid)
    clients.setdefault(uid, set()).add(ws)
    ws_tok[ws] = token_h
    try:
        ws.send('{"type":"ready"}')
        if first_conn:
            set_presence(uid, True)
        while True:
            m = ws.receive()
            if m == "ping":
                ws.send('{"type":"pong"}')
            elif isinstance(m, str) and m[:1] == "{":
                try:
                    dd = json.loads(m)
                    if isinstance(dd, dict):
                        if dd.get("type") == "vis":          # приложение на экране / свёрнуто — для решения, слать ли push
                            ws_vis[ws] = bool(dd.get("on"))
                        else:
                            ws_dispatch(uid, dd)
                except Exception as e:
                    print("ws msg:", repr(e))
    except Exception:
        pass
    finally:
        ws_tok.pop(ws, None)
        ws_vis.pop(ws, None)
        clients.get(uid, set()).discard(ws)
        if not clients.get(uid):
            clients.pop(uid, None)
            try:
                call_drop(uid)
                vc_drop(uid)
            except Exception as e:
                print("ws drop:", repr(e))
            try:
                set_presence(uid, False)
            except Exception:
                pass


# ───────────────────── СЛУЖЕБНОЕ ─────────────────────
def expiry_loop():
    while True:
        time.sleep(10)
        try:
            sweep_expired()
            call_sweep()
        except Exception as e:
            print("expiry error:", e)


def maintenance_loop():
    while True:
        time.sleep(3600)
        try:
            now = int(time.time())
            run("DELETE FROM sessions WHERE COALESCE(NULLIF(last_used,0),created) < ?", (now - SESSION_TTL,))
            run("DELETE FROM codes WHERE expires < ?", (now,))
            run("DELETE FROM locks WHERE until < ?", (now,))
            # недогруженные файлы старше суток и загруженные, но так и не отправленные
            for f in qa("SELECT fid, done FROM files WHERE ts < ?", (now - 86400,)):
                if not f["done"] or not file_referenced(f["fid"]):
                    drop_file(f["fid"])
            # архив публикаций: храним не больше STORY_ARCHIVE_MAX последних на человека
            for o in qa("SELECT owner FROM stories WHERE exp<=? GROUP BY owner HAVING COUNT(*)>?", (now, STORY_ARCHIVE_MAX)):
                old = qa("SELECT id, fid, tfid FROM stories WHERE owner=? AND exp<=? ORDER BY ts DESC, id DESC LIMIT -1 OFFSET ?",
                         (o["owner"], now, STORY_ARCHIVE_MAX))
                for st in old:
                    run("DELETE FROM stories WHERE id=?", (st["id"],))
                    run("DELETE FROM story_views WHERE story_id=?", (st["id"],))
                gc_files([x for st in old for x in (st["fid"], st["tfid"])])
            with _rl_lock:
                for k in [k for k, v in _rl.items() if not v or time.time() - v[-1] > 3600]:
                    _rl.pop(k, None)
        except Exception as e:
            print("maintenance error:", e)


# ───────────────────── DICEGRAM: блокировки, жалобы, подарки, NFT, рейтинг, Premium в подарок ─────────────────────
import random, math


def verified_user(u):
    """Официальная галочка: служебный аккаунт и владелец (номер ADMIN_NUMBER)."""
    return bool(u) and (bool(u.get("is_system")) or u.get("number") == ADMIN_NUMBER)


# ── блокировки ──
def is_blocked(a, b):
    """Заблокировал ли a человека b."""
    return bool(q1("SELECT 1 FROM blocks WHERE blocker=? AND blocked=?", (a, b)))


def block_err(sender, receiver):
    if sender == receiver or receiver == SYSTEM_ID or sender == SYSTEM_ID:
        return None
    if is_blocked(sender, receiver):
        return "Вы заблокировали этого пользователя. Разблокируйте его, чтобы написать"
    if is_blocked(receiver, sender):
        return "Этот пользователь ограничил получение сообщений от вас"
    return None


@app.post("/api/block")
def block_set():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    tid = num(d.get("id"), 1, 2 ** 62) or 0
    t = q1("SELECT * FROM users WHERE id=?", (tid,))
    if not t or tid == u["id"]:
        return err("Нельзя заблокировать")
    if t["is_system"]:
        return err("Служебный аккаунт нельзя заблокировать")
    if not hit("block", u["id"], 30, 60):
        return err("Слишком часто. Попробуйте позже", 429)
    if d.get("on", True):
        run("INSERT OR IGNORE INTO blocks(blocker,blocked,ts) VALUES(?,?,?)", (u["id"], tid, int(time.time())))
    else:
        run("DELETE FROM blocks WHERE blocker=? AND blocked=?", (u["id"], tid))
    push(tid, {"type": "block", "by": u["id"], "on": bool(d.get("on", True)) and True})
    push(u["id"], {"type": "block", "peer": tid, "on": bool(d.get("on", True))})
    return jsonify(ok=True, blocked=is_blocked(u["id"], tid))


@app.post("/api/contact")
def contact_set():
    """{id, on, name?, surname?, share_phone?} — добавить человека в свои контакты или убрать.
    При добавлении можно сразу задать своё имя/фамилию для него (видны только вам) и поделиться с ним своим номером."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    tid = num(d.get("id"), 1, 2 ** 62) or 0
    t = q1("SELECT * FROM users WHERE id=?", (tid,))
    if not t or tid == u["id"] or t["is_system"]:
        return err("Нельзя добавить")
    if not hit("contact", u["id"], 60, 60):
        return err("Слишком часто. Попробуйте позже", 429)
    on = d.get("on", True)
    if on:
        name = str(d.get("name") or "").strip()[:60]
        surname = str(d.get("surname") or "").strip()[:60]
        run("INSERT OR REPLACE INTO saved_contacts(owner,contact,ts,fname,lname) VALUES(?,?,?,?,?)",
            (u["id"], tid, int(time.time()), name, surname))
        if d.get("share_phone"):
            run("INSERT OR REPLACE INTO phone_shares(owner,target,ts) VALUES(?,?,?)", (u["id"], tid, int(time.time())))
    else:
        run("DELETE FROM saved_contacts WHERE owner=? AND contact=?", (u["id"], tid))
    return jsonify(ok=True, saved=bool(on), user=public(t, viewer=u["id"], contact=True) if on else None)


@app.post("/api/contact/add")
def contact_add():
    """{number, name, surname} — добавить контакт по номеру телефона (как в Telegram «Новый контакт»):
    имя и фамилия — свои собственные для этого человека, показываются только вам."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    digits = re.sub(r"\D", "", str(d.get("number") or ""))
    if digits.startswith("888") and len(digits) > 8:
        digits = digits[3:]
    if len(digits) != 8:
        return err("Введите номер полностью (8 цифр)")
    name = str(d.get("name") or "").strip()[:60]
    surname = str(d.get("surname") or "").strip()[:60]
    if not name:
        return err("Введите имя")
    if not hit("contact", u["id"], 60, 60):
        return err("Слишком часто. Попробуйте позже", 429)
    number = "+888" + digits
    t = q1("SELECT * FROM users WHERE number=?", (number,))
    if not t or t["is_system"]:
        return err("Пользователь с таким номером не найден")
    if t["id"] == u["id"]:
        return err("Это ваш собственный номер")
    run("INSERT OR REPLACE INTO saved_contacts(owner,contact,ts,fname,lname) VALUES(?,?,?,?,?)",
        (u["id"], t["id"], int(time.time()), name, surname))
    return jsonify(ok=True, user=public(t, viewer=u["id"], contact=True))


@app.get("/api/blocks")
def blocks_list():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    rows = qa("SELECT b.blocked id, b.ts FROM blocks b WHERE b.blocker=? ORDER BY b.ts DESC LIMIT 500", (u["id"],))
    out = []
    for r in rows:
        t = q1("SELECT * FROM users WHERE id=?", (r["id"],))
        if t:
            x = public(t, viewer=u["id"])
            x["blocked_at"] = r["ts"]
            out.append(x)
    return jsonify(ok=True, users=out)


REPORT_REASONS = {"spam": "Спам", "violence": "Насилие", "porn": "Неприемлемый контент", "child": "Нарушение прав детей",
                  "illegal": "Незаконные товары", "fake": "Выдаёт себя за другого", "other": "Другое"}


@app.post("/api/report")
def report_do():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    kind = "chat" if d.get("kind") == "chat" else "user"
    tid = num(d.get("id"), 1, 2 ** 62) or 0
    reason = str(d.get("reason") or "other")
    if reason not in REPORT_REASONS:
        return err("Выберите причину")
    if kind == "user":
        t = q1("SELECT * FROM users WHERE id=?", (tid,))
        if not t or tid == u["id"]:
            return err("Нельзя пожаловаться")
        if t["is_system"]:
            return err("На служебный аккаунт пожаловаться нельзя")
        label = t["name"] or str(tid)
    else:
        t = chat_row(tid)
        if not t:
            return err("Чат не найден", 404)
        label = t["title"]
    if not hit("report", u["id"], 10, 3600):
        return err("Слишком много жалоб. Попробуйте позже", 429)
    text = str(d.get("text") or "").strip()[:500]
    run("INSERT INTO reports(reporter,kind,target,reason,text,ts) VALUES(?,?,?,?,?,?)", (u["id"], kind, tid, reason, text, int(time.time())))
    alert_admin(f"🚩 Жалоба ({REPORT_REASONS[reason]})\nНа: {label} [{kind} {tid}]\nОт: {u['name']} [{u['id']}]\n{text}")
    return jsonify(ok=True)


# ── подарки и коллекционные NFT ──
# обычные подарки: id → (значок, название, цена, коллекция для улучшения или "")
GIFTS = {
    "heart": ("❤️", "Сердце", 15, ""), "bear": ("🧸", "Мишка", 15, "bear"), "box": ("🎁", "Подарок", 25, ""), "rose": ("🌹", "Роза", 25, "rose"),
    "cake": ("🎂", "Торт", 50, ""), "bouquet": ("💐", "Букет", 50, ""), "rocket": ("🚀", "Ракета", 50, "rocket"), "wine": ("🍾", "Шампанское", 50, ""),
    "cup": ("🏆", "Кубок", 100, "cup"), "ring": ("💍", "Кольцо", 100, ""), "gem": ("💎", "Алмаз", 100, "gem"), "crown": ("👑", "Корона", 250, "crown"),
}
# коллекции: id → (значок, название, тираж, цена покупки, цена улучшения обычного подарка)
COLLS = {
    "bear": ("🧸", "Плюшевый мишка", 3000, 400, 100), "rose": ("🌹", "Красная роза", 2500, 500, 120), "cup": ("🏆", "Золотой кубок", 1500, 900, 200),
    "rocket": ("🚀", "Космический корабль", 1200, 1200, 260), "gem": ("💎", "Алмаз", 800, 2500, 500), "dragon": ("🐉", "Огненный дракон", 500, 4000, 0),
    "crown": ("👑", "Волшебная корона", 300, 6500, 900), "dice": ("🎲", "Счастливый кубик", 100, 15000, 0),
}
# модели: название, поворот цвета, украшение, редкость (в промилле)
MODELS = [("Классика", 0, "", 300), ("Золотой", 38, "✨", 220), ("Ночной", 235, "🌙", 180), ("Неоновый", 300, "💫", 150), ("Королевский", 268, "👑", 100), ("Призрачный", 175, "👻", 50)]
BACKDROPS = [("Небесный", "#7ec8ff", "#2f7bff", 150), ("Малина", "#ff8fb1", "#d6336c", 150), ("Мята", "#8ff0d0", "#12b886", 140), ("Янтарь", "#ffd27a", "#f08c00", 130),
             ("Лаванда", "#c9b5ff", "#7048e8", 120), ("Графит", "#9aa3b2", "#343a46", 100), ("Рубин", "#ff7a7a", "#c92a2a", 80), ("Изумруд", "#69db7c", "#2b8a3e", 70),
             ("Закат", "#ffa8a8", "#f76707", 35), ("Северное сияние", "#63e6be", "#4263eb", 15), ("Чёрный бриллиант", "#6b7280", "#05060a", 5)]
PATTERNS = [("Звёзды", "⭐", 220), ("Сердца", "💜", 180), ("Искры", "✨", 180), ("Снежинки", "❄️", 140), ("Цветы", "🌸", 120), ("Молнии", "⚡", 90), ("Кубики", "🎲", 50), ("Короны", "👑", 20)]
PREMIUM_GIFT = {3: (1400, 90), 6: (2600, 180), 12: (4990, 365)}          # месяцы → (цена, дней)
GIFT_SELL_DAYS = 7                                                       # окно продажи обычного подарка обратно за звёзды
GIFT_SELL_RATE = 0.5                                                     # доля исходной цены, которую возвращают при продаже


def pick_w(table, idx_w=3):
    tot = sum(x[idx_w] for x in table)
    r = random.uniform(0, tot)
    acc = 0
    for i, x in enumerate(table):
        acc += x[idx_w]
        if r <= acc:
            return i
    return len(table) - 1


def attrs_out(g):
    """Описание коллекционного подарка для клиента: модель, фон, узор и их редкость."""
    if not g.get("coll") or g["coll"] not in COLLS:
        return None
    em, name, supply, price, _ = COLLS[g["coll"]]
    mo, bd, pt = MODELS[g["model"] % len(MODELS)], BACKDROPS[g["backdrop"] % len(BACKDROPS)], PATTERNS[g["pattern"] % len(PATTERNS)]
    return {"coll": g["coll"], "e": em, "name": name, "num": g["num"], "supply": supply,
            "model": {"n": mo[0], "hue": mo[1], "acc": mo[2], "r": round(mo[3] / sum(x[3] for x in MODELS) * 100, 1)},
            "backdrop": {"n": bd[0], "c1": bd[1], "c2": bd[2], "r": round(bd[3] / sum(x[3] for x in BACKDROPS) * 100, 1)},
            "pattern": {"n": pt[0], "e": pt[1], "r": round(pt[2] / sum(x[2] for x in PATTERNS) * 100, 1)}}


def gift_sell_price(g):
    return max(1, int(g["price"] * GIFT_SELL_RATE))


def gift_sell_ok(g):
    """Можно ли продать обратно: обычный (не улучшенный, не Premium) подарок, не проданный, в пределах окна."""
    return (g["key"] in GIFTS and not g.get("sold") and (time.time() - (g["ts"] or 0)) <= GIFT_SELL_DAYS * 86400)


def gift_out(g, viewer, owner_view=False):
    d = {"id": g["id"], "key": g["key"], "price": g["price"], "ts": g["ts"], "msg": g.get("msg") or "", "pin": g.get("pin") or 0,
         "shown": 1 if g.get("shown", 1) else 0, "sold": 1 if g.get("sold") else 0}
    if g["key"] in GIFTS:
        e, n, pr, up = GIFTS[g["key"]]
        d.update(e=e, name=n, up=up and COLLS[up][4] or 0)
    a = attrs_out(g)
    if a:
        d["nft"] = a
        d["name"] = a["name"]
        d["e"] = a["e"]
    if viewer == g["to_id"] and gift_sell_ok(g):
        d["can_sell"] = 1
        d["sell_price"] = gift_sell_price(g)
        d["sell_until"] = (g["ts"] or 0) + GIFT_SELL_DAYS * 86400
    anon = bool(g.get("anon"))
    d["anon"] = anon
    if g["from_id"] and (not anon or viewer == g["from_id"] or viewer == g["to_id"] and False):
        f = q1("SELECT * FROM users WHERE id=?", (g["from_id"],))
        if f:
            d["from"] = {"id": f["id"], "name": f["name"], "surname": f.get("surname") or "", "avatar": f.get("avatar") or ""}
    if anon and viewer == g["from_id"]:
        d["from_me"] = 1
    return d


def mint(coll, uid):
    """Выпустить следующий экземпляр коллекции: номер и случайные модель/фон/узор. None — тираж закончился."""
    with db_lock:
        r = q1("SELECT minted FROM coll_mint WHERE coll=?", (coll,))
        n = (r["minted"] if r else 0) + 1
        if n > COLLS[coll][2]:
            return None
        if r:
            run("UPDATE coll_mint SET minted=? WHERE coll=?", (n, coll))
        else:
            run("INSERT INTO coll_mint(coll,minted) VALUES(?,?)", (coll, n))
    return {"coll": coll, "num": n, "model": pick_w(MODELS), "backdrop": pick_w(BACKDROPS), "pattern": pick_w(PATTERNS, 2)}


@app.get("/api/gifts/catalog")
def gifts_catalog():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    mints = {r["coll"]: r["minted"] for r in qa("SELECT coll, minted FROM coll_mint")}
    reg = [{"key": k, "e": v[0], "name": v[1], "price": v[2], "up": COLLS[v[3]][4] if v[3] else 0, "coll": v[3]} for k, v in GIFTS.items()]
    col = [{"coll": k, "e": v[0], "name": v[1], "supply": v[2], "minted": mints.get(k, 0), "price": v[3], "left": v[2] - mints.get(k, 0),
            "models": [{"n": m[0], "hue": m[1], "acc": m[2]} for m in MODELS],
            "backdrops": [{"n": b[0], "c1": b[1], "c2": b[2]} for b in BACKDROPS], "patterns": [{"n": p[0], "e": p[1]} for p in PATTERNS]} for k, v in COLLS.items()]
    prem = [{"months": m, "price": v[0], "days": v[1]} for m, v in PREMIUM_GIFT.items()]
    return jsonify(ok=True, regular=reg, collectibles=col, premium=prem, balance=u.get("stars") or 0, my_premium=is_premium(u))


def gift_message(sender, receiver, g, text_fallback):
    """Карточка подарка в чате. Если отправитель скрыл имя, карточку получает только адресат — от имени «Dicegram»."""
    ts = int(time.time())
    anon = bool(g.get("anon"))
    info = gift_out(g, sender)
    info.pop("from", None)
    info.pop("from_me", None)
    if anon:
        text_fallback = text_fallback + " (отправитель скрыт)"
    with db_lock:
        mid = run("""INSERT INTO messages(sender,receiver,text,ts,kind,meta) VALUES(?,?,?,?,'gift',?)""",
                  (SYSTEM_ID if anon else sender, receiver, encrypt_text(text_fallback), ts, meta_dump({"g": info}))).lastrowid
        row = q1("SELECT * FROM messages WHERE id=?", (mid,))
    push(receiver, {"type": "message", "message": ser_one(row, receiver)})
    if receiver != sender and not anon:
        push(sender, {"type": "message", "message": ser_one(row, sender)})
    return row


@app.post("/api/gift/send")
def gift_send():
    """{to, key, anon?, msg?}: key — обычный подарок («bear») или коллекционный («c:dragon»). to может быть вы сами."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    to = num(d.get("to"), 1, 2 ** 62) or 0
    t = q1("SELECT * FROM users WHERE id=?", (to,))
    if not t or t["is_system"]:
        return err("Нельзя отправить подарок этому аккаунту")
    be = block_err(u["id"], to)
    if be:
        return err(be, 403)
    key = str(d.get("key") or "")
    coll = ""
    if key.startswith("c:") and key[2:] in COLLS:
        coll = key[2:]
        price, name, emo = COLLS[coll][3], COLLS[coll][1], COLLS[coll][0]
    elif key in GIFTS:
        emo, name, price = GIFTS[key][0], GIFTS[key][1], GIFTS[key][2]
    else:
        return err("Такого подарка нет")
    if not hit("gift", u["id"], 30, 60):
        return err("Слишком часто. Попробуйте позже", 429)
    msg = str(d.get("msg") or "").strip()[:140]
    anon = 1 if d.get("anon") else 0
    now = int(time.time())
    with db_lock:
        cur = fresh(u["id"])
        if (cur.get("stars") or 0) < price:
            return jsonify(ok=False, error=f"Недостаточно звёзд: нужно {price}, у вас {cur.get('stars') or 0}", need=price), 402
        a = {"coll": "", "num": 0, "model": 0, "backdrop": 0, "pattern": 0}
        if coll:
            a = mint(coll, to)
            if not a:
                return err("Эта коллекция распродана", 409)
        run("UPDATE users SET stars=stars-? WHERE id=?", (price, u["id"]))
        star_tx(u["id"], -price, f"Подарок: {name}" + (" (себе)" if to == u["id"] else ""), "gift")
        gid = run("""INSERT INTO gifts(from_id,to_id,key,coll,model,backdrop,pattern,num,anon,msg,price,ts,shown) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)""",
                  (u["id"], to, coll and ("c:" + coll) or key, a["coll"], a["model"], a["backdrop"], a["pattern"], a["num"], anon, msg, price, now)).lastrowid
    g = q1("SELECT * FROM gifts WHERE id=?", (gid,))
    gift_message(u["id"], to, g, f"🎁 Подарок: {name}")
    notify_profile(to)
    return jsonify(ok=True, gift=gift_out(g, u["id"]), user=public(fresh(u["id"]), True))


@app.get("/api/gifts/user/<int:uid>")
def gifts_user(uid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    t = q1("SELECT * FROM users WHERE id=?", (uid,))
    if not t:
        return err("Не найдено", 404)
    own = uid == u["id"]
    # подаренный Premium не показываем отдельной плиткой в подарках (он уже отражён активной подпиской),
    # а проданный обратно подарок пропадает из сетки, как и в Telegram
    rows = qa("SELECT * FROM gifts WHERE to_id=? AND key NOT LIKE 'prem:%' AND sold=0 " + ("" if own else "AND shown=1 ") + "ORDER BY pin DESC, id DESC LIMIT 300", (uid,))
    total = q1("SELECT COUNT(*) n FROM gifts WHERE to_id=? AND shown=1 AND sold=0 AND key NOT LIKE 'prem:%'", (uid,))["n"]
    return jsonify(ok=True, gifts=[gift_out(g, u["id"]) for g in rows], total=total)


@app.post("/api/gift/sell")
def gift_sell():
    """{id} — продать обычный подарок обратно за звёзды в течение {GIFT_SELL_DAYS} дней после получения."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    gid = num(body().get("id"), 1, 2 ** 62) or 0
    g = q1("SELECT * FROM gifts WHERE id=? AND to_id=?", (gid, u["id"]))
    if not g:
        return err("Подарок не найден", 404)
    if g["key"] not in GIFTS:
        return err("Этот подарок нельзя продать")
    if g.get("sold"):
        return err("Этот подарок уже продан")
    if not gift_sell_ok(g):
        return err(f"Продать можно только в течение {GIFT_SELL_DAYS} дней после получения")
    price = gift_sell_price(g)
    name = GIFTS.get(g["key"], ("", "Подарок", 0, ""))[1]
    with db_lock:
        run("UPDATE gifts SET sold=1, shown=0, pin=0 WHERE id=?", (gid,))
        run("UPDATE users SET stars=stars+? WHERE id=?", (price, u["id"]))
        star_tx(u["id"], price, f"Продажа подарка: {name}", "gift")
    notify_profile(u["id"])
    return jsonify(ok=True, gift=gift_out(q1("SELECT * FROM gifts WHERE id=?", (gid,)), u["id"]), user=public(fresh(u["id"]), True))


@app.get("/api/gift/<int:gid>")
def gift_get(gid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    g = q1("SELECT * FROM gifts WHERE id=?", (gid,))
    if not g or (not g["shown"] and u["id"] not in (g["to_id"], g["from_id"])):
        return err("Подарок не найден", 404)
    d = gift_out(g, u["id"])
    o = q1("SELECT * FROM users WHERE id=?", (g["to_id"],))
    if o:
        d["owner"] = {"id": o["id"], "name": o["name"], "surname": o.get("surname") or "", "avatar": o.get("avatar") or ""}
    return jsonify(ok=True, gift=d)


@app.post("/api/gift/upgrade")
def gift_upgrade():
    """Владелец обычного подарка улучшает его до коллекционного: номер, модель, фон и узор выпадают случайно."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    gid = num(body().get("id"), 1, 2 ** 62) or 0
    g = q1("SELECT * FROM gifts WHERE id=? AND to_id=?", (gid, u["id"]))
    if not g:
        return err("Подарок не найден", 404)
    if g["coll"]:
        return err("Подарок уже улучшен")
    up = GIFTS.get(g["key"], ("", "", 0, ""))[3]
    if not up:
        return err("Этот подарок нельзя улучшить")
    price = COLLS[up][4]
    with db_lock:
        cur = fresh(u["id"])
        if (cur.get("stars") or 0) < price:
            return jsonify(ok=False, error=f"Недостаточно звёзд: нужно {price}, у вас {cur.get('stars') or 0}", need=price), 402
        a = mint(up, u["id"])
        if not a:
            return err("Эта коллекция распродана", 409)
        run("UPDATE users SET stars=stars-? WHERE id=?", (price, u["id"]))
        star_tx(u["id"], -price, f"Улучшение подарка: {COLLS[up][1]}", "gift")
        run("UPDATE gifts SET coll=?, model=?, backdrop=?, pattern=?, num=?, key=?, price=price+? WHERE id=?",
            (a["coll"], a["model"], a["backdrop"], a["pattern"], a["num"], "c:" + up, price, gid))
    g = q1("SELECT * FROM gifts WHERE id=?", (gid,))
    notify_profile(u["id"])
    return jsonify(ok=True, gift=gift_out(g, u["id"]), user=public(fresh(u["id"]), True))


@app.post("/api/gift/show")
def gift_show():
    """{id, shown?, pin?} — скрыть/показать подарок в профиле, закрепить."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    g = q1("SELECT * FROM gifts WHERE id=? AND to_id=?", (num(d.get("id"), 1, 2 ** 62) or 0, u["id"]))
    if not g:
        return err("Подарок не найден", 404)
    if "shown" in d:
        run("UPDATE gifts SET shown=? WHERE id=?", (1 if d["shown"] else 0, g["id"]))
        if not d["shown"] and u.get("nft") == g["id"]:
            run("UPDATE users SET nft=0, estatus='' WHERE id=?", (u["id"],))
    if "pin" in d:
        if d["pin"]:
            n = q1("SELECT COUNT(*) n FROM gifts WHERE to_id=? AND pin>0", (u["id"],))["n"]
            if n >= 6 and not g["pin"]:
                return err("Можно закрепить не больше 6 подарков")
            run("UPDATE gifts SET pin=? WHERE id=?", (int(time.time()), g["id"]))
        else:
            run("UPDATE gifts SET pin=0 WHERE id=?", (g["id"],))
    notify_profile(u["id"])
    return jsonify(ok=True, gift=gift_out(q1("SELECT * FROM gifts WHERE id=?", (g["id"],)), u["id"]))


@app.post("/api/gift/equip")
def gift_equip():
    """Надеть коллекционный подарок: он становится значком у имени, а профиль получает его фон. id=0 — снять. Нужен Premium."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    gid = num(body().get("id"), 0, 2 ** 62) or 0
    if gid:
        bad = need_premium(u)
        if bad:
            return bad
        g = q1("SELECT * FROM gifts WHERE id=? AND to_id=?", (gid, u["id"]))
        if not g or not g["coll"]:
            return err("Надеть можно только коллекционный подарок")
        run("UPDATE users SET nft=?, estatus='' WHERE id=?", (gid, u["id"]))          # обычный эмодзи-статус убирается
    else:
        run("UPDATE users SET nft=0 WHERE id=?", (u["id"],))
    notify_profile(u["id"])
    return jsonify(ok=True, user=public(fresh(u["id"]), True))


def nft_out(u):
    gid = u.get("nft") or 0
    if not gid:
        return None
    g = q1("SELECT * FROM gifts WHERE id=? AND to_id=?", (gid, u["id"]))
    if not g or not g["coll"]:
        return None
    a = attrs_out(g)
    a["gid"] = g["id"]
    return a


# ── рейтинг ──
def rating_of(u):
    recv = q1("SELECT COALESCE(SUM(price),0) s, COUNT(*) n FROM gifts WHERE to_id=? AND from_id!=?", (u["id"], u["id"]))
    sent = q1("SELECT COALESCE(SUM(price),0) s FROM gifts WHERE from_id=? AND to_id!=?", (u["id"], u["id"]))
    own = q1("SELECT COALESCE(SUM(price),0) s FROM gifts WHERE to_id=? AND from_id=?", (u["id"], u["id"]))
    age = max(0, (int(time.time()) - (u.get("created") or int(time.time()))) // 86400)
    pts = int(recv["s"] + sent["s"] * 2 + own["s"] * 0.5 + (300 if is_premium(u) else 0) + min(age, 365))
    level = int((math.sqrt(1 + 8 * pts / 150) - 1) / 2)
    cur_at, next_at = 150 * level * (level + 1) // 2, 150 * (level + 1) * (level + 2) // 2
    return {"level": level, "pts": pts, "cur": cur_at, "next": next_at, "gifts": recv["n"]}


# ── Premium в подарок ──
@app.post("/api/premium/gift")
def premium_gift():
    """{to, months: 3|6|12, anon?, msg?} — подарить Premium другу за звёзды."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    to = num(d.get("to"), 1, 2 ** 62) or 0
    months = num(d.get("months"), 1, 120) or 0
    t = q1("SELECT * FROM users WHERE id=?", (to,))
    if not t or t["is_system"] or to == u["id"] or months not in PREMIUM_GIFT:
        return err("Нельзя подарить")
    be = block_err(u["id"], to)
    if be:
        return err(be, 403)
    price, days = PREMIUM_GIFT[months]
    if not hit("pgift", u["id"], 10, 3600):
        return err("Слишком часто. Попробуйте позже", 429)
    now = int(time.time())
    with db_lock:
        cur = fresh(u["id"])
        if (cur.get("stars") or 0) < price:
            return jsonify(ok=False, error=f"Недостаточно звёзд: нужно {price}, у вас {cur.get('stars') or 0}", need=price), 402
        tt = fresh(to)
        until = max(now, tt.get("premium_until") or 0) + days * 86400
        run("UPDATE users SET stars=stars-? WHERE id=?", (price, u["id"]))
        star_tx(u["id"], -price, f"Premium в подарок на {months} мес.", "gift")
        run("UPDATE users SET premium_until=? WHERE id=?", (until, to))
        if not (tt.get("estatus") or "") and not tt.get("nft") and not is_premium(tt):
            run("UPDATE users SET estatus='b:star' WHERE id=?", (to,))               # при активации — только звезда, её можно убрать
    msg = str(d.get("msg") or "").strip()[:140]
    anon = 1 if d.get("anon") else 0
    gid = run("INSERT INTO gifts(from_id,to_id,key,anon,msg,price,ts,shown) VALUES(?,?,?,?,?,?,?,0)", (u["id"], to, f"prem:{months}", anon, msg, price, now)).lastrowid
    g = q1("SELECT * FROM gifts WHERE id=?", (gid,))
    info = {"id": gid, "key": f"prem:{months}", "months": months, "price": price, "msg": msg, "anon": bool(anon), "until": until}
    with db_lock:
        mid = run("INSERT INTO messages(sender,receiver,text,ts,kind,meta) VALUES(?,?,?,?,'gift',?)",
                  (SYSTEM_ID if anon else u["id"], to, encrypt_text(f"🎁 Подарок: Premium на {months} мес." + (" (отправитель скрыт)" if anon else "")), now, meta_dump({"g": info}))).lastrowid
        row = q1("SELECT * FROM messages WHERE id=?", (mid,))
    push(to, {"type": "message", "message": ser_one(row, to)})
    if not anon:
        push(u["id"], {"type": "message", "message": ser_one(row, u["id"])})
    notify_profile(to)
    return jsonify(ok=True, user=public(fresh(u["id"]), True))


# ── единое пространство имён: @username людей, адреса групп и каналов ──
def name_taken(name, skip_user=0, skip_chat=0):
    if q1("SELECT 1 FROM users WHERE username=? COLLATE NOCASE AND id!=?", (name, skip_user)):
        return True
    return bool(q1("SELECT 1 FROM chats WHERE slug=? COLLATE NOCASE AND id!=?", (name, skip_chat)))


def name_reserved(name, u):
    """«owner», «admin» и т. п. занимать может только владелец сервиса."""
    n = name.lower()
    if n == "owner":
        return not is_admin(u)
    return n in RESERVED


@app.get("/api/resolve/<name>")
def resolve_name(name):
    """Кто или что скрывается за @именем: человек, группа или канал (для нажатий на @упоминания)."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    name = str(name or "").strip().lstrip("@")
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{2,31}", name):
        return err("Не найдено", 404)
    t = q1("SELECT * FROM users WHERE username=? COLLATE NOCASE", (name,))
    if t:
        return jsonify(ok=True, type="user", user=public(t, t["id"] == u["id"], viewer=u["id"]))
    ch = q1("SELECT * FROM chats WHERE slug=? COLLATE NOCASE", (name,))
    if ch:
        return jsonify(ok=True, type=ch["kind"], slug=ch["slug"], chat=chat_public(ch, member_row(ch["id"], u["id"])))
    return err("Ничего не найдено", 404)


# ── личный канал в профиле (только один) ──
def pchan_out(u, viewer):
    cid = u.get("pchan") or 0
    if not cid:
        return None
    ch = chat_row(cid)
    if not ch or ch["kind"] != "channel":
        return None
    last = q1("SELECT * FROM messages WHERE receiver=? AND COALESCE(kind,'text') NOT IN ('svc','greet') ORDER BY id DESC LIMIT 1", (-cid,))
    d = chat_public(ch, member_row(cid, viewer))
    d["about"] = ch["about"] or ""
    if viewer != ch["owner"] and not d.get("username"):
        d["jslug"] = ensure_primary_link(ch, ch["owner"])["slug"]      # без публичного адреса — ссылка-приглашение, чтобы подписчики могли открыть канал
    if last:
        t = decrypt_text(last["text"]) or {"photo": "📷 Фото", "gif": "GIF", "file": "📎 Файл", "voice": "🎤 Голосовое", "sticker": "Стикер"}.get(last.get("kind"), "")
        d["last"] = {"text": t[:80], "ts": last["ts"]}
    return d


@app.post("/api/me/pchan")
def me_pchan():
    """{id: номер канала (gid) или 0} — выбрать личный канал профиля. Можно только один, и только свой."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    cid = num(body().get("id"), 0, 2 ** 62) or 0
    if cid:
        ch, m = ctx(u, cid)
        if not ch or ch["kind"] != "channel" or not m or m["role"] != "owner":
            return err("Выберите канал, которым вы владеете")
    run("UPDATE users SET pchan=? WHERE id=?", (cid, u["id"]))
    notify_profile(u["id"])
    return jsonify(ok=True, user=public(fresh(u["id"]), True))


@app.get("/api/me/channels")
def me_channels():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    rows = qa("""SELECT c.* FROM chats c JOIN chat_members m ON m.chat_id=c.id WHERE m.user_id=? AND m.role='owner' AND c.kind='channel' ORDER BY c.id DESC""", (u["id"],))
    return jsonify(ok=True, channels=[chat_public(c, member_row(c["id"], u["id"])) for c in rows], current=u.get("pchan") or 0)


@app.get("/api/me/groups")
def me_groups():
    """Группы, которыми управляет пользователь (для привязки к каналу как «Обсуждение»)."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    rows = qa("""SELECT c.* FROM chats c JOIN chat_members m ON m.chat_id=c.id WHERE m.user_id=? AND m.role IN ('owner','admin') AND c.kind='group' ORDER BY c.id DESC""", (u["id"],))
    return jsonify(ok=True, groups=[chat_public(c, member_row(c["id"], u["id"])) for c in rows])


# ───────────────────── ИГРЫ: сессии (защита от читов), очки дня, «Тапалка» с анти-бот проверкой ─────────────────────
GAME_IDS = ("2048", "block_blast", "sand")
GAME_MAX_SCORE = {"2048": 20_000_000, "block_blast": 999_999, "sand": 999_999}
GAME_MIN_SECONDS = 3           # меньше — точно не успели сыграть (простая защита от мгновенной отправки результата)
GAME_SESSION_TTL = 2 * 3600
CLICKER_CAPTCHA_EVERY = 40     # раз в столько кликов подряд — простая проверка «не бот»
CLICKER_CAPTCHA_TTL = 120
# магазин улучшений «Тапалки»: стоимость уровня N = BASE * GROWTH**N (экспонента — классика для кликеров)
UPGRADE_MAX_LEVEL = 50
UPGRADE_CLICK_BASE, UPGRADE_CLICK_GROWTH = 10, 1.6        # +1 монета за тап за уровень
UPGRADE_PASSIVE_BASE, UPGRADE_PASSIVE_GROWTH = 25, 1.7    # +1 монета/сек пассивно за уровень
PASSIVE_MAX_ACCRUE = 24 * 3600  # не копим пассивный доход дольше суток простоя (защита от переполнения/абуза времени клиента)


def upgrade_cost(level, base, growth):
    return int(math.ceil(base * (growth ** level)))

game_sessions = {}              # token -> {"game","uid","ts","used"} — сессии игр живут только в памяти процесса
game_lock = threading.RLock()


def today_str():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def game_session_sweep():
    now = time.time()
    with game_lock:
        for t in [t for t, s in game_sessions.items() if now - s["ts"] > GAME_SESSION_TTL]:
            game_sessions.pop(t, None)


def game_board_rows(game, day, limit=50):
    rows = qa("""SELECT g.score, u.* FROM game_scores g JOIN users u ON u.id=g.user_id
                 WHERE g.game=? AND g.day=? ORDER BY g.score DESC, g.ts ASC LIMIT ?""", (game, day, limit))
    return [{"user": public(r), "score": r["score"]} for r in rows]


@app.post("/api/games/start")
def games_start():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    game = str(body().get("game") or "")
    if game not in GAME_IDS:
        return err("Неизвестная игра")
    if not hit("gamestart", u["id"], 30, 60):
        return err("Слишком часто", 429)
    token = secrets.token_hex(16)
    with game_lock:
        game_session_sweep()
        game_sessions[token] = {"game": game, "uid": u["id"], "ts": time.time(), "used": False}
    return jsonify(ok=True, session=token)


@app.post("/api/games/score")
def games_score():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    token = str(d.get("session") or "")
    with game_lock:
        s = game_sessions.get(token)
        if not s or s["uid"] != u["id"] or s["used"]:
            return err("Сессия игры недействительна — обновите страницу и сыграйте заново")
        if time.time() - s["ts"] < GAME_MIN_SECONDS:
            return err("Слишком быстро")
        s["used"] = True
        game = s["game"]
    score = num(d.get("score"), 0, GAME_MAX_SCORE.get(game, 999_999))
    if score is None:
        return err("Некорректный результат")
    day = today_str()
    with db_lock:
        run("""INSERT INTO game_scores(user_id,game,day,score,ts) VALUES(?,?,?,?,?)
               ON CONFLICT(user_id,game,day) DO UPDATE SET score=MAX(score,excluded.score), ts=excluded.ts""",
            (u["id"], game, day, score, int(time.time())))
        row = q1("SELECT score FROM game_scores WHERE user_id=? AND game=? AND day=?", (u["id"], game, day))
    return jsonify(ok=True, best=row["score"] if row else score)


@app.get("/api/games/leaderboard/<game>")
def games_leaderboard(game):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    if game not in GAME_IDS and game != "clicker":
        return err("Неизвестная игра")
    day = today_str()
    mine = q1("SELECT score FROM game_scores WHERE user_id=? AND game=? AND day=?", (u["id"], game, day))
    rank = None
    if mine:
        better = q1("SELECT COUNT(*) c FROM game_scores WHERE game=? AND day=? AND score>?", (game, day, mine["score"]))
        rank = 1 + (better["c"] if better else 0)
    return jsonify(ok=True, day=day, top=game_board_rows(game, day), me={"score": mine["score"] if mine else 0, "rank": rank})


def wallet_row(uid):
    row = q1("SELECT * FROM game_wallet WHERE user_id=?", (uid,))
    now = int(time.time())
    if not row:
        with db_lock:
            run("INSERT INTO game_wallet(user_id, passive_ts) VALUES(?,?)", (uid, now))
        return q1("SELECT * FROM game_wallet WHERE user_id=?", (uid,))
    # лениво начисляем пассивный доход с момента последнего посещения (а не по таймеру на сервере —
    # так дешевле и не нужен фоновый планировщик для каждого игрока)
    elapsed = max(0, min(now - (row["passive_ts"] or now), PASSIVE_MAX_ACCRUE))
    gained = elapsed * (row["passive_level"] or 0)
    if gained > 0:
        with db_lock:
            run("UPDATE game_wallet SET coins=coins+?, passive_ts=? WHERE user_id=?", (gained, now, uid))
        return q1("SELECT * FROM game_wallet WHERE user_id=?", (uid,))
    if not row["passive_ts"]:
        with db_lock:
            run("UPDATE game_wallet SET passive_ts=? WHERE user_id=?", (now, uid))
    return row


def new_captcha(uid):
    a, b = random.randint(2, 9), random.randint(2, 9)
    op = random.choice(["+", "-", "×"])
    ans = a + b if op == "+" else (a - b if op == "-" else a * b)
    q = f"{a} {op} {b}"
    with db_lock:
        run("UPDATE game_wallet SET captcha=?, captcha_ans=?, captcha_at=? WHERE user_id=?", (q, ans, int(time.time()), uid))
    return q


@app.get("/api/games/clicker/state")
def clicker_state():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    w = wallet_row(u["id"])
    if w["captcha"] and time.time() - (w["captcha_at"] or 0) > CLICKER_CAPTCHA_TTL:
        with db_lock:
            run("UPDATE game_wallet SET captcha='', captcha_ans=0 WHERE user_id=?", (u["id"],))
        w = wallet_row(u["id"])
    today = q1("SELECT score FROM game_scores WHERE user_id=? AND game='clicker' AND day=?", (u["id"], today_str()))
    cp, pl = w["click_power"] or 0, w["passive_level"] or 0
    return jsonify(ok=True, coins=w["coins"], today=today["score"] if today else 0,
                   need_captcha=bool(w["captcha"]), captcha=w["captcha"] or None,
                   click_power=cp, passive_level=pl,
                   click_cost=(upgrade_cost(cp, UPGRADE_CLICK_BASE, UPGRADE_CLICK_GROWTH) if cp < UPGRADE_MAX_LEVEL else None),
                   passive_cost=(upgrade_cost(pl, UPGRADE_PASSIVE_BASE, UPGRADE_PASSIVE_GROWTH) if pl < UPGRADE_MAX_LEVEL else None))


@app.post("/api/games/clicker/click")
def clicker_click():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    if not hit("gclick", u["id"], 12, 10):      # не больше ~1.2 клика/сек устойчиво — человеку этого достаточно
        return err("Слишком быстро", 429)
    w = wallet_row(u["id"])
    if w["captcha"]:
        return jsonify(ok=False, need_captcha=True, captcha=w["captcha"], error="Сначала решите проверку")
    gain = 1 + (w["click_power"] or 0)   # базовая монета за тап + уровень улучшения «силы клика»
    streak = (w["streak"] or 0) + 1
    need_captcha = streak % CLICKER_CAPTCHA_EVERY == 0
    with db_lock:
        run("UPDATE game_wallet SET coins=coins+?, streak=? WHERE user_id=?", (gain, 0 if need_captcha else streak, u["id"]))
        run("""INSERT INTO game_scores(user_id,game,day,score,ts) VALUES(?,?,?,?,?)
               ON CONFLICT(user_id,game,day) DO UPDATE SET score=score+excluded.score, ts=excluded.ts""",
            (u["id"], "clicker", today_str(), gain, int(time.time())))
    q = new_captcha(u["id"]) if need_captcha else None
    w2 = wallet_row(u["id"])
    return jsonify(ok=True, coins=w2["coins"], gain=gain, need_captcha=need_captcha, captcha=q)


@app.post("/api/games/clicker/upgrade")
def clicker_upgrade():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    if not hit("gupgrade", u["id"], 10, 10):
        return err("Слишком часто", 429)
    kind = str(body().get("kind") or "")
    if kind not in ("click", "passive"):
        return err("Неизвестное улучшение")
    w = wallet_row(u["id"])
    if w["captcha"]:
        return jsonify(ok=False, need_captcha=True, captcha=w["captcha"], error="Сначала решите проверку")
    field = "click_power" if kind == "click" else "passive_level"
    base, growth = (UPGRADE_CLICK_BASE, UPGRADE_CLICK_GROWTH) if kind == "click" else (UPGRADE_PASSIVE_BASE, UPGRADE_PASSIVE_GROWTH)
    level = w[field] or 0
    if level >= UPGRADE_MAX_LEVEL:
        return err("Это улучшение уже максимального уровня")
    cost = upgrade_cost(level, base, growth)
    if (w["coins"] or 0) < cost:
        return err("Недостаточно монет")
    with db_lock:
        # field — всегда одна из двух фиксированных констант выше, никогда не приходит от клиента напрямую
        run(f"UPDATE game_wallet SET coins=coins-?, {field}={field}+1 WHERE user_id=?", (cost, u["id"]))
    w2 = wallet_row(u["id"])
    new_level = level + 1
    next_cost = upgrade_cost(new_level, base, growth) if new_level < UPGRADE_MAX_LEVEL else None
    return jsonify(ok=True, coins=w2["coins"], kind=kind, level=new_level, next_cost=next_cost)


@app.post("/api/games/clicker/captcha")
def clicker_captcha():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    if not hit("gcaptcha", u["id"], 10, 30):
        return err("Слишком часто", 429)
    w = wallet_row(u["id"])
    if not w["captcha"]:
        return jsonify(ok=True, need_captcha=False)
    if time.time() - (w["captcha_at"] or 0) > CLICKER_CAPTCHA_TTL:
        with db_lock:
            run("UPDATE game_wallet SET captcha='', captcha_ans=0 WHERE user_id=?", (u["id"],))
        return err("Проверка устарела — попробуйте снова")
    ans = num(body().get("answer"), -999, 999)
    if ans is None or ans != w["captcha_ans"]:
        q = new_captcha(u["id"])
        return jsonify(ok=False, error="Неверно, попробуйте ещё раз", captcha=q)
    with db_lock:
        run("UPDATE game_wallet SET captcha='', captcha_ans=0 WHERE user_id=?", (u["id"],))
    return jsonify(ok=True, need_captcha=False)


@app.after_request
def headers(r):
    r.headers["X-Content-Type-Options"] = "nosniff"
    if request.path.startswith("/api/") and not request.path.startswith("/api/f/"):
        r.headers["Cache-Control"] = "no-store"
    return r


@app.errorhandler(Exception)
def on_error(e):
    if isinstance(e, HTTPException):
        return jsonify(ok=False, error=e.description or "Ошибка"), e.code
    print("server error:", repr(e))
    return jsonify(ok=False, error="Ошибка сервера"), 500


if __name__ == "__main__":
    init_db()
    if not BOT_APP_LINK:
        print("!!! BOT_APP_LINK не задан: в кнопке бота будет виден WEB_URL. См. README/BotFather /newapp")
    if not TRUST_PROXY:
        print("i  TRUST_PROXY=0: если сервер за прокси хостинга и в «Новый вход» у всех один IP — поставь TRUST_PROXY=1")
    threading.Thread(target=bot_loop, daemon=True).start()
    threading.Thread(target=maintenance_loop, daemon=True).start()
    threading.Thread(target=expiry_loop, daemon=True).start()
    print(f"Сервер: http://{HOST}:{PORT}")
    app.run(host=HOST, port=PORT, threaded=True)
